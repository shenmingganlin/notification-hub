namespace NotificationHubToast
{
    static class ParticleShapeRegistry
    {
        public static string Normalize(string shape)
        {
            var s = (shape ?? "sakura").ToLowerInvariant();
            switch (s)
            {
                case "none":
                case "moss":
                case "sakura":
                case "snowflake":
                case "butterfly":
                case "bubble":
                case "windmill":
                case "star":
                case "spark":
                case "shard":
                case "leaf":
                case "pixel":
                case "comet":
                case "gear":
                case "ember":
                case "crescent":
                case "slash":
                    return s;
                default:
                    return "sakura";
            }
        }
    }
}
