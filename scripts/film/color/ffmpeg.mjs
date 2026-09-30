// The colour-managed picture path in ffmpeg: the configs of game/film/transforms.js turned into filter chains, and
// the LUTs they need made on the spot (render time) and cached on this machine by the hash of their config.
//
//   decode → zscale into float RGB (gbrpf32le) with the file's own matrix and range → IDT → ACEScct
//   → scale / crop / fps in float → clip grade → film look (ASC CDL, the maths of cdl() in color.js)
//   → ODT (ACES 2.0, Rec.709 SDR, a 129³ LUT baked from OCIO now) → Rec.709 display code values
//   → YUV 4:2:0 10-bit, BT.709 matrix, TV range.
//
// Every clip takes that one path, whatever it is: Rec.709 video and sRGB stills too, by their camera-curve journey
// into ACEScct (cst.rs). A clip whose colour is unknown is taken as Rec.709.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES, cdl, isNeutral, satMatrix } from '../../../game/film/color.js';
import { AP0_TO_AP1, DECODE, hashOf, LUT_SIZE, RENDER_LUT_SIZE, SHAPER, shaperToCct, TRANSFORMS } from '../../../game/film/transforms.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BAKE = resolve(HERE, 'bake.py');
export const CACHE = process.env.MAIACITY_CACHE ?? join(homedir(), '.cache', 'maiacity');
const LUTS = join(CACHE, 'luts');
const PYTHON = process.env.PYTHON ?? 'python3';

/** @typedef {import('../../../game/film/color.js').Cdl} Cdl */
/** @typedef {import('../../../game/film/color.js').Profile} Profile */
/** @typedef {import('../../../game/film/transforms.js').TransformConfig} TransformConfig */
/** @typedef {import('../../../game/film/transforms.js').TransformName} TransformName */

/** @type {string | null} */
let ocio = null;
/** The OpenColorIO version the baker runs (part of every cache key); fails loudly with the fix when it is missing. */
export function ocioVersion() {
	if (ocio) return ocio;
	const r = spawnSync(PYTHON, [BAKE, '--version'], { encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`OpenColorIO is needed to render in colour: pip install opencolorio numpy (${(r.stderr || r.error?.message || '').trim().slice(-200)})`);
	return (ocio = r.stdout.trim());
}

/** Check once that this ffmpeg has what the colour path needs. */
export function checkFfmpeg() {
	const filters = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });
	const missing = ['zscale', 'lut3d', 'lut1d', 'colorchannelmixer', 'exposure'].filter((f) => !new RegExp(`\\s${f}\\s`).test(filters));
	if (missing.length) throw new Error(`this ffmpeg lacks ${missing.join(', ')} — install one built with zimg (brew install ffmpeg; apt install ffmpeg)`);
}

/** @type {{ hevc: string, args: string[] } | null} */
let hevcCache = null;
/** The HEVC Main10 encoder here: VideoToolbox on the Mac, else x265. */
export function hevcEncoder() {
	if (hevcCache) return hevcCache;
	const enc = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
	if (/\shevc_videotoolbox\s/.test(enc) && process.env.MAIACITY_HEVC !== 'libx265') return (hevcCache = { hevc: 'hevc_videotoolbox', args: ['-c:v', 'hevc_videotoolbox', '-profile:v', 'main10', '-allow_sw', '1'] });
	if (/\slibx265\s/.test(enc)) return (hevcCache = { hevc: 'libx265', args: ['-c:v', 'libx265', '-profile:v', 'main10', '-preset', process.env.MAIACITY_X265_PRESET ?? 'medium'] });
	throw new Error('no HEVC encoder in this ffmpeg (hevc_videotoolbox or libx265)');
}

/** Output tags: every file says what it is — BT.709 primaries, transfer and matrix, TV range. */
export const TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
/** The same, on the frames inside a graph (so no filter or encoder guesses). */
export const SETPARAMS = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

const q = (/** @type {string} */ p) => `'${p.replace(/'/g, "'\\''")}'`;

function writeAtomic(/** @type {string} */ file, /** @type {string | Uint8Array} */ body) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file + '.part', body);
	renameSync(file + '.part', file);
}

/**
 * The LUT of an OCIO transform, baked now (or found in the cache): its file and the hash that pins it. 'cube' is a 3D
 * LUT, 'cube1d' a 1D one (a per-channel curve).
 * @param {TransformConfig} config @param {{ size?: number, format?: 'cube' | 'cube1d', name?: string }} [o]
 */
export function bakedLut(config, o = {}) {
	const size = o.size ?? LUT_SIZE, format = o.format ?? 'cube';
	const hash = hashOf({ config, ocio: ocioVersion(), size, format });
	const file = join(LUTS, `${hash}.${{ cube: 'cube', cube1d: '1d.cube' }[format]}`);
	if (!existsSync(file)) {
		mkdirSync(LUTS, { recursive: true });
		const r = spawnSync(PYTHON, [BAKE, '--config', JSON.stringify(config), '--size', String(size), '--format', format, '--out', file, '--name', o.name ?? ''], { encoding: 'utf8' });
		if (r.status !== 0) throw new Error(`baking ${o.name ?? config.kind} failed: ${(r.stderr || '').trim().slice(-300)}`);
	}
	return { file, hash };
}

/**
 * A 1D LUT (.cube) from a function, written once and cached by the hash of what it is.
 * @param {object} what the curve, as data (hashed) @param {(x: number) => number[]} f input → [r, g, b]
 * @param {{ size?: number, max?: number }} [o]
 */
export function curveLut(what, f, o = {}) {
	const size = o.size ?? 65536, max = o.max ?? 1;
	const hash = hashOf({ what, size, max, v: 1 });
	const file = join(LUTS, `${hash}.1d.cube`);
	if (!existsSync(file)) {
		const lines = [`LUT_1D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', `DOMAIN_MAX ${max} ${max} ${max}`];
		for (let i = 0; i < size; i++) lines.push(f((i / (size - 1)) * max).map((v) => (Number.isFinite(v) ? v : 0).toPrecision(9)).join(' '));
		writeAtomic(file, lines.join('\n') + '\n');
	}
	return { file, hash };
}

/** The ACEScct shaper's second half: PQ signal → ACEScct (see SHAPER in transforms.js). */
export const shaperLut = () => curveLut({ shaper: SHAPER }, (u) => { const v = shaperToCct(u); return [v, v, v]; }, { size: SHAPER.size });

/** Linear light (AP1, float) → ACEScct, exactly, in ffmpeg filters. */
export function linearToCct() {
	const { file, hash } = shaperLut();
	return {
		filters: [`exposure=exposure=0:black=${-SHAPER.offset}`, `zscale=tin=linear:t=smpte2084:npl=${SHAPER.npl}`, `lut1d=file=${q(file)}:interp=linear`],
		hash
	};
}

const matrixFilter = (/** @type {number[][]} */ m) =>
	`colorchannelmixer=${['r', 'g', 'b'].flatMap((o, i) => ['r', 'g', 'b'].map((c, j) => `${o}${c}=${m[i][j]}`)).join(':')}`;

/**
 * The filters that take float RGB in a transform's source space into ACEScct, and the hash pinning them.
 * @param {TransformName} name
 */
export function idtFilters(name) {
	/** @type {TransformConfig} */
	const config = TRANSFORMS[name];
	if (!config) throw new Error(`no transform ${name}`);
	if (config.kind === 'identity') return { filters: [], hash: hashOf(config) };
	if (config.kind === 'math') {
		/** @type {string[]} */
		const filters = [];
		const decode = DECODE[config.decode];
		if (!decode) throw new Error(`${name}: no curve '${config.decode}' to decode`);
		// the curve (× scale) as a 1D LUT over the code values 0…1; linear light needs none
		if (config.decode !== 'linear') {
			const lut = curveLut({ decode: config.decode, scale: config.scale }, (v) => { const x = decode(v) * config.scale; return [x, x, x]; });
			filters.push(`lut1d=file=${q(lut.file)}:interp=linear`);
		}
		if (config.matrix) filters.push(matrixFilter(config.matrix));
		const shaper = linearToCct();
		filters.push(...shaper.filters);
		return { filters, hash: hashOf({ config, shaper: shaper.hash }) };
	}
	const log = logCamera(config);
	if (log) {
		// camera log (a per-channel curve, a 3×3 into AP0, then ACEScct) by exact maths, as the linear sources: the
		// curve as a 1D LUT from OCIO, the two matrices as one, and the PQ-shaped ACEScct encoding — no 3D LUT
		const curve = bakedLut({ kind: 'ocio-group', config: log.config, steps: [log.curve], source: log.source }, { name: `${name} curve`, size: 65536, format: 'cube1d' });
		const shaper = linearToCct();
		return {
			filters: [`lut1d=file=${q(curve.file)}:interp=linear`, matrixFilter(mul3(AP0_TO_AP1, log.matrix)), ...shaper.filters],
			hash: hashOf({ config, curve: curve.hash, shaper: shaper.hash })
		};
	}
	const { file, hash } = bakedLut(config, { name });
	return { filters: [`lut3d=file=${q(file)}:interp=tetrahedral`], hash };
}

/**
 * A camera-log input transform in the separable shape [builtin curve, 3×3 into AP0, ACES2065-1 → ACEScct] (Apple
 * Log 2), or null.
 * @param {TransformConfig} c
 */
function logCamera(c) {
	if (c.kind !== 'ocio-group' || c.steps.length !== 3) return null;
	const [a, b, d] = /** @type {any[]} */ (c.steps);
	if (!a.builtin?.startsWith('CURVE - ') || !b.matrix || d.convert?.[0] !== 'ACES2065-1' || d.convert?.[1] !== 'ACEScct') return null;
	return { config: c.config, source: c.source, curve: /** @type {{ builtin: string }} */ (a), matrix: /** @type {number[][]} */ (b.matrix) };
}

const mul3 = (/** @type {number[][]} */ a, /** @type {number[][]} */ b) => a.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));

/** The output transform: ACEScct → Rec.709 display code values (float RGB), at the render's LUT size. */
export function odtFilters(/** @type {TransformName} */ name = 'odt-rec709') {
	const { file, hash } = bakedLut(TRANSFORMS[name], { name, size: RENDER_LUT_SIZE });
	return { filters: [`lut3d=file=${q(file)}:interp=tetrahedral`], hash };
}

/**
 * An ASC CDL in ACEScct as filters: slope, offset and power per channel in a 1D LUT over ACEScct 0…1.5 (the maths
 * of cdl() in color.js), then saturation around Rec.709 luma as a 3×3. Nothing for a neutral grade.
 * @param {Cdl | null | undefined} g
 */
export function cdlFilters(g) {
	if (!g || isNeutral(g)) return { filters: [], hash: null };
	const noSat = { ...g, sat: 1 };
	const { file, hash } = curveLut({ cdl: noSat }, (x) => cdl(noSat, [x, x, x]), { max: 1.5 });
	const filters = [`lut1d=file=${q(file)}:interp=linear`];
	if (g.sat !== 1) {
		const m = satMatrix(g.sat);
		filters.push(matrixFilter([m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)]));
	}
	return { filters, hash: hashOf({ cdl: g, lut: hash }) };
}

/** zscale's names for ffprobe's matrix names. */
const ZMATRIX = /** @type {Record<string, string>} */ ({ bt709: '709', smpte170m: '170m', bt470bg: '470bg', bt2020nc: '2020_ncl', bt2020c: '2020_cl', fcc: 'fcc', smpte240m: '240m' });

/**
 * How a decoded picture's YUV is read: its matrix and range, from its tags, else what a file of its kind is.
 * @param {{ pix_fmt?: string, color_space?: string, color_range?: string, height?: number, codec_name?: string }} s ffprobe stream
 * @returns {{ rgb: boolean, float: boolean, matrix: string, range: 'limited' | 'full' }}
 */
export function codingOf(s) {
	const pix = s.pix_fmt ?? '';
	const float = /f(16|32)/.test(pix) || s.codec_name === 'exr';
	const rgb = float || /^(rgb|bgr|gbr|argb|abgr|rgba|bgra|gray|ya|pal8|monob|monow)/.test(pix);
	const matrix = ZMATRIX[s.color_space ?? ''] ?? ((s.height ?? 1080) >= 720 ? '709' : '170m');
	const range = rgb || pix.startsWith('yuvj') || s.color_range === 'pc' ? 'full' : 'limited';
	return { rgb, float, matrix, range };
}

/** Decoded picture → float RGB (gbrpf32le), read with its own matrix and range. */
export function toFloat(/** @type {ReturnType<typeof codingOf>} */ c) {
	if (c.float) return ['format=gbrpf32le'];
	if (c.rgb) return ['zscale=rin=full:r=full', 'format=gbrpf32le'];
	return [`zscale=min=${c.matrix}:rin=${c.range}:r=full`, 'format=gbrpf32le'];
}

/** Display RGB (float, 0…1) → the timeline's YUV: 4:2:0 10-bit, BT.709 matrix, TV range. */
export const floatToYuv = () => ['zscale=m=709:r=limited:d=ordered', 'format=yuv420p10le', SETPARAMS];

/**
 * Everything that happens to one clip's picture, as filter parts around the geometry: `before` (to ACEScct, float),
 * `after` (grades, ODT, to YUV); the transforms used, by name → hash. An unknown profile is taken as Rec.709.
 * @param {{ profile: Profile | 'unknown', coding: ReturnType<typeof codingOf>, grade?: Cdl | null, look?: Cdl | null }} o
 */
export function clipColor(o) {
	/** @type {Record<string, string>} */
	const used = {};
	const profile = o.profile in PROFILES ? /** @type {Profile} */ (o.profile) : 'rec709';
	const idtName = /** @type {TransformName} */ (PROFILES[profile].idt ?? 'idt-acescct');
	const idt = idtFilters(idtName);
	used[idtName] = idt.hash;
	const clip = cdlFilters(o.grade), look = cdlFilters(o.look), odt = odtFilters();
	if (clip.hash) used['grade:clip'] = clip.hash;
	if (look.hash) used['grade:look'] = look.hash;
	used['odt-rec709'] = odt.hash;
	return {
		before: [...toFloat(o.coding), ...idt.filters],
		after: [...clip.filters, ...look.filters, ...odt.filters, ...floatToYuv()],
		used
	};
}
