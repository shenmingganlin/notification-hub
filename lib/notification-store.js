import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_STORED = 200; // 最多保留 200 条历史

export function readNotificationRecords(dataDir) {
  let raw;
  try { raw = fs.readFileSync(path.join(dataDir, "notifications.jsonl"), "utf8"); }
  catch (err) { if (err.code === "ENOENT") return []; throw err; }
  return raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("invalid record");
      return record;
    } catch (err) { throw new Error(`通知历史第 ${index + 1} 行损坏: ${err.message}`); }
  });
}

export function writeNotificationRecords(dataDir, records) {
  const target = path.join(dataDir, "notifications.jsonl");
  const temp = `${target}.${randomUUID()}.tmp`;
  let fd;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, records.length ? records.map(r => JSON.stringify(r)).join("\n") + "\n" : "", "utf8");
    fs.closeSync(fd);
    fd = undefined;
    // Same-directory rename replaces the old file only after a complete write.
    fs.renameSync(temp, target);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}

export class NotificationStore {
  constructor(dataDir, log) {
    this._dataDir = dataDir;
    this._log = log;
    this._recordsPath = path.join(dataDir, "notifications.jsonl");
    this._records = [];
    this._readError = null;
    this._storageError = null;
  }

  init() {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      const records = readNotificationRecords(this._dataDir);
      this._readError = null;
      this._storageError = null;
      this._records = records.slice(-MAX_STORED);
      if (records.length > MAX_STORED) this._commit(this._records);
      this._log?.info?.(`NotificationStore: loaded ${this._records.length} records`);
    } catch (err) {
      this._readError = err;
      this._fail(err);
    }
  }

  storageStatus() {
    return { ok: !this._storageError, ...(this._storageError ? { error: this._storageError.message } : {}) };
  }

  _fail(err) {
    this._storageError = err;
    this._log?.error?.(`NotificationStore failed: ${err.message}`);
  }

  _commit(records) {
    try {
      writeNotificationRecords(this._dataDir, records);
      this._records = records;
      this._readError = null;
      this._storageError = null;
    } catch (err) {
      this._fail(err);
      throw err;
    }
  }

  push(notification) {
    if (this._readError) throw this._readError;
    const record = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), ...notification };
    this._commit([...this._records, record].slice(-MAX_STORED));
    return record;
  }

  upsert(notification, stableId) {
    if (this._readError) throw this._readError;
    const key = String(stableId || notification?.notificationId || notification?.id || "").trim();
    if (!key) return this.push(notification);
    const index = this._records.findIndex(record => record.id === key || record.notificationId === key);
    if (index < 0) return this.push({ ...notification, id: key, notificationId: key });
    const previous = this._records[index];
    const record = { ...previous, ...notification, id: previous.id || key, notificationId: key, ts: Date.now(), updatedAt: Date.now() };
    const next = [...this._records];
    next[index] = record;
    this._commit(next);
    return record;
  }

  recent(limit = 10, type) {
    const records = type ? this._records.filter(r => r.type === type) : this._records;
    return records.slice(-limit).reverse();
  }

  clear() { this._commit([]); }

  stats() {
    const counts = { total: this._records.length, conversation: 0, channel: 0, dm: 0, status: 0, important: 0 };
    for (const record of this._records) {
      if (Object.prototype.hasOwnProperty.call(counts, record.type)) counts[record.type] += 1;
      if (record.importance === "important" || record.importance === "urgent") counts.important += 1;
    }
    return counts;
  }
}
