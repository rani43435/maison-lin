"""Real-ESRGAN x4 (RRDBNet) on CPU: makes small shop photos sharp enough for a 2K garment texture.
The weights (67 MB) are downloaded once into ~/.cache/maison-lin. If torch or the download is missing,
upscale() returns None and the caller keeps the original photo."""
import os, urllib.request
import numpy as np

URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth'
CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'maison-lin', 'RealESRGAN_x4plus.pth')
_net = None


def _build():
    import torch, torch.nn as nn, torch.nn.functional as F

    class RDB(nn.Module):
        def __init__(s, nf=64, gc=32):
            super().__init__()
            s.conv1 = nn.Conv2d(nf, gc, 3, 1, 1); s.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1)
            s.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1); s.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1)
            s.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1); s.lrelu = nn.LeakyReLU(0.2, True)

        def forward(s, x):
            x1 = s.lrelu(s.conv1(x)); x2 = s.lrelu(s.conv2(torch.cat((x, x1), 1)))
            x3 = s.lrelu(s.conv3(torch.cat((x, x1, x2), 1))); x4 = s.lrelu(s.conv4(torch.cat((x, x1, x2, x3), 1)))
            return s.conv5(torch.cat((x, x1, x2, x3, x4), 1)) * 0.2 + x

    class RRDB(nn.Module):
        def __init__(s, nf=64):
            super().__init__(); s.rdb1 = RDB(nf); s.rdb2 = RDB(nf); s.rdb3 = RDB(nf)

        def forward(s, x): return s.rdb3(s.rdb2(s.rdb1(x))) * 0.2 + x

    class Net(nn.Module):
        def __init__(s, nf=64, nb=23):
            super().__init__()
            s.conv_first = nn.Conv2d(3, nf, 3, 1, 1); s.body = nn.Sequential(*[RRDB(nf) for _ in range(nb)])
            s.conv_body = nn.Conv2d(nf, nf, 3, 1, 1); s.conv_up1 = nn.Conv2d(nf, nf, 3, 1, 1)
            s.conv_up2 = nn.Conv2d(nf, nf, 3, 1, 1); s.conv_hr = nn.Conv2d(nf, nf, 3, 1, 1)
            s.conv_last = nn.Conv2d(nf, 3, 3, 1, 1); s.lrelu = nn.LeakyReLU(0.2, True)

        def forward(s, x):
            f = s.conv_first(x); f = f + s.conv_body(s.body(f))
            f = s.lrelu(s.conv_up1(F.interpolate(f, scale_factor=2, mode='nearest')))
            f = s.lrelu(s.conv_up2(F.interpolate(f, scale_factor=2, mode='nearest')))
            return s.conv_last(s.lrelu(s.conv_hr(f)))

    if not os.path.exists(CACHE):
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        print('  downloading Real-ESRGAN weights…'); urllib.request.urlretrieve(URL, CACHE + '.part'); os.replace(CACHE + '.part', CACHE)
    sd = torch.load(CACHE, map_location='cpu', weights_only=True)
    sd = sd.get('params_ema', sd.get('params', sd))
    net = Net(); net.load_state_dict(sd); net.eval()
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    return net


def upscale(rgb, tile=192, pad=12):
    """rgb uint8 HxWx3 -> uint8 (4H)x(4W)x3, or None when it can't run"""
    global _net
    try:
        import torch
        if _net is None: _net = _build()
    except Exception as e:
        print('  upscale unavailable:', e); return None
    x = torch.from_numpy(rgb.astype(np.float32) / 255).permute(2, 0, 1)[None]
    _, _, H, W = x.shape; out = torch.zeros(1, 3, H * 4, W * 4)
    with torch.no_grad():
        for y0 in range(0, H, tile):
            for x0 in range(0, W, tile):
                ya, xa = max(y0 - pad, 0), max(x0 - pad, 0); yb, xb = min(y0 + tile + pad, H), min(x0 + tile + pad, W)
                r = _net(x[:, :, ya:yb, xa:xb])
                ty, tx = min(tile, H - y0), min(tile, W - x0)
                out[:, :, y0 * 4:(y0 + ty) * 4, x0 * 4:(x0 + tx) * 4] = r[:, :, (y0 - ya) * 4:(y0 - ya + ty) * 4, (x0 - xa) * 4:(x0 - xa + tx) * 4]
    return (out[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255 + 0.5).astype(np.uint8)
