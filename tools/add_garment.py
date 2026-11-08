#!/usr/bin/env python3
"""
Add a garment to Maison Lin from two photos (front + back).

  python3 tools/add_garment.py front.jpg back.jpg --type hoodie --name "Le Hoodie Gris" \
      --color "Gris" --price 240

What it does
  1. cuts the garment out of each photo (rembg, falls back to a flood fill on plain backgrounds)
  2. removes most of the baked-in light so the 3D lights do the shading
  3. measures the photo (collar top, hem, torso width) and the 3D template the same way
  4. projects the front photo onto the front of the rigged template and the back photo onto its back
     (as a second UV set), so the piece keeps the rig: it swings on the rope and follows you in AR
  5. writes assets/custom/<id>.glb + <id>.jpg and adds the product to assets/custom/products.json

Templates (--type): hoodie, hoodie-pocket, knit (crewneck sweatshirt / pullover), polo
Photos work best: whole garment visible, front and back from the same distance, plain background,
sleeves hanging down (ghost mannequin, hanger or worn) — flat-lays work too, sleeves get the fabric colour.
"""
import argparse, json, os, re, struct, sys, unicodedata
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')
OUT = os.path.join(ASSETS, 'custom')
HALF = 1024  # atlas: front in the left square, back in the right square

DEFAULTS = {
    'hoodie':        dict(fabric='fleece', line='Molleton', desc='A soft, heavy brushed-back fleece hoodie with a deep hood and dropped shoulders.',
                          details=[['Fabric', '100% cotton fleece'], ['Fit', 'Relaxed'], ['Care', 'Wash cold, inside out']]),
    'hoodie-pocket': dict(fabric='fleece', line='Molleton', desc='A wide, boxy hoodie with a kangaroo pocket in a loopback fleece that keeps its shape.',
                          details=[['Fabric', 'Cotton loopback fleece'], ['Fit', 'Wide and boxy'], ['Care', 'Wash cold, inside out']]),
    'knit':          dict(fabric='knit', line='Maille', desc='A clean crewneck with ribbed cuffs and hem, soft against the skin.',
                          details=[['Fabric', 'Cotton blend'], ['Fit', 'Easy'], ['Care', 'Wash cold, dry flat']]),
    'polo':          dict(fabric='pique', line='Piqué', desc='A long-sleeve polo in a fine cotton piqué with a soft collar.',
                          details=[['Fabric', 'Cotton piqué'], ['Fit', 'Regular'], ['Care', 'Wash at 30°']]),
}


# ---------------------------------------------------------------- photo ----
def cutout(path):
    img = Image.open(path).convert('RGB')
    img.thumbnail((1600, 1600))
    a = None
    try:
        from rembg import remove, new_session
        sess = new_session('isnet-general-use')
        a = np.array(remove(img, session=sess, post_process_mask=True))[..., 3]
    except Exception as e:  # offline or model missing: flood fill from the border
        print('  rembg unavailable, using flood fill:', e)
    rgb = np.array(img).astype(np.float32)
    if a is None or (a > 128).mean() < 0.03:
        border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
        bg = np.median(border, 0)
        dist = np.linalg.norm(rgb - bg, axis=2)
        fg = dist > max(18, np.percentile(np.linalg.norm(border - bg, axis=1), 98) + 8)
        fg = ndimage.binary_opening(fg, iterations=2)
        a = fg.astype(np.uint8) * 255
    m = a > 128
    lab, n = ndimage.label(m)
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        m = lab == (1 + int(np.argmax(sizes)))
    m = ndimage.binary_fill_holes(m)
    return rgb, m


def delight(rgb, m, amount=0.55):
    """flatten the large-scale shading baked into the photo, keep prints and fine texture"""
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    w = m.astype(np.float32)
    sig = max(rgb.shape[:2]) / 18
    num = ndimage.gaussian_filter(lum * w, sig); den = ndimage.gaussian_filter(w, sig) + 1e-4
    low = num / den
    mean = lum[m].mean()
    gain = (mean / np.maximum(low, 8)) ** amount
    out = np.clip(rgb * gain[..., None], 0, 255)
    return out


def remove_neck_label(rgb, m, meas):
    """the care label inside the back neck shows through the collar on front photos: paint it out"""
    try:
        import cv2
    except Exception:
        return rgb
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    H, W = m.shape
    y0, y1 = int(meas['top']), int(meas['top'] + 0.14 * (meas['hem'] - meas['top']))
    x0, x1 = int(meas['cx'] - 0.3 * meas['half']), int(meas['cx'] + 0.3 * meas['half'])
    band = np.zeros_like(m); band[y0:y1, x0:x1] = True
    hot = band & m & (lum > np.median(lum[m]) + 70)
    if hot.sum() == 0 or hot.sum() > 0.02 * m.sum(): return rgb
    hot = ndimage.binary_dilation(hot, iterations=4)
    out = cv2.inpaint(np.clip(rgb, 0, 255).astype(np.uint8), hot.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA)
    return out.astype(np.float32)


def fill_background(rgb, m):
    """push the garment colour into the background so edges never sample the backdrop"""
    core = ndimage.binary_erosion(m, iterations=max(4, int(max(m.shape) / 160)))  # skip the soft rim (it carries backdrop colour)
    if core.sum() < 100: core = m
    _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    near = rgb[iy, ix]
    # outside the garment: a soft average of the nearby fabric instead of streaks
    sig = max(rgb.shape[:2]) / 40
    w = core.astype(np.float32)
    soft = np.stack([ndimage.gaussian_filter(rgb[..., c] * w, sig) for c in range(3)], -1) / (ndimage.gaussian_filter(w, sig)[..., None] + 1e-4)
    far = ndimage.gaussian_filter(np.minimum(ndimage.distance_transform_edt(~core), 14) / 14, 2)[..., None]
    out = near * (1 - far) + soft * far
    out = np.where(far > 0.98, np.median(rgb[core], 0), out)
    out[core] = rgb[core]
    return out


def measure(m):
    """collar/hood top, hem and torso half-width of a garment mask (pixels)"""
    ys, xs = np.nonzero(m)
    cx = float(np.median(xs))
    band = m[:, int(cx - m.shape[1] * 0.04):int(cx + m.shape[1] * 0.04) + 1].any(1)
    rows = np.nonzero(band)[0]
    top, hem = float(rows.min()), float(rows.max())
    def run(r):
        row = m[int(r)]; c = int(round(cx))
        if not row[c]:
            near = np.nonzero(row)[0]
            if not len(near): return None
            c = near[np.argmin(abs(near - c))]
        l = c
        while l > 0 and row[l - 1]: l -= 1
        r_ = c
        while r_ < len(row) - 1 and row[r_ + 1]: r_ += 1
        return l, r_
    hw = []
    for f in (0.62, 0.68, 0.74, 0.80):
        rr = run(top + f * (hem - top))
        if rr: hw.append((rr[1] - rr[0]) / 2); cx_r = (rr[0] + rr[1]) / 2
    # sleeves hanging close to the body join the torso run: take the narrowest row
    half = float(min(hw)) if hw else (xs.max() - xs.min()) / 4
    # sleeves touching the body: the torso ends where the lowest point of a column jumps away from the hem
    H, W = m.shape
    bottom = np.where(m.any(0), H - 1 - np.argmax(m[::-1], 0), -1)
    tol = 0.035 * (hem - top)
    def edge(dir):
        x = int(round(cx))
        while 0 < x < W - 1 and bottom[x + dir] >= 0 and abs(bottom[x + dir] - hem) < tol: x += dir
        return abs(x - cx)
    col = min(edge(-1), edge(1))
    if col > 0.15 * (hem - top): half = min(half, col)
    return dict(cx=cx, top=top, hem=hem, half=half)


def sleeve_boxes(m, meas):
    """bounding boxes (x0, y0, x1, y1) of the parts of the mask left and right of the torso"""
    H, W = m.shape
    xs = np.arange(W)[None, :]
    out = {}
    for side, sel in (('l', xs < meas['cx'] - meas['half'] * 1.04), ('r', xs > meas['cx'] + meas['half'] * 1.04)):
        mm = m & sel
        mm[: int(meas['top'] + 0.05 * (meas['hem'] - meas['top']))] = False
        ys, xx = np.nonzero(mm)
        if len(xx) < 200: out[side] = None; continue
        out[side] = sleeve_frame(np.stack([xx, ys], 1).astype(np.float64), (meas['cx'], meas['top']), -1 if side == 'l' else 1)
    return out


def sleeve_frame(P, shoulder, outward):
    """principal axis of a sleeve (pixels): mean, along-axis unit (shoulder -> cuff), across unit (away from body), extents"""
    if len(P) > 20000: P = P[np.random.default_rng(0).choice(len(P), 20000, replace=False)]
    mu = P.mean(0); C = np.cov((P - mu).T); w, V = np.linalg.eigh(C)
    e1 = V[:, 1]; e2 = np.array([-e1[1], e1[0]])
    if np.dot(np.array(shoulder) - mu, e1) > 0: e1 = -e1
    if e2[0] * outward < 0: e2 = -e2
    a = (P - mu) @ e1; b = (P - mu) @ e2
    return dict(mu=mu, e1=e1, e2=e2, a0=np.percentile(a, 1), a1=np.percentile(a, 99.5), b0=np.percentile(b, 2), b1=np.percentile(b, 98))


def fabric_tile(rgb, m, meas, size=512):
    """a plain patch of the fabric (no print), mirrored into a seamless tile — dresses the sides of the piece"""
    core = ndimage.binary_erosion(m, iterations=12)
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    g = np.hypot(ndimage.sobel(lum, 0), ndimage.sobel(lum, 1))
    side = int(max(24, meas['half'] * 0.35))
    best, bxy = None, None
    for y in range(int(meas['top'] + 0.15 * (meas['hem'] - meas['top'])), int(meas['hem'] - side), max(4, side // 4)):
        for x in range(int(meas['cx'] - meas['half']), int(meas['cx'] + meas['half'] - side), max(4, side // 4)):
            if not core[y:y + side, x:x + side].all(): continue
            win = lum[y:y + side, x:x + side]
            score = g[y:y + side, x:x + side].mean() + 3 * abs(win.mean() - np.median(lum[core]))  # plain and typical
            if best is None or score < best: best, bxy = score, (x, y)
    if bxy is None:
        col = np.median(rgb[m], 0); p = np.ones((side, side, 3)) * col
    else:
        x, y = bxy; p = rgb[y:y + side, x:x + side]
    t = np.concatenate([np.concatenate([p, p[:, ::-1]], 1), np.concatenate([p[::-1], p[::-1, ::-1]], 1)], 0)
    return Image.fromarray(np.clip(t, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------- glb ----
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    off = 12; js = None; bin_ = b''
    while off < len(b):
        ln, typ = struct.unpack_from('<II', b, off); off += 8
        chunk = b[off:off + ln]; off += ln
        if typ == 0x4E4F534A: js = json.loads(chunk)
        elif typ == 0x004E4942: bin_ = chunk
    return js, bin_


def acc_read(js, bin_, i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0) or dt.itemsize * n
    raw = np.frombuffer(bin_, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=start)
    if stride == dt.itemsize * n:
        arr = raw.view(dt).reshape(a['count'], n)
    else:
        arr = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], dt.itemsize * n), strides=(stride, 1)).copy().view(dt).reshape(a['count'], n)
    return arr.copy(), a


def write_glb(path, js, arrays):
    """arrays: list of (numpy array, accessor-template dict, target or None); rebuilds buffer + views + accessors"""
    blob = bytearray(); views = []; accs = []
    for arr, tmpl, target in arrays:
        while len(blob) % 4: blob.append(0)
        data = np.ascontiguousarray(arr).tobytes()
        v = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
        if target: v['target'] = target
        views.append(v); blob += data
        a = {k: tmpl[k] for k in tmpl if k not in ('bufferView', 'byteOffset', 'min', 'max', 'count', 'sparse')}
        a['bufferView'] = len(views) - 1; a['count'] = int(arr.shape[0])
        if tmpl.get('type') == 'VEC3' and tmpl.get('componentType') == 5126 and 'min' in tmpl:
            a['min'] = arr.min(0).astype(float).tolist(); a['max'] = arr.max(0).astype(float).tolist()
        accs.append(a)
    while len(blob) % 4: blob.append(0)
    js['bufferViews'] = views; js['accessors'] = accs
    js['buffers'] = [{'byteLength': len(blob)}]
    j = json.dumps(js, separators=(',', ':')).encode()
    while len(j) % 4: j += b' '
    total = 12 + 8 + len(j) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j)
        f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)


def template_silhouette(prims, px=1024):
    """rasterise the front of the template; returns mask + mapping metres->pixels"""
    P = np.concatenate([p['pos'] for p in prims])
    x0, x1 = P[:, 0].min(), P[:, 0].max(); y0, y1 = P[:, 1].min(), P[:, 1].max()
    s = (px * 0.9) / max(x1 - x0, y1 - y0)
    ox = px / 2 - (x0 + x1) / 2 * s; oy = px / 2 + (y0 + y1) / 2 * s
    to_px = lambda x, y: (x * s + ox, oy - y * s)
    im = Image.new('L', (px, px), 0); d = ImageDraw.Draw(im)
    for p in prims:
        V = p['pos']; I = p['idx']
        for t in I:
            pts = [to_px(V[k, 0], V[k, 1]) for k in t]
            d.polygon(pts, fill=255)
    m = np.array(im) > 128
    m = ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=2))
    return m, to_px


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('front'); ap.add_argument('back')
    ap.add_argument('--type', default='hoodie', choices=list(DEFAULTS))
    ap.add_argument('--name', required=True); ap.add_argument('--color', default='')
    ap.add_argument('--price', type=int, default=200)
    ap.add_argument('--desc', default=None); ap.add_argument('--id', default=None)
    ap.add_argument('--keep-light', action='store_true', help='keep the photo shading as it is')
    a = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    plain = unicodedata.normalize('NFKD', f'{a.name}-{a.color}').encode('ascii', 'ignore').decode()
    gid = a.id or re.sub(r'[^a-z0-9]+', '-', plain.lower()).strip('-')
    print(f'· {gid}  ({a.type})')

    # photos
    sides = {}
    for side, path in (('front', a.front), ('back', a.back)):
        rgb, m = cutout(path)
        if not a.keep_light: rgb = delight(rgb, m)
        meas = measure(m)
        if side == 'front': rgb = remove_neck_label(rgb, m, meas)
        rgb = fill_background(rgb, m)
        sides[side] = dict(rgb=rgb, m=m, meas=meas)
        sides[side]['sleeves'] = sleeve_boxes(m, sides[side]['meas'])
        print(f'  {side}: {m.shape[1]}x{m.shape[0]}  garment {m.mean() * 100:.0f}%  {sides[side]["meas"]}')

    # atlas: each photo letterboxed into a HALF x HALF square (garment colour around it)
    atlas = Image.new('RGB', (HALF * 2, HALF))
    place = {}
    for k, side in enumerate(('front', 'back')):
        rgb = sides[side]['rgb']; h, w = rgb.shape[:2]
        sc = HALF / max(w, h); W, H = int(round(w * sc)), int(round(h * sc))
        ox, oy = (HALF - W) // 2, (HALF - H) // 2
        sq = Image.new('RGB', (HALF, HALF), tuple(int(c) for c in np.median(rgb[sides[side]['m']], 0)))
        sq.paste(Image.fromarray(rgb.astype(np.uint8)).resize((W, H), Image.LANCZOS), (ox, oy))
        atlas.paste(sq, (k * HALF, 0))
        place[side] = (sc, ox + k * HALF, oy)
    atlas = atlas.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
    atlas.save(os.path.join(OUT, f'{gid}.jpg'), quality=88)
    fabric_tile(sides['front']['rgb'], sides['front']['m'], sides['front']['meas']).save(os.path.join(OUT, f'{gid}_fabric.jpg'), quality=88)

    # template
    js, bin_ = read_glb(os.path.join(ASSETS, f'{a.type}.glb'))
    fabric_prims = []
    for mi, mesh in enumerate(js['meshes']):
        for pi, p in enumerate(mesh['primitives']):
            mat = js['materials'][p['material']]['name'] if 'material' in p else ''
            if mat.startswith('Occluder'): continue
            pos, _ = acc_read(js, bin_, p['attributes']['POSITION'])
            idx, _ = acc_read(js, bin_, p['indices'])
            fabric_prims.append(dict(mi=mi, pi=pi, pos=pos.astype(np.float64), idx=idx.reshape(-1, 3).astype(np.int64)))
    tm, to_px = template_silhouette(fabric_prims)
    T = measure(tm)
    print('  template:', T)
    # arm weight per vertex (upper arm + forearm joints)
    skin_of_mesh = {n['mesh']: n['skin'] for n in js['nodes'] if 'mesh' in n and 'skin' in n}
    def arm_weight(mi, p):
        if mi not in skin_of_mesh or 'JOINTS_0' not in p['attributes']: return None
        names = [js['nodes'][j].get('name', '') for j in js['skins'][skin_of_mesh[mi]]['joints']]
        isarm = np.array(['arm' in nm for nm in names])
        J, _ = acc_read(js, bin_, p['attributes']['JOINTS_0']); Wt, wt = acc_read(js, bin_, p['attributes']['WEIGHTS_0'])
        Wt = Wt.astype(np.float64)
        if wt.get('normalized') and wt['componentType'] != 5126: Wt /= np.iinfo(CT[wt['componentType']]).max
        return (Wt * isarm[J.astype(int)]).sum(1)
    # template sleeve boxes (front view, pixels) from the arm-weighted vertices
    tsl = {'l': [], 'r': []}
    for fp in fabric_prims:
        w = arm_weight(fp['mi'], js['meshes'][fp['mi']]['primitives'][fp['pi']])
        if w is None: continue
        P = fp['pos'][w > 0.6]
        tx, ty = to_px(P[:, 0], P[:, 1])
        for k, sel in (('l', tx < T['cx']), ('r', tx >= T['cx'])):
            if sel.any(): tsl[k].append(np.stack([tx[sel], ty[sel]], 1))
    TS = {k: sleeve_frame(np.concatenate(v), (T['cx'], T['top']), -1 if k == 'l' else 1) if v else None for k, v in tsl.items()}
    ang = lambda f: f and round(float(np.degrees(np.arctan2(f['e1'][1], f['e1'][0]))))
    print('  sleeve axis (deg): template', {k: ang(v) for k, v in TS.items()}, 'photo', {sd: {k: ang(v) for k, v in sides[sd]['sleeves'].items()} for sd in sides})

    def uv_for(side, X, Y, arm=None):
        """template metres -> atlas uv for one side (back is seen mirrored); sleeves map onto the photo's sleeves"""
        S = sides[side]['meas']; sc, ox, oy = place[side]
        xs = -X if side == 'back' else X
        tx, ty = to_px(xs, Y)
        px_ = S['cx'] + (tx - T['cx']) * (S['half'] / T['half'])
        py_ = S['top'] + (ty - T['top']) * ((S['hem'] - S['top']) / (T['hem'] - T['top']))
        if arm is not None:
            for k in ('l', 'r'):
                tb, pb = TS.get(k), sides[side]['sleeves'].get(k)
                if tb is None or pb is None: continue
                sel = (tx < T['cx']) if k == 'l' else (tx >= T['cx'])
                # along / across the sleeve axis, template sleeve -> photo sleeve
                d = np.stack([tx, ty], 1) - tb['mu']
                t = ((d @ tb['e1']) - tb['a0']) / (tb['a1'] - tb['a0'])
                q = 0.06 + 0.88 * ((d @ tb['e2']) - tb['b0']) / (tb['b1'] - tb['b0'])  # stay inside the photo's sleeve
                pa = pb['a0'] + t * (pb['a1'] - pb['a0']); pq = pb['b0'] + q * (pb['b1'] - pb['b0'])
                pt = pb['mu'] + pa[:, None] * pb['e1'] + pq[:, None] * pb['e2']
                sx, sy = pt[:, 0], pt[:, 1]
                w = np.clip((arm - 0.35) / 0.4, 0, 1); w = w * w * (3 - 2 * w); w = np.where(sel, w, 0)
                px_ = px_ * (1 - w) + sx * w; py_ = py_ * (1 - w) + sy * w
        u = (px_ * sc + ox) / (HALF * 2); v = (py_ * sc + oy) / HALF
        return np.stack([u, v], 1)

    # every accessor is re-written; fabric primitives get split front/back vertices and a photo UV
    new_arrays = []
    def push(arr, tmpl, target=None):
        new_arrays.append((arr, tmpl, target)); return len(new_arrays) - 1
    acc_map = {}
    for mi, mesh in enumerate(js['meshes']):
        for pi, p in enumerate(mesh['primitives']):
            mat = js['materials'][p['material']]['name'] if 'material' in p else ''
            attrs = {}
            for k, ai in p['attributes'].items():
                attrs[k] = acc_read(js, bin_, ai)
            idx, idx_t = acc_read(js, bin_, p['indices'])
            idx = idx.reshape(-1, 3).astype(np.int64)
            if not mat.startswith('Occluder'):
                pos = attrs['POSITION'][0].astype(np.float64)
                n = np.cross(pos[idx[:, 1]] - pos[idx[:, 0]], pos[idx[:, 2]] - pos[idx[:, 0]])
                nrm = attrs['NORMAL'][0].astype(np.float64)
                fz = np.sign(n[:, 2]) * 0.0 + nrm[idx].mean(1)[:, 2]  # vertex normals are smoother than face normals
                back_face = fz < 0
                # vertices used by back faces get their own copy
                used_back = np.zeros(len(pos), bool); used_back[idx[back_face].ravel()] = True
                used_front = np.zeros(len(pos), bool); used_front[idx[~back_face].ravel()] = True
                dup = np.nonzero(used_back & used_front)[0]
                remap = np.arange(len(pos)); remap[dup] = len(pos) + np.arange(len(dup))
                idx[back_face] = remap[idx[back_face]]
                is_back = np.concatenate([used_back & ~used_front, np.ones(len(dup), bool)])
                for k in list(attrs):
                    arr, t = attrs[k]
                    attrs[k] = (np.concatenate([arr, arr[dup]]), t)
                P2 = attrs['POSITION'][0].astype(np.float64)
                arm = None
                if 'JOINTS_0' in attrs and mi in skin_of_mesh:
                    names = [js['nodes'][j].get('name', '') for j in js['skins'][skin_of_mesh[mi]]['joints']]
                    isarm = np.array(['arm' in nm for nm in names])
                    J = attrs['JOINTS_0'][0].astype(int); Wt = attrs['WEIGHTS_0'][0].astype(np.float64); wt = attrs['WEIGHTS_0'][1]
                    if wt.get('normalized') and wt['componentType'] != 5126: Wt /= np.iinfo(CT[wt['componentType']]).max
                    arm = (Wt * isarm[J]).sum(1)
                uv = np.where(is_back[:, None], uv_for('back', P2[:, 0], P2[:, 1], arm), uv_for('front', P2[:, 0], P2[:, 1], arm)).astype(np.float32)
                uv_t = dict(attrs['TEXCOORD_0'][1]) if 'TEXCOORD_0' in attrs else {'componentType': 5126, 'type': 'VEC2'}
                for k in [k for k in attrs if k.startswith('TEXCOORD_') and k != 'TEXCOORD_0']: del attrs[k]
                attrs['TEXCOORD_1'] = (uv, uv_t)
                # how squarely each vertex faces a camera (front or back): the sides get the fabric tile instead of a stretched photo
                n2 = attrs['NORMAL'][0].astype(np.float64)
                attrs['_FACING'] = (np.abs(n2[:, 2:3] / (np.linalg.norm(n2, axis=1, keepdims=True) + 1e-9)).astype(np.float32), {'componentType': 5126, 'type': 'SCALAR'})
                print(f'  prim {mi}.{pi}: {len(pos)} → {len(P2)} verts ({back_face.mean() * 100:.0f}% back faces)')
            new_attr = {}
            for k, (arr, t) in attrs.items():
                new_attr[k] = push(arr, t, 34962)
            dt_i = np.uint32 if idx.max() > 65535 else np.uint16
            it = dict(idx_t); it['componentType'] = 5125 if dt_i == np.uint32 else 5123
            p['indices'] = push(idx.ravel().astype(dt_i).reshape(-1, 1), it, 34963)
            p['attributes'] = new_attr
    # skins (inverse bind matrices) and animations keep their data
    for s in js.get('skins', []):
        if 'inverseBindMatrices' in s:
            arr, t = acc_read(js, bin_, s['inverseBindMatrices'])
            s['inverseBindMatrices'] = push(arr, t)
    # textures of the template are not needed: the photo replaces them
    for mt in js['materials']:
        pb = mt.get('pbrMetallicRoughness', {})
        for k in ('baseColorTexture', 'metallicRoughnessTexture'): pb.pop(k, None)
        for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'): mt.pop(k, None)
        mt.pop('extensions', None)
    for k in ('textures', 'images', 'samplers'): js.pop(k, None)
    js.pop('extensionsUsed', None); js.pop('extensionsRequired', None)
    write_glb(os.path.join(OUT, f'{gid}.glb'), js, new_arrays)

    # product entry
    fm = sides['front']['m']; col = np.median(sides['front']['rgb'][fm], 0)
    hexc = '#%02X%02X%02X' % tuple(int(c) for c in col)
    d = DEFAULTS[a.type]
    pj = os.path.join(OUT, 'products.json')
    items = json.load(open(pj)) if os.path.exists(pj) else []
    items = [i for i in items if i['id'] != gid]
    items.append(dict(id=gid, base=a.type, name=a.name, color=a.color or 'Custom', hex=hexc, price=a.price,
                      fabric=d['fabric'], line=f"{d['line']} — Atelier", desc=a.desc or d['desc'], details=d['details'],
                      glb=f'assets/custom/{gid}.glb', texture=f'assets/custom/{gid}.jpg', fabricTex=f'assets/custom/{gid}_fabric.jpg', category=a.type.split('-')[0]))
    json.dump(items, open(pj, 'w'), indent=1, ensure_ascii=False)
    print(f'✓ added {gid}: {a.name} — {a.color} €{a.price}  colour {hexc}')
    print(f'  {len(items)} custom piece(s) in assets/custom/products.json')


if __name__ == '__main__':
    main()
