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
 *   melts by 7 % a year of virtual time, continuously.
 * - Every decision (the settings, and payouts of MIND from a COOP's treasury to any wallet) is a MIP, as in Sandbox 7.
 *   It needs two signatures, and applies at once in this same game (no new world).
 * - The euro border (Samuel 2026-10-14): each player's first mint, the starter pack of a year of HEARTS, also brings as
 *   many €uro into the MaiaCity COOP, minted by the system as an invest of its own (the euro ingest); later mints bring
 *   none. Euros make no MIND and do not melt: the MaiaCity COOP holds them for the city (its treasury's EURO).
 *
 * The same code runs on the server (which holds the one true game) and in the page (which ticks the numbers between
 * reloads). Every function here is pure: it takes a state and returns a new one.
 */

import { checkViewCard } from '../genui/views.js';
import { SLOTS, SLOT_NAMES } from './views.js';

export const DAY_MS = 86_400_000;
/** one virtual month per real day */
export const MONTH_MS = DAY_MS;
export const TOKENS = ['HEARTS', 'MAIA', 'TRIBE', 'VILLAGE'];
/** the MINDs, one a COOP */
export const MINDS = ['MAIA', 'TRIBE', 'VILLAGE'];
export const TOKEN_LABEL = { HEARTS: 'HEARTS', MAIA: 'maiaMIND', TRIBE: 'tribeMIND', VILLAGE: 'villageMIND', EURO: '€uro' };
/** the euro the city holds, in the MaiaCity COOP's treasury: no MIND, never melting (the euro ingest, act 'mint') */
export const EURO = 'EURO';
export const TOKEN_COLOUR = { MAIA: '#5f8f6e', TRIBE: '#c87a4f', VILLAGE: '#4f7fa8' };
/** a game kept from before this shape is started again (api/src/maiacity-v1.js), its seats kept */
export const VERSION = 14;
export const SEATS = ['A', 'B'];
export const COOPS = {
	maia: { name: 'MaiaCity COOP', mind: 'MAIA', assets: [{ id: 'hex', name: 'The tribe hex', kind: 'Land' }, { id: 'pool', name: 'The AMM pool', kind: 'Liquidity: maiaMIND, tribeMIND, villageMIND' }] },
	tribe: { name: 'Tribe COOP', mind: 'TRIBE', assets: [{ id: 'tent', name: 'The 2-person bell tent', kind: 'Bell tent · home for 2' }] },
	village: { name: 'Village COOP', mind: 'VILLAGE', assets: [{ id: 'pickup', name: 'The pickup', kind: 'Vehicle' }, { id: 'powercube', name: 'The ElectroCube', kind: 'Generator' }, { id: 'solar', name: 'A solar panel', kind: 'Power' }, { id: 'battery', name: 'The BatteryCube', kind: 'Storage' }] }
};
/** the seeds every newcomer brings from home in their backpack, one to plant as their first tree (Samuel 2026-10-13,
 *  2026-10-14: ten trees that bear fruit, nuts or seeds): trees that grow outdoors in a central European climate, from
 *  the Plants ($lib/plants: the page grows them from their stages, from the seed on) */
export const SEEDLINGS = [
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
];
/** seeds the backpack held before (a pick of one still plants) */
const FORMER_SEEDS = ['blackcurrant'];
/** where a first tree may stand on the tribe's hex, in metres from its centre (Samuel 2026-10-14): outside the core
 *  circle where the homes are built, inside the hex (its inner radius is 99.4 m), and not on the other's: 6 m from it, room for both crowns */
export const PLOT = { core: 24, edge: 95, apart: 6 };
const MAX_LEDGER = 3000;
const DUST = 1e-9;
/** an amount asked for may exceed what is held by this much (the melt between a look and a click): it takes all */
const SLACK = 0.005;

export const DEFAULT_SETTINGS = {
	/** real hours a game month lasts (24: a month a real day) */
	hoursPerMonth: 24,
	/** how far back the right to mint reaches, in real hours */
	mintWindowHours: 24,
	/** signatures a MIP needs before it applies (two seats: 1 or 2) */
	signatures: 2,
	/** each player's first mint brings this starter pack on top of what grew */
	starterPack: 8736,
	heartsPerDay: 24,
	/** a year of virtual time melts every balance by this much */
	demurrage: 0.07,
	/** of every MIND into a treasury, this share goes to the pool */
	poolShare: 0.1,
	/** Law 5, every sale pays its owners: this share of every sale (each rent a COOP is paid) goes at once to the
	 * holders of the COOP's MIND, pro rata, in that MIND (its own treasury and the pool get none) */
	dividendShare: 0.2,
	/** the pool's weights, one per MIND (taken as shares of their sum: 1, 1, 1 is 1/3 each) */
	weightMAIA: 1,
	weightTRIBE: 1,
	weightVILLAGE: 1,
	/** the pool's swap fee, kept in the pool */
	swapFee: 0.003,
	/** every price a game week (Samuel 2026-10-14). Each player to the Tribe COOP, in tribeMIND: the home rent, for
	 * using everything (the tent, the pickup, the power) */
	homeRent: 100,
	/** the tent's own price inside the home rent, shown on the Tribe COOP's price list (nobody pays it apart) */
	tentRent: 10,
	/** the Village COOP to the MaiaCity COOP, for the hex, in maiaMIND */
	hexRent: 100,
	/** the Tribe COOP to the Village COOP, for the machines it uses, in the owner's MIND (villageMIND): 250 a week in all */
	pickupRent: 100,
	powercubeRent: 50,
	batteryRent: 50,
	solarRent: 50
};

/** the rents were a month until 2026-10-14; a game from before starts on the weekly prices (2: the Tribe COOP pays
 * the Village COOP 250 a week, Samuel 2026-10-14) */
export const RENTS_WEEKLY = 2;
const RENT_SETTINGS = ['homeRent', 'tentRent', 'hexRent', 'pickupRent', 'powercubeRent', 'batteryRent', 'solarRent'];

/** what a COOP rents from another, each with the COOP that pays and the setting of its weekly rent; paid to the COOP
 * that owns it, in that COOP's MIND: the chain player → Tribe → Village → MaiaCity */
export const RENTED = [
	{ asset: 'hex', payer: 'village', setting: 'hexRent', label: 'hex' },
	{ asset: 'pickup', payer: 'tribe', setting: 'pickupRent', label: 'pickup' },
	{ asset: 'powercube', payer: 'tribe', setting: 'powercubeRent', label: 'powercube' },
	{ asset: 'battery', payer: 'tribe', setting: 'batteryRent', label: 'battery pack' },
	{ asset: 'solar', payer: 'tribe', setting: 'solarRent', label: 'solar panel' }
];

/** the settings, in words */
export const SETTING_NAMES = { hoursPerMonth: 'Real hours a game month lasts', mintWindowHours: 'Mint window, real hours back', signatures: 'Signatures a MIP needs', starterPack: 'Starter pack, HEARTS on the first mint', heartsPerDay: 'HEARTS a game day', demurrage: 'Demurrage a year (0.07 = 7 %)', poolShare: 'Share of every invested HEART to the city pool', dividendShare: 'Dividend: share of every sale to the MIND holders', swapFee: 'Swap fee', weightMAIA: 'Pool weight of maiaMIND', weightTRIBE: 'Pool weight of tribeMIND', weightVILLAGE: 'Pool weight of villageMIND', homeRent: 'Home rent, each player a week (tribeMIND)', tentRent: 'Tent price inside the home rent, a week (tribeMIND)', hexRent: 'Hex rent, Village COOP a week (maiaMIND)', pickupRent: 'Pickup rent, Tribe COOP a week (villageMIND)', powercubeRent: 'Powercube rent, Tribe COOP a week (villageMIND)', batteryRent: 'Battery pack rent, Tribe COOP a week (villageMIND)', solarRent: 'Solar panel rent, Tribe COOP a week (villageMIND)' };

/** the settings a MIP may change, with their limits */
export const SETTING_LIMITS = {
	hoursPerMonth: [1, 720],
	mintWindowHours: [1, 720],
	signatures: [1, 2],
	starterPack: [0, 10000],
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
	solarRent: [0, 10000]
};

const wallet = () => ({ HEARTS: 0, MAIA: 0, TRIBE: 0, VILLAGE: 0 });

/** a new game, its virtual year 0 starting now */
export function newGame(now = Date.now(), settings = {}) {
	return {
		version: VERSION,
		started: now,
		t: now,
		month: 0,
		week: 0,
		rentsWeekly: RENTS_WEEKLY,
		settings: { ...DEFAULT_SETTINGS, ...settings },
		players: Object.fromEntries(SEATS.map((s) => [s, { seat: s, name: `Player ${s}`, founder: null, wallet: wallet(), lastMint: null, arrears: 0 }])),
		coops: Object.fromEntries(Object.entries(COOPS).map(([id, c]) => [id, { id, ...c, treasury: wallet(), arrears: 0 }])),
		pool: { MAIA: 0, TRIBE: 0, VILLAGE: 0 },
		melt: {},
		ledger: [],
		mips: [],
		seq: 0
	};
}

const clone = (s) => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

/** virtual time in months since year 0 */
export const monthsAt = (s, now) => {
	const a = s.clock ?? { at: s.started, months: 0 };
	return Math.max(0, a.months + (now - a.at) / monthMs(s));
};
/** how long a game month lasts in real ms (a setting; a change re-anchors the clock where it stands, see settle) */
export const monthMs = (s) => (s.settings?.hoursPerMonth ?? DEFAULT_SETTINGS.hoursPerMonth) * 3_600_000;
/** the real time game month `m` (months since year 0) begins */
export const timeOfMonth = (s, m) => {
	const a = s.clock ?? { at: s.started, months: 0 };
	return a.at + (m - a.months) * monthMs(s);
};
/** the real-day number since the start: one mint per day */
export const dayAt = (s, now) => Math.floor(Math.max(0, now - s.started) / DAY_MS);

/** the 13-month calendar: Sol first (it begins on 21 March), March last; 28 days a month, so a year has 364 */
export const MONTHS = ['Sol', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
export const MONTHS_A_YEAR = MONTHS.length;
export const DAYS_A_MONTH = 28;
/** every month starts on a Sunday, so the 1st, 8th, 15th and 22nd are Sundays */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** a calendar date from months since year 0: { year, month 1-13, name, day 1-28, weekday, hour 0-24, months } */
export function dateOf(m) {
	const whole = Math.floor(m);
	const dayF = (m - whole) * DAYS_A_MONTH;
	const day = Math.floor(dayF) + 1;
	const month = (whole % MONTHS_A_YEAR) + 1;
	return { year: Math.floor(whole / MONTHS_A_YEAR), month, name: MONTHS[month - 1], day, weekday: WEEKDAYS[(day - 1) % 7], hour: (dayF % 1) * 24, months: m };
}

/** the virtual calendar now */
export const calendar = (s, now) => dateOf(monthsAt(s, now));

const two = (n) => String(n).padStart(2, '0');
/** a date written the new way, day.month.year: 01.01.00 is 1 Sol of year 0 */
export const dateText = (d) => `${two(d.day)}.${two(d.month)}.${two(d.year)}`;

/** who holds what: [holder id, balances object] for every balance in the game */
function holders(s) {
	const list = SEATS.map((seat) => [`player:${seat}`, s.players[seat].wallet]);
	for (const id of Object.keys(s.coops)) list.push([`coop:${id}`, s.coops[id].treasury]);
	list.push(['pool', s.pool]);
	return list;
}

export const nameOf = (s, who) => {
	if (!who) return '';
	if (who === 'pool') return 'AMM pool (MaiaCity COOP)';
	if (who === 'mint') return 'Mint';
	if (who === 'melt') return 'Demurrage';
	const [kind, id] = who.split(':');
	if (kind === 'player') return s.players[id]?.name ?? `Player ${id}`;
	if (kind === 'coop') return s.coops[id]?.name ?? id;
	return who;
};

function log(s, at, entry) {
	s.seq += 1;
	s.ledger.push({ id: s.seq, at, vm: +monthsAt(s, at).toFixed(4), ...entry });
	if (s.ledger.length > MAX_LEDGER) s.ledger.splice(0, s.ledger.length - MAX_LEDGER);
}

/** melt every balance over `ms` of real time (that many virtual months), counting what melted per holder */
function melt(s, ms) {
	if (ms <= 0 || !s.settings.demurrage) return;
	const f = Math.pow(1 - s.settings.demurrage, ms / monthMs(s) / MONTHS_A_YEAR);
	for (const [who, bal] of holders(s)) {
		for (const k of Object.keys(bal)) {
			if (!bal[k] || k === EURO) continue; // euros do not melt
			const lost = bal[k] * (1 - f);
			bal[k] -= lost;
			const key = `${who}|${k}`;
			s.melt[key] = (s.melt[key] ?? 0) + lost;
		}
	}
}

/** write what melted since the last time as one line per holder and token */
function bookMelt(s, at) {
	for (const [key, amount] of Object.entries(s.melt)) {
		if (amount < 1e-6) continue;
		const [who, token] = key.split('|');
		log(s, at, { kind: 'demurrage', from: who, to: 'melt', token, amount, note: `${(s.settings.demurrage * 100).toFixed(0)} %/yr demurrage this week` });
	}
	s.melt = {};
}

/** the pool's normalised weights, one per MIND, summing to 1 (Balancer's wᵢ) */
export function weights(s) {
	const raw = Object.fromEntries(MINDS.map((t) => [t, s.settings[`weight${t}`] ?? 1]));
	const sum = MINDS.reduce((a, t) => a + raw[t], 0);
	return Object.fromEntries(MINDS.map((t) => [t, raw[t] / sum]));
}

/** the pool's invariant V = Π Bᵢ^wᵢ (0 while a MIND is missing from the basket) */
export function invariant(s) {
	const w = weights(s);
	return MINDS.reduce((v, t) => v * Math.pow(Math.max(0, s.pool[t]), w[t]), 1);
}

/** Balancer's spot price of one `tok` in `inTok` (maiaMIND by default), fee left out: (B_in/w_in)/(B_tok/w_tok);
 * null while either side is empty */
export function price(s, tok = 'TRIBE', inTok = 'MAIA') {
	const w = weights(s);
	if (!(s.pool[inTok] > DUST && s.pool[tok] > DUST)) return null;
	return s.pool[inTok] / w[inTok] / (s.pool[tok] / w[tok]);
}

const isMind = (t) => MINDS.includes(t);

/** Balancer's out-given-in: what `amountIn` of `inTok` buys of `outTok`; the fee is taken from what goes in and stays */
export function quote(s, inTok, outTok, amountIn) {
	if (inTok === outTok || !isMind(inTok) || !isMind(outTok)) return 0;
	const bi = s.pool[inTok];
	const bo = s.pool[outTok];
	if (!(bi > DUST && bo > DUST) || !(amountIn > 0)) return 0;
	const w = weights(s);
	const a = amountIn * (1 - s.settings.swapFee);
	return bo * (1 - Math.pow(bi / (bi + a), w[inTok] / w[outTok]));
}

/** Balancer's in-given-out: how much of `inTok` buys exactly `amountOut` of `outTok` (Infinity if the pool can't) */
function costOf(s, inTok, outTok, amountOut) {
	const bi = s.pool[inTok];
	const bo = s.pool[outTok];
	if (!(bi > DUST && bo > DUST) || amountOut >= bo) return Infinity;
	const w = weights(s);
	return (bi * (Math.pow(bo / (bo - amountOut), w[outTok] / w[inTok]) - 1)) / (1 - s.settings.swapFee);
}

function swapRaw(s, at, who, bal, inTok, outTok, amountIn, note) {
	const out = quote(s, inTok, outTok, amountIn);
	if (!(out > 0)) return 0;
	bal[inTok] -= amountIn;
	s.pool[inTok] += amountIn;
	s.pool[outTok] -= out;
	bal[outTok] += out;
	log(s, at, { kind: 'swap', from: who, to: 'pool', token: inTok, amount: amountIn, out: { token: outTok, amount: out }, note });
	return out;
}

/** pay `amount` of `token` from a holder to another; swap the other MINDs through the pool when short (the most held
 * first); owe the rest */
function payRent(s, at, from, bal, to, toBal, token, amount, note) {
	const others = MINDS.filter((t) => t !== token && bal[t] > DUST).sort((a, b) => bal[b] - bal[a]);
	for (const other of others) {
		if (bal[token] >= amount) break;
		const spend = Math.min(bal[other], costOf(s, other, token, amount - bal[token]));
		if (spend > DUST) swapRaw(s, at, from, bal, other, token, spend, 'swapped to pay rent');
	}
	const paid = Math.max(0, Math.min(bal[token], amount));
	if (paid > DUST) {
		bal[token] -= paid;
		toBal[token] += paid;
		log(s, at, { kind: 'rent', from, to, token, amount: paid, note });
		if (to.startsWith('coop:')) dividend(s, at, s.coops[to.slice(5)], token, paid, note);
	}
	return amount - paid;
}

/**
 * Law 5, every sale pays its owners: a COOP paid `amount` in its own MIND for a sale passes `dividendShare` of it on at
 * once, pro rata, to everyone holding that MIND: the players and the other COOPs' treasuries. Its own treasury and the
 * pool get none. Paid in a MIND not its own, it keeps it all (it has no holders of that MIND to pay).
 */
function dividend(s, at, coop, token, amount, why) {
	if (!coop || token !== coop.mind || !(s.settings.dividendShare > 0)) return;
	const holders = [...SEATS.map((seat) => [`player:${seat}`, s.players[seat].wallet]), ...Object.values(s.coops).filter((c) => c.id !== coop.id).map((c) => [`coop:${c.id}`, c.treasury])].filter(([, b]) => b[token] > DUST);
	const held = holders.reduce((a, [, b]) => a + b[token], 0);
	if (!(held > DUST)) return;
	const pot = Math.min(coop.treasury[token], amount * s.settings.dividendShare);
	coop.treasury[token] -= pot;
	for (const [who, b] of holders) {
		const share = (pot * b[token]) / held;
		b[token] += share;
		log(s, at, { kind: 'dividend', from: `coop:${coop.id}`, to: who, token, amount: share, note: `${(s.settings.dividendShare * 100).toFixed(0)} % of a sale (${why}), for holding ${((b[token] - share) / held * 100).toFixed(1)} % of it` });
	}
}

/** a game month has 4 weeks of 7 days; every week ends in a pay day */
export const WEEKS_A_MONTH = DAYS_A_MONTH / 7;

/** pay day, at the end of every game week (so on the 8th, 15th, 22nd and the next 1st, each a Sunday): each week's
 * rent down the chain (players → Tribe → Village → MaiaCity), and what is still owed. A payer short of the MIND swaps
 * its others through the pool on its own. */
function payDay(s, at) {
	s.week += 1;
	s.month = Math.floor(s.week / WEEKS_A_MONTH);
	const when = `week ${s.week}`;
	bookMelt(s, at);
	const st = s.coops.tribe;
	for (const seat of SEATS) {
		const p = s.players[seat];
		const had = p.arrears > DUST;
		const due = s.settings.homeRent + p.arrears;
		if (due <= DUST) continue;
		p.arrears = payRent(s, at, `player:${seat}`, p.wallet, 'coop:tribe', st.treasury, 'TRIBE', due, `home rent, pay day ${when}${had ? ' (with arrears)' : ''}`);
		if (p.arrears > DUST) log(s, at, { kind: 'arrears', from: `player:${seat}`, to: 'coop:tribe', token: 'TRIBE', amount: p.arrears, note: 'home rent still owed' });
	}
	// what each COOP rents, to the COOP that owns it now (a MIP may move an asset), in that COOP's MIND
	for (const r of RENTED) {
		const owner = ownerOf(s, r.asset);
		const payer = s.coops[r.payer];
		if (!owner || !payer || owner.id === payer.id) continue;
		payer.owed ??= {};
		const had = (payer.owed[r.asset] ?? 0) > DUST;
		const due = (s.settings[r.setting] ?? 0) + (payer.owed[r.asset] ?? 0);
		if (due <= DUST) continue;
		payer.owed[r.asset] = payRent(s, at, `coop:${payer.id}`, payer.treasury, `coop:${owner.id}`, owner.treasury, owner.mind, due, `${r.label} rent, pay day ${when}${had ? ' (with arrears)' : ''}`);
		if (payer.owed[r.asset] > DUST) log(s, at, { kind: 'arrears', from: `coop:${payer.id}`, to: `coop:${owner.id}`, token: owner.mind, amount: payer.owed[r.asset], note: `${r.label} rent still owed` });
	}
}

/** the COOP that owns an asset now */
const ownerOf = (s, asset) => Object.values(s.coops).find((c) => c.assets.some((a) => a.id === asset));

/** the real time the next pay day comes */
export const nextPayDay = (s) => timeOfMonth(s, ((s.week ?? s.month * WEEKS_A_MONTH) + 1) / WEEKS_A_MONTH);

/** bring the game forward to `now`: the melt, and every pay day with its rent, at its own moment */
export function advance(state, now = Date.now()) {
	const s = clone(state);
	// a setting added later (the starter pack) takes its default in a game started before it
	s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
	// a game from before weekly pay days counts its weeks from its months
	s.week ??= s.month * WEEKS_A_MONTH;
	// a game from before the weekly prices takes them, and what it owed on the old monthly ones is forgiven
	if (s.rentsWeekly !== RENTS_WEEKLY) {
		for (const k of RENT_SETTINGS) s.settings[k] = DEFAULT_SETTINGS[k];
		for (const p of Object.values(s.players)) p.arrears = 0;
		for (const c of Object.values(s.coops)) {
			c.arrears = 0;
			c.owed = {};
		}
		s.rentsWeekly = RENTS_WEEKLY;
	}
	if (now <= s.t) return s;
	for (let guard = 0; guard < 400_000; guard++) {
		const pay = nextPayDay(s);
		const next = Math.min(pay, now);
		melt(s, next - s.t);
		s.t = next;
		if (next === pay) payDay(s, next);
		if (next === now) break;
	}
	return s;
}

export class GameError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

const num = (v) => {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) throw new GameError('Give an amount above zero.');
	return n;
};

/**
 * what a seat may mint now: HEARTS grow all the time on the GAME clock, 24 a game day (one a game hour; at a month a
 * real day that is 672 a real day), and are minted whenever the player likes, all that grew since the last mint. The
 * right to mint reaches back the mint window only (24 real hours: one game month): what grew before that is lost.
 * Minted HEARTS stay (they only melt). A player's first mint also brings the starter pack (8,736 HEARTS, a year of growth: 13 months of 672) once.
 * { amount (starter included), starter, grown, since, full: when the window is full and growth starts being lost, lost: what was lost already }
 */
export function mintState(s, seat, now) {
	const p = s.players[seat];
	const since = p.lastMint ?? s.started;
	const reach = (s.settings.mintWindowHours ?? DEFAULT_SETTINGS.mintWindowHours) * 3_600_000;
	const from = Math.max(since, now - reach);
	// game days between two real moments, read off the game clock (so a faster month makes HEARTS grow faster)
	const gameDays = (a, b) => Math.max(0, monthsAt(s, b) - monthsAt(s, a)) * DAYS_A_MONTH;
	const per = s.settings.heartsPerDay;
	const grown = gameDays(from, now) * per;
	const starter = p.starter ? 0 : (s.settings.starterPack ?? DEFAULT_SETTINGS.starterPack);
	return { amount: starter + grown, starter, grown, since, full: since + reach, lost: gameDays(since, from) * per };
}

/** signatures a MIP needs before it is accepted (the default; the game's own is its signatures setting) */
export const SIGNATURES = 2;
export const signaturesOf = (s) => s.settings?.signatures ?? SIGNATURES;
/** where a payout may come from: a COOP's treasury (the pool is never paid out) */
export const PAYERS = Object.keys(COOPS).map((id) => `coop:${id}`);
/** who a payout may go to: any wallet in the game but the pool */
export const PAYEES = [...SEATS.map((s) => `player:${s}`), ...PAYERS];

const balanceOf = (s, who) => (who.startsWith('player:') ? s.players[who.slice(7)]?.wallet : s.coops[who.slice(5)]?.treasury);

/**
 * A MIP (MaiaCity improvement proposal), as in Sandbox 7: a title, a description in prose, and what it changes — any of
 * the game's settings, the COOPs (a new name, the list of assets each owns), and payouts of MIND out of a COOP's
 * treasury into any wallet. The proposer signs it; with two
 * signatures it is accepted and applies at once, in this same game. Either player may reject it; the proposer withdraws.
 */
function checkMip(s, mip) {
	const title = String(mip?.title ?? '').trim().slice(0, 120);
	if (!title) throw new GameError('Give the proposal a title.');
	const description = String(mip?.description ?? '').trim().slice(0, 4000);
	const settings = {};
	for (const [k, [lo, hi]] of Object.entries(SETTING_LIMITS)) {
		if (mip.settings?.[k] == null || mip.settings[k] === '') continue;
		const v = Number(mip.settings[k]);
		if (!Number.isFinite(v) || v < lo || v > hi) throw new GameError(`${k} must be between ${lo} and ${hi}.`);
		if (v !== s.settings[k]) settings[k] = v;
	}
	const payouts = (Array.isArray(mip.payouts) ? mip.payouts : []).slice(0, 20).map((x) => {
		if (!PAYERS.includes(x?.from)) throw new GameError('A payout comes out of a COOP treasury.');
		if (!PAYEES.includes(x.to) || x.to === x.from) throw new GameError('Pay out to another wallet.');
		if (!MINDS.includes(x.token)) throw new GameError('Pay out a MIND.');
		return { from: x.from, to: x.to, token: x.token, amount: num(x.amount) };
	});
	const coops = {};
	for (const [id, c] of Object.entries(mip.coops && typeof mip.coops === 'object' ? mip.coops : {})) {
		const now = s.coops[id];
		if (!now) throw new GameError(`No COOP ${id}.`);
		const change = {};
		if (c?.name != null) {
			const name = String(c.name).trim().slice(0, 60);
			if (!name) throw new GameError('A COOP needs a name.');
			if (name !== now.name) change.name = name;
		}
		if (c?.assets != null) {
			if (!Array.isArray(c.assets) || c.assets.length > 30) throw new GameError('A COOP owns a list of at most 30 assets.');
			const seen = new Set();
			const assets = c.assets.map((x, i) => {
				const name = String(x?.name ?? '').trim().slice(0, 80);
				if (!name) throw new GameError('Every asset needs a name.');
				let aid = String(x?.id ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `asset-${i + 1}`;
				while (seen.has(aid)) aid += '-2';
				seen.add(aid);
				return { id: aid, name, kind: String(x?.kind ?? '').trim().slice(0, 80) };
			});
			if (JSON.stringify(assets) !== JSON.stringify(now.assets)) change.assets = assets;
		}
		if (Object.keys(change).length) coops[id] = change;
	}
	// the game's screens (Samuel, 2026-10-13): view cards, MCP Apps the page runs sandboxed (game/genui/views.js); a MIP
	// puts them in (a card with an id already there replaces it) or takes them out, beside the rules it changes
	const views = (Array.isArray(mip.views) ? mip.views : []).slice(0, 10).map((v) => {
		const r = checkViewCard(v, SLOTS);
		if (r.error) throw new GameError(r.error);
		return r.card;
	});
	const removeViews = (Array.isArray(mip.removeViews) ? mip.removeViews : []).map(String).filter((id) => (s.views ?? []).some((v) => v.id === id) && !views.some((v) => v.id === id));
	if (!Object.keys(settings).length && !payouts.length && !Object.keys(coops).length && !views.length && !removeViews.length) throw new GameError('A proposal changes a setting, a COOP or a screen, or pays out.');
	return { title, description, settings, coops, payouts, ...(views.length ? { views } : {}), ...(removeViews.length ? { removeViews } : {}) };
}

/** what a MIP changes, in words */
export function describe(s, mip) {
	const parts = Object.entries(mip.settings ?? {}).map(([k, v]) => `${SETTING_NAMES[k] ?? k} → ${v}`);
	for (const [id, c] of Object.entries(mip.coops ?? {})) {
		if (c.name) parts.push(`rename ${nameOf(s, `coop:${id}`)} → ${c.name}`);
		if (c.assets) parts.push(`${c.name ?? nameOf(s, `coop:${id}`)} owns ${c.assets.map((x) => x.name).join(', ') || 'nothing'}`);
	}
	for (const x of mip.payouts ?? []) parts.push(`pay ${x.amount.toFixed(2)} ${TOKEN_LABEL[x.token]} from ${nameOf(s, x.from)} to ${nameOf(s, x.to)}`);
	for (const v of mip.views ?? []) parts.push(`${(s.views ?? []).some((x) => x.id === v.id) ? 'new version of the screen' : 'new screen'} ${v.name}${v.data?.slot && v.data.slot !== 'panel' ? ` in ${SLOT_NAMES[v.data.slot]}` : ''}`);
	for (const id of mip.removeViews ?? []) parts.push(`remove the screen ${(s.views ?? []).find((x) => x.id === id)?.name ?? id}`);
	return parts.join('; ');
}

/** what the treasuries lack to pay all of a MIP's payouts (all its payouts from one treasury together), if anything */
function shortOf(s, mip) {
	const need = {};
	for (const x of mip.payouts) need[`${x.from}|${x.token}`] = (need[`${x.from}|${x.token}`] ?? 0) + x.amount;
	for (const [key, amount] of Object.entries(need)) {
		const [from, token] = key.split('|');
		if (amount > balanceOf(s, from)[token] + SLACK) return `${nameOf(s, from)} holds only ${balanceOf(s, from)[token].toFixed(2)} ${TOKEN_LABEL[token]}.`;
	}
	return '';
}

/** a MIP with its signatures is accepted and applies at once, all of it */
function settle(s, mip, now) {
	if (mip.status !== 'open' || mip.signatures.length < signaturesOf(s)) return;
	const short = shortOf(s, mip);
	if (short) throw new GameError(`MIP #${mip.number} can’t apply yet: ${short}`);
	const before = Object.fromEntries(Object.keys(mip.settings).map((k) => [k, s.settings[k]]));
	// a new month length keeps the clock where it stands now and runs on from here at the new speed
	if ('hoursPerMonth' in mip.settings) s.clock = { at: now, months: monthsAt(s, now) };
	Object.assign(s.settings, mip.settings);
	const coopsBefore = {};
	for (const [id, c] of Object.entries(mip.coops ?? {})) {
		coopsBefore[id] = { name: s.coops[id].name, assets: s.coops[id].assets };
		Object.assign(s.coops[id], c);
	}
	for (const x of mip.payouts) {
		const from = balanceOf(s, x.from);
		const amount = Math.min(x.amount, from[x.token]);
		from[x.token] -= amount;
		balanceOf(s, x.to)[x.token] += amount;
		log(s, now, { kind: 'payout', from: x.from, to: x.to, token: x.token, amount, note: `MIP #${mip.number}: ${mip.title}` });
	}
	const viewsBefore = (s.views ?? []).map((v) => ({ id: v.id, name: v.name }));
	if (mip.views?.length || mip.removeViews?.length) {
		const put = mip.views ?? [];
		s.views = (s.views ?? []).filter((v) => !(mip.removeViews ?? []).includes(v.id)).map((v) => put.find((p) => p.id === v.id) ?? v);
		for (const p of put) if (!s.views.some((v) => v.id === p.id)) s.views.push(p);
	}
	mip.status = 'accepted';
	mip.decided = now;
	mip.result = { before, coops: coopsBefore, views: viewsBefore };
	log(s, now, { kind: 'proposal', from: '', to: '', token: '', amount: 0, note: `MIP #${mip.number} accepted: ${mip.title} (${describe(s, mip)})` });
}

/**
 * one move by a player: `{ type, ... }`. The state is advanced to `now` first.
 *   mint                         the HEARTS grown since the last mint (24 h of them at most)
 *   invest { coop, amount }      HEARTS into a COOP
 *   swap { token, to, amount }   a MIND through the pool for another
 *   name { name }                the player's name
 *   mark { x, z }                where the first tree grows on the tribe's hex (metres from its centre, PLOT)
 *   seedling { plant }           pick the seed from the backpack (one of SEEDLINGS), until it is planted
 *   plant { v }                  plant it at the mark: the player's first tree, named after them, a seed in wet earth
 *                                (v: the plant's version in $lib/plants as the page grew it)
 *   water                        water it, once a game month: each watering grows it one game month on (grown)
 *   propose { mip }              a MIP: title, description, settings, coops, payouts and screens (views, removeViews; a view's
 *                                data.slot is 'panel' for a tab of its own or a panel it stands in: game/maiacity-v1/views.js
 *                                SLOTS); the proposer signs it (not
 *                                one made over the MCP, via 'mcp': both players sign that on the page)
 *   sign { number }              sign a MIP: with two signatures it is accepted and applies at once
 *   reject { number, note }      reject a MIP (the proposer withdraws it)
 */
export function act(state, seat, action, now = Date.now()) {
	if (!SEATS.includes(seat)) throw new GameError('No such player.');
	const s = advance(state, now);
	const p = s.players[seat];
	const me = `player:${seat}`;
	switch (action?.type) {
		case 'mint': {
			const m = mintState(s, seat, now);
			if (m.amount < 0.001) throw new GameError('Nothing has grown since your last mint.');
			p.wallet.HEARTS += m.amount;
			p.lastMint = now;
			if (m.starter) {
				p.starter = true;
				log(s, now, { kind: 'mint', from: 'mint', to: me, token: 'HEARTS', amount: m.starter, note: 'the starter pack' });
				// the euro ingest: a newcomer's first year of HEARTS brings as many €uro into the MaiaCity COOP, minted by
				// the system as its own invest (Samuel 2026-10-14); later mints bring none
				const bank = s.coops.maia;
				bank.treasury[EURO] = (bank.treasury[EURO] ?? 0) + m.starter;
				log(s, now, { kind: 'invest', from: 'mint', to: 'coop:maia', token: EURO, amount: m.starter, note: `system minted: the €uro ingest for ${p.name}'s first year of HEARTS` });
			}
			if (m.grown > 1e-6) log(s, now, { kind: 'mint', from: 'mint', to: me, token: 'HEARTS', amount: m.grown, note: m.lost > 0.001 ? `grew since the last mint (${m.lost.toFixed(2)} older than 24 h lost)` : 'grew since the last mint' });
			break;
		}
		case 'invest': {
			const coop = s.coops[action.coop];
			if (!coop) throw new GameError('No such COOP.');
			const n = num(action.amount);
			if (n > p.wallet.HEARTS + SLACK) throw new GameError(`You hold only ${p.wallet.HEARTS.toFixed(2)} HEARTS.`);
			const spend = Math.min(n, p.wallet.HEARTS);
			p.wallet.HEARTS -= spend;
			const half = spend / 2;
			// each HEART: half the MIND to the investor, a poolShare (0.1) to the city pool, the rest (0.4) to the treasury
			const toPool = Math.min(half, spend * s.settings.poolShare);
			p.wallet[coop.mind] += half;
			coop.treasury[coop.mind] += half - toPool;
			s.pool[coop.mind] += toPool;
			log(s, now, { kind: 'invest', from: me, to: `coop:${coop.id}`, token: 'HEARTS', amount: spend, note: `invested into the ${coop.name}` });
			log(s, now, { kind: 'mint', from: 'mint', to: me, token: coop.mind, amount: half, note: 'your half' });
			log(s, now, { kind: 'mint', from: 'mint', to: `coop:${coop.id}`, token: coop.mind, amount: half - toPool, note: `the treasury's share (${((0.5 - toPool / spend) * 100).toFixed(0)} % of the HEARTS)` });
			if (toPool > 0) log(s, now, { kind: 'pool', from: `coop:${coop.id}`, to: 'pool', token: coop.mind, amount: toPool, note: `${(s.settings.poolShare * 100).toFixed(0)} % of the HEARTS invested` });
			break;
		}
		case 'swap': {
			const tok = action.token;
			const to = action.to;
			if (!isMind(tok) || !isMind(to) || tok === to) throw new GameError('Swap one MIND for another.');
			const n = num(action.amount);
			if (n > p.wallet[tok] + SLACK) throw new GameError(`You hold only ${p.wallet[tok].toFixed(2)} ${TOKEN_LABEL[tok]}.`);
			if (!quote(s, tok, to, Math.min(n, p.wallet[tok]))) throw new GameError('The pool needs both MINDs before it can swap them.');
			swapRaw(s, now, me, p.wallet, tok, to, Math.min(n, p.wallet[tok]), 'swap');
			break;
		}
		case 'name': {
			const name = String(action.name ?? '').trim().slice(0, 40);
			if (!name) throw new GameError('Give a name.');
			p.name = name;
			break;
		}
		case 'mark': {
			// the plant stake marks where the first tree will grow, before the seed goes in
			if (p.tree) throw new GameError('Your first tree is already planted.');
			const x = Number(action.x), z = Number(action.z);
			if (!Number.isFinite(x) || !Number.isFinite(z)) throw new GameError('Mark a place on the ground.');
			const r = Math.hypot(x, z);
			if (r < PLOT.core) throw new GameError('Not in the middle: the homes are built there. Plant it further out.');
			if (r > PLOT.edge) throw new GameError('That is beyond your hex.');
			const o = s.players[seat === 'A' ? 'B' : 'A'];
			const theirs = o.tree ?? o.spot;
			if (theirs && Math.hypot(theirs.x - x, theirs.z - z) < PLOT.apart) throw new GameError(`Too close to ${o.name}'s ${o.tree ? 'tree' : 'plant stake'}: keep ${PLOT.apart} m from it.`);
			p.spot = { x: +x.toFixed(2), z: +z.toFixed(2) };
			break;
		}
		case 'seedling': {
			if (p.tree) throw new GameError('Your first tree is already planted.');
			if (!SEEDLINGS.some((x) => x.id === action.plant) && !(FORMER_SEEDS.includes(action.plant) && p.seedling === action.plant)) throw new GameError('No such seed in your backpack.');
			p.seedling = action.plant;
			break;
		}
		case 'plant': {
			// the seed into the ground between the sticks, watered with the bottle: no shoot shows yet
			if (p.tree) throw new GameError('Your first tree is already planted.');
			if (!p.spot) throw new GameError('Mark where it grows first.');
			if (!p.seedling) throw new GameError('Pick a seed from your backpack first.');
			const v = Math.floor(Number(action.v));
			const m = monthsAt(s, now);
			p.tree = { plant: p.seedling, v: v > 0 ? v : null, name: p.name, at: now, months: m, x: p.spot.x, z: p.spot.z, grown: 0, watered: Math.floor(m) };
			break;
		}
		case 'water': {
			// once a game month (a real day): each watering grows the tree one month on; a month without water, it waits
			const t = p.tree;
			if (!t) throw new GameError('Plant your first tree first.');
			const m = Math.floor(monthsAt(s, now));
			if (m <= t.watered) throw new GameError('Watered already. Come back tomorrow.');
			t.grown += 1;
			t.watered = m;
			break;
		}
		case 'propose': {
			const mip = checkMip(s, action.mip);
			s.mips ??= [];
			const short = mip.payouts.length ? shortOf(s, mip) : '';
			if (short) throw new GameError(short);
			const number = s.mips.length + 1;
			// one proposed over the MCP (via 'mcp') carries no signature: both players sign it on the page
			const via = action.mip?.via === 'mcp' ? 'mcp' : 'page';
			const made = { number, ...mip, by: seat, via, at: now, signatures: via === 'mcp' ? [] : [seat], status: 'open', decided: null, note: '' };
			s.mips.push(made);
			log(s, now, { kind: 'proposal', from: me, to: '', token: '', amount: 0, note: `MIP #${number} proposed: ${mip.title}` });
			settle(s, made, now);
			break;
		}
		case 'sign':
		case 'reject': {
			const mip = (s.mips ?? []).find((x) => x.number === Number(action.number));
			if (!mip) throw new GameError('No such MIP.');
			if (mip.status !== 'open') throw new GameError(`MIP #${mip.number} is ${mip.status} already.`);
			if (action.type === 'reject') {
				mip.status = mip.by === seat ? 'withdrawn' : 'rejected';
				mip.decided = now;
				mip.note = String(action.note ?? '').slice(0, 300);
				log(s, now, { kind: 'proposal', from: me, to: '', token: '', amount: 0, note: `MIP #${mip.number} ${mip.status}: ${mip.title}` });
				break;
			}
			if (mip.signatures.includes(seat)) throw new GameError('You signed this MIP already.');
			mip.signatures.push(seat);
			log(s, now, { kind: 'proposal', from: me, to: '', token: '', amount: 0, note: `MIP #${mip.number} signed: ${mip.title}` });
			settle(s, mip, now);
			break;
		}
		default:
			throw new GameError('Unknown move.');
	}
	return s;
}

/** the ledger lines one holder is part of, newest first */
export const ledgerOf = (s, who) => s.ledger.filter((e) => e.from === who || e.to === who).reverse();

/** every rent running now, as the pay day pays it: who pays whom, in which MIND, each weekly pay day (and a month of
 * them), and what is still owed on it */
export function rents(s) {
	const set = { ...DEFAULT_SETTINGS, ...s.settings };
	const out = SEATS.map((seat) => ({ what: 'Home rent', from: `player:${seat}`, to: 'coop:tribe', token: 'TRIBE', weekly: set.homeRent, owed: s.players[seat].arrears ?? 0 }));
	for (const r of RENTED) {
		const owner = ownerOf(s, r.asset);
		const payer = s.coops[r.payer];
		if (!owner || !payer || owner.id === payer.id) continue;
		out.push({ what: `${r.label[0].toUpperCase()}${r.label.slice(1)} rent`, from: `coop:${payer.id}`, to: `coop:${owner.id}`, token: owner.mind, weekly: set[r.setting] ?? 0, owed: payer.owed?.[r.asset] ?? 0 });
	}
	return out.filter((r) => r.weekly > DUST || r.owed > DUST).map((r) => ({ ...r, monthly: r.weekly * WEEKS_A_MONTH }));
}

/** the dividends `who` can expect each pay day at today's holdings: Law 5's share of every rent paid to a COOP in its
 * own MIND, pro rata among that MIND's holders (the COOP's own treasury and the pool get none) */
export function dividendsOf(s, who) {
	const share = s.settings.dividendShare ?? DEFAULT_SETTINGS.dividendShare;
	const out = [];
	for (const r of rents(s)) {
		const c = s.coops[r.to.slice(5)];
		if (!c || r.token !== c.mind || !(share > 0)) continue;
		const holders = [...SEATS.map((seat) => [`player:${seat}`, s.players[seat].wallet]), ...Object.values(s.coops).filter((o) => o.id !== c.id).map((o) => [`coop:${o.id}`, o.treasury])].filter(([, b]) => b[r.token] > DUST);
		const held = holders.reduce((a, [, b]) => a + b[r.token], 0);
		const mine = holders.find(([id]) => id === who);
		if (!mine || !(held > DUST)) continue;
		const weekly = (r.weekly * share * mine[1][r.token]) / held;
		const same = out.find((d) => d.what === r.what && d.from === r.to);
		if (same) same.weekly += weekly;
		else out.push({ what: r.what, from: r.to, token: r.token, weekly });
	}
	return out;
}

/** what actually flowed in and out of `who` on its last `n` pay days, by MIND: the rents, the dividends, and the
 * swaps made to pay rent; newest first */
export function payDaysOf(s, who, n = 8) {
	const weeks = new Map();
	for (const e of s.ledger) {
		if (e.from !== who && e.to !== who) continue;
		const paid = (e.kind === 'rent' || e.kind === 'dividend') && e.note?.includes('pay day');
		if (!paid && !(e.kind === 'swap' && e.note === 'swapped to pay rent')) continue;
		const week = Math.round(e.vm * WEEKS_A_MONTH);
		if (!weeks.has(week)) weeks.set(week, { week, vm: week / WEEKS_A_MONTH, flows: {} });
		const fl = weeks.get(week).flows;
		const add = (token, d) => {
			fl[token] ??= { in: 0, out: 0 };
			if (d > 0) fl[token].in += d;
			else fl[token].out -= d;
		};
		if (e.kind === 'swap') {
			add(e.token, -e.amount);
			add(e.out.token, e.out.amount);
		} else add(e.token, e.to === who ? e.amount : -e.amount);
	}
	return [...weeks.values()].sort((a, b) => b.week - a.week).slice(0, n);
}

/** every MIND in the game, by token: wallets, treasuries and the pool */
export function supply(s) {
	const out = { HEARTS: 0, MAIA: 0, TRIBE: 0, VILLAGE: 0 };
	for (const [, bal] of holders(s)) for (const k of TOKENS) out[k] += bal[k] ?? 0;
	return out;
}

/** HEARTS as the one display currency (Samuel 2026-10-13): what one of each MIND is worth in HEARTS, for showing only,
 * never for a move. Every MIND is born from HEARTS one for one, so the average MIND in existence is worth 1 HEART; the
 * pool's trades say how each MIND stands against the others. Its spot price alone does not: every invest puts its
 * pool share of the new MIND into the pool, so a basket of equal weights fed only by invests prices each MIND at the
 * others' supply over its own, and every COOP came out worth the same whatever went into it (Samuel 2026-10-14: 2,500
 * maiaMIND, 1,000 villageMIND and 500 tribeMIND each 1,333 HEARTS). So each MIND counts by how far the trades moved
 * it: its spot price over the one the pool would have had it held each MIND in proportion to its supply (1:1 before
 * any trade). The MINDs the pool prices are scaled together until their supply-weighted average is 1 HEART
 * (Σ supplyᵢ·valueᵢ = Σ supplyᵢ), and a MIND the pool cannot price yet counts at its mint price, 1 HEART. HEARTS
 * count as 1. */
export function heartsValue(s) {
	const out = { HEARTS: 1, MAIA: 1, TRIBE: 1, VILLAGE: 1 };
	const sup = supply(s), w = weights(s);
	// the spot price with each MIND in the pool in proportion to its supply: (sup_MAIA/w_MAIA)/(sup_t/w_t)
	const even = (t) => (sup.MAIA / w.MAIA) / (sup[t] / w[t]);
	const rel = Object.fromEntries(MINDS.map((t) => [t, t === 'MAIA' ? (s.pool.MAIA > DUST ? 1 : null) : sup[t] > DUST && sup.MAIA > DUST ? (price(s, t, 'MAIA') ?? NaN) / even(t) : null]));
	for (const t of MINDS) if (!Number.isFinite(rel[t])) rel[t] = null;
	const priced = MINDS.filter((t) => rel[t] != null);
	if (priced.length < 2) return out;
	const units = priced.reduce((a, t) => a + sup[t], 0);
	const worth = priced.reduce((a, t) => a + sup[t] * rel[t], 0);
	if (!(units > DUST && worth > DUST)) return out;
	for (const t of priced) out[t] = (rel[t] * units) / worth;
	return out;
}

/** a balance's whole worth in HEARTS (see heartsValue) */
export function inHearts(s, bal, v = heartsValue(s)) {
	return TOKENS.reduce((a, t) => a + (bal[t] ?? 0) * (v[t] ?? 1), 0);
}
