// @ts-nocheck — plain JS game state, kept loose on purpose
// What each aven's brain sees and is asked, and how its answers become prices (Samuel, 2026-10-09: the brains are card
// code too). It is the Brains card's code (game/economy/rules-code.js, its default), run in the QuickJS sandbox like
// every other rule: `see` builds the state a brain decides on, `ask` its typed questions (with the price levels each
// score is read against), `prompt` what Qwen is told, `score` how a day counts in its trials. The engine keeps the same
// logic natively below, only as the fallback for a hook that fails or a page where QuickJS can't load;
// scripts/sandbox-8-rules.mjs checks the two agree. Transport (Liquid, the GPU box) stays in brain.js.

import { GOODS, GOOD_LABEL, NEED, ROT, want, spare, cents, brainRule } from './economy.js';
import { RULES } from './rules.js';
import { mindFor, inCharacter, mindQuestions, applyMind } from './mind.js';

/** no starting prices (Samuel: they discover them). An aven's first price for a good is any of these, in HEARTS a
 * unit; after that it moves its own price, from half to twice what it was when the day began, as often as it likes. The
 * levels hang on the day's first price, not the last answer: an aven asking many times a day (Qwen answers in seconds)
 * would otherwise compound its moves and run a price up a hundredfold in a morning. A score falls between levels, so any
 * price in between is possible. Liquid takes at most 10 levels a score question (more is a 422). */
const FIRST = [0.5, 1, 2, 4, 8, 15, 30, 60, 120, 250];
const MOVES = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.3, 1.6, 2];
const needOf = (a, g) => a.need?.[g] ?? NEED[g];
/** the most an aven can pay a unit and still buy one day's need: no bid above what its HEARTS cover */
const afford = (a, g) => cents(Math.max(0.01, a.hearts) / Math.max(1, needOf(a, g)));
/** what a price is anchored on today: the aven's own price as the day began (else the market's), and for a buyer the
 * most it can pay. The anchor is the engine's (it remembers it through the day); the levels around it are the card's */
function anchorOf(world, a, g, side) {
	const book = side === 'ask' ? a.ask : a.bid;
	const day = (a.dayStart ??= { day: -1, ask: {}, bid: {} });
	if (day.day !== world.day) Object.assign(day, { day: world.day, ask: { ...a.ask }, bid: { ...a.bid } });
	const mine = (day[side][g] ??= book[g]) ?? null; // a first price named today is the day's anchor from then on
	return { side, mine, market: world.market[g].price, afford: side === 'bid' ? afford(a, g) : null };
}
/** the price levels for one good, in HEARTS: around the aven's price as the day began, else the market's, else from
 * scratch; a buyer's never above what it can afford */
function priceLevels({ mine, market, afford: top }) {
	const base = mine ?? market;
	const cap = (p) => cents(top == null ? p : Math.min(p, top));
	if (base == null) {
		const levels = FIRST.map(cap);
		return { levels, criteria: levels.map((p, i) => `${p} HEARTS a unit${top != null && FIRST[i] > top ? ' (all my HEARTS can pay)' : ''}`) };
	}
	const levels = MOVES.map((f) => cap(base * f));
	const what = mine != null ? 'my price this morning' : 'the market price';
	return { levels, criteria: MOVES.map((f, i) => `${levels[i]} HEARTS a unit (${levels[i] === top && base * f > top ? 'all my HEARTS can pay' : f === 1 ? `keep ${what}` : `${f}× ${what}`})`) };
}
/** how soon an aven dies without a good: water first, food far later */
const deadline = (a, g) =>
	g === 'water'
		? `Without water you die: your water reserve is ${Math.round(a.body.water)} of 100 and with none at all you last ${RULES.waterDays} days, so water is your most urgent need.`
		: `Your food reserve is ${Math.round(a.body.food)} of 100; with no food at all you still last ${RULES.foodDays} days, so food is far less urgent than water.`;
/** how far to give in when haggling */
const flexes = () => [0, 0.1, 0.25, 0.5, 1].map((f) => Math.round(f * RULES.haggleMax) / 100);
const gives = () => flexes().map((f, i) => (i ? `Give in up to ${Math.round(f * 100)}%` : 'Never give in'));

/** a score of 0 to levels-1 (may fall between levels) to a value between them; prices in between are geometric */
function factorOf(score, levels, geometric = false) {
	const n = levels.length - 1;
	const s = Math.max(0, Math.min(n, score));
	const i = Math.min(n - 1, Math.floor(s));
	return geometric ? levels[i] * (levels[i + 1] / levels[i]) ** (s - i) : levels[i] + (levels[i + 1] - levels[i]) * (s - i);
}

/** how many days of market history an aven sees: a week keeps each ask small (Liquid's free model limits tokens) */
const HISTORY_DAYS = 7;

/** the market as card code sees it: per good, the price, what is offered and wanted, and by whom */
const marketOf = (world) =>
	Object.fromEntries(
		GOODS.map((g) => {
			const m = world.market[g];
			return [g, { price: m.price, supply: m.supply, demand: m.demand, sells: m.sells.map((o) => ({ name: o.name, qty: o.qty, price: o.price })), wants: m.wants.map((o) => ({ name: o.name, qty: o.qty, price: o.price })) }];
		})
	);

/** the live market board as an aven sees it: per good, the price, how much is offered and wanted, and by whom */
export function boardFor(world) {
	const days = world.stats.slice(-HISTORY_DAYS);
	return boardOwn(marketOf(world), days);
}
function boardOwn(market, days) {
	return Object.fromEntries(
		GOODS.map((g) => {
			const m = market[g];
			// the last week: the market price each evening and the average actually traded each day
			return [
				g,
				{
					market_price: m.price,
					market_price_last_7_days: days.map((r) => r.price[g]),
					average_traded_last_7_days: days.map((r) => r.avg[g]),
					units_traded_last_7_days: days.map((r) => r.units[g]),
					offered_now: m.supply,
					wanted_now: m.demand,
					sellers_asking: m.sells.map((o) => `${o.name}: ${o.qty} at ${o.price}`),
					buyers_offering: m.wants.map((o) => `${o.name}: ${o.qty} up to ${o.price}`)
				}
			];
		})
	);
}

const plain = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** the state an aven decides on: its own books and what it can see of the valley — nothing else (the `see` hook) */
export function stateFor(world, a) {
	const own = stateOwn(world, a);
	return brainRule('see', seeArgs(world, a), own, (v) => (plain(v) && JSON.stringify(v).length <= 60000 ? v : own));
}
/** what the `see` hook is given, besides `valley` */
function seeArgs(world, a) {
	return {
		aven: a,
		day: world.day,
		weather: world.weather,
		market: marketOf(world),
		history: world.stats.slice(-HISTORY_DAYS).map((r) => ({ price: r.price, avg: r.avg, units: r.units })),
		others: world.avens.filter((o) => o !== a).map((o) => ({ name: o.name, alive: o.alive, hearts: o.hearts, grows: o.grows, ask: o.ask })),
		brain: mindFor(a) ?? null
	};
}
function stateOwn(world, a) {
	const y = a.yesterday;
	return {
		game: `${world.avens.length} avens trade food and water for HEARTS. Each needs ${NEED.water} WATER and ${NEED.fruits} each of FRUITS, VEGETABLES, LEGUMES and CHICKEN every day. With no water at all an aven lives through ${RULES.waterDays} days; with no food at all it lives ${RULES.foodDays} days, so water is by far the most urgent need and a day short of food is no emergency. Supply is only just above need, so shortages are common. Every aven mints ${RULES.mint} HEARTS a day and every HEART decays ${RULES.decay}% a year, so hoarded HEARTS shrink. There are no set prices: every aven names its own in HEARTS. Every ${RULES.clearHours} hour${RULES.clearHours === 1 ? '' : 's'} the market matches each good's cheapest seller with the buyer who pays most, while the seller's price is within the buyer's limit (or close enough to haggle). The market price is just the average actually traded over the last day. Goal: survive and end with the most HEARTS.`,
		day: world.day,
		me: a.name,
		hearts: a.hearts,
		health: a.health,
		body_reserves: { water: Math.round(a.body.water), food: Math.round(a.body.food) },
		i_grow_per_day_on_average: a.produce,
		my_harvest_last_night: a.harvest,
		harvests_vary: `about ±${RULES.swing}% a night; ${RULES.badChance}% of nights a bad harvest (30–60%), ${RULES.richChance}% a rich one`,
		// what it takes to stay alive: how long it lasts on its own stock, and what a day's missing needs cost at the market
		survival: survivalFor(world, a),
		share_that_rots_each_night: ROT,
		water: world.weather.dry ? `dry spell for ${world.weather.dry} more nights: wells give only about ${RULES.dryWells}%, no rain` : `normal; ${RULES.dryChance}% of nights a dry spell of ${RULES.dryMin}–${RULES.dryMax} days starts and wells give only about ${RULES.dryWells}%`,
		rain_barrel: `${RULES.rainChance}% of nights it rains and my barrel catches 1–${RULES.rainMax} WATER (never in a dry spell)`,
		stock: a.stock,
		need_per_day: NEED,
		days_of_stock_wanted: a.keep ? { water: a.keep.water, food: a.keep.food } : a.reserveDays,
		my_asking_prices: a.ask,
		my_buying_limits: a.bid,
		how_far_i_give_in_haggling: a.flex,
		yesterday: y ? { sold: y.sold, bought: y.bought, went_short_of: y.short, rotted: y.rotted ?? {} } : null,
		market: boardFor(world),
		others: world.avens
			.filter((o) => o !== a)
			.map((o) => ({ name: o.name, alive: o.alive, hearts: o.hearts, grows: o.grows, asking: o.alive ? o.ask : null })),
		// who it is and what it learned, in this world: its brain (mind.js): character, wants, trials, lessons, deaths
		my_brain: mindFor(a)
	};
}

/** how long an aven lasts on what it holds, per good, and what buying a day's missing needs would cost today */
function survivalFor(world, a) {
	const days = Object.fromEntries(GOODS.map((g) => [g, needOf(a, g) ? Math.floor(a.stock[g] / needOf(a, g)) : null]));
	const buys = GOODS.filter((g) => !a.grows.includes(g));
	const priced = buys.every((g) => world.market[g].price != null);
	const cost = priced ? buys.reduce((n, g) => n + needOf(a, g) * world.market[g].price, 0) : 0;
	return {
		days_my_stock_lasts: days,
		short_tonight_unless_i_buy: Object.fromEntries(GOODS.filter((g) => a.stock[g] < needOf(a, g)).map((g) => [g, needOf(a, g) - a.stock[g]])),
		water_reserve: `${Math.round(a.body.water)} of 100; at 0 I die. With no water at all I last ${RULES.waterDays} days`,
		food_reserve: `${Math.round(a.body.food)} of 100; at 0 I die. With no food at all I last ${RULES.foodDays} days`,
		cost_of_one_day_of_what_i_must_buy_at_market_price: priced ? Math.round(cost * 100) / 100 : 'not known yet: some of it has never been traded',
		days_my_hearts_last_at_that_cost: cost ? Math.floor(a.hearts / cost) : null
	};
}

/** a question the `ask` hook may answer with: a score over 2 to 10 options, each with the value it stands for */
function askable(a, v) {
	if (!plain(v)) return false;
	for (const [k, q] of Object.entries(v)) {
		const [side, g] = k.split('_');
		const ok = k === 'flex' || (side === 'ask' && a.grows.includes(g)) || (side === 'bid' && GOODS.includes(g) && !a.grows.includes(g));
		if (!ok || !plain(q) || q.type !== 'score' || typeof q.instructions !== 'string' || q.instructions.length > 4000) return false;
		const { criteria: c, levels: l } = q;
		if (!Array.isArray(c) || c.length < 2 || c.length > 10 || c.some((x) => typeof x !== 'string' || x.length > 300)) return false;
		if (!Array.isArray(l) || l.length !== c.length || l.some((x) => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1e6)) return false;
		if (k !== 'flex' && l.some((x) => x <= 0)) return false;
		if (k === 'flex' && l.some((x) => x > 1)) return false;
	}
	return true;
}

/** the typed questions for one aven this morning (the `ask` hook, then the brain's own: its next trial, a lesson) */
export function questionsFor(world, a, { full = true, writes = false } = {}) {
	const args = askArgs(world, a, full);
	const own = questionsOwn(world, a, args.anchors, full);
	const q = brainRule('ask', args, own, (v) => (askable(a, v) ? v : own));
	// the levels each score is read against stay with the aven; the brain gets the question without them
	a.brain.levels = {};
	const out = {};
	for (const [k, { levels, ...rest }] of Object.entries(q)) {
		a.brain.levels[k] = levels;
		out[k] = rest;
	}
	// how much stock it keeps is no longer asked every morning: it is the aven's wants, in its brain, changed by its
	// trials (scored by the game) and by the admin's edits. After a stretch is measured, a full ask also picks the next
	// trial, and a brain that writes adds a lesson (mind.js).
	if (full) Object.assign(out, mindQuestions(a, { writes }));
	return out;
}
/** what the `ask` hook is given, besides `valley`: each good's price anchor, what the aven wants and can spare, its
 * character's line per decision */
function askArgs(world, a, full) {
	const anchors = {};
	for (const g of a.grows) anchors[g] = anchorOf(world, a, g, 'ask');
	for (const g of GOODS) if (!a.grows.includes(g)) anchors[g] = anchorOf(world, a, g, 'bid');
	return {
		aven: a,
		day: world.day,
		full,
		anchors,
		market: marketOf(world),
		wants: Object.fromEntries(GOODS.filter((g) => !a.grows.includes(g)).map((g) => [g, want(a, g)])),
		spares: Object.fromEntries(a.grows.map((g) => [g, spare(a, g)])),
		character: { greed: inCharacter(a, 'greed'), thrift: inCharacter(a, 'thrift'), haggle: inCharacter(a, 'haggle') }
	};
}
function questionsOwn(world, a, anchors, full) {
	const q = {};
	for (const g of a.grows) {
		const m = world.market[g];
		const sold = a.yesterday ? a.yesterday.sold[g] : 0;
		const lv = priceLevels(anchors[g]);
		q[`ask_${g}`] = {
			type: 'score',
			instructions: `You grow ${GOOD_LABEL[g]} and hold ${a.stock[g]} (you need ${needOf(a, g)} a day yourself and can spare ${spare(a, g)}). ${m.price == null ? 'Nobody has traded it yet, so there is no market price: name your own' : `Its market price (the average traded over the last day) is ${m.price} HEARTS`}; right now ${m.supply} are offered and ${m.demand} wanted across the valley (see the market's 7-day history and what the other sellers ask). Yesterday you sold ${sold}${ROT[g] ? `; ${Math.round(ROT[g] * 100)}% of what you keep rots each night, so unsold stock is lost` : '; it keeps'}. Price it yourself to earn the most HEARTS: high when it is scarce and wanted, low enough to sell before it rots and at a price buyers can afford.${inCharacter(a, 'greed')} What should your selling price for ${GOOD_LABEL[g]} be?`,
			criteria: lv.criteria,
			levels: lv.levels
		};
	}
	for (const g of GOODS) {
		if (a.grows.includes(g)) continue;
		const m = world.market[g];
		const lv = priceLevels(anchors[g]);
		q[`bid_${g}`] = {
			type: 'score',
			instructions: `You don't grow ${GOOD_LABEL[g]} and must buy it: you need ${needOf(a, g)} a day, hold ${a.stock[g]} (${a.stock[g] < needOf(a, g) ? `short by ${needOf(a, g) - a.stock[g]} tonight unless you buy` : `enough for ${Math.floor(a.stock[g] / needOf(a, g))} days`}) and want ${want(a, g)} more${ROT[g] ? `; ${Math.round(ROT[g] * 100)}% of a stock rots each night` : ''}. ${deadline(a, g)} You hold ${Math.round(a.hearts)} HEARTS. ${m.price == null ? 'Nobody has traded it yet, so there is no market price' : `Its market price (the average traded over the last day) is ${m.price}`}; ${m.supply} are offered and ${m.demand} wanted (see the 7-day history and what sellers ask). Survival first, then keep the most HEARTS: pay up when you are about to go short, pay little when you are well stocked.${inCharacter(a, 'thrift')} What is the most you should pay for ${GOOD_LABEL[g]}?`,
			criteria: lv.criteria,
			levels: lv.levels
		};
	}
	// the slower decision (haggling) only on a full ask: every ask carries the whole state once per question, so fewer
	// questions is fewer tokens. Where to walk is no decision: a buyer walks to fetch what it bought (Samuel).
	if (full) q.flex = { type: 'score', instructions: `When a buyer's limit and a seller's price don't meet, how far should you give in to strike the deal?${inCharacter(a, 'haggle')}`, criteria: gives(), levels: flexes() };
	return q;
}

/** what a chat model (Qwen) is told before the state and the questions (the `prompt` hook) */
export function promptFor(a) {
	const own = promptOwn(a);
	return brainRule('prompt', { aven: a }, own, (v) => (typeof v === 'string' && v.trim() && v.length <= 4000 ? v : own));
}
const promptOwn = (a) =>
	`You decide for ${a.name}, one of the avens in a trading game. Read its state, then answer every question by picking the option that serves it best: survive first, then end with the most HEARTS. Act as the character in my_brain, and learn from its trials, lessons and deaths. Reply with one JSON object only: for each question key, the number or key of the option you pick (or, where asked to write, a short text). /no_think`;

/** apply one morning's answers to an aven's ledger of prices: each score read against the levels it was asked with */
export function applyAnswers(world, a, answers, source) {
	const changes = [];
	changes.push(...applyMind(world, a, answers));
	for (const [key, ans] of Object.entries(answers)) {
		if (key === 'next_trial' || key === 'lesson') continue;
		if (key === 'reserve') {
			const d = Number(ans.choice);
			if (d > 0 && d !== a.reserveDays) {
				changes.push(`keeps ${d} days in stock`);
				a.reserveDays = d;
			}
			continue;
		}
		if (key === 'flex') {
			if (typeof ans.score !== 'number') continue;
			const f = Math.round(factorOf(ans.score, a.brain.levels?.flex ?? flexes()) * 100) / 100;
			if (f !== a.flex) changes.push(`haggles up to ${Math.round(f * 100)}%`);
			a.flex = f;
			continue;
		}
		const [side, g] = key.split('_');
		const levels = a.brain.levels?.[key];
		if (!levels || typeof ans.score !== 'number' || (side === 'ask') !== a.grows.includes(g)) continue;
		const book = side === 'ask' ? a.ask : a.bid;
		const price = cents(factorOf(ans.score, levels, true));
		if (price !== book[g]) changes.push(`${side === 'ask' ? 'sells' : 'pays up to'} ${GOOD_LABEL[g]} at ${price}`);
		book[g] = price;
	}
	a.brain.last = { day: world.day, t: world.t, source, answers };
	// for the run's record in the database (when the page keeps one): what it decided, compactly
	if (world.outbox)
		world.outbox.push({ kind: 'decision', day: world.day, t: world.t, aven: a.name, source, changes, answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v?.choice ?? v?.text ?? (typeof v?.score === 'number' ? Math.round(v.score * 1000) / 1000 : null)])) });
	a.brain.ready = true;
	// every decision of every aven, newest last, for the page's Decisions feed
	const all = (world.decisions ??= []);
	all.push({ n: (all.at(-1)?.n ?? 0) + 1, day: world.day, t: world.t, id: a.id, name: a.name, colour: a.colour, source, changes });
	if (all.length > 300) all.splice(0, all.length - 300);
	// an aven re-decides every few seconds: only a decision that changed something goes in its ledger
	if (changes.length || a.ledger.at(-1)?.kind !== 'price') a.ledger.push({ day: world.day, t: world.t, kind: 'price', source, changes });
}
