import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
N=512; rng=np.random.default_rng(7)
y,x=np.mgrid[0:N,0:N]/N
def save(name,h,strength):
    h=(h-h.mean())/(h.std()+1e-9)
    gx=np.roll(h,-1,1)-np.roll(h,1,1); gy=np.roll(h,-1,0)-np.roll(h,1,0)
    nx=-gx*strength; ny=gy*strength; nz=np.ones_like(h); l=np.sqrt(nx**2+ny**2+nz**2)
    img=np.stack([(nx/l+1)/2,(ny/l+1)/2,(nz/l+1)/2],-1)
    Image.fromarray((img*255).astype(np.uint8)).save(f'/home/claude/maison-lin/assets/tex/{name}_n.jpg',quality=90)
# soft drape folds: mostly vertical, wavy, tileable
n=rng.standard_normal((N,N))
f=gaussian_filter(n,(28,6),mode='wrap')+0.5*gaussian_filter(rng.standard_normal((N,N)),(10,3),mode='wrap')
save('folds',f,3.0)
# fleece: fine loops + fuzz
k=60
loops=np.cos(x*k*2*np.pi)*np.cos(y*k*2*np.pi*1.2)
fuzz=gaussian_filter(rng.standard_normal((N,N)),0.8,mode='wrap')
save('fleece',0.5*loops+fuzz,0.35)
print('ok')
