// @ts-nocheck — plain JS game state, kept loose on purpose
// Sandbox 7 — avens trading. The rules of the world, without any drawing: ten avens, each with 1,000 HEARTS,
// a territory that grows 1 to 3 of the 5 goods and a ledger of its own prices. Every day each aven needs 3 WATER and
// 2 of each food (FRUITS, VEGETABLES, LEGUMES, CHICKEN). There is no market place: every few hours (clearHours) each
// good's asks and bids are matched, the best price against the best limit, and a deal is struck at the seller's price
// or a haggled one. Then the buyer walks to the seller to fetch what it bought and carries it home (Samuel: the walking
// comes from an actual trade). No euros, no outside market: HEARTS only move between avens.

/** @type {Record<string, string>} */
// a validated categorical palette (distinct for colour-blind eyes too), in a fixed order
export const GOOD_COLOUR = { water: '#2a78d6', fruits: '#eb6834', vegetables: '#1baf7a', legumes: '#eda100', chicken: '#e87ba4' };
// every number the valley runs on (needs, rot, the HEARTS policy, prices, land, weather) lives in rules.js
import { RULES, NEED, ROT, GOODS, GOOD_LABEL } from './rules.js';
import { RECIPES, craft, decayAll } from './recipes.js';
export { NEED, ROT, GOODS, GOOD_LABEL };

export const DAY_S = 86400; // in-game seconds in a day

/** the config's card code (sandbox.js, loaded by the page): every rule of the valley is one of its hooks (the section
 * cards' own code, else their default, game/economy/rules-code.js). The rules below are the same, kept natively only as
 * the fallback: for a hook whose card failed, and while (or where) QuickJS isn't loaded. `seen`: the code it last
 * showed the valley to; a hook runs only once it has seen it */
export const CODE = { run: /** @type {any} */ (null), seen: /** @type {any} */ (null) };

/** what card code sees of an aven (a copy: nothing it does reaches the valley) */
export const avenView = (a) => ({ id: a.id, name: a.name, alive: a.alive, hearts: a.hearts, health: a.health, grows: a.grows, produce: a.produce, harvest: a.harvest ?? null, stock: a.stock, body: a.body, need: a.need ?? null, keep: a.keep ?? null, memo: a.memo ?? {}, reserveDays: a.reserveDays, ask: a.ask, bid: a.bid, flex: a.flex, choices: a.choices ?? {}, yesterday: a.yesterday ?? null, minted: a.minted, decayed: a.decayed });
/** ...and of the valley, once a night */
function valleyView(world) {
	const live = world.avens.filter((a) => a.alive);
	return { day: world.day, values: RULES, avens: world.avens.map(avenView), alive: live.length, hearts: Math.round(live.reduce((n, a) => n + a.hearts, 0) * 100) / 100, prices: Object.fromEntries(GOODS.map((g) => [g, world.market[g].price])), weather: world.weather };
}
/** show the valley to the card code (each night, and when the code is loaded): what every hook reads as `valley` */
export function seeValley(world) {
	if (!CODE.run) return;
	CODE.run.see(valleyView(world));
	CODE.seen = CODE.run;
	memo.clear();
}
/** a hook's answer (the rule's card, then every other card that exports it), checked by `check` (the valley's own
 * value when the answer won't do); the valley's own value when no code runs it */
function ruled(name, args, value, check) {
	if (!CODE.run || CODE.seen !== CODE.run || !CODE.run.has(name)) return value;
	const v = CODE.run.run(name, args.aven ? { ...args, aven: avenView(args.aven) } : args, value);
	return v === value ? value : check(v, value);
}
/** the Brains card's hooks (asks.js, mind.js): what a brain sees and is asked, and how its days are scored */
export const brainRule = (name, args, value, check) => ruled(name, args, value, check);
/** a number answer, kept within lo..hi (whole if asked) */
const num = (lo, hi, whole = false) => (v, own) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, whole ? Math.round(v) : v)) : own);
function hooked(name, args, value, lo, hi, whole = false) {
	return ruled(name, args, value, num(lo, hi, whole));
}
// want and spare are asked often (the market, the books, the page): their answers are kept until the aven's stock or
// wants change, or the night
const memo = new Map();
function remembered(key, f) {
	if (!memo.has(key)) memo.set(key, f());
	return memo.get(key);
}

export const WORLD = { w: 1200, h: 820 };
/** where an aven stands at home: the middle of its land */
const homeSpot = (a) => ({ x: a.territory.x, y: a.territory.y - 6 });

const NAMES = ['Ama', 'Bo', 'Cyra', 'Dov', 'Eli', 'Fen', 'Gia', 'Hal', 'Ivo', 'Juno'];
const COLOURS = ['#e05a6d', '#f0a03c', '#4fb37a', '#4f8fd9', '#9b6bd6', '#2bb3b1', '#b8763a', '#d65db1', '#7f8c3a', '#5a6bd6'];
/** a small seeded random, so a reset with the same seed gives the same valley; `at` picks it up where a saved world
 * left it (its `.at()`) */
export function rng(seed, at = null) {
	let s = at ?? (seed >>> 0 || 1);
	const next = () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 4294967296;
	};
	next.at = () => s;
	return next;
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
		// no prices to start with (Samuel: they discover them): its brain names its first price per good, in HEARTS
		const ask = {},
			bid = {};
		for (const g of GOODS) (grows.includes(g) ? ask : bid)[g] = null;
		return {
			id: i,
			name,
			colour: COLOURS[i],
			home,
			territory: { x: home.x, y: home.y, r: 100 },
			grows,
			produce,
			x: home.x,
			y: home.y - 6,
			fetch: [], // the sellers it still has to walk to for what it bought: { from: aven id, goods: { good: qty } }
			hearts: RULES.startHearts, // every world is a capsule (Samuel): an aven's money is its own in each
			startHearts: RULES.startHearts, // what it began this life with (a rebirth begins it again)
			minted: 0, // HEARTS minted so far
			decayed: 0, // HEARTS lost to decay so far
			// two days' rations to start, so nobody starves before the first trade, plus the first day's harvest
			stock: Object.fromEntries(GOODS.map((g) => [g, NEED[g] * RULES.startDays + (produce[g] ?? 0)])),
			ask, // what it sells for, per unit, in HEARTS: set by its brain, null until it first decides
			bid, // the most it pays, per unit, the same way
			choices: {}, // its answers to decisions its world adds (the ask hook's own keys), read by every hook
			flex: 0.1, // how far it gives in when haggling, as a share of its own price
			reserveDays: RULES.reserveDays, // how many days of each need it wants in stock
			harvest: { ...produce }, // what its land actually gave last night
			carry: {}, // what it fetched and carries until it is back on its own land
			health: RULES.healthMax,
			body: { water: 100, food: 100 },
			alive: true,
			diedOn: null,
			today: blankDay(),
			ledger: [], // newest last: { day, kind: 'buy'|'sell'|'eat'|'price'|'grow'|'death', ... }
			brain: { ready: false, pending: false, last: null, error: null, t0: -Infinity, realAt: -Infinity } // ready once Liquid first decided
		};
	});
	const market = Object.fromEntries(GOODS.map((g) => [g, { price: null, supply: 0, demand: 0, open: null, history: [], series: [], sells: [], wants: [] }]));
	const world = { seed, startHearts: RULES.startHearts, t: 0, day: 1, avens, rotted: Object.fromEntries(GOODS.map((g) => [g, 0])), trades: [], rand, market, lastPrice: Object.fromEntries(GOODS.map((g) => [g, null])), events: [], weather: { dry: 0, dryFrom: 0, rain: 0 }, stats: [], tally: blankTally(), outbox: null };
	updateMarket(world);
	record(world, 0, {});
	return world;
}

/**
 * The whole world as it stands, to save and open again later (Samuel: every world is kept, and can be played on):
 * every aven (its ledger's newest part), the market (its chart's last weeks), the weather, the clock and where its dice
 * are. The daily stats rows are kept with the run day by day, so they are not in here; nor is anything a brain is in
 * the middle of. Plain JSON.
 */
export function saveWorld(world) {
	const { rand, outbox, events, stats, avens, market, trades, decisions, ...rest } = world;
	return {
		v: 1,
		...JSON.parse(JSON.stringify(rest)),
		rng: rand.at(),
		trades: trades.slice(-100),
		decisions: (decisions ?? []).slice(-100),
		market: Object.fromEntries(GOODS.map((g) => [g, { ...market[g], series: market[g].series.slice(-24 * 21) }])),
		avens: avens.map((a) => {
			const { mind, keep, brain, ledger, ...own } = a;
			return { ...JSON.parse(JSON.stringify(own)), ledger: ledger.slice(-150), brain: { ready: brain.ready, last: brain.last ?? null, asks: brain.asks ?? 0 } };
		})
	};
}

/** a saved world, alive again: its stats rows come from the run's days */
export function loadWorld(saved, stats = []) {
	const { v, rng: at, ...rest } = saved;
	const world = { ...rest, rand: rng(saved.seed, at), events: [], outbox: null, stats };
	for (const a of world.avens) a.brain = { ready: !!a.brain?.ready, pending: false, last: a.brain?.last ?? null, error: null, t0: -Infinity, realAt: -Infinity, asks: a.brain?.asks ?? 0 };
	return world;
}

/** a price in HEARTS, to the cent, never below 1 cent */
export function cents(v) {
	return Math.max(0.01, Math.round(v * 100) / 100);
}

/**
 * The valley's market board, live: for each good, who sells how much at what price and who wants how much at what limit.
 * The market price is discovered, never set (Samuel): the average price actually traded over the last 24 hours, else
 * the last trade's, and none at all before the first trade. Every aven sets its own prices, in HEARTS.
 */
export function updateMarket(world) {
	const live = world.avens.filter((a) => a.alive);
	for (const g of GOODS) {
		const m = world.market[g];
		m.sells = live.filter((a) => a.ask[g] != null && spare(a, g) > 0).map((a) => ({ id: a.id, name: a.name, qty: spare(a, g), price: a.ask[g] })).sort((x, y) => x.price - y.price);
		m.wants = live.filter((a) => a.bid[g] != null && want(a, g) > 0).map((a) => ({ id: a.id, name: a.name, qty: want(a, g), price: a.bid[g] })).sort((x, y) => y.price - x.price);
		m.supply = m.sells.reduce((n, o) => n + o.qty, 0);
		// only what buyers can pay for counts as wanted: an aven with no HEARTS left can't lift the price
		m.demand = m.wants.reduce((n, o) => n + Math.min(o.qty, Math.floor(world.avens[o.id].hearts / Math.max(0.01, o.price))), 0);
		const recent = world.trades.filter((t) => t.good === g && world.t - t.t < DAY_S);
		const units = recent.reduce((n, t) => n + t.qty, 0);
		m.price = units ? cents(recent.reduce((n, t) => n + t.qty * t.price, 0) / units) : world.lastPrice[g];
		if (m.price == null) continue;
		// the price over time, for the chart: one point an hour, the last 120 days
		if (m.series.at(-1)?.t === world.t) m.series.at(-1).price = m.price;
		else m.series.push({ t: world.t, price: m.price });
		if (m.series.length > 24 * 120) m.series.shift();
	}
}

/** one night's harvest of a good, as its grow recipe says: about its capacity ± the swing, now and then a bad (30–60%)
 * or a rich (130–160%) night, and WATER low in a dry spell */
function harvest(world, cap, g, dice) {
	// in a dry spell the wells give far less: every WATER field on 40–70%
	if (g === 'water' && world.weather.dry) return { qty: Math.max(0, Math.round(cap * Math.max(0, RULES.dryWells / 100 - 0.15 + dice[1] * 0.3))), kind: 'dry' };
	let f, kind;
	const swing = RULES.swing / 100;
	if (dice[0] < RULES.badChance / 100) (f = 0.3 + dice[1] * 0.3), (kind = 'bad');
	else if (dice[0] > 1 - RULES.richChance / 100) (f = 1.3 + dice[1] * 0.3), (kind = 'rich');
	else (f = 1 - swing + (dice[1] + dice[2]) * swing), (kind = 'normal');
	return { qty: Math.max(0, Math.round(cap * f)), kind };
}
const dice = (world, n) => Array.from({ length: n }, () => world.rand());

function blankDay() {
	return { sold: Object.fromEntries(GOODS.map((g) => [g, 0])), bought: Object.fromEntries(GOODS.map((g) => [g, 0])), short: {} };
}

/** what this aven still wants of a good it doesn't grow, to reach its reserve: its mind's wants (days of water, days of
 * food, mind.js), else the policy's stock target */
function wantOwn(a, g) {
	if (a.grows.includes(g)) return 0;
	return Math.max(0, NEED[g] * (a.keep?.[g === 'water' ? 'water' : 'food'] ?? a.reserveDays) - a.stock[g]);
}
export function want(a, g) {
	const own = wantOwn(a, g);
	return remembered(`w${a.id}${g}${a.stock[g]}|${a.keep?.water}|${a.keep?.food}|${a.alive}|${Math.floor(a.hearts)}`, () => hooked('want', { aven: a, good: g }, own, 0, 1e6, true));
}

/** what this aven can spare of a good it grows: everything above a few days of its own need */
function spareOwn(a, g) {
	if (!a.grows.includes(g)) return 0;
	return Math.max(0, a.stock[g] - NEED[g] * 2);
}
export function spare(a, g) {
	const own = spareOwn(a, g);
	return remembered(`s${a.id}${g}${a.stock[g]}|${a.alive}|${Math.floor(a.hearts)}`, () => hooked('spare', { aven: a, good: g }, own, 0, a.stock[g], true));
}

function log(world, a, entry) {
	a.ledger.push({ day: world.day, t: world.t, ...entry });
	if (a.ledger.length > 400) a.ledger.splice(0, a.ledger.length - 400);
}

/**
 * The valley's activity feed (Samuel, 2026-10-09: one standard shape for everything that happens, so the page shows a
 * decision, a trial, a death, a dry spell or a world's settings the same way). One entry: { kind, id, name, colour (the
 * aven, none for the valley), source (who decided: d1, qwen, an edit), changes }. `kind` is decision, edit, trial,
 * life, weather or world. Each change is a sentence, or { label, to, from?, unit? }: a value it set, and what it was.
 * Kept in world.decisions (the name it was saved under), newest last.
 */
export function activity(world, entry, a = null) {
	const all = (world.decisions ??= []);
	all.push({ n: (all.at(-1)?.n ?? 0) + 1, day: world.day, t: world.t, ...(a ? { id: a.id, name: a.name, colour: a.colour } : {}), ...entry });
	if (all.length > 400) all.splice(0, all.length - 400);
}
/** a change as card code may write it: a sentence, or { label, to, from?, unit? } (null when it won't do) */
function changeOf(c) {
	if (typeof c === 'string') return c.trim() ? c.trim().slice(0, 200) : null;
	if (!c || typeof c !== 'object' || typeof c.label !== 'string' || !c.label.trim()) return null;
	const val = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : typeof v === 'string' ? v.slice(0, 40) : null);
	if (val(c.to) == null) return null;
	return { label: c.label.trim().slice(0, 80), to: val(c.to), ...(val(c.from) != null ? { from: val(c.from) } : {}), ...(typeof c.unit === 'string' && c.unit ? { unit: c.unit.slice(0, 60) } : {}) };
}
/** the night's news from card code (its `events` hook: a proposal may post events of its own, Samuel 2026-10-09):
 * each { kind, aven? (its name or id), changes (or text), meta? }, at most 20 a night, into the feed */
function news(world) {
	const list = ruled('events', {}, [], (v) => (Array.isArray(v) ? v : []));
	for (const e of list.slice(0, 20)) {
		if (!e || typeof e !== 'object') continue;
		const changes = (Array.isArray(e.changes) ? e.changes : [e.text]).slice(0, 8).map(changeOf).filter(Boolean);
		if (!changes.length) continue;
		const a = world.avens.find((x) => x.name === e.aven || x.id === e.aven) ?? null;
		const meta = e.meta && typeof e.meta === 'object' && JSON.stringify(e.meta).length <= 500 ? e.meta : undefined;
		activity(world, { kind: /^[a-z][a-z0-9_-]{1,30}$/.test(e.kind ?? '') ? e.kind : 'event', source: 'rules', changes, ...(meta ? { meta } : {}) }, a);
	}
}
/** a change of the feed as a line of text (for the database's record, the ledger, the MCP) */
export const changeText = (c) => (typeof c === 'string' ? c : `${c.label} ${c.from != null && c.from !== c.to ? `${c.from}→` : ''}${c.to}${c.unit ? ` ${c.unit}` : ''}`);

/**
 * Haggling: the buyer's limit and the seller's price. If they don't meet, each gives in up to its own flexibility;
 * if the gap closes they settle halfway between what each will still accept, else no deal.
 */
export function haggle(seller, buyer, g) {
	const ask = seller.ask[g],
		bid = buyer.bid[g];
	const floor = ask * (1 - seller.flex),
		ceiling = bid * (1 + buyer.flex);
	const own = ask <= bid ? ask : floor > ceiling ? null : cents((Math.max(floor, bid) + Math.min(ceiling, ask)) / 2);
	// the card's price: null is no deal, a number is the price (to the cent)
	const price = ruled('haggle', { good: g, ask, bid, sellerFlex: seller.flex, buyerFlex: buyer.flex }, own, (v, o) => (v === null ? null : typeof v === 'number' && Number.isFinite(v) && v > 0 ? cents(v) : o));
	return ask <= bid && price === ask ? { price, haggled: false } : { price, ask, bid, haggled: true };
}

/** one deal between a seller and a buyer for a good, at the seller's price or a haggled one; returns the units sold */
function deal(world, seller, buyer, g) {
	const d = haggle(seller, buyer, g);
	if (d.price == null) return 0;
	const price = d.price;
	const qty = Math.min(spare(seller, g), want(buyer, g), Math.floor(buyer.hearts / price));
	if (qty <= 0) return 0;
	const total = Math.round(qty * price * 100) / 100;
	// it is the buyer's from now on; the buyer walks over to fetch it (see step)
	seller.stock[g] -= qty;
	buyer.stock[g] += qty;
	const trip = buyer.fetch.find((f) => f.from === seller.id);
	if (trip) trip.goods[g] = (trip.goods[g] ?? 0) + qty;
	else buyer.fetch.push({ from: seller.id, goods: { [g]: qty } });
	seller.hearts += total;
	buyer.hearts -= total;
	seller.today.sold[g] += qty;
	buyer.today.bought[g] += qty;
	world.lastPrice[g] = price;
	const m = world.market[g];
	m.dayQty = (m.dayQty ?? 0) + qty;
	m.dayValue = (m.dayValue ?? 0) + total;
	const talk = d.haggled ? { haggled: { ask: d.ask, bid: d.bid } } : {};
	log(world, seller, { kind: 'sell', good: g, qty, price, with: buyer.name, hearts: total, ...talk });
	log(world, buyer, { kind: 'buy', good: g, qty, price, with: seller.name, hearts: -total, ...talk });
	world.tally.units[g] += qty;
	world.tally.deals += 1;
	world.trades.push({ day: world.day, t: world.t, seller: seller.id, buyer: buyer.id, good: g, qty, price, haggled: d.haggled });
	if (world.outbox) world.outbox.push({ kind: 'trade', day: world.day, t: world.t, seller: seller.name, buyer: buyer.name, good: g, qty, price, haggled: d.haggled });
	if (world.trades.length > 600) world.trades.splice(0, world.trades.length - 600);
	world.events.push({ kind: 'trade', x: seller.territory.x, y: seller.territory.y, good: g, t: world.t });
	return qty;
}

/**
 * The market clears: for each good, again and again, the `match` hook (the Trading card's code) picks the next seller
 * and buyer to meet, from both books as they stand; the default is the cheapest seller and the buyer who pays most. They
 * strike a deal at the seller's price or a haggled one. A pair that can't agree even after haggling ends the round for
 * that good: nobody further down either book would agree either. A buyer who can't pay for even one unit is passed over.
 */
export function clearMarket(world) {
	const live = world.avens.filter((a) => a.alive && a.brain.ready);
	for (const g of GOODS) {
		const passed = new Set(); // buyers who can't pay for even one unit, this round
		for (let turn = 0; turn < 1000; turn++) {
			const sellers = live.filter((a) => a.ask[g] != null && spare(a, g) > 0);
			const buyers = live.filter((a) => a.bid[g] != null && want(a, g) > 0 && a.hearts >= 0.01 && !passed.has(a.id));
			const pair = matchOf(g, sellers, buyers);
			if (!pair) break;
			const [seller, buyer] = pair;
			if (deal(world, seller, buyer, g)) continue;
			const d = haggle(seller, buyer, g);
			if (d.price == null) {
				// no deal: the price and the limit are too far apart
				log(world, seller, { kind: 'nodeal', good: g, with: buyer.name, ask: d.ask, bid: d.bid });
				log(world, buyer, { kind: 'nodeal', good: g, with: seller.name, ask: d.ask, bid: d.bid });
				break;
			}
			passed.add(buyer.id); // it can't pay for even one: the next buyer
		}
	}
}
/** the next seller and buyer to meet for a good (the `match` hook), or null: the round ends */
function matchOf(g, sellers, buyers) {
	const s = [...sellers].sort((x, y) => x.ask[g] - y.ask[g])[0];
	const b = [...buyers].sort((x, y) => y.bid[g] - x.bid[g]).find((x) => x !== s);
	const own = s && b ? { seller: s.id, buyer: b.id } : null;
	const book = (list, side, qty) => list.map((a) => ({ id: a.id, name: a.name, price: a[side][g], qty: qty(a, g), flex: a.flex, hearts: a.hearts }));
	const pick = ruled('match', { good: g, sellers: book(sellers, 'ask', spare), buyers: book(buyers, 'bid', want) }, own, (v, o) =>
		v === null ? null : v && sellers.some((a) => a.id === v.seller) && buyers.some((a) => a.id === v.buyer) && v.seller !== v.buyer ? { seller: v.seller, buyer: v.buyer } : o
	);
	return pick ? [sellers.find((a) => a.id === pick.seller), buyers.find((a) => a.id === pick.buyer)] : null;
}

/** move the world on by dt in-game seconds (call with small steps); returns true when a new day began */
export function step(world, dt) {
	const before = Math.floor(world.t / DAY_S);
	const hourBefore = Math.floor(world.t / 3600);
	world.t += dt;
	if (Math.floor(world.t / 3600) > hourBefore) updateMarket(world);
	if (Math.floor(world.t / (RULES.clearHours * 3600)) > Math.floor((world.t - dt) / (RULES.clearHours * 3600))) clearMarket(world);
	// the walks: a buyer goes to each seller it bought from, then home with what it fetched
	for (const a of world.avens) {
		if (!a.alive) continue;
		const to = a.fetch.length ? world.avens[a.fetch[0].from] : null;
		const spot = to ? { x: to.territory.x + 18, y: to.territory.y - 6 } : homeSpot(a);
		const d = Math.hypot(spot.x - a.x, spot.y - a.y);
		const move = (RULES.walk / 3600) * (0.5 + a.health / RULES.healthMax / 2) * dt;
		if (d <= Math.max(move, 2)) {
			a.x = spot.x;
			a.y = spot.y;
			if (to) {
				// picked up: it carries the goods home
				for (const [g, q] of Object.entries(a.fetch.shift().goods)) a.carry[g] = (a.carry[g] ?? 0) + q;
			} else a.carry = {};
		} else {
			a.x += ((spot.x - a.x) / d) * move;
			a.y += ((spot.y - a.y) / d) * move;
		}
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
		world.tally.avg[g] = m.dayQty ? Math.round((m.dayValue / m.dayQty) * 10) / 10 : null;
		m.dayQty = m.dayValue = 0;
		if (m.price != null) m.history.push(m.price);
		if (m.history.length > 120) m.history.shift();
		m.open = m.price;
	}
	const recipes = RECIPES();
	const meals = recipes.filter((r) => r.by === 'aven' && r.id !== 'mint');
	const mint = recipes.find((r) => r.id === 'mint');
	seeValley(world);
	memo.clear();
	for (const a of world.avens) {
		if (a.alive) {
			// what it eats and drinks tonight (the need rule), then what that does to its body (the body rule)
			a.need = Object.fromEntries(GOODS.map((g) => [g, hooked('need', { aven: a, good: g }, NEED[g], 0, 1000, true)]));
			const before = { ...a.body };
			const ate = {},
				short = {};
			for (const r of meals) {
				const { took, missing } = craft({ ...r, in: Object.fromEntries(Object.keys(r.in).map((g) => [g, a.need[g]])) }, a);
				Object.assign(ate, took);
				Object.assign(short, missing);
			}
			// the body rule's answer: the two reserves, and, if the card keeps its own, health and a memo it gets back
			// tomorrow night (a streak, say); without its own health, health is the lower reserve on the health scale
			const body = ruled('body', { aven: { ...a, body: before }, need: a.need, short }, { ...a.body }, (v, own) =>
				v && typeof v === 'object' && Number.isFinite(v.water) && Number.isFinite(v.food)
					? {
							water: Math.min(100, Math.max(0, v.water)),
							food: Math.min(100, Math.max(0, v.food)),
							...(Number.isFinite(v.health) ? { health: Math.min(RULES.healthMax, Math.max(0, v.health)) } : {}),
							...(v.memo && typeof v.memo === 'object' && JSON.stringify(v.memo).length <= 2000 ? { memo: v.memo } : {})
						}
					: own
			);
			const { health, memo, ...reserves } = body;
			a.body = reserves;
			if (memo) a.memo = memo;
			a.health = health ?? Math.round((Math.min(a.body.water, a.body.food) * RULES.healthMax) / 100);
			log(world, a, { kind: 'eat', short, health: a.health });
			a.today.short = short;
			a.today.ate = ate;
		}
		// each resource's own decay: what's left in store rots, every balance of HEARTS melts a little (card code may say
		// otherwise: a decay hook for HEARTS, a rot hook for each good, never more than is there)
		const lost = decayAll(a, world.rand, (r, held, v, roll) => (r.id === 'HEARTS' ? hooked('decay', { aven: a }, v, 0, held) : r.held === 'store' ? hooked('rot', { aven: a, good: r.id, dice: [roll] }, v, 0, held, true) : v));
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
		if (a.alive && (a.health <= 0 || a.body.water <= 0 || a.body.food <= 0)) {
			// it dies and loses everything it held (Samuel): its HEARTS and its store go with it
			a.alive = false;
			a.diedOn = world.day;
			a.lost = { hearts: Math.round(a.hearts * 100) / 100, stock: { ...a.stock }, cause: a.body.water <= 0 ? 'thirst' : a.body.food <= 0 ? 'hunger' : 'ill health' };
			a.hearts = 0;
			for (const g of GOODS) a.stock[g] = 0;
			a.fetch = [];
			a.carry = {};
			log(world, a, { kind: 'death', cause: a.lost.cause, lost: a.lost.hearts });
			activity(world, { kind: 'life', changes: [`died of ${a.lost.cause}`, { label: 'lost', to: Math.round(a.lost.hearts), unit: 'HEARTS and all it held' }] }, a);
		}
		if (a.alive) {
			const out = hooked('mint', { aven: a }, mint.out.HEARTS, 0, 1e6);
			craft(out === mint.out.HEARTS ? mint : { ...mint, out: { HEARTS: out } }, a);
			a.minted += out;
			world.tally.minted += out;
		}
		a.hearts = Math.round(a.hearts * 100) / 100;
	}
	world.day += 1;
	// the dead come back after a while (Samuel: 7 days; the rebirth rule), on their own land, fresh: the starting
	// HEARTS, nothing in store
	for (const a of world.avens) {
		if (a.alive || a.diedOn == null) continue;
		const dead = world.day - a.diedOn;
		const hearts = hooked('rebirth', { aven: a, dead }, dead >= RULES.rebirthDays ? RULES.startHearts : -1, -1, 1e9);
		if (hearts < 0) continue;
		Object.assign(a, { alive: true, diedOn: null, hearts, health: RULES.healthMax, body: { water: 100, food: 100 }, memo: {}, reborn: (a.reborn ?? 0) + 1, startHearts: hearts });
		for (const g of GOODS) a.stock[g] = 0;
		a.x = a.territory.x;
		a.y = a.territory.y - 6;
		log(world, a, { kind: 'reborn', hearts });
		activity(world, { kind: 'life', changes: [{ label: 'reborn with', to: Math.round(hearts), unit: 'HEARTS' }] }, a);
	}
	const wasDry = world.weather.dry > 0;
	weather(world);
	if (!wasDry && world.weather.dry > 0) activity(world, { kind: 'weather', changes: [{ label: 'dry spell for', to: world.weather.dry, unit: `days: wells give about ${RULES.dryWells}%, no rain` }] });
	else if (wasDry && !world.weather.dry) activity(world, { kind: 'weather', changes: ['the dry spell is over'] });
	news(world);
	seeValley(world);
	for (const a of world.avens) {
		a.yesterday = a.today;
		a.today = blankDay();
		if (!a.alive) continue;
		for (const g of a.grows) {
			const roll = dice(world, 3);
			const own = harvest(world, a.produce[g], g, roll);
			const top = Math.max(100, a.produce[g] * 10);
			const grown = ruled('harvest', { aven: a, good: g, capacity: a.produce[g], dice: roll }, own, (v, o) =>
				typeof v === 'number' && Number.isFinite(v) ? { qty: Math.min(top, Math.max(0, Math.round(v))), kind: o.kind } : v && Number.isFinite(v.qty) ? { qty: Math.min(top, Math.max(0, Math.round(v.qty))), kind: ['normal', 'bad', 'rich', 'dry'].includes(v.kind) ? v.kind : 'normal' } : o
			);
			const qty = grown.qty;
			const kind = grown.kind;
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
	const roll = dice(world, 4);
	const w = { ...world.weather };
	if (w.dry) w.dry -= 1;
	else if (roll[0] < RULES.dryChance / 100) {
		const lo = Math.min(RULES.dryMin, RULES.dryMax);
		w.dry = lo + Math.floor(roll[1] * (Math.max(RULES.dryMin, RULES.dryMax) - lo + 1));
		w.dryFrom = world.day;
	}
	w.rain = !w.dry && RULES.rainMax > 0 && roll[2] < RULES.rainChance / 100 ? 1 + Math.floor(roll[3] * RULES.rainMax) : 0;
	const whole = (x, hi) => Math.min(hi, Math.max(0, Math.round(Number(x) || 0)));
	world.weather = ruled('weather', { weather: { ...world.weather }, day: world.day, dice: roll }, w, (v, own) =>
		v && typeof v === 'object' ? { dry: whole(v.dry, 365), dryFrom: Number.isFinite(v.dryFrom) ? v.dryFrom : own.dryFrom, rain: whole(v.rain, 100) } : own
	);
}

/** the board: the living by HEARTS, then the dead by how long they lasted @returns {any[]} */
export function ranking(world) {
	return [...world.avens].sort((a, b) => (a.alive !== b.alive ? (a.alive ? -1 : 1) : a.alive ? b.hearts - a.hearts : (b.diedOn ?? 0) - (a.diedOn ?? 0)));
}
