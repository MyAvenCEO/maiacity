// @ts-nocheck — plain JS, kept loose on purpose
/** The renderer reads only this device's avenDB, including same-origin Studio frames. What the page wants comes in
 * by Interests (./interest.js), in tiers, the manifests of its route saying which; absent local data stays pending,
 * and no empty, slow or locked local read authorizes an HTTP/peer fallback.
 */
import { MAIA_CITY } from './anchor.js';
import { leavesFor, manifestsOf, plan } from './manifests.js';
import { createInterest } from './interest.js';
import { createLocalFileReads } from './local-file-read.js';

/** Local file read deadline; background sync may make a later retry succeed. */
export const READ = 6000;

/** How many bytes a page asks its device for at a time, as the Library reads a file ($lib/avendb/files.js). */
const WINDOW = 4 << 20;

const HEX = /^[0-9a-f]{64}$/;

/**
 * The device the page holds open, set by its avenDB session ($lib/avendb/session.svelte.js): `run(op)`, which answers
 * `{ ok }` or `{ refused, why }`, and `read(root, size, from, to)`, a file's bytes. Null while none is open.
 * @type {{ run: (op: object) => Promise<any>, read: (root: string, size: number, from: number, to: number) => Promise<Uint8Array> } | null}
 */
let device = null;

/** where a page leaves its device for the pages it frames (`deviceOf`) */
const SHARED = Symbol.for('maiacity.avendb.device');

/** The page's view: its path, its bindings and signals, and the one Interest its manifests set. */
let activeView = null;
/** what the route binds (`useView`'s options), kept across a device change of the same page */
let viewContext = {};
/** what the selection binds (`bindView`) and the signals that order the tiers (`signalView`), the page's own */
const selected = {};
const signals = {};

export function useDevice(d) {
	if (device !== (d ?? null)) viewContext = {};
	closeView();
	device = d ?? null;
	if (typeof window !== 'undefined') /** @type {any} */ (window)[SHARED] = device;
	if (device) void useView(pageNow());
}

function closeView() {
	activeView?.controller.abort();
	activeView?.interest.close();
	activeView = null;
}

/**
 * The page's view at path `path`, the route binding `options` (`{ vault, context, entries, bind }`, from
 * ./view-context.js `routeDemandContext`): one Interest for its mounted lifetime, set from the manifests of Maia City
 * and of the selected vault that cover the path, slots bound by the route and the selection. A new path, vault or
 * binding replaces it; nothing waits on a timer.
 * @param {string} path @param {{vault?: string, context?: string, entries?: string[], bind?: Record<string, string>}} [options]
 */
export function useView(path, options) {
	if (options !== undefined) viewContext = options;
	const vault = HEX.test(viewContext.vault ?? '') ? viewContext.vault : null;
	const explicit = [...new Set((viewContext.entries ?? []).filter((id) => typeof id === 'string' && HEX.test(id)))].slice(0, 512);
	const env = { ...(viewContext.bind ?? {}), ...selected, ...(vault ? { vault } : {}) };
	const key = JSON.stringify([path, vault, typeof viewContext.context === 'string' ? viewContext.context : '', explicit, env]);
	const opened = deviceOf();
	if (activeView?.device === opened && activeView.key === key) return activeView.done;
	// the same page and device keep their Interest: a new binding is a new revision of it, not a new scope
	const kept = activeView?.device === opened && activeView?.path === path ? activeView : null;
	const interest = kept?.interest ?? null;
	activeView?.controller.abort();
	if (!interest) activeView?.interest.close();
	activeView = null;
	if (!opened) return Promise.resolve([]);
	const controller = new AbortController();
	const view = {
		device: opened, path, key, controller, interest: interest ?? createInterest((op) => opened.run(op)),
		done: null, walking: false, dirty: false, run: null, asked: kept?.asked ?? new Set(), wants: kept?.wants ?? []
	};
	activeView = view;
	const signal = controller.signal;
	const catalogs = [...new Set([MAIA_CITY, ...(vault ? [vault] : [])])];
	// A cold device finds its route manifests first, and what the route names is on screen at once.
	const base = () => [{ tier: 'now', entries: [...explicit, ...view.asked], queries: catalogs.map((v) => ({ types: ['manifest'], vault: v })) }];
	view.publish = () => view.interest.set([...base(), ...view.wants.flat()]);
	if (!interest) void view.publish();
	view.run = () => {
		view.walking = true;
		view.dirty = false;
		const started = performance.now();
		const run = { ms: 0, requested: 0, catalog: 'local', heldManifests: 0, matchedLeaves: 0, queryLeaves: 0, typeDiscoveryHints: 0, localRows: 0, state: 'failed', now: 0, next: 0, later: 0, idle: 0 };
		walks.pending++;
		view.done = (async () => {
			const parts = await Promise.all(catalogs.map(async (catalog) => {
				const held = await manifestsOf(opened, { vault: catalog, signal });
				const leaves = leavesFor(held, path, env);
				run.heldManifests += held.length;
				run.matchedLeaves += leaves.length;
				run.queryLeaves += leaves.filter((l) => !l.want.entry).length;
				run.typeDiscoveryHints += leaves.filter((l) => l.want.type?.length).length;
				return { catalog, leaves };
			}));
			signal.throwIfAborted();
			const wants = parts.map(() => []);
			const publish = () => {
				signal.throwIfAborted();
				view.wants = wants;
				void view.publish();
			};
			await Promise.all(parts.map(({ catalog, leaves }, i) => plan(leaves, {
				device: opened, vault: catalog, signals, signal,
				publish: (w) => { wants[i] = w; publish(); }
			})));
			publish();
			const now = view.interest.wants;
			for (const w of now) run[w.tier] = w.entries.length;
			run.requested = run.localRows = now.reduce((n, w) => n + w.entries.length, 0);
			run.state = 'scheduled';
			return now.flatMap((w) => w.entries);
		})().catch(() => {
			if (signal.aborted) run.state = 'cancelled';
			return [];
		}).finally(() => {
			walks.pending--;
			run.ms = performance.now() - started;
			walks.runs.push(run);
			if (walks.runs.length > 20) walks.runs.shift();
			view.walking = false;
			// a revision that came during the walk: one more walk, at once
			if (view.dirty && activeView === view && !signal.aborted) void view.run();
		});
		return view.done;
	};
	return view.run();
}

/** The last walks of the page's manifests, for the diagnostics: no route, vault id or entry kept. */
const walks = { pending: 0, runs: /** @type {any[]} */ ([]) };
export const manifestDiagnostics = () => ({ pending: walks.pending, runs: walks.runs.map((r) => ({ ...r })) });

/**
 * The device took new edits: the page's view walks its manifests again, once however many came while it walked,
 * so records that came in name what they follow. Never polling: only a real revision calls it.
 */
export function refreshActiveView() {
	const view = activeView;
	if (!view || view.controller.signal.aborted) return;
	view.dirty = true;
	if (!view.walking) void view.run();
}

/**
 * Entries `ids` a read of this page found missing (`NoEntry`): on screen now, for as long as the page stays, so the
 * device brings them first. Kept nowhere else: a new page asks for its own.
 * @param {string[]} ids
 */
export function wantNow(ids) {
	const view = activeView;
	if (!view || view.controller.signal.aborted) return;
	const before = view.asked.size;
	for (const e of ids ?? []) if (typeof e === 'string' && HEX.test(e) && view.asked.size < 512) view.asked.add(e);
	if (view.asked.size !== before) void view.publish();
}

/**
 * Binds slot `name` (`room`, `timeline`, `asset`, `original`) to entry `entry`, as the person selects it, or unbinds
 * it with `null`: the page's Interest moves at once, what the slot wants up to its tier.
 * @param {string} name @param {string | null} entry
 */
export function bindView(name, entry) {
	if (!/^[a-z][a-z0-9-]*$/.test(name)) return;
	if (typeof entry === 'string' && HEX.test(entry)) selected[name] = entry;
	else delete selected[name];
	if (activeView) void useView(activeView.path);
}

/**
 * Sets signal `name` (`viewport`, `playhead`, `camera`, `list`): how far each entry is from what the person sees,
 * which orders a tier's parts that name it (`by`). `null` clears it. A page sets it as the order changes (a new shot
 * at the playhead, the camera in a new cell), not every frame.
 * @param {string} name @param {((entry: string) => number) | null} distance
 */
export function signalView(name, distance) {
	if (typeof distance === 'function') signals[name] = distance;
	else delete signals[name];
	refreshActiveView();
}

/** the page an entry is read for: its path, as one address of a game or a world */
const pageNow = () => (typeof location !== 'undefined' ? location.pathname : '');

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

/**
 * The rows of vault `vault`'s public code of kinds `kinds`, as the device the page holds (or its parent page) reads
 * them now, in the feed's shape (`/feed/code`); `null` where no device is open or it holds none of them yet. What it
 * lacks comes by the page's Interests; a view that watches them reads again when they land.
 * @param {string[]} kinds @param {{ vault?: string }} [o]
 * @returns {Promise<any[] | null>}
 */
export async function deviceRows(kinds, { vault = MAIA_CITY } = {}) {
	const d = deviceOf();
	if (!d || !HEX.test(String(vault))) return null;
	try {
		const got = await d.run({ op: 'code', vault, type: kinds });
		return d === deviceOf() && Array.isArray(got?.ok) && got.ok.length ? got.ok : null;
	} catch {
		return null;
	}
}

const readLocalFile = createLocalFileReads({ window: WINDOW });

/**
 * File `file` of a row the device read (`{ root, size, len }`), whole, as bytes, read off the device a window at a
 * time, exclusively from its local store. Peer synchronization runs separately. Null where no device is open,
 * it cannot read the bytes locally, or the local read exceeds `wait`.
 * @param {{ root: string, size: number, len: number }} file @param {{ wait?: number }} [o]
 * @returns {Promise<Uint8Array | null>}
 */
export async function deviceFile(file, { wait = READ } = {}) {
	return readLocalFile(deviceOf(), file, wait);
}
