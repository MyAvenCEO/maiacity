// avenOS's runtimes worker (aven/runtimes, README, "The browser host"): the runtime host, aven-runtimes-web, the same
// wasmi host as native, in a worker of its own. It holds no key and reaches no store: a page asks it to run a runtime
// on a part and an input, `{ id, name, part, input }`, each a Value's JSON form as text, and it answers
// `{ id, result }`, the run's result in a Value's JSON form, `{ ok }` or `{ failure }`, or `{ id, error }`. The
// manifest compiled into the host names each runtime's newest frozen hash; its bytes are fetched once from this
// origin, /runtimes/frozen/<hex>.wasm, and the host loads them only when they are the hash's. A trap in the host itself
// (a Rust panic) leaves it unusable: that answer says `fatal`, and the worker ends, for the page to start again.
let host;
function load() {
	host ??= (async () => {
		const url = '/runtimes/aven_runtimes_web.js';
		const web = await import(/* @vite-ignore */ url);
		await web.default();
		return web;
	})().catch((error) => {
		host = undefined;
		throw error;
	});
	return host;
}

// each module's bytes, fetched and loaded once, however many asks wait for it
const modules = new Map();
function module(web, hash) {
	if (!modules.has(hash)) {
		modules.set(
			hash,
			(async () => {
				const res = await fetch(`/runtimes/frozen/${hash.slice('b3:'.length)}.wasm`);
				if (!res.ok) throw new Error(`${hash}: ${res.status} from this origin`);
				web.runtime_load(hash, new Uint8Array(await res.arrayBuffer()));
			})().catch((error) => {
				modules.delete(hash);
				throw error;
			}),
		);
	}
	return modules.get(hash);
}

self.onmessage = async ({ data: { id, name, part, input } }) => {
	try {
		const web = await load();
		const hash = web.runtime_hash(String(name));
		if (!hash) throw new Error(`no runtime ${name} is frozen`);
		await module(web, hash);
		const result = JSON.parse(web.runtime_run(hash, String(part), String(input)));
		self.postMessage({ id, hash, result });
	} catch (error) {
		const fatal = error instanceof WebAssembly.RuntimeError;
		self.postMessage({ id, error: String(error?.message ?? error), fatal });
		if (fatal) self.close();
	}
};
