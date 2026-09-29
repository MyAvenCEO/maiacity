// The media library's order: one flat pool of files, known by CID, grouped only by their tags.
//
// A tag is a plain string. "Day 19" says which day a file belongs to; "key:value" tags are facets (role:shot,
// scene:the dip, shot:05 the edge, take:b, …); the rest are plain tags ("cover", "site", "sandbox 4", a folder's
// name). The paths are only names — nothing here reads a folder out of them.
import { API, mediaUrl, type MediaItem } from '$lib/auth/client';

/** The film's scenes, in the order the film plays them — not the alphabet's. */
export const SCENES = ['hook', 'sunrise', 'the dip', 'breakfast', 'under the glass', 'food forest', 'the ring', 'the commons', 'night'];

/** How a file is used, in the order a scene shows them: the moving picture, its stills, its words, then the rest. */
export const ROLES = ['shot', 'storyboard', 'voice', 'render', 'film', 'thumbnail', 'cover', 'in-post', 'score', 'cue', 'music', 'sfx'];

/** The facets the right-hand panel offers, in this order; any other "key:value" facet follows, then the plain tags. */
export const FACETS = ['role', 'scene', 'shot', 'take', 'cut', 'aspect', 'codec', 'voice', 'sound', 'cue'];
export const PLAIN = 'tag';
export const FACET_LABEL: Record<string, string> = {
	role: 'Role',
	scene: 'Scene',
	shot: 'Shot',
	take: 'Take',
	cut: 'Cut',
	aspect: 'Aspect',
	codec: 'Codec',
	voice: 'Voice',
	sound: 'Sound',
	cue: 'Cue',
	[PLAIN]: 'Other tags'
};

/** The tags with toggles of their own, kept out of the chips. */
export const SUPERSEDED = 'superseded';
export const UNUSED = 'unused';

/** Without a scene, a day's files gather by what they are for. */
const ROLE_GROUPS: { title: string; roles: string[]; plain?: string[] }[] = [
	{ title: 'Shots', roles: ['shot'] },
	{ title: 'Storyboard stills', roles: ['storyboard'] },
	{ title: 'Voice takes', roles: ['voice'] },
	{ title: 'Score & cues', roles: ['score', 'cue', 'music'] },
	{ title: 'Sound effects', roles: ['sfx'] },
	{ title: 'Renders & films', roles: ['render', 'film'], plain: ['film'] },
	{ title: 'Thumbnails', roles: ['thumbnail'] },
	{ title: 'Covers', roles: ['cover'], plain: ['cover', 'poster'] },
	{ title: 'Journal pictures', roles: ['in-post'], plain: ['in the post', 'author'] }
];

export type Parsed = {
	/** every day it belongs to, as numbers (Day 05 → 5) */
	days: number[];
	/** facet → its values; the plain tags under PLAIN */
	facets: Map<string, string[]>;
	superseded: boolean;
	unused: boolean;
};

const DAY = /^Day (\d+)$/;
const FACET = /^([a-z][a-z0-9-]*):\s*(.+)$/;

export function parse(m: MediaItem): Parsed {
	const days: number[] = [];
	const facets = new Map<string, string[]>();
	const add = (k: string, v: string) => facets.set(k, [...(facets.get(k) ?? []), v]);
	for (const t of m.tags) {
		const day = DAY.exec(t);
		if (day) days.push(Number(day[1]));
		else if (t === SUPERSEDED || t === UNUSED) continue;
		else {
			const f = FACET.exec(t);
			if (f) add(f[1]!, f[2]!.trim());
			else add(PLAIN, t);
		}
	}
	return { days: days.sort((a, b) => b - a), facets, superseded: m.tags.includes(SUPERSEDED), unused: m.tags.includes(UNUSED) };
}

export const dayTag = (n: number) => `Day ${String(n).padStart(2, '0')}`;
export const facetTag = (k: string, v: string) => (k === PLAIN ? v : `${k}:${v}`);

// ── order ────────────────────────────────────────────────────────────────

const shotNo = (v: string | undefined) => (v ? Number(/^\d+/.exec(v)?.[0] ?? 999) : 1000);
const at = (list: string[], v: string | undefined) => (v === undefined ? list.length + 1 : list.includes(v) ? list.indexOf(v) : list.length);
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** How the values of one facet line up: scenes as the film plays, shots by number, roles by use, the rest naturally. */
export function valueOrder(key: string) {
	if (key === 'scene') return (a: string, b: string) => at(SCENES, a) - at(SCENES, b) || natural(a, b);
	if (key === 'shot') return (a: string, b: string) => shotNo(a) - shotNo(b) || natural(a, b);
	if (key === 'role') return (a: string, b: string) => at(ROLES, a) - at(ROLES, b) || natural(a, b);
	return natural;
}

export function facetOrder(a: string, b: string) {
	const rank = (k: string) => (k === PLAIN ? 1000 : FACETS.includes(k) ? FACETS.indexOf(k) : 500);
	return rank(a) - rank(b) || natural(a, b);
}

/** The first value of a facet, by that facet's own order. */
export const first = (p: Parsed, key: string) => [...(p.facets.get(key) ?? [])].sort(valueOrder(key))[0];

/** One order for every list of files: scene, shot, what it is, take, then its name. */
export function compare(pa: Parsed, pb: Parsed, a: MediaItem, b: MediaItem) {
	return (
		at(SCENES, first(pa, 'scene')) - at(SCENES, first(pb, 'scene')) ||
		shotNo(first(pa, 'shot')) - shotNo(first(pb, 'shot')) ||
		at(ROLES, first(pa, 'role')) - at(ROLES, first(pb, 'role')) ||
		natural(first(pa, 'take') ?? '', first(pb, 'take') ?? '') ||
		natural(label(a, pa), label(b, pb))
	);
}

// ── grouping ─────────────────────────────────────────────────────────────

export type Block = { key: string; label: string | null; items: MediaItem[] };
export type Section = { key: string; title: string; count: number; blocks: Block[] };

/**
 * One day's files, colocated: the film first (every render, the newest cut on top), then a section per scene in
 * film order, a row per shot inside it; then what has no scene, by what it is for. A file in two scenes shows in both — pools, not folders.
 */
export function byScene(items: MediaItem[], parsed: (m: MediaItem) => Parsed): Section[] {
	const scenes = new Map<string, MediaItem[]>();
	const rest: MediaItem[] = [];
	const films: MediaItem[] = [];
	for (const m of items) {
		const roles = parsed(m).facets.get('role') ?? [];
		if (roles.includes('render') || roles.includes('film')) {
			films.push(m);
			continue;
		}
		const s = parsed(m).facets.get('scene');
		if (s?.length) for (const v of s) scenes.set(v, [...(scenes.get(v) ?? []), m]);
		else rest.push(m);
	}
	const sorted = (list: MediaItem[]) => [...list].sort((a, b) => compare(parsed(a), parsed(b), a, b));
	// the film itself first: what the day's pieces became
	const out: Section[] = films.length ? [{ key: 'film', title: 'The film', count: films.length, blocks: [{ key: '', label: null, items: newestCut(films, parsed) }] }] : [];
	for (const scene of [...scenes.keys()].sort(valueOrder('scene'))) {
		const list = sorted(scenes.get(scene)!);
		const shots = new Map<string, MediaItem[]>();
		for (const m of list) {
			const k = first(parsed(m), 'shot') ?? '';
			shots.set(k, [...(shots.get(k) ?? []), m]);
		}
		// the shots in order, then whatever belongs to the whole scene
		const keys = [...shots.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : valueOrder('shot')(a, b)));
		out.push({
			key: `scene:${scene}`,
			title: scene,
			count: list.length,
			blocks: keys.map((k) => ({ key: k, label: k || (keys.length > 1 ? 'the whole scene' : null), items: shots.get(k)! }))
		});
	}
	const groups = ROLE_GROUPS.map((g) => ({ ...g, items: [] as MediaItem[] }));
	const other: MediaItem[] = [];
	for (const m of rest) {
		const p = parsed(m);
		const roles = p.facets.get('role') ?? [];
		const plain = p.facets.get(PLAIN) ?? [];
		const g =
			groups.find((g) => g.roles.some((r) => roles.includes(r))) ?? groups.find((g) => g.plain?.some((t) => plain.includes(t)));
		(g?.items ?? other).push(m);
	}
	for (const g of groups)
		if (g.items.length) out.push({ key: `role:${g.title}`, title: g.title, count: g.items.length, blocks: [{ key: '', label: null, items: sorted(g.items) }] });
	if (other.length) out.push({ key: 'other', title: 'Everything else', count: other.length, blocks: [{ key: '', label: null, items: sorted(other) }] });
	return out;
}

/** The renders, the newest cut first; in each cut its master (HEVC) before the copies, then the newest. */
function newestCut(items: MediaItem[], parsed: (m: MediaItem) => Parsed): MediaItem[] {
	const cut = (m: MediaItem) => first(parsed(m), 'cut') ?? '';
	const latest = new Map<string, string>();
	for (const m of items) if (m.created > (latest.get(cut(m)) ?? '')) latest.set(cut(m), m.created);
	const master = (m: MediaItem) => (parsed(m).facets.get('codec')?.includes('hevc') ? 0 : 1);
	return [...items].sort(
		(a, b) =>
			latest.get(cut(b))!.localeCompare(latest.get(cut(a))!) ||
			cut(b).localeCompare(cut(a)) ||
			master(a) - master(b) ||
			b.created.localeCompare(a.created)
	);
}

/** Every day at once: a section per day, newest first, then the files that belong to none. */
export function byDay(items: MediaItem[], parsed: (m: MediaItem) => Parsed): Section[] {
	const days = new Map<number, MediaItem[]>();
	const none: MediaItem[] = [];
	for (const m of items) {
		const d = parsed(m).days;
		if (d.length) for (const n of d) days.set(n, [...(days.get(n) ?? []), m]);
		else none.push(m);
	}
	const sorted = (list: MediaItem[]) => [...list].sort((a, b) => compare(parsed(a), parsed(b), a, b));
	const out: Section[] = [...days.keys()]
		.sort((a, b) => b - a)
		.map((n) => {
			const list = sorted(days.get(n)!);
			return { key: `day:${n}`, title: dayTag(n), count: list.length, blocks: [{ key: '', label: null, items: list }] };
		});
	if (none.length) out.push({ key: 'none', title: 'No day', count: none.length, blocks: [{ key: '', label: null, items: sorted(none) }] });
	return out;
}

// ── names ────────────────────────────────────────────────────────────────

export const raw = (cid: string) => mediaUrl(cid);
/** Pictures from the CDN copy when there is one (cached, public), else from the library itself. */
export const thumb = (m: MediaItem) => (m.cdn_path ? `https://maia.city/${m.cdn_path}` : raw(m.cid));

/** A file's title (it has no name: only its CID). */
export const fileName = (m: MediaItem) => m.title || m.cid.slice(0, 12);

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** What a tile says: the shot and its take, a sound's or cue's name, the title — the file's name only as a last resort. */
export function label(m: MediaItem, p: Parsed): string {
	const shot = first(p, 'shot');
	const take = first(p, 'take');
	if (shot) return take ? `${shot} · ${take}` : shot;
	const title = text(m.meta?.title);
	if (title) return title;
	const named = first(p, 'sound') ?? first(p, 'cue');
	if (named) return named;
	if (take) return take;
	return fileName(m);
}

/** The line under it: what it is, and how it is cut. */
export function sub(m: MediaItem, p: Parsed): string {
	const bits = [first(p, 'role'), first(p, 'shot') ? undefined : first(p, 'scene'), first(p, 'aspect'), first(p, 'codec'), first(p, 'cut') && `cut ${first(p, 'cut')}`];
	const d = seconds(m);
	if (d) bits.push(clock(d));
	const words = text(m.meta?.text);
	if (words && m.kind === 'audio' && !first(p, 'shot')) return words;
	return bits.filter(Boolean).join(' · ') || m.kind;
}

/** How long it runs, when the library knows. */
export function seconds(m: MediaItem): number | undefined {
	const s = Number(m.meta?.duration_s);
	if (s > 0) return s;
	const ms = Number(m.meta?.duration_ms);
	return ms > 0 ? ms / 1000 : undefined;
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export const size = (n: number) =>
	n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`;

/** A made-up waveform, the same for the same file every time: the tile's picture of a sound. */
export function bars(cid: string, n = 28): number[] {
	let h = 2166136261;
	for (const c of cid) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return Array.from({ length: n }, (_, i) => {
		h = Math.imul(h ^ (h >>> 13), 1274126177) + i;
		return 0.25 + ((h >>> 0) % 1000) / 1333;
	});
}
