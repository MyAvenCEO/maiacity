/*
 * AVENDB'S DEVICE IN A PAGE, as tests/page.rs drives it in Chromium (P8e): each device a frame of one tab, so all of
 * them share the tab's virtual authenticator, which holds the person's passkey. The query says who the device is and
 * what it does. With `server`, it makes the passkey and founds its person's vault, then writes a note; with `offer`, it
 * links through that code; if its store (`store`, in IndexedDB) holds a device already, it opens that one again. Then
 * it waits to read `reads` in block 2 of the note, writes `write` there, and waits to read `then`; once done, with
 * `close`, it saves and closes. Each step is reported to the test, with the passkey's ceremonies so far.
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

/** Waits until the device reads `body` in block 2 of the note, two minutes at most. */
async function reads(device, note, body) {
	const end = Date.now() + 120_000;
	while ((await device.text(note.space, note.entry, 2)) !== body) {
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
		unlock: (nonce) => (count++, passkey.unlock(nonce)),
		sign: (challenge, step) => (count++, trace(`a ceremony: ${step}`), passkey.sign(challenge, step))
	};
}

async function run() {
	await init();
	const store = await open(q.get('store'));
	const meta = await store.meta();
	const start = performance.now();
	let device, passkey, note;
	if (meta) {
		passkey = counted(ceremonies(avendb, meta.credential));
		const unlock = await passkey.unlock(unhex(meta.nonce));
		const kept = await store.load();
		device = await avendb.Device.open(meta.name, meta.relay, meta.passkey, unlock, kept.ops, kept.keys);
		note = meta.note;
	} else {
		const [name, relay] = [q.get('name'), q.get('relay')];
		const nonce = crypto.getRandomValues(new Uint8Array(32));
		if (q.get('server')) {
			trace('making the passkey');
			const made = await create(name);
			passkey = counted(ceremonies(avendb, made.id));
			trace('unlocking');
			const unlock = await passkey.unlock(nonce);
			trace('founding');
			const [server, setup] = [q.get('server'), q.get('setup')];
			device = await avendb.Device.found(name, relay, server, setup, made.spki, unlock, passkey.sign);
			const [notes] = await device.notes();
			const entry = await device.write(notes.founder, notes.space, 'Seeds', q.get('write'));
			note = { actor: notes.founder, space: notes.space, entry };
		} else {
			passkey = counted(ceremonies(avendb));
			trace('unlocking');
			const unlock = await passkey.unlock(nonce);
			trace('linking');
			device = await avendb.Device.link(name, relay, q.get('offer'), unlock, passkey.sign);
			note = { actor: q.get('actor'), space: q.get('space'), entry: q.get('entry') };
		}
		const credential = passkey.passkey.held.id;
		await store.setMeta({ name, relay, nonce: hex(nonce), credential, passkey: device.passkey(), note });
	}
	const saving = store.follow(device);
	const ms = Math.round(performance.now() - start);
	const [vault, ceremonies_] = [await device.vault(), passkey.count()];
	const [ops, keys] = await device.size();
	const found = { ms, vault, ops, keys, ceremonies: ceremonies_, offer: device.offer(), endpoint: device.endpoint() };
	await report(meta ? 'opened' : 'started', { ...found, ...note });
	if (q.get('reads')) {
		trace('reading');
		await reads(device, note, q.get('reads'));
		await report('read');
	}
	if (q.get('write') && !q.get('server')) {
		await device.setText(note.actor, note.space, note.entry, 2, q.get('write'));
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
		await report('closed', { ops: store.written, keys: store.keys.size, ceremonies: passkey.count() });
		return;
	}
	await report('done', { ceremonies: passkey.count() });
	// it stays on, for the next device to link through it
	Object.assign(globalThis, { device });
}

run().catch((e) => report('error', { error: String(e?.stack ?? e) }));
