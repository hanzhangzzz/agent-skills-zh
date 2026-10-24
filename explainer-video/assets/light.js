/* light.js — light as the protagonist: bloom, bokeh, trails, flow fields, haze, lit spheres, WebGL shaders.
   Load: first line of shots.js (a module):  import './light.js';   → window.LIGHT. Needs engine.js (rng) loaded before.
   Every function draws into a Canvas 2D context and is a pure function of t: no state carried between frames,
   randomness only from rng(seed), so any frame renders alone (the renderer seeks, it never plays).
   Works the same in a shot's own canvas and in EX.backdrop({ subject: true, html: '<canvas …>', render(el, t) {} }).

   The recipe for one luminous frame (copy this order):
     g.clearRect(0, 0, W, H);                       // transparent: the stage background shows, dissolves stay clean
     LIGHT.haze(g, t, { x, y, r: 700 });            // 1 air around the subject
     …draw the subject (LIGHT.sphere, LIGHT.trail, LIGHT.flow, your own paths with 'lighter')
     LIGHT.glow(g, { strength: .9 });               // 2 bloom of what is bright on THIS canvas
     LIGHT.bokeh(g, t, { seed: 3 });                // 3 out-of-focus lights in front, after the bloom (they are already soft)
   Measured at 1920×1080 in headless Chromium (--use-angle=metal, M-series): glow ≈ 0.8 ms, bokeh 30 discs 0.2 ms,
   trail 0.6 ms, flow 1200 particles ≈ 8 ms, haze ≈ 0.5 ms (+ 24 rays ≈ 8 ms), sphere r = 320 ≈ 10 ms. A whole
   frame of moon.example.js renders at about real time with 2 workers × 2 sub-frames.

   API (all sizes in canvas pixels; colours '#rrggbb'):
     LIGHT.glow(g, { strength = 1, threshold = .6, radius = 40, scale = .25 })   bloom pass over the whole canvas
     LIGHT.bokeh(g, t, { seed, n = 24, color, colors, size = [40, 220], alpha = .35, drift = 30, keepOut, area })
     LIGHT.trail(g, p, t, { span = 2, steps = 90, width = 5, color, alpha = 1, head = 10 })   p(t) → [x, y]
     LIGHT.flow(g, t, { seed, n = 1200, life = 4, dt = 1 / 30, tail = 10, speed = 60, field, spawn, color, width })
     LIGHT.haze(g, t, { x, y, r, color, alpha = .35, rays = 0, rayAlpha = .08, spin = .02 })
     LIGHT.vignette(g, { amount = .55, inner = .45 })
     LIGHT.dot(g, x, y, r, color, alpha = 1)            soft glowing point (stars, sparks, a planet seen from far away)
     LIGHT.sphere(g, tex, { x, y, r, lon = 0, lat = 0, sun = [0, 0, 1], tint, ambient = 0, rim = 0 })   lit textured globe
     LIGHT.texture(w, h, paint)                         → tex for sphere: paint(ctx, w, h) draws an equirectangular map
     LIGHT.shader(canvas, fragSrc) → { render(t, uniforms), gl }   WebGL2 full-screen fragment shader
     LIGHT.SHADERS.caustics, LIGHT.SHADERS.aurora       ready fragment sources for LIGHT.shader
     LIGHT.rgba(hex, a)                                 '#ffcc88', .5 → 'rgba(255,204,136,0.5)' */
(function () {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, x) => a + (b - a) * x;
  const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (hex, a) => { const [r, g, b] = hexRGB(hex); return `rgba(${r},${g},${b},${+a.toFixed(4)})`; };
  const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const seeded = new Map();                       /* per-seed layouts, built once: still pure (same seed → same layout) */
  const once = (key, make) => (seeded.has(key) ? seeded.get(key) : (seeded.set(key, make()), seeded.get(key)));

  /* ---------- glow: Canvas 2D bloom ----------
     Usage, after the subject is drawn:   LIGHT.glow(g, { strength: .9, threshold: .55, radius: 36 });
     What it does: shrink the canvas to 1/4 on black → keep only what is brighter than `threshold` (brightness +
     contrast filter = (x − th) / (1 − th)) → blur twice on the SMALL canvas (a tight and a wide halo) → add both back
     with 'lighter'. Bright things get a big soft halo, mid-greys get nothing. Halo too white: lower strength or raise
     threshold. Nothing glows: the subject is darker than threshold (draw it brighter, the halo is the reward).
     Only what is on this canvas glows: DOM text and other layers are untouched. */
  const glowBuf = new WeakMap();
  /* the thresholded image sits on black; drawn with 'lighter' as is, its opaque black would make the whole canvas
     opaque and hide every layer behind it (backdrop, stage colour). This SVG filter keeps the colour and sets
     alpha = 16 × (R + G + B), clamped: bright halo opaque, black transparent, so only light is added. */
  function l2a() {
    if (!document.getElementById('light-l2a')) document.body.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute">'
      + '<filter id="light-l2a" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  16 16 16 0 0"/></filter></svg>');
    return 'url(#light-l2a)';
  }
  function glow(g, { strength = 1, threshold = .6, radius = 40, scale = .25 } = {}) {
    const W = g.canvas.width, H = g.canvas.height, w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    let b = glowBuf.get(g.canvas);
    if (!b || b.w !== w || b.h !== h) {
      const A = canvasOf(w, h), Bc = canvasOf(w, h);
      b = { w, h, A, B: Bc, a: A.getContext('2d'), b: Bc.getContext('2d') };
      glowBuf.set(g.canvas, b);
    }
    const th = clamp(threshold, 0, .95), r = radius * scale;
    b.a.globalCompositeOperation = 'source-over'; b.a.filter = 'none'; b.a.globalAlpha = 1;
    b.a.fillStyle = '#000'; b.a.fillRect(0, 0, w, h);
    b.a.drawImage(g.canvas, 0, 0, w, h);                                       /* downscale over black */
    b.b.globalCompositeOperation = 'copy';
    b.b.filter = `brightness(${(1 / (1 + th)).toFixed(4)}) contrast(${((1 + th) / (1 - th)).toFixed(4)}) blur(${(r * .3).toFixed(2)}px)`;
    b.b.drawImage(b.A, 0, 0);                                                  /* threshold + tight blur → B (on black) */
    b.a.globalCompositeOperation = 'copy';
    b.a.filter = l2a();                                                        /* (url() must be its own filter: chained after */
    b.a.drawImage(b.B, 0, 0);                                                  /*  CSS functions it outputs nothing) black → clear → A */
    b.b.filter = `blur(${r.toFixed(2)}px)`;
    b.b.drawImage(b.A, 0, 0);                                                  /* wide blur of A → B */
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);                              /* screen space, whatever the caller's transform */
    g.globalCompositeOperation = 'lighter'; g.filter = 'none';
    g.globalAlpha = clamp(strength * .7, 0, 1); g.drawImage(b.A, 0, 0, W, H);
    g.globalAlpha = clamp(strength, 0, 1); g.drawImage(b.B, 0, 0, W, H);
    if (strength > 1) { g.globalAlpha = clamp(strength - 1, 0, 1); g.drawImage(b.B, 0, 0, W, H); }
    g.restore();
  }

  /* ---------- dot: a soft glowing point from one pre-rendered sprite (never ctx.shadowBlur: slow) ----------
     LIGHT.dot(g, x, y, 6, '#ffd9a8')  → a 6 px core with a halo ≈ 8× its radius. Drawn with 'lighter'. */
  const sprites = new Map();
  function sprite(color, kind) {
    const key = color + kind;
    if (sprites.has(key)) return sprites.get(key);
    const S = 256, c = canvasOf(S, S), x = c.getContext('2d'), gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    if (kind === 'dot') {               /* hot core, fast falloff, long faint tail */
      gr.addColorStop(0, rgba('#ffffff', 1)); gr.addColorStop(.06, rgba(color, 1)); gr.addColorStop(.16, rgba(color, .35));
      gr.addColorStop(.45, rgba(color, .06)); gr.addColorStop(1, rgba(color, 0));
    } else {                            /* bokeh disc: flat body, brighter rim, soft edge (an out-of-focus aperture) */
      gr.addColorStop(0, rgba(color, .42)); gr.addColorStop(.72, rgba(color, .5)); gr.addColorStop(.88, rgba(color, .78));
      gr.addColorStop(.94, rgba(color, .55)); gr.addColorStop(1, rgba(color, 0));
    }
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
    sprites.set(key, c);
    return c;
  }
  function dot(g, x, y, r, color = '#ffffff', alpha = 1) {
    if (alpha <= 0) return;
    const R = r * 8;
    g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(alpha);
    g.drawImage(sprite(color, 'dot'), x - R, y - R, 2 * R, 2 * R);
    g.restore();
  }

  /* ---------- bokeh: out-of-focus light discs ----------
     LIGHT.bokeh(g, t, { seed: 7, n: 18, colors: ['#ffd6a0', '#ffb070'], size: [60, 260], alpha: .3, keepOut: [960, 480, 360] })
     Each disc has a depth z (0 far … 1 near): near discs are bigger, fainter and drift more (parallax), drawn last.
     keepOut [x, y, r] pushes disc centres out of a circle (keep the subject clean); area [x0, y0, x1, y1] limits them.
     Brightness breathes slowly per disc. Draw it after LIGHT.glow: the discs are already soft. */
  function bokeh(g, t, { seed = 1, n = 24, color = '#ffd9a8', colors = null, size = [40, 220], alpha = .35, drift = 30, keepOut = null,
    area = null, W = g.canvas.width, H = g.canvas.height } = {}) {
    const [x0, y0, x1, y1] = area || [0, 0, W, H];
    const discs = once(`bokeh|${seed}|${n}|${x0},${y0},${x1},${y1}|${keepOut}`, () => {
      const r = rng(seed);
      return [...Array(n)].map(() => {
        let x = lerp(x0, x1, r()), y = lerp(y0, y1, r());
        if (keepOut) {
          const [kx, ky, kr] = keepOut, dx = x - kx, dy = y - ky, d = Math.hypot(dx, dy) || 1;
          if (d < kr) { x = kx + dx / d * kr * (1 + .25 * r()); y = ky + dy / d * kr * (1 + .25 * r()); }
        }
        return { x, y, z: r(), ph: r() * 6.283, w: .15 + r() * .35, c: r(), ax: r() * 2 - 1, ay: r() * 2 - 1 };
      }).sort((a, b) => a.z - b.z);
    });
    const pal = colors || [color];
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const d of discs) {
      const R = lerp(size[0], size[1], d.z) / 2;
      const x = d.x + Math.sin(t * d.w + d.ph) * drift * (.3 + d.z) * d.ax;
      const y = d.y + Math.cos(t * d.w * .8 + d.ph) * drift * (.3 + d.z) * d.ay;
      g.globalAlpha = clamp(alpha * lerp(1, .45, d.z) * (.75 + .25 * Math.sin(t * d.w * 1.7 + d.ph * 2)));
      g.drawImage(sprite(pal[Math.floor(d.c * pal.length)], 'bokeh'), x - R, y - R, 2 * R, 2 * R);
    }
    g.restore();
  }

  /* ---------- trail: a glowing tail behind a moving point ----------
     const moon = (t) => [960 + 330 * Math.cos(t), 540 + 330 * Math.sin(t)];   // position as a function of time
     LIGHT.trail(g, moon, t, { span: 2.5, width: 4, color: '#ffb46b' });
     The tail is p(t − span) … p(t), sampled at `steps` points and computed from t (never from earlier frames), so a
     scrubbed frame shows the same tail. Width and alpha fade to 0 at the old end; head = radius of a LIGHT.dot at p(t)
     (0 = none). Fast-turning curves (epicycles) need more steps: about 40 per loop. */
  function trail(g, p, t, { span = 2, steps = 90, width = 5, color = '#ffffff', alpha = 1, head = 10, core = true } = {}) {
    const pts = [];
    for (let k = 0; k <= steps; k++) pts.push(p(t - span * (1 - k / steps)));
    g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const [wk, ak, col] of [[3.2, .16, color], [1, .85, color], ...(core ? [[.35, .9, '#ffffff']] : [])]) {
      g.strokeStyle = col;
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;                                                      /* 0 old … 1 head */
        g.globalAlpha = clamp(alpha * ak * f * f);
        g.lineWidth = Math.max(.5, width * wk * (.25 + .75 * f));
        g.beginPath(); g.moveTo(pts[k - 1][0], pts[k - 1][1]); g.lineTo(pts[k][0], pts[k][1]); g.stroke();
      }
    }
    g.restore();
    if (head > 0) dot(g, pts[steps][0], pts[steps][1], head / 4, color, alpha);
  }

  /* ---------- flow: particles streaming through a vector field ----------
     LIGHT.flow(g, t, { seed: 5, n: 1400, color: '#9fd4ff' })                     default: a divergence-free swirl field
     LIGHT.flow(g, t, { field: (x, y, t) => [2 * (x - 960), -(y - 540)], spawn: (r) => [x, y] })   your own field
     Each particle lives `life` seconds, then respawns at a seeded place (spawn(r) gets an rng). Its position is found
     by integrating the field from its spawn point with a fixed step dt — recomputed every frame, so frame N needs no
     history (cost n × life / dt field evaluations at most; keep n × life / dt under ~150 k). It is drawn as a streak
     of its last `tail` steps that fades in and out over its life. speed scales the field (px per second for |v| = 1). */
  function swirl(x, y, t) {                         /* curl of a sum of sines: divergence-free, so it never clumps */
    const a = x * .0031, b = y * .0037, s = t * .07;
    return [Math.cos(b + s) * 1.1 + Math.cos(a * 1.7 + b * 2.3 - s) * .7 + .35 * Math.cos(b * 4.1 + a + s * 2),
      -Math.cos(a - s) * 1.0 - Math.cos(a * 1.7 + b * 2.3 - s) * .55 + .3 * Math.sin(a * 3.3 - b - s)];
  }
  function flow(g, t, { seed = 1, n = 1200, life = 4, dt = 1 / 30, tail = 10, speed = 60, field = swirl, spawn = null, color = '#9fd4ff',
    width = 1.4, alpha = .8, W = g.canvas.width, H = g.canvas.height } = {}) {
    const P = once(`flow|${seed}|${n}`, () => { const r = rng(seed); return [...Array(n)].map(() => ({ off: r() * life, k: Math.floor(r() * 1e6) })); });
    const bins = [[], [], [], [], [], []];
    for (const q of P) {
      const tt = t + q.off, cyc = Math.floor(tt / life), age = tt - cyc * life, born = t - age;
      const r = rng(q.k * 7919 + cyc);
      let [x, y] = spawn ? spawn(r) : [r() * W, r() * H];
      const steps = Math.floor(age / dt), pts = [];
      for (let i = 0; i <= steps; i++) {
        if (i > steps - tail) pts.push(x, y);
        const v = field(x, y, born + i * dt);
        x += v[0] * speed * dt; y += v[1] * speed * dt;
      }
      if (pts.length < 4) continue;
      const fade = Math.min(1, age / (life * .2), (life - age) / (life * .25));
      bins[Math.min(5, Math.floor(clamp(fade) * 6))].push(pts);
    }
    g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
    bins.forEach((list, i) => {
      if (!list.length) return;
      g.globalAlpha = alpha * (i + .5) / 6;
      g.beginPath();
      for (const pts of list) { g.moveTo(pts[0], pts[1]); for (let j = 2; j < pts.length; j += 2) g.lineTo(pts[j], pts[j + 1]); }
      g.stroke();
    });
    g.restore();
  }

  /* ---------- haze: air lit by the subject (radial falloff + optional god rays) ----------
     LIGHT.haze(g, t, { x: 960, y: 420, r: 900, color: '#c8d4ff', alpha: .3 })              soft light in the air
     LIGHT.haze(g, t, { x: 1500, y: -100, r: 1600, rays: 24, rayAlpha: .07, color: '#ffd2a0' })   shafts from a source
     Rays are thin seeded wedges that rotate by `spin` rad/s and breathe; keep rayAlpha ≤ .1 or they read as stripes. */
  function haze(g, t, { x = 960, y = 540, r = 800, color = '#ffffff', alpha = .35, rays = 0, rayAlpha = .08, spin = .02, seed = 9 } = {}) {
    g.save(); g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(color, alpha)); gr.addColorStop(.18, rgba(color, alpha * .45)); gr.addColorStop(.5, rgba(color, alpha * .12));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    if (rays > 0) {
      const W = once(`rays|${seed}|${rays}`, () => { const q = rng(seed); return [...Array(rays)].map(() => ({ a: q() * 6.283, w: .01 + q() * .05, ph: q() * 6.283, s: .5 + q() })); });
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, rgba(color, 1)); rg.addColorStop(.35, rgba(color, .35)); rg.addColorStop(1, rgba(color, 0));
      g.fillStyle = rg;
      for (const w of W) {
        const a = w.a + t * spin * w.s;
        g.globalAlpha = clamp(rayAlpha * (.55 + .45 * Math.sin(t * .6 * w.s + w.ph)));
        g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a - w.w, a + w.w); g.closePath(); g.fill();
      }
    }
    g.restore();
  }

  /* ---------- vignette: darkens the corners of THIS canvas (paints black: use it on the last, opaque layer;
     for the whole film prefer EX.run({ post: { vignette } })) ---------- */
  function vignette(g, { amount = .55, inner = .45 } = {}) {
    const W = g.canvas.width, H = g.canvas.height, gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * inner, W / 2, H / 2, Math.hypot(W, H) / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${amount})`);
    g.save(); g.globalCompositeOperation = 'source-over'; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
  }

  /* ---------- sphere: a lit, textured globe (moon, planet, eye, ball of light) on Canvas 2D ----------
     const tex = LIGHT.texture(1024, 512, (c, w, h) => { …paint an equirectangular map: x = longitude −180…180°,
                                                        y = latitude 90…−90°, grey = albedo (colour allowed) });
     LIGHT.sphere(g, tex, { x: 960, y: 480, r: 300, lon: 0, lat: 0, sun: [0, 0, 1] });
     lon / lat (degrees) = the point of the map at the centre of the disc (spin it by animating lon; libration = small
     lon / lat wobble). sun = direction TO the light in view space (x right, y up, z toward the viewer): [0,0,1] full
     phase, [1,0,0] half lit from the right, [0,0,-1] backlit (new moon). Shading is Lommel–Seeliger (the Moon's real
     law: a full moon is evenly bright to its edge, no limb darkening), a soft terminator, `ambient` for earthshine,
     `rim` for a thin backlit atmosphere edge, tint multiplies the colour. The map's alpha is kept: a map that is
     transparent except for one region draws only that region (an overlay that sticks to the surface). Cost ∝ r²:
     r = 320 ≈ 10 ms. */
  function texture(w, h, paint) {
    const c = canvasOf(w, h), x = c.getContext('2d', { willReadFrequently: true });
    paint(x, w, h);
    return { w, h, data: x.getImageData(0, 0, w, h).data, canvas: c };
  }
  const sphBuf = new Map();
  function sphere(g, tex, { x = 960, y = 540, r = 200, lon = 0, lat = 0, sun = [0, 0, 1], tint = '#ffffff', ambient = 0, rim = 0, alpha = 1, gain = 1 } = {}) {
    const N = Math.max(8, Math.min(900, Math.ceil(2 * r + 2)));
    let b = sphBuf.get(N);
    if (!b) { const c = canvasOf(N, N), cx = c.getContext('2d'); b = { c, cx, img: cx.createImageData(N, N) }; sphBuf.set(N, b); }
    const d = b.img.data, R = N / 2 - 1, [tr, tg, tb] = hexRGB(tint).map((v) => v / 255);
    const sl = Math.hypot(...sun) || 1, sx = sun[0] / sl, sy = sun[1] / sl, sz = sun[2] / sl;
    const L0 = lon * Math.PI / 180, B0 = lat * Math.PI / 180, cb = Math.cos(B0), sb = Math.sin(B0);
    const TW = tex.w, TH = tex.h, T = tex.data;
    for (let j = 0; j < N; j++) {
      const ny = (N / 2 - j - .5) / R;
      for (let i = 0; i < N; i++) {
        const nx = (i + .5 - N / 2) / R, q = nx * nx + ny * ny, o = (j * N + i) * 4;
        const dist = Math.sqrt(q) * R;
        if (dist > R + 1) { d[o + 3] = 0; continue; }
        const nz = Math.sqrt(Math.max(0, 1 - q));
        /* tilt by lat about the x axis, then read longitude / latitude of that surface point */
        const y2 = ny * cb + nz * sb, z2 = -ny * sb + nz * cb;
        const plon = L0 + Math.atan2(nx, z2), plat = Math.asin(clamp(y2, -1, 1));
        let u = (plon / (2 * Math.PI) + .5) % 1; if (u < 0) u += 1;
        const tx = Math.min(TW - 1, (u * TW) | 0), ty = Math.min(TH - 1, ((.5 - plat / Math.PI) * TH) | 0), ti = (ty * TW + tx) * 4;
        const mu0 = nx * sx + ny * sy + nz * sz, mu = nz;
        const lit = mu0 > 0 ? 2 * mu0 / (mu0 + mu + 1e-3) : 0;
        const term = clamp((mu0 + .04) / .1);                                    /* soft terminator */
        let k = (Math.min(1.25, lit) * term + ambient) * gain;
        k += rim * Math.pow(1 - mu, 6) * clamp(-mu0 * 2 + .3);                   /* backlit edge */
        d[o] = T[ti] * k * tr; d[o + 1] = T[ti + 1] * k * tg; d[o + 2] = T[ti + 2] * k * tb;
        d[o + 3] = T[ti + 3] * clamp(R + .5 - dist) * alpha;                     /* anti-aliased limb × map alpha */
      }
    }
    b.cx.putImageData(b.img, 0, 0);
    g.drawImage(b.c, x - N / 2 * (r / R), y - N / 2 * (r / R), N * (r / R), N * (r / R));
  }

  /* ---------- shader: a WebGL2 full-screen fragment shader on its own canvas ----------
     const sky = LIGHT.shader(el.querySelector('#water'), LIGHT.SHADERS.caustics);   // once, in init
     sky.render(t, { uScale: 5, uColor: [.55, .85, 1], uDeep: [.0, .08, .12] });     // every frame, in render
     Your own shader: write only the body — uTime (s), uRes (px) and `out vec4 outColor` are declared for you:
       LIGHT.shader(cv, `uniform vec3 uColor; void main(){ vec2 uv = gl_FragCoord.xy / uRes; outColor = vec4(uColor * uv.x, 1.); }`)
     Uniforms: a number → float, an array of 2/3/4 → vec2/3/4. Same t → same image (uTime is t, never a clock).
     Show it as a DOM layer (<canvas> with CSS mix-blend-mode: screen over a dark stage) or draw it into a 2D canvas:
     g.drawImage(cv, 0, 0) (preserveDrawingBuffer is on, so the pixels are still there). Render a small canvas
     (960×540) and let CSS / drawImage scale it: a full-screen shader costs per pixel. Compile errors throw. */
  const HEAD = '#version 300 es\nprecision highp float;\nuniform float uTime;\nuniform vec2 uRes;\nout vec4 outColor;\n';
  function shader(canvas, frag) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('LIGHT.shader: WebGL2 unavailable');
    const comp = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('LIGHT.shader compile: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, comp(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}'));
    gl.attachShader(prog, comp(gl.FRAGMENT_SHADER, HEAD + frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('LIGHT.shader link: ' + gl.getProgramInfoLog(prog));
    const vao = gl.createVertexArray(), locs = {};
    const loc = (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(prog, n)));
    return {
      gl,
      render(t, uniforms = {}) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(prog); gl.bindVertexArray(vao);
        gl.uniform1f(loc('uTime'), t); gl.uniform2f(loc('uRes'), canvas.width, canvas.height);
        for (const [k, v] of Object.entries(uniforms)) {
          const l = loc(k); if (!l) continue;
          if (typeof v === 'number') gl.uniform1f(l, v);
          else gl[`uniform${v.length}fv`](l, v);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  }

  const SHADERS = {
    /* water caustics: the bright net of light on a pool floor, from the physics. The surface is a sum of 12 sine waves
       moving with deep-water speed (ω = √(g·k)); light refracted by it lands with intensity 1 / |det J| of the
       refraction map p → p + D·∇h, and the bright filaments are where that determinant crosses 0.
       Uniforms (all optional): uScale waves across the screen height (5), uSpeed (1), uColor light colour ([.6,.9,1]),
       uDeep floor colour ([0,.07,.1]), uIntensity (1), uDepth focusing strength D (3.2: more = sharper, busier net). */
    caustics: `
uniform float uScale, uSpeed, uIntensity, uDepth; uniform vec3 uColor, uDeep;
void main(){
  float sc = uScale > 0. ? uScale : 5., sp = uSpeed > 0. ? uSpeed : 1., k = uIntensity > 0. ? uIntensity : 1., D = uDepth > 0. ? uDepth : 3.2;
  vec3 col = length(uColor) > 0. ? uColor : vec3(.6, .9, 1.), deep = length(uDeep) > 0. ? uDeep : vec3(0., .07, .1);
  vec2 p = gl_FragCoord.xy / uRes.y * sc * 6.2831; float t = uTime * sp;
  float hxx = 0., hyy = 0., hxy = 0.;
  for (int i = 0; i < 12; i++) {
    float fi = float(i), a = fi * 2.39996 + .4, kk = .55 + .13 * fi;          /* golden-angle directions, rising |k| */
    vec2 kv = kk * vec2(cos(a), sin(a));
    float s = sin(dot(kv, p) - sqrt(9.8 * kk) * .35 * t + fi * 1.7) * .16 / (kk * kk);
    hxx -= s * kv.x * kv.x; hyy -= s * kv.y * kv.y; hxy -= s * kv.x * kv.y;
  }
  float det = (1. + D * hxx) * (1. + D * hyy) - D * D * hxy * hxy;
  float I = 1. / max(abs(det), .03);
  float c = .1 * I + .55 * smoothstep(2.5, 14., I) + .35 * smoothstep(10., 30., I);
  outColor = vec4(deep + col * c * k, 1.);
}`,
    /* aurora / nebula: three soft curtains with a sharp lower edge and vertical rays, over a faint fbm haze.
       Uniforms (optional): uColorA lower colour ([.2,1,.6]), uColorB upper colour ([.45,.3,1]), uIntensity (1),
       uSpeed (1), uHeight curtain base 0–1 of the height (.5, from the bottom), uHaze the fbm cloud under the
       curtains (.07). Nebula / deep-space gradient instead of an aurora: uHeight 1.2 (curtains above the frame), uHaze 1. */
    aurora: `
uniform vec3 uColorA, uColorB; uniform float uIntensity, uSpeed, uHeight, uHaze;
float hs(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
float nz(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a * nz(p); p = p * 2.03 + 7.1; a *= .5; } return v; }
void main(){
  vec3 ca = length(uColorA) > 0. ? uColorA : vec3(.2, 1., .6), cb = length(uColorB) > 0. ? uColorB : vec3(.45, .3, 1.);
  float k = uIntensity > 0. ? uIntensity : 1., sp = uSpeed > 0. ? uSpeed : 1., base = uHeight > 0. ? uHeight : .5;
  vec2 uv = gl_FragCoord.xy / uRes; float t = uTime * .05 * sp, asp = uRes.x / uRes.y;
  vec3 c = vec3(0.);
  for (int j = 0; j < 3; j++) {
    float fj = float(j);
    float y0 = base + .08 * fj + .22 * (fbm(vec2(uv.x * asp * .9 + fj * 3.7, t + fj)) - .5);
    float d = uv.y - y0;
    float curtain = smoothstep(-.015, .02, d) * exp(-max(d, 0.) * (4. + 2. * fj));
    float rays = .45 + .55 * fbm(vec2(uv.x * asp * 14. + fj * 9., t * 2.5 + uv.y));
    c += mix(ca, cb, clamp(d * 2.5, 0., 1.)) * curtain * rays * (.7 - .18 * fj);
  }
  float hz = uHaze > 0. ? uHaze : .07, f = fbm(uv * vec2(asp, 1.) * 1.6 + vec2(t, -t * .7) + fbm(uv * 3. - t) * .8);
  c += hz * mix(cb, ca, f) * smoothstep(.3, .85, f) * 1.4;
  outColor = vec4(c * k, 1.);
}`,
  };

  window.LIGHT = { glow, bokeh, trail, flow, haze, vignette, dot, sphere, texture, shader, SHADERS, rgba, swirl };
})();
