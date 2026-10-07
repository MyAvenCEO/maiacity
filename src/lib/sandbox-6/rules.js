/**
 * SANDBOX 6 · THE RULES — every ware, every building and what it makes, in one table.
 *
 * A valley economy in the spirit of the old settler games, without the war, its own names and its own numbers: wares lie at flags and
 * carriers bring them, one carrier to a road, from flag to flag, to whoever needs them. A building is a site until a
 * builder has used up its planks and stone; then a worker moves in and it runs its chain. Eight wares, short chains:
 *
 *   trees → woodcutter → planks          (a forester plants new trees)
 *   rocks → quarry → stone
 *   water's edge → fishery → fish
 *   field → farm → grain ┐
 *   well → water ────────┴→ bakery → bread
 *   fish | bread → iron mine → iron ore;  iron ore + planks → toolmaker → tools
 *
 * Every building stands in a settlement (./plots.js): a house and two factory domes round one flag. Houses are where
 * settlers live — 2, then 4, 8 and 16 as they are enlarged — so a village has only as many people as it has beds.
 * Seven settlements make a village: six round its middle, where the village center stands — its storehouse, its
 * market and its hall in one, holding everything the village has. Roads above ground are for walking within a
 * village; village centers are joined by trade routes under the ground (./market.js), your own to share wares
 * between your villages, and other cities' to trade with them. Your city grows a village at a time.
 *
 * Nobody fights here: the valley is shared with two neighbour cities, each with plenty of one ware and none of
 * another (yours: plenty of grain on wide farmland, but no iron in your mountains), and the game is won by abundance for all of them — every
 * city fed, watered, housed, with something put by, and grown — not by coins.
 *
 * Plain data: the simulation (./sim.js) and the page read it alike.
 */

/** @typedef {{ id: string, label: string, color: string }} Ware */

/** @type {Record<string, Ware>} */
export const WARES = {
	plank: { id: 'plank', label: 'Planks', color: '#e0b46a' },
	stone: { id: 'stone', label: 'Stone', color: '#a4a49e' },
	fish: { id: 'fish', label: 'Fish', color: '#9cc3d6' },
	grain: { id: 'grain', label: 'Grain', color: '#e8c94a' },
	water: { id: 'water', label: 'Water', color: '#4aa3df' },
	bread: { id: 'bread', label: 'Bread', color: '#c47f34' },
	ore: { id: 'ore', label: 'Iron ore', color: '#a35b3a' },
	tools: { id: 'tools', label: 'Tools', color: '#2f9690' }
};
export const WARE_ORDER = Object.keys(WARES);

/** what a miner eats: any one of these */
export const FOOD = ['fish', 'bread'];

/**
 * What a settlement hex is good for: meadow (farmland) is everywhere; forest, stone, iron and water are scarce, and a
 * woodcutter or forester, a quarry, an iron mine or a fishery only stands on a hex of its own kind. A lake's own hexes
 * are water to fish from, not land: 'lake'; bare mountain without iron is 'mountain'.
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
 * @property {Record<string, number>} cost planks and stone a builder uses up
 * @property {'centre'|'house'|'make'|'mine'|'gather'|'forester'|'farm'|'village'} kind
 * @property {string} [worker] who works it
 * @property {boolean} [tools] its worker needs tools to start
 * @property {string[][]} [inputs] each slot takes any one of its wares
 * @property {string} [out] the ware it makes
 * @property {number} [time] seconds for one ware (made inside), or one job out in the land
 * @property {number} [rest] seconds between jobs out in the land
 * @property {number} [range] how far its worker goes out
 * @property {number} [yield] how many of its ware one round of work makes (1 if not said)
 * @property {'mountain'|'grass'} [on] the land it stands on (grass by default)
 * @property {string} [ore] the ore a mine digs
 * @property {'forest'|'stone'|'iron'|'water'} [biome] the only kind of hex it stands on (any hex if not said)
 * @property {number} [beds] settlers who live in it
 */

/** @type {Record<string, BuildingType>} */
export const BUILDINGS = {
	centre: { id: 'centre', label: 'Village center', group: 'Homes', about: 'Founds a village in the middle of a village next to yours: its storehouse, market and hall in one — nobody lives here. A trade route under the ground joins it to the village center that founded it, and four settlers come to build its houses.', cost: { plank: 6, stone: 4 }, kind: 'centre' },
	house: { id: 'house', label: 'House', group: 'Homes', about: 'Founds a settlement: settlers live here, 2 at first, then 4, 8 and 16 as you enlarge it. Its two factory spots open once it stands.', cost: { plank: 2, stone: 1 }, kind: 'house' },
	woodcutter: { id: 'woodcutter', label: 'Woodcutter', group: 'Basics', about: 'Fells grown trees nearby and splits them into planks; build it on a forest hex.', cost: { plank: 2 }, kind: 'gather', biome: 'forest', worker: 'Woodcutter', tools: true, out: 'plank', time: 6, rest: 4, range: 6 },
	forester: { id: 'forester', label: 'Forester', group: 'Basics', about: 'Plants young trees nearby, on a forest hex; they grow in about two minutes.', cost: { plank: 2 }, kind: 'forester', biome: 'forest', worker: 'Forester', tools: true, time: 3, rest: 5, range: 5 },
	quarry: { id: 'quarry', label: 'Quarry', group: 'Basics', about: 'Cuts stone from rocks nearby; build it on a stone hex.', cost: { plank: 2 }, kind: 'gather', biome: 'stone', worker: 'Stonecutter', tools: true, out: 'stone', time: 6, rest: 4, range: 6 },
	fishery: { id: 'fishery', label: 'Fishery', group: 'Food', about: 'Fishes at the water’s edge; build it on a water hex, by a lake or the sea.', cost: { plank: 2 }, kind: 'gather', biome: 'water', worker: 'Fisher', tools: true, out: 'fish', yield: 3, time: 6, rest: 4, range: 5 },
	farm: { id: 'farm', label: 'Farm', group: 'Food', about: 'Sows fields round it and reaps the grain.', cost: { plank: 3, stone: 2 }, kind: 'farm', worker: 'Farmer', tools: true, out: 'grain', yield: 2, time: 4, rest: 3, range: 3 },
	well: { id: 'well', label: 'Well', group: 'Food', about: 'Draws water.', cost: { plank: 2 }, kind: 'make', worker: 'Water carrier', inputs: [], out: 'water', time: 8 },
	bakery: { id: 'bakery', label: 'Bakery', group: 'Food', about: 'Bakes bread from grain and water.', cost: { plank: 2, stone: 2 }, kind: 'make', worker: 'Baker', tools: true, inputs: [['grain'], ['water']], out: 'bread', yield: 2, time: 8 },
	ironmine: { id: 'ironmine', label: 'Iron mine', group: 'Tools', about: 'Digs iron ore; miners eat fish or bread. Build it on an iron hex (rust-red rock).', cost: { plank: 4 }, kind: 'mine', biome: 'iron', worker: 'Miner', tools: true, inputs: [FOOD], out: 'ore', time: 8, on: 'mountain', ore: 'iron' },
	toolmaker: { id: 'toolmaker', label: 'Toolmaker', group: 'Tools', about: 'Forges tools from iron ore and planks: every new worker needs some.', cost: { plank: 2, stone: 2 }, kind: 'make', worker: 'Toolmaker', inputs: [['ore'], ['plank']], out: 'tools', time: 10 },
	village: { id: 'village', label: 'Village center', group: '', about: 'A neighbour city’s village center.', cost: {}, kind: 'village' }
};


/** the build menu, in its groups */
export const GROUPS = ['Homes', 'Basics', 'Food', 'Tools'];
export const MENU = GROUPS.map((g) => ({ group: g, types: Object.values(BUILDINGS).filter((b) => b.group === g) }));

/** buildings that hold their village as land: its center */
export const holdsLand = (/** @type {string} */ type) => type === 'centre' || type === 'village';

/** settlers a house holds at each size, and what enlarging it to the next size costs */
export const HOUSE_BEDS = [2, 4, 8, 16];
export const HOUSE_UP = [{ plank: 2, stone: 1 }, { plank: 4, stone: 2 }, { plank: 6, stone: 3 }];
/** a house's size as a word */
export const HOUSE_SIZE = ['Hut', 'Cottage', 'House', 'Great house'];

/** what the headquarters holds as a game starts */
export const START = {
	stock: { plank: 16, stone: 10, fish: 8, water: 8, bread: 4, tools: 8 },
	coins: 30,
	settlers: 2,
	/** the houses that stand round your first village center as a game starts: their sizes (1…4) — one house of two */
	houses: [1]
};

/** the win: every one of your villages has a house in each of its settlements, every bed taken, and lives at least
 * this well, for this long */
export const ABUNDANT = 80, HOLD = 600;

/** the goals of a game, in order: its last is the win */
export const GOALS = [
	{ id: 'wood', label: 'Run a woodcutter and a quarry', hint: 'Build them beside a house, near trees and rocks, and they join your village center by a path on their own.' },
	{ id: 'planks', label: 'Cut 12 planks', ware: 'plank', n: 12 },
	{ id: 'food', label: 'Gather 25 food (fish or bread)', ware: 'food', n: 25 },
	{ id: 'house', label: 'Enlarge a house to 16 settlers', hint: 'Select a house and enlarge it: 2, 4, 8, then 16 settlers. People only come when there are beds for them.' },
	{ id: 'village', label: 'Found a second village', hint: 'Build a village center in the middle of a village next to yours: a trade route under the ground joins the two.' },
	{ id: 'route', label: 'Join two of your villages by a trade route', hint: 'Select a village center and press Connect: a route under the ground joins it to another of yours, and carts carry wares along it.' },
	{ id: 'trade', label: 'Trade 80 wares between your villages', n: 80, hint: 'A village short of something takes it from one of yours with plenty, and pays in gold from its treasury.' },
	{ id: 'iron', label: 'Dig 10 iron ore', ware: 'ore', n: 10, hint: 'An iron mine stands only on an iron hex: found a village where the rock is rust-red.' },
	{ id: 'abundance', label: `Five villages, each full and at ${ABUNDANT}+, for 10 minutes`, hint: 'Happiness is counted per village: fed, with variety, watered, housed and with something put by. A village is full when each of its settlements has a house and every bed is taken. It counts once the other goals are reached.' }
];
