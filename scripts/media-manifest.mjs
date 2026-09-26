// Before the site is built: fetch the media manifest from the library (path → CID → CDN address), so every image
// the journal names loads from its CID on the CDN — and stop the build if the journal names a file that is neither
// in static/ nor in the library (it was never synced: run `bun media sync`).
//
//   node scripts/media-manifest.mjs            refresh (best effort: offline, the committed one is used) and check
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const FILE = join(ROOT, 'src/lib/media/manifest.json');
const API = process.env.MEDIA_API ?? 'https://api.maia.city';

let manifest = JSON.parse(readFileSync(FILE, 'utf8'));
try {
	const res = await fetch(`${API}/api/media/manifest`, { signal: AbortSignal.timeout(15000) });
	if (!res.ok) throw new Error(String(res.status));
	manifest = await res.json();
	writeFileSync(FILE, JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`media manifest: ${Object.keys(manifest).length} paths on the CDN (from ${API})`);
} catch (e) {
	console.log(`media manifest: kept the committed one (${API} not reachable: ${e.message})`);
}

const missing = [];
for (const post of readdirSync(join(ROOT, 'blog'), { withFileTypes: true })) {
	if (!post.isDirectory()) continue;
	const md = readFileSync(join(ROOT, 'blog', post.name, 'post.md'), 'utf8');
	const refs = [...md.matchAll(/!\[[^\]]*\]\((\/[^)\s]+)\)|^(?:cover|poster|authorImage):\s*['"]?(\/\S+?)['"]?\s*$/gm)].map((m) => m[1] ?? m[2]);
	for (const path of refs) if (!manifest[path] && !existsSync(join(ROOT, 'static', path))) missing.push(`${post.name}: ${path}`);
}
if (missing.length) {
	console.error(`The journal names ${missing.length} media files that are neither in static/ nor in the library:\n  ${missing.join('\n  ')}\nRun \`bun media sync\` where they are, then push.`);
	process.exit(1);
}
