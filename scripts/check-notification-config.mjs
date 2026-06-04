import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildRuntimeConfig,
  getToastThemeColors,
  normalizeSettings,
  sanitizeSettingsPayload,
  sanitizeVisualPreviewPayload,
  SETTINGS_KEYS,
} from "../lib/notification-config.js";
import { TOAST_EFFECTS } from "../lib/effect-registry.js";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const properties = manifest.contributes.configuration.properties;
const manifestKeys = Object.keys(properties).sort();
const settingsKeys = [...SETTINGS_KEYS].sort();

assert.deepEqual(settingsKeys, manifestKeys, "SETTINGS_KEYS should match manifest configuration properties");

const enumPairs = {
  visualComboPack: "visualComboPacks",
  notificationSoundTheme: "soundThemes",
  toastStyle: "toastStyles",
  dismissEffect: "dismissEffects",
  particleShape: "particleShapes",
  entranceVisual: "entranceVisuals",
  autoDismissMotion: "autoDismissMotions",
  manualDismissMotion: "manualDismissMotions",
  physicsPreset: "physicsPresets",
  toastTransportMode: "toastTransportModes",
  sakuraTheme: "sakuraThemes",
};

for (const [key, group] of Object.entries(enumPairs)) {
  const manifestEnum = properties[key]?.enum || [];
  const registryEnum = (TOAST_EFFECTS[group] || []).map((item) => item.id);
  assert.deepEqual(manifestEnum, registryEnum, `${key} enum should match TOAST_EFFECTS.${group}`);
}

const comboWithTweaks = normalizeSettings({
  visualComboPack: "emberComet",
  particleShape: "star",
  toastStyle: "paper",
});
assert.equal(comboWithTweaks.visualComboPack, "emberComet", "combo pack id should persist after normalization");
assert.equal(comboWithTweaks.particleShape, "star", "explicit particleShape should override combo template default");
assert.equal(comboWithTweaks.toastStyle, "paper", "explicit toastStyle should override combo template default");
assert.equal(comboWithTweaks.sakuraTheme, "ember", "missing visual fields should still inherit combo template defaults");

assert.deepEqual(sanitizeSettingsPayload({ clickAction: false }), { clickAction: false }, "partial clickAction update should not inject visualComboPack");
assert.deepEqual(sanitizeSettingsPayload({ notificationWidgetTheme: "dark" }), { notificationWidgetTheme: "dark" }, "partial widget update should stay partial");

const packUpdates = sanitizeSettingsPayload({
  visualComboPack: "emberComet",
  particleShape: "star",
});
assert.equal(packUpdates.visualComboPack, "emberComet", "explicit combo update should keep pack id");
assert.equal(packUpdates.particleShape, "star", "explicit payload field should override combo template default");
assert.equal(packUpdates.toastStyle, "hologram", "explicit combo update should include untouched pack defaults");

const noSakura = sanitizeSettingsPayload({ sakuraEnabled: false, dismissEffect: "invalid" });
assert.equal(noSakura.dismissEffect, "fade", "invalid dismissEffect should fall back to fade when sakura is disabled");

const motionSettings = normalizeSettings({
  autoDismissMotion: "click-burst",
  manualDismissMotion: "click-burst",
});
assert.equal(motionSettings.autoDismissMotion, "drift", "auto dismiss motion should reject click-only motion and fall back to drift");
assert.equal(motionSettings.manualDismissMotion, "click-burst", "manual dismiss motion should accept click-burst");

const updates = sanitizeSettingsPayload({
  clickAction: false,
  autoDismissMotion: "burst",
  manualDismissMotion: "click",
  channelAggregationWindowSeconds: "9.6",
  channelAggregationThreshold: "2.2",
});
assert.equal(updates.clickAction, false, "clickAction should survive settings sanitize");
assert.equal(updates.autoDismissMotion, "circle-burst", "legacy auto dismiss motion should sanitize to circle-burst");
assert.equal(updates.manualDismissMotion, "click-burst", "legacy manual dismiss motion should sanitize to click-burst");
assert.equal(updates.channelAggregationWindowSeconds, 10, "integer settings should round consistently");
assert.equal(updates.channelAggregationThreshold, 2, "integer settings should clamp and round consistently");

const legacyVisual = normalizeSettings({
  enableCustomToast: false,
  dismissEffect: "comet",
  autoDismissMotion: "burst",
  manualDismissMotion: "click",
});
assert.equal(legacyVisual.notificationDisplayMode, "native", "legacy enableCustomToast=false should map to native mode");
assert.equal(legacyVisual.particleShape, "comet", "legacy dismissEffect particle shape should migrate to particleShape");
assert.equal(legacyVisual.dismissEffect, "sakura", "unknown legacy dismissEffect should normalize to particle dismiss effect");
assert.equal(legacyVisual.autoDismissMotion, "circle-burst", "widget settings should apply legacy auto motion mapping");
assert.equal(legacyVisual.manualDismissMotion, "click-burst", "widget settings should apply legacy manual motion mapping");

const runtime = buildRuntimeConfig({
  clickAction: false,
  notificationKeywords: "紧急, failure",
  channelAggregationWindowSeconds: "6.7",
  channelAggregationThreshold: "3.1",
});
assert.equal(runtime.clickAction, false, "runtime config should keep clickAction=false");
assert.deepEqual(runtime.keywords, ["紧急", "failure"], "runtime config should parse keywords from normalized settings");
assert.equal(runtime.channelAggregationWindowMs, 7000, "runtime config should reuse centralized integer rounding");
assert.equal(runtime.channelAggregationThreshold, 3, "runtime config should reuse centralized threshold rounding");

const preview = sanitizeVisualPreviewPayload({ dismissEffect: "butterfly", autoDismissMotion: "float" });
assert.equal(preview.particleShape, "butterfly", "preview visual payload should migrate legacy particle shape");
assert.equal(preview.autoDismissMotion, "drift", "preview visual payload should migrate legacy float motion");

for (const theme of TOAST_EFFECTS.sakuraThemes.map((item) => item.id).filter((id) => id !== "auto")) {
  const palette = getToastThemeColors(theme);
  assert.ok(palette?.primary && palette?.accent, `${theme} should have a toast color palette`);
}

console.log("notification config checks ok");
