import {
  decideNotificationSound,
  resolveDecisionCustomPath,
  resolveDecisionSoundTheme,
} from "./sound-decision.js";

export function resolveStatusSoundTheme(config = {}, isImportant = false) {
  return resolveDecisionSoundTheme(config, "status", isImportant ? "important" : "normal");
}

export function resolveNotificationSoundTheme(config = {}, type, importance) {
  return resolveDecisionSoundTheme(config, type, importance || "normal");
}

export function shouldPlaySound(config = {}, type, importance) {
  return decideNotificationSound(config, { type, importance }).enabled;
}

export function resolveNotificationCustomSoundPath(config = {}, type) {
  return resolveDecisionCustomPath(config, {}, type).path;
}

export function resolveCustomSoundPath(config = {}, notification = {}) {
  return resolveDecisionCustomPath(config, notification, notification?.type).path;
}

export function resolveScopedSound(config = {}, type) {
  const decision = decideNotificationSound(config, { type, importance: "normal" });
  return {
    soundTheme: decision.soundTheme,
    customSoundPath: decision.customSoundPath,
  };
}

export function resolveNotificationSound(config = {}, notification = {}) {
  const decision = decideNotificationSound(config, notification);
  return {
    sound: decision.enabled,
    soundTheme: decision.soundTheme,
    customSoundPath: decision.customSoundPath,
  };
}

export { decideNotificationSound } from "./sound-decision.js";
