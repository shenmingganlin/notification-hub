import { fileURLToPath } from "node:url";
import path from "node:path";
import NotificationHubPlugin from "./index.js";
import registerWidgetRoutes from "./server/widget-routes.js";
import * as testNotify from "./tools/test-notify.js";
import * as listNotifications from "./tools/list-notifications.js";
import * as clearNotifications from "./tools/clear-notifications.js";

const APP_ID = "notification-hub";

function writeLog(logger, level, args) {
  const text = args.map((item) => {
    if (item instanceof Error) return item.message;
    if (typeof item === "string") return item;
    try { return JSON.stringify(item); } catch { return String(item); }
  }).join(" ");
  const fn = logger?.[level];
  if (typeof fn !== "function") return;
  try {
    const result = fn.call(logger, text);
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    // 日志失败不能把应用拖垮。
  }
}

function bridgeContext(ctx, extras) {
  const bag = { ...extras };
  return new Proxy(ctx, {
    get(target, prop, receiver) {
      if (Object.prototype.hasOwnProperty.call(bag, prop)) return bag[prop];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(_target, prop, value) {
      bag[prop] = value;
      return true;
    },
    has(target, prop) {
      return Object.prototype.hasOwnProperty.call(bag, prop) || prop in target;
    },
    deleteProperty(_target, prop) {
      if (Object.prototype.hasOwnProperty.call(bag, prop)) {
        delete bag[prop];
        return true;
      }
      return false;
    },
  });
}

function rememberAgent(plugin, agent) {
  const resolver = plugin?._agentResolver;
  if (!agent?.id || !resolver?.get) return;
  const current = resolver.get(agent.id);
  resolver._cache?.set(agent.id, {
    ...current,
    displayName: agent.name || current.displayName,
    yuan: agent.yuan || current.yuan,
  });
}

async function hydrateAgents(ctx, plugin) {
  try {
    const result = await ctx.bus.request("agent:list", { scope: "all" });
    const rows = Array.isArray(result) ? result : (result?.agents || result?.items || []);
    for (const agent of rows) rememberAgent(plugin, agent);
    writeLog(ctx.logger, "info", [`notification-hub loaded ${rows.length} agent names`]);
  } catch (err) {
    writeLog(ctx.logger, "warn", ["notification-hub agent names unavailable", err]);
  }
}

const TOOLS = [
  ["notification-hub-test-notify", testNotify],
  ["notification-hub-list-notifications", listNotifications],
  ["notification-hub-clear-notifications", clearNotifications],
];

export async function apply(ctx) {
  const appDir = path.dirname(fileURLToPath(import.meta.url));
  const bridge = bridgeContext(ctx, {
    pluginDir: appDir,
    pluginId: APP_ID,
    log: {
      debug: (...args) => writeLog(ctx.logger, "debug", args),
      info: (...args) => writeLog(ctx.logger, "info", args),
      warn: (...args) => writeLog(ctx.logger, "warn", args),
      error: (...args) => writeLog(ctx.logger, "error", args),
    },
  });

  const plugin = new NotificationHubPlugin();
  plugin.ctx = bridge;
  await plugin.onload();

  const refreshConfig = () => {
    try {
      Promise.resolve(plugin._refreshConfigNow()).catch((err) => {
        writeLog(ctx.logger, "warn", ["notification-hub config refresh failed", err]);
      });
    } catch (err) {
      writeLog(ctx.logger, "warn", ["notification-hub config refresh failed", err]);
    }
  };
  setTimeout(refreshConfig, 1200);
  setTimeout(refreshConfig, 4000);
  setTimeout(() => { void hydrateAgents(ctx, plugin); }, 1200);

  ctx.routes.register((app) => {
    registerWidgetRoutes(app, bridge);
  });

  for (const [name, tool] of TOOLS) {
    ctx.tools.register({
      name,
      description: tool.description,
      parameters: tool.parameters,
      execute: (args) => tool.execute(args || {}, bridge),
    });
  }
}

export default { apply };
