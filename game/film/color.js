// THE FILM'S COLOUR STANDARD — one working space for every picture, from the moment it comes in to the moment it goes
// out: ACEScct (ACES AP1 primaries, the ACEScct log curve), processed in float. Every source is brought into it by its
// input transform (IDT), graded in it, and taken out by one output transform (ODT) to what every delivery shows:
// Rec.709, BT.1886 gamma 2.4, SDR (ACES 2.0 output transform). The transforms are configs (game/film/transforms.js):
// OpenColorIO's ACES 2.0 studio config, or exact maths. LUTs are made from them only while rendering (the worker,
// scripts/film/color/bake.py), never committed; media stays in its own encoding for ever.
//
// Shared by the render worker (Bun), the film scripts (Node), Sandbox 4's film camera and the studio (browser).

/** Linear light with Rec.709 primaries (D65) — what the world renders — to ACES AP1 (D60), from OCIO's own conversion. */
export const REC709_TO_AP1 = [
	[0.6130974, 0.33952314, 0.047379453],
	[0.07019372, 0.9163539, 0.013452399],
	[0.020615593, 0.10956977, 0.86981463]
];

// ── the ACEScct curve (S-2016-001) ─────────────────────────────────────────────────────────────────────────────────
const X_BRK = 0.0078125;
const Y_BRK = 0.155251141552511;
const A = 10.5402377416545;
const B = 0.0729055341958355;

/** Linear AP1 → ACEScct. */
export const toCct = (/** @type {number} */ lin) => (lin <= X_BRK ? A * lin + B : (Math.log2(lin) + 9.72) / 17.52);
/** ACEScct → linear AP1. */
export const fromCct = (/** @type {number} */ cct) =>
	cct <= Y_BRK ? (cct - B) / A : cct < (Math.log2(65504) + 9.72) / 17.52 ? Math.pow(2, cct * 17.52 - 9.72) : 65504;

/** ACEScct of 18% grey: where a correctly exposed mid-tone lands on the timeline. */
export const MID_GREY_CCT = toCct(0.18);

/**
 * The colour profiles a picture can carry (media meta.color.profile), and how each comes into the timeline:
 *   `idt` — the input transform that takes it into ACEScct (a name in transforms.js); null: it already is ACEScct.
 *   `display` — display-referred: its code values are what a Rec.709 screen shows. Such a picture, left ungraded,
 *               goes straight through to the output (no transform either way), so it renders exactly as it always did.
 *   `log` — a log encoding (camera log, ACEScct); `linear` — scene-linear light (EXR, float).
 *   `proxy` — what its HD proxy is encoded in: log stays its own log, linear and HDR become ACEScct (exact maths),
 *             display stays display. A proxy never carries a grade or an output transform.
 * A file whose profile cannot be told is 'unknown' (not a key here): the studio asks; the worker renders it as
 * Rec.709 and says so in the render's report.
 */
export const PROFILES = {
	acescct: { label: 'ACEScct (log)', idt: null, display: false, log: true, linear: false, proxy: 'acescct' },
	rec709: { label: 'Rec.709 video', idt: 'idt-rec709', display: true, log: false, linear: false, proxy: 'rec709' },
	srgb: { label: 'sRGB (stills, web)', idt: 'idt-rec709', display: true, log: false, linear: false, proxy: 'srgb' },
	legacy: { label: 'Graded before (display)', idt: 'idt-rec709', display: true, log: false, linear: false, proxy: 'legacy' },
	hlg: { label: 'HDR · HLG', idt: 'idt-hlg', display: false, log: false, linear: false, proxy: 'acescct' },
	pq: { label: 'HDR · PQ', idt: 'idt-pq', display: false, log: false, linear: false, proxy: 'acescct' },
	'apple-log': { label: 'Apple Log', idt: 'idt-apple-log', display: false, log: true, linear: false, proxy: 'apple-log' },
	'apple-log-2': { label: 'Apple Log 2', idt: 'idt-apple-log-2', display: false, log: true, linear: false, proxy: 'apple-log-2' },
	'aces2065-1': { label: 'ACES2065-1 (linear AP0)', idt: 'idt-aces2065-1', display: false, log: false, linear: true, proxy: 'acescct' },
	acescg: { label: 'ACEScg (linear AP1)', idt: 'idt-acescg', display: false, log: false, linear: true, proxy: 'acescct' },
	'linear-rec709': { label: 'Linear Rec.709', idt: 'idt-linear-rec709', display: false, log: false, linear: true, proxy: 'acescct' }
};

/** @typedef {keyof typeof PROFILES} Profile */
/**
 * @typedef {{ profile: Profile | 'unknown', primaries: string, transfer: string, matrix: string, range: string, bitDepth: number,
 *   detectedFrom: string, override?: Profile }} ColorInfo
 */

/** The output transform every delivery is taken through. */
export const ODT = 'odt-rec709';

/** EXR chromaticities (x, y of red, green, blue, white) of the linear spaces generated footage comes in. */
const EXR_PRIMARIES = /** @type {[Profile, number[]][]} */ ([
	['aces2065-1', [0.7347, 0.2653, 0.0, 1.0, 0.0001, -0.077, 0.32168, 0.33767]],
	['acescg', [0.713, 0.293, 0.165, 0.83, 0.128, 0.044, 0.32168, 0.33767]],
	['linear-rec709', [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329]]
]);

/** @typedef {{ chromaticities?: number[], aces?: boolean, channels?: string[] }} ExrHeader */

/**
 * What an OpenEXR file's header says about its colour: its chromaticities and whether it is an ACES container
 * (acesImageContainerFlag). Reads only the header — the first 64 KB of the file are plenty.
 * @param {Uint8Array} bytes
 * @returns {ExrHeader | null}
 */
export function exrHeader(bytes) {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 8 || v.getUint32(0, true) !== 20000630) return null;
	/** @type {ExrHeader} */
	const out = {};
	/** @returns {[string, number]} the zero-terminated string at `at`, and where the next field starts */
	const str = (/** @type {number} */ at) => {
		let end = at;
		while (end < bytes.length && bytes[end] !== 0) end++;
		return [new TextDecoder().decode(bytes.subarray(at, end)), end + 1];
	};
	let at = 8;
	while (at < bytes.length) {
		const [name, a1] = str(at);
		if (!name) break;
		const [type, a2] = str(a1);
		if (a2 + 4 > bytes.length) break;
		const size = v.getUint32(a2, true), data = a2 + 4;
		if (data + size > bytes.length) break;
		if (name === 'chromaticities' && type === 'chromaticities') out.chromaticities = [...Array(8)].map((_, i) => v.getFloat32(data + i * 4, true));
		if (name === 'acesImageContainerFlag') out.aces = v.getInt32(data, true) === 1;
		if (name === 'channels' && type === 'chlist') {
			/** @type {string[]} */
			const names = [];
			let p = data;
			while (p < data + size && bytes[p] !== 0) {
				const [n, q] = str(p);
				names.push(n);
				p = q + 16;
			}
			out.channels = names;
		}
		at = data + size;
	}
	return out;
}

/**
 * The linear profile an EXR header names: an ACES container is ACES2065-1; otherwise by its chromaticities, and with
 * none, Rec.709 primaries (as the OpenEXR specification defines a file without them). Other primaries: null.
 * @param {ExrHeader | null} h @returns {Profile | null}
 */
export function exrProfile(h) {
	if (!h) return null;
	if (h.aces) return 'aces2065-1';
	const c = h.chromaticities;
	if (!c) return 'linear-rec709';
	const hit = EXR_PRIMARIES.find(([, p]) => p.every((x, i) => Math.abs(x - c[i]) < 0.002));
	return hit ? hit[0] : null;
}

/**
 * What a file is, from ffprobe's first video stream and the container's tags (`ffprobe -show_streams -show_format`).
 * Our own files say so in their comment tag ("maiacity:color=acescct"); cameras in their colour tags and Apple's
 * QuickTime metadata; an EXR in its header (`extra.exr`, from exrHeader()); an EXR sequence was given its profile
 * when it was packed (`extra.sequence`, the tar's meta). Anything that cannot be told is "unknown" — the studio asks
 * instead of guessing.
 * @param {{ codec_name?: string, pix_fmt?: string, color_primaries?: string, color_transfer?: string, color_space?: string, color_range?: string, bits_per_raw_sample?: string, tags?: Record<string, string> }} stream
 * @param {{ tags?: Record<string, string> }} [format]
 * @param {string} [kind] 'video' | 'image'
 * @param {{ exr?: ExrHeader | null, sequence?: { color?: { profile?: string } } | null }} [extra]
 * @returns {ColorInfo}
 */
export function detect(stream, format = {}, kind = 'video', extra = {}) {
	const tags = { ...(format.tags ?? {}), ...(stream.tags ?? {}) };
	const lower = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), String(v)]));
	const all = [...Object.keys(lower), ...Object.values(lower)].join(' ').toLowerCase();
	const primaries = stream.color_primaries ?? 'unknown', transfer = stream.color_transfer ?? 'unknown';
	const pix = stream.pix_fmt ?? '';
	const float = /f(16|32)/.test(pix) || stream.codec_name === 'exr';
	const rgb = float || /^(rgb|bgr|gbr|argb|abgr|rgba|bgra|gray|ya)/.test(pix);
	const matrix = stream.color_space ?? (rgb ? 'gbr' : 'unknown');
	const range = stream.color_range ?? (pix.startsWith('yuvj') || rgb ? 'pc' : 'unknown');
	const depth = /(\d+)(le|be)$/.exec(pix)?.[1];
	const bitDepth = float ? (/f16/.test(pix) ? 16 : 32) : Number(stream.bits_per_raw_sample) || (depth && Number(depth) > 8 && Number(depth) <= 16 ? Number(depth) : 8);
	const info = (/** @type {Profile | 'unknown'} */ profile, /** @type {string} */ from) => ({ profile, primaries, transfer, matrix, range, bitDepth, detectedFrom: from });
	const ours = /maiacity:color=([a-z0-9-]+)/.exec(all)?.[1];
	if (ours && ours in PROFILES) return info(/** @type {Profile} */ (ours), 'our own tag');
	const given = extra.sequence?.color?.profile;
	if (given && given in PROFILES) return info(/** @type {Profile} */ (given), 'given when the sequence was packed');
	// Apple's camera log: the iPhone writes its log profile into the QuickTime metadata
	if (/apple\s*log\s*2|applelog2/.test(all)) return info('apple-log-2', 'Apple metadata (Apple Log 2)');
	if (/apple\s*log|applelog/.test(all)) return info('apple-log', 'Apple metadata (Apple Log)');
	// scene-linear float: an EXR's header names its primaries
	if (float || transfer === 'linear') {
		const p = exrProfile(extra.exr ?? null);
		if (p) return info(p, extra.exr?.aces ? 'EXR header (ACES container)' : extra.exr?.chromaticities ? 'EXR header (chromaticities)' : 'EXR header (no chromaticities: Rec.709)');
		if (primaries === 'bt709') return info('linear-rec709', 'colour tags (linear Rec.709)');
		return info('unknown', 'linear light of unknown primaries');
	}
	if (transfer === 'arib-std-b67') return info('hlg', 'transfer tag (HLG)');
	if (transfer === 'smpte2084') return info('pq', 'transfer tag (PQ)');
	// an iPhone's log file without a profile we can read: which log it is must be said, not guessed
	if (/apple/.test(all) && primaries === 'bt2020' && transfer === 'unknown')
		return info('unknown', 'Apple camera, BT.2020 without a transfer tag: Apple Log or Apple Log 2 — set it by hand');
	if (kind === 'image') return info('srgb', 'a still image');
	if (['bt709', 'smpte170m', 'bt470bg', 'iec61966-2-1', 'gamma22'].includes(transfer) || ['bt709', 'smpte170m', 'bt470bg'].includes(primaries)) return info('rec709', 'colour tags (Rec.709)');
	if (bitDepth <= 8 && transfer === 'unknown' && primaries === 'unknown') return info('rec709', 'untagged 8-bit video: Rec.709');
	return info('unknown', 'nothing to tell it by');
}

/** The profile a file's proxy is encoded in (revised rule 2); an unknown file's proxy stays as the file is. */
export const proxyProfileOf = (/** @type {Profile | 'unknown'} */ p) => (p === 'unknown' ? 'unknown' : PROFILES[p].proxy);

/** The profile a file is treated as: the one set by hand in the studio, else the detected one. */
export const profileOf = (/** @type {Partial<ColorInfo> | undefined} */ c) => /** @type {Profile | 'unknown'} */ (c?.override ?? c?.profile ?? 'unknown');

// ── the grade: ASC CDL in ACEScct ──────────────────────────────────────────────────────────────────────────────────

/** @typedef {{ slope: [number, number, number], offset: [number, number, number], power: [number, number, number], sat: number }} Cdl */

/** @type {Cdl} */
export const NEUTRAL = { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 1 };

/** A grade that changes nothing. */
export const isNeutral = (/** @type {Cdl | null | undefined} */ g) =>
	!g || (g.sat === 1 && [0, 1, 2].every((i) => g.slope[i] === 1 && g.offset[i] === 0 && g.power[i] === 1));

/** Rec.709 luma weights, as the ASC CDL takes its saturation around. */
const LUMA = [0.2126, 0.7152, 0.0722];

/**
 * The ASC CDL on one ACEScct pixel: slope, offset, power per channel (negative values are held at 0 before the
 * power, as ACEScct grading does; nothing is clipped at 1 — the log holds highlights above it), then saturation.
 * @param {Cdl} g @param {[number, number, number]} rgb @returns {[number, number, number]}
 */
export function cdl(g, rgb) {
	const v = /** @type {[number, number, number]} */ (rgb.map((x, i) => {
		const y = x * g.slope[i] + g.offset[i];
		return g.power[i] === 1 ? y : Math.pow(Math.max(0, y), g.power[i]);
	}));
	const l = v[0] * LUMA[0] + v[1] * LUMA[1] + v[2] * LUMA[2];
	return /** @type {[number, number, number]} */ (v.map((x) => l + g.sat * (x - l)));
}

/** Two grades one after the other (a clip's own, then the film's look), as one — exact for slope/offset without power. */
export function chain(/** @type {Cdl[]} */ ...grades) {
	return grades.filter((g) => !isNeutral(g));
}

/** The 3×3 the CDL's saturation is, for ffmpeg's colorchannelmixer (rr rg rb gr gg gb br bg bb). */
export function satMatrix(/** @type {number} */ s) {
	return [0, 1, 2].map((r) => [0, 1, 2].map((c) => (r === c ? s : 0) + (1 - s) * LUMA[c])).flat();
}

/**
 * The looks the films were cut with before the pipeline had a grade step — the ffmpeg `eq`/`colorbalance` looks of
 * day-19-d.mjs (COLD, DIP, BRIGHT, NIGHT) — as CDLs in ACEScct, the grade presets of the Grade tab.
 * @type {Record<string, { label: string, cdl: Cdl }>}
 */
export const PRESETS = {
	neutral: { label: 'Neutral', cdl: NEUTRAL },
	cold: { label: 'Cold (the world as it was)', cdl: { slope: [0.97, 0.99, 1.05], offset: [-0.004, 0, 0.012], power: [1, 1, 1], sat: 0.5 } },
	dip: { label: 'Dip (sick, heavy)', cdl: { slope: [0.94, 1.0, 1.0], offset: [-0.012, 0.004, 0.006], power: [1.06, 1.04, 1.04], sat: 0.55 } },
	bright: { label: 'Bright (the city by day)', cdl: { slope: [1.02, 1.02, 1.0], offset: [0.004, 0.004, 0], power: [1, 1, 1], sat: 1.14 } },
	night: { label: 'Night (blue, lifted)', cdl: { slope: [0.98, 1.0, 1.06], offset: [0.01, 0.012, 0.024], power: [0.96, 0.96, 0.94], sat: 1.08 } },
	warm: { label: 'Warm (golden hour)', cdl: { slope: [1.05, 1.0, 0.93], offset: [0.006, 0.002, -0.004], power: [1, 1, 1], sat: 1.06 } }
};

/** A grade as data, checked: anything missing is neutral, every number finite and in a sane range. */
export function cleanCdl(/** @type {any} */ g) {
	if (!g || typeof g !== 'object') return null;
	const trio = (/** @type {any} */ v, /** @type {number} */ d, /** @type {number} */ lo, /** @type {number} */ hi) =>
		/** @type {[number, number, number]} */ ([0, 1, 2].map((i) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v?.[i])) ? Number(v[i]) : d))));
	/** @type {Cdl} */
	const out = { slope: trio(g.slope, 1, 0, 4), offset: trio(g.offset, 0, -1, 1), power: trio(g.power, 1, 0.1, 4), sat: Math.min(4, Math.max(0, Number.isFinite(Number(g.sat)) ? Number(g.sat) : 1)) };
	return isNeutral(out) ? null : out;
}
