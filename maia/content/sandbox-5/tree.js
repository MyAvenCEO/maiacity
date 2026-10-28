/**
 * SANDBOX 6 · THE BUILDING TREE — the valley's chains, a row each, from the land to what they are for, every stage with
 * its recipes of the crafting engine (./rules.js RECIPES), in units (a tonne, a MWh, a gold): what building it or
 * growing to it takes, what standing takes a week (its upkeep, always in gold, and the energy it uses), and what it
 * makes a week, working all its land gives it. The hex each
 * chain stands on leads its row. Energy has its rows too (the village center's stages and its geothermal plant, every
 * dome's solar panels), and the homes theirs: one dome that grows through eight sizes. Read from the rules, so it always shows the
 * game as it is. The page draws it (./Tree.svelte).
 */
import { BIOMES, BUILDINGS, CENTRE, ENERGY, HOUSE_BEDS, HOUSE_KEEP, HOUSE_SIZE, HOUSE_UP, LAND, LOAD_T, RECIPES, ROUTE_T_KM, SOLAR_BEDS, WARES, aWeek, buildIn, weekOf } from './rules.js';

/** loads, as tonnes @param {Record<string, number>} loads */
const tonnes = (loads) => Object.fromEntries(Object.entries(loads).map(([w, n]) => [w, n * LOAD_T]));

/**
 * @typedef {{ in: Record<string, number>, out: Record<string, number> }} Craft
 * @typedef {{ label: string, level: number, does: string, build: Craft, keep: Craft, use: Craft, make: Craft }} Stage
 * @typedef {{ type: string, hex: string, land: string, landNote: string, stages: Stage[], ware: string, wares: string[], use: string, useNote: string }} Chain
 */

/** what each ware is for */
const FOR = /** @type {Record<string, [string, string]>} */ ({
	plank: ['Domes', 'their glulam struts'],
	steel: ['Domes', 'their steel joints'],
	glass: ['Domes', 'the glazing of a small one, up to 8 beds'],
	solar: ['Domes', 'the glazing from 16 beds, that makes their power'],
	clay: ['Trade routes', `${ROUTE_T_KM.toLocaleString('en-US')} a km`]
});

/** the chains of wares, a row each: wood, steel, glass (and solar panels) and fired clay, every stage with its build,
 * and its keep, use and make a week */
export const CHAINS = /** @type {Chain[]} */ (
	['woodcutter', 'ironmine', 'glassworks', 'clayworks'].map((type) => {
		const r = RECIPES[type], ware = /** @type {string} */ (BUILDINGS[type].out), land = LAND[/** @type {keyof typeof LAND} */ (r.land)];
		// every ware its stages make: the glass chain's last makes solar panels
		const made = [...new Set(r.stages.flatMap((x) => Object.keys(x.make.out)))];
		const wares = made.length ? made : [ware];
		return {
			type,
			hex: `${BIOMES[/** @type {keyof typeof BIOMES} */ (r.biome)].label} hex`,
			land: land.label,
			landNote: land.about,
			ware,
			wares,
			use: FOR[ware][0],
			useNote: wares.map((w) => (wares.length > 1 ? `${WARES[w].label.toLowerCase()}: ${FOR[w][1]}` : FOR[w][1])).join('; '),
			stages: r.stages.map((x, k) => ({
				label: x.label,
				level: k + 1,
				does: x.does ?? '',
				build: x.build,
				keep: x.keep,
				use: x.use,
				make: weekOf(type, k + 1)
			}))
		};
	})
);

/** the village center's stages (./rules.js CENTRE): a logistics hub, then the great village center with its
 * geothermal plant and its great dome's solar panels; each with its build, its upkeep a week in gold, the energy its
 * hall, storehouse and routes use a week, and what its plant and panels make a week */
export const CENTRES = CENTRE.map((x, k) => ({ label: x.label, level: k + 1, does: x.does, mw: (x.plant * ENERGY.wellKw) / 1000, sun: x.sun > 0, build: x.build, keep: x.keep, use: x.use, make: x.make }));
/** the solar panels of every dome from 16 beds, a bed's share a week over the year, and every dome's climate's */
export const SUN = aWeek({ make: ENERGY.sunBed / 1000, climate: ENERGY.climateBed / 1000 });

/** a home's sizes: one dome that grows, its beds; what growing to it takes (in tonnes and its builders' energy); its
 * upkeep a week in gold; the energy its people and its climate use a week, every bed taken; and what its solar panels
 * make a week over the year, from 16 beds (a dome of glass makes none) */
export const HOMES = HOUSE_BEDS.map((beds, k) => ({
	label: HOUSE_SIZE[k],
	level: k + 1,
	beds,
	build: { in: buildIn(tonnes(/** @type {Record<string, number>} */ (k ? HOUSE_UP[k - 1] : BUILDINGS.house.cost))), out: {} },
	keep: { in: { gold: HOUSE_KEEP[k] }, out: {} },
	use: { in: aWeek({ energy: (beds * (ENERGY.home + ENERGY.climateBed)) / 1000 }), out: {} },
	make: { in: {}, out: beds >= SOLAR_BEDS ? aWeek({ energy: (beds * ENERGY.sunBed) / 1000 }) : {} }
}));

/** every stage a building of a type grows through, with its recipes, as the tree shows them: a home's sizes, the
 * village center's stages, a factory's chain; null for one that does not grow. Every building's card reads them too
 * @param {string} type */
export const stagesOf = (type) => (type === 'house' ? HOMES : type === 'centre' ? CENTRES : (CHAINS.find((c) => c.type === type)?.stages ?? null));

/** a ware's colour */
export const colorOf = (/** @type {string} */ w) => WARES[w]?.color ?? '#ccc';
