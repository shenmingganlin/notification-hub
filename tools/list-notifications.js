/**
 * tools/list-notifications.js
 *
 * 查询通知历史记录。
 */
import path from "node:path";

export const name = "list-notifications";
export const description = "查询通知历史记录";

export const parameters = {
  type: "object",
  properties: {
    limit: { type: "integer", description: "返回条数，默认 10", default: 10 },
    type: { type: "string", enum: ["conversation", "channel", "dm", "status", ""], description: "筛选通知类型" },
  },
};

export async function execute(input, ctx) {
  // 从 dataDir 读取 notification store
  const { dataDir, log } = ctx;
  const storePath = path.join(dataDir, "notifications.jsonl");

  try {
    const fs = await import("node:fs");
    if (!fs.existsSync(storePath)) {
      return { content: [{ type: "text", text: "暂无通知记录" }] };
    }

    const raw = fs.readFileSync(storePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const records = lines
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);

    const type = input.type || null;
    const filtered = type ? records.filter((r) => r.type === type) : records;
    const recent = filtered.slice(-(input.limit || 10)).reverse();

    if (recent.length === 0) {
      return { content: [{ type: "text", text: "暂无匹配的通知记录" }] };
    }

    const lines_out = recent.map((r) => {
      const ts = new Date(r.ts).toLocaleTimeString("zh-CN", { hour12: false });
      const icon = r.emoji || "●";
      const typeLabel = r.type === "conversation" ? "对话" : r.type === "channel" ? "频道" : r.type === "dm" ? "私信" : r.type === "status" ? "状态" : "通知";
      return `${ts} [${typeLabel}] ${icon} ${r.title} — ${r.body}`;
    });

    return {
      content: [{ type: "text", text: lines_out.join("\n") }],
      details: { count: recent.length, total: records.length, type: type || "all" },
    };
  } catch (err) {
    return { content: [{ type: "text", text: `查询失败: ${err.message}` }] };
  }
}
