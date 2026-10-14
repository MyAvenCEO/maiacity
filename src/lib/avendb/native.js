// avenDB's device in the Mac app, maiaCITY Studio: run natively beside the app as its sidecar (avendb/crates/
// avendb-device, vault/app/src/avendb.rs), not in this page's WebAssembly. Its node reaches the person's other devices
// directly, over UDP sockets of its own, and keeps their vault in a folder on the Mac, not in the page's store; it runs
// on while the app does, whichever page is open. Each ceremony of the person's passkey it asks for runs in the app's
// sign-in sheet, which the app shows for it: the page sees none of it. `NativeDevice` answers the page as the page's
// own device does (avendb-browser's `PageDevice`): every read and change one op through `run`, each one of the app's
// calls (avendb/docs/ARCHITECTURE.md §8).

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

/** Bytes as base64, as the app's device takes a file's chunks. @param {Uint8Array} bytes */
export function base64(bytes) {
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}

/** Base64 as bytes, as the app's device hands a file's over. @param {string} text */
export function unbase64(text) {
	const raw = atob(text);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

/** How many bytes of a file the page hands the app's device at a time. */
const CHUNK = 1 << 20;

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

	/**
	 * Op `op`, any read or change of the database (avendb/docs/ARCHITECTURE.md §8): its answer, `{ ok }` or
	 * `{ refused, why }`; the passkey's ceremonies, where its vault's owners approve it, run in the app's sheet, so
	 * `ceremony` goes unused. A `put_file` op's bytes come from `read(at, n)`, a megabyte at a time, each in base64 to
	 * the app's device, which seals them into its store as they come; a `read_file` op's come back as `bytes`, as the
	 * page's device hands them.
	 * @param {any} op @param {unknown} [ceremony] @param {(at: number, n: number) => Promise<Uint8Array>} [read]
	 */
	async run(op, ceremony, read) {
		if (op?.op === 'put_file' && read) return this.putFile(op, read);
		const out = await call('run', op);
		if (op?.op === 'read_file' && typeof out?.bytes === 'string') return { ...out, bytes: unbase64(out.bytes) };
		return out;
	}

	/**
	 * A `put_file` op, its bytes handed over as `read` reads them: the op's answer.
	 * @param {{ len: number }} op @param {(at: number, n: number) => Promise<Uint8Array>} read
	 */
	async putFile(op, read) {
		const n = await call('fileStart', op);
		try {
			for (let at = 0; at < op.len; ) {
				const bytes = await read(at, Math.min(CHUNK, op.len - at));
				if (!bytes.length) throw new Error('the file ends early');
				await call('fileChunk', n, at, base64(bytes));
				at += bytes.length;
			}
			return await call('fileEnd', n);
		} catch (e) {
			await call('fileDrop', n).catch(() => {});
			throw e;
		}
	}

	/** This page lets go of it: the device runs on in the app, syncing, and opens here again without a ceremony. */
	close() {
		this.closed = true;
	}
}
