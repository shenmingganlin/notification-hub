using System;
using System.IO;
using System.Text.RegularExpressions;

namespace NotificationHubToast
{
    sealed class Payload
    {
        public string Title = "閫氱煡";
        public string Body = "";
        public string AgentName = "Assistant";
        public string Emoji = "馃";
        public string Type = "conversation";
        public string Primary = "#9b7cff";
        public string Accent = "#9b7cff";
        public string Importance = "normal";
        public string MatchedKeywords = "";
        public string SoundTheme = "chime";
        public string CustomSoundPath = "";
        public bool Sound = false;
        public int StackIndex = 0;
        public int StackGap = 8;
        public string SlotStatePath = "";
        public string ControlPath = "";
        public string ToastId = "";
        public string ClickPath = "";
        public string ActionType = "";
        public string ActionTarget = "";
        public string Source = "";
        public bool SakuraEnabled = true;
        public string SakuraTheme = "";
        public int ButterflyCount = 0;
        public int ParticleCount = 0;
        public string ToastLayout = "clean";
        public double ToastScale = 1.0;
        public int ToastOffsetX = 0;
        public int ToastOffsetY = 0;
        public string ToastStyle = "classic";
        public string DismissEffect = "fade";
        public string ParticleShape = "sakura";
        public double AutoParticleCountScale = 1.0;
        public double ManualParticleCountScale = 1.0;
        public double ParticleSizeScale = 1.0;
        public int ParticleIntervalEffect = 0;
        public string EntranceVisual = "classic";
        public string AutoDismissMotion = "drift";
        public string ManualDismissMotion = "click-burst";
        public string PhysicsPreset = "lively";

        public static Payload Load(string path)
        {
            var raw = File.ReadAllText(path, System.Text.Encoding.UTF8);
            var p = new Payload();
            p.Title = Get(raw, "title", p.Title);
            p.Body = Get(raw, "body", p.Body);
            p.AgentName = Get(raw, "agentName", p.AgentName);
            p.Emoji = Get(raw, "emoji", p.Emoji);
            p.Type = Get(raw, "type", p.Type);
            p.Primary = Get(raw, "primary", p.Primary);
            p.Accent = Get(raw, "accent", p.Accent);
            p.Importance = Get(raw, "importance", p.Importance).ToLowerInvariant();
            p.MatchedKeywords = Get(raw, "matchedKeywords", p.MatchedKeywords);
            p.SoundTheme = Get(raw, "soundTheme", p.SoundTheme).ToLowerInvariant();
            p.CustomSoundPath = Get(raw, "customSoundPath", p.CustomSoundPath);
            p.Sound = GetBool(raw, "sound", p.Sound);
            p.StackIndex = Math.Max(0, Math.Min(12, GetInt(raw, "stackIndex", p.StackIndex)));
            p.StackGap = Math.Max(0, Math.Min(40, GetInt(raw, "stackGap", p.StackGap)));
            p.ControlPath = Get(raw, "controlPath", p.ControlPath);
            p.SlotStatePath = Get(raw, "slotStatePath", p.SlotStatePath);
            p.SlotStatePath = Get(raw, "slotStatePath", p.SlotStatePath);
            p.ToastId = Get(raw, "toastId", p.ToastId);
            p.ClickPath = Get(raw, "clickPath", p.ClickPath);
            p.ActionType = Get(raw, "actionType", p.ActionType);
            p.ActionTarget = Get(raw, "actionTarget", p.ActionTarget);
            p.Source = Get(raw, "source", p.Source);
            p.SakuraEnabled = GetBool(raw, "sakuraEnabled", p.SakuraEnabled);
            p.SakuraTheme = Get(raw, "sakuraTheme", p.SakuraTheme).ToLowerInvariant();
            p.ButterflyCount = Math.Max(0, Math.Min(240, GetInt(raw, "butterflyCount", p.ButterflyCount)));
            p.ParticleCount = Math.Max(0, Math.Min(1200, GetInt(raw, "particleCount", p.ParticleCount)));
            p.ToastLayout = Get(raw, "toastLayout", p.ToastLayout).ToLowerInvariant();
            p.ToastScale = Math.Max(0.7, Math.Min(1.2, GetDouble(raw, "toastScale", p.ToastScale)));
            p.ToastOffsetX = Math.Max(-1600, Math.Min(1600, GetInt(raw, "toastOffsetX", p.ToastOffsetX)));
            p.ToastOffsetY = Math.Max(-1000, Math.Min(1000, GetInt(raw, "toastOffsetY", p.ToastOffsetY)));
            p.ToastStyle = Get(raw, "toastStyle", p.ToastStyle).ToLowerInvariant();
            p.DismissEffect = Get(raw, "dismissEffect", p.DismissEffect).ToLowerInvariant();
            p.ParticleShape = Get(raw, "particleShape", p.ParticleShape).ToLowerInvariant();
            p.AutoParticleCountScale = Math.Max(0.2, Math.Min(4.0, GetDouble(raw, "autoParticleCountScale", p.AutoParticleCountScale)));
            p.ManualParticleCountScale = Math.Max(0.2, Math.Min(4.0, GetDouble(raw, "manualParticleCountScale", p.ManualParticleCountScale)));
            p.ParticleSizeScale = Math.Max(0.5, Math.Min(3.0, GetDouble(raw, "particleSizeScale", p.ParticleSizeScale)));
            p.ParticleIntervalEffect = Math.Max(0, Math.Min(100, GetInt(raw, "particleIntervalEffect", p.ParticleIntervalEffect)));
            p.EntranceVisual = Get(raw, "entranceVisual", p.EntranceVisual).ToLowerInvariant();
            p.AutoDismissMotion = NormalizeDismissMotion(Get(raw, "autoDismissMotion", p.AutoDismissMotion));
            p.ManualDismissMotion = NormalizeDismissMotion(Get(raw, "manualDismissMotion", p.ManualDismissMotion));
            p.PhysicsPreset = Get(raw, "physicsPreset", p.PhysicsPreset).ToLowerInvariant();
            return p;
        }

        public static string Get(string json, string key, string fallback)
        {
            var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
            if (!m.Success) return fallback;
            var value = DecodeJsonString(m.Groups[1].Value);
            return String.IsNullOrWhiteSpace(value) ? fallback : value;
        }

        static string DecodeJsonString(string value)
        {
            if (String.IsNullOrEmpty(value)) return value;
            var sb = new System.Text.StringBuilder(value.Length);
            for (int i = 0; i < value.Length; i++)
            {
                var ch = value[i];
                if (ch != '\\' || i + 1 >= value.Length)
                {
                    sb.Append(ch);
                    continue;
                }

                var next = value[++i];
                switch (next)
                {
                    case '\\': sb.Append('\\'); break;
                    case '"': sb.Append('"'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    default:
                        sb.Append(next);
                        break;
                }
            }
            return sb.ToString();
        }

        public static bool GetBool(string json, string key, bool fallback)
        {
            var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase);
            if (!m.Success) return fallback;
            return String.Equals(m.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase);
        }

        public static long GetLong(string json, string key, long fallback)
        {
            var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(-?\\d+)");
            if (!m.Success) return fallback;
            return long.Parse(m.Groups[1].Value);
        }

        public static int GetInt(string json, string key, int fallback)
        {
            var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(-?\\d+)");
            if (!m.Success) return fallback;
            int value;
            return Int32.TryParse(m.Groups[1].Value, out value) ? value : fallback;
        }

        public static double GetDouble(string json, string key, double fallback)
        {
            var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)");
            if (!m.Success) return fallback;
            double value;
            return Double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out value) ? value : fallback;
        }

        public static string NormalizeDismissMotion(string motion)
        {
            var m = (motion ?? "drift").Trim().ToLowerInvariant();
            switch (m)
            {
                case "burst":
                case "explosion":
                    return "circle-burst";
                case "click":
                    return "click-burst";
                case "float":
                    return "drift";
                case "drift":
                case "circle-burst":
                case "rect-burst":
                case "click-burst":
                case "x-burst":
                case "vortex":
                case "ribbon-flow":
                case "gravity-fall":
                case "orbit-decay":
                case "bubble-rise":
                case "windmill-gust":
                case "shatter-lines":
                case "pixel-rain":
                case "magnet-snap":
                    return m;
                default:
                    return "drift";
            }
        }
    }
}
