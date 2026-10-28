// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V2: MaiaCOOP owns the land and the two-asset AMM. Village COOP owns the homes, pickup and equipment.
 * Players pay Village rent; Village pays Maia land rent. Investments keep the original split: half to the citizen,
 * poolShare to the pool, the remainder to the cooperative treasury. A third seat (C) has a supply run of its own (a
 * second tent and a ten-litre water can), and a tree is watered from that can, once every real day.
 *
 * The rules themselves are V1's (game/maiacity-v1/core.js, the one code every MaiaCity game plays by); this file is
 * V2's config of them, and the moves and the fork only V2 has.
 */

import { GameError, createEngine } from '../maiacity-v1/core.js';

export const WATER_HOME = { x: 13, z: -6 };
export const WATER_REACH = 2.5;
/** Real-time care is independent of economy-speed proposals. Missed days never accumulate growth. */
export const nextWaterAt = (s, tree) => (tree.wateredAt ?? Math.max(tree.at ?? s.started, s.started + (tree.watered ?? 0) * DAY_MS)) + DAY_MS;
function waterPosition(action) {
	const x = Number(action.x), z = Number(action.z);
	if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > 500) throw new GameError('Walk to the canister or tree first.');
	return { x, z };
}

/** V2 as the one code plays it */
export const V2 = {
	version: 18,
	seats: ['A', 'B', 'C'],
	minds: ['MAIA', 'VILLAGE'],
	coops: {
		maia: { name: 'MaiaCOOP', mind: 'MAIA', assets: [{ id: 'hex', name: 'The shared land', kind: 'Land' }, { id: 'pool', name: 'The AMM pool', kind: 'maiaMIND / villageMIND' }] },
		village: {
			name: 'Village COOP',
			mind: 'VILLAGE',
			assets: [
				{ id: 'tent', name: 'The 2-person bell tent', kind: 'Bell tent · home for 2' },
				{ id: 'pickup', name: 'The pickup', kind: 'Vehicle' },
				{ id: 'powercube', name: 'The ElectroCube', kind: 'Generator' },
				{ id: 'solar', name: 'A solar panel', kind: 'Power' },
				{ id: 'battery', name: 'The BatteryCube', kind: 'Storage' }
			]
		}
	},
	seedlings: [
		{ id: 'apple', label: 'Apple', fruit: 'apples' },
		{ id: 'pear', label: 'Pear', fruit: 'pears' },
		{ id: 'cherry', label: 'Sweet cherry', fruit: 'cherries' },
		{ id: 'plum', label: 'Plum', fruit: 'plums' },
		{ id: 'apricot', label: 'Apricot', fruit: 'apricots' },
		{ id: 'birch', label: 'Silver birch · Birke', fruit: 'winged seeds' },
		{ id: 'mulberry', label: 'Mulberry', fruit: 'mulberries' },
		{ id: 'walnut', label: 'Walnut', fruit: 'walnuts' },
		{ id: 'chestnut', label: 'Sweet chestnut', fruit: 'chestnuts' },
		{ id: 'hazel', label: 'Hazel', fruit: 'hazelnuts' }
	],
	formerSeeds: ['blackcurrant', 'quince'],
	defaults: {
		/** real hours a game month lasts (24: a month a real day) */
		hoursPerMonth: 24,
		/** how far back the right to mint reaches, in real hours */
		mintWindowHours: 24,
		/** signatures a MIP needs before it applies */
		signatures: 2,
		/** each player's first mint brings this starter pack on top of what grew: the 7 % equilibrium (equilibriumOf) */
		starterPack: 124800,
		/** and brings this many €uro into the MaiaCity COOP (the euro ingest) */
		euroIngest: 12500,
		heartsPerDay: 24,
		/** a year of virtual time melts every balance by this much */
		demurrage: 0.07,
		/** of every MIND into a treasury, this share goes to the pool */
		poolShare: 0.1,
		/** Law 5, every sale pays its owners: this share of every sale (each rent a COOP is paid) goes at once to the
		 * holders of the COOP's MIND, pro rata, in that MIND (its own treasury and the pool get none) */
		dividendShare: 0.2,
		/** the pool's swap fee, kept in the pool */
		swapFee: 0.003,
		/** every price a game week (Samuel 2026-10-14). Each player to the Village COOP, in villageMIND: the home rent, for
		 * using everything (the tent, the pickup, the power) */
		homeRent: 100,
		/** the tent's own price inside the home rent, shown on the Village COOP's price list (nobody pays it apart) */
		tentRent: 10,
		/** the Village COOP to the MaiaCity COOP, for the hex, in maiaMIND */
		hexRent: 100
	},
	names: { hoursPerMonth: 'Real hours a game month lasts', mintWindowHours: 'Mint window, real hours back', signatures: 'Signatures a MIP needs', starterPack: 'Starter pack, HEARTS on the first mint', euroIngest: 'Euro ingest, €uro into the MaiaCity COOP on a first mint', heartsPerDay: 'HEARTS a game day', demurrage: 'Demurrage rate a year, continuous (0.07 = 7 %)', poolShare: 'Share of every invested HEART to the city pool', dividendShare: 'Dividend: share of every sale to the MIND holders', swapFee: 'Swap fee', homeRent: 'Home rent, each player a week (villageMIND)', tentRent: 'Tent price inside the home rent, a week (villageMIND)', hexRent: 'Hex rent, Village COOP a week (maiaMIND)' },
	limits: {
		hoursPerMonth: [1, 720],
		mintWindowHours: [1, 720],
		signatures: [1, 3],
		starterPack: [0, 1000000],
		euroIngest: [0, 1000000],
		heartsPerDay: [0, 1000],
		demurrage: [0, 0.5],
		poolShare: [0, 0.5],
		dividendShare: [0, 1],
		hexRent: [0, 10000],
		swapFee: [0, 0.1],
		homeRent: [0, 10000],
		tentRent: [0, 10000]
	},
	rentSettings: ['homeRent', 'tentRent', 'hexRent'],
	/** the chain player → Village → MaiaCOOP; a seat pays once it has a founder or its starter pack */
	home: 'village',
	pays: (p) => !!(p.founder || p.starter),
	rented: [{ asset: 'hex', payer: 'village', setting: 'hexRent', label: 'land' }],
	sublet: [],
	pool: 'product',
	fresh: () => ({ economy: 'maia-village-v1' }),
	adopt(state, now) {
		const s = consolidate(state, now);
		s.water ??= { capacityLitres: 10, litres: 10, at: 'power', ...WATER_HOME, carriedBy: null };
		if (s.water.x == null || s.water.z == null) Object.assign(s.water, WATER_HOME, { at: 'power', carriedBy: null });
		// A disconnected carrier leaves the canister at their last shared position.
		if (s.water.carriedBy && now - (s.water.touchedAt ?? 0) > 60000) s.water.carriedBy = null;
		return s;
	},
	moves: {
		collectShelter(s, seat) {
			if (seat !== 'C') throw new GameError('This is the third settler’s supply run.');
			const p = s.players[seat];
			if (!p.shelter) p.shelter = 'bed';
		},
		settleShelter(s, seat) {
			const p = s.players[seat];
			if (seat !== 'C' || !p.shelter) throw new GameError('Collect the tent and water at the shed first.');
			p.shelter = 'home';
			if (!s.coops.village.assets.some((a) => a.id === 'tent-2')) s.coops.village.assets.push({ id: 'tent-2', name: 'The second 2-person bell tent', kind: 'Bell tent · home for 2', capacity: 2 });
			if (!s.coops.village.assets.some((a) => a.id === 'water-canister')) s.coops.village.assets.push({ id: 'water-canister', name: '10-litre drinking-water canister', kind: 'Water storage', capacityLitres: 10 });
			s.water ??= { capacityLitres: 10, litres: 10, at: 'tent-2' };
		},
		takeWater(s, seat, action, now) {
			const w = s.water, at = waterPosition(action);
			if (w.carriedBy && w.carriedBy !== seat) throw new GameError('Another citizen is carrying the canister.');
			if (Math.hypot(at.x - w.x, at.z - w.z) > WATER_REACH) throw new GameError('Walk closer to the canister.');
			Object.assign(w, at, { carriedBy: seat, touchedAt: now, at: 'carried' });
		},
		carryWater: carry,
		putWater: carry,
		/** water my own tree from the can I carry, standing at it: a litre, once every real day, a month of growth */
		water(s, seat, action, now) {
			const t = s.players[seat].tree;
			if (!t) throw new GameError('Plant your first tree first.');
			if (action.tree && action.tree !== seat) throw new GameError('You can only water your own tree.');
			const w = s.water, at = waterPosition(action);
			if (w.carriedBy !== seat) throw new GameError('Pick up the water canister first.');
			if (Math.hypot(at.x - t.x, at.z - t.z) > WATER_REACH) throw new GameError('Walk to your own tree first.');
			if (now < nextWaterAt(s, t)) throw new GameError('Watered already. Come back after 24 hours.');
			if (w.litres < 1) throw new GameError('The canister is empty.');
			w.litres -= 1;
			Object.assign(w, at, { touchedAt: now });
			t.grown = (t.grown ?? 0) + 1;
			t.watered = Math.floor(monthsAt(s, now));
			t.wateredAt = now;
		}
	}
};

/** the carrier walks the can along (carryWater) or sets it down (putWater) */
function carry(s, seat, action, now) {
	const w = s.water;
	if (w.carriedBy !== seat) throw new GameError('Pick up the canister first.');
	Object.assign(w, waterPosition(action), { touchedAt: now });
	if (action.type === 'putWater') Object.assign(w, { carriedBy: null, at: 'ground' });
}

const engine = createEngine(V2);
export const { DAY_MS, MONTH_MS, TOKENS, MINDS, TOKEN_LABEL, EURO, TOKEN_COLOUR, VERSION, SEATS, COOPS, SEEDLINGS, PLOT, DEFAULT_SETTINGS, defaultSettings, RENTS_WEEKLY, RENTED, SUBLET, SETTING_NAMES, SETTING_LIMITS, newGame, monthsAt, monthMs, timeOfMonth, dayAt, MONTHS, MONTHS_A_YEAR, DAYS_A_MONTH, WEEKDAYS, dateOf, calendar, dateText, nameOf, weights, invariant, price, quote, WEEKS_A_MONTH, nextPayDay, advance, mintState, equilibriumOf, SIGNATURES, signaturesOf, PAYERS, PAYEES, describe, act, ledgerOf, rents, dividendsOf, payDaysOf, supply, heartsValue, inHearts } = engine;
export { GameError };
const { clone } = engine;

/** Clone the V1 snapshot without changing its players, economy, clock or history. */
export function fromV1(snapshot, now = Date.now()) {
	if (!snapshot?.players?.A || !snapshot?.players?.B) throw new GameError('V1 snapshot is missing its players.');
	const state = clone(snapshot);
	state.version = VERSION;
	state.players.C ??= newGame(now, state.settings).players.C;
	state.fork ??= { game: 'maiacity-v1', at: now, sourceTime: snapshot.t };
	return consolidate(state, now);
}

/** Reset V2's economy once, retaining the full old state as an archive and keeping
 * identities and world progress. P1/P2 receive the standard first mint and two investments.
 * P3 keeps her identity/progress and receives a fresh, unminted wallet.
 */
export function consolidate(state, now = Date.now()) {
	if (state.economy === 'maia-village-v1') return clone(state);
	let s = newGame(now);
	s.economyArchive = clone(state);
	s.fork = clone(state.fork ?? { game: 'maiacity-v1', at: now, sourceTime: state.t });
	const empty = () => Object.fromEntries(TOKENS.map((t) => [t, 0]));
	for (const seat of SEATS) {
		const p = state.players[seat];
		if (!p) continue;
		s.players[seat] = { ...clone(p), wallet: empty(), lastMint: null, starter: false, arrears: 0 };
	}
	// Tribe's homes and Village's machines now share Village ownership. Maia retains land.
	for (const [id, c] of Object.entries(state.coops)) {
		const target = s.coops[id === 'maia' ? 'maia' : 'village'];
		for (const asset of c.assets) if (!target.assets.some((a) => a.id === asset.id)) target.assets.push(clone(asset));
	}
	if (state.water) s.water = clone(state.water);
	for (const seat of ['A', 'B']) {
		s = act(s, seat, { type: 'mint' }, now);
		s = act(s, seat, { type: 'invest', coop: 'maia', amount: 50000 }, now);
		s = act(s, seat, { type: 'invest', coop: 'village', amount: 25000 }, now);
	}
	return s;
}
