// @ts-nocheck — shared browser/native JS
/** A read's coverage (avendb/spec/AvenDB/Coverage.lean): the one answer to "is this read complete?". The device says
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
