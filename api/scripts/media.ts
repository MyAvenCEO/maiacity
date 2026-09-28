// The media library, from the terminal. library/ is the single source of truth: every file once as <cid>.<ext>,
// described beside it in <cid>.json (title, description, tags, meta, public) — no paths. The databases are seeded
// from it; the site and the servers only read the databases (in production, the CDN copies of the public files).
//
//   bun media login        sign this terminal in: approve it on maia.city with the admin's passkey
//   bun media status       what library/ holds, and how the database differs from it
//   bun media seed         make the database match library/: upload the files it lacks, describe every file as
//                          library/ does, make the public copies (production), write the site's manifest
//                          (--public: upload only the public files — the site's — and still describe all it holds)
//   bun media add <file> [--title "…"] [--description "…"] [--tags a,b] [--replaces <cid>] [--public]
//                          bring a file into library/ (copied, described) and into the database; the file it
//                          replaces (by CID) is marked superseded
//   bun media manifest     write the site's manifest from the database (public files by CID, with their tags)
//   bun media logout       revoke this terminal's key
//
//   --local                against the local database (http://localhost:3100) instead of production
import { $ } from "bun";
import { readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { API, call, keyFor, local, mb, ROOT, saveKey, say, SITE, upload } from "./media-client";
import { all, fileOf, get, put, type Doc } from "./library";

const MANIFEST = join(ROOT, "src/lib/media", local ? "manifest.local.json" : "manifest.json");

// ─────────────────────────────── login / logout ───────────────────────────────

async function login() {
  const res = await fetch(`${API}/api/device/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "media:admin", label: `bun media on ${hostname()}` }),
  });
  const start = (await res.json()) as { device_code: string; user_code: string; expires_in: number; interval: number; error?: string };
  if (!res.ok) throw new Error(start.error ?? "could not start");
  const url = `${SITE}/app/device/?code=${start.user_code}`;
  say(`\nApprove this terminal with your passkey:\n\n  ${url}\n\n  code ${start.user_code}\n`);
  await $`open ${url}`.quiet().nothrow();
  const until = Date.now() + start.expires_in * 1000;
  while (Date.now() < until) {
    await Bun.sleep(start.interval * 1000);
    const r = await fetch(`${API}/api/device/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device_code: start.device_code }) });
    if (r.status === 428) continue;
    const body = (await r.json()) as { key?: string; error?: string };
    if (!r.ok || !body.key) throw new Error(body.error ?? "not approved");
    await saveKey(body.key);
    return say(`Signed in to ${API}. The key is kept in ~/.config/maiacity/media-keys.json.`);
  }
  throw new Error("The code expired before it was approved. Run login again.");
}

async function logout() {
  if (!(await keyFor().catch(() => null))) return say("Not signed in.");
  await call("/api/device/key", { method: "DELETE" }).catch(() => {});
  await saveKey(null);
  say("Signed out; the key is revoked.");
}

// ─────────────────────────────── status / seed ───────────────────────────────

type Row = { cid: string; mime: string; kind: string; size: number; title: string; description: string; tags: string[]; meta: Record<string, unknown>; public: boolean };
const database = async () => (await call<{ media: Row[] }>("/api/media")).media;

/** Whether the database describes a file as library/ does. */
const same = (d: Doc, r: Row) =>
  d.title === r.title && d.description === r.description && d.public === r.public &&
  JSON.stringify([...d.tags].sort()) === JSON.stringify([...r.tags].sort()) && JSON.stringify(d.meta) === JSON.stringify(r.meta ?? {});

async function compare() {
  const docs = await all();
  const rows = new Map((await database()).map((r) => [r.cid, r]));
  const missing = docs.filter((d) => !rows.has(d.cid));
  const differ = docs.filter((d) => rows.has(d.cid) && !same(d, rows.get(d.cid)!));
  const extra = [...rows.values()].filter((r) => !docs.some((d) => d.cid === r.cid));
  return { docs, missing, differ, extra };
}

async function status() {
  const { docs, missing, differ, extra } = await compare();
  say(`library/: ${docs.length} files, ${mb(docs.reduce((n, d) => n + d.size, 0))} — ${docs.filter((d) => d.public).length} public`);
  say(`${API}:`);
  say(`  to upload:     ${missing.length}${missing.length ? ` (${mb(missing.reduce((n, d) => n + d.size, 0))})` : ""}`);
  say(`  to describe:   ${differ.length}`);
  if (extra.length) say(`  not in library/: ${extra.length} — the database holds them, library/ does not (${extra.slice(0, 3).map((r) => r.title || r.cid).join(", ")}${extra.length > 3 ? " …" : ""})`);
}

async function seed() {
  const all = await compare();
  const { docs, differ, extra } = all;
  // --public: only the files the site shows go up (production's volume is not the place for the working files)
  const missing = process.argv.includes("--public") ? all.missing.filter((d) => d.public) : all.missing;
  if (missing.length < all.missing.length) say(`${all.missing.length - missing.length} private files stay in library/ (--public)`);
  say(`${API}: ${missing.length} to upload (${mb(missing.reduce((n, d) => n + d.size, 0))}), ${differ.length} to describe`);
  for (const [i, d] of missing.entries()) {
    const r = await upload(new Uint8Array(await readFile(await fileOf(d.cid))), { cid: d.cid, mime: d.mime, title: d.title, description: d.description, tags: d.tags, meta: d.meta, public: d.public, progress: true });
    say(`${String(i + 1).padStart(4)}/${missing.length} ${r.stored ? "stored" : "known "} ${d.cid}  ${d.title} (${mb(d.size)})`);
  }
  for (const d of differ)
    await call("/api/media/describe", { method: "POST", body: JSON.stringify({ cid: d.cid, title: d.title, description: d.description, tags: d.tags, meta: d.meta, public: d.public }) });
  if (differ.length) say(`described ${differ.length}`);
  if (extra.length) say(`  ${extra.length} files the database holds that library/ does not — left as they are`);
  // the public copies (production has the Bunny key; a local database has none)
  try {
    let waiting = Infinity;
    for (let i = 0; i < 180 && waiting > 0; i++) {
      waiting = (await call<{ waiting: number }>("/api/media/distribute", { method: "POST" })).waiting;
      if (waiting) process.stdout.write(`\r  ${waiting} public copies still to make   `), await Bun.sleep(5000);
    }
    say(waiting ? "\n  some copies are still being made — seed again later" : "\r  every public file has its copy on the CDN   ");
  } catch (e) {
    say(`public copies: not here (${(e as Error).message})`);
  }
  await manifest(docs.length);
}

// ─────────────────────────────── manifest ───────────────────────────────

/**
 * The site's list of public files, by CID, with their titles and tags (the site finds a picture by CID, or a set —
 * the author portraits, the sounds — by tag). From production: where each is on the CDN (src/lib/media/manifest.json,
 * in git). From the local database: the same, loaded from the local API (manifest.local.json, not in git).
 */
async function manifest(_n?: number) {
  const out: Record<string, unknown> = {};
  if (local) {
    for (const r of await database()) if (r.public) out[r.cid] = { url: null, mime: r.mime, title: r.title, description: r.description, tags: r.tags };
  } else Object.assign(out, await (await fetch(`${API}/api/media/manifest`)).json());
  await writeFile(MANIFEST, JSON.stringify(out, null, "\t") + "\n");
  say(`manifest: ${Object.keys(out).length} public files → ${MANIFEST.slice(ROOT.length + 1)}`);
}

// ─────────────────────────────── add ───────────────────────────────

async function add() {
  const argv = process.argv.slice(3);
  const opt = (k: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
  const list = (k: string) => opt(k)?.split(",").map((t) => t.trim()).filter(Boolean);
  const [file] = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.match(/^--(title|description|tags|replaces)$/));
  if (!file) throw new Error('usage: bun media add <file> [--title "…"] [--description "…"] [--tags a,b] [--replaces <cid>] [--public] [--local]');
  const d = await put(file, { title: opt("title"), description: opt("description"), tags: list("tags"), replaces: list("replaces"), public: argv.includes("--public") ? true : undefined });
  const r = await upload(new Uint8Array(await readFile(await fileOf(d.cid))), { cid: d.cid, mime: d.mime, title: d.title, description: d.description, tags: d.tags, meta: d.meta, public: d.public, progress: true });
  say(`${r.stored ? "stored" : "known "} ${d.cid}  ${d.title} [${d.tags.join(", ")}]`);
  // the file it replaces is described again (superseded)
  for (const old of list("replaces") ?? []) {
    const o = await get(old);
    if (o) await call("/api/media/describe", { method: "POST", body: JSON.stringify({ cid: o.cid, tags: o.tags }) }).catch(() => {});
  }
}

const cmd = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "status";
const run = { login, logout, status, seed, add, manifest: () => manifest() }[cmd as "login"];
if (!run) {
  say("usage: bun media login | status | seed | add <file> … | manifest | logout  [--local]");
  process.exit(1);
}
try {
  await run();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
