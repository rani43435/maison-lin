import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ITEMS, SIZES, CREDITS, SIZE_SCALE, loadCatalog, SETTINGS } from './catalog.js?v=1794320004';
import { makeGarment, loadModel, texturesReady } from './garment.js?v=1794320004';
import { initShop } from './shop.js?v=1794320004';
await loadCatalog();
import { live, startCheckout } from './backend.js?v=1794320004';
// ---------- store settings from /admin (texts, colours, delivery) ----------
(function applySettings() {
  const st = SETTINGS;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (Array.isArray(st.announce) && st.announce.length) {
    const one = st.announce.map((t) => `<span>${esc(t)}</span>`).join('');
    document.querySelector('.announce-track').innerHTML = one + one;
  }
  const h = st.hero;
  if (h) {
    const el = document.querySelector('#intro');
    if (h.eyebrow !== undefined) el.querySelector('.eyebrow').textContent = h.eyebrow;
    if (h.title !== undefined) el.querySelector('h1').innerHTML = `${esc(h.title)}<br><em>${esc(h.titleItalic || '')}</em>`;
    if (h.sub !== undefined) el.querySelector('.intro-sub').textContent = h.sub;
  }
  const t = st.theme;
  if (t) {
    const r = document.documentElement.style;
    if (t.bg) { r.setProperty('--bg', t.bg); }
    if (t.ink) r.setProperty('--ink', t.ink);
    if (t.accent) r.setProperty('--caramel', t.accent);
    if (t.cream) r.setProperty('--cream', t.cream);
  }
  if (st.store && st.store.name) {
    const [a, ...b] = String(st.store.name).split(' ');
    document.querySelectorAll('.logo').forEach((l) => { l.innerHTML = b.length ? `${esc(a)} <em>${esc(b.join(' '))}</em>` : esc(a); });
    document.title = `${st.store.name} — ${document.title.split('—').pop().trim()}`;
  }
})();

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
if (SETTINGS.theme && SETTINGS.theme.bg) BG.set(SETTINGS.theme.bg); // colour chosen in /admin
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
const RAIL_Y = 2.2, SPACING = 0.78;
const N = ITEMS.length;
const railLen = (N - 1) * SPACING + 1.4;
const rail = new THREE.Group(); scene.add(rail);
const brass = new THREE.MeshPhysicalMaterial({ color: '#b48a55', metalness: 1, roughness: 0.28, clearcoat: 0.4 });
const walnut = new THREE.MeshPhysicalMaterial({ color: '#4a3020', roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4 });
const hangerWood = new THREE.MeshPhysicalMaterial({ color: '#c9a77e', roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 });
const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 24), brass);
rod.rotation.z = Math.PI / 2; rod.castShadow = true; rail.add(rod);
const endR = new THREE.Group(); rail.add(endR);
for (const x of [-0.7, 0]) {
  const end = x < 0 ? rail : endR;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, RAIL_Y + 0.04, 24), walnut);
  post.position.set(x, (RAIL_Y + 0.04) / 2, 0); post.castShadow = true; end.add(post);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 16), brass); cap.position.set(x, RAIL_Y + 0.05, 0); end.add(cap);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.62), walnut); foot.position.set(x, 0.015, 0); foot.castShadow = true; end.add(foot);
}
let railLenNow = railLen;
// rail length follows the number of pieces on it (category filter)
function sizeRail(len, instant) {
  railLenNow = instant ? len : railLenNow + (len - railLenNow) * 0.12;
  rod.scale.y = railLenNow; rod.position.set(railLenNow / 2 - 0.7, RAIL_Y, 0);
  endR.position.x = railLenNow - 0.7;
}
sizeRail(railLen, true);
// ---------- rope ----------
const ROPE = 0.2, ROPE_R = 0.0026;
const ropeGeoDown = new THREE.CylinderGeometry(ROPE_R, ROPE_R, 1, 8, 1, true).translate(0, -0.5, 0);
const tipGeo = new THREE.CylinderGeometry(0.0042, 0.0016, 0.012, 8);
const attachCache = {};
function attachPoint(g) {
  if (attachCache[g.item.model]) return attachCache[g.item.model];
  g.root.updateMatrixWorld(true);
  const v = new THREE.Vector3(); let best = null;
  for (const m of g.meshes) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.x) > 0.025) continue;
      if (!best || v.y > best.y) best = v.clone();
    }
  }
  return (attachCache[g.item.model] = best || new THREE.Vector3(0, 1.5, 0));
}
function ropeMat(hex) {
  const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.max(0.08, hsl.l * 0.62));
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _dn = new THREE.Vector3(0, -1, 0);
function placeRope(mesh, from, dir, len) {
  // mesh geometry hangs from its origin along -Y
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(_dn, dir);
  mesh.scale.set(1, Math.max(0.001, len), 1);
}

const slots = []; // {item, pivot, inner, g, hit, swing, swingV}
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
async function buildRail(progress) {
  let done = 0;
  const models = [...new Set(ITEMS.map((i) => i.model))];
  await Promise.all(models.map((m) => loadModel(m).then(() => progress(++done / models.length))));
  for (const item of ITEMS) {
    const g = await makeGarment(item);
    const pivot = new THREE.Group();
    pivot.position.set(item.index * SPACING, RAIL_Y + 0.0, 0);
    pivot.userData.x = item.index * SPACING;
    const at = attachPoint(g);
    const inner = new THREE.Group(); inner.position.set(0, -(at.y + ROPE), -at.z); pivot.add(inner);
    const spin = new THREE.Group(); inner.add(spin);
    spin.add(g.root);
    const rm = ropeMat(item.hex);
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.0175, 0.0034, 10, 36), rm);
    knot.rotation.y = Math.PI / 2; knot.position.set(item.index * SPACING, RAIL_Y, 0); rail.add(knot);
    const ropeA = new THREE.Mesh(ropeGeoDown, rm); ropeA.castShadow = true; rail.add(ropeA);
    const ropeB = new THREE.Mesh(ropeGeoDown, rm); ropeB.castShadow = true; rail.add(ropeB);
    const tipA = new THREE.Mesh(tipGeo, rm); rail.add(tipA);
    const tipB = new THREE.Mesh(tipGeo, rm); rail.add(tipB);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.8, 0.34), hitMat);
    hit.position.y = 1.12; hit.userData.slot = slots.length; inner.add(hit);
    pivot.rotation.y = (Math.random() - 0.5) * 0.25;
    rail.add(pivot);
    slots.push({ k: item.index, x: item.index * SPACING, shown: true, knot, item, pivot, inner, spin, g, hit, at, ropeA, ropeB, tipA, tipB, rope: 'intact', tc: 0, ph: { tz: 0, wz: 0, tx: 0, wx: 0, sz: 0, vz: 0, sx: 0, vx: 0, pz: 0, pvz: 0, hz: 0, hv: 0 }, dU: restArmDirs(g), armsDirty: true, turn: pivot.rotation.y, baseTurn: pivot.rotation.y, lift: 0, drop: 0 });
  }
}

// ---------- state ----------
const thumbs = {}; // id -> {f, b} studio shots for the store
let offset = 0, target = 0, vel = 0;
const minOff = 0; let maxOff = (N - 1) * SPACING;
let vis = ITEMS.map((_, i) => i); // slot indices on the rail, in order
let railCat = 'all';
/** show only one category on the rail (hoodies, knitwear, polos) — the others leave the rail */
function setRailFilter(cat) {
  railCat = cat;
  if (mode === 'product') closeProduct();
  vis = slots.map((s, i) => i).filter((i) => cat === 'all' || slots[i].item.category === cat);
  if (!vis.length) { vis = slots.map((s, i) => i); railCat = 'all'; }
  slots.forEach((s) => { s.shown = false; });
  vis.forEach((i, k) => { const s = slots[i]; if (!s.shown) { s.shown = true; } s.k = k; });
  slots.forEach((s) => { s.pivot.visible = s.knot.visible = s.shown; if (!s.shown) s.ropeA.visible = s.tipA.visible = false; else s.ropeA.visible = true; });
  maxOff = (vis.length - 1) * SPACING;
  target = 0; pbIdx = -1;
  if (PHONE) $('#pbDots').innerHTML = vis.map(() => '<i></i>').join('');
  $('#cTot').textContent = String(vis.length).padStart(2, '0');
  const names = { hoodies: 'Hoodies', knitwear: 'Knitwear', polos: 'Polos' };
  $('#railFilter').classList.toggle('on', railCat !== 'all'); document.body.classList.toggle('railf', railCat !== 'all');
  $('#rfName').textContent = `${names[railCat] || ''} — ${vis.length} piece${vis.length === 1 ? '' : 's'}`;
  document.querySelectorAll('[data-rail]').forEach((a) => a.classList.toggle('on', a.dataset.rail === railCat));
}
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
  camPosT.set(-0.62, 1.66, dist); camLookT.set(-0.62, 1.56, 0);
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
    target = THREE.MathUtils.clamp(from + step, 0, vis.length - 1) * SPACING;
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
  const hits = ray.intersectObjects(slots.filter((s) => s.shown).map((s) => s.hit), false);
  const h = hits.find((x) => slots[x.object.userData.slot].shown);
  return h ? h.object.userData.slot : -1;
}
function onClick() {
  if (mode !== 'home') return;
  const i = pick();
  if (i >= 0) openProduct(i);
}

// ---------- product ----------
let size = 'M';
// deterministic demo stock: a few sizes run low
function stockOf(item, sz) { if (item.stock && Object.keys(item.stock).length) return item.stock[sz] === undefined ? 9 : Number(item.stock[sz]); if (live()) return 9; let h = 7; for (const c of item.id + sz) h = (h * 31 + c.charCodeAt(0)) % 997; return h % 9 === 0 ? 0 : h % 5 === 0 ? 1 + (h % 3) : 9; }
function deliveryDate() {
  const d = new Date(); let n = 0;
  while (n < 3) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n++; }
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fillProduct(item) {
  $('#pLine').textContent = item.line;
  $('#pName').textContent = item.name;
  $('#pColor').textContent = item.color;
  $('#pSwatch').style.background = item.hex;
  $('#pPrice').textContent = `€${item.price}`;
  $('#pDesc').textContent = item.desc;
  $('#pDetails').innerHTML = item.details.map(([a, b]) => `<li><span>${a}</span><b>${b}</b></li>`).join('');
  $('#pSizes').innerHTML = SIZES.map((s) => `<button class="${s === size ? 'on' : ''}${stockOf(item, s) ? '' : ' out'}" data-size="${s}">${s}</button>`).join('');
  const st = stockOf(item, size);
  $('#pStock').textContent = st === 0 ? `${size} is sold out — we can notify you` : st < 4 ? `Only ${st} left in ${size}` : '';
  $('.product [data-act="addBag"]').disabled = st === 0;
  $('#pDelivery').textContent = `Delivered by ${deliveryDate()}`;
  const fam = item.base || item.model;
  $('#pVariants').innerHTML = ITEMS.filter((o) => (o.base || o.model) === fam).map((o) => `<button title="${o.color}" data-variant="${o.index}" class="${o === item ? 'on' : ''}" style="background:${o.hex}"></button>`).join('');
  $('#pHeart').classList.toggle('on', shop && shop.isWished(item.id));
  const rel = ITEMS.filter((o) => (o.base || o.model) !== fam).sort((a, b) => ((a.index * 7 + item.index) % 5) - ((b.index * 7 + item.index) % 5)).slice(0, 3);
  $('#pRelated').innerHTML = rel.map((o) => `<button data-open="${o.index}"><div class="ri">${thumbs[o.id] ? `<img src="${thumbs[o.id].f}" alt="">` : ''}</div><span>${o.name}</span><small>€${o.price}</small></button>`).join('');
}
$('#pVariants').addEventListener('click', (e) => {
  const b = e.target.closest('[data-variant]'); if (!b) return;
  const i = +b.dataset.variant; if (i === selected) return;
  closeProduct(); setTimeout(() => openProduct(i), 120);
});
$('#pSizes').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  size = b.dataset.size; fillProduct(slots[selected].item);
});
function openProduct(i) {
  if (!slots[i].shown) setRailFilter('all');
  selected = i; mode = 'product'; size = 'M';
  document.body.classList.add('mode-product');
  target = slots[i].k * SPACING;
  const s = slots[i];
  s.rope = 'cut'; s.tc = 0; s.ph.wz += 0.9 * (Math.random() < 0.5 ? -1 : 1); s.ph.wx -= 0.7;
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
bag = bag.filter((b) => ITEMS.some((i) => i.id === b.id)).map((b) => ({ qty: 1, ...b }));
let promo = '';
try { promo = localStorage.getItem('ml_promo') || ''; } catch {}
const FREE_SHIP = Number((SETTINGS.store || {}).freeShipping ?? 300);
const SHIP_FEE = Number((SETTINGS.store || {}).shippingFee ?? 12);
const promoPct = (c) => Number((SETTINGS.promo || {})[c] || 0);
function saveBag() { try { localStorage.setItem('ml_bag', JSON.stringify(bag)); localStorage.setItem('ml_promo', promo); } catch {} renderBag(); }
function renderBag() {
  const n = bag.reduce((a, b) => a + b.qty, 0);
  const c = $('#bagCount'); c.textContent = n; c.classList.toggle('on', n > 0);
  const el = $('#bagItems');
  if (!bag.length) { el.innerHTML = '<p class="bag-empty">Your bag is empty.</p>'; }
  else el.innerHTML = bag.map((b, k) => {
    const it = ITEMS.find((i) => i.id === b.id);
    const t = thumbs[it.id];
    return `<div class="bag-item"><div class="sw" style="${t ? '' : `background:linear-gradient(160deg,${it.hex},${shade(it.hex)})`}">${t ? `<img src="${t.f}" alt="">` : ''}</div>
      <div><div class="n">${it.name}</div><div class="m">${it.color} · ${b.size}</div><div class="qty"><button data-q="${k}" data-d="-1">−</button><span>${b.qty}</span><button data-q="${k}" data-d="1">+</button></div></div>
      <div class="r">€${it.price * b.qty}<button class="rm" data-rm="${k}">Remove</button></div></div>`;
  }).join('');
  const sub = bag.reduce((a, b) => a + ITEMS.find((i) => i.id === b.id).price * b.qty, 0);
  const disc = Math.round(sub * promoPct(promo) / 100);
  const ship = !sub ? 0 : sub - disc >= FREE_SHIP ? 0 : SHIP_FEE;
  $('#bagSub').textContent = `€${sub}`;
  $('#discRow').hidden = !disc; $('#bagDisc').textContent = `−€${disc}`;
  $('#bagShip').textContent = !sub ? '—' : ship ? `€${ship}` : 'Complimentary';
  $('#bagTotal').textContent = `€${sub - disc + ship}`;
  const left = Math.max(0, FREE_SHIP - (sub - disc));
  $('#shipText').textContent = !sub ? `Complimentary delivery on orders over €${FREE_SHIP}` : left ? `You are €${left} away from complimentary delivery` : 'Your order ships complimentary';
  $('#shipBar').style.width = `${Math.min(100, ((sub - disc) / FREE_SHIP) * 100)}%`;
  $('#promoIn').value = promo;
}
function shade(hex) { const c = new THREE.Color(hex); c.multiplyScalar(0.72); return '#' + c.getHexString(); }
$('#bagItems').addEventListener('click', (e) => {
  const q = e.target.closest('[data-q]');
  if (q) { const b = bag[+q.dataset.q]; b.qty = Math.max(0, b.qty + +q.dataset.d); if (!b.qty) bag.splice(+q.dataset.q, 1); saveBag(); return; }
  const b = e.target.closest('[data-rm]'); if (!b) return;
  bag.splice(+b.dataset.rm, 1); saveBag();
});
$('#promo').addEventListener('submit', (e) => {
  e.preventDefault(); const v = $('#promoIn').value.trim().toUpperCase();
  if (promoPct(v)) { promo = v; toast(`Code applied — ${promoPct(v)}% off`); } else { promo = ''; toast(v ? 'This code is not valid' : 'Code removed'); }
  saveBag();
});
function addToBag(item, sz = size) {
  const ex = bag.find((b) => b.id === item.id && b.size === sz);
  if (ex) ex.qty++; else bag.push({ id: item.id, size: sz, qty: 1 });
  saveBag();
  toast(`${item.name} — ${item.color}, ${sz} added`);
}
// ---------- checkout ----------
const coBtn = $('#checkoutBtn');
if (live()) { coBtn.disabled = false; $('#bagNote').innerHTML = 'Secure payment by card, Apple Pay or PayPal.'; }
coBtn.addEventListener('click', async () => {
  if (!bag.length) { toast('Your bag is empty'); return; }
  coBtn.disabled = true; const t0 = coBtn.textContent; coBtn.textContent = 'One moment…';
  try { location.href = await startCheckout(bag.map((b) => ({ id: b.id, size: b.size, qty: b.qty })), promo); }
  catch (e) { toast(e.message); coBtn.disabled = false; coBtn.textContent = t0; }
});
{
  const q = new URLSearchParams(location.search);
  if (q.get('order') === 'success') {
    bag = []; promo = ''; saveBag();
    setTimeout(() => toast(`Thank you — order ${q.get('n') ? '#' + q.get('n') + ' ' : ''}is confirmed. A receipt is on its way.`), 1200);
    history.replaceState(null, '', location.pathname);
  } else if (q.get('order') === 'cancelled') { setTimeout(() => toast('Payment cancelled — your bag is saved'), 1200); history.replaceState(null, '', location.pathname); }
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
  const mod = await import('./tryon.js?v=1794320004');
  if (!tryon) tryon = new mod.TryOn({ items: ITEMS, onAdd: (it, sz) => addToBag(it, sz || size), getSize: () => size, setSize: (s) => { size = s; if (selected != null) fillProduct(slots[selected].item); } });
  running = false;
  await tryon.open(item);
}
document.addEventListener('tryon-closed', () => { running = true; tick(); });

function closeAll() {
  closeBag();
  if (shop.isOpen()) { shop.closeShop(); return; }
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
  if (act === 'credits' && a.tagName === 'A') { shop.closeShop(); }
  if (act === 'addBag' && selected != null) addToBag(slots[selected].item);
  if (act === 'toggleWish' && selected != null) { shop.toggleWish(slots[selected].item.id); }
  if (act === 'atelier') { closeBag(); if (mode === 'product') closeProduct(); setRailFilter('all'); }
  if (act === 'tryOn' && selected != null) openTryOn(slots[selected].item);
  if (act === 'details') openProduct(vis[Math.max(0, pbIdx)]);
  if (act === 'tryOnCur') openTryOn(slots[vis[Math.max(0, pbIdx)]].item);
  if (act === 'clearRail') setRailFilter('all');
});

// ---------- store ----------
let paused = false;
const shop = initShop({
  items: ITEMS, thumbs,
  openOnRail: (i) => { if (mode === 'product') closeProduct(); if (!slots[i].shown) setRailFilter('all'); target = slots[i].k * SPACING; setTimeout(() => openProduct(i), mode === 'home' ? 450 : 50); },
  tryOn: (it) => openTryOn(it),
  toast, getSize: () => size,
  onShop: (open) => { paused = open; if (open) { closeBag(); if (mode === 'product') closeProduct(); } },
  onWish: () => { if (selected != null) $('#pHeart').classList.toggle('on', shop.isWished(slots[selected].item.id)); },
});

/** studio shots of every piece (front + back) for the shop grid, rendered by the same engine */
async function renderThumbs() {
  await texturesReady();
  const W = 480, H = 600;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(W, H); r.setPixelRatio(1);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  const sc = new THREE.Scene();
  sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture; sc.environmentIntensity = 0.6;
  const k = new THREE.DirectionalLight('#fff1df', 2.2); k.position.set(1.8, 3, 4); sc.add(k);
  const f2 = new THREE.DirectionalLight('#e7d6c4', 0.8); f2.position.set(-3, 1.5, 2); sc.add(f2);
  const bk = new THREE.DirectionalLight('#e7d6c4', 0.8); bk.position.set(0, 2, -4); sc.add(bk);
  sc.add(new THREE.HemisphereLight('#fff7ee', '#b9a38c', 0.45));
  const cam = new THREE.PerspectiveCamera(22, W / H, 0.1, 20);
  for (const it of ITEMS) {
    const g = await makeGarment(it);
    // relaxed, hanging sleeves like on the rail
    const d = restArmDirs(g); g.root.updateMatrixWorld(true);
    for (const sd of ['l', 'r']) if (d[sd]) g.rig.aim('upperarm' + sd, d[sd], 'forearm' + sd);
    sc.add(g.root); g.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g.root, true);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const dist = Math.max(sz.y / 2 / Math.tan(THREE.MathUtils.degToRad(11)), sz.x / 2 / Math.tan(THREE.MathUtils.degToRad(11)) / (W / H)) * 1.12;
    const out = {};
    for (const [side, sgn] of [['f', 1], ['b', -1]]) {
      cam.position.set(c.x + sgn * dist * 0.08, c.y + 0.05, c.z + sgn * dist); cam.lookAt(c);
      r.render(sc, cam);
      out[side] = await new Promise((res) => r.domElement.toBlob((b) => res(URL.createObjectURL(b)), 'image/webp', 0.86));
    }
    thumbs[it.id] = out;
    sc.remove(g.root);
  }
  r.dispose(); r.forceContextLoss();
  shop.refreshThumbs(); renderBag();
  if (selected != null) fillProduct(slots[selected].item);
}

// ---------- phone bar ----------
let pbIdx = -1;
function updatePhoneBar(i) {
  if (!PHONE || i === pbIdx) return;
  const first = pbIdx < 0; pbIdx = i;
  const it = slots[vis[i]] ? slots[vis[i]].item : ITEMS[0]; const bar = $('#pbar');
  const fill = () => {
    $('#pbLine').textContent = it.line; $('#pbCount').textContent = `${String(i + 1).padStart(2, '0')} / ${String(vis.length).padStart(2, '0')}`;
    $('#pbName').textContent = it.name; $('#pbColor').textContent = it.color; $('#pbPrice').textContent = `€${it.price}`;
    $('#pbSwatch').style.background = it.hex;
    [...$('#pbDots').children].forEach((d, k) => d.classList.toggle('on', k === i));
    bar.classList.remove('swap');
  };
  if (first) fill(); else { bar.classList.add('swap'); setTimeout(fill, 180); }
}
if (PHONE) $('#pbDots').innerHTML = ITEMS.map(() => '<i></i>').join('');
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-rail]'); if (!r) return;
  e.preventDefault(); shop.closeShop(); closeBag();
  $('#menu').classList.remove('open'); $('#scrim').classList.remove('on');
  setRailFilter(r.dataset.rail);
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

// ---------- physics: rope pendulum + lagging sleeves ----------
const G = 9.8, PL = 0.58; // pendulum length: rail -> garment centre of mass
// sleeves hang straight down under their own weight (a little away from the body)
function restArmDirs(g) {
  g.root.updateMatrixWorld(true);
  const out = {};
  for (const s of ['l', 'r']) {
    const u = g.rig.b['upperarm' + s], f = g.rig.b['forearm' + s];
    if (!u || !f) continue;
    const pu = g.root.worldToLocal(u.getWorldPosition(new THREE.Vector3()));
    const pf = g.root.worldToLocal(f.getWorldPosition(new THREE.Vector3()));
    const rest = pf.sub(pu).normalize();
    if (g.model && g.model.ai) { out[s] = new THREE.Vector3(rest.x + (s === 'l' ? 0.13 : -0.13), rest.y, rest.z + 0.03).normalize(); continue; } // AI shapes hang naturally: just ease the sleeves off the body
    const sx = Math.sign(rest.x) || (s === 'l' ? 1 : -1);
    out[s] = new THREE.Vector3(0.24 * sx, -1, rest.z * 0.3 + 0.02).normalize();
  }
  return out;
}
let railAcc = 0, prevVel = 0;
const _e = new THREE.Euler(), _q3 = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1);
function stepPhysics(s, dt, t) {
  const p = s.ph;
  // pivot accelerations: rail motion (x) and lifting toward the camera (z)
  const ax = THREE.MathUtils.clamp(-railAcc, -9, 9) * 0.12;
  const held = mode === 'product' && slots[selected] === s;
  const damp = held ? 4.5 : 2.8;
  const z = s.pivot.position.z; const vz = (z - p.pz) / Math.max(dt, 1e-3); const az = (vz - p.pvz) / Math.max(dt, 1e-3);
  p.pz = z; p.pvz = vz;
  const breeze = Math.sin(t * 0.7 + s.item.index * 1.9) * 0.012;
  const n = 3, h = dt / n;
  let accZ = 0, accX = 0;
  for (let k = 0; k < n; k++) {
    accZ = -(G / PL) * Math.sin(p.tz) - damp * p.wz - (ax / PL) * Math.cos(p.tz) + breeze * 0.4;
    accX = -(G / PL) * Math.sin(p.tx) - (damp + 0.3) * p.wx + (THREE.MathUtils.clamp(az, -6, 6) * 0.5 / PL) * Math.cos(p.tx);
    p.wz += accZ * h; p.tz += p.wz * h;
    p.wx += accX * h; p.tx += p.wx * h;
    // sleeves: damped springs pushed by the body's angular acceleration (they lag behind)
    const sAz = -110 * p.sz - 8 * p.vz - 0.35 * accZ;
    const sAx = -110 * p.sx - 8 * p.vx - 0.3 * accX;
    // hem: the lower body lags a touch behind the swing
    const hA = -140 * p.hz - 9 * p.hv - 0.25 * accZ;
    p.hv += hA * h; p.hz += p.hv * h;
    p.vz += sAz * h; p.sz += p.vz * h;
    p.vx += sAx * h; p.sx += p.vx * h;
  }
  p.tz = THREE.MathUtils.clamp(p.tz, -0.5, 0.5); p.tx = THREE.MathUtils.clamp(p.tx, -0.4, 0.4);
  p.sz = THREE.MathUtils.clamp(p.sz, -0.35, 0.35); p.sx = THREE.MathUtils.clamp(p.sx, -0.35, 0.35);
  s.pivot.rotation.order = 'YXZ';
  s.pivot.rotation.z = p.tz; s.pivot.rotation.x = p.tx;
  p.hz = THREE.MathUtils.clamp(p.hz, -0.12, 0.12);
  if (Math.abs(p.hz) > 1e-4 || s.hemDirty) { s.hemDirty = Math.abs(p.hz) > 1e-4; s.g.rig.bend('spine', _zAxis, p.hz * 0.6); s.g.rig.bend('hips', _zAxis, p.hz); }
  // apply sleeve lag
  const amt = Math.abs(p.sz) + Math.abs(p.sx);
  if (amt > 2e-4 || s.armsDirty) {
    s.armsDirty = amt > 2e-4;
    _e.set(p.sx, 0, p.sz); _q3.setFromEuler(_e);
    const rq = s.g.root.getWorldQuaternion(new THREE.Quaternion());
    for (const side of ['l', 'r']) {
      if (!s.dU[side]) continue;
      const d = s.dU[side].clone().applyQuaternion(_q3).applyQuaternion(rq);
      s.g.rig.aim('upperarm' + side, d, 'forearm' + side);
    }
  }
}

function updateRope(s, t) {
  s.pivot.updateMatrixWorld(true);
  const A = _a.set(s.x, RAIL_Y, 0);
  const P = s.g.root.localToWorld(_b.copy(s.at)); rail.worldToLocal(P);
  const full = A.distanceTo(P);
  if (s.rope === 'intact') {
    placeRope(s.ropeA, A, _d.copy(P).sub(A).normalize(), full);
    s.ropeB.visible = s.tipA.visible = s.tipB.visible = false;
    return;
  }
  if (s.rope === 'tying') {
    const k = THREE.MathUtils.smootherstep(s.tc, 0, 0.7);
    const len = THREE.MathUtils.lerp(0.05, full, k);
    placeRope(s.ropeA, A, _d.copy(P).sub(A).normalize(), len);
    s.tipA.visible = k < 0.98; s.tipA.position.copy(A).addScaledVector(_d, len);
    s.ropeB.visible = s.tipB.visible = false;
    if (s.tc > 0.75) s.rope = 'intact';
    return;
  }
  // cut: upper end recoils and sways, lower stub stays on the collar
  const tc = s.tc;
  const la = 0.055 + (ROPE * 0.55 - 0.055) * Math.exp(-tc * 9) * Math.max(0, Math.cos(tc * 7));
  const sway = 0.55 * Math.exp(-tc * 2.6) * Math.sin(tc * 12) + Math.sin(t * 1.3) * 0.02;
  _d.set(Math.sin(sway), -Math.cos(sway), Math.sin(sway * 0.6) * 0.4).normalize();
  placeRope(s.ropeA, A, _d, la);
  s.tipA.visible = true; s.tipA.position.copy(A).addScaledVector(_d, la); s.tipA.quaternion.copy(s.ropeA.quaternion);
  // the cut piece leaves with the rope, nothing stays on the garment
  s.ropeB.visible = s.tipB.visible = false;
}

// ---------- loop ----------
const clock = new THREE.Clock();
let running = true;
function tick() {
  if (!running) return;
  requestAnimationFrame(tick);
  if (paused) { clock.getDelta(); return; }
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
  railAcc = THREE.MathUtils.clamp((vel - prevVel) / Math.max(dt, 1e-3), -40, 40); prevVel = vel;
  rail.position.x = -offset;
  const ci = Math.round(THREE.MathUtils.clamp(offset, minOff, maxOff) / SPACING);
  $('#cIdx').textContent = String(ci + 1).padStart(2, '0');
  updatePhoneBar(ci);
  document.body.classList.toggle('scrolled', offset > SPACING * 0.45);

  // hover
  if (mode === 'home' && !drag && !PHONE) {
    const h = pick();
    if (h !== hovered) { hovered = h; canvas.classList.toggle('pointer', h >= 0); }
  } else if (hovered !== -1) { hovered = -1; canvas.classList.remove('pointer'); }

  // garments: pendulum swing from rail velocity, hover turn, product lift
  sizeRail(Math.max(1, vis.length - 1) * SPACING + 1.4);
  slots.forEach((s, i) => {
    if (!s.shown) return;
    // slide to its place on the (filtered) rail
    s.x += (s.k * SPACING - s.x) * Math.min(1, dt * 6);
    s.pivot.position.x = s.x; s.knot.position.x = s.x;
    stepPhysics(s, dt, t);
    const isSel = mode === 'product' && selected === i;
    const isHover = hovered === i || (PHONE && mode === 'home' && s.k === ci);
    const phoneCur = PHONE && mode === 'home' && s.k === ci;
    const turnT = isSel || phoneCur ? 0 : isHover ? s.baseTurn + 0.38 : s.baseTurn + Math.sin(t * 0.4 + i) * 0.03;
    s.turn += (turnT - s.turn) * Math.min(1, dt * 3);
    s.tc += dt;
    const liftT = isSel ? (s.tc > 0.38 ? 1 : 0) : phoneCur ? 0.3 : isHover ? 0.18 : 0;
    s.lift += (liftT - s.lift) * Math.min(1, dt * 3);
    // garment drops a little when the rope snaps, then is caught
    s.drop = s.rope === 'cut' ? -0.1 * (1 - Math.exp(-s.tc * 11)) * Math.exp(-Math.max(0, s.tc - 0.35) * 3.5) : s.drop * Math.exp(-dt * 6);
    if (!isSel && s.rope === 'cut' && s.lift < 0.1) { s.rope = 'tying'; s.tc = 0; }
    s.pivot.rotation.y = s.turn;
    s.pivot.position.z = s.lift * 0.85;
    s.pivot.position.y = RAIL_Y + s.lift * 0.04 + s.drop;
    // the chosen size scales the piece you are looking at (M is the reference)
    const sc = isSel ? (SIZE_SCALE[size] || 1) : 1;
    s.spin.scale.setScalar(THREE.MathUtils.lerp(s.spin.scale.x, sc, Math.min(1, dt * 6)));
    s.spin.position.y = 1.15 * (1 - s.spin.scale.x);
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
    updateRope(s, t);
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
  window.__ml = { scene, camera, slots, openProduct, closeProduct, shop, thumbs, spin: (a) => { productSpin = a; spinVel = 0; spinIdle = -99; } };
  setTimeout(() => renderThumbs().catch((e) => console.warn('thumbs', e)), 900);
})();
