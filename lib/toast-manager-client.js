import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { normalizeSoundTheme } from "./effect-registry.js";
import { legacyDismissParticleShape, normalizeCardExitMode } from "./notification-config.js";
import { normalizeChoice, normalizeCustomSoundPath, normalizeMotionChoice, normalizeNumber } from "./toast-fields.js";

export class ToastManagerClient {
  constructor(log, options = {}) {
    this._port = Number.isInteger(Number(options.port)) ? Number(options.port) : 48105;
    this._host = "127.0.0.1";
    this._token = typeof options.token === "string" ? options.token : "";
    this._queueDir = typeof options.queueDir === "string" ? options.queueDir : "";
    this._readyPath = this._queueDir ? path.join(this._queueDir, "ready.json") : "";
    this._log = log;
    this._warned = false;
  }

  async ping(timeout = 250) {
    if (this._queueDir) return this._pingQueue(timeout);
    const id = `ping-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const result = await this._sendCommand({ t: "ping", id }, timeout, { expectOp: "pong", fallbackOnAckTimeoutAfterWrite: false });
    return result.status === "pong";
  }

  async sendClose(toastId, timeout = 1200) {
    const id = String(toastId || "").trim();
    if (!id) return false;
    const result = this._queueDir
      ? await this._sendQueueCommand({ t: "close", id }, timeout)
      : await this._sendCommand({ t: "close", id }, timeout, { expectOp: "queued" });
    return result.status === "queued" || result.status === "closed";
  }

  async sendCreate(payload, timeout = 5000) {
    const cmd = {
      t: "create",
      id: payload.toastId,
      title: payload.title,
      body: payload.body,
      agentName: payload.agentName,
      emoji: payload.emoji,
      type: payload.type,
      primary: payload.primary,
      accent: payload.accent,
      importance: payload.importance,
      sound: Boolean(payload.sound),
      soundTheme: normalizeSoundTheme(payload.soundTheme, "chime"),
      customSoundPath: normalizeCustomSoundPath(payload.customSoundPath),
      toastLayout: normalizeChoice(payload.toastLayout, "toastLayouts", "clean"),
      toastScale: normalizeNumber(payload.toastScale, 1.0, 0.7, 1.2),
      toastOffsetX: normalizeNumber(payload.toastOffsetX, 0, -1600, 1600),
      toastOffsetY: normalizeNumber(payload.toastOffsetY, 0, -1000, 1000),
      toastStyle: payload.toastStyle || "classic",
      particleShape: payload.particleShape || legacyDismissParticleShape(payload.dismissEffect) || "sakura",
      autoParticleCountScale: normalizeNumber(payload.autoParticleCountScale, 1.0, 0.2, 4.0),
      manualParticleCountScale: normalizeNumber(payload.manualParticleCountScale, 1.0, 0.2, 4.0),
      particleSizeScale: normalizeNumber(payload.particleSizeScale, 1.0, 0.5, 3.0),
      particleIntervalEffect: normalizeNumber(payload.particleIntervalEffect, 0, 0, 100),
      cardExitMode: normalizeCardExitMode(payload.cardExitMode),
      cardExitFade: payload.cardExitFade !== false,
      entranceVisual: payload.entranceVisual || "mist-bloom",
      autoDismissMotion: normalizeMotionChoice(payload.autoDismissMotion, "drift"),
      manualDismissMotion: normalizeMotionChoice(payload.manualDismissMotion, "click-burst"),
      physicsPreset: payload.physicsPreset || "lively",
      sakuraEnabled: payload.sakuraEnabled,
      sakuraTheme: payload.sakuraTheme,
      displayAckPath: payload.displayAckPath || "",
      clickPath: payload.clickPath || "",
      controlPath: payload.controlPath || "",
      actionType: payload.actionType || "",
      actionTarget: payload.actionTarget || "",
    };

    return this._queueDir
      ? this._sendQueueCommand(cmd, timeout)
      : this._sendCommand(cmd, timeout, { expectOp: "shown" });
  }

  async _pingQueue(timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const raw = fs.readFileSync(this._readyPath, "utf8").replace(/^\uFEFF/, "");
        const ready = JSON.parse(raw);
        if (ready?.ready === true && ready.token === this._token) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return false;
  }

  _queuePaths(id) {
    const safe = String(id || "cmd").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "cmd";
    return {
      cmdPath: path.join(this._queueDir, `${safe}.cmd.json`),
      ackPath: path.join(this._queueDir, `${safe}.ack.json`),
    };
  }

  async _sendQueueCommand(command, timeout) {
    const cmd = { ...command, token: this._token };
    const { cmdPath, ackPath } = this._queuePaths(cmd.id);
    const tmpPath = `${cmdPath}.tmp`;
    try {
      fs.mkdirSync(this._queueDir, { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(cmd), "utf8");
      fs.renameSync(tmpPath, cmdPath);
    } catch (err) {
      try { fs.rmSync(tmpPath, { force: true }); } catch {}
      return { status: "failed", retrySafe: true, error: err.message };
    }
    // Once published, delivery is uncertain until an acknowledgement arrives.
    // A timeout, a partial JSON file, or a rejected create must never spawn again.
    return this.waitForAck(ackPath, cmd, timeout);
  }

  async waitForAck(ackPath, command, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const raw = fs.readFileSync(ackPath, "utf8").replace(/^\uFEFF/, "");
        const result = this._ackResult(JSON.parse(raw), command);
        if (result) {
          try { fs.rmSync(ackPath, { force: true }); } catch {}
          return result;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { status: "unknown", retrySafe: false, error: "display acknowledgement timed out" };
  }

  _ackResult(ack, command) {
    if (ack?.id !== command.id || typeof ack.ok !== "boolean" || typeof ack.op !== "string" || !ack.op) return null;
    if (!ack.ok) return { status: "failed", retrySafe: false, error: ack.error || ack.op };
    const allowed = command.t === "create" ? ["shown", "queued"] : command.t === "ping" ? ["pong"] : ["queued", "closed"];
    if (!allowed.includes(ack.op)) return null;
    return { status: ack.op, retrySafe: false };
  }

  async _sendCommand(command, timeout, options = {}) {
    let socket;
    let attempted = false;
    try {
      socket = await this._connect(Math.min(1000, timeout));
      const cmd = { ...command, token: this._token };
      const expectOp = options.expectOp;
      return await new Promise((resolve) => {
        let buf = "";
        let settled = false;
        const settle = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(value);
        };
        const uncertain = (error) => settle({ status: "unknown", retrySafe: false, error });
        const timer = setTimeout(() => uncertain("display acknowledgement timed out"), timeout);
        socket.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            try {
              const ack = JSON.parse(line.replace(/^\uFEFF/, "").trim());
              const result = ack.t === "ack" ? this._ackResult(ack, cmd) : null;
              // queued from an older helper is accepted, but is not proof of display.
              if (result && (!ack.ok || ack.op === expectOp || ack.op === "queued" || ack.op === "closed")) { settle(result); return; }
            } catch {}
          }
        });
        socket.on("error", (err) => uncertain(err.message));
        socket.on("close", () => uncertain("connection closed before acknowledgement"));
        attempted = true;
        try { socket.write(JSON.stringify(cmd) + "\n", (err) => { if (err) uncertain(err.message); }); }
        catch (err) { uncertain(err.message); }
      });
    } catch (err) {
      socket?.destroy?.();
      return { status: attempted ? "unknown" : "failed", retrySafe: !attempted, error: err.message };
    }
  }

  _connect(timeout) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = net.createConnection(this._port, this._host);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error("tcp connect timeout"));
      }, timeout);
      socket.once("connect", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
