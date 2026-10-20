// @ts-nocheck — plain JS
// The device's asset cache (./cache.js) in the origin private file system: an entry's file keeps a build bit for bit
// (`packed`, `unpacked`), a file that doesn't read is refused, and the cache keeps, reads back, drops and empties its
// entries in a folder of its own. The folder here is a stand-in kept in memory, as a browser's OPFS answers a page; the
// page writes its files itself, as where there is no worker.
// Run: bun test src/lib/assets/cache.test.js
import { afterAll, beforeAll, expect, test } from 'bun:test';

/** an OPFS folder in memory: its files by name, each its bytes and when it was written */
function folderOf() {
	const files = new Map();
	const missing = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
	const handleOf = (name) => ({
		kind: 'file',
		getFile: async () => {
			const f = files.get(name);
			if (!f) throw missing();
			return { size: f.bytes.byteLength, lastModified: f.at, arrayBuffer: async () => f.bytes.slice().buffer };
		},
		createWritable: async () => {
			const parts = [];
			return { write: async (b) => parts.push(new Uint8Array(b)), close: async () => files.set(name, { bytes: new Uint8Array(Buffer.concat(parts)), at: Date.now() }) };
		}
	});
	return {
		files,
		async getDirectoryHandle() {
			return this;
		},
		async getFileHandle(name, { create } = {}) {
			if (!files.has(name) && !create) throw missing();
			return handleOf(name);
		},
		async removeEntry(name) {
			if (!files.delete(name)) throw missing();
		},
		async *entries() {
			for (const name of [...files.keys()]) yield [name, handleOf(name)];
		}
	};
}

const root = folderOf();
let cache;
// the page's own Worker and storage, as this test found them: the other tests of this run use them after it
const was = { Worker: globalThis.Worker, storage: Object.getOwnPropertyDescriptor(globalThis.navigator, 'storage') };
beforeAll(async () => {
	globalThis.Worker = undefined;
	Object.defineProperty(globalThis.navigator, 'storage', { value: { getDirectory: async () => root }, configurable: true });
	// a module of its own: the cache's folder, once opened, is the module's, and the other tests of this run read none
	cache = await import('./cache.js?opfs');
});
afterAll(() => {
	globalThis.Worker = was.Worker;
	if (was.storage) Object.defineProperty(globalThis.navigator, 'storage', was.storage);
	else delete globalThis.navigator.storage;
});

/** a value shaped like a build, with everything a build's data may hold */
function build() {
	const shared = new Float32Array([1, 2, 3, NaN]);
	const big = new Uint8Array(40).map((_, i) => i);
	return {
		format: 4,
		ref: '',
		nodes: [{ name: 'root', mesh: null, matrix: [1, 0, -0, Infinity, -Infinity, NaN] }, { name: 'a', at: undefined }],
		geometries: [
			{ attributes: { position: { array: shared, itemSize: 3 }, again: { array: shared, itemSize: 3 } }, index: new Uint32Array([0, 1, 2]) },
			{ attributes: { skin: { array: new Uint16Array([7, 8, 9]) }, w: { array: new Float64Array([0.1, -0]) } }, index: big.subarray(3, 11) }
		],
		odd: [new Int8Array([-1]), new Uint8ClampedArray([255]), new Int16Array([-2]), new Int32Array([-3]), new BigInt64Array([-4n]), new BigUint64Array([5n]), new DataView(new ArrayBuffer(3)), new ArrayBuffer(5)],
		images: [{ picture: { png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]), width: 1, height: 1 } }],
		marked: { '\u0000': 2, __proto__: null },
		proto: JSON.parse('{"__proto__": {"x": 1}}'),
		list: [1, undefined, null, 'x', true]
	};
}

test('an entry keeps a build bit for bit', () => {
	const b = build();
	const back = cache.unpacked(cache.packed(b));
	expect(cache.fingerprint(back)).toBe(cache.fingerprint(b));
	expect(Object.is(back.nodes[0].matrix[2], -0)).toBe(true);
	expect(Number.isNaN(back.geometries[0].attributes.position.array[3])).toBe(true);
	expect('at' in back.nodes[1]).toBe(true);
	expect(back.list[1]).toBeUndefined();
	expect(back.marked).toEqual({ '\u0000': 2 });
	expect(Object.hasOwn(back.proto, '__proto__')).toBe(true);
	expect(Object.getPrototypeOf(back.proto)).toBe(Object.prototype);
	expect(back.odd[6]).toBeInstanceOf(DataView);
	expect(back.odd[7]).toBeInstanceOf(ArrayBuffer);
	expect(back.odd[4][0]).toBe(-4n);
	// one array in two places is one array; each array its own buffer, as a box's is
	expect(back.geometries[0].attributes.again.array).toBe(back.geometries[0].attributes.position.array);
	expect([...back.geometries[1].index]).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
	for (const a of [back.geometries[1].index, back.geometries[0].index]) expect(a.buffer.byteLength).toBe(a.byteLength);
});

test('an entry holds only what a build is made of', () => {
	for (const v of [new Map(), new Date(0), () => 1, new (class Picture {})(), Symbol('x'), 1n]) expect(() => cache.packed({ data: [v] })).toThrow();
});

test("a file that doesn't read is refused", () => {
	const file = cache.packed(build());
	const cut = file.slice(0, -1);
	const longer = new Uint8Array(file.byteLength + 8);
	longer.set(file);
	const other = file.slice();
	other[0] ^= 1;
	const lying = cache.packed({ a: new Float32Array(2) });
	// its part says its bytes are further on than the file holds
	const json = new TextDecoder().decode(lying.subarray(16, 16 + new DataView(lying.buffer).getUint32(4, true)));
	lying.set(new TextEncoder().encode(json.replace('["Float32Array",0,8]', '["Float32Array",8,8]')), 16);
	for (const f of [cut, longer, other, lying, new Uint8Array(3), 'text', null]) expect(() => cache.unpacked(f)).toThrow(/refused/);
});

test('the cache keeps a build and its recipe file in its folder, reads them back, drops and empties them', async () => {
	const key = 'a'.repeat(64);
	const hash = 'b'.repeat(64);
	expect(await cache.get(key)).toBeUndefined();
	const data = { format: 4, geometries: [{ attributes: { position: { array: new Float32Array([1, 2, 3]) } } }] };
	const card = { recipe: hash, label: 'A thing' };
	expect(await cache.put(key, { data, card })).toBe(true);
	expect([...root.files.keys()]).toContain(`build-${key}`);
	const got = await cache.get(key);
	expect(got.card).toEqual(card);
	expect(cache.fingerprint(got.data)).toBe(cache.fingerprint(data));

	const recipe = new TextEncoder().encode('export default () => {}');
	expect(await cache.keepFile(hash, recipe)).toBe(true);
	expect(recipe.byteLength).toBeGreaterThan(0);
	expect(await cache.fileAt(hash)).toEqual(recipe);
	expect(await cache.usage()).toEqual({ count: 2, bytes: root.files.get(`build-${key}`).bytes.byteLength + recipe.byteLength, kept: true });

	// a spoiled entry comes back as one to refuse (../load.js drops it), then it is gone
	root.files.get(`build-${key}`).bytes[20] ^= 0xff;
	expect(await cache.get(key)).toEqual({ data: null, card: null });
	await cache.drop(key);
	expect(await cache.get(key)).toBeUndefined();

	expect(await cache.putRaw(key, { data, card })).toBe(true);
	await cache.clear();
	expect(await cache.usage()).toEqual({ count: 0, bytes: 0, kept: true });
	expect(root.files.size).toBe(0);
});

test('a browser that writes no file of the cache keeps nothing, and every asset builds', async () => {
	// OPFS a page reads but writes no file in (a WebKit with none in its workers, and no writable files of the page's)
	const bare = folderOf();
	const getFileHandle = bare.getFileHandle;
	bare.getFileHandle = async (...a) => ({ ...(await getFileHandle.apply(bare, a)), createWritable: undefined });
	Object.defineProperty(globalThis.navigator, 'storage', { value: { getDirectory: async () => bare }, configurable: true });
	const none = await import('./cache.js?none');
	expect(await none.keeps()).toBe(false);
	expect(await none.usage()).toEqual({ count: 0, bytes: 0, kept: false });
	const key = 'c'.repeat(64);
	expect(await none.put(key, { data: { format: 4 }, card: {} })).toBe(false);
	expect(await none.keepFile('d'.repeat(64), new Uint8Array(3))).toBe(false);
	expect(await none.get(key)).toBeUndefined();
	expect(bare.files.size).toBe(0);
	expect(await cache.keeps()).toBe(true);
});
