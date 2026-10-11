import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildRuntimeConfig,
  getToastThemeColors,
  isQuietHours,
  muteKeyForNotification,
  normalizeSettings,
  reconcileCustomSoundPathInheritance,
  sanitizeSettingsPayload,
  sanitizeVisualPreviewPayload,
  SETTINGS_KEYS,
} from "../lib/notification-config.js";
import { TOAST_EFFECTS, VISUAL_COMBO_PACKS } from "../lib/effect-registry.js";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const properties = manifest.contributes.settings?.schema?.properties || manifest.contributes.configuration?.properties;
const manifestKeys = Object.keys(properties).sort();
const settingsKeys = [...SETTINGS_KEYS].sort();

assert.deepEqual(settingsKeys, manifestKeys, "SETTINGS_KEYS should match manifest configuration properties");
assert.equal(manifest.contributes.settings?.ui?.route, "/widget.html", "host settings should use the widget settings page");
assert.equal(manifest.contributes.cards?.[0]?.route, "/widget.html", "notification card should keep using the widget settings page");
const widgetRoutesSource = fs.readFileSync(new URL("../server/widget-routes.js", import.meta.url), "utf8");
assert.doesNotMatch(widgetRoutesSource, /ctx\.config\??\.(?:setMany|set)\s*\(/, "widget routes should use writeHostConfig instead of writing config directly");
assert.equal(properties.particleShape.title, "粒子形状", "host settings should name the particle shape, not a dismiss effect");
assert.equal(properties.notificationWidgetDensity.title, "通知中心显示密度", "host settings should name the notification page, not a widget");
assert.equal(properties.notificationSoundTheme.title, "状态/兜底提示音", "status sound should not be named as the important-notification theme");
assert.equal(properties.enableStatusNotifications.title, "状态监控通知", "status switch title should match the page");
assert.match(properties.enableStatusNotifications.description, /不控制错误和任务完成/, "status switch should not claim to gate errors or task-done");
assert.doesNotMatch(properties.enableErrorNotifications.description, /状态监控关闭时/, "error copy should not require the status switch");
assert.doesNotMatch(properties.enableTaskDoneNotifications.description, /状态监控关闭时/, "task-done copy should not require the status switch");
assert.doesNotMatch(properties.sakuraEnabled.description, /只淡出/, "turning particles off should not claim the card only fades");
assert.doesNotMatch(properties.physicsPreset.description, /退场微动/, "physics copy should not claim it moves the exiting card");
assert.match(properties.panelTheme.description, /自动时跟随界面深浅/, "host panel theme copy should match the page");
assert.equal(properties.visualComboPack.title, "组合包", "host combo title should match the page");
assert.doesNotMatch(properties.visualComboPack.description, /粒子贴图/, "combo copy should not say particle stickers");
assert.deepEqual(properties.notificationDisplayMode.ui.enumLabels, ["自定义弹窗", "仅记录到列表"], "display mode labels should match the page");
assert.doesNotMatch(properties.toastTransportMode.description, /以后新的/, "transport copy should not promise future motion");
assert.equal(properties.toastStyle.title, "卡片风格", "host card style title should match the page");

const toastSource = fs.readFileSync(new URL("../lib/custom-toast.js", import.meta.url), "utf8");
assert.doesNotMatch(toastSource, /butterflyCount/, "create payload should not send the unused butterfly count");

const enumPairs = {
  visualComboPack: "visualComboPacks",
  toastLayout: "toastLayouts",
  conversationNotificationSoundTheme: "soundThemes",
  channelNotificationSoundTheme: "soundThemes",
  notificationSoundTheme: "soundThemes",
  importantNotificationSoundTheme: "soundThemes",
  toastStyle: "toastStyles",
  panelTheme: "panelThemes",
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
  const registryItems = TOAST_EFFECTS[group] || [];
  assert.deepEqual(manifestEnum, registryItems.map((item) => item.id), `${key} enum should match TOAST_EFFECTS.${group}`);
  assert.deepEqual(properties[key]?.ui?.enumLabels, registryItems.map((item) => item.label), `${key} labels should match TOAST_EFFECTS.${group}`);
}
assert.equal(normalizeSettings({ entranceVisual: "prism" }).entranceVisual, "ripple-bloom", "retired entrance visuals should fall back to ripple-bloom");
assert.equal(normalizeSettings({ entranceVisual: "scan" }).entranceVisual, "ripple-bloom", "retired scan entrance should fall back to ripple-bloom");
assert.equal(normalizeSettings({ entranceVisual: "dew-well" }).entranceVisual, "ripple-bloom", "the rejected 0.3.30 lights should fall back to ripple-bloom");
assert.equal(normalizeSettings({ entranceVisual: "mist-bloom" }).entranceVisual, "ripple-bloom", "the old 0.3.30 lights should fall back to ripple-bloom");
assert.equal(normalizeSettings({ entranceVisual: "no-such-light" }).entranceVisual, "ripple-bloom", "unknown entrance visuals should fall back to ripple-bloom");
assert.equal(normalizeSettings({ visualComboPack: "cyberBurst", entranceVisual: "scan" }).entranceVisual, "edge-glow", "a retired entrance should not block the combo pack's new light");
assert.equal(normalizeSettings({ visualComboPack: "emberComet", entranceVisual: "comet-wake" }).entranceVisual, "comet-trail", "a rejected 0.3.30 entrance should not block the combo pack's new light");
assert.equal(normalizeSettings({ visualComboPack: "cyberBurst", entranceVisual: "comet-trail" }).entranceVisual, "comet-trail", "an explicit new entrance should still override the combo pack");
assert.equal(normalizeSettings({}).entranceVisual, "ripple-bloom", "missing entrance visual should default to ripple-bloom");
assert.equal(normalizeSettings({}).importantNotificationSoundTheme, "alert", "important sound theme should default to alert");
assert.equal(normalizeSettings({ importantNotificationSoundTheme: "custom", importantCustomNotificationSoundPath: " C:/sounds/important.wav " }).importantCustomNotificationSoundPath, "C:/sounds/important.wav", "important custom path should be normalized");
assert.deepEqual(sanitizeSettingsPayload({ importantNotificationSoundTheme: "off", importantCustomNotificationSoundPath: " C:/sounds/important.wav " }), { importantNotificationSoundTheme: "off", importantCustomNotificationSoundPath: "C:/sounds/important.wav" }, "important sound settings should be accepted by the sanitizer");

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
const legacyWidgetSave = sanitizeSettingsPayload({ notificationWidgetTheme: "dark" });
assert.equal(legacyWidgetSave.panelTheme, "obsidian", "partial legacy dark widget theme should migrate to the obsidian panel theme");
assert.equal(Object.prototype.hasOwnProperty.call(legacyWidgetSave, "notificationWidgetTheme"), false, "partial update should not write the retired widget theme back");
const legacyWidgetAuto = sanitizeSettingsPayload({ notificationWidgetTheme: "auto" });
assert.equal(Object.prototype.hasOwnProperty.call(legacyWidgetAuto, "panelTheme"), false, "legacy auto widget theme should not invent a panel theme");
assert.equal(Object.prototype.hasOwnProperty.call(legacyWidgetAuto, "notificationWidgetTheme"), false, "legacy auto widget theme should not be written back");
const explicitPanel = sanitizeSettingsPayload({ panelTheme: "moonlight", notificationWidgetTheme: "dark" });
assert.equal(explicitPanel.panelTheme, "moonlight", "explicit panel theme should win over the retired widget theme");
assert.equal(Object.prototype.hasOwnProperty.call(explicitPanel, "notificationWidgetTheme"), false, "explicit panel update should not write the retired widget theme back");
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
assert.equal(Object.prototype.hasOwnProperty.call(legacyDarkPanel, "notificationWidgetTheme"), false, "normalized settings should not write the retired widget theme back");
assert.equal(normalizeSettings({ notificationWidgetTheme: "light" }).panelTheme, "classic", "legacy light widget theme should map to the classic panel theme");

const comboAutoPanel = normalizeSettings({ visualComboPack: "moonlitHolo", panelTheme: "auto" });
assert.equal(comboAutoPanel.panelTheme, "auto", "explicit auto panel theme should be stored as auto");
assert.equal(normalizeSettings({ visualComboPack: "cyberBurst", panelTheme: "moonlight" }).panelTheme, "moonlight", "a saved panel theme must survive the combo pack on the next read");
const savedPanel = sanitizeSettingsPayload({
  visualComboPack: "cyberBurst",
  panelTheme: "moonlight",
  toastStyle: "tech",
});
assert.equal(savedPanel.panelTheme, "moonlight", "saving the page must not replace an explicit panel theme with the pack default or classic");

const noSakura = sanitizeSettingsPayload({ sakuraEnabled: false, dismissEffect: "invalid" });
assert.equal(noSakura.sakuraEnabled, false, "sakura switch should survive when a retired dismiss field is sent");
assert.equal(Object.prototype.hasOwnProperty.call(noSakura, "dismissEffect"), false, "invalid retired dismiss field should not be written back");
assert.equal(Object.prototype.hasOwnProperty.call(noSakura, "particleShape"), false, "invalid retired dismiss field should not invent a particle shape");
const legacyPartial = sanitizeSettingsPayload({ dismissEffect: "butterfly" });
assert.equal(legacyPartial.particleShape, "butterfly", "partial update should migrate a legacy particle shape");
assert.equal(Object.prototype.hasOwnProperty.call(legacyPartial, "dismissEffect"), false, "partial update should not write the retired dismiss field back");
const sentinelPack = sanitizeSettingsPayload({ visualComboPack: "emberComet", dismissEffect: "sakura" });
assert.equal(sentinelPack.particleShape, "comet", "retired sakura sentinel should not override a combo particle shape");
assert.equal(Object.prototype.hasOwnProperty.call(sentinelPack, "dismissEffect"), false, "combo update should not write the retired dismiss field");
const explicitShape = sanitizeSettingsPayload({ particleShape: "star", dismissEffect: "butterfly" });
assert.equal(explicitShape.particleShape, "star", "explicit particle shape should win over a legacy dismiss field");
for (const [id, pack] of Object.entries(VISUAL_COMBO_PACKS)) {
  assert.equal(Object.prototype.hasOwnProperty.call(pack.fields, "dismissEffect"), false, `${id} should not write the retired dismiss field`);
}

const motionSettings = normalizeSettings({
  autoDismissMotion: "click-burst",
  manualDismissMotion: "click-burst",
});
assert.equal(motionSettings.autoDismissMotion, "drift", "auto dismiss motion should reject click-only motion and fall back to drift");
assert.equal(motionSettings.manualDismissMotion, "click-burst", "manual dismiss motion should accept click-burst");
assert.equal(normalizeSettings({}).cardExitMode, "trajectory", "card exit mode should default to trajectory");
assert.equal(normalizeSettings({}).cardExitFade, true, "card exit fade should default on");
const exitChoice = normalizeSettings({
  visualComboPack: "cyberBurst",
  cardExitMode: "instant",
  cardExitFade: false,
});
assert.equal(exitChoice.cardExitMode, "instant", "combo pack should not overwrite card exit mode");
assert.equal(exitChoice.cardExitFade, false, "combo pack should not overwrite card exit fade");
assert.equal(sanitizeSettingsPayload({ cardExitMode: "nope" }).cardExitMode, "trajectory", "invalid card exit mode should fall back to trajectory");
assert.equal(sanitizeSettingsPayload({ cardExitFade: false }).cardExitFade, false, "card exit fade false should survive sanitizing");

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
assert.equal(legacyVisual.notificationDisplayMode, "custom", "legacy enableCustomToast=false should map to custom mode");
assert.equal(legacyVisual.particleShape, "comet", "legacy dismissEffect particle shape should migrate to particleShape");
assert.equal(Object.prototype.hasOwnProperty.call(legacyVisual, "dismissEffect"), false, "normalized settings should not write the retired dismiss field back");
assert.equal(normalizeSettings({ notificationDisplayMode: "native" }).notificationDisplayMode, "custom", "legacy native mode should normalize to custom");
assert.equal(normalizeSettings({ notificationDisplayMode: "unknown" }).notificationDisplayMode, "custom", "unknown display mode should normalize to custom");
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
assert.equal(Object.prototype.hasOwnProperty.call(preview, "dismissEffect"), false, "preview visual payload should not write the retired dismiss field back");
assert.equal(preview.autoDismissMotion, "drift", "preview visual payload should migrate legacy float motion");

const { CustomToast } = await import("../lib/custom-toast.js");
const aliasDir = fs.mkdtempSync(path.join(os.tmpdir(), "nh-motion-alias-"));
try {
  const aliasedToast = new CustomToast({
    pluginDir: aliasDir,
    dataDir: aliasDir,
    autoDismissMotion: "burst",
    manualDismissMotion: "float",
  });
  assert.equal(aliasedToast.autoDismissMotion, "circle-burst", "toast client should use the shared legacy motion map");
  assert.equal(aliasedToast.manualDismissMotion, "drift", "toast client should map float through the shared motion table");
} finally {
  fs.rmSync(aliasDir, { recursive: true, force: true });
}
const toastClientSource = fs.readFileSync(new URL("../lib/custom-toast.js", import.meta.url), "utf8");
assert.doesNotMatch(toastClientSource, /explosion:\s*"circle-burst"/, "toast client should not keep a second motion alias map");

for (const theme of TOAST_EFFECTS.sakuraThemes.map((item) => item.id).filter((id) => id !== "auto")) {
  const palette = getToastThemeColors(theme);
  assert.ok(palette?.primary && palette?.accent, `${theme} should have a toast color palette`);
}

const toastPayloadSource = fs.readFileSync(new URL("../helper/Models/ToastPayload.cs", import.meta.url), "utf8");
const toastHelperSource = ["../helper/ToastProcess.cs", "../helper/ToastForm.cs", "../helper/Particles/ParticleOverlay.cs"]
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8"))
  .join("\n");
assert.match(toastPayloadSource, /ParticleIntervalEffect\s*=\s*Math\.Max\(0,\s*Math\.Min\(100,\s*GetInt\(raw,\s*"particleIntervalEffect"/, "file payload should parse and clamp particleIntervalEffect");
assert.match(toastHelperSource, /Payload\.GetInt\(json,\s*"particleIntervalEffect"/, "manager create payload should parse particleIntervalEffect");
assert.match(toastHelperSource, /ParticleOverlayHub\.EmitDeferred\([\s\S]*_particleIntervalEffect\)/, "toast exit should pass particleIntervalEffect to the overlay hub");
assert.match(toastHelperSource, /public static void EmitDeferred\([^)]*intervalEffect/, "ParticleOverlayHub.EmitDeferred should accept intervalEffect");
assert.match(toastHelperSource, /void InitParticles\([^)]*intervalEffect/, "InitParticles should accept intervalEffect");
assert.match(toastHelperSource, /ComputeBirthDelayTick\(i,\s*count,\s*normalizedMotion,\s*intervalEffect,\s*lifeMs\)/, "particle birth ticks should use intervalEffect");

assert.equal(isQuietHours({ quietHoursEnabled: true, quietHoursStart: "23:00", quietHoursEnd: "07:00" }, new Date(2026, 9, 7, 23, 30)), true, "quiet hours should cover the late side of midnight");
assert.equal(isQuietHours({ quietHoursEnabled: true, quietHoursStart: "23:00", quietHoursEnd: "07:00" }, new Date(2026, 9, 7, 6, 59)), true, "quiet hours should cover the early side of midnight");
assert.equal(isQuietHours({ quietHoursEnabled: true, quietHoursStart: "23:00", quietHoursEnd: "07:00" }, new Date(2026, 9, 7, 7, 0)), false, "quiet hours should resume at the end minute");
assert.equal(isQuietHours({ quietHoursEnabled: true, quietHoursStart: "12:00", quietHoursEnd: "12:00" }, new Date(2026, 9, 7, 12, 30)), false, "equal quiet-hour bounds should not suppress anything");
assert.equal(isQuietHours({ quietHoursEnabled: false, quietHoursStart: "00:00", quietHoursEnd: "23:59" }, new Date(2026, 9, 7, 12, 0)), false, "quiet hours should stay off until enabled");
assert.equal(normalizeSettings({ quietHoursStart: "7:05" }).quietHoursStart, "07:05", "quiet hour clocks should be padded");
assert.equal(normalizeSettings({ quietHoursStart: "7:5" }).quietHoursStart, "23:00", "an invalid quiet hour clock should fall back");
assert.equal(muteKeyForNotification({ type: "conversation", source: "C:\\Sessions\\A.jsonl" }), "session:c:/sessions/a.jsonl", "session mute keys should be normalized paths");
assert.equal(muteKeyForNotification({ type: "channel", source: "#town", meta: { channelName: "town" } }), "channel:town", "channel mute keys should use the channel name");
assert.equal(muteKeyForNotification({ type: "status", source: "job" }), "", "status notifications should not have a session mute key");

console.log("notification config checks ok");
