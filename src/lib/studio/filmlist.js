/*
 * The two films that come over from the legacy studio (Samuel 2026-10-18), as plain data: read by ./legacyfilms.js
 * and by scripts/freeze-films.mjs, which freezes each into films/legacy/<key>.json once, so the films come back
 * after any avenDB reset, and after the old studio is gone, from the repo and the media vault alone (./frozen.js).
 */

/**
 * Each film: its legacy timeline, by its story (`project`) and its name, and what it is called now.
 * @typedef {{ key: string, project: string, timeline: string, name: string }} Film
 * @type {Film[]}
 */
export const FILMS = [
	{ key: '1-million-decision', project: 'The 1 million decision', timeline: 'Day 01 · Opening', name: '1 million decision' },
	{ key: 'the-first-village', project: '233 settlers, how it starts', timeline: 'World', name: 'The first village' }
];

/** @param {unknown} s */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The legacy timeline of film `f` among `all`: of its story, by its name, else its only one there.
 * @param {Film} f @param {{ id: string, name: string, project: string | null, description?: string | null }[]} all
 */
export function legacyOf(f, all) {
	const mine = all.filter((t) => norm(t.project) === norm(f.project));
	return mine.find((t) => norm(t.name) === norm(f.timeline)) ?? (mine.length === 1 ? mine[0] : null);
}

/**
 * A frozen film. `proxies`: the proxy, by its BLAKE3 hash, of each world shot (`<shot>@<version>`) whose world the
 * film camera no longer has (game/film/worlds.js), kept in the Mac's film seed beside its files; a shot in a world it
 * has gets its proxy rendered in that world instead (./cuts.js `proxiesOf`).
 * @typedef {{ key: string, name: string, frozen: string, story: { title: string, description: string },
 *   timeline: any, shots: Record<string, { name: string, project: string | null, spec: any }>, files: string[],
 *   proxies?: Record<string, string>, published?: Published[] }} Frozen
 */
/**
 * A file a film's published post used (the film as it went out, a still), as the Mac's film seed lists it
 * (`published/files.json`): its BLAKE3 hash, where in `published/` its bytes are, which post files used it, and its
 * legacy catalog record.
 * @typedef {{ hash: string, file?: string, bytes?: number, in?: string[], record?: { mime?: string, title?: string, original_name?: string, meta?: Record<string, any> } }} Published
 */

const HASH = /^[0-9a-f]{64}$/;

/** The files timeline `t` plays, by their BLAKE3 hash, each once (a world clip plays a shot, no file). @param {any} t @returns {string[]} */
export const filesIn = (t) => [...new Set((t?.clips ?? []).filter((/** @type {any} */ c) => c.kind !== 'world' && typeof c.hash === 'string' && HASH.test(c.hash)).map((/** @type {any} */ c) => c.hash))];

/**
 * Why `v` is no frozen film, or `null` where it is one.
 * @param {any} v @returns {string | null}
 */
export function badFrozen(v) {
	if (!v || typeof v !== 'object') return 'not an object';
	if (typeof v.key !== 'string' || !v.key) return 'no key';
	if (!v.timeline || !Array.isArray(v.timeline.clips)) return 'no timeline with clips';
	if (!v.shots || typeof v.shots !== 'object') return 'no shots';
	for (const c of v.timeline.clips) {
		if (c.kind === 'world' && typeof c.shot === 'string' && !c.shot.startsWith('shot:') && !v.shots[`${c.shot}@${c.shotVersion}`]) return `the shot ${c.shot}@${c.shotVersion} is missing`;
	}
	if (!Array.isArray(v.files) || v.files.some((/** @type {unknown} */ h) => !HASH.test(String(h)))) return 'files are BLAKE3 hashes';
	if (v.published != null && (!Array.isArray(v.published) || v.published.some((/** @type {any} */ p) => !HASH.test(String(p?.hash))))) return 'published files are BLAKE3 hashes';
	if (v.proxies != null && (typeof v.proxies !== 'object' || Object.values(v.proxies).some((h) => !HASH.test(String(h))))) return 'proxies are BLAKE3 hashes';
	return null;
}
