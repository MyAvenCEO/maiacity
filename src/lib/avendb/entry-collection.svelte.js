import { untrack } from 'svelte';
import { answer } from './ops.js';
import { stillNamed } from './kept-answers.js';
import { coverageOf } from '../../../game/code/sources/coverage.js';

/** One mounted canonical collection, driven by the shared authorized local observer.
 * Keeps no world fallback: a ready empty result and a failed read are different states.
 * Query/context replacement resets rows; api.observe rejects late old-owner replies. Where only the entries an op names
 * change (a list whose rooms arrive one by one as the device catches up), the rows of those still named stay while the
 * new answer is read: each row is its entry's alone, the same in any list that names it.
 * @param {() => { observe: (query: () => any, take: (out: any) => void, failed: (error: Error) => void) => () => void }} api
 * @param {() => object} query
 */
export function entryCollection(api, query) {
	let rows = $state(/** @type {import('./vaults.js').EntryView[]} */ ([]));
	let totalEntries = $state(0);
	let readableEntries = $state(0);
	let phase = $state(/** @type {'loading' | 'ready' | 'error'} */ ('loading'));
	let error = $state('');
	let coverage = $state(coverageOf(null));
	let last = /** @type {{ owner: any, op: any } | null} */ (null);
	$effect(() => {
		const owner = api();
		const op = query();
		const still = last?.owner === owner ? stillNamed(last.op, op) : null;
		last = { owner, op };
		const kept = still ? untrack(() => rows).filter((r) => still.has(r?.entry)) : [];
		rows = kept;
		coverage = coverageOf(null);
		totalEntries = readableEntries = 0;
		phase = 'loading';
		error = '';
		const failed = (/** @type {Error} */ cause) => {
			rows = []; totalEntries = readableEntries = 0;
			coverage = coverageOf(null);
			error = cause.message; phase = 'error';
		};
		return owner.observe(() => op, (out) => {
			try {
				const got = answer(out);
				coverage = coverageOf(out);
				// No identity/view yet is not an authoritative empty collection.
				if (!got) { rows = []; totalEntries = readableEntries = 0; phase = 'loading'; return; }
				rows = got.rows;
				totalEntries = got.totalEntries;
				readableEntries = got.readableEntries;
				error = ''; phase = 'ready';
			} catch (cause) { failed(cause instanceof Error ? cause : new Error(String(cause))); }
		}, failed);
	});
	return {
		get coverage() { return { ...coverage }; },
		get rows() { return rows; }, get totalEntries() { return totalEntries; },
		get readableEntries() { return readableEntries; }, get phase() { return phase; }, get error() { return error; }
	};
}

