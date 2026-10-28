/* flow.js — particles, flows and cascades as pure functions of t (extracted from assets/cocoon/world.js).
   Load: ES module, in shots.js:  import { makePool, makeSampler, makeStroker, makeClock, makeCascade } from './flow.js';
   Randomness only from rng(seed) (engine.js global, or inject one with useRng(fn)); nothing is carried between frames,
   so any frame renders alone. Every function gives each subsystem its OWN rng stream.

   API
     makePool({ rate(t), speed(b, u), dir(u, b), seed, t0, t1, extra(r, b) })
         Particles born over [t0, t1) at a time-varying rate (per second), gaps = (.5 + r) / rate(b): a trickle you can
         follow one by one that swells to a flood. Direction, speed and extras are fixed at birth.
         dir(u, b) → angle (u uniform 0–1; use a sampler for a moving distribution); speed(b, u) → px/s;
         extra(r, b) → { l: .., a: .. } one number per key per particle, stored as Float32Array under that key.
         Returns { n, b (births, Float64Array, sorted), th, v, ...extras, alive(t, life) → [i0, i1) }:
         alive = particles born in [t - life, t) — binary search, a frame walks only the live ones.
     makeSampler(weights[], k) → (u, t) → angle
         Direction by inverse CDF of (1 - k) * uniform + k * target, target ∝ weights (bins around the circle).
         k = number or k(t) in 0–1: 0 = every direction, 1 = only the target. Narrowing over time = k rising.
     makeStroker(colors[], steps = 8) → { push(ci, a, x1, y1, x2, y2), flush(g, width) }
         Segments of one colour and one alpha step become ONE path and ONE stroke (tens of thousands of lines in real
         time). colors: 'r,g,b' strings or '#rrggbb'; a in 0–1 (quantised to `steps`).
     makeClock({ slowAt, slowTo = .12, slowDur = 1.9, catchUp = 1.1 }) → simT = (t) => world time
         Bullet-time world clock: rate falls to slowTo over the last slowDur s before slowAt (the impact), then runs
         fast for catchUp s so simT(t) == t again afterwards. Closed form: monotone, exact catch-up, any frame alone.
         Use simT(t) for the particles, the real t for camera, shockwave and captions.
     makeCascade({ seed, root = [0, 0], branching(gen), generations, spread, delay(gen, r), t0 = 0, maxNodes = 20000 })
         Tree of rumour / retweet / infection. branching(gen) = children per node of generation gen (fractions are
         resolved randomly); each generation sits one ring further out (distance ≈ spread, jittered), angle = away from
         the root ± jitter; child time = parent time + delay(gen_of_child, r). Returns { nodes, times (sorted),
         active(t) → count activated by t, generations }; node = { id, x, y, gen, t, parent }.

   Example (a flow that narrows, then a bullet-time hit at 20 s; ≈ the cocoon opening):
     const sim = makeClock({ slowAt: 20 });
     const dir = makeSampler(WEIGHTS, (t) => Math.min(1, t / 20));
     const pool = makePool({ rate: (t) => 3 + 60 * t, speed: (b, u) => 500 + 300 * u, dir: (u, b) => dir(u, b), seed: 5, t0: -5, t1: 30,
                             extra: (r) => ({ len: 80 + 400 * r * r }) });
     const S = makeStroker(['233,235,239', '143,227,196']);
     function draw(g, t) {                                  // g: canvas 2d, origin at the subject
       const st = sim(t), [i0, i1] = pool.alive(st, 10);
       for (let i = i0; i < i1; i++) { const d = 1500 - pool.v[i] * (st - pool.b[i]); if (d < 0) continue;
         S.push(i % 2, .5, Math.cos(pool.th[i]) * d, Math.sin(pool.th[i]) * d, Math.cos(pool.th[i]) * (d + pool.len[i]), Math.sin(pool.th[i]) * (d + pool.len[i])); }
       S.flush(g, 1);
     }

   Pitfalls (each cost a real iteration)
     - A Float32Array value compared with a double is almost never equal: `tu > inf[u]` with a Float32 inf was always
       true and a cascade never spread (looked like a single red dot). Compare in one type: Math.fround(x) on the double,
       or keep times in Float64Array / plain numbers (births and cascade times here are Float64).
     - One rng(seed) per subsystem. Sharing one stream means changing a parameter in one place shifts every later draw:
       key nodes, arrival times and the score's event times all move, and everything must be re-checked and re-exported.
       Here the pool uses two streams (births, attributes) and the cascade has its own; give each of yours a seed.
     - The rate must be > 0 wherever the pool is alive (a zero rate never advances the birth loop; a floor of 1e-3 is applied).
     - Expose the key times (impact, first arrivals) via window.__events so the score reads them from cues.json
       (render.mjs --cues-out) instead of re-deriving them.
*/
const TAU = Math.PI * 2;
let injected = null;
export function useRng(fn) { injected = fn; }                       // node tests / no engine.js: inject rng(seed)
const R = (seed) => {
  const f = injected || globalThis.rng;
  if (!f) throw new Error('flow.js needs rng(seed): load engine.js first or call useRng(fn)');
  return f(seed);
};

export function makePool({ rate, speed, dir, seed = 1, t0 = 0, t1 = 10, extra }) {
  const births = [];
  const rb = R(seed);
  for (let b = t0; b < t1; b += (.5 + rb()) / Math.max(1e-3, rate(b))) births.push(b);
  const n = births.length;
  const pool = { n, b: Float64Array.from(births), th: new Float32Array(n), v: new Float32Array(n) };
  const r = R(seed + 1000003);
  for (let i = 0; i < n; i++) {
    const b = births[i];
    pool.th[i] = dir(r(), b);
    pool.v[i] = speed(b, r());
    if (extra) {
      const e = extra(r, b);
      for (const k in e) { if (!pool[k]) pool[k] = new Float32Array(n); pool[k][i] = e[k]; }
    }
  }
  const firstBorn = (t) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (pool.b[m] < t) lo = m + 1; else hi = m; } return lo; };
  pool.alive = (t, life) => [firstBorn(t - life), firstBorn(t)];
  return pool;
}

export function makeSampler(weights, k = 1) {
  const nb = weights.length, end = new Float64Array(nb + 1);
  let sum = 0; for (const w of weights) sum += w;
  for (let i = 0; i < nb; i++) end[i + 1] = end[i] + weights[i] / sum;     // target CDF at bin edges
  const kf = typeof k === 'function' ? k : () => k;
  return (u, t = 0) => {
    const kk = Math.min(1, Math.max(0, kf(t)));
    let lo = 0, hi = 1;
    for (let it = 0; it < 24; it++) {
      const x = (lo + hi) / 2, j = Math.min(nb - 1, Math.floor(x * nb));
      const fe = end[j] + (x * nb - j) * (end[j + 1] - end[j]);
      if ((1 - kk) * x + kk * fe < u) lo = x; else hi = x;
    }
    return (lo + hi) / 2 * TAU;
  };
}

export function makeStroker(colors, steps = 8) {
  const cols = colors.map((c) => {
    if (c[0] !== '#') return c;
    const v = parseInt(c.slice(1), 16);
    return `${v >> 16},${(v >> 8) & 255},${v & 255}`;
  });
  const buck = [...Array(cols.length * steps)].map(() => []);
  return {
    push(ci, a, x1, y1, x2, y2) {
      if (a <= .004) return;
      buck[ci * steps + Math.min(steps - 1, Math.floor(a * steps))].push(x1, y1, x2, y2);
    },
    flush(g, width) {
      g.lineWidth = width;
      for (let i = 0; i < buck.length; i++) {
        const L = buck[i]; if (!L.length) continue;
        g.strokeStyle = `rgba(${cols[Math.floor(i / steps)]},${((i % steps + .6) / steps).toFixed(3)})`;
        g.beginPath();
        for (let q = 0; q < L.length; q += 4) { g.moveTo(L[q], L[q + 1]); g.lineTo(L[q + 2], L[q + 3]); }
        g.stroke();
        L.length = 0;
      }
    },
  };
}

export function makeClock({ slowAt, slowTo = .12, slowDur = 1.9, catchUp = 1.1 }) {
  const a = slowAt - slowDur, b = a + .6 * slowDur, d = 1 - slowTo, D = catchUp;
  const lag = d * ((b - a) / 2 + (slowAt - b));                             // how far the world clock is behind at slowAt
  return (t) => {
    if (t <= a) return t;
    if (t < b) { const p = (t - a) / (b - a); return t - d * (b - a) * (p ** 3 - p ** 4 / 2); }
    if (t <= slowAt) return t - d * ((b - a) / 2 + (t - b));
    const s = t - slowAt;
    return s >= D ? t : slowAt - lag + s + lag * (1 - Math.cos(Math.PI * s / D)) / 2;
  };
}

export function makeCascade({ seed = 1, root = [0, 0], branching, generations, spread, delay, t0 = 0, maxNodes = 20000 }) {
  const r = R(seed);
  const nodes = [{ id: 0, x: root[0], y: root[1], gen: 0, t: t0, parent: -1 }];
  let frontier = [0];
  for (let g = 1; g <= generations && nodes.length < maxNodes; g++) {
    const next = [];
    for (const pi of frontier) {
      const p = nodes[pi];
      const want = branching(g - 1), cnt = Math.floor(want) + (r() < want - Math.floor(want) ? 1 : 0);
      for (let c = 0; c < cnt && nodes.length < maxNodes; c++) {
        const away = p.gen === 0 ? r() * TAU : Math.atan2(p.y - root[1], p.x - root[0]) + (r() - .5) * 2.2;
        const dist = spread * (.6 + .8 * r());
        const node = { id: nodes.length, x: p.x + Math.cos(away) * dist, y: p.y + Math.sin(away) * dist, gen: g, t: p.t + delay(g, r()), parent: pi };
        nodes.push(node); next.push(node.id);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  const times = Float64Array.from(nodes.map((n) => n.t)).sort();
  const active = (t) => { let lo = 0, hi = times.length; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m; } return lo; };
  return { nodes, times, active, generations: nodes[nodes.length - 1].gen };
}
