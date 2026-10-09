// A relay to Liquid's decision model for Sandbox 7 (the avens' brains). Browsers can't call api.liquid.ai themselves
// (it sends no CORS headers), so the page posts its typed questions here and this forwards them, unchanged, to the free
// model d1:free. With LIQUID_API_KEY set (a GitHub secret, into this container's env by the deploy; never in a page or
// on a Mac) it goes along as the bearer token. Liquid keeps d1:free requests for training, so this only ever forwards
// game state: it checks the shape and size and passes nothing else on.

const LIQUID_URL = 'https://api.liquid.ai/decisions/v1/systemone';
const MODEL = 'd1:free';
const MAX_BYTES = 64 * 1024;
const PER_MINUTE = 240; // per client address: ten avens re-deciding every few seconds fit inside this

/** @type {Map<string, { n: number, since: number }>} */
const seen = new Map();

/** @param {string} who */
function tooMany(who) {
	const now = Date.now();
	const s = seen.get(who);
	if (!s || now - s.since > 60_000) {
		seen.set(who, { n: 1, since: now });
		if (seen.size > 5000) for (const [k, v] of seen) if (now - v.since > 60_000) seen.delete(k);
		return false;
	}
	s.n += 1;
	return s.n > PER_MINUTE;
}

/**
 * Forward one decision request.
 * @param {Request} req
 * @param {string} who the client's address, for the rate limit
 * @returns {Promise<{ status: number, body: unknown }>}
 */
export async function relayDecision(req, who) {
	if (tooMany(who)) return { status: 429, body: { error: 'too many decisions, wait a minute' } };
	const text = await req.text();
	if (text.length > MAX_BYTES) return { status: 413, body: { error: 'request too large' } };
	/** @type {any} */
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		return { status: 400, body: { error: 'not JSON' } };
	}
	const { state, questions } = body ?? {};
	if (!state || typeof state !== 'object' || !questions || typeof questions !== 'object' || !Object.keys(questions).length) {
		return { status: 400, body: { error: 'needs state and questions' } };
	}
	try {
		const res = await fetch(LIQUID_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...(process.env.LIQUID_API_KEY ? { Authorization: `Bearer ${process.env.LIQUID_API_KEY}` } : {}) },
			body: JSON.stringify({ model: MODEL, state, questions }),
			signal: AbortSignal.timeout(25_000)
		});
		const out = await res.json().catch(() => null);
		if (!res.ok) return { status: 502, body: { error: `Liquid ${res.status}`, detail: out?.detail ?? out?.error ?? null } };
		if (!out?.answers) return { status: 502, body: { error: 'Liquid sent no answers' } };
		return { status: 200, body: { answers: out.answers } };
	} catch (e) {
		return { status: 504, body: { error: e?.name === 'TimeoutError' ? 'Liquid timed out' : 'Liquid unreachable' } };
	}
}
