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
    static class ParticleOverlayHub
    {
        static ParticleOverlayForm overlay;
        static bool presentPathReported;
        public static event Action LayerShown;
        public static IntPtr WindowHandle
        {
            get { return overlay != null && !overlay.IsDisposed && overlay.IsHandleCreated ? overlay.Handle : IntPtr.Zero; }
        }

        public static void NotifyLayerShown() { LayerShown?.Invoke(); }

        public static void ReportPresentPath(string path)
        {
            if (presentPathReported) return;
            presentPathReported = true;
            try { Console.Error.WriteLine("[notification-hub helper] particle present path: " + path); } catch { }
        }

        public static void Warm()
        {
            try
            {
                if (overlay == null || overlay.IsDisposed)
                    overlay = new ParticleOverlayForm();
                overlay.WarmGpu();
            }
            catch { }
        }

        public static void EmitDeferred(string shape, string motion, bool clicked, Color[] palette, Rectangle sourceRect, Point origin, float dirX, float dirY, bool clickOriginMode, int particleCount, double countScale, double sizeScale, int intervalEffect)
        {
            if (overlay == null || overlay.IsDisposed)
                overlay = new ParticleOverlayForm();
            var target = overlay;
            var handle = target.Handle;
            target.BeginInvoke(new Action(delegate
            {
                try
                {
                    if (target.IsDisposed) return;
                    target.WarmGpu();
                    target.Emit(shape, motion, clicked, palette, sourceRect, origin, dirX, dirY, clickOriginMode, particleCount, countScale, sizeScale, intervalEffect);
                }
                catch (Exception ex)
                {
                    try { Console.Error.WriteLine("[notification-hub helper] particle emit failed: " + ex.Message); } catch { }
                    try { target.Close(); target.Dispose(); } catch { }
                }
            }));
        }
    }

    sealed class ParticleOverlayForm : Form
    {
        readonly Timer timer = new Timer();
        readonly Random rng = new Random();
        readonly System.Collections.Generic.List<Particle> particles = new System.Collections.Generic.List<Particle>();
        readonly ParticleSpriteCache sprites = new ParticleSpriteCache();
        ParticleGpuPresenter gpu;
        bool gpuDisabled;
        Bitmap frameBitmap;
        Rectangle presentRect = Rectangle.Empty;
        bool particleFaulted = false;
        bool layerFaulted = false;
        int tick = 0;
        const double DurationMs = 1100.0;
        const double SimulationStepMs = 15.0;
        const int PresentExpandPadding = 64;
        const int PresentShrinkPadding = 48;
        const int MaxSimulationStepsPerFrame = 4;
        long lastSimulationTimestamp;
        double simulationAccumulatorMs;

        public ParticleOverlayForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.Opaque, true);
            timer.Interval = 15;
            timer.Tick += delegate
            {
                try { Animate(); }
                catch (Exception ex)
                {
                    if (!particleFaulted)
                    {
                        particleFaulted = true;
                        try { Console.Error.WriteLine("[notification-hub helper] particle overlay stopped: " + ex.Message); } catch { }
                    }
                    timer.Stop();
                    presentRect = Rectangle.Empty;
                    ReleaseGpuTarget();
                    if (Visible) Hide();
                }
            };
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_EX_LAYERED = 0x00080000;
                const int WS_EX_TRANSPARENT = 0x00000020;
                const int WS_EX_TOOLWINDOW = 0x00000080;
                const int WS_EX_TOPMOST = 0x00000008;
                const int WS_EX_NOACTIVATE = 0x08000000;
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE;
                return cp;
            }
        }

        protected override void WndProc(ref Message m)
        {
            const int WM_NCHITTEST = 0x0084;
            const int WM_MOUSEACTIVATE = 0x0021;
            if (m.Msg == WM_NCHITTEST) { m.Result = new IntPtr(-1); return; }
            if (m.Msg == WM_MOUSEACTIVATE) { m.Result = new IntPtr(3); return; }
            base.WndProc(ref m);
        }

        public void WarmGpu()
        {
            // Offscreen sprite batching only: no swap chain or DirectComposition target.
            if (IsDisposed || gpu != null || gpuDisabled) return;
            try { gpu = ParticleGpuPresenter.TryCreate(); }
            catch { gpu = null; }
            if (gpu == null) gpuDisabled = true;
        }

        public void Emit(string shape, string motion, bool clicked, Color[] palette, Rectangle sourceRect, Point origin, float dirX, float dirY, bool clickOriginMode, int particleCount, double countScale, double sizeScale, int intervalEffect)
        {
            if (IsDisposed) return;
            var screen = SystemInformation.VirtualScreen;
            var safeRect = Rectangle.Intersect(sourceRect, screen);
            if (safeRect.Width <= 0 || safeRect.Height <= 0)
                safeRect = new Rectangle(origin.X, origin.Y, 2, 2);
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
            if (!timer.Enabled)
            {
                lastSimulationTimestamp = System.Diagnostics.Stopwatch.GetTimestamp();
                simulationAccumulatorMs = 0.0;
                timer.Start();
            }
            Present();
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

        void Animate()
        {
            var now = System.Diagnostics.Stopwatch.GetTimestamp();
            if (lastSimulationTimestamp == 0) lastSimulationTimestamp = now;
            simulationAccumulatorMs += (now - lastSimulationTimestamp) * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
            lastSimulationTimestamp = now;

            int steps = 0;
            while (simulationAccumulatorMs >= SimulationStepMs && steps < MaxSimulationStepsPerFrame)
            {
                AdvanceSimulationStep();
                simulationAccumulatorMs -= SimulationStepMs;
                steps++;
            }
            if (particles.Count == 0)
            {
                timer.Stop();
                presentRect = Rectangle.Empty;
                ReleaseGpuTarget();
                if (Visible) Hide();
                return;
            }
            if (steps > 0) Present();
        }

        void AdvanceSimulationStep()
        {
            tick++;
            for (int i = particles.Count - 1; i >= 0; i--)
            {
                var pt = particles[i];
                if (tick < pt.BirthTick) continue;
                var age = Math.Min(1.0, (tick - pt.BirthTick) * timer.Interval / Math.Max(1.0, pt.LifeMs));
                if (age >= 1.0)
                {
                    int last = particles.Count - 1;
                    particles[i] = particles[last];
                    particles.RemoveAt(last);
                    continue;
                }
                ParticleMotionRegistry.Apply(pt, age);
                pt.Rotation += pt.Spin * 0.34f;
                pt.WingPhase += 0.12f;
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
            bounds.Intersect(SystemInformation.VirtualScreen);
            return bounds;
        }

        void FitPresentRect(Rectangle dirty)
        {
            if (dirty.IsEmpty) return;
            var screen = SystemInformation.VirtualScreen;
            if (presentRect.IsEmpty || !presentRect.Contains(dirty))
            {
                var expanded = dirty;
                expanded.Inflate(PresentExpandPadding, PresentExpandPadding);
                expanded.Intersect(screen);
                if (expanded.Width <= 0 || expanded.Height <= 0) expanded = dirty;
                presentRect = expanded;
                return;
            }

            long live = (long)dirty.Width * dirty.Height;
            long shown = (long)presentRect.Width * presentRect.Height;
            if (live > 0 && shown > live * 2 && shown - live > PresentShrinkPadding * PresentShrinkPadding)
            {
                var shrunk = dirty;
                shrunk.Inflate(PresentShrinkPadding, PresentShrinkPadding);
                shrunk.Intersect(screen);
                if (shrunk.Width > 0 && shrunk.Height > 0) presentRect = shrunk;
            }
        }

        static int AlignGpuSize(int value)
        {
            const int quantum = 64;
            return Math.Max(quantum, Math.Min(8192, ((value + quantum - 1) / quantum) * quantum));
        }

        Rectangle EstimateParticleBounds(Particle pt)
        {
            // The blit scales the baked design by pt.Scale. Radius already includes
            // sizeScale and is only the bubble/comet bake size, so multiplying
            // (Radius + constant) by Scale again blew the surface up at max size.
            var shape = pt.Shape ?? "";
            float design = 18f;
            if (shape == "comet") design = 26f + pt.Radius * 1.40f;
            else if (shape == "bubble") design = pt.Radius + 3f;
            else if (shape == "butterfly") design = 22f;
            var radius = design * Math.Max(0.05f, pt.Scale);
            return Rectangle.Ceiling(new RectangleF(pt.X - radius, pt.Y - radius, radius * 2.0f, radius * 2.0f));
        }

        void ReleaseGpuTarget()
        {
            if (gpu != null) gpu.ReleaseTarget();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                timer.Stop();
                timer.Dispose();
                particles.Clear();
                sprites.DisposeSprites();
                if (gpu != null)
                {
                    gpu.Dispose();
                    gpu = null;
                }
                if (frameBitmap != null)
                {
                    frameBitmap.Dispose();
                    frameBitmap = null;
                }
            }
            base.Dispose(disposing);
        }

        void Present()
        {
            var dirty = ComputeParticleDirtyRect();
            if (dirty.IsEmpty) return;
            FitPresentRect(dirty);
            if (presentRect.Width <= 0 || presentRect.Height <= 0) return;

            // PerMonitorV2 already reports screen pixels here. Scaling by DeviceDpi/96
            // pushed the layered window off a 150% display, so the burst was invisible.
            int displayWidth = Math.Max(1, Math.Min(8192, presentRect.Width));
            int displayHeight = Math.Max(1, Math.Min(8192, presentRect.Height));

            int pw = AlignGpuSize(displayWidth);
            int ph = AlignGpuSize(displayHeight);
            if (!IsHandleCreated) CreateHandle();
            if (!Visible)
            {
                Show();
                // Show can raise this TopMost layer. Restore the notification order
                // on every reappearance, before either GPU or software presentation.
                ParticleOverlayHub.NotifyLayerShown();
            }

            if (!gpuDisabled && gpu == null)
            {
                try { gpu = ParticleGpuPresenter.TryCreate(); }
                catch { gpu = null; }
                if (gpu == null) gpuDisabled = true;
            }
            if (gpu != null)
            {
                try
                {
                    if (gpu.Begin(pw, ph, sprites.Epoch))
                    {
                        DrawParticles(null, gpu);
                        if (gpu.End(Handle, presentRect.X, presentRect.Y, displayWidth, displayHeight)) return;
                    }
                }
                catch (Exception ex)
                {
                    try { Console.Error.WriteLine("[notification-hub helper] particle gpu fallback: " + ex.Message); } catch { }
                }
                gpu.Dispose();
                gpu = null;
                gpuDisabled = true; // Avoid retrying a failed device on every animation frame.
            }

            if (frameBitmap == null || frameBitmap.Width != displayWidth || frameBitmap.Height != displayHeight)
            {
                if (frameBitmap != null) frameBitmap.Dispose();
                frameBitmap = new Bitmap(displayWidth, displayHeight, PixelFormat.Format32bppPArgb);
            }

            using (var g = Graphics.FromImage(frameBitmap))
            {
                g.Clear(Color.Transparent);
                g.CompositingMode = CompositingMode.SourceOver;
                g.CompositingQuality = CompositingQuality.HighSpeed;
                g.InterpolationMode = InterpolationMode.HighQualityBilinear;
                g.PixelOffsetMode = PixelOffsetMode.Half;
                DrawParticles(g, null);
            }

            if (!ParticleLayer.Present(Handle, frameBitmap, presentRect.X, presentRect.Y) && !layerFaulted)
            {
                layerFaulted = true;
                try { Console.Error.WriteLine("[notification-hub helper] particle overlay present failed"); } catch { }
            }
        }

        void DrawParticles(Graphics g, IParticleSpriteBatchSink batchSink)
        {
            for (int idx = 0; idx < particles.Count; idx++)
            {
                var pt = particles[idx];
                if (tick < pt.BirthTick) continue;
                var age = Math.Min(1.0, (tick - pt.BirthTick) * timer.Interval / Math.Max(1.0, pt.LifeMs));
                var fadeOutT = Math.Max(0.0, (age - 0.46) / 0.54);
                var vanishScale = Math.Pow(Math.Max(0.0, 1.0 - fadeOutT), 0.72);
                var fadeInScale = age < 0.08 ? (float)(0.75 + 0.25 * (age / 0.08)) : 1.0f;
                var lifeScale = (float)(vanishScale * fadeInScale);
                if (lifeScale <= 0.01f) continue;
                var shape = pt.Shape ?? "sakura";
                var sprite = sprites.Find(shape, pt.Color, pt.Radius);
                if (sprite == null)
                {
                    sprite = sprites.Get(shape, pt.Color, pt.Radius, delegate(Graphics bake, float quantRadius)
                    {
                        ParticleShapePainter.Draw(bake, new Particle
                        {
                            Shape = shape,
                            Color = pt.Color,
                            Radius = quantRadius,
                            WingPhase = (float)(Math.PI / 2.0),
                            Scale = 1f,
                        });
                    });
                }
                if (sprite == null || sprite.Image == null) continue;
                float poseX = 1f, poseY = 1f;
                if (shape == "butterfly")
                    poseX = 0.82f + 0.18f * (float)Math.Sin(pt.WingPhase);
                else if (shape == "sakura")
                {
                    var breathe = 0.92f + 0.08f * (float)Math.Sin(pt.WingPhase);
                    poseX = poseY = breathe;
                }
                else if (shape == "moss")
                {
                    var breathe = 0.88f + 0.12f * (float)Math.Sin(pt.WingPhase);
                    poseX = poseY = breathe;
                }
                var unit = pt.Scale * lifeScale / ParticleSpriteCache.BakeScale;
                float sx = unit * poseX;
                float sy = unit * poseY;
                if (g == null)
                {
                    batchSink.Add(
                        sprite,
                        -sprite.CenterX * sx,
                        -sprite.CenterY * sy,
                        (sprite.Image.Width - sprite.CenterX) * sx,
                        (sprite.Image.Height - sprite.CenterY) * sy,
                        pt.Rotation,
                        pt.X - presentRect.X,
                        pt.Y - presentRect.Y);
                }
                else
                {
                    g.ResetTransform();
                    g.TranslateTransform(pt.X - presentRect.X, pt.Y - presentRect.Y);
                    g.RotateTransform(pt.Rotation);
                    g.ScaleTransform(sx, sy);
                    g.DrawImage(sprite.Image, -sprite.CenterX, -sprite.CenterY);
                }
            }
        }

        protected override void OnPaint(PaintEventArgs e) { }

        protected override void OnPaintBackground(PaintEventArgs e) { }

    }
}
