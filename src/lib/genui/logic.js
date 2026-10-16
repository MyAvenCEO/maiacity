// @ts-nocheck — plain JS, kept loose on purpose
// A declarative view's logic, run by the logic host ($lib/sandbox/logic-host.js): QuickJS in a sealed worker, with
// the core's limits and its deterministic profile, never on the page's thread. The code (a JS module) may export
// `init(data)` and `on(event, data)`; each is given plain JSON and hands back the view's whole new data model as plain
// JSON. It has no page, no network, no keys, no clock to wait on; a call that loops, eats its memory or throws is
// stopped and the view keeps the data it had.

import { load } from '../sandbox/logic-host.js';
import { seedOf } from '../sandbox/logic.js';

/**
 * Load a view's logic: { init(data), on(event, data), dispose() }, each call answering (in time) the new data, or the
 * old one and an error. Without logic both simply hand the data back.
 */
export async function loadLogic(code) {
	const none = { init: async (d) => ({ data: d }), on: async (e, d) => ({ data: d }), dispose() {} };
	if (!code?.trim()) return none;
	let program;
	try {
		program = await load([{ code, file: 'view.js' }], { seed: seedOf(code), now: Date.now() });
	} catch (e) {
		const error = e.message || String(e);
		return { init: async (d) => ({ data: d, error }), on: async (e, d) => ({ data: d, error }), dispose() {} };
	}
	const [{ exports, error: broken }] = program.units;
	const run = async (name, event, data) => {
		if (broken) return { data, error: broken };
		if (!exports.includes(name)) return { data };
		let out;
		try {
			// what crosses is one string, parsed inside the engine: nothing of the page goes in
			out = await program.call(0, 'view', name, JSON.stringify({ on: name === 'on', e: event ?? null, d: data }));
		} catch (e) {
			return { data, error: `${name}: ${e.message || String(e)}` };
		}
		if (out === undefined) return { data };
		const next = JSON.parse(out);
		if (!next || typeof next !== 'object' || Array.isArray(next)) return { data, error: `${name} must hand back the data model (an object).` };
		return { data: next };
	};
	return {
		init: (data) => run('init', null, data),
		on: (event, data) => run('on', event, data),
		dispose: () => program.end()
	};
}
