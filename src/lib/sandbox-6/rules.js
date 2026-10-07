/**
 * SANDBOX 6 · THE RULES — every ware, every building and what it makes, in one table.
 *
 * A valley economy in the spirit of the old settler games, without the war, its own names and its own numbers: wares lie at flags and
 * carriers bring them, one carrier to a road, from flag to flag, to whoever needs them. A building is a site until a
 * builder has used up its planks and steel; then a worker moves in and it runs its chain. Two wares, short chains:
 *
 *   trees → forester → planks            (one building that grows: forester, woodcutter, sawmill, timber works)
 *   iron → iron mine → steel             (one building that grows: iron mine, furnace, steelworks)
 *
 * Food and water are not wares: every house's hex grows food, its roof catches rain into the tanks and wells pipe
 * the rest, and what a village lacks it buys from the world market (./food.js).
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

/** @typedef {{ id: string, label: string, color: string }} Ware */

/** @type {Record<string, Ware>} */
export const WARES = {
	plank: { id: 'plank', label: 'Planks', color: '#e0b46a' },
	steel: { id: 'steel', label: 'Steel', color: '#8796a6' }
};
export const WARE_ORDER = Object.keys(WARES);

/**
 * What a hex is good for: meadow (farmland) is everywhere; forest, stone, iron and water (a lake's or the sea's shore)
 * are scarce, and a woodcutter or forester or an iron mine only stands on a hex of its own kind.
 * A hex whose middle is under water (a lake's or the sea's) is 'lake', not land; bare mountain is 'mountain'. Read
 * from the land as the valley grew (./map.js).
 */
export const BIOMES = {
	meadow: { id: 'meadow', label: 'Meadow', color: '#9fc46a' },
	forest: { id: 'forest', label: 'Forest', color: '#2f6b3a' },
	stone: { id: 'stone', label: 'Stone', color: '#9a9a94' },
	iron: { id: 'iron', label: 'Iron', color: '#a35b3a' },
	water: { id: 'water', label: 'Water', color: '#4aa3df' },
	mountain: { id: 'mountain', label: 'Mountain', color: '#8c8f96' },
	lake: { id: 'lake', label: 'Lake', color: '#3a7fb8' }
};

/** the land a node is */
export const GRASS = 0, WATER = 1, MOUNTAIN = 2, SAND = 3;
/** what a mountain node holds: 0 bare rock, 2 iron */
export const IRON = 2;

/**
 * @typedef {object} BuildingType
 * @property {string} id
 * @property {string} label
 * @property {string} group which part of the build menu
 * @property {string} about one line
 * @property {Record<string, number>} cost planks and steel a builder uses up
 * @property {'centre'|'house'|'make'|'mine'|'gather'|'forester'|'well'|'village'} kind
 * @property {string} [worker] who works it
 * @property {string[][]} [inputs] each slot takes any one of its wares
 * @property {string} [out] the ware it makes
 * @property {number} [time] seconds for one ware (made inside), or one job out in the land
 * @property {number} [rest] seconds between jobs out in the land
 * @property {number} [range] how far its worker goes out
 * @property {number} [yield] how many of its ware one round of work makes (1 if not said)
 * @property {'mountain'|'grass'|'any'} [on] the land it stands on: grass by default, or rock, or either
 * @property {string} [ore] the ore a mine digs
 * @property {'forest'|'stone'|'iron'|'water'} [biome] the only kind of hex it stands on (any hex if not said)
 * @property {number} [beds] settlers who live in it
 */

/** @type {Record<string, BuildingType>} */
export const BUILDINGS = {
	centre: { id: 'centre', label: 'Village center', group: 'Homes', about: 'Founds a village in the middle of a village next to yours: its storehouse, market and hall in one — nobody lives here. A trade route under the ground joins it to the village center that founded it, and four settlers come to build its houses.', cost: { plank: 6, steel: 4 }, kind: 'centre' },
	house: { id: 'house', label: 'House', group: 'Homes', about: 'Founds a settlement: settlers live here, 2 at first, then twice as many each time you enlarge it, up to 248. Its two factory spots open once it stands.', cost: { plank: 2, steel: 1 }, kind: 'house' },
	woodcutter: { id: 'woodcutter', label: 'Forester', group: 'Basics', about: 'Your wood, in one building that grows: a forester plants young trees round it; upgraded, a woodcutter fells grown trees and plants a young one where each stood, then a sawmill and a timber works cut more planks from every tree. Build it on a forest hex.', cost: { plank: 2 }, kind: 'gather', biome: 'forest', worker: 'Forester', out: 'plank', time: 6, rest: 4, range: 10 },
	forester: { id: 'forester', label: 'Forester', group: '', about: 'Plants young trees nearby, on a forest hex; they grow in about two minutes. (Now the first level of the wood building.)', cost: { plank: 2 }, kind: 'forester', biome: 'forest', worker: 'Forester', time: 3, rest: 5, range: 8 },
	ironmine: { id: 'ironmine', label: 'Iron mine', group: 'Basics', about: 'Your steel, in one building that grows: an iron mine digs iron ore and smelts a load of steel struts from each load; upgraded, a furnace makes two and a steelworks three from the same ore. Build it on an iron hex, by rust-red rock.', cost: { plank: 4 }, kind: 'mine', biome: 'iron', worker: 'Miner', inputs: [], out: 'steel', time: 8, on: 'any', ore: 'iron' },
	well: { id: 'well', label: 'Well', group: 'Water', about: 'A borehole: pipes 2 L a second straight to its village’s tanks, fresh water for about 1,700 people, for when the rain its roofs catch runs short. Nobody needs to work it.', cost: { plank: 2 }, kind: 'well' },
	village: { id: 'village', label: 'Village center', group: '', about: 'A neighbour city’s village center.', cost: {}, kind: 'village' }
};


/** the build menu, in its groups */
export const GROUPS = ['Homes', 'Basics', 'Water'];
export const MENU = GROUPS.map((g) => ({ group: g, types: Object.values(BUILDINGS).filter((b) => b.group === g) }));

/** buildings that hold their village as land: its center */
export const holdsLand = (/** @type {string} */ type) => type === 'centre' || type === 'village';

/** settlers a house holds at each size, and what enlarging it to the next size costs */
export const HOUSE_BEDS = [2, 4, 8, 16, 32, 64, 128, 248];
export const HOUSE_UP = [
	{ plank: 2, steel: 1 },
	{ plank: 3, steel: 2 },
	{ plank: 4, steel: 2 },
	{ plank: 5, steel: 3 },
	{ plank: 6, steel: 3 },
	{ plank: 7, steel: 4 },
	{ plank: 8, steel: 4 }
];
/** a house's size as a word */
export const HOUSE_SIZE = ['Hut', 'Cottage', 'House', 'Great house', 'Hall', 'Great hall', 'Dome', 'Great dome'];
/** the largest a house gets: its size and its beds */
export const HOUSE_TOP = HOUSE_BEDS.length;
export const HOUSE_MOST = HOUSE_BEDS[HOUSE_TOP - 1];

/**
 * The wood building's levels: what it is called, and how many planks it cuts from a tree (a forester only plants).
 * Each upgrade brings more timber a week from the same trees; from a woodcutter on, it plants a tree for every one it
 * fells, so its forest stays.
 */
export const WOOD = [
	{ label: 'Forester', planks: 0 },
	{ label: 'Woodcutter', planks: 1 },
	{ label: 'Sawmill', planks: 2 },
	{ label: 'Timber works', planks: 3 }
];
/** what each upgrade of the wood building costs */
export const WOOD_UP = [
	{ plank: 2, steel: 1 },
	{ plank: 4, steel: 3 },
	{ plank: 6, steel: 4 }
];
/** a plank, in tonnes: a truckload of sawn timber */
export const PLANK_T = 5;

/**
 * The steel building's levels: what it is called, and how many loads of steel struts it makes from a load of iron ore.
 * Each upgrade makes more from the same ore: an iron mine smelts a little, a furnace more, a steelworks most.
 */
export const STEEL = [
	{ label: 'Iron mine', struts: 1 },
	{ label: 'Furnace', struts: 2 },
	{ label: 'Steelworks', struts: 3 }
];
/** what each upgrade of the steel building costs */
export const STEEL_UP = [
	{ plank: 4, steel: 2 },
	{ plank: 6, steel: 3 }
];
/** a load of steel, in tonnes: a truckload of struts */
export const STEEL_T = 5;

/** the buildings that grow by upgrades, besides houses: their levels and what each upgrade costs */
export const GROWS = /** @type {Record<string, { levels: { label: string }[], up: Record<string, number>[] }>} */ ({
	woodcutter: { levels: WOOD, up: WOOD_UP },
	ironmine: { levels: STEEL, up: STEEL_UP }
});

/** what the headquarters holds as a game starts */
export const START = {
	stock: { plank: 16, steel: 10 },
	coins: 30,
	settlers: 2,
	/** the houses that stand round your first village center as a game starts: their sizes (1…4) — one house of two */
	houses: [1]
};
