// The city-dome's files as the browser asks for them (store/README.md, "How a file travels", 3): avenOS's <img>,
// <video> and <iframe> point at /files/<hash>, the file's index, and the browser asks for ranges. This Service Worker
// answers each with 206 Partial Content, its bytes read by this origin's Peer-Light from the chunks the range touches,
// fetched first if it lacks them, so a movie plays from any point without being fully downloaded. It asks the
// Peer-Light's leader over its BroadcastChannel, as the tabs do (peer/bridge.js): {id, read: {file, start, end}}, `end`
// exclusive and at most 1 MiB after `start`, answered {id, size, type, bytes} or {id, error}: "not found" is a 404,
// anything else a 502. A request without a range gets the whole file (200). Nothing is cached here: the store is the
// cache.
// the Peer-Light's channel, `aven-peer-light:<name>`, its name given where the page registered this
// (`/files-sw.js?name=<name>`): the protocol peer/bridge.js speaks, here as a classic script, which a root Service
// Worker must be to serve /files/ in the release build too
const channel = new BroadcastChannel(`aven-peer-light:${new URL(self.location.href).searchParams.get('name') ?? 'network'}`);
const me = `sw-${crypto.randomUUID()}-`;
let asked = 0;
// What a file may be shown as, here on avenOS's own origin, which holds the device's secret: the type its sender
// claims is a claim. Only passive types are served inline (images but SVG, audio, video, PDF; Chat.svelte's `inline`
// keeps the same list); everything else, SVG and HTML included, is application/octet-stream and an attachment, so
// opening it downloads it and nothing in it runs here. Every answer forbids sniffing and sandboxes the document:
// no script, no form, its own opaque origin, whatever the bytes are.
const passive = /^(image\/(png|jpeg|gif|webp|avif|bmp)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf)$/;
const essence = (type) => String(type ?? '').split(';')[0].trim().toLowerCase();
function headers(claimed, more) {
	const type = essence(claimed);
	const inline = passive.test(type);
	return {
		'Content-Type': inline ? type : 'application/octet-stream',
		'Content-Disposition': inline ? 'inline' : 'attachment',
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; object-src 'self'",
		'Cross-Origin-Resource-Policy': 'same-origin',
		'Accept-Ranges': 'bytes',
		...more,
	};
}
// the most one read asks for: a chunk. A browser's open-ended range gets the first MiB, and asks again
const most = 1 << 20;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// at most 1 MiB of a file from the leader: {size, type, bytes} or {error}. Asked again every 2 s while unanswered, as a
// new leader may have taken over; given up after 60 s: a chunk the leader fetches first, from the Aven Peer or the
// sharer through the relay, can take longer than the 20 s this waited before on a phone's network
function read(file, start, end) {
	const id = `${me}${asked++}`;
	return new Promise((resolve) => {
		const ask = () => channel.postMessage({ id, read: { file, start, end } });
		const again = setInterval(ask, 2_000);
		const gaveUp = setTimeout(() => done({ error: 'the Peer-Light did not answer in 60 s' }), 60_000);
		const done = (answer) => {
			clearInterval(again);
			clearTimeout(gaveUp);
			channel.removeEventListener('message', hear);
			resolve(answer);
		};
		const hear = ({ data }) => {
			if (data?.id === id && !data.read) done({ ...data, type: data.type ?? 'application/octet-stream' });
		};
		channel.addEventListener('message', hear);
		ask();
	});
}

// `bytes=a-b`, `bytes=a-` or `bytes=-n`, the one range a media element asks for; anything else is the whole file
function parse(header) {
	const r = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!r || (r[1] === '' && r[2] === '')) return null;
	if (r[1] === '') return { suffix: Number(r[2]) };
	return { start: Number(r[1]), end: r[2] === '' ? undefined : Number(r[2]) + 1 };
}

const failed = (got) => new Response(got.error, { status: got.error === 'not found' ? 404 : 502, headers: headers(null) });

// `start..end` of a file (`end` exclusive) as a stream, a chunk at a time as the reader takes it, never gathered first,
// beginning with `first`, the read already made at `start`. WebKit's and Firefox's players ask without a range, or
// from a place to the end; a 90 MB movie gathered whole kept them waiting minutes, and a 206 cut at 1 MiB made WebKit's
// player stop as if the movie ended there (30 Oct 2026)
function streamed(file, first, start, end) {
	let at = start + first.bytes.length;
	return new ReadableStream({
		start(stream) {
			if (first.bytes.length) stream.enqueue(first.bytes);
			if (at >= end) stream.close();
		},
		async pull(stream) {
			// an engine may ask once more after the end (WebKit)
			if (at >= end) return stream.close();
			const got = await read(file, at, Math.min(at + most, end));
			if (got.error || !got.bytes.length) return stream.error(new Error(got.error ?? `no bytes at ${at}`));
			stream.enqueue(got.bytes);
			at += got.bytes.length;
			if (at >= end) stream.close();
		},
	});
}

async function serve(file, header) {
	const range = parse(header);
	if (!range) {
		const first = await read(file, 0, most);
		if (first.error) return failed(first);
		const body = streamed(file, first, 0, first.size);
		return new Response(body, { status: 200, headers: headers(first.type, { 'Content-Length': String(first.size) }) });
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
		return new Response(null, { status: 416, headers: headers(null, { 'Content-Range': `bytes */${got.size}` }) });
	// an explicit range (Safari's `bytes=0-1` probe) exactly; an open one, or a suffix, to the end of the file
	const to = Math.min(end ?? got.size, got.size);
	return new Response(streamed(file, got, start, to), {
		status: 206,
		headers: headers(got.type, { 'Content-Length': String(to - start), 'Content-Range': `bytes ${start}-${to - 1}/${got.size}` }),
	});
}

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	const file = url.origin === self.location.origin && /^\/files\/([0-9a-f]{64})$/.exec(url.pathname);
	if (file) event.respondWith(serve(file[1], event.request.headers.get('range')));
});
