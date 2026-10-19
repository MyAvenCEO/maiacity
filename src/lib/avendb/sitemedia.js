/**
 * The site's media: the pictures, sounds and films the site shows by the BLAKE3 hash their bytes had in the old media
 * vault (src/lib/media/manifest.json, src/lib/media/url.ts), each copied once into the seed's Maia City as a file
 * named `<hash>.<ending>`, tagged `site:media`, which one Public share on that tag lets everyone read (Samuel
 * 2026-10-19, the final move to avenDB). avenDB's server serves each by that hash (avendb-server's feed.rs,
 * `/feed/media/`), and api.maia.city's `/vault/files/<hash>` asks it first, the old gateway only for what it has none
 * of yet (deploy/Caddyfile): the site's addresses stay as they are. ./SiteMedia.svelte offers the copy.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { EVERYONE } from './vaults.js';

/** The tag of the site's media, which the Public share reaches. */
export const SITE = 'site:media';

/** Each media type the site shows, and the ending its file is named with (as avenDB's server reads it back). */
export const ENDINGS = /** @type {Record<string, string>} */ ({
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'audio/mpeg': 'mp3',
	'audio/mp4': 'm4a',
	'video/mp4': 'mp4',
	'video/webm': 'webm'
});

/** A BLAKE3 hash in 64 lower-case hex digits. */
const HASH = /^[0-9a-f]{64}$/;

/** The name of the site's file of hash `hash` and media type `media`: `null` for one it doesn't show. @param {string}
 *  hash @param {string} media */
export const nameOf = (hash, media) => (HASH.test(hash) && ENDINGS[media] ? `${hash}.${ENDINGS[media]}` : null);

/**
 * @typedef {{ mime: string, title?: string }} Published one file of the manifest, by its hash
 * @typedef {{ hash: string, name: string, media: string, title: string, entry?: string }} Piece one of the site's
 *   files: by its hash, the name it has in Maia City, its media type and its title; and the entry that holds it there
 *   already, where one does
 */

/**
 * What of the site's files `manifest` (by hash) vault `vault` doesn't hold as the site's yet, in world `world`: each
 * with the entry of a file of its name the vault holds already (an article's picture, named by its hash too), which
 * needs only the tag, or none, for one to copy in. The rest, held and tagged, are done.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {Record<string, Published>} manifest
 * @returns {Piece[]}
 */
export function uncopied(world, vault, manifest) {
	/** @type {Map<string, import('./vaults.js').EntryView>} */
	const held = new Map();
	for (const e of world.entries) {
		if (e.vault === vault && e.type === 'file' && !e.deleted && e.title && e.files?.[0] && !held.has(e.title)) held.set(e.title, e);
	}
	/** @type {Piece[]} */
	const left = [];
	for (const [hash, p] of Object.entries(manifest)) {
		const name = nameOf(hash, p.mime);
		if (!name) continue;
		const e = held.get(name);
		if (e?.tags?.includes(SITE)) continue;
		left.push({ hash, name, media: p.mime, title: p.title || name, ...(e ? { entry: e.entry } : {}) });
	}
	return left;
}

/**
 * What copying pieces `left` into vault `vault` takes besides their bytes, acting for `actor`: the Public share on the
 * site's tag, where `shared` says the vault gives none yet, and the tag on each piece the vault holds already.
 * @param {Piece[]} left @param {string} vault @param {string} actor @param {boolean} shared
 */
export function marking(left, vault, actor, shared) {
	/** @type {object[]} */
	const ops = shared ? [] : [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { tag: SITE }, as: actor }];
	for (const p of left) if (p.entry) ops.push({ op: 'tag', entry: p.entry, add: [SITE], remove: [], as: actor });
	return ops;
}

/**
 * The op that brings piece `p` into vault `vault`, acting for `actor`, tagged the site's and as `asked` (the tags its
 * cap asks a new file to carry, ./ops.js `creatable`); its length is the file's.
 * @param {Piece} p @param {string} vault @param {string} actor @param {string[]} asked
 */
export const bringing = (p, vault, actor, asked) => ({
	op: 'put_file',
	vault,
	name: p.name,
	media: p.media,
	tags: [...new Set([SITE, ...asked])],
	as: actor
});

/** The bytes of a file kept whole once read, so the device's second reading needs no second download. */
const KEEP = 16 << 20;

/**
 * File `hash` from `url`, as a device reads a file it brings (./session.svelte.js `bring`): a Blob's `size` and its
 * `slice(from, to).arrayBuffer()`, read in order from the start, twice (once for its key, once to seal it), each time
 * one download streamed through, or for a small one, the bytes the first kept. As the first reading ends its bytes
 * must hash to `hash` (BLAKE3), or it throws, so that no other bytes go in under its name. `close` lets go of a
 * download still open. Its `size` is the length the download names, or where it names none, it is read whole first.
 * @param {string} url @param {string} hash @param {typeof fetch} [get] @param {number} [keep] the most bytes kept
 * @returns {Promise<{ size: number, slice: (from: number, to: number) => { arrayBuffer: () => Promise<ArrayBuffer> },
 *   close: () => void }>}
 */
export async function source(url, hash, get = fetch, keep = KEEP) {
	/** @returns {Promise<Response>} */
	const download = async () => {
		const res = await get(url, { cache: 'no-store' });
		if (res.status !== 200 || !res.body) throw new Error(`the old vault answered ${res.status} for ${hash.slice(0, 12)}…`);
		return res;
	};
	let res = await download();
	const named = Number(res.headers.get('content-length') ?? NaN);
	/** @type {Uint8Array | null} */
	let kept = Number.isSafeInteger(named) && named >= 0 ? null : new Uint8Array(await res.arrayBuffer());
	const size = kept ? kept.length : named;

	/** the download being read: its reader, what it read past what was taken, and where in the file it is */
	/** @type {{ reader: ReadableStreamDefaultReader<Uint8Array>, rest: Uint8Array, at: number } | null} */
	let open = kept ? null : { reader: /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader(), rest: new Uint8Array(0), at: 0 };
	/** what the first reading collects, where the file is small enough to keep */
	let collecting = !kept && size <= keep ? new Uint8Array(size) : null;
	let hasher = blake3.create();
	let hashed = 0;
	let checked = false;

	const close = () => {
		open?.reader.cancel().catch(() => {});
		open = null;
	};

	/** The `n` bytes from `at` on, from the download, a new one where it is past them. @param {number} at @param {number} n */
	async function streamed(at, n) {
		if (!open || open.at > at) {
			close();
			res = await download();
			open = { reader: /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader(), rest: new Uint8Array(0), at: 0 };
		}
		const o = open;
		const out = new Uint8Array(n);
		let got = 0;
		while (got < n) {
			if (!o.rest.length) {
				const { value, done } = await o.reader.read();
				if (done) throw new Error(`the old vault’s ${hash.slice(0, 12)}… ended at ${o.at} of ${size} bytes`);
				o.rest = value;
			}
			const skip = Math.max(0, Math.min(at - o.at, o.rest.length));
			if (skip) {
				o.rest = o.rest.subarray(skip);
				o.at += skip;
				continue;
			}
			const take = Math.min(n - got, o.rest.length);
			out.set(o.rest.subarray(0, take), got);
			o.rest = o.rest.subarray(take);
			o.at += take;
			got += take;
		}
		return out;
	}

	/** The `n` bytes from `at` on: hashed as the first reading goes, and checked as it ends. @param {number} at @param
	 *  {number} n */
	async function read(at, n) {
		n = Math.max(0, Math.min(n, size - at));
		if (!checked && at === 0 && hashed) [hasher, hashed] = [blake3.create(), 0];
		const bytes = kept ? kept.slice(at, at + n) : await streamed(at, n);
		if (!checked && at === hashed) {
			hasher.update(bytes);
			collecting?.set(bytes, at);
			hashed += bytes.length;
			if (hashed === size) {
				checked = true;
				const got = bytesToHex(hasher.digest());
				if (got !== hash) throw new Error(`the old vault’s ${hash.slice(0, 12)}… hashes to ${got.slice(0, 12)}…, not its name`);
				if (collecting) {
					[kept, collecting] = [collecting, null];
					close();
				}
			}
		}
		return bytes;
	}

	if (!size) {
		// an empty file: nothing is read, so it is checked here
		if (bytesToHex(blake3(new Uint8Array(0))) !== hash) throw new Error(`the old vault’s ${hash.slice(0, 12)}… is empty`);
		checked = true;
	}
	return {
		size,
		slice: (from, to) => ({ arrayBuffer: async () => /** @type {ArrayBuffer} */ ((await read(from, to - from)).buffer) }),
		close
	};
}
