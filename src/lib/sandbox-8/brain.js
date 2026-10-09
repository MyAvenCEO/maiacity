// @ts-nocheck — plain JS game state, kept loose on purpose
// Each aven's mind. Every morning it looks at its own ledger and the valley and decides, per good, whether to move its
// asking price (what it grows) and its limit (what it buys), and how many days of food to keep in stock.
// The decisions come from Liquid's decision model d1:free (TypeSafe System One API): typed questions, answered with
// calibrated probabilities. d1:free needs no API key, but Liquid keeps its requests for training, so only the game
// state goes out, never anything about a person. When Liquid can't be reached, a small local rule decides instead.

import { GOODS, GOOD_LABEL, NEED, want, spare } from './economy.js';

export const LIQUID_URL = 'https://api.liquid.ai/decisions/v1/systemone';
export const LIQUID_MODEL = 'd1:free';

/** the five ways a price can move, from a sharp cut to a sharp rise */
const MOVES = ['Cut it by a quarter', 'Cut it a little', 'Keep it', 'Raise it a little', 'Raise it by a quarter'];
const FACTOR = [0.75, 0.9, 1, 1.1, 1.3];
const RESERVE = { '1': 'One day: spend as little as possible now', '2': 'Two days', '3': 'Three days', '5': 'Five days', '7': 'A week: never risk going hungry' };

/** a score of 0–4 (may fall between levels) to a price factor */
function factorOf(score) {
	const s = Math.max(0, Math.min(4, score));
	const i = Math.min(3, Math.floor(s));
	return FACTOR[i] + (FACTOR[i + 1] - FACTOR[i]) * (s - i);
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
		yesterday: y ? { sold: y.sold, bought: y.bought, went_short_of: y.short } : null,
		last_trade_price_in_valley: world.lastPrice,
		others: world.avens
			.filter((o) => o !== a)
			.map((o) => ({ name: o.name, alive: o.alive, hearts: o.hearts, grows: o.grows, asking: o.alive ? o.ask : null }))
	};
}

/** the typed questions for one aven this morning */
export function questionsFor(world, a) {
	const q = {};
	for (const g of a.grows) {
		const y = a.yesterday;
		const sold = y ? y.sold[g] : 0;
		const lowest = Math.min(...world.avens.filter((o) => o !== a && o.alive && o.grows.includes(g)).map((o) => o.ask[g]));
		q[`ask_${g}`] = {
			type: 'score',
			instructions: `You grow ${GOOD_LABEL[g]} and sell it for ${a.ask[g]} HEARTS a unit. Yesterday you sold ${sold}; you can spare ${spare(a, g)} today.${Number.isFinite(lowest) ? ` The other grower asks ${lowest}.` : ' Nobody else grows it now.'} To end with the most HEARTS, what should you do with your asking price for ${GOOD_LABEL[g]}?`,
			criteria: MOVES
		};
	}
	for (const g of GOODS) {
		if (a.grows.includes(g)) continue;
		const cheapest = Math.min(...world.avens.filter((o) => o !== a && o.alive && o.grows.includes(g)).map((o) => o.ask[g]));
		q[`bid_${g}`] = {
			type: 'score',
			instructions: `You must buy ${GOOD_LABEL[g]} (you need ${NEED[g]} a day, you have ${a.stock[g]}, you want ${want(a, g)} more). The most you pay is ${a.bid[g]} HEARTS a unit; the cheapest grower asks ${Number.isFinite(cheapest) ? cheapest : 'nothing, nobody sells it'}. To survive and keep the most HEARTS, what should you do with the most you will pay for ${GOOD_LABEL[g]}?`,
			criteria: MOVES
		};
	}
	q.reserve = { type: 'choice', instructions: 'How many days of food and water should you keep in stock from now on?', criteria: RESERVE };
	return q;
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
	return out;
}

/** apply one morning's answers to an aven's ledger of prices */
export function applyAnswers(world, a, answers, source) {
	const changes = [];
	for (const [key, ans] of Object.entries(answers)) {
		if (key === 'reserve') {
			const d = Number(ans.choice);
			if (d > 0 && d !== a.reserveDays) {
				changes.push(`keeps ${d} days in stock`);
				a.reserveDays = d;
			}
			continue;
		}
		const [side, g] = key.split('_');
		const book = side === 'ask' ? a.ask : a.bid;
		if (book[g] == null || typeof ans.score !== 'number') continue;
		const next = Math.max(1, Math.round(book[g] * factorOf(ans.score)));
		if (next !== book[g]) changes.push(`${side === 'ask' ? 'sells' : 'pays up to'} ${GOOD_LABEL[g]} ${book[g]} → ${next}`);
		book[g] = next;
	}
	a.brain.last = { day: world.day, source, answers };
	a.ledger.push({ day: world.day, t: world.t, kind: 'price', source, changes });
}
