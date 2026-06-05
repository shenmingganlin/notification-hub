using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace NotificationHubToast
{
    static class ParticleGeometryCache
    {
        public static readonly GraphicsPath SakuraPetal = CreateSakuraPetalPath();
        public static readonly GraphicsPath SakuraShine = CreateSakuraShinePath();
        public static readonly GraphicsPath WindmillBlade = CreateWindmillBladePath();
        public static readonly GraphicsPath WindmillInner = CreateWindmillInnerPath();
        public static readonly GraphicsPath ButterflyLeftTop = CreateButterflyLeftTopPath();
        public static readonly GraphicsPath ButterflyRightTop = CreateButterflyRightTopPath();
        public static readonly GraphicsPath ButterflyLeftLow = CreateButterflyLeftLowPath();
        public static readonly GraphicsPath ButterflyRightLow = CreateButterflyRightLowPath();
        public static readonly GraphicsPath ButterflyLeftInner = CreateButterflyLeftInnerPath();
        public static readonly GraphicsPath ButterflyRightInner = CreateButterflyRightInnerPath();
        public static readonly GraphicsPath Star = CreateStarPath();
        public static readonly GraphicsPath Shard = CreateShardPath();
        public static readonly GraphicsPath Leaf = CreateLeafPath();
        public static readonly GraphicsPath Ember = CreateEmberPath();

        static GraphicsPath CreateSakuraPetalPath()
        {
            var path = new GraphicsPath();
            path.StartFigure();
            path.AddBezier(0.0f, -1.0f, -5.8f, -5.2f, -6.1f, -11.2f, -1.7f, -13.7f);
            path.AddBezier(-1.7f, -13.7f, -0.7f, -11.8f, 0.0f, -11.1f, 1.7f, -13.7f);
            path.AddBezier(1.7f, -13.7f, 6.1f, -11.2f, 5.8f, -5.2f, 0.0f, -1.0f);
            path.CloseFigure();
            return path;
        }

        static GraphicsPath CreateSakuraShinePath()
        {
            var path = new GraphicsPath();
            path.StartFigure();
            path.AddBezier(0.0f, -2.5f, -1.8f, -6.2f, -1.3f, -9.4f, 0.0f, -11.0f);
            path.AddBezier(0.0f, -11.0f, 1.3f, -9.4f, 1.8f, -6.2f, 0.0f, -2.5f);
            path.CloseFigure();
            return path;
        }

        static GraphicsPath CreateWindmillBladePath()
        {
            var path = new GraphicsPath();
            path.StartFigure();
            path.AddBezier(0.0f, 0.0f, 5.8f, -2.6f, 10.6f, -7.8f, 3.2f, -14.2f);
            path.AddBezier(3.2f, -14.2f, -0.8f, -10.0f, -2.9f, -4.0f, 0.0f, 0.0f);
            path.CloseFigure();
            return path;
        }

        static GraphicsPath CreateWindmillInnerPath()
        {
            var path = new GraphicsPath();
            path.StartFigure();
            path.AddBezier(1.2f, -1.2f, 4.8f, -3.0f, 7.4f, -6.4f, 3.0f, -10.8f);
            path.AddBezier(3.0f, -10.8f, 1.0f, -7.4f, -0.2f, -3.1f, 1.2f, -1.2f);
            path.CloseFigure();
            return path;
        }

        static GraphicsPath CreateButterflyLeftTopPath()
        {
            var path = new GraphicsPath();
            path.AddBezier(0, -2, -7, -13, -17, -8, -13, 2);
            path.AddBezier(-13, 2, -7, 3, -3, 2, 0, -2);
            return path;
        }

        static GraphicsPath CreateButterflyRightTopPath()
        {
            var path = new GraphicsPath();
            path.AddBezier(0, -2, 7, -13, 17, -8, 13, 2);
            path.AddBezier(13, 2, 7, 3, 3, 2, 0, -2);
            return path;
        }

        static GraphicsPath CreateButterflyLeftLowPath()
        {
            var path = new GraphicsPath();
            path.AddBezier(-1, 1, -8, 1, -12, 8, -5, 10);
            path.AddBezier(-5, 10, -2, 7, 0, 4, -1, 1);
            return path;
        }

        static GraphicsPath CreateButterflyRightLowPath()
        {
            var path = new GraphicsPath();
            path.AddBezier(1, 1, 8, 1, 12, 8, 5, 10);
            path.AddBezier(5, 10, 2, 7, 0, 4, 1, 1);
            return path;
        }

        static GraphicsPath CreateButterflyLeftInnerPath()
        {
            var path = new GraphicsPath();
            path.AddBezier(-2, -2, -7, -9, -12, -6, -9, 0);
            path.AddBezier(-9, 0, -6, 1, -3, 1, -2, -2);
            return path;
        }

        static GraphicsPath CreateButterflyRightInnerPath()
        {
            var path = new GraphicsPath();
            path.AddBezier(2, -2, 7, -9, 12, -6, 9, 0);
            path.AddBezier(9, 0, 6, 1, 3, 1, 2, -2);
            return path;
        }

        static GraphicsPath CreateStarPath()
        {
            var path = new GraphicsPath();
            var points = new PointF[10];
            for (int i = 0; i < points.Length; i++)
            {
                var a = -Math.PI / 2.0 + i * Math.PI / 5.0;
                var rr = i % 2 == 0 ? 11.5f : 4.8f;
                points[i] = new PointF((float)Math.Cos(a) * rr, (float)Math.Sin(a) * rr);
            }
            path.AddPolygon(points);
            return path;
        }

        static GraphicsPath CreateShardPath()
        {
            var path = new GraphicsPath();
            path.StartFigure();
            path.AddLine(-2.5f, -13.0f, 9.5f, -2.0f);
            path.AddLine(4.0f, 11.0f, -7.5f, 5.0f);
            path.CloseFigure();
            return path;
        }

        static GraphicsPath CreateLeafPath()
        {
            var path = new GraphicsPath();
            path.StartFigure();
            path.AddBezier(0.0f, -12.0f, -9.5f, -5.2f, -8.0f, 6.8f, 0.0f, 11.0f);
            path.AddBezier(0.0f, 11.0f, 8.0f, 6.8f, 9.5f, -5.2f, 0.0f, -12.0f);
            path.CloseFigure();
            return path;
        }

        static GraphicsPath CreateEmberPath()
        {
            var path = new GraphicsPath();
            path.AddBezier(0.0f, -14.0f, -8.0f, -4.0f, -4.0f, 8.0f, 0.0f, 12.0f);
            path.AddBezier(0.0f, 12.0f, 8.0f, 6.0f, 6.0f, -5.0f, 0.0f, -14.0f);
            return path;
        }
    }
}
