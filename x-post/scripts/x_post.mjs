#!/usr/bin/env node
// Post a tweet or a thread to X with the login already present in the user's
// local Chrome profile. Drives the X web composer through `agent-browser`;
// no X API, no reverse-engineered endpoints. Default is a dry run that only
// composes and screenshots; `--post` actually publishes.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const USAGE = `Usage:
  x_post.mjs (--file <posts.md> | --text <text>) [--image <path>]... [--profile Default]
             [--session x-post] [--out <dir>] [--post] [--allow-long] [--headless]
  x_post.mjs --check-login [--profile Default]

--file     Markdown-ish file: posts separated by a line that is exactly "---".
           Inside a post, a line "image: <path>" (relative to the file) attaches
           an image; up to 4 per post. Images are only supported on the first post.
--text     Single post text (use --file for threads).
--image    Attach image(s) to the first post (repeatable, max 4).
--profile  Chrome profile directory name (Default, "Profile 1", ...). Default: Default.
--session  agent-browser session name. Default: x-post.
--out      Directory for screenshots and result.json. Default: ./x-post-out.
--post     Publish. Without it the composer is filled and screenshotted only.
--allow-long  Skip the 280 weighted-character check (Premium accounts).
--headless    Do not show the browser window.
`;

function parseArgs(argv) {
  const a = { images: [], profile: "Default", session: "x-post", out: "x-post-out", post: false, allowLong: false, headed: true };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]; const next = () => argv[++i];
    if (k === "--file") a.file = next();
    else if (k === "--text") a.text = next();
    else if (k === "--image") a.images.push(next());
    else if (k === "--profile") a.profile = next();
    else if (k === "--session") a.session = next();
    else if (k === "--out") a.out = next();
    else if (k === "--post") a.post = true;
    else if (k === "--allow-long") a.allowLong = true;
    else if (k === "--headless") a.headed = false;
    else if (k === "--check-login") a.checkLogin = true;
    else if (k === "--help" || k === "-h") { console.log(USAGE); process.exit(0); }
    else throw new Error(`Unknown argument: ${k}`);
  }
  return a;
}

// ---------- content ----------
export function parsePostsFile(text, baseDir) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n---\n/);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const images = [];
    const kept = [];
    for (const line of lines) {
      const m = line.match(/^image:\s*(.+)$/);
      if (m) images.push(path.resolve(baseDir, m[1].trim()));
      else kept.push(line);
    }
    return { text: kept.join("\n").trim(), images };
  }).filter((p) => p.text.length > 0);
}

// X weighted length: URLs count 23, CJK/emoji count 2, everything else 1. Limit 280.
export function weightedLength(text) {
  let s = text.replace(/https?:\/\/\S+|(?:^|\s)(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, (m) => " ".repeat(23));
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
      || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xffef)
      || (cp >= 0x20000 && cp <= 0x3ffff) || (cp >= 0x1f000);
    n += wide ? 2 : 1;
  }
  return n;
}

// ---------- Chrome cookies (macOS) ----------
function decryptChromeCookie(encryptedHex, safeStoragePassword) {
  const encrypted = Buffer.from(encryptedHex, "hex");
  if (encrypted.subarray(0, 3).toString() !== "v10") return "";
  const key = crypto.pbkdf2Sync(safeStoragePassword, "saltysalt", 1003, 16, "sha1");
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  decipher.setAutoPadding(false);
  const raw = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  const pad = raw[raw.length - 1];
  const unpadded = raw.subarray(0, raw.length - pad);
  // Chrome >= 130 prefixes the value with a 32-byte SHA-256 of the host key.
  const value = unpadded.length > 32 ? unpadded.subarray(32) : unpadded;
  return value.toString("utf8");
}

function chromeXStateFile(profile) {
  if (process.platform !== "darwin") throw new Error("Chrome cookie extraction is macOS-only.");
  const src = path.join(os.homedir(), "Library/Application Support/Google/Chrome", profile, "Cookies");
  if (!fs.existsSync(src)) throw new Error(`Chrome cookie DB not found: ${src}`);
  // The keychain lookup may show a macOS prompt once; the user must click Allow.
  const pw = execFileSync("security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-post-"));
  const db = path.join(tmpDir, "Cookies.sqlite");
  fs.copyFileSync(src, db); // the live DB is locked by Chrome; always read a copy
  const sql = "select host_key,name,path,is_secure,is_httponly,expires_utc,hex(encrypted_value) from cookies where host_key like '%x.com' and name in ('auth_token','ct0','twid','guest_id','personalization_id','kdt');";
  const rows = execFileSync("sqlite3", ["-separator", "\t", db, sql], { encoding: "utf8" }).split("\n").filter(Boolean);
  fs.rmSync(db, { force: true });
  const cookies = rows.map((line) => {
    const [domain, name, p, sec, ho, exp, hex] = line.split("\t");
    const value = decryptChromeCookie(hex, pw);
    return { name, value, domain, path: p || "/", secure: sec === "1", httpOnly: ho === "1", expires: Number(exp) > 0 ? Math.floor(Number(exp) / 1e6 - 11644473600) : -1, sameSite: "Lax" };
  }).filter((c) => c.value);
  if (!cookies.some((c) => c.name === "auth_token") || !cookies.some((c) => c.name === "ct0")) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Chrome profile "${profile}" has no X login cookies. Open Chrome with that profile, log in to x.com, then retry.`);
  }
  const state = path.join(tmpDir, "state.json");
  fs.writeFileSync(state, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
  return { state, tmpDir };
}

// ---------- agent-browser ----------
function makeBrowser(session) {
  const env = { ...process.env, AGENT_BROWSER_SESSION: session, AGENT_BROWSER_SESSION_NAME: session };
  const run = (args, opts = {}) => execFileSync("agent-browser", args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
  const quiet = (args) => { try { return run(args); } catch { return ""; } };
  // `eval` prints the value; objects arrive as a JSON-encoded string, so unwrap twice.
  const evalJson = (js) => {
    const out = run(["eval", `JSON.stringify(${js})`]).split("\n").pop();
    let v = JSON.parse(out);
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* plain string */ } }
    return v;
  };
  return { run, quiet, evalJson };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });

  // Fail fast on external dependencies.
  for (const bin of ["agent-browser", "sqlite3", "security"]) {
    try { execFileSync("which", [bin], { stdio: "ignore" }); } catch { throw new Error(`Missing dependency: ${bin}`); }
  }

  let posts = [];
  if (!args.checkLogin) {
    if (args.file) posts = parsePostsFile(fs.readFileSync(args.file, "utf8"), path.dirname(path.resolve(args.file)));
    else if (args.text) posts = [{ text: args.text, images: [] }];
    else throw new Error("Provide --file or --text.\n" + USAGE);
    if (args.images.length) posts[0].images.push(...args.images.map((p) => path.resolve(p)));
    if (posts.length === 0) throw new Error("No post text found.");
    posts.forEach((p, i) => {
      if (i > 0 && p.images.length) throw new Error(`Images are only supported on the first post (post ${i + 1} has ${p.images.length}).`);
      if (p.images.length > 4) throw new Error("At most 4 images per post.");
      for (const img of p.images) if (!fs.existsSync(img)) throw new Error(`Image not found: ${img}`);
      const w = weightedLength(p.text);
      if (w > 280 && !args.allowLong) throw new Error(`Post ${i + 1} is ${w} weighted characters (> 280). Shorten it or pass --allow-long on a Premium account.`);
    });
  }

  const { state, tmpDir } = chromeXStateFile(args.profile);
  const b = makeBrowser(args.session);
  try {
    b.quiet(["close"]);
    await sleep(800);
    b.run(["--state", state, "open", "https://x.com/home", ...(args.headed ? ["--headed"] : [])]);
    await sleep(4000);
    const handle = b.evalJson(`document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || null`);
    if (!handle) throw new Error("Not logged in after injecting Chrome cookies (login page shown). Log in to x.com in Chrome and retry.");
    const account = handle.replace(/^\//, "");
    if (args.checkLogin) { console.log(JSON.stringify({ loggedIn: true, account })); return; }

    // First post goes into the inline composer on /home.
    b.run(["click", 'div[data-testid="tweetTextarea_0"]']);
    b.run(["keyboard", "inserttext", posts[0].text]); // inserttext keeps newlines and emoji intact
    if (posts[0].images.length) {
      b.run(["upload", 'input[data-testid="fileInput"]', ...posts[0].images]);
      await sleep(2500);
    }
    // Every extra post is added with the "+" button, which moves the whole
    // draft into a modal dialog. From then on scope every selector to the dialog.
    for (let i = 1; i < posts.length; i += 1) {
      b.run(["click", 'a[data-testid="addButton"], button[data-testid="addButton"]']);
      await sleep(1000);
      b.run(["click", `div[role="dialog"] div[data-testid="tweetTextarea_${i}"]`]);
      b.run(["keyboard", "inserttext", posts[i].text]);
      await sleep(600);
    }
    const check = b.evalJson(`(() => {
      const root = document.querySelector('div[role="dialog"]') || document;
      const areas = Array.from(root.querySelectorAll('div[data-testid^="tweetTextarea_"]')).filter(e => /^tweetTextarea_\\d+$/.test(e.dataset.testid));
      const btn = root.querySelector('button[data-testid="tweetButton"], button[data-testid="tweetButtonInline"]');
      return { inDialog: root !== document, texts: areas.map(e => e.innerText), images: root.querySelectorAll('div[data-testid="attachments"] img').length, button: btn ? btn.innerText : null, disabled: btn ? btn.disabled : null };
    })()`);
    const expectedImages = posts[0].images.length;
    const problems = [];
    if (check.texts.length !== posts.length) problems.push(`composer has ${check.texts.length} posts, expected ${posts.length}`);
    posts.forEach((p, i) => { if ((check.texts[i] || "").trim() !== p.text.trim()) problems.push(`post ${i + 1} text differs from input`); });
    if (check.images !== expectedImages) problems.push(`composer shows ${check.images} images, expected ${expectedImages}`);
    if (!check.button || check.disabled) problems.push("post button missing or disabled (over limit or still uploading)");
    const shot = path.join(out, args.post ? "before-post.png" : "dry-run.png");
    b.quiet(["screenshot", shot]);
    if (problems.length) throw new Error(`Composer verification failed: ${problems.join("; ")}. Screenshot: ${shot}`);

    if (!args.post) {
      const result = { mode: "dry-run", account, posts: posts.length, images: expectedImages, screenshot: shot, note: "Composer left open in the browser window; rerun with --post to publish." };
      fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    b.run(["click", check.inDialog ? 'div[role="dialog"] button[data-testid="tweetButton"]' : 'button[data-testid="tweetButtonInline"]']);
    await sleep(6000);
    const stillOpen = b.evalJson(`!!document.querySelector('div[role="dialog"] button[data-testid="tweetButton"]')`);
    if (stillOpen) throw new Error("The composer dialog is still open after clicking Post; X may have rejected the post. See the browser window.");

    // Find the new post on the profile, then verify the thread on its own page.
    b.run(["open", `https://x.com/${account}`]);
    await sleep(5000);
    const head = posts[0].text.slice(0, 20);
    const found = b.evalJson(`Array.from(document.querySelectorAll('article')).map(a => ({ url: a.querySelector('a[href*="/status/"]:has(time)')?.getAttribute('href') || null, text: a.querySelector('div[data-testid="tweetText"]')?.innerText || '' })).find(x => x.url && x.text.startsWith(${JSON.stringify(head)})) || null`);
    if (!found) throw new Error("Post was sent but could not be located on the profile page; check the account timeline manually.");
    const url = `https://x.com${found.url}`;
    b.run(["open", url]);
    await sleep(5000);
    const verify = b.evalJson(`({ own: Array.from(document.querySelectorAll('article')).filter(a => a.querySelector('a[href="/${account}"]')).length, image: !!document.querySelector('article div[data-testid="tweetPhoto"] img') })`);
    const after = path.join(out, "posted.png");
    b.quiet(["screenshot", after]);
    const result = { mode: "posted", account, url, verified: { posts: verify.own, expectedPosts: posts.length, image: verify.image, expectedImage: expectedImages > 0 }, screenshot: after };
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true }); // never leave decrypted cookies on disk
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => { console.error(`x_post: ${error.message}`); process.exit(1); });
}
