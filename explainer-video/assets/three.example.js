/* three.example.js — 「为什么会有四季」 in three.js: 3 shots, 24 s, light pastel theme, matte clay look.
   Setup: `npm i three` in the work dir (the importmap in explainer.html points at node_modules/three), then
   cp three.example.js shots.js. shots.js is an ES module, so the import below just works.

   The pattern, reusable for any 3D subject (an engine, a cell, a building):
     1  EX.backdrop hosts ONE WebGL canvas behind the DOM shots. Transparent clear colour → the pastel page shows.
     2  setScene(t) poses EVERYTHING (objects, materials' opacity, camera) from t alone. Both the backdrop (before
        drawing) and every shot (before projecting labels) call it, because shot render runs BEFORE the backdrop
        in each frame — a shot that reads the camera without calling setScene(t) gets a stale pose.
     3  Labels are DOM, not 3D text: pin(label, worldPoint) projects a Vector3 to screen px each frame and places a
        .tag there (crisp text, house style, and the layout lint can check it). Hide a pin whose point faces away.
     4  The 3D camera is a pure function of t: one pose per shot, blended over the first 1.4 s of the next shot.
        (EX.cam is the DOM world's camera; it is not used here — the shots have no `at`.)
   Facts: axis tilt 23.4°; the Earth is nearest the Sun in early January (≈ 1.47 亿 km) yet that is northern winter.
   Misconception kept apart: distance does change (~3 %), but it is not why seasons happen — the tilt is. */
import * as THREE from 'three';

const DUR = { tilt: 8, orbit: 8.5, light: 7.5 };
const T = {};
{ let acc = 0; for (const k in DUR) { T[k] = acc; acc += DUR[k]; } }

const TILT = 23.4 * Math.PI / 180, ORBIT_R = 10, EARTH_R = 1.5, SUN_R = 2.2;
const smooth = (a, b, x) => { const p = clamp((x - a) / (b - a)); return p * p * (3 - 2 * p); };
/* the Earth's place on its orbit comes from the HUD meter (days after the June solstice), so they always agree.
   The north pole leans towards +x; at day 0 the Earth sits at -x, i.e. the pole leans towards the Sun: June. */
const orbitPos = (day, v = new THREE.Vector3()) => { const a = Math.PI + 2 * Math.PI * day / 365; return v.set(ORBIT_R * Math.cos(a), 0, -ORBIT_R * Math.sin(a)); };
const monthOf = (day) => (5 + Math.floor((day + 20) / 30.44)) % 12 + 1;   // day 0 = 6 月 21 日

/* ---------- the scene, built once at module load (pure layout; nothing here depends on time) ---------- */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1920 / 1080, .1, 200);

/* clay textures from a canvas: no image files, deterministic from rng */
function earthTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d'), r = rng(8);
  g.fillStyle = '#5E9BF0'; g.fillRect(0, 0, 1024, 512);   // ACES tone mapping mutes colour: start a bit stronger
  g.fillStyle = '#7FD08F';
  for (let i = 0; i < 9; i++) {                            // soft continent blobs: quadratic curves through midpoints
    const cx = r() * 1024, cy = 120 + r() * 270, rx = 50 + r() * 80, ry = 36 + r() * 60;
    const pts = [...Array(10)].map((_, k) => { const a = k / 10 * Math.PI * 2, s = .65 + .55 * r(); return [cx + Math.cos(a) * rx * s, cy + Math.sin(a) * ry * s]; });
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    g.beginPath(); g.moveTo(...mid(pts[9], pts[0]));
    pts.forEach((p, k) => g.quadraticCurveTo(p[0], p[1], ...mid(p, pts[(k + 1) % 10])));
    g.fill();
  }
  g.fillStyle = '#F4F7FF'; g.fillRect(0, 0, 1024, 46); g.fillRect(0, 466, 1024, 46);   // ice caps
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,214,120,1)'); gr.addColorStop(.35, 'rgba(255,190,90,.45)'); gr.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
const EARTH_MAP = earthTexture();
const clay = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .88, metalness: 0, ...o });   // matte clay
const fade = (color, o = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, toneMapped: false, ...o });

/* lights: the Sun is the key (a point light at the origin, no falloff), a pastel hemisphere fills the night side
   so it reads as soft shade instead of black, and a cool rim light from behind outlines the spheres */
scene.add(new THREE.PointLight('#FFF1DC', 3.4, 0, 0));
scene.add(new THREE.HemisphereLight('#EEF2FF', '#F6E9FF', 1.1));
const rim = new THREE.DirectionalLight('#D6E2FF', 1.6); rim.position.set(-8, 10, -14); scene.add(rim);

const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 64, 32), new THREE.MeshBasicMaterial({ color: '#FFC86A', toneMapped: false }));
const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: .8 }));
glow.scale.setScalar(SUN_R * 5); scene.add(sun, glow);

const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(ORBIT_R, .035, 8, 256), fade('#8A90B8', { opacity: .7 }));
orbitRing.rotation.x = Math.PI / 2; scene.add(orbitRing);

/* one tilted Earth: position group (orbit) → tilt group (23.4°, never spins) → the spinning globe.
   The axis and the equator ring sit in the tilt group, so they lean with the globe but do not spin. */
function makeEarth(mat, scale = 1) {
  const pos = new THREE.Group(), tilt = new THREE.Group();
  tilt.rotation.z = -TILT;                                  // rotates +y (north) towards +x
  const globe = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 64, 32), mat);
  const axis = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, EARTH_R * 3.1, 12), clay('#3B3F6B'));
  tilt.add(globe, axis); pos.add(tilt); pos.scale.setScalar(scale); scene.add(pos);
  return { pos, tilt, globe, axis };
}
const earth = makeEarth(clay('#FFFFFF', { map: EARTH_MAP }));
const equator = new THREE.Mesh(new THREE.TorusGeometry(EARTH_R * 1.01, .03, 8, 128), clay('#E6458B'));
equator.rotation.x = Math.PI / 2; earth.tilt.add(equator);

/* shot 1 helpers in the position group (world-aligned): a dashed vertical and the 23.4° arc between it and the axis */
const vertical = new THREE.Group();
for (let i = 0; i < 9; i++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .26, 8), fade('#7A80A8')); d.position.y = -2.4 + i * .6; vertical.add(d); }
const arcCurve = new THREE.CatmullRomCurve3([...Array(9)].map((_, i) => { const a = TILT * i / 8; return new THREE.Vector3(Math.sin(a) * 2.05, Math.cos(a) * 2.05, 0); }));
const arc = new THREE.Mesh(new THREE.TubeGeometry(arcCurve, 32, .045, 8), fade('#F59E0B'));
earth.pos.add(vertical, arc);

/* shot 2: ghost Earths at the solstices and equinoxes — every axis leans the same way (towards +x) */
const SEASONS = [[0, '6 月 · 北半球夏'], [92, '9 月'], [183, '12 月 · 北半球冬'], [274, '3 月']];
const ghostMat = clay('#FFFFFF', { map: EARTH_MAP, transparent: true, depthWrite: false });
const ghosts = SEASONS.map(([day]) => { const g = makeEarth(ghostMat, .8); orbitPos(day, g.pos.position); g.axis.material = clay('#3B3F6B', { transparent: true }); return g; });
const PERI_DAY = 196;                                        // ≈ 1 月 3 日, perihelion

/* shot 3: two equal beams of parallel sunlight (from +x) and the patches they light. A at the sub-solar point
   (23.4°N in June: hits head-on), B 63.4° further south (≈ 40°S: hits at a slant, so the patch stretches 1/cos). */
const BEAM_R = .24, BEAMS = [{ a: 0 }, { a: -63.4 * Math.PI / 180 }];
const beamMat = fade('#FFD66B', { opacity: .35 }), patchMat = fade('#FFE27A', { opacity: .95 });
BEAMS.forEach((b) => {
  const n = new THREE.Vector3(Math.cos(b.a), Math.sin(b.a), 0);             // surface normal at the hit point
  b.hit = n.clone().multiplyScalar(EARTH_R);                                // in the position group (Earth centre = 0)
  const len = 7;
  b.beam = new THREE.Mesh(new THREE.CylinderGeometry(BEAM_R, BEAM_R, len, 32, 1, true), beamMat);
  b.beam.rotation.z = Math.PI / 2; b.beam.position.set(b.hit.x + len / 2, b.hit.y, 0);
  /* the lit patch: a disc in the tangent plane, stretched along the slope by 1/cos(incidence) */
  const tdir = new THREE.Vector3(-Math.sin(b.a), Math.cos(b.a), 0), zdir = new THREE.Vector3(0, 0, 1);
  b.patch = new THREE.Mesh(new THREE.CircleGeometry(BEAM_R, 48), patchMat);
  b.patch.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tdir, zdir, n));
  b.patch.scale.set(1 / Math.cos(b.a), 1, 1);
  b.patch.position.copy(n).multiplyScalar(EARTH_R + .012);
  earth.pos.add(b.beam, b.patch);
});

/* ---------- TECHNIQUE · one pure function poses the whole scene for time t ---------- */
const ease = (x) => x * x * (3 - 2 * x);
const E = new THREE.Vector3();
function poseOf(id, u, d) {                                  // → [camera position, look-at target] for one shot
  const e = orbitPos(id === 'orbit' ? 365 * u / d : 0, new THREE.Vector3());
  if (id === 'tilt') { const yaw = -.3 + .5 * u / d; return [e.clone().add(new THREE.Vector3(11 * Math.sin(yaw), 1.2, 11 * Math.cos(yaw))), e.clone().add(new THREE.Vector3(0, .3, 0))]; }
  if (id === 'orbit') return [new THREE.Vector3(-1 + .3 * u, 10, 28.5), new THREE.Vector3(0, -1.2, 0)];   // low angle: the orbit is a wide, flat ellipse
  /* from the Sun's side and a little below, so both lit patches face the camera (from straight side-on they are
     edge-on and invisible): pick the camera direction by its dot product with the surface normals you must show */
  return [e.clone().add(new THREE.Vector3(8.6 + .1 * u, -2.0, 7.2 - .1 * u)), e.clone().add(new THREE.Vector3(1.9, 0, 0))];
}
const ORDER = ['tilt', 'orbit', 'light'], BLEND = 1.4;
function setScene(t) {
  const day = EX.meterAt(t);
  orbitPos(day, E); earth.pos.position.copy(E);
  earth.globe.rotation.y = t * .8;                            // spin: the always-moving element
  /* per-shot weights: each shot's helpers fade in and out with the shot */
  const w1 = 1 - smooth(T.orbit, T.orbit + .8, t);
  const w2 = smooth(T.orbit + .3, T.orbit + 1.3, t) * (1 - smooth(T.light, T.light + .8, t));
  const w3 = smooth(T.light + .4, T.light + 1.4, t);
  vertical.children.forEach((m) => { m.material.opacity = w1; }); arc.material.opacity = w1 * clamp((t - 1.2) / .6);
  ghostMat.opacity = .42 * w2; ghosts.forEach((g) => { g.axis.material.opacity = w2; g.pos.visible = w2 > .01; });
  beamMat.opacity = .35 * w3; patchMat.opacity = .95 * w3;
  BEAMS.forEach((b) => { b.beam.visible = b.patch.visible = w3 > .01; });
  vertical.visible = arc.visible = w1 > .01;
  glow.material.opacity = .75 + .08 * Math.sin(t * 2);
  orbitRing.material.opacity = .7 * w2;                       // close-ups: the ring would sweep past the lens as a grey band
  orbitRing.visible = w2 > .01;
  /* camera: this shot's pose, blended from where the previous shot ended over the first BLEND seconds */
  let k = 0; for (let i = 0; i < ORDER.length; i++) if (t >= T[ORDER[i]]) k = i;
  const id = ORDER[k], u = t - T[id];
  let [p, q] = poseOf(id, u, DUR[id]);
  if (k > 0 && u < BLEND) {
    const pid = ORDER[k - 1], [p0, q0] = poseOf(pid, DUR[pid], DUR[pid]), w = ease(u / BLEND);
    p = p0.lerp(p, w); q = q0.lerp(q, w);
  }
  camera.position.copy(p); camera.lookAt(q);
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);   // matrices current BEFORE anyone projects
}

/* ---------- TECHNIQUE · DOM labels pinned to 3D points ----------
   project(): world Vector3 → screen px (the canvas fills the 1920×1080 frame, so NDC maps straight to it).
   pin(): dot on the point, tag at a fixed screen offset from it, a leader line between; hidden when the point is on
   the far side of its object (normal · view direction > 0). Same code for an engine part or a cell organelle:
   give it the part's world position (object.localToWorld(localPoint)) and, if it can be hidden, its normal. */
const _v = new THREE.Vector3(), _n = new THREE.Vector3();
function project(p) { _v.copy(p).project(camera); return [(_v.x + 1) * 960, (1 - _v.y) * 540]; }
function facing(p, normal) { return normal ? _n.copy(camera.position).sub(p).normalize().dot(normal) : 1; }
function pin(L, p, [dx, dy], o = 1, normal = null) {
  const [x, y] = project(p);
  const vis = o * smooth(-.05, .2, facing(p, normal));        // fades out as the point turns away
  EX.place(L.dot, x, y, 1, vis);
  EX.place(L.tag, x + dx, y + dy, 1, vis);
  L.line.setAttribute('x1', x.toFixed(1)); L.line.setAttribute('y1', y.toFixed(1));
  L.line.setAttribute('x2', (x + dx).toFixed(1)); L.line.setAttribute('y2', (y + dy).toFixed(1));
  L.line.style.opacity = vis;
}
/* html for n pins: one svg for the leader lines (drawn under the tags), then dot + tag per pin */
const pinsHTML = (prefix, items) => `
  <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">${items.map((_, i) => `<line id="${prefix}-ln${i}" stroke="#5D6385" stroke-width="3" stroke-linecap="round"/>`).join('')}</svg>
  ${items.map((it, i) => `<div class="abs" id="${prefix}-dot${i}" style="width:18px;height:18px;border-radius:50%;background:#fff;border:5px solid ${it.c}"></div>
    <div class="abs tag" id="${prefix}-tag${i}" style="--c:${it.c};white-space:nowrap;background:color-mix(in srgb,${it.c} 14%,white);box-shadow:0 8px 24px rgba(60,70,150,.14)">${it.text}</div>`).join('')}`;
const pinsOf = (el, prefix, n) => [...Array(n)].map((_, i) => ({ dot: el.querySelector(`#${prefix}-dot${i}`), tag: el.querySelector(`#${prefix}-tag${i}`), line: el.querySelector(`#${prefix}-ln${i}`) }));
const local = (obj, x, y, z) => obj.localToWorld(new THREE.Vector3(x, y, z));

/* ---------- the WebGL backdrop ---------- */
EX.backdrop({
  subject: true,                                             // the 3D scene IS the main visual: the composition lint counts it
  html: '',
  init(el) {
    /* preserveDrawingBuffer keeps the frame readable after the browser composites it (the renderer screenshots
       the page); pixel ratio 2 renders at 3840×2160 and downsamples — the cheapest clean anti-aliasing here */
    this.r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.r.setPixelRatio(2); this.r.setSize(1920, 1080);
    this.r.setClearColor(0x000000, 0);                       // transparent: the pastel page is the background
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.15;
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.domElement.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px';
    el.appendChild(this.r.domElement);
  },
  render(el, t) { setScene(t); this.r.render(scene, camera); },
});

EX.chapter('axis', { name: '地轴倾斜', color: EX.C.blue });
EX.chapter('orbit', { name: '公转', color: EX.C.purple });
EX.chapter('light', { name: '直射与斜射', color: EX.C.orange });

/* 1 · TILT — the tilted axis against a dashed vertical, the angle between them, and pins on the globe */
const P1 = [{ text: '北极', c: EX.C.blue }, { text: '赤道', c: EX.C.pink }, { text: '倾斜 23.4°', c: EX.C.orange }];
EX.shot({
  id: 'tilt', chapter: 'axis', dur: DUR.tilt,
  caps: [[.3, '地球的「地轴」是斜的。'], [3.6, '比垂直方向偏了 23.4°。']],
  sfx: [[1.2, 'pop', .4], [3.6, 'chime', .4]],
  html: pinsHTML('ti', P1) + `
    <div class="abs card" id="ti-card" style="left:110px;top:640px;width:420px;padding:24px 34px">
      <div class="t-label">地轴倾角</div>
      <div style="font-size:76px;font-weight:900;line-height:1.1;color:var(--orange)"><span class="mono">23.4</span>°</div>
    </div>`,
  init(el) { this.pins = pinsOf(el, 'ti', 3); this.card = el.querySelector('#ti-card'); },
  render(el, u, d, t) {
    setScene(t);                                             // pose for THIS t before projecting anything
    const a = TILT / 2;
    pin(this.pins[0], local(earth.tilt, 0, EARTH_R, 0), [-170, -40], clamp((u - .6) / .3));
    pin(this.pins[1], local(earth.tilt, 0, 0, EARTH_R * 1.01), [-260, 110], clamp((u - .9) / .3), local(earth.tilt, 0, 0, 1).sub(earth.pos.position).normalize());
    pin(this.pins[2], local(earth.pos, Math.sin(a) * 2.05, Math.cos(a) * 2.05, 0), [230, -30], clamp((u - 1.6) / .3));
    EX.pop(this.card, u, 3.6, { s0: .9 });
  },
});

/* 2 · ORBIT — one year in 8.5 s; ghosts mark the four seasons; the Earth's own pin says which month it is */
const P2 = SEASONS.map(([, text], i) => ({ text, c: [EX.C.orange, EX.C.green, EX.C.blue, EX.C.pink][i] }))
  .concat([{ text: '1 月初离太阳最近 · 1.47 亿 km', c: EX.C.red }, { text: '地球', c: EX.C.purple }]);
EX.shot({
  id: 'orbit', chapter: 'orbit', dur: DUR.orbit, meter: [0, 365],
  caps: [[.4, '公转一圈，地轴「方向」不变。'], [4.3, '1 月离太阳最近，北半球却是冬天。']],
  sfx: [[1.4, 'pop', .35], [4.3, 'snap', .4]],
  html: pinsHTML('or', P2),
  init(el) { this.pins = pinsOf(el, 'or', P2.length); this.earthTag = this.pins[5].tag; },
  render(el, u, d, t) {
    setScene(t);
    const show = clamp((u - 1.2) / .4);
    const off = [[0, 110], [250, -50], [0, 110], [-230, -10]];      // tag offsets per ghost (px): front/back ghosts get side tags
    ghosts.forEach((g, i) => pin(this.pins[i], local(g.pos, 0, i === 3 ? EARTH_R : -EARTH_R, 0), off[i], show * (i === 3 ? 1 : 1)));
    pin(this.pins[4], orbitPos(PERI_DAY), [60, -120], clamp((u - 4.3) / .3));
    const day = EX.meterAt(t);
    this.earthTag.textContent = `地球 · ${monthOf(day)} 月`;
    pin(this.pins[5], local(earth.pos, 0, EARTH_R, 0), [0, -90], clamp((u - .8) / .3));
  },
});

/* 3 · LIGHT — side view at the June solstice: equal beams, unequal patches. The card states the ratio 1/cos. */
const P3 = [{ text: '北半球 · 直射', c: EX.C.orange }, { text: '南半球 · 斜射', c: EX.C.blue }];
EX.shot({
  id: 'light', chapter: 'light', dur: DUR.light,
  caps: [[.4, '同一束光，「直射」最集中。'], [3.8, '斜射摊得更开，地面就更冷。']],
  sfx: [[1.4, 'pop', .4], [3.8, 'pop', .4]],
  html: pinsHTML('li', P3) + `
    <div class="abs card" id="li-card" style="left:96px;top:220px;width:430px;padding:26px 34px">
      <div class="t-label">6 月 · 同样粗的一束阳光</div>
      <div style="display:flex;align-items:baseline;gap:12px;margin-top:6px;white-space:nowrap"><span class="t-body">斜射光斑面积</span><b style="font-size:60px;font-weight:900;color:var(--blue)">×2.2</b></div>
      <div style="display:flex;align-items:baseline;gap:12px;white-space:nowrap"><span class="t-body">每块地只分到</span><b style="font-size:60px;font-weight:900;color:var(--blue)">45%</b></div>
    </div>`,
  init(el) { this.pins = pinsOf(el, 'li', 2); this.card = el.querySelector('#li-card'); },
  render(el, u, d, t) {
    setScene(t);
    pin(this.pins[0], local(earth.pos, BEAMS[0].hit.x, BEAMS[0].hit.y, 0), [250, -150], clamp((u - 1.4) / .3));
    pin(this.pins[1], local(earth.pos, BEAMS[1].hit.x, BEAMS[1].hit.y, 0), [300, 40], clamp((u - 3.8) / .3));
    EX.pop(this.card, u, 1.0, { s0: .9 });
  },
});

EX.run({ meter: { label: '夏至后', unit: '天', decimals: 0, max: 365, ticks: [0, 91, 182, 273, 365] }, mood: 'calm' });
