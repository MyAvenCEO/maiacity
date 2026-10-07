/**
 * SANDBOX 6 · THE BUILDING TREE — the valley's chains, a row each, from the land to what they are for, every stage with
 * its three recipes of the crafting engine (./rules.js RECIPES), in units (a tonne, a MWh): what building it or growing
 * to it takes, what standing takes a year, and what it makes a year, working all its land gives it. The hex each
 * chain stands on leads its row. Energy has its rows too (the village center's geothermal stages, every dome's solar
 * cells), and the homes theirs: one dome that grows through eight sizes. Read from the rules, so it always shows the
 * game as it is. The page draws it (./Tree.svelte).
 */
import { BIOMES, BUILDINGS, CENTRE, ENERGY, HOUSE_BEDS, HOUSE_SIZE, HOUSE_UP, LAND, LOAD_T, RECIPES, ROUTE_T_KM, WARES, buildIn, yearOf } from './rules.js';
import { NEEDS } from './market.js';

/** loads, as tonnes @param {Record<string, number>} loads */
const tonnes = (loads) => Object.fromEntries(Object.entries(loads).map(([w, n]) => [w, n * LOAD_T]));

/**
 * @typedef {{ in: Record<string, number>, out: Record<string, number> }} Craft
 * @typedef {{ label: string, level: number, does: string, build: Craft, keep: Craft, make: Craft }} Stage
 * @typedef {{ type: string, hex: string, land: string, landNote: string, stages: Stage[], ware: string, use: string, useNote: string }} Chain
 */

/** what each ware is for */
const FOR = /** @type {Record<string, [string, string]>} */ ({
	plank: ['Domes', 'their glulam struts'],
	steel: ['Domes', 'their steel joints'],
	glass: ['Domes', 'their glazing and solar cells'],
	clay: ['Trade routes', `${ROUTE_T_KM.toLocaleString('en-US')} a km`]
});

/** the chains of wares, a row each: wood, steel, glass and fired clay, every stage with its build, keep and a year's make */
export const CHAINS = /** @type {Chain[]} */ (
	['woodcutter', 'ironmine', 'glassworks', 'clayworks'].map((type) => {
		const r = RECIPES[type], ware = /** @type {string} */ (BUILDINGS[type].out), land = LAND[/** @type {keyof typeof LAND} */ (r.land)];
		return {
			type,
			hex: `${BIOMES[/** @type {keyof typeof BIOMES} */ (r.biome)].label} hex`,
			land: land.label,
			landNote: land.about,
			ware,
			use: FOR[ware][0],
			useNote: FOR[ware][1],
			stages: r.stages.map((x, k) => ({
				label: x.label,
				level: k + 1,
				does: x.does ?? '',
				build: x.build,
				keep: x.keep,
				make: yearOf(type, k + 1)
			}))
		};
	})
);

/** the village center's stages (./rules.js CENTRE): a logistics hub, then the great village center with its first
 * geothermal wells, then two more producers each; each with its build, what it keeps a year (its upkeep, and its hall's,
 * storehouse's and routes' energy) and what its wells make a year */
export const CENTRES = CENTRE.map((x, k) => ({ label: x.label, level: k + 1, does: x.does, mw: (x.wells * ENERGY.wellKw) / 1000, build: x.build, keep: x.keep, make: x.make }));
/** every dome's solar cells, a bed's share a year, and its climate's */
export const SUN = { make: ENERGY.sunBed / 1000, climate: ENERGY.climateBed / 1000 };

/** a home's sizes: one dome that grows, its beds; what growing to it takes (in tonnes and its builders' energy); what
 * it keeps a year (its upkeep, every bed taken, and its people's and climate's energy); and what its solar cells make */
export const HOMES = HOUSE_BEDS.map((beds, k) => ({
	label: HOUSE_SIZE[k],
	level: k + 1,
	beds,
	build: { in: buildIn(tonnes(/** @type {Record<string, number>} */ (k ? HOUSE_UP[k - 1] : BUILDINGS.house.cost))), out: {} },
	keep: { in: { ...tonnes(Object.fromEntries(Object.entries(NEEDS).map(([w, n]) => [w, n * beds]))), energy: (beds * (ENERGY.home + ENERGY.climateBed)) / 1000 }, out: {} },
	make: { in: {}, out: { energy: (beds * ENERGY.sunBed) / 1000 } }
}));

/** a ware's colour */
export const colorOf = (/** @type {string} */ w) => WARES[w]?.color ?? '#ccc';
