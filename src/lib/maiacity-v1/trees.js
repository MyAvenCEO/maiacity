// @ts-nocheck — plain JS
/**
 * MaiaCity V1's first trees (Samuel 2026-10-14): the seed each newcomer brings from home in their backpack, planted
 * at a spot they choose outside the core circle, named after them. It grows only when it is watered: each watering
 * (once a game month, one a real day) walks it one game month (28 game days) on through its plant's own stages from
 * the Plants ($lib/plants), from the seed; a month without water, it waits. Once it has borne its first crop it
 * flowers and fruits again every game year.
 */
import { plantAt } from '$lib/plants/index.js';
import { DAYS_A_MONTH, MONTHS_A_YEAR, SEEDLINGS, monthsAt } from '../../../game/maiacity-v1/engine.js';

const YEAR = DAYS_A_MONTH * MONTHS_A_YEAR;

/** the stage (0 … 9, between them on the way) of a plant at an age in days: its stages' days, straight between them */
function stageOf(stages, day) {
	const last = stages.length - 1;
	if (day >= stages[last].day) return last;
	let i = 0;
	while (i < last - 1 && day >= stages[i + 1].day) i++;
	return i + (day - stages[i].day) / Math.max(1, stages[i + 1].day - stages[i].day);
}

/** a plant's stage at an age in days: after its first crop it flowers again each year (stage 5 on), its fruit hanging
 *  three weeks ripe, then it stands leafy until the next */
export function stageAt(p, age) {
	const bloom = p.stages[5].day, ripe = p.stages[p.stages.length - 1].day;
	if (age <= ripe) return stageOf(p.stages, age);
	const y = (age - bloom) % YEAR;
	return y <= ripe - bloom ? stageOf(p.stages, bloom + y) : y <= ripe - bloom + 21 ? p.stages.length - 1 : 4.99;
}

/** a tree as it stands now: its plant, its age in game days (its watered months, from the seed), its stage, the stage's
 *  name, where it stands, and whether it may be watered now (a new game month since its last watering) */
export function treeNow(view, tree, now) {
	const p = plantAt(tree.plant, tree.v ?? undefined) ?? plantAt(tree.plant);
	const seed = tree.name || 'maia';
	const grown = tree.grown ?? 0;
	const age = p.stages[0].day + grown * DAYS_A_MONTH;
	const stage = stageAt(p, age);
	const due = Math.floor(monthsAt(view, now)) > (tree.watered ?? Infinity);
	return { plant: p, seed, age, grown, stage, x: tree.x ?? 0, z: tree.z ?? 30, due, label: SEEDLINGS.find((x) => x.id === tree.plant)?.label ?? p.label, now: p.stages[Math.floor(stage)].name };
}
