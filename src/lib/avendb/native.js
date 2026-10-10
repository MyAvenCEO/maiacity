// avenDB's device in the Mac app, maiaCITY Studio: run natively beside the app as its sidecar (avendb/crates/
// avendb-device, vault/app/src/avendb.rs), not in this page's WebAssembly. Its node reaches the person's other devices
// directly, over UDP sockets of its own, and keeps their vault in a folder on the Mac, not in IndexedDB; it runs on
// while the app does, whichever page is open. Each ceremony of the person's passkey it asks for runs in the app's
// sign-in sheet, which the app shows for it: the page sees none of it. `NativeDevice` answers the page as the page's
// own device does (avendb-browser's `PageDevice`), each call one of the app's.

import { command } from '$lib/native';

/**
 * Calls `name` with `args` on the app's device: what it answered, or an error saying why not.
 * @param {string} name @param {...unknown} args @returns {Promise<any>}
 */
export function call(name, ...args) {
	return command('avendb', { call: name, args }).catch((e) => {
		throw e instanceof Error ? e : new Error(String(e));
	});
}

/**
 * What the app's folder holds: `meta`, what opens the device there (its name, relay, salt's own bytes, and its
 * passkey's credential and key), and the device, if it is open; or `null` if the app can't run avenDB natively, as
 * when its device didn't build with the app, and the page runs it instead.
 * @returns {Promise<{ meta: any, open: boolean, device: any } | null>}
 */
export async function status() {
	try {
		return await call('status');
	} catch (e) {
		console.warn(`avenDB runs in the page: ${/** @type {Error} */ (e).message}`);
		return null;
	}
}

/** Bytes as base64, as the app's device takes the edits and keys the page's store kept. @param {Uint8Array} bytes */
export function base64(bytes) {
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}

/** The app's device, once open, as the page's own device answers it. */
export class NativeDevice {
	/** @param {{ id: string, endpoint: string, passkey: string, offer: string, sockets: string[] }} info */
	constructor(info) {
		this.info = info;
		this.closed = false;
	}

	id() {
		return this.info.id;
	}

	endpoint() {
		return this.info.endpoint;
	}

	/** Its person's passkey's P-256 key, in hex. */
	passkey() {
		return this.info.passkey;
	}

	/** Its code, for the next device of its person to link through. */
	offer() {
		return this.info.offer;
	}

	/** The UDP sockets its node bound, on which it reaches its peers directly. */
	sockets() {
		return this.info.sockets ?? [];
	}

	size() {
		return call('size');
	}

	/** Whether it changed since it held `edits` edits and `keys` keys, once it does: false once it closed, or this page
	 *  let go of it. The app answers each ask within a minute, `null` if nothing changed yet, and it asks again.
	 *  @param {number} edits @param {number} keys */
	async changed(edits, keys) {
		while (!this.closed) {
			const changed = await call('changed', edits, keys);
			if (changed !== null) return !this.closed && changed;
		}
		return false;
	}

	world() {
		return call('world');
	}

	/** @param {string} name */
	card(name) {
		return call('card', name);
	}

	/** @param {string} vault @param {string} name */
	profile(vault, name) {
		return call('profile', vault, name);
	}

	/** Whether avenDB's server backs up the person's vault, or only relays for it; `null` if it holds no cap on it. */
	backsUp() {
		return call('backsUp');
	}

	/** Has avenDB's server back up the person's vault, or only relay for it. @param {boolean} on */
	backUp(on) {
		return call('backUp', on);
	}

	/**
	 * Op `op` of avenDB's ops engine (avendb/docs/OPS.md), any read or change of the entries it holds, whatever their
	 * schema: its answer, `{ ok }` or `{ refused, why }`.
	 * @param {object} op
	 */
	run(op) {
		return call('run', op);
	}

	/** @param {string} vault */
	database(vault) {
		return call('database', vault);
	}

	history() {
		return call('history');
	}

	/** @param {string} entry */
	note(entry) {
		return call('note', entry);
	}

	/**
	 * A cap, as the page's device issues it: the named group of ops `spec` names on what its `where` picks of vault
	 * `over` (`{name, where, ops}`), to vault `grantee` or `"everyone"`; the passkey's ceremony, if it needs one, runs
	 * in the app's sheet.
	 * @param {string} issuer @param {string} over @param {object} spec @param {string} grantee
	 */
	share(issuer, over, spec, grantee) {
		return call('share', issuer, over, spec, grantee);
	}

	/** @param {string} actor @param {string} cap */
	revoke(actor, cap) {
		return call('revoke', actor, cap);
	}

	/** New vaults its person's vault owns, in one ceremony, in the app's sheet. @param {{ name: string, kind: string }[]} vaults */
	foundVaults(vaults) {
		return call('foundVaults', vaults);
	}

	/** This page lets go of it: the device runs on in the app, syncing, and opens here again without a ceremony. */
	close() {
		this.closed = true;
	}
}
