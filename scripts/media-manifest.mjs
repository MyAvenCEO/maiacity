// Before the site is built: fetch the media manifest from the library's database (every public file by CID: its
// address on the CDN, its title and tags), so every image the journal names loads from the CDN — and stop the build
// if the journal names a CID the library does not show publicly yet (run `bun media seed` against production).
//
//   node scripts/media-manifest.mjs            refresh (best effort: offline, the committed one is used) and check
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const FILE = join(ROOT, 'src/lib/media/manifest.json');
const API = process.env.MEDIA_API ?? 'https://api.maia.city';

let manifest = JSON.parse(readFileSync(FILE, 'utf8'));
try {
	const res = await fetch(`${API}/api/media/manifest`, { signal: AbortSignal.timeout(15000) });
	if (!res.ok) throw new Error(String(res.status));
	const got = await res.json();
	// an API from before the library lost its paths answers by path: keep the committed one then
	if (!Object.keys(got).every((k) => k.startsWith('baf'))) throw new Error('it still answers by path');
	manifest = got;
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
	const refs = [...md.matchAll(/\b(baf[a-z2-7]{20,})(?:\.[a-z0-9]+)?\b/g)].map((m) => m[1]);
	for (const cid of new Set(refs)) if (!manifest[cid]?.url && !manifest[cid]?.stream) missing.push(`${post.name}: ${cid}`);
}
if (missing.length) {
	console.error(`The journal names ${missing.length} files that have no public copy yet:\n  ${missing.join('\n  ')}\nRun \`bun media seed\` (production), then push.`);
	process.exit(1);
}
