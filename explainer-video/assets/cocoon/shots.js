/* 信息茧房是怎么织成的 · landscape page (EX framework). The world itself — hairlines, band, cocoon, crowd, the
   bullet-time climax — lives in world.js and is shared with the 9:16 cut (vertical.js). This file only adds the EX
   chapters, captions, sound cues and the DOM labels. */
import './light.js';
import { B, DUR, T1, T2, T3, T4, T5, T6, IMPACT, ACC, INK, INK2, BG, STRAY, CRACK, drawWorld, FIRST_HITS, DAY, fade, worldOpacity, CAPS } from './world.js';
EX.tempo(96);

EX.chapter('gate', { name: '闸门', color: ACC });
EX.chapter('loop', { name: '反馈闭环', color: ACC });
EX.chapter('cocoon', { name: '信息茧房', color: ACC });

document.head.insertAdjacentHTML('beforeend', `<style>
  #stage.theme-dark{--hud-ink:${INK};--hud-ink2:${INK2};background:${BG}}
  #bg{display:none}
  #stage.chrome-cinema #cap-pill{font-weight:400;font-size:36px;letter-spacing:.08em;bottom:70px}
  .fb-label{position:absolute;font:500 22px/1.3 'JetBrains Mono','Noto Sans SC',monospace;letter-spacing:.14em;color:${INK2};white-space:nowrap;text-shadow:0 0 14px #000,0 0 4px #000}
  .fb-label b{color:${INK};font-weight:600}
  .fb-big{position:absolute;font:200 168px/1 'Inter Tight',sans-serif;color:${INK};letter-spacing:-.02em;white-space:nowrap;text-shadow:0 0 30px #000,0 0 8px #000}
  .fb-big small{font:500 40px 'Noto Sans SC',sans-serif;color:${INK2};letter-spacing:.1em;margin:0 .3em}
  .fb-title{position:absolute;font:900 128px/1 'Noto Sans SC',sans-serif;letter-spacing:.2em;color:${INK};white-space:nowrap;text-shadow:0 0 40px #000,0 0 90px #000}
</style>`);

EX.backdrop({
  subject: true,
  html: '<canvas width="1920" height="1080" style="position:absolute;left:0;top:0;width:1920px;height:1080px"></canvas>',
  init(el) { this.g = el.querySelector('canvas').getContext('2d'); },
  render(el, t) {
    drawWorld(this.g, t);
    el.querySelector('canvas').style.opacity = worldOpacity(t);
  },
});

/* ---------- shots: captions, sound, one label each ---------- */
EX.shot({
  id: 'flood', chapter: null, hud: false, dur: DUR.flood, amb: 'hum',
  caps: CAPS.flood,
  sfx: [...FIRST_HITS.map((x) => [x, 'tick', .3]), [4.6, 'swoosh-soft', .4], [6.2, 'whoosh', .3]],
  html: `<div class="fb-label" id="fl-l" style="left:0;width:1920px;top:196px;text-align:center"><b>70%+</b>  YouTube 观看时长来自推荐 · 2018</div>`,
  init(el) { this.l = el.querySelector('#fl-l'); },
  render(el, u, d) { fade(this.l, u, 6, 6.6, d - .5, d); },
});

EX.shot({
  id: 'gate', enter: 'cut', chapter: 'gate', hud: false, dur: DUR.gate, amb: 'hum',
  caps: CAPS.gate,
  sfx: [[.1, 'whoosh', .35], [4.9, 'blip', .35], [5.5, 'blip', .3], [6.2, 'blip', .32], [8.9, 'paper', .35], [9.7, 'paper', .3], [10.5, 'paper', .28]],
  html: '',
});

EX.shot({
  id: 'loop', enter: 'cut', chapter: 'loop', hud: false, dur: DUR.loop, amb: 'hum',
  caps: CAPS.loop,
  sfx: [[.2, 'whoosh', .3], ...[...Array(12)].map((_, i) => [1.4 + i * B(1.5), 'tick', .18])],
  html: `<div class="fb-big" id="lp-d" style="left:110px;top:400px"><small>第</small><span>1</span><small>天</small></div><div class="fb-label" id="lp-s" style="left:122px;top:590px">示意</div>`,
  init(el) { this.d = el.querySelector('#lp-d'); this.s = el.querySelector('#lp-s'); this.n = this.d.querySelector('span'); },
  render(el, u, d, t) { this.n.textContent = DAY(t); fade(this.d, u, 1.6, 2.4, d - .6, d); fade(this.s, u, 1.8, 2.6, d - .6, d); },
});

EX.shot({
  id: 'cocoon', enter: 'cut', chapter: 'cocoon', hud: false, dur: DUR.cocoon, amb: 'hum',
  caps: CAPS.cocoon,
  hush: [[4.9, 6.3]], sfx: [[STRAY.t - T3, 'glass', .55]],
  html: `<div class="fb-big" id="cc-n" style="left:110px;top:640px">≈95%</div><div class="fb-label" id="cc-s" style="left:122px;top:830px">来自你点过赞的那几类 · 示意</div>`,
  init(el) { this.n = el.querySelector('#cc-n'); this.s = el.querySelector('#cc-s'); },
  render(el, u) { fade(this.n, u, .8, 1.6, 5.4, 6); fade(this.s, u, 1.1, 1.9, 5.4, 6); },
});

EX.shot({
  id: 'many', enter: 'cut', chapter: 'cocoon', hud: false, dur: DUR.many, amb: 'hum',
  caps: CAPS.many,
  sfx: [[3.4, 'riser', .45], [3.4, 'impact', .55], [3.5, 'whoosh', .45], [5.2, 'reveal', .3], [CRACK.t - T4, 'chime', .45], [CRACK.t - T4 + .3, 'glass', .3]],
  html: `<div class="fb-title" id="mn-t" style="left:0;width:1920px;top:410px;text-align:center">信息茧房</div>
    <div class="fb-label" id="mn-s" style="left:0;width:1920px;top:576px;text-align:center">INFORMATION COCOONS · SUNSTEIN · 2006</div>`,
  init(el) { this.t = el.querySelector('#mn-t'); this.s = el.querySelector('#mn-s'); },
  render(el, u) { fade(this.t, u, 5.2, 5.9, 7.2, 7.7); fade(this.s, u, 5.5, 6.2, 7.2, 7.7); },
});

EX.shot({
  id: 'end', enter: 'cut', chapter: 'cocoon', hud: false, dur: DUR.end, amb: 'hum',
  caps: CAPS.end,
  sfx: [[5.4, 'chime', .35]],
  html: `<div class="fb-title" id="en-t" style="left:0;width:1920px;top:430px;text-align:center;font-size:92px;letter-spacing:.16em">信息茧房是怎么织成的</div>
    <div class="fb-label" id="en-s" style="left:0;width:1920px;top:560px;text-align:center">SUNSTEIN 2006 · 数字为示意</div>`,
  init(el) { this.t = el.querySelector('#en-t'); this.s = el.querySelector('#en-s'); },
  render(el, u, d) { fade(this.t, u, 5.4, 6.3, d + 1, d + 2); fade(this.s, u, 5.8, 6.7, d + 1, d + 2); },
});

/* picture events for the score: render.mjs --cues-out copies this into cues.json "events"; compose_score.py reads it */
window.__events = { impact: IMPACT, crack: CRACK.t, stray: STRAY.t, firstHits: FIRST_HITS };

EX.run({ theme: 'dark', chrome: 'cinema', post: { vignette: .35, grain: 5 }, composition: 'cinema', mood: 'pulse', rate: null, bgm_gain: .85, amb_gain: .6 });
