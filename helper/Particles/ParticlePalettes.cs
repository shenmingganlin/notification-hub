using System;
using System.Drawing;

namespace NotificationHubToast
{
    internal static class ParticlePalettes
    {
        internal static Color[] ForToast(string importance, string agentName, string sakuraTheme, string shape, string primaryHex, string accentHex)
        {
            var primary = ToastForm.ParseColor(primaryHex, Color.FromArgb(155, 124, 255));
            var accent = ToastForm.ParseColor(accentHex, primary);
            var soft = ToastForm.Blend(primary, accent, 0.50);
            var hot = ToastForm.Blend(primary, Color.White, 0.28);
            var glow = ToastForm.Blend(accent, Color.White, 0.34);
            var deep = ToastForm.Blend(ToastForm.Blend(primary, accent, 0.35), Color.FromArgb(20, 22, 48), 0.18);

            // Theme-derived palette: every dismiss particle now smells like the toast it came from.
            // A tiny importance lift keeps alerts punchy without overriding the user's selected colorway.
            if ((importance ?? "").ToLowerInvariant() == "urgent" || (importance ?? "").ToLowerInvariant() == "important")
            {
                var warning = Color.FromArgb(255, 205, 92);
                return new Color[]
                {
                    hot,
                    glow,
                    ToastForm.Blend(primary, warning, 0.22),
                    ToastForm.Blend(accent, warning, 0.18),
                    soft,
                    deep,
                    Color.White,
                };
            }

            return new Color[]
            {
                hot,
                glow,
                primary,
                accent,
                soft,
                ToastForm.Blend(primary, Color.White, 0.52),
                ToastForm.Blend(accent, Color.White, 0.48),
                deep,
            };
        }

        private static Color[] GetSakuraPalette(string importance, string agentName, string sakuraTheme)
        {
            var agent = (agentName ?? "").ToLowerInvariant();
            var imp = (importance ?? "").ToLowerInvariant();
            var theme = (sakuraTheme ?? "").ToLowerInvariant();

            // User-selected theme override (from config page)
            if (!string.IsNullOrEmpty(theme))
            {
                if (theme.Contains("sakurastorm") || theme.Contains("sakura-storm"))
                    return sakuraStormPalette();
                if (theme.Contains("blackgold") || theme.Contains("black-gold"))
                    return blackGoldPalette();
                if (theme.Contains("ember"))
                    return emberPalette();
                if (theme.Contains("moonlight"))
                    return moonlightPalette();
                if (theme.Contains("neonmint") || theme.Contains("neon-mint"))
                    return neonMintPalette();
                if (theme.Contains("hanako"))    
                    return defaultHanakoPalette();
                if (theme.Contains("butter"))
                    return butterPalette();
                if (theme.Contains("chatgpt") || theme.Contains("gpt"))
                    return chatgptPalette();
                if (theme.Contains("ming") || theme.Contains("rational"))
                    return mingPalette();
                if (theme.Contains("kong"))
                    return kongPalette();
                if (theme.Contains("urgent"))
                    return urgentPalette();
                if (theme.Contains("important"))
                    return importantPalette();
                if (theme.Contains("rainbow"))
                    return rainbowPalette();
            }

            // Agent-specific palettes (override importance)
            if (agent.Contains("butter"))
                return new Color[]
                {
                    Color.FromArgb(255, 230, 170),  // golden cream
                    Color.FromArgb(255, 240, 200),  // warm honey
                    Color.FromArgb(255, 220, 150),  // pale gold
                    Color.FromArgb(255, 235, 190),  // butter cream
                    Color.FromArgb(245, 225, 170),  // soft amber
                };
            if (agent.Contains("chatgpt") || agent.Contains("gpt"))
                return new Color[]
                {
                    Color.FromArgb(200, 220, 255),  // ice blue
                    Color.FromArgb(190, 210, 240),  // steel blue
                    Color.FromArgb(210, 225, 250),  // sky blue
                    Color.FromArgb(180, 200, 235),  // mist blue
                    Color.FromArgb(220, 230, 255),  // pale blue
                };
            if (agent.Contains("ming") || agent.Contains("rational"))
                return new Color[]
                {
                    Color.FromArgb(200, 180, 255),  // lavender purple
                    Color.FromArgb(180, 160, 240),  // violet
                    Color.FromArgb(210, 190, 250),  // soft purple
                    Color.FromArgb(190, 170, 235),  // lilac
                    Color.FromArgb(220, 200, 255),  // light purple
                };
            if (agent.Contains("kong"))
                return new Color[]
                {
                    Color.FromArgb(180, 230, 200),  // jade green
                    Color.FromArgb(200, 240, 210),  // pale emerald
                    Color.FromArgb(170, 220, 190),  // mint green
                    Color.FromArgb(210, 245, 220),  // soft green
                    Color.FromArgb(190, 235, 205),  // sage
                };

            // Importance-based palettes
            if (imp == "urgent")
                return urgentPalette();
            if (imp == "important")
                return importantPalette();

            return defaultHanakoPalette();
        }

        private static Color[] defaultHanakoPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 216, 230),
                Color.FromArgb(255, 210, 225),
                Color.FromArgb(250, 200, 215),
                Color.FromArgb(255, 220, 235),
                Color.FromArgb(245, 205, 220),
                Color.FromArgb(255, 215, 228),
            };
        }

        private static Color[] butterPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 230, 170),
                Color.FromArgb(255, 240, 200),
                Color.FromArgb(255, 220, 150),
                Color.FromArgb(255, 235, 190),
                Color.FromArgb(245, 225, 170),
            };
        }

        private static Color[] chatgptPalette()
        {
            return new Color[]
            {
                Color.FromArgb(200, 220, 255),
                Color.FromArgb(190, 210, 240),
                Color.FromArgb(210, 225, 250),
                Color.FromArgb(180, 200, 235),
                Color.FromArgb(220, 230, 255),
            };
        }

        private static Color[] mingPalette()
        {
            return new Color[]
            {
                Color.FromArgb(200, 180, 255),
                Color.FromArgb(180, 160, 240),
                Color.FromArgb(210, 190, 250),
                Color.FromArgb(190, 170, 235),
                Color.FromArgb(220, 200, 255),
            };
        }

        private static Color[] kongPalette()
        {
            return new Color[]
            {
                Color.FromArgb(180, 230, 200),
                Color.FromArgb(200, 240, 210),
                Color.FromArgb(170, 220, 190),
                Color.FromArgb(210, 245, 220),
                Color.FromArgb(190, 235, 205),
            };
        }

        private static Color[] urgentPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 160, 160),
                Color.FromArgb(255, 180, 140),
                Color.FromArgb(255, 200, 170),
                Color.FromArgb(240, 170, 190),
                Color.FromArgb(255, 190, 180),
            };
        }

        private static Color[] rainbowPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 216, 230),
                Color.FromArgb(238, 224, 255),
                Color.FromArgb(222, 245, 238),
                Color.FromArgb(255, 239, 215),
                Color.FromArgb(224, 236, 255),
                Color.FromArgb(250, 226, 238),
                Color.FromArgb(200, 220, 255),
                Color.FromArgb(255, 200, 180),
                Color.FromArgb(180, 230, 200),
            };
        }

        private static Color[] importantPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 182, 210),
                Color.FromArgb(255, 200, 180),
                Color.FromArgb(255, 224, 150),
                Color.FromArgb(230, 190, 255),
                Color.FromArgb(255, 210, 230),
            };
        }

        private static Color[] sakuraStormPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 88, 158),
                Color.FromArgb(255, 148, 196),
                Color.FromArgb(255, 210, 232),
                Color.FromArgb(238, 82, 132),
                Color.FromArgb(255, 236, 244),
                Color.FromArgb(214, 52, 122),
            };
        }

        private static Color[] blackGoldPalette()
        {
            return new Color[]
            {
                Color.FromArgb(245, 194, 90),
                Color.FromArgb(255, 232, 150),
                Color.FromArgb(176, 128, 48),
                Color.FromArgb(92, 78, 52),
                Color.FromArgb(255, 244, 196),
            };
        }

        private static Color[] emberPalette()
        {
            return new Color[]
            {
                Color.FromArgb(255, 122, 24),
                Color.FromArgb(255, 177, 84),
                Color.FromArgb(255, 209, 102),
                Color.FromArgb(224, 70, 40),
                Color.FromArgb(255, 238, 184),
            };
        }

        private static Color[] moonlightPalette()
        {
            return new Color[]
            {
                Color.FromArgb(142, 167, 255),
                Color.FromArgb(195, 185, 255),
                Color.FromArgb(215, 183, 255),
                Color.FromArgb(176, 220, 255),
                Color.FromArgb(238, 242, 255),
            };
        }

        private static Color[] neonMintPalette()
        {
            return new Color[]
            {
                Color.FromArgb(64, 245, 200),
                Color.FromArgb(122, 167, 255),
                Color.FromArgb(174, 255, 226),
                Color.FromArgb(90, 220, 255),
                Color.FromArgb(232, 255, 246),
            };
        }
    }
}
