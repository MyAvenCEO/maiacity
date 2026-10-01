/**
 * A file's shot analysis, as the studio shows it (the Mac's `analysis/<hash>` record, merged into `meta.analysis`):
 * what the file shows, where it serves an edit best, its tags, and its cues — each in the file's own seconds.
 */

/** @typedef {{ s: number, e: number, kind: string, label: string, confidence?: number, note?: string, why?: string, take_of?: string, take?: number, rank?: number, best?: boolean }} Cue */
/** @typedef {{ summary?: { line?: string, best_use?: string }, labels?: string[], free?: string[], cues?: Cue[] }} Analysis */

/** The cue kinds (game/film/vocabulary.json), each with its one colour — the timeline, the inspector and the source monitor. */
export const CUE_KINDS = /** @type {const} */ (['take', 'action', 'emotion', 'cut', 'transition', 'highlight', 'problem']);

/** What each kind of cue means, in a line (the legend's, the hover card's). */
export const CUE_MEANING = /** @type {Record<string, string>} */ ({
	take: 'One attempt at something done more than once — numbered and ranked; the best one in gold',
	action: 'Something happens: a movement, a gesture, a look',
	emotion: 'The mood or expression on screen',
	cut: 'A clean point to cut in or out',
	transition: 'A moment that can carry into the next shot: a walk out, a turn away, a camera move',
	highlight: 'A strong moment worth using',
	problem: 'Something to avoid: shake, blur, noise, a fluff'
});

/** A file's analysis, when it has one. @param {import('$lib/auth/client').MediaItem | undefined} m @returns {Analysis | null} */
export function analysisOf(m) {
	const a = m?.meta?.analysis;
	return a && typeof a === 'object' ? /** @type {Analysis} */ (a) : null;
}

/** Its cues, in order. @param {import('$lib/auth/client').MediaItem | undefined} m @returns {Cue[]} */
export function cuesOf(m) {
	const c = analysisOf(m)?.cues;
	return Array.isArray(c) ? c.filter((q) => typeof q.s === 'number') : [];
}

/**
 * Its tags: the base labels, then the free ones — each once (the analysis often names a label among its free tags
 * too, and a tag shown twice broke the list drawing them). @param {import('$lib/auth/client').MediaItem | undefined} m
 */
export function tagsOf(m) {
	const a = analysisOf(m);
	return [...new Set([...(a?.labels ?? []), ...(a?.free ?? [])].map(String))];
}

/** Where a cue ends (a point: where it starts). @param {Cue} q */
export const cueEnd = (q) => Math.max(q.s, q.e ?? q.s);

/** A cue in words: its kind and label, the take and its rank, the note and why, how sure. @param {Cue} q */
export const cueText = (q) =>
	[
		`${q.kind}: ${q.label}`,
		q.kind === 'take' && q.take ? `take ${q.take}${q.rank ? ` (rank ${q.rank}${q.best ? ', best' : ''})` : ''}` : '',
		q.note ?? '',
		q.why ?? '',
		typeof q.confidence === 'number' ? `${Math.round(q.confidence * 100)} % sure` : '',
	]
		.filter(Boolean)
		.join(' — ');
