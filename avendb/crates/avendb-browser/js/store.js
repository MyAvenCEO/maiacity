// avenDB's store in the browser (v8 phase S): the shelf a page's device keeps in the origin private file system (OPFS),
// laid out as every place lays out its own (`avendb_net::shelf`), by a worker of its own (`store.worker.js`), where
// OPFS has its fast synchronous files. The store carries bytes alone: what they mean, the device reads and writes
// itself (avendb-browser's `shelf_of`), its edits as a journal, packs and heads, its McEliece keys and the pieces of
// the files it brings or keeps as blobs, and what opens it again (`storeMeta`). No secret is kept: the device's keys
// come back from its passkey at every unlock. OPFS is the one place the page keeps any of it: a new device, or one
// forgotten, starts a new generation of it, and the old stays aside (`aside`), whole: avenDB is never reset, and
// nothing clears it.

/** A worker of its own for a store. */
const worker = () => new Worker(new URL('./store.worker.js', import.meta.url), { type: 'module' });

/** Opens the store named `name` (one per device of the page), in its newest generation. */
export async function open(name = 'avendb') {
	// asks the browser to keep what the origin stores should it run short of space, without waiting for the answer,
	// which a browser may ask its person for
	navigator.storage?.persist?.().catch(() => {});
	const store = new Store(worker());
	await store.call('open', [name]);
	return store;
}

/** Whether `bytes` is the whole of its buffer, which the call can then hand over rather than copy. */
const whole = (bytes) => bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;

export class Store {
	constructor(worker) {
		this.worker = worker;
		this.calls = new Map();
		this.next = 0;
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

	/** Holds the store for this page alone, until `release`: refused while another tab holds it. */
	hold() {
		return this.call('hold');
	}

	release() {
		return this.call('release');
	}

	/** Puts the generation in use aside, never deleting it, and starts a new one, empty, in use from now on: as a
	 *  device is forgotten here. Its number. */
	aside() {
		return this.call('aside');
	}

	// The shelf's calls (`avendb_net::shelf::Call`), which the device makes of it: the blobs it holds whole, each
	// `[hash, size]`, a blob's bytes and its outboard, a blob written and finished or dropped, and its objects, each
	// put once (false if other bytes are there) and got (`undefined` if none is), and their names.

	list() {
		return this.call('list');
	}

	read(name, at, len) {
		return this.call('read', [name, at, len]);
	}

	outboard(hash) {
		return this.call('outboard', [hash]);
	}

	write(name, at, bytes) {
		return this.call('write', [name, at, bytes], whole(bytes) ? [bytes.buffer] : []);
	}

	finish(name, hash, size, outboard) {
		return this.call('finish', [name, hash, size, outboard], whole(outboard) ? [outboard.buffer] : []);
	}

	drop(name) {
		return this.call('drop', [name]);
	}

	put(name, bytes) {
		return this.call('put', [name, bytes]);
	}

	/** Replaces a derived slot, acknowledging only after the OPFS worker finishes it. */
	keep(name, bytes) {
		return this.call('keep', [name, bytes]);
	}

	get(name) {
		return this.call('get', [name]);
	}

	names(prefix) {
		return this.call('names', [prefix]);
	}

	/** Lets go of the store, and stops its worker. */
	close() {
		return this.call('close')
			.catch(() => {})
			.finally(() => {
				this.worker.terminate();
				this.fail('the store is closed');
			});
	}
}
