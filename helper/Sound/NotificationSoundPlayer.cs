using System;
using System.IO;
using System.Media;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace NotificationHubToast
{
    static class NotificationSoundPlayer
    {
        static void LogSoundDiagnostic(string message)
        {
            try { Console.Error.WriteLine("[notification-hub sound] " + message); } catch { }
        }

        static readonly object CustomMediaLock = new object();
        static readonly System.Collections.Generic.List<System.Threading.Timer> CustomMediaTimers = new System.Collections.Generic.List<System.Threading.Timer>();
        static readonly System.Collections.Generic.List<string> ActiveCustomMediaAliases = new System.Collections.Generic.List<string>();
        static readonly System.Collections.Generic.List<WpfMediaSession> ActiveWpfMediaSessions = new System.Collections.Generic.List<WpfMediaSession>();
        static SoundPlayer ActiveCustomWavePlayer = null;
        static int CustomMediaAliasCounter = 0;

        sealed class WpfMediaSession
        {
            public System.Windows.Media.MediaPlayer Player;
            public System.Windows.Threading.Dispatcher Dispatcher;
            public readonly ManualResetEventSlim OpenSignal = new ManualResetEventSlim(false);
            public bool Opened;
            public string Error;
        }

        [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
        static extern int mciSendString(string command, StringBuilder buffer, int bufferSize, IntPtr hwndCallback);

        internal static void Queue(string theme, string customPath)
        {
            var queuedTheme = theme;
            var queuedPath = customPath;
            try
            {
                ThreadPool.QueueUserWorkItem(delegate
                {
                    PlayNotificationSound(queuedTheme, queuedPath);
                });
            }
            catch (Exception ex)
            {
                LogSoundDiagnostic("Queue: thread pool rejected work item: " + ex.Message);
                // Never block the UI thread if the pool rejects the work item.
                try { SystemSounds.Beep.Play(); } catch { }
            }
        }

        static void PlayNotificationSound(string theme, string customPath)
        {
            try
            {
                var mediaDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Media");
                string file = null;
                var normalizedTheme = String.IsNullOrWhiteSpace(theme) ? "chime" : theme;
                switch (normalizedTheme.ToLowerInvariant())
                {
                    case "off":
                        LogSoundDiagnostic("theme=off, skipping");
                        return;
                    case "custom":
                        if (TryPlayCustomSound(customPath)) return;
                        LogSoundDiagnostic("custom fallback to chimes.wav; path=" + (customPath ?? "<null>"));
                        file = Path.Combine(mediaDir, "chimes.wav");
                        break;
                    case "chime":
                    case "chimes":
                        file = Path.Combine(mediaDir, "chimes.wav");
                        break;
                    case "notify":
                        file = Path.Combine(mediaDir, "notify.wav");
                        if (!File.Exists(file)) file = Path.Combine(mediaDir, "Windows Notify.wav");
                        break;
                    case "alert":
                    case "alarm":
                        PlayAlertSound(mediaDir);
                        return;
                    case "system":
                        SystemSounds.Asterisk.Play();
                        return;
                    case "ding":
                    default:
                        file = Path.Combine(mediaDir, "ding.wav");
                        if (!File.Exists(file)) file = Path.Combine(mediaDir, "Windows Ding.wav");
                        break;
                }

                if (!String.IsNullOrWhiteSpace(file) && File.Exists(file))
                {
                    using (var player = new SoundPlayer(file))
                    {
                        LogSoundDiagnostic("playing built-in: " + file);
                        player.Play();
                    }
                    return;
                }

                LogSoundDiagnostic("fallback to SystemSounds.Beep for theme=" + normalizedTheme + " file=" + (file ?? "<null>"));
                SystemSounds.Beep.Play();
            }
            catch (Exception ex)
            {
                LogSoundDiagnostic("PlayNotificationSound exception: " + ex.Message);
                try { SystemSounds.Beep.Play(); } catch { }
            }
        }

        static bool TryPlayCustomSound(string path)
        {
            try
            {
                if (String.IsNullOrWhiteSpace(path)) { LogSoundDiagnostic("custom path is empty"); return false; }
                path = Environment.ExpandEnvironmentVariables(path.Trim().Trim('"'));
                path = Path.GetFullPath(path);
                if (!File.Exists(path)) { LogSoundDiagnostic("custom file not found: " + path); return false; }

                var ext = Path.GetExtension(path).ToLowerInvariant();
                if (ext == ".wav")
                {
                    lock (CustomMediaLock)
                    {
                        StopActiveCustomSounds();
                        return TryPlayWaveSound(path);
                    }
                }

                if (ext == ".mp3" || ext == ".m4a" || ext == ".aac" || ext == ".wma")
                {
                    lock (CustomMediaLock)
                    {
                        StopActiveCustomSounds();
                        return TryPlayMediaSound(path);
                    }
                }
                LogSoundDiagnostic("unsupported custom sound extension: " + ext + " path=" + path);
            }
            catch (Exception ex) { LogSoundDiagnostic("TryPlayCustomSound exception: " + ex.Message); }
            return false;
        }

        static bool TryPlayWaveSound(string path)
        {
            SoundPlayer player = null;
            try
            {
                player = new SoundPlayer(path);
                lock (CustomMediaLock) ActiveCustomWavePlayer = player;
                player.Play();

                System.Threading.Timer cleanupTimer = null;
                cleanupTimer = new System.Threading.Timer(delegate
                {
                    CleanupCustomWavePlayer(player, cleanupTimer);
                }, null, 15000, Timeout.Infinite);
                lock (CustomMediaLock) CustomMediaTimers.Add(cleanupTimer);
                return true;
            }
            catch (Exception ex)
            {
                LogSoundDiagnostic("TryPlayWaveSound failed: " + ex.Message + " path=" + path);
                try { player?.Dispose(); } catch { }
                lock (CustomMediaLock)
                {
                    if (Object.ReferenceEquals(ActiveCustomWavePlayer, player)) ActiveCustomWavePlayer = null;
                }
                return false;
            }
        }

        static bool TryPlayMediaSound(string path)
        {
            try
            {
                if (path.IndexOf('"') >= 0) { LogSoundDiagnostic("TryPlayMediaSound: path contains quotes, rejected: " + path); return false; }
                if (TryPlayMediaSoundWithMci(path)) return true;
                LogSoundDiagnostic("mci playback unavailable, trying WPF MediaPlayer fallback: " + path);
                return TryPlayMediaSoundWithWpf(path);
            }
            catch (Exception ex)
            {
                LogSoundDiagnostic("TryPlayMediaSound exception: " + ex.Message + " path=" + path);
                return false;
            }
        }

        static bool TryPlayMediaSoundWithMci(string path)
        {
            var alias = "nhSound" + Interlocked.Increment(ref CustomMediaAliasCounter).ToString(System.Globalization.CultureInfo.InvariantCulture);
            try
            {
                var ext = Path.GetExtension(path).ToLowerInvariant();
                var openCommands = new System.Collections.Generic.List<string>();
                if (ext == ".mp3" || ext == ".m4a" || ext == ".aac")
                {
                    openCommands.Add("open \"" + path + "\" type mpegvideo alias " + alias);
                    openCommands.Add("open \"" + path + "\" type MPEGVideo alias " + alias);
                }
                else if (ext == ".wma")
                {
                    openCommands.Add("open \"" + path + "\" type mpegvideo alias " + alias);
                }
                openCommands.Add("open \"" + path + "\" alias " + alias);

                int lastOpenResult = 0;
                foreach (var openCommand in openCommands)
                {
                    lastOpenResult = mciSendString(openCommand, null, 0, IntPtr.Zero);
                    if (lastOpenResult == 0) break;
                    try { mciSendString("close " + alias, null, 0, IntPtr.Zero); } catch { }
                }
                if (lastOpenResult != 0)
                {
                    LogSoundDiagnostic("mci open failed code=" + lastOpenResult + " path=" + path);
                    return false;
                }

                var playResult = mciSendString("play " + alias, null, 0, IntPtr.Zero);
                if (playResult != 0)
                {
                    LogSoundDiagnostic("mci play failed code=" + playResult + " path=" + path);
                    mciSendString("close " + alias, null, 0, IntPtr.Zero);
                    return false;
                }

                System.Threading.Timer cleanupTimer = null;
                cleanupTimer = new System.Threading.Timer(delegate
                {
                    CleanupCustomMediaAlias(alias, cleanupTimer);
                }, null, 15000, Timeout.Infinite);
                lock (CustomMediaLock)
                {
                    ActiveCustomMediaAliases.Add(alias);
                    CustomMediaTimers.Add(cleanupTimer);
                }
                LogSoundDiagnostic("playing custom media via MCI: " + path);
                return true;
            }
            catch (Exception ex)
            {
                LogSoundDiagnostic("TryPlayMediaSoundWithMci exception: " + ex.Message + " path=" + path);
                try { mciSendString("close " + alias, null, 0, IntPtr.Zero); } catch { }
                return false;
            }
        }

        static bool TryPlayMediaSoundWithWpf(string path)
        {
            WpfMediaSession session = null;
            System.Threading.Timer cleanupTimer = null;
            try
            {
                session = new WpfMediaSession();
                var thread = new Thread(new ThreadStart(delegate
                {
                    try
                    {
                        session.Dispatcher = System.Windows.Threading.Dispatcher.CurrentDispatcher;
                        var player = new System.Windows.Media.MediaPlayer();
                        session.Player = player;
                        player.MediaOpened += delegate
                        {
                            session.Opened = true;
                            session.OpenSignal.Set();
                        };
                        player.MediaFailed += delegate(object sender, System.Windows.Media.ExceptionEventArgs e)
                        {
                            session.Error = e.ErrorException != null ? e.ErrorException.Message : "unknown media failure";
                            session.OpenSignal.Set();
                            try { session.Dispatcher.BeginInvokeShutdown(System.Windows.Threading.DispatcherPriority.Background); } catch { }
                        };
                        player.Open(new Uri(path, UriKind.Absolute));
                        player.Play();
                        System.Windows.Threading.Dispatcher.Run();
                    }
                    catch (Exception ex)
                    {
                        session.Error = ex.Message;
                        session.OpenSignal.Set();
                    }
                }));
                thread.IsBackground = true;
                thread.SetApartmentState(ApartmentState.STA);
                thread.Start();

                if (!session.OpenSignal.Wait(2500))
                {
                    LogSoundDiagnostic("WPF MediaPlayer open timeout path=" + path);
                    CleanupWpfMediaSession(session, cleanupTimer);
                    return false;
                }
                if (!session.Opened)
                {
                    LogSoundDiagnostic("WPF MediaPlayer failed: " + (session.Error ?? "unknown") + " path=" + path);
                    CleanupWpfMediaSession(session, cleanupTimer);
                    return false;
                }

                cleanupTimer = new System.Threading.Timer(delegate
                {
                    CleanupWpfMediaSession(session, cleanupTimer);
                }, null, 15000, Timeout.Infinite);
                lock (CustomMediaLock)
                {
                    ActiveWpfMediaSessions.Add(session);
                    CustomMediaTimers.Add(cleanupTimer);
                }
                LogSoundDiagnostic("playing custom media via WPF MediaPlayer: " + path);
                return true;
            }
            catch (Exception ex)
            {
                LogSoundDiagnostic("TryPlayMediaSoundWithWpf exception: " + ex.Message + " path=" + path);
                if (session != null) CleanupWpfMediaSession(session, cleanupTimer);
                return false;
            }
        }

        static void StopActiveCustomSounds()
        {
            SoundPlayer wavePlayer = null;
            string[] aliases;
            WpfMediaSession[] wpfSessions;
            System.Threading.Timer[] timers;
            lock (CustomMediaLock)
            {
                wavePlayer = ActiveCustomWavePlayer;
                ActiveCustomWavePlayer = null;
                aliases = ActiveCustomMediaAliases.ToArray();
                ActiveCustomMediaAliases.Clear();
                wpfSessions = ActiveWpfMediaSessions.ToArray();
                ActiveWpfMediaSessions.Clear();
                timers = CustomMediaTimers.ToArray();
                CustomMediaTimers.Clear();
            }

            foreach (var timer in timers)
            {
                try { timer.Dispose(); } catch { }
            }

            if (wavePlayer != null)
            {
                try { wavePlayer.Stop(); } catch { }
                try { wavePlayer.Dispose(); } catch { }
            }

            foreach (var alias in aliases)
            {
                try { mciSendString("stop " + alias, null, 0, IntPtr.Zero); } catch { }
                try { mciSendString("close " + alias, null, 0, IntPtr.Zero); } catch { }
            }

            foreach (var session in wpfSessions)
            {
                try { CleanupWpfMediaSession(session, null); } catch { }
            }
        }

        static void CleanupCustomWavePlayer(SoundPlayer player, System.Threading.Timer timer)
        {
            try
            {
                if (timer != null)
                {
                    lock (CustomMediaLock) CustomMediaTimers.Remove(timer);
                    timer.Dispose();
                }
            }
            catch { }
            try
            {
                lock (CustomMediaLock)
                {
                    if (Object.ReferenceEquals(ActiveCustomWavePlayer, player)) ActiveCustomWavePlayer = null;
                }
            }
            catch { }
            try { player?.Dispose(); } catch { }
        }

        static void CleanupCustomMediaAlias(string alias, System.Threading.Timer timer)
        {
            try
            {
                if (timer != null)
                {
                    lock (CustomMediaLock) CustomMediaTimers.Remove(timer);
                    timer.Dispose();
                }
            }
            catch { }
            try
            {
                lock (CustomMediaLock) ActiveCustomMediaAliases.Remove(alias);
            }
            catch { }
            try { mciSendString("stop " + alias, null, 0, IntPtr.Zero); } catch { }
            try { mciSendString("close " + alias, null, 0, IntPtr.Zero); } catch { }
        }

        static void CleanupWpfMediaSession(WpfMediaSession session, System.Threading.Timer timer)
        {
            try
            {
                if (timer != null)
                {
                    lock (CustomMediaLock) CustomMediaTimers.Remove(timer);
                    timer.Dispose();
                }
            }
            catch { }
            try
            {
                lock (CustomMediaLock) ActiveWpfMediaSessions.Remove(session);
            }
            catch { }
            try
            {
                var dispatcher = session != null ? session.Dispatcher : null;
                var player = session != null ? session.Player : null;
                if (dispatcher != null && player != null)
                {
                    dispatcher.BeginInvoke(new Action(delegate
                    {
                        try { player.Stop(); } catch { }
                        try { player.Close(); } catch { }
                        try { dispatcher.BeginInvokeShutdown(System.Windows.Threading.DispatcherPriority.Background); } catch { }
                    }));
                }
                else if (dispatcher != null)
                {
                    try { dispatcher.BeginInvokeShutdown(System.Windows.Threading.DispatcherPriority.Background); } catch { }
                }
            }
            catch { }
            try { session?.OpenSignal?.Dispose(); } catch { }
        }

        static void PlayAlertSound(string mediaDir)
        {
            try
            {
                var candidates = new[]
                {
                    Path.Combine(mediaDir, "Windows Critical Stop.wav"),
                    Path.Combine(mediaDir, "Windows Exclamation.wav"),
                    Path.Combine(mediaDir, "Windows Background.wav"),
                };

                string first = null;
                foreach (var candidate in candidates)
                {
                    if (File.Exists(candidate))
                    {
                        first = candidate;
                        break;
                    }
                }
                if (!String.IsNullOrWhiteSpace(first))
                {
                    LogSoundDiagnostic("alert playing synced: " + first);
                    using (var player = new SoundPlayer(first)) player.PlaySync();
                    System.Threading.Thread.Sleep(90);
                }
                else
                {
                    LogSoundDiagnostic("alert no candidate wav found, using system sounds only");
                }

                SystemSounds.Exclamation.Play();
                System.Threading.Thread.Sleep(120);
                SystemSounds.Hand.Play();
            }
            catch (Exception ex)
            {
                LogSoundDiagnostic("PlayAlertSound exception: " + ex.Message);
                try
                {
                    SystemSounds.Exclamation.Play();
                    System.Threading.Thread.Sleep(120);
                    SystemSounds.Beep.Play();
                }
                catch { }
            }
        }
    }
}
