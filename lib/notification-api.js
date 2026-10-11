// Stable, narrow integration surface for other HanaAgent plugins.
// Consumers should use ctx._notificationHubApi rather than reaching into renderer/store internals.

export const NOTIFICATION_HUB_API_VERSION = "1.0";

function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

const TYPES = new Set(["conversation", "channel", "status"]);
const IMPORTANCE = new Set(["low", "normal", "important", "urgent"]);
const ACTION_TYPES = new Set(["conversation", "channel", "channel-aggregate", "status", "history", "custom"]);

export function createNotificationHubApi(plugin) {
  const call = (method, payload = {}) => {
    try {
      return plugin[method](payload);
    } catch (error) {
      plugin.ctx?.log?.warn?.(`[notification-hub] public API ${method} failed: ${error?.message || error}`);
      return { ok: false, error: "notification request failed" };
    }
  };

  return Object.freeze({
    apiVersion: NOTIFICATION_HUB_API_VERSION,
    pluginId: "notification-hub",
    capabilities: Object.freeze([
      "notify",
      "notifyError",
      "notifySuccess",
      "notifyProgress",
      "dismiss",
      "getRecent",
      "test",
    ]),
    notify: (payload) => call("_notifyExternal", { ...(payload || {}), kind: "notify" }),
    notifyError: (payload) => call("_notifyExternal", { ...(payload || {}), kind: "error" }),
    notifySuccess: (payload) => call("_notifyExternal", { ...(payload || {}), kind: "success" }),
    notifyProgress: (payload) => call("_notifyExternal", { ...(payload || {}), kind: "progress" }),
    dismiss: (payload) => call("_dismissExternal", typeof payload === "string" ? { notificationId: payload } : (payload || {})),
    getRecent: (options) => call("_getRecentExternal", options || {}),
    test: (options) => call("_testExternal", options || {}),
  });
}

export function normalizeExternalNotification(payload = {}, kind = "notify") {
  const input = payload && typeof payload === "object" ? payload : {};
  const type = TYPES.has(String(input.type || "status")) ? String(input.type || "status") : "status";
  const importance = IMPORTANCE.has(String(input.importance || "normal"))
    ? String(input.importance || "normal")
    : (kind === "error" ? "important" : "normal");
  const actionType = ACTION_TYPES.has(String(input.actionType || "")) ? String(input.actionType) : undefined;
  const body = String(input.body ?? input.message ?? "").trim().slice(0, 4000);
  const title = String(input.title || (kind === "error" ? "运行错误" : kind === "success" ? "操作完成" : "通知")).trim().slice(0, 240);
  const source = String(input.source || input.pluginId || "external-plugin").trim().slice(0, 240);
  const notificationId = String(input.notificationId || input.id || "").trim().slice(0, 160);
  const meta = input.meta && typeof input.meta === "object" && !Array.isArray(input.meta) ? { ...input.meta } : {};

  return {
    ...input,
    id: notificationId || undefined,
    notificationId: notificationId || undefined,
    type,
    title,
    body,
    source,
    importance,
    actionType,
    actionTarget: input.actionTarget == null ? undefined : String(input.actionTarget).slice(0, 1000),
    agentId: String(input.agentId || source).slice(0, 160),
    agentName: String(input.agentName || source).slice(0, 160),
    emoji: String(input.emoji || (kind === "error" ? "⚠️" : kind === "success" ? "✅" : "🔔")).slice(0, 8),
    meta: { ...meta, integration: "notification-hub", apiVersion: NOTIFICATION_HUB_API_VERSION, kind },
    progress: clampProgress(input.progress),
  };
}