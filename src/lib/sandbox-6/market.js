/**
 * SANDBOX 6 · TRADE — the rules of trade, of the world market and of what a home needs, as plain data and pure
 * functions; the simulation (./sim.js) calls them, the page shows them.
 *
 * The world market. Everything the valley needs can be bought from the world beyond it, at real prices in euros: a
 * village center pays from its treasury and the load is in its storehouse at once. A gold is 1,000 €, so a HEART is a
 * euro. Food and water a village buys there by itself, and sells what its forests grow beyond two weeks put by
 * (./food.js); planks and stone you buy and sell (WORLD), or your orders do.
 *
 * Trade routes. Village centers are joined by trade routes under the ground: carts run along them at twice a walker's
 * pace. Your own routes share wares between your villages; a route to another city's village center lets you trade
 * with that city, and any route may be passed through, whoever dug it — as long as a way runs from one village center
 * to the other. Nobody trades with anyone beyond the valley: every ware that changes hands was made by one of its
 * three cities, and the coins it fetches go from the buyer's purse to the seller's.
 *
 * Prices. Each city prices a ware by how much of it it has against how much it wants: what runs short gets dear,
 * what piles up gets cheap. A city sells what it has spare to whoever pays most and buys what it lacks from whoever
 * asks least, among the cities it can reach. Coins are only how wares change hands: nothing in the score counts them.
 *
 * Needs. Everyone eats, drinks (in kg and litres a week, grown by the hexes and drawn from wells: ./food.js) and keeps
 * a home (planks and stone). Each need is met (0–1) as far as the village had what it took lately.
 *
 * Neighbours. Each makes some wares well and runs short of others, so they trade with each other (their two cities
 * start joined by a route) and with you once you join them, and now and then one asks you for what it lacks most: a
 * request, paid from its own purse — or, when its purse is empty, a plea for help.
 */
import { WARES } from './rules.js';
import { DAY } from './food.js';

/**
 * what a person's home needs, a minute, in planks and stone. A great dome holds 248 where a great house held 16, so a
 * person needs 16/248 of what they used to. Food and water are counted in kg and litres instead (./food.js).
 */
const PER = 16 / 248;
export const NEEDS = { plank: 0.022 * PER, stone: 0.014 * PER };
/** what a cart carries */
export const CART = 8;
/** minutes of needs a settlement likes to have put by */
const PUT_BY = 10;
/** a ware's usual price, in coins */
export const BASE = { plank: 4, stone: 4 };
/** euros in a gold: a HEART is a euro */
export const EUR_PER_GOLD = 1000;
/**
 * What the world market asks for a ware, in euros (HEARTs), and what one of it is: real prices, a load being 5 t.
 * Building timber is the average of sawn softwood across Europe, about 800 € a tonne.
 */
export const WORLD = /** @type {Record<string, { eur: number, unit: string }>} */ ({
	plank: { eur: 4000, unit: 'a load: 5 t of sawn building timber at 800 € a t' },
	stone: { eur: 750, unit: 'a load: 5 t of building stone at 150 € a t' }
});
/** the wares that are traded (not coins: they are what is paid) */
export const TRADED = Object.keys(BASE);
/**
 * Neighbour cities, each with what it makes well and lacks. None for now: you play the valley on your own, founding
 * and joining your own villages (Samuel, 2026-10-07).
 * @type {{ name: string, about: string, plenty: string, short: string, builds: string[], make: Record<string, number> }[]}
 */
export const NEIGHBOURS = [];

/**
 * Gold, the HEARTS way: nobody mints it but the people. Every settler brings one HEART into the world each in-game hour,
 * paid into the treasury of the village center they live by; 1,000 HEARTs are one gold, 1,000 €. What a treasury holds
 * loses 7% a year (demurrage), so gold is for using, not hoarding. Gold pays for what one of your village centers takes
 * from another and for what it buys from the world market; building, enlarging and founding cost wares alone.
 */
export const HEARTS = {
	/** what one settler issues, an in-game hour: 24 a day, 720 a month (game/policy.hearts.json) */
	perHour: 1,
	/** HEARTs in one gold */
	perGold: 1000,
	/** an in-game hour, in days of the valley's calendar (./food.js) */
	hour: DAY / 24,
	/** what a treasury loses in an in-game year */
	demurrage: 0.07,
	/** hours in an in-game year: twelve months of thirty days */
	yearHours: 12 * 30 * 24
};
/** what one of a ware costs a village center that takes it from another of yours, in HEARTs: half what the world
 * market asks, as with food @param {string} w */
export const heartsFor = (w) => (WORLD[w]?.eur ?? 0) / 2;

/**
 * Your orders at the fair are one word a ware: sell or buy. What that means is fixed, so there is nothing to tune:
 * selling lets go of what you can spare (you keep ten minutes of what your people live on, or a dozen of anything
 * else) while it fetches at least half its usual price; buying fetches what you are short of (up to a stock that
 * suits the ware) while it costs at most two and a half times its usual price.
 * @param {string} w
 * @param {number} pop your people
 */
export function orderRule(w, pop) {
	const need = /** @type {Record<string, number>} */ (NEEDS)[w] ?? 0;
	const lives = Math.ceil(need * pop * PUT_BY);
	return {
		keep: Math.max(12, lives),
		upTo: w === 'plank' ? Math.max(40, lives) : w === 'stone' ? Math.max(30, lives) : Math.max(20, lives),
		above: base(w) * 0.5,
		below: base(w) * 2.5
	};
}

/** a fresh valley's trade and its cities: yours first, then the neighbours */
export function newMarket() {
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
			/** each ware's price across the valley, a sample every 20 s (the last 30) @type {Record<string, number[]>} */
			hist: Object.fromEntries(TRADED.map((w) => [w, [base(w)]])),
			/** @type {{ id: number, k: number, w: string, n: number, got: number, reward: number, until: number, taken: boolean }[]} */
			contracts: [],
			contractSeq: 0,
			sold: 0,
			bought: 0,
			/** what your villages bought from the world market and sold to it, by ware @type {Record<string, number>} */
			fromWorld: {},
			/** @type {Record<string, number>} */
			toWorld: {},
			filled: 0,
			clock: { hist: 0, contract: 300 }
		},
		parties
	};
}
/** how a city or a village lives: its needs and its food and water (and a neighbour city's stores and purse) */
export function party(/** @type {string} */ name, /** @type {number} */ pop) {
	return {
		name,
		pop,
		/** whether its people went without food or water lately: its treasury could not pay for it */
		hungry: false,
		/** what is owed to each need of its homes: used later, if it can be */
		owe: { plank: 0, stone: 0 },
		/** what it trades lately, booked to its next week: € paid out and taken in @type {Record<string, number>} */
		pend: {},
		/** the food in its store, kg, and the water in its tanks, litres */
		kg: 0,
		litres: 0,
		/** what it did lately, a week (kg, litres, €): its food grown, eaten, bought from your villages and from the
		 * world, sold to your villages and exported, spoiled, spent and earned on it; its water drawn from its wells,
		 * bought, used, spent on it; what it spent on wares from the world market; and all it paid out (imp) and took
		 * in (exp) in trade with the world and your other villages, its cashflow, and of that with the world alone */
		flow: { grown: 0, eaten: 0, fromVillages: 0, fromWorld: 0, sold: 0, exported: 0, spoiled: 0, spent: 0, earned: 0, drawn: 0, boughtL: 0, used: 0, waterSpent: 0, wares: 0, imp: 0, exp: 0, wimp: 0, wexp: 0 },
		/** @type {Record<string, number>} */ stock: {},
		/** what is on its way to it, by ware @type {Record<string, number>} */ coming: {},
		coins: 0
	};
}

const base = (/** @type {string} */ w) => /** @type {number} */ (BASE[/** @type {keyof typeof BASE} */ (w)] ?? 1);
/**
 * What a ware is worth to a city: its usual price, dearer the shorter it runs of what it wants, cheaper the more it
 * has beyond. @param {number} want @param {number} have @param {string} w
 */
export function priceFor(w, want, have) {
	const k = want / 3 + 2;
	return base(w) * Math.pow((want + k) / (Math.max(0, have) + k), 0.85);
}
/** what a neighbour wants to have of a ware @param {any} p @param {string} w */
export const keepOf = (p, w) => {
	const need = /** @type {Record<string, number>} */ (NEEDS)[w] ?? 0;
	return need ? need * p.pop * PUT_BY * 1.1 : 6;
};
/** a neighbour's price for a ware @param {any} p @param {string} w */
export const priceIn = (p, w) => priceFor(w, keepOf(p, w), (p.stock[w] ?? 0) + (p.coming[w] ?? 0));
/** what a neighbour can spare of a ware @param {any} p @param {string} w */
export const spareIn = (p, w) => Math.floor((p.stock[w] ?? 0) - keepOf(p, w));
/** what a neighbour lacks of a ware (what is on its way counts) @param {any} p @param {string} w */
export const shortIn = (p, w) => Math.ceil(keepOf(p, w) - (p.stock[w] ?? 0) - (p.coming[w] ?? 0));

/**
 * Needs met for a while: each settlement keeps its homes up with planks and stone (its food and water were met
 * already, in kg and litres). `take(ware)` takes one unit from a settlement's stores and says whether it could.
 * @param {any} p
 * @param {number} pop
 * @param {number} dt seconds
 * @param {(w: string) => boolean} take
 */
export function live(p, pop, dt, take) {
	for (const [need, rate] of /** @type {[keyof typeof NEEDS, number][]} */ (Object.entries(NEEDS))) {
		const per = (rate * pop) / 60;
		p.owe[need] = Math.min(p.owe[need] + per * dt, per * 180 + 1);
		// use what is owed, a unit at a time
		while (p.owe[need] >= 1) {
			if (!take(need)) break;
			p.owe[need] -= 1;
		}
	}
}

/** a neighbour makes its wares (hungry people work less) @param {any} p @param {number} k @param {number} dt */
export function make(p, k, dt) {
	const work = p.hungry ? 0.55 : 1;
	for (const [w, r] of Object.entries(NEIGHBOURS[k - 1].make)) p.stock[w] = (p.stock[w] ?? 0) + ((r * p.pop) / 60) * dt * work;
}

/** a neighbour asks you for what it lacks most, with a reward: a request, or null @param {any} m @param {any[]} parties @param {number} time @param {() => number} rand */
export function request(m, parties, time, rand) {
	const open = m.contracts.filter((/** @type {any} */ c) => c.got < c.n && c.until > time);
	if (open.length >= 3) return null;
	let k = 0, worst = Infinity, need = 'plank';
	for (let j = 1; j < parties.length; j++) {
		if (open.some((/** @type {any} */ c) => c.k === j)) continue;
		const q = parties[j];
		for (const [n, rate] of Object.entries(NEEDS)) {
			// how short it is of what it has put by
			const have = q.stock[n] ?? 0;
			const s = have / (rate * q.pop * PUT_BY);
			if (s < worst) (worst = s), (k = j), (need = n);
		}
	}
	// only a shortage is worth asking for
	if (!k || worst > 0.8) return null;
	const p = parties[k];
	const w = need;
	// as much as it is short, in fives; it pays from its own purse, and with none left it asks for help
	const rate = /** @type {Record<string, number>} */ (NEEDS)[need];
	const n = Math.max(10, Math.min(30, Math.round((rate * p.pop * PUT_BY) / 5) * 5));
	const worth = Math.round(n * Math.max(priceIn(p, w), base(w)) * 1.4);
	const reward = Math.min(worth, Math.floor(p.coins * 0.8));
	const c = { id: ++m.contractSeq, k, w, n, got: 0, reward: reward >= n ? reward : 0, until: time + 600, taken: false };
	m.contracts.push(c);
	if (m.contracts.length > 12) m.contracts.shift();
	return c;
}

export const wareLabel = (/** @type {string} */ w) => WARES[w]?.label ?? w;
