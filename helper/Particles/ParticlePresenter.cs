using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace NotificationHubToast
{
    sealed class ParticleSprite
    {
        public Bitmap Image;
        public float CenterX;
        public float CenterY;
    }

    /// <summary>
    /// Rasterizes each shape once, with real anti-aliasing, then the overlay
    /// only blits. TransparencyKey forbade both of those: soft edges leaked the
    /// key color, and the window was the entire virtual screen.
    /// </summary>
    sealed class ParticleSpriteCache
    {
        public const float BakeScale = 2f;
        const int Canvas = 512;
        readonly Dictionary<string, ParticleSprite> sprites = new Dictionary<string, ParticleSprite>();

        [DllImport("kernel32.dll", EntryPoint = "RtlMoveMemory")]
        static extern void CopyMemory(IntPtr dest, IntPtr src, uint length);

        public int Epoch { get; private set; }

        public ParticleSprite Find(string shape, Color color, float radius)
        {
            ParticleSprite sprite;
            return sprites.TryGetValue(Key(shape, color, radius), out sprite) ? sprite : null;
        }

        static string Key(string shape, Color color, float radius)
        {
            var bucket = shape == "bubble" || shape == "comet" ? (int)Math.Round(radius) : 0;
            return shape + "|" + color.ToArgb().ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + bucket.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        public ParticleSprite Get(string shape, Color color, float radius, Action<Graphics, float> drawLocal)
        {
            var key = Key(shape, color, radius);
            ParticleSprite sprite;
            if (sprites.TryGetValue(key, out sprite)) return sprite;
            // Keep live sprites available while a burst is flying. Clearing the
            // cache at 240 entries invalidated every GPU bitmap and re-baked the
            // whole burst on the next frame; exact keys remain reusable instead.
            var bucket = shape == "bubble" || shape == "comet" ? (int)Math.Round(radius) : 0;
            var drawRadius = bucket == 0 ? radius : bucket;
            sprite = Bake(drawLocal, drawRadius);
            sprites[key] = sprite;
            return sprite;
        }

        ParticleSprite Bake(Action<Graphics, float> drawLocal, float radius)
        {
            var canvas = new Bitmap(Canvas, Canvas, PixelFormat.Format32bppPArgb);
            try
            {
                using (var g = Graphics.FromImage(canvas))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.PixelOffsetMode = PixelOffsetMode.Half;
                    g.CompositingMode = CompositingMode.SourceOver;
                    g.CompositingQuality = CompositingQuality.HighQuality;
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.TranslateTransform(Canvas / 2f, Canvas / 2f);
                    g.ScaleTransform(BakeScale, BakeScale);
                    drawLocal(g, radius);
                }
                return Crop(canvas, Canvas / 2f, Canvas / 2f);
            }
            finally
            {
                canvas.Dispose();
            }
        }

        static ParticleSprite Crop(Bitmap source, float originX, float originY)
        {
            var bounds = new Rectangle(0, 0, source.Width, source.Height);
            var data = source.LockBits(bounds, ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
            try
            {
                int stride = data.Stride;
                int minX = source.Width, minY = source.Height, maxX = -1, maxY = -1;
                // One copy, then a managed scan. Per-pixel ReadByte on the 512 canvas
                // stalled the first click that baked this shape.
                var bytes = new byte[stride * source.Height];
                Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
                for (int y = 0; y < source.Height; y++)
                {
                    int row = y * stride;
                    for (int x = 0; x < source.Width; x++)
                    {
                        if (bytes[row + x * 4 + 3] == 0) continue;
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                    }
                }
                if (maxX < minX)
                {
                    return new ParticleSprite
                    {
                        Image = new Bitmap(1, 1, PixelFormat.Format32bppPArgb),
                        CenterX = 0f,
                        CenterY = 0f,
                    };
                }
                const int pad = 2;
                minX = Math.Max(0, minX - pad);
                minY = Math.Max(0, minY - pad);
                maxX = Math.Min(source.Width - 1, maxX + pad);
                maxY = Math.Min(source.Height - 1, maxY + pad);
                int cw = maxX - minX + 1;
                int ch = maxY - minY + 1;
                var cropped = new Bitmap(cw, ch, PixelFormat.Format32bppPArgb);
                var dest = cropped.LockBits(new Rectangle(0, 0, cw, ch), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
                try
                {
                    int rowBytes = cw * 4;
                    for (int y = 0; y < ch; y++)
                    {
                        IntPtr srcRow = IntPtr.Add(data.Scan0, (minY + y) * stride + minX * 4);
                        IntPtr dstRow = IntPtr.Add(dest.Scan0, y * dest.Stride);
                        CopyMemory(dstRow, srcRow, (uint)rowBytes);
                    }
                }
                finally
                {
                    cropped.UnlockBits(dest);
                }
                return new ParticleSprite
                {
                    Image = cropped,
                    CenterX = originX - minX,
                    CenterY = originY - minY,
                };
            }
            finally
            {
                source.UnlockBits(data);
            }
        }

        public void DisposeSprites()
        {
            foreach (var sprite in sprites.Values)
            {
                if (sprite != null && sprite.Image != null) sprite.Image.Dispose();
            }
            sprites.Clear();
            Epoch++;
        }
    }

    static class ParticleLayer
    {
        static IntPtr cachedBitmapDc;
        static IntPtr cachedDib;
        static IntPtr cachedDibBits;
        static IntPtr cachedPreviousObject;
        static int cachedWidth;
        static int cachedHeight;

        const byte AC_SRC_OVER = 0;
        const byte AC_SRC_ALPHA = 1;
        const int ULW_ALPHA = 2;

        [StructLayout(LayoutKind.Sequential)]
        struct PointNative
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct SizeNative
        {
            public int Width;
            public int Height;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct BlendFunction
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct BitmapInfoHeader
        {
            public int biSize;
            public int biWidth;
            public int biHeight;
            public short biPlanes;
            public short biBitCount;
            public int biCompression;
            public int biSizeImage;
            public int biXPelsPerMeter;
            public int biYPelsPerMeter;
            public int biClrUsed;
            public int biClrImportant;
        }

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref PointNative pptDst, ref SizeNative psize, IntPtr hdcSrc, ref PointNative pptSrc, int crKey, ref BlendFunction pblend, int dwFlags);

        [DllImport("user32.dll")]
        static extern IntPtr GetDC(IntPtr hwnd);

        [DllImport("user32.dll")]
        static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);

        [DllImport("gdi32.dll", SetLastError = true)]
        static extern IntPtr CreateDIBSection(IntPtr hdc, ref BitmapInfoHeader pbmi, uint usage, out IntPtr ppvBits, IntPtr hSection, uint offset);

        [DllImport("gdi32.dll")]
        static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);

        [DllImport("gdi32.dll")]
        static extern bool DeleteObject(IntPtr obj);

        [DllImport("gdi32.dll")]
        static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        static extern bool DeleteDC(IntPtr hdc);

        [DllImport("kernel32.dll", EntryPoint = "RtlMoveMemory")]
        static extern void CopyMemory(IntPtr dest, IntPtr src, uint length);

        public static bool Present(IntPtr hwnd, Bitmap bitmap, int physicalX, int physicalY)
        {
            return Present(hwnd, bitmap, physicalX, physicalY, 255);
        }

        public static bool PresentHdc(IntPtr hwnd, IntPtr sourceDc, int width, int height, int physicalX, int physicalY)
        {
            if (hwnd == IntPtr.Zero || sourceDc == IntPtr.Zero || width <= 0 || height <= 0) return false;
            IntPtr screenDc = GetDC(IntPtr.Zero);
            try
            {
                var dst = new PointNative { X = physicalX, Y = physicalY };
                var size = new SizeNative { Width = width, Height = height };
                var src = new PointNative();
                var blend = new BlendFunction
                {
                    BlendOp = AC_SRC_OVER,
                    BlendFlags = 0,
                    SourceConstantAlpha = 255,
                    AlphaFormat = AC_SRC_ALPHA,
                };
                return UpdateLayeredWindow(hwnd, screenDc, ref dst, ref size, sourceDc, ref src, 0, ref blend, ULW_ALPHA);
            }
            finally
            {
                if (screenDc != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screenDc);
            }
        }

        public static bool PresentBuffer(IntPtr hwnd, IntPtr bits, int stride, int width, int height, int physicalX, int physicalY)
        {
            if (hwnd == IntPtr.Zero || bits == IntPtr.Zero || width <= 0 || height <= 0 || stride <= 0) return false;
            IntPtr screenDc = IntPtr.Zero;
            IntPtr memDc = IntPtr.Zero;
            IntPtr dib = IntPtr.Zero;
            IntPtr old = IntPtr.Zero;
            try
            {
                var header = new BitmapInfoHeader
                {
                    biSize = Marshal.SizeOf(typeof(BitmapInfoHeader)),
                    biWidth = width,
                    biHeight = -height,
                    biPlanes = 1,
                    biBitCount = 32,
                    biCompression = 0,
                };
                IntPtr dest;
                dib = CreateDIBSection(IntPtr.Zero, ref header, 0, out dest, IntPtr.Zero, 0);
                if (dib == IntPtr.Zero || dest == IntPtr.Zero) return false;
                int rowBytes = width * 4;
                for (int y = 0; y < height; y++)
                    CopyMemory(IntPtr.Add(dest, y * rowBytes), IntPtr.Add(bits, y * stride), (uint)rowBytes);
                screenDc = GetDC(IntPtr.Zero);
                memDc = CreateCompatibleDC(screenDc);
                old = SelectObject(memDc, dib);
                var dst = new PointNative { X = physicalX, Y = physicalY };
                var size = new SizeNative { Width = width, Height = height };
                var src = new PointNative();
                var blend = new BlendFunction
                {
                    BlendOp = AC_SRC_OVER,
                    BlendFlags = 0,
                    SourceConstantAlpha = 255,
                    AlphaFormat = AC_SRC_ALPHA,
                };
                return UpdateLayeredWindow(hwnd, screenDc, ref dst, ref size, memDc, ref src, 0, ref blend, ULW_ALPHA);
            }
            finally
            {
                if (memDc != IntPtr.Zero && old != IntPtr.Zero) SelectObject(memDc, old);
                if (dib != IntPtr.Zero) DeleteObject(dib);
                if (memDc != IntPtr.Zero) DeleteDC(memDc);
                if (screenDc != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screenDc);
            }
        }

        public static bool Present(IntPtr hwnd, Bitmap bitmap, int physicalX, int physicalY, byte constantAlpha)
        {
            if (hwnd == IntPtr.Zero || bitmap == null || bitmap.Width <= 0 || bitmap.Height <= 0) return false;
            IntPtr screenDc = IntPtr.Zero;
            var locked = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
            try
            {
                if (!EnsureBitmapSurface(bitmap.Width, bitmap.Height)) return false;
                int rowBytes = bitmap.Width * 4;
                for (int y = 0; y < bitmap.Height; y++)
                    CopyMemory(IntPtr.Add(cachedDibBits, y * rowBytes), IntPtr.Add(locked.Scan0, y * locked.Stride), (uint)rowBytes);

                screenDc = GetDC(IntPtr.Zero);
                var dst = new PointNative { X = physicalX, Y = physicalY };
                var size = new SizeNative { Width = bitmap.Width, Height = bitmap.Height };
                var src = new PointNative();
                var blend = new BlendFunction
                {
                    BlendOp = AC_SRC_OVER,
                    BlendFlags = 0,
                    SourceConstantAlpha = constantAlpha,
                    AlphaFormat = AC_SRC_ALPHA,
                };
                return UpdateLayeredWindow(hwnd, screenDc, ref dst, ref size, cachedBitmapDc, ref src, 0, ref blend, ULW_ALPHA);
            }
            finally
            {
                bitmap.UnlockBits(locked);
                if (screenDc != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screenDc);
            }
        }

        static bool EnsureBitmapSurface(int width, int height)
        {
            if (cachedDib != IntPtr.Zero && cachedWidth == width && cachedHeight == height) return true;
            if (cachedBitmapDc != IntPtr.Zero && cachedPreviousObject != IntPtr.Zero)
                SelectObject(cachedBitmapDc, cachedPreviousObject);
            if (cachedDib != IntPtr.Zero) DeleteObject(cachedDib);
            cachedDib = IntPtr.Zero;
            cachedDibBits = IntPtr.Zero;
            cachedPreviousObject = IntPtr.Zero;

            var header = new BitmapInfoHeader
            {
                biSize = Marshal.SizeOf(typeof(BitmapInfoHeader)),
                biWidth = width,
                biHeight = -height,
                biPlanes = 1,
                biBitCount = 32,
                biCompression = 0,
            };
            cachedDib = CreateDIBSection(IntPtr.Zero, ref header, 0, out cachedDibBits, IntPtr.Zero, 0);
            if (cachedDib == IntPtr.Zero || cachedDibBits == IntPtr.Zero) return false;
            if (cachedBitmapDc == IntPtr.Zero) cachedBitmapDc = CreateCompatibleDC(IntPtr.Zero);
            if (cachedBitmapDc == IntPtr.Zero) return false;
            cachedPreviousObject = SelectObject(cachedBitmapDc, cachedDib);
            if (cachedPreviousObject == IntPtr.Zero || cachedPreviousObject == new IntPtr(-1)) return false;
            cachedWidth = width;
            cachedHeight = height;
            return true;
        }
    }
}
