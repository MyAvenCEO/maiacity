// @ts-nocheck — plain JS
/** Local scheduling demand shared with the node. Renewals maintain a lease; they never poll database contents.
 * One random scope per mounted view avoids collisions between tabs/frames. Closed tabs expire on the node. */
export function createDemand(run, { scope = crypto.randomUUID().replaceAll('-', ''), renew = 30000 } = {}) {
	let entries = [], queries = [], revision = 0, stopped = false, supported = true, queued = false, timer;
	let discoverySupported = false;
	let pending = Promise.resolve(false);
	const schedule = () => {
		clearTimeout(timer);
		if (!stopped && supported && (entries.length || queries.length)) {
			timer = setTimeout(publish, renew);
			timer.unref?.();
		}
	};
	const publish = async () => {
		queued = false;
		if (stopped || !supported || (!entries.length && !queries.length && !revision)) return false;
		let capable = false;
		const current = ++revision;
		try {
			const got = await run({ op: 'demand', scope, revision: current, entries: [...entries], ...(queries.length ? { queries } : {}) });
			// Older native apps may know no demand op. Ordinary bring remains the compatibility path.
			capable = typeof got?.ok?.accepted === 'boolean';
			if (current === revision) discoverySupported = got?.ok?.discovery_supported === true;
			if (current === revision && (got?.refused === 'BadOp' || (got?.ok && typeof got.ok.accepted !== 'boolean'))) supported = false;
		} catch { /* retry the lease, without blocking the view's local reads */ }
		if (current === revision) schedule();
		return capable;
	};
	const replace = (ids, selectors = []) => {
		if (stopped || !supported) return Promise.resolve(false);
		const next = [...new Set(ids.filter((e) => typeof e === 'string' && /^[0-9a-f]{64}$/.test(e)))].slice(0, 512);
		const nextQueries = normalizeDiscovery(selectors);
		if (next.length === entries.length && next.every((e, i) => e === entries[i]) && JSON.stringify(nextQueries) === JSON.stringify(queries)) return pending;
		entries = next;
		queries = nextQueries;
		clearTimeout(timer);
		if (!queued) {
			queued = true;
			pending = new Promise((resolve) => queueMicrotask(() => { void publish().then(resolve); }));
		}
		return pending;
	};
	return {
		add: (ids) => replace([...entries, ...ids], queries),
		// Explicit current-view requirements precede older learned hints at the bound.
		prioritize: (ids, selectors = queries) => replace([...ids, ...entries], selectors),
		replace,
		// Local selector support never establishes peer support or result completeness.
		// Transport failures and policy refusals never enable an unscoped retry.
		legacy: () => !supported,
		discovery: () => ({ supported: discoverySupported, complete: false }),
		close() {
			if (stopped) return;
			stopped = true;
			clearTimeout(timer);
			if (supported && revision) void Promise.resolve().then(() => run({ op: 'demand', scope, revision: ++revision, entries: [] })).catch(() => {});
		}
	};
}

/** Only bounded positive type hints cross this bridge; never forward query code or predicates. */
export function normalizeDiscovery(selectors) {
	if (!Array.isArray(selectors)) return [];
	const encoder = new TextEncoder();
	return selectors.slice(0, 8).flatMap((query) => {
		if (!query || !Array.isArray(query.types)) return [];
		if (query.vault !== undefined && (typeof query.vault !== 'string' || !/^[0-9a-f]{64}$/.test(query.vault))) return [];
		const types = [...new Set(query.types.slice(0, 8).filter((t) => typeof t === 'string' && t.length > 0 && t.length <= 64 && encoder.encode(t).length <= 64))];
		return types.length ? [{ types, ...(query.vault === undefined ? {} : { vault: query.vault }) }] : [];
	});
}
