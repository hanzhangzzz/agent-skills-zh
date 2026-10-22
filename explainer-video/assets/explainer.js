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
                                                「关键词」 is highlighted in the chapter colour
     sfx: [[1.2, 'pop'], [3, 'chime', .5]],     extra cues at local seconds (name, gain)
     enter: 'dissolve' | 'cut',                 'cut' when this shot starts with the previous shot's last frame
                                                (same protagonist, same place) — the seamless continuity cut
     hud: true,                                 false hides HUD for hook / ending shots
     html: `<div class="card abs" id="tls-card">…</div>`,   built once
     init(el) {},                               optional, once after html is in the DOM (split chars, cache)
     render(el, u, d, t) {}                     pure: u = local time (can exceed d during the dissolve tail),
                                                d = dur, t = global time. Never read the previous frame.
   })
   EX.run({ meter: { label, unit, decimals, max, ticks, seconds? }, rate: null to hide, mood, bgm_gain })
     unit s / ms / min / h / 天 / 年 (or seconds: real seconds per unit) lets the rate pill show 慢放 ×N or 快进 ×N itself;
     meters that are not time (km, 层, 10ⁿ m) get no rate pill.

   Shot helpers (pure functions of u): EX.pop EX.fadeUp EX.fadeOut EX.place EX.drawPath EX.num EX.type EX.stagger
   EX.meterAt(t) — the HUD meter's value at global time t; any on-screen copy of the meter must read it
   Page contract for render.mjs: __duration __seek __ready (from engine.js) + __shots __cues __lint. */
(function () {
  const C = { blue: '#3B6CF6', purple: '#7C4DFF', pink: '#E6458B', green: '#14B27A', orange: '#F59E0B', cyan: '#0EA5C6', red: '#EF4444', indigo: '#4F46E5' };
  const TOKEN_COLORS = [C.blue, C.purple, C.pink, C.cyan, C.green, C.orange, C.red, C.indigo];
  const chapters = [], shots = [];
  const XFADE = 0.5;
  let curShot = null;   /* shot on top at the last rendered frame; lint() reads it */

  function chapter(id, o) { chapters.push({ id, name: o.name, color: o.color || TOKEN_COLORS[chapters.length % 8] }); }
  function shot(o) { shots.push(Object.assign({ enter: 'dissolve', hud: true, caps: [], sfx: [] }, o)); }

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
  function timeline() {
    let t = 0, lastMeter = null;
    shots.forEach((s) => {
      s.start = t; t += s.dur;
      s.ch = chapters.find((c) => c.id === s.chapter) || null;
      s.color = s.ch ? s.ch.color : C.blue;
      s.m0 = s.meter ? s.meter[0] : lastMeter; s.m1 = s.meter ? s.meter[1] : lastMeter;
      lastMeter = s.m1;
    });
    return t;
  }

  function run(cfg = {}) {
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
    shots.forEach((s) => {
      const sec = document.createElement('section');
      sec.className = 'shot'; sec.id = s.id; sec.innerHTML = s.html || '';
      world.appendChild(sec); s.el = sec;
    });
    shots.forEach((s, i) => {
      const next = shots[i + 1];
      s.end = s.start + s.dur + (next && next.enter !== 'cut' ? XFADE : 0);
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

    const scenes = shots.map((s) => [s.id, s.start, s.end]);
    const render = {};
    shots.forEach((s, i) => {
      const next = shots[i + 1];
      render[s.id] = (tt) => {
        const u = tt - s.start;
        s.render && s.render(s.el, u, s.dur, tt);
        /* transition: dissolve in over XFADE (unless cut / first), dissolve out in the tail */
        let o = 1, sc = 1;
        if (s.enter !== 'cut' && i > 0) { const p = cubic(prog(u, 0, XFADE)); o = p; sc = lerp(.985, 1, p); }
        if (next && next.enter !== 'cut') { const q = cubic(prog(u, s.dur, s.dur + XFADE)); o = Math.min(o, 1 - q); sc *= lerp(1, 1.03, q); }
        s.el.style.opacity = o;
        s.el.style.transform = sc === 1 ? '' : `scale(${sc})`;
      };
    });

    let lastCapKey = '';
    function after(tt) {
      background(tt);
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
      for (const [a, text] of cur.caps) if (u >= a) { cap = text; capT = a; }
      if (cap == null) { capPill.style.opacity = 0; capPill.style.visibility = 'hidden'; return; }
      const key = cur.id + '|' + cap;
      if (key !== lastCapKey) { capPill.innerHTML = capHTML(cap, cur.color); lastCapKey = key; }
      const p = expoOut(prog(u, capT, capT + .45));
      const tail = cur.end > cur.start + cur.dur ? 1 - cubic(prog(u, cur.dur, cur.dur + XFADE)) : 1;
      capPill.style.visibility = '';
      capPill.style.opacity = Math.min(p, tail);
      capPill.style.transform = `translate(-50%, ${(1 - p) * 14}px)`;
    }

    /* auto cues: whoosh at each chapter's first shot, soft tick at other dissolves, plus each shot's own sfx */
    const cues = [];
    shots.forEach((s, i) => {
      const prev = shots[i - 1];
      if (i > 0 && s.chapter && (!prev || prev.chapter !== s.chapter)) cues.push({ t: +s.start.toFixed(3), sfx: 'whoosh', gain: .45 });
      else if (i > 0 && s.enter !== 'cut') cues.push({ t: +s.start.toFixed(3), sfx: 'tick', gain: .25 });
      s.sfx.forEach(([a, name, g]) => cues.push({ t: +(s.start + a).toFixed(3), sfx: name, gain: g ?? .5 }));
    });
    cues.sort((a, b) => a.t - b.t);
    window.__cues = { mood: cfg.mood || 'calm', bgm_gain: cfg.bgm_gain ?? .5, cues };
    window.__shots = shots.map((s) => ({ id: s.id, chapter: s.chapter, hud: s.hud, start: +s.start.toFixed(3), dur: s.dur, caps: s.caps.map((c) => c[1]) }));
    window.__lint = lint;
    window.__audit = () => audit(duration);

    LV.start({ duration, width: 1920, height: 1080, scenes, render, after, preload: cfg.preload || [] });
  }

  /* timeline audit: pacing rules a model can check without seeing the video */
  function audit(duration) {
    const out = [];
    if (duration < 80 || duration > 160) out.push(`DURATION ${duration.toFixed(1)}s (target 90–150s; lint range 80–160s)`);
    if (chapters.length < 5) out.push(`CHAPTERS only ${chapters.length} (target 6–10)`);
    let lastM = -Infinity;
    shots.forEach((s) => {
      if (s.dur > 12) out.push(`LONG ${s.id} ${s.dur}s — over 12s: split it or it will sit still`);
      if (s.chapter && s.dur < 4) out.push(`SHORT ${s.id} ${s.dur}s — an explained shot needs ≥ 4s`);
      if (s.hud && s.chapter && !s.caps.length) out.push(`NO-CAPTION ${s.id}`);
      if (s.meter && s.m0 < lastM - 1e-9) out.push(`METER-BACKWARDS ${s.id} starts at ${s.m0} after ${lastM}`);
      if (s.meter) lastM = s.m1;
      s.caps.forEach(([a, text], i) => {
        const plain = text.replace(/[「」]/g, '');
        const until = i + 1 < s.caps.length ? s.caps[i + 1][0] : s.dur;
        const need = plain.length / 6 + 1;
        if (plain.length > 24) out.push(`CAPTION-LONG ${s.id} "${plain}" ${plain.length} chars (max 24, split it)`);
        if (until - a < need - .05) out.push(`CAPTION-FAST ${s.id} "${plain.slice(0, 10)}…" on screen ${(until - a).toFixed(1)}s, needs ${need.toFixed(1)}s`);
      });
    });
    chapters.forEach((c) => {
      const first = shots.find((s) => s.chapter === c.id);
      if (!first) out.push(`EMPTY-CHAPTER ${c.id}`);
      else if (!shots.filter((s) => s.chapter === c.id).some((s) => s.caps.some(([, x]) => /「.+」/.test(x)))) out.push(`NO-TERM chapter ${c.id}: name its concept once as 「术语」 in a caption`);
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
      const box = { x: (r.left - S.left) / k, y: (r.top - S.top) / k, w: r.width / k, h: r.height / k };
      const scale = el.offsetHeight ? r.height / k / el.offsetHeight : 1;
      const fs = parseFloat(getComputedStyle(el).fontSize) * scale;
      const inChrome = !!el.closest('#hud, #cap');
      texts.push({ el, box, inChrome, cap: !!el.closest('#cap'), o });
      if (box.x < -2 || box.y < -2 || box.x + box.w > 1922 || box.y + box.h > 1082) issues.push(`OFFSCREEN ${name(el)} at ${box.x | 0},${box.y | 0} ${box.w | 0}×${box.h | 0}`);
      if (!inChrome && fs < 22 - .5 && o > .6) issues.push(`SMALL ${name(el)} font ${fs.toFixed(1)}px (min 22; body text 24)`);
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
    /* composition: the union of everything painted in the current shot must fill and centre the safe area.
       Skipped for hud:false shots (hook, title, ending), which may be deliberately minimal. */
    if (curShot && composition) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      curShot.el.querySelectorAll('*').forEach((el) => {
        if (el.tagName.toLowerCase() === 'svg' || vis(el) < .35) return;
        const r = el.getBoundingClientRect();
        if (r.width < 4 && r.height < 4) return;
        if (r.width / k > 1700 && r.height / k > 850) return;          /* full-frame layers are backgrounds */
        const cs = getComputedStyle(el);
        const painted = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || el instanceof SVGGraphicsElement
          || el.tagName === 'IMG' || el.tagName === 'CANVAS' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0;
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
        x0 = Math.min(x0, (L - S.left) / k); y0 = Math.min(y0, (T - S.top) / k); x1 = Math.max(x1, (R - S.left) / k); y1 = Math.max(y1, (B - S.top) / k);
      });
      const SW = 1760, SH = 720, SCX = 960, SCY = 540;                   /* safe area x 80–1840, y 180–900 */
      if (x1 < x0) issues.push('EMPTY nothing painted in this shot');
      else {
        const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        /* hook / title / ending (hud:false) may be minimal, but a title still has to read as a poster */
        const sparse = curShot.hud ? (w * h < .3 * SW * SH || (w < .55 * SW && h < .55 * SH)) : (w * h < .1 * SW * SH && w < .45 * SW);
        if (sparse)
          issues.push(`SPARSE content spans ${w | 0}×${h | 0}px (${(100 * w / SW) | 0}% × ${(100 * h / SH) | 0}% of the safe area): scale the main visual up or add the missing parts — target ≥ 60% of the width or height` + (curShot.hud ? '' : ' (titles: ≥ 120 px type plus one strong shape)'));
        if (curShot.hud && (Math.abs(cx - SCX) > .14 * SW || Math.abs(cy - SCY) > .16 * SH))
          issues.push(`OFF-CENTER content centre at ${cx | 0},${cy | 0}, safe-area centre is ${SCX},${SCY}: move the composition`);
      }
    }
    return [...new Set(issues)];
  }

  window.EX = { C, TOKEN_COLORS, chapter, shot, run, pop, fadeUp, fadeOut, place, drawPath, num, type, stagger, meterAt,
    planAudit: () => audit(timeline()) };   /* pacing audit without a browser (tests, quick checks) */
})();
