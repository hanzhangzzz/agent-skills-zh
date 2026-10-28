/* cocoon · 「信息茧房是怎么织成的」— the reference film for data-art / particle subjects (67 s, 96 bpm, one world,
   one long take, landscape + 9:16 cut + cover + a scored soundtrack). Look: the user's reference film (thousands of
   crisp 1 px hairlines, a thick ring band packed with micro text, no bloom), then colour = category.

   Run (in a work dir made by init.sh; this replaces its shots.js):
     cp <skill>/assets/cocoon/* .  &&  bash <skill>/scripts/fonts.sh .
     node <skill>/scripts/render.mjs --html index.html --stills shots --lint        landscape (EX page: shots.js)
     node <skill>/scripts/render.mjs --html vertical.html --stills 14,38,49.6       9:16 (vertical.js, no EX)
     node <skill>/scripts/render.mjs --html cover.html --stills 0.5                 1080×1440 cover
     PYTHONPATH=<skill>/scripts python3 compose_score.py cues.json out/score.wav   then mix.py … --music out/score.wav
                                                                                    (both cuts share cues.json + score)

   Files: world.js = everything that is the same in every cut (simulation, drawing, captions, timeline);
          shots.js = the landscape page (EX chapters, sound cues, DOM labels); vertical.js / vertical.html = the 9:16
          page (engine.js LV.start at 1080×1920, own camera vcam, own caption layout); cover.html = a still.

   What each part teaches (search for the quoted phrase):
     "积少成多"                 rate & speed are functions of birth time: a trickle you can follow → flood → slow-motion
                                gate → growing again. Birth times sorted, so a frame only walks the live particles.
     "inverse CDF"              emission per direction narrows by sampling direction from a moving distribution.
     "each strand is one liked" cause → effect: every strand of the cocoon is snapped to a real liked line's arrival.
     "one colour per category"  colour carries meaning: full spectrum at first, only your few colours at the end.
     "the band: your feed log"  a texture painted once (two versions: dim / coloured), clipped per sector at draw time.
     "in the close-up"          readable content: tags on the lines, real titles people click, the gate's verdict.
     "tq = the world clock"     text that moves or changes is held per video frame, so motion blur cannot ghost it.
     "THE MOMENT"               the climax: bullet time (a world clock SIM(t) slowed to 0.12× then caught up),
                                squeeze-and-snap, colour shockwave, flash, shake, then a lighting wave across a crowd.
     "other people"             a crowd of individuals, not a web: spacing, short beams, a per-person colour signature.
     "FB_VIEW" / "vertical camera"   one world, several frames: size, safe areas and camera come from the page.
*/
import './light.js';
/* the frame this world is filmed for: landscape (the EX page, default) or the 9:16 vertical cut. Set window.FB_VIEW
   in the page BEFORE this module loads; it also decides where the opening's first lines come from. */
export const VIEW = Object.assign({ W: 1920, H: 1080, vertical: false, early: 0, tag: [150, 850], tagX: 1e9, tagFont: 24, tagEvery: 3, tagFlip: false,
  crowd: [120, 1800, 200, 860], title: [480, 1440, 340, 680] }, window.FB_VIEW || {});

const B = (n) => n * 60 / 96;                                              // 96 bpm: B(1) = 0.625 s
const DUR = { flood: B(15), gate: B(20), loop: B(20), cocoon: B(16), many: B(22), end: B(14) };
const T1 = DUR.flood, T2 = T1 + DUR.gate, T3 = T2 + DUR.loop, T4 = T3 + DUR.cocoon, T5 = T4 + DUR.many, T6 = T5 + DUR.end;

const ACC = '#8FE3C4', INK = '#E9EBEF', INK2 = '#8A8D94', BG = '#060607';
const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const p = clamp((x - a) / (b - a)); return p * p * (3 - 2 * p); };

/* ---------- the world (world px; origin = you) ---------- */
const R0 = 2700, RO = 470, RI = 330, COC = [92, 116];                     // spawn radius, band outer / inner, cocoon
const CATS = ['美食', '短剧', 'AI', '旅行', '健身', '搞钱', '萌宠', '游戏', '穿搭', '情感', '职场', '娱乐'];
const catIx = (th) => Math.floor(((((th / TAU) % 1) + 1) % 1) * CATS.length) % CATS.length;
const catOf = (th) => CATS[catIx(th)];
const SECTOR = (k) => (k + .5) / CATS.length * TAU;                        // centre direction of category k
/* one colour per category, evenly around the wheel, a little muted: the opening is a full spectrum,
   the cocoon ends up in the few colours you kept */
const hsl = (h, sa, l) => { const f = (n) => { const k = (n + h / 30) % 12, a = sa * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return `${f(0)},${f(8)},${f(4)}`; };
const CATRGB = CATS.map((_, k) => hsl((k * 30 + 15) % 360, .68, .64));
const TITLES = [
  ['全网最好吃的螺蛳粉', '一人食的十种做法', '打工人带饭一周不重样', '妈妈的红烧肉配方', '苍蝇馆子排队两小时', '夜市十块钱能吃什么'],
  ['重生之我在职场当卧底', '闪婚老公竟是首富', '她带着记忆回到十八岁', '真千金归来 第37集', '离婚后前夫悔疯了', '穿越成皇帝的第一天'],
  ['AI已经能替你上班了', '10个效率翻倍的AI工具', '用AI一晚做出一个App', 'AI会先取代哪些工作', '普通人怎么用AI赚钱', '和AI谈恋爱是什么体验'],
  ['30岁裸辞后我去了大理', '人均500玩转三亚', '一个人去冰岛看极光', '这条自驾路线美哭了', '特种兵旅游48小时', '被低估的十个小城'],
  ['30天练出马甲线', '每天走一万步有用吗', '跟练15分钟燃脂', '我是怎么瘦了40斤的', '久坐族必做的拉伸', '体态差的人都有这个习惯'],
  ['月薪3千和3万差在哪', '25岁存下第一个50万', '副业月入过万的真相', '年轻人开始反向消费', '这些钱千万别省', '普通人的理财第一课'],
  ['猫为什么总把东西推下桌', '狗子听到要洗澡的反应', '捡到一只流浪小奶猫', '橘猫又胖了三斤', '柯基的屁股有多圆', '仓鼠搬家全过程'],
  ['这个Boss我打了三天', '新版本最强阵容', '手残党也能通关', '开放世界隐藏彩蛋', '速通纪录又被打破', '童年游戏回忆杀'],
  ['小个子显高穿搭公式', '一件白T的五种穿法', '微胖女生怎么选裤子', '平价替代大牌', '秋冬叠穿不臃肿', '男生衣柜必备单品'],
  ['前任结婚了我去当伴娘', '异地恋三年后我们分手了', '如何体面地拒绝别人', '你身边有这种朋友吗', '三十岁还单身怎么了', '原生家庭的伤怎么好'],
  ['985毕业去送外卖', '领导说辛苦了的潜台词', '裸辞后的第一个月', '面试官最怕你问的问题', '00后整顿职场', '工作五年才明白的事'],
  ['这届综艺太敢拍了', '年度最好看的电影', '演唱会门票秒空', '明星素颜真实对比', '热搜第一是怎么来的', '顶流塌房始末'],
];
const titleOf = (th, i) => TITLES[catIx(th)][Math.floor(i / VIEW.tagEvery) % 6];   // tagged lines are every n-th: step by n or only n distinct titles show
/* your hidden interests: von Mises bumps over direction θ (screen angle, y down); θ = 0 is screen-right */
const MINE = [0, 2, 6, 9];                                               // your four: 美食 · AI · 萌宠 · 情感
const BUMPS = [[SECTOR(0), 1], [SECTOR(2), .75], [SECTOR(6), .6], [SECTOR(9), .5]];
const NB = 720, PN = new Float32Array(NB), WEND = new Float32Array(NB), FEND = new Float32Array(NB + 1);
{
  let s = 0;
  for (let i = 0; i < NB; i++) { const th = (i + .5) / NB * TAU; let v = 0; for (const [m, w] of BUMPS) v += w * Math.exp(22 * (Math.cos(th - m) - 1)); PN[i] = v; s += v; }
  for (let i = 0; i < NB; i++) PN[i] *= NB / s;                           // mean 1
  for (let i = 0; i < NB; i++) WEND[i] = .035 + .965 * PN[i];             // what's left at the end: ~3–5 % exploration (示意)
  for (let i = 0; i < NB; i++) FEND[i + 1] = FEND[i] + WEND[i] / NB;
}
const PMAX = Math.max(...PN);
const binOf = (th) => (Math.floor(((((th / TAU) % 1) + 1) % 1) * NB)) % NB;
const pnAt = (th) => PN[binOf(th)] / PMAX;                                 // 0…1 how much you like this direction
const K = (t) => smooth(T2 + .3, T3 - 1, t);                               // narrowing progress (days 1 → 180, 示意)
function dirOf(u, k) {                                                     // inverse CDF of (1 − k)·uniform + k·WEND
  let lo = 0, hi = 1;
  for (let it = 0; it < 16; it++) {
    const x = (lo + hi) / 2, j = Math.min(NB - 1, Math.floor(x * NB));
    const fe = FEND[j] + (x * NB - j) * (FEND[j + 1] - FEND[j]);
    if ((1 - k) * x + k * fe < u) lo = x; else hi = x;
  }
  return (lo + hi) / 2 * TAU;
}
/* angular banding like a long exposure: smooth value noise over θ */
const BAND = new Float32Array(NB);
{ const r = rng(3), knots = [...Array(96)].map(() => r()); for (let i = 0; i < NB; i++) { const x = i / NB * 96, j = Math.floor(x), f = x - j, s = f * f * (3 - 2 * f); BAND[i] = lerp(knots[j % 96], knots[(j + 1) % 96], s); } }

/* 积少成多: how many items reach you per second, and how fast they travel (both decided at birth).
   The film opens on a trickle you can follow one by one, swells to the flood, slows right down at the gate
   (slow motion: each line's fate is readable), then grows again with the days of the loop. */
const lgl = (a, b, e) => Math.exp(lerp(Math.log(a), Math.log(b), clamp(e)));
function RATEF(t) {
  if (t < -2.5) return 3;                                                 // lines need ~2–3 s to fly into frame: lead the caption
  if (t < 3.5) return 3 * Math.pow(600, (t + 2.5) / 6);                   // 3 → 1800 per second
  if (t < T1 - 1) return 1800;
  if (t < T2) return lgl(1800, 260, (t - (T1 - 1)) / 1.8);                // the gate: a sparse stream
  return lgl(260, 2200, (t - T2) / (DUR.loop - 2));                       // the loop: day by day it fills up
}
const SPD = (t) => lerp(.55, 1, smooth(1.5, 5.5, t)) * (1 - .58 * smooth(T1 + .3, T1 + 2, t) * (1 - smooth(T2 - .5, T2 + 2, t)));
const B0 = -10, LIFE = 10;
const BIRTH = [];
{ const r = rng(5); for (let b = B0; b < T6 + 1; b += (.5 + r()) / RATEF(b)) BIRTH.push(b); }
const NP = BIRTH.length;
const P = { b: Float32Array.from(BIRTH), th: new Float32Array(NP), v: new Float32Array(NP), l: new Float32Array(NP), a: new Float32Array(NP), like: new Uint8Array(NP), tint: new Uint8Array(NP) };
const firstBorn = (t) => { let lo = 0, hi = NP; while (lo < hi) { const m = (lo + hi) >> 1; if (P.b[m] < t) lo = m + 1; else hi = m; } return lo; };
{
  const r = rng(7);
  for (let i = 0; i < NP; i++) {
    const b = P.b[i], early = b < -1.5;
    const th = early ? VIEW.early + (r() - .5) * .55 : dirOf(r(), K(b));               // the first few come into the opening close-up
    P.th[i] = th; P.v[i] = (650 + 450 * r()) * SPD(b); P.l[i] = (90 + 820 * Math.pow(r(), 2.2)) * (.4 + .6 * SPD(b));
    P.a[i] = (.25 + .75 * r()) * (.25 + .9 * BAND[binOf(th)]);
    P.like[i] = r() < .06 + .8 * pnAt(th) ? 1 : 0;
    P.tint[i] = r() < .08 ? 1 : 0;                                          // a few plain white lines keep the hairline texture
  }
}

/* the inside: one curve per thing you kept. Early: loose arcs anywhere inside; later: wound tight into a cocoon */
const NC = 520, THR = [];
{
  const r = rng(11);
  for (let j = 0; j < NC; j++) {
    const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z), n = [s * Math.cos(a), s * Math.sin(a), z];
    const e1 = Math.abs(n[1]) < .9 ? [n[2], 0, -n[0]] : [0, -n[2], n[1]];
    const l1 = Math.hypot(...e1); e1.forEach((v, i) => (e1[i] = v / l1));
    const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
    const wide = RI * (.3 + .62 * r()), off = [(r() - .5) * RI * .5, (r() - .5) * RI * .5];
    THR.push({ e1, e2, wide, off, tight: .82 + .3 * r(), at: lerp(1.5, T4 - 3, Math.pow(j / NC, .55)), ph: r() * TAU, span: .35 + .65 * r(), a: .1 + .25 * r(), cat: MINE[Math.floor(r() * 4)] });
  }
  /* each strand is one liked item: snap it to the moment a liked line arrives inside, and turn it so the strand
     starts where that line came in (cause → effect, one by one) */
  const arr = [];
  for (let i = 0; i < NP; i++) if (P.like[i]) arr.push([P.b[i] + (R0 - RI * .6) / P.v[i], P.th[i]]);
  arr.sort((a, b) => a[0] - b[0]);
  let k = 0;
  for (const T of THR) {
    while (k < arr.length && arr[k][0] < T.at) k++;
    if (k >= arr.length) break;
    const [ta, th] = arr[k++];
    T.at = ta; T.cat = catIx(th);
    const x = Math.cos(T.ph) * T.e1[0] + Math.sin(T.ph) * T.e2[0], y = Math.cos(T.ph) * T.e1[1] + Math.sin(T.ph) * T.e2[1];
    const d = th - Math.atan2(y, x), cd = Math.cos(d), sd = Math.sin(d);
    for (const e of [T.e1, T.e2]) [e[0], e[1]] = [e[0] * cd - e[1] * sd, e[0] * sd + e[1] * cd];
  }
}
const TIGHT = (t) => smooth(T2 - 2, T4 - 2, t);

/* the band: your feed log, painted once into two textures (dim / lit); categories are sectors */
const TEX = 4096, TW = (RO + 70) * 2, TS = TEX / TW;                       // texture px per world px
await document.fonts.load('600 12px "JetBrains Mono"'); await document.fonts.load('500 12px "Noto Sans SC"');
function paintBand(alpha, colored) {
  const c = document.createElement('canvas'); c.width = c.height = TEX;
  const g = c.getContext('2d'), r = rng(31);
  g.translate(TEX / 2, TEX / 2); g.scale(TS, TS);
  let cc = '233,235,239';
  const ink = (a, c = '233,235,239') => `rgba(${c},${(a * alpha).toFixed(3)})`;
  g.lineWidth = 1 / TS * 1.4;
  for (const [rr, a] of [[RO, .9], [RO - 5, .35], [RI, .6], [RI + 4, .25]]) { g.strokeStyle = ink(a); g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.stroke(); }
  for (let i = 0; i < 720; i++) {                                         // outer ticks
    const th = i / 720 * TAU, L = i % 10 ? 6 : 14;
    g.strokeStyle = ink(i % 10 ? .35 : .7); g.beginPath(); g.moveTo(Math.cos(th) * (RO + 3), Math.sin(th) * (RO + 3)); g.lineTo(Math.cos(th) * (RO + 3 + L), Math.sin(th) * (RO + 3 + L)); g.stroke();
  }
  const ACTS = ['完播 100%', '♥ 点赞', '★ 收藏', '↷ 划走', '✕ 不感兴趣', '评论 3', '看了 40%', '↷ 0.8s', '转发', '停留 12s'];
  let th = 0;
  while (th < TAU - .02) {
    const w = (3.2 + 5.5 * r()) * Math.PI / 180, kind = r();
    cc = colored ? CATRGB[catIx(th + w / 2)] : '233,235,239';
    g.save(); g.rotate(th + w / 2);
    g.strokeStyle = ink(.3); g.beginPath(); g.moveTo(RI + 8, -Math.tan(w / 2) * (RI + 8)); g.lineTo(RO - 8, -Math.tan(w / 2) * (RO - 8)); g.stroke();
    const t0 = Math.floor(r() * 6), RS = 9.6, rows = Math.max(2, Math.floor(Math.tan(w / 2) * 2 * RI / RS));
    if (kind < .72) {                                                     // text rows: the log — what you saw and what you did
      g.textBaseline = 'middle';
      for (let k = 0; k < rows; k++) {
        const y = (k - (rows - 1) / 2) * RS, act = ACTS[Math.floor(r() * ACTS.length)];
        g.fillStyle = ink(.5 + .45 * r(), cc);
        g.font = `500 6.2px "Noto Sans SC"`;
        let tt = TITLES[catIx(th)][(t0 + k) % 6];
        while (tt.length > 2 && g.measureText(tt).width > RO - RI - 62) tt = tt.slice(0, -1);
        g.fillText(tt, RI + 12, y);
        g.font = `600 4.6px "JetBrains Mono","Noto Sans SC"`; g.fillStyle = ink(.6, cc);
        g.fillText(act, RO - 46, y);
      }
    } else if (kind < .86) {                                              // dot matrix
      for (let x = RI + 30; x < RO - 30; x += 6) for (let k = 0; k < rows; k++) if (r() < .45) { g.fillStyle = ink(.4 + .5 * r(), cc); g.fillRect(x, (k - (rows - 1) / 2) * RS - 1.6, 3.2, 3.2); }
    } else if (kind < .96) {                                              // bars: watch time per item
      for (let k = 0; k < rows; k++) { g.fillStyle = ink(.25 + .4 * r(), cc); g.fillRect(RI + 16, (k - (rows - 1) / 2) * RS - 1.4, (RO - RI - 40) * Math.pow(r(), 1.5), 2.8); }
    }
    g.restore(); th += w;
  }
  return c;
}
const BAND_DIM = paintBand(.6, false), BAND_LIT = paintBand(1, true);

/* other people: each has 2–4 categories of their own; beams point the same way for the same category everywhere,
   in that category's colour, so every person reads as a different flower */
const CELL = 2600, NEI = 16, PEOPLE = [];
{
  const r = rng(23);
  for (let gx = -NEI; gx <= NEI; gx++) for (let gy = -NEI; gy <= NEI; gy++) {
    if (!gx && !gy) continue;
    const n = 2 + Math.floor(r() * 3), cats = [];
    while (cats.length < n) { const k = Math.floor(r() * 12); if (!cats.includes(k)) cats.push(k); }
    const lines = [];
    cats.forEach((k, m) => { const wgt = 1 - m * .22; for (let q = 0; q < 16; q++) lines.push([k, SECTOR(k) + (r() - .5) * .34, (.3 + .7 * r()) * wgt, .3 + .7 * r()]); });
    const loops = [...Array(9)].map(() => [cats[Math.floor(r() * n)], .6 + .5 * r(), .5 + .6 * r(), r() * Math.PI]);
    const x = (gx + (r() - .5) * .5) * CELL, y = (gy + (r() - .5) * .5) * CELL;
    PEOPLE.push({ x, y, cats, lines, loops, s: .85 + .4 * r(), at: 0 });
  }
}

/* ---------- THE MOMENT · bullet time → snap → ignition wave ----------
   Before the impact the world's own clock slows to 0.12× (thousands of hairlines hang in the air, the cocoon is
   squeezed); on the impact the cocoon bursts, a shockwave of your colours rings out, and the clock runs fast for a
   second to catch up (the frozen lines rush in). The camera rockets back and everyone else's cocoon lights up in a
   wave spreading outward from you. SIM(t) is the world clock; camera, shockwave and the wave use real time. */
const IMPACT = T4 + 3.4;
const SIM = (() => {
  const H = 1 / 240, n = Math.ceil((T6 + 2) / H), tab = new Float64Array(n + 1);
  const slow = (t) => 1 - .88 * smooth(IMPACT - 1.9, IMPACT - .7, t);
  let lag = 0;
  for (let i = 0; i <= n; i++) { const t = i * H; if (t < IMPACT) lag += (1 - slow(t)) * H; }
  const D = 1.1, rate = (t) => (t < IMPACT ? slow(t) : t < IMPACT + D ? 1 + lag * Math.PI / (2 * D) * Math.sin(Math.PI * (t - IMPACT) / D) : 1);
  for (let i = 1; i <= n; i++) tab[i] = tab[i - 1] + rate((i - .5) * H) * H;
  return (t) => { if (t <= 0) return t; const x = t / H, i = Math.min(n - 1, Math.floor(x)); return tab[i] + (tab[i + 1] - tab[i]) * (x - i); };
})();
const SNAP = (t) => (t < IMPACT ? 1 - .2 * smooth(IMPACT - 1.6, IMPACT, t) : 1 + .26 * Math.exp(-(t - IMPACT) / .32) * Math.cos(13 * (t - IMPACT)));
const IGNITE = (d) => IMPACT + .3 + d / 8500;                             // when a person at world distance d lights up
for (const p of PEOPLE) p.at = IGNITE(Math.hypot(p.x, p.y));

/* ---------- camera: [world x at screen centre, world y, zoom] ---------- */
const lz = (a, b, e) => Math.exp(lerp(Math.log(a), Math.log(b), e));
function cam(t) {
  if (t < T1) {                                                           // open close and cropped (the reference frame), then reveal the ring
    const e = cubic(prog(t, 3.6, T1 - .3));
    return [lerp(RO + 330, 0, e), lerp(-40, 0, e), lz(1.9, .78, e)];
  }
  if (t < T2) {                                                           // push into the band on the right side, where the hits land
    const u = t - T1, e = cubic(prog(u, 0, 2)), d = u / DUR.gate;
    return [lerp(0, RO + 80, e), lerp(0, -40 + 70 * d, e), lz(.78, 3.7 + .25 * d, e)];
  }
  if (t < T3) { const u = t - T2, e = cubic(prog(u, 0, 2.4)); return [lerp(RO + 80, 0, e), lerp(30, 0, e), lz(3.95, .8, e) * (1 - .05 * u / DUR.loop)]; }
  if (t < T4) { const u = t - T3, e = cubic(prog(u, 0, 3)); return [0, 0, lz(.76, 1.25, e) * (1 + .05 * u / DUR.cocoon)]; }
  if (t >= T5) return [0, 0, lz(1.15, .5, cubic(prog(t, T5 + .3, T6)))];   // closing: breathe out slowly
  const u = t - T4, back = cubic(prog(u, 7.4, 11.4));
  const pushIn = lz(1.31, 1.85, cubic(prog(u, 0, 3.4)));                  // creep toward the cocoon in bullet time
  const rocket = 1 - Math.pow(1 - prog(u, 3.42, 6), 4);                   // then rocket back the instant it snaps
  const zOut = lz(pushIn, .08, rocket) * (1 + .1 * prog(u, 6, 7.4));
  const sh = u > 3.4 ? 16 / zOut * Math.exp(-(u - 3.4) / .14) : 0;        // a short shake on the impact
  return [sh * Math.sin(97 * u), sh * Math.cos(83 * u), back > 0 ? lz(zOut, 1.15, back) : zOut];
}

/* vertical camera: the opening and the close-up look at the top of the ring (lines fall down the long axis onto the
   band, which sits in the lower middle of the 3:4 card area); from the cocoon on it is the landscape camera, a
   little wider so the ring fits the 1080 px width */
function vcam(t) {
  if (t < T1) { const e = cubic(prog(t, 3.6, T1 - .3)); return [lerp(-30, 0, e), lerp(-500, 0, e), lz(1.9, .8, e)]; }
  if (t < T2) { const u = t - T1, e = cubic(prog(u, 0, 2)), d = u / DUR.gate; return [lerp(0, -30 + 60 * d, e), lerp(0, -440, e), lz(.8, 3.6 + .25 * d, e)]; }
  if (t < T3) { const u = t - T2, e = cubic(prog(u, 0, 2.4)); return [lerp(30, 0, e), lerp(-440, 0, e), lz(3.85, .8, e) * (1 - .05 * u / DUR.loop)]; }
  const [x, y, z] = cam(t), zz = z * .87;
  /* from the push-back on, lift the cocoon to y ≈ 740 so the new (green, down-left) beam leaves the frame at the
     left edge, above the caption and the platform's bottom bar */
  return [x, y + 220 / zz * smooth(T4 + 7.4, T4 + 9.4, t), zz];
}

/* ---------- drawing ---------- */
/* hairlines are batched: one path per (colour, alpha step) and stroked once */
const NA = 8, BUCK = [...Array((3 + 12) * NA)].map(() => []);
function push(col, a, x1, y1, x2, y2) { if (a <= .004) return; BUCK[col * NA + Math.min(NA - 1, Math.floor(a * NA))].push(x1, y1, x2, y2); }
const COLS = ['233,235,239', '185,178,216', '143,227,196', ...CATRGB];   // white, lavender, mint, then the 12 categories
function flush(g, w) {
  g.lineWidth = w;
  for (let i = 0; i < BUCK.length; i++) {
    const L = BUCK[i]; if (!L.length) continue;
    g.strokeStyle = `rgba(${COLS[Math.floor(i / NA)]},${((i % NA + .6) / NA).toFixed(3)})`;
    g.beginPath(); for (let q = 0; q < L.length; q += 4) { g.moveTo(L[q], L[q + 1]); g.lineTo(L[q + 2], L[q + 3]); } g.stroke();
    L.length = 0;
  }
}

function drawWorld(g, tr) {
  const t = SIM(tr), [cx, cy, z] = VIEW.vertical ? vcam(tr) : cam(tr), W = VIEW.W, H = VIEW.H, OY = VIEW.oy || 0;
  const sx = (x) => (x - cx) * z + W / 2, sy = (y) => (y - cy) * z + H / 2 + OY;
  const ox = sx(0), oy = sy(0), k = K(t);
  g.clearRect(0, 0, W, H);
  const crowd = smooth(.6, .22, z);
  if (crowd > 0) drawPeople(g, tr, z, sx, sy, crowd);

  /* incoming hairlines */
  const i0 = firstBorn(t - LIFE), i1 = firstBorn(t) - 1;
  const rc = lerp(RI * .5, COC[0] * .9, TIGHT(t)), hits = [];
  /* in the close-up, the lines say what they are, and the gate says what you did */
  const lab = smooth(2.7, 3.4, z);
  if (lab > 0) labels.length = 0;
  for (let i = i0; i <= i1; i++) {
    const age = t - P.b[i]; if (age < 0) continue;
    const v = P.v[i], th = P.th[i], c = Math.cos(th), s = Math.sin(th);
    const head = R0 - v * age, tail0 = head + P.l[i];
    let a = P.a[i] * (.75 + .5 * k * pnAt(th));
    const cat = catIx(th), col = P.tint[i] ? 0 : 3 + cat;
    if (lab > 0 && i % VIEW.tagEvery === 0 && P.b[i] > T1 + .3 && head > RO - v * .9 && head < RO + 520) labels.push(i, head, age);
    if (P.like[i]) {
      if (tail0 < rc) continue;
      const h = Math.max(head, rc), tl = Math.min(R0, tail0);
      if (h < RO && head > RO - v * .25) hits.push(th, (RO - head) / (v * .25));
      /* outside the band: as is; through and inside: brighter, then dimmer (it becomes part of you) */
      if (tl > RO) push(col, a * edge(tl), sx(c * Math.max(h, RO)), sy(s * Math.max(h, RO)), sx(c * tl), sy(s * tl));
      if (h < RO) { const a2 = Math.min(RO, tl), b2 = Math.max(h, RI); if (a2 > b2) push(3 + cat, Math.min(1, a * 1.8), sx(c * b2), sy(s * b2), sx(c * a2), sy(s * a2)); }
      if (h < RI) push(3 + cat, a * .45, sx(c * h), sy(s * h), sx(c * Math.min(RI, tl)), sy(s * Math.min(RI, tl)));
    } else {
      const tl = Math.min(R0, tail0);                                     // skipped: the head stops at the band, the tail piles in
      if (tl <= RO + 2) continue;
      const h = Math.max(head, RO + 2);
      push(col, a * edge(tl) * (head < RO ? .7 : 1), sx(c * h), sy(s * h), sx(c * tl), sy(s * tl));
    }
  }
  /* strays (mint = something new from outside) */
  strays(t, sx, sy);
  flush(g, clamp(.9 * Math.sqrt(z), .6, 1.4));

  /* the band, lit where you like things (sectors brighten as the loop closes) */
  g.save(); g.translate(ox, oy); g.scale(z / TS, z / TS);
  g.drawImage(BAND_DIM, -TEX / 2, -TEX / 2);
  const lit = smooth(T1 + 3, T3, t);
  if (lit > 0) {
    g.save(); g.beginPath();
    for (let i = 0; i < 180; i++) {
      const th = (i + .5) / 180 * TAU, p = pnAt(th); if (p < .25) continue;
      const a0 = i / 180 * TAU, a1 = (i + 1) / 180 * TAU, R = (RO + 70) * TS;
      g.moveTo(0, 0); g.arc(0, 0, R, a0, a1); g.closePath();
    }
    g.clip(); g.globalAlpha = lit; g.drawImage(BAND_LIT, -TEX / 2, -TEX / 2); g.restore();
  }
  const open = smooth(CRACK.t + .4, CRACK.t + 2.4, t);
  if (open > 0) {                                                         // the band lights up where the crack opens, in that category's colour
    g.save(); g.globalCompositeOperation = 'lighter'; g.beginPath();
    const w = .3 * open, R = (RO + 70) * TS;
    g.moveTo(0, 0); g.arc(0, 0, R, CRACK.th - w, CRACK.th + w); g.closePath(); g.clip();
    g.globalAlpha = .9 * open; g.drawImage(BAND_LIT, -TEX / 2, -TEX / 2); g.restore();
  }
  g.restore();
  /* hit flashes: a liked item lights a short bar inside the band (the bright blocks of the reference) */
  g.lineWidth = Math.max(1, 2.2 * z);
  for (let q = 0; q < hits.length; q += 2) {
    const th = hits[q], f = 1 - hits[q + 1], c = Math.cos(th), s = Math.sin(th);
    push(3 + catIx(th), .95 * f, sx(c * (RO - 4)), sy(s * (RO - 4)), sx(c * (RO - 4 - 60 * f)), sy(s * (RO - 4 - 60 * f)));
  }
  flush(g, Math.max(1, 2 * z));

  drawInside(g, t, z, sx, sy, tr);
  if (lab > 0) drawLabels(g, lab, sx, sy, SIM(Math.floor(tr * 30 + 1e-4) / 30));
  LIGHT.dot(g, ox, oy, Math.max(2, 7 * z), '#FFFFFF', .9);
  /* the snap: rings of your colours and a flash */
  const da = tr - IMPACT;
  if (da > 0 && da < 1.6) {
    g.save(); g.globalCompositeOperation = 'lighter';
    MINE.forEach((kk, m) => {
      const e = expoOut(clamp((da - m * .07) / 1.3)), rr = (COC[0] * 1.2 + 5200 * e) * z, a = (1 - e) * .9;
      if (a <= 0 || rr <= 0) return;
      g.strokeStyle = `rgba(${CATRGB[kk]},${a.toFixed(3)})`; g.lineWidth = Math.max(1, 6 * (1 - e));
      g.beginPath(); g.arc(ox, oy, rr, 0, TAU); g.stroke();
    });
    g.fillStyle = `rgba(255,255,255,${(.32 * Math.exp(-da / .09)).toFixed(3)})`; g.fillRect(0, 0, W, H);
    g.restore();
  }
  LIGHT.glow(g, { strength: .45, threshold: .72, radius: 24 });
  /* keep the caption readable: darken what is behind it (the subject stays above y 900) */
  if (!VIEW.vertical) {
    const cg = g.createLinearGradient(0, 860, 0, 1080);
    cg.addColorStop(0, 'rgba(6,6,7,0)'); cg.addColorStop(.45, 'rgba(6,6,7,.78)'); cg.addColorStop(1, 'rgba(6,6,7,.9)');
    g.fillStyle = cg; g.fillRect(0, 860, 1920, 220);
  } else {                                                                // vertical: a soft band behind the caption only
    const [y0, y1] = VIEW.dim, cg = g.createLinearGradient(0, y0, 0, y1);
    cg.addColorStop(0, 'rgba(6,6,7,0)'); cg.addColorStop(.35, 'rgba(6,6,7,.8)'); cg.addColorStop(.7, 'rgba(6,6,7,.8)'); cg.addColorStop(1, 'rgba(6,6,7,0)');
    g.fillStyle = cg; g.fillRect(0, y0, W, y1 - y0);
  }
}
const edge = (r) => smooth(R0, R0 - 500, r);
const labels = [];
const LIKES = ['♥ 点赞', '★ 收藏', '✓ 看完'], SKIPS = ['↷ 划走 0.8s', '↷ 划走 1.2s', '✕ 不感兴趣', '↷ 看了 3 秒'];
/* tq = the world clock at the start of this video frame: tags hold still across the motion-blur sub-frames, so the
   lines blur but the text stays sharp */
function drawLabels(g, lab, sx, sy, tq) {
  g.save(); g.textBaseline = 'alphabetic';
  const taken = [];                                                       // no two tags on top of each other
  for (let q = 0; q < labels.length; q += 3) {
    const i = labels[q], head = R0 - P.v[i] * (tq - P.b[i]), th = P.th[i], c = Math.cos(th), s = Math.sin(th);
    const hit = head <= RO, dt = hit ? (RO - head) / P.v[i] : 0;          // seconds since it reached the gate
    const at = Math.max(head, RO + 6), x = sx(c * at), y = sy(s * at) - 12;
    let a = lab * smooth(RO + 520, RO + 380, head) * (hit ? 1 - smooth(.45, .9, dt) : 1);
    const flip = VIEW.tagFlip && x > VIEW.W / 2;
    if (a <= .01 || y < VIEW.tag[0] || y > VIEW.tag[1] || (!flip && x > VIEW.tagX)) continue;   // never under the caption or the side buttons
    if (taken.some(([tx, ty]) => Math.abs(tx - x) < 300 && Math.abs(ty - y) < 64)) continue;
    taken.push([x, y]);
    const tx = flip ? x - 8 : x + 8;
    g.textAlign = flip ? 'right' : 'left';
    g.font = `500 ${VIEW.tagFont}px "Noto Sans SC"`;
    if (VIEW.vertical) {                                                  // the whole tag must sit inside x 20 … W − 150
      const w = g.measureText(titleOf(th, i)).width, l = flip ? tx - w : tx;
      if (l < 20 || l + w > VIEW.W - 150) { taken.pop(); continue; }
    }
    g.fillStyle = `rgba(233,235,239,${(a * (hit && !P.like[i] ? .55 : .95)).toFixed(3)})`;
    g.fillText(titleOf(th, i), tx, y);
    g.font = `600 ${Math.round(VIEW.tagFont * .7)}px "JetBrains Mono","Noto Sans SC"`;
    const tag = !hit ? catOf(th) : P.like[i] ? LIKES[i % 3] : SKIPS[i % 4], cc = CATRGB[catIx(th)];
    g.fillStyle = hit && !P.like[i] ? `rgba(138,141,148,${a.toFixed(3)})` : `rgba(${cc},${a.toFixed(3)})`;
    g.fillText(tag, tx, y + VIEW.tagFont + 2);
  }
  g.restore();
}

function drawInside(g, t, z, sx, sy, tr) {
  const sq = SNAP(tr), T = TIGHT(t), spin = .1 * t, cs = Math.cos(spin), sn = Math.sin(spin);
  const crack = smooth(CRACK.t + .2, CRACK.t + 1.8, t), ca = CRACK.th;
  for (const th of THR) {
    const w = clamp((t - th.at) / .8); if (w <= 0) continue;
    const rx = lerp(th.wide, COC[0] * th.tight, T) * sq, ry = lerp(th.wide, COC[1] * th.tight, T) * sq;
    const ofx = th.off[0] * (1 - T), ofy = th.off[1] * (1 - T), n = 56, end = Math.ceil(n * w * lerp(th.span, 1, T));
    let px, py;
    for (let q = 0; q <= end; q++) {
      const a = th.ph + q / n * TAU, c = Math.cos(a), s = Math.sin(a);
      let x = c * th.e1[0] + s * th.e2[0], y = c * th.e1[1] + s * th.e2[1], zz = c * th.e1[2] + s * th.e2[2];
      [x, zz] = [x * cs + zz * sn, -x * sn + zz * cs];
      const X = sx(ofx + x * rx), Y = sy(ofy + y * ry);
      if (q) {
        let al = th.a * (.45 + .55 * (zz + 1) / 2) * lerp(1, 1.5, T);
        if (crack > 0) { const d = Math.abs(Math.atan2(Math.sin(Math.atan2(y, x) - ca), Math.cos(Math.atan2(y, x) - ca))); al *= smooth(.04, .08 + .34 * crack + .9 * smooth(T5, T6 - 2, t), d); }
        push(3 + th.cat, al, px, py, X, Y);
      }
      px = X; py = Y;
    }
  }
  flush(g, clamp(.85 * Math.sqrt(z), .6, 1.3));
}

/* hand-placed mint lines: one skipped at the band (cocoon shot), one let in that cracks the cocoon (the ending) */
const STRAY = { th: SECTOR(8), t: T3 + 6.4 }, CRACK = { th: SECTOR(4), t: T4 + 10.2 };   // 穿搭 is skipped; 健身 (the hue furthest from yours) gets in
function strays(t, sx, sy) {
  for (const [S, letIn] of [[STRAY, false], [CRACK, true]]) {
    const v = 1500, a0 = S.t - (R0 - RO) / v, c = Math.cos(S.th), s = Math.sin(S.th);
    if (t < a0 || t > S.t + 4) continue;
    const head = R0 - v * (t - a0);
    for (let q = 0; q < 9; q++) {                                         // a thin bundle reads better than one line
      const o = (q - 4) * .005, cc = Math.cos(S.th + o), ss = Math.sin(S.th + o);
      if (letIn) { const h = Math.max(head, COC[0] * .6), tl = Math.min(R0, head + 1100); if (tl > h) push(3 + catIx(S.th), .95, sx(cc * h), sy(ss * h), sx(cc * tl), sy(ss * tl)); }
      else { const h = Math.max(head, RO + 2), tl = Math.min(R0, head + 1100); if (tl > h) push(3 + catIx(S.th), .95 * smooth(S.t + 1.2, S.t, t), sx(cc * h), sy(ss * h), sx(cc * tl), sy(ss * tl)); }
    }
  }
  /* after the crack: the world on that side comes back — mint lines leaking outward */
  const inflow = smooth(T5 - .5, T5 + 2.5, t);
  if (inflow > 0) {                                                       // the world on that side flows in again
    const r = rng(91);
    for (let q = 0; q < 900; q++) {
      const th = CRACK.th + (r() - .5) * (.4 + .9 * smooth(T5, T6 - 2, t)), v = 500 + 500 * r(), L = 120 + 700 * r() * r();
      const h = COC[0] * .8 + (R0 - COC[0]) * (1 - (((t - T5) * v / R0 + r()) % 1)), c = Math.cos(th), s = Math.sin(th);
      push(r() < .85 ? 3 + catIx(th) : 0, (.3 + .6 * r()) * inflow * edge(h + L) * smooth(COC[0] * .8, COC[0] * 2, h), sx(c * h), sy(s * h), sx(c * (h + L)), sy(s * (h + L)));
    }
  }
  const open = smooth(CRACK.t + .4, CRACK.t + 2.6, t);
  if (open > 0) {
    const r = rng(77);
    for (let q = 0; q < 700; q++) {
      const th = CRACK.th + (r() - .5) * .55 * Math.sqrt(open), v = 900 + 700 * r(), ph = r(), L = 150 + 700 * r() * r();
      const h = COC[0] * .7 + ((v * (t - CRACK.t) + ph * 2600) % 2600) * open, c = Math.cos(th), s = Math.sin(th);
      push(r() < .8 ? 3 + catIx(th) : 0, (.35 + .65 * r()) * open * edge(h + L), sx(c * h), sy(s * h), sx(c * (h + L)), sy(s * (h + L)));
    }
  }
}

function drawPeople(g, t, z, sx, sy, crowd) {
  const pad = 200, Rb = 950, named = [];
  for (const p of PEOPLE) {
    const x = sx(p.x), y = sy(p.y);
    const ig = smooth(p.at, p.at + .5, t), R = Rb * z * p.s * (.15 + .85 * expoOut(ig));
    if (x < -R - pad || x > VIEW.W + R + pad || y < -R - pad || y > VIEW.H + R + pad) continue;
    if (ig <= 0) { LIGHT.dot(g, x, y, Math.max(1.2, COC[0] * .3 * z * p.s), '#8A8D94', .5 * crowd); continue; }   // not lit yet: a grey dot
    if (ig < 1) { const e = clamp((t - p.at) / .7); g.strokeStyle = `rgba(${CATRGB[p.cats[0]]},${((1 - e) * .8 * crowd).toFixed(3)})`; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, Math.max(6, COC[0] * z * p.s) * (1 + 3 * e), 0, TAU); g.stroke(); }
    const ro = Math.max(4, RO * .55 * z * p.s);
    for (const [k, a, len, al] of p.lines) {
      const c = Math.cos(a), s = Math.sin(a), L = ro + (R - ro) * len;
      push(3 + k, al * .75 * crowd * ig, x + c * ro, y + s * ro, x + c * L, y + s * L);
    }
    const cr = Math.max(5, COC[0] * .9 * z * p.s);                       // the cocoon: a few loops in this person's colours
    g.lineWidth = 1.1;
    for (const [k, rx, ry, rot] of p.loops) {
      g.strokeStyle = `rgba(${CATRGB[k]},${(.7 * crowd * ig).toFixed(3)})`;
      g.beginPath(); g.ellipse(x, y, cr * rx, cr * ry, rot + .1 * t, 0, TAU); g.stroke();
    }
    LIGHT.dot(g, x, y, Math.max(1.5, cr * .3), '#FFFFFF', .8 * crowd);
    if (ig > .9) named.push([Math.hypot(x - VIEW.W / 2, y - VIEW.H / 2), x, y + cr * 1.3 + 26, p.cats]);
  }
  flush(g, 1);
  /* name a few of them: everyone keeps different things */
  if (z < .5) {
    g.save(); g.font = '500 20px "Noto Sans SC"'; g.textAlign = 'left';
    const [cx0, cx1, cy0, cy1] = VIEW.crowd, [bx0, bx1, by0, by1] = VIEW.title;
    const shown = named.filter(([, x, y]) => x > cx0 && x < cx1 && y > cy0 && y < cy1 && !(x > bx0 && x < bx1 && y > by0 && y < by1))
      .sort((a, b) => a[0] - b[0]);
    const taken = [[VIEW.W / 2, VIEW.H / 2 + 140]];                                      // keep clear of you, and of each other
    let n = 0;
    for (const [, x, y, cats] of shown) {
      const parts = cats.map((k) => CATS[k]), w = parts.reduce((s, q) => s + g.measureText(q).width, 0) + (parts.length - 1) * 22;
      if (n >= 7 || taken.some(([tx, ty]) => Math.abs(tx - x) < w / 2 + 150 && Math.abs(ty - y) < 46)) continue;
      taken.push([x, y]); n++;
      let cx = x - w / 2;
      parts.forEach((q, m) => {
        g.fillStyle = `rgba(${CATRGB[cats[m]]},${(.95 * crowd).toFixed(3)})`; g.fillText(q, cx, y); cx += g.measureText(q).width;
        if (m < parts.length - 1) { g.fillStyle = `rgba(138,141,148,${(.8 * crowd).toFixed(3)})`; g.fillText(' · ', cx, y); cx += 22; }
      });
    }
    g.restore();
  }
}


/* the first items to touch the band get a soft tick each (computed from the particles themselves) */
const FIRST_HITS = [];
{ const xs = [];                                                          // only hits inside the opening frame, ≥ 0.35 s apart
  for (let i = 0; i < NP && P.b[i] < 2; i++) { const x = P.b[i] + (R0 - RO) / P.v[i]; if (x > .3 && x < 3.4 && Math.abs(P.th[i] - VIEW.early) < .3) xs.push(x); }
  for (const x of xs.sort((a, b) => a - b)) if (!FIRST_HITS.length || x - FIRST_HITS[FIRST_HITS.length - 1] >= .35) FIRST_HITS.push(+x.toFixed(2)); }
/* the day count is held per frame (floor to 1/30 s) so motion-blur sub-frames never blend two numbers */
const DAY = (t) => Math.round(1 + 179 * Math.pow(K(Math.floor(t * 30 + 1e-4) / 30), 1.6));
const fade = (el, u, a, b, c, d) => { el.style.opacity = Math.min(smooth(a, b, u), 1 - smooth(c, d, u)); };
/* the backdrop's light: fades up, dims under the title card, fades out */
const worldOpacity = (t) => Math.min(expoOut(prog(t, 0, .4)), 1 - cubic(prog(t, T6 - 1.4, T6))) * (1 - .7 * smooth(T6 - 4.6, T6 - 3.4, t));

/* captions, shared by both cuts (local seconds within each shot) */
const CAPS = {
  flood: [[.4, '一条信息，飞向你。'], [3.1, '每天，成千上万条。'], [5.7, '你刷到什么，多半由推荐决定。']],
  gate: [[.6, '每一条，都要经过你这道「闸门」。'], [4.4, '看完、点赞、收藏：这一类被加权。'], [8.4, '划走、点「不感兴趣」：这一类被降权。']],
  loop: [[.6, '你的反馈回到系统，下一批就更像上一批。'], [5.6, '这叫「反馈闭环」。'], [8.6, '来路，一天比一天窄。']],
  cocoon: [[.4, '最后，你看到的九成以上，'], [3.5, '都来自你点过赞的那几类。'], [6.6, '新东西还在，只是很少能进来。']],
  many: [[.5, '这层壳，叫「信息茧房」。'], [4.4, '每个人，都住在自己的那一个里。'], [8.6, '下次，点开那条你本来会划走的。']],
  end: [[.6, '茧是一根一根织起来的，'], [3.6, '也能一根一根拆开。']],
};

export { CAPS, B, DUR, T1, T2, T3, T4, T5, T6, ACC, INK, INK2, BG, TAU, smooth, STRAY, CRACK, IMPACT, drawWorld, FIRST_HITS, DAY, fade, worldOpacity };
