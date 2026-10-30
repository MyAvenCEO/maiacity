// The city-dome's files as the browser asks for them (store/README.md, "How a file travels", 3): avenOS's <img>,
// <video> and <iframe> point at /files/<hash>, the file's index, and the browser asks for ranges. This Service Worker
// answers each with 206 Partial Content, its bytes read by this origin's Peer-Light from the chunks the range touches,
// fetched first if it lacks them, so a movie plays from any point without being fully downloaded. It asks the
// Peer-Light's leader over the BroadcastChannel `aven-peer-light:<network>`, as the tabs do: {id, read: {file, start,
// end}}, `end` exclusive and at most 1 MiB after `start`, answered {id, size, type, bytes} or {id, error}. Only the
// leader answers; a read unanswered after 2 s is asked again, as a new leader may have taken over. A request without a
// range gets the whole file (200). Nothing is cached here: the store is the cache.
const bridge = new BroadcastChannel('aven-peer-light:aven');
const waiting = new Map();
const me = `sw-${crypto.randomUUID()}`;
let asked = 0;
// the most one read asks for: a chunk. A browser's open-ended range gets the first MiB, and asks again
const most = 1 << 20;
// when an unanswered read is asked again, and when it is given up
const again = 2000;
const patience = 60000;

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
		const id = `${me}-${++asked}`;
		const ask = () => bridge.postMessage({ id, read: { file, start, end } });
		waiting.set(id, resolve);
		ask();
		const repeat = setInterval(() => (waiting.has(id) ? ask() : clearInterval(repeat)), again);
		setTimeout(() => {
			clearInterval(repeat);
			if (waiting.delete(id)) resolve({ error: 'no Peer-Light answered' });
		}, patience);
	});
}

// `bytes=a-b`, `bytes=a-` or `bytes=-n`, the one range a media element asks for; anything else is the whole file
function parse(header) {
	const r = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!r || (r[1] === '' && r[2] === '')) return null;
	if (r[1] === '') return { suffix: Number(r[2]) };
	return { start: Number(r[1]), end: r[2] === '' ? undefined : Number(r[2]) + 1 };
}

const failed = (got) => new Response(got.error, { status: got.error === 'not found' ? 404 : 502 });

async function serve(file, header) {
	const range = parse(header);
	if (!range) {
		// the whole file, a chunk at a time
		const first = await read(file, 0, most);
		if (first.error) return failed(first);
		const parts = [first.bytes];
		for (let at = first.bytes.length; at < first.size; ) {
			const got = await read(file, at, Math.min(at + most, first.size));
			if (got.error) return failed(got);
			parts.push(got.bytes);
			at += got.bytes.length;
			if (!got.bytes.length) break;
		}
		return new Response(new Blob(parts, { type: first.type }), {
			status: 200,
			headers: { 'Content-Type': first.type, 'Content-Length': String(first.size), 'Accept-Ranges': 'bytes' },
		});
	}
	let { start, end } = range;
	if (range.suffix !== undefined) {
		const size = await read(file, 0, 0);
		if (size.error) return failed(size);
		start = Math.max(0, size.size - range.suffix);
	}
	const got = await read(file, start, Math.min(end ?? start + most, start + most));
	if (got.error) return failed(got);
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
