// @ts-nocheck — plain JS, runs inside the box
/*
 * WHAT THE BOX CAN'T DO — every way out an untrusted recipe would try, tried from inside the box. Each answers
 * `blocked` (refused, as it must be) or `OPEN` (it got through: a hole). The box's page (/app/assets/box/) and the
 * box test run it; every answer must be blocked.
 */
const tries = {
	fetch: () => fetch('https://api.maia.city/api/me', { credentials: 'include' }).then((r) => r.status),
	'fetch same site': () => fetch('/').then((r) => r.status),
	XMLHttpRequest: () =>
		new Promise((ok, no) => {
			const x = new XMLHttpRequest();
			x.onload = () => ok(x.status);
			x.onerror = () => no(new Error('error'));
			x.open('GET', 'https://example.com/');
			x.send();
		}),
	WebSocket: () =>
		new Promise((ok, no) => {
			const w = new WebSocket('wss://echo.websocket.org/');
			w.onopen = () => ok('open');
			w.onerror = () => no(new Error('error'));
		}),
	EventSource: () =>
		new Promise((ok, no) => {
			const s = new EventSource('https://example.com/');
			s.onopen = () => ok('open');
			s.onerror = () => no(new Error('error'));
		}),
	importScripts: () => importScripts('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js'),
	'import()': () => import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js'),
	indexedDB: () =>
		new Promise((ok, no) => {
			const r = indexedDB.open('box-probe');
			r.onsuccess = () => ok('opened');
			r.onerror = () => no(r.error);
		}),
	OPFS: () => navigator.storage.getDirectory().then(() => 'opened'),
	caches: () => caches.open('box-probe').then(() => 'opened'),
	'nested worker': () =>
		new Promise((ok, no) => {
			const w = new Worker('data:text/javascript,postMessage(fetch)');
			w.onmessage = () => ok('started');
			w.onerror = () => no(new Error('error'));
		}),
	BroadcastChannel: () => new BroadcastChannel('box-probe') && 'opened',
	'eval': () => (0, eval)('1 + 1'),
	'new Function': () => new Function('return 1')(),
	origin: () => (self.origin === 'null' ? Promise.reject(new Error('opaque origin')) : self.origin)
};

/** every way out, tried: { name: 'blocked: …' | 'OPEN: …' } */
export async function probe() {
	const out = {};
	for (const [name, attempt] of Object.entries(tries)) {
		try {
			const got = await Promise.race([Promise.resolve().then(attempt), new Promise((_, no) => setTimeout(() => no(new Error('no answer in 3 s')), 3000))]);
			out[name] = `OPEN: ${String(got).slice(0, 80)}`;
		} catch (err) {
			out[name] = `blocked: ${String(err?.message ?? err).slice(0, 80)}`;
		}
	}
	return out;
}
