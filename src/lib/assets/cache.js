// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * THE DEVICE'S ASSET CACHE — what the box built (./box), kept on this device, so a page shows an asset it showed before
 * without running its recipe again. Never synced and never the truth: the recipe is (any device builds it again), so
 * this may be emptied at any time, and a page that finds nothing builds. Kept in the origin private file system (OPFS),
 * where avenDB keeps its store too, in a folder of its own (DIR): each build a file named by the key `keyOf` names, the
 * box's plain data and the card as they came out (`packed`); what is read back goes through the same checks as what
 * comes out of a box (../load.js: the card's schema, ./box/rebuild.js), so an entry spoiled by anyone is refused like a
 * box that lies, dropped and built again. Bounded: past LIMIT bytes the entries used longest ago go first.
 *
 * Keeping a build costs the page nothing it needs for its frames: its pictures are written as PNG files, and its file
 * written, in a worker of the cache's own (./cache.worker.js), and the builds are kept one after another, in the order
 * they came, once the builds stop coming in (QUIET): a world that is loading has the graphics card for its frames and
 * its shaders, and a picture is copied and read back off it to be written.
 *
 *   key = BLAKE3 in its key-derivation mode, context CONTEXT, of [engine, recipe, values]
 *
 * engine: the frozen engine's hash (src/lib/sandbox/engines.json), recipe: the recipe file's hash (./recipes.js), values: what it is
 * built with, sorted (`seed=maia&stage=9`). The same recipe with the same values on the same engine is the same build,
 * so it is kept once; a recipe changed is another hash, so another build, and the old ones fade out by LIMIT.
 *
 * Beside the builds, each recipe's file as the Maia City vault handed it out (./vault.js), under its own hash (`fileAt`,
 * `keepFile`): what runs in the box after a build came out of here (a machine's clip) needs its recipe, and a second
 * visit reads it from here, not off the feed again. Held to its hash again whenever it is read back.
 *
 * A page keeps nothing in IndexedDB (Samuel 2026-10-20): this cache was kept there until then, and that database is
 * deleted once on each device (`OLD`).
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { queryOf } from './params.js';

export const CONTEXT = 'maiaCITY 2026-10-15 asset cache';
/** how much the cache may hold (bytes) */
export const LIMIT = 512 * 1024 * 1024;
/** the cache's folder in the origin private file system */
const DIR = 'asset-cache';
/** a build's file is named BUILD and its key, a recipe's file RECIPE and its hash */
const BUILD = 'build-', RECIPE = 'recipe-';
/** an entry's file */
const ENTRY = /^(build|recipe)-[0-9a-f]{64}$/;
/** the file where when each entry was last used is noted, by its file's name */
const USED = 'used.json';
/** the IndexedDB database the cache was kept in until 2026-10-20: deleted (Samuel 2026-10-20, "ok for deleting indexdb") */
const OLD = 'maiacity-asset-cache';

const HASH = /^[0-9a-f]{64}$/;

/**
 * The cache key of a build. @param {{ engine: string, recipe: string, params?: Record<string, unknown> }} build
 * @returns {string} 64 hex digits
 */
export function keyOf({ engine, recipe, params }) {
	if (!HASH.test(engine)) throw new Error('no engine hash');
	if (!HASH.test(recipe)) throw new Error('no recipe hash');
	return bytesToHex(blake3(utf8ToBytes(JSON.stringify([engine, recipe, queryOf(params)])), { context: utf8ToBytes(CONTEXT) }));
}

/**
 * The BLAKE3 hash of a value as data: its typed arrays by their bytes, everything else by its JSON, keys sorted; so two
 * builds that hash the same are the same, bit for bit. @param {unknown} value @returns {string}
 */
export function fingerprint(value) {
	const h = blake3.create();
	const text = (/** @type {string} */ s) => h.update(utf8ToBytes(s));
	const feed = (/** @type {any} */ v) => {
		if (ArrayBuffer.isView(v)) {
			text(`<${v.constructor.name} ${v.byteLength}>`);
			h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
		} else if (Array.isArray(v)) {
			text(`[${v.length}`);
			v.forEach(feed);
			text(']');
		} else if (v && typeof v === 'object') {
			const keys = Object.keys(v).sort();
			text(`{${keys.length}`);
			for (const k of keys) {
				text(JSON.stringify(k));
				feed(v[k]);
			}
			text('}');
		} else text(JSON.stringify(v) ?? 'undefined');
	};
	feed(value);
	return bytesToHex(h.digest());
}

/** the bytes a build's data holds in its arrays and pictures */
export function bytesOf(data) {
	let n = 0;
	const add = (a) => (n += a?.byteLength ?? 0);
	for (const g of data.geometries ?? []) {
		for (const a of Object.values(g.attributes ?? {})) add(a.array);
		for (const list of Object.values(g.morph ?? {})) for (const a of list) add(a.array);
		add(g.index);
	}
	for (const node of data.nodes ?? []) if (node.mesh?.instances) (add(node.mesh.instances.matrices), add(node.mesh.instances.colors));
	// a picture is on its texture in format 0 (engine 1), in `images` from format 1 on
	for (const t of [...(data.textures ?? []), ...(data.images ?? [])]) {
		if (!t) continue;
		add(t.pixels?.data);
		add(t.picture?.rgba);
		n += t.picture?.png?.size ?? t.picture?.png?.byteLength ?? 0;
		if (t.bitmap) n += t.bitmap.width * t.bitmap.height * 4;
	}
	return n;
}

/** a picture drawn on a canvas of its size @param {ImageBitmap} bitmap */
function canvasOf(bitmap) {
	const c = new OffscreenCanvas(bitmap.width, bitmap.height);
	const g = c.getContext('2d', { willReadFrequently: true });
	g.drawImage(bitmap, 0, 0);
	return { c, g };
}

/** where a build's pictures are: on its textures in format 0 (engine 1), in `images` from format 1 on */
const LISTS = ['textures', 'images'];

/**
 * A build's data with every picture the box handed over as an ImageBitmap as `picture`: as `encode` makes it of the
 * picture. Undefined where this browser has no canvas off the page.
 */
async function pictures(data, encode) {
	const lists = LISTS.filter((k) => Array.isArray(data[k]) && data[k].some((t) => t?.bitmap));
	if (!lists.length) return data;
	if (typeof OffscreenCanvas !== 'function') return undefined;
	const out = { ...data };
	for (const k of lists)
		out[k] = await Promise.all(
			data[k].map(async (t) => {
				if (!t?.bitmap) return t;
				const { bitmap, ...rest } = t;
				return { ...rest, picture: { ...(await encode(bitmap)), width: bitmap.width, height: bitmap.height } };
			})
		);
	return out;
}

/** the cache's worker (./cache.worker.js), started when it is first asked; null where there is none, or it stopped */
let worker;
let job = 1;
/** @type {Map<number, { ok: (answer: any) => void, no: (e: Error) => void }>} */
const asked = new Map();
function workerOf() {
	if (worker !== undefined) return worker;
	worker = null;
	if (typeof Worker === 'undefined') return null;
	try {
		const w = new Worker(new URL('./cache.worker.js', import.meta.url), { type: 'module' });
		w.onmessage = (e) => {
			const j = asked.get(e.data.id);
			asked.delete(e.data.id);
			if (e.data.error) j?.no(new Error(e.data.error));
			else j?.ok(e.data);
		};
		// a worker that cannot start: the page writes the pictures and the files itself
		w.onerror = (e) => {
			e.preventDefault?.();
			w.terminate();
			worker = null;
			for (const j of asked.values()) j.no(new Error("the cache's worker stopped"));
			asked.clear();
		};
		worker = w;
	} catch {
		worker = null;
	}
	return worker;
}

/** a job for the worker `w`, `moved` handed over to it @param {Worker} w @param {object} message @param {Transferable[]} moved */
const ask = (w, message, moved) =>
	new Promise((ok, no) => {
		const id = job++;
		asked.set(id, { ok, no });
		w.postMessage({ id, ...message }, moved);
	});

/** a picture as a PNG file, written in the page (where there is no worker) @param {ImageBitmap} bitmap */
const pngHere = async (bitmap) => new Uint8Array(await (await canvasOf(bitmap).c.convertToBlob({ type: 'image/png' })).arrayBuffer());

/** a picture as a PNG file, written in the cache's worker from a copy of it (the page keeps its own), else here */
async function pngOf(bitmap) {
	const w = typeof createImageBitmap === 'function' ? workerOf() : null;
	if (w) {
		try {
			const copy = await createImageBitmap(bitmap);
			return (await ask(w, { op: 'png', bitmap: copy }, [copy])).png;
		} catch {
			// (not written there: written here)
		}
	}
	return pngHere(bitmap);
}

/**
 * A build's data as it is stored: its pictures (ImageBitmaps, which no file holds) as PNG files, lossless, kept as their
 * bytes.
 */
export const storable = (data) => pictures(data, async (bitmap) => ({ png: await pngOf(bitmap) }));

/** a PNG file's first eight bytes */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** a stored picture as a PNG file: its bytes, refused if they are not one */
function pngFile(png) {
	if (png instanceof Uint8Array && png.length > 8 && PNG.every((b, i) => png[i] === b)) return new Blob([png], { type: 'image/png' });
	throw new Error('refused: a stored picture that is no PNG');
}

/** A build's data with its pictures as their pixels, to compare two builds bit for bit (`fingerprint`). */
export const pixelsOf = (data) =>
	pictures(data, async (bitmap) => {
		const { g, c } = canvasOf(bitmap);
		return { rgba: new Uint8Array(g.getImageData(0, 0, c.width, c.height).data.buffer) };
	});

/** the other way: each stored picture an ImageBitmap again, as the box hands it over (./box/rebuild.js checks it) */
export async function revive(data) {
	const lists = LISTS.filter((k) => Array.isArray(data?.[k]) && data[k].some((t) => t?.picture));
	if (!lists.length) return data;
	const out = { ...data };
	for (const k of lists)
		out[k] = await Promise.all(
			data[k].map(async (t) => {
				if (!t?.picture) return t;
				const { png, width, height } = t.picture;
				const bitmap = await createImageBitmap(pngFile(png));
				if (bitmap.width !== width || bitmap.height !== height) throw new Error('refused: a stored picture of another size');
				const { picture, ...rest } = t;
				return { ...rest, bitmap };
			})
		);
	return out;
}


/*
 * AN ENTRY'S FILE — a value as bytes, as it is kept (`packed`) and read back (`unpacked`): what a build is made of (plain
 * objects and arrays, strings, numbers, booleans, null and undefined, typed arrays and array buffers) and nothing else,
 * kept so that what is read back is what was kept, bit for bit (`fingerprint`):
 *
 *   'mca' 1 | the JSON's length | the arrays' length | 0 (each a uint32) | the JSON | its arrays
 *
 * The JSON is `{parts, value}`: the value with each typed array or buffer in it as a mark `{"\u0000": n}`, n its place
 * in `parts`, each part its kind and where its bytes are among the arrays (each beginning at a multiple of 8). One array
 * in two places of the value is one part, as it was one array. A number no JSON holds (NaN, ±Infinity, -0), an undefined
 * and an object with a key that is the mark's own are marked too. A file of another length than its header gives, or
 * whose marks name bytes it doesn't hold, is refused, as is anything else that doesn't read: a page that finds an entry
 * refused builds it again.
 */

/** the key of a mark */
const MARK = '\u0000';
/** an entry's file's first bytes, and the bytes of its header */
const MAGIC = [0x6d, 0x63, 0x61, 1], HEAD = 16;
/** the typed arrays a file keeps, by their kind */
const ARRAYS = Object.fromEntries(
	['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'DataView']
		.filter((k) => typeof globalThis[k] === 'function')
		.map((k) => [k, globalThis[k]])
);
/** `n` up to the next multiple of 8 */
const eight = (n) => Math.ceil(n / 8) * 8;
/** the numbers no JSON holds, as they are marked */
const NUMBERS = ['NaN', 'Infinity', '-Infinity', '-0'];

/** A value as an entry's file; throws for one that holds anything a build isn't made of. @returns {Uint8Array} */
export function packed(value) {
	/** @type {Map<object, number>} */
	const at = new Map();
	/** @type {[string, number, number][]} */
	const parts = [];
	/** @type {Uint8Array[]} */
	const bytes = [];
	let size = 0;
	const plain = (v) => {
		if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
		if (typeof v === 'number') return Number.isFinite(v) && !Object.is(v, -0) ? v : { [MARK]: 'number', v: Object.is(v, -0) ? '-0' : String(v) };
		if (v === undefined) return { [MARK]: 'undefined' };
		if (typeof v !== 'object') throw new Error(`a ${typeof v} is no part of a build`);
		const kind = v instanceof ArrayBuffer ? 'ArrayBuffer' : ArrayBuffer.isView(v) ? Object.prototype.toString.call(v).slice(8, -1) : null;
		if (kind) {
			if (!at.has(v)) {
				if (kind !== 'ArrayBuffer' && !ARRAYS[kind]) throw new Error(`a ${kind} is no part of a build`);
				const b = kind === 'ArrayBuffer' ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
				at.set(v, parts.length);
				parts.push([kind, size, b.byteLength]);
				bytes.push(b);
				size += eight(b.byteLength);
			}
			return { [MARK]: at.get(v) };
		}
		if (Array.isArray(v)) return Array.from(v, (x) => plain(x));
		const proto = Object.getPrototypeOf(v);
		if (proto !== Object.prototype && proto !== null) throw new Error('only plain objects are part of a build');
		const entries = Object.keys(v).map((k) => [k, plain(v[k])]);
		return Object.hasOwn(v, MARK) ? { [MARK]: 'object', v: entries } : Object.fromEntries(entries);
	};
	const json = utf8ToBytes(JSON.stringify({ parts, value: plain(value) }));
	const start = HEAD + eight(json.byteLength);
	const file = new Uint8Array(start + size);
	file.set(MAGIC);
	const head = new DataView(file.buffer);
	head.setUint32(4, json.byteLength, true);
	head.setUint32(8, size, true);
	file.set(json, HEAD);
	parts.forEach(([, from], i) => file.set(bytes[i], start + from));
	return file;
}

/** An entry's file as the value it keeps, each array its own; throws (refused) for one that doesn't read. */
export function unpacked(file) {
	const refused = (why) => new Error(`refused: ${why}`);
	if (!(file instanceof Uint8Array) || file.byteLength < HEAD || MAGIC.some((b, i) => file[i] !== b)) throw refused('no file of the cache');
	const head = new DataView(file.buffer, file.byteOffset, HEAD);
	const length = head.getUint32(4, true), size = head.getUint32(8, true);
	const start = HEAD + eight(length);
	if (start + size !== file.byteLength) throw refused('a file of the cache cut short, or too long');
	const { parts, value } = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.subarray(HEAD, HEAD + length)));
	if (!Array.isArray(parts)) throw refused('a file of the cache without its parts');
	const arrays = parts.map((p) => {
		const [kind, from, n] = Array.isArray(p) ? p : [];
		const make = kind === 'ArrayBuffer' ? undefined : ARRAYS[kind];
		if (kind !== 'ArrayBuffer' && !make) throw refused(`a ${kind} in a file of the cache`);
		if (!Number.isSafeInteger(from) || !Number.isSafeInteger(n) || from < 0 || n < 0 || from + n > size || n % (make?.BYTES_PER_ELEMENT ?? 1)) throw refused('a part that is not in its file');
		const at = file.byteOffset + start + from;
		const buffer = file.buffer.slice(at, at + n);
		return make ? new make(buffer) : buffer;
	});
	const real = (v) => {
		if (Array.isArray(v)) return v.map(real);
		if (!v || typeof v !== 'object') return v;
		if (!Object.hasOwn(v, MARK)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, real(x)]));
		const m = v[MARK];
		if (Number.isInteger(m) && m >= 0 && m < arrays.length) return arrays[m];
		if (m === 'undefined') return undefined;
		if (m === 'number' && NUMBERS.includes(v.v)) return Number(v.v);
		if (m === 'object' && Array.isArray(v.v) && v.v.every((e) => Array.isArray(e) && typeof e[0] === 'string')) return Object.fromEntries(v.v.map(([k, x]) => [k, real(x)]));
		throw refused('a mark no file of the cache makes');
	};
	return real(value);
}

let opened;
/**
 * The cache's folder, or null where this browser keeps none (a private window, storage turned off). The first time a
 * page opens it, the database the cache was kept in before is deleted (`OLD`; nothing, where there is none).
 */
function folder() {
	return (opened ??= (async () => {
		try {
			globalThis.indexedDB?.deleteDatabase(OLD);
		} catch {
			// (none, or none to delete here)
		}
		try {
			return await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true });
		} catch {
			return null;
		}
	})());
}

/** the bytes of the file `name` of the folder `d`, or undefined if there is none */
async function read(d, name) {
	try {
		return new Uint8Array(await (await (await d.getFileHandle(name)).getFile()).arrayBuffer());
	} catch (e) {
		if (e?.name === 'NotFoundError') return undefined;
		throw e;
	}
}

/** the file written, and taken away again, to learn how this page writes the cache's files */
const CAN = 'can';
let writer;
/**
 * How this page writes the cache's files, learnt once by writing one: 'worker', in the cache's worker, where it has
 * OPFS's synchronous files; else 'page', here, where this browser writes a file from the page; else null, where it can
 * do neither (no folder of the cache, or a WebKit with no OPFS in its workers and no file it writes from the page): it
 * keeps nothing, and every asset builds.
 */
function writerOf() {
	return (writer ??= (async () => {
		const d = await folder();
		if (!d) return null;
		const w = workerOf();
		// (a worker that never answers is one that can't)
		const can = w && Promise.race([ask(w, { op: 'can', dir: DIR, name: CAN }, []), new Promise((ok) => setTimeout(ok, 5000, {}))]);
		if (can && (await can.then((a) => a.can === true, () => false))) return 'worker';
		try {
			const file = await (await d.getFileHandle(CAN, { create: true })).createWritable();
			await file.write(new Uint8Array(1));
			await file.close();
			await removed(d, CAN);
			return 'page';
		} catch {
			return null;
		}
	})());
}

/**
 * Whether this device keeps builds at all: a folder of the cache, and a way to write its files (`writerOf`). Where it
 * doesn't, nothing is kept, nothing is found, and every asset builds in the box.
 */
export const keeps = async () => !!(await writerOf());

/**
 * Writes `bytes` as the file `name` of the folder `d`, whole: in the cache's worker (handed over to it, so the caller
 * keeps no use of them), else here where this browser can write a file from the page (`writerOf`).
 */
async function write(d, name, bytes) {
	const how = await writerOf();
	const w = how === 'worker' && workerOf();
	if (w) {
		await ask(w, { op: 'write', dir: DIR, name, bytes }, [bytes.buffer]);
		return;
	}
	if (!how) throw new Error('this browser writes no file of the cache');
	const file = await (await d.getFileHandle(name, { create: true })).createWritable();
	try {
		await file.write(bytes);
		await file.close();
	} catch (e) {
		await file.abort?.().catch(() => {});
		throw e;
	}
}

/** removes the file `name` of the folder `d`: whether it is gone */
const removed = (d, name) => d.removeEntry(name).then(() => true, (e) => e?.name === 'NotFoundError');

/** the cache's entries: each one's file's name, its bytes and when it was written (ms) */
async function entries(d) {
	const found = [];
	for await (const [name, handle] of d.entries()) {
		if (handle.kind !== 'file' || !ENTRY.test(name)) continue;
		try {
			const f = await handle.getFile();
			found.push({ name, bytes: f.size, at: f.lastModified });
		} catch {
			// (one being written: counted next time)
		}
	}
	return found;
}

/** when each entry was last used, as USED notes it: by its file's name, ms */
async function usedIn(d) {
	try {
		const noted = JSON.parse(new TextDecoder().decode(await read(d, USED)));
		return Object.fromEntries(Object.entries(noted).filter(([k, t]) => ENTRY.test(k) && Number.isFinite(t)));
	} catch {
		return {};
	}
}

/** the entries this page used, by their file's name, and when (ms), not yet noted in USED */
const touched = new Map();
let noting = 0;
/** an entry used: noted in USED with the others used meanwhile, once none was used for QUIET ms */
function touch(name) {
	touched.set(name, Date.now());
	clearTimeout(noting);
	noting = setTimeout(() => (line = line.then(note).catch(() => {})), QUIET);
}
async function note() {
	const d = await folder();
	if (!d || !touched.size) return;
	const used = await usedIn(d);
	for (const [k, t] of touched) used[k] = Math.max(used[k] ?? 0, t);
	touched.clear();
	await write(d, USED, utf8ToBytes(JSON.stringify(used)));
}

/**
 * A build kept under `key`, its pictures ImageBitmaps again; undefined if there is none (or no cache). Not yet
 * checked: ../load.js checks it as it checks a box's.
 * @param {string} key @returns {Promise<{ data: any, card: any } | undefined>}
 */
export async function get(key) {
	if (!HASH.test(key)) return undefined;
	const d = await folder();
	if (!d) return undefined;
	let file;
	try {
		file = await read(d, BUILD + key);
	} catch {
		return undefined;
	}
	if (!file) return undefined;
	touch(BUILD + key);
	// a file that doesn't read, or a picture that will not open, is a spoiled entry, refused like any other (../load.js
	// drops it)
	let got;
	try {
		got = unpacked(file);
	} catch {
		return { data: null, card: null };
	}
	if (!got || typeof got !== 'object') return { data: null, card: null };
	try {
		return { ...got, data: await revive(got.data) };
	} catch {
		return { ...got, data: null };
	}
}

/** the builds being kept, one after another */
let line = Promise.resolve();
/** how long no build has to come in before those that came are kept (ms), and how long one waits for that at most */
const QUIET = 2000, LATEST = 20000;
/** the builds waiting for a quiet moment, and the timer that ends the wait */
let calm = [], timer = 0;
/** settles once no build has been handed in for QUIET ms (each one handed in starts that wait again), or LATEST ms on */
function quiet() {
	clearTimeout(timer);
	timer = setTimeout(() => {
		for (const ok of calm.splice(0)) ok();
	}, QUIET);
	return new Promise((ok) => {
		calm.push(ok);
		setTimeout(ok, LATEST);
	});
}
/** the bytes the cache holds as this page last counted them, and what it kept since (more, if one was kept again);
 *  null: to be counted */
let held = null;

/**
 * Keeps a build under `key`, then lets the entries used longest ago go until the cache fits LIMIT. False if it was not
 * kept (no cache, a picture it cannot read, or a build larger than LIMIT alone). Its pictures are written once the
 * builds stop coming in (`quiet`), beside those of the builds before it; the builds are kept one at a time, in the
 * order they were handed in.
 * @param {string} key @param {{ data: any, card: any }} build
 */
export function put(key, { data, card }) {
	const plain = quiet()
		.then(() => keeps())
		.then((yes) => yes && storable(data));
	plain.catch(() => {});
	const turn = line.then(() => keep(key, plain, card));
	line = turn.catch(() => {});
	return turn;
}

async function keep(key, written, card) {
	const d = await folder();
	const plain = d && HASH.test(key) && (await written);
	if (!plain) return false;
	try {
		const file = packed({ data: plain, card });
		const bytes = file.byteLength;
		if (bytes > LIMIT) return false;
		await write(d, BUILD + key, file);
		// counted once a visit, then by what is added: the oldest let go only once it may be over
		if (held !== null) held += bytes;
		if (held === null || held > LIMIT) held = await trim(d);
		return true;
	} catch {
		return false;
	}
}

/** the entries used longest ago out until the cache fits LIMIT; the bytes it holds then */
async function trim(d) {
	const files = await entries(d);
	const used = await usedIn(d);
	for (const f of files) f.at = Math.max(f.at, used[f.name] ?? 0, touched.get(f.name) ?? 0);
	files.sort((a, b) => a.at - b.at);
	let total = files.reduce((n, f) => n + f.bytes, 0);
	const left = new Set(files.map((f) => f.name));
	for (const f of files) {
		if (total <= LIMIT) break;
		if (await removed(d, f.name)) (total -= f.bytes), left.delete(f.name);
	}
	// what USED notes of entries no longer there goes with them
	const noted = Object.keys(used);
	if (noted.some((k) => !left.has(k))) await write(d, USED, utf8ToBytes(JSON.stringify(Object.fromEntries(noted.filter((k) => left.has(k)).map((k) => [k, used[k]]))))).catch(() => {});
	return total;
}

/** drops one entry (one that was refused) @param {string} key */
export async function drop(key) {
	const d = await folder();
	if (!d || !HASH.test(key)) return;
	await removed(d, BUILD + key);
	held = null;
}

/** puts something in under `key` as it is, unchecked: for the lab, to show a spoiled entry is refused @param {string} key */
export async function putRaw(key, value) {
	const d = await folder();
	if (!d || !HASH.test(key)) return false;
	await write(d, BUILD + key, packed(value));
	return true;
}

/**
 * A recipe's file kept on this device by the recipe's hash (the BLAKE3 of its bytes), as the vault handed it out;
 * undefined if there is none (or no cache). Not checked here: ./vault.js holds it to its hash before it is used.
 * @param {string} hash @returns {Promise<Uint8Array | undefined>}
 */
export async function fileAt(hash) {
	if (!HASH.test(hash)) return undefined;
	const d = await folder();
	if (!d) return undefined;
	try {
		const file = await read(d, RECIPE + hash);
		if (file) touch(RECIPE + hash);
		return file;
	} catch {
		return undefined;
	}
}

/**
 * Keeps a recipe's file under its hash (what ./vault.js read off the feed and held to it), then lets the entries used
 * longest ago go until the cache fits LIMIT, as a build kept does. False if it was not kept.
 * @param {string} hash @param {Uint8Array} bytes
 */
export async function keepFile(hash, bytes) {
	if (!HASH.test(hash) || !(bytes instanceof Uint8Array) || bytes.byteLength > LIMIT) return false;
	const d = await folder();
	if (!d) return false;
	try {
		// a copy of its own goes to the worker: the caller keeps its bytes
		await write(d, RECIPE + hash, bytes.slice());
		if (held !== null) held += bytes.byteLength;
		if (held === null || held > LIMIT) held = await trim(d);
		return true;
	} catch {
		return false;
	}
}

/** how many builds (and recipe files) the cache holds, and their bytes; `kept`: whether this device keeps any (`keeps`) */
export async function usage() {
	const d = await folder();
	if (!d || !(await writerOf())) return { count: 0, bytes: 0, kept: false };
	const files = await entries(d);
	return { count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), kept: true };
}

/** empties the cache */
export async function clear() {
	const d = await folder();
	if (!d) return;
	const names = [];
	for await (const [name, handle] of d.entries()) if (handle.kind === 'file' && (ENTRY.test(name) || name === USED)) names.push(name);
	await Promise.all(names.map((n) => removed(d, n)));
	touched.clear();
	held = null;
}
