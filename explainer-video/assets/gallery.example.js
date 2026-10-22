/* gallery.example.js — seven common explainer techniques (画法), one shot each, mixed topics on purpose.
   Render it as is (cp gallery.example.js shots.js), or copy one shot into your own film and change the topic.
   Same pattern as shots.example.js: html (built once) → init (cache elements, build generated SVG) → render(el, u) pure in u.

   SVG note: these shots draw on a plain <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">,
   not on svg.wire. svg.wire's CSS sets fill:none and stroke-width:4 on every <path>, and CSS beats SVG attributes,
   so a filled path or a stroke-width="10" there silently renders as a 4 px outline.
   SVG ids are global to the page: prefix them per shot (eg-, sa-, ga-…) so two shots never share a gradient by accident.
   To move or scale an SVG group, set its transform attribute (translate/scale/rotate around a known point);
   EX.pop / EX.place write CSS transforms, which on SVG scale around the page corner, so use them on HTML only. */

EX.chapter('egg', { name: '剖面 · 引线标注', color: EX.C.orange });
EX.chapter('salt', { name: '放大镜 · 插图', color: EX.C.cyan });
EX.chapter('gauge', { name: '仪表盘 · 数字卡', color: EX.C.blue });
EX.chapter('chart', { name: '曲线图 · 标注', color: EX.C.red });
EX.chapter('route', { name: '地图 · 航线', color: EX.C.purple });
EX.chapter('lamp', { name: '时间轴 · 里程碑', color: EX.C.pink });
EX.chapter('bars', { name: '对比条 · 排名', color: EX.C.green });

/* ------------------------------------------------------------------------------------------------------------ */
/* 1 · 剖面 + 引线标注 — draw the object in layers (soft shadow → base fill → inner layer → detail → highlight),
   never as one flat outline: the gradients and the white highlight are what make it read as a real egg cut open.
   Each callout is dot on the part + leader line drawn out + label card, one per caption beat, so the eye lands on
   the part at the moment it is named. A pulsing ring on every dot keeps the frame alive while captions are read. */
const EGG_PARTS = [   /* dot = the point on the part; line = dot → elbow → card edge; card = where the label sits */
  { at: 1.0, c: EX.C.indigo, dot: [1176, 432], line: 'M1176 432 L1280 330 L1360 330', card: 'left:1370px;top:282px', name: '蛋壳', note: '碳酸钙 · 约 0.3 mm' },
  { at: 1.9, c: EX.C.cyan, dot: [925, 278], line: 'M925 278 L820 250 L770 250', card: 'right:1160px;top:202px', name: '气室', note: '放得越久越大' },
  { at: 3.45, c: EX.C.blue, dot: [812, 650], line: 'M812 650 L700 720 L630 720', card: 'right:1300px;top:672px', name: '蛋白', note: '约 88% 是水' },
  { at: 3.6, c: EX.C.orange, dot: [1060, 640], line: 'M1060 640 L1250 720 L1360 720', card: 'left:1370px;top:672px', name: '蛋黄', note: '被系带吊在中央' },
];
EX.shot({
  id: 'egg', chapter: 'egg', dur: 8, meter: [0, 8],
  caps: [[0.3, '竖着切开，看鸡蛋的「剖面」。'], [3.6, '外层是壳，里面蛋白裹着蛋黄。']],
  sfx: [[0.1, 'reveal', .5], [1.0, 'pop', .4], [1.9, 'pop', .4], [3.45, 'pop', .4], [3.6, 'pop', .4]],
  html: `
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">
      <defs>
        <radialGradient id="eg-shadow"><stop offset="0" stop-color="#3C3264" stop-opacity=".3"/><stop offset="1" stop-color="#3C3264" stop-opacity="0"/></radialGradient>
        <linearGradient id="eg-shellg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF4E4"/><stop offset="1" stop-color="#DDB283"/></linearGradient>
        <radialGradient id="eg-whiteg" cx=".42" cy=".42" r=".65"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".7" stop-color="#F6F8FD"/><stop offset="1" stop-color="#E1E8F3"/></radialGradient>
        <radialGradient id="eg-yolkg" cx=".38" cy=".34" r=".72"><stop offset="0" stop-color="#FFE7A0"/><stop offset=".55" stop-color="#FDB733"/><stop offset="1" stop-color="#EC860C"/></radialGradient>
      </defs>
      <ellipse id="eg-shade" cx="975" cy="874" rx="240" ry="22" fill="url(#eg-shadow)"/>
      <g id="eg-body">
        <path id="eg-shell" fill="url(#eg-shellg)" stroke="#CFA36F" stroke-width="3"/>
        <path id="eg-white" fill="url(#eg-whiteg)" stroke="#E9DCC8" stroke-width="3"/>
        <path id="eg-air" fill="#E4EBF6" stroke="#C9D3E4" stroke-width="3"/>
        <path d="M960 448 q -16 -20 0 -40 q 16 -20 0 -40 q -16 -20 0 -40" fill="none" stroke="#E9DEC6" stroke-width="9" stroke-linecap="round"/>
        <path d="M960 732 q 16 20 0 40 q -16 20 0 40" fill="none" stroke="#E9DEC6" stroke-width="9" stroke-linecap="round"/>
        <g id="eg-yolk">
          <circle cx="960" cy="590" r="142" fill="url(#eg-yolkg)" stroke="#E08510" stroke-width="3"/>
          <ellipse cx="908" cy="536" rx="50" ry="26" fill="#fff" opacity=".55" transform="rotate(-32 908 536)"/>
          <circle cx="995" cy="470" r="11" fill="#FFF5D6"/>
        </g>
        <path id="eg-gloss" d="M790 410 Q 764 520 782 650" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
      </g>
      ${EGG_PARTS.map((p) => `
        <path class="eg-line" d="${p.line}" fill="none" stroke="${p.c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle class="eg-ring" cx="${p.dot[0]}" cy="${p.dot[1]}" r="9" fill="none" stroke="${p.c}" stroke-width="3"/>
        <circle class="eg-dot" cx="${p.dot[0]}" cy="${p.dot[1]}" r="0" fill="${p.c}" stroke="#fff" stroke-width="4"/>`).join('')}
    </svg>
    ${EGG_PARTS.map((p) => `
      <div class="abs card eg-card" style="${p.card};padding:14px 28px;border-radius:20px">
        <div style="font-size:34px;font-weight:900;line-height:1.2;color:${p.c}">${p.name}</div>
        <div class="t-label" style="white-space:nowrap">${p.note}</div>
      </div>`).join('')}`,
  init(el) {
    /* egg outline: an ellipse whose top half is a little wider (the blunt end). s scales it: 1 = shell, .94 = inside */
    const point = (a, s) => [960 + 230 * s * Math.sin(a) * (1 + .1 * Math.cos(a)), 545 - 320 * s * Math.cos(a)];
    const egg = (s) => [...Array(73)].map((_, i) => { const [x, y] = point(i / 72 * Math.PI * 2, s); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join('') + 'Z';
    el.querySelector('#eg-shell').setAttribute('d', egg(1));
    el.querySelector('#eg-white').setAttribute('d', egg(.94));
    /* air cell: the top cap of the inner outline, closed by a shallow curve */
    let air = '';
    for (let i = 0; i <= 24; i++) { const [x, y] = point(-.55 + i / 24 * 1.1, .94); air += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
    const [x0, y0] = point(-.55, .94);
    el.querySelector('#eg-air').setAttribute('d', air + `Q960 345 ${x0.toFixed(1)} ${y0.toFixed(1)}Z`);
    this.body = el.querySelector('#eg-body'); this.yolk = el.querySelector('#eg-yolk'); this.shade = el.querySelector('#eg-shade'); this.gloss = el.querySelector('#eg-gloss');
    this.lines = [...el.querySelectorAll('.eg-line')]; this.rings = [...el.querySelectorAll('.eg-ring')];
    this.dots = [...el.querySelectorAll('.eg-dot')]; this.cards = [...el.querySelectorAll('.eg-card')];
  },
  render(el, u) {
    /* skeleton: the whole cut egg lands in the first 0.6 s */
    const k = spring(u, 12, .6);
    this.body.setAttribute('transform', `translate(960 545) scale(${lerp(.86, 1, k).toFixed(4)}) translate(-960 -545)`);
    this.body.style.opacity = clamp(u / .25);
    this.shade.style.opacity = clamp(u / .25) * (.85 + .15 * Math.sin(u * 1.6));
    /* ambient: the yolk sways on its cords, the gloss breathes */
    this.yolk.setAttribute('transform', `translate(0 ${(5 * Math.sin(u * 1.8)).toFixed(2)})`);
    this.gloss.style.opacity = .6 + .3 * Math.sin(u * 1.3);
    EGG_PARTS.forEach((p, i) => {
      const lp = expoOut(prog(u, p.at + .1, p.at + .6));
      EX.drawPath(this.lines[i], lp);
      this.lines[i].style.opacity = lp > 0 ? 1 : 0;              /* a zero-length dash with round caps would show a dot */
      this.dots[i].setAttribute('r', (9 * spring(u - p.at, 16, .5)).toFixed(2));
      const f = u > p.at ? ((u - p.at) % 1.6) / 1.6 : 0;           /* ring pulses outward every 1.6 s once the dot is in */
      this.rings[i].setAttribute('r', (9 + 24 * f).toFixed(2));
      this.rings[i].style.opacity = u > p.at ? (1 - f) * .7 : 0;
      EX.pop(this.cards[i], u, p.at + .2, { s0: .8 });
    });
  },
});

/* ------------------------------------------------------------------------------------------------------------ */
/* 2 · 放大镜插图 — the everyday object at normal scale on the left, a big circular inset on the right, joined by
   the two outer tangent lines of the two circles (a light cone). The inset grows out of the small lens ring, so
   the viewer sees where it zooms from. Inside: the micro structure, plus a scale bar — without it "big" means nothing. */
EX.shot({
  id: 'salt', chapter: 'salt', dur: 8, meter: [8, 16],
  caps: [[0.3, '一勺盐，像一堆白色细粉。'], [3.6, '放大看，每粒都是「立方晶体」。']],
  sfx: [[0.1, 'pop', .4], [0.7, 'whoosh', .4], [1.8, 'tick', .4], [3.6, 'reveal', .5]],
  html: `
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">
      <defs>
        <radialGradient id="sa-shadow"><stop offset="0" stop-color="#3C3264" stop-opacity=".26"/><stop offset="1" stop-color="#3C3264" stop-opacity="0"/></radialGradient>
        <linearGradient id="sa-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FDFEFF"/><stop offset=".5" stop-color="#C8D0DF"/><stop offset="1" stop-color="#97A3BB"/></linearGradient>
        <radialGradient id="sa-bowl" cx=".6" cy=".35" r=".75"><stop offset="0" stop-color="#F4F6FB"/><stop offset="1" stop-color="#B5BFD2"/></radialGradient>
        <radialGradient id="sa-heap" cx=".45" cy=".3" r=".75"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D9DFEC"/></radialGradient>
        <radialGradient id="sa-lens" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#FAFDFF"/><stop offset="1" stop-color="#CFE5F4"/></radialGradient>
        <linearGradient id="sa-glintg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <clipPath id="sa-clip"><circle cx="1340" cy="515" r="290"/></clipPath>
      </defs>
      <g id="sa-spoon">
        <ellipse cx="520" cy="700" rx="250" ry="30" fill="url(#sa-shadow)"/>
        <path d="M372 598 Q 262 696 142 766" fill="none" stroke="#98A4BB" stroke-width="46" stroke-linecap="round"/>
        <path d="M372 598 Q 262 696 142 766" fill="none" stroke="url(#sa-metal)" stroke-width="32" stroke-linecap="round"/>
        <ellipse cx="520" cy="520" rx="215" ry="138" fill="url(#sa-metal)" stroke="#95A1B9" stroke-width="3" transform="rotate(-12 520 520)"/>
        <ellipse cx="520" cy="515" rx="192" ry="118" fill="url(#sa-bowl)" transform="rotate(-12 520 520)"/>
        <ellipse cx="525" cy="500" rx="160" ry="86" fill="url(#sa-heap)" stroke="#E0E5EF" stroke-width="2" transform="rotate(-12 520 520)"/>
        <g id="sa-grains"></g>
        <path d="M350 470 Q 400 405 500 392" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".85"/>
      </g>
      <polygon id="sa-cone" fill="#0EA5C6" opacity=".09"/>
      <path id="sa-t1" fill="none" stroke="#0EA5C6" stroke-width="3" opacity=".75"/>
      <path id="sa-t2" fill="none" stroke="#0EA5C6" stroke-width="3" opacity=".75"/>
      <circle id="sa-focus" cx="585" cy="470" r="46" fill="rgba(14,165,198,.10)" stroke="#0EA5C6" stroke-width="6"/>
      <g id="sa-inset">
        <circle cx="1340" cy="515" r="308" fill="#fff"/>
        <circle cx="1340" cy="515" r="290" fill="url(#sa-lens)"/>
        <g clip-path="url(#sa-clip)">
          <g id="sa-cubes"></g>
          <polygon id="sa-glint" fill="url(#sa-glintg)"/>
        </g>
        <circle cx="1340" cy="515" r="290" fill="none" stroke="#0EA5C6" stroke-width="8"/>
        <path id="sa-bar" d="M1292 774 h96 M1292 762 v24 M1388 762 v24" fill="none" stroke="#1E2240" stroke-width="4" stroke-linecap="round"/>
      </g>
    </svg>
    <div class="abs card" id="sa-count" style="left:150px;top:206px;padding:18px 32px">
      <div class="t-label" style="font-size:26px">一勺里大约有</div>
      <div style="display:flex;align-items:baseline;gap:10px"><span class="mono" id="sa-n" style="font-size:64px;font-weight:700;color:var(--cyan);line-height:1.1">0</span><span class="t-h3">万粒</span></div>
    </div>
    <div class="abs tag" id="sa-spoon-tag" style="--c:var(--ink2);left:400px;top:776px;white-space:nowrap">一茶匙盐 ≈ 6 g</div>
    <div class="abs tag" id="sa-badge" style="--c:var(--cyan);white-space:nowrap;box-shadow:0 8px 24px rgba(14,165,198,.25)">放大 ×100</div>
    <div class="abs mono" id="sa-scale" style="left:1240px;width:200px;top:718px;text-align:center;font-size:28px;font-weight:700">0.3 mm</div>
    <div class="abs tag" id="sa-ion" style="--c:var(--purple);left:1140px;width:400px;justify-content:center;top:846px;white-space:nowrap">钠、氯离子交替排成格子</div>`,
  init(el) {
    /* salt grains on the heap: positions made once from rng */
    const r = rng(11); let g = '';
    for (let i = 0; i < 90; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()), z = 7 + r() * 6;
      const x = 525 + Math.cos(a) * d * 140, y = 492 + Math.sin(a) * d * 66 - (1 - d) * 16;
      g += `<rect x="${(x - z / 2).toFixed(1)}" y="${(y - z / 2).toFixed(1)}" width="${z.toFixed(1)}" height="${z.toFixed(1)}" rx="2" fill="#fff" stroke="#BFC9DA" stroke-width="1.5" transform="rotate(${(r() * 90) | 0} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }
    el.querySelector('#sa-grains').innerHTML = g;
    /* isometric cube = a hexagon split into three faces around its centre */
    const pts = (q) => q.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const mix = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
    const CUBES = [[1250, 455, 95], [1440, 415, 70], [1420, 625, 85], [1220, 665, 55]];
    let html = '';
    CUBES.forEach(([cx, cy, s], i) => {
      const P = (dx, dy) => [cx + dx * s, cy + dy * s];
      const T = P(0, -1), UR = P(.866, -.5), DR = P(.866, .5), B = P(0, 1), DL = P(-.866, .5), UL = P(-.866, -.5), C = [cx, cy];
      const faces = [[UL, T, UR, C], [UL, C, B, DL], [C, UR, DR, B]];
      let lat = '', dots = '';
      faces.forEach((q) => {
        for (let k = 1; k < 4; k++) {           /* lattice: 3 lines each way on every face */
          const f = k / 4, a = mix(q[0], q[1], f), b = mix(q[3], q[2], f), c = mix(q[0], q[3], f), d = mix(q[1], q[2], f);
          lat += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}M${c[0].toFixed(1)} ${c[1].toFixed(1)}L${d[0].toFixed(1)} ${d[1].toFixed(1)}`;
        }
        if (i === 0) for (let m = 0; m <= 4; m++) for (let n = 0; n <= 4; n++) {   /* ions on the biggest cube */
          const p = mix(mix(q[0], q[1], m / 4), mix(q[3], q[2], m / 4), n / 4);
          dots += `<circle class="sa-ion" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="0" fill="${(m + n) % 2 ? '#7C4DFF' : '#14B27A'}"/>`;
        }
      });
      html += `<g class="sa-cube">
        <polygon points="${pts(faces[0])}" fill="#FFFFFF" stroke="#8FB0CC" stroke-width="2.5" stroke-linejoin="round"/>
        <polygon points="${pts(faces[1])}" fill="#E1ECF7" stroke="#8FB0CC" stroke-width="2.5" stroke-linejoin="round"/>
        <polygon points="${pts(faces[2])}" fill="#C6D9EC" stroke="#8FB0CC" stroke-width="2.5" stroke-linejoin="round"/>
        <path class="sa-lat" d="${lat}" fill="none" stroke="#9DBAD3" stroke-width="1.6"/>${dots}</g>`;
    });
    el.querySelector('#sa-cubes').innerHTML = html;
    this.q = {};
    for (const id of ['sa-spoon', 'sa-cone', 'sa-t1', 'sa-t2', 'sa-focus', 'sa-inset', 'sa-glint', 'sa-bar', 'sa-count', 'sa-n', 'sa-spoon-tag', 'sa-badge', 'sa-scale', 'sa-ion']) this.q[id] = el.querySelector('#' + id);
    this.cubes = [...el.querySelectorAll('.sa-cube')]; this.lat = [...el.querySelectorAll('.sa-lat')]; this.ions = [...el.querySelectorAll('.sa-ion')];
  },
  render(el, u) {
    const q = this.q;
    const k = spring(u, 12, .6);
    q['sa-spoon'].setAttribute('transform', `translate(520 520) scale(${lerp(.88, 1, k).toFixed(4)}) translate(-520 -520)`);
    q['sa-spoon'].style.opacity = clamp(u / .25);
    EX.fadeUp(q['sa-spoon-tag'], u, .4);
    /* the lens ring lands on the heap, then the inset grows out of it: centre and radius both travel */
    const fr = 46 * spring(u - .4, 16, .5);
    q['sa-focus'].setAttribute('r', fr.toFixed(2));
    q['sa-focus'].setAttribute('stroke-width', (6 + 2 * pulse(u, 1.4)).toFixed(2));   /* ambient: the lens ring throbs */
    const g = expoOut(prog(u, .7, 1.5));
    const cx = lerp(585, 1340, g), cy = lerp(470, 515, g), R = lerp(46, 290, g);
    q['sa-inset'].setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${(R / 290).toFixed(4)}) translate(-1340 -515)`);
    q['sa-inset'].style.opacity = clamp((u - .7) / .12);
    /* the two outer tangents of the lens ring (585,470,46) and the inset (cx,cy,R) */
    const d = Math.hypot(cx - 585, cy - 470);
    if (g > .02) {
      const base = Math.atan2(cy - 470, cx - 585), off = Math.acos((46 - R) / d);
      const ends = [base + off, base - off].map((th) => [585 + 46 * Math.cos(th), 470 + 46 * Math.sin(th), cx + R * Math.cos(th), cy + R * Math.sin(th)]);
      const [a, b] = ends;
      q['sa-t1'].setAttribute('d', `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${a[2].toFixed(1)} ${a[3].toFixed(1)}`);
      q['sa-t2'].setAttribute('d', `M${b[0].toFixed(1)} ${b[1].toFixed(1)}L${b[2].toFixed(1)} ${b[3].toFixed(1)}`);
      q['sa-cone'].setAttribute('points', `${a[0]},${a[1]} ${a[2]},${a[3]} ${b[2]},${b[3]} ${b[0]},${b[1]}`);
    }
    for (const id of ['sa-t1', 'sa-t2', 'sa-cone']) q[id].style.visibility = g > .02 ? '' : 'hidden';
    EX.place(q['sa-badge'], 1552, 303, lerp(.6, 1, spring(u - 1.4, 16, .5)), clamp((u - 1.4) / .15));
    /* ambient: grains (cubes) float, a glint sweeps across the lens every 3 s */
    this.cubes.forEach((c, i) => c.setAttribute('transform', `translate(0 ${(6 * Math.sin(u * .9 + i * 1.7)).toFixed(2)})`));
    const X = 1050 + ((u * 220) % 660);
    q['sa-glint'].setAttribute('points', `${X},225 ${X + 60},225 ${X - 80},805 ${X - 140},805`);
    /* beat 1: the count and the scale bar; beat 2 (3.6 s): lattice lines draw in, ions pop */
    EX.pop(q['sa-count'], u, 1.8, { s0: .85 });
    EX.num(q['sa-n'], 10, expoOut(prog(u, 1.9, 3.0)));
    q['sa-bar'].style.opacity = clamp((u - 2.3) / .3);
    EX.fadeUp(q['sa-scale'], u, 2.3);
    this.lat.forEach((p, i) => EX.drawPath(p, cubic(prog(u, 3.6 + i * .1, 4.4 + i * .1))));
    this.ions.forEach((c, i) => c.setAttribute('r', (6 * spring(u - 3.7 - i * .008, 18, .5)).toFixed(2)));
    EX.fadeUp(q['sa-ion'], u, 3.9);
  },
});

/* ------------------------------------------------------------------------------------------------------------ */
/* 3 · 仪表盘 + 数字卡 — a physical-looking dial (shadowed face, coloured zones, ticks) whose needle swings past the
   value on a lively spring and settles: the overshoot is what makes it feel measured, not placed. The stat cards are
   live conversions of the same value, so they count up while the needle swings and can never disagree with it. */
EX.shot({
  id: 'gauge', chapter: 'gauge', dur: 8, meter: [16, 24],
  caps: [[0.3, '量出「胎压」：2.5 bar。'], [3.6, '同一个气压，换两种单位来读。']],
  sfx: [[0.1, 'pop', .4], [0.9, 'whoosh', .35], [2.4, 'tick', .4], [3.6, 'chime', .45]],
  html: `
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">
      <defs>
        <filter id="ga-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>
        <radialGradient id="ga-faceg" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#ECEFF7"/></radialGradient>
      </defs>
      <g id="ga-dial">
        <circle cx="652" cy="580" r="334" fill="rgba(60,70,150,.22)" filter="url(#ga-blur)"/>
        <circle cx="640" cy="560" r="338" fill="url(#ga-faceg)" stroke="#fff" stroke-width="4"/>
        <circle cx="640" cy="560" r="322" fill="none" stroke="rgba(60,70,150,.07)" stroke-width="10"/>
        <path id="ga-track" fill="none" stroke="#E7EAF4" stroke-width="46"/>
        <path id="ga-glow" fill="none" stroke="#14B27A" stroke-width="70"/>
        <g id="ga-zones"></g>
        <g id="ga-ticks"></g>
        <g id="ga-needle">
          <polygon points="606,566 646,554 884,566 646,578" fill="rgba(30,34,64,.16)"/>
          <polygon points="600,560 640,548 878,560 640,572" fill="#1E2240"/>
        </g>
        <circle cx="640" cy="560" r="30" fill="#1E2240"/><circle cx="640" cy="560" r="12" fill="#fff"/>
      </g>
      <path id="ga-link1" d="M984 520 C 1030 520, 1040 380, 1086 380" fill="none" stroke="#3B6CF6" stroke-width="4" stroke-dasharray="3 14" stroke-linecap="round"/>
      <path id="ga-link2" d="M984 600 C 1030 600, 1040 640, 1086 640" fill="none" stroke="#7C4DFF" stroke-width="4" stroke-dasharray="3 14" stroke-linecap="round"/>
    </svg>
    <div class="abs" id="ga-read" style="left:440px;width:400px;top:628px;text-align:center;white-space:nowrap">
      <span class="mono" id="ga-v" style="font-size:88px;font-weight:700">0.0</span><span style="font-size:36px;font-weight:700;color:var(--ink2);margin-left:12px">bar</span></div>
    <div class="abs tag" id="ga-tag" style="--c:var(--green);left:440px;width:400px;justify-content:center;top:770px;white-space:nowrap">轿车常见推荐值</div>
    <div class="abs card" id="ga-c1" style="left:1090px;top:270px;width:580px;height:220px;padding:36px 46px;border-left:12px solid var(--blue)">
      <div class="t-label" style="font-size:28px">国际单位 · 千帕</div>
      <div style="display:flex;align-items:baseline;gap:16px;margin-top:8px"><span class="mono" id="ga-n1" style="font-size:100px;font-weight:700;line-height:1;color:var(--blue)">0</span><span class="t-h3" style="color:var(--ink2)">kPa</span></div>
    </div>
    <div class="abs card" id="ga-c2" style="left:1090px;top:530px;width:580px;height:220px;padding:36px 46px;border-left:12px solid var(--purple)">
      <div class="t-label" style="font-size:28px">英制 · 磅每平方英寸</div>
      <div style="display:flex;align-items:baseline;gap:16px;margin-top:8px"><span class="mono" id="ga-n2" style="font-size:100px;font-weight:700;line-height:1;color:var(--purple)">0</span><span class="t-h3" style="color:var(--ink2)">psi</span></div>
    </div>`,
  init(el) {
    /* value v (0–4 bar) → angle: 210° at 0, −30° at 4 (a 240° sweep, maths angles, y up) */
    const ang = (v) => (210 - v / 4 * 240) * Math.PI / 180;
    const pt = (v, r) => [640 + r * Math.cos(ang(v)), 560 - r * Math.sin(ang(v))];
    const arc = (v0, v1, r) => { const a = pt(v0, r), b = pt(v1, r); return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}A${r} ${r} 0 ${(v1 - v0) * 60 > 180 ? 1 : 0} 1 ${b[0].toFixed(1)} ${b[1].toFixed(1)}`; };
    el.querySelector('#ga-track').setAttribute('d', arc(0, 4, 262));
    el.querySelector('#ga-glow').setAttribute('d', arc(2.2, 2.8, 262));
    const ZONES = [[0, 1.8, '#EF4444'], [1.8, 2.2, '#F59E0B'], [2.2, 2.8, '#14B27A'], [2.8, 3.2, '#F59E0B'], [3.2, 4, '#EF4444']];
    el.querySelector('#ga-zones').innerHTML = ZONES.map(([a, b, c]) => `<path d="${arc(a + .02, b - .02, 262)}" fill="none" stroke="${c}" stroke-width="34"/>`).join('')
      + [[.9, '偏低', '#EF4444'], [2.5, '正常', '#14B27A'], [3.6, '偏高', '#EF4444']].map(([v, t, c]) => { const p = pt(v, 314); return `<text x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" fill="${c}" font-size="24" font-weight="700" text-anchor="middle" dominant-baseline="middle">${t}</text>`; }).join('');
    let ticks = '';
    for (let i = 0; i <= 16; i++) {
      const v = i / 4, major = i % 4 === 0, a = pt(v, major ? 208 : 220), b = pt(v, 236);
      ticks += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${major ? '#1E2240' : '#9095B0'}" stroke-width="${major ? 5 : 3}" stroke-linecap="round"/>`;
      if (major) { const p = pt(v, 178); ticks += `<text x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" fill="#5D6385" font-size="32" font-weight="700" text-anchor="middle" dominant-baseline="middle" font-family="JetBrains Mono, monospace">${v}</text>`; }
    }
    el.querySelector('#ga-ticks').innerHTML = ticks;
    this.q = {};
    for (const id of ['ga-dial', 'ga-glow', 'ga-needle', 'ga-link1', 'ga-link2', 'ga-read', 'ga-v', 'ga-tag', 'ga-c1', 'ga-c2', 'ga-n1', 'ga-n2']) this.q[id] = el.querySelector('#' + id);
  },
  render(el, u) {
    const q = this.q;
    const k = spring(u, 12, .6);
    q['ga-dial'].setAttribute('transform', `translate(640 560) scale(${lerp(.86, 1, k).toFixed(4)}) translate(-640 -560)`);
    q['ga-dial'].style.opacity = clamp(u / .25);
    /* the needle: a soft spring overshoots to ~3.4 bar and settles on 2.5; afterwards a faint tremor (ambient) */
    const v = Math.max(0, springTrack(u, [[0, 0], [.9, 2.5]], 6, .3));
    const shake = .02 * Math.sin(u * 7.3) * Math.sin(u * 2.1) * clamp(u - 2.6);
    q['ga-needle'].setAttribute('transform', `rotate(${(-(210 - (v + shake) / 4 * 240)).toFixed(2)} 640 560)`);
    q['ga-v'].textContent = v.toFixed(1);
    q['ga-v'].style.color = v > 2.2 && v < 2.8 ? 'var(--green)' : v > 1.8 && v < 3.2 ? 'var(--orange)' : 'var(--red)';
    q['ga-glow'].style.opacity = .1 + .22 * (.5 + .5 * Math.sin(u * 3));          /* the green zone breathes */
    EX.fadeUp(q['ga-read'], u, .3);
    EX.fadeUp(q['ga-tag'], u, 2.4);
    /* stat cards: on screen from the start, counting with the needle (EX.num clamps, so overshoot stops at the value) */
    EX.pop(q['ga-c1'], u, .3, { s0: .9 }); EX.pop(q['ga-c2'], u, .45, { s0: .9 });
    EX.num(q['ga-n1'], 250, v / 2.5);
    EX.num(q['ga-n2'], 36, v / 2.5);
    /* beat 2: dotted links from the readout to both cards, the cards light up */
    for (const id of ['ga-link1', 'ga-link2']) { q[id].style.opacity = cubic(prog(u, 3.6, 4.0)); dashFlow(q[id], u, 40); }
    const h = cubic(prog(u, 3.6, 4.0)) * (.75 + .25 * Math.sin(u * 3));
    q['ga-c1'].style.boxShadow = `0 0 0 3px rgba(59,108,246,${h.toFixed(3)}),0 24px 70px rgba(60,70,150,.13)`;
    q['ga-c2'].style.boxShadow = `0 0 0 3px rgba(124,77,255,${h.toFixed(3)}),0 24px 70px rgba(60,70,150,.13)`;
  },
});

/* ------------------------------------------------------------------------------------------------------------ */
/* 4 · 曲线图 + 标注 — axes and gridlines first (the frame of reference), then the curve draws in left → right with
   its area filling behind it. A dot rides the curve with a live readout, so the chart is read in time like a clock.
   Only the one point that matters gets a callout (the peak), plus one reference line that explains it (noon). */
EX.shot({
  id: 'chart', chapter: 'chart', dur: 8, meter: [24, 32],
  caps: [[0.3, '凌晨最冷，午后最热。'], [3.6, '最热在 14 时而非正午：「热滞后」。']],
  sfx: [[0.3, 'whoosh', .35], [2.6, 'pop', .4], [3.6, 'pop', .45], [3.9, 'chime', .4]],
  html: `
    <div class="abs card" id="ch-card" style="left:200px;top:196px;width:1540px;height:694px"></div>
    <div class="abs tag" id="ch-title" style="--c:var(--red);left:250px;top:222px;white-space:nowrap">某地夏日气温 · 示意</div>
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">
      <defs>
        <linearGradient id="ch-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EF4444" stop-opacity=".28"/><stop offset="1" stop-color="#F59E0B" stop-opacity=".04"/></linearGradient>
        <clipPath id="ch-clip"><rect id="ch-cliprect" x="340" y="280" width="0" height="545"/></clipPath>
      </defs>
      <g id="ch-grid"></g>
      <path id="ch-fill" fill="url(#ch-area)" clip-path="url(#ch-clip)"/>
      <path id="ch-glow" fill="none" stroke="#EF4444" stroke-width="18" stroke-linecap="round" opacity=".15"/>
      <path id="ch-line" fill="none" stroke="#EF4444" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <path id="ch-noon" d="M970 330 L970 700" fill="none" stroke="#5D6385" stroke-width="3" stroke-dasharray="10 10"/>
      <path id="ch-lag" d="M972 472 L1062 472 M1050 462 L1064 472 L1050 482" fill="none" stroke="#5D6385" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path id="ch-peakline" d="M1075 378 L1160 300 L1210 300" fill="none" stroke="#EF4444" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <path id="ch-lowline" d="M602 716 L660 760 L700 760" fill="none" stroke="#3B6CF6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle id="ch-peakring" cx="1075" cy="378" r="12" fill="none" stroke="#EF4444" stroke-width="3"/>
      <circle id="ch-halo" r="22" fill="#EF4444" opacity=".18"/>
      <circle id="ch-dot" r="12" fill="#fff" stroke="#EF4444" stroke-width="6"/>
    </svg>
    <div class="abs pill center" id="ch-noonlab" style="left:900px;width:140px;top:282px;gap:8px;padding:4px 0;font-size:24px;font-weight:700;color:var(--ink2)"><span style="width:28px;height:28px;display:flex;color:var(--orange)">${ICON.sun}</span>正午</div>
    <div class="abs t-label" id="ch-laglab" style="left:1084px;top:452px;white-space:nowrap;font-weight:700">晚约 2 小时</div>
    <div class="abs card" id="ch-peak" style="left:1220px;top:264px;padding:10px 26px;border-radius:18px;font-size:30px;font-weight:900;white-space:nowrap;color:var(--red)">14:00 最高 27 ℃</div>
    <div class="abs card" id="ch-low" style="left:710px;top:732px;padding:8px 24px;border-radius:18px;font-size:28px;font-weight:900;white-space:nowrap;color:var(--blue)">5:00 最低 14 ℃</div>
    <div class="abs pill mono" id="ch-pill" style="padding:8px 20px;font-size:26px;font-weight:700;white-space:nowrap;box-shadow:0 0 0 3px #EF4444,0 10px 30px rgba(60,70,150,.12)"></div>
    <div id="ch-labels"></div>`,
  init(el) {
    /* plot box: 0–24 h → x 340–1600, 10–30 ℃ → y 820–300 */
    const X = (h) => 340 + h * 52.5, Y = (T) => 820 - (T - 10) * 26;
    /* a typical clear summer day: lowest just before sunrise (5:00), highest at 14:00, smooth half-cosines between */
    const temp = (h) => {
      if (h >= 5 && h <= 14) return 14 + 13 * (1 - Math.cos(Math.PI * (h - 5) / 9)) / 2;
      const s = ((h - 14 + 24) % 24) / 15;
      return 27 - 13 * (1 - Math.cos(Math.PI * s)) / 2;
    };
    this.X = X; this.Y = Y; this.temp = temp;
    let d = '';
    for (let i = 0; i <= 96; i++) { const h = i / 4; d += (i ? 'L' : 'M') + X(h).toFixed(1) + ' ' + Y(temp(h)).toFixed(1); }
    for (const id of ['#ch-line', '#ch-glow']) el.querySelector(id).setAttribute('d', d);
    el.querySelector('#ch-fill').setAttribute('d', d + 'L1600 820L340 820Z');
    let grid = '', labels = '';
    for (let T = 10; T <= 30; T += 5) {
      grid += `<line x1="340" y1="${Y(T)}" x2="1600" y2="${Y(T)}" stroke="${T === 10 ? '#1E2240' : '#E2E5F2'}" stroke-width="${T === 10 ? 3 : 2}"/>`;
      labels += `<div class="abs t-label" style="right:${1920 - 318}px;top:${Y(T) - 17}px;white-space:nowrap">${T}℃</div>`;
    }
    for (let h = 0; h <= 24; h += 4) {
      grid += `<line x1="${X(h)}" y1="820" x2="${X(h)}" y2="832" stroke="#1E2240" stroke-width="3"/>`;
      labels += `<div class="abs t-label" style="left:${X(h) - 60}px;width:120px;top:840px;text-align:center;white-space:nowrap">${h} 时</div>`;
    }
    el.querySelector('#ch-grid').innerHTML = grid;
    el.querySelector('#ch-labels').innerHTML = labels;
    this.q = {};
    for (const id of ['ch-card', 'ch-title', 'ch-grid', 'ch-labels', 'ch-cliprect', 'ch-line', 'ch-glow', 'ch-noon', 'ch-lag', 'ch-peakline', 'ch-lowline', 'ch-peakring', 'ch-halo', 'ch-dot',
      'ch-noonlab', 'ch-laglab', 'ch-peak', 'ch-low', 'ch-pill']) this.q[id] = el.querySelector('#' + id);
  },
  render(el, u) {
    const q = this.q;
    /* skeleton: card, axes, gridlines and labels by 0.6 s */
    EX.pop(q['ch-card'], u, 0, { s0: .96 });
    for (const id of ['ch-grid', 'ch-labels']) q[id].style.opacity = clamp((u - .15) / .4);
    EX.fadeUp(q['ch-title'], u, .2);
    /* the curve draws in, its area revealed by a clip rect that follows the pen */
    const p = cubic(prog(u, .3, 1.5));
    EX.drawPath(q['ch-line'], p); EX.drawPath(q['ch-glow'], p);
    q['ch-cliprect'].setAttribute('width', (1260 * p).toFixed(1));
    /* a dot rides the curve from 0 h to 24 h (ambient + a clock for the eye) */
    const h = 24 * prog(u, 1.4, 7.6), x = this.X(h), y = this.Y(this.temp(h));
    const on = clamp((u - 1.4) / .2);
    for (const id of ['ch-dot', 'ch-halo']) { q[id].setAttribute('cx', x.toFixed(1)); q[id].setAttribute('cy', y.toFixed(1)); q[id].style.opacity = on * (id === 'ch-halo' ? .18 : 1); }
    q['ch-halo'].setAttribute('r', (18 + 10 * pulse(u, 1)).toFixed(2));
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60 / 10) * 10;
    q['ch-pill'].textContent = `${String(Math.min(hh, 24)).padStart(2, '0')}:${String(hh >= 24 ? 0 : mm).padStart(2, '0')}  ${this.temp(h).toFixed(1)} ℃`;
    EX.place(q['ch-pill'], Math.max(x, 470), y - 64, 1, clamp((h - 1.2) / .8));
    /* beat 1: the low point; beat 2: noon line, lag arrow, peak callout */
    EX.drawPath(q['ch-lowline'], expoOut(prog(u, 2.6, 3.0))); q['ch-lowline'].style.opacity = u > 2.6 ? 1 : 0;
    EX.pop(q['ch-low'], u, 2.8, { s0: .8 });
    q['ch-noon'].style.opacity = cubic(prog(u, 3.6, 3.9)); dashFlow(q['ch-noon'], u, 24);
    EX.fadeUp(q['ch-noonlab'], u, 3.6);
    EX.drawPath(q['ch-lag'], expoOut(prog(u, 3.8, 4.2))); q['ch-lag'].style.opacity = u > 3.8 ? 1 : 0;
    EX.fadeUp(q['ch-laglab'], u, 3.9);
    EX.drawPath(q['ch-peakline'], expoOut(prog(u, 3.6, 4.0))); q['ch-peakline'].style.opacity = u > 3.6 ? 1 : 0;
    EX.pop(q['ch-peak'], u, 3.75, { s0: .8 });
    const f = u > 3.6 ? ((u - 3.6) % 1.4) / 1.4 : 0;
    q['ch-peakring'].setAttribute('r', (12 + 26 * f).toFixed(2)); q['ch-peakring'].style.opacity = u > 3.6 ? 1 - f : 0;
  },
});

/* ------------------------------------------------------------------------------------------------------------ */
/* 5 · 地图航线 — a globe that reads as a sphere: ocean radial gradient, projected continents and graticule, a darker
   limb, a specular highlight and an atmosphere ring. Real lat/lon go through one orthographic projection, so cities
   land where a viewer expects them. The route is lifted above the surface as a screen-space arc (from this view a
   true great circle would look almost flat); the plane rides it, nose along the tangent, and the distance counts with it. */
EX.shot({
  id: 'route', chapter: 'route', dur: 8, meter: [32, 40],
  caps: [[0.3, '从上海飞到洛杉矶。'], [3.6, '走「大圆航线」，全程约一万公里。']],
  sfx: [[0.1, 'reveal', .5], [1.2, 'whoosh', .4], [3.6, 'pop', .4], [6.6, 'chime', .5]],
  html: `
    <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080">
      <defs>
        <radialGradient id="ro-sea" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#E4F3FF"/><stop offset=".6" stop-color="#A9D2F7"/><stop offset="1" stop-color="#6FA6E8"/></radialGradient>
        <radialGradient id="ro-limb" cx=".5" cy=".5" r=".5"><stop offset=".72" stop-color="#1B2A6B" stop-opacity="0"/><stop offset="1" stop-color="#1B2A6B" stop-opacity=".22"/></radialGradient>
        <radialGradient id="ro-shadow"><stop offset="0" stop-color="#3C3264" stop-opacity=".26"/><stop offset="1" stop-color="#3C3264" stop-opacity="0"/></radialGradient>
        <clipPath id="ro-clip"><circle cx="820" cy="590" r="300"/></clipPath>
      </defs>
      <g id="ro-globe">
        <ellipse cx="830" cy="884" rx="230" ry="16" fill="url(#ro-shadow)"/>
        <circle id="ro-atmo" cx="820" cy="590" r="314" fill="none" stroke="#9CC3FF" stroke-width="20"/>
        <circle cx="820" cy="590" r="300" fill="url(#ro-sea)"/>
        <g clip-path="url(#ro-clip)">
          <path id="ro-grat" fill="none" stroke="#fff" stroke-width="2" opacity=".55"/>
          <g id="ro-land"></g>
        </g>
        <circle cx="820" cy="590" r="300" fill="url(#ro-limb)"/>
        <ellipse cx="715" cy="440" rx="120" ry="64" fill="#fff" opacity=".32" transform="rotate(-35 715 440)"/>
      </g>
      <path id="ro-base" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="2 16" stroke-linecap="round"/>
      <path id="ro-glow" fill="none" stroke="#7C4DFF" stroke-width="18" stroke-linecap="round" opacity=".18"/>
      <path id="ro-done" fill="none" stroke="#7C4DFF" stroke-width="6" stroke-linecap="round"/>
      <circle id="ro-ring-a" r="10" fill="none" stroke="#E6458B" stroke-width="3"/>
      <circle id="ro-ring-b" r="10" fill="none" stroke="#7C4DFF" stroke-width="3"/>
      <circle id="ro-dot-a" r="11" fill="#E6458B" stroke="#fff" stroke-width="4"/>
      <circle id="ro-dot-b" r="11" fill="#7C4DFF" stroke="#fff" stroke-width="4"/>
      <g id="ro-plane">
        <path d="M34 0 C34 -5 27 -6 21 -6 L7 -6 L-6 -30 L-15 -30 L-8 -6 L-22 -6 L-29 -16 L-35 -16 L-31 0 L-35 16 L-29 16 L-22 6 L-8 6 L-15 30 L-6 30 L7 6 L21 6 C27 6 34 5 34 0 Z"
          fill="#fff" stroke="#7C4DFF" stroke-width="3.5" stroke-linejoin="round"/>
      </g>
    </svg>
    <div class="abs tag" id="ro-tag-a" style="--c:var(--pink);white-space:nowrap">上海</div>
    <div class="abs tag" id="ro-tag-b" style="--c:var(--purple);white-space:nowrap">洛杉矶</div>
    <div class="abs pill" id="ro-gc" style="padding:8px 24px;font-size:26px;font-weight:700;color:var(--purple);white-space:nowrap">大圆航线 · 球面最短</div>
    <div class="abs card" id="ro-c1" style="left:1250px;top:330px;width:440px;padding:30px 40px">
      <div class="t-label" style="font-size:28px">飞行距离</div>
      <div style="display:flex;align-items:baseline;gap:12px"><span class="mono" id="ro-km" style="font-size:72px;font-weight:700;color:var(--purple);line-height:1.15">0</span><span class="t-h3" style="color:var(--ink2)">km</span></div>
    </div>
    <div class="abs card" id="ro-c2" style="left:1250px;top:570px;width:440px;padding:30px 40px">
      <div class="t-label" style="font-size:28px">飞行时间</div>
      <div style="display:flex;align-items:baseline;gap:12px"><span class="t-h3" style="color:var(--ink2)">约</span><span class="mono" id="ro-hr" style="font-size:72px;font-weight:700;color:var(--pink);line-height:1.15">0</span><span class="t-h3" style="color:var(--ink2)">小时</span></div>
    </div>`,
  init(el) {
    /* orthographic projection, view centred over the North Pacific (30°N, 181.6°E), globe at (820, 590) r 300.
       z < 0 means the far side: lines skip it, land polygons are pushed onto the rim. */
    const D = Math.PI / 180, lat0 = 30 * D, lon0 = 181.6 * D;
    const proj = (lat, lon) => {
      const f = lat * D, l = lon * D - lon0;
      const x = Math.cos(f) * Math.sin(l), y = Math.cos(lat0) * Math.sin(f) - Math.sin(lat0) * Math.cos(f) * Math.cos(l);
      const z = Math.sin(lat0) * Math.sin(f) + Math.cos(lat0) * Math.cos(f) * Math.cos(l);
      const k = z < 0 ? 1 / Math.hypot(x, y) : 1;
      return [820 + 300 * x * k, 590 - 300 * y * k, z];
    };
    let grat = '';
    const line = (pts) => { let pen = false; for (const [la, lo] of pts) { const [x, y, z] = proj(la, lo); if (z > 0) { grat += (pen ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); pen = true; } else pen = false; } };
    for (let la = -30; la <= 60; la += 30) line([...Array(73)].map((_, i) => [la, i * 5]));
    for (let lo = 0; lo < 360; lo += 30) line([...Array(37)].map((_, i) => [-90 + i * 5, lo]));
    el.querySelector('#ro-grat').setAttribute('d', grat);
    /* continents as crude lat/lon blobs (east longitudes 0–360): enough to read "Asia · Pacific · America" */
    const LAND = [
      [[77, 105], [76, 140], [72, 160], [69, 180], [66, 190], [64, 183], [60, 170], [57, 163], [51, 157], [55, 155], [59, 150], [59, 143], [54, 137], [47, 139], [43, 132], [39, 128], [35, 129], [37, 126], [40, 122], [37, 119], [35, 120], [31, 122], [27, 120], [23, 117], [21, 110], [18, 106], [11, 109], [9, 105], [1, 104], [7, 100], [16, 97], [22, 91], [20, 86], [15, 80], [8, 77], [21, 72], [25, 60], [45, 60], [70, 70], [74, 85]],
      [[45, 142], [43, 145], [41, 141], [38, 141.5], [35, 140], [34, 136], [33, 131], [34, 130], [35, 133], [36, 136], [38, 139], [41, 140]],
      [[18, 121], [14, 124], [10, 126], [7, 126], [9, 123], [12, 121], [14, 120]],
      [[7, 117], [1, 119], [-3, 116], [-1, 110], [2, 109]],
      [[-1, 131], [-3, 141], [-9, 147], [-10, 150], [-8, 143], [-5, 137]],
      [[-11, 131], [-12, 136], [-11, 142], [-17, 146], [-25, 153], [-33, 152], [-38, 147], [-38, 141], [-35, 136], [-32, 133], [-34, 123], [-34, 115], [-26, 113], [-21, 115], [-15, 125]],
      [[-35, 173], [-41, 176], [-46, 170], [-44, 168], [-40, 173]],
      [[71, 203], [70, 218], [69, 232], [70, 250], [73, 265], [70, 280], [60, 285], [52, 280], [44, 294], [35, 284], [25, 280], [29, 265], [21, 263], [16, 265], [20, 255], [23, 250], [31, 245], [34, 241], [38, 237], [43, 236], [48, 235], [54, 229], [58, 222], [60, 214], [59, 205], [57, 202], [60, 195], [64, 194], [66, 197], [69, 195]],
    ];
    el.querySelector('#ro-land').innerHTML = LAND.map((poly) => `<path d="${poly.map(([la, lo], i) => { const [x, y] = proj(la, lo); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join('')}Z" fill="#C9EBC6" stroke="#93CFA0" stroke-width="2" stroke-linejoin="round"/>`).join('');
    /* cities: Shanghai 31.2°N 121.5°E, Los Angeles 34.1°N 118.2°W; the route is a lifted quadratic arc between them */
    this.A = proj(31.2, 121.5); this.B = proj(34.05, 241.75);
    const route = `M${this.A[0].toFixed(1)} ${this.A[1].toFixed(1)}Q${((this.A[0] + this.B[0]) / 2).toFixed(1)} 170 ${this.B[0].toFixed(1)} ${this.B[1].toFixed(1)}`;
    this.q = {};
    for (const id of ['ro-globe', 'ro-atmo', 'ro-base', 'ro-glow', 'ro-done', 'ro-ring-a', 'ro-ring-b', 'ro-dot-a', 'ro-dot-b', 'ro-plane', 'ro-tag-a', 'ro-tag-b', 'ro-gc', 'ro-c1', 'ro-c2', 'ro-km', 'ro-hr']) this.q[id] = el.querySelector('#' + id);
    for (const id of ['ro-base', 'ro-glow', 'ro-done']) this.q[id].setAttribute('d', route);
    [['ro-ring-a', this.A], ['ro-dot-a', this.A], ['ro-ring-b', this.B], ['ro-dot-b', this.B]].forEach(([id, P]) => { this.q[id].setAttribute('cx', P[0].toFixed(1)); this.q[id].setAttribute('cy', P[1].toFixed(1)); });
  },
  render(el, u) {
    const q = this.q, A = this.A, B = this.B;
    /* skeleton: globe, cities and the dotted route by 1 s */
    const k = spring(u, 12, .6);
    q['ro-globe'].setAttribute('transform', `translate(820 590) scale(${lerp(.86, 1, k).toFixed(4)}) translate(-820 -590)`);
    q['ro-globe'].style.opacity = clamp(u / .25);
    q['ro-atmo'].style.opacity = .35 + .25 * Math.sin(u * 1.5);                 /* ambient: the atmosphere breathes */
    q['ro-base'].style.opacity = clamp((u - .5) / .4); dashFlow(q['ro-base'], u, 30);
    q['ro-dot-a'].setAttribute('r', (11 * spring(u - .4, 16, .5)).toFixed(2));
    q['ro-dot-b'].setAttribute('r', (11 * spring(u - .55, 16, .5)).toFixed(2));
    EX.place(q['ro-tag-a'], A[0], A[1] + 46, lerp(.7, 1, spring(u - .5, 16, .5)), clamp((u - .5) / .15));
    EX.place(q['ro-tag-b'], B[0], B[1] + 46, lerp(.7, 1, spring(u - .65, 16, .5)), clamp((u - .65) / .15));
    [['ro-ring-a', .4], ['ro-ring-b', 6.6]].forEach(([id, a]) => {              /* departure rings now, arrival rings on landing */
      const f = u > a ? ((u - a) % 1.5) / 1.5 : 0;
      q[id].setAttribute('r', (11 + 26 * f).toFixed(2)); q[id].style.opacity = u > a ? 1 - f : 0;
    });
    /* the flight: plane rides the arc, nose along the tangent; the done part of the route and the counters follow it */
    const p = cubic(prog(u, 1.2, 6.6));
    EX.drawPath(q['ro-done'], p); EX.drawPath(q['ro-glow'], p);
    q['ro-done'].style.opacity = q['ro-glow'].style.opacity = p > 0 ? '' : 0;
    const L = q['ro-base'].getTotalLength(), s = L * p, a = q['ro-base'].getPointAtLength(Math.max(0, s - 1)), b = q['ro-base'].getPointAtLength(Math.min(L, s + 1));
    const deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    q['ro-plane'].setAttribute('transform', `translate(${((a.x + b.x) / 2).toFixed(1)} ${((a.y + b.y) / 2).toFixed(1)}) rotate(${deg.toFixed(1)}) scale(${(.9 + .15 * Math.sin(Math.PI * p)).toFixed(3)})`);
    q['ro-plane'].style.opacity = clamp((u - 1.0) / .2);
    EX.pop(q['ro-c1'], u, .7, { s0: .9 }); EX.pop(q['ro-c2'], u, .85, { s0: .9 });
    EX.num(q['ro-km'], 10500, p);
    EX.num(q['ro-hr'], 11, p);
    EX.place(q['ro-gc'], (A[0] + B[0]) / 2, 524, lerp(.7, 1, spring(u - 3.6, 16, .5)), clamp((u - 3.6) / .15));
  },
});

/* ------------------------------------------------------------------------------------------------------------ */
/* 6 · 时间轴里程碑 — the axis, every year and a placeholder dot are on screen within 1 s (the viewer sees the whole
   span up front); then a progress fill runs along the axis and each milestone pops when the fill reaches it.
   Node spacing is proportional to the years, so the long gap before LED reads as a long gap. */
const LAMPS = [   /* x = 260 + (year − 1879) / 114 × 1400 */
  { year: 1879, x: 260, at: 1.1, c: '#F59E0B', name: '碳丝灯泡', note: '爱迪生 · 碳化灯丝', ic: 'bulb' },
  { year: 1910, x: 641, at: 1.8, c: '#E0A100', name: '钨丝灯', note: '钨丝更亮也更耐用', ic: 'bulb' },
  { year: 1938, x: 985, at: 2.5, c: '#0EA5C6', name: '荧光灯', note: '灯管发光，更省电', ic: 'tube' },
  { year: 1962, x: 1279, at: 3.6, c: '#EF4444', name: '红色 LED', note: '最早只够当指示灯', ic: 'led' },
  { year: 1993, x: 1660, at: 4.3, c: '#3B6CF6', name: '蓝光 LED', note: '凑齐白光，2014 获诺奖', ic: 'led' },
];
const LAMP_ICON = {   /* 24×24 line icons in the icons.js style (stroke 2, 1–4 paths) */
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.9.7 1.5 1.6 1.5 2.6V17h4v-.5c0-1 .6-1.9 1.5-2.6A6 6 0 0 0 12 3z"/><path d="M10.5 10l1.5 2.5 1.5-2.5"/></svg>',
  tube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="20" height="6" rx="3"/><path d="M5 9V6M19 9V6M5 15v3M19 15v3"/></svg>',
  led: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V7a4 4 0 0 1 8 0v6z"/><path d="M6 13h12M10 13v8M14 13v6"/></svg>',
};
EX.shot({
  id: 'lamp', chapter: 'lamp', dur: 8, meter: [40, 48],
  caps: [[0.2, '1879 年，碳丝灯泡亮了。'], [3.6, '一百多年后，「LED」接过接力棒。']],
  sfx: [[0.1, 'whoosh', .35], ...LAMPS.map((m) => [m.at, 'pop', .45]), [4.4, 'chime', .45]],
  html: `
    ${LAMPS.map((m) => `<div class="abs lp-halo" style="width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,${m.c}66 0%,${m.c}00 68%)"></div>`).join('')}
    <div class="abs" id="lp-track" style="left:200px;top:540px;width:1520px;height:10px;border-radius:5px;background:rgba(80,90,140,.14)"></div>
    <div class="abs" id="lp-fill" style="left:200px;top:538px;height:14px;border-radius:7px;background:linear-gradient(90deg,#F59E0B,#E0A100 30%,#0EA5C6 55%,#EF4444 72%,#3B6CF6);background-size:1520px 14px"></div>
    <div class="abs" id="lp-head" style="width:30px;height:30px;border-radius:50%;background:#fff;box-shadow:0 0 0 5px rgba(230,69,139,.35),0 0 30px 8px rgba(230,69,139,.35)"></div>
    ${LAMPS.map((m) => `
      <div class="abs lp-pin" style="width:20px;height:20px;border-radius:50%;background:#fff;border:4px solid rgba(80,90,140,.25)"></div>
      <div class="abs mono lp-year" style="left:${m.x - 120}px;width:240px;top:352px;text-align:center;font-size:60px;font-weight:700;line-height:1.2">${m.year}</div>
      <div class="abs center lp-node" style="width:150px;height:150px;border-radius:50%;background:#fff;border:6px solid ${m.c};color:${m.c};box-shadow:0 14px 40px rgba(60,70,150,.18)">
        <div style="width:80px;height:80px;display:flex">${LAMP_ICON[m.ic]}</div></div>
      <div class="abs lp-text" style="left:${m.x - 170}px;width:340px;top:644px;text-align:center">
        <div style="font-size:40px;font-weight:900;line-height:1.4;color:${m.c};white-space:nowrap">${m.name}</div>
        <div class="t-label" style="font-size:28px;white-space:nowrap">${m.note}</div></div>`).join('')}
    <div class="abs" id="lp-rays" style="left:1660px;top:545px">${[...Array(12)].map((_, i) => `<div class="abs" style="left:-3px;top:-114px;width:6px;height:24px;border-radius:3px;background:#3B6CF6;transform-origin:3px 114px;transform:rotate(${i * 30}deg)"></div>`).join('')}</div>`,
  init(el) {
    this.halos = [...el.querySelectorAll('.lp-halo')]; this.pins = [...el.querySelectorAll('.lp-pin')]; this.years = [...el.querySelectorAll('.lp-year')];
    this.nodes = [...el.querySelectorAll('.lp-node')]; this.texts = [...el.querySelectorAll('.lp-text')];
    this.track = el.querySelector('#lp-track'); this.fill = el.querySelector('#lp-fill'); this.head = el.querySelector('#lp-head'); this.rays = el.querySelector('#lp-rays');
  },
  render(el, u) {
    /* skeleton: track, placeholder pins and grey years by 0.8 s */
    this.track.style.opacity = clamp(u / .3);
    this.track.style.transform = `scaleX(${expoOut(prog(u, 0, .7))})`; this.track.style.transformOrigin = 'left center';
    /* progress head: eased hop from milestone to milestone (keys = [time, x]) */
    const keys = [[.6, 200], ...LAMPS.map((m) => [m.at, m.x]), [5.0, 1720]];
    let hx = 200;
    for (let i = 1; i < keys.length; i++) if (u >= keys[i - 1][0]) hx = lerp(keys[i - 1][1], keys[i][1], cubic(prog(u, keys[i - 1][0], keys[i][0])));
    this.fill.style.width = (hx - 200) + 'px';
    EX.place(this.head, hx, 545, 1 + .25 * pulse(u, .8), clamp((u - .6) / .2));
    LAMPS.forEach((m, i) => {
      EX.place(this.pins[i], m.x, 545, lerp(.4, 1, spring(u - .2 - i * .08, 16, .5)), clamp((u - .2 - i * .08) / .15) * (u < m.at ? 1 : 0));
      EX.fadeUp(this.years[i], u, .25 + i * .08);
      this.years[i].style.color = u >= m.at ? m.c : 'var(--ink3)';   /* always set both states: '' would fall back to navy */
      const k = spring(u - m.at, 15, .45);
      EX.place(this.nodes[i], m.x, 545, lerp(.3, 1, k), clamp((u - m.at) / .12));
      EX.fadeUp(this.texts[i], u, m.at + .15);
      /* ambient: every lit lamp's glow breathes, out of phase */
      const hk = expoOut(prog(u, m.at, m.at + .6));
      EX.place(this.halos[i], m.x, 545, hk * (1 + .08 * Math.sin(u * 2.2 + i)), hk * (.75 + .25 * Math.sin(u * 2.2 + i)));
    });
    /* the last milestone radiates: rays spin slowly once it is lit */
    const rk = spring(u - 4.5, 10, .6);
    this.rays.style.opacity = clamp((u - 4.5) / .3);
    this.rays.style.transform = `rotate(${u * 18}deg) scale(${lerp(.5, 1, rk)})`;
  },
});

/* ------------------------------------------------------------------------------------------------------------ */
/* 7 · 对比条排名 — rows are laid out first (icons, names, empty tracks), then bars grow one after another with their
   numbers counting, so the eye compares lengths in order. Then one bar is the answer: the others dim, the winner row
   lifts on a ring and gets rays. Same unit for every bar and the unit written once on the card. */
const BARS = [
  { name: '国内航班', v: 246, c: '#EF4444', ic: ICON.plane },
  { name: '燃油汽车', v: 170, c: '#F59E0B', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-4l2.5-5h13l2.5 5v4z"/><path d="M3 12h18"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/></svg>' },
  { name: '公交车', v: 97, c: '#7C4DFF', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 18v3M16 18v3"/></svg>' },
  { name: '电动汽车', v: 47, c: '#0EA5C6', ic: ICON.bolt },
  { name: '火车', v: 35, c: '#14B27A', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="14" rx="4"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/></svg>' },
];
EX.shot({
  id: 'bars', chapter: 'bars', dur: 8, meter: [48, 56],
  caps: [[0.3, '走一公里，谁排的碳最多？'], [3.6, '「火车」最低，约是飞机的七分之一。']],
  sfx: [[0.1, 'pop', .35], ...BARS.map((b, i) => [.4 + i * .22, 'tick', .35]), [3.6, 'chime', .5]],
  html: `
    <div class="abs card" id="br-card" style="left:230px;top:196px;width:1460px;height:694px"></div>
    <div class="abs t-h3" id="br-title" style="left:290px;top:226px;white-space:nowrap">每人每公里的碳排放</div>
    <div class="abs t-label" id="br-unit" style="right:290px;top:236px;white-space:nowrap">单位：克 · 英国 2022 数据</div>
    <div class="abs card ring" id="br-win" style="--c:var(--green);left:262px;top:716px;width:1396px;height:112px;border-radius:24px"></div>
    <div class="abs" id="br-rays" style="left:330px;top:772px">${[...Array(12)].map((_, i) => `<div class="abs" style="left:-3px;top:-66px;width:6px;height:14px;border-radius:3px;background:#14B27A;transform-origin:3px 66px;transform:rotate(${i * 30}deg)"></div>`).join('')}</div>
    ${BARS.map((b, i) => `
      <div class="abs br-row" style="left:290px;top:${300 + i * 108}px;width:1340px;height:80px;display:flex;align-items:center;transform-origin:40px 40px">
        <div class="center" style="width:80px;height:80px;border-radius:22px;background:color-mix(in srgb,${b.c} 12%,white);color:${b.c};flex:none"><div style="width:44px;height:44px;display:flex">${b.ic}</div></div>
        <div style="width:210px;margin-left:40px;font-size:32px;font-weight:700;white-space:nowrap;flex:none">${b.name}</div>
        <div style="position:relative;width:860px;height:44px;flex:none">
          <div style="position:absolute;inset:0;border-radius:22px;background:rgba(80,90,140,.08)"></div>
          <div class="br-bar" style="position:absolute;left:0;top:0;height:44px;border-radius:22px;overflow:hidden;background:linear-gradient(90deg,${b.c},color-mix(in srgb,${b.c} 65%,white))">
            <div class="br-shine" style="position:absolute;top:0;bottom:0;width:120px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent)"></div></div>
          <div class="mono br-val" style="position:absolute;top:-4px;font-size:36px;font-weight:700;white-space:nowrap;color:${b.c}">0</div>
        </div>
      </div>`).join('')}
    <div class="abs tag" id="br-tag" style="--c:var(--green);left:910px;top:747px;white-space:nowrap">≈ 飞机的 1/7</div>`,
  init(el) {
    this.rows = [...el.querySelectorAll('.br-row')]; this.bars = [...el.querySelectorAll('.br-bar')]; this.vals = [...el.querySelectorAll('.br-val')]; this.shines = [...el.querySelectorAll('.br-shine')];
    this.q = {}; for (const id of ['br-card', 'br-title', 'br-unit', 'br-win', 'br-rays', 'br-tag']) this.q[id] = el.querySelector('#' + id);
  },
  render(el, u) {
    const q = this.q;
    /* skeleton: card, title and every row (icon, name, empty track) by 0.8 s */
    EX.pop(q['br-card'], u, 0, { s0: .96 });
    EX.fadeUp(q['br-title'], u, .1); EX.fadeUp(q['br-unit'], u, .2);
    const win = cubic(prog(u, 3.6, 4.1)), k = spring(u - 3.6, 12, .5);
    BARS.forEach((b, i) => {
      const p = expoOut(prog(u, .4 + i * .22, 1.6 + i * .22));
      const w = 860 * b.v / 246 * p;                                    /* every bar on the same scale: 246 g = full track */
      this.bars[i].style.width = w.toFixed(1) + 'px';
      this.vals[i].style.left = (w + 18).toFixed(1) + 'px';
      EX.num(this.vals[i], b.v, p, 0, '', ' g');
      this.shines[i].style.left = (((u * 300 + i * 160) % 1400) - 200) + 'px';   /* ambient: a sheen runs along each bar */
      const winner = i === BARS.length - 1;
      const row = this.rows[i];
      row.style.opacity = clamp((u - .1 - i * .08) / .3) * (winner ? 1 : lerp(1, .5, win));
      row.style.transform = `translateY(${(1 - expoOut(prog(u, .1 + i * .08, .7 + i * .08))) * 24}px) scale(${winner ? lerp(1, 1.05, k) : 1})`;
    });
    /* beat 2: the winner lifts on a ring, rays spin around its icon */
    EX.pop(q['br-win'], u, 3.6, { s0: .94 });
    q['br-win'].style.boxShadow = `0 0 0 ${(3 + 2 * Math.sin(u * 4)).toFixed(2)}px var(--green),0 24px 70px rgba(20,178,122,.22)`;
    q['br-rays'].style.opacity = clamp((u - 3.7) / .3);
    q['br-rays'].style.transform = `rotate(${u * 20}deg) scale(${lerp(.5, 1, spring(u - 3.7, 10, .6))})`;
    EX.pop(q['br-tag'], u, 3.8, { s0: .8 });
  },
});

EX.run({
  meter: { label: '画法', unit: 's', decimals: 1, max: 56, ticks: [0, 14, 28, 42, 56] },
  rate: null,
  mood: 'calm',
});
