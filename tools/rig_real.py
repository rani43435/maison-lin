import sys, json, math, numpy as np, bpy
from mathutils import Vector, Matrix

# joints (left side, x>0) picked from normalized front grids: shoulder, elbow, wrist (x, z); y = 0
J = {
  'tee':   dict(S=(0.165, 1.39), E=(0.374, 1.204), W=(0.56, 1.04), dec=0.35),
  'knit':  dict(S=(0.165, 1.379), E=(0.3465, 1.1645), W=(0.506, 0.983), dec=1.0),
  'polo':  dict(S=(0.170, 1.38), E=(0.270, 1.100), W=(0.360, 0.840), dec=0.6),
  'linen': dict(S=(0.160, 1.38), E=(0.364, 1.188), W=(0.546, 1.017), dec=1.0),
  'hoodie2': dict(S=(0.160, 1.45), E=(0.220, 1.22), W=(0.270, 1.00), dec=0.4, nooversize=True),
  'hoodie3': dict(S=(0.150, 1.44), E=(0.350, 1.245), W=(0.537, 1.064), dec=1.0, nooversize=True),
}
OUT = '/home/claude/maison-lin/assets'

def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1), t

SUBDIV = ('linen', 'hoodie3')
SMOOTH = {'tee': 3, 'knit': 2, 'polo': 0, 'linen': 6, 'hoodie2': 2, 'hoodie3': 0}
OVERSIZE = True
OV = dict(width=0.16, depth=0.10, length=0.10, drop=0.15, sleeve=0.05, hem=0.06)

def arm_weight(V, j, sl, tagged):
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    rx, ry = j['S'][0] + 0.02, 0.13
    nT = np.sqrt((x / rx) ** 2 + (y / ry) ** 2)
    a = np.zeros(len(V)); tt = np.zeros(len(V))
    for sx in (1, -1):
        m = (x >= 0) if sx > 0 else (x < 0)
        S = np.array([j['S'][0] * sx, 0, j['S'][1]]); E = np.array([j['E'][0] * sx, 0, j['E'][1]]); W = np.array([j['W'][0] * sx, 0, j['W'][1]])
        d1, _ = seg_dist(V[m], S, E); d2, _ = seg_dist(V[m], E, W)
        u = (E - S) / np.linalg.norm(E - S); t = (V[m] - S) @ u
        a[m] = sl[m] if tagged else sm(-0.35, 0.35, nT[m] - np.minimum(d1, d2) / 0.075) * sm(-0.05, 0.03, t)
        tt[m] = t
    return a, tt

def ov_point(p, a, j, sgn):
    """oversize transform for one point. a = arm weight"""
    x, y, z = p
    Sx, Sz = j['S']
    ztop = 1.40
    # torso: wider, deeper, longer and boxier toward the hem
    k = 1 + OV['width'] * (1 - 0.75 * sm(1.18, 1.40, z)) + OV['hem'] * sm(1.3, 0.9, z)
    tx, ty = x * k, y * (1 + OV['depth'])
    tz = z if z > ztop else ztop - (ztop - z) * (1 + OV['length'])
    # sleeves: moved out with the dropped shoulder, slightly lower, a bit longer
    dx = sgn * Sx * OV['width'] * 0.25 * (1 + OV['drop'])
    sx_, sy_, sz_ = x + dx, y * (1 + OV['depth'] * 0.5), z - 0.02
    return np.array([tx * (1 - a) + sx_ * a, ty * (1 - a) + sy_ * a, tz * (1 - a) + sz_ * a])

def oversize(ob, V, sl, tagged, j):
    a, tt = arm_weight(V, j, sl, tagged)
    out = np.empty_like(V)
    for i, p in enumerate(V):
        sgn = 1 if p[0] >= 0 else -1
        q = ov_point(p, a[i], j, sgn)
        # lengthen sleeve along the arm axis
        if a[i] > 0:
            S = np.array([j['S'][0] * sgn, 0, j['S'][1]]); E = np.array([j['E'][0] * sgn, 0, j['E'][1]])
            u = (E - S) / np.linalg.norm(E - S)
            q = q + u * max(0.0, tt[i]) * OV['sleeve'] * a[i]
        out[i] = q
    for i, v in enumerate(ob.data.vertices): v.co = out[i]
    ob.data.update()
    # move joints the same way (a=1 for elbow and wrist, shoulder sits at the new seam)
    J2 = dict(j)
    for key, aa in (('S', 0.6), ('E', 1.0), ('W', 1.0)):
        x, z = j[key]
        S = np.array([j['S'][0], 0, j['S'][1]]); E = np.array([j['E'][0], 0, j['E'][1]])
        u = (E - S) / np.linalg.norm(E - S)
        q = ov_point(np.array([x, 0, z]), aa, j, 1)
        t = (np.array([x, 0, z]) - S) @ u
        q = q + u * max(0.0, t) * OV['sleeve'] * aa
        J2[key] = (float(q[0]), float(q[2]))
    print('joints', n_global, J2)
    return J2

n_global = ''
def main(n):
    global n_global; n_global = n
    j = J[n]
    bpy.ops.wm.open_mainfile(filepath=f'/home/claude/sf/{n}_norm.blend')
    ob = bpy.data.objects['Shirt']
    sc = bpy.context.scene
    for o in list(sc.objects):
        if o != ob: bpy.data.objects.remove(o)
    if j['dec'] < 1:
        m = ob.modifiers.new('d', 'DECIMATE'); m.ratio = j['dec']
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ob.modifiers.clear(); old = ob.data; ob.data = me
    # textures down to 1024
    for img in bpy.data.images:
        if img.size[0] > 1024: img.scale(1024, 1024)
    # clean: weld seams, soften scan noise
    import bmesh
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0006)
    bm.to_mesh(ob.data); bm.free()
    it = SMOOTH.get(n, 0)
    if it:
        m = ob.modifiers.new('cs', 'CORRECTIVE_SMOOTH'); m.iterations = it; m.factor = 0.5; m.use_only_smooth = True; m.smooth_type = 'LENGTH_WEIGHTED'
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg)); ob.modifiers.clear(); ob.data = me
    if n in SUBDIV:
        m = ob.modifiers.new('ss', 'SUBSURF'); m.levels = 1; m.render_levels = 1
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg)); ob.modifiers.clear(); ob.data = me
    V = np.array([v.co for v in ob.data.vertices])
    sl = np.array([d.value for d in ob.data.attributes['sleeve'].data]) if 'sleeve' in ob.data.attributes else np.zeros(len(V))
    tagged = sl.max() > 0.5
    if OVERSIZE and not j.get('nooversize'):
        j = oversize(ob, V, sl, tagged, dict(j))
        V = np.array([v.co for v in ob.data.vertices])

    # armature
    arm = bpy.data.armatures.new('Rig'); rig = bpy.data.objects.new('Rig', arm)
    sc.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones
    def B(name, h, t, parent=None):
        b = eb.new(name); b.head = h; b.tail = t; b.roll = 0
        if parent: b.parent = eb[parent]
    # chest is the root and the chain hangs downward, so the hem can lag/sway without moving the shoulders
    B('chest', (0, 0, 1.42), (0, 0, 1.26))
    B('spine', (0, 0, 1.26), (0, 0, 1.10), 'chest')
    B('hips', (0, 0, 1.10), (0, 0, 0.95), 'spine')
    B('neck', (0, 0, 1.42), (0, 0, 1.56), 'chest')
    pts = {}
    for s, sx in (('L', 1), ('R', -1)):
        S = np.array([j['S'][0] * sx, 0, j['S'][1]]); E = np.array([j['E'][0] * sx, 0, j['E'][1]]); W = np.array([j['W'][0] * sx, 0, j['W'][1]])
        pts[s] = (S, E, W)
        B('shoulder.' + s, (0.04 * sx, 0, j['S'][1] + 0.03), tuple(S), 'chest')
        B('upperarm.' + s, tuple(S), tuple(E), 'shoulder.' + s)
        B('forearm.' + s, tuple(E), tuple(W), 'upperarm.' + s)
    bpy.ops.object.mode_set(mode='OBJECT')

    # weights
    names = ['hips', 'spine', 'chest', 'neck'] + [f'{b}.{s}' for s in 'LR' for b in ('shoulder', 'upperarm', 'forearm')]
    W = {k: np.zeros(len(V)) for k in names}
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    torso_rx, torso_ry = j['S'][0] + 0.02, 0.13
    nT = np.sqrt((x / torso_rx) ** 2 + (y / torso_ry) ** 2)
    armw = np.zeros(len(V)); side = np.where(x >= 0, 'L', 'R')
    for s in 'LR':
        S, E, Wr = pts[s]
        m = side == s
        d1, t1 = seg_dist(V[m], S, E); d2, t2 = seg_dist(V[m], E, Wr)
        d = np.minimum(d1, d2)
        # signed position along arm from shoulder
        u = (E - S) / np.linalg.norm(E - S)
        tt = (V[m] - S) @ u
        if tagged:
            a = sl[m].copy()
            # torso around the armhole follows the sleeve so the shoulder cap doesn't poke through
            dS = np.linalg.norm(V[m] - S, axis=1)
            a = np.maximum(a, (1 - sm(0.04, 0.13, dS)) * sm(-0.07, 0.03, tt) * 0.85)
        else:
            nA = d / 0.075
            a = sm(-0.35, 0.35, nT[m] - nA) * sm(-0.05, 0.03, tt)
        fore = np.where(d2 < d1, 1.0, 0.0)
        # smooth elbow blend
        Lu = np.linalg.norm(E - S)
        fore = sm(Lu - 0.05, Lu + 0.05, tt)
        sh = a * (1 - sm(0.0, 0.10, tt)) * 0.5
        W[f'upperarm.{s}'][m] = a * (1 - fore) - sh
        W[f'forearm.{s}'][m] = a * fore
        tor = 1 - a
        shz = tor * sm(1.26, 1.38, z[m]) * sm(0.06, j['S'][0], np.abs(x[m])) * 0.45
        W[f'shoulder.{s}'][m] = sh + shz
        armw[m] = a
        tor = tor - shz
        hips = tor * (1 - sm(1.00, 1.12, z[m])); chest = tor * sm(1.18, 1.32, z[m])
        W['hips'][m] = hips; W['chest'][m] = chest; W['spine'][m] = tor - hips - chest
    vg = {k: ob.vertex_groups.new(name=k) for k in names}
    for k in names:
        w = W[k]
        for i in np.nonzero(w > 0.003)[0]:
            vg[k].add([int(i)], float(w[i]), 'REPLACE')
    mod = ob.modifiers.new('arm', 'ARMATURE'); mod.object = rig; ob.parent = rig

    # occluder: torso part pulled 2.2cm toward the vertical axis
    occ_me = ob.data.copy(); occ = bpy.data.objects.new('Body', occ_me); sc.collection.objects.link(occ)
    occ.vertex_groups.clear()
    bm_keep = (armw < 0.3) & (V[:, 2] < j['S'][1] + 0.02)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(occ_me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not bm_keep[v.index]], context='VERTS')
    for v in bm.verts:
        h = Vector((v.co.x, v.co.y, 0)); L = h.length
        if L > 0.03: v.co -= h / L * min(0.022, L * 0.25)
    bm.to_mesh(occ_me); bm.free()
    occ_me.materials.clear(); occ_me.materials.append(bpy.data.materials.new('Occluder'))
    for a in list(occ_me.uv_layers): occ_me.uv_layers.remove(a)
    Vo = np.array([v.co for v in occ_me.vertices])
    occ_vg = {k: occ.vertex_groups.new(name=k) for k in ['hips', 'spine', 'chest']}
    for i, p in enumerate(Vo):
        zz = p[2]; hp = 1 - sm(1.00, 1.12, zz); ch = sm(1.18, 1.32, zz); sp = 1 - hp - ch
        for k, w in (('hips', hp), ('spine', sp), ('chest', ch)):
            if w > 0.003: occ_vg[k].add([i], float(w), 'REPLACE')
    m2 = occ.modifiers.new('arm', 'ARMATURE'); m2.object = rig; occ.parent = rig

    for p in ob.data.polygons: p.use_smooth = True
    # strip textures we don't use (keep normal maps; keep base colour only for linen detail)
    for mat in ob.data.materials:
        if not mat or not mat.use_nodes: continue
        nt = mat.node_tree
        bsdf = next((x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf: continue
        for inp in ('Base Color', 'Metallic', 'Roughness', 'Alpha', 'Specular IOR Level'):
            if n not in ('linen', 'hoodie2') or inp != 'Base Color':
                for l in list(bsdf.inputs[inp].links): nt.links.remove(l)
        if n == 'polo':
            for l in list(bsdf.inputs['Normal'].links): nt.links.remove(l)
    # mark materials
    for i, mat in enumerate(ob.data.materials):
        if mat: mat.name = f'Fabric_{i}'
    if 'sleeve' in ob.data.attributes: ob.data.attributes.remove(ob.data.attributes['sleeve'])
    for o in sc.objects: o.select_set(False)
    for o in (rig, ob, occ): o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{n}.glb', export_format='GLB', use_selection=True, export_skins=True,
                              export_animations=False, export_materials='EXPORT', export_image_format='AUTO',
                              export_jpeg_quality=85, export_attributes=False)
    S_, E_, W_ = np.array(j['S']), np.array(j['E']), np.array(j['W'])
    info = dict(shoulderY=j['S'][1], shoulderW=2 * j['S'][0], upper=float(np.linalg.norm(E_ - S_)), fore=float(np.linalg.norm(W_ - E_)), verts=len(V))
    print('DONE', n, info)
    return info

if __name__ == '__main__':
    out = {}
    for n in sys.argv[1:]: out[n] = main(n)
    print(json.dumps(out))
