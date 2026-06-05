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

        public ToastManager(string[] payloadPaths)
        {
            _payloadPaths = payloadPaths;
            _serverMode = _payloadPaths == null || _payloadPaths.Length == 0;
            _managerToken = Environment.GetEnvironmentVariable("NH_TOAST_MANAGER_TOKEN") ?? "";
            _managerPort = TcpServer.ResolvePortFromEnvironment();

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

            // Manager mode owns the TCP server. File payload mode must not bind the same port.
            if (_serverMode)
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
                _invoker.BeginInvoke((Action<string>)ProcessPipeCommand, json);
                // Ack the exact client connection immediately. This keeps burst sends
                // from queueing behind a single long-lived TCP connection.
                TcpServer.SendAck(writer, toastId, "queued");
            }
            catch (Exception ex)
            {
                TcpServer.SendError(writer, toastId, "ui queue failed: " + ex.Message);
            }
        }

        void ProcessPipeCommand(string json)
        {
            var t = Payload.Get(json, "t", "");
            switch (t)
            {
                case "create": DoCreate(json); break;
                case "close": DoClose(json); break;
            }
        }

        void DoCreate(string json)
        {
            var p = new Payload();
            p.ToastId = Payload.Get(json, "id", Guid.NewGuid().ToString());
            p.Title = Payload.Get(json, "title", "通知");
            p.Body = Payload.Get(json, "body", "");
            p.AgentName = Payload.Get(json, "agentName", "Assistant");
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
            p.ButterflyCount = Math.Max(0, Math.Min(240, Payload.GetInt(json, "butterflyCount", 18)));
            p.ParticleCount = Math.Max(0, Math.Min(1200, Payload.GetInt(json, "particleCount", 0)));
            p.ToastLayout = Payload.Get(json, "toastLayout", "clean").ToLowerInvariant();
            p.ToastScale = Math.Max(0.7, Math.Min(1.2, Payload.GetDouble(json, "toastScale", 1.0)));
            p.ToastOffsetX = Math.Max(-1600, Math.Min(1600, Payload.GetInt(json, "toastOffsetX", 0)));
            p.ToastOffsetY = Math.Max(-1000, Math.Min(1000, Payload.GetInt(json, "toastOffsetY", 0)));
            p.ToastStyle = Payload.Get(json, "toastStyle", "classic");
            p.DismissEffect = Payload.Get(json, "dismissEffect", "fade");
            p.ParticleShape = Payload.Get(json, "particleShape", "sakura");
            p.AutoParticleCountScale = Math.Max(0.2, Math.Min(4.0, Payload.GetDouble(json, "autoParticleCountScale", 1.0)));
            p.ManualParticleCountScale = Math.Max(0.2, Math.Min(4.0, Payload.GetDouble(json, "manualParticleCountScale", 1.0)));
            p.ParticleSizeScale = Math.Max(0.5, Math.Min(3.0, Payload.GetDouble(json, "particleSizeScale", 1.0)));
            p.ParticleIntervalEffect = Math.Max(0, Math.Min(100, Payload.GetInt(json, "particleIntervalEffect", 0)));
            p.EntranceVisual = Payload.Get(json, "entranceVisual", "classic");
            p.AutoDismissMotion = Payload.NormalizeDismissMotion(Payload.Get(json, "autoDismissMotion", "drift"));
            p.ManualDismissMotion = Payload.NormalizeDismissMotion(Payload.Get(json, "manualDismissMotion", "click-burst"));
            p.PhysicsPreset = Payload.Get(json, "physicsPreset", "lively");
            p.ClickPath = Payload.Get(json, "clickPath", "");
            p.ControlPath = Payload.Get(json, "controlPath", "");
            p.ActionType = Payload.Get(json, "actionType", "");
            p.ActionTarget = Payload.Get(json, "actionTarget", "");
            SpawnToast(p);
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

        void SpawnToast(Payload payload)
        {
            var toast = new ToastForm(payload);
            toast.Closed += (s, e) => ToastExited(toast);
            _toasts.Add(toast);
            toast.Show();
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
            ReindexSlots(idx);
            if (!_serverMode && _toasts.Count == 0)
                ExitThread();
        }

        void ReindexSlots(int fromIndex)
        {
            for (int i = fromIndex; i < _toasts.Count; i++)
                _toasts[i].SetTargetSlot(i);
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

        void DisposeManagedResources()
        {
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

    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (args.Length > 0 && args[0] == "--manager")
            {
                // Server mode: TCP server only, no initial toasts
                Application.Run(new ToastManager(new string[0]));
            }
            else if (args.Length > 0)
            {
                // File mode: load toasts from JSON file paths
                Application.Run(new ToastManager(args));
            }
            // No args: do nothing (backward compat)
        }
    }

    sealed class ToastForm : Form
    {
        readonly Payload payload;
        public string ToastId { get { return payload.ToastId; } }
        enum ToastPhase { Entering, Alive, Exiting }

        // Keep WinForms autoscaling disabled for smooth animation, then scale the
        // toast explicitly so it retains the old large visual presence without
        // reintroducing DPI/layout jank.
        const int CardWidth = 500;
        const int CardHeight = 152;
        const int CanvasPadLeft = 180;
        const int CanvasPadTop = 144;
        const int CanvasPadRight = 56;
        const int CanvasPadBottom = 56;

        static readonly Font EmojiFont = new Font("Segoe UI Emoji", 18f);
        static readonly Font MiniEmojiFont = new Font("Segoe UI Emoji", 13.5f);
        static readonly Font TitleFont = new Font("Microsoft YaHei UI", 10.2f, FontStyle.Bold);
        static readonly Font BodyFont = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Regular);
        static readonly Font SmallFont = new Font("Microsoft YaHei UI", 7.4f, FontStyle.Regular);
        static int AutoDismissStaggerCounter = 0;
        static readonly int[] AutoDismissStaggerMs = new int[] { 0, 110, 220, 330, 440, 550, 660, 770, 880, 990, 1100, 1210 };
        static readonly Font NameFont = new Font("Microsoft YaHei UI", 7.8f, FontStyle.Bold);
        static readonly Font TagFont = new Font("Microsoft YaHei UI", 7.2f, FontStyle.Bold);
        static readonly Font CollapsedFont = new Font("Microsoft YaHei UI", 8.4f, FontStyle.Bold);
        static readonly bool ToastPerfEnabled = IsToastPerfEnabled();

        readonly Timer lifeTimer = new Timer();
        readonly Timer animTimer = new Timer();
        readonly Timer stackTimer = new Timer();
        readonly Random rng = new Random();
        ToastPhase phase = ToastPhase.Entering;
        int startX;
        int finalX;
        int tick = 0;
        int bodyScrollOffset = 0;
        int maxBodyScroll = 0;
        Rectangle lastBodyRect = Rectangle.Empty;
        bool mouseInside = false;
        int baseY;
        int targetY;
        double currentY;
        double stackVelocity = 0.0;
        int lastAppliedY = Int32.MinValue;
        Rectangle toastWorkArea = Rectangle.Empty;
        
        Form _dismissOverlay = null;
        string _toastLayout = "clean";
        double _toastScale = 1.0;
        int _toastOffsetX = 0;
        int _toastOffsetY = 0;
        int _designCanvasWidth = CanvasPadLeft + CardWidth + CanvasPadRight;
        int _designCanvasHeight = CanvasPadTop + CardHeight + CanvasPadBottom;
        int _scaledCanvasWidth = CanvasPadLeft + CardWidth + CanvasPadRight;
        int _scaledCanvasHeight = CanvasPadTop + CardHeight + CanvasPadBottom;
        string _toastStyle = "classic";
        string _dismissEffect = "fade";
        string _particleShape = "sakura";
        double _autoParticleCountScale = 1.0;
        double _manualParticleCountScale = 1.0;
        double _particleSizeScale = 1.0;
        int _particleIntervalEffect = 0;
        string _entranceVisual = "classic";
        double _entranceProgress = 0.0;
        string _autoDismissMotion = "drift";
        string _manualDismissMotion = "click-burst";
        string _physicsPreset = "lively";
        double stackSpringStiffness = 0.075;
        double stackDamping = 0.16;
        double stackSettleVelocity = 0.04;
        double stackSettleDistance = 0.35;
        double stackTargetImpulse = 0.10;
        bool stackResetVelocityOnTargetChange = false;
        double enterDurationMs = 300.0;
        double enterOvershoot = 1.70158;
        int exitSlidePx = 5;
        Point lastClickPoint = Point.Empty;
        Bitmap _cardCacheBitmap = null;
        int _perfPaintCount = 0;
        long _perfMaxPaintTicks = 0;
        int _perfAnimTicks = 0;
        int _perfStackTicks = 0;
        long _perfSoundQueueTicks = 0;
        long _perfCardRenderTicks = 0;
        bool _perfReported = false;

        Color ccPrimary, ccAccent, ccBgTop, ccBgBottom, ccBorderColor, ccSoftAccent;
        int ccGlowAlpha, ccSecondGlowAlpha, ccBorderAlpha, ccHighlightAlpha;
        int ccNameBgA1, ccNameBgA2, ccNameBorderA, ccAgentNameA;
        int ccTagBgA, ccTagPenA, ccTagBrushA;
        bool ccIsImportant;
        Rectangle cardRect;

        static class EntranceVisualRegistry
        {
            public static string Normalize(string visual)
            {
                var v = (visual ?? "classic").Trim().ToLowerInvariant();
                switch (v)
                {
                    case "classic":
                    case "fade":
                    case "gather":
                    case "scan":
                    case "stardust":
                    case "prism":
                        return v;
                    default:
                        return "classic";
                }
            }

            public static void Apply(Graphics g, string visual, double progress, Rectangle cardRect, Color primary, Color accent, bool important)
            {
                var p = Clamp01(progress);
                if (p >= 1.0) return;
                var v = Normalize(visual);
                var remain = 1.0 - p;
                var strength = Math.Pow(remain, 0.72);
                var r = 20;

                if (v == "scan")
                {
                    var sweepX = cardRect.Left - 80 + (int)Math.Round((cardRect.Width + 160) * p);
                    using (var clipPath = RoundRect(cardRect, r))
                    {
                        var state = g.Save();
                        g.SetClip(clipPath);
                        g.SmoothingMode = SmoothingMode.None;
                        using (var wash = new SolidBrush(Color.FromArgb((int)Math.Round((important ? 46.0 : 34.0) * strength), Blend(primary, Color.Black, 0.48))))
                            g.FillRectangle(wash, cardRect);
                        for (int y = cardRect.Top + 5, row = 0; y < cardRect.Bottom - 4; y += 7, row++)
                        {
                            var local = ((row % 4) - 1) * 9;
                            var sliceW = Math.Max(8, Math.Min(cardRect.Width, sweepX + local - cardRect.Left));
                            if (sliceW <= 0) continue;
                            var c = row % 2 == 0 ? Blend(primary, Color.White, 0.48) : Blend(accent, Color.White, 0.38);
                            using (var slice = new SolidBrush(Color.FromArgb((int)Math.Round((important ? 42.0 : 30.0) * strength), c)))
                                g.FillRectangle(slice, cardRect.Left, y, sliceW, row % 3 == 0 ? 3 : 2);
                        }
                        using (var lead = new Pen(Color.FromArgb((int)Math.Round((important ? 230.0 : 190.0) * strength), Blend(Color.White, accent, 0.18)), important ? 2.6f : 2.0f))
                        using (var tail = new Pen(Color.FromArgb((int)Math.Round((important ? 120.0 : 92.0) * strength), primary), 1.0f))
                        {
                            lead.StartCap = LineCap.Round;
                            lead.EndCap = LineCap.Round;
                            g.DrawLine(lead, sweepX, cardRect.Top + 4, sweepX + 28, cardRect.Bottom - 4);
                            g.DrawLine(tail, sweepX - 22, cardRect.Top + 12, sweepX + 6, cardRect.Bottom - 12);
                        }
                        g.Restore(state);
                    }
                    return;
                }

                if (v == "stardust")
                {
                    var dots = new double[,] {
                        {-0.08,0.18,0.16,0.20,0.00}, {1.08,0.12,0.78,0.18,0.07}, {0.10,-0.14,0.24,0.34,0.14}, {0.92,-0.10,0.66,0.30,0.21},
                        {-0.10,0.76,0.20,0.70,0.05}, {1.12,0.82,0.82,0.70,0.12}, {0.34,1.12,0.36,0.82,0.19}, {0.70,1.10,0.64,0.78,0.26},
                        {0.50,-0.16,0.50,0.24,0.32}, {-0.12,0.48,0.28,0.48,0.39}, {1.12,0.46,0.74,0.50,0.46}, {0.18,1.14,0.30,0.66,0.53},
                        {0.86,1.14,0.74,0.62,0.60}, {0.02,0.02,0.40,0.36,0.67}, {0.98,0.98,0.60,0.64,0.74}, {0.48,0.50,0.50,0.50,0.20}
                    };
                    using (var clipPath = RoundRect(cardRect, r))
                    {
                        var state = g.Save();
                        g.SetClip(clipPath);
                        for (int i = 0; i < dots.GetLength(0); i++)
                        {
                            var start = dots[i, 4] * 0.28;
                            var t = EaseOutCubic(Clamp01((p - start) / 0.72));
                            var sx = cardRect.Left + dots[i, 0] * cardRect.Width;
                            var sy = cardRect.Top + dots[i, 1] * cardRect.Height;
                            var ex = cardRect.Left + dots[i, 2] * cardRect.Width;
                            var ey = cardRect.Top + dots[i, 3] * cardRect.Height;
                            var x = sx + (ex - sx) * t;
                            var y = sy + (ey - sy) * t;
                            var pulse = 0.74 + 0.26 * Math.Sin((p * 8.0 + i) * Math.PI);
                            var alpha = (int)Math.Round((important ? 220.0 : 180.0) * strength * pulse);
                            if (alpha <= 4) continue;
                            var size = (float)(2.0 + (i % 4) * 0.7 + 2.2 * (1.0 - t));
                            var c = i % 3 == 0 ? Blend(primary, Color.White, 0.62) : (i % 3 == 1 ? Blend(accent, Color.White, 0.52) : Color.FromArgb(255, 238, 188));
                            using (var dot = new SolidBrush(Color.FromArgb(Math.Min(235, alpha), c)))
                            using (var glint = new Pen(Color.FromArgb(Math.Min(225, alpha), Blend(Color.White, c, 0.18)), 1.0f))
                            {
                                g.FillRectangle(dot, (float)x - size / 2f, (float)y - size / 2f, size, size);
                                if (size > 3.0f)
                                {
                                    g.DrawLine(glint, (float)x - size, (float)y, (float)x + size, (float)y);
                                    g.DrawLine(glint, (float)x, (float)y - size, (float)x, (float)y + size);
                                }
                            }
                        }
                        g.Restore(state);
                    }
                    return;
                }

                if (v == "prism")
                {
                    using (var clipPath = RoundRect(cardRect, r))
                    {
                        var state = g.Save();
                        g.SetClip(clipPath);
                        var spectrum = new Color[] {
                            Color.FromArgb(102, 232, 255),
                            Color.FromArgb(255, 122, 224),
                            Color.FromArgb(255, 232, 132),
                            Color.FromArgb(134, 176, 255)
                        };
                        var alpha = (int)Math.Round((important ? 170.0 : 130.0) * strength);
                        for (int i = 0; i < spectrum.Length; i++)
                        {
                            var shift = (int)Math.Round((p * 96.0) + i * 13.0);
                            using (var pen = new Pen(Color.FromArgb(Math.Min(210, alpha), Blend(spectrum[i], i % 2 == 0 ? primary : accent, 0.22)), 1.25f))
                            {
                                pen.StartCap = LineCap.Round;
                                pen.EndCap = LineCap.Round;
                                g.DrawLine(pen, cardRect.Left - 40 + shift, cardRect.Bottom - 3, cardRect.Left + 54 + shift, cardRect.Top + 3);
                                g.DrawLine(pen, cardRect.Right - 132 + shift, cardRect.Bottom - 4, cardRect.Right - 34 + shift, cardRect.Top + 4);
                            }
                        }
                        using (var tri = new GraphicsPath())
                        {
                            tri.AddPolygon(new PointF[] {
                                new PointF(cardRect.Right - 96, cardRect.Top + 8),
                                new PointF(cardRect.Right - 18, cardRect.Top + 20),
                                new PointF(cardRect.Right - 74, cardRect.Top + 52)
                            });
                            using (var fill = new SolidBrush(Color.FromArgb((int)Math.Round(46.0 * strength), Blend(Color.White, accent, 0.18))))
                                g.FillPath(fill, tri);
                        }
                        using (var tri = new GraphicsPath())
                        {
                            tri.AddPolygon(new PointF[] {
                                new PointF(cardRect.Left + 22, cardRect.Bottom - 12),
                                new PointF(cardRect.Left + 94, cardRect.Bottom - 28),
                                new PointF(cardRect.Left + 42, cardRect.Bottom - 54)
                            });
                            using (var fill = new SolidBrush(Color.FromArgb((int)Math.Round(36.0 * strength), Blend(Color.White, primary, 0.22))))
                                g.FillPath(fill, tri);
                        }
                        using (var edge = new Pen(Color.FromArgb((int)Math.Round((important ? 190.0 : 150.0) * strength), Blend(Color.White, primary, 0.24)), 1.2f))
                            g.DrawLine(edge, cardRect.Left + 16, cardRect.Top + 11, cardRect.Right - 18, cardRect.Top + 25);
                        g.Restore(state);
                    }
                    return;
                }

                if (v == "fade")
                {
                    var washAlpha = (int)Math.Round((important ? 110.0 : 88.0) * strength);
                    var lineAlpha = (int)Math.Round((important ? 190.0 : 150.0) * strength);
                    var sweepX = cardRect.Left - 92 + (int)Math.Round((cardRect.Width + 184) * p);
                    using (var path = RoundRect(cardRect, r))
                    using (var wash = new SolidBrush(Color.FromArgb(Math.Min(150, washAlpha), Blend(Color.White, primary, 0.16))))
                    {
                        g.FillPath(wash, path);
                    }
                    using (var pen = new Pen(Color.FromArgb(Math.Min(220, lineAlpha), Blend(Color.White, accent, 0.18)), 2.8f))
                    {
                        g.DrawLine(pen, sweepX, cardRect.Top + 7, sweepX + 54, cardRect.Bottom - 7);
                    }
                    return;
                }

                if (v == "gather")
                {
                    var cx = cardRect.Left + cardRect.Width / 2.0;
                    var cy = cardRect.Top + cardRect.Height / 2.0;
                    var segs = new double[,] {
                        {0.50,0.50,0.18,0.20}, {0.50,0.50,0.78,0.18}, {0.50,0.50,0.20,0.80}, {0.50,0.50,0.82,0.78},
                        {0.32,0.42,0.18,0.55}, {0.32,0.42,0.42,0.18}, {0.66,0.38,0.84,0.52}, {0.66,0.38,0.56,0.16},
                        {0.40,0.66,0.24,0.84}, {0.40,0.66,0.58,0.86}, {0.62,0.62,0.84,0.76}, {0.62,0.62,0.70,0.34}
                    };
                    using (var clipPath = RoundRect(cardRect, r))
                    {
                        var state = g.Save();
                        g.SetClip(clipPath);
                        for (int i = 0; i < segs.GetLength(0); i++)
                        {
                            var x1 = cardRect.Left + segs[i, 0] * cardRect.Width;
                            var y1 = cardRect.Top + segs[i, 1] * cardRect.Height;
                            var x2 = cardRect.Left + segs[i, 2] * cardRect.Width;
                            var y2 = cardRect.Top + segs[i, 3] * cardRect.Height;
                            var mx = (x1 + x2) / 2.0;
                            var my = (y1 + y2) / 2.0;
                            var dist = Math.Sqrt(Math.Pow((mx - cx) / Math.Max(1.0, cardRect.Width / 2.0), 2.0) + Math.Pow((my - cy) / Math.Max(1.0, cardRect.Height / 2.0), 2.0));
                            dist = Math.Max(0.0, Math.Min(1.0, dist));
                            var healStart = (1.0 - dist) * 0.62;
                            var visible = Math.Max(0.0, Math.Min(1.0, (1.0 - p - healStart) / Math.Max(0.16, 1.0 - healStart)));
                            if (visible <= 0.02) continue;
                            var alpha = (int)Math.Round((important ? 225.0 : 188.0) * Math.Pow(visible, 0.84));
                            var width = (float)(0.65 + 2.10 * visible);
                            var c = i % 2 == 0 ? Blend(primary, Color.White, 0.42) : Blend(accent, Color.White, 0.38);
                            using (var pen = new Pen(Color.FromArgb(Math.Min(235, alpha), c), width))
                            {
                                pen.StartCap = LineCap.Round;
                                pen.EndCap = LineCap.Round;
                                g.DrawLine(pen, (float)x1, (float)y1, (float)x2, (float)y2);
                            }
                        }
                        g.Restore(state);
                    }
                    return;
                }

                // Classic glow: draw only inside/on the opaque card, never outside the transparency-key surface.
                var glowAlpha = (int)Math.Round((important ? 96.0 : 76.0) * strength);
                var ringAlpha = (int)Math.Round((important ? 230.0 : 190.0) * strength);
                using (var path = RoundRect(cardRect, r))
                {
                    var state = g.Save();
                    g.SetClip(path);
                    using (var glow = new SolidBrush(Color.FromArgb(Math.Min(118, glowAlpha), Blend(primary, accent, 0.42))))
                        g.FillEllipse(glow, cardRect.Left + 12, cardRect.Top + 8, cardRect.Width - 24, cardRect.Height - 16);
                    g.Restore(state);
                }
                using (var path = RoundRect(Rectangle.Inflate(cardRect, -1, -1), r))
                using (var pen = new Pen(Color.FromArgb(Math.Min(235, ringAlpha), Blend(accent, Color.White, 0.32)), 2.0f))
                {
                    g.DrawPath(pen, path);
                }
            }

            static double Clamp01(double t)
            {
                return Math.Max(0.0, Math.Min(1.0, t));
            }

            static double EaseOutCubic(double t)
            {
                t = Clamp01(t);
                return 1.0 - Math.Pow(1.0 - t, 3.0);
            }
        }

        public ToastForm(Payload payload)
        {
            this.payload = payload;
            _toastScale = Math.Max(0.7, Math.Min(1.2, payload.ToastScale));
            _toastOffsetX = Math.Max(-1600, Math.Min(1600, payload.ToastOffsetX));
            _toastOffsetY = Math.Max(-1000, Math.Min(1000, payload.ToastOffsetY));
            _designCanvasWidth = CanvasPadLeft + CardWidth + CanvasPadRight;
            _designCanvasHeight = CanvasPadTop + CardHeight + CanvasPadBottom;
            _scaledCanvasWidth = Math.Max(1, (int)Math.Round(_designCanvasWidth * _toastScale));
            _scaledCanvasHeight = Math.Max(1, (int)Math.Round(_designCanvasHeight * _toastScale));
            cardRect = new Rectangle(CanvasPadLeft + 8, CanvasPadTop + 8, CardWidth - 16, CardHeight - 16);
            ccPrimary = ParseColor(payload.Primary, Color.FromArgb(155, 124, 255));
            ccAccent = ParseColor(payload.Accent, ccPrimary);
            ccBgTop = Blend(Color.FromArgb(22, 24, 52), ccPrimary, 0.34);
            ccBgBottom = Blend(Color.FromArgb(14, 18, 38), ccAccent, 0.24);
            ccBorderColor = Blend(Color.FromArgb(96, 255, 255, 255), ccPrimary, 0.38);
            ccSoftAccent = Blend(ccPrimary, ccAccent, 0.42);
            ccIsImportant = payload.Importance == "important" || payload.Importance == "urgent";
            ccGlowAlpha = ccIsImportant ? 122 : 88;
            ccSecondGlowAlpha = ccIsImportant ? 62 : 42;
            ccBorderAlpha = ccIsImportant ? 185 : 120;
            ccHighlightAlpha = ccIsImportant ? 150 : 95;
            ccNameBgA1 = 132;
            ccNameBgA2 = 112;
            ccNameBorderA = 128;
            ccAgentNameA = 245;
            ccTagBgA = 36;
            ccTagPenA = 28;
            ccTagBrushA = ccIsImportant ? 230 : 178;

            AutoScaleMode = AutoScaleMode.None;
            toastWorkArea = ResolveToastWorkingArea();
            var work = toastWorkArea;
            var canvasWidth = _scaledCanvasWidth;
            var canvasHeight = _scaledCanvasHeight;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(canvasWidth, canvasHeight);
            MinimumSize = Size.Empty;
            MaximumSize = Size.Empty;
            // Avoid magenta transparency-key bleeding on anti-aliased rounded edges.
            var transparentKey = Color.FromArgb(1, 2, 3);
            BackColor = transparentKey;
            TransparencyKey = transparentKey;
            DoubleBuffered = true;
            Opacity = 0;

            // Let user offsets move the toast freely, including beyond the screen working area.
            finalX = work.Right - canvasWidth - 44 + _toastOffsetX;
            startX = finalX + (int)Math.Round(34 * _toastScale);
            baseY = work.Bottom - canvasHeight - 8 + _toastOffsetY;
            targetY = ComputeStackY(payload.StackIndex);
            currentY = targetY;
            Bounds = new Rectangle(startX, targetY, canvasWidth, canvasHeight);
            _toastLayout = NormalizeToastLayout(payload.ToastLayout);
            _toastStyle = payload.ToastStyle;
            _dismissEffect = payload.DismissEffect;
            _particleShape = payload.ParticleShape;
            _autoParticleCountScale = Math.Max(0.2, Math.Min(4.0, payload.AutoParticleCountScale));
            _manualParticleCountScale = Math.Max(0.2, Math.Min(4.0, payload.ManualParticleCountScale));
            _particleSizeScale = Math.Max(0.5, Math.Min(3.0, payload.ParticleSizeScale));
            _particleIntervalEffect = Math.Max(0, Math.Min(100, payload.ParticleIntervalEffect));
            _entranceVisual = EntranceVisualRegistry.Normalize(payload.EntranceVisual);
            _entranceProgress = 0.0;
            _autoDismissMotion = Payload.NormalizeDismissMotion(payload.AutoDismissMotion);
            _manualDismissMotion = Payload.NormalizeDismissMotion(payload.ManualDismissMotion);
            _physicsPreset = payload.PhysicsPreset;
            ApplyPhysicsPreset(_physicsPreset);

            var staggerIndex = Math.Abs(System.Threading.Interlocked.Increment(ref AutoDismissStaggerCounter)) % AutoDismissStaggerMs.Length;
            lifeTimer.Interval = 5200 + AutoDismissStaggerMs[staggerIndex];
            lifeTimer.Tick += delegate { StartExit(false); };

            animTimer.Interval = 15;
            animTimer.Tick += Animate;

            stackTimer.Interval = 16;
            stackTimer.Tick += delegate { UpdateStackMotion(); };

            MouseWheel += delegate(object sender, MouseEventArgs e) { ScrollBody(e.Delta); };
        }

        protected override void OnMouseClick(MouseEventArgs e)
        {
            base.OnMouseClick(e);
            if (e.Button != MouseButtons.Left) return;
            lastClickPoint = e.Location;
            WriteClickEvent();
            StartExit(true);
        }

        void WriteClickEvent()
        {
            try
            {
                if (String.IsNullOrWhiteSpace(payload.ClickPath)) return;
                var dir = Path.GetDirectoryName(payload.ClickPath);
                if (!String.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
                var json = "{"
                    + "\"toastId\":\"" + EscapeJson(payload.ToastId) + "\","
                    + "\"clickedAt\":\"" + EscapeJson(DateTime.UtcNow.ToString("o")) + "\","
                    + "\"type\":\"" + EscapeJson(payload.Type) + "\","
                    + "\"title\":\"" + EscapeJson(payload.Title) + "\","
                    + "\"agentName\":\"" + EscapeJson(payload.AgentName) + "\","
                    + "\"source\":\"" + EscapeJson(payload.Source) + "\","
                    + "\"actionType\":\"" + EscapeJson(payload.ActionType) + "\","
                    + "\"actionTarget\":\"" + EscapeJson(payload.ActionTarget) + "\""
                    + "}";
                File.WriteAllText(payload.ClickPath, json, new System.Text.UTF8Encoding(false));
            }
            catch { }
        }

        static string EscapeJson(string value)
        {
            if (String.IsNullOrEmpty(value)) return "";
            return value.Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n")
                .Replace("\t", "\\t");
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            lifeTimer.Stop();
            animTimer.Stop();
            stackTimer.Stop();
            DisposeDismissOverlay();
            ReportPerfDiagnostics("closed");
            base.OnFormClosed(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                lifeTimer.Stop();
                animTimer.Stop();
                stackTimer.Stop();
                lifeTimer.Dispose();
                animTimer.Dispose();
                stackTimer.Dispose();
                DisposeCardCache();
                DisposeDismissOverlay();
                ReportPerfDiagnostics("dispose");
            }
            base.Dispose(disposing);
        }

        void DisposeDismissOverlay()
        {
            var overlay = _dismissOverlay;
            _dismissOverlay = null;
            if (overlay == null) return;
            try
            {
                if (!overlay.IsDisposed)
                {
                    overlay.Close();
                    overlay.Dispose();
                }
            }
            catch { }
        }

        void DisposeCardCache()
        {
            var bitmap = _cardCacheBitmap;
            _cardCacheBitmap = null;
            if (bitmap == null) return;
            try { bitmap.Dispose(); } catch { }
        }

        static bool IsToastPerfEnabled()
        {
            try
            {
                var value = Environment.GetEnvironmentVariable("NH_TOAST_PERF");
                if (String.IsNullOrWhiteSpace(value)) return false;
                value = value.Trim();
                return value == "1"
                    || value.Equals("true", StringComparison.OrdinalIgnoreCase)
                    || value.Equals("yes", StringComparison.OrdinalIgnoreCase)
                    || value.Equals("on", StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        static double PerfTicksToMs(long ticks)
        {
            if (ticks <= 0) return 0.0;
            return ticks * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
        }

        void ReportPerfDiagnostics(string reason)
        {
            if (!ToastPerfEnabled || _perfReported) return;
            _perfReported = true;
            var line = "[NH_TOAST_PERF] toastId=" + payload.ToastId
                + " reason=" + reason
                + " style=" + (_toastStyle ?? "classic")
                + " entrance=" + (_entranceVisual ?? "classic")
                + " paints=" + _perfPaintCount.ToString(System.Globalization.CultureInfo.InvariantCulture)
                + " maxPaintMs=" + PerfTicksToMs(_perfMaxPaintTicks).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)
                + " cardRenderMs=" + PerfTicksToMs(_perfCardRenderTicks).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)
                + " animTicks=" + _perfAnimTicks.ToString(System.Globalization.CultureInfo.InvariantCulture)
                + " stackTicks=" + _perfStackTicks.ToString(System.Globalization.CultureInfo.InvariantCulture)
                + " soundQueueMs=" + PerfTicksToMs(_perfSoundQueueTicks).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
            try { Console.Error.WriteLine(line); } catch { }
            try
            {
                var perfFile = Environment.GetEnvironmentVariable("NH_TOAST_PERF_FILE");
                if (String.IsNullOrWhiteSpace(perfFile)) return;
                perfFile = Environment.ExpandEnvironmentVariables(perfFile.Trim().Trim('"'));
                var dir = Path.GetDirectoryName(perfFile);
                if (!String.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
                File.AppendAllText(
                    perfFile,
                    DateTime.Now.ToString("o", System.Globalization.CultureInfo.InvariantCulture) + " " + line + Environment.NewLine,
                    Encoding.UTF8);
            }
            catch { }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_EX_NOACTIVATE = 0x08000000;
                const int WS_EX_TOOLWINDOW = 0x00000080;
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
                return cp;
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            var canvasWidth = _scaledCanvasWidth;
            var canvasHeight = _scaledCanvasHeight;
            if (ClientSize.Width != canvasWidth || ClientSize.Height != canvasHeight)
                ClientSize = new Size(canvasWidth, canvasHeight);
            currentY = targetY;
            Bounds = new Rectangle(startX, targetY, canvasWidth, canvasHeight);
            if (!IsStackSettled()) EnsureStackTimerRunning();
            animTimer.Start();
            lifeTimer.Start();
            if (payload.Sound)
            {
                var soundQueueStart = ToastPerfEnabled ? System.Diagnostics.Stopwatch.GetTimestamp() : 0;
                NotificationSoundPlayer.Queue(payload.SoundTheme, payload.CustomSoundPath);
                if (ToastPerfEnabled && soundQueueStart > 0)
                    _perfSoundQueueTicks = System.Diagnostics.Stopwatch.GetTimestamp() - soundQueueStart;
            }
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            base.OnMouseEnter(e);
            mouseInside = true;
            PauseLifetime();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            mouseInside = false;
            ResumeLifetime();
        }

        protected override void WndProc(ref Message m)
        {
            const int WM_MOUSEWHEEL = 0x020A;
            if (m.Msg == WM_MOUSEWHEEL)
            {
                int delta = (short)((m.WParam.ToInt64() >> 16) & 0xffff);
                if (ScrollBody(delta)) return;
            }
            base.WndProc(ref m);
        }

        void PauseLifetime()
        {
            if (phase != ToastPhase.Exiting) lifeTimer.Stop();
        }

        void ResumeLifetime()
        {
            if (!mouseInside && phase != ToastPhase.Exiting && !lifeTimer.Enabled)
                lifeTimer.Start();
        }

        Rectangle ResolveToastWorkingArea()
        {
            try
            {
                var screen = Screen.FromPoint(Cursor.Position);
                if (screen != null) return screen.WorkingArea;
            }
            catch { }
            try
            {
                var screen = Screen.PrimaryScreen;
                if (screen != null) return screen.WorkingArea;
            }
            catch { }
            return SystemInformation.WorkingArea;
        }

        int ComputeStackY(int index)
        {
            var scaledGap = Math.Max(0, (int)Math.Round(payload.StackGap * _toastScale));
            var visualCardHeight = Math.Max(1, (int)Math.Round(cardRect.Height * _toastScale));
            return baseY - Math.Max(0, index) * (visualCardHeight + scaledGap);
        }

        public void SetTargetSlot(int slot)
        {
            var oldTargetY = targetY;
            var nextTargetY = ComputeStackY(slot);
            targetY = nextTargetY;

            var targetJump = nextTargetY - oldTargetY;
            if (stackResetVelocityOnTargetChange)
            {
                // Servo-like preset: discard inertia and glide directly to the new slot.
                stackVelocity = 0.0;
                if (!IsStackSettled()) EnsureStackTimerRunning();
                return;
            }

            // Keep inertia. A real spring does not lose all velocity when the target changes.
            // Add a small impulse toward the new target so stack reflow visibly overshoots.
            if (Math.Abs(targetJump) > 0.1)
                stackVelocity += targetJump * stackTargetImpulse;

            if (!IsStackSettled()) EnsureStackTimerRunning();
        }

        void ApplyPhysicsPreset(string preset)
        {
            var p = (preset ?? "lively").ToLowerInvariant();
            if (p == "soft")
            {
                stackSpringStiffness = 0.045;
                stackDamping = 0.22;
                stackSettleVelocity = 0.030;
                stackSettleDistance = 0.28;
                stackTargetImpulse = 0.045;
                stackResetVelocityOnTargetChange = false;
                enterDurationMs = 360.0;
                enterOvershoot = 1.55;
                exitSlidePx = 4;
            }
            else if (p == "snappy")
            {
                // Servo/PID-like: quick, clean, almost no visible overshoot.
                stackSpringStiffness = 0.115;
                stackDamping = 0.69;
                stackSettleVelocity = 0.028;
                stackSettleDistance = 0.24;
                stackTargetImpulse = 0.0;
                stackResetVelocityOnTargetChange = true;
                enterDurationMs = 240.0;
                enterOvershoot = 1.42;
                exitSlidePx = 6;
            }
            else if (p == "wild")
            {
                stackSpringStiffness = 0.145;
                stackDamping = 0.055;
                stackSettleVelocity = 0.090;
                stackSettleDistance = 0.80;
                stackTargetImpulse = 0.30;
                stackResetVelocityOnTargetChange = false;
                enterDurationMs = 275.0;
                enterOvershoot = 2.75;
                exitSlidePx = 11;
            }
            else
            {
                stackSpringStiffness = 0.075;
                stackDamping = 0.16;
                stackSettleVelocity = 0.045;
                stackSettleDistance = 0.38;
                stackTargetImpulse = 0.10;
                stackResetVelocityOnTargetChange = false;
                enterDurationMs = 300.0;
                enterOvershoot = 1.90;
                exitSlidePx = 5;
            }
        }

        bool IsStackSettled()
        {
            return Math.Abs(stackVelocity) < stackSettleVelocity
                && Math.Abs(targetY - currentY) < stackSettleDistance;
        }

        void EnsureStackTimerRunning()
        {
            if (!stackTimer.Enabled) stackTimer.Start();
        }

        void UpdateStackMotion()
        {
            if (ToastPerfEnabled) _perfStackTicks++;
            var delta = targetY - currentY;
            var acceleration = delta * stackSpringStiffness - stackVelocity * stackDamping;
            stackVelocity += acceleration;
            if (Math.Abs(stackVelocity) < stackSettleVelocity && Math.Abs(delta) < stackSettleDistance)
            {
                currentY = targetY;
                stackVelocity = 0.0;
            }
            else
            {
                currentY += stackVelocity;
            }
            ApplyWindowY((int)Math.Round(currentY));
            if (IsStackSettled()) stackTimer.Stop();
        }

        void ApplyWindowY(int y)
        {
            if (y == lastAppliedY) return;
            lastAppliedY = y;
            Top = y;
        }

        bool ScrollBody(int delta)
        {
            if (maxBodyScroll <= 0) return false;
            PauseLifetime();
            int step = Math.Max(18, Math.Min(54, Math.Abs(delta) / 4));
            if (step <= 0) step = 30;
            int next = bodyScrollOffset - Math.Sign(delta) * step;
            next = Math.Max(0, Math.Min(maxBodyScroll, next));
            if (next == bodyScrollOffset) return true;
            bodyScrollOffset = next;
            // Full repaint avoids transparent-window partial invalidation artifacts.
            DisposeCardCache();
            Invalidate();
            return true;
        }

        void StartExit(bool clicked)
        {
            if (phase == ToastPhase.Exiting) return;
            phase = ToastPhase.Exiting;
            tick = 0;
            lifeTimer.Stop();

            // Determine shape and motion
            var shape = (_particleShape ?? "sakura").ToLowerInvariant();
            var effect = _dismissEffect ?? "fade";
            // Backward compat: if user hasn't set particleShape, map old dismissEffect
            if (effect == "fade" && !payload.SakuraEnabled)
            {
                // No overlay for plain fade
                animTimer.Start();
                return;
            }
            if (effect != "fade" && effect != "sakura" && _particleShape == "sakura")
                shape = effect; // map old dismissEffect -> particleShape

            if (shape == "none")
            {
                // No particle overlay; keep the normal toast fade only.
                animTimer.Start();
                return;
            }

            var motion = Payload.NormalizeDismissMotion(clicked ? (_manualDismissMotion ?? "click-burst") : (_autoDismissMotion ?? "drift"));
            var clickOriginMode = clicked && motion == "click-burst";

            // Convert toast-local card/click origin to screen coordinates for the full-screen overlay.
            var sourceRect = new Rectangle(
                Left + (int)Math.Round(cardRect.Left * _toastScale),
                Top + (int)Math.Round(cardRect.Top * _toastScale),
                Math.Max(1, (int)Math.Round(cardRect.Width * _toastScale)),
                Math.Max(1, (int)Math.Round(cardRect.Height * _toastScale)));
            var origin = clickOriginMode && lastClickPoint != Point.Empty
                ? new Point(Left + lastClickPoint.X, Top + lastClickPoint.Y)
                : new Point(sourceRect.Left + sourceRect.Width / 2, sourceRect.Top + sourceRect.Height / 2);
            var dirX = clickOriginMode ? (float)((origin.X - (sourceRect.Left + sourceRect.Width / 2.0)) / Math.Max(1.0, sourceRect.Width / 2.0)) : 1.0f;
            var dirY = clickOriginMode ? (float)((origin.Y - (sourceRect.Top + sourceRect.Height / 2.0)) / Math.Max(1.0, sourceRect.Height / 2.0)) : 0.0f;
            var len = Math.Sqrt(dirX * dirX + dirY * dirY);
            if (len < 0.20) { dirX = 0.85f; dirY = -0.35f; len = Math.Sqrt(dirX * dirX + dirY * dirY); }
            dirX = (float)(dirX / len);
            dirY = (float)(dirY / len);
            var countScale = clicked ? _manualParticleCountScale : _autoParticleCountScale;

            ParticleOverlayHub.Emit(shape, motion, clicked,
                GetParticlePalette(payload.Importance, payload.AgentName, payload.SakuraTheme, shape, payload.Primary, payload.Accent), sourceRect, origin, dirX, dirY, clickOriginMode, payload.ParticleCount, countScale, _particleSizeScale * _toastScale, _particleIntervalEffect);
            animTimer.Start();
        }

        Color[] GetParticlePalette(string importance, string agentName, string sakuraTheme, string shape, string primaryHex, string accentHex)
        {
            var primary = ParseColor(primaryHex, Color.FromArgb(155, 124, 255));
            var accent = ParseColor(accentHex, primary);
            var soft = Blend(primary, accent, 0.50);
            var hot = Blend(primary, Color.White, 0.28);
            var glow = Blend(accent, Color.White, 0.34);
            var deep = Blend(Blend(primary, accent, 0.35), Color.FromArgb(20, 22, 48), 0.18);

            // Theme-derived palette: every dismiss particle now smells like the toast it came from.
            // A tiny importance lift keeps alerts punchy without overriding the user's selected colorway.
            if ((importance ?? "").ToLowerInvariant() == "urgent" || (importance ?? "").ToLowerInvariant() == "important")
            {
                var warning = Color.FromArgb(255, 205, 92);
                return new Color[]
                {
                    hot,
                    glow,
                    Blend(primary, warning, 0.22),
                    Blend(accent, warning, 0.18),
                    soft,
                    deep,
                    Color.White,
                };
            }

            return new Color[]
            {
                hot,
                glow,
                primary,
                accent,
                soft,
                Blend(primary, Color.White, 0.52),
                Blend(accent, Color.White, 0.48),
                deep,
            };
        }

        void Animate(object sender, EventArgs e)
        {
            if (ToastPerfEnabled) _perfAnimTicks++;
            tick++;
            if (phase == ToastPhase.Entering)
            {
                var p = Math.Min(1.0, tick * animTimer.Interval / enterDurationMs);
                _entranceProgress = p;
                var travel = startX - finalX;
                var xEase = EaseOutBack(p, enterOvershoot);
                var opacity = Math.Min(1.0, p * 1.55);

                Opacity = opacity;
                Left = finalX + (int)Math.Round(travel * (1.0 - xEase));
                Top = (int)Math.Round(currentY);
                if (p >= 1.0)
                {
                    _entranceProgress = 1.0;
                    Opacity = 1;
                    Left = finalX;
                    Top = targetY;
                    phase = ToastPhase.Alive;
                    animTimer.Stop();
                }
                Invalidate();
                return;
            }

            if (phase == ToastPhase.Exiting)
            {
                var p = Math.Min(1.0, tick * animTimer.Interval / 1250.0);
                var eased = EaseOutCubic(p);
        
                // Keep the toast body visible long enough for the exit motion to read.
                // The particle overlay is only an accent; it must not steal the physical feel.
                var toastFade = Math.Min(1.0, p / 0.72);
                Opacity = Math.Max(0.0, 1.0 - EaseOutCubic(toastFade));
                Left = finalX + (int)Math.Round(exitSlidePx * eased);
                Top = (int)Math.Round(currentY);

                // Overlay is full-screen; no location sync needed.
                Invalidate();

                if (p >= 1.0)
                {
                    DisposeDismissOverlay();
                    animTimer.Stop();
                    stackTimer.Stop();
                    Close();
                }
            }
        }

        static double EaseOutCubic(double t)
        {
            t = Math.Max(0, Math.Min(1, t));
            return 1 - Math.Pow(1 - t, 3);
        }

        static double EaseOutBack(double t, double overshoot)
        {
            t = Math.Max(0, Math.Min(1, t));
            var c1 = overshoot;
            var c3 = c1 + 1;
            return 1 + c3 * Math.Pow(t - 1, 3) + c1 * Math.Pow(t - 1, 2);
        }


        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var paintStart = ToastPerfEnabled ? System.Diagnostics.Stopwatch.GetTimestamp() : 0;
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            var cardCache = EnsureCardCache();
            if (cardCache != null)
            {
                g.DrawImageUnscaled(cardCache, 0, 0);
            }
            else
            {
                var fallbackState = g.Save();
                g.ScaleTransform((float)_toastScale, (float)_toastScale);
                RenderStaticCard(g);
                g.Restore(fallbackState);
            }

            // Foreground entrance layer remains dynamic; the cached layer only holds the static card body.
            var entranceState = g.Save();
            g.ScaleTransform((float)_toastScale, (float)_toastScale);
            EntranceVisualRegistry.Apply(g, _entranceVisual, _entranceProgress, cardRect, ccPrimary, ccAccent, ccIsImportant);
            g.Restore(entranceState);

            if (ToastPerfEnabled && paintStart > 0)
            {
                var elapsed = System.Diagnostics.Stopwatch.GetTimestamp() - paintStart;
                _perfPaintCount++;
                if (elapsed > _perfMaxPaintTicks) _perfMaxPaintTicks = elapsed;
            }
        }

        Bitmap EnsureCardCache()
        {
            if (_cardCacheBitmap != null) return _cardCacheBitmap;

            var renderStart = ToastPerfEnabled ? System.Diagnostics.Stopwatch.GetTimestamp() : 0;
            Bitmap bitmap = null;
            Graphics cacheGraphics = null;
            try
            {
                bitmap = new Bitmap(Width, Height, PixelFormat.Format32bppPArgb);
                cacheGraphics = Graphics.FromImage(bitmap);
                cacheGraphics.Clear(BackColor);
                cacheGraphics.SmoothingMode = SmoothingMode.AntiAlias;
                cacheGraphics.ScaleTransform((float)_toastScale, (float)_toastScale);
                RenderStaticCard(cacheGraphics);
                _cardCacheBitmap = bitmap;
                bitmap = null;
                return _cardCacheBitmap;
            }
            catch
            {
                if (bitmap != null) bitmap.Dispose();
                return null;
            }
            finally
            {
                if (cacheGraphics != null) cacheGraphics.Dispose();
                if (ToastPerfEnabled && renderStart > 0)
                    _perfCardRenderTicks += System.Diagnostics.Stopwatch.GetTimestamp() - renderStart;
            }
        }

        void RenderStaticCard(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var style = (_toastStyle ?? "classic").ToLowerInvariant();

            // ── Common: shadow ──
            if (style != "minimal")
            {
                using (var shadow = new SolidBrush(Color.FromArgb(ccIsImportant ? 22 : 16, 0, 0, 0)))
                using (var pathShadow = RoundRect(new Rectangle(cardRect.X + 1, cardRect.Y + 2, cardRect.Width, cardRect.Height), 20))
                    g.FillPath(shadow, pathShadow);
            }

            // ── Style-specific card body ──
            int r = (style == "tech" || style == "obsidian") ? 12 : (style == "hologram" ? 16 : 20);
            using (var path = RoundRect(cardRect, r))
            {
                if (style == "minimal")
                {
                    // Clean white/light surface, subtle border
                    using (var bg = new SolidBrush(Color.FromArgb(245, ccBgTop)))
                    using (var border = new Pen(Color.FromArgb(ccBorderAlpha / 3, ccBorderColor), 1f))
                    {
                        g.FillPath(bg, path);
                        g.DrawPath(border, path);
                        using (var accentBrush = new SolidBrush(Color.FromArgb(200, ccPrimary)))
                        using (var accentPath = RoundRect(new Rectangle(cardRect.X + 2, cardRect.Y + 2, 4, cardRect.Height - 4), 4))
                            g.FillPath(accentBrush, accentPath);
                    }
                }
                else if (style == "tech")
                {
                    // Dark bg, bright neon border
                    using (var bg = new SolidBrush(Color.FromArgb(248, Color.FromArgb(10, 12, 30))))
                    using (var border = new Pen(Color.FromArgb(ccBorderAlpha + 30, ccPrimary), ccIsImportant ? 1.8f : 1.2f))
                    {
                        g.FillPath(bg, path);
                        g.DrawPath(border, path);
                        // Corner accent glows
                        var state = g.Save();
                        g.SetClip(path);
                        using (var glow = new SolidBrush(Color.FromArgb(42, ccPrimary)))
                        {
                            g.FillEllipse(glow, cardRect.Right - 100, cardRect.Top - 80, 160, 140);
                            g.FillEllipse(glow, cardRect.Left - 60, cardRect.Bottom - 60, 140, 120);
                        }
                        g.Restore(state);
                    }
                }
                else if (style == "glass")
                {
                    // Semi-transparent frosted look
                    using (var bg = new SolidBrush(Color.FromArgb(200, Color.FromArgb(18, 20, 45))))
                    using (var border = new Pen(Color.FromArgb(100, 255, 255, 255), 1f))
                    {
                        g.FillPath(bg, path);
                        g.DrawPath(border, path);
                        var state = g.Save();
                        g.SetClip(path);
                        using (var sheen = new SolidBrush(Color.FromArgb(16, 255, 255, 255)))
                            g.FillEllipse(sheen, cardRect.Left - 30, cardRect.Top - 20, cardRect.Width + 60, cardRect.Height / 2);
                        g.Restore(state);
                    }
                }
                else if (style == "aurora")
                {
                    // Aurora lattice: dark crystal base, diagonal light ribbons, fine pixel grid.
                    var auroraTop = Blend(Color.FromArgb(7, 16, 36), ccPrimary, 0.22);
                    var auroraBottom = Blend(Color.FromArgb(4, 32, 42), ccAccent, 0.30);
                    using (var bg = new LinearGradientBrush(cardRect, Color.FromArgb(246, auroraTop), Color.FromArgb(238, auroraBottom), 28f))
                    using (var border = new Pen(Color.FromArgb(ccBorderAlpha + 24 > 230 ? 230 : ccBorderAlpha + 24, Blend(Color.White, ccPrimary, 0.34)), ccIsImportant ? 1.7f : 1.1f))
                    {
                        g.FillPath(bg, path);
                        var state = g.Save();
                        g.SetClip(path);
                        using (var band1 = new Pen(Color.FromArgb(ccIsImportant ? 82 : 58, Blend(Color.FromArgb(92, 255, 206), ccPrimary, 0.26)), 8.0f))
                        using (var band2 = new Pen(Color.FromArgb(ccIsImportant ? 70 : 48, Blend(Color.FromArgb(164, 116, 255), ccAccent, 0.24)), 6.0f))
                        using (var band3 = new Pen(Color.FromArgb(ccIsImportant ? 54 : 38, Color.FromArgb(255, 216, 122)), 3.0f))
                        {
                            band1.StartCap = LineCap.Round;
                            band1.EndCap = LineCap.Round;
                            band2.StartCap = LineCap.Round;
                            band2.EndCap = LineCap.Round;
                            band3.StartCap = LineCap.Round;
                            band3.EndCap = LineCap.Round;
                            g.DrawLine(band1, cardRect.Left - 20, cardRect.Bottom - 20, cardRect.Right - 56, cardRect.Top + 8);
                            g.DrawLine(band2, cardRect.Left + 48, cardRect.Bottom + 8, cardRect.Right + 10, cardRect.Top + 26);
                            g.DrawLine(band3, cardRect.Left + 8, cardRect.Top + 20, cardRect.Right - 22, cardRect.Bottom - 10);
                        }
                        var oldMode = g.SmoothingMode;
                        g.SmoothingMode = SmoothingMode.None;
                        using (var gridPen = new Pen(Color.FromArgb(ccIsImportant ? 34 : 24, Blend(Color.White, ccAccent, 0.25)), 1f))
                        {
                            for (int x = cardRect.Left + 12; x < cardRect.Right; x += 18)
                                g.DrawLine(gridPen, x, cardRect.Top + 4, x + 22, cardRect.Bottom - 4);
                            for (int y = cardRect.Top + 8; y < cardRect.Bottom; y += 14)
                                g.DrawLine(gridPen, cardRect.Left + 4, y, cardRect.Right - 4, y - 18);
                        }
                        g.SmoothingMode = oldMode;
                        using (var corner = new Pen(Color.FromArgb(ccIsImportant ? 170 : 132, Blend(Color.White, ccPrimary, 0.18)), 1.4f))
                        using (var hot = new SolidBrush(Color.FromArgb(ccIsImportant ? 72 : 48, Blend(Color.White, ccAccent, 0.22))))
                        {
                            corner.StartCap = LineCap.Round;
                            corner.EndCap = LineCap.Round;
                            g.DrawLine(corner, cardRect.Left + 16, cardRect.Top + 10, cardRect.Left + 70, cardRect.Top + 10);
                            g.DrawLine(corner, cardRect.Left + 16, cardRect.Top + 10, cardRect.Left + 16, cardRect.Top + 44);
                            g.DrawLine(corner, cardRect.Right - 74, cardRect.Bottom - 10, cardRect.Right - 18, cardRect.Bottom - 10);
                            g.DrawLine(corner, cardRect.Right - 18, cardRect.Bottom - 44, cardRect.Right - 18, cardRect.Bottom - 10);
                            g.FillEllipse(hot, cardRect.Right - 118, cardRect.Top - 52, 156, 104);
                        }
                        g.Restore(state);
                        g.DrawPath(border, path);
                    }
                }
                else if (style == "sakura-storm")
                {
                    DrawSakuraStormCard(g, cardRect, path, ccPrimary, ccAccent, ccIsImportant, ccBorderAlpha);
                }
                else if (style == "obsidian")
                {
                    DrawObsidianCard(g, cardRect, path, ccPrimary, ccAccent, ccIsImportant, ccBorderAlpha);
                }
                else if (style == "hologram")
                {
                    DrawHologramCard(g, cardRect, path, ccPrimary, ccAccent, ccIsImportant, ccBorderAlpha);
                }
                else if (style == "paper")
                {
                    DrawPaperCard(g, cardRect, path, ccPrimary, ccAccent, ccIsImportant, ccBorderAlpha);
                }
                else // classic
                {
                    using (var bg = new LinearGradientBrush(cardRect, Color.FromArgb(242, ccBgTop), Color.FromArgb(232, ccBgBottom), 35f))
                    using (var border = new Pen(Color.FromArgb(ccBorderAlpha, ccBorderColor), ccIsImportant ? 1.6f : 1f))
                    {
                        g.FillPath(bg, path);
                        var state = g.Save();
                        g.SetClip(path);
                        using (var glow = new SolidBrush(Color.FromArgb(ccGlowAlpha, ccPrimary)))
                            g.FillEllipse(glow, _designCanvasWidth - 182, -74, 220, 205);
                        using (var glow2 = new SolidBrush(Color.FromArgb(ccSecondGlowAlpha, ccAccent)))
                            g.FillEllipse(glow2, -70, _designCanvasHeight - 90, 198, 132);
                        using (var highlightPath = RoundRect(new Rectangle(cardRect.X + 10, cardRect.Bottom - 18, cardRect.Width - 20, ccIsImportant ? 7 : 5), 6))
                        using (var highlight = new LinearGradientBrush(new Rectangle(cardRect.X + 10, cardRect.Bottom - 18, cardRect.Width - 20, ccIsImportant ? 7 : 5), Color.FromArgb(ccHighlightAlpha, ccSoftAccent), Color.FromArgb(0, ccSoftAccent), 0f))
                            g.FillPath(highlight, highlightPath);
                        using (var accentBrush = new LinearGradientBrush(new Rectangle(cardRect.X, cardRect.Y, 5, cardRect.Height), Color.FromArgb(255, ccPrimary), Color.FromArgb(220, ccAccent), 90f))
                        using (var accentPath = RoundRect(new Rectangle(cardRect.X, cardRect.Y, 5, cardRect.Height), 18))
                            g.FillPath(accentBrush, accentPath);
                        g.Restore(state);
                        g.DrawPath(border, path);
                    }
                }
            }

            RenderCardContent(g, style);

        }

        void RenderCardContent(Graphics g, string style)
        {
            var layout = NormalizeToastLayout(_toastLayout);
            var titleColor = style == "paper" ? Color.FromArgb(84, 58, 52) : ((style == "tech" || style == "obsidian") ? Color.FromArgb(236, 226, 190) : Color.FromArgb(247, 248, 255));
            var bodyColor = style == "paper" ? Color.FromArgb(146, 104, 96) : ((style == "tech" || style == "obsidian") ? Color.FromArgb(190, 202, 214) : Color.FromArgb(184, 247, 248, 255));
            var metaColor = style == "paper" ? Color.FromArgb(128, 100, 94) : Color.FromArgb(150, 228, 234, 244);
            var tag = ccIsImportant ? "\u91CD\u8981" : (payload.Type == "channel" ? "\u9891\u9053" : (payload.Type == "status" ? "\u72B6\u6001" : "\u5BF9\u8BDD"));

            if (layout == "hero")
            {
                var avatarRect = new Rectangle(cardRect.X + 18, cardRect.Y + 20, 42, 42);
                var tagRect = new Rectangle(cardRect.Right - 72, cardRect.Y + 14, 54, 22);
                var textX = avatarRect.Right + 14;
                DrawAvatar(g, style, avatarRect, 15);
                DrawTypeTag(g, style, tag, tagRect);
                DrawNamePill(g, style, new Rectangle(textX, cardRect.Y + 16, Math.Max(130, tagRect.Left - textX - 12), 22));
                DrawText(g, payload.Title, TitleFont, titleColor, new Rectangle(textX, cardRect.Y + 43, cardRect.Right - textX - 22, 24));
                DrawScrollableBody(g, payload.Body, BodyFont, bodyColor, new Rectangle(textX, cardRect.Y + 69, cardRect.Right - textX - 24, cardRect.Bottom - cardRect.Y - 88), ccSoftAccent);
                DrawMatchedKeywords(g, style, new Rectangle(textX, cardRect.Bottom - 24, cardRect.Right - textX - 22, 18));
                return;
            }

            if (layout == "clean")
            {
                var tagRect = new Rectangle(cardRect.Right - 72, cardRect.Y + 14, 54, 22);
                var iconRect = new Rectangle(cardRect.X + 18, cardRect.Y + 15, 24, 24);
                using (var iconBrush = new SolidBrush(Color.FromArgb(230, 255, 255, 255)))
                    DrawCentered(g, payload.Emoji, MiniEmojiFont, iconBrush, iconRect);
                DrawTypeTag(g, style, tag, tagRect);
                var textX = cardRect.X + 48;
                DrawText(g, payload.Title, TitleFont, titleColor, new Rectangle(textX, cardRect.Y + 14, tagRect.Left - textX - 10, 24));
                DrawScrollableBody(g, payload.Body, BodyFont, bodyColor, new Rectangle(cardRect.X + 20, cardRect.Y + 44, cardRect.Width - 40, 54), ccSoftAccent);
                DrawNamePill(g, style, new Rectangle(cardRect.X + 20, cardRect.Bottom - 31, 154, 22));
                DrawSourceText(g, payload.Source, SmallFont, metaColor, new Rectangle(cardRect.X + 188, cardRect.Bottom - 28, cardRect.Width - 210, 18));
                DrawMatchedKeywords(g, style, new Rectangle(cardRect.X + 188, cardRect.Bottom - 28, cardRect.Width - 210, 18));
                return;
            }

            if (layout == "headline")
            {
                var tagRect = new Rectangle(cardRect.Right - 72, cardRect.Y + 16, 54, 22);
                DrawTypeTag(g, style, tag, tagRect);
                using (var bar = new SolidBrush(Color.FromArgb(210, ccPrimary)))
                    g.FillRectangle(bar, cardRect.X + 20, cardRect.Y + 18, 4, 52);
                using (var iconBrush = new SolidBrush(Color.FromArgb(225, 255, 255, 255)))
                    DrawCentered(g, payload.Emoji, MiniEmojiFont, iconBrush, new Rectangle(cardRect.X + 30, cardRect.Y + 15, 24, 24));
                DrawText(g, payload.Title, TitleFont, titleColor, new Rectangle(cardRect.X + 62, cardRect.Y + 14, tagRect.Left - cardRect.X - 74, 25));
                DrawScrollableBody(g, payload.Body, BodyFont, bodyColor, new Rectangle(cardRect.X + 62, cardRect.Y + 43, cardRect.Width - 86, 52), ccSoftAccent);
                DrawNamePill(g, style, new Rectangle(cardRect.X + 62, cardRect.Bottom - 31, 146, 22));
                DrawSourceText(g, payload.Source, SmallFont, metaColor, new Rectangle(cardRect.X + 220, cardRect.Bottom - 28, cardRect.Width - 242, 18));
                DrawMatchedKeywords(g, style, new Rectangle(cardRect.X + 220, cardRect.Bottom - 28, cardRect.Width - 242, 18));
                return;
            }

            if (layout == "dialogue")
            {
                var avatarRect = new Rectangle(cardRect.X + 18, cardRect.Y + 18, 34, 34);
                var tagRect = new Rectangle(cardRect.Right - 72, cardRect.Y + 14, 54, 22);
                DrawAvatar(g, style, avatarRect, 13);
                DrawNamePill(g, style, new Rectangle(avatarRect.Right + 12, cardRect.Y + 16, Math.Max(136, tagRect.Left - avatarRect.Right - 24), 22));
                DrawTypeTag(g, style, tag, tagRect);
                DrawText(g, payload.Title, TitleFont, titleColor, new Rectangle(cardRect.X + 20, cardRect.Y + 56, cardRect.Width - 40, 24));
                using (var quoteBg = new SolidBrush(Color.FromArgb(style == "paper" ? 34 : 24, 255, 255, 255)))
                using (var quotePath = RoundRect(new Rectangle(cardRect.X + 18, cardRect.Y + 82, cardRect.Width - 36, 34), 12))
                    g.FillPath(quoteBg, quotePath);
                DrawScrollableBody(g, payload.Body, BodyFont, bodyColor, new Rectangle(cardRect.X + 28, cardRect.Y + 87, cardRect.Width - 56, 28), ccSoftAccent);
                DrawMatchedKeywords(g, style, new Rectangle(cardRect.X + 28, cardRect.Bottom - 24, cardRect.Width - 56, 18));
                return;
            }

            if (layout == "timeline")
            {
                var tagRect = new Rectangle(cardRect.Right - 72, cardRect.Y + 14, 54, 22);
                var lineX = cardRect.X + 32;
                using (var linePen = new Pen(Color.FromArgb(150, ccSoftAccent), 2.0f))
                    g.DrawLine(linePen, lineX, cardRect.Y + 22, lineX, cardRect.Bottom - 26);
                using (var dot = new SolidBrush(Color.FromArgb(235, ccPrimary)))
                    g.FillEllipse(dot, lineX - 5, cardRect.Y + 22, 10, 10);
                using (var dot2 = new SolidBrush(Color.FromArgb(185, ccAccent)))
                    g.FillEllipse(dot2, lineX - 4, cardRect.Bottom - 35, 8, 8);
                DrawTypeTag(g, style, tag, tagRect);
                var textX = cardRect.X + 52;
                DrawText(g, payload.Title, TitleFont, titleColor, new Rectangle(textX, cardRect.Y + 14, tagRect.Left - textX - 10, 24));
                DrawScrollableBody(g, payload.Body, BodyFont, bodyColor, new Rectangle(textX, cardRect.Y + 44, cardRect.Right - textX - 24, 54), ccSoftAccent);
                DrawNamePill(g, style, new Rectangle(textX, cardRect.Bottom - 31, 150, 22));
                DrawSourceText(g, payload.Source, SmallFont, metaColor, new Rectangle(textX + 162, cardRect.Bottom - 28, cardRect.Right - textX - 184, 18));
                DrawMatchedKeywords(g, style, new Rectangle(textX + 162, cardRect.Bottom - 28, cardRect.Right - textX - 184, 18));
                return;
            }
        }

        static string NormalizeToastLayout(string layout)
        {
            var v = (layout ?? "clean").Trim().ToLowerInvariant();
            if (v == "hero" || v == "clean" || v == "headline" || v == "dialogue" || v == "timeline") return v;
            return "clean";
        }

        void DrawAvatar(Graphics g, string style, Rectangle avatarRect, int radius)
        {
            var avatarR = (style == "tech" || style == "obsidian") ? Math.Max(7, radius - 4) : radius;
            using (var avatarPath = RoundRect(avatarRect, avatarR))
            using (var avatarBg = new LinearGradientBrush(avatarRect, Color.FromArgb(style == "minimal" ? 170 : 218, ccPrimary), Color.FromArgb(style == "minimal" ? 145 : 196, ccAccent), 35f))
            using (var avatarPen = new Pen(Color.FromArgb(style == "minimal" ? 20 : 72, 255, 255, 255), 1))
            {
                g.FillPath(avatarBg, avatarPath);
                if (style != "minimal") g.DrawPath(avatarPen, avatarPath);
            }
            using (var emojiBrush = new SolidBrush(Color.White))
                DrawCentered(g, payload.Emoji, EmojiFont, emojiBrush, avatarRect);
        }

        void DrawNamePill(Graphics g, string style, Rectangle nameRect)
        {
            var nameBg1 = Color.FromArgb(ccNameBgA1, Blend(ccPrimary, Color.White, 0.18));
            var nameBg2 = Color.FromArgb(ccNameBgA2, Blend(ccAccent, Color.White, 0.12));
            using (var namePath = RoundRect(nameRect, 10))
            using (var nameBg = new LinearGradientBrush(nameRect, nameBg1, nameBg2, 0f))
            using (var nameBorder = new Pen(Color.FromArgb(ccNameBorderA, Blend(ccPrimary, Color.White, 0.42)), 1))
            {
                g.FillPath(nameBg, namePath);
                if (style != "minimal") g.DrawPath(nameBorder, namePath);
            }
            using (var agentNameBrush = new SolidBrush(Color.FromArgb(ccAgentNameA, 255, 255, 255)))
                DrawCentered(g, payload.AgentName, NameFont, agentNameBrush, nameRect);
        }

        void DrawTypeTag(Graphics g, string style, string tag, Rectangle tagRect)
        {
            using (var tagPath = RoundRect(tagRect, 10))
            using (var tagBg = new SolidBrush(Color.FromArgb(ccTagBgA, 255, 255, 255)))
            using (var tagPen = new Pen(Color.FromArgb(ccTagPenA, 255, 255, 255)))
            {
                g.FillPath(tagBg, tagPath);
                if (style != "minimal") g.DrawPath(tagPen, tagPath);
            }
            using (var tagBrush = new SolidBrush(Color.FromArgb(ccTagBrushA, 255, 255, 255)))
                DrawCentered(g, tag, TagFont, tagBrush, tagRect);
        }

        static void DrawSourceText(Graphics g, string source, Font font, Color color, Rectangle rect)
        {
            if (String.IsNullOrWhiteSpace(source)) return;
            var text = source.Trim();
            if (text.Length > 42) text = "…" + text.Substring(text.Length - 41);
            DrawText(g, text, font, color, rect);
        }

        void DrawMatchedKeywords(Graphics g, string style, Rectangle rect)
        {
            if (!ccIsImportant || String.IsNullOrWhiteSpace(payload.MatchedKeywords)) return;
            var kwColor = style == "tech" ? Color.FromArgb(156, 150, 200, 255) : Color.FromArgb(156, 255, 244, 210);
            DrawText(g, "\u547D\u4E2D: " + payload.MatchedKeywords, SmallFont, kwColor, rect);
        }

        static void DrawSakuraStormCard(Graphics g, Rectangle rect, GraphicsPath path, Color primary, Color accent, bool important, int borderAlpha)
        {
            var top = Blend(Color.FromArgb(48, 12, 42), primary, 0.45);
            var bottom = Blend(Color.FromArgb(80, 18, 58), accent, 0.38);
            using (var bg = new LinearGradientBrush(rect, Color.FromArgb(246, top), Color.FromArgb(238, bottom), 18f))
            using (var border = new Pen(Color.FromArgb(Math.Min(238, borderAlpha + 42), Blend(Color.White, primary, 0.36)), important ? 1.9f : 1.25f))
            {
                g.FillPath(bg, path);
                var state = g.Save();
                g.SetClip(path);
                using (var bloom = new SolidBrush(Color.FromArgb(important ? 74 : 52, Blend(Color.White, primary, 0.28))))
                using (var blush = new SolidBrush(Color.FromArgb(important ? 64 : 42, Blend(Color.FromArgb(255, 164, 206), accent, 0.24))))
                using (var petal = new SolidBrush(Color.FromArgb(important ? 160 : 126, Blend(Color.White, primary, 0.38))))
                using (var streak = new Pen(Color.FromArgb(important ? 112 : 78, Blend(Color.White, accent, 0.28)), 2.0f))
                {
                    g.FillEllipse(bloom, rect.Left - 44, rect.Top - 42, 174, 110);
                    g.FillEllipse(blush, rect.Right - 168, rect.Bottom - 88, 218, 128);
                    streak.StartCap = LineCap.Round;
                    streak.EndCap = LineCap.Round;
                    g.DrawBezier(streak, rect.Left + 52, rect.Bottom - 22, rect.Left + 132, rect.Top + 4, rect.Right - 96, rect.Bottom - 10, rect.Right - 24, rect.Top + 22);
                    for (int i = 0; i < 14; i++)
                    {
                        var x = rect.Left + 18 + (i * 37) % (rect.Width - 28);
                        var y = rect.Top + 10 + (i * 23) % (rect.Height - 18);
                        var s = g.Save();
                        g.TranslateTransform(x, y);
                        g.RotateTransform(-28 + i * 17);
                        g.FillEllipse(petal, -2.5f, -6.2f, 5.0f, 12.4f);
                        g.Restore(s);
                    }
                }
                using (var edge = new Pen(Color.FromArgb(important ? 150 : 112, Blend(Color.White, primary, 0.46)), 1.2f))
                {
                    edge.StartCap = LineCap.Round;
                    edge.EndCap = LineCap.Round;
                    g.DrawLine(edge, rect.Left + 18, rect.Top + 12, rect.Left + 116, rect.Top + 12);
                    g.DrawLine(edge, rect.Right - 126, rect.Bottom - 12, rect.Right - 20, rect.Bottom - 12);
                }
                g.Restore(state);
                g.DrawPath(border, path);
            }
        }

        static void DrawObsidianCard(Graphics g, Rectangle rect, GraphicsPath path, Color primary, Color accent, bool important, int borderAlpha)
        {
            var gold = Blend(Color.FromArgb(245, 194, 90), primary, 0.28);
            using (var bg = new LinearGradientBrush(rect, Color.FromArgb(250, 8, 9, 13), Color.FromArgb(244, 23, 20, 18), 42f))
            using (var border = new Pen(Color.FromArgb(Math.Min(245, borderAlpha + 62), gold), important ? 2.0f : 1.35f))
            {
                g.FillPath(bg, path);
                var state = g.Save();
                g.SetClip(path);
                using (var glow = new SolidBrush(Color.FromArgb(important ? 62 : 42, gold)))
                using (var gearPen = new Pen(Color.FromArgb(important ? 116 : 86, gold), 1.0f))
                using (var linePen = new Pen(Color.FromArgb(important ? 92 : 66, Blend(Color.White, gold, 0.16)), 1.1f))
                using (var toothBrush = new SolidBrush(gold))
                {
                    g.FillEllipse(glow, rect.Right - 130, rect.Top - 72, 184, 136);
                    for (int i = 0; i < 6; i++)
                    {
                        var x = rect.Left + 20 + i * 55;
                        g.DrawLine(linePen, x, rect.Top + 8, x + 26, rect.Bottom - 10);
                    }
                    g.DrawEllipse(gearPen, rect.Right - 74, rect.Bottom - 66, 48, 48);
                    g.DrawEllipse(gearPen, rect.Right - 60, rect.Bottom - 52, 20, 20);
                    for (int i = 0; i < 10; i++)
                    {
                        var a = i * Math.PI * 2.0 / 10.0;
                        var cx = rect.Right - 50 + (float)Math.Cos(a) * 30f;
                        var cy = rect.Bottom - 42 + (float)Math.Sin(a) * 30f;
                        g.FillRectangle(toothBrush, cx - 2f, cy - 2f, 4f, 4f);
                    }
                }
                using (var accentBar = new LinearGradientBrush(new Rectangle(rect.Left, rect.Top, 6, rect.Height), Color.FromArgb(255, gold), Color.FromArgb(190, accent), 90f))
                using (var accentPath = RoundRect(new Rectangle(rect.Left, rect.Top, 6, rect.Height), 10))
                    g.FillPath(accentBar, accentPath);
                g.Restore(state);
                g.DrawPath(border, path);
            }
        }

        static void DrawHologramCard(Graphics g, Rectangle rect, GraphicsPath path, Color primary, Color accent, bool important, int borderAlpha)
        {
            var cyan = Blend(Color.FromArgb(94, 255, 234), primary, 0.26);
            var violet = Blend(Color.FromArgb(174, 130, 255), accent, 0.28);
            using (var bg = new LinearGradientBrush(rect, Color.FromArgb(214, Blend(Color.FromArgb(12, 18, 34), primary, 0.20)), Color.FromArgb(194, Blend(Color.FromArgb(16, 8, 32), accent, 0.22)), 18f))
            using (var border = new Pen(Color.FromArgb(Math.Min(230, borderAlpha + 34), Blend(Color.White, cyan, 0.22)), important ? 1.7f : 1.1f))
            {
                g.FillPath(bg, path);
                var state = g.Save();
                g.SetClip(path);
                using (var scan = new Pen(Color.FromArgb(important ? 70 : 48, cyan), 1.0f))
                using (var prism = new Pen(Color.FromArgb(important ? 96 : 66, violet), 2.0f))
                using (var sheen = new SolidBrush(Color.FromArgb(important ? 36 : 24, Color.White)))
                {
                    for (int y = rect.Top + 8; y < rect.Bottom; y += 9)
                        g.DrawLine(scan, rect.Left + 8, y, rect.Right - 8, y);
                    prism.StartCap = LineCap.Round;
                    prism.EndCap = LineCap.Round;
                    g.DrawLine(prism, rect.Left + 18, rect.Bottom - 18, rect.Right - 30, rect.Top + 14);
                    g.FillEllipse(sheen, rect.Left - 32, rect.Top - 30, rect.Width + 64, 58);
                }
                g.Restore(state);
                g.DrawPath(border, path);
            }
        }

        static void DrawPaperCard(Graphics g, Rectangle rect, GraphicsPath path, Color primary, Color accent, bool important, int borderAlpha)
        {
            var paperTop = Blend(Color.FromArgb(255, 247, 231), primary, 0.10);
            var paperBottom = Blend(Color.FromArgb(246, 226, 202), accent, 0.12);
            using (var bg = new LinearGradientBrush(rect, Color.FromArgb(250, paperTop), Color.FromArgb(246, paperBottom), 90f))
            using (var border = new Pen(Color.FromArgb(Math.Min(210, borderAlpha + 10), Blend(Color.FromArgb(130, 92, 68), primary, 0.20)), important ? 1.7f : 1.0f))
            {
                g.FillPath(bg, path);
                var state = g.Save();
                g.SetClip(path);
                using (var fiber = new Pen(Color.FromArgb(28, 120, 82, 60), 1.0f))
                using (var wash = new SolidBrush(Color.FromArgb(34, Blend(Color.White, primary, 0.22))))
                using (var accentLine = new Pen(Color.FromArgb(118, Blend(primary, accent, 0.46)), 2.0f))
                {
                    g.FillEllipse(wash, rect.Right - 124, rect.Top - 54, 160, 116);
                    for (int y = rect.Top + 14; y < rect.Bottom; y += 16)
                        g.DrawLine(fiber, rect.Left + 12, y, rect.Right - 12, y - 4);
                    accentLine.StartCap = LineCap.Round;
                    accentLine.EndCap = LineCap.Round;
                    g.DrawLine(accentLine, rect.Left + 16, rect.Bottom - 16, rect.Left + 96, rect.Bottom - 16);
                }
                g.Restore(state);
                g.DrawPath(border, path);
            }
        }
        
        static void DrawText(Graphics g, string text, Font font, Color color, Rectangle rect)
        {
            using (var sf = new StringFormat(StringFormatFlags.LineLimit))
            {
                sf.Trimming = StringTrimming.EllipsisCharacter;
                sf.FormatFlags |= StringFormatFlags.NoClip;
                using (var brush = new SolidBrush(color))
                    g.DrawString(text ?? "", font, brush, rect, sf);
            }
        }

        void DrawScrollableBody(Graphics g, string text, Font font, Color color, Rectangle rect, Color accent)
        {
            var textWidth = rect.Width - 8;
            using (var format = new StringFormat(StringFormatFlags.LineLimit))
            {
                format.Trimming = StringTrimming.None;
                format.FormatFlags |= StringFormatFlags.NoClip;
                using (var brush = new SolidBrush(color))
                {
                    g.DrawString(text, font, brush, new RectangleF(rect.X, rect.Y, textWidth, rect.Height), format);
                }
            }
        }

        static void DrawCentered(Graphics g, string text, Font font, Brush brush, Rectangle rect)
        {
            using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter })
                g.DrawString(text ?? "", font, brush, rect, sf);
        }

        static GraphicsPath RoundRect(Rectangle r, int radius)
        {
            var d = radius * 2;
            var path = new GraphicsPath();
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        static Color ParseColor(string hex, Color fallback)
        {
            try
            {
                if (String.IsNullOrWhiteSpace(hex)) return fallback;
                if (!hex.StartsWith("#")) hex = "#" + hex;
                return ColorTranslator.FromHtml(hex);
            }
            catch { return fallback; }
        }

        static Color Blend(Color a, Color b, double amount)
        {
            amount = Math.Max(0, Math.Min(1, amount));
            var keep = 1.0 - amount;
            return Color.FromArgb(
                (int)Math.Round(a.R * keep + b.R * amount),
                (int)Math.Round(a.G * keep + b.G * amount),
                (int)Math.Round(a.B * keep + b.B * amount));
        }

        static Color[] GetSakuraPalette(string importance, string agentName, string sakuraTheme)
        {
            var agent = (agentName ?? "").ToLowerInvariant();
            var imp = (importance ?? "").ToLowerInvariant();
            var theme = (sakuraTheme ?? "").ToLowerInvariant();

            // User-selected theme override (from config page)
            if (!string.IsNullOrEmpty(theme))
            {
                if (theme.Contains("sakurastorm") || theme.Contains("sakura-storm"))
                    return sakuraStormPalette();
                if (theme.Contains("blackgold") || theme.Contains("black-gold"))
                    return blackGoldPalette();
                if (theme.Contains("ember"))
                    return emberPalette();
                if (theme.Contains("moonlight"))
                    return moonlightPalette();
                if (theme.Contains("neonmint") || theme.Contains("neon-mint"))
                    return neonMintPalette();
                if (theme.Contains("hanako"))    
                    return defaultHanakoPalette();
                if (theme.Contains("butter"))
                    return butterPalette();
                if (theme.Contains("chatgpt") || theme.Contains("gpt"))
                    return chatgptPalette();
                if (theme.Contains("ming") || theme.Contains("rational"))
                    return mingPalette();
                if (theme.Contains("kong"))
                    return kongPalette();
                if (theme.Contains("urgent"))
                    return urgentPalette();
                if (theme.Contains("important"))
                    return importantPalette();
                if (theme.Contains("rainbow"))
                    return rainbowPalette();
            }

            // Agent-specific palettes (override importance)
            if (agent.Contains("butter"))
                return new Color[]
                {
                    Color.FromArgb(255, 230, 170),  // golden cream
                    Color.FromArgb(255, 240, 200),  // warm honey
                    Color.FromArgb(255, 220, 150),  // pale gold
                    Color.FromArgb(255, 235, 190),  // butter cream
                    Color.FromArgb(245, 225, 170),  // soft amber
                };
            if (agent.Contains("chatgpt") || agent.Contains("gpt"))
                return new Color[]
                {
                    Color.FromArgb(200, 220, 255),  // ice blue
                    Color.FromArgb(190, 210, 240),  // steel blue
                    Color.FromArgb(210, 225, 250),  // sky blue
                    Color.FromArgb(180, 200, 235),  // mist blue
                    Color.FromArgb(220, 230, 255),  // pale blue
                };
            if (agent.Contains("ming") || agent.Contains("rational"))
                return new Color[]
                {
                    Color.FromArgb(200, 180, 255),  // lavender purple
                    Color.FromArgb(180, 160, 240),  // violet
                    Color.FromArgb(210, 190, 250),  // soft purple
                    Color.FromArgb(190, 170, 235),  // lilac
                    Color.FromArgb(220, 200, 255),  // light purple
                };
            if (agent.Contains("kong"))
                return new Color[]
                {
                    Color.FromArgb(180, 230, 200),  // jade green
                    Color.FromArgb(200, 240, 210),  // pale emerald
                    Color.FromArgb(170, 220, 190),  // mint green
                    Color.FromArgb(210, 245, 220),  // soft green
                    Color.FromArgb(190, 235, 205),  // sage
                };

            // Importance-based palettes
            if (imp == "urgent")
                return urgentPalette();
            if (imp == "important")
                return importantPalette();

            return defaultHanakoPalette();
        }

        static Color[] defaultHanakoPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 216, 230),
                Color.FromArgb(255, 210, 225),
                Color.FromArgb(250, 200, 215),
                Color.FromArgb(255, 220, 235),
                Color.FromArgb(245, 205, 220),
                Color.FromArgb(255, 215, 228),
            };
        }

        static Color[] butterPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 230, 170),
                Color.FromArgb(255, 240, 200),
                Color.FromArgb(255, 220, 150),
                Color.FromArgb(255, 235, 190),
                Color.FromArgb(245, 225, 170),
            };
        }

        static Color[] chatgptPalette()
        {
            return new Color[]
            {
                Color.FromArgb(200, 220, 255),
                Color.FromArgb(190, 210, 240),
                Color.FromArgb(210, 225, 250),
                Color.FromArgb(180, 200, 235),
                Color.FromArgb(220, 230, 255),
            };
        }

        static Color[] mingPalette()
        {
            return new Color[]
            {
                Color.FromArgb(200, 180, 255),
                Color.FromArgb(180, 160, 240),
                Color.FromArgb(210, 190, 250),
                Color.FromArgb(190, 170, 235),
                Color.FromArgb(220, 200, 255),
            };
        }

        static Color[] kongPalette()
        {
            return new Color[]
            {
                Color.FromArgb(180, 230, 200),
                Color.FromArgb(200, 240, 210),
                Color.FromArgb(170, 220, 190),
                Color.FromArgb(210, 245, 220),
                Color.FromArgb(190, 235, 205),
            };
        }

        static Color[] urgentPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 160, 160),
                Color.FromArgb(255, 180, 140),
                Color.FromArgb(255, 200, 170),
                Color.FromArgb(240, 170, 190),
                Color.FromArgb(255, 190, 180),
            };
        }

        static Color[] rainbowPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 216, 230),
                Color.FromArgb(238, 224, 255),
                Color.FromArgb(222, 245, 238),
                Color.FromArgb(255, 239, 215),
                Color.FromArgb(224, 236, 255),
                Color.FromArgb(250, 226, 238),
                Color.FromArgb(200, 220, 255),
                Color.FromArgb(255, 200, 180),
                Color.FromArgb(180, 230, 200),
            };
        }

        static Color[] importantPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 182, 210),
                Color.FromArgb(255, 200, 180),
                Color.FromArgb(255, 224, 150),
                Color.FromArgb(230, 190, 255),
                Color.FromArgb(255, 210, 230),
            };
        }

        static Color[] sakuraStormPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 88, 158),
                Color.FromArgb(255, 148, 196),
                Color.FromArgb(255, 210, 232),
                Color.FromArgb(238, 82, 132),
                Color.FromArgb(255, 236, 244),
                Color.FromArgb(214, 52, 122),
            };
        }

        static Color[] blackGoldPalette()
        {
            return new Color[]
            {
                Color.FromArgb(245, 194, 90),
                Color.FromArgb(255, 232, 150),
                Color.FromArgb(176, 128, 48),
                Color.FromArgb(92, 78, 52),
                Color.FromArgb(255, 244, 196),
            };
        }

        static Color[] emberPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 122, 24),
                Color.FromArgb(255, 177, 84),
                Color.FromArgb(255, 209, 102),
                Color.FromArgb(224, 70, 40),
                Color.FromArgb(255, 238, 184),
            };
        }

        static Color[] moonlightPalette()
        {
            return new Color[]
            {
                Color.FromArgb(142, 167, 255),
                Color.FromArgb(195, 185, 255),
                Color.FromArgb(215, 183, 255),
                Color.FromArgb(176, 220, 255),
                Color.FromArgb(238, 242, 255),
            };
        }

        static Color[] neonMintPalette()
        {
            return new Color[]
            {
                Color.FromArgb(64, 245, 200),
                Color.FromArgb(122, 167, 255),
                Color.FromArgb(174, 255, 226),
                Color.FromArgb(90, 220, 255),
                Color.FromArgb(232, 255, 246),
            };
        }
    }

    // ═══════════════════════════════════════════════════
    //  Unified particle overlay (merged from 5 separate classes)
    // ═══════════════════════════════════════════════════

    static class ParticleOverlayHub
    {
        static ParticleOverlayForm overlay;

        public static void Emit(string shape, string motion, bool clicked, Color[] palette, Rectangle sourceRect, Point origin, float dirX, float dirY, bool clickOriginMode, int particleCount, double countScale, double sizeScale, int intervalEffect)
        {
            if (overlay == null || overlay.IsDisposed)
                overlay = new ParticleOverlayForm();
            overlay.Emit(shape, motion, clicked, palette, sourceRect, origin, dirX, dirY, clickOriginMode, particleCount, countScale, sizeScale, intervalEffect);
        }
    }

    sealed class ParticleOverlayForm : Form
    {
        sealed class Particle
        {
            public float X, Y, Vx, Vy, Ax, Ay, Rotation, Spin, Scale, WingPhase, Radius, LifeMs;
            public float BaseX, BaseY, AnchorX, AnchorY, Angle, AngularVelocity, OrbitRadius, Seed;
            public Color Color;
            public string Shape, Motion;
            public int BirthTick;
        }
        readonly Timer timer = new Timer();
        readonly Random rng = new Random();
        readonly System.Collections.Generic.List<Particle> particles = new System.Collections.Generic.List<Particle>();
        int tick = 0;
        Rectangle lastParticleDirtyRect = Rectangle.Empty;
        const double DurationMs = 1100.0;
        const int ParticleDirtyPadding = 96;

        public ParticleOverlayForm()
        {
            Bounds = SystemInformation.VirtualScreen;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            var transparentKey = Color.FromArgb(1, 1, 1);
            BackColor = transparentKey;
            TransparencyKey = transparentKey;
            DoubleBuffered = true;
            Opacity = 1.0;

            timer.Interval = 15;
            timer.Tick += delegate { Animate(); };
        }

        public void Emit(string shape, string motion, bool clicked, Color[] palette, Rectangle sourceRect, Point origin, float dirX, float dirY, bool clickOriginMode, int particleCount, double countScale, double sizeScale, int intervalEffect)
        {
            if (IsDisposed) return;
            Bounds = SystemInformation.VirtualScreen;
            var safeRect = Rectangle.Intersect(sourceRect, Bounds);
            if (safeRect.Width <= 0 || safeRect.Height <= 0)
                safeRect = new Rectangle(Math.Max(0, Math.Min(Width, origin.X)) - 1, Math.Max(0, Math.Min(Height, origin.Y)) - 1, 2, 2);
            var normalizedMotion = ParticleMotionRegistry.Normalize(motion);
            var scaleCount = Math.Max(0.2, Math.Min(4.0, countScale));
            var scaleSize = Math.Max(0.5, Math.Min(3.0, sizeScale));
            var count = Math.Max(0, Math.Min(1200, particleCount));
            if (count <= 0)
            {
                var baseCount = normalizedMotion == "drift" ? (clicked ? 44 : 36) : (clickOriginMode ? 58 : 52);
                count = (int)Math.Max(1, Math.Min(1200, Math.Round(baseCount * scaleCount)));
            }
            else
            {
                count = (int)Math.Max(1, Math.Min(1200, Math.Round(count * scaleCount)));
            }
            var safeIntervalEffect = Math.Max(0, Math.Min(100, intervalEffect));
            if (palette == null || palette.Length == 0) palette = new Color[] { Color.White };
            InitParticles(safeRect, origin, count, shape, normalizedMotion, clicked, palette, dirX, dirY, clickOriginMode, scaleSize, safeIntervalEffect);
            if (!Visible) Show();
            if (!timer.Enabled) timer.Start();
            Invalidate();
        }

        void InitParticles(Rectangle sourceRect, Point origin, int count, string shape, string motion, bool clicked, Color[] palette, float dirX, float dirY, bool clickOriginMode, double sizeScale, int intervalEffect)
        {
            var normalizedMotion = ParticleMotionRegistry.Normalize(motion);
            var cx = sourceRect.Left + sourceRect.Width / 2.0;
            var cy = sourceRect.Top + sourceRect.Height / 2.0;
            var cols = Math.Max(1, (int)Math.Ceiling(Math.Sqrt(count * (sourceRect.Width / (double)Math.Max(1, sourceRect.Height)))));
            var rows = Math.Max(1, (int)Math.Ceiling(count / (double)cols));
            var anchorX = (clicked && clickOriginMode) || normalizedMotion == "magnet-snap" ? origin.X : (float)cx;
            var anchorY = (clicked && clickOriginMode) || normalizedMotion == "magnet-snap" ? origin.Y : (float)cy;

            for (int i = 0; i < count; i++)
            {
                float rx, ry, angle;
                double speed;
                float ax = 0f, ay = 0f;
                var seed = (float)rng.NextDouble();

                if (normalizedMotion == "drift" || normalizedMotion == "ribbon-flow" || normalizedMotion == "bubble-rise" || normalizedMotion == "windmill-gust")
                {
                    var col = i % cols;
                    var row = i / cols;
                    rx = (float)(sourceRect.Left + (col + 0.18 + rng.NextDouble() * 0.64) * sourceRect.Width / cols);
                    ry = (float)(sourceRect.Top + (row + 0.18 + rng.NextDouble() * 0.64) * sourceRect.Height / rows);
                    angle = normalizedMotion == "windmill-gust" ? (float)(-0.40 + rng.NextDouble() * 0.22) : (float)(-Math.PI / 2.0 + (-1.10 + rng.NextDouble() * 2.20));
                    speed = normalizedMotion == "windmill-gust" ? (0.9 + rng.NextDouble() * 1.4) : (0.18 + rng.NextDouble() * 0.46);
                    ax = normalizedMotion == "windmill-gust" ? (float)(0.010 + rng.NextDouble() * 0.010) : (float)(-0.00025 + rng.NextDouble() * 0.00050);
                    ay = normalizedMotion == "bubble-rise" ? (float)(-0.0024 - rng.NextDouble() * 0.0020) : (float)(-0.00060 - rng.NextDouble() * 0.00055);
                }
                else if (normalizedMotion == "pixel-rain")
                {
                    rx = (float)(sourceRect.Left - sourceRect.Width * 0.18 + rng.NextDouble() * sourceRect.Width * 1.36);
                    ry = (float)(sourceRect.Top - 36.0 - rng.NextDouble() * 48.0);
                    angle = (float)(Math.PI / 2.0 + (-0.10 + rng.NextDouble() * 0.20));
                    speed = 2.1 + rng.NextDouble() * 3.0;
                    ay = (float)(0.002 + rng.NextDouble() * 0.005);
                }
                else if (normalizedMotion == "x-burst")
                {
                    rx = (float)(cx + (-0.16 + rng.NextDouble() * 0.32) * sourceRect.Width);
                    ry = (float)(cy + (-0.42 + rng.NextDouble() * 0.84) * sourceRect.Height);
                    var side = rng.NextDouble() < 0.5 ? 0.0 : Math.PI;
                    var tilt = (-15.0 + rng.NextDouble() * 30.0) * Math.PI / 180.0;
                    angle = (float)(side + tilt);
                    speed = 3.9 + rng.NextDouble() * 2.8;
                    ax = (float)(-Math.Cos(angle) * (0.004 + rng.NextDouble() * 0.004));
                    ay = (float)(-Math.Sin(angle) * (0.001 + rng.NextDouble() * 0.002));
                }
                else if (normalizedMotion == "rect-burst")
                {
                    var edge = rng.Next(0, 4);
                    if (edge == 0) { rx = (float)(sourceRect.Left + rng.NextDouble() * sourceRect.Width); ry = sourceRect.Top; }
                    else if (edge == 1) { rx = (float)(sourceRect.Left + rng.NextDouble() * sourceRect.Width); ry = sourceRect.Bottom; }
                    else if (edge == 2) { rx = sourceRect.Left; ry = (float)(sourceRect.Top + rng.NextDouble() * sourceRect.Height); }
                    else { rx = sourceRect.Right; ry = (float)(sourceRect.Top + rng.NextDouble() * sourceRect.Height); }
                    angle = (float)Math.Atan2(ry - cy, rx - cx) + (-0.26f + (float)rng.NextDouble() * 0.52f);
                    speed = 1.8 + rng.NextDouble() * 4.2;
                    ax = (float)(-Math.Cos(angle) * (0.014 + rng.NextDouble() * 0.020));
                    ay = (float)(-Math.Sin(angle) * (0.014 + rng.NextDouble() * 0.020));
                }
                else if (normalizedMotion == "shatter-lines")
                {
                    rx = (float)(cx + (-0.28 + rng.NextDouble() * 0.56) * sourceRect.Width);
                    ry = (float)(cy + (-0.28 + rng.NextDouble() * 0.56) * sourceRect.Height);
                    var lane = rng.Next(0, 7);
                    angle = (float)((lane * Math.PI / 7.0) + (-0.08 + rng.NextDouble() * 0.16));
                    if (rng.NextDouble() < 0.5) angle += (float)Math.PI;
                    speed = 4.2 + rng.NextDouble() * 4.8;
                    ax = (float)(-Math.Cos(angle) * (0.010 + rng.NextDouble() * 0.010));
                    ay = (float)(-Math.Sin(angle) * (0.010 + rng.NextDouble() * 0.010));
                }
                else if (normalizedMotion == "gravity-fall")
                {
                    rx = (float)(sourceRect.Left + rng.NextDouble() * sourceRect.Width);
                    ry = (float)(sourceRect.Top + rng.NextDouble() * sourceRect.Height * 0.55);
                    angle = (float)(-Math.PI / 2.0 + (-0.95 + rng.NextDouble() * 1.90));
                    speed = 1.0 + rng.NextDouble() * 2.8;
                    ay = (float)(0.060 + rng.NextDouble() * 0.035);
                }
                else
                {
                    var theta = rng.NextDouble() * Math.PI * 2.0;
                    var radius = normalizedMotion == "click-burst" ? (8.0 + rng.NextDouble() * 14.0) : Math.Min(sourceRect.Width, sourceRect.Height) * (0.34 + rng.NextDouble() * 0.28);
                    var ox = normalizedMotion == "click-burst" ? origin.X : cx;
                    var oy = normalizedMotion == "click-burst" ? origin.Y : cy;
                    rx = (float)(ox + Math.Cos(theta) * radius);
                    ry = (float)(oy + Math.Sin(theta) * radius);
                    angle = (float)(theta + (-0.34 + rng.NextDouble() * 0.68));
                    speed = 1.9 + rng.NextDouble() * 4.5;
                    ax = (float)(-Math.Cos(angle) * (0.016 + rng.NextDouble() * 0.026));
                    ay = (float)(-Math.Sin(angle) * (0.016 + rng.NextDouble() * 0.026));
                }

                var orbitAngle = (float)Math.Atan2(ry - anchorY, rx - anchorX);
                var orbitRadius = (float)Math.Max(8.0, Math.Sqrt((rx - anchorX) * (rx - anchorX) + (ry - anchorY) * (ry - anchorY)));
                var normalizedShape = ParticleShapeRegistry.Normalize(shape);
                var baseScale = (float)((0.46 + rng.NextDouble() * 1.08) * sizeScale);
                var particleRadius = (float)((2.2 + rng.NextDouble() * 7.8) * sizeScale);
                var rotation = (float)(rng.NextDouble() * 360);
                var spin = (float)(-3.2 + rng.NextDouble() * 6.4);
                var lifeMs = (float)((normalizedMotion == "x-burst" || normalizedMotion == "shatter-lines") ? (620.0 + rng.NextDouble() * 360.0) : (760.0 + rng.NextDouble() * 760.0));
                if (normalizedShape == "comet")
                {
                    // Comets must read as velocity glyphs: bright head in front, tail dragged behind.
                    // Random sprite rotation made them look like tangled scratches, so lock rotation to travel direction.
                    rotation = (float)(angle * 180.0 / Math.PI);
                    spin = 0.0f;
                    baseScale = (float)((0.74 + rng.NextDouble() * 0.46) * sizeScale);
                    particleRadius = (float)((4.8 + rng.NextDouble() * 4.8) * sizeScale);
                    lifeMs = (float)(560.0 + rng.NextDouble() * 420.0);
                }
                particles.Add(new Particle
                {
                    X = rx,
                    Y = ry,
                    BaseX = rx,
                    BaseY = ry,
                    AnchorX = anchorX,
                    AnchorY = anchorY,
                    Angle = orbitAngle,
                    AngularVelocity = (float)((rng.NextDouble() < 0.5 ? -1 : 1) * (0.030 + rng.NextDouble() * 0.045)),
                    OrbitRadius = orbitRadius,
                    Seed = seed,
                    Vx = (float)(Math.Cos(angle) * speed),
                    Vy = (float)(Math.Sin(angle) * speed),
                    Ax = ax,
                    Ay = ay,
                    Rotation = rotation,
                    Spin = spin,
                    Scale = baseScale,
                    WingPhase = (float)(rng.NextDouble() * Math.PI * 2),
                    Radius = particleRadius,
                    Color = palette[i % palette.Length],
                    Shape = normalizedShape,
                    Motion = normalizedMotion,
                    BirthTick = tick + ComputeBirthDelayTick(i, count, normalizedMotion, intervalEffect, lifeMs),
                    LifeMs = lifeMs,
                });
            }
        }

        int ComputeBirthDelayTick(int index, int count, string motion, int intervalEffect, float lifeMs)
        {
            var normalizedMotion = ParticleMotionRegistry.Normalize(motion);
            var baseRange = normalizedMotion == "drift" ? 12 : 8;
            var baseDelay = rng.Next(0, baseRange);
            var effect = Math.Max(0, Math.Min(100, intervalEffect));
            if (effect <= 0 || count <= 1) return baseDelay;

            var effectT = effect / 100.0;
            var reserveMs = Math.Max(240.0, Math.Min(360.0, lifeMs * 0.28));
            var durationCap = Math.Max(baseRange, (int)Math.Floor((DurationMs - reserveMs) / Math.Max(1.0, timer.Interval)));
            var extraMax = (int)Math.Round(64.0 * effectT);
            extraMax = Math.Max(0, Math.Min(extraMax, durationCap - baseRange));

            var ordered = count <= 1 ? 0.0 : index / (double)(count - 1);
            var waveDelay = (int)Math.Round(Math.Pow(ordered, 0.78) * extraMax);
            var jitterRange = Math.Max(2, (int)Math.Round(3.0 + 7.0 * effectT));
            return Math.Min(durationCap, baseDelay + waveDelay + rng.Next(0, jitterRange));
        }

        static class ParticleMotionRegistry
        {
            public static string Normalize(string motion)
            {
                return Payload.NormalizeDismissMotion(motion);
            }

            public static void Apply(Particle pt, double age)
            {
                switch (Normalize(pt.Motion))
                {
                    case "vortex": Vortex(pt, age); break;
                    case "ribbon-flow": RibbonFlow(pt, age); break;
                    case "gravity-fall": GravityFall(pt, age); break;
                    case "orbit-decay": OrbitDecay(pt, age); break;
                    case "bubble-rise": BubbleRise(pt, age); break;
                    case "windmill-gust": WindmillGust(pt, age); break;
                    case "shatter-lines": ShatterLines(pt, age); break;
                    case "pixel-rain": PixelRain(pt, age); break;
                    case "magnet-snap": MagnetSnap(pt, age); break;
                    case "drift": Drift(pt, age); break;
                    default: Burst(pt, age); break;
                }
            }

            static void Drift(Particle pt, double age)
            {
                var wobble = (float)Math.Sin(age * Math.PI * 4.6 + pt.WingPhase);
                pt.X += pt.Vx + wobble * 0.045f;
                pt.Y += pt.Vy + wobble * 0.030f;
                pt.Vx += pt.Ax;
                pt.Vy += pt.Ay;
                pt.Vx *= 0.992f;
                pt.Vy *= 0.992f;
            }

            static void Burst(Particle pt, double age)
            {
                pt.X += pt.Vx;
                pt.Y += pt.Vy;
                pt.Vx += pt.Ax;
                pt.Vy += pt.Ay;
                var damping = Normalize(pt.Motion) == "x-burst" ? 0.995f : 0.982f;
                pt.Vx *= damping;
                pt.Vy *= damping;
            }

            static void Vortex(Particle pt, double age)
            {
                pt.Angle += pt.AngularVelocity * (1.15f - (float)age * 0.55f);
                pt.OrbitRadius += 0.72f + pt.Seed * 0.85f;
                pt.X = pt.AnchorX + (float)Math.Cos(pt.Angle) * pt.OrbitRadius;
                pt.Y = pt.AnchorY + (float)Math.Sin(pt.Angle) * pt.OrbitRadius;
            }

            static void RibbonFlow(Particle pt, double age)
            {
                var sway = (float)Math.Sin(age * Math.PI * 7.2 + pt.Seed * 6.28f);
                pt.X += pt.Vx + sway * (0.45f + pt.Seed * 0.45f);
                pt.Y += pt.Vy - 0.10f + (float)Math.Cos(age * Math.PI * 3.2 + pt.Seed) * 0.18f;
                pt.Vx *= 0.992f;
                pt.Vy *= 0.996f;
            }

            static void GravityFall(Particle pt, double age)
            {
                pt.X += pt.Vx;
                pt.Y += pt.Vy;
                pt.Vx *= 0.985f;
                pt.Vy += 0.070f + pt.Seed * 0.025f;
            }

            static void OrbitDecay(Particle pt, double age)
            {
                pt.Angle += pt.AngularVelocity * (1.55f - (float)age);
                pt.OrbitRadius += 0.22f + (float)age * 1.10f;
                pt.X = pt.AnchorX + (float)Math.Cos(pt.Angle) * pt.OrbitRadius;
                pt.Y = pt.AnchorY + (float)Math.Sin(pt.Angle) * pt.OrbitRadius;
            }

            static void BubbleRise(Particle pt, double age)
            {
                var wobble = (float)Math.Sin(age * Math.PI * 8.0 + pt.WingPhase) * (0.42f + pt.Seed * 0.35f);
                pt.X += pt.Vx * 0.35f + wobble;
                pt.Y += pt.Vy - (0.18f + pt.Seed * 0.24f);
                pt.Vy -= 0.006f;
                pt.Radius *= 1.0015f;
            }

            static void WindmillGust(Particle pt, double age)
            {
                var turbulence = (float)Math.Sin(age * Math.PI * 9.0 + pt.Seed * 3.14f) * 0.28f;
                pt.X += pt.Vx + 0.42f + turbulence;
                pt.Y += pt.Vy + turbulence * 0.55f;
                pt.Vx += 0.018f;
                pt.Vy *= 0.990f;
                pt.Spin += 0.045f;
            }

            static void ShatterLines(Particle pt, double age)
            {
                pt.X += pt.Vx;
                pt.Y += pt.Vy;
                pt.Vx *= 0.992f;
                pt.Vy *= 0.992f;
            }

            static void PixelRain(Particle pt, double age)
            {
                var zig = ((int)(age * 18.0 + pt.Seed * 5.0) % 2 == 0 ? -1f : 1f) * 0.18f;
                pt.X += pt.Vx * 0.18f + zig;
                pt.Y += pt.Vy;
                pt.Vy += 0.018f;
            }

            static void MagnetSnap(Particle pt, double age)
            {
                if (age < 0.34)
                {
                    var dx = pt.AnchorX - pt.X;
                    var dy = pt.AnchorY - pt.Y;
                    pt.X += dx * 0.105f;
                    pt.Y += dy * 0.105f;
                    return;
                }
                pt.X += pt.Vx * 1.28f;
                pt.Y += pt.Vy * 1.28f;
                pt.Vx *= 0.985f;
                pt.Vy *= 0.985f;
            }
        }

        void Animate()
        {
            var previousDirty = lastParticleDirtyRect;
            tick++;
            for (int i = particles.Count - 1; i >= 0; i--)
            {
                var pt = particles[i];
                if (tick < pt.BirthTick) continue;
                var age = Math.Min(1.0, (tick - pt.BirthTick) * timer.Interval / Math.Max(1.0, pt.LifeMs));
                if (age >= 1.0)
                {
                    particles.RemoveAt(i);
                    continue;
                }
                ParticleMotionRegistry.Apply(pt, age);
                pt.Rotation += pt.Spin * 0.34f;
                pt.WingPhase += 0.12f;
            }
            InvalidateParticleRegion(previousDirty, ComputeParticleDirtyRect());
            if (particles.Count == 0)
            {
                timer.Stop();
                lastParticleDirtyRect = Rectangle.Empty;
                Hide();
            }
        }

        Rectangle ComputeParticleDirtyRect()
        {
            Rectangle bounds = Rectangle.Empty;
            for (int i = 0; i < particles.Count; i++)
            {
                var pt = particles[i];
                if (tick < pt.BirthTick) continue;
                var rect = EstimateParticleBounds(pt);
                bounds = bounds.IsEmpty ? rect : Rectangle.Union(bounds, rect);
            }
            if (bounds.IsEmpty) return Rectangle.Empty;
            bounds.Inflate(ParticleDirtyPadding, ParticleDirtyPadding);
            bounds.Intersect(ClientRectangle);
            return bounds;
        }

        Rectangle EstimateParticleBounds(Particle pt)
        {
            var radius = Math.Max(42.0f, (pt.Radius + 44.0f) * Math.Max(0.5f, pt.Scale));
            var shape = (pt.Shape ?? "").ToLowerInvariant();
            if (shape == "comet") radius += 64.0f;
            else if (shape == "butterfly" || shape == "windmill" || shape == "snowflake") radius += 24.0f;
            return Rectangle.Ceiling(new RectangleF(pt.X - radius, pt.Y - radius, radius * 2.0f, radius * 2.0f));
        }

        void InvalidateParticleRegion(Rectangle previousDirty, Rectangle currentDirty)
        {
            Rectangle dirty;
            if (previousDirty.IsEmpty) dirty = currentDirty;
            else if (currentDirty.IsEmpty) dirty = previousDirty;
            else dirty = Rectangle.Union(previousDirty, currentDirty);

            if (dirty.IsEmpty)
            {
                Invalidate();
            }
            else
            {
                dirty.Intersect(ClientRectangle);
                if (dirty.IsEmpty) Invalidate();
                else Invalidate(dirty, false);
            }
            lastParticleDirtyRect = currentDirty;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                timer.Stop();
                timer.Dispose();
                particles.Clear();
            }
            base.Dispose(disposing);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            // TransparencyKey windows must be cleared to the key color for the invalidated region.
            // FillRectangle respects ClipRectangle; Graphics.Clear may clear the whole surface.
            using (var keyBrush = new SolidBrush(BackColor))
                e.Graphics.FillRectangle(keyBrush, e.ClipRectangle);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.CompositingMode = CompositingMode.SourceOver;
            g.CompositingQuality = CompositingQuality.HighSpeed;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            // TransparencyKey + anti-aliased semi-transparent edges leak magenta/pink.
            // Keep particle edges crisp; each particle fades independently inside the shared overlay.
            g.SmoothingMode = SmoothingMode.None;

            for (int idx = 0; idx < particles.Count; idx++)
            {
                var pt = particles[idx];
                if (tick < pt.BirthTick) continue;
                if (!e.ClipRectangle.IsEmpty && !EstimateParticleBounds(pt).IntersectsWith(e.ClipRectangle)) continue;
                var age = Math.Min(1.0, (tick - pt.BirthTick) * timer.Interval / Math.Max(1.0, pt.LifeMs));
                var fadeOutT = Math.Max(0.0, (age - 0.46) / 0.54);
                // TransparencyKey windows leak color on semi-transparent edges, so keep particles opaque
                // and create a fade-out feeling by shrinking each petal smoothly to zero.
                var vanishScale = Math.Pow(Math.Max(0.0, 1.0 - fadeOutT), 0.72);
                var fadeInScale = age < 0.08 ? (float)(0.75 + 0.25 * (age / 0.08)) : 1.0f;
                var lifeScale = (float)(vanishScale * fadeInScale);
                if (lifeScale <= 0.01f)
                    continue;
                var state = g.Save();
                g.TranslateTransform(pt.X, pt.Y);
                g.RotateTransform(pt.Rotation);
                g.ScaleTransform(pt.Scale * lifeScale, pt.Scale * lifeScale);
                var color = pt.Color;
                var shape = (pt.Shape ?? "sakura").ToLowerInvariant();

                switch (shape)
                {
                    case "snowflake":
                        using (var pen = new Pen(color, 1.15f))
                        using (var core = new SolidBrush(Blend(pt.Color, Color.White, 0.45)))
                        {
                            pen.StartCap = LineCap.Round;
                            pen.EndCap = LineCap.Round;
                            for (int i = 0; i < 6; i++)
                            {
                                var s = g.Save();
                                g.RotateTransform(i * 60f);
                                g.DrawLine(pen, 0, 0, 0, -10.5f);
                                g.DrawLine(pen, 0, -5.6f, -3.2f, -8.4f);
                                g.DrawLine(pen, 0, -5.6f, 3.2f, -8.4f);
                                g.DrawLine(pen, 0, -8.2f, -2.1f, -10.2f);
                                g.DrawLine(pen, 0, -8.2f, 2.1f, -10.2f);
                                g.Restore(s);
                            }
                            g.FillEllipse(core, -2.0f, -2.0f, 4.0f, 4.0f);
                        }
                        break;
                    case "windmill":
                        var windSheen = Blend(pt.Color, Color.White, 0.62);
                        var windShade = Blend(pt.Color, Color.Black, 0.34);
                        using (var bladeBrush = new SolidBrush(Blend(pt.Color, Color.White, 0.10)))
                        using (var innerBrush = new SolidBrush(Blend(pt.Color, Color.White, 0.34)))
                        using (var edgePen = new Pen(windSheen, 0.9f))
                        using (var shadePen = new Pen(windShade, 0.9f))
                        using (var hub = new SolidBrush(windSheen))
                        using (var hubCore = new SolidBrush(windShade))
                        {
                            for (int i = 0; i < 4; i++)
                            {
                                var s = g.Save();
                                g.RotateTransform(i * 90f + 16f);
                                g.FillPath(bladeBrush, ParticleGeometryCache.WindmillBlade);
                                g.DrawPath(shadePen, ParticleGeometryCache.WindmillBlade);
                                g.FillPath(innerBrush, ParticleGeometryCache.WindmillInner);
                                g.DrawLine(edgePen, 1.2f, -2.0f, 6.8f, -9.4f);
                                g.FillRectangle(innerBrush, 6.0f, -12.0f, 2.0f, 2.0f);
                                g.Restore(s);
                            }
                            g.FillEllipse(hub, -3.2f, -3.2f, 6.4f, 6.4f);
                            g.FillEllipse(hubCore, -1.4f, -1.4f, 2.8f, 2.8f);
                            g.DrawLine(edgePen, -5.0f, 0.0f, 5.0f, 0.0f);
                            g.DrawLine(edgePen, 0.0f, -5.0f, 0.0f, 5.0f);
                        }
                        break;
                    case "butterfly":
                        var wingFlap = 0.82f + 0.18f * (float)Math.Sin(pt.WingPhase);
                        var scaled = g.Save();
                        g.ScaleTransform(wingFlap, 1.0f);
                        var wingDark = Blend(pt.Color, Color.FromArgb(38, 34, 84), 0.34);
                        var wingLight = Blend(pt.Color, Color.White, 0.42);
                        var wingGold = Blend(pt.Color, Color.FromArgb(255, 226, 132), 0.36);
                        using (var outerWing = new SolidBrush(Blend(pt.Color, Color.White, 0.08)))
                        using (var innerWing = new SolidBrush(wingLight))
                        using (var lowerWing = new SolidBrush(wingGold))
                        using (var bodyBrush = new SolidBrush(wingDark))
                        using (var veinPen = new Pen(Blend(pt.Color, Color.White, 0.62), 0.8f))
                        using (var antenna = new Pen(Blend(pt.Color, Color.White, 0.50), 0.8f))
                        {
                            g.FillPath(outerWing, ParticleGeometryCache.ButterflyLeftTop);
                            g.FillPath(outerWing, ParticleGeometryCache.ButterflyRightTop);
                            g.FillPath(lowerWing, ParticleGeometryCache.ButterflyLeftLow);
                            g.FillPath(lowerWing, ParticleGeometryCache.ButterflyRightLow);
                            g.FillPath(innerWing, ParticleGeometryCache.ButterflyLeftInner);
                            g.FillPath(innerWing, ParticleGeometryCache.ButterflyRightInner);
                            g.DrawLine(veinPen, -1.0f, -1.0f, -10.5f, -5.8f);
                            g.DrawLine(veinPen, 1.0f, -1.0f, 10.5f, -5.8f);
                            g.DrawLine(veinPen, -0.4f, 2.4f, -7.4f, 7.2f);
                            g.DrawLine(veinPen, 0.4f, 2.4f, 7.4f, 7.2f);
                            g.FillEllipse(bodyBrush, -1.8f, -6.6f, 3.6f, 13.2f);
                            g.FillRectangle(bodyBrush, -0.8f, -8.0f, 1.6f, 3.0f);
                            g.DrawBezier(antenna, -0.2f, -6.0f, -2.6f, -9.1f, -4.9f, -10.0f, -6.8f, -11.8f);
                            g.DrawBezier(antenna, 0.2f, -6.0f, 2.6f, -9.1f, 4.9f, -10.0f, 6.8f, -11.8f);
                            using (var tip = new SolidBrush(wingLight))
                            {
                                g.FillRectangle(tip, -7.4f, -12.1f, 2.0f, 2.0f);
                                g.FillRectangle(tip, 5.4f, -12.1f, 2.0f, 2.0f);
                            }
                        }
                        g.Restore(scaled);
                        break;
                    case "bubble":
                        {
                            var r = Math.Max(4.0f, pt.Radius);
                            var bubbleEdge = Blend(pt.Color, Color.White, 0.66);
                            var bubbleRim = Blend(pt.Color, Color.White, 0.28);
                            var bubbleShadow = Blend(pt.Color, Color.Black, 0.22);
                            using (var outerPen = new Pen(bubbleEdge, 1.4f))
                            using (var innerPen = new Pen(bubbleRim, 0.9f))
                            using (var shadePen = new Pen(bubbleShadow, 0.8f))
                            using (var sparkle = new SolidBrush(Color.White))
                            using (var tint = new SolidBrush(bubbleRim))
                            {
                                g.DrawEllipse(outerPen, -r, -r, r * 2, r * 2);
                                g.DrawEllipse(innerPen, -r + 2.0f, -r + 2.0f, r * 2 - 4.0f, r * 2 - 4.0f);
                                g.DrawArc(shadePen, -r + 1.0f, -r + 1.0f, r * 2 - 2.0f, r * 2 - 2.0f, 32.0f, 112.0f);
                                g.FillRectangle(sparkle, -r * 0.40f, -r * 0.52f, Math.Max(2.0f, r * 0.30f), Math.Max(2.0f, r * 0.18f));
                                g.FillRectangle(sparkle, r * 0.20f, -r * 0.30f, 2.0f, 2.0f);
                                g.FillRectangle(tint, -r * 0.18f, r * 0.28f, Math.Max(2.0f, r * 0.22f), 2.0f);
                            }
                        }
                        break;
                    case "star":
                        using (var starBrush = new SolidBrush(Blend(pt.Color, Color.White, 0.34)))
                        using (var starPen = new Pen(Blend(pt.Color, Color.White, 0.68), 0.8f))
                        {
                            g.FillPath(starBrush, ParticleGeometryCache.Star);
                            g.DrawPath(starPen, ParticleGeometryCache.Star);
                        }
                        break;
                    case "spark":
                        var sparkHot = Blend(pt.Color, Color.White, 0.74);
                        var sparkWarm = Blend(pt.Color, Color.FromArgb(255, 198, 92), 0.34);
                        using (var outer = new Pen(sparkWarm, 2.0f))
                        using (var inner = new Pen(sparkHot, 0.9f))
                        using (var core = new SolidBrush(sparkHot))
                        {
                            outer.StartCap = LineCap.Round; outer.EndCap = LineCap.Round;
                            inner.StartCap = LineCap.Round; inner.EndCap = LineCap.Round;
                            for (int i = 0; i < 4; i++)
                            {
                                var s = g.Save();
                                g.RotateTransform(i * 45f + 12f);
                                g.DrawLine(outer, -2.0f, 0.0f, 13.0f, 0.0f);
                                g.DrawLine(inner, 1.0f, 0.0f, 10.0f, 0.0f);
                                g.Restore(s);
                            }
                            g.FillEllipse(core, -2.6f, -2.6f, 5.2f, 5.2f);
                            g.FillRectangle(core, 8.8f, -5.8f, 2.0f, 2.0f);
                        }
                        break;
                    case "shard":
                        using (var shardBrush = new SolidBrush(Blend(pt.Color, Color.White, 0.20)))
                        using (var shardPen = new Pen(Blend(pt.Color, Color.White, 0.62), 0.9f))
                        {
                            g.FillPath(shardBrush, ParticleGeometryCache.Shard);
                            g.DrawPath(shardPen, ParticleGeometryCache.Shard);
                            g.DrawLine(shardPen, -1.2f, -9.0f, 3.8f, 6.6f);
                        }
                        break;
                    case "leaf":
                        using (var leafBrush = new SolidBrush(Blend(pt.Color, Color.FromArgb(160, 245, 176), 0.34)))
                        using (var leafPen = new Pen(Blend(pt.Color, Color.White, 0.46), 0.8f))
                        {
                            g.FillPath(leafBrush, ParticleGeometryCache.Leaf);
                            g.DrawPath(leafPen, ParticleGeometryCache.Leaf);
                            g.DrawLine(leafPen, 0.0f, -9.0f, 0.0f, 8.0f);
                        }
                        break;
                    case "pixel":
                        using (var px = new SolidBrush(Blend(pt.Color, Color.White, 0.18)))
                        using (var px2 = new SolidBrush(Blend(pt.Color, Color.White, 0.52)))
                        {
                            g.FillRectangle(px, -5.0f, -5.0f, 10.0f, 10.0f);
                            g.FillRectangle(px2, -2.0f, -9.0f, 4.0f, 4.0f);
                            g.FillRectangle(px2, 5.0f, 2.0f, 3.0f, 3.0f);
                        }
                        break;
                    case "comet":
                        var cometOuter = Blend(pt.Color, Color.FromArgb(255, 176, 70), 0.34);
                        var cometInner = Blend(pt.Color, Color.White, 0.34);
                        var cometHead = Blend(pt.Color, Color.White, 0.70);
                        var tailLen = 23.0f + pt.Radius * 1.35f;
                        var tailHalf = 3.2f + pt.Radius * 0.16f;
                        using (var outerBrush = new SolidBrush(cometOuter))
                        using (var innerBrush = new SolidBrush(cometInner))
                        using (var headBrush = new SolidBrush(cometHead))
                        using (var coreBrush = new SolidBrush(Color.White))
                        using (var rimPen = new Pen(Blend(cometHead, Color.White, 0.26), 1.0f))
                        using (var outerTail = new GraphicsPath())
                        using (var innerTail = new GraphicsPath())
                        {
                            // Local +X is the travel direction. The sprite rotation is locked to velocity at spawn.
                            outerTail.StartFigure();
                            outerTail.AddBezier(-tailLen, 0.0f, -tailLen * 0.70f, -tailHalf * 1.25f, -8.0f, -tailHalf, 3.4f, -1.4f);
                            outerTail.AddBezier(3.4f, -1.4f, 7.2f, 0.0f, 3.4f, 1.4f, 3.4f, 1.4f);
                            outerTail.AddBezier(3.4f, 1.4f, -8.0f, tailHalf, -tailLen * 0.70f, tailHalf * 1.25f, -tailLen, 0.0f);
                            outerTail.CloseFigure();
                            g.FillPath(outerBrush, outerTail);

                            innerTail.StartFigure();
                            innerTail.AddBezier(-tailLen * 0.72f, 0.0f, -tailLen * 0.50f, -tailHalf * 0.58f, -6.0f, -tailHalf * 0.42f, 5.2f, -0.7f);
                            innerTail.AddBezier(5.2f, -0.7f, 8.0f, 0.0f, 5.2f, 0.7f, 5.2f, 0.7f);
                            innerTail.AddBezier(5.2f, 0.7f, -6.0f, tailHalf * 0.42f, -tailLen * 0.50f, tailHalf * 0.58f, -tailLen * 0.72f, 0.0f);
                            innerTail.CloseFigure();
                            g.FillPath(innerBrush, innerTail);

                            g.FillEllipse(headBrush, -1.8f, -4.9f, 10.8f, 9.8f);
                            g.DrawEllipse(rimPen, -1.8f, -4.9f, 10.8f, 9.8f);
                            g.FillEllipse(coreBrush, 2.5f, -2.0f, 4.2f, 4.0f);
                            g.FillRectangle(coreBrush, 8.8f, -0.8f, 2.0f, 1.6f);
                        }
                        break;
                    case "gear":
                        using (var gearPen = new Pen(Blend(pt.Color, Color.White, 0.48), 1.2f))
                        using (var gearFill = new SolidBrush(Blend(pt.Color, Color.Black, 0.18)))
                        using (var hole = new SolidBrush(Blend(pt.Color, Color.White, 0.58)))
                        {
                            for (int i = 0; i < 10; i++)
                            {
                                var s = g.Save();
                                g.RotateTransform(i * 36f);
                                g.FillRectangle(gearFill, -2.2f, -14.0f, 4.4f, 5.6f);
                                g.Restore(s);
                            }
                            g.FillEllipse(gearFill, -10.5f, -10.5f, 21.0f, 21.0f);
                            g.DrawEllipse(gearPen, -10.5f, -10.5f, 21.0f, 21.0f);
                            g.FillEllipse(hole, -3.8f, -3.8f, 7.6f, 7.6f);
                        }
                        break;
                    case "ember":
                        using (var emberBrush = new SolidBrush(Blend(pt.Color, Color.FromArgb(255, 168, 70), 0.34)))
                        using (var emberCore = new SolidBrush(Blend(pt.Color, Color.White, 0.46)))
                        {
                            g.FillPath(emberBrush, ParticleGeometryCache.Ember);
                            g.FillEllipse(emberCore, -2.6f, 0.5f, 5.2f, 7.0f);
                        }
                        break;
                    case "crescent":
                        using (var moon = new SolidBrush(Blend(pt.Color, Color.White, 0.58)))
                        using (var cut = new SolidBrush(Color.FromArgb(1, 1, 1)))
                        using (var starDot = new SolidBrush(Blend(pt.Color, Color.White, 0.82)))
                        {
                            g.FillEllipse(moon, -8.0f, -11.0f, 16.0f, 22.0f);
                            g.FillEllipse(cut, -2.0f, -12.0f, 16.0f, 22.0f);
                            g.FillRectangle(starDot, 8.0f, -5.0f, 2.4f, 2.4f);
                        }
                        break;
                    case "slash":
                        using (var blade = new Pen(Blend(pt.Color, Color.White, 0.62), 2.6f))
                        using (var bladeCore = new Pen(Color.White, 0.9f))
                        using (var chip = new SolidBrush(Blend(pt.Color, Color.White, 0.42)))
                        {
                            blade.StartCap = LineCap.Round; blade.EndCap = LineCap.Round;
                            bladeCore.StartCap = LineCap.Round; bladeCore.EndCap = LineCap.Round;
                            g.DrawLine(blade, -12.0f, 9.0f, 12.0f, -9.0f);
                            g.DrawLine(bladeCore, -8.0f, 6.0f, 9.0f, -6.8f);
                            g.FillRectangle(chip, -3.0f, -9.0f, 3.0f, 3.0f);
                            g.FillRectangle(chip, 7.0f, 4.0f, 2.5f, 2.5f);
                        }
                        break;
                    case "moss":
                        var mossBreathe = 0.88f + 0.12f * (float)Math.Sin(pt.WingPhase);
                        using (var petalBrush = new SolidBrush(Blend(pt.Color, Color.White, 0.20)))
                        using (var centerBrush = new SolidBrush(Blend(pt.Color, Color.FromArgb(255, 244, 190), 0.62)))
                        {
                            for (int i = 0; i < 5; i++)
                            {
                                var s = g.Save();
                                g.RotateTransform(i * 72f);
                                g.FillEllipse(petalBrush, -2.4f * mossBreathe, -6.6f * mossBreathe, 4.8f * mossBreathe, 13.2f * mossBreathe);
                                g.Restore(s);
                            }
                            g.FillEllipse(centerBrush, -3.4f, -3.4f, 6.8f, 6.8f);
                        }
                        break;
                    case "sakura":
                    default:
                        var breathe = 0.92f + 0.08f * (float)Math.Sin(pt.WingPhase);
                        using (var petalBrush = new SolidBrush(Blend(pt.Color, Color.White, 0.30)))
                        using (var innerBrush = new SolidBrush(Blend(pt.Color, Color.FromArgb(255, 248, 232), 0.52)))
                        using (var centerBrush = new SolidBrush(Blend(pt.Color, Color.FromArgb(255, 226, 162), 0.58)))
                        {
                            for (int i = 0; i < 5; i++)
                            {
                                var s = g.Save();
                                g.RotateTransform(i * 72f);
                                g.ScaleTransform(breathe, breathe);
                                g.FillPath(petalBrush, ParticleGeometryCache.SakuraPetal);
                                g.FillPath(innerBrush, ParticleGeometryCache.SakuraShine);
                                g.Restore(s);
                            }
                            g.FillEllipse(centerBrush, -2.4f, -2.4f, 4.8f, 4.8f);
                        }
                        break;
                }
                g.Restore(state);
            }
        }

        static Color Blend(Color a, Color b, double amount)
        {
            amount = Math.Max(0, Math.Min(1, amount));
            var keep = 1.0 - amount;
            return Color.FromArgb(
                (int)Math.Round(a.R * keep + b.R * amount),
                (int)Math.Round(a.G * keep + b.G * amount),
                (int)Math.Round(a.B * keep + b.B * amount));
        }
    }
}








