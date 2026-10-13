// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1: the simplest game of the city. Two players, two COOPs, one hex, one tent, one pool.
 *
 * - Each player mints 24 personal HEARTS once a day. HEARTS buy nothing: they are only invested. A player who does
 *   not mint again within 24 hours of the last mint loses the HEARTS still held.
 * - Investing 1 HEART into a COOP makes 1 MIND of that COOP: half to the player's wallet, half to the COOP's treasury.
 * - The MaiaCity COOP (MaiaMIND) owns the shared hex. The Settlement COOP (VillageMIND) owns the 2-person dome tent.
 * - 5 % of every MIND that lands in a treasury goes into one protocol-owned constant-product pool, MaiaMIND/VillageMIND.
 *   No one can take it out; anyone can swap through it (0.3 % fee stays in the pool).
 * - Rent, every virtual month: each player pays the Settlement COOP for the tent in VillageMIND; the Settlement COOP pays
 *   the MaiaCity COOP for the hex in MaiaMIND. A payer who lacks the MIND swaps the other one through the pool; what is
 *   still missing is owed (arrears) and paid first next month.
 * - Time: one virtual month per real day, from virtual year 0. Every balance (HEARTS, wallets, treasuries, the pool)
 *   melts by 7 % a year of virtual time, continuously.
 *
 * The same code runs on the server (which holds the one true game) and in the page (which ticks the numbers between
 * reloads). Every function here is pure: it takes a state and returns a new one.
 */

export const DAY_MS = 86_400_000;
/** one virtual month per real day */
export const MONTH_MS = DAY_MS;
export const TOKENS = ['HEARTS', 'MAIA', 'VILLAGE'];
export const TOKEN_LABEL = { HEARTS: 'HEARTS', MAIA: 'MaiaMIND', VILLAGE: 'VillageMIND' };
export const SEATS = ['A', 'B'];
export const COOPS = {
	maia: { name: 'MaiaCity COOP', mind: 'MAIA', owns: 'the shared hex' },
	village: { name: 'Settlement COOP', mind: 'VILLAGE', owns: 'the 2-person dome tent' }
};
const MAX_LEDGER = 3000;
const DUST = 1e-9;
/** an amount asked for may exceed what is held by this much (the melt between a look and a click): it takes all */
const SLACK = 0.005;

export const DEFAULT_SETTINGS = {
	heartsPerDay: 24,
	/** a year of virtual time melts every balance by this much */
	demurrage: 0.07,
	/** of every MIND into a treasury, this share goes to the pool */
	poolShare: 0.05,
	/** the pool's swap fee, kept in the pool */
	swapFee: 0.003,
	/** each player, each virtual month, to the Settlement COOP, in VillageMIND */
	tentRent: 10,
	/** the Settlement COOP, each virtual month, to the MaiaCity COOP, in MaiaMIND */
	hexRent: 10
};

/** the settings a player may change, with their limits */
export const SETTING_LIMITS = {
	heartsPerDay: [1, 1000],
	demurrage: [0, 0.5],
	poolShare: [0, 0.5],
	swapFee: [0, 0.1],
	tentRent: [0, 10000],
	hexRent: [0, 10000]
};

const wallet = () => ({ HEARTS: 0, MAIA: 0, VILLAGE: 0 });

/** a new game, its virtual year 0 starting now */
export function newGame(now = Date.now(), settings = {}) {
	return {
		version: 1,
		started: now,
		t: now,
		month: 0,
		settings: { ...DEFAULT_SETTINGS, ...settings },
		players: Object.fromEntries(SEATS.map((s) => [s, { seat: s, name: `Player ${s}`, founder: null, wallet: wallet(), lastMint: null, mintDay: -1, arrears: 0 }])),
		coops: Object.fromEntries(Object.entries(COOPS).map(([id, c]) => [id, { id, ...c, treasury: wallet(), arrears: 0 }])),
		pool: { MAIA: 0, VILLAGE: 0 },
		melt: {},
		ledger: [],
		seq: 0
	};
}

const clone = (s) => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

/** virtual time in months since year 0 */
export const monthsAt = (s, now) => Math.max(0, now - s.started) / MONTH_MS;
/** the real-day number since the start: one mint per day */
export const dayAt = (s, now) => Math.floor(Math.max(0, now - s.started) / DAY_MS);

/** the virtual calendar: year from 0, month 1-12, day 1-30 */
export function calendar(s, now) {
	const m = monthsAt(s, now);
	const whole = Math.floor(m);
	return { year: Math.floor(whole / 12), month: (whole % 12) + 1, day: Math.floor((m - whole) * 30) + 1, months: m };
}

/** who holds what: [holder id, balances object] for every balance in the game */
function holders(s) {
	const list = SEATS.map((seat) => [`player:${seat}`, s.players[seat].wallet]);
	for (const id of Object.keys(s.coops)) list.push([`coop:${id}`, s.coops[id].treasury]);
	list.push(['pool', s.pool]);
	return list;
}

export const nameOf = (s, who) => {
	if (!who) return '';
	if (who === 'pool') return 'AMM pool';
	if (who === 'mint') return 'Mint';
	if (who === 'melt') return 'Demurrage';
	if (who === 'expired') return 'Expired';
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
	const f = Math.pow(1 - s.settings.demurrage, ms / MONTH_MS / 12);
	for (const [who, bal] of holders(s)) {
		for (const k of Object.keys(bal)) {
			if (!bal[k]) continue;
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
		log(s, at, { kind: 'demurrage', from: who, to: 'melt', token, amount, note: '7 %/yr demurrage this month' });
	}
	s.melt = {};
}

/** the pool's price of one MaiaMIND in VillageMIND (null while a side is empty) */
export const price = (s) => (s.pool.MAIA > DUST && s.pool.VILLAGE > DUST ? s.pool.VILLAGE / s.pool.MAIA : null);

/** what `amountIn` of token `inTok` buys from the pool */
export function quote(s, inTok, amountIn) {
	const outTok = inTok === 'MAIA' ? 'VILLAGE' : 'MAIA';
	const x = s.pool[inTok];
	const y = s.pool[outTok];
	if (!(x > DUST && y > DUST) || !(amountIn > 0)) return 0;
	const a = amountIn * (1 - s.settings.swapFee);
	return (y * a) / (x + a);
}

/** how much of `inTok` buys exactly `amountOut` of the other token (Infinity if the pool can't) */
function costOf(s, inTok, amountOut) {
	const outTok = inTok === 'MAIA' ? 'VILLAGE' : 'MAIA';
	const x = s.pool[inTok];
	const y = s.pool[outTok];
	if (!(x > DUST && y > DUST) || amountOut >= y) return Infinity;
	return (x * amountOut) / (y - amountOut) / (1 - s.settings.swapFee);
}

function swapRaw(s, at, who, bal, inTok, amountIn, note) {
	const outTok = inTok === 'MAIA' ? 'VILLAGE' : 'MAIA';
	const out = quote(s, inTok, amountIn);
	if (!(out > 0)) return 0;
	bal[inTok] -= amountIn;
	s.pool[inTok] += amountIn;
	s.pool[outTok] -= out;
	bal[outTok] += out;
	log(s, at, { kind: 'swap', from: who, to: 'pool', token: inTok, amount: amountIn, out: { token: outTok, amount: out }, note });
	return out;
}

/** pay `amount` of `token` from a holder to another; swap the other MIND through the pool when short; owe the rest */
function payRent(s, at, from, bal, to, toBal, token, amount, note) {
	const other = token === 'MAIA' ? 'VILLAGE' : 'MAIA';
	if (bal[token] < amount && bal[other] > DUST) {
		const need = amount - bal[token];
		const cost = costOf(s, other, need);
		const spend = Math.min(bal[other], cost);
		if (spend > DUST) swapRaw(s, at, from, bal, other, spend, `swapped to pay rent`);
	}
	const paid = Math.max(0, Math.min(bal[token], amount));
	if (paid > DUST) {
		bal[token] -= paid;
		toBal[token] += paid;
		log(s, at, { kind: 'rent', from, to, token, amount: paid, note });
	}
	return amount - paid;
}

/** the rent of one virtual month, at its end */
function monthEnd(s, at) {
	s.month += 1;
	bookMelt(s, at);
	const v = s.coops.village;
	const m = s.coops.maia;
	for (const seat of SEATS) {
		const p = s.players[seat];
		const had = p.arrears > DUST;
		const due = s.settings.tentRent + p.arrears;
		if (due <= DUST) continue;
		p.arrears = payRent(s, at, `player:${seat}`, p.wallet, 'coop:village', v.treasury, 'VILLAGE', due, `tent rent, month ${s.month}${had ? ' (with arrears)' : ''}`);
		if (p.arrears > DUST) log(s, at, { kind: 'arrears', from: `player:${seat}`, to: 'coop:village', token: 'VILLAGE', amount: p.arrears, note: 'tent rent still owed' });
	}
	const had = v.arrears > DUST;
	const due = s.settings.hexRent + v.arrears;
	if (due > DUST) {
		v.arrears = payRent(s, at, 'coop:village', v.treasury, 'coop:maia', m.treasury, 'MAIA', due, `hex rent, month ${s.month}${had ? ' (with arrears)' : ''}`);
		if (v.arrears > DUST) log(s, at, { kind: 'arrears', from: 'coop:village', to: 'coop:maia', token: 'MAIA', amount: v.arrears, note: 'hex rent still owed' });
	}
}

/** a player's HEARTS run out 24 h after their last mint */
const expiryOf = (p) => (p.lastMint != null && p.wallet.HEARTS > DUST ? p.lastMint + DAY_MS : Infinity);

/** bring the game forward to `now`: melt, month ends with their rent, and expired HEARTS, each at its own moment */
export function advance(state, now = Date.now()) {
	const s = clone(state);
	if (now <= s.t) return s;
	for (let guard = 0; guard < 100_000; guard++) {
		const nextMonth = s.started + (s.month + 1) * MONTH_MS;
		const expiries = SEATS.map((seat) => [seat, expiryOf(s.players[seat])]);
		const nextExpiry = Math.min(...expiries.map(([, t]) => t));
		const next = Math.min(nextMonth, nextExpiry, now);
		melt(s, next - s.t);
		s.t = next;
		for (const [seat, t] of expiries) {
			if (t === next) {
				const p = s.players[seat];
				log(s, next, { kind: 'expired', from: `player:${seat}`, to: 'expired', token: 'HEARTS', amount: p.wallet.HEARTS, note: 'not minted again within 24 h' });
				p.wallet.HEARTS = 0;
			}
		}
		if (next === nextMonth) monthEnd(s, next);
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

/** whether a seat may mint now, and if not, when */
export function mintState(s, seat, now) {
	const p = s.players[seat];
	const day = dayAt(s, now);
	if (p.mintDay < day) return { can: true, next: now };
	return { can: false, next: s.started + (day + 1) * DAY_MS };
}

/**
 * one move by a player: `{ type, ... }`. The state is advanced to `now` first.
 *   mint                         today's HEARTS
 *   invest { coop, amount }      HEARTS into a COOP
 *   swap { token, amount }       a MIND through the pool for the other
 *   name { name }                the player's name
 *   settings { settings }        change the game's settings
 */
export function act(state, seat, action, now = Date.now()) {
	if (!SEATS.includes(seat)) throw new GameError('No such player.');
	const s = advance(state, now);
	const p = s.players[seat];
	const me = `player:${seat}`;
	switch (action?.type) {
		case 'mint': {
			const m = mintState(s, seat, now);
			if (!m.can) throw new GameError('Today’s HEARTS are minted already. Come back tomorrow.');
			const n = s.settings.heartsPerDay;
			p.wallet.HEARTS += n;
			p.lastMint = now;
			p.mintDay = dayAt(s, now);
			log(s, now, { kind: 'mint', from: 'mint', to: me, token: 'HEARTS', amount: n, note: 'daily HEARTS' });
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
			const toPool = half * s.settings.poolShare;
			p.wallet[coop.mind] += half;
			coop.treasury[coop.mind] += half - toPool;
			s.pool[coop.mind] += toPool;
			log(s, now, { kind: 'invest', from: me, to: `coop:${coop.id}`, token: 'HEARTS', amount: spend, note: `invested into the ${coop.name}` });
			log(s, now, { kind: 'mint', from: 'mint', to: me, token: coop.mind, amount: half, note: 'your half' });
			log(s, now, { kind: 'mint', from: 'mint', to: `coop:${coop.id}`, token: coop.mind, amount: half - toPool, note: `treasury half, less ${(s.settings.poolShare * 100).toFixed(0)} % to the pool` });
			if (toPool > 0) log(s, now, { kind: 'pool', from: `coop:${coop.id}`, to: 'pool', token: coop.mind, amount: toPool, note: `${(s.settings.poolShare * 100).toFixed(0)} % of the treasury half` });
			break;
		}
		case 'swap': {
			const tok = action.token;
			if (tok !== 'MAIA' && tok !== 'VILLAGE') throw new GameError('Swap MaiaMIND or VillageMIND.');
			const n = num(action.amount);
			if (n > p.wallet[tok] + SLACK) throw new GameError(`You hold only ${p.wallet[tok].toFixed(2)} ${TOKEN_LABEL[tok]}.`);
			if (!quote(s, tok, Math.min(n, p.wallet[tok]))) throw new GameError('The pool needs both MINDs before it can swap.');
			swapRaw(s, now, me, p.wallet, tok, Math.min(n, p.wallet[tok]), 'swap');
			break;
		}
		case 'name': {
			const name = String(action.name ?? '').trim().slice(0, 40);
			if (!name) throw new GameError('Give a name.');
			p.name = name;
			break;
		}
		case 'settings': {
			const changed = [];
			for (const [k, [lo, hi]] of Object.entries(SETTING_LIMITS)) {
				if (action.settings?.[k] == null) continue;
				const v = Number(action.settings[k]);
				if (!Number.isFinite(v) || v < lo || v > hi) throw new GameError(`${k} must be between ${lo} and ${hi}.`);
				if (v !== s.settings[k]) {
					changed.push(`${k} ${s.settings[k]} → ${v}`);
					s.settings[k] = v;
				}
			}
			if (changed.length) log(s, now, { kind: 'settings', from: me, to: '', token: '', amount: 0, note: changed.join(', ') });
			break;
		}
		default:
			throw new GameError('Unknown move.');
	}
	return s;
}

/** the ledger lines one holder is part of, newest first */
export const ledgerOf = (s, who) => s.ledger.filter((e) => e.from === who || e.to === who).reverse();

/** every MIND in the game, by token: wallets, treasuries and the pool */
export function supply(s) {
	const out = { HEARTS: 0, MAIA: 0, VILLAGE: 0 };
	for (const [, bal] of holders(s)) for (const k of TOKENS) out[k] += bal[k] ?? 0;
	return out;
}
