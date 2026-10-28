// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1: the simplest game of the city. Two players, three COOPs, one hex, one tent, one pool.
 *
 * - Each player's personal HEARTS grow 24 a day (one an hour), minted at any moment: all that grew since the last mint.
 *   The right to mint expires after 24 h, not the HEARTS: growth older than 24 h is lost. HEARTS buy nothing: they are
 *   only invested.
 * - Investing 1 HEART into a COOP makes 1 MIND of that COOP: half to the player's wallet, half to the COOP's treasury.
 * - Three COOPs, each with its own MIND: the MaiaCity COOP (maiaMIND) owns the tribe hex and the AMM pool; the
 *   Tribe COOP (tribeMIND) owns the homes on its hex, the 2-person bell tent; the Village COOP (villageMIND)
 *   owns the pickup, the powercube (the ElectroCube: OSE's Power Cube frame with an alternator), a solar panel and the
 *   battery (the BatteryCube: four BatteryPacks and an inverter in the same frame).
 * - A tenth of every treasury half (5 % of each invested HEART's MIND) goes into the MaiaCity COOP's pool: a Balancer weighted pool, one
 *   basket of all three MINDs with equal weights (1/3 each, settings a MIP may change). Its invariant is
 *   V = Π Bᵢ^wᵢ; any MIND swaps for any other by Balancer's maths (out = Bₒ·(1 − (Bᵢ/(Bᵢ + Aᵢ·(1 − fee)))^(wᵢ/wₒ))),
 *   so V never falls. It is never paid out; anyone can swap through it (the 0.3 % fee stays in the pool).
 * - Rent, every price a week, paid on the pay day that ends every game week (Samuel 2026-10-14), down one chain: each
 *   player pays the Tribe COOP one home rent in tribeMIND and uses everything (the tent, the pickup, the power); the
 *   Tribe COOP rents the Village COOP's pickup, powercube, battery pack and solar panel; the Village COOP rents the
 *   MaiaCity COOP's hex. Each rent goes to whichever COOP owns the asset, in that COOP's MIND. A payer who lacks the MIND
 *   swaps its others through the pool on its own; what is still missing is owed (arrears) and paid first next pay day.
 * - Time: one virtual month per real day, from virtual year 0, on the 13-month calendar: 13 months of 28 days, the
 *   year begins with Sol (from 21 March, the new year) and ends with March; every month starts on a Sunday. Every balance (HEARTS, wallets, treasuries, the pool)
 *   melts continuously at the rate of 7 % a year of virtual time (b·e^(-0.07 t), as in the theOS paper).
 * - Every decision (the settings, and payouts of MIND from a COOP's treasury to any wallet) is a MIP.
 *   It needs two signatures, and applies at once in this same game (no new world).
 * - The first mint (Samuel 2026-10-15): the starter pack is the whole 7 % equilibrium at once, the balance at which a
 *   year of HEARTS grown equals the year's melt (heartsPerDay a game day over the 7 % rate: 8,736 / 0.07 = 124,800 HEARTS).
 * - The euro border (Samuel 2026-10-14, 2026-10-15): each player's first mint also brings €12,500 into the MaiaCity
 *   COOP, minted by the system as an invest of its own (the euro ingest); later mints bring none. Euros make no MIND
 *   and do not melt: the MaiaCity COOP holds them for the city (its treasury's EURO).
 *
 * The rules themselves are the one code every MaiaCity game plays by (./core.js); this file is V1's config of them.
 */

import { configAt } from '../code/index.js';
import { createEngine } from './core.js';

/** where the settings a new game starts with are kept: the Maia City COOP's vault (A3), else the repo's seed of them */
export const SETTINGS_CONFIG = 'configs/maiacity-v1/settings';

/** the settings as the repo seeds them (code/configs/maiacity-v1/settings): the clock (hoursPerMonth, mintWindowHours),
 * MIP signatures, a first mint's starter pack and euro ingest, HEARTS a day, demurrage, the pool's share, weights and
 * fee, Law 5's dividend share, and the weekly rents of the chain player → Tribe → Village → MaiaCity */
const SEEDED = configAt(SETTINGS_CONFIG);

/** the settings a MIP may change, with their limits */
const LIMITS = {
	hoursPerMonth: [1, 720],
	mintWindowHours: [1, 720],
	signatures: [1, 2],
	starterPack: [0, 1000000],
	euroIngest: [0, 1000000],
	heartsPerDay: [0, 1000],
	demurrage: [0, 0.5],
	poolShare: [0, 0.5],
	dividendShare: [0, 1],
	weightMAIA: [0.1, 10],
	weightTRIBE: [0.1, 10],
	weightVILLAGE: [0.1, 10],
	swapFee: [0, 0.1],
	homeRent: [0, 10000],
	tentRent: [0, 10000],
	hexRent: [0, 10000],
	pickupRent: [0, 10000],
	powercubeRent: [0, 10000],
	batteryRent: [0, 10000],
	solarRent: [0, 10000],
	hexSubRent: [0, 10000]
};

/** V1 as the one code plays it */
export const V1 = {
	version: 17,
	seats: ['A', 'B'],
	minds: ['MAIA', 'TRIBE', 'VILLAGE'],
	coops: {
		maia: { name: 'MaiaCity COOP', mind: 'MAIA', assets: [{ id: 'hex', name: 'The tribe hex', kind: 'Land' }, { id: 'pool', name: 'The AMM pool', kind: 'Liquidity: maiaMIND, tribeMIND, villageMIND' }] },
		tribe: { name: 'Tribe COOP', mind: 'TRIBE', assets: [{ id: 'tent', name: 'The 2-person bell tent', kind: 'Bell tent · home for 2' }] },
		village: { name: 'Village COOP', mind: 'VILLAGE', assets: [{ id: 'pickup', name: 'The pickup', kind: 'Vehicle' }, { id: 'powercube', name: 'The ElectroCube', kind: 'Generator' }, { id: 'solar', name: 'A solar panel', kind: 'Power' }, { id: 'battery', name: 'The BatteryCube', kind: 'Storage' }] }
	},
	/** the seeds every newcomer brings from home in their backpack, one to plant as their first tree (Samuel 2026-10-13,
	 *  2026-10-14: ten trees that bear fruit, nuts or seeds): trees that grow outdoors in a central European climate,
	 *  from the Plants ($lib/plants: the page grows them from their stages, from the seed on) */
	seedlings: [
		{ id: 'apple', label: 'Apple', fruit: 'apples' },
		{ id: 'pear', label: 'Pear', fruit: 'pears' },
		{ id: 'cherry', label: 'Sweet cherry', fruit: 'cherries' },
		{ id: 'plum', label: 'Plum', fruit: 'plums' },
		{ id: 'apricot', label: 'Apricot', fruit: 'apricots' },
		{ id: 'quince', label: 'Quince', fruit: 'quinces' },
		{ id: 'mulberry', label: 'Mulberry', fruit: 'mulberries' },
		{ id: 'walnut', label: 'Walnut', fruit: 'walnuts' },
		{ id: 'chestnut', label: 'Sweet chestnut', fruit: 'chestnuts' },
		{ id: 'hazel', label: 'Hazel', fruit: 'hazelnuts' }
	],
	formerSeeds: ['blackcurrant'],
	defaults: SEEDED,
	/**
	 * The settings a new game starts with now: the vault's once it is loaded (game/code/index.js `loadCode`), each value
	 * the game's limits refuse (LIMITS) the seed's.
	 */
	settings() {
		const got = configAt(SETTINGS_CONFIG);
		const out = { ...SEEDED };
		for (const [k, [lo, hi]] of Object.entries(LIMITS)) if (typeof got[k] === 'number' && got[k] >= lo && got[k] <= hi) out[k] = got[k];
		return out;
	},
	names: { hoursPerMonth: 'Real hours a game month lasts', mintWindowHours: 'Mint window, real hours back', signatures: 'Signatures a MIP needs', starterPack: 'Starter pack, HEARTS on the first mint', euroIngest: 'Euro ingest, €uro into the MaiaCity COOP on a first mint', heartsPerDay: 'HEARTS a game day', demurrage: 'Demurrage rate a year, continuous (0.07 = 7 %)', poolShare: 'Share of every invested HEART to the city pool', dividendShare: 'Dividend: share of every sale to the MIND holders', swapFee: 'Swap fee', weightMAIA: 'Pool weight of maiaMIND', weightTRIBE: 'Pool weight of tribeMIND', weightVILLAGE: 'Pool weight of villageMIND', homeRent: 'Home rent, each player a week (tribeMIND)', tentRent: 'Tent price inside the home rent, a week (tribeMIND)', hexRent: 'Hex rent, Village COOP a week (maiaMIND)', pickupRent: 'Pickup rent, Tribe COOP a week (villageMIND)', powercubeRent: 'Powercube rent, Tribe COOP a week (villageMIND)', batteryRent: 'Battery pack rent, Tribe COOP a week (villageMIND)', solarRent: 'Solar panel rent, Tribe COOP a week (villageMIND)', hexSubRent: 'Hex rent, Tribe COOP to the Village COOP, a player a week (villageMIND)' },
	limits: LIMITS,
	rentSettings: ['homeRent', 'tentRent', 'hexRent', 'pickupRent', 'powercubeRent', 'batteryRent', 'solarRent', 'hexSubRent'],
	/** the chain player → Tribe → Village → MaiaCity */
	home: 'tribe',
	rented: [
		{ asset: 'hex', payer: 'village', setting: 'hexRent', label: 'hex' },
		{ asset: 'pickup', payer: 'tribe', setting: 'pickupRent', label: 'pickup' },
		{ asset: 'powercube', payer: 'tribe', setting: 'powercubeRent', label: 'powercube' },
		{ asset: 'battery', payer: 'tribe', setting: 'batteryRent', label: 'battery pack' },
		{ asset: 'solar', payer: 'tribe', setting: 'solarRent', label: 'solar panel' }
	],
	sublet: [{ asset: 'hex', payer: 'tribe', setting: 'hexSubRent', label: 'hex', key: 'hexSub' }],
	pool: 'weighted'
};

export const { GameError, DAY_MS, MONTH_MS, TOKENS, MINDS, TOKEN_LABEL, EURO, TOKEN_COLOUR, VERSION, SEATS, COOPS, SEEDLINGS, PLOT, DEFAULT_SETTINGS, defaultSettings, RENTS_WEEKLY, RENTED, SUBLET, SETTING_NAMES, SETTING_LIMITS, newGame, monthsAt, monthMs, timeOfMonth, dayAt, MONTHS, MONTHS_A_YEAR, DAYS_A_MONTH, WEEKDAYS, dateOf, calendar, dateText, nameOf, weights, invariant, price, quote, WEEKS_A_MONTH, nextPayDay, advance, mintState, equilibriumOf, SIGNATURES, signaturesOf, PAYERS, PAYEES, describe, act, ledgerOf, rents, dividendsOf, payDaysOf, supply, heartsValue, inHearts } = createEngine(V1);
