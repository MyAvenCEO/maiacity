// The AIPs this tab's avenDB device holds (`aips`, avendb/docs/ARCHITECTURE.md §8), read once for every page that shows
// them, Proposals and the HITL stack alike, and again each time the device's world changes, one read at a time
// (./latest.js), so a device that syncs for a long while still shows them.

import { latest } from './latest.js';
import { session } from './session.svelte.js';

/** the AIPs, as the last answer listed them @type {any[]} */
let list = $state.raw([]);
/** whether the device answered yet */
let read = $state(false);
/** why the last read didn't go through, '' once one did */
let why = $state('');

const go = latest(
	() => session.ask({ op: 'aips' }),
	(/** @type {any} */ got) => {
		if (Array.isArray(got?.ok)) [list, read, why] = [got.ok, true, ''];
		else why = got?.why ?? got?.refused ?? 'avenDB did not answer';
	},
	(e) => (why = e.message)
);

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
	/** Reads them again, as the world changed, or `soon`, as the person made a change or asked: at once, or after the
	 *  read that runs (./latest.js). @param {boolean} [soon] */
	again: (soon = false) => (session.phase === 'open' ? go(soon) : Promise.resolve())
};
