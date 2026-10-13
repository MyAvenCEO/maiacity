// @ts-nocheck: written by avendb/scripts/build-web.sh from avenDB
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
// `blobs/` is the device's node's shelf (B2d, `avendb_net::shelf`): each blob it keeps whole, a piece of a file it
// brings or keeps, in a file named by its BLAKE3 hash in hex, its outboard beside it in `<hash>.obao`, written last, so
// that a blob counts once both are there; a blob being written is in a file of the node's naming (`new-...`) until it
// is whole. What the folder holds of anything else, it drops as the node lists it.
//
// While its device runs, the worker holds `ops` open, which OPFS lets only one worker do: the same device can't run in
// two tabs at once. A store IndexedDB kept under the same name, as pages did before, moves over once as the store
// opens and is then deleted: its meta is written last, so a move cut short starts over the next time.
//
// The page talks to it through `store.js`: each message `{id, op, args}`, each answer `{id, ok}` or `{id, error}`.

const EDITS = 'ops';
const KEYS = 'keys';
const META = 'meta';
const BLOBS = 'blobs';
/** The most blob files held open at once, the least lately used let go first. */
const HANDLES = 16;
/** A finished blob's name: its hash in hex. */
const HASH = /^[0-9a-f]{64}$/;
/** The bytes copied at a time, where a browser can't move a file. */
const COPY = 8 << 20;

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

/** Opens file `name` of folder `folder` to write in place, made if there is none and `create`. */
async function writable(folder, name, create = true) {
	const handle = await folder.getFileHandle(name, { create });
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

/** Lets go of `ops`, for another worker to hold, and of every blob file. */
function release() {
	log?.close();
	log = undefined;
	for (const name of [...handles.keys()]) shut(name);
}

/** The blob files held open, by name, the least lately used first. */
const handles = new Map();

async function blobFolder() {
	return dir.getDirectoryHandle(BLOBS, { create: true });
}

/** Blob file `name`, held open to read and write in place, made first if `create`. */
async function blob(name, create = false) {
	let file = handles.get(name);
	if (file) {
		handles.delete(name);
	} else {
		file = await writable(await blobFolder(), name, create);
		if (handles.size >= HANDLES) shut(handles.keys().next().value);
	}
	handles.set(name, file);
	return file;
}

/** Lets go of blob file `name`, if it is held. */
function shut(name) {
	handles.get(name)?.close();
	handles.delete(name);
}

/** Whether `folder` holds a file `name`. */
async function holds(folder, name) {
	try {
		await folder.getFileHandle(name);
		return true;
	} catch (e) {
		if (e?.name === 'NotFoundError') return false;
		throw e;
	}
}

/** Removes file `name` of `folder`, if it is there. */
async function removeFile(folder, name) {
	shut(name);
	await folder.removeEntry(name).catch((e) => {
		if (e?.name !== 'NotFoundError') throw e;
	});
}

/** Every blob the shelf holds whole, `[hash, size]`, dropping whatever else `blobs/` holds. */
async function blobs() {
	const folder = await blobFolder();
	const names = new Set();
	for await (const [name, handle] of folder.entries()) if (handle.kind === 'file') names.add(name);
	const held = [];
	for (const name of names) {
		if (HASH.test(name) && names.has(`${name}.obao`)) {
			held.push([name, handles.get(name)?.getSize() ?? (await (await folder.getFileHandle(name)).getFile()).size]);
		} else if (!(name.endsWith('.obao') && HASH.test(name.slice(0, -5)) && names.has(name.slice(0, -5)))) {
			await removeFile(folder, name);
		}
	}
	return held;
}

/** `len` bytes of blob `name` from byte `at` on, or fewer at its end. */
async function blobRead(name, at, len) {
	const file = await blob(name);
	const bytes = new Uint8Array(Math.max(0, Math.min(at + len, file.getSize()) - at));
	file.read(bytes, { at });
	return bytes;
}

/** The outboard of blob `hash`. */
async function blobOutboard(hash) {
	const bytes = await read(await blobFolder(), `${hash}.obao`);
	if (!bytes) throw new Error(`no outboard of ${hash} on the shelf`);
	return bytes;
}

/** Writes `bytes` from byte `at` on of blob `name`, begun if it isn't yet. */
async function blobWrite(name, at, bytes) {
	(await blob(name, true)).write(bytes, { at });
}

/** Blob `name` is whole: blob `hash` of `size` bytes from now on, its bytes under its hash, then its outboard. */
async function blobFinish(name, hash, size, outboard) {
	const folder = await blobFolder();
	if (await holds(folder, `${hash}.obao`)) return removeFile(folder, name);
	const file = await blob(name, size === 0);
	if (file.getSize() !== size) throw new Error(`${name} is ${file.getSize()} bytes, not ${size}`);
	file.flush();
	shut(name);
	if (name !== hash) {
		await removeFile(folder, hash);
		const handle = await folder.getFileHandle(name);
		if (handle.move) await handle.move(hash);
		else await copy(folder, name, hash, size);
	}
	await put(folder, `${hash}.obao`, outboard);
}

/** Copies file `from` of `folder` to `to`, `COPY` bytes at a time, then removes it: where a browser can't move one. */
async function copy(folder, from, to, size) {
	const [source, target] = [await writable(folder, from), await writable(folder, to)];
	try {
		const bytes = new Uint8Array(Math.min(COPY, size));
		for (let at = 0; at < size; at += COPY) {
			const n = source.read(bytes, { at });
			target.write(bytes.subarray(0, n), { at });
		}
		target.flush();
	} finally {
		source.close();
		target.close();
	}
	await removeFile(folder, from);
}

/** Drops blob `name`, its outboard first, so that it counts no more. */
async function blobDrop(name) {
	const folder = await blobFolder();
	if (HASH.test(name)) await removeFile(folder, `${name}.obao`);
	await removeFile(folder, name);
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
	blobs,
	blobRead,
	blobOutboard,
	blobWrite,
	blobFinish,
	blobDrop,
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
		const moved = ok?.edits ? [...ok.edits, ...ok.keys].map((b) => b.buffer) : ok instanceof Uint8Array ? [ok.buffer] : [];
		postMessage({ id, ok }, moved);
	} catch (e) {
		postMessage({ id, error: String(e?.message ?? e) });
	}
}

let queue = Promise.resolve();
onmessage = ({ data }) => (queue = queue.then(() => answer(data)));
