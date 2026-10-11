import { DARK_PANEL_THEMES, HOST_DARK_THEMES } from "./visual-tables.js";

const HOST_DARK_THEME_SET = new Set(HOST_DARK_THEMES);
const DARK_PANEL_THEME_SET = new Set(DARK_PANEL_THEMES);

export function appearanceFromThemeName(themeName) {
  const theme = String(themeName || "").trim();
  if (!theme) return "";
  return HOST_DARK_THEME_SET.has(theme) ? "dark" : "light";
}

export function appearanceFromQuery(params) {
  const appearance = String(params?.get?.("hana-theme-appearance") || "").trim().toLowerCase();
  if (appearance === "dark" || appearance === "light") return appearance;
  return appearanceFromThemeName(params?.get?.("hana-theme"));
}

export function appearanceFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "";
  if (snapshot.appearance === "dark" || snapshot.appearance === "light") return snapshot.appearance;
  return appearanceFromThemeName(snapshot.theme);
}

export function issuedStylesheetUrl(cssUrl, baseHref) {
  if (typeof cssUrl !== "string" || !cssUrl.trim()) return "";
  try {
    const url = new URL(cssUrl, baseHref || "http://127.0.0.1/");
    if (url.username || url.password || url.hash) return "";
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

export const PANEL_THEME_PAINT = Object.freeze({
  classic: { bg: "#f6f0e4", surface: "#efe6d6", ink: "#2c261f", muted: "#6a5848", accent: "#8a5a32", onAccent: "#fff8f5", label: "经典柔和" },
  minimal: { bg: "#f7f7f5", surface: "#ececea", ink: "#1c1c1c", muted: "#4e555e", accent: "#2f3b4d", onAccent: "#f7f7f5", label: "极简纸片" },
  glass: { bg: "#e7eef6", surface: "#dce6f0", ink: "#1c2430", muted: "#4c5968", accent: "#3e56c8", onAccent: "#f4f7ff", label: "琉璃玻璃" },
  tech: { bg: "#071016", surface: "#0e1c22", ink: "#d9fff3", muted: "#8fbfb2", accent: "#3ee0b0", onAccent: "#071016", label: "霓虹赛博" },
  aurora: { bg: "#eef3fb", surface: "#e1e8f4", ink: "#1b2433", muted: "#4d5b73", accent: "#4458c8", onAccent: "#f4f6ff", label: "极光晶格" },
  "sakura-storm": { bg: "#fff1f6", surface: "#ffe3ee", ink: "#2a1520", muted: "#6e4556", accent: "#d42a6a", onAccent: "#fff7fa", label: "樱暴绯云" },
  obsidian: { bg: "#100e0c", surface: "#1c1814", ink: "#f3ead6", muted: "#c4b296", accent: "#e0b35a", onAccent: "#1a1408", label: "黑金机械" },
  hologram: { bg: "#101224", surface: "#191b30", ink: "#e8eeff", muted: "#b4bddc", accent: "#8fdfff", onAccent: "#101224", label: "全息薄膜" },
  paper: { bg: "#f3ead9", surface: "#e9deca", ink: "#2a2118", muted: "#65543f", accent: "#8a552c", onAccent: "#fff8f1", label: "温润纸笺" },
  ember: { bg: "#140d09", surface: "#22150f", ink: "#f6e6d4", muted: "#d2b59a", accent: "#ff7a18", onAccent: "#1a0e08", label: "余烬彗星" },
  moonlight: { bg: "#0e1020", surface: "#17192c", ink: "#e8e9ff", muted: "#b7bcd4", accent: "#cbb6ff", onAccent: "#161228", label: "月夜全息" },
});

export function panelThemePaint(panelTheme, followHost = false) {
  if (followHost) return null;
  return PANEL_THEME_PAINT[panelTheme] || null;
}

export function describeWidgetFrame({
  requestedPanelTheme = "auto",
  resolvedPanelTheme = "classic",
  resolvedPanelLabel = "经典柔和",
  hostAppearance = "",
  density = "spacious",
  sourceTint = false,
} = {}) {
  const host = hostAppearance === "dark" || hostAppearance === "light" ? hostAppearance : "";
  const requested = String(requestedPanelTheme || "auto");
  const followHost = requested === "auto" && !!host;
  const panelTheme = followHost ? "auto" : (resolvedPanelTheme || "classic");
  const theme = followHost ? host : (DARK_PANEL_THEME_SET.has(panelTheme) ? "dark" : "light");
  const densityName = density === "large" || density === "huge" ? density : "spacious";
  const className = [
    `theme-${theme}`,
    `panel-theme-${panelTheme}`,
    `density-${densityName}`,
    "preset-warm-paper",
    sourceTint ? "source-tint-on" : "source-tint-off",
    host ? "host-frame" : "",
  ].filter(Boolean).join(" ");
  const densityLabel = densityName === "spacious" ? "大字" : densityName === "large" ? "超大" : "巨幕";
  const subtitle = followHost
    ? `跟随界面 · ${host === "dark" ? "深色" : "浅色"} · ${densityLabel}`
    : `${resolvedPanelLabel || "经典柔和"} · ${densityLabel}`;
  return {
    theme,
    panelTheme,
    className,
    hostFrame: !!host,
    followHost,
    subtitle,
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.NotificationHubWidgetAppearance = {
    appearanceFromQuery,
    appearanceFromSnapshot,
    issuedStylesheetUrl,
    describeWidgetFrame,
    panelThemePaint,
    panelThemeLabels: Object.fromEntries(Object.entries(PANEL_THEME_PAINT).map(([id, paint]) => [id, paint.label])),
    darkPanelThemes: DARK_PANEL_THEMES,
    hostDarkThemes: HOST_DARK_THEMES,
  };
  globalThis.dispatchEvent?.(new Event("nh-appearance-ready"));
}
