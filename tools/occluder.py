#!/usr/bin/env python3
"""
Keep the AR body occluder inside the garment.

The occluder is an invisible "body" mesh that writes depth only: in the fitting room it hides the
fabric that would be behind the wearer. If any part of it sits outside the garment's own torso,
it also hides the front of the sleeves, hem or collar, and the live camera (your real arm or hand)
shows through. This pulls every occluder vertex at least `margin` metres inside the garment's torso
surface (measured per height band and per direction around the body), and inside the collar/hem range.

  python3 tools/occluder.py assets/custom/<id>.glb [--margin 0.02]     # fix a built GLB in place
  from occluder import fit_inside                                       # used by add_garment.py
"""
import argparse, os, sys
import numpy as np

BINS_A = 48       # directions around the body
BIN_Y = 0.02      # height band, metres


def _radial_table(P, zc, y0, nY):
    """outer radius of the garment torso for each (height band, direction)"""
    r = np.hypot(P[:, 0], P[:, 2] - zc)
    a = ((np.arctan2(P[:, 2] - zc, P[:, 0]) + np.pi) / (2 * np.pi) * BINS_A).astype(int) % BINS_A
    yb = ((P[:, 1] - y0) / BIN_Y).astype(int)
    R = np.full((nY, BINS_A), np.nan)
    for i in range(len(P)):
        v = R[yb[i], a[i]]
        if np.isnan(v) or r[i] > v: R[yb[i], a[i]] = r[i]
    # holes in the table (a direction with no vertex in that band): nearest filled neighbour around, then up/down
    for _ in range(BINS_A):
        m = np.isnan(R)
        if not m.any(): break
        L = np.roll(R, 1, 1); Rr = np.roll(R, -1, 1)
        fill = np.where(np.isnan(L), Rr, np.where(np.isnan(Rr), L, np.minimum(L, Rr)))
        R[m] = fill[m]
    for _ in range(nY):
        m = np.isnan(R)
        if not m.any(): break
        U = np.vstack([R[1:], np.full((1, BINS_A), np.nan)]); D = np.vstack([np.full((1, BINS_A), np.nan), R[:-1]])
        fill = np.where(np.isnan(U), D, np.where(np.isnan(D), U, np.minimum(U, D)))
        R[m] = fill[m]
    # a little smoothing that never grows the limit
    return np.minimum.reduce([R, np.roll(R, 1, 1), np.roll(R, -1, 1)])


def _angle_bin(x, dz): return ((np.arctan2(dz, x) + np.pi) / (2 * np.pi) * BINS_A).astype(int) % BINS_A


def fit_inside(occ, torso, margin=0.02):
    """occ: (N,3) occluder vertices, rest pose, y up.
    torso: garment torso vertices (sleeves excluded) — one (M,3) array for the rest pose, or a list of arrays,
    one per arm pose (the same garment posed): the occluder is kept inside the garment in EVERY pose given,
    because side panels that partly follow the arm move away from the body when the arm moves.
    Returns the moved occluder vertices and how many moved."""
    sets = [t.astype(np.float64) for t in (torso if isinstance(torso, (list, tuple)) else [torso])]
    occ = occ.astype(np.float64).copy(); rest = sets[0]
    zc = float(np.median(rest[:, 2]))
    y0 = min(t[:, 1].min() for t in sets); nY = int(np.ceil((max(t[:, 1].max() for t in sets) - y0) / BIN_Y)) + 1
    R = np.minimum.reduce([_radial_table(t, zc, y0, nY) for t in sets])
    # bottom: never below the hem in any direction (front hem is often higher than the back)
    lowest = np.full(BINS_A, np.inf)
    for t in sets:
        ab = _angle_bin(t[:, 0], t[:, 2] - zc)
        np.minimum.at(lowest, ab, t[:, 1])
    lowest = np.where(np.isinf(lowest), rest[:, 1].min(), lowest)
    lowest = np.maximum.reduce([lowest, np.roll(lowest, 1), np.roll(lowest, -1)])
    dx, dz = occ[:, 0], occ[:, 2] - zc
    a = _angle_bin(dx, dz)
    occ[:, 1] = np.clip(occ[:, 1], lowest[a] + margin, rest[:, 1].max())
    r = np.hypot(dx, dz)
    yb = np.clip(((occ[:, 1] - y0) / BIN_Y).astype(int), 0, nY - 1)
    lim = np.maximum(R[yb, a] - margin, 0.01)
    k = np.where(r > lim, lim / np.maximum(r, 1e-9), 1.0)
    moved = int((k < 1).sum())
    occ[:, 0] = dx * k; occ[:, 2] = zc + dz * k
    return occ.astype(np.float32), moved


def fix_glb(path, margin=0.06, out=None, posed_id=None):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import add_garment as AG
    js, bin_ = AG.read_glb(path)
    skin_of_mesh = {n['mesh']: n['skin'] for n in js['nodes'] if 'mesh' in n and 'skin' in n}
    torso, occ_accs = [], []
    for mi, mesh in enumerate(js['meshes']):
        for p in mesh['primitives']:
            mat = js['materials'][p['material']].get('name', '') if 'material' in p else ''
            P, _ = AG.acc_read(js, bin_, p['attributes']['POSITION'])
            if mat.startswith('Occluder'): occ_accs.append(p['attributes']['POSITION']); continue
            arm = np.zeros(len(P))
            if mi in skin_of_mesh and 'JOINTS_0' in p['attributes']:
                names = [js['nodes'][j].get('name', '') for j in js['skins'][skin_of_mesh[mi]]['joints']]
                isarm = np.array(['arm' in n for n in names])
                J, _ = AG.acc_read(js, bin_, p['attributes']['JOINTS_0']); W, wt = AG.acc_read(js, bin_, p['attributes']['WEIGHTS_0'])
                W = W.astype(np.float64)
                if wt.get('normalized') and wt['componentType'] != 5126: W /= np.iinfo(AG.CT[wt['componentType']]).max
                arm = (W * isarm[J.astype(int)]).sum(1)
            torso.append(P[arm < 0.25])
    if not occ_accs: print('  no occluder in', path); return 0
    torso = np.concatenate(torso)
    if posed_id:
        torso = [torso] + posed_torso(posed_id)
    total = 0
    for ai in occ_accs:
        P, _ = AG.acc_read(js, bin_, ai)
        Q, moved = fit_inside(P, torso, margin); total += moved
        AG.OVERRIDE[ai] = Q
    # rewrite every accessor (positions of the occluder changed; everything else byte-identical)
    arrays = []
    for i, a in enumerate(js['accessors']):
        arr, tmpl = AG.acc_read(js, bin_, i)
        bv = js['bufferViews'][a['bufferView']]
        arrays.append((arr, tmpl, bv.get('target')))
    images = []
    for im in js.get('images', []):
        bv = js['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
        images.append(bin_[o:o + bv['byteLength']])
    AG.write_glb(out or path, js, arrays, images)
    AG.OVERRIDE.clear()
    print(f'  occluder: {total} vertices pulled {margin * 100:.0f} cm inside the garment → {out or path}')
    return total


def posed_torso(gid, poses=('hang', 'tight', 'front', 't'), max_arm=0.95):
    """the garment's torso vertices in each standard arm pose, computed by the site's own rig code (tools/qc/clip.html)"""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'qc'))
    import clipping as QC
    from playwright.sync_api import sync_playwright
    srv, port = QC.serve()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            pg = b.new_page(); pg.goto(f'http://127.0.0.1:{port}/tools/qc/clip.html'); pg.wait_for_function('window.ready', timeout=60000)
            r = pg.evaluate(f"posed('{gid}', {list(poses)})"); b.close()
    finally:
        srv.shutdown()
    arm = np.array(r['arm'])
    return [np.array(r['poses'][k]).reshape(-1, 3)[arm < max_arm] for k in poses]


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('glb'); ap.add_argument('--margin', type=float, default=0.06)
    ap.add_argument('--posed', metavar='PRODUCT_ID', help='also keep it inside the garment in the standard arm poses (needs playwright)')
    a = ap.parse_args()
    fix_glb(a.glb, a.margin, posed_id=a.posed)
