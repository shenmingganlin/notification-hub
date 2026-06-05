import assert from "node:assert/strict";
import { execute } from "../tools/test-notify.js";

function createCtx(rawConfig = {}) {
  const emitted = [];
  const logs = [];
  const shown = [];
  const publicCalls = [];
  const ctx = {
    config: {
      getAll: () => ({ ...rawConfig }),
    },
    bus: {
      emit: (event, sessionPath) => emitted.push({ event, sessionPath }),
    },
    log: {
      info: (...args) => logs.push(args.join(" ")),
      warn: (...args) => logs.push(args.join(" ")),
    },
    _notificationHubPlugin: {
      showCustomToast: (notification) => publicCalls.push(notification),
      _refreshConfigNow: () => {
        throw new Error("test-notify should not call private _refreshConfigNow");
      },
      _decorateToastNotification: () => {
        throw new Error("test-notify should not call private _decorateToastNotification");
      },
    },
    _customToast: {
      show: (notification) => shown.push(notification),
    },
  };
  return { ctx, emitted, logs, shown, publicCalls };
}

{
  const { ctx, emitted, shown, publicCalls } = createCtx({
    notificationDisplayMode: "custom",
    notificationSoundTheme: "chime",
    customNotificationSoundPath: "  C:/sounds/global-fallback.wav  ",
    conversationNotificationSoundTheme: "custom",
    conversationCustomNotificationSoundPath: "  C:/sounds/test-notify-chat.wav  ",
  });
  const result = await execute({ message: "公共入口分支" }, ctx);
  assert.equal(publicCalls.length, 1, "custom mode should call the public showCustomToast entrypoint");
  assert.equal(publicCalls[0].body, "公共入口分支", "custom public entrypoint should receive the test notification payload");
  assert.equal(publicCalls[0].sound, true, "custom test notification should enable sound");
  assert.equal(publicCalls[0].soundTheme, "custom", "custom test notification should use the conversation sound theme");
  assert.equal(publicCalls[0].customSoundPath, "C:/sounds/test-notify-chat.wav", "custom test notification should use the conversation custom sound path");
  assert.equal(shown.length, 0, "custom mode with public entrypoint should not bypass through _customToast");
  assert.equal(emitted.length, 0, "custom mode with public entrypoint should not emit native notification");
  assert.match(result.content[0].text, /mode=custom/, "custom result should report custom mode");
}

{
  const { ctx, publicCalls } = createCtx({
    notificationDisplayMode: "custom",
    notificationSoundTheme: "custom",
    customNotificationSoundPath: "  C:/sounds/test-notify-fallback.wav  ",
  });
  await execute({ message: "旧配置兜底" }, ctx);
  assert.equal(publicCalls.length, 1, "legacy custom config should still send one custom test notification");
  assert.equal(publicCalls[0].soundTheme, "custom", "test notification should inherit legacy global sound theme when conversation theme is unset");
  assert.equal(publicCalls[0].customSoundPath, "C:/sounds/test-notify-fallback.wav", "test notification should inherit legacy global custom sound path when conversation path is unset");
}

{
  const { ctx, emitted, shown, publicCalls } = createCtx({ notificationDisplayMode: "native" });
  const result = await execute({ message: "原生分支" }, ctx);
  assert.equal(publicCalls.length, 0, "native mode should not call public custom toast entrypoint");
  assert.equal(shown.length, 0, "native mode should not show custom toast");
  assert.equal(emitted.length, 1, "native mode should emit one notification event");
  assert.deepEqual(emitted[0], {
    event: { type: "notification", title: "🌸 测试通知", body: "原生分支", agentId: "hanako" },
    sessionPath: null,
  }, "native mode should emit a notification event through the bus");
  assert.match(result.content[0].text, /mode=native/, "native result should report native mode");
}

{
  const { ctx, emitted, logs, shown, publicCalls } = createCtx({ notificationDisplayMode: "off" });
  const result = await execute({ message: "关闭分支" }, ctx);
  assert.equal(publicCalls.length, 0, "off mode should not call public custom toast entrypoint");
  assert.equal(shown.length, 0, "off mode should not show custom toast");
  assert.equal(emitted.length, 0, "off mode should not emit native notification");
  assert.ok(logs.some((line) => line.includes("popup suppressed by mode=off")), "off mode should log popup suppression");
  assert.match(result.content[0].text, /mode=off/, "off result should report off mode");
}

console.log("test-notify checks ok");
