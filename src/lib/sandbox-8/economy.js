// @ts-nocheck — plain JS game state, kept loose on purpose
// Sandbox 7 — avens trading. The rules of the world, without any drawing: ten avens, each with 1,000 HEARTS,
// a territory that grows 1 to 3 of the 5 goods and a ledger of its own prices. Every day each aven needs 3 WATER and
// 2 of each food (FRUITS, VEGETABLES, LEGUMES, CHICKEN). Trades happen where two avens meet, at the seller's price.
// No euros, no outside market: HEARTS only move between avens.

/** @type {Record<string, string>} */
// a validated categorical palette (distinct for colour-blind eyes too), in a fixed order
export const GOOD_COLOUR = { water: '#2a78d6', fruits: '#eb6834', vegetables: '#1baf7a', legumes: '#eda100', chicken: '#e87ba4' };
// every number the valley runs on (needs, rot, the HEARTS policy, prices, land, weather) lives in rules.js
import { RULES, NEED, ROT, GOODS, GOOD_LABEL } from './rules.js';
import { RECIPES, craft, decayAll } from './recipes.js';
export { NEED, ROT, GOODS, GOOD_LABEL };

export const DAY_S = 86400; // in-game seconds in a day
export const WORLD = { w: 1200, h: 820 };
export const MEET_R = 26; // two avens this close can trade
/** the market square in the middle of the valley: everyone standing in it can trade with everyone else there */
export const MARKET = { x: WORLD.w / 2, y: WORLD.h / 2, r: 72 };

const NAMES = ['Ama', 'Bo', 'Cyra', 'Dov', 'Eli', 'Fen', 'Gia', 'Hal', 'Ivo', 'Juno'];
const COLOURS = ['#e05a6d', '#f0a03c', '#4fb37a', '#4f8fd9', '#9b6bd6', '#2bb3b1', '#b8763a', '#d65db1', '#7f8c3a', '#5a6bd6'];
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

/** where the ten lands lie: four along the top, one on the right, four along the bottom, one on the left, the market square in the middle */
const LANDS = [
	{ x: 150, y: 125 },
	{ x: 450, y: 125 },
	{ x: 750, y: 125 },
	{ x: 1050, y: 125 },
	{ x: 1050, y: 410 },
	{ x: 1050, y: 695 },
	{ x: 750, y: 695 },
	{ x: 450, y: 695 },
	{ x: 150, y: 695 },
	{ x: 150, y: 410 }
];

/** who grows what: each aven 1 to 3 goods (about 3 in 10 grow one, 3 in 10 three), every good with at least 2 growers */
function dealLand(rand, count) {
	const one = RULES.oneGood / 100,
		three = RULES.threeGoods / 100;
	const growers = Math.min(count, RULES.growers);
	for (let tries = 0; ; tries++) {
		const lands = NAMES.slice(0, count).map(() => {
			const r = rand();
			const k = r < one ? 1 : r < one + three ? 3 : 2;
			return [...GOODS].sort(() => rand() - 0.5).slice(0, k);
		});
		if (tries > 500 || GOODS.every((g) => lands.filter((l) => l.includes(g)).length >= growers)) return lands;
	}
}

/** how much each grower makes: the valley's supply of a good is only just over its need (Samuel: no abundance yet,
 * 5–25% over, more for food that rots; WATER counts the rain barrels), split very unevenly between its growers */
function dealCapacity(rand, lands) {
	const produce = lands.map(() => ({}));
	const rain = lands.length * (RULES.rainChance / 100) * (1 + RULES.rainMax) / 2;
	for (const g of GOODS) {
		const growers = lands.map((l, i) => (l.includes(g) ? i : -1)).filter((i) => i >= 0);
		const over = g === 'water' ? 1 + (RULES.overWater - 5 + rand() * 10) / 100 : 1 + (RULES.overFood - 7 + rand() * 14) / 100 + ROT[g] * 0.3;
		const total = Math.max(0, NEED[g] * lands.length * over - (g === 'water' ? rain : 0));
		const weight = growers.map(() => 0.25 + rand() * rand() * RULES.uneven);
		const sum = weight.reduce((n, w) => n + w, 0);
		growers.forEach((i, k) => (produce[i][g] = Math.max(1, Math.round((total * weight[k]) / sum))));
	}
	return produce;
}

/** a fresh valley: ten avens, ten territories on a ring round the market square */
/** @returns {any} */
export function createWorld(seed = Date.now() % 1e9) {
	const rand = rng(seed);
	const lands = dealLand(rand, RULES.avens);
	const capacity = dealCapacity(rand, lands);
	const avens = NAMES.slice(0, RULES.avens).map((name, i) => {
		const home = LANDS[i];
		const grows = GOODS.filter((g) => lands[i].includes(g));
		const produce = capacity[i];
		// its stance against the market: asks a markup over the market price for what it grows, a share of it for what it buys
		const markup = {},
			ask = {},
			bid = {};
		for (const g of GOODS) markup[g] = grows.includes(g) ? 1 + rand() * 0.15 : 0.85 + rand() * 0.15;
		for (const g of GOODS) (grows.includes(g) ? ask : bid)[g] = cents(RULES.startPrice * markup[g]);
		return {
			id: i,
			name,
			colour: COLOURS[i],
			home,
			territory: { x: home.x, y: home.y, r: 100 },
			grows,
			produce,
			x: home.x + (rand() - 0.5) * 60,
			y: home.y + (rand() - 0.5) * 60,
			target: null, // { x, y } or { aven }
			hearts: RULES.startHearts,
			minted: 0, // HEARTS minted so far
			decayed: 0, // HEARTS lost to decay so far
			// two days' rations to start, so nobody starves before the first trade, plus the first day's harvest
			stock: Object.fromEntries(GOODS.map((g) => [g, NEED[g] * RULES.startDays + (produce[g] ?? 0)])),
			markup, // per good: its price as a share of the market price, set by its brain each morning
			ask, // what it sells for, per unit: the market price times its markup, moving with the market every hour
			bid, // the most it pays, per unit, the same way
			flex: 0.1, // how far it gives in when haggling, as a share of its own price
			reserveDays: RULES.reserveDays, // how many days of each need it wants in stock
			harvest: { ...produce }, // what its land actually gave last night
			carry: {}, // what it bought and carries until it is back on its own land
			plan: [], // today's route, as its brain chose it: aven ids to walk to in order, or 'home'
			health: 100,
			body: { water: 100, food: 100 },
			alive: true,
			diedOn: null,
			today: blankDay(),
			ledger: [], // newest last: { day, kind: 'buy'|'sell'|'eat'|'price'|'grow'|'death', ... }
			brain: { source: 'local', pending: false, last: null, error: null },
			metAt: {} // aven id -> in-game time of the last meeting, so they don't haggle on every frame
		};
	});
	const market = Object.fromEntries(GOODS.map((g) => [g, { price: RULES.startPrice, ref: RULES.startPrice, supply: 0, demand: 0, open: RULES.startPrice, history: [RULES.startPrice], series: [], sells: [], wants: [] }]));
	const world = { seed, startHearts: RULES.startHearts, t: 0, day: 1, avens, rotted: Object.fromEntries(GOODS.map((g) => [g, 0])), trades: [], rand, market, lastPrice: Object.fromEntries(GOODS.map((g) => [g, null])), events: [], weather: { dry: 0, dryFrom: 0, rain: 0 }, stats: [], tally: blankTally() };
	updateMarket(world);
	record(world, 0, {});
	return world;
}

/**
 * The valley's market board, live: for each good, who sells how much at what price and who wants how much at what limit,
 * and a market price that follows the trades and leans with supply against demand. Every hour each aven's own prices
 * follow it, at the markup its brain chose.
 */
/** a price in HEARTS, to the cent, never below 1 cent */
export function cents(v) {
	return Math.max(0.01, Math.round(v * 100) / 100);
}

export function updateMarket(world) {
	const live = world.avens.filter((a) => a.alive);
	for (const g of GOODS) {
		const m = world.market[g];
		m.sells = live.filter((a) => spare(a, g) > 0).map((a) => ({ id: a.id, name: a.name, qty: spare(a, g), price: a.ask[g] })).sort((x, y) => x.price - y.price);
		m.wants = live.filter((a) => want(a, g) > 0).map((a) => ({ id: a.id, name: a.name, qty: want(a, g), price: a.bid[g] })).sort((x, y) => y.price - x.price);
		m.supply = m.sells.reduce((n, o) => n + o.qty, 0);
		// only what buyers can pay for counts as wanted: an aven with no HEARTS left can't lift the price
		m.demand = m.wants.reduce((n, o) => n + Math.min(o.qty, Math.floor(world.avens[o.id].hearts / Math.max(1, o.price))), 0);
		// more wanted than offered pushes the price up, more offered than wanted pulls it down, with no cap (Samuel: prices
		// are 100% free): each hour the price moves by the 48th root of wanted ÷ offered, so twice as much wanted as
		// offered raises it about 41% a day. What's offered counts at most each seller's daily surplus, so old stock piling
		// up doesn't sink the price for ever
		const flow = m.sells.reduce((n, o) => n + Math.min(o.qty, Math.max(1, world.avens[o.id].produce[g] - NEED[g])), 0);
		m.ref = Math.max(0.01, m.ref * ((m.demand + 1) / (flow + 1)) ** (1 / (24 * RULES.priceDays)));
		m.price = cents(m.ref);
		// the price over time, for the chart: one point an hour, the last 120 days
		if (m.series.at(-1)?.t === world.t) m.series.at(-1).price = m.price;
		else m.series.push({ t: world.t, price: m.price });
		if (m.series.length > 24 * 120) m.series.shift();
	}
	for (const a of live)
		for (const g of GOODS) (a.grows.includes(g) ? a.ask : a.bid)[g] = cents(world.market[g].price * a.markup[g]);
}

/** one night's harvest of a good, as its grow recipe says: about its capacity ± the swing, now and then a bad (30–60%)
 * or a rich (130–160%) night, and WATER low in a dry spell */
function harvest(world, cap, g) {
	const r = world.rand();
	// in a dry spell the wells give far less: every WATER field on 40–70%
	if (g === 'water' && world.weather.dry) return { qty: Math.max(0, Math.round(cap * Math.max(0, RULES.dryWells / 100 - 0.15 + world.rand() * 0.3))), kind: 'dry' };
	let f, kind;
	const swing = RULES.swing / 100;
	if (r < RULES.badChance / 100) (f = 0.3 + world.rand() * 0.3), (kind = 'bad');
	else if (r > 1 - RULES.richChance / 100) (f = 1.3 + world.rand() * 0.3), (kind = 'rich');
	else (f = 1 - swing + (world.rand() + world.rand()) * swing), (kind = 'normal');
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
	return { price: cents((Math.max(floor, bid) + Math.min(ceiling, ask)) / 2), ask, bid, haggled: true };
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
			const total = Math.round(qty * price * 100) / 100;
			seller.stock[g] -= qty;
			buyer.stock[g] += qty;
			buyer.carry[g] = (buyer.carry[g] ?? 0) + qty; // it carries this home
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
			world.tally.units[g] += qty;
			world.tally.deals += 1;
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
		if (next === 'market') return marketSpot(world, world.t + RULES.marketHours * 3600);
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
		const speed = (RULES.walk / 3600) * (a.target.wander || (a.target.market && atMarket(a)) ? 0.35 : 1) * (0.5 + a.health / 200);
		const move = speed * dt;
		// back on its own land, it puts what it carries into its store
		if (Math.hypot(a.x - a.territory.x, a.y - a.territory.y) < a.territory.r) a.carry = {};
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
			if (a.metAt[b.id] != null && world.t - a.metAt[b.id] < RULES.meetHours * 3600) continue;
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

/** night: the market closes its day, then every aven runs the night's recipes (drink, eat, mint, see recipes.js),
 * every resource decays by its own rule (food rots, HEARTS melt), the starved die, and the lands grow tomorrow's goods */
function endOfDay(world) {
	const nightRot = Object.fromEntries(GOODS.map((g) => [g, 0]));
	for (const g of GOODS) {
		const m = world.market[g];
		// the day's average trade price pulls the market price part of the way towards it
		world.tally.avg[g] = m.dayQty ? Math.round((m.dayValue / m.dayQty) * 10) / 10 : null;
		if (m.dayQty) m.ref = Math.max(0.01, m.ref + (m.dayValue / m.dayQty - m.ref) * (RULES.tradePull / 100));
		m.dayQty = m.dayValue = 0;
		m.history.push(m.price);
		if (m.history.length > 120) m.history.shift();
		m.open = m.price;
	}
	const recipes = RECIPES();
	const meals = recipes.filter((r) => r.by === 'aven' && r.id !== 'mint');
	const mint = recipes.find((r) => r.id === 'mint');
	for (const a of world.avens) {
		if (a.alive) {
			const ate = {},
				short = {};
			for (const r of meals) {
				const { took, missing } = craft(r, a);
				Object.assign(ate, took);
				Object.assign(short, missing);
			}
			a.health = Math.round(Math.min(a.body.water, a.body.food));
			log(world, a, { kind: 'eat', short, health: a.health });
			a.today.short = short;
			a.today.ate = ate;
		}
		// each resource's own decay: what's left in store rots, every balance of HEARTS melts a little
		const lost = decayAll(a, world.rand);
		const rotted = {};
		for (const g of GOODS)
			if (lost[g]) {
				rotted[g] = lost[g];
				world.rotted[g] += lost[g];
				if (a.alive) nightRot[g] += lost[g];
			}
		if (a.alive && Object.keys(rotted).length) log(world, a, { kind: 'rot', rotted });
		a.today.rotted = rotted;
		if (lost.HEARTS) {
			a.decayed += lost.HEARTS;
			world.tally.decayed += lost.HEARTS;
		}
		if (a.alive && a.health <= 0) {
			a.alive = false;
			a.diedOn = world.day;
			log(world, a, { kind: 'death' });
		}
		if (a.alive) {
			craft(mint, a);
			a.minted += mint.out.HEARTS;
			world.tally.minted += mint.out.HEARTS;
		}
		a.hearts = Math.round(a.hearts * 100) / 100;
	}
	world.day += 1;
	weather(world);
	for (const a of world.avens) {
		a.yesterday = a.today;
		a.today = blankDay();
		if (!a.alive) continue;
		for (const g of a.grows) {
			const { qty, kind } = harvest(world, a.produce[g], g);
			a.harvest[g] = qty;
			a.stock[g] += qty;
			if (kind !== 'normal') log(world, a, { kind: 'grow', good: g, qty, cap: a.produce[g], note: kind });
		}
		// every land has a rain barrel: the second way to get water, for growers and buyers alike
		if (world.weather.rain) {
			a.stock.water += world.weather.rain;
			log(world, a, { kind: 'rain', qty: world.weather.rain });
		}
	}
	updateMarket(world);
	record(world, world.day - 1, nightRot);
}

/** a fresh count of the day's flows */
function blankTally() {
	return { units: Object.fromEntries(GOODS.map((g) => [g, 0])), deals: 0, avg: {}, minted: 0, decayed: 0 };
}

/** one row of the valley's daily stats, at the end of a day (day 0 = the start): everything the Stats view charts */
function record(world, day, rotted) {
	const k = world.tally;
	const live = world.avens.filter((a) => a.alive);
	world.stats.push({
		day,
		price: Object.fromEntries(GOODS.map((g) => [g, world.market[g].price])),
		avg: Object.fromEntries(GOODS.map((g) => [g, k.avg[g] ?? null])),
		units: { ...k.units },
		deals: k.deals,
		hearts: Object.fromEntries(world.avens.map((a) => [a.id, Math.round(a.hearts)])),
		total: Math.round(world.avens.reduce((n, a) => n + a.hearts, 0)),
		minted: k.minted,
		decayed: Math.round(k.decayed * 100) / 100,
		rotted: Object.fromEntries(GOODS.map((g) => [g, rotted[g] ?? 0])),
		harvest: Object.fromEntries(GOODS.map((g) => [g, live.reduce((n, a) => n + (a.grows.includes(g) ? a.harvest[g] : 0), 0) + (g === 'water' ? live.length * world.weather.rain : 0)])),
		stock: Object.fromEntries(GOODS.map((g) => [g, live.reduce((n, a) => n + a.stock[g], 0)])),
		alive: live.length,
		// each aven's night: what it ate and drank, what it went short of, and its body's two reserves
		ate: Object.fromEntries(world.avens.map((a) => [a.id, { ...(a.yesterday?.ate ?? {}) }])),
		short: Object.fromEntries(world.avens.map((a) => [a.id, { ...(a.yesterday?.short ?? {}) }])),
		health: Object.fromEntries(world.avens.map((a) => [a.id, a.alive ? a.health : 0])),
		body: Object.fromEntries(world.avens.map((a) => [a.id, { water: Math.round(a.body.water), food: Math.round(a.body.food) }])),
		dry: world.weather.dry > 0,
		rain: world.weather.rain
	});
	world.tally = blankTally();
}

/** the night's weather, valley-wide: now and then a dry spell begins (wells run low, no rain); otherwise, some nights
 * it rains and every land's barrel catches a little WATER (see RULES) */
function weather(world) {
	const w = world.weather;
	if (w.dry) w.dry -= 1;
	else if (world.rand() < RULES.dryChance / 100) {
		const lo = Math.min(RULES.dryMin, RULES.dryMax);
		w.dry = lo + Math.floor(world.rand() * (Math.max(RULES.dryMin, RULES.dryMax) - lo + 1));
		w.dryFrom = world.day;
	}
	w.rain = !w.dry && RULES.rainMax > 0 && world.rand() < RULES.rainChance / 100 ? 1 + Math.floor(world.rand() * RULES.rainMax) : 0;
}

/** the board: the living by HEARTS, then the dead by how long they lasted @returns {any[]} */
export function ranking(world) {
	return [...world.avens].sort((a, b) => (a.alive !== b.alive ? (a.alive ? -1 : 1) : a.alive ? b.hearts - a.hearts : (b.diedOn ?? 0) - (a.diedOn ?? 0)));
}
