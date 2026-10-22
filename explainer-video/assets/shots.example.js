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
    <div class="abs t-h3" id="hk-q" style="left:0;right:0;top:300px;text-align:center;color:var(--ink2)">想跟朋友说点什么？</div>
    <div class="abs card" id="hk-box" style="left:560px;top:420px;width:800px;height:120px;display:flex;align-items:center;padding:0 40px">
      <span class="t-h3" id="hk-text" style="font-weight:500"></span><span id="hk-caret" style="width:3px;height:44px;background:var(--blue);margin-left:4px"></span>
      <div id="hk-send" class="center" style="margin-left:auto;width:72px;height:72px;border-radius:50%;background:var(--blue);color:#fff;font-size:34px">↑</div>
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

/* 2 · PROMISE — name the device: we will slow this moment down. The meter appears at zero. */
EX.shot({
  id: 'title', chapter: null, dur: 6, hud: false,
  caps: [[0.6, '从按下到朋友收到，只要 0.3 秒。我们把它放慢。']],
  sfx: [[0.2, 'reveal', .6]],
  html: `
    <div class="abs t-h2" id="ti-a" style="left:0;right:0;top:330px;text-align:center">发送之后的</div>
    <div class="abs t-hero grad-text mono" id="ti-n" style="left:0;right:0;top:430px;text-align:center;font-size:200px">0.000s</div>`,
  init(el) { this.a = el.querySelector('#ti-a'); this.n = el.querySelector('#ti-n'); splitChars(this.a); },
  render(el, u) {
    riseChars(this.a, u, .1);
    EX.pop(this.n, u, .5, { s0: .7 });
    EX.num(this.n, 0.3, expoOut(prog(u, 1.2, 3)), 3, '', 's');
  },
});

/* 3 · CHAPTER — one concept per shot. The card is built once; characters scramble left to right. */
EX.shot({
  id: 'pack', chapter: 'pack', dur: 7.5, meter: [0, 0.002],
  caps: [[0.3, '这句话先被打包成一个「数据包」。'], [3.6, '再经「加密」：路上谁截到，都只是乱码。']],
  sfx: [[3.6, 'snap', .5]],
  html: `
    <div class="abs card ring" id="pk-card" style="--c:var(--blue);left:460px;top:300px;width:1000px;height:420px;padding:44px 56px">
      <div style="display:flex;justify-content:space-between"><span class="tag">数据包</span><span class="tag" id="pk-lock" style="--c:var(--purple);gap:10px"><span style="width:28px;height:28px;display:inline-flex">${ICON.lock}</span>已加密</span></div>
      <div class="code" id="pk-code" style="margin-top:36px;white-space:pre"></div>
    </div>`,
  init(el) { this.card = el.querySelector('#pk-card'); this.code = el.querySelector('#pk-code'); this.lock = el.querySelector('#pk-lock'); },
  render(el, u) {
    EX.pop(this.card, u, 0, { s0: .92 });
    const plain = 'POST /message  HTTP/2\nto: friend_01\nbody: "周末一起吃饭吗？"';
    const r = rng(7); const junk = plain.split('').map((c) => (c === '\n' ? c : '0123456789abcdef'[(r() * 16) | 0]));
    const k = Math.floor(plain.length * cubic(prog(u, 3.8, 5.4)));        /* scramble front moves left → right */
    this.code.textContent = plain.split('').map((c, i) => (i < k ? junk[i] : c)).join('');
    EX.pop(this.lock, u, 5.4);
  },
});

/* 4 · CHAPTER — a path drawn node by node, the packet (protagonist) rides it. */
EX.shot({
  id: 'net', chapter: 'net', dur: 8.5, meter: [0.002, 0.12],
  caps: [[0.3, '数据包经过「基站」，进入运营商网络，'], [4.2, '一路跳过十几台路由器，抵达服务器机房。']],
  sfx: [[1.0, 'pop', .4], [3.0, 'pop', .4], [5.0, 'chime', .5]],
  html: `
    <svg class="wire"><path id="nt-path" d="M380 560 C 700 380, 900 740, 960 560 S 1300 380, 1540 560" stroke="var(--purple)"/></svg>
    <div class="abs node" id="nt-a" style="--c:var(--blue)"><div class="ic">${ICON.phone}</div>你的手机</div>
    <div class="abs node" id="nt-b" style="--c:var(--purple)"><div class="ic">${ICON.tower}</div>基站</div>
    <div class="abs node" id="nt-c" style="--c:var(--green)"><div class="ic">${ICON.server}</div>服务器机房</div>
    <div class="abs" id="nt-dot" style="width:34px;height:34px;border-radius:50%;background:var(--purple);box-shadow:0 0 0 10px color-mix(in srgb,var(--purple) 20%,transparent)"></div>`,
  init(el) { this.p = el.querySelector('#nt-path'); this.n = ['#nt-a', '#nt-b', '#nt-c'].map((s) => el.querySelector(s)); this.dot = el.querySelector('#nt-dot'); },
  render(el, u) {
    const pos = [[380, 600], [960, 600], [1540, 600]];
    this.n.forEach((n, i) => { const k = spring(u - (1 + i * 2), 16, .55); EX.place(n, pos[i][0], pos[i][1], lerp(.6, 1, k), clamp((u - 1 - i * 2) / .15)); });
    const p = cubic(prog(u, 1, 5));
    EX.drawPath(this.p, p);
    const L = this.p.getTotalLength(), pt = this.p.getPointAtLength(L * p);
    EX.place(this.dot, pt.x, pt.y, 1, p > 0 && p < 1 ? 1 : 0);
  },
});

EX.run({
  meter: { label: '发送后', unit: 's', decimals: 3, max: 0.3, ticks: [0, 0.1, 0.2, 0.3] },
  rate: { label: '慢放' },
  mood: 'calm',
});
