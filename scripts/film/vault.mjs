// The media, for this Mac's own tools (the film scripts, `bun media`, `bun voice`): the Library of Maia City in avenDB
// (Studio 2), reached as the agent device agentScripts, a device of the coop's aven avenMAIA, with its rights and no
// more (./avendb.mjs: the first run waits for its person's approval in The OS app). The legacy vault on
// 127.0.0.1:4545 is gone from here.
//
// A file is a `file` entry of the vault. It is named by its BLAKE3 hash (64 hex) as before: a file brought from the
// legacy vault carries it as its `legacy:<hash>` tag, a file added here as its `blake3:<hash>` tag; a file with
// neither goes by its entry id (64 hex too). Every function takes any of them.
//
//   list()                 every file entry the device sees: its Meta
//   meta(hash)             one file's Meta (null when none is found)
//   bytes(hash)            its bytes
//   fileOf(hash)           its bytes on this disk: a copy in the cache (~/.cache/maiacity/media/<hash>.<ext>), made once
//   add(path | bytes, about)   a new file → { hash, entry, verdict, meta, aip? }
//   describe(hash, patch)  what is known about it: title and tags on the entry, description and meta in its "about"
//
// A file record holds only kind, title, media and tags (avenDB's File, v1), so a file's description and meta (a voice
// take's words, a sequence's fps) go in a JSON file entry beside it, tagged `about:<entry>` — its "about".
//
// Rights: where avenMAIA may create files (Editor on Maia City), a file lands at once (`put_file`). Where it may only
// suggest (a Suggester, its default), each add and describe is a draft or a proposal, put to Maia City in an AIP of
// its own, opened and promoted here: verdict "draft", and the file shows on the vault's main line only once a human
// accepts that AIP in The OS app (/app/aips/?aip=<aip>). Until then this device still reads it on its own line.
//
// AVENDB_VAULT names the vault by id (else the one named Maia City).
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ok, session } from './avendb.mjs';

export const CACHE = join(process.env.MAIACITY_CACHE ?? join(homedir(), '.cache', 'maiacity'), 'media');

/**
 * What is known about a file besides its bytes.
 * @typedef {{ hash: string, entry: string, vault: string, size: number, mime: string, kind: string, title?: string,
 *   description?: string, tags?: string[], meta?: Record<string, any>, public: boolean, original_name?: string,
 *   added: string, draft?: boolean }} Meta
 * @typedef {{ name?: string, title?: string, description?: string, tags?: string[], meta?: Record<string, unknown>, public?: boolean }} About
 * @typedef {{ entry: string, line: string }} Line a draft or proposal line, to name in an AIP
 */

/** A file's extension by its type: the cache names files <hash>.<ext> (ffmpeg, and an EXR sequence's tar, go by it). */
export const EXT = /** @type {Record<string, string>} */ ({
	'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/x-exr': 'exr',
	'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
	'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
	'application/x-tar': 'tar', 'application/json': 'json', 'application/octet-stream': 'bin'
});
const MIME = /** @type {Record<string, string>} */ ({ ...Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m])), jpeg: 'image/jpeg' });
/** A file's media type by its name's ending. @param {string} name */
export const mediaOf = (name) => MIME[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export const isHash = (/** @type {unknown} */ s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
/** A reference to a file — its hash, alone or with an extension ("<hash>.mp3") — as the bare hash. */
export const bare = (/** @type {string} */ ref) => ref.replace(/\.[a-z0-9]+$/, '');

const kindOf = (/** @type {string} */ m) => (m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'audio' : m.startsWith('image/') ? 'image' : 'other');
const parse = (/** @type {string} */ s) => {
	try {
		return s ? JSON.parse(s) : null;
	} catch {
		return null;
	}
};
const tagOf = (/** @type {any} */ e, /** @type {string} */ prefix) => (e.tags ?? []).find((/** @type {string} */ t) => t.startsWith(prefix))?.slice(prefix.length);
const live = (/** @type {any} */ e) => !e.deleted && !(e.tags ?? []).includes('avendb:deleted');
const MARK = /^(legacy|blake3):/;

let home = /** @type {Promise<string> | null} */ (null);
/** The vault files go in: AVENDB_VAULT, else the one named Maia City among those the device sees. */
export function vaultId() {
	home ??= (async () => {
		if (process.env.AVENDB_VAULT) return process.env.AVENDB_VAULT;
		const v = await session().tool('avendb_vaults');
		const id = v?.vaults?.find((/** @type {any} */ x) => /maia city/i.test(x.name ?? ''))?.id;
		if (!id) throw new Error(`avenDB: agentScripts sees no Maia City vault (${v?.who ?? 'not approved'}); set AVENDB_VAULT`);
		return id;
	})();
	home.catch(() => (home = null));
	return home;
}

let worldP = /** @type {Promise<any> | null} */ (null);
/** The device's world (kept for the process; `fresh` reads it again). */
async function world(fresh = false) {
	if (fresh || !worldP) {
		worldP = session().ask({ op: 'world' });
		worldP.catch(() => (worldP = null));
	}
	return (await worldP) ?? { vaults: [], entries: [] };
}

/** A file entry's name: its BLAKE3 (legacy or added here), else its entry. @param {any} e */
const hashOf = (e) => tagOf(e, 'legacy:') ?? tagOf(e, 'blake3:') ?? e.entry;

/** The file entry `ref` names, in `w`. @param {any} w @param {string} ref */
function find(w, ref) {
	const h = bare(ref);
	const files = w.entries.filter((/** @type {any} */ e) => e.type === 'file' && live(e));
	return files.find((/** @type {any} */ e) => e.entry === h) ?? files.find((/** @type {any} */ e) => hashOf(e) === h) ?? null;
}

/** The newest "about" of file entry `entry`: the JSON entry beside it, `{ entry, value }`. @param {any} w @param {string} entry */
async function aboutOf(w, entry) {
	const e = w.entries
		.filter((/** @type {any} */ x) => x.type === 'file' && live(x) && (x.tags ?? []).includes(`about:${entry}`))
		.sort((/** @type {any} */ a, /** @type {any} */ b) => (b.created ?? 0) - (a.created ?? 0))[0];
	if (!e) return null;
	try {
		const got = ok(await session().run({ op: 'get_file', entry: e.entry }), 'its about');
		return { entry: e.entry, value: parse(got?.text ?? '') ?? {} };
	} catch {
		return { entry: e.entry, value: {} };
	}
}

/** Rule `rule`'s newest done value of entry `entry` (a task's result), `null` where none. @param {any} w */
function made(w, /** @type {string} */ rule, /** @type {string} */ entry) {
	const t = w.entries
		.filter((/** @type {any} */ e) => e.type === 'task' && live(e) && e.record?.rule === rule && e.record?.status === 'done' && e.record?.inputs?.[0]?.entry === entry)
		.sort((/** @type {any} */ a, /** @type {any} */ b) => (b.record.at ?? 0) - (a.record.at ?? 0))[0];
	return t ? parse(t.record.result ?? '') : null;
}

/** File entry `e` as a Meta. @param {any} w @param {any} e */
async function metaOf(w, e) {
	const about = await aboutOf(w, e.entry);
	const probe = made(w, 'probe', e.entry);
	const media = e.media ?? e.record?.media ?? 'application/octet-stream';
	const f = e.files?.[0];
	return /** @type {Meta} */ ({
		hash: hashOf(e),
		entry: e.entry,
		vault: e.vault,
		size: f?.len ?? f?.size ?? 0,
		mime: media,
		kind: kindOf(media),
		title: e.title ?? e.record?.title ?? '',
		description: about?.value.description ?? '',
		tags: (e.tags ?? []).filter((/** @type {string} */ t) => !MARK.test(t)),
		meta: { ...(probe?.seconds ? { duration_s: probe.seconds } : {}), ...(about?.value.meta ?? {}) },
		public: false,
		original_name: e.record?.title ?? e.title,
		added: new Date((e.created ?? 0) * 1000).toISOString(),
		...(e.draft ? { draft: true } : {})
	});
}

let catalog = /** @type {Promise<Meta[]> | null} */ (null);
/** Every file entry the device sees but the abouts (kept for the process; `fresh` reads it again). */
export function list(/** @type {{ fresh?: boolean, timeout?: number }} */ o = {}) {
	if (o.fresh || !catalog) {
		catalog = (async () => {
			const w = await world(o.fresh);
			const files = w.entries.filter((/** @type {any} */ e) => e.type === 'file' && live(e) && !(e.tags ?? []).some((/** @type {string} */ t) => t.startsWith('about:')));
			return Promise.all(files.map((/** @type {any} */ e) => metaOf(w, e)));
		})();
		catalog.catch(() => (catalog = null));
	}
	const out = /** @type {Promise<Meta[]>} */ (catalog);
	if (!o.timeout) return out;
	const late = new Promise((_, no) => /** @type {any} */ (setTimeout(() => no(new Error('avenDB: no answer in time')), o.timeout)).unref?.());
	return /** @type {Promise<Meta[]>} */ (Promise.race([out, late]));
}

/** One file's Meta (read again, so nothing written meanwhile is missed). */
export async function meta(/** @type {string} */ hash) {
	const w = await world(true);
	const e = find(w, hash);
	return e ? metaOf(w, e) : null;
}

/** A file's bytes. */
export async function bytes(/** @type {string} */ hash) {
	return new Uint8Array(readFileSync(await fileOf(hash)));
}

/**
 * A file on this disk: a copy of its bytes in the cache, read once (the device writes it straight to the disk: a
 * render is gigabytes).
 * @param {string} hash @param {string} [mime] its type, for the extension (else the entry's)
 */
export async function fileOf(hash, mime) {
	hash = bare(hash);
	if (!isHash(hash)) throw new Error(`not a file hash: ${hash}`);
	if (mime) {
		const known = join(CACHE, `${hash}.${EXT[mime] ?? 'bin'}`);
		if (existsSync(known)) return known;
	}
	let w = await world();
	let e = find(w, hash);
	if (!e) e = find((w = await world(true)), hash);
	if (!e) throw new Error(`avenDB: no file ${hash.slice(0, 12)}… in the vaults agentScripts sees`);
	const file = join(CACHE, `${hash}.${EXT[mime ?? e.media ?? e.record?.media ?? ''] ?? 'bin'}`);
	if (existsSync(file)) return file;
	mkdirSync(CACHE, { recursive: true });
	const part = `${file}.part`;
	rmSync(part, { force: true });
	try {
		ok(await session().run({ op: 'get_file', entry: e.entry }, { path: part }), `reading ${hash.slice(0, 12)}…`);
		renameSync(part, file);
	} catch (err) {
		rmSync(part, { force: true });
		throw err;
	}
	return file;
}

/** The BLAKE3 of the file at `path`, streamed. @param {string} path */
async function blake3Of(path) {
	const h = blake3.create();
	for await (const chunk of createReadStream(path)) h.update(chunk);
	return bytesToHex(h.digest());
}

/**
 * How a new file entry tagged `tags` goes into vault `vault`: on main where avenMAIA may create one, else as a draft,
 * with the tags its share asks for besides; fails where it may do neither.
 * @param {string} vault @param {string[]} tags
 */
async function how(vault, tags) {
	for (const draft of [false, true]) {
		const a = await session().ask({ op: 'creatable', vault, type: 'file', tags, draft }).catch(() => null);
		if (Array.isArray(a?.tags)) return { draft, tags: [...new Set([...tags, ...a.tags])] };
	}
	throw new Error('avenDB: avenMAIA may neither add nor draft a file in Maia City — Maia City must give it Suggester (drafts) or Editor (files at once), in The OS app');
}

/**
 * A new file entry for the file at `path`, named `name`, titled `title`: `put_file` on main, else a draft that brings
 * it in its creation. `{ entry, line? }`, `line` for a draft.
 * @param {string} vault @param {string} path @param {string} name @param {string} title @param {string[]} tags
 */
async function newFile(vault, path, name, title, tags) {
	const media = mediaOf(name);
	const h = await how(vault, tags);
	const op = h.draft
		? { op: 'create', vault, type: 'file', tags: h.tags, draft: true, value: { kind: 'file', title, media }, file: { name, media } }
		: { op: 'put_file', vault, name, media, tags: h.tags };
	const out = ok(await session().run(op, { path }), `adding ${name}`);
	if (!h.draft && title && title !== name) await session().run({ op: 'set', entry: out.entry, path: ['title'], value: title });
	return { entry: /** @type {string} */ (out.entry), line: h.draft ? /** @type {string} */ (out.line) : null };
}

/** A value as a file in the temp folder, to bring in. @param {string} name @param {unknown} value */
function temp(name, value) {
	const dir = join(tmpdir(), 'maiacity-avendb');
	mkdirSync(dir, { recursive: true });
	const p = join(dir, `${Date.now()}-${process.pid}-${name}`);
	writeFileSync(p, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 1));
	return p;
}

/**
 * The drafts and proposals `lines` put to vault `vault` in one AIP, opened with its objective, measured and promoted:
 * its entry, or null where there is nothing to put. Its objective (avendb/spec/AvenDB/Objective.lean): every line it
 * puts lands, measured as it is opened, so the reviewer reads what it brings.
 * @param {string} vault @param {Line[]} lines @param {string} title @param {string} note
 */
async function aip(vault, lines, title, note) {
	if (!lines.length) return null;
	const objective = `/-- Every file and record this AIP puts lands in the vault. -/\ndef lines : Metric := metric "Lines it brings" (atLeast (reading "lines") ${lines.length})\n`;
	const opened = ok(await session().run({ op: 'aip_open', vault, title: title.slice(0, 200), note, proposals: lines, objective }), 'opening its AIP');
	ok(await session().run({ op: 'aip_measure', entry: opened.entry, name: 'lines', value: lines.length }), 'measuring its AIP');
	ok(await session().run({ op: 'aip_promote', entry: opened.entry }), 'promoting its AIP');
	return /** @type {string} */ (opened.entry);
}

/**
 * Add a file (a path on disk, or bytes). The same bytes again (the same BLAKE3, legacy or added here) are
 * "duplicate", and what `about` says still applies. `replaces`: the files it takes the place of, by hash — they stay,
 * tagged "superseded". Where avenMAIA may only suggest, the verdict is "draft" and `aip` the AIP that lands it.
 * @param {string | Uint8Array} from @param {About & { replaces?: string[] }} [about]
 * @returns {Promise<{ hash: string, entry: string, verdict: string, meta: Meta, aip?: string }>}
 */
export async function add(from, about = {}) {
	const { replaces = [], name: given, title, description, tags = [], meta: m } = about;
	const name = given ?? (typeof from === 'string' ? basename(from) : `file-${Date.now()}.bin`);
	const path = typeof from === 'string' ? from : temp(name, from);
	/** @type {Line[]} */
	const lines = [];
	let hash, had, entry;
	try {
		hash = await blake3Of(path);
		const vault = await vaultId();
		had = find(await world(true), hash);
		entry = had?.entry;
		if (!had) {
			const f = await newFile(vault, path, name, title ?? name, [...tags, `blake3:${hash}`]);
			entry = f.entry;
			if (f.line) lines.push({ entry: f.entry, line: f.line });
		}
	} finally {
		if (typeof from !== 'string') rmSync(path, { force: true });
	}
	catalog = worldP = null;
	const patch = { ...(had && title ? { title } : {}), ...(had && tags.length ? { tags } : {}), ...(description !== undefined ? { description } : {}), ...(m ? { meta: m } : {}) };
	if (Object.keys(patch).length) await describe(entry, patch, { lines, open: false });
	for (const old of replaces.map(bare).filter((h) => h !== hash)) {
		const o = await meta(old);
		if (o && !o.tags?.includes('superseded')) await describe(old, { tags: [...(o.tags ?? []), 'superseded'] }, { lines, open: false });
	}
	const opened = await aip(await vaultId(), lines, `Files: ${title ?? name}`, `agentScripts adds ${name}${replaces.length ? `, in place of ${replaces.length} file(s) tagged superseded` : ''}, with what is known about it.`);
	const verdict = had ? 'duplicate' : lines.some((l) => l.entry === entry) ? 'draft' : 'added';
	return { hash, entry, verdict, meta: /** @type {Meta} */ (await meta(entry)), ...(opened ? { aip: opened } : {}) };
}

/**
 * Describe a file: title and tags (replaced) on its entry, description and meta (merged key by key) in its about.
 * Where avenMAIA may only suggest, each is a proposal or a draft, put to the vault in an AIP of its own (unless the
 * caller gathers them in `lines` to open one itself). `public` is gone: avenDB shares a vault, not a file.
 * @param {string} hash @param {Omit<About, 'name'>} patch @param {{ lines?: Line[], open?: boolean }} [o]
 * @returns {Promise<Meta>}
 */
export async function describe(hash, patch, o = {}) {
	const lines = o.lines ?? [];
	const w = await world(true);
	const e = find(w, hash);
	if (!e) throw new Error(`avenDB: no file ${bare(hash).slice(0, 12)}… to describe`);
	const s = session();
	// a draft's own line, where this run drafted it
	const own = lines.find((l) => l.entry === e.entry)?.line;
	if (patch.title !== undefined || patch.tags) {
		// on main where it may: the title in the record, the tags on the entry (its BLAKE3 tag kept)
		let refused = !!own;
		if (!refused && patch.title !== undefined) refused = !!(await s.run({ op: 'set', entry: e.entry, path: ['title'], value: patch.title }))?.refused;
		if (!refused && patch.tags) {
			const wanted = [...new Set([...patch.tags, ...(e.tags ?? []).filter((/** @type {string} */ t) => MARK.test(t))])];
			const add = wanted.filter((t) => !e.tags?.includes(t));
			const remove = (e.tags ?? []).filter((/** @type {string} */ t) => !wanted.includes(t));
			if (add.length || remove.length) refused = !!(await s.run({ op: 'tag', entry: e.entry, add, remove }))?.refused;
		}
		// else on a proposal: the record's title and tags
		if (refused) {
			const line = own ?? ok(await s.run({ op: 'propose', entry: e.entry }), 'proposing its description').line;
			const ops = [
				...(patch.title !== undefined ? [{ op: 'set', entry: e.entry, line, path: ['title'], value: patch.title }] : []),
				...(patch.tags ? [{ op: 'set', entry: e.entry, line, path: ['tags'], value: patch.tags }] : [])
			];
			ok(await s.run({ op: 'batch', ops }), 'describing it on its proposal');
			if (!own) lines.push({ entry: e.entry, line });
		}
	}
	if (patch.description !== undefined || patch.meta) {
		// a new about, merged over the one before
		const before = await aboutOf(w, e.entry);
		const value = { description: patch.description ?? before?.value.description ?? '', meta: { ...(before?.value.meta ?? {}), ...(patch.meta ?? {}) } };
		const name = `${e.entry}.about.json`;
		const media = 'application/json';
		const path = temp(name, value);
		try {
			const onMain = before ? await s.run({ op: 'put_file', entry: before.entry, name, media }, { path }) : null;
			if (before && onMain?.refused) {
				// a new version of the about, on a proposal of it
				const line = ok(await s.run({ op: 'propose', entry: before.entry }), 'proposing its about').line;
				ok(await s.run({ op: 'put_file', entry: before.entry, line, name, media, value: { kind: 'file', title: name, media } }, { path }), 'its about');
				lines.push({ entry: before.entry, line });
			} else if (!before) {
				const f = await newFile(await vaultId(), path, name, name, [`about:${e.entry}`]);
				if (f.line) lines.push({ entry: f.entry, line: f.line });
			}
		} finally {
			rmSync(path, { force: true });
		}
	}
	catalog = worldP = null;
	if (o.open !== false) await aip(await vaultId(), lines, `Describe ${e.title || bare(hash).slice(0, 12)}`, 'agentScripts describes a file: its title, tags, description or meta.');
	return /** @type {Meta} */ (await meta(e.entry));
}

// ─────────────────────────────── a voice take's words ───────────────────────────────

/**
 * Each voice take's word timings, by hash — or null where none are known: its about's meta.words (written by
 * `bun voice say`), else the words its transcript task heard. Where avenDB does not answer, or a take has no words
 * there, the old library/ folder beside the repo is read, still named by CID: <cid>.json, by the migration's map
 * (vault/migration/cid-to-blake3.json) inverted. LIBRARY=<dir> reads only that folder (a fixture: <hash>.json).
 * So a shot list always loads; without any of them its timing is simply unknown.
 * @param {string[]} hashes
 * @returns {Promise<Map<string, { word: string, start: number, end: number }[] | null>>}
 */
export async function wordsOf(hashes) {
	const out = new Map(hashes.map((h) => [bare(h), /** @type {any} */ (null)]));
	const dir = process.env.LIBRARY;
	if (!dir) {
		const w = await world().catch(() => null);
		for (const h of w ? out.keys() : []) {
			const e = find(w, h);
			if (!e) continue;
			let words = (await aboutOf(w, e.entry))?.value.meta?.words;
			if (!Array.isArray(words)) {
				let t = made(w, 'transcript', e.entry);
				// a long one is in a JSON file of its own (vault/app/src/aven.rs `spill`)
				if (t?.file && !t.words) t = parse((await session().run({ op: 'get_file', entry: t.file }).catch(() => null))?.ok?.text ?? '');
				words = t?.words;
			}
			if (Array.isArray(words)) out.set(h, words);
		}
		if ([...out.values()].every(Boolean)) return out;
	}
	// the files by name: a fixture by hash, library/ by CID
	const lib = dir ?? new URL('../../library/', import.meta.url).pathname;
	const mapFile = new URL('../../vault/migration/cid-to-blake3.json', import.meta.url);
	/** @type {Record<string, string>} */
	const cidOf = {};
	if (existsSync(mapFile)) for (const [cid, v] of Object.entries(JSON.parse(readFileSync(mapFile, 'utf8')))) cidOf[/** @type {any} */ (v).hash] = cid;
	for (const h of out.keys()) {
		if (out.get(h)) continue;
		const f = [join(lib, `${h}.json`), ...(cidOf[h] ? [join(lib, `${cidOf[h]}.json`)] : [])].find((p) => existsSync(p));
		if (f) out.set(h, JSON.parse(readFileSync(f, 'utf8')).meta?.words ?? null);
	}
	return out;
}
