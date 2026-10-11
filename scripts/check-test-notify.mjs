import assert from "node:assert/strict";
import { execute } from "../tools/test-notify.js";
import registerWidgetRoutes from "../server/widget-routes.js";

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
      showCustomToast: (notification, options) => { assert.equal(options.confirmDisplay, true); publicCalls.push(notification); return { status: "shown" }; },
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
  const result = await execute({ message: "旧原生配置" }, ctx);
  assert.equal(publicCalls.length, 1, "legacy native mode should normalize to custom and call the public toast entrypoint");
  assert.equal(shown.length, 0, "public custom toast should be preferred");
  assert.equal(emitted.length, 0, "legacy native mode should not emit a bus notification");
  assert.match(result.content[0].text, /mode=custom/, "legacy native mode should report normalized custom mode");
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

function createTestNotificationRoute(rawConfig, { show, customToast, warnings = [] } = {}) {
  const routes = new Map();
  const ctx = {
    config: { getAll: () => ({ ...rawConfig }) },
    dataDir: "C:/notification-hub-test-data",
    log: { info() {}, warn: (...args) => warnings.push(args.join(" ")) },
    notifications: show ? { show } : undefined,
    _customToast: customToast ? { showConfirmed: (notification) => { customToast(notification); return { status: "shown" }; } } : undefined,
  };
  registerWidgetRoutes({ get(path, handler) { routes.set(`GET ${path}`, handler); }, post(path, handler) { routes.set(`POST ${path}`, handler); } }, ctx);
  const handler = routes.get("POST /test-notification");
  return async (body = {}) => handler({ req: { json: async () => body }, json: (value) => value });
}

{
  const shown = [];
  const run = createTestNotificationRoute({ notificationDisplayMode: "custom" }, { customToast: (notification) => shown.push(notification) });
  const result = await run({ preview: true, testType: "conversation", toastScale: 1.15, toastStyle: "glass" });
  assert.equal(result.ok, true, "custom preview should succeed");
  assert.equal(shown.length, 1, "custom preview should show one custom toast");
  assert.equal(shown[0].toastScale, 1.15, "custom preview should preserve preview visual fields");
  assert.equal(shown[0].toastStyle, "glass", "custom preview should preserve card style");
}

{
  const shown = [];
  const run = createTestNotificationRoute({ notificationDisplayMode: "native" }, { show: () => assert.fail("legacy native preview must not call host notifications"), customToast: (notification) => shown.push(notification) });
  const result = await run({ preview: true, testType: "conversation" });
  assert.equal(result.ok, true, "legacy native preview should normalize to custom");
  assert.match(result.message, /已预览对话结束通知/, "legacy native preview should use custom preview response");
  assert.equal(shown.length, 1, "legacy native preview should show a custom toast");
}

{
  const shown = [];
  const run = createTestNotificationRoute({ notificationDisplayMode: "off" }, { customToast: (notification) => shown.push(notification) });
  assert.deepEqual(await run(), { ok: true, displayed: false, status: "suppressed", message: "当前是只记录，测试没有弹窗" }, "off mode should explain that the test was recorded only");
  assert.equal(shown.length, 0, "off mode should not show a custom toast");
}

{
  const shown = [];
  const now = new Date();
  const start = new Date(now.getTime() - 60_000).toTimeString().slice(0, 5);
  const end = new Date(now.getTime() + 60_000).toTimeString().slice(0, 5);
  const run = createTestNotificationRoute({ notificationDisplayMode: "custom", quietHoursEnabled: true, quietHoursStart: start, quietHoursEnd: end }, { customToast: (notification) => shown.push(notification) });
  assert.deepEqual(await run({ preview: true }), { ok: true, displayed: false, status: "suppressed", message: "免打扰开着，测试没有弹窗" }, "quiet hours should block preview tests");
  assert.deepEqual(await run(), { ok: true, displayed: false, status: "suppressed", message: "免打扰开着，测试没有弹窗" }, "quiet hours should block saved-config tests");
  assert.equal(shown.length, 0, "quiet hours should suppress both preview and saved-config tests");
}

console.log("test-notify checks ok");
