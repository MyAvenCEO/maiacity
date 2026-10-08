/*
 * The avenDB tile's world, off the page: a lab worker runs it (./lab.worker.js) and a pool of pair workers makes the
 * McEliece pairs its keys want (./pair.worker.js), each joined to the lab worker by a port of its own. Views and actions
 * go to the lab worker in JSON and come back in JSON.
 */

/**
 * What the lab worker says while it works: a step of the world made, or how many pairs are made of those wanted.
 * @typedef {{ step?: { step: number, made: string }, pairs?: { made: number, wanted: number } }} Progress
 */

/**
 * The tile's world, as the page reaches it.
 * @typedef {{
 *   start: () => Promise<{ steps: number, workers: number }>,
 *   build: () => Promise<{ ms: number }>,
 *   reset: () => Promise<{ ms: number }>,
 *   view: (query: object) => Promise<any>,
 *   act: (action: object) => Promise<any>,
 *   scenarios: () => Promise<{ number: string, title: string, phase: string }[]>,
 *   run: (number: string) => Promise<any>,
 *   close: () => void
 * }} World
 */

/** An error from the lab worker: `dead` once the module panicked, and the tile can only start over. */
export class TileError extends Error {
	/** @param {string} message @param {boolean} dead */
	constructor(message, dead) {
		super(message);
		this.dead = dead;
	}
}

/**
 * Start the tile's workers: the lab worker, and as many pair workers as the machine has cores to spare (two to six).
 * @param {(p: Progress) => void} onProgress
 * @returns {World}
 */
export function openWorld(onProgress) {
	const lab = new Worker(new URL('./lab.worker.js', import.meta.url), { type: 'module' });
	const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
	/** @type {Worker[]} */
	const workers = [];
	/** @type {MessagePort[]} */
	const ports = [];
	for (let i = 0; i < n; i++) {
		const w = new Worker(new URL('./pair.worker.js', import.meta.url), { type: 'module' });
		const channel = new MessageChannel();
		w.postMessage({ port: channel.port1 }, [channel.port1]);
		ports.push(channel.port2);
		workers.push(w);
	}

	let next = 0;
	/** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
	const waiting = new Map();
	lab.onmessage = (/** @type {MessageEvent<any>} */ e) => {
		const m = e.data;
		if (m.id === undefined) return onProgress(m);
		const w = waiting.get(m.id);
		waiting.delete(m.id);
		if (!w) return;
		if ('error' in m) w.reject(new TileError(m.error, !!m.dead));
		else w.resolve(m.ok);
	};
	// the worker's script didn't load: nothing it was asked will be answered
	lab.onerror = (e) => {
		for (const w of waiting.values()) w.reject(new TileError(e.message || 'The tile could not start.', true));
		waiting.clear();
	};

	/** @param {object} ask @param {Transferable[]} [transfer] @returns {Promise<any>} */
	const call = (ask, transfer = []) =>
		new Promise((resolve, reject) => {
			const id = next++;
			waiting.set(id, { resolve, reject });
			lab.postMessage({ ...ask, id }, transfer);
		});

	return {
		start: () => call({ call: 'start', ports }, ports),
		build: () => call({ call: 'build' }),
		reset: () => call({ call: 'reset' }),
		// in JSON: what the page asks may hold its own state's proxies, which no worker can be sent
		view: async (query) => {
			const v = await call({ call: 'view', query: JSON.stringify(query) });
			if (v && typeof v === 'object' && 'error' in v) throw new TileError(v.error, false);
			return v;
		},
		act: (action) => call({ call: 'act', action: JSON.stringify(action) }),
		scenarios: () => call({ call: 'scenarios' }),
		run: (number) => call({ call: 'run', number }),
		close: () => {
			lab.terminate();
			for (const w of workers) w.terminate();
		}
	};
}
