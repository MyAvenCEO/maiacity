// @ts-nocheck — plain JS
/**
 * MaiaCity V1's first trees (Samuel 2026-10-13): the seedling each newcomer takes home from the village shed, planted
 * after the tent, named after them, and growing on the game clock (one game month a real day, 28 game days to it)
 * through its plant's own stages from the Plants ($lib/plants). A seedling is taken a few centimetres high; from
 * then on its age in game days walks its stages, and once it has borne its first crop it flowers and fruits again
 * every game year.
 */
import * as THREE from 'three';
import { plantAt } from '$lib/plants/index.js';
import { DAYS_A_MONTH, MONTHS_A_YEAR, SEEDLINGS, monthsAt } from '../../../game/maiacity-v1/engine.js';

/** how high a seedling stands when it is taken from the shed (m) */
export const SEEDLING_HEIGHT = 0.05;
const YEAR = DAYS_A_MONTH * MONTHS_A_YEAR;

const heights = new Map();
/** the stage (0 … 9, between them on the way) a plant stands SEEDLING_HEIGHT high at, found by halving */
export function startStage(id, seed) {
	const k = `${id}:${seed}`;
	if (heights.has(k)) return heights.get(k);
	const p = plantAt(id);
	const tall = (st) => new THREE.Box3().setFromObject(p.grow(st, seed)).max.y;
	let lo = 1, hi = 3;
	for (let i = 0; i < 14; i++) {
		const mid = (lo + hi) / 2;
		if (tall(mid) < SEEDLING_HEIGHT) lo = mid;
		else hi = mid;
	}
	heights.set(k, hi);
	return hi;
}

/** a plant's age in days at a stage, and the stage at an age: its stages' days, straight between them */
const dayOf = (stages, st) => {
	const i = Math.min(stages.length - 2, Math.floor(st));
	return stages[i].day + (stages[i + 1].day - stages[i].day) * (st - i);
};
function stageOf(stages, day) {
	const last = stages.length - 1;
	if (day >= stages[last].day) return last;
	let i = 0;
	while (i < last - 1 && day >= stages[i + 1].day) i++;
	return i + (day - stages[i].day) / Math.max(1, stages[i + 1].day - stages[i].day);
}

/** a tree as it stands now: its plant, its age in game days, its stage, the stage's name; after its first crop it
 *  flowers again each year (stage 5 on), its fruit hanging three weeks ripe, then it stands leafy until the next */
export function treeNow(view, tree, now) {
	const p = plantAt(tree.plant, tree.v ?? undefined) ?? plantAt(tree.plant);
	const seed = tree.name || 'maia';
	const st0 = startStage(tree.plant, seed);
	const age = dayOf(p.stages, st0) + Math.max(0, monthsAt(view, now) - tree.months) * DAYS_A_MONTH;
	const bloom = p.stages[5].day, ripe = p.stages[p.stages.length - 1].day;
	let stage = stageOf(p.stages, age);
	if (age > ripe) {
		const y = (age - bloom) % YEAR;
		stage = y <= ripe - bloom ? stageOf(p.stages, bloom + y) : y <= ripe - bloom + 21 ? p.stages.length - 1 : 4.99;
	}
	return { plant: p, seed, age, stage, label: SEEDLINGS.find((x) => x.id === tree.plant)?.label ?? p.label, now: p.stages[Math.floor(stage)].name };
}

/** in game months, from a seedling, until each of its milestones: a sapling, a young tree, its first crop */
export function milestones(id, seed = 'maia') {
	const p = plantAt(id);
	const from = dayOf(p.stages, startStage(id, seed));
	const months = (i) => Math.max(1, Math.round((p.stages[i].day - from) / DAYS_A_MONTH));
	return { sapling: months(3), young: months(4), fruit: months(p.stages.length - 1) };
}
