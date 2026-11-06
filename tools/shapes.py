"""SDF body / garment shapes. Blender coords: z up, front = -y, character's left = +x."""
import numpy as np
from skimage import measure

SH = np.array([0.185, 0.0, 1.425])      # left shoulder joint
DOWN = np.radians(42)                     # A-pose angle below horizontal
UA, FA = 0.29, 0.26
def arm_pts(side=1):
    s = SH * np.array([side, 1, 1])
    d = np.array([side*np.cos(DOWN), 0, -np.sin(DOWN)])
    e = s + d*UA
    w = e + d*FA
    return s, e, w, d

def smin(a, b, k):
    h = np.clip(0.5 + 0.5*(b-a)/k, 0, 1)
    return b*(1-h) + a*h - k*h*(1-h)

def cone_capsule(P, a, b, ra, rb):
    ba = b - a
    t = np.clip(((P-a) @ ba) / (ba @ ba), 0, 1)
    c = a + t[..., None]*ba
    r = ra + (rb-ra)*t
    return np.linalg.norm(P-c, axis=-1) - r

# torso profile: z -> (rx, ry_front, ry_back, ycenter)
TZ = np.array([0.80, 0.95, 1.05, 1.18, 1.30, 1.40, 1.47])
TRX = np.array([0.170, 0.172, 0.150, 0.160, 0.172, 0.165, 0.10])
TRYF = np.array([0.105, 0.110, 0.098, 0.110, 0.122, 0.105, 0.07])
TRYB = np.array([0.100, 0.105, 0.090, 0.095, 0.100, 0.095, 0.065])

def torso(P, ease=0.0, zmin=0.80, zmax=1.47):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    zc = np.clip(z, zmin, zmax)
    rx = np.interp(zc, TZ, TRX) + ease
    ryf = np.interp(zc, TZ, TRYF) + ease
    ryb = np.interp(zc, TZ, TRYB) + ease
    ry = np.where(y < 0, ryf, ryb)
    q = np.sqrt((x/rx)**2 + (y/ry)**2)
    d2 = (q-1)*np.minimum(rx, ry)
    dz = np.maximum(z - zmax, zmin - z)
    out = np.sqrt(np.maximum(d2, 0)**2 + np.maximum(dz, 0)**2)
    return out + np.minimum(np.maximum(d2, dz), 0)

def body_sdf(P):
    d = torso(P)
    d = smin(d, cone_capsule(P, np.array([-0.15, 0, 1.43]), np.array([0.15, 0, 1.43]), 0.07, 0.07), 0.05)
    d = smin(d, cone_capsule(P, np.array([0, 0.0, 1.42]), np.array([0, 0.005, 1.66]), 0.058, 0.055), 0.04)
    for s in (1, -1):
        a, e, w, _ = arm_pts(s)
        d = smin(d, cone_capsule(P, a, e, 0.055, 0.044), 0.04)
        d = smin(d, cone_capsule(P, e, w, 0.042, 0.031), 0.02)
    return d

def garment_sdf(P, g):
    ease = g['ease']; se = g['sleeve_ease']
    d = torso(P, ease, zmin=0.70, zmax=1.44)
    d = smin(d, cone_capsule(P, np.array([-0.17, 0, 1.415]), np.array([0.17, 0, 1.415]), 0.064+ease*0.5, 0.064+ease*0.5), 0.07)
    for s in (1, -1):
        a, e, w, dd = arm_pts(s)
        w2 = w + dd*0.06
        r_cuff = g.get('cuff_r', None)
        d = smin(d, cone_capsule(P, a - dd*0.02, e, 0.06+se, 0.05+se), 0.06)
        d = smin(d, cone_capsule(P, e, w2, 0.05+se*0.9, (r_cuff if r_cuff else 0.04+se*0.8)), 0.03)
    return d

def mesh_from_sdf(f, lo, hi, h):
    xs = np.arange(lo[0], hi[0], h); ys = np.arange(lo[1], hi[1], h); zs = np.arange(lo[2], hi[2], h)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    P = np.stack([X, Y, Z], -1)
    V = f(P)
    verts, faces, _, _ = measure.marching_cubes(V, 0.0, spacing=(h, h, h))
    verts += lo
    return verts, faces[:, ::-1]  # outward normals
