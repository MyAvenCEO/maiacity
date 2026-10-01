// The grade as the Grade tab works it: stacks of tools (game/film/grade-tools.js — the one registry), a lane each on
// the timeline (a line of its tools), the chosen one's tools in the aside beside the picture. One place for what both
// read and write.
//
// The lanes, the last applied on top (the base correction on the floor, just above the picture; the framing, the shot's
// place in the frame, apart at the top):
//   frame     Framing — where the shot sits in the frame of the shape seen (not a grade)
//   finish    Finishing — the whole timeline's texture
//   timeline  Timeline look — the whole timeline
//   scene     Scene look — every shot of the scene
//   clip      Clip look — the shot's own look
//   base      Base correction — the shot's fixed first nodes
import { BUNDLES, cleanStack, stackText } from '../../../game/film/grade-tools.js';

/** @typedef {'frame' | 'finish' | 'timeline' | 'scene' | 'clip' | 'base'} Layer */
/** @typedef {import('$lib/auth/client').GradeStack} GradeStack */
/** @typedef {import('./studio.svelte.js').Clip} Clip */
/** @typedef {import('./studio.svelte.js').Studio} Studio */

const label = (/** @type {string} */ id) => BUNDLES.find((b) => b.id === id)?.label ?? id;

/** the lanes, top to bottom @type {{ id: Layer, label: string, what: string }[]} */
export const LAYERS = [
	{ id: 'frame', label: 'Framing', what: 'this shot, in this shape' },
	{ id: 'finish', label: label('finish'), what: 'the whole timeline' },
	{ id: 'timeline', label: label('timeline'), what: 'the whole timeline' },
	{ id: 'scene', label: label('scene'), what: 'every shot of the scene' },
	{ id: 'clip', label: label('clip'), what: 'this shot' },
	{ id: 'base', label: label('base'), what: 'this shot' }
];

/** Does the layer belong to a shot (base, clip, frame), a scene, or the whole timeline? @param {Layer} l */
export const ofShot = (l) => l === 'base' || l === 'clip' || l === 'frame';

/**
 * A layer's stack: a shot's (base, clip), its scene's, the timeline's (timeline, finish); null when it has none.
 * @param {Studio} s @param {Layer} layer @param {Clip | null | undefined} c @returns {GradeStack | null}
 */
export function stackOf(s, layer, c) {
	const g = s.current?.grade ?? {};
	if (layer === 'base' || layer === 'clip') return c?.stacks?.[layer] ?? null;
	if (layer === 'scene') return c?.script?.scene ? (g.scenes?.[c.script.scene] ?? null) : null;
	if (layer === 'timeline' || layer === 'finish') return g[layer] ?? null;
	return null;
}

/**
 * A layer's stack set (checked; a stack with no tools takes the layer off).
 * @param {Studio} s @param {Layer} layer @param {Clip | null | undefined} c @param {GradeStack | null} stack
 */
export function setStack(s, layer, c, stack) {
	const st = stack ? cleanStack(stack) : null;
	if (layer === 'base' || layer === 'clip') {
		if (!c) return;
		const stacks = { ...(c.stacks ?? {}) };
		if (st) stacks[layer] = st;
		else delete stacks[layer];
		s.patchClip(c.id, { stacks: Object.keys(stacks).length ? stacks : undefined });
		return;
	}
	const g = { ...(s.current?.grade ?? {}) };
	if (layer === 'scene') {
		const scene = c?.script?.scene;
		if (!scene) return;
		const scenes = { ...(g.scenes ?? {}) };
		if (st) scenes[scene] = st;
		else delete scenes[scene];
		g.scenes = scenes;
	} else if (layer === 'timeline' || layer === 'finish') {
		if (st) g[layer] = st;
		else delete g[layer];
	}
	s.setMeta({ grade: g });
}

/** a stack in one line (the lanes) @param {GradeStack | null | undefined} st */
export const stackLine = (st) => stackText(st);

/** a shot's framing in one line @param {Clip} c @param {string} shape */
export const frameLine = (c, shape) => {
	const f = c.frame?.[/** @type {import('$lib/auth/client').Shape} */ (shape)];
	return f ? `${shape} · ${(f.zoom ?? 1).toFixed(2)}×` : '—';
};

/** the runs of shots each scene covers, in the strip's order @param {Clip[]} pics */
export function sceneRuns(pics) {
	/** @type {{ key: string, scene: string | null, from: number, count: number }[]} */
	const runs = [];
	pics.forEach((c, i) => {
		const scene = c.script?.scene || null;
		const last = runs[runs.length - 1];
		if (last && last.scene === scene) last.count++;
		else runs.push({ key: `${i}:${scene}`, scene, from: i, count: 1 });
	});
	return runs;
}
