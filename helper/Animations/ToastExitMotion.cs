using System;

namespace NotificationHubToast
{
    static class ToastExitMotion
    {
        // Opposite of the ease-out arrival: the card came in from the right, so it leaves back to the right.
        // No upward component. Ease-in so it accelerates away instead of flying off on a diagonal.
        public static float ReverseApproach(double p, float travel)
        {
            p = Math.Max(0, Math.Min(1, p));
            return travel * (float)(p * p);
        }
    }
}
