// avenDB's device store in the browser (P8e, B2b): what a page's device holds, kept in the origin private file system
// (OPFS) as a node keeps it on disk, by a worker of its own (`store.worker.js`), where OPFS has its fast synchronous
// files: its signed edits in the order it took them, its McEliece keys, and what opens the device again (its name, its
// salt's own bytes, its passkey's credential and P-256 key, and the relay), and its node's shelf, the pieces of the
// files it brings or keeps (B2d). No secret is kept: the device's keys derive from its passkey at every unlock, and it
// opens the rest again from its edits. OPFS is the one place the page keeps
// any of it: a store IndexedDB kept, as pages did before, moves over the first time it opens, and is deleted.

/** The stores closing, by name: one is removed only once its worker let go of it. */
const closing = new Map();

/** A worker of its own for a store. */
const worker = () => new Worker(new URL('./store.worker.js', import.meta.url), { type: 'module' });

/** Opens the store named `name` (one per device of the page). */
export async function open(name = 'avendb') {
	// asks the browser to keep what the origin stores should it run short of space, without waiting for the answer,
	// which a browser may ask its person for
	navigator.storage?.persist?.().catch(() => {});
	const store = new Store(name, worker());
	await store.call('open', [name]);
	return store;
}

export class Store {
	constructor(name, worker) {
		this.name = name;
		this.worker = worker;
		this.calls = new Map();
		this.next = 0;
		this.written = 0;
		this.keys = new Set();
		worker.onmessage = ({ data }) => {
			const call = this.calls.get(data.id);
			this.calls.delete(data.id);
			if ('error' in data) call?.reject(new Error(data.error));
			else call?.resolve(data.ok);
		};
		worker.onerror = (e) => this.fail(`the store's worker failed: ${e.message}`);
	}

	/** Every call still waiting fails with `why`. */
	fail(why) {
		this.calls.forEach((call) => call.reject(new Error(why)));
		this.calls.clear();
	}

	/** Runs `op` in the worker, handing it what `moved` holds. */
	call(op, args = [], moved = []) {
		const id = this.next++;
		return new Promise((resolve, reject) => {
			this.calls.set(id, { resolve, reject });
			this.worker.postMessage({ id, op, args }, moved);
		});
	}

	/** What opens the device again, or `undefined` if the store holds no device yet. */
	meta() {
		return this.call('meta');
	}

	setMeta(meta) {
		return this.call('setMeta', [meta]);
	}

	/**
	 * What the store kept: `{edits, keys}`, each a list of bytes, the edits in order. From now on the store holds its
	 * edits for this page alone, until the device closes: the same device can't run in two tabs.
	 */
	async load() {
		const kept = await this.call('load');
		this.written = kept.edits.length;
		this.keys = new Set(kept.ids);
		return kept;
	}

	/**
	 * Saves what `device` took since the last save, its new edits and McEliece keys; if it holds fewer edits than the
	 * store, as some failed their checks as it opened, the store's edits are written anew. A key the store kept that
	 * the device doesn't hold, one a crash cut short, is dropped. True if there was anything new.
	 */
	async save(device) {
		let edits = await device.edits(this.written);
		const rewrite = edits === undefined;
		if (rewrite) edits = await device.edits(0);
		const held = await device.keyIds();
		const ids = held.filter((id) => !this.keys.has(id));
		const drop = [...this.keys].filter((id) => !held.includes(id));
		const keys = await Promise.all(ids.map((id) => device.key(id)));
		const fresh = ids.flatMap((id, i) => (keys[i] ? [[id, keys[i]]] : []));
		if (!rewrite && !edits.length && !fresh.length && !drop.length) return false;
		const from = rewrite ? 0 : this.written;
		await this.call('save', [{ from, edits, keys: fresh, drop }]);
		this.written = from + edits.length;
		fresh.forEach(([id]) => this.keys.add(id));
		drop.forEach((id) => this.keys.delete(id));
		return true;
	}

	/** Saves what `device` holds now and after each change, until it closes; then lets go of its edits. */
	async follow(device) {
		try {
			for (;;) {
				await this.save(device);
				if (!(await device.changed(this.written, this.keys.size))) return;
			}
		} finally {
			await this.call('release').catch(() => {});
		}
	}

	/** The blobs the shelf in OPFS holds whole, each `[hash, size]` (B2d, `avendb_net::shelf`), its node's: the
	 *  calls the device makes of it, as it keeps the pieces of its files there. */
	blobs() {
		return this.call('blobs');
	}

	blobRead(name, at, len) {
		return this.call('blobRead', [name, at, len]);
	}

	blobOutboard(hash) {
		return this.call('blobOutboard', [hash]);
	}

	blobWrite(name, at, bytes) {
		return this.call('blobWrite', [name, at, bytes]);
	}

	blobFinish(name, hash, size, outboard) {
		return this.call('blobFinish', [name, hash, size, outboard]);
	}

	blobDrop(name) {
		return this.call('blobDrop', [name]);
	}

	/** Lets go of the store, and stops its worker. */
	close() {
		const closed = this.call('close')
			.catch(() => {})
			.finally(() => {
				this.worker.terminate();
				this.fail('the store is closed');
			});
		closing.set(this.name, closed);
		return closed;
	}
}

/** Removes the store named `name`, and with it the device the page made. */
export async function remove(name = 'avendb') {
	await closing.get(name);
	const store = new Store(name, worker());
	try {
		await store.call('remove', [name]);
	} finally {
		store.worker.terminate();
	}
}
