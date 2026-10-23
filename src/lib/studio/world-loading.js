/**
 * A film API may exist before its world mounts. Bound that wait using the host's real timer,
 * and observe navigation and bootstrap errors even when the child's ready promise never settles.
 * @param {Promise<unknown>} ready
 * @param {() => { present: boolean, error?: string, label?: string }} inspect
 * @param {number} timeout
 * @param {number} [poll]
 * @returns {Promise<boolean>}
 */
export function waitForWorld(ready, inspect, timeout, poll = 250) {
	return new Promise((resolve, reject) => {
		let finished = false;
		/** @type {ReturnType<typeof setInterval>} */ let interval;
		/** @type {ReturnType<typeof setTimeout>} */ let deadline;
		const finish = (/** @type {boolean} */ present, /** @type {Error | undefined} */ error = undefined) => {
			if (finished) return;
			finished = true;
			clearInterval(interval);
			clearTimeout(deadline);
			if (error) reject(error); else resolve(present);
		};
		const check = () => {
			const state = inspect();
			if (!state.present) finish(false);
			else if (state.error) finish(false, new Error(state.error));
			return state;
		};
		interval = setInterval(check, poll);
		deadline = setTimeout(() => {
			const state = check();
			finish(false, new Error(`World loading timed out${state.label ? ` while ${state.label}` : ''}`));
		}, timeout);
		ready.then(() => { const state = check(); finish(state.present); }, (e) => finish(false, e));
		check();
	});
}
