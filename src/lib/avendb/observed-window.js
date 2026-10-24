import { createReadWindow } from './query-window.js';

/** A reactive scope owns one scheduling lease. Revisions reuse it; replacement/close aborts it.
 * The lease contains IDs only, never records or authorization decisions.
 * @param {(device: any, query: any, signal: AbortSignal, demand: any) => Promise<any>} read */
export function observedWindow(read) {
	/** @type {WeakMap<AbortSignal, ReturnType<typeof createReadWindow>>} */
	const windows = new WeakMap();
	return (/** @type {any} */ owner, /** @type {any} */ query, /** @type {AbortSignal} */ signal) => {
		if (signal.aborted) return Promise.resolve(null);
		let window = windows.get(signal);
		if (!window) {
			window = createReadWindow({ device: () => signal.aborted ? null : owner, read });
			windows.set(signal, window);
			const held = window;
			signal.addEventListener('abort', () => { held.close(); windows.delete(signal); }, { once: true });
		}
		return window.read(query);
	};
}
