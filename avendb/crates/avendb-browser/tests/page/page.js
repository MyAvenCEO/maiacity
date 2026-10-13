/*
 * AVENDB'S DEVICE IN A PAGE, as tests/page.rs drives it in Chromium (P8e, v8 phase S): each device a frame of one tab,
 * so all of them share the tab's virtual authenticator, which holds the person's passkey. The query says who the
 * device is and what it does. With `server`, it makes the passkey and founds its person's vault, claiming the server if
 * nobody has yet, then writes a note; with `offer`, it links through that code; if its store (`store`, its shelf in
 * OPFS) holds a device already, it opens that one again. Then it waits to read `reads` in block 2 of the note, writes
 * `write` there, and waits to read `then`; with `wait`, it then waits for the test's word; once done, with `close`, it
 * closes, its shelf holding all it holds, and with `forget` it forgets the device, its shelf put aside. The device that
 * founds the vault also brings a file, whose pieces its shelf keeps, and reads it back; with `file`, a device reads
 * that file from its peers. Each step is reported to the test, with the passkey's ceremonies so far. With `earlier`,
 * it keeps in OPFS and IndexedDB what an earlier avenDB kept for the store, which nothing may read or change; with
 * `twice`, it tries to hold a store another page's device runs from.
 */
import init, * as avendb from '/pkg/avendb_browser.js';
import { ceremonies, create } from '/js/passkey.js';
import { open } from '/js/store.js';

const q = new URLSearchParams(location.search);

/** Tell the test a step is done, with what it found. */
const report = (/** @type {string} */ what, /** @type {object} */ found = {}) =>
	fetch(`/report/${q.get('page')}/${what}`, { method: 'POST', body: JSON.stringify(found) });

/** Note a step on the console, which the test shows if a page fails. */
const trace = (/** @type {string} */ step) => console.log(`avenDB test, page ${q.get('page')}: ${step}`);

const hex = (/** @type {Uint8Array} */ b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (/** @type {string} */ s) => new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/** Op `op` of the ops engine run on the device, as the page runs every read and change: what it did, or it throws. */
async function run(device, op) {
	const out = await device.run(op);
	if (!('ok' in out)) throw new Error(`${op.op} refused: ${out.refused}, ${out.why}`);
	return out.ok;
}

/** The text of block 2 of the note, as the device reads it: undefined while it can't. */
async function text(device, note) {
	const out = await device.run({ op: 'get', entry: note.entry });
	return out.ok?.record.blocks?.find((/** @type {{id: number}} */ b) => b.id === 2)?.text;
}

/** A note as the page writes one: its heading (block 1) the title too, then a paragraph (block 2) that reads `text`. */
const titled = (/** @type {string} */ title, /** @type {string} */ text) => ({
	kind: 'document',
	title,
	blocks: [
		{ id: 1, type: 'heading', level: 1, text: title },
		{ id: 2, type: 'paragraph', text }
	]
});

/** How long the file the founding browser brings is: more than three of the page's one megabyte steps. */
const FILE = 3 * 1024 * 1024 + 4321;

/** The bytes from `from` to `to` of the file the test brings. */
const pattern = (/** @type {number} */ from, /** @type {number} */ to) =>
	Uint8Array.from({ length: to - from }, (_, i) => ((from + i) * 7) % 251);

/** Brings the test's file into vault `vault` and reads it back: its root and sealed size, in hex and bytes. */
async function bring(device, vault) {
	const file = { name: 'Seeds.bin', media: 'application/octet-stream', tags: [], len: FILE };
	const entry = await device.addFile(vault, vault, file, (/** @type {number} */ at, /** @type {number} */ n) =>
		pattern(at, at + n)
	);
	const world = await device.world();
	const [{ root, size }] = world.entries.find((/** @type {{entry: string}} */ e) => e.entry === entry).files;
	if (!(await same(device, { root, size }))) throw new Error('the file it brought reads back wrong');
	return { root, size };
}

/** Whether the device reads the test's file right across a step, or false while it can't read it yet. */
async function same(device, /** @type {{root: string, size: number}} */ file) {
	const [from, to] = [1024 * 1024 - 100, 2 * 1024 * 1024 + 50];
	const got = await device.readFile(file.root, file.size, from, to).catch(() => null);
	const want = pattern(from, to);
	return !!got && got.length === want.length && got.every((b, i) => b === want[i]);
}

/** Waits until the device reads the test's file from its peers, two minutes at most. */
async function fetched(device, /** @type {{root: string, size: number}} */ file) {
	const end = Date.now() + 120_000;
	while (!(await same(device, file))) {
		if (Date.now() > end) throw new Error('it doesn\'t read the file within two minutes');
		await sleep(500);
	}
}

/** The folder of store `name` in OPFS. */
async function folder(/** @type {string} */ name) {
	const stores = await (await navigator.storage.getDirectory()).getDirectoryHandle('avendb', { create: true });
	return stores.getDirectoryHandle(name, { create: true });
}

/** The names of what folder `dir` holds, in order, or none if there is no such folder. */
async function names(dir, /** @type {string[]} */ path) {
	try {
		for (const part of path) dir = await dir.getDirectoryHandle(part);
		const found = [];
		for await (const key of dir.keys()) found.push(key);
		return found.sort();
	} catch {
		return [];
	}
}

/** What store `name`'s shelf in generation `g` keeps of its blobs: each blob under its hash, and its outboard. */
async function shelved(/** @type {string} */ name, /** @type {string} */ g) {
	const dir = await folder(name);
	return { blobs: await names(dir, [g, 'blobs']), outboards: await names(dir, [g, 'outboards']) };
}

/** Waits until the device reads `body` in block 2 of the note, two minutes at most. */
async function reads(device, note, body) {
	const end = Date.now() + 120_000;
	while ((await text(device, note)) !== body) {
		if (Date.now() > end) throw new Error(`it doesn't read ${JSON.stringify(body)} within two minutes`);
		await sleep(100);
	}
}

/** The passkey's ceremonies, counted. */
function counted(passkey) {
	let count = 0;
	return {
		passkey,
		count: () => count,
		unlock: (nonce, challenge) => (count++, passkey.unlock(nonce, challenge)),
		sign: (challenge, step) => (count++, trace(`a ceremony: ${step}`), passkey.sign(challenge, step))
	};
}

/** A request to IndexedDB, as a promise. */
const request = (r) =>
	new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});

/** What an earlier avenDB kept for a store: in its OPFS folder, its edits, what opened its device and a key; and in
 *  IndexedDB, as pages kept it before B2b. */
const EARLIER = {
	ops: new Uint8Array([0, 0, 0, 3, 1, 2, 3]),
	meta: new TextEncoder().encode('\u0000\u0000\u0000\u0011{"name":"Eve\'s"}'),
	key: new Uint8Array([9, 9, 9])
};

/** Writes `bytes` as file `name` of `dir`. */
async function put(dir, /** @type {string} */ name, /** @type {Uint8Array} */ bytes) {
	const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
	await writable.write(bytes);
	await writable.close();
}

/** The bytes of file `name` of `dir`, in hex, or null if there is none. */
async function read(dir, /** @type {string} */ name) {
	try {
		return hex(new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()));
	} catch {
		return null;
	}
}

/** Keeps for store `name` what an earlier avenDB kept (`EARLIER`): what it kept, in hex. */
async function earlier(/** @type {string} */ name) {
	const dir = await folder(name);
	await put(dir, 'ops', EARLIER.ops);
	await put(dir, 'meta', EARLIER.meta);
	await put(await dir.getDirectoryHandle('keys', { create: true }), 'ab', EARLIER.key);
	const opening = indexedDB.open(name, 1);
	opening.onupgradeneeded = () => ['meta', 'ops', 'keys'].forEach((s) => opening.result.createObjectStore(s));
	const db = await request(opening);
	const tx = db.transaction(['meta'], 'readwrite');
	tx.objectStore('meta').put({ name: "Eve's" }, 'device');
	await new Promise((resolve, reject) => {
		tx.oncomplete = resolve;
		tx.onerror = tx.onabort = () => reject(tx.error);
	});
	db.close();
	return kept(name);
}

/** What store `name`'s folder holds of what an earlier avenDB kept, in hex, and whether IndexedDB holds it. */
async function kept(/** @type {string} */ name) {
	const dir = await folder(name);
	const keys = await dir.getDirectoryHandle('keys').catch(() => null);
	const indexed = (await indexedDB.databases()).some((d) => d.name === name);
	const [ops, meta, key] = [await read(dir, 'ops'), await read(dir, 'meta'), keys && (await read(keys, 'ab'))];
	return { ops, meta, key, indexed };
}

/** Waits for the test's word to go on, set in the tab's storage. */
async function word() {
	const key = `go:${q.get('page')}`;
	while (!localStorage.getItem(key)) await sleep(100);
}

async function main() {
	if (q.get('earlier')) return report('earlier', await earlier(q.get('store')));
	await init();
	const store = await open(q.get('store'));
	if (q.get('twice')) {
		const refused = await store.hold().then(() => null, (e) => e.message);
		return report('twice', { refused });
	}
	const meta = await avendb.storeMeta(store);
	const start = performance.now();
	let device, passkey, note;
	if (meta) {
		passkey = counted(ceremonies(avendb, meta.credential));
		const unlock = await passkey.unlock(unhex(meta.nonce));
		device = await avendb.Device.open(unlock, undefined, store);
		note = JSON.parse(localStorage.getItem(`note:${q.get('store')}`));
	} else {
		const [name, relay] = [q.get('name'), q.get('relay')];
		const nonce = crypto.getRandomValues(new Uint8Array(32));
		if (q.get('server')) {
			trace('making the passkey');
			const made = await create(name);
			passkey = counted(ceremonies(avendb, made.id));
			trace('unlocking and founding');
			const unlock = (/** @type {Uint8Array} */ challenge) => passkey.unlock(nonce, challenge);
			const server = q.get('server');
			const [spki, sign] = [made.spki, passkey.sign];
			device = await avendb.Device.found(name, relay, server, spki, unlock, sign, undefined, undefined, store);
			const vault = await device.vault();
			const write = { op: 'create', vault, type: 'note', value: titled('Seeds', q.get('write')) };
			const { entry } = await run(device, write);
			trace('bringing a file');
			note = { actor: vault, entry, file: await bring(device, vault) };
		} else {
			passkey = counted(ceremonies(avendb));
			trace('unlocking and linking');
			const unlock = (/** @type {Uint8Array} */ challenge) => passkey.unlock(nonce, challenge);
			device = await avendb.Device.link(name, relay, q.get('offer'), unlock, undefined, store);
			note = { actor: q.get('actor'), entry: q.get('entry') };
		}
		const kept = await device.keep(hex(nonce), passkey.passkey.held.id);
		if (kept.passkey !== device.passkey() || kept.device !== device.id()) throw new Error('it kept another device');
		localStorage.setItem(`note:${q.get('store')}`, JSON.stringify(note));
	}
	const ms = Math.round(performance.now() - start);
	const [vault, ceremonies_] = [await device.vault(), passkey.count()];
	const [edits, keys] = await device.size();
	const found = { ms, vault, edits, keys, ceremonies: ceremonies_, offer: device.offer(), endpoint: device.endpoint() };
	found.shelf = await shelved(q.get('store'), 'g1');
	found.generations = (await names(await folder(q.get('store')), [])).filter((n) => /^g[0-9]+$/.test(n));
	await report(meta ? 'opened' : 'started', { ...found, ...note });
	if (q.get('reads')) {
		trace('reading');
		await reads(device, note, q.get('reads'));
		await report('read');
	}
	if (q.get('file')) {
		const [root, size] = q.get('file').split(':');
		trace('reading the file');
		await fetched(device, { root, size: Number(size) });
		await report('fetched');
	}
	if (q.get('write') && !q.get('server')) {
		const path = ['blocks', { id: 2 }, 'text'];
		await run(device, { op: 'set', as: note.actor, entry: note.entry, path, value: q.get('write') });
		await report('wrote');
	}
	if (q.get('then')) {
		await reads(device, note, q.get('then'));
		await report('read again');
	}
	if (q.get('wait')) await word();
	if (q.get('close')) {
		trace('closing');
		const [edits, keys] = await device.size();
		await device.close();
		const shelf = await store.names('');
		await report('closed', { edits, keys, shelf, ceremonies: passkey.count() });
		if (!q.get('forget')) return;
		trace('forgetting');
		await store.aside();
		const dir = await folder(q.get('store'));
		const generations = (await names(dir, [])).filter((n) => /^g[0-9]+$/.test(n));
		const metas = { g1: await names(dir, ['g1', 'meta']), g2: await names(dir, ['g2', 'meta']) };
		const after = await avendb.storeMeta(store);
		await report('forgot', { generations, metas, meta: after ?? null, earlier: await kept(q.get('store')) });
		return;
	}
	await report('done', { ceremonies: passkey.count() });
	// it stays on, for the next device to link through it
	Object.assign(globalThis, { device });
}

main().catch((e) => report('error', { error: String(e?.stack ?? e) }));
