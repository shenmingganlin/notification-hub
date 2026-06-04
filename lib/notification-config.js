// Centralized notification-hub configuration normalizer.
// Keep manifest/widget/runtime coercion in this module so new settings have one source of truth.
import {
  applyVisualComboPack,
  normalizeEffect,
  normalizeSoundTheme,
  normalizeVisualComboPack,
} from "./effect-registry.js";

export { normalizeSoundTheme };

export const DEFAULT_IMPORTANT_KEYWORDS = Object.freeze(["紧急", "重要", "bug", "报错", "失败", "完成了", "error", "failed", "urgent", "important"]);
export const DEFAULT_KEYWORDS_TEXT = "紧急, 重要, bug, 报错, 失败, 完成了, error, failed, urgent, important";

export const SETTINGS_KEYS = Object.freeze([
  "enableConversationNotification",
  "enableChannelNotification",
  "enableConversationSound",
  "enableChannelSound",
  "enableKeywordImportance",
  "notificationKeywords",
  "importantNotificationSound",
  "notificationSoundTheme",
  "enableStatusNotifications",
  "enableErrorNotifications",
  "enableTaskDoneNotifications",
  "enableChannelAggregation",
  "channelAggregationWindowSeconds",
  "channelAggregationThreshold",
  "notificationDisplayMode",
  "visualComboPack",
  "toastTransportMode",
  "toastStyle",
  "dismissEffect",
  "particleShape",
  "autoParticleCountScale",
  "manualParticleCountScale",
  "particleSizeScale",
  "entranceVisual",
  "autoDismissMotion",
  "manualDismissMotion",
  "physicsPreset",
  "notificationWidgetTheme",
  "notificationWidgetDensity",
  "notificationWidgetSourceTint",
  "sakuraEnabled",
  "sakuraTheme",
  "clickAction",
]);

export const TOAST_THEME_PALETTES = Object.freeze({
  hanako: Object.freeze({ primary: "#9b59b6", accent: "#ff9ecf" }),
  butter: Object.freeze({ primary: "#e67e22", accent: "#f6b93b" }),
  chatgpt: Object.freeze({ primary: "#10a37f", accent: "#74b9ff" }),
  ming: Object.freeze({ primary: "#6c5ce7", accent: "#a29bfe" }),
  kong: Object.freeze({ primary: "#00b894", accent: "#74b9ff" }),
  rainbow: Object.freeze({ primary: "#ff7675", accent: "#74b9ff" }),
  sakurastorm: Object.freeze({ primary: "#ff4f9f", accent: "#ffd1e8" }),
  blackgold: Object.freeze({ primary: "#d6a84f", accent: "#fff0a6" }),
  ember: Object.freeze({ primary: "#ff7a18", accent: "#ffd166" }),
  moonlight: Object.freeze({ primary: "#8ea7ff", accent: "#d7b7ff" }),
  neonmint: Object.freeze({ primary: "#40f5c8", accent: "#7aa7ff" }),
});

export function getToastThemeColors(theme) {
  return TOAST_THEME_PALETTES[String(theme || "auto").toLowerCase()] || null;
}

export function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function intValue(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function numberValue(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

export function normalizeDisplayMode(config = {}) {
  const mode = config?.notificationDisplayMode;
  if (mode === "custom" || mode === "native" || mode === "off") return mode;
  // Backward compat: old enableCustomToast=false means native Windows notification.
  if (config?.enableCustomToast === false) return "native";
  return "custom";
}

export function normalizeToastStyle(value) {
  return normalizeEffect("toastStyles", value, "classic");
}

export function normalizeDismissEffect(value, sakuraEnabled) {
  return normalizeEffect("dismissEffects", value, sakuraEnabled === false ? "fade" : "sakura");
}

export function normalizeParticleShape(value, legacyDismissEffect) {
  const normalized = normalizeEffect("particleShapes", value, null);
  if (normalized) return normalized;

  // Backward compat: early visual builds stored the particle shape in dismissEffect.
  const legacyShape = normalizeEffect("particleShapes", legacyDismissEffect, null);
  if (legacyShape && legacyShape !== "none") return legacyShape;

  return "sakura";
}

export function normalizeEntranceVisual(value) {
  return normalizeEffect("entranceVisuals", value, "classic");
}

export function normalizeDismissMotionTrack(value, fallback = "drift", group = "dismissMotions") {
  const legacy = {
    burst: "circle-burst",
    explosion: "circle-burst",
    click: "click-burst",
    float: "drift",
  };
  const mapped = legacy[String(value || "").trim().toLowerCase()] || value;
  return normalizeEffect(group, mapped, fallback);
}

export function normalizePhysicsPreset(value) {
  return normalizeEffect("physicsPresets", value, "lively");
}

export function normalizeToastTransportMode(value) {
  return normalizeEffect("toastTransportModes", value, "managed");
}

export function parseKeywords(value) {
  if (Array.isArray(value)) {
    const list = value.map((v) => String(v || "").trim()).filter(Boolean);
    return list.length ? list : [...DEFAULT_IMPORTANT_KEYWORDS];
  }
  if (typeof value === "string") {
    const list = value
      .split(/[\n,，;；]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    return list.length ? list : [...DEFAULT_IMPORTANT_KEYWORDS];
  }
  return [...DEFAULT_IMPORTANT_KEYWORDS];
}

export function normalizeSettings(config = {}) {
  config = applyVisualComboPack(config || {});
  return {
    visualComboPack: normalizeVisualComboPack(config.visualComboPack),
    enableConversationSound: config.enableConversationSound !== false,
    enableChannelSound: config.enableChannelSound === true,
    enableConversationNotification: config.enableConversationNotification !== false,
    enableChannelNotification: config.enableChannelNotification !== false,
    enableKeywordImportance: config.enableKeywordImportance !== false,
    importantNotificationSound: config.importantNotificationSound !== false,
    notificationSoundTheme: normalizeSoundTheme(config.notificationSoundTheme, "chime"),
    notificationDisplayMode: normalizeDisplayMode(config),
    toastStyle: normalizeToastStyle(config.toastStyle),
    dismissEffect: normalizeDismissEffect(config.dismissEffect, config.sakuraEnabled),
    particleShape: normalizeParticleShape(config.particleShape, config.dismissEffect),
    autoParticleCountScale: numberValue(config.autoParticleCountScale, 1.0, 0.2, 4.0),
    manualParticleCountScale: numberValue(config.manualParticleCountScale, 1.0, 0.2, 4.0),
    particleSizeScale: numberValue(config.particleSizeScale, 1.0, 0.5, 3.0),
    entranceVisual: normalizeEntranceVisual(config.entranceVisual),
    autoDismissMotion: normalizeDismissMotionTrack(config.autoDismissMotion, "drift", "autoDismissMotions"),
    manualDismissMotion: normalizeDismissMotionTrack(config.manualDismissMotion, "click-burst", "manualDismissMotions"),
    physicsPreset: normalizePhysicsPreset(config.physicsPreset),
    toastTransportMode: normalizeToastTransportMode(config.toastTransportMode),
    enableChannelAggregation: config.enableChannelAggregation === true,
    channelAggregationWindowSeconds: intValue(config.channelAggregationWindowSeconds, 30, 5, 300),
    channelAggregationThreshold: intValue(config.channelAggregationThreshold, 4, 2, 50),
    enableStatusNotifications: config.enableStatusNotifications !== false,
    enableErrorNotifications: config.enableErrorNotifications !== false,
    enableTaskDoneNotifications: config.enableTaskDoneNotifications === true,
    sakuraEnabled: config.sakuraEnabled !== false,
    sakuraTheme: normalizeEffect("sakuraThemes", config.sakuraTheme, "auto"),
    notificationWidgetTheme: enumValue(config.notificationWidgetTheme, ["auto", "light", "dark"], "auto"),
    notificationWidgetDensity: enumValue(config.notificationWidgetDensity, ["spacious", "large", "huge"], "spacious"),
    notificationWidgetSourceTint: config.notificationWidgetSourceTint === true,
    clickAction: config.clickAction !== false,
    notificationKeywords: typeof config.notificationKeywords === "string" ? config.notificationKeywords : DEFAULT_KEYWORDS_TEXT,
  };
}

export function buildRuntimeConfig(config = {}) {
  const settings = normalizeSettings(config || {});
  return {
    visualComboPack: settings.visualComboPack,
    enableConversation: settings.enableConversationNotification,
    enableChannel: settings.enableChannelNotification,
    enableConversationSound: settings.enableConversationSound,
    enableChannelSound: settings.enableChannelSound,
    displayMode: settings.notificationDisplayMode,
    enableKeywordImportance: settings.enableKeywordImportance,
    importantNotificationSound: settings.importantNotificationSound,
    notificationSoundTheme: settings.notificationSoundTheme,
    enableChannelAggregation: settings.enableChannelAggregation,
    channelAggregationWindowMs: settings.channelAggregationWindowSeconds * 1000,
    channelAggregationThreshold: settings.channelAggregationThreshold,
    enableStatusNotifications: settings.enableStatusNotifications,
    enableErrorNotifications: settings.enableErrorNotifications,
    enableTaskDoneNotifications: settings.enableTaskDoneNotifications,
    clickAction: settings.clickAction,
    sakuraEnabled: settings.sakuraEnabled,
    sakuraTheme: settings.sakuraTheme,
    toastStyle: settings.toastStyle,
    dismissEffect: settings.dismissEffect,
    particleShape: settings.particleShape,
    autoParticleCountScale: settings.autoParticleCountScale,
    manualParticleCountScale: settings.manualParticleCountScale,
    particleSizeScale: settings.particleSizeScale,
    entranceVisual: settings.entranceVisual,
    autoDismissMotion: settings.autoDismissMotion,
    manualDismissMotion: settings.manualDismissMotion,
    physicsPreset: settings.physicsPreset,
    toastTransportMode: settings.toastTransportMode,
    keywords: parseKeywords(settings.notificationKeywords),
  };
}

export function sanitizeVisualPreviewPayload(body = {}) {
  body = applyVisualComboPack(body || {});
  return {
    visualComboPack: normalizeVisualComboPack(body.visualComboPack),
    toastStyle: normalizeToastStyle(body.toastStyle),
    dismissEffect: normalizeDismissEffect(body.dismissEffect, body.sakuraEnabled),
    particleShape: normalizeParticleShape(body.particleShape, body.dismissEffect),
    autoParticleCountScale: numberValue(body.autoParticleCountScale, 1.0, 0.2, 4.0),
    manualParticleCountScale: numberValue(body.manualParticleCountScale, 1.0, 0.2, 4.0),
    particleSizeScale: numberValue(body.particleSizeScale, 1.0, 0.5, 3.0),
    entranceVisual: normalizeEntranceVisual(body.entranceVisual),
    autoDismissMotion: normalizeDismissMotionTrack(body.autoDismissMotion, "drift", "autoDismissMotions"),
    manualDismissMotion: normalizeDismissMotionTrack(body.manualDismissMotion, "click-burst", "manualDismissMotions"),
    physicsPreset: normalizePhysicsPreset(body.physicsPreset),
    toastTransportMode: normalizeToastTransportMode(body.toastTransportMode),
    sakuraTheme: normalizeEffect("sakuraThemes", body.sakuraTheme, "auto"),
  };
}

const FIELD_COERCERS = Object.freeze({
  enableConversationSound: (v) => v !== false,
  enableChannelSound: (v) => v === true,
  enableConversationNotification: (v) => v !== false,
  enableChannelNotification: (v) => v !== false,
  enableKeywordImportance: (v) => v !== false,
  importantNotificationSound: (v) => v !== false,
  notificationSoundTheme: (v) => normalizeSoundTheme(v, "chime"),
  notificationDisplayMode: (v) => enumValue(v, ["custom", "native", "off"], "custom"),
  visualComboPack: (v) => normalizeVisualComboPack(v),
  toastStyle: (v) => normalizeToastStyle(v),
  dismissEffect: (v, body) => normalizeDismissEffect(v, body?.sakuraEnabled),
  particleShape: (v) => normalizeParticleShape(v, null),
  autoParticleCountScale: (v) => numberValue(v, 1.0, 0.2, 4.0),
  manualParticleCountScale: (v) => numberValue(v, 1.0, 0.2, 4.0),
  particleSizeScale: (v) => numberValue(v, 1.0, 0.5, 3.0),
  entranceVisual: (v) => normalizeEntranceVisual(v),
  autoDismissMotion: (v) => normalizeDismissMotionTrack(v, "drift", "autoDismissMotions"),
  manualDismissMotion: (v) => normalizeDismissMotionTrack(v, "click-burst", "manualDismissMotions"),
  physicsPreset: (v) => normalizePhysicsPreset(v),
  toastTransportMode: (v) => normalizeToastTransportMode(v),
  enableChannelAggregation: (v) => v === true,
  channelAggregationWindowSeconds: (v) => intValue(v, 30, 5, 300),
  channelAggregationThreshold: (v) => intValue(v, 4, 2, 50),
  enableStatusNotifications: (v) => v !== false,
  enableErrorNotifications: (v) => v !== false,
  enableTaskDoneNotifications: (v) => v === true,
  sakuraEnabled: (v) => v !== false,
  sakuraTheme: (v) => normalizeEffect("sakuraThemes", v, "auto"),
  notificationWidgetTheme: (v) => enumValue(v, ["auto", "light", "dark"], "auto"),
  notificationWidgetDensity: (v) => enumValue(v, ["spacious", "large", "huge"], "spacious"),
  notificationWidgetSourceTint: (v) => v === true,
  clickAction: (v) => v !== false,
  notificationKeywords: (v) => typeof v === "string" ? v : "",
});

export function sanitizeSettingsPayload(body = {}) {
  const updates = {};
  for (const key of SETTINGS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    updates[key] = FIELD_COERCERS[key](body[key], body);
  }

  // Partial settings updates must stay partial. Only apply a visual combo pack
  // when the caller explicitly sends visualComboPack; with applyVisualComboPack's
  // template semantics, explicit fields in the same payload still override pack defaults.
  if (Object.prototype.hasOwnProperty.call(body, "visualComboPack")) {
    return applyVisualComboPack(updates);
  }
  return updates;
}

export function normalizeWidgetConfig(config = {}) {
  const settings = normalizeSettings(config || {});
  return {
    theme: settings.notificationWidgetTheme,
    density: settings.notificationWidgetDensity,
    preset: "warm-paper",
    sourceTint: settings.notificationWidgetSourceTint,
  };
}
