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
    static class EntranceVisualRegistry
    {
        // Entrance light is painted into a quarter-resolution buffer, box-blurred
        // there, then stretched back over the card with bilinear filtering.
        // No pens and no PathGradient: every light here is a filled shape whose
        // edge is dissolved by the blur, so nothing ends in a hard rim.
        public const string DefaultId = "ripple-bloom";
        static bool _entranceFaulted;

        struct LightPalette
        {
            public Color Primary;
            public Color Accent;
            public Color White;
            public Color Heart;
            public double WhiteMix;
            public double Boost;
            public bool LightBg;
        }

        sealed class SoftLayer : IDisposable
        {
            const int Down = 4;
            readonly Rectangle _card;
            readonly Bitmap _buf;
            readonly int _bw, _bh;
            readonly int[] _px, _tmp;
            readonly ImageAttributes _attrs;

            public SoftLayer(Rectangle card)
            {
                _card = card;
                _bw = Math.Max(4, (card.Width + Down - 1) / Down);
                _bh = Math.Max(4, (card.Height + Down - 1) / Down);
                _buf = new Bitmap(_bw, _bh, PixelFormat.Format32bppPArgb);
                _px = new int[_bw * _bh];
                _tmp = new int[_bw * _bh];
                _attrs = new ImageAttributes();
                _attrs.SetWrapMode(WrapMode.TileFlipXY);
            }

            public void Paint(Graphics target, int blur, Action<Graphics> draw)
            {
                using (var bg = Graphics.FromImage(_buf))
                {
                    bg.Clear(Color.Transparent);
                    bg.SmoothingMode = SmoothingMode.AntiAlias;
                    bg.CompositingQuality = CompositingQuality.HighQuality;
                    bg.ScaleTransform(1f / Down, 1f / Down);
                    bg.TranslateTransform(-_card.Left, -_card.Top);
                    draw(bg);
                }
                if (blur > 0)
                {
                    var rect = new Rectangle(0, 0, _bw, _bh);
                    var data = _buf.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppPArgb);
                    try
                    {
                        Marshal.Copy(data.Scan0, _px, 0, _px.Length);
                        // Two box passes approximate a gaussian on premultiplied pixels.
                        BoxBlur(_px, _tmp, _bw, _bh, blur);
                        BoxBlur(_px, _tmp, _bw, _bh, blur);
                        Marshal.Copy(_px, 0, data.Scan0, _px.Length);
                    }
                    finally
                    {
                        _buf.UnlockBits(data);
                    }
                }
                var oldInterp = target.InterpolationMode;
                var oldOffset = target.PixelOffsetMode;
                target.InterpolationMode = InterpolationMode.HighQualityBilinear;
                target.PixelOffsetMode = PixelOffsetMode.HighQuality;
                target.DrawImage(_buf, new Rectangle(_card.Left, _card.Top, _bw * Down, _bh * Down), 0, 0, _bw, _bh, GraphicsUnit.Pixel, _attrs);
                target.InterpolationMode = oldInterp;
                target.PixelOffsetMode = oldOffset;
            }

            static void BoxBlur(int[] px, int[] tmp, int w, int h, int r)
            {
                var n = 2 * r + 1;
                for (int y = 0; y < h; y++)
                {
                    var row = y * w;
                    for (int x = 0; x < w; x++)
                    {
                        int a = 0, rr = 0, gg = 0, bb = 0;
                        for (int k = -r; k <= r; k++)
                        {
                            var xx = x + k < 0 ? 0 : (x + k >= w ? w - 1 : x + k);
                            var p = px[row + xx];
                            a += (p >> 24) & 255; rr += (p >> 16) & 255; gg += (p >> 8) & 255; bb += p & 255;
                        }
                        tmp[row + x] = ((a / n) << 24) | ((rr / n) << 16) | ((gg / n) << 8) | (bb / n);
                    }
                }
                for (int x = 0; x < w; x++)
                {
                    for (int y = 0; y < h; y++)
                    {
                        int a = 0, rr = 0, gg = 0, bb = 0;
                        for (int k = -r; k <= r; k++)
                        {
                            var yy = y + k < 0 ? 0 : (y + k >= h ? h - 1 : y + k);
                            var p = tmp[yy * w + x];
                            a += (p >> 24) & 255; rr += (p >> 16) & 255; gg += (p >> 8) & 255; bb += p & 255;
                        }
                        px[y * w + x] = ((a / n) << 24) | ((rr / n) << 16) | ((gg / n) << 8) | (bb / n);
                    }
                }
            }

            public void Dispose()
            {
                _buf.Dispose();
                _attrs.Dispose();
            }
        }

        public static string Normalize(string visual)
        {
            var v = (visual ?? DefaultId).Trim().ToLowerInvariant();
            switch (v)
            {
                case "ripple-bloom":
                case "edge-glow":
                case "breath-fade":
                case "comet-trail":
                case "metal-sweep":
                case "triangle-bloom":
                case "veil-clear":
                case "cloud-burst":
                    return v;
                case "dew-well":
                case "crescent-lift":
                case "thread-snap":
                case "curtain-sway":
                case "comet-wake":
                case "arc-return":
                case "mist-bloom":
                case "focus-snap":
                case "aurora-veil":
                case "bounce-glow":
                case "drift-wake":
                case "ripple-ring":
                    return DefaultId;
                default:
                    return DefaultId;
            }
        }

        public static void Apply(Graphics g, string visual, double progress, Rectangle cardRect, Color primary, Color accent, Color background, bool important)
        {
            var t = Clamp01(progress);
            if (t >= 0.88 || cardRect.Width < 8 || cardRect.Height < 8) return;
            var pal = MakePalette(primary, accent, background, important);
            var state = g.Save();
            try
            {
                using (var clip = ToastForm.RoundRect(cardRect, 20))
                using (var layer = new SoftLayer(cardRect))
                {
                    g.SetClip(clip);
                    g.CompositingQuality = CompositingQuality.HighQuality;
                    switch (Normalize(visual))
                    {
                        case "edge-glow": DrawEdgeGlow(g, layer, t, cardRect, pal); break;
                        case "breath-fade": DrawBreathFade(g, layer, t, cardRect, pal); break;
                        case "comet-trail": DrawCometTrail(g, layer, t, cardRect, pal); break;
                        case "metal-sweep": DrawMetalSweep(g, layer, t, cardRect, pal); break;
                        case "triangle-bloom": DrawTriangleBloom(g, layer, t, cardRect, pal); break;
                        case "veil-clear": DrawVeilClear(g, layer, t, cardRect, pal); break;
                        case "cloud-burst": DrawCloudBurst(g, layer, t, cardRect, pal); break;
                        default: DrawRippleBloom(g, layer, t, cardRect, pal); break;
                    }
                }
            }
            catch (Exception ex)
            {
                if (!_entranceFaulted)
                {
                    _entranceFaulted = true;
                    try { Console.Error.WriteLine("[notification-hub helper] entrance light failed: " + ex.Message); } catch { }
                }
            }
            finally
            {
                g.Restore(state);
            }
        }

        static LightPalette MakePalette(Color primary, Color accent, Color background, bool important)
        {
            var light = Luminance(background) > 0.45;
            if (light) accent = ToastForm.Blend(accent, primary, 0.35);
            if (important)
            {
                accent = ToastForm.Blend(accent, Color.White, 0.10);
                primary = ToastForm.Blend(primary, Color.White, 0.06);
            }
            return new LightPalette
            {
                Primary = primary,
                Accent = accent,
                White = Color.White,
                // On paper a white heart vanishes; keep the heart in the accent family there.
                Heart = light ? ToastForm.Blend(accent, primary, 0.30) : ToastForm.Blend(accent, Color.White, 0.58),
                WhiteMix = light ? 0.08 : 0.32,
                Boost = important ? 1.25 : 1.0,
                LightBg = light,
            };
        }

        // 波纹绽放: soft ripples bloom outward from the card center
        static void DrawRippleBloom(Graphics g, SoftLayer layer, double t, Rectangle card, LightPalette pal)
        {
            var a = Bell(t, 0, 0.28, 0.82) * pal.Boost;
            if (a <= 0.01) return;
            var grow = EaseOutCubic(Clamp01(t / 0.68));
            var w = card.Width; var h = card.Height;
            var cx = card.Left + 0.50f * w;
            var cy = card.Top + 0.50f * h;
            var rx = (float)Lerp(0.08, 0.72, grow) * w;
            var ry = (float)Lerp(0.12, 0.88, grow) * h;
            var outer = ToastForm.Blend(pal.Primary, pal.Accent, 0.42);
            layer.Paint(g, 5, bg =>
            {
                FillSoft(bg, outer, 0.26 * a, cx, cy, rx * 1.10f, ry * 1.08f);
                FillSoft(bg, pal.Accent, 0.36 * a, cx, cy, rx * 0.72f, ry * 0.70f);
                FillSoft(bg, pal.Heart, 0.52 * a * (1.0 - 0.55 * grow), cx, cy, rx * 0.38f, ry * 0.36f);
            });
        }

        // 边缘微光: soft glow traces the card's inner perimeter
        static void DrawEdgeGlow(Graphics g, SoftLayer layer, double t, Rectangle card, LightPalette pal)
        {
            var a = Bell(t, 0, 0.32, 0.80) * pal.Boost;
            if (a <= 0.01) return;
            var fade = EaseOutCubic(Clamp01(t / 0.70));
            var w = card.Width; var h = card.Height;
            var inset = (float)Lerp(28, 16, fade);
            var thickness = (float)Lerp(32, 18, fade);
            layer.Paint(g, 4, bg =>
            {
                DrawEdgeGlowSide(bg, pal.Primary, 0.28 * a, card.Left + inset, card.Top + inset, card.Left + inset, card.Bottom - inset, thickness);
                DrawEdgeGlowSide(bg, pal.Accent, 0.32 * a, card.Left + inset, card.Top + inset, card.Right - inset, card.Top + inset, thickness);
                DrawEdgeGlowSide(bg, pal.Accent, 0.32 * a, card.Right - inset, card.Top + inset, card.Right - inset, card.Bottom - inset, thickness);
                DrawEdgeGlowSide(bg, pal.Primary, 0.28 * a, card.Left + inset, card.Bottom - inset, card.Right - inset, card.Bottom - inset, thickness);
            });
        }

        static void DrawEdgeGlowSide(Graphics g, Color c, double alpha, float x1, float y1, float x2, float y2, float thickness)
        {
            if (alpha <= 0.004 || thickness < 1f) return;
            var dx = x2 - x1; var dy = y2 - y1;
            var len = (float)Math.Sqrt(dx * dx + dy * dy);
            if (len < 1f) return;
            var nx = -dy / len; var ny = dx / len;
            var steps = new[] { 1.0f, 0.62f, 0.32f };
            var share = new[] { 0.28, 0.34, 0.38 };
            for (int i = 0; i < 3; i++)
            {
                var t = thickness * steps[i];
                using (var pen = new Pen(WithAlpha(c, alpha * share[i]), t * 2f))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    g.DrawLine(pen, x1 + nx * t, y1 + ny * t, x2 + nx * t, y2 + ny * t);
                }
            }
        }

        // 呼吸淡入: the whole card breathes from accent fog to transparency
        static void DrawBreathFade(Graphics g, SoftLayer layer, double t, Rectangle card, LightPalette pal)
        {
            var a = Bell(t, 0, 0.20, 0.76) * pal.Boost;
            if (a <= 0.01) return;
            var fade = EaseOutCubic(Clamp01(t / 0.62));
            var w = card.Width; var h = card.Height;
            var cx = card.Left + 0.50f * w;
            var cy = card.Top + 0.50f * h;
            var rx = (float)Lerp(0.48, 0.86, fade) * w;
            var ry = (float)Lerp(0.52, 0.92, fade) * h;
            var fog = ToastForm.Blend(pal.Accent, pal.Primary, 0.35);
            layer.Paint(g, 6, bg =>
            {
                FillSoft(bg, fog, 0.38 * a * (1.0 - 0.70 * fade), cx, cy, rx, ry);
                FillSoft(bg, pal.Accent, 0.30 * a * (1.0 - 0.80 * fade), cx, cy, rx * 0.72f, ry * 0.68f);
            });
        }

        // 彗尾划过: a soft comet trails from top-right to bottom-left, following the slide-in
        static void DrawCometTrail(Graphics g, SoftLayer layer, double t, Rectangle card, LightPalette pal)
        {
            var a = Bell(t, 0.38, 0.28, 0.82) * pal.Boost;
            if (a <= 0.01) return;
            var w = card.Width; var h = card.Height;
            var p0 = new PointF(card.Right + 16f, card.Top - 12f);
            var p1 = new PointF(card.Left + 0.62f * w, card.Top + 0.38f * h);
            var p2 = new PointF(card.Left + 0.18f * w, card.Bottom - 8f);
            var head = 0.94 * EaseOutCubic(Clamp01(t / 0.60));
            var tail = Math.Max(0, head - 0.48);
            const int n = 16;
            layer.Paint(g, 4, bg =>
            {
                for (int i = 0; i <= n; i++)
                {
                    var k = i / (double)n;
                    var pt = Quad(p0, p1, p2, (float)Lerp(tail, head, k));
                    var r = (float)Lerp(0.015, 0.068, k * k) * w;
                    var col = ToastForm.Blend(pal.Primary, pal.Accent, k * 0.62);
                    FillSoft(bg, col, 0.30 * a * Math.Pow(k, 1.4), pt.X, pt.Y, r * 1.8f, r * 0.85f);
                }
                var hp = Quad(p0, p1, p2, (float)head);
                FillSoft(bg, pal.Heart, 0.68 * a, hp.X, hp.Y, 0.048f * w, 0.14f * h);
            });
        }

        // 金属掠光: a skewed parallelogram sweep from right to left, like polished metal rotating under light
        static void DrawMetalSweep(Graphics g, SoftLayer layer, double t, Rectangle card, LightPalette pal)
        {
            var a = Bell(t, 0, 0.38, 0.82) * pal.Boost;
            if (a <= 0.01) return;
            var w = card.Width; var h = card.Height;
            var pos = EaseInOut(Clamp01(t / 0.72));
            var x = card.Left + (float)Lerp(1.15, -0.25, pos) * w;
            var skew = 0.55f;
            var hw = (float)Lerp(0.28, 0.35, Math.Sin(pos * Math.PI)) * w;
            var colorShift = pos;
            var col = ToastForm.Blend(pal.Primary, pal.Accent, colorShift);
            layer.Paint(g, 5, bg =>
            {
                DrawSkewedBar(bg, col, 0.42 * a, x, card.Top, hw * 1.4f, h, skew);
                DrawSkewedBar(bg, pal.Heart, 0.58 * a, x, card.Top + h * 0.15f, hw * 0.68f, h * 0.70f, skew);
            });
        }

        static void DrawSkewedBar(Graphics g, Color c, double alpha, float cx, float top, float halfW, float height, float skew)
        {
            if (alpha <= 0.004 || halfW < 1f || height < 1f) return;
            var steps = new[] { 1.0f, 0.68f, 0.38f };
            var share = new[] { 0.28, 0.35, 0.37 };
            for (int i = 0; i < 3; i++)
            {
                var w = halfW * steps[i];
                var pts = new PointF[4];
                pts[0] = new PointF(cx - w + skew * height, top);
                pts[1] = new PointF(cx + w + skew * height, top);
                pts[2] = new PointF(cx + w, top + height);
                pts[3] = new PointF(cx - w, top + height);
                using (var b = new SolidBrush(WithAlpha(c, alpha * share[i])))
                    g.FillPolygon(b, pts);
            }
        }

        // 三角绽放: soft dots arranged into upright and inverted triangles, grow to seamless tiling, then fade
        static void DrawTriangleBloom(Graphics g, SoftLayer layer, double t, Rectangle card, LightPalette pal)
        {
            var a = Bell(t, 0, 0.34, 0.84) * pal.Boost;
            if (a <= 0.01) return;
            var w = card.Width; var h = card.Height;
            var grow = EaseOutCubic(Clamp01(t / 0.68));
            var spacing = (float)Lerp(48, 72, grow);
            var r = (float)Lerp(4, spacing * 0.45f, grow);
            layer.Paint(g, 4, bg =>
            {
                var rows = (int)(h / (spacing * 0.866f)) + 2;
                var cols = (int)(w / spacing) + 2;
                for (int row = 0; row < rows; row++)
                {
                    for (int col = 0; col < cols; col++)
                    {
                        var even = row % 2 == 0;
                        var x = card.Left + col * spacing + (even ? 0 : spacing * 0.5f);
                        var y = card.Top + row * spacing * 0.866f;
                        var colorBlend = ((row + col) % 3) / 3.0;
                        var dotColor = ToastForm.Blend(pal.Primary, pal.Accent, colorBlend);
                        FillSoft(bg, dotColor, 0.48 * a, x, y, r, r);
                    }
                }
            });
        }

        // 渐变揭幕: a solid veil covers the card, then fades out from right to left with a soft gradient
        static void DrawVeilClear(Graphics g, SoftLayer layer, double t, Rectangle card, LightPalette pal)
        {
            // Solid cover first. The clear edge then travels from the right edge toward the left.
            // Only the moving frontier is a gradient; the still-covered part stays opaque.
            var clear = EaseOutCubic(Clamp01(t / 0.78));
            if (clear >= 0.999) return;
            var veil = ToastForm.Blend(pal.Primary, pal.Accent, clear * 0.18);
            var cover = Color.FromArgb(255, veil.R, veil.G, veil.B);
            var feather = Math.Max(36f, card.Width * 0.28f);
            var edge = card.Right - (float)(clear * (card.Width + feather));
            if (edge > card.Left)
            {
                var solidRight = Math.Min(card.Right, edge);
                var solidWidth = solidRight - card.Left;
                if (solidWidth > 0.5f)
                {
                    using (var brush = new SolidBrush(cover))
                        g.FillRectangle(brush, card.Left, card.Top, solidWidth, card.Height);
                }
            }
            var bandLeft = edge;
            var bandRight = edge + feather;
            if (bandRight > card.Left && bandLeft < card.Right)
            {
                var x1 = Math.Max(card.Left, bandLeft);
                var x2 = Math.Min(card.Right, bandRight);
                if (x2 - x1 > 0.5f)
                {
                    // GDI+ rejects WrapMode.Clamp on this brush and kills the helper.
                    // Short vertical strips keep the edge a gradient without that call.
                    const int steps = 28;
                    for (int i = 0; i < steps; i++)
                    {
                        var u0 = i / (float)steps;
                        var u1 = (i + 1) / (float)steps;
                        var left = Math.Max(card.Left, bandLeft + feather * u0);
                        var right = Math.Min(card.Right, bandLeft + feather * u1);
                        if (right - left < 0.2f) continue;
                        var alpha = (int)Math.Round(255 * (1.0 - (u0 + u1) * 0.5));
                        if (alpha <= 0) continue;
                        using (var brush = new SolidBrush(Color.FromArgb(alpha, veil.R, veil.G, veil.B)))
                            g.FillRectangle(brush, left, card.Top, right - left, card.Height);
                    }
                }
            }
        }

        // 云雾缭绕: cloud-shaped layers with recognizable contours instantly appear, then slowly drift and fade
        static void DrawCloudBurst(Graphics g, SoftLayer layer, double t, Rectangle card, LightPalette pal)
        {
            var w = card.Width; var h = card.Height;
            var appear = EaseOutCubic(Clamp01(t / 0.32));
            var fade = t < 0.28 ? 0 : Clamp01((t - 0.28) / 0.60);
            var strength = (1.0 - EaseOutCubic(fade)) * appear;
            if (strength <= 0.01) return;
            var a = strength * pal.Boost;
            var grow = (float)Lerp(0.86, 1.0, appear);
            // Drawn on the card itself. The quarter-resolution blur was melting the contour into blobs.
            DrawCloudShape(g, pal.Primary, 0.82 * a, card, w, h, fade, grow, 0.06f, 0.42f, 0.58f, 0.62f, -0.15f, 0.04f);
            DrawCloudShape(g, ToastForm.Blend(pal.Primary, pal.Accent, 0.42), 0.76 * a, card, w, h, fade, grow, 0.40f, 0.70f, 0.56f, 0.58f, 0.18f, -0.03f);
            DrawCloudShape(g, ToastForm.Blend(pal.Primary, pal.Accent, 0.70), 0.70 * a, card, w, h, fade, grow, 0.14f, 0.78f, 0.52f, 0.52f, 0.08f, 0.04f);
        }

        static void DrawCloudShape(Graphics bg, Color col, double alpha, Rectangle card, float w, float h, double fade, float grow, float startX, float baseY, float span, float heightScale, float driftX, float driftY)
        {
            if (alpha <= 0.004) return;
            var left = card.Left + (startX + (float)(driftX * fade)) * w;
            var bottom = card.Top + (baseY + (float)(driftY * fade)) * h;
            var sw = span * w;
            var sh = heightScale * h;
            var cx = left + sw * 0.5f;
            var cy = bottom - sh * 0.34f;
            sw *= grow;
            sh *= grow;
            left = cx - sw * 0.5f;
            bottom = cy + sh * 0.34f;
            using (var path = new GraphicsPath())
            {
                path.FillMode = FillMode.Winding;
                path.AddEllipse(left + 0.04f * sw, bottom - 0.36f * sh, 0.92f * sw, 0.40f * sh);
                path.AddEllipse(left + 0.00f * sw, bottom - 0.58f * sh, 0.40f * sw, 0.42f * sh);
                path.AddEllipse(left + 0.28f * sw, bottom - 0.86f * sh, 0.46f * sw, 0.56f * sh);
                path.AddEllipse(left + 0.58f * sw, bottom - 0.54f * sh, 0.38f * sw, 0.40f * sh);
                using (var brush = new SolidBrush(WithAlpha(col, alpha)))
                    bg.FillPath(brush, path);
            }
        }





        // A filled ellipse built from three nested solid layers; the blur pass melts
        // their steps into one smooth falloff.
        static void FillSoft(Graphics g, Color c, double alpha, float x, float y, float rx, float ry)
        {
            if (alpha <= 0.004 || rx < 0.8f || ry < 0.8f) return;
            var steps = new[] { 1.0f, 0.68f, 0.38f };
            var share = new[] { 0.30, 0.32, 0.38 };
            for (int i = 0; i < 3; i++)
            {
                using (var b = new SolidBrush(WithAlpha(c, alpha * share[i])))
                    g.FillEllipse(b, x - rx * steps[i], y - ry * steps[i], rx * 2f * steps[i], ry * 2f * steps[i]);
            }
        }

        // A hanging veil: wavy-edged vertical band, brightest near the top, fading downward.
        static void FillVeil(Graphics g, Color c, double alpha, float cx, float halfW, float top, float bottom, float wave, double phase)
        {
            if (alpha <= 0.004) return;
            const int n = 10;
            var pts = new PointF[(n + 1) * 2];
            for (int i = 0; i <= n; i++)
            {
                var k = i / (float)n;
                var y = top + (bottom - top) * k;
                var off = (float)(Math.Sin(phase + k * 2.6) * wave);
                var hw = halfW * (0.75f + 0.5f * k);
                pts[i] = new PointF(cx + off - hw, y);
                pts[pts.Length - 1 - i] = new PointF(cx + off + hw, y);
            }
            using (var path = new GraphicsPath())
            using (var brush = new LinearGradientBrush(new PointF(0, top - 1), new PointF(0, bottom + 1), WithAlpha(c, alpha), WithAlpha(c, alpha * 0.10)))
            {
                path.AddPolygon(pts);
                g.FillPath(brush, path);
            }
        }

        static PointF Quad(PointF p0, PointF p1, PointF p2, float u)
        {
            var s = 1f - u;
            return new PointF(s * s * p0.X + 2f * s * u * p1.X + u * u * p2.X, s * s * p0.Y + 2f * s * u * p1.Y + u * u * p2.Y);
        }

        static double BackOut(double t, double s)
        {
            t = Clamp01(t) - 1;
            return 1 + (s + 1) * t * t * t + s * t * t;
        }

        static Color ShiftHue(Color c, double degrees)
        {
            double r = c.R / 255.0, g = c.G / 255.0, b = c.B / 255.0;
            double max = Math.Max(r, Math.Max(g, b));
            double min = Math.Min(r, Math.Min(g, b));
            double l = (max + min) / 2.0;
            double d = max - min;
            double h = 0, s = 0;
            if (d > 1e-6)
            {
                s = l > 0.5 ? d / (2.0 - max - min) : d / (max + min);
                if (max == r) h = (g - b) / d + (g < b ? 6 : 0);
                else if (max == g) h = (b - r) / d + 2;
                else h = (r - g) / d + 4;
                h /= 6.0;
            }
            h = (h + degrees / 360.0) % 1.0;
            if (h < 0) h += 1;
            return Hsl(h, s, l);
        }

        static Color Hsl(double h, double s, double l)
        {
            if (s <= 1e-6)
            {
                var gray = (int)Math.Round(l * 255);
                return Color.FromArgb(gray, gray, gray);
            }
            double q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            double p = 2 * l - q;
            return Color.FromArgb(Hue(p, q, h + 1.0 / 3.0), Hue(p, q, h), Hue(p, q, h - 1.0 / 3.0));
        }

        static int Hue(double p, double q, double t)
        {
            t = (t + 1) % 1;
            if (t < 0) t += 1;
            double v;
            if (t < 1.0 / 6.0) v = p + (q - p) * 6 * t;
            else if (t < 0.5) v = q;
            else if (t < 2.0 / 3.0) v = p + (q - p) * (2.0 / 3.0 - t) * 6;
            else v = p;
            return (int)Math.Round(Math.Max(0, Math.Min(1, v)) * 255);
        }

        static double Luminance(Color c)
        {
            double Ch(int v)
            {
                var s = v / 255.0;
                return s <= 0.03928 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4);
            }
            return 0.2126 * Ch(c.R) + 0.7152 * Ch(c.G) + 0.0722 * Ch(c.B);
        }

        static Color WithAlpha(Color c, double alpha)
        {
            var a = (int)Math.Round(Math.Max(0, Math.Min(1, alpha)) * 255);
            return Color.FromArgb(a, c.R, c.G, c.B);
        }

        static double Clamp01(double t) { return Math.Max(0, Math.Min(1, t)); }
        static double ClampRange(double t, double a, double b) { return Math.Max(a, Math.Min(b, t)); }
        static double Lerp(double a, double b, double t) { return a + (b - a) * t; }
        static double EaseOutCubic(double t) { t = Clamp01(t); return 1 - Math.Pow(1 - t, 3); }
        static double EaseInCubic(double t) { t = Clamp01(t); return t * t * t; }
        static double EaseInOut(double t)
        {
            t = Clamp01(t);
            return t < 0.5 ? 2 * t * t : 1 - Math.Pow(-2 * t + 2, 2) / 2;
        }
        static double EaseOutExpo(double t)
        {
            t = Clamp01(t);
            return t >= 1 ? 1 : 1 - Math.Pow(2, -10 * t);
        }
        static double Rise(double t, double dur) { return EaseOutCubic(Clamp01(t / Math.Max(0.001, dur))); }
        static double Bell(double t, double start, double peak, double end)
        {
            if (t <= peak) return Lerp(start, 1, EaseOutCubic(peak <= 0 ? 1 : t / peak));
            var span = end - peak;
            var u = Clamp01(span <= 0 ? 1 : (t - peak) / span);
            return Math.Pow(1 - EaseInCubic(u), 1.45);
        }
    }
}
