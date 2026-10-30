// Opens this origin's Peer-Light worker (peer/worker.js): shared by every tab and frame of the origin where the browser
// has SharedWorker, a plain Worker of this page's own where it hasn't. `new URL(…, import.meta.url)` stays written
// inside `new SharedWorker(…)` and `new Worker(…)`, so Vite's build sees a worker and emits it as a file of its own.
// Held in a variable, the URL was inlined as a `data:` URL (the worker is under Vite's 4 KB inline limit): a worker
// with an opaque origin, which has no OPFS and can't resolve `/peer-light/`, so aven.maia.city's Peer-Light never
// started, in any browser (30 Oct 2026).
export function openWorker(name) {
	if (typeof SharedWorker === 'function') {
		const worker = new SharedWorker(new URL('./worker.js', import.meta.url), { type: 'module', name });
		return { worker, port: worker.port };
	}
	const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
	return { worker, port: worker };
}
