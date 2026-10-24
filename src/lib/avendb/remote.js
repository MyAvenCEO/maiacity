// @ts-nocheck — plain JS, trusted: the page's side of its avenDB device's worker (./remote.worker.js)
/*
 * THE DEVICE, SEEN FROM THE PAGE — the page's avenDB device runs in a worker of its own (./remote.worker.js), so that
 * its long work never holds the page's thread; this is what the page holds of it: the module's calls as the page made
 * them on ./device/avendb_browser.js before, each now a promise of the worker's answer. ./session.svelte.js alone
 * starts the device through it (and game/code/sources/feed.js reads proofs back through it, `provenCode`).
 *
 *   import * as avendb from './remote.js';
 *   await avendb.load();                              // the worker, and its WebAssembly, started once
 *   const store = await avendb.openStore('avendb-browser');
 *   const meta = await avendb.storeMeta(store);
 *   const d = await avendb.Device.open(unlocked, steps, store);
 *   await d.run(op, sign, read);                      // as on the module's Device, each call a promise
 *
 * A function handed to a call (an unlock, the passkey's ceremony, the steps shown, a file's bytes) stays the page's,
 * called back from the worker as the device calls it, and answered across; it runs here because the passkey's
 * ceremonies and the page's own things live only here. A device's `id`, `endpoint`, `passkey` and `offer` come with it
 * and are read at once, as before; everything else it does answers as a promise. The bytes the page hands over, the
 * unlock's PRF outputs among them, are moved to the worker, not copied, so the page keeps no copy of them.
 */

import { rtcPageHost } from './transports/page.js';
import { noteLifecycle } from './lifecycle.js';
import { browserCarrierCapabilities } from './transports/config.js';

/** The worker, once started, its calls waiting for an answer, and the page's functions it may call back. */
let worker = null;
let transports = null;
const calls = new Map();
let nextId = 0;
const fns = new Map();
let nextFn = 0;

/** Whether `bytes` is the whole of its buffer, which a call can then hand over rather than copy. */
const whole = (bytes) => bytes instanceof Uint8Array && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;

/** The buffers of `value` a message hands over: the bytes it is, or holds at its top, each once. */
function handed(value) {
	const all = whole(value) ? [value] : value && typeof value === 'object' ? Object.values(value).filter(whole) : [];
	return [...new Set(all.map((b) => b.buffer))];
}

/** An error as it crosses, and back. */
const thrown = (e) => ({ message: String(e?.message ?? e), name: e?.name });
const error = ({ message, name }) => Object.assign(new Error(message), name && name !== 'Error' ? { name } : {});

/** Every call still waiting fails with `why`, marked as the worker's failure (`worker`), not the device's answer. */
function fail(why) {
	calls.forEach((call) => call.reject(Object.assign(new Error(why), { worker: true })));
	calls.clear();
}

/** The worker, started on first use. */
function started() {
	if (worker) return worker;
	const current = new Worker(new URL('./remote.worker.js', import.meta.url), { type: 'module' });
	worker = current;
	const carriers = rtcPageHost(); transports = carriers;
	const suspended = () => carriers.suspend();
	globalThis.addEventListener?.('pagehide', suspended);
	current.onmessage = ({ data }) => {
		if (worker !== current) return;
		if (carriers.message(data)) return;
		if ('fn' in data) return void back(data, current);
		const call = calls.get(data.id);
		calls.delete(data.id);
		if (!call) return;
		if ('error' in data) call.reject(error(data.error));
		else call.resolve(data.ok);
	};
	// a worker that failed (it didn't load, or something in it went uncaught) is stopped, every call waiting on it
	// failing, and the next call starts another
	current.onerror = (e) => {
		e.preventDefault?.();
		carriers.close(); globalThis.removeEventListener?.('pagehide', suspended);
		current.terminate();
		if (worker !== current) return;
		noteLifecycle('worker-failed');
		worker = null; transports = null;
		fail(`avenDB's worker failed: ${e.message || 'it did not start'}`);
	};
	current.postMessage({ $transport: 'capabilities', webrtc: browserCarrierCapabilities().webrtc });
	return worker;
}

/** A function of the page's the worker called (`fn`): run here, and its answer sent back, its bytes handed over. */
async function back({ fn, call, args }, owner) {
	const f = fns.get(fn);
	try {
		if (!f) throw new Error('the page no longer holds what the device called');
		const ok = await f(...args);
		if (worker === owner) owner.postMessage({ back: call, ok }, handed(ok));
	} catch (e) {
		if (worker === owner) owner.postMessage({ back: call, error: thrown(e) });
	}
}

/**
 * Calls `target`'s `method` in the worker with `args`, handing over the buffers of the args at `moving`: a promise of
 * its answer, a device as one (`Device`). The functions among `args` are the page's for as long as the call lasts.
 */
function call(target, method, args = [], moving = []) {
	const w = started();
	const lent = [];
	const sent = args.map((arg) => {
		if (arg instanceof RemoteStore) return { $store: true };
		if (typeof arg !== 'function') return arg;
		const fn = nextFn++;
		fns.set(fn, arg);
		lent.push(fn);
		return { $fn: fn };
	});
	const moved = [...new Set(moving.flatMap((i) => handed(args[i])))];
	const id = nextId++;
	const answered = new Promise((resolve, reject) => {
		calls.set(id, { resolve, reject });
		w.postMessage({ id, target, method, args: sent }, moved);
	});
	return answered
		.then((ok) => (ok && typeof ok === 'object' && '$device' in ok ? new Device(ok, w) : ok))
		.finally(() => lent.forEach((fn) => fns.delete(fn)));
}

/** A device the page lets go of without freeing it is freed in the worker once the page holds it no more. */
const forgotten = new FinalizationRegistry(({ n, owner }) => {
	if (worker !== owner) return;
	transports?.closeDevice(n); void call(n, 'free').catch(() => {});
});

/** The page's store, opened in the worker (./device/store.js): what the page itself asks of it. */
class RemoteStore {
	hold() {
		return call('store', 'hold');
	}

	release() {
		return call('store', 'release');
	}

	aside() {
		return call('store', 'aside');
	}
}

/** A device running in the worker, as the module's Device is called: its calls each a promise. */
export class Device {
	#n;
	#said;
	#owner;

	constructor({ $device, ...said }, owner) {
		this.#n = $device;
		this.#said = said;
		this.#owner = owner;
		forgotten.register(this, { n: $device, owner }, this);
	}

	#call(method, args = []) {
		if (worker !== this.#owner) return Promise.reject(Object.assign(new Error('this device worker has ended'), { worker: true }));
		return call(this.#n, method, args);
	}

	/** A start (found, link, open), the bytes it is handed moved to the worker: its spki, the unlock's outputs. */
	static found(...args) {
		return call('Device', 'found', args, [3]);
	}

	static link(...args) {
		return call('Device', 'link', args);
	}

	static open(...args) {
		return call('Device', 'open', args, [0]);
	}

	id() {
		return this.#said.id;
	}

	endpoint() {
		return this.#said.endpoint;
	}

	passkey() {
		return this.#said.passkey;
	}

	/** Its code, as it said it when it started: in a browser it is reached through its relay, which it names. */
	offer() {
		return this.#said.offer;
	}

	keep(nonce, credential) {
		return this.#call('keep', [nonce, credential]);
	}

	rename(name) {
		return this.#call('rename', [name]);
	}

	moving() {
		return this.#call('moving');
	}

	move_keys(ceremony, steps) {
		return this.#call('move_keys', [ceremony, steps]);
	}

	sign_checkpoint(ceremony) {
		return this.#call('sign_checkpoint', [ceremony]);
	}

	behind() {
		return this.#call('behind');
	}

	vault() {
		return this.#call('vault');
	}

	claim_invite(server, share, secret) {
		return this.#call('claim_invite', [server, share, secret]);
	}

	run(op, ceremony, read) {
		return this.#call('run', [op, ceremony, read]);
	}

	size() {
		return this.#call('size');
	}

	changed(edits, keys) {
		return this.#call('changed', [edits, keys]);
	}

	stirred(since) {
		return this.#call('stirred', [since]);
	}

	close() {
		if (worker === this.#owner) transports?.closeDevice(this.#n);
		return this.#call('close');
	}

	/** Frees it in the worker, without closing it, as the module's `free` does; it answers nothing. */
	free() {
		forgotten.unregister(this);
		if (worker === this.#owner) transports?.closeDevice(this.#n);
		this.#call('free').catch(() => {});
	}
}

/** Starts the worker and its WebAssembly, once: fails where this browser can't run them. */
export const load = () => call('pkg', 'start');

/** Opens the page's store named `name` in the worker (./device/store.js `open`), once. */
export async function openStore(name) {
	await call('pkg', 'openStore', [name]);
	return new RemoteStore();
}

/** What opens the device on `store` again (avendb-browser's `storeMeta`), or undefined. */
export const storeMeta = (store) => call('pkg', 'storeMeta', [store]);

/** A QR code of `text`, as SVG, `size` pixels wide. */
export const qrSvg = (text, size) => call('pkg', 'qrSvg', [text, size]);

/** The salt of the PRF output for the passkey's own keys, and of the device whose own 32 bytes are `nonce`. */
export const prfSalt = () => call('pkg', 'prfSalt');
export const deviceSalt = (nonce) => call('pkg', 'deviceSalt', [nonce]);

/** The rows proof `bytes` proves of vault `vault`'s public code of kinds `kinds` (avendb-browser's `provenCode`), as
 *  JSON text, each signature checked and every rule replayed in the worker. */
export const provenCode = (bytes, vault, kinds) => call('pkg', 'provenCode', [bytes, vault, kinds]);

/** The open invite, the hex of its share, a newcomer's device shows its relay pass with while it signs up (null: none),
 *  so a relay that lets newcomers in by invite lets this one in. */
export const signUpWith = (invite) => call('pkg', 'invite', [invite ?? null]);
