import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildRuntimeConfig,
  getToastThemeColors,
  normalizeSettings,
  reconcileCustomSoundPathInheritance,
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
  conversationNotificationSoundTheme: "soundThemes",
  channelNotificationSoundTheme: "soundThemes",
  notificationSoundTheme: "soundThemes",
  toastStyle: "toastStyles",
  panelTheme: "panelThemes",
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
assert.equal(comboWithTweaks.panelTheme, "ember", "missing panelTheme should inherit combo panel theme default");
assert.equal(comboWithTweaks.sakuraTheme, "ember", "missing visual fields should still inherit combo template defaults");

assert.deepEqual(sanitizeSettingsPayload({ clickAction: false }), { clickAction: false }, "partial clickAction update should not inject visualComboPack");
assert.deepEqual(sanitizeSettingsPayload({ notificationWidgetTheme: "dark" }), { notificationWidgetTheme: "dark" }, "partial legacy widget update should stay partial");
assert.deepEqual(sanitizeSettingsPayload({ panelTheme: "moonlight" }), { panelTheme: "moonlight" }, "partial panel theme update should stay partial");

const packUpdates = sanitizeSettingsPayload({
  visualComboPack: "emberComet",
  particleShape: "star",
});
assert.equal(packUpdates.visualComboPack, "emberComet", "explicit combo update should keep pack id");
assert.equal(packUpdates.particleShape, "star", "explicit payload field should override combo template default");
assert.equal(packUpdates.toastStyle, "hologram", "explicit combo update should include untouched pack defaults");
assert.equal(packUpdates.panelTheme, "ember", "explicit combo update should include pack panel theme default");

const legacyDarkPanel = normalizeSettings({ notificationWidgetTheme: "dark" });
assert.equal(legacyDarkPanel.panelTheme, "obsidian", "legacy dark widget theme should map to the obsidian panel theme");

const comboAutoPanel = normalizeSettings({ visualComboPack: "moonlitHolo", panelTheme: "auto" });
assert.equal(comboAutoPanel.panelTheme, "auto", "explicit auto panel theme should be stored as auto");

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
  notificationSoundTheme: "custom",
  customNotificationSoundPath: "  C:/sounds/notify.mp3  ",
  conversationNotificationSoundTheme: "ding",
  conversationCustomNotificationSoundPath: "  C:/sounds/chat.wav  ",
  channelNotificationSoundTheme: "alarm",
  channelCustomNotificationSoundPath: "  D:/sounds/channel.mp3  ",
});
assert.equal(runtime.clickAction, false, "runtime config should keep clickAction=false");
assert.deepEqual(runtime.keywords, ["紧急", "failure"], "runtime config should parse keywords from normalized settings");
assert.equal(runtime.channelAggregationWindowMs, 7000, "runtime config should reuse centralized integer rounding");
assert.equal(runtime.channelAggregationThreshold, 3, "runtime config should reuse centralized threshold rounding");
assert.equal(runtime.notificationSoundTheme, "custom", "runtime config should accept the custom sound theme");
assert.equal(runtime.customNotificationSoundPath, "C:/sounds/notify.mp3", "runtime config should trim custom sound paths");
assert.equal(runtime.conversationNotificationSoundTheme, "ding", "runtime config should keep the conversation sound theme separate");
assert.equal(runtime.conversationCustomNotificationSoundPath, "C:/sounds/chat.wav", "runtime config should trim conversation custom sound paths");
assert.equal(runtime.channelNotificationSoundTheme, "alarm", "runtime config should keep the channel sound theme separate");
assert.equal(runtime.channelCustomNotificationSoundPath, "D:/sounds/channel.mp3", "runtime config should trim channel custom sound paths");

const customSoundUpdates = sanitizeSettingsPayload({
  notificationSoundTheme: "custom",
  customNotificationSoundPath: "  D:/tones/chime.wav  ",
  conversationNotificationSoundTheme: "custom",
  conversationCustomNotificationSoundPath: "  D:/tones/chat.wav  ",
  channelNotificationSoundTheme: "notify",
  channelCustomNotificationSoundPath: "  D:/tones/channel.m4a  ",
});
assert.deepEqual(customSoundUpdates, {
  notificationSoundTheme: "custom",
  customNotificationSoundPath: "D:/tones/chime.wav",
  conversationNotificationSoundTheme: "custom",
  conversationCustomNotificationSoundPath: "D:/tones/chat.wav",
  channelNotificationSoundTheme: "notify",
  channelCustomNotificationSoundPath: "D:/tones/channel.m4a",
}, "custom sound settings should sanitize as a partial settings update");

const legacySoundFallback = normalizeSettings({
  notificationSoundTheme: "custom",
  customNotificationSoundPath: "  C:/legacy/fallback.wav  ",
});
assert.equal(legacySoundFallback.conversationNotificationSoundTheme, "custom", "conversation sound theme should inherit the legacy global sound theme when unset");
assert.equal(legacySoundFallback.conversationCustomNotificationSoundPath, "C:/legacy/fallback.wav", "conversation custom sound path should inherit the legacy global custom path when unset");
assert.equal(legacySoundFallback.channelNotificationSoundTheme, "custom", "channel sound theme should inherit the legacy global sound theme when unset");
assert.equal(legacySoundFallback.channelCustomNotificationSoundPath, "C:/legacy/fallback.wav", "channel custom sound path should inherit the legacy global custom path when unset");

const inheritedCustomSoundSave = reconcileCustomSoundPathInheritance(sanitizeSettingsPayload({
  ...normalizeSettings({
    notificationSoundTheme: "custom",
    customNotificationSoundPath: "C:/tones/first.mp3",
  }),
  customNotificationSoundPath: "C:/tones/second.mp3",
}), {
  notificationSoundTheme: "custom",
  customNotificationSoundPath: "C:/tones/first.mp3",
  conversationNotificationSoundTheme: "custom",
  conversationCustomNotificationSoundPath: "C:/tones/first.mp3",
  channelNotificationSoundTheme: "custom",
  channelCustomNotificationSoundPath: "C:/tones/first.mp3",
});
assert.equal(inheritedCustomSoundSave.customNotificationSoundPath, "C:/tones/second.mp3", "global custom sound update should keep the new selected file");
assert.equal(inheritedCustomSoundSave.conversationCustomNotificationSoundPath, "", "inherited conversation custom sound path should not pin the previous global file");
assert.equal(inheritedCustomSoundSave.channelCustomNotificationSoundPath, "", "inherited channel custom sound path should not pin the previous global file");
assert.equal(normalizeSettings({
  notificationSoundTheme: "custom",
  customNotificationSoundPath: inheritedCustomSoundSave.customNotificationSoundPath,
  conversationNotificationSoundTheme: inheritedCustomSoundSave.conversationNotificationSoundTheme,
  conversationCustomNotificationSoundPath: inheritedCustomSoundSave.conversationCustomNotificationSoundPath,
}).conversationCustomNotificationSoundPath, "C:/tones/second.mp3", "cleared inherited conversation path should resolve to the new global custom file");
assert.equal(reconcileCustomSoundPathInheritance({
  customNotificationSoundPath: "C:/tones/second.mp3",
  conversationCustomNotificationSoundPath: "C:/tones/chat.mp3",
}, {
  customNotificationSoundPath: "C:/tones/first.mp3",
  conversationCustomNotificationSoundPath: "C:/tones/chat.mp3",
}).conversationCustomNotificationSoundPath, "C:/tones/chat.mp3", "explicit scoped custom sound path should be preserved when global custom path changes");

const preview = sanitizeVisualPreviewPayload({ dismissEffect: "butterfly", autoDismissMotion: "float" });
assert.equal(preview.particleShape, "butterfly", "preview visual payload should migrate legacy particle shape");
assert.equal(preview.autoDismissMotion, "drift", "preview visual payload should migrate legacy float motion");

for (const theme of TOAST_EFFECTS.sakuraThemes.map((item) => item.id).filter((id) => id !== "auto")) {
  const palette = getToastThemeColors(theme);
  assert.ok(palette?.primary && palette?.accent, `${theme} should have a toast color palette`);
}

const toastPayloadSource = fs.readFileSync(new URL("../helper/Models/ToastPayload.cs", import.meta.url), "utf8");
const toastHelperSource = fs.readFileSync(new URL("../helper/NotificationToastHelper.cs", import.meta.url), "utf8");
assert.match(toastPayloadSource, /ParticleIntervalEffect\s*=\s*Math\.Max\(0,\s*Math\.Min\(100,\s*GetInt\(raw,\s*"particleIntervalEffect"/, "file payload should parse and clamp particleIntervalEffect");
assert.match(toastHelperSource, /Payload\.GetInt\(json,\s*"particleIntervalEffect"/, "manager create payload should parse particleIntervalEffect");
assert.match(toastHelperSource, /ParticleOverlayHub\.Emit\([\s\S]*_particleIntervalEffect\)/, "toast exit should pass particleIntervalEffect to the overlay hub");
assert.match(toastHelperSource, /public static void Emit\([^)]*intervalEffect/, "ParticleOverlayHub.Emit should accept intervalEffect");
assert.match(toastHelperSource, /void InitParticles\([^)]*intervalEffect/, "InitParticles should accept intervalEffect");
assert.match(toastHelperSource, /ComputeBirthDelayTick\(i,\s*count,\s*normalizedMotion,\s*intervalEffect,\s*lifeMs\)/, "particle birth ticks should use intervalEffect");

console.log("notification config checks ok");
