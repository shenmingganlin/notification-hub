import assert from "node:assert/strict";
import registerWidgetRoutes from "../routes/widget.js";
import NotificationHubPlugin from "../index.js";
import { resolveScopedSound } from "../lib/sound/sound-resolver.js";

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
  dismissEffect: "sakura",
  particleShape: "comet",
  entranceVisual: "prism",
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
  _customToast: { show: (notification) => shown.push(notification) },
  _notificationHubPlugin: plugin,
};

registerWidgetRoutes(app, ctx);
const widgetHandler = routes.get("GET /widget");
assert.equal(typeof widgetHandler, "function", "widget route should be registered");
const widgetHtml = widgetHandler({
  req: { query: () => "" },
  html: (value) => value,
});
assert.match(widgetHtml, /conversationNotificationSoundTheme/, "widget settings HTML should expose the conversation sound theme field");
assert.match(widgetHtml, /conversationCustomNotificationSoundPath/, "widget settings HTML should expose the conversation custom sound path field");
assert.match(widgetHtml, /channelNotificationSoundTheme/, "widget settings HTML should expose the channel sound theme field");
assert.match(widgetHtml, /channelCustomNotificationSoundPath/, "widget settings HTML should expose the channel custom sound path field");
assert.match(widgetHtml, /sound-picker/, "widget settings HTML should expose sound picker buttons");
assert.match(widgetHtml, /panelTheme/, "widget settings HTML should expose the panel theme field");
assert.match(widgetHtml, /panel-theme-/, "widget HTML should apply panel theme classes");
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
const inheritedDisplaySettings = getSettingsHandler({ json: (value) => value });
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
const explicitScopedSettings = getSettingsHandler({ json: (value) => value });
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
  const expectedCustomSoundPath = toast.type === "conversation"
    ? (typeof body.conversationCustomNotificationSoundPath === "string" && body.conversationCustomNotificationSoundPath.trim() ? body.conversationCustomNotificationSoundPath.trim() : fallbackCustomSoundPath)
    : toast.type === "channel"
      ? (typeof body.channelCustomNotificationSoundPath === "string" && body.channelCustomNotificationSoundPath.trim() ? body.channelCustomNotificationSoundPath.trim() : fallbackCustomSoundPath)
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
assert.equal(result.toast.soundTheme, "alert");

result = await postPreview("error", { notificationSoundTheme: "custom", customNotificationSoundPath: "D:/tones/widget-error.m4a" });
assert.equal(result.toast.type, "status");
assert.equal(result.toast.soundTheme, "custom", "custom preview error should keep custom instead of forcing alert");
assert.equal(result.toast.customSoundPath, "D:/tones/widget-error.m4a", "custom preview error should carry custom sound path override");

result = await postPreview("task-done");
assert.equal(result.toast.type, "status");
assert.equal(result.toast.title, "任务完成");

console.log("widget preview checks ok");
