// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1: the simplest game of the city. Two players, three COOPs, one hex, one tent, one pool.
 *
 * - Each player's personal HEARTS grow 24 a day (one an hour), minted at any moment: all that grew since the last mint.
 *   The right to mint expires after 24 h, not the HEARTS: growth older than 24 h is lost. HEARTS buy nothing: they are
 *   only invested.
 * - Investing 1 HEART into a COOP makes 1 MIND of that COOP: half to the player's wallet, half to the COOP's treasury.
 * - Three COOPs, each with its own MIND: the MaiaCity COOP (MaiaMIND) owns the settlement hex and the AMM pool; the
 *   Settlement COOP (SettlementMIND) owns the domes on its hex, the 2-person dome tent; the Village COOP (VillageMIND)
 *   owns the pickup, the powercube (a diesel generator), a solar panel and a big battery pack.
 * - 5 % of every MIND that lands in a treasury goes into the MaiaCity COOP's pool: one equal-weight basket of all three
 *   MINDs (a constant-product pool, x·y·z), so any MIND swaps for any other. It is never paid out; anyone can swap
 *   through it (0.3 % fee stays in the pool).
 * - Rent, every virtual month: each player pays the Settlement COOP for the tent in SettlementMIND; the Settlement COOP
 *   pays the MaiaCity COOP for the hex in MaiaMIND. A payer who lacks the MIND swaps others through the pool; what is
 *   still missing is owed (arrears) and paid first next month.
 * - Time: one virtual month per real day, from virtual year 0. Every balance (HEARTS, wallets, treasuries, the pool)
 *   melts by 7 % a year of virtual time, continuously.
 * - Every decision (the settings, and payouts of MIND from a COOP's treasury to any wallet) is a MIP, as in Sandbox 7.
 *   It needs two signatures, and applies at once in this same game (no new world).
 *
 * The same code runs on the server (which holds the one true game) and in the page (which ticks the numbers between
 * reloads). Every function here is pure: it takes a state and returns a new one.
 */

export const DAY_MS = 86_400_000;
/** one virtual month per real day */
export const MONTH_MS = DAY_MS;
export const TOKENS = ['HEARTS', 'MAIA', 'SETTLEMENT', 'VILLAGE'];
/** the MINDs, one a COOP */
export const MINDS = ['MAIA', 'SETTLEMENT', 'VILLAGE'];
export const TOKEN_LABEL = { HEARTS: 'HEARTS', MAIA: 'MaiaMIND', SETTLEMENT: 'SettlementMIND', VILLAGE: 'VillageMIND' };
export const TOKEN_COLOUR = { MAIA: '#5f8f6e', SETTLEMENT: '#c87a4f', VILLAGE: '#4f7fa8' };
/** a game kept from before this shape is started again (api/src/maiacity-v1.js), its seats kept */
export const VERSION = 2;
export const SEATS = ['A', 'B'];
export const COOPS = {
	maia: { name: 'MaiaCity COOP', mind: 'MAIA', assets: [{ id: 'hex', name: 'The settlement hex', kind: 'Land' }, { id: 'pool', name: 'The AMM pool', kind: 'Liquidity: MaiaMIND, SettlementMIND, VillageMIND' }] },
	settlement: { name: 'Settlement COOP', mind: 'SETTLEMENT', assets: [{ id: 'tent', name: 'The 2-person dome tent', kind: 'Dome · home for 2' }] },
	village: { name: 'Village COOP', mind: 'VILLAGE', assets: [{ id: 'pickup', name: 'The pickup', kind: 'Vehicle' }, { id: 'powercube', name: 'The powercube', kind: 'Diesel generator' }, { id: 'solar', name: 'A solar panel', kind: 'Power' }, { id: 'battery', name: 'A big battery pack', kind: 'Storage' }] }
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
	/** each player, each virtual month, to the Settlement COOP, in SettlementMIND */
	tentRent: 10,
	/** the Settlement COOP, each virtual month, to the MaiaCity COOP, in MaiaMIND */
	hexRent: 10
};

/** the settings, in words */
export const SETTING_NAMES = { heartsPerDay: 'HEARTS a day', demurrage: 'Demurrage a year (0.07 = 7 %)', poolShare: 'Treasury share to the pool', swapFee: 'Swap fee', tentRent: 'Tent rent, each player a month (SettlementMIND)', hexRent: 'Hex rent, Settlement COOP a month (MaiaMIND)' };

/** the settings a MIP may change, with their limits */
export const SETTING_LIMITS = {
	heartsPerDay: [1, 1000],
	demurrage: [0, 0.5],
	poolShare: [0, 0.5],
	swapFee: [0, 0.1],
	tentRent: [0, 10000],
	hexRent: [0, 10000]
};

const wallet = () => ({ HEARTS: 0, MAIA: 0, SETTLEMENT: 0, VILLAGE: 0 });

/** a new game, its virtual year 0 starting now */
export function newGame(now = Date.now(), settings = {}) {
	return {
		version: VERSION,
		started: now,
		t: now,
		month: 0,
		settings: { ...DEFAULT_SETTINGS, ...settings },
		players: Object.fromEntries(SEATS.map((s) => [s, { seat: s, name: `Player ${s}`, founder: null, wallet: wallet(), lastMint: null, arrears: 0 }])),
		coops: Object.fromEntries(Object.entries(COOPS).map(([id, c]) => [id, { id, ...c, treasury: wallet(), arrears: 0 }])),
		pool: { MAIA: 0, SETTLEMENT: 0, VILLAGE: 0 },
		melt: {},
		ledger: [],
		mips: [],
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

/** the pool's price of one `tok` in MaiaMIND (null while either side is empty); equal weights: the ratio of balances */
export const price = (s, tok = 'SETTLEMENT') => (s.pool.MAIA > DUST && s.pool[tok] > DUST ? s.pool.MAIA / s.pool[tok] : null);

const isMind = (t) => MINDS.includes(t);

/** what `amountIn` of `inTok` buys of `outTok` from the pool (equal weights: each pair trades as x·y = k) */
export function quote(s, inTok, outTok, amountIn) {
	if (inTok === outTok || !isMind(inTok) || !isMind(outTok)) return 0;
	const x = s.pool[inTok];
	const y = s.pool[outTok];
	if (!(x > DUST && y > DUST) || !(amountIn > 0)) return 0;
	const a = amountIn * (1 - s.settings.swapFee);
	return (y * a) / (x + a);
}

/** how much of `inTok` buys exactly `amountOut` of `outTok` (Infinity if the pool can't) */
function costOf(s, inTok, outTok, amountOut) {
	const x = s.pool[inTok];
	const y = s.pool[outTok];
	if (!(x > DUST && y > DUST) || amountOut >= y) return Infinity;
	return (x * amountOut) / (y - amountOut) / (1 - s.settings.swapFee);
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
	}
	return amount - paid;
}

/** the rent of one virtual month, at its end */
function monthEnd(s, at) {
	s.month += 1;
	bookMelt(s, at);
	const st = s.coops.settlement;
	const m = s.coops.maia;
	for (const seat of SEATS) {
		const p = s.players[seat];
		const had = p.arrears > DUST;
		const due = s.settings.tentRent + p.arrears;
		if (due <= DUST) continue;
		p.arrears = payRent(s, at, `player:${seat}`, p.wallet, 'coop:settlement', st.treasury, 'SETTLEMENT', due, `tent rent, month ${s.month}${had ? ' (with arrears)' : ''}`);
		if (p.arrears > DUST) log(s, at, { kind: 'arrears', from: `player:${seat}`, to: 'coop:settlement', token: 'SETTLEMENT', amount: p.arrears, note: 'tent rent still owed' });
	}
	const had = st.arrears > DUST;
	const due = s.settings.hexRent + st.arrears;
	if (due > DUST) {
		st.arrears = payRent(s, at, 'coop:settlement', st.treasury, 'coop:maia', m.treasury, 'MAIA', due, `hex rent, month ${s.month}${had ? ' (with arrears)' : ''}`);
		if (st.arrears > DUST) log(s, at, { kind: 'arrears', from: 'coop:settlement', to: 'coop:maia', token: 'MAIA', amount: st.arrears, note: 'hex rent still owed' });
	}
}

/** bring the game forward to `now`: the melt, and each month's end with its rent, at its own moment */
export function advance(state, now = Date.now()) {
	const s = clone(state);
	if (now <= s.t) return s;
	for (let guard = 0; guard < 100_000; guard++) {
		const nextMonth = s.started + (s.month + 1) * MONTH_MS;
		const next = Math.min(nextMonth, now);
		melt(s, next - s.t);
		s.t = next;
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

/**
 * what a seat may mint now: HEARTS grow all the time (24 a day, one an hour) and are minted whenever the player likes,
 * all that grew since the last mint. The right to mint reaches back 24 hours only: what grew before that is lost, so a
 * player who never mints for a day mints 24 at most. Minted HEARTS stay (they only melt).
 * { amount, since, full: when the 24 h are full and growth starts being lost, lost: what was lost already }
 */
export function mintState(s, seat, now) {
	const p = s.players[seat];
	const since = p.lastMint ?? s.started;
	const grown = Math.max(0, now - since);
	const window = Math.min(grown, DAY_MS);
	const perMs = s.settings.heartsPerDay / DAY_MS;
	return { amount: window * perMs, since, full: since + DAY_MS, lost: Math.max(0, grown - DAY_MS) * perMs };
}

/** signatures a MIP needs before it is accepted */
export const SIGNATURES = 2;
/** where a payout may come from: a COOP's treasury (the pool is never paid out) */
export const PAYERS = Object.keys(COOPS).map((id) => `coop:${id}`);
/** who a payout may go to: any wallet in the game but the pool */
export const PAYEES = [...SEATS.map((s) => `player:${s}`), ...PAYERS];

const balanceOf = (s, who) => (who.startsWith('player:') ? s.players[who.slice(7)]?.wallet : s.coops[who.slice(5)]?.treasury);

/**
 * A MIP (MaiaCity improvement proposal), as in Sandbox 7: a title, a description in prose, and what it changes — any of
 * the game's settings, and payouts of MIND out of a COOP's treasury into any wallet. The proposer signs it; with two
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
	if (!Object.keys(settings).length && !payouts.length) throw new GameError('A proposal changes a setting or pays out.');
	return { title, description, settings, payouts };
}

/** what a MIP changes, in words */
export function describe(s, mip) {
	const parts = Object.entries(mip.settings ?? {}).map(([k, v]) => `${SETTING_NAMES[k] ?? k} → ${v}`);
	for (const x of mip.payouts ?? []) parts.push(`pay ${x.amount.toFixed(2)} ${TOKEN_LABEL[x.token]} from ${nameOf(s, x.from)} to ${nameOf(s, x.to)}`);
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
	if (mip.status !== 'open' || mip.signatures.length < SIGNATURES) return;
	const short = shortOf(s, mip);
	if (short) throw new GameError(`MIP #${mip.number} can’t apply yet: ${short}`);
	const before = Object.fromEntries(Object.keys(mip.settings).map((k) => [k, s.settings[k]]));
	Object.assign(s.settings, mip.settings);
	for (const x of mip.payouts) {
		const from = balanceOf(s, x.from);
		const amount = Math.min(x.amount, from[x.token]);
		from[x.token] -= amount;
		balanceOf(s, x.to)[x.token] += amount;
		log(s, now, { kind: 'payout', from: x.from, to: x.to, token: x.token, amount, note: `MIP #${mip.number}: ${mip.title}` });
	}
	mip.status = 'accepted';
	mip.decided = now;
	mip.result = { before };
	log(s, now, { kind: 'proposal', from: '', to: '', token: '', amount: 0, note: `MIP #${mip.number} accepted: ${mip.title} (${describe(s, mip)})` });
}

/**
 * one move by a player: `{ type, ... }`. The state is advanced to `now` first.
 *   mint                         the HEARTS grown since the last mint (24 h of them at most)
 *   invest { coop, amount }      HEARTS into a COOP
 *   swap { token, to, amount }   a MIND through the pool for another
 *   name { name }                the player's name
 *   propose { mip }              a MIP: title, description, settings and payouts; the proposer signs it
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
			log(s, now, { kind: 'mint', from: 'mint', to: me, token: 'HEARTS', amount: m.amount, note: m.lost > 0.001 ? `grew since the last mint (${m.lost.toFixed(2)} older than 24 h lost)` : 'grew since the last mint' });
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
		case 'propose': {
			const mip = checkMip(s, action.mip);
			s.mips ??= [];
			const short = mip.payouts.length ? shortOf(s, mip) : '';
			if (short) throw new GameError(short);
			const number = s.mips.length + 1;
			const made = { number, ...mip, by: seat, at: now, signatures: [seat], status: 'open', decided: null, note: '' };
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

/** every MIND in the game, by token: wallets, treasuries and the pool */
export function supply(s) {
	const out = { HEARTS: 0, MAIA: 0, SETTLEMENT: 0, VILLAGE: 0 };
	for (const [, bal] of holders(s)) for (const k of TOKENS) out[k] += bal[k] ?? 0;
	return out;
}
