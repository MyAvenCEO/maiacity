/*
 * AVENDB'S DEVICE IN A PAGE, as tests/page.rs drives it in Chromium (P8d). The query says who the device is and what it
 * does: its name, the relay, the code it links through, its person's passkey (hex), the entry it reads (hex), what it
 * waits to read there, then what it writes as which vault, and what it waits to read after. Each step is reported to
 * the test; once done, the device stays on for the next device to link through it.
 */
import init, { Device } from '/pkg/avendb_browser.js';

const q = new URLSearchParams(location.search);

/** Tell the test a step is done, with what it found. */
const report = (/** @type {string} */ what, /** @type {object} */ found = {}) =>
	fetch(`/report/${q.get('page')}/${what}`, { method: 'POST', body: JSON.stringify(found) });

const unhex = (/** @type {string} */ s) => new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/** Waits until the device reads `body` in block 2 of the entry, two minutes at most. */
async function reads(/** @type {Device} */ device, /** @type {string} */ body) {
	const end = Date.now() + 120_000;
	while ((await device.text(q.get('space'), q.get('entry'), 2)) !== body) {
		if (Date.now() > end) throw new Error(`it doesn't read ${JSON.stringify(body)} within two minutes`);
		await sleep(100);
	}
}

async function run() {
	await init();
	const start = performance.now();
	const device = await Device.link(q.get('name'), q.get('relay'), q.get('offer'), unhex(q.get('passkey') ?? ''));
	const ms = Math.round(performance.now() - start);
	const vault = await device.vault();
	await report('linked', { ms, device: device.id(), endpoint: device.endpoint(), offer: device.offer(), vault });
	await reads(device, q.get('reads') ?? '');
	await report('read');
	if (q.get('write')) {
		await device.setText(q.get('actor'), q.get('space'), q.get('entry'), 2, q.get('write'));
		await report('wrote');
	}
	if (q.get('then')) {
		await reads(device, q.get('then') ?? '');
		await report('read again');
	}
	const [ops, blobs] = await device.size();
	await report('done', { ops, blobs });
	// it stays on, for the next device to link through it
	Object.assign(globalThis, { device });
}

run().catch((e) => report('error', { error: String(e?.stack ?? e) }));
