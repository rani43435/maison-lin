import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SIZES, SIZE_SCALE } from './catalog.js?v=1794102939';
import { makeGarment, HIPS_Y } from './garment.js?v=1794102939';

const $ = (s) => document.querySelector(s);
const MP = './lib/mediapipe/';
// landmark ids
const NOSE = 0, LEYE = 2, REYE = 5, LEAR = 7, REAR = 8, LS = 11, RS = 12, LE = 13, RE = 14, LW = 15, RW = 16, LH = 23, RH = 24;
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

export class TryOn {
  constructor({ items, onAdd, getSize, setSize }) {
    this.items = items; this.onAdd = onAdd; this.getSize = getSize || (() => 'M'); this.setSize = setSize || (() => {});
    this.isOpen = false;
    this.video = $('#toVideo'); this.canvas = $('#toCanvas'); this.frame = $('#toFrame');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    this.key = new THREE.DirectionalLight('#fff3e6', 2.0); this.key.position.set(0.5, 1.5, 3); this.scene.add(this.key);
    this.hemi = new THREE.HemisphereLight('#fff8f0', '#8a7360', 0.6); this.scene.add(this.hemi);
    // depth-only stand-ins for the real body: neck, head, arms and hands hide the fabric behind them
    const occ = new THREE.MeshBasicMaterial({ colorWrite: false });
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), sph = new THREE.SphereGeometry(1, 16, 12);
    this.caps = {};
    for (const n of ['neck', 'head', 'jaw', 'uaL', 'uaR', 'faL', 'faR', 'hL', 'hR']) {
      const g = new THREE.Group();
      const c = new THREE.Mesh(cyl, occ), a = new THREE.Mesh(sph, occ), b = new THREE.Mesh(sph, occ);
      [c, a, b].forEach((m) => { m.renderOrder = -2; g.add(m); });
      g.userData = { c, a, b }; g.visible = false; this.scene.add(g); this.caps[n] = g;
    }
    this.filters = new Map();
    this.lightCanvas = document.createElement('canvas'); this.lightCanvas.width = 24; this.lightCanvas.height = 14;
    this.lastLight = 0;
    this.pmrem = pm;
    // segmentation: hair, face and hands are copied from the camera on top of the garment (true occlusion)
    this.front = $('#toFront'); this.fctx = this.front.getContext('2d');
    this.maskCanvas = document.createElement('canvas'); this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    this.envCanvas = document.createElement('canvas'); this.envCanvas.width = 96; this.envCanvas.height = 48;
    this.lastEnv = 0; this.segFrame = 0; this.fitX = 1;
    this.camera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, -20, 20);
    this.holder = new THREE.Group(); this.scene.add(this.holder);
    this.garment = null; this.current = null;
    this.smooth = null; this.back = false; this.backVotes = 0;
    this.buildPicks();
    $('#tryon').addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'closeTryOn') this.close();
      if (a && a.dataset.act === 'flipCam') this.flip();
      if (a && a.dataset.act === 'snap') this.snapReq = true;
      if (a && a.dataset.act === 'addBagTry' && this.current) this.onAdd(this.current, this.getSize());
      const sb = e.target.closest('[data-tsize]'); if (sb) { this.setSize(sb.dataset.tsize); this.renderSizes(); }
    });
    addEventListener('resize', () => this.isOpen && this.fit());
  }

  renderSizes() {
    const cur = this.getSize();
    $('#toSizes').innerHTML = SIZES.map((s) => `<button data-tsize="${s}" class="${s === cur ? 'on' : ''}">${s}</button>`).join('');
  }

  buildPicks() {
    const el = $('#toPicks');
    el.innerHTML = this.items.map((it, i) => `<button data-i="${i}" title="${it.name} — ${it.color}" style="background:${it.hex}"></button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.setItem(this.items[+b.dataset.i]);
    });
  }

  async setItem(item) {
    this.current = item;
    $('#toName').textContent = `${item.name} — ${item.color}`;
    $('#toPrice').textContent = `€${item.price}`;
    [...$('#toPicks').children].forEach((b) => b.classList.toggle('on', this.items[+b.dataset.i] === item));
    const g = await makeGarment(item, { occlude: true });
    if (this.current !== item) return;
    if (this.garment) this.holder.remove(this.garment.root);
    this.garment = g;
    g.root.visible = false;
    this.holder.add(g.root);
  }

  status(t) { const s = $('#toStatus'); if (t) { s.textContent = t; s.classList.remove('hide'); } else s.classList.add('hide'); }

  async open(item) {
    this.isOpen = true;
    $('#tryon').classList.add('open');
    this.status('Preparing the fitting room…');
    this.setItem(item);
    this.renderSizes();
    if (!(await this.startCam())) return;
    if (!this.pose) {
      this.status('Loading the tailor…');
      const { PoseLandmarker, FilesetResolver } = await import('../lib/mediapipe/vision_bundle.mjs');
      const fs = await FilesetResolver.forVisionTasks(new URL(MP + 'wasm', location.href).href);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: new URL(MP + 'pose_landmarker_full.task', location.href).href, delegate },
        runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      try { this.pose = await PoseLandmarker.createFromOptions(fs, opts('GPU')); }
      catch { this.pose = await PoseLandmarker.createFromOptions(fs, opts('CPU')); }
      // multiclass segmentation (background, hair, body skin, face skin, clothes, other) — optional
      try {
        const { ImageSegmenter } = await import('../lib/mediapipe/vision_bundle.mjs');
        const so = (delegate) => ({ baseOptions: { modelAssetPath: new URL(MP + 'selfie_multiclass_256x256.tflite', location.href).href, delegate },
          runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false });
        try { this.seg = await ImageSegmenter.createFromOptions(fs, so('GPU')); } catch { this.seg = await ImageSegmenter.createFromOptions(fs, so('CPU')); }
      } catch (e) { console.warn('segmentation unavailable', e); this.seg = null; }
      console.info('fitting room: segmentation', this.seg ? 'on' : 'off');
    }
    this.status('Step back until your shoulders and hips are in view');
    this.lastTs = -1;
    this.loop();
  }

  async startCam() {
    this.facing = this.facing || 'user';
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; this.video.srcObject = null; }
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const tries = [];
    if (this.deviceId) tries.push({ ...base, deviceId: { exact: this.deviceId } });
    tries.push({ ...base, facingMode: { exact: this.facing } }, { ...base, facingMode: this.facing }, true);
    for (const video of tries) {
      try { this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false }); break; } catch (e) { this.camErr = e; }
    }
    if (!this.stream) { this.status('Camera access is needed for the fitting room. Please allow the camera and try again.'); return false; }
    const track = this.stream.getVideoTracks()[0];
    const st = track.getSettings ? track.getSettings() : {};
    const label = (track.label || '').toLowerCase();
    const rear = st.facingMode ? st.facingMode === 'environment' : /back|rear|environment|rück|arrière|trasera/.test(label) || this.facing === 'environment';
    this.frame.classList.toggle('rear', rear);
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', ''); this.video.muted = true;
    await this.video.play().catch(() => {});
    if (!this.video.videoWidth) await new Promise((r) => this.video.addEventListener('loadedmetadata', r, { once: true }));
    this.fit(); this.smooth = null; this.lastVT = -1;
    // only show the switch button when there is more than one camera
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      this.cams = cams;
      document.querySelector('.cam-flip').style.display = cams.length > 1 ? '' : 'none';
    } catch {}
    return true;
  }

  async flip() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    // prefer a camera whose label matches the wanted side
    this.deviceId = null;
    const want = this.facing === 'environment' ? /back|rear|environment|rück|arrière|trasera/ : /front|user|face|vorder|avant|frontal/;
    const hit = (this.cams || []).find((c) => want.test((c.label || '').toLowerCase()));
    if (hit) this.deviceId = hit.deviceId;
    this.status('Switching camera…');
    await this.startCam();
  }


  close() {
    this.isOpen = false;
    $('#tryon').classList.remove('open');
    cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null; this.smooth = null; this.segOK = false; this.fitX = 1;
    this.fctx.clearRect(0, 0, this.front.width, this.front.height);
    document.dispatchEvent(new Event('tryon-closed'));
  }

  fit() {
    const vw = this.video.videoWidth || 1280, vh = this.video.videoHeight || 720;
    const a = vw / vh;
    const W = innerWidth, H = innerHeight;
    let w = W, h = W / a;
    if (h < H) { h = H; w = H * a; }
    this.frame.style.width = `${w}px`; this.frame.style.height = `${h}px`;
    this.renderer.setSize(w, h, false);
    this.front.width = Math.min(960, vw); this.front.height = Math.round(this.front.width / a);
    this.aspect = a;
    Object.assign(this.camera, { left: -a / 2, right: a / 2, top: 0.5, bottom: -0.5 });
    this.camera.updateProjectionMatrix();
  }

  loop() {
    if (!this.isOpen) return;
    this.raf = requestAnimationFrame(() => this.loop());
    const v = this.video;
    if (v.readyState < 2 || !this.pose) return;
    const ts = performance.now();
    if (v.currentTime !== this.lastVT) {
      this.lastVT = v.currentTime;
      let res;
      try { res = this.pose.detectForVideo(v, ts); } catch { return; }
      this.lm = res.landmarks && res.landmarks[0];
      if (this.seg && (this.segFrame++ % 2 === 0)) {
        try { this.seg.segmentForVideo(v, ts + 0.1, (r) => this.onSeg(r)); } catch (e) { console.warn(e); this.seg = null; }
      }
      this.apply(res);
      this.roomEnv();
    }
    this.renderer.render(this.scene, this.camera);
    this.drawFront();
    if (this.snapReq) { this.snapReq = false; this.snap(); }
  }

  // segmentation result: build an alpha mask of what must stay in front of the garment
  onSeg(r) {
    const m = r.categoryMask; if (!m) return;
    const W = m.width, H = m.height, cls = m.getAsUint8Array();
    if (this.maskCanvas.width !== W) { this.maskCanvas.width = W; this.maskCanvas.height = H; this.maskImg = this.maskCtx.createImageData(W, H); this.cls = new Uint8Array(W * H); }
    this.cls.set(cls);
    const d = this.maskImg.data, lm = this.lm;
    // hands: body skin near the hand landmarks
    const hands = [];
    if (lm) for (const [w, a, b, c] of [[15, 17, 19, 21], [16, 18, 20, 22]]) {
      if (lm[w].visibility < 0.3) continue;
      const cx = (lm[w].x + lm[a].x + lm[b].x + lm[c].x) / 4, cy = (lm[w].y + lm[a].y + lm[b].y + lm[c].y) / 4;
      const rr = Math.max(0.035, Math.hypot(lm[b].x - lm[w].x, (lm[b].y - lm[w].y) / this.aspect) * 1.5);
      hands.push([cx * W, cy * H, rr * W]);
    }
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const c = cls[i];
      let on = c === 1 || c === 3; // hair, face
      if (!on && c === 2) for (const [hx, hy, hr] of hands) { const dx = x - hx, dy = (y - hy) / this.aspect; if (dx * dx + dy * dy < hr * hr) { on = true; break; } }
      d[i * 4 + 3] = on ? 255 : 0;
    }
    this.maskCtx.putImageData(this.maskImg, 0, 0);
    this.segOK = true; this.segT = performance.now();
  }

  // camera pixels of hair, face and hands drawn over the garment
  drawFront() {
    const c = this.fctx, W = this.front.width, H = this.front.height;
    c.globalCompositeOperation = 'source-over'; c.filter = 'none';
    c.clearRect(0, 0, W, H);
    if (!this.segOK || !this.garment || !this.garment.root.visible || performance.now() - this.segT > 600) return;
    c.drawImage(this.video, 0, 0, W, H);
    c.globalCompositeOperation = 'destination-in';
    c.filter = 'blur(1.5px)';
    c.drawImage(this.maskCanvas, 0, 0, W, H);
    c.filter = 'none'; c.globalCompositeOperation = 'source-over';
  }

  // body width from the segmentation: the garment is widened so the clothes underneath never peek out
  bodyHalfWidth(yN, cxN, capN) {
    if (!this.segOK || !this.cls) return 0;
    const W = this.maskCanvas.width, H = this.maskCanvas.height, row = Math.round(yN * H);
    if (row < 0 || row >= H) return 0;
    const isBody = (x) => { const c = this.cls[row * W + x]; return c === 2 || c === 4 || c === 5; };
    const cx = Math.round(cxN * W); if (cx < 0 || cx >= W || !isBody(cx)) return 0;
    const side = (dir) => { let x = cx, gap = 0; while (x > 0 && x < W - 1 && gap < 3 && Math.abs(x - cx) < capN * W) { x += dir; gap = isBody(x) ? 0 : gap + 1; } return Math.abs(x - cx) - gap; };
    return Math.min(side(-1), side(1)) / W; // the narrower side: arms resting on the body do not count
  }

  // the room itself as the environment: fabric picks up the colours around you
  roomEnv() {
    const now = performance.now(); if (now - this.lastEnv < 1200) return; this.lastEnv = now;
    const c = this.envCanvas, x = c.getContext('2d');
    try { x.filter = 'blur(6px)'; x.drawImage(this.video, 0, 0, c.width, c.height); x.filter = 'none'; } catch { return; }
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
    const rt = this.pmrem.fromEquirectangular(t);
    t.dispose();
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt; this.scene.environment = rt.texture;
  }

  // photo of the look: camera + garment + hair/face/hands layer, shared or downloaded
  async snap() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight; if (!vw) return;
    const c = document.createElement('canvas'); c.width = vw; c.height = vh;
    const x = c.getContext('2d');
    const mirror = !this.frame.classList.contains('rear');
    if (mirror) { x.translate(vw, 0); x.scale(-1, 1); }
    x.drawImage(this.video, 0, 0, vw, vh);
    x.save(); x.filter = 'drop-shadow(0 7px 12px rgba(20,12,8,.32))'; x.drawImage(this.canvas, 0, 0, vw, vh); x.restore();
    x.drawImage(this.front, 0, 0, vw, vh);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = 'rgba(245,239,230,.92)'; x.font = `italic ${Math.round(vh * 0.04)}px 'Cormorant Garamond', Georgia, serif`;
    x.fillText(`Maison Lin — ${this.current ? this.current.name : ''}`, vh * 0.04, vh - vh * 0.045);
    const fl = $('#toFlash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    const file = new File([blob], 'maison-lin-look.jpg', { type: 'image/jpeg' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My Maison Lin look' }); return; } } catch {}
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'maison-lin-look.jpg'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // One-Euro filter: steady when still, responsive when moving
  euro(key, x, ts, minCut = 1.2, beta = 0.02) {
    let f = this.filters.get(key);
    if (!f) { f = { x, dx: 0, t: ts }; this.filters.set(key, f); return x; }
    const dt = Math.max(1e-3, ts - f.t); f.t = ts;
    const al = (c) => { const r = 2 * Math.PI * c * dt; return r / (r + 1); };
    const dx = (x - f.x) / dt; f.dx += al(1.0) * (dx - f.dx);
    const cut = minCut + beta * Math.abs(f.dx) * 60;
    f.x += al(cut) * (x - f.x);
    return f.x;
  }

  capsule(name, A, B, r) {
    const g = this.caps[name]; const { c, a, b } = g.userData;
    const d = B.clone().sub(A); const L = d.length();
    if (!(L > 1e-5) || !(r > 0)) { g.visible = false; return; }
    g.visible = true;
    c.position.copy(A).add(B).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    c.scale.set(r, L, r);
    a.position.copy(A); a.scale.setScalar(r); b.position.copy(B); b.scale.setScalar(r);
  }

  // match the garment's light to the room: brightness, colour and side of the key light
  estimateLight(lm) {
    const now = performance.now(); if (now - this.lastLight < 250 || this.video.readyState < 2) return; this.lastLight = now;
    const c = this.lightCanvas, x = c.getContext('2d', { willReadFrequently: true });
    try { x.drawImage(this.video, 0, 0, c.width, c.height); } catch { return; }
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, L = 0, R = 0, nl = 0, nr = 0;
    const lin = (v) => Math.pow(v / 255, 2.2);
    const cx = ((lm[LS].x + lm[RS].x) / 2) * c.width;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const lr = lin(d[i]), lg = lin(d[i + 1]), lb = lin(d[i + 2]);
      r += lr; g += lg; b += lb;
      const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      if ((p % c.width) < cx) { L += lum; nl++; } else { R += lum; nr++; }
    }
    const n = d.length / 4; r /= n; g /= n; b /= n;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const m = Math.max(r, g, b, 1e-4);
    const tint = new THREE.Color(r / m, g / m, b / m).lerp(new THREE.Color(1, 1, 1), 0.45);
    const exposure = THREE.MathUtils.clamp(0.35 + lum * 3.2, 0.35, 1.6);
    const side = THREE.MathUtils.clamp(((R / Math.max(nr, 1)) - (L / Math.max(nl, 1))) / Math.max(lum, 0.02), -1, 1);
    const k = this.lightK || (this.lightK = { e: exposure, s: side, t: tint.clone() });
    k.e += (exposure - k.e) * 0.3; k.s += (side - k.s) * 0.3; k.t.lerp(tint, 0.3);
    this.key.intensity = 1.6 * k.e; this.key.color.copy(k.t);
    this.key.position.set(k.s * 2.2, 1.6, 2.6);
    this.hemi.intensity = 0.55 * k.e; this.hemi.color.copy(k.t);
    this.scene.environmentIntensity = 0.55 * k.e;
  }

  apply(res) {
    const g = this.garment;
    if (!g) return;
    const lm = res.landmarks && res.landmarks[0];
    const wl = res.worldLandmarks && res.worldLandmarks[0];
    const ok = lm && wl && lm[LS].visibility > 0.5 && lm[RS].visibility > 0.5 && (lm[LH].visibility > 0.3 || lm[RH].visibility > 0.3);
    if (!ok) {
      this.miss = (this.miss || 0) + 1;
      if (this.miss > 8) { g.root.visible = false; Object.values(this.caps).forEach((c) => (c.visible = false)); this.status('Step back until your shoulders and hips are in view'); this.smooth = null; }
      return;
    }
    this.miss = 0;
    this.status(null);
    const ts = performance.now() / 1000;
    const IDS = [NOSE, LEYE, REYE, LEAR, REAR, 9, 10, LS, RS, LE, RE, LW, RW, 19, 20, LH, RH];
    const flm = [], fwl = [];
    for (const i of IDS) {
      flm[i] = { x: this.euro('ix' + i, lm[i].x, ts), y: this.euro('iy' + i, lm[i].y, ts), visibility: lm[i].visibility };
      fwl[i] = { x: this.euro('wx' + i, wl[i].x, ts), y: this.euro('wy' + i, wl[i].y, ts), z: this.euro('wz' + i, wl[i].z, ts, 0.8, 0.01) };
    }
    this.estimateLight(lm);

    // back view: face landmarks disappear
    const face = (lm[NOSE].visibility + lm[LEYE].visibility + lm[REYE].visibility) / 3;
    const backNow = face < 0.35;
    this.backVotes = THREE.MathUtils.clamp(this.backVotes + (backNow ? 1 : -1), -6, 6);
    if (this.backVotes >= 4) this.back = true; else if (this.backVotes <= -4) this.back = false;
    $('#toBadge').classList.toggle('on', this.back);

    // image -> ortho coords, world -> three coords (unmirrored view, y up, z toward camera)
    const P = (i) => new THREE.Vector3((flm[i].x - 0.5) * this.aspect, 0.5 - flm[i].y, 0);
    const Wv = (i) => new THREE.Vector3(fwl[i].x, -fwl[i].y, -fwl[i].z);
    let img = {}, w = {};
    for (const i of IDS) { img[i] = P(i); w[i] = Wv(i); }

    // torso frame
    const frame = () => {
      const X = w[LS].clone().sub(w[RS]).normalize();
      const midS = w[LS].clone().add(w[RS]).multiplyScalar(0.5);
      const midH = w[LH].clone().add(w[RH]).multiplyScalar(0.5);
      let Y = midS.clone().sub(midH);
      Y.sub(X.clone().multiplyScalar(Y.dot(X))).normalize();
      const Z = new THREE.Vector3().crossVectors(X, Y);
      return { X, Y, Z, midS, midH };
    };
    let f = frame();
    // the model may keep "front" labels when the person turns around; fix handedness
    if (this.back && f.Z.z > 0) {
      for (const [a, b] of [[LS, RS], [LE, RE], [LW, RW], [LH, RH], [19, 20], [LEAR, REAR]]) {
        [img[a], img[b]] = [img[b], img[a]]; [w[a], w[b]] = [w[b], w[a]];
      }
      f = frame();
    } else if (!this.back && f.Z.z < -0.2) {
      // mirrored labels while facing: swap too
      for (const [a, b] of [[LS, RS], [LE, RE], [LW, RW], [LH, RH], [19, 20], [LEAR, REAR]]) {
        [img[a], img[b]] = [img[b], img[a]]; [w[a], w[b]] = [w[b], w[a]];
      }
      f = frame();
    }
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.X, f.Y, f.Z));

    // scale: image units per metre, from torso + shoulder segments
    const seg2 = (a, b) => { const d = a.clone().sub(b); return Math.hypot(d.x, d.y); };
    const iS = img[LS].clone().add(img[RS]).multiplyScalar(0.5), iH = img[LH].clone().add(img[RH]).multiplyScalar(0.5);
    const num = seg2(img[LS], img[RS]) + seg2(iS, iH);
    const den = seg2(w[LS], w[RS]) + seg2(f.midS, f.midH);
    const ppm = num / Math.max(den, 1e-3);
    const shoulderW = w[LS].distanceTo(w[RS]);
    const torsoL = f.midS.distanceTo(f.midH);
    const M = g.model;
    const k = ppm * (0.8 * shoulderW / M.shoulderW + 0.2 * torsoL / (M.shoulderY - HIPS_Y + 0.06)) * (SIZE_SCALE[this.getSize()] || 1);

    // smoothing
    const s = this.smooth || (this.smooth = { q: q.clone(), k, pos: iS.clone(), arms: null });
    s.q.slerp(q, 0.7); s.k += (k - s.k) * 0.5; s.pos.lerp(iS, 0.85);

    // widen to the real body (segmentation), never narrower than the garment's own cut
    const gHalf = torsoHalf(g);
    if (this.segOK && gHalf) {
      const yS = (flm[LS].y + flm[RS].y) / 2, yH = (flm[LH].y + flm[RH].y) / 2, cxN = (flm[LS].x + flm[RS].x + flm[LH].x + flm[RH].x) / 4;
      const cap = Math.abs(flm[LS].x - flm[RS].x) * 0.95;
      const hw = Math.max(this.bodyHalfWidth(yS + (yH - yS) * 0.35, cxN, cap), this.bodyHalfWidth(yS + (yH - yS) * 0.8, cxN, cap)) * this.aspect;
      const want = hw > 0 ? THREE.MathUtils.clamp((hw * 1.06) / (gHalf * s.k), 1, 1.28) : 1;
      this.fitX += (want - this.fitX) * 0.15;
    } else this.fitX += (1 - this.fitX) * 0.1;
    const root = g.root;
    root.visible = true;
    root.quaternion.copy(s.q);
    root.scale.set(s.k * this.fitX, s.k, s.k * (1 + (this.fitX - 1) * 0.5));
    const anchor = new THREE.Vector3(0, g.model.shoulderY + 0.035, 0).multiplyScalar(s.k).applyQuaternion(s.q);
    root.position.copy(s.pos).sub(anchor);
    root.position.z = -anchor.z;
    root.updateWorldMatrix(true, true);

    // shared space: image x/y plus depth from the 3D landmarks (shoulder centre at z = 0)
    const vis = (i) => lm[i].visibility > 0.4;
    const zRef = (w[LS].z + w[RS].z) / 2;
    const B3 = (i) => new THREE.Vector3(img[i].x, img[i].y, (w[i].z - zRef) * ppm);
    const m = ppm; // metres -> image units
    const down = f.Y.clone().negate();

    // sleeves: pivot sits on the real shoulder, each segment points along the real arm in the image,
    // and is stretched so the elbow and the cuff land on the elbow and the wrist
    {
      const M = g.model, rig = g.rig;
      if (!s.armv) s.armv = {};
      for (const [sd, S, E, Wr, sx] of [['l', LS, LE, LW, 1], ['r', RS, RE, RW, -1]]) {
        const ub = rig.b['upperarm' + sd], fb = rig.b['forearm' + sd];
        if (!ub || !fb) continue;
        const S3 = B3(S);
        const outward = f.X.clone().multiplyScalar(sx * 0.012 * m);
        ub.position.copy(rig.restPos['upperarm' + sd]);
        ub.parent.updateWorldMatrix(true, false);
        const tgtLocal = ub.parent.worldToLocal(S3.clone().add(outward));
        ub.position.lerp(tgtLocal, 0.85);
        const hang = down.clone().add(f.X.clone().multiplyScalar(0.3 * sx)).normalize();
        let u = vis(E) ? B3(E).sub(S3) : hang.clone().multiplyScalar(M.upper * s.k);
        let fo = vis(E) && vis(Wr) ? B3(Wr).sub(B3(E)) : u.clone().normalize().multiplyScalar(M.fore * s.k);
        const Lu = u.length(), Lf = fo.length();
        // loose fabric sags a little instead of tracking the arm exactly
        u.normalize().addScaledVector(down, 0.06).normalize();
        fo.normalize().addScaledVector(down, 0.1).normalize();
        const st = s.armv[sd] || (s.armv[sd] = { u: u.clone(), f: fo.clone(), su: 1, sf: 1 });
        st.u.lerp(u, 0.55).normalize(); st.f.lerp(fo, 0.55).normalize();
        const su = THREE.MathUtils.clamp(Lu / Math.max(1e-4, M.upper * s.k), 0.75, 1.35);
        const sf = M.short ? 1 : THREE.MathUtils.clamp(Lf / Math.max(1e-4, M.fore * s.k), 0.75, 1.35);
        st.su += (su - st.su) * 0.3; st.sf += (sf - st.sf) * 0.3;
        ub.scale.setScalar(st.su); fb.scale.setScalar(st.sf / st.su);
        rig.aim('upperarm' + sd, st.u, 'forearm' + sd);
        rig.aim('forearm' + sd, st.f, null);
      }
    }

    // drape: the hem lags behind body motion and settles, so the fabric never looks rigid
    const now = ts; const dtp = Math.min(0.1, Math.max(0.008, now - (s.lastT || now - 0.033))); s.lastT = now;
    const vx = (s.pos.x - (s.px ?? s.pos.x)) / dtp / Math.max(s.k, 1e-3); s.px = s.pos.x;
    const ax = (vx - (s.pvx ?? vx)) / dtp; s.pvx = vx;
    const h = s.hem || (s.hem = { z: 0, v: 0, x: 0, xv: 0 });
    const sub = 4, hh = dtp / sub;
    for (let i = 0; i < sub; i++) {
      const az = -120 * h.z - 9 * h.v + THREE.MathUtils.clamp(ax, -40, 40) * 0.012 + Math.sin(now * 1.7) * 0.02;
      h.v += az * hh; h.z += h.v * hh;
    }
    h.z = THREE.MathUtils.clamp(h.z, -0.14, 0.14);
    const zAxis = new THREE.Vector3(0, 0, 1), xAxis = new THREE.Vector3(1, 0, 0);
    g.rig.bend('spine', zAxis, h.z * 0.5);
    g.rig.bend('hips', zAxis, h.z);

    // body occluders
    const sMid = B3(LS).add(B3(RS)).multiplyScalar(0.5);
    const ears = vis(LEAR) || vis(REAR) ? B3(vis(LEAR) ? LEAR : REAR).add(B3(vis(REAR) ? REAR : LEAR)).multiplyScalar(0.5) : sMid.clone().add(new THREE.Vector3(0, 0.2 * m, 0));
    // neck sits behind the front collar: thinner and pushed back so the collar wraps around it cleanly
    const neckBase = sMid.clone().lerp(ears, 0.22); neckBase.z -= 0.045 * m;
    const neckTop = ears.clone(); neckTop.z -= 0.02 * m;
    this.capsule('neck', neckBase, neckTop, 0.05 * m);
    // chin and beard come in front of the collar
    if (!this.segOK && vis(NOSE) && vis(9) && vis(10)) {
      const nose = B3(NOSE), mouth = B3(9).add(B3(10)).multiplyScalar(0.5);
      const chin = mouth.clone().addScaledVector(mouth.clone().sub(nose), 1.15);
      nose.z -= 0.03 * m; chin.z -= 0.015 * m;
      this.capsule('jaw', nose, chin, 0.05 * m);
    } else this.caps.jaw.visible = false;
    const hc = ears.clone().add(new THREE.Vector3(0, 0.035 * m, -0.03 * m));
    this.capsule('head', hc, hc.clone().add(new THREE.Vector3(0, 0.07 * m, 0)), 0.085 * m);
    // arms only occlude when they are in front of the body (crossed arms, hand on the chest)
    const front = (i) => (w[i].z - zRef) > 0.07;
    const sideCap = (sd, S, E, Wr, H) => {
      this.caps['ua' + sd].visible = false;
      if (vis(E) && vis(Wr) && front(Wr)) this.capsule('fa' + sd, B3(E), B3(Wr), 0.034 * m); else this.caps['fa' + sd].visible = false;
      // hands always come out of the cuff, so they are drawn over the sleeve end
      if (!this.segOK && vis(Wr) && vis(H)) { const a = B3(Wr), b = B3(H); a.z += 0.05 * m; b.z += 0.05 * m; this.capsule('h' + sd, a.lerp(b, 0.15), b, 0.045 * m); } else this.caps['h' + sd].visible = false;
    };
    sideCap('L', LS, LE, LW, 19); sideCap('R', RS, RE, RW, 20);
  }
}

// half-width of the garment's torso (metres, rest pose) at chest height, sleeves excluded
const halfCache = {};
function torsoHalf(g) {
  const key = g.item.model;
  if (halfCache[key] !== undefined) return halfCache[key];
  let best = 0;
  const yC = g.model.shoulderY - 0.18;
  for (const m of g.meshes) {
    const P = m.geometry.attributes.position, SI = m.geometry.attributes.skinIndex, SW = m.geometry.attributes.skinWeight;
    const bones = m.skeleton ? m.skeleton.bones : null;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i); if (Math.abs(y - yC) > 0.05) continue;
      let arm = 0;
      if (SI && bones) for (let k = 0; k < 4; k++) { const b = bones[SI.getComponent(i, k)]; if (b && /arm/i.test(b.name)) arm += SW.getComponent(i, k); }
      if (arm > 0.25) continue;
      best = Math.max(best, Math.abs(P.getX(i)));
    }
  }
  return (halfCache[key] = best || g.model.shoulderW);
}
