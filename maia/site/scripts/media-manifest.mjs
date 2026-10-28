// Before the site is built: stop the build if the journal names a file the site's media list doesn't hold
// (maia/site/lib/media/manifest.json, every public file by its BLAKE3 hash, with its type, title, description, tags and its
// entry in Maia City, by which a page reads it: the engine's index of entries by id, never a listing of the vault).
// The list is frozen: the old media vault's mirror it came from is retired, and every file in it lives in Maia City in
// avenDB, served by its feed (/feed/media/<hash>).
//
//   node maia/site/scripts/media-manifest.mjs            check
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname;
const FILE = join(ROOT, 'maia/site/lib/media/manifest.json');
const manifest = JSON.parse(readFileSync(FILE, 'utf8'));

const missing = [];
for (const post of readdirSync(join(ROOT, 'blog'), { withFileTypes: true })) {
	if (!post.isDirectory()) continue;
	// a day's folder before its article is written (its idea, its sources) has nothing in it the journal shows
	const file = join(ROOT, 'blog', post.name, 'post.md');
	if (!existsSync(file)) continue;
	const md = readFileSync(file, 'utf8');
	if (/^draft:\s*true/m.test(md)) continue; // an unpublished day is not built for the public
	// a file is named by its hash with its extension (a bare 64-hex string may be anything: a key, a checksum)
	const refs = [...md.matchAll(/\b([0-9a-f]{64})\.[a-z0-9]+\b/g)].map((m) => m[1]);
	for (const hash of new Set(refs)) if (!manifest[hash]) missing.push(`${post.name}: ${hash}`);
}
for (const [hash, file] of Object.entries(manifest)) if (!/^[0-9a-f]{64}$/.test(file.entry ?? '')) missing.push(`${hash}: no Maia City entry`);
if (missing.length) {
	console.error(`The journal names ${missing.length} files the site's media list doesn't hold:\n  ${missing.join('\n  ')}`);
	process.exit(1);
}
