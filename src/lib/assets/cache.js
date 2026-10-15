// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * THE DEVICE'S ASSET CACHE — what the box built (./box), kept on this device, so a page shows an asset it showed before
 * without running its recipe again. Never synced and never the truth: the recipe is (any device builds it again), so
 * this may be emptied at any time, and a page that finds nothing builds. Kept in IndexedDB under the key `keyOf`
 * names, the box's plain data and the card as they came out; what is read back goes through the same checks as what
 * comes out of a box (../load.js: the card's schema, ./box/rebuild.js), so an entry spoiled by anyone is refused like a
 * box that lies, dropped and built again. Bounded: past LIMIT bytes the entries used longest ago go first.
 *
 *   key = BLAKE3 in its key-derivation mode, context CONTEXT, of [engine, recipe, values]
 *
 * engine: the frozen engine's hash (./engines.json), recipe: the recipe file's hash (./recipes.js), values: what it is
 * built with, sorted (`seed=maia&stage=9`). The same recipe with the same values on the same engine is the same build,
 * so it is kept once; a recipe changed is another hash, so another build, and the old ones fade out by LIMIT.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { queryOf } from './params.js';

export const CONTEXT = 'maiaCITY 2026-10-15 asset cache';
/** how much the cache may hold (bytes) */
export const LIMIT = 512 * 1024 * 1024;
const DB = 'maiacity-asset-cache';

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
	for (const t of data.textures ?? []) {
		add(t.pixels?.data);
		add(t.picture?.rgba);
		n += t.picture?.png?.size ?? 0;
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

/**
 * A build's data with every picture the box handed over as an ImageBitmap as `picture`: as `encode` makes it of the
 * canvas it is drawn on. Undefined where this browser has no canvas off the page.
 */
async function pictures(data, encode) {
	if (!data.textures.some((t) => t.bitmap)) return data;
	if (typeof OffscreenCanvas !== 'function') return undefined;
	const textures = await Promise.all(
		data.textures.map(async (t) => {
			if (!t.bitmap) return t;
			const { bitmap, ...rest } = t;
			return { ...rest, picture: { ...(await encode(canvasOf(bitmap))), width: bitmap.width, height: bitmap.height } };
		})
	);
	return { ...data, textures };
}

/** A build's data as it is stored: its pictures (ImageBitmaps, which IndexedDB cannot keep) as PNG files, lossless. */
export const storable = (data) => pictures(data, async ({ c }) => ({ png: await c.convertToBlob({ type: 'image/png' }) }));

/** A build's data with its pictures as their pixels, to compare two builds bit for bit (`fingerprint`). */
export const pixelsOf = (data) => pictures(data, async ({ g, c }) => ({ rgba: new Uint8Array(g.getImageData(0, 0, c.width, c.height).data.buffer) }));

/** the other way: each stored picture an ImageBitmap again, as the box hands it over (./box/rebuild.js checks it) */
export async function revive(data) {
	if (!Array.isArray(data?.textures) || !data.textures.some((t) => t?.picture)) return data;
	const textures = await Promise.all(
		data.textures.map(async (t) => {
			if (!t?.picture) return t;
			const { png, width, height } = t.picture;
			if (!(png instanceof Blob) || png.type !== 'image/png') throw new Error('refused: a stored picture that is no PNG');
			const bitmap = await createImageBitmap(png);
			if (bitmap.width !== width || bitmap.height !== height) throw new Error('refused: a stored picture of another size');
			const { picture, ...rest } = t;
			return { ...rest, bitmap };
		})
	);
	return { ...data, textures };
}

let opened;
/** the cache's database, or null where this browser keeps none (a private window, storage turned off) */
function db() {
	return (opened ??= new Promise((ok) => {
		try {
			const req = indexedDB.open(DB, 1);
			req.onupgradeneeded = () => {
				const d = req.result;
				d.createObjectStore('built');
				d.createObjectStore('meta', { keyPath: 'key' }).createIndex('at', 'at');
			};
			req.onsuccess = () => ok(req.result);
			req.onerror = () => ok(null);
			req.onblocked = () => ok(null);
		} catch {
			ok(null);
		}
	}));
}

const done = (tx) => new Promise((ok, no) => ((tx.oncomplete = () => ok(undefined)), (tx.onerror = tx.onabort = () => no(tx.error ?? new Error('the cache refused')))));
const result = (req) => new Promise((ok, no) => ((req.onsuccess = () => ok(req.result)), (req.onerror = () => no(req.error))));

/**
 * A build kept under `key`, its pictures ImageBitmaps again; undefined if there is none (or no cache). Not yet
 * checked: ../load.js checks it as it checks a box's.
 * @param {string} key @returns {Promise<{ data: any, card: any } | undefined>}
 */
export async function get(key) {
	const d = await db();
	if (!d) return undefined;
	try {
		const tx = d.transaction(['built', 'meta'], 'readwrite');
		const [got, meta] = await Promise.all([result(tx.objectStore('built').get(key)), result(tx.objectStore('meta').get(key))]);
		if (got && meta) tx.objectStore('meta').put({ ...meta, at: Date.now() });
		await done(tx);
		if (!got) return undefined;
		// a picture that will not open is a spoiled entry, refused like any other (../load.js drops it)
		try {
			return { ...got, data: await revive(got.data) };
		} catch {
			return { ...got, data: null };
		}
	} catch {
		return undefined;
	}
}

/**
 * Keeps a build under `key`, then lets the entries used longest ago go until the cache fits LIMIT. False if it was not
 * kept (no cache, a picture it cannot read, or a build larger than LIMIT alone).
 * @param {string} key @param {{ data: any, card: any }} build
 */
export async function put(key, { data, card }) {
	const d = await db();
	const plain = d && (await storable(data));
	if (!plain) return false;
	const bytes = bytesOf(plain);
	if (bytes > LIMIT) return false;
	try {
		const tx = d.transaction(['built', 'meta'], 'readwrite');
		tx.objectStore('built').put({ data: plain, card }, key);
		tx.objectStore('meta').put({ key, at: Date.now(), bytes });
		await done(tx);
		await trim(d);
		return true;
	} catch {
		return false;
	}
}

/** the oldest entries out until the cache fits LIMIT */
async function trim(d) {
	const tx = d.transaction(['built', 'meta'], 'readwrite');
	const metas = await result(tx.objectStore('meta').index('at').getAll());
	let total = metas.reduce((n, m) => n + m.bytes, 0);
	for (const m of metas) {
		if (total <= LIMIT) break;
		tx.objectStore('built').delete(m.key);
		tx.objectStore('meta').delete(m.key);
		total -= m.bytes;
	}
	await done(tx);
}

/** drops one entry (one that was refused) @param {string} key */
export async function drop(key) {
	const d = await db();
	if (!d) return;
	const tx = d.transaction(['built', 'meta'], 'readwrite');
	tx.objectStore('built').delete(key);
	tx.objectStore('meta').delete(key);
	await done(tx).catch(() => {});
}

/** puts something in under `key` as it is, unchecked: for the lab, to show a spoiled entry is refused @param {string} key */
export async function putRaw(key, value) {
	const d = await db();
	if (!d) return false;
	const tx = d.transaction(['built', 'meta'], 'readwrite');
	tx.objectStore('built').put(value, key);
	tx.objectStore('meta').put({ key, at: Date.now(), bytes: 0 });
	await done(tx);
	return true;
}

/** how many builds the cache holds, and their bytes */
export async function usage() {
	const d = await db();
	if (!d) return { count: 0, bytes: 0, kept: false };
	const metas = await result(d.transaction('meta').objectStore('meta').getAll());
	return { count: metas.length, bytes: metas.reduce((n, m) => n + m.bytes, 0), kept: true };
}

/** empties the cache */
export async function clear() {
	const d = await db();
	if (!d) return;
	const tx = d.transaction(['built', 'meta'], 'readwrite');
	tx.objectStore('built').clear();
	tx.objectStore('meta').clear();
	await done(tx);
}
