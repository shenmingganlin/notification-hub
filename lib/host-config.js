// Preserve sync reads for existing callers, but never turn a read failure into defaults.
const updateQueues = new WeakMap();

export function readHostConfig(ctx) {
  const config = ctx?.config;
  const value = typeof config?.getAll === "function" ? config.getAll()
    : typeof config?.get === "function" ? config.get() : config;
  return value && typeof value.then === "function"
    ? Promise.resolve(value).then(plainConfig)
    : plainConfig(value);
}

export async function writeHostConfig(ctx, updates) {
  const config = ctx?.config;
  if (typeof config?.setMany === "function") {
    const result = await config.setMany(updates);
    if (result === false || result?.ok === false) throw new Error(result?.error || "config save failed");
    return;
  }
  if (typeof config?.set === "function") {
    for (const [key, value] of Object.entries(updates)) {
      const result = await config.set(key, value);
      if (result === false || result?.ok === false) throw new Error(result?.error || "config save failed");
    }
    return;
  }
  throw new Error("plugin config API unavailable");
}

// Serialize the entire read/modify/write transaction, including the runtime apply.
// A failed transaction must not poison the next one.
export function updateHostConfig(ctx, update) {
  const previous = updateQueues.get(ctx) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const raw = await readHostConfig(ctx);
    const updates = await update(raw);
    await writeHostConfig(ctx, updates);
    const plugin = ctx._notificationHubPlugin;
    if (plugin?.applySettingsUpdates) plugin.applySettingsUpdates(raw, updates);
    else plugin?.applyRuntimeConfigSnapshot?.({ ...raw, ...updates });
    return { ...raw, ...updates };
  });
  updateQueues.set(ctx, next);
  const clear = () => { if (updateQueues.get(ctx) === next) updateQueues.delete(ctx); };
  next.then(clear, clear);
  return next;
}

function plainConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.then === "function") {
    throw new Error("notification-hub config read returned invalid data");
  }
  return value;
}
