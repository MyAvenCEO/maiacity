// THE PLATE RENDERER — a world clip's frames, rendered offline at full quality in Sandbox 4's film mode, as a log
// plate: ACEScct, 10-bit HEVC, bt709 matrix, tv range, tagged `comment=maiacity:color=acescct` (contract C4 in
// scripts/film/PLAN.md), from the command line: shoot.mjs (plates and storyboard stills by hand) and the parity test
// use it. The final render's plates and hero frames, and a world shot's HD proxy, are the Mac app's
// (vault/app/src/world.rs), made from the same frames — `__film.capture` — in its own world, without Chrome.
//
//   import { renderPlate, openWorld } from './scripts/film/world/render.mjs';
//   const { file, frames, ev, build, fingerprint } = await renderPlate({ spec, from: 0, to: 3.2, shape: '16:9',
//     width: 3840, height: 2160, fps: 30, out: 'plate.mov', site: 'http://localhost:5173' });
//
// How a frame travels: the page renders it (src/lib/film: half-float linear light, metered, shutter blur, oversampled
// and filtered down, ACEScct, packed x2bgr10le on the GPU), then POSTs the raw bytes to a small HTTP server here
// (never base64 through the debugging protocol), which pipes them in order into ffmpeg as `-f rawvideo -pix_fmt
// x2bgr10le`. The frame is already top row first, so ffmpeg needs no vflip.
//
// The world's build is pinned: a spec that names world.build ({ commit, hash }) renders only on that build (the site
// says what it is at /film-build.json — scripts/film/world/build.mjs makes and stores builds) unless
// `allowBuildMismatch`. A dev server has no build: it renders only specs that name none.
//
// The world renders only on a Mac, on its GPU (ANGLE on Metal): there is no software-rendering path. Off a Mac,
// openWorld refuses, so a world job fails with a clear message instead of rendering slowly and differently.
//
// Environment: CHROME (the browser, default Google Chrome in /Applications), FILM_HEVC (libx265 | hevc_videotoolbox; by default the first this ffmpeg has, VideoToolbox first).
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fingerprint as fingerprintOf, normalize, SHAPES } from '../../../game/film/shot.js';

const mac = process.platform === 'darwin';

/** Chrome's flags for WebGL: ANGLE on Metal, the Mac's own GPU — never a software renderer. */
export function browserArgs(size = [1280, 720]) {
	return ['--use-gl=angle', '--use-angle=metal', `--window-size=${size[0]},${size[1]}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'];
}

export const chromePath = () => process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** World plates render only on a Mac (Metal). */
export function assertMac() {
	if (!mac) throw new Error('world plates render only on a Mac, on its GPU (Metal) — run the render worker there');
}

/** The HEVC encoder to use: VideoToolbox on the Mac, libx265 elsewhere (FILM_HEVC overrides). */
export function hevcEncoder() {
	if (process.env.FILM_HEVC) return process.env.FILM_HEVC;
	const list = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
	if (/\bhevc_videotoolbox\b/.test(list)) return 'hevc_videotoolbox';
	if (/\blibx265\b/.test(list)) return 'libx265';
	throw new Error('this ffmpeg has no HEVC encoder (libx265 or hevc_videotoolbox)');
}

/**
 * Open Sandbox 4 in film mode in a headless browser and wait until the world is up.
 * @param {{ site: string, log?: (s: string) => void }} opts
 */
export async function openWorld({ site, log = () => {} }) {
	assertMac();
	const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, protocolTimeout: 0, args: browserArgs() });
	const page = await browser.newPage();
	page.on('pageerror', (e) => log(`page error: ${e.message}`));
	page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && log(`page ${m.type()}: ${m.text()}`));
	await page.setViewport({ width: 640, height: 640, deviceScaleFactor: 1 });
	await page.goto(`${site.replace(/\/$/, '')}/games/sandbox-4/?film`, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.__film && window.__village, { timeout: 0, polling: 1000 });
	await page.evaluate(() => window.__film.ready());
	const build = await page.evaluate(() => window.__film.build);
	return { browser, page, build, close: () => browser.close() };
}

/** A local HTTP server the page posts frames to; they come out in order, one at a time. */
async function frameSink(/** @type {(n: number, bytes: Buffer) => Promise<void>} */ take) {
	let next = 0;
	/** @type {Map<number, Buffer>} */
	const early = new Map();
	let chain = Promise.resolve();
	const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-allow-private-network': 'true' };
	const server = createServer((req, res) => {
		if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
		const m = /^\/frame\/(\d+)$/.exec(req.url ?? '');
		if (req.method !== 'POST' || !m) return res.writeHead(404, cors).end();
		/** @type {Buffer[]} */
		const parts = [];
		req.on('data', (d) => parts.push(d));
		req.on('end', () => {
			early.set(Number(m[1]), Buffer.concat(parts));
			// frames go to the encoder strictly in order, whatever order they arrive in
			chain = chain.then(async () => {
				while (early.has(next)) {
					const bytes = /** @type {Buffer} */ (early.get(next));
					early.delete(next);
					await take(next++, bytes);
				}
			});
			chain.then(() => res.writeHead(200, cors).end('ok'), (e) => res.writeHead(500, cors).end(String(e)));
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return { url: `http://127.0.0.1:${port}`, done: () => chain, close: () => new Promise((r) => server.close(() => r(null))) };
}

/**
 * A local HTTP server the page posts files to (a still, a frame to look at): each POST /<key> is kept until taken.
 * @returns {Promise<{ url: string, take: (key: string) => Buffer | undefined, close: () => Promise<unknown> }>}
 */
export async function receiver() {
	/** @type {Map<string, Buffer>} */
	const got = new Map();
	const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-allow-private-network': 'true' };
	const server = createServer((req, res) => {
		if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
		/** @type {Buffer[]} */
		const parts = [];
		req.on('data', (d) => parts.push(d));
		req.on('end', () => {
			got.set((req.url ?? '/').slice(1), Buffer.concat(parts));
			res.writeHead(200, cors).end('ok');
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return {
		url: `http://127.0.0.1:${port}`,
		take: (key) => {
			const b = got.get(key);
			got.delete(key);
			return b;
		},
		close: () => new Promise((r) => server.close(() => r(null)))
	};
}

/** ffmpeg reading raw x2bgr10le frames on stdin, writing an ACEScct log plate. */
function encoder(/** @type {{ out: string, width: number, height: number, fps: number, gop?: number, quality?: number }} */ o) {
	const codec = hevcEncoder();
	const q = o.quality ?? 10;
	const video = codec === 'hevc_videotoolbox'
		? ['-c:v', 'hevc_videotoolbox', '-profile:v', 'main10', '-q:v', String(Math.round(100 - q * 2)), '-allow_sw', '1']
		: ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(q), '-x265-params', `log-level=error${o.gop ? `:keyint=${o.gop}:min-keyint=1` : ''}`];
	const args = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'x2bgr10le', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', 'pipe:0',
		// RGB (full range, as the log codes are) to YUV: the bt709 matrix, tv range, 10 bits kept all the way
		'-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int+bitexact,format=yuv420p10le',
		...video, ...(o.gop && codec !== 'libx265' ? ['-g', String(o.gop)] : []),
		'-pix_fmt', 'yuv420p10le', '-colorspace', 'bt709', '-color_range', 'tv', '-tag:v', 'hvc1',
		'-metadata', 'comment=maiacity:color=acescct', '-movflags', '+faststart', o.out];
	const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'pipe'] });
	let err = '';
	ff.stderr.on('data', (d) => (err += d));
	const finished = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve(null) : reject(new Error(`ffmpeg failed (${code}): ${err.trim()}`)))));
	return {
		codec,
		write: (/** @type {Buffer} */ b) => new Promise((resolve, reject) => ff.stdin.write(b, (e) => (e ? reject(e) : resolve(null)))),
		end: async () => {
			ff.stdin.end();
			await finished;
		},
		kill: () => ff.kill('SIGKILL')
	};
}

const sameBuild = (/** @type {any} */ a, /** @type {any} */ b) => !!a && !!b && a.commit === b.commit && a.hash === b.hash;

/**
 * Render one world clip as a log plate.
 * @param {{
 *   spec: any, from?: number, to?: number, shape?: import('../../../game/film/shot.js').Shape, width: number, height: number,
 *   fps?: number, out: string, site?: string, world?: Awaited<ReturnType<typeof openWorld>>,
 *   oversample?: number, gop?: number, quality?: number, allowBuildMismatch?: boolean,
 *   progress?: (done: number, of: number) => void, log?: (s: string) => void
 * }} o
 * @returns {Promise<{ file: string, frames: number, ev: number | [number, number][], build: any, fingerprint: string, codec: string }>}
 */
export async function renderPlate(o) {
	const spec = normalize(o.spec);
	const from = o.from ?? 0, to = o.to ?? spec.seconds, fps = o.fps ?? spec.fps, shape = o.shape ?? spec.aspect;
	if (!(shape in SHAPES)) throw new Error(`shape is one of ${Object.keys(SHAPES).join(', ')}`);
	if (!(o.width > 0 && o.height > 0) || o.width % 2 || o.height % 2) throw new Error('width and height are even numbers of pixels');
	const frames = Math.max(1, Math.round((to - from) * fps));
	const world = o.world ?? (await openWorld({ site: o.site ?? 'http://localhost:5173', log: o.log }));
	try {
		if (spec.world.build && !sameBuild(world.build, spec.world.build) && !o.allowBuildMismatch)
			throw new Error(`this shot was made on build ${spec.world.build.commit.slice(0, 9)} (${spec.world.build.hash.slice(0, 12)}); the site is ${world.build ? `${world.build.commit.slice(0, 9)} (${world.build.hash.slice(0, 12)})` : 'a dev build'} — render it on its build, or allow the mismatch`);
		const { page } = world;
		await page.evaluate((s) => window.__film.ready(s), spec);
		const ev = await page.evaluate((s) => window.__film.exposure(s), spec);
		mkdirSync(dirname(o.out), { recursive: true });
		const part = o.out.replace(/(\.[a-z0-9]+)$/i, '.part$1');
		const ff = encoder({ out: part, width: o.width, height: o.height, fps, gop: o.gop, quality: o.quality });
		const bytes = o.width * o.height * 4;
		const sink = await frameSink(async (n, b) => {
			if (b.length !== bytes) throw new Error(`frame ${n}: ${b.length} bytes, not ${bytes}`);
			await ff.write(b);
			o.progress?.(n + 1, frames);
		});
		try {
			for (let k = 0; k < frames; k++) {
				const ask = { spec, t: from + k / fps, shape, width: o.width, height: o.height, oversample: o.oversample ?? 1.5 };
				await page.evaluate(async (a, url) => {
					const buf = await window.__film.capture(a);
					const r = await fetch(url, { method: 'POST', body: buf, headers: { 'content-type': 'application/octet-stream' } });
					if (!r.ok) throw new Error(`the frame sink said ${r.status}: ${await r.text()}`);
				}, ask, `${sink.url}/frame/${k}`);
			}
			await sink.done();
			await ff.end();
		} catch (e) {
			ff.kill();
			rmSync(part, { force: true });
			throw e;
		} finally {
			await sink.close();
		}
		renameSync(part, o.out);
		const build = world.build ?? null;
		return {
			file: o.out,
			frames,
			ev,
			build,
			codec: ff.codec,
			fingerprint: fingerprintOf(spec, { from, to, shape, width: o.width, height: o.height, fps, oversample: o.oversample ?? 1.5, film: 1, build: build && { commit: build.commit, hash: build.hash } })
		};
	} finally {
		if (!o.world) await world.close();
	}
}
