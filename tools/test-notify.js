/**
 * tools/test-notify.js
 *
 * 测试工具：按 notificationDisplayMode 发送一条测试通知。
 */

import { readHostConfig } from "../lib/host-config.js";
import { isQuietHours, normalizeSettings, sanitizeVisualPreviewPayload } from "../lib/notification-config.js";

export const name = "test-notify";
export const description = "发送一条测试通知，遵守通知显示方式设置";

export const parameters = {
  type: "object",
  properties: {
    message: { type: "string", description: "通知正文", default: "这是一条测试通知" },
  },
};

export async function execute(input, ctx) {
  const { log } = ctx;
  const message = input.message || "这是一条测试通知";
  try {
    const rawConfig = await readHostConfig(ctx);
    const config = normalizeSettings(rawConfig);
    const displayMode = config.notificationDisplayMode;
    if (isQuietHours(config)) return { content: [{ type: "text", text: "免打扰开着，测试没有弹窗" }], details: { displayed: false, status: "suppressed" } };
    const notification = {
      type: "conversation",
      title: "测试通知",
      body: message,
      agentId: "hanako",
      agentName: "Hanako",
      emoji: "🌸",
      primary: "#9b59b6",
      accent: "#e74c3c",
      sound: displayMode === "custom",
      soundTheme: config.conversationNotificationSoundTheme,
      customSoundPath: config.conversationCustomNotificationSoundPath || config.customNotificationSoundPath,
      ...sanitizeVisualPreviewPayload(rawConfig),
    };

    if (displayMode === "off") {
      log.info("test notification popup suppressed by mode=off");
      return { content: [{ type: "text", text: `当前是只记录，测试没有弹窗（mode=${displayMode}）` }] };
    }

    // Prefer the public plugin entrypoint so this tool does not depend on
    // private decoration/refresh method signatures.
    let result;
    if (ctx._notificationHubPlugin?.showCustomToast) {
      result = await ctx._notificationHubPlugin.showCustomToast(notification, { confirmDisplay: true });
    } else if (ctx._customToast?.showConfirmed) {
      result = await ctx._customToast.showConfirmed(notification);
    } else {
      return { content: [{ type: "text", text: "发送失败：自定义弹窗入口不可用" }] };
    }

    if (result?.status !== "shown") return {
      content: [{ type: "text", text: `测试未确认显示：${result?.error || result?.status || "确认入口未返回结果"}（mode=${displayMode}）；未重发` }],
      isError: result?.status !== "suppressed",
      details: { displayed: false, status: result?.status || "failed" },
    };
    log.info(`test notification displayed: ${message} mode=${displayMode}`);
    return { content: [{ type: "text", text: `测试通知已显示：${message}（mode=${displayMode}）` }], details: { displayed: true, status: "shown" } };
  } catch (err) {
    return { content: [{ type: "text", text: `发送失败: ${err.message}` }], isError: true, details: { displayed: false, status: "failed" } };
  }
}
