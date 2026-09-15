// Uploads the built site to the Bunny storage zone and purges the pull zone.
// Only BUNNY_API_KEY is needed; the storage password is read from the account API.
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
		else files.push(path);
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

const local = (await walk(DIR)).map((p) => relative(DIR, p).split(sep).join(posix.sep));
console.log(`uploading ${local.length} files to ${zone.Name}`);

let uploaded = 0;
await pool(local, async (file) => {
	const body = await readFile(join(DIR, ...file.split('/')));
	const res = await fetch(`${base}/${file}`, {
		method: 'PUT',
		headers: { AccessKey: password, 'content-type': 'application/octet-stream' },
		body
	});
	if (!res.ok) throw new Error(`upload ${file} → ${res.status} ${await res.text()}`);
	uploaded += 1;
});
console.log(`uploaded ${uploaded} files`);

// Remove files that no longer exist in the build.
const remote = await listRemote(base, password);
const stale = remote.filter((file) => !local.includes(file));
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
