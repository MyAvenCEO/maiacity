/*
 * AVENDB'S DEVICE IN A PAGE, as tests/page.rs drives it in Chromium (P8e): each device a frame of one tab, so all of
 * them share the tab's virtual authenticator, which holds the person's passkey. The query says who the device is and
 * what it does. With `server`, it makes the passkey and founds its person's vault, claiming the server if nobody has
 * yet, then writes a note; with `offer`, it
 * links through that code; if its store (`store`, in OPFS) holds a device already, it opens that one again. Then it
 * waits to read `reads` in block 2 of the note, writes `write` there, and waits to read `then`; once done, with
 * `close`, it saves and closes. Each step is reported to the test, with the passkey's ceremonies so far. With `legacy`,
 * it puts the store back where pages kept it before B2b, in IndexedDB, for the next page to move over; with `twice`,
 * it tries to load a store another page's device runs from.
 */
import init, * as avendb from '/pkg/avendb_browser.js';
import { ceremonies, create } from '/js/passkey.js';
import { open, remove } from '/js/store.js';

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

/**
 * Puts the store named `name` back in IndexedDB as pages kept it before B2b (`meta`, `ops` and `keys`), and takes it
 * out of OPFS: the next page to open it moves it over again. What it put there, counted.
 */
async function legacy(name) {
	const store = await open(name);
	const [meta, kept] = [await store.meta(), await store.load()];
	await store.close();
	const stores = ['meta', 'ops', 'keys'];
	const opening = indexedDB.open(name, 1);
	opening.onupgradeneeded = () => stores.forEach((s) => opening.result.createObjectStore(s));
	const db = await request(opening);
	const tx = db.transaction(stores, 'readwrite');
	tx.objectStore('meta').put(meta, 'device');
	kept.edits.forEach((edit, i) => tx.objectStore('ops').put(edit, i));
	kept.ids.forEach((id, i) => tx.objectStore('keys').put(kept.keys[i], id));
	await new Promise((resolve, reject) => {
		tx.oncomplete = resolve;
		tx.onerror = tx.onabort = () => reject(tx.error);
	});
	db.close();
	await remove(name);
	return { edits: kept.edits.length, keys: kept.ids.length };
}

async function main() {
	if (q.get('legacy')) return report('legacy', await legacy(q.get('store')));
	await init();
	const store = await open(q.get('store'));
	const meta = await store.meta();
	if (q.get('twice')) {
		const refused = await store.load().then(() => null, (e) => e.message);
		return report('twice', { refused });
	}
	const start = performance.now();
	let device, passkey, note;
	if (meta) {
		passkey = counted(ceremonies(avendb, meta.credential));
		const unlock = await passkey.unlock(unhex(meta.nonce));
		const kept = await store.load();
		const { name, relay, passkey: p256, mask } = meta;
		device = await avendb.Device.open(name, relay, p256, mask, unlock, kept.edits, kept.keys);
		note = meta.note;
	} else {
		const [name, relay] = [q.get('name'), q.get('relay')];
		const nonce = crypto.getRandomValues(new Uint8Array(32));
		if (q.get('server')) {
			trace('making the passkey');
			const made = await create(name);
			passkey = counted(ceremonies(avendb, made.id));
			trace('unlocking and founding');
			const unlock = (/** @type {Uint8Array} */ challenge) => passkey.unlock(nonce, challenge);
			device = await avendb.Device.found(name, relay, q.get('server'), made.spki, unlock, passkey.sign);
			const vault = await device.vault();
			const write = { op: 'create', vault, type: 'note', value: titled('Seeds', q.get('write')) };
			const { entry } = await run(device, write);
			note = { actor: vault, entry };
		} else {
			passkey = counted(ceremonies(avendb));
			trace('unlocking and linking');
			const unlock = (/** @type {Uint8Array} */ challenge) => passkey.unlock(nonce, challenge);
			device = await avendb.Device.link(name, relay, q.get('offer'), unlock);
			note = { actor: q.get('actor'), entry: q.get('entry') };
		}
		const credential = passkey.passkey.held.id;
		const mask = device.mask();
		await store.setMeta({ name, relay, nonce: hex(nonce), mask, credential, passkey: device.passkey(), note });
	}
	const saving = store.follow(device);
	const ms = Math.round(performance.now() - start);
	const [vault, ceremonies_] = [await device.vault(), passkey.count()];
	const [edits, keys] = await device.size();
	const found = { ms, vault, edits, keys, ceremonies: ceremonies_, offer: device.offer(), endpoint: device.endpoint() };
	found.indexed = (await indexedDB.databases()).map((d) => d.name);
	await report(meta ? 'opened' : 'started', { ...found, ...note });
	if (q.get('reads')) {
		trace('reading');
		await reads(device, note, q.get('reads'));
		await report('read');
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
	if (q.get('close')) {
		trace('closing');
		await store.save(device);
		await device.close();
		await saving;
		await report('closed', { edits: store.written, keys: store.keys.size, ceremonies: passkey.count() });
		return;
	}
	await report('done', { ceremonies: passkey.count() });
	// it stays on, for the next device to link through it
	Object.assign(globalThis, { device });
}

main().catch((e) => report('error', { error: String(e?.stack ?? e) }));
