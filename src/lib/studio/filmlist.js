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
 * A frozen film.
 * @typedef {{ key: string, name: string, frozen: string, story: { title: string, description: string },
 *   timeline: any, shots: Record<string, { name: string, project: string | null, spec: any }>, files: string[] }} Frozen
 */

const HASH = /^[0-9a-f]{64}$/;

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
	return null;
}
