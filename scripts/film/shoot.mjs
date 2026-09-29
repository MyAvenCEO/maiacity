// The film camera from the command line: world shots rendered as log plates (ACEScct, 10-bit HEVC), or stills for the
// storyboard — a thin CLI over Sandbox 4's film mode (src/lib/film) and the plate renderer (scripts/film/world).
//
//   node scripts/film/shoot.mjs scripts/film/day-19-d.mjs              every shot, as a plate (studio/film/<name>/NN-shot.mov)
//   node scripts/film/shoot.mjs scripts/film/worlds/day-19-d.json --seconds 4   records (untimed ones need a length)
//   node scripts/film/shoot.mjs … --stills | --mid                    the first, middle and last frame / the middle one, as PNG
//   node scripts/film/shoot.mjs … --only 3,7 --shape 16:9 --size 1920x1080 --lut odt.cube
//
// A shot list written before shots were data (day-19-d.mjs: paths from camera.mjs, hour, blur, mood, grade…) is read
// as records by fromLegacy: its camera moves exactly as before; its look is no longer baked in (the plate is log, the
// grade happens in the studio). Its timing comes from the voice's word timings (library/, or LIBRARY=<dir>).
// `--lut <file.cube>`: also a display preview beside each plate (ACEScct → the LUT → Rec.709 H.264) and the stills
// through it; without one the stills use film mode's stand-in view.
//
// Needs the site (SITE, default http://localhost:5173: `bun run dev`, or a pinned build — scripts/film/world/site.mjs)
// and Chrome (CHROME; FILM_ANGLE=metal on the Mac, swiftshader where there is no GPU).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromLegacy, normalize } from '../../game/film/shot.js';
import { openWorld, receiver, renderPlate } from './world/render.mjs';

const args = process.argv.slice(2);
const listFile = args.find((a) => /\.(mjs|json)$/.test(a));
if (!listFile) throw new Error('usage: node scripts/film/shoot.mjs <shot list.mjs | records.json> [--stills | --mid] [--only 1,4] [--shape 1:1] [--size 1080 | WxH] [--seconds n] [--lut file.cube]');
const flag = (/** @type {string} */ k) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : undefined);
const midOnly = args.includes('--mid');
const stills = args.includes('--stills') || midOnly;
const only = flag('only')?.split(',').map(Number);
const SITE = process.env.SITE ?? 'http://localhost:5173';

/** @type {{ name: string, shots: { name: string, spec: any }[] }} */
let film;
if (listFile.endsWith('.json')) {
	const j = JSON.parse(readFileSync(listFile, 'utf8'));
	const seconds = Number(flag('seconds'));
	film = {
		name: j.film ?? basename(listFile, '.json'),
		shots: j.shots.map((/** @type {any} */ s) => {
			if (s.spec.seconds === null && !seconds) throw new Error(`${s.name}: untimed — give --seconds, or render it from its timeline`);
			return { name: s.name, spec: s.spec.seconds === null ? { ...s.spec, seconds, world: { ...s.spec.world, clock: 0 } } : s.spec };
		})
	};
} else {
	const list = (await import(pathToFileURL(resolve(listFile)).href)).default;
	if (!list.cuts) throw new Error(`${listFile} has no timing without the voice's word timings: set LIBRARY=<dir with <cid>.json>, or use its records (scripts/film/worlds/export.mjs) with --seconds`);
	film = { name: list.name, shots: list.shots.map((/** @type {any} */ s) => ({ name: s.name, spec: fromLegacy(s, { fps: list.fps ?? 30 }) })) };
}
const size = flag('size') ?? '1080';
const [W, H] = size.includes('x') ? size.split('x').map(Number) : [Number(size), Number(size)];
const shape = /** @type {any} */ (flag('shape'));
const lutFile = flag('lut');
const OUT = resolve('studio/film', film.name);
mkdirSync(OUT, { recursive: true });

const world = await openWorld({ site: SITE, log: (s) => console.log(s) });
console.log(`world ready${world.build ? ` (build ${world.build.commit.slice(0, 9)})` : ' (dev build)'}`);
const lut = lutFile ? readFileSync(lutFile, 'utf8') : null;
const inbox = stills ? await receiver() : null;

for (const [i, shot] of film.shots.entries()) {
	const n = i + 1;
	if (only && !only.includes(n)) continue;
	const tag = `${String(n).padStart(2, '0')}-${shot.name}`;
	const spec = normalize(shot.spec);
	const t0 = Date.now();
	if (stills && inbox) {
		for (const [k, p] of midOnly ? [['b', 0.5]] : [['a', 0], ['b', 0.5], ['c', 1]]) {
			const ask = { spec, t: Math.min(spec.seconds - 1 / spec.fps, /** @type {number} */ (p) * spec.seconds), shape, width: W, height: H, view: { lut }, quality: 'final' };
			await world.page.evaluate(async (a, url) => {
				const b = await window.__film.still(a);
				await fetch(url, { method: 'POST', body: b });
			}, ask, `${inbox.url}/${tag}-${k}`);
			writeFileSync(join(OUT, `${tag}-${k}.png`), /** @type {Buffer} */ (inbox.take(`${tag}-${k}`)));
		}
		console.log(`${tag}: stills`);
		continue;
	}
	const file = join(OUT, `${tag}.mov`);
	const r = await renderPlate({ spec, shape, width: W, height: H, out: file, world, progress: (d, of) => d % 30 === 0 && process.stdout.write(`\r${tag}: ${d}/${of}   `) });
	if (lut && lutFile) {
		// a display preview to look at: the plate through the LUT, Rec.709 — a copy, never the master
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', `scale=in_range=tv:in_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=gbrpf32le,lut3d=file='${lutFile}',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
			'-c:v', 'libx264', '-crf', '16', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', join(OUT, `${tag}.preview.mp4`)]);
	}
	process.stdout.write(`\r${tag}: ${r.frames} frames → ${basename(file)} (ev ${JSON.stringify(r.ev)}, ${Math.round((Date.now() - t0) / 1000)} s)\n`);
}
await inbox?.close();
await world.close();
