/**
 * tools/clear-notifications.js
 *
 * 清空所有通知历史记录。
 */
import path from "node:path";

export const name = "clear-notifications";
export const description = "清空所有通知历史记录";

export const parameters = {
  type: "object",
  properties: {
    confirm: {
      type: "boolean",
      description: "确认清空，必须设为 true",
    },
  },
  required: ["confirm"],
};

export async function execute(input, ctx) {
  if (input.confirm !== true) {
    return { content: [{ type: "text", text: "请将 confirm 设为 true 以确认清空" }] };
  }

  const { dataDir, log } = ctx;
  const storePath = path.join(dataDir, "notifications.jsonl");

  try {
    if (ctx._notificationStore?.clear) {
      ctx._notificationStore.clear();
      return { content: [{ type: "text", text: "已清空所有通知历史记录" }] };
    }
    const fs = await import("node:fs");
    fs.writeFileSync(storePath, "", "utf-8");
    return { content: [{ type: "text", text: "已清空所有通知历史记录" }] };
  } catch (err) {
    return { content: [{ type: "text", text: `清空失败: ${err.message}` }] };
  }
}
