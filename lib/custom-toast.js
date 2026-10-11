import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { normalizeSoundTheme } from "./effect-registry.js";
import { legacyDismissParticleShape, normalizeCardExitFade, normalizeCardExitMode } from "./notification-config.js";
import { safeName, normalizeHexColor, normalizeChoice, normalizeNumber, normalizeMotionChoice, normalizeCustomSoundPath } from "./toast-fields.js";
import { ToastManagerClient } from "./toast-manager-client.js";

export class CustomToast {
  constructor({ pluginDir, dataDir, log, onClick, sakuraEnabled, sakuraTheme, toastLayout, toastScale, toastOffsetX, toastOffsetY, toastStyle, particleShape, autoParticleCountScale, manualParticleCountScale, particleSizeScale, particleIntervalEffect, cardExitMode, cardExitFade, entranceVisual, autoDismissMotion, manualDismissMotion, physicsPreset, toastTransportMode }) {
    this.pluginDir = pluginDir;
    this.dataDir = dataDir;
    this.log = log;
    this._spawn = spawn;
    this.onClick = typeof onClick === "function" ? onClick : null;
    this.sakuraEnabled = sakuraEnabled !== false;
    this.sakuraTheme = sakuraTheme || "auto";
    this.toastLayout = toastLayout || "clean";
    this.toastScale = normalizeNumber(toastScale, 1.0, 0.7, 1.2);
    this.toastOffsetX = normalizeNumber(toastOffsetX, 0, -1600, 1600);
    this.toastOffsetY = normalizeNumber(toastOffsetY, 0, -1000, 1000);
    this.toastStyle = toastStyle || "classic";
    this.particleShape = particleShape || "sakura";
    this.autoParticleCountScale = normalizeNumber(autoParticleCountScale, 1.0, 0.2, 4.0);
    this.manualParticleCountScale = normalizeNumber(manualParticleCountScale, 1.0, 0.2, 4.0);
    this.particleSizeScale = normalizeNumber(particleSizeScale, 1.0, 0.5, 3.0);
    this.particleIntervalEffect = normalizeNumber(particleIntervalEffect, 0, 0, 100);
    this.cardExitMode = normalizeCardExitMode(cardExitMode);
    this.cardExitFade = normalizeCardExitFade(cardExitFade);
    this.entranceVisual = entranceVisual || "ripple-bloom";
    this.autoDismissMotion = normalizeMotionChoice(autoDismissMotion, "drift");
    this.manualDismissMotion = normalizeMotionChoice(manualDismissMotion, "click-burst");
    this.physicsPreset = physicsPreset || "lively";
    this.toastTransportMode = toastTransportMode || "managed";
    this.helperPath = path.join(pluginDir, "helper", "notification-toast-helper.exe");
    this.payloadDir = path.join(dataDir, "custom-toast");
    this.clickDir = path.join(dataDir, "custom-toast-clicks");
    this.stackGap = 8;
    this.slotStatePath = path.join(dataDir, "custom-toast", "slot-state.json");
    this._managerTokenPath = path.join(this.payloadDir, "manager-token.txt");
    this._managerPortPath = path.join(this.payloadDir, "manager-port.txt");
    this._managerToken = this._loadOrCreateManagerToken();
    this._managerPort = this._loadOrCreateManagerPort();
    this._queueDir = path.join(this.payloadDir, "queue");
    this.activeToasts = [];
    this._pipeClient = new ToastManagerClient(log, { port: this._managerPort, token: this._managerToken, queueDir: this._queueDir });
    this._managerProcess = null;
    this._managerReadyPromise = null;
    this._managerUnavailableUntil = 0;
    this._managerRestarts = 0;
    this._sendQueue = [];
    this._sendQueueTimer = null;
    this._sendQueueIntervalMs = 65;
    this._clickPollEntries = new Map();
    this._clickPollTimer = null;
    // 构造器中不启动管理器。由主插件 onload 中显式调用 start() 来启动。
    // 工具或其他临时实例直接复用已有管理器的 TCP 连接。
    // 如果 TCP 不通，show() 会自动回退到文件模式。
  }

  setTransportMode(mode) {
    const next = normalizeChoice(mode, "toastTransportModes", "managed");
    if (next === this.toastTransportMode) return;
    this.toastTransportMode = next;
    if (next === "managed") {
      this._startManager();
    } else {
      this.stop();
    }
  }

  _loadOrCreateManagerToken() {
    try {
      fs.mkdirSync(this.payloadDir, { recursive: true });
      if (fs.existsSync(this._managerTokenPath)) {
        const existing = fs.readFileSync(this._managerTokenPath, "utf8").trim();
        if (existing.length >= 24) return existing;
      }
      const token = crypto.randomBytes(24).toString("hex");
      fs.writeFileSync(this._managerTokenPath, token, "utf8");
      return token;
    } catch (err) {
      this.log?.warn?.(`toast manager token init failed: ${err.message}`);
      return crypto.randomBytes(24).toString("hex");
    }
  }

  _loadOrCreateManagerPort() {
    const normalizePort = (value) => {
      const port = Number(value);
      return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 0;
    };
    const envPort = normalizePort(process.env.NH_TOAST_MANAGER_PORT);
    if (envPort) return envPort;
    try {
      fs.mkdirSync(this.payloadDir, { recursive: true });
      if (fs.existsSync(this._managerPortPath)) {
        const existing = normalizePort(fs.readFileSync(this._managerPortPath, "utf8").trim());
        if (existing) return existing;
      }
      const digest = crypto.createHash("sha1").update(String(this.dataDir || this.pluginDir || "notification-hub")).digest();
      const port = 49152 + digest.readUInt16BE(0) % (65535 - 49152);
      fs.writeFileSync(this._managerPortPath, String(port), "utf8");
      return port;
    } catch (err) {
      this.log?.warn?.(`toast manager port init failed: ${err.message}`);
      return 48105;
    }
  }

  async _ensureManagerReady() {
    if (this.toastTransportMode !== "managed") return false;
    if (Date.now() < this._managerUnavailableUntil) return false;
    if (await this._pipeClient.ping(250)) return true;
    return this._startManager();
  }

  async _startManager() {
    if (this.toastTransportMode !== "managed") return false;
    if (this._managerReadyPromise) return this._managerReadyPromise;
    this._managerReadyPromise = this._startManagerImpl().catch((err) => {
      this._managerUnavailableUntil = Date.now() + 5000;
      this.log?.warn?.(`toast manager start failed: ${err.message}`);
      return false;
    }).finally(() => {
      this._managerReadyPromise = null;
    });
    return this._managerReadyPromise;
  }

  async _startManagerImpl() {
    if (this.toastTransportMode !== "managed") return false;
    if (this._managerProcess && await this._pipeClient.ping(250)) return true;
    this._stoppingManager = false;
    // 重启 HanaAgent 桌面端时 hana-server 通常不重启，旧 toast manager 可能继续占用 TCP 端口。
    // 如果直接 ping 到旧 manager 并复用，新的 helper/physics 代码不会进程级生效。
    // 所以 onload 时只清理当前插件 helperPath 对应的旧 manager/toast 进程，再启动一份新 manager。
    await this._stopExistingManagersForThisHelper();
    if (!fs.existsSync(this.helperPath)) {
      this._managerUnavailableUntil = Date.now() + 5000;
      this.log?.warn?.(`toast manager helper not found: ${this.helperPath}`);
      return false;
    }
    try {
      fs.mkdirSync(this._queueDir, { recursive: true });
      try { fs.rmSync(path.join(this._queueDir, "ready.json"), { force: true }); } catch {}
      const proc = this._spawn(this.helperPath, ["--manager", "--queue", this._queueDir, "--token", this._managerToken], {
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          NH_TOAST_MANAGER_TOKEN: this._managerToken,
          NH_TOAST_MANAGER_PORT: String(this._managerPort),
        },
      });
      this._managerProcess = proc;
      let spawnFailed = false;
      const spawnError = new Promise((resolve) => {
        proc.on("error", (err) => {
          spawnFailed = true;
          if (this._managerProcess === proc) this._managerProcess = null;
          this._managerUnavailableUntil = Date.now() + 5000;
          this.log?.warn?.(`toast manager spawn failed: ${err.message}`);
          resolve(false);
        });
      });
      proc.stderr?.on?.("data", (chunk) => {
        const text = String(chunk || "").trim();
        if (text) this.log?.warn?.(`toast manager stderr: ${text}`);
      });
      proc.on("exit", (code) => {
        this.log?.info?.(`toast manager exited (${code})`);
        if (this._managerProcess === proc) this._managerProcess = null;
        if (this._stoppingManager) {
          this._stoppingManager = false;
          this._managerRestarts = 0;
          return;
        }
        this._managerUnavailableUntil = Date.now() + 1000;
        // Auto-heal: restart on unexpected exit (max 3 times)
        if (code !== 0 && (this._managerRestarts || 0) < 3 && this.toastTransportMode === "managed") {
          const n = (this._managerRestarts || 0) + 1;
          this._managerRestarts = n;
          const delay = n === 1 ? 1000 : n === 2 ? 4000 : 10000;
          this.log?.info?.(`restarting toast manager in ${delay}ms (attempt ${n}/3)...`);
          this._restartTimer = setTimeout(() => { this._restartTimer = null; this._startManager(); }, delay);
          this._restartTimer.unref?.();
        }
      });

      const ready = await Promise.race([this._waitForManagerReady(2500), spawnError]);
      if (!ready || spawnFailed) {
        this._managerUnavailableUntil = Date.now() + 3000;
        if (this._managerProcess === proc) this._managerProcess = null;
        if (!spawnFailed) try { proc.kill(); } catch {}
        this.log?.warn?.(`toast manager did not pass handshake on 127.0.0.1:${this._managerPort}; using legacy path`);
        return false;
      }
      this._managerRestarts = 0;
      this._managerUnavailableUntil = 0;
      this.log?.info?.(`toast manager ready via file queue ${this._queueDir}`);
      return true;
    } catch (err) {
      this._managerUnavailableUntil = Date.now() + 5000;
      this.log?.warn?.(`toast manager start failed: ${err.message}`);
      return false;
    }
  }

  async _waitForManagerReady(timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this._pipeClient.ping(250)) return true;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return false;
  }

  async _stopExistingManagersForThisHelper() {
    const helperPath = String(this.helperPath || "");
    if (!helperPath) return;
    const script = `
$targetRaw = $env:NH_TOAST_HELPER_PATH
if ([string]::IsNullOrWhiteSpace($targetRaw)) { exit 0 }
$target = [System.IO.Path]::GetFullPath($targetRaw).ToLowerInvariant()
Get-Process -Name 'notification-toast-helper' -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $path = $_.MainModule.FileName
    if ($path -and ([System.IO.Path]::GetFullPath($path).ToLowerInvariant() -eq $target)) {
      Stop-Process -Id $_.Id -Force
    }
  } catch {}
}
`;
    await new Promise((resolve) => {
      let done = false;
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, NH_TOAST_HELPER_PATH: helperPath },
      });
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish();
      }, 2500);
      timer.unref?.();
      child.on("exit", () => { clearTimeout(timer); finish(); });
      child.on("error", finish);
      child.stderr?.on?.("data", (chunk) => {
        const text = String(chunk || "").trim();
        if (text) this.log?.warn?.(`toast manager cleanup stderr: ${text}`);
      });
    });
  }

  stop() {
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
    if (this._sendQueueTimer) {
      clearTimeout(this._sendQueueTimer);
      this._sendQueueTimer = null;
    }
    for (const item of this._sendQueue) item.done?.({ status: "failed", error: "toast service stopped" });
    this._sendQueue = [];
    if (this._clickPollTimer) {
      clearInterval(this._clickPollTimer);
      this._clickPollTimer = null;
    }
    for (const entry of this._clickPollEntries.values()) {
      if (entry?.toastEntry) entry.toastEntry.released = true;
    }
    this._clickPollEntries.clear();
    this.activeToasts = [];
    try { this._writeSlotState(); } catch {}
    this._managerReadyPromise = null;
    this._managerUnavailableUntil = 0;
    if (this._managerProcess) {
      this._stoppingManager = true;
      this._managerProcess.kill();
      this._managerProcess = null;
      this.log?.info?.("toast manager stopped");
    } else {
      this._stoppingManager = false;
    }
  }

  async close(toastId) {
    const id = String(toastId || "").trim();
    if (!id) return false;
    try {
      const sent = this.toastTransportMode === "managed"
        ? await this._pipeClient.sendClose(id, 1200)
        : false;
      if (sent) return true;
    } catch {}
    const controlPath = path.join(this.payloadDir, `${safeName(id)}.control.json`);
    try {
      fs.mkdirSync(this.payloadDir, { recursive: true });
      fs.writeFileSync(controlPath, JSON.stringify({ action: "close", toastId: id }), "utf8");
      return true;
    } catch (err) {
      this.log?.warn?.(`custom toast close failed: ${err.message}`);
      return false;
    }
  }

  _removeToast(toastId) {
    const index = this.activeToasts.findIndex((item) => item.toastId === toastId);
    if (index >= 0) {
      const [removed] = this.activeToasts.splice(index, 1);
      if (removed) removed.released = true;
    }
    const pollEntry = this._clickPollEntries.get(toastId);
    if (pollEntry) pollEntry.toastEntry.released = true;
    this._writeSlotState();
  }

  _writeSlotState() {
    this.activeToasts = this.activeToasts.filter((item) => !item.released);
    const slots = this.activeToasts.map((item, index) => ({
      toastId: item.toastId,
      slotIndex: index,
      stackGap: this.stackGap,
    }));
    const state = { updatedAt: Date.now(), slots };
    try {
      fs.writeFileSync(this.slotStatePath, JSON.stringify(state), "utf8");
    } catch (err) {
      this.log?.warn?.(`slot state write failed: ${err.message}`);
    }
  }

  _resolveAction(notification) {
    if (notification?.actionType || notification?.actionTarget) {
      return {
        actionType: notification.actionType || "custom",
        actionTarget: notification.actionTarget || notification.source || "",
      };
    }

    if (notification?.type === "conversation") {
      return { actionType: "conversation", actionTarget: notification.source || "" };
    }
    if (notification?.type === "channel") {
      return { actionType: notification.meta?.aggregate ? "channel-aggregate" : "channel", actionTarget: notification.meta?.channelId || notification.source || "" };
    }
    if (notification?.type === "status") {
      return { actionType: "status", actionTarget: notification.source || "status" };
    }
    return { actionType: "history", actionTarget: notification?.source || "" };
  }

  _normalizeNotification(notification) {
    const primary = normalizeHexColor(notification?.primary || notification?.theme?.primary || notification?.color, "#9b7cff");
    const accent = normalizeHexColor(notification?.accent || notification?.theme?.accent || notification?.secondary || primary, primary);
    return {
      ...notification,
      title: notification?.title || notification?.agentName || "通知",
      body: notification?.body || "",
      agentName: notification?.agentName || notification?.agentId || "Assistant",
      agentId: notification?.agentId || "assistant",
      emoji: notification?.emoji || "🤖",
      type: notification?.type || "conversation",
      source: notification?.source || "",
      primary,
      accent,
      importance: notification?.importance || "normal",
      sound: Boolean(notification?.sound),
      soundTheme: normalizeSoundTheme(notification?.soundTheme, "chime"),
      customSoundPath: normalizeCustomSoundPath(notification?.customSoundPath),
      toastLayout: normalizeChoice(notification?.toastLayout || this.toastLayout, "toastLayouts", "clean"),
      toastScale: normalizeNumber(notification?.toastScale ?? this.toastScale, 1.0, 0.7, 1.2),
      toastOffsetX: normalizeNumber(notification?.toastOffsetX ?? this.toastOffsetX, 0, -1600, 1600),
      toastOffsetY: normalizeNumber(notification?.toastOffsetY ?? this.toastOffsetY, 0, -1000, 1000),
      toastStyle: normalizeChoice(notification?.toastStyle || this.toastStyle, "toastStyles", "classic"),
      particleShape: normalizeChoice(notification?.particleShape || legacyDismissParticleShape(notification?.dismissEffect) || this.particleShape, "particleShapes", "sakura"),
      autoParticleCountScale: normalizeNumber(notification?.autoParticleCountScale ?? this.autoParticleCountScale, this.autoParticleCountScale, 0.2, 4.0),
      manualParticleCountScale: normalizeNumber(notification?.manualParticleCountScale ?? this.manualParticleCountScale, this.manualParticleCountScale, 0.2, 4.0),
      particleSizeScale: normalizeNumber(notification?.particleSizeScale ?? this.particleSizeScale, this.particleSizeScale, 0.5, 3.0),
      particleIntervalEffect: normalizeNumber(notification?.particleIntervalEffect ?? this.particleIntervalEffect, this.particleIntervalEffect, 0, 100),
      cardExitMode: normalizeCardExitMode(notification?.cardExitMode || this.cardExitMode),
      cardExitFade: notification?.cardExitFade === undefined ? this.cardExitFade !== false : notification.cardExitFade !== false,
      entranceVisual: normalizeChoice(notification?.entranceVisual || this.entranceVisual, "entranceVisuals", "mist-bloom"),
      autoDismissMotion: normalizeMotionChoice(notification?.autoDismissMotion || this.autoDismissMotion, "drift"),
      manualDismissMotion: normalizeMotionChoice(notification?.manualDismissMotion || this.manualDismissMotion, "click-burst"),
      physicsPreset: normalizeChoice(notification?.physicsPreset || this.physicsPreset, "physicsPresets", "lively"),
      toastTransportMode: normalizeChoice(notification?.toastTransportMode || this.toastTransportMode, "toastTransportModes", "managed"),
      sakuraEnabled: this.sakuraEnabled,
      sakuraTheme: notification?.sakuraTheme || this.sakuraTheme,
    };
  }

  _startClickPoll(toastEntry, notification) {
    if (!this.onClick || !toastEntry?.toastId) return;
    this._clickPollEntries.set(toastEntry.toastId, {
      toastEntry,
      notification,
      ticks: 0,
      releasedTicks: 0,
    });
    this._ensureClickPollTimer();
  }

  _ensureClickPollTimer() {
    if (this._clickPollTimer || this._clickPollEntries.size === 0) return;
    this._clickPollTimer = setInterval(() => this._drainClickPoll(), 250);
    this._clickPollTimer.unref?.();
  }

  _stopClickPollTimerIfIdle() {
    if (this._clickPollEntries.size > 0 || !this._clickPollTimer) return;
    clearInterval(this._clickPollTimer);
    this._clickPollTimer = null;
  }

  _drainClickPoll() {
    const maxTicks = 120;
    const releasedGraceTicks = 8;
    for (const [toastId, entry] of this._clickPollEntries) {
      entry.ticks += 1;

      let clickExists = false;
      try {
        clickExists = fs.existsSync(entry.toastEntry.clickPath);
      } catch {
        clickExists = false;
      }

      if (entry.toastEntry.released && !clickExists) {
        entry.releasedTicks += 1;
        if (entry.releasedTicks > releasedGraceTicks) this._clickPollEntries.delete(toastId);
        continue;
      }
      entry.releasedTicks = 0;

      if (entry.ticks > maxTicks) {
        this._clickPollEntries.delete(toastId);
        continue;
      }
      if (!clickExists) continue;

      try {
        const raw = fs.readFileSync(entry.toastEntry.clickPath, "utf8").replace(/^\uFEFF/, "");
        const click = JSON.parse(raw);
        fs.rm(entry.toastEntry.clickPath, { force: true }, () => {});
        this._clickPollEntries.delete(toastId);
        this.onClick({ ...click, notification: entry.notification });
      } catch (err) {
        this.log?.warn?.(`custom toast click read failed: ${err.message}`);
      }
    }
    this._stopClickPollTimerIfIdle();
  }

  showConfirmed(notification) {
    return new Promise((resolve) => this.show(notification, resolve));
  }

  show(notification, onDelivery = () => {}) {
    let delivered = false;
    const done = (result) => {
      if (delivered) return;
      delivered = true;
      if (result?.status !== "shown") this.log?.warn?.(`toast delivery ${result?.status || "failed"}: ${result?.error || "display not confirmed"}`);
      onDelivery(result);
    };
    // Keep the synchronous toast ID API; confirmed callers await the delivery result.
    let toastId;
    let action;
    let clickPath;

    try {
      if (process.platform !== "win32") { done({ status: "failed", error: "Windows helper required" }); return null; }

      notification = this._normalizeNotification(notification || {});
      toastId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${safeName(notification.agentId)}`;
      action = this._resolveAction(notification);

      // Generate paths early (shared between TCP and legacy fallback)
      fs.mkdirSync(this.clickDir, { recursive: true });
      clickPath = path.join(this.clickDir, `${toastId}.click.json`);
      const controlPath = path.join(this.payloadDir, `${toastId}.control.json`);
      const toastEntry = { toastId, clickPath, released: false };
      const transportMode = notification.toastTransportMode || this.toastTransportMode;
      const useIndependent = transportMode === "independent";
      const deliveryNotification = notification;

      const pipePayload = {
        toastId,
        title: deliveryNotification.title,
        body: deliveryNotification.body,
        agentName: deliveryNotification.agentName,
        agentId: deliveryNotification.agentId,
        emoji: deliveryNotification.emoji,
        type: deliveryNotification.type,
        source: deliveryNotification.source,
        primary: deliveryNotification.primary,
        accent: deliveryNotification.accent,
        importance: deliveryNotification.importance,
        sound: deliveryNotification.sound,
        soundTheme: deliveryNotification.soundTheme,
        customSoundPath: deliveryNotification.customSoundPath,
        toastLayout: deliveryNotification.toastLayout,
        toastScale: deliveryNotification.toastScale,
        toastOffsetX: deliveryNotification.toastOffsetX,
        toastOffsetY: deliveryNotification.toastOffsetY,
        toastStyle: deliveryNotification.toastStyle,
        particleShape: deliveryNotification.particleShape,
        autoParticleCountScale: deliveryNotification.autoParticleCountScale,
        manualParticleCountScale: deliveryNotification.manualParticleCountScale,
        particleSizeScale: deliveryNotification.particleSizeScale,
        particleIntervalEffect: deliveryNotification.particleIntervalEffect,
        cardExitMode: deliveryNotification.cardExitMode,
        cardExitFade: deliveryNotification.cardExitFade,
        entranceVisual: deliveryNotification.entranceVisual,
        autoDismissMotion: deliveryNotification.autoDismissMotion,
        manualDismissMotion: deliveryNotification.manualDismissMotion,
        physicsPreset: deliveryNotification.physicsPreset,
        sakuraEnabled: deliveryNotification.sakuraEnabled,
        sakuraTheme: deliveryNotification.sakuraTheme,
        displayAckPath: "",
        clickPath,
        controlPath,
        actionType: action.actionType,
        actionTarget: action.actionTarget,
      };

      if (useIndependent) {
        Promise.resolve(this._fallbackShow(deliveryNotification, toastId, action)).then(done, (err) => done({ status: "failed", error: err.message }));
      } else {
        this._enqueueCreate(pipePayload, deliveryNotification, toastId, action, done);
      }

      this._startClickPoll(toastEntry, notification);
      return toastId;
    } catch (err) {
      this.log?.warn?.(`custom toast failed: ${err.message}`);
      // Work may already have been submitted; never retry from a broad catch.
      done({ status: "failed", retrySafe: false, error: err.message });
      return null;
    }
  }

  _enqueueCreate(pipePayload, notification, toastId, action, done) {
    this._sendQueue.push({ pipePayload, notification, toastId, action, done });
    if (this._sendQueueTimer) return;
    this._drainSendQueue();
  }

  _drainSendQueue() {
    const item = this._sendQueue.shift();
    if (!item) {
      this._sendQueueTimer = null;
      return;
    }

    const { pipePayload, notification, toastId, action, done } = item;
    this._ensureManagerReady().then((ready) => {
      if (!ready) return { status: "failed", retrySafe: true, error: "manager unavailable before create" };
      return this._pipeClient.sendCreate(pipePayload, 2500);
    }).then((result) => {
      if (result?.retrySafe === true) return this._fallbackShow(notification, toastId, action);
      return result;
    }).then(done).catch((err) => {
      done({ status: "unknown", retrySafe: false, error: err.message });
    });

    this._sendQueueTimer = setTimeout(() => this._drainSendQueue(), this._sendQueueIntervalMs);
    this._sendQueueTimer.unref?.();
  }

  async _fallbackShow(notification, toastId, action) {
    try {
      notification = this._normalizeNotification(notification || {});
      if (!fs.existsSync(this.helperPath)) {
        if (!this._helperWarned) {
          this.log?.warn?.(`custom toast helper not found: ${this.helperPath}`);
          this._helperWarned = true;
        }
        return { status: "failed", error: "custom toast helper not found" };
      }

      fs.mkdirSync(this.payloadDir, { recursive: true });
      fs.mkdirSync(this.clickDir, { recursive: true });
      const payloadPath = path.join(this.payloadDir, `${toastId}.json`);
      const controlPath = path.join(this.payloadDir, `${toastId}.control.json`);
      const clickPath = path.join(this.clickDir, `${toastId}.click.json`);
      const displayAckPath = path.join(this.payloadDir, `${toastId}.display.json`);

      const payload = {
        displayAckPath,
        toastId,
        title: notification.title,
        body: notification.body,
        agentName: notification.agentName,
        agentId: notification.agentId,
        emoji: notification.emoji,
        type: notification.type,
        source: notification.source,
        primary: notification.primary,
        accent: notification.accent,
        importance: notification.importance,
        sound: notification.sound,
        soundTheme: notification.soundTheme,
        customSoundPath: notification.customSoundPath,
        toastLayout: notification.toastLayout,
        toastScale: notification.toastScale,
        toastOffsetX: notification.toastOffsetX,
        toastOffsetY: notification.toastOffsetY,
        stackGap: this.stackGap,
        controlPath,
        clickPath,
        actionType: action.actionType,
        actionTarget: action.actionTarget,
        matchedKeywords: Array.isArray(notification.matchedKeywords)
          ? notification.matchedKeywords.join(", ")
          : "",
        toastStyle: notification.toastStyle,
        particleShape: notification.particleShape,
        autoParticleCountScale: notification.autoParticleCountScale,
        manualParticleCountScale: notification.manualParticleCountScale,
        particleSizeScale: notification.particleSizeScale,
        particleIntervalEffect: notification.particleIntervalEffect,
        cardExitMode: notification.cardExitMode,
        cardExitFade: notification.cardExitFade,
        entranceVisual: notification.entranceVisual,
        autoDismissMotion: notification.autoDismissMotion,
        manualDismissMotion: notification.manualDismissMotion,
        physicsPreset: notification.physicsPreset,
        sakuraEnabled: notification.sakuraEnabled,
        sakuraTheme: notification.sakuraTheme,
      };
      fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf8");

      this.log?.info?.(`toast via legacy spawn: ${payload.title}`);
      const child = this._spawn(this.helperPath, [payloadPath], {
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr?.on?.("data", (chunk) => {
        const text = String(chunk || "").trim();
        if (text) this.log?.warn?.(`legacy toast stderr: ${text}`);
      });
      const failed = new Promise((resolve) => {
        child.on("error", (err) => {
          this.log?.warn?.(`legacy toast error: ${err.message}`);
          resolve({ status: "failed", error: err.message });
        });
        child.once("exit", (code) => {
          if (code !== 0) resolve({ status: "failed", error: `helper exited (${code})` });
        });
      });
      setTimeout(() => {
        fs.rm(payloadPath, { force: true }, () => {});
        fs.rm(displayAckPath, { force: true }, () => {});
      }, 30000).unref?.();
      return await Promise.race([this._pipeClient.waitForAck(displayAckPath, { t: "create", id: toastId }, 3000), failed]);
    } catch (err) {
      this.log?.warn?.(`legacy toast fallback failed: ${err.message}`);
      return { status: "failed", error: err.message };
    }
  }
}


