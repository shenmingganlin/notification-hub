import {
  getToastThemeColors,
  normalizeDismissEffect,
  normalizeDismissMotionTrack,
  normalizeEntranceVisual,
  normalizeParticleShape,
  normalizePhysicsPreset,
  normalizeToastLayout,
  normalizeToastStyle,
  numberValue,
} from "../notification-config.js";
import { decideNotificationSound, soundDecisionMeta } from "../sound/sound-decision.js";

export function decorateToastNotification(notification, config) {
  const sakuraTheme = notification?.sakuraTheme || config.sakuraTheme;
  const themeColors = toastThemeColors(sakuraTheme);
  const colors = resolveToastColors(notification, themeColors);
  const soundDecision = decideNotificationSound(config, notification, {
    checkFileExists: false,
    customFallbackTheme: "chime",
  });
  return {
    ...notification,
    sound: soundDecision.enabled,
    soundTheme: soundDecision.soundTheme,
    customSoundPath: soundDecision.customSoundPath,
    primary: colors.primary,
    accent: colors.accent,
    meta: {
      ...(notification?.meta || {}),
      toastColorSource: colors.source,
      soundDecision: soundDecisionMeta(soundDecision),
    },
    toastLayout: normalizeToastLayout(notification?.toastLayout || config.toastLayout),
    toastStyle: normalizeToastStyle(notification?.toastStyle || config.toastStyle),
    dismissEffect: normalizeDismissEffect(notification?.dismissEffect || config.dismissEffect, config.sakuraEnabled),
    particleShape: normalizeParticleShape(notification?.particleShape || config.particleShape, notification?.dismissEffect || config.dismissEffect),
    autoParticleCountScale: clampDecimal(notification?.autoParticleCountScale, config.autoParticleCountScale, 0.2, 4.0),
    manualParticleCountScale: clampDecimal(notification?.manualParticleCountScale, config.manualParticleCountScale, 0.2, 4.0),
    particleSizeScale: clampDecimal(notification?.particleSizeScale, config.particleSizeScale, 0.5, 3.0),
    particleIntervalEffect: clampDecimal(notification?.particleIntervalEffect, config.particleIntervalEffect, 0, 100),
    entranceVisual: normalizeEntranceVisual(notification?.entranceVisual || config.entranceVisual),
    autoDismissMotion: normalizeDismissMotionTrack(notification?.autoDismissMotion || config.autoDismissMotion, "drift", "autoDismissMotions"),
    manualDismissMotion: normalizeDismissMotionTrack(notification?.manualDismissMotion || config.manualDismissMotion, "click-burst", "manualDismissMotions"),
    physicsPreset: normalizePhysicsPreset(notification?.physicsPreset || config.physicsPreset),
    toastTransportMode: notification?.toastTransportMode || config.toastTransportMode,
    sakuraTheme,
  };
}

export function toastThemeColors(theme) {
  return getToastThemeColors(theme);
}

export function resolveToastColors(notification, themeColors) {
  const primaryCandidate = themeColors?.primary || notification?.primary || notification?.theme?.primary;
  const primarySource = themeColors?.primary
    ? "sakuraTheme.primary"
    : notification?.primary
      ? "notification.primary"
      : notification?.theme?.primary
        ? "notification.theme.primary"
        : "fallback.primary";
  const primary = normalizeHexColor(primaryCandidate, "#9b7cff");

  const accentCandidate = themeColors?.accent || notification?.accent || notification?.theme?.accent || primary;
  const accentSource = themeColors?.accent
    ? "sakuraTheme.accent"
    : notification?.accent
      ? "notification.accent"
      : notification?.theme?.accent
        ? "notification.theme.accent"
        : "primary";
  const accent = normalizeHexColor(accentCandidate, primary);

  return { primary, accent, source: { primary: primarySource, accent: accentSource } };
}

export function normalizeHexColor(value, fallback = "#9b7cff") {
  const text = String(value || "").trim();
  const direct = text.match(/^#([0-9a-fA-F]{6})$/);
  if (direct) return `#${direct[1].toLowerCase()}`;
  const short = text.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const [r, g, b] = short[1].toLowerCase().split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const embedded = text.match(/#([0-9a-fA-F]{6})\b/);
  if (embedded) return `#${embedded[1].toLowerCase()}`;
  return fallback;
}

export function clampDecimal(value, fallback, min, max) {
  return numberValue(value, fallback, min, max);
}
