/* explainer-video framework · load after engine.js, before your shots file.
   It owns everything that is the same in every explainer: background, HUD (chapter chip, journey meter
   with scrubber, rate pill), bottom captions, shot timeline, transitions, auto sound cues and the layout lint.
   You only write shots: what is on screen and how it moves.

   EX.chapter(id, { name, color })            declare chapters in order (color: a value of EX.C)
   EX.shot({                                    declare shots in order; they play back to back
     id: 'tls',                                 unique, becomes the <section> id
     chapter: 'pack',                           chapter id, or null for hook / title / ending shots
     dur: 7,                                    seconds on screen (reading time + action time)
     meter: [0.001, 0.004],                     journey-meter value at shot start and end (omit = hold)
     caps: [[0, '再经「TLS 加密」：内容只剩乱码。'], [3.5, '…']],   bottom captions, u = local seconds;
                                                「关键词」 is highlighted in the chapter colour (EX.run accent
                                                outside chapters). A caption stays until the next one or the shot
                                                ends; end it earlier with a third element [t, text, end] or clear
                                                it with [t, null] (e.g. before a title card)
     sfx: [[1.2, 'pop'], [3, 'chime', .5]],     extra cues at local seconds (name, gain). Names:
                                                UI   click tick pop chime snap whoosh reveal type thud blip glitch drop
                                                foley pour paper glass metal wood crackle impact riser swoosh-soft
                                                riser is a 2.4 s swell whose cue time is where it ENDS (put the impact
                                                on the same time); music ducks 5 dB under impact / riser / chime
     amb: 'wind',                               ambience bed under this shot: wind room hum water fire city space;
                                                the same bed on consecutive shots continues, a new one crossfades 0.6 s
     hush: [[2.5, 4]],                          near-silence: music and ambience dip to -24 dB between these local times
                                                (fades down in the 0.3 s before; sfx are not hushed) — before the turn
     enter: 'dissolve' | 'cut' | 'fly',         'cut' when this shot starts with the previous shot's last frame
                                                (same protagonist, same place) — the seamless continuity cut;
                                                'fly' moves the camera from the previous shot to this one (default
                                                whenever the two shots sit at different `at`)
     at: [x, y, s],                             where this shot's 1920×1080 frame sits in the world: centre x, y and
                                                scale s (0.1 = a tenth of the size, i.e. a detail inside a bigger shot).
                                                Omit = [960, 540, 1], the plain screen. With `at`, the camera pushes in
                                                3% over the shot unless you give cam.
     cam(u, d) { return [x, y, s, rot] },       optional camera pose in world coordinates during the shot (pan, push,
                                                orbit-like drift). s = how much world the screen shows (0.5 = 2× zoom).
     fly: 1.2,                                  seconds of the camera move into this shot (enter 'fly')
     flyEase: EX.ramp,                          easing of that move: cubic (default, smooth) or EX.ramp (speed ramp:
                                                creeps, rushes, then settles — the "accelerate between scenes" move)
     hud: true,                                 false hides HUD for hook / ending shots
     html: `<div class="card abs" id="tls-card">…</div>`,   built once
     init(el) {},                               optional, once after html is in the DOM (split chars, cache)
     render(el, u, d, t) {}                     pure: u = local time (can exceed d during the dissolve tail),
                                                d = dur, t = global time. Never read the previous frame.
   })
   EX.world({ html, init(el), render(el, t) })  optional persistent layer in world coordinates, under every shot:
                                                the road, map or landscape the shots are stations on (camera films it)
   EX.backdrop({ html, init(el), render(el, t), subject })  optional full-frame layer fixed to the screen, behind the
                                                world: sky, starfield, particles (scenery: the composition lint ignores it), or
                                                a three.js scene that holds the main subject (subject: true, so it counts).
                                                Read EX.cam(t) to follow the camera.
   EX.run({ meter: { label, unit, decimals, max, ticks, seconds? }, rate: null to hide, mood, bgm_gain, amb_gain, accent,
            accent: '#hex',    colour of 「term」 in captions for shots outside any chapter (hook, title, ending);
                               default: the first chapter's colour, else the framework blue — set it in cinema films
            autoCues: false,   (default true) turns off the automatic chapter whoosh / dissolve tick / fly whoosh;
                               each shot's own sfx stay. Turn it off when you write a score (the auto whoosh lands in
                               score troughs and audio_check reports HISS)
            theme: 'dark', chrome: 'cinema', post: { vignette: .4, grain: 6 }, composition: 'cinema' })
     chrome 'pill' (default, glass pills) | 'cinema' (no boxes: a thin top timeline, small chapter label,
            unboxed caption — for art-directed films); post.vignette 0–1 darkens the corners;
            post.grain (ffmpeg noise strength, 4–10) is added when the video is encoded, not in stills
     composition 'cinema': the pixel lint stops asking for big, centred, filled infographics (SPARSE / THIN /
            OFF-CENTER are skipped: one small luminous subject in darkness is the point) and checks instead that the
            brightest region is not under the caption; EMPTY and every text rule stay. Default: infographic rules.
   const B = EX.tempo(96)                       beat grid: B(n) = seconds of beat n at 96 bpm; the music is synthesized at
                                                this tempo, so durations, cuts and landings on B(n) hit the beat
     unit s / ms / min / h / 天 / 年 (or seconds: real seconds per unit) lets the rate pill show 慢放 ×N or 快进 ×N itself;
     meters that are not time (km, 层, 10ⁿ m) get no rate pill.

   Shot helpers (pure functions of u): EX.pop EX.fadeUp EX.fadeOut EX.place EX.drawPath EX.num EX.type EX.stagger EX.sweep
   EX.meterAt(t) — the HUD meter's value at global time t; any on-screen copy of the meter must read it
   EX.cam(t) — camera pose [x, y, s, rot] at global time t
   Page contract for render.mjs: __duration __seek __ready (from engine.js) + __shots __cues __lint. */
(function () {
  const C = { blue: '#3B6CF6', purple: '#7C4DFF', pink: '#E6458B', green: '#14B27A', orange: '#F59E0B', cyan: '#0EA5C6', red: '#EF4444', indigo: '#4F46E5' };
  const TOKEN_COLORS = [C.blue, C.purple, C.pink, C.cyan, C.green, C.orange, C.red, C.indigo];
  const chapters = [], shots = [];
  const XFADE = 0.5, FLY = 1.2;
  const HOME = [960, 540, 1];
  let curShot = null;   /* shot on top at the last rendered frame; lint() reads it */
  let worldLayer = null, backLayer = null;

  function chapter(id, o) { chapters.push({ id, name: o.name, color: o.color || TOKEN_COLORS[chapters.length % 8] }); }
  function shot(o) { shots.push(Object.assign({ hud: true, caps: [], sfx: [] }, o)); }
  function world(o) { worldLayer = o; }
  let bpm = null;
  function tempo(b) { bpm = b; return (n) => (n * 60) / b; }
  /* speed ramp: slow start, a rush through the middle, a long settle (expo in-out) */
  const ramp = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2);
  function backdrop(o) { backLayer = o; }

  /* ---------- helpers for shot authors (all pure in u) ---------- */
  /* spring pop-in at local time a: scale from s0 to 1 with overshoot, opacity in 0.15 s. Returns progress 0..1 */
  function pop(el, u, a, { s0 = .6, w = 16, z = .55, x = 0, y = 0 } = {}) {
    const k = spring(u - a, w, z);
    if (el instanceof SVGElement) { el.style.transformBox = 'fill-box'; el.style.transformOrigin = '50% 50%'; }  /* scale SVG around its own centre */
    const o = clamp((u - a) / .15);
    el.style.opacity = o; el.style.visibility = o <= 0 ? 'hidden' : '';
    el.style.transform = `translate(${x}px,${y}px) scale(${lerp(s0, 1, k)})`;
    return clamp(k);
  }
  /* rise in at a (dist px), optional fade out ending at b */
  function fadeUp(el, u, a, b = 1e9, dist = 24) {
    const p = expoOut(prog(u, a, a + .6));
    const o = Math.min(p, 1 - cubic(prog(u, b - .35, b)));
    el.style.opacity = o; el.style.visibility = o <= 0 ? 'hidden' : '';
    el.style.transform = `translateY(${(1 - p) * dist}px)`;
    return p;
  }
  function fadeOut(el, u, a, dur = .4) { const o = 1 - cubic(prog(u, a, a + dur)); el.style.opacity = o; el.style.visibility = o <= 0 ? 'hidden' : ''; }
  /* absolute placement by centre point; el must have class "abs" (or position:absolute) */
  /* HTML: centre of el at (x, y). SVG: draw the shape around (0, 0) and place() moves its origin to (x, y).
     pop() and place() both write transform: on one element use one of them (place's s takes a spring value). */
  function place(el, x, y, s = 1, o = 1, rot = 0) {
    if (el instanceof SVGElement) {
      el.style.transformBox = 'view-box'; el.style.transformOrigin = '0 0';
      el.style.transform = `translate(${x}px,${y}px) rotate(${rot}deg) scale(${s})`;
    } else {
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.style.transform = `translate(-50%,-50%) scale(${s}) rotate(${rot}deg)`;
    }
    el.style.opacity = o; el.style.visibility = o <= 0 ? 'hidden' : '';
  }
  /* reveal an SVG path's stroke from 0 to p (0..1) */
  function drawPath(path, p) {
    const L = path.__len || (path.__len = path.getTotalLength());
    path.style.strokeDasharray = `${L} ${L}`;
    path.style.strokeDashoffset = (L * (1 - clamp(p))).toFixed(2);
    path.style.visibility = p <= 0 ? 'hidden' : '';                 /* a round cap would otherwise show a dot at p = 0 */
  }
  /* number with thousands separators counting up as p goes 0 → 1 (p is clamped: no overshoot) */
  function num(el, value, p, decimals = 0, prefix = '', suffix = '') {
    el.textContent = prefix + (value * clamp(p)).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  }
  /* typewriter: el.textContent = first N chars of str, cps chars per second from a; caret blinks if el has .caret child */
  function type(el, str, u, a, cps = 14) { el.textContent = str.slice(0, Math.max(0, Math.floor((u - a) * cps))); return clamp((u - a) * cps / str.length); }
  /* kinetic type: the colour sweeps through el's characters from a to b (karaoke / "the word lights up").
     Call splitChars(el) once in init. base = colour before the sweep, hot = colour after. */
  function sweep(el, u, a, b, hot, base = '') {
    const chars = splitChars(el), k = (chars.length + 1) * clamp((u - a) / (b - a));
    chars.forEach((c, i) => { const on = clamp(k - i); c.style.color = on >= 1 ? hot : on <= 0 ? base : `color-mix(in srgb, ${hot} ${on * 100 | 0}%, ${base || 'currentColor'})`; });
  }
  /* call fn(el, localStart) for each element with a staggered start */
  function stagger(els, u, a, step, fn) { [...els].forEach((el, i) => fn(el, u, a + i * step, i)); }

  /* journey-meter value at global time t (same value the HUD shows). Use it for any on-screen number that means
     the same thing as the meter (a big “第 N 天”, a clock), so the two never disagree: EX.meterAt(t) inside render(el, u, d, t). */
  function meterAt(t) {
    let cur = null;
    for (const s of shots) if (s.start <= t) cur = s;
    if (!cur || cur.m0 == null) return 0;
    return lerp(cur.m0, cur.m1, clamp((t - cur.start) / cur.dur));
  }

  /* camera pose [x, y, s, rot] at global time t: the shot's own pose (cam(u) or `at` with a 3% push-in),
     and during a fly the move from where the previous shot's camera ended. */
  function poseOf(s, u) {
    if (typeof s.cam === 'function') { const p = s.cam(u, s.dur); return [p[0], p[1], p[2] ?? 1, p[3] || 0]; }
    if (s.pos === HOME) return HOME;
    return [s.pos[0], s.pos[1], s.pos[2] * lerp(1, .97, clamp(u / s.dur)), 0];
  }
  function camAt(t) {
    let i = -1;
    for (let k = 0; k < shots.length; k++) if (shots[k].start <= t) i = k;
    if (i < 0) return poseOf(shots[0], 0);
    const s = shots[i], u = t - s.start;
    if (s.enter !== 'fly' || i === 0 || u >= s.flyDur) return poseOf(s, u);
    /* fly between two fixed poses (where the previous camera stopped, where this one is when the fly ends) */
    const prev = shots[i - 1];
    return flyPose(poseOf(prev, prev.dur), poseOf(s, s.flyDur), (s.flyEase || cubic)(u / s.flyDur));
  }
  /* zoom between two poses so one world point stays put on screen (the natural "push into a detail" move);
     at equal scale it is a pan that pulls back a little in the middle so both ends are briefly in view */
  function flyPose(a, b, p) {
    const rot = lerp(a[3] || 0, b[3] || 0, p);
    if (Math.abs(Math.log(a[2] / b[2])) < .05) {
      const dist = Math.hypot(b[0] - a[0], b[1] - a[1]) / (1920 * a[2]);
      const s = lerp(a[2], b[2], p) * (1 + Math.min(.6, .35 * dist) * Math.sin(Math.PI * p));
      return [lerp(a[0], b[0], p), lerp(a[1], b[1], p), s, rot];
    }
    const s = Math.exp(lerp(Math.log(a[2]), Math.log(b[2]), p));
    const w = (s - a[2]) / (b[2] - a[2]);          /* screen = (world - c) / s, so a fixed point needs c linear in s */
    return [lerp(a[0], b[0], w), lerp(a[1], b[1], w), s, rot];
  }

  /* ---------- build ---------- */
  function capHTML(text, color) {
    return text.replace(/「([^」]+)」/g, (_, k) => `<em style="color:${color}">“${k}”</em>`);
  }
  function fmtRate(r) {
    if (!isFinite(r) || r <= 0) return '';
    const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(r)) - 1));
    return '×' + (Math.round(r / p) * p).toLocaleString('en-US');
  }

  /* start times and meter values of every shot (no DOM, so it can be checked offline: EX.planAudit()) */
  let ACCENT = null;                                   /* EX.run({ accent }): colour for shots outside any chapter */
  function timeline() {
    let t = 0, lastMeter = null;
    shots.forEach((s, i) => {
      s.pos = s.at ? [s.at[0], s.at[1], s.at[2] ?? 1] : HOME;
      const prev = shots[i - 1];
      const moved = prev && prev.pos.some((v, k) => Math.abs(v - s.pos[k]) > 1e-6);
      /* a dissolve between shots in different places would cut the camera mid-fade: fly instead */
      if (!s.enter || (s.enter === 'dissolve' && moved)) s.enter = moved ? 'fly' : 'dissolve';
      s.flyDur = s.fly ?? FLY;
      s.start = t; t += s.dur;
      s.ch = chapters.find((c) => c.id === s.chapter) || null;
      s.color = s.ch ? s.ch.color : (ACCENT || (chapters[0] ? chapters[0].color : C.blue));   /* hook / ending: EX.run accent, else the first chapter's colour */
      s.m0 = s.meter ? s.meter[0] : lastMeter; s.m1 = s.meter ? s.meter[1] : lastMeter;
      lastMeter = s.m1;
    });
    return t;
  }

  function run(cfg = {}) {
    ACCENT = cfg.accent || null;
    const meterCfg = Object.assign({ label: '', unit: '', decimals: 0, max: 1, ticks: [] }, cfg.meter || {});
    /* rate pill: how much real time one second of film covers. The meter unit is converted to seconds
       (meter.seconds overrides), and the label switches itself: 慢放 when film time > real time, 快进 otherwise. */
    const UNIT_S = { s: 1, '秒': 1, ms: .001, '毫秒': .001, min: 60, '分钟': 60, h: 3600, '小时': 3600, '天': 86400, '日': 86400, '年': 31557600 };
    const unitSec = meterCfg.seconds ?? UNIT_S[meterCfg.unit.trim()];
    const rateCfg = cfg.rate === null || unitSec == null ? null : {};
    const stage = $('stage');
    const world = $('world');

    /* timeline */
    const duration = timeline();
    if (cfg.theme) stage.classList.add('theme-' + cfg.theme);
    if (cfg.chrome) stage.classList.add('chrome-' + cfg.chrome);
    const post = cfg.post || {};
    if (post.vignette) {
      const v = document.createElement('div');
      v.id = 'vignette';
      v.style.cssText = `position:absolute;inset:0;z-index:39;pointer-events:none;background:radial-gradient(120% 100% at 50% 50%,transparent 55%,rgba(0,0,0,${post.vignette}) 100%)`;
      stage.insertBefore(v, $('hud'));
    }
    window.__post = { grain: post.grain || 0 };
    window.__composition = cfg.composition === 'cinema' ? 'cinema' : 'explainer';   /* render.mjs picks its pixel rules */
    const layer = (o, id, parent, before) => {
      const el = document.createElement('div');
      el.id = id; el.className = 'layer'; el.innerHTML = o.html || '';
      parent.insertBefore(el, before); o.el = el;
    };
    if (backLayer) { layer(backLayer, 'back', stage, world); if (backLayer.subject) backLayer.el.dataset.subject = ''; }
    if (worldLayer) layer(worldLayer, 'world-layer', world, null);
    shots.forEach((s) => {
      const sec = document.createElement('section');
      sec.className = 'shot'; sec.id = s.id; sec.innerHTML = s.html || '';
      if (s.pos !== HOME) { sec.style.left = (s.pos[0] - 960) + 'px'; sec.style.top = (s.pos[1] - 540) + 'px'; }
      world.appendChild(sec); s.el = sec;
    });
    shots.forEach((s, i) => {
      const next = shots[i + 1];
      s.end = s.start + s.dur + (!next || next.enter === 'cut' ? 0 : next.enter === 'fly' ? next.flyDur : XFADE);
    });
    chapters.forEach((c, i) => {
      c.index = i + 1;
      const own = shots.filter((s) => s.chapter === c.id && s.meter);
      c.m0 = own.length ? Math.min(...own.map((s) => s.m0)) : 0;
      c.m1 = own.length ? Math.max(...own.map((s) => s.m1)) : 0;
    });

    /* HUD */
    $('hud').innerHTML = `
      <div id="hud-chip" class="pill"><b id="hud-num">01</b><span id="hud-name"></span></div>
      <div id="hud-meter">
        <div class="pill" id="hud-clock"><span class="lbl">${meterCfg.label}</span><span id="hud-val" class="mono">0</span><span class="unit">${meterCfg.unit}</span></div>
        <div id="hud-scrub"><div id="hud-track"></div>${chapters.map((c) => `<div class="seg" id="seg-${c.id}" style="background:${c.color}"></div>`).join('')}<div id="hud-knob"></div>
          ${meterCfg.ticks.map((v) => `<span class="tick mono" style="left:${(v / meterCfg.max) * 100}%">${v}${meterCfg.unit}</span>`).join('')}</div>
      </div>
      <div id="hud-rate" class="pill"><span class="lbl" id="hud-rate-l"></span><b id="hud-rate-v"></b></div>`;
    $('cap').innerHTML = '<div id="cap-pill" class="pill"></div>';
    const capPill = $('cap-pill');

    shots.forEach((s) => s.init && s.init(s.el));
    for (const o of [backLayer, worldLayer]) if (o && o.init) o.init(o.el);

    const scenes = shots.map((s) => [s.id, s.start, s.end]);
    const render = {};
    shots.forEach((s, i) => {
      const next = shots[i + 1];
      render[s.id] = (tt) => {
        const u = tt - s.start;
        s.render && s.render(s.el, u, s.dur, tt);
        /* transition in: dissolve over XFADE, or fade up during the first half of a camera fly; cut / first: none.
           transition out (tail): dissolve, or fade during the second half of the next shot's fly. */
        let o = 1, sc = 1;
        if (i > 0 && s.enter === 'dissolve') { const p = cubic(prog(u, 0, XFADE)); o = p; sc = lerp(.985, 1, p); }
        if (i > 0 && s.enter === 'fly') o = cubic(prog(u, 0, s.flyDur * .5));
        if (next && next.enter === 'dissolve') { const q = cubic(prog(u, s.dur, s.dur + XFADE)); o = Math.min(o, 1 - q); sc *= lerp(1, 1.03, q); }
        if (next && next.enter === 'fly') o = Math.min(o, 1 - cubic(prog(u, s.dur + next.flyDur * .45, s.dur + next.flyDur)));
        s.el.style.opacity = o;
        const k = s.pos[2] * sc;
        s.el.style.transform = k === 1 ? '' : `scale(${k})`;
      };
    });

    let lastCapKey = '';
    const camera = (tt) => {
      const pose = camAt(tt);
      world.style.transform = pose === HOME || (pose[0] === 960 && pose[1] === 540 && pose[2] === 1 && !pose[3]) ? ''
        : `translate(960px,540px) rotate(${-(pose[3] || 0)}deg) scale(${1 / pose[2]}) translate(${-pose[0]}px,${-pose[1]}px)`;
    };
    function after(tt) {
      background(tt);
      camera(tt);
      for (const o of [backLayer, worldLayer]) if (o && o.render) o.render(o.el, tt);
      let cur = shots[0];
      for (const s of shots) if (s.start <= tt) cur = s;
      curShot = cur;
      const u = tt - cur.start;
      /* HUD */
      const hudOn = cur.hud;
      const firstHud = shots.find((s) => s.hud);
      const hudIn = firstHud ? expoOut(prog(tt, firstHud.start, firstHud.start + .8)) : 0;
      $('hud').style.opacity = hudOn ? hudIn : 0;
      const chap = cur.ch || chapters[0];
      if (chap) {
        $('hud-num').textContent = String(chap.index).padStart(2, '0');
        $('hud-num').style.background = chap.color;
        $('hud-name').textContent = cur.ch ? chap.name : '';
        $('hud-chip').style.opacity = cur.ch ? 1 : 0;
      }
      const m = cur.m0 == null ? 0 : lerp(cur.m0, cur.m1, clamp(u / cur.dur));
      $('hud-val').textContent = m.toFixed(meterCfg.decimals);
      const W = 560;
      $('hud-knob').style.left = (clamp(m / meterCfg.max) * W) + 'px';
      $('hud-knob').style.borderColor = cur.ch ? cur.ch.color : C.blue;
      chapters.forEach((c) => {
        const a = clamp(c.m0 / meterCfg.max), b = clamp(Math.min(m, c.m1) / meterCfg.max);
        const el = $('seg-' + c.id);
        el.style.left = a * W + 'px'; el.style.width = Math.max(0, b - a) * W + 'px';
      });
      const rateOn = rateCfg && cur.meter && cur.m1 > cur.m0;
      $('hud-rate').style.opacity = rateOn ? 1 : 0;
      if (rateOn) {
        const real = (cur.m1 - cur.m0) * unitSec;                         /* real seconds covered by this shot */
        const slow = cur.dur >= real;
        $('hud-rate-l').textContent = slow ? '慢放' : '快进';
        $('hud-rate-v').textContent = fmtRate(slow ? cur.dur / real : real / cur.dur);
      }
      $('hud-rate-v').style.color = cur.color;
      /* caption */
      let cap = null, capT = 0;
      for (const [a, text, end] of cur.caps) if (u >= a) { cap = end != null && u >= end ? null : text; capT = a; }   /* [t, null] or an end time clears it */
      if (!cap) { capPill.style.opacity = 0; capPill.style.visibility = 'hidden'; return; }
      const key = cur.id + '|' + cap;
      if (key !== lastCapKey) { capPill.innerHTML = capHTML(cap, cur.color); lastCapKey = key; }
      const p = expoOut(prog(u, capT, capT + .45));
      const tail = cur.end > cur.start + cur.dur ? 1 - cubic(prog(u, cur.dur, cur.dur + .4)) : 1;
      capPill.style.visibility = '';
      capPill.style.opacity = Math.min(p, tail);
      capPill.style.transform = `translate(-50%, ${(1 - p) * 14}px)`;
    }

    /* auto cues: whoosh at each chapter's first shot, soft tick at other dissolves, plus each shot's own sfx */
    const cues = [];
    shots.forEach((s, i) => {
      const prev = shots[i - 1];
      if (cfg.autoCues === false) { /* only the shot's own sfx below */ }
      else if (i > 0 && s.chapter && (!prev || prev.chapter !== s.chapter)) cues.push({ t: +s.start.toFixed(3), sfx: 'whoosh', gain: .45 });
      else if (i > 0 && s.enter === 'fly') cues.push({ t: +s.start.toFixed(3), sfx: 'whoosh', gain: .3 });
      else if (i > 0 && s.enter !== 'cut') cues.push({ t: +s.start.toFixed(3), sfx: 'tick', gain: .25 });
      s.sfx.forEach(([a, name, g]) => cues.push({ t: +(s.start + a).toFixed(3), sfx: name, gain: g ?? .5 }));
    });
    cues.sort((a, b) => a.t - b.t);
    /* ambience runs (a bed shared by consecutive shots is one run, so it never restarts) and hush windows */
    const amb = [], hush = [];
    shots.forEach((s) => {
      const t1 = s.start + s.dur, last = amb[amb.length - 1];
      if (s.amb && last && last.name === s.amb && Math.abs(last.t1 - s.start) < 1e-6) last.t1 = t1;
      else if (s.amb) amb.push({ t0: s.start, t1, name: s.amb });
      (s.hush || []).forEach(([a, b]) => hush.push([+(s.start + a).toFixed(3), +(s.start + b).toFixed(3)]));
    });
    amb.forEach((r) => { r.t0 = +r.t0.toFixed(3); r.t1 = +r.t1.toFixed(3); });
    window.__cues = { mood: cfg.mood || 'calm', bgm_gain: cfg.bgm_gain ?? .5, cues, ...(bpm ? { bpm } : {}),
      amb, amb_gain: cfg.amb_gain ?? .5, hush, duck: true };
    window.__shots = shots.map((s) => ({ id: s.id, chapter: s.chapter, hud: s.hud, start: +s.start.toFixed(3), dur: s.dur, caps: s.caps.map((c) => c[1]) }));
    window.__lint = lint;
    window.__audit = () => audit(duration, window.__composition);

    LV.start({ duration, width: 1920, height: 1080, scenes, render, after, preload: cfg.preload || [] });
  }

  /* timeline audit: pacing rules a model can check without seeing the video */
  /* mode 'cinema' (EX.run({ composition: 'cinema' })): few long shots around one luminous subject, 45–100 s;
     mode 'explainer': the infographic structure, 6–10 chapters, 80–160 s */
  function audit(duration, mode = 'explainer') {
    const out = [];
    const cine = mode === 'cinema';
    if (cine ? duration < 45 || duration > 100 : duration < 80 || duration > 160)
      out.push(`DURATION ${duration.toFixed(1)}s (${cine ? 'cinema mode: 60–90s; lint range 45–100s' : 'target 90–150s; lint range 80–160s'})`);
    if (!cine && chapters.length < 6) out.push(`CHAPTERS only ${chapters.length} (target 6–10)`);
    /* sound design (directing.md §4): at least one near-silence, and an ambience bed under most explained shots */
    const explained = shots.filter((s) => s.chapter);
    if (!shots.some((s) => s.hush && s.hush.length)) out.push('SOUND no hush anywhere: add one near-silence (hush: [[u0, u1]]) before the turn or the peak');
    const withAmb = explained.filter((s) => s.amb).length;
    if (explained.length && withAmb < explained.length / 2) out.push(`SOUND only ${withAmb} of ${explained.length} explained shots have an ambience bed (amb): give most shots one`);
    let lastM = -Infinity;
    shots.forEach((s) => {
      if (s.dur > (cine ? 16 : 12)) out.push(`LONG ${s.id} ${s.dur}s — over ${cine ? 16 : 12}s: split it or it will sit still`);
      if (s.chapter && s.dur < (cine ? 3 : 4)) out.push(`SHORT ${s.id} ${s.dur}s — an explained shot needs ≥ ${cine ? 3 : 4}s`);
      if (s.hud && s.chapter && !s.caps.length) out.push(`NO-CAPTION ${s.id}`);
      if (s.meter && s.m0 < lastM - 1e-9) out.push(`METER-BACKWARDS ${s.id} starts at ${s.m0} after ${lastM}`);
      if (s.meter) lastM = s.m1;
      s.caps.forEach(([a, text, end], i) => {
        if (!text) return;                                   /* [t, null]: a clear, not a caption */
        const plain = text.replace(/[「」]/g, '');
        const until = Math.min(end ?? Infinity, i + 1 < s.caps.length ? s.caps[i + 1][0] : s.dur);
        const need = plain.length / 6 + 1;
        if (plain.length > 24) out.push(`CAPTION-LONG ${s.id} "${plain}" ${plain.length} chars (max 24, split it)`);
        if (until - a < need - .05) out.push(`CAPTION-FAST ${s.id} "${plain.slice(0, 10)}…" on screen ${(until - a).toFixed(1)}s, needs ${need.toFixed(1)}s`);
      });
    });
    chapters.forEach((c) => {
      const first = shots.find((s) => s.chapter === c.id);
      if (!first) out.push(`EMPTY-CHAPTER ${c.id}`);
      else if (!cine && !shots.filter((s) => s.chapter === c.id).some((s) => s.caps.some(([, x]) => /「.+」/.test(x)))) out.push(`NO-TERM chapter ${c.id}: name its concept once as 「术语」 in a caption`);
    });
    return out;
  }

  /* drifting pastel blobs + dotted grid, pure in t */
  function background(t) {
    const b = document.querySelectorAll('#bg .blob');
    b.forEach((el, i) => {
      const x = Math.sin(t * .11 + i * 1.7) * 120, y = Math.cos(t * .09 + i * 2.3) * 90;
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
  }

  /* ---------- layout lint: catches what a model cannot see ----------
     For every visible element that directly holds text: outside the 1920×1080 frame, font smaller than 20 px,
     colliding with another text element, hidden under the caption / HUD, or clipped by its own box. */
  function lint({ composition = true } = {}) {
    const issues = [];
    const S = $('stage').getBoundingClientRect();
    const k = S.width / 1920;
    const vis = (el) => {
      let o = 1;
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
        o *= parseFloat(cs.opacity);
      }
      return o;
    };
    const name = (el) => el.id ? '#' + el.id : `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}("${el.textContent.trim().slice(0, 14)}")`;
    const texts = [];
    document.querySelectorAll('#stage *').forEach((el) => {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'text') return;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) return;
      const o = vis(el);
      if (o < .35) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      /* judge only the part a mask lets through: clip to overflow-hidden ancestors below #stage (riseChars masks,
         odometer digits), so a glyph rolling in or out of its mask is neither OFFSCREEN nor overlapping its neighbours */
      let L = r.left, T = r.top, R = r.right, Bm = r.bottom;
      for (let e = el.parentElement; e && e.id !== 'stage'; e = e.parentElement) {
        const ov = getComputedStyle(e).overflow;
        if (ov.includes('hidden') || ov.includes('clip')) { const q = e.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); Bm = Math.min(Bm, q.bottom); }
      }
      if (R - L < 1 || Bm - T < 1) return;
      const box = { x: (L - S.left) / k, y: (T - S.top) / k, w: (R - L) / k, h: (Bm - T) / k };
      /* transform scale = rendered height / layout height; offsetHeight is rounded to whole px (27.5 → 28 reads a
         22 px label as 21.6 px), so take the fractional computed height when there is one (inline boxes: 'auto') */
      const lh = parseFloat(getComputedStyle(el).height) || el.offsetHeight;
      const scale = lh ? r.height / k / lh : 1;
      const fs = parseFloat(getComputedStyle(el).fontSize) * scale;
      const inChrome = !!el.closest('#hud, #cap');
      /* EX.world labels are places the camera films: out of view is normal, half in view is the camera passing by */
      const inWorld = !!el.closest('#world-layer');
      if (inWorld && (box.x > 1920 || box.y > 1080 || box.x + box.w < 0 || box.y + box.h < 0)) return;
      texts.push({ el, box, inChrome, cap: !!el.closest('#cap'), o });
      if (!inWorld && (box.x < -2 || box.y < -2 || box.x + box.w > 1922 || box.y + box.h > 1082)) issues.push(`OFFSCREEN ${name(el)} at ${box.x | 0},${box.y | 0} ${box.w | 0}×${box.h | 0}`);
      if (!inChrome && fs < 22 - .05 && o > .6) issues.push(`SMALL ${name(el)} font ${fs.toFixed(1)}px (min 22; body text 24)`);
      if (el.scrollWidth > el.clientWidth + 2 && ['hidden', 'clip'].includes(getComputedStyle(el).overflowX)) issues.push(`CLIPPED ${name(el)} text wider than its box`);
      const cs = getComputedStyle(el);
      if (!inChrome && cs.color === 'rgba(0, 0, 0, 0)' && !(cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text')) issues.push(`INVISIBLE ${name(el)} text is transparent (a .grad-text child lost its gradient clip?)`);
      /* count the rendered lines of the element's own text (line boxes from a Range, not the element height) */
      const ownText = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      const plain = ownText.map((n) => n.textContent).join('').trim();
      if (!inChrome && plain.length <= 12 && !el.closest('.ch') && !el.classList.contains('ch')) {
        const tops = new Set();
        for (const n of ownText) { const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width > 1) tops.add(Math.round(q.top / 4)); }
        if (tops.size > 1) issues.push(`WRAP ${name(el)} short label "${plain}" breaks into ${tops.size} lines: widen its box or add white-space:nowrap`);
      }
    });
    /* cinema mode: a frame carries one short line, not a diagram's worth of labels */
    if (composition && window.__composition === 'cinema') {
      const words = texts.filter((x) => !x.inChrome && x.o > .6).map((x) => [...x.el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim());
      const chars = words.join('').replace(/\s/g, '').length;
      if (chars > 40) issues.push(`CLUTTER ${chars} characters of on-screen text besides the caption (cinema mode: at most one short line, ≤ 40): cut labels, let the picture explain`);
    }
    const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const chromeBoxes = [...document.querySelectorAll('#cap-pill, #hud-chip, #hud-meter, #hud-rate')].filter((e) => vis(e) > .35).map((e) => {
      const r = e.getBoundingClientRect(); return { e, b: { x: (r.left - S.left) / k, y: (r.top - S.top) / k, w: r.width / k, h: r.height / k } };
    });
    const content = texts.filter((x) => !x.inChrome);
    for (const a of content) for (const c of chromeBoxes) if (inter(a.box, c.b) > 4) issues.push(`UNDER-${c.e.id.toUpperCase()} ${name(a.el)} overlaps the ${c.e.id === 'cap-pill' ? 'caption' : 'HUD'}`);
    for (let i = 0; i < content.length; i++) for (let j = i + 1; j < content.length; j++) {
      const a = content[i], b = content[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ov = inter(a.box, b.box);
      if (ov > .25 * Math.min(a.box.w * a.box.h, b.box.w * b.box.h)) issues.push(`OVERLAP ${name(a.el)} × ${name(b.el)}`);
    }
    /* shapes under the caption / HUD (judged on the mid-shot still). Composition itself (EMPTY / SPARSE / OFF-CENTER /
       THIN) is measured on pixels by render.mjs, so canvas, WebGL and DOM count the same. */
    if (curShot && composition) {
      curShot.el.querySelectorAll('*').forEach((el) => {
        if (el.tagName.toLowerCase() === 'svg' || vis(el) < .35) return;
        const r = el.getBoundingClientRect();
        if (r.width < 4 && r.height < 4) return;
        if (r.width / k > 1700 && r.height / k > 850) return;          /* full-frame layers are backgrounds */
        const cs = getComputedStyle(el);
        const painted = el instanceof SVGGraphicsElement || el.tagName === 'IMG' || el.tagName === 'CANVAS'
          || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0;
        if (!painted) return;
        /* clip to the frame and to every overflow-hidden ancestor (scrolling strips, masks) */
        let L = r.left, T = r.top, R = r.right, B = r.bottom;
        for (let e = el.parentElement; e && e !== curShot.el.parentElement; e = e.parentElement) {
          const o = getComputedStyle(e).overflow;
          if (o.includes('hidden') || o.includes('clip')) { const q = e.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom); }
        }
        L = Math.max(L, S.left); T = Math.max(T, S.top); R = Math.min(R, S.right); B = Math.min(B, S.bottom);
        if (R - L < 2 || B - T < 2) return;
        const pb = { x: (L - S.left) / k, y: (T - S.top) / k, w: (R - L) / k, h: (B - T) / k };
        const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());   /* text is checked by the text rule */
        const scenery = ownsText || pb.w > 1400 || (pb.w < 24 && pb.h < 24) || ['g', 'defs', 'lineargradient', 'radialgradient', 'clippath', 'mask'].includes(el.tagName.toLowerCase());
        if (!scenery) for (const c of chromeBoxes) if (inter(pb, c.b) > 60) issues.push(`UNDER-${c.e.id.toUpperCase()} ${name(el)} is drawn under the ${c.e.id === 'cap-pill' ? 'caption' : 'HUD'}: keep shapes inside the safe area (y 180–900)`);
      });
    }
    return [...new Set(issues)];
  }

  window.EX = { C, TOKEN_COLORS, chapter, shot, world, backdrop, run, tempo, ramp, pop, fadeUp, fadeOut, place, drawPath, num, type, stagger, sweep, meterAt, cam: camAt,
    planAudit: (mode) => audit(timeline(), mode) };   /* pacing audit without a browser (tests, quick checks) */
})();
