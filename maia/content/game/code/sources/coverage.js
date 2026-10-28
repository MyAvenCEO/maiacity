// @ts-nocheck — shared browser/native JS
/** A read's coverage (aven/db/spec/AvenDB/Coverage.lean): the one answer to "is this read complete?". The device says
 * it on every query: `complete`; `partial` with what it shows (`have`), what it knows (`known`: `have` and the
 * candidates that wait), which wait and on what (`waiting`), and the logs its peers announced that it lacks and that
 * may match (`logs`); or `denied`. A view shows loading, partial, empty or denied from this alone.
 * An answer that names none (a device from before sync v2, one release) counts as complete.
 * @param {any} answer @returns {{state:'complete'|'partial'|'denied'|'unavailable', have:number, known:number, waiting:{entry:string,on:string}[], logs:number, why?:string}} */
export function coverageOf(answer) {
	const ok = answer?.ok;
	const count = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0);
	if (ok === null || typeof ok !== 'object') return { state: 'unavailable', have: 0, known: 0, waiting: [], logs: 0 };
	const c = ok.coverage;
	const rows = count(ok.count) || (Array.isArray(ok.rows) ? ok.rows.length : 0);
	if (c?.state === 'denied') return { state: 'denied', have: 0, known: 0, waiting: [], logs: 0, why: String(c.why ?? '') };
	if (c?.state !== 'partial') return { state: 'complete', have: rows, known: rows, waiting: [], logs: 0 };
	const waiting = Array.isArray(c.waiting) ? c.waiting.filter((w) => typeof w?.entry === 'string' && typeof w?.on === 'string') : [];
	return { state: 'partial', have: count(c.have), known: count(c.known), waiting, logs: count(c.logs) };
}

/** Candidates the device holds still wait: an exact count or a lookup that must not miss one can't stand yet. Logs
 * behind alone don't count here: what they bring shows as it arrives. */
export const waitsHere = (/** @type {ReturnType<typeof coverageOf>} */ c) => c.state === 'partial' && (c.known > c.have || c.waiting.length > 0);

/** What a mounted read shows as its state (./active-reads.js): loaded, still loading, or unavailable. */
export function readState(/** @type {ReturnType<typeof coverageOf>} */ c) {
	if (c.state === 'complete') return 'local';
	if (c.state === 'partial') return 'pending';
	return 'unavailable';
}

/** A read's freshness (aven/db/spec/AvenDB/Freshness.lean), which the device stamps on every read, whatever it reads:
 * `current` (a live peer, every live peer heard, the read complete), `offline` as of `asOf` (Unix ms of the device's
 * last current read, 0 for never: no live peer, so it shows what it holds as of then), or `behind` (a live peer holds
 * newer data for the read's scope, `logs`; candidates wait, `waits`; or a peer was not heard yet, `unheard`): the
 * device fetches that scope first, and a page shows it catching up, never as final. One value for every page, query,
 * schema and type: no page decides it for itself. A device from before it names none: current, for one release.
 * @param {any} answer @returns {{state:'current'|'offline'|'behind', asOf:number, logs:number, waits:number, unheard:number}} */
export function freshnessOf(answer) {
	const f = answer?.fresh;
	const n = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : 0);
	if (f?.state === 'offline') return { state: 'offline', asOf: n(f.asOf), logs: 0, waits: 0, unheard: 0 };
	if (f?.state === 'behind') return { state: 'behind', asOf: 0, logs: n(f.logs), waits: n(f.waits), unheard: n(f.unheard) };
	return { state: 'current', asOf: 0, logs: 0, waits: 0, unheard: 0 };
}

/** What an action (approve, accept, decline, delete) does with a read's freshness (`Freshness.act`): `go` on current,
 * `wait` while behind, and offline `confirm`: it says plainly it acts on data as of `asOf`.
 * @param {ReturnType<typeof freshnessOf>} f @returns {'go'|'wait'|'confirm'} */
export const actOf = (f) => (f.state === 'current' ? 'go' : f.state === 'behind' ? 'wait' : 'confirm');

/** Whether an action's sheet opens (`Freshness.opens`): by itself (`asked` false) only on current data; when the person
 * asked, offline too, said to be as of then; never while behind.
 * @param {ReturnType<typeof freshnessOf>} f @param {boolean} [asked] */
export const opensOn = (f, asked = false) => { const a = actOf(f); return a === 'go' || (a === 'confirm' && asked); };

/** Whether a read's rows may show as they are: current, or offline and said to be as of then. Behind, they are an
 * older state still catching up: a page shows the catching up, never them as final.
 * @param {ReturnType<typeof freshnessOf>} f */
export const showsFinal = (f) => f.state !== 'behind';
