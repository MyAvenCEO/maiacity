// @ts-nocheck — plain JS, kept loose on purpose
// Card code in a sandbox. A config card may carry JavaScript (its `code`), proposed by anyone, an agent over the MCP
// too, so it never runs in the page itself: each card gets its own QuickJS engine (quickjs-emscripten, compiled to
// WebAssembly) with no page, no network, no keys and no clock to wait on, 8 MB of memory and a few milliseconds a call.
// The code exports hooks (game/economy/params.js, HOOKS): every rule of the valley is one (Samuel, 2026-10-09: the
// whole rulebook is card code, each section card's own or its default, game/economy/rules-code.js). The valley calls
// each one at its moment with a copy of what it needs and takes back plain JSON. A card whose code throws, runs too
// long, eats its memory or answers nothing is stopped for the run and the valley goes on with its own value. Every load gets
// a fresh engine, dropped with the run, so whatever a card took is given back. Known gap: QuickJS checks the clock only
// every few thousand loop turns, so code doing a heavy built-in call in each turn can hold the valley for a few
// seconds before it is stopped, once; "Test the code" in the MIP form shows that before anyone accepts it.

import { HOOK_NAMES, HOOKS, fullCards } from '../../../game/economy/params.js';

/** a card's limits: memory, stack, time to load its code, time for one call */
export const LIMITS = { memory: 8 << 20, stack: 256 << 10, loadMs: 200, callMs: 25 };

let lib = null;
/** a fresh QuickJS engine; its code is loaded once, on first use (about 1 MB in one file, so the Mac app needs nothing more) */
async function quickjs() {
	lib ??= Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-singlefile-browser-release-sync')]);
	const [core, variant] = await lib;
	return core.newQuickJSWASMModuleFromVariant(variant.default);
}

// card code works on numbers: no binary buffers, the quickest way past the memory limit
const BARE = `for (const k of ['ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'WeakRef', 'FinalizationRegistry', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array']) delete globalThis[k];`
// inside each card's engine: what a hook is given is JSON, parsed there; the valley is set once a night
const SEE = '(s) => { globalThis.valley = JSON.parse(s); }';
const CALL = '(f, s) => { const x = JSON.parse(s); x.valley = globalThis.valley; const r = f(x); return r === undefined ? undefined : JSON.stringify(r); }';

const message = (e) => (e && typeof e === 'object' ? `${e.name ?? 'Error'}: ${e.message ?? JSON.stringify(e)}` : String(e));

/** one card's code, loaded into its own engine: the hooks it exports, and how to call them */
function load(QJS, card) {
	const unit = { id: card.id, name: card.name || card.id, hooks: [], error: '', calls: 0, ms: 0 };
	const handles = [];
	let rt, vm;
	try {
		rt = QJS.newRuntime();
		rt.setMemoryLimit(LIMITS.memory);
		rt.setMaxStackSize(LIMITS.stack);
		// a call stops when its time is up, or when the engine grew by more than a card's memory (big buffers slip past
		// the limit QuickJS keeps itself)
		const wasm = () => QJS.getWasmMemory().buffer.byteLength;
		let deadline = 0,
			ceiling = 0,
			ms = 0;
		const arm = (t) => ((ms = t), (deadline = Date.now() + t), (ceiling = wasm() + LIMITS.memory));
		const why = (e) => (wasm() > ceiling ? `took more than ${LIMITS.memory >> 20} MB` : e?.message === 'interrupted' ? `ran longer than ${ms} ms` : message(e));
		rt.setInterruptHandler(() => Date.now() > deadline || wasm() > ceiling);
		vm = rt.newContext();
		const keep = (h) => (handles.push(h), h);
		const evaluate = (code, file, type) => {
			arm(LIMITS.loadMs);
			const r = vm.evalCode(code, file, { type });
			if (r.error) {
				const e = vm.dump(r.error);
				r.error.dispose();
				throw new Error(why(e));
			}
			return keep(r.value);
		};
		evaluate(BARE, 'bare.js', 'global');
		const exports = evaluate(card.code, `${card.id}.js`, 'module');
		const see = evaluate(SEE, 'see.js', 'global');
		const call = evaluate(CALL, 'call.js', 'global');
		const fns = {};
		for (const name of HOOK_NAMES) {
			const f = keep(vm.getProp(exports, name));
			if (vm.typeof(f) === 'function') (fns[name] = f), unit.hooks.push(name);
		}
		const run = (fn, json, what) => {
			arm(LIMITS.callMs);
			const s = vm.newString(json);
			const r = fn === see ? vm.callFunction(see, vm.undefined, s) : vm.callFunction(call, vm.undefined, fn, s);
			s.dispose();
			if (r.error) {
				const e = vm.dump(r.error);
				r.error.dispose();
				throw new Error(`${what}: ${why(e)}`);
			}
			if (wasm() > ceiling) {
				r.value.dispose();
				throw new Error(`${what}: ${why()}`);
			}
			const type = vm.typeof(r.value);
			const v = type === 'number' ? vm.getNumber(r.value) : type === 'string' ? vm.getString(r.value) : undefined;
			r.value.dispose();
			return { type, v };
		};
		unit.see = (json) => run(see, json, 'reading the valley');
		unit.call = (name, json) => {
			const t = performance.now();
			const { type, v } = run(fns[name], json, name);
			unit.calls += 1;
			unit.ms += performance.now() - t;
			if (type !== 'string') throw new Error(`${name} answered nothing`);
			return JSON.parse(v);
		};
	} catch (e) {
		unit.error = e.message || String(e);
	}
	unit.dispose = () => {
		for (const h of handles) if (h.alive) h.dispose();
		vm?.dispose();
		rt?.dispose();
	};
	return unit;
}

/**
 * Load the code of every card, every section card with its rules' code (its own, else the default), in the config's
 * order. The valley then calls `see(valley)` once a night and `run(hook, args, value)` at each hook's moment: the card
 * that owns the rule first, then every other card exporting that hook, each given what the one before made of it.
 */
export async function loadCode(cards) {
	const coded = fullCards(cards).filter((c) => typeof c?.code === 'string' && c.code.trim());
	if (!coded.length) return null;
	const QJS = await quickjs();
	const units = coded.map((c) => load(QJS, c));
	const owner = Object.fromEntries(HOOKS.map((h) => [h.name, h.card]));
	const live = (name) => units.filter((u) => !u.error && u.hooks.includes(name)).sort((a, b) => (b.id === owner[name]) - (a.id === owner[name]));
	const fail = (u, e) => {
		u.error = e.message || String(e);
		u.failedAt = Date.now();
	};
	return {
		units,
		/** does any card (still) run this hook? */
		has: (name) => live(name).length > 0,
		/** tonight's valley, the same for every hook until the next */
		see(valley) {
			if (!units.some((u) => !u.error && u.hooks.length)) return;
			const json = JSON.stringify(valley);
			for (const u of units)
				if (!u.error && u.hooks.length)
					try {
						u.see(json);
					} catch (e) {
						fail(u, e);
					}
		},
		run(name, args, value) {
			for (const u of live(name))
				try {
					const v = u.call(name, JSON.stringify({ ...args, value }));
					if (v !== undefined) value = v;
				} catch (e) {
					fail(u, e);
				}
			return value;
		},
		/** what runs and what failed, for the page and the saved run */
		info: () => ({
			hooks: units.filter((u) => !u.error && u.hooks.length).map((u) => ({ card: u.id, name: u.name, hooks: [...u.hooks], calls: u.calls, ms: Math.round((u.ms / Math.max(1, u.calls)) * 1000) / 1000 })),
			errors: units.filter((u) => u.error).map((u) => ({ card: u.id, name: u.name, error: u.error }))
		}),
		dispose: () => units.forEach((u) => u.dispose())
	};
}

/**
 * Try one card's code before proposing it: load it, then call every hook it exports once with `sample` (built by the
 * valley from where it stands: sample[hook] = { aven, good?, value }). Each answer, or the error that stopped it.
 */
export async function testCard(card, valley, sample) {
	if (!card?.code?.trim()) return { hooks: [], error: 'This card has no code.' };
	const QJS = await quickjs();
	const u = load(QJS, card);
	try {
		if (u.error) return { hooks: [], error: u.error };
		if (!u.hooks.length) return { hooks: [], error: `It exports no hook: export one of ${HOOK_NAMES.join(', ')}.` };
		u.see(JSON.stringify(valley));
		return {
			hooks: u.hooks.map((name) => {
				const s = sample[name];
				try {
					return { name, good: s.good, value: JSON.stringify(s.value), answer: JSON.stringify(u.call(name, JSON.stringify(s))) };
				} catch (e) {
					const m = e.message || String(e);
					return { name, good: s.good, value: JSON.stringify(s.value), error: m.startsWith(`${name}: `) ? m.slice(name.length + 2) : m.startsWith(`${name} `) ? m.slice(name.length + 1) : m };
				}
			}),
			error: ''
		};
	} catch (e) {
		return { hooks: [], error: e.message || String(e) };
	} finally {
		u.dispose();
	}
}
