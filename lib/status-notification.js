export function handleStatusEvent(plugin, event, sessionPath) {
  if (!event || !event.type) return;

  const failureEventTypes = new Set(["error", "tool_error", "provider_error", "model_error", "model_unavailable", "rate_limit"]);
  if (failureEventTypes.has(event.type)) {
    if (!plugin._cfg.enableErrorNotifications) return;
    const source = event.source || event.provider || event.type;
    const message = plugin._truncateStatusText(event.error || event.errorMessage || event.message || event.reason || "未知错误");
    plugin._pushStatusNotification({
      title: "运行错误",
      body: `${source}: ${message}`,
      importance: "important",
      meta: { eventType: event.type, source, sessionPath, ...(event.meta || {}) },
    });
    return;
  }

  if (event.type === "cron_job_done") {
    if (!plugin._cfg.enableTaskDoneNotifications) return;
    const label = event.label || event.jobLabel || event.jobName || event.jobId || "定时任务";
    plugin._pushStatusNotification({
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
      if (!plugin._cfg.enableErrorNotifications) return;
      plugin._pushStatusNotification({
        title: "任务失败",
        body: `${label}: ${plugin._truncateStatusText(errorText || "执行失败")}`,
        importance: "important",
        meta: { eventType: event.type, activity, sessionPath },
      });
      return;
    }

    if (isDone) {
      if (!plugin._cfg.enableTaskDoneNotifications) return;
      plugin._pushStatusNotification({
        title: "任务完成",
        body: `${label} 已完成`,
        importance: "normal",
        meta: { eventType: event.type, activity, sessionPath },
      });
    }
  }
}

export function pushStatusNotification(plugin, { title, body, importance = "normal", meta = {} }) {
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
    sound: plugin._shouldPlaySound("status", importance),
    soundTheme: plugin._resolveStatusSoundTheme(isImportant),
  };

  plugin._recordAndEmit(notification);
}

export function truncateStatusText(plugin, value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
}
