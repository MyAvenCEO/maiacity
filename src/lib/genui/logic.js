// @ts-nocheck — plain JS, kept loose on purpose
// A declarative view's logic in a box: the same QuickJS engine as Sandbox 7's card code (src/lib/sandbox-8/sandbox.js),
// with its limits. The code (a JS module) may export `init(data)` and `on(event, data)`; each is given plain JSON and
// hands back the view's whole new data model as plain JSON. It has no page, no network, no keys, no clock to wait
// on; a call that loops, eats its memory or throws is stopped and the view keeps the data it had.

import { LIMITS } from '$lib/sandbox-8/sandbox.js';

let lib = null;
async function quickjs() {
	lib ??= Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-singlefile-browser-release-sync')]);
	const [core, variant] = await lib;
	return core.newQuickJSWASMModuleFromVariant(variant.default);
}

const CALL = '(f, s) => { const x = JSON.parse(s); const r = x.on ? f(x.e, x.d) : f(x.d); return r === undefined ? undefined : JSON.stringify(r); }';
const BARE = `for (const k of ['ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'WeakRef', 'FinalizationRegistry']) delete globalThis[k];`;
const message = (e) => (e && typeof e === 'object' ? `${e.name ?? 'Error'}: ${e.message ?? JSON.stringify(e)}` : String(e));

/**
 * Load a view's logic: { init(data), on(event, data), dispose() }, each call answering the new data (or the old one
 * and an error). Without logic both simply hand the data back.
 */
export async function loadLogic(code) {
	if (!code?.trim()) return { init: (d) => ({ data: d }), on: (e, d) => ({ data: d }), dispose() {} };
	const QJS = await quickjs();
	const rt = QJS.newRuntime();
	rt.setMemoryLimit(LIMITS.memory);
	rt.setMaxStackSize(LIMITS.stack);
	let deadline = 0;
	rt.setInterruptHandler(() => Date.now() > deadline);
	const vm = rt.newContext();
	const handles = [];
	const evaluate = (src, file, type, ms) => {
		deadline = Date.now() + ms;
		const r = vm.evalCode(src, file, { type });
		if (r.error) {
			const e = vm.dump(r.error);
			r.error.dispose();
			throw new Error(e?.message === 'interrupted' ? `ran longer than ${ms} ms` : message(e));
		}
		handles.push(r.value);
		return r.value;
	};
	let fns = {};
	let broken = '';
	try {
		evaluate(BARE, 'bare.js', 'global', LIMITS.loadMs);
		const exports = evaluate(code, 'view.js', 'module', LIMITS.loadMs);
		const call = evaluate(CALL, 'call.js', 'global', LIMITS.loadMs);
		for (const name of ['init', 'on']) {
			const f = vm.getProp(exports, name);
			handles.push(f);
			if (vm.typeof(f) === 'function') fns[name] = f;
		}
		fns.call = call;
	} catch (e) {
		broken = e.message || String(e);
	}
	const run = (name, event, data) => {
		if (broken) return { data, error: broken };
		if (!fns[name]) return { data };
		deadline = Date.now() + LIMITS.callMs * 4;
		// what crosses is one string, parsed inside the engine: nothing of the page goes in
		const s = vm.newString(JSON.stringify({ on: name === 'on', e: event ?? null, d: data }));
		const r = vm.callFunction(fns.call, vm.undefined, fns[name], s);
		s.dispose();
		if (r.error) {
			const e = vm.dump(r.error);
			r.error.dispose();
			return { data, error: `${name}: ${e?.message === 'interrupted' ? `ran longer than ${LIMITS.callMs * 4} ms` : message(e)}` };
		}
		const out = vm.typeof(r.value) === 'string' ? vm.getString(r.value) : undefined;
		r.value.dispose();
		if (out === undefined) return { data };
		const next = JSON.parse(out);
		if (!next || typeof next !== 'object' || Array.isArray(next)) return { data, error: `${name} must hand back the data model (an object).` };
		return { data: next };
	};
	return {
		init: (data) => run('init', null, data),
		on: (event, data) => run('on', event, data),
		dispose() {
			for (const h of handles) if (h.alive) h.dispose();
			vm.dispose();
			rt.dispose();
		}
	};
}
