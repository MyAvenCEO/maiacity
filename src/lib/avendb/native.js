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

	/** @param {string} actor @param {string} vault @param {string} title @param {string} body @param {string[]} tags */
	write(actor, vault, title, body, tags) {
		return call('write', actor, vault, title, body, tags);
	}

	/** @param {string} actor @param {string} vault @param {string} title @param {string[]} tags */
	todo(actor, vault, title, tags) {
		return call('todo', actor, vault, title, tags);
	}

	/** @param {string} actor @param {string} entry @param {string} status */
	setStatus(actor, entry, status) {
		return call('setStatus', actor, entry, status);
	}

	/** @param {string} actor @param {string} entry @param {string[]} add @param {string[]} remove */
	tag(actor, entry, add, remove) {
		return call('tag', actor, entry, add, remove);
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
	 * @param {string} actor @param {string} entry @param {string | null} line @param {number} block @param {string} text
	 */
	setTextOn(actor, entry, line, block, text) {
		return call('setTextOn', actor, entry, line, block, text);
	}

	/** @param {string} actor @param {string} entry @param {string | null} line @param {string} title */
	setTitleOn(actor, entry, line, title) {
		return call('setTitleOn', actor, entry, line, title);
	}

	/** @param {string} actor @param {string} entry @param {string[]} from @param {string} name */
	propose(actor, entry, from, name) {
		return call('propose', actor, entry, from, name);
	}

	/**
	 * @param {string} actor @param {string} entry @param {string | null} from @param {string | null} into
	 * @param {boolean} promote
	 */
	merge(actor, entry, from, into, promote) {
		return call('merge', actor, entry, from, into, promote);
	}

	/** @param {string} actor @param {string} entry @param {string | null} line @param {string[]} version */
	restore(actor, entry, line, version) {
		return call('restore', actor, entry, line, version);
	}

	/** @param {string} actor @param {string} entry @param {string | null} line @param {string} edit */
	undo(actor, entry, line, edit) {
		return call('undo', actor, entry, line, edit);
	}

	/** @param {string} actor @param {string} entry @param {string | null} line @param {string} into */
	variant(actor, entry, line, into) {
		return call('variant', actor, entry, line, into);
	}

	/**
	 * A cap, as the page's device issues it: role `role` on what `slice` selects of vault `over`, to vault `grantee` or
	 * `"public"`; the passkey's ceremony, if it needs one, runs in the app's sheet.
	 * @param {string} issuer @param {string} over @param {import('./vaults.js').Slice} slice @param {string} role
	 * @param {string} grantee
	 */
	share(issuer, over, slice, role, grantee) {
		return call('share', issuer, over, slice, role, grantee);
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
