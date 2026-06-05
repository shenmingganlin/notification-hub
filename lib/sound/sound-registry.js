// Centralized sound theme registry.
// Keep sound choices here so manifest, settings, widget preview, tools, and toast payloads do not drift.

export const SOUND_THEMES = Object.freeze([
  { id: "ding", label: "铃铛叮声" },
  { id: "chime", label: "钟声" },
  { id: "notify", label: "Windows 通知音" },
  { id: "system", label: "系统提示音" },
  { id: "alert", label: "警报提示音" },
  { id: "alarm", label: "警铃提示音" },
  { id: "custom", label: "自定义声音" },
  { id: "off", label: "静音" },
]);

export const SOUND_THEME_IDS = Object.freeze(SOUND_THEMES.map((item) => item.id));

export const SOUND_THEME_ALIASES = Object.freeze({
  chimes: "chime",
});

export function soundThemeOptions() {
  return SOUND_THEMES.map((item) => ({ ...item }));
}

export function soundThemeIds() {
  return [...SOUND_THEME_IDS];
}

export function isSoundTheme(value) {
  const text = String(value || "").trim().toLowerCase();
  const mapped = SOUND_THEME_ALIASES[text] || text;
  return SOUND_THEME_IDS.includes(mapped);
}

export function normalizeSoundTheme(value, fallback = "chime") {
  const text = String(value || fallback || "").trim().toLowerCase();
  const mapped = SOUND_THEME_ALIASES[text] || text;
  if (SOUND_THEME_IDS.includes(mapped)) return mapped;

  const fallbackText = String(fallback || "chime").trim().toLowerCase();
  const mappedFallback = SOUND_THEME_ALIASES[fallbackText] || fallbackText;
  return SOUND_THEME_IDS.includes(mappedFallback) ? mappedFallback : "chime";
}

export function normalizeCustomSoundPath(value) {
  return typeof value === "string" ? value.trim() : "";
}
