/* launch-video engine · shared by every style. Copy next to promo.html; load with <script src="engine.js">.
   Page contract used by scripts/render.mjs: __duration, __size, __seek(t), __ready, __recording.
   Rules that keep frames correct:
     - render(t) must be pure: derive every style, canvas pixel and 3D pose from t, never from the previous frame.
     - Randomness only from rng(seed). Motion with physics (particles, bounces) uses closed-form functions of t.
     - Scenes are toggled with display. Never set a child's visibility to 'visible':
       it overrides a hidden parent and leaks elements into other scenes.
   Motion vocabulary (all pure functions of t):
     easings   expoOut cubic backOut elasticOut inExpo inBack spring squash
     timing    beats(bpm) → n => seconds of beat n;  pulse(t, period)
     text      splitChars(el) once at init, then riseChars(...) / typeText(...)
     numbers   counter(el, value, p, decimals)
     travel    pathPoint(points, p), travel(el, points, t, a, b), dashFlow(path, t, speed)
     decide    reel(el, items, t, a, b, finalIndex)
     morph     morphRect(el, from, to, p)  — shared-element transition between two rectangles
   `rise` (fade + slide) is for secondary text only. If it is the only move on screen, the film is static. */
(function () {
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, x) => a + (b - a) * x;
  /* easings: all start moving on their first frame, so a cue placed at the start time is in sync */
  const expoOut = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  const cubic = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const backOut = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  const elasticOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - .75) * (2 * Math.PI / 3)) + 1);
  const inExpo = (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10));
  const inBack = (x, s = 1.70158) => (s + 1) * x * x * x - s * x * x;
  /* damped spring step response; u in seconds since release, w = stiffness (rad/s), z = damping (0.3 lively … 0.8 soft).
     Returns 0 → 1 with overshoot; use for anything that "lands": cards, pills, the protagonist. */
  function spring(u, w = 14, z = .5) {
    if (u <= 0) return 0;
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * u) * (Math.cos(wd * u) + (z * w / wd) * Math.sin(wd * u));
  }
  /* squash & stretch for a landing at time a: returns [scaleX, scaleY], 1,1 at rest */
  function squash(t, a, dur = .45, amount = .22) {
    const p = prog(t, a, a + dur);
    if (p <= 0 || p >= 1) return [1, 1];
    const k = amount * Math.exp(-5 * p) * Math.cos(p * Math.PI * 3);
    return [1 + k, 1 - k];
  }
  /* beat grid: const B = beats(100); B(12) → 7.2s. Put every cut, landing and cue on B(n) or B(n) + a small offset. */
  const beats = (bpm) => (n) => (n * 60) / bpm;
  /* 1 at each period boundary decaying to 0: pulse(t, .6) for a breathing dot or a blinking status */
  const pulse = (t, period = .6, decay = 4) => Math.exp(-decay * ((t % period) / period));
  /* deterministic randomness */
  function rng(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }
  /* set opacity + transform; hidden when fully transparent, otherwise inherit (never 'visible') */
  function show(el, o, dy = 0, extra = '') {
    el.style.opacity = o;
    el.style.visibility = o <= 0.001 ? 'hidden' : '';
    el.style.transform = `translateY(${dy}px) ${extra}`;
  }
  /* fade + rise in at a, fade out ending at b — secondary text only */
  function rise(el, t, a, b = 1e9, din = .6, dout = .35, dist = 28, extra = '') {
    const inP = expoOut(prog(t, a, a + din));
    const o = Math.min(inP, 1 - cubic(prog(t, b - dout, b)));
    show(el, t < a || t > b ? 0 : o, (1 - inP) * dist, extra);
  }
  const typeText = (str, t, a, cps = 60) => str.slice(0, Math.max(0, Math.floor((t - a) * cps)));
  /* number that counts up to `value` as p goes 0 → 1 (pass an eased p) */
  function counter(el, value, p, decimals = 0, prefix = '', suffix = '') {
    el.textContent = prefix + (value * clamp(p)).toFixed(decimals) + suffix;
  }

  /* ---- text split into characters (call once at init; keeps inline <span class="ch">) ----
     Wrap the element in a container with overflow:hidden to get a mask reveal. */
  function splitChars(el) {
    if (el.__chars) return el.__chars;
    const nodes = [];
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const ch of child.textContent) {
            const s = document.createElement('span');
            s.className = 'ch';
            s.style.display = 'inline-block';
            s.style.whiteSpace = 'pre';
            s.textContent = ch;
            frag.appendChild(s); nodes.push(s);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && child.tagName !== 'BR') walk(child);
      }
    };
    walk(el);
    el.__chars = nodes;
    return nodes;
  }
  /* characters rise out of a mask one after another; words stagger by `stagger`, letters inside a word by stagger/3.
     a = start, b = exit start (optional). dist = rise distance in px. */
  function riseChars(el, t, a, { b = 1e9, stagger = .05, dur = .5, dist = 1.2, ease = expoOut, out = .25 } = {}) {
    const chars = splitChars(el);
    let word = 0;
    chars.forEach((s, i) => {
      if (s.textContent === ' ') word++;
      const start = a + word * stagger + i * stagger / 3;
      const inP = ease(prog(t, start, start + dur));
      const exP = inExpo(prog(t, b + i * .01, b + i * .01 + out));
      const h = s.offsetHeight || 40;
      s.style.transform = `translateY(${(dist * h * (1 - inP) - 1.4 * h * exP).toFixed(2)}px)`;
      s.style.opacity = inP > 0 ? 1 : 0;
    });
  }

  /* ---- travel along a polyline ----
     points: [[x, y], ...]; p in 0..1 by arc length. Returns [x, y, angleRad]. */
  function pathPoint(points, p) {
    const segs = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      segs.push(d); total += d;
    }
    let d = clamp(p) * total;
    for (let i = 0; i < segs.length; i++) {
      if (d <= segs[i] || i === segs.length - 1) {
        const u = segs[i] ? clamp(d / segs[i]) : 1;
        const [x0, y0] = points[i], [x1, y1] = points[i + 1];
        return [lerp(x0, x1, u), lerp(y0, y1, u), Math.atan2(y1 - y0, x1 - x0)];
      }
      d -= segs[i];
    }
    return [...points[0], 0];
  }
  /* move el (absolute, centre anchored by the caller's CSS) along points from a to b */
  function travel(el, points, t, a, b, ease = cubic, extra = '') {
    const p = ease(prog(t, a, b));
    const [x, y] = pathPoint(points, p);
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.transform = extra;
    return p;
  }
  /* dotted connector whose dots flow along the stroke: set stroke-dasharray on the path, call each frame.
     speed in px/s; sign gives direction. */
  function dashFlow(pathEl, t, speed = 120) {
    pathEl.style.strokeDashoffset = (-t * speed).toFixed(2);
  }

  /* ---- decision reel (slot machine) ----
     Between a and b the reel steps through `items`, fast first then slowing, landing on finalIndex at b.
     Returns { index, frac, done }: `index` is the item in the window, `frac` (0..1) the progress to the next step
     (use -frac × rowHeight as translateY for a rolling drum), `done` once locked. Pass el = null to only compute. */
  function reel(el, items, t, a, b, finalIndex, { spins = 12 } = {}) {
    const n = items.length;
    const p = prog(t, a, b);
    const kf = t < a ? 0 : spins * (1 - Math.pow(1 - p, 2.2));            // steps taken so far, fast then slow
    const k = Math.min(spins, Math.floor(kf));
    const index = (((finalIndex - (spins - k)) % n) + n) % n;               // lands on finalIndex at k = spins
    const frac = t < a || t >= b ? 0 : kf - k;
    if (el) el.textContent = items[index];
    return { index, frac, done: t >= b };
  }

  /* ---- shared-element morph: an element drawn at rect `from` ({x,y,w,h}) ends at rect `to` as p goes 0 → 1.
     The element's natural size must equal `to`; it is scaled, not re-laid-out, so text stays crisp at p = 1. */
  function morphRect(el, from, to, p) {
    const sx = lerp(from.w / to.w, 1, p), sy = lerp(from.h / to.h, 1, p);
    const x = lerp(from.x, to.x, p), y = lerp(from.y, to.y, p);
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${x - to.x}px, ${y - to.y}px) scale(${sx}, ${sy})`;
  }

  /* frame sequences extracted from real recordings: setFrame(img, 'assets/rec/', index) */
  function setFrame(img, dir, i) { const src = `${dir}${String(i).padStart(3, '0')}.jpg`; if (!img.src.endsWith(src)) img.src = src; }
  function preloadFrames(dir, count) {
    return Array.from({ length: count }, (_, k) => { const im = new Image(); im.src = `${dir}${String(k + 1).padStart(3, '0')}.jpg`; return im.decode().catch(() => {}); });
  }

  /* start({ duration, width, height, scenes, render, after, preload, transition })
       scenes:  [[id, start, end, ...extra]] — overlap neighbours when the style's own transition needs both on screen.
       render:  { [id]: (t) => void } — called only while that scene is on.
       after:   (t, current) => void — style-wide layers (wipes, chrome); current = the scene row on top
                (never null: during a gap between scenes it is the last scene that started).
       preload: promises to await before __ready (fonts, frames, textures, 3D setup).
       transition: 'none' (default) — the style must carry its own transition (wipe, shared element, protagonist);
                   'fade' — 0.25s opacity cross-fade at every cut (legacy; reads as a slideshow). */
  function start({ duration, width = 1920, height = 1080, scenes, render = {}, after = () => {}, preload = [], transition = 'none' }) {
    const stage = $('stage');
    stage.style.width = width + 'px';
    stage.style.height = height + 'px';
    function frame(t) {
      let current = null;
      for (const row of scenes) {
        const [id, a, b] = row;
        const on = t >= a && t <= b;
        const el = $(id);
        el.style.display = on ? '' : 'none';
        if (!on) continue;
        if (transition === 'fade') {
          const fadeIn = a === 0 ? 1 : prog(t, a, a + .25);
          const fadeOut = b >= duration ? 1 : 1 - prog(t, b - .25, b);
          el.style.opacity = Math.min(fadeIn, fadeOut);
        } else el.style.opacity = 1;
        if (render[id]) render[id](t);
        if (t >= a + .1 || !current) current = row;
      }
      /* in a gap between scenes, the last scene that started stays current */
      after(t, current ?? scenes.filter((r) => r[1] <= t).pop() ?? scenes[0]);
    }
    function fit() {
      const s = Math.min(innerWidth / width, innerHeight / height);
      stage.style.transform = `scale(${s})`;
      stage.style.left = (innerWidth - width * s) / 2 + 'px';
      stage.style.top = (innerHeight - height * s) / 2 + 'px';
    }
    addEventListener('resize', fit);
    window.__duration = duration;
    window.__size = [width, height];
    window.__seek = (t) => frame(clamp(t, 0, duration - 0.001));
    Promise.all([document.fonts.ready, ...preload, ...[...document.images].map((i) => i.decode().catch(() => {}))]).then(() => {
      fit();
      frame(0);
      window.__ready = true;
      if (window.__recording) return; /* renderer drives time */
      let t0 = performance.now() - (parseFloat(new URLSearchParams(location.search).get('t')) || 0) * 1000;
      const tick = (now) => {
        let t = (now - t0) / 1000;
        if (t >= duration) { t0 = now; t = 0; }
        frame(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  Object.assign(window, { $, clamp, prog, lerp, expoOut, cubic, backOut, elasticOut, inExpo, inBack, spring, squash, beats, pulse, rng,
    show, rise, typeText, counter, splitChars, riseChars, pathPoint, travel, dashFlow, reel, morphRect, setFrame, preloadFrames });
  window.LV = { start };
})();
