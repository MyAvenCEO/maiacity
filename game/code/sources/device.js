// @ts-nocheck — plain JS, kept loose on purpose
/** The renderer reads only this device's avenDB, including same-origin Studio frames.
 * Manifests and learned dependencies prioritize independent background sync; absent local data
 * stays pending. No empty, slow or locked local read authorizes an HTTP/peer fallback.
 */
import { MAIA_CITY } from './anchor.js';
import { bringDeclared } from './manifests.js';
import { createDemand } from './demand.js';

/** Background bring scheduling budget; never a renderer network fallback. */
export const BRING = 8000;
/** Local recipe read deadline; background sync may make a later retry succeed. */
export const READ = 6000;
/** Local metadata response deadline. */
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

/** The device the page holds open now, or `null` while local data is unavailable; each vault is brought again once. A device
 * opened brings first what the manifests of Maia City declare for this page (./manifests.js `bringDeclared`), then the
 * entries this page read before (`learned`), before anything else it syncs. */
let activeView = null;

export function useDevice(d) {
	activeView?.controller.abort();
	activeView?.demand.close();
	activeView = null;
	device = d ?? null;
	brought = new WeakMap();
	asked = new WeakMap();
	if (typeof window !== 'undefined') /** @type {any} */ (window)[SHARED] = device;
	if (device) void useView(pageNow());
}

/** Replace this page's demand on navigation. Already issued legacy bring operations may finish, but no stale
 * manifest walk, reference traversal or subsequent batch is issued after the view/device changes. */
export function useView(path) {
	const opened = deviceOf();
	if (activeView?.device === opened && activeView.path === path) return activeView.done;
	activeView?.controller.abort();
	activeView?.demand.close();
	activeView = null;
	if (!opened) return Promise.resolve([]);
	const controller = new AbortController();
	const signal = controller.signal;
	const before = learned(path);
	const demand = createDemand((op) => opened.run(op));
	const view = { device: opened, path, controller, demand, done: null };
	activeView = view;
	view.done = (async () => {
		// Learned IDs are scheduling hints, not trusted records. Do not wait for an
		// unrelated manifest query before telling the node what this view needs.
		if (before.length) void demand.add(before.slice(0, AT_ONCE));
		const declared = await bringDeclared(path, {
			device: opened, signal,
			prioritize: (ids) => {
				signal.throwIfAborted();
				return demand.add(ids);
			},
			bring: async (ids) => {
				const scoped = await demand.add(ids);
				return bringEntries(ids, opened, { signal, path, prioritize: !scoped });
			}
		});
		signal.throwIfAborted();
		const rest = before.filter((e) => !declared.includes(e));
		if (rest.length) {
			const ids = rest.slice(0, AT_ONCE);
			const scoped = await demand.add(ids);
			await bringEntries(ids, opened, { signal, path, prioritize: !scoped });
		}
		return declared;
	})().catch(() => []);
	return view.done;
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
export function learn(ids, path = pageNow(), { prioritize = true } = {}) {
	const fresh = (ids ?? []).filter((e) => /^[0-9a-f]{64}$/.test(String(e)));
	if (!path || !fresh.length) return;
	if (prioritize && activeView?.path === path) void activeView.demand.add(fresh);
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
 * @param {{ signal?: AbortSignal, path?: string, prioritize?: boolean, learnPriority?: boolean }} [options]
 */
export async function bringEntries(ids, d = deviceOf(), { signal, path = pageNow(), prioritize = true, learnPriority = true } = {}) {
	const sorted = [...new Set((ids ?? []).filter((e) => /^[0-9a-f]{64}$/.test(String(e))))];
	if (!d || !sorted.length) return null;
	if (signal?.aborted) return null;
	learn(sorted, path, { prioritize: learnPriority });
	try {
		const sum = { new: 0, peers: 0, reached: true };
		for (let i = 0; i < sorted.length; i += AT_ONCE) {
			if (signal?.aborted) return null;
			const got = await d.run({ op: 'bring', entries: sorted.slice(i, i + AT_ONCE), ...(!prioritize ? { prioritize: false } : {}) });
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
	// An empty local catalog is returned immediately. Sync never blocks a frontend read.
	return null;
}

/**
 * File `file` of a row the device read (`{ root, size, len }`), whole, as bytes, read off the device a window at a
 * time, exclusively from its local store. Peer synchronization runs separately. Null where no device is open,
 * it cannot read the bytes locally, or the local read exceeds `wait`.
 * @param {{ root: string, size: number, len: number }} file @param {{ wait?: number }} [o]
 * @returns {Promise<Uint8Array | null>}
 */
export async function deviceFile(file, { wait = READ } = {}) {
	const d = deviceOf();
	if (!d || typeof file?.len !== 'number') return null;
	const read = async () => {
		const out = new Uint8Array(file.len);
		for (let at = 0; at < file.len; ) {
			const result = await d.run({ op: 'read_file', root: file.root, size: file.size, from: at, to: Math.min(file.len, at + WINDOW), local: true });
			const got = result?.bytes;
			if (!got?.length) throw new Error('the file ends early');
			out.set(got, at);
			at += got.length;
		}
		return out;
	};
	return within(read(), wait);
}
