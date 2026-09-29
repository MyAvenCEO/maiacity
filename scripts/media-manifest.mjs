// Before the site is built: the media manifest from the vault's mirror (GET /api/vault/files) — every public file by
// its BLAKE3 hash, with its type, title, description and tags. The bytes come from the vault's gateway by hash, so an
// entry has no address of its own (url: null). Then stop the build if the journal names a file that is not public in
// the vault (the gateway would not serve it): make it public in the Studio app, then push.
//
//   node scripts/media-manifest.mjs            refresh (best effort: offline or without a key, the committed one is used) and check
//
// The mirror is the admin's: the key is MAIACITY_KEY, or the one this terminal was given (`bun media login`, kept in
// ~/.config/maiacity/media-keys.json for that API). MAIACITY_API (or MEDIA_API) points it at another API.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const FILE = join(ROOT, 'src/lib/media/manifest.json');
const API = process.env.MAIACITY_API ?? process.env.MEDIA_API ?? 'https://api.maia.city';

const keyFor = () => {
	if (process.env.MAIACITY_KEY) return process.env.MAIACITY_KEY;
	try {
		return JSON.parse(readFileSync(join(homedir(), '.config', 'maiacity', 'media-keys.json'), 'utf8'))[API] ?? null;
	} catch {
		return null;
	}
};

let manifest = JSON.parse(readFileSync(FILE, 'utf8'));
try {
	const key = keyFor();
	if (!key) throw new Error('no key for it');
	const res = await fetch(`${API}/api/vault/files`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
	if (!res.ok) throw new Error(String(res.status));
	const files = await res.json();
	if (!Array.isArray(files)) throw new Error('it did not answer with the list of files');
	manifest = Object.fromEntries(
		files
			.filter((f) => f.public && /^[0-9a-f]{64}$/.test(f.hash))
			.sort((a, b) => a.hash.localeCompare(b.hash))
			.map((f) => [f.hash, { url: null, mime: f.mime, title: f.title ?? '', description: f.description ?? f.meta?.description ?? '', tags: f.tags ?? [] }])
	);
	writeFileSync(FILE, JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`media manifest: ${Object.keys(manifest).length} public files (from ${API})`);
} catch (e) {
	console.log(`media manifest: kept the committed one (${API}: ${e.message})`);
}

const missing = [];
for (const post of readdirSync(join(ROOT, 'blog'), { withFileTypes: true })) {
	if (!post.isDirectory()) continue;
	const md = readFileSync(join(ROOT, 'blog', post.name, 'post.md'), 'utf8');
	if (/^draft:\s*true/m.test(md)) continue; // an unpublished day is not built for the public
	// a file is named by its hash with its extension (a bare 64-hex string may be anything: a key, a checksum)
	const refs = [...md.matchAll(/\b([0-9a-f]{64})\.[a-z0-9]+\b/g)].map((m) => m[1]);
	for (const hash of new Set(refs)) if (!manifest[hash]) missing.push(`${post.name}: ${hash}`);
}
if (missing.length) {
	console.error(`The journal names ${missing.length} files that are not public in the vault:\n  ${missing.join('\n  ')}\nMake them public (the Studio app), then push.`);
	process.exit(1);
}
