// @ts-nocheck — plain JS, trusted: the page's avenDB device's own worker (./remote.js)
/*
 * THE DEVICE'S WORKER — the page's avenDB device (./device/avendb_browser.js, its WebAssembly) run beside the page, so
 * that a long replay, a sync reply's signatures checked one by one or a proof read back (`provenCode`) never holds the
 * page's thread: the page keeps its frames while the device works. Its shelf's store (./device/store.js) is opened here
 * too, by a worker of its own inside this one, where OPFS has its synchronous files, as it was beside the page before.
 *
 * Nothing here touches the page: the passkey's ceremonies (navigator.credentials, ./device/passkey.js), what the device
 * shows of its steps and the bytes of a file it brings stay the page's, each a function the page hands over, called
 * back across (`{fn, call, args}`, answered `{back, ok}` or `{back, error}`).
 *
 * The page talks to it through ./remote.js: each message `{id, target, method, args}`, each answer `{id, ok}` or
 * `{id, error}`. `target` is `pkg` (the module's own functions), `Device` (a start: found, link, open), `store`, or a
 * device's number, as an answer named it (`{$device}`), until it is freed. Calls run side by side, never queued: a
 * device's `changed` waits until it holds something new, however long that is.
 */

import { localOperation } from '../../../game/code/sources/local-policy.js';
import init, * as avendb from './device/avendb_browser.js';
import { open } from './device/store.js';
import { deviceTransports, rtcWorkerCarrier } from './transports/worker.js';
import { browserCarrierCapabilities } from './transports/config.js';

/** What the page may call, by target: nothing of the module beyond these. */
const CALLS = {
	pkg: ['storeMeta', 'qrSvg', 'prfSalt', 'deviceSalt', 'provenCode'],
	Device: ['found', 'link', 'open'],
	store: ['hold', 'release', 'aside'],
	device: ['keep', 'rename', 'moving', 'move_keys', 'sign_checkpoint', 'behind', 'vault', 'claim_invite', 'run', 'size', 'changed', 'stirred', 'close', 'free']
};

/** The WebAssembly, started once, by the first call. */
let started = null;
/** The page's store, once it opened it (`openStore`). */
let store = null;
/** The devices the page holds, by number, until it frees them. */
const devices = new Map();
const transports = new Map();
let nextDevice = 0;
let rtcAvailable = false;
/** The page's functions called and not answered yet, by call. */
const asked = new Map();
let nextCall = 0;

/** A function of the page's, `fn`, called across: a promise of what it gave back. One whose answer nobody awaits, as
 *  the steps shown, fails quietly. */
const page = (fn) => (...args) => {
	const answered = new Promise((resolve, reject) => {
		const call = nextCall++;
		asked.set(call, { resolve, reject });
		postMessage({ fn, call, args });
	});
	answered.catch(() => {});
	return answered;
};

/** The open invite a newcomer signs up with, the hex of its share, while the page says so (`pkg.invite`). */
let invite = null;
/** The relay's pass shown as the device shows it, with the invite it signs up with, so a relay that lets newcomers in by
 *  invite alone (`AVENDB_SIGNUP=invite`, Admission.lean) lets this one in; every other fetch as it was. */
const fetched = globalThis.fetch.bind(globalThis);
globalThis.fetch = (resource, init) => {
	if (invite && typeof resource === 'string') {
		const url = new URL(resource, location.href);
		if (url.pathname.endsWith('/feed/relay-pass')) {
			url.searchParams.set('invite', invite);
			return fetched(url.href, init);
		}
	}
	return fetched(resource, init);
};

/** What the page sent as an argument: its functions and its store, as it names them, else as it came. */
function taken(arg) {
	if (arg && typeof arg === 'object' && '$fn' in arg) return page(arg.$fn);
	if (arg && typeof arg === 'object' && '$store' in arg) {
		if (!store) throw new Error('the store is not open');
		return store;
	}
	return arg;
}

/** What goes back to the page: a device as its number and what it says of itself at once, else as it is. */
function given(ok) {
	if (!(ok instanceof avendb.Device)) return ok;
	const n = nextDevice++;
	devices.set(n, ok);
	transports.set(n, deviceTransports(ok, { webtransport: browserCarrierCapabilities().webtransport, openRtc: rtcAvailable ? (descriptor, callbacks) =>
		rtcWorkerCarrier({ ...descriptor, device: n }, callbacks, (message, moving) => postMessage(message, moving)) : undefined }));
	return { $device: n, id: ok.id(), endpoint: ok.endpoint(), passkey: ok.passkey(), offer: ok.offer() };
}

/** Whether `bytes` is the whole of its buffer, which an answer can then hand over rather than copy. */
const whole = (bytes) => bytes instanceof Uint8Array && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;

/** The buffers of `ok` the answer hands over: the bytes it is, or a `read_file`'s, made for it alone. */
function handed(ok) {
	if (whole(ok)) return [ok.buffer];
	return whole(ok?.bytes) ? [ok.bytes.buffer] : [];
}

/** An error as it crosses: its words and its name. */
const thrown = (e) => ({ message: String(e?.message ?? e), name: e?.name });

/** What `target`'s `method` is, as the page may call it. */
function callee(target, method) {
	if (typeof target === 'number') {
		const device = devices.get(target);
		if (!device || !CALLS.device.includes(method)) throw new Error(`no device ${target} to ${method}`);
		if (method === 'close' || method === 'free') {
			transports.get(target)?.close(); transports.delete(target);
			postMessage({ $transport: 'close-device', device: target });
		}
		if (method === 'free') devices.delete(target);
		return device[method].bind(device);
	}
	if (!CALLS[target]?.includes(method)) throw new Error(`the device's worker has no ${target}.${method}`);
	if (target === 'store') {
		if (!store) throw new Error('the store is not open');
		return store[method].bind(store);
	}
	return target === 'Device' ? avendb.Device[method].bind(avendb.Device) : avendb[method];
}

/** Runs one call and answers it. */
async function answer({ id, target, method, args }) {
	try {
		started ??= init();
		await started;
		if (method === 'run' && args?.length) args = [localOperation(args[0]), ...args.slice(1)];
		let ok;
		if (target === 'pkg' && method === 'start') ok = undefined;
		else if (target === 'pkg' && method === 'openStore') store ??= await open(...args);
		else if (target === 'pkg' && method === 'invite') invite = /^[0-9a-f]{64}$/.test(args[0] ?? '') ? args[0] : null;
		else ok = given(await callee(target, method)(...args.map(taken)));
		postMessage({ id, ok }, handed(ok));
	} catch (e) {
		postMessage({ id, error: thrown(e) });
	}
}

onmessage = ({ data }) => {
	if (data.$transport === 'capabilities') {
		// Sent once by this worker's owning Window before its first device request.
		rtcAvailable = data.webrtc === true; return;
	}
	if (!('back' in data)) return void answer(data);
	const call = asked.get(data.back);
	asked.delete(data.back);
	if (!call) return;
	if (!('error' in data)) return call.resolve(data.ok);
	call.reject(Object.assign(new Error(data.error.message), data.error.name ? { name: data.error.name } : {}));
};
