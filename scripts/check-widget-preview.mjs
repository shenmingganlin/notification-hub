import assert from "node:assert/strict";
import registerWidgetRoutes from "../routes/widget.js";
import NotificationHubPlugin from "../index.js";

const baseConfig = {
  notificationDisplayMode: "custom",
  enableConversationNotification: true,
  enableChannelNotification: true,
  enableStatusNotifications: true,
  enableErrorNotifications: true,
  enableTaskDoneNotifications: true,
  enableConversationSound: true,
  enableChannelSound: true,
  enableKeywordImportance: false,
  importantNotificationSound: true,
  notificationSoundTheme: "chime",
  enableChannelAggregation: true,
  channelAggregationWindowSeconds: 5,
  channelAggregationThreshold: 2,
  sakuraTheme: "ember",
  toastStyle: "hologram",
  dismissEffect: "sakura",
  particleShape: "comet",
  entranceVisual: "prism",
  autoDismissMotion: "orbit-decay",
  manualDismissMotion: "gravity-fall",
  physicsPreset: "lively",
  toastTransportMode: "managed",
};

const shown = [];
const plugin = new NotificationHubPlugin();
plugin.ctx = { log: { info() {}, warn() {}, error() {} } };
plugin._cfg = plugin._buildRuntimeConfig(baseConfig);

const routes = new Map();
const app = {
  get(route, handler) { routes.set(`GET ${route}`, handler); },
  post(route, handler) { routes.set(`POST ${route}`, handler); },
};

const ctx = {
  pluginId: "notification-hub",
  pluginDir: "C:/HanaAgent/test-home/plugins/notification-hub",
  dataDir: "C:/HanaAgent/test-home/data/notification-hub-preview-check",
  log: { info() {}, warn(...args) { console.warn(...args); }, error(...args) { console.error(...args); } },
  config: { getAll: () => ({ ...baseConfig }) },
  _customToast: { show: (notification) => shown.push(notification) },
  _notificationHubPlugin: plugin,
};

registerWidgetRoutes(app, ctx);
const handler = routes.get("POST /test-notification");
assert.equal(typeof handler, "function", "test-notification route should be registered");

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
  assert.equal(toast.sakuraTheme, "ember", `${testType}: preview should carry page sakuraTheme`);
  assert.equal(toast.primary, "#ff7a18", `${testType}: preview should use ember primary`);
  assert.equal(toast.accent, "#ffd166", `${testType}: preview should use ember accent`);
  return { response, toast };
}

let result = await postPreview("conversation");
assert.equal(result.toast.type, "conversation");

result = await postPreview("channel");
assert.equal(result.toast.type, "channel");
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
assert.equal(result.toast.soundTheme, "alert");

result = await postPreview("task-done");
assert.equal(result.toast.type, "status");
assert.equal(result.toast.title, "任务完成");

console.log("widget preview checks ok");
