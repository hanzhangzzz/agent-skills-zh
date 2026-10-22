/* shots.example.js — a 4-shot demo of the API. Copy to shots.js, then replace every shot with your own.
   Pattern per shot: html (built once) → init (cache elements) → render(el, u, d) (pure in u). */

EX.chapter('pack', { name: '打包 · 加密', color: EX.C.blue });
EX.chapter('net', { name: '穿越网络', color: EX.C.purple });

/* 1 · HOOK — the everyday moment the viewer already knows. No HUD yet. */
EX.shot({
  id: 'hook', chapter: null, dur: 6.5, hud: false,
  caps: [[0.6, '你在手机上打了一句话。'], [3.8, '然后，按下发送。']],
  sfx: [[4.4, 'click', .6]],
  html: `
    <div class="abs t-h2" id="hk-q" style="left:0;right:0;top:290px;text-align:center;color:var(--ink2)">想跟朋友说点什么？</div>
    <div class="abs card" id="hk-box" style="left:410px;top:430px;width:1100px;height:150px;display:flex;align-items:center;padding:0 48px">
      <span class="t-h2" id="hk-text" style="font-weight:500"></span><span id="hk-caret" style="width:4px;height:60px;background:var(--blue);margin-left:4px"></span>
      <div id="hk-send" class="center" style="margin-left:auto;width:92px;height:92px;border-radius:50%;background:var(--blue);color:#fff;font-size:44px">↑</div>
    </div>`,
  init(el) { this.q = {}; for (const id of ['hk-q', 'hk-box', 'hk-text', 'hk-caret', 'hk-send']) this.q[id] = el.querySelector('#' + id); },
  render(el, u) {
    const q = this.q;
    EX.fadeUp(q['hk-q'], u, 0);
    EX.pop(q['hk-box'], u, .2, { s0: .9 });
    EX.type(q['hk-text'], '周末一起吃饭吗？', u, 1.2, 6);
    q['hk-caret'].style.opacity = u < 4.4 && (u * 2 | 0) % 2 === 0 ? 1 : 0;
    const press = Math.exp(-14 * Math.max(0, u - 4.4)) * (u >= 4.4 ? 1 : 0);
    q['hk-send'].style.transform = `scale(${1 - .18 * press})`;
    /* the message leaves the box: it becomes the protagonist of the next shots */
    const fly = expoOut(prog(u, 4.6, 5.6));
    q['hk-text'].style.transform = `translateY(${-fly * 160}px)`;
    q['hk-text'].style.opacity = 1 - fly;
  },
});

/* 2 · PROMISE — name the device: we will slow this moment down. Signature shot: ring timer + orbiting sparks.
   Title shots are the poster of the film: big type (≥ 120 px), one strong shape, never a lone line of text. */
EX.shot({
  id: 'title', chapter: null, dur: 6, hud: false,
  caps: [[0.6, '从按下到朋友收到，只要 0.3 秒。我们把它放慢。']],
  sfx: [[0.2, 'reveal', .6]],
  html: `
    <div class="abs t-h2" id="ti-a" style="left:0;right:0;top:170px;text-align:center">发送之后的</div>
    <svg class="wire"><circle cx="960" cy="560" r="290" stroke="rgba(80,90,140,.12)" stroke-width="18" fill="rgba(255,255,255,.55)"/>
      <circle id="ti-ring" cx="960" cy="560" r="290" stroke="url(#ti-g)" stroke-width="18" fill="none" stroke-linecap="round" transform="rotate(-90 960 560)"/>
      <defs><linearGradient id="ti-g"><stop offset="0" stop-color="#3B6CF6"/><stop offset=".6" stop-color="#7C4DFF"/><stop offset="1" stop-color="#E6458B"/></linearGradient></defs></svg>
    <div class="abs t-hero grad-text mono" id="ti-n" style="left:0;right:0;top:490px;text-align:center;font-size:136px;line-height:1">0.000</div>
    <div class="abs t-label" style="left:0;right:0;top:650px;text-align:center;font-size:30px">秒</div>
    <div id="ti-sparks"></div>`,
  init(el) {
    this.a = el.querySelector('#ti-a'); this.n = el.querySelector('#ti-n'); this.ring = el.querySelector('#ti-ring'); splitChars(this.a);
    const r = rng(3), box = el.querySelector('#ti-sparks');
    this.sp = [...Array(36)].map((_, i) => {             /* random layout made once, in init, from rng */
      const d = document.createElement('div'); d.className = 'abs';
      const size = 6 + r() * 10; d.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${EX.TOKEN_COLORS[i % 8]}`;
      box.appendChild(d); return { d, ang: r() * Math.PI * 2, rad: 340 + r() * 240, spd: .08 + r() * .2, ph: r() };
    });
  },
  render(el, u) {
    riseChars(this.a, u, .1);
    const p = expoOut(prog(u, 1.2, 3.2));
    EX.num(this.n, 0.3, p, 3);
    EX.drawPath(this.ring, p);
    this.sp.forEach((s, i) => {                          /* orbit = closed-form function of u: continuous motion */
      const a = s.ang + u * s.spd, k = spring(u - .3 - i * .02, 10, .6);
      EX.place(s.d, 960 + Math.cos(a) * s.rad * k, 560 + Math.sin(a) * s.rad * .62 * k, 1, .35 + .4 * Math.sin(u * 2 + s.ph * 6) ** 2);
    });
  },
});

/* 3 · CHAPTER — one concept per shot. The card is built once; characters scramble left to right. */
EX.shot({
  id: 'pack', chapter: 'pack', dur: 7.5, meter: [0, 0.002],
  caps: [[0.3, '这句话先被打包成一个「数据包」。'], [3.6, '再经「加密」：路上谁截到，都只是乱码。']],
  sfx: [[3.6, 'snap', .5]],
  html: `
    <div class="abs card ring" id="pk-card" style="--c:var(--blue);left:360px;top:250px;width:1200px;height:520px;padding:48px 64px;overflow:hidden">
      <div style="display:flex;justify-content:space-between"><span class="tag">数据包</span><span class="tag" id="pk-lock" style="--c:var(--purple);gap:10px"><span style="width:28px;height:28px;display:inline-flex">${ICON.lock}</span>TLS 已加密</span></div>
      <div class="code" id="pk-code" style="margin-top:44px;white-space:pre;font-size:38px;line-height:1.7"></div>
      <div class="abs" id="pk-scan" style="top:0;bottom:0;width:120px;background:linear-gradient(90deg,transparent,rgba(124,77,255,.28));border-right:4px solid var(--purple)"></div>
    </div>`,
  init(el) {
    this.card = el.querySelector('#pk-card'); this.code = el.querySelector('#pk-code'); this.lock = el.querySelector('#pk-lock'); this.scan = el.querySelector('#pk-scan');
    this.lines = ['POST /message  HTTP/2', 'to:   friend_01', 'body: "周末一起吃饭吗？"'];
    const r = rng(7);                                                   /* the cipher text is fixed once, from rng */
    this.junk = this.lines.map((l) => [...l].map(() => '0123456789abcdef'[(r() * 16) | 0]).join(''));
  },
  render(el, u) {
    EX.pop(this.card, u, 0, { s0: .92 });
    const p = cubic(prog(u, 3.8, 5.6));                                 /* a scan line sweeps left → right */
    const x = lerp(-120, 1200, p);
    this.scan.style.left = x - 120 + 'px'; this.scan.style.opacity = p > 0 && p < 1 ? 1 : 0;
    const cols = Math.floor(((x - 64) / 23));                            /* ≈ columns already passed (38 px mono ≈ 23 px/char) */
    this.code.textContent = this.lines.map((l, i) => [...l].map((c, j) => (j < cols ? this.junk[i][j] : c)).join('')).join('\n');
    EX.pop(this.lock, u, 5.6);
  },
});

/* 4 · CHAPTER — skeleton first: every node and the route are on screen within the first second,
   then the protagonist (the packet card) rides the route and lights each node as it arrives.
   Never reveal the skeleton piece by piece across the whole shot: mid-shot the frame would be half empty. */
EX.shot({
  id: 'net', chapter: 'net', dur: 8.5, meter: [0.002, 0.12],
  caps: [[0.3, '数据包经过「基站」，进入运营商网络，'], [4.2, '一路跳过十几台路由器，抵达服务器机房。']],
  sfx: [[1.6, 'pop', .4], [3.9, 'pop', .4], [6.2, 'chime', .5]],
  html: `
    <svg class="wire"><path id="nt-route" d="M360 520 C 620 360, 760 680, 960 520 S 1300 360, 1560 520" stroke="rgba(124,77,255,.25)" stroke-width="10"/>
      <path id="nt-done" d="M360 520 C 620 360, 760 680, 960 520 S 1300 360, 1560 520" stroke="var(--purple)" stroke-width="10"/>
      <path id="nt-flow" d="M360 520 C 620 360, 760 680, 960 520 S 1300 360, 1560 520" stroke="#fff" stroke-width="4" stroke-dasharray="2 26"/></svg>
    <div class="abs node" id="nt-a" style="--c:var(--blue)"><div class="ic">${ICON.phone}</div>你的手机</div>
    <div class="abs node" id="nt-b" style="--c:var(--purple)"><div class="ic">${ICON.tower}</div>基站 · 运营商</div>
    <div class="abs node" id="nt-c" style="--c:var(--green)"><div class="ic">${ICON.server}</div>服务器机房</div>
    ${[...Array(8)].map((_, i) => `<div class="abs nt-hop" style="width:26px;height:26px;border-radius:50%;background:#fff;border:5px solid rgba(124,77,255,.35)"></div>`).join('')}
    <div class="abs t-label" id="nt-hops" style="left:0;right:0;top:760px;text-align:center">途经路由器 <b class="mono" id="nt-hn" style="color:var(--purple);font-size:40px">0</b> 台</div>
    <div class="abs card ring" id="nt-pkt" style="--c:var(--purple);padding:14px 26px;display:flex;align-items:center;gap:12px;font-weight:700;font-size:28px;color:var(--purple)">
      <span style="width:32px;height:32px;display:inline-flex">${ICON.lock}</span>数据包</div>`,
  init(el) {
    this.route = el.querySelector('#nt-route'); this.done = el.querySelector('#nt-done'); this.flow = el.querySelector('#nt-flow');
    this.n = ['#nt-a', '#nt-b', '#nt-c'].map((s) => el.querySelector(s)); this.pkt = el.querySelector('#nt-pkt'); this.hn = el.querySelector('#nt-hn');
    /* small router hops along the route: positions computed once from the path geometry */
    const L = this.route.getTotalLength(), skip = [0, .5, 1];
    this.hops = [...el.querySelectorAll('.nt-hop')].map((d, i) => { const f = [.08, .16, .25, .34, .62, .71, .8, .9][i], pt = this.route.getPointAtLength(L * f); return { d, f, x: pt.x, y: pt.y }; });
  },
  render(el, u) {
    const pos = [[360, 560], [960, 560], [1560, 560]], arrive = [1.2, 3.9, 6.2];
    EX.drawPath(this.route, expoOut(prog(u, .2, 1.0)));                 /* skeleton: route + all nodes by u = 1 s */
    this.n.forEach((n, i) => {
      const k = spring(u - .1 - i * .15, 16, .55), lit = u > arrive[i];
      EX.place(n, pos[i][0], pos[i][1], lerp(.6, 1, k) * (1 + .08 * Math.exp(-6 * Math.max(0, u - arrive[i])) * (lit ? 1 : 0)), clamp((u - .1 - i * .15) / .15));
      n.querySelector('.ic').style.borderColor = lit ? 'var(--c)' : '';
    });
    const p = cubic(prog(u, 1.2, 6.2));                                   /* protagonist rides the route */
    EX.drawPath(this.done, p);
    this.hops.forEach((h, i) => {                                          /* skeleton: hops pop with the route, light when passed */
      EX.place(h.d, h.x, h.y, lerp(.4, 1, spring(u - .4 - i * .05, 16, .55)), clamp((u - .4 - i * .05) / .15));
      h.d.style.borderColor = p >= h.f ? 'var(--purple)' : '';
    });
    dashFlow(this.flow, u, 60);                                           /* ambient motion while captions are read */
    const L = this.done.getTotalLength(), pt = this.done.getPointAtLength(L * p);
    EX.place(this.pkt, pt.x, pt.y - 80, 1, clamp((u - 1) / .2));
    EX.fadeUp(el.querySelector('#nt-hops'), u, 1.2);
    EX.num(this.hn, 14, p);
  },
});

EX.run({
  meter: { label: '发送后', unit: 's', decimals: 3, max: 0.3, ticks: [0, 0.1, 0.2, 0.3] },
  rate: { label: '慢放' },
  mood: 'calm',
});
