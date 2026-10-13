// The files of a vault, as its Library shows them (./Library.svelte): each an entry of type `file`, a document titled
// with the file's name, its media type among the document's own tags, whose first edit brings the file, sealed under a
// key of its own (avendb-browser's `Device::add_file`). Their kinds, and how the page reads one its device holds:
// a range at a time as a film or a song plays, through a service worker that answers the browser's player from the
// device (static/app/avendb-files.sw.js); or whole, into a Blob, for a picture, a PDF, a file to save, and a film where
// no service worker runs, as in the Mac app.

import { base } from '$app/paths';
import { size } from './vaults.js';

/** A file's kinds, as the Library groups them: each its name and icon. */
export const KINDS = /** @type {const} */ ([
	['film', 'Films', 'film'],
	['image', 'Images', 'image'],
	['svg', 'SVGs', 'svg'],
	['pdf', 'PDFs', 'pdf'],
	['audio', 'Audio', 'audio'],
	['other', 'Other', 'file']
]);
/** @typedef {(typeof KINDS)[number][0]} Kind */

/** The media type of a file by its name's ending, where the browser names none. */
const BY_END = /** @type {Record<string, string>} */ ({
	mp4: 'video/mp4',
	m4v: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm',
	mkv: 'video/x-matroska',
	ogv: 'video/ogg',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	heic: 'image/heic',
	svg: 'image/svg+xml',
	pdf: 'application/pdf',
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	aac: 'audio/aac',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	opus: 'audio/ogg',
	flac: 'audio/flac'
});

/** A name's ending, in lower case. @param {string} name */
const ending = (name) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

/** The media type a file goes by: the browser's, else its name's ending's. @param {{ name: string, type: string }} f */
export const mediaOf = (f) => f.type || BY_END[ending(f.name)] || 'application/octet-stream';

/** A file's kind, by its media type, else by its name's ending. @param {string | null} media @param {string} name */
export function kindOf(media, name = '') {
	const m = media && media !== 'application/octet-stream' ? media : (BY_END[ending(name)] ?? '');
	if (m === 'image/svg+xml') return 'svg';
	if (m.startsWith('video/')) return 'film';
	if (m.startsWith('image/')) return 'image';
	if (m === 'application/pdf') return 'pdf';
	if (m.startsWith('audio/')) return 'audio';
	return 'other';
}

/** How many bytes the page asks its device for at a time. */
const WINDOW = 4 << 20;
/** The most the page reads whole into its memory. */
export const WHOLE = 1 << 30;

/**
 * @typedef {{ root: string, size: number, len: number | null }} FileView a file an entry brings: its root in hex, its
 *   sealed size and, where the device opens it, its length
 * @typedef {(root: string, size: number, from: number, to: number) => Promise<Uint8Array>} Read
 */

/**
 * File `file` whole, read a window at a time, as a Blob of type `type`: `progress` told the share read so far.
 * @param {Read} read @param {FileView} file @param {string} type @param {(done: number) => void} [progress]
 */
export async function whole(read, file, type, progress) {
	const len = file.len ?? 0;
	if (len > WHOLE) throw new Error(`it is ${size(len)}, more than the ${size(WHOLE)} a page opens whole`);
	/** @type {BlobPart[]} */
	const parts = [];
	for (let at = 0; at < len; ) {
		const got = await read(file.root, file.size, at, Math.min(len, at + WINDOW));
		if (!got.length) throw new Error('the file ends early');
		parts.push(/** @type {BlobPart} */ (got));
		at += got.length;
		progress?.(at / len);
	}
	return new Blob(parts, { type });
}

/** An SVG as a data URL, which a new tab opens apart from this site, its scripts never this site's. @param {Blob} b */
export const dataUrl = (b) =>
	new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(/** @type {string} */ (r.result));
		r.onerror = () => reject(r.error);
		r.readAsDataURL(b);
	});

const WORKER = `${base}/app/avendb-files.sw.js`;
const SCOPE = `${base}/app/avendb`;

/** The address the browser's player streams file `file` of type `media` from, through the service worker. */
export const address = (/** @type {FileView} */ file, /** @type {string} */ media) =>
	`${SCOPE}/file/${file.root}/${file.size}/${file.len}?type=${encodeURIComponent(media)}`;

/**
 * Has the page answer the service worker's asks for a file's bytes with `read`, and starts the worker: `ready` says
 * whether it serves this page, so that its player streams through it (`address`); `stop` ends the answers.
 * @param {Read} read
 */
export function serve(read) {
	const sw = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
	if (!sw) return { ready: Promise.resolve(false), stop() {} };
	/** @param {MessageEvent} e */
	const answer = async (e) => {
		const [ask, port] = [e.data, e.ports[0]];
		if (ask?.avendb !== 'read' || !port) return;
		try {
			const got = await read(ask.root, ask.size, ask.from, ask.to);
			const own = got.byteOffset === 0 && got.byteLength === got.buffer.byteLength ? got : got.slice();
			port.postMessage({ bytes: own.buffer }, [own.buffer]);
		} catch (err) {
			port.postMessage({ error: /** @type {Error} */ (err)?.message ?? String(err) });
		}
	};
	sw.addEventListener('message', answer);
	sw.startMessages();
	const ready = (async () => {
		try {
			await sw.register(WORKER, { scope: SCOPE });
			if (!sw.controller) {
				await new Promise((done) => {
					sw.addEventListener('controllerchange', done, { once: true });
					setTimeout(done, 5000);
				});
			}
			return !!sw.controller?.scriptURL.endsWith(WORKER);
		} catch (e) {
			console.warn(`avenDB's films play whole, not streamed: ${/** @type {Error} */ (e).message}`);
			return false;
		}
	})();
	return { ready, stop: () => sw.removeEventListener('message', answer) };
}
