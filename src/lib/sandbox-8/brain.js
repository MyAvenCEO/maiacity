// @ts-nocheck — plain JS game state, kept loose on purpose
// Each aven's mind. Every morning it looks at its own ledger and the valley and decides, per good, whether to move its
// asking price (what it grows) and its limit (what it buys), and how many days of food to keep in stock.
// The decisions come from Liquid's decision model d1:free (TypeSafe System One API): typed questions, answered with
// calibrated probabilities. d1:free needs no API key, but Liquid keeps its requests for training, so only the game
// state goes out, never anything about a person. When Liquid can't be reached, a small local rule decides instead.

import { GOODS, GOOD_LABEL, NEED, want, spare } from './economy.js';

export const LIQUID_URL = 'https://api.liquid.ai/decisions/v1/systemone';
export const LIQUID_MODEL = 'd1:free';

/** each aven's tools: just enough to run its own business, each one a typed question its brain answers every morning */
export const TOOLS = [
	{ id: 'ask', label: 'Price against the market', note: 'per good it grows: from 20% under the market price to 25% over; its price then follows the market every hour' },
	{ id: 'bid', label: 'Pay against the market', note: 'per good it buys: the most it pays, from 20% under the market price to 25% over' },
	{ id: 'flex', label: 'Haggle', note: 'how far it gives in when prices don\'t meet: not at all, 10%, 20% or 35%' },
	{ id: 'reserve', label: 'Keep a stock', note: '1 to 7 days of food and water' },
	{ id: 'visit', label: 'Plan my walk', note: 'where to go first and second today: the market square, another aven, or home to sell' }
];

/** where a price can sit against the market price, from well under to well over */
const MOVES = ['Well under the market (20% less)', 'A little under (10% less)', 'At the market price', 'A little over (10% more)', 'Well over (25% more)'];
const FACTOR = [0.8, 0.9, 1, 1.1, 1.25];
/** how far to give in when haggling */
const GIVE = ['Never give in', 'A little (10%)', 'Some (20%)', 'A lot (35%)'];
const FLEX = [0, 0.1, 0.2, 0.35];
const RESERVE = { '1': 'One day: spend as little as possible now', '2': 'Two days', '3': 'Three days', '5': 'Five days', '7': 'A week: never risk going hungry' };

/** a score of 0–4 (may fall between levels) to a price factor */
function factorOf(score, levels = FACTOR) {
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
			return [g, { market_price: m.price, yesterday: m.history.at(-2) ?? m.price, offered: m.supply, wanted: m.demand, sells: m.sells.map((o) => `${o.name} ${o.qty} at ${o.price}`), wants: m.wants.map((o) => `${o.name} ${o.qty} up to ${o.price}`) }];
		})
	);
}

/** the state an aven decides on: its own books and what it can see of the valley — nothing else */
export function stateFor(world, a) {
	const y = a.yesterday;
	return {
		game: 'Five avens trade food and water for HEARTS. Each needs 3 WATER and 2 each of FRUITS, VEGETABLES, LEGUMES and CHICKEN every day or loses health; at 0 health it dies. Goal: survive and end with the most HEARTS.',
		day: world.day,
		me: a.name,
		hearts: a.hearts,
		health: a.health,
		i_grow_per_day: a.produce,
		stock: a.stock,
		need_per_day: NEED,
		days_of_reserve_wanted: a.reserveDays,
		my_asking_prices: a.ask,
		my_buying_limits: a.bid,
		how_far_i_give_in_haggling: a.flex,
		yesterday: y ? { sold: y.sold, bought: y.bought, went_short_of: y.short } : null,
		market: boardFor(world),
		others: world.avens
			.filter((o) => o !== a)
			.map((o) => ({ name: o.name, alive: o.alive, hearts: o.hearts, grows: o.grows, asking: o.alive ? o.ask : null }))
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
			instructions: `You grow ${GOOD_LABEL[g]}. Its market price is ${m.price} HEARTS; ${m.supply} are offered and ${m.demand} wanted across the valley. Yesterday you sold ${sold}; you can spare ${spare(a, g)} today. To end with the most HEARTS, where should your selling price for ${GOOD_LABEL[g]} sit against the market price?`,
			criteria: MOVES
		};
	}
	for (const g of GOODS) {
		if (a.grows.includes(g)) continue;
		const m = world.market[g];
		q[`bid_${g}`] = {
			type: 'score',
			instructions: `You must buy ${GOOD_LABEL[g]} (you need ${NEED[g]} a day, you have ${a.stock[g]}, you want ${want(a, g)} more). Its market price is ${m.price} HEARTS; ${m.supply} are offered and ${m.demand} wanted. To survive and keep the most HEARTS, where should the most you pay for ${GOOD_LABEL[g]} sit against the market price?`,
			criteria: MOVES
		};
	}
	q.flex = { type: 'score', instructions: "When a buyer's limit and a seller's price don't meet, how far should you give in to strike the deal?", criteria: GIVE };
	q.reserve = { type: 'choice', instructions: 'How many days of food and water should you keep in stock from now on?', criteria: RESERVE };
	const stops = visitOptions(world, a);
	q.visit_1 = { type: 'choice', instructions: 'Who should you walk to first today, to buy what you lack or sell what you grow?', criteria: stops };
	q.visit_2 = { type: 'choice', instructions: 'And who next, after that first visit?', criteria: stops };
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

/** ask Liquid; resolves to the answers object or throws */
export async function askLiquid(state, questions, { signal } = {}) {
	const res = await fetch(LIQUID_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: LIQUID_MODEL, state, questions }),
		signal
	});
	if (!res.ok) throw new Error(`Liquid ${res.status}`);
	const body = await res.json();
	if (!body?.answers) throw new Error('Liquid sent no answers');
	return body.answers;
}

/** the local rule, when Liquid is off or out of reach: answers in the same shape */
export function localAnswers(world, a) {
	const out = {};
	const y = a.yesterday;
	for (const g of a.grows) {
		const sold = y ? y.sold[g] : 0;
		const left = spare(a, g);
		// sold out → a little dearer; nothing sold with plenty left → cheaper
		out[`ask_${g}`] = { type: 'score', score: sold > 0 && left < a.produce[g] ? 3 : sold === 0 && left > 0 ? 1 : 2 };
	}
	for (const g of GOODS) {
		if (a.grows.includes(g)) continue;
		const short = y?.short?.[g] ?? 0;
		out[`bid_${g}`] = { type: 'score', score: short ? 4 : want(a, g) > NEED[g] ? 3 : want(a, g) === 0 ? 1 : 2 };
	}
	out.reserve = { type: 'choice', choice: a.health < 60 ? '5' : '3' };
	out.flex = { type: 'score', score: a.health < 80 ? 3 : 1.5 };
	const lacks = GOODS.filter((g) => want(a, g) > 0).sort((x, y) => want(a, y) / NEED[y] - want(a, x) / NEED[x]);
	const stops = lacks.map((g) => world.avens.filter((o) => o !== a && o.alive && o.grows.includes(g)).sort((x, y) => x.ask[g] - y.ask[g])[0]?.name).filter(Boolean);
	// the local route: the market square first, then the cheapest grower of what it lacks most
	out.visit_1 = { type: 'choice', choice: 'market' };
	out.visit_2 = { type: 'choice', choice: stops[0] ?? 'home' };
	return out;
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
			const f = Math.round(factorOf(ans.score, FLEX) * 100) / 100;
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
		book[g] = Math.max(1, Math.round(world.market[g].price * f));
	}
	a.brain.last = { day: world.day, source, answers };
	a.ledger.push({ day: world.day, t: world.t, kind: 'price', source, changes });
}
