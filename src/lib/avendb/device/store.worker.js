// @ts-nocheck: written by avendb/scripts/build-web.sh from avenDB
// avenDB's store in the browser, the worker that keeps it (v8 phase S): a page's device's shelf in the origin private
// file system (OPFS), laid out as every place lays out its own (`avendb_net::shelf`, `avendb_net::disk`). A worker,
// because only a worker has OPFS's synchronous files, which write in place and fast. It keeps bytes, and nothing it
// keeps means anything to it: the device reads and writes them itself (avendb-browser's `shelf_of`).
//
// The store named `name` is the folder `avendb/<name>/`. It holds a shelf for each generation, `g1/`, `g2/` and on:
// the newest is the one in use, and a new one made beside them puts every older one aside, never read again (`aside`).
// As it opens, the store is cleared of what came before the last reset (`clear`): shelves older than `FLOOR`, and
// whatever else its folder holds, as an earlier avenDB's store. In a generation's folder:
//
// - `blobs/<hash>`: each finished blob, named by its BLAKE3 hash in hex, and `outboards/<hash>` its outboard, written
//   last, so that a blob counts once its outboard is there;
// - `new/`: the blobs being written, each under the name its node chose (`new-...`), and the objects being put;
// - each named object at its name, put once and never replaced: `heads/0000000000000001` in `heads/`.
//
// Each object is written whole beside its place, flushed, then moved into it, so an object is always whole. While its
// device runs, the worker holds the store's `lock`, which OPFS lets only one worker do: the same device can't run in
// two tabs at once.
//
// The page talks to it through `store.js`: each message `{id, op, args}`, each answer `{id, ok}` or `{id, error}`.

const BLOBS = 'blobs';
const OUTBOARDS = 'outboards';
const NEW = 'new';
const LOCK = 'lock';
/** The folders of a generation no named object is under (`avendb_net::shelf::RESERVED`), and the store's lock. */
const RESERVED = [BLOBS, OUTBOARDS, NEW, LOCK];
/** A generation's folder: `g1`, `g2` and on. */
const GENERATION = /^g[1-9][0-9]*$/;
/** The generation every store is at least, avenDB's `avendb_net::shelf::FLOOR`: as a store opens, it clears every
 *  older one (`clear`). */
const FLOOR = 11;
/** A finished blob's name: its hash in hex. */
const HASH = /^[0-9a-f]{64}$/;
/** A blob being written: a name of letters, digits and `-`. */
const WRITTEN = /^[A-Za-z0-9-]+$/;
/** What the names of the blobs a node writes start with: what `list` drops of them is what it never finished. */
const WRITING = 'new-';
/** One part of an object's name (`avendb_net::shelf::named`). */
const PART = /^[a-z0-9._-]+$/;
/** The most blob files held open at once, the least lately used let go first. */
const HANDLES = 16;
/** The bytes copied at a time, where a browser can't move a file. */
const COPY = 8 << 20;

/** The store's folder, the folder of its generation in use, and its lock while this worker holds it. */
let root, dir, lock;

/** The blob files held open, by their place, the least lately used first. */
const handles = new Map();

/** The folder every store of this origin is in. */
async function stores() {
	return (await navigator.storage.getDirectory()).getDirectoryHandle('avendb', { create: true });
}

/** Whether an error says there is nothing there. */
const absent = (e) => e?.name === 'NotFoundError';

/** The generations of the store, the oldest first. */
async function generations() {
	const found = [];
	for await (const [name, handle] of root.entries()) {
		if (handle.kind === 'directory' && GENERATION.test(name)) found.push(Number(name.slice(1)));
	}
	return found.sort((a, b) => a - b);
}

/** Whether the store keeps what is under `name` in its folder (`avendb_net::shelf::kept`): its lock, and the shelves of
 *  generation `FLOOR` and later. */
const kept = (name) => name === LOCK || (GENERATION.test(name) && Number(name.slice(1)) >= FLOOR);

/** Clears the store of what came before the last reset: every entry of its folder it doesn't keep (`kept`). What it
 *  can't remove, as a file another tab of an earlier avenDB holds open, it leaves. How many entries it removed. */
async function clear() {
	const gone = [];
	for await (const [entry, handle] of root.entries()) if (!kept(entry)) gone.push([entry, handle.kind]);
	let cleared = 0;
	for (const [entry, kind] of gone) {
		await root.removeEntry(entry, { recursive: kind === 'directory' }).then(
			() => cleared++,
			(e) => absent(e) || console.warn(`avenDB: ${entry} is from before the last reset, and stays: ${e?.message ?? e}`)
		);
	}
	return cleared;
}

/** Puts generation `n` in use, made if it isn't there yet. Its number. */
async function use(n) {
	shutAll();
	dir = await root.getDirectoryHandle(`g${n}`, { create: true });
	for (const sub of [BLOBS, OUTBOARDS, NEW]) await dir.getDirectoryHandle(sub, { create: true });
	return n;
}

/** Opens file `name` of `folder` to write in place, made if there is none and `create`. */
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

/** Writes `bytes` as the new file `name` of `folder`, whole and flushed. */
async function written(folder, name, bytes) {
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
async function bytesOf(folder, name) {
	try {
		const file = await (await folder.getFileHandle(name)).getFile();
		return new Uint8Array(await file.arrayBuffer());
	} catch (e) {
		if (absent(e)) return undefined;
		throw e;
	}
}

/** Removes file `name` of `folder`, if it is there. */
async function removed(folder, name) {
	await folder.removeEntry(name).catch((e) => {
		if (!absent(e)) throw e;
	});
}

/** A name of the worker's own for what it writes beside its place. */
function staged(what) {
	const n = crypto.getRandomValues(new Uint8Array(8));
	return `${what}-${Array.from(n, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Moves file `from` of `source` to `to` of `target`, replacing what is there; copied, where a browser can't move. */
async function moved(source, from, target, to) {
	const handle = await source.getFileHandle(from);
	if (handle.move) {
		try {
			await handle.move(target, to);
			return;
		} catch (e) {
			if (!['NotSupportedError', 'TypeError'].includes(e?.name)) throw e;
		}
	}
	const [reading, writing] = [await writable(source, from, false), await writable(target, to)];
	try {
		const size = reading.getSize();
		const bytes = new Uint8Array(Math.max(1, Math.min(COPY, size)));
		writing.truncate(0);
		for (let at = 0; at < size; at += COPY) {
			const n = reading.read(bytes, { at });
			writing.write(bytes.subarray(0, n), { at });
		}
		writing.flush();
	} finally {
		reading.close();
		writing.close();
	}
	await removed(source, from);
}

/** Where blob `name` is: a finished one in `blobs/` under its hash, one being written in `new/`. */
async function place(name) {
	if (HASH.test(name)) return [await dir.getDirectoryHandle(BLOBS), `${BLOBS}/${name}`];
	if (!WRITTEN.test(name)) throw new Error(`${name} names no blob being written`);
	return [await dir.getDirectoryHandle(NEW), `${NEW}/${name}`];
}

/** Blob `name`, held open to read and write in place, made first if `create`. */
async function blob(name, create = false) {
	const [folder, at] = await place(name);
	let file = handles.get(at);
	if (file) {
		handles.delete(at);
	} else {
		file = await writable(folder, name, create);
		if (handles.size >= HANDLES) shut(handles.keys().next().value);
	}
	handles.set(at, file);
	return file;
}

/** Lets go of the blob file at `at`, if it is held. */
function shut(at) {
	handles.get(at)?.close();
	handles.delete(at);
}

function shutAll() {
	for (const at of [...handles.keys()]) shut(at);
}

/** The size of file `name` of `folder`, or `undefined` if there is none. */
async function sizeOf(folder, name, at) {
	const open = handles.get(at);
	if (open) return open.getSize();
	try {
		return (await (await folder.getFileHandle(name)).getFile()).size;
	} catch (e) {
		if (absent(e)) return undefined;
		throw e;
	}
}

/** The folders of object `name` and the name of its file, the folders made first if `create`. */
async function object(name, create) {
	const parts = name.split('/');
	const named = parts.every((p) => PART.test(p) && p !== '.' && p !== '..') && !RESERVED.includes(parts[0]);
	if (!named) throw new Error(`${JSON.stringify(name)} names no object`);
	let folder = dir;
	for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create });
	return [folder, parts[parts.length - 1]];
}

/** Whether `a` and `b` hold the same bytes. */
function same(a, b) {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}

const ops = {
	/** Opens the store named `name`, in its newest generation, or, with none or only older ones than `FLOOR`, a new
	 *  one of that generation, once the store is cleared of what came before it (`clear`). */
	async open(name) {
		root = await (await stores()).getDirectoryHandle(name, { create: true });
		await clear();
		await use(Math.max((await generations()).at(-1) ?? FLOOR, FLOOR));
	},

	/** Holds the store for this worker alone, until `release`: refused while another holds it. */
	async hold() {
		lock ??= await writable(root, LOCK);
	},

	/** Lets go of the store, for another worker to hold, and of every blob file. */
	release() {
		lock?.close();
		lock = undefined;
		shutAll();
	},

	/** Puts the generation in use aside, deleting nothing, and puts a new one in use, empty. Its number. */
	async aside() {
		return use(Math.max(((await generations()).at(-1) ?? 0) + 1, FLOOR));
	},

	/** Every blob the shelf holds whole, `[hash, size]`, once it dropped the blobs never finished. */
	async list() {
		const fresh = await dir.getDirectoryHandle(NEW);
		const unfinished = [];
		for await (const [name] of fresh.entries()) if (name.startsWith(WRITING)) unfinished.push(name);
		for (const name of unfinished) {
			shut(`${NEW}/${name}`);
			await removed(fresh, name);
		}
		const [blobs, outboards] = [await dir.getDirectoryHandle(BLOBS), await dir.getDirectoryHandle(OUTBOARDS)];
		const held = [];
		for await (const [name, handle] of outboards.entries()) {
			if (handle.kind !== 'file' || !HASH.test(name)) continue;
			const size = await sizeOf(blobs, name, `${BLOBS}/${name}`);
			if (size !== undefined) held.push([name, size]);
		}
		return held;
	},

	/** `len` bytes of blob `name` from byte `at` on, or fewer at its end. */
	async read(name, at, len) {
		const file = await blob(name);
		const bytes = new Uint8Array(Math.max(0, Math.min(at + len, file.getSize()) - at));
		file.read(bytes, { at });
		return bytes;
	},

	/** The outboard of blob `hash`. */
	async outboard(hash) {
		if (!HASH.test(hash)) throw new Error(`${hash} is no blob's hash`);
		const bytes = await bytesOf(await dir.getDirectoryHandle(OUTBOARDS), hash);
		if (!bytes) throw new Error(`no outboard of ${hash} on the shelf`);
		return bytes;
	},

	/** Writes `bytes` from byte `at` on of blob `name`, being written, begun if it isn't yet. */
	async write(name, at, bytes) {
		if (HASH.test(name)) throw new Error(`blob ${name} is finished`);
		(await blob(name, true)).write(bytes, { at });
	},

	/** Blob `name`, written whole, is blob `hash` of `size` bytes from now on: flushed and moved into place, then its
	 *  outboard beside it, written whole first. If the shelf holds `hash` already, `name` goes. */
	async finish(name, hash, size, outboard) {
		if (HASH.test(name) || !HASH.test(hash)) throw new Error(`${name} isn't a blob being written`);
		const folders = [NEW, BLOBS, OUTBOARDS].map((d) => dir.getDirectoryHandle(d));
		const [fresh, blobs, outboards] = await Promise.all(folders);
		if ((await bytesOf(outboards, hash)) !== undefined) {
			shut(`${NEW}/${name}`);
			return removed(fresh, name);
		}
		const file = await blob(name, size === 0);
		if (file.getSize() !== size) throw new Error(`${name} is ${file.getSize()} bytes, not ${size}`);
		file.flush();
		shut(`${NEW}/${name}`);
		// what a finish cut short left under the hash, without its outboard, counts for nothing
		shut(`${BLOBS}/${hash}`);
		await removed(blobs, hash);
		await moved(fresh, name, blobs, hash);
		const part = staged('outboard');
		await written(fresh, part, outboard);
		await moved(fresh, part, outboards, hash);
	},

	/** Drops blob `name`, being written or finished: a finished one's outboard first, so that it counts no more. */
	async drop(name) {
		const [folder, at] = await place(name);
		if (HASH.test(name)) await removed(await dir.getDirectoryHandle(OUTBOARDS), name);
		shut(at);
		await removed(folder, name);
	},

	/** Puts `bytes` under object `name` once: written whole in `new/`, then moved into place, unless something is
	 *  there already. True if it holds them now; false if it holds other bytes there, which it never replaces. */
	async put(name, bytes) {
		const [folder, file] = await object(name, true);
		const there = await bytesOf(folder, file);
		if (there) return same(there, bytes);
		const fresh = await dir.getDirectoryHandle(NEW);
		const part = staged('put');
		await written(fresh, part, bytes);
		await moved(fresh, part, folder, file);
		return true;
	},

	/** The bytes put under object `name`, or `undefined`. */
	async get(name) {
		try {
			const [folder, file] = await object(name, false);
			return await bytesOf(folder, file);
		} catch (e) {
			if (absent(e) || e?.name === 'TypeMismatchError') return undefined;
			throw e;
		}
	},

	/** The name of every object put whose name starts with `prefix`, in order. */
	async names(prefix) {
		const found = [];
		const walk = async (folder, path) => {
			for await (const [name, handle] of folder.entries()) {
				if (!path && RESERVED.includes(name)) continue;
				if (!PART.test(name) || name === '.' || name === '..') continue;
				const full = path ? `${path}/${name}` : name;
				if (handle.kind === 'directory') await walk(handle, full);
				else if (full.startsWith(prefix)) found.push(full);
			}
		};
		await walk(dir, '');
		return found.sort();
	},

	/** Lets go of the store before the page stops this worker. */
	close() {
		ops.release();
	}
};

/** The buffers of `ok` the answer hands over rather than copies. */
function handed(ok) {
	return ok instanceof Uint8Array ? [ok.buffer] : [];
}

/** Runs one message's op after those before it, and answers it. */
async function answer({ id, op, args }) {
	try {
		if (!Object.hasOwn(ops, op)) throw new Error(`the store has no ${op}`);
		if (op !== 'open' && !root) throw new Error('the store is not open');
		const ok = await ops[op](...args);
		postMessage({ id, ok }, handed(ok));
	} catch (e) {
		postMessage({ id, error: String(e?.message ?? e) });
	}
}

let queue = Promise.resolve();
onmessage = ({ data }) => (queue = queue.then(() => answer(data)));
