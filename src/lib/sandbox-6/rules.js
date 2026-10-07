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
 *   a market hall → its trader takes wares to the fair and brings back what you bought (./market.js)
 *
 * Every building stands in a settlement (./plots.js): a house and two factory domes round one flag. Houses are where
 * settlers live — 2, then 4, 8 and 16 as they are enlarged — so a city has only as many people as it has beds. Seven
 * settlements make a village; your city grows a village at a time, when you found a house next to it.
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
 * @property {'warehouse'|'house'|'make'|'mine'|'gather'|'forester'|'farm'|'market'|'village'|'fair'} kind
 * @property {string} [worker] who works it
 * @property {boolean} [tools] its worker needs tools to start
 * @property {string[][]} [inputs] each slot takes any one of its wares
 * @property {string} [out] the ware it makes
 * @property {number} [time] seconds for one ware (made inside), or one job out in the land
 * @property {number} [rest] seconds between jobs out in the land
 * @property {number} [range] how far its worker goes out
 * @property {'mountain'|'grass'} [on] the land it stands on (grass by default)
 * @property {string} [ore] the ore a mine digs
 * @property {number} [beds] settlers who live in it
 */

/** @type {Record<string, BuildingType>} */
export const BUILDINGS = {
	hq: { id: 'hq', label: 'City hall', group: '', about: 'The heart of your city and its first storehouse: 8 settlers live here, and tools start here.', cost: {}, kind: 'warehouse', beds: 8 },
	house: { id: 'house', label: 'House', group: 'Homes', about: 'Founds a settlement: settlers live here, 2 at first, then 4, 8 and 16 as you enlarge it. Its two factory spots open once it stands. Found one next to your city to start a new village.', cost: { plank: 2, stone: 1 }, kind: 'house' },
	storehouse: { id: 'storehouse', label: 'Storehouse', group: 'Basics', about: 'Keeps wares and settlers closer to where they are needed.', cost: { plank: 4, stone: 3 }, kind: 'warehouse' },
	woodcutter: { id: 'woodcutter', label: 'Woodcutter', group: 'Basics', about: 'Fells grown trees nearby and splits them into planks.', cost: { plank: 2 }, kind: 'gather', worker: 'Woodcutter', tools: true, out: 'plank', time: 6, rest: 4, range: 6 },
	forester: { id: 'forester', label: 'Forester', group: 'Basics', about: 'Plants young trees nearby; they grow in about two minutes.', cost: { plank: 2 }, kind: 'forester', worker: 'Forester', tools: true, time: 3, rest: 5, range: 5 },
	quarry: { id: 'quarry', label: 'Quarry', group: 'Basics', about: 'Cuts stone from rocks nearby.', cost: { plank: 2 }, kind: 'gather', worker: 'Stonecutter', tools: true, out: 'stone', time: 6, rest: 4, range: 6 },
	fishery: { id: 'fishery', label: 'Fishery', group: 'Food', about: 'Fishes at the water’s edge; build it near a lake.', cost: { plank: 2 }, kind: 'gather', worker: 'Fisher', tools: true, out: 'fish', time: 6, rest: 4, range: 5 },
	farm: { id: 'farm', label: 'Farm', group: 'Food', about: 'Sows fields round it and reaps the grain.', cost: { plank: 3, stone: 2 }, kind: 'farm', worker: 'Farmer', tools: true, out: 'grain', time: 4, rest: 3, range: 3 },
	well: { id: 'well', label: 'Well', group: 'Food', about: 'Draws water.', cost: { plank: 2 }, kind: 'make', worker: 'Water carrier', inputs: [], out: 'water', time: 8 },
	bakery: { id: 'bakery', label: 'Bakery', group: 'Food', about: 'Bakes bread from grain and water.', cost: { plank: 2, stone: 2 }, kind: 'make', worker: 'Baker', tools: true, inputs: [['grain'], ['water']], out: 'bread', time: 8 },
	ironmine: { id: 'ironmine', label: 'Iron mine', group: 'Tools', about: 'Digs iron ore; miners eat fish or bread. Build on rust-red rock.', cost: { plank: 4 }, kind: 'mine', worker: 'Miner', tools: true, inputs: [FOOD], out: 'ore', time: 8, on: 'mountain', ore: 'iron' },
	toolmaker: { id: 'toolmaker', label: 'Toolmaker', group: 'Tools', about: 'Forges tools from iron ore and planks: every new worker needs some.', cost: { plank: 2, stone: 2 }, kind: 'make', worker: 'Toolmaker', inputs: [['ore'], ['plank']], out: 'tools', time: 10 },
	market: { id: 'market', label: 'Market hall', group: 'Trade', about: 'Its trader carts what you sell to the fair and brings back what you buy. Choose what in the Market.', cost: { plank: 4, stone: 3 }, kind: 'market', worker: 'Trader' },
	village: { id: 'village', label: 'City hall', group: '', about: 'A neighbour city.', cost: {}, kind: 'village' },
	fair: { id: 'fair', label: 'The fair', group: '', about: 'The valley’s open market: every settlement’s traders come here to sell and buy.', cost: {}, kind: 'fair' }
};


/** the build menu, in its groups */
export const GROUPS = ['Homes', 'Basics', 'Food', 'Tools', 'Trade'];
export const MENU = GROUPS.map((g) => ({ group: g, types: Object.values(BUILDINGS).filter((b) => b.group === g) }));

/** buildings that hold their village as land */
export const holdsLand = (/** @type {string} */ type) => type === 'hq' || type === 'house' || type === 'village' || type === 'fair';

/** settlers a house holds at each size, and what enlarging it to the next size costs */
export const HOUSE_BEDS = [2, 4, 8, 16];
export const HOUSE_UP = [{ plank: 2, stone: 2 }, { plank: 4, stone: 3 }, { plank: 6, stone: 5 }];
/** a house's size as a word */
export const HOUSE_SIZE = ['Hut', 'Cottage', 'House', 'Great house'];

/** what the headquarters holds as a game starts */
export const START = {
	stock: { plank: 32, stone: 22, fish: 12, grain: 4, water: 8, bread: 8, ore: 4, tools: 20 },
	coins: 60,
	settlers: 20,
	/** the houses that stand round the city hall as a game starts: their sizes (1…4) */
	houses: [3, 3]
};

/** the win: every city (yours and each neighbour's) lives this well, with this many people, for this long */
export const ABUNDANT = 80, PEOPLE = 40, HOLD = 600;

/** the goals of a game, in order: its last is the win */
export const GOALS = [
	{ id: 'wood', label: 'Run a woodcutter and a quarry', hint: 'Build one near trees and one near rocks, and connect them to your headquarters with roads.' },
	{ id: 'planks', label: 'Cut 12 planks', ware: 'plank', n: 12 },
	{ id: 'food', label: 'Gather 25 food (fish or bread)', ware: 'food', n: 25 },
	{ id: 'house', label: 'Enlarge a house to 16 settlers', hint: 'Select a house and enlarge it: 2, 4, 8, then 16 settlers. People only come when there are beds for them.' },
	{ id: 'market', label: 'Build a market hall and sell at the fair', hint: 'Open the Market and mark a ware to sell: your trader carts it to the fair.' },
	{ id: 'trade', label: 'Trade 80 wares at the fair', n: 80 },
	{ id: 'contract', label: 'Fill a neighbour’s request', hint: 'Neighbours ask for what they lack. Send it from the Market, and your trader brings it.' },
	{ id: 'abundance', label: `Every city at wellbeing ${ABUNDANT} with ${PEOPLE} people, for 10 minutes`, hint: 'Wellbeing is how well a city lives: fed, with variety, watered, housed and with something put by. Cities that live well grow. It counts once the other goals are reached.' }
];
