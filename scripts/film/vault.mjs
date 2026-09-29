// The vault, for this Mac's own tools (the render worker, the film scripts, `bun media`, `bun voice`): the Mac app's
// local vault server on 127.0.0.1:4545, behind the app's token. Every file is known by its BLAKE3 hash (64 hex) and
// nothing else — no paths, no CIDs. The app must be running.
//
//   list()                 the catalog: every file's Meta
//   meta(hash)             one file's Meta (null when the catalog does not know it)
//   bytes(hash)            its bytes
//   fileOf(hash)           its bytes on this disk: a copy in the cache (~/.cache/maiacity/media/<hash>.<ext>), made once
//   add(path | bytes, about)   a new file (the app's three-hash check) → { hash, verdict, meta }
//   describe(hash, patch)  what is known about it: each field given replaces the one before; meta is merged key by key
//
// MAIACITY_VAULT / MAIACITY_VAULT_TOKEN point it at another server (a test one).
import { createWriteStream, existsSync, mkdirSync, openAsBlob, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const VAULT = process.env.MAIACITY_VAULT ?? 'http://127.0.0.1:4545';
const TOKEN = join(homedir(), 'Library', 'Application Support', 'city.maia.studio', 'mcp-token');
export const CACHE = join(process.env.MAIACITY_CACHE ?? join(homedir(), '.cache', 'maiacity'), 'media');

/**
 * What the vault knows about a file besides its bytes.
 * @typedef {{ hash: string, size: number, mime: string, kind: string, title?: string, description?: string, tags?: string[],
 *   meta?: Record<string, any>, public: boolean, original_name?: string, source?: string, ingest?: string, added: string }} Meta
 * @typedef {{ name?: string, title?: string, description?: string, tags?: string[], meta?: Record<string, unknown>, public?: boolean }} About
 */

/** A file's extension by its type: the cache names files <hash>.<ext> (ffmpeg, and an EXR sequence's tar, go by it). */
export const EXT = /** @type {Record<string, string>} */ ({
	'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/x-exr': 'exr',
	'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
	'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
	'application/x-tar': 'tar', 'application/octet-stream': 'bin'
});

export const isHash = (/** @type {unknown} */ s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
/** A reference to a file — its hash, alone or with an extension ("<hash>.mp3") — as the bare hash. */
export const bare = (/** @type {string} */ ref) => ref.replace(/\.[a-z0-9]+$/, '');

let token = /** @type {string | null} */ (null);
function auth() {
	token ??= process.env.MAIACITY_VAULT_TOKEN ?? (existsSync(TOKEN) ? readFileSync(TOKEN, 'utf8').trim() : null);
	if (!token) throw new Error(`no vault token at ${TOKEN}: is the Mac app installed and started?`);
	return { authorization: `Bearer ${token}` };
}

/** @param {string} path @param {RequestInit & { timeout?: number }} [init] */
async function req(path, init = {}) {
	const res = await fetch(`${VAULT}${path}`, {
		...init,
		headers: { ...auth(), ...(init.headers ?? {}) },
		...(init.timeout ? { signal: AbortSignal.timeout(init.timeout) } : {})
	}).catch((e) => {
		throw new Error(`the vault (${VAULT}) does not answer — is the Mac app running? (${e.message})`);
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(`vault ${path.split('?')[0]}: ${body?.error ?? res.status}`);
	}
	return res;
}

let catalog = /** @type {Promise<Meta[]> | null} */ (null);
/** The catalog: every file this vault describes (kept for the process; `fresh` reads it again). */
export function list(/** @type {{ fresh?: boolean, timeout?: number }} */ o = {}) {
	if (o.fresh || !catalog) {
		catalog = req('/vault/files', { timeout: o.timeout }).then((r) => r.json());
		catalog.catch(() => (catalog = null));
	}
	return /** @type {Promise<Meta[]>} */ (catalog);
}

/** One file's Meta, from the catalog (read again, so nothing written meanwhile is missed). */
export async function meta(/** @type {string} */ hash) {
	return (await list({ fresh: true })).find((m) => m.hash === hash) ?? null;
}

/** A file's bytes. */
export async function bytes(/** @type {string} */ hash) {
	return new Uint8Array(await (await req(`/vault/files/${hash}`)).arrayBuffer());
}

/**
 * A file on this disk: a copy of the vault's bytes in the cache, fetched once (streamed: a render is gigabytes).
 * @param {string} hash @param {string} [mime] its type, for the extension (else the catalog's)
 */
export async function fileOf(hash, mime) {
	if (!isHash(hash)) throw new Error(`not a file hash: ${hash}`);
	const ext = EXT[mime ?? (await meta(hash))?.mime ?? ''] ?? 'bin';
	const file = join(CACHE, `${hash}.${ext}`);
	if (existsSync(file)) return file;
	mkdirSync(CACHE, { recursive: true });
	const res = await req(`/vault/files/${hash}`);
	const part = `${file}.part`;
	try {
		await pipeline(Readable.fromWeb(/** @type {any} */ (res.body)), createWriteStream(part));
		renameSync(part, file);
	} catch (e) {
		rmSync(part, { force: true });
		throw e;
	}
	return file;
}

/**
 * Add a file (a path on disk, or bytes): the app ingests it with the three-hash check. The same bytes again are
 * "duplicate" (the same hash), and what `about` says still applies. `replaces`: the files it takes the place of, by
 * hash — they stay, tagged "superseded".
 * @param {string | Uint8Array} from @param {About & { replaces?: string[] }} [about]
 * @returns {Promise<{ hash: string, verdict: string, meta: Meta }>}
 */
export async function add(from, about = {}) {
	const { replaces = [], ...rest } = about;
	const name = rest.name ?? (typeof from === 'string' ? basename(from) : undefined);
	const body = typeof from === 'string' ? await openAsBlob(from) : new Blob([/** @type {BlobPart} */ (from)]);
	const q = encodeURIComponent(JSON.stringify({ ...rest, ...(name ? { name } : {}) }));
	const out = await (await req(`/vault/files?about=${q}`, { method: 'POST', body, headers: { 'content-type': 'application/octet-stream' } })).json();
	for (const old of replaces.map(bare).filter((h) => h !== out.hash)) {
		const m = await meta(old);
		if (m && !m.tags?.includes('superseded')) await describe(old, { tags: [...(m.tags ?? []), 'superseded'] });
	}
	catalog = null;
	return out;
}

/**
 * Describe a file: title, description, tags (replaced), public, meta (merged key by key).
 * @param {string} hash @param {Omit<About, 'name'>} patch
 * @returns {Promise<Meta>}
 */
export async function describe(hash, patch) {
	catalog = null;
	return (await req('/vault/describe', { method: 'POST', body: JSON.stringify({ hash, ...patch }), headers: { 'content-type': 'application/json' } })).json();
}

// ─────────────────────────────── a voice take's words ───────────────────────────────

/**
 * Each voice take's word timings (meta.words, written by `bun voice say`), by hash — or null where none are known.
 * From the vault's catalog (import-library brought library/'s meta over whole, words and all). Only what the vault
 * cannot give — it does not answer (the app not running, a machine without it), or a take has no words there — is
 * read from the old library/ folder beside the repo, still named by CID: <cid>.json, by the migration's map
 * (vault/migration/cid-to-blake3.json) inverted. LIBRARY=<dir> reads only that folder (a fixture: <hash>.json).
 * So a shot list always loads; without any of them its timing is simply unknown.
 * @param {string[]} hashes
 * @returns {Promise<Map<string, { word: string, start: number, end: number }[] | null>>}
 */
export async function wordsOf(hashes) {
	const out = new Map(hashes.map((h) => [bare(h), /** @type {any} */ (null)]));
	const dir = process.env.LIBRARY;
	if (!dir) {
		const all = await list({ timeout: 3000 }).catch(() => null);
		for (const m of all ?? []) if (out.has(m.hash) && Array.isArray(m.meta?.words)) out.set(m.hash, m.meta.words);
		if ([...out.values()].every(Boolean)) return out;
	}
	// the files by name: a fixture by hash, library/ by CID
	const lib = dir ?? new URL('../../library/', import.meta.url).pathname;
	const mapFile = new URL('../../vault/migration/cid-to-blake3.json', import.meta.url);
	/** @type {Record<string, string>} */
	const cidOf = {};
	if (existsSync(mapFile)) for (const [cid, v] of Object.entries(JSON.parse(readFileSync(mapFile, 'utf8')))) cidOf[v.hash] = cid;
	for (const h of out.keys()) {
		if (out.get(h)) continue;
		const f = [join(lib, `${h}.json`), ...(cidOf[h] ? [join(lib, `${cidOf[h]}.json`)] : [])].find((p) => existsSync(p));
		if (f) out.set(h, JSON.parse(readFileSync(f, 'utf8')).meta?.words ?? null);
	}
	return out;
}
