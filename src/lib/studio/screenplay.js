// A timeline read as a screenplay: the story's parts (the hook, three acts, the cliffhanger), their scenes, each shot
// as its action and what is said under it. One reading of the clips, shared by the studio's Script tab and the
// Stories board's Writing step, so both show the same script: the timeline is its one truth.
import { captionWordsOf, lineWords } from './transcript.js';

/** @typedef {import('$lib/auth/client').TimelineClip} Clip */
/** @typedef {import('$lib/auth/client').MediaItem} MediaItem */
/** A shot of the script: its clip, how far it is (words, a storyboard still, the footage, a world shot), what is said under it. @typedef {{ clip: Clip, stage: 'text' | 'storyboard' | 'footage' | 'world', lines: Clip[] }} ScriptShot */
/** @typedef {{ scene: string, shots: ScriptShot[] }} ScriptScene */
/** @typedef {{ shot: ScriptShot, scene: string, part: Clip | null, newPart: boolean, newScene: boolean }} ScriptPage */

export const PART = /** @type {Record<string, string>} */ ({ hook: 'Hook', act1: 'Act One', act2: 'Act Two', act3: 'Act Three', cliffhanger: 'Cliffhanger' });

/** The story's parts on the timeline, in order (the thumbnail's marker is not a part). @param {Clip[]} clips */
export const sectionsOf = (clips) => clips.filter((c) => c.kind === 'section' && c.section !== 'thumbnail').sort((a, b) => a.start - b.start);

/**
 * The script: the timeline's own clips read as scenes of shots, each with the lines said under it.
 * @param {Clip[]} clips @param {Map<string, MediaItem>} byHash @returns {ScriptScene[]}
 */
export function scriptOf(clips, byHash) {
	/** @type {ScriptScene[]} */
	const out = [];
	const lines = clips.filter((c) => c.track === 'A1').sort((a, b) => a.start - b.start);
	const shots = clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start);
	// each line is said under one shot: the last that has begun where it begins (a cut a hair after the line's
	// start, or a shot that ends a hair after it, never puts it under two)
	const under = new Map(lines.map((l) => [l.id, shots.findLast((c) => c.start - 0.05 <= l.start)?.id]));
	for (const c of shots) {
		const scene = c.script?.scene ?? out.at(-1)?.scene ?? 'Scene 1';
		if (out.at(-1)?.scene !== scene) out.push({ scene, shots: [] });
		const stage = c.kind === 'slate' ? 'text' : c.kind === 'world' ? 'world' : byHash.get(c.hash ?? '')?.kind === 'image' ? 'storyboard' : 'footage';
		/** @type {ScriptScene} */ (out.at(-1)).shots.push({ clip: c, stage, lines: lines.filter((l) => under.get(l.id) === c.id) });
	}
	return out;
}

/**
 * The script's pages: each shot with its part, its scene, and whether a new part or scene starts with it.
 * @param {ScriptScene[]} script @param {Clip[]} sections @returns {ScriptPage[]}
 */
export function pagesOf(script, sections) {
	/** @param {number} t */
	const partAt = (t) => sections.findLast((c) => t >= c.start - 0.05) ?? null;
	/** @type {ScriptPage[]} */
	const out = [];
	let lastPart = /** @type {string | null} */ (null), lastScene = '';
	for (const sc of script)
		for (const sh of sc.shots) {
			const part = partAt(sh.clip.start);
			out.push({ shot: sh, scene: sc.scene, part, newPart: (part?.id ?? null) !== lastPart, newScene: sc.scene !== lastScene });
			lastPart = part?.id ?? null;
			lastScene = sc.scene;
		}
	return out;
}

/**
 * The feelings the viewer goes through in a part, in order, each with whether the tension rises to it (↑) or is
 * released into it (↓).
 * @param {Clip} part
 */
export function feelingsOf(part) {
	const pts = [...(part.tension ?? [])].sort((a, b) => a.t - b.t);
	return pts.flatMap((p, i) => (p.feel ? [{ feel: p.feel, up: i === 0 || p.v >= (pts[i - 1]?.v ?? 0) }] : []));
}

/**
 * Who speaks a voice clip, and whether we see them say it (the same file on the picture track at the same time).
 * @param {Clip} l @param {Clip[]} clips @param {Map<string, MediaItem>} byHash
 */
export function speakerOf(l, clips, byHash) {
	const m = l.hash ? byHash.get(l.hash) : undefined;
	const name = String(m?.meta?.speaker ?? 'Samuel').toUpperCase();
	const seen = !!l.hash && clips.some((c) => c.track === 'V1' && c.hash === l.hash && l.start < c.start + c.dur && c.start < l.start + l.dur);
	return seen ? name : `${name} (V.O.)`;
}

/**
 * What a voice clip says: a line's words (not recorded yet), else the recorded file's transcript where the clip plays it.
 * @param {Clip} l @param {Map<string, MediaItem>} byHash
 */
export function saidBy(l, byHash) {
	const words = l.kind === 'line' ? lineWords(l) : captionWordsOf(byHash.get(l.hash ?? ''));
	return words
		.filter((w) => w.start >= l.in && w.start < l.in + l.dur)
		.map((w) => w.word)
		.join(' ');
}
