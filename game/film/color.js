// THE FILM'S COLOUR STANDARD — one working space for every picture, from the moment it comes in to the moment it goes
// out: ACEScct (ACES AP1 primaries, the ACEScct log curve), processed in float. Every source is brought into it by its
// input transform (IDT), graded in it, and taken out by one output transform (ODT) to what every delivery shows:
// Rec.709, BT.1886 gamma 2.4, SDR (ACES 2.0 output transform). The transforms are configs (game/film/transforms.js):
// OpenColorIO's ACES 2.0 studio config, or exact maths. LUTs are made from them only while rendering — natively on
// the Mac (vault-media's cst and aces2, the final render in vault-render) — never committed; media stays in its own
// encoding for ever.
//
// Shared by the film scripts (Node), Sandbox 4's film camera, the API and the studio. The grade itself (the CDL, the
// balance) is Rust's alone: vault-render `grade`.

/**
 * Linear light with Rec.709 primaries (D65) — what the world renders, and what Rec.709 video and sRGB pictures decode
 * to — to ACES AP1 (D60), Bradford, from OCIO's own conversion (cst.rs derives the same from the chromaticities).
 */
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
 *           Every picture goes the same way: input transform → its grade → the film's look → the output transform.
 *           Rec.709 video and sRGB are taken as what a camera saw (their curve undone), never as what a screen shows.
 *   `log` — a log encoding (camera log, ACEScct); `linear` — scene-linear light (EXR, float).
 * Every proxy is ACEScct (the Mac app makes it, and says so in its own meta.color). A file whose profile cannot be
 * told is 'unknown' (not a key here): the studio asks; the worker renders it as Rec.709 and says so in the render's
 * report.
 */
export const PROFILES = {
	acescct: { label: 'ACEScct (log)', idt: null, log: true, linear: false },
	rec709: { label: 'Rec.709 video', idt: 'idt-rec709', log: false, linear: false },
	srgb: { label: 'sRGB (stills, web)', idt: 'idt-srgb', log: false, linear: false },
	hlg: { label: 'HDR · HLG', idt: 'idt-hlg', log: false, linear: false },
	pq: { label: 'HDR · PQ', idt: 'idt-pq', log: false, linear: false },
	'apple-log': { label: 'Apple Log', idt: 'idt-apple-log', log: true, linear: false },
	'apple-log-2': { label: 'Apple Log 2', idt: 'idt-apple-log-2', log: true, linear: false },
	'aces2065-1': { label: 'ACES2065-1 (linear AP0)', idt: 'idt-aces2065-1', log: false, linear: true },
	acescg: { label: 'ACEScg (linear AP1)', idt: 'idt-acescg', log: false, linear: true },
	'linear-rec709': { label: 'Linear Rec.709', idt: 'idt-linear-rec709', log: false, linear: true }
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

/**
 * The profile a file is treated as: the one set by hand in the studio, else the detected one — each only when
 * PROFILES defines it (a profile recorded under an older table counts as none), else 'unknown'.
 * @param {{ override?: string, profile?: string } | undefined} c @returns {Profile | 'unknown'}
 */
export function profileOf(c) {
	const p = [c?.override, c?.profile].find((x) => typeof x === 'string' && x in PROFILES);
	return /** @type {Profile | undefined} */ (p) ?? 'unknown';
}

// ── the grade: ASC CDL in ACEScct ──────────────────────────────────────────────────────────────────────────────────

/** @typedef {{ slope: [number, number, number], offset: [number, number, number], power: [number, number, number], sat: number }} Cdl */

/** @type {Cdl} */
export const NEUTRAL = { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 1 };

/** A grade that changes nothing. */
export const isNeutral = (/** @type {Cdl | null | undefined} */ g) =>
	!g || (g.sat === 1 && [0, 1, 2].every((i) => g.slope[i] === 1 && g.offset[i] === 0 && g.power[i] === 1));

// The grade's maths — the CDL, the balance, the presets' values — live in Rust only (vault-render `grade`), run on the
// GPU by Metal (the render, hero frames) and baked by the Mac for the studio's viewer (`color_grade`: one cube per clip).
// Here are only the grade as data: its shape, its ranges, and how a saved grade is checked.

// ── the balance: the fixed first nodes of every shot, before any creative grade ─────────────────────────────────────
//
// White balance → exposure → contrast → highlights / lows → saturation, in ACEScct, per shot: the shots of a scene
// levelled to each other before the look is set (vault-render `grade::Balance`). Every amount is in stops (contrast and
// saturation: the factor minus 1), so an agent can reason in a colourist's units; 0 everywhere is the picture as shot.

/** @typedef {{ temp: number, tint: number, exposure: number, contrast: number, highlights: number, shadows: number, sat: number }} Balance */

/** @typedef {{ key: keyof Balance, label: string, min: number, max: number, step: number, unit: string }} BalanceField */
/**
 * The balance layers, in the order they apply, with their ranges (the studio's sliders, the API's clamp).
 * @type {{ id: string, label: string, fields: BalanceField[] }[]}
 */
export const BALANCE_NODES = ([
	{ id: 'wb', label: 'White balance', fields: [{ key: 'temp', label: 'Temperature', min: -2, max: 2, step: 0.01, unit: 'stops warm' }, { key: 'tint', label: 'Tint', min: -2, max: 2, step: 0.01, unit: 'stops magenta' }] },
	{ id: 'exposure', label: 'Exposure', fields: [{ key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.01, unit: 'stops' }] },
	{ id: 'contrast', label: 'Contrast', fields: [{ key: 'contrast', label: 'Contrast', min: -0.8, max: 1.5, step: 0.01, unit: '' }] },
	{ id: 'highlights', label: 'Highlights', fields: [{ key: 'highlights', label: 'Highlights', min: -3, max: 3, step: 0.01, unit: 'stops' }] },
	{ id: 'shadows', label: 'Lows', fields: [{ key: 'shadows', label: 'Lows', min: -3, max: 3, step: 0.01, unit: 'stops' }] },
	{ id: 'sat', label: 'Saturation', fields: [{ key: 'sat', label: 'Saturation', min: -1, max: 1, step: 0.01, unit: '(0 = as shot, 0.2 = 20 % more)' }] }
]);

/** @type {Balance} */
export const NEUTRAL_BALANCE = { temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, sat: 0 };
/** A balance that changes nothing. */
export const isNeutralBalance = (/** @type {Balance | null | undefined} */ b) => !b || Object.values(b).every((v) => v === 0);

/** A balance as data, checked: anything missing is 0, every number finite and in its node's range; null when neutral. */
export function cleanBalance(/** @type {any} */ b) {
	if (!b || typeof b !== 'object') return null;
	/** @type {Record<string, number>} */
	const out = {};
	for (const f of BALANCE_NODES.flatMap((n) => n.fields)) {
		const v = Number(b[f.key]);
		out[f.key] = Math.round(Math.min(f.max, Math.max(f.min, Number.isFinite(v) ? v : 0)) * 1000) / 1000;
	}
	const bal = /** @type {Balance} */ (/** @type {unknown} */ (out));
	return isNeutralBalance(bal) ? null : bal;
}

/** A grade as data, checked: anything missing is neutral, every number finite and in a sane range. */
export function cleanCdl(/** @type {any} */ g) {
	if (!g || typeof g !== 'object') return null;
	const trio = (/** @type {any} */ v, /** @type {number} */ d, /** @type {number} */ lo, /** @type {number} */ hi) =>
		/** @type {[number, number, number]} */ ([0, 1, 2].map((i) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v?.[i])) ? Number(v[i]) : d))));
	/** @type {Cdl} */
	const out = { slope: trio(g.slope, 1, 0, 4), offset: trio(g.offset, 0, -1, 1), power: trio(g.power, 1, 0.1, 4), sat: Math.min(4, Math.max(0, Number.isFinite(Number(g.sat)) ? Number(g.sat) : 1)) };
	return isNeutral(out) ? null : out;
}

// ── a look: the film's or a scene's, after every shot's own grade (vault-render `creative::Look`) ───────────────────

/**
 * @typedef {{ hue: number, amount: number }} Tone
 * @typedef {{ cdl?: Cdl | null, preset?: string | null, contrast: number, pivot: number, split?: { shadows: Tone, highlights: Tone, balance: number } | null, hue?: [number, number][], hue_sat?: [number, number][], hue_lum?: [number, number][], hi_sat?: number, sat: number, lut?: string | null, strength: number }} Look
 */

/** A look as data, checked as Rust checks it (`clean_look`): numbers in their ranges; null when it changes nothing. */
export function cleanLook(/** @type {any} */ v) {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const n = (/** @type {any} */ x, /** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ d) => {
		const k = Number(x);
		return Number.isFinite(k) ? Math.min(hi, Math.max(lo, k)) : d;
	};
	const deg = (/** @type {any} */ x) => ((n(x, -720, 720, 0) % 360) + 360) % 360;
	/** @type {Look} */
	const out = { contrast: n(v.contrast, -1, 1, 0), pivot: n(v.pivot, 0, 1, 0.4135884), sat: n(v.sat ?? 1, 0, 3, 1), strength: n(v.strength ?? 1, 0, 1, 1) };
	const cdl = v.cdl ? cleanCdl(v.cdl) : null;
	if (cdl) out.cdl = cdl;
	if (typeof v.preset === 'string' && v.preset && v.preset !== 'neutral') out.preset = v.preset.slice(0, 20);
	if (v.split && typeof v.split === 'object') {
		const tone = (/** @type {any} */ t) => ({ hue: deg(t?.hue), amount: n(t?.amount, 0, 1, 0) });
		const split = { shadows: tone(v.split.shadows), highlights: tone(v.split.highlights), balance: n(v.split.balance, -1, 1, 0) };
		if (split.shadows.amount || split.highlights.amount) out.split = split;
	}
	const points = (/** @type {any} */ ps, /** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ d) =>
		(Array.isArray(ps) ? ps : [])
			.slice(0, 16)
			.map((p) => /** @type {[number, number]} */ ([deg(p?.[0]), n(p?.[1], lo, hi, d)]))
			.sort((a, b) => a[0] - b[0]);
	const hue = points(v.hue, -90, 90, 0), hueSat = points(v.hue_sat, 0, 3, 1), hueLum = points(v.hue_lum, -2, 2, 0);
	if (hue.length) out.hue = hue;
	if (hueSat.length) out.hue_sat = hueSat;
	if (hueLum.length) out.hue_lum = hueLum;
	const hiSat = n(v.hi_sat ?? 1, 0, 2, 1);
	if (hiSat !== 1) out.hi_sat = hiSat;
	if (typeof v.lut === 'string' && /^[0-9a-f]{64}$/.test(v.lut)) out.lut = v.lut;
	const neutral =
		out.strength === 0 ||
		(!out.cdl && !out.preset && out.contrast === 0 && !out.split && hue.every((p) => p[1] === 0) && hueSat.every((p) => p[1] === 1) && hueLum.every((p) => p[1] === 0) && hiSat === 1 && out.sat === 1 && !out.lut);
	return neutral ? null : out;
}

// ── a shot's secondaries and the film's finishing (vault-render `creative::Secondary`, `creative::Finish`) ─────────

const num = (/** @type {any} */ x, /** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ d) => {
	const k = Number(x);
	return Number.isFinite(k) ? Math.min(hi, Math.max(lo, k)) : d;
};

/**
 * A shot's secondaries as data, checked as Rust checks them (`clean_secondaries`): at most 4; each its key (hue on the
 * vectorscope, chroma × 100, IRE) inside its window (0…1 from the top left, or on the face), with its own balance.
 * @returns {any[]}
 */
export function cleanSecondaries(/** @type {any} */ v) {
	if (!Array.isArray(v)) return [];
	return v
		.slice(0, 4)
		.map((s) => {
			if (!s || typeof s !== 'object') return null;
			const adjust = cleanBalance(s.adjust);
			if (!adjust) return null;
			/** @type {any} */
			const out = { adjust, mix: num(s.mix ?? 1, 0, 1, 1) };
			if (typeof s.name === 'string' && s.name) out.name = s.name.slice(0, 60);
			if (s.key && typeof s.key === 'object' && Array.isArray(s.key.hue)) {
				const deg = (/** @type {any} */ x) => ((num(x, -720, 720, 0) % 360) + 360) % 360;
				out.key = {
					hue: [deg(s.key.hue[0]), num(s.key.hue[1], 1, 360, 40)],
					sat: [num(s.key.sat?.[0] ?? 1, 0, 100, 1), num(s.key.sat?.[1] ?? 100, 0, 100, 100)],
					luma: [num(s.key.luma?.[0] ?? 0, 0, 100, 0), num(s.key.luma?.[1] ?? 100, 0, 100, 100)],
					soft: num(s.key.soft ?? 0.5, 0, 1, 0.5)
				};
			}
			if (s.window && typeof s.window === 'object') {
				const w = s.window;
				out.window = {
					shape: w.shape === 'rect' ? 'rect' : 'ellipse',
					x: num(w.x ?? 0.5, -1, 2, 0.5),
					y: num(w.y ?? 0.5, -1, 2, 0.5),
					w: num(w.w ?? 0.5, 0.01, 4, 0.5),
					h: num(w.h ?? 0.5, 0.01, 4, 0.5),
					angle: num(w.angle ?? 0, -360, 360, 0),
					feather: num(w.feather ?? 0.5, 0, 1, 0.5),
					invert: !!w.invert,
					...(w.track === 'face' ? { track: 'face' } : {})
				};
			}
			return out.mix > 0 ? out : null;
		})
		.filter(Boolean);
}

/** The film's finishing as data, checked as Rust checks it (`clean_finish`); null when it adds nothing. */
export function cleanFinish(/** @type {any} */ v) {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	/** @type {any} */
	const out = {};
	if (v.pop && num(v.pop.amount, -1, 1, 0)) out.pop = { amount: num(v.pop.amount, -1, 1, 0), radius: num(v.pop.radius ?? 18, 2, 80, 18) };
	for (const k of ['halation', 'bloom']) {
		const g = v[k];
		if (g && num(g.amount, 0, 1, 0)) out[k] = { amount: num(g.amount, 0, 1, 0), threshold: num(g.threshold ?? 0.55, 0.3, 1.2, 0.55), radius: num(g.radius ?? 14, 1, 120, 14) };
	}
	if (v.grain && num(v.grain.amount, 0, 1, 0)) out.grain = { amount: num(v.grain.amount, 0, 1, 0), size: num(v.grain.size ?? 1, 0.5, 4, 1), chroma: num(v.grain.chroma ?? 0, 0, 1, 0) };
	if (v.vignette && num(v.vignette.amount, 0, 1, 0))
		out.vignette = { amount: num(v.vignette.amount, 0, 1, 0), size: num(v.vignette.size ?? 0.9, 0.2, 2, 0.9), softness: num(v.vignette.softness ?? 0.5, 0, 1, 0.5), roundness: num(v.vignette.roundness ?? 0, 0, 1, 0) };
	return Object.keys(out).length ? out : null;
}
