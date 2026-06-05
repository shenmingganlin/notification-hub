import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentResolver } from "../lib/agent-resolver.js";
import NotificationHubPlugin from "../index.js";
import registerWidgetRoutes from "../routes/widget.js";
import { execute as listNotifications, parameters as listNotificationParameters } from "../tools/list-notifications.js";

const pluginRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notification-hub-regressions-"));

try {
  // AgentResolver should parse indented agent.name / agent.yuan blocks with inline YAML comments.
  const agentsDir = path.join(tmpRoot, "agents");
  const customAgentDir = path.join(agentsDir, "custom-agent");
  fs.mkdirSync(customAgentDir, { recursive: true });
  fs.writeFileSync(path.join(customAgentDir, "config.yaml"), [
    "# leading comments should be ignored",
    "agent: # inline comment after block key",
    "  name: '小花' # display name comment",
    "  yuan: butter # palette fallback",
    "other:",
    "  name: should-not-leak",
  ].join("\n"), "utf8");
  const resolver = new AgentResolver(agentsDir, { info() {}, warn() {}, error() {} });
  resolver.init();
  const agent = resolver.get("custom-agent");
  assert.equal(agent.displayName, "小花", "AgentResolver should parse indented agent.name from config.yaml");
  assert.equal(agent.yuan, "butter", "AgentResolver should parse indented agent.yuan from config.yaml");
  assert.equal(agent.theme.label, "Butter", "AgentResolver should apply yuan fallback theme for unknown agent ids");

  // Widget clear should be POST-only and require explicit confirmation.
  const routes = new Map();
  const dataDir = path.join(tmpRoot, "widget-data");
  fs.mkdirSync(dataDir, { recursive: true });
  const recordsPath = path.join(dataDir, "notifications.jsonl");
  fs.writeFileSync(recordsPath, JSON.stringify({ id: "one", ts: 1, type: "status", title: "old", body: "record" }) + "\n", "utf8");
  registerWidgetRoutes({
    get(route, handler) { routes.set(`GET ${route}`, handler); },
    post(route, handler) { routes.set(`POST ${route}`, handler); },
  }, {
    pluginId: "notification-hub",
    pluginDir: path.join(tmpRoot, "plugin"),
    dataDir,
    log: { info() {}, warn() {}, error() {} },
    config: { getAll: () => ({}) },
  });
  assert.equal(routes.has("GET /clear"), false, "widget must not expose destructive GET /clear");
  const clearHandler = routes.get("POST /clear");
  assert.equal(typeof clearHandler, "function", "widget should expose POST /clear");
  const deniedClear = await clearHandler({ req: { json: async () => ({}) }, json: (value) => value });
  assert.deepEqual(deniedClear, { ok: false, error: "confirm required" }, "POST /clear should require confirm:true");
  assert.notEqual(fs.readFileSync(recordsPath, "utf8"), "", "unconfirmed clear should keep notification history intact");
  const confirmedClear = await clearHandler({ req: { json: async () => ({ confirm: true }) }, json: (value) => value });
  assert.deepEqual(confirmedClear, { ok: true }, "POST /clear should accept confirm:true");
  assert.equal(fs.readFileSync(recordsPath, "utf8"), "", "confirmed clear should delete notification history");

  // list-notifications should expose and render status records.
  assert.ok(listNotificationParameters.properties.type.enum.includes("status"), "list-notifications type enum should include status");
  const listDataDir = path.join(tmpRoot, "list-data");
  fs.mkdirSync(listDataDir, { recursive: true });
  fs.writeFileSync(path.join(listDataDir, "notifications.jsonl"), [
    JSON.stringify({ id: "conversation", ts: 1, type: "conversation", emoji: "💬", title: "chat", body: "done" }),
    JSON.stringify({ id: "status", ts: 2, type: "status", emoji: "🔔", title: "状态标题", body: "状态正文" }),
  ].join("\n") + "\n", "utf8");
  const listResult = await listNotifications({ type: "status", limit: 5 }, { dataDir: listDataDir, log: { error() {} } });
  assert.match(listResult.content[0].text, /\[状态\]/, "list-notifications should render status type label");
  assert.match(listResult.content[0].text, /状态标题/, "list-notifications should return status records when filtered");
  assert.equal(listResult.details.type, "status", "list-notifications details should preserve status filter");

  // Engine/native notification events should enter normal history + custom toast path as status notifications.
  const plugin = new NotificationHubPlugin();
  const records = [];
  const shown = [];
  plugin.ctx = {
    log: { info() {}, warn() {}, error() {} },
    config: { getAll: () => ({
      notificationDisplayMode: "custom",
      enableStatusNotifications: true,
      enableErrorNotifications: true,
      enableTaskDoneNotifications: true,
      importantNotificationSound: true,
      notificationSoundTheme: "custom",
      customNotificationSoundPath: "C:/tones/status.wav",
      sakuraTheme: "auto",
      toastTransportMode: "managed",
    }) },
    bus: { emit() {} },
  };
  plugin._agentResolver = {
    get(id) {
      return { id, displayName: "Hanako", theme: { emoji: "🌸", primary: "#9b59b6", accent: "#ff9ecf" } };
    },
  };
  plugin._store = {
    push(notification) {
      const record = { recordId: records.length + 1, ...notification };
      records.push(record);
      return record;
    },
  };
  plugin._customToast = { show(notification) { shown.push(notification); }, setTransportMode() {} };
  plugin._channelAggregation = new Map();
  plugin._lastRawConfigSnapshot = undefined;
  plugin._cfg = null;
  plugin._handleEvent({ type: "notification", title: "原生通知", body: "需要进入历史", agentId: "hanako", source: "engine", sound: true }, "C:/sessions/one.jsonl");
  assert.equal(records.length, 1, "engine notification should be recorded through NotificationStore");
  assert.equal(shown.length, 1, "engine notification should use the normal custom toast delivery path");
  assert.strictEqual(shown[0], records[0], "engine notification toast and store record should be the same decorated object");
  assert.equal(records[0].type, "status", "engine notification should be normalized to status type");
  assert.equal(records[0].meta?.originalEventType, "notification", "engine notification should preserve original event type metadata");
  assert.equal(records[0].meta?.source, "engine", "engine notification should preserve source metadata");
  assert.equal(records[0].meta?.sessionPath, "C:/sessions/one.jsonl", "engine notification should preserve session path metadata");
  assert.equal(records[0].customSoundPath, "C:/tones/status.wav", "engine notification should carry status custom sound path when sound is requested");

  // Private JS/C# contracts: custom sound payload and authenticated configurable TCP manager.
  const toastPayloadSource = fs.readFileSync(path.join(pluginRoot, "helper/Models/ToastPayload.cs"), "utf8");
  const helperSource = fs.readFileSync(path.join(pluginRoot, "helper/NotificationToastHelper.cs"), "utf8");
  const helperProjectSource = fs.readFileSync(path.join(pluginRoot, "helper/NotificationToastHelper.csproj"), "utf8");
  const soundPlayerSource = fs.readFileSync(path.join(pluginRoot, "helper/Sound/NotificationSoundPlayer.cs"), "utf8");
  const customToastSource = fs.readFileSync(path.join(pluginRoot, "lib/custom-toast.js"), "utf8");
  assert.match(toastPayloadSource, /public\s+string\s+CustomSoundPath\s*=\s*""\s*;/, "C# file payload model should include CustomSoundPath");
  assert.match(toastPayloadSource, /p\.CustomSoundPath\s*=\s*Get\(raw,\s*"customSoundPath"/, "C# file payload loader should parse customSoundPath");
  assert.match(helperSource, /p\.CustomSoundPath\s*=\s*Payload\.Get\(json,\s*"customSoundPath"/, "C# TCP create path should parse customSoundPath");
  assert.match(helperSource, /Environment\.GetEnvironmentVariable\("NH_TOAST_MANAGER_TOKEN"\)/, "C# manager should read NH_TOAST_MANAGER_TOKEN");
  assert.match(helperSource, /Environment\.GetEnvironmentVariable\("NH_TOAST_MANAGER_PORT"\)/, "C# manager should read NH_TOAST_MANAGER_PORT");
  assert.match(helperSource, /String\.Equals\(token,\s*_token,\s*StringComparison\.Ordinal\)/, "C# TCP server should authenticate manager token exactly");
  assert.match(helperSource, /SendAck\(writer,\s*id,\s*"pong"\)/, "C# TCP server should reply to authenticated ping with pong");
  assert.match(helperProjectSource, /<UseWPF>true<\/UseWPF>/, "C# helper should enable WPF for MediaPlayer fallback");
  assert.match(soundPlayerSource, /type\s+mpegvideo\s+alias/, "C# media playback should try explicit MCI mpegvideo type before fallback");
  assert.match(soundPlayerSource, /TryPlayMediaSoundWithWpf\(path\)/, "C# media playback should fallback to WPF MediaPlayer");
  assert.match(soundPlayerSource, /playing custom media via WPF MediaPlayer/, "C# WPF media fallback should log successful custom playback");
  assert.match(customToastSource, /_managerTokenPath\s*=\s*path\.join\(this\.payloadDir,\s*"manager-token\.txt"\)/, "JS should persist manager token under payload dir");
  assert.match(customToastSource, /_managerPortPath\s*=\s*path\.join\(this\.payloadDir,\s*"manager-port\.txt"\)/, "JS should persist manager port under payload dir");
  assert.match(customToastSource, /NH_TOAST_MANAGER_TOKEN:\s*this\._managerToken/, "JS should pass manager token to helper process");
  assert.match(customToastSource, /NH_TOAST_MANAGER_PORT:\s*String\(this\._managerPort\)/, "JS should pass manager port to helper process");
  assert.match(customToastSource, /async\s+ping\([^)]*\)[\s\S]*expectOp:\s*"pong"/, "JS manager client should require pong handshake");
  assert.match(customToastSource, /sendCreate\([^)]*\)[\s\S]*expectOp:\s*"queued"/, "JS manager client create command should require queued ack");
  assert.match(customToastSource, /const\s+cmd\s*=\s*\{\s*\.\.\.command,\s*token:\s*this\._token\s*\}/, "JS manager client should inject token into every TCP command");
  assert.match(customToastSource, /ack\.op\s*===\s*expectOp/, "JS manager client should validate ack op against expected operation");

  console.log("runtime regression checks ok");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
