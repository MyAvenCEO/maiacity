// @ts-nocheck — plain JS game state, kept loose on purpose
// Each aven's mind. Every morning it looks at its own ledger and the valley and decides, per good, whether to move its
// asking price (what it grows) and its limit (what it buys), and how many days of food to keep in stock.
// The decisions come from Liquid's decision model d1:free (TypeSafe System One API): typed questions, answered with
// calibrated probabilities. d1:free needs no API key, but Liquid keeps its requests for training, so only the game
// state goes out, never anything about a person. There is no rule-based stand-in (Samuel): without a brain's answers the
// valley waits. Since 2026-10-09 the avens think on Samuel's own GPU machine, reached over Tailscale from his studio:
// d1 itself (LiquidAI-d1-3b, the same decision API) by default, and Qwen, fast, when d1 can't (Samuel). Qwen answers the
// same typed questions through its OpenAI-style chat. Liquid's hosted d1:free stays as a choice.

// what a brain sees and is asked, and how its answers are read: the Brains card's code (asks.js)
export { boardFor, stateFor, questionsFor, promptFor, applyAnswers } from './asks.js';
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
 * `system`: what the chat model is told first (the Brains card's `prompt` hook, asks.js promptFor).
 * @param {any} state @param {any} questions @param {{ signal?: AbortSignal, url?: string, want?: 'd1' | 'qwen', system?: string }} [opts]
 */
export async function askBox(state, questions, { signal, url = BOX_URL, want = 'd1', system } = {}) {
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
			{ role: 'system', content: system ?? `You decide for ${state.me}, one of the avens in a trading game. Answer every question by picking an option. Reply with one JSON object only. /no_think` },
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
