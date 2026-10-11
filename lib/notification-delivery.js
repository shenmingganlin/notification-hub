import { isQuietHours, muteKeyForNotification } from "./notification-config.js";

export function recordAndEmit(plugin, notification) {
  const decorated = plugin._decorateToastNotification(notification);
  const record = decorated.updateExistingId && plugin._store.upsert
    ? plugin._store.upsert(decorated, decorated.updateExistingId)
    : (plugin._store.push(decorated) || decorated);
  const toastId = plugin._emitDesktopNotification(record, true);
  if (toastId && record.id) plugin._activeToastIds.set(record.id, toastId);
  return record;
}

export function emitDesktopNotification(plugin, notification, alreadyDecorated = false) {
  const toastNotification = alreadyDecorated ? notification : plugin._decorateToastNotification(notification);
  return plugin._emitDecoratedDesktopNotification(toastNotification);
}

export function popupBlockReason(plugin, notification) {
  if (isQuietHours(plugin._cfg, plugin._now())) return "quiet-hours";
  const key = muteKeyForNotification(notification);
  if (key && (plugin._cfg?.mutedSessionKeys || []).includes(key)) return "muted-session";
  return "";
}

export function emitDecoratedDesktopNotification(plugin, toastNotification) {
  const blocked = plugin._popupBlockReason(toastNotification);
  if (blocked) {
    plugin.ctx.log.info(`notification popup suppressed by ${blocked}`);
    return null;
  }
  if (plugin._cfg.displayMode === "off") {
    plugin.ctx.log.info("notification popup suppressed by mode=off");
    return null;
  }

  return plugin._customToast?.show(toastNotification) || null;
}
