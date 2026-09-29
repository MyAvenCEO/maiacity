// The grade, shot by shot. The world renders a sunrise, a blue hour or a night far darker than a film should show it
// (a night frame averaged 4–15 of 255), and a lifted shot goes flat and milky beside the ones lit by day. So every
// shot is measured and brought to two targets for its hour, on the finished image (exposure, base grade, its look,
// vignette — whatever the chain takes away is made up):
//   · brightness — the mean of the lower 60% of the frame (the land, the domes; a bright sky does not count);
//   · black level — the 10% darkest there, matched to the day shots (≈ 45), so a lifted dawn keeps its depth.
// Brightness by a gamma curve; black level by contrast, which is only ever added, never taken away.
//
// Used by shoot.mjs (which keeps an ungraded master of each shot, NN-name.raw.mp4) and the storyboard builder.
// Re-grade finished shots without rendering them again:
//   node scripts/film/grade.mjs scripts/film/day-19-d.mjs [--only 1,2]
// — from the master where there is one, else a correction on top of the graded shot.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** How bright a shot should read (mean luma, 0–255), by its hour. A shot may set its own `bright`. */
export function targetOf(shot) {
	if (shot.bright) return shot.bright;
	if (shot.mood === 'dip') return 86; //       the world as it was: dull, heavy
	if (shot.mood === 'bright') return 118; //   the city by day, from breakfast on: light, lively
	const h = shot.hour;
	if (h < 5.2) return 100; //     before the sun: soft, but every shape readable
	if (h < 6.2) return 106; //     sunrise
	if (h >= 20.2) return 72; //    night: dark, never black
	if (h >= 19.5) return 88; //    blue hour
	return 108; //                  day
}

/** How deep its shadows should go (the 10% darkest), by its hour: the day shots' ≈ 45, deeper at night. */
export function blackOf(shot) {
	if (shot.mood === 'dip') return 26; //       hard, deep shadows
	if (shot.mood === 'bright') return 34; //    punchy
	const h = shot.hour;
	if (h >= 20.2) return 24;
	if (h >= 19.5) return 32;
	if (h < 5.2) return 38;
	return 44;
}

const measure = (f) => {
	const out = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'scale=270:270,crop=iw:ih*0.6:0:ih*0.4,signalstats,metadata=print:file=-', '-frames:v', '1', '-f', 'null', '-']).toString();
	const n = (k) => Number(new RegExp(`${k}=([\\d.]+)`).exec(out)?.[1] ?? 128);
	return { avg: n('YAVG'), low: n('YLOW'), high: n('YHIGH') };
};

/** The mean luma (lower 60% of the frame) of some images. */
export function lumaOf(files) {
	return files.reduce((n, f) => n + measure(f).avg, 0) / files.length;
}

const filterOf = (g, c) =>
	`eq=gamma=${g.toFixed(3)}:contrast=${c.toFixed(3)}:saturation=${(1 + Math.max(0, g - 1) * 0.12 + (c - 1) * 0.1).toFixed(3)}`;

/** The filter that brings a shot to its brightness and black level *as finished*: `chain(filter)` is the whole
 *  filter the shot gets, `samples` a few of its frames. Empty when it is already right. */
export function exposureFor(shot, samples, chain) {
	const want = targetOf(shot), black = blackOf(shot), probe = join(tmpdir(), `grade-${process.pid}.jpg`);
	const finished = (g, c) => {
		let avg = 0, low = 0;
		for (const s of samples) {
			execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', s, '-vf', chain(g === 1 && c === 1 ? '' : filterOf(g, c)), '-frames:v', '1', probe]);
			const m = measure(probe);
			avg += m.avg / samples.length;
			low += m.low / samples.length;
		}
		return { avg, low };
	};
	let g = 1, c = 1, m = finished(1, 1);
	for (let i = 0; i < 6 && (Math.abs(m.avg - want) >= 4 || m.low > black + 5); i++) {
		g = Math.min(3.2, Math.max(0.92, g * (Math.log(Math.max(m.avg, 3) / 255) / Math.log(want / 255))));
		// contrast pivots on mid-grey: to take the shadows from `low` down to `black`, stretch by the ratio
		if (m.low > black + 5) c = Math.min(1.8, c * ((128 - black) / Math.max(8, 128 - m.low)));
		m = finished(g, c);
	}
	rmSync(probe, { force: true });
	return g === 1 && c === 1 ? '' : filterOf(g, c);
}

/** Five frames of a video, as images, for measuring. */
export function samplesOf(video, dir) {
	mkdirSync(dir, { recursive: true });
	const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString());
	return [0.02, 0.25, 0.5, 0.75, 0.97].map((k, i) => {
		const f = join(dir, `s${i}.jpg`);
		// never seek past the last frame (that gives no image at all)
		execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', Math.min(k * seconds, Math.max(0, seconds - 0.25)).toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', f]);
		return f;
	});
}

/** The light grade every shot gets after its exposure: a touch of contrast, the shot's own look, a vignette. */
export const lookOf = (shot) => `eq=contrast=1.05:saturation=1.06:gamma=0.98,${shot.grade ? `${shot.grade},` : ''}${shot.extra ? `${shot.extra},` : ''}vignette=angle=PI/5`;

// ── re-grading finished shots ─────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const args = process.argv.slice(2);
	const list = args.find((a) => a.endsWith('.mjs'));
	const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',').map(Number) : null;
	const film = (await import(pathToFileURL(resolve(list)).href)).default;
	const DIR = resolve('studio/film', film.name);
	for (const [i, shot] of film.shots.entries()) {
		if (only && !only.includes(i + 1)) continue;
		const tag = `${String(i + 1).padStart(2, '0')}-${shot.name}`, out = join(DIR, `${tag}.mp4`), raw = join(DIR, `${tag}.raw.mp4`);
		const master = existsSync(raw);
		if (!master && !existsSync(out)) continue;
		// a shot rendered before masters were kept: its first graded version is kept once as its base
		// (NN-name.base.mp4), so grading it again never stacks one grade on another
		const base = join(DIR, `${tag}.base.mp4`);
		if (!master && !existsSync(base)) execFileSync('cp', [out, base]);
		const src = master ? raw : base;
		const work = join(tmpdir(), `regrade-${tag}`);
		const samples = samplesOf(src, work);
		// from the master: the whole grade; from a graded shot: only the correction on top of what it has
		const chain = master ? (f) => `${f ? `${f},` : ''}${lookOf(shot)}` : (f) => [f, shot.extra].filter(Boolean).join(',') || 'null';
		const fix = exposureFor(shot, samples, chain);
		if (!fix && !master) {
			console.log(`${tag}: already right`);
			continue;
		}
		const tmp = join(work, 'out.mp4');
		// graded in YUV (eq) without leaving it; BT.709 matrix and TV range kept and tagged on the way out
		execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', `${chain(fix)},scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`,
			'-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', tmp]);
		renameSync(tmp, out);
		rmSync(work, { recursive: true, force: true });
		console.log(`${tag}: ${fix || 'graded'}${master ? ' (from the master)' : ''}`);
	}
}
