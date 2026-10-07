/**
 * SANDBOX 6 · THE RULES — every ware, every building and what it makes, in one table.
 *
 * A valley economy in the spirit of the old settler games, its own names and its own numbers: wares lie at flags and
 * carriers bring them, one carrier to a road, from flag to flag, to whoever needs them. A building is a site until a
 * builder has used up its planks and stone; then a worker moves in and it runs its chain:
 *
 *   trees → woodcutter → logs → sawmill → planks                  (a forester plants new trees)
 *   rocks → quarry → stone
 *   water's edge → fishery → fish          field → farm → grain → mill → flour ┐
 *   well → water ────────────────────────────────────────────────────────────┴→ bakery → bread
 *   grain + water → livestock farm → meat
 *   fish | bread | meat → coal mine, iron mine, gold mine → coal, iron ore, gold ore
 *   iron ore + coal → smelter → iron;  iron + planks → toolmaker → tools;  iron + coal → armourer → weapons
 *   gold ore + coal → mint → coins (coins train soldiers a rank up)
 *   a settler + weapons → a soldier (in a storehouse);  soldiers hold guard huts and towers, which widen the land
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
	weapons: { id: 'weapons', label: 'Weapons', color: '#59626e' },
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
 * @property {'warehouse'|'make'|'mine'|'gather'|'forester'|'farm'|'military'} kind
 * @property {string} [worker] who works it
 * @property {boolean} [tools] its worker needs tools to start
 * @property {string[][]} [inputs] each slot takes any one of its wares
 * @property {string} [out] the ware it makes
 * @property {number} [time] seconds for one ware (made inside), or one job out in the land
 * @property {number} [rest] seconds between jobs out in the land
 * @property {number} [range] how far its worker goes out
 * @property {'mountain'|'grass'} [on] the land it stands on (grass by default)
 * @property {string} [ore] the ore a mine digs
 * @property {number} [radius] the land a military building holds
 * @property {number} [capacity] how many soldiers it houses
 */

/** @type {Record<string, BuildingType>} */
export const BUILDINGS = {
	hq: { id: 'hq', label: 'Headquarters', group: '', about: 'Your first storehouse and garrison: settlers, tools and soldiers start here.', cost: {}, kind: 'warehouse', radius: 9, capacity: 99 },
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
	armourer: { id: 'armourer', label: 'Armourer', group: 'Metal', about: 'Forges weapons from iron and coal; a settler with weapons is a soldier.', cost: { plank: 2, stone: 2 }, kind: 'make', worker: 'Armourer', tools: true, inputs: [['iron'], ['coal']], out: 'weapons', time: 11 },
	mint: { id: 'mint', label: 'Mint', group: 'Metal', about: 'Strikes coins from gold ore and coal; coins train soldiers a rank up.', cost: { plank: 2, stone: 3 }, kind: 'make', worker: 'Minter', tools: true, inputs: [['goldOre'], ['coal']], out: 'coin', time: 12 },
	guardhut: { id: 'guardhut', label: 'Guard hut', group: 'Military', about: 'Two soldiers; widens your land a little.', cost: { plank: 2, stone: 1 }, kind: 'military', radius: 6, capacity: 2 },
	watchtower: { id: 'watchtower', label: 'Watchtower', group: 'Military', about: 'Five soldiers; widens your land far.', cost: { plank: 3, stone: 4 }, kind: 'military', radius: 8, capacity: 5 },
	keep: { id: 'keep', label: 'Rival keep', group: '', about: 'The rival’s seat. Take it and the valley is yours.', cost: {}, kind: 'military', radius: 9, capacity: 12 }
};

/** the build menu, in its groups */
export const GROUPS = ['Basics', 'Food', 'Mining', 'Metal', 'Military'];
export const MENU = GROUPS.map((g) => ({ group: g, types: Object.values(BUILDINGS).filter((b) => b.group === g) }));

/** buildings that hold land and soldiers */
export const holdsLand = (/** @type {string} */ type) => type === 'hq' || BUILDINGS[type]?.kind === 'military';

/** the highest rank a soldier reaches (four ranks: 0…3) */
export const MAX_RANK = 3;
export const RANKS = ['Recruit', 'Private', 'Sergeant', 'Captain'];

/** what the headquarters holds as a game starts */
export const START = {
	stock: { log: 6, plank: 32, stone: 22, grain: 2, water: 2, fish: 6, bread: 4, meat: 2, coal: 6, ironOre: 4, iron: 4, tools: 20, weapons: 2 },
	settlers: 28,
	soldiers: [0, 0, 0, 1, 1, 2]
};

/** the goals of a game, in order: its last is the win */
export const GOALS = [
	{ id: 'wood', label: 'Run a woodcutter and a sawmill', hint: 'Build both near trees and connect them to your headquarters with roads.' },
	{ id: 'planks', label: 'Saw 12 planks', ware: 'plank', n: 12 },
	{ id: 'food', label: 'Gather 15 food (fish, bread or meat)', ware: 'food', n: 15 },
	{ id: 'iron', label: 'Smelt 6 iron', ware: 'iron', n: 6 },
	{ id: 'weapons', label: 'Forge 6 weapons', ware: 'weapons', n: 6 },
	{ id: 'land', label: 'Hold 3 military buildings', hint: 'Guard huts and watchtowers widen your land once a soldier moves in.' },
	{ id: 'keep', label: 'Take the rival keep', hint: 'Select a rival building near your land and send soldiers to attack it.' }
];
