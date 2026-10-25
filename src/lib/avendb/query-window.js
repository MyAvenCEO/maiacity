// @ts-nocheck — plain JS
import { completeQuery } from '../../../game/code/sources/query-continuation.js';
import { viewReadiness } from './view-readiness.js';
import { activeRead } from './active-reads.js';
import { readCompleteness } from './read-completeness.js';
import { createDemand, normalizeDiscovery } from '../../../game/code/sources/demand.js';

/** Entry IDs shown by a read. Scheduling hints only: no response here establishes completeness or authority. */
export function replyEntries(got) {
	const ok = got?.ok;
	if (!ok || typeof ok !== 'object') return [];
	const rows = Array.isArray(ok) ? ok : [ok, ...['rows', 'posts', 'entries', 'items', 'lines'].flatMap((k) => Array.isArray(ok[k]) ? ok[k] : [])];
	return [...new Set(rows.map((r) => r?.entry).filter((e) => typeof e === 'string' && /^[0-9a-f]{64}$/.test(e)))];
}

/** Explicit positive entry filters also matter before an empty local query can return any rows.
 * Bound traversal of user-authored JSON; negated filters cannot identify a visible entry. */
export function queryEntries(op) {
	const entries = new Set(op?.entry && /^[0-9a-f]{64}$/.test(op.entry) ? [op.entry] : []);
	if (Array.isArray(op?.entries)) for (const entry of op.entries.slice(0, 512)) {
		if (typeof entry === 'string' && /^[0-9a-f]{64}$/.test(entry)) entries.add(entry);
		if (entries.size === 512) break;
	}
	const pending = [op?.where];
	for (let visited = 0; pending.length && visited < 512 && entries.size < 512; visited++) {
		const where = pending.pop();
		if (!where || typeof where !== 'object') continue;
		if (Array.isArray(where.entry)) for (const entry of where.entry.slice(0, 512)) {
			if (typeof entry === 'string' && /^[0-9a-f]{64}$/.test(entry)) entries.add(entry);
			if (entries.size === 512) break;
		}
		for (const key of ['all', 'any']) if (Array.isArray(where[key])) pending.push(...where[key].slice(0, Math.max(0, 512 - visited - pending.length)).reverse());
	}
	return [...entries];
}

/** Discover positive type candidates even when the local query has no entry IDs yet.
 * This is only a scheduling hint: the complete original query still runs locally.
 * Negation, predicates, projections and acting identities are never sent to peers. */
export function queryDiscovery(op) {
	if (op?.op === 'code') return normalizeDiscovery([{ types: op.type, ...(op.vault === undefined ? {} : { vault: op.vault }) }]);
	if (op?.op === 'aips') return normalizeDiscovery([{ types: ['aip', 'review'], ...(op.vault === undefined ? {} : { vault: op.vault }) }]);
	if (op?.op === 'database' || op?.op === 'entry_views') {
		// A semantic file-kind read also accepts custom schemas. Prioritize the
		// standard file type without narrowing the canonical local kind query;
		// this hint is not an exhaustive inventory/completeness claim.
		const types = op.types ?? (op.op === 'entry_views' && op.kind === 'file' && !op.entries ? ['file'] : undefined);
		return normalizeDiscovery([{ types, ...(op.vault === undefined ? {} : { vault: op.vault }) }]);
	}
	if (op?.op !== 'query') return [];
	const types = new Set(), pending = [op.where];
	for (let visited = 0; pending.length && visited < 512 && types.size < 8; visited++) {
		const where = pending.pop();
		if (!where || typeof where !== 'object') continue;
		if (Array.isArray(where.type)) for (const type of where.type.slice(0, 8)) {
			const safe = normalizeDiscovery([{ types: [type] }]);
			if (safe.length) types.add(type);
			if (types.size === 8) break;
		}
		for (const key of ['all', 'any']) if (Array.isArray(where[key])) pending.push(...where[key].slice(0, Math.max(0, 512 - visited - pending.length)).reverse());
	}
	return normalizeDiscovery([{ types: [...types], ...(op.vault === undefined ? {} : { vault: op.vault }) }]);
}

/** One component's visible read. Replace the window on each query; keep independent components independent.
 * Reads stay local-first. Demand registration runs beside them and never delays a local result.
 * @param {{ device: () => any, read: (device: any, op: any, signal: AbortSignal, demand: ReturnType<typeof createDemand>) => Promise<any> }} options
 */
export function createReadWindow({ device, read }) {
	let current = null, held = null, closed = false, queryKey = null, clearing = 0;
	let completeness = readCompleteness(null);
	const observed = activeRead();
	const clear = () => {
		observed.clear();
		completeness = readCompleteness(null);
		current?.controller.abort();
		current = null;
		const generation = ++clearing;
		// Effect cleanup and its replacement run in one turn. Abort stale reads immediately,
		// but let an unchanged replacement retain the discovery response already in flight.
		queueMicrotask(() => {
			if (generation !== clearing) return;
			queryKey = null;
			void held?.demand.replace([]);
		});
	};
	const release = () => {
		observed.clear();
		completeness = readCompleteness(null);
		clearing++;
		queryKey = null;
		current?.controller.abort();
		current = null;
		held?.demand.close();
		held = null;
	};
	return {
		get completeness() { return { ...completeness }; },
		async read(op, {partial = () => {}} = {}) {
			completeness = readCompleteness(null);
			if (closed) return null;
			clearing++;
			current?.controller.abort();
			current = null;
			const d = device();
			if (held && held.device !== d) release();
			if (!d) { clear(); return null; }
			// One scope per mounted window, with revisions on replacement: frequent reactive reads do not
			// accumulate closed scopes on the node. A device change starts an independent scope there.
			held ??= { device: d, demand: createDemand((o) => d.run(o)) };
			const { demand } = held;
			const controller = new AbortController();
			const request = { controller, device: d };
			current = request;
			observed.set('pending');
			const active = () => current === request && !controller.signal.aborted && device() === d;
			const entries = queryEntries(op), selectors = queryDiscovery(op);
			// Re-reading an unchanged view must not invalidate its peer discovery in flight.
			// Compare the full operation so changing a predicate also drops obsolete row hints.
			let nextKey;
			try { nextKey = JSON.stringify(op); } catch { nextKey = null; }
			if (nextKey === null || nextKey !== queryKey) void demand.replace(entries, selectors);
			queryKey = nextKey;
			try {
				const got = await completeQuery(() => read(d, op, controller.signal, demand), {
                    signal: controller.signal,
                    progress(answer) {
                        if (!active()) return;
                        completeness = readCompleteness(answer);
                        if (completeness.deferredCandidates > 0) {
                            observed.set('pending');
                            viewReadiness.record(completeness, answer);
                            partial(answer);
                            void demand.replace([...entries, ...replyEntries(answer)], selectors);
                        }
                    }
                });
				if (!active()) return null;
				completeness = readCompleteness(got);
				viewReadiness.record(completeness, got);
				// pendingJudgments is node-wide: unrelated catch-up must not mark a
				// fully answered view pending. Only unresolved candidates affect it.
				observed.set(completeness.pageComplete === false ? 'unavailable' : completeness.unresolvedCandidates > 0
					? completeness.pendingJudgments > 0 ? 'pending' : 'unavailable'
					: completeness.response);
				void demand.replace([...entries, ...replyEntries(got)], selectors);
				return got;
			} catch (error) {
				if (!active()) return null;
				clear();
				observed.set('unavailable');
				throw error;
			}
		},
		clear,
		invalidate() { if (held && held.device !== device()) release(); },
		close() { closed = true; release(); }
	};
}


/** Scheduling for a view whose rows already came from local state, without issuing another content read.
 * Keep one scope for its mounted lifetime. A device change releases the old owner's scope and republishes
 * the still-visible entries on the replacement device; no old owner is reached through a new session. */
export function createEntryWindow({ device }) {
	let held = null, entries = [], closed = false;
	const bind = () => {
		if (closed) return null;
		const d = device();
		if (held && held.device !== d) { held.demand.close(); held = null; }
		if (d && !held && entries.length) held = { device: d, demand: createDemand((op) => d.run(op)) };
		return held?.demand ?? null;
	};
	const replace = (ids) => {
		if (closed) return Promise.resolve(false);
		entries = [...new Set(ids.filter((id) => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id)))].slice(0, 512);
		return bind()?.replace(entries) ?? Promise.resolve(false);
	};
	return {
		replace,
		clear: () => replace([]),
		invalidate() { return bind()?.replace(entries) ?? Promise.resolve(false); },
		close() { closed = true; entries = []; held?.demand.close(); held = null; }
	};
}
