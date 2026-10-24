import { localOperation } from '../../../game/code/sources/local-policy.js';
// avenDB's device in the Mac app, maiaCITY Studio: hosted in the app’s process (avendb/crates/
// avendb-device, vault/app/src/avendb.rs), not in this page's WebAssembly. Its node reaches the person's other devices
// directly, over UDP sockets of its own, and keeps their vault in a folder on the Mac, not in the page's store; it runs
// on while the app does, whichever page is open. Each ceremony of the person's passkey it asks for runs in the app's
// sign-in sheet, which the app shows for it: the page sees none of it. `NativeDevice` answers the page as the page's
// own device does (avendb-browser's `PageDevice`): every read and change one op through `run`, each one of the app's
// calls (avendb/docs/ARCHITECTURE.md §8). A file's bytes cross between the page and the app as they are, never in
// base64 in JSON: a `read_file`'s come back raw (`avendb_read`), a file's chunks go raw (`avendb_chunk`).

import { command } from '$lib/native';
import { brings } from './ops.js';

/** Throws an error from the app, as an Error. @param {unknown} e @returns {never} */
const why = (e) => {
	throw e instanceof Error ? e : new Error(String(e));
};

/**
 * Calls `name` with `args` on the app's device: what it answered, or an error saying why not. A `run` of a `read_file`
 * op answers its bytes as `bytes`, a `Uint8Array` (`readFile`).
 * @param {string} name @param {...unknown} args @returns {Promise<any>}
 */
export function call(name, ...args) {
	if (name === 'run' && /** @type {any} */ (args[0])?.op === 'read_file') return readFile(localOperation(args[0]));
	return command('avendb', { call: name, args }).catch(why);
}

/**
 * Raw call `name` of the app, its body `body` (bytes, or an object of arguments) and its headers `headers`: its answer,
 * an ArrayBuffer where the app answers bytes.
 * @param {string} name @param {Uint8Array | Record<string, unknown>} body @param {Record<string, string>} [headers]
 * @returns {Promise<any>}
 */
async function raw(name, body, headers) {
	const { invoke } = await import('@tauri-apps/api/core');
	return invoke(name, body, headers && { headers }).catch(why);
}

/**
 * `read_file` op `op` on the app's device, its bytes handed over raw (vault/app/src/avendb.rs `avendb_read`): the op's
 * answer as JSON after its length (four bytes, little-endian), `bytes` in it how many follow, then those bytes, which
 * come back as `bytes`, a `Uint8Array`.
 * @param {any} op @returns {Promise<any>}
 */
async function readFile(op) {
	const all = new Uint8Array(await raw('avendb_read', { op }));
	const n = new DataView(all.buffer, all.byteOffset, all.byteLength).getUint32(0, true);
	const out = JSON.parse(new TextDecoder().decode(all.subarray(4, 4 + n)));
	return typeof out?.bytes === 'number' ? { ...out, bytes: all.subarray(4 + n, 4 + n + out.bytes) } : out;
}

/**
 * What the app's folder holds: `meta`, what opens the device there (its name, relay, salt's own bytes, and its
 * passkey's credential and key), and the device, if it is open. It fails if the embedded native host cannot start.
 * @returns {Promise<{ meta: any, open: boolean, device: any }>}
 */
export const status = () => call('status');

/**
 * What avenDB takes on this Mac's disk (vault/app/src/avendb.rs `avendb_disk`): the device's folder and its agents',
 * each its `path`, `files` and `bytes`.
 * @returns {Promise<{ device: { path: string, files: number, bytes: number }, agents: { path: string, files: number, bytes: number } }>}
 */
export const disk = () => command('avendb_disk').catch(why);

/**
 * Whether this Mac may keep a Touch ID key for avenDB in its Secure Enclave: macOS 26 or later, a Secure Enclave, and
 * a finger enrolled (vault/app/src/enclave.rs). False in an app built without its Secure Enclave bridge.
 * @returns {Promise<boolean>}
 */
export const touchReady = () => command('avendb_touch_ready').then((ready) => ready === true);

/**
 * The drives of the app's device (avendb-device's `drive`), as `drives` answers: each volume plugged into the Mac, by
 * its path and name, what it is to this Mac (`free` for avenDB to use, `hosted` here, `locked` for one ceremony to open
 * here, `removed` from the vault, `other` for another person's, `ejected` here and still mounted, `busy`) and the device
 * on it; and each drive joined
 * here that is a device of the person's vault, whether it is plugged in, on which volume, its name there, and when it
 * last checked what it holds, by its newest signed statement (seconds since 1970).
 * @typedef {{ path: string, name: string,
 *   state: 'free' | 'hosted' | 'locked' | 'removed' | 'other' | 'ejected' | 'busy', device: string | null }} Volume
 * @typedef {{ device: string, name: string | null, volume: string | null, plugged: boolean, checked: number | null }}
 *   Drive
 * @typedef {{ volumes: Volume[], drives: Drive[] }} Drives
 */

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

	/** How many times what the app's node shows changed, once it moved from `since` (`./stirs.js`): -1 once it closed,
	 *  null if nothing changed within a minute (the page asks again). An app from before the op refuses it.
	 *  @param {number} since */
	stirred(since) {
		return this.closed ? Promise.resolve(-1) : call('stirred', since);
	}

	/**
	 * Op `op`, any read or change of the database (avendb/docs/ARCHITECTURE.md §8): its answer, `{ ok }` or
	 * `{ refused, why }`; the passkey's ceremonies, where its vault's owners approve it, run in the app's sheet, so
	 * `ceremony` goes unused. The bytes of a `put_file` op's file, or of the file a `create` op brings (its `file`),
	 * come from `read(at, n)`, a megabyte at a time, each raw to the app's device, which reads them twice, for the
	 * file's key and to seal them into its store; a `read_file` op's come back raw as `bytes`, as the page's device
	 * hands them.
	 * @param {any} op @param {unknown} [ceremony] @param {(at: number, n: number) => Promise<Uint8Array>} [read]
	 */
	async run(op, ceremony, read) {
		if (brings(op) && read) return this.putFile(op, read);
		return call('run', op);
	}

	/**
	 * A `put_file` op, or a `create` op that brings a file, its bytes handed over as `read` reads them, as often as the
	 * device reads the file (twice: once for its key, derived from what it holds, then to seal it): the op's answer.
	 * @param {any} op @param {(at: number, n: number) => Promise<Uint8Array>} read
	 */
	async putFile(op, read) {
		const len = op.op === 'create' ? op.file.len : op.len;
		const n = await call('fileStart', op);
		try {
			do {
				for (let at = 0; at < len; ) {
					const bytes = await read(at, Math.min(CHUNK, len - at));
					if (!bytes.length) throw new Error('the file ends early');
					await raw('avendb_chunk', bytes, { 'x-file': String(n), 'x-at': String(at) });
					at += bytes.length;
				}
			} while (await call('fileAgain', n));
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
