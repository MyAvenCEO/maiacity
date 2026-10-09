// @ts-nocheck — plain JS game state, kept loose on purpose
// Sandbox 7 — avens trading. The rules of the world, without any drawing: five avens, each with 125,000 HEARTS,
// a territory that grows 2 of the 5 goods and a ledger of its own prices. Every day each aven needs 3 WATER and
// 2 of each food (FRUITS, VEGETABLES, LEGUMES, CHICKEN). Trades happen where two avens meet, at the seller's price.
// No euros, no outside market: HEARTS only move between avens.

export const GOODS = ['water', 'fruits', 'vegetables', 'legumes', 'chicken'];
/** @type {Record<string, string>} */
export const GOOD_LABEL = { water: 'WATER', fruits: 'FRUITS', vegetables: 'VEGETABLES', legumes: 'LEGUMES', chicken: 'CHICKEN' };
/** @type {Record<string, string>} */
export const GOOD_COLOUR = { water: '#4a9fd8', fruits: '#e8784a', vegetables: '#5fae4e', legumes: '#c9a24a', chicken: '#d9c7a3' };
/** what one aven needs to eat and drink each day @type {Record<string, number>} */
export const NEED = { water: 3, fruits: 2, vegetables: 2, legumes: 2, chicken: 2 };

export const START_HEARTS = 125000;
export const START_PRICE = 100; // HEARTS a unit, where every price begins
export const DAY_S = 86400; // in-game seconds in a day
export const WORLD = { w: 1000, h: 700 };
export const MEET_R = 26; // two avens this close can trade
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
		/** units a day: water growers 9–11 (two cover the 15 all five drink), food growers 6–8 (two cover the 10 all eat) */
		const produce = Object.fromEntries(grows.map((g) => [g, g === 'water' ? 9 + Math.floor(rand() * 3) : 6 + Math.floor(rand() * 3)]));
		const ask = {},
			bid = {};
		for (const g of GOODS) {
			if (grows.includes(g)) ask[g] = Math.round(START_PRICE * (0.85 + rand() * 0.3));
			else bid[g] = Math.round(START_PRICE * (0.85 + rand() * 0.3));
		}
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
			ask, // what it sells for, per unit
			bid, // the most it pays, per unit
			reserveDays: 3, // how many days of each need it wants in stock
			health: 100,
			alive: true,
			diedOn: null,
			today: blankDay(),
			ledger: [], // newest last: { day, kind: 'buy'|'sell'|'eat'|'price'|'grow'|'death', ... }
			brain: { source: 'local', pending: false, last: null, error: null },
			metAt: {} // aven id -> in-game time of the last meeting, so they don't haggle on every frame
		};
	});
	return { seed, t: 0, day: 1, avens, trades: [], rand, lastPrice: Object.fromEntries(GOODS.map((g) => [g, null])), events: [] };
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

/** two avens meet: each sells what the other wants, at the seller's asking price, if the buyer's limit reaches it */
export function trade(world, a, b) {
	let any = false;
	for (const [seller, buyer] of [
		[a, b],
		[b, a]
	]) {
		for (const g of seller.grows) {
			const price = seller.ask[g];
			if (buyer.bid[g] == null || price > buyer.bid[g]) continue;
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
			log(world, seller, { kind: 'sell', good: g, qty, price, with: buyer.name, hearts: total });
			log(world, buyer, { kind: 'buy', good: g, qty, price, with: seller.name, hearts: -total });
			world.trades.push({ day: world.day, t: world.t, seller: seller.id, buyer: buyer.id, good: g, qty, price });
			if (world.trades.length > 600) world.trades.splice(0, world.trades.length - 600);
			world.events.push({ kind: 'trade', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, good: g, t: world.t });
			any = true;
		}
	}
	return any;
}

/** where an aven walks next: to the cheapest grower of the good it lacks most, else round its own territory */
function pickTarget(world, a) {
	let best = null;
	for (const g of GOODS) {
		const w = want(a, g);
		if (w <= 0) continue;
		const urgency = w / NEED[g];
		for (const s of world.avens) {
			if (s === a || !s.alive || !s.grows.includes(g) || spare(s, g) <= 0) continue;
			if (s.ask[g] > a.bid[g] * 1.25) continue; // too dear to walk to
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
	world.t += dt;
	for (const a of world.avens) {
		if (!a.alive) continue;
		if (!a.target || (a.target.aven && !a.target.aven.alive)) a.target = pickTarget(world, a);
		const tx = a.target.aven ? a.target.aven.x : a.target.x;
		const ty = a.target.aven ? a.target.aven.y : a.target.y;
		const d = Math.hypot(tx - a.x, ty - a.y);
		const speed = WALK * (a.target.wander ? 0.35 : 1) * (0.5 + a.health / 200);
		const move = speed * dt;
		if (d <= Math.max(move, a.target.aven ? MEET_R * 0.8 : 4)) {
			if (!a.target.aven) a.target = null;
		} else {
			a.x += ((tx - a.x) / d) * move;
			a.y += ((ty - a.y) / d) * move;
		}
	}
	// meetings: any two avens close enough haggle, at most once every in-game hour
	const live = world.avens.filter((a) => a.alive);
	for (let i = 0; i < live.length; i++)
		for (let j = i + 1; j < live.length; j++) {
			const a = live[i],
				b = live[j];
			if (Math.hypot(a.x - b.x, a.y - b.y) > MEET_R) continue;
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
		if (a.health <= 0) {
			a.alive = false;
			a.diedOn = world.day;
			log(world, a, { kind: 'death' });
		}
	}
	world.day += 1;
	for (const a of world.avens) {
		a.yesterday = a.today;
		a.today = blankDay();
		if (!a.alive) continue;
		for (const g of a.grows) a.stock[g] += a.produce[g];
	}
}

/** the board: the living by HEARTS, then the dead by how long they lasted @returns {any[]} */
export function ranking(world) {
	return [...world.avens].sort((a, b) => (a.alive !== b.alive ? (a.alive ? -1 : 1) : a.alive ? b.hearts - a.hearts : (b.diedOn ?? 0) - (a.diedOn ?? 0)));
}
