#!/usr/bin/env python3
"""
Front + back photo -> real 3D garment (AI shape) -> rigged GLB for Maison Lin.

  python3 tools/ai_garment.py front.jpg back.jpg --name "Le Pull Onyx" --color "Cacao" --price 290 [--type knit]

1. Hunyuan3D-2mv (Hugging Face Space) builds the shape from both photos — the true silhouette, sleeves included
2. Blender: clean + decimate, scale to the store's size, skeleton (chest, spine, hips, neck, shoulders, arms) + weights
3. the photos are projected onto that shape (front faces <- front photo, back faces <- back photo); the sides get
   a seamless tile of the same fabric, so nothing is stretched
4. writes assets/custom/<id>.glb/.jpg/_fabric.jpg and the entry in assets/custom/products.json
Needs: pip install bpy gradio_client rembg onnxruntime scipy pillow numpy
"""
import argparse, json, os, re, sys, time, unicodedata, shutil
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import add_garment as AG  # photo helpers (cut-out, de-light, fill, label, fabric tile)

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'assets', 'custom')
HALF = 1024
# store proportions (same family as the hand-made pieces): collar top / hem height, metres
COLLAR_Y, HEM_Y = 1.47, 0.86


def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def ai_shape(front, back, out, seed=1234, tries=3):
    from gradio_client import Client, handle_file
    last = None
    for k in range(tries):
        try:
            c = Client('tencent/Hunyuan3D-2mv', verbose=False)
            r = c.predict(caption='', image=None, mv_image_front=handle_file(front), mv_image_back=handle_file(back),
                          mv_image_left=None, mv_image_right=None, steps=30, guidance_scale=5, seed=seed + k,
                          octree_resolution=256, check_box_rembg=True, num_chunks=8000, api_name='/shape_generation')
            path = r[0]['value'] if isinstance(r[0], dict) else r[0]
            shutil.copy(path, out); return out
        except Exception as e:
            last = e; print('  shape attempt failed:', str(e)[:160]); time.sleep(5)
    raise SystemExit(f'AI shape failed: {last}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('front'); ap.add_argument('back')
    ap.add_argument('--name', required=True); ap.add_argument('--color', default='')
    ap.add_argument('--price', type=int, default=250); ap.add_argument('--desc', default=None)
    ap.add_argument('--type', default='knit', choices=list(AG.DEFAULTS))
    ap.add_argument('--id', default=None); ap.add_argument('--shape', default=None, help='reuse a shape .glb')
    ap.add_argument('--faces', type=int, default=36000)
    ap.add_argument('--out', default=None, help='output folder (default assets/custom)')
    ap.add_argument('--no-catalog', action='store_true', help='do not touch products.json (used by the Supabase builder)')
    a = ap.parse_args()
    t0 = time.time()
    global OUT
    if a.out: OUT = a.out
    os.makedirs(OUT, exist_ok=True)
    plain = unicodedata.normalize('NFKD', f'{a.name}-{a.color}').encode('ascii', 'ignore').decode()
    gid = a.id or re.sub(r'[^a-z0-9]+', '-', plain.lower()).strip('-')
    print(f'· {gid}')

    # ---- photos
    sides = {}
    for side, path in (('front', a.front), ('back', a.back)):
        rgb, m = AG.cutout(path)
        rgb = AG.delight(rgb, m)
        meas = AG.measure(m)
        if side == 'front': rgb = AG.remove_neck_label(rgb, m, meas)
        ys, xs = np.nonzero(m)
        sides[side] = dict(rgb=AG.fill_background(rgb, m), raw=rgb, m=m, meas=meas,
                           bbox=(xs.min(), ys.min(), xs.max(), ys.max()))
    # ---- shape: the photo's own silhouette, inflated — torso as a soft slab, each sleeve as its own tube
    import bpy, bmesh, collections
    from mathutils import Vector
    from scipy import ndimage as ndi
    bpy.ops.wm.read_factory_settings(use_empty=True)
    F = sides['front']; Fm = F['meas']; m = F['m']
    kpx = (COLLAR_Y - HEM_Y) / (Fm['hem'] - Fm['top'])          # metres per photo pixel
    step = max(1, int(round(0.0045 / kpx)))                      # ~4.5 mm grid
    M = m[::step, ::step]
    H, W = M.shape
    gx = np.arange(W) * step; gy = np.arange(H) * step
    Xg = (gx - Fm['cx']) * kpx; Zg = HEM_Y + (Fm['hem'] - gy) * kpx
    torso_half = Fm['half'] * kpx
    XX = np.broadcast_to(Xg[None, :], M.shape)
    ov = 2  # grid cells of overlap so sleeve and body never show a gap between them
    torso = M & (np.abs(XX) <= torso_half + step * kpx)
    sleeveL = M & (XX > torso_half - ov * step * kpx); sleeveR = M & (XX < -torso_half + ov * step * kpx)
    parts = [('torso', torso, 0.042, 0.06), ('L', sleeveL, 0.05, 0.05), ('R', sleeveR, 0.05, 0.05)]  # a sweater on a hanger is flat
    from skimage import measure as skm
    verts, faces = [], []
    cell = step * kpx
    for name, R, dmax, rad in parts:
        lab, n = ndi.label(R)
        if n == 0: continue
        if n > 1:
            sizes = ndi.sum(R, lab, range(1, n + 1)); R = lab == (1 + int(np.argmax(sizes)))
        d = ndi.distance_transform_edt(np.pad(R, 1)) [1:-1, 1:-1] * cell
        if name == 'torso':
            t = np.clip(d / rad, 0, 1); h = dmax * np.sqrt(1 - (1 - t) ** 2)
        else:
            rowmax = np.zeros_like(d)
            for i in range(H):
                if R[i].any(): rowmax[i, R[i]] = d[i, R[i]].max()
            rr = max(float(np.median(rowmax[R])), 1e-4)
            dd = np.minimum(d, rr); h = np.sqrt(np.clip(2 * rr * dd - dd * dd, 0, None)) * 0.7
        # signed field in a (z, x, depth) volume: inside where |depth| < h  -> watertight surface
        nd = int(np.ceil(h.max() / cell)) + 3
        dep = (np.arange(-nd, nd + 1) * cell)
        vol = (h[:, :, None] * np.where(dep[None, None, :] < 0, 1.0, 0.92)) - np.abs(dep[None, None, :])
        vol = np.where(R[:, :, None], vol, -cell)
        vol = np.pad(vol, 1, constant_values=-cell)
        vv, ff, _, _ = skm.marching_cubes(vol, 0.0)
        vv -= 1
        # volume index -> metres: rows = photo y, cols = photo x, depth (Blender y, front is -y)
        Xv = np.interp(vv[:, 1], np.arange(W), Xg); Zv = np.interp(vv[:, 0], np.arange(H), Zg)
        Yv = (vv[:, 2] - nd) * cell
        base = len(verts); verts.extend(np.stack([Xv, Yv, Zv], 1).tolist()); faces.extend((ff + base).tolist())
    me = bpy.data.meshes.new('Shirt'); me.from_pydata(verts, [], faces); me.update()
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('Shirt', me); bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    sm_ = ob.modifiers.new('cs', 'SMOOTH'); sm_.iterations = 8; sm_.factor = 0.5
    if len(me.polygons) > a.faces:
        dm = ob.modifiers.new('d', 'DECIMATE'); dm.ratio = a.faces / len(me.polygons)
    dg = bpy.context.evaluated_depsgraph_get(); nm = bpy.data.meshes.new_from_object(ob.evaluated_get(dg)); ob.modifiers.clear(); ob.data = nm; me = nm
    part_sleeve = np.abs(np.array([v.co.x for v in me.vertices])) > torso_half + 0.5 * step * kpx
    M2W = lambda px, py: ((px - Fm['cx']) * kpx, HEM_Y + (Fm['hem'] - py) * kpx)
    print(f'  inflated: {len(me.vertices)} verts, {len(me.polygons)} faces, torso half-width {torso_half:.3f} m ({time.time() - t0:.0f}s)')

    # ---- joints from the photo's sleeves
    sl = AG.sleeve_boxes(F['m'], Fm)
    J = {}
    for s, key, sgn in (('L', 'r', 1), ('R', 'l', -1)):  # garment's left is on the photo's right
        f = sl.get(key)
        if f:
            Sp = f['mu'] + f['a0'] * f['e1']; Wp = f['mu'] + f['a1'] * f['e1']
            S = np.array(M2W(*Sp)); W = np.array(M2W(*Wp))
            S[0] = sgn * max(abs(S[0]), torso_half * 0.92); S[1] = min(S[1], COLLAR_Y - 0.07)
        else:
            S = np.array([sgn * torso_half, COLLAR_Y - 0.09]); W = np.array([sgn * (torso_half + 0.1), HEM_Y + 0.05])
        E = S + (W - S) * 0.52
        J[s] = (np.array([S[0], 0, S[1]]), np.array([E[0], 0, E[1]]), np.array([W[0], 0, W[1]]))
    shoulderZ = float((J['L'][0][2] + J['R'][0][2]) / 2)
    print('  joints', {s: [tuple(np.round(p, 3)) for p in J[s]] for s in J})

    # ---- armature
    sc = bpy.context.scene
    arm = bpy.data.armatures.new('Rig'); rig = bpy.data.objects.new('Rig', arm)
    sc.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones
    def B(name, h, t, parent=None):
        b = eb.new(name); b.head = tuple(map(float, h)); b.tail = tuple(map(float, t)); b.roll = 0
        if parent: b.parent = eb[parent]
    zc = shoulderZ + 0.03
    B('chest', (0, 0, zc), (0, 0, zc - 0.16)); B('spine', (0, 0, zc - 0.16), (0, 0, zc - 0.32), 'chest')
    B('hips', (0, 0, zc - 0.32), (0, 0, zc - 0.47), 'spine'); B('neck', (0, 0, zc), (0, 0, zc + 0.14), 'chest')
    for s, sgn in (('L', 1), ('R', -1)):
        S, E, W = J[s]
        B('shoulder.' + s, (0.04 * sgn, 0, S[2] + 0.03), S, 'chest')
        B('upperarm.' + s, S, E, 'shoulder.' + s); B('forearm.' + s, E, W, 'upperarm.' + s)
    bpy.ops.object.mode_set(mode='OBJECT')

    V = np.array([v.co[:] for v in me.vertices]); x, y, z = V.T
    names = ['hips', 'spine', 'chest', 'neck'] + [f'{b}.{s}' for s in 'LR' for b in ('shoulder', 'upperarm', 'forearm')]
    Wt = {n: np.zeros(len(V)) for n in names}
    side = np.where(x >= 0, 'L', 'R')
    armw = np.zeros(len(V))
    for s in 'LR':
        S, E, Wr = J[s]; m = side == s
        P = V[m]
        u = (E - S) / np.linalg.norm(E - S); tt = (P - S) @ u
        a_ = np.where(part_sleeve[m], 1.0, 0.0)
        # the very top of the sleeve (shoulder cap) blends with the body
        a_ = a_ * (0.35 + 0.65 * sm(-0.04, 0.06, tt))
        Lu = np.linalg.norm(E - S); fore = sm(Lu - 0.05, Lu + 0.05, tt)
        sh = a_ * (1 - sm(0.0, 0.10, tt)) * 0.5
        Wt[f'upperarm.{s}'][m] = a_ * (1 - fore) - sh; Wt[f'forearm.{s}'][m] = a_ * fore
        tor = 1 - a_
        shz = tor * sm(shoulderZ - 0.12, shoulderZ, P[:, 2]) * sm(0.06, torso_half, np.abs(P[:, 0])) * 0.45
        Wt[f'shoulder.{s}'][m] = sh + shz; tor = tor - shz; armw[m] = a_
        hips = tor * (1 - sm(zc - 0.42, zc - 0.30, P[:, 2])); chest = tor * sm(zc - 0.24, zc - 0.10, P[:, 2])
        Wt['hips'][m] = hips; Wt['chest'][m] = chest; Wt['spine'][m] = tor - hips - chest
    vg = {n: ob.vertex_groups.new(name=n) for n in names}
    for n in names:
        w = Wt[n]
        for i in np.nonzero(w > 0.003)[0]: vg[n].add([int(i)], float(w[i]), 'REPLACE')
    mod = ob.modifiers.new('arm', 'ARMATURE'); mod.object = rig; ob.parent = rig

    # ---- photo uvs (per corner): front faces <- front photo, back faces <- back photo (mirrored)
    place = {}
    atlas = Image.new('RGB', (HALF * 2, HALF))
    for kk, sd in enumerate(('front', 'back')):
        rgb = sides[sd]['rgb']; h, w = rgb.shape[:2]
        scl = HALF / max(w, h); Wd, Hd = int(round(w * scl)), int(round(h * scl))
        ox, oy = (HALF - Wd) // 2, (HALF - Hd) // 2
        sq = Image.new('RGB', (HALF, HALF), tuple(int(c) for c in np.median(rgb[sides[sd]['m']], 0)))
        sq.paste(Image.fromarray(rgb.astype(np.uint8)).resize((Wd, Hd), Image.LANCZOS), (ox, oy))
        atlas.paste(sq, (kk * HALF, 0)); place[sd] = (scl, ox + kk * HALF, oy)
    atlas = atlas.filter(ImageFilter.UnsharpMask(radius=1.0, percent=35, threshold=2))
    atlas.save(os.path.join(OUT, f'{gid}.jpg'), quality=90)
    AG.fabric_tile(sides['front']['raw'], sides['front']['m'], Fm).save(os.path.join(OUT, f'{gid}_fabric.jpg'), quality=88)
    # store metres -> photo pixels for each side (back: its own bbox, mirrored)
    V0 = np.array([v.co[:] for v in me.vertices])
    fx0, fy0, fx1, fy1 = sides['front']['bbox']; bx0_, by0_, bx1_, by1_ = sides['back']['bbox']
    def px_of(sd, X, Z):
        px = Fm['cx'] + X / kpx; py = Fm['hem'] - (Z - HEM_Y) / kpx      # front photo pixel
        if sd == 'back':  # same point seen from behind: mirror inside the back photo's own box
            u = (px - fx0) / (fx1 - fx0); v_ = (py - fy0) / (fy1 - fy0)
            px = bx1_ - u * (bx1_ - bx0_); py = by0_ + v_ * (by1_ - by0_)
        scl, ox, oy = place[sd]
        return (px * scl + ox) / (HALF * 2), 1 - (py * scl + oy) / HALF  # Blender uv: v up
    uv0 = me.uv_layers.new(name='UVMap'); uv1 = me.uv_layers.new(name='photo')
    facing = me.attributes.new('_FACING', 'FLOAT', 'POINT')
    me.calc_loop_triangles() if hasattr(me, 'calc_loop_triangles') else None
    vn = np.array([v.normal[:] for v in me.vertices])
    for i, v in enumerate(me.vertices): facing.data[i].value = float(abs(vn[i][1]))
    for poly in me.polygons:
        sd = 'front' if poly.normal.y <= 0 else 'back'
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index; X, Y, Z = V0[vi]
            uv1.data[li].uv = px_of(sd, X, Z)
            uv0.data[li].uv = (X * 1.6 + (0.5 if sd == 'back' else 0), Z * 1.6)  # tiling coords for the knit detail
        poly.use_smooth = True
    me.uv_layers.active_index = 0

    mat = bpy.data.materials.new('Fabric_0'); mat.use_nodes = True
    me.materials.clear(); me.materials.append(mat)

    # ---- occluder (body): torso part, pulled toward the axis
    occ_me = me.copy(); occ = bpy.data.objects.new('Body', occ_me); sc.collection.objects.link(occ)
    occ.vertex_groups.clear()
    keep = (armw < 0.3) & (V0[:, 2] < shoulderZ + 0.02)
    bm = bmesh.new(); bm.from_mesh(occ_me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep[v.index]], context='VERTS')
    for v in bm.verts:
        hv = Vector((v.co.x, v.co.y, 0)); L = hv.length
        if L > 0.03: v.co -= hv / L * min(0.022, L * 0.25)
    bm.to_mesh(occ_me); bm.free()
    occ_me.materials.clear(); occ_me.materials.append(bpy.data.materials.new('Occluder'))
    for l in list(occ_me.uv_layers): occ_me.uv_layers.remove(l)
    if '_FACING' in occ_me.attributes: occ_me.attributes.remove(occ_me.attributes['_FACING'])
    Vo = np.array([v.co[:] for v in occ_me.vertices])
    ovg = {n: occ.vertex_groups.new(name=n) for n in ('hips', 'spine', 'chest')}
    for i, p in enumerate(Vo):
        hp = 1 - sm(zc - 0.42, zc - 0.30, p[2]); ch = sm(zc - 0.24, zc - 0.10, p[2]); sp = 1 - hp - ch
        for n, w in (('hips', hp), ('spine', sp), ('chest', ch)):
            if w > 0.003: ovg[n].add([i], float(w), 'REPLACE')
    m2 = occ.modifiers.new('arm', 'ARMATURE'); m2.object = rig; occ.parent = rig

    for o in sc.objects: o.select_set(False)
    for o in (rig, ob, occ): o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    glb = os.path.join(OUT, f'{gid}.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_skins=True, export_animations=False,
                              export_materials='EXPORT', export_attributes=True, export_texcoords=True, export_normals=True)
    # ---- product entry
    S, E, W = J['L']
    model = dict(shoulderY=round(float(S[2]), 3), shoulderW=round(float(2 * S[0]), 3),
                 upper=round(float(np.linalg.norm(E - S)), 3), fore=round(float(np.linalg.norm(W - E)), 3))
    col = np.median(sides['front']['raw'][sides['front']['m']], 0); hexc = '#%02X%02X%02X' % tuple(int(c) for c in col)
    d = AG.DEFAULTS[a.type]; ver = int(time.time())
    json.dump(dict(id=gid, model=model, hex=hexc), open(os.path.join(OUT, f'{gid}.json'), 'w'))
    if a.no_catalog:
        print(f'✓ {gid} in {time.time() - t0:.0f}s  {model}'); return
    pj = os.path.join(OUT, 'products.json')
    items = json.load(open(pj)) if os.path.exists(pj) else []
    items = [i for i in items if i['id'] != gid]
    items.append(dict(id=gid, base=a.type, name=a.name, color=a.color or 'Custom', hex=hexc, price=a.price,
                      fabric=d['fabric'], line=f"{d['line']} — Atelier", desc=a.desc or d['desc'], details=d['details'],
                      glb=f'assets/custom/{gid}.glb?v={ver}', texture=f'assets/custom/{gid}.jpg?v={ver}',
                      fabricTex=f'assets/custom/{gid}_fabric.jpg?v={ver}', model=model, ai=True, category=a.type.split('-')[0]))
    json.dump(items, open(pj, 'w'), indent=1, ensure_ascii=False)
    print(f'✓ {gid} in {time.time() - t0:.0f}s  {model}')


def AG_seg(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1), t


if __name__ == '__main__':
    main()
