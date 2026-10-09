// @ts-nocheck — plain JS game state, kept loose on purpose
// The valley as a crafter. Everything is a resource, and every change to resources is a recipe: n inputs in, a stage
// in between, m outputs out, once per time unit. Growing a good, drinking, eating and minting HEARTS are recipes; each
// resource carries its own decay rule (food rots, HEARTS melt, a body's reserves fall when a recipe goes short).
// Both lists are plain JSON, rebuilt from the live RULES, so the World view can show exactly what the valley runs on.

import { RULES, GOODS, GOOD_LABEL, NEED, ROT } from './rules.js';

/**
 * A resource: where an aven holds it, its bounds, and its decay per night (a share of what is held).
 * @typedef {{ id: string, label: string, unit: string, held: 'store' | 'wallet' | 'body', decay: number, min?: number, max?: number, dies_at?: number, note?: string }} Resource
 *
 * A recipe, run by every living aven (`by: 'aven'`) or on every land that grows its output (`by: 'land'`), once `per`
 * time unit. `in` is taken from what the aven holds; if all of it is there, `out` is added; for every unit missing,
 * `short` is added instead (a loss, e.g. of a body reserve). `stage` is what happens in between; `vary` how a harvest
 * swings; `chance` how often it runs at all.
 * @typedef {{ id: string, label: string, by: 'aven' | 'land', per: 'night', in: Record<string, number>, out: Record<string, number | [number, number]>, short?: Record<string, number>, stage?: { name: string, nights: number }, chance?: number, vary?: any, note?: string }} Recipe
 */

/** health lost per missing unit, so that with none at all an aven lives through `days` days and dies the night after */
function hurtPer(need, days) {
	return need ? Math.round((100 / (need * (days + 0.5))) * 1000) / 1000 : 0;
}

/** every resource in the valley @returns {Resource[]} */
export function RESOURCES() {
	return [
		...GOODS.map((g) => ({ id: g, label: GOOD_LABEL[g], unit: 'unit', held: 'store', decay: ROT[g], note: ROT[g] ? `${Math.round(ROT[g] * 100)}% of a store rots each night` : 'keeps for ever' })),
		{ id: 'HEARTS', label: 'HEARTS', unit: 'HEART', held: 'wallet', decay: Math.round((RULES.decay / 100 / 365) * 1e7) / 1e7, note: `${RULES.decay}% a year, charged nightly` },
		{ id: 'water_reserve', label: 'Water reserve', unit: 'point', held: 'body', decay: 0, min: 0, max: 100, dies_at: 0, note: 'falls only when drinking goes short' },
		{ id: 'food_reserve', label: 'Food reserve', unit: 'point', held: 'body', decay: 0, min: 0, max: 100, dies_at: 0, note: 'falls only when eating goes short' }
	];
}

/** every recipe, in the order a night runs them @returns {Recipe[]} */
export function RECIPES() {
	const foods = GOODS.filter((g) => g !== 'water');
	const foodNeed = foods.reduce((n, g) => n + NEED[g], 0);
	const swing = RULES.swing / 100;
	return [
		{ id: 'drink', label: 'Drink', by: 'aven', per: 'night', in: { water: NEED.water }, out: { water_reserve: RULES.mendWater }, short: { water_reserve: -hurtPer(NEED.water, RULES.waterDays) }, note: `with no water at all an aven lives ${RULES.waterDays} days` },
		{ id: 'eat', label: 'Eat', by: 'aven', per: 'night', in: Object.fromEntries(foods.map((g) => [g, NEED[g]])), out: { food_reserve: RULES.mendFood }, short: { food_reserve: -hurtPer(foodNeed, RULES.foodDays) }, note: `with no food at all an aven lives ${RULES.foodDays} days` },
		{ id: 'mint', label: 'Mint HEARTS', by: 'aven', per: 'night', in: {}, out: { HEARTS: RULES.mint }, note: 'for every living aven' },
		...GOODS.map((g) => ({
			id: `grow_${g}`,
			label: g === 'water' ? 'Draw WATER from the well' : `Grow ${GOOD_LABEL[g]}`,
			by: 'land',
			per: 'night',
			in: {},
			out: { [g]: 'capacity' },
			stage: { name: g === 'water' ? 'filling' : 'growing', nights: 1 },
			vary: {
				normal: [Math.round((1 - swing) * 100) / 100, Math.round((1 + swing) * 100) / 100],
				bad: { chance: RULES.badChance / 100, of: [0.3, 0.6] },
				rich: { chance: RULES.richChance / 100, of: [1.3, 1.6] },
				...(g === 'water' ? { dry_spell: { of: [Math.max(0, RULES.dryWells / 100 - 0.15), RULES.dryWells / 100 + 0.15] } } : {})
			},
			note: "capacity: the land's own units a night, dealt out when the valley is made"
		})),
		{ id: 'rain', label: 'Catch rain', by: 'land', per: 'night', in: {}, out: { water: [1, RULES.rainMax] }, chance: RULES.rainChance / 100, note: 'never in a dry spell' }
	];
}

/** where an aven keeps a resource */
function pot(a, res) {
	if (res === 'HEARTS') return [a, 'hearts'];
	if (res === 'water_reserve') return [a.body, 'water'];
	if (res === 'food_reserve') return [a.body, 'food'];
	return [a.stock, res];
}
const BOUNDS = { water_reserve: [0, 100], food_reserve: [0, 100] };

function add(a, res, v) {
	const [o, k] = pot(a, res);
	const [lo, hi] = BOUNDS[res] ?? [0, Infinity];
	o[k] = Math.min(hi, Math.max(lo, o[k] + v));
}

/**
 * run one recipe for one aven: take its inputs, then add its outputs, or its shortfall for every unit missing.
 * @returns {{ took: Record<string, number>, missing: Record<string, number> }}
 */
export function craft(recipe, a) {
	const took = {},
		missing = {};
	let short = 0;
	for (const [res, amt] of Object.entries(recipe.in)) {
		const [o, k] = pot(a, res);
		const t = Math.min(amt, Math.max(0, o[k]));
		o[k] -= t;
		took[res] = t;
		if (t < amt) {
			missing[res] = amt - t;
			short += amt - t;
		}
	}
	if (!short) for (const [res, v] of Object.entries(recipe.out)) add(a, res, v);
	else for (const [res, v] of Object.entries(recipe.short ?? {})) add(a, res, v * short);
	return { took, missing };
}

/**
 * each resource's own decay, for one aven, one night: whole units for goods (rounded by chance), cents for HEARTS.
 * `adjust(resource, held, lost)`, when given, may change what is lost (card code), every resource, even one that keeps.
 * @returns {Record<string, number>} what was lost
 */
export function decayAll(a, rand, adjust = null) {
	const lost = {};
	for (const r of RESOURCES()) {
		if (!r.decay && !adjust) continue;
		const [o, k] = pot(a, r.id);
		const x = o[k] * r.decay;
		let v = !r.decay ? 0 : r.held === 'store' ? Math.min(o[k], Math.floor(x) + (rand() < x % 1 ? 1 : 0)) : x;
		if (adjust) v = adjust(r, o[k], v);
		if (!v) continue;
		o[k] -= v;
		lost[r.id] = v;
	}
	return lost;
}
