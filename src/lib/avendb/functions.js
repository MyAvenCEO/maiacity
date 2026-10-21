// @ts-nocheck — plain JS, kept loose on purpose, as the other logic of ours is ($lib/sandbox/view-logic.js)
// A database function in a box: avenDB's own `function` schema holds its code, a JS module that exports
// `run(event)`, given plain JSON, handing back the ops it would make as plain JSON. It runs by the logic host
// ($lib/sandbox/logic-host.js): a fresh QuickJS engine for each call, in a sealed worker, with the core's limits and
// its deterministic profile (its random seeded by the event, its clock the event's `now`), so every device that runs
// it hands back the same ops: no page, no network, no keys, no clock to wait on. Before it loads, the one checker
// (game/code/check.js `function`) reads its code as it reads a logic module's: one that imports, requires or exports
// no run(event) never runs. What it hands back is only asked for: the device that runs it holds every op to what a
// function may ask (./flows.js `bound`) and to what the acting vault may do, and a call that loops, eats its memory or
// throws makes nothing.

import { checkCode } from '../../../game/code/check.js';
import { LIMITS, seedOf } from '../sandbox/logic.js';
import { runOnce } from '../sandbox/logic-host.js';

/** How long one run may take at most, and how much memory it may use. */
export const RUN = { ms: LIMITS.call.ms, mb: LIMITS.memory / (1 << 20) };

/**
 * Why the one checker refuses function code `code`, in its sentences, or '' where it passes: what refuses it to run.
 * @param {string} code
 */
export function refusal(code) {
	const c = checkCode('function', code);
	return c.ok ? '' : c.errors.join(' ');
}

/**
 * Runs function code `code` on `event`: `{ ops }`, the ops it hands back (none where it hands back nothing), or
 * `{ ops: [], error }` where the checker refuses it (`refusal`), it doesn't load, throws, runs too long or hands back
 * anything but a list of ops. It runs on the logic engine its record names (`engine`, `{ host, version }`), never one
 * below the floor ($lib/sandbox/engines.js `engineFor`); one that names none runs on the floor, one made for another
 * host runs nowhere.
 * @param {string} code @param {object} event @param {{ host?: string, version?: number }} [engine]
 * @returns {Promise<{ ops: object[], error?: string }>}
 */
export async function runFunction(code, event, engine) {
	if (code == null || (typeof code === 'string' && !code.trim())) return { ops: [] };
	if (engine != null && engine.host !== 'logic') return { ops: [], error: `it is made for the ${String(engine.host).slice(0, 12)} engine, not the logic engine` };
	const refused = refusal(code);
	if (refused) return { ops: [], error: refused };
	// what crosses is one string, parsed inside the engine: nothing of the page goes in
	const json = JSON.stringify(event);
	const now = Number.isFinite(event?.now) ? event.now * 1000 : 0;
	const { out, error } = await runOnce({ code, file: 'function.js', kind: 'call', name: 'run', json, seed: seedOf(json), now, engine: engine?.version });
	if (error) return { ops: [], error: error === 'it exports no run' ? 'it exports no run(event)' : error };
	if (out === undefined) return { ops: [] };
	const ops = JSON.parse(out);
	const fine = Array.isArray(ops) && ops.every((o) => o && typeof o === 'object' && typeof o.op === 'string');
	return fine ? { ops } : { ops: [], error: 'run(event) must hand back a list of ops' };
}
