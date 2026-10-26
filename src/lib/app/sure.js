/*
 * A yes-or-no question before something that can't be taken back. In the Mac app `window.confirm` doesn't work, so
 * the app asks the Mac's own alert (the `sure` command, vault/app/src/dialog.rs); in a browser, `window.confirm`.
 */

import { command, native } from '$lib/native';

/** Whether the person said yes to `message`. @param {string} message @returns {Promise<boolean>} */
export async function sure(message) {
	if (!native()) return window.confirm(message);
	try {
		return (await command('sure', { message })) === true;
	} catch (e) {
		console.warn('sure:', e);
		return false;
	}
}
