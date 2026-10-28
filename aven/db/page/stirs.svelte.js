// @ts-nocheck — plain JS, kept loose on purpose
import { untrack } from 'svelte';
import { session } from './session.svelte.js';
import { watchStirs } from './stirs.js';

/** A subscription belongs to one open device. A phase/device change disposes its wait and reads the replacement
 * immediately, without carrying the previous device's revision over. The caller disposes the root on unmount. */
export function onStir(read, options) {
	return $effect.root(() => {
		$effect(() => {
			const device = session.phase === 'open' ? session.device : null;
			return untrack(() => watchStirs(device, read, options));
		});
	});
}
