// The city-dome's files as the browser asks for them (store/README.md, "How a file travels", 3): avenOS's <img>,
// <video> and <iframe> point at /files/<hash>, the file's index, and the browser asks for ranges. This Service Worker
// answers each with 206 Partial Content, its bytes read by this origin's Peer-Light from the chunks the range touches,
// so a movie plays from any point without being fully downloaded. It reaches the Peer-Light over the BroadcastChannel
// `aven-peer-light:<network>`, as the tabs do: {id, read: {file, start, end}}, answered {id, size, type, bytes} or
// {id, error}. A request without a range gets the whole file (200). Nothing is cached here: the store is the cache.
const bridge = new BroadcastChannel('aven-peer-light:aven');
const waiting = new Map();
let asked = 0;
// the longest range answered at once: a browser asks again for the rest
const most = 4 << 20;
// how long a read may wait for a Peer-Light that holds the file
const patience = 30000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

bridge.onmessage = ({ data }) => {
	const answer = waiting.get(data?.id);
	if (!answer || data.read) return;
	waiting.delete(data.id);
	answer(data);
};

function read(file, start, end) {
	return new Promise((resolve) => {
		const id = `files-sw ${Date.now()} ${++asked}`;
		waiting.set(id, resolve);
		bridge.postMessage({ id, read: { file, start, end } });
		setTimeout(() => waiting.delete(id) && resolve({ error: 'no Peer-Light here holds this file yet' }), patience);
	});
}

// `bytes=a-b`, `bytes=a-` or `bytes=-n`, the one range a media element asks for; anything else is the whole file
function parse(header) {
	const r = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!r || (r[1] === '' && r[2] === '')) return null;
	if (r[1] === '') return { suffix: Number(r[2]) };
	return { start: Number(r[1]), end: r[2] === '' ? undefined : Number(r[2]) + 1 };
}

async function serve(file, header) {
	const range = parse(header);
	if (!range) {
		const got = await read(file, 0, undefined);
		if (got.error) return new Response(got.error, { status: 503 });
		return new Response(got.bytes, {
			status: 200,
			headers: { 'Content-Type': got.type, 'Content-Length': String(got.size), 'Accept-Ranges': 'bytes' },
		});
	}
	let { start, end } = range;
	if (range.suffix !== undefined) {
		const size = await read(file, 0, 0);
		if (size.error) return new Response(size.error, { status: 503 });
		start = Math.max(0, size.size - range.suffix);
	}
	const got = await read(file, start, Math.min(end ?? start + most, start + most));
	if (got.error) return new Response(got.error, { status: 503 });
	if (start >= got.size && got.size > 0)
		return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${got.size}` } });
	const last = start + got.bytes.length - 1;
	return new Response(got.bytes, {
		status: 206,
		headers: {
			'Content-Type': got.type,
			'Content-Length': String(got.bytes.length),
			'Content-Range': `bytes ${start}-${last}/${got.size}`,
			'Accept-Ranges': 'bytes',
		},
	});
}

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	const file = url.origin === self.location.origin && /^\/files\/([0-9a-f]{64})$/.exec(url.pathname);
	if (file) event.respondWith(serve(file[1], event.request.headers.get('range')));
});
