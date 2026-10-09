// @ts-nocheck — plain JS game state, kept loose on purpose
// Each aven's mind. Every morning it looks at its own ledger and the valley and decides, per good, whether to move its
// asking price (what it grows) and its limit (what it buys), and how many days of food to keep in stock.
// The decisions come from Liquid's decision model d1:free (TypeSafe System One API): typed questions, answered with
// calibrated probabilities. d1:free needs no API key, but Liquid keeps its requests for training, so only the game
// state goes out, never anything about a person. There is no stand-in (Samuel): without Liquid's answers the valley waits.

import { GOODS, GOOD_LABEL, NEED, ROT, want, spare, cents } from './economy.js';
import { RULES } from './rules.js';

export const LIQUID_URL = 'https://api.liquid.ai/decisions/v1/systemone';
export const LIQUID_MODEL = 'd1:free';

/** each aven's tools: just enough to run its own business, each one a typed question its brain answers every morning */
export const TOOLS = [
	{ id: 'ask', label: 'Set my price', note: 'per good it grows: anything from a tenth of the market price to ten times it, chosen from its own stock, its needs, the market\'s history and what others ask; its price then follows the market every hour' },
	{ id: 'bid', label: 'Set what I pay', note: 'per good it buys: the most it pays, in the same range, from how close it is to going short' },
	{ id: 'flex', label: 'Haggle', note: 'how far it gives in when prices don\'t meet, up to the haggling the Policies allow' },
	{ id: 'reserve', label: 'Keep a stock', note: '1 to 7 days of food and water' },
	{ id: 'visit', label: 'Plan my walk', note: 'where to go first and second today: the market square, another aven, or home to sell' }
];

/** where a price can sit against the market price, from well under to well over */
/** where an aven's price can sit against the market price: no cap from outside, a tenth to ten times (a score falls
 * between levels, so any price in between is possible) */
const LEVELS = [0.1, 0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.33, 2, 4, 10];
const factors = () => LEVELS;
const moves = () => LEVELS.map((f) => (f === 1 ? 'At the market price' : `${f}× the market price`));
/** how far to give in when haggling */
const flexes = () => [0, 0.1, 0.25, 0.5, 1].map((f) => Math.round(f * RULES.haggleMax) / 100);
const gives = () => flexes().map((f, i) => (i ? `Give in up to ${Math.round(f * 100)}%` : 'Never give in'));
const RESERVE = { '1': 'One day: spend as little as possible now', '2': 'Two days', '3': 'Three days', '5': 'Five days', '7': 'A week: never risk going hungry' };

/** a score of 0–4 (may fall between levels) to a price factor */
function factorOf(score, levels = factors()) {
	const n = levels.length - 1;
	const s = Math.max(0, Math.min(n, score));
	const i = Math.min(n - 1, Math.floor(s));
	return levels[i] + (levels[i + 1] - levels[i]) * (s - i);
}

/** the live market board as an aven sees it: per good, the price, how much is offered and wanted, and by whom */
export function boardFor(world) {
	return Object.fromEntries(
		GOODS.map((g) => {
			const m = world.market[g];
			// the last two weeks: the market price each evening and the average actually traded each day
			const days = world.stats.slice(-14);
			return [
				g,
				{
					market_price: m.price,
					market_price_last_14_days: days.map((r) => r.price[g]),
					average_traded_last_14_days: days.map((r) => r.avg[g]),
					units_traded_last_14_days: days.map((r) => r.units[g]),
					offered_now: m.supply,
					wanted_now: m.demand,
					sellers_asking: m.sells.map((o) => `${o.name}: ${o.qty} at ${o.price}`),
					buyers_offering: m.wants.map((o) => `${o.name}: ${o.qty} up to ${o.price}`)
				}
			];
		})
	);
}

/** the state an aven decides on: its own books and what it can see of the valley — nothing else */
export function stateFor(world, a) {
	const y = a.yesterday;
	return {
		game: `${world.avens.length} avens trade food and water for HEARTS. Each needs ${NEED.water} WATER and ${NEED.fruits} each of FRUITS, VEGETABLES, LEGUMES and CHICKEN every day. With no water at all an aven lives through ${RULES.waterDays} days; with no food at all it lives ${RULES.foodDays} days. Supply is only just above need, so shortages are common. Every aven mints ${RULES.mint} HEARTS a day and every HEART decays ${RULES.decay}% a year, so hoarded HEARTS shrink. Prices are free: every aven sets its own, and the market price follows what is wanted, offered and traded. Goal: survive and end with the most HEARTS.`,
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
		days_of_reserve_wanted: a.reserveDays,
		my_asking_prices: a.ask,
		my_buying_limits: a.bid,
		how_far_i_give_in_haggling: a.flex,
		yesterday: y ? { sold: y.sold, bought: y.bought, went_short_of: y.short, rotted: y.rotted ?? {} } : null,
		market: boardFor(world),
		others: world.avens
			.filter((o) => o !== a)
			.map((o) => ({ name: o.name, alive: o.alive, hearts: o.hearts, grows: o.grows, asking: o.alive ? o.ask : null }))
	};
}

/** how long an aven lasts on what it holds, per good, and what buying a day's missing needs would cost today */
function survivalFor(world, a) {
	const days = Object.fromEntries(GOODS.map((g) => [g, NEED[g] ? Math.floor(a.stock[g] / NEED[g]) : null]));
	const cost = GOODS.reduce((n, g) => n + (a.grows.includes(g) ? 0 : NEED[g] * world.market[g].price), 0);
	return {
		days_my_stock_lasts: days,
		short_tonight_unless_i_buy: Object.fromEntries(GOODS.filter((g) => a.stock[g] < NEED[g]).map((g) => [g, NEED[g] - a.stock[g]])),
		water_reserve: `${Math.round(a.body.water)} of 100; at 0 I die. With no water at all I last ${RULES.waterDays} days`,
		food_reserve: `${Math.round(a.body.food)} of 100; at 0 I die. With no food at all I last ${RULES.foodDays} days`,
		cost_of_one_day_of_what_i_must_buy_at_market_price: Math.round(cost * 100) / 100,
		days_my_hearts_last_at_that_cost: cost ? Math.floor(a.hearts / cost) : null
	};
}

/** the typed questions for one aven this morning */
export function questionsFor(world, a) {
	const q = {};
	for (const g of a.grows) {
		const m = world.market[g];
		const sold = a.yesterday ? a.yesterday.sold[g] : 0;
		q[`ask_${g}`] = {
			type: 'score',
			instructions: `You grow ${GOOD_LABEL[g]} and hold ${a.stock[g]} (you need ${NEED[g]} a day yourself and can spare ${spare(a, g)}). Its market price is ${m.price} HEARTS; right now ${m.supply} are offered and ${m.demand} wanted across the valley (see the market's 14-day history and what the other sellers ask). Yesterday you sold ${sold}${ROT[g] ? `; ${Math.round(ROT[g] * 100)}% of what you keep rots each night, so unsold stock is lost` : '; it keeps'}. Price it yourself to earn the most HEARTS: high when it is scarce and wanted, low enough to sell before it rots. Where should your selling price for ${GOOD_LABEL[g]} sit against the market price?`,
			criteria: moves()
		};
	}
	for (const g of GOODS) {
		if (a.grows.includes(g)) continue;
		const m = world.market[g];
		q[`bid_${g}`] = {
			type: 'score',
			instructions: `You don't grow ${GOOD_LABEL[g]} and must buy it: you need ${NEED[g]} a day, hold ${a.stock[g]} (${a.stock[g] < NEED[g] ? `short by ${NEED[g] - a.stock[g]} tonight unless you buy` : `enough for ${Math.floor(a.stock[g] / NEED[g])} days`}) and want ${want(a, g)} more${ROT[g] ? `; ${Math.round(ROT[g] * 100)}% of a stock rots each night` : ''}. ${g === 'water' ? `Your water reserve is ${Math.round(a.body.water)} of 100.` : `Your food reserve is ${Math.round(a.body.food)} of 100.`} You hold ${Math.round(a.hearts)} HEARTS. Its market price is ${m.price}; ${m.supply} are offered and ${m.demand} wanted (see the 14-day history and what sellers ask). Survival first, then keep the most HEARTS: pay up when you are about to go short, pay little when you are well stocked. Where should the most you pay for ${GOOD_LABEL[g]} sit against the market price?`,
			criteria: moves()
		};
	}
	q.flex = { type: 'score', instructions: "When a buyer's limit and a seller's price don't meet, how far should you give in to strike the deal?", criteria: gives() };
	q.reserve = { type: 'choice', instructions: 'How many days of food and water should you keep in stock from now on? A bigger stock guards against bad harvests, but fresh food rots: fruits 25%, vegetables 15%, chicken 30%, legumes 5% a night; water keeps.', criteria: RESERVE };
	const stops = visitOptions(world, a);
	q.visit_1 = { type: 'choice', instructions: 'Who should you walk to now, to buy what you lack or sell what you grow?', criteria: stops };
	q.visit_2 = { type: 'choice', instructions: 'And who next, after that visit?', criteria: stops };
	return q;
}

/** where an aven can walk today: any living aven (what it grows and asks), or home to wait for buyers */
function visitOptions(world, a) {
	const out = { market: 'The market square in the middle of the valley: trade with everyone who is there', home: 'Stay on my own land and wait for buyers to come' };
	for (const o of world.avens) {
		if (o === a || !o.alive) continue;
		out[o.name] = `Grows ${o.grows.map((g) => `${GOOD_LABEL[g]} at ${o.ask[g]}`).join(' and ')}; wants ${GOODS.filter((g) => want(o, g) > 0 && a.grows.includes(g)).map((g) => GOOD_LABEL[g]).join(', ') || 'nothing I grow'}`;
	}
	return out;
}

/** ask Liquid, through our API's relay when `relay` is given (browsers can't reach Liquid directly); resolves to the
 * answers object or throws */
export async function askLiquid(state, questions, { signal, relay } = {}) {
	const res = await fetch(relay ?? LIQUID_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(relay ? { state, questions } : { model: LIQUID_MODEL, state, questions }),
		signal
	});
	if (!res.ok) throw new Error(`${relay ? 'relay' : 'Liquid'} ${res.status}${res.status >= 500 ? ` ${(await res.json().catch(() => null))?.error ?? ''}`.trimEnd() : ''}`);
	const body = await res.json();
	if (!body?.answers) throw new Error('Liquid sent no answers');
	return body.answers;
}

/** apply one morning's answers to an aven's ledger of prices */
export function applyAnswers(world, a, answers, source) {
	const changes = [];
	const route = [answers.visit_1?.choice, answers.visit_2?.choice].filter(Boolean);
	if (route.length) {
		a.plan = route.map((n) => (n === 'home' || n === 'market' ? n : world.avens.find((o) => o.name === n)?.id)).filter((x) => x != null);
		a.target = null;
		changes.push(`walks to ${route.join(', then ')}`);
	}
	for (const [key, ans] of Object.entries(answers)) {
		if (key.startsWith('visit_')) continue;
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
			const f = Math.round(factorOf(ans.score, flexes()) * 100) / 100;
			if (f !== a.flex) changes.push(`haggles up to ${Math.round(f * 100)}%`);
			a.flex = f;
			continue;
		}
		const [side, g] = key.split('_');
		if (a.markup[g] == null || typeof ans.score !== 'number' || (side === 'ask') !== a.grows.includes(g)) continue;
		const f = Math.round(factorOf(ans.score) * 100) / 100;
		const pct = Math.round((f - 1) * 100);
		if (f !== a.markup[g]) changes.push(`${side === 'ask' ? 'sells' : 'pays up to'} ${GOOD_LABEL[g]} at market ${pct >= 0 ? '+' : ''}${pct}%`);
		a.markup[g] = f;
		const book = side === 'ask' ? a.ask : a.bid;
		book[g] = cents(world.market[g].price * f);
	}
	a.brain.last = { day: world.day, t: world.t, source, answers };
	a.brain.ready = true;
	// an aven re-decides every few seconds: only a decision that changed something goes in its ledger
	if (changes.length || a.ledger.at(-1)?.kind !== 'price') a.ledger.push({ day: world.day, t: world.t, kind: 'price', source, changes });
}
