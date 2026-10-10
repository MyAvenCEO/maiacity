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

// ─────────────── fields (Samuel, 2026-10-10: every aven an entrepreneur) ───────────────
// Where the Fields card turns them on (fieldsOn), an aven's land is up to three fields it farms itself: each one crop at
// level 1 to 3 (each crop its own capacity at level 1; level 2 and 3 yield level2% and level3% of it), which it can level
// up (CAPEX) and keeps paying for each night (OPEX), both paid to the MaiaCity COOP; a crop planted or changed starts
// again at level 1 and grows into its yield over its own ramp_<crop> days, a level-up over levelDays. What it grows is
// then its own decision, made by its brain (asks.js).
export const fieldsOn = () => RULES.fieldsOn >= 1;
/** what levelling a field of `g` up to `level` costs, once (the Fields card's capex rule) */
export const capexOf = (g, level) => hooked('capex', { good: g, level }, RULES[`capex${level}_${g}`] ?? 0, 0, 1e9);
/** what a field of `g` at `level` costs a night (the Fields card's opex rule) */
export const opexOf = (g, level) => hooked('opex', { good: g, level }, RULES[`opex${level}_${g}`] ?? 0, 0, 1e9);
/** what opening field number `slot` (0, 1, 2) costs */
/** what opening field number `slot` (0, 1, 2) with crop `g` costs an aven: the field's price (field1-3), made dearer or
 * cheaper by its crop (as levelling that crop up is, against the vegetables' 300) and by its own plot, dealt when the
 * world was made (plotSpread: ± a few % each; Samuel, 2026-10-10: not every field costs the same) */
export const openCost = (slot, g = null, a = null) => {
	const base = slot === 0 ? RULES.field1 : slot === 1 ? RULES.field2 : slot === 2 ? RULES.field3 : 0;
	const crop = g ? (RULES[`capex2_${g}`] ?? 300) / 300 : 1;
	const plot = a?.plots?.[slot] ?? 1;
	return Math.round((base * crop * plot) / 10) * 10;
};
/** a crop's field capacity at level 1 */
export const fieldBase = (g) => RULES[`cap_${g}`] ?? 0;
/** a field's yield at a level, as a share of level 1 */
export const levelShare = (level) => (level === 1 ? 1 : level === 2 ? RULES.level2 / 100 : level === 3 ? RULES.level3 / 100 : 0);
/** how long a crop takes to grow into its yield */
export const rampOf = (g) => RULES[`ramp_${g}`] ?? 7;
/** how far a field has grown into its yield, 0 to 1 */
export const fieldGrown = (world, f) => (rampOf(f.crop) > 0 ? Math.min(1, Math.max(0, (world.day - f.since) / rampOf(f.crop))) : 1);
/** a field's yield a day today, before the night's luck: its level's share of the crop's capacity, as far as grown */
export function fieldYield(world, f) {
	const was = f.from ?? f.level;
	const up = RULES.levelDays > 0 && f.from != null ? Math.min(1, Math.max(0, (world.day - f.levelSince) / RULES.levelDays)) : 1;
	return fieldBase(f.crop) * (levelShare(was) + (levelShare(f.level) - levelShare(was)) * up) * fieldGrown(world, f);
}
/**
 * The MaiaCity COOP (Samuel, 2026-10-10): the valley's own ledger, where every HEART paid for fields lands (opening a
 * field, levelling one up, each night's keep). For now money only flows in.
 */
export function coopTake(world, a, n, what) {
	if (!(n > 0)) return;
	const c = (world.coop ??= { hearts: 0, from: {} });
	c.hearts = Math.round((c.hearts + n) * 100) / 100;
	c.from[what] = Math.round(((c.from[what] ?? 0) + n) * 100) / 100;
	a.hearts = Math.round((a.hearts - n) * 100) / 100;
}
/** the COOP's place in a fields valley, and how big it is */
export const COOP_SPOT = { x: 600, y: 410, r: 96 };
/** how far from the COOP the valley's edge lies, along a direction */
export function edgeAlong(ang) {
	const dx = Math.cos(ang),
		dy = Math.sin(ang);
	const t = [dx > 0 ? (WORLD.w - COOP_SPOT.x) / dx : dx < 0 ? -COOP_SPOT.x / dx : Infinity, dy > 0 ? (WORLD.h - COOP_SPOT.y) / dy : dy < 0 ? -COOP_SPOT.y / dy : Infinity];
	return Math.min(...t);
}
/** where aven i of n lives in a fields valley: in the middle of its wedge, a little past half way to the edge */
export function wedgeHome(i, n) {
	const ang = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2;
	const d = COOP_SPOT.r + (edgeAlong(ang) - COOP_SPOT.r) * 0.58;
	return { x: COOP_SPOT.x + Math.cos(ang) * d, y: COOP_SPOT.y + Math.sin(ang) * d, ang };
}
/** what an aven grows follows its fields; what it grows a day, as far as they have grown */
export function syncFields(world, a) {
	a.grows = GOODS.filter((g) => a.fields.some((f) => f.crop === g));
	a.produce = Object.fromEntries(a.grows.map((g) => [g, Math.round(a.fields.filter((f) => f.crop === g).reduce((n, f) => n + fieldYield(world, f), 0) * 10) / 10]));
	for (const g of GOODS) {
		if (a.grows.includes(g) && !(g in a.ask)) a.ask[g] = null;
		if (!a.grows.includes(g) && !(g in a.bid)) a.bid[g] = null;
	}
}
/** the night's harvest of an aven's own fields: each paid for tonight (else it lies fallow), each on its own luck */
function harvestFields(world, a) {
	a.harvest = Object.fromEntries(GOODS.map((g) => [g, 0]));
	for (const f of a.fields) {
		const cost = opexOf(f.crop, f.level);
		if (cost > a.hearts) {
			log(world, a, { kind: 'grow', good: f.crop, qty: 0, cap: 0, note: 'fallow: it could not pay for its field' });
			continue;
		}
		coopTake(world, a, cost, 'nights');
		a.opex = (a.opex ?? 0) + cost;
		world.tally.opex = (world.tally.opex ?? 0) + cost;
		const cap = fieldYield(world, f);
		const roll = dice(world, 3);
		const own = harvest(world, cap, f.crop, roll);
		const top = Math.max(100, cap * 10);
		const grown = ruled('harvest', { aven: a, good: f.crop, capacity: cap, dice: roll }, own, (v, o) =>
			typeof v === 'number' && Number.isFinite(v) ? { qty: Math.min(top, Math.max(0, Math.round(v))), kind: o.kind } : v && Number.isFinite(v.qty) ? { qty: Math.min(top, Math.max(0, Math.round(v.qty))), kind: ['normal', 'bad', 'rich', 'dry'].includes(v.kind) ? v.kind : 'normal' } : o
		);
		a.harvest[f.crop] += grown.qty;
		a.stock[f.crop] += grown.qty;
		if (grown.kind !== 'normal') log(world, a, { kind: 'grow', good: f.crop, qty: grown.qty, cap: Math.round(cap), note: grown.kind });
	}
	syncFields(world, a);
}
/**
 * One decision about a field: slot 0-2, code 0 = keep (or leave unopened), 1 = level up, 2 + i = plant GOODS[i] (on an
 * open field: change its crop, back to level 1; on the next unopened one: open it). Paid for at once, burned. Returns
 * the change in the feed's words, or a sentence why it couldn't, or null for no change.
 */
export function invest(world, a, slot, code) {
	if (!fieldsOn() || !a.alive || !a.fields || !Number.isInteger(code) || code <= 0) return null;
	const f = a.fields[slot];
	const pay = (n, what) => {
		coopTake(world, a, n, what);
		a.invested = (a.invested ?? 0) + n;
		world.tally.invested = (world.tally.invested ?? 0) + n;
	};
	// what it keeps for food (fieldReserve days of what it buys, at today's prices): no field may eat into it
	const reserve = (RULES.fieldReserve ?? 0) * GOODS.filter((g) => !a.grows.includes(g)).reduce((n, g) => n + NEED[g] * (world.market[g].posted ?? world.market[g].price ?? RULES.mint / 11), 0);
	const can = (cost) => a.hearts - cost >= reserve;
	let change;
	if (!f) {
		const g = GOODS[code - 2];
		if (!g || slot !== a.fields.length) return null;
		const cost = openCost(slot, g, a);
		if (!can(cost)) return `couldn't open field ${slot + 1} (${cost} HEARTS, keeping ${Math.round(reserve)} for food)`;
		pay(cost, 'fields');
		a.fields.push({ crop: g, level: 1, since: world.day, from: null, levelSince: null });
		change = { label: `opens field ${slot + 1} with`, to: GOOD_LABEL[g], unit: `for ${cost} HEARTS to the MaiaCity COOP` };
	} else if (code === 1) {
		if (f.level >= 3) return null;
		const cost = capexOf(f.crop, f.level + 1);
		if (!can(cost)) return `couldn't level up its ${GOOD_LABEL[f.crop]} field (${cost} HEARTS, keeping ${Math.round(reserve)} for food)`;
		pay(cost, 'levels');
		Object.assign(f, { from: f.level, level: f.level + 1, levelSince: world.day });
		change = { label: `levels up its ${GOOD_LABEL[f.crop]} field`, from: f.level - 1, to: f.level, unit: `for ${cost} HEARTS to the MaiaCity COOP` };
	} else {
		const g = GOODS[code - 2];
		if (!g || g === f.crop) return null;
		if (world.day - f.since < (RULES.holdDays ?? 0)) return `couldn't change field ${slot + 1} yet (from day ${f.since + RULES.holdDays})`;
		change = { label: `changes field ${slot + 1}`, from: GOOD_LABEL[f.crop], to: GOOD_LABEL[g], unit: 'back to level 1' };
		Object.assign(f, { crop: g, level: 1, since: world.day, from: null, levelSince: null });
	}
	syncFields(world, a);
	log(world, a, { kind: 'field', slot, ...change });
	return change;
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
	// own fields: every aven starts with one, its land's first crop at level 1, grown; and its starting rations
	if (fieldsOn()) {
		// no fields to start with (Samuel, 2026-10-10): each aven opens its first itself, choosing its crop; until its
		// fields grow it lives on its starting rations and the market
		avens.forEach((a) => {
			// its three plots, each dealt its own price (± plotSpread %)
			a.plots = [0, 1, 2].map(() => Math.round((1 + ((rand() * 2 - 1) * RULES.plotSpread) / 100) * 100) / 100);
			a.fields = [];
			a.ask = {};
			a.bid = Object.fromEntries(GOODS.map((g) => [g, null]));
			syncFields({ day: 1 }, a);
			a.harvest = Object.fromEntries(GOODS.map((g) => [g, 0]));
			a.stock = Object.fromEntries(GOODS.map((g) => [g, NEED[g] * RULES.startDays]));
		});
		// the valley around the MaiaCity COOP (Samuel's sketch, 2026-10-10): the COOP in the middle, the land cut into one
		// wedge per aven from it out to the valley's edge, each aven's home in its wedge with its fields around it
		avens.forEach((a, i) => {
			const home = wedgeHome(i, avens.length);
			Object.assign(a, { home, territory: { x: home.x, y: home.y, r: 70 }, x: home.x, y: home.y - 6 });
		});
	}
	const world = { seed, startHearts: RULES.startHearts, t: 0, day: 1, avens, coop: { hearts: 0, from: {} }, layout: fieldsOn() ? 'coop' : 'ring', rotted: Object.fromEntries(GOODS.map((g) => [g, 0])), trades: [], rand, market, lastPrice: Object.fromEntries(GOODS.map((g) => [g, null])), events: [], weather: { dry: 0, dryFrom: 0, rain: 0 }, stats: [], tally: blankTally(), outbox: null };
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
	const isPosted = postedMarket();
	for (const g of GOODS) {
		const m = world.market[g];
		// a posted-price market: everyone's offer and want stand at the good's one posted price
		m.posted = isPosted ? (world.posted?.[g] ?? null) : null;
		const at = (a, side) => (isPosted ? m.posted : a[side][g]);
		const priced = (a, side) => (isPosted ? a.brain.ready : a[side][g] != null);
		m.sells = live.filter((a) => priced(a, 'ask') && spare(a, g) > 0).map((a) => ({ id: a.id, name: a.name, qty: spare(a, g), price: at(a, 'ask') })).sort((x, y) => x.price - y.price);
		m.wants = live.filter((a) => priced(a, 'bid') && want(a, g) > 0).map((a) => ({ id: a.id, name: a.name, qty: want(a, g), price: at(a, 'bid') })).sort((x, y) => y.price - x.price);
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
	const qty = Math.min(spare(seller, g), want(buyer, g), Math.floor(buyer.hearts / d.price));
	if (qty <= 0) return 0;
	return transfer(world, seller, buyer, g, qty, d.price, d.haggled ? { ask: d.ask, bid: d.bid } : null);
}
/** the goods and HEARTS of one deal change hands (the buyer walks over to fetch what it bought, see step); returns the
 * units sold */
function transfer(world, seller, buyer, g, qty, price, haggled) {
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
	const talk = haggled ? { haggled } : {};
	log(world, seller, { kind: 'sell', good: g, qty, price, with: buyer.name, hearts: total, ...talk });
	log(world, buyer, { kind: 'buy', good: g, qty, price, with: seller.name, hearts: -total, ...talk });
	world.tally.units[g] += qty;
	world.tally.deals += 1;
	world.trades.push({ day: world.day, t: world.t, seller: seller.id, buyer: buyer.id, good: g, qty, price, haggled: !!haggled });
	if (world.outbox) world.outbox.push({ kind: 'trade', day: world.day, t: world.t, seller: seller.name, buyer: buyer.name, good: g, qty, price, haggled: !!haggled });
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
	if (postedMarket()) return clearPosted(world);
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
/** a posted-price market: where the Trading card exports a `price` hook (Samuel, 2026-10-10). Nobody names a price:
 * each good has one posted price, everyone trades at it, and the card moves it between rounds by what was wanted and
 * offered at it (tâtonnement; LLM brains that name prices anchor on each other and freeze the market, World 15) */
export const postedMarket = () => !!(CODE.run && CODE.seen === CODE.run && CODE.run.has('price'));
/** a positive price, kept to 4 significant digits (no floor and no ceiling beyond that) */
const posted = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Number(Math.min(1e9, Math.max(1e-4, v)).toPrecision(4)) : null);
/** shares of `total` in proportion to `asks` (whole units, the largest remainders first, ties to the earlier one) */
function shares(asks, total) {
	const sum = asks.reduce((n, q) => n + q, 0);
	if (sum <= total) return asks.slice();
	const exact = asks.map((q) => (q * total) / sum);
	const out = exact.map(Math.floor);
	let left = total - out.reduce((n, q) => n + q, 0);
	for (const i of exact.map((x, i) => [x - Math.floor(x), i]).sort((x, y) => y[0] - x[0]).map(([, i]) => i)) {
		if (left <= 0) break;
		if (out[i] < asks[i]) (out[i] += 1), (left -= 1);
	}
	return out;
}
/**
 * The posted-price market clears, good by good: at the good's posted price every seller offers what it can spare and
 * every buyer asks for what it wants and can pay for (both by the Trading card's want and spare, which may read the
 * brain's own answers in aven.choices). The short side gets all it asked for; on the long side what buyers need to live
 * through tomorrow is filled first, then the stock they keep beyond it, each pro rata; the goods change hands at that
 * one price. Then the `price` hook sets the next round's price from what was wanted and
 * offered (a good never priced yet asks it with price null for a first one).
 */
function clearPosted(world) {
	const live = world.avens.filter((a) => a.alive && a.brain.ready);
	world.posted ??= {};
	// the day's opening round: the first after the night's harvest, when the whole day's supply is on offer and nothing
	// of it traded yet (later rounds see only what is left: a daily flow measured by the hour)
	const opening = world.postedDay !== world.day;
	world.postedDay = world.day;
	for (const g of GOODS) {
		// every good's posted price as the round began, so a card can see the whole price level (a basket's cost), not one
		const all = { ...world.posted };
		const ask = (price, round) => posted(ruled('price', { good: g, price, opening, prices: all, ...round }, price, (v, o) => posted(v) ?? o));
		// a good's first price: the card's, given what the world it follows last asked for it (inherited), if any
		let p = posted(world.posted[g]) ?? ask(null, { demand: 0, need: 0, supply: 0, traded: 0, inherited: world.inherited?.[g] ?? null, previous: world.inherited ?? null });
		if (p == null) continue;
		const sellers = live.filter((a) => spare(a, g) > 0);
		const buyers = live.filter((a) => want(a, g) > 0 && a.hearts >= p);
		const offer = sellers.map((a) => spare(a, g));
		const asked = buyers.map((a) => Math.min(want(a, g), Math.floor(a.hearts / p)));
		// of what each asks, the part it needs to live through tomorrow: that part is filled first, the rest (stock it
		// keeps beyond tomorrow) from what is left, each pro rata
		const needed = buyers.map((a, k) => Math.min(asked[k], Math.max(0, (a.need?.[g] ?? NEED[g]) - a.stock[g])));
		const supply = offer.reduce((n, q) => n + q, 0);
		const demand = asked.reduce((n, q) => n + q, 0);
		const need = needed.reduce((n, q) => n + q, 0);
		const traded = Math.min(supply, demand);
		const sell = shares(offer, traded);
		const first = shares(needed, Math.min(need, traded));
		const rest = shares(asked.map((q, k) => q - first[k]), traded - first.reduce((n, q) => n + q, 0));
		const buy = first.map((q, k) => q + rest[k]);
		// pair them off in order: each buyer fetches its units from the sellers in turn
		for (let i = 0, j = 0; i < sellers.length && j < buyers.length; ) {
			const q = Math.min(sell[i], buy[j]);
			if (q > 0) transfer(world, sellers[i], buyers[j], g, q, p, null);
			sell[i] -= q;
			buy[j] -= q;
			if (!sell[i]) i++;
			if (!buy[j]) j++;
		}
		const round = { demand, need, supply, traded };
		world.market[g].round = { price: p, ...round };
		world.posted[g] = ask(p, round) ?? p;
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
			const was = a.health;
			a.health = health ?? Math.round((Math.min(a.body.water, a.body.food) * RULES.healthMax) / 100);
			// its health fell: its brain decides again first thing, not when its turn comes (Samuel, 2026-10-09)
			if (a.health < was) a.urgent = true;
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
	// the MaiaCity COOP pays its members (coopShare % of its balance, in equal shares to the living)
	const live = world.avens.filter((a) => a.alive);
	if (world.coop && RULES.coopShare > 0 && live.length) {
		const each = Math.floor((world.coop.hearts * RULES.coopShare) / 100 / live.length * 100) / 100;
		if (each > 0) {
			for (const a of live) a.hearts = Math.round((a.hearts + each) * 100) / 100;
			world.coop.hearts = Math.round((world.coop.hearts - each * live.length) * 100) / 100;
			world.coop.paid = Math.round(((world.coop.paid ?? 0) + each * live.length) * 100) / 100;
		}
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
		// a clean start (Samuel, 2026-10-09): no prices from its last life (in World 14 a reborn aven's old limits held it
		// far below the market for days), and its brain decides them first thing
		for (const g of GOODS) (a.grows.includes(g) ? a.ask : a.bid)[g] = null;
		for (const g of GOODS) a.stock[g] = 0;
		a.dayStart = null;
		a.urgent = true;
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
		if (fieldsOn() && a.fields) harvestFields(world, a);
		else
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
