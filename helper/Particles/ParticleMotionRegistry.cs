using System;

namespace NotificationHubToast
{
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
}
