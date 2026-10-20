// Local first: a page reads what the person's own avenDB device holds before it asks avenDB's server (the feed). In the
// Mac app the app's device runs natively beside every window, but a window whose page holds no session (the world
// renderer's, vault/app/src/world.rs, or a page outside /app/ such as an asset's own) finds it only once it asks:
// `localDevice` asks, a few seconds at most, before the page reads, and reads off it from then on. It only reads (the
// code and files the page runs, `bring`): the session, ./session.svelte.js, is the app's windows', which change and
// move keys. A frame of a page with a device reads its parent's (game/code/sources/device.js `deviceOf`), and a
// browser's device opens only with its person's passkey, so neither waits here.

import { native } from '$lib/native';
import { deviceOf, useDevice } from '../../../game/code/sources/device.js';
import { answer } from './ops.js';

/** How long (ms) a page waits for the app's device before it reads off the feed instead: it answers at once when it
 *  runs, and the session of a page that has one switches to it once it opens ($lib/assets/vault.js `loadRecipes`). */
const WAIT = 5000;

/**
 * The device this page reads first: its own or its parent page's, else, in the Mac app, the app's if it is open; null
 * where there is none (yet).
 * @param {number} [wait] ms
 * @returns {Promise<any>}
 */
export async function localDevice(wait = WAIT) {
	if (typeof window === 'undefined' || deviceOf() || !native()) return deviceOf();
	const mac = import('./native.js').then(async ({ status, NativeDevice }) => {
		const { device } = await status();
		if (device && !deviceOf()) useDevice(readerOf(new NativeDevice(device)));
	});
	let timer;
	await Promise.race([mac.catch(() => {}), new Promise((ok) => (timer = setTimeout(ok, wait)))]);
	clearTimeout(timer);
	return deviceOf();
}

/** What a page reads off device `d`: its ops, and a file's bytes by range, as the session reads them. @param {any} d */
const readerOf = (d) => ({
	run: (/** @type {any} */ op) => d.run(op),
	read: async (/** @type {string} */ root, /** @type {number} */ size, /** @type {number} */ from, /** @type {number} */ to) => {
		const out = await d.run({ op: 'read_file', root, size, from, to });
		answer(out);
		return out.bytes;
	}
});
