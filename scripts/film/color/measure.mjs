// Measuring the colour path: float RGB pixels through an ffmpeg filter chain, and through OpenColorIO itself, so the
// two can be compared. Used by the tests (api/test/film-color.test.ts) and by hand:
//
//   bun scripts/film/color/measure.mjs      prints how far each exact-maths and baked transform is from OCIO
import { spawnSync } from 'node:child_process';
import { BAKE } from './ffmpeg.mjs';

/**
 * Run float RGB triples through an ffmpeg filter chain (as one row of gbrpf32le pixels) and read them back.
 * @param {number[][]} rgb @param {string[]} filters @param {{ out?: string }} [o]
 * @returns {number[][]}
 */
export function throughFfmpeg(rgb, filters, o = {}) {
	const w = rgb.length;
	const planes = new Float32Array(w * 3);
	// gbrp plane order: G, B, R
	rgb.forEach(([r, g, b], i) => ((planes[i] = g), (planes[w + i] = b), (planes[2 * w + i] = r)));
	const p = spawnSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-s', `${w}x1`, '-i', '-', '-vf', [...filters, `format=${o.out ?? 'gbrpf32le'}`].join(','), '-frames:v', '1', '-f', 'rawvideo', '-'], { input: Buffer.from(planes.buffer), maxBuffer: 1 << 28 });
	if (p.status !== 0) throw new Error(String(p.stderr));
	const out = new Float32Array(new Uint8Array(p.stdout).buffer);
	return rgb.map((_, i) => [out[2 * w + i], out[i], out[w + i]]);
}

/**
 * The exact transform of a config, by OpenColorIO (no LUT).
 * @param {object} config @param {number[][]} rgb @returns {number[][]}
 */
export function throughOcio(config, rgb) {
	const input = new Float32Array(rgb.flat());
	const p = spawnSync(process.env.PYTHON ?? 'python3', [BAKE, '--config', JSON.stringify(config), '--apply'], { input: Buffer.from(input.buffer), maxBuffer: 1 << 28 });
	if (p.status !== 0) throw new Error(String(p.stderr));
	const out = new Float32Array(new Uint8Array(p.stdout).buffer);
	return rgb.map((_, i) => [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]]);
}

/** The largest difference, and the 99th percentile, in 10-bit code values. */
export function diff(/** @type {number[][]} */ a, /** @type {number[][]} */ b) {
	const d = a.flatMap((x, i) => x.map((v, c) => Math.abs(v - b[i][c]) * 1023)).filter(Number.isFinite).sort((x, y) => x - y);
	return { max: d.at(-1) ?? 0, p99: d[Math.floor(d.length * 0.99)] ?? 0 };
}

/**
 * Realistic scene colours in ACEScct: linear AP1 from 2⁻⁹ to 2⁴ (deep shadow to bright highlight around 18% grey),
 * each channel within ±60% of the pixel's level — skies, skin, foliage, lamps; not laser primaries.
 * @param {() => number} r @returns {number[][]}
 */
export function realistic(r) {
	const toCct = (/** @type {number} */ lin) => (lin <= 0.0078125 ? 10.5402377416545 * lin + 0.0729055341958355 : (Math.log2(lin) + 9.72) / 17.52);
	return [...Array(4000)].map(() => {
		const level = 2 ** (r() * 13 - 9);
		return [0, 0, 0].map(() => toCct(level * (0.4 + r() * 1.2)));
	});
}

/** A seeded random generator (the same pixels every run). */
export function rng(seed = 1) {
	let s = seed;
	return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

if (import.meta.main || process.argv[1]?.endsWith('measure.mjs')) {
	const { idtFilters, odtFilters, linearToCct } = await import('./ffmpeg.mjs');
	const { TRANSFORMS, OCIO_CONFIG, SHAPER } = await import('../../../game/film/transforms.js');
	const { toCct } = await import('../../../game/film/color.js');
	const r = rng(3);
	// scene-linear light from deep shadow to far highlights (log-distributed), with a few small negatives
	const lin = [...Array(4000)].map(() => [0, 0, 0].map(() => (r() < 0.03 ? -r() * 0.005 : 2 ** (r() * 20 - 12))));
	// ACEScct below the shaper's floor (linear AP1 below −1/128: far outside AP1) is held there — the output
	// transform's LUT domain starts at ACEScct 0 anyway — so those pixels are left out of the comparison
	const inGamut = (/** @type {number[][]} */ got, /** @type {number[][]} */ want) => {
		const keep = want.map((p) => p.every((v) => v >= toCct(-SHAPER.offset)));
		return diff(got.filter((_, i) => keep[i]), want.filter((_, i) => keep[i]));
	};
	const shaper = linearToCct();
	console.log('linear → ACEScct (shaper) vs the curve:', diff(throughFfmpeg(lin, shaper.filters), lin.map((p) => p.map(toCct))));
	for (const [name, src] of /** @type {const} */ ([['idt-aces2065-1', 'ACES2065-1'], ['idt-acescg', 'ACEScg'], ['idt-linear-rec709', 'Linear Rec.709 (sRGB)']])) {
		const got = throughFfmpeg(lin, idtFilters(name).filters);
		console.log(`${name} vs OCIO ${src} → ACEScct:`, inGamut(got, throughOcio({ kind: 'ocio-convert', config: OCIO_CONFIG, src, dst: 'ACEScct' }, lin)));
	}
	const cct = [...Array(4000)].map(() => [r(), r(), r()]);
	console.log('odt-rec709 (65³ LUT) vs OCIO, the whole ACEScct cube:', diff(throughFfmpeg(cct, odtFilters().filters), throughOcio(TRANSFORMS['odt-rec709'], cct)));
	const scene = realistic(r);
	console.log('odt-rec709 (65³ LUT) vs OCIO, realistic scene colours:', diff(throughFfmpeg(scene, odtFilters().filters), throughOcio(TRANSFORMS['odt-rec709'], scene)));
	const alog = [...Array(4000)].map(() => { const base = 0.15 + r() * 0.65; return [0, 0, 0].map(() => base + (r() - 0.5) * 0.12); });
	console.log('idt-apple-log (65³) vs OCIO:', diff(throughFfmpeg(alog, idtFilters('idt-apple-log').filters), throughOcio(TRANSFORMS['idt-apple-log'], alog)));
	console.log('idt-apple-log-2 (65³) vs OCIO group:', diff(throughFfmpeg(alog, idtFilters('idt-apple-log-2').filters), throughOcio(TRANSFORMS['idt-apple-log-2'], alog)));
}
