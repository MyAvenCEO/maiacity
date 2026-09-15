// Uploads a local video file to the maiaCITY Bunny Stream library.
//   BUNNY_API_KEY=... node scripts/bunny-video.mjs "static/Day0/DAY000_Intro.mp4" "Day 00 — Intro"
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { NAMES, api } from './bunny.mjs';

const [file, titleArg] = process.argv.slice(2);
if (!file) throw new Error('usage: node scripts/bunny-video.mjs <file> [title]');

const title = titleArg ?? basename(file).replace(/\.[^.]+$/, '');
const { size } = await stat(file);

const { Items } = await api('/videolibrary?page=1&perPage=100');
const library = Items.find((l) => l.Name === NAMES.streamLibrary);
if (!library) throw new Error(`stream library ${NAMES.streamLibrary} not found — run bunny-setup first`);

const libraryKey = library.ApiKey;
const videoApi = `https://video.bunnycdn.com/library/${library.Id}`;

const created = await (
	await fetch(`${videoApi}/videos`, {
		method: 'POST',
		headers: { AccessKey: libraryKey, 'content-type': 'application/json' },
		body: JSON.stringify({ title })
	})
).json();

console.log(`created video ${created.guid} — uploading ${(size / 1048576).toFixed(0)} MB…`);

const res = await fetch(`${videoApi}/videos/${created.guid}`, {
	method: 'PUT',
	headers: { AccessKey: libraryKey, 'content-type': 'application/octet-stream', 'content-length': String(size) },
	body: createReadStream(file),
	duplex: 'half'
});
if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);

console.log('');
console.log(`library:   ${library.Id}`);
console.log(`video:     ${created.guid}`);
console.log(`embed:     https://iframe.mediadelivery.net/embed/${library.Id}/${created.guid}`);
console.log(`thumbnail: https://vz-${library.PullZoneId ?? ''}.b-cdn.net/${created.guid}/thumbnail.jpg`);
console.log('');
console.log('Add to the post frontmatter:');
console.log(`  video: ${created.guid}`);
console.log(`  videoLibrary: ${library.Id}`);
