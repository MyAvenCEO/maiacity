// @ts-nocheck — plain JS, kept loose on purpose, as the other logic of ours is ($lib/genui/logic.js)
// A database function in a box: avenDB's own `function` schema holds its code, a JS module that exports
// `run(event)`, given plain JSON, handing back the ops it would make as plain JSON. It runs by the logic host
// ($lib/sandbox/logic-host.js): a fresh QuickJS engine for each call, in a sealed worker, with the core's limits and
// its deterministic profile (its random seeded by the event, its clock the event's `now`), so every device that runs
// it hands back the same ops: no page, no network, no keys, no clock to wait on. What it hands back is only asked for:
// the device that runs it checks every op against what the acting vault may do (./flows.js), and a call that loops,
// eats its memory or throws makes nothing.

import { LIMITS, seedOf } from '../sandbox/logic.js';
import { runOnce } from '../sandbox/logic-host.js';

/** How long one run may take at most, and how much memory it may use. */
export const RUN = { ms: LIMITS.call.ms, mb: LIMITS.memory / (1 << 20) };

/**
 * Runs function code `code` on `event`: `{ ops }`, the ops it hands back (none where it hands back nothing), or
 * `{ ops: [], error }` where it doesn't load, throws, runs too long or hands back anything but a list of ops.
 * @param {string} code @param {object} event @returns {Promise<{ ops: object[], error?: string }>}
 */
export async function runFunction(code, event) {
	if (!code?.trim()) return { ops: [] };
	// what crosses is one string, parsed inside the engine: nothing of the page goes in
	const json = JSON.stringify(event);
	const now = Number.isFinite(event?.now) ? event.now * 1000 : 0;
	const { out, error } = await runOnce({ code, file: 'function.js', kind: 'call', name: 'run', json, seed: seedOf(json), now });
	if (error) return { ops: [], error: error === 'it exports no run' ? 'it exports no run(event)' : error };
	if (out === undefined) return { ops: [] };
	const ops = JSON.parse(out);
	const fine = Array.isArray(ops) && ops.every((o) => o && typeof o === 'object' && typeof o.op === 'string');
	return fine ? { ops } : { ops: [], error: 'run(event) must hand back a list of ops' };
}
