// @ts-nocheck — plain JS
/*
 * THE LOGIC HOST — how the page runs logic we cannot trust (a view's logic, an avenDB function): the logic
 * core (./logic.js) in the logic engine (./logic-engine.js), in the shell's
 * worker (./frame.js). Two walls: QuickJS, then a worker in a frame with no origin, no connection and nothing of
 * ours in reach; and never on the page's thread, so a call that runs long cannot hold the page.
 *
 * Outside a page (our scripts and tests) there is no frame to make, and the core runs in the process itself.
 *
 * Code runs on the logic engine it names (`engine`, a code entry's version: ./engines.js `engineFor`), never one below
 * the floor; code that names none runs on the floor. Each version has a shell of its own.
 *
 *   runOnce({ code, kind, name, json, seed?, now?, limits?, engine? })
 *                                                                 code loaded, called once and gone: { exports, out?, error? };
 *                                                                 `limits` held to the core's MOST (./logic.js `within`),
 *                                                                 from logic engine 2 on (engine 1 runs on the core's own)
 *   load(units, { seed?, now?, engine? })                        code kept loaded: { units, call(i, kind, name, json), end() }
 */
import { LIMITS, open, quickjs, within } from './logic.js';
import { engineFor } from './engines.js';
import { BUDGETS } from './policy.js';

/** how long one job may hold the shell before it is torn down (ms): far past the core's own limits */
const TIMEOUT = BUDGETS.logicJob;

/** why code naming logic engine `named` runs nowhere: one that is not frozen @param {unknown} named */
const notFrozen = (named) => `it is made for logic engine ${String(named).slice(0, 12)}, which this page does not have`;

/** the page's logic shells, one for each engine version that ran code, each started on first use */
const shells = new Map();
/** the shell of the logic engine code naming version `named` runs on @param {unknown} named */
async function shellOf(named) {
	const e = engineFor('logic', named);
	if (!e) throw new Error(notFrozen(named));
	if (!shells.has(e.v)) {
		const started = import('./frame.js').then(({ Shell, engineCode }) => new Shell({ code: () => engineCode('logic', e.v), wasm: true, timeout: TIMEOUT }));
		started.catch(() => shells.delete(e.v));
		shells.set(e.v, started);
	}
	return shells.get(e.v);
}

const inPage = () => typeof document !== 'undefined' && typeof window !== 'undefined';

/**
 * Code `code` loaded, export `name` called once the way `kind` says (./logic.js GLUE) with JSON text `json`, and the
 * engine gone: `{ exports, out }` (out: the JSON text it handed back, or undefined), or `{ exports, error }`.
 * @param {{ code: string, file?: string, kind: string, name: string | null, json: string, seed?: number, now?: number, limits?: object, engine?: number }} o
 * @returns {Promise<{ exports: string[], out?: string, error?: string }>}
 */
export async function runOnce({ engine, ...o }) {
	const e = engineFor('logic', engine);
	if (!e) return { exports: [], error: notFrozen(engine) };
	// what the run may use, as the engine it names takes it: engine 1 takes no limits of a run's own
	const limits = e.v >= 2 ? within(o.limits) : LIMITS;
	if (inPage()) {
		try {
			// the shell waits past the run's own backstops before it tears down
			const timeout = Math.max(TIMEOUT, 2 * (limits.load.ms + limits.call.ms));
			const { exports, out, error } = await (await shellOf(engine)).ask('run', { ...o, limits }, { timeout });
			return error ? { exports, error } : { exports, out };
		} catch (e) {
			return { exports: [], error: e.message || String(e) };
		}
	}
	const unit = open(await quickjs(), { ...o, limits });
	try {
		if (unit.error) return { exports: [], error: unit.error };
		if (o.name != null && !unit.exports.includes(o.name)) return { exports: unit.exports, error: `it exports no ${o.name}` };
		return { exports: unit.exports, out: unit.call(o.kind, o.name, o.json) };
	} catch (e) {
		return { exports: unit.exports, error: e.message || String(e) };
	} finally {
		unit.dispose();
	}
}

/**
 * Pieces of code, each a JS module, loaded and kept: `units` (each `{ exports, error }`), `call(i, kind, name, json)`
 * (unit `i`'s export `name`, the way `kind` says: the JSON text it hands back, or throws why it was stopped) and
 * `end()`. All share `seed` and `now`, and the engine `engine` names.
 * @param {{ code: string, file?: string }[]} units @param {{ seed?: number, now?: number, engine?: number }} [o]
 */
export async function load(units, { seed = 0, now = 0, engine } = {}) {
	if (!engineFor('logic', engine)) throw new Error(notFrozen(engine));
	if (inPage()) {
		const s = await shellOf(engine);
		const { session, units: loaded } = await s.ask('open', { units, seed, now });
		const generation = s.generation;
		return {
			units: loaded,
			async call(i, kind, name, json) {
				if (s.generation !== generation) throw new Error('its box was stopped');
				return (await s.ask('call', { session, unit: i, kind, name, json })).out;
			},
			end: () => (s.generation === generation && s.frame ? s.ask('end', { session }).catch(() => {}) : Promise.resolve())
		};
	}
	const QJS = await quickjs();
	const opened = units.map((u) => open(QJS, { ...u, seed, now }));
	return {
		units: opened.map((u) => ({ exports: u.exports, error: u.error })),
		async call(i, kind, name, json) {
			const u = opened[i];
			if (u.error) throw new Error(u.error);
			return u.call(kind, name, json);
		},
		end: async () => opened.forEach((u) => u.dispose())
	};
}
