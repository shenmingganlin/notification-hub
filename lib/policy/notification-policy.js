import { parseKeywords } from "../notification-config.js";
import {
  resolveCustomSoundPath,
  resolveNotificationCustomSoundPath,
  resolveNotificationSoundTheme,
  resolveStatusSoundTheme,
  shouldPlaySound,
} from "../sound/sound-resolver.js";

export {
  resolveCustomSoundPath,
  resolveNotificationCustomSoundPath,
  resolveNotificationSoundTheme,
  resolveStatusSoundTheme,
  shouldPlaySound,
} from "../sound/sound-resolver.js";

export function resolveImportance(config, type, text) {
  const base = type === "channel" ? "low" : "normal";
  if (!config?.enableKeywordImportance) return { level: base, keywords: [] };

  const haystack = String(text || "").toLowerCase();
  const matched = [];
  for (const keyword of config.keywords || []) {
    const needle = String(keyword || "").trim();
    if (!needle) continue;
    if (haystack.includes(needle.toLowerCase())) matched.push(needle);
  }

  if (matched.length) return { level: "important", keywords: matched };
  return { level: base, keywords: [] };
}

export function parseNotificationKeywords(value) {
  return parseKeywords(value);
}
