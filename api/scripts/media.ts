// The media library, from the terminal. Production Postgres is the single source of truth for every image, sound
// and video, each kept under its IPFS CID; Bunny hands out the public copies. This keeps static/ and it in sync.
//
//   bun media login       sign this terminal in: approve it on maia.city with the admin's passkey
//   bun media status      what production holds, and what is only here
//   bun media sync        upload what is missing (by CID, resumable), name every path, tag everything,
//                         make the public copies on Bunny, and write src/lib/media/manifest.json
//   bun media release     let git go of journal media production now serves by CID (the files stay on disk)
//   bun media library     mirror production into library/: every file as <cid>.<ext>, and index.json
//   bun media logout      revoke this terminal's key
//
//   --local               against the local API (http://localhost:3100) instead of api.maia.city
import { $ } from "bun";
import { copyFile, link, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join, relative, sep } from "node:path";
import { cidOf, EXT, kindOf, mimeOf } from "../src/media";
import { deriveTags } from "./media-tags";

const ROOT = join(import.meta.dir, "../..");
const STATIC = join(ROOT, "static");
const MANIFEST = join(ROOT, "src/lib/media/manifest.json");
const local = process.argv.includes("--local");
const API = local ? "http://localhost:3100" : "https://api.maia.city";
const SITE = local ? "http://localhost:5173" : "https://maia.city";
const CONFIG = join(homedir(), ".config", "maiacity");
const KEYS = join(CONFIG, "media-keys.json");
const CACHE = join(homedir(), ".cache", "maiacity", "cids.json");

const say = (s: string) => console.log(s);
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function keyFor(): Promise<string> {
  const k = (await readJson<Record<string, string>>(KEYS, {}))[API];
  if (!k) throw new Error(`Not signed in to ${API}. Run: bun media login${local ? " --local" : ""}`);
  return k;
}

async function call<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
  const key = init.key ?? (await keyFor());
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...(init.body && !(init.body instanceof Uint8Array) ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${body?.error ?? res.status}`);
  return body as T;
}

// ─────────────────────────────── login / logout ───────────────────────────────

async function login() {
  const res = await fetch(`${API}/api/device/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "media:admin", label: `bun media on ${hostname()}` }),
  });
  const start = (await res.json()) as { device_code: string; user_code: string; expires_in: number; interval: number; error?: string };
  if (!res.ok) throw new Error(start.error ?? "could not start");
  const url = `${SITE}/admin/device/?code=${start.user_code}`;
  say(`\nApprove this terminal with your passkey:\n\n  ${url}\n\n  code ${start.user_code}\n`);
  await $`open ${url}`.quiet().nothrow();
  const until = Date.now() + start.expires_in * 1000;
  while (Date.now() < until) {
    await Bun.sleep(start.interval * 1000);
    const r = await fetch(`${API}/api/device/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device_code: start.device_code }) });
    if (r.status === 428) continue;
    const body = (await r.json()) as { key?: string; error?: string };
    if (!r.ok || !body.key) throw new Error(body.error ?? "not approved");
    await mkdir(CONFIG, { recursive: true });
    const keys = await readJson<Record<string, string>>(KEYS, {});
    keys[API] = body.key;
    await writeFile(KEYS, JSON.stringify(keys, null, 2), { mode: 0o600 });
    return say(`Signed in to ${API}. The key is in ${KEYS}.`);
  }
  throw new Error("The code expired before it was approved. Run login again.");
}

async function logout() {
  const keys = await readJson<Record<string, string>>(KEYS, {});
  if (!keys[API]) return say("Not signed in.");
  await call("/api/device/key", { method: "DELETE" }).catch(() => {});
  delete keys[API];
  await writeFile(KEYS, JSON.stringify(keys, null, 2), { mode: 0o600 });
  say("Signed out; the key is revoked.");
}

// ─────────────────────────────── what is here ───────────────────────────────

type Local = { path: string; file: string; size: number; cid: string };

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** Every media file in static/, with its CID — remembered by size and time, so 600 MB is not hashed every run. */
async function here(): Promise<Local[]> {
  const cache = await readJson<Record<string, { size: number; mtime: number; cid: string }>>(CACHE, {});
  const out: Local[] = [];
  for (const file of (await walk(STATIC)).filter((f) => kindOf(mimeOf(f)) !== "other")) {
    const st = await stat(file);
    const hit = cache[file];
    const cid = hit && hit.size === st.size && hit.mtime === st.mtimeMs ? hit.cid : await cidOf(new Uint8Array(await readFile(file)));
    cache[file] = { size: st.size, mtime: st.mtimeMs, cid };
    out.push({ path: "/" + relative(STATIC, file).split(sep).join("/"), file, size: st.size, cid });
  }
  await mkdir(join(CACHE, ".."), { recursive: true });
  await writeFile(CACHE, JSON.stringify(cache));
  return out;
}

type Remote = { cid: string; mime: string; kind: string; paths: string[]; tags: string[]; cdn_path: string | null; stream_guid: string | null; size: number };
const library = async () => (await call<{ media: Remote[] }>("/api/media")).media;

async function status() {
  const files = await here();
  const lib = await library();
  const held = new Map(lib.map((m) => [m.cid, m]));
  const missing = files.filter((f) => !held.has(f.cid));
  const unnamed = files.filter((f) => held.has(f.cid) && !held.get(f.cid)!.paths.includes(f.path));
  const noCopy = lib.filter((m) => !m.cdn_path && !m.stream_guid);
  say(`production (${API}) holds ${lib.length} files, ${mb(lib.reduce((n, m) => n + m.size, 0))}`);
  say(`here: ${files.length} files in static/`);
  say(`  in production:                  ${files.length - missing.length}`);
  say(`  only here — sync uploads them:  ${missing.length}${missing.length ? ` (${mb(missing.reduce((n, f) => n + f.size, 0))})` : ""}`);
  for (const f of missing) say(`    ${f.cid}  ${f.path}`);
  if (unnamed.length) say(`  in production under another name: ${unnamed.length} — sync names them`);
  say(`production files without a public copy on Bunny: ${noCopy.length}`);
  return { files, lib, missing };
}

// ─────────────────────────────── sync ───────────────────────────────

async function upload(f: Local) {
  const start = await call<{ id: string; chunk: number; parts: number; received: number[] }>("/api/media/uploads", {
    method: "POST",
    body: JSON.stringify({ path: f.path, size: f.size, cid: f.cid, mime: mimeOf(f.file) }),
  });
  const bytes = new Uint8Array(await readFile(f.file));
  const todo = [...Array(start.parts).keys()].filter((i) => !start.received.includes(i));
  let next = 0, sent = start.received.length;
  const worker = async () => {
    while (next < todo.length) {
      const i = todo[next++]!;
      await call(`/api/media/uploads/${start.id}/${i}`, { method: "PUT", body: bytes.subarray(i * start.chunk, (i + 1) * start.chunk), headers: { "content-type": "application/octet-stream" } });
      sent++;
      if (start.parts > 8) process.stdout.write(`\r  ${f.path}  ${Math.round((sent / start.parts) * 100)}%   `);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (start.parts > 8) process.stdout.write("\n");
  return call<{ cid: string; stored: boolean }>(`/api/media/uploads/${start.id}/finish`, { method: "POST" });
}

async function sync() {
  const { files, lib, missing } = await status();
  say("");
  const unique = [...new Map(missing.map((f) => [f.cid, f])).values()];
  for (const [i, f] of unique.entries()) {
    const r = await upload(f);
    say(`${String(i + 1).padStart(4)}/${unique.length} ${r.stored ? "stored" : "known "} ${r.cid}  ${f.path} (${mb(f.size)})`);
  }
  // every path names its CID — the duplicates too, and files production had under another name
  const named = new Map(lib.map((m) => [m.cid, new Set(m.paths)]));
  const unnamed = files.filter((f) => !named.get(f.cid)?.has(f.path) && !unique.some((u) => u.path === f.path));
  for (const f of unnamed) await call("/api/media/paths", { method: "POST", body: JSON.stringify({ path: f.path, cid: f.cid }) });
  if (unnamed.length) say(`named ${unnamed.length} paths`);

  const after = await library();
  const tags = await deriveTags(ROOT, after.flatMap((m) => m.paths.map((path) => ({ path, cid: m.cid }))));
  await call("/api/media/tags", { method: "PUT", body: JSON.stringify({ tags: Object.fromEntries([...tags].map(([c, t]) => [c, [...t]])) }) });
  say(`tagged ${tags.size} files`);

  // videos a post already streams keep their Stream copy (its `video:` guid for its `videoLocal:` file)
  const byPath = new Map(files.map((f) => [f.path, f.cid]));
  for (const post of await readdir(join(ROOT, "blog"), { withFileTypes: true })) {
    if (!post.isDirectory()) continue;
    const md = await readFile(join(ROOT, "blog", post.name, "post.md"), "utf8").catch(() => "");
    const guid = /^video:\s*([0-9a-f-]{36})\s*$/m.exec(md)?.[1];
    const cid = byPath.get(/^videoLocal:\s*(\S+)\s*$/m.exec(md)?.[1] ?? "");
    const known = after.find((m) => m.cid === cid);
    if (guid && cid && known?.stream_guid !== guid) {
      await call("/api/media/streamed", { method: "POST", body: JSON.stringify({ cid, stream_guid: guid }) });
      say(`${post.name}: its film stays the Stream video ${guid}`);
    }
  }

  say("making the public copies on Bunny…");
  try {
    let waiting = Infinity;
    for (let i = 0; i < 180 && waiting > 0; i++) {
      waiting = (await call<{ waiting: number }>("/api/media/distribute", { method: "POST" })).waiting;
      if (waiting) process.stdout.write(`\r  ${waiting} still to copy   `), await Bun.sleep(5000);
    }
    say(waiting ? "\n  some copies are still being made — sync again later" : "\r  every file has its public copy   ");
  } catch (e) {
    say(`  not now: ${(e as Error).message}`);
  }

  const manifest = await (await fetch(`${API}/api/media/manifest`)).json();
  await writeFile(MANIFEST, JSON.stringify(manifest, null, "\t") + "\n");
  say(`manifest: ${Object.keys(manifest).length} paths on the CDN → src/lib/media/manifest.json`);
}

// ─────────────────────────────── release ───────────────────────────────

/** Journal media (static/day-*) that production serves by CID leave git; they stay on disk, and .gitignore keeps them out. */
async function release() {
  const manifest = await readJson<Record<string, { cid: string; url: string }>>(MANIFEST, {});
  const tracked = (await $`git -C ${ROOT} ls-files static`.text()).split("\n").filter((f) => /^static\/day-[^/]+\//.test(f));
  const go = tracked.filter((f) => manifest[f.slice("static".length)]?.url);
  for (let i = 0; i < go.length; i += 100) await $`git -C ${ROOT} rm -q --cached -- ${go.slice(i, i + 100)}`;
  say(go.length ? `released ${go.length} files from git — commit to make it so; they stay on disk, production holds them by CID` : "nothing to release");
  const left = tracked.length - go.length;
  if (left) say(`${left} journal files are still in git: not on the CDN yet (run sync first)`);
}

// ─────────────────────────────── library ───────────────────────────────

/**
 * A plain, flat copy of the library: library/<cid>.<ext> for every file production holds, and library/index.json
 * (cid → paths, tags, public copy). Local files are hard-linked (no extra disk), the rest downloaded. A file's name
 * is its content: two folders can be compared by listing them.
 */
async function mirror() {
  const DIR = join(ROOT, "library");
  await mkdir(DIR, { recursive: true });
  const lib = await library();
  const localByCid = new Map((await here()).map((f) => [f.cid, f.file]));
  const present = new Set(await readdir(DIR));
  let linked = 0, fetched = 0;
  for (const m of lib) {
    const name = `${m.cid}.${EXT[m.mime] ?? "bin"}`;
    if (present.has(name)) continue;
    const target = join(DIR, name);
    const from = localByCid.get(m.cid);
    if (from) {
      await link(from, target).catch(() => copyFile(from, target));
      linked++;
    } else {
      const res = await fetch(`${API}/api/media/${m.cid}`, { headers: { authorization: `Bearer ${await keyFor()}` } });
      if (!res.ok) throw new Error(`download ${m.cid}: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if ((await cidOf(bytes)) !== m.cid) throw new Error(`${m.cid} arrived with different bytes`);
      await writeFile(target, bytes);
      fetched++;
    }
  }
  const index = Object.fromEntries(
    lib.map((m) => [m.cid, { file: `${m.cid}.${EXT[m.mime] ?? "bin"}`, mime: m.mime, kind: m.kind, size: m.size, paths: m.paths, tags: m.tags, cdn: m.cdn_path ? `https://maia.city/${m.cdn_path}` : null, stream: m.stream_guid }]),
  );
  await writeFile(join(DIR, "index.json"), JSON.stringify(index, null, 2) + "\n");
  const names = new Set(Object.values(index).map((e) => e.file));
  const extra = (await readdir(DIR)).filter((f) => f !== "index.json" && !names.has(f));
  say(`library/: ${lib.length} files (${linked} linked from static/, ${fetched} downloaded), index.json written`);
  if (extra.length) say(`  ${extra.length} files here that production does not hold: ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? " …" : ""}`);
}

const cmd = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "status";
const run = { login, logout, status, sync, release, library: mirror }[cmd as "login"];
if (!run) {
  say("usage: bun media login | status | sync | release | library | logout  [--local]");
  process.exit(1);
}
try {
  await run();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
