// The studio's side of the colour standard (contract C5): what each picture is, how the viewer brings it in, and the
// grades as data. The maths and the tables live in game/film/color.js (stream A) — imported, never copied.
import { PROFILES, profileOf, NEUTRAL, isNeutral, cleanCdl, PRESETS, cdl, ODT } from '../../../game/film/color.js';
import type { Cdl, ColorInfo, MediaItem, Timeline, TimelineClip } from '$lib/auth/client';

export { PROFILES, profileOf, NEUTRAL, isNeutral, cleanCdl, PRESETS, cdl, ODT };

/**
 * Every profile a picture can carry, as the contract lists them. color.js names the ones its first version knows;
 * the rest (generated footage, contract C5 / revised rule 3) are labelled here until color.js carries them.
 */
const EXTRA: Record<string, { label: string; idt: string | null; display: boolean; log: boolean }> = {
	'aces2065-1': { label: 'ACES2065-1 (linear AP0)', idt: null, display: false, log: false },
	acescg: { label: 'ACEScg (linear AP1)', idt: null, display: false, log: false },
	'linear-rec709': { label: 'Linear Rec.709', idt: null, display: false, log: false },
	unknown: { label: 'Unknown — say what it is', idt: null, display: false, log: false }
};
export type ProfileInfo = { label: string; idt: string | null; display: boolean; log: boolean };
export const profileInfo = (p: string): ProfileInfo =>
	(PROFILES as Record<string, ProfileInfo>)[p] ?? EXTRA[p] ?? { label: p, idt: null, display: false, log: false };
/** The choices of the override menu, in the order a colourist thinks of them. */
export const PROFILE_CHOICES = [...new Set([...Object.keys(PROFILES), ...Object.keys(EXTRA)])];

/** The few letters a badge shows. */
const SHORT: Record<string, string> = {
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
export const short = (p: string) => SHORT[p] ?? p;

/** What the ingest found out about a file's colour (meta.color), if anything. */
export const colorOf = (m: MediaItem | undefined): ColorInfo | undefined => {
	const c = m?.meta?.color;
	return c && typeof c === 'object' ? (c as ColorInfo) : undefined;
};
/** The profile a file is treated as: set by hand, else detected, else — for files from before detection — a guess by kind, marked as such. */
export function profileFor(m: MediaItem | undefined): { profile: string; guessed: boolean; override: boolean } {
	const c = colorOf(m);
	if (c) return { profile: profileOf(c as never) as string, guessed: false, override: !!c.override };
	// no meta.color yet (made before ingest detected colour): stills are sRGB, video is display-referred Rec.709 —
	// what every file in the library was until the log pipeline (the worker's detection replaces this)
	return { profile: m?.kind === 'image' ? 'srgb' : m?.kind === 'video' ? 'rec709' : 'unknown', guessed: true, override: false };
}

// ── proxies (M2 / C6): the Edit tab plays only these ─────────────────────────────────────────────────────────────

export type ProxyState = 'ready' | 'none' | 'queued' | 'rendering' | 'failed' | 'n/a';
/** A file's HD proxy: its CID when the worker has made one (meta.proxy), else what its job says. */
export function proxyFor(m: MediaItem | undefined, jobs?: Map<string, { status: string }>): { cid: string | null; state: ProxyState } {
	if (!m || m.kind === 'audio' || m.kind === 'image') return { cid: null, state: 'n/a' };
	const p = m.meta?.proxy;
	if (typeof p === 'string' && p) return { cid: p, state: 'ready' };
	const job = jobs?.get(m.cid);
	if (job?.status === 'queued' || job?.status === 'rendering' || job?.status === 'failed') return { cid: null, state: job.status };
	return { cid: null, state: 'none' };
}
/** A library file that is only a proxy (or a LUT cache) — never shown in the bin; its original is. */
export const isCache = (m: MediaItem) =>
	m.tags.includes('role:proxy') || m.tags.includes('role:lut') || typeof m.meta?.proxyOf === 'string' || typeof m.meta?.plateOf === 'string';

// ── grades as data ────────────────────────────────────────────────────────────────────────────────────────────────

export const neutral = (): Cdl => ({ slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 1 });
/** A grade, checked (null when it changes nothing), as it is saved. */
export const clean = (g: unknown): Cdl | null => cleanCdl(g) as Cdl | null;
/** The grades one clip goes through, in order: its own, then the film's look (C5). */
export function gradesFor(c: TimelineClip | null | undefined, t: Timeline | null | undefined): Cdl[] {
	return [c?.grade, t?.grade?.look].filter((g): g is Cdl => !!g && !isNeutral(g));
}
/** Which preset a grade is, if it is one. */
export function presetOf(g: Cdl | null | undefined): string | null {
	const same = (a: Cdl, b: Cdl) =>
		a.sat === b.sat && [0, 1, 2].every((i) => a.slope[i] === b.slope[i] && a.offset[i] === b.offset[i] && a.power[i] === b.power[i]);
	const g2 = g ?? (NEUTRAL as Cdl);
	return Object.entries(PRESETS).find(([, p]) => same(p.cdl as Cdl, g2))?.[0] ?? null;
}
