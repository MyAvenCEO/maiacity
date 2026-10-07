/**
 * SANDBOX 6 · THE RULES — every ware, every building and what it makes, in one table.
 *
 * A valley economy in the spirit of the old settler games, without the war, its own names and its own numbers: wares lie at flags and
 * carriers bring them, one carrier to a road, from flag to flag, to whoever needs them. A building is a site until a
 * builder has used up its planks and stone; then a worker moves in and it runs its chain:
 *
 *   trees → woodcutter → logs → sawmill → planks                  (a forester plants new trees)
 *   rocks → quarry → stone
 *   water's edge → fishery → fish          field → farm → grain → mill → flour ┐
 *   well → water ────────────────────────────────────────────────────────────┴→ bakery → bread
 *   grain + water → livestock farm → meat
 *   fish | bread | meat → coal mine, iron mine, gold mine → coal, iron ore, gold ore
 *   iron ore + coal → smelter → iron;  iron + planks → toolmaker → tools
 *   gold ore + coal → mint → coins: the valley's money, a means of exchange and nothing more
 *   a market hall → its trader takes wares to the fair and brings back what you bought (./market.js)
 *   a boundary stone widens your land
 *
 * Nobody fights here: the valley is shared with three neighbour settlements, each with plenty of one ware and none of
 * another (yours: plenty of grain on wide farmland, but no iron in your mountains), and the game is won by abundance for all of them — every
 * settlement fed, watered, housed, with something put by, and grown — not by coins.
 *
 * Plain data: the simulation (./sim.js) and the page read it alike.
 */

/** @typedef {{ id: string, label: string, color: string }} Ware */

/** @type {Record<string, Ware>} */
export const WARES = {
	log: { id: 'log', label: 'Logs', color: '#8a5a2b' },
	plank: { id: 'plank', label: 'Planks', color: '#e0b46a' },
	stone: { id: 'stone', label: 'Stone', color: '#a4a49e' },
	grain: { id: 'grain', label: 'Grain', color: '#e8c94a' },
	flour: { id: 'flour', label: 'Flour', color: '#f6f1e2' },
	water: { id: 'water', label: 'Water', color: '#4aa3df' },
	bread: { id: 'bread', label: 'Bread', color: '#c47f34' },
	fish: { id: 'fish', label: 'Fish', color: '#9cc3d6' },
	meat: { id: 'meat', label: 'Meat', color: '#b8443a' },
	coal: { id: 'coal', label: 'Coal', color: '#2a2a2c' },
	ironOre: { id: 'ironOre', label: 'Iron ore', color: '#a35b3a' },
	goldOre: { id: 'goldOre', label: 'Gold ore', color: '#e2b93b' },
	iron: { id: 'iron', label: 'Iron', color: '#bcc6cf' },
	tools: { id: 'tools', label: 'Tools', color: '#2f9690' },
	coin: { id: 'coin', label: 'Coins', color: '#ffd23f' }
};
export const WARE_ORDER = Object.keys(WARES);

/** what a miner eats: any one of these */
export const FOOD = ['fish', 'bread', 'meat'];

/** the land a node is */
export const GRASS = 0, WATER = 1, MOUNTAIN = 2, SAND = 3;
/** what a mountain node holds */
export const ORES = [null, 'coal', 'iron', 'gold'];

/**
 * @typedef {object} BuildingType
 * @property {string} id
 * @property {string} label
 * @property {string} group which part of the build menu
 * @property {string} about one line
 * @property {Record<string, number>} cost planks and stone a builder uses up
 * @property {'warehouse'|'make'|'mine'|'gather'|'forester'|'farm'|'land'|'market'|'village'|'fair'} kind
 * @property {string} [worker] who works it
 * @property {boolean} [tools] its worker needs tools to start
 * @property {string[][]} [inputs] each slot takes any one of its wares
 * @property {string} [out] the ware it makes
 * @property {number} [time] seconds for one ware (made inside), or one job out in the land
 * @property {number} [rest] seconds between jobs out in the land
 * @property {number} [range] how far its worker goes out
 * @property {'mountain'|'grass'} [on] the land it stands on (grass by default)
 * @property {string} [ore] the ore a mine digs
 * @property {number} [radius] the land it holds
 */

/** @type {Record<string, BuildingType>} */
export const BUILDINGS = {
	hq: { id: 'hq', label: 'Headquarters', group: '', about: 'Your first storehouse: settlers and tools start here.', cost: {}, kind: 'warehouse', radius: 9 },
	storehouse: { id: 'storehouse', label: 'Storehouse', group: 'Basics', about: 'Keeps wares and settlers closer to where they are needed.', cost: { plank: 4, stone: 3 }, kind: 'warehouse' },
	woodcutter: { id: 'woodcutter', label: 'Woodcutter', group: 'Basics', about: 'Fells grown trees nearby.', cost: { plank: 2 }, kind: 'gather', worker: 'Woodcutter', tools: true, out: 'log', time: 5, rest: 4, range: 6 },
	forester: { id: 'forester', label: 'Forester', group: 'Basics', about: 'Plants young trees nearby; they grow in about two minutes.', cost: { plank: 2 }, kind: 'forester', worker: 'Forester', tools: true, time: 3, rest: 5, range: 5 },
	quarry: { id: 'quarry', label: 'Quarry', group: 'Basics', about: 'Cuts stone from rocks nearby.', cost: { plank: 2 }, kind: 'gather', worker: 'Stonecutter', tools: true, out: 'stone', time: 6, rest: 4, range: 6 },
	sawmill: { id: 'sawmill', label: 'Sawmill', group: 'Basics', about: 'Saws logs into planks.', cost: { plank: 2, stone: 2 }, kind: 'make', worker: 'Sawyer', tools: true, inputs: [['log']], out: 'plank', time: 6 },
	fishery: { id: 'fishery', label: 'Fishery', group: 'Food', about: 'Fishes at the water’s edge; build it near a lake.', cost: { plank: 2 }, kind: 'gather', worker: 'Fisher', tools: true, out: 'fish', time: 6, rest: 4, range: 5 },
	farm: { id: 'farm', label: 'Farm', group: 'Food', about: 'Sows fields round it and reaps the grain.', cost: { plank: 3, stone: 2 }, kind: 'farm', worker: 'Farmer', tools: true, out: 'grain', time: 4, rest: 3, range: 3 },
	well: { id: 'well', label: 'Well', group: 'Food', about: 'Draws water.', cost: { plank: 2 }, kind: 'make', worker: 'Water carrier', inputs: [], out: 'water', time: 8 },
	mill: { id: 'mill', label: 'Mill', group: 'Food', about: 'Grinds grain into flour.', cost: { plank: 2, stone: 2 }, kind: 'make', worker: 'Miller', tools: true, inputs: [['grain']], out: 'flour', time: 7 },
	bakery: { id: 'bakery', label: 'Bakery', group: 'Food', about: 'Bakes bread from flour and water.', cost: { plank: 2, stone: 2 }, kind: 'make', worker: 'Baker', tools: true, inputs: [['flour'], ['water']], out: 'bread', time: 8 },
	livestock: { id: 'livestock', label: 'Livestock farm', group: 'Food', about: 'Raises pigs on grain and water, for meat.', cost: { plank: 3, stone: 1 }, kind: 'make', worker: 'Herder', tools: true, inputs: [['grain'], ['water']], out: 'meat', time: 10 },
	coalmine: { id: 'coalmine', label: 'Coal mine', group: 'Mining', about: 'Digs coal; miners eat fish, bread or meat. Build on dark rock.', cost: { plank: 4 }, kind: 'mine', worker: 'Miner', tools: true, inputs: [FOOD], out: 'coal', time: 8, on: 'mountain', ore: 'coal' },
	ironmine: { id: 'ironmine', label: 'Iron mine', group: 'Mining', about: 'Digs iron ore; miners eat. Build on rust-red rock.', cost: { plank: 4 }, kind: 'mine', worker: 'Miner', tools: true, inputs: [FOOD], out: 'ironOre', time: 8, on: 'mountain', ore: 'iron' },
	goldmine: { id: 'goldmine', label: 'Gold mine', group: 'Mining', about: 'Digs gold ore; miners eat. Build on glittering rock.', cost: { plank: 4 }, kind: 'mine', worker: 'Miner', tools: true, inputs: [FOOD], out: 'goldOre', time: 9, on: 'mountain', ore: 'gold' },
	smelter: { id: 'smelter', label: 'Smelter', group: 'Metal', about: 'Smelts iron ore with coal into iron.', cost: { plank: 2, stone: 3 }, kind: 'make', worker: 'Smelter', tools: true, inputs: [['ironOre'], ['coal']], out: 'iron', time: 9 },
	toolmaker: { id: 'toolmaker', label: 'Toolmaker', group: 'Metal', about: 'Makes tools from iron and planks: every new worker needs some.', cost: { plank: 2, stone: 2 }, kind: 'make', worker: 'Toolmaker', inputs: [['iron'], ['plank']], out: 'tools', time: 10 },
	mint: { id: 'mint', label: 'Mint', group: 'Metal', about: 'Strikes coins from gold ore and coal; the valley trades with them.', cost: { plank: 2, stone: 3 }, kind: 'make', worker: 'Minter', tools: true, inputs: [['goldOre'], ['coal']], out: 'coin', time: 12 },
	market: { id: 'market', label: 'Market hall', group: 'Trade', about: 'Its trader carts what you sell to the fair and brings back what you buy. Set your orders in the Market.', cost: { plank: 4, stone: 3 }, kind: 'market', worker: 'Trader' },
	boundary: { id: 'boundary', label: 'Boundary stone', group: 'Trade', about: 'Widens your land once it stands. It cannot take land a neighbour already holds.', cost: { plank: 1, stone: 3 }, kind: 'land', radius: 6 },
	village: { id: 'village', label: 'Village', group: '', about: 'A neighbour settlement.', cost: {}, kind: 'village', radius: 6 },
	fair: { id: 'fair', label: 'The fair', group: '', about: 'The valley’s open market: every settlement’s traders come here to sell and buy.', cost: {}, kind: 'fair' }
};

/** the build menu, in its groups */
export const GROUPS = ['Basics', 'Food', 'Mining', 'Metal', 'Trade'];
export const MENU = GROUPS.map((g) => ({ group: g, types: Object.values(BUILDINGS).filter((b) => b.group === g) }));

/** buildings that hold land */
export const holdsLand = (/** @type {string} */ type) => type === 'hq' || BUILDINGS[type]?.kind === 'land' || BUILDINGS[type]?.kind === 'village';

/** what the headquarters holds as a game starts */
export const START = {
	stock: { log: 6, plank: 32, stone: 22, grain: 2, water: 8, fish: 10, bread: 6, meat: 4, coal: 6, ironOre: 4, iron: 4, tools: 20, coin: 60 },
	settlers: 28
};

/** the win: every settlement (yours and each neighbour's) lives this well, with this many people, for this long */
export const ABUNDANT = 80, PEOPLE = 40, HOLD = 600;

/** the goals of a game, in order: its last is the win */
export const GOALS = [
	{ id: 'wood', label: 'Run a woodcutter and a sawmill', hint: 'Build both near trees and connect them to your headquarters with roads.' },
	{ id: 'planks', label: 'Saw 12 planks', ware: 'plank', n: 12 },
	{ id: 'food', label: 'Gather 25 food (fish, bread or meat)', ware: 'food', n: 25 },
	{ id: 'market', label: 'Build a market hall and sell at the fair', hint: 'Open the Market and set a sell order: your trader carts the wares to the fair.' },
	{ id: 'trade', label: 'Trade 80 wares at the fair', n: 80 },
	{ id: 'contract', label: 'Fill a neighbour’s request', hint: 'Neighbours ask for what they lack. Take a request in the Market, and your trader brings it.' },
	{ id: 'abundance', label: `Every settlement at wellbeing ${ABUNDANT} with ${PEOPLE} people, for 10 minutes`, hint: 'Wellbeing is how well a settlement lives: fed, with variety, watered, housed and with something put by. Settlements that live well grow. It counts once the other goals are reached.' }
];
