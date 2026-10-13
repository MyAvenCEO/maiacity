// avenDB's device store in the browser, the worker that keeps it (B2b): a page's device's store in the origin private
// file system (OPFS), the one place a browser keeps what avenDB holds, as a node keeps it on disk
// (`avendb_net::Disk`). A worker, because only a worker has OPFS's synchronous files, which write in place and fast.
//
// The store named `name` is the folder `avendb/<name>/`: `ops` holds the device's signed edits in the order it took
// them, each one record, its length in 4 bytes big-endian and then its bytes on the wire, as on disk; `keys/` its
// McEliece keys, each in a file named by its id; `meta` what opens the device again, a record of JSON each time it
// changes, the last one whole counting. No secret is kept: the device's keys derive from its passkey at every unlock,
// and it opens the rest again from its edits. A crash can cut the last record short: reading stops at the first record
// that isn't whole, and `ops` is cut back to the records before it.
//
// While its device runs, the worker holds `ops` open, which OPFS lets only one worker do: the same device can't run in
// two tabs at once. A store IndexedDB kept under the same name, as pages did before, moves over once as the store
// opens and is then deleted: its meta is written last, so a move cut short starts over the next time.
//
// The page talks to it through `store.js`: each message `{id, op, args}`, each answer `{id, ok}` or `{id, error}`.

const EDITS = 'ops';
const KEYS = 'keys';
const META = 'meta';

/** The folder of the store open here, its name, and `ops` while the device runs, with where each of its records ends. */
let dir, name, log, ends;

/** The folder every store of this origin is in. */
async function stores() {
	return (await navigator.storage.getDirectory()).getDirectoryHandle('avendb', { create: true });
}

/** `bytes` as one record: its length in 4 bytes big-endian, then the bytes. */
function record(bytes) {
	const out = new Uint8Array(4 + bytes.length);
	new DataView(out.buffer).setUint32(0, bytes.length);
	out.set(bytes, 4);
	return out;
}

/** The whole records of `bytes`, how long they are together, and where each ends. */
function records(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const [out, ends] = [[], []];
	let at = 0;
	while (at + 4 <= bytes.length) {
		const end = at + 4 + view.getUint32(at);
		if (end > bytes.length) break;
		out.push(bytes.slice(at + 4, end));
		ends.push(end);
		at = end;
	}
	return [out, at, ends];
}

/** All of a synchronous file's bytes. */
function bytesOf(file) {
	const bytes = new Uint8Array(file.getSize());
	file.read(bytes, { at: 0 });
	return bytes;
}

/** Opens file `name` of folder `folder` to write in place, made if there is none. */
async function writable(folder, name) {
	const handle = await folder.getFileHandle(name, { create: true });
	try {
		return await handle.createSyncAccessHandle();
	} catch (e) {
		// as one browser or another says another worker holds the file
		const held = ['NoModificationAllowedError', 'InvalidStateError'].includes(e?.name);
		if (held) throw new Error('this device is open in another tab already');
		throw e;
	}
}

/** Appends `bytes` to the whole records of the file `name`, cutting anything after them, and makes it last. */
async function append(folder, name, bytes) {
	const file = await writable(folder, name);
	try {
		const [, whole] = records(bytesOf(file));
		file.truncate(whole);
		file.write(bytes, { at: whole });
		file.flush();
	} finally {
		file.close();
	}
}

/** Writes `bytes` as the file `name` of `folder`, whole. */
async function put(folder, name, bytes) {
	const file = await writable(folder, name);
	try {
		file.truncate(0);
		file.write(bytes, { at: 0 });
		file.flush();
	} finally {
		file.close();
	}
}

/** The bytes of file `name` of `folder`, read without holding it, or `undefined` if there is none. */
async function read(folder, name) {
	try {
		const file = await (await folder.getFileHandle(name)).getFile();
		return new Uint8Array(await file.arrayBuffer());
	} catch (e) {
		if (e?.name === 'NotFoundError') return undefined;
		throw e;
	}
}

/** What opens the device again, the last whole record of `meta`, or `undefined`. */
async function meta() {
	const [kept] = records((await read(dir, META)) ?? new Uint8Array());
	return kept.length ? JSON.parse(new TextDecoder().decode(kept[kept.length - 1])) : undefined;
}

async function setMeta(meta) {
	await append(dir, META, record(new TextEncoder().encode(JSON.stringify(meta))));
}

/** The McEliece keys the store holds: `[ids, keys]`. */
async function keys() {
	const folder = await dir.getDirectoryHandle(KEYS, { create: true });
	const [ids, held] = [[], []];
	for await (const [id, handle] of folder.entries()) {
		if (handle.kind !== 'file') continue;
		ids.push(id);
		held.push(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
	}
	return [ids, held];
}

/** Holds `ops` from now on, cut back to its whole records, and returns them. */
async function hold() {
	log ??= await writable(dir, EDITS);
	const [kept, whole, at] = records(bytesOf(log));
	if (whole < log.getSize()) {
		log.truncate(whole);
		log.flush();
	}
	ends = at;
	return kept;
}

/** What the store kept, `{edits, keys, ids}`, holding `ops` from now on. */
async function load() {
	const edits = await hold();
	const [ids, held] = await keys();
	return { edits, keys: held, ids };
}

/**
 * Saves `edits` as the `from`th on, in place of any the store held from there (so saving the same twice keeps them
 * once, and `from` 0 writes `ops` anew), `keys`, each `[id, bytes]`, and drops the keys `drop`.
 */
async function save({ from, edits, keys, drop }) {
	if (edits.length || from === 0) {
		if (!log) await hold();
		if (from > ends.length) throw new Error(`the store holds ${ends.length} edits, not ${from}`);
		ends.length = from;
		let at = ends[from - 1] ?? 0;
		const start = at;
		const bytes = new Uint8Array(edits.reduce((n, e) => n + 4 + e.length, 0));
		for (const edit of edits) {
			bytes.set(record(edit), at - start);
			at += 4 + edit.length;
			ends.push(at);
		}
		log.truncate(start);
		log.write(bytes, { at: start });
		log.flush();
	}
	const folder = await dir.getDirectoryHandle(KEYS, { create: true });
	for (const [id, bytes] of keys) await put(folder, id, bytes);
	for (const id of drop) await folder.removeEntry(id).catch(() => {});
}

/** Lets go of `ops`, for another worker to hold. */
function release() {
	log?.close();
	log = undefined;
}

/** The store IndexedDB kept under `name`, as pages did before (P8e): `{meta, edits, keys, ids}`, or `undefined`. */
async function kept(name) {
	const known = await indexedDB.databases?.();
	if (known && !known.some((d) => d.name === name)) return undefined;
	const request = (r) =>
		new Promise((resolve, reject) => {
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
	const open = indexedDB.open(name);
	open.onupgradeneeded = () => open.transaction.abort();
	let db;
	try {
		db = await request(open);
	} catch {
		return undefined;
	}
	try {
		const stores = ['meta', EDITS, 'keys'];
		if (!stores.every((s) => db.objectStoreNames.contains(s))) return undefined;
		const tx = db.transaction(stores);
		const [meta, edits, ids, keys] = await Promise.all([
			request(tx.objectStore('meta').get('device')),
			request(tx.objectStore(EDITS).getAll()),
			request(tx.objectStore('keys').getAllKeys()),
			request(tx.objectStore('keys').getAll())
		]);
		return meta ? { meta, edits, keys, ids } : undefined;
	} finally {
		db.close();
	}
}

/** Moves the device IndexedDB kept under `name` into this store, if there is one and the store holds none yet. */
async function move(name) {
	if (await meta()) return;
	const old = await kept(name);
	if (!old) return;
	const keys = old.ids.map((id, i) => [String(id), new Uint8Array(old.keys[i])]);
	await save({ from: 0, edits: old.edits.map((e) => new Uint8Array(e)), keys, drop: [] });
	release();
	await setMeta(old.meta);
	await new Promise((resolve, reject) => {
		const r = indexedDB.deleteDatabase(name);
		r.onsuccess = resolve;
		r.onerror = () => reject(r.error);
		r.onblocked = resolve;
	});
}

const ops = {
	async open(n) {
		name = n;
		dir = await (await stores()).getDirectoryHandle(name, { create: true });
		await move(name);
	},
	meta,
	setMeta,
	load,
	save,
	release,
	close: release,
	/** Removes the store named `n`, and with it the device the page made. */
	async remove(n) {
		if (n === name) release();
		await (await stores()).removeEntry(n, { recursive: true }).catch((e) => {
			if (e?.name !== 'NotFoundError') throw e;
		});
	}
};

/** Runs one message's op after those before it, and answers it. */
async function answer({ id, op, args }) {
	try {
		const ok = await ops[op](...args);
		const moved = ok?.edits ? [...ok.edits, ...ok.keys].map((b) => b.buffer) : [];
		postMessage({ id, ok }, moved);
	} catch (e) {
		postMessage({ id, error: String(e?.message ?? e) });
	}
}

let queue = Promise.resolve();
onmessage = ({ data }) => (queue = queue.then(() => answer(data)));
