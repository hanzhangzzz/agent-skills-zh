/* cinema3d.js — a physically-flavoured three.js "camera + lab" for cinema-mode shots. ES module (needs the importmap
   in explainer.html: 'three' and 'three/addons/'). Extracted from hero.example.js (a 9 s macro of a coffee bean's first
   crack); every number below is the tuned value from that shot, so the defaults give that look.

   What you get
     makeCinema(renderer, opts)   the whole post chain: 2x supersampled HDR render → physical depth of field →
                                  bloom → heat haze + chromatic aberration + grade + vignette + grain + ACES (final pass)
     timewarp(rateFn, dur)        τ(t): scene time under a variable playback rate (high-speed-camera slow motion)
     lightRig(scene, opts)        key spot (shadows) + rim + back fill + practical point light + flash + dim hemisphere
     studioEnv(renderer, scene, panels)   reflection environment made of a few emissive panels
     makeSparks / makeFlakes / makePuffs / makeDust   particle systems you pose each frame from t (closed form)
     ballistic(origin, vel, a, opts)      position of a particle under drag + gravity after a scene seconds
     loadTex(url, opts)           texture + tex.ready promise (pass the promises to EX.run({ preload }))
     NOISE, BUMP                  GLSL strings: simplex snoise()/fbm(), and perturbN() (bump mapping from a height value)
     rng, clamp, lerp, sstep, ease   small maths helpers

   Rules that keep a frame a pure function of t (the renderer seeks to arbitrary t, in any order)
     - never accumulate state between frames; every position/colour/intensity is computed from t alone
     - randomness comes from rng(seed), drawn ONCE at load into tables; per frame you only index the tables
     - units are yours (the hero uses millimetres); keep camera near/far tight (near 4, far 3000 for a 100 mm scene)
     - all scene materials output LINEAR HDR; tone mapping + sRGB encode happen only in cine.render's final pass,
       so keep renderer.toneMapping = NoToneMapping (makeCinema sets it) and do not use renderer.outputColorSpace tricks.
     - lights/emitters may go far above 1.0: bloom threshold (default 1.1) picks them out.

   Typical use (see hero.example.js):
     const renderer = new THREE.WebGLRenderer({ antialias:false, preserveDrawingBuffer:true });
     const cine = makeCinema(renderer, { w:1920, h:1080, ss:2, dof:{ fstop:2.8 }, bloom:{ strength:.5, radius:.7, threshold:1.1 } });
     // per frame, after posing scene+camera from t:
     cine.render(scene, camera, { t, focus: distanceToSubject, exposure: 1.05, bloom: .5, flash: 0 });
*/
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/* ---------------- maths ---------------- */
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, x) => a + (b - a) * x;
export const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const ease = (u) => u * u * u * (u * (u * 6 - 15) + 10);               // smootherstep
/* seeded xorshift32: const R = rng(42); R() → [0,1). Same seed → same sequence, always. */
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/* ---------------- time warp ---------------- */
/* rateFn(t) = dτ/dt (scene seconds per real second; 0.2 = 5x slow motion). Returns tau(t): the scene time at real
   time t (0..dur), by integrating rateFn once into a table → a pure lookup. tau.rate = rateFn.
   Drive EVERYTHING that moves (positions, rotation, particle ages) from tau(t) instead of t. Use real t only for things
   that should not slow down (camera shake, light flicker, HUD). */
export function timewarp(rateFn, dur, n = 4000) {
  const a = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) { const t = (i - .5) * dur / n; a[i] = a[i - 1] + rateFn(t) * dur / n; }
  const tau = (t) => { const x = clamp(t / dur) * n, i = Math.floor(x), f = x - i; return i >= n ? a[n] : lerp(a[i], a[i + 1], f); };
  tau.rate = rateFn;
  return tau;
}

/* ---------------- GLSL ---------------- */
/* Ashima simplex noise 3D (MIT). Gives: float snoise(vec3) in about [-1,1], float fbm(vec3) (5 octaves). Paste into any shader. */
export const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;} vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);} vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){ const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx); vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy); vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i); vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y); vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.)); vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3))); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
`;

/* Bump mapping from a procedural height (screen-space derivatives, no tangents/UVs needed).
   In a MeshPhysicalMaterial fragment shader, after '#include <normal_fragment_maps>':
     normal = perturbN(-vViewPosition, normal, height(objectSpacePos), faceDirection);
   height is in the same units as position (a few 1e-3 of the object size = visible relief). Needs the standard
   fragment shader (uses dFdx/dFdy). Include it AFTER NOISE if your height function calls snoise. */
export const BUMP = `
vec3 perturbN(vec3 pos, vec3 n, float h, float fd){
  vec3 sx = dFdx(pos), sy = dFdy(pos); vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd; vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad); }`;

/* ---------------- textures ---------------- */
/* tex = loadTex('tex/steel_diff.jpg', { srgb:true, repeat:[5,2], aniso:8 }); await tex.ready.
   srgb:true for colour maps; leave false for normal/roughness maps. Pass every tex.ready to EX.run({ preload:[...] }). */
export function loadTex(url, { srgb = false, repeat = [1, 1], aniso = 8 } = {}) {
  let done; const ready = new Promise((ok) => { done = ok; });
  const tex = new THREE.TextureLoader().load(url, () => done(tex));
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); tex.anisotropy = aniso;
  tex.ready = ready;
  return tex;
}

/* ---------------- the post chain ---------------- */
const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

/* makeCinema(renderer, opts) → { render(scene, camera, over), rt, size }
   Configures the renderer (pixel ratio 1, size w×h, no tone mapping, soft shadows) and builds the chain:
     scene → HDR half-float target at w·ss × h·ss (4× MSAA, depth texture)        [ss = 2 is the 2× supersampling]
           → CoC pass (physical circle of confusion from depth)  → 160-tap spiral gather (bokeh, near/far aware)
           → UnrealBloom on the linear HDR  → final pass: heat haze, chromatic aberration, exposure, grade, ACES,
             sRGB, vignette, grain → the canvas (downsampled by the browser from the w×h drawing buffer; the supersampled
             detail is averaged by the final pass's bilinear taps and the canvas resolve).
   Put renderer.domElement in the page yourself (position:absolute; width:w px; height:h px) and set
   scene.background = new THREE.Color(0x000000) — the chain expects an opaque HDR frame.

   opts (all optional; the defaults are the tuned hero look)
     w, h, ss                     output size and supersampling factor (1920, 1080, 2)
     dof:   { fstop: 2.8, maxCoc: 34, focus: 100 }
              fstop: smaller = shallower depth of field (2.8 ≈ macro lens: the background melts, the subject's depth stays sharp)
              maxCoc: largest blur radius in output pixels (also the bokeh disc size of a defocused highlight)
              focus: distance from the camera (scene units) of the sharp plane; override per frame to rack focus
     bloom: { strength: .55, radius: .7, threshold: 1.1 }   threshold in linear HDR: only emitters brighter than this glow
     haze:  1                     heat-shimmer amount (0 = off); strongest low in the frame; shift = .0011 of the frame
     ca:    .006                  lateral chromatic aberration towards the corners
     grade: { aces: .6,           pre-tonemap multiplier (overall brightness into ACES)
              tint: [.86,.98,1.12], tintAmount: .6,   cool-teal tint added only in the darkest shadows (0 = none)
              vignette: .55 }
     grain: .035                  film grain amplitude (0..1 of full scale), re-seeded every output frame
   cine.render(scene, camera, over) — over (per-frame, all optional): t (seconds; drives haze motion and the grain seed),
     focus, fstop, bloom (strength), haze, flash (adds to exposure: 0.12 = +12 % white pop), exposure (1 = neutral). */
export function makeCinema(renderer, o = {}) {
  const W = o.w ?? 1920, H = o.h ?? 1080, SS = o.ss ?? 2;
  const dof = Object.assign({ fstop: 2.8, maxCoc: 34, focus: 100 }, o.dof);
  const bl = Object.assign({ strength: .55, radius: .7, threshold: 1.1 }, o.bloom);
  const gr = Object.assign({ aces: .6, tint: [.86, .98, 1.12], tintAmount: .6, vignette: .55 }, o.grade);
  const haze0 = o.haze ?? 1, ca0 = o.ca ?? .006, grain0 = o.grain ?? .035;
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NoToneMapping;                       // tone mapping happens in the final pass
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const IW = W * SS, IH = H * SS;
  const rtScene = new THREE.WebGLRenderTarget(IW, IH, { samples: 4, type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(IW, IH, THREE.FloatType) });
  const rtCoc = new THREE.WebGLRenderTarget(IW, IH, { type: THREE.HalfFloatType });
  const rtDof = new THREE.WebGLRenderTarget(IW, IH, { type: THREE.HalfFloatType });
  const cocQ = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tColor: { value: rtScene.texture }, tDepth: { value: rtScene.depthTexture }, focus: { value: dof.focus }, aper: { value: 1 }, maxCoc: { value: 30 }, near: { value: 4 }, far: { value: 3000 } },
    vertexShader: VS, fragmentShader: `#include <packing>
    varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform float focus, aper, maxCoc, near, far;
    void main(){ float z = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, near, far);
      float c = clamp(aper * (1./focus - 1./z), -maxCoc, maxCoc); gl_FragColor = vec4(texture2D(tColor, vUv).rgb, c); }` }));
  const gatherQ = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tIn: { value: rtCoc.texture }, res: { value: new THREE.Vector2(IW, IH) }, maxCoc: { value: 30 } },
    vertexShader: VS, fragmentShader: `varying vec2 vUv; uniform sampler2D tIn; uniform vec2 res; uniform float maxCoc;
    void main(){ vec4 c0 = texture2D(tIn, vUv); float a0 = abs(c0.a);
      vec3 acc = c0.rgb / (a0*a0*.25 + 1.); float ws = 1. / (a0*a0*.25 + 1.);
      const int N = 160;
      for (int i = 0; i < N; i++) { float r = maxCoc * sqrt((float(i) + .5) / float(N)); float th = float(i) * 2.39996;
        vec4 s = texture2D(tIn, vUv + vec2(cos(th), sin(th)) * r / res); float sa = abs(s.a);
        if (s.a > c0.a) sa = min(sa, max(a0, 0.));
        float w = smoothstep(r - 2., r + .5, sa) / (sa*sa*.25 + 1.);
        acc += s.rgb * w; ws += w; }
      gl_FragColor = vec4(acc / ws, 1.); }` }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(IW, IH), bl.strength, bl.radius, bl.threshold);
  const finalQ = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tIn: { value: rtDof.texture }, uT: { value: 0 }, uExp: { value: 1 }, uFlash: { value: 0 }, uHaze: { value: haze0 }, uSeed: { value: 0 },
      uCA: { value: ca0 }, uGrain: { value: grain0 }, uAces: { value: gr.aces }, uVig: { value: gr.vignette },
      uTint: { value: new THREE.Vector3(...gr.tint) }, uTintAmt: { value: gr.tintAmount } },
    vertexShader: VS, fragmentShader: `varying vec2 vUv; uniform sampler2D tIn; uniform float uT, uExp, uFlash, uHaze, uSeed, uCA, uGrain, uAces, uVig, uTintAmt; uniform vec3 uTint; ${NOISE}
    vec3 aces(vec3 x){ x *= uAces; return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
    void main(){ vec2 uv = vUv;
      // heat shimmer: rising, strongest low in frame
      float m = uHaze * (.35 + .65*smoothstep(.6, 0., uv.y));
      uv += vec2(snoise(vec3(uv*vec2(7.,4.) + vec2(0., -uT*.9), uT*.4)), snoise(vec3(uv*vec2(5.,9.) + vec2(3., -uT*1.2), uT*.5))) * .0011 * m;
      // lateral chromatic aberration toward the corners
      vec2 d = uv - .5; float r2 = dot(d, d);
      vec3 c = vec3(texture2D(tIn, uv - d*r2*uCA).r, texture2D(tIn, uv).g, texture2D(tIn, uv + d*r2*uCA).b);
      c *= uExp * (1. + uFlash);
      // grade: cool-teal low shadows, filmic shoulder
      float l = dot(c, vec3(.2126,.7152,.0722));
      c = mix(c, c*uTint, (1.-smoothstep(0., .05, l))*uTintAmt);
      vec3 o = aces(c);
      o = pow(o, vec3(1./2.2));
      float v = 1. - uVig*smoothstep(.2, .95, length(d*vec2(1.15, 1.)));
      o *= v;
      o += (h12(gl_FragCoord.xy + uSeed*917.) - .5) * uGrain;          // grain
      gl_FragColor = vec4(o, 1.); }` }));

  function render(scene, camera, over = {}) {
    const t = over.t ?? 0;
    renderer.setRenderTarget(rtScene); renderer.clear(); renderer.render(scene, camera);
    const cu = cocQ.material.uniforms; cu.focus.value = over.focus ?? dof.focus; cu.near.value = camera.near; cu.far.value = camera.far;
    // CoC(px) = aper·(1/focus − 1/z); aper 8000 at f/2.8 (per supersample), so aper ∝ 1/fstop
    cu.aper.value = (22400 / (over.fstop ?? dof.fstop)) * SS; cu.maxCoc.value = dof.maxCoc * SS;
    renderer.setRenderTarget(rtCoc); cocQ.render(renderer);
    gatherQ.material.uniforms.maxCoc.value = dof.maxCoc * SS;
    renderer.setRenderTarget(rtDof); gatherQ.render(renderer);
    bloom.strength = over.bloom ?? bl.strength;
    bloom.render(renderer, null, rtDof, 0, false);
    const fu = finalQ.material.uniforms; fu.uT.value = t; fu.uSeed.value = Math.floor(t * 30) % 97;
    fu.uFlash.value = over.flash ?? 0; fu.uExp.value = over.exposure ?? 1; fu.uHaze.value = over.haze ?? haze0;
    renderer.setRenderTarget(null); finalQ.render(renderer);
  }
  return { render, rt: { scene: rtScene, coc: rtCoc, dof: rtDof }, size: [W, H, SS] };
}

/* ---------------- lights ---------------- */
/* lightRig(scene, opts) → { key, rim, back, practical, flash, hemi, aim(p) }
   A "narrow key + rim + practical glow" rig for a small subject in the dark. Defaults are the hero's (mm scale, subject
   near the origin). Override any light with { pos:[x,y,z], color, intensity, ... }:
     key        SpotLight, narrow (angle .12 rad), casts the only shadows (4096² map; tune shadow.near/far to bracket the subject)
     rim        wide orange SpotLight from behind the subject: the glowing edge. Animate rim.intensity for flicker.
     back       a dim narrow warm spot from the far side: lifts the shadow side a little
     practical  PointLight at the visible light source (burner, lamp, screen): pos [x,y,z] is required for a real scene
     flash      PointLight, intensity 0: raise it for an instant (an impact) and place it at the event (flash.position)
     hemi       very dim sky/ground ambient so shadows are not pure black
   aim(p) points the three spots at Vector3 p — call it every frame with the subject's position. */
export function lightRig(scene, o = {}) {
  const V = (a) => new THREE.Vector3(...a);
  const hemi = new THREE.HemisphereLight(0x3a4660, 0x2a1408, .05); scene.add(hemi);
  const k = Object.assign({ color: 0xfff0e2, intensity: 7, pos: [-250, 220, 70], angle: .12, penumbra: 1, near: 150, far: 700, map: 4096 }, o.key);
  const key = new THREE.SpotLight(k.color, k.intensity, 0, k.angle, k.penumbra, 0);
  key.position.copy(V(k.pos)); key.castShadow = true;
  key.shadow.mapSize.set(k.map, k.map); key.shadow.camera.near = k.near; key.shadow.camera.far = k.far; key.shadow.bias = -.00006; key.shadow.normalBias = .02; key.shadow.radius = 4;
  scene.add(key, key.target);
  const r = Object.assign({ color: 0xff5a14, intensity: 26, pos: [170, -40, -260], angle: .45, penumbra: .7 }, o.rim);
  const rim = new THREE.SpotLight(r.color, r.intensity, 0, r.angle, r.penumbra, 0); rim.position.copy(V(r.pos)); scene.add(rim, rim.target);
  const b = Object.assign({ color: 0xff8a3a, intensity: 3, pos: [-180, -90, -120], angle: .12, penumbra: 1 }, o.back);
  const back = new THREE.SpotLight(b.color, b.intensity, 0, b.angle, b.penumbra, 0); back.position.copy(V(b.pos)); scene.add(back, back.target);
  const p = Object.assign({ color: 0xff5a1a, intensity: 7, pos: [0, 0, 0], distance: 800, decay: 1 }, o.practical);
  const practical = new THREE.PointLight(p.color, p.intensity, p.distance, p.decay); practical.position.copy(V(p.pos)); scene.add(practical);
  const f = Object.assign({ color: 0xffa860, distance: 22, decay: 1.6 }, o.flash);
  const flash = new THREE.PointLight(f.color, 0, f.distance, f.decay); scene.add(flash);
  const aim = (pt) => { key.target.position.copy(pt); rim.target.position.copy(pt); back.target.position.copy(pt); };
  return { key, rim, back, practical, flash, hemi, aim };
}

/* studioEnv(renderer, scene, panels) — sets scene.environment (PMREM) from a dark sphere plus emissive rectangles, so
   metals and glossy coats reflect something believable (a window, a burner glow) instead of black.
   panels: [[color, intensityMultiplier, width, height, [x,y,z]], ...] placed on a radius-50 sphere around the origin,
   facing the centre. Intensities > 1 are HDR (a lamp window = 7). Returns the env texture. */
export function studioEnv(renderer, scene, panels) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x050302, side: THREE.BackSide })));
  for (const [c, s, w, h, pos] of panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(s), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  return (scene.environment = pm.fromScene(env, .02).texture);
}

/* ---------------- particles (pose them every frame from t; nothing is simulated) ---------------- */
/* Position under drag + gravity after `a` scene seconds from `origin` with initial velocity `vel` (Vector3, units/s):
   x = origin + vel·(1 − e^(−k a))/k  and  y −= g·a².   Returns a new Vector3. Defaults k = 2.2, g = 9 (hero sparks). */
export function ballistic(origin, vel, a, { k = 2.2, g = 9 } = {}) {
  const fr = (1 - Math.exp(-k * a)) / k;
  return origin.clone().addScaledVector(vel, fr).add(new THREE.Vector3(0, -g * a * a, 0));
}

/* makeSparks(scene, n, { w, h }) → { mesh, set(i, head, tail, width, energy), hide(i), commit() }
   HDR streaks drawn from `tail` to `head` (Vector3 world points): the head is where the spark is now, the tail where
   it was one shutter interval ago (motion blur by construction: use tail = pos(a − shutter·rate − small) with a 180°
   shutter, shutter = .5/fps real seconds). width in output pixels, energy = HDR brightness (3–9 pops out of the bloom).
   Writes depth, so depth of field treats a spark as a solid object. Call commit() once after posing all of them. */
export function makeSparks(scene, n, { w = 1920, h = 1080 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {}, transparent: true, depthWrite: true, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aHead; attribute vec3 aTail; attribute vec2 aS; varying float vX; varying float vE;
    void main(){ vec4 h = viewMatrix*vec4(aHead,1.), tl = viewMatrix*vec4(aTail,1.);
      vec4 ph = projectionMatrix*h, pt = projectionMatrix*tl; vec2 sh = ph.xy/ph.w, st = pt.xy/pt.w;
      vec2 dir = sh - st; float L = length(dir*vec2(${w / h},1.)); dir = L > 1e-5 ? normalize(dir*vec2(${w / h},1.)) : vec2(1.,0.);
      vec2 nrm = vec2(-dir.y, dir.x) / vec2(${w / h}, 1.);
      float wpx = aS.x / ${h / 2}.; vec4 p = position.x > .5 ? ph : pt;
      p.xy += nrm * position.y * wpx * p.w; p.xy += (position.x > .5 ? 1. : -1.) * dir/vec2(${w / h},1.) * wpx * p.w;
      gl_Position = p; vX = position.x; vE = aS.y; }`,
    fragmentShader: `varying float vX; varying float vE; void main(){ if (vE <= .001) discard;
      vec3 c = mix(vec3(1.,.22,.03), vec3(1.,.55,.2), vX) * vE * (.25 + .75*vX); gl_FragColor = vec4(c, 1.); }`,
  });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]); geo.instanceCount = n;
  const aHead = new Float32Array(n * 3), aTail = new Float32Array(n * 3), aS = new Float32Array(n * 2);
  geo.setAttribute('aHead', new THREE.InstancedBufferAttribute(aHead, 3)); geo.setAttribute('aTail', new THREE.InstancedBufferAttribute(aTail, 3)); geo.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 2));
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; scene.add(mesh);
  return {
    mesh,
    set(i, head, tail, width, energy) { aHead.set([head.x, head.y, head.z], i * 3); aTail.set([tail.x, tail.y, tail.z], i * 3); aS.set([width * (energy > 0 ? 1 : 0), energy], i * 2); },
    hide(i) { aHead.set([0, 0, -9999], i * 3); aTail.set([0, 0, -9999], i * 3); aS.set([0, 0], i * 2); },
    commit() { for (const k of ['aHead', 'aTail', 'aS']) geo.attributes[k].needsUpdate = true; },
  };
}

/* makeFlakes(scene, n, opts) → InstancedMesh of curled, torn paper/chaff flakes (alpha-tested, so depth of field
   treats them as solids). Pose each with mesh.setMatrixAt(i, matrix); then mesh.instanceMatrix.needsUpdate = true.
   Park an unused instance far away (x = 9999). opts: color 0x9c8058, emissive 0x3a1a06, texSeed 9. */
export function makeFlakes(scene, n, { color = 0x9c8058, emissive = 0x3a1a06, texSeed = 9 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const R = rng(texSeed);
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#fff'; g.beginPath();
  for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2, r = 92 + 26 * Math.sin(a * 3 + 1) + 18 * (R() - .5); const x = 128 + Math.cos(a) * r * 1.15, y = 128 + Math.sin(a) * r * .7; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.fill();
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(0,0,0,${.1 + .25 * R()})`; g.lineWidth = .6 + R() * 1.4; g.beginPath(); const y = R() * 256; g.moveTo(0, y); g.bezierCurveTo(80, y + 10 * (R() - .5), 170, y + 10 * (R() - .5), 256, y + 6 * (R() - .5)); g.stroke(); }
  for (let i = 0; i < 14; i++) { g.fillStyle = '#000'; g.beginPath(); g.arc(R() * 256, R() * 256, 4 + R() * 14, 0, 7); g.fill(); }   // torn holes
  const geo = new THREE.PlaneGeometry(1, 1, 8, 8); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, .35 * x * x + .18 * Math.sin(y * 3)); }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .9, alphaMap: new THREE.CanvasTexture(c), alphaTest: .5, side: THREE.DoubleSide, emissive, envMapIntensity: .4 });
  const mesh = new THREE.InstancedMesh(geo, mat, n); mesh.castShadow = true; scene.add(mesh);
  return mesh;
}

/* makePuffs(scene, n) → { mesh, mat, set(i, x, y, z, alpha, size, rot, seed, lit), commit(), setTime(s) }
   Steam / smoke billboards with animated fbm and fine filaments, premultiplied alpha, lit warm on the right (burner side).
   x = 9999 or alpha 0 hides one. size in scene units (radius), rot radians, seed 0..1 (varies the noise), lit −.3..1 (brightness).
   setTime(s): pass the SCENE time tau(t) each frame (the noise flows with it). Draw order: renderOrder 5, no depth write. */
export function makePuffs(scene, n) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } }, transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 aP; attribute vec4 aQ; varying vec2 vU; varying vec4 vQ; varying float vA;
    void main(){ vU = position.xy; vQ = aQ; vA = aP.w; vec4 mv = viewMatrix * vec4(aP.xyz, 1.); float s = aQ.x;
      float c = cos(aQ.y), si = sin(aQ.y); vec2 q = mat2(c,-si,si,c) * position.xy; mv.xy += q * s; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uT; varying vec2 vU; varying vec4 vQ; varying float vA; ${NOISE}
    void main(){ float r = length(vU); if (r > 1.) discard;
      float n = fbm(vec3(vU*1.6 + vQ.z*10., uT*.35 + vQ.z*3.)); float d = smoothstep(1., .15, r + n*.5);
      float fil = pow(1. - abs(snoise(vec3(vU*vec2(2.2,1.2) + vec2(n*1.3, -uT*.25) + vQ.z*7., uT*.2))), 5.);
      float a = d * vA * (.25 + 1.6*fil); vec3 lit = mix(vec3(.42,.28,.2), vec3(1.,.55,.26), clamp(vU.x*.5+.5 + n*.3, 0., 1.)) * (.6 + vQ.w);
      gl_FragColor = vec4(lit * a, a); }`,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const geo = new THREE.InstancedBufferGeometry(); geo.copy(new THREE.PlaneGeometry(2, 2)); geo.instanceCount = n;
  const aP = new Float32Array(n * 4), aQ = new Float32Array(n * 4);
  geo.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4)); geo.setAttribute('aQ', new THREE.InstancedBufferAttribute(aQ, 4));
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5; scene.add(mesh);
  return {
    mesh, mat,
    set(i, x, y, z, alpha, size, rot, seed, lit) { aP.set([x, y, z, alpha], i * 4); aQ.set([size, rot, seed, lit], i * 4); },
    commit() { geo.attributes.aP.needsUpdate = geo.attributes.aQ.needsUpdate = true; },
    setTime(s) { mat.uniforms.uT.value = s; },
  };
}

/* makeDust(scene, n, { h, ss }) → { points, set(i, x, y, z, alpha), commit() }
   Dust motes as soft additive points (size shrinks with distance, 1.5–60 px at h·ss resolution). Place them inside a
   light beam (or they are invisible); alpha ~.2–1 twinkles. */
export function makeDust(scene, n, { h = 1080, ss = 2 } = {}) {
  const geo = new THREE.BufferGeometry(); const pos = new Float32Array(n * 3), al = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aA', new THREE.BufferAttribute(al, 1));
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = clamp(${h * ss}. * .35 / -mv.z, 1.5, 60.); }`,
    fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord-.5)*2.; if (r>1.) discard; gl_FragColor = vec4(vec3(1.,.8,.55)*vA*(1.-r*r), 1.); }`,
  }));
  points.frustumCulled = false; scene.add(points);
  return {
    points,
    set(i, x, y, z, a) { pos.set([x, y, z], i * 3); al[i] = a; },
    commit() { geo.attributes.position.needsUpdate = geo.attributes.aA.needsUpdate = true; },
  };
}
