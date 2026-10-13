// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · SHARED CONSTANTS — the goods' indices, the laws' fixed numbers, the dispatch order and the codes the
 * binding-limit badge uses. Everything else is a setting (./genesis.js DEFAULTS) or a catalog number
 * (./primitives.js).
 */
import { GOODS } from './primitives.js';

/** goods by index: the four basics first */
export const FOOD = 0, WATER = 1, ENERGY = 2, BED = 3, WOOD = 4, STEEL = 5, GLASS = 6, PANEL = 7, GOODS_ = 8, SPRING = 9, COMPUTE = 10;
export const G = GOODS.length;
export const GOOD_IDS = GOODS.map((g) => g.id);
export const GOOD_INDEX = Object.fromEntries(GOOD_IDS.map((id, i) => [id, i]));
export const BASICS = [FOOD, WATER, ENERGY, BED];
/** what people buy: the basics and the extras */
export const CONSUMER = [FOOD, WATER, ENERGY, BED, GOODS_, SPRING, COMPUTE];
/** the extras an Aven buys above the basic bundle (Stone–Geary with satiation) */
export const EXTRAS = [FOOD, WATER, ENERGY, GOODS_, SPRING, COMPUTE];
export const NX = EXTRAS.length;
/** what COOPs buy from each other as materials (energy is bought through the dispatch) */
export const MATERIALS = [WOOD, STEEL, GLASS, PANEL];

/** the laws' numbers that are not settings */
export const POOL_SHARE = 0.1; // a tenth of the treasury half of each HEART goes into the pools
export const FEE = 0.003; // pool fee, kept in the pool
export const GAMMA = 1 - FEE;
export const MAX_COOPS = 48; // MIND slots: the genesis COOPs and room for Law 3 foundings (a slot is never reused: its MIND lives on with its holders)
export const IN_HAND = 5; // forward margin: days of need in hand (Sandbox 7 research)

/** energy dispatch classes, in order (world model 4.3 step 4) */
export const CLASS = { basics: 0, running: 1, building: 2, rd: 3, storage: 4 };
export const CLASS_NAMES = ['basics', 'running', 'building', 'R&D', 'storage'];

/** what limits a good today (world model 5.6) */
export const LIMIT = { none: 0, capacity: 1, land: 2, water: 3, energy: 4, wood: 5, steel: 6, glass: 7, panel: 8, ore: 9, sand: 10, ramp: 11, mind: 12, nature: 13, demand: 14, logs: 15, noSeller: 16, notBuilt: 17, chips: 18, treasury: 19, noSlot: 20 };
/** 'no seller' and 'not built' are institutional causes, not physical ones: plants stand idle with the City COOP, or
 * free land lies unused while a good is short */
export const LIMIT_NAMES = ['need met', 'built capacity', 'land', 'water', 'energy', 'material: glulam', 'material: steel', 'material: glass', 'material: panels', 'material: ore', 'material: sand', 'ramp (age)', 'MIND', 'nature (sun, rain, spring)', 'demand', 'material: logs', 'no seller (plants idle with the City COOP)', 'not built (free land, no project)', 'accelerators (none can be made or imported)', 'COOP treasury (cannot carry the build)', 'no MIND slot free (no new COOP can open)'];
/** the codes that name an institution, not physics: 'MIND' (a person cannot pay) is kept apart, it is the one the
 * proof forbids for a basic */
export const INSTITUTIONAL = [16, 17, 19, 20];
/** the codes that are physics (or the closed border) */
export const PHYSICAL = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 18];
export const LIMIT_OF_GOOD = { [WOOD]: LIMIT.wood, [STEEL]: LIMIT.steel, [GLASS]: LIMIT.glass, [PANEL]: LIMIT.panel };
