// Move references from IPFS CIDs to the vault's BLAKE3 hashes — no aliases: the file then names the hash only.
//
//   LIBRARY=/path/to/library bun vault/migration/rewrite.ts <file or folder>…
//
// Every CID found (alone, or with its extension) becomes <hash> or <hash>.<ext>, by vault/migration/cid-to-blake3.json
// (written by `vault import-library`). The site's manifest (src/lib/media/manifest.json) gains an entry per rewritten
// file, keyed by its hash, with what library/ says about it; the gateway serves the bytes.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const MAP: Record<string, { hash: string; ext: string }> = JSON.parse(readFileSync(join(import.meta.dir, "cid-to-blake3.json"), "utf8"));
const LIBRARY = process.env.LIBRARY ?? join(ROOT, "library");
const MANIFEST = join(ROOT, "src/lib/media/manifest.json");
const CID = /baf[ky][a-z2-7]{50,}/g;

const files = (p: string): string[] =>
  statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => files(join(p, f))) : /\.(md|json|ts|js|mjs|svelte)$/.test(p) ? [p] : [];

const touched = new Set<string>();
let count = 0;
for (const target of process.argv.slice(2)) {
  for (const file of files(join(ROOT, target))) {
    const before = readFileSync(file, "utf8");
    const after = before.replace(CID, (cid) => {
      const to = MAP[cid];
      if (!to) return cid; // not in the library: left as it is, and reported
      touched.add(cid);
      count++;
      return to.hash;
    });
    if (after !== before) writeFileSync(file, after);
  }
}

// the manifest: what the site knows about each file, now by hash (the gateway serves it, so no CDN url)
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, Record<string, unknown>>;
for (const cid of touched) {
  const { hash } = MAP[cid]!;
  const doc = existsSync(join(LIBRARY, `${cid}.json`)) ? JSON.parse(readFileSync(join(LIBRARY, `${cid}.json`), "utf8")) : {};
  manifest[hash] = { url: null, mime: doc.mime ?? "", title: doc.title ?? "", description: doc.description ?? "", tags: doc.tags ?? [] };
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, "\t") + "\n");

const left = process.argv.slice(2).flatMap((t) => files(join(ROOT, t))).flatMap((f) => readFileSync(f, "utf8").match(CID) ?? []);
console.log(`${count} references to ${touched.size} files now name their BLAKE3 hash; manifest updated`);
if (left.length) console.log(`not in the library, left as they are: ${[...new Set(left)].join(", ")}`);
