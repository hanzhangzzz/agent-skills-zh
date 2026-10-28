/* cinema.example.js — 「一块芯片里，有什么」 · cinematic 3D explainer: 5 shots, 3 chapters, 40 s at 96 bpm.
   Setup: `npm i three` in the work dir, then cp cinema.example.js shots.js (it is an ES module).
   This is the QUALITY BAR for every non-pastel film: one visual language, real light, post-processing, type as image,
   a speed-ramped camera that lands on the beat. Copy the techniques, not the chip.

   ┌─ ART DIRECTION (every film writes this card first; every shot obeys it) ─────────────────────────────────────┐
   │ style      dark cinematic 3D, like 《代码即动画》: one object world filmed by one restless camera            │
   │ palette    ground #07070A · ONE accent, molten orange #FF6A1A · warm white #EDE6DC for type · greys only  │
   │            (the accent marks exactly one thing per moment: the block that is talking, a gate that is on)  │
   │ type       Noto Sans SC 900, 170–340 px, for the one word or number that IS the frame                     │
   │            JetBrains Mono 22 px, uppercase, wide tracking, for micro-labels (HUD voice); nothing between  │
   │ materials  matte solder mask, brushed anodised metal, polished silicon, tungsten-grey gates — all PBR,    │
   │            lit by a warm key, a cool rim and a RoomEnvironment for reflections                            │
   │ post       bloom on the accent only · depth of field that follows the subject · vignette · grain          │
   │            (encode) · motion blur (--subframes 3)                                                          │
   │ motion     the camera never stops; moves between scales are speed ramps (EX.ramp), they land on a beat   │
   │            (EX.tempo(96)), then glide ≥ 3 s so captions and labels can be read                            │
   │ transition dive THROUGH the surface into the next scale (no dissolves); the hero word flies past the lens │
   │ chrome     theme 'dark' + chrome 'cinema' (no boxes); no .card / .tag / pills / emoji / flat clip-art     │
   └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘

   Facts (PLAN.md fact table; 示意 = schematic, shown on screen as 示意):
     - A17 Pro (Apple, 2023, TSMC 3 nm): about 19 billion transistors = 约 190 亿 (Apple's keynote figure);
       6-core CPU (2 performance + 4 efficiency), 6-core GPU, 16-core Neural Engine. Die ≈ 100 mm² (≈ 10 × 10 mm).
     - Phone SoCs carry 10+ billion transistors → 「上百亿」 (not 数百亿: that would mean 200–900 亿).
     - FinFET: the gate wraps a thin silicon fin on three sides; gate voltage on → current flows source → drain = 1.
       Contacted gate pitch ≈ 50 nm, fin pitch ≈ 30 nm at this node (示意 values). 「3 nm」 is a node name, not a size.
     - The transistors sit at the bottom of the die under 十余层 metal wiring; a P-core runs at ≈ 3.8 GHz, so a
       transistor on the clock path switches billions of times a second (「几十亿次」).
     - 示意: the floorplan (block positions), the board layout, the wiring and transistor geometry.

   Technique index (search for "TECHNIQUE ·"):
     A  nested scales in ONE scene: units = mm, the dive point is the origin, near/far/fog/shadow/DOF scale with d
     B  camera = closed-form keyframes; log-distance zoom about a fixed point; EX.ramp speed ramps on beats
     C  EffectComposer: RenderPass → UnrealBloomPass (accent only) → BokehPass (DOF follows d) → OutputPass
     D  procedural PBR materials from canvases (board traces, die-shot patterns, brushed metal) — no image files
     E  per-instance animation that stays pure in t (twinkling gates, ripple-sink, electron flow)
     F  DOM labels pinned to 3D points, HUD-style callouts (dot + leader + shelf + mono label)
     G  kinetic type: riseChars + EX.sweep on huge type, CSS-extruded glyphs, odometer digit, fly-through exit
     H  a screen-space micro-HUD (scale bar, field width) computed from the real camera */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------- palette + page look (could also live in index.html's "add your own" block) ----------
   theme 'dark' is a blue night; this film is near-black, so the stage background and the HUD inks are overridden.
   The stage background must equal what the WebGL ground renders to, or the pixel composition lint sees the whole
   frame as "ink". #bg (pastel blobs, dot grid) is switched off. */
const ACCENT = '#FF6A1A', INK = '#EDE6DC', INK2 = '#8C867E', INK3 = '#57524C';
document.head.insertAdjacentHTML('beforeend', `<style>
  /* same selector as the theme rule (#stage.theme-dark), declared later, so these variables win */
  #stage.theme-dark{--hud-ink:${INK};--hud-ink2:${INK2};--ink3:${INK3};background:#050506}
  #bg{display:none}
  .cx-mono{font-family:'JetBrains Mono','Noto Sans SC',monospace}   /* mono + a CJK fallback: 中文 in a mono label */
  /* micro-labels: write them in capitals yourself — text-transform:uppercase would turn µm into ΜM (reads as MM) */
  .cx-micro{font:500 22px/1.25 'JetBrains Mono','Noto Sans SC',monospace;letter-spacing:.14em;color:${INK2};white-space:nowrap;text-shadow:0 0 4px #000,0 1px 14px rgba(0,0,0,.95)}
  .cx-micro.data{color:${INK}}                                       /* a number the viewer must read: warm white */
  .cx-name{font:500 34px/1.2 'Noto Sans SC',sans-serif;letter-spacing:.04em;color:${INK};white-space:nowrap;text-shadow:0 2px 14px rgba(0,0,0,.9)}
  .cx-pin{position:absolute;left:0;top:0}
  .cx-dot{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border:2px solid ${INK};background:#050506}
  /* TECHNIQUE G · extruded, glowing type in plain CSS. The rule targets .ch (the spans splitChars makes), so
     currentColor is each glyph's OWN colour: EX.sweep turns a glyph orange and its extrusion + glow follow. */
  .cx-hero{position:absolute;white-space:nowrap;font:900 170px/1.08 'Noto Sans SC',sans-serif;letter-spacing:-.01em;color:${INK}}
  .cx-hero .ch{text-shadow:0 1px 0 color-mix(in srgb,currentColor 62%,#000),0 2px 0 color-mix(in srgb,currentColor 56%,#000),
    0 3px 0 color-mix(in srgb,currentColor 50%,#000),0 4px 0 color-mix(in srgb,currentColor 44%,#000),
    0 5px 0 color-mix(in srgb,currentColor 38%,#000),0 6px 0 color-mix(in srgb,currentColor 32%,#000),
    0 7px 0 color-mix(in srgb,currentColor 26%,#000),0 8px 0 color-mix(in srgb,currentColor 20%,#000),
    0 20px 40px rgba(0,0,0,.75)}
  .cx-hero.glow .ch{text-shadow:0 1px 0 color-mix(in srgb,currentColor 62%,#000),0 2px 0 color-mix(in srgb,currentColor 56%,#000),
    0 3px 0 color-mix(in srgb,currentColor 50%,#000),0 4px 0 color-mix(in srgb,currentColor 44%,#000),
    0 5px 0 color-mix(in srgb,currentColor 38%,#000),0 6px 0 color-mix(in srgb,currentColor 32%,#000),
    0 7px 0 color-mix(in srgb,currentColor 26%,#000),0 8px 0 color-mix(in srgb,currentColor 20%,#000),
    0 0 28px color-mix(in srgb,currentColor 55%,transparent),0 0 90px color-mix(in srgb,currentColor 35%,transparent)}
  .cx-mask{position:absolute;overflow:hidden;padding:24px 40px 48px;white-space:nowrap}   /* riseChars reveal mask */
  .cx-mask .cx-hero{position:relative}
  .cx-rule{position:absolute;height:2px;background:${INK2};transform-origin:0 50%}
</style>`);

/* ---------- beat grid: every duration, landing and cue is a whole beat (the music is synthesized at 96 bpm) ---------- */
const B = EX.tempo(96);                                         // B(n) = seconds of beat n; B(1) = 0.625 s
const DUR = { title: B(12), die: B(14), fet: B(12), bit: B(14), out: B(12) };   // 7.5 + 8.75 + 7.5 + 8.75 + 7.5 = 40 s
const T = {};
{ let acc = 0; for (const k in DUR) { T[k] = acc; acc += DUR[k]; } }
const smooth = (a, b, x) => { const p = clamp((x - a) / (b - a)); return p * p * (3 - 2 * p); };
const D2R = Math.PI / 180;

/* =====================================================================================================================
   TECHNIQUE A · nested scales in ONE scene.
   A phone board (≈ 100 mm) and a transistor (≈ 50 nm) differ by 6 orders of magnitude. Put them in one scene with
   1 unit = 1 mm and make the point you dive into the ORIGIN: floats keep ~7 significant digits relative to their
   size, so geometry 1e-4 mm from the origin is as precise as geometry 100 mm away. Three rules keep it working:
     - camera.near / far, fog, the shadow camera, the light positions and the DOF aperture are all multiples of the
       camera distance d, set every frame (scale-invariant), never constants;
     - small things are authored in their own unit inside a scaled group (forest: nm, group.scale = 1e-6);
     - each level lives where it physically is: transistors on the floor of the CPU block, wiring above them, the
       die on the package, the package on the board — so diving is just moving the camera.
   ===================================================================================================================== */
const scene = new THREE.Scene();
const GROUND = new THREE.Color('#07070A');
scene.background = GROUND;
scene.fog = new THREE.Fog(GROUND, 1, 10);                         // near/far rescaled per frame (× d)
const camera = new THREE.PerspectiveCamera(30, 1920 / 1080, .1, 1000);

const DX = -2.1, DZ = 3.6;                                        // die centre in world mm; the dive point O = (0, 0, 0)
const DIE = 10.2, BOARD_W = 200, BOARD_H = 140, BOARD_Y = -1.1;   // die ≈ 10 × 10 mm (A17 Pro ≈ 100 mm²)
const BLOCKS = [                                                  // floorplan in die coordinates (mm), 示意
  { kind: 'gpu', x0: -4.9, z0: -4.9, x1: -.9, z1: .9 },
  { kind: 'cpu', x0: -.7, z0: -4.9, x1: 4.9, z1: -2.3 },          // O sits in the middle of the CPU block
  { kind: 'npu', x0: -.7, z0: -2.1, x1: 2.6, z1: .9 },
  { kind: 'sram', x0: 2.8, z0: -2.1, x1: 4.9, z1: .9 },
  { kind: 'logic', x0: -4.9, z0: 1.1, x1: -1.9, z1: 4.9 },
  { kind: 'logic', x0: -1.7, z0: 1.1, x1: .9, z1: 3.0 },
  { kind: 'sram', x0: -1.7, z0: 3.2, x1: .9, z1: 4.9 },
  { kind: 'logic', x0: 1.1, z0: 1.1, x1: 4.9, z1: 4.9 },
];
const LIT = { cpu: B(5), gpu: B(7), npu: B(9) };                   // S2 local times the three named blocks light up

/* ---------- TECHNIQUE D · procedural PBR textures from canvases (deterministic: rng only) ---------- */
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const texOf = (c, srgb = true) => {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; return t;
};

/* board: colour map + one "rm" map (three reads roughness from G and metalness from B) so copper traces and pads
   are smooth metal while the solder mask stays matte — the cue that makes it read as a real PCB */
function boardTextures() {
  const W = 4096, H = Math.round(4096 * BOARD_H / BOARD_W), PX = W / BOARD_W;
  const col = canvasOf(W, H), rm = canvasOf(W, H), gc = col.getContext('2d'), gr = rm.getContext('2d');
  gc.fillStyle = '#101114'; gc.fillRect(0, 0, W, H);
  gr.fillStyle = 'rgb(0,190,0)'; gr.fillRect(0, 0, W, H);        // roughness .75, metalness 0
  const r = rng(3);
  for (let i = 0; i < 9000; i++) { gc.fillStyle = `rgba(255,255,255,${(.008 + .02 * r()).toFixed(3)})`; gc.fillRect(r() * W, r() * H, 2, 2); }
  const P = (x, z) => [(x - DX + BOARD_W / 2) * PX, (z - DZ + BOARD_H / 2) * PX];
  const stroke = (pts, w, c, rough, metal) => {
    for (const [g, style] of [[gc, c], [gr, `rgb(0,${rough},${metal})`]]) {
      g.strokeStyle = style; g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo : g.moveTo).call(g, ...P(x, z))); g.stroke();
    }
  };
  const dot = (x, z, rad, c, rough, metal) => {
    for (const [g, style] of [[gc, c], [gr, `rgb(0,${rough},${metal})`]]) { g.fillStyle = style; g.beginPath(); g.arc(...P(x, z), rad * PX, 0, 7); g.fill(); }
  };
  /* trace bundles fan out of the package edges: straight, one 45° bend, straight, end in a via */
  for (let side = 0; side < 4; side++) for (let b = 0; b < 4; b++) {
    const n = 5 + Math.floor(r() * 6), off = -6 + b * 3.6 + r() * .8, bend = (r() < .5 ? -1 : 1), l1 = 2 + r() * 5, l2 = 4 + r() * 14;
    for (let k = 0; k < n; k++) {
      const s = off + k * .32, e = 8.2;                           // .32 mm pitch, starting at the package edge (7.5 mm)
      const path = [[e, s], [e + l1, s], [e + l1 + l2 * .7, s + bend * l2 * .7], [e + l1 + l2 * .7 + 6 + r() * 10, s + bend * l2 * .7]];
      const rot = (x, z) => { const a = side * Math.PI / 2; return [DX + x * Math.cos(a) - z * Math.sin(a), DZ + x * Math.sin(a) + z * Math.cos(a)]; };
      const pts = path.map(([x, z]) => rot(x, z));
      stroke(pts, .11 * PX, '#2A2C31', 120, 160);
      const [vx, vz] = pts[pts.length - 1]; dot(vx, vz, .2, '#4B4D53', 70, 255);
    }
  }
  /* pads around the passives and two big ICs (exposed metal), plus ground pours (slightly lighter mask) */
  for (let i = 0; i < 26; i++) { const x = DX + (r() - .5) * 120, z = DZ + (r() - .5) * 90; if (Math.hypot(x - DX, z - DZ) < 16) continue;
    gc.fillStyle = 'rgba(255,255,255,.025)'; gc.fillRect(...P(x, z), (6 + r() * 20) * PX, (4 + r() * 12) * PX); }
  return { map: texOf(col), rm: texOf(rm, false) };
}

/* die-shot look: every block is a pattern of tiles, standard-cell rows and SRAM grids. One list of rectangles is
   painted twice — as dark greys (albedo) and as white levels (emissive) — so when a block "lights up" its own
   circuitry glows, not a flat orange slab. */
function blockTextures(kind, w, h, seed) {
  const S = 1024, r = rng(seed), rects = [];
  const rows = (x, y, ww, hh, lv) => {                           // standard-cell rows: segments of random length
    for (let yy = y + 2; yy < y + hh - 3; yy += 7) { let xx = x + 2; while (xx < x + ww - 4) { const l = 4 + r() * 26; if (r() < .78) rects.push([xx, yy, Math.min(l, x + ww - 3 - xx), 4, lv * (.5 + .5 * r())]); xx += l + 2; } }
  };
  const sram = (x, y, ww, hh, lv) => {                           // SRAM: a fine, perfectly regular grid
    for (let yy = y; yy < y + hh; yy += 5) rects.push([x, yy, ww, 2, lv]);
    for (let xx = x; xx < x + ww; xx += 11) rects.push([xx, y, 2, hh, lv * .7]);
  };
  const tile = (x, y, ww, hh) => {
    rects.push([x, y, ww, 3, .95], [x, y + hh - 3, ww, 3, .95], [x, y, 3, hh, .95], [x + ww - 3, y, 3, hh, .95]);
    const sh = hh * (.25 + .15 * r());
    sram(x + 8, y + 8, ww - 16, sh, .55); rows(x + 6, y + sh + 14, ww - 12, hh - sh - 20, .7);
  };
  const grid = (nx, ny, pad = 14) => { const tw = (S - pad * (nx + 1)) / nx, th = (S - pad * (ny + 1)) / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) tile(pad + i * (tw + pad), pad + j * (th + pad), tw, th); };
  if (kind === 'cpu') { tile(14, 14, 300, 560); tile(328, 14, 300, 560); sram(14, 590, 614, 420, .6);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) tile(642 + i * 186, 14 + j * 500, 172, 486); }
  else if (kind === 'gpu') grid(2, 3);
  else if (kind === 'npu') grid(4, 4, 10);
  else if (kind === 'sram') sram(10, 10, S - 20, S - 20, .65);
  else { rows(8, 8, S - 16, S - 16, .6); for (let i = 0; i < 3; i++) sram(40 + r() * 600, 40 + r() * 600, 200 + r() * 200, 160 + r() * 140, .55); }
  const paint = (fn) => { const c = canvasOf(S, S), g = c.getContext('2d'); g.fillStyle = fn(0); g.fillRect(0, 0, S, S);
    for (const [x, y, ww, hh, lv] of rects) { g.fillStyle = fn(lv); g.fillRect(x, y, ww, hh); } return c; };
  const albedo = paint((lv) => { const v = 34 + Math.round(lv * 70); return `rgb(${v},${v + 1},${v + 4})`; });
  const glow = paint((lv) => { const v = Math.round(255 * Math.pow(lv, 1.6)); return `rgb(${v},${v},${v})`; });
  return { map: texOf(albedo), emissiveMap: texOf(glow) };
}

/* brushed metal: horizontal streaks in a roughness map */
function brushedTexture() {
  const c = canvasOf(512, 512), g = c.getContext('2d'), r = rng(11);
  g.fillStyle = 'rgb(0,96,255)'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1400; i++) { const v = 110 + Math.round(r() * 70); g.fillStyle = `rgb(0,${v},255)`; g.fillRect(0, r() * 512, 512, 1); }
  const t = texOf(c, false); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/* ---------- materials: greys only; the accent exists ONLY in emissive / basic materials ----------
   TECHNIQUE C (bloom gate): UnrealBloomPass threshold = 1.3 on the LUMINANCE of the linear HDR image. Lit greys (and
   their specular glints) stay below it, so they never bloom. The trap: orange is dark in luminance — #FF6A1A in linear
   is (1, .144, .010), luminance ≈ .32 — so an accent material needs ×5 or more (HOT(5)) to cross 1.3; HOT(3) does
   not glow at all. Accent = only emissive / basic materials, nothing else ever gets the accent colour. */
const HOT = (k = 1) => new THREE.Color(ACCENT).multiplyScalar(k);          // linear accent × k (HDR)
const std = (color, roughness, metalness, o = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...o });
const BT = boardTextures(), BRUSH = brushedTexture();
const M = {
  board: std('#FFFFFF', 1, 1, { map: BT.map, roughnessMap: BT.rm, metalnessMap: BT.rm }),
  boardEdge: std('#0C0D10', .8, 0),
  ic: std('#141518', .55, .1),
  capBody: std('#3A3836', .55, 0),
  metal: std('#8E9095', .5, 1),
  shield: std('#80828A', 1, 1, { roughnessMap: BRUSH }),
  substrate: std('#1B1C20', .62, .05),
  dieSide: std('#1C1E23', .25, .85),
  dieTop: std('#0B0C0E', .5, .4),
  wire: std('#7C7E84', .45, .6),                                // part-diffuse: reads in the key light, no mirror glare
  floor: std('#141518', .6, .1),
  fin: std('#666A73', .45, .25),                                // metalness ≤ .5: with a black studio, pure metal
  gate: std('#A6A8AE', .45, .55),                               // only shows softbox reflections and goes dark
  contact: std('#6E7076', .5, .5),
  hot: new THREE.MeshBasicMaterial({ color: HOT(5) }),
};

/* ---------- L0 · board, shield frame, package, passives ---------- */
const box = (w, h, d, mat, x, y, z, cast = true) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m;
};
{
  const top = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), M.board);
  top.rotation.x = -Math.PI / 2; top.position.set(DX, BOARD_Y, DZ); top.receiveShadow = true; scene.add(top);
  box(BOARD_W, .8, BOARD_H, M.boardEdge, DX, BOARD_Y - .401, DZ, false);
  /* an endless dark floor under the board, so its far edge melts into the fog instead of ending in a cliff */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), M.boardEdge);
  floor.rotation.x = -Math.PI / 2; floor.position.set(DX, BOARD_Y - .02, DZ); floor.receiveShadow = true; scene.add(floor);
  /* the RF shield frame around the SoC: four brushed-metal walls (foreground depth in the die shot) */
  const F = 13.5, Hh = 1.4;
  box(2 * F, Hh, .3, M.shield, DX, BOARD_Y + Hh / 2, DZ - F); box(2 * F, Hh, .3, M.shield, DX, BOARD_Y + Hh / 2, DZ + F);
  box(.3, Hh, 2 * F, M.shield, DX - F, BOARD_Y + Hh / 2, DZ); box(.3, Hh, 2 * F, M.shield, DX + F, BOARD_Y + Hh / 2, DZ);
  /* package substrate and the die (its top face at y = 0 is where the blocks stand) */
  box(15, .7, 15, M.substrate, DX, BOARD_Y + .35, DZ);
  const dieBody = new THREE.Mesh(new THREE.BoxGeometry(DIE, .37, DIE), [M.dieSide, M.dieSide, M.dieTop, M.dieSide, M.dieSide, M.dieSide]);
  dieBody.position.set(DX, -.03 - .185, DZ); dieBody.castShadow = dieBody.receiveShadow = true; scene.add(dieBody);
  /* two larger ICs and ~150 0402 capacitors (body + two metal terminals), scattered by rng outside the shield */
  box(9, .9, 7, M.ic, DX + 26, BOARD_Y + .45, DZ - 8); box(6, .8, 6, M.ic, DX - 24, BOARD_Y + .4, DZ + 9);
  box(4, .7, 3, M.ic, DX + 20, BOARD_Y + .35, DZ + 12);
  const r = rng(21), caps = [];
  for (let i = 0; caps.length < 150 && i < 2000; i++) {
    const x = (r() - .5) * 90, z = (r() - .5) * 64;
    if (Math.max(Math.abs(x), Math.abs(z)) < 15 || (Math.abs(x - 26) < 6 && Math.abs(z + 8) < 5)) continue;
    caps.push([DX + x, DZ + z, r() < .5 ? 0 : Math.PI / 2]);
  }
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(.6, .5, .5), M.capBody, caps.length);
  const term = new THREE.InstancedMesh(new THREE.BoxGeometry(.2, .52, .52), M.metal, caps.length * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  caps.forEach(([x, z, a], i) => {
    const y = BOARD_Y;
    q.setFromAxisAngle(Y, a); body.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y + .25, z), q, one));
    for (const s of [-1, 1]) term.setMatrixAt(i * 2 + (s > 0), m4.compose(new THREE.Vector3(x + Math.cos(a) * .4 * s, y + .26, z - Math.sin(a) * .4 * s), q, one));
  });
  for (const m of [body, term]) { m.castShadow = m.receiveShadow = true; scene.add(m); }
}

/* ---------- L1 · functional blocks on the die: slabs + emissive frame strips ---------- */
const blocks = BLOCKS.map((b, i) => {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, cx = DX + (b.x0 + b.x1) / 2, cz = DZ + (b.z0 + b.z1) / 2;
  const tex = blockTextures(b.kind, w, d, 40 + i);
  const top = std('#FFFFFF', .42, .6, { ...tex, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, .03, d), [M.dieSide, M.dieSide, top, M.dieSide, M.dieSide, M.dieSide]);
  slab.position.set(cx, -.015, cz); slab.receiveShadow = true; scene.add(slab);
  const frame = new THREE.MeshBasicMaterial({ color: HOT(0) }), s = .05;
  const strip = (ww, dd, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(ww, .034, dd), frame); m.position.set(x, -.013, z); scene.add(m); };
  strip(w + s, s, cx, cz - d / 2); strip(w + s, s, cx, cz + d / 2); strip(s, d, cx - w / 2, cz); strip(s, d, cx + w / 2, cz);
  return { ...b, top, frame, cx, cz, w, d };
});

/* ---------- L2 · wiring: seven metal layers above O, each 2.1× coarser and higher than the one below ----------
   Self-similar on purpose: falling through them at a constant log-speed looks the same at every scale (the
   "wireframe library" fly-through). Heights 1.2 µm … 0.1 mm, alternating directions, 示意 (real chips: 十余层, and
   the lowest ones sit right on the transistors; here they start higher so the forest camera stays below them). */
{
  const bars = [];
  const r = rng(5);
  for (let k = 0; k < 7; k++) {
    const f = Math.pow(2.1, k), y = 1.2e-3 * f, p = 1.8e-4 * f, E = 24 * p;
    for (let j = -24; j <= 24; j++) if (r() > .12) bars.push({ k, y, p, E, j });
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.wire, bars.length);
  const m4 = new THREE.Matrix4();
  bars.forEach((b, i) => {
    const along = b.k % 2 === 0;                                  // even layers run along x, odd along z
    m4.makeScale(along ? 2 * b.E : b.p * .5, b.p * .45, along ? b.p * .5 : 2 * b.E);
    m4.setPosition(along ? 0 : b.j * b.p, b.y, along ? b.j * b.p : 0);
    mesh.setMatrixAt(i, m4);
  });
  mesh.receiveShadow = true; scene.add(mesh);                     // castShadow off: the forest below stays lit
}

/* ---------- L3 · the transistor forest, authored in nanometres inside a group scaled 1e-6 ----------
   Fins (silicon, along x) in groups of 3; gates (metal, along z) every 50 nm wrap the fins; contacts between gates.
   T0 = the one transistor S4 isolates: segment s = 0, group g = 0, its centre gate, its two contacts at ±75 nm. */
const forest = new THREE.Group(); forest.scale.setScalar(1e-6); scene.add(forest);
const GROUPS = 20, SEGS = 16;                                     // g ∈ [-20, 20] (150 nm), s ∈ [-16, 16] (300 nm)
const FIN = [], GATE = [], CONT = [];
for (let g = -GROUPS; g <= GROUPS; g++) for (let s = -SEGS; s <= SEGS; s++) {
  const t0 = g === 0 && s === 0;
  for (let f = -1; f <= 1; f++) FIN.push({ x: 300 * s, z: 150 * g + 30 * f, keep: t0 });
  for (let k = -2; k <= 2; k++) GATE.push({ x: 300 * s + 50 * k, z: 150 * g, keep: t0 && k === 0, seed: (g * 131 + s * 17 + k * 7 + 999) * 1.37 });
  for (const c of [-125, -75, -25, 25, 75, 125]) CONT.push({ x: 300 * s + c, z: 150 * g, keep: t0 && Math.abs(c) === 75 });
}
for (const arr of [FIN, GATE, CONT]) for (const it of arr) it.r = Math.hypot(it.x, it.z);
const SIZE = { fin: [280, 50, 9], gate: [16, 85, 116], cont: [18, 40, 84] };
const inst = (arr, mat, size) => {
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, arr.length);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
  m.userData = { arr, size }; forest.add(m); return m;
};
const finMesh = inst(FIN, M.fin, SIZE.fin), gateMesh = inst(GATE, M.gate, SIZE.gate), contMesh = inst(CONT, M.contact, SIZE.cont);
const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.hot, GATE.length);   // the glowing "on" strip on a gate
capMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); capMesh.frustumCulled = false; forest.add(capMesh);
{
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(14000, 9000), M.floor);
  fl.rotation.x = -Math.PI / 2; fl.position.y = .3; fl.receiveShadow = true; forest.add(fl);
}
/* T0's fins are plain meshes (they never sink); the current is shown by glowing electrons riding on top of them —
   small HDR dots, not a glowing fin: a whole orange slab would flood the frame with bloom */
const t0Fins = [-30, 0, 30].map((z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...SIZE.fin), M.fin); m.position.set(0, 25, z); m.castShadow = m.receiveShadow = true; forest.add(m); return m; });
const ELECTRONS = 18;
const electrons = new THREE.InstancedMesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshBasicMaterial({ color: HOT(5) }), ELECTRONS);
electrons.instanceMatrix.setUsage(THREE.DynamicDrawUsage); electrons.frustumCulled = false; forest.add(electrons);

/* ---------- lights: warm key with shadows, cool rim, a black studio environment for reflections ----------
   TECHNIQUE D · why not RoomEnvironment: it is a WHITE room, and every dielectric (solder mask, plastic) reflects
   ~10–20 % of it at grazing angles, so a dark board turns flat grey. A product studio is black with a few
   softboxes: metal shows crisp highlights, everything else stays dark. Softboxes ≤ 1.2 so reflections stay under
   the bloom threshold. */
function studio() {
  const s = new THREE.Scene(); s.background = new THREE.Color(0, 0, 0);
  const box = (w, h, k, color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  box(9, 4, .9, '#FFF1E2', -3, 7, 3);                             // overhead key softbox, warm
  box(1.2, 7, .9, '#D2DCEC', 7, 2.5, -4);                         // tall strip, back right, cool
  box(7, .7, .35, '#FFFFFF', 0, 1.2, 8);                          // low front strip: a line along every top edge
  box(30, 30, .015, '#FFFFFF', 0, -6, 0);                         // the floor: almost nothing
  return s;
}
const key = new THREE.DirectionalLight('#FFF1E2', 2.0); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.0004; key.shadow.radius = 2;
scene.add(key, key.target);
const KEY_DIR = new THREE.Vector3(-.55, 1, .45).normalize();
const rim = new THREE.DirectionalLight('#C6D0E2', 1.3); scene.add(rim, rim.target);
const RIM_DIR = new THREE.Vector3(.45, .55, -1).normalize();

/* =====================================================================================================================
   TECHNIQUE B · the camera is a closed-form function of t: keyframes + eases, zoom in log space about a fixed point.
   Each key: time (on a beat), target on the die plane [x, z], distance d (mm), yaw / pitch (°), lift (look above the
   target, × d, pushes the subject down the frame) and the ease INTO this key:
     ramp   EX.ramp — creeps, rushes, settles: a cut-like move between scales that still reads as one camera
     in/out a ramp split in two so its fast middle can be slowed down: "in" (x²) rushes to just above the wiring,
            "out" (1-(1-x)²) falls through the seven layers at a readable speed; their speeds are matched at the
            seam (Δln d / duration × 2 ≈ 6 /s on both sides), so it is one continuous fall
     glide  smoothstep — the slow drift that keeps a held shot alive
   d is interpolated in log space (equal screen speed per decade). The target moves by w = (d - da)/(db - da),
   not by p: the point being zoomed into stays put on screen instead of sliding away (same idea as EX's flyPose).
   2D alternative: shots with `at` + `fly` + `flyEase: EX.ramp` — this film is 3D, so the camera lives here and the
   shots have no `at` (EX.cam is unused).
   ===================================================================================================================== */
const KEYS = [
  { t: 0, at: [DX, DZ], d: 84, yaw: -36, pitch: 21, lift: .12 },
  { t: B(10), at: [DX, DZ], d: 60, yaw: -16, pitch: 29, lift: .1, ease: 'glide' },
  { t: B(15), at: [-1.3, 2.3], d: 20, yaw: 6, pitch: 56, lift: 0, ease: 'ramp' },          // lands in S2 at u = B(3)
  { t: B(24), at: [-1.0, 1.8], d: 16, yaw: 20, pitch: 52, lift: 0, ease: 'glide' },
  { t: B(26), at: [0, 0], d: .3, yaw: 34, pitch: 46, lift: 0, ease: 'in' },                 // rush to the wiring
  { t: B(29), at: [0, 0], d: 1.4e-3, yaw: 58, pitch: 21, lift: 0, ease: 'out' },           // fall through it, lands S3 u = B(3)
  { t: B(37), at: [-6e-4, -2e-4], d: 1.15e-3, yaw: 70, pitch: 18, lift: 0, ease: 'glide' },
  { t: B(40), at: [0, 0], d: 6.5e-4, yaw: 32, pitch: 22, lift: .06, ease: 'ramp' },        // push into T0, lands S4 u = B(2)
  { t: B(51), at: [0, 0], d: 5.6e-4, yaw: -16, pitch: 19, lift: .06, ease: 'glide' },      // slow 48° orbit
  { t: B(57), at: [DX, DZ], d: 72, yaw: -32, pitch: 27, lift: .12, ease: 'ramp' },         // pull back out, lands S5 u = B(5)
  { t: B(64), at: [DX, DZ], d: 64, yaw: -22, pitch: 30, lift: .12, ease: 'glide' },
];
const EASE = { ramp: EX.ramp, glide: (x) => x * x * (3 - 2 * x), in: (x) => x * x, out: (x) => 1 - (1 - x) * (1 - x) };
function poseAt(t) {
  let i = 0; while (i < KEYS.length - 2 && t >= KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1], p = EASE[b.ease](clamp((t - a.t) / (b.t - a.t)));
  const d = Math.exp(lerp(Math.log(a.d), Math.log(b.d), p));
  const w = Math.abs(Math.log(b.d / a.d)) < .05 ? p : (d - a.d) / (b.d - a.d);
  return { x: lerp(a.at[0], b.at[0], w), z: lerp(a.at[1], b.at[1], w), d, yaw: lerp(a.yaw, b.yaw, p) * D2R, pitch: lerp(a.pitch, b.pitch, p) * D2R, lift: lerp(a.lift, b.lift, p) };
}
/* the HUD meter = orders of magnitude of zoom, from the same camera function, so meter and picture agree at every
   cut. (Inside a shot the meter is linear in time while the camera ramps; the in-frame scale bar is exact.) */
const zoomAt = (t) => Math.log10(KEYS[0].d / poseAt(t).d);
const meterOf = (id) => [+zoomAt(T[id]).toFixed(2), +zoomAt(T[id] + DUR[id]).toFixed(2)];

/* ---------- TECHNIQUE E · per-instance animation, pure in t ---------- */
const hash = (x) => { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); };
/* S4 isolates T0: the forest sinks into the floor in a ripple from T0 outward, and rises again during the pull-back */
const SINK_R = 1200;                                              // nm: wider than the S4 camera distance (≈ 600 nm)
const sinkAt = (r, t) => r > SINK_R ? 0 : smooth(0, .45, t - (T.bit + .25 + r / SINK_R * 1.1)) * (1 - smooth(0, .4, t - (T.bit + DUR.bit - .7 + r / SINK_R * .8)));
/* T0's gate: on at S4 u = B(3), off at B(8), on again at B(12) (the beat grid IS the script) */
const gateOn = (t) => { const u = t - T.bit; return smooth(B(3), B(3) + .15, u) * (1 - smooth(B(8), B(8) + .15, u)) + smooth(B(12), B(12) + .15, u); };
/* block glow envelope: each named block lights at its beat, falls to an ember when the next one lights, all go dark
   before the dive (the CPU block is the forest's floor), and all return as embers on the final wide shot */
function blockGlow(b, t) {
  const u = t - T.die, at = LIT[b.kind];
  const outro = .35 * smooth(T.out + B(4), T.out + B(7), t);
  if (at == null) return outro * .6;
  const nextAt = Object.values(LIT).find((v) => v > at) ?? 1e9;
  const on = smooth(at, at + .3, u) * (1 - .62 * smooth(nextAt, nextAt + .5, u)) * (1 - smooth(DUR.die - B(3), DUR.die - B(1), u));
  return Math.max(on, outro);
}

const m4 = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
let lastT = null;
const D = { d: 1 };                                               // current camera distance, read by the micro-HUD
function setScene(t) {
  if (t === lastT) return;                                        // memoised: every shot AND the backdrop call it
  lastT = t;
  const P = poseAt(t), d = P.d; D.d = d;
  const target = new THREE.Vector3(P.x, 0, P.z);
  camera.position.set(P.x + d * Math.cos(P.pitch) * Math.sin(P.yaw), d * Math.sin(P.pitch), P.z + d * Math.cos(P.pitch) * Math.cos(P.yaw));
  camera.near = d * .02; camera.far = d * 400; camera.updateProjectionMatrix();
  camera.lookAt(P.x, P.lift * d, P.z);
  scene.fog.near = d * 1.5; scene.fog.far = d * 5.5;
  /* lights and shadow frustum follow the scale */
  key.position.copy(target).addScaledVector(KEY_DIR, d * 4); key.target.position.copy(target);
  const sc = key.shadow.camera; sc.left = sc.bottom = -d * 2.2; sc.right = sc.top = d * 2.2; sc.near = d * .2; sc.far = d * 9;
  sc.updateProjectionMatrix(); key.shadow.normalBias = d * .0015;
  rim.position.copy(target).addScaledVector(RIM_DIR, d * 4); rim.target.position.copy(target);
  /* L1 glow */
  for (const b of blocks) { const k = blockGlow(b, t); b.top.emissiveIntensity = 2.4 * k; b.frame.color.copy(HOT(5 * k)); }
  /* L3: only worth updating when it can be seen */
  forest.visible = d < .05;
  if (forest.visible) {
    for (const mesh of [finMesh, gateMesh, contMesh]) {
      const { arr, size } = mesh.userData;
      arr.forEach((it, i) => {
        if (mesh === finMesh && it.keep) { mesh.setMatrixAt(i, m4.makeScale(0, 0, 0)); return; }   // T0's fins are separate meshes
        const k = it.keep ? 1 : 1 - sinkAt(it.r, t), sy = size[1] * k;          // sink = squash into the floor
        if (k < .002) m4.makeScale(0, 0, 0);
        else { m4.makeScale(size[0], sy, size[2]); m4.setPosition(it.x, sy / 2, it.z); }
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    /* twinkle: each gate gets slots of 1/1.6 s; in 2.5 % of slots it pulses on (sin envelope inside
       the slot). Sparse on purpose: a forest where everything glows is a neon sign, not a chip at work */
    GATE.forEach((g, i) => {
      let on;
      if (g.keep) on = gateOn(t);
      else { const x = t * 1.6 + hash(g.seed) * 7, slot = Math.floor(x); on = hash(g.seed + slot * 3.1) < .025 ? Math.sin(Math.PI * (x - slot)) : 0; on *= 1 - sinkAt(g.r, t); }
      if (on < .02) m4.makeScale(0, 0, 0);
      else { m4.makeScale(14, 3, 110 * Math.min(1, on * 1.5)); m4.setPosition(g.x, 85 * (g.keep ? 1 : 1 - sinkAt(g.r, t)) + 1.5, g.z); }
      capMesh.setMatrixAt(i, m4);
    });
    capMesh.instanceMatrix.needsUpdate = true;
    /* T0 conducts: electrons stream source → drain (−x → +x) at 160 nm/s, fading at the fin ends */
    const on = clamp(gateOn(t));
    for (let i = 0; i < ELECTRONS; i++) {
      const lane = i % 3, x = -140 + ((t * 160 + hash(i + .5) * 280) % 280), edge = smooth(-140, -110, x) * (1 - smooth(110, 140, x));
      const s = on * edge;
      _p.set(x, 54 + 3 * Math.sin(t * 9 + i), -30 + lane * 30); _s.setScalar(Math.max(s, 1e-3));
      electrons.setMatrixAt(i, m4.compose(_p, _q, _s));
    }
    electrons.instanceMatrix.needsUpdate = true;
  }
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);   // matrices current BEFORE anyone projects
}

/* ---------- TECHNIQUE F · DOM labels pinned to 3D points (house idiom from three.example.js, cinema styling) ----------
   A callout = a hollow square on the point, a leader to an elbow, a shelf line under the label. The shelf draws
   itself in (p), then the label fades up. Labels are DOM: crisp, in the house fonts, checked by --lint. */
const _v = new THREE.Vector3();
function project(p) { _v.copy(p).project(camera); return [(_v.x + 1) * 960, (1 - _v.y) * 540, _v.z]; }
function pin(L, p, [dx, dy], o = 1) {
  const [x, y, z] = project(p);
  const vis = z < 1 ? clamp(o) : 0, grow = expoOut(clamp(o * 1.4));
  const ex = x + dx * grow, ey = y + dy * grow, right = dx >= 0, tw = L.tag.offsetWidth, w = tw + 12;   // elbow, shelf length
  L.dot.style.left = x + 'px'; L.dot.style.top = y + 'px'; L.dot.style.opacity = vis;
  L.tag.style.left = (right ? ex + 6 : ex - 6 - tw) + 'px'; L.tag.style.top = (ey - L.tag.offsetHeight - 8) + 'px';   // label sits on the shelf
  const to = clamp(o * 2 - 1);                                    // the label arrives after the line
  L.tag.style.opacity = to; L.tag.style.visibility = to <= 0 ? 'hidden' : ''; L.dot.style.visibility = vis <= 0 ? 'hidden' : '';
  const set = (ln, x1, y1, x2, y2) => { ln.setAttribute('x1', x1.toFixed(1)); ln.setAttribute('y1', y1.toFixed(1)); ln.setAttribute('x2', x2.toFixed(1)); ln.setAttribute('y2', y2.toFixed(1)); ln.style.opacity = vis; };
  set(L.lead, x, y, ex, ey);
  set(L.shelf, ex, ey, ex + (right ? 1 : -1) * w * clamp(o * 1.6 - .4), ey);
}
const pinsHTML = (prefix, items) => `
  <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">${items.map((_, i) =>
    `<line id="${prefix}-ld${i}" stroke="${INK}" stroke-opacity=".7" stroke-width="1.5"/><line id="${prefix}-sh${i}" stroke="${INK}" stroke-width="2"/>`).join('')}</svg>
  ${items.map((it, i) => `<div class="cx-dot" id="${prefix}-dot${i}"></div>
    <div class="cx-pin" id="${prefix}-tag${i}"><div class="cx-micro">${it.micro}</div><div class="cx-name">${it.name}</div></div>`).join('')}`;
const pinsOf = (el, prefix, n) => [...Array(n)].map((_, i) => ({ dot: el.querySelector(`#${prefix}-dot${i}`), tag: el.querySelector(`#${prefix}-tag${i}`), lead: el.querySelector(`#${prefix}-ld${i}`), shelf: el.querySelector(`#${prefix}-sh${i}`) }));
const W3 = (x, y, z) => new THREE.Vector3(x, y, z);              // world point (mm)
const NM = (x, y, z) => new THREE.Vector3(x * 1e-6, y * 1e-6, z * 1e-6);   // forest point (nm → mm)

/* =====================================================================================================================
   TECHNIQUE C · the WebGL backdrop: EffectComposer = RenderPass → UnrealBloomPass → BokehPass → OutputPass.
     - preserveDrawingBuffer: true — the renderer screenshots the page after WebGL has presented;
     - pixel ratio 2 → every pass runs at 3840×2160 and the browser downsamples: clean edges, no MSAA needed;
     - ACES tone mapping is applied ONCE, by OutputPass, after bloom (bloom works on linear HDR, which is why
       threshold 1.3 separates the accent from everything else);
     - BokehPass: blur ∝ (focus − depth) × aperture in world units, so aperture = A / d makes the depth of field the
       same at 100 mm and at 100 nm; focus = d keeps the target sharp. Order bloom → bokeh: out-of-focus glows
       become soft discs, like a real lens.
   The micro-HUD (TECHNIQUE H) lives in the backdrop html: it belongs to the camera, not to any shot.
   ===================================================================================================================== */
const NICE = [1, 2, 5];
const fmtLen = (mm) => mm >= 1 ? `${+mm.toPrecision(3)} mm` : mm >= 1e-3 ? `${+(mm * 1e3).toPrecision(3)} µm` : `${+(mm * 1e6).toPrecision(3)} nm`;
const LAYER = (d) => d > 30 ? 'L0 · 主板 PCB' : d > 1.5 ? 'L1 · 芯片 DIE' : d > 2e-3 ? 'L2 · 金属互连' : 'L3 · 晶体管';
EX.backdrop({
  subject: true,
  html: `
    <div class="abs cx-micro" id="bd-layer" style="right:72px;top:96px;text-align:right">L0</div>
    <div class="abs" id="bd-hud" style="left:80px;top:842px">
      <svg width="300" height="20" style="display:block;overflow:visible"><path id="bd-bar" fill="none" stroke="${INK}" stroke-width="2"/></svg>
      <div class="cx-micro" id="bd-len" style="margin-top:8px">1 mm</div>
    </div>
    <div class="abs cx-micro" id="bd-field" style="right:80px;top:870px;text-align:right">视野</div>`,
  init(el) {
    const r = this.r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(2); r.setSize(1920, 1080);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px';
    el.prepend(r.domElement);
    scene.environment = new THREE.PMREMGenerator(r).fromScene(studio(), .03).texture;
    const c = this.composer = new EffectComposer(r);              // picks up the renderer's pixel ratio 2
    c.setSize(1920, 1080);
    c.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), .8, .4, 1.3);   // strength, radius, threshold
    c.addPass(this.bloom);
    this.bokeh = new BokehPass(scene, camera, { focus: 1, aperture: .01, maxblur: .008 });
    c.addPass(this.bokeh);
    c.addPass(new OutputPass());
    this.hud = { layer: el.querySelector('#bd-layer'), box: el.querySelector('#bd-hud'), bar: el.querySelector('#bd-bar'), len: el.querySelector('#bd-len'), field: el.querySelector('#bd-field') };
  },
  render(el, t) {
    setScene(t);
    const d = D.d;
    this.bokeh.uniforms.focus.value = d;
    this.bokeh.uniforms.aperture.value = (t < T.die || t > T.out ? .009 : .016) / d;
    this.composer.render();
    /* TECHNIQUE H · scale bar = the largest 1/2/5 × 10ⁿ length that fits 120–300 px at the focus distance */
    const mmPerPx = 2 * d * Math.tan(camera.fov * D2R / 2) / 1080;
    let L = 1e-9; for (let e = -9; e <= 3; e++) for (const n of NICE) { const v = n * 10 ** e; if (v / mmPerPx <= 300) L = v; }
    this.hud.bar.setAttribute('d', `M0 4 V16 M0 10 H${(L / mmPerPx).toFixed(1)} M${(L / mmPerPx).toFixed(1)} 4 V16`);
    this.hud.len.textContent = fmtLen(L);
    this.hud.field.textContent = `视野宽 ${fmtLen(mmPerPx * 1920)} · 示意`;
    this.hud.layer.textContent = LAYER(d);
    const o = smooth(T.die + .3, T.die + 1, t) * (1 - smooth(T.out - .3, T.out + .3, t));   // only in the HUD shots
    for (const e of [this.hud.layer, this.hud.box, this.hud.field]) { e.style.opacity = o; e.style.visibility = o <= 0 ? 'hidden' : ''; }
  },
});

/* one accent for every chapter: the caption 「keyword」, the hairline timeline and the meter knob all use it */
EX.chapter('die', { name: '芯片内部', color: ACCENT });
EX.chapter('fet', { name: '晶体管', color: ACCENT });
EX.chapter('bit', { name: '开与关', color: ACCENT });

/* =====================================================================================================================
   TECHNIQUE G · kinetic type. The title IS the frame: two lines of 170 px type rise out of masks letter by letter
   (riseChars), then the accent sweeps through the question (EX.sweep). The same layout returns in S5 with the answer.
   ===================================================================================================================== */
const heroLines = (prefix, a, b) => `
  <div class="cx-mask" style="left:50%;top:236px;transform:translateX(-50%)"><div class="cx-hero" id="${prefix}-l1">${a}</div></div>
  <div class="cx-mask" style="left:50%;top:438px;transform:translateX(-50%)"><div class="cx-hero glow" id="${prefix}-l2" style="color:${INK3}">${b}</div></div>`;

/* 1 · TITLE — the board in the dark, the question over it; at B(10) the camera starts its ramp into the die */
EX.shot({
  id: 'title', chapter: null, dur: DUR.title, hud: false, enter: 'cut', meter: meterOf('title'),
  caps: [[.6, '手机主板中央，有一块 SoC。'], [4.2, '指甲盖大小，却是一整台电脑。']],
  sfx: [[.3, 'reveal', .4], [1.9, 'chime', .35]],
  html: heroLines('ti', '一块芯片里', '有什么') + `
    <div class="abs cx-micro" style="left:50%;top:652px;transform:translateX(-50%)" id="ti-sub">SOC · SYSTEM ON A CHIP · 示意</div>`,
  init(el) { this.l1 = el.querySelector('#ti-l1'); this.l2 = el.querySelector('#ti-l2'); this.sub = el.querySelector('#ti-sub'); splitChars(this.l1); splitChars(this.l2); },
  render(el, u) {
    riseChars(this.l1, u, .2, { stagger: .07, b: B(10) - .2 });
    riseChars(this.l2, u, .75, { stagger: .09, b: B(10) });
    EX.sweep(this.l2, u, B(3), B(5), ACCENT, INK3);               // the question lights up on beats 3–5
    EX.fadeUp(this.sub, u, 1.6, B(10) + .3);
  },
});

/* 2 · DIE — the ramp lands on the floorplan; CPU, GPU, NPU light up on beats; a door marks where we dive next */
const P2 = [
  { micro: '6 核 · 2 性能 + 4 能效', name: 'CPU 处理器' },
  { micro: '6 核 · 画面', name: 'GPU 图形' },
  { micro: '16 核 · 神经网络引擎', name: 'NPU AI 引擎' },
];
const blockOf = (kind) => blocks.find((b) => b.kind === kind);
EX.shot({
  id: 'die', chapter: 'die', dur: DUR.die, enter: 'cut', meter: meterOf('die'),
  caps: [[.3, '芯片里面，分成很多「功能区」。'], [3.7, '算逻辑、画画面、跑 AI，各有分工。']],
  sfx: [[LIT.cpu, 'blip', .45], [LIT.gpu, 'blip', .45], [LIT.npu, 'blip', .45], [B(11), 'tick', .4]],
  html: pinsHTML('di', P2) + `
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080"><path id="di-door" fill="none" stroke="${ACCENT}" stroke-width="2.5"/></svg>
    <div class="abs cx-micro" id="di-door-l" style="color:${ACCENT}">放大 ×10,000 ↓ 金属互连</div>
    <div class="abs cx-micro" id="di-note" style="left:80px;top:196px">以 A17 PRO 为例 · DIE ≈ 10 × 10 mm · 布局示意</div>`,
  init(el) { this.pins = pinsOf(el, 'di', 3); this.door = el.querySelector('#di-door'); this.doorL = el.querySelector('#di-door-l'); this.note = el.querySelector('#di-note'); },
  render(el, u, d, t) {
    setScene(t);
    const out = 1 - smooth(DUR.die - B(3), DUR.die - B(2), u);   // every label leaves before the dive starts
    const cpu = blockOf('cpu'), gpu = blockOf('gpu'), npu = blockOf('npu');
    pin(this.pins[0], W3(cpu.cx - cpu.w * .3, 0, cpu.cz + cpu.d * .25), [-230, 40], clamp((u - LIT.cpu - .1) / .5) * out);
    pin(this.pins[1], W3(gpu.cx - gpu.w * .1, 0, gpu.cz + gpu.d * .1), [-160, 120], clamp((u - LIT.gpu - .1) / .5) * out);
    pin(this.pins[2], W3(npu.cx + npu.w * .1, 0, npu.cz + npu.d * .2), [190, 120], clamp((u - LIT.npu - .1) / .5) * out);
    /* the door: a bracket around the wiring patch above O (±0.43 mm), 0.6 s before the dive, then it zooms with us */
    const k = smooth(B(11), B(11) + .25, u) * (1 - smooth(DUR.die + .2, DUR.die + .6, u));
    const c = [[-.43, -.43], [.43, -.43], [.43, .43], [-.43, .43]].map(([x, z]) => project(W3(x, .07, z)));
    const xs = c.map((q) => q[0]), ys = c.map((q) => q[1]), x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, y0 = Math.min(...ys) - 10, y1 = Math.max(...ys) + 10, b = Math.min(28, (x1 - x0) / 3);
    this.door.setAttribute('d', `M${x0} ${y0 + b}V${y0}H${x0 + b}M${x1 - b} ${y0}H${x1}V${y0 + b}M${x1} ${y1 - b}V${y1}H${x1 - b}M${x0 + b} ${y1}H${x0}V${y1 - b}`);
    this.door.style.opacity = k;
    EX.place(this.doorL, x1 + 20 + this.doorL.offsetWidth / 2, (y0 + y1) / 2, 1, k * (1 - smooth(DUR.die - .9, DUR.die - .5, u)));
    EX.fadeUp(this.note, u, B(3), DUR.die - B(3));
  },
});

/* 3 · FOREST — falling through the wiring into a city of transistors; the count is the frame */
EX.shot({
  id: 'fet', chapter: 'fet', dur: DUR.fet, enter: 'cut', meter: meterOf('fet'),
  caps: [[.4, '再往下，是一片「晶体管」森林。'], [3.9, '一块手机芯片，上百亿个。']],
  sfx: [[B(3), 'reveal', .5], [B(5), 'chime', .45]],
  html: pinsHTML('fe', [{ micro: 'TRANSISTOR · FINFET', name: '一个晶体管' }]) + `
    <div id="fe-type" class="abs" style="left:0;top:0;width:1920px;height:1080px;transform-origin:960px 470px">
      <div class="cx-mask" style="left:50%;top:268px;transform:translateX(-50%)"><div class="cx-hero glow" id="fe-big" style="font-size:300px;color:${INK3}">上百亿</div></div>
      <div class="cx-rule" id="fe-rule" style="left:660px;top:700px;width:600px"></div>
      <div class="abs cx-micro data" id="fe-sub" style="left:660px;top:718px">以 A17 PRO 为例 · 约 190 亿个 · APPLE 2023</div>
    </div>`,
  init(el) { this.pins = pinsOf(el, 'fe', 1); this.type = el.querySelector('#fe-type'); this.big = el.querySelector('#fe-big'); this.rule = el.querySelector('#fe-rule'); this.sub = el.querySelector('#fe-sub'); splitChars(this.big); },
  render(el, u, d, t) {
    setScene(t);
    riseChars(this.big, u, B(3), { stagger: .12, dur: .7 });
    EX.sweep(this.big, u, B(5), B(7), ACCENT, INK3);
    this.rule.style.transform = `scaleX(${expoOut(clamp((u - B(5)) / .8))})`;
    EX.fadeUp(this.sub, u, B(6));
    /* exit: the word flies past the lens as the camera pushes into T0 (scale up + fade, done before the cut) */
    const x = clamp((u - (DUR.fet - B(1) - .1)) / .5);
    this.type.style.transform = `scale(${1 + 5 * x * x})`; this.type.style.opacity = 1 - x;
    this.type.style.visibility = x >= 1 ? 'hidden' : '';
    pin(this.pins[0], NM(0, 85, 0), [380, -40], clamp((u - B(8)) / .5) * (1 - smooth(DUR.fet - B(2), DUR.fet - B(1) - .2, u)));
  },
});

/* 4 · SWITCH — one transistor alone: gate on = current = 1, gate off = 0. The digit is an odometer. */
const P4 = [{ micro: 'GATE', name: '栅极' }, { micro: 'SOURCE', name: '源极' }, { micro: 'DRAIN', name: '漏极' }];
const FLIPS = [[0, 0], [B(3), 1], [B(8), 0], [B(12), 1]];          // [S4 local time, bit]
EX.shot({
  id: 'bit', chapter: 'bit', dur: DUR.bit, enter: 'cut', meter: meterOf('bit'),
  caps: [[B(3), '「栅极」通电，电流流过：1。'], [B(8), '断电，电流截止：0。']],
  sfx: [[B(3), 'snap', .5], [B(8), 'thud', .5], [B(12), 'snap', .5], [B(13), 'whoosh', .45]],
  html: pinsHTML('bi', P4) + `
    <div class="abs" style="left:150px;top:300px;width:330px;height:380px;overflow:hidden">
      <div class="cx-hero glow cx-mono" id="bi-a" style="left:0;top:0;width:330px;text-align:center;font-weight:700;font-size:340px;line-height:380px">0</div>
      <div class="cx-hero glow cx-mono" id="bi-b" style="left:0;top:0;width:330px;text-align:center;font-weight:700;font-size:340px;line-height:380px">1</div>
    </div>
    <div class="cx-rule" style="left:170px;top:700px;width:290px" id="bi-rule"></div>
    <div class="abs cx-micro data" id="bi-v" style="left:170px;top:716px">V GATE ≈ 0.7 V · 示意</div>`,
  init(el) { this.pins = pinsOf(el, 'bi', 3); this.a = el.querySelector('#bi-a'); this.b = el.querySelector('#bi-b'); this.v = el.querySelector('#bi-v'); this.rule = el.querySelector('#bi-rule'); },
  render(el, u, d, t) {
    setScene(t);
    const show = smooth(B(2), B(2) + .4, u) * (1 - smooth(B(13) - .3, B(13), u));
    /* odometer: the last flip at or before u; old digit rolls up and out, new one rolls up in (expoOut, .35 s) */
    let i = 0; for (let k = 0; k < FLIPS.length; k++) if (u >= FLIPS[k][0]) i = k;
    const [tf, bit] = FLIPS[i], prev = i > 0 ? FLIPS[i - 1][1] : bit, q = i > 0 ? expoOut(clamp((u - tf) / .35)) : 1;
    const style = (e, b, y, o) => { e.textContent = String(b); e.style.color = b ? ACCENT : INK3; e.style.transform = `translateY(${y}px)`;
      e.style.opacity = o; e.style.visibility = o <= 0 ? 'hidden' : ''; };
    /* the outgoing digit also fades: a glyph clipped by its mask is still "on screen" to --lint (OFFSCREEN / UNDER-HUD) */
    style(this.a, prev, -380 * q, show * (1 - q)); style(this.b, bit, 380 * (1 - q), show);
    this.v.textContent = bit ? 'V GATE ≈ 0.7 V · 示意' : 'V GATE = 0 V · 示意';
    for (const e of [this.v, this.rule]) { e.style.opacity = show; e.style.visibility = show <= 0 ? 'hidden' : ''; }
    this.rule.style.transform = `scaleX(${expoOut(clamp((u - B(2)) / .8))})`;
    const o = (a) => clamp((u - a) / .5) * (1 - smooth(B(13) - .4, B(13) - .1, u));
    pin(this.pins[0], NM(0, 86, 0), [190, -110], o(B(3)));
    pin(this.pins[1], NM(-75, 42, 0), [40, 170], o(B(4)));          // below-right: the orbit swings it towards the digit
    pin(this.pins[2], NM(75, 42, 0), [170, 140], o(B(5)));
  },
});

/* 5 · OUT — the pull-back ramps out through every layer to the whole chip, now glowing; the title returns answered */
EX.shot({
  id: 'out', chapter: null, dur: DUR.out, hud: false, enter: 'cut',
  caps: [[.4, '上百亿个开关，每秒翻转几十亿次。'], [4.3, '一切计算，都由开与关组成。']],
  sfx: [[B(5), 'reveal', .45], [B(7), 'chime', .4]],
  html: heroLines('ou', '一块芯片里', '上百亿个开关'),
  init(el) { this.l1 = el.querySelector('#ou-l1'); this.l2 = el.querySelector('#ou-l2'); splitChars(this.l1); splitChars(this.l2); },
  render(el, u) {
    riseChars(this.l1, u, B(5), { stagger: .07 });
    riseChars(this.l2, u, B(5) + .4, { stagger: .08 });
    EX.sweep(this.l2, u, B(7), B(9), ACCENT, INK3);
  },
});

EX.run({
  theme: 'dark', chrome: 'cinema', post: { vignette: .45, grain: 6 }, mood: 'pulse',
  meter: { label: '放大', unit: '个数量级', decimals: 1, max: 6, ticks: [] },   // ticks would print 「2个数量级」 under a hairline
});
