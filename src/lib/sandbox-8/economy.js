// @ts-nocheck — plain JS game state, kept loose on purpose
// Sandbox 7 — avens trading. The rules of the world, without any drawing: five avens, each with 125,000 HEARTS,
// a territory that grows 2 of the 5 goods and a ledger of its own prices. Every day each aven needs 3 WATER and
// 2 of each food (FRUITS, VEGETABLES, LEGUMES, CHICKEN). Trades happen where two avens meet, at the seller's price.
// No euros, no outside market: HEARTS only move between avens.

export const GOODS = ['water', 'fruits', 'vegetables', 'legumes', 'chicken'];
/** @type {Record<string, string>} */
export const GOOD_LABEL = { water: 'WATER', fruits: 'FRUITS', vegetables: 'VEGETABLES', legumes: 'LEGUMES', chicken: 'CHICKEN' };
/** @type {Record<string, string>} */
// a validated categorical palette (distinct for colour-blind eyes too), in a fixed order
export const GOOD_COLOUR = { water: '#2a78d6', fruits: '#eb6834', vegetables: '#1baf7a', legumes: '#eda100', chicken: '#e87ba4' };
/** what one aven needs to eat and drink each day @type {Record<string, number>} */
export const NEED = { water: 3, fruits: 2, vegetables: 2, legumes: 2, chicken: 2 };
/** the share of a stock that rots each night: water keeps, fresh food goes fast, legumes (dry, with nuts and seeds) keep long
 * @type {Record<string, number>} */
export const ROT = { water: 0, fruits: 0.25, vegetables: 0.2, legumes: 0.03, chicken: 0.3 };

export const START_HEARTS = 125000;
export const START_PRICE = 100; // HEARTS a unit, where every price begins
export const DAY_S = 86400; // in-game seconds in a day
export const WORLD = { w: 1000, h: 700 };
export const MEET_R = 26; // two avens this close can trade
/** the market square in the middle of the valley: everyone standing in it can trade with everyone else there */
export const MARKET = { x: WORLD.w / 2, y: WORLD.h / 2, r: 72 };
const MARKET_STAY = 3 * 3600; // how long an aven stays at the market once there
const WALK = 260 / 3600; // world units per in-game second (260 an hour)

const NAMES = ['Ama', 'Bo', 'Cyra', 'Dov', 'Eli'];
const COLOURS = ['#e05a6d', '#f0a03c', '#4fb37a', '#4f8fd9', '#9b6bd6'];
/** health lost at night for each unit missing */
const HURT = { water: 12, food: 5 };

/** a small seeded random, so a reset with the same seed gives the same valley */
export function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 4294967296;
	};
}

/** a fresh valley: five avens, five territories on a ring, each growing goods i and i+1 so every good has two growers */
/** @returns {any} */
export function createWorld(seed = Date.now() % 1e9) {
	const rand = rng(seed);
	const cx = WORLD.w / 2,
		cy = WORLD.h / 2;
	const avens = NAMES.map((name, i) => {
		const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
		const home = { x: cx + Math.cos(a) * 250, y: cy + Math.sin(a) * 230 };
		const grows = [GOODS[i], GOODS[(i + 1) % 5]];
		/** capacity, units a day on average: water 8–13 (two growers cover the 15 all five drink), food 5–10 (two cover the 10 all eat, mostly) */
		const produce = Object.fromEntries(grows.map((g) => [g, g === 'water' ? 8 + Math.floor(rand() * 6) : 5 + Math.floor(rand() * 6)]));
		// its stance against the market: asks a markup over the market price for what it grows, a share of it for what it buys
		const markup = {},
			ask = {},
			bid = {};
		for (const g of GOODS) markup[g] = grows.includes(g) ? 1 + rand() * 0.15 : 0.85 + rand() * 0.15;
		for (const g of GOODS) (grows.includes(g) ? ask : bid)[g] = Math.round(START_PRICE * markup[g]);
		return {
			id: i,
			name,
			colour: COLOURS[i],
			home,
			territory: { x: home.x, y: home.y, r: 120 },
			grows,
			produce,
			x: home.x + (rand() - 0.5) * 60,
			y: home.y + (rand() - 0.5) * 60,
			target: null, // { x, y } or { aven }
			hearts: START_HEARTS,
			// two days' rations to start, so nobody starves before the first trade, plus the first day's harvest
			stock: Object.fromEntries(GOODS.map((g) => [g, NEED[g] * 2 + (produce[g] ?? 0)])),
			markup, // per good: its price as a share of the market price, set by its brain each morning
			ask, // what it sells for, per unit: the market price times its markup, moving with the market every hour
			bid, // the most it pays, per unit, the same way
			flex: 0.1, // how far it gives in when haggling, as a share of its own price
			reserveDays: 3, // how many days of each need it wants in stock
			harvest: { ...produce }, // what its land actually gave last night
			plan: [], // today's route, as its brain chose it: aven ids to walk to in order, or 'home'
			health: 100,
			alive: true,
			diedOn: null,
			today: blankDay(),
			ledger: [], // newest last: { day, kind: 'buy'|'sell'|'eat'|'price'|'grow'|'death', ... }
			brain: { source: 'local', pending: false, last: null, error: null },
			metAt: {} // aven id -> in-game time of the last meeting, so they don't haggle on every frame
		};
	});
	const market = Object.fromEntries(GOODS.map((g) => [g, { price: START_PRICE, ref: START_PRICE, supply: 0, demand: 0, open: START_PRICE, history: [START_PRICE], series: [], sells: [], wants: [] }]));
	const world = { seed, t: 0, day: 1, avens, rotted: Object.fromEntries(GOODS.map((g) => [g, 0])), trades: [], rand, market, lastPrice: Object.fromEntries(GOODS.map((g) => [g, null])), events: [] };
	updateMarket(world);
	return world;
}

/**
 * The valley's market board, live: for each good, who sells how much at what price and who wants how much at what limit,
 * and a market price that follows the trades and leans with supply against demand. Every hour each aven's own prices
 * follow it, at the markup its brain chose.
 */
export function updateMarket(world) {
	const live = world.avens.filter((a) => a.alive);
	for (const g of GOODS) {
		const m = world.market[g];
		m.sells = live.filter((a) => spare(a, g) > 0).map((a) => ({ id: a.id, name: a.name, qty: spare(a, g), price: a.ask[g] })).sort((x, y) => x.price - y.price);
		m.wants = live.filter((a) => want(a, g) > 0).map((a) => ({ id: a.id, name: a.name, qty: want(a, g), price: a.bid[g] })).sort((x, y) => y.price - x.price);
		m.supply = m.sells.reduce((n, o) => n + o.qty, 0);
		m.demand = m.wants.reduce((n, o) => n + o.qty, 0);
		// more wanted than offered pushes the price up, more offered than wanted pulls it down (at most ±0.25% an hour, ±6% a day);
		// what's offered counts at most each seller's daily surplus, so old stock piling up doesn't sink the price for ever
		const flow = m.sells.reduce((n, o) => n + Math.min(o.qty, world.avens[o.id].produce[g] - NEED[g]), 0);
		const tilt = (m.demand - flow) / (m.demand + flow + 1);
		m.ref = Math.max(1, m.ref * (1 + 0.0025 * tilt));
		m.price = Math.max(1, Math.round(m.ref * (1 + 0.1 * tilt)));
		// the price over time, for the chart: one point an hour, the last 120 days
		if (m.series.at(-1)?.t === world.t) m.series.at(-1).price = m.price;
		else m.series.push({ t: world.t, price: m.price });
		if (m.series.length > 24 * 120) m.series.shift();
	}
	for (const a of live)
		for (const g of GOODS) (a.grows.includes(g) ? a.ask : a.bid)[g] = Math.max(1, Math.round(world.market[g].price * a.markup[g]));
}

/** one night's harvest of a good: about its capacity, give or take a quarter; one night in 20 a bad harvest (30–60%),
 * one in 20 a rich one (130–160%) */
function harvest(world, cap) {
	const r = world.rand();
	let f, kind;
	if (r < 0.05) (f = 0.3 + world.rand() * 0.3), (kind = 'bad');
	else if (r > 0.95) (f = 1.3 + world.rand() * 0.3), (kind = 'rich');
	else (f = 0.75 + (world.rand() + world.rand()) * 0.25), (kind = 'normal');
	return { qty: Math.max(0, Math.round(cap * f)), kind };
}

function blankDay() {
	return { sold: Object.fromEntries(GOODS.map((g) => [g, 0])), bought: Object.fromEntries(GOODS.map((g) => [g, 0])), short: {} };
}

/** what this aven still wants of a good it doesn't grow, to reach its reserve */
export function want(a, g) {
	if (a.grows.includes(g)) return 0;
	return Math.max(0, NEED[g] * a.reserveDays - a.stock[g]);
}

/** what this aven can spare of a good it grows: everything above a few days of its own need */
export function spare(a, g) {
	if (!a.grows.includes(g)) return 0;
	return Math.max(0, a.stock[g] - NEED[g] * 2);
}

function log(world, a, entry) {
	a.ledger.push({ day: world.day, t: world.t, ...entry });
	if (a.ledger.length > 400) a.ledger.splice(0, a.ledger.length - 400);
}

/**
 * Haggling: the buyer's limit and the seller's price. If they don't meet, each gives in up to its own flexibility;
 * if the gap closes they settle halfway between what each will still accept, else no deal.
 */
export function haggle(seller, buyer, g) {
	const ask = seller.ask[g],
		bid = buyer.bid[g];
	if (ask <= bid) return { price: ask, haggled: false };
	const floor = ask * (1 - seller.flex),
		ceiling = bid * (1 + buyer.flex);
	if (floor > ceiling) return { price: null, ask, bid, haggled: true };
	return { price: Math.max(1, Math.round((Math.max(floor, bid) + Math.min(ceiling, ask)) / 2)), ask, bid, haggled: true };
}

/** two avens meet: each sells what the other wants, at the seller's price or a haggled one */
export function trade(world, a, b) {
	let any = false;
	for (const [seller, buyer] of [
		[a, b],
		[b, a]
	]) {
		for (const g of seller.grows) {
			if (buyer.bid[g] == null || spare(seller, g) <= 0 || want(buyer, g) <= 0) continue;
			const deal = haggle(seller, buyer, g);
			if (deal.price == null) {
				log(world, seller, { kind: 'nodeal', good: g, with: buyer.name, ask: deal.ask, bid: deal.bid });
				log(world, buyer, { kind: 'nodeal', good: g, with: seller.name, ask: deal.ask, bid: deal.bid });
				continue;
			}
			const price = deal.price;
			const qty = Math.min(spare(seller, g), want(buyer, g), Math.floor(buyer.hearts / price));
			if (qty <= 0) continue;
			const total = qty * price;
			seller.stock[g] -= qty;
			buyer.stock[g] += qty;
			seller.hearts += total;
			buyer.hearts -= total;
			seller.today.sold[g] += qty;
			buyer.today.bought[g] += qty;
			world.lastPrice[g] = price;
			// the day's trades are summed up; at night their average price pulls the market price (see endOfDay)
			const m = world.market[g];
			m.dayQty = (m.dayQty ?? 0) + qty;
			m.dayValue = (m.dayValue ?? 0) + total;
			const talk = deal.haggled ? { haggled: { ask: deal.ask, bid: deal.bid } } : {};
			log(world, seller, { kind: 'sell', good: g, qty, price, with: buyer.name, hearts: total, ...talk });
			log(world, buyer, { kind: 'buy', good: g, qty, price, with: seller.name, hearts: -total, ...talk });
			world.trades.push({ day: world.day, t: world.t, seller: seller.id, buyer: buyer.id, good: g, qty, price, haggled: deal.haggled });
			if (world.trades.length > 600) world.trades.splice(0, world.trades.length - 600);
			world.events.push({ kind: 'trade', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, good: g, t: world.t });
			any = true;
		}
	}
	return any;
}

/** where an aven walks next: to the cheapest grower of the good it lacks most, else round its own territory */
/** a spot inside the market square, to stand at until `until` */
function marketSpot(world, until) {
	const r = MARKET.r * 0.8 * Math.sqrt(world.rand()),
		ang = world.rand() * Math.PI * 2;
	return { x: MARKET.x + Math.cos(ang) * r, y: MARKET.y + Math.sin(ang) * r, market: true, until };
}

export const atMarket = (a) => Math.hypot(a.x - MARKET.x, a.y - MARKET.y) <= MARKET.r;

function pickTarget(world, a) {
	// first the route its brain planned this morning; a stop that's dead or just met is skipped
	while (a.plan.length) {
		const next = a.plan.shift();
		if (next === 'home') return { x: a.home.x, y: a.home.y, wander: true };
		if (next === 'market') return marketSpot(world, world.t + MARKET_STAY);
		const s = world.avens[next];
		if (s && s !== a && s.alive && !(a.metAt[s.id] != null && world.t - a.metAt[s.id] < 3 * 3600)) return { aven: s };
	}
	let best = null;
	for (const g of GOODS) {
		const w = want(a, g);
		if (w <= 0) continue;
		const urgency = w / NEED[g];
		for (const s of world.avens) {
			if (s === a || !s.alive || !s.grows.includes(g) || spare(s, g) <= 0) continue;
			if (s.ask[g] * (1 - s.flex) > a.bid[g] * (1 + a.flex)) continue; // too dear even after haggling
			const recent = a.metAt[s.id] != null && world.t - a.metAt[s.id] < 3 * 3600;
			if (recent) continue;
			const d = Math.hypot(s.x - a.x, s.y - a.y);
			const score = urgency * 1000 - d - (s.ask[g] - a.bid[g]) * 2;
			if (!best || score > best.score) best = { score, aven: s };
		}
	}
	if (best) return { aven: best.aven };
	const r = a.territory.r * Math.sqrt(world.rand());
	const ang = world.rand() * Math.PI * 2;
	return { x: a.territory.x + Math.cos(ang) * r, y: a.territory.y + Math.sin(ang) * r, wander: true };
}

/** move the world on by dt in-game seconds (call with small steps); returns true when a new day began */
export function step(world, dt) {
	const before = Math.floor(world.t / DAY_S);
	const hourBefore = Math.floor(world.t / 3600);
	world.t += dt;
	if (Math.floor(world.t / 3600) > hourBefore) updateMarket(world);
	for (const a of world.avens) {
		if (!a.alive) continue;
		if (!a.target || (a.target.aven && !a.target.aven.alive)) a.target = pickTarget(world, a);
		const tx = a.target.aven ? a.target.aven.x : a.target.x;
		const ty = a.target.aven ? a.target.aven.y : a.target.y;
		const d = Math.hypot(tx - a.x, ty - a.y);
		const speed = WALK * (a.target.wander || (a.target.market && atMarket(a)) ? 0.35 : 1) * (0.5 + a.health / 200);
		const move = speed * dt;
		if (d <= Math.max(move, a.target.aven ? MEET_R * 0.8 : 4)) {
			// at the market it strolls between the stalls until its time there is up
			if (a.target.market && world.t < a.target.until) a.target = marketSpot(world, a.target.until);
			else if (!a.target.aven) a.target = null;
		} else {
			a.x += ((tx - a.x) / d) * move;
			a.y += ((ty - a.y) / d) * move;
		}
	}
	// meetings: any two avens close enough, or both in the market square, haggle at most once every in-game hour
	const live = world.avens.filter((a) => a.alive);
	for (let i = 0; i < live.length; i++)
		for (let j = i + 1; j < live.length; j++) {
			const a = live[i],
				b = live[j];
			if (Math.hypot(a.x - b.x, a.y - b.y) > MEET_R && !(atMarket(a) && atMarket(b))) continue;
			if (a.metAt[b.id] != null && world.t - a.metAt[b.id] < 3600) continue;
			a.metAt[b.id] = b.metAt[a.id] = world.t;
			trade(world, a, b);
			if (a.target?.aven === b) a.target = null;
			if (b.target?.aven === a) b.target = null;
		}
	world.events = world.events.filter((e) => world.t - e.t < 1800);
	const after = Math.floor(world.t / DAY_S);
	if (after > before) {
		endOfDay(world);
		return true;
	}
	return false;
}

/** night: everyone eats and drinks, the hungry lose health, then the territories grow tomorrow's goods */
function endOfDay(world) {
	for (const a of world.avens) {
		if (!a.alive) continue;
		const short = {};
		let hurt = 0;
		for (const g of GOODS) {
			const eat = Math.min(NEED[g], a.stock[g]);
			a.stock[g] -= eat;
			if (eat < NEED[g]) {
				short[g] = NEED[g] - eat;
				hurt += short[g] * (g === 'water' ? HURT.water : HURT.food);
			}
		}
		a.health = hurt ? Math.max(0, a.health - hurt) : Math.min(100, a.health + 10);
		log(world, a, { kind: 'eat', short, health: a.health });
		a.today.short = short;
		// then what's left starts to rot
		const rotted = {};
		for (const g of GOODS) {
			const x = a.stock[g] * ROT[g];
			const lost = Math.min(a.stock[g], Math.floor(x) + (world.rand() < x % 1 ? 1 : 0));
			if (!lost) continue;
			a.stock[g] -= lost;
			rotted[g] = lost;
			world.rotted[g] += lost;
		}
		if (Object.keys(rotted).length) log(world, a, { kind: 'rot', rotted });
		a.today.rotted = rotted;
		if (a.health <= 0) {
			a.alive = false;
			a.diedOn = world.day;
			log(world, a, { kind: 'death' });
		}
	}
	for (const g of GOODS) {
		const m = world.market[g];
		// the day's average trade price pulls the market price 30% of the way towards it
		if (m.dayQty) m.ref = Math.max(1, m.ref * 0.7 + (m.dayValue / m.dayQty) * 0.3);
		m.dayQty = m.dayValue = 0;
		m.history.push(m.price);
		if (m.history.length > 120) m.history.shift();
		m.open = m.price;
	}
	world.day += 1;
	for (const a of world.avens) {
		a.yesterday = a.today;
		a.today = blankDay();
		if (!a.alive) continue;
		for (const g of a.grows) {
			const { qty, kind } = harvest(world, a.produce[g]);
			a.harvest[g] = qty;
			a.stock[g] += qty;
			if (kind !== 'normal') log(world, a, { kind: 'grow', good: g, qty, cap: a.produce[g], note: kind });
		}
	}
	updateMarket(world);
}

/** the board: the living by HEARTS, then the dead by how long they lasted @returns {any[]} */
export function ranking(world) {
	return [...world.avens].sort((a, b) => (a.alive !== b.alive ? (a.alive ? -1 : 1) : a.alive ? b.hearts - a.hearts : (b.diedOn ?? 0) - (a.diedOn ?? 0)));
}
