/**
 * notification-store.js
 *
 * 管理通知历史记录。
 * 持久化到 dataDir 下的 notifications.jsonl，支持推送、查询、清除。
 *
 * 文件始终与内存同步：每次 push 后重写整个文件（上限 MAX_STORED 条）。
 * 避免旧版只追加不裁切的无限增长问题。
 */
import fs from "node:fs";
import path from "node:path";

const MAX_STORED = 200; // 最多保留 200 条历史

export class NotificationStore {
  constructor(dataDir, log) {
    this._dataDir = dataDir;
    this._log = log;
    this._recordsPath = path.join(dataDir, "notifications.jsonl");
    this._records = [];
  }

  init() {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      if (fs.existsSync(this._recordsPath)) {
        const raw = fs.readFileSync(this._recordsPath, "utf-8");
        const lines = raw.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            this._records.push(JSON.parse(line));
          } catch {
            // 跳过坏行
          }
        }
        // 只保留最新的，并重整文件以清除过期数据
        if (this._records.length > MAX_STORED) {
          this._records = this._records.slice(-MAX_STORED);
          this._flush();
        }
      }
      this._log.info(`NotificationStore: loaded ${this._records.length} records`);
    } catch (err) {
      this._log.error(`NotificationStore init failed: ${err.message}`);
    }
  }

  /**
   * 追加一条通知记录
   * @param {Object} notification
   * @param {string} notification.type - 'conversation' | 'channel' | 'dm' | 'status'
   * @param {string} notification.source - 来源标识（sessionPath / channelName）
   * @param {string} notification.title - 通知标题
   * @param {string} notification.body - 通知正文
   * @param {string} notification.agentId - 发送者 agentId
   * @param {string} notification.agentName - 发送者展示名
   * @param {string} notification.emoji - 角色 emoji
   * @param {Object} [notification.meta] - 额外元数据
   */
  push(notification) {
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      ...notification,
    };
    this._records.push(record);
    // 保持上限
    if (this._records.length > MAX_STORED) {
      this._records = this._records.slice(-MAX_STORED);
    }
    // 持久化：重写整个文件，与内存保持完全一致
    this._flush();
    return record;
  }

  /**
   * 获取最近的通知
   * @param {number} limit - 最多返回条数
   * @param {string} [type] - 筛选类型
   */
  recent(limit = 10, type) {
    let records = this._records;
    if (type) {
      records = records.filter((r) => r.type === type);
    }
    return records.slice(-limit).reverse();
  }

  /**
   * 清空所有记录
   */
  clear() {
    this._records = [];
    try {
      fs.writeFileSync(this._recordsPath, "", "utf-8");
    } catch (err) {
      this._log.error(`NotificationStore clear failed: ${err.message}`);
    }
  }

  /**
   * 将当前内存中的所有记录完整写入文件
   */
  _flush() {
    try {
      const content = this._records.map((r) => JSON.stringify(r)).join("\n") + "\n";
      fs.writeFileSync(this._recordsPath, content, "utf-8");
    } catch (err) {
      this._log.error(`NotificationStore flush failed: ${err.message}`);
    }
  }

  /**
   * 获取统计
   */
  stats() {
    const counts = {
      total: this._records.length,
      conversation: 0,
      channel: 0,
      dm: 0,
      status: 0,
      important: 0,
    };

    for (const record of this._records) {
      if (Object.prototype.hasOwnProperty.call(counts, record.type)) counts[record.type] += 1;
      if (record.importance === "important" || record.importance === "urgent") counts.important += 1;
    }

    return counts;
  }
}
