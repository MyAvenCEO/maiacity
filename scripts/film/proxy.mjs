// A file's HD proxy, for editing (revised rule 2): long edge 1920 (never larger than the file), in log — camera log
// keeps its own log, linear and HDR light is encoded into ACEScct by exact maths, display-referred pictures stay as
// they are. No grade and no output transform is ever in a proxy: the studio's viewer applies the proxy's input
// transform, the grade and the output transform live, from the configs.
//
// Video and EXR sequences: HEVC Main10 4:2:0, BT.709 matrix, TV range, a keyframe every 15 frames for scrubbing,
// tagged `comment=maiacity:color=<the proxy's profile>`. Stills: only a float still (EXR) or one larger than HD gets
// one — a 16-bit PNG in ACEScct, or the still at HD.
//
// The render worker no longer makes these: the Mac app does, natively (vault/crates/vault-media/src/proxy.rs is the
// twin of this file). Kept as the reference for its rules, and for making one by hand.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { proxyProfileOf } from '../../game/film/color.js';
import { hevcEncoder, proxyColor, TAGS } from './color/ffmpeg.mjs';
import { inputArgs } from './sources.mjs';

export const LONG_EDGE = 1920, GOP = 15;

/** The proxy's frame: long edge 1920 at most, even sides. */
export function proxySize(/** @type {number} */ w, /** @type {number} */ h) {
	const k = Math.min(1, LONG_EDGE / Math.max(w, h));
	return [2 * Math.round((w * k) / 2), 2 * Math.round((h * k) / 2)];
}

/** Run ffmpeg; its error, when it fails, is the error. */
export function ffmpeg(/** @type {string[]} */ args, /** @type {(seconds: number) => void} */ progress = () => {}) {
	return new Promise((ok, bad) => {
		const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args]);
		let err = '';
		p.stdout.on('data', (d) => {
			const us = /out_time_us=(\d+)/.exec(String(d))?.[1];
			if (us) progress(Number(us) / 1e6);
		});
		p.stderr.on('data', (d) => (err += d));
		p.on('close', (code) => (code === 0 ? ok(undefined) : bad(new Error(err.slice(-600) || `ffmpeg exited ${code}`))));
	});
}

/**
 * Make the proxy of a source into `dir`. Null when it needs none (a small display-referred still).
 * @param {import('./sources.mjs').Source} src @param {string} dir @param {(x: number) => void} [progress] 0…1
 * @returns {Promise<{ file: string, mime: string, profile: string, width: number, height: number, used: Record<string, string>, seconds: number | null } | null>}
 */
export async function makeProxy(src, dir, progress = () => {}) {
	const profile = src.profile;
	const target = proxyProfileOf(profile);
	const [w, h] = proxySize(src.width, src.height);
	const resize = w !== src.width || h !== src.height ? [`zscale=w=${w}:h=${h}:f=lanczos`] : [];
	const color = proxyColor(profile, src.coding);
	const comment = ['-metadata', `comment=maiacity:color=${target}`];
	if (src.kind === 'image') {
		const float = src.coding.float;
		if (!float && !resize.length) return null;
		const file = join(dir, 'proxy.png');
		// a still: its display code values at HD, or the float still in ACEScct at 16 bits
		const filters = float ? [...resize, ...color.log, 'format=rgb48be'] : [...resize, 'format=rgb24'];
		await ffmpeg(['-i', src.file, '-frames:v', '1', '-vf', filters.join(','), ...comment, file]);
		return { file, mime: 'image/png', profile: target, width: w, height: h, used: color.used, seconds: null };
	}
	const file = join(dir, 'proxy.mp4');
	const seconds = src.kind === 'sequence' ? (src.frames ?? 1) / src.fps : Number(src.format.duration ?? src.stream.duration ?? 0);
	const input = src.kind === 'sequence' ? inputArgs(src, 0, seconds + 1, src.fps) : ['-i', src.file];
	const enc = hevcEncoder();
	const rate = enc.hevc === 'libx265'
		? ['-crf', '20', '-x265-params', `keyint=${GOP}:min-keyint=${GOP}:scenecut=0:log-level=error`, '-pix_fmt', 'yuv420p10le']
		: ['-b:v', '12M', '-pix_fmt', 'p010le'];
	await ffmpeg([
		...input, '-map', '0:v:0', ...(src.audio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '160k'] : []),
		'-vf', [...resize, ...color.filters].join(','), ...enc.args, ...rate, '-g', String(GOP), '-tag:v', 'hvc1', ...TAGS, ...comment,
		'-movflags', '+faststart', file
	], (t) => progress(seconds ? Math.min(1, t / seconds) : 0));
	return { file, mime: 'video/mp4', profile: target, width: w, height: h, used: color.used, seconds };
}
