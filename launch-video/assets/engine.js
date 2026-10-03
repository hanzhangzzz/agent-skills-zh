/* launch-video engine · shared by every style. Copy next to promo.html; load with <script src="engine.js">.
   Page contract used by scripts/render.mjs: __duration, __size, __seek(t), __ready, __recording.
   Rules that keep frames correct:
     - render(t) must be pure: derive every style, canvas pixel and 3D pose from t, never from the previous frame.
     - Randomness only from rng(seed). Motion with physics (particles, bounces) uses closed-form functions of t.
     - Scenes are toggled with display. Never set a child's visibility to 'visible':
       it overrides a hidden parent and leaks elements into other scenes. */
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
  /* squash & stretch for a landing at time a: returns [scaleX, scaleY], 1,1 at rest */
  function squash(t, a, dur = .45, amount = .22) {
    const p = prog(t, a, a + dur);
    if (p <= 0 || p >= 1) return [1, 1];
    const k = amount * Math.exp(-5 * p) * Math.cos(p * Math.PI * 3);
    return [1 + k, 1 - k];
  }
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
  /* fade + rise in at a, fade out ending at b */
  function rise(el, t, a, b = 1e9, din = .6, dout = .35, dist = 28, extra = '') {
    const inP = expoOut(prog(t, a, a + din));
    const o = Math.min(inP, 1 - cubic(prog(t, b - dout, b)));
    show(el, t < a || t > b ? 0 : o, (1 - inP) * dist, extra);
  }
  const typeText = (str, t, a, cps = 60) => str.slice(0, Math.max(0, Math.floor((t - a) * cps)));
  /* frame sequences extracted from real recordings: setFrame(img, 'assets/rec/', index) */
  function setFrame(img, dir, i) { const src = `${dir}${String(i).padStart(3, '0')}.jpg`; if (!img.src.endsWith(src)) img.src = src; }
  function preloadFrames(dir, count) {
    return Array.from({ length: count }, (_, k) => { const im = new Image(); im.src = `${dir}${String(k + 1).padStart(3, '0')}.jpg`; return im.decode().catch(() => {}); });
  }

  /* start({ duration, width, height, scenes, render, after, preload })
       scenes:  [[id, start, end, ...extra]] — overlap neighbours by ~0.2s; the engine cross-fades them.
       render:  { [id]: (t) => void } — called only while that scene is on.
       after:   (t, current) => void — style-wide layers (wipes, chrome); current = the scene row on top.
       preload: promises to await before __ready (fonts, frames, textures, 3D setup). */
  function start({ duration, width = 1920, height = 1080, scenes, render = {}, after = () => {}, preload = [] }) {
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
        const fadeIn = a === 0 ? 1 : prog(t, a, a + .25);
        const fadeOut = b >= duration ? 1 : 1 - prog(t, b - .25, b);
        el.style.opacity = Math.min(fadeIn, fadeOut);
        if (render[id]) render[id](t);
        if (t >= a + .1 || !current) current = row;
      }
      after(t, current);
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

  Object.assign(window, { $, clamp, prog, lerp, expoOut, cubic, backOut, elasticOut, squash, rng, show, rise, typeText, setFrame, preloadFrames });
  window.LV = { start };
})();
