using System;
using System.Collections.Generic;
using System.Drawing;
using System.Numerics;
using SharpGen.Runtime;
using Vortice;
using Vortice.DCommon;
using Vortice.Direct2D1;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.Mathematics;

namespace NotificationHubToast
{
    interface IParticleSpriteBatchSink
    {
        void Add(ParticleSprite sprite, float left, float top, float right, float bottom, float rotationDegrees, float x, float y);
    }

    /// <summary>
    /// Composites the already-baked sprites on the GPU. Count, size, rotation
    /// and the soft edges of those sprites stay as they are; GDI+ was spending
    /// the frame on one DrawImage per petal.
    /// </summary>
    sealed class ParticleGpuPresenter : IDisposable, IParticleSpriteBatchSink
    {
        sealed class Bucket
        {
            public ID2D1Bitmap1 Bitmap;
            public RawRectF[] Dest = new RawRectF[128];
            public Matrix3x2[] Transform = new Matrix3x2[128];
            public int Count;

            public void Add(RawRectF dest, Matrix3x2 transform)
            {
                if (Count == Dest.Length)
                {
                    int next = Count * 2;
                    Array.Resize(ref Dest, next);
                    Array.Resize(ref Transform, next);
                }
                Dest[Count] = dest;
                Transform[Count] = transform;
                Count++;
            }
        }

        readonly ID3D11Device _d3d;
        readonly ID3D11DeviceContext _d3dContext;
        readonly ID2D1Factory4 _factory;
        readonly ID2D1Device3 _device;
        readonly ID2D1DeviceContext3 _dc;
        readonly ID2D1SpriteBatch _batch;
        readonly BitmapProperties1 _spriteProps;
        readonly Dictionary<ParticleSprite, Bucket> _buckets = new Dictionary<ParticleSprite, Bucket>();
        ID3D11Texture2D _color;
        ID3D11Texture2D _present;
        IDXGISurface1 _presentSurface;
        ID2D1Bitmap1 _target;
        int _width;
        int _height;
        int _epoch = -1;
        bool _open;
        bool _inDraw;
        bool _gdiSurface;

        ParticleGpuPresenter(ID3D11Device d3d, ID3D11DeviceContext d3dContext, ID2D1Factory4 factory, ID2D1Device3 device, ID2D1DeviceContext3 dc, ID2D1SpriteBatch batch)
        {
            _d3d = d3d;
            _d3dContext = d3dContext;
            _factory = factory;
            _device = device;
            _dc = dc;
            _batch = batch;
            _spriteProps = new BitmapProperties1(
                new PixelFormat(Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Premultiplied),
                96f,
                96f,
                BitmapOptions.None);
        }

        public static ParticleGpuPresenter TryCreate()
        {
            ID3D11Device d3d = null;
            ID3D11DeviceContext d3dContext = null;
            ID2D1Factory4 factory = null;
            IDXGIDevice dxgi = null;
            ID2D1Device3 device = null;
            ID2D1DeviceContext3 dc = null;
            ID2D1SpriteBatch batch = null;
            try
            {
                var result = D3D11.D3D11CreateDevice(
                    IntPtr.Zero,
                    DriverType.Hardware,
                    DeviceCreationFlags.BgraSupport,
                    new[] { Vortice.Direct3D.FeatureLevel.Level_11_0, Vortice.Direct3D.FeatureLevel.Level_10_0 },
                    out d3d,
                    out d3dContext);
                if (result.Failure || d3d == null || d3dContext == null) return null;
                D2D1.D2D1CreateFactory(FactoryType.SingleThreaded, out factory);
                dxgi = d3d.QueryInterface<IDXGIDevice>();
                device = factory.CreateDevice(dxgi);
                dc = device.CreateDeviceContext(DeviceContextOptions.None);
                dc.UnitMode = UnitMode.Pixels;
                batch = dc.CreateSpriteBatch();
                var created = new ParticleGpuPresenter(d3d, d3dContext, factory, device, dc, batch);
                dxgi.Dispose();
                return created;
            }
            catch (Exception ex)
            {
                try { Console.Error.WriteLine("[notification-hub helper] particle gpu unavailable: " + ex.Message); } catch { }
                if (batch != null) batch.Dispose();
                if (dc != null) dc.Dispose();
                if (device != null) device.Dispose();
                if (dxgi != null) dxgi.Dispose();
                if (factory != null) factory.Dispose();
                if (d3dContext != null) d3dContext.Dispose();
                if (d3d != null) d3d.Dispose();
                return null;
            }
        }

        public bool Begin(int width, int height, int spriteEpoch)
        {
            if (width <= 0 || height <= 0) return false;
            if (spriteEpoch != _epoch)
            {
                foreach (var bucket in _buckets.Values)
                {
                    if (bucket.Bitmap != null) bucket.Bitmap.Dispose();
                }
                _buckets.Clear();
                _epoch = spriteEpoch;
            }
            else
            {
                foreach (var bucket in _buckets.Values) bucket.Count = 0;
            }
            if (!EnsureTarget(width, height)) return false;
            _dc.Target = _target;
            _dc.Transform = Matrix3x2.Identity;
            _open = true;
            return true;
        }

        public void Add(ParticleSprite sprite, float left, float top, float right, float bottom, float rotationDegrees, float x, float y)
        {
            if (sprite == null || sprite.Image == null) return;
            Bucket bucket;
            if (!_buckets.TryGetValue(sprite, out bucket))
            {
                var bitmap = Upload(sprite);
                if (bitmap == null) return;
                bucket = new Bucket { Bitmap = bitmap };
                _buckets[sprite] = bucket;
            }
            float rad = rotationDegrees * ((float)Math.PI / 180f);
            bucket.Add(
                new RawRectF(left, top, right, bottom),
                Matrix3x2.CreateRotation(rad) * Matrix3x2.CreateTranslation(x, y));
        }

        public bool End(IntPtr hwnd, int x, int y, int displayWidth, int displayHeight)
        {
            if (!_open) return false;
            _open = false;
            try
            {
                _dc.BeginDraw();
                _inDraw = true;
                // DrawSpriteBatch rejects the default per-primitive antialiasing
                // with D2DERR_WRONG_STATE. Soft edges stay in the baked sprite.
                _dc.AntialiasMode = AntialiasMode.Aliased;
                _dc.PushAxisAlignedClip(
                    new RawRectF(0f, 0f, displayWidth, displayHeight),
                    AntialiasMode.Aliased);
                _dc.Clear(new Color4(0f, 0f, 0f, 0f));
                _dc.PopAxisAlignedClip();
                foreach (var bucket in _buckets.Values)
                {
                    if (bucket.Count <= 0 || bucket.Bitmap == null) continue;
                    _batch.Clear();
                    _batch.AddSprites(
                        (uint)bucket.Count,
                        bucket.Dest,
                        null,
                        null,
                        bucket.Transform,
                        (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(RawRectF)),
                        0,
                        0,
                        (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(Matrix3x2)));
                    _dc.DrawSpriteBatch(_batch, 0, (uint)bucket.Count, bucket.Bitmap, BitmapInterpolationMode.Linear, SpriteOptions.None);
                }
                var end = _dc.EndDraw();
                _inDraw = false;
                if (end.Failure) return false;
                if (!_gdiSurface)
                {
                    return false;
                }
                if (PresentFromDc(hwnd, x, y, displayWidth, displayHeight))
                {
                    ParticleOverlayHub.ReportPresentPath("gpu-dc");
                    return true;
                }
                return false;
            }
            catch
            {
                if (_inDraw)
                {
                    try { _dc.EndDraw(); } catch { }
                    _inDraw = false;
                }
                return false;
            }
        }

        bool PresentFromDc(IntPtr hwnd, int x, int y, int displayWidth, int displayHeight)
        {
            var sourceBox = new Box(0, 0, 0, displayWidth, displayHeight, 1);
            _d3dContext.CopySubresourceRegion(_present, 0, 0, 0, 0, _color, 0, sourceBox);
            IntPtr hdc = _presentSurface.GetDC(false);
            try
            {
                return ParticleLayer.PresentHdc(hwnd, hdc, displayWidth, displayHeight, x, y);
            }
            finally { _presentSurface.ReleaseDC(null); }
        }

        ID2D1Bitmap1 Upload(ParticleSprite sprite)
        {
            var image = sprite.Image;
            var data = image.LockBits(new Rectangle(0, 0, image.Width, image.Height), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
            try
            {
                var size = new SizeI(image.Width, image.Height);
                return _dc.CreateBitmap(size, data.Scan0, (uint)data.Stride, _spriteProps);
            }
            finally
            {
                image.UnlockBits(data);
            }
        }

        bool EnsureTarget(int width, int height)
        {
            // The layered window may shrink every frame, but the GPU target is
            // a reusable capacity surface and only grows when the next burst
            // no longer fits.
            if (_target != null && width <= _width && height <= _height) return true;
            ReleaseTarget();
            CreateTarget(width, height);
            return _target != null;
        }

        void CreateTarget(int width, int height)
        {
            // The draw target stays a plain render target. A second texture
            // receives a GPU copy solely so UpdateLayeredWindow can take its DC.
            _color = _d3d.CreateTexture2D(Describe(width, height, false));
            using (var surface = _color.QueryInterface<IDXGISurface>())
            {
                var props = new BitmapProperties1(
                    new PixelFormat(Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Premultiplied),
                    96f,
                    96f,
                    BitmapOptions.Target | BitmapOptions.CannotDraw);
                _target = _dc.CreateBitmapFromDxgiSurface(surface, props);
            }
            try
            {
                _present = _d3d.CreateTexture2D(Describe(width, height, true));
                _presentSurface = _present.QueryInterface<IDXGISurface1>();
                _gdiSurface = true;
            }
            catch
            {
                _gdiSurface = false;
                if (_presentSurface != null) { _presentSurface.Dispose(); _presentSurface = null; }
                if (_present != null) { _present.Dispose(); _present = null; }
            }
            _width = width;
            _height = height;
        }

        static Texture2DDescription Describe(int width, int height, bool gdi)
        {
            return new Texture2DDescription
            {
                Width = (uint)width,
                Height = (uint)height,
                MipLevels = 1,
                ArraySize = 1,
                Format = Format.B8G8R8A8_UNorm,
                SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Default,
                BindFlags = BindFlags.RenderTarget,
                CPUAccessFlags = CpuAccessFlags.None,
                MiscFlags = gdi ? ResourceOptionFlags.GdiCompatible : ResourceOptionFlags.None,
            };
        }

        public void ReleaseTarget()
        {
            if (_target != null)
            {
                _dc.Target = null;
                _target.Dispose();
                _target = null;
            }
            if (_presentSurface != null) { _presentSurface.Dispose(); _presentSurface = null; }
            if (_present != null) { _present.Dispose(); _present = null; }
            if (_color != null) { _color.Dispose(); _color = null; }
            _width = 0;
            _height = 0;
            _gdiSurface = false;
        }

        public void Dispose()
        {
            if (_inDraw)
            {
                try { _dc.EndDraw(); } catch { }
                _inDraw = false;
            }
            _open = false;
            foreach (var bucket in _buckets.Values)
            {
                if (bucket.Bitmap != null) bucket.Bitmap.Dispose();
            }
            _buckets.Clear();
            ReleaseTarget();
            if (_batch != null) _batch.Dispose();
            if (_dc != null) _dc.Dispose();
            if (_device != null) _device.Dispose();
            if (_factory != null) _factory.Dispose();
            if (_d3dContext != null) _d3dContext.Dispose();
            if (_d3d != null) _d3d.Dispose();
        }
    }
}
