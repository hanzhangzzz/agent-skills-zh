// Offline checks of the pacing audit (no browser): thresholds match SKILL.md, and the shipped examples obey them.
// Run: node explainer-video/tests/test_audit.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/* a fresh page-less context with explainer.js (+ optional files); EX.run is a no-op so shot files can be loaded */
function load(...files) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['icons.js', 'explainer.js', ...files]) vm.runInContext(readFileSync(join(ASSETS, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
function plan(build) {
  const ctx = load();
  ctx.EX.run = () => {};
  build(ctx.EX);
  return ctx.EX.planAudit();
}
const has = (issues, kind) => issues.some((i) => i.startsWith(kind));

/* a valid 8-chapter, ~100 s film; each test breaks one rule */
function film(EX, patch = {}, n = 8, sound = true) {
  for (let c = 0; c < n; c++) EX.chapter('c' + c, { name: '第' + c + '章' });
  EX.shot({ id: 'hook', chapter: null, dur: 7, hud: false, caps: [[0.5, '你按下了一个按钮。']] });
  for (let c = 0; c < n; c++) {
    const id = 's' + c;
    EX.shot(Object.assign({ id, chapter: 'c' + c, dur: 11, meter: [c, c + 1], caps: [[0.3, '这一步叫「术语' + c + '」。'], [5, '它让下一步成为可能。']],
      ...(sound ? { amb: 'room', hush: c === 5 ? [[9, 10.5]] : undefined } : {}) }, patch[id] || {}));
  }
  EX.shot({ id: 'end', chapter: null, dur: 6, hud: false, caps: [[0.5, '这就是全部过程。']] });
}

test('a well-formed film passes the audit', () => {
  const r = plan((EX) => film(EX));
  assert.equal(r.length, 0, r.join('\n'));
});
test('caption: 24 chars pass, 25 chars are CAPTION-LONG (SKILL.md: ≤ 24 字)', () => {
  const c24 = '一'.repeat(23) + '。', c25 = '一'.repeat(24) + '。';
  assert.ok(!has(plan((EX) => film(EX, { s1: { caps: [[0, '「术语」' + c24.slice(2)]] } })), 'CAPTION-LONG'));
  assert.ok(has(plan((EX) => film(EX, { s1: { caps: [[0, '「术语」' + c25.slice(2)]] } })), 'CAPTION-LONG'));
});
test('caption shown shorter than chars/6 + 1 s is CAPTION-FAST', () => {
  assert.ok(has(plan((EX) => film(EX, { s2: { caps: [[0, '这一步叫「术语」，后面紧接着下一句话。'], [2, '下一句。']] } })), 'CAPTION-FAST'));
});
test('shot length: > 12 s is LONG, < 4 s is SHORT (SKILL.md: 5–10 s, lint 4–12 s)', () => {
  assert.ok(!has(plan((EX) => film(EX, { s3: { dur: 12 } })), 'LONG'));
  assert.ok(has(plan((EX) => film(EX, { s3: { dur: 12.5 } })), 'LONG'));
  assert.ok(has(plan((EX) => film(EX, { s3: { dur: 3.9, caps: [[0, '「术语」。']] } })), 'SHORT'));
});
test('total length outside 80–160 s is DURATION (SKILL.md: 90–150 s)', () => {
  assert.ok(has(plan((EX) => film(EX, Object.fromEntries([...Array(8)].map((_, c) => ['s' + c, { dur: 5, caps: [[0, '「术语」来了。']] }])))), 'DURATION'));
  assert.ok(has(plan((EX) => film(EX, Object.fromEntries([...Array(8)].map((_, c) => ['s' + c, { dur: 20 }])))), 'DURATION'));
});
test('6 chapters pass, 5 are CHAPTERS (SKILL.md: 6–10 章)', () => {
  assert.ok(!has(plan((EX) => film(EX, {}, 6)), 'CHAPTERS'));
  assert.ok(has(plan((EX) => film(EX, {}, 5)), 'CHAPTERS'));
});
test('sound design: no hush or too few ambience beds is SOUND', () => {
  assert.ok(!has(plan((EX) => film(EX)), 'SOUND'));
  assert.ok(has(plan((EX) => film(EX, {}, 8, false)), 'SOUND'));
  assert.ok(has(plan((EX) => film(EX, { s5: { hush: undefined } })), 'SOUND no hush'));
});
test('a chapter that never names its term is NO-TERM; a meter that goes back is METER-BACKWARDS', () => {
  assert.ok(has(plan((EX) => film(EX, { s4: { caps: [[0, '这一步没有术语。'], [5, '它让下一步成为可能。']] } })), 'NO-TERM'));
  assert.ok(has(plan((EX) => film(EX, { s5: { meter: [0, 1] } })), 'METER-BACKWARDS'));
});
test('the shipped examples obey every pacing rule except film-level length', () => {
  for (const f of ['shots.example.js', 'gallery.example.js', 'world.example.js']) {   /* three.example.js imports three: checked by rendering */
    const ctx = load('engine.js');                          /* examples may call rng() etc. at load time */
    ctx.EX.run = () => {};
    vm.runInContext(readFileSync(join(ASSETS, f), 'utf8'), ctx, { filename: f });
    const rest = ctx.EX.planAudit().filter((i) => !/^(DURATION|CHAPTERS|SOUND)/.test(i));   /* film-level rules */
    assert.equal(rest.length, 0, f + ': ' + rest.join('\n'));
  }
});
test('camera: shots at different `at` fly; a zoom keeps one world point fixed on screen and lands on the target pose', () => {
  const ctx = load('engine.js');
  const { EX } = ctx;
  EX.chapter('a', { name: '甲' });
  EX.shot({ id: 'big', chapter: 'a', dur: 5, caps: [[0, '「整体」先看全貌。']] });
  EX.shot({ id: 'small', chapter: 'a', dur: 5, at: [1356, 674, .1], caps: [[0, '再推进去。']] });
  EX.shot({ id: 'same', chapter: 'a', dur: 5, at: [1356, 674, .1], caps: [[0, '原地叠化。']] });
  EX.planAudit();                                             /* resolves the timeline */
  assert.equal(EX.cam(2)[2], 1, 'a shot without `at` keeps the plain screen');
  const a = EX.cam(5), b = EX.cam(5 + 1.2);
  assert.ok(Math.abs(a[0] - 960) < 1e-9 && Math.abs(a[2] - 1) < 1e-9, 'the fly starts where the previous camera stood');
  assert.ok(Math.abs(b[0] - 1356) < 1e-6 && Math.abs(b[2] - .1) < 1e-3, 'the fly ends on the new shot');
  /* the fixed point w satisfies (w - c0)/s0 = (w - c1)/s1; every in-between pose must map it to the same screen spot */
  const w = (a[0] / a[2] - b[0] / b[2]) / (1 / a[2] - 1 / b[2]);
  const screen = (p) => (w - p[0]) / p[2];
  for (const t of [5.3, 5.6, 5.9]) assert.ok(Math.abs(screen(EX.cam(t)) - screen(a)) < 1e-6, 'zoom drifts at t=' + t);
});

test('a caption clear [t, null] is not audited as a caption, and an end time shortens the reading window', () => {
  // the ending caption cleared before a title card: no CAPTION-FAST, no crash on the null text
  const cleared = plan((EX) => film(EX, { s7: { caps: [[0.3, '这一步叫「术语7」。'], [5, '它让下一步成为可能。'], [9, null]] } }));
  assert.ok(!has(cleared, 'CAPTION-FAST'), cleared.join('\n'));
  // the same caption ended at 1 s is too fast to read: the end time must count
  const ended = plan((EX) => film(EX, { s7: { caps: [[0.3, '这一步叫「术语7」。', 1.3], [5, '它让下一步成为可能。']] } }));
  assert.ok(has(ended, 'CAPTION-FAST'), ended.join('\n'));
});
