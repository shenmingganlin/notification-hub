import fs from "node:fs";
import path from "node:path";
import { normalizeCustomSoundPath, normalizeSoundTheme } from "./sound-registry.js";

export const SOUND_DECISION_PATH_SOURCES = Object.freeze({
  EXPLICIT_NOTIFICATION: "explicit-notification",
  EXPLICIT_SCOPED: "explicit-scoped",
  INHERITED_GLOBAL: "inherited-global",
  GLOBAL: "global",
  NONE: "none",
});

export const SUPPORTED_CUSTOM_SOUND_EXTENSIONS = Object.freeze([".wav", ".mp3", ".m4a", ".aac", ".wma"]);

export function decideNotificationSound(config = {}, notification = {}, options = {}) {
  const diagnostics = [];
  const type = normalizeNotificationType(notification?.type);
  const importance = notification?.importance || "normal";
  const important = importance === "important" || importance === "urgent";

  if (notification?.sound === false) {
    return makeDecision({
      type,
      enabled: false,
      soundTheme: "off",
      customSoundPath: "",
      pathSource: SOUND_DECISION_PATH_SOURCES.NONE,
      reason: "notification requested sound=false",
      diagnostics,
    });
  }

  const baseTheme = resolveDecisionSoundTheme(config, type, importance);
  let soundTheme = normalizeSoundTheme(notification?.soundTheme, baseTheme);
  let pathInfo = resolveDecisionCustomPath(config, notification, type);

  if (soundTheme === "off") {
    return makeDecision({
      type,
      enabled: false,
      soundTheme: "off",
      customSoundPath: "",
      pathSource: SOUND_DECISION_PATH_SOURCES.NONE,
      reason: `${type} sound theme is off`,
      diagnostics,
    });
  }

  if ((type === "status" || type === "unknown") && !important && notification?.sound !== true) {
    return makeDecision({
      type,
      enabled: false,
      soundTheme,
      customSoundPath: soundTheme === "custom" ? pathInfo.path : "",
      pathSource: soundTheme === "custom" ? pathInfo.source : SOUND_DECISION_PATH_SOURCES.NONE,
      reason: "normal status notifications do not play sound unless explicitly requested",
      diagnostics,
    });
  }

  if (important && config.importantNotificationSound === false) {
    return makeDecision({
      type,
      enabled: false,
      soundTheme,
      customSoundPath: soundTheme === "custom" ? pathInfo.path : "",
      pathSource: soundTheme === "custom" ? pathInfo.source : SOUND_DECISION_PATH_SOURCES.NONE,
      reason: "important notification sound is disabled",
      diagnostics,
    });
  }

  if (soundTheme === "custom") {
    diagnostics.push(...pathInfo.diagnostics);
    const validation = validateCustomSoundPath(pathInfo.path, options);
    diagnostics.push(...validation.diagnostics);
    if (!validation.ok) {
      const fallbackTheme = normalizeSoundTheme(options.customFallbackTheme || "chime", "chime");
      return makeDecision({
        type,
        enabled: true,
        soundTheme: fallbackTheme === "custom" ? "chime" : fallbackTheme,
        customSoundPath: "",
        pathSource: SOUND_DECISION_PATH_SOURCES.NONE,
        reason: `custom sound unavailable; falling back to ${fallbackTheme === "custom" ? "chime" : fallbackTheme}`,
        diagnostics,
      });
    }

    return makeDecision({
      type,
      enabled: true,
      soundTheme: "custom",
      customSoundPath: validation.path,
      pathSource: pathInfo.source,
      reason: customPathReason(type, pathInfo.source),
      diagnostics,
    });
  }

  return makeDecision({
    type,
    enabled: true,
    soundTheme,
    customSoundPath: "",
    pathSource: SOUND_DECISION_PATH_SOURCES.NONE,
    reason: `${type} uses ${soundTheme} theme`,
    diagnostics,
  });
}

export function resolveDecisionSoundTheme(config = {}, type, importance = "normal") {
  const normalizedType = normalizeNotificationType(type);
  const globalTheme = normalizeSoundTheme(config.notificationSoundTheme, "chime");
  if (normalizedType === "conversation") {
    return normalizeSoundTheme(config.conversationNotificationSoundTheme || globalTheme, globalTheme);
  }
  if (normalizedType === "channel") {
    return normalizeSoundTheme(config.channelNotificationSoundTheme || globalTheme, globalTheme);
  }

  const important = importance === "important" || importance === "urgent";
  if (!important || globalTheme === "off") return globalTheme;
  return globalTheme === "custom" ? "custom" : "alert";
}

export function resolveDecisionCustomPath(config = {}, notification = {}, type) {
  const diagnostics = [];
  const explicit = normalizeCustomSoundPath(notification?.customSoundPath);
  if (explicit) {
    return { path: explicit, source: SOUND_DECISION_PATH_SOURCES.EXPLICIT_NOTIFICATION, diagnostics };
  }

  const normalizedType = normalizeNotificationType(type || notification?.type);
  const globalPath = normalizeCustomSoundPath(config.customNotificationSoundPath);
  if (normalizedType === "conversation") {
    const scoped = normalizeCustomSoundPath(config.conversationCustomNotificationSoundPath);
    if (scoped) return { path: scoped, source: SOUND_DECISION_PATH_SOURCES.EXPLICIT_SCOPED, diagnostics };
    if (globalPath) return { path: globalPath, source: SOUND_DECISION_PATH_SOURCES.INHERITED_GLOBAL, diagnostics };
    diagnostics.push("conversation custom sound has no scoped path and no global path to inherit");
    return { path: "", source: SOUND_DECISION_PATH_SOURCES.NONE, diagnostics };
  }

  if (normalizedType === "channel") {
    const scoped = normalizeCustomSoundPath(config.channelCustomNotificationSoundPath);
    if (scoped) return { path: scoped, source: SOUND_DECISION_PATH_SOURCES.EXPLICIT_SCOPED, diagnostics };
    if (globalPath) return { path: globalPath, source: SOUND_DECISION_PATH_SOURCES.INHERITED_GLOBAL, diagnostics };
    diagnostics.push("channel custom sound has no scoped path and no global path to inherit");
    return { path: "", source: SOUND_DECISION_PATH_SOURCES.NONE, diagnostics };
  }

  if (globalPath) return { path: globalPath, source: SOUND_DECISION_PATH_SOURCES.GLOBAL, diagnostics };
  diagnostics.push("status custom sound has no global path");
  return { path: "", source: SOUND_DECISION_PATH_SOURCES.NONE, diagnostics };
}

export function validateCustomSoundPath(value, options = {}) {
  const diagnostics = [];
  const text = normalizeCustomSoundPath(value);
  if (!text) {
    diagnostics.push("custom sound path is empty");
    return { ok: false, path: "", diagnostics };
  }

  const expanded = expandEnvironmentVariables(text);
  const ext = path.extname(expanded).toLowerCase();
  if (!SUPPORTED_CUSTOM_SOUND_EXTENSIONS.includes(ext)) {
    diagnostics.push(`unsupported custom sound extension: ${ext || "<none>"}`);
    return { ok: false, path: expanded, diagnostics };
  }

  if (options.checkFileExists === true && !fs.existsSync(expanded)) {
    diagnostics.push(`custom sound file does not exist: ${expanded}`);
    return { ok: false, path: expanded, diagnostics };
  }

  return { ok: true, path: expanded, diagnostics };
}

export function normalizeNotificationType(value) {
  const text = String(value || "status").trim().toLowerCase();
  if (text === "conversation" || text === "channel" || text === "status") return text;
  return "status";
}

export function soundDecisionMeta(decision) {
  return {
    enabled: decision.enabled,
    soundTheme: decision.soundTheme,
    customSoundPath: decision.customSoundPath,
    pathSource: decision.pathSource,
    reason: decision.reason,
    diagnostics: [...(decision.diagnostics || [])],
  };
}

function makeDecision({ type, enabled, soundTheme, customSoundPath, pathSource, reason, diagnostics }) {
  return Object.freeze({
    type,
    enabled: Boolean(enabled),
    sound: Boolean(enabled),
    soundTheme: normalizeSoundTheme(soundTheme, "chime"),
    customSoundPath: normalizeCustomSoundPath(customSoundPath),
    pathSource: pathSource || SOUND_DECISION_PATH_SOURCES.NONE,
    reason: String(reason || ""),
    diagnostics: Object.freeze([...(diagnostics || [])]),
  });
}

function customPathReason(type, source) {
  if (source === SOUND_DECISION_PATH_SOURCES.EXPLICIT_NOTIFICATION) return `${type} uses notification-provided custom sound path`;
  if (source === SOUND_DECISION_PATH_SOURCES.EXPLICIT_SCOPED) return `${type} uses explicit scoped custom sound path`;
  if (source === SOUND_DECISION_PATH_SOURCES.INHERITED_GLOBAL) return `${type} custom sound inherits global custom sound path`;
  if (source === SOUND_DECISION_PATH_SOURCES.GLOBAL) return `${type} uses global custom sound path`;
  return `${type} custom sound path source is unavailable`;
}

function expandEnvironmentVariables(value) {
  return String(value || "").replace(/%([^%]+)%/g, (match, name) => process.env[name] || match);
}
