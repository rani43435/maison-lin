import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { FABRICS, MODELS } from './catalog.js?v=1794060210';

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const gltfCache = {};
const texCache = {};
export let onProgress = () => {};
export function setProgressHandler(f) { onProgress = f; }

export function loadModel(name) {
  if (!gltfCache[name]) {
    gltfCache[name] = new Promise((res, rej) => loader.load(`assets/${name}.glb`, res, undefined, rej));
  }
  return gltfCache[name];
}
function loadTex(url, repeat) {
  const key = url + repeat;
  if (!texCache[key]) {
    const t = texLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    texCache[key] = t;
  }
  return texCache[key];
}

const lumCache = new Map();
function meanLum(tex) {
  if (lumCache.has(tex)) return lumCache.get(tex);
  let v = 0.5;
  try {
    const img = tex.image; const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 32, 32);
    const d = x.getImageData(0, 0, 32, 32).data; let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 10) continue; const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255; s += Math.pow(l, 2.2); n++; }
    v = n ? s / n : 0.5;
  } catch {}
  lumCache.set(tex, v); return v;
}

function fabricMaterial(item, orig) {
  const f = FABRICS[item.fabric];
  const M = MODELS[item.model];
  const color = new THREE.Color(item.hex);
  const sheen = color.clone().lerp(new THREE.Color('#fff4e6'), 0.5);
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: f.rough, metalness: 0,
    sheen: f.sheen * 0.8, sheenRoughness: 0.6, sheenColor: sheen,
    side: THREE.DoubleSide,
  });
  if (orig && orig.normalMap) { m.normalMap = orig.normalMap; m.normalScale = new THREE.Vector2(0.6, 0.6); }
  else if (M.extra) { const e = FABRICS[M.extra]; m.normalMap = loadTex(e.map, M.extraRepeat); m.normalScale = new THREE.Vector2(M.extraScale, M.extraScale); }
  let detailMean = 0;
  if (M.detail && orig && orig.map) { m.map = orig.map; detailMean = meanLum(orig.map); }
  // fabric weave + soft drape folds layered on top of the model's own normals
  const dt = FABRICS[M.detailTex] || FABRICS.jersey;
  const detailTex = loadTex(dt.map, 1), foldTex = loadTex('assets/tex/folds_n.jpg', 1);
  m.defines = { ...(m.defines || {}), USE_UV: '' };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      detailMap: { value: detailTex }, foldMap: { value: foldTex },
      detailRepeat: { value: M.detailRepeat || 14 }, foldRepeat: { value: 1.6 },
      detailScale: { value: 0.35 * (dt.normal || 0.5) }, foldScale: { value: 0.12 },
    });
    sh.fragmentShader = 'uniform sampler2D detailMap; uniform sampler2D foldMap; uniform float detailRepeat; uniform float foldRepeat; uniform float detailScale; uniform float foldScale;\n' + sh.fragmentShader;
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec3 N0 = normal;
        vec3 q0 = dFdx( - vViewPosition ), q1 = dFdy( - vViewPosition );
        vec2 st0 = dFdx( vUv ), st1 = dFdy( vUv );
        vec3 q1perp = cross( q1, N0 ), q0perp = cross( N0, q0 );
        vec3 T = q1perp * st0.x + q0perp * st1.x;
        vec3 B = q1perp * st0.y + q0perp * st1.y;
        float det = max( dot( T, T ), dot( B, B ) );
        float sc = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
        vec3 d1 = texture2D( detailMap, vUv * detailRepeat ).xyz * 2.0 - 1.0;
        vec3 d2 = texture2D( foldMap, vUv * foldRepeat ).xyz * 2.0 - 1.0;
        vec2 dxy = d1.xy * detailScale + d2.xy * foldScale;
        normal = normalize( N0 + ( T * dxy.x + B * dxy.y ) * sc );
        if ( !gl_FrontFacing ) normal = normalize( mix( normal, nonPerturbedNormal, 0.85 ) );
      }`);
    if (detailMean) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 tx = texture2D( map, vMapUv );
          float lum = dot(tx.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= clamp(mix(1.0, lum / ${detailMean.toFixed(4)}, 0.85), 0.35, 1.5);
        #endif`);
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n diffuseColor.rgb *= gl_FrontFacing ? 1.0 : 0.6;');
  };
  return m;
}

const key = (n) => n.replace(/[^a-z]/gi, '').toLowerCase();

/** Create an instance of a garment for an item. Returns {root, rig, meshes, occluders} */
export async function makeGarment(item, { occlude = false } = {}) {
  const gltf = await loadModel(item.model);
  const root = SkeletonUtils.clone(gltf.scene);
  const bones = {}; const meshes = []; const occluders = [];
  const mats = new Map();
  const fabFor = (orig) => { if (!mats.has(orig)) mats.set(orig, fabricMaterial(item, orig)); return mats.get(orig); };
  const occ = new THREE.MeshBasicMaterial({ colorWrite: false });
  root.traverse((o) => {
    if (o.isBone) bones[key(o.name)] = o;
    if (o.isMesh) {
      const mn = (o.material && o.material.name) || '';
      o.frustumCulled = false;
      if (mn.startsWith('Occluder')) {
        o.material = occ; o.renderOrder = -1; o.visible = occlude; occluders.push(o);
      } else {
        o.material = fabFor(o.material);
        o.castShadow = true; o.receiveShadow = true;
        meshes.push(o);
      }
    }
  });
  const rig = new Rig(root, bones);
  return { root, rig, meshes, occluders, item, model: MODELS[item.model] };
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
export class Rig {
  constructor(root, bones) {
    this.root = root; this.b = bones;
    this.rest = {};
    this.restPos = {};
    for (const k in bones) { this.rest[k] = bones[k].quaternion.clone(); this.restPos[k] = bones[k].position.clone(); }
  }
  reset() { for (const k in this.b) this.b[k].quaternion.copy(this.rest[k]); }
  // rotate a bone about an axis given in the garment root's frame (used for hem sway / drape)
  bend(name, axisRoot, angle) {
    const bone = this.b[name]; if (!bone) return;
    if (!this.relRest) {
      this.relRest = {};
      const saved = {}; for (const k in this.b) { saved[k] = this.b[k].quaternion.clone(); this.b[k].quaternion.copy(this.rest[k]); }
      this.root.updateMatrixWorld(true);
      const rinv = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      for (const k in this.b) this.relRest[k] = rinv.clone().multiply(this.b[k].getWorldQuaternion(new THREE.Quaternion()));
      for (const k in this.b) this.b[k].quaternion.copy(saved[k]);
    }
    const ax = axisRoot.clone().applyQuaternion(this.relRest[name].clone().invert()).normalize();
    bone.quaternion.copy(this.rest[name]).multiply(_q.setFromAxisAngle(ax, angle));
  }
  // aim a bone so its rest direction points along worldDir (minimal rotation from rest)
  aim(name, worldDir, childName, slerp = 1) {
    const bone = this.b[name]; if (!bone) return;
    const restQ = this.rest[name];
    const prev = bone.quaternion.clone();
    bone.quaternion.copy(restQ);
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(_q).invert();
    let restDir;
    if (childName && this.b[childName]) restDir = _v.copy(this.b[childName].position).normalize().applyQuaternion(restQ);
    else restDir = _v.copy(bone.position).normalize();
    const tgt = _v2.copy(worldDir).normalize().applyQuaternion(_q);
    _q2.setFromUnitVectors(restDir, tgt);
    bone.quaternion.copy(_q2.multiply(restQ));
    if (slerp < 1) bone.quaternion.copy(prev.slerp(bone.quaternion, slerp));
    bone.updateWorldMatrix(false, true);
  }
  /** arm directions given in the garment root's local frame */
  armsLocal(uL, fL, uR, fR, slerp = 1) {
    this.root.updateWorldMatrix(true, true);
    const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    const w = (v) => v.clone().applyQuaternion(rq);
    this.aim('upperarml', w(uL), 'forearml', slerp); this.aim('forearml', w(fL), null, slerp);
    this.aim('upperarmr', w(uR), 'forearmr', slerp); this.aim('forearmr', w(fR), null, slerp);
  }
  armsWorld(uL, fL, uR, fR, slerp = 1) {
    this.aim('upperarml', uL, 'forearml', slerp); this.aim('forearml', fL, null, slerp);
    this.aim('upperarmr', uR, 'forearmr', slerp); this.aim('forearmr', fR, null, slerp);
  }
}

// relaxed hanging pose (arms fall alongside the body)
export const HANG = {
  uL: new THREE.Vector3(0.36, -1, -0.02), fL: new THREE.Vector3(0.22, -1, 0.06),
  uR: new THREE.Vector3(-0.36, -1, -0.02), fR: new THREE.Vector3(-0.22, -1, 0.06),
};
export const SHOULDER_Y = 1.425, HIPS_Y = 0.95, SHOULDER_W = 0.37, HOOK_Y = 1.64;
