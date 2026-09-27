#!/usr/bin/env node
// Frame-exact renderer for a launch-video HTML page.
//
// Page contract (see assets/template.html):
//   window.__duration  total seconds          window.__seek(t)  pure render at time t
//   window.__ready     set once assets load   window.__recording  set by this script before load
//
// Usage (run from a directory where `npm i -D playwright` has been done):
//   node <skill>/scripts/render.mjs --html promo.html [--out out/silent.mp4] [--fps 30]
//   node <skill>/scripts/render.mjs --html promo.html --stills 0.5,4,9.5   → out/stills/t<sec>.png
// Env: CHROMIUM_PATH=<browser binary> to reuse an existing Chromium instead of Playwright's download.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.html) {
  console.error('usage: render.mjs --html page.html [--out out/silent.mp4] [--fps 30] [--stills 1,2.5]');
  process.exit(2);
}
const html = resolve(args.html);
if (!existsSync(html)) { console.error(`not found: ${html}`); process.exit(2); }
const fps = Number(args.fps ?? 30);
const outDir = resolve(dirname(html), 'out');
const out = resolve(args.out ?? join(outDir, 'silent.mp4'));

let chromium;
try {
  ({ chromium } = createRequire(join(process.cwd(), 'noop.js'))('playwright'));
} catch {
  console.error('playwright is not installed here. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}
if (!args.stills && spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.error('ffmpeg not found on PATH'); process.exit(2);
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
await page.addInitScript(() => { window.__recording = true; });
await page.goto(pathToFileURL(html).href);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const duration = await page.evaluate(() => window.__duration);
if (!(duration > 0)) { console.error('page must set window.__duration > 0'); await browser.close(); process.exit(2); }

async function shot(t, path) {
  await page.evaluate((tt) => window.__seek(tt), t);
  // image sources may change per frame (recorded footage); wait until they decode
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => {})))));
  await page.screenshot({ path, type: 'png' });
}

let failed = false;
try {
  if (args.stills) {
    const dir = join(outDir, 'stills');
    mkdirSync(dir, { recursive: true });
    for (const s of String(args.stills).split(',')) await shot(Math.min(Number(s), duration - 0.001), join(dir, `t${s}.png`));
    console.log(`✓ stills → ${dir}`);
  } else {
    const frames = mkdtempSync(join(tmpdir(), 'launch-video-frames-'));
    const n = Math.round(duration * fps);
    for (let i = 0; i < n; i++) {
      await shot(i / fps, join(frames, `${String(i).padStart(5, '0')}.png`));
      if (i % (fps * 5) === 0) console.log(`frame ${i}/${n}`);
    }
    mkdirSync(dirname(out), { recursive: true });
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(frames, '%05d.png'),
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow',
      '-movflags', '+faststart', out], { stdio: 'inherit' });
    rmSync(frames, { recursive: true, force: true });
    if (r.status !== 0) throw new Error('ffmpeg encode failed');
    console.log(`✓ ${out} (${duration}s @ ${fps}fps, ${n} frames)`);
  }
} catch (e) {
  failed = true;
  console.error(String(e));
} finally {
  await browser.close();
}
if (errors.length) { console.error('PAGE ERRORS (fix before delivering):\n' + errors.join('\n')); failed = true; }
process.exit(failed ? 1 : 0);
