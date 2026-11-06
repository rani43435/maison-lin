import sys, json, math, numpy as np, bpy
from mathutils import Vector, Matrix

# joints (left side, x>0) picked from normalized front grids: shoulder, elbow, wrist (x, z); y = 0
J = {
  'tee':   dict(S=(0.165, 1.39), E=(0.374, 1.204), W=(0.56, 1.04), dec=0.35),
  'knit':  dict(S=(0.165, 1.379), E=(0.3465, 1.1645), W=(0.506, 0.983), dec=1.0),
  'polo':  dict(S=(0.170, 1.38), E=(0.270, 1.100), W=(0.360, 0.840), dec=0.6),
  'linen': dict(S=(0.160, 1.38), E=(0.364, 1.188), W=(0.546, 1.017), dec=1.0),
}
OUT = '/home/claude/maison-lin/assets'

def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1), t

def main(n):
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
    V = np.array([v.co for v in ob.data.vertices])
    sl = np.array([d.value for d in ob.data.attributes['sleeve'].data]) if 'sleeve' in ob.data.attributes else np.zeros(len(V))
    tagged = sl.max() > 0.5

    # armature
    arm = bpy.data.armatures.new('Rig'); rig = bpy.data.objects.new('Rig', arm)
    sc.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones
    def B(name, h, t, parent=None):
        b = eb.new(name); b.head = h; b.tail = t; b.roll = 0
        if parent: b.parent = eb[parent]
    B('hips', (0, 0, 0.95), (0, 0, 1.10))
    B('spine', (0, 0, 1.10), (0, 0, 1.26), 'hips')
    B('chest', (0, 0, 1.26), (0, 0, 1.42), 'spine')
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
            a = np.maximum(a, (1 - sm(0.0, 0.07, np.abs(tt))) * sm(-0.06, 0.0, tt) * 0.0)
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
    bm_keep = armw < 0.3
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

    # strip textures we don't use (keep normal maps; keep base colour only for linen detail)
    for mat in ob.data.materials:
        if not mat or not mat.use_nodes: continue
        nt = mat.node_tree
        bsdf = next((x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf: continue
        for inp in ('Base Color', 'Metallic', 'Roughness', 'Alpha', 'Specular IOR Level'):
            if n != 'linen' or inp != 'Base Color':
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
    info = dict(shoulderY=j['S'][1], shoulderW=2 * j['S'][0], verts=len(V))
    print('DONE', n, info)
    return info

if __name__ == '__main__':
    out = {}
    for n in sys.argv[1:]: out[n] = main(n)
    print(json.dumps(out))
