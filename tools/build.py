import sys, json, math
sys.path.insert(0, '/home/claude/build')
import numpy as np
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import shapes as S

OUT = '/home/claude/maison-lin/assets'

GARMENTS = {
  'tee':     dict(ease=0.030, sleeve_ease=0.028, hem=0.84, sleeve=0.215, neck=(0.078, 0.095, 0.060), collar=None, buttons=0),
  'knit':    dict(ease=0.034, sleeve_ease=0.020, hem=0.82, sleeve=0.585, neck=(0.075, 0.085, 0.058), collar='rib', buttons=0, cuff_r=0.040),
  'linen':   dict(ease=0.032, sleeve_ease=0.022, hem=0.76, sleeve=0.575, neck=(0.068, 0.080, 0.052), collar='shirt', buttons=6, cuff_r=0.044),
  'polo':    dict(ease=0.028, sleeve_ease=0.026, hem=0.83, sleeve=0.225, neck=(0.068, 0.080, 0.052), collar='shirt', buttons=3),
}

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def np_to_obj(name, V, F):
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], F.tolist())
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)

def remesh(ob, vs):
    m = ob.modifiers.new('r', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = vs; m.use_smooth_shade = True
    apply_mods(ob)

def arm_t(p, side):
    s, e, w, d = S.arm_pts(side)
    return float(np.dot(np.array(p) - s, d))

def cut_garment(ob, g):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    nx, nyf, nyb = g['neck']
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        x, y, z = c
        side = 1 if x > 0 else -1
        t = arm_t(c, side)
        ry = nyf if y < 0 else nyb
        s_, e_, w_, d_ = S.arm_pts(side)
        q_ = np.array(c) - s_; rad = np.linalg.norm(q_ - d_*(q_ @ d_))
        if z < g['hem'] or (abs(x) > 0.12 and t > g['sleeve'] and rad < 0.11) or (z > 1.36 and (x/nx)**2 + ((y+0.004)/ry)**2 < 1.0):
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    # clean stray pieces: keep largest island
    bm.verts.ensure_lookup_table()
    seen = set(); islands = []
    for v in bm.verts:
        if v.index in seen: continue
        stack = [v]; isl = []
        seen.add(v.index)
        while stack:
            a = stack.pop(); isl.append(a)
            for e in a.link_edges:
                o = e.other_vert(a)
                if o.index not in seen:
                    seen.add(o.index); stack.append(o)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    rm = [v for isl in islands[1:] for v in isl]
    bmesh.ops.delete(bm, geom=rm, context='VERTS')
    # snap boundary verts to cut surfaces
    for v in bm.verts:
        if not v.is_boundary: continue
        x, y, z = v.co
        side = 1 if x > 0 else -1
        if z < g['hem'] + 0.03 and abs(x) < 0.3:
            v.co.z = g['hem']
        elif abs(x) > 0.12 and abs(arm_t(v.co, side) - g['sleeve']) < 0.03 and z > g['hem'] + 0.05:
            s, e, w, d = S.arm_pts(side)
            t = arm_t(v.co, side)
            v.co -= Vector(d) * (t - g['sleeve'])
        elif z > 1.3:
            ry = nyf if y < 0 else nyb
            q = math.sqrt((x/nx)**2 + ((y+0.004)/ry)**2)
            if q > 0:
                v.co.x = x/q; v.co.y = (y+0.004)/q - 0.004
    # smooth boundary loops a bit
    for _ in range(3):
        bv = [v for v in bm.verts if v.is_boundary]
        newco = {}
        for v in bv:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                newco[v] = (v.co*2 + nb[0].co + nb[1].co)/4
        for v, c in newco.items(): v.co = c
    bm.to_mesh(ob.data); bm.free()

def cloth_sim(ob, body, frames=16, tension=30):
    pin = ob.vertex_groups.new(name='pin')
    idx = [v.index for v in ob.data.vertices if v.co.z > 1.425 and abs(v.co.x) < 0.24]
    pin.add(idx, 1.0, 'REPLACE')
    col = body.modifiers.new('col', 'COLLISION')
    body.collision.thickness_outer = 0.004
    body.collision.cloth_friction = 8
    cm = ob.modifiers.new('cloth', 'CLOTH')
    st = cm.settings
    st.quality = 10; st.mass = 0.12
    st.tension_stiffness = tension; st.compression_stiffness = tension
    st.shear_stiffness = 20; st.bending_stiffness = 1.2
    st.air_damping = 6.0
    st.vertex_group_mass = 'pin'
    st.pin_stiffness = 2
    cm.collision_settings.distance_min = 0.004
    cm.collision_settings.use_self_collision = False
    cm.collision_settings.self_distance_min = 0.003
    cm.point_cache.frame_start = 1; cm.point_cache.frame_end = frames
    sc = bpy.context.scene
    sc.frame_start = 1; sc.frame_end = frames
    for f in range(1, frames+1):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me
    ob.vertex_groups.clear()
    body.modifiers.remove(body.modifiers['col'])
    sc.frame_set(1)

def ray_front(bvh, x, z):
    hit = bvh.ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)))
    return hit

def add_collar(ob, g):
    """Build collar strip from neckline boundary loop and join it."""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bverts = [v for v in bm.verts if v.is_boundary and v.co.z > 1.3]
    # order loop by angle around neck axis
    ang = lambda v: math.atan2(v.co.x, -(v.co.y + 0.004))  # 0 at front center
    bverts.sort(key=ang)
    pts = [v.co.copy() for v in bverts]
    bm.free()
    # resample to N
    N = 72
    angs = sorted(ang_ for ang_ in [math.atan2(p.x, -(p.y+0.004)) for p in pts])
    P = np.array([[p.x, p.y, p.z] for p in pts]); A = np.array([math.atan2(p.x, -(p.y+0.004)) for p in pts])
    tgt = np.linspace(-math.pi, math.pi, N, endpoint=False) + math.pi/N
    def interp(a):
        a2 = np.concatenate([A-2*math.pi, A, A+2*math.pi]); P2 = np.concatenate([P, P, P])
        o = np.argsort(a2)
        return np.array([np.interp(a, a2[o], P2[o][:, k]) for k in range(3)])
    ring = np.array([interp(a) for a in tgt])
    kind = g['collar']
    verts = []; faces = []
    if kind == 'rib':
        rows = [(0, 0.0, 0.0), (0.012, 0.004, 0.0), (0.024, 0.006, 0.0)]
    else:
        rows = None
    cols = len(ring)
    rowpts = []
    for i, p in enumerate(ring):
        a = tgt[i]
        n = np.array([p[0], p[1]+0.004, 0.0]); n /= (np.linalg.norm(n)+1e-9)
        up = np.array([0, 0, 1.0])
        front = max(0.0, math.cos(a))  # 1 at front center
        if kind == 'rib':
            r = [p, p + up*0.012 + n*0.003, p + up*0.022 + n*0.004]
        else:
            leaf = 0.038 + 0.035*front**3
            stand = 0.030 - 0.012*front
            r = [p,
                 p + up*stand*0.6 - n*0.001,
                 p + up*stand + n*0.004,
                 p + up*(stand*0.9) + n*0.014,
                 p + up*(stand*0.2) + n*(leaf*0.6) - up*0.006*front,
                 p - up*(0.012+0.04*front**3) + n*leaf]
        rowpts.append(r)
    nr = len(rowpts[0])
    # front gap for shirt collars (open neck)
    for i in range(cols):
        for k in range(nr):
            verts.append(rowpts[i][k].tolist())
    for i in range(cols):
        j = (i+1) % cols
        if kind == 'shirt' and (abs(tgt[i]) < 0.05 or abs(tgt[j]) < 0.05 or (tgt[i] < 0 < tgt[j])):
            continue
        for k in range(nr-1):
            faces.append([i*nr+k, j*nr+k, j*nr+k+1, i*nr+k+1])
    co = np_to_obj('collar', np.array(verts), np.array(faces))
    return co

def add_buttons_and_placket(ob, g):
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    objs = []
    nb = g['buttons']
    ztop = 1.375 if g['collar'] else 1.36
    zbot = 1.05 if nb > 3 else 1.24
    # placket strip
    zs = np.linspace(g['hem'] + 0.01 if nb > 3 else zbot - 0.03, ztop + 0.02, 60)
    vs = []; fs = []
    for i, z in enumerate(zs):
        for x in (-0.017, 0.0, 0.017):
            h = ray_front(bvh, x, z)
            if h[0] is None: h = (Vector((x, -0.13, z)), Vector((0, -1, 0)))
            vs.append((h[0] + h[1]*0.0018).to_tuple())
    for i in range(len(zs)-1):
        for k in range(2):
            a = i*3+k
            fs.append([a, a+1, a+4, a+3])
    pl = np_to_obj('placket', np.array(vs), np.array(fs))
    objs.append(pl)
    for z in np.linspace(zbot, ztop - 0.01, nb):
        h = ray_front(bvh, 0.0, z)
        if h[0] is None: continue
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.0058, depth=0.0028)
        b = bpy.context.active_object
        b.rotation_mode = 'QUATERNION'
        b.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(h[1])
        b.location = h[0] + h[1]*0.0035
        b.name = 'button'
        b.data.materials.append(bpy.data.materials.get('Button') or bpy.data.materials.new('Button'))
        objs.append(b)
    return objs

def join(objs, target):
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs: o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()

def smooth(x0, x1, x):
    t = np.clip((x-x0)/(x1-x0), 0, 1); return t*t*(3-2*t)

BONES = None
def make_armature():
    arm = bpy.data.armatures.new('Rig')
    ob = bpy.data.objects.new('Rig', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones
    def B(n, h, t, parent=None):
        b = eb.new(n); b.head = h; b.tail = t
        if parent: b.parent = eb[parent]
        b.use_connect = False
        return b
    B('hips', (0, 0, 0.95), (0, 0, 1.10))
    B('spine', (0, 0, 1.10), (0, 0, 1.28), 'hips')
    B('chest', (0, 0, 1.28), (0, 0, 1.45), 'spine')
    B('neck', (0, 0, 1.45), (0, 0, 1.60), 'chest')
    for s, sx in (('L', 1), ('R', -1)):
        a, e, w, d = S.arm_pts(sx)
        B('shoulder.'+s, (0.04*sx, 0, 1.435), tuple(a), 'chest')
        B('upperarm.'+s, tuple(a), tuple(e), 'shoulder.'+s)
        B('forearm.'+s, tuple(e), tuple(w), 'upperarm.'+s)
    for b in eb: b.roll = 0
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob

def skin(ob, rig):
    names = ['hips', 'spine', 'chest', 'neck', 'shoulder.L', 'upperarm.L', 'forearm.L', 'shoulder.R', 'upperarm.R', 'forearm.R']
    vg = {n: ob.vertex_groups.new(name=n) for n in names}
    for v in ob.data.vertices:
        p = np.array(v.co)
        x, y, z = p
        side = 1 if x > 0 else -1; s = 'L' if side > 0 else 'R'
        t = arm_t(p, side)
        s_, e_, w_, d_ = S.arm_pts(side)
        q_ = p - s_; rad = np.linalg.norm(q_ - d_*np.clip(q_ @ d_, 0, 1))
        a = smooth(-0.035, 0.07, t) * (1.0 if abs(x) > 0.07 else 0.0) * (1 - smooth(0.085, 0.13, rad))
        fore = smooth(S.UA - 0.05, S.UA + 0.05, t)
        sh = a * (1 - smooth(0.0, 0.09, t)) * 0.55
        ua = a * (1 - fore) - sh
        fa = a * fore
        tor = 1 - a
        # shoulder area of torso also partially follows shoulder bone
        shz = tor * smooth(1.30, 1.42, z) * smooth(0.08, 0.17, abs(x)) * 0.5
        tor -= shz; sh += shz
        hips = tor * (1 - smooth(1.00, 1.12, z))
        chest = tor * smooth(1.20, 1.34, z)
        spine = tor - hips - chest
        neck = 0.0
        W = {'hips': hips, 'spine': spine, 'chest': chest, 'neck': neck,
             'shoulder.'+s: sh, 'upperarm.'+s: ua, 'forearm.'+s: fa}
        for n, w in W.items():
            if w > 0.002: vg[n].add([v.index], float(w), 'REPLACE')
    m = ob.modifiers.new('arm', 'ARMATURE'); m.object = rig
    ob.parent = rig

def uv_project(ob, scale=1.0):
    """cylindrical-ish projection: torso around z, sleeves around arm axis. Units in meters*scale"""
    me = ob.data
    lay = me.uv_layers[0] if len(me.uv_layers) else me.uv_layers.new(name='UVMap')
    while len(me.uv_layers) > 1: me.uv_layers.remove(me.uv_layers[1])
    me.uv_layers.active = lay
    uv = lay.data
    for poly in me.polygons:
        c = np.array(poly.center)
        side = 1 if c[0] > 0 else -1
        t = arm_t(c, side)
        onarm = abs(c[0]) > 0.17 and t > 0.03
        angs = []
        for li in poly.loop_indices:
            p = np.array(me.vertices[me.loops[li].vertex_index].co)
            if onarm:
                s, e, w, d = S.arm_pts(side)
                q = p - s; tt = q @ d; r = q - d*tt
                ang = math.atan2(r[1], r[2]*np.sign(side) if False else r[2])
                angs.append((ang*0.06, tt))
            else:
                ang = math.atan2(p[0], -p[1])
                angs.append((ang*0.16, p[2]))
        # fix seams: unwrap angle jumps within polygon
        us = [a[0] for a in angs]
        if max(us) - min(us) > 0.2:
            per = 0.06*2*math.pi if onarm else 0.16*2*math.pi
            us = [u + per if u < 0 else u for u in us]
        for k, li in enumerate(poly.loop_indices):
            uv[li].uv = (us[k]*scale*12 + (5 if onarm else 0), angs[k][1]*scale*12)

def material(ob, name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if not ob.data.materials: ob.data.materials.append(m)
    else: ob.data.materials[0] = m

def build_body():
    V, F = S.mesh_from_sdf(S.body_sdf, np.array([-0.75, -0.2, 0.75]), np.array([0.75, 0.2, 1.72]), 0.008)
    body = np_to_obj('Body', V, F)
    remesh(body, 0.014)
    return body

def build(gname):
    clear()
    g = GARMENTS[gname]
    body = build_body()
    V, F = S.mesh_from_sdf(lambda P: S.garment_sdf(P, g), np.array([-0.8, -0.25, 0.65]), np.array([0.8, 0.25, 1.62]), 0.0065)
    sh = np_to_obj('Shirt', V, F)
    remesh(sh, 0.011)
    cut_garment(sh, g)
    cloth_sim(sh, body, tension=45 if gname == 'linen' else 30)
    for o in bpy.context.selected_objects: o.select_set(False)
    sm = sh.modifiers.new('sm', 'CORRECTIVE_SMOOTH'); sm.iterations = 2; apply_mods(sh)
    material(sh, 'Fabric')
    extra = []
    if g['collar']:
        co = add_collar(sh, g); material(co, 'Fabric'); extra.append(co)
    if g['buttons']:
        for o in add_buttons_and_placket(sh, g):
            if o.name.startswith('placket'): material(o, 'Fabric')
            extra.append(o)
    if extra: join(extra, sh)
    uv_project(sh)
    sh.data.shade_smooth()
    # body proxy for occlusion: smaller, decimated
    dec = body.modifiers.new('d', 'DECIMATE'); dec.ratio = 0.35; apply_mods(body)
    material(body, 'Occluder')
    rig = make_armature()
    skin(sh, rig); skin(body, rig)
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in (rig, sh, body): o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{gname}.glb', export_format='GLB', use_selection=True,
                              export_skins=True, export_animations=False, export_apply=False,
                              export_materials='EXPORT', export_normals=True, export_texcoords=True)
    print('DONE', gname, len(sh.data.vertices), len(body.data.vertices))

if __name__ == '__main__':
    for n in sys.argv[1:]:
        build(n)
