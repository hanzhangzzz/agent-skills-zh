#!/usr/bin/env node
// Frame-exact renderer for an explainer-video page (explainer.html + shots.js).
//
// Page contract (implemented by assets/engine.js):
//   window.__duration  total seconds          window.__seek(t)  pure render at time t
//   window.__ready     set once assets load   window.__recording  set by this script before load
//   window.__size      [width, height], default [1920, 1080]
// The page's directory is served over a local HTTP server, not file://, so ES modules (three.js),
// fetch() and canvas pixel reads of local images work.
//
// Usage (run from a directory where `npm i -D playwright` has been done):
//   node <skill>/scripts/render.mjs --html promo.html [--out out/silent.mp4] [--fps 30] [--subframes 3]
//     --subframes N  captures N sub-frames per output frame and blends them (ffmpeg tmix) → real motion blur on
//                    fast moves. N× slower; use 1 (default) while iterating and 3 for the delivery render.
//   node <skill>/scripts/render.mjs --html promo.html --stills 0.5,4,9.5   → out/stills/t<sec>.png (or --out <dir>)
//   --stills shots   one still at the middle and one just before the end of every shot (needs window.__shots)
//   --lint           with --stills: print the page's window.__lint() findings for each still; exit 1 if any
//   --cues-out FILE  write window.__cues (auto sound cues) as cues.json, then exit
//   --at 37.2 --eval "document.querySelector('#x').textContent"   seek, evaluate, print the JSON result, exit
//                    (debug one frame without writing your own browser script)
// Env: CHROMIUM_PATH=<browser binary> to reuse an existing Chromium instead of Playwright's download.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
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
  ({ chromium } = createRequire(join(dirname(html), 'noop.js'))('playwright'));   // the work dir's own install
} catch {
  console.error('playwright is not installed here. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}
if (!args.stills && spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.error('ffmpeg not found on PATH'); process.exit(2);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream' };
const root = dirname(html);
const server = createServer((req, res) => {
  const file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if ((file !== root && !file.startsWith(root + sep)) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
async function stop(code, msg) {
  if (msg) console.error(msg);
  if (errors.length) console.error('PAGE ERRORS:\n' + errors.join('\n'));
  await browser.close();
  server.close();
  process.exit(code);
}
await page.addInitScript(() => { window.__recording = true; });
await page.goto(`http://127.0.0.1:${server.address().port}/${encodeURIComponent(basename(html))}`);
// wait for __ready, but stop at the first page error instead of sitting out the timeout
for (let waited = 0; ; waited += 200) {
  if (await page.evaluate(() => window.__ready === true)) break;
  if (errors.length) await stop(2, 'page failed while loading (fix the first error below; `node --check shots.js` catches syntax errors)');
  if (waited > 60000) await stop(2, 'page never set window.__ready within 60s');
  await new Promise((ok) => setTimeout(ok, 200));
}
const duration = await page.evaluate(() => window.__duration);
if (!(duration > 0)) await stop(2, 'page must set window.__duration > 0');
const [width, height] = await page.evaluate(() => window.__size ?? [1920, 1080]);
if (width !== 1920 || height !== 1080) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok())));
}

async function shot(t, path) {
  await page.evaluate((tt) => window.__seek(tt), t);
  // image sources may change per frame (recorded footage); wait until they decode
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => {})))));
  // video frames as high-quality JPEG: ~5× faster than PNG and invisible after x264; stills stay PNG
  if (path.endsWith('.jpg')) await page.screenshot({ path, type: 'jpeg', quality: 95 });
  else return page.screenshot({ path, type: 'png' });
}

// ink: share of safe-area pixels (x 80–1840, y 180–900) that differ from the bare background (content layers
// hidden). White cards count; a thin outline on an empty frame does not. Explainer-only: needs #world #hud #cap.
async function inkCoverage(full) {
  await page.evaluate(() => { for (const id of ['world', 'hud', 'cap']) document.getElementById(id).style.visibility = 'hidden'; });
  const bare = await page.screenshot({ type: 'png' });
  await page.evaluate(() => { for (const id of ['world', 'hud', 'cap']) document.getElementById(id).style.visibility = ''; });
  return page.evaluate(async ([a, b]) => {
    const load = (d) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + d; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const cv = document.createElement('canvas'); cv.width = 1760; cv.height = 720; const g = cv.getContext('2d');
    g.drawImage(ia, -80, -180); const A = g.getImageData(0, 0, 1760, 720).data;
    g.drawImage(ib, -80, -180); const B = g.getImageData(0, 0, 1760, 720).data;
    let n = 0;
    for (let i = 0; i < A.length; i += 4) if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 12) n++;
    return n / (1760 * 720);
  }, [full.toString('base64'), bare.toString('base64')]);
}

let failed = false;
try {
  if (args.eval) {
    const tt = Math.min(Number(args.at ?? 0), duration - 0.001);
    await page.evaluate((x) => window.__seek(x), tt);
    const v = await page.evaluate((src) => { try { return JSON.stringify((0, eval)(src)); } catch (e) { return 'ERROR ' + e; } }, String(args.eval));
    console.log(`t=${tt}: ${v}`);
  } else if (args['cues-out']) {
    const cues = await page.evaluate(() => ({ ...window.__cues, scenes: (window.__shots || []).map((s) => s.start) }));
    if (!cues) throw new Error('page has no window.__cues');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(args['cues-out']), JSON.stringify(cues, null, 1));
    console.log(`✓ ${cues.cues.length} cues → ${args['cues-out']}`);
  } else if (args.stills) {
    const dir = args.out ? resolve(args.out) : join(outDir, 'stills');
    mkdirSync(dir, { recursive: true });
    // drop stills from earlier runs so a contact sheet never mixes old and new frames
    for (const f of readdirSync(dir)) if (/^t[\d.]+\.png$/.test(f)) rmSync(join(dir, f));
    let times = String(args.stills).split(',');
    if (args.stills === 'shots') {
      const list = await page.evaluate(() => window.__shots);
      if (!list) throw new Error('--stills shots needs window.__shots (explainer.js)');
      times = list.flatMap((s) => [(s.start + s.dur * .5).toFixed(2), (s.start + s.dur - .15).toFixed(2)]);
    }
    // composition (SPARSE / OFF-CENTER) is judged on the mid-shot still only: a shot's last frames may be a deliberate
    // morph into the next shot. Explicit --stills times are always judged.
    const midShot = new Set(args.stills === 'shots' ? times.filter((_, i) => i % 2 === 0) : times);
    let lintCount = 0;
    for (const s of times) {
      const tt = Math.min(Number(s), duration - 0.001);
      const png = await shot(tt, join(dir, `t${String(s).padStart(7, '0')}.png`));
      if (args.lint) {
        const issues = await page.evaluate((c) => (window.__lint ? window.__lint({ composition: c }) : ['page has no __lint']), midShot.has(s));
        const cur = await page.evaluate((x) => (window.__shots || []).filter((r) => r.start <= x).pop()?.id ?? '', tt);
        const curRow = await page.evaluate((x) => (window.__shots || []).filter((r) => r.start <= x).pop() ?? null, tt);
        if (midShot.has(s) && curRow?.hud && (await page.evaluate(() => !!document.getElementById('world')))) {
          const ink = await inkCoverage(png);
          if (ink < 0.05) issues.push(`THIN only ${(ink * 100).toFixed(1)}% of the safe area is drawn (min 5%): fill shapes (gradient body, not outline only), enlarge them, or add the missing parts`);
        }
        for (const i of issues) console.log(`LINT t=${s} [${cur}] ${i}`);
        lintCount += issues.length;
      }
    }
    if (args.stills === 'shots') {
      // contact sheets of every still, 24 per page (out/sheet-01.jpg, sheet-02.jpg, …) — never a silent cut-off
      const sheetDir = dirname(dir);
      for (const f of readdirSync(sheetDir)) if (/^sheet-\d+\.jpg$/.test(f)) rmSync(join(sheetDir, f));
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-pattern_type', 'glob', '-i', join(dir, 't*.png'),
        '-vf', 'scale=640:-1,tile=4x6', join(sheetDir, 'sheet-%02d.jpg')], { stdio: 'inherit' });
      const pages = r.status === 0 ? readdirSync(sheetDir).filter((f) => /^sheet-\d+\.jpg$/.test(f)).length : 0;
      console.log(pages ? `✓ ${pages} contact sheet page(s) → ${join(sheetDir, 'sheet-01.jpg')}${pages > 1 ? ' …' : ''}` : 'contact sheet failed (is ffmpeg on PATH?)');
    }
    if (args.lint) {
      const audit = await page.evaluate(() => (window.__audit ? window.__audit() : []));
      for (const i of audit) console.log(`AUDIT ${i}`);
      lintCount += audit.length;
    }
    console.log(`✓ ${times.length} stills → ${dir}` + (args.lint ? (lintCount ? ` · ${lintCount} issue(s) to fix` : ' · clean') : ''));
    if (lintCount) failed = true;
  } else {
    const frames = mkdtempSync(join(tmpdir(), 'explainer-video-frames-'));
    const sub = Math.max(1, Math.round(Number(args.subframes ?? 1)));
    const n = Math.round(duration * fps);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < sub; k++) {
        await shot((i + k / sub) / fps, join(frames, `${String(i * sub + k).padStart(6, '0')}.jpg`));
      }
      if (i % (fps * 5) === 0) console.log(`frame ${i}/${n}`);
    }
    mkdirSync(dirname(out), { recursive: true });
    // with sub-frames: read at fps×sub, average each run of `sub` frames (tmix), then keep one frame per output frame.
    // tmix at index n averages n-sub+1..n, so keep n = sub-1, 2sub-1, …: each kept frame blends exactly its own
    // sub-frames and never the previous output frame's (a hard cut on a frame boundary stays clean).
    const blur = sub > 1 ? ['-vf', `tmix=frames=${sub},select='eq(mod(n+1\\,${sub})\\,0)',setpts=N/${fps}/TB`] : [];
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps * sub), '-i', join(frames, '%06d.jpg'),
      ...blur, '-r', String(fps),
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow',
      '-movflags', '+faststart', out], { stdio: 'inherit' });
    rmSync(frames, { recursive: true, force: true });
    if (r.status !== 0) throw new Error('ffmpeg encode failed');
    console.log(`✓ ${out} (${duration}s @ ${fps}fps, ${n} frames, ${width}×${height})`);
  }
} catch (e) {
  failed = true;
  console.error(String(e));
}
await stop(failed || errors.length ? 1 : 0, errors.length ? 'fix page errors before delivering' : '');
