import sys, bpy, math, json, numpy as np
from mathutils import Vector, Matrix
CFG = {
 'tee':   dict(drop=['Object_6','Object_8','Object_11','Object_15'], sleeves=['Object_18','Object_20']),
 'knit':  dict(drop=[], sleeves=[]),
 'polo':  dict(drop=[], sleeves=['Yellow Shirt_Arms_0']),
 'linen': dict(drop=['Object_3'], sleeves=[]),
}
n=sys.argv[1]; yaw_extra=float(sys.argv[2]) if len(sys.argv)>2 else 0
c=CFG[n]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f'/home/claude/sf/{n}/scene.gltf')
sc=bpy.context.scene
meshes=[o for o in sc.objects if o.type=='MESH']
for o in meshes:
    o.data.attributes.new('sleeve','FLOAT','POINT')
    if o.name in c['drop']: bpy.data.objects.remove(o); continue
# bake transforms & tag sleeve
meshes=[o for o in sc.objects if o.type=='MESH']
for o in meshes:
    me=o.data
    me.transform(o.matrix_world)
    o.parent=None; o.matrix_world=Matrix()
    a=me.attributes['sleeve']
    val=1.0 if o.name in c['sleeves'] else 0.0
    for d in a.data: d.value=val
for o in [o for o in sc.objects if o.type!='MESH']: bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
bpy.ops.object.join()
ob=bpy.context.active_object; ob.name='Shirt'
V=np.array([v.co for v in ob.data.vertices])
# up axis: assume +z after gltf import; check extents
ext=V.max(0)-V.min(0)
print('ext',ext)
# yaw by PCA on top band
zt=V[:,2].max(); h=ext[2]
top=V[V[:,2]>zt-0.3*h]
xy=top[:,:2]-top[:,:2].mean(0)
w,vec=np.linalg.eigh(np.cov(xy.T)); ax=vec[:,1]
yaw=-math.atan2(ax[1],ax[0])
R=Matrix.Rotation(yaw+math.radians(yaw_extra),4,'Z')
ob.data.transform(R)
V=np.array([v.co for v in ob.data.vertices])
# front: top-most verts (back collar) should be +y (back). if mean of topmost > center -> fine
topv=V[V[:,2]>V[:,2].max()-0.03*h]
if topv[:,1].mean() < V[:,1].mean() and yaw_extra==0:
    ob.data.transform(Matrix.Rotation(math.pi,4,'Z')); print('flipped')
V=np.array([v.co for v in ob.data.vertices])
# scale: torso width measured at 35% from top, central slab via |x| of verts with sleeve=0
sl=np.array([d.value for d in ob.data.attributes['sleeve'].data])
zt=V[:,2].max(); h=V[:,2].max()-V[:,2].min()
json.dump({'zt':float(zt),'h':float(h),'xmin':float(V[:,0].min()),'xmax':float(V[:,0].max()),'ymin':float(V[:,1].min()),'ymax':float(V[:,1].max()),'zmin':float(V[:,2].min()),'xc':float(V[:,0].mean()),'yc':float(V[:,1].mean())},open(f'/home/claude/sf/{n}_raw.json','w'))
bpy.ops.wm.save_as_mainfile(filepath=f'/home/claude/sf/{n}_oriented.blend')
print('verts',len(V))
