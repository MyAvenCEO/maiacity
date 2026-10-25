import { answer } from './ops.js';
import { readCompleteness } from './read-completeness.js';

/** One mounted canonical collection, driven by the shared authorized local observer.
 * Keeps no world fallback: a ready empty result and a failed read are different states.
 * Query/context replacement resets rows; api.observe rejects late old-owner replies.
 * @param {() => { observe: (query: () => any, take: (out: any) => void, failed: (error: Error) => void) => () => void }} api
 * @param {() => object} query
 */
export function entryCollection(api, query) {
	let rows = $state(/** @type {import('./vaults.js').EntryView[]} */ ([]));
	let totalEntries = $state(0);
	let readableEntries = $state(0);
	let phase = $state(/** @type {'loading' | 'ready' | 'error'} */ ('loading'));
	let error = $state('');
	let completeness = $state(readCompleteness(null));
	$effect(() => {
		const owner = api();
		const op = query();
		rows = [];
		completeness = readCompleteness(null);
		totalEntries = readableEntries = 0;
		phase = 'loading';
		error = '';
		const failed = (/** @type {Error} */ cause) => {
			rows = []; totalEntries = readableEntries = 0;
			completeness = readCompleteness(null);
			error = cause.message; phase = 'error';
		};
		return owner.observe(() => op, (out) => {
			try {
				const got = answer(out);
				completeness = readCompleteness(out);
				// No identity/view yet is not an authoritative empty collection.
				if (!got) { rows = []; totalEntries = readableEntries = 0; phase = 'loading'; return; }
				rows = got.rows;
				totalEntries = got.totalEntries;
				readableEntries = got.readableEntries;
				error = ''; phase = completeness.deferredCandidates > 0 && !rows?.length ? 'loading' : 'ready';
			} catch (cause) { failed(cause instanceof Error ? cause : new Error(String(cause))); }
		}, failed);
	});
	return {
		get completeness() { return { ...completeness }; },
		get rows() { return rows; }, get totalEntries() { return totalEntries; },
		get readableEntries() { return readableEntries; }, get phase() { return phase; }, get error() { return error; }
	};
}
