import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export async function handleChannelMessage(plugin, event) {
  const { channelName, sender, message } = event;
  if (!channelName || !message) return;
  if (plugin._isSystemSender(sender)) return;

  const agentInfo = plugin._agentResolver.resolveFromSender(sender);
  if (plugin._isSystemSender(agentInfo?.id) || plugin._isSystemSender(agentInfo?.displayName)) return;
  const channelInfo = await plugin._resolveChannel(channelName);
  const channelDisplayName = channelInfo?.name || channelName;
  const bodyText = message.body
    ? message.body.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 800)
    : "(空消息)";

  const body = `${agentInfo.displayName}: ${bodyText}`;
  const importance = plugin._resolveImportance("channel", `${channelDisplayName}\n${body}`);

  const notification = {
    type: "channel",
    source: `#${channelName}`,
    sourceLabel: `频道 · ${channelDisplayName}`,
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
      sourceKind: "channel",
      matchedKeywords: importance.keywords,
      timestamp: message.timestamp,
    },
    sound: plugin._shouldPlaySound("channel", importance.level),
    soundTheme: plugin._resolveNotificationSoundTheme("channel", importance.level),
    customSoundPath: plugin._resolveNotificationCustomSoundPath("channel", importance.level),
  };

  if (plugin._maybeAggregateChannelNotification(notification)) return;

  plugin._recordAndEmit(notification);
}

export function clearChannelAggregation(plugin) {
  for (const entry of plugin._channelAggregation?.values?.() || []) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  plugin._channelAggregation?.clear?.();
}

export function drainChannelAggregation(plugin) {
  const entries = Array.from(plugin._channelAggregation?.values?.() || []);
  plugin._clearChannelAggregation();
  for (const entry of entries) {
    for (const item of entry.items || []) {
      plugin._recordAndEmit(item);
    }
  }
}

export function maybeAggregateChannelNotification(plugin, notification) {
  if (!plugin._cfg?.enableChannelAggregation) return false;
  if (notification.type !== "channel") return false;
  if (notification.importance === "important" || notification.importance === "urgent") return false;

  const key = notification.source || notification.meta?.channelName || notification.title || "channel";
  let entry = plugin._channelAggregation.get(key);
  if (!entry) {
    entry = { items: [], timer: null };
    plugin._channelAggregation.set(key, entry);
  }

  entry.items.push(notification);

  if (entry.items.length >= plugin._cfg.channelAggregationThreshold) {
    plugin._flushChannelAggregation(key, "aggregate");
    return true;
  }

  if (!entry.timer) {
    entry.timer = setTimeout(() => {
      plugin._flushChannelAggregation(key, "auto");
    }, plugin._cfg.channelAggregationWindowMs);
    entry.timer.unref?.();
  }

  return true;
}

export function flushChannelAggregation(plugin, key, mode = "auto") {
  const entry = plugin._channelAggregation?.get?.(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  plugin._channelAggregation.delete(key);

  const items = entry.items || [];
  if (!items.length) return;

  if (mode !== "aggregate" && items.length < plugin._cfg.channelAggregationThreshold) {
    for (const item of items) {
      plugin._recordAndEmit(item);
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

  const channelDisplayName = first.meta?.channelDisplayName || first.title;
  const aggregate = {
    type: "channel",
    source: first.source,
    sourceLabel: `频道 · ${channelDisplayName}`,
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
      channelDisplayName,
      sourceKind: "channel",
      senders: names,
    },
    sound: false,
    soundTheme: plugin._cfg.notificationSoundTheme,
  };

  plugin._recordAndEmit(aggregate);
}

export async function resolveChannel(plugin, channelName) {
  if (!channelName || /[\\/]|\.\./.test(channelName)) return null;
  if (plugin._channelCache?.has(channelName)) return plugin._channelCache.get(channelName);

  const channelFile = path.join(plugin._channelsDir || "", `${channelName}.md`);
  try {
    const info = parseChannelFrontmatter(fs.readFileSync(channelFile, "utf8"), channelName);
    plugin._channelCache?.set(channelName, info);
    return info;
  } catch (err) {
    if (err?.code === "ENOENT") {
      const info = emptyChannelInfo(channelName);
      plugin._channelCache?.set(channelName, info);
      return info;
    }
    if (!isReadPermissionError(err)) {
      plugin.ctx?.log?.warn?.(`resolve channel ${channelName} failed: ${err?.message || err}`);
      return emptyChannelInfo(channelName);
    }
  }

  try {
    const raw = await readChannelWithPowerShell(channelFile);
    const info = parseChannelFrontmatter(raw, channelName);
    plugin._channelCache?.set(channelName, info);
    return info;
  } catch (err) {
    plugin.ctx?.log?.warn?.(`resolve channel ${channelName} failed: ${err?.message || err}`);
    return emptyChannelInfo(channelName);
  }
}

export function parseChannelFrontmatter(raw, channelName) {
  const match = String(raw || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const values = {};
  for (const line of (match?.[1] || "").split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    values[field[1]] = parseFrontmatterValue(field[2]);
  }
  const name = values.name && values.name !== channelName ? values.name : null;
  return {
    id: values.id || channelName,
    name,
    description: values.description || null,
  };
}

function parseFrontmatterValue(value) {
  let text = String(value || "").trim();
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? "" : character;
      continue;
    }
    if (!quote && character === "#" && /\s/.test(text[i - 1] || "")) {
      text = text.slice(0, i).trim();
      break;
    }
  }
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function emptyChannelInfo(channelName) {
  return { id: channelName, name: null, description: null };
}

function isReadPermissionError(err) {
  return err?.code === "ERR_ACCESS" || err?.code === "EPERM" || /allow-fs-read/i.test(String(err?.message || ""));
}

export function readChannelWithPowerShell(channelFile, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const script = "$ErrorActionPreference='Stop'; $utf8 = New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; Get-Content -Raw -Encoding utf8 -LiteralPath $env:NOTIFICATION_HUB_CHANNEL_FILE";
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      env: { ...process.env, NOTIFICATION_HUB_CHANNEL_FILE: channelFile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(new Error("channel frontmatter read timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(stderr.trim() || `powershell exited with code ${code}`));
    });
  });
}
