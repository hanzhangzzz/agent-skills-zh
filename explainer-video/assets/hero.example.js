/* hero.example.js — 「一爆」 · a 9 s macro shot of a coffee bean's first crack, as ONE EX.shot in cinema mode.
   Setup: cp hero.example.js shots.js (an ES module; cinema3d.js and tex/ sit next to it after init.sh), then
   `bash <skill>/scripts/fonts.sh .` (it fetches Inter Tight for the big number), then render.mjs as usual (stills first:
   each frame is heavy, ~2 s; use --workers 2 on a shared machine).
   This is the bar for 3D 电影模式 with real photographic craft: cinema3d.js = lens + post chain + lights + particles.

   FRAMEWORK vs STANDALONE: it runs inside the framework, nothing is blocked. The WebGL canvas is EX.backdrop({ subject:true });
   cine.render() draws the finished frame (2x supersampling, DOF, bloom, haze, CA, grade, ACES, grain) straight into that
   canvas, so the framework only adds DOM on top: the temperature readout (in the shot's html) and one caption.
   Constraint: the film is this one shot (hud:false), because the backdrop is one persistent scene.

   ┌─ ART DIRECTION ──────────────────────────────────────────────────────────────────────────────────────────────┐
   │ style     a macro film in the roasting drum, 100 mm lens, high-speed camera (time slowed to .22x at the crack)│
   │ palette   one key lamp (warm white) · burner orange rim and bokeh · bean roast ramp green→yellow→brown→dark  │
   │ materials plano-convex bean with a silverskin centre cut (procedural bump/mottling), steel drum (CC0 maps)   │
   │ lens/post f/2.8 depth of field, HDR bloom, heat haze, chromatic aberration, teal shadows, ACES, grain        │
   │ motion    all closed-form in t: time warp tau(t), push-in speed ramp, rack focus, crack impulse kick(t)      │
   │ chrome    theme dark + chrome cinema, hud:false, one caption                                                 │
   └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   Facts: first crack ≈ 196 °C (a pop: steam and CO₂ burst out, the bean swells ~15-20 %, silverskin flakes off).
   示意: bean size, roast colour ramp, time-slow factor, spark/steam amounts.

   Textures: tex/metal_plate_02_*_1k.jpg — Poly Haven "Metal Plate 02" by Rob Tuytel, CC0 (https://polyhaven.com/a/metal_plate_02),
   downscaled from 2k to 1k (0.66 MB total; the drum is far behind the focus plane, so the loss does not show).
   three.js (MIT); GLSL simplex noise by Ashima Arts (MIT). */
import * as THREE from 'three';
import { makeCinema, lightRig, studioEnv, timewarp, loadTex, makeSparks, makeFlakes, makePuffs, makeDust, ballistic, NOISE, BUMP, rng, clamp, lerp, sstep, ease } from './cinema3d.js';

const W = 1920, H = 1080, SS = 2, DUR = 9.0, TC = 6.2;           // TC = crack moment (real seconds)
const ACC = '#FFB36B';

/* ---------------- time warp: high-speed-camera feel, slower still around the crack ---------------- */
const rate = (t) => lerp(.55, .22, sstep(4.9, 6.1, t)) + .18 * sstep(6.25, 8.6, t);
const tau = timewarp(rate, DUR);
const TAUC = tau(TC);

/* ---------------- temperature and roast ---------------- */
function tempAt(t) {                                             // °C, 100 → 196 at the crack → 201
  if (t < TC) { const u = t / TC; return 100 + 96 * (1 - Math.pow(1 - u, 1.7)) ; }
  return 196 + 5 * (1 - Math.exp(-(t - TC) / 2.2)) / (1 - Math.exp(-(DUR - TC) / 2.2));
}
function roastOf(T) {                                            // 0 green · .3 yellow · .55 cinnamon · .8 brown · 1 dark
  const k = [[100, 0], [128, .1], [150, .3], [170, .52], [185, .72], [196, .86], [204, .95]];
  for (let i = 1; i < k.length; i++) if (T <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (T - k[i - 1][0]) / (k[i][0] - k[i - 1][0]));
  return .95;
}
/* ---------------- scene and lens (the renderer is made in the backdrop's init) ---------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(13.7, W / H, 4, 3000);   // 100 mm macro on full frame

/* ---------------- the bean: plano-convex ellipsoid with an S-shaped centre cut ---------------- */
// Real arabica: ~11 × 8 × 5 mm green, ~15–20 % larger after first crack. Long axis X, flat face +Z (the crease side).
const A = 5.6, B = 4.0, CF = 1.35, CB = 3.0;
const creaseY = (x) => .42 * Math.sin(Math.PI * x / A * .95) - .1 * Math.sin(2 * Math.PI * x / A);  // S-curve (mm)
function beanGeometry(lon, lat, seed, creaseW) {
  const g = new THREE.SphereGeometry(1, lon, lat);
  g.rotateZ(-Math.PI / 2);                                       // poles to ±X so rings wrap the cross-section
  const p = g.attributes.position, n = p.count, R = rng(seed);
  const crease = new Float32Array(n), side = new Float32Array(n);
  const ph = [R() * 6, R() * 6, R() * 6], asym = .06 + .05 * R();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i);
    const ux = v.x, uy = v.y, uz = v.z;
    let x = A * ux, y = B * uy;
    let z = uz > 0 ? CF * Math.pow(uz, .85) : CB * uz;           // flat front, domed back
    // the front face's rim rolls over (the bean is folded seed tissue): lift the rim slightly
    const rr = Math.hypot(ux, uy);
    if (uz > 0) z += .35 * sstep(.55, .95, rr) * Math.sqrt(Math.max(0, uz)) * (1 - rr * .4);
    // organic asymmetry and a slight kidney bend along the length
    y += asym * B * Math.sin(ux * 2.1 + ph[0]) * (1 - ux * ux);
    z += -.45 * (1 - ux * ux) * 0 + .35 * (ux * ux - .33);
    x *= 1 + .03 * Math.sin(uy * 3 + ph[1]);
    // centre cut: narrow groove with rolled lips, only on the front face, fading out at the tips
    const dy = y - creaseY(x);
    const along = 1 - sstep(.72, .97, Math.abs(ux));
    const front = sstep(.05, .45, uz);
    const w = creaseW;
    const gro = Math.exp(-((dy / w) ** 2)), lip = Math.exp(-((dy / (2.6 * w)) ** 2));
    const k = along * front;
    z += k * (-1.35 * gro + .18 * lip);
    crease[i] = k * gro; side[i] = Math.sign(dy) || 1;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  g.setAttribute('aCrease', new THREE.BufferAttribute(crease, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  return g;
}

const beanU = {
  uRoast: { value: 0 }, uCrack: { value: 0 }, uGlow: { value: 0 }, uSwell: { value: 1 }, uOil: { value: 0 },
};
function beanMaterial(hero) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: .62, metalness: 0, clearcoat: .0, clearcoatRoughness: .32,
    sheen: .6, sheenRoughness: .55, sheenColor: new THREE.Color(0x8a7f60), envMapIntensity: .4,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, beanU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aCrease; attribute float aSide; ${hero ? '' : 'attribute vec3 aVar;'}
        uniform float uCrack, uSwell; varying vec3 vObj; varying float vCrease; varying vec3 vVar;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObj = position; vCrease = aCrease; vVar = ${hero ? 'vec3(0., .5, .3)' : 'aVar'};
        // first crack: the centre cut splits open, the two lobes part, the bean has swollen
        float frontW = smoothstep(-.2, 1.2, position.z);
        float jag = .55 + .9 * smoothstep(-.4, .7, sin(position.x*2.3 + 1.) * .6 + sin(position.x*7.1) * .4);
        transformed.y += aSide * uCrack * jag * (.06 * frontW + .17 * aCrease);
        transformed.z -= uCrack * .35 * aCrease * jag;
        transformed *= uSwell;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRoast, uGlow, uOil, uCrack; varying vec3 vObj; varying float vCrease; varying vec3 vVar;
        ${NOISE}
        vec3 roastRamp(float r){
          vec3 c0=vec3(104.,118.,84.)/255., c1=vec3(192.,170.,108.)/255., c2=vec3(168.,104.,58.)/255., c3=vec3(112.,66.,40.)/255., c4=vec3(80.,46.,28.)/255., c5=vec3(58.,34.,21.)/255.;
          vec3 c = mix(c0,c1,smoothstep(0.,.3,r)); c = mix(c,c2,smoothstep(.3,.55,r)); c = mix(c,c3,smoothstep(.55,.78,r));
          c = mix(c,c4,smoothstep(.78,.9,r)); c = mix(c,c5,smoothstep(.9,1.05,r)); return pow(c, vec3(2.2)); }
        float beanH(vec3 p, float r){
          // wrinkles run along the bean's length; they relax as the bean swells in the roast
          vec3 q = p*vec3(2.2,3.6,3.6) + vVar.y*7.; q += .6*vec3(snoise(q*.7), snoise(q*.7+4.), snoise(q*.7+9.));
          float rid = 0., a = .5; for (int i = 0; i < 4; i++) { rid += a * (1. - abs(snoise(q))); q = q*2.1 + 3.3; a *= .5; }
          float wr = (rid - .5) * (.013 - .006*smoothstep(.2,.8,r)) + fbm(p*vec3(1.2,5.,5.))*.006;
          float sm = 1. - .5*smoothstep(.4,.9,r);
          float pores = (snoise(p*28.) * .0007 + snoise(p*8.) * .0035 + snoise(p*vec3(2.5,12.,12.))*.003) * sm + snoise(p*1.3)*.018;
          return wr + pores; }
        ${BUMP}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float r = clamp(uRoast + (vVar.x - .5) * .10, 0., 1.05);
        float mott = fbm(vObj*.55 + vVar.y*13.);
        float edge = smoothstep(.55, 1., length(vObj.xy / vec2(5.6, 4.0)));
        float rl = clamp(r + mott*.07 + edge*.06*smoothstep(.1,.6,r), 0., 1.1);
        vec3 body = roastRamp(rl);
        body *= .9 + .2*snoise(vObj*4.0);                       // fine speckle
        // the centre cut keeps its silverskin: pale, papery, barely darkens
        vec3 skin = pow(mix(vec3(.80,.76,.60), vec3(.70,.55,.38), smoothstep(.35,1.,r)), vec3(2.2));
        float cr = smoothstep(.12, .6, vCrease) * (1. - smoothstep(.75, .98, vCrease));
        float skinMask = cr * smoothstep(-.35, .5, snoise(vObj*vec3(1.1,1.4,1.4) + 3.));
        body = mix(body, skin, skinMask * ${hero ? '.8' : '.35'} * (1. - .75*uCrack));
        body *= mix(1., .45, uCrack * smoothstep(.2, .7, vCrease));
        body *= mix(1., .22, smoothstep(.55, 1., vCrease));
        diffuseColor.rgb = body;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(.72, .34, smoothstep(.45, .95, uRoast)) + .07*snoise(vObj*6.);
        roughnessFactor = mix(roughnessFactor, .82, cr);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = perturbN(-vViewPosition, normal, beanH(vObj, uRoast) * (1. - cr*.6), faceDirection);`)
      .replace('#include <clearcoat_normal_fragment_maps>', '')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // the split glows from inside for an instant: hot gas and fresh, lighter tissue
        totalEmissiveRadiance += vec3(1.0,.36,.08) * uGlow * smoothstep(.8,.99,vCrease) * (.6 + .6*snoise(vObj*vec3(4.,1.,1.)));`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <clearcoat_pars_fragment>', '#include <clearcoat_pars_fragment>');
  };
  m.customProgramCacheKey = () => (hero ? 'beanHero' : 'beanCrowd');
  return m;
}
// clearcoat normal include is referenced only when clearcoat is on; keep a valid normal for it
const heroGeo = beanGeometry(900, 520, 7, .26);
const hero = new THREE.Mesh(heroGeo, beanMaterial(true));
hero.castShadow = hero.receiveShadow = true;
hero.material.clearcoat = .01;
scene.add(hero);
/* ---------------- the crowd: a slow-motion cascade, a sliding bed, a few close passers ---------------- */
const crowdGeo = beanGeometry(110, 72, 11, .30);
const NC = 420;
const crowd = new THREE.InstancedMesh(crowdGeo, beanMaterial(false), NC);
crowd.castShadow = true; crowd.receiveShadow = true;
const aVar = new Float32Array(NC * 3);
const CROWD = [];
{
  const R = rng(42);
  for (let i = 0; i < NC; i++) {
    const kind = i < 170 ? 'fall' : i < 410 ? 'bed' : 'near';
    CROWD.push({ kind, x: R(), y: R(), z: R(), ph: R(), sc: .86 + .28 * R(), ax: new THREE.Vector3(R() - .5, R() - .5, R() - .5).normalize(), w: .6 + 1.6 * R(), r0: R() * 6.28 });
    aVar[i * 3] = R(); aVar[i * 3 + 1] = R(); aVar[i * 3 + 2] = R();
  }
}
crowdGeo.setAttribute('aVar', new THREE.InstancedBufferAttribute(aVar, 3));
scene.add(crowd);
/* ---------------- the drum: rotating steel wall + vanes, back plate with the glowing hot-air inlet ---------------- */
const TEXP = 'tex/metal_plate_02_';
const metalD = loadTex(TEXP + 'diff_1k.jpg', { srgb: true, repeat: [5, 2] }), metalN = loadTex(TEXP + 'nor_gl_1k.jpg', { repeat: [5, 2] }), metalR = loadTex(TEXP + 'rough_1k.jpg', { repeat: [5, 2] });
const steel = new THREE.MeshStandardMaterial({ map: metalD, normalMap: metalN, roughnessMap: metalR, metalness: .85, roughness: 1, color: 0x6a5a4c, envMapIntensity: .9, side: THREE.BackSide });
const DRUM_R = 190, DRUM_Y = 70;
const drum = new THREE.Group(); drum.position.set(0, DRUM_Y, 0); scene.add(drum);
const wall = new THREE.Mesh(new THREE.CylinderGeometry(DRUM_R, DRUM_R, 900, 128, 1, true), steel);
wall.rotation.x = Math.PI / 2; wall.position.z = -200; wall.receiveShadow = true; drum.add(wall);
const vaneMat = new THREE.MeshStandardMaterial({ map: metalD, normalMap: metalN, roughnessMap: metalR, metalness: .9, roughness: 1, color: 0x4a4038, envMapIntensity: .5 });
for (let k = 0; k < 0; k++) {
  const v = new THREE.Mesh(new THREE.BoxGeometry(70, 3, 640), vaneMat);
  const a = k * Math.PI / 2;
  v.position.set(Math.cos(a) * (DRUM_R - 34), Math.sin(a) * (DRUM_R - 34), -260);
  v.rotation.z = a + .35; v.castShadow = v.receiveShadow = true; drum.add(v);
}
// back plate with a perforated hot-air inlet: each hole is a small HDR emitter → defocused into bokeh discs
const plateZ = -560;
const plate = new THREE.Mesh(new THREE.CircleGeometry(DRUM_R + 5, 96), new THREE.MeshStandardMaterial({ map: metalD, normalMap: metalN, roughnessMap: metalR, metalness: .85, roughness: 1, color: 0x504236, envMapIntensity: .8 }));
plate.position.set(0, DRUM_Y, plateZ); plate.receiveShadow = true; scene.add(plate);
const INLET = new THREE.Vector3(70, 52, plateZ + 1);
const holeMat = new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uHeat: { value: 1 } },
  vertexShader: `attribute vec3 aH; varying vec3 vH; void main(){ vH = aH; vec4 p = instanceMatrix * vec4(position,1.); gl_Position = projectionMatrix * modelViewMatrix * p; }`,
  fragmentShader: `uniform float uT, uHeat; varying vec3 vH;
    void main(){ float fl = .75 + .25*sin(uT*(3.+vH.y*5.) + vH.z*40.);
      vec3 c = mix(vec3(1.,.28,.05), vec3(1.,.62,.25), vH.x) * (2.2 + 9.*vH.x*vH.x) * fl * uHeat; gl_FragColor = vec4(c, 1.); }`,
});
const holes = [];
{ const R = rng(5); const pitch = 11;
  for (let iy = -9; iy <= 9; iy++) for (let ix = -9; ix <= 9; ix++) {
    const x = (ix + (iy & 1) * .5) * pitch, y = iy * pitch * .866, d = Math.hypot(x, y) / 50;
    if (d > 1) continue;
    holes.push([x, y, Math.pow(1 - d, 1.3) * (.35 + .65 * R() * R()), R(), R()]);
  } }
const holeMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1.7, 20), holeMat, holes.length);
{ const m = new THREE.Matrix4(), aH = new Float32Array(holes.length * 3);
  holes.forEach((h, i) => { m.makeTranslation(INLET.x + h[0], INLET.y + h[1], INLET.z); holeMesh.setMatrixAt(i, m); aH.set([h[2], h[3], h[4]], i * 3); });
  holeMesh.geometry.setAttribute('aH', new THREE.InstancedBufferAttribute(aH, 3)); }
scene.add(holeMesh);
// the glow of the burner on the plate around the inlet
const inletGlow = new THREE.Mesh(new THREE.CircleGeometry(150, 64), new THREE.ShaderMaterial({
  uniforms: { uHeat: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vU; void main(){ vU = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform float uHeat; varying vec2 vU; void main(){ float d = length(vU)/150.; gl_FragColor = vec4(vec3(1.,.32,.07) * (pow(1.-d, 3.) * .35 + exp(-d*d*30.)*1.1) * uHeat, 1.); }`,
}));
inletGlow.position.copy(INLET).add(new THREE.Vector3(0, 0, 1)); scene.add(inletGlow);

/* ---------------- lights: sight-glass lamp (key), burner (rim), cool spill (back), the crack flash ---------------- */
const rig = lightRig(scene, { practical: { pos: [INLET.x, INLET.y, INLET.z + 40] } });
const { key, rim, flash } = rig;

/* ---------------- volumetric beam of the lamp (a cone of lit haze) and dust in it ---------------- */
const beam = new THREE.Mesh(new THREE.ConeGeometry(70, 520, 48, 1, true), new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uA: { value: .03 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 w = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float uT, uA; varying vec3 vP; varying vec3 vN; varying vec3 vV; ${NOISE}
    void main(){ float along = (260. - vP.y)/520.; float f = pow(abs(dot(vN, vV)), 2.2);
      float n = .6 + .5*fbm(vec3(vP.xz*.02, vP.y*.006 - uT*.15));
      gl_FragColor = vec4(vec3(1.,.82,.6) * uA * f * n * smoothstep(0.,.25,along) * (1.-smoothstep(.75,1.,along)), 1.); }`,
}));
beam.position.copy(key.position).lerp(new THREE.Vector3(0, 0, 0), .5);
beam.lookAt(0, 0, 0); beam.rotateX(-Math.PI / 2);                // cone axis (−Y) from the lamp to the bean
scene.add(beam);

/* ---------------- particles: chaff, steam, sparks, dust (cinema3d.js builds them; the tables below are the look) ---------------- */
const NF = 140;
const flakes = makeFlakes(scene, NF);
const FL = []; { const R = rng(77); for (let i = 0; i < NF; i++) FL.push({ burst: i >= 110, x: R(), y: R(), z: R(), ph: R(), s: .5 + R() * 1.3, ax: new THREE.Vector3(R() - .5, R() - .5, R() - .5).normalize(), w: 1 + R() * 3, d: new THREE.Vector3(R() - .5, R() * .8 - .1, (R() - .5) * .25).normalize(), sp: 10 + R() * 22 }); }
const NP = 160;
const puffs = makePuffs(scene, NP);
const PF = []; { const R = rng(31); for (let i = 0; i < NP; i++) PF.push({ kind: i < 40 ? 'amb' : i < 70 ? 'wisp' : i < 115 ? 'burst' : 'none', a: R(), b: R(), c: R(), d: R(), e: R() }); }
const NS = 320;
const sparks = makeSparks(scene, NS, { w: W, h: H });
const SP = []; { const R = rng(1234); for (let i = 0; i < NS; i++) SP.push({ u: R() * 2 - 1, dir: new THREE.Vector3(R() * 2 - 1, R() * 2 - .7, .15 + R() * .5).normalize(), sp: 18 + 120 * Math.pow(R(), 2.2), life: .2 + 1.2 * Math.pow(R(), 1.5), delay: Math.pow(R(), 2) * .35, w: .5 + 1.4 * Math.pow(R(), 2), hot: .35 + R() }); }
const ND = 700;
const dust = makeDust(scene, ND, { h: H, ss: SS });
const DU = []; { const R = rng(55); for (let i = 0; i < ND; i++) DU.push([R(), R(), R(), R()]); }

/* ---------------- choreography ---------------- */
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0), Xa = new THREE.Vector3(1, 0, 0);
const kick = (t) => (t < TC ? 0 : Math.exp(-(t - TC) / .55));      // the pop's decaying impulse

function heroPose(t) {
  const s = tau(t) - TAUC;                                         // scene seconds from the crack
  // lofted by the vane: a slow arc through frame; the pop knocks it up and sideways
  const pos = new THREE.Vector3(1.2 * s, -1.6 * s - .55 * s * s * (s > 0 ? .2 : 1), -.6 * s);
  const tr = sstep(TC - .7, TC - .02, t) * (t < TC ? 1 : 0) * .07;
  pos.x += tr * Math.sin(t * 97); pos.y += tr * Math.sin(t * 83 + 1);
  if (t > TC) { const k = 1 - kick(t); pos.add(new THREE.Vector3(-1.1 * k, 1.3 * k, .5 * k)); }
  // orientation: rolls about its long axis so the centre cut turns to the lens by the crack, slowly yawing
  const roll = -Math.PI * .92 * (1 - ease(sstep(1.9, 4.6, t))) + .12 * s + (t > TC ? .5 * (1 - kick(t)) : 0);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.38 + roll, .32 + .12 * s, -.32 + .05 * s, 'XYZ'));
  return { pos, q };
}

function cameraAt(t) {
  // distance: a slow creep while focus racks to the bean, a speed-ramped push, a held breath, a recoil, a drift back
  const push = ease(sstep(1.5, 3.8, t));                           // the speed ramp: 2.3 s, peak ≈ 100 mm/s
  let d = 262 - 26 * sstep(0, 1.6, t) - 126 * push - 24 * sstep(3.6, 6.15, t);
  d += 7 * (t > TC ? (1 - Math.exp(-(t - TC) / .12)) * Math.exp(-(t - TC) / 1.6) : 0) + 14 * sstep(6.5, 9, t);
  const az = lerp(-.3, .05, ease(sstep(0, 6.2, t))) + .3 * sstep(6.3, 9, t);
  const el = lerp(.03, .08, ease(sstep(0, 6.2, t))) + .04 * sstep(6.3, 9, t);
  const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
  const tgt = heroPose(t).pos.clone().addScaledVector(right, -.050 * d).add(new THREE.Vector3(0, -.012 * d, 0));
  const eye = tgt.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d));
  // handheld breath + the crack's punch (deterministic)
  const sh = (t > TC ? Math.exp(-(t - TC) / .18) : 0) * 1.2;
  const br = .12;
  eye.x += br * Math.sin(t * 1.3) + sh * Math.sin(t * 61); eye.y += br * Math.sin(t * 1.7 + 2) + sh * Math.sin(t * 53 + 1);
  const rk = ease(sstep(.1, 1.15, t)); const focus = lerp(560, 0, rk) + eye.distanceTo(heroPose(t).pos) * rk;
  return { eye, tgt, focus, d };
}

function updateCrowd(t) {
  const s = tau(t), R = DRUM_R;
  for (let i = 0; i < NC; i++) {
    const c = CROWD[i];
    if (c.kind === 'fall') {                                        // curtain falling off the vane behind the hero
      const z = -70 - 380 * c.z, L = 230, v = 26 + 10 * c.y;
      const y = 115 - ((s * v + c.ph * L) % L);
      const x = lerp(-150, 170, c.x) + .12 * (95 - y) + 6 * Math.sin(s * .7 + c.ph * 9);
      tmpP.set(x, y, z);
      if (Math.abs(x) < 22 && z > -110) tmpP.set(9999, 0, 0);     // keep the air around the hero clear
    } else if (c.kind === 'bed') {                                  // the bed sliding down the drum wall
      const x = lerp(-170, 170, c.x), z = -20 - 380 * c.z;
      const u = ((c.ph + s * .03) % 1);
      const ang = -Math.PI / 2 - .55 + 1.0 * u;                      // around the drum bottom
      tmpP.set(x + 40 * u, DRUM_Y + Math.sin(ang) * (R - 6 - 9 * c.y), z + Math.cos(ang) * 30);
    } else {                                                          // close passers between lens and bean
      const k = i - 410;
      if (k === 0) {
        const tA = 1.2, ce = cameraAt(tA), sA = tau(tA);
        const fwd = ce.tgt.clone().sub(ce.eye).normalize(), rt = new THREE.Vector3().crossVectors(fwd, Y).normalize();
        const p0 = ce.eye.clone().addScaledVector(fwd, ce.d * .42);
        tmpP.copy(p0).addScaledVector(rt, -30 + 42 * (s - sA)).addScaledVector(Y, 5 - 7 * (s - sA));
      } else tmpP.set(9999, 0, 0);
    }
    tmpQ.setFromAxisAngle(c.ax, c.r0 + s * c.w);
    tmpS.setScalar(c.sc * lerp(1, 1.16, sstep(.3, .9, beanU.uRoast.value)));
    tmpM.compose(tmpP, tmpQ, tmpS); crowd.setMatrixAt(i, tmpM);
  }
  crowd.instanceMatrix.needsUpdate = true;
}

function updateFlakes(t, hp) {
  const s = tau(t);
  for (let i = 0; i < NF; i++) {
    const f = FL[i];
    if (!f.burst) {                                                   // drifting silverskin in the drum air
      const L = 140, y = 70 - ((s * (8 + 10 * f.y) + f.ph * L) % L);
      tmpP.set(lerp(-60, 70, f.x) + 8 * Math.sin(s * .6 + f.ph * 7), y, lerp(-160, 60, f.z));
      tmpS.setScalar(f.s * 1.4);
    } else {                                                          // blown off the bean by the crack
      const a = (s - TAUC) - f.ph * .04;
      if (a < 0) { tmpP.set(9999, 0, 0); } else {
        const fr = 1 - Math.exp(-a * 2.2);
        tmpP.copy(hp.pos).addScaledVector(f.d.clone().applyQuaternion(hp.q).add(new THREE.Vector3(0, .1, 0)), f.sp * fr / 2.2 * (1 + f.x));
        tmpP.y += 4 * a;
      }
      tmpS.setScalar(f.s * .55);
    }
    tmpQ.setFromAxisAngle(f.ax, s * f.w + f.ph * 6);
    tmpM.compose(tmpP, tmpQ, tmpS); flakes.setMatrixAt(i, tmpM);
  }
  flakes.instanceMatrix.needsUpdate = true;
}

const creasePt = (u, hp, swell) => {                                 // a point on the centre cut, world space
  const x = u * A * .8; return new THREE.Vector3(x, creaseY(x), CF * .55).multiplyScalar(swell).applyQuaternion(hp.q).add(hp.pos);
};
function updatePuffs(t, hp, swell, cam) {
  const s = tau(t);
  const up = new THREE.Vector3(0, 1, 0);
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(hp.q);
  for (let i = 0; i < NP; i++) {
    const p = PF[i]; let x = 9999, y = 0, z = 0, size = 1, alpha = 0, rot = p.d * 6, lit = .3;
    if (p.kind === 'amb') {                                           // slow smoke layers in the drum, far back
      const L = 10; const a = ((s * .5 + p.a * L) % L) / L;
      x = lerp(-150, 170, p.b) + 30 * a; y = -60 + 120 * a; z = -140 - 300 * p.c;
      size = 40 + 50 * p.d; alpha = .022 * Math.sin(Math.PI * a); lit = -.3 + .5 * p.e;
    } else if (p.kind === 'wisp') {                                   // first wisps of steam before the crack
      const per = 1.6, a = ((s + p.a * per) % per) / per, born = s - a * per;
      const q = creasePt(p.b * 2 - 1, heroPose(clamp(t - (s - born) / rate(t), 0, DUR)), swell);
      const k = sstep(TAUC - 1.3, TAUC - .2, born) * (1 - sstep(TAUC + .1, TAUC + 2.5, born) * .6);
      x = q.x + front.x * 2 * a + (p.c - .5) * 3 * a; y = q.y + 9 * a + front.y * 2 * a; z = q.z + front.z * 2 * a;
      size = 1.4 + 6 * a; alpha = .07 * k * Math.sin(Math.PI * Math.min(1, a * 1.3)); lit = .55;
    } else {                                                          // the burst
      const a = s - TAUC - p.a * .05;
      if (a > 0) {
        const q = creasePt(p.b * 2 - 1, heroPose(TC), swell);
        const dir = front.clone().multiplyScalar(.45).add(new THREE.Vector3((p.c - .5) * 1.6, .9 + p.d, (p.e - .5) * .6)).normalize();
        const fr = (1 - Math.exp(-a * 3)) / 3;
        x = q.x + dir.x * (16 + 30 * p.e) * fr; y = q.y + dir.y * (16 + 30 * p.e) * fr + 7 * a * a + 3 * a; z = q.z + dir.z * (16 + 30 * p.e) * fr;
        size = 1.2 + 5 * Math.sqrt(a) + 3 * a; alpha = .028 * Math.exp(-a / 1.1) * sstep(0, .05, a); lit = .55;
      }
    }
    puffs.set(i, x, y, z, alpha, size, rot + s * (p.c - .5) * .5, p.e, lit);
  }
  puffs.commit();
}
function updateSparks(t, hp, swell) {
  const s = tau(t), r = rate(t);
  const shutter = .5 / 30;                                         // 180° shutter, in real seconds
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(hp.q);
  const q0 = heroPose(TC);
  const pos = (sp, a) => {                                         // ballistic with drag, in scene seconds
    const q = creasePt(sp.u, q0, swell);
    const v = sp.dir.clone().applyQuaternion(q0.q); v.add(front.clone().multiplyScalar(.15)).normalize().multiplyScalar(sp.sp);
    return ballistic(q, v, a);
  };
  for (let i = 0; i < NS; i++) {
    const sp = SP[i], a = s - TAUC - sp.delay;
    if (a > 0 && a < sp.life) {
      const h = pos(sp, a), tl = pos(sp, Math.max(0, a - shutter * r - .018));
      const e = (3.2 + 6 * Math.exp(-a / .06)) * sp.hot * Math.pow(1 - a / sp.life, 1.5);
      sparks.set(i, h, tl, sp.w, e);
    } else sparks.hide(i);
  }
  sparks.commit();
}


function updateDust(t) {
  const s = tau(t);
  for (let i = 0; i < ND; i++) {
    const d = DU[i];
    const along = (d[0] + s * .01) % 1;
    const p = key.position.clone().lerp(new THREE.Vector3(0, 0, 0), .25 + .95 * along);
    dust.set(i, p.x + (d[1] - .5) * 60 * (.4 + along) + 4 * Math.sin(s * .4 + d[3] * 9), p.y + (d[2] - .5) * 60 * (.4 + along) + 3 * Math.sin(s * .3 + d[1] * 9), p.z + (d[3] - .5) * 50,
      (.25 + .75 * d[2]) * (.5 + .5 * Math.sin(s * (1 + d[1] * 3) + d[0] * 30)) * .9);
  }
  dust.commit();
}

/* ---------------- one frame: pose everything from t, then the lens ---------------- */
let cine = null;                                                     // made in the backdrop's init (needs the renderer)
function frame(t) {
  const T = tempAt(t), roast = roastOf(T);
  const swell = lerp(1, 1.13, sstep(.2, .9, roast)) + .025 * (t > TC ? 1 - kick(t) : 0);
  beanU.uRoast.value = roast;
  beanU.uSwell.value = swell;
  beanU.uCrack.value = t < TC ? 0 : (1 - Math.exp(-(t - TC) / .06));
  beanU.uGlow.value = (t < TC ? 1.5 * sstep(TC - .5, TC, t) * (.6 + .4 * Math.sin(t * 40)) : 0) + (t >= TC ? 7 * Math.exp(-(t - TC) / .11) + .9 * Math.exp(-(t - TC) / 1.2) : 0);
  hero.material.clearcoat = lerp(.01, .3, sstep(.75, 1, roast)); hero.material.clearcoatRoughness = .22;
  hero.material.sheen = lerp(.7, .15, sstep(.2, .7, roast));
  const hp = heroPose(t);
  hero.position.copy(hp.pos); hero.quaternion.copy(hp.q);
  hero.scale.setScalar(1);
  const cam = cameraAt(t);
  camera.position.copy(cam.eye); camera.lookAt(cam.tgt);
  camera.updateMatrixWorld();
  drum.rotation.z = -tau(t) * .22;
  rig.aim(hp.pos);
  const heat = 1 + .08 * Math.sin(t * 7.3) + .05 * Math.sin(t * 13.1);
  holeMat.uniforms.uT.value = t; holeMat.uniforms.uHeat.value = heat; inletGlow.material.uniforms.uHeat.value = heat;
  rim.intensity = 26 * heat;
  const cp = creasePt(0, hp, swell).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(hp.q), 2.5);
  flash.position.copy(cp); flash.intensity = t >= TC ? 90 * Math.exp(-(t - TC) / .07) + 30 * Math.exp(-(t - TC) / 1) : 0;
  beam.material.uniforms.uT.value = t;
  updateCrowd(t); updateFlakes(t, hp); updatePuffs(t, hp, swell, cam); updateSparks(t, hp, swell); updateDust(t);
  puffs.setTime(tau(t));
  cine.render(scene, camera, {
    t, focus: cam.focus,
    bloom: .5 + .45 * (t >= TC ? Math.exp(-(t - TC) / .3) : 0),
    flash: t >= TC ? .12 * Math.exp(-(t - TC) / .09) : 0,
    exposure: 1.05 * sstep(-.3, .6, t) * lerp(.62, 1, sstep(.15, .7, roast)),
  });
}

/* ---------------- the WebGL backdrop = the whole picture ---------------- */
EX.backdrop({
  subject: true,
  html: '',
  init(el) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    r.domElement.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px`;
    el.appendChild(r.domElement);
    cine = makeCinema(r, { w: W, h: H, ss: SS, dof: { fstop: 2.8, maxCoc: 34 }, bloom: { strength: .55, radius: .7, threshold: 1.1 } });
    // reflections: a dark box with the sight-glass window (warm white) and the burner (orange)
    studioEnv(r, scene, [
      [0xfff0dc, 7, 14, 9, [-30, 26, 8]],                      // the lamp window
      [0xff5a18, 1.6, 30, 20, [20, -6, -30]],                  // the burner glow
      [0xff7a30, .25, 80, 20, [0, -30, 0]],                    // warm bed below
      [0x8090b0, .35, 30, 8, [26, 28, 6]],                     // a cool sliver from the room
    ]);
  },
  render(el, t) { frame(t); },
});

/* ---------------- the readout: DOM in the shot (the camera does not film it) ---------------- */
document.head.insertAdjacentHTML('beforeend', `<style>
  #stage.theme-dark{background:#000}
  #bg{display:none}
  #stage.chrome-cinema #cap-pill{font-weight:400;font-size:36px;letter-spacing:.08em;bottom:64px}
  #hx{position:absolute;left:150px;bottom:138px;color:#efe6da;font-family:'Inter Tight',sans-serif;pointer-events:none}
  #hx-lab{font-family:'JetBrains Mono',monospace;font-weight:500;font-size:22px;letter-spacing:.3em;color:rgba(239,230,218,.55);margin:0 0 44px 6px;white-space:nowrap}
  #hx-lab b{font-weight:500;color:rgba(239,230,218,.85)}
  #hx-num{font-weight:200;font-size:232px;line-height:.9;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
  #hx-num sup{font-size:.34em;font-weight:300;vertical-align:top;position:relative;top:.22em;margin-left:.06em;letter-spacing:0}
  #hx-fc{position:absolute;left:8px;top:-104px;font-family:'Noto Sans SC',sans-serif;font-weight:500;font-size:44px;letter-spacing:.32em;color:${ACC};white-space:nowrap;opacity:0}
  #hx-fc i{font-style:normal;font-family:'JetBrains Mono',monospace;font-size:22px;letter-spacing:.3em;color:rgba(255,190,130,.7);margin-left:18px;vertical-align:middle}
  #hx-rule{height:1px;background:linear-gradient(90deg,rgba(239,230,218,.5),rgba(239,230,218,0));margin:14px 0 0 8px;width:520px}
</style>`);
EX.chapter('crack', { name: '一爆', color: ACC });

EX.shot({
  id: 'crack', chapter: 'crack', dur: DUR, hud: false,
  caps: [[5.1, '约 196 °C，豆子裂开：「一爆」。']],
  sfx: [[TC, 'impact', .6]], amb: 'fire', hush: [[5.5, 6.2]],     // near-silence before the pop
  html: `<div id="hx">
    <div id="hx-fc">一爆<i>FIRST CRACK</i></div>
    <div id="hx-lab"><b>豆温</b>&nbsp;&nbsp;BEAN TEMP</div>
    <div id="hx-num"><span id="hx-n">100</span><sup>°C</sup></div>
    <div id="hx-rule"></div></div>`,
  init(el) { this.q = { n: el.querySelector('#hx-n'), num: el.querySelector('#hx-num'), fc: el.querySelector('#hx-fc'), hud: el.querySelector('#hx') }; },
  render(el, u, d, t) {
    const q = this.q;
    const T = tempAt(Math.floor(t * 30 + 1e-6) / 30);              // one value per output frame (sub-frames blend)
    q.n.textContent = String(Math.floor(T));
    const hit = t > TC ? Math.exp(-(t - TC) / .5) : 0;
    const warm = sstep(TC - .05, TC + .05, t);
    q.num.style.color = `rgb(${Math.round(lerp(239, 255, warm))},${Math.round(lerp(230, 196, warm))},${Math.round(lerp(218, 150, warm))})`;
    q.num.style.textShadow = `0 0 ${Math.round(20 + 60 * hit)}px rgba(255,120,40,${(.15 * warm + .55 * hit).toFixed(3)})`;
    q.num.style.transform = `scale(${(1 + .035 * hit).toFixed(4)})`; q.num.style.transformOrigin = '0 100%';
    q.fc.style.opacity = sstep(TC + .05, TC + .55, t).toFixed(3);
    q.fc.style.transform = `translateY(${(14 * (1 - ease(sstep(TC + .05, TC + .7, t)))).toFixed(2)}px)`;
    q.hud.style.opacity = sstep(.4, 1.4, t).toFixed(3);
  },
});

EX.run({
  theme: 'dark', chrome: 'cinema', composition: 'cinema', mood: 'calm',
  preload: [metalD.ready, metalN.ready, metalR.ready],
});
