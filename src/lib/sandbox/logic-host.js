// @ts-nocheck — plain JS
/*
 * THE LOGIC HOST — how the page runs logic we cannot trust (a view's logic, an avenDB function; Sandbox 7's rules
 * move here with its valley): the logic core (./logic.js) in the logic engine (./logic-engine.js), in the shell's
 * worker (./frame.js). Two walls: QuickJS, then a worker in a frame with no origin, no connection and nothing of
 * ours in reach; and never on the page's thread, so a call that runs long cannot hold the page.
 *
 * Outside a page (our scripts and tests) there is no frame to make, and the core runs in the process itself.
 *
 *   runOnce({ code, kind, name, json, seed?, now? })   code loaded, called once and gone: { exports, out?, error? }
 *   load(units, { seed?, now? })                        code kept loaded: { units, call(i, kind, name, json), end() }
 */
import { open, quickjs } from './logic.js';
import { latestOf, pathOf } from './engines.js';

/** how long one job may hold the shell before it is torn down (ms): far past the core's own limits */
const TIMEOUT = 10000;

let shell = null;
/** the page's one logic shell, started on first use */
async function shellOf() {
	if (shell) return shell;
	const { Shell, frozen } = await import('./frame.js');
	const e = latestOf('logic');
	if (!e) throw new Error('no logic engine is frozen yet');
	shell ??= new Shell({ code: () => frozen(pathOf('logic', e.v), e.blake3, `logic engine ${e.v}`), wasm: true, timeout: TIMEOUT });
	return shell;
}

const inPage = () => typeof document !== 'undefined' && typeof window !== 'undefined';

/**
 * Code `code` loaded, export `name` called once the way `kind` says (./logic.js GLUE) with JSON text `json`, and the
 * engine gone: `{ exports, out }` (out: the JSON text it handed back, or undefined), or `{ exports, error }`.
 * @param {{ code: string, file?: string, kind: string, name: string | null, json: string, seed?: number, now?: number }} o
 * @returns {Promise<{ exports: string[], out?: string, error?: string }>}
 */
export async function runOnce(o) {
	if (inPage()) {
		try {
			const { exports, out, error } = await (await shellOf()).ask('run', o);
			return error ? { exports, error } : { exports, out };
		} catch (e) {
			return { exports: [], error: e.message || String(e) };
		}
	}
	const unit = open(await quickjs(), o);
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
 * `end()`. All share `seed` and `now`.
 * @param {{ code: string, file?: string }[]} units @param {{ seed?: number, now?: number }} [o]
 */
export async function load(units, { seed = 0, now = 0 } = {}) {
	if (inPage()) {
		const s = await shellOf();
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
