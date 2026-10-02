// Brings the YouTube thumbnail of every "Inspire me" source that has none yet into the media library, so pages load
// it from our own CDN instead of from YouTube, and names it in the source by CID (`thumbnail: <cid>.jpg` in its
// README.md). Run after adding a source: `node scripts/fetch-thumbnails.mjs [--local]`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function youtubeId(url) {
	try {
		const u = new URL(url);
		if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
		if (u.hostname.endsWith('youtube.com')) return u.searchParams.get('v');
	} catch {}
	return null;
}

const tmp = mkdtempSync(join(tmpdir(), 'thumbnails-'));
let added = 0;
for (const d of readdirSync('inspire-me', { withFileTypes: true })) {
	const readme = `inspire-me/${d.name}/README.md`;
	if (!d.isDirectory() || !existsSync(readme)) continue;
	const text = readFileSync(readme, 'utf8');
	const source = text.match(/^source:\s*(\S+)/m)?.[1];
	const id = source ? youtubeId(source) : null;
	if (!id || /^thumbnail:/m.test(text)) continue;
	// hq720 is missing on some older videos; hqdefault always exists
	for (const size of ['hq720', 'hqdefault']) {
		const res = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`);
		if (!res.ok) continue;
		const file = join(tmp, `${id}.jpg`);
		writeFileSync(file, Buffer.from(await res.arrayBuffer()));
		const out = execFileSync('bun', ['api/scripts/media.ts', 'add', file, '--title', `${d.name} · video thumbnail`,
			'--tags', `role:source-thumbnail,youtube:${id}`, '--public', ...(process.argv.includes('--local') ? ['--local'] : [])], { encoding: 'utf8' });
		const cid = /(?:added|known) +([0-9a-f]{64})/.exec(out)?.[1]; // the library names a file by its BLAKE3 hash
		if (!cid) throw new Error(`${id}: not added — ${out}`);
		writeFileSync(readme, text.replace(/^(source:.*)$/m, `$1\nthumbnail: ${cid}.jpg`));
		console.log(`${d.name}: ${id} (${size}) → ${cid}`);
		added++;
		break;
	}
}
rmSync(tmp, { recursive: true, force: true });
console.log(`${added} thumbnails brought into the library`);
