using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace NotificationHubToast
{
    internal static class ParticleShapePainter
    {
        internal static void Draw(Graphics g, Particle pt)
        {
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
                        using (var starDot = new SolidBrush(Blend(pt.Color, Color.White, 0.82)))
                        {
                            g.FillEllipse(moon, -8.0f, -11.0f, 16.0f, 22.0f);
                            var cutMode = g.CompositingMode;
                            g.CompositingMode = CompositingMode.SourceCopy;
                            using (var cut = new SolidBrush(Color.Transparent))
                                g.FillEllipse(cut, -2.0f, -12.0f, 16.0f, 22.0f);
                            g.CompositingMode = cutMode;
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
        }

        private static Color Blend(Color a, Color b, double amount)
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
