// THE FILM'S COLOUR TRANSFORMS — as configs, never as baked files.
//
// Every transform the pipeline uses is data: which OpenColorIO config and colour spaces (or display and view), or
// which exact maths (a 3×3 matrix and a curve). Nothing is baked in advance and nothing baked is ever committed or
// kept as a library asset of its own: the render worker makes a LUT from a config only while it renders
// (`python3 scripts/film/color/bake.py --config '<json>' …`), cached on its own disk by `hashOf(config)` together
// with the OCIO version and the LUT size. The one exception is the studio viewer's *preview* LUTs: the worker bakes
// them from the same configs and puts them in the library as cache files (tag `role:lut`, meta
// `{ transform, hash, size, format }`), found through `GET /api/film/luts`.
//
// Shared by the render worker (Bun), the film scripts, and the studio (browser): plain JS, no imports but color.js.

import { REC709_TO_AP1, toCct } from './color.js';

/** The OpenColorIO config every OCIO transform comes from: built into OCIO ≥ 2.5 (ACES 2.0). */
export const OCIO_CONFIG = 'studio-config-v4.0.0_aces-v2.0_ocio-v2.5';
/** What every delivery shows: Rec.709, BT.1886 (gamma 2.4), SDR 100 nits, through the ACES 2.0 output transform. */
export const DISPLAY = 'Rec.1886 Rec.709 - Display';
export const VIEW = 'ACES 2.0 - SDR 100 nits (Rec.709)';

// ── matrices (row-major 3×3, linear light in → linear light out) ─────────────────────────────────────────────────

/** ACES2065-1 (AP0) → ACEScg (AP1); both D60, no adaptation. SMPTE ST 2065-1 / Academy S-2014-004 (ACEScg). */
export const AP0_TO_AP1 = [
	[1.4514393161, -0.2365107469, -0.2149285693],
	[-0.0765537734, 1.1762296998, -0.0996759264],
	[0.0083161484, -0.0060324498, 0.9977163014]
];

/** Linear Rec.2020 (D65) → ACEScg (AP1, D60), Bradford — identical to OCIO's 'Linear Rec.2020' → 'ACEScg'. */
export const REC2020_TO_AP1 = [
	[0.974894977924419, 0.019599108637005, 0.005505913438576],
	[0.002179562797704, 0.99553546889322, 0.002284968309075],
	[0.004797239683773, 0.024532016634589, 0.970670743681638]
];

/**
 * Linear Apple Wide Gamut (D65) → ACES2065-1 (AP0, D60), Bradford. Apple Log 2 is Apple Log's transfer function with
 * Apple Wide Gamut primaries, published in Apple's "Apple Log 2 Profile" white paper (September 2025):
 *   R (0.725, 0.301) · G (0.221, 0.814) · B (0.068, −0.076) · W D65 (0.3127, 0.3290).
 * Source used here: OpenColorIO's reference implementation, `src/OpenColorIO/transforms/builtins/AppleCameras.cpp`
 * on main (builtin `APPLE_LOG-APPLEWG_to_ACES2065-1`, AcademySoftwareFoundation/OpenColorIO PR #2343, merged
 * 2026-09-15 for OCIO 2.6.0), which states those primaries "from the Apple Log 2 white paper" and derives the
 * matrix with Bradford adaptation; the matrix below is that derivation, and it equals the one published in
 * AcademySoftwareFoundation/OpenColorIO-Config-ACES issue #163 (row 1: 0.694961049318096, 0.241405268785364,
 * 0.06363368189654). The curve is OCIO's own `CURVE - APPLE_LOG_to_LINEAR` (the same in Apple Log and Apple Log 2).
 */
export const AWG_TO_AP0 = [
	[0.694961049318096, 0.241405268785364, 0.06363368189654],
	[0.047362746414932, 1.004295925054283, -0.051658671469216],
	[-0.021989789359883, -0.028989104971474, 1.050978894331358]
];

// ── HDR signals as scene light ───────────────────────────────────────────────────────────────────────────────────
// HLG and PQ are brought in as scene-linear light with 18% grey where ITU-R BT.2408 puts it (HLG 38% signal; PQ
// 26 cd/m²), so an HDR clip meters like a camera clip on the timeline. Pure maths, reversible, no tone mapping.

const HLG_A = 0.17883277, HLG_B = 1 - 4 * 0.17883277, HLG_C = 0.5 - 0.17883277 * Math.log(4 * 0.17883277);
/** HLG signal (0…1) → scene light E (0…1), ITU-R BT.2100 inverse OETF. */
export const hlgToScene = (/** @type {number} */ v) => (v <= 0.5 ? (v * v) / 3 : (Math.exp((v - HLG_C) / HLG_A) + HLG_B) / 12);
/** HLG scene light → linear with 18% grey at BT.2408's 38% signal. */
export const HLG_SCALE = 0.18 / hlgToScene(0.38);

const PQ_M1 = 2610 / 16384, PQ_M2 = (2523 / 4096) * 128, PQ_C1 = 3424 / 4096, PQ_C2 = (2413 / 4096) * 32, PQ_C3 = (2392 / 4096) * 32;
/** PQ signal (0…1) → cd/m², SMPTE ST 2084 EOTF. */
export const pqToNits = (/** @type {number} */ v) => {
	const p = Math.pow(Math.max(0, v), 1 / PQ_M2);
	return 10000 * Math.pow(Math.max(0, p - PQ_C1) / (PQ_C2 - PQ_C3 * p), 1 / PQ_M1);
};
/** cd/m² → PQ signal, SMPTE ST 2084 inverse EOTF. */
export const nitsToPq = (/** @type {number} */ n) => {
	const y = Math.pow(Math.max(0, n) / 10000, PQ_M1);
	return Math.pow((PQ_C1 + PQ_C2 * y) / (1 + PQ_C3 * y), PQ_M2);
};
/** PQ cd/m² → linear with 18% grey at BT.2408's 26 cd/m². */
export const PQ_SCALE = 0.18 / 26;

// ── the configs ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {number[][]} Matrix3
 * @typedef {{ kind: 'identity' }} IdentityConfig
 * @typedef {{ kind: 'ocio-view', config: string, colorspace: string, display: string, view: string, direction: 'forward' | 'inverse' }} ViewConfig
 *   OCIO display/view: forward takes `colorspace` to the display; inverse takes display code values back into it.
 * @typedef {{ kind: 'ocio-convert', config: string, src: string, dst: string }} ConvertConfig
 * @typedef {{ kind: 'ocio-group', config: string, steps: ({ builtin: string } | { matrix: Matrix3 } | { convert: [string, string] })[], source: string }} GroupConfig
 *   A chain of OCIO pieces (a builtin curve, a matrix, a colour-space conversion), for a transform the config lacks.
 * @typedef {{ kind: 'math', decode: 'linear' | 'hlg' | 'pq', scale: number, matrix: Matrix3 | null, to: 'acescct' }} MathConfig
 *   Exact maths: the signal decoded to linear light (× scale), a 3×3 into AP1, then the ACEScct curve. No LUT
 *   over the whole cube, so nothing clips: linear sources keep every highlight.
 * @typedef {{ kind: 'cdl', cdl: import('./color.js').Cdl }} CdlConfig
 *   An ASC CDL in ACEScct: the maths of cdl() in color.js.
 * @typedef {{ kind: 'chain', steps: (ViewConfig | ConvertConfig | GroupConfig | CdlConfig)[] }} ChainConfig
 *   Several transforms one after the other, baked into one LUT at render time (a graded display-referred clip:
 *   inverse output transform → its grade → the film's look → output transform, display in, display out).
 * @typedef {IdentityConfig | ViewConfig | ConvertConfig | GroupConfig | MathConfig | CdlConfig | ChainConfig} TransformConfig
 */

/**
 * @typedef {'idt-acescct' | 'odt-rec709' | 'idt-rec709' | 'idt-apple-log' | 'idt-apple-log-2' | 'idt-aces2065-1' | 'idt-acescg'
 *   | 'idt-linear-rec709' | 'idt-hlg' | 'idt-pq'} TransformName
 */

/**
 * Every transform the pipeline knows, by name. Input transforms (idt-*) end in ACEScct; the output transform starts there.
 * @type {Record<TransformName, TransformConfig>}
 */
export const TRANSFORMS = {
	'idt-acescct': { kind: 'identity' },
	// the output transform: the timeline (ACEScct) to what every delivery shows
	'odt-rec709': { kind: 'ocio-view', config: OCIO_CONFIG, colorspace: 'ACEScct', display: DISPLAY, view: VIEW, direction: 'forward' },
	// its inverse: a display-referred picture (Rec.709 video, sRGB stills, the old graded shots) into the timeline, so
	// that it comes out of the output transform as it went in (used only when such a clip is graded — ungraded, it
	// bypasses both transforms and renders bit for bit as before)
	'idt-rec709': { kind: 'ocio-view', config: OCIO_CONFIG, colorspace: 'ACEScct', display: DISPLAY, view: VIEW, direction: 'inverse' },
	'idt-apple-log': { kind: 'ocio-convert', config: OCIO_CONFIG, src: 'Apple Log', dst: 'ACEScct' },
	'idt-apple-log-2': {
		kind: 'ocio-group',
		config: OCIO_CONFIG,
		steps: [{ builtin: 'CURVE - APPLE_LOG_to_LINEAR' }, { matrix: AWG_TO_AP0 }, { convert: ['ACES2065-1', 'ACEScct'] }],
		source: 'OpenColorIO AppleCameras.cpp (APPLE_LOG-APPLEWG_to_ACES2065-1, PR #2343), from the Apple Log 2 white paper'
	},
	// generated and rendered footage: scene-linear EXR, by exact maths
	'idt-aces2065-1': { kind: 'math', decode: 'linear', scale: 1, matrix: AP0_TO_AP1, to: 'acescct' },
	'idt-acescg': { kind: 'math', decode: 'linear', scale: 1, matrix: null, to: 'acescct' },
	'idt-linear-rec709': { kind: 'math', decode: 'linear', scale: 1, matrix: REC709_TO_AP1, to: 'acescct' },
	// HDR video (BT.2100: Rec.2020 primaries)
	'idt-hlg': { kind: 'math', decode: 'hlg', scale: HLG_SCALE, matrix: REC2020_TO_AP1, to: 'acescct' },
	'idt-pq': { kind: 'math', decode: 'pq', scale: PQ_SCALE, matrix: REC2020_TO_AP1, to: 'acescct' }
};

/** The output transform every delivery goes through today. */
export const ODT_NAME = 'odt-rec709';

/**
 * A graded display-referred clip as one transform: into ACEScct by the inverse output transform, its own grade, the
 * film's look, and out again — baked into a single display → display LUT at render time. Two separate 65³ LUTs lose
 * up to ~25 code values on saturated colours (the ACES 2.0 output transform is steep there); the composite, being
 * near the identity for a mild grade, stays within a code value or two of OCIO.
 * @param {import('./color.js').Cdl | null | undefined} grade @param {import('./color.js').Cdl | null | undefined} look
 * @returns {ChainConfig}
 */
export function displayChain(grade, look) {
	/** @type {ChainConfig['steps']} */
	const steps = [/** @type {ViewConfig} */ (TRANSFORMS['idt-rec709'])];
	for (const g of [grade, look]) if (g) steps.push({ kind: 'cdl', cdl: g });
	steps.push(/** @type {ViewConfig} */ (TRANSFORMS[ODT_NAME]));
	return { kind: 'chain', steps };
}

/**
 * The transforms the studio's viewer needs as preview LUTs: the output transform, and the input transform of every
 * profile a *proxy* can be in that is not ACEScct already (display-referred proxies when graded, camera log).
 * Linear and HDR sources never need one: their proxies are ACEScct (maths at proxy time).
 * @type {TransformName[]}
 */
export const PREVIEW = ['odt-rec709', 'idt-rec709', 'idt-apple-log', 'idt-apple-log-2'];

/** The size a transform is baked at: 65³ for 3D LUTs (99% of realistic colours within ~2 10-bit code values of OCIO). */
export const LUT_SIZE = 65;

// ── hashing: a transform is pinned by the hash of its config ─────────────────────────────────────────────────────

/** JSON with its keys sorted, so the same config always gives the same text. */
export function canonical(/** @type {unknown} */ v) {
	/** @type {(x: unknown) => unknown} */
	const sort = (x) =>
		Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(/** @type {Record<string, unknown>} */ (x)[k])])) : x;
	return JSON.stringify(sort(v));
}

const K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/** SHA-256 of a string (UTF-8), as hex — synchronous and the same in the browser, Bun and Node. */
export function sha256(/** @type {string} */ text) {
	const msg = new TextEncoder().encode(text);
	const len = ((msg.length + 9 + 63) >> 6) << 6;
	const buf = new Uint8Array(len);
	buf.set(msg);
	buf[msg.length] = 0x80;
	const view = new DataView(buf.buffer);
	view.setUint32(len - 4, msg.length * 8);
	view.setUint32(len - 8, Math.floor((msg.length * 8) / 2 ** 32));
	const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
	const w = new Uint32Array(64);
	const rot = (/** @type {number} */ x, /** @type {number} */ n) => (x >>> n) | (x << (32 - n));
	for (let o = 0; o < len; o += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4);
		for (let i = 16; i < 64; i++) {
			const a = w[i - 15], b = w[i - 2];
			w[i] = w[i - 16] + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + w[i - 7] + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10));
		}
		let [a, b, c, d, e, f, g, hh] = h;
		for (let i = 0; i < 64; i++) {
			const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
			const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
			(hh = g), (g = f), (f = e), (e = (d + t1) >>> 0), (d = c), (c = b), (b = a), (a = (t1 + t2) >>> 0);
		}
		h[0] += a, h[1] += b, h[2] += c, h[3] += d, h[4] += e, h[5] += f, h[6] += g, h[7] += hh;
	}
	return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** A config's hash: 16 hex digits of SHA-256 over its canonical JSON. Anything that changes the numbers belongs in it. */
export const hashOf = (/** @type {unknown} */ config) => sha256(canonical(config)).slice(0, 16);

// ── the ACEScct shaper the worker uses for exact linear → ACEScct in ffmpeg ─────────────────────────────────────
// ffmpeg has no log filter for float pictures, so linear light is carried into a 1D LUT's domain through PQ: the
// worker offsets it by SHAPER.offset (so small negatives from a gamut change survive), encodes it with zscale's exact
// ST 2084 maths at SHAPER.npl, and a 65536-entry 1D LUT takes that PQ signal to ACEScct. Measured within a small
// fraction of a 10-bit code value of the curve (api/test/film-color.test.ts).
export const SHAPER = { offset: 1 / 128, npl: 10, size: 65536, version: 1 };

/** The shaper's 1D LUT entry: PQ signal (as zscale writes it for linear·(1+offset)⁻¹…) → ACEScct. */
export function shaperToCct(/** @type {number} */ u) {
	// zscale: linear 1.0 = npl cd/m²; the offset step (ffmpeg `exposure` with black = −offset) wrote (x + o) / (1 + o)
	const s = pqToNits(u) / SHAPER.npl;
	return toCct(s * (1 + SHAPER.offset) - SHAPER.offset);
}

// ── preview LUTs for the studio: the file format ─────────────────────────────────────────────────────────────────
/*
 * A preview LUT in the library (tag role:lut, meta { transform, hash, size, format: 'mlut1' }) is
 *   gzip( 'MLUT1' · uint32 LE header length · header (UTF-8 JSON: { name, hash, size, min, max, config, ocio }) ·
 *         size³ × RGB as uint16 LE, red changing fastest, then green, then blue )
 * each value being min + (max − min) · u / 65535. The studio gunzips it (DecompressionStream('gzip')), passes the
 * bytes to parseLut(), and loads `data` (RGBA float, size³ texels) into a THREE.Data3DTexture (RGBAFormat,
 * FloatType, linear filtering); its shader samples it at (x·(size−1) + 0.5) / size per channel.
 */

/**
 * @param {Uint8Array} bytes the gunzipped file
 * @returns {{ header: { name: string, hash: string, size: number, min: number, max: number }, size: number, data: Float32Array }}
 */
export function parseLut(bytes) {
	const magic = new TextDecoder().decode(bytes.subarray(0, 5));
	if (magic !== 'MLUT1') throw new Error('not a preview LUT (MLUT1)');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const n = view.getUint32(5, true);
	const header = JSON.parse(new TextDecoder().decode(bytes.subarray(9, 9 + n)));
	const size = Number(header.size), count = size * size * size, at = 9 + n;
	const data = new Float32Array(count * 4);
	const k = (header.max - header.min) / 65535;
	for (let i = 0; i < count; i++) {
		for (let c = 0; c < 3; c++) data[i * 4 + c] = header.min + k * view.getUint16(at + (i * 3 + c) * 2, true);
		data[i * 4 + 3] = 1;
	}
	return { header, size, data };
}
