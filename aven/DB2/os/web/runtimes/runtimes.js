// The page's way to a runtime (aven/runtimes, README, "The browser host"): `runtime(name, part, input)` runs the
// newest frozen module of `name` on a part and an input, Values in their one JSON form, and resolves to its output, or
// rejects with its failure. The runtimes run in a worker of their own (./host.js), never in the Peer-Light's, which
// holds the device key (ARCHITECTURE A45): a module is untrusted, and a fault in the host stops only this worker. The
// page starts it on the first ask and again on the ask after it stopped; what was asked of a worker that stopped is
// refused with why.
let worker;
const waiting = new Map();
let asked = 0;

function stopped(why) {
	worker?.terminate();
	worker = null;
	for (const { reject } of waiting.values()) reject(new Error(`the runtimes worker stopped: ${why}`));
	waiting.clear();
}

function start() {
	// written inside `new Worker(…)`, so Vite's build emits the worker as a file of its own (peer/open.js)
	worker = new Worker(new URL('./host.js', import.meta.url), { type: 'module', name: 'aven-runtimes' });
	worker.onmessage = ({ data }) => {
		const pending = waiting.get(data.id);
		waiting.delete(data.id);
		if (data.error === undefined) pending?.resolve(data.result);
		else pending?.reject(new Error(data.error));
		if (data.fatal) stopped(data.error);
	};
	worker.onerror = (event) => {
		event.preventDefault?.();
		stopped(event.message || 'it failed to load');
	};
}

// A Value's JSON form as the drawer takes it: bytes, `{ "bytes": hex }`, as a Uint8Array
export const fromJson = (v) =>
	Array.isArray(v)
		? v.map(fromJson)
		: v && typeof v === 'object'
			? 'bytes' in v && Object.keys(v).length === 1
				? Uint8Array.from(v.bytes.match(/../g) ?? [], (b) => parseInt(b, 16))
				: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromJson(x)]))
			: v;

/** Runs the runtime `name`: its output as a Value's JSON form, or a rejection naming its failure. */
export function runtime(name, part, input) {
	if (!worker) start();
	const id = ++asked;
	return new Promise((resolve, reject) => {
		waiting.set(id, {
			resolve: (result) => ('ok' in result ? resolve(result.ok) : reject(new Error(`${name}: ${result.failure}`))),
			reject,
		});
		worker.postMessage({ id, name, part, input });
	});
}
