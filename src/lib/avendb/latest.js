// A read a page repeats each time what it reads changes, as the AIPs are read again on every change of the device's
// world (./aips.svelte.js), that never starves: one read runs at a time, a read asked meanwhile runs once after it,
// and every read that ends shows its answer, unless a newer one already showed. Proposals and the HITL stack each
// started a read on every change and dropped every answer but the last asked's: while The OS's device synced, its
// world changed faster than an `aips` read took, so no answer ever showed (Samuel 2026-10-21: Proposals stuck on
// "Reading the AIPs of your vaults…", every tab at 0). A read that takes longer than `patience` says so (`failed`)
// and lets the next one start; its answer still shows if it comes before a newer one's.

/** What a read that took too long is raced against. */
const LATE = Symbol('late');

/**
 * `read`, run as `go()` asks it: at once if no read runs, else once more after the one that runs. Each answer that
 * ends newer than the last shown goes to `take`, each failure to `failed`, as does a read that takes over `patience`
 * milliseconds.
 * @template T
 * @param {() => Promise<T>} read @param {(answer: T) => void} take @param {(e: Error) => void} [failed]
 * @param {number} [patience]
 * @returns {() => Promise<void>}
 */
export function latest(read, take, failed = () => {}, patience = 30_000) {
	let asked = 0;
	let shown = 0;
	let running = false;
	let again = false;

	async function once() {
		const n = ++asked;
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let timer;
		const late = new Promise((r) => (timer = setTimeout(() => r(LATE), patience)));
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
		const how = await Promise.race([reading, late]);
		clearTimeout(timer);
		if (how === LATE && n > shown) failed(new Error(`no answer in ${Math.round(patience / 1000)} s`));
	}

	return async function go() {
		if (running) {
			again = true;
			return;
		}
		running = true;
		try {
			do {
				again = false;
				await once();
			} while (again);
		} finally {
			running = false;
		}
	};
}
