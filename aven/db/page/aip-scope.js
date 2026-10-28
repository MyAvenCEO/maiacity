/** Share one authorized observer while proposal views are mounted. No account data
 * survives the last consumer; late completions from a disposed observer are ignored.
 * @param {{observe: (query: () => any, take: (out: any) => void, failed: (error: Error) => void) => () => void,
 * query: () => any, take: (out: any) => void, failed: (error: Error) => void, reset: () => void}} options */
export function createAipScope({ observe, query, take, failed, reset }) {
	let users = 0, generation = 0;
	/** @type {(() => void) | null} */
	let stop = null;
	return {
		hold() {
			if (users++ === 0) {
				reset();
				const mine = ++generation;
				stop = observe(query, (out) => { if (mine === generation && users) take(out); },
					(error) => { if (mine === generation && users) failed(error); });
			}
			let closed = false;
			return () => {
				if (closed) return;
				closed = true;
				if (--users === 0) { generation++; stop?.(); stop = null; reset(); }
			};
		}
	};
}
