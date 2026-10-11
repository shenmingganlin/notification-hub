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
    sealed class ToastForm : Form
    {
        readonly Payload payload;
        bool noActivateRemoved = false;
        public string ToastId { get { return payload.ToastId; } }
        public bool IsExiting { get { return phase == ToastPhase.Exiting; } }
        public event EventHandler ExitStarted;
        public event EventHandler Displayed;
        bool displayReported;
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
        readonly Timer controlTimer = new Timer();
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
        string _particleShape = "sakura";
        double _autoParticleCountScale = 1.0;
        double _manualParticleCountScale = 1.0;
        double _particleSizeScale = 1.0;
        int _particleIntervalEffect = 0;
        string _entranceVisual = "mist-bloom";
        double _entranceProgress = 0.0;
        string _cardExitMode = "trajectory";
        bool _cardExitFade = true;
        string _autoDismissMotion = "drift";
        string _manualDismissMotion = "click-burst";
        string _exitMotion = "drift";
        float _exitDirX = 1f;
        float _exitDirY = 0f;
        string _physicsPreset = "lively";
        double stackSpringStiffness = 0.075;
        double stackDamping = 0.16;
        double stackSettleVelocity = 0.04;
        double stackSettleDistance = 0.35;
        double stackTargetImpulse = 0.10;
        bool stackResetVelocityOnTargetChange = false;
        double enterDurationMs = 300.0;
        double enterOvershoot = 1.70158;
        Point lastClickPoint = Point.Empty;
        Bitmap _cardCacheBitmap = null;
        Bitmap _layerBitmap = null;
        bool _layerComposed = false;
        bool _layerFaulted = false;
        byte _layerAlpha = 0;
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
            // Per-pixel alpha. A color key cuts the rounded edge, and Form.Opacity
            // would replace that alpha with one uniform layer.
            DoubleBuffered = true;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.Opaque, true);
            _layerAlpha = 0;

            // Let user offsets move the toast freely, including beyond the screen working area.
            finalX = work.Right - canvasWidth - 44 + _toastOffsetX;
            startX = finalX + (int)Math.Round(34 * _toastScale);
            baseY = work.Bottom - canvasHeight - 8 + _toastOffsetY;
            targetY = ComputeStackY(payload.StackIndex);
            currentY = targetY;
            Bounds = new Rectangle(startX, targetY, canvasWidth, canvasHeight);
            _toastLayout = NormalizeToastLayout(payload.ToastLayout);
            _toastStyle = payload.ToastStyle;
            _particleShape = payload.ParticleShape;
            _autoParticleCountScale = Math.Max(0.2, Math.Min(4.0, payload.AutoParticleCountScale));
            _manualParticleCountScale = Math.Max(0.2, Math.Min(4.0, payload.ManualParticleCountScale));
            _particleSizeScale = Math.Max(0.5, Math.Min(3.0, payload.ParticleSizeScale));
            _particleIntervalEffect = Math.Max(0, Math.Min(100, payload.ParticleIntervalEffect));
            _entranceVisual = EntranceVisualRegistry.Normalize(payload.EntranceVisual);
            _entranceProgress = 0.0;
            _cardExitMode = Payload.NormalizeCardExitMode(payload.CardExitMode);
            _cardExitFade = payload.CardExitFade;
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
            controlTimer.Interval = 220;
            controlTimer.Tick += CheckControlCommand;
            if (!String.IsNullOrWhiteSpace(payload.ControlPath)) controlTimer.Start();
        }

        protected override void OnMouseClick(MouseEventArgs e)
        {
            base.OnMouseClick(e);
            if (e.Button != MouseButtons.Left || IsExiting) return;
            // The form intentionally owns a padded transparent canvas for glow and particles,
            // but only the visible rounded card is interactive.
            if (!IsPointInsideCard(e.Location)) return;
            lastClickPoint = e.Location;
            var clickedAt = DateTime.UtcNow.ToString("o");
            ThreadPool.QueueUserWorkItem(delegate { WriteClickEvent(clickedAt); });
            ReleaseCapture();
            // Release the hit region and interactive slot before deferred particle work.
            StartExit(true);
        }

        bool IsPointInsideCard(Point point)
        {
            if (IsExiting) return false;
            var scale = Math.Max(0.01, _toastScale);
            var designPoint = new Point(
                (int)Math.Round(point.X / scale),
                (int)Math.Round(point.Y / scale));
            using (var path = RoundRect(cardRect, 20))
                return path.IsVisible(designPoint);
        }

        void CheckControlCommand(object sender, EventArgs e)
        {
            if (String.IsNullOrWhiteSpace(payload.ControlPath)) return;
            try
            {
                if (!File.Exists(payload.ControlPath)) return;
                var command = File.ReadAllText(payload.ControlPath);
                File.Delete(payload.ControlPath);
                if (command.IndexOf("\"action\":\"close\"", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    command.IndexOf("\"action\": \"close\"", StringComparison.OrdinalIgnoreCase) >= 0)
                    StartExit(false);
            }
            catch { }
        }

        void WriteClickEvent(string clickedAt)
        {
            try
            {
                if (String.IsNullOrWhiteSpace(payload.ClickPath)) return;
                var dir = Path.GetDirectoryName(payload.ClickPath);
                if (!String.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
                var json = "{"
                    + "\"toastId\":\"" + EscapeJson(payload.ToastId) + "\","
                    + "\"clickedAt\":\"" + EscapeJson(clickedAt) + "\","
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
            controlTimer.Stop();
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
                controlTimer.Dispose();
                stackTimer.Dispose();
                DisposeCardCache();
                DisposeLayerBitmap();
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
            _layerComposed = false;
            var bitmap = _cardCacheBitmap;
            _cardCacheBitmap = null;
            if (bitmap == null) return;
            try { bitmap.Dispose(); } catch { }
        }

        void DisposeLayerBitmap()
        {
            _layerComposed = false;
            var bitmap = _layerBitmap;
            _layerBitmap = null;
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
                + " entrance=" + (_entranceVisual ?? "mist-bloom")
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

        const int GwlExStyle = -20;
        const int WsExNoActivate = 0x08000000;
        static readonly IntPtr HwndNotTopmost = new IntPtr(-2);
        const uint SwpNoMove = 0x0002;
        const uint SwpNoSize = 0x0001;
        const uint SwpNoActivate = 0x0010;
        [DllImport("user32.dll")]
        static extern bool ReleaseCapture();
        const uint SwpNoZOrder = 0x0004;
        const uint SwpFrameChanged = 0x0020;

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", CharSet = CharSet.Unicode)]
        static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", CharSet = CharSet.Unicode)]
        static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr newStyle);
        [DllImport("user32.dll")]
        static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
        void RemoveNoActivateStyle()
        {
            if (noActivateRemoved || !IsHandleCreated) return;
            try
            {
                long style = GetWindowLongPtr(Handle, GwlExStyle).ToInt64();
                SetWindowLongPtr(Handle, GwlExStyle, new IntPtr(style & ~WsExNoActivate));
                noActivateRemoved = (GetWindowLongPtr(Handle, GwlExStyle).ToInt64() & WsExNoActivate) == 0;
                if (noActivateRemoved)
                    SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, SwpNoSize | SwpNoMove | SwpNoZOrder | SwpNoActivate | SwpFrameChanged);
            }
            catch { }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_EX_LAYERED = 0x00080000;
                const int WS_EX_NOACTIVATE = 0x08000000;
                const int WS_EX_TOOLWINDOW = 0x00000080;
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
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
            PresentLayered();
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
            if (CardContainsScreen(Cursor.Position)) RemoveNoActivateStyle();
            SetHoverInside(CardContainsScreen(Cursor.Position));
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            SetHoverInside(false);
        }

        protected override void WndProc(ref Message m)
        {
            const int WM_MOUSEWHEEL = 0x020A;
            const int WM_NCHITTEST = 0x0084;
            const int HTTRANSPARENT = -1;
            if (m.Msg == WM_NCHITTEST)
            {
                int packed = unchecked((int)(long)m.LParam);
                var screen = new Point((short)(packed & 0xFFFF), (short)((packed >> 16) & 0xFFFF));
                if (IsExiting || !CardContainsScreen(screen))
                {
                    // Padding stays inside the window rect, so MouseLeave does not
                    // fire there. Drop the hover as soon as hit-testing leaves the card.
                    if (mouseInside) SetHoverInside(false);
                    m.Result = (IntPtr)HTTRANSPARENT;
                    return;
                }
            }
            if (m.Msg == WM_MOUSEWHEEL && !IsExiting)
            {
                int delta = (short)((m.WParam.ToInt64() >> 16) & 0xffff);
                if (ScrollBody(delta)) return;
            }
            base.WndProc(ref m);
        }

        bool CardContainsScreen(Point screen)
        {
            Point client;
            try { client = PointToClient(screen); }
            catch { return false; }
            return IsPointInsideCard(client);
        }

        void SetHoverInside(bool inside)
        {
            if (mouseInside == inside) return;
            mouseInside = inside;
            if (inside) PauseLifetime();
            else ResumeLifetime();
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
            if (IsExiting) return;
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
            MoveWithoutChangingZOrder(Left, y);
            if (IsHandleCreated) PresentLayered();
        }

        void MoveWithoutChangingZOrder(int x, int y)
        {
            if (!IsHandleCreated) { Location = new Point(x, y); return; }
            SetWindowPos(Handle, IntPtr.Zero, x, y, 0, 0, SwpNoSize | SwpNoZOrder | SwpNoActivate);
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
            DisposeCardCache();
            PresentLayered();
            return true;
        }

        void StartExit(bool clicked)
        {
            if (phase == ToastPhase.Exiting) return;
            phase = ToastPhase.Exiting;
            tick = 0;
            lifeTimer.Stop();
            stackTimer.Stop();
            controlTimer.Stop();
            mouseInside = false;
            // Layered + TRANSPARENT passes input across threads/processes as well.
            if (IsHandleCreated)
            {
                const long WS_EX_TRANSPARENT = 0x00000020;
                long style = GetWindowLongPtr(Handle, GwlExStyle).ToInt64();
                SetWindowLongPtr(Handle, GwlExStyle, new IntPtr(style | WS_EX_TRANSPARENT | WsExNoActivate));
                SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, SwpNoSize | SwpNoMove | SwpNoZOrder | SwpNoActivate | SwpFrameChanged);
            }
            ExitStarted?.Invoke(this, EventArgs.Empty);
            _exitMotion = Payload.NormalizeDismissMotion(clicked ? (_manualDismissMotion ?? "click-burst") : (_autoDismissMotion ?? "drift"));
            _exitDirX = 1f;
            _exitDirY = 0f;
            if (clicked && lastClickPoint != Point.Empty && cardRect.Width > 0 && cardRect.Height > 0)
            {
                var scale = Math.Max(0.01, _toastScale);
                var cardCenterX = (cardRect.Left + cardRect.Width / 2.0) * scale;
                var cardCenterY = (cardRect.Top + cardRect.Height / 2.0) * scale;
                var awayX = cardCenterX - lastClickPoint.X;
                var awayY = cardCenterY - lastClickPoint.Y;
                var away = Math.Sqrt(awayX * awayX + awayY * awayY);
                if (away > 8.0)
                {
                    _exitDirX = (float)(awayX / away);
                    _exitDirY = (float)(awayY / away);
                }
            }

            // Determine shape and motion
            var shape = (_particleShape ?? "sakura").ToLowerInvariant();
            if (!payload.SakuraEnabled || shape == "none")
            {
                BeginExitAnimation();
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

            FinishExit(delegate
            {
                // Queue on the shared overlay's UI handle: an instant card may be
                // disposed before this callback, but its particles can finish.
                ParticleOverlayHub.EmitDeferred(shape, motion, clicked,
                    ParticlePalettes.ForToast(payload.Importance, payload.AgentName, payload.SakuraTheme, shape, payload.Primary, payload.Accent), sourceRect, origin, dirX, dirY, clickOriginMode, payload.ParticleCount, countScale, _particleSizeScale * _toastScale, _particleIntervalEffect);
            });
        }

        void FinishExit(Action emitParticles)
        {
            try { emitParticles(); }
            catch (Exception ex)
            {
                try { Console.Error.WriteLine("[notification-hub helper] particle create failed: " + ex.Message); } catch { }
            }
            finally { BeginExitAnimation(); }
        }

        void BeginExitAnimation()
        {
            if (String.Equals(_cardExitMode, "instant", StringComparison.OrdinalIgnoreCase) && !_cardExitFade)
            {
                DisposeDismissOverlay();
                animTimer.Stop();
                stackTimer.Stop();
                Close();
                return;
            }
            animTimer.Start();
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

                NoteLayerAlpha(opacity);
                MoveWithoutChangingZOrder(finalX + (int)Math.Round(travel * (1.0 - xEase)), (int)Math.Round(currentY));
                if (p >= 1.0)
                {
                    _entranceProgress = 1.0;
                    NoteLayerAlpha(1);
                    MoveWithoutChangingZOrder(finalX, targetY);
                    phase = ToastPhase.Alive;
                    animTimer.Stop();
                }
                PresentLayered();
                return;
            }

            if (phase == ToastPhase.Exiting)
            {
                var instant = String.Equals(_cardExitMode, "instant", StringComparison.OrdinalIgnoreCase);
                var exitMs = 640.0;
                var elapsed = tick * animTimer.Interval;
                var p = Math.Min(1.0, elapsed / exitMs);
                if (_cardExitFade)
                    NoteLayerAlpha(1.0 - Smoothstep(p));
                else
                    NoteLayerAlpha(1);
                if (!instant)
                {
                    var approach = Math.Max(0, startX - finalX);
                    var exitTravel = Math.Max(approach * 2.4f, 72f);
                    var dx = ToastExitMotion.ReverseApproach(p, exitTravel);
                    MoveWithoutChangingZOrder(finalX + (int)Math.Round(dx), (int)Math.Round(currentY));
                }
                PresentLayered();

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

        static double Smoothstep(double t)
        {
            t = Math.Max(0, Math.Min(1, t));
            return t * t * (3.0 - 2.0 * t);
        }

        static double EaseOutBack(double t, double overshoot)
        {
            t = Math.Max(0, Math.Min(1, t));
            var c1 = overshoot;
            var c3 = c1 + 1;
            return 1 + c3 * Math.Pow(t - 1, 3) + c1 * Math.Pow(t - 1, 2);
        }

        protected override void OnPaint(PaintEventArgs e) { }

        protected override void OnPaintBackground(PaintEventArgs e) { }

        void NoteLayerAlpha(double opacity)
        {
            var a = (int)Math.Round(Math.Max(0.0, Math.Min(1.0, opacity)) * 255.0);
            _layerAlpha = (byte)a;
        }

        void PresentLayered()
        {
            if (!IsHandleCreated) CreateHandle();
            var bmp = EnsurePresentedBitmap();
            if (bmp == null) return;
            if (!Visible) Show();
            var presented = ParticleLayer.Present(Handle, bmp, Left, Top, _layerAlpha);
            if (!presented && !_layerFaulted)
            {
                _layerFaulted = true;
                try { Console.Error.WriteLine("[notification-hub helper] toast layer present failed"); } catch { }
            }
            if (presented && _layerAlpha > 0 && !displayReported)
            {
                displayReported = true;
                Displayed?.Invoke(this, EventArgs.Empty);
                if (!String.IsNullOrWhiteSpace(payload.DisplayAckPath))
                    ToastManager.WriteAckFile(payload.DisplayAckPath, payload.ToastId, true, "shown");
            }
        }

        Bitmap EnsurePresentedBitmap()
        {
            var entranceLive = phase == ToastPhase.Entering && _entranceProgress < 1.0;
            if (_layerBitmap != null && _layerComposed && !entranceLive) return _layerBitmap;

            var paintStart = ToastPerfEnabled ? System.Diagnostics.Stopwatch.GetTimestamp() : 0;
            var card = EnsureCardCache();
            if (card == null) return null;
            if (_layerBitmap == null || _layerBitmap.Width != card.Width || _layerBitmap.Height != card.Height)
            {
                if (_layerBitmap != null) _layerBitmap.Dispose();
                _layerBitmap = new Bitmap(card.Width, card.Height, PixelFormat.Format32bppPArgb);
            }
            using (var g = Graphics.FromImage(_layerBitmap))
            {
                g.Clear(Color.Transparent);
                g.DrawImageUnscaled(card, 0, 0);
                if (entranceLive)
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.ScaleTransform((float)_toastScale, (float)_toastScale);
                    var entranceBg = string.Equals(_toastStyle, "paper", StringComparison.OrdinalIgnoreCase)
                        ? Color.FromArgb(255, 247, 231)
                        : ccBgTop;
                    EntranceVisualRegistry.Apply(g, _entranceVisual, _entranceProgress, cardRect, ccPrimary, ccAccent, entranceBg, ccIsImportant);
                }
            }
            _layerComposed = !entranceLive;
            if (ToastPerfEnabled && paintStart > 0)
            {
                var elapsed = System.Diagnostics.Stopwatch.GetTimestamp() - paintStart;
                _perfPaintCount++;
                if (elapsed > _perfMaxPaintTicks) _perfMaxPaintTicks = elapsed;
            }
            return _layerBitmap;
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
                cacheGraphics.Clear(Color.Transparent);
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
                    ToastCardStyles.DrawSakuraStormCard(g, cardRect, path, ccPrimary, ccAccent, ccIsImportant, ccBorderAlpha);
                }
                else if (style == "obsidian")
                {
                    ToastCardStyles.DrawObsidianCard(g, cardRect, path, ccPrimary, ccAccent, ccIsImportant, ccBorderAlpha);
                }
                else if (style == "hologram")
                {
                    ToastCardStyles.DrawHologramCard(g, cardRect, path, ccPrimary, ccAccent, ccIsImportant, ccBorderAlpha);
                }
                else if (style == "paper")
                {
                    ToastCardStyles.DrawPaperCard(g, cardRect, path, ccPrimary, ccAccent, ccIsImportant, ccBorderAlpha);
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
                DrawTitle(g, payload, TitleFont, titleColor, new Rectangle(textX, cardRect.Y + 43, cardRect.Right - textX - 22, 24));
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
                DrawTitle(g, payload, TitleFont, titleColor, new Rectangle(textX, cardRect.Y + 14, tagRect.Left - textX - 10, 24));
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
                DrawTitle(g, payload, TitleFont, titleColor, new Rectangle(cardRect.X + 62, cardRect.Y + 14, tagRect.Left - cardRect.X - 74, 25));
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
                DrawTitle(g, payload, TitleFont, titleColor, new Rectangle(cardRect.X + 20, cardRect.Y + 56, cardRect.Width - 40, 24));
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
                DrawTitle(g, payload, TitleFont, titleColor, new Rectangle(textX, cardRect.Y + 14, tagRect.Left - textX - 10, 24));
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


        static void DrawTitle(Graphics g, Payload titlePayload, Font font, Color color, Rectangle rect)
        {
            var text = !String.IsNullOrWhiteSpace(titlePayload?.Title)
                ? titlePayload.Title.Trim()
                : (!String.IsNullOrWhiteSpace(titlePayload?.AgentName) ? titlePayload.AgentName.Trim() : "通知");
            var titleRect = new Rectangle(rect.X, rect.Y, rect.Width, Math.Max(rect.Height, (int)Math.Ceiling(font.GetHeight(g)) + 6));
            using (var sf = new StringFormat(StringFormatFlags.NoWrap | StringFormatFlags.NoClip))
            {
                sf.Trimming = StringTrimming.EllipsisCharacter;
                using (var brush = new SolidBrush(color))
                    g.DrawString(text, font, brush, titleRect, sf);
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

        internal static GraphicsPath RoundRect(Rectangle r, int radius)
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

        internal static Color ParseColor(string hex, Color fallback)
        {
            try
            {
                if (String.IsNullOrWhiteSpace(hex)) return fallback;
                if (!hex.StartsWith("#")) hex = "#" + hex;
                return ColorTranslator.FromHtml(hex);
            }
            catch { return fallback; }
        }

        internal static Color Blend(Color a, Color b, double amount)
        {
            amount = Math.Max(0, Math.Min(1, amount));
            var keep = 1.0 - amount;
            return Color.FromArgb(
                (int)Math.Round(a.R * keep + b.R * amount),
                (int)Math.Round(a.G * keep + b.G * amount),
                (int)Math.Round(a.B * keep + b.B * amount));
        }

    }

    // ═══════════════════════════════════════════════════
}
