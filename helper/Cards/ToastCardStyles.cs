using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace NotificationHubToast
{
    internal static class ToastCardStyles
    {
        internal static void DrawSakuraStormCard(Graphics g, Rectangle rect, GraphicsPath path, Color primary, Color accent, bool important, int borderAlpha)
        {
            var top = ToastForm.Blend(Color.FromArgb(48, 12, 42), primary, 0.45);
            var bottom = ToastForm.Blend(Color.FromArgb(80, 18, 58), accent, 0.38);
            using (var bg = new LinearGradientBrush(rect, Color.FromArgb(246, top), Color.FromArgb(238, bottom), 18f))
            using (var border = new Pen(Color.FromArgb(Math.Min(238, borderAlpha + 42), ToastForm.Blend(Color.White, primary, 0.36)), important ? 1.9f : 1.25f))
            {
                g.FillPath(bg, path);
                var state = g.Save();
                g.SetClip(path);
                using (var bloom = new SolidBrush(Color.FromArgb(important ? 74 : 52, ToastForm.Blend(Color.White, primary, 0.28))))
                using (var blush = new SolidBrush(Color.FromArgb(important ? 64 : 42, ToastForm.Blend(Color.FromArgb(255, 164, 206), accent, 0.24))))
                using (var petal = new SolidBrush(Color.FromArgb(important ? 160 : 126, ToastForm.Blend(Color.White, primary, 0.38))))
                using (var streak = new Pen(Color.FromArgb(important ? 112 : 78, ToastForm.Blend(Color.White, accent, 0.28)), 2.0f))
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
                using (var edge = new Pen(Color.FromArgb(important ? 150 : 112, ToastForm.Blend(Color.White, primary, 0.46)), 1.2f))
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

        internal static void DrawObsidianCard(Graphics g, Rectangle rect, GraphicsPath path, Color primary, Color accent, bool important, int borderAlpha)
        {
            var gold = ToastForm.Blend(Color.FromArgb(245, 194, 90), primary, 0.28);
            using (var bg = new LinearGradientBrush(rect, Color.FromArgb(250, 8, 9, 13), Color.FromArgb(244, 23, 20, 18), 42f))
            using (var border = new Pen(Color.FromArgb(Math.Min(245, borderAlpha + 62), gold), important ? 2.0f : 1.35f))
            {
                g.FillPath(bg, path);
                var state = g.Save();
                g.SetClip(path);
                using (var glow = new SolidBrush(Color.FromArgb(important ? 62 : 42, gold)))
                using (var gearPen = new Pen(Color.FromArgb(important ? 116 : 86, gold), 1.0f))
                using (var linePen = new Pen(Color.FromArgb(important ? 92 : 66, ToastForm.Blend(Color.White, gold, 0.16)), 1.1f))
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
                using (var accentPath = ToastForm.RoundRect(new Rectangle(rect.Left, rect.Top, 6, rect.Height), 10))
                    g.FillPath(accentBar, accentPath);
                g.Restore(state);
                g.DrawPath(border, path);
            }
        }

        internal static void DrawHologramCard(Graphics g, Rectangle rect, GraphicsPath path, Color primary, Color accent, bool important, int borderAlpha)
        {
            var cyan = ToastForm.Blend(Color.FromArgb(94, 255, 234), primary, 0.26);
            var violet = ToastForm.Blend(Color.FromArgb(174, 130, 255), accent, 0.28);
            using (var bg = new LinearGradientBrush(rect, Color.FromArgb(214, ToastForm.Blend(Color.FromArgb(12, 18, 34), primary, 0.20)), Color.FromArgb(194, ToastForm.Blend(Color.FromArgb(16, 8, 32), accent, 0.22)), 18f))
            using (var border = new Pen(Color.FromArgb(Math.Min(230, borderAlpha + 34), ToastForm.Blend(Color.White, cyan, 0.22)), important ? 1.7f : 1.1f))
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

        internal static void DrawPaperCard(Graphics g, Rectangle rect, GraphicsPath path, Color primary, Color accent, bool important, int borderAlpha)
        {
            var paperTop = ToastForm.Blend(Color.FromArgb(255, 247, 231), primary, 0.10);
            var paperBottom = ToastForm.Blend(Color.FromArgb(246, 226, 202), accent, 0.12);
            using (var bg = new LinearGradientBrush(rect, Color.FromArgb(250, paperTop), Color.FromArgb(246, paperBottom), 90f))
            using (var border = new Pen(Color.FromArgb(Math.Min(210, borderAlpha + 10), ToastForm.Blend(Color.FromArgb(130, 92, 68), primary, 0.20)), important ? 1.7f : 1.0f))
            {
                g.FillPath(bg, path);
                var state = g.Save();
                g.SetClip(path);
                using (var fiber = new Pen(Color.FromArgb(28, 120, 82, 60), 1.0f))
                using (var wash = new SolidBrush(Color.FromArgb(34, ToastForm.Blend(Color.White, primary, 0.22))))
                using (var accentLine = new Pen(Color.FromArgb(118, ToastForm.Blend(primary, accent, 0.46)), 2.0f))
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
    }
}
