// @ts-nocheck — plain JS game state, kept loose on purpose
// What each aven's brain sees and is asked, and how its answers become prices (Samuel, 2026-10-09: the brains are card
// code too). It is the Brains card's code (game/economy/rules-code.js, its default), run in the QuickJS sandbox like
// every other rule: `see` builds the state a brain decides on, `ask` its typed questions (with the price levels each
// score is read against), `prompt` what Qwen is told, `score` how a day counts in its trials. The engine keeps the same
// logic natively below, only as the fallback for a hook that fails or a page where QuickJS can't load;
// scripts/sandbox-8-rules.mjs checks the two agree. Transport (Liquid, the GPU box) stays in brain.js.

import { GOODS, GOOD_LABEL, NEED, ROT, want, spare, cents, brainRule, activity, changeText, fieldsOn, invest, capexOf, opexOf, openCost, fieldBase, fieldYield, fieldGrown, levelShare } from './economy.js';
import { RULES } from './rules.js';
import { mindFor, inCharacter, mindQuestions, applyMind, traits, DIALS } from './mind.js';

/** prices (Samuel, 2026-10-09: free, with no ceiling): an aven names its price every time it decides. The scale it is
 * picked on (d1) or held within (a number from Qwen) hangs on its own price as the day began: from a quarter to four
 * times that, with "keep it" exactly in the middle, so an undecided answer keeps the price where it is. Hanging it on
 * the morning, not on the last answer or the clearing price, keeps an aven asking many times a day from compounding its
 * moves (World 15 ran away when the scale followed the clearing price); over days a price still goes anywhere, ×4 a day.
 * When the market trades beyond that, its price is one more option, so an aven can always reach it at once (in World 14
 * Ama, reborn, could not). An aven with no price yet (never priced, or just reborn) starts from the market price, else
 * from FIRST. No cap from its HEARTS. Liquid takes at most 10 levels a score question (more is a 422). */
const FIRST = [0.5, 1, 2, 4, 8, 15, 30, 60, 120, 250];
const MOVES = [0.25, 0.35, 0.5, 0.7, 1, 1.4, 2, 2.8, 4];
const needOf = (a, g) => a.need?.[g] ?? NEED[g];
/** what a price is anchored on today: the aven's own price as the day began (the engine remembers it through the day),
 * the clearing price, and what its HEARTS can pay for a day's need (what older worlds' card code caps a bid at) */
function anchorOf(world, a, g, side) {
	const book = side === 'ask' ? a.ask : a.bid;
	const day = (a.dayStart ??= { day: -1, ask: {}, bid: {} });
	if (day.day !== world.day) Object.assign(day, { day: world.day, ask: { ...a.ask }, bid: { ...a.bid } });
	const mine = (day[side][g] ??= book[g]) ?? null; // a first price named today is the day's anchor from then on
	const afford = side === 'bid' ? cents(Math.max(0.01, a.hearts) / Math.max(1, needOf(a, g))) : null;
	return { side, mine, market: world.market[g].price, afford };
}
/** the scale of one price: around its price this morning, else the market's, else from scratch; the market's price
 * added where it lies beyond */
function priceLevels({ mine, market }) {
	const base = mine ?? market;
	if (base == null) return { levels: FIRST.map(cents), criteria: FIRST.map((p) => `${p} HEARTS a unit`) };
	const what = mine != null ? 'my price this morning' : 'the market price';
	const opts = MOVES.map((f) => ({ p: cents(base * f), say: f === 1 ? `keep ${what}` : `${f}× ${what}` }));
	if (market != null && (market < opts[0].p || market > opts.at(-1).p)) opts.push({ p: cents(market), say: 'what it traded at over the last day' });
	opts.sort((x, y) => x.p - y.p);
	return { levels: opts.map((o) => o.p), criteria: opts.map((o) => `${o.p} HEARTS a unit (${o.say})`) };
}
/** what rots tonight in a seller's store unless it sells it: what it holds beyond tonight's own need, times the share
 * that rots, and what that is worth at the clearing price */
function rotsTonight(a, g, price) {
	const units = Math.floor(Math.max(0, a.stock[g] - needOf(a, g)) * (ROT[g] ?? 0));
	return { units, hearts: price == null ? null : Math.round(units * price * 100) / 100 };
}
const rotLine = (a, g, price) => {
	const r = rotsTonight(a, g, price);
	if (!ROT[g]) return '; it keeps';
	return `; ${Math.round(ROT[g] * 100)}% of what you keep rots each night: unless you sell them, ${r.units} of your ${a.stock[g]} rot tonight${r.hearts != null ? ` (${r.hearts} HEARTS at the clearing price, lost)` : ''}`;
};
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
			return [g, { price: m.price, posted: m.posted ?? null, round: m.round ?? null, supply: m.supply, demand: m.demand, sells: m.sells.map((o) => ({ name: o.name, qty: o.qty, price: o.price })), wants: m.wants.map((o) => ({ name: o.name, qty: o.qty, price: o.price })) }];
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
		health: `${a.health} of ${RULES.healthMax}; at 0 I die`,
		body_reserves: { water: Math.round(a.body.water), food: Math.round(a.body.food) },
		i_grow_per_day_on_average: a.produce,
		my_harvest_last_night: a.harvest,
		harvests_vary: `about ±${RULES.swing}% a night; ${RULES.badChance}% of nights a bad harvest (30–60%), ${RULES.richChance}% a rich one`,
		// what it takes to stay alive: how long it lasts on its own stock, and what a day's missing needs cost at the market
		survival: survivalFor(world, a),
		share_that_rots_each_night: ROT,
		// what rots in its store tonight unless it sells (or eats) it, and what that is worth at the clearing price
		rots_tonight_unless_sold: Object.fromEntries(GOODS.filter((g) => ROT[g] && a.stock[g] > needOf(a, g)).map((g) => [g, rotsTonight(a, g, world.market[g].price)])),
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

/** a decision of the world's own (any other key the `ask` hook asks: Samuel, 2026-10-09, a proposal may add one, e.g.
 * how much to plant): its answer is kept as aven.choices[key], which every hook reads, and the feed shows it */
const OWN_KEY = /^[a-z][a-z0-9_]{1,40}$/;
const isOwn = (k) => OWN_KEY.test(k) && !/^(ask|bid)_/.test(k) && !['flex', 'reserve', 'next_trial', 'lesson'].includes(k);
/** a question the `ask` hook may answer with: a score over 2 to 10 options, each with the value it stands for, or a
 * number (Samuel, 2026-10-09: free prices), which a brain that writes numbers (Qwen) answers as it likes and a decision
 * model (d1) picks on the same kind of scale; optionally what its answer sets (label) and in what (unit), as the
 * activity feed says it */
function askable(a, v) {
	if (!plain(v) || Object.keys(v).filter(isOwn).length > 8) return false;
	for (const [k, q] of Object.entries(v)) {
		const [side, g] = k.split('_');
		const ok = k === 'flex' || (side === 'ask' && a.grows.includes(g)) || (side === 'bid' && GOODS.includes(g) && !a.grows.includes(g)) || isOwn(k);
		if (!ok || !plain(q) || (q.type !== 'score' && q.type !== 'number') || (q.type === 'number' && k === 'flex') || typeof q.instructions !== 'string' || q.instructions.length > 4000) return false;
		if (q.label != null && (typeof q.label !== 'string' || q.label.length > 80)) return false;
		if (q.unit != null && (typeof q.unit !== 'string' || q.unit.length > 20)) return false;
		if (isOwn(k)) {
			if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10 || q.criteria.some((x) => typeof x !== 'string' || x.length > 300)) return false;
			if (!Array.isArray(q.levels) || q.levels.length !== q.criteria.length || q.levels.some((x) => typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1e6)) return false;
			continue;
		}
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
	a.brain.labels = {};
	a.brain.units = {};
	const out = {};
	for (const [k, { levels, label, unit, ...rest }] of Object.entries(q)) {
		a.brain.levels[k] = levels;
		a.brain.labels[k] = label || labelOf(k); // what its answer sets, as the activity feed says it
		if (unit) a.brain.units[k] = unit;
		out[k] = rest;
	}
	// how much stock it keeps is no longer asked every morning: it is the aven's wants, in its brain, changed by its
	// trials (scored by the game) and by the admin's edits. After a stretch is measured, a full ask also picks the next
	// trial, and a brain that writes adds a lesson (mind.js).
	if (full) Object.assign(out, mindQuestions(a, { writes }));
	// its own fields (where its world has them): what to keep, level up, change or open, every option priced
	// one aven at a time (Samuel's World 24: asked together, all ten opened the same crop): at most one aven a game hour
	// gets its field questions, the one that has waited longest for them, so each decides on the fields the ones
	// before it just opened
	if (full && fieldsOn() && a.fields) {
		const waited = (/** @type {any} */ o) => o.fieldAt ?? -Infinity;
		const next = world.avens.filter((o) => o.alive).every((o) => waited(a) <= waited(o));
		// and an aven decides about its fields at most once every fieldEvery days (fields aren't for chasing each day's price)
		const rested = world.t - waited(a) >= (RULES.fieldEvery ?? 0) * 86400;
		if (next && rested && world.t - (world.fieldLast ?? -Infinity) >= 3600) {
			a.fieldAt = world.fieldLast = world.t;
			Object.assign(out, fieldQuestions(world, a));
		}
	}
	return out;
}

/** the market as an entrepreneur reads it: per crop, its price, what the valley needs, and every field that grows it,
 * whose and at what level (Samuel, 2026-10-10: it sees what the others do and decides what to grow) */
function fieldMarket(world) {
	const live = world.avens.filter((o) => o.alive);
	return GOODS.map((g) => {
		const p = world.market[g].posted ?? world.market[g].price;
		const fields = live.flatMap((o) => (o.fields ?? []).filter((f) => f.crop === g).map((f) => `${o.name} L${f.level}${fieldGrown(world, f) < 1 ? ' growing' : ''}`));
		const yieldNow = live.reduce((n, o) => n + (o.fields ?? []).filter((f) => f.crop === g).reduce((m, f) => m + fieldYield(world, f), 0), 0);
		const need = live.length * (NEED[g] ?? 0);
		return `${GOOD_LABEL[g]}: ${p == null ? 'no price yet' : `${p} HEARTS a unit`}; the valley needs ${need} a day and its fields give about ${Math.round(yieldNow)}${fields.length ? ` (${fields.join(', ')})` : ' (nobody grows it)'}`;
	}).join('. ');
}
/** one question per field (and one for the next field it could open): keep, level up, or plant another crop */
function fieldQuestions(world, a) {
	const q = {};
	// a good not traded yet is worth what the valley's budget says a unit is (a day's minting over a day's needs), not 0:
	// a crop just planted has no price yet, and read as worthless it was abandoned before it grew (World 24)
	const budget = RULES.mint / GOODS.reduce((n, g) => n + (NEED[g] ?? 0), 0);
	const today = (g) => world.market[g].posted ?? world.market[g].price ?? budget;
	// fieldPriceDays (World 28): a field lives for weeks, so it is reckoned on the crop's average price over the last
	// days, not on today's spike or crash (World 27: a wave of level-ups at 100-400 a unit, then a flight at 0.01)
	const span = (RULES.fieldPriceDays ?? 0) * 86400;
	const average = (g) => {
		const pts = (world.market[g].series ?? []).filter((p) => p.t >= world.t - span && p.price != null);
		return pts.length ? pts.reduce((n, p) => n + p.price, 0) / pts.length : null;
	};
	const price = span > 0 ? (g) => average(g) ?? today(g) : today;
	// what a crop will be worth once it grows: today's price, scaled by how far the valley's fields, those still
	// growing included, will fall short of its need (dearer) or outgrow it (cheaper). Reckoned on today's price alone,
	// every brain planted the same best crop and the valley grew one thing (World 24)
	const live = world.avens.filter((o) => o.alive);
	const rain = (g) => (g === 'water' && world.weather ? live.length * (RULES.rainChance / 100) * (1 + RULES.rainMax) / 2 : 0);
	// forecast 1 (World 25's switching): today's price already holds today's scarcity, so it moves only by how far the
	// valley's supply changes from now until its fields have grown, this aven's own move counted (`move`: the units a day
	// the option adds to, or takes from, each crop). Read off need ÷ planned instead, scarcity counted twice and the
	// aven's own field left out: a crop it left looked empty, the one it grew crowded, and every option said switch
	const planned = (g) => live.reduce((n, o) => n + (o.fields ?? []).filter((h) => h.crop === g).reduce((m, h) => m + fieldBase(g) * levelShare(h.level), 0), 0) + rain(g);
	const supplyNow = (g) => live.reduce((n, o) => n + (o.fields ?? []).filter((h) => h.crop === g).reduce((m, h) => m + fieldYield(world, h), 0), 0) + rain(g);
	// forecast 2 (World 29): the market's price level (the middle of the goods' prices today, so neither one runaway price
	// lifts every crop nor two crashed ones sink them all) shaped by the valley's own balance once every planted field and
	// the option have grown: need ÷ that supply. An arithmetic mean put water at 42 a unit while it sold at 0.04; a
	// geometric one fell to near 0 once two overgrown crops hit the price floor, every crop looked worthless and only the
	// keep cost counted, so a stand-in that picks the biggest net drifted into WATER and LEGUMES (the cheapest to keep)
	// until they grew 285-440% of need and the rest 45-50%. No lagging average and no stale price: in World 28 a 14-day
	// average of frozen prices rated the crop grown 3.5 times over at 919 and the one nobody grew at 16
	const prices = GOODS.map((g) => today(g)).sort((x, y) => x - y);
	const priceLevel = prices[Math.floor(prices.length / 2)];
	const coverage = (g, move = {}) => {
		const need = live.length * (NEED[g] ?? 0);
		const grown = planned(g) + (move[g] ?? 0);
		return `the valley would grow ${Math.round(grown)} of the ${need} ${GOOD_LABEL[g]} it needs a day (${Math.round((grown / Math.max(1, need)) * 100)}%)`;
	};
	const later = (g, move = {}) => {
		const need = live.length * (NEED[g] ?? 0);
		if (!RULES.forecast) return price(g) * Math.max(0.25, Math.min(4, need / Math.max(0.5, planned(g))));
		if (RULES.forecast === 2) return priceLevel * Math.max(0.25, Math.min(4, need / Math.max(0.5, planned(g) + (move[g] ?? 0))));
		const floor = Math.max(0.5, need / 4);
		return price(g) * Math.max(0.25, Math.min(4, Math.max(floor, supplyNow(g)) / Math.max(floor, planned(g) + (move[g] ?? 0))));
	};
	const r = (x) => (RULES.forecast === 2 && Math.abs(x) < 1 ? Number(x.toPrecision(2)) : Math.round(x * 10) / 10); // forecast 2: a price under 1 keeps two digits (0.043, not 0)
	// every option is reckoned over the next fieldHorizon days (14 until World 27), so what a change loses while it grows
	// shows; a field lasts the whole world, and reckoned on two weeks a second field or a level-up never paid (World 26)
	const H = RULES.fieldHorizon ?? 14;
	const food = GOODS.filter((g) => !a.grows.includes(g)).reduce((n, g) => n + (NEED[g] ?? 0) * price(g), 0); // a day of what it buys
	/** units a field yields over the next H days: `grown` how far it has grown now (0 for a new crop), its level's share */
	const units = (g, share, grown, ramp = RULES[`ramp_${g}`] ?? 7) => {
		let n = 0;
		for (let d = 1; d <= H; d++) n += fieldBase(g) * share * Math.min(1, grown + (ramp > 0 ? d / ramp : 1));
		return n;
	};
	/** an option over the next two weeks: what it yields and is worth, what it costs, its net, and what it leaves */
	const reckon = (g, share, grown, once, level, move = {}) => {
		const u = units(g, share, grown);
		const keep = opexOf(g, level) * H;
		const at = later(g, move);
		const net = u * at - keep - once;
		const left = a.hearts - once;
		// over a horizon longer than two weeks (World 27 on), what is paid now also says when it is earned back
		let back = '';
		if (once > 0 && H > 14) {
			let sum = -once;
			let d = 0;
			const ramp = RULES[`ramp_${g}`] ?? 7;
			while (sum < 0 && d < 365) (d++, (sum += fieldBase(g) * share * Math.min(1, grown + (ramp > 0 ? d / ramp : 1)) * at - opexOf(g, level)));
			back = sum >= 0 ? ` (pays back in about ${d} days)` : ' (never pays back at this price)';
		}
		const cover = RULES.forecast === 2 ? `${coverage(g, move)}; ` : '';
		return `${cover}over the next ${H} days about ${Math.round(u)} ${GOOD_LABEL[g]} worth ${Math.round(u * at)} HEARTS (at about ${r(at)} a unit once the valley's fields grow${RULES.forecast ? ', yours included' : ''}, ${r(today(g))} today${span > 0 ? `, ${r(price(g))} on average over ${RULES.fieldPriceDays} days` : ''}), for ${once ? `${once} now and ` : ''}${Math.round(keep)} in keep: ${Math.round(net)} net${back}; it leaves you ${Math.round(left)} HEARTS${food > 0 ? ` (${Math.max(0, Math.floor(left / food))} days of the food you buy)` : ''}`;
	};
	const reserve = (RULES.fieldReserve ?? 0) * food;
	const can = (cost) => a.hearts - cost >= reserve;
	const market = fieldMarket(world);
	// forecast 2: what its own last field moves earned against keeping what it had, and what the valley did in the last day
	const avgPrice = (g, from) => {
		const pts = (world.market[g].series ?? []).filter((p) => p.t >= from && p.price != null);
		return pts.length ? pts.reduce((n, p) => n + p.price, 0) / pts.length : today(g);
	};
	const past = RULES.forecast === 2
		? (a.fieldMoves ?? [])
				.filter((m) => m.kind === 'change' && world.day > m.day)
				.slice(-3)
				.map((m) => {
					const days = world.day - m.day;
					const ramp = RULES[`ramp_${m.to}`] ?? 7;
					let got = 0;
					for (let d = 1; d <= days; d++) got += fieldBase(m.to) * Math.min(1, d / Math.max(1, ramp));
					const would = fieldBase(m.from) * levelShare(m.fromLevel ?? 1) * days;
					const earned = got * avgPrice(m.to, m.t) - opexOf(m.to, 1) * days;
					const kept = would * avgPrice(m.from, m.t) - opexOf(m.from, m.fromLevel ?? 1) * days;
					return `day ${m.day}, field ${m.slot + 1} ${GOOD_LABEL[m.from]} → ${GOOD_LABEL[m.to]}: it has earned you about ${Math.round(earned)} HEARTS since; keeping ${GOOD_LABEL[m.from]} would have earned about ${Math.round(kept)}`;
				})
		: [];
	const lately = RULES.forecast === 2 ? (world.fieldLog ?? []).filter((m) => world.t - m.t <= 86400 && m.name !== a.name) : [];
	const valleyMoves = lately.length
		? ` In the last day: ${lately.map((m) => (m.kind === 'open' ? `${m.name} opened ${GOOD_LABEL[m.to]}` : m.kind === 'level' ? `${m.name} levelled up ${GOOD_LABEL[m.to]}` : `${m.name} switched ${GOOD_LABEL[m.from]} to ${GOOD_LABEL[m.to]}`)).join('; ')}.`
		: RULES.forecast === 2 ? ' In the last day nobody else changed a field.' : '';
	const longGame = RULES.forecast === 2
		? ` This is a long game: the valley needs every good every day, and a field earns over weeks, not on today's price. Judge an option by what the valley will lack or have too much of once it is done (its coverage), and by what your own past moves earned.${past.length ? ` Your last field moves: ${past.join('; ')}.` : ''}${valleyMoves}`
		: '';
	const slots = Math.min(3, a.fields.length + 1);
	// fieldTurn (World 28): one field a turn, each in turn, so a farm never flips whole on one day's numbers (World 27:
	// each field reckoned alone against the same market, all three went to the same crop at once)
	const turn = RULES.fieldTurn ? (a.fieldNext = (a.fieldNext ?? -1) + 1) % slots : null;
	for (let slot = 0; slot < slots; slot++) {
		if (turn != null && slot !== turn) continue;
		const f = a.fields[slot];
		const levels = [0];
		const criteria = [];
		let note = '';
		if (f) {
			const grown = fieldGrown(world, f);
			criteria.push(`keep its ${GOOD_LABEL[f.crop]} field at level ${f.level}${grown < 1 ? ` (still growing: ${Math.round(grown * 100)}%)` : ''}: ${reckon(f.crop, levelShare(f.level), grown, 0, f.level)}`);
			if (f.level < 3 && can(capexOf(f.crop, f.level + 1))) {
				levels.push(1);
				criteria.push(`level it up to ${f.level + 1} for ${capexOf(f.crop, f.level + 1)} HEARTS: ${reckon(f.crop, levelShare(f.level + 1), grown, capexOf(f.crop, f.level + 1), f.level + 1, { [f.crop]: fieldBase(f.crop) * (levelShare(f.level + 1) - levelShare(f.level)) })}`);
			}
			// a crop is a commitment (holdDays): it can be changed only once it has been in the ground that long
			const free = world.day - f.since >= (RULES.holdDays ?? 0);
			if (free)
				for (const [i, g] of GOODS.entries())
					if (g !== f.crop) {
						levels.push(2 + i);
						criteria.push(`change it to ${GOOD_LABEL[g]} (back to level 1, nothing until it grows in ${RULES[`ramp_${g}`]} days): ${reckon(g, 1, 0, 0, 1, { [g]: fieldBase(g), [f.crop]: -fieldBase(f.crop) * levelShare(f.level) })}`);
					}
			else note = ` It was planted on day ${f.since}: its crop can be changed from day ${f.since + RULES.holdDays}.`;
		} else {
			criteria.push(`don't open ${slot ? `field ${slot + 1}` : 'a field'} yet: it leaves you ${Math.round(a.hearts)} HEARTS`);
			for (const [i, g] of GOODS.entries()) {
				if (!can(openCost(slot, g, a))) continue;
				levels.push(2 + i);
				criteria.push(`open field ${slot + 1} with ${GOOD_LABEL[g]} for ${openCost(slot, g, a)} HEARTS (nothing until it grows in ${RULES[`ramp_${g}`]} days): ${reckon(g, 1, 0, openCost(slot, g, a), 1, { [g]: fieldBase(g) })}`);
			}
		}
		const key = `field${slot + 1}`;
		a.brain.levels[key] = levels;
		a.brain.labels[key] = `field ${slot + 1}`;
		q[key] = {
			type: 'score',
			instructions: `You farm your own fields and decide what they grow: you can level a field up (paid once, then it costs more a night and yields more; you pay the Maia City Coop), change its crop (back to level 1, and nothing until it grows) or open up to 3 fields. What a field yields you sell at the posted price, or eat. Every option is reckoned over the next ${H} days, so a crop that has to grow first, or a field you can't afford to keep, shows what it really costs; keep enough HEARTS to buy the food you don't grow${reserve ? ` (you can't spend below ${Math.round(reserve)}: ${RULES.fieldReserve} days of it)` : ''}. You hold ${Math.round(a.hearts)} HEARTS. The market: ${market}.${RULES.forecast ? '' : ' Grow what is scarce and dear, not what everyone else already grows.'}${longGame} ${f ? `Your field ${slot + 1} grows ${GOOD_LABEL[f.crop]} at level ${f.level}.${note}` : `${a.fields.length ? `You have ${a.fields.length} field${a.fields.length === 1 ? '' : 's'}.` : 'You have no field yet: until you open one and it grows, you live on your stores and the market.'}`} What do you do with field ${slot + 1}?`,
			criteria
		};
	}
	return q;
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
		// its character's line per dial its world declares (a dial it doesn't is an empty line)
		character: Object.fromEntries([...new Set([...Object.keys(DIALS), ...traits().dials.map((d) => d.key)])].map((k) => [k, inCharacter(a, k)]))
	};
}
/** what an answer sets, in the activity feed's words, where the ask hook gives no label: where nobody haggles, a
 * seller's ask is the lowest it accepts and a buyer's the most it pays */
function labelOf(k) {
	if (k === 'flex') return 'gives in up to';
	if (isOwn(k)) return k.replace(/_/g, ' ');
	const [side, g] = k.split('_');
	const L = GOOD_LABEL[g] ?? g;
	if (RULES.haggleMax > 0) return side === 'ask' ? `sells ${L} at` : `pays ${L} up to`;
	return side === 'ask' ? `lowest it accepts for ${L}` : `most it pays for ${L}`;
}
function questionsOwn(world, a, anchors, full) {
	const q = {};
	// what it is told about its price: where it stood this morning, and how far it may move it today
	const range = (an, lv) => `${an.mine != null ? `Your price this morning was ${an.mine} HEARTS. ` : ''}Name your price in HEARTS a unit, anywhere from ${lv.levels[0]} to ${lv.levels.at(-1)} today.`;
	for (const g of a.grows) {
		const m = world.market[g];
		const sold = a.yesterday ? a.yesterday.sold[g] : 0;
		const lv = priceLevels(anchors[g]);
		q[`ask_${g}`] = {
			type: 'number',
			instructions: `You grow ${GOOD_LABEL[g]} and hold ${a.stock[g]} (you need ${needOf(a, g)} a day yourself and can spare ${spare(a, g)}). ${m.price == null ? 'Nobody has traded it yet, so there is no clearing price' : `Its clearing price (the average traded over the last day) is ${m.price} HEARTS`}; right now ${m.supply} are offered and ${m.demand} wanted across the valley (see the market's 7-day history and what the other sellers ask). Yesterday you sold ${sold}${rotLine(a, g, m.price)}. Price it yourself to earn the most HEARTS: high when it is scarce and wanted, low enough to sell what would otherwise rot.${inCharacter(a, 'greed')} ${range(anchors[g], lv)} What is the lowest price you sell ${GOOD_LABEL[g]} at?`,
			unit: 'HEARTS',
			criteria: lv.criteria,
			levels: lv.levels
		};
	}
	for (const g of GOODS) {
		if (a.grows.includes(g)) continue;
		const m = world.market[g];
		const lv = priceLevels(anchors[g]);
		q[`bid_${g}`] = {
			type: 'number',
			instructions: `You don't grow ${GOOD_LABEL[g]} and must buy it: you need ${needOf(a, g)} a day, hold ${a.stock[g]} (${a.stock[g] < needOf(a, g) ? `short by ${needOf(a, g) - a.stock[g]} tonight unless you buy` : `enough for ${Math.floor(a.stock[g] / needOf(a, g))} days`}) and want ${want(a, g)} more${ROT[g] ? `; ${Math.round(ROT[g] * 100)}% of a stock rots each night, so what you hold beyond your needs is lost` : ''}. ${deadline(a, g)} You hold ${Math.round(a.hearts)} HEARTS. ${m.price == null ? 'Nobody has traded it yet, so there is no clearing price' : `Its clearing price (the average traded over the last day) is ${m.price}`}; ${m.supply} are offered and ${m.demand} wanted (see the 7-day history and what sellers ask). Survival first, then keep the most HEARTS: pay up when you are about to go short, pay little when you are well stocked.${inCharacter(a, 'thrift')} ${range(anchors[g], lv)} What is the most you pay for ${GOOD_LABEL[g]}?`,
			unit: 'HEARTS',
			criteria: lv.criteria,
			levels: lv.levels
		};
	}
	// the slower decision (haggling) only on a full ask: every ask carries the whole state once per question, so fewer
	// questions is fewer tokens. Where to walk is no decision: a buyer walks to fetch what it bought (Samuel).
	if (full && RULES.haggleMax > 0) q.flex = { type: 'score', instructions: `When a buyer's limit and a seller's price don't meet, how far should you give in to strike the deal?${inCharacter(a, 'haggle')}`, criteria: gives(), levels: flexes() };
	return q;
}

/** what a chat model (Qwen) is told before the state and the questions (the `prompt` hook) */
export function promptFor(a) {
	const own = promptOwn(a);
	return brainRule('prompt', { aven: a }, own, (v) => (typeof v === 'string' && v.trim() && v.length <= 4000 ? v : own));
}
const promptOwn = (a) =>
	`You decide for ${a.name}, one of the avens in a trading game. Read its state, then answer every question by picking the option that serves it best: survive first, then end with the most HEARTS. Act as the character in my_brain, and learn from its trials, lessons and deaths. Reply with one JSON object only: for each question key, the number or key of the option you pick (where a question asks for a number, the number itself; where asked to write, a short text). /no_think`;

/** a number answer, when it is one */
const numberOf = (ans) => (typeof ans?.number === 'number' && Number.isFinite(ans.number) ? ans.number : null);

/** apply one morning's answers to an aven's ledger of prices: a number as it is, a score read against the levels it was
 * asked with */
export function applyAnswers(world, a, answers, source) {
	const changes = []; // what it set anew: { label, from, to } (the feed's standard change), or a sentence
	const kept = []; // what it answered as it was
	changes.push(...applyMind(world, a, answers));
	const set = (key, from, to, unit = a.brain.units?.[key]) => (from === to ? kept : changes).push({ label: a.brain.labels?.[key] ?? labelOf(key), from, to, ...(unit ? { unit } : {}) });
	for (const [key, ans] of Object.entries(answers)) {
		if (key === 'next_trial' || key === 'lesson') continue;
		if (/^field[123]$/.test(key)) {
			// a decision about a field: the option it picked, acted on at once (and paid for)
			const levels = a.brain.levels?.[key];
			const pick = numberOf(ans) ?? (typeof ans.score === 'number' ? ans.score : null);
			if (!levels || pick == null) continue;
			const c = invest(world, a, Number(key.slice(5)) - 1, levels[Math.max(0, Math.min(levels.length - 1, Math.round(pick)))]);
			if (c) changes.push(c);
			continue;
		}
		if (key === 'reserve') {
			const d = Number(ans.choice);
			if (d > 0) {
				set(key, a.reserveDays, d, 'days');
				a.reserveDays = d;
			}
			continue;
		}
		if (key === 'flex') {
			if (typeof ans.score !== 'number') continue;
			const f = Math.round(factorOf(ans.score, a.brain.levels?.flex ?? flexes()) * 100) / 100;
			set(key, Math.round((a.flex ?? 0) * 100), Math.round(f * 100), '%');
			a.flex = f;
			continue;
		}
		if (isOwn(key)) {
			// a decision of the world's own: the number it answered, else the value its score stands for, kept for every
			// hook to read
			const levels = a.brain.levels?.[key];
			const v = numberOf(ans) != null ? Math.round(Math.max(-1e6, Math.min(1e6, numberOf(ans))) * 100) / 100 : levels && typeof ans.score === 'number' ? Math.round(factorOf(ans.score, levels) * 100) / 100 : null;
			if (v == null) continue;
			set(key, a.choices?.[key] ?? null, v);
			(a.choices ??= {})[key] = v;
			continue;
		}
		const [side, g] = key.split('_');
		const levels = a.brain.levels?.[key];
		if ((side === 'ask') !== a.grows.includes(g) || !GOODS.includes(g)) continue;
		// the price it named, held within the scale its question carried (the card sets how far a price may move), else
		// the price its score stands for
		const n = numberOf(ans);
		const lo = levels ? Math.min(...levels) : 0.01;
		const hi = levels ? Math.max(...levels) : 1e9;
		const price = n != null && n > 0 ? cents(Math.min(hi, Math.max(lo, n))) : levels && typeof ans.score === 'number' ? cents(factorOf(ans.score, levels, true)) : null;
		if (price == null) continue;
		const book = side === 'ask' ? a.ask : a.bid;
		set(key, book[g], price);
		book[g] = price;
	}
	a.brain.last = { day: world.day, t: world.t, source, answers };
	// for the run's record in the database (when the page keeps one): what it decided, compactly
	if (world.outbox)
		world.outbox.push({ kind: 'decision', day: world.day, t: world.t, aven: a.name, source, changes: changes.map(changeText), answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v?.choice ?? v?.text ?? numberOf(v) ?? (typeof v?.score === 'number' ? Math.round(v.score * 1000) / 1000 : null)])) });
	a.brain.ready = true;
	// every decision of every aven, newest last, for the page's Decisions feed
	activity(world, { kind: 'decision', source, changes, kept }, a);
	// an aven re-decides every few seconds: only a decision that changed something goes in its ledger
	if (changes.length || a.ledger.at(-1)?.kind !== 'price') a.ledger.push({ day: world.day, t: world.t, kind: 'price', source, changes });
}
