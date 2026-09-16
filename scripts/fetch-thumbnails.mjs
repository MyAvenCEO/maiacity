// Copies every YouTube thumbnail the "Inspire me" library uses into
// static/thumbnails/<id>.jpg, so pages load them from our own CDN instead of
// from YouTube. Run after adding a source: `node scripts/fetch-thumbnails.mjs`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'static/thumbnails';
mkdirSync(OUT, { recursive: true });

function youtubeId(url) {
	try {
		const u = new URL(url);
		if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
		if (u.hostname.endsWith('youtube.com')) return u.searchParams.get('v');
	} catch {}
	return null;
}

const ids = readdirSync('inspire-me', { withFileTypes: true })
	.filter((d) => d.isDirectory() && existsSync(`inspire-me/${d.name}/README.md`))
	.map((d) => readFileSync(`inspire-me/${d.name}/README.md`, 'utf8').match(/^source:\s*(\S+)/m)?.[1])
	.map((src) => (src ? youtubeId(src) : null))
	.filter(Boolean);

for (const id of ids) {
	const file = `${OUT}/${id}.jpg`;
	if (existsSync(file)) continue;
	// hq720 is missing on some older videos; hqdefault always exists
	for (const size of ['hq720', 'hqdefault']) {
		const res = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`);
		if (res.ok) {
			writeFileSync(file, Buffer.from(await res.arrayBuffer()));
			console.log(`saved ${file} (${size})`);
			break;
		}
	}
}
console.log(`${ids.length} thumbnails in ${OUT}`);
