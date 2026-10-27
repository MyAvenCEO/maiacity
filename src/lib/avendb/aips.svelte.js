import { createAipScope } from './aip-scope.js';
import { session } from './session.svelte.js';
import { freshnessOf } from '../../../game/code/sources/coverage.js';

/** the AIPs, as the last answer listed them @type {any[]} */
let list = $state.raw([]);
/** whether the device answered yet */
let read = $state(false);
/** why the last read didn't go through, '' once one did */
let why = $state('');
/** how fresh the last answer is (avendb/spec/AvenDB/Freshness.lean): behind until the device holds the latest */
let fresh = $state.raw(freshnessOf({ fresh: { state: 'behind' } }));

let refresh = $state(0);
/** @type {any} */
let identity;
/** @type {string | undefined} */
let previousPhase;
const reset = () => { list = []; read = false; why = ''; fresh = freshnessOf({ fresh: { state: 'behind' } }); };
const scope = createAipScope({
	observe: (query, take, failed) => session.observe(query, take, failed),
	query: () => {
		void refresh;
		const phase = session.phase, device = session.device;
		if (identity !== device || previousPhase !== phase) { identity = device; previousPhase = phase; reset(); }
		return phase === 'open' ? { op: 'aips' } : null;
	},
	reset,
	take: (got) => {
		if (Array.isArray(got?.ok)) [list, read, why, fresh] = [got.ok, true, '', freshnessOf(got)];
		else { list = []; read = false; why = got?.why ?? got?.refused ?? 'avenDB did not answer'; }
	},
	failed: (e) => { list = []; read = false; why = e.message; }
});

export const aips = {
	/** the AIPs, as the device answered last */
	get list() {
		return list;
	},
	/** whether the device answered `aips` yet */
	get read() {
		return read;
	},
	/** why the last read didn't go through, '' if it did */
	get why() {
		return why;
	},
	/** how fresh the AIPs are: a page shows them as final, and an action sheet opens, only as this says (./fresh.js) */
	get fresh() {
		return fresh;
	},
	/** Mount lifetime owns the observer and its discovery lease. */
	hold: scope.hold,
	/** Explicit refresh joins the same observer; never starts an unscoped read. */
	again: () => { refresh++; return Promise.resolve(); }
};
