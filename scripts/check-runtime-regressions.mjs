import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentResolver } from "../lib/agent-resolver.js";
import NotificationHubPlugin from "../index.js";
import registerWidgetRoutes from "../server/widget-routes.js";
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

  // Host notification events should use the host Windows notification surface only.
  const plugin = new NotificationHubPlugin();
  const records = [];
  const shown = [];
  const hostNotifications = [];
  const warnings = [];
  plugin.ctx = {
    notifications: { async show(payload) { hostNotifications.push(payload); } },
    log: { info() {}, warn(...args) { warnings.push(args); }, error() {} },
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
  await plugin._handleEvent({ type: "notification", title: "原生通知", body: "宿主自行展示", agentId: "hanako", source: "engine", sound: true }, "C:/sessions/one.jsonl");
  assert.equal(hostNotifications.length, 0, "host notification event must not call ctx.notifications.show");
  assert.equal(shown.length, 0, "host notification event must not call customToast.show");
  assert.equal(records.length, 0, "host notification event must not call store.push");
  assert.equal(warnings.length, 0, "ignored host notification event must not log a warning");

  // Private JS/C# contracts: custom sound payload and authenticated configurable TCP manager.
  const toastPayloadSource = fs.readFileSync(path.join(pluginRoot, "helper/Models/ToastPayload.cs"), "utf8");
  const helperSource = ["helper/Program.cs", "helper/ToastProcess.cs", "helper/ToastForm.cs", "helper/Particles/ParticleOverlay.cs"]
    .map((file) => fs.readFileSync(path.join(pluginRoot, file), "utf8"))
    .join("\n");
  const helperProjectSource = fs.readFileSync(path.join(pluginRoot, "helper/NotificationToastHelper.csproj"), "utf8");
  const soundPlayerSource = fs.readFileSync(path.join(pluginRoot, "helper/Sound/NotificationSoundPlayer.cs"), "utf8");
  const customToastSource = fs.readFileSync(path.join(pluginRoot, "lib/custom-toast.js"), "utf8");
  const toastManagerClientSource = fs.readFileSync(path.join(pluginRoot, "lib/toast-manager-client.js"), "utf8");
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
  assert.match(toastManagerClientSource, /async\s+ping\([^)]*\)[\s\S]*expectOp:\s*"pong"/, "JS manager client should require pong handshake");
  assert.match(toastManagerClientSource, /sendCreate\([^)]*\)[\s\S]*expectOp:\s*"shown"/, "JS manager client create command should require shown ack");
  assert.match(toastManagerClientSource, /const\s+cmd\s*=\s*\{\s*\.\.\.command,\s*token:\s*this\._token\s*\}/, "JS manager client should inject token into every TCP command");
  assert.match(toastManagerClientSource, /ack\.op\s*===\s*expectOp/, "JS manager client should validate ack op against expected operation");
  assert.match(customToastSource, /--queue",\s*this\._queueDir/, "JS should hand the manager a file queue because v2 app hosts cannot open TCP");
  assert.match(toastManagerClientSource, /async _pingQueue\(/, "JS manager client should treat ready.json as the handshake");
  assert.match(helperSource, /Application\.SetHighDpiMode\(HighDpiMode\.PerMonitorV2\)/, "C# helper should lock per-monitor DPI instead of inheriting the app host");
  assert.match(helperSource, /StartFileQueue\(/, "C# manager should accept commands from the file queue");
  assert.match(helperSource, /ParticleLayer\.Present\(/, "particle overlay should present a tight layered surface instead of invalidating a virtual-screen window");
  assert.match(helperSource, /ParticleSpriteCache/, "particle shapes should be rasterized once and blitted");
  assert.match(helperSource, /Math\.Min\(1200,/, "particle count cap should stay at 1200");
  assert.match(helperSource, /!payload\.SakuraEnabled/, "turning particle exit off should skip the overlay");
  assert.match(helperSource, /IsExiting \|\| !CardContainsScreen/, "exiting forms must stop accepting hit tests");
  assert.match(helperSource, /toast\.ExitStarted \+=/, "manager must reflow at exit start");
  assert.match(helperSource, /if \(!toast\.IsExiting\) toast\.SetTargetSlot/, "exit animations must not occupy interactive slots");
  assert.match(helperSource, /ParticleOverlayHub\.LayerShown \+= RestackNotificationWindows/, "particle appearance must trigger notification Z-order reflow");
  assert.match(helperSource, /RaiseNotificationWindow\(ParticleOverlayHub\.WindowHandle\)/, "particle layer must be raised before notification cards");
  assert.match(helperSource, /if \(ordered\[i\]\.IsExiting\) RaiseNotificationWindow\(ordered\[i\]\.Handle\)/, "exiting cards must be raised below live cards");
  assert.match(helperSource, /if \(!ordered\[i\]\.IsExiting\) RaiseNotificationWindow\(ordered\[i\]\.Handle\)/, "live cards must finish above exiting cards");
  assert.match(helperSource, /SwpNoSize \| SwpNoMove \| SwpNoActivate \| SwpNoOwnerZOrder/, "Z-order raises must not activate or move notification windows");
  assert.match(helperSource, /MoveWithoutChangingZOrder\(Left, y\)/, "stack animation must preserve its existing Z order");
  assert.match(helperSource, /SwpNoSize \| SwpNoZOrder \| SwpNoActivate/, "position animation must use NOZORDER");
  assert.match(helperSource, /finally \{ BeginExitAnimation\(\); \}/, "particle failure must still begin card close");
  assert.doesNotMatch(helperSource, /ParticleCompositionPresenter|PresentComposition|CreateSwapChainForComposition|CreateTargetForHwnd/, "live helper entrypoints must not reach composition presentation");
  assert.match(helperProjectSource, /Compile Remove="Particles\/ParticleCompositionPresenter.cs"/, "retired composition source must be excluded from the build");
  assert.doesNotMatch(helperSource, /AttachThreadInput|keybd_event|SendInput|SetForegroundWindow/, "helper must not synthesize input or activate the host");
  const widgetSource = fs.readFileSync(path.join(pluginRoot, "ui/widget.html"), "utf8");
  assert.doesNotMatch(widgetSource, /focusConversation|__nhFocusSession|hana\.sessions\.focus|\/api\/sessions\/switch|切回|切不回|跳转|Session focus unavailable/, "notification center must not retain session navigation or navigation copy");
  assert.doesNotMatch(widgetSource, /\.item\.type-conversation\s*\{[^}]*cursor:\s*pointer/, "conversation rows must not look clickable");
  assert.doesNotMatch(widgetSource, /row\.addEventListener\(['"](?:click|keydown)['"]/, "conversation rows must not bind click or keyboard navigation");
  assert.doesNotMatch(helperSource, /shape = effect/, "an old dismiss effect should not replace the particle shape");
  const exitSource = fs.readFileSync(path.join(pluginRoot, "helper/Animations/ToastExitMotion.cs"), "utf8");
  const particleMotionSource = fs.readFileSync(path.join(pluginRoot, "helper/Particles/ParticleMotionRegistry.cs"), "utf8");
  assert.match(helperSource, /ToastExitMotion\.ReverseApproach\(p,/, "card slide and fade should share one exit clock");
  assert.match(helperSource, /var exitMs = 640\.0/, "card exit should finish slide and fade together");
  assert.doesNotMatch(helperSource, /slideMs|fadeMs/, "card exit should not keep a second clock");
  assert.match(exitSource, /ReverseApproach/, "reverse entrance displacement should stay on the card motion");
  assert.doesNotMatch(exitSource, /92 \* p \* p/, "retired card trajectory should not stay beside the reverse exit");
  assert.doesNotMatch(exitSource, /PointF Delta/, "unused card trajectory switch should not stay");
  assert.doesNotMatch(helperSource, /delta\.Y \* amp/, "card exit should not fly on the old upward delta");
  assert.doesNotMatch(helperSource, /static PointF ExitCardDelta/, "card exit formula should not stay inside the toast form");
  assert.doesNotMatch(helperSource, /static class ParticleMotionRegistry/, "particle motion formula should not stay inside the overlay form");
  assert.match(particleMotionSource, /OrbitRadius \+= 0\.72f/, "vortex particle motion should stay on the particle");
  assert.match(particleMotionSource, /Vy \+= 0\.070f/, "gravity particle motion should stay on the particle");
  const presenterSource = fs.readFileSync(path.join(pluginRoot, "helper/Particles/ParticlePresenter.cs"), "utf8");
  assert.match(presenterSource, /UpdateLayeredWindow/, "layered presenter should call UpdateLayeredWindow");
  assert.match(presenterSource, /SmoothingMode\.AntiAlias/, "baked particles should keep anti-aliased edges");

  console.log("runtime regression checks ok");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
