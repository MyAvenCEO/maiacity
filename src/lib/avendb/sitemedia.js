/**
 * The site's media: the pictures, sounds and films the site shows by the BLAKE3 hash their bytes had in the old media
 * vault (src/lib/media/manifest.json, src/lib/media/url.ts), each copied once into the seed's Maia City as a file
 * named `<hash>.<ending>`, tagged `site:media`, which one Public share on that tag lets everyone read (Samuel
 * 2026-10-19, the final move to avenDB). avenDB's server serves each by that hash (avendb-server's feed.rs,
 * `/feed/media/`), and api.maia.city's `/vault/files/<hash>` asks it first, the old gateway only for what it has none
 * of yet (deploy/Caddyfile): the site's addresses stay as they are. A file the old vault keeps private (it answers
 * 401 without the Mac app's key) is copied as it is there, private: tagged `legacy:media` alone, which no share
 * reaches. The copy runs by itself in the background as an owner of Maia City opens avenDB (./Account.svelte, Samuel
 * 2026-10-19: "copy everything for me"), and ./SiteMedia.svelte offers it on Maia City's Library besides (`copyAll`).
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { EVERYONE } from './vaults.js';

/** The tag of the site's media, which the Public share reaches. */
export const SITE = 'site:media';
/** The tag of every file copied from the old media vault, public there or not. */
export const LEGACY = 'legacy:media';

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
		if (e?.tags?.some((t) => t === SITE || t === LEGACY)) continue;
		left.push({ hash, name, media: p.mime, title: p.title || name, ...(e ? { entry: e.entry } : {}) });
	}
	return left;
}

/**
 * The copies of the site's files `manifest` (by hash) vault `vault` holds more than once, in world `world`, as the
 * iPad and the Mac copied the same files at once (2026-10-19): of the live file entries of each name, all copied
 * (`legacy:media`), all the site's or none, all bringing the same file, every one but the first made, by entry, to
 * delete (Samuel 2026-10-19: "Remove doubles"). Names whose entries differ in any of that are left as they are.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {Record<string, Published>} manifest
 * @returns {{ entry: string, name: string }[]}
 */
export function doubled(world, vault, manifest) {
	const names = new Set(Object.entries(manifest).map(([hash, p]) => nameOf(hash, p.mime)));
	/** @type {Map<string, import('./vaults.js').EntryView[]>} */
	const by = new Map();
	for (const e of world.entries) {
		if (e.vault !== vault || e.type !== 'file' || e.deleted || !e.title || !names.has(e.title)) continue;
		if (e.tags?.includes(LEGACY) && e.files?.[0]) by.set(e.title, [...(by.get(e.title) ?? []), e]);
	}
	/** @type {{ entry: string, name: string }[]} */
	const out = [];
	for (const [name, es] of by) {
		const same = (/** @type {(e: import('./vaults.js').EntryView) => unknown} */ f) => new Set(es.map(f)).size === 1;
		if (es.length < 2 || !same((e) => e.files[0].root) || !same((e) => !!e.tags?.includes(SITE))) continue;
		/** @param {import('./vaults.js').EntryView} a @param {import('./vaults.js').EntryView} b */
		const first = (a, b) => (a.created ?? Infinity) - (b.created ?? Infinity) || a.entry.localeCompare(b.entry);
		for (const e of [...es].sort(first).slice(1)) out.push({ entry: e.entry, name });
	}
	return out;
}

/**
 * What copying pieces `left` into vault `vault` takes besides their bytes, acting for `actor`: the Public share on the
 * site's tag, where `shared` says the vault gives none yet, and the tag on each piece the vault holds already.
 * @param {Piece[]} left @param {string} vault @param {string} actor @param {boolean} shared
 */
export function marking(left, vault, actor, shared) {
	/** @type {object[]} */
	const ops = shared ? [] : [{ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { tag: SITE }, as: actor }];
	for (const p of left) if (p.entry) ops.push({ op: 'tag', entry: p.entry, add: [SITE, LEGACY], remove: [], as: actor });
	return ops;
}

/**
 * The op that brings piece `p` into vault `vault`, acting for `actor`, tagged as copied, the site's unless the old
 * vault keeps it private (`kept`), and as `asked` (the tags its cap asks a new file to carry, ./ops.js `creatable`);
 * its length is the file's.
 * @param {Piece} p @param {string} vault @param {string} actor @param {string[]} asked @param {boolean} [kept]
 */
export const bringing = (p, vault, actor, asked, kept = false) => ({
	op: 'put_file',
	vault,
	name: p.name,
	media: p.media,
	tags: [...new Set([LEGACY, ...(kept ? [] : [SITE]), ...asked])],
	as: actor
});

/** The bytes of a file kept whole once read, so the device's second reading needs no second download. */
const KEEP = 64 << 20;

/** How often a download is asked where the old vault's server fails, or the network does, before it gives up. */
const TRIES = 3;

/**
 * File `hash` from the first of `urls` that hands it over: the old vault's public gateway, then in the Mac app the
 * same through the app, with its key, which reads what the vault keeps private (`kept`, where only that one did). As a
 * device reads a file it brings (./session.svelte.js `bring`), it is a Blob's `size` and its
 * `slice(from, to).arrayBuffer()`, read in order from the start, twice (once for its key, once to seal it), each time
 * one download streamed through, or for a small one, the bytes the first kept. As the first reading ends its bytes
 * must hash to `hash` (BLAKE3), or it throws, so that no other bytes go in under its name. `close` lets go of a
 * download still open. Its `size` is the length the download names, or where it names none, it is read whole first.
 * A download the server fails (5xx) or the network drops is asked again, `TRIES` times in all, `wait` ms apart and
 * twice that the next time.
 * @param {string | string[]} urls @param {string} hash @param {typeof fetch} [get] @param {number} [keep] the most
 *   bytes kept @param {number} [wait]
 * @returns {Promise<{ size: number, kept: boolean, slice: (from: number, to: number) => { arrayBuffer: () =>
 *   Promise<ArrayBuffer> }, close: () => void }>}
 */
export async function source(urls, hash, get = fetch, keep = KEEP, wait = 1000) {
	const all = [urls].flat();
	/** The answer to a GET of `url`, asked again where the server or the network fails. @param {string} url */
	async function asked(url) {
		for (let n = 1; ; n++) {
			const res = await get(url, { cache: 'no-store' }).catch((e) => (n < TRIES ? null : Promise.reject(e)));
			if (res && (res.status < 500 || n === TRIES)) return res;
			await new Promise((r) => setTimeout(r, wait * 2 ** (n - 1)));
		}
	}
	/** @param {Response} res */
	const whole = (res) => {
		if (res.status === 200 && res.body) return res;
		const why = res.status === 401 ? ', which keeps it private (the Mac app reads it with its key)' : '';
		throw new Error(`the old vault answered ${res.status} for ${hash.slice(0, 12)}…${why}`);
	};
	// the first address that doesn't turn it away (401, 403): where it hands it over, or the last one's why not
	let url = all[0];
	let res = await asked(url);
	for (const next of all.slice(1)) {
		if (res.status !== 401 && res.status !== 403) break;
		url = next;
		res = await asked(url);
	}
	whole(res);
	const download = async () => whole(await asked(url));
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
		kept: url !== all[0],
		slice: (from, to) => ({ arrayBuffer: async () => /** @type {ArrayBuffer} */ ((await read(from, to - from)).buffer) }),
		close
	};
}

/**
 * Copies pieces `left` into vault `vault`, acting for `actor`, through the vault screens' `api`
 * (./session.svelte.js): first what marks them (`marking`: the Public share where `shared` says the vault gives none
 * yet, the tag on each it holds already), then each other piece from the first of its addresses (`urlsOf`, `source`)
 * that hands it over, one after another, quietly, as `asked` asks (./ops.js `creatable`), telling `progress` how far
 * it is, as fast as it goes (Samuel 2026-10-19: "a one time thing, just bring it through as fast as you can"). A
 * piece that fails is left out, and the rest go on; the next copy goes on from what is left. A piece the vault holds by
 * the time it comes to it (`held`: another device of an owner copied it meanwhile) is counted and not written again. What it copied,
 * of all, those the old vault keeps private, and why each failed piece did. A refusal of the marks stops it first.
 * @param {{ api: any, left: Piece[], vault: string, actor: string, shared: boolean, asked: string[],
 *   urlsOf: (hash: string) => string[], progress?: (at: { done: number, of: number, now: string, bytes: number }) => void,
 *   get?: typeof fetch, held?: (p: Piece) => boolean }} job
 */
export async function copyAll({
	api,
	left,
	vault,
	actor,
	shared,
	asked,
	urlsOf,
	progress = () => {},
	get = fetch,
	held = () => false
}) {
	const of = left.length;
	const marks = marking(left, vault, actor, shared);
	if (marks.length && !(await api.runAll('Making the site’s media public in Maia City', marks))) {
		throw new Error('Maia City didn’t take the share or the tags, so nothing was copied');
	}
	let done = left.filter((p) => p.entry).length;
	let kept = 0;
	/** @type {{ piece: Piece, why: string }[]} */
	const failed = [];
	for (const p of left.filter((p) => !p.entry)) {
		progress({ done, of, now: p.title, bytes: 0 });
		/** @type {Awaited<ReturnType<typeof source>> | undefined} */
		let file;
		try {
			if (held(p)) {
				done++;
				continue;
			}
			file = await source(urlsOf(p.hash), p.hash, get);
			progress({ done, of, now: p.title, bytes: file.size });
			await api.bring(`Copying ${p.title}`, bringing(p, vault, actor, asked, file.kept), file, true);
			done++;
			if (file.kept) kept++;
		} catch (e) {
			failed.push({ piece: p, why: /** @type {Error} */ (e)?.message ?? String(e) });
		} finally {
			file?.close();
		}
	}
	progress({ done, of, now: '', bytes: 0 });
	await api.refresh?.();
	return { done, of, kept, failed };
}
