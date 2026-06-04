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
import { CustomToast } from "./lib/custom-toast.js";
import {
  buildRuntimeConfig,
  getToastThemeColors,
  intValue,
  normalizeDismissEffect,
  normalizeDismissMotionTrack,
  normalizeDisplayMode,
  normalizeEntranceVisual,
  normalizeParticleShape,
  normalizePhysicsPreset,
  normalizeSoundTheme,
  normalizeToastStyle,
  normalizeToastTransportMode,
  numberValue,
  parseKeywords,
} from "./lib/notification-config.js";

export default class NotificationHubPlugin {
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
    this._handlingNotification = false;

    const initialConfig = this._readConfig();
    this._lastRawConfigSnapshot = this._configSnapshot(initialConfig);
    this._cfg = this._buildRuntimeConfig(initialConfig);

    this._customToast = new CustomToast({
      pluginDir,
      dataDir,
      log,
      sakuraEnabled: this._cfg.sakuraEnabled,
      sakuraTheme: this._cfg.sakuraTheme,
      toastStyle: this._cfg.toastStyle,
      dismissEffect: this._cfg.dismissEffect,
      particleShape: this._cfg.particleShape,
      autoParticleCountScale: this._cfg.autoParticleCountScale,
      manualParticleCountScale: this._cfg.manualParticleCountScale,
      particleSizeScale: this._cfg.particleSizeScale,
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

    const unsub = bus.subscribe((event, sessionPath) => {
      try { this._handleEvent(event, sessionPath); }
      catch (err) { log.error("notification-hub event handler error:", err?.message); }
    });
    this.register(unsub);

    log.info(`Notification Hub loaded. agents=${agentsDir} conv=${this._cfg.enableConversation}`);
  }

  onunload() {
    this._clearChannelAggregation();
    this._customToast?.stop();
    if (this.ctx._notificationStore === this._store) delete this.ctx._notificationStore;
    if (this.ctx._notificationHubPlugin === this) delete this.ctx._notificationHubPlugin;
    this.ctx.log.info("Notification Hub unloaded.");
  }

  _handleEvent(event, sessionPath) {
    if (!event || !event.type) return;
    switch (event.type) {
      case "message_end": {
        // message_end 有三种情况：
        //   1. agent 回复结束 → stopReason 存在且不为 "toolUse" → 通知
        //   2. agent 调工具   → stopReason === "toolUse"      → 跳过
        //   3. 工具结果返回   → 无 stopReason（有 toolCallId） → 跳过
        const stopReason = event.message?.stopReason;
        if (stopReason && stopReason !== "toolUse" && stopReason !== "aborted") {
          this._maybeRefreshConfig();
          if (!this._cfg.enableConversation) break;
          this._handleConversationEnd(event, sessionPath);
        }
        break;
      }

      case "channel_new_message": {
        this._maybeRefreshConfig({ force: true });
        if (!this._cfg.enableChannel) break;
        this._handleChannelMessage(event);
        break;
      }

      // notification-hub: 接管引擎/原生 notify → custom toast
      // 仅 custom mode 生效；native mode 下跳过，避免自递归
      case "notification": {
        this._maybeRefreshConfig();
        if (this._cfg.displayMode !== "custom") break;
        if (this._handlingNotification) break;
        this._handlingNotification = true;
        try {
          const agentInfo = event.agentId ? this._agentResolver.get(event.agentId) : null;
          const primary = agentInfo?.theme?.primary || "#636e72";
          this._emitDesktopNotification({
            id: `notify-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: event.type || "notification",
            title: event.title || "",
            body: event.body || "",
            agentId: event.agentId || "notification",
            primary,
            accent: agentInfo?.theme?.accent || primary,
            emoji: agentInfo?.theme?.emoji || "",
            timestamp: new Date().toISOString(),
          });
        } finally {
          this._handlingNotification = false;
        }
        break;
      }

      case "error":
      case "cron_job_done":
      case "activity_update": {
        this._maybeRefreshConfig();
        if (!this._cfg.enableStatusNotifications) break;
        this._handleStatusEvent(event, sessionPath);
        break;
      }
    }
  }

  _handleConversationEnd(event, sessionPath) {
    if (!sessionPath || sessionPath.includes("subagent-sessions")) return;

    const normalizedSessionPath = sessionPath.replace(/\\/g, "/");
    // phone sessions are delivery/coordination internals for channel/DM agents;
    // channel notifications are handled by channel_new_message, so avoid duplicate
    // or synthetic "System 回复好了" popups from phone session message_end events.
    if (normalizedSessionPath.includes("/phone/sessions/")) return;

    const agentInfo = this._resolveAgentFromSession(sessionPath, event);
    if (this._isSystemSender(agentInfo?.id) || this._isSystemSender(agentInfo?.displayName)) return;
    const title = this._getSessionTitle(sessionPath);
    const summary = this._extractSummary(event.message);

    const body = summary
      ? `${agentInfo.displayName}: ${summary}`
      : `${agentInfo.displayName} 回复好了`;
    const importance = this._resolveImportance("conversation", `${title || ""}\n${body}`);

    const notification = {
      type: "conversation",
      source: sessionPath,
      title: title || agentInfo.displayName,
      body,
      agentId: agentInfo.id,
      agentName: agentInfo.displayName,
      emoji: agentInfo.theme.emoji,
      primary: agentInfo.theme.primary,
      accent: agentInfo.theme.accent,
      importance: importance.level,
      matchedKeywords: importance.keywords,
      meta: { stopReason: event.message?.stopReason, matchedKeywords: importance.keywords },
      sound: this._shouldPlaySound("conversation", importance.level),
      soundTheme: this._cfg.notificationSoundTheme,
    };

    this._recordAndEmit(notification);

    this.ctx.log.info(`[通知] ${agentInfo.displayName} 回复了「${title || "无标题"}」`);
  }

  _handleChannelMessage(event) {
    const { channelName, sender, message } = event;
    if (!channelName || !message) return;
    if (this._isSystemSender(sender)) return;

    const agentInfo = this._agentResolver.resolveFromSender(sender);
    if (this._isSystemSender(agentInfo?.id) || this._isSystemSender(agentInfo?.displayName)) return;
    const channelInfo = this._resolveChannel(channelName);
    const channelDisplayName = channelInfo?.name || channelName;
    const bodyText = message.body
      ? message.body.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 800)
      : "(空消息)";

    const body = `${agentInfo.displayName}: ${bodyText}`;
    const importance = this._resolveImportance("channel", `${channelDisplayName}\n${body}`);

    const notification = {
      type: "channel",
      source: `#${channelName}`,
      title: channelDisplayName,
      body,
      agentId: sender,
      agentName: agentInfo.displayName,
      emoji: agentInfo.theme.emoji,
      primary: agentInfo.theme.primary,
      accent: agentInfo.theme.accent,
      importance: importance.level,
      matchedKeywords: importance.keywords,
      meta: {
        channelId: channelInfo?.id || channelName,
        channelName,
        channelDisplayName,
        matchedKeywords: importance.keywords,
        timestamp: message.timestamp,
      },
      sound: this._shouldPlaySound("channel", importance.level),
      soundTheme: this._cfg.notificationSoundTheme,
    };

    if (this._maybeAggregateChannelNotification(notification)) return;

    this._recordAndEmit(notification);
  }

  _clearChannelAggregation() {
    for (const entry of this._channelAggregation?.values?.() || []) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this._channelAggregation?.clear?.();
  }

  _drainChannelAggregation() {
    const entries = Array.from(this._channelAggregation?.values?.() || []);
    this._clearChannelAggregation();
    for (const entry of entries) {
      for (const item of entry.items || []) {
        this._recordAndEmit(item);
      }
    }
  }

  _maybeAggregateChannelNotification(notification) {
    if (!this._cfg?.enableChannelAggregation) return false;
    if (notification.type !== "channel") return false;
    if (notification.importance === "important" || notification.importance === "urgent") return false;

    const key = notification.source || notification.meta?.channelName || notification.title || "channel";
    let entry = this._channelAggregation.get(key);
    if (!entry) {
      entry = { items: [], timer: null };
      this._channelAggregation.set(key, entry);
    }

    entry.items.push(notification);

    if (entry.items.length >= this._cfg.channelAggregationThreshold) {
      this._flushChannelAggregation(key, "aggregate");
      return true;
    }

    if (!entry.timer) {
      entry.timer = setTimeout(() => {
        this._flushChannelAggregation(key, "auto");
      }, this._cfg.channelAggregationWindowMs);
      entry.timer.unref?.();
    }

    return true;
  }

  _flushChannelAggregation(key, mode = "auto") {
    const entry = this._channelAggregation?.get?.(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this._channelAggregation.delete(key);

    const items = entry.items || [];
    if (!items.length) return;

    if (mode !== "aggregate" && items.length < this._cfg.channelAggregationThreshold) {
      for (const item of items) {
        this._recordAndEmit(item);
      }
      return;
    }

    const first = items[0];
    const names = Array.from(new Set(items.map((n) => n.agentName).filter(Boolean))).slice(0, 4);
    const senders = names.length ? names.join("、") : "成员";
    const snippets = items
      .map((n) => String(n.body || "").replace(/^.*?:\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" / ");

    const aggregate = {
      type: "channel",
      source: first.source,
      title: first.title,
      body: `${first.title} 有 ${items.length} 条新消息\n${senders}：${snippets || "正在聊天"}`,
      agentId: "notification-hub",
      agentName: "频道摘要",
      emoji: "💬",
      primary: first.primary,
      accent: first.accent,
      importance: "normal",
      matchedKeywords: [],
      meta: {
        aggregate: true,
        count: items.length,
        channelId: first.meta?.channelId,
        channelName: first.meta?.channelName,
        channelDisplayName: first.meta?.channelDisplayName || first.title,
        senders: names,
      },
      sound: false,
      soundTheme: this._cfg.notificationSoundTheme,
    };

    this._recordAndEmit(aggregate);
  }

  _handleStatusEvent(event, sessionPath) {
    if (!event || !event.type) return;

    if (event.type === "error") {
      if (!this._cfg.enableErrorNotifications) return;
      const source = event.source || "HanaAgent";
      const message = this._truncateStatusText(event.error || event.message || "未知错误");
      this._pushStatusNotification({
        title: "运行错误",
        body: `${source}: ${message}`,
        importance: "important",
        meta: { eventType: event.type, source, sessionPath },
      });
      return;
    }

    if (event.type === "cron_job_done") {
      if (!this._cfg.enableTaskDoneNotifications) return;
      const label = event.label || event.jobLabel || event.jobName || event.jobId || "定时任务";
      this._pushStatusNotification({
        title: "任务完成",
        body: `${label} 已完成`,
        importance: "normal",
        meta: { eventType: event.type, jobId: event.jobId, sessionPath },
      });
      return;
    }

    if (event.type === "activity_update") {
      const activity = event.activity || {};
      const status = String(activity.status || activity.state || activity.phase || "").toLowerCase();
      const kind = String(activity.type || activity.kind || activity.category || "任务");
      const label = activity.label || activity.title || activity.name || activity.task || activity.id || kind;
      const errorText = activity.error || activity.errorMessage || activity.message;
      const isFailure = ["failed", "error", "errored", "failure", "rejected"].includes(status) || Boolean(activity.error || activity.failed);
      const isDone = ["done", "completed", "complete", "success", "succeeded", "resolved"].includes(status) || activity.done === true;

      if (isFailure) {
        if (!this._cfg.enableErrorNotifications) return;
        this._pushStatusNotification({
          title: "任务失败",
          body: `${label}: ${this._truncateStatusText(errorText || "执行失败")}`,
          importance: "important",
          meta: { eventType: event.type, activity, sessionPath },
        });
        return;
      }

      if (isDone) {
        if (!this._cfg.enableTaskDoneNotifications) return;
        this._pushStatusNotification({
          title: "任务完成",
          body: `${label} 已完成`,
          importance: "normal",
          meta: { eventType: event.type, activity, sessionPath },
        });
      }
    }
  }

  _pushStatusNotification({ title, body, importance = "normal", meta = {} }) {
    const isImportant = importance === "important" || importance === "urgent";
    const notification = {
      type: "status",
      source: meta.source || meta.eventType || "status",
      title,
      body,
      agentId: "notification-hub",
      agentName: isImportant ? "状态警报" : "状态监控",
      emoji: isImportant ? "⚠️" : "✅",
      primary: isImportant ? "#ff7675" : "#10a37f",
      accent: isImportant ? "#fdcb6e" : "#74b9ff",
      importance,
      matchedKeywords: [],
      meta,
      sound: this._shouldPlaySound("status", importance),
      soundTheme: isImportant ? "alert" : this._cfg.notificationSoundTheme,
    };

    this._recordAndEmit(notification);
  }

  _recordAndEmit(notification) {
    const decorated = this._decorateToastNotification(notification);
    const record = this._store.push(decorated) || decorated;
    this._emitDesktopNotification(record, true);
    return record;
  }

  _truncateStatusText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
  }

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

      // Navigate to the source
      try {
        if (action.actionType === "channel" || action.actionType === "channel-aggregate") {
          const channelId = action.actionTarget || action.source;
          if (channelId) {
            this.ctx.bus?.emit?.({ type: "open_channel", channelId }, null);
          }
        } else if (action.actionType === "conversation" || action.actionType === "history") {
          const sessionPath = action.actionTarget || action.source;
          if (sessionPath) {
            this.ctx.bus?.emit?.({ type: "open_conversation", sessionPath }, null);
          }
        }
      } catch (err) {
        this.ctx.log.warn("notification click navigate failed:", err.message);
      }

      try {
        this.ctx.bus?.emit?.({
          type: "app_event",
          event: {
            type: "notification-hub-click",
            payload: action,
            source: "notification-hub",
          },
        }, null);
      } catch (err) {
        this.ctx.log.warn("notification click app_event emit failed:", err.message);
      }

      try {
        this.ctx.bus?.emit?.(action, null);
      } catch (err) {
        this.ctx.log.warn("notification click bus emit failed:", err.message);
      }
    } catch (err) {
      this.ctx.log.warn("notification click handler failed:", err.message);
    }
  }

  _emitDesktopNotification(notification, alreadyDecorated = false) {
    const toastNotification = alreadyDecorated ? notification : this._decorateToastNotification(notification);
    this._emitDecoratedDesktopNotification(toastNotification);
  }

  _emitDecoratedDesktopNotification(toastNotification) {
    const title = `${toastNotification.emoji || ""} ${toastNotification.title}`.trim();
    const body = toastNotification.body || "";

    if (this._cfg.displayMode === "custom") {
      this._customToast?.show(toastNotification);
      return;
    }

    if (this._cfg.displayMode === "native") {
      try {
        this.ctx.bus.emit({
          type: "notification",
          title,
          body,
          agentId: toastNotification.agentId || null,
        }, null);
      } catch (err) {
        this.ctx.log.warn("emit notification failed:", err.message);
      }
      return;
    }

    this.ctx.log.info(`notification popup suppressed by mode=${this._cfg.displayMode}`);
  }

  // ─── 辅助函数 ───

  _resolveChannel(channelName) {
    if (!channelName) return null;
    if (this._channelCache?.has(channelName)) return this._channelCache.get(channelName);

    let info = null;
    try {
      const channelFile = path.join(this._channelsDir || "", `${channelName}.md`);
      if (fs.existsSync(channelFile)) {
        const raw = fs.readFileSync(channelFile, "utf-8");
        const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
        const frontmatter = match?.[1] || "";
        const data = {};
        for (const line of frontmatter.split(/\r?\n/)) {
          const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
          if (!kv) continue;
          data[kv[1]] = kv[2].trim();
        }
        info = {
          id: data.id || channelName,
          name: data.name || null,
          description: data.description || null,
        };
      }
    } catch (err) {
      this.ctx?.log?.warn?.(`resolve channel ${channelName} failed: ${err.message}`);
    }

    if (!info) info = { id: channelName, name: null, description: null };
    this._channelCache?.set(channelName, info);
    return info;
  }

  _isSystemSender(sender) {
    if (sender == null) return false;
    const value = String(sender).trim().toLowerCase();
    return value === "system" || value === "sys" || value === "internal";
  }

  _readConfig() {
    const config = this.ctx?.config;
    try {
      if (config?.getAll) return config.getAll() || {};
      if (config?.get) return config.get() || {};
    } catch (err) {
      this.ctx?.log?.warn?.("notification-hub read runtime config failed:", err?.message || err);
    }
    return config && typeof config === "object" ? config : {};
  }

  _buildRuntimeConfig(config) {
    return buildRuntimeConfig(config || {});
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
    this._refreshConfigNow();
  }

  _refreshConfigNow() {
    const rawConfig = this._readConfig();
    const snapshot = this._configSnapshot(rawConfig);
    if (this._cfg && this._lastRawConfigSnapshot === snapshot) {
      this._lastConfigRefresh = Date.now();
      return this._cfg;
    }

    const previousConfig = this._cfg;
    this._lastRawConfigSnapshot = snapshot;
    this._cfg = this._buildRuntimeConfig(rawConfig);
    this._lastConfigRefresh = Date.now();
    if (this._customToast) {
      this._customToast.sakuraEnabled = this._cfg.sakuraEnabled;
      this._customToast.sakuraTheme = this._cfg.sakuraTheme;
      this._customToast.toastStyle = this._cfg.toastStyle;
      this._customToast.dismissEffect = this._cfg.dismissEffect;
      this._customToast.particleShape = this._cfg.particleShape;
      this._customToast.autoParticleCountScale = this._cfg.autoParticleCountScale;
      this._customToast.manualParticleCountScale = this._cfg.manualParticleCountScale;
      this._customToast.particleSizeScale = this._cfg.particleSizeScale;
      this._customToast.entranceVisual = this._cfg.entranceVisual;
      this._customToast.autoDismissMotion = this._cfg.autoDismissMotion;
      this._customToast.manualDismissMotion = this._cfg.manualDismissMotion;
      this._customToast.physicsPreset = this._cfg.physicsPreset;
      this._customToast.setTransportMode?.(this._cfg.toastTransportMode);
      this._customToast.onClick = this._cfg.clickAction ? (click) => this._handleToastClick(click) : null;
    }
    if (!this._cfg.enableChannel) {
      this._clearChannelAggregation();
    } else if (previousConfig?.enableChannelAggregation && !this._cfg.enableChannelAggregation) {
      this._drainChannelAggregation();
    }
    return this._cfg;
  }

  _decorateToastNotification(notification) {
    const sakuraTheme = notification?.sakuraTheme || this._cfg.sakuraTheme;
    const themeColors = this._toastThemeColors(sakuraTheme);
    const colors = this._resolveToastColors(notification, themeColors);
    return {
      ...notification,
      primary: colors.primary,
      accent: colors.accent,
      meta: {
        ...(notification?.meta || {}),
        toastColorSource: colors.source,
      },
      toastStyle: this._normalizeToastStyle(notification?.toastStyle || this._cfg.toastStyle),
      dismissEffect: this._normalizeDismissEffect(notification?.dismissEffect || this._cfg.dismissEffect, this._cfg.sakuraEnabled),
      particleShape: this._normalizeParticleShape(notification?.particleShape || this._cfg.particleShape, notification?.dismissEffect || this._cfg.dismissEffect),
      autoParticleCountScale: this._clampDecimal(notification?.autoParticleCountScale, this._cfg.autoParticleCountScale, 0.2, 4.0),
      manualParticleCountScale: this._clampDecimal(notification?.manualParticleCountScale, this._cfg.manualParticleCountScale, 0.2, 4.0),
      particleSizeScale: this._clampDecimal(notification?.particleSizeScale, this._cfg.particleSizeScale, 0.5, 3.0),
      entranceVisual: this._normalizeEntranceVisual(notification?.entranceVisual || this._cfg.entranceVisual),
      autoDismissMotion: normalizeDismissMotionTrack(notification?.autoDismissMotion || this._cfg.autoDismissMotion, "drift", "autoDismissMotions"),
      manualDismissMotion: normalizeDismissMotionTrack(notification?.manualDismissMotion || this._cfg.manualDismissMotion, "click-burst", "manualDismissMotions"),
      physicsPreset: this._normalizePhysicsPreset(notification?.physicsPreset || this._cfg.physicsPreset),
      toastTransportMode: notification?.toastTransportMode || this._cfg.toastTransportMode,
      sakuraTheme,
    };
  }

  _toastThemeColors(theme) {
    return getToastThemeColors(theme);
  }

  _resolveToastColors(notification, themeColors) {
    const primaryCandidate = themeColors?.primary || notification?.primary || notification?.theme?.primary;
    const primarySource = themeColors?.primary
      ? "sakuraTheme.primary"
      : notification?.primary
        ? "notification.primary"
        : notification?.theme?.primary
          ? "notification.theme.primary"
          : "fallback.primary";
    const primary = this._normalizeHexColor(primaryCandidate, "#9b7cff");

    const accentCandidate = themeColors?.accent || notification?.accent || notification?.theme?.accent || primary;
    const accentSource = themeColors?.accent
      ? "sakuraTheme.accent"
      : notification?.accent
        ? "notification.accent"
        : notification?.theme?.accent
          ? "notification.theme.accent"
          : "primary";
    const accent = this._normalizeHexColor(accentCandidate, primary);

    return { primary, accent, source: { primary: primarySource, accent: accentSource } };
  }

  showCustomToast(notification, options = {}) {
    if (options.refreshConfig !== false) this._refreshConfigNow();
    const decorated = this._decorateToastNotification(notification);
    this._customToast?.show?.(decorated);
    return decorated;
  }

  _normalizeHexColor(value, fallback = "#9b7cff") {
    const text = String(value || "").trim();
    const direct = text.match(/^#([0-9a-fA-F]{6})$/);
    if (direct) return `#${direct[1].toLowerCase()}`;
    const short = text.match(/^#([0-9a-fA-F]{3})$/);
    if (short) {
      const [r, g, b] = short[1].toLowerCase().split("");
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    const embedded = text.match(/#([0-9a-fA-F]{6})\b/);
    if (embedded) return `#${embedded[1].toLowerCase()}`;
    return fallback;
  }

  _normalizeDisplayMode(config) {
    return normalizeDisplayMode(config);
  }

  _normalizeSoundTheme(value) {
    return normalizeSoundTheme(value, "chime");
  }

  _normalizeToastStyle(value) {
    return normalizeToastStyle(value);
  }

  _normalizeDismissEffect(value, sakuraEnabled) {
    return normalizeDismissEffect(value, sakuraEnabled);
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
    return parseKeywords(value);
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
    const base = type === "channel" ? "low" : "normal";
    if (!this._cfg?.enableKeywordImportance) return { level: base, keywords: [] };

    const haystack = String(text || "").toLowerCase();
    const matched = [];
    for (const keyword of this._cfg.keywords || []) {
      const needle = String(keyword || "").trim();
      if (!needle) continue;
      if (haystack.includes(needle.toLowerCase())) matched.push(needle);
    }

    if (matched.length) return { level: "important", keywords: matched };
    return { level: base, keywords: [] };
  }

  _shouldPlaySound(type, importance) {
    if (this._cfg.notificationSoundTheme === "off") return false;
    if (importance === "important" || importance === "urgent") return this._cfg.importantNotificationSound !== false;
    if (type === "conversation") return this._cfg.enableConversationSound !== false;
    if (type === "channel") return this._cfg.enableChannelSound === true;
    return false;
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

  _resolveAgentFromSession(sessionPath, event) {
    const normalPath = sessionPath.replace(/\\/g, "/");
    const match = normalPath.match(/\/agents\/([^/]+)\/sessions\//);
    if (match) {
      const info = this._agentResolver.get(match[1]);
      if (info) return info;
    }
    return this._agentResolver.resolveFromSender(event.agentId);
  }

  _getSessionTitle(sessionPath) {
    try {
      const sessionDir = path.dirname(sessionPath);
      const titlesFile = path.join(sessionDir, "session-titles.json");
      if (!fs.existsSync(titlesFile)) return null;
      const raw = fs.readFileSync(titlesFile, "utf-8");
      const titles = JSON.parse(raw);
      const normalized = sessionPath.replace(/\\/g, "/");
      return titles[normalized] || titles[sessionPath] || null;
    } catch {
      return null;
    }
  }
}
