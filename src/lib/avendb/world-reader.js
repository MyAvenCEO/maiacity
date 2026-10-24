/** One world-summary reader per device. Every request receives a ticket; a read
 * covers only requests waiting when it starts. Explicit refresh never joins a
 * pre-request snapshot. Requests during a read share one next batch/promise.
 * Cancellation settles both batches immediately; late engine results cannot publish.
 * @param {{ read: () => Promise<any>, take: (answer: any) => void }} options */
export function createWorldReader({ read, take }) {
	let running = false, asked = 0;
	/** @typedef {{ ticket: number, promise: Promise<void>, resolve: () => void, reject: (error: unknown) => void }} Batch */
	/** @type {Batch | null} */
	let pending = null;
	/** @type {Batch | null} */
	let active = null;
	/** @type {Error | null} */
	let cancelled = null;
	async function pump() {
		if (running) return;
		running = true;
		try {
			while (pending && !cancelled) {
				const covered = pending;
				active = covered;
				pending = null;
				try {
					const answer = await read();
					if (!cancelled) { take(answer); covered.resolve(); }
				} catch (error) { covered.reject(error); }
				active = null;
			}
		} finally { running = false; }
	}
	return {
		/** @returns {Promise<void>} */
		request() {
			if (cancelled) return Promise.reject(cancelled);
			if (!pending) {
				let resolve = () => {};
				/** @type {(error: unknown) => void} */
				let reject = () => {};
				/** @type {Promise<void>} */
				const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
				pending = { ticket: ++asked, promise, resolve, reject };
			} else pending.ticket = ++asked;
			const promise = pending.promise;
			void pump();
			return promise;
		},
		/** @param {Error} reason */
		cancel(reason) {
			cancelled ??= reason;
			active?.reject(cancelled);
			pending?.reject(cancelled);
			pending = null;
		}
	};
}
