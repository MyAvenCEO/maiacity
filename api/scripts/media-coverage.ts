// Does every file production's media library holds exist in a library/ folder — the same bytes, by CID?
// Before the media bytes leave Postgres (vault/PLAN.md task 26), this must say "0 missing".
//
//   LIBRARY=/path/to/library bun api/scripts/media-coverage.ts           report (read-only)
//   LIBRARY=/path/to/library bun api/scripts/media-coverage.ts --fetch   also download the missing ones there,
//                                                                         each checked by its CID before it is kept
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, call, keyFor, mb, say } from "./media-client";
import { cidOf, EXT } from "../src/media";

type Item = { cid: string; mime: string; size: number; title: string; description?: string; tags: string[]; meta?: unknown; public?: boolean };
const DIR = process.env.LIBRARY ?? join(import.meta.dir, "../../library");
if (!existsSync(DIR)) throw new Error(`no library folder at ${DIR} (set LIBRARY)`);

const here = new Set(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));
const { media } = await call<{ media: Item[] }>("/api/media");
const missing = media.filter((m) => !here.has(m.cid));
say(`production: ${media.length} files, ${mb(media.reduce((n, m) => n + m.size, 0))}`);
say(`in ${DIR}: ${media.length - missing.length} · missing: ${missing.length} (${mb(missing.reduce((n, m) => n + m.size, 0))})`);
for (const m of missing.slice(0, 40)) say(`  ${m.cid}  ${mb(m.size).padStart(10)}  ${m.mime}  ${m.title}`);
if (missing.length > 40) say(`  … and ${missing.length - 40} more`);

if (process.argv.includes("--fetch") && missing.length) {
  const key = await keyFor();
  let ok = 0;
  for (const m of missing) {
    const res = await fetch(`${API}/api/media/${m.cid}`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) {
      say(`  ✗ ${m.cid}: ${res.status}`);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const cid = await cidOf(bytes);
    if (cid !== m.cid) {
      say(`  ✗ ${m.cid}: the bytes hash to ${cid} — not kept`);
      continue;
    }
    const file = `${cid}.${EXT[m.mime] ?? "bin"}`;
    writeFileSync(join(DIR, file), bytes);
    const doc = { cid, file, mime: m.mime, kind: m.mime.split("/")[0], size: bytes.length, title: m.title, description: m.description ?? "", tags: m.tags, meta: m.meta ?? {}, public: !!m.public, added: new Date().toISOString() };
    writeFileSync(join(DIR, `${cid}.json`), JSON.stringify(doc, null, 1) + "\n");
    ok++;
    say(`  ✓ ${cid}  ${mb(bytes.length)}`);
  }
  say(`fetched ${ok} of ${missing.length}, each checked by its CID`);
}
// --verify: hash every local copy of a production file and compare with its CID — the bytes, not only the name
if (process.argv.includes("--verify")) {
  let good = 0;
  const bad: string[] = [];
  for (const m of media) {
    if (!here.has(m.cid)) continue;
    const doc = JSON.parse(readFileSync(join(DIR, `${m.cid}.json`), "utf8")) as { file: string };
    const cid = await cidOf(new Uint8Array(readFileSync(join(DIR, doc.file))));
    if (cid === m.cid) good++;
    else bad.push(`${m.cid} hashes to ${cid}`);
  }
  say(`verified: ${good} of ${media.length} local copies hash to their CID${bad.length ? ` — ${bad.length} do NOT:` : ""}`);
  for (const b of bad) say(`  ✗ ${b}`);
}
