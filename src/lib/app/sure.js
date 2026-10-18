/*
 * A yes-or-no question before something that can't be taken back. In the Mac app `window.confirm` doesn't work: the
 * dialog plugin's stand-in asks for a `confirm` command that plugin 2.8 no longer has, and answers with a promise,
 * which reads as yes. So the app asks through the plugin's `message` command (vault/app/capabilities/default.json
 * allows it), as the plugin's own `confirm` does; in a browser, `window.confirm`.
 */

import { command, native } from '$lib/native';

/** Whether the person said yes to `message`. @param {string} message @returns {Promise<boolean>} */
export async function sure(message) {
	if (!native()) return window.confirm(message);
	try {
		return (await command('plugin:dialog|message', { message, kind: 'warning', buttons: 'OkCancel' })) === 'Ok';
	} catch (e) {
		console.warn('sure:', e);
		return false;
	}
}
