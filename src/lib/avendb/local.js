// Connect renderers to their local avenDB instance. Missing/locked devices never authorize remote fallback.
import { native } from '$lib/native';
import { deviceOf, useBuiltInManifests, useDevice } from '../../../game/code/sources/device.js';
import { MANIFESTS } from './manifests.js';
import { readLocalFile } from './ops.js';

// until Maia City holds a manifest of an id, the app's own of it says what a page asks for first
useBuiltInManifests(MANIFESTS);

/** Bound connection setup; callers show an explicit local-device error and offer retry. */
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
	read: (/** @type {string} */ root, /** @type {number} */ size, /** @type {number} */ from, /** @type {number} */ to) =>
		readLocalFile((op) => d.run(op), root, size, from, to)
});
