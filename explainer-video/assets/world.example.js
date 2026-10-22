/* world.example.js — 「阳光到你眼里的 8 分 20 秒」: one photon from the Sun's core to your retina, ~44 s, dark theme.
   The reference for the camera + world API (explainer.js header: at / enter 'fly' / cam / EX.world / EX.backdrop).
   Render it as is (cp world.example.js shots.js), or lift one technique. Every technique is marked TECHNIQUE A–H:
     A  EX.backdrop   canvas starfield with parallax from EX.cam(t); glow from one pre-rendered sprite (no CSS blur)
     B  EX.world      one long world (Sun → route → orbits → Earth); the shots are stations along it
     C  protagonist   the photon lives in the world layer ABOVE every shot (z-index) at a screen-constant size
     D  zoom out      the first shot is a 0.07-scale detail inside the Sun shot: its fly pulls back (small → big)
     E  custom cam    cam(u, d) tracks the photon along the route while the meter counts
     F  seamless cut  the trip camera ends exactly on the next shot's frame, so enter: 'cut' is invisible
     G  zoom in       the eye is a 0.05-scale detail on Earth's limb: its fly pushes in (big → small)
     H  level of detail  world labels fade out when the camera pulls back (they would shrink under 24 px)
   Facts (rounded): Sun → Earth ≈ 1.5 亿 km; light ≈ 30 万 km/s → ≈ 499 s ≈ 8 分 20 秒. Core ≈ 1500 万 °C, surface
   ≈ 5500 °C. Energy needs 1 万–17 万 年 (estimates differ) to diffuse out; strictly it is absorbed and re-emitted
   countless times and carried by convection in the outer 30 %, so "one photon all the way" is the film's
   simplification — the frames that show it say 示意. Sizes and distances are not to scale (标注「示意 · 未按比例」). */

/* ---------- 0 · one table of times and places ----------
   The world layer and the camera need to know when each shot starts, but EX computes start times internally.
   Keep the durations in one table, derive the starts, and use DUR.x as each shot's dur: one source of truth. */
const DUR = { core: 7, sun: 7.5, trip: 9, earth: 7, eye: 7.5, end: 6 };
const T = {};
{ let acc = 0; for (const k in DUR) { T[k] = acc; acc += DUR[k]; } }

/* World coordinates (px). A shot's `at: [x, y, s]` puts its 1920×1080 frame centred on (x, y) at scale s. */
const SUN = { x: 900, y: 540, r: 330 };
const SURF_X = SUN.x + SUN.r;                     // 1230: the photon leaves the surface here
const XA = SURF_X + 12000;                        // where the photon is when the trip shot ends
const EARTH = { x: 14000, y: 540, r: 290 };
const LIMB_X = EARTH.x - EARTH.r;                 // Earth's sunlit edge, facing the Sun
const AT = {
  core: [SUN.x, SUN.y, 0.07],                     // TECHNIQUE D: core radius 84 px = 1200 px in this frame × 0.07
  sun: [SUN.x + 120, SUN.y, 1],                   // Sun a little left of centre: room for callouts on the right
  trip: [7230, 540, 1],                           // only sets the coordinate origin: cam() decides what is filmed
  earth: [XA + 540, 540, 1],                      // TECHNIQUE F: the trip camera ends exactly here
  eye: [LIMB_X + 20, 540, 0.05],                  // TECHNIQUE G: a 96×54 px patch of Earth's limb, filmed full screen
  end: [7430, 540, 7.8],                          // the whole route in one frame (s = 7.8: 15 000 px of world)
};
const M_TRIP = 498, M_EARTH = 499.9;              // meter (seconds since leaving the surface) at the end of those shots
const routeX = (m) => SURF_X + (XA - SURF_X) * m / M_TRIP;   // light is constant speed: x is linear in the meter
const toWorld = (at, x, y) => [at[0] + (x - 960) * at[2], at[1] + (y - 540) * at[2]];   // shot px → world px
const toShot = (at, wx, wy) => [960 + (wx - at[0]) / at[2], 540 + (wy - at[1]) / at[2]]; // world px → shot px
const X_END = toWorld(AT.eye, 80, 540)[0];         // the photon enters the eye shot at its x = 80
const smooth = (a, b, x) => { const p = clamp((x - a) / (b - a)); return p * p * (3 - 2 * p); };

/* ---------- 1 · the protagonist's path, as pure functions of time ----------
   One function answers "where is the photon at global time t" in world px. The world layer draws it, the shots
   draw trails up to it, the camera follows it. Nothing reads the previous frame, so any frame renders alone. */

/* random walk inside the core, in core-shot px. Made once from rng; the seed loop keeps the first walk that ends
   right of centre, so the next shot carries on towards the surface on the right. */
const WALK = (() => {
  for (let seed = 1; ; seed++) {
    const r = rng(seed), pts = [[960, 540]];
    for (let guard = 0; pts.length < 24 && guard < 4000; guard++) {
      const [x0, y0] = pts[pts.length - 1], a = r() * Math.PI * 2, L = 120 + r() * 110;
      const x = x0 + Math.cos(a) * L, y = y0 + Math.sin(a) * L;
      if (((x - 960) / 520) ** 2 + ((y - 540) / 290) ** 2 < 1) pts.push([x, y]);   // stay inside the ellipse (cards sit outside)
    }
    if (pts.length === 24 && pts[23][0] > 1080) return pts;
  }
})();
const WALK_T0 = 0.8, WALK_STEP = 0.24;            // one straight flight between collisions every 0.24 s
function walkAt(u) {                               // → [x, y, q]; q = segments flown so far (fractional)
  const q = clamp((u - WALK_T0) / WALK_STEP, 0, WALK.length - 1);
  const i = Math.min(WALK.length - 2, Math.floor(q)), f = q - i;
  return [lerp(WALK[i][0], WALK[i + 1][0], f), lerp(WALK[i][1], WALK[i + 1][1], f), q];
}

/* zigzag out through the radiative zone, then one convection roll to the surface — in sun-shot px */
const SC = toShot(AT.sun, SUN.x, SUN.y);          // the Sun's centre in sun-shot px (840, 540)
const R_CORE = 84, R_RAD = 231;                    // core ≈ 0.25 R, radiative zone to ≈ 0.7 R
const EXIT = [SC[0] + SUN.r, SC[1]];
const ZIG = (() => {
  const r = rng(5), pts = [toShot(AT.sun, ...toWorld(AT.core, ...WALK[WALK.length - 1]))];   // continues the walk
  while (Math.hypot(pts[pts.length - 1][0] - SC[0], pts[pts.length - 1][1] - SC[1]) < R_RAD) {
    const [x0, y0] = pts[pts.length - 1], a = (r() - .5) * 2.6, L = 15 + r() * 12;      // mostly outward, ±75°
    let y = y0 + Math.sin(a) * L;
    if (Math.abs(y - 540) > 110) y = y0 - Math.sin(a) * L;                                // bounce off the band
    pts.push([Math.max(SC[0] + 10, x0 + Math.cos(a) * L), y]);                            // stay in the cut-away half
  }
  return pts;
})();
const ZIG_T0 = 1.8, ZIG_T1 = 5.3, ROLL_T1 = 6.5;   // zigzag after the fly has landed, then the convection roll
const ROLL_C = [(ZIG[ZIG.length - 1][0] + EXIT[0]) / 2 + 10, Math.min(ZIG[ZIG.length - 1][1], 540) - 95];
function zigAt(u) {
  if (u < ZIG_T1) {
    const q = clamp((u - ZIG_T0) / (ZIG_T1 - ZIG_T0)) * (ZIG.length - 1);
    const i = Math.min(ZIG.length - 2, Math.floor(q)), f = q - i;
    return [lerp(ZIG[i][0], ZIG[i + 1][0], f), lerp(ZIG[i][1], ZIG[i + 1][1], f), q];
  }
  const p = cubic(prog(u, ZIG_T1, ROLL_T1)), P = ZIG[ZIG.length - 1];                    // quadratic Bézier roll
  return [(1 - p) ** 2 * P[0] + 2 * (1 - p) * p * ROLL_C[0] + p * p * EXIT[0],
    (1 - p) ** 2 * P[1] + 2 * (1 - p) * p * ROLL_C[1] + p * p * EXIT[1], ZIG.length - 1 + p];
}

/* through the eye, in eye-shot px: cornea → pupil → lens → the retina at x 1362 */
const RETINA = [1362, 540], EYE_T0 = 1.9, EYE_T1 = 4.7;
const eyeAt = (u) => [lerp(80, RETINA[0], clamp((u - EYE_T0) / (EYE_T1 - EYE_T0))), 540];

function photonAt(t) {
  if (t < T.sun) { const p = walkAt(t - T.core); return toWorld(AT.core, p[0], p[1]); }
  if (t < T.trip) { const p = zigAt(t - T.sun); return toWorld(AT.sun, p[0], p[1]); }
  if (t < T.earth) return [routeX(EX.meterAt(t)), 540];        // the photon IS the meter: they can never disagree
  if (t < T.eye) return [lerp(XA, X_END, clamp((t - T.earth) / 6.2)), 540];   // final approach, slowed down
  const p = eyeAt(t - T.eye); return toWorld(AT.eye, p[0], p[1]);
}

/* ---------- 2 · world furniture ---------- */
const TICKS = [[100, '3000 万 km'], [200, '6000 万 km'], [300, '9000 万 km'], [400, '1.2 亿 km']].map(([m, km]) => ({ m, km, x: routeX(m) }));
/* orbit radius from the meter: light reaches Mercury's orbit after 0.39 × 499 s — consistent with the HUD, not to scale */
const ORBITS = [
  { name: '水星轨道', m: .387 * 499, side: -1, pr: 30, fill: '#C9C3D8' },
  { name: '金星轨道', m: .723 * 499, side: 1, pr: 46, fill: '#F3D9A0' },
].map((o) => { const R = routeX(o.m) - SUN.x, y = 540 + o.side * 190; return { ...o, R, px: SUN.x + Math.sqrt(R * R - 190 * 190), py: y }; });
const R_EORB = EARTH.x - SUN.x;

/* smooth closed blob through n jittered points (Catmull-Rom → cubic Bézier): continents, clouds */
function blobPath(r, cx, cy, rx, ry, n = 9) {
  const p = [...Array(n)].map((_, i) => { const a = i / n * Math.PI * 2, k = .65 + .55 * r(); return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]; });
  const f = (v) => v.toFixed(1);
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}
const STRIP = 1200;                                 // continents live on a strip that wraps around the globe
const LAND = (() => { const r = rng(21); return [...Array(7)].map((_, i) => `<path d="${blobPath(r, 80 + i * 170 + r() * 60, 170 + r() * 380, 70 + r() * 70, 50 + r() * 60)}"/>`).join(''); })();
const CLOUD = (() => { const r = rng(33); return [...Array(9)].map((_, i) => `<path d="${blobPath(r, 60 + i * 135, 120 + r() * 480, 60 + r() * 50, 12 + r() * 10, 7)}"/>`).join(''); })();

/* ---------- TECHNIQUE A · EX.backdrop: a canvas starfield fixed to the screen, behind the world ----------
   Parallax = each star layer moves by a fraction k of the camera pan and zooms by (1/s)^(2.2k): far layers (small k)
   barely move, near ones move more, so the flat canvas reads as depth. All of it is computed from EX.cam(t) and t,
   never from the previous frame. Stars wrap on a torus (W0 × H0) and are drawn in 3×3 copies, so zooming out
   (factor < 1) never shows an empty edge. Bright stars are one pre-rendered radial-gradient sprite stamped with
   drawImage — CSS filter: blur() on many elements is slow and blurs differently at every zoom. The canvas is opaque
   (it paints its own space gradient), which also hides the theme's dotted grid: a grid would read as graph paper. */
const W0 = 2400, H0 = 1500;
const mod = (v, m) => ((v % m) + m) % m;
EX.backdrop({
  html: `<canvas id="sky" width="1920" height="1080" style="position:absolute;left:0;top:0;width:1920px;height:1080px"></canvas>`,
  init(el) {
    const g = (this.g = el.querySelector('#sky').getContext('2d'));
    const sp = document.createElement('canvas'); sp.width = sp.height = 64;
    const sg = sp.getContext('2d'), gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.12, 'rgba(240,244,255,.85)');
    gr.addColorStop(.4, 'rgba(170,190,255,.16)'); gr.addColorStop(1, 'rgba(170,190,255,0)');
    sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64); this.sprite = sp;
    const r = rng(42);
    this.layers = [
      { k: .015, n: 560, size: [1, 2], a: [.25, .6] },
      { k: .04, n: 180, size: [1.6, 2.6], a: [.45, .9] },
      { k: .09, n: 46, size: [6, 13], a: [.55, 1], glow: true },
    ].map((L) => ({ ...L, stars: [...Array(L.n)].map(() => ({ x: r() * W0, y: r() * H0, sz: lerp(L.size[0], L.size[1], r()), a: lerp(L.a[0], L.a[1], r()), w: .6 + r() * 2.4, ph: r() * 6.3, warm: r() < .25 })) }));
    this.neb = [[420, 260, 760, '96,64,200'], [1560, 820, 860, '36,96,200'], [1180, 120, 520, '160,56,150'], [200, 900, 600, '30,120,170']];
    this.bgGrad = g.createRadialGradient(960, 470, 0, 960, 540, 1250);
    this.bgGrad.addColorStop(0, '#161C4A'); this.bgGrad.addColorStop(.55, '#0B0E2A'); this.bgGrad.addColorStop(1, '#04050F');
  },
  render(el, t) {
    const g = this.g, [cx, cy, s] = EX.cam(t);
    g.globalAlpha = 1; g.fillStyle = this.bgGrad; g.fillRect(0, 0, 1920, 1080);
    for (const [nx, ny, nr, c] of this.neb) {                         // nebulae: the farthest layer (k = 0.006)
      const z = Math.pow(1 / s, .02), x = 960 + (nx - 960 - cx * .006) * z, y = 540 + (ny - 540 - cy * .006) * z;
      const ng = g.createRadialGradient(x, y, 0, x, y, nr * z);
      ng.addColorStop(0, `rgba(${c},.30)`); ng.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = ng; g.fillRect(0, 0, 1920, 1080);
    }
    for (const L of this.layers) {
      const z = Math.pow(1 / s, L.k * 2.2);
      for (const st of L.stars) {
        const bx = mod(st.x - cx * L.k, W0) - W0 / 2, by = mod(st.y - cy * L.k, H0) - H0 / 2;
        const a = st.a * (.68 + .32 * Math.sin(t * st.w + st.ph));   // twinkle: a closed-form function of t
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const X = 960 + (bx + i * W0) * z, Y = 540 + (by + j * H0) * z;
          if (X < -40 || X > 1960 || Y < -40 || Y > 1120) continue;
          if (L.glow) { const S = st.sz * z * 4; g.globalAlpha = a; g.drawImage(this.sprite, X - S / 2, Y - S / 2, S, S); }
          else { g.globalAlpha = 1; g.fillStyle = st.warm ? `rgba(255,226,190,${a})` : `rgba(214,224,255,${a})`; g.fillRect(X, Y, st.sz * z, st.sz * z); }
        }
      }
    }
    g.globalAlpha = 1;
  },
});

/* ---------- TECHNIQUE B + C + H · EX.world: the places, the route and the protagonist ----------
   Everything here is in world px and is filmed by the camera like the shots. Things that are PLACES (Sun, Earth,
   route) live here, so they stay put while shots come and go; what a shot EXPLAINS (cut-away, labels) lives in the
   shot. TECHNIQUE C: the photon is a child of this layer with z-index, and this layer itself never gets opacity or
   transform — that would make it its own stacking context and the photon would sink under every shot again.
   Sizes that must look the same at every zoom (photon, beam, dashes) are world size × camera scale s. */
EX.world({
  html: `
    <svg class="abs" style="left:0;top:0;overflow:visible" width="16000" height="1080">
      ${ORBITS.map((o, i) => `<circle class="w-orb" cx="${SUN.x}" cy="${SUN.y}" r="${o.R.toFixed(0)}" fill="none" stroke="rgba(170,180,255,.28)"/>
        <circle cx="${o.px.toFixed(0)}" cy="${o.py}" r="${o.pr}" fill="${o.fill}"/>
        <circle cx="${(o.px - o.pr * .35).toFixed(0)}" cy="${o.py - o.pr * .35}" r="${o.pr * .45}" fill="rgba(255,255,255,.35)"/>`).join('')}
      <circle class="w-orb" id="w-eorb" cx="${SUN.x}" cy="${SUN.y}" r="${R_EORB}" fill="none" stroke="rgba(120,200,255,.3)"/>
      <line id="w-guide" x1="${SURF_X}" y1="540" x2="${X_END}" y2="540" stroke="rgba(255,226,160,.22)"/>
      ${[...Array(19)].map((_, i) => (i + 1) * 25).filter((m) => m % 100).map((m) => `<line x1="${routeX(m).toFixed(0)}" y1="528" x2="${routeX(m).toFixed(0)}" y2="552" stroke="rgba(255,226,160,.3)" stroke-width="4" stroke-linecap="round"/>`).join('')}
      ${TICKS.map((k) => `<line class="w-tick" x1="${k.x.toFixed(0)}" y1="512" x2="${k.x.toFixed(0)}" y2="568" stroke="rgba(255,226,160,.45)" stroke-width="5" stroke-linecap="round"/>`).join('')}
      <line id="w-glow" x1="${SURF_X}" y1="540" x2="${SURF_X}" y2="540" stroke="rgba(255,190,90,.28)" stroke-linecap="round"/>
      <line id="w-beam" x1="${SURF_X}" y1="540" x2="${SURF_X}" y2="540" stroke="#FFE9B5" stroke-linecap="round"/>
    </svg>
    <div class="abs" id="w-corona" style="width:1700px;height:1700px;border-radius:50%;background:radial-gradient(circle,rgba(255,196,90,.6) 0%,rgba(255,150,50,.28) 22%,rgba(255,120,40,.09) 42%,rgba(255,120,40,0) 62%)"></div>
    <div class="abs" id="w-rays" style="width:1500px;height:1500px;border-radius:50%;background:repeating-conic-gradient(rgba(255,214,130,.14) 0deg 2.5deg,rgba(255,214,130,0) 2.5deg 8deg);-webkit-mask-image:radial-gradient(circle,#000 24%,transparent 66%);mask-image:radial-gradient(circle,#000 24%,transparent 66%)"></div>
    <div class="abs" id="w-sun" style="width:${SUN.r * 2}px;height:${SUN.r * 2}px;border-radius:50%;background:radial-gradient(circle at 44% 42%,#FFFBE8 0%,#FFE490 22%,#FFB848 50%,#F47E22 80%,#D9520F 100%);box-shadow:0 0 140px 40px rgba(255,150,50,.45)"></div>
    <svg class="abs" style="left:${EARTH.x - 360}px;top:${EARTH.y - 360}px;overflow:visible" width="720" height="720">
      <defs>
        <radialGradient id="w-ocean" cx="38%" cy="42%" r="72%"><stop offset="0" stop-color="#6CB6FF"/><stop offset=".55" stop-color="#2F6FE4"/><stop offset="1" stop-color="#173A8C"/></radialGradient>
        <linearGradient id="w-night" x1="0" x2="1"><stop offset=".46" stop-color="#040716" stop-opacity="0"/><stop offset=".8" stop-color="#040716" stop-opacity=".9"/></linearGradient>
        <radialGradient id="w-limb"><stop offset=".7" stop-color="#0A1A50" stop-opacity="0"/><stop offset="1" stop-color="#0A1A50" stop-opacity=".55"/></radialGradient>
        <radialGradient id="w-atmo"><stop offset=".855" stop-color="#7DD3FC" stop-opacity="0"/><stop offset=".875" stop-color="#9BE0FF" stop-opacity=".85"/><stop offset=".93" stop-color="#7DD3FC" stop-opacity=".25"/><stop offset="1" stop-color="#7DD3FC" stop-opacity="0"/></radialGradient>
        <clipPath id="w-eclip"><circle cx="360" cy="360" r="${EARTH.r}"/></clipPath>
      </defs>
      <circle cx="360" cy="360" r="${EARTH.r}" fill="url(#w-ocean)"/>
      <g clip-path="url(#w-eclip)">
        <g id="w-land" fill="#5CCB8A">${LAND}<g transform="translate(${STRIP} 0)">${LAND}</g></g>
        <g id="w-cloud" fill="rgba(255,255,255,.55)">${CLOUD}<g transform="translate(${STRIP} 0)">${CLOUD}</g></g>
        <circle cx="360" cy="360" r="${EARTH.r}" fill="url(#w-limb)"/>
        <circle cx="360" cy="360" r="${EARTH.r}" fill="url(#w-night)"/>
        <ellipse cx="250" cy="250" rx="70" ry="44" fill="rgba(255,255,255,.10)"/>
      </g>
      <circle id="w-atmo-c" cx="360" cy="360" r="${(EARTH.r / .875).toFixed(0)}" fill="url(#w-atmo)"/>
    </svg>
    ${TICKS.map((k, i) => `<div class="abs w-lod w-tl" id="w-tl${i}" style="text-align:center;white-space:nowrap">
      <div style="font-size:46px;font-weight:900;font-variant-numeric:tabular-nums;color:#FFE2A8">${k.m} 秒</div><div style="font-size:34px;color:var(--ink2)">${k.km}</div></div>`).join('')}
    ${ORBITS.map((o) => `<div class="abs w-lod" style="left:${(o.px + o.pr + 26).toFixed(0)}px;top:${o.py - 30}px;font-size:40px;font-weight:700;color:var(--ink2);white-space:nowrap">${o.name}</div>`).join('')}
    <div class="abs" id="w-tail" style="width:560px;height:26px;border-radius:13px;z-index:3;background:linear-gradient(90deg,rgba(255,220,140,0),rgba(255,236,190,.9))"></div>
    <div class="abs" id="w-photon" style="width:96px;height:96px;border-radius:50%;z-index:4;background:radial-gradient(circle,#FFFFFF 0%,#FFFFFF 13%,rgba(255,244,200,.92) 22%,rgba(255,206,110,.42) 42%,rgba(255,170,60,0) 70%)"></div>`,
  init(el) {
    const $q = (s) => el.querySelector(s);
    this.q = { tail: $q('#w-tail'), photon: $q('#w-photon'), beam: $q('#w-beam'), glow: $q('#w-glow'), guide: $q('#w-guide'),
      sun: $q('#w-sun'), corona: $q('#w-corona'), rays: $q('#w-rays'), land: $q('#w-land'), cloud: $q('#w-cloud'), atmo: $q('#w-atmo-c'), eorb: $q('#w-eorb'),
      orbs: [...el.querySelectorAll('.w-orb')], ticks: [...el.querySelectorAll('.w-tick')], lod: [...el.querySelectorAll('.w-lod')], tl: [...el.querySelectorAll('.w-tl')] };
    this.q.tl.forEach((d, i) => EX.place(d, TICKS[i].x, 640));
  },
  render(el, t) {
    const q = this.q, s = EX.cam(t)[2];               // s = how much world one screen px shows right now
    const [px, py] = photonAt(t);
    /* C · the protagonist: world position from photonAt(t), screen-constant size (× s), a gentle pulse */
    EX.place(q.photon, px, py, s * (1 + .1 * Math.sin(t * 8)));
    const flying = t >= T.trip && t < T.eye;           // the comet tail only while it flies in a straight line
    const tailO = flying ? smooth(T.trip, T.trip + .4, t) * (1 - .6 * smooth(T.earth, T.earth + 1, t)) * (1 - smooth(T.earth + 5.8, T.earth + 6.3, t)) : 0;
    EX.place(q.tail, px - 280 * s, py, s, tailO);
    /* the beam: lit behind the photon, a faint dashed guide ahead. Stroke widths × s stay the same on screen. */
    const bx = t >= T.trip ? px : SURF_X;
    for (const [ln, w] of [[q.beam, 6], [q.glow, 30]]) { ln.setAttribute('x2', bx.toFixed(1)); ln.setAttribute('stroke-width', (w * s).toFixed(2)); ln.style.visibility = t >= T.trip ? '' : 'hidden'; }
    q.guide.setAttribute('stroke-width', (3 * s).toFixed(2)); q.guide.setAttribute('stroke-dasharray', `${16 * s} ${22 * s}`);
    q.orbs.forEach((o) => { o.setAttribute('stroke-width', (3 * s).toFixed(2)); o.setAttribute('stroke-dasharray', `${14 * s} ${18 * s}`); });
    /* H · level of detail: labels sized for s ≈ 1 fade out before the camera pulls back far enough to shrink them */
    const lod = 1 - smooth(1.6, 2.3, s);
    q.lod.forEach((d) => { d.style.opacity = lod; d.style.visibility = lod <= 0 ? 'hidden' : ''; });
    q.eorb.style.opacity = 1 - lod;                   // …and the reverse: Earth's orbit only reads from far away (up close it is a stray vertical line)
    TICKS.forEach((k, i) => { const lit = px >= k.x && t >= T.trip; q.ticks[i].setAttribute('stroke', lit ? '#FFD27A' : 'rgba(255,226,160,.45)'); q.tl[i].style.filter = ''; q.tl[i].firstElementChild.style.color = lit ? '#FFD27A' : 'rgba(255,226,168,.55)'; });
    /* places breathe: corona, slowly turning rays, Earth turning (land and clouds at different speeds) */
    EX.place(q.corona, SUN.x, SUN.y, 1 + .035 * Math.sin(t * 1.3));
    EX.place(q.rays, SUN.x, SUN.y, 1, 1, t * 2.5);
    EX.place(q.sun, SUN.x, SUN.y);
    q.land.setAttribute('transform', `translate(${(70 - mod(t * 9, STRIP)).toFixed(1)} 0)`);
    q.cloud.setAttribute('transform', `translate(${(70 - mod(t * 16, STRIP)).toFixed(1)} 0)`);
    const hit = t - (T.earth + 6.2);                   // the atmosphere flares when the photon crosses it
    q.atmo.setAttribute('opacity', (1 + (hit > 0 ? 1.2 * Math.exp(-3 * hit) : 0)).toFixed(3));
  },
});

/* ---------- shots ---------- */
EX.chapter('sun', { name: '太阳内部', color: EX.C.orange });
EX.chapter('space', { name: '穿越太空', color: EX.C.cyan });
EX.chapter('earth', { name: '抵达地球', color: EX.C.blue });

const LABEL = 'font-size:26px;color:var(--ink2);white-space:nowrap';
/* .mono (JetBrains Mono) only on pure numbers: CJK inside it falls back with monospace-wide spacing ("30 万 km").
   Mixed number + 汉字 → the sans font with font-variant-numeric: tabular-nums, so counting digits do not jitter. */

/* 1 · CORE — TECHNIQUE D, first half: this frame sits at scale 0.07 in the middle of the Sun, so everything here
   is 14× smaller in the world than it looks. The plasma disc (radius 1250 here = 87 world px) IS the core that the
   next shot shows as a small disc: same gradient, same size, so the pull-back reads as one continuous object.
   The random walk is drawn up to the photon's position from the same walkAt() the world layer uses. */
EX.shot({
  id: 'core', chapter: 'sun', dur: DUR.core, at: AT.core,
  caps: [[.3, '光子在太阳「核心」诞生。'], [3.5, '每撞一次换方向：「随机行走」。']],
  sfx: [[.8, 'blip', .35], [3.5, 'tick', .3]],
  html: `
    <div class="abs" style="left:-290px;top:-710px;width:2500px;height:2500px;border-radius:50%;background:radial-gradient(circle,#F59A44 0%,#E26A2A 26%,#B9411A 50%,#83250E 72%,rgba(96,22,8,.75) 88%,rgba(96,22,8,0) 100%)"></div>
    <div id="co-heat"></div><div id="co-nuc"></div>
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">
      <polyline id="co-trail-glow" fill="none" stroke="rgba(255,240,200,.25)" stroke-width="16" stroke-linejoin="round" stroke-linecap="round"/>
      <polyline id="co-trail" fill="none" stroke="#FFF6DD" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="14 10"/>
      <g id="co-rings">${WALK.slice(1).map(() => '<circle r="10" fill="none" stroke="#FFF1C8" stroke-width="4"/>').join('')}</g>
      <circle cx="960" cy="540" r="16" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="4"/>
    </svg>
    <div class="abs" id="co-start" style="left:890px;top:440px;padding:4px 16px;border-radius:999px;background:rgba(60,14,4,.72);color:#FFE9C2;font-size:24px;font-weight:700;white-space:nowrap">起点</div>
    <div class="abs card" id="co-temp" style="left:100px;top:216px;width:410px;padding:24px 34px">
      <div style="${LABEL}">太阳核心温度</div>
      <div style="font-size:60px;font-weight:900;color:#FFD08A;white-space:nowrap"><span class="mono">1500</span> 万 °C</div>
    </div>
    <div class="abs card" id="co-walk" style="left:1384px;top:640px;width:446px;padding:22px 34px">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="tag" style="--c:var(--orange);font-size:26px">随机行走</span><span style="${LABEL}">示意</span></div>
      <div style="display:flex;align-items:baseline;gap:14px;margin-top:12px;${LABEL}">已撞 <b class="mono" id="co-n" style="font-size:52px;color:#FFE2A8">0</b> 次</div>
      <div style="display:flex;align-items:baseline;gap:14px;${LABEL}">离起点只有 <b class="mono" id="co-d" style="font-size:40px;color:#FFE2A8">0</b> 步远</div>
    </div>`,
  init(el) {
    const r = rng(9), heat = el.querySelector('#co-heat'), nuc = el.querySelector('#co-nuc');
    const disc = (size, bg) => { const d = document.createElement('div'); d.className = 'abs'; d.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${bg}`; return d; };
    /* random layout made once, in init, from rng: heat shimmer blobs and hydrogen nuclei (the scatterers) */
    /* heat shimmer: six soft blobs as six backgrounds of ONE full-frame element (moved via background-position).
       Six separate 800 px divs would each count as a shape and trip the lint where they pass under the HUD. */
    this.heat = [...Array(6)].map(() => ({ z: 500 + r() * 400, x: 200 + r() * 1520, y: 200 + r() * 680, ph: r() * 6 }));
    heat.className = 'abs'; heat.style.cssText = 'left:0;top:0;width:1920px;height:1080px;background-repeat:no-repeat';
    heat.style.backgroundImage = this.heat.map(() => 'radial-gradient(circle closest-side,rgba(255,214,150,.22),rgba(255,214,150,0))').join(',');
    heat.style.backgroundSize = this.heat.map((h) => `${h.z | 0}px ${h.z | 0}px`).join(',');
    this.heatEl = heat;
    const NUC = 'radial-gradient(circle,#FFF6DE 0%,#FFD48E 32%,rgba(255,170,80,.35) 55%,rgba(255,170,80,0) 72%)';
    this.nuc = [...Array(52)].map(() => { const z = 34 + r() * 30; const d = disc(z, NUC); nuc.appendChild(d); return { d, x: 120 + r() * 1680, y: 200 + r() * 700, ph: r() * 6, hit: -1 }; });
    /* one nucleus at every turn of the walk: the photon visibly bounces off something */
    WALK.slice(1, -1).forEach((p, i) => { const d = disc(60, NUC); nuc.appendChild(d); this.nuc.push({ d, x: p[0], y: p[1], ph: i, hit: WALK_T0 + (i + 1) * WALK_STEP }); });
    this.q = { glow: el.querySelector('#co-trail-glow'), trail: el.querySelector('#co-trail'), rings: [...el.querySelectorAll('#co-rings circle')],
      temp: el.querySelector('#co-temp'), walk: el.querySelector('#co-walk'), n: el.querySelector('#co-n'), d: el.querySelector('#co-d'), start: el.querySelector('#co-start') };
    this.step = WALK.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - WALK[i][0], p[1] - WALK[i][1]), 0) / (WALK.length - 1);
  },
  render(el, u) {
    const q = this.q;
    this.heatEl.style.backgroundPosition = this.heat.map((h) => `${(h.x - h.z / 2 + 60 * Math.sin(u * .5 + h.ph)).toFixed(1)}px ${(h.y - h.z / 2 + 40 * Math.cos(u * .4 + h.ph)).toFixed(1)}px`).join(',');
    this.nuc.forEach((n) => {                                    // thermal jitter; a nucleus flashes when the photon hits it
      const flash = n.hit > 0 && u >= n.hit ? Math.exp(-6 * (u - n.hit)) : 0;
      const j = n.hit > 0 ? 3 : 9;
      EX.place(n.d, n.x + j * Math.sin(u * 3.1 + n.ph * 7), n.y + j * Math.cos(u * 2.6 + n.ph * 5), (n.hit > 0 ? 1 : .8) * (1 + .5 * flash), clamp(u / .5) * (n.hit > 0 ? 1 : .7));
    });
    const [x, y, k] = walkAt(u), i = Math.floor(k);
    const pts = WALK.slice(0, i + 1).concat([[x, y]]).map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    for (const pl of [q.glow, q.trail]) { pl.setAttribute('points', pts); pl.style.visibility = u > WALK_T0 ? '' : 'hidden'; }
    q.trail.setAttribute('stroke-dashoffset', (-u * 40).toFixed(1));   // the trail flows: motion while captions are read
    q.rings.forEach((c, j) => {                                  // collision ring at every turn: grows and fades in 0.6 s
      const age = u - (WALK_T0 + (j + 1) * WALK_STEP), on = age >= 0 && age < .6 && j < WALK.length - 2;
      c.setAttribute('cx', WALK[j + 1][0]); c.setAttribute('cy', WALK[j + 1][1]);
      c.setAttribute('r', (12 + 70 * expoOut(clamp(age / .6))).toFixed(1)); c.style.opacity = on ? 1 - age / .6 : 0;
    });
    EX.pop(q.temp, u, .3, { s0: .9 });
    EX.pop(q.walk, u, .6, { s0: .9 });
    EX.fadeUp(q.start, u, .4);
    q.n.textContent = Math.min(i, WALK.length - 2);
    q.d.textContent = (Math.hypot(x - 960, y - 540) / this.step).toFixed(1);   // √N law: net distance grows slowly
  },
});

/* 2 · SUN — TECHNIQUE D, second half: the fly from the 0.07 core frame to this 1.0 frame is a zoom-out around a
   fixed world point, so the viewer sees the core shrink into the middle of the Sun. Shot content that is text
   waits until the fly has landed (u > 1.6): during the fly it would sweep across the screen 14× too big.
   The cut-away is a half-plane clip (only the right half opens), drawn in layers: convection ring → radiative
   ring → core disc → boundary strokes; the plain left half is the world layer's Sun showing through. */
const CELLS = [...Array(7)].map((_, i) => { const a = (-78 + i * 26) * Math.PI / 180; return [SC[0] + 281 * Math.cos(a), SC[1] + 281 * Math.sin(a), i % 2 ? 1 : -1]; });
const CALLOUTS = [   /* dot on the layer, elbow, label row: one line per layer, labels stacked right of the Sun */
  { dot: [878, 488], elbow: [990, 250], y: 250, name: '核心', note: '约 1500 万 °C', c: '#FFD08A' },
  { dot: [1010, 420], elbow: [1100, 372], y: 372, name: '辐射层', note: '光子乱撞', c: '#FFB45E' },
  { dot: [1092, 700], elbow: [1150, 712], y: 712, name: '对流层', note: '热气团翻滚', c: '#FF8E4A' },
  { dot: [1094, 753], elbow: [1180, 832], y: 832, name: '表面', note: '约 5500 °C', c: '#FFE6A0' },
];
EX.shot({
  id: 'sun', chapter: 'sun', dur: DUR.sun, at: AT.sun, fly: 1.6,
  caps: [[.4, '拉远看：核心只是正中一小块。'], [3.9, '挤出「辐射层」，要花上万年。']],
  sfx: [[1.7, 'pop', .35], [6.5, 'reveal', .45]],
  html: `
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">
      <defs>
        <clipPath id="sn-clip"><rect id="sn-cliprect" x="${SC[0]}" y="150" width="0" height="780"/></clipPath>
        <radialGradient id="sn-g-core"><stop offset="0" stop-color="#F59A44"/><stop offset=".5" stop-color="#D45A22"/><stop offset="1" stop-color="#B9411A"/></radialGradient>
        <radialGradient id="sn-g-rad"><stop offset=".36" stop-color="#F08A3A"/><stop offset="1" stop-color="#D2602A"/></radialGradient>
        <radialGradient id="sn-g-conv"><stop offset=".7" stop-color="#C64E1C"/><stop offset="1" stop-color="#9C3210"/></radialGradient>
      </defs>
      <g clip-path="url(#sn-clip)">
        <circle cx="${SC[0]}" cy="540" r="${SUN.r}" fill="url(#sn-g-conv)"/>
        ${CELLS.map(([x, y]) => `<circle class="sn-cell" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="36" fill="none" stroke="rgba(255,214,160,.55)" stroke-width="5" stroke-dasharray="44 26" stroke-linecap="round"/>`).join('')}
        <circle cx="${SC[0]}" cy="540" r="${R_RAD}" fill="url(#sn-g-rad)"/>
        <g id="sn-rings">${[110, 134, 158, 182, 206].map((r) => `<circle cx="${SC[0]}" cy="540" r="${r}" fill="none" stroke="rgba(255,236,200,.16)" stroke-width="2" stroke-dasharray="3 10"/>`).join('')}</g>
        <circle cx="${SC[0]}" cy="540" r="${R_CORE}" fill="url(#sn-g-core)"/>
        <circle cx="${SC[0]}" cy="540" r="${R_CORE}" fill="none" stroke="rgba(255,240,210,.7)" stroke-width="3"/>
        <circle cx="${SC[0]}" cy="540" r="${R_RAD}" fill="none" stroke="rgba(255,240,210,.5)" stroke-width="3"/>
        <polyline id="sn-trail" fill="none" stroke="#FFF6DD" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
      </g>
      <line id="sn-cut" x1="${SC[0]}" y1="${540 - SUN.r}" x2="${SC[0]}" y2="${540 + SUN.r}" stroke="rgba(255,244,220,.85)" stroke-width="4"/>
      ${CALLOUTS.map((c, i) => `<g id="sn-co${i}"><polyline points="${c.dot.join(',')} ${c.elbow.join(',')} 1236,${c.y}" fill="none" stroke="rgba(255,244,220,.75)" stroke-width="3"/>
        <circle cx="${c.dot[0]}" cy="${c.dot[1]}" r="9" fill="${c.c}" stroke="#2A0E04" stroke-width="3"/></g>`).join('')}
    </svg>
    ${CALLOUTS.map((c, i) => `<div class="abs" id="sn-lb${i}" style="left:1250px;top:${c.y - 30}px;display:flex;align-items:baseline;gap:16px;white-space:nowrap">
      <b style="font-size:36px;color:${c.c}">${c.name}</b><span style="font-size:28px;color:var(--ink2)">${c.note}</span></div>`).join('')}
    <div class="abs card" id="sn-years" style="left:96px;top:392px;width:400px;padding:26px 32px">
      <div style="display:flex;justify-content:space-between;align-items:center"><span style="${LABEL}">从核心挤到表面</span><span class="tag" style="--c:var(--orange);font-size:24px;padding:4px 16px">示意</span></div>
      <div style="font-size:52px;font-weight:900;color:#FFE2A8;white-space:nowrap;margin-top:8px">1 万–17 万 年</div>
      <div style="height:14px;border-radius:7px;background:rgba(255,255,255,.1);margin-top:16px;overflow:hidden"><div id="sn-bar" style="height:100%;width:0;border-radius:7px;background:linear-gradient(90deg,#F59E0B,#FFE2A8)"></div></div>
    </div>`,
  init(el) {
    this.q = { clip: el.querySelector('#sn-cliprect'), trail: el.querySelector('#sn-trail'), cells: [...el.querySelectorAll('.sn-cell')], rings: el.querySelector('#sn-rings'),
      cut: el.querySelector('#sn-cut'), co: CALLOUTS.map((_, i) => el.querySelector('#sn-co' + i)), lb: CALLOUTS.map((_, i) => el.querySelector('#sn-lb' + i)),
      years: el.querySelector('#sn-years'), bar: el.querySelector('#sn-bar') };
  },
  render(el, u, d) {
    const q = this.q;
    q.clip.setAttribute('width', (SUN.r + 10) * cubic(prog(u, .1, 1.0)));      // skeleton: cut-away open by u = 1 s
    q.cut.style.opacity = prog(u, .1, .4);
    q.cells.forEach((c, i) => c.setAttribute('stroke-dashoffset', ((i % 2 ? 1 : -1) * u * 50).toFixed(1)));   // convection rolls
    q.rings.setAttribute('transform', `rotate(${(u * 6).toFixed(2)} ${SC[0]} 540)`);
    const [x, y, k] = zigAt(u), i = Math.min(ZIG.length - 1, Math.floor(k));
    const path = k < ZIG.length - 1 ? ZIG.slice(0, i + 1).concat([[x, y]]) : ZIG.concat([[x, y]]);
    q.trail.setAttribute('points', path.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
    q.trail.style.visibility = u > ZIG_T0 ? '' : 'hidden';
    /* text after the fly has landed (fly 1.6 s); each label lights up when the photon reaches its layer */
    const reach = [ZIG_T0, ZIG_T0 + .4, ZIG_T1, ROLL_T1];
    CALLOUTS.forEach((c, j) => {
      const a = 1.6 + j * .12, lit = u >= reach[j];
      q.co[j].style.opacity = clamp((u - a) / .3) * (lit ? 1 : .45);
      EX.fadeUp(q.lb[j], u, a, 1e9, 16);
      q.lb[j].style.opacity = Math.min(+q.lb[j].style.opacity, lit ? 1 : .5);
    });
    EX.pop(q.years, u, 1.7, { s0: .9 });
    q.bar.style.width = (100 * prog(u, ZIG_T0, ROLL_T1)) + '%';
  },
});

/* 3 · TRIP — TECHNIQUE E: a custom camera. cam(u, d) returns [x, y, s] in world px. It follows the photon
   (whose x comes from the meter), looks ahead of it and pulls back to s 1.35 in the middle so more route is in view,
   then settles to the earth shot's frame (TECHNIQUE F). The HUD meter, the photon and the camera all derive from
   the same m(u), so the "100 秒" marker passes under the photon exactly when the meter reads 100.
   Two ways to keep shot content on screen while the camera travels: the speed card rides with the photon
   (world position + offset × s), the minimap is pinned to the screen (inverse camera: screen px → world → shot px).
   The minimap also carries the honest scale the long world cannot: Mercury at 0.39, Venus at 0.72 of the way. */
const MAP = [   /* minimap: true proportions of the route (x = 90 + 1000 × fraction of 1 AU) */
  { name: '太阳', x: 90, r: 18, c: '#FFC45A' }, { name: '水星轨道', x: 90 + 387, r: 7, c: '#C9C3D8' },
  { name: '金星轨道', x: 90 + 723, r: 9, c: '#F3D9A0' }, { name: '地球', x: 1090, r: 10, c: '#7FB4FF' },
];
EX.shot({
  id: 'trip', chapter: 'space', dur: DUR.trip, at: AT.trip, fly: 1.0, meter: [0, M_TRIP],
  caps: [[.4, '离开表面，以「光速」直线飞行。'], [4.6, '每秒 30 万公里，也要 8 分多钟。']],
  sfx: [[2.0, 'tick', .25], [3.7, 'tick', .25], [5.5, 'tick', .25], [7.2, 'tick', .25]],
  cam(u, d) {
    const px = routeX(M_TRIP * u / d);                 // the photon: same as routeX(EX.meterAt(t)) in photonAt
    const wide = smooth(0, 2.4, u) * (1 - smooth(d - 2.6, d, u)), settle = smooth(d - 2.6, d, u);
    return [px + 260 * wide + 540 * settle, 540, 1 + .35 * wide];   // at u = d: exactly AT.earth → seamless cut
  },
  html: `
    <div class="abs card" id="tr-speed" style="padding:18px 30px;display:flex;align-items:center;gap:22px;white-space:nowrap">
      <div><div style="${LABEL}">光速 · 每秒</div><div style="font-size:44px;font-weight:900;color:#7FE3F5">30 万 km</div></div>
      <div style="width:2px;height:70px;background:var(--line)"></div>
      <div><div style="${LABEL}">已飞</div><div id="tr-km" style="font-size:44px;font-weight:900;font-variant-numeric:tabular-nums;color:var(--ink);min-width:230px">0 km</div></div>
    </div>
    <div class="abs card" id="tr-map" style="width:1180px;height:132px;padding:0">
      <svg class="abs" style="left:0;top:0;overflow:visible" width="1180" height="132">
        <line x1="90" y1="78" x2="1090" y2="78" stroke="rgba(255,226,160,.3)" stroke-width="4" stroke-dasharray="8 10"/>
        <line id="tr-map-done" x1="90" y1="78" x2="90" y2="78" stroke="#FFE2A8" stroke-width="6" stroke-linecap="round"/>
        ${MAP.map((p) => `<circle cx="${p.x.toFixed(0)}" cy="78" r="${p.r}" fill="${p.c}"/>`).join('')}
        <circle id="tr-map-dot" cx="90" cy="78" r="11" fill="#FFFFFF" stroke="#FFD27A" stroke-width="5"/>
      </svg>
      ${MAP.map((p) => `<div class="abs" style="left:${p.x.toFixed(0)}px;top:16px;transform:translateX(-50%);font-size:24px;font-weight:700;color:${p.c};white-space:nowrap">${p.name}</div>`).join('')}
      <div class="abs" style="right:28px;bottom:6px;font-size:22px;color:var(--ink3);white-space:nowrap">示意 · 大小未按比例</div>
    </div>`,
  init(el) { const g = (s) => el.querySelector(s); this.q = { speed: g('#tr-speed'), km: g('#tr-km'), map: g('#tr-map'), done: g('#tr-map-done'), dot: g('#tr-map-dot') }; },
  render(el, u, d, t) {
    const q = this.q, [cx, cy, s] = EX.cam(t), [px, py] = photonAt(t);
    const out = 1 - smooth(d - .5, d - .1, u);                        // gone before the cut: the next shot has its own cards
    const [sx, sy] = toShot(AT.trip, px, py - 175 * s);                // rides with the photon, 175 screen px above it
    EX.place(q.speed, sx, sy, s, clamp((u - .5) / .4) * out);
    const m = EX.meterAt(t) * 299792;                                   // km flown, from the same meter as the HUD
    q.km.textContent = m < 1e8 ? Math.round(m / 1e4).toLocaleString('en-US') + ' 万 km' : (m / 1e8).toFixed(2) + ' 亿 km';
    /* the minimap is pinned to the screen: screen px → world px (inverse camera) → this shot's px, scale × s */
    const [nx, ny] = toShot(AT.trip, cx + (960 - 960) * s, cy + (800 - 540) * s);   // screen (960, 800)
    EX.place(q.map, nx, ny, s, clamp((u - .8) / .4) * out);
    const mx = (90 + 1000 * EX.meterAt(t) / 499).toFixed(1);          // map x is distance = time × light speed
    q.done.setAttribute('x2', mx); q.dot.setAttribute('cx', mx);
  },
});

/* 4 · EARTH — enter: 'cut' because the trip camera ended exactly on this frame (TECHNIQUE F): no fade, no jump.
   The meter slows to a crawl (498 → 499.9 s) and the rate pill switches itself from 快进 to 慢放. The big clock is
   EX.meterAt(t) formatted as minutes:seconds, so it always agrees with the HUD. Text fades out by the end of the
   shot: the next fly pushes in 20×, and cards still on screen would balloon past the camera. */
EX.shot({
  id: 'earth', chapter: 'earth', dur: DUR.earth, at: AT.earth, enter: 'cut', meter: [M_TRIP, M_EARTH],
  caps: [[.3, '约 500 秒后，抵达「地球」。'], [3.8, '冲进大气层，落向一只眼睛。']],
  sfx: [[6.2, 'chime', .5]],
  html: `
    <div class="abs card" id="ea-clock" style="left:110px;top:206px;width:500px;padding:24px 36px">
      <div style="${LABEL}">离开太阳表面已经</div>
      <div style="display:flex;align-items:baseline;gap:10px;white-space:nowrap"><b class="mono" id="ea-min" style="font-size:84px;color:#7FB4FF">8</b><span style="font-size:36px;color:var(--ink2)">分</span>
        <b class="mono" id="ea-sec" style="font-size:84px;color:#7FB4FF">18</b><span style="font-size:36px;color:var(--ink2)">秒</span></div>
    </div>
    <div class="abs card" id="ea-dist" style="left:110px;top:690px;width:500px;padding:22px 36px">
      <div style="${LABEL}">日地距离</div>
      <div style="font-size:56px;font-weight:900;white-space:nowrap">约 <span class="mono">1.5</span> 亿 km</div>
    </div>
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">
      <polyline id="ea-lead" points="1004,330 1120,236 1460,236" fill="none" stroke="rgba(190,230,255,.8)" stroke-width="3"/>
      <circle id="ea-dot" cx="1004" cy="330" r="9" fill="#9BE0FF" stroke="#0B1440" stroke-width="3"/>
    </svg>
    <div class="abs" id="ea-atmo" style="left:1470px;top:204px;white-space:nowrap"><b style="font-size:36px;color:#9BE0FF">大气层</b><div style="font-size:28px;color:var(--ink2)">只有约 100 km 厚</div></div>`,
  init(el) { const g = (s) => el.querySelector(s); this.q = { clock: g('#ea-clock'), dist: g('#ea-dist'), min: g('#ea-min'), sec: g('#ea-sec'), lead: g('#ea-lead'), dot: g('#ea-dot'), atmo: g('#ea-atmo') }; },
  render(el, u, d, t) {
    const q = this.q, end = d + .45;                                 // every card fades out by u = d + 0.45
    EX.pop(q.clock, u, .2, { s0: .9 }); EX.fadeOut(q.clock, u, d - .1, .5);
    EX.pop(q.dist, u, .45, { s0: .9 }); EX.fadeOut(q.dist, u, d - .1, .5);
    const sec = Math.round(EX.meterAt(t));                           // 498 → 500: 8 分 18 秒 → 8 分 20 秒
    q.min.textContent = Math.floor(sec / 60); q.sec.textContent = String(sec % 60).padStart(2, '0');
    EX.drawPath(q.lead, expoOut(prog(u, .7, 1.3)) * (1 - prog(u, d - .1, end)));
    q.dot.style.opacity = clamp((u - .7) / .2) * (1 - prog(u, d - .1, end));
    EX.fadeUp(q.atmo, u, 1.0, end);
  },
});

/* 5 · EYE — TECHNIQUE G: this frame is a 0.05-scale patch of Earth's sunlit limb, so the fly from the earth shot is
   a 20× push into that spot. While the camera is still far out the whole frame is a speck; elements grow into view.
   A dark radial disc (opaque over the frame, transparent at its rim far outside it — never a hard rectangle) covers
   the Earth behind: during the fly it reads as a dark spot on the limb growing until it fills the screen.
   The eye is a cross-section in layers: optic nerve → white of the eye → dark interior → retina → lens → cornea → iris.
   Five parallel sun rays bend at the cornea and meet on the retina; the middle one is our photon. */
const RAYS = [-110, -55, 0, 55, 110].map((dy) => { const y = 540 + dy, cx = 879.1 - Math.sqrt(139.1 ** 2 - dy * dy); return `M80 ${y} L${cx.toFixed(1)} ${y} L${RETINA[0]} 540`; });
const EYE_LABELS = [   /* tag centre, leader points (tag edge → part) */
  { id: 'ey-l0', x: 640, y: 352, pts: '640,380 700,430 752,470', name: '角膜' },
  { id: 'ey-l1', x: 700, y: 832, pts: '700,804 820,700 868,628', name: '晶状体' },
  { id: 'ey-l2', x: 1540, y: 262, pts: '1540,290 1420,330 1342,420', name: '视网膜' },
  { id: 'ey-l3', x: 1660, y: 772, pts: '1660,744 1640,690', name: '视神经' },
];
EX.shot({
  id: 'eye', chapter: 'earth', dur: DUR.eye, at: AT.eye, fly: 1.6, meter: [M_EARTH, 500],
  caps: [[.3, '穿过「瞳孔」，落在视网膜上。'], [3.8, '你看到的，是 8 分钟前的太阳。']],
  sfx: [[EYE_T1, 'pop', .6], [5.1, 'chime', .4]],
  html: `
    <div class="abs" style="left:-540px;top:-960px;width:3000px;height:3000px;border-radius:50%;background:radial-gradient(circle,#1A2150 0%,#0B0F2C 30%,#080B22 38%,rgba(8,11,34,0) 50%)"></div>
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">
      <defs>
        <radialGradient id="ey-sclera" cx="42%" cy="38%" r="68%"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".7" stop-color="#E3E8F6"/><stop offset="1" stop-color="#AEB8D8"/></radialGradient>
        <radialGradient id="ey-vit" cx="40%" cy="45%" r="62%"><stop offset="0" stop-color="#34407A"/><stop offset="1" stop-color="#171D45"/></radialGradient>
        <linearGradient id="ey-lens" x1="0" x2="1"><stop offset="0" stop-color="#E2F2FF" stop-opacity=".95"/><stop offset="1" stop-color="#86B8EE" stop-opacity=".8"/></linearGradient>
        <linearGradient id="ey-iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5A9BE6"/><stop offset="1" stop-color="#2557A6"/></linearGradient>
        <linearGradient id="ey-nerve" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3D58E"/><stop offset="1" stop-color="#C9A04E"/></linearGradient>
        <radialGradient id="ey-flash"><stop offset="0" stop-color="#FFFBEA"/><stop offset=".3" stop-color="#FFD27A" stop-opacity=".85"/><stop offset="1" stop-color="#FFB040" stop-opacity="0"/></radialGradient>
      </defs>
      <circle cx="1100" cy="540" r="372" fill="rgba(130,170,255,.08)"/>
      <path id="ey-nervepath" d="M1360 590 C1480 640 1600 668 1860 668" fill="none" stroke="url(#ey-nerve)" stroke-width="58" stroke-linecap="round"/>
      <path d="M1360 590 C1480 640 1600 668 1860 668" fill="none" stroke="rgba(255,246,214,.55)" stroke-width="14" stroke-linecap="round"/>
      <circle cx="1100" cy="540" r="300" fill="url(#ey-sclera)"/>
      <circle cx="1100" cy="540" r="274" fill="url(#ey-vit)"/>
      <path id="ey-retina" d="${[...Array(29)].map((_, i) => { const a = (-70 + i * 5) * Math.PI / 180; return (i ? 'L' : 'M') + (1100 + 263 * Math.cos(a)).toFixed(1) + ' ' + (540 + 263 * Math.sin(a)).toFixed(1); }).join(' ')}" fill="none" stroke="#EE6F86" stroke-width="20" stroke-linecap="round"/>
      <path d="M829.6 410 A139.1 139.1 0 0 0 829.6 670 Z" fill="rgba(196,228,255,.38)" stroke="rgba(226,244,255,.95)" stroke-width="5"/>
      <rect x="822" y="420" width="18" height="72" rx="8" fill="url(#ey-iris)"/><rect x="822" y="588" width="18" height="72" rx="8" fill="url(#ey-iris)"/>
      <ellipse cx="884" cy="540" rx="40" ry="100" fill="url(#ey-lens)" stroke="rgba(255,255,255,.7)" stroke-width="3"/>
      <ellipse cx="770" cy="470" rx="16" ry="34" fill="rgba(255,255,255,.55)" transform="rotate(25 770 470)"/>
      ${RAYS.map((p, i) => `<path class="ey-ray" d="${p}" fill="none" stroke="${i === 2 ? '#FFF3CC' : 'rgba(255,226,150,.55)'}" stroke-width="${i === 2 ? 6 : 4}" stroke-linecap="round"/>`).join('')}
      <circle id="ey-hit" cx="${RETINA[0]}" cy="540" r="110" fill="url(#ey-flash)"/>
      <circle id="ey-sig" r="16" fill="#FFF6D6"/>
      ${EYE_LABELS.map((l) => `<polyline id="${l.id}-ln" points="${l.pts}" fill="none" stroke="rgba(230,240,255,.8)" stroke-width="3"/>`).join('')}
    </svg>
    ${EYE_LABELS.map((l) => `<div class="abs tag" id="${l.id}" style="--c:#9CC2FF;font-size:30px">${l.name}</div>`).join('')}
    <div class="abs card" id="ey-ago" style="left:100px;top:204px;width:390px;padding:22px 32px">
      <div style="${LABEL}">打在视网膜上的光</div>
      <div style="font-size:46px;font-weight:900;white-space:nowrap;color:#FFE2A8">8 分 20 秒前</div>
      <div style="${LABEL}">才离开太阳</div>
    </div>`,
  init(el) {
    const g = (s) => el.querySelector(s);
    this.q = { rays: [...el.querySelectorAll('.ey-ray')], flash: g('#ey-hit'), sig: g('#ey-sig'), nerve: g('#ey-nervepath'), retina: g('#ey-retina'), ago: g('#ey-ago'),
      tags: EYE_LABELS.map((l) => g('#' + l.id)), lines: EYE_LABELS.map((l) => g('#' + l.id + '-ln')) };
    this.nl = this.q.nerve.getTotalLength();
  },
  render(el, u) {
    const q = this.q, p = clamp((u - EYE_T0) / (EYE_T1 - EYE_T0));
    q.rays.forEach((r, i) => EX.drawPath(r, p * (i === 2 ? 1 : .985)));   // ray fronts move with the photon
    const age = u - EYE_T1, hit = age >= 0 ? Math.exp(-2.2 * age) : 0;
    q.flash.style.opacity = age >= 0 ? .35 + .65 * hit : 0;
    q.flash.setAttribute('r', (60 + 90 * expoOut(clamp(age / .5))).toFixed(1));
    q.retina.setAttribute('stroke', age >= 0 ? '#FF8FA2' : '#EE6F86');
    const sp = prog(u, EYE_T1 + .2, EYE_T1 + 1.6), pt = q.nerve.getPointAtLength(this.nl * sp);   // signal runs to the brain
    q.sig.setAttribute('cx', pt.x.toFixed(1)); q.sig.setAttribute('cy', pt.y.toFixed(1));
    q.sig.style.opacity = sp > 0 && sp < 1 ? 1 : 0;
    /* labels: the part's tag pops when the photon reaches it (cornea, lens, retina, then the nerve) */
    const at = [EYE_T0 + .9, EYE_T0 + 1.25, EYE_T1, EYE_T1 + .5];
    EYE_LABELS.forEach((l, i) => { EX.place(q.tags[i], l.x, l.y, spring(u - at[i], 16, .55), clamp((u - at[i]) / .15)); EX.drawPath(q.lines[i], expoOut(prog(u, at[i], at[i] + .4))); });
    EX.pop(q.ago, u, 5.0, { s0: .9 });
  },
});

/* 6 · END — the camera pulls back 156× (s 0.05 → 7.8) to show the whole journey as one line. This frame is at
   scale 7.8, so its text would cover the screen at 20× size during the fly: everything waits for the landing. */
const sunScreen = toShot(AT.end, SUN.x, SUN.y), earthScreen = toShot(AT.end, EARTH.x, EARTH.y);
EX.shot({
  id: 'end', chapter: null, dur: DUR.end, at: AT.end, fly: 2.0, hud: false,
  caps: [[2.3, '每一缕阳光，都走过这一趟。']],
  sfx: [[2.0, 'reveal', .5]],
  html: `
    <div class="abs t-hero" id="en-title" style="left:360px;width:1200px;top:220px;text-align:center">阳光到你眼里</div>
    <div class="abs t-h2" id="en-sub" style="left:460px;width:1000px;top:668px;text-align:center;white-space:nowrap"><span class="mono">1.5</span> 亿 km · <span style="color:#FFD27A">8 分 20 秒</span></div>
    <div class="abs t-h3" id="en-sun" style="white-space:nowrap;color:#FFD27A">太阳</div>
    <div class="abs t-h3" id="en-earth" style="white-space:nowrap;color:#9BE0FF">地球</div>`,
  init(el) {
    const g = (s) => el.querySelector(s);
    this.q = { title: g('#en-title'), sub: g('#en-sub'), sun: g('#en-sun'), earth: g('#en-earth') };
    splitChars(this.q.title);                                         // once; riseChars(el, u, start) reveals glyph by glyph
  },
  render(el, u) {
    const q = this.q;
    riseChars(q.title, u, 1.9);
    EX.fadeUp(q.sub, u, 2.4);
    EX.place(q.sun, sunScreen[0] + 40, sunScreen[1] + 110, 1, clamp((u - 2.0) / .4));
    EX.place(q.earth, earthScreen[0] - 40, earthScreen[1] + 110, 1, clamp((u - 2.0) / .4));
  },
});

EX.run({
  theme: 'dark',
  meter: { label: '离开表面', unit: '秒', decimals: 0, max: 500, ticks: [0, 100, 200, 300, 400, 500] },
  mood: 'calm',
});
