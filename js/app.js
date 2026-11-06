import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ITEMS, SIZES, CREDITS } from './catalog.js';
import { makeGarment, loadModel, HANG, HOOK_Y } from './garment.js';

const $ = (s) => document.querySelector(s);
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
function makeHanger() {
  const g = new THREE.Group();
  const pts = [[-0.19, 1.375], [-0.13, 1.415], [-0.06, 1.44], [0, 1.448], [0.06, 1.44], [0.13, 1.415], [0.19, 1.375]].map(([x, y]) => new THREE.Vector3(x, y, 0));
  const arm = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.011, 10), hangerWood);
  arm.scale.z = 1.8; arm.castShadow = true; g.add(arm);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.17, 8), brass); stem.position.y = 1.53; g.add(stem);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0035, 8, 32, Math.PI * 1.35), brass);
  hook.position.set(0, HOOK_Y - 0.03, 0); hook.rotation.z = -Math.PI * 0.18; g.add(hook);
  return g;
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
    inner.add(g.root); inner.add(makeHanger());
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.8, 0.34), hitMat);
    hit.position.y = 1.12; hit.userData.slot = slots.length; inner.add(hit);
    pivot.rotation.y = (Math.random() - 0.5) * 0.25;
    rail.add(pivot);
    slots.push({ item, pivot, inner, g, hit, swing: 0, swingV: 0, turn: pivot.rotation.y, baseTurn: pivot.rotation.y, lift: 0 });
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
let drag = null;
let productSpin = 0, productSpinV = 0;
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
  const mobile = innerWidth < 760;
  const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  const want = mobile ? 1.55 : 3.6;
  const dist = Math.max(4.4, want / 2 / Math.tan(hf / 2));
  camPosT.set(0, 1.66, dist); camLookT.set(0, 1.56, 0);
}
function productCamera(slot) {
  const mobile = innerWidth < 760;
  const p = new THREE.Vector3(); slot.pivot.getWorldPosition(p);
  if (mobile) { camPosT.set(p.x, 1.25, 4.6); camLookT.set(p.x, 1.1, 0.85); }
  else { camPosT.set(p.x + 0.5, 1.68, 3.2); camLookT.set(p.x + 0.5, 1.6, 0.6); }
}

// ---------- input ----------
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, last: e.clientX };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('grabbing');
});
canvas.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!drag) return;
  const dx = e.clientX - drag.last; drag.last = e.clientX;
  drag.moved += Math.abs(dx);
  if (mode === 'home') target -= dx * 0.0042 * (innerWidth < 760 ? 1.6 : 1);
  else if (mode === 'product') productSpinV = dx * 0.012;
});
canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('grabbing');
  const click = drag && drag.moved < 6;
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
  productSpin = 0; productSpinV = 0.06;
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
  const mod = await import('./tryon.js');
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
});

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

  // hover
  if (mode === 'home' && !drag) {
    const h = pick();
    if (h !== hovered) { hovered = h; canvas.classList.toggle('pointer', h >= 0); }
  } else if (hovered !== -1) { hovered = -1; canvas.classList.remove('pointer'); }

  // garments: pendulum swing from rail velocity, hover turn, product lift
  slots.forEach((s, i) => {
    const acc = -vel * 0.9 - s.swing * 38 - s.swingV * 2.6;
    s.swingV += acc * dt; s.swing += s.swingV * dt;
    const isSel = mode === 'product' && selected === i;
    const isHover = hovered === i;
    const turnT = isSel ? 0 : isHover ? s.baseTurn + 0.38 : s.baseTurn + Math.sin(t * 0.4 + i) * 0.03;
    s.turn += (turnT - s.turn) * Math.min(1, dt * 3);
    s.lift += ((isSel ? 1 : isHover ? 0.18 : 0) - s.lift) * Math.min(1, dt * 3);
    s.pivot.rotation.z = s.swing + Math.sin(t * 0.7 + i * 1.7) * 0.006;
    s.pivot.rotation.y = s.turn;
    s.pivot.position.z = s.lift * 0.85;
    s.pivot.position.y = RAIL_Y + s.lift * 0.04;
    if (isSel) {
      if (!drag) productSpinV += (0.0035 - productSpinV) * dt * 0.8;
      productSpin += productSpinV; productSpinV *= drag ? 0.6 : 0.985;
      s.g.root.rotation.y = productSpin;
    } else {
      s.g.root.rotation.y += (0 - s.g.root.rotation.y) * Math.min(1, dt * 3);
    }
  });

  if (mode === 'home' && hovered >= 0) showLabel(slots[hovered]); else hideLabel();

  if (mode === 'product' && selected != null) productCamera(slots[selected]); else homeCamera();
  camPos.lerp(camPosT, Math.min(1, dt * 2.4));
  camLook.lerp(camLookT, Math.min(1, dt * 2.4));
  // subtle parallax
  const px = mode === 'home' ? pointer.x * 0.08 : 0, py = mode === 'home' ? pointer.y * 0.04 : 0;
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
