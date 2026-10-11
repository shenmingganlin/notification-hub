import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import NotificationHubPlugin from "../index.js";
import { getSessionTitle } from "../lib/conversation-notification.js";
import { parseChannelFrontmatter, readChannelWithPowerShell, resolveChannel } from "../lib/channel-aggregation.js";
import { emitDecoratedDesktopNotification } from "../lib/notification-delivery.js";

const SESSION_PATH = "C:/HanaAgent/test-home/agents/hanako/sessions/check-notification-types.jsonl";

{
  const channelRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notification-hub-channel-"));
  const channelName = "ch_fixture";
  fs.writeFileSync(path.join(channelRoot, `${channelName}.md`), "---\nname: \"测试频道\" # display name\nid: ch_fixture\n---\n", "utf8");
  try {
    const info = await resolveChannel({
      _channelsDir: channelRoot,
      _channelCache: new Map(),
      ctx: { log: { warn() {} } },
    }, channelName);
    assert.equal(info.name, "测试频道", "channel frontmatter should resolve the display name instead of the file name");
    const raw = await readChannelWithPowerShell(path.join(channelRoot, `${channelName}.md`));
    assert.equal(parseChannelFrontmatter(raw, channelName).name, "测试频道", "PowerShell should read no-BOM UTF-8 channel frontmatter without mojibake");
  } finally {
    fs.rmSync(channelRoot, { recursive: true, force: true });
  }
}

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
  particleShape: "comet",
  entranceVisual: "drift-wake",
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
const hostNotificationCalls = [];

const plugin = new NotificationHubPlugin();
plugin.ctx = {
  log,
  notifications: { async show(payload) { hostNotificationCalls.push(payload); } },
  config: {
    getAll: () => ({ ...currentConfig }),
  },
  bus: {
    emit: (event, sessionPath) => emitted.push({ event, sessionPath }),
    async request(topic, options) {
      assert.equal(topic, "session:list");
      assert.deepEqual(options, { scope: "all", lifecycle: "all" });
      return { sessions: [{ sessionId: "sess_fixture_notification", path: SESSION_PATH, title: "测试会话", lifecycle: "active" }] };
    },
  },
};
plugin._conversationNotificationDedup = new Map();
plugin._activeToastIds = new Map();
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
let nextRecordId = 0;
plugin._store = {
  push(notification) {
    const record = {
      id: `record-${++nextRecordId}`,
      ts: Date.now(),
      ...notification,
    };
    records.push(record);
    return record;
  },
  upsert(notification, stableId) {
    const index = records.findIndex((record) => record.id === stableId);
    if (index < 0) return this.push({ ...notification, id: stableId });
    const record = { ...records[index], ...notification, id: records[index].id, ts: Date.now() };
    records[index] = record;
    return record;
  },
  recent(limit = 10) {
    return records.slice(-limit).reverse();
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
  plugin._conversationNotificationDedup.clear();
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

let messageSequence = 0;
function messageEnd(content = "回复完成") {
  return { type: "message_end", message: { role: "assistant", timestamp: Date.now(), responseId: `type-check-${++messageSequence}`, stopReason: "stop", content } };
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
await plugin._handleEvent(messageEnd("自定义提示音链路"), SESSION_PATH);
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
await plugin._handleEvent(messageEnd("聊天独立自定义提示音"), SESSION_PATH);
customSoundToast = expectOnePopup("scoped custom conversation sound path");
assert.equal(customSoundToast.soundTheme, "custom", "conversation notifications should use the scoped conversation sound theme");
assert.equal(customSoundToast.customSoundPath, "C:/sounds/chat-only.mp3", "conversation notifications should use the scoped conversation custom sound path before the global fallback");

reset();
configure({
  enableStatusNotifications: true,
  enableErrorNotifications: true,
  importantNotificationSoundTheme: "custom",
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
await plugin._handleEvent(messageEnd("禁用时不应弹出"), SESSION_PATH);
expectNoPopup("conversation disabled");

reset();
configure({ enableConversationNotification: true });
await plugin._handleEvent(messageEnd("启用时应弹出"), SESSION_PATH);
let toast = expectOnePopup("conversation enabled");
assert.equal(toast.type, "conversation");
assert.equal(records[0].source, SESSION_PATH, "conversation history should retain the original session path");
assert.equal(records[0].sourceLabel, "会话 · 测试会话", "conversation history should expose the session title as its source label");
assert.equal(records[0].meta.sourceKind, "reply", "conversation history should identify reply source kind");
assert.equal(records[0].meta.sessionTitle, "测试会话", "conversation history should retain the session title metadata");
assert.equal(records[0].meta.sessionId, "sess_fixture_notification", "conversation history should retain the host session id");
assert.equal(records[0].meta.replyExcerpt, "启用时应弹出", "conversation history should retain the reply excerpt");
assert.equal(records[0].meta.mergedCount, undefined, "the first conversation notification should not carry a merged count");
assert.doesNotMatch(records[0].sourceLabel, /[A-Za-z]:|[\\/]/, "conversation source label should not expose a path");
expectEmberPalette(toast, "conversation enabled");
assert.equal(hostNotificationCalls.length, 0, "conversation notifications should not call host notifications.show");

await plugin._handleEvent(messageEnd("同会话第二条正文"), SESSION_PATH);
assert.equal(records.length, 1, "same-session replies within 60 seconds should upsert one history record");
assert.equal(shown.length, 2, "same-session upsert should still show every toast");
assert.equal(records[0].body, "Hanako: 同会话第二条正文", "same-session upsert should refresh the record body");
assert.equal(records[0].meta.replyExcerpt, "同会话第二条正文", "same-session upsert should refresh the reply excerpt");
assert.equal(records[0].meta.mergedCount, 2, "same-session upsert should increment the merged count");

reset();
configure({ enableConversationMerge: false });
await plugin._handleEvent(messageEnd("关闭合并第一条"), SESSION_PATH);
await plugin._handleEvent(messageEnd("关闭合并第二条"), SESSION_PATH);
assert.equal(records.length, 2, "disabled merge should keep same-session replies within 60 seconds as separate history records");
assert.equal(shown.length, 2, "disabled merge should still show every toast");
assert.equal(records[0].meta.mergedCount, undefined, "disabled merge should not set mergedCount on the first record");
assert.equal(records[1].meta.mergedCount, undefined, "disabled merge should not set mergedCount on the second record");

reset();
await plugin._handleEvent(messageEnd("路径一"), SESSION_PATH);
await plugin._handleEvent(messageEnd("路径二"), "C:/HanaAgent/test-home/agents/hanako/sessions/other-session.jsonl");
assert.equal(records.length, 2, "different session paths should remain separate records");

reset();
await plugin._handleEvent(messageEnd("窗口内第一条"), SESSION_PATH);
records[0].ts = Date.now() - 61_000;
await plugin._handleEvent(messageEnd("窗口外第二条"), SESSION_PATH);
assert.equal(records.length, 2, "same-session replies older than 60 seconds should create a new record");
assert.equal(records[1].meta.mergedCount, undefined, "a new record outside the merge window should not inherit the merged count");

reset();
configure({ enableConversationNotification: true });
await plugin._handleEvent(messageEnd("子代理回复不应重复弹出"), "C:/HanaAgent/test-home/agents/hanako/subagent-sessions/direct/check.jsonl");
expectNoPopup("subagent session filtered");

reset();
configure({ enableConversationNotification: true });
await plugin._handleEvent(messageEnd("手机桥接内部会话不应弹出"), "C:/HanaAgent/test-home/phone/sessions/check.jsonl");
expectNoPopup("phone session filtered");

reset();
configure({
  enableConversationNotification: true,
  enableKeywordImportance: true,
  notificationKeywords: "紧急, failure",
  importantNotificationSound: true,
});
await plugin._handleEvent(messageEnd("这里有紧急情况需要看"), SESSION_PATH);
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
await plugin._handleEvent(messageEnd("紧急但重要通知声音关闭"), SESSION_PATH);
toast = expectOnePopup("important sound disabled");
assert.equal(toast.importance, "important");
assert.equal(toast.sound, false, "legacy false without an explicit theme should map to visible off");

for (const type of ["conversation", "channel"]) {
  reset();
  configure({ enableKeywordImportance: true, notificationKeywords: "紧急", importantNotificationSoundTheme: "off" });
  await plugin._handleEvent(type === "conversation" ? messageEnd("紧急关键词静音") : channelMessage("紧急关键词静音"), SESSION_PATH);
  const importantToast = expectOnePopup(`${type} important off`);
  assert.equal(importantToast.importance, "important");
  assert.equal(importantToast.sound, false);
  assert.equal(importantToast.soundTheme, "off");
}

reset();
configure({ importantNotificationSound: false, importantNotificationSoundTheme: "alert", enableKeywordImportance: true, notificationKeywords: "紧急" });
const dedupEvent = messageEnd("紧急重复入口");
await plugin._handleEvent(dedupEvent, SESSION_PATH);
await plugin._handleEvent({ type: "turn_end", message: dedupEvent.message }, SESSION_PATH);
toast = expectOnePopup("message_end and turn_end deduplicate the same assistant response");
assert.equal(toast.sound, true, "explicit theme can override retired boolean");

reset();
configure({ enableChannelNotification: false, enableChannelAggregation: false });
await plugin._handleEvent(channelMessage("频道禁用时不应弹出"), null);
expectNoPopup("channel disabled");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: false });
await plugin._handleEvent(channelMessage("频道启用时应弹出"), null);
toast = expectOnePopup("channel enabled");
assert.equal(toast.type, "channel");
assert.equal(toast.meta.channelName, "general");
assert.equal(records[0].source, "#general", "channel history should retain its #channel source");
assert.equal(records[0].sourceLabel, "频道 · 测试频道", "channel history should expose its display name as the source label");
assert.equal(records[0].meta.sourceKind, "channel", "channel history should identify channel source kind");
assert.equal(records[0].meta.channelDisplayName, "测试频道", "channel history should retain its display name metadata");
expectEmberPalette(toast, "channel enabled");
assert.equal(hostNotificationCalls.length, 0, "channel notifications should not call host notifications.show");

reset();
configure({
  enableChannelNotification: true,
  enableChannelAggregation: false,
  notificationSoundTheme: "chime",
  customNotificationSoundPath: "C:/sounds/fallback.wav",
  channelNotificationSoundTheme: "custom",
  channelCustomNotificationSoundPath: "  D:/sounds/channel-only.m4a  ",
});
await plugin._handleEvent(channelMessage("频道独立自定义提示音"), null);
toast = expectOnePopup("scoped custom channel sound path");
assert.equal(toast.type, "channel");
assert.equal(toast.sound, true, "channel notifications should play unless the channel sound theme is off");
assert.equal(toast.soundTheme, "custom", "channel notifications should use the scoped channel sound theme");
assert.equal(toast.customSoundPath, "D:/sounds/channel-only.m4a", "channel notifications should use the scoped channel custom sound path before the global fallback");
expectEmberPalette(toast, "scoped custom channel sound path");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 2, channelAggregationWindowSeconds: 5 });
await plugin._handleEvent(channelMessage("第一条普通频道消息"), null);
assert.equal(shown.length, 0, "channel aggregation: first item should be buffered");
assert.equal(records.length, 0, "channel aggregation: first item should not be recorded before flush");
await plugin._handleEvent(channelMessage("第二条普通频道消息"), null);
toast = expectOnePopup("channel aggregate threshold reached");
assert.equal(toast.type, "channel");
assert.equal(toast.agentName, "频道摘要");
assert.equal(toast.meta.aggregate, true);
assert.equal(toast.meta.count, 2);
assert.equal(records[0].source, "#general", "channel aggregate should retain the first #channel source");
assert.equal(records[0].sourceLabel, "频道 · 测试频道", "channel aggregate should expose the display name as the source label");
assert.equal(records[0].meta.sourceKind, "channel", "channel aggregate should identify channel source kind");
assert.equal(records[0].meta.channelName, "general", "channel aggregate should retain its channel name");
expectEmberPalette(toast, "channel aggregate threshold reached");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
await plugin._handleEvent(channelMessage("关闭频道前的缓冲消息"), null);
assert.equal(plugin._channelAggregation.size, 1, "channel aggregation: pending item should be buffered before channel disable");
configure({ enableChannelNotification: false, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
assert.equal(plugin._channelAggregation.size, 0, "channel aggregation: disabling channel should clear pending items");
expectNoPopup("channel disable clears pending aggregation");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
await plugin._handleEvent(channelMessage("节流窗口内关闭频道前的缓冲消息"), null);
assert.equal(plugin._channelAggregation.size, 1, "channel forced refresh: pending item should be buffered before external config change");
currentConfig = { ...baseConfig, enableChannelNotification: false, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 };
plugin._lastConfigRefresh = Date.now();
await plugin._handleEvent(channelMessage("如果频道事件不强制刷新，这条会被错误聚合"), null);
assert.equal(plugin._channelAggregation.size, 0, "channel event should force-refresh and clear aggregation despite throttle window");
expectNoPopup("channel forced refresh clears pending aggregation");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
await plugin._handleEvent(channelMessage("关闭聚合前的缓冲消息"), null);
assert.equal(plugin._channelAggregation.size, 1, "channel aggregation: pending item should be buffered before aggregation disable");
configure({ enableChannelNotification: true, enableChannelAggregation: false, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
toast = expectOnePopup("channel aggregation disable drains pending item");
assert.equal(toast.type, "channel");
assert.notEqual(toast.meta.aggregate, true);
expectEmberPalette(toast, "channel aggregation disable drains pending item");

reset();
configure({ enableChannelNotification: true, enableChannelAggregation: true, channelAggregationThreshold: 3, channelAggregationWindowSeconds: 5 });
plugin._cfg.channelAggregationWindowMs = 10;
await plugin._handleChannelMessage(channelMessage("定时器到期后应逐条发出"));
assert.equal(shown.length, 0, "channel aggregation timer: item should be buffered before timer fires");
await new Promise((resolve) => setTimeout(resolve, 30));
toast = expectOnePopup("channel aggregation timer flushes under-threshold item");
assert.equal(toast.type, "channel");
assert.notEqual(toast.meta.aggregate, true);
expectEmberPalette(toast, "channel aggregation timer flushes under-threshold item");

reset();
configure({ enableStatusNotifications: false, enableErrorNotifications: true });
plugin._handleEvent({ type: "error", source: "check", error: "boom" }, SESSION_PATH);
toast = expectOnePopup("error ignores the status switch");
assert.equal(toast.title, "运行错误");

reset();
configure({ enableStatusNotifications: false, enableTaskDoneNotifications: true });
plugin._handleEvent({ type: "cron_job_done", label: "定时巡检" }, SESSION_PATH);
toast = expectOnePopup("task done ignores the status switch");
assert.equal(toast.title, "任务完成");

reset();
configure({ enableStatusNotifications: false, notificationDisplayMode: "custom" });
plugin._handleEvent({ type: "notification", title: "转发", body: "不应弹出", source: "engine" }, SESSION_PATH);
expectNoPopup("status switch disables relayed status notices");

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

reset();
configure({ quietHoursEnabled: true, quietHoursStart: "00:00", quietHoursEnd: "23:59" });
plugin._now = () => new Date(2026, 9, 7, 15, 0, 0);
await plugin._handleEvent(messageEnd("免打扰仍要记账"), SESSION_PATH);
assert.equal(shown.length, 0, "quiet hours should suppress the popup");
assert.equal(records.length, 1, "quiet hours should still record the notification");
plugin._now = () => new Date();

reset();
configure({ mutedSessionKeys: `session:${SESSION_PATH.toLowerCase()}` });
await plugin._handleEvent(messageEnd("静音会话"), SESSION_PATH);
assert.equal(shown.length, 0, "a muted session should suppress the popup");
assert.equal(records.length, 1, "a muted session should still record the notification");

reset();
configure({ mutedSessionKeys: "channel:town" });
await plugin._handleEvent({ type: "channel_new_message", channelName: "town", sender: "alice", message: { body: "hi" } }, SESSION_PATH);
assert.equal(shown.length, 0, "a muted channel should suppress the popup");
assert.equal(records.length, 1, "a muted channel should still record the notification");

reset();
const syncGetAll = plugin.ctx.config.getAll;
plugin.ctx.config.getAll = () => Promise.resolve({ ...currentConfig, autoDismissMotion: "bubble-rise" });
const pendingToast = plugin.showCustomToast({
  type: "conversation",
  title: "晚到的配置",
  body: "async config should decorate after refresh",
});
assert.equal(shown.length, 0, "async config should hold the toast until the read resolves");
assert.equal(typeof pendingToast.then, "function", "async config should return a promise");
const lateToast = await pendingToast;
assert.equal(shown.length, 1, "async config should show one toast after refresh");
assert.strictEqual(shown[0], lateToast, "async showCustomToast should show the decorated object it resolves");
assert.equal(lateToast.autoDismissMotion, "bubble-rise", "async config should decorate with the refreshed motion, not the previous one");
plugin.ctx.config.getAll = syncGetAll;
configure();

clearAggregations();

const titleTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notification-hub-session-title-"));
try {
  const noBusDir = path.join(titleTestRoot, "without-bus", "sessions");
  fs.mkdirSync(noBusDir, { recursive: true });
  const noBusPath = path.join(noBusDir, "no-bus.jsonl");
  fs.writeFileSync(path.join(noBusDir, "session-titles.json"), JSON.stringify({ [noBusPath.replace(/\\/g, "/")]: "Ignored file title" }), "utf8");
  assert.equal(await getSessionTitle({ ctx: {} }, noBusPath), null, "session title lookup should not use files when bus is unavailable");

  let sessionListRequests = 0;
  const archivedPath = path.join(titleTestRoot, "archived", "sessions", "archived-session.jsonl");
  const bus = {
    async request(topic, options) {
      sessionListRequests += 1;
      assert.equal(topic, "session:list");
      assert.deepEqual(options, { scope: "all", lifecycle: "all" });
      return { sessions: [{ sessionId: "sess_fixture_archived", path: archivedPath, title: "归档标题", lifecycle: "archived" }] };
    },
  };
  const activePath = path.join(titleTestRoot, "active", "sessions", "archived-session.jsonl");
  const archivedPlugin = { ctx: { bus } };
  const archivedTitle = await getSessionTitle(archivedPlugin, activePath);
  assert.equal(archivedTitle, "归档标题", "host session list should resolve archived sessions by matching filename");

  const secondWrapperTitle = await getSessionTitle({ ctx: { bus } }, activePath);
  assert.equal(secondWrapperTitle, "归档标题", "different plugin wrappers should share session list cache by bus");
  assert.equal(sessionListRequests, 1, "wrappers sharing a bus should reuse one session list request");

  const replacementBus = {
    async request(topic, options) {
      sessionListRequests += 1;
      assert.equal(topic, "session:list");
      assert.deepEqual(options, { scope: "all", lifecycle: "all" });
      return { sessions: [{ sessionId: "sess_fixture_archived", path: archivedPath, title: "归档标题", lifecycle: "archived" }] };
    },
  };
  const replacementBusTitle = await getSessionTitle({ ctx: { bus: replacementBus } }, activePath);
  assert.equal(replacementBusTitle, "归档标题", "a different bus should query its own session list");
  assert.equal(sessionListRequests, 2, "replacing the bus should make one new session list request");
} finally {
  fs.rmSync(titleTestRoot, { recursive: true, force: true });
}

{
  const shown = [];
  const deliveryPlugin = {
    _cfg: { displayMode: "custom" },
    _popupBlockReason: () => "",
    ctx: { log: { info() {}, warn() {} } },
    _customToast: { show(notification) { shown.push(notification); } },
  };
  emitDecoratedDesktopNotification(deliveryPlugin, {
    title: "自定义投递",
    body: "custom body",
    emoji: "🌸",
  });
  assert.equal(shown.length, 1, "custom delivery should show one custom toast");

  const legacyModePlugin = {
    ...deliveryPlugin,
    _cfg: { displayMode: "native" },
    ctx: {
      notifications: { show() { assert.fail("legacy native mode must not call host notifications"); } },
      log: { info() {}, warn() {} },
    },
  };
  emitDecoratedDesktopNotification(legacyModePlugin, { title: "旧配置", body: "仍走自定义弹窗" });
  assert.equal(shown.length, 2, "legacy native mode should still show a custom toast");
}

console.log("notification type checks ok");
