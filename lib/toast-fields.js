import { normalizeEffect } from "./effect-registry.js";
import { normalizeDismissMotionTrack } from "./notification-config.js";

export function safeName(value) {
  return String(value || "toast").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
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
  // Some callers may pass CSS snippets such as gradients. Pick the first hex color.
  const embedded = text.match(/#([0-9a-fA-F]{6})\b/);
  if (embedded) return `#${embedded[1].toLowerCase()}`;
  return fallback;
}

export function normalizeChoice(value, group, fallback) {
  return normalizeEffect(group, value, fallback);
}

export function normalizeNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

export function normalizeMotionChoice(value, fallback) {
  return normalizeDismissMotionTrack(value, fallback);
}

export function normalizeCustomSoundPath(value) {
  return typeof value === "string" ? value.trim() : "";
}
