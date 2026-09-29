// A pinned game build, served: world shots render on the build they were made on (spec.world.build), not on
// whatever the site is today.
//
// How the worker gets a build:
//   1. `node scripts/film/world/build.mjs` builds the site (vite build), hashes it and writes build/film-build.json
//      ({ commit, hash }) — the page reports it as __film.build — and packs it as studio/builds/site-<hash>.tar;
//   2. the tar goes into the vault (`bun media add studio/builds/site-<hash>.tar`), whose hash is the build's file
//      (a spec may name it: world.build.file);
//   3. the worker fetches the tar from the vault once (buildDir), serves it on a local port (serveSite) and renders with
//      `site` = that URL. renderPlate refuses a spec whose world.build is not the site's build.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileOf, isHash } from '../vault.mjs';

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

// node scripts/film/world/site.mjs <dir> [port]: serve a build by hand (then render with SITE=<the url it prints>)
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
	const s = await serveSite(process.argv[2] ?? 'build', Number(process.argv[3] ?? 0));
	console.log(`serving ${resolve(process.argv[2] ?? 'build')} at ${s.url}`);
}

/**
 * A stored build, unpacked once into the cache (~/.cache/maiacity/builds/<hash>/): the vault's bytes by hash.
 * @param {string} hash  the build's tar in the vault (world.build.file)
 */
export async function buildDir(hash) {
	if (!isHash(hash)) throw new Error('a build is named by its file in the vault: its hash');
	const dir = join(homedir(), '.cache', 'maiacity', 'builds', hash);
	if (existsSync(join(dir, 'film-build.json'))) return dir;
	mkdirSync(dir, { recursive: true });
	execFileSync('tar', ['-xf', await fileOf(hash, 'application/x-tar'), '-C', dir]);
	if (!existsSync(join(dir, 'film-build.json'))) throw new Error(`build ${hash} has no film-build.json: not a film build`);
	return dir;
}
