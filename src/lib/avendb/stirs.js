// @ts-nocheck — plain JS, kept loose on purpose
/**
 * READ AGAIN WHEN IT CHANGES, NEVER ON A TIMER (Samuel 2026-10-22: "real time subscription store like reactivity
 * everywhere? Never polling pattern!"). The open device's node counts each time what it shows changes: its jobs, the
 * pages of edits it took, its peers and what they hold, what it holds (avendb-net `Node::stirs`). A view hands `onStir`
 * its read; it runs at once, then again each time that count moves, waiting at least twice as long as its last read
 * took (and `SETTLE`), so a burst of pages during a sync reads once it settles and never takes more than a third of the
 * page's time. A device too old to count (a Mac app from before) is read every `every` ms instead, as before.
 */
import { session } from './session.svelte.js';

/** the least a read waits after the count moved, so the changes after it come along (ms) */
const SETTLE = 250;

/** how long a view waits for the device to open, or to come back after it closed (ms) */
const AGAIN = 1000;

/**
 * Runs `read` now, and again whenever the open device says what it shows changed, until the function returned stops it.
 * @param {() => unknown} read @param {{ every?: number }} [opts] how often to read a device too old to say (ms)
 * @returns {() => void}
 */
export function onStir(read, { every = 4000 } = {}) {
	let stop = false;
	/** @type {(() => void) | null} */
	let wake = null;
	const sleep = (ms) => new Promise((r) => ((wake = r), setTimeout(r, ms)));
	(async () => {
		let n = 0;
		while (!stop) {
			const t = performance.now();
			await Promise.resolve()
				.then(read)
				.catch(() => {});
			const took = performance.now() - t;
			if (stop) break;
			const d = session.phase === 'open' ? session.device : null;
			/** @type {number | null | undefined} */
			let next = null;
			// the Mac app answers within a minute, null if nothing changed yet: it is asked again, nothing read
			while (!stop && next === null && d && typeof d.stirred === 'function' && d === session.device) {
				next = await d.stirred(n).catch(() => undefined);
			}
			if (stop) break;
			if (typeof next === 'number' && next >= 0) {
				n = next;
				await sleep(Math.max(SETTLE, 2 * took));
			} else {
				// no device, another in its place, one that closed (-1), or one too old to say: on a timer, as before
				n = 0;
				await sleep(d ? every : AGAIN);
			}
		}
	})();
	return () => {
		stop = true;
		wake?.();
	};
}
