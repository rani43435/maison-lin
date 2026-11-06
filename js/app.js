import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ITEMS, SIZES, CREDITS } from './catalog.js?v=1793977773';
import { makeGarment, loadModel, HANG, HOOK_Y } from './garment.js?v=1793977773';

const $ = (s) => document.querySelector(s);
// dedicated layouts: phone (touch, small screen) vs desktop — chosen once, not by window size
const PHONE = (matchMedia('(pointer: coarse)').matches || /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent)) && Math.min(screen.width, screen.height) < 820;
document.body.classList.add(PHONE ? 'phone' : 'desk');
const canvas = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const BG = new THREE.Color('#E9DFD2');
const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 6.5, 14);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);

// light
const key = new THREE.DirectionalLight('#fff1df', 2.4);
key.position.set(2.6, 5.2, 4.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 4, bottom: -2, near: 0.5, far: 16 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 6;
scene.add(key);
const fill = new THREE.DirectionalLight('#e7d6c4', 0.7); fill.position.set(-4, 2, 2); scene.add(fill);
const rim = new THREE.DirectionalLight('#ffe2c0', 1.0); rim.position.set(-1, 3, -4); scene.add(rim);
scene.add(new THREE.HemisphereLight('#fff7ee', '#b9a38c', 0.35));

// floor + backdrop (cyclorama)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.ShadowMaterial({ opacity: 0.16 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), new THREE.ShadowMaterial({ opacity: 0.08 }));
wall.position.set(0, 5, -2.2); wall.receiveShadow = true; scene.add(wall);

// ---------- rail ----------
const RAIL_Y = 2.12, SPACING = 0.78;
const N = ITEMS.length;
const railLen = (N - 1) * SPACING + 1.4;
const rail = new THREE.Group(); scene.add(rail);
const brass = new THREE.MeshPhysicalMaterial({ color: '#b48a55', metalness: 1, roughness: 0.28, clearcoat: 0.4 });
const walnut = new THREE.MeshPhysicalMaterial({ color: '#4a3020', roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4 });
const hangerWood = new THREE.MeshPhysicalMaterial({ color: '#c9a77e', roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 });
{
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, railLen, 24), brass);
  rod.rotation.z = Math.PI / 2; rod.position.set(railLen / 2 - 0.7, RAIL_Y, 0); rod.castShadow = true; rail.add(rod);
  for (const x of [-0.7, railLen - 0.7]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, RAIL_Y + 0.04, 24), walnut);
    post.position.set(x, (RAIL_Y + 0.04) / 2, 0); post.castShadow = true; rail.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 16), brass); cap.position.set(x, RAIL_Y + 0.05, 0); rail.add(cap);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.62), walnut); foot.position.set(x, 0.015, 0); foot.castShadow = true; rail.add(foot);
  }
}
const profiles = {};
function shoulderProfile(g) {
  if (profiles[g.item.model]) return profiles[g.item.model];
  g.root.updateMatrixWorld(true);
  const hw = g.model.shoulderW / 2 * 0.85, step = 0.015;
  const bins = new Map();
  const v = new THREE.Vector3();
  // depth centre of the shoulder band
  let zs = 0, zn = 0;
  for (const m of g.meshes) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); if (v.y > 1.3 && Math.abs(v.x) < hw && Math.abs(v.x) > 0.08) { zs += v.z; zn++; } }
  }
  const zc = zn ? zs / zn : 0;
  for (const m of g.meshes) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.z - zc) > 0.035 || v.y < 1.2 || Math.abs(v.x) > hw) continue;
      const b = Math.round(v.x / step);
      if (!bins.has(b) || bins.get(b) < v.y) bins.set(b, v.y);
    }
  }
  const keys = [...bins.keys()].sort((x, y) => x - y);
  let pts = keys.map((b) => new THREE.Vector2(b * step, bins.get(b) - 0.04));
  // smooth + keep the arc below the neck opening
  for (let k = 0; k < 3; k++) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1) ? p : new THREE.Vector2(p.x, (pts[i - 1].y + p.y * 2 + pts[i + 1].y) / 4));
  const top = Math.max(...pts.map((p) => p.y));
  return (profiles[g.item.model] = { pts, top, zc });
}

function makeHanger(g) {
  const { pts, top, zc } = shoulderProfile(g);
  const grp = new THREE.Group(); grp.position.z = zc;
  // flat wooden arm: an extruded rounded profile swept along the shoulder line
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, p.y, 0)));
  const shape = new THREE.Shape();
  const w = 0.007, h = 0.013;
  shape.absellipse(0, 0, w, h, 0, Math.PI * 2);
  const arm = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { steps: 60, extrudePath: curve, bevelEnabled: false }), hangerWood);
  arm.castShadow = true; grp.add(arm);
  // brass neck + hook, rising from the centre of the arm through the collar
  const stemH = HOOK_Y - 0.045 - top;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, stemH, 10), brass);
  stem.position.y = top + stemH / 2; grp.add(stem);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 16), brass);
  nut.position.y = top + 0.008; grp.add(nut);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.003, 10, 40, Math.PI * 1.25), brass);
  hook.position.set(0.0, HOOK_Y - 0.026, 0); hook.rotation.z = -Math.PI * 0.12; grp.add(hook);
  return grp;
}

const slots = []; // {item, pivot, inner, g, hit, swing, swingV}
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
async function buildRail(progress) {
  let done = 0;
  await Promise.all([...new Set(ITEMS.map((i) => i.model))].map((m) => loadModel(m).then(() => progress(++done / 4))));
  for (const item of ITEMS) {
    const g = await makeGarment(item);
    const pivot = new THREE.Group();
    pivot.position.set(item.index * SPACING, RAIL_Y + 0.0, 0);
    const inner = new THREE.Group(); inner.position.y = -HOOK_Y; pivot.add(inner);
    const spin = new THREE.Group(); inner.add(spin);
    spin.add(g.root); spin.add(makeHanger(g));
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.8, 0.34), hitMat);
    hit.position.y = 1.12; hit.userData.slot = slots.length; inner.add(hit);
    pivot.rotation.y = (Math.random() - 0.5) * 0.25;
    rail.add(pivot);
    slots.push({ item, pivot, inner, spin, g, hit, swing: 0, swingV: 0, turn: pivot.rotation.y, baseTurn: pivot.rotation.y, lift: 0 });
  }
}

// ---------- state ----------
let offset = 0, target = 0, vel = 0;
const minOff = 0, maxOff = (N - 1) * SPACING;
let mode = 'home';
let selected = null;
let hovered = -1;
const pointer = new THREE.Vector2(-9, -9);
const ray = new THREE.Raycaster();
let drag = null, dragStartOff = 0;
let productSpin = 0, spinVel = 0, spinIdle = 0, lastMoveT = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const camPosT = new THREE.Vector3(), camLookT = new THREE.Vector3();

function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', layout);

function homeCamera() {
  if (PHONE) {
    const hf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const dist = Math.max(3.9, 0.52 / hf);
    const vh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    camPosT.set(0, 1.55, dist); camLookT.set(0, RAIL_Y - vh * 0.64, 0);
    return;
  }
  const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  const dist = Math.max(4.4, 3.6 / 2 / Math.tan(hf / 2));
  camPosT.set(0, 1.66, dist); camLookT.set(0, 1.56, 0);
}
function productCamera(slot) {
  const p = new THREE.Vector3(); slot.pivot.getWorldPosition(p);
  if (PHONE) {
    const hf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const dist = Math.max(4.2, 0.78 / hf);
    const vh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    camPosT.set(p.x, 1.6, 0.85 + dist); camLookT.set(p.x, RAIL_Y + 0.04 - vh * 0.8, 0.85);
    return;
  }
  camPosT.set(p.x + 0.5, 1.68, 3.2); camLookT.set(p.x + 0.5, 1.6, 0.6);
}

// ---------- input ----------
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, last: e.clientX }; dragStartOff = target;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('grabbing');
});
canvas.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!drag) return;
  const dx = e.clientX - drag.last; drag.last = e.clientX;
  drag.moved += Math.abs(dx);
  if (mode === 'home') target -= dx * (PHONE ? 0.0034 : 0.0042);
  else if (mode === 'product') {
    const now = performance.now(); const dtE = Math.max(8, now - lastMoveT) / 1000; lastMoveT = now;
    productSpin += dx * 0.009;
    spinVel = THREE.MathUtils.clamp(dx * 0.009 / dtE, -8, 8);
    spinIdle = 0;
  }
});
canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('grabbing');
  const click = drag && drag.moved < 6;
  if (PHONE && drag && mode === 'home' && !click) {
    // one garment per swipe
    const dx = e.clientX - drag.x;
    const from = Math.round(dragStartOff / SPACING);
    const step = Math.abs(dx) > 30 ? (dx < 0 ? 1 : -1) : 0;
    target = THREE.MathUtils.clamp(from + step, 0, N - 1) * SPACING;
  }
  drag = null;
  if (click) onClick(e);
});
addEventListener('wheel', (e) => {
  if (mode !== 'home') return;
  target += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.0016;
}, { passive: true });
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAll();
  if (mode === 'home' && e.key === 'ArrowRight') target = Math.round(target / SPACING + 1) * SPACING;
  if (mode === 'home' && e.key === 'ArrowLeft') target = Math.round(target / SPACING - 1) * SPACING;
});

function pick() {
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObjects(slots.map((s) => s.hit), false);
  return hits.length ? hits[0].object.userData.slot : -1;
}
function onClick() {
  if (mode !== 'home') return;
  const i = pick();
  if (i >= 0) openProduct(i);
}

// ---------- product ----------
let size = 'M';
function fillProduct(item) {
  $('#pLine').textContent = item.line;
  $('#pName').textContent = item.name;
  $('#pColor').textContent = item.color;
  $('#pSwatch').style.background = item.hex;
  $('#pPrice').textContent = `€${item.price}`;
  $('#pDesc').textContent = item.desc;
  $('#pDetails').innerHTML = item.details.map(([a, b]) => `<li><span>${a}</span><b>${b}</b></li>`).join('');
  $('#pSizes').innerHTML = SIZES.map((s) => `<button class="${s === size ? 'on' : ''}" data-size="${s}">${s}</button>`).join('');
}
$('#pSizes').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  size = b.dataset.size; fillProduct(slots[selected].item);
});
function openProduct(i) {
  selected = i; mode = 'product';
  document.body.classList.add('mode-product');
  target = i * SPACING;
  const s = slots[i];
  fillProduct(s.item);
  productSpin = 0; spinVel = 1.2; spinIdle = 0;
  setTimeout(() => $('#product').classList.add('open'), 250);
  hideLabel();
}
function closeProduct() {
  if (mode !== 'product') return;
  $('#product').classList.remove('open');
  document.body.classList.remove('mode-product');
  mode = 'home'; selected = null;
}

// ---------- bag ----------
let bag = [];
try { bag = JSON.parse(localStorage.getItem('ml_bag') || '[]'); } catch { bag = []; }
function saveBag() { try { localStorage.setItem('ml_bag', JSON.stringify(bag)); } catch {} renderBag(); }
function renderBag() {
  $('#bagCount').textContent = bag.length;
  const el = $('#bagItems');
  if (!bag.length) { el.innerHTML = '<p class="bag-empty">Your bag is empty.</p>'; }
  else el.innerHTML = bag.map((b, k) => {
    const it = ITEMS.find((i) => i.id === b.id);
    return `<div class="bag-item"><div class="sw" style="background:linear-gradient(160deg,${it.hex},${shade(it.hex)})"></div>
      <div><div class="n">${it.name}</div><div class="m">${it.color} · ${b.size}</div></div>
      <div class="r">€${it.price}<button class="rm" data-rm="${k}">Remove</button></div></div>`;
  }).join('');
  const tot = bag.reduce((a, b) => a + ITEMS.find((i) => i.id === b.id).price, 0);
  $('#bagTotal').textContent = `€${tot}`;
}
function shade(hex) { const c = new THREE.Color(hex); c.multiplyScalar(0.72); return '#' + c.getHexString(); }
$('#bagItems').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  bag.splice(+b.dataset.rm, 1); saveBag();
});
function addToBag(item, sz = size) {
  bag.push({ id: item.id, size: sz }); saveBag();
  toast(`${item.name} — ${item.color} added`);
}
function openBag() { $('#bag').classList.add('open'); $('#scrim').classList.add('on'); }
function closeBag() { $('#bag').classList.remove('open'); $('#scrim').classList.remove('on'); }
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200); }
renderBag();
$('#creditList').innerHTML = CREDITS.map(([t, a, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a><span>by ${a}</span></li>`).join('');

// ---------- try-on ----------
let tryon = null;
async function openTryOn(item) {
  const mod = await import('./tryon.js?v=1793977773');
  if (!tryon) tryon = new mod.TryOn({ items: ITEMS, onAdd: (it) => addToBag(it, size) });
  running = false;
  await tryon.open(item);
}
document.addEventListener('tryon-closed', () => { running = true; tick(); });

function closeAll() {
  closeBag();
  if (tryon && tryon.isOpen) { tryon.close(); return; }
  closeProduct();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (a.tagName === 'A') e.preventDefault();
  if (act === 'bag') openBag();
  if (act === 'credits') $('#credits').classList.toggle('on');
  if (act === 'closeCredits') $('#credits').classList.remove('on');
  if (act === 'closeBag' || act === 'closeAll') closeBag();
  if (act === 'closeProduct') closeProduct();
  if (act === 'home' || act === 'collection') { closeBag(); closeProduct(); if (act === 'home') target = 0; }
  if (act === 'addBag' && selected != null) addToBag(slots[selected].item);
  if (act === 'tryOn' && selected != null) openTryOn(slots[selected].item);
  if (act === 'details') openProduct(Math.max(0, pbIdx));
  if (act === 'tryOnCur') openTryOn(slots[Math.max(0, pbIdx)].item);
});

// ---------- phone bar ----------
let pbIdx = -1;
function updatePhoneBar(i) {
  if (!PHONE || i === pbIdx) return;
  const first = pbIdx < 0; pbIdx = i;
  const it = ITEMS[i]; const bar = $('#pbar');
  const fill = () => {
    $('#pbLine').textContent = it.line; $('#pbCount').textContent = `${String(i + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
    $('#pbName').textContent = it.name; $('#pbColor').textContent = it.color; $('#pbPrice').textContent = `€${it.price}`;
    $('#pbSwatch').style.background = it.hex;
    [...$('#pbDots').children].forEach((d, k) => d.classList.toggle('on', k === i));
    bar.classList.remove('swap');
  };
  if (first) fill(); else { bar.classList.add('swap'); setTimeout(fill, 180); }
}
if (PHONE) $('#pbDots').innerHTML = ITEMS.map(() => '<i></i>').join('');

// ---------- label ----------
const label = $('#label');
function hideLabel() { label.classList.remove('on'); }
function showLabel(slot) {
  const p = new THREE.Vector3(); slot.pivot.getWorldPosition(p); p.y -= 1.0;
  p.project(camera);
  label.style.left = `${(p.x + 1) / 2 * innerWidth}px`;
  label.style.top = `${(1 - p.y) / 2 * innerHeight + 8}px`;
  label.querySelector('.hl-name').textContent = `${slot.item.name}`;
  label.querySelector('.hl-price').textContent = `${slot.item.color.toUpperCase()} — €${slot.item.price}`;
  label.classList.add('on');
}

// ---------- loop ----------
const clock = new THREE.Clock();
let running = true;
function tick() {
  if (!running) return;
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // rail scroll with inertia + soft snapping when idle
  target = THREE.MathUtils.clamp(target, minOff - 0.3, maxOff + 0.3);
  if (!drag && mode === 'home') {
    const snap = Math.round(THREE.MathUtils.clamp(target, minOff, maxOff) / SPACING) * SPACING;
    target += (snap - target) * Math.min(1, dt * 1.6);
  }
  const prev = offset;
  offset += (target - offset) * Math.min(1, dt * 5);
  vel = (offset - prev) / Math.max(dt, 1e-3);
  rail.position.x = -offset;
  const ci = Math.round(THREE.MathUtils.clamp(offset, minOff, maxOff) / SPACING);
  $('#cIdx').textContent = String(ci + 1).padStart(2, '0');
  updatePhoneBar(ci);

  // hover
  if (mode === 'home' && !drag && !PHONE) {
    const h = pick();
    if (h !== hovered) { hovered = h; canvas.classList.toggle('pointer', h >= 0); }
  } else if (hovered !== -1) { hovered = -1; canvas.classList.remove('pointer'); }

  // garments: pendulum swing from rail velocity, hover turn, product lift
  slots.forEach((s, i) => {
    const acc = -vel * 0.9 - s.swing * 38 - s.swingV * 2.6;
    s.swingV += acc * dt; s.swing += s.swingV * dt;
    const isSel = mode === 'product' && selected === i;
    const isHover = hovered === i || (PHONE && mode === 'home' && i === ci);
    const phoneCur = PHONE && mode === 'home' && i === ci;
    const turnT = isSel || phoneCur ? 0 : isHover ? s.baseTurn + 0.38 : s.baseTurn + Math.sin(t * 0.4 + i) * 0.03;
    s.turn += (turnT - s.turn) * Math.min(1, dt * 3);
    s.lift += ((isSel ? 1 : phoneCur ? 0.3 : isHover ? 0.18 : 0) - s.lift) * Math.min(1, dt * 3);
    s.pivot.rotation.z = s.swing + Math.sin(t * 0.7 + i * 1.7) * 0.006;
    s.pivot.rotation.y = s.turn;
    s.pivot.position.z = s.lift * 0.85;
    s.pivot.position.y = RAIL_Y + s.lift * 0.04;
    if (isSel) {
      if (!drag) {
        spinIdle += dt;
        spinVel *= Math.exp(-dt * 2.2);
        const auto = THREE.MathUtils.smoothstep(spinIdle, 1.5, 3.0) * 0.32;
        productSpin += (spinVel + auto) * dt;
      }
      s.spin.rotation.y += (productSpin - s.spin.rotation.y) * Math.min(1, dt * 12);
    } else {
      // ease back to facing front by the shortest way
      const r = s.spin.rotation.y; const tgt = Math.round(r / (Math.PI * 2)) * Math.PI * 2;
      s.spin.rotation.y += (tgt - r) * Math.min(1, dt * 3);
    }
  });

  if (!PHONE && mode === 'home' && hovered >= 0) showLabel(slots[hovered]); else hideLabel();

  if (mode === 'product' && selected != null) productCamera(slots[selected]); else homeCamera();
  camPos.lerp(camPosT, Math.min(1, dt * 2.4));
  camLook.lerp(camLookT, Math.min(1, dt * 2.4));
  // subtle parallax
  const px = mode === 'home' && !PHONE ? pointer.x * 0.08 : 0, py = mode === 'home' && !PHONE ? pointer.y * 0.04 : 0;
  camera.position.set(camPos.x + (Math.abs(px) < 1 ? px : 0), camPos.y + (Math.abs(py) < 1 ? py : 0), camPos.z);
  camera.lookAt(camLook);

  renderer.render(scene, camera);
}

// ---------- boot ----------
(async () => {
  layout(); homeCamera(); camPos.copy(camPosT).add(new THREE.Vector3(0, 0.25, 1.4)); camLook.copy(camLookT);
  $('#cTot').textContent = String(N).padStart(2, '0');
  const bar = $('.loader-bar span');
  await buildRail((p) => { bar.style.width = `${Math.round(p * 90)}%`; });
  renderer.compile(scene, camera);
  bar.style.width = '100%';
  tick();
  setTimeout(() => $('#loader').classList.add('done'), 400);
  window.__ml = { scene, camera, slots, openProduct, closeProduct };
})();
