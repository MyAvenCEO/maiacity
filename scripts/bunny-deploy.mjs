// Uploads the built site to the Bunny storage zone and purges the pull zone.
// Only BUNNY_API_KEY is needed; the storage password is read from the account API.
//
// The GitHub workflow runs this on every push. Running it locally at the same
// time once left the site broken: each deploy deleted the other's hashed
// chunks as "stale", and the surviving pages pointed at files that were gone.
// Two guards now: assets go up before the pages that reference them, and
// only files older than this run are ever deleted.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import { NAMES, api, storageBase } from './bunny.mjs';

const DIR = process.env.BUILD_DIR ?? 'build';
const CONCURRENCY = 8;

async function walk(dir) {
	const found = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await walk(path)));
		else found.push(path);
	}
	return found;
}

async function listRemote(base, password, prefix = '') {
	const res = await fetch(`${base}/${prefix}`, { headers: { AccessKey: password, accept: 'application/json' } });
	if (!res.ok) return [];
	const items = await res.json();

	const files = [];
	for (const item of items) {
		const path = `${prefix}${item.ObjectName}`;
		if (item.IsDirectory) files.push(...(await listRemote(base, password, `${path}/`)));
		else files.push({ path, changed: Date.parse(item.LastChanged) });
	}
	return files;
}

async function pool(items, worker) {
	let index = 0;
	const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
		while (index < items.length) await worker(items[index++]);
	});
	await Promise.all(runners);
}

const zones = await api('/storagezone');
const zone = zones.find((z) => z.Name === NAMES.storage);
if (!zone) throw new Error(`storage zone ${NAMES.storage} not found — run bunny-setup first`);

const base = storageBase(zone);
const password = zone.Password;

const SKIP = /\.(mp4|mov|mkv)$/i; // video masters belong in Stream, not storage

const startedAt = Date.now();
const local = (await walk(DIR))
	.map((p) => relative(DIR, p).split(sep).join(posix.sep))
	.filter((file) => !SKIP.test(file))
	// hashed assets first, pages last: a page is never live before its chunks
	.sort((a, b) => Number(a.endsWith('.html')) - Number(b.endsWith('.html')));
console.log(`uploading ${local.length} files to ${zone.Name}`);

let uploaded = 0;
const upload = async (file) => {
	const body = await readFile(join(DIR, ...file.split('/')));
	const res = await fetch(`${base}/${file}`, {
		method: 'PUT',
		headers: { AccessKey: password, 'content-type': 'application/octet-stream' },
		body
	});
	if (!res.ok) throw new Error(`upload ${file} → ${res.status} ${await res.text()}`);
	uploaded += 1;
};
await pool(local.filter((f) => !f.endsWith('.html')), upload);
await pool(local.filter((f) => f.endsWith('.html')), upload);
console.log(`uploaded ${uploaded} files`);

// Remove files that no longer exist in the build — but never anything written
// since this run began: that is another deploy's, and it needs its files.
const remote = await listRemote(base, password);
const stale = remote
	.filter(({ path, changed }) => !local.includes(path) && !(changed >= startedAt - 60_000))
	.map(({ path }) => path);
await pool(stale, async (file) => {
	await fetch(`${base}/${file}`, { method: 'DELETE', headers: { AccessKey: password } });
});
console.log(stale.length ? `deleted ${stale.length} stale files` : 'no stale files');

const pullZones = await api('/pullzone');
const pullZone = pullZones.find((z) => z.Name === NAMES.pullZone);
if (pullZone) {
	await api(`/pullzone/${pullZone.Id}/purgeCache`, { method: 'POST' });
	console.log(`purged pull zone ${pullZone.Name}`);
}

await stat(DIR);
