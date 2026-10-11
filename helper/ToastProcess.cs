using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Media;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Timer = System.Windows.Forms.Timer;


namespace NotificationHubToast
{
    class ToastManager : ApplicationContext
    {
        System.Collections.Generic.List<ToastForm> _toasts = new System.Collections.Generic.List<ToastForm>();
        TcpServer _pipeServer;
        Thread _serverThread;
        HiddenForm _invoker;
        string[] _payloadPaths;
        readonly bool _serverMode;
        readonly string _managerToken;
        readonly int _managerPort;
        readonly string _queueDir;
        Timer _queueTimer;
        readonly System.Collections.Generic.HashSet<string> _createdIds = new System.Collections.Generic.HashSet<string>();
        readonly System.Collections.Generic.Queue<string> _createdOrder = new System.Collections.Generic.Queue<string>();

        public ToastManager(string[] payloadPaths) : this(payloadPaths, null, null)
        {
        }

        public ToastManager(string[] payloadPaths, string queueDir, string tokenOverride)
        {
            _payloadPaths = payloadPaths;
            _serverMode = _payloadPaths == null || _payloadPaths.Length == 0;
            var envToken = Environment.GetEnvironmentVariable("NH_TOAST_MANAGER_TOKEN") ?? "";
            _managerToken = !String.IsNullOrEmpty(tokenOverride) ? tokenOverride : envToken;
            _managerPort = TcpServer.ResolvePortFromEnvironment();
            _queueDir = String.IsNullOrWhiteSpace(queueDir) ? null : queueDir;

            // Defer startup until Application.Run message pump is active
            var startupTimer = new Timer();
            startupTimer.Interval = 1;
            startupTimer.Tick += (s, e) => { startupTimer.Stop(); startupTimer.Dispose(); Start(); };
            startupTimer.Start();
        }

        void Start()
        {
            _invoker = new HiddenForm();
            _invoker.Show();
            _invoker.Hide();
            ParticleOverlayHub.LayerShown += RestackNotificationWindows;
            // Warm only the offscreen sprite renderer; no composition/swap-chain probe.
            ParticleOverlayHub.Warm();

            // v2 app hosts cannot open TCP. A queue directory under app-data is the
            // channel that still works. TCP remains for hosts that can use it.
            if (_serverMode && !String.IsNullOrWhiteSpace(_queueDir))
            {
                StartFileQueue();
            }
            else if (_serverMode)
            {
                _pipeServer = new TcpServer(_managerToken, _managerPort);
                _pipeServer.OnCommand = HandlePipeLine;
                _serverThread = new Thread(_pipeServer.Run) { IsBackground = true, Name = "PipeServer" };
                _serverThread.Start();
                if (!_pipeServer.WaitUntilStarted(1500))
                {
                    try { Console.Error.WriteLine("[notification-hub helper] toast manager failed to bind 127.0.0.1:" + _managerPort.ToString(System.Globalization.CultureInfo.InvariantCulture) + ": " + (_pipeServer.StartError ?? "startup timeout")); } catch { }
                    Environment.ExitCode = 32;
                    ExitThread();
                    return;
                }
            }

            foreach (var path in _payloadPaths)
            {
                if (!File.Exists(path)) continue;
                var payload = Payload.Load(path);
                SpawnToast(payload);
            }
            ReindexSlots(0);
            if (!_serverMode && _toasts.Count == 0)
                ExitThread();
        }

        void HandlePipeLine(string json, StreamWriter writer)
        {
            var toastId = Payload.Get(json, "id", Guid.NewGuid().ToString());
            try
            {
                if (_invoker == null || _invoker.IsDisposed)
                {
                    TcpServer.SendError(writer, toastId, "ui invoker unavailable");
                    return;
                }

                // Queue UI work asynchronously — don't block the TCP client thread.
                // WinForms serializes BeginInvoke callbacks on the UI thread,
                // so every toast still receives a stable slot and spring animation.
                _invoker.BeginInvoke(new Action(delegate
                {
                    try
                    {
                        ProcessPipeCommand(json, (ok, op) =>
                        {
                            if (ok) TcpServer.SendAck(writer, toastId, op);
                            else TcpServer.SendError(writer, toastId, op);
                        });
                    }
                    catch (Exception ex) { TcpServer.SendError(writer, toastId, ex.Message); }
                }));
            }
            catch (Exception ex)
            {
                TcpServer.SendError(writer, toastId, "ui queue failed: " + ex.Message);
            }
        }

        void ProcessPipeCommand(string json, Action<bool, string> reply)
        {
            var t = Payload.Get(json, "t", "");
            switch (t)
            {
                case "create": DoCreate(json, reply); break;
                case "close": DoClose(json); reply?.Invoke(true, "closed"); break;
                default: reply?.Invoke(false, "unknown command"); break;
            }
        }

        void DoCreate(string json, Action<bool, string> reply)
        {
            var p = new Payload();
            p.ToastId = Payload.Get(json, "id", Guid.NewGuid().ToString());
            if (!_createdIds.Add(p.ToastId)) { reply?.Invoke(true, "queued"); return; }
            _createdOrder.Enqueue(p.ToastId);
            if (_createdOrder.Count > 4096) _createdIds.Remove(_createdOrder.Dequeue());
            p.Title = Payload.Get(json, "title", "通知");
            p.Body = Payload.Get(json, "body", "");
            p.AgentName = Payload.Get(json, "agentName", "Assistant");
            if (String.IsNullOrWhiteSpace(p.Title))
                p.Title = !String.IsNullOrWhiteSpace(p.AgentName) ? p.AgentName : "通知";
            p.Emoji = Payload.Get(json, "emoji", "🤖");
            p.Type = Payload.Get(json, "type", "channel");
            p.Primary = Payload.Get(json, "primary", "#9b7cff");
            p.Accent = Payload.Get(json, "accent", "#9b7cff");
            p.Importance = Payload.Get(json, "importance", "normal");
            p.Sound = Payload.GetBool(json, "sound", false);
            p.SoundTheme = Payload.Get(json, "soundTheme", "chime");
            p.CustomSoundPath = Payload.Get(json, "customSoundPath", "");
            p.SakuraEnabled = Payload.GetBool(json, "sakuraEnabled", true);
            p.SakuraTheme = Payload.Get(json, "sakuraTheme", "auto");
            p.ParticleCount = Math.Max(0, Math.Min(1200, Payload.GetInt(json, "particleCount", 0)));
            p.ToastLayout = Payload.Get(json, "toastLayout", "clean").ToLowerInvariant();
            p.ToastScale = Math.Max(0.7, Math.Min(1.2, Payload.GetDouble(json, "toastScale", 1.0)));
            p.ToastOffsetX = Math.Max(-1600, Math.Min(1600, Payload.GetInt(json, "toastOffsetX", 0)));
            p.ToastOffsetY = Math.Max(-1000, Math.Min(1000, Payload.GetInt(json, "toastOffsetY", 0)));
            p.ToastStyle = Payload.Get(json, "toastStyle", "classic");
            p.ParticleShape = Payload.Get(json, "particleShape", "sakura");
            p.AutoParticleCountScale = Math.Max(0.2, Math.Min(4.0, Payload.GetDouble(json, "autoParticleCountScale", 1.0)));
            p.ManualParticleCountScale = Math.Max(0.2, Math.Min(4.0, Payload.GetDouble(json, "manualParticleCountScale", 1.0)));
            p.ParticleSizeScale = Math.Max(0.5, Math.Min(3.0, Payload.GetDouble(json, "particleSizeScale", 1.0)));
            p.ParticleIntervalEffect = Math.Max(0, Math.Min(100, Payload.GetInt(json, "particleIntervalEffect", 0)));
            p.EntranceVisual = Payload.Get(json, "entranceVisual", "mist-bloom");
            p.CardExitMode = Payload.NormalizeCardExitMode(Payload.Get(json, "cardExitMode", "trajectory"));
            p.CardExitFade = Payload.GetBool(json, "cardExitFade", true);
            p.AutoDismissMotion = Payload.NormalizeDismissMotion(Payload.Get(json, "autoDismissMotion", "drift"));
            p.ManualDismissMotion = Payload.NormalizeDismissMotion(Payload.Get(json, "manualDismissMotion", "click-burst"));
            p.PhysicsPreset = Payload.Get(json, "physicsPreset", "lively");
            p.DisplayAckPath = Payload.Get(json, "displayAckPath", "");
            p.ClickPath = Payload.Get(json, "clickPath", "");
            p.ControlPath = Payload.Get(json, "controlPath", "");
            p.ActionType = Payload.Get(json, "actionType", "");
            p.ActionTarget = Payload.Get(json, "actionTarget", "");
            SpawnToast(p, reply);
            ReindexSlots(0);
        }

        void DoClose(string json)
        {
            var id = Payload.Get(json, "id", "");
            if (!string.IsNullOrEmpty(id))
            {
                var t = _toasts.Find(x => x.ToastId == id);
                if (t != null) t.Close();
            }
        }

        void SpawnToast(Payload payload, Action<bool, string> reply = null)
        {
            payload.StackIndex = _toasts.FindAll(t => !t.IsExiting).Count;
            var toast = new ToastForm(payload);
            bool replied = false;
            toast.Displayed += (s, e) => { replied = true; reply?.Invoke(true, "shown"); };
            toast.ExitStarted += (s, e) => ReindexSlots(0);
            toast.Closed += (s, e) =>
            {
                if (!replied) reply?.Invoke(false, "toast closed before display");
                ToastExited(toast);
            };
            _toasts.Add(toast);
            try { toast.Show(); RestackNotificationWindows(); }
            catch { _toasts.Remove(toast); toast.Dispose(); throw; }
        }

        void ToastExited(ToastForm toast)
        {
            var idx = _toasts.IndexOf(toast);
            if (idx < 0) return;
            _toasts.RemoveAt(idx);
            try
            {
                if (toast != null && !toast.IsDisposed)
                    toast.Dispose();
            }
            catch { }
            ReindexSlots(0);
            if (!_serverMode && _toasts.Count == 0)
                ExitThread();
        }

        void ReindexSlots(int fromIndex)
        {
            int slot = 0;
            foreach (var toast in _toasts)
                if (!toast.IsExiting) toast.SetTargetSlot(slot++);
            RestackNotificationWindows();
        }

        static readonly IntPtr HwndTop = IntPtr.Zero;
        const uint GwHwndNext = 2;
        const uint SwpNoSize = 0x0001, SwpNoMove = 0x0002, SwpNoActivate = 0x0010, SwpNoOwnerZOrder = 0x0200;
        [DllImport("user32.dll")]
        static extern IntPtr GetTopWindow(IntPtr hwnd);
        [DllImport("user32.dll")]
        static extern IntPtr GetWindow(IntPtr hwnd, uint command);
        [DllImport("user32.dll")]
        static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

        void RestackNotificationWindows()
        {
            var pending = new System.Collections.Generic.Dictionary<IntPtr, ToastForm>();
            foreach (var toast in _toasts)
                if (!toast.IsDisposed && toast.IsHandleCreated) pending[toast.Handle] = toast;

            // Snapshot the actual top-to-bottom order before moving anything. Creation
            // order need not match Z order after a user has interacted with a live card.
            var ordered = new System.Collections.Generic.List<ToastForm>();
            var visited = new System.Collections.Generic.HashSet<IntPtr>();
            for (var hwnd = GetTopWindow(IntPtr.Zero); hwnd != IntPtr.Zero && pending.Count > 0 && visited.Add(hwnd); hwnd = GetWindow(hwnd, GwHwndNext))
            {
                if (!pending.TryGetValue(hwnd, out var toast)) continue;
                ordered.Add(toast);
                pending.Remove(hwnd);
            }

            // All these windows are already TopMost. HWND_TOP keeps them in that band;
            // raise bottom-to-top so live cards finish above exits and particles.
            RaiseNotificationWindow(ParticleOverlayHub.WindowHandle);
            for (int i = ordered.Count - 1; i >= 0; i--)
                if (ordered[i].IsExiting) RaiseNotificationWindow(ordered[i].Handle);
            for (int i = ordered.Count - 1; i >= 0; i--)
                if (!ordered[i].IsExiting) RaiseNotificationWindow(ordered[i].Handle);
        }

        static void RaiseNotificationWindow(IntPtr hwnd)
        {
            if (hwnd != IntPtr.Zero)
                SetWindowPos(hwnd, HwndTop, 0, 0, 0, 0, SwpNoSize | SwpNoMove | SwpNoActivate | SwpNoOwnerZOrder);
        }

        protected override void ExitThreadCore()
        {
            DisposeManagedResources();
            base.ExitThreadCore();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
                DisposeManagedResources();
            base.Dispose(disposing);
        }

        void StartFileQueue()
        {
            Directory.CreateDirectory(_queueDir);
            foreach (var pattern in new string[] { "*.cmd.json", "*.ack.json", "ready.json" })
            {
                string[] stale;
                try { stale = Directory.GetFiles(_queueDir, pattern); }
                catch { continue; }
                foreach (var file in stale)
                {
                    try { File.Delete(file); } catch { }
                }
            }

            _queueTimer = new Timer();
            _queueTimer.Interval = 20;
            _queueTimer.Tick += delegate { DrainFileQueue(); };
            _queueTimer.Start();
            WriteQueueReady();
        }

        void WriteQueueReady()
        {
            try
            {
                var json = "{\"ready\":true,\"token\":\"" + JsonEscapeToken(_managerToken) + "\",\"pid\":" + System.Diagnostics.Process.GetCurrentProcess().Id.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}";
                File.WriteAllText(Path.Combine(_queueDir, "ready.json"), json, new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                try { Console.Error.WriteLine("[notification-hub helper] queue ready write failed: " + ex.Message); } catch { }
            }
        }

        void DrainFileQueue()
        {
            if (String.IsNullOrWhiteSpace(_queueDir) || !Directory.Exists(_queueDir)) return;
            string[] files;
            try { files = Directory.GetFiles(_queueDir, "*.cmd.json"); }
            catch { return; }
            Array.Sort(files, StringComparer.Ordinal);
            foreach (var file in files)
            {
                string json;
                try { json = File.ReadAllText(file, Encoding.UTF8); }
                catch { continue; }
                var token = Payload.Get(json, "token", "");
                if (!String.IsNullOrEmpty(_managerToken) && !String.Equals(token, _managerToken, StringComparison.Ordinal))
                {
                    try { File.Delete(file); } catch { }
                    WriteQueueAck(Payload.Get(json, "id", ""), false, "unauthorized");
                    continue;
                }
                try { File.Delete(file); }
                catch { continue; }
                var id = Payload.Get(json, "id", "");
                try { ProcessPipeCommand(json, (ok, op) => WriteQueueAck(id, ok, op)); }
                catch (Exception ex) { WriteQueueAck(id, false, ex.Message); }
            }
        }

        void WriteQueueAck(string id, bool ok, string op)
        {
            if (String.IsNullOrWhiteSpace(_queueDir) || String.IsNullOrWhiteSpace(id)) return;
            var safe = SanitizeQueueId(id);
            WriteAckFile(Path.Combine(_queueDir, safe + ".ack.json"), id, ok, op);
        }

        internal static void WriteAckFile(string file, string id, bool ok, string op)
        {
            var json = System.Text.Json.JsonSerializer.Serialize(new { ok, op, id });
            var temp = file + ".tmp";
            try
            {
                File.WriteAllText(temp, json, new UTF8Encoding(false));
                File.Move(temp, file, true);
            }
            catch { try { File.Delete(temp); } catch { } }
        }

        static string SanitizeQueueId(string id)
        {
            var chars = (id ?? "cmd").ToCharArray();
            var count = Math.Min(chars.Length, 80);
            var sb = new StringBuilder(count);
            for (var i = 0; i < count; i++)
            {
                var ch = chars[i];
                sb.Append(Char.IsLetterOrDigit(ch) || ch == '_' || ch == '-' ? ch : '_');
            }
            return sb.Length == 0 ? "cmd" : sb.ToString();
        }

        static string JsonEscapeToken(string value)
        {
            if (String.IsNullOrEmpty(value)) return "";
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        void DisposeManagedResources()
        {
            ParticleOverlayHub.LayerShown -= RestackNotificationWindows;
            if (_queueTimer != null)
            {
                try { _queueTimer.Stop(); _queueTimer.Dispose(); } catch { }
                _queueTimer = null;
            }
            if (!String.IsNullOrWhiteSpace(_queueDir))
            {
                try { File.Delete(Path.Combine(_queueDir, "ready.json")); } catch { }
            }
            if (_pipeServer != null)
            {
                _pipeServer.Dispose();
                _pipeServer = null;
            }
            if (_serverThread != null)
            {
                try
                {
                    if (_serverThread.IsAlive) _serverThread.Join(500);
                }
                catch { }
                _serverThread = null;
            }

            if (_toasts != null && _toasts.Count > 0)
            {
                var copy = _toasts.ToArray();
                _toasts.Clear();
                foreach (var toast in copy)
                {
                    try
                    {
                        if (toast != null && !toast.IsDisposed)
                        {
                            toast.Close();
                            toast.Dispose();
                        }
                    }
                    catch { }
                }
            }

            if (_invoker != null)
            {
                try
                {
                    if (!_invoker.IsDisposed)
                    {
                        _invoker.Close();
                        _invoker.Dispose();
                    }
                }
                catch { }
                _invoker = null;
            }
        }
    }

    sealed class HiddenForm : Form
    {
        public HiddenForm()
        {
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Minimized;
            Load += (s, e) => { Visible = false; };
        }
    }

    sealed class TcpServer : IDisposable
    {
        const int DefaultPort = 48105;
        readonly string _token;
        readonly int _port;
        readonly ManualResetEventSlim _started = new ManualResetEventSlim(false);
        System.Net.Sockets.TcpListener _listener;
        volatile bool _stopping = false;
        public Action<string, StreamWriter> OnCommand;
        public string StartError { get; private set; }

        public TcpServer(string token, int port)
        {
            _token = token ?? "";
            _port = port > 0 ? port : DefaultPort;
        }

        public static int ResolvePortFromEnvironment()
        {
            int parsed;
            var raw = Environment.GetEnvironmentVariable("NH_TOAST_MANAGER_PORT");
            if (Int32.TryParse(raw, out parsed) && parsed >= 1024 && parsed <= 65535) return parsed;
            return DefaultPort;
        }

        public bool WaitUntilStarted(int timeoutMs)
        {
            if (!_started.Wait(timeoutMs)) return false;
            return String.IsNullOrWhiteSpace(StartError);
        }

        public void Run()
        {
            try
            {
                _listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, _port);
                _listener.Start();
                _started.Set();
            }
            catch (Exception ex)
            {
                StartError = ex.GetType().Name + ": " + ex.Message;
                try { Console.Error.WriteLine("[notification-hub helper] tcp bind failed 127.0.0.1:" + _port.ToString(System.Globalization.CultureInfo.InvariantCulture) + " " + StartError); } catch { }
                _started.Set();
                return;
            }
            while (!_stopping)
            {
                try
                {
                    var client = _listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(_ => HandleClient(client));
                }
                catch
                {
                    if (_stopping) break;
                    Thread.Sleep(30);
                }
            }
        }

        void HandleClient(System.Net.Sockets.TcpClient client)
        {
            try
            {
                using (client)
                using (var stream = client.GetStream())
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true })
                {
                    string line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        if (String.IsNullOrWhiteSpace(line)) continue;
                        var id = Payload.Get(line, "id", "");
                        var token = Payload.Get(line, "token", "");
                        if (!String.IsNullOrEmpty(_token) && !String.Equals(token, _token, StringComparison.Ordinal))
                        {
                            SendError(writer, id, "unauthorized");
                            continue;
                        }

                        var t = Payload.Get(line, "t", "");
                        if (String.Equals(t, "ping", StringComparison.OrdinalIgnoreCase))
                        {
                            SendAck(writer, id, "pong");
                            continue;
                        }

                        var handler = OnCommand;
                        if (handler != null) handler(line, writer);
                        else SendError(writer, id, "no command handler");
                    }
                }
            }
            catch { }
        }

        public void Dispose()
        {
            _stopping = true;
            OnCommand = null;
            try
            {
                if (_listener != null)
                    _listener.Stop();
            }
            catch { }
            _listener = null;
            try { _started.Dispose(); } catch { }
        }

        public static void SendAck(StreamWriter writer, string id, string op)
        {
            if (writer == null) return;
            try { writer.WriteLine("{ \"t\": \"ack\", \"id\": \"" + JsonEscape(id) + "\", \"op\": \"" + JsonEscape(op) + "\", \"ok\": true }"); } catch { }
        }

        public static void SendError(StreamWriter writer, string id, string error)
        {
            if (writer == null) return;
            try { writer.WriteLine("{ \"t\": \"ack\", \"id\": \"" + JsonEscape(id) + "\", \"op\": \"error\", \"ok\": false, \"error\": \"" + JsonEscape(error) + "\" }"); } catch { }
        }

        static string JsonEscape(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
