using System;
using System.Collections.Generic;
using System.Drawing;
using System.Numerics;
using System.Runtime.InteropServices;
using SharpGen.Runtime;
using Vortice;
using Vortice.DCommon;
using Vortice.Direct2D1;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DirectComposition;
using Vortice.DXGI;
using Vortice.Mathematics;

namespace NotificationHubToast
{
    sealed class ParticleCompositionPresenter : IDisposable, IParticleSpriteBatchSink
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
                    Array.Resize(ref Dest, Count * 2);
                    Array.Resize(ref Transform, Count * 2);
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
        readonly IDCompositionDevice _composition;
        readonly IDXGIFactory2 _dxgiFactory;
        readonly BitmapProperties1 _targetProps;
        readonly BitmapProperties1 _spriteProps;
        readonly Dictionary<ParticleSprite, Bucket> _buckets = new Dictionary<ParticleSprite, Bucket>();
        IDXGISwapChain1 _swapChain;
        IDXGISwapChain2 _swapChain2;
        ID2D1Bitmap1 _targetBitmap;
        IntPtr _frameLatencyWaitableObject;
        IDCompositionTarget _compositionTarget;
        IDCompositionVisual _visual;
        int _width;
        int _height;
        int _epoch = -1;
        bool _open;
        bool _inDraw;
        public bool FrameSkipped { get; private set; }

        ParticleCompositionPresenter(
            ID3D11Device d3d,
            ID3D11DeviceContext d3dContext,
            ID2D1Factory4 factory,
            ID2D1Device3 device,
            ID2D1DeviceContext3 dc,
            ID2D1SpriteBatch batch,
            IDCompositionDevice composition,
            IDXGIFactory2 dxgiFactory)
        {
            _d3d = d3d;
            _d3dContext = d3dContext;
            _factory = factory;
            _device = device;
            _dc = dc;
            _batch = batch;
            _composition = composition;
            _dxgiFactory = dxgiFactory;
            _targetProps = new BitmapProperties1(
                new PixelFormat(Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Premultiplied),
                96f,
                96f,
                BitmapOptions.Target | BitmapOptions.CannotDraw);
            _spriteProps = new BitmapProperties1(
                new PixelFormat(Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Premultiplied),
                96f,
                96f,
                BitmapOptions.None);
        }

        public static ParticleCompositionPresenter TryCreate()
        {
            ID3D11Device d3d = null;
            ID3D11DeviceContext d3dContext = null;
            ID2D1Factory4 factory = null;
            IDXGIDevice dxgiDevice = null;
            ID2D1Device3 device = null;
            ID2D1DeviceContext3 dc = null;
            ID2D1SpriteBatch batch = null;
            IDCompositionDevice composition = null;
            IDXGIFactory2 dxgiFactory = null;
            ParticleCompositionPresenter presenter = null;
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
                dxgiDevice = d3d.QueryInterface<IDXGIDevice>();
                device = factory.CreateDevice(dxgiDevice);
                dc = device.CreateDeviceContext(DeviceContextOptions.None);
                dc.UnitMode = UnitMode.Pixels;
                batch = dc.CreateSpriteBatch();
                composition = DComp.DCompositionCreateDevice<IDCompositionDevice>(dxgiDevice);
                dxgiFactory = DXGI.CreateDXGIFactory2<IDXGIFactory2>(false);
                presenter = new ParticleCompositionPresenter(d3d, d3dContext, factory, device, dc, batch, composition, dxgiFactory);
                d3d = null;
                d3dContext = null;
                factory = null;
                device = null;
                dc = null;
                batch = null;
                composition = null;
                dxgiFactory = null;
                dxgiDevice.Dispose();
                dxgiDevice = null;

                using (var probe = presenter.CreateSwapChain(1, 1)) { }
                return presenter;
            }
            catch
            {
                if (presenter != null)
                {
                    presenter.Dispose();
                    return null;
                }
                if (dxgiFactory != null) dxgiFactory.Dispose();
                if (composition != null) composition.Dispose();
                if (batch != null) batch.Dispose();
                if (dc != null) dc.Dispose();
                if (device != null) device.Dispose();
                if (dxgiDevice != null) dxgiDevice.Dispose();
                if (factory != null) factory.Dispose();
                if (d3dContext != null) d3dContext.Dispose();
                if (d3d != null) d3d.Dispose();
                return null;
            }
        }

        [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
        static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        IDXGISwapChain1 CreateSwapChain(int width, int height)
        {
            var description = new SwapChainDescription1
            {
                Width = (uint)width,
                Height = (uint)height,
                Format = Format.B8G8R8A8_UNorm,
                Stereo = false,
                SampleDescription = new SampleDescription(1, 0),
                BufferUsage = Usage.RenderTargetOutput,
                BufferCount = 2,
                Scaling = Scaling.Stretch,
                SwapEffect = SwapEffect.FlipSequential,
                AlphaMode = Vortice.DXGI.AlphaMode.Premultiplied,
                Flags = SwapChainFlags.FrameLatencyWaitableObject,
            };
            return _dxgiFactory.CreateSwapChainForComposition(_d3d, description);
        }

        public bool Begin(int width, int height, int spriteEpoch)
        {
            if (width <= 0 || height <= 0) return false;
            FrameSkipped = false;
            ResetBuckets(spriteEpoch);
            try
            {
                EnsureSwapChain(width, height);
                var waitResult = WaitForSingleObject(_frameLatencyWaitableObject, 0);
                if (waitResult == 0x00000102)
                {
                    FrameSkipped = true;
                    return false;
                }
                if (waitResult != 0)
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                ResizeSwapChainIfNeeded(width, height);
                BindCurrentBackBuffer();
                _dc.Transform = Matrix3x2.Identity;
                _open = true;
                return true;
            }
            catch
            {
                ReleaseTarget();
                return false;
            }
        }

        void ResetBuckets(int spriteEpoch)
        {
            if (spriteEpoch != _epoch)
            {
                foreach (var bucket in _buckets.Values)
                    if (bucket.Bitmap != null) bucket.Bitmap.Dispose();
                _buckets.Clear();
                _epoch = spriteEpoch;
                return;
            }
            foreach (var bucket in _buckets.Values) bucket.Count = 0;
        }

        void EnsureSwapChain(int width, int height)
        {
            if (_swapChain == null)
            {
                _swapChain = CreateSwapChain(width, height);
                _swapChain2 = _swapChain.QueryInterface<IDXGISwapChain2>();
                _swapChain2.MaximumFrameLatency = 1;
                _frameLatencyWaitableObject = _swapChain2.FrameLatencyWaitableObject;
                if (_frameLatencyWaitableObject == IntPtr.Zero) throw new InvalidOperationException("DXGI frame-latency waitable object is unavailable.");
                _width = width;
                _height = height;
                return;
            }
        }

        void ResizeSwapChainIfNeeded(int width, int height)
        {
            if (_width == width && _height == height) return;
            _dc.Target = null;
            if (_targetBitmap != null) { _targetBitmap.Dispose(); _targetBitmap = null; }
            _swapChain.ResizeBuffers(2, (uint)width, (uint)height, Format.B8G8R8A8_UNorm, SwapChainFlags.FrameLatencyWaitableObject).CheckError();
            _width = width;
            _height = height;
        }

        void BindCurrentBackBuffer()
        {
            _dc.Target = null;
            if (_targetBitmap != null) { _targetBitmap.Dispose(); _targetBitmap = null; }
            using (var surface = _swapChain.GetBuffer<IDXGISurface>(0))
                _targetBitmap = _dc.CreateBitmapFromDxgiSurface(surface, _targetProps);
            _dc.Target = _targetBitmap;
        }

        public void Add(ParticleSprite sprite, float left, float top, float right, float bottom, float rotationDegrees, float x, float y)
        {
            if (sprite == null || sprite.Image == null) return;
            Bucket bucket;
            if (!_buckets.TryGetValue(sprite, out bucket))
            {
                var image = sprite.Image;
                var data = image.LockBits(new Rectangle(0, 0, image.Width, image.Height), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
                try
                {
                    bucket = new Bucket { Bitmap = _dc.CreateBitmap(new SizeI(image.Width, image.Height), data.Scan0, (uint)data.Stride, _spriteProps) };
                }
                finally { image.UnlockBits(data); }
                _buckets.Add(sprite, bucket);
            }
            float radians = rotationDegrees * ((float)Math.PI / 180f);
            bucket.Add(
                new RawRectF(left, top, right, bottom),
                Matrix3x2.CreateRotation(radians) * Matrix3x2.CreateTranslation(x, y));
        }

        public bool End(IntPtr hwnd, int width, int height)
        {
            if (!_open) return false;
            _open = false;
            try
            {
                EnsureCompositionTarget(hwnd);
                _dc.BeginDraw();
                _inDraw = true;
                _dc.AntialiasMode = AntialiasMode.Aliased;
                _dc.Clear(new Color4(0f, 0f, 0f, 0f));
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
                    _dc.DrawSpriteBatch(_batch, 0, (uint)bucket.Count, bucket.Bitmap, Vortice.Direct2D1.BitmapInterpolationMode.Linear, SpriteOptions.None);
                }
                var drawResult = _dc.EndDraw();
                _inDraw = false;
                _dc.Target = null;
                if (_targetBitmap != null) { _targetBitmap.Dispose(); _targetBitmap = null; }
                if (drawResult.Failure) return false;
                if (_swapChain.Present(0, PresentFlags.None).Failure) return false;
                return true;
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

        void EnsureCompositionTarget(IntPtr hwnd)
        {
            if (_compositionTarget != null) return;
            _composition.CreateTargetForHwnd(hwnd, true, out _compositionTarget);
            _visual = _composition.CreateVisual();
            _visual.SetContent(_swapChain);
            _compositionTarget.SetRoot(_visual);
            _composition.Commit().CheckError();
        }

        public void ReleaseTarget()
        {
            _open = false;
            if (_dc != null) _dc.Target = null;
            if (_compositionTarget != null)
            {
                try { _compositionTarget.SetRoot(null); _composition.Commit(); } catch { }
                _compositionTarget.Dispose();
                _compositionTarget = null;
            }
            if (_visual != null)
            {
                try { _visual.SetContent(null); } catch { }
                _visual.Dispose();
                _visual = null;
            }
            if (_targetBitmap != null) { _targetBitmap.Dispose(); _targetBitmap = null; }
            if (_swapChain2 != null) { _swapChain2.Dispose(); _swapChain2 = null; }
            if (_swapChain != null) { _swapChain.Dispose(); _swapChain = null; }
            _frameLatencyWaitableObject = IntPtr.Zero;
            _width = 0;
            _height = 0;
        }

        public void Dispose()
        {
            if (_inDraw)
            {
                try { _dc.EndDraw(); } catch { }
                _inDraw = false;
            }
            foreach (var bucket in _buckets.Values)
                if (bucket.Bitmap != null) bucket.Bitmap.Dispose();
            _buckets.Clear();
            ReleaseTarget();
            _batch.Dispose();
            _dc.Dispose();
            _device.Dispose();
            _factory.Dispose();
            _composition.Dispose();
            _dxgiFactory.Dispose();
            _d3dContext.Dispose();
            _d3d.Dispose();
        }
    }
}
