// The old world sorted everything by its day ("Day 01" … "Day 19"): the blog folders, the board's items, the
// timelines' projects, the media's tags. The new world is stories — the media vault's buckets, each named by its
// title — and, before a story, ideas, each a short name its pictures and notes cluster under. Every old day is one
// name now: the story it became, or the idea it is. The one list (legacy.json), read here — by the media library, the
// scripts (api/scripts/day.ts, the film scripts) — and by the Mac app, which renames and merges the vault's buckets and
// rewrites the files' day tags by it when it starts; the API's migration 0032 holds a frozen copy.
import LEGACY_LIST from './legacy.json' with { type: 'json' };

/** @typedef {{ day: number, name: string, story?: boolean }} Legacy */

/** @type {Legacy[]} the list itself: legacy.json, which the Mac app reads too (vault/app/src/stories.rs) */
export const LEGACY = LEGACY_LIST;

/** The day an old name stands for ("Day 05", "Day 5", "day-05", "DAY 0005"), or null. */
export function dayIn(/** @type {string | null | undefined} */ s) {
	const n = String(s ?? '').match(/^\s*day[\s-]*0*(\d+)\s*$/i)?.[1];
	return n == null ? null : Number(n);
}

/** What an old day is called now; a day not on the list keeps its old name. */
export function nameOfDay(/** @type {number} */ day) {
	return LEGACY.find((l) => l.day === day)?.name ?? `Day ${String(day).padStart(2, '0')}`;
}

/** An old day's name ("Day 19") as what it is now ("233 settlers, how it starts"); anything else as it is. */
export const renamed = (/** @type {string} */ s) => {
	const d = dayIn(s);
	return d == null ? s : nameOfDay(d);
};

/** The tag an idea's files carry: "idea:The food forest". */
export const IDEA = 'idea';
export const ideaTag = (/** @type {string} */ name) => `${IDEA}:${name}`;

/** A file's tags with every old day tag ("Day 06") as its idea's ("idea:The food forest"), each once; a day not on
 *  the list stays as it is. */
export function retagged(/** @type {string[]} */ tags) {
	const out = tags.map((t) => {
		const name = LEGACY.find((l) => l.day === dayIn(t))?.name;
		return name ? ideaTag(name) : t;
	});
	return [...new Set(out)];
}

/** "Day 19 · We filmed…", "Day 01 — a city…" → without the day in front. */
export const withoutDay = (/** @type {string} */ s) => String(s ?? '').replace(/^\s*day\s*\d+\s*[·:—–-]\s*/i, '');

/** Two names the same, whatever their case and punctuation ("233 Settlers — How It Starts" = "233 settlers, how it starts"). */
export const sameName = (/** @type {string | null | undefined} */ a, /** @type {string | null | undefined} */ b) => {
	const k = (/** @type {string | null | undefined} */ s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
	return !!k(a) && k(a) === k(b);
};
