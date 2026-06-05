using System;

namespace NotificationHubToast
{
    struct EntranceFrame
    {
        public double XEase;
        public int YOffset;
        public double Opacity;

        public EntranceFrame(double xEase, int yOffset, double opacity)
        {
            XEase = xEase;
            YOffset = yOffset;
            Opacity = opacity;
        }
    }

    static class EntranceMotionRegistry
    {
        public static string Normalize(string motion)
        {
            var m = (motion ?? "spring").Trim().ToLowerInvariant();
            if (m == "magnet" || m == "paper" || m == "spring") return m;
            return "spring";
        }

        public static EntranceFrame Apply(string motion, double progress, double overshoot)
        {
            var p = Clamp01(progress);
            var m = Normalize(motion);

            if (m == "magnet")
            {
                var slowApproach = 0.42 * EaseOutCubic(Math.Min(1.0, p / 0.58));
                var snapProgress = Math.Max(0.0, (p - 0.42) / 0.58);
                var snap = 0.58 * (1.0 - Math.Pow(1.0 - snapProgress, 5.5));
                return new EntranceFrame(
                    Math.Min(1.0, slowApproach + snap),
                    0,
                    Math.Min(1.0, p * 1.95)
                );
            }

            if (m == "paper")
            {
                var ease = 1.0 - Math.Pow(1.0 - p, 2.15);
                return new EntranceFrame(
                    ease,
                    0,
                    Math.Min(1.0, p * 1.18)
                );
            }

            return new EntranceFrame(
                EaseOutBack(p, overshoot),
                0,
                Math.Min(1.0, p * 1.55)
            );
        }

        static double Clamp01(double t)
        {
            return Math.Max(0, Math.Min(1, t));
        }

        static double EaseOutCubic(double t)
        {
            t = Clamp01(t);
            return 1 - Math.Pow(1 - t, 3);
        }

        static double EaseOutBack(double t, double overshoot)
        {
            t = Clamp01(t);
            var c1 = overshoot;
            var c3 = c1 + 1;
            return 1 + c3 * Math.Pow(t - 1, 3) + c1 * Math.Pow(t - 1, 2);
        }
    }
}
