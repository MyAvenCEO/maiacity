// @ts-nocheck — plain JS, kept loose on purpose
/** The renderer reads only this device's avenDB, including same-origin Studio frames. What the page wants comes in
 * by Interests (./interest.js), in tiers, the actors of its route saying which; absent local data stays pending,
 * and no empty, slow or locked local read authorizes an HTTP/peer fallback.
 */
import { MAIA_CITY } from './anchor.js';
import { ACTOR_TYPE, actorsOf, leavesFor, plan } from './actors.js';
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

/** The page's view: its path, its bindings and signals, and the one Interest its actors set. */
let activeView = null;
/** what the route binds (`useView`'s options), kept across a device change of the same page */
let viewContext = {};
/** what the selection binds (`bindView`) and the signals that order the tiers (`signalView`), the page's own */
const selected = {};
const signals = {};
/** The actors the app ships ($lib/avendb/actors.js), read where Maia City's vault holds no actor of that id with
 *  parts yet: a cold device, or a vault the actors' AIP has not reached, still asks for what its route shows first,
 *  never only the catch-up of every log. A v1 manifest of the vault gives way to the app's of its id (v1 chat asked for
 *  Maia City's rooms alone), and so does one a lens shows with empty tiers; the vault's own v2 manifest or v3 actor of
 *  an id always wins. */
let builtIn = [];

/** Sets the app's own actors (`ACTORS`), read under the vault's. @param {any[]} list */
export function useBuiltInActors(list) {
	builtIn = Array.isArray(list) ? list : [];
	refreshActiveView();
}

/** A manifest or actor read through a lens shows empty tiers until its AIP moves it: that holds nothing yet. */
const holdsParts = (m) => Object.values(m?.loads ?? m?.tiers ?? {}).some((t) => Array.isArray(t) && t.length);

/** The ids of the vault's own v2 manifests and v3 actors among `held` that hold parts: those the app's own of an id
 *  give way to. */
const vaultIds = (held) => new Set((held ?? []).filter((m) => (m?.v === 2 || m?.v === 3) && holdsParts(m)).map((m) => m.id));

/** The actors of catalog `catalog`: the vault's, and for Maia City the app's own of each id it holds none of. */
export const withBuiltIn = (held, catalog) => {
	if (catalog !== MAIA_CITY || !builtIn.length) return held;
	const v2 = vaultIds(held);
	const ours = builtIn.filter((m) => !v2.has(m.id));
	const replaced = new Set(ours.map((m) => m.id));
	return [...held.filter((m) => !replaced.has(m?.id)), ...ours];
};

/**
 * Where each actor `withBuiltIn(held, catalog)` reads came from, by id: `vault` for the vault's own v2 or v3 (what an
 * AIP accepted), `built-in` for the app's copy standing in for an id the device holds none of yet, `vault v1` for a
 * vault's v1 manifest none of the app's replaced (another catalog's, or one the app ships none of).
 * @param {any[]} held @param {string} catalog @returns {Map<string, 'vault' | 'built-in' | 'vault v1'>}
 */
export function actorSources(held, catalog) {
	const v2 = vaultIds(held);
	const out = new Map();
	for (const m of withBuiltIn(held, catalog)) {
		if (typeof m?.id !== 'string' || out.has(m.id)) continue;
		out.set(m.id, v2.has(m.id) ? 'vault' : (held ?? []).includes(m) ? 'vault v1' : 'built-in');
	}
	return out;
}

/** The actors each catalog's last walk read off the device: what the next walk asks by before its own read
 *  answers, so a device whose reads wait behind a catch-up still asks for its route's data at once. */
const lastHeld = new Map();

export function useDevice(d) {
	if (device !== (d ?? null)) {
		viewContext = {};
		lastHeld.clear();
	}
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
 * ./view-context.js `routeDemandContext`): one Interest for its mounted lifetime, set from the actors of Maia City
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
	// A cold device finds its route's actors first, and what the route names is on screen at once.
	const base = () => [{ tier: 'now', entries: [...explicit, ...view.asked], queries: catalogs.map((v) => ({ types: [ACTOR_TYPE], vault: v })) }];
	view.publish = () => view.interest.set([...base(), ...view.wants.flat()]);
	if (!interest) void view.publish();
	view.run = () => {
		view.walking = true;
		view.dirty = false;
		const started = performance.now();
		const run = {
			started,
			ms: 0, requested: 0, catalog: 'local', heldManifests: 0, matchedLeaves: 0, queryLeaves: 0, typeDiscoveryHints: 0, localRows: 0,
			state: 'failed', now: 0, next: 0, later: 0, idle: 0, firstMs: 0, readMs: 0, matched: [], vaultManifests: 0, builtInManifests: 0
		};
		walks.pending++;
		walks.active.add(run);
		/** what the route's actors ask for, as `held` holds them, published at once: selectors and bound entries */
		const ask = async (held) => {
			const wants = await Promise.all(catalogs.map((catalog) => plan(leavesFor(withBuiltIn(held(catalog), catalog), path, env), { vault: catalog, signals, signal })));
			signal.throwIfAborted();
			// added to what the view asks already, never in place of it: the walk's own wants replace both
			view.wants = [[...view.wants.flat(), ...wants.flat()]];
			void view.publish();
		};
		view.done = (async () => {
			// First, with no read of the device: its route's selectors from the actors the last walk read (the app's
			// own on a cold device), so the node finds the route's data from peers while the device's reads still wait
			// behind its catch-up (an iPhone's took tens of seconds, and the rooms were asked for only after them).
			await ask((catalog) => lastHeld.get(catalog) ?? []);
			run.firstMs = performance.now() - started;
			const parts = await Promise.all(catalogs.map(async (catalog) => {
				const read = await actorsOf(opened, { vault: catalog, signal });
				lastHeld.set(catalog, read);
				const held = withBuiltIn(read, catalog);
				const leaves = leavesFor(held, path, env);
				const from = actorSources(read, catalog);
				const matched = [...new Set(leaves.map((l) => l.actor))];
				run.heldManifests += held.length;
				run.matchedLeaves += leaves.length;
				run.queryLeaves += leaves.filter((l) => !l.want.entry).length;
				run.typeDiscoveryHints += leaves.filter((l) => l.want.type?.length).length;
				run.matched.push(...matched);
				run.vaultManifests += matched.filter((id) => from.get(id) !== 'built-in').length;
				run.builtInManifests += matched.filter((id) => from.get(id) === 'built-in').length;
				return { catalog, leaves };
			}));
			run.readMs = performance.now() - started;
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
			walks.active.delete(run);
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

/** The last walks of the page's actors, for the diagnostics: no route, vault id or entry kept; the actors each
 *  matched by their ids (`kernel`, `chat`), and how many of those were the vault's and how many the app's own. The
 *  report keeps its field names (`heldManifests`, `vaultManifests`, …) one release, so reports compare across it. A walk
 *  still running shows as `running`, how long it has run, so a report sent while a slow walk waits says so, and its
 *  `runs` are never taken for that walk's. */
const walks = { pending: 0, runs: /** @type {any[]} */ ([]), active: new Set() };
const shown = ({ started, ...r }) => ({ ...r, matched: [...r.matched] });
export const actorDiagnostics = () => ({
	pending: walks.pending,
	running: [...walks.active].map((r) => ({ ...shown(r), state: 'running', ms: performance.now() - r.started })),
	runs: walks.runs.map(shown)
});

/**
 * The device took new edits: the page's view walks its actors again, once however many came while it walked,
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

/**
 * The view a URL shows, as the actors' routes name it: its path, with the page the app opens by its hash
 * (`/app/#chat`, `#assets/…`'s first part), so each such page holds its own actor rather than the app's start
 * page's; the same name the Performance page's reports give a view. Never its query.
 * @param {{ pathname: string, hash: string }} url @returns {string}
 */
export function viewPath(url) {
	const path = String(url?.pathname ?? ''), page = String(url?.hash ?? '').replace(/^#/, '').split('/')[0];
	return /^[a-z-]{1,32}$/.test(page) ? `${path}#${page}` : path;
}

/** the page an entry is read for: its view, as one address of a game, a world or an app page */
const pageNow = () => (typeof location !== 'undefined' ? viewPath(location) : '');

// a page the app opens by its hash is a view of its own, whoever changed the hash
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => { if (device) void useView(pageNow()); });

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
