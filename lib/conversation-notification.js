import path from "node:path";
const sessionListCache = new WeakMap();
const SESSION_LIST_CACHE_MS = 20_000;
const SESSION_LIST_PREWARM_MS = 3_000;

export async function handleConversationEnd(plugin, event, sessionPath) {
  if (!sessionPath || sessionPath.includes("subagent-sessions")) return;

  const normalizedSessionPath = sessionPath.replace(/\\/g, "/");
  // phone sessions are delivery/coordination internals for channel/DM agents;
  // channel notifications are handled by channel_new_message, so avoid duplicate
  // or synthetic "System 回复好了" popups from phone session message_end events.
  if (normalizedSessionPath.includes("/phone/sessions/")) return;

  const agentInfo = plugin._resolveAgentFromSession(sessionPath, event);
  if (plugin._isSystemSender(agentInfo?.id) || plugin._isSystemSender(agentInfo?.displayName)) return;
  const sessionInfo = await getSessionInfo(plugin, sessionPath);
  const title = sessionInfo?.title || "";
  const sessionId = sessionInfo?.sessionId;
  const summary = plugin._extractSummary(event.message);

  const body = summary
    ? `${agentInfo.displayName}: ${summary}`
    : `${agentInfo.displayName} 回复好了`;
  const importance = plugin._resolveImportance("conversation", `${title || ""}\n${body}`);

  const notification = {
    type: "conversation",
    source: sessionPath,
    sourceLabel: `会话 · ${title || "未命名会话"}`,
    title: title || agentInfo.displayName,
    body,
    agentId: agentInfo.id,
    agentName: agentInfo.displayName,
    emoji: agentInfo.theme.emoji,
    primary: agentInfo.theme.primary,
    accent: agentInfo.theme.accent,
    importance: importance.level,
    matchedKeywords: importance.keywords,
    meta: {
      stopReason: event.message?.stopReason,
      matchedKeywords: importance.keywords,
      sourceKind: "reply",
      sessionTitle: title || "",
      ...(sessionId ? { sessionId } : {}),
      replyExcerpt: summary || "",
    },
    sound: plugin._shouldPlaySound("conversation", importance.level),
    soundTheme: plugin._resolveNotificationSoundTheme("conversation", importance.level),
    customSoundPath: plugin._resolveNotificationCustomSoundPath("conversation", importance.level),
  };

  const latest = plugin._store?.recent?.(1)?.[0];
  const ageMs = Date.now() - Number(latest?.ts);
  if (plugin._cfg?.enableConversationMerge !== false
    && latest?.type === "conversation" && latest.source === sessionPath && ageMs >= 0 && ageMs <= 60_000) {
    const previousMergedCount = Number(latest.meta?.mergedCount);
    const mergedCount = Number.isInteger(previousMergedCount) && previousMergedCount >= 1
      ? previousMergedCount + 1
      : 2;
    notification.meta.mergedCount = mergedCount;
    notification.updateExistingId = latest.id;
  }
  plugin._recordAndEmit(notification);

  plugin.ctx.log.info(`[通知] ${agentInfo.displayName} 回复了「${title || "无标题"}」`);
}

export function resolveAgentFromSession(plugin, sessionPath, event) {
  const normalPath = sessionPath.replace(/\\/g, "/");
  const match = normalPath.match(/\/agents\/([^/]+)\/sessions\//);
  if (match) {
    const info = plugin._agentResolver.get(match[1]);
    if (info) return info;
  }
  return plugin._agentResolver.resolveFromSender(event.agentId);
}

export async function getSessionTitle(plugin, sessionPath) {
  return (await getSessionInfo(plugin, sessionPath))?.title || null;
}

export async function getSessionInfo(plugin, sessionPath) {
  return getSessionInfoFromHost(plugin, sessionPath);
}

export function prewarmSessionInfo(plugin, sessionPath) {
  const bus = plugin?.ctx?.bus;
  if (!bus || typeof bus.request !== "function" || !sessionPath) return;
  const cache = getSessionListCache(bus);
  const now = Date.now();
  if (cache.lastRefreshAt + SESSION_LIST_PREWARM_MS > now) return;
  void refreshSessionList(bus, cache, false);
}

async function getSessionInfoFromHost(plugin, sessionPath) {
  const bus = plugin?.ctx?.bus;
  if (!bus || typeof bus.request !== "function") return null;

  const cache = getSessionListCache(bus);
  const cachedInfo = findCachedSession(cache, sessionPath);
  if (cachedInfo?.title) {
    // A known title is enough to deliver now; the refresh only updates the next event.
    void refreshSessionList(bus, cache, false);
    return cachedInfo;
  }

  await refreshSessionList(bus, cache, true);
  return findCachedSession(cache, sessionPath);
}

function getSessionListCache(bus) {
  let cache = sessionListCache.get(bus);
  if (!cache) {
    cache = {
      entries: new Map(),
      expiresAt: 0,
      lastRefreshAt: 0,
      request: null,
    };
    sessionListCache.set(bus, cache);
  }
  return cache;
}

function refreshSessionList(bus, cache, waitForFresh) {
  const now = Date.now();
  if (cache.request) return cache.request;
  // A fresh full list is also a negative cache for missing/untitled sessions.
  if (cache.expiresAt > now) return Promise.resolve();
  cache.lastRefreshAt = now;
  cache.request = Promise.resolve()
    .then(() => bus.request("session:list", { scope: "all", lifecycle: "all" }))
    .then((result) => {
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      for (const session of sessions) {
        const key = normalizeSessionPath(session?.path);
        if (!key || !nonEmptyTitle(session?.title)) continue;
        cache.entries.set(key, {
          title: String(session.title).trim(),
          ...(typeof session.sessionId === "string" && session.sessionId.trim()
            ? { sessionId: session.sessionId.trim() }
            : {}),
        });
      }
      cache.expiresAt = Date.now() + SESSION_LIST_CACHE_MS;
    })
    .catch(() => { cache.expiresAt = Date.now() + SESSION_LIST_PREWARM_MS; })
    .finally(() => {
      cache.request = null;
    });
  return cache.request;
}

function findCachedSession(cache, sessionPath) {
  const targetPath = normalizeSessionPath(sessionPath);
  const exact = cache.entries.get(targetPath);
  if (exact) return exact;
  const targetName = sessionFileName(sessionPath);
  for (const [pathKey, info] of cache.entries) {
    if (sessionFileName(pathKey) === targetName) return info;
  }
  return null;
}

function nonEmptyTitle(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function normalizeSessionPath(value) {
  return String(value || "").replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
}

function sessionFileName(value) {
  return String(value || "").split(/[\\/]/).pop().toLowerCase();
}

