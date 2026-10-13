// avenDB's Library (src/lib/avendb/Library.svelte): plays a film or a song the person's device holds, sealed, as the
// browser's player asks for it, a range at a time, so that neither the page nor this worker ever holds the whole file.
// The player asks for `…/app/avendb/file/<root>/<size>/<len>?type=<media>`, the file's root and sealed size in hex and
// bytes, and its length; this worker asks the avenDB page for those bytes, a window at a time over a MessageChannel,
// which its device reads from its own store or fetches from a peer and opens with the file's key
// (avendb-browser's `readFile`), and hands them on as the range the player asked for. Only a film's or a song's type
// is ever served: anything else goes out as bytes to save, never as a page of this site.

/** A file's address, as the Library gives the player: its root, sealed size and length. */
const PATH = /\/app\/avendb\/file\/([0-9a-f]{64})\/(\d+)\/(\d+)$/;
/** How many bytes the worker asks the page for at a time. */
const WINDOW = 1 << 20;
/** The types it serves as what they are: films and songs. */
const PLAYS = /^(video|audio)\/[\w.+-]+$/;
/** How long it waits for the page's bytes. */
const WAIT = 60_000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	const m = url.origin === self.location.origin ? PATH.exec(url.pathname) : null;
	if (!m) return;
	const type = url.searchParams.get('type') ?? '';
	event.respondWith(serve(event, { root: m[1], size: Number(m[2]) }, Number(m[3]), type));
});

/**
 * The bytes of file `file`, `len` long, the request asks for: the range its `Range` header names, else the whole of
 * it, read from the avenDB page a window at a time, as the player reads them.
 * @param {FetchEvent} event @param {{ root: string, size: number }} file @param {number} len @param {string} type
 */
async function serve(event, file, len, type) {
	const page = await reader(event);
	if (!page) return new Response('Open avenDB in a tab to play this file.', { status: 503 });
	const asked = /^bytes=(\d*)-(\d*)$/.exec(event.request.headers.get('range') ?? '');
	let [from, to] = [0, len];
	if (asked?.[1]) [from, to] = [Number(asked[1]), asked[2] ? Math.min(len, Number(asked[2]) + 1) : len];
	else if (asked?.[2]) from = Math.max(0, len - Number(asked[2]));
	if (asked && from >= to) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${len}` } });
	let at = from;
	const body = new ReadableStream({
		async pull(out) {
			const bytes = await read(page, { ...file, from: at, to: Math.min(to, at + WINDOW) });
			if (!bytes.byteLength) throw new Error('the file ends early');
			out.enqueue(bytes);
			at += bytes.byteLength;
			if (at >= to) out.close();
		}
	});
	const headers = new Headers({
		'Content-Type': PLAYS.test(type) ? type : 'application/octet-stream',
		'Content-Length': String(to - from),
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': 'sandbox'
	});
	if (asked) headers.set('Content-Range', `bytes ${from}-${to - 1}/${len}`);
	return new Response(body, { status: asked ? 206 : 200, headers });
}

/**
 * The avenDB page that reads the file: the one whose player asks, else any open one.
 * @param {FetchEvent} event
 */
async function reader(event) {
	const avendb = (/** @type {Client | undefined} */ c) => !!c && /\/app\/avendb\/?$/.test(new URL(c.url).pathname);
	const own = event.clientId ? await self.clients.get(event.clientId) : undefined;
	if (avendb(own)) return own;
	const pages = await self.clients.matchAll({ type: 'window' });
	return pages.find(avendb) ?? null;
}

/**
 * Bytes `from` to `to` of a file, as page `page` reads them.
 * @param {Client} page @param {{ root: string, size: number, from: number, to: number }} ask
 * @returns {Promise<Uint8Array>}
 */
function read(page, ask) {
	return new Promise((resolve, reject) => {
		const { port1, port2 } = new MessageChannel();
		const late = setTimeout(() => {
			port1.close();
			reject(new Error('the avenDB page didn’t answer'));
		}, WAIT);
		port1.onmessage = ({ data }) => {
			clearTimeout(late);
			port1.close();
			if (data?.bytes) resolve(new Uint8Array(data.bytes));
			else reject(new Error(data?.error ?? 'no bytes'));
		};
		page.postMessage({ avendb: 'read', ...ask }, [port2]);
	});
}
