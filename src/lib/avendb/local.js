// Connect renderers to their local avenDB instance. Missing/locked devices never authorize remote fallback.
import { native } from '$lib/native';
import { deviceOf, useDevice } from '../../../game/code/sources/device.js';
import { answer } from './ops.js';

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
	read: async (/** @type {string} */ root, /** @type {number} */ size, /** @type {number} */ from, /** @type {number} */ to) => {
		const out = await d.run({ op: 'read_file', root, size, from, to, local: true });
		answer(out);
		return out.bytes;
	}
});
