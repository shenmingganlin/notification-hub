import fs from "node:fs";
import path from "node:path";
import { CustomToast } from "../lib/custom-toast.js";
import {
  intValue,
  isQuietHours,
  normalizeMuteKey,
  normalizeSettings,
  parseMutedSessionKeys,
  reconcileCustomSoundPathInheritance,
  sanitizeSettingsPayload,
  sanitizeVisualPreviewPayload,
} from "../lib/notification-config.js";
import { readHostConfig, updateHostConfig } from "../lib/host-config.js";
import { readNotificationRecords, writeNotificationRecords } from "../lib/notification-store.js";
import { decorateToastNotification } from "../lib/delivery/toast-decoration.js";
import { decideNotificationSound } from "../lib/sound/sound-decision.js";
import { resolveScopedSound } from "../lib/sound/sound-resolver.js";
import { pickSoundFile } from "../lib/sound/windows-sound-picker.js";
import { visualCatalog } from "../lib/effect-registry.js";
import { getSessionInfo } from "../lib/conversation-notification.js";
import { resolveChannel } from "../lib/channel-aggregation.js";

export default function (app, ctx) {
  app.get("/records", async (c) => {
    let settings;
    try { settings = normalizeSettings(await readHostConfig(ctx)); }
    catch (err) { return c.json({ ok: false, error: `设置读取失败: ${err.message}` }, 503); }
    const limit = settings.notificationCenterLimit;
    let storage = ctx._notificationStore?.storageStatus?.() || { ok: true };
    let records;
    try { records = readNotificationRecords(ctx.dataDir).slice(-limit).reverse(); }
    catch (err) {
      storage = { ok: false, error: err.message };
      records = ctx._notificationStore?.recent?.(limit) || [];
    }
    records = records.map(record => ({ ...record }));
    const titlePlugin = { ctx };
    const channelPlugin = {
      ctx,
      _channelsDir: ctx._channelsDir || path.resolve(ctx.pluginDir || "", "../../channels"),
      _channelCache: new Map(),
    };
    for (const record of records) {
      if (record.type === "channel") {
        const channelName = String(record.meta?.channelName || record.source || "").replace(/^#/, "");
        if (!channelName) continue;
        const channelInfo = await resolveChannel(channelPlugin, channelName);
        const displayName = String(channelInfo?.name || "").trim();
        if (!displayName) continue;
        if (record.sourceLabel === channelName || record.sourceLabel === `频道 · ${channelName}`) {
          record.sourceLabel = `频道 · ${displayName}`;
        }
        if (record.title === channelName) record.title = displayName;
        if (!record.meta || record.meta.channelDisplayName !== displayName) {
          record.meta = { ...(record.meta || {}), channelDisplayName: displayName };
        }
        continue;
      }
      if (record.type !== "conversation") continue;
      const meta = record.meta || {};
      const existingTitle = String(meta.sessionTitle || "").trim();
      const isUnnamed = record.sourceLabel?.includes("未命名会话");
      const hasSessionId = Boolean(String(meta.sessionId || "").trim());
      if (!isUnnamed && existingTitle && hasSessionId) continue;

      const sessionInfo = await getSessionInfo(titlePlugin, record.source);
      const resolvedTitle = existingTitle || String(sessionInfo?.title || "").trim();
      if (isUnnamed && resolvedTitle) record.sourceLabel = `会话 · ${resolvedTitle}`;

      const updatedMeta = { ...meta };
      let metaChanged = false;
      if (!existingTitle && sessionInfo?.title && String(sessionInfo.title).trim()) {
        updatedMeta.sessionTitle = String(sessionInfo.title).trim();
        metaChanged = true;
      }
      if (sessionInfo?.sessionId && String(sessionInfo.sessionId).trim()) {
        updatedMeta.sessionId = String(sessionInfo.sessionId).trim();
        metaChanged = true;
      }
      if (metaChanged) record.meta = updatedMeta;
    }
    const latestClick = readLatestClick(ctx.dataDir);
    return c.json({
      ok: storage.ok,
      storage,
      records,
      stats: buildStats(records),
      max: limit,
      latestClick,
      mutedSessionKeys: parseMutedSessionKeys(settings.mutedSessionKeys),
    });
  });

  app.post("/mute", async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const key = normalizeMuteKey(body.key);
    if (!key) return c.json({ ok: false, error: "mute key required" });
    try {
      const saved = await updateHostConfig(ctx, (raw) => {
        const current = new Set(parseMutedSessionKeys(raw.mutedSessionKeys));
        if (body.muted === false) current.delete(key);
        else {
          if (!current.has(key) && current.size >= 200) {
            const err = new Error("静音来源已达 200 项上限，请先移除一项");
            err.mutedSessionKeys = [...current];
            throw err;
          }
          current.add(key);
        }
        return { mutedSessionKeys: parseMutedSessionKeys([...current]).join("\n") };
      });
      return c.json({ ok: true, mutedSessionKeys: parseMutedSessionKeys(saved.mutedSessionKeys) });
    } catch (err) {
      return c.json({ ok: false, error: err.message, ...(err.mutedSessionKeys ? { mutedSessionKeys: err.mutedSessionKeys } : {}) });
    }
  });

  app.post("/clear", async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch { body = {}; }
    if (body.confirm !== true) {
      return c.json({ ok: false, error: "confirm required" });
    }
    try {
      clearRecords(ctx);
      return c.json({ ok: true });
    } catch (err) { return c.json({ ok: false, error: err.message }); }
  });

  // 读取当前配置
  app.get("/settings", async (c) => {
    try { return c.json(normalizeSettings(await readHostConfig(ctx))); }
    catch (err) { return c.json({ ok: false, error: err.message }, 503); }
  });

  app.get("/visual-catalog", (c) => c.json(visualCatalog()));

  app.post("/pick-sound", async (c) => {
    try {
      let body = {};
      try { body = await c.req.json(); } catch { body = {}; }
      const result = await pickSoundFile({
        target: body.target,
        initialPath: body.currentPath,
        dataDir: ctx.dataDir,
        log: ctx.log,
      });
      return c.json(result);
    } catch (err) {
      ctx.log?.warn?.("notification-hub sound picker failed:", err?.message || err);
      return c.json({ ok: false, error: err?.message || "sound picker failed" });
    }
  });

  app.post("/test-notification", async (c) => {
    try {
      const savedConfig = await readHostConfig(ctx);
      let body = {};
      try { body = await c.req.json(); } catch { body = {}; }
      const preview = body && body.preview === true;
      const previewUpdates = preview ? reconcileCustomSoundPathInheritance(sanitizeSettingsPayload(body), savedConfig) : {};
      const config = preview ? normalizeSettings({ ...savedConfig, ...previewUpdates }) : normalizeSettings(savedConfig);
      const testType = preview ? sanitizePreviewTestType(body.testType) : "conversation";
      const visual = preview ? sanitizeVisualPreviewPayload(body) : {};
      const count = preview ? intValue(body.count, 1, 1, 10) : 1;
      if (isQuietHours(config)) {
        return c.json({ ok: true, displayed: false, status: "suppressed", message: "免打扰开着，测试没有弹窗" });
      }
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const notifications = buildPreviewNotifications({ testType, count, config, visual, requestId, preview });
      ctx.log?.info?.(`[notification-hub] test-notification requestId=${requestId} preview=${preview} testType=${testType} count=${count} notifications=${notifications.length} source=${preview ? "settings-preview" : "settings-test"} visual=${JSON.stringify(visual)}`);
      const mode = config.notificationDisplayMode;
      if (mode === "off") return c.json({ ok: true, displayed: false, status: "suppressed", message: "当前是只记录，测试没有弹窗" });

      const toast = ctx._customToast || new CustomToast({ pluginDir: ctx.pluginDir, dataDir: ctx.dataDir, log: ctx.log, physicsPreset: visual.physicsPreset || config.physicsPreset, toastTransportMode: visual.toastTransportMode || config.toastTransportMode, autoParticleCountScale: visual.autoParticleCountScale || config.autoParticleCountScale, manualParticleCountScale: visual.manualParticleCountScale || config.manualParticleCountScale, particleSizeScale: visual.particleSizeScale || config.particleSizeScale, particleIntervalEffect: visual.particleIntervalEffect ?? config.particleIntervalEffect, cardExitMode: visual.cardExitMode || config.cardExitMode, cardExitFade: visual.cardExitFade !== undefined ? visual.cardExitFade : config.cardExitFade });
      const results = await Promise.all(notifications.map((baseNotification) => {
        // Use the preview's effective settings, not a stale runtime snapshot.
        const notification = decorateToastNotification(baseNotification, config);
        return toast.showConfirmed?.(notification) || { status: "failed", error: "自定义弹窗确认入口不可用" };
      }));
      const displayedCount = results.filter(result => result?.status === "shown").length;
      const failed = results.find(result => result?.status !== "shown");
      if (failed) return c.json({ ok: false, displayed: false, displayedCount, status: failed.status || "failed", error: failed.error || "显示未确认；为避免重复弹窗和声音，没有重发" });
      return c.json({ ok: true, displayed: true, displayedCount, status: "shown", message: preview ? previewResultMessage(testType, count) : "测试弹窗已显示" });
    } catch (err) {
      ctx.log?.warn?.("notification-hub test notification failed:", err?.message || err);
      return c.json({ ok: false, displayed: false, status: "failed", error: err?.message || "test failed" });
    }
  });

  // 保存配置
  app.post("/settings", async (c) => {
    try {
      const body = await c.req.json();
      if (typeof body !== "object" || !body) {
        return c.json({ ok: false, error: "invalid payload" });
      }
      const runtimeConfigSnapshot = await updateHostConfig(ctx, (raw) =>
        reconcileCustomSoundPathInheritance(sanitizeSettingsPayload(body), raw));
      const saved = normalizeSettings(runtimeConfigSnapshot);
      ctx.log?.info?.("notification-hub settings updated:", Object.keys(body).join(", "));
      return c.json({ ok: true, settings: saved });
    } catch (err) {
      ctx.log?.warn?.("notification-hub settings save failed:", err?.message || err);
      return c.json({ ok: false, error: err?.message || "save failed" });
    }
  });
}

function sanitizePreviewTestType(value) {
  const type = String(value || "conversation").trim();
  return ["conversation", "channel", "channel-aggregate", "status", "error", "task-done"].includes(type)
    ? type
    : "conversation";
}

function buildPreviewNotifications({ testType, count, config, visual, requestId, preview }) {
  const sourcePrefix = preview ? `settings-preview-${requestId}` : "settings-test";
  const scopedSound = (type) => resolveScopedSound(config, type);
  const conversationSound = scopedSound("conversation");
  const channelSound = scopedSound("channel");
  const withVisual = (notification) => ({
    ...scopedSound(notification?.type),
    ...notification,
    ...visual,
  });

  if (testType === "channel") {
    return Array.from({ length: count }, (_, i) => withVisual({
      type: "channel",
      title: "测试频道",
      body: count > 1 ? `频道成员: 这是第 ${i + 1}/${count} 条频道消息预览。` : "频道成员: 这是一条频道消息预览。",
      agentId: "preview-channel-member",
      agentName: "频道成员",
      emoji: "💬",
      primary: "#10a37f",
      accent: "#74b9ff",
      importance: "low",
      matchedKeywords: [],
      sound: i === 0 && channelSound.soundTheme !== "off",
      source: "#settings-preview-channel",
      meta: {
        channelId: "settings-preview-channel",
        channelName: "settings-preview-channel",
        channelDisplayName: "测试频道",
        preview: true,
      },
    }));
  }

  if (testType === "channel-aggregate") {
    const aggregateCount = intValue(config.channelAggregationThreshold, 4, 2, 50);
    return [withVisual({
      type: "channel",
      title: "测试频道",
      body: `测试频道 有 ${aggregateCount} 条新消息\n频道成员：第一条普通消息 / 第二条普通消息 / 第三条普通消息`,
      agentId: "notification-hub",
      agentName: "频道摘要",
      emoji: "💬",
      primary: "#10a37f",
      accent: "#74b9ff",
      importance: "normal",
      matchedKeywords: [],
      sound: false,
      source: "#settings-preview-channel",
      meta: {
        aggregate: true,
        count: aggregateCount,
        channelId: "settings-preview-channel",
        channelName: "settings-preview-channel",
        channelDisplayName: "测试频道",
        senders: ["频道成员"],
        preview: true,
      },
    })];
  }

  if (testType === "status") {
    return [withVisual({
      type: "status",
      title: "状态提醒",
      body: "后台活动状态更新示例。",
      agentId: "notification-hub",
      agentName: "状态监控",
      emoji: "ℹ️",
      primary: "#10a37f",
      accent: "#74b9ff",
      importance: "normal",
      matchedKeywords: [],
      sound: false,
      source: `${sourcePrefix}-status`,
      meta: { eventType: "preview_status", preview: true },
    })];
  }

  if (testType === "error") {
    const sound = decideNotificationSound(config, { type: "status", importance: "important" });
    return [withVisual({
      type: "status",
      title: "运行错误",
      body: "设置页预览: 这是错误/失败通知示例。",
      agentId: "notification-hub",
      agentName: "状态警报",
      emoji: "⚠️",
      primary: "#ff7675",
      accent: "#fdcb6e",
      importance: "important",
      matchedKeywords: [],
      sound: sound.enabled,
      soundTheme: sound.soundTheme,
      customSoundPath: sound.customSoundPath,
      source: `${sourcePrefix}-error`,
      meta: { eventType: "preview_error", preview: true },
    })];
  }

  if (testType === "task-done") {
    return [withVisual({
      type: "status",
      title: "任务完成",
      body: "设置页预览任务 已完成。",
      agentId: "notification-hub",
      agentName: "状态监控",
      emoji: "✅",
      primary: "#10a37f",
      accent: "#74b9ff",
      importance: "normal",
      matchedKeywords: [],
      sound: false,
      source: `${sourcePrefix}-task-done`,
      meta: { eventType: "preview_task_done", preview: true },
    })];
  }

  return Array.from({ length: count }, (_, i) => withVisual({
    type: "conversation",
    title: count > 1 ? `测试通知 ${i + 1}/${count}` : "测试通知",
    body: count > 1 ? "这是一组来自设置页的瞬发连发测试。" : "这是一条来自设置页的测试通知。",
    agentId: "notification-hub",
    agentName: "通知中心",
    emoji: "🔔",
    primary: "#9b7cff",
    accent: "#74b9ff",
    importance: "normal",
    matchedKeywords: [],
    sound: i === 0 && conversationSound.soundTheme !== "off",
    source: preview ? `${sourcePrefix}-conversation-${i + 1}` : "settings-test",
    meta: { preview: true },
  }));
}

function previewResultMessage(testType, count) {
  const labels = {
    conversation: count > 1 ? `已瞬发 ${count} 条对话预览弹窗` : "已预览对话结束通知",
    channel: count > 1 ? `已瞬发 ${count} 条频道预览弹窗` : "已预览频道消息通知",
    "channel-aggregate": "已预览频道聚合摘要",
    status: "已预览状态监控通知",
    error: "已预览错误/失败通知",
    "task-done": "已预览任务完成通知",
  };
  return labels[testType] || "已按当前页面选项预览弹窗";
}

function clearRecords(ctx) {
  if (ctx._notificationStore?.clear) {
    ctx._notificationStore.clear();
    return;
  }
  writeNotificationRecords(ctx.dataDir, []);
}

function readLatestClick(dataDir) {
  const file = path.join(dataDir, "notification-clicks.jsonl");
  let fd;
  try {
    fd = fs.openSync(file, "r");
    let position = fs.fstatSync(fd).size;
    let tail = Buffer.alloc(0);
    while (position > 0) {
      const size = Math.min(position, 4096);
      position -= size;
      const chunk = Buffer.allocUnsafe(size);
      const bytesRead = fs.readSync(fd, chunk, 0, size, position);
      if (!bytesRead) break;
      tail = Buffer.concat([chunk.subarray(0, bytesRead), tail]);
      let last = tail.length - 1;
      while (last >= 0 && (tail[last] === 10 || tail[last] === 13)) last--;
      if (last < 0) continue;
      const start = tail.lastIndexOf(10, last);
      if (start >= 0 || position === 0) {
        return JSON.parse(tail.subarray(start + 1, last + 1).toString("utf8").replace(/^\uFEFF/, ""));
      }
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}

function buildStats(records) {
  return {
    total: records.length,
    conversation: records.filter((r) => r.type === "conversation").length,
    channel: records.filter((r) => r.type === "channel").length,
    status: records.filter((r) => r.type === "status").length,
    important: records.filter((r) => r.importance === "important" || r.importance === "urgent").length,
  };
}
