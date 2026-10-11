import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readHostConfig } from '../lib/host-config.js';
import { NotificationStore } from '../lib/notification-store.js';
import { normalizeSettings, buildRuntimeConfig, parseMutedSessionKeys } from '../lib/notification-config.js';
import { decideNotificationSound } from '../lib/sound/sound-decision.js';
import { getSessionInfo } from '../lib/conversation-notification.js';
import { ToastManagerClient } from '../lib/toast-manager-client.js';
import { CustomToast } from '../lib/custom-toast.js';
import NotificationHubPlugin from '../index.js';
import registerRoutes from '../server/widget-routes.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = fs.mkdtempSync(path.join(root, '.q2-r26-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const log = { info() {}, warn() {}, error() {} };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function routesFor(ctx) {
  const routes = new Map();
  registerRoutes({ get: (p, f) => routes.set(`GET ${p}`, f), post: (p, f) => routes.set(`POST ${p}`, f) }, ctx);
  return (route, body = {}) => routes.get(route)({ req: { json: async () => body }, json: (v, status) => ({ ...v, httpStatus: status || 200 }) });
}

test('config errors propagate; refresh preserves last known mute and settings', async () => {
  for (const getAll of [() => { throw Error('read failed'); }, () => Promise.reject(Error('read failed')), () => null]) {
    const ctx = { config: { getAll }, log };
    await assert.rejects(async () => readHostConfig(ctx));
    const plugin = new NotificationHubPlugin();
    plugin.ctx = ctx;
    plugin.applyRuntimeConfigSnapshot({ mutedSessionKeys: 'channel:a', notificationDisplayMode: 'off' });
    const previous = plugin._cfg;
    await plugin._refreshConfigNow();
    assert.equal(plugin._cfg, previous);
    assert.deepEqual(plugin._cfg.mutedSessionKeys, ['channel:a']);
  }
});

test('settings and mute do not write after config read failure', async () => {
  let writes = 0;
  const call = routesFor({ dataDir: tmp, log, config: { getAll: async () => { throw Error('unreadable'); }, setMany: async () => writes++ } });
  assert.equal((await call('POST /mute', { key: 'channel:a' })).ok, false);
  assert.equal((await call('POST /settings', { mutedSessionKeys: '' })).ok, false);
  assert.equal(writes, 0);
});

test('parallel mute updates retain both sources; cap matches disk, response and runtime', async () => {
  let raw = {};
  let runtime;
  const ctx = { dataDir: tmp, log,
    config: { getAll: async () => { const value = { ...raw }; await delay(5); return value; }, setMany: async update => { await delay(5); raw = { ...raw, ...update }; } },
    _notificationHubPlugin: { applySettingsUpdates: (old, update) => { runtime = buildRuntimeConfig({ ...old, ...update }); } },
  };
  const call = routesFor(ctx);
  await Promise.all([call('POST /mute', { key: 'channel:a' }), call('POST /mute', { key: 'channel:b' })]);
  assert.deepEqual(parseMutedSessionKeys(raw.mutedSessionKeys), ['channel:a', 'channel:b']);
  const capped = await call('POST /settings', { mutedSessionKeys: Array.from({ length: 205 }, (_, i) => `channel:${i}`).join('\n') });
  assert.equal(capped.ok, true);
  assert.deepEqual(parseMutedSessionKeys(raw.mutedSessionKeys), parseMutedSessionKeys(capped.settings.mutedSessionKeys));
  const result = await call('POST /mute', { key: 'channel:overflow' });
  assert.deepEqual(parseMutedSessionKeys(raw.mutedSessionKeys), result.mutedSessionKeys);
  assert.deepEqual(runtime.mutedSessionKeys, result.mutedSessionKeys);
  assert.equal(result.mutedSessionKeys.length, 200);
  assert.equal(result.ok, false, 'limit rejection must not pretend the new source was muted');
});

test('mute keys use newlines only and preserve comma in session path', () => {
  assert.deepEqual(parseMutedSessionKeys('session:C:\\a,b，c\\s.jsonl\r\nchannel:room'), ['session:c:/a,b，c/s.jsonl', 'channel:room']);
});

test('important theme is authoritative for status, keyword chat and channel; legacy false remains visible', () => {
  assert.equal(normalizeSettings({ importantNotificationSound: false }).importantNotificationSoundTheme, 'off');
  for (const type of ['status', 'conversation', 'channel']) {
    assert.equal(decideNotificationSound({ importantNotificationSoundTheme: 'off' }, { type, importance: 'important', sound: true, soundTheme: 'chime' }).enabled, false);
    const selected = decideNotificationSound({ importantNotificationSound: false, importantNotificationSoundTheme: 'alert' }, { type, importance: 'important' });
    assert.equal(selected.enabled, true);
    assert.equal(selected.soundTheme, 'alert');
  }
});

test('history writes atomically; failed push/clear keeps memory and disk and exposes storage failure', async () => {
  const storeSource = fs.readFileSync(path.join(root, 'lib/notification-store.js'), 'utf8');
  assert.doesNotMatch(storeSource, /fs\.fsync(?:Sync)?\s*\(/);
  const dir = path.join(tmp, 'store');
  const store = new NotificationStore(dir, log);
  store.init();
  const first = store.push({ title: 'kept', type: 'status' });
  const recordsPath = path.join(dir, 'notifications.jsonl');
  const original = fs.readFileSync(recordsPath, 'utf8');
  const rename = fs.renameSync;
  let renames = 0;
  fs.renameSync = (from, to) => { if (to === recordsPath) { renames++; throw Error('rename denied'); } return rename(from, to); };
  try {
    assert.throws(() => store.push({ title: 'lost' }), /rename denied/);
    assert.throws(() => store.clear(), /rename denied/);
    assert.equal(store.recent()[0].id, first.id);
    assert.equal(fs.readFileSync(recordsPath, 'utf8'), original);
    assert.equal(renames, 2);
    const call = routesFor({ dataDir: dir, log, config: { getAll: () => ({}) }, _notificationStore: store });
    assert.equal((await call('POST /clear', { confirm: true })).ok, false);
    const result = await call('GET /records');
    assert.equal(result.storage.ok, false);
    assert.match(result.storage.error, /rename denied/);
    assert.equal(result.records[0].id, first.id);
  } finally { fs.renameSync = rename; }
  store.clear();
  assert.equal(store.storageStatus().ok, true);
  assert.equal(fs.readFileSync(recordsPath, 'utf8'), '');
});

test('unreadable or malformed history is not an empty success', async () => {
  const dir = path.join(tmp, 'broken');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'notifications.jsonl'), '{bad json');
  const store = new NotificationStore(dir, log);
  store.init();
  assert.throws(() => store.push({ title: 'must not overwrite' }));
  const call = routesFor({ dataDir: dir, log, config: { getAll: () => ({}) }, _notificationStore: store });
  assert.equal((await call('GET /records')).storage.ok, false);
});

test('missing sessions share one full-list request, including negative cache', async () => {
  let reads = 0;
  const plugin = { ctx: { bus: { request: async () => { reads++; return { sessions: [] }; } } } };
  for (let i = 0; i < 50; i++) assert.equal(await getSessionInfo(plugin, `missing-${i}.jsonl`), null);
  assert.equal(reads, 1);
});

test('queue partial acknowledgement is kept until complete; post-write timeout is uncertain, never safe to retry', async () => {
  const dir = path.join(tmp, 'queue');
  const client = new ToastManagerClient(log, { queueDir: dir, token: 'test' });
  const pending = client.sendCreate({ toastId: 'partial', title: 'once' }, 250);
  const ack = path.join(dir, 'partial.ack.json');
  fs.writeFileSync(ack, '{"ok":');
  await delay(45);
  assert.equal(fs.existsSync(ack), true);
  fs.writeFileSync(ack, JSON.stringify({ ok: true }));
  await delay(25);
  assert.equal(fs.existsSync(ack), true, 'valid JSON without id/op must also be retained');
  fs.writeFileSync(ack, JSON.stringify({ id: 'partial', ok: true, op: 'shown' }));
  const result = await pending;
  assert.equal(result.status, 'shown');
  assert.equal(fs.existsSync(ack), false);
  const timeout = await client.sendCreate({ toastId: 'timeout' }, 40);
  assert.equal(timeout.status, 'unknown');
  assert.equal(timeout.retrySafe, false);
});

test('uncertain create never falls back and never claims it was displayed', async () => {
  const toast = new CustomToast({ pluginDir: root, dataDir: path.join(tmp, 'toast'), log });
  toast._ensureManagerReady = async () => true;
  toast._pipeClient.sendCreate = async () => ({ status: 'unknown', retrySafe: false, error: 'ack timeout' });
  let fallbacks = 0;
  toast._fallbackShow = () => { fallbacks++; return { status: 'shown' }; };
  const result = await toast.showConfirmed({ title: 'once', sound: true });
  assert.equal(result.status, 'unknown');
  assert.equal(fallbacks, 0);
  toast.stop();
});

test('TCP post-write disconnect never allows a second toast; connect failure is safe to fall back', async () => {
  const client = new ToastManagerClient(log);
  const socket = new EventEmitter();
  socket.destroy = () => {};
  socket.write = () => { setImmediate(() => socket.emit('error', Error('connection reset'))); };
  client._connect = async () => socket;
  const disconnected = await client.sendCreate({ toastId: 'tcp-once', sound: true }, 100);
  assert.equal(disconnected.status, 'unknown');
  assert.equal(disconnected.retrySafe, false);
  client._connect = async () => { throw Error('connect refused'); };
  const refused = await client.sendCreate({ toastId: 'tcp-never-sent' }, 100);
  assert.equal(refused.status, 'failed');
  assert.equal(refused.retrySafe, true);
});

test('test route reports failed display instead of sent success', async () => {
  const call = routesFor({ dataDir: tmp, log, config: { getAll: () => ({}) }, _customToast: { showConfirmed: async () => ({ status: 'failed', error: 'helper unavailable' }) } });
  const result = await call('POST /test-notification');
  assert.equal(result.ok, false);
  assert.equal(result.displayed, false);
  assert.match(result.error, /helper unavailable/);
});

test('actual settings save callback repopulates all fields before a second save', async () => {
  const html = fs.readFileSync(path.join(root, 'ui/widget.html'), 'utf8');
  // Execute the page's own functions, not a duplicate implementation of saving.
  const bind = html.slice(html.indexOf('  function bindSettingsEvents()'), html.indexOf('  function resolvePanelThemeClient'));
  const fields = new Map();
  const listeners = new Map();
  const feedback = {};
  const button = { addEventListener: (name, fn) => listeners.set(name, fn) };
  const document = {
    querySelectorAll: selector => selector.indexOf('textarea[data-key]') >= 0 || selector.indexOf('input.setting-input') >= 0
      ? [...fields].map(([key, field]) => ({ ...field, dataset: { key } })) : [],
    getElementById: id => id === 'btn-save-settings' ? button : feedback,
    querySelector: selector => {
      const key = selector.match(/data-key="([^"]+)"/)?.[1];
      return selector.startsWith('input.setting-input') && key ? fields.get(key) : null;
    },
  };
  for (const key of ['customNotificationSoundPath', 'conversationCustomNotificationSoundPath', 'channelCustomNotificationSoundPath']) fields.set(key, { value: 'old.wav' });
  let payload;
  let saves = 0;
  const savedSettings = Object.fromEntries([...fields.keys()].map(key => [key, 'new.wav']));
  const context = vm.createContext({ document, window: {}, VISUAL_COMBO_PACKS: {}, applyWidgetAppearance() {}, loadRecords: async () => {},
    API: '/test', fetch: async (_url, request) => { saves++; payload = JSON.parse(request.body); return { json: async () => ({ ok: true, settings: savedSettings }) }; } });
  vm.runInContext(bind + '\nbindSettingsEvents();', context);
  document.querySelectorAll = selector => selector.startsWith('textarea[data-key]') ? [...fields].map(([key, field]) => ({ dataset: { key }, get value() { return field.value; } })) : [];
  await listeners.get('click').call(button);
  for (const field of fields.values()) assert.equal(field.value, 'new.wav');
  await listeners.get('click').call(button);
  assert.equal(saves, 2);
  assert.equal(payload.conversationCustomNotificationSoundPath, 'new.wav');
  assert.equal(payload.channelCustomNotificationSoundPath, 'new.wav');
  assert.equal(button.disabled, false);
});

test('history page shows persistent storage error instead of the empty-list state', async () => {
  const html = fs.readFileSync(path.join(root, 'ui/widget.html'), 'utf8');
  const filter = html.slice(html.indexOf('  var recordsError ='), html.indexOf('  function muteKey(record)'));
  const load = html.slice(html.indexOf('  async function loadRecords('), html.indexOf('  function refreshRecords()'));
  const list = { innerHTML: '', querySelectorAll: () => [] };
  const document = { hidden: false, getElementById: id => id === 'list' ? list : null, querySelector: () => null };
  const context = vm.createContext({ document, recordsRevision: 0, recordsRequests: 0, muteRequests: 0, pageHidden: false,
    currentFilter: 'all', allRecords: [], mutedKeys: [], latestClick: null, API: '/test', esc: String,
    renderEmpty: () => 'EMPTY-SUCCESS', renderEmptyFilter: () => 'EMPTY-FILTER', renderRecord: () => '', notifyResize() {}, setStatus() {},
    fetch: async () => ({ ok: true, json: async () => ({ ok: false, storage: { ok: false, error: 'disk denied' }, records: [] }) }) });
  vm.runInContext(filter + load, context);
  await vm.runInContext('loadRecords(true)', context);
  assert.match(list.innerHTML, /通知存储失败/);
  assert.match(list.innerHTML, /disk denied/);
  assert.doesNotMatch(list.innerHTML, /EMPTY-SUCCESS/);
});

test('manager spawn error is handled without an unhandled EventEmitter error', async () => {
  const toast = new CustomToast({ pluginDir: root, dataDir: path.join(tmp, 'spawn'), log });
  toast._stopExistingManagersForThisHelper = async () => {};
  toast._waitForManagerReady = async () => { await delay(25); return false; };
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  toast._spawn = () => { setImmediate(() => child.emit('error', Error('spawn denied'))); return child; };
  assert.equal(await toast._startManager(), false);
  assert.equal(toast._managerProcess, null);
  toast.stop();
});
