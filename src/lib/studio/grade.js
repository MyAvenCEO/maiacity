// The grade as the Grade tab works it: stacks of tools (game/film/grade-tools.js — the one registry), a lane each on
// the timeline (a bar in its colour, named by its stack), the chosen one's tools in the aside beside the picture. One
// place for what both read and write.
//
// The lanes, the last applied on top (the base correct on the floor, just above the picture):
//   timeline  Timeline look — the whole timeline (the film's texture, grain, vignette …, its last tools)
//   scene     Scene look — every shot of the scene
//   clip      Clip look — the shot's own look (its framing in the shape seen beside it)
//   base      Base correct — the shot's fixed first nodes
import { BUNDLES, cleanStack, stackText } from '../../../game/film/grade-tools.js';

/** @typedef {'timeline' | 'scene' | 'clip' | 'base'} Layer */
/** @typedef {import('$lib/auth/client').GradeStack} GradeStack */
/** @typedef {import('./studio.svelte.js').Clip} Clip */
/** @typedef {import('./studio.svelte.js').Studio} Studio */

const label = (/** @type {string} */ id) => BUNDLES.find((b) => b.id === id)?.label ?? id;

/** the lanes, top to bottom, each in its own colour (its bar on the timeline, its mark in the aside) @type {{ id: Layer, label: string, what: string, hue: string }[]} */
export const LAYERS = [
	{ id: 'timeline', label: label('timeline'), what: 'the whole timeline', hue: '#a184f0' },
	{ id: 'scene', label: label('scene'), what: 'every shot of the scene', hue: '#5f9ff0' },
	{ id: 'clip', label: label('clip'), what: 'this shot', hue: '#e2a83e' },
	{ id: 'base', label: label('base'), what: 'this shot', hue: '#3fb79a' }
];

/** Does the layer belong to a shot (base, clip), a scene, or the whole timeline? @param {Layer} l */
export const ofShot = (l) => l === 'base' || l === 'clip';

/**
 * A layer's stack: a shot's (base, clip), its scene's, the timeline's; null when it has none.
 * @param {Studio} s @param {Layer} layer @param {Clip | null | undefined} c @returns {GradeStack | null}
 */
export function stackOf(s, layer, c) {
	const g = s.current?.grade ?? {};
	if (layer === 'base' || layer === 'clip') return c?.stacks?.[layer] ?? null;
	if (layer === 'scene') return c?.script?.scene ? (g.scenes?.[c.script.scene] ?? null) : null;
	if (layer === 'timeline') return g.timeline ?? null;
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
	} else if (layer === 'timeline') {
		if (st) g.timeline = st;
		else delete g.timeline;
	}
	s.setMeta({ grade: g });
}

/** a stack in one line (the lanes) @param {GradeStack | null | undefined} st */
export const stackLine = (st) => stackText(st);

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
