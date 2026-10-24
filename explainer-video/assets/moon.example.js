/* moon.example.js — 「为什么月亮总是同一面朝着我们」 · a cinema-mode film: 6 shots, 51 s at 75 bpm, light.js only.
   Setup: cp moon.example.js shots.js (it is an ES module; light.js is next to it after init.sh). No three.js, no images:
   every pixel is Canvas 2D, so stills take seconds and the film renders fast.
   This is the bar for 电影模式 (see the 先选模式 table in references/worlds.md): ONE luminous subject per frame,
   darkness around it, light doing the explaining, motion that obeys a law, at most one short label, no HUD, no cards.

   ┌─ ART DIRECTION (every film writes this card first; every shot obeys it) ─────────────────────────────────────┐
   │ style      lunar night: one glowing body in deep darkness, like the Opus showcase orbit / bokeh / moon clips │
   │ palette    ground #020205 · moon silver white #F4F2EE · ONE accent, tidal amber #FFB86B (the bulge, the       │
   │            pointer, its trail, the 「term」) · Earth only as a cool blue rim #7FA8FF · nothing else          │
   │ type       captions only: Noto Sans SC 400, 36 px, wide tracking, unboxed; one mono label in the whole film  │
   │ materials  light, not surfaces: a Lommel–Seeliger lit globe (LIGHT.sphere), bloom, haze, bokeh, trails      │
   │ post       LIGHT.glow on every canvas · vignette .5 · grain 6 (encode) · motion blur (--subframes 2–3)      │
   │ motion     physical laws only: Kepler-steady orbit, spin decaying exponentially to the orbital rate,       │
   │            tidal field lines (2x, −y), libration as two sines; slow push-ins, never a pop or a bounce       │
   │ transition dip through darkness (light down, cut, light up); a continuity cut where the picture continues │
   │ chrome     theme 'dark' + chrome 'cinema', hud: false on every shot, composition: 'cinema'                │
   └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘

   Facts (PLAN.md fact table; 示意 = schematic):
     - Tidal locking: Earth's gravity raised tidal bulges on the young Moon; while the Moon spun faster than it orbited,
       the bulges were carried ahead of the Earth–Moon line, Earth's pull on them braked the spin (tidal friction),
       until rotation period = orbital period ≈ 27.3 days (sidereal month). Now one hemisphere always faces Earth.
     - Libration (天平动: longitude ≈ ±7.9°, latitude ≈ ±6.7°) lets us see about 59% of the surface over time.
     - The far side is not dark: at new moon the near side faces away from the Sun and the far side is fully lit.
     - The far side has almost no maria (Mare Moscoviense is the main one); the near-side map is drawn from real
       mare positions (Imbrium, Serenitatis, Tranquillitatis, Crisium, Procellarum…), so the face is recognisable.
     - 示意: distances, sizes, the bulge's lead angle (really ~1°, drawn larger), the libration amplitude (drawn 2.5×,
       or the extra edge would be 3 px wide), spin-down speed (really ~10⁷–10⁸ years).

   Technique index (search for "TECHNIQUE ·"):
     A  one canvas per shot, transparent over the dark stage; breath() dips each shot's light through black
     B  the Moon: a procedural equirectangular albedo map from real mare positions + LIGHT.sphere (lit globe)
     C  the order of a luminous frame: haze → subject → LIGHT.glow → bokeh in front
     D  a physical field made visible: LIGHT.flow with the tidal field (2x, −y) around the Moon
     E  closed-form spin-down: ω(u) = n + (ω0 − n)·e^(−u/τ) integrated analytically; LIGHT.trail draws the epicycle
     F  libration and the sweeping sun as view-space vectors (sphere lon / lat / sun), no 3D engine
     G  a silhouette scene: lake glitter path as closed-form shimmer, a figure cut out of the light */
import './light.js';

const B = EX.tempo(75);                                                   // B(1) = 0.8 s
const DUR = { face: B(9), young: B(11), lock: B(13), nod: B(10), far: B(11), end: B(10) };   // 64 beats = 51.2 s
const ACC = '#FFB86B', INK = '#E9E4DA', INK2 = '#8F8A82', MOONC = '#F4F2EE', EARTHC = '#7FA8FF';
const D2R = Math.PI / 180;
/* chapters only colour the 「term」 in captions (the HUD is off): every chapter uses the one accent */
EX.chapter('lock', { name: '潮汐锁定', color: ACC });
EX.chapter('see', { name: '天平动', color: ACC });
EX.chapter('far', { name: '背面', color: ACC });

document.head.insertAdjacentHTML('beforeend', `<style>
  /* near-black stage (the canvases are transparent: this is the colour of space); #bg (pastel blobs) off */
  #stage.theme-dark{--hud-ink:${INK};--hud-ink2:${INK2};background:#020205}
  #bg{display:none}
  #stage.chrome-cinema #cap-pill{font-weight:400;font-size:36px;letter-spacing:.08em;bottom:70px}
  .mn-label{position:absolute;font:400 26px/1 'JetBrains Mono','Noto Sans SC',monospace;letter-spacing:.14em;color:${INK};
    white-space:nowrap;text-shadow:0 0 18px rgba(0,0,0,.9)}
</style>`);

/* ---------- TECHNIQUE A · one transparent canvas per shot ----------
   Transparent, so anything not drawn is the stage's near-black. clearRect every frame (never accumulate: frames
   must be pure). The shots enter with 'cut' and breath() fades the canvas, see below. */
const CANVAS = '<canvas width="1920" height="1080" style="position:absolute;left:0;top:0;width:1920px;height:1080px"></canvas>';
const canvasOf = (el) => el.querySelector('canvas').getContext('2d');
const smooth = (a, b, x) => { const p = clamp((x - a) / (b - a)); return p * p * (3 - 2 * p); };
/* dip through darkness instead of a dissolve: two bright moons cross-fading at different places read as a ghosted
   double exposure. Each shot brings its own light up (fin s) and takes it down (fout s); the next shot enters with
   'cut' and starts from black. Shots that continue the same picture (nod → far) skip the dip on that side. */
function breath(el, u, d, fin = 1.2, fout = .7) {
  const o = Math.min(fin ? expoOut(prog(u, 0, fin)) : 1, fout ? 1 - cubic(prog(u, d - fout, d)) : 1);
  el.querySelector('canvas').style.opacity = o;
  return o;
}

/* ---------- TECHNIQUE B · the Moon's albedo map, painted once from real mare positions ----------
   Equirectangular: x = selenographic longitude −180…180° (0 = the point facing Earth, + = east, drawn on the right
   as seen from Earth), y = latitude 90…−90°. A blob of angular radius ρ at latitude φ is an ellipse ρ/cos φ wide.
   Maria are clusters of soft dark blobs (irregular edges), craters are seeded rings (power-law sizes, fewer on the
   maria), ray craters get thin bright rays. Grey only; LIGHT.sphere's tint warms it. */
const MARIA = [   // chains of [lon, lat, radius°] from real near-side maria (+ the far side's few dark spots); a chain is
                  // filled along its length, so a mare is one connected, irregular shape and not a row of spots
  [[-74, 32, 9], [-63, 22, 12], [-55, 10, 13], [-50, -2, 11], [-44, -12, 8]], [[-66, 42, 7], [-52, 36, 8], [-38, 32, 9]],   // Procellarum
  [[-30, 42, 10], [-16, 34, 13], [-4, 29, 8]], [[17, 27, 9]], [[22, 14, 7], [31, 8, 10], [40, 2, 7]],   // Imbrium, Serenitatis, Tranquillitatis
  [[5, 14, 4], [-2, 4, 4]], [[47, -2, 6], [52, -11, 7]], [[35, -15, 5]], [[-24, -10, 5], [-20, -18, 7], [-14, -24, 7]],   // Vaporum–Medii, Fecunditatis, Nectaris, Cognitum–Nubium
  [[-39, -24, 5]], [[-42, 58, 3.2], [-25, 55, 3.8], [-8, 57, 3.4], [8, 56, 3.8], [24, 58, 3.2], [40, 55, 2.6]], [[59, 17, 7]],   // Humorum, Frigoris, Crisium
  [[-62, -30, 4]], [[85, 2, 5]], [[87, 20, 4]], [[147, 27, 4]], [[129, -21, 2]],                             // limb maria; far side: Moscoviense, Tsiolkovskiy
].map((chain) => chain.flatMap((p, i) => {                                  // resample each chain every ~0.45 radius
  if (i === 0) return [p];
  const q = chain[i - 1], n = Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / (.45 * Math.min(p[2], q[2])));
  return [...Array(n)].map((_, k) => q.map((v, j) => lerp(v, p[j], (k + 1) / n)));
})).flat();
const RAYS = [[-11, -43, 1, 34], [-20, 10, .8, 22], [-38, 8, .55, 14], [-47, 24, .4, 8], [180 - 23, -5, .5, 12]];  // Tycho, Copernicus, Kepler, Aristarchus, far-side ray crater
/* value noise, periodic across the map width (no seam at ±180°): noise(x, y, octaves) in 0…1, x / y in cells */
function valueNoise(w, seed) {
  const r = rng(seed), S = 512, T = new Float32Array(S * S).map(() => r());
  return (x, y, oct) => {
    let v = 0, a = .5, norm = 0, f = 1;
    for (let o = 0; o < oct; o++, a *= .5, f *= 2) {
      const per = Math.max(1, Math.round(w / 46 * f)), X = x * f, Y = y * f, xi = Math.floor(X), yi = Math.floor(Y), fx = X - xi, fy = Y - yi;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const at = (i, j) => T[(((i % per) + per) % per) % S + ((j & (S - 1)) * S)];
      v += a * lerp(lerp(at(xi, yi), at(xi + 1, yi), ux), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), ux), uy); norm += a;
    }
    return v / norm;
  };
}
/* TECHNIQUE · real data beats procedural: the Moon's surface is a real albedo map (Clementine mission, NASA / U.S. Navy,
   public domain, via Wikimedia Commons "Moonmap_from_clementine_data.png"; x = longitude −180…180°, centre = near side).
   A procedural map reads as clip-art; real imagery of a real object is what makes the frame look photographed.
   Module top-level await: the image is decoded before EX.run, so every frame can use it. Credit it in CREDITS. */
const MOONIMG = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = 'moonmap.jpg'; });
function moonMap() { return LIGHT.texture(2048, 1024, (c, w, h) => { c.drawImage(MOONIMG, 0, 0, w, h); }); }
/* the procedural fallback (no network, no image): mare positions painted as soft blobs */
function moonMapProcedural() {
  return LIGHT.texture(2048, 1024, (c, w, h) => {
    const r = rng(1969);
    const X = (lon) => ((lon + 180) / 360) * w, Y = (lat) => ((90 - lat) / 180) * h;
    const blob = (lon, lat, rad, rgb, a, soft = .55, c2 = c) => {   // soft ellipse, wrapped across the ±180° seam
      const ry = (rad / 180) * h, rx = ry / Math.max(.2, Math.cos(lat * D2R));
      for (const dx of [-w, 0, w]) {
        const x = X(lon) + dx, y = Y(lat);
        if (x + rx < 0 || x - rx > w) continue;
        c2.save(); c2.translate(x, y); c2.scale(rx / ry, 1);
        const gr = c2.createRadialGradient(0, 0, 0, 0, 0, ry);
        gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(soft, `rgba(${rgb},${a * .8})`); gr.addColorStop(1, `rgba(${rgb},0)`);
        c2.fillStyle = gr; c2.fillRect(-ry, -ry, 2 * ry, 2 * ry); c2.restore();
      }
    };
    c.fillStyle = '#C9C7C3'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) blob(r() * 360 - 180, Math.asin(r() * 2 - 1) / D2R, 2 + r() * 14, r() < .55 ? '232,230,226' : '140,138,136', .04 + r() * .06);
    const inMare = (lon, lat) => MARIA.some(([ml, mb, mr]) => Math.hypot((lon - ml) * Math.cos(lat * D2R), lat - mb) < mr * .9);
    /* maria: a soft coverage mask, then per pixel: the mask's edge is pushed in and out by noise (ragged coastlines,
       highland islands) and its tone varies with a second noise, so a mare is mottled and not an airbrushed shape */
    const mk = document.createElement('canvas'); mk.width = w; mk.height = h;
    const m = mk.getContext('2d', { willReadFrequently: true }); m.fillStyle = '#000'; m.fillRect(0, 0, w, h);
    for (const [lon, lat, rad] of MARIA) {
      blob(lon, lat, rad * 1.2, '255,255,255', .45, .5, m);
      for (let k = 0; k < 5; k++) {
        const a = r() * 6.283, d = rad * .8 * Math.sqrt(r());
        blob(lon + Math.cos(a) * d / Math.max(.3, Math.cos(lat * D2R)), lat + Math.sin(a) * d, rad * (.45 + .5 * r()), '255,255,255', .3, .4, m);
      }
    }
    const M = m.getImageData(0, 0, w, h).data, img = c.getImageData(0, 0, w, h), P = img.data;
    const noise = valueNoise(w, 11);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, n1 = .6 * noise(x / 40, y / 40, 2) + .4 * noise(x / 13, y / 13, 2), n2 = noise(x / 90 + 50, y / 90, 3);
      const q = M[i] / 255 + .6 * (n1 - .5), cov = q < .12 ? 0 : q > .62 ? 1 : (q - .12) / .5;
      const k = 1 - cov * cov * (3 - 2 * cov) * (.24 + .42 * n2) - .1 * (noise(x / 5, y / 5, 2) - .5);
      P[i] *= k * .985; P[i + 1] *= k * .99; P[i + 2] *= k;                // maria a touch cooler than highlands
    }
    c.putImageData(img, 0, 0);
    for (let i = 0; i < 9000; i++) {                                     // craters: power-law sizes, low contrast
      const lon = r() * 360 - 180, lat = Math.asin(r() * 2 - 1) / D2R;
      if (inMare(lon, lat) && r() < .85) continue;
      const rad = .08 * Math.pow(1 - r() * .995, -.7), ry = Math.min(rad, 2.6) / 180 * h, rx = ry / Math.max(.2, Math.cos(lat * D2R));
      c.save(); c.translate(X(lon), Y(lat)); c.scale(rx / ry, 1);
      c.fillStyle = `rgba(90,90,92,${(.03 + .05 * r()).toFixed(3)})`; c.beginPath(); c.arc(0, 0, ry, 0, 6.283); c.fill();
      c.strokeStyle = `rgba(245,244,240,${(.06 + .12 * r()).toFixed(3)})`; c.lineWidth = Math.max(.6, ry * .25); c.beginPath(); c.arc(0, 0, ry, 0, 6.283); c.stroke();
      c.restore();
    }
    for (let i = 0; i < 60000; i++) { c.fillStyle = r() < .5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)'; c.fillRect(r() * w, r() * h, 1.5, 1.5); }   // regolith grain
    for (const [lon, lat, size, n] of RAYS) {                             // ray craters
      for (let k = 0; k < n; k++) {
        const a = r() * 6.283, len = (6 + r() * 22) * size;
        c.strokeStyle = `rgba(240,238,232,${(.03 + .04 * r()).toFixed(3)})`; c.lineWidth = 3 + r() * 7 * size;
        c.beginPath(); c.moveTo(X(lon), Y(lat));
        c.lineTo(X(lon + Math.cos(a) * len / Math.max(.3, Math.cos(lat * D2R))), Y(lat + Math.sin(a) * len)); c.stroke();
      }
      blob(lon, lat, 2.2 * size, '250,248,244', .5, .3);
    }
  });
}
function earthMap() {                                                     // only ever seen small: ocean, land, cloud
  return LIGHT.texture(512, 256, (c, w, h) => {
    const r = rng(7);
    c.fillStyle = '#1C3F7A'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(70,110,70,${.5 + .3 * r()})`; c.beginPath(); c.ellipse(r() * w, h * (.2 + .6 * r()), 10 + r() * 40, 6 + r() * 22, r() * 3, 0, 6.283); c.fill(); }
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(240,244,255,${.3 + .4 * r()})`; c.beginPath(); c.ellipse(r() * w, r() * h, 8 + r() * 46, 2 + r() * 7, 0, 0, 6.283); c.fill(); }
  });
}
/* the hemisphere we would never see without libration (|lon| > 90°), amber and transparent elsewhere: drawn over the
   Moon with the same lon / lat, it sticks to the surface, so the nod shows up as amber slivers at the edge */
function hiddenMap() {
  return LIGHT.texture(720, 360, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, LIGHT.rgba(ACC, .9)); gr.addColorStop(.25, LIGHT.rgba(ACC, .9)); gr.addColorStop(.251, LIGHT.rgba(ACC, 0));
    gr.addColorStop(.749, LIGHT.rgba(ACC, 0)); gr.addColorStop(.75, LIGHT.rgba(ACC, .9)); gr.addColorStop(1, LIGHT.rgba(ACC, .9));
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
  });
}
let MOON, EARTH, HIDDEN;
const maps = new Promise((ok) => { MOON = moonMap(); EARTH = earthMap(); HIDDEN = hiddenMap(); ok(); });

/* faint stars, seeded once (a full moon drowns most of them, so keep them few and dim) */
const STARS = (() => { const r = rng(5); return [...Array(140)].map(() => [r() * 1920, r() * 1080, .5 + r() * .9, .15 + r() * .35, r() * 6.3]); })();
function stars(g, u, k = 1) { for (const [x, y, s, a, ph] of STARS) LIGHT.dot(g, x, y, s, '#C8D2FF', k * a * (.75 + .25 * Math.sin(u * 1.3 + ph))); }

/* ---------- TECHNIQUE A (cont.) · a nebula behind the orbit, from LIGHT.SHADERS.aurora on a small canvas ----------
   A shader is paid per pixel, and a nebula is soft anyway: render 480×270 and let CSS scale it 4×. It is scenery
   (EX.backdrop without subject), faded in only around the orbit shot, where the frame is otherwise empty space. */
const T_LOCK = DUR.face + DUR.young;
EX.backdrop({
  html: '<canvas width="480" height="270" style="position:absolute;left:0;top:0;width:1920px;height:1080px;opacity:0"></canvas>',
  init(el) { this.cv = el.querySelector('canvas'); this.sh = LIGHT.shader(this.cv, LIGHT.SHADERS.aurora); },
  render(el, t) {
    const o = smooth(T_LOCK - .2, T_LOCK + 1.5, t) * (1 - smooth(T_LOCK + DUR.lock - 1.2, T_LOCK + DUR.lock, t));
    this.cv.style.opacity = o;
    if (o > 0) this.sh.render(t, { uColorA: [.42, .24, .8], uColorB: [.1, .22, .6], uIntensity: .3, uHeight: 1.3, uHaze: 1, uSpeed: 2 });
  },
});

/* ======================= S1 · the face: a single full moon in darkness ======================= */
/* TECHNIQUE C · the order of a luminous frame: haze (air) → subject → glow (bloom of what is bright) → bokeh (lens).
   The light comes up over 2 s (gain); the moon drifts and grows 17% (a slow dolly without touching the camera) while
   faint rays turn in the haze and the bokeh drifts the other way — a contemplative hold still needs motion
   (motion_check flags 2 s without it). */
EX.shot({
  id: 'face', chapter: null, hud: false, dur: DUR.face, amb: 'space',
  caps: [[.8, '抬头看了一辈子月亮，'], [4.1, '看到的永远是同一面。']],
  html: CANVAS,
  init(el) { this.g = canvasOf(el); },
  render(el, u, d) {
    const g = this.g, k = expoOut(prog(u, 0, 2.4)), p = u / (d + .5), r = lerp(282, 330, p), x = lerp(915, 1000, p), y = lerp(480, 450, p);
    breath(el, u, d, 0);
    g.clearRect(0, 0, 1920, 1080);
    stars(g, u, .5 * k);
    LIGHT.haze(g, u, { x, y, r: 1050, color: '#8FA4D0', alpha: .17 * k, rays: 18, rayAlpha: .05 * k, spin: .05 });
    LIGHT.sphere(g, MOON, { x, y, r, lon: 0, lat: 0, sun: [.06, .05, 1], tint: MOONC, gain: .98 * k });
    LIGHT.glow(g, { strength: 1.25 * k, threshold: .6, radius: 150 });
    LIGHT.bokeh(g, u, { seed: 11, n: 9, colors: ['#FFD9A8', '#FFC48A', '#FFE7C8'], size: [160, 520], alpha: .3 * k, drift: 90, keepOut: [960, 460, 520] });
  },
});

/* ======================= S2 · the young Moon, stretched by Earth ======================= */
/* TECHNIQUE D · a physical field made visible. Around a body at distance D from Earth, the tidal acceleration in the
   Moon's frame (x toward Earth) is ∝ (2x, −y): stretched along the Earth line, squeezed across it. LIGHT.flow with that
   field draws its streamlines as particles: they come in from above and below and leave toward / away from Earth,
   which IS the shape of the two bulges. The amber halo (an ellipse 1.6× wider than tall) is the bulge itself (示意).
   Earth is a dark disc off the left edge with a thin blue rim: present, but not a second subject. */
const YM = [1180, 500, 186];                                              // young Moon x, y, r
const tidal = (x, y) => [.34 * 2 * (x - YM[0]), -.34 * (y - YM[1])];
EX.shot({
  id: 'young', enter: 'cut', chapter: 'lock', hud: false, dur: DUR.young, amb: 'space',
  caps: [[.5, '年轻的月亮离地球近得多，转得也快得多。'], [4.8, '地球的引力把它拉出两个「潮汐隆起」。']],
  html: CANVAS,
  init(el) { this.g = canvasOf(el); },
  render(el, u, d) {
    const g = this.g, k = expoOut(prog(u, 0, 1.6)), f = smooth(1.2, 4.6, u);   // f: the field and the bulge come up
    breath(el, u, d);
    const [mx, my, mr] = YM;
    g.clearRect(0, 0, 1920, 1080);
    stars(g, u, .45);
    /* Earth: dark disc + atmosphere rim, centre far off-frame left */
    const ex = -470, ey = 540, er = 790;
    const eg = g.createRadialGradient(ex, ey, er * .9, ex, ey, er * 1.06);
    eg.addColorStop(0, 'rgba(6,10,22,1)'); eg.addColorStop(.6, 'rgba(10,18,38,1)'); eg.addColorStop(.66, LIGHT.rgba(EARTHC, .28)); eg.addColorStop(1, LIGHT.rgba(EARTHC, 0));
    g.fillStyle = eg; g.beginPath(); g.arc(ex, ey, er * 1.06, 0, 6.283); g.fill();
    LIGHT.haze(g, u, { x: 240, y: 540, r: 700, color: EARTHC, alpha: .1 * k });
    /* the bulge: stretched amber halo behind the Moon (the disc covers its middle, two lobes remain) */
    g.save(); g.globalCompositeOperation = 'lighter'; g.translate(mx, my); g.scale(1.65, 1);
    const hg = g.createRadialGradient(0, 0, mr * .7, 0, 0, mr * 1.45);
    hg.addColorStop(0, LIGHT.rgba(ACC, .5 * f)); hg.addColorStop(.45, LIGHT.rgba(ACC, .18 * f)); hg.addColorStop(1, LIGHT.rgba(ACC, 0));
    g.fillStyle = hg; g.fillRect(-mr * 1.5, -mr * 1.5, mr * 3, mr * 3); g.restore();
    LIGHT.flow(g, u, { seed: 21, n: 340, life: 2.6, tail: 16, speed: 1, field: tidal, color: ACC, width: 1.6, alpha: .5 * f,
      spawn: (r) => { const a = (r() < .5 ? -1 : 1) * Math.PI / 2 + (r() - .5) * 1.5, q = mr * (1.05 + .9 * r()); return [mx + Math.cos(a) * q, my + Math.sin(a) * q]; } });
    LIGHT.sphere(g, MOON, { x: mx, y: my, r: mr, lon: -40 + 34 * u, lat: 0, sun: [-.35, .25, .9], tint: MOONC, gain: .8 * k });
    LIGHT.glow(g, { strength: 1.05, threshold: .5, radius: 70 });
  },
});

/* ======================= S3 · the brake: spin slows until it matches the orbit ======================= */
/* TECHNIQUE E · closed-form spin-down. Seen from above the orbit, the Moon (orbital rate n) carries a pointer from its
   centre through its surface. Spin rate ω(u) = n + (ω0 − n)·e^(−u/τ) (tidal braking ∝ the spin excess), so the
   pointer's angle relative to the Earth direction is ψ(u) = −(ω0 − n)·τ·e^(−u/τ): exact at any u, no simulation.
   The pointer tip's path, drawn by LIGHT.trail over the last 1.7 s, is the whole story: loops (spinning faster than
   it orbits) → waves → a clean circle (locked: the pointer always aims at Earth). The bulge halo leads the Earth line
   by an angle proportional to the spin excess and swings onto it at the lock. */
const E3 = [960, 520], RO = 300, RM = 30, ARM = 82;
const N = 2 * Math.PI / 3.4, W0 = 14 * N, TAU = 1.6, LOCK = 6.6;          // one orbit per 3.4 s of film
const orbitA = (u) => .9 + N * u;                                          // maths angle (counter-clockwise)
const spinRel = (u) => -(W0 - N) * TAU * Math.exp(-u / TAU);
const moonAt = (u) => [E3[0] + RO * Math.cos(orbitA(u)), E3[1] - RO * Math.sin(orbitA(u))];
const tipAt = (u) => { const [x, y] = moonAt(u), a = orbitA(u) + Math.PI + spinRel(u); return [x + ARM * Math.cos(a), y - ARM * Math.sin(a)]; };
EX.shot({
  id: 'lock', enter: 'cut', chapter: 'lock', hud: false, dur: DUR.lock, amb: 'space',
  caps: [[.5, '潮汐摩擦像一脚刹车，自转越来越慢，'], [5.8, '直到转一圈正好绕地球一圈：「潮汐锁定」。']],
  hush: [[4.3, 6.4]], sfx: [[LOCK, 'riser', .35], [LOCK, 'chime', .5]],
  html: CANVAS + `<div class="mn-label" id="lock-days">27.3 天</div>`,
  init(el) { this.g = canvasOf(el); this.lab = el.querySelector('#lock-days'); },
  render(el, u, d) {
    const g = this.g, k = expoOut(prog(u, 0, 1.2)), o = breath(el, u, d);
    const [mx, my] = moonAt(u), excess = Math.exp(-u / TAU);
    g.clearRect(0, 0, 1920, 1080);
    stars(g, u, .6);
    /* Earth: a small lit globe with a blue haze */
    LIGHT.haze(g, u, { x: E3[0], y: E3[1], r: 260, color: EARTHC, alpha: .22 * k });
    LIGHT.sphere(g, EARTH, { x: E3[0], y: E3[1], r: 24, lon: u * 60, lat: 70, sun: [-1, .1, .3], gain: 1.2 * k });
    /* the orbit, drawn by the Moon itself: a faint full-turn trail */
    LIGHT.trail(g, moonAt, u, { span: 3.3, steps: 160, width: 1.6, color: '#C9D2EA', alpha: .45 * k, head: 0, core: false });
    /* the bulge: leads the Earth line by an angle ∝ spin excess (示意: drawn 30× the real ~1°) */
    const lead = .55 * excess, axis = orbitA(u) + Math.PI + lead;
    g.save(); g.globalCompositeOperation = 'lighter'; g.translate(mx, my); g.rotate(-axis); g.scale(1.7, 1);
    const hg = g.createRadialGradient(0, 0, RM * .6, 0, 0, RM * 1.6);
    hg.addColorStop(0, LIGHT.rgba(ACC, .55 * k)); hg.addColorStop(1, LIGHT.rgba(ACC, 0));
    g.fillStyle = hg; g.fillRect(-RM * 2, -RM * 2, RM * 4, RM * 4); g.restore();
    /* the pointer's path: loops → waves → circle */
    LIGHT.trail(g, tipAt, u, { span: 1.7, steps: 420, width: 3.2, color: ACC, alpha: k, head: 9 });
    LIGHT.sphere(g, MOON, { x: mx, y: my, r: RM, lon: (orbitA(u) + spinRel(u)) / D2R, lat: 90, sun: [-1, .05, .25], tint: MOONC, gain: 1.05 * k });
    const [tx, ty] = tipAt(u);                                             // the pointer itself: centre → tip
    g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = LIGHT.rgba(ACC, .85 * k); g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(mx, my); g.lineTo(tx, ty); g.stroke(); g.restore();
    LIGHT.glow(g, { strength: 1.25, threshold: .42, radius: 50 });
    const p = expoOut(prog(u, LOCK + .3, LOCK + 1.3)) * o;                 // the one label, once it is locked
    this.lab.style.opacity = p; this.lab.style.visibility = p <= 0 ? 'hidden' : '';
    this.lab.style.left = '960px'; this.lab.style.top = (E3[1] + 70 + (1 - p) * 12) + 'px'; this.lab.style.transform = 'translate(-50%,-50%)';
  },
});

/* ======================= S4 · the nod: libration shows us 59% ======================= */
/* TECHNIQUE F · libration = the view direction wobbling: lon ±7.9° (the orbit is elliptical, the spin is steady) and
   lat ±6.7° (the spin axis is tilted to the orbit), two sines with different periods. Features near the edge slide in
   and out of view; the face as a whole stays. A month is compressed into ~4.5 s. The hemisphere we could never see
   without the nod is painted amber on a second, mostly transparent map drawn with the same lon / lat, so it appears as
   slivers at the edge. An edge strip is foreshortened to r·(1 − cos θ): at the real 7.9° that is 3 px, so the nod is
   drawn 2.5× (示意) — check that a detail you exaggerate is still true in direction and the caption number stays real. */
EX.shot({
  id: 'nod', enter: 'cut', chapter: 'see', hud: false, dur: DUR.nod, amb: 'space',
  caps: [[.5, '它还会轻轻摇晃，叫「天平动」，'], [3.9, '边缘多露出一点：总共约 59%。']],
  html: CANVAS,
  init(el) { this.g = canvasOf(el); },
  render(el, u, d) {
    const g = this.g, r = lerp(330, 350, u / d), env = smooth(.2, 1.4, u) * (1 - smooth(d - 1.6, d - .2, u)), mark = smooth(1, 2.2, u) * env;
    breath(el, u, d, .9, 0);
    const LIB = 2.5 * env;                                                       // 示意: the nod drawn 2.5× (real ±7.9° / ±6.7°)
    const lon = LIB * 7.9 * Math.sin((u - .6) * 2 * Math.PI / 4.4), lat = LIB * 6.7 * Math.sin((u - .6) * 2 * Math.PI / 4.9 + 1.1);
    g.clearRect(0, 0, 1920, 1080);
    stars(g, u, .4);
    LIGHT.haze(g, u, { x: 960, y: 450, r: 1000, color: '#8FA4D0', alpha: .15 });
    LIGHT.sphere(g, MOON, { x: 960, y: 450, r, lon, lat, sun: [.06, .05, 1], tint: MOONC, gain: .98 });
    if (mark > 0) LIGHT.sphere(g, HIDDEN, { x: 960, y: 450, r, lon, lat, sun: [0, 0, 1], alpha: .75 * mark });
    LIGHT.glow(g, { strength: 1.15, threshold: .6, radius: 150 });
    LIGHT.bokeh(g, u + 30, { seed: 12, n: 7, colors: ['#FFD9A8', '#FFE7C8'], size: [160, 480], alpha: .16, drift: 40, keepOut: [960, 450, 540] });
  },
});

/* ======================= S5 · the far side is not dark ======================= */
/* TECHNIQUE F (cont.) · the Sun as a direction. From Earth's side: the Sun swings from behind us (full) to behind the
   Moon (new) and the terminator sweeps across the face until only earthshine is left; then the camera swings 180°
   round the Moon (texture lon 0 → 180, the sun vector rotates the other way in view space) and finds the far side in
   full warm sunlight. Warm haze sits where the Sun is (screen side it lights from); backlit, a thin rim. */
EX.shot({
  id: 'far', enter: 'cut', chapter: 'far', hud: false, dur: DUR.far, amb: 'space', sfx: [[3.8, 'reveal', .4]],
  caps: [[.4, '新月那天，朝着我们的这面是黑的，'], [4.4, '背面却正晒着太阳：它不是「暗面」。']],
  html: CANVAS,
  init(el) { this.g = canvasOf(el); },
  render(el, u, d) {
    const g = this.g;
    breath(el, u, d, 0);
    const a = Math.PI * cubic(prog(u, .3, 3.5)) + .55 * smooth(5, 8, u);  // sun: in front → behind the Moon (→ a bit aside)
    const b = Math.PI * cubic(prog(u, 3.8, 7.0));                         // camera: Earth side → far side
    const sx = Math.sin(a - b), sz = Math.cos(a - b), warm = smooth(4.2, 7.4, u);
    g.clearRect(0, 0, 1920, 1080);
    stars(g, u + DUR.nod, .4 + .3 * (1 - Math.max(0, sz)));
    LIGHT.haze(g, u, { x: 960 + 1250 * sx, y: 450 - 80 * Math.abs(sx), r: 1300, color: '#FFC890', alpha: .2 * Math.abs(sx) + .12 * warm });
    LIGHT.haze(g, u, { x: 960, y: 450, r: 1000, color: '#8FA4D0', alpha: .15 * Math.max(0, sz) * (1 - warm) });   // = nod's last frame at u = 0
    LIGHT.sphere(g, MOON, { x: 960, y: 450, r: 350, lon: b / D2R, lat: 0, sun: [sx, .05 * Math.min(1, a), sz], tint: warm > .01 ? '#FFF1E0' : MOONC, gain: lerp(.98, .84, warm),
      ambient: .035, rim: .5 * Math.max(0, -sz) });
    LIGHT.glow(g, { strength: lerp(1.15, .8, warm), threshold: .6, radius: 150 });
    LIGHT.bokeh(g, u + 30 + DUR.nod, { seed: 12, n: 7, colors: ['#FFD9A8', '#FFE7C8'], size: [160, 480], alpha: .16 * (1 - smooth(0, 1.6, u)), drift: 40, keepOut: [960, 450, 540] });
  },
});

/* ======================= S6 · the lone figure ======================= */
/* TECHNIQUE G · silhouette: the figure is the darkest thing on screen, placed in front of the brightest (the glitter
   path the Moon throws on the lake), so it reads at a glance. The glitter is rows of short dashes whose width,
   offset and brightness are sines of (row, u): closed-form shimmer that scrubs. */
const MO = [1240, 270, 96], HOR = 640, SHORE = 912;
function figure(g, x, y, h) {                                             // feet at (x, y), height h, back to camera
  const s = h / 170;
  g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = '#010102';
  g.beginPath(); g.ellipse(1, -157, 10.5, 12.5, 0, 0, 6.283); g.fill();     // head
  g.beginPath();
  g.moveTo(-5, -146); g.lineTo(6, -146);                                    // neck
  g.quadraticCurveTo(20, -143, 22, -128); g.lineTo(23, -86); g.lineTo(17, -84);   // right shoulder, arm
  g.lineTo(14, -78); g.lineTo(11, -2); g.lineTo(3, 0); g.lineTo(1, -68);    // right leg
  g.lineTo(-1, -68); g.lineTo(-4, 0); g.lineTo(-12, -2); g.lineTo(-13, -78);
  g.lineTo(-16, -84); g.lineTo(-21, -86); g.lineTo(-20, -128); g.quadraticCurveTo(-18, -143, -5, -146); g.closePath(); g.fill();
  g.restore();
}
EX.shot({
  id: 'end', enter: 'cut', chapter: null, hud: false, dur: DUR.end, amb: 'wind', sfx: [[1.2, 'chime', .25]],
  caps: [[1.2, '李白看到的月亮，和你看到的是同一面。']],
  html: CANVAS,
  init(el) {
    this.g = canvasOf(el);
    const r = rng(77);                                                       // far shore: a low ridge, seeded once
    this.ridge = [...Array(97)].map((_, i) => [i * 20, HOR - 6 - 22 * Math.pow(Math.sin(i * .09 + 1) * .5 + .5, 2) - 7 * r()]);
  },
  render(el, u, d) {
    const g = this.g, k = expoOut(prog(u, 0, 1.6)), out = 1 - .7 * cubic(prog(u, d - 1.8, d));
    const [mx, my, mr] = MO;
    g.clearRect(0, 0, 1920, 1080);
    const sky = g.createLinearGradient(0, 0, 0, HOR);
    sky.addColorStop(0, '#010207'); sky.addColorStop(.7, '#060A16'); sky.addColorStop(1, '#0E1628');
    g.fillStyle = sky; g.fillRect(0, 0, 1920, HOR);
    stars(g, u, .7 * k);
    LIGHT.haze(g, u, { x: mx, y: my, r: 1200, color: '#8FA4D0', alpha: .24 * k });
    LIGHT.haze(g, u, { x: mx, y: HOR, r: 1000, color: '#9DB0D8', alpha: .1 * k });           // horizon mist
    const lake = g.createLinearGradient(0, HOR, 0, SHORE);
    lake.addColorStop(0, '#0A1020'); lake.addColorStop(1, '#03050A');
    g.fillStyle = lake; g.fillRect(0, HOR, 1920, SHORE - HOR);
    /* glitter path: a soft reflected column, then sparkles. Each sparkle's place, size and rhythm come from a hash of
       (row, j), its brightness is a sharp power of a sine of time: random-looking, but a pure function of u */
    g.save(); g.globalCompositeOperation = 'lighter';
    g.save(); g.translate(mx, HOR); g.scale(.16, 1);
    const cg = g.createRadialGradient(0, 0, 0, 0, 0, SHORE - HOR);
    cg.addColorStop(0, LIGHT.rgba('#C8D4F0', .32 * k)); cg.addColorStop(.5, LIGHT.rgba('#C8D4F0', .1 * k)); cg.addColorStop(1, LIGHT.rgba('#C8D4F0', 0));
    g.fillStyle = cg; g.fillRect(-(SHORE - HOR), 0, 2 * (SHORE - HOR), SHORE - HOR); g.restore();
    const hash = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
    for (let y = HOR + 1; y < SHORE; y += 2) {
      const z = (y - HOR) / (SHORE - HOR), w = 26 + 260 * z;
      for (let j = 0; j < 9; j++) {
        const n = y * 12.9898 + j * 78.233, h1 = hash(n), h2 = hash(n + 1.7), h3 = hash(n + 3.1), h4 = hash(n + 5.3);
        const off = (h1 * 2 - 1) * Math.pow(h2, .6), fall = Math.exp(-3 * off * off);
        const a = Math.pow(.5 + .5 * Math.sin(u * (1.4 + 2.6 * h3) + h4 * 6.283), 6) * fall * (1 - .45 * z) * 1.2 * k;
        if (a < .03) continue;
        const len = (4 + 34 * z) * (.3 + .7 * hash(n + 7.7));
        g.fillStyle = LIGHT.rgba('#F0F4FF', Math.min(1, a)); g.fillRect(mx + off * w - len / 2, y, len, 1 + 1.4 * z);
      }
    }
    g.restore();
    LIGHT.sphere(g, MOON, { x: mx, y: my, r: mr, lon: 0, lat: 0, sun: [.06, .05, 1], tint: MOONC, gain: 1.15 * k });
    LIGHT.glow(g, { strength: 1.45, threshold: .5, radius: 150 });
    g.fillStyle = '#03050B'; g.beginPath(); g.moveTo(0, HOR + 2);                             // far shore ridge
    for (const [x, y] of this.ridge) g.lineTo(x, y);
    g.lineTo(1920, HOR + 2); g.closePath(); g.fill();
    g.fillStyle = '#010102'; g.fillRect(0, SHORE, 1920, 1080 - SHORE);                       // near shore (after glow: stays black)
    figure(g, 1190, SHORE + 3, 236);
    el.querySelector('canvas').style.opacity = out;
  },
});

EX.run({ theme: 'dark', chrome: 'cinema', post: { vignette: .5, grain: 6 }, composition: 'cinema', mood: 'calm', rate: null, preload: [maps] });
