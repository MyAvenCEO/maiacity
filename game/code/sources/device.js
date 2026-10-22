// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THIS DEVICE'S avenDB AS THE SOURCE OF CODE (Samuel 2026-10-20: "all games and sandboxes should load always from local
 * avenDB! Also the asset viewers"). Once a page holds the person's avenDB open, the code it runs is read off the
 * device's own copy of the coop Maia City: the views, logic modules and configs (./avendb.js `loadCode`) and the asset
 * recipes ($lib/assets/vault.js). The feed of avenDB's server (./feed.js) is read only where no device is open (signed
 * out, the API), or where the device can't answer yet.
 *
 * The device checked every signed edit, every signature and rule, as it took it from its peers, so what it reads back
 * needs no proof (H2 is the feed's, ./feed.js `provenRows`). Its rows are the feed's to the letter (avendb's `code` op,
 * `world::public_entries`: the public entries of Maia City that its vault landed), so every reader takes them as it takes
 * the feed's, and runs only what everyone may read, as before.
 *
 * Local first (Samuel 2026-10-20: "everything should be offline / local first loading … ensure our whole app respects
 * this local first pattern"): what the device holds of Maia City is read at once, whether its peers can be reached or
 * not, and the device asks them for what they hold meanwhile (avendb's `bring` op, before anything else it syncs), so
 * the next page reads that; theOS's device keeps syncing anyway. A device that holds none of the vault yet (a first
 * sync) is read from the feed this time, and brings the entries the feed named, those alone (`bringRows`, Samuel
 * 2026-10-21: a device syncs first what its pages need), so the next page reads them off the device. A device whose
 * avenDB is older than the ops is read from the feed too. (Until 2026-10-20 every page waited for the
 * bring first, and a server that hung sent it to the feed, which hung as well: the village's live world never stood
 * while avenDB's server restarted.)
 *
 * A page of ours framed by another (the studio's world, /games/<world>/?film) opens no avenDB of its own: it reads its
 * parent's device (`deviceOf`), the same person's, on the same origin. A frame of another origin, or none, reads none.
 */
import { MAIA_CITY } from './anchor.js';
import { bringDeclared } from './manifests.js';

/**
 * How long a page waits for its device to bring Maia City from its peers before it reads the feed instead (ms): a
 * device that synced before brings what changed since in a moment; a new device takes longer the first time.
 */
export const BRING = 8000;

/**
 * How long a page waits for its device to read a recipe's file before it asks the feed for it too (ms): the device
 * reads on beside the feed, and the first to hand it over is read ($lib/assets/vault.js `eitherOf`), so a light copy
 * still bringing the file's pieces from its peers is never given up on.
 */
export const READ = 6000;

/**
 * How long a page waits for its device to read back what it holds of a vault (ms): a local read answers in a moment,
 * and one that doesn't (a device stuck) sends the page to the feed rather than leave it waiting.
 */
export const ANSWER = 5000;

/** How many bytes a page asks its device for at a time, as the Library reads a file ($lib/avendb/files.js). */
const WINDOW = 4 << 20;

/**
 * The device the page holds open, set by its avenDB session ($lib/avendb/session.svelte.js): `run(op)`, which answers
 * `{ ok }` or `{ refused, why }`, and `read(root, size, from, to)`, a file's bytes. Null while none is open.
 * @type {{ run: (op: object) => Promise<any>, read: (root: string, size: number, from: number, to: number) => Promise<Uint8Array> } | null}
 */
let device = null;

/** each device's bring of each vault, asked for once: the answer @type {WeakMap<object, Map<string, Promise<any>>>} */
let brought = new WeakMap();

/** where a page leaves its device for the pages it frames (`deviceOf`) */
const SHARED = Symbol.for('maiacity.avendb.device');

/** The device the page holds open now, or `null` to read the feed again; each vault is brought again once. A device
 * opened brings first what the manifests of Maia City declare for this page (./manifests.js `bringDeclared`), then the
 * entries this page read before (`learned`), before anything else it syncs. */
export function useDevice(d) {
	device = d ?? null;
	brought = new WeakMap();
	asked = new WeakMap();
	if (typeof window !== 'undefined') /** @type {any} */ (window)[SHARED] = device;
	if (!device) return;
	const opened = device;
	const before = learned();
	void (async () => {
		const declared = await bringDeclared(pageNow(), { device: opened, bring: (ids) => bringEntries(ids, opened) }).catch(() => []);
		const rest = before.filter((e) => !declared.includes(e));
		if (rest.length) await bringEntries(rest.slice(0, AT_ONCE), opened);
	})();
}

/** where this browser keeps, per page, the entries it read (`learn`) */
const LEARNED = 'maiacity.avendb.read';
/** the most entries kept per page, and the most pages */
const MOST_LEARNED = 512;
const MOST_PAGES = 64;

/** the page an entry is read for: its path, as one address of a game or a world */
const pageNow = () => (typeof location !== 'undefined' ? location.pathname : '');

/** what this browser kept, `{ [path]: entries }`, newest page last; empty where it keeps nothing @returns {Record<string, string[]>} */
function kept() {
	try {
		const v = JSON.parse(globalThis.localStorage?.getItem(LEARNED) ?? '{}');
		return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
	} catch {
		return {};
	}
}

/**
 * The entries page `path` read before on this browser (`learn`), newest first: its learned manifest (Samuel 2026-10-21:
 * a device syncs first what its pages need, as a bundler follows what a page imports). What a page reads is what it
 * names, so a page whose manifest misses an entry still brings it first the next time.
 * @param {string} [path]
 * @returns {string[]}
 */
export function learned(path = pageNow()) {
	const at = kept()[path];
	return Array.isArray(at) ? at.filter((e) => /^[0-9a-f]{64}$/.test(String(e))) : [];
}

/**
 * Keeps that page `path` read entries `ids` (the newest first, `MOST_LEARNED` at most, `MOST_PAGES` pages, the page
 * last read last), so the next time a device opens on it, it brings them before anything else (`useDevice`). A browser
 * that keeps nothing (private, storage blocked) keeps nothing: the page still reads them, as before.
 * @param {string[]} ids @param {string} [path]
 */
export function learn(ids, path = pageNow()) {
	const fresh = (ids ?? []).filter((e) => /^[0-9a-f]{64}$/.test(String(e)));
	if (!path || !fresh.length) return;
	try {
		const all = kept();
		const was = Array.isArray(all[path]) ? all[path] : [];
		delete all[path];
		all[path] = [...new Set([...fresh, ...was])].slice(0, MOST_LEARNED);
		const paths = Object.keys(all);
		for (const p of paths.slice(0, Math.max(0, paths.length - MOST_PAGES))) delete all[p];
		globalThis.localStorage?.setItem(LEARNED, JSON.stringify(all));
	} catch {
		// nothing kept
	}
}

/** The device the page holds open, else the one its parent page holds (a frame of ours, same origin), if any. */
export function deviceOf() {
	if (device || typeof window === 'undefined') return device;
	try {
		return window.parent !== window ? (/** @type {any} */ (window.parent)[SHARED] ?? null) : null;
	} catch {
		// a parent of another origin: none
		return null;
	}
}

/** what device `d` brought or brings of each vault @param {any} d @returns {Map<string, Promise<any>>} */
function broughtBy(d) {
	let of = brought.get(d);
	if (!of) brought.set(d, (of = new Map()));
	return of;
}

/** what a bring that asked nothing answers */
const NONE = { ok: { new: 0, peers: 0, reached: false } };

/**
 * Device `d`'s bring of vault `vault`, asked for once: what changed of it since, for a device that holds what its peers
 * hold (`caughtUp`) or can't say. A device still catching up asks nothing more: a bring of a whole vault pulls every log
 * of it at once, page after page by place across all of them, so none comes whole until its last page, beside the
 * device's own sync, which brings them a batch at a time, a page's entries first (Samuel's iPhone 2026-10-22, three
 * pulls at 11% of Maia City's 2,416 logs). @param {any} d @param {string} vault
 */
function bringOf(d, vault) {
	const of = broughtBy(d);
	if (!of.has(vault)) of.set(vault, caughtUp(d).then((up) => (up === false ? NONE : d.run({ op: 'bring', vaults: [vault] }))));
	return of.get(vault);
}

/**
 * Whether device `d` holds all that its live peers hold (avendb's `synced` op): true once one of them told it what it
 * holds and it lacks none of it; false while it lacks some, has no peer to tell it yet, or doesn't answer within
 * `answer` (a device busy taking pages); null for a device whose avenDB knows no `synced`, read as before it did.
 * @param {any} [d] @param {number} [answer]
 * @returns {Promise<boolean | null>}
 */
export async function caughtUp(d = deviceOf(), answer = ANSWER) {
	if (!d) return null;
	const got = await within(Promise.resolve().then(() => d.run({ op: 'synced' })), answer);
	if (got === null) return false;
	const ok = got?.ok;
	if (!ok || typeof ok !== 'object' || Array.isArray(ok) || typeof ok.behind !== 'number') return null;
	return ok.peers > 0 && ok.behind === 0;
}

/**
 * The entries rows `theirs` (the feed's) hold that rows `mine` (a device's) don't hold as they do: none of the entry,
 * or the entry at other heads. What a device still syncing lacks of what a page reads.
 * @param {any[]} mine @param {any[]} theirs @returns {string[]}
 */
export function lacking(mine, theirs) {
	const headsOf = (r) => (Array.isArray(r?.heads) ? r.heads : String(r?.heads ?? '').split(',')).filter(Boolean).sort().join(',');
	const held = new Map((mine ?? []).map((r) => [r?.entry, headsOf(r)]));
	const short = (theirs ?? []).filter((r) => typeof r?.entry === 'string' && held.get(r.entry) !== headsOf(r)).map((r) => r.entry);
	return [...new Set(short)];
}

/** How many entries one `bring` names at most (avendb-net's `MOST_BROUGHT`). */
export const AT_ONCE = 64;

/**
 * Has the device the page reads (`deviceOf`) bring from its peers the entries of rows `rows` (the feed's, read because
 * the device held none of vault `vault`'s code yet), and nothing else of the vault: `{ op: 'bring', entries }`,
 * `AT_ONCE` at a time, one after another. A new device asked for a whole vault takes all of it before any entry is whole
 * (Maia City's ~2,200 logs come a page at a time across all of them), so the entries a page reads come first, and the
 * next page reads them off the device; the rest of the vault comes in the background. Each entry once a device, the first
 * as the vault's bring (`whenBrought` answers it): `{ ok: { new, peers, reached } }`, or null with no device.
 * @param {any[]} rows @param {string} [vault]
 */
export function bringRows(rows, vault = MAIA_CITY) {
	const d = deviceOf();
	if (!d) return Promise.resolve(null);
	const of = broughtBy(d);
	const ids = (rows ?? []).map((r) => r?.entry).filter((e) => !askedOf(d).has(e));
	if (!ids.length) return of.get(vault) ?? Promise.resolve(null);
	for (const e of ids) askedOf(d).add(e);
	const all = bringEntries(ids, d);
	if (!of.has(vault)) of.set(vault, all);
	return all;
}

/** the entries each device was asked to bring by the rows a page read off the feed (`bringRows`) @type {WeakMap<object, Set<string>>} */
let asked = new WeakMap();
/** @param {any} d */
function askedOf(d) {
	let of = asked.get(d);
	if (!of) asked.set(d, (of = new Set()));
	return of;
}

/**
 * Has device `d` (the page's, `deviceOf`) bring the entries `ids` alone from its peers, `AT_ONCE` at a time, one bring
 * after another: `{ ok: { new, peers, reached } }`, or null where there is no device, nothing to bring, or a bring
 * refused (a device whose avenDB knows no `entries` yet). What a view brings for the items it shows (the Maia
 * Universe's newest posts, a world's recipes), and nothing else.
 * @param {string[]} ids @param {any} [d]
 */
export async function bringEntries(ids, d = deviceOf()) {
	const sorted = [...new Set((ids ?? []).filter((e) => /^[0-9a-f]{64}$/.test(String(e))))].sort();
	if (!d || !sorted.length) return null;
	learn(sorted);
	try {
		const sum = { new: 0, peers: 0, reached: true };
		for (let i = 0; i < sorted.length; i += AT_ONCE) {
			const got = await d.run({ op: 'bring', entries: sorted.slice(i, i + AT_ONCE) });
			if (!got?.ok) return null;
			sum.new += got.ok.new ?? 0;
			sum.peers = Math.max(sum.peers, got.ok.peers ?? 0);
			sum.reached &&= !!got.ok.reached;
		}
		return { ok: sum };
	} catch {
		return null;
	}
}

/**
 * What the device the page reads (`deviceOf`) brought of vault `vault` from its peers, once it has: `{ ok: { new, peers,
 * reached } }` (how many edits were new), or null with no device. A page that read the device's rows at once reads them
 * again where it brought something new.
 * @param {string} [vault]
 */
export async function whenBrought(vault = MAIA_CITY) {
	const d = deviceOf();
	return d ? bringOf(d, vault).catch(() => null) : null;
}

/** `p`, or null once `ms` passed. @param {Promise<any>} p @param {number} ms */
function within(p, ms) {
	let t;
	const late = new Promise((done) => (t = setTimeout(() => done(null), ms)));
	return Promise.race([p.catch(() => null), late]).finally(() => clearTimeout(t));
}

/**
 * The rows of vault `vault`'s public code of kinds `kinds`, as the device the page holds (or its parent page) reads
 * them, in the feed's shape (`/feed/code`): at once where it holds the vault's code, its bring going on beside; where
 * it holds none yet, once it brought the vault from its peers (`BRING`). `null` where the feed is read instead: no
 * device is open, it holds none of the vault's code and is still bringing it, or it doesn't know the ops.
 * `wait` is how long it waits for the bring, `answer` how long for the device to read its rows back (`ANSWER`).
 * @param {string[]} kinds @param {{ vault?: string, wait?: number, answer?: number }} [o]
 * @returns {Promise<any[] | null>}
 */
export async function deviceRows(kinds, { vault = MAIA_CITY, wait = BRING, answer = ANSWER } = {}) {
	const d = deviceOf();
	if (!d || !/^[0-9a-f]{64}$/.test(String(vault))) return null;
	const code = async () => {
		const got = await within(d.run({ op: 'code', vault, type: kinds }), answer);
		return d === deviceOf() && Array.isArray(got?.ok) && got.ok.length ? got.ok : null;
	};
	const held = await code();
	if (held) {
		learn(held.map((r) => r?.entry));
		// what changed of the vault since, brought beside
		void bringOf(d, vault).catch(() => null);
		return held;
	}
	// none held yet: a bring of the entries a page read before (`bringRows`) first, then what it brought; else the
	// feed this time, and the page has the device bring the entries the feed named (`bringRows`), never the whole vault
	const before = broughtBy(d).get(vault);
	if (!before || !(await within(before, wait))?.ok) return null;
	return code();
}

/**
 * File `file` of a row the device read (`{ root, size, len }`), whole, as bytes, read off the device a window at a
 * time: from its own store, or else fetched from a peer that may hand it over and kept. Null where no device is open,
 * it can't read it, or it takes longer than `wait` (the reader has asked the feed meanwhile, after `READ`).
 * @param {{ root: string, size: number, len: number }} file @param {{ wait?: number }} [o]
 * @returns {Promise<Uint8Array | null>}
 */
export async function deviceFile(file, { wait = READ } = {}) {
	const d = deviceOf();
	if (!d || typeof file?.len !== 'number') return null;
	const read = async () => {
		const out = new Uint8Array(file.len);
		for (let at = 0; at < file.len; ) {
			const got = await d.read(file.root, file.size, at, Math.min(file.len, at + WINDOW));
			if (!got?.length) throw new Error('the file ends early');
			out.set(got, at);
			at += got.length;
		}
		return out;
	};
	return within(read(), wait);
}
