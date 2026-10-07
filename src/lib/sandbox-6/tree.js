/**
 * SANDBOX 6 · THE BUILDING TREE — the valley's chains, a row each, from the land to what they are for: the land a
 * building works, every stage it grows through (what it makes and uses a year, and what growing to it costs), the ware
 * it makes, and what that ware builds. Energy has its rows too (the village center's geothermal stages, every dome's
 * solar cells), and the homes theirs: one dome that grows through eight sizes. Read from the rules (./rules.js), so it
 * always shows the game as it is. The page draws it (./Tree.svelte).
 */
import { BUILDINGS, ENERGY, FIELD_HA, GROWS, HOUSE_BEDS, HOUSE_GLASS, HOUSE_SIZE, HOUSE_UP, ROUNDS_YEAR, ROUTE_T_KM, tonnesYear } from './rules.js';
import { WELL_EUR } from './market.js';
import { YEAR } from './food.js';

/**
 * @typedef {{ label: string, level: number, t: number, kwh: number, cost: Record<string, number> }} Stage
 * @typedef {{ type: string, land: string, landNote: string, stages: Stage[], ware: string, use: string, useNote: string }} Chain
 */

/** the chains of wares, a row each: wood, steel and fired clay */
export const CHAINS = /** @type {Chain[]} */ (
	[
		{ type: 'woodcutter', land: 'Forest hex', landNote: `${FIELD_HA} ha of hemp, bamboo and woods`, ware: 'plank', use: 'Domes', useNote: 'their glulam struts' },
		{ type: 'ironmine', land: 'Iron hex', landNote: `${ROUNDS_YEAR.ironmine * 25} t of iron ore a year`, ware: 'steel', use: 'Domes', useNote: 'their steel joints' },
		{ type: 'clayworks', land: 'Meadow hex', landNote: 'clay under the grass', ware: 'clay', use: 'Trade routes', useNote: `${ROUTE_T_KM.toLocaleString('en-US')} t a km` }
	].map((c) => ({
		...c,
		stages: GROWS[c.type].levels.map((l, k) => ({
			label: l.label,
			level: k + 1,
			t: tonnesYear(c.type, k + 1),
			kwh: tonnesYear(c.type, k + 1) * ENERGY.perT[c.type][k],
			cost: k ? GROWS[c.type].up[k - 1] : BUILDINGS[c.type].cost
		}))
	}))
);

/** the village center's geothermal stages: its power, what it makes a year, and what drilling it costs (the first
 * comes with your first village, and with every village you found for that much) */
export const GEOTHERMAL = Array.from({ length: ENERGY.wellsMost }, (_, k) => ({
	label: k ? `Geothermal ${k + 1}` : 'Village center',
	level: k + 1,
	mw: ((k + 1) * ENERGY.wellKw) / 1000,
	kwh: (k + 1) * ENERGY.wellKw * 24 * YEAR * ENERGY.uptime,
	eur: WELL_EUR
}));

/** a home's sizes: one dome that grows, its beds, what growing to it costs in loads and glass, and what its solar
 * cells make a year */
export const HOMES = HOUSE_BEDS.map((beds, k) => ({
	label: HOUSE_SIZE[k],
	level: k + 1,
	beds,
	cost: /** @type {Record<string, number>} */ (k ? HOUSE_UP[k - 1] : BUILDINGS.house.cost),
	glass: HOUSE_GLASS[k],
	sun: beds * ENERGY.sunBed
}));
