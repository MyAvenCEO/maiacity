// A read a page repeats each time what it reads changes, as the AIPs are read again on every change of the device's
// world (./aips.svelte.js), that never starves and never piles up: one read runs at a time, a read asked meanwhile runs
// once after it, and every read that ends shows its answer. Proposals and the HITL stack each started a read on every
// change and dropped every answer but the last asked's: while theOS's device synced, its world changed faster than an
// `aips` read took, so no answer ever showed (Samuel 2026-10-21: Proposals stuck on "Reading the AIPs of your
// vaults…", every tab at 0), while the reads piled up on the device, whose every op waits its turn. A read asked
// meanwhile waits, after the one that ran, twice as long as that took (`rest`), so that while what it reads keeps
// changing, as a device catching up after its unlock does, it takes no more than a third of the device's time, as the
// world's own reads do (./session.svelte.js `watch`): back to back, they held one of theOS's cores and Studio's reads
// waited behind them (2026-10-21). A read the person asked for, as after their own change, goes at once. A read with
// no answer after `patience` says so (`failed`), and the next starts only once it ends, or once it is taken for lost,
// four times that later; its answer still shows if it comes before a newer one's.

/** What a read that took too long is raced against. */
const LATE = Symbol('late');

/** How long a read asked meanwhile waits after one that took `took` milliseconds: twice that, from 150 ms to 10 s. */
const REST = (/** @type {number} */ took) => Math.min(10_000, Math.max(150, 2 * took));

/**
 * `read`, run as `go()` asks it: at once if no read runs, else once more after the one that runs, `rest` of the time
 * it took later, unless `go(true)` asked it at once. Each answer newer than the last shown goes to `take`, each failure
 * to `failed`, and so does a read with no answer after `patience` milliseconds, which is taken for lost after four times
 * that.
 * @template T
 * @param {() => Promise<T>} read @param {(answer: T) => void} take @param {(e: Error) => void} [failed]
 * @param {number} [patience] @param {(took: number) => number} [rest]
 * @returns {(now?: boolean) => Promise<void>}
 */
export function latest(read, take, failed = () => {}, patience = 30_000, rest = REST) {
	let asked = 0;
	let shown = 0;
	let running = false;
	let again = false;
	let now = false;
	/** ends the rest at once, while one is waited */
	let wake = () => {};

	async function once() {
		const n = ++asked;
		const slow = setTimeout(() => n > shown && failed(new Error(`no answer yet after ${Math.round(patience / 1000)} s`)), patience);
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let lost;
		const gone = new Promise((r) => (lost = setTimeout(() => r(LATE), 4 * patience)));
		const reading = Promise.resolve()
			.then(read)
			.then(
				(got) => {
					if (n <= shown) return;
					shown = n;
					take(got);
				},
				(e) => n > shown && failed(e instanceof Error ? e : new Error(String(e)))
			);
		await Promise.race([reading, gone]);
		clearTimeout(slow);
		clearTimeout(lost);
	}

	return async function go(soon = false) {
		if (running) {
			again = true;
			now ||= soon;
			if (soon) wake();
			return;
		}
		running = true;
		try {
			for (;;) {
				again = now = false;
				const t = performance.now();
				await once();
				if (!again) break;
				const ms = now ? 0 : rest(performance.now() - t);
				if (ms > 0) await new Promise((r) => setTimeout((wake = () => r(null)), ms));
				wake = () => {};
			}
		} finally {
			running = false;
		}
	};
}
