// ADAPTER until stream B's contract C1 (api/src/timelines.ts) lands on this API.
//
// A timeline API from before C1 keeps only media clips (it refuses a clip without a CID) and drops everything else
// the studio now saves: `stage`, `version`, `color`, `grade` on the timeline, `kind`/`shot`/`grade`/`frame` on the
// clips. Until it knows them, the studio keeps those here, in this browser (localStorage, per timeline), sends the
// API only what it accepts, and puts the two back together when a timeline opens. An API that answers with `stage`
// knows C1, and then this does nothing.
//
// To remove once C1 is live: delete this file and its three calls in studio.svelte.js (`c1Knows`, `toServer`,
// `fromServer`).

/** @typedef {import('$lib/auth/client').Timeline} Timeline */
/** @typedef {import('$lib/auth/client').TimelineClip} TimelineClip */
/**
 * clips: per clip id, what the old API drops; world: whole world clips, which the old API refuses.
 * @typedef {Pick<Timeline, 'stage' | 'version' | 'color' | 'grade'> & { clips: Record<string, Pick<TimelineClip, 'grade' | 'frame'>>, world: TimelineClip[] }} Kept
 */

/** @param {string} id */
const KEY = (id) => `studio:c1:${id}`;

/**
 * Does this API keep C1's fields? (It answers with `stage` when it does.)
 * @param {Partial<Timeline> | null | undefined} t
 */
export const c1Knows = (t) => !!t && 'stage' in t && t.stage !== undefined;

/**
 * What goes to an API without C1 (media clips only), with the rest kept in this browser.
 * @param {string} id @param {Partial<Timeline>} body @param {boolean} knows @returns {Partial<Timeline>}
 */
export function toServer(id, body, knows) {
	if (knows) return body;
	const clips = body.clips ?? [];
	/** @type {Kept} */
	const kept = {
		stage: body.stage,
		version: body.version,
		color: body.color,
		grade: body.grade,
		clips: Object.fromEntries(clips.filter((c) => c.grade || c.frame).map((c) => [c.id, { grade: c.grade, frame: c.frame }])),
		world: clips.filter((c) => c.kind === 'world')
	};
	try {
		localStorage.setItem(KEY(id), JSON.stringify(kept));
	} catch {
		/* no storage: kept for this session only */
	}
	return { ...body, clips: clips.filter((c) => c.kind !== 'world' && c.cid) };
}

/**
 * A timeline from an API without C1, with what this browser kept for it put back.
 * @param {Timeline} t @returns {Timeline}
 */
export function fromServer(t) {
	if (c1Knows(t)) return t;
	/** @type {Kept | null} */
	let kept = null;
	try {
		kept = JSON.parse(localStorage.getItem(KEY(t.id)) ?? 'null');
	} catch {
		/* nothing kept */
	}
	if (!kept) return t;
	const k = kept;
	const clips = t.clips.map((c) => ({ ...c, ...(k.clips[c.id] ?? {}) }));
	return {
		...t,
		stage: kept.stage,
		version: kept.version,
		color: kept.color,
		grade: kept.grade,
		clips: [...clips, ...kept.world.filter((w) => !clips.some((c) => c.id === w.id))]
	};
}
