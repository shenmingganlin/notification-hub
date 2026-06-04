/**
 * tools/test-notify.js
 *
 * 测试工具：按 notificationDisplayMode 发送一条测试通知。
 */

import { normalizeSettings, sanitizeVisualPreviewPayload } from "../lib/notification-config.js";

export const name = "test-notify";
export const description = "发送一条测试通知，遵守通知显示方式设置";

export const parameters = {
  type: "object",
  properties: {
    message: { type: "string", description: "通知正文", default: "这是一条测试通知" },
  },
};

function readConfig(ctx) {
  const config = ctx?.config;
  try {
    if (config?.getAll) return config.getAll() || {};
    if (config?.get) return config.get() || {};
  } catch (err) {
    ctx?.log?.warn?.("notification-hub test-notify read config failed:", err?.message || err);
  }
  return config && typeof config === "object" ? config : {};
}

export async function execute(input, ctx) {
  const { bus, log } = ctx;
  const message = input.message || "这是一条测试通知";
  const rawConfig = readConfig(ctx);
  const config = normalizeSettings(rawConfig);
  const displayMode = config.notificationDisplayMode;

  try {
    const notification = {
      type: "conversation",
      title: "测试通知",
      body: message,
      agentId: "hanako",
      agentName: "Hanako",
      emoji: "🌸",
      primary: "#9b59b6",
      accent: "#e74c3c",
      sound: displayMode === "custom" || displayMode === "native",
      soundTheme: config.notificationSoundTheme,
      ...sanitizeVisualPreviewPayload(rawConfig),
    };

    if (displayMode === "custom") {
      // Prefer the public plugin entrypoint so this tool does not depend on
      // private decoration/refresh method signatures.
      if (ctx._notificationHubPlugin?.showCustomToast) {
        ctx._notificationHubPlugin.showCustomToast(notification);
      } else if (ctx._customToast) {
        ctx._customToast.show(notification);
      } else {
        // 回退：手动发到通知总线
        bus.emit({ type: "notification", title: "🌸 测试通知", body: message, agentId: "hanako" }, null);
      }
    } else if (displayMode === "native") {
      bus.emit({ type: "notification", title: "🌸 测试通知", body: message, agentId: "hanako" }, null);
    } else {
      log.info("test notification popup suppressed by mode=off");
    }

    log.info(`test notification sent: ${message} mode=${displayMode}`);
    return { content: [{ type: "text", text: `测试通知已发送：${message}（mode=${displayMode}）` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `发送失败: ${err.message}` }] };
  }
}
