import fs from "node:fs";
import path from "node:path";
import { CustomToast } from "../lib/custom-toast.js";
import { TOAST_EFFECTS, VISUAL_COMBO_PACKS, resolvePanelTheme } from "../lib/effect-registry.js";
import {
  intValue,
  normalizeSettings,
  normalizeWidgetConfig,
  reconcileCustomSoundPathInheritance,
  sanitizeSettingsPayload,
  sanitizeVisualPreviewPayload,
} from "../lib/notification-config.js";
import { resolveScopedSound } from "../lib/sound/sound-resolver.js";
import { pickSoundFile } from "../lib/sound/windows-sound-picker.js";

const MAX_WIDGET_ITEMS = 30;
const DEFAULT_PLUGIN_ID = "notification-hub";

export default function (app, ctx) {
  app.get("/widget", (c) => {
    const hanaCss = c.req.query("hana-css") || "";
    const token = c.req.query("token") || "";
    const config = normalizeWidgetConfig(readConfig(ctx));

    return c.html(renderWidget({
      hanaCss,
      token,
      pluginId: ctx.pluginId || DEFAULT_PLUGIN_ID,
      config,
    }));
  });

  app.get("/records", (c) => {
    const records = readRecords(ctx.dataDir).slice(-MAX_WIDGET_ITEMS).reverse();
    const latestClick = readClickRecords(ctx.dataDir).slice(-1)[0] || null;
    return c.json({ records, stats: buildStats(records), max: MAX_WIDGET_ITEMS, latestClick });
  });

  app.get("/clicks/latest", (c) => {
    const latestClick = readClickRecords(ctx.dataDir).slice(-1)[0] || null;
    return c.json({ latestClick });
  });

  app.post("/clear", async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch { body = {}; }
    if (body.confirm !== true) {
      return c.json({ ok: false, error: "confirm required" });
    }
    clearRecords(ctx);
    return c.json({ ok: true });
  });

  // 读取当前配置
  app.get("/settings", (c) => {
    return c.json(normalizeSettings(readConfig(ctx)));
  });

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
      const savedConfig = readConfig(ctx);
      let body = {};
      try { body = await c.req.json(); } catch { body = {}; }
      const preview = body && body.preview === true;
      const previewUpdates = preview ? reconcileCustomSoundPathInheritance(sanitizeSettingsPayload(body), savedConfig) : {};
      const config = preview ? normalizeSettings({ ...savedConfig, ...previewUpdates }) : normalizeSettings(savedConfig);
      const testType = preview ? sanitizePreviewTestType(body.testType) : "conversation";
      const visual = preview ? sanitizeVisualPreviewPayload(body) : {};
      const count = preview ? intValue(body.count, 1, 1, 10) : 1;
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const notifications = buildPreviewNotifications({ testType, count, config, visual, requestId, preview });
      ctx.log?.info?.(`[notification-hub] test-notification requestId=${requestId} preview=${preview} testType=${testType} count=${count} notifications=${notifications.length} source=${preview ? "settings-preview" : "settings-test"} visual=${JSON.stringify(visual)}`);
      const toast = ctx._customToast || new CustomToast({ pluginDir: ctx.pluginDir, dataDir: ctx.dataDir, log: ctx.log, physicsPreset: visual.physicsPreset || config.physicsPreset, toastTransportMode: visual.toastTransportMode || config.toastTransportMode, autoParticleCountScale: visual.autoParticleCountScale || config.autoParticleCountScale, manualParticleCountScale: visual.manualParticleCountScale || config.manualParticleCountScale, particleSizeScale: visual.particleSizeScale || config.particleSizeScale, particleIntervalEffect: visual.particleIntervalEffect ?? config.particleIntervalEffect });
      for (const baseNotification of notifications) {
        const notification = ctx._notificationHubPlugin?._decorateToastNotification
          ? ctx._notificationHubPlugin._decorateToastNotification(baseNotification)
          : baseNotification;
        toast.show(notification);
      }
      if (preview) return c.json({ ok: true, message: previewResultMessage(testType, count) });
      return c.json({ ok: true, message: "已发送测试弹窗" });
    } catch (err) {
      ctx.log?.warn?.("notification-hub test notification failed:", err?.message || err);
      return c.json({ ok: false, error: err?.message || "test failed" });
    }
  });

  // 保存配置
  app.post("/settings", async (c) => {
    try {
      const body = await c.req.json();
      if (typeof body !== "object" || !body) {
        return c.json({ ok: false, error: "invalid payload" });
      }
      const previousConfig = readConfig(ctx);
      const updates = reconcileCustomSoundPathInheritance(sanitizeSettingsPayload(body), previousConfig);
      if (ctx.config?.setMany) {
        ctx.config.setMany(updates);
      } else if (ctx.config?.set) {
        for (const [key, value] of Object.entries(updates)) {
          ctx.config.set(key, value);
        }
      } else {
        return c.json({ ok: false, error: "plugin config API unavailable" });
      }
      const runtimeConfigSnapshot = { ...previousConfig, ...updates };
      const plugin = ctx._notificationHubPlugin;
      if (plugin?.applySettingsUpdates) {
        plugin.applySettingsUpdates(previousConfig, updates);
      } else if (plugin?.applyRuntimeConfigSnapshot) {
        plugin.applyRuntimeConfigSnapshot(runtimeConfigSnapshot);
      } else {
        plugin?._refreshConfigNow?.();
      }
      const saved = normalizeSettings(runtimeConfigSnapshot);
      ctx.log?.info?.("notification-hub settings updated:", Object.keys(updates).join(", "));
      return c.json({ ok: true, settings: saved });
    } catch (err) {
      ctx.log?.warn?.("notification-hub settings save failed:", err?.message || err);
      return c.json({ ok: false, error: err?.message || "save failed" });
    }
  });
}

function readConfig(ctx) {
  try {
    if (ctx.config?.getAll) return ctx.config.getAll() || {};
    if (ctx.config?.get) return ctx.config.get() || {};
  } catch (err) {
    ctx.log?.warn?.("notification-hub read config failed:", err?.message || err);
  }
  return ctx.config && typeof ctx.config === "object" ? ctx.config : {};
}

function sanitizePreviewTestType(value) {
  const type = String(value || "conversation").trim();
  return ["conversation", "channel", "channel-aggregate", "status", "error", "task-done"].includes(type)
    ? type
    : "conversation";
}

function buildPreviewNotifications({ testType, count, config, visual, requestId, preview }) {
  const sourcePrefix = preview ? `settings-preview-${requestId}` : "settings-test";
  const fallbackSoundTheme = config.notificationSoundTheme || "chime";
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
      sound: config.importantNotificationSound && fallbackSoundTheme !== "off",
      soundTheme: fallbackSoundTheme === "custom" ? "custom" : "alert",
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
  try {
    if (ctx._notificationStore?.clear) {
      ctx._notificationStore.clear();
      return;
    }
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.dataDir, "notifications.jsonl"), "", "utf-8");
  } catch (err) {
    ctx.log?.warn?.("notification-hub clear failed:", err?.message || err);
  }
}

function readRecords(dataDir) {
  return readJsonl(path.join(dataDir, "notifications.jsonl"));
}

function readClickRecords(dataDir) {
  return readJsonl(path.join(dataDir, "notification-clicks.jsonl"));
}

function readJsonl(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line.replace(/^\uFEFF/, "")); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
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

function renderWidget({ hanaCss, token, pluginId, config }) {
  const apiBase = `/api/plugins/${pluginId}`;
  const visualComboPacks = VISUAL_COMBO_PACKS;
  const effectOptions = TOAST_EFFECTS;
  const htmlClasses = [
    `theme-${config.theme}`,
    `panel-theme-${config.panelTheme}`,
    `density-${config.density}`,
    `preset-${config.preset}`,
    config.sourceTint ? "source-tint-on" : "source-tint-off",
  ].join(" ");

  return `<!doctype html>
<html lang="zh-CN" class="${escAttr(htmlClasses)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
${hanaCss ? `<link rel="stylesheet" href="${escAttr(hanaCss)}">` : ""}
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    color-scheme: light;
    --nh-scale: .72;
    --nh-bg: #fbf1df;
    --nh-bg-2: #fff8ed;
    --nh-surface: rgba(255, 255, 255, .48);
    --nh-surface-hover: rgba(255, 255, 255, .66);
    --nh-border: rgba(128, 91, 50, .18);
    --nh-border-soft: rgba(128, 91, 50, .10);
    --nh-text: #342c26;
    --nh-muted: rgba(62, 51, 41, .64);
    --nh-muted-2: rgba(62, 51, 41, .50);
    --nh-accent-1: #84653e;
    --nh-accent-2: #d2a76b;
    --nh-shadow: rgba(100, 68, 32, .18);
    --nh-btn: rgba(255, 255, 255, .38);
  }
  .density-spacious { --nh-scale: .76; }
  .density-large { --nh-scale: .88; }
  .density-huge { --nh-scale: 1; }
  .theme-dark {
    color-scheme: dark;
    --nh-bg: #101217;
    --nh-bg-2: #191c25;
    --nh-surface: rgba(255, 255, 255, .075);
    --nh-surface-hover: rgba(255, 255, 255, .12);
    --nh-border: rgba(226, 232, 255, .14);
    --nh-border-soft: rgba(226, 232, 255, .08);
    --nh-text: rgba(246, 246, 250, .94);
    --nh-muted: rgba(221, 225, 239, .66);
    --nh-muted-2: rgba(221, 225, 239, .48);
    --nh-accent-1: #5f6fe7;
    --nh-accent-2: #c19cff;
    --nh-shadow: rgba(0, 0, 0, .36);
    --nh-btn: rgba(255, 255, 255, .08);
  }
  .panel-theme-classic { --nh-accent-1: #84653e; --nh-accent-2: #d2a76b; }
  .panel-theme-minimal { --nh-bg: #f7f7f5; --nh-bg-2: #ffffff; --nh-surface: rgba(255,255,255,.70); --nh-surface-hover: rgba(255,255,255,.88); --nh-border: rgba(34,34,34,.12); --nh-border-soft: rgba(34,34,34,.08); --nh-accent-1: #475569; --nh-accent-2: #94a3b8; --nh-shadow: rgba(15,23,42,.10); }
  .panel-theme-glass { --nh-bg: #edf7ff; --nh-bg-2: #fff7fb; --nh-surface: rgba(255,255,255,.42); --nh-surface-hover: rgba(255,255,255,.62); --nh-border: rgba(116,185,255,.22); --nh-border-soft: rgba(155,124,255,.14); --nh-accent-1: #7c8cff; --nh-accent-2: #ff9ecf; --nh-shadow: rgba(96,120,210,.18); --nh-btn: rgba(255,255,255,.34); }
  .panel-theme-tech { --nh-bg: #071018; --nh-bg-2: #111827; --nh-surface: rgba(64,245,200,.075); --nh-surface-hover: rgba(64,245,200,.12); --nh-border: rgba(64,245,200,.22); --nh-border-soft: rgba(122,167,255,.12); --nh-accent-1: #40f5c8; --nh-accent-2: #7aa7ff; --nh-shadow: rgba(0,0,0,.42); --nh-btn: rgba(64,245,200,.08); }
  .panel-theme-aurora { --nh-bg: #eef7ff; --nh-bg-2: #fff5fb; --nh-surface: rgba(255,255,255,.50); --nh-surface-hover: rgba(255,255,255,.70); --nh-border: rgba(116,185,255,.22); --nh-border-soft: rgba(162,155,254,.14); --nh-accent-1: #6c8cff; --nh-accent-2: #ff9bd2; --nh-shadow: rgba(90,120,200,.16); }
  .panel-theme-sakura-storm { --nh-bg: #fff0f7; --nh-bg-2: #fff8fb; --nh-surface: rgba(255,255,255,.56); --nh-surface-hover: rgba(255,255,255,.76); --nh-border: rgba(255,79,159,.20); --nh-border-soft: rgba(255,79,159,.12); --nh-accent-1: #ff4f9f; --nh-accent-2: #ffd1e8; --nh-shadow: rgba(214,60,130,.16); }
  .panel-theme-obsidian { --nh-bg: #0d0c0a; --nh-bg-2: #1a1712; --nh-surface: rgba(255,214,138,.07); --nh-surface-hover: rgba(255,214,138,.12); --nh-border: rgba(255,214,138,.20); --nh-border-soft: rgba(255,214,138,.11); --nh-accent-1: #d6a84f; --nh-accent-2: #fff0a6; --nh-shadow: rgba(0,0,0,.46); --nh-btn: rgba(255,214,138,.08); }
  .panel-theme-hologram { --nh-bg: #101124; --nh-bg-2: #171b34; --nh-surface: rgba(140,170,255,.085); --nh-surface-hover: rgba(140,170,255,.13); --nh-border: rgba(150,220,255,.20); --nh-border-soft: rgba(215,183,255,.12); --nh-accent-1: #8ea7ff; --nh-accent-2: #7df3ff; --nh-shadow: rgba(0,0,0,.40); --nh-btn: rgba(140,170,255,.08); }
  .panel-theme-paper { --nh-bg: #f4ead8; --nh-bg-2: #fffaf0; --nh-surface: rgba(255,252,244,.62); --nh-surface-hover: rgba(255,252,244,.82); --nh-border: rgba(139,92,45,.16); --nh-border-soft: rgba(139,92,45,.10); --nh-accent-1: #8a6240; --nh-accent-2: #d7a86e; --nh-shadow: rgba(116,78,38,.15); }
  .panel-theme-ember { --nh-bg: #170d09; --nh-bg-2: #25120b; --nh-surface: rgba(255,122,24,.08); --nh-surface-hover: rgba(255,122,24,.13); --nh-border: rgba(255,209,102,.22); --nh-border-soft: rgba(255,122,24,.13); --nh-accent-1: #ff7a18; --nh-accent-2: #ffd166; --nh-shadow: rgba(0,0,0,.44); --nh-btn: rgba(255,122,24,.09); }
  .panel-theme-moonlight { --nh-bg: #0d1020; --nh-bg-2: #171b35; --nh-surface: rgba(142,167,255,.08); --nh-surface-hover: rgba(215,183,255,.13); --nh-border: rgba(215,183,255,.18); --nh-border-soft: rgba(142,167,255,.12); --nh-accent-1: #8ea7ff; --nh-accent-2: #d7b7ff; --nh-shadow: rgba(0,0,0,.42); --nh-btn: rgba(142,167,255,.08); }
  @media (prefers-color-scheme: dark) {
    .theme-auto {
      color-scheme: dark;
      --nh-bg: #101217;
      --nh-bg-2: #191c25;
      --nh-surface: rgba(255, 255, 255, .075);
      --nh-surface-hover: rgba(255, 255, 255, .12);
      --nh-border: rgba(226, 232, 255, .14);
      --nh-border-soft: rgba(226, 232, 255, .08);
      --nh-text: rgba(246, 246, 250, .94);
      --nh-muted: rgba(221, 225, 239, .66);
      --nh-muted-2: rgba(221, 225, 239, .48);
      --nh-accent-1: #5f6fe7;
      --nh-accent-2: #c19cff;
      --nh-shadow: rgba(0, 0, 0, .36);
      --nh-btn: rgba(255, 255, 255, .08);
    }
  }

  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body {
    font-family: Inter, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    color: var(--nh-text);
    background:
      radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--nh-accent-2) 22%, transparent), transparent 36%),
      radial-gradient(circle at 100% 20%, color-mix(in srgb, var(--nh-accent-1) 15%, transparent), transparent 38%),
      linear-gradient(145deg, var(--nh-bg-2), var(--nh-bg));
    user-select: none;
    text-rendering: geometricPrecision;
    -webkit-font-smoothing: antialiased;
    display: flex;
    flex-direction: column;
    min-width: 220px;
  }

  /* ───── Shell & Header ───── */
  .shell { height: 100%; display: flex; flex-direction: column; min-width: 260px; }
  .header {
    display: flex; align-items: center; justify-content: space-between; gap: calc(10px * var(--nh-scale));
    padding: calc(12px * var(--nh-scale)) calc(13px * var(--nh-scale)) calc(10px * var(--nh-scale));
    border-bottom: 1px solid var(--nh-border-soft);
    flex: 0 0 auto;
    cursor: default;
  }
  .title { display: flex; align-items: center; gap: calc(10px * var(--nh-scale)); min-width: 0; }
  .badge {
    width: calc(34px * var(--nh-scale)); height: calc(34px * var(--nh-scale)); border-radius: calc(12px * var(--nh-scale));
    display: inline-flex; align-items: center; justify-content: center;
    font-weight: 850; font-size: calc(17px * var(--nh-scale));
    color: #fff;
    background: linear-gradient(135deg, var(--nh-accent-1), var(--nh-accent-2));
    box-shadow: 0 8px 22px var(--nh-shadow), inset 0 0 0 1px rgba(255,255,255,.24);
    flex: 0 0 auto;
  }
  .heading { min-width: 0; }
  .heading strong { display: block; font-size: calc(16px * var(--nh-scale)); line-height: 1.14; letter-spacing: .03em; }
  .heading span { display: block; margin-top: 3px; font-size: calc(12px * var(--nh-scale)); color: var(--nh-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .actions { display: flex; align-items: center; gap: calc(5px * var(--nh-scale)); flex: 0 0 auto; }
  .btn {
    border: 1px solid var(--nh-border);
    background: var(--nh-btn);
    color: var(--nh-muted);
    border-radius: calc(9px * var(--nh-scale));
    height: calc(30px * var(--nh-scale));
    padding: 0 calc(9px * var(--nh-scale));
    font: inherit;
    font-size: calc(12px * var(--nh-scale));
    font-weight: 560;
    cursor: pointer;
  }
  .btn:hover { background: var(--nh-surface-hover); color: var(--nh-text); }
  .btn:disabled { opacity: .55; cursor: default; }
  .btn.active {
    background: color-mix(in srgb, var(--nh-accent-1) 20%, var(--nh-btn));
    color: var(--nh-accent-1);
    border-color: color-mix(in srgb, var(--nh-accent-1) 40%, var(--nh-border));
  }
  .status { font-size: calc(10px * var(--nh-scale)); color: var(--nh-muted-2); min-width: calc(24px * var(--nh-scale)); text-align: right; }

  /* ───── Tab Navigation ───── */
  .tabs {
    display: flex; gap: 0; padding: calc(6px * var(--nh-scale)) calc(13px * var(--nh-scale));
    border-bottom: 1px solid var(--nh-border-soft);
    flex: 0 0 auto;
  }
  .tab {
    flex: 1;
    text-align: center;
    padding: calc(8px * var(--nh-scale)) calc(6px * var(--nh-scale));
    border-radius: calc(10px * var(--nh-scale)) calc(10px * var(--nh-scale)) 0 0;
    font-size: calc(13px * var(--nh-scale));
    font-weight: 600;
    color: var(--nh-muted);
    cursor: pointer;
    transition: all .15s ease;
    border: 1px solid transparent;
    border-bottom: none;
    margin-bottom: -1px;
  }
  .tab:hover { color: var(--nh-text); background: var(--nh-surface); }
  .tab.active {
    color: var(--nh-accent-1);
    background: var(--nh-surface);
    border-color: var(--nh-border-soft);
    position: relative;
  }
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--nh-accent-1);
    border-radius: 2px 2px 0 0;
  }

  /* ───── Tab Content ───── */
  .tab-content { display: none; flex: 1 1 auto; min-height: 0; flex-direction: column; }
  .tab-content.active { display: flex; }

  /* ───── Stats / Filters ───── */
  .stats {
    display: flex; gap: calc(7px * var(--nh-scale)); padding: calc(9px * var(--nh-scale)) calc(13px * var(--nh-scale));
    border-bottom: 1px solid var(--nh-border-soft);
    flex: 0 0 auto;
    flex-wrap: wrap;
  }
  .pill {
    border-radius: 999px; padding: calc(4px * var(--nh-scale)) calc(9px * var(--nh-scale));
    background: var(--nh-surface);
    color: var(--nh-muted);
    border: 1px solid var(--nh-border-soft);
    font-size: calc(12px * var(--nh-scale));
    white-space: nowrap;
    cursor: pointer;
    transition: all .12s ease;
  }
  .pill:hover { background: var(--nh-surface-hover); color: var(--nh-text); }
  .pill.active {
    background: color-mix(in srgb, var(--nh-accent-1) 18%, var(--nh-surface));
    color: var(--nh-accent-1);
    border-color: color-mix(in srgb, var(--nh-accent-1) 40%, var(--nh-border));
  }

  /* ───── Notification List ───── */
  .list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: calc(8px * var(--nh-scale)) calc(10px * var(--nh-scale)) calc(12px * var(--nh-scale)); }
  .list::-webkit-scrollbar { width: 7px; }
  .list::-webkit-scrollbar-thumb { border-radius: 999px; background: var(--nh-border); }
  .item {
    display: grid; grid-template-columns: calc(38px * var(--nh-scale)) 1fr; gap: calc(10px * var(--nh-scale));
    padding: calc(11px * var(--nh-scale)) calc(10px * var(--nh-scale));
    border-radius: calc(15px * var(--nh-scale));
    background: var(--nh-surface);
    border: 1px solid var(--nh-border-soft);
    margin-bottom: calc(9px * var(--nh-scale));
    box-shadow: 0 5px 16px color-mix(in srgb, var(--nh-shadow) 55%, transparent);
  }
  .item:hover { background: var(--nh-surface-hover); }
  .item.important {
    border-color: color-mix(in srgb, #e74c3c 50%, var(--nh-border));
    background: color-mix(in srgb, var(--nh-surface) 92%, #e74c3c 8%);
  }
  .source-tint-on .item.type-conversation {
    border-color: color-mix(in srgb, #9b7cff 42%, var(--nh-border));
    background: color-mix(in srgb, var(--nh-surface) 90%, #9b7cff 10%);
  }
  .source-tint-on .item.type-channel {
    border-color: color-mix(in srgb, #10b981 42%, var(--nh-border));
    background: color-mix(in srgb, var(--nh-surface) 90%, #10b981 10%);
  }
  .source-tint-on .item.type-status {
    border-color: color-mix(in srgb, #f59e0b 42%, var(--nh-border));
    background: color-mix(in srgb, var(--nh-surface) 90%, #f59e0b 10%);
  }
  .source-tint-on .item.type-conversation .imp-tag { background: #8b5cf6; }
  .source-tint-on .item.type-channel .imp-tag { background: #059669; }
  .source-tint-on .item.type-status .imp-tag { background: #d97706; }
  .item.highlight {
    border-color: color-mix(in srgb, var(--nh-accent-2) 72%, var(--nh-border));
    background: color-mix(in srgb, var(--nh-surface-hover) 86%, var(--nh-accent-2) 14%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--nh-accent-2) 38%, transparent), 0 9px 24px var(--nh-shadow);
  }
  .avatar {
    width: calc(38px * var(--nh-scale)); height: calc(38px * var(--nh-scale)); border-radius: calc(13px * var(--nh-scale));
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: calc(19px * var(--nh-scale)); font-weight: 800;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.22), 0 5px 14px rgba(0,0,0,.14);
    position: relative;
  }
  .avatar .badge-important {
    position: absolute; top: -3px; right: -3px;
    width: calc(14px * var(--nh-scale)); height: calc(14px * var(--nh-scale));
    border-radius: 50%;
    background: #e74c3c;
    box-shadow: 0 0 0 2px var(--nh-bg);
  }
  .content { min-width: 0; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: calc(5px * var(--nh-scale)); }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: calc(14px * var(--nh-scale)); font-weight: 720; line-height: 1.2; display: flex; align-items: center; gap: calc(5px * var(--nh-scale)); }
  .name .imp-tag {
    font-size: calc(9px * var(--nh-scale));
    padding: 1px calc(5px * var(--nh-scale));
    border-radius: 999px;
    background: #e74c3c;
    color: #fff;
    font-weight: 700;
    flex: 0 0 auto;
  }
  .time { flex: 0 0 auto; font-size: calc(12px * var(--nh-scale)); color: var(--nh-muted-2); }
  .body { font-size: calc(13px * var(--nh-scale)); line-height: 1.55; color: var(--nh-text); word-break: break-word; }
  .source { margin-top: calc(6px * var(--nh-scale)); font-size: calc(11px * var(--nh-scale)); color: var(--nh-muted-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { height: 100%; min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px 18px; color: var(--nh-muted); }
  .emptyIcon { width: calc(58px * var(--nh-scale)); height: calc(58px * var(--nh-scale)); border-radius: calc(20px * var(--nh-scale)); display: flex; align-items: center; justify-content: center; margin-bottom: calc(14px * var(--nh-scale)); color: #fff; font-size: calc(22px * var(--nh-scale)); font-weight: 850; background: linear-gradient(135deg, var(--nh-accent-1), var(--nh-accent-2)); box-shadow: 0 10px 26px var(--nh-shadow); }
  .emptyTitle { font-size: calc(16px * var(--nh-scale)); font-weight: 720; color: var(--nh-text); margin-bottom: 6px; }
  .emptyText { font-size: calc(13px * var(--nh-scale)); line-height: 1.6; max-width: 240px; }

  /* ───── Settings Tab ───── */
  .settings-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: calc(8px * var(--nh-scale)) calc(13px * var(--nh-scale)) calc(16px * var(--nh-scale)); }
  .settings-scroll::-webkit-scrollbar { width: 7px; }
  .settings-scroll::-webkit-scrollbar-thumb { border-radius: 999px; background: var(--nh-border); }
  .setting-group { margin-bottom: calc(14px * var(--nh-scale)); }
  .setting-group-title {
    font-size: calc(14px * var(--nh-scale)); font-weight: 720;
    margin-bottom: calc(8px * var(--nh-scale));
    color: var(--nh-text);
    display: flex; align-items: center; gap: calc(6px * var(--nh-scale));
  }
  .setting-group-title .sg-icon {
    width: calc(26px * var(--nh-scale)); height: calc(26px * var(--nh-scale));
    border-radius: calc(8px * var(--nh-scale));
    display: inline-flex; align-items: center; justify-content: center;
    font-size: calc(15px * var(--nh-scale));
    background: color-mix(in srgb, var(--nh-accent-1) 18%, var(--nh-surface));
  }
  .setting-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: calc(9px * var(--nh-scale)) calc(10px * var(--nh-scale));
    border-radius: calc(11px * var(--nh-scale));
    background: var(--nh-surface);
    border: 1px solid var(--nh-border-soft);
    margin-bottom: calc(6px * var(--nh-scale));
    gap: calc(8px * var(--nh-scale));
  }
  .setting-label { font-size: calc(13px * var(--nh-scale)); font-weight: 560; min-width: 0; flex: 1; }
  .setting-label .hint { display: block; font-size: calc(11px * var(--nh-scale)); color: var(--nh-muted-2); font-weight: 400; margin-top: 2px; }
  /* Toggle switch */
  .toggle {
    position: relative; flex: 0 0 auto;
    width: calc(42px * var(--nh-scale)); height: calc(24px * var(--nh-scale));
    border-radius: 999px;
    background: var(--nh-border);
    cursor: pointer;
    transition: background .15s ease;
  }
  .toggle.on { background: var(--nh-accent-1); }
  .toggle .knob {
    position: absolute; top: 2px; left: 2px;
    width: calc(20px * var(--nh-scale)); height: calc(20px * var(--nh-scale));
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,.2);
    transition: left .15s ease;
  }
  .toggle.on .knob { left: calc(20px * var(--nh-scale)); }
  /* Select dropdown */
  .select-wrap {
    position: relative; flex: 0 0 auto;
  }
  .select-wrap select {
    appearance: none;
    padding: calc(5px * var(--nh-scale)) calc(28px * var(--nh-scale)) calc(5px * var(--nh-scale)) calc(10px * var(--nh-scale));
    border-radius: calc(8px * var(--nh-scale));
    border: 1px solid var(--nh-border);
    background: var(--nh-btn);
    color: var(--nh-text);
    font: inherit;
    font-size: calc(12px * var(--nh-scale));
    cursor: pointer;
    min-width: calc(80px * var(--nh-scale));
  }
  .select-wrap::after {
    content: '▼';
    position: absolute; right: calc(8px * var(--nh-scale)); top: 50%;
    transform: translateY(-50%);
    font-size: calc(9px * var(--nh-scale));
    color: var(--nh-muted);
    pointer-events: none;
  }
  /* Input */
  .setting-input {
    width: 100%;
    padding: calc(8px * var(--nh-scale)) calc(10px * var(--nh-scale));
    border-radius: calc(10px * var(--nh-scale));
    border: 1px solid var(--nh-border);
    background: var(--nh-surface);
    color: var(--nh-text);
    font: inherit;
    font-size: calc(12px * var(--nh-scale));
    resize: vertical;
    min-height: calc(50px * var(--nh-scale));
  }
  .setting-input:focus { outline: none; border-color: var(--nh-accent-1); }
  .save-feedback {
    text-align: center;
    font-size: calc(12px * var(--nh-scale));
    padding: calc(6px * var(--nh-scale));
    border-radius: calc(8px * var(--nh-scale));
    margin-top: calc(8px * var(--nh-scale));
    display: none;
  }
  .save-feedback.show { display: block; }
  .save-feedback.success { color: #27ae60; background: color-mix(in srgb, #27ae60 12%, transparent); }
  .save-feedback.error { color: #e74c3c; background: color-mix(in srgb, #e74c3c 12%, transparent); }

  /* ───── Settings form control fixes ───── */
  .select-wrap select,
  .setting-input,
  details summary {
    color: var(--nh-text);
    background: color-mix(in srgb, var(--nh-surface) 80%, transparent);
    border-color: var(--nh-border);
  }
  .select-wrap select:focus,
  .setting-input:focus {
    border-color: var(--nh-accent-1);
    outline: none;
  }
  .setting-input::placeholder {
    color: var(--nh-muted-2);
  }
  .select-wrap select option {
    background: var(--nh-bg-2);
    color: var(--nh-text);
  }
</style>
</head>
<body>
  <div class="shell">
    <header class="header">
      <div class="title">
        <div class="badge">通</div>
        <div class="heading">
          <strong>通知中心</strong>
          <span id="subtitle">${themeLabel(config)}</span>
        </div>
      </div>
      <div class="actions">
        <span class="status" id="status"></span>
      </div>
    </header>

    <div class="tabs" id="tab-bar">
      <div class="tab active" data-tab="notifications">📋 通知中心</div>
      <div class="tab" data-tab="settings">⚙️ 设置</div>
    </div>

    <!-- Tab 1: Notifications -->
    <div class="tab-content active" id="tab-notifications">
      <div class="stats" id="filter-bar">
        <span class="pill active" data-filter="all">全部</span>
        <span class="pill" data-filter="conversation">对话</span>
        <span class="pill" data-filter="channel">频道</span>
        <span class="pill" data-filter="status">状态</span>
        <span class="pill" data-filter="important">⭐ 重要</span>
        <span class="pill" id="stat-count">0 条</span>
        <span style="flex:1"></span>
        <span style="cursor:pointer;font-size:calc(12px*var(--nh-scale));color:var(--nh-muted-2);padding:calc(4px * var(--nh-scale)) calc(6px * var(--nh-scale))" id="btn-clear" title="清空通知">清</span>
      </div>
      <main class="list" id="list"></main>
    </div>

    <!-- Tab 2: Settings -->
    <div class="tab-content" id="tab-settings">
      <div class="settings-scroll">
        <div id="settings-form"></div>
      </div>
    </div>
  </div>
<script>
(function() {
  "use strict";

  var API = ${JSON.stringify(apiBase)};
  var TOKEN = ${JSON.stringify(token)};
  var VISUAL_COMBO_PACKS = ${JSON.stringify(visualComboPacks)};
  var EFFECT_OPTIONS = ${JSON.stringify(effectOptions)};
  var latestClick = null;
  var allRecords = [];
  var currentFilter = "all";

  if (TOKEN) {
    var _origFetch = window.fetch.bind(window);
    window.fetch = function(url, opts) {
      opts = opts || {};
      opts.headers = opts.headers || {};
      opts.headers["Authorization"] = "Bearer " + TOKEN;
      return _origFetch(url, opts);
    };
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escAttr(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function formatTime(ts) {
    var d = new Date(Number(ts) || Date.now());
    return pad(d.getMonth()+1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function sanitizeColor(value) {
    if (typeof value !== "string") return "#8b6f47";
    if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
    if (/^rgba?\([0-9.,%\s]+\)$/.test(value)) return value;
    return "#8b6f47";
  }

  function setStatus(text) {
    var el = document.getElementById("status");
    if (el) el.textContent = text;
  }

  function notifyResize() {
    if (notifyResize._pending) return;
    notifyResize._pending = true;
    requestAnimationFrame(function() {
      notifyResize._pending = false;
      var h = document.body.scrollHeight;
      if (h === notifyResize._lastH) return;
      notifyResize._lastH = h;
      parent.postMessage({ type: "resize-request", payload: { height: h } }, "*");
    });
  }
  notifyResize._pending = false;
  notifyResize._lastH = 0;

  function renderRecord(record) {
    var emoji = record.emoji || (record.type === "channel" ? "#" : record.type === "status" ? "ℹ️" : "通");
    var color = sanitizeColor(record.primary);
    var title = record.title || record.agentName || "通知";
    var body = record.body || "";
    var source = record.source || "";
    var isImp = record.importance === "important" || record.importance === "urgent";
    var impBadge = isImp ? '<span class="imp-tag">重要</span>' : '';
    var highlight = '';
    if (latestClick && record.id && latestClick.notificationId === record.id) highlight = ' highlight';
    var typeClass = ' type-' + (record.type || 'notification');
    return '<article class="item' + typeClass + (isImp ? ' important' : '') + highlight + '" data-id="' + escAttr(record.id || '') + '">'
      + '<div class="avatar" style="background:' + escAttr(color) + '">' + esc(emoji) + '</div>'
      + '<div class="content">'
      + '<div class="top"><div class="name">' + esc(title) + impBadge + '</div><div class="time">' + esc(formatTime(record.ts)) + '</div></div>'
      + '<div class="body">' + esc(body) + '</div>'
      + (source ? '<div class="source">' + esc(source) + '</div>' : '')
      + '</div></article>';
  }

  function renderEmpty() {
    return '<div class="empty"><div class="emptyIcon">通</div><div class="emptyTitle">还没有通知</div><div class="emptyText">Agent 回复完成或频道有新消息时，会出现在这里。</div></div>';
  }

  function renderEmptyFilter() {
    return '<div class="empty"><div class="emptyIcon">🔍</div><div class="emptyTitle">没有匹配的通知</div><div class="emptyText">尝试切换筛选条件查看全部通知。</div></div>';
  }

  function applyFilter() {
    var filtered = allRecords;
    if (currentFilter === "conversation") filtered = allRecords.filter(function(r) { return r.type === "conversation"; });
    else if (currentFilter === "channel") filtered = allRecords.filter(function(r) { return r.type === "channel"; });
    else if (currentFilter === "status") filtered = allRecords.filter(function(r) { return r.type === "status"; });
    else if (currentFilter === "important") filtered = allRecords.filter(function(r) { return r.importance === "important" || r.importance === "urgent"; });

    var listEl = document.getElementById("list");
    listEl.innerHTML = filtered.length ? filtered.map(renderRecord).join("") : (currentFilter === "all" ? renderEmpty() : renderEmptyFilter());
    document.getElementById("stat-count").textContent = filtered.length + " 条";
    notifyResize();
  }

  async function loadRecords() {
    setStatus("加载中...");
    try {
      var res = await fetch(API + "/records");
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      allRecords = data.records || [];
      latestClick = data.latestClick || latestClick;
      applyFilter();
      setStatus("");
    } catch (e) {
      document.getElementById("list").innerHTML = '<div class="empty"><div class="emptyTitle">加载失败</div><div class="emptyText">' + esc(e && e.message ? e.message : e) + '</div></div>';
      setStatus("");
    }
  }

  // Settings
  async function loadSettings() {
    var formEl = document.getElementById("settings-form");
    formEl.innerHTML = '<div class="empty" style="min-height:100px"><div class="emptyText">加载设置...</div></div>';
    try {
      var res = await fetch(API + "/settings");
      if (!res.ok) throw new Error("HTTP " + res.status);
      var cfg = await res.json();
      formEl.innerHTML = renderSettingsForm(cfg);
      bindSettingsEvents();
      notifyResize();
    } catch (e) {
      formEl.innerHTML = '<div class="empty" style="min-height:100px"><div class="emptyText">设置加载失败: ' + esc(e.message) + '</div></div>';
    }
  }

  function input(key, label, hint, type, value, opts) {
    if (type === "toggle") {
      return '<div class="setting-row"><div class="setting-label">' + esc(label) + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div><div class="toggle' + (value ? ' on' : '') + '" data-key="' + escAttr(key) + '"><div class="knob"></div></div></div>';
    }
    if (type === "select") {
      var options = (opts || []).map(function(o) {
        return '<option value="' + escAttr(o.value) + '"' + (value === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('');
      return '<div class="setting-row"><div class="setting-label">' + esc(label) + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div><div class="select-wrap" data-key="' + escAttr(key) + '"><select>' + options + '</select></div></div>';
    }
    if (type === "textarea") {
      return '<div class="setting-row" style="flex-wrap:wrap"><div class="setting-label" style="width:100%;margin-bottom:6px">' + esc(label) + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div><textarea class="setting-input" data-key="' + escAttr(key) + '">' + esc(value || '') + '</textarea></div>';
    }
    if (type === "text") {
      return '<div class="setting-row" style="flex-wrap:wrap"><div class="setting-label" style="width:100%;margin-bottom:6px">' + esc(label) + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div><input class="setting-input" type="text" data-key="' + escAttr(key) + '" value="' + escAttr(value || '') + '"></div>';
    }
    if (type === "soundPath") {
      var target = opts && opts.target ? opts.target : "status";
      return '<div class="setting-row" style="flex-wrap:wrap"><div class="setting-label" style="width:100%;margin-bottom:6px">' + esc(label) + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div><div style="display:grid;grid-template-columns:1fr auto;gap:calc(8px * var(--nh-scale));width:100%;align-items:center"><input class="setting-input" type="text" data-key="' + escAttr(key) + '" value="' + escAttr(value || '') + '"><button type="button" class="btn sound-picker" data-key="' + escAttr(key) + '" data-target="' + escAttr(target) + '" style="height:calc(34px * var(--nh-scale));padding:0 calc(10px * var(--nh-scale));font-size:calc(12px * var(--nh-scale));white-space:nowrap">📁 选择</button></div></div>';
    }
    if (type === "range") {
      var min = opts && opts.min != null ? Number(opts.min) : 0;
      var max = opts && opts.max != null ? Number(opts.max) : 3;
      var step = opts && opts.step != null ? Number(opts.step) : 0.1;
      var num = Number(value);
      if (!Number.isFinite(num)) num = opts && opts.defaultValue != null ? Number(opts.defaultValue) : 1;
      num = Math.min(max, Math.max(min, Math.round(num * 100) / 100));
      return '<div class="setting-row" style="flex-wrap:wrap"><div class="setting-label" style="width:100%;margin-bottom:6px">' + esc(label) + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div><div class="range-wrap" data-key="' + escAttr(key) + '" style="display:grid;grid-template-columns:1fr calc(72px * var(--nh-scale));gap:calc(8px * var(--nh-scale));align-items:center;width:100%"><input type="range" min="' + escAttr(min) + '" max="' + escAttr(max) + '" step="' + escAttr(step) + '" value="' + escAttr(num) + '"><input class="setting-input" type="number" min="' + escAttr(min) + '" max="' + escAttr(max) + '" step="' + escAttr(step) + '" value="' + escAttr(num) + '" style="height:calc(34px * var(--nh-scale));padding:0 calc(8px * var(--nh-scale));text-align:center"></div></div>';
    }
    return '';
  }

  function optionList(group) {
    return (EFFECT_OPTIONS[group] || []).map(function(o) { return { value: o.id, label: o.label }; });
  }

  function renderSettingsForm(cfg) {
    return ''
      // Delivery Basics
      + '<div class="setting-group"><div class="setting-group-title"><span class="sg-icon">🔔</span> 通知方式</div>'
      + input('notificationDisplayMode', '显示方式', '选择通知出现在哪里：自定义弹窗、Windows 原生通知，或只记录到通知中心。', 'select', cfg.notificationDisplayMode, [
        { value: 'custom', label: '自定义弹窗' },
        { value: 'native', label: 'Windows 原生通知' },
        { value: 'off', label: '仅记录到列表' },
      ])
      + input('enableConversationNotification', '对话结束通知', 'Agent 回复完成时弹窗', 'toggle', cfg.enableConversationNotification)
      + input('enableChannelNotification', '频道消息通知', '频道里有新消息时弹窗', 'toggle', cfg.enableChannelNotification)
      + input('enableStatusNotifications', '状态监控通知', '后台任务、定时任务提醒', 'toggle', cfg.enableStatusNotifications)
      + input('enableErrorNotifications', '错误/失败通知', '运行异常或失败时弹窗', 'toggle', cfg.enableErrorNotifications)
      + input('enableTaskDoneNotifications', '任务完成通知', '后台任务或定时任务完成时弹窗，默认关闭避免刷屏', 'toggle', cfg.enableTaskDoneNotifications)
      + '</div>'
      // Sound
      + '<div class="setting-group"><div class="setting-group-title"><span class="sg-icon">🔊</span> 提示音</div>'
      + input('conversationNotificationSoundTheme', '聊天提示音', '聊天通知使用的提示音。选择“静音”即可关闭聊天提示音。', 'select', cfg.conversationNotificationSoundTheme, optionList('soundThemes'))
      + input('conversationCustomNotificationSoundPath', '聊天自定义声音', '聊天提示音选择“自定义声音”时使用。支持 wav、mp3、m4a、aac、wma。', 'soundPath', cfg.conversationCustomNotificationSoundPath, { target: 'conversation' })
      + input('channelNotificationSoundTheme', '频道提示音', '频道通知使用的提示音。选择“静音”即可关闭频道提示音。', 'select', cfg.channelNotificationSoundTheme, optionList('soundThemes'))
      + input('channelCustomNotificationSoundPath', '频道自定义声音', '频道提示音选择“自定义声音”时使用。支持 wav、mp3、m4a、aac、wma。', 'soundPath', cfg.channelCustomNotificationSoundPath, { target: 'channel' })
      + input('notificationSoundTheme', '状态/兜底提示音', '状态、错误和其他未分来源通知使用的提示音，也作为旧配置兜底。', 'select', cfg.notificationSoundTheme, optionList('soundThemes'))
      + input('customNotificationSoundPath', '状态/兜底自定义声音', '状态/兜底提示音选择“自定义声音”时使用；聊天/频道未填路径时也会继承它。', 'soundPath', cfg.customNotificationSoundPath, { target: 'status' })
      + '</div>'
      // Quick Preset
      + '<div class="setting-group"><div class="setting-group-title"><span class="sg-icon">🎛️</span> 视觉组合包</div>'
      + input('visualComboPack', '组合包', '一键套用弹窗风格、登场效果、粒子贴图、轨迹、物理手感、弹窗配色和面板主题。选自定义可手动微调。', 'select', cfg.visualComboPack, optionList('visualComboPacks'))
      + '</div>'
      // Toast Card
      + '<div class="setting-group"><div class="setting-group-title"><span class="sg-icon">🃏</span> 弹窗卡片</div>'
      + input('toastLayout', '布局', '控制头像、标题、正文、角色名和标签的排版结构。', 'select', cfg.toastLayout, optionList('toastLayouts'))
      + input('toastStyle', '卡片风格', '右下角自定义弹窗的卡片外观。', 'select', cfg.toastStyle, optionList('toastStyles'))
      + input('sakuraTheme', '弹窗配色', '选择弹窗的樱花和角色配色方案。', 'select', cfg.sakuraTheme, optionList('sakuraThemes'))
      + input('toastScale', '整体大小', '等比例缩放整张弹窗，文字、头像、间距会一起变小或变大。1.0 为原始大小。', 'range', cfg.toastScale, { min: 0.7, max: 1.2, step: 0.05, defaultValue: 1.0 })
      + input('toastOffsetX', '水平偏移', '负数向左，正数向右。允许把弹窗推到屏幕工作区之外。', 'range', cfg.toastOffsetX, { min: -1600, max: 1600, step: 10, defaultValue: 0 })
      + input('toastOffsetY', '垂直偏移', '负数向上，正数向下。允许把弹窗推到屏幕工作区之外。', 'range', cfg.toastOffsetY, { min: -1000, max: 1000, step: 10, defaultValue: 0 })
      + '</div>'
      // Motion
      + '<div class="setting-group"><div class="setting-group-title"><span class="sg-icon">🌀</span> 弹窗动效</div>'
      + input('toastTransportMode', '舞动风格', '只控制弹窗运动与编队方式：群舞弹簧保留共享栈物理，独奏轻弹让每张卡片独立运动。', 'select', cfg.toastTransportMode, optionList('toastTransportModes'))
      + input('entranceVisual', '登场效果', '只控制弹窗进入时的视觉效果，不改变窗体运动。', 'select', cfg.entranceVisual, optionList('entranceVisuals'))
      + input('autoDismissMotion', '自动消失轨迹', '时间结束后自动退场的运动方式。', 'select', cfg.autoDismissMotion, optionList('autoDismissMotions'))
      + input('manualDismissMotion', '手动关闭轨迹', '点击关闭时的退场运动方式。', 'select', cfg.manualDismissMotion, optionList('manualDismissMotions'))
      + input('physicsPreset', '物理手感', '控制弹窗进入和堆叠补位的弹簧手感。', 'select', cfg.physicsPreset, optionList('physicsPresets'))
      + '</div>'
      // Particles
      + '<div class="setting-group"><div class="setting-group-title"><span class="sg-icon">🌸</span> 粒子退场</div>'
      + input('particleShape', '粒子形状', '弹窗退场时释放的粒子形状。', 'select', cfg.particleShape, optionList('particleShapes'))
      + input('autoParticleCountScale', '自动粒子数量', '自动消失时释放的粒子数量倍率。1.0 为标准，数值越大越密。', 'range', cfg.autoParticleCountScale, { min: 0.2, max: 4.0, step: 0.1, defaultValue: 1.0 })
      + input('manualParticleCountScale', '手动粒子数量', '手动关闭或点击退场时释放的粒子数量倍率。', 'range', cfg.manualParticleCountScale, { min: 0.2, max: 4.0, step: 0.1, defaultValue: 1.0 })
      + input('particleSizeScale', '粒子大小', '统一调节退场粒子的绘制大小。', 'range', cfg.particleSizeScale, { min: 0.5, max: 3.0, step: 0.1, defaultValue: 1.0 })
      + input('particleIntervalEffect', '粒子间隔', '调节粒子出现的时间间隔。0 为原始瞬爆，数值越大越像连续喷涌/星雨。', 'range', cfg.particleIntervalEffect, { min: 0, max: 100, step: 1, defaultValue: 0 })
      + '</div>'
      // Widget Panel
      + '<div class="setting-group"><div class="setting-group-title"><span class="sg-icon">🪟</span> 通知中心面板</div>'
      + input('panelTheme', '面板主题', '右上角「通」按钮和通知中心面板的主题。自动模式会跟随当前组合包。', 'select', cfg.panelTheme, optionList('panelThemes'))
      + input('notificationWidgetDensity', '显示密度', '控制通知中心面板的整体字号，当前“宽松大字”作为最小档。', 'select', cfg.notificationWidgetDensity, [
        { value: 'spacious', label: '宽松大字' },
        { value: 'large', label: '超大醒目' },
        { value: 'huge', label: '巨幕阅读' },
      ])
      + input('notificationWidgetSourceTint', '按来源染色', '聊天、频道、状态通知使用不同色系。', 'toggle', cfg.notificationWidgetSourceTint)
      + '</div>'
      // Channel Aggregation
      + '<div class="setting-group"><div class="setting-group-title"><span class="sg-icon">🧵</span> 频道聚合</div>'
      + input('enableChannelAggregation', '频道聚合摘要', '短时间多条普通频道消息合并为一条。重要通知会立即弹出，不参与聚合。', 'toggle', cfg.enableChannelAggregation)
      + input('channelAggregationWindowSeconds', '聚合窗口秒数', '在多少秒内累计频道普通消息。少于阈值时到点会按原消息逐条发出。', 'range', cfg.channelAggregationWindowSeconds, { min: 5, max: 300, step: 5, defaultValue: 30 })
      + input('channelAggregationThreshold', '聚合触发条数', '窗口内达到多少条普通频道消息后立刻合并为摘要。', 'range', cfg.channelAggregationThreshold, { min: 2, max: 50, step: 1, defaultValue: 4 })
      + '</div>'
      // Keywords
      + '<div class="setting-group"><div class="setting-group-title"><span class="sg-icon">⭐</span> 重要通知规则</div>'
      + input('enableKeywordImportance', '启用关键词重要通知', '命中关键词的通知升格为重要。', 'toggle', cfg.enableKeywordImportance)
      + input('importantNotificationSound', '重要通知提示音', '重要通知播放明显不同的声音。', 'toggle', cfg.importantNotificationSound)
      + input('notificationKeywords', '重要关键词', '用逗号或换行分隔。命中这些词的通知会标记为重要。', 'textarea', cfg.notificationKeywords)
      + '</div>'
      // Save / Preview buttons
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:calc(8px * var(--nh-scale));padding:calc(8px * var(--nh-scale)) 0"><button type="button" class="btn" id="btn-save-settings" style="height:calc(38px * var(--nh-scale));font-size:calc(14px * var(--nh-scale))">💾 保存</button><button type="button" class="btn burst-preview" data-test-type="conversation" data-count="1" style="height:calc(38px * var(--nh-scale));font-size:calc(14px * var(--nh-scale))">👁 对话预览</button><button type="button" class="btn burst-preview" data-test-type="conversation" data-count="5" style="height:calc(38px * var(--nh-scale));font-size:calc(14px * var(--nh-scale))">🎆 对话 5 连发</button><button type="button" class="btn burst-preview" data-test-type="conversation" data-count="10" style="height:calc(38px * var(--nh-scale));font-size:calc(14px * var(--nh-scale))">🚀 对话 10 连发</button></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:calc(8px * var(--nh-scale));padding:0 0 calc(8px * var(--nh-scale)) 0"><button type="button" class="btn burst-preview" data-test-type="channel" data-count="1" style="height:calc(38px * var(--nh-scale));font-size:calc(14px * var(--nh-scale))">💬 频道通知</button><button type="button" class="btn burst-preview" data-test-type="channel-aggregate" data-count="1" style="height:calc(38px * var(--nh-scale));font-size:calc(14px * var(--nh-scale))">🧵 频道摘要</button><button type="button" class="btn burst-preview" data-test-type="status" data-count="1" style="height:calc(38px * var(--nh-scale));font-size:calc(14px * var(--nh-scale))">ℹ️ 状态通知</button><button type="button" class="btn burst-preview" data-test-type="error" data-count="1" style="height:calc(38px * var(--nh-scale));font-size:calc(14px * var(--nh-scale))">⚠️ 错误通知</button><button type="button" class="btn burst-preview" data-test-type="task-done" data-count="1" style="height:calc(38px * var(--nh-scale));font-size:calc(14px * var(--nh-scale))">✅ 任务完成</button></div>'
      + '<div class="save-feedback" id="save-feedback"></div>';
  }

  function bindSettingsEvents() {
    // Toggles
    document.querySelectorAll('.toggle').forEach(function(el) {
      el.addEventListener('click', function() {
        this.classList.toggle('on');
      });
    });
    document.querySelectorAll('.range-wrap').forEach(function(parent) {
      var rangeInput = parent.querySelector('input[type="range"]');
      var numberInput = parent.querySelector('input[type="number"]');
      function syncFrom(src, dst) {
        var min = Number(src.min);
        var max = Number(src.max);
        var value = Number(src.value);
        if (!Number.isFinite(value)) value = 1;
        value = Math.min(max, Math.max(min, Math.round(value * 100) / 100));
        src.value = String(value);
        dst.value = String(value);
      }
      rangeInput.addEventListener('input', function() { syncFrom(rangeInput, numberInput); });
      numberInput.addEventListener('input', function() { syncFrom(numberInput, rangeInput); });
    });

    function setFieldValue(key, value) {
      var selectWrap = document.querySelector('.select-wrap[data-key="' + key + '"]');
      if (selectWrap) {
        var select = selectWrap.querySelector('select');
        if (select) select.value = String(value);
        return;
      }
      var textInput = document.querySelector('input.setting-input[type="text"][data-key="' + key + '"]');
      if (textInput) {
        textInput.value = String(value == null ? '' : value);
        return;
      }
      var textArea = document.querySelector('textarea.setting-input[data-key="' + key + '"]');
      if (textArea) {
        textArea.value = String(value == null ? '' : value);
        return;
      }
      var rangeWrap = document.querySelector('.range-wrap[data-key="' + key + '"]');
      if (rangeWrap) {
        var range = rangeWrap.querySelector('input[type="range"]');
        var number = rangeWrap.querySelector('input[type="number"]');
        var text = String(value);
        if (range) range.value = text;
        if (number) number.value = text;
      }
    }

    function soundThemeKeyForPathKey(key) {
      if (key === 'conversationCustomNotificationSoundPath') return 'conversationNotificationSoundTheme';
      if (key === 'channelCustomNotificationSoundPath') return 'channelNotificationSoundTheme';
      if (key === 'customNotificationSoundPath') return 'notificationSoundTheme';
      return '';
    }

    function applyVisualComboPackToForm(packId) {
      var pack = VISUAL_COMBO_PACKS && VISUAL_COMBO_PACKS[packId];
      if (!pack || !pack.fields) return;
      Object.keys(pack.fields).forEach(function(key) {
        setFieldValue(key, pack.fields[key]);
      });
    }

    var comboSelect = document.querySelector('.select-wrap[data-key="visualComboPack"] select');
    if (comboSelect) {
      comboSelect.addEventListener('change', function() {
        applyVisualComboPackToForm(this.value);
      });
    }

    function collectSettingsPayload() {
      var payload = {};
      document.querySelectorAll('.toggle').forEach(function(el) {
        payload[el.dataset.key] = el.classList.contains('on');
      });
      document.querySelectorAll('.select-wrap select').forEach(function(el) {
        var parent = el.closest('.select-wrap');
        payload[parent.dataset.key] = el.value;
      });
      document.querySelectorAll('textarea[data-key], input.setting-input[type="text"][data-key]').forEach(function(el) {
        payload[el.dataset.key] = el.value;
      });
      document.querySelectorAll('.range-wrap').forEach(function(parent) {
        var numberInput = parent.querySelector('input[type="number"]');
        payload[parent.dataset.key] = Number(numberInput && numberInput.value);
      });
      return payload;
    }

    document.querySelectorAll('.sound-picker').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.preventDefault();
        var key = this.dataset.key;
        var target = this.dataset.target || 'status';
        var input = document.querySelector('input.setting-input[type="text"][data-key="' + key + '"]');
        var feedbackEl = document.getElementById('save-feedback');
        if (feedbackEl) {
          feedbackEl.className = 'save-feedback show';
          feedbackEl.textContent = '打开 Windows 声音文件选择器...';
        }
        try {
          var res = await fetch(API + '/pick-sound', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: target, currentPath: input ? input.value : '' }),
          });
          var data = await res.json();
          if (data.ok && data.cancelled) {
            if (feedbackEl) {
              feedbackEl.className = 'save-feedback show';
              feedbackEl.textContent = '已取消选择';
            }
            return;
          }
          if (data.ok && data.path) {
            setFieldValue(key, data.path);
            var themeKey = soundThemeKeyForPathKey(key);
            if (themeKey) setFieldValue(themeKey, 'custom');
            if (feedbackEl) {
              feedbackEl.className = 'save-feedback show success';
              feedbackEl.textContent = '✅ 已选择声音文件，记得保存设置';
            }
          } else if (feedbackEl) {
            feedbackEl.className = 'save-feedback show error';
            feedbackEl.textContent = '❌ 选择失败: ' + (data.error || 'unknown');
          }
        } catch (err) {
          if (feedbackEl) {
            feedbackEl.className = 'save-feedback show error';
            feedbackEl.textContent = '❌ 选择失败: ' + err.message;
          }
        }
      });
    });

    // Save
    document.getElementById('btn-save-settings').addEventListener('click', async function() {
      var feedbackEl = document.getElementById('save-feedback');
      feedbackEl.className = 'save-feedback show';
      feedbackEl.textContent = '保存中...';
      try {
        var payload = collectSettingsPayload();
        var res = await fetch(API + '/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json();
        if (data.ok) {
          feedbackEl.className = 'save-feedback show success';
          feedbackEl.textContent = '✅ 设置已保存';
          if (data.settings) applyWidgetAppearance(data.settings);
        } else {
          feedbackEl.className = 'save-feedback show error';
          feedbackEl.textContent = '❌ 保存失败: ' + (data.error || 'unknown');
        }
      } catch (e) {
        feedbackEl.className = 'save-feedback show error';
        feedbackEl.textContent = '❌ 网络错误: ' + e.message;
      }
    });


    window.previewNotification = async function(count, testType) {
      count = Math.max(1, Math.min(10, Number(count || 1)));
      testType = testType || 'conversation';
      var labels = {
        conversation: '对话',
        channel: '频道',
        'channel-aggregate': '频道摘要',
        status: '状态',
        error: '错误',
        'task-done': '任务完成',
      };
      var previewLabel = labels[testType] || '视觉';
      var feedbackEl = document.getElementById('save-feedback');
      if (!feedbackEl) return;
      feedbackEl.className = 'save-feedback show';
      feedbackEl.textContent = count > 1 ? ('瞬发 ' + count + ' 条' + previewLabel + '预览中...') : ('生成' + previewLabel + '预览中...');
      try {
        var payload = collectSettingsPayload();
        payload.preview = true;
        payload.count = count;
        payload.testType = testType;
        var res = await fetch(API + '/test-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json();
        if (data.ok) {
          feedbackEl.className = 'save-feedback show success';
          feedbackEl.textContent = '✅ ' + (data.message || '预览弹窗已发送');
        } else {
          feedbackEl.className = 'save-feedback show error';
          feedbackEl.textContent = '❌ 预览失败: ' + (data.error || 'unknown');
        }
      } catch (e) {
        feedbackEl.className = 'save-feedback show error';
        feedbackEl.textContent = '❌ 网络错误: ' + e.message;
      }
    };

    document.querySelectorAll('.burst-preview').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        window.previewNotification(this.dataset.count || 1, this.dataset.testType || 'conversation');
      });
    });
  }

  function resolvePanelThemeClient(value, visualComboPack) {
    var allowed = (EFFECT_OPTIONS.panelThemes || []).map(function(o) { return o.id; });
    var normalized = allowed.indexOf(String(value || 'auto')) >= 0 ? String(value || 'auto') : 'auto';
    if (normalized !== 'auto') return normalized;
    var pack = VISUAL_COMBO_PACKS && VISUAL_COMBO_PACKS[visualComboPack || 'custom'];
    return pack && pack.fields && pack.fields.panelTheme ? pack.fields.panelTheme : 'classic';
  }

  function panelThemeBaseModeClient(panelTheme) {
    return ['tech', 'obsidian', 'hologram', 'ember', 'moonlight'].indexOf(panelTheme) >= 0 ? 'dark' : 'light';
  }

  function panelThemeLabelClient(panelTheme) {
    var found = (EFFECT_OPTIONS.panelThemes || []).find(function(o) { return o.id === panelTheme; });
    return found ? found.label : '经典柔和';
  }

  function applyWidgetAppearance(cfg) {
    var panelTheme = resolvePanelThemeClient(cfg.panelTheme, cfg.visualComboPack);
    var theme = panelThemeBaseModeClient(panelTheme);
    var density = ['spacious', 'large', 'huge'].includes(cfg.notificationWidgetDensity) ? cfg.notificationWidgetDensity : 'spacious';
    var sourceTint = cfg.notificationWidgetSourceTint === true;
    document.documentElement.className = 'theme-' + theme + ' panel-theme-' + panelTheme + ' density-' + density + ' preset-warm-paper ' + (sourceTint ? 'source-tint-on' : 'source-tint-off');
    var subtitle = document.getElementById('subtitle');
    if (subtitle) subtitle.textContent = panelThemeLabelClient(panelTheme) + ' · ' + (density === 'spacious' ? '大字' : density === 'large' ? '超大' : '巨幕');
    if (typeof applyFilter === 'function') applyFilter();
    notifyResize();
  }

  // Tab switching
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function(tc) { tc.classList.remove('active'); });
      this.classList.add('active');
      var tabId = this.dataset.tab;
      document.getElementById('tab-' + tabId).classList.add('active');
      if (tabId === 'settings') loadSettings();
      notifyResize();
    });
  });

  // Filter pills
  document.getElementById('filter-bar').addEventListener('click', function(e) {
    var pill = e.target.closest('.pill[data-filter]');
    if (!pill) return;
    document.querySelectorAll('.pill[data-filter]').forEach(function(p) { p.classList.remove('active'); });
    pill.classList.add('active');
    currentFilter = pill.dataset.filter;
    applyFilter();
  });

  // Clear
  document.getElementById('btn-clear').addEventListener('click', async function() {
    setStatus("清空...");
    try {
      await fetch(API + '/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
    } catch (e) {}
    await loadRecords();
    setStatus("");
  });

  // Init
  loadRecords();
  parent.postMessage({ type: "ready" }, "*");

  if (window.ResizeObserver) {
    new ResizeObserver(notifyResize).observe(document.body);
  }
})();
</script>
</body>
</html>`;
}

function themeLabel(config) {
  const resolved = resolvePanelTheme(config.panelTheme, "custom");
  const theme = TOAST_EFFECTS.panelThemes.find((item) => item.id === resolved)?.label || "经典柔和";
  const density = config.density === "spacious" ? "大字" : config.density === "large" ? "超大" : "巨幕";
  return `${theme} · ${density}`;
}

function escAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
