import sys,bpy,numpy as np,json
from mathutils import Matrix
n=sys.argv[1]; H=float(sys.argv[2])
bpy.ops.wm.open_mainfile(filepath=f'/home/claude/sf/{n}_oriented.blend')
ob=bpy.data.objects['Shirt']
V=np.array([v.co for v in ob.data.vertices]); mn=V.min(0); mx=V.max(0)
s=H/(mx[2]-mn[2])
ob.data.transform(Matrix.Translation((-(mn[0]+mx[0])/2,-(mn[1]+mx[1])/2,-mx[2])))
ob.data.transform(Matrix.Scale(s,4))
ob.data.transform(Matrix.Translation((0,0,1.50)))  # collar top at 1.50
bpy.ops.wm.save_as_mainfile(filepath=f'/home/claude/sf/{n}_norm.blend')
V=np.array([v.co for v in ob.data.vertices]); print('BOX',V.min(0).round(3),V.max(0).round(3),len(V))
