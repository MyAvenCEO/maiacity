// @ts-nocheck — plain JS
/**
 * INTERESTS: WHAT A VIEW WANTS, IN TIERS (step P3 of sync v2, docs/AVENDB_SYNC_V2.md; Lean avendb/spec/AvenDB/Interest.lean).
 * A mounted view states its Interests once, through one handle (`createInterest`), and its unmount clears them: no
 * lease and no timer. The node (avendb-net interest.rs) brings what the Interests of every mounted view want, the
 * higher tier first: on screen (`now`), one click away (`next`), the rest of the screen's data (`later`), and what the
 * device keeps for offline use (`idle`). Interests only order: they grant nothing and never say a view is complete.
 */

/** The tiers, the highest first. */
export const TIERS = ['now', 'next', 'later', 'idle'];

/** A tier's rank: 0 for `now`, 3 for `idle` and for anything that is no tier. @param {string} tier */
export const rank = (tier) => {
	const i = TIERS.indexOf(tier);
	return i < 0 ? TIERS.length - 1 : i;
};

/** The lower of two tiers: where a part held at tier `cap` lands (Lean `Tier.atMost`). @param {string} cap @param {string} tier */
export const atMost = (cap, tier) => TIERS[Math.max(rank(cap), rank(tier))];

const ENTRY = /^[0-9a-f]{64}$/;
/** How many entries one scope names (avendb-net `MOST_ENTRIES`), wants it holds, and type selectors. */
export const MOST_ENTRIES = 512;
export const MOST_WANTS = 32;
export const MOST_QUERIES = 8;

/**
 * The scheduler's order (Lean `schedule`): works `{ entry, tier, dist }` sorted by tier, then by distance (the view's
 * signal: viewport, playhead, camera), the order they came in kept between equals; each entry once, at its first and
 * so its best place (`schedule_best`). It holds exactly the entries the works name (`schedule_whole`).
 * @param {{entry: string, tier: string, dist?: number}[]} works
 */
export function schedule(works) {
	const sorted = (works ?? [])
		.filter((w) => ENTRY.test(String(w?.entry)))
		.map((w, i) => ({ w, i, r: rank(w.tier), d: Number.isFinite(w.dist) ? w.dist : 0 }))
		.sort((a, b) => a.r - b.r || a.d - b.d || a.i - b.i);
	const seen = new Set();
	const out = [];
	for (const { w, r, d } of sorted) {
		if (seen.has(w.entry)) continue;
		seen.add(w.entry);
		out.push({ entry: w.entry, tier: TIERS[r], dist: d });
	}
	return out;
}

/** Only bounded positive type hints cross to the node; never query code or predicates. */
export function normalizeDiscovery(selectors) {
	if (!Array.isArray(selectors)) return [];
	const encoder = new TextEncoder();
	return selectors.slice(0, MOST_QUERIES).flatMap((query) => {
		if (!query || !Array.isArray(query.types)) return [];
		if (query.vault !== undefined && (typeof query.vault !== 'string' || !ENTRY.test(query.vault))) return [];
		const types = [...new Set(query.types.slice(0, 8).filter((t) => typeof t === 'string' && t.length > 0 && t.length <= 64 && encoder.encode(t).length <= 64))];
		return types.length ? [{ types, ...(query.vault === undefined ? {} : { vault: query.vault }) }] : [];
	});
}

/**
 * Wants `wants` (`{ tier, entries?, queries? }`) as the node takes them: entries in the scheduler's order and each once
 * over all tiers, at most `MOST_ENTRIES`; selectors each once, the highest tier's first, at most `MOST_QUERIES`.
 * @param {{tier: string, entries?: string[], queries?: {types: string[], vault?: string}[]}[]} wants
 */
export function normalizeWants(wants) {
	const works = (wants ?? []).flatMap((w) => (w?.entries ?? []).map((entry) => ({ entry, tier: w.tier })));
	const kept = schedule(works).slice(0, MOST_ENTRIES);
	const byTier = new Map(TIERS.map((t) => [t, { tier: t, entries: [], queries: [] }]));
	for (const { entry, tier } of kept) byTier.get(tier).entries.push(entry);
	const seen = new Set();
	let left = MOST_QUERIES;
	for (const w of [...(wants ?? [])].sort((a, b) => rank(a?.tier) - rank(b?.tier))) {
		for (const q of normalizeDiscovery(w?.queries ?? [])) {
			const key = JSON.stringify(q);
			if (seen.has(key) || left <= 0) continue;
			seen.add(key);
			left--;
			byTier.get(TIERS[rank(w.tier)]).queries.push(q);
		}
	}
	return [...byTier.values()].filter((w) => w.entries.length || w.queries.length);
}

/**
 * One mounted view's Interests on device `run` (its `run(op)`). `set(wants)` replaces them, published once a turn
 * (a burst of sets is one op); `clear()` empties them; `close()` empties them for good. A node that knows no
 * `interest` op (an app a release older) gets `demand`, the op before it, once a set: no renewal; one that knows
 * neither is sent nothing more.
 * @param {(op: object) => Promise<any>} run @param {{ scope?: string }} [options]
 */
export function createInterest(run, { scope = crypto.randomUUID().replaceAll('-', '') } = {}) {
	let wants = [], published = '[]', revision = 0, closed = false, queued = false, legacy = false, declined = false;
	let pending = Promise.resolve(false);
	const publish = async () => {
		queued = false;
		const key = JSON.stringify(wants);
		if (key === published) return true;
		published = key;
		// a node that knows neither op holds no view metadata: reads go on, nothing is sent again
		if (declined) return false;
		const current = ++revision;
		try {
			if (!legacy) {
				const got = await run({ op: 'interest', scope, revision: current, wants });
				// this node's own refusals of a bad interest start so (avendb-net run.rs `view_interest`)
				if (got?.refused !== 'BadOp' || /^(an interest|a want)/.test(String(got?.why ?? ''))) return got?.ok?.accepted === true;
				legacy = true;
			}
			const entries = wants.flatMap((w) => w.entries).slice(0, MOST_ENTRIES);
			const queries = wants.flatMap((w) => w.queries).slice(0, MOST_QUERIES);
			const got = await run({ op: 'demand', scope, revision: ++revision, entries, ...(queries.length ? { queries } : {}) });
			if (got?.refused === 'BadOp') declined = true;
			return got?.ok?.accepted === true;
		} catch {
			// a device that went away: its views went with it
			return false;
		}
	};
	const queue = () => {
		if (!queued) {
			queued = true;
			pending = new Promise((done) => queueMicrotask(() => void publish().then(done)));
		}
		return pending;
	};
	return {
		/** @param {{tier: string, entries?: string[], queries?: object[]}[]} next */
		set(next) {
			if (closed) return Promise.resolve(false);
			wants = normalizeWants(next);
			return queue();
		},
		clear() {
			if (closed) return Promise.resolve(false);
			wants = [];
			return queue();
		},
		get wants() {
			return wants.map((w) => ({ ...w, entries: [...w.entries], queries: [...w.queries] }));
		},
		close() {
			if (closed) return;
			wants = [];
			closed = true;
			if (published !== '[]') void queue();
		}
	};
}
