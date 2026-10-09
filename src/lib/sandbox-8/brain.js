// @ts-nocheck — plain JS game state, kept loose on purpose
// Each aven's mind. Every morning it looks at its own ledger and the valley and decides, per good, whether to move its
// asking price (what it grows) and its limit (what it buys), and how many days of food to keep in stock.
// The decisions come from Liquid's decision model d1:free (TypeSafe System One API): typed questions, answered with
// calibrated probabilities. d1:free needs no API key, but Liquid keeps its requests for training, so only the game
// state goes out, never anything about a person. There is no rule-based stand-in (Samuel): without a brain's answers the
// valley waits. Since 2026-10-09 the avens think on Samuel's own GPU machine, reached over Tailscale from his studio:
// d1 itself (LiquidAI-d1-3b, the same decision API) by default, and Qwen, fast, when d1 can't (Samuel). Qwen answers the
// same typed questions through its OpenAI-style chat. Liquid's hosted d1:free stays as a choice.

import { GOODS, GOOD_LABEL, NEED, ROT, want, spare, cents } from './economy.js';
import { RULES } from './rules.js';
import { mindFor, inCharacter, mindQuestions, applyMind } from './mind.js';
import { native, command } from '$lib/native';

export const LIQUID_URL = 'https://api.liquid.ai/decisions/v1/systemone';
export const LIQUID_MODEL = 'd1:free';

/** each aven's tools: just enough to run its own business, each one a typed question its brain answers every morning */
export const TOOLS = [
	{ id: 'ask', label: 'Set my price', note: 'per good it grows, in HEARTS: no starting price, it names its first one and then moves it as it likes, from its own stock, its needs, the market\'s history and what others ask' },
	{ id: 'bid', label: 'Set what I pay', note: 'per good it buys: the most it pays, in the same range, from how close it is to going short' },
	{ id: 'flex', label: 'Haggle', note: 'how far it gives in when prices don\'t meet, up to the haggling the Policies allow' },
	{ id: 'reserve', label: 'Keep a stock', note: 'days of water and of food: its wants, in its brain, changed only by its own trials (or the admin)' },
	{ id: 'trial', label: 'Try something', note: `after each stretch of a few days, one change to its character or wants, kept only if its score beats the last stretch's` },
	{ id: 'lesson', label: 'Learn', note: 'on Qwen, one short lesson of its own after each stretch, weighed by how the next stretch goes' }
];

/** no starting prices (Samuel: they discover them). An aven's first price for a good is any of these, in HEARTS a
 * unit; after that it moves its own price, from half to twice what it was when the day began, as often as it likes. The
 * levels hang on the day's first price, not the last answer: an aven asking many times a day (Qwen answers in seconds)
 * would otherwise compound its moves and run a price up a hundredfold in a morning. A score falls between levels, so any
 * price in between is possible. Liquid takes at most 10 levels a score question (more is a 422). */
const FIRST = [0.5, 1, 2, 4, 8, 15, 30, 60, 120, 250];
const MOVES = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.3, 1.6, 2];
/** the most an aven can pay a unit and still buy one day's need: no bid above what its HEARTS cover */
const afford = (a, g) => cents(Math.max(0.01, a.hearts) / Math.max(1, NEED[g]));
/** the price levels for one good, in HEARTS: around the aven's price as the day began, else the market's, else from
 * scratch; a buyer's never above what it can afford */
function priceLevels(world, a, g, side) {
	const book = side === 'ask' ? a.ask : a.bid;
	const day = (a.dayStart ??= { day: -1, ask: {}, bid: {} });
	if (day.day !== world.day) Object.assign(day, { day: world.day, ask: { ...a.ask }, bid: { ...a.bid } });
	const mine = (day[side][g] ??= book[g]); // a first price named today is the day's anchor from then on
	const base = mine ?? world.market[g].price;
	const top = side === 'bid' ? afford(a, g) : Infinity;
	const cap = (p) => cents(Math.min(p, top));
	if (base == null) {
		const levels = FIRST.map(cap);
		return { levels, criteria: levels.map((p, i) => `${p} HEARTS a unit${FIRST[i] > top ? ' (all my HEARTS can pay)' : ''}`) };
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

/** the live market board as an aven sees it: per good, the price, how much is offered and wanted, and by whom */
export function boardFor(world) {
	return Object.fromEntries(
		GOODS.map((g) => {
			const m = world.market[g];
			// the last week: the market price each evening and the average actually traded each day
			const days = world.stats.slice(-HISTORY_DAYS);
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

/** the state an aven decides on: its own books and what it can see of the valley — nothing else */
export function stateFor(world, a) {
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
	const days = Object.fromEntries(GOODS.map((g) => [g, NEED[g] ? Math.floor(a.stock[g] / NEED[g]) : null]));
	const buys = GOODS.filter((g) => !a.grows.includes(g));
	const priced = buys.every((g) => world.market[g].price != null);
	const cost = priced ? buys.reduce((n, g) => n + NEED[g] * world.market[g].price, 0) : 0;
	return {
		days_my_stock_lasts: days,
		short_tonight_unless_i_buy: Object.fromEntries(GOODS.filter((g) => a.stock[g] < NEED[g]).map((g) => [g, NEED[g] - a.stock[g]])),
		water_reserve: `${Math.round(a.body.water)} of 100; at 0 I die. With no water at all I last ${RULES.waterDays} days`,
		food_reserve: `${Math.round(a.body.food)} of 100; at 0 I die. With no food at all I last ${RULES.foodDays} days`,
		cost_of_one_day_of_what_i_must_buy_at_market_price: priced ? Math.round(cost * 100) / 100 : 'not known yet: some of it has never been traded',
		days_my_hearts_last_at_that_cost: cost ? Math.floor(a.hearts / cost) : null
	};
}

/** the typed questions for one aven this morning */
export function questionsFor(world, a, { full = true, writes = false } = {}) {
	const q = {};
	a.brain.levels = {}; // the price levels asked, so the answer is read against the same ones
	for (const g of a.grows) {
		const m = world.market[g];
		const sold = a.yesterday ? a.yesterday.sold[g] : 0;
		const lv = priceLevels(world, a, g, 'ask');
		a.brain.levels[`ask_${g}`] = lv.levels;
		q[`ask_${g}`] = {
			type: 'score',
			instructions: `You grow ${GOOD_LABEL[g]} and hold ${a.stock[g]} (you need ${NEED[g]} a day yourself and can spare ${spare(a, g)}). ${m.price == null ? 'Nobody has traded it yet, so there is no market price: name your own' : `Its market price (the average traded over the last day) is ${m.price} HEARTS`}; right now ${m.supply} are offered and ${m.demand} wanted across the valley (see the market's 7-day history and what the other sellers ask). Yesterday you sold ${sold}${ROT[g] ? `; ${Math.round(ROT[g] * 100)}% of what you keep rots each night, so unsold stock is lost` : '; it keeps'}. Price it yourself to earn the most HEARTS: high when it is scarce and wanted, low enough to sell before it rots and at a price buyers can afford.${inCharacter(a, 'greed')} What should your selling price for ${GOOD_LABEL[g]} be?`,
			criteria: lv.criteria
		};
	}
	for (const g of GOODS) {
		if (a.grows.includes(g)) continue;
		const m = world.market[g];
		const lv = priceLevels(world, a, g, 'bid');
		a.brain.levels[`bid_${g}`] = lv.levels;
		q[`bid_${g}`] = {
			type: 'score',
			instructions: `You don't grow ${GOOD_LABEL[g]} and must buy it: you need ${NEED[g]} a day, hold ${a.stock[g]} (${a.stock[g] < NEED[g] ? `short by ${NEED[g] - a.stock[g]} tonight unless you buy` : `enough for ${Math.floor(a.stock[g] / NEED[g])} days`}) and want ${want(a, g)} more${ROT[g] ? `; ${Math.round(ROT[g] * 100)}% of a stock rots each night` : ''}. ${deadline(a, g)} You hold ${Math.round(a.hearts)} HEARTS. ${m.price == null ? 'Nobody has traded it yet, so there is no market price' : `Its market price (the average traded over the last day) is ${m.price}`}; ${m.supply} are offered and ${m.demand} wanted (see the 7-day history and what sellers ask). Survival first, then keep the most HEARTS: pay up when you are about to go short, pay little when you are well stocked.${inCharacter(a, 'thrift')} What is the most you should pay for ${GOOD_LABEL[g]}?`,
			criteria: lv.criteria
		};
	}
	// the slower decisions (haggling, stock) only on a full ask: every ask carries the whole state once per question, so
	// fewer questions is fewer tokens. Where to walk is no decision: a buyer walks to fetch what it bought (Samuel).
	if (full) q.flex = { type: 'score', instructions: `When a buyer's limit and a seller's price don't meet, how far should you give in to strike the deal?${inCharacter(a, 'haggle')}`, criteria: gives() };
	// how much stock it keeps is no longer asked every morning: it is the aven's wants, in its brain, changed by its
	// trials (scored by the game) and by the admin's edits. After a stretch is measured, a full ask also picks the next
	// trial, and a brain that writes adds a lesson (mind.js).
	if (full) Object.assign(q, mindQuestions(a, { writes }));
	return q;
}

/** ask Liquid, through our API's relay when `relay` is given (browsers can't reach Liquid directly); resolves to the
 * answers object or throws */
export async function askLiquid(state, all, { signal, relay } = {}) {
	const questions = typedOnly(all);
	const res = await fetch(relay ?? LIQUID_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(relay ? { state, questions } : { model: LIQUID_MODEL, state, questions }),
		signal
	});
	if (!res.ok) {
		const err = await res.json().catch(() => null);
		const detail = err?.detail ? `: ${(typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)).slice(0, 200)}` : '';
		throw new Error(`${relay ? 'relay' : 'Liquid'} ${res.status}${err?.error ? ` ${err.error}` : ''}${detail}`);
	}
	const body = await res.json();
	if (!body?.answers) throw new Error('Liquid sent no answers');
	return body.answers;
}

/** the questions a decision model answers: it picks among options, it writes no text */
const typedOnly = (questions) => Object.fromEntries(Object.entries(questions).filter(([, q]) => q.type !== 'text'));

/** apply one morning's answers to an aven's ledger of prices */
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
			const f = Math.round(factorOf(ans.score, flexes()) * 100) / 100;
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

// ---- Samuel's GPU machine: d1 and Qwen (his tailnet only) ----

/** where it listens (Tailscale, plain http, OpenAI-style /v1); d1's and Qwen's addresses are changeable on the page */
export const BOX_URL = 'http://100.96.61.57:8000/v1';
/** only a studio on a device in Samuel's tailnet (or a local dev page) can reach it: never the public site */
export const BOX_HERE = native() || import.meta.env.DEV;

const base = (/** @type {string} */ url) => url.trim().replace(/\/+$/, '');

/** one call to it: natively from the studio (the page may not call plain http itself), else straight from a dev page */
async function boxCall(url, body, signal) {
	const fail = (status, out) => {
		// FastAPI (d1's server, sglang) says what was wrong as detail: [{ loc, msg }], after an echo of the whole request
		const detail = Array.isArray(out?.detail) ? out.detail.map((d) => `${(d?.loc ?? []).slice(1).join('.')}: ${d?.msg ?? ''}`).join('; ') : out?.detail;
		const why = out?.error?.message ?? (typeof out?.error === 'string' ? out.error : detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '');
		return new Error(`the GPU machine ${status}${why ? `: ${String(why).slice(0, 200)}` : ''}`);
	};
	if (native()) {
		const res = await command('brain', { url, body: body ?? null });
		if (res.status >= 400) throw fail(res.status, res.body);
		return res.body;
	}
	const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal } : { signal });
	const out = await res.json().catch(() => null);
	if (!res.ok) throw fail(res.status, out);
	return out;
}

const lists = new Map(); // base url -> the models it serves
/** the models it serves; reaching it is also how the page knows this device is in the tailnet
 * @param {string} url @param {AbortSignal} [signal] @returns {Promise<string[]>} */
export async function boxModels(url, signal) {
	const b = base(url);
	if (!lists.has(b)) lists.set(b, ((await boxCall(`${b}/models`, null, signal))?.data ?? []).map((m) => String(m.id)));
	return lists.get(b);
}
/** where a model may be: the address given, and the same machine's other brain port (Samuel runs Qwen on :8000 and
 * d1's llama-server on :8001)
 * @param {string} url @returns {string[]} */
export function boxBases(url) {
	const b = base(url);
	const m = b.match(/^(https?:\/\/[^/]+?):(\d+)(\/.*)?$/);
	if (!m) return [b];
	return [...new Set([b, ...['8000', '8001'].map((p) => `${m[1]}:${p}${m[3] ?? ''}`)])];
}
const away = new Map(); // base url -> until when not to try it again (it did not answer)
/** the model wanted ('d1' or 'qwen') and the address that serves it, or throws
 * @param {string} url @param {'d1' | 'qwen'} want @param {AbortSignal} [signal] @returns {Promise<{ base: string, id: string }>} */
export async function boxModel(url, want, signal) {
	const seen = [];
	for (const b of boxBases(url)) {
		if ((away.get(b) ?? 0) > Date.now()) continue;
		let list;
		try {
			list = await boxModels(b, signal);
		} catch (e) {
			if (b === base(url)) throw e;
			away.set(b, Date.now() + 60000);
			continue;
		}
		const id = list.find((m) => new RegExp(want, 'i').test(m));
		if (id) return { base: b, id };
		lists.delete(b); // it may serve it soon: ask again next time
		seen.push(...list);
	}
	throw new Error(`no ${want === 'd1' ? 'd1' : 'Qwen'} at ${boxBases(url).join(' or ')} (they serve ${seen.join(', ') || 'nothing'})`);
}

const chatOnly = new Set(); // bases whose server has no decision API
const missing = new Set(); // decision routes a server does not have

/**
 * ask the GPU machine the same typed questions. d1 takes them as they are, on the decision API (llama-server's
 * /v1/systemone, the request Liquid's hosted d1 takes). Qwen, or a server without that API, gets them as a chat: each
 * score question a pick among its numbered levels, each choice question a pick among its keys, in one JSON object
 * (structured output where the server has it). Resolves to answers shaped like Liquid's, or throws.
 * @param {any} state @param {any} questions @param {{ signal?: AbortSignal, url?: string, want?: 'd1' | 'qwen' }} [opts]
 */
export async function askBox(state, questions, { signal, url = BOX_URL, want = 'd1' } = {}) {
	const { base: b, id: model } = await boxModel(url, want, signal);
	if (/d1/i.test(model) && !chatOnly.has(b)) {
		// Samuel's d1 server (FastAPI, :8001) answers POST /decide { state as text, questions } with { answer: { answers } };
		// llama-server answers /v1/systemone with Liquid's own body. Whichever this one has, else the chat.
		const routes = [
			[`${b.replace(/\/v1$/, '')}/decide`, { state: JSON.stringify(state), questions: typedOnly(questions) }],
			[`${b}/systemone`, { model, state, questions: typedOnly(questions) }]
		];
		for (const [at, body] of routes) {
			if (missing.has(at)) continue;
			try {
				const out = await boxCall(at, body, signal);
				const answers = out?.answer?.answers ?? out?.answers;
				if (!answers) throw new Error('local d1 sent no answers');
				return answers;
			} catch (e) {
				if (!/ 40[45]\b/.test(e?.message)) throw e;
				missing.add(at); // not served here: don't ask it again
			}
		}
		chatOnly.add(b); // no decision API here: the chat it is, from now on
	}
	const keys = Object.keys(questions);
	const options = (q) => (q.type === 'score' ? Object.fromEntries(q.criteria.map((c, i) => [i, c])) : q.type === 'text' ? 'write it' : q.criteria);
	const schema = {
		type: 'object',
		properties: Object.fromEntries(keys.map((k) => [k, questions[k].type === 'score' ? { type: 'integer', enum: questions[k].criteria.map((_, i) => i) } : questions[k].type === 'text' ? { type: 'string', maxLength: 120 } : { type: 'string', enum: Object.keys(questions[k].criteria) }])),
		required: keys,
		additionalProperties: false
	};
	const body = {
		model,
		messages: [
			{ role: 'system', content: `You decide for ${state.me}, one of the avens in a trading game. Read its state, then answer every question by picking the option that serves it best: survive first, then end with the most HEARTS. Act as the character in my_brain, and learn from its trials, lessons and deaths. Reply with one JSON object only: for each question key, the number or key of the option you pick (or, where asked to write, a short text). /no_think` },
			{ role: 'user', content: JSON.stringify({ state, questions: Object.fromEntries(keys.map((k) => [k, { question: questions[k].instructions, options: options(questions[k]) }])) }) }
		],
		temperature: 0.3,
		max_tokens: 400,
		chat_template_kwargs: { enable_thinking: false }
	};
	let out;
	try {
		out = await boxCall(`${b}/chat/completions`, { ...body, response_format: { type: 'json_schema', json_schema: { name: 'answers', schema, strict: true } } }, signal);
	} catch (e) {
		// a server without structured output says 400 (or 422): ask again, the JSON asked for in words
		if (!/ 4(00|22)\b/.test(e?.message)) throw e;
		out = await boxCall(`${b}/chat/completions`, body, signal);
	}
	const text = String(out?.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
	const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
	let picks;
	try {
		picks = JSON.parse(json);
	} catch {
		throw new Error(`${want === 'd1' ? 'd1' : 'Qwen'} sent no JSON: ${text.slice(0, 80)}`);
	}
	const answers = {};
	for (const k of keys) {
		const q = questions[k];
		const v = picks?.[k];
		if (q.type === 'score' && Number.isFinite(Number(v))) answers[k] = { score: Math.max(0, Math.min(q.criteria.length - 1, Number(v))) };
		else if (q.type === 'choice' && v != null && String(v) in q.criteria) answers[k] = { choice: String(v) };
		else if (q.type === 'text' && typeof v === 'string') answers[k] = { text: v.slice(0, 120) };
	}
	if (!Object.keys(answers).length) throw new Error(`${want === 'd1' ? 'd1' : 'Qwen'} picked no option`);
	return answers;
}
