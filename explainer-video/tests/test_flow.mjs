// Offline checks of assets/flow.js (no browser). Run: node explainer-video/tests/test_flow.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
/* rng comes from engine.js, loaded the same way test_audit.mjs loads explainer.js, then injected into flow.js */
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(join(ASSETS, 'engine.js'), 'utf8'), ctx, { filename: 'engine.js' });
const F = await import(join(ASSETS, 'flow.js'));
F.useRng(ctx.rng);

const mkPool = (seed = 5) => F.makePool({ rate: (t) => 20 + 30 * Math.max(0, t), speed: (b, u) => 400 + 200 * u, dir: (u) => u * 6.28, seed, t0: -2, t1: 10,
  extra: (r) => ({ len: 50 + 100 * r() }) });

test('pool: alive interval is exactly the births in [t - life, t)', () => {
  const p = mkPool();
  assert.ok(p.n > 100 && p.len.length === p.n);
  for (const [t, life] of [[0, 3], [4.5, 2], [9.99, 10], [-1, 0.5], [50, 5]]) {
    const [i0, i1] = p.alive(t, life);
    const want = []; for (let i = 0; i < p.n; i++) if (p.b[i] >= t - life && p.b[i] < t) want.push(i);
    assert.deepEqual([i0, i1], want.length ? [want[0], want[want.length - 1] + 1] : [i0, i0]);
  }
  for (let i = 1; i < p.n; i++) assert.ok(p.b[i] > p.b[i - 1]);
});

test('pool: same seed twice is identical; another seed differs', () => {
  const a = mkPool(5), b = mkPool(5), c = mkPool(6);
  assert.equal(a.n, b.n);
  for (const k of ['b', 'th', 'v', 'len']) assert.deepEqual(Array.from(a[k]), Array.from(b[k]));
  assert.notDeepEqual(Array.from(a.th), Array.from(c.th));
});

test('sampler: k = 0 is uniform, k = 1 follows the weights', () => {
  const w = [1, 1, 8, 1];
  const s0 = F.makeSampler(w, 0), s1 = F.makeSampler(w, (t) => t);
  assert.ok(Math.abs(s0(0.5) - Math.PI) < 1e-5);
  let hit = 0; for (let i = 0; i < 1000; i++) { const th = s1((i + .5) / 1000, 1); if (th > Math.PI && th < 1.5 * Math.PI) hit++; }
  assert.ok(Math.abs(hit / 1000 - 8 / 11) < .01, `bin 2 share ${hit / 1000}`);
});

test('stroker: one stroke per colour / alpha bucket', () => {
  const calls = []; const g = { set lineWidth(v) {}, set strokeStyle(v) { calls.push(v); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { calls.push('stroke'); } };
  const S = F.makeStroker(['255,0,0', '#00ff00']);
  for (let i = 0; i < 50; i++) { S.push(0, .5, 0, 0, 1, 1); S.push(1, .5, 0, 0, 1, 1); }
  S.push(0, 0, 0, 0, 1, 1);
  S.flush(g, 1);
  assert.equal(calls.filter((c) => c === 'stroke').length, 2);
  assert.ok(calls.some((c) => c.startsWith('rgba(0,255,0,')));
});

test('clock: monotone, slows before slowAt, equals real time after catch-up', () => {
  const c = F.makeClock({ slowAt: 20, slowTo: .12, slowDur: 1.9, catchUp: 1.1 });
  let prev = c(0), minRate = 9;
  for (let t = 0.001; t < 40; t += 0.001) { const v = c(t); assert.ok(v > prev, `not increasing at ${t}`); minRate = Math.min(minRate, (v - prev) / .001); prev = v; }
  assert.ok(minRate < .2 && minRate > .1, `min rate ${minRate}`);
  assert.ok(c(20) < 20 - 1);
  for (const t of [21.1, 21.2, 25, 39.9]) assert.ok(Math.abs(c(t) - t) < 1e-6, `${t}: ${c(t) - t}`);
  assert.equal(c(5), 5);
});

test('cascade: active(t) is non-decreasing and ends at the node count; reproducible', () => {
  const mk = (seed) => F.makeCascade({ seed, root: [10, 20], branching: (g) => (g < 3 ? 2.5 : 1.4), generations: 7, spread: 120, delay: (g, r) => .4 + .4 * r });
  const c = mk(3), c2 = mk(3);
  assert.ok(c.nodes.length > 50);
  assert.deepEqual(c.nodes, c2.nodes);
  assert.equal(c.active(-1), 0);
  assert.equal(c.active(0), 1);
  let prev = 0; for (let t = 0; t < 40; t += .05) { const a = c.active(t); assert.ok(a >= prev); prev = a; }
  assert.equal(c.active(1e9), c.nodes.length);
  for (const n of c.nodes.slice(1)) assert.ok(n.t > c.nodes[n.parent].t && n.gen === c.nodes[n.parent].gen + 1);
  const far = c.nodes.filter((n) => n.gen >= 2).every((n) => Math.hypot(n.x - 10, n.y - 20) > 60);
  assert.ok(far, 'later generations sit away from the root');
});
