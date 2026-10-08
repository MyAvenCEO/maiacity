/*
 * AVENDB'S PAIR WORKER — makes Classic McEliece key pairs for the avenDB tile, each from its seed alone, for the lab
 * worker (./lab.worker.js) that asks over a port of its own: a page has no threads of its own to make them in, and each
 * takes most of a second. The lab worker sends the compiled module first, so it is compiled once for all the workers.
 */
import init, { make_pair } from './pkg/avendb_web.js';

self.onmessage = (/** @type {MessageEvent<{ port: MessagePort }>} */ e) => {
	const port = e.data.port;
	/** @type {Promise<unknown>} */
	let ready = Promise.resolve();
	port.onmessage = async (/** @type {MessageEvent<{ module?: WebAssembly.Module, url?: string, seed?: string }>} */ m) => {
		const { module, url, seed } = m.data;
		if (module || url) return void (ready = init({ module_or_path: module ?? url }));
		try {
			await ready;
			const pair = make_pair(seed ?? '');
			port.postMessage({ seed, pair }, [pair.buffer]);
		} catch {
			// the lab worker makes it itself
			port.postMessage({ seed });
		}
	};
};
