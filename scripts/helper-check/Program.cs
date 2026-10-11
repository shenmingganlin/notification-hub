using System;
using System.Collections;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class HelperCheck
{
    static Assembly assembly;
    const BindingFlags Flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;
    static Type Type(string name) => assembly.GetType("NotificationHubToast." + name, true);
    static object Get(object value, string name) => value.GetType().GetField(name, Flags).GetValue(value);
    static void Set(object value, string name, object next) => value.GetType().GetField(name, Flags).SetValue(value, next);
    static object Call(object value, string name, params object[] args) => value.GetType().GetMethod(name, Flags).Invoke(value, args);
    static void Check(bool ok, string message) { if (!ok) throw new Exception(message); Console.WriteLine("PASS " + message); }
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    static bool Above(Form upper, Form lower)
    {
        var seen = new System.Collections.Generic.HashSet<IntPtr>();
        for (var hwnd = GetWindow(upper.Handle, 2); hwnd != IntPtr.Zero && seen.Add(hwnd); hwnd = GetWindow(hwnd, 2))
            if (hwnd == lower.Handle) return true;
        return false;
    }

    static void CheckNotificationZOrder(object manager, IList list, Form exiting, Form live, Form overlay)
    {
        using var newest = Toast("live-three");
        using var normal = new Form { ShowInTaskbar = false };
        _ = newest.Handle;
        _ = normal.Handle;
        list.Add(newest);
        var hub = Type("ParticleOverlayHub");
        var overlayField = hub.GetField("overlay", Flags);
        var previousOverlay = overlayField.GetValue(null);
        overlayField.SetValue(null, overlay);
        Action restack = (Action)manager.GetType().GetMethod("RestackNotificationWindows", Flags).CreateDelegate(typeof(Action), manager);
        hub.GetEvent("LayerShown").AddEventHandler(null, restack);
        try
        {
            const uint noMoveSizeActivate = 0x0001 | 0x0002 | 0x0010 | 0x0200;
            // Scramble only these hidden fixture HWNDs: particles and an exit above live cards.
            SetWindowPos(newest.Handle, IntPtr.Zero, 0, 0, 0, 0, noMoveSizeActivate);
            SetWindowPos(live.Handle, IntPtr.Zero, 0, 0, 0, 0, noMoveSizeActivate);
            SetWindowPos(exiting.Handle, IntPtr.Zero, 0, 0, 0, 0, noMoveSizeActivate);
            SetWindowPos(overlay.Handle, IntPtr.Zero, 0, 0, 0, 0, noMoveSizeActivate);
            Check(Above(overlay, exiting) && Above(exiting, live) && Above(live, newest), "R27 fixture reproduces particles/exit above live cards");
            var position = exiting.Location;
            restack();
            Check(Above(live, newest) && Above(newest, exiting) && Above(exiting, overlay), "R27 restack orders live cards above exits above particles");
            Check(exiting.Location == position, "R27 Z-order reflow does not move cards");
            Check((GetWindowLongPtr(overlay.Handle, -20).ToInt64() & 0x8) != 0 && Above(overlay, normal), "R27 particles remain TopMost above ordinary windows");
            Check((GetWindowLongPtr(live.Handle, -20).ToInt64() & 0x8) != 0 && (GetWindowLongPtr(exiting.Handle, -20).ToInt64() & 0x8) != 0, "R27 card reflow preserves the TopMost band");

            SetWindowPos(newest.Handle, IntPtr.Zero, 0, 0, 0, 0, noMoveSizeActivate);
            restack();
            Check(Above(newest, live), "R27 preserves changed live-card relative order, not creation order");
            // Same notification dispatched by Present after every overlay Show, including reshow.
            for (int i = 0; i < 2; i++)
            {
                SetWindowPos(overlay.Handle, IntPtr.Zero, 0, 0, 0, 0, noMoveSizeActivate);
                hub.GetMethod("NotifyLayerShown", Flags).Invoke(null, null);
                Check(Above(newest, live) && Above(live, exiting) && Above(exiting, overlay), "R27 layer appearance restores ordering (round " + (i + 1) + ")");
            }
            newest.GetType().GetEvent("ExitStarted").AddEventHandler(newest, (EventHandler)((_, _) => Call(manager, "ReindexSlots", 0)));
            Call(newest, "StartExit", true);
            ((System.Windows.Forms.Timer)Get(newest, "animTimer")).Stop();
            Check(Above(live, newest) && Above(newest, overlay) && Above(exiting, overlay), "R27 exit-start reflow keeps both exiting cards below the remaining live card");
            Call(exiting, "MoveWithoutChangingZOrder", position.X + 1, position.Y + 1);
            Check(exiting.Left == position.X + 1 && exiting.Top == position.Y + 1 && Above(live, exiting) && Above(exiting, overlay), "R27 animation position update preserves Z order");
            list.Remove(exiting);
            restack();
            Check(Above(live, newest) && Above(newest, overlay), "R27 removing an exit keeps the remaining hierarchy");
            list.Add(exiting);
            Check(!newest.Visible && !normal.Visible, "R27 Z-order checks do not show fixture windows");
        }
        finally
        {
            hub.GetEvent("LayerShown").RemoveEventHandler(null, restack);
            overlayField.SetValue(null, previousOverlay);
            list.Remove(newest);
        }
    }

    static Form Toast(string id)
    {
        var payload = Activator.CreateInstance(Type("Payload"), true);
        Set(payload, "ToastId", id);
        Set(payload, "Sound", false);
        Set(payload, "SakuraEnabled", false);
        return (Form)Activator.CreateInstance(Type("ToastForm"), Flags, null, new[] { payload }, null);
    }

    [STAThread]
    static int Main()
    {
        try
        {
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            assembly = Assembly.Load("notification-toast-helper");
            Check(assembly.GetType("NotificationHubToast.ParticleCompositionPresenter") == null, "compiled helper excludes DirectComposition presenter");
            using var first = Toast("exit-one");
            using var second = Toast("alive-two");
            _ = first.Handle; // Hidden HWND: no window show, input synthesis or focus activation.
            _ = second.Handle;
            var manager = RuntimeHelpers.GetUninitializedObject(Type("ToastManager"));
            var list = (IList)Activator.CreateInstance(typeof(System.Collections.Generic.List<>).MakeGenericType(first.GetType()));
            list.Add(first);
            list.Add(second);
            Set(manager, "_toasts", list);
            Call(manager, "ReindexSlots", 0);
            var oldTarget = (int)Get(second, "targetY");
            int exits = 0;
            first.GetType().GetEvent("ExitStarted").AddEventHandler(first, (EventHandler)((_, _) => { exits++; Call(manager, "ReindexSlots", 0); }));
            Call(first, "StartExit", true);
            Check(exits == 1 && (bool)first.GetType().GetProperty("IsExiting").GetValue(first), "exit starts immediately and fires one slot-release event");
            Check((int)Get(second, "targetY") != oldTarget && (int)Get(second, "targetY") == (int)Get(second, "baseY"), "next toast gets slot zero while previous exit animation still lives");
            Check(!first.IsDisposed, "slot release does not discard exit animation");
            Check((GetWindowLongPtr(first.Handle, -20).ToInt64() & 0x20) != 0, "exiting layered HWND has WS_EX_TRANSPARENT");
            var message = Message.Create(first.Handle, 0x84, IntPtr.Zero, IntPtr.Zero);
            object[] parameters = { message };
            first.GetType().GetMethod("WndProc", Flags).Invoke(first, parameters);
            Check(((Message)parameters[0]).Result == new IntPtr(-1), "exiting toast hit test returns HTTRANSPARENT");
            Call(first, "StartExit", true);
            Check(exits == 1, "repeated exit request cannot fire twice");
            var animation = (System.Windows.Forms.Timer)Get(first, "animTimer");
            animation.Stop();
            Call(first, "FinishExit", (Action)(() => throw new InvalidOperationException("injected particle failure")));
            Check(animation.Enabled, "particle failure still starts the close animation");
            animation.Stop();

            using var overlay = (Form)Activator.CreateInstance(Type("ParticleOverlayForm"), true);
            _ = overlay.Handle;
            long exStyle = GetWindowLongPtr(overlay.Handle, -20).ToInt64();
            Check((exStyle & 0x80000) != 0 && (exStyle & 0x20) != 0 && (exStyle & 0x200000) == 0, "particle layer is layered/transparent with no composition window style");
            parameters = new object[] { Message.Create(overlay.Handle, 0x84, IntPtr.Zero, IntPtr.Zero) };
            overlay.GetType().GetMethod("WndProc", Flags).Invoke(overlay, parameters);
            Check(((Message)parameters[0]).Result == new IntPtr(-1), "particle layer always returns HTTRANSPARENT");
            CheckNotificationZOrder(manager, list, first, second, overlay);
            Call(overlay, "WarmGpu");
            var gpu = Get(overlay, "gpu");
            Check(gpu != null, "offscreen GPU sprite presenter initializes without a swap chain");
            Call(overlay, "InitParticles", new Rectangle(64, 64, 300, 100), new Point(200, 100), 208, "sakura", "click-burst", true,
                new Color[] { Color.Pink }, 1f, 0f, true, 1.0, 0);
            Set(overlay, "tick", 20);
            var sprites = Get(overlay, "sprites");
            int epoch = (int)sprites.GetType().GetProperty("Epoch").GetValue(sprites);
            double firstFrame = 0;
            double total = 0;
            double maximum = 0;
            for (int i = 0; i < 31; i++)
            {
                var sw = Stopwatch.StartNew();
                if (!(bool)Call(gpu, "Begin", 512, 256, epoch)) throw new Exception("GPU begin failed");
                Call(overlay, "DrawParticles", null, gpu);
                if (!(bool)Call(gpu, "End", overlay.Handle, 0, 0, 512, 256)) throw new Exception("GPU-DC present failed");
                sw.Stop();
                if (i == 0) firstFrame = sw.Elapsed.TotalMilliseconds;
                else { total += sw.Elapsed.TotalMilliseconds; maximum = Math.Max(maximum, sw.Elapsed.TotalMilliseconds); }
            }
            Check(!overlay.Visible && !first.Visible && !second.Visible, "all helper checks used hidden windows");
            Console.WriteLine($"GPU-DC hidden-HWND 208-particle sample: first={firstFrame:F3}ms cachedMean={total / 30:F3}ms cachedMax={maximum:F3}ms frames=31");
            Console.WriteLine("helper Q2/r26+r27 checks ok (not a desktop visual/focus/rapid-click test)");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
}
