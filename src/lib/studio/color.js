// The studio's side of the colour standard (contract C5): what each picture is, how the viewer brings it in, and the
// grades as data. The maths and the tables live in game/film/color.js (stream A) — imported, never copied.
import * as film from '../../../game/film/color.js';
import { PROFILES, profileOf, NEUTRAL, isNeutral, cleanCdl, PRESETS, cdl, ODT } from '../../../game/film/color.js';

export { PROFILES, profileOf, NEUTRAL, isNeutral, cleanCdl, PRESETS, cdl, ODT };

/**
 * The profile a file's HD proxy is encoded in (revised rule 2: log stays its own log, linear and HDR become ACEScct,
 * display stays display). color.js carries `proxyProfileOf` from stream A on; until then the same rule is read here.
 * @param {string} p @returns {string}
 */
export const proxyProfileOf = (p) => {
	const own = /** @type {{ proxyProfileOf?: (p: string) => string }} */ (/** @type {unknown} */ (film)).proxyProfileOf;
	if (own) return p in PROFILES || p === 'unknown' ? own(p) : p;
	return ['hlg', 'pq', 'aces2065-1', 'acescg', 'linear-rec709'].includes(p) ? 'acescct' : p;
};

/**
 * A moving picture, whatever its container: a video file, or an EXR sequence (a tar of frames, `meta.sequence: 'exr'`,
 * library kind 'other') — which plays in the studio only through its proxy.
 * @param {MediaItem | undefined} m
 */
export const isVideo = (m) => m?.kind === 'video' || (m?.kind === 'other' && m.meta?.sequence === 'exr');
/** Is it a sequence of frames (it plays only through its proxy)? @param {MediaItem | undefined} m */
export const isSequence = (m) => m?.meta?.sequence === 'exr';
/**
 * The library as the studio works with it: an EXR sequence is a moving picture (kind 'video' here; the library itself
 * keeps 'other'), so it goes on V1, shows its proxy and its colour like any video.
 * @param {MediaItem[]} media @returns {MediaItem[]}
 */
export const asStudio = (media) => media.map((m) => (m.kind !== 'video' && isVideo(m) ? { ...m, kind: 'video' } : m));

/** @typedef {import('$lib/auth/client').Cdl} Cdl */
/** @typedef {import('$lib/auth/client').ColorInfo} ColorInfo */
/** @typedef {import('$lib/auth/client').MediaItem} MediaItem */
/** @typedef {import('$lib/auth/client').Timeline} Timeline */
/** @typedef {import('$lib/auth/client').TimelineClip} TimelineClip */
/** @typedef {import('$lib/auth/client').RenderJob} RenderJob */
/** @typedef {{ label: string, idt: string | null, display: boolean, log: boolean }} ProfileInfo */
/** @typedef {'ready' | 'none' | 'queued' | 'rendering' | 'failed' | 'n/a'} ProxyState */

/**
 * Every profile a picture can carry, as the contract lists them. color.js names the ones its first version knows;
 * the rest (generated footage, contract C5 / revised rule 3) are labelled here until color.js carries them.
 * @type {Record<string, ProfileInfo>}
 */
const EXTRA = {
	'aces2065-1': { label: 'ACES2065-1 (linear AP0)', idt: null, display: false, log: false },
	acescg: { label: 'ACEScg (linear AP1)', idt: null, display: false, log: false },
	'linear-rec709': { label: 'Linear Rec.709', idt: null, display: false, log: false },
	unknown: { label: 'Unknown — say what it is', idt: null, display: false, log: false }
};
/** @param {string} p @returns {ProfileInfo} */
export const profileInfo = (p) =>
	/** @type {Record<string, ProfileInfo>} */ (PROFILES)[p] ?? EXTRA[p] ?? { label: p, idt: null, display: false, log: false };
/** The choices of the override menu, in the order a colourist thinks of them. */
export const PROFILE_CHOICES = [...new Set([...Object.keys(PROFILES), ...Object.keys(EXTRA)])];

/** The few letters a badge shows. @type {Record<string, string>} */
const SHORT = {
	acescct: 'CCT',
	rec709: '709',
	srgb: 'sRGB',
	legacy: 'Legacy',
	hlg: 'HLG',
	pq: 'PQ',
	'apple-log': 'A-Log',
	'apple-log-2': 'A-Log2',
	'aces2065-1': 'AP0',
	acescg: 'ACEScg',
	'linear-rec709': 'Lin709',
	unknown: '?'
};
/** @param {string} p */
export const short = (p) => SHORT[p] ?? p;

/**
 * What the ingest found out about a file's colour (meta.color), if anything.
 * @param {MediaItem | undefined} m @returns {ColorInfo | undefined}
 */
export const colorOf = (m) => {
	const c = m?.meta?.color;
	return c && typeof c === 'object' ? /** @type {ColorInfo} */ (c) : undefined;
};
/**
 * The profile a file is treated as: set by hand, else detected, else — for files from before detection — a guess by
 * kind, marked as such.
 * @param {MediaItem | undefined} m @returns {{ profile: string, guessed: boolean, override: boolean }}
 */
export function profileFor(m) {
	const c = colorOf(m);
	if (c) return { profile: /** @type {string} */ (profileOf(/** @type {any} */ (c))), guessed: false, override: !!c.override };
	// no meta.color yet (made before ingest detected colour): stills are sRGB, video is display-referred Rec.709 —
	// what every file in the library was until the log pipeline (the worker's detection replaces this)
	return { profile: m?.kind === 'image' ? 'srgb' : m?.kind === 'video' ? 'rec709' : 'unknown', guessed: true, override: false };
}

// ── proxies (M2 / C6): the Edit tab plays only these ─────────────────────────────────────────────────────────────

/**
 * A file's HD proxy: its CID when the worker has made one (meta.proxy), else what its job says.
 * @param {MediaItem | undefined} m @param {Map<string, { status: string }>} [jobs]
 * @returns {{ cid: string | null, state: ProxyState }}
 */
export function proxyFor(m, jobs) {
	if (!m || !isVideo(m)) return { cid: null, state: 'n/a' };
	const p = m.meta?.proxy;
	if (typeof p === 'string' && p) return { cid: p, state: 'ready' };
	const job = jobs?.get(m.cid);
	if (job?.status === 'queued' || job?.status === 'rendering' || job?.status === 'failed') return { cid: null, state: job.status };
	return { cid: null, state: 'none' };
}
/**
 * A library file that is only a proxy (or a LUT cache, or a plate) — never shown in the bin; its original is.
 * @param {MediaItem} m
 */
export const isCache = (m) =>
	m.tags.includes('role:proxy') || m.tags.includes('role:lut') || typeof m.meta?.proxyOf === 'string' || typeof m.meta?.plateOf === 'string';

// ── grades as data ────────────────────────────────────────────────────────────────────────────────────────────────

/** @returns {Cdl} */
export const neutral = () => ({ slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 1 });
/** A grade, checked (null when it changes nothing), as it is saved. @param {unknown} g @returns {Cdl | null} */
export const clean = (g) => cleanCdl(g);
/**
 * The grades one clip goes through, in order: its own, then the film's look (C5).
 * @param {TimelineClip | null | undefined} c @param {Timeline | null | undefined} t @returns {Cdl[]}
 */
export function gradesFor(c, t) {
	return /** @type {Cdl[]} */ ([c?.grade, t?.grade?.look].filter((g) => !!g && !isNeutral(g)));
}
/**
 * Which preset a grade is, if it is one.
 * @param {Cdl | null | undefined} g @returns {string | null}
 */
export function presetOf(g) {
	/** @param {Cdl} a @param {Cdl} b */
	const same = (a, b) =>
		a.sat === b.sat && [0, 1, 2].every((i) => a.slope[i] === b.slope[i] && a.offset[i] === b.offset[i] && a.power[i] === b.power[i]);
	const g2 = g ?? NEUTRAL;
	return Object.entries(PRESETS).find(([, p]) => same(p.cdl, g2))?.[0] ?? null;
}
