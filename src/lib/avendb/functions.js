// @ts-nocheck — plain JS, kept loose on purpose, as the other QuickJS boxes are (src/lib/genui/logic.js)
// A database function in a box: avenDB's own `function` schema holds its code, a JS module that exports
// `run(event)`, given plain JSON, handing back the ops it would make as plain JSON. It runs in the same QuickJS engine
// as Sandbox 7's card code (src/lib/sandbox-8/sandbox.js), with its limits, a fresh engine for each call: no page, no
// network, no keys, no clock to wait on. What it hands back is only asked for: the device that runs it checks every op
// against what the acting vault may do (./flows.js), and a call that loops, eats its memory or throws makes nothing.

import { LIMITS } from '$lib/sandbox-8/sandbox.js';

let lib = null;
async function quickjs() {
	lib ??= Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-singlefile-browser-release-sync')]);
	const [core, variant] = await lib;
	return core.newQuickJSWASMModuleFromVariant(variant.default);
}

const CALL = '(f, s) => { const r = f(JSON.parse(s)); return r === undefined ? undefined : JSON.stringify(r); }';
const BARE =
	"for (const k of ['ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'WeakRef', 'FinalizationRegistry'])" +
	' delete globalThis[k];';
const message = (e) => (e && typeof e === 'object' ? `${e.name ?? 'Error'}: ${e.message ?? JSON.stringify(e)}` : String(e));

/**
 * Runs function code `code` on `event`: `{ ops }`, the ops it hands back (none where it hands back nothing), or
 * `{ ops: [], error }` where it doesn't load, throws, runs too long or hands back anything but a list of ops.
 * @param {string} code @param {object} event @returns {Promise<{ ops: object[], error?: string }>}
 */
export async function runFunction(code, event) {
	if (!code?.trim()) return { ops: [] };
	const QJS = await quickjs();
	const rt = QJS.newRuntime();
	rt.setMemoryLimit(LIMITS.memory);
	rt.setMaxStackSize(LIMITS.stack);
	let deadline = 0;
	let ms = 0;
	rt.setInterruptHandler(() => Date.now() > deadline);
	const vm = rt.newContext();
	const handles = [];
	const why = (e) => (e?.message === 'interrupted' ? `ran longer than ${ms} ms` : message(e));
	const evaluate = (src, file, type, t) => {
		[ms, deadline] = [t, Date.now() + t];
		const r = vm.evalCode(src, file, { type });
		if (r.error) {
			const e = vm.dump(r.error);
			r.error.dispose();
			throw new Error(why(e));
		}
		handles.push(r.value);
		return r.value;
	};
	try {
		evaluate(BARE, 'bare.js', 'global', LIMITS.loadMs);
		const exports = evaluate(code, 'function.js', 'module', LIMITS.loadMs);
		const call = evaluate(CALL, 'call.js', 'global', LIMITS.loadMs);
		const run = vm.getProp(exports, 'run');
		handles.push(run);
		if (vm.typeof(run) !== 'function') return { ops: [], error: 'it exports no run(event)' };
		// what crosses is one string, parsed inside the engine: nothing of the page goes in
		const s = vm.newString(JSON.stringify(event));
		[ms, deadline] = [LIMITS.callMs * 4, Date.now() + LIMITS.callMs * 4];
		const r = vm.callFunction(call, vm.undefined, run, s);
		s.dispose();
		if (r.error) {
			const e = vm.dump(r.error);
			r.error.dispose();
			return { ops: [], error: why(e) };
		}
		const out = vm.typeof(r.value) === 'string' ? vm.getString(r.value) : undefined;
		r.value.dispose();
		if (out === undefined) return { ops: [] };
		const ops = JSON.parse(out);
		const fine = Array.isArray(ops) && ops.every((o) => o && typeof o === 'object' && typeof o.op === 'string');
		return fine ? { ops } : { ops: [], error: 'run(event) must hand back a list of ops' };
	} catch (e) {
		return { ops: [], error: e.message || String(e) };
	} finally {
		for (const h of handles) if (h.alive) h.dispose();
		vm.dispose();
		rt.dispose();
	}
}
