/* 信息茧房 · 9:16 cut. The world, timeline and captions come from world.js (shared with the landscape film), so the
   landscape sound mix (cues.json + score.wav) lines up frame for frame. This page only lays out the frame. */
import './light.js';
import { DUR, T6, CAPS, drawWorld, DAY, fade, worldOpacity, FIRST_HITS } from './world.js';
window.__firstHits = FIRST_HITS;                                          // exposed so the sound sync can be checked

const ORDER = ['flood', 'gate', 'loop', 'cocoon', 'many', 'end'];
const START = {}; { let s = 0; for (const id of ORDER) { START[id] = s; s += DUR[id]; } }
const g = $('cv').getContext('2d'), cap = $('cap');
const capHTML = (x) => x.replace(/「(.+?)」/g, '“<em>$1</em>”');
let lastCap = null;
function captions(t) {
  const id = ORDER.findLast((k) => t >= START[k]), u = t - START[id];
  let text = null, at = 0;
  for (const [a, x] of CAPS[id]) if (u >= a) { text = x; at = a; }
  if (text == null) { cap.style.opacity = 0; return; }
  if (text !== lastCap) { cap.innerHTML = capHTML(text); lastCap = text; }
  const p = expoOut(prog(u, at, at + .45));
  cap.style.opacity = p; cap.style.transform = `translateY(${(1 - p) * 14}px)`;
}
const L = Object.fromEntries(['fl-l', 'lp-d', 'lp-s', 'cc-n', 'cc-s', 'mn-t', 'mn-s', 'en-t', 'en-s'].map((k) => [k, $(k)]));
const dayNum = L['lp-d'].querySelector('span');
function labels(t) {
  const u = (id) => t - START[id], d = (id) => DUR[id], on = (id) => t >= START[id] && t < START[id] + DUR[id];
  const f = (k, id, a, b, c, e) => { if (on(id)) fade(L[k], u(id), a, b, c, e); else L[k].style.opacity = 0; };
  f('fl-l', 'flood', 6, 6.6, d('flood') - .5, d('flood'));
  f('lp-d', 'loop', 1.6, 2.4, d('loop') - .6, d('loop')); f('lp-s', 'loop', 1.8, 2.6, d('loop') - .6, d('loop'));
  dayNum.textContent = DAY(t);
  f('cc-n', 'cocoon', .8, 1.6, 5.4, 6); f('cc-s', 'cocoon', 1.1, 1.9, 5.4, 6);
  f('mn-t', 'many', 5.2, 5.9, 7.2, 7.7); f('mn-s', 'many', 5.5, 6.2, 7.2, 7.7);
  f('en-t', 'end', 5.4, 6.3, d('end') + 1, d('end') + 2); f('en-s', 'end', 5.8, 6.7, d('end') + 1, d('end') + 2);
}
LV.start({
  duration: T6, width: 1080, height: 1920, scenes: [['vroot', 0, T6]],
  render: { vroot(t) { drawWorld(g, t); $('cv').style.opacity = worldOpacity(t); captions(t); labels(t); } },
});
