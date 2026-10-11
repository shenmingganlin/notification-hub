using System.Drawing;

namespace NotificationHubToast
{
    sealed class Particle
    {
        public float X, Y, Vx, Vy, Ax, Ay, Rotation, Spin, Scale, WingPhase, Radius, LifeMs;
        public float BaseX, BaseY, AnchorX, AnchorY, Angle, AngularVelocity, OrbitRadius, Seed;
        public Color Color;
        public string Shape, Motion;
        public int BirthTick;
    }
}
