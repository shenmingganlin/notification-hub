import {
  SOUND_THEMES,
  SOUND_THEME_IDS,
  normalizeSoundTheme,
} from "./sound/sound-registry.js";
import { DARK_PANEL_THEMES } from "../ui/visual-tables.js";

export {
  SOUND_THEMES,
  SOUND_THEME_IDS,
  normalizeSoundTheme,
} from "./sound/sound-registry.js";

// Centralized visual effect registry.
// Add/modify toast visuals here first, then wire the C# renderer for new particle shapes or motions.
// Keeping choices in one JS module prevents manifest/widget/index/custom-toast drift.

export const VISUAL_COMBO_PACKS = Object.freeze({
  custom: Object.freeze({
    label: "自定义",
    fields: Object.freeze({}),
  }),
  magicAir: Object.freeze({
    label: "魔法空气包",
    fields: Object.freeze({
      toastStyle: "glass",
      panelTheme: "glass",
      particleShape: "bubble",
      entranceVisual: "breath-fade",
      autoDismissMotion: "ribbon-flow",
      manualDismissMotion: "vortex",
      physicsPreset: "soft",
      toastTransportMode: "managed",
      autoParticleCountScale: 1.35,
      manualParticleCountScale: 1.55,
      particleSizeScale: 1.15,
      sakuraTheme: "hanako",
    }),
  }),
  cyberBurst: Object.freeze({
    label: "赛博爆裂包",
    fields: Object.freeze({
      toastStyle: "tech",
      panelTheme: "tech",
      particleShape: "pixel",
      entranceVisual: "edge-glow",
      autoDismissMotion: "pixel-rain",
      manualDismissMotion: "shatter-lines",
      physicsPreset: "snappy",
      toastTransportMode: "managed",
      autoParticleCountScale: 1.6,
      manualParticleCountScale: 2.2,
      particleSizeScale: 0.95,
      sakuraTheme: "chatgpt",
    }),
  }),
  auroraPrism: Object.freeze({
    label: "极光棱镜包",
    fields: Object.freeze({
      toastStyle: "aurora",
      panelTheme: "aurora",
      particleShape: "shard",
      entranceVisual: "ripple-bloom",
      autoDismissMotion: "orbit-decay",
      manualDismissMotion: "magnet-snap",
      physicsPreset: "lively",
      toastTransportMode: "managed",
      autoParticleCountScale: 1.45,
      manualParticleCountScale: 1.85,
      particleSizeScale: 1.05,
      sakuraTheme: "rainbow",
    }),
  }),
  physicalToys: Object.freeze({
    label: "物理玩具包",
    fields: Object.freeze({
      toastStyle: "minimal",
      panelTheme: "minimal",
      particleShape: "windmill",
      entranceVisual: "comet-trail",
      autoDismissMotion: "windmill-gust",
      manualDismissMotion: "gravity-fall",
      physicsPreset: "wild",
      toastTransportMode: "managed",
      autoParticleCountScale: 1.2,
      manualParticleCountScale: 1.7,
      particleSizeScale: 1.25,
      sakuraTheme: "butter",
    }),
  }),
  sakuraOverdrive: Object.freeze({
    label: "樱花暴走包",
    fields: Object.freeze({
      toastStyle: "sakura-storm",
      panelTheme: "sakura-storm",
      particleShape: "sakura",
      entranceVisual: "ripple-bloom",
      autoDismissMotion: "vortex",
      manualDismissMotion: "ribbon-flow",
      physicsPreset: "wild",
      toastTransportMode: "managed",
      autoParticleCountScale: 2.45,
      manualParticleCountScale: 3.15,
      particleSizeScale: 1.18,
      sakuraTheme: "sakurastorm",
    }),
  }),
  blackGoldMachine: Object.freeze({
    label: "黑金机械包",
    fields: Object.freeze({
      toastStyle: "obsidian",
      panelTheme: "obsidian",
      particleShape: "gear",
      entranceVisual: "edge-glow",
      autoDismissMotion: "shatter-lines",
      manualDismissMotion: "magnet-snap",
      physicsPreset: "snappy",
      toastTransportMode: "managed",
      autoParticleCountScale: 1.25,
      manualParticleCountScale: 1.85,
      particleSizeScale: 1.05,
      sakuraTheme: "blackgold",
    }),
  }),
  emberComet: Object.freeze({
    label: "余烬彗星包",
    fields: Object.freeze({
      toastStyle: "hologram",
      panelTheme: "ember",
      particleShape: "comet",
      entranceVisual: "comet-trail",
      autoDismissMotion: "orbit-decay",
      manualDismissMotion: "gravity-fall",
      physicsPreset: "lively",
      toastTransportMode: "managed",
      autoParticleCountScale: 1.35,
      manualParticleCountScale: 2.05,
      particleSizeScale: 1.25,
      sakuraTheme: "ember",
    }),
  }),
  moonlitHolo: Object.freeze({
    label: "月夜全息包",
    fields: Object.freeze({
      toastStyle: "hologram",
      panelTheme: "moonlight",
      particleShape: "crescent",
      entranceVisual: "breath-fade",
      autoDismissMotion: "bubble-rise",
      manualDismissMotion: "vortex",
      physicsPreset: "soft",
      toastTransportMode: "managed",
      autoParticleCountScale: 1.15,
      manualParticleCountScale: 1.65,
      particleSizeScale: 1.12,
      sakuraTheme: "moonlight",
    }),
  }),
});

export function visualComboOptions() {
  return Object.entries(VISUAL_COMBO_PACKS).map(([id, pack]) => ({ id, label: pack.label }));
}

export function normalizeVisualComboPack(value) {
  const id = String(value || "custom").trim();
  return Object.prototype.hasOwnProperty.call(VISUAL_COMBO_PACKS, id) ? id : "custom";
}

const RETIRED_ENTRANCE_VISUALS = new Set([
  "classic", "fade", "gather", "scan", "stardust", "prism",
  "dew-well", "crescent-lift", "thread-snap", "curtain-sway", "comet-wake", "arc-return",
  "mist-bloom", "focus-snap", "aurora-veil", "bounce-glow", "drift-wake", "ripple-ring",
]);

export function applyVisualComboPack(config = {}) {
  const packId = normalizeVisualComboPack(config.visualComboPack);
  const pack = VISUAL_COMBO_PACKS[packId];
  if (!pack || packId === "custom") return { ...config, visualComboPack: packId };
  // Combo packs are templates, not locks: pack defaults fill missing fields,
  // explicit user tweaks in config stay on top. A retired entrance id is not a tweak.
  const next = { ...pack.fields, ...config, visualComboPack: packId };
  const rawEntrance = String(config.entranceVisual || "").trim().toLowerCase();
  if (!rawEntrance || RETIRED_ENTRANCE_VISUALS.has(rawEntrance)) {
    next.entranceVisual = pack.fields.entranceVisual;
  }
  return next;
}

export const VISUAL_COMBO_PANEL_THEMES = Object.freeze(Object.fromEntries(
  Object.entries(VISUAL_COMBO_PACKS).map(([id, pack]) => [id, pack.fields.panelTheme || "auto"])
));

export const PANEL_THEME_DARK_HINTS = Object.freeze(new Set(DARK_PANEL_THEMES));

export const TOAST_EFFECTS = Object.freeze({
  visualComboPacks: Object.freeze(visualComboOptions()),
  soundThemes: SOUND_THEMES,

  toastLayouts: Object.freeze([
    { id: "hero", label: "角色名片" },
    { id: "clean", label: "清透卡片" },
    { id: "headline", label: "标题电报" },
    { id: "dialogue", label: "对话便签" },
    { id: "timeline", label: "时间流卡片" },
  ]),

  toastStyles: Object.freeze([
    { id: "classic", label: "经典柔和" },
    { id: "minimal", label: "极简纸片" },
    { id: "glass", label: "琉璃玻璃" },
    { id: "tech", label: "霓虹赛博" },
    { id: "aurora", label: "极光晶格" },
    { id: "sakura-storm", label: "樱暴绯云" },
    { id: "obsidian", label: "黑金机械" },
    { id: "hologram", label: "全息薄膜" },
    { id: "paper", label: "温润纸笺" },
  ]),

  panelThemes: Object.freeze([
    { id: "auto", label: "跟随组合包或界面" },
    { id: "classic", label: "经典柔和" },
    { id: "minimal", label: "极简纸片" },
    { id: "glass", label: "琉璃玻璃" },
    { id: "tech", label: "霓虹赛博" },
    { id: "aurora", label: "极光晶格" },
    { id: "sakura-storm", label: "樱暴绯云" },
    { id: "obsidian", label: "黑金机械" },
    { id: "hologram", label: "全息薄膜" },
    { id: "paper", label: "温润纸笺" },
    { id: "ember", label: "余烬彗星" },
    { id: "moonlight", label: "月夜全息" },
  ]),

  entranceVisuals: Object.freeze([
    { id: "ripple-bloom", label: "波纹绽放" },
    { id: "edge-glow", label: "边缘微光" },
    { id: "breath-fade", label: "呼吸淡入" },
    { id: "comet-trail", label: "彗尾划过" },
    { id: "metal-sweep", label: "金属掠光" },
    { id: "triangle-bloom", label: "三角绽放" },
    { id: "veil-clear", label: "渐变揭幕" },
    { id: "cloud-burst", label: "云雾缭绕" },
  ]),

  particleShapes: Object.freeze([
    { id: "none", label: "无" },
    { id: "moss", label: "苔花" },
    { id: "sakura", label: "樱花" },
    { id: "snowflake", label: "雪花" },
    { id: "butterfly", label: "蝴蝶" },
    { id: "bubble", label: "气泡" },
    { id: "windmill", label: "风车" },
    { id: "star", label: "星芒" },
    { id: "spark", label: "火花" },
    { id: "shard", label: "晶片" },
    { id: "leaf", label: "叶片" },
    { id: "pixel", label: "像素块" },
    { id: "comet", label: "彗星" },
    { id: "gear", label: "金属齿轮" },
    { id: "ember", label: "余烬火羽" },
    { id: "crescent", label: "月牙" },
    { id: "slash", label: "光刃" },
  ]),

  dismissMotions: Object.freeze([
    { id: "drift", label: "飘散" },
    { id: "circle-burst", label: "圆形爆发" },
    { id: "rect-burst", label: "矩形爆发" },
    { id: "click-burst", label: "鼠标位置爆发" },
    { id: "x-burst", label: "X爆发" },
    { id: "vortex", label: "漩涡" },
    { id: "ribbon-flow", label: "丝带气流" },
    { id: "gravity-fall", label: "重力坠落" },
    { id: "orbit-decay", label: "轨道衰减" },
    { id: "bubble-rise", label: "气泡上浮" },
    { id: "windmill-gust", label: "风车阵风" },
    { id: "shatter-lines", label: "晶裂线" },
    { id: "pixel-rain", label: "像素雨" },
    { id: "magnet-snap", label: "磁吸弹射" },
  ]),

  toastTransportModes: Object.freeze([
    { id: "managed", label: "群舞弹簧" },
    { id: "independent", label: "独奏轻弹" },
  ]),

  autoDismissMotions: Object.freeze([
    { id: "drift", label: "飘散" },
    { id: "circle-burst", label: "圆形爆发" },
    { id: "rect-burst", label: "矩形爆发" },
    { id: "x-burst", label: "X爆发" },
    { id: "vortex", label: "漩涡" },
    { id: "ribbon-flow", label: "丝带气流" },
    { id: "gravity-fall", label: "重力坠落" },
    { id: "orbit-decay", label: "轨道衰减" },
    { id: "bubble-rise", label: "气泡上浮" },
    { id: "windmill-gust", label: "风车阵风" },
    { id: "shatter-lines", label: "晶裂线" },
    { id: "pixel-rain", label: "像素雨" },
    { id: "magnet-snap", label: "磁吸弹射" },
  ]),

  manualDismissMotions: Object.freeze([
    { id: "drift", label: "飘散" },
    { id: "circle-burst", label: "圆形爆发" },
    { id: "rect-burst", label: "矩形爆发" },
    { id: "click-burst", label: "鼠标位置爆发" },
    { id: "x-burst", label: "X爆发" },
    { id: "vortex", label: "漩涡" },
    { id: "ribbon-flow", label: "丝带气流" },
    { id: "gravity-fall", label: "重力坠落" },
    { id: "orbit-decay", label: "轨道衰减" },
    { id: "bubble-rise", label: "气泡上浮" },
    { id: "windmill-gust", label: "风车阵风" },
    { id: "shatter-lines", label: "晶裂线" },
    { id: "pixel-rain", label: "像素雨" },
    { id: "magnet-snap", label: "磁吸弹射" },
  ]),

  physicsPresets: Object.freeze([
    { id: "soft", label: "柔和" },
    { id: "lively", label: "灵动" },
    { id: "snappy", label: "紧致" },
    { id: "wild", label: "夸张" },
  ]),

  sakuraThemes: Object.freeze([
    { id: "auto", label: "自动(按 Agent)" },
    { id: "hanako", label: "Hanako 粉樱" },
    { id: "butter", label: "Butter 暖金" },
    { id: "chatgpt", label: "ChatGPT 冷蓝" },
    { id: "ming", label: "Ming 紫罗兰" },
    { id: "kong", label: "Kong 翡翠" },
    { id: "rainbow", label: "彩虹缤纷" },
    { id: "sakurastorm", label: "樱花暴走" },
    { id: "blackgold", label: "黑金机械" },
    { id: "ember", label: "余烬橙金" },
    { id: "moonlight", label: "月光蓝紫" },
    { id: "neonmint", label: "薄荷霓虹" },
  ]),
});

export function ids(group) {
  return (TOAST_EFFECTS[group] || []).map((item) => item.id);
}

export function labels(group) {
  return (TOAST_EFFECTS[group] || []).map((item) => item.label);
}

export function normalizeEffect(group, value, fallback) {
  const allowed = ids(group);
  const text = String(value || fallback || "").trim();
  return allowed.includes(text) ? text : fallback;
}

export function normalizePanelTheme(value) {
  return normalizeEffect("panelThemes", value, "auto");
}

export function resolvePanelTheme(value, visualComboPack = "custom") {
  const normalized = normalizePanelTheme(value);
  if (normalized !== "auto") return normalized;
  return VISUAL_COMBO_PANEL_THEMES[normalizeVisualComboPack(visualComboPack)] || "classic";
}

export function visualCatalog() {
  return {
    packs: VISUAL_COMBO_PACKS,
    options: TOAST_EFFECTS,
  };
}
