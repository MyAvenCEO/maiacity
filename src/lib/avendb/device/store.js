// @ts-nocheck: written by avendb/scripts/build-web.sh from avenDB
// avenDB's device store in the browser (P8e): what a page's device holds, kept in IndexedDB as a node keeps it on
// disk. `ops` holds its signed edits, each as its bytes on the wire, under its place in the order the device took them;
// `keys` its McEliece keys, each under its id; `meta` what opens the device again: its name, its salt's own bytes, its
// passkey's credential and P-256 key, and the relay. No secret is kept: the device's keys derive from its passkey at
// every unlock, and it opens the rest again from its edits.

// the store of edits keeps the name it had when an edit was called an op, so every browser's store opens as it is
const EDITS = 'ops';
const STORES = ['meta', EDITS, 'keys'];

function request(r) {
	return new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

function done(tx) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = tx.onabort = () => reject(tx.error);
	});
}

/** Opens the store named `name` (one per device of the page). */
export async function open(name = 'avendb') {
	const r = indexedDB.open(name, 1);
	r.onupgradeneeded = () => STORES.forEach((s) => r.result.createObjectStore(s));
	return new Store(await request(r));
}

export class Store {
	constructor(db) {
		this.db = db;
		this.written = 0;
		this.keys = new Set();
	}

	/** What opens the device again, or `undefined` if the store holds no device yet. */
	meta() {
		return request(this.db.transaction('meta').objectStore('meta').get('device'));
	}

	async setMeta(meta) {
		const tx = this.db.transaction('meta', 'readwrite');
		tx.objectStore('meta').put(meta, 'device');
		await done(tx);
	}

	/** What the store kept: `{edits, keys}`, each a list of bytes, the edits in order. */
	async load() {
		const tx = this.db.transaction([EDITS, 'keys']);
		const [edits, ids, keys] = await Promise.all([
			request(tx.objectStore(EDITS).getAll()),
			request(tx.objectStore('keys').getAllKeys()),
			request(tx.objectStore('keys').getAll())
		]);
		this.written = edits.length;
		this.keys = new Set(ids);
		return { edits, keys };
	}

	/**
	 * Saves what `device` took since the last save, its new edits and McEliece keys, in one transaction; if it holds
	 * fewer edits than the store, as some failed their checks as it opened, the store's edits are written anew. True
	 * if there was anything new.
	 */
	async save(device) {
		let edits = await device.edits(this.written);
		const rewrite = edits === undefined;
		if (rewrite) edits = await device.edits(0);
		const ids = (await device.keyIds()).filter((id) => !this.keys.has(id));
		const keys = await Promise.all(ids.map((id) => device.key(id)));
		if (!rewrite && !edits.length && !ids.length) return false;
		const from = rewrite ? 0 : this.written;
		const tx = this.db.transaction([EDITS, 'keys'], 'readwrite');
		const store = tx.objectStore(EDITS);
		if (rewrite) store.clear();
		edits.forEach((edit, i) => store.put(edit, from + i));
		ids.forEach((id, i) => keys[i] && tx.objectStore('keys').put(keys[i], id));
		await done(tx);
		this.written = from + edits.length;
		ids.forEach((id, i) => keys[i] && this.keys.add(id));
		return true;
	}

	/** Saves what `device` holds now and after each change, until it closes. */
	async follow(device) {
		for (;;) {
			await this.save(device);
			if (!(await device.changed(this.written, this.keys.size))) return;
		}
	}

	close() {
		this.db.close();
	}
}

/** Removes the store named `name`, and with it the device the page made. */
export function remove(name = 'avendb') {
	return request(indexedDB.deleteDatabase(name));
}
