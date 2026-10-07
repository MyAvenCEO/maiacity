/**
 * SANDBOX 6 · THE RULES — every ware, every building and what it makes, in one table.
 *
 * A valley economy in the spirit of the old settler games, without the war, its own names and its own numbers: wares lie at flags and
 * carriers bring them, one carrier to a road, from flag to flag, to whoever needs them. A building is a site until a
 * builder has used up what it is built of; then a worker moves in and it runs its chain. Three wares, short chains:
 *
 *   trees → forester → planks            (one building that grows: forester, woodcutter, sawmill, timber works)
 *   iron → iron mine → steel             (one building that grows: iron mine, furnace, steelworks)
 *   limestone and clay → lime pit → lime (one building that grows: lime pit, kiln, block works)
 *
 * They are counted in real tonnes of what they end as: planks as the glulam struts of the domes, steel as their joints,
 * lime as the arch blocks of the trade routes. A dome is built as the real one is (DOME_T): its struts and joints from
 * your stores, its glass from the world market, paid in gold as it is begun.
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

/** @typedef {{ id: string, label: string, color: string }} Ware */

/** @type {Record<string, Ware>} */
export const WARES = {
	plank: { id: 'plank', label: 'Planks', color: '#e0b46a' },
	steel: { id: 'steel', label: 'Steel', color: '#8796a6' },
	lime: { id: 'lime', label: 'Lime', color: '#d9cfb4' }
};
export const WARE_ORDER = Object.keys(WARES);

/**
 * What a hex is good for: meadow (farmland) is everywhere; forest, stone, iron and water (a lake's or the sea's shore)
 * are scarce, and a woodcutter or forester, an iron mine or a lime pit only stands on a hex of its own kind.
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

/** settlers a house holds at each size: one dome, larger each time it is enlarged */
export const HOUSE_BEDS = [2, 4, 8, 16, 32, 64, 128, 248];
/** a house's size as a word */
export const HOUSE_SIZE = ['Hut', 'Cottage', 'House', 'Great house', 'Hall', 'Great hall', 'Dome', 'Great dome'];
/** the largest a house gets: its size and its beds */
export const HOUSE_TOP = HOUSE_BEDS.length;
export const HOUSE_MOST = HOUSE_BEDS[HOUSE_TOP - 1];
/** a load of any ware, in tonnes: a truckload */
export const LOAD_T = 5;
/**
 * The real great dome of 248, 150 m across (our engineering research, 2026-10-07), in tonnes: its larch and Douglas
 * glulam struts, its finished steel joints (cast hubs, screws, brackets) and its laminated double glazing.
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
/** a dome's struts and joints in loads, rounded up @param {number} beds */
const domeLoads = (beds) => {
	const t = domeOf(beds);
	return { plank: Math.ceil(t.plank / LOAD_T), steel: Math.ceil(t.steel / LOAD_T) };
};
/** what of a ware the larger dome takes beyond the smaller (none left out) @param {number} from @param {number} to */
const domeStep = (from, to) => {
	const a = from ? domeLoads(from) : { plank: 0, steel: 0 }, b = domeLoads(to);
	/** @type {Record<string, number>} */
	const step = {};
	if (b.plank > a.plank) step.plank = b.plank - a.plank;
	if (b.steel > a.steel) step.steel = b.steel - a.steel;
	return step;
};
/** what enlarging a house to its next size costs, in loads of struts and joints from your stores */
export const HOUSE_UP = HOUSE_BEDS.slice(1).map((n, k) => domeStep(HOUSE_BEDS[k], n));
/** the glass a house takes, in tonnes: a hut's as it is built, then what each enlarging adds */
export const HOUSE_GLASS = HOUSE_BEDS.map((n, k) => domeOf(n).glass - (k ? domeOf(HOUSE_BEDS[k - 1]).glass : 0));

/**
 * @typedef {object} BuildingType
 * @property {string} id
 * @property {string} label
 * @property {string} group which part of the build menu
 * @property {string} about one line
 * @property {Record<string, number>} cost planks and steel a builder uses up
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
 * @property {'forest'|'stone'|'iron'|'water'} [biome] the only kind of hex it stands on (any hex if not said)
 * @property {number} [beds] settlers who live in it
 */

/** @type {Record<string, BuildingType>} */
export const BUILDINGS = {
	centre: { id: 'centre', label: 'Village center', group: 'Homes', about: 'Founds a village in the middle of a village next to yours: its storehouse, market and hall in one — nobody lives here. A trade route under the ground, laid of lime blocks (what your stores lack, bought from the world market), joins it to the village center that founded it, and four settlers come to build its houses.', cost: { plank: 6, steel: 4 }, kind: 'centre' },
	house: { id: 'house', label: 'House', group: 'Homes', about: 'Founds a settlement: settlers live here, 2 at first, then twice as many each time you enlarge it, up to 248. A dome of glass on struts and steel joints, its glass bought from the world market as it is begun. Its two factory spots open once it stands.', cost: domeStep(0, HOUSE_BEDS[0]), kind: 'house' },
	woodcutter: { id: 'woodcutter', label: 'Forester', group: 'Basics', about: 'Your wood, in one building that grows: a forester plants young trees round it; upgraded, a woodcutter fells grown trees and plants a young one where each stood, then a sawmill and a timber works cut more planks from every tree. Build it on a forest hex.', cost: { plank: 2 }, kind: 'gather', biome: 'forest', worker: 'Forester', out: 'plank', time: 6, rest: 4, range: 10 },
	forester: { id: 'forester', label: 'Forester', group: '', about: 'Plants young trees nearby, on a forest hex; they grow in about two minutes. (Now the first level of the wood building.)', cost: { plank: 2 }, kind: 'forester', biome: 'forest', worker: 'Forester', time: 3, rest: 5, range: 8 },
	ironmine: { id: 'ironmine', label: 'Iron mine', group: 'Basics', about: 'Your steel, in one building that grows: an iron mine digs iron ore and smelts a load of steel joints from every five loads; upgraded, a furnace makes two and a steelworks three from the same ore. Build it on an iron hex, by rust-red rock.', cost: { plank: 4 }, kind: 'mine', biome: 'iron', worker: 'Miner', inputs: [], out: 'steel', time: 8, on: 'any', ore: 'iron' },
	limeworks: { id: 'limeworks', label: 'Lime pit', group: 'Basics', about: 'Your lime, in one building that grows: a lime pit digs limestone and clay and burns lime; upgraded, a kiln burns lime and bakes clay for plaster and mortar, and a block works casts the arch blocks of the trade routes and lime bricks, two and three times as much from the same pit. Build it on a stone hex, by the rock fields.', cost: { plank: 4 }, kind: 'mine', biome: 'stone', worker: 'Lime burner', inputs: [], out: 'lime', time: 8, on: 'any' },
	village: { id: 'village', label: 'Village center', group: '', about: 'A neighbour city’s village center.', cost: {}, kind: 'village' }
};


/** the build menu, in its groups */
export const GROUPS = ['Homes', 'Basics'];
export const MENU = GROUPS.map((g) => ({ group: g, types: Object.values(BUILDINGS).filter((b) => b.group === g) }));

/** buildings that hold their village as land: its center */
export const holdsLand = (/** @type {string} */ type) => type === 'centre' || type === 'village';


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
export const PLANK_T = LOAD_T;

/**
 * The steel building's levels: what it is called, and how many loads of steel joints it makes from a round of iron
 * ore (five loads, 25 t). Each upgrade makes more from the same ore: an iron mine smelts a little, a furnace more, a
 * steelworks most (15 t, the iron in 25 t of ore). (The key says struts, as it did before the struts became glulam.)
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
/** a load of steel, in tonnes: a truckload of joints */
export const STEEL_T = LOAD_T;

/**
 * The lime building's levels: what it is called, and how many loads of lime it makes from a round of its pit's
 * limestone and clay. A lime pit burns lime, a kiln burns more and bakes the clay that makes it set in damp ground
 * (lime plaster and mortar for building inside), and a block works casts it with the pit's gravel into arch blocks
 * and lime bricks: lime is counted in tonnes of blocks, what the trade routes are built of.
 */
export const LIME = [
	{ label: 'Lime pit', blocks: 1 },
	{ label: 'Kiln', blocks: 2 },
	{ label: 'Block works', blocks: 3 }
];
/** what each upgrade of the lime building costs */
export const LIME_UP = [
	{ plank: 4, steel: 2 },
	{ plank: 6, steel: 3 }
];

/**
 * A trade route under the ground, as the real one is built (our tunnel research, 2026-10-07): two arched cells for
 * 40 ft containers, laid of lime blocks with no steel, about 51,500 t of them a km (4,600 t of lime, 6,900 t of baked
 * clay, 40,000 t of gravel and sand). Its bed, drains and clay seal are dug from its own trench. A world unit of the
 * valley is about 32 m: a hex about 660 m across, neighbouring village centers about 1.75 km apart.
 */
export const ROUTE_T_KM = 51500, UNIT_M = 32;

/** a hex's fields and woods, besides its food forest: 10 ha of hemp and bamboo, about 15 t a hectare a year */
export const FIELD_HA = 10, FIELD_T = 15;
/**
 * What a wood, steel or lime building may work a year, on the master clock, whatever its people do on screen: its hex's
 * harvest in trees (15 t each, so 150 t a year; a woodcutter cuts a load of planks from each, a sawmill two, a timber
 * works all three), its iron hex's ore in rounds of five loads (25 t each, so 250 t a year; an iron mine smelts
 * one load of joints from each, a furnace two, a steelworks three), or what its kiln burns, 200 rounds a year (a
 * lime pit a load of lime from each, 1,000 t a year, a kiln two, a block works three, 3,000 t: a small works of about
 * 10 t a day).
 */
export const ROUNDS_YEAR = /** @type {Record<string, number>} */ ({ woodcutter: (FIELD_HA * FIELD_T) / (3 * PLANK_T), ironmine: 10, limeworks: 200 });
/** what keeping homes up takes a year: a share of what they cost to build */
export const UPKEEP = 0.02;

/** the buildings that grow by upgrades, besides houses: their levels and what each upgrade costs */
export const GROWS = /** @type {Record<string, { levels: { label: string }[], up: Record<string, number>[] }>} */ ({
	woodcutter: { levels: WOOD, up: WOOD_UP },
	ironmine: { levels: STEEL, up: STEEL_UP },
	limeworks: { levels: LIME, up: LIME_UP }
});

/** what the headquarters holds as a game starts */
export const START = {
	stock: { plank: 16, steel: 10 },
	coins: 30,
	settlers: 2,
	/** the houses that stand round your first village center as a game starts: their sizes (1…4) — one house of two */
	houses: [1]
};
