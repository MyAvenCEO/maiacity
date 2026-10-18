// A REEL OF SHOTS — the one shot player's timeline: world shots (./shot.js specs) one after another, each as long as
// it says (`seconds`), and what is on screen at any moment of them. The studio's world viewer, the Mac's plate
// renderer and a game playing its own film (MaiaCity V1's intro) all pick their frame here and evaluate it with
// ./shot.js `evaluate`, so a shot plays the same wherever it plays: a game playing a tuned cut's shots plays exactly
// what the studio showed. Nothing in a reel is code: it is the shots' data alone, checked by ./shot.js.
// Plain JavaScript, shared by the browser, the API and the scripts.
import { evaluate, normalize } from './shot.js';

/** @typedef {import('./shot.js').Spec} Spec @typedef {import('./shot.js').Shape} Shape */
/** @typedef {{ spec: Spec, start: number, end: number }} Placed */
/** @typedef {{ shots: Placed[], seconds: number }} Reel */

/**
 * Shots one after another, from 0 (each checked: a reel holds no shot ./shot.js would refuse).
 * @param {unknown[]} specs @returns {Reel}
 */
export function reelOf(specs) {
	let t = 0;
	const shots = specs.map((raw) => {
		const spec = normalize(raw);
		const placed = { spec, start: t, end: t + spec.seconds };
		t = placed.end;
		return placed;
	});
	return { shots, seconds: t };
}

/**
 * The shot on screen at reel time t (seconds), and t in it: before the first, its first frame; after the last, its
 * last frame held. Null for an empty reel.
 * @param {Reel} reel @param {number} t
 * @returns {{ index: number, spec: Spec, t: number } | null}
 */
export function shotAt(reel, t) {
	const n = reel.shots.length;
	if (!n) return null;
	let i = 0;
	while (i < n - 1 && t >= reel.shots[i].end) i++;
	const s = reel.shots[i];
	return { index: i, spec: s.spec, t: Math.min(s.spec.seconds, Math.max(0, t - s.start)) };
}

/**
 * Everything about the reel's frame at t, for one shape: which shot, its time, and ./shot.js `evaluate` of it.
 * @param {Reel} reel @param {number} t @param {Shape} [shape]
 */
export function frameAt(reel, t, shape) {
	const at = shotAt(reel, t);
	return at ? { ...at, ...evaluate(at.spec, at.t, shape) } : null;
}
