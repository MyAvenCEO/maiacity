// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE LOGIC CORE — the one way code we cannot trust decides anything: a game rule (Sandbox 7's card code), a view's
 * logic (Generated UI), an avenDB function. Whoever wrote it, a person, an agent or an aven, it runs here, in its own
 * QuickJS engine (quickjs-emscripten, compiled to WebAssembly), and nowhere else.
 *
 * - The engine has no page, no network, no keys, no storage and no clock to wait on: only the language. What a call
 *   is given crosses as one JSON text, parsed inside; what it hands back crosses the same way.
 * - Binary buffers are taken out (logic works on numbers and text), so the quickest way past the memory limit is gone,
 *   and the memory the wasm grows by is checked on every interrupt as well.
 * - Deterministic: `Math.random` is a generator seeded by the caller and `Date` is frozen at the caller's `now`, so
 *   the same code given the same input hands back the same answer on every device (a rule that two devices judge
 *   differently would show them two different worlds).
 * - Bounded by work, not by time: a call may run `ticks` of QuickJS's interrupt checks (one about every few thousand
 *   steps of a loop), counted the same on every device; the clock is only a backstop, set well past what that work
 *   takes, for built-in calls that do much work between checks (the one known gap: such a call is stopped by time).
 *
 * It is plain JS with no page in it: the logic host's worker runs it (./logic-engine.js, inside the shell of
 * ./frame.js), and so do our scripts and tests.
 */

/**
 * What one engine may use: memory and stack, and for loading the code and for each call the work it may do (ticks)
 * and the time past which it is stopped anyway (ms).
 */
export const LIMITS = { memory: 8 << 20, stack: 256 << 10, load: { ticks: 800, ms: 2000 }, call: { ticks: 120, ms: 250 } };

let lib = null;
/** a fresh QuickJS module (its own wasm memory); the library is loaded once, on first use (one file of about 1 MB) */
export async function quickjs() {
	lib ??= Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-singlefile-browser-release-sync')]);
	const [core, variant] = await lib;
	return core.newQuickJSWASMModuleFromVariant(variant.default);
}

/** Logic works on numbers and text: no binary buffers, no weak references. */
export const BARE = `for (const k of ['ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'WeakRef', 'FinalizationRegistry', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array']) delete globalThis[k];`;

/**
 * The same answer on every device: `Math.random` seeded with `seed` (mulberry32), `Date` frozen at `now` (ms since
 * 1970; `new Date(x)` still reads any date it is given).
 * @param {number} seed @param {number} now
 */
export const steady = (seed, now) => `(() => {
	let a = ${seed >>> 0};
	const random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
	Object.defineProperty(Math, 'random', { value: random, writable: false, configurable: false });
	const D = Date, at = ${Number.isFinite(now) ? Math.trunc(now) : 0};
	const Steady = function Date(...a) { if (!new.target) return new D(at).toString(); return a.length ? new D(...a) : new D(at); };
	Object.defineProperties(Steady, { now: { value: () => at }, UTC: { value: D.UTC }, parse: { value: D.parse }, prototype: { value: D.prototype } });
	Object.defineProperty(D.prototype, 'constructor', { value: Steady, writable: false, configurable: false });
	Object.defineProperty(globalThis, 'Date', { value: Steady, writable: false, configurable: false });
})();`;

/**
 * How a call crosses into the engine, by its kind: each a function evaluated in the engine, given the exported
 * function and one JSON text, handing back JSON text (or nothing).
 * - `call`: f(input) (an avenDB function's `run(event)`, a check);
 * - `see` / `hook`: Sandbox 7's valley, set once a night (`see`), then each hook given its arguments with the valley;
 * - `view`: a view's `init(data)` / `on(event, data)`.
 */
export const GLUE = {
	call: '(f, s) => { const r = f(JSON.parse(s)); return r === undefined ? undefined : JSON.stringify(r); }',
	see: '(f, s) => { globalThis.valley = JSON.parse(s); }',
	hook: '(f, s) => { const x = JSON.parse(s); x.valley = globalThis.valley; const r = f(x); return r === undefined ? undefined : JSON.stringify(r); }',
	view: '(f, s) => { const x = JSON.parse(s); const r = x.on ? f(x.e, x.d) : f(x.d); return r === undefined ? undefined : JSON.stringify(r); }'
};
const NAMES = '(m) => JSON.stringify(Object.keys(m).filter((k) => typeof m[k] === "function"))';

const message = (e) => (e && typeof e === 'object' ? `${e.name ?? 'Error'}: ${e.message ?? JSON.stringify(e)}` : String(e));

/** An FNV-1a hash of a text, as a seed: the same input, the same seed. @param {string} s */
export function seedOf(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/**
 * Code `code` (a JS module) loaded into an engine of its own, in QuickJS module `QJS` (./logic.js `quickjs`):
 * `{ exports, error, call(kind, name, json), ticks, dispose }`. `exports` names the functions it exports; `error` says
 * why it did not load. `call` runs export `name` (`null` for the glue alone) the way `kind` says (GLUE), handing back
 * its JSON text (undefined for nothing), or throws why it was stopped.
 * @param {any} QJS
 * @param {{ code: string, file?: string, seed?: number, now?: number, limits?: typeof LIMITS }} o
 */
export function open(QJS, { code, file = 'code.js', seed = 0, now = 0, limits = LIMITS }) {
	const unit = { exports: [], error: '', calls: 0, ticks: 0, call: null, dispose: null };
	const handles = [];
	let rt, vm;
	try {
		rt = QJS.newRuntime();
		rt.setMemoryLimit(limits.memory);
		rt.setMaxStackSize(limits.stack);
		// a call stops when its work is done, its time is up, or the engine grew by more than its memory (big buffers
		// slip past the limit QuickJS keeps itself)
		const wasm = () => QJS.getWasmMemory().buffer.byteLength;
		let [ticks, budget, deadline, ceiling, ms, why] = [0, 0, 0, 0, 0, ''];
		const arm = (b) => {
			[ticks, budget, ms, why] = [0, b.ticks, b.ms, ''];
			[deadline, ceiling] = [Date.now() + b.ms, wasm() + limits.memory];
		};
		rt.setInterruptHandler(() => {
			ticks += 1;
			if (ticks > budget) why = 'ran too long';
			else if (wasm() > ceiling) why = `took more than ${limits.memory >> 20} MB`;
			else if (Date.now() > deadline) why = `ran longer than ${ms} ms`;
			return Boolean(why);
		});
		const stopped = (e) => (wasm() > ceiling ? `took more than ${limits.memory >> 20} MB` : e?.message === 'interrupted' ? why || 'ran too long' : message(e));
		vm = rt.newContext();
		const keep = (h) => (handles.push(h), h);
		const evaluate = (src, name, type) => {
			arm(limits.load);
			const r = vm.evalCode(src, name, { type });
			if (r.error) {
				const e = vm.dump(r.error);
				r.error.dispose();
				throw new Error(stopped(e));
			}
			return keep(r.value);
		};
		evaluate(BARE, 'bare.js', 'global');
		evaluate(steady(seed, now), 'steady.js', 'global');
		const exports = evaluate(code, file, 'module');
		const glue = Object.fromEntries(Object.entries(GLUE).map(([k, src]) => [k, evaluate(src, `${k}.js`, 'global')]));
		const names = evaluate(NAMES, 'names.js', 'global');
		const listed = vm.callFunction(names, vm.undefined, exports);
		if (listed.error) {
			const e = vm.dump(listed.error);
			listed.error.dispose();
			throw new Error(message(e));
		}
		unit.exports = JSON.parse(vm.getString(listed.value));
		listed.value.dispose();
		const fns = Object.fromEntries(unit.exports.map((n) => [n, keep(vm.getProp(exports, n))]));
		unit.call = (kind, name, json) => {
			if (!glue[kind]) throw new Error(`no way to call ${kind}`);
			if (name != null && !fns[name]) throw new Error(`it exports no ${name}`);
			arm(limits.call);
			const s = vm.newString(json);
			const r = vm.callFunction(glue[kind], vm.undefined, name == null ? vm.undefined : fns[name], s);
			s.dispose();
			unit.calls += 1;
			unit.ticks += ticks;
			if (r.error) {
				const e = vm.dump(r.error);
				r.error.dispose();
				throw new Error(stopped(e));
			}
			if (wasm() > ceiling) {
				r.value.dispose();
				throw new Error(stopped());
			}
			const out = vm.typeof(r.value) === 'string' ? vm.getString(r.value) : undefined;
			r.value.dispose();
			return out;
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
