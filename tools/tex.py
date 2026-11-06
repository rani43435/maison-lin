import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
N=512; rng=np.random.default_rng(3)
y,x=np.mgrid[0:N,0:N]/N
def tile_noise(s,sig):
    n=rng.standard_normal((N,N)); return gaussian_filter(n,sig,mode='wrap')*s
def save(name,h,strength):
    h=(h-h.mean())/(h.std()+1e-9)
    gx=np.roll(h,-1,1)-np.roll(h,1,1); gy=np.roll(h,-1,0)-np.roll(h,1,0)
    nx=-gx*strength; ny=gy*strength; nz=np.ones_like(h)
    l=np.sqrt(nx**2+ny**2+nz**2)
    img=np.stack([(nx/l+1)/2,(ny/l+1)/2,(nz/l+1)/2],-1)
    Image.fromarray((img*255).astype(np.uint8)).save(f'/home/claude/maison-lin/assets/tex/{name}_n.jpg',quality=90)
    r=np.clip(0.5+0.25*h/3,0,1)
    Image.fromarray((r*255).astype(np.uint8)).save(f'/home/claude/maison-lin/assets/tex/{name}_h.jpg',quality=88)
# jersey: rows of V stitches
k=16
u=(x*k)%1; v=(y*k*1.4)%1
jersey=np.cos((np.abs(u-0.5)*2 - v)*np.pi*2)*0.5 + np.cos(u*2*np.pi)*0.6 + tile_noise(0.4,2)
save('jersey',jersey,0.35)
# knit rib: big vertical ribs with chevron stitches
k=8
u=(x*k)%1; v=(y*k*1.6)%1
rib=np.sin(u*np.pi)**0.7*1.6 + 0.6*np.cos((np.abs(u-0.5)*2.2 - v)*2*np.pi)*np.sin(u*np.pi) + tile_noise(0.5,3)
save('knit',rib,0.55)
# linen: plain weave w/ slubs
k=40
wx=np.sin(x*k*2*np.pi); wy=np.sin(y*k*2*np.pi)
check=np.sign(np.sin(x*k*np.pi)*np.sin(y*k*np.pi))
slub_x=gaussian_filter(rng.standard_normal(N),3,mode='wrap')[None,:]*np.ones((N,1))
slub_y=gaussian_filter(rng.standard_normal(N),3,mode='wrap')[:,None]*np.ones((1,N))
linen=0.6*(np.abs(wx)*(check>0)+np.abs(wy)*(check<0)) + 0.8*(slub_x+slub_y) + tile_noise(0.3,1)
save('linen',linen,0.5)
# pique: honeycomb
k=22
a=np.cos(x*k*2*np.pi)+np.cos((x*0.5+y*0.866)*k*2*np.pi)+np.cos((x*0.5-y*0.866)*k*2*np.pi)
pique=-np.abs(a)+tile_noise(0.3,1.5)
save('pique',pique,0.45)
print('ok')
