import assert from "node:assert/strict";
import NotificationHubPlugin from "../index.js";

const SESSION_PATH = "C:/HanaAgent/test-home/agents/hanako/sessions/check-notification-types.jsonl";

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
  enableChannelAggregation: false,
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

const log = {
  info() {},
  warn(...args) { console.warn(...args); },
  error(...args) { console.error(...args); },
};

let currentConfig = { ...baseConfig };
const shown = [];
const records = [];
const emitted = [];

const plugin = new NotificationHubPlugin();
plugin.ctx = {
  log,
  config: {
    getAll: () => ({ ...currentConfig }),
  },
  bus: {
    emit: (event, sessionPath) => emitted.push({ event, sessionPath }),
  },
};
plugin._channelAggregation = new Map();
plugin._channelCache = new Map();
plugin._channelsDir = "";
plugin._handlingNotification = false;
plugin._clickLogPath = "";
plugin._agentResolver = {
  get(id) {
    return {
      id,
      displayName: id === "hanako" ? "Hanako" : "频道成员",
      theme: { emoji: "🌸", primary: "#9b59b6", accent: "#ff9ecf" },
    };
  },
  resolveFromSender(sender) {
    return {
      id: sender || "member",
      displayName: sender === "alice" ? "Alice" : "频道成员",
      theme: { emoji: "💬", primary: "#123456", accent: "#abcdef" },
    };
  },
};
plugin._resolveChannel = (channelName) => ({
  id: channelName,
  name: "测试频道",
  description: "notification type check",
});
plugin._getSessionTitle = () => "测试会话";
plugin._store = {
  push(notification) {
    const record = {
      id: `record-${records.length + 1}`,
      ts: records.length + 1,
      ...notification,
    };
    records.push(record);
    return record;
  },
};
plugin._customToast = {
  show(notification) {
    shown.push(notification);
  },
  setTransportMode() {},
};

function configure(patch = {}) {
  currentConfig = { ...baseConfig, ...patch };
  plugin._refreshConfigNow();
}

function clearAggregations() {
  for (const entry of plugin._channelAggregation.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  plugin._channelAggregation.clear();
}

function reset() {
  shown.length = 0;
  records.length = 0;
  emitted.length = 0;
  clearAggregations();
}

function expectNoPopup(label) {
  assert.equal(shown.length, 0, `${label}: should not show custom toast`);
  assert.equal(records.length, 0, `${label}: should not record notification`);
}

function expectOnePopup(label) {
  assert.equal(shown.length, 1, `${label}: should show one custom toast`);
  assert.equal(records.length, 1, `${label}: should record one notification`);
  assert.strictEqual(shown[0], records[0], `${label}: history record and toast payload should be the same decorated object`);
  return shown[0];
}

function expectEmberPalette(notification, label) {
  assert.equal(notification.sakuraTheme, "ember", `${label}: sakuraTheme should come from settings`);
  assert.equal(notification.primary, "#ff7a18", `${label}: primary should use ember palette`);
  assert.equal(notification.accent, "#ffd166", `${label}: accent should use ember palette`);
  assert.deepEqual(notification.meta?.toastColorSource, {
    primary: "sakuraTheme.primary",
    accent: "sakuraTheme.accent",
  }, `${label}: toastColorSource should persist theme palette origin`);
}

function messageEnd(content = "回复完成") {
  return { type: "message_end", message: { stopReason: "stop", content } };
}

function channelMessage(body, sender = "alice") {
  return {
    type: "channel_new_message",
    channelName: "general",
    sender,
    message: { body, timestamp: new Date(0).toISOString() },
  };
}

configure();

reset();
const directColorToast = plugin._decorateToastNotification({
  type: "conversation",
  title: "颜色来源测试",
  body: "auto theme should keep notification colors",
  primary: "#112233",
  accent: "#445566",
  sakuraTheme: "auto",
  autoDismissMotion: "click-burst",
  manualDismissMotion: "click-burst",
});
assert.equal(directColorToast.primary, "#112233", "auto theme should use notification primary color");
assert.equal(directColorToast.accent, "#445566", "auto theme should use notification accent color");
assert.deepEqual(directColorToast.meta?.toastColorSource, {
  primary: "notification.primary",
  accent: "notification.accent",
}, "toastColorSource should persist notification color origin when no theme palette is active");
assert.equal(directColorToast.autoDismissMotion, "drift", "decorated auto dismiss motion should reject click-only motion");
assert.equal(directColorToast.manualDismissMotion, "click-burst", "decorated manual dismiss motion should accept click-burst");

reset();
const publicToast = plugin.showCustomToast({
  type: "conversation",
  title: "公共入口测试",
  body: "showCustomToast should decorate and show",
  primary: "#112233",
  accent: "#445566",
  sakuraTheme: "auto",
}, { refreshConfig: false });
assert.equal(shown.length, 1, "showCustomToast(refreshConfig:false) should show one custom toast");
assert.strictEqual(shown[0], publicToast, "showCustomToast should show the same decorated object it returns");
assert.deepEqual(publicToast.meta?.toastColorSource, {
  primary: "notification.primary",
  accent: "notification.accent",
}, "showCustomToast should preserve decorated toastColorSource metadata");

reset();
configure({
  enableConversationNotification: true,
  notificationSoundTheme: "custom",
  customNotificationSoundPath: "  C:/sounds/custom.wav  ",
});
plugin._handleEvent(messageEnd("自定义提示音链路"), SESSION_PATH);
let customSoundToast = expectOnePopup("legacy custom conversation sound path");
assert.equal(customSoundToast.soundTheme, "custom", "legacy global custom sound theme should still feed conversation notifications");
assert.equal(customSoundToast.customSoundPath, "C:/sounds/custom.wav", "legacy global custom sound path should still feed conversation notifications");

reset();
configure({
  enableConversationNotification: true,
  notificationSoundTheme: "chime",
  customNotificationSoundPath: "C:/sounds/fallback.wav",
  conversationNotificationSoundTheme: "custom",
  conversationCustomNotificationSoundPath: "  C:/sounds/chat-only.mp3  ",
});
plugin._handleEvent(messageEnd("聊天独立自定义提示音"), SESSION_PATH);
customSoundToast = expectOnePopup("scoped custom conversation sound path");
assert.equal(customSoundToast.soundTheme, "custom", "conversation notifications should use the scoped conversation sound theme");
assert.equal(customSoundToast.customSoundPath, "C:/sounds/chat-only.mp3", "conversation notifications should use the scoped conversation custom sound path before the global fallback");

reset();
configure({
  enableStatusNotifications: true,
  enableErrorNotifications: true,
  notificationSoundTheme: "custom",
  customNotificationSoundPath: "D:/tones/error.mp3",
});
plugin._handleEvent({ type: "error", source: "check", error: "custom boom" }, SESSION_PATH);
customSoundToast = expectOnePopup("custom error sound path");
assert.equal(customSoundToast.soundTheme, "custom", "important status notifications should respect the custom sound theme");
assert.equal(customSoundToast.customSoundPath, "D:/tones/error.mp3", "important status notifications should carry the custom sound path");

reset();
const originalBuildRuntimeConfig = plugin._buildRuntimeConfig;
let buildCount = 0;
plugin._buildRuntimeConfig = function patchedBuildRuntimeConfig(config) {
  buildCount += 1;
  return originalBuildRuntimeConfig.call(this, config);
};
currentConfig = { ...baseConfig, notificationKeywords: "缓存测试" };
plugin._cfg = null;
plugin._lastRawConfigSnapshot = undefined;
plugin._refreshConfigNow();
assert.equal(buildCount, 1, "config snapshot cache should build on first refresh");
plugin._refreshConfigNow();
assert.equal(buildCount, 1, "config snapshot cache should skip unchanged config");
currentConfig = { ...currentConfig, notificationKeywords: "缓存测试, changed" };
plugin._refreshConfigNow();
assert.equal(buildCount, 2, "config snapshot cache should rebuild after config change");
plugin._buildRuntimeConfig = originalBuildRuntimeConfig;
configure();

reset();
configure({ enableConversationNotification: false });
plugin._handleEvent(messageEnd("禁用时不应弹出"), SESSION_PATH);
expectNoPopup("conversation disabled");

reset();
configure({ enableConversationNotification: true });
plugin._handleEvent(messageEnd("启用时应弹出"), SESSION_PATH);
let toast = expectOnePopup("conversation enabled");
assert.equal(toast.type, "conversation");
expectEmberPalette(toast, "conversation enabled");

reset();
configure({ enableConversationNotification: true });
plugin._handleEvent(messageEnd("子代理回复不应重复弹出"), "C:/HanaAgent/test-home/agents/hanako/subagent-sessions/direct/check.jsonl");
expectNoPopup("subagent session filtered");

reset();
configure({ enableConversationNotification: true });
plugin._handleEvent(messageEnd("手机桥接内部会话不应弹出"), "C:/HanaAgent/test-home/phone/sessions/check.jsonl");
expectNoPopup("phone session filtered");

reset();
configure({
  enableConversationNotification: true,
  enableKeywordImportance: true,
  notificationKeywords: "紧急, failure",
  importantNotificationSound: true,
});
plugin._handleEvent(messageEnd("这里有紧急情况需要看"), SESSION_PATH);
toast = expectOnePopup("keyword importance uses important sound setting");
assert.equal(toast.importance, "important");
assert.deepEqual(toast.matchedKeywords, ["紧急"]);
assert.equal(toast.sound, true, "important notification should use importantNotificationSound when its sound theme is not off");

reset();
configure({
  enableConversationNotification: true,
  enableKeywordImportance: true,
  notificationKeywords: "紧急",
  importantNotificationSound: false,
});
plugin._handleEvent(messageEnd("紧急但重要通知声音关闭"), SESSION_PATH);
toast = expectOnePopup("important sound disabled");
assert.equal(toast.importance, "important");
assert.equal(toast.sound, false, "importantNotificationSound=false should mute important notification");

reset();
configure({ enableChannelNotification: false, enableChannelAggregation: false });
plugin._handleEvent(channelMessage("频道禁用时不应弹出"), null);
expectNoPopup("channel disabled");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: false });
plugin._handleEvent(channelMessage("频道启用时应弹出"), null);
toast = expectOnePopup("channel enabled");
assert.equal(toast.type, "channel");
assert.equal(toast.meta.channelName, "general");
expectEmberPalette(toast, "channel enabled");

reset();
configure({
  enableChannelNotification: true,
  enableChannelAggregation: false,
  notificationSoundTheme: "chime",
  customNotificationSoundPath: "C:/sounds/fallback.wav",
  channelNotificationSoundTheme: "custom",
  channelCustomNotificationSoundPath: "  D:/sounds/channel-only.m4a  ",
});
plugin._handleEvent(channelMessage("频道独立自定义提示音"), null);
toast = expectOnePopup("scoped custom channel sound path");
assert.equal(toast.type, "channel");
assert.equal(toast.sound, true, "channel notifications should play unless the channel sound theme is off");
assert.equal(toast.soundTheme, "custom", "channel notifications should use the scoped channel sound theme");
assert.equal(toast.customSoundPath, "D:/sounds/channel-only.m4a", "channel notifications should use the scoped channel custom sound path before the global fallback");
expectEmberPalette(toast, "scoped custom channel sound path");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 2, channelAggregationWindowSeconds: 5 });
plugin._handleEvent(channelMessage("第一条普通频道消息"), null);
assert.equal(shown.length, 0, "channel aggregation: first item should be buffered");
assert.equal(records.length, 0, "channel aggregation: first item should not be recorded before flush");
plugin._handleEvent(channelMessage("第二条普通频道消息"), null);
toast = expectOnePopup("channel aggregate threshold reached");
assert.equal(toast.type, "channel");
assert.equal(toast.agentName, "频道摘要");
assert.equal(toast.meta.aggregate, true);
assert.equal(toast.meta.count, 2);
expectEmberPalette(toast, "channel aggregate threshold reached");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
plugin._handleEvent(channelMessage("关闭频道前的缓冲消息"), null);
assert.equal(plugin._channelAggregation.size, 1, "channel aggregation: pending item should be buffered before channel disable");
configure({ enableChannelNotification: false, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
assert.equal(plugin._channelAggregation.size, 0, "channel aggregation: disabling channel should clear pending items");
expectNoPopup("channel disable clears pending aggregation");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
plugin._handleEvent(channelMessage("节流窗口内关闭频道前的缓冲消息"), null);
assert.equal(plugin._channelAggregation.size, 1, "channel forced refresh: pending item should be buffered before external config change");
currentConfig = { ...baseConfig, enableChannelNotification: false, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 };
plugin._lastConfigRefresh = Date.now();
plugin._handleEvent(channelMessage("如果频道事件不强制刷新，这条会被错误聚合"), null);
assert.equal(plugin._channelAggregation.size, 0, "channel event should force-refresh and clear aggregation despite throttle window");
expectNoPopup("channel forced refresh clears pending aggregation");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
plugin._handleEvent(channelMessage("关闭聚合前的缓冲消息"), null);
assert.equal(plugin._channelAggregation.size, 1, "channel aggregation: pending item should be buffered before aggregation disable");
configure({ enableChannelNotification: true, enableChannelAggregation: false, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
toast = expectOnePopup("channel aggregation disable drains pending item");
assert.equal(toast.type, "channel");
assert.notEqual(toast.meta.aggregate, true);
expectEmberPalette(toast, "channel aggregation disable drains pending item");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
plugin._cfg.channelAggregationWindowMs = 10;
plugin._handleChannelMessage(channelMessage("定时器到期后应逐条发出"));
assert.equal(shown.length, 0, "channel aggregation timer: item should be buffered before timer fires");
await new Promise((resolve) => setTimeout(resolve, 30));
toast = expectOnePopup("channel aggregation timer flushes under-threshold item");
assert.equal(toast.type, "channel");
assert.notEqual(toast.meta.aggregate, true);
expectEmberPalette(toast, "channel aggregation timer flushes under-threshold item");

reset();
configure({ enableStatusNotifications: false, enableErrorNotifications: true });
plugin._handleEvent({ type: "error", source: "check", error: "boom" }, SESSION_PATH);
expectNoPopup("status master disabled");

reset();
configure({ enableStatusNotifications: true, enableErrorNotifications: false });
plugin._handleEvent({ type: "error", source: "check", error: "boom" }, SESSION_PATH);
expectNoPopup("error disabled");

reset();
configure({ enableStatusNotifications: true, enableErrorNotifications: true });
plugin._handleEvent({ type: "error", source: "check", error: "boom" }, SESSION_PATH);
toast = expectOnePopup("error enabled");
assert.equal(toast.type, "status");
assert.equal(toast.title, "运行错误");
assert.equal(toast.soundTheme, "alert");
expectEmberPalette(toast, "error enabled");

reset();
configure({ enableStatusNotifications: true, enableTaskDoneNotifications: false });
plugin._handleEvent({ type: "cron_job_done", label: "定时巡检" }, SESSION_PATH);
expectNoPopup("task done disabled");

reset();
configure({ enableStatusNotifications: true, enableTaskDoneNotifications: true });
plugin._handleEvent({ type: "cron_job_done", label: "定时巡检" }, SESSION_PATH);
toast = expectOnePopup("task done enabled");
assert.equal(toast.type, "status");
assert.equal(toast.title, "任务完成");
expectEmberPalette(toast, "task done enabled");

reset();
configure({ enableStatusNotifications: true, enableTaskDoneNotifications: true });
plugin._handleEvent({ type: "activity_update", activity: { label: "后台任务", status: "completed" } }, SESSION_PATH);
toast = expectOnePopup("activity done enabled");
assert.equal(toast.title, "任务完成");
expectEmberPalette(toast, "activity done enabled");

reset();
configure({ enableStatusNotifications: true, enableErrorNotifications: true });
plugin._handleEvent({ type: "activity_update", activity: { label: "后台任务", status: "failed", error: "bad" } }, SESSION_PATH);
toast = expectOnePopup("activity failure enabled");
assert.equal(toast.title, "任务失败");
expectEmberPalette(toast, "activity failure enabled");

reset();
configure({ enableStatusNotifications: true, enableErrorNotifications: true, enableTaskDoneNotifications: true });
plugin._handleEvent({ type: "activity_update", activity: { label: "后台任务", status: "running" } }, SESSION_PATH);
expectNoPopup("activity non-terminal status ignored");

clearAggregations();
console.log("notification type checks ok");
