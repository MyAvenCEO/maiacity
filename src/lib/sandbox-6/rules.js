/**
 * SANDBOX 6 · THE RULES — every ware, every building and what it makes, in one table.
 *
 * A valley economy in the spirit of the old settler games, without the war, its own names and its own numbers: wares lie at flags and
 * carriers bring them, one carrier to a road, from flag to flag, to whoever needs them. A building is a site until a
 * builder has used up what it is built of; then a worker moves in and it runs its chain. Four wares, short chains,
 * each one building that grows by stages, every stage a recipe of the crafting engine (RECIPES):
 *
 *   forest hex: logs → forester, woodcutter, sawmill, timber works → planks
 *   iron hex: iron ore → iron mine, furnace, steelworks → steel
 *   meadow hex: raw clay → clay pit, kiln, block works → fired clay
 *   sand hex: sand → sand pit, glassworks, solar panel works → glass
 *
 * One unit for everything, a real one (UNITS): a tonne of a ware, a tonne of food, a m³ of water, a MWh of energy, and a
 * gold, the world market's real prices read at 1,000 € a gold (the game shows gold only). Planks are the glulam struts
 * of the domes, steel their joints, glass their glazing with its solar cells, fired clay the voussoirs of the trade
 * routes. A dome is built as the real one is (DOME_T), of all three from your stores.
 *
 * Energy is not a ware but a flow (ENERGY): every village center is also a geothermal power plant, every dome makes
 * some with its solar glass, and people and factories use it.
 *
 * Food and water are not wares: every house's hex grows food and its roof catches rain into the tanks, and what a
 * village lacks it buys from the world market (./food.js).
 *
 * Every building stands in a settlement (./plots.js): a house and two factory domes round one flag. Houses are where
 * settlers live — 2, then twice as many each time they are enlarged, up to 248 — so a village has only as many people
 * as it has beds.
 * Seven settlements make a village: six round its middle, where the village center stands — its storehouse, its
 * market and its hall in one, holding everything the village has. Roads above ground are for walking within a
 * village; village centers are joined by trade routes under the ground (./market.js), your own to share wares
 * between your villages, and other cities' to trade with them. Your city grows a village at a time.
 *
 * Nobody fights here, and nothing is won: you grow your villages, keep every one fed, watered and housed with
 * something put by, and see how far the valley goes.
 *
 * Plain data: the simulation (./sim.js) and the page read it alike.
 */

import { YEAR } from './food.js';

/** @typedef {{ id: string, label: string, color: string }} Ware */

/** @type {Record<string, Ware>} */
export const WARES = {
	plank: { id: 'plank', label: 'Planks', color: '#e0b46a' },
	steel: { id: 'steel', label: 'Steel', color: '#8796a6' },
	clay: { id: 'clay', label: 'Fired clay', color: '#c4734f' },
	glass: { id: 'glass', label: 'Glass', color: '#9fd3e0' }
};
export const WARE_ORDER = Object.keys(WARES);

/**
 * What a hex is good for: meadow (farmland) is everywhere; forest, iron, sand (a sandy heath or a beach), stone and
 * water (a lake's or the sea's shore) are scarce. Every factory stands on the hex its land is on (RECIPES): wood on a
 * forest, steel on iron, fired clay on a meadow, where the clay lies under the grass, glass on sand.
 * A hex whose middle is under water (a lake's or the sea's) is 'lake', not land; bare mountain is 'mountain'. Read
 * from the land as the valley grew (./map.js).
 */
export const BIOMES = {
	meadow: { id: 'meadow', label: 'Meadow', color: '#9fc46a' },
	forest: { id: 'forest', label: 'Forest', color: '#2f6b3a' },
	stone: { id: 'stone', label: 'Stone', color: '#9a9a94' },
	iron: { id: 'iron', label: 'Iron', color: '#a35b3a' },
	sand: { id: 'sand', label: 'Sand', color: '#dcc893' },
	water: { id: 'water', label: 'Water', color: '#4aa3df' },
	mountain: { id: 'mountain', label: 'Mountain', color: '#8c8f96' },
	lake: { id: 'lake', label: 'Lake', color: '#3a7fb8' }
};

/** the land a node is */
export const GRASS = 0, WATER = 1, MOUNTAIN = 2, SAND = 3;
/** what a mountain node holds: 0 bare rock, 2 iron */
export const IRON = 2;

/** settlers a house holds at each size: one dome, larger each time it is enlarged */
export const HOUSE_BEDS = [2, 4, 8, 16, 32, 64, 128, 248];
/** a house's size as a word */
export const HOUSE_SIZE = ['Hut', 'Cottage', 'House', 'Great house', 'Hall', 'Great hall', 'Dome', 'Great dome'];
/** the largest a house gets: its size and its beds */
export const HOUSE_TOP = HOUSE_BEDS.length;
export const HOUSE_MOST = HOUSE_BEDS[HOUSE_TOP - 1];
/**
 * The units everything is counted in, a real one each: what one of it is. The stores and the buses count wares in
 * truckloads of 5 t (LOAD_T), and the page shows them in tonnes; euros never show, they are only how the world
 * market's real prices are read into gold.
 */
export const UNITS = {
	ware: '1 t',
	food: '1 t, 1,000 kg',
	water: '1 m³, 1,000 L',
	energy: '1 MWh',
	gold: '1,000 € of real prices'
};
/** a load of any ware, in tonnes: a truckload, what a bus carries and the stores count */
export const LOAD_T = 5;
/**
 * The real great dome of 248, 150 m across (our engineering research, 2026-10-07), in tonnes: its larch and Douglas
 * glulam struts, its finished steel joints (cast hubs, screws, brackets) and its laminated double glazing with its
 * see-through solar cells.
 */
export const DOME_T = { plank: 1500, steel: 200, glass: 1000 };
/**
 * What a dome of so many beds is built of, in tonnes. Its floor and roof grow with its beds, and so does its glass; its
 * struts and joints grow a little faster, as a wider dome needs stouter ones (to the 1.25th power of its beds, about
 * 3.6 t of struts for a hut of 2, 13.5 m across).
 * @param {number} beds
 */
export const domeOf = (beds) => {
	const r = beds / HOUSE_MOST;
	return { plank: DOME_T.plank * r ** 1.25, steel: DOME_T.steel * r ** 1.25, glass: DOME_T.glass * r };
};
/** a dome's struts, joints and glass in loads, rounded up @param {number} beds */
const domeLoads = (beds) => {
	const t = domeOf(beds);
	return { plank: Math.ceil(t.plank / LOAD_T), steel: Math.ceil(t.steel / LOAD_T), glass: Math.ceil(t.glass / LOAD_T) };
};
/** what of each ware the larger dome takes beyond the smaller (none left out) @param {number} from @param {number} to */
const domeStep = (from, to) => {
	const a = from ? domeLoads(from) : { plank: 0, steel: 0, glass: 0 }, b = domeLoads(to);
	/** @type {Record<string, number>} */
	const step = {};
	for (const w of /** @type {const} */ (['plank', 'steel', 'glass'])) if (b[w] > a[w]) step[w] = b[w] - a[w];
	return step;
};
/** what enlarging a house to its next size costs, in loads of struts, joints and glass from your stores */
export const HOUSE_UP = HOUSE_BEDS.slice(1).map((n, k) => domeStep(HOUSE_BEDS[k], n));

/**
 * @typedef {object} BuildingType
 * @property {string} id
 * @property {string} label
 * @property {string} group which part of the build menu
 * @property {string} about one line
 * @property {Record<string, number>} cost what a builder uses up, in loads
 * @property {'centre'|'house'|'make'|'mine'|'gather'|'forester'|'village'} kind
 * @property {string} [worker] who works it
 * @property {string[][]} [inputs] each slot takes any one of its wares
 * @property {string} [out] the ware it makes
 * @property {number} [time] seconds for one ware (made inside), or one job out in the land
 * @property {number} [rest] seconds between jobs out in the land
 * @property {number} [range] how far its worker goes out
 * @property {number} [yield] how many of its ware one round of work makes (1 if not said)
 * @property {'mountain'|'grass'|'any'} [on] the land it stands on: grass by default, or rock, or either
 * @property {string} [ore] the ore a mine digs
 * @property {'meadow'|'forest'|'stone'|'iron'|'sand'|'water'} [biome] the only kind of hex it stands on (any hex if not said)
 * @property {number} [beds] settlers who live in it
 */

/** @type {Record<string, BuildingType>} */
export const BUILDINGS = {
	centre: { id: 'centre', label: 'Logistics hub', group: 'Homes', about: 'Founds a village in its middle hex: a small store dome, its storehouse and market — nobody lives here. Your first comes with your settlers, anywhere in the valley; every next one in the village next to one of yours, joined to it by a trade route under the ground, laid of fired clay voussoirs (what your stores lack, bought from the world market), and four settlers come to build its houses. It grows into its village’s great village center, the village’s power plant too: geothermal wells under it, drilled for gold, run day and night.', cost: {}, kind: 'centre' },
	house: { id: 'house', label: 'House', group: 'Homes', about: 'Founds a settlement: settlers live here, 2 at first, then twice as many each time you enlarge it, up to 248. A dome of glass on struts and steel joints, all three from your stores. Its two factory spots open once it stands.', cost: domeStep(0, HOUSE_BEDS[0]), kind: 'house' },
	woodcutter: { id: 'woodcutter', label: 'Forester', group: 'Basics', about: 'Your wood, in one building that grows: a forester plants young trees round it; upgraded, a woodcutter fells grown trees and plants a young one where each stood, then a sawmill and a timber works cut more planks from every tree. Build it on a forest hex.', cost: { plank: 2 }, kind: 'gather', biome: 'forest', worker: 'Forester', out: 'plank', time: 6, rest: 4, range: 10 },
	forester: { id: 'forester', label: 'Forester', group: '', about: 'Plants young trees nearby, on a forest hex; they grow in about two minutes. (Now the first level of the wood building.)', cost: { plank: 2 }, kind: 'forester', biome: 'forest', worker: 'Forester', time: 3, rest: 5, range: 8 },
	ironmine: { id: 'ironmine', label: 'Iron mine', group: 'Basics', about: 'Your steel, in one building that grows: an iron mine digs iron ore and smelts 5 t of steel joints from every 25 t; upgraded, a furnace makes 10 t and a steelworks 15 t from the same ore. Build it on an iron hex, by rust-red rock.', cost: { plank: 4 }, kind: 'mine', biome: 'iron', worker: 'Miner', inputs: [], out: 'steel', time: 8, on: 'any', ore: 'iron' },
	clayworks: { id: 'clayworks', label: 'Clay pit', group: 'Basics', about: 'Your fired clay, in one building that grows: a clay pit digs the clay under a meadow and fires bricks in a clamp; upgraded, an electric kiln fires twice as much, and a block works presses the hollow, interlocking voussoirs of the trade routes in five moulds and fires three times as much in a tunnel kiln, from the same pit. Build it on a meadow hex.', cost: { plank: 4 }, kind: 'mine', biome: 'meadow', worker: 'Brick maker', inputs: [], out: 'clay', time: 8, on: 'any' },
	glassworks: { id: 'glassworks', label: 'Sand pit', group: 'Basics', about: 'Your glass, in one building that grows: a sand pit digs and washes the glass sand of a sandy hex; upgraded, a glassworks melts it with soda and lime in an electric furnace and floats it into panes, and a solar panel works lays see-through solar cells into more of it, the glazing every dome makes its power with. Build it on a sand hex.', cost: { plank: 4 }, kind: 'mine', biome: 'sand', worker: 'Glass maker', inputs: [], out: 'glass', time: 8, on: 'any' },
	village: { id: 'village', label: 'Village center', group: '', about: 'A neighbour city’s village center.', cost: {}, kind: 'village' }
};


/** the build menu, in its groups */
export const GROUPS = ['Homes', 'Basics'];
export const MENU = GROUPS.map((g) => ({ group: g, types: Object.values(BUILDINGS).filter((b) => b.group === g) }));

/** buildings that hold their village as land: its center */
export const holdsLand = (/** @type {string} */ type) => type === 'centre' || type === 'village';


/**
 * A trade route under the ground, as the real one is built (our tunnel research, 2026-10-07): two arched cells for
 * 40 ft containers, laid dry of interlocking fired clay voussoirs with no steel and no mortar, about 36,000 t of them a
 * km. Its gravel bed, drains and clay seal are dug from its own trench. A world unit of the valley is about 32 m: a hex
 * about 660 m across, neighbouring village centers about 1.75 km apart.
 */
export const ROUTE_T_KM = 36000, UNIT_M = 32;

/** a hex's fields and woods, besides its food forest: 10 ha of hemp and bamboo, about 15 t a hectare a year */
export const FIELD_HA = 10, FIELD_T = 15;
/** what keeping homes up takes a year: a share of what they cost to build */
export const UPKEEP = 0.02;

/** what a factory takes from the land of its hex, a round at a time: in tonnes */
export const LAND = {
	logs: { label: 'logs', about: `its hex's ${FIELD_HA} ha of hemp, bamboo and woods, a tree of 15 t at a time` },
	ore: { label: 'iron ore', about: 'the iron round its rust-red rock' },
	loam: { label: 'raw clay', about: 'the clay under its meadow' },
	sand: { label: 'sand', about: 'the glass sand of its heath or beach, with soda and lime' }
};

/** energy a building takes to build, MWh a tonne of what it is built of (its cranes, welding and presses), and what
 * standing takes a year: a share of what it is built of, and MWh a tonne for its dome's lights, fans and controls */
export const BUILD_MWH_T = 0.1, KEEP_MWH_T = 0.2;

/**
 * @typedef {{ in: Record<string, number>, out: Record<string, number> }} Craft
 * @typedef {{ label: string, does?: string, build: Craft, keep: Craft, make: Craft, up: Record<string, number> }} Stage
 * @typedef {{ biome: string, land: string, rounds: number, stages: Stage[] }} Recipe
 */
/**
 * THE CRAFTING ENGINE — everything a building does is a recipe, what goes in and what comes out, in units (UNITS:
 * tonnes, and MWh of energy), and every stage of a factory has three:
 *   build — once, as it is built or grown to it: the wares its builders carry in and the energy they use, out comes the
 *           stage itself;
 *   keep  — a year, while it stands: the wares that keep it up (2% of what it is built of) and the energy its dome uses,
 *           nothing out;
 *   make  — a round of its work: what it takes from the land of its hex (LAND), as much a round as the land gives it a
 *           year (`rounds`), and energy from its village's grid; out comes its ware, to its stop a truckload (5 t) at a
 *           time. A ware it took would come from your stores by bus.
 * The simulation runs every factory on it (./sim.js `craft`, and its builders and upkeep), the cards and the building
 * tree show it (./tree.js).
 *
 * Wood: a hex's 10 ha of hemp, bamboo and woods give 150 t a year, ten trees of 15 t; a woodcutter cuts 5 t of planks
 * from each (by hand, the rest firewood), a sawmill 10 t, a timber works all of it, glued into glulam and scrimber,
 * using energy for its saws, presses and drying kilns. A forester only plants.
 * Steel: an iron hex gives ten rounds of 25 t of ore a year; an iron mine smelts 5 t of joints from each, a furnace 10 t
 * and a steelworks 15 t, the iron in 25 t of ore, in an electric furnace (about 3.6 to 5 MWh a tonne).
 * Fired clay: a meadow's pit gives 200 rounds of 20 t of raw clay a year; a clay pit fires 5 t of bricks from each in a
 * clamp of wood waste, a kiln 10 t with electricity, a block works 15 t of voussoirs in a tunnel kiln, about 10 t a day.
 * Glass: a sand hex gives 100 rounds a year; a sand pit digs and washes the sand and melts none yet, a glassworks melts
 * 12 t of sand, soda and lime into 10 t of float glass in an electric furnace (1.3 MWh a tonne), and a solar panel works
 * 18 t into 15 t, laying see-through solar cells into it (about 2 MWh a tonne in all).
 * @type {Record<string, Recipe>}
 */
export const RECIPES = /** @type {any} */ ({
	woodcutter: {
		biome: 'forest',
		land: 'logs',
		rounds: (FIELD_HA * FIELD_T) / 15,
		stages: [
			{ label: 'Forester', build: { plank: 10 }, make: {}, does: 'plants young trees round it and fells none' },
			{ label: 'Woodcutter', build: { plank: 10, steel: 5 }, make: { in: { logs: 15, energy: 0.1 }, out: { plank: 5 } } },
			{ label: 'Sawmill', build: { plank: 20, steel: 15 }, make: { in: { logs: 15, energy: 3.5 }, out: { plank: 10 } } },
			{ label: 'Timber works', build: { plank: 30, steel: 20 }, make: { in: { logs: 15, energy: 7.5 }, out: { plank: 15 } } }
		]
	},
	ironmine: {
		biome: 'iron',
		land: 'ore',
		rounds: 10,
		stages: [
			{ label: 'Iron mine', build: { plank: 20 }, make: { in: { ore: 25, energy: 25 }, out: { steel: 5 } } },
			{ label: 'Furnace', build: { plank: 20, steel: 10 }, make: { in: { ore: 25, energy: 42 }, out: { steel: 10 } } },
			{ label: 'Steelworks', build: { plank: 30, steel: 15 }, make: { in: { ore: 25, energy: 54 }, out: { steel: 15 } } }
		]
	},
	clayworks: {
		biome: 'meadow',
		land: 'loam',
		rounds: 200,
		stages: [
			{ label: 'Clay pit', build: { plank: 20 }, make: { in: { loam: 20, energy: 0.05 }, out: { clay: 5 } } },
			{ label: 'Kiln', build: { plank: 20, steel: 10 }, make: { in: { loam: 20, energy: 10 }, out: { clay: 10 } } },
			{ label: 'Block works', build: { plank: 30, steel: 15 }, make: { in: { loam: 20, energy: 7.5 }, out: { clay: 15 } } }
		]
	},
	glassworks: {
		biome: 'sand',
		land: 'sand',
		rounds: 100,
		stages: [
			{ label: 'Sand pit', build: { plank: 20 }, make: {}, does: 'digs and washes glass sand and melts none yet' },
			{ label: 'Glassworks', build: { plank: 30, steel: 15 }, make: { in: { sand: 12, energy: 13 }, out: { glass: 10 } } },
			{ label: 'Solar panel works', build: { plank: 40, steel: 25 }, make: { in: { sand: 18, energy: 30 }, out: { glass: 15 } } }
		]
	}
});
/** what a building of so many tonnes takes to build: its wares, and its builders' energy @param {Record<string, number>} wares */
export const buildIn = (wares) => ({ ...wares, energy: Object.values(wares).reduce((s, t) => s + t, 0) * BUILD_MWH_T });
/** what standing takes a year, of a building of so many tonnes all told @param {Record<string, number>} built */
export const keepIn = (built) => ({ ...Object.fromEntries(Object.entries(built).map(([w, t]) => [w, t * UPKEEP])), energy: Object.values(built).reduce((s, t) => s + t, 0) * KEEP_MWH_T });
// each stage's three recipes in full: its build (its wares in tonnes, with its builders' energy; and in loads for the
// builders, `up`), its keep (of everything it is built of by then) and its make
for (const [type, r] of Object.entries(RECIPES)) {
	/** @type {Record<string, number>} */
	const built = {};
	for (const x of r.stages) {
		const wares = /** @type {Record<string, number>} */ (/** @type {any} */ (x).build);
		x.up = Object.fromEntries(Object.entries(wares).map(([w, t]) => [w, Math.ceil(t / LOAD_T)]));
		for (const [w, t] of Object.entries(wares)) built[w] = (built[w] ?? 0) + t;
		x.build = { in: buildIn(wares), out: {} };
		x.keep = { in: keepIn(built), out: {} };
		x.make = { in: x.make.in ?? {}, out: x.make.out ?? {} };
	}
	BUILDINGS[type].cost = r.stages[0].up;
}
/** a factory's stage at a level (1 for the first) @param {string} type @param {number} level */
export const recipe = (type, level) => RECIPES[type]?.stages[Math.max(1, level) - 1];
/** loads of its ware a factory makes from a round at a stage @param {string} type @param {number} level */
export const loadsRound = (type, level) => Object.values(recipe(type, level)?.make.out ?? {}).reduce((s, t) => s + t, 0) / LOAD_T;
/** a stage's make a year, working all its land gives it: what it takes and makes, in units @param {string} type @param {number} level */
export const yearOf = (type, level) => {
	const r = recipe(type, level), n = RECIPES[type]?.rounds ?? 0;
	const scale = (/** @type {Record<string, number>} */ m) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, v * n]));
	return { in: scale(r?.make.in ?? {}), out: scale(r?.make.out ?? {}) };
};
/** tonnes of its ware a factory makes a year at a stage @param {string} type @param {number} level */
export const tonnesYear = (type, level) => Object.values(yearOf(type, level).out).reduce((s, t) => s + t, 0);
/** rounds a factory's land gives it a year */
export const ROUNDS_YEAR = /** @type {Record<string, number>} */ (Object.fromEntries(Object.entries(RECIPES).map(([k, r]) => [k, r.rounds])));
/** the buildings that grow by upgrades, besides houses: their stages and what growing to each next one costs */
export const GROWS = /** @type {Record<string, { levels: Stage[], up: Record<string, number>[] }>} */ (
	Object.fromEntries(Object.entries(RECIPES).map(([k, r]) => [k, { levels: r.stages, up: r.stages.slice(1).map((x) => x.up) }]))
);

/**
 * @typedef {{ label: string, does: string, wells: number, build: Craft, keep: Craft, make: Craft, up: Record<string, number>, gold: number }} CentreStage
 */
/**
 * The village center grows by the crafting engine's recipes too (Samuel, 2026-10-07): a village starts as a logistics
 * hub, a small store dome; it grows into the great village center, a dome as large as a great dome of 248, its hall,
 * market and storehouse, and its geothermal power plant, the wells of the first triplet drilled for gold under it; then
 * two more producers at a time. More stages will come between the hub and the great center. Its build is in tonnes,
 * with its builders' energy and the gold for its wells; its keep, 2% a year of what it is built of and the energy of
 * its hall, storehouse and routes (ENERGY); its make, what its wells make a year. Its wares come from its stores at once
 * (what they lack, bought from the world market), and it grows at once.
 * @type {CentreStage[]}
 */
export const CENTRE = /** @type {any} */ ([
	{ label: 'Logistics hub', build: { plank: 30, steel: 20, glass: 10 }, gold: 0, wells: 0, does: 'stores and trades its village’s wares; it makes no power' },
	// its wells' gold as Samuel set it (2026-10-07; our research says 30 to 45 M € for a plant): 25,000 gold a stage
	{ label: 'Village center', build: { ...DOME_T }, gold: 25000, wells: 1, does: '' },
	{ label: 'Geothermal 2', build: {}, gold: 25000, wells: 2, does: '' },
	{ label: 'Geothermal 3', build: {}, gold: 25000, wells: 3, does: '' }
]);

/**
 * Energy, in kWh here (a MWh is its unit on the page): electricity only (a dome's heat comes from its fish pond and the village's geothermal heat loop).
 * Our village energy research, 2026-10-07 (project file energy/village-energy.md).
 *
 * Every village center is also its village's power plant: an enhanced geothermal triplet under it (as Fervo drilled
 * for Google; in Bavaria one injector and two producers), 3.4 MW net, running 94% of the time, about 540 MWh a week;
 * each further stage drills two more producers and as much again. Every dome makes some with the see-through solar
 * cells in its glass, which leave 70% of the light: a great dome of 248 about 1.3 GWh a year, so 5,242 kWh a bed (a
 * smaller dome as much as its glass), most in summer and little in winter; and its climate (fans, pumps, heat pumps)
 * uses 0.17 GWh a year. A person uses 900 kWh a year at home, as people sharing a dome do, so a dome's sun makes about
 * three times what its people and climate use over a year, but a little less than that in midwinter. A village
 * center uses 0.3 GWh a year for its hall, its storehouse and its trade routes' lights and trains. Factories use
 * theirs as their recipes say (RECIPES), a round at a time.
 */
export const ENERGY = {
	/** a geothermal stage's net power, kW, the share of the time it runs, and the most stages a village center drills */
	wellKw: 3400,
	uptime: 0.94,
	wellsMost: 3,
	/** kWh a year a bed's share of its dome's solar cells makes, and of what its climate uses */
	sunBed: 1300000 / HOUSE_MOST,
	climateBed: 170000 / HOUSE_MOST,
	/**
	 * kWh a year a person uses at home: 900, where a German household uses about 1,500 a head. Sharing a dome saves the
	 * rest (our estimate, Samuel 2026-10-07): hot water comes from the geothermal heat loop, not a heater; kitchens, cold
	 * stores and laundries are shared, and clothes dry in the dome's warm air; daylight comes through the glass
	 */
	home: 900,
	/** kWh a year a village center uses: its hall and storehouse, the lights and trains of its trade routes; and a
	 * logistics hub, its store's lights, cold store and carts */
	centre: 300000,
	hub: 30000
};
// the village center's three recipes at each stage, as a factory's: its build in tonnes with its builders' energy and its
// wells' gold (and in loads, `up`), its keep of all it is built of by then, and what its wells make a year
{
	/** @type {Record<string, number>} */
	const built = {};
	for (const x of CENTRE) {
		const wares = /** @type {Record<string, number>} */ (/** @type {any} */ (x).build);
		x.up = Object.fromEntries(Object.entries(wares).map(([w, t]) => [w, Math.ceil(t / LOAD_T)]));
		for (const [w, t] of Object.entries(wares)) built[w] = (built[w] ?? 0) + t;
		x.build = { in: { ...buildIn(wares), ...(x.gold ? { gold: x.gold } : {}) }, out: {} };
		x.keep = { in: { ...keepIn(built), energy: (x.wells ? ENERGY.centre : ENERGY.hub) / 1000 }, out: {} };
		x.make = { in: {}, out: x.wells ? { energy: (x.wells * ENERGY.wellKw * 24 * YEAR * ENERGY.uptime) / 1000 } : {} };
	}
	BUILDINGS.centre.cost = CENTRE[0].up;
}
/** the village center's stage at a level (1, the hub) @param {number} level */
export const centreStage = (level) => CENTRE[Math.min(CENTRE.length, Math.max(1, level || 1)) - 1];
/** a dome's solar by month, in % of its year, January first (our village energy research): a month's share is its
 * part of their sum */
export const SUN_MONTH = [2.9, 4.6, 8.0, 11.2, 13.1, 13.9, 14.2, 12.3, 8.9, 5.7, 3.0, 2.1];
const SUN_YEAR = SUN_MONTH.reduce((a, b) => a + b, 0);
/** kWh a day a bed's solar glass makes in a month (1 to 12) */
export const sunBedDay = (/** @type {number} */ month) => (ENERGY.sunBed * SUN_MONTH[month - 1]) / SUN_YEAR / 30;

/** what your first logistics hub holds as you put it up: nothing stands in the valley as a game starts */
export const START = {
	/** in loads: 120 t of planks, 60 t of steel and 50 t of glass, enough for a hut on each of your first hexes and
	 * their first factories (the hub itself comes with your settlers) */
	stock: { plank: 24, steel: 12, glass: 10 },
	coins: 30,
	/** the settlers who come with your first logistics hub, wherever you put it up */
	settlers: 2
};
