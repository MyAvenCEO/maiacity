// THE FILM'S COLOUR STANDARD — one working space for every picture, from the moment it comes in to the moment it goes
// out: ACEScct (ACES AP1 primaries, the ACEScct log curve), processed in float. Every source is brought into it by its
// input transform (IDT), graded in it, and taken out by one output transform (ODT) to what every delivery shows:
// Rec.709, BT.1886 gamma 2.4, SDR (ACES 2.0 output transform). The transforms that are not plain maths are baked into
// LUTs from OpenColorIO's ACES 2.0 studio config (scripts/film/color/bake.py) and pinned by CID (transforms.json).
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
 *   `idt` — the LUT that takes it into ACEScct (static/film/luts/<idt>.lut); null: it already is ACEScct.
 *   `display` — display-referred: its code values are what a Rec.709 screen shows. Such a picture, left ungraded,
 *               goes straight through to the output (no LUT either way), so it renders exactly as it always did.
 */
export const PROFILES = {
	acescct: { label: 'ACEScct (log)', idt: null, display: false, log: true },
	rec709: { label: 'Rec.709 video', idt: 'idt-rec709', display: true, log: false },
	srgb: { label: 'sRGB (stills, web)', idt: 'idt-rec709', display: true, log: false },
	legacy: { label: 'Graded before (display)', idt: 'idt-rec709', display: true, log: false },
	hlg: { label: 'HDR · HLG', idt: 'idt-hlg', display: false, log: false },
	pq: { label: 'HDR · PQ', idt: 'idt-pq', display: false, log: false },
	'apple-log': { label: 'Apple Log', idt: 'idt-apple-log', display: false, log: true },
	'apple-log-2': { label: 'Apple Log 2', idt: 'idt-apple-log-2', display: false, log: true }
};

/** @typedef {keyof typeof PROFILES} Profile */
/** @typedef {{ profile: Profile | 'unknown', primaries: string, transfer: string, matrix: string, range: string, bitDepth: number, detectedFrom: string, override?: Profile }} ColorInfo */

/** The output transform every delivery is taken through. */
export const ODT = 'odt-rec709';

/**
 * What a file is, from ffprobe's first video stream and the container's tags (`ffprobe -show_streams -show_format`).
 * Our own log files say so in their comment tag ("maiacity:color=acescct"); cameras say so in their colour tags and
 * Apple's QuickTime metadata. Anything that cannot be told is "unknown" — the studio asks instead of guessing.
 * @param {{ codec_name?: string, pix_fmt?: string, color_primaries?: string, color_transfer?: string, color_space?: string, color_range?: string, bits_per_raw_sample?: string, tags?: Record<string, string> }} stream
 * @param {{ tags?: Record<string, string> }} [format]
 * @param {string} [kind] 'video' | 'image'
 * @returns {ColorInfo}
 */
export function detect(stream, format = {}, kind = 'video') {
	const tags = { ...(format.tags ?? {}), ...(stream.tags ?? {}) };
	const lower = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), String(v)]));
	const all = Object.values(lower).join(' ').toLowerCase();
	const primaries = stream.color_primaries ?? 'unknown', transfer = stream.color_transfer ?? 'unknown';
	const matrix = stream.color_space ?? 'unknown', range = stream.color_range ?? 'unknown';
	const bitDepth = Number(stream.bits_per_raw_sample) || (/(10|12)(le|be)?$/.test(stream.pix_fmt ?? '') ? Number(/(10|12)/.exec(stream.pix_fmt ?? '')?.[1]) : 8);
	const info = (/** @type {Profile | 'unknown'} */ profile, /** @type {string} */ from) => ({ profile, primaries, transfer, matrix, range, bitDepth, detectedFrom: from });
	const ours = /maiacity:color=([a-z0-9-]+)/.exec(all)?.[1];
	if (ours && ours in PROFILES) return info(/** @type {Profile} */ (ours), 'our own tag');
	// Apple's camera log: the iPhone writes its log profile into the QuickTime metadata
	if (/apple\s*log\s*2|applelog2/.test(all)) return info('apple-log-2', 'Apple metadata (Apple Log 2)');
	if (/apple\s*log|applelog/.test(all)) return info('apple-log', 'Apple metadata (Apple Log)');
	if (transfer === 'arib-std-b67') return info('hlg', 'transfer tag (HLG)');
	if (transfer === 'smpte2084') return info('pq', 'transfer tag (PQ)');
	if (kind === 'image') return info('srgb', 'a still image');
	if (['bt709', 'smpte170m', 'bt470bg', 'iec61966-2-1', 'gamma22'].includes(transfer) || ['bt709', 'smpte170m', 'bt470bg'].includes(primaries)) return info('rec709', 'colour tags (Rec.709)');
	if (bitDepth <= 8 && transfer === 'unknown' && primaries === 'unknown') return info('rec709', 'untagged 8-bit video: Rec.709');
	return info('unknown', 'nothing to tell it by');
}

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
