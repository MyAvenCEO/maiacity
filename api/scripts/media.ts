// The media, from the terminal. Every file lives in the vault — on this Mac in the maiaCITY Studio app, and on the
// server peer — known by its BLAKE3 hash, described (title, description, tags, meta, public); no paths. The API keeps
// only a mirror of the catalog (for the site and the board), never the bytes.
//
//   bun media login        sign this terminal in: approve it on maia.city with the admin's passkey
//   bun media status       what this Mac's vault holds, and what production's mirror of it has
//   bun media add <file> [--title "…"] [--description "…"] [--tags a,b] [--replaces <hash>] [--public]
//                          bring a file into the vault (the app's three-hash check), described; the file it replaces
//                          (by hash) is kept, tagged superseded
//   bun media add-sequence <dir> [--profile aces2065-1|acescg|linear-rec709] [--fps 24] [--title "…"] [--tags a,b]
//                          an EXR sequence (a folder of frames, e.g. a Luma / Kling / LTX export) packed into one tar
//                          and brought in as one clip; its colour profile given, or read from the EXR header
//   bun media logout       revoke this terminal's key
//
//   --local                sign in to (or out of) the local API (http://localhost:3100) instead of production
//
// add and add-sequence need the Mac app running (its local vault server).
import { $ } from "bun";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { API, call, keyFor, mb, ROOT, saveKey, say, SITE } from "./media-client";
import { packSequence } from "./library";
import { add as addFile, list } from "../../scripts/film/vault.mjs";

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

// ─────────────────────────────── status ───────────────────────────────

async function status() {
  const here = await list();
  say(`this Mac's vault: ${here.length} files, ${mb(here.reduce((n, m) => n + m.size, 0))} — ${here.filter((m) => m.public).length} public`);
  const mirror = await call<{ hash: string; size: number; stored: boolean }[]>("/api/vault/files").catch((e: Error) => (say(`${API}: ${e.message}`), null));
  if (!mirror) return;
  const known = new Set(mirror.map((f) => f.hash));
  const stored = mirror.filter((f) => f.stored);
  say(`${API}: ${mirror.length} files described, ${stored.length} stored (${mb(stored.reduce((n, f) => n + f.size, 0))})`);
  const behind = here.filter((m) => !known.has(m.hash));
  if (behind.length) say(`  not there yet: ${behind.length} — ${behind.slice(0, 3).map((m) => m.title || m.hash.slice(0, 12)).join(", ")}${behind.length > 3 ? " …" : ""} (the app syncs them)`);
}

// ─────────────────────────────── add ───────────────────────────────

async function add() {
  const argv = process.argv.slice(3);
  const opt = (k: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
  const list = (k: string) => opt(k)?.split(",").map((t) => t.trim()).filter(Boolean);
  const [file] = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.match(/^--(title|description|tags|replaces)$/));
  if (!file) throw new Error('usage: bun media add <file> [--title "…"] [--description "…"] [--tags a,b] [--replaces <hash>] [--public]');
  const r = await addFile(file, { title: opt("title"), description: opt("description"), tags: list("tags"), replaces: list("replaces"), public: argv.includes("--public") ? true : undefined });
  say(`${r.verdict === "duplicate" ? "known" : "added"} ${r.hash}  ${r.meta?.title || basename(file)} [${(r.meta?.tags ?? []).join(", ")}]`);
}

// ─────────────────────────────── add-sequence ───────────────────────────────

/**
 * Generated footage comes as EXR frames (Luma Ray 3, Kling, LTX: scene-linear ACES2065-1, or linear EXR): the whole
 * sequence goes into the library as one tar (application/x-tar) with meta { sequence: 'exr', fps, frames, color }.
 * The render worker unpacks it to render and to make its ACEScct proxy.
 */
async function addSequence() {
  const argv = process.argv.slice(3);
  const opt = (k: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
  const [dir] = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.match(/^--(profile|fps|title|description|tags)$/));
  if (!dir) throw new Error('usage: bun media add-sequence <dir> [--profile aces2065-1|acescg|linear-rec709] [--fps 24] [--title "…"] [--tags a,b]');
  // color.js is plain JS shared with the browser: loaded by path, so this TypeScript does not type it
  const colorModule = join(ROOT, "game/film/color.js");
  const color = (await import(colorModule)) as { PROFILES: Record<string, { linear: boolean }>; exrHeader: (b: Uint8Array) => unknown; exrProfile: (h: unknown) => string | null };
  const tar = join(ROOT, "studio", `sequence-${Date.now()}.tar`);
  await $`mkdir -p ${join(ROOT, "studio")}`.quiet();
  const { frames, first } = await packSequence(dir, tar);
  const header = color.exrHeader(new Uint8Array(await readFile(first)).subarray(0, 65536));
  const fromHeader = color.exrProfile(header);
  const given = opt("profile");
  if (given && !(given in color.PROFILES)) throw new Error(`--profile is one of ${Object.keys(color.PROFILES).join(", ")}`);
  const profile = given ?? fromHeader;
  if (!profile) throw new Error("the EXR header names primaries this pipeline does not know: give --profile");
  if (given && fromHeader && given !== fromHeader) say(`note: the EXR header says ${fromHeader}; kept ${given} as given`);
  const fps = Number(opt("fps") ?? 24);
  if (!(fps > 0 && fps <= 120)) throw new Error("--fps is a number of frames per second");
  const [w, h, pix] = (await $`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of csv=p=0 ${first}`.quiet().nothrow().text()).trim().split(",");
  const size = [Number(w), Number(h)];
  const d = await addFile(tar, {
    title: opt("title") ?? dir.split("/").filter(Boolean).pop(),
    description: opt("description") ?? `EXR sequence · ${frames} frames at ${fps} fps · ${profile}`,
    tags: ["sequence:exr", ...(opt("tags")?.split(",").map((t) => t.trim()).filter(Boolean) ?? [])],
    meta: {
      sequence: "exr", fps, frames, duration_s: Number((frames / fps).toFixed(3)),
      ...(size.length === 2 && size.every((n) => n > 0) ? { width: size[0], height: size[1] } : {}),
      color: { profile, primaries: profile, transfer: "linear", matrix: "gbr", range: "pc", bitDepth: /f16/.test(pix ?? "") ? 16 : 32, detectedFrom: given ? "given at ingest (--profile)" : "EXR header" },
    },
  });
  await $`rm -f ${tar}`.quiet();
  say(`${d.hash}  ${d.meta?.title ?? ""} · ${frames} frames · ${profile} (its proxy follows from the Mac app)`);
}

const cmd = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "status";
const run = { login, logout, status, add, "add-sequence": addSequence }[cmd as "login"];
if (!run) {
  say("usage: bun media login | status | add <file> … | add-sequence <dir> … | logout  [--local]");
  process.exit(1);
}
try {
  await run();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
