// ADAPTER until stream B's contract C1 (api/src/timelines.ts) lands on this API.
//
// A timeline API from before C1 keeps only media clips (it refuses a clip without a CID) and drops everything else
// the studio now saves: `stage`, `version`, `color`, `grade` on the timeline, `kind`/`shot`/`grade`/`frame` on the
// clips. Until it knows them, the studio keeps those here, in this browser (localStorage, per timeline), sends the
// API only what it accepts, and puts the two back together when a timeline opens. An API that answers with `stage`
// knows C1, and then this does nothing.
//
// To remove once C1 is live: delete this file and its three calls in studio.svelte.ts (`c1Knows`, `toServer`,
// `fromServer`).
import type { Timeline, TimelineClip } from '$lib/auth/client';

const KEY = (id: string) => `studio:c1:${id}`;
type Kept = Pick<Timeline, 'stage' | 'version' | 'color' | 'grade'> & {
	/** per clip id: what the old API drops */
	clips: Record<string, Pick<TimelineClip, 'grade' | 'frame'>>;
	/** whole world clips, which the old API refuses */
	world: TimelineClip[];
};

/** Does this API keep C1's fields? (It answers with `stage` when it does.) */
export const c1Knows = (t: Partial<Timeline> | null | undefined) => !!t && 'stage' in t && t.stage !== undefined;

/** What goes to an API without C1 (media clips only), with the rest kept in this browser. */
export function toServer(id: string, body: Partial<Timeline>, knows: boolean): Partial<Timeline> {
	if (knows) return body;
	const clips = body.clips ?? [];
	const kept: Kept = {
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

/** A timeline from an API without C1, with what this browser kept for it put back. */
export function fromServer(t: Timeline): Timeline {
	if (c1Knows(t)) return t;
	let kept: Kept | null = null;
	try {
		kept = JSON.parse(localStorage.getItem(KEY(t.id)) ?? 'null');
	} catch {
		/* nothing kept */
	}
	if (!kept) return t;
	const clips = t.clips.map((c) => ({ ...c, ...(kept!.clips[c.id] ?? {}) }));
	return {
		...t,
		stage: kept.stage,
		version: kept.version,
		color: kept.color,
		grade: kept.grade,
		clips: [...clips, ...kept.world.filter((w) => !clips.some((c) => c.id === w.id))]
	};
}
