/**
 * notification-hub/index.js
 *
 * 生命周期入口：
 * 订阅 EventBus，用 message_end.stopReason 区分「工具调用」和「最终回复」。
 */
import fs from "node:fs";
import path from "node:path";
import { AgentResolver } from "./lib/agent-resolver.js";
import { NotificationStore } from "./lib/notification-store.js";
import { createNotificationHubApi, normalizeExternalNotification } from "./lib/notification-api.js";
import { CustomToast } from "./lib/custom-toast.js";
import {
  buildRuntimeConfig,
  intValue,
  normalizeDismissMotionTrack,
  normalizeDisplayMode,
  normalizeEntranceVisual,
  normalizeParticleShape,
  normalizePhysicsPreset,
  normalizeSoundTheme,
  normalizeToastStyle,
  normalizeToastTransportMode,
  numberValue,
} from "./lib/notification-config.js";
import { readHostConfig } from "./lib/host-config.js";
import {
  clearChannelAggregation,
  drainChannelAggregation,
  flushChannelAggregation,
  handleChannelMessage,
  maybeAggregateChannelNotification,
  resolveChannel,
} from "./lib/channel-aggregation.js";
import {
  getSessionTitle,
  handleConversationEnd,
  prewarmSessionInfo,
  resolveAgentFromSession,
} from "./lib/conversation-notification.js";
import {
  handleStatusEvent,
  pushStatusNotification,
  truncateStatusText,
} from "./lib/status-notification.js";
import {
  emitDecoratedDesktopNotification,
  emitDesktopNotification,
  popupBlockReason,
  recordAndEmit,
} from "./lib/notification-delivery.js";
import {
  decorateToastNotification,
  normalizeHexColor,
  resolveToastColors,
  toastThemeColors,
} from "./lib/delivery/toast-decoration.js";
import {
  parseNotificationKeywords,
  resolveCustomSoundPath,
  resolveImportance,
  resolveNotificationCustomSoundPath,
  resolveNotificationSoundTheme,
  resolveStatusSoundTheme,
  shouldPlaySound,
} from "./lib/policy/notification-policy.js";

export default class NotificationHubPlugin {
  register(disposer) {
    if (typeof disposer !== "function") return;
    if (!this._disposers) this._disposers = [];
    this._disposers.push(disposer);
  }

  _disposeRegistered() {
    const disposers = this._disposers || [];
    this._disposers = [];
    for (const disposer of disposers) {
      try { disposer(); }
      catch (err) { this.ctx?.log?.error?.("notification-hub disposable error:", err?.message || err); }
    }
  }

  async onload() {
    const { dataDir, pluginDir, log, bus, config } = this.ctx;

    // pluginDir 是可靠的：始终指向 {hanakoHome}/(plugins|plugins-dev)/notification-hub/
    const agentsDir = path.resolve(pluginDir, "../../agents");
    this._channelsDir = path.resolve(pluginDir, "../../channels");
    this._channelCache = new Map();
    this._channelAggregation = new Map();

    this._agentResolver = new AgentResolver(agentsDir, log);
    this._agentResolver.init();

    this._store = new NotificationStore(dataDir, log);
    this._store.init();
    this.ctx._notificationStore = this._store;
    this.ctx._notificationHubPlugin = this;

    this._clickLogPath = path.join(dataDir, "notification-clicks.jsonl");
    this._activeToastIds = new Map();
    this._conversationNotificationDedup = new Map();
    this._notificationHubApi = createNotificationHubApi(this);
    this.ctx._notificationHubApi = this._notificationHubApi;

    // No last-known settings exist during startup: fail closed on a read error.
    const initialConfig = await this._readConfig();
    this._lastRawConfigSnapshot = this._configSnapshot(initialConfig);
    this._cfg = this._buildRuntimeConfig(initialConfig);

    this._customToast = new CustomToast({
      pluginDir,
      dataDir,
      log,
      sakuraEnabled: this._cfg.sakuraEnabled,
      sakuraTheme: this._cfg.sakuraTheme,
      toastLayout: this._cfg.toastLayout,
      toastScale: this._cfg.toastScale,
      toastOffsetX: this._cfg.toastOffsetX,
      toastOffsetY: this._cfg.toastOffsetY,
      toastStyle: this._cfg.toastStyle,
      particleShape: this._cfg.particleShape,
      autoParticleCountScale: this._cfg.autoParticleCountScale,
      manualParticleCountScale: this._cfg.manualParticleCountScale,
      particleSizeScale: this._cfg.particleSizeScale,
      particleIntervalEffect: this._cfg.particleIntervalEffect,
      cardExitMode: this._cfg.cardExitMode,
      cardExitFade: this._cfg.cardExitFade,
      entranceVisual: this._cfg.entranceVisual,
      autoDismissMotion: this._cfg.autoDismissMotion,
      manualDismissMotion: this._cfg.manualDismissMotion,
      physicsPreset: this._cfg.physicsPreset,
      toastTransportMode: this._cfg.toastTransportMode,
      onClick: this._cfg.clickAction ? (click) => this._handleToastClick(click) : null,
    });
    this.ctx._customToast = this._customToast;
    // 显式启动 toast 管理器进程
    this._customToast._startManager();

    // 不限类型时，流式 message_update 会打满 v2 RPC 入站上限，message_end 被宿主吞掉。
    const unsub = bus.subscribe(async (event, sessionPath) => {
      try { await this._handleEvent(event, sessionPath); }
      catch (err) { log.error("notification-hub event handler error:", err?.message); }
    }, { types: ["message_end", "turn_end", "channel_new_message", "error", "tool_error", "provider_error", "model_error", "model_unavailable", "rate_limit", "cron_job_done", "activity_update"] });
    this.register(unsub);

    log.info(`Notification Hub loaded. agents=${agentsDir} conv=${this._cfg.enableConversation}`);
  }

  onunload() {
    this._disposeRegistered();
    this._clearChannelAggregation();
    this._customToast?.stop();
    this._activeToastIds?.clear?.();
    if (this.ctx._notificationStore === this._store) delete this.ctx._notificationStore;
    if (this.ctx._notificationHubPlugin === this) delete this.ctx._notificationHubPlugin;
    if (this.ctx._notificationHubApi === this._notificationHubApi) delete this.ctx._notificationHubApi;
    this.ctx.log.info("Notification Hub unloaded.");
  }

  async _handleEvent(event, sessionPath) {
    if (!event || !event.type) return;
    switch (event.type) {
      case "message_end": {
        // Refresh session:list opportunistically so a known conversation never waits on it.
        prewarmSessionInfo(this, sessionPath);
        // 只允许明确的最终回复原因进入 conversation 通知。
        // 错误、截断、取消和工具阶段必须走对应状态路径或直接跳过，避免伪造“回复好了”。
        const stopReason = String(event.message?.stopReason || "").trim();
        if (this._isMessageFailure(event.message, stopReason)) {
          const refresh = this._maybeRefreshConfig();
          if (refresh?.then) await refresh;
          this._handleStatusEvent({
            type: "error",
            source: event.source || event.provider || "模型",
            error: this._extractMessageFailure(event.message, stopReason),
            meta: { stopReason, sessionPath },
          }, sessionPath);
          break;
        }
        if (event.message?.role === "assistant" && this._isFinalConversationStopReason(stopReason)) {
          if (!this._claimConversationNotification(sessionPath, event.message)) break;
          const refresh = this._maybeRefreshConfig();
          if (refresh?.then) await refresh;
          if (!this._cfg.enableConversation) break;
          await this._handleConversationEnd(event, sessionPath);
        }
        break;
      }

      case "turn_end": {
        const message = event.message;
        if (event.aborted === true || message?.role !== "assistant") break;
        const stopReason = String(message.stopReason || "").trim();
        if (this._isMessageFailure(message, stopReason)) break;
        if (!this._isFinalConversationStopReason(stopReason)) break;
        if (!this._claimConversationNotification(sessionPath, message)) break;
        const refresh = this._maybeRefreshConfig();
        if (refresh?.then) await refresh;
        if (!this._cfg.enableConversation) break;
        await this._handleConversationEnd({ type: "message_end", message, agentId: event.agentId }, sessionPath);
        break;
      }

      case "channel_new_message": {
        const refresh = this._maybeRefreshConfig({ force: true });
        if (refresh?.then) await refresh;
        if (!this._cfg.enableChannel) break;
        await this._handleChannelMessage(event);
        break;
      }

      case "notification": {
        break;
      }

      case "error":
      case "tool_error":
      case "provider_error":
      case "model_error":
      case "model_unavailable":
      case "rate_limit":
      case "cron_job_done":
      case "activity_update": {
        const refresh = this._maybeRefreshConfig();
        if (refresh?.then) await refresh;
        this._handleStatusEvent(event, sessionPath);
        break;
      }
    }
  }

  _claimConversationNotification(sessionPath, message) {
    const now = Date.now();
    for (const [key, claimedAt] of this._conversationNotificationDedup) {
      if (now - claimedAt > 120_000) this._conversationNotificationDedup.delete(key);
    }
    const key = JSON.stringify([
      sessionPath || "",
      message?.timestamp ?? "",
      message?.responseId || "",
    ]);
    if (this._conversationNotificationDedup.has(key)) return false;
    this._conversationNotificationDedup.set(key, now);
    return true;
  }

  _handleConversationEnd(event, sessionPath) { return handleConversationEnd(this, event, sessionPath); }

  _handleChannelMessage(event) { return handleChannelMessage(this, event); }

  _clearChannelAggregation() { return clearChannelAggregation(this); }

  _drainChannelAggregation() { return drainChannelAggregation(this); }

  _maybeAggregateChannelNotification(notification) { return maybeAggregateChannelNotification(this, notification); }

  _flushChannelAggregation(key, mode = "auto") { return flushChannelAggregation(this, key, mode); }

  _handleStatusEvent(event, sessionPath) { return handleStatusEvent(this, event, sessionPath); }

  _pushStatusNotification(payload) { return pushStatusNotification(this, payload); }

  _recordAndEmit(notification) { return recordAndEmit(this, notification); }

  _truncateStatusText(value) { return truncateStatusText(this, value); }

  _handleToastClick(click) {
    try {
      const notification = click?.notification || {};
      const action = {
        type: "notification_hub_click",
        clickedAt: click?.clickedAt || new Date().toISOString(),
        actionType: click?.actionType || "history",
        actionTarget: click?.actionTarget || notification.source || "",
        notificationId: click?.notificationId || notification.id || null,
        notificationType: click?.type || notification.type || "unknown",
        title: click?.title || notification.title || "通知",
        source: click?.source || notification.source || "",
        agentName: click?.agentName || notification.agentName || "",
        meta: notification.meta || {},
      };

      fs.appendFileSync(this._clickLogPath, JSON.stringify(action) + "\n", "utf8");
      this.ctx.log.info(`[通知点击] ${action.actionType} -> ${action.actionTarget || action.title}`);
      // v2 不能 emit open_conversation / open_channel / app_event。点击只写入历史，通知页据此高亮。
    } catch (err) {
      this.ctx.log.warn("notification click handler failed:", err.message);
    }
  }

  _emitDesktopNotification(notification, alreadyDecorated = false) { return emitDesktopNotification(this, notification, alreadyDecorated); }

  _now() {
    return new Date();
  }

  _popupBlockReason(notification) { return popupBlockReason(this, notification); }

  _emitDecoratedDesktopNotification(toastNotification) { return emitDecoratedDesktopNotification(this, toastNotification); }

  _notifyExternal(payload = {}) {
    const kind = String(payload.kind || "notify");
    const notification = normalizeExternalNotification(payload, kind);
    if (kind === "error") {
      notification.title = notification.title || "运行错误";
      notification.importance = notification.importance === "normal" ? "important" : notification.importance;
      notification.emoji = notification.emoji || "⚠️";
    } else if (kind === "success") {
      notification.title = notification.title || "操作完成";
      notification.emoji = notification.emoji || "✅";
    }
    if (kind === "progress") {
      notification.meta = { ...(notification.meta || {}), progress: notification.progress };
      notification.updateExistingId = notification.notificationId || notification.id;
    }
    const record = this._recordAndEmit(notification);
    return { ok: true, notification: record, apiVersion: "1.0" };
  }

  async _dismissExternal({ notificationId, id } = {}) {
    const key = String(notificationId || id || "").trim();
    if (!key) return { ok: false, error: "notificationId required" };
    const toastId = this._activeToastIds.get(key);
    if (!toastId) return { ok: false, dismissed: false, notificationId: key };
    const dismissed = await this._customToast?.close?.(toastId);
    if (dismissed) this._activeToastIds.delete(key);
    return { ok: dismissed === true, dismissed: dismissed === true, notificationId: key };
  }

  _getRecentExternal({ limit = 10, type } = {}) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    return { ok: true, records: this._store?.recent?.(safeLimit, type) || [], apiVersion: "1.0" };
  }

  _testExternal(options = {}) {
    const payload = normalizeExternalNotification({
      title: options.title || "Notification Hub 测试",
      body: options.body || "公共插件接口工作正常。",
      source: options.source || "notification-hub-api-test",
      type: options.type || "status",
      importance: options.importance || "normal",
      ...options,
    }, "notify");
    const record = this._recordAndEmit(payload);
    return { ok: true, notification: record, apiVersion: "1.0" };
  }

  _isFinalConversationStopReason(value) {
    return new Set(["stop", "end", "end_turn", "endturn", "stop_sequence", "completed", "success"]).has(String(value || "").toLowerCase());
  }

  _isMessageFailure(message = {}, stopReason = "") {
    const reason = String(stopReason || "").toLowerCase();
    if (["error", "failed", "failure", "timeout", "rate_limit", "ratelimit", "content_filter", "model_unavailable", "max_tokens"].includes(reason)) return true;
    return Boolean(message?.error || message?.errorMessage || message?.failed);
  }

  _extractMessageFailure(message = {}, stopReason = "") {
    const raw = message?.error || message?.errorMessage || message?.reason || this._extractSummary(message) || `模型结束原因为 ${stopReason || "未知错误"}`;
    return this._truncateStatusText(raw);
  }

  // ─── 辅助函数 ───

  _resolveChannel(channelName) { return resolveChannel(this, channelName); }

  _isSystemSender(sender) {
    if (sender == null) return false;
    const value = String(sender).trim().toLowerCase();
    return value === "system" || value === "sys" || value === "internal";
  }

  _readConfig() {
    return readHostConfig(this.ctx);
  }

  _buildRuntimeConfig(config) {
    return buildRuntimeConfig(config || {});
  }

  applySettingsUpdates(previousConfig = {}, updates = {}) {
    return this._applyRuntimeConfigSnapshot({ ...(previousConfig || {}), ...(updates || {}) });
  }

  applyRuntimeConfigSnapshot(rawConfig = {}) {
    return this._applyRuntimeConfigSnapshot(rawConfig || {});
  }

  _maybeRefreshConfig(options = {}) {
    // Only refresh config when we're about to handle a real notification event,
    // not on transient events like tool-call message_end.
    // Cache the last refresh time and skip if within 2 seconds to avoid thrashing.
    // Channel events force-refresh because channel aggregation queues must drain
    // immediately when their controlling settings are turned off.
    const now = Date.now();
    if (!options.force && this._lastConfigRefresh && (now - this._lastConfigRefresh) < 2000) return;
    this._lastConfigRefresh = now;
    return this._refreshConfigNow();
  }

  _refreshConfigNow() {
    const revision = this._configRevision || 0;
    const apply = (raw) => revision === (this._configRevision || 0) ? this._refreshResolvedConfig(raw) : this._cfg;
    const failed = (err) => {
      this.ctx?.log?.warn?.("notification-hub read runtime config failed:", err?.message || err);
      if (!this._cfg) throw err;
      return this._cfg;
    };
    try {
      const rawConfig = this._readConfig();
      return rawConfig?.then ? rawConfig.then(apply, failed) : apply(rawConfig);
    } catch (err) { return failed(err); }
  }

  _refreshResolvedConfig(rawConfig = {}) {
    const snapshot = this._configSnapshot(rawConfig);
    if (this._cfg && this._lastRawConfigSnapshot === snapshot) {
      this._lastConfigRefresh = Date.now();
      return this._cfg;
    }

    return this._applyRuntimeConfigSnapshot(rawConfig, snapshot);
  }

  _applyRuntimeConfigSnapshot(rawConfig = {}, snapshot = this._configSnapshot(rawConfig)) {
    const previousConfig = this._cfg;
    this._configRevision = (this._configRevision || 0) + 1;
    this._lastRawConfigSnapshot = snapshot;
    this._cfg = this._buildRuntimeConfig(rawConfig);
    this._lastConfigRefresh = Date.now();
    this._applyCustomToastConfig();
    if (!this._cfg.enableChannel) {
      this._clearChannelAggregation();
    } else if (previousConfig?.enableChannelAggregation && !this._cfg.enableChannelAggregation) {
      this._drainChannelAggregation();
    }
    return this._cfg;
  }

  _applyCustomToastConfig() {
    if (!this._customToast) return;
    this._customToast.sakuraEnabled = this._cfg.sakuraEnabled;
    this._customToast.sakuraTheme = this._cfg.sakuraTheme;
    this._customToast.toastLayout = this._cfg.toastLayout;
    this._customToast.toastScale = this._cfg.toastScale;
    this._customToast.toastOffsetX = this._cfg.toastOffsetX;
    this._customToast.toastOffsetY = this._cfg.toastOffsetY;
    this._customToast.toastStyle = this._cfg.toastStyle;
    this._customToast.particleShape = this._cfg.particleShape;
    this._customToast.autoParticleCountScale = this._cfg.autoParticleCountScale;
    this._customToast.manualParticleCountScale = this._cfg.manualParticleCountScale;
    this._customToast.particleSizeScale = this._cfg.particleSizeScale;
    this._customToast.particleIntervalEffect = this._cfg.particleIntervalEffect;
    this._customToast.cardExitMode = this._cfg.cardExitMode;
    this._customToast.cardExitFade = this._cfg.cardExitFade;
    this._customToast.entranceVisual = this._cfg.entranceVisual;
    this._customToast.autoDismissMotion = this._cfg.autoDismissMotion;
    this._customToast.manualDismissMotion = this._cfg.manualDismissMotion;
    this._customToast.physicsPreset = this._cfg.physicsPreset;
    this._customToast.setTransportMode?.(this._cfg.toastTransportMode);
    this._customToast.onClick = this._cfg.clickAction ? (click) => this._handleToastClick(click) : null;
  }

  _decorateToastNotification(notification) {
    return decorateToastNotification(notification, this._cfg);
  }

  _toastThemeColors(theme) {
    return toastThemeColors(theme);
  }

  _resolveToastColors(notification, themeColors) {
    return resolveToastColors(notification, themeColors);
  }

  showCustomToast(notification, options = {}) {
    const refresh = options.refreshConfig === false ? null : this._refreshConfigNow();
    if (refresh && typeof refresh.then === "function") {
      return refresh.then(() => this._showDecoratedCustomToast(notification, options));
    }
    return this._showDecoratedCustomToast(notification, options);
  }

  _showDecoratedCustomToast(notification, options = {}) {
    const decorated = this._decorateToastNotification(notification);
    if (options.confirmDisplay) {
      const blocked = this._popupBlockReason(decorated) || (this._cfg.displayMode === "off" ? "mode=off" : "");
      if (blocked) return { status: "suppressed", error: blocked };
      return this._customToast?.showConfirmed?.(decorated) || { status: "failed", error: "自定义弹窗确认入口不可用" };
    }
    this._customToast?.show?.(decorated);
    return decorated;
  }

  _normalizeHexColor(value, fallback = "#9b7cff") {
    return normalizeHexColor(value, fallback);
  }

  _normalizeDisplayMode(config) {
    return normalizeDisplayMode(config);
  }

  _normalizeSoundTheme(value) {
    return normalizeSoundTheme(value, "chime");
  }

  _resolveStatusSoundTheme(isImportant) {
    return resolveStatusSoundTheme(this._cfg, isImportant);
  }

  _resolveNotificationSoundTheme(type, importance) {
    return resolveNotificationSoundTheme(this._cfg, type, importance);
  }

  _resolveNotificationCustomSoundPath(type, importance) {
    return resolveNotificationCustomSoundPath(this._cfg, type, importance);
  }

  _resolveCustomSoundPath(notification) {
    return resolveCustomSoundPath(this._cfg, notification);
  }

  _normalizeToastStyle(value) {
    return normalizeToastStyle(value);
  }

  _normalizeParticleShape(value, legacyDismissEffect) {
    return normalizeParticleShape(value, legacyDismissEffect);
  }

  _normalizeEntranceVisual(value) {
    return normalizeEntranceVisual(value);
  }

  _normalizeDismissMotionTrack(value, fallback) {
    return normalizeDismissMotionTrack(value, fallback, "dismissMotions");
  }

  _normalizePhysicsPreset(value) {
    return normalizePhysicsPreset(value);
  }

  _normalizeToastTransportMode(value) {
    return normalizeToastTransportMode(value);
  }

  _clampNumber(value, fallback, min, max) {
    return intValue(value, fallback, min, max);
  }

  _clampDecimal(value, fallback, min, max) {
    return numberValue(value, fallback, min, max);
  }

  _parseKeywords(value) {
    return parseNotificationKeywords(value);
  }

  _configSnapshot(value) {
    try {
      return JSON.stringify(this._sortConfigValue(value));
    } catch {
      return "";
    }
  }

  _sortConfigValue(value) {
    if (Array.isArray(value)) return value.map((item) => this._sortConfigValue(item));
    if (!value || typeof value !== "object") return value;
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = this._sortConfigValue(value[key]);
    }
    return sorted;
  }

  _resolveImportance(type, text) {
    return resolveImportance(this._cfg, type, text);
  }

  _shouldPlaySound(type, importance) {
    return shouldPlaySound(this._cfg, type, importance);
  }

  _extractSummary(msg) {
    if (!msg) return null;
    // content 可能是字符串或 content block 数组
    if (typeof msg.content === "string") {
      return msg.content.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "text" && block.text) {
          return block.text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
        }
      }
    }
    return null;
  }

  _resolveAgentFromSession(sessionPath, event) { return resolveAgentFromSession(this, sessionPath, event); }

  _getSessionTitle(sessionPath) { return getSessionTitle(this, sessionPath); }
}
