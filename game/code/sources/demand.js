// @ts-nocheck — plain JS
/** Local scheduling demand shared with the node. Renewals maintain a lease; they never poll database contents.
 * One random scope per mounted view avoids collisions between tabs/frames. Closed tabs expire on the node. */
export function createDemand(run, { scope = crypto.randomUUID().replaceAll('-', ''), renew = 30000 } = {}) {
	let entries = [], revision = 0, stopped = false, supported = true, queued = false, timer;
	let pending = Promise.resolve(false);
	const schedule = () => {
		clearTimeout(timer);
		if (!stopped && supported && entries.length) {
			timer = setTimeout(publish, renew);
			timer.unref?.();
		}
	};
	const publish = async () => {
		queued = false;
		if (stopped || !supported || (!entries.length && !revision)) return false;
		let capable = false;
		const current = ++revision;
		try {
			const got = await run({ op: 'demand', scope, revision: current, entries: [...entries] });
			// Older native apps may know no demand op. Ordinary bring remains the compatibility path.
			capable = typeof got?.ok?.accepted === 'boolean';
			if (got?.refused === 'BadOp' || (got?.ok && typeof got.ok.accepted !== 'boolean')) supported = false;
		} catch { /* retry the lease, without blocking the view's local reads */ }
		if (current === revision) schedule();
		return capable;
	};
	const replace = (ids) => {
		if (stopped || !supported) return Promise.resolve(false);
		const next = [...new Set(ids.filter((e) => typeof e === 'string' && /^[0-9a-f]{64}$/.test(e)))].slice(0, 512);
		if (next.length === entries.length && next.every((e, i) => e === entries[i])) return pending;
		entries = next;
		clearTimeout(timer);
		if (!queued) {
			queued = true;
			pending = new Promise((resolve) => queueMicrotask(() => { void publish().then(resolve); }));
		}
		return pending;
	};
	return {
		add: (ids) => replace([...entries, ...ids]),
		// Explicit current-view requirements precede older learned hints at the bound.
		prioritize: (ids) => replace([...ids, ...entries]),
		replace,
		close() {
			if (stopped) return;
			stopped = true;
			clearTimeout(timer);
			if (supported && revision) void Promise.resolve().then(() => run({ op: 'demand', scope, revision: ++revision, entries: [] })).catch(() => {});
		}
	};
}
