// A pinned game build, served: world shots render on the build they were made on (spec.world.build), not on
// whatever the site is today.
//
// How the worker gets a build:
//   1. `node scripts/film/world/build.mjs` builds the site (vite build), hashes it and writes build/film-build.json
//      ({ commit, hash }) — the page reports it as __film.build — and packs it as studio/builds/site-<hash>.tar;
//   2. the tar goes into the library (`bun media add studio/builds/site-<hash>.tar`), whose CID is the build's cid
//      (a spec may name it: world.build.cid);
//   3. the worker fetches the tar by CID once (buildDir), serves it on a local port (serveSite) and renders with
//      `site` = that URL. renderPlate refuses a spec whose world.build is not the site's build.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.txt': 'text/plain' };

/**
 * Serve a built site (adapter-static output) on 127.0.0.1: files as they are, `dir/index.html` for a folder, and the
 * fallback page for anything else, as GitHub Pages does.
 * @param {string} dir @param {number} [port] 0: any free port
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function serveSite(dir, port = 0) {
	const root = resolve(dir);
	const server = createServer((req, res) => {
		const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
		let file = normalize(join(root, path));
		if (!file.startsWith(root)) return res.writeHead(403).end();
		if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
		if (!existsSync(file)) file = existsSync(`${file}.html`) ? `${file}.html` : join(root, '404.html');
		if (!existsSync(file)) return res.writeHead(404).end();
		res.writeHead(200, { 'content-type': TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? 'application/octet-stream', 'cache-control': 'no-store' });
		createReadStream(file).pipe(res);
	});
	await new Promise((r) => server.listen(port, '127.0.0.1', () => r(null)));
	const p = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return { url: `http://127.0.0.1:${p}`, close: () => new Promise((r) => server.close(() => r())) };
}

/**
 * A stored build, unpacked once into the cache (~/.cache/maiacity/builds/<cid>/): the library's bytes by CID.
 * @param {string} cid @param {{ api: string, key: string }} from  the API and a media:admin key
 */
export async function buildDir(cid, { api, key }) {
	if (!/^baf[a-z2-7]{20,}$/.test(cid)) throw new Error('a build is named by its library CID');
	const dir = join(homedir(), '.cache', 'maiacity', 'builds', cid);
	if (existsSync(join(dir, 'film-build.json'))) return dir;
	mkdirSync(dir, { recursive: true });
	const res = await fetch(`${api}/api/media/${cid}`, { headers: { authorization: `Bearer ${key}` } });
	if (!res.ok) throw new Error(`build ${cid}: ${res.status}`);
	const tar = `${dir}.tar`;
	writeFileSync(tar, Buffer.from(await res.arrayBuffer()));
	execFileSync('tar', ['-xf', tar, '-C', dir]);
	if (!existsSync(join(dir, 'film-build.json'))) throw new Error(`build ${cid} has no film-build.json: not a film build`);
	return dir;
}
