import { answer } from './ops.js';
import { readCompleteness } from './read-completeness.js';

/** A mounted targeted read. Reset on query/owner replacement and never retain a failed response.
 * Scheduling leases and old-owner suppression belong to api.observe, shared with collections.
 * @param {() => any} api @param {() => any} query */
export function entryDetail(api, query) {
	let phase = $state(/** @type {'loading' | 'ready' | 'error'} */ ('loading'));
	let value = $state.raw(/** @type {any} */ (null));
	$effect(() => {
		const owner = api(), op = query();
		value = null; phase = op ? 'loading' : 'ready';
		return owner.observe(() => op, (/** @type {any} */ out) => {
			try { value = answer(out); phase = 'ready'; } catch { value = null; phase = 'error'; }
		}, () => { value = null; phase = 'error'; });
	});
	return { get completeness() { return readCompleteness(value === null ? null : {ok:value}); }, get value() { return value; }, get phase() { return phase; } };
}
