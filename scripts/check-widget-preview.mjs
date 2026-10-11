import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import registerWidgetRoutes from "../server/widget-routes.js";
import NotificationHubPlugin from "../index.js";
import { resolveScopedSound } from "../lib/sound/sound-resolver.js";
import { PANEL_THEME_DARK_HINTS, visualCatalog } from "../lib/effect-registry.js";
import { appearanceFromSnapshot, describeWidgetFrame, issuedStylesheetUrl, panelThemePaint } from "../ui/widget-appearance.js";
import { DARK_PANEL_THEMES, HOST_DARK_THEMES } from "../ui/visual-tables.js";

const baseConfig = {
  notificationDisplayMode: "custom",
  enableConversationNotification: true,
  enableChannelNotification: true,
  enableStatusNotifications: true,
  enableErrorNotifications: true,
  enableTaskDoneNotifications: true,
  enableKeywordImportance: false,
  importantNotificationSound: true,
  notificationSoundTheme: "chime",
  customNotificationSoundPath: "C:/sounds/widget-preview.mp3",
  conversationNotificationSoundTheme: "custom",
  conversationCustomNotificationSoundPath: "C:/sounds/widget-chat.mp3",
  channelNotificationSoundTheme: "custom",
  channelCustomNotificationSoundPath: "D:/sounds/widget-channel.m4a",
  enableChannelAggregation: true,
  channelAggregationWindowSeconds: 5,
  channelAggregationThreshold: 2,
  sakuraTheme: "ember",
  toastStyle: "hologram",
  particleShape: "comet",
  entranceVisual: "mist-bloom",
  autoDismissMotion: "orbit-decay",
  manualDismissMotion: "gravity-fall",
  physicsPreset: "lively",
  toastTransportMode: "managed",
};

const shown = [];
const log = { info() {}, warn(...args) { console.warn(...args); }, error(...args) { console.error(...args); } };
let storedConfig = { ...baseConfig };
const configApi = {
  getAll: () => ({ ...storedConfig }),
  setMany(updates) { storedConfig = { ...storedConfig, ...updates }; },
  set(key, value) { storedConfig = { ...storedConfig, [key]: value }; },
};
const plugin = new NotificationHubPlugin();
plugin.ctx = { config: configApi, log };
plugin._cfg = plugin._buildRuntimeConfig(storedConfig);

const routes = new Map();
const app = {
  get(route, handler) { routes.set(`GET ${route}`, handler); },
  post(route, handler) { routes.set(`POST ${route}`, handler); },
};

const ctx = {
  pluginId: "notification-hub",
  pluginDir: "C:/HanaAgent/test-home/plugins/notification-hub",
  dataDir: "C:/HanaAgent/test-home/data/notification-hub-preview-check",
  log,
  config: configApi,
  _customToast: { showConfirmed: (notification) => { shown.push(notification); return { status: "shown" }; } },
  _notificationHubPlugin: plugin,
};

registerWidgetRoutes(app, ctx);
assert.equal(routes.has("GET /widget"), false, "the card page is ui/widget.html, not a second HTML route");
assert.equal(typeof routes.get("GET /visual-catalog"), "function", "visual catalog should come from one route");
assert.deepEqual(routes.get("GET /visual-catalog")({ json: (value) => value }), visualCatalog(), "visual catalog route should return the registry");
const widgetHtml = fs.readFileSync(new URL("../ui/widget.html", import.meta.url), "utf8");
assert.equal(/focusConversation|__nhFocusSession|sessions\s*\.\s*focus|\/api\/sessions\/switch|切回|切不回|跳转|Session focus unavailable/.test(widgetHtml), false, "R27: list must not retain session navigation or its failure copy");
assert.equal(/\.item\.type-conversation\s*\{[^}]*cursor:\s*pointer/.test(widgetHtml), false, "R27: conversation rows must not advertise navigation");
// Execute the page's filter and refresh callbacks: rows are read-only, mute stays a button.
{
  const filterSource = widgetHtml.slice(widgetHtml.indexOf('  var recordsError ='), widgetHtml.indexOf('  function muteKey(record)'));
  const loadSource = widgetHtml.slice(widgetHtml.indexOf('  async function loadRecords('), widgetHtml.indexOf('  function refreshRecords()'));
  const rows = [
    { type: 'conversation', id: 'chat', source: 'C:/sessions/one.jsonl', meta: { sessionId: 'one' } },
    { type: 'channel', id: 'room', source: '#room' },
  ];
  const bindings = [];
  const row = { addEventListener: name => bindings.push(name) };
  const button = { dataset: { key: 'session:c:/sessions/one.jsonl', muted: '0' }, addEventListener: (name, callback) => { button[name] = callback; } };
  const count = {};
  const list = { innerHTML: '', querySelectorAll: selector => selector === '.item' ? [row, row] : selector === '.mute-session' ? [button] : [] };
  let mutedCall;
  let requests = 0;
  const context = vm.createContext({
    document: { hidden: false, getElementById: id => id === 'list' ? list : id === 'stat-count' ? { querySelector: () => count } : null, querySelector: () => null },
    allRecords: rows, currentFilter: 'all', recordsRevision: 0, recordsRequests: 0, muteRequests: 0, pageHidden: false,
    API: '/test', mutedKeys: [], latestClick: null, esc: String, renderRecord: record => record.id, renderEmpty: () => 'EMPTY', renderEmptyFilter: () => 'FILTER-EMPTY',
    notifyResize() {}, setStatus() {}, setSessionMuted: (key, muted) => { mutedCall = { key, muted }; },
    fetch: async () => { requests++; return { ok: true, json: async () => ({ ok: true, storage: { ok: true }, records: rows, mutedSessionKeys: [] }) }; },
  });
  vm.runInContext(filterSource + loadSource + '\napplyFilter();', context);
  assert.deepEqual(bindings, [], 'R27: no click or keyboard handler is bound to a notification row');
  assert.equal(row.tabIndex, undefined, 'R27: conversation rows do not enter the tab order');
  assert.equal(typeof button.click, 'function', 'R27: mute button remains interactive');
  button.click.call(button, { preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(mutedCall, { key: 'session:c:/sessions/one.jsonl', muted: true });
  vm.runInContext("currentFilter = 'conversation'; applyFilter();", context);
  assert.equal(list.innerHTML, 'chat', 'R27: conversation filter still works');
  assert.equal(count.textContent, '1');
  await vm.runInContext('loadRecords(true)', context);
  assert.equal(requests, 1, 'R27: list refresh still requests records');
  assert.equal(list.innerHTML, 'chat', 'R27: refresh preserves current filter');
}

assert.match(widgetHtml, /conversationNotificationSoundTheme/, "widget settings HTML should expose the conversation sound theme field");
assert.match(widgetHtml, /conversationCustomNotificationSoundPath/, "widget settings HTML should expose the conversation custom sound path field");
assert.match(widgetHtml, /channelNotificationSoundTheme/, "widget settings HTML should expose the channel sound theme field");
assert.match(widgetHtml, /channelCustomNotificationSoundPath/, "widget settings HTML should expose the channel custom sound path field");
assert.match(widgetHtml, /sound-picker/, "widget settings HTML should expose sound picker buttons");
assert.match(widgetHtml, /panelTheme/, "widget settings HTML should expose the panel theme field");
assert.match(widgetHtml, /自动时跟随界面深浅/, "panel theme hint should say auto follows the host");
assert.doesNotMatch(widgetHtml, /跟随当前组合包/, "panel theme hint should not claim auto follows only the combo pack");
assert.match(widgetHtml, /host-follow\.js/, "widget should follow the host theme from the live page");
assert.match(widgetHtml, /clickAction/, "widget should expose the click highlight switch");
assert.match(widgetHtml, /刚点开/, "the clicked row should say why it looks different");
assert.match(widgetHtml, /\.click-tag[\s\S]*background: var\(--accent\)/, "the clicked-row hint should use the page button fill");
assert.match(widgetHtml, /sakuraEnabled/, "widget should expose the particle exit switch");
assert.match(widgetHtml, /不控制错误和任务完成/, "status switch should not claim to gate errors or task-done");
assert.doesNotMatch(widgetHtml, /状态监控关闭时也不会弹/, "error and task-done hints should not require the status switch");
assert.doesNotMatch(widgetHtml, /粒子贴图|樱花和角色配色/, "page hints should not keep the old particle and sakura wording");
assert.doesNotMatch(widgetHtml, /dismissEffect/, "widget should not write the retired dismiss field");
assert.match(widgetHtml, /\/visual-catalog/, "widget should read the visual catalog instead of embedding it");
assert.doesNotMatch(widgetHtml, /var VISUAL_COMBO_PACKS = \{[^}]/, "widget should not embed a frozen combo pack table");
assert.doesNotMatch(widgetHtml, /var EFFECT_OPTIONS = \{[^}]/, "widget should not embed a frozen effect option table");
assert.doesNotMatch(widgetHtml, /魔法空气包/, "widget should not keep a copied combo pack label");
assert.match(widgetHtml, /cardExitMode/, "widget should expose the card exit mode");
assert.match(widgetHtml, /滑回右侧/, "widget should name the reverse card exit");
assert.match(widgetHtml, /直接消失/, "widget should offer instant card exit");
assert.match(widgetHtml, /pushGroup\("07", "粒子退场"[\s\S]*autoDismissMotion[\s\S]*manualDismissMotion[\s\S]*pushGroup\("08"/, "particle motions should live in the particle group");
assert.doesNotMatch(widgetHtml, /走轨迹|自动消失轨迹|手动关闭轨迹/, "old card-trajectory names should not remain");
assert.match(widgetHtml, /cardExitFade/, "widget should expose the card exit fade switch");
assert.match(widgetHtml, /quietHoursEnabled/, "widget should expose quiet hours");
assert.match(widgetHtml, /\/mute/, "widget should mute a session from the list");
assert.doesNotMatch(widgetHtml, /<html[^>]*\bhost-frame\b/, "widget without a host appearance should keep the legacy frame");
const plain = describeWidgetFrame({
  requestedPanelTheme: "auto",
  resolvedPanelTheme: "classic",
  resolvedPanelLabel: "经典柔和",
  hostAppearance: "",
});
assert.equal(plain.hostFrame, false, "widget without a host appearance should keep the legacy frame");
assert.match(plain.className, /theme-light/, "an unresolved host should stay on the page skin");
const hostDark = describeWidgetFrame({
  requestedPanelTheme: "auto",
  resolvedPanelTheme: "classic",
  resolvedPanelLabel: "经典柔和",
  hostAppearance: "dark",
});
assert.equal(hostDark.hostFrame, true, "new host frame should be marked on the widget");
assert.match(hostDark.className, /theme-dark/, "auto panel theme should follow a dark Hana appearance");
assert.match(hostDark.subtitle, /跟随界面 · 深色/, "auto panel subtitle should name the host appearance");
const explicitTheme = describeWidgetFrame({
  requestedPanelTheme: "classic",
  resolvedPanelTheme: "classic",
  resolvedPanelLabel: "经典柔和",
  hostAppearance: "dark",
});
assert.match(explicitTheme.className, /theme-light/, "an explicit panel theme should not be replaced by the host appearance");
assert.match(explicitTheme.className, /panel-theme-classic/, "an explicit panel theme should stay on its own skin");
assert.equal(panelThemePaint("moonlight", false).bg, "#0e1020", "an explicit panel theme should paint its own colors");
assert.equal(panelThemePaint("moonlight", true), null, "auto host follow should not stamp a panel color over the host");
assert.match(widgetHtml, /if \(requested && requested !== 'auto'\) return requested;/, "a saved panel theme must not be rewritten to classic before the catalog loads");
assert.match(widgetHtml, /wrap\.dataset\.value/, "hidden setting selects must keep the saved value");
assert.equal(appearanceFromSnapshot({ appearance: "dark", theme: "warm-paper" }), "dark", "a host appearance should outrank the theme name");
assert.equal(appearanceFromSnapshot({ theme: "midnight" }), "dark", "an older host without appearance should still read midnight as dark");
assert.equal(issuedStylesheetUrl("https://hana.local/api/apps/theme.css?theme=midnight"), "https://hana.local/api/apps/theme.css?theme=midnight", "an issued stylesheet URL should be used as given");
assert.equal(issuedStylesheetUrl("javascript:alert(1)"), "", "a non-http stylesheet URL should be ignored");
assert.deepEqual([...PANEL_THEME_DARK_HINTS], [...DARK_PANEL_THEMES], "dark panel names should come from one table");
const headScript = widgetHtml.slice(widgetHtml.indexOf("<script>"), widgetHtml.indexOf("</script>"));
const hostDarkList = headScript.match(/var hostDarkThemes = (\[[^\]]+\])/);
assert.ok(hostDarkList, "first paint should name the host-dark themes from the shared table");
assert.deepEqual(JSON.parse(hostDarkList[1]), [...HOST_DARK_THEMES], "first paint host-dark names should match the shared table");
assert.doesNotMatch(widgetHtml, /\['tech', 'obsidian', 'hologram', 'ember', 'moonlight'\]/, "the page should not keep a second dark-panel list");
storedConfig = { ...baseConfig };
assert.match(widgetHtml, /\/pick-sound/, "widget script should call the sound picker route");
const pickHandler = routes.get("POST /pick-sound");
assert.equal(typeof pickHandler, "function", "pick-sound route should be registered");
const invalidPick = await pickHandler({
  req: { json: async () => ({ target: "unknown" }) },
  json: (value) => value,
});
assert.equal(invalidPick.ok, false, "invalid picker targets should be rejected without opening a dialog");
const getSettingsHandler = routes.get("GET /settings");
assert.equal(typeof getSettingsHandler, "function", "settings read route should be registered");
const settingsHandler = routes.get("POST /settings");
assert.equal(typeof settingsHandler, "function", "settings save route should be registered");
const handler = routes.get("POST /test-notification");
assert.equal(typeof handler, "function", "test-notification route should be registered");

const inheritedSoundConfig = {
  ...baseConfig,
  notificationSoundTheme: "custom",
  customNotificationSoundPath: "C:/tones/first.mp3",
  conversationNotificationSoundTheme: "custom",
  conversationCustomNotificationSoundPath: "",
  channelNotificationSoundTheme: "custom",
  channelCustomNotificationSoundPath: "",
};
storedConfig = { ...inheritedSoundConfig };
plugin._cfg = plugin._buildRuntimeConfig(storedConfig);
const inheritedDisplaySettings = await getSettingsHandler({ json: (value) => value });
assert.equal(inheritedDisplaySettings.conversationCustomNotificationSoundPath, "C:/tones/first.mp3", "settings read should show the inherited conversation custom sound path");
assert.equal(inheritedDisplaySettings.channelCustomNotificationSoundPath, "C:/tones/first.mp3", "settings read should show the inherited channel custom sound path");
const saveInheritedResponse = await settingsHandler({
  req: { json: async () => ({ ...inheritedDisplaySettings, customNotificationSoundPath: "C:/tones/second.mp3" }) },
  json: (value) => value,
});
assert.equal(saveInheritedResponse.ok, true, "settings save should accept a global custom sound change");
assert.equal(storedConfig.customNotificationSoundPath, "C:/tones/second.mp3", "settings save should persist the new global custom sound path");
assert.equal(storedConfig.conversationCustomNotificationSoundPath, "", "settings save should clear an inherited conversation display path instead of pinning the old global file");
assert.equal(storedConfig.channelCustomNotificationSoundPath, "", "settings save should clear an inherited channel display path instead of pinning the old global file");
assert.equal(saveInheritedResponse.settings.conversationCustomNotificationSoundPath, "C:/tones/second.mp3", "saved settings response should resolve conversation inheritance to the new global file");
assert.equal(saveInheritedResponse.settings.channelCustomNotificationSoundPath, "C:/tones/second.mp3", "saved settings response should resolve channel inheritance to the new global file");
assert.equal(resolveScopedSound(storedConfig, "conversation").customSoundPath, "C:/tones/second.mp3", "conversation resolver should inherit the new global custom file after save");
assert.equal(resolveScopedSound(storedConfig, "channel").customSoundPath, "C:/tones/second.mp3", "channel resolver should inherit the new global custom file after save");
const saveAgain = await settingsHandler({ req: { json: async () => saveInheritedResponse.settings }, json: value => value });
assert.equal(saveAgain.settings.conversationCustomNotificationSoundPath, "C:/tones/second.mp3", "second save must not restore old chat sound");
assert.equal(saveAgain.settings.channelCustomNotificationSoundPath, "C:/tones/second.mp3", "second save must not restore old channel sound");
shown.length = 0;
const inheritedPreviewResponse = await handler({
  req: { json: async () => ({ preview: true, testType: "conversation", count: 1 }) },
  json: (value) => value,
});
assert.equal(inheritedPreviewResponse.ok, true, "conversation preview should run after inherited sound save");
assert.equal(shown[0]?.customSoundPath, "C:/tones/second.mp3", "conversation preview payload should use the new global custom file after inherited scoped path is cleared");
shown.length = 0;
await handler({
  req: { json: async () => ({ preview: true, testType: "channel", count: 1 }) },
  json: (value) => value,
});
assert.equal(shown[0]?.customSoundPath, "C:/tones/second.mp3", "channel preview payload should use the new global custom file after inherited scoped path is cleared");

storedConfig = {
  ...inheritedSoundConfig,
  conversationCustomNotificationSoundPath: "C:/tones/chat.mp3",
  channelCustomNotificationSoundPath: "D:/tones/channel.mp3",
};
plugin._cfg = plugin._buildRuntimeConfig(storedConfig);
const explicitScopedSettings = await getSettingsHandler({ json: (value) => value });
const saveExplicitResponse = await settingsHandler({
  req: { json: async () => ({ ...explicitScopedSettings, customNotificationSoundPath: "C:/tones/second.mp3" }) },
  json: (value) => value,
});
assert.equal(saveExplicitResponse.ok, true, "settings save should accept a global custom sound change with scoped overrides");
assert.equal(storedConfig.conversationCustomNotificationSoundPath, "C:/tones/chat.mp3", "settings save should preserve an explicit conversation custom sound path");
assert.equal(storedConfig.channelCustomNotificationSoundPath, "D:/tones/channel.mp3", "settings save should preserve an explicit channel custom sound path");

storedConfig = { ...baseConfig };
plugin._cfg = plugin._buildRuntimeConfig(storedConfig);

async function postPreview(testType, extra = {}) {
  shown.length = 0;
  const body = {
    ...baseConfig,
    preview: true,
    testType,
    count: 1,
    ...extra,
  };
  const response = await handler({
    req: { json: async () => body },
    json: (value) => value,
  });
  assert.equal(response.ok, true, `${testType}: route should return ok`);
  assert.equal(shown.length, 1, `${testType}: should show one preview toast`);
  const toast = shown[0];
  const fallbackCustomSoundPath = typeof body.customNotificationSoundPath === "string" ? body.customNotificationSoundPath.trim() : "";
  const importantCustomSoundPath = typeof body.importantCustomNotificationSoundPath === "string" ? body.importantCustomNotificationSoundPath.trim() : "";
  const isImportant = toast.importance === "important" || toast.importance === "urgent";
  const expectedCustomSoundPath = toast.type === "conversation"
    ? (typeof body.conversationCustomNotificationSoundPath === "string" && body.conversationCustomNotificationSoundPath.trim() ? body.conversationCustomNotificationSoundPath.trim() : fallbackCustomSoundPath)
    : toast.type === "channel"
      ? (typeof body.channelCustomNotificationSoundPath === "string" && body.channelCustomNotificationSoundPath.trim() ? body.channelCustomNotificationSoundPath.trim() : fallbackCustomSoundPath)
      : isImportant && importantCustomSoundPath
        ? importantCustomSoundPath
        : fallbackCustomSoundPath;
  const expectedPlayableCustomSoundPath = toast.sound && toast.soundTheme === "custom" ? expectedCustomSoundPath : "";
  assert.equal(toast.sakuraTheme, "ember", `${testType}: preview should carry page sakuraTheme`);
  assert.equal(toast.primary, "#ff7a18", `${testType}: preview should use ember primary`);
  assert.equal(toast.accent, "#ffd166", `${testType}: preview should use ember accent`);
  assert.equal(toast.customSoundPath, expectedPlayableCustomSoundPath, `${testType}: preview should carry only the playable custom sound path`);
  assert.equal(typeof toast.meta?.soundDecision?.reason, "string", `${testType}: preview should carry sound decision diagnostics`);
  return { response, toast };
}

let result = await postPreview("conversation");
assert.equal(result.toast.type, "conversation");
assert.equal(result.toast.soundTheme, "custom", "conversation preview should use the conversation sound theme");
assert.equal(result.toast.customSoundPath, "C:/sounds/widget-chat.mp3", "conversation preview should use the conversation custom sound path");

result = await postPreview("channel");
assert.equal(result.toast.type, "channel");
assert.equal(result.toast.soundTheme, "custom", "channel preview should use the channel sound theme");
assert.equal(result.toast.customSoundPath, "D:/sounds/widget-channel.m4a", "channel preview should use the channel custom sound path");
assert.equal(result.toast.meta.channelName, "settings-preview-channel");

result = await postPreview("channel-aggregate", { channelAggregationThreshold: 3 });
assert.equal(result.toast.type, "channel");
assert.equal(result.toast.agentName, "频道摘要");
assert.equal(result.toast.meta.aggregate, true);
assert.equal(result.toast.meta.count, 3);

result = await postPreview("status");
assert.equal(result.toast.type, "status");
assert.equal(result.toast.title, "状态提醒");

result = await postPreview("error");
assert.equal(result.toast.type, "status");
assert.equal(result.toast.title, "运行错误");
assert.equal(result.toast.soundTheme, "alert", "default error preview should use the important-notification theme");

result = await postPreview("error", {
  importantNotificationSoundTheme: "custom",
  importantCustomNotificationSoundPath: "D:/tones/widget-error.m4a",
});
assert.equal(result.toast.type, "status");
assert.equal(result.toast.soundTheme, "custom", "error preview should use the configured important-notification theme");
assert.equal(result.toast.customSoundPath, "D:/tones/widget-error.m4a", "error preview should use the important-notification custom sound path");

result = await postPreview("task-done");
assert.equal(result.toast.type, "status");
assert.equal(result.toast.title, "任务完成");

const delayedConfig = {
  toastOffsetX: 20,
  toastOffsetY: 50,
  particleSizeScale: 3,
  visualComboPack: "custom",
};
let savedPatch = null;
const asyncRoutes = new Map();
registerWidgetRoutes({
  get(path, handler) { asyncRoutes.set(`GET ${path}`, handler); },
  post(path, handler) { asyncRoutes.set(`POST ${path}`, handler); },
}, {
  pluginId: "notification-hub",
  log,
  config: {
    getAll: () => Promise.resolve({ ...delayedConfig }),
    setMany: (updates) => {
      savedPatch = updates;
      return Promise.resolve();
    },
  },
  _notificationHubPlugin: plugin,
});
const loaded = await asyncRoutes.get("GET /settings")({ json: (value) => value });
assert.equal(loaded.toastOffsetX, 20, "settings read should wait for an async host config");
assert.equal(loaded.toastOffsetY, 50, "settings read should keep the stored vertical offset");
assert.equal(loaded.particleSizeScale, 3, "settings read should keep the stored particle size");
const saved = await asyncRoutes.get("POST /settings")({
  req: { json: async () => ({ ...loaded, toastOffsetX: 40 }) },
  json: (value) => value,
});
assert.equal(saved.ok, true, "settings save should resolve an async host write");
assert.equal(savedPatch.toastOffsetX, 40, "settings save should persist after the host write resolves");
assert.equal(saved.settings.toastOffsetX, 40, "settings save response should keep the written offset");

console.log("widget preview checks ok");
