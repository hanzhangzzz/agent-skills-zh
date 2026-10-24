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
//     --workers N    render frames in N parallel browsers (default min(4, cores / 3); 1 = the old single page).
//                    Same frames as --workers 1 up to antialiasing noise (a seek jump re-rasters text a hair differently,
//                    WebGL differs by a few levels across browsers; worst frame measured ≥ 46 dB PSNR, invisible).
//     --range a:b    render only t = a…b seconds → out/sample.mp4 (or --out): check a 15 s sample before the full film
//   node <skill>/scripts/render.mjs --html promo.html --sheet auto   → out/keyframes.jpg (or --out <file.jpg>)
//                    9 key moments in one labelled 3×3 image (t = 1.5 s for the opening, then mid-points of 8 shots
//                    spread from the first explained shot to the ending); or --sheet 12.3,40,88 for chosen times.
//   node <skill>/scripts/render.mjs --html promo.html --stills 0.5,4,9.5   → out/stills/t<sec>.png (or --out <dir>)
//   --stills shots   one still at the middle and one just before the end of every shot (needs window.__shots)
//   --lint           with --stills: print the page's window.__lint() findings for each still; exit 1 if any
//   --cues-out FILE  write window.__cues (auto sound cues) as cues.json, then exit
//   --at 37.2 --eval "document.querySelector('#x').textContent"   seek, evaluate, print the JSON result, exit
//                    (debug one frame without writing your own browser script)
// Env: CHROMIUM_PATH=<browser binary> to reuse an existing Chromium instead of Playwright's download.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { cpus, tmpdir } from 'node:os';

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
  console.error('usage: render.mjs --html page.html [--out out/silent.mp4] [--fps 30] [--subframes 3] [--workers N] [--range a:b] | --stills 1,2.5 | --sheet auto');
  process.exit(2);
}
const html = resolve(args.html);
if (!existsSync(html)) { console.error(`not found: ${html}`); process.exit(2); }
const fps = Number(args.fps ?? 30);
const outDir = resolve(dirname(html), 'out');
const out = resolve(args.out ?? join(outDir, args.range ? 'sample.mp4' : 'silent.mp4'));

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

// headless Chromium on macOS defaults to SwiftShader (software WebGL: a three.js scene with post-processing renders at
// ~1.5 s per frame on the CPU); ANGLE's Metal backend uses the real GPU and produces the same frames
const launchArgs = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
const launch = () => chromium.launch({ args: launchArgs, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const browsers = [await launch()];
const browser = browsers[0];
const errors = [];
async function stop(code, msg) {
  if (msg) console.error(msg);
  if (errors.length) console.error('PAGE ERRORS:\n' + errors.join('\n'));
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
  server.close();
  process.exit(code);
}
let width = 1920, height = 1080;
// one page = the film loaded and __ready; tag prefixes its errors (render workers)
async function openPage(b, tag = '') {
  const pg = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  pg.on('pageerror', (e) => errors.push(tag + String(e)));
  pg.on('console', (m) => { if (m.type() === 'error') errors.push(tag + m.text()); });
  pg.on('requestfailed', (r) => errors.push(`${tag}request failed: ${r.url()}`));
  pg.on('response', (r) => { if (r.status() >= 400) errors.push(`${tag}HTTP ${r.status()}: ${r.url()}`); });
  await pg.addInitScript(() => { window.__recording = true; });
  await pg.goto(`http://127.0.0.1:${server.address().port}/${encodeURIComponent(basename(html))}`);
  // wait for __ready, but stop at the first page error instead of sitting out the timeout
  for (let waited = 0; ; waited += 200) {
    if (await pg.evaluate(() => window.__ready === true)) break;
    if (errors.length) await stop(2, 'page failed while loading (fix the first error below; `node --check shots.js` catches syntax errors)');
    if (waited > 60000) await stop(2, 'page never set window.__ready within 60s');
    await new Promise((ok) => setTimeout(ok, 200));
  }
  return pg;
}
const page = await openPage(browser);
const duration = await page.evaluate(() => window.__duration);
if (!(duration > 0)) await stop(2, 'page must set window.__duration > 0');
[width, height] = await page.evaluate(() => window.__size ?? [1920, 1080]);
if (width !== 1920 || height !== 1080) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok())));
}

async function shot(t, path, pg = page) {
  await pg.evaluate((tt) => window.__seek(tt), t);
  // image sources may change per frame (recorded footage); wait until they decode
  await pg.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => {})))));
  // video frames as high-quality JPEG: ~5× faster than PNG and invisible after x264; stills stay PNG
  if (path.endsWith('.jpg')) await pg.screenshot({ path, type: 'jpeg', quality: 95 });
  else return pg.screenshot({ path, type: 'png' });
}

// composition from pixels: diff the frame without HUD / caption against the bare background (#bg plus a scenery
// backdrop), so DOM, SVG, canvas and WebGL content all count the same. Returns the ink share of the safe area (x 80–1840, y 180–900;
// white cards count, a thin outline on an empty frame does not) and the box holding 99% of the ink over the whole frame.
// Explainer-only: needs #bg #hud #cap inside #stage.
async function inkStats(capBox = null) {
  const layers = (ids, v) => page.evaluate(([ids, v]) => {
    /* '*' = everything that is not background: #bg and a scenery backdrop (EX.backdrop without subject: true) stay */
    const bg = (el) => el.id === 'bg' || el.id === 'vignette' || (el.id === 'back' && !('subject' in el.dataset));
    for (const el of document.getElementById('stage').children) if (ids === '*' ? !bg(el) : ids.includes(el.id)) el.style.visibility = v;
  }, [ids, v]);
  await layers(['hud', 'cap'], 'hidden');
  const content = await page.screenshot({ type: 'png' });
  await layers('*', 'hidden');
  const bare = await page.screenshot({ type: 'png' });
  await layers('*', '');
  return page.evaluate(async ([a, b, capBox]) => {
    const load = (d) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + d; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const W = 1920, H = 1080;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(ia, 0, 0); const A = g.getImageData(0, 0, W, H).data;
    g.drawImage(ib, 0, 0); const B = g.getImageData(0, 0, W, H).data;
    const ink = new Uint8Array(W * H), rowN = new Float64Array(H), hist = new Float64Array(256);
    const lum = (i) => (2 * A[i] + 5 * A[i + 1] + A[i + 2]) >> 3;
    let safe = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) <= 12) continue;
      ink[y * W + x] = 1; rowN[y]++; hist[lum(i)]++;
      if (x >= 80 && x < 1840 && y >= 180 && y < 900) safe++;
    }
    // the subject = the brightest content (≥ 85% of the 99.9th-percentile luminance of the ink); share of it under the caption
    let tot = 0, nInk = hist.reduce((s, v) => s + v, 0), top = 255;
    for (; top > 0; top--) { tot += hist[top]; if (tot >= nInk * .001) break; }
    const hot = Math.max(40, Math.round(top * .85));
    let bright = 0, underCap = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!ink[y * W + x] || lum((y * W + x) * 4) < hot) continue;
      bright++;
      if (capBox && x >= capBox.x - 16 && x < capBox.x + capBox.w + 16 && y >= capBox.y - 16 && y < capBox.y + capBox.h + 16) underCap++;
    }
    // where the composition is: rows inked edge to edge are scenery bands (ground, sky, a full-bleed 3D or canvas
    // backdrop); in those rows only what stands out from the row's own median colour counts. The HUD and caption
    // bands (top / bottom 120 px) are left out so edge decorations do not drag the centre.
    const col = new Float64Array(W), row = new Float64Array(H);
    let n = 0;
    const ch = new Uint8Array(W);
    for (let y = 120; y < H - 120; y++) {
      const band = rowN[y] > .9 * W;
      let med = null;
      if (band) med = [0, 1, 2].map((c) => { for (let x = 0; x < W; x++) ch[x] = A[(y * W + x) * 4 + c]; return ch.slice().sort()[W >> 1]; });
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const on = band ? Math.max(Math.abs(A[i] - med[0]), Math.abs(A[i + 1] - med[1]), Math.abs(A[i + 2] - med[2])) > 24 : ink[y * W + x];
        if (on) { n++; col[x]++; row[y]++; }
      }
    }
    const span = (h) => { let c = 0, lo = 0, hi = h.length - 1; for (let i = 0; i < h.length; i++) { c += h[i]; if (c >= n * .005) { lo = i; break; } }
      c = 0; for (let i = h.length - 1; i >= 0; i--) { c += h[i]; if (c >= n * .005) { hi = i; break; } } return [lo, hi]; };
    const [x0, x1] = span(col), [y0, y1] = span(row);   // the box holding 99% of the counted ink
    return { cover: safe / (1760 * 720), n, x0, x1, y0, y1, bright, underCap };
  }, [content.toString('base64'), bare.toString('base64'), capBox]);
}
// EMPTY / SPARSE / OFF-CENTER / THIN for one mid-shot still; hud = the shot is an explained shot (not hook/title/ending).
// mode 'cinema' (EX.run({ composition: 'cinema' })): a small luminous subject in darkness is intended, so only EMPTY and
// SUBJECT-UNDER-CAPTION (more than 3% of the brightest pixels inside the caption box) are checked.
function compositionIssues(ink, hud, mode = 'explainer') {
  const SW = 1760, SH = 720, SCX = 960, SCY = 540;
  if (ink.n < 500) return ['EMPTY nothing painted in this shot'];
  const out = [];
  if (mode === 'cinema') {
    if (ink.bright && ink.underCap > .03 * ink.bright) out.push(`SUBJECT-UNDER-CAPTION ${((100 * ink.underCap) / ink.bright).toFixed(0)}% of the brightest pixels sit under the caption: move the subject up (keep y < 900) or dim what is behind the caption`);
    return out;
  }
  const w = ink.x1 - ink.x0, h = ink.y1 - ink.y0, cx = (ink.x0 + ink.x1) / 2, cy = (ink.y0 + ink.y1) / 2;
  const sparse = hud ? (w * h < .3 * SW * SH || (w < .55 * SW && h < .55 * SH)) : (w * h < .1 * SW * SH && w < .45 * SW);
  if (sparse) out.push(`SPARSE content spans ${w | 0}×${h | 0}px (${(100 * w / SW) | 0}% × ${(100 * h / SH) | 0}% of the safe area): scale the main visual up or add the missing parts — target ≥ 60% of the width or height` + (hud ? '' : ' (titles: ≥ 120 px type plus one strong shape)'));
  if (hud && (Math.abs(cx - SCX) > .14 * SW || Math.abs(cy - SCY) > .16 * SH)) out.push(`OFF-CENTER content centre at ${cx | 0},${cy | 0}, safe-area centre is ${SCX},${SCY}: move the composition`);
  if (hud && ink.cover < 0.05) out.push(`THIN only ${(ink.cover * 100).toFixed(1)}% of the safe area is drawn (min 5%): fill shapes (gradient body, not outline only), enlarge them, or add the missing parts`);
  return out;
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
    writeFileSync(resolve(args['cues-out']), JSON.stringify(cues, null, 1));
    console.log(`✓ ${cues.cues.length} cues → ${args['cues-out']}`);
  } else if (args.sheet) {
    // key-moment sheet: up to 9 times in one labelled 3-column image (out/keyframes.jpg), composed on a canvas
    const list = await page.evaluate(() => window.__shots ?? null);
    let times;
    if (args.sheet === 'auto') {
      if (list?.length) {
        // t = 1.5 s (does the opening grab?) + mid-points of 8 evenly spread shots, from the first explained shot (hud)
        // through the ending
        const first = Math.max(0, list.findIndex((x) => x.hud)), last = list.length - 1;
        const picks = [...new Set(Array.from({ length: 8 }, (_, k) => Math.round(first + k * (last - first) / 7)))];
        times = [Math.min(1.5, duration / 2), ...picks.map((i) => list[i].start + list[i].dur / 2)];
      } else times = Array.from({ length: 9 }, (_, k) => (k + .5) * duration / 9);
    } else times = String(args.sheet).split(',').map(Number);
    if (!times.length || times.some((t) => !(t >= 0))) throw new Error(`--sheet wants auto or T1,T2,… in seconds, got ${args.sheet}`);
    const tiles = [];
    for (const t of times) {
      const tt = Math.min(t, duration - 0.001);
      await page.evaluate((x) => window.__seek(x), tt);
      await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => {})))));
      const id = (list || []).filter((r) => r.start <= tt).pop()?.id;
      tiles.push({ img: (await page.screenshot({ type: 'jpeg', quality: 92 })).toString('base64'), label: `t=${tt.toFixed(1)}s` + (id ? ` · ${id}` : '') });
    }
    const canvasPage = await browser.newPage();   // blank page: the film's page and its error log stay untouched
    const jpg = await canvasPage.evaluate(async ([tiles, w, h]) => {
      const cols = Math.min(3, tiles.length), rows = Math.ceil(tiles.length / cols);
      const tw = 640, th = Math.round(tw * h / w), cap = 34, gap = 8;
      const cv = document.createElement('canvas');
      cv.width = gap + cols * (tw + gap); cv.height = gap + rows * (th + cap + gap);
      const g = cv.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
      g.font = '600 20px -apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif'; g.textBaseline = 'middle';
      for (const [k, t] of tiles.entries()) {
        const img = new Image(); img.src = 'data:image/jpeg;base64,' + t.img; await img.decode();
        const x = gap + (k % cols) * (tw + gap), y = gap + Math.floor(k / cols) * (th + cap + gap);
        g.drawImage(img, x, y, tw, th);
        g.fillStyle = '#eee'; g.fillText(`${k + 1}  ${t.label}`, x + 6, y + th + cap / 2, tw - 12);
      }
      return cv.toDataURL('image/jpeg', .9).split(',')[1];
    }, [tiles, width, height]);
    await canvasPage.close();
    const file = resolve(args.out ?? join(outDir, 'keyframes.jpg'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(jpg, 'base64'));
    console.log(`✓ ${times.length} key moments → ${file}`);
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
        const curRow = await page.evaluate((x) => (window.__shots || []).filter((r) => r.start <= x).pop() ?? null, tt);
        const cur = curRow?.id ?? '';
        if (midShot.has(s) && (await page.evaluate(() => !!document.getElementById('bg')))) {
          const [mode, capBox] = await page.evaluate(() => {
            const c = document.getElementById('cap-pill'), S = document.getElementById('stage').getBoundingClientRect(), k = S.width / 1920;
            const on = c && c.textContent.trim() && getComputedStyle(c).visibility !== 'hidden' && parseFloat(getComputedStyle(c).opacity) > .35;
            const r = on ? c.getBoundingClientRect() : null;
            return [window.__composition || 'explainer', r && { x: (r.left - S.left) / k, y: (r.top - S.top) / k, w: r.width / k, h: r.height / k }];
          });
          issues.push(...compositionIssues(await inkStats(capBox), !!curRow?.hud, mode));
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
    const sub = Math.max(1, Math.round(Number(args.subframes ?? 1)));
    const total = Math.round(duration * fps);
    let i0 = 0, i1 = total;
    if (args.range) {
      const [ra, rb] = String(args.range).split(':').map(Number);
      if (!(ra >= 0 && rb > ra)) throw new Error(`--range wants a:b in seconds with b > a ≥ 0, got ${args.range}`);
      i0 = Math.min(total, Math.round(ra * fps)); i1 = Math.min(total, Math.round(rb * fps));
      if (i1 <= i0) throw new Error(`--range ${args.range} is outside the film (${duration}s)`);
    }
    const n = i1 - i0;
    const autoWorkers = Math.min(4, Math.max(1, Math.floor(cpus().length / 3)));
    const W = Math.max(1, Math.min(n, args.workers ? Math.round(Number(args.workers)) || 1 : autoWorkers));
    // one browser per worker: pages inside one browser share its GPU process, which caps a three.js film
    // (measured on a bloom scene, 3 workers: 1.7× in one browser, 2.0× in three browsers)
    const pages = [page];
    browsers.push(...(await Promise.all(Array.from({ length: W - 1 }, launch))));
    pages.push(...(await Promise.all(browsers.slice(1).map((b, w) => openPage(b, `[worker ${w + 2}] `)))));   // opened at __size
    const frames = mkdtempSync(join(tmpdir(), 'explainer-video-frames-'));
    // workers pull contiguous 1-second blocks from a shared queue (balances heavy and light stretches of the film);
    // a frame file is named by its index in the output, so the encode below is the same for any worker count
    const block = Math.max(1, Math.round(fps));
    let next = i0, done = 0, lastReport = 0;
    const t0 = Date.now();
    // the first worker that fails stops the others at their next frame; wait for all, then clean up
    const results = await Promise.allSettled(pages.map(async (pg) => {
      while (next < i1) {
        const s0 = next, s1 = Math.min(i1, next + block); next = s1;
        for (let i = s0; i < s1 && next <= i1; i++) {
          for (let k = 0; k < sub; k++) await shot((i + k / sub) / fps, join(frames, `${String((i - i0) * sub + k).padStart(6, '0')}.jpg`), pg);
          if (errors.length) { next = i1 + 1; throw new Error('stopped on a page error while rendering (first error below)'); }
          if (++done - lastReport >= fps * 5 || done === n) {
            lastReport = done;
            const el = (Date.now() - t0) / 1000;
            console.log(`frame ${done}/${n} · ${el.toFixed(0)}s elapsed · ~${(el / done * (n - done)).toFixed(0)}s left`);
          }
        }
      }
    }));
    const failure = results.find((x) => x.status === 'rejected');
    if (failure) { next = i1 + 1; rmSync(frames, { recursive: true, force: true }); throw failure.reason; }
    const renderSec = (Date.now() - t0) / 1000;
    mkdirSync(dirname(out), { recursive: true });
    // with sub-frames: read at fps×sub, average each run of `sub` frames (tmix), then keep one frame per output frame.
    // tmix at index n averages n-sub+1..n, so keep n = sub-1, 2sub-1, …: each kept frame blends exactly its own
    // sub-frames and never the previous output frame's (a hard cut on a frame boundary stays clean).
    // film grain from EX.run({ post: { grain } }) is added here, after any motion blur, so stills stay clean
    const grain = Number((await page.evaluate(() => window.__post?.grain)) || 0);
    const vf = [...(sub > 1 ? [`tmix=frames=${sub}`, `select='eq(mod(n+1\\,${sub})\\,0)'`, `setpts=N/${fps}/TB`] : []),
      ...(grain > 0 ? [`noise=alls=${Math.min(20, grain)}:allf=t`] : [])];
    const blur = vf.length ? ['-vf', vf.join(',')] : [];
    const t1 = Date.now();
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps * sub), '-i', join(frames, '%06d.jpg'),
      ...blur, '-r', String(fps),
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-crf', '16', '-maxrate', '20M', '-bufsize', '40M', '-preset', 'medium',   // the cap keeps film grain from bloating the file
      '-movflags', '+faststart', out], { stdio: 'inherit' });
    rmSync(frames, { recursive: true, force: true });
    if (r.status !== 0) throw new Error('ffmpeg encode failed');
    const span = args.range ? ` · t ${(i0 / fps).toFixed(2)}–${(i1 / fps).toFixed(2)}s of ${duration}s` : '';
    console.log(`✓ ${out} (${(n / fps).toFixed(2)}s @ ${fps}fps, ${n} frames${span}, ${width}×${height}) · ` +
      `${W} worker(s) × ${sub} subframe(s): render ${renderSec.toFixed(1)}s + encode ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }
} catch (e) {
  failed = true;
  console.error(String(e));
}
await stop(failed || errors.length ? 1 : 0, errors.length ? 'fix page errors before delivering' : '');
