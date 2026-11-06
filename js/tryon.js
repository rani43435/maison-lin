import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeGarment, HIPS_Y } from './garment.js?v=1793979401';

const $ = (s) => document.querySelector(s);
const MP = './lib/mediapipe/';
// landmark ids
const NOSE = 0, LEYE = 2, REYE = 5, LEAR = 7, REAR = 8, LS = 11, RS = 12, LE = 13, RE = 14, LW = 15, RW = 16, LH = 23, RH = 24;
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

export class TryOn {
  constructor({ items, onAdd }) {
    this.items = items; this.onAdd = onAdd;
    this.isOpen = false;
    this.video = $('#toVideo'); this.canvas = $('#toCanvas'); this.frame = $('#toFrame');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    const k = new THREE.DirectionalLight('#fff3e6', 2.0); k.position.set(0.5, 1.5, 3); this.scene.add(k);
    this.scene.add(new THREE.HemisphereLight('#fff8f0', '#8a7360', 0.6));
    this.camera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, -20, 20);
    this.holder = new THREE.Group(); this.scene.add(this.holder);
    this.garment = null; this.current = null;
    this.smooth = null; this.back = false; this.backVotes = 0;
    this.buildPicks();
    $('#tryon').addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'closeTryOn') this.close();
      if (a && a.dataset.act === 'flipCam') this.flip();
      if (a && a.dataset.act === 'addBagTry' && this.current) this.onAdd(this.current);
    });
    addEventListener('resize', () => this.isOpen && this.fit());
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
      document.querySelector('.flip').style.display = cams.length > 1 ? '' : 'none';
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
    this.stream = null; this.smooth = null;
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
      this.apply(res);
    }
    this.renderer.render(this.scene, this.camera);
  }

  apply(res) {
    const g = this.garment;
    if (!g) return;
    const lm = res.landmarks && res.landmarks[0];
    const wl = res.worldLandmarks && res.worldLandmarks[0];
    const ok = lm && wl && lm[LS].visibility > 0.5 && lm[RS].visibility > 0.5 && (lm[LH].visibility > 0.3 || lm[RH].visibility > 0.3);
    if (!ok) {
      this.miss = (this.miss || 0) + 1;
      if (this.miss > 8) { g.root.visible = false; this.status('Step back until your shoulders and hips are in view'); this.smooth = null; }
      return;
    }
    this.miss = 0;
    this.status(null);

    // back view: face landmarks disappear
    const face = (lm[NOSE].visibility + lm[LEYE].visibility + lm[REYE].visibility) / 3;
    const backNow = face < 0.35;
    this.backVotes = THREE.MathUtils.clamp(this.backVotes + (backNow ? 1 : -1), -6, 6);
    if (this.backVotes >= 4) this.back = true; else if (this.backVotes <= -4) this.back = false;
    $('#toBadge').classList.toggle('on', this.back);

    // image -> ortho coords, world -> three coords (unmirrored view, y up, z toward camera)
    const P = (i) => new THREE.Vector3((lm[i].x - 0.5) * this.aspect, 0.5 - lm[i].y, 0);
    const Wv = (i) => new THREE.Vector3(wl[i].x, -wl[i].y, -wl[i].z);
    let img = {}, w = {};
    for (const i of [LS, RS, LE, RE, LW, RW, LH, RH]) { img[i] = P(i); w[i] = Wv(i); }

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
      for (const [a, b] of [[LS, RS], [LE, RE], [LW, RW], [LH, RH]]) {
        [img[a], img[b]] = [img[b], img[a]]; [w[a], w[b]] = [w[b], w[a]];
      }
      f = frame();
    } else if (!this.back && f.Z.z < -0.2) {
      // mirrored labels while facing: swap too
      for (const [a, b] of [[LS, RS], [LE, RE], [LW, RW], [LH, RH]]) {
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
    const k = ppm * (0.8 * shoulderW / M.shoulderW + 0.2 * torsoL / (M.shoulderY - HIPS_Y + 0.06));

    // smoothing
    const s = this.smooth || (this.smooth = { q: q.clone(), k, pos: iS.clone(), arms: null });
    const a = 0.45;
    s.q.slerp(q, a); s.k += (k - s.k) * a; s.pos.lerp(iS, 0.6);

    const root = g.root;
    root.visible = true;
    root.quaternion.copy(s.q);
    root.scale.setScalar(s.k);
    const anchor = new THREE.Vector3(0, g.model.shoulderY, 0).multiplyScalar(s.k).applyQuaternion(s.q);
    root.position.copy(s.pos).sub(anchor);
    root.position.z = 0;
    root.updateWorldMatrix(true, true);

    // arms (world directions)
    const dir = (a, b) => w[b].clone().sub(w[a]).normalize();
    const arms = [dir(LS, LE), dir(LE, LW), dir(RS, RE), dir(RE, RW)];
    // if elbows/wrists are not visible, let the sleeves hang
    const vis = (i) => lm[i].visibility > 0.4;
    const down = f.Y.clone().negate();
    if (!vis(LE)) arms[0] = down.clone().add(f.X.clone().multiplyScalar(0.3)).normalize();
    if (!vis(LW)) arms[1] = arms[0].clone();
    if (!vis(RE)) arms[2] = down.clone().add(f.X.clone().multiplyScalar(-0.3)).normalize();
    if (!vis(RW)) arms[3] = arms[2].clone();
    if (!s.arms) s.arms = arms.map((v) => v.clone());
    s.arms.forEach((v, i) => v.lerp(arms[i], 0.5).normalize());
    g.rig.armsWorld(s.arms[0], s.arms[1], s.arms[2], s.arms[3]);
  }
}
