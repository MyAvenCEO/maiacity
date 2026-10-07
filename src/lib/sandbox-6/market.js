/**
 * SANDBOX 6 · THE OPEN MARKET AND ABUNDANCE — the rules of trade and of living well, as plain data and pure
 * functions; the simulation (./sim.js) calls them, the page shows them.
 *
 * The fair. Every settlement's trader carts wares to the fair and back. The fair keeps a pool of each ware: selling
 * puts wares in it, buying takes them out, and the price follows the pool, unit by unit. A ware that piles up gets
 * cheap, a ware that runs short gets dear; every trade nudges its price, and traders from beyond the valley take a glut
 * away and, slowly, bring a little of what runs short. Coins are only how wares change hands: the fair pays them out and
 * takes them in, and nothing in the score counts them.
 *
 * Needs. Everyone in a settlement eats (fish, bread or meat, the more kinds the better), drinks, and keeps a home
 * (planks and stone). A settlement's wellbeing (0–100) is how well its needs were met over the last minutes, how
 * varied its food was, and how much it has put by. A settlement doing well grows, so it needs more; one doing badly
 * shrinks.
 *
 * Abundance. The valley's abundance is the geometric mean of every settlement's wellbeing, yours and the three
 * neighbours': one hungry neighbour pulls everyone down, and no amount of plenty in one place makes up for it.
 *
 * Neighbours. Each makes some wares well and runs short of others. Their traders sell what they have spare and buy
 * what they lack, so they trade with each other through the fair as well as with you, and now and then one asks you
 * for what it lacks most: a request, paid from its own purse — or, when its purse is empty, a plea for help. Coins
 * that pile up in one place leave the others unable to buy: spending them on the neighbours' wares (or answering a
 * plea) is how the valley stays well.
 */
import { FOOD, WARES } from './rules.js';

/** what a person needs, a minute */
export const NEEDS = { food: 0.11, water: 0.06, plank: 0.022, stone: 0.014 };
export const NEED_LABEL = { food: 'Food', water: 'Water', plank: 'Planks', stone: 'Stone' };
/** what a cart carries */
export const CART = 8;
/** minutes of needs a settlement likes to have put by */
const PUT_BY = 10;
/** a ware's usual price at the fair, in coins */
export const BASE = { log: 2, plank: 4, stone: 4, grain: 2, flour: 3, water: 1.5, bread: 6, fish: 4, meat: 6, coal: 4, ironOre: 4, goldOre: 8, iron: 9, tools: 16 };
/** the wares traded at the fair (not coins: they are what is paid) */
export const TRADED = Object.keys(BASE);
/** a pool's usual level */
const REF = (/** @type {string} */ w) => (w === 'tools' ? 16 : w === 'iron' || w === 'goldOre' || FOOD.includes(w) ? 24 : 40);
/** how hard the price leans on the pool */
const LEAN = 0.85;

/**
 * The three neighbours (in the valley's east, see ./map.js). Each makes some of everything, plenty of one ware and
 * none of another, so each can live on its own at first and needs the others to grow: Eastmere needs Highfold's wood,
 * Highfold needs Reedholm's fish, Reedholm needs stone — and you (plenty of grain, no iron) need Eastmere's iron.
 * What each makes, a person a minute.
 * @type {{ name: string, about: string, plenty: string, short: string, make: Record<string, number> }[]}
 */
export const NEIGHBOURS = [
	{ name: 'Eastmere', about: 'Miners and smiths under the eastern peaks: plenty of iron, coal and tools, but no wood.', plenty: 'iron', short: 'wood', make: { iron: 0.06, coal: 0.08, tools: 0.02, fish: 0.03, bread: 0.03, meat: 0.02, water: 0.06, stone: 0.04, grain: 0.02 } },
	{ name: 'Reedholm', about: 'Fishers by the southern lake: plenty of fish, but no stone.', plenty: 'fish', short: 'stone', make: { fish: 0.13, bread: 0.02, grain: 0.03, water: 0.06, plank: 0.015, log: 0.01 } },
	{ name: 'Highfold', about: 'Woodcutters in the northern hills: plenty of planks and logs, but no fish.', plenty: 'wood', short: 'fish', make: { plank: 0.08, log: 0.05, bread: 0.04, meat: 0.04, water: 0.06, stone: 0.03, coal: 0.01 } }
];

/** a fresh fair and a fresh valley of settlements: yours first, then the neighbours */
export function newMarket() {
	/** @type {Record<string, number>} */
	const pool = {};
	for (const w of TRADED) pool[w] = REF(w) * (FOOD.includes(w) ? 0.25 : 0.6);
	const party = (/** @type {string} */ name, /** @type {number} */ pop) => ({
		name,
		pop,
		/** how well each need was met, lately (0…1) */
		sat: { food: 0.55, water: 0.7, plank: 0.5, stone: 0.5 },
		/** what is owed to each need: eaten later, if it can be */
		owe: { food: 0, water: 0, plank: 0, stone: 0 },
		/** the food eaten lately, by kind */
		mix: { fish: 1, bread: 1, meat: 1 },
		reserve: 0.3,
		wb: 50,
		/** @type {Record<string, number>} */ stock: {},
		coins: 0,
		/** when the trader last set out */
		trip: 0
	});
	const parties = [party('You', 0), ...NEIGHBOURS.map((n) => party(n.name, 18))];
	for (const [k, n] of NEIGHBOURS.entries()) {
		const p = parties[k + 1];
		p.coins = 140;
		for (const [w, r] of Object.entries(n.make)) p.stock[w] = r * p.pop * 1.5;
		// something put by of every need
		p.stock.water = (p.stock.water ?? 0) + 6;
		p.stock.plank = (p.stock.plank ?? 0) + 2;
		p.stock.stone = (p.stock.stone ?? 0) + 2;
	}
	return {
		market: {
			pool,
			/** each ware's price, a sample every 20 s (the last 30) @type {Record<string, number[]>} */
			hist: Object.fromEntries(TRADED.map((w) => [w, [/** @type {number} */ (BASE[/** @type {keyof typeof BASE} */ (w)])]])),
			/** @type {{ id: number, k: number, w: string, n: number, got: number, reward: number, until: number, taken: boolean }[]} */
			contracts: [],
			contractSeq: 0,
			sold: 0,
			bought: 0,
			filled: 0,
			abundance: 50,
			/** since when the valley has been abundant, or -1 */
			since: -1,
			clock: { needs: 0, grow: 60, hist: 0, drift: 0, contract: 300 }
		},
		parties
	};
}

const base = (/** @type {string} */ w) => /** @type {number} */ (BASE[/** @type {keyof typeof BASE} */ (w)] ?? 1);
/** a ware's price at the fair for a pool level */
const priceAt = (/** @type {string} */ w, /** @type {number} */ level) => {
	const R = REF(w), k = R / 3;
	return base(w) * Math.pow((R + k) / (Math.max(0, level) + k), LEAN);
};
/** what one unit of a ware fetches at the fair now @param {any} m @param {string} w */
export const price = (m, w) => priceAt(w, m.pool[w]);
/** what one unit of a ware costs at the fair now (the price once it is taken from the pool) @param {any} m @param {string} w */
export const cost = (m, w) => priceAt(w, m.pool[w] - 1);
/** sell one unit: what it fetches @param {any} m @param {string} w */
export function sellOne(m, w) {
	const p = price(m, w);
	m.pool[w] += 1;
	return p;
}
/** buy one unit if the pool has it: what it cost, or 0 @param {any} m @param {string} w */
export function buyOne(m, w) {
	if (m.pool[w] < 1) return 0;
	const p = cost(m, w);
	m.pool[w] -= 1;
	return p;
}
/** how a price moved over the last two minutes: −1, 0, 1 @param {any} m @param {string} w */
export function trend(m, w) {
	const h = m.hist[w];
	const was = h[Math.max(0, h.length - 7)], now = price(m, w);
	return now > was * 1.06 ? 1 : now < was * 0.94 ? -1 : 0;
}

/** how varied the food eaten lately was: 0 one kind only, 1 all three alike */
export function variety(/** @type {any} */ p) {
	const total = FOOD.reduce((s, f) => s + p.mix[f], 0);
	if (total <= 0) return 0;
	const simpson = 1 - FOOD.reduce((s, f) => s + (p.mix[f] / total) ** 2, 0);
	return Math.min(1, simpson / (1 - 1 / FOOD.length));
}
/** a settlement's wellbeing from its needs, the variety of its food and what it has put by */
export function wellbeing(/** @type {any} */ p) {
	const s = p.sat;
	return 100 * (0.4 * s.food * (0.7 + 0.3 * variety(p)) + 0.2 * s.water + 0.2 * ((s.plank + s.stone) / 2) + 0.2 * p.reserve);
}
/** the valley's abundance: the geometric mean of every settlement's wellbeing */
export function abundance(/** @type {any[]} */ parties) {
	return Math.exp(parties.reduce((s, p) => s + Math.log(Math.max(1, p.wb)), 0) / parties.length);
}

/**
 * Needs met for a while: each settlement eats, drinks and keeps its homes, and its wellbeing follows.
 * `take(ware)` takes one unit from a settlement's stores and says whether it could; `has(ware)` counts them.
 * @param {any} p
 * @param {number} pop
 * @param {number} dt seconds
 * @param {(w: string) => boolean} take
 * @param {(w: string) => number} has
 */
export function live(p, pop, dt, take, has) {
	for (const [need, rate] of /** @type {[keyof typeof NEEDS, number][]} */ (Object.entries(NEEDS))) {
		const per = (rate * pop) / 60;
		p.owe[need] = Math.min(p.owe[need] + per * dt, per * 180 + 1);
		// eat what is owed, a unit at a time; food the kind eaten least lately
		while (p.owe[need] >= 1) {
			/** @type {string} */
			let w = need;
			if (need === 'food') {
				const kinds = FOOD.filter((f) => has(f) >= 1).sort((a, b) => p.mix[a] - p.mix[b]);
				if (!kinds.length) break;
				w = kinds[0];
			}
			if (!take(w)) break;
			p.owe[need] -= 1;
			if (need === 'food') p.mix[w] += 1;
		}
		const now = p.owe[need] <= 1.2 ? 1 : Math.max(0, 1 - (p.owe[need] - 1.2) / Math.max(0.5, per * 150));
		p.sat[need] += (now - p.sat[need]) * Math.min(1, dt / 90);
	}
	for (const f of FOOD) p.mix[f] *= Math.exp(-dt / 300);
	const put = Object.entries(NEEDS).map(([need, rate]) => {
		const want = rate * pop * PUT_BY;
		const have = need === 'food' ? FOOD.reduce((s, f) => s + has(f), 0) : has(need);
		return want > 0 ? Math.min(1, have / want) : 1;
	});
	p.reserve += (put.reduce((a, b) => a + b, 0) / put.length - p.reserve) * Math.min(1, dt / 60);
	p.wb = wellbeing(p);
}

/** a neighbour makes its wares (hungry people work less) @param {any} p @param {number} k @param {number} dt */
export function make(p, k, dt) {
	const work = 0.55 + 0.45 * p.sat.food;
	for (const [w, r] of Object.entries(NEIGHBOURS[k - 1].make)) p.stock[w] = (p.stock[w] ?? 0) + ((r * p.pop) / 60) * dt * work;
}

/** what a neighbour keeps of a ware before it sells any @param {any} p @param {string} w */
const keepOf = (p, w) => {
	const need = /** @type {Record<string, number>} */ (NEEDS)[w] ?? (FOOD.includes(w) ? NEEDS.food / 2 : 0);
	return need ? need * p.pop * PUT_BY * 1.1 : 1;
};
/** what a neighbour's trader takes to the fair: the ware it has most to spare of, by worth, or null @param {any} m @param {any} p */
export function toSell(m, p) {
	let best = null, bv = 0;
	for (const w of TRADED) {
		const spare = Math.floor((p.stock[w] ?? 0) - keepOf(p, w));
		if (spare < 3) continue;
		const v = Math.min(CART, spare) * price(m, w);
		if (v > bv) (best = w), (bv = v);
	}
	return best ? { w: best, n: Math.min(CART, Math.floor((p.stock[best] ?? 0) - keepOf(p, best))) } : null;
}
/**
 * What a neighbour buys at the fair, its most pressing need first: a cartload at most, while it has the coins and the
 * price is bearable. @param {any} m @param {any} p @returns {Record<string, number>}
 */
export function shop(m, p) {
	/** @type {Record<string, number>} */
	const got = {};
	let room = CART;
	const wants = Object.entries(NEEDS)
		.map(([need, rate]) => {
			const have = need === 'food' ? FOOD.reduce((s, f) => s + (p.stock[f] ?? 0), 0) : p.stock[need] ?? 0;
			return { need, short: rate * p.pop * PUT_BY - have, urgent: p.sat[need] };
		})
		.filter((x) => x.short > 0.5)
		.sort((a, b) => a.urgent - b.urgent || b.short - a.short);
	for (const x of wants) {
		let n = Math.min(room, Math.ceil(x.short));
		while (n > 0) {
			// food: the kind eaten least lately that the fair has at a bearable price
			const w = x.need === 'food' ? FOOD.filter((f) => m.pool[f] >= 1 && cost(m, f) <= base(f) * 3).sort((a, b) => p.mix[a] - p.mix[b] || cost(m, a) - cost(m, b))[0] : x.need;
			if (!w || m.pool[w] < 1 || cost(m, w) > base(w) * 3 || cost(m, w) > p.coins) break;
			p.coins -= buyOne(m, w);
			got[w] = (got[w] ?? 0) + 1;
			if (x.need === 'food') p.mix[w] += 0.2;
			n--;
			room--;
		}
		if (!room) break;
	}
	return got;
}

/** the fair's slow clock: prices remembered, pools pulled back toward their usual level @param {any} m @param {number} time @param {number} dt */
export function fair(m, time, dt) {
	if (time >= m.clock.hist) {
		m.clock.hist = time + 20;
		for (const w of TRADED) {
			m.hist[w].push(price(m, w));
			if (m.hist[w].length > 30) m.hist[w].shift();
		}
	}
	// traders from beyond the valley take away a glut quickly, and bring in a little of what runs short
	for (const w of TRADED) m.pool[w] += (REF(w) - m.pool[w]) * (1 - Math.exp(-dt / (m.pool[w] > REF(w) ? 900 : 5000)));
}

/** a neighbour asks for what it lacks most, with a reward: a request, or null @param {any} m @param {any[]} parties @param {number} time @param {() => number} rand */
export function request(m, parties, time, rand) {
	const open = m.contracts.filter((/** @type {any} */ c) => c.got < c.n && c.until > time);
	if (open.length >= 3) return null;
	let k = 0, worst = Infinity, need = 'food';
	for (let j = 1; j < parties.length; j++) {
		if (open.some((/** @type {any} */ c) => c.k === j)) continue;
		const q = parties[j];
		for (const [n, rate] of Object.entries(NEEDS)) {
			// how short it is: of what it eats now, or of what it has put by
			const have = n === 'food' ? FOOD.reduce((t, f) => t + (q.stock[f] ?? 0), 0) : q.stock[n] ?? 0;
			const s = Math.min(q.sat[/** @type {keyof typeof NEEDS} */ (n)], have / (rate * q.pop * PUT_BY));
			if (s < worst) (worst = s), (k = j), (need = n);
		}
	}
	// only a real shortage is worth asking for
	if (!k || worst > 0.6) return null;
	const p = parties[k];
	const w = need === 'food' ? [...FOOD].sort((a, b) => p.mix[a] - p.mix[b])[Math.floor(rand() * 2)] : need;
	// as much as it is short, in fives; it pays from its own purse, and with none left it asks for help
	const rate = /** @type {Record<string, number>} */ (NEEDS)[need];
	const n = Math.max(10, Math.min(30, Math.round((rate * p.pop * PUT_BY) / 5) * 5));
	const fair = Math.round(n * Math.max(price(m, w), base(w)) * 1.4);
	const reward = Math.min(fair, Math.floor(p.coins * 0.8));
	const c = { id: ++m.contractSeq, k, w, n, got: 0, reward: reward >= n ? reward : 0, until: time + 600, taken: false };
	m.contracts.push(c);
	if (m.contracts.length > 12) m.contracts.shift();
	return c;
}

export const wareLabel = (/** @type {string} */ w) => WARES[w]?.label ?? w;
