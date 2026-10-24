// @ts-nocheck — plain JS
import { createAipScope } from './aip-scope.js';
import { session } from './session.svelte.js';

/** the AIPs, as the last answer listed them @type {any[]} */
let list = $state.raw([]);
/** whether the device answered yet */
let read = $state(false);
/** why the last read didn't go through, '' once one did */
let why = $state('');

let refresh = $state(0);
let identity, previousPhase;
const reset = () => { list = []; read = false; why = ''; };
const scope = createAipScope({
	observe: (...args) => session.observe(...args),
	query: () => {
		void refresh;
		const phase = session.phase, device = session.device;
		if (identity !== device || previousPhase !== phase) { identity = device; previousPhase = phase; reset(); }
		return phase === 'open' ? { op: 'aips' } : null;
	},
	reset,
	take: (got) => {
		if (Array.isArray(got?.ok)) [list, read, why] = [got.ok, true, ''];
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
	/** Mount lifetime owns the observer and its discovery lease. */
	hold: scope.hold,
	/** Explicit refresh joins the same observer; never starts an unscoped read. */
	again: () => { refresh++; return Promise.resolve(); }
};
