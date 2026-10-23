// @ts-nocheck — plain JS, kept loose on purpose
/** Read once, then after a device's revision changes. No recurring reads on an unchanged capable device.
 * Older apps fall back to paced reads. Cancellation also wakes timers and abandons a pending revision wait. */
export function watchStirs(device, read, { every = 4000, settle = 250 } = {}) {
	const controller = new AbortController();
	const { signal } = controller;
	let wake;
	const cancelled = new Promise((resolve) => { wake = resolve; });
	let timer;
	const pause = (ms) => Promise.race([cancelled, new Promise((resolve) => { timer = setTimeout(resolve, ms); })])
		.finally(() => { clearTimeout(timer); timer = undefined; });
	void (async () => {
		let revision = 0;
		while (!signal.aborted) {
			const started = performance.now();
			await Promise.race([cancelled, Promise.resolve().then(() => signal.aborted ? undefined : read(signal)).catch(() => {})]);
			const took = performance.now() - started;
			if (signal.aborted || !device) return;
			if (typeof device.stirred !== 'function') {
				await pause(every);
				continue;
			}
			let next = null;
			while (!signal.aborted && next === null) {
				next = await Promise.race([cancelled, Promise.resolve().then(() => device.stirred(revision)).catch(() => undefined)]);
			}
			if (signal.aborted || next === -1) return;
			if (typeof next === 'number' && Number.isFinite(next) && next >= 0) {
				revision = next;
				await pause(Math.max(settle, 2 * took));
			} else {
				await pause(every);
			}
		}
	})();
	return () => {
		controller.abort();
		wake();
		clearTimeout(timer);
	};
}
