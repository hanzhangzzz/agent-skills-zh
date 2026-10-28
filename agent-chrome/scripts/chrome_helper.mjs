#!/usr/bin/env node
// CDP / cookie helper for agent_chrome.py (Node built-ins only; Node >= 22 for the global WebSocket).
//   detect                          stdin rows -> "mock" | "real": which keychain encrypted this profile's cookies
//   seed --ws <browser ws>          stdin rows -> decrypt main-Chrome cookies with the macOS keychain, write via CDP
//   window --ws <browser ws> --url  open a window in the background (/json/new would bring Chrome to the front)
//   close --ws <browser ws>         Browser.close: clean shutdown that flushes cookies (SIGTERM loses recent ones)
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const MOCK_PASSWORD = "mock_password"; // what Chrome uses under --use-mock-keychain (Playwright default)
const keyFrom = (pw) => crypto.pbkdf2Sync(pw, "saltysalt", 1003, 16, "sha1");

// Returns {value, hashed} or null when the key is wrong. Chrome >= 130 (cookie DB version >= 24)
// prepends SHA-256(host_key) to the plaintext; strip it only when it actually matches.
function decrypt(evHex, key, host) {
  const enc = Buffer.from(evHex, "hex");
  if (enc.length < 3 || enc.subarray(0, 3).toString() !== "v10") return null;
  let raw;
  try {
    const d = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
    raw = Buffer.concat([d.update(enc.subarray(3)), d.final()]); // PKCS#7 check rejects most wrong keys
  } catch { return null; }
  const h = crypto.createHash("sha256").update(host).digest();
  if (raw.length >= 32 && raw.subarray(0, 32).equals(h)) return { value: raw.subarray(32).toString("utf8"), hashed: true };
  return { value: raw.toString("utf8"), hashed: false };
}

const readStdin = async () => { let s = ""; for await (const c of process.stdin) s += c; return JSON.parse(s); };

async function detect() {
  const rows = await readStdin();
  const key = keyFrom(MOCK_PASSWORD);
  const res = rows.map((r) => decrypt(r.ev, key, r.host_key));
  const mock = res.some((x) => x && x.hashed) || (rows.length >= 3 && res.every(Boolean));
  console.log(mock ? "mock" : "real");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
  };
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`cannot connect ${wsUrl}`)); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  return { open, send, close: () => ws.close() };
}

async function seed(wsUrl) {
  const rows = await readStdin();
  const pw = execFileSync("security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const key = keyFrom(pw);
  const now = Date.now() / 1000;
  const sameSite = { 0: "None", 1: "Lax", 2: "Strict" };
  const priority = { 0: "Low", 1: "Medium", 2: "High" };
  const cookies = [];
  let undecryptable = 0, expired = 0;
  for (const r of rows) {
    let value = r.value;
    if (r.ev) {
      const d = decrypt(r.ev, key, r.host_key);
      if (!d) { undecryptable += 1; continue; }
      value = d.value;
    }
    const c = { name: r.name, value, path: r.path || "/", secure: !!r.is_secure, httpOnly: !!r.is_httponly };
    if (r.host_key.startsWith(".")) c.domain = r.host_key;
    else c.url = `https://${r.host_key}${c.path}`; // host-only cookie
    if (r.has_expires && r.is_persistent) {
      c.expires = Number(r.expires_utc) / 1e6 - 11644473600;
      if (c.expires < now) { expired += 1; continue; }
    }
    if (sameSite[r.samesite]) c.sameSite = sameSite[r.samesite];
    if (priority[r.priority]) c.priority = priority[r.priority];
    cookies.push(c);
  }
  const b = cdp(wsUrl);
  await b.open;
  let imported = 0;
  const failed = [];
  for (const c of cookies) {
    try { await b.send("Storage.setCookies", { cookies: [c] }); imported += 1; } catch (e) { failed.push(`${c.name}@${c.domain || c.url}: ${e.message}`); }
  }
  b.close();
  console.log(JSON.stringify({ imported, failed: failed.length, undecryptable, expired, errors: failed.slice(0, 5) }));
}

async function windowCmd(wsUrl, url) {
  const b = cdp(wsUrl);
  await b.open;
  const r = await b.send("Target.createTarget", { url: url || "about:blank", newWindow: true, background: true });
  b.close();
  console.log(JSON.stringify(r));
}

const [cmd, ...rest] = process.argv.slice(2);
const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
async function closeCmd(wsUrl) {
  const b = cdp(wsUrl);
  await b.open;
  await b.send("Browser.close");
  b.close();
}

const cmds = { detect: () => detect(), seed: () => seed(opt("--ws")), window: () => windowCmd(opt("--ws"), opt("--url")), close: () => closeCmd(opt("--ws")) };
const run = cmds[cmd] ? cmds[cmd]() : Promise.reject(new Error(`unknown command: ${cmd}`));
run.catch((e) => { console.error(e.message); process.exit(1); });
