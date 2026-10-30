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
// new leader may have taken over; given up after 20 s
function read(file, start, end) {
	const id = `${me}${asked++}`;
	return new Promise((resolve) => {
		const ask = () => channel.postMessage({ id, read: { file, start, end } });
		const again = setInterval(ask, 2_000);
		const gaveUp = setTimeout(() => done({ error: 'the Peer-Light did not answer in 20 s' }), 20_000);
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
		const head = headers(first.type, { 'Content-Length': String(first.size) });
		return new Response(new Blob(parts, { type: head['Content-Type'] }), { status: 200, headers: head });
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
	const last = start + got.bytes.length - 1;
	return new Response(got.bytes, {
		status: 206,
		headers: headers(got.type, { 'Content-Length': String(got.bytes.length), 'Content-Range': `bytes ${start}-${last}/${got.size}` }),
	});
}

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	const file = url.origin === self.location.origin && /^\/files\/([0-9a-f]{64})$/.exec(url.pathname);
	if (file) event.respondWith(serve(file[1], event.request.headers.get('range')));
});
