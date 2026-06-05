import assert from "node:assert/strict";
import Plugin from "../index.js";
import registerWidgetRoutes from "../routes/widget.js";
import { TOAST_EFFECTS, SOUND_THEMES, SOUND_THEME_IDS, normalizeSoundTheme } from "../lib/effect-registry.js";
import {
  normalizeCustomSoundPath,
  soundThemeIds,
  soundThemeOptions,
} from "../lib/sound/sound-registry.js";
import {
  resolveCustomSoundPath,
  resolveNotificationCustomSoundPath,
  resolveNotificationSound,
  resolveNotificationSoundTheme,
  resolveScopedSound,
  resolveStatusSoundTheme,
  shouldPlaySound,
} from "../lib/sound/sound-resolver.js";
import {
  decideNotificationSound,
  SOUND_DECISION_PATH_SOURCES,
  validateCustomSoundPath,
} from "../lib/sound/sound-decision.js";
import {
  resolveSoundPickerTarget,
  SOUND_PICKER_TARGETS,
  SOUND_FILE_FILTER,
} from "../lib/sound/windows-sound-picker.js";

assert.deepEqual(TOAST_EFFECTS.soundThemes, SOUND_THEMES, "legacy TOAST_EFFECTS.soundThemes should use the sound registry");
assert.deepEqual(soundThemeIds(), [...SOUND_THEME_IDS], "soundThemeIds should mirror SOUND_THEME_IDS");
assert.deepEqual(soundThemeOptions().map((item) => item.id), [...SOUND_THEME_IDS], "soundThemeOptions should expose all sound themes");
assert.equal(normalizeSoundTheme("chimes"), "chime", "legacy chimes alias should normalize to chime");
assert.equal(normalizeSoundTheme("bad", "alarm"), "alarm", "invalid themes should fall back to a valid fallback");
assert.equal(normalizeCustomSoundPath("  C:/tones/a.wav  "), "C:/tones/a.wav", "custom sound paths should be trimmed");

const config = {
  conversationNotificationSoundTheme: "custom",
  conversationCustomNotificationSoundPath: "  C:/tones/chat.wav  ",
  channelNotificationSoundTheme: "alarm",
  channelCustomNotificationSoundPath: "",
  importantNotificationSound: true,
  notificationSoundTheme: "chime",
  customNotificationSoundPath: "  D:/tones/global.mp3  ",
};

assert.equal(resolveNotificationSoundTheme(config, "conversation", "normal"), "custom", "conversation should use scoped sound theme");
assert.equal(resolveNotificationSoundTheme(config, "channel", "normal"), "alarm", "channel should use scoped sound theme");
assert.equal(resolveStatusSoundTheme(config, false), "chime", "normal status should use global sound theme");
assert.equal(resolveStatusSoundTheme(config, true), "alert", "important status should upgrade non-custom global theme to alert");
assert.equal(shouldPlaySound(config, "conversation", "normal"), true, "conversation sound should play unless its theme is off");
assert.equal(shouldPlaySound(config, "channel", "normal"), true, "channel sound should play unless its theme is off");
assert.equal(shouldPlaySound({ ...config, conversationNotificationSoundTheme: "off" }, "conversation", "normal"), false, "off conversation theme should suppress conversation sound");
assert.equal(shouldPlaySound({ ...config, channelNotificationSoundTheme: "off" }, "channel", "normal"), false, "off channel theme should suppress channel sound");
assert.equal(shouldPlaySound({ ...config, notificationSoundTheme: "off" }, "status", "important"), false, "off theme should suppress important status sound");
assert.equal(resolveNotificationCustomSoundPath(config, "conversation"), "C:/tones/chat.wav", "conversation should use scoped custom path first");
assert.equal(resolveNotificationCustomSoundPath(config, "channel"), "D:/tones/global.mp3", "channel should fall back to global custom path");
assert.equal(resolveCustomSoundPath(config, { type: "conversation", customSoundPath: "  E:/explicit.wav  " }), "E:/explicit.wav", "explicit notification custom path should win");
assert.deepEqual(resolveScopedSound(config, "channel"), {
  soundTheme: "alarm",
  customSoundPath: "",
}, "scoped sound helper should return theme without custom path when theme is not custom");
assert.deepEqual(resolveNotificationSound(config, { type: "conversation", importance: "normal" }), {
  sound: true,
  soundTheme: "custom",
  customSoundPath: "C:/tones/chat.wav",
}, "notification sound helper should decorate a notification sound payload");

{
  const explicit = decideNotificationSound(config, { type: "conversation", importance: "normal" });
  assert.equal(explicit.enabled, true, "conversation custom decision should play");
  assert.equal(explicit.soundTheme, "custom", "conversation decision should keep custom theme");
  assert.equal(explicit.customSoundPath, "C:/tones/chat.wav", "conversation explicit scoped custom path should win");
  assert.equal(explicit.pathSource, SOUND_DECISION_PATH_SOURCES.EXPLICIT_SCOPED, "conversation path source should be explicit-scoped");
  assert.match(explicit.reason, /explicit scoped/, "conversation decision should explain scoped source");
}

{
  const inherited = decideNotificationSound({ ...config, conversationCustomNotificationSoundPath: "" }, { type: "conversation", importance: "normal" });
  assert.equal(inherited.customSoundPath, "D:/tones/global.mp3", "blank conversation scoped path should inherit global custom path");
  assert.equal(inherited.pathSource, SOUND_DECISION_PATH_SOURCES.INHERITED_GLOBAL, "blank conversation scoped path should report inherited-global source");
}

{
  const off = decideNotificationSound({ ...config, channelNotificationSoundTheme: "off" }, { type: "channel", importance: "normal" });
  assert.equal(off.enabled, false, "channel off decision should disable sound");
  assert.equal(off.soundTheme, "off", "channel off decision should keep off theme");
  assert.equal(off.customSoundPath, "", "disabled channel sound should not carry a playable custom path");
}

{
  const status = decideNotificationSound({ ...config, notificationSoundTheme: "custom" }, { type: "status", importance: "important" });
  assert.equal(status.enabled, true, "important status custom decision should play");
  assert.equal(status.customSoundPath, "D:/tones/global.mp3", "status custom path should use global custom path");
  assert.equal(status.pathSource, SOUND_DECISION_PATH_SOURCES.GLOBAL, "status custom path source should be global");
}

{
  const missing = decideNotificationSound({ ...config, conversationCustomNotificationSoundPath: "", customNotificationSoundPath: "" }, { type: "conversation", importance: "normal" });
  assert.equal(missing.enabled, true, "missing custom path should deterministically fall back instead of silently failing");
  assert.equal(missing.soundTheme, "chime", "missing custom path should fall back to chime");
  assert.equal(missing.customSoundPath, "", "missing custom path fallback should not carry a stale custom path");
  assert.ok(missing.diagnostics.some((item) => item.includes("custom sound path is empty")), "missing custom path should emit diagnostics");
}

{
  const missingFile = validateCustomSoundPath("C:/definitely-not-here/missing.mp3", { checkFileExists: true });
  assert.equal(missingFile.ok, false, "file existence checks should reject missing files when enabled");
  assert.ok(missingFile.diagnostics.some((item) => item.includes("does not exist")), "missing file validation should explain the missing file");
}

{
  const badExt = validateCustomSoundPath("C:/tones/not-a-sound.txt");
  assert.equal(badExt.ok, false, "unsupported extensions should be rejected by the decision seam");
  assert.ok(badExt.diagnostics.some((item) => item.includes("unsupported")), "unsupported extension validation should emit diagnostics");
}

assert.deepEqual(SOUND_PICKER_TARGETS, {
  conversation: "conversationCustomNotificationSoundPath",
  channel: "channelCustomNotificationSoundPath",
  status: "customNotificationSoundPath",
  global: "customNotificationSoundPath",
}, "sound picker targets should stay explicit and whitelisted");
assert.deepEqual(resolveSoundPickerTarget("conversation"), {
  id: "conversation",
  configKey: "conversationCustomNotificationSoundPath",
}, "conversation picker target should resolve to the conversation custom path key");
assert.equal(resolveSoundPickerTarget("unknown"), null, "unknown picker targets should be rejected before opening a dialog");
assert.ok(SOUND_FILE_FILTER.includes("*.wav") && SOUND_FILE_FILTER.includes("*.mp3") && SOUND_FILE_FILTER.includes("*.m4a"), "sound picker filter should include common audio formats");

{
  const oldPath = "C:/tones/old.wav";
  const newPath = "C:/tones/new.wav";
  const storedConfig = {
    notificationDisplayMode: "custom",
    notificationSoundTheme: "custom",
    customNotificationSoundPath: "C:/tones/global.wav",
    conversationNotificationSoundTheme: "custom",
    conversationCustomNotificationSoundPath: oldPath,
  };
  let setManyUpdates = null;
  const shown = [];
  const p = Object.create(Plugin.prototype);
  p.ctx = { log: { info(){}, warn(){}, error(){} } };
  p._cfg = p._buildRuntimeConfig(storedConfig);
  p._lastRawConfigSnapshot = p._configSnapshot(storedConfig);
  p._channelAggregation = new Map();
  p._customToast = { show(n) { shown.push(n); }, setTransportMode() {} };
  p._store = { push(n) { return n; } };
  p._agentResolver = {
    get(id) {
      return {
        id,
        displayName: "ChatGPT",
        theme: { emoji: "🤖", primary: "#10a37f", accent: "#74b9ff" },
      };
    },
    resolveFromSender(id) { return this.get(id || "chatgpt"); },
  };

  const ctx = {
    config: {
      getAll() { return storedConfig; },
      setMany(updates) { setManyUpdates = updates; },
    },
    log: { info(){}, warn(){}, error(){} },
    _notificationHubPlugin: p,
  };
  const routes = new Map();
  registerWidgetRoutes({
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
  }, ctx);

  const response = await routes.get("POST /settings")({
    req: { json: async () => ({ conversationNotificationSoundTheme: "custom", conversationCustomNotificationSoundPath: newPath }) },
    json(value) { return value; },
  });

  assert.equal(setManyUpdates.conversationCustomNotificationSoundPath, newPath, "settings POST should persist the new scoped conversation sound path");
  assert.equal(response.settings.conversationCustomNotificationSoundPath, newPath, "settings POST response should reflect the applied runtime snapshot even if getAll is stale");

  p._handleConversationEnd({ message: { stopReason: "end", content: "hello" } }, "C:/HanaAgent/agents/chatgpt/sessions/session.jsonl");
  assert.equal(shown.length, 1, "conversation end should emit one custom toast");
  assert.equal(shown[0].customSoundPath, newPath, "conversation notification should use the just-saved scoped custom sound path, not stale getAll data");
}

console.log("sound system checks ok");
