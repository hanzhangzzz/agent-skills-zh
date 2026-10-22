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
function film(EX, patch = {}) {
  for (let c = 0; c < 8; c++) EX.chapter('c' + c, { name: '第' + c + '章' });
  EX.shot({ id: 'hook', chapter: null, dur: 7, hud: false, caps: [[0.5, '你按下了一个按钮。']] });
  for (let c = 0; c < 8; c++) {
    const id = 's' + c;
    EX.shot(Object.assign({ id, chapter: 'c' + c, dur: 11, meter: [c, c + 1], caps: [[0.3, '这一步叫「术语' + c + '」。'], [5, '它让下一步成为可能。']] }, patch[id] || {}));
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
test('a chapter that never names its term is NO-TERM; a meter that goes back is METER-BACKWARDS', () => {
  assert.ok(has(plan((EX) => film(EX, { s4: { caps: [[0, '这一步没有术语。'], [5, '它让下一步成为可能。']] } })), 'NO-TERM'));
  assert.ok(has(plan((EX) => film(EX, { s5: { meter: [0, 1] } })), 'METER-BACKWARDS'));
});
test('the shipped examples obey every pacing rule except film-level length', () => {
  for (const f of ['shots.example.js', 'gallery.example.js']) {
    const ctx = load();
    ctx.EX.run = () => {};
    vm.runInContext(readFileSync(join(ASSETS, f), 'utf8'), ctx, { filename: f });
    const rest = ctx.EX.planAudit().filter((i) => !i.startsWith('DURATION') && !i.startsWith('CHAPTERS'));
    assert.equal(rest.length, 0, f + ': ' + rest.join('\n'));
  }
});
