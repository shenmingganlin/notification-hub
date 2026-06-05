import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { normalizeEffect, normalizeSoundTheme } from "./effect-registry.js";

function safeName(value) {
  return String(value || "toast").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

function normalizeHexColor(value, fallback = "#9b7cff") {
  const text = String(value || "").trim();
  const direct = text.match(/^#([0-9a-fA-F]{6})$/);
  if (direct) return `#${direct[1].toLowerCase()}`;
  const short = text.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const [r, g, b] = short[1].toLowerCase().split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  // Some callers may pass CSS snippets such as gradients. Pick the first hex color.
  const embedded = text.match(/#([0-9a-fA-F]{6})\b/);
  if (embedded) return `#${embedded[1].toLowerCase()}`;
  return fallback;
}

function normalizeChoice(value, group, fallback) {
  return normalizeEffect(group, value, fallback);
}

function normalizeNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

function normalizeMotionChoice(value, fallback) {
  const legacy = {
    burst: "circle-burst",
    explosion: "circle-burst",
    click: "click-burst",
    float: "drift",
  };
  const mapped = legacy[String(value || "").trim().toLowerCase()] || value;
  return normalizeChoice(mapped, "dismissMotions", fallback);
}

function normalizeCustomSoundPath(value) {
  return typeof value === "string" ? value.trim() : "";
}

export class CustomToast {
  constructor({ pluginDir, dataDir, log, onClick, sakuraEnabled, sakuraTheme, toastLayout, toastScale, toastOffsetX, toastOffsetY, toastStyle, dismissEffect, particleShape, autoParticleCountScale, manualParticleCountScale, particleSizeScale, particleIntervalEffect, entranceVisual, autoDismissMotion, manualDismissMotion, physicsPreset, toastTransportMode }) {
    this.pluginDir = pluginDir;
    this.dataDir = dataDir;
    this.log = log;
    this.onClick = typeof onClick === "function" ? onClick : null;
    this.sakuraEnabled = sakuraEnabled !== false;
    this.sakuraTheme = sakuraTheme || "auto";
    this.toastLayout = toastLayout || "clean";
    this.toastScale = normalizeNumber(toastScale, 1.0, 0.7, 1.2);
    this.toastOffsetX = normalizeNumber(toastOffsetX, 0, -1600, 1600);
    this.toastOffsetY = normalizeNumber(toastOffsetY, 0, -1000, 1000);
    this.toastStyle = toastStyle || "classic";
    this.dismissEffect = dismissEffect || (this.sakuraEnabled ? "sakura" : "fade");
    this.particleShape = particleShape || "sakura";
    this.autoParticleCountScale = normalizeNumber(autoParticleCountScale, 1.0, 0.2, 4.0);
    this.manualParticleCountScale = normalizeNumber(manualParticleCountScale, 1.0, 0.2, 4.0);
    this.particleSizeScale = normalizeNumber(particleSizeScale, 1.0, 0.5, 3.0);
    this.particleIntervalEffect = normalizeNumber(particleIntervalEffect, 0, 0, 100);
    this.entranceVisual = entranceVisual || "classic";
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
    this.activeToasts = [];
    this._pipeClient = new ToastManagerClient(log, { port: this._managerPort, token: this._managerToken });
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
    this._managerReadyPromise = this._startManagerImpl().finally(() => {
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
      const proc = spawn(this.helperPath, ["--manager"], {
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
          setTimeout(() => { this._startManager(); }, delay).unref?.();
        }
      });

      const ready = await this._waitForManagerReady(2500);
      if (!ready) {
        this._managerUnavailableUntil = Date.now() + 3000;
        try { proc.kill(); } catch {}
        this.log?.warn?.(`toast manager did not pass handshake on 127.0.0.1:${this._managerPort}; using legacy path`);
        return false;
      }
      this._managerRestarts = 0;
      this._managerUnavailableUntil = 0;
      this.log?.info?.(`toast manager started on 127.0.0.1:${this._managerPort}`);
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
    if (this._sendQueueTimer) {
      clearTimeout(this._sendQueueTimer);
      this._sendQueueTimer = null;
    }
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
      dismissEffect: normalizeChoice(notification?.dismissEffect || this.dismissEffect, "dismissEffects", this.sakuraEnabled ? "sakura" : "fade"),
      particleShape: normalizeChoice(notification?.particleShape || this.particleShape, "particleShapes", "sakura"),
      autoParticleCountScale: normalizeNumber(notification?.autoParticleCountScale ?? this.autoParticleCountScale, this.autoParticleCountScale, 0.2, 4.0),
      manualParticleCountScale: normalizeNumber(notification?.manualParticleCountScale ?? this.manualParticleCountScale, this.manualParticleCountScale, 0.2, 4.0),
      particleSizeScale: normalizeNumber(notification?.particleSizeScale ?? this.particleSizeScale, this.particleSizeScale, 0.5, 3.0),
      particleIntervalEffect: normalizeNumber(notification?.particleIntervalEffect ?? this.particleIntervalEffect, this.particleIntervalEffect, 0, 100),
      entranceVisual: normalizeChoice(notification?.entranceVisual || this.entranceVisual, "entranceVisuals", "classic"),
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

  show(notification) {
    // 把可能被 catch 引用的变量提升到 try 之外，避免块级作用域问题
    let toastId;
    let action;
    let clickPath;

    try {
      if (process.platform !== "win32") return;

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
        dismissEffect: deliveryNotification.dismissEffect,
        particleShape: deliveryNotification.particleShape,
        autoParticleCountScale: deliveryNotification.autoParticleCountScale,
        manualParticleCountScale: deliveryNotification.manualParticleCountScale,
        particleSizeScale: deliveryNotification.particleSizeScale,
        particleIntervalEffect: deliveryNotification.particleIntervalEffect,
        entranceVisual: deliveryNotification.entranceVisual,
        autoDismissMotion: deliveryNotification.autoDismissMotion,
        manualDismissMotion: deliveryNotification.manualDismissMotion,
        physicsPreset: deliveryNotification.physicsPreset,
        sakuraEnabled: deliveryNotification.sakuraEnabled,
        sakuraTheme: deliveryNotification.sakuraTheme,
        clickPath,
        controlPath,
        actionType: action.actionType,
        actionTarget: action.actionTarget,
      };

      if (useIndependent) {
        this._fallbackShow(deliveryNotification, toastId, action);
      } else {
        this._enqueueCreate(pipePayload, deliveryNotification, toastId, action);
      }

      this._startClickPoll(toastEntry, notification);
    } catch (err) {
      this.log?.warn?.(`custom toast failed: ${err.message}`);
      if (toastId && action) {
        this._fallbackShow(notification, toastId, action);
      }
    }
  }

  _enqueueCreate(pipePayload, notification, toastId, action) {
    this._sendQueue.push({ pipePayload, notification, toastId, action });
    if (this._sendQueueTimer) return;
    this._drainSendQueue();
  }

  _drainSendQueue() {
    const item = this._sendQueue.shift();
    if (!item) {
      this._sendQueueTimer = null;
      return;
    }

    const { pipePayload, notification, toastId, action } = item;
    this._ensureManagerReady().then((ready) => {
      if (!ready) return false;
      return this._pipeClient.sendCreate(pipePayload, 2500);
    }).then(ok => {
      if (ok) {
        this.log?.info?.(`toast via tcp: ${pipePayload.title}`);
        return;
      }
      this._fallbackShow(notification, toastId, action);
    }).catch(() => {
      this._fallbackShow(notification, toastId, action);
    });

    this._sendQueueTimer = setTimeout(() => this._drainSendQueue(), this._sendQueueIntervalMs);
    this._sendQueueTimer.unref?.();
  }

  _fallbackShow(notification, toastId, action) {
    try {
      notification = this._normalizeNotification(notification || {});
      if (!fs.existsSync(this.helperPath)) {
        if (!this._helperWarned) {
          this.log?.warn?.(`custom toast helper not found: ${this.helperPath}`);
          this._helperWarned = true;
        }
        return;
      }

      fs.mkdirSync(this.payloadDir, { recursive: true });
      fs.mkdirSync(this.clickDir, { recursive: true });
      const payloadPath = path.join(this.payloadDir, `${toastId}.json`);
      const controlPath = path.join(this.payloadDir, `${toastId}.control.json`);
      const clickPath = path.join(this.clickDir, `${toastId}.click.json`);

      const payload = {
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
        dismissEffect: notification.dismissEffect,
        particleShape: notification.particleShape,
        autoParticleCountScale: notification.autoParticleCountScale,
        manualParticleCountScale: notification.manualParticleCountScale,
        particleSizeScale: notification.particleSizeScale,
        particleIntervalEffect: notification.particleIntervalEffect,
        entranceVisual: notification.entranceVisual,
        autoDismissMotion: notification.autoDismissMotion,
        manualDismissMotion: notification.manualDismissMotion,
        physicsPreset: notification.physicsPreset,
        sakuraEnabled: notification.sakuraEnabled,
        sakuraTheme: notification.sakuraTheme,
      };
      fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf8");

      this.log?.info?.(`toast via legacy spawn: ${payload.title}`);
      const child = spawn(this.helperPath, [payloadPath], {
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr?.on?.("data", (chunk) => {
        const text = String(chunk || "").trim();
        if (text) this.log?.warn?.(`legacy toast stderr: ${text}`);
      });
      child.on?.("error", (err) => {
        this.log?.warn?.(`legacy toast error: ${err.message}`);
      });

      setTimeout(() => { fs.rm(payloadPath, { force: true }, () => {}); }, 30000).unref?.();
    } catch (err) {
      this.log?.warn?.(`legacy toast fallback failed: ${err.message}`);
    }
  }
}

class ToastManagerClient {
  constructor(log, options = {}) {
    this._port = Number.isInteger(Number(options.port)) ? Number(options.port) : 48105;
    this._host = "127.0.0.1";
    this._token = typeof options.token === "string" ? options.token : "";
    this._log = log;
    this._warned = false;
  }

  async ping(timeout = 250) {
    const id = `ping-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const result = await this._sendCommand({ t: "ping", id }, timeout, { expectOp: "pong", fallbackOnAckTimeoutAfterWrite: false });
    return result === true;
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
      dismissEffect: payload.dismissEffect || (payload.sakuraEnabled === false ? "fade" : "sakura"),
      particleShape: payload.particleShape || "sakura",
      autoParticleCountScale: normalizeNumber(payload.autoParticleCountScale, 1.0, 0.2, 4.0),
      manualParticleCountScale: normalizeNumber(payload.manualParticleCountScale, 1.0, 0.2, 4.0),
      particleSizeScale: normalizeNumber(payload.particleSizeScale, 1.0, 0.5, 3.0),
      particleIntervalEffect: normalizeNumber(payload.particleIntervalEffect, 0, 0, 100),
      entranceVisual: payload.entranceVisual || "classic",
      autoDismissMotion: normalizeMotionChoice(payload.autoDismissMotion, "drift"),
      manualDismissMotion: normalizeMotionChoice(payload.manualDismissMotion, "click-burst"),
      physicsPreset: payload.physicsPreset || "lively",
      sakuraEnabled: payload.sakuraEnabled,
      sakuraTheme: payload.sakuraTheme,
      butterflyCount: payload.butterflyCount || 18,
      clickPath: payload.clickPath || "",
      controlPath: payload.controlPath || "",
      actionType: payload.actionType || "",
      actionTarget: payload.actionTarget || "",
    };

    const ok = await this._sendCommand(cmd, timeout, { expectOp: "queued", fallbackOnAckTimeoutAfterWrite: true });
    if (ok !== true && !this._warned) {
      this._log?.info?.(`tcp manager unavailable before create delivery (${ok?.message || "not acknowledged"}) - using legacy path`);
      this._warned = true;
    }
    return ok === true;
  }

  async _sendCommand(command, timeout, options = {}) {
    let socket;
    try {
      socket = await this._connect(Math.min(1000, timeout));
      const cmd = { ...command, token: this._token };
      const expectOp = options.expectOp;
      return await new Promise((resolve, reject) => {
        let buf = "";
        let wrote = false;
        const timer = setTimeout(() => {
          socket.destroy();
          if (wrote && options.fallbackOnAckTimeoutAfterWrite) {
            this._log?.warn?.(`tcp create ack timeout after write; assuming delivered to avoid duplicate fallback: ${cmd.id}`);
            resolve(true);
          } else {
            reject(new Error("ack timeout"));
          }
        }, timeout);
        const settle = (value) => {
          clearTimeout(timer);
          try { socket.end(); } catch {}
          resolve(value);
        };
        socket.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            const text = line.replace(/^\uFEFF/, "").trim();
            if (!text) continue;
            try {
              const ack = JSON.parse(text);
              if (ack.t === "ack" && ack.id === cmd.id) {
                if (ack.ok === false) {
                  settle(false);
                  return;
                }
                if (!expectOp || ack.op === expectOp) {
                  settle(true);
                  return;
                }
              }
            } catch {}
          }
        });
        socket.on("error", (err) => { clearTimeout(timer); reject(err); });
        socket.write(JSON.stringify(cmd) + "\n", (err) => {
          if (err) {
            clearTimeout(timer);
            reject(err);
            return;
          }
          wrote = true;
        });
      });
    } catch (err) {
      socket?.destroy?.();
      return err;
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
