using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Media;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Timer = System.Windows.Forms.Timer;


namespace NotificationHubToast
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // Lock DPI here. A v2 app host is a different process from the old
            // plugin host, and an unset mode inherits that parent's awareness.
            // Inherited unaware mode stretches the borderless window and breaks
            // TransparencyKey, so the card looks too wide and sits in the wrong place.
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (args.Length > 0 && args[0] == "--manager")
            {
                Application.Run(new ToastManager(new string[0], ArgValue(args, "--queue"), ArgValue(args, "--token")));
            }
            else if (args.Length > 0)
            {
                // File mode: load toasts from JSON file paths
                Application.Run(new ToastManager(args));
            }
            // No args: do nothing (backward compat)
        }

        static string ArgValue(string[] args, string name)
        {
            for (var i = 0; i < args.Length - 1; i++)
            {
                if (String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                    return args[i + 1];
            }
            return null;
        }
    }
}
