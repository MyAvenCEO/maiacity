// The film camera: renders shots from inside Sandbox 4, frame by frame, as video.
//
//   node scripts/film/shoot.mjs scripts/film/day-19.mjs            every shot, as video (studio/film/<name>/NN-shot.mp4)
//   node scripts/film/shoot.mjs scripts/film/day-19.mjs --stills   the first, middle and last frame of each, to judge framing
//   node scripts/film/shoot.mjs scripts/film/day-19.mjs --only 3,7
//
// A shot is a camera path through the world (see day-19.mjs). The world's clock is taken over while a shot is
// filmed: every frame is exactly 1/fps after the last, however long it takes to draw — so a heavy frame never
// stutters, the water and the bees move at their true pace, and the camera glides. Frames are drawn at
// 1.5× the output size and scaled down, for clean edges; ffmpeg gives each shot a light film grade.
// Needs the dev server (bun run dev) and Chrome.
import puppeteer from 'puppeteer-core';
import { sets } from './props.mjs';
import { exposureFor, lookOf } from './grade.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const listFile = args.find((a) => !a.startsWith('--') && !/^[\d,]+$/.test(a));
if (!listFile) throw new Error('usage: node scripts/film/shoot.mjs <shot list> [--stills] [--only 1,4]');
const flag = (k) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : undefined);
const stills = args.includes('--stills') || args.includes('--mid');
const midOnly = args.includes('--mid'); // one still per shot, from its middle: the storyboard
const only = flag('only')?.split(',').map(Number);
const film = (await import(pathToFileURL(resolve(listFile)).href)).default;
const SITE = process.env.SITE ?? 'http://localhost:5173';
const SIZE = Number(process.env.FILM_SIZE) || (film.size ?? 1080), FPS = film.fps ?? 30, SCALE = 1.5; // FILM_SIZE: a bigger frame, e.g. a thumbnail's background
const OUT = resolve('studio/film', film.name);
mkdirSync(OUT, { recursive: true });

// ── the browser ───────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
	executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	headless: 'new',
	args: ['--use-angle=metal', `--window-size=${SIZE},${SIZE}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });

// the clock the film takes over: real until a shot begins, then only what the camera allows
await page.evaluateOnNewDocument(() => {
	const realNow = performance.now.bind(performance);
	const realRaf = window.requestAnimationFrame.bind(window);
	const realCaf = window.cancelAnimationFrame.bind(window);
	const F = (window.__film = { virtual: false, t: 0, id: 1, queue: new Map() });
	performance.now = () => (F.virtual ? F.t : realNow());
	window.requestAnimationFrame = (cb) => {
		if (!F.virtual) return realRaf(cb);
		const id = F.id++;
		F.queue.set(id, cb);
		return -id;
	};
	window.cancelAnimationFrame = (id) => (id < 0 ? F.queue.delete(-id) : realCaf(id));
	F.enter = () => ((F.t = realNow()), (F.virtual = true));
	F.leave = () => {
		F.virtual = false;
		const q = [...F.queue.values()];
		F.queue.clear();
		q.forEach((cb) => realRaf(cb));
	};
	F.step = (ms) => {
		F.t += ms;
		const q = [...F.queue.values()];
		F.queue.clear();
		for (const cb of q) cb(F.t);
	};
});

await page.goto(`${SITE}/games/sandbox-4/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__village && !document.querySelector('.loading'), { timeout: 240000 });
console.log('world ready');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stage(shot) {
	// where the walker stands decides which dome is built and shown in full; wait for it in real time
	await page.evaluate((s) => {
		window.__interiorHour = s.hour;
		window.__village.place(s.stand[0], s.stand[1], 0, 0);
	}, shot);
	// a set built into the world for this shot (scripts/film/props.mjs): once, then it stays
	if (shot.props) await page.evaluate(sets[shot.props]);
	if (shot.dome !== undefined) {
		await page.waitForFunction((i) => window.__village.built.has(i) && window.__village.shown.has(i), { timeout: 240000, polling: 500 }, shot.dome);
		await sleep(1500);
	} else await sleep(2500);
}

async function frameAt(shot, t, warm = 0, dt = 0) {
	// the hour and the lens can move within a shot too: a sunrise in time-lapse, a slow zoom
	const lerp = (a, b) => (b === undefined ? a : a + (b - a) * t);
	const hour = lerp(shot.hour, shot.hourTo), fov = lerp(shot.fov ?? 45, shot.fovTo);
	// a shot with `blur` is exposed over the frame's time, as a real shutter does: a whip pan smears, a still holds
	const n = shot.blur ? shot.blur : 1;
	const clock = (shot.start ?? 0) + t * (shot.seconds ?? 0); // the film's time at this frame: the set's trucks drive on it
	const poses = Array.from({ length: n }, (_, i) => shot.path(Math.min(1, t + (dt * i) / n)));
	return page.evaluate(
		(poses, hour, fov, warm, ms, scale, clock, exposure) => {
			const v = window.__village, F = window.__film;
			window.__props?.(clock);
			// the world looks at the clock once a second; a time-lapse needs the sun set on every frame
			// the lens opened for a dark shot (`exposure`), and the sun set at once when either changes
			if (window.__interiorHour !== hour || window.__exposure !== exposure) (window.__interiorHour = hour), (window.__exposure = exposure), v.sun(hour);
			v.camera.fov = fov;
			v.camera.updateProjectionMatrix();
			v.renderer.setPixelRatio(scale);
			v.fly(...poses[0]);
			for (let i = 0; i < warm; i++) F.step(ms); // let the sun, the shadows and the far forest settle
			if (poses.length === 1) {
				F.step(ms);
				return v.renderer.domElement.toDataURL('image/jpeg', 0.94);
			}
			const src = v.renderer.domElement, acc = document.createElement('canvas');
			acc.width = src.width;
			acc.height = src.height;
			const g = acc.getContext('2d');
			for (const [i, p] of poses.entries()) {
				v.fly(...p);
				F.step(ms / poses.length);
				g.globalAlpha = 1 / (i + 1);
				g.drawImage(src, 0, 0);
			}
			return acc.toDataURL('image/jpeg', 0.94);
		},
		poses, hour, fov, warm, 1000 / FPS, SCALE, clock, shot.exposure ?? 1
	);
}

const save = (file, dataUrl) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

for (const [i, shot] of film.shots.entries()) {
	const n = i + 1;
	if (only && !only.includes(n)) continue;
	const tag = `${String(n).padStart(2, '0')}-${shot.name}`;
	const frames = Math.max(1, Math.round(shot.seconds * FPS));
	const t0 = Date.now();
	await stage(shot);
	await page.evaluate(() => window.__film.enter());
	// the world's next frame was asked for on the real clock: wait until it has handed over to the film's
	await page.waitForFunction(() => window.__film.queue.size > 0, { timeout: 10000, polling: 16 });
	if (stills) {
		let first = true;
		for (const [k, t] of midOnly ? [['b', 0.5]] : [['a', 0], ['b', 0.5], ['c', 1]]) {
			save(join(OUT, `${tag}-${k}.jpg`), await frameAt(shot, t, first ? 45 : 0));
			first = false;
		}
		console.log(`${tag}: stills`);
	} else {
		const dir = join(OUT, `.${tag}`);
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
		for (let f = 0; f < frames; f++) {
			save(join(dir, `${String(f).padStart(5, '0')}.jpg`), await frameAt(shot, frames === 1 ? 0 : f / (frames - 1), f === 0 ? 45 : 0, frames === 1 ? 0 : 1 / (frames - 1)));
			if (f % 30 === 0) process.stdout.write(`\r${tag}: ${f}/${frames}   `);
		}
		// the master: the 1.5× frames scaled down to the film's size, ungraded, kept (NN-name.raw.mp4) so a shot can be
		// graded again without rendering it again (node scripts/film/grade.mjs)
		const raw = join(OUT, `${tag}.raw.mp4`);
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%05d.jpg'),
			'-vf', `scale=${SIZE}:${SIZE}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', raw]);
		// the grade (grade.mjs): brightness and black level for its hour, measured finished, then the light look
		const sample = [0, 0.25, 0.5, 0.75, 1].map((k) => join(dir, `${String(Math.round(k * (frames - 1))).padStart(5, '0')}.jpg`));
		const chain = (exposure) => `scale=${SIZE}:${SIZE}:flags=lanczos,${exposure ? `${exposure},` : ''}${lookOf(shot)}`;
		const exposure = exposureFor(shot, sample, chain);
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', `${exposure ? `${exposure},` : ''}${lookOf(shot)}`,
			'-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', join(OUT, `.${tag}.part.mp4`)]);
		// in place in one step: whatever watches the folder never sees a half-written shot
		renameSync(join(OUT, `.${tag}.part.mp4`), join(OUT, `${tag}.mp4`));
		rmSync(dir, { recursive: true, force: true });
		process.stdout.write(`\r${tag}: ${frames} frames → ${tag}.mp4 (${Math.round((Date.now() - t0) / 1000)} s)\n`);
	}
	await page.evaluate(() => window.__film.leave());
}

await browser.close();
