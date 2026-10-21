// The media, from the terminal. Every file lives in avenDB's Library of Maia City (Studio 2), known by its BLAKE3 hash
// (its legacy:/blake3: tag) and described (title, tags; description and meta in its about). This terminal reaches it
// as the agent device agentScripts, a device of the coop's aven avenMAIA (scripts/film/vault.mjs, ./avendb.mjs): the
// first run waits until its person approves it in theOS app, with one touch of their passkey. No login, no key.
//
//   bun media status       what the Library holds, as agentScripts sees it
//   bun media add <file> [--title "…"] [--description "…"] [--tags a,b] [--replaces <hash>]
//                          bring a file into the Library, described; the file it replaces (by hash) is kept, tagged
//                          superseded. Where avenMAIA may only suggest (a Suggester on Maia City), it is a draft in an
//                          AIP of its own, which lands once a human of Maia City accepts it.
//   bun media add-sequence <dir> [--profile aces2065-1|acescg|linear-rec709] [--fps 24] [--title "…"] [--tags a,b]
//                          an EXR sequence (a folder of frames, e.g. a Luma / Kling / LTX export) packed into one tar
//                          and brought in as one clip; its colour profile given, or read from the EXR header
import { $ } from "bun";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { mb, ROOT, say } from "./media-client";
import { packSequence } from "./library";
import { add as addFile, list } from "../../scripts/film/vault.mjs";

// ─────────────────────────────── status ───────────────────────────────

async function status() {
  const here = await list();
  const drafts = here.filter((m) => m.draft);
  say(`avenDB's Library, as agentScripts sees it: ${here.length} files, ${mb(here.reduce((n, m) => n + m.size, 0))}${drafts.length ? ` — ${drafts.length} drafts waiting on their AIPs` : ""}`);
}

// ─────────────────────────────── add ───────────────────────────────

async function add() {
  const argv = process.argv.slice(3);
  const opt = (k: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
  const list = (k: string) => opt(k)?.split(",").map((t) => t.trim()).filter(Boolean);
  const [file] = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.match(/^--(title|description|tags|replaces)$/));
  if (!file) throw new Error('usage: bun media add <file> [--title "…"] [--description "…"] [--tags a,b] [--replaces <hash>]');
  const r = await addFile(file, { title: opt("title"), description: opt("description"), tags: list("tags"), replaces: list("replaces") });
  say(`${r.verdict === "duplicate" ? "known" : r.verdict === "draft" ? "drafted" : "added"} ${r.hash}  ${r.meta?.title || basename(file)} [${(r.meta?.tags ?? []).join(", ")}]${r.aip ? `  — AIP ${r.aip}, for Maia City to accept` : ""}`);
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
  say(`${d.hash}  ${d.meta?.title ?? ""} · ${frames} frames · ${profile}${d.aip ? ` — a draft, AIP ${d.aip}` : ""}`);
}

const cmd = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "status";
const run = { status, add, "add-sequence": addSequence }[cmd as "status"];
if (!run) {
  say("usage: bun media status | add <file> … | add-sequence <dir> …");
  process.exit(1);
}
try {
  await run();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
