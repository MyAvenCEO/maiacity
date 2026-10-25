// @ts-nocheck
// Runtime recipes and files come exclusively from this device’s avenDB.
// Peer synchronization belongs to avenDB, never to the renderer’s HTTP loader.
import { observeRecipeCatalog } from './recipe-catalog.js';
import { holds } from '../../../game/hash.js';
import { idOf, slug } from '$lib/ids.js';
import { MAIA_CITY, NO_ANCHOR } from '../../../game/code/sources/feed.js';
import { READ, deviceFile, deviceOf, deviceRows, whenBrought } from '../../../game/code/sources/device.js';
import { KEPT_NEWEST, fresh } from '../../../game/code/fresh.js';
import { configAt } from '../../../game/code/index.js';
import { buildOf } from './builds.js';
import * as cache from './cache.js';
import { LATEST } from './engines.js';
import { queryOf } from './params.js';
import { parseRef } from './refs.js';
import { NotInVault, Unread, parsePin, pinRef, vaultRecipes } from './sources/avendb.js';

export { buildOf, checked, hashText, parseBuild } from './builds.js';
export { NotInVault, Unread, parsePin, pinRef };

/**
 * The app's pages that build assets: the app's layout holds one until the recipes are in (./VaultRecipes.svelte), so a
 * world's first `use` finds them. ./vault.test.js finds every page that reaches this module among these (an asset's own
 * page and a film's world wait for them themselves).
 */
export const ASSET_PAGES = /^\/app\/(?:buildings|biomes|factories|maiacity-v[12]|worlds\/[^/]+|games\/sandbox-[34]|assets\/(?:box|render)(?:\/levels)?)\/?$/;

/** Compatibility label; this is not a network address. */
export const feedOf = () => 'this device';
export const MOST = 16_000_000;

export const INDEX = { engine: LATEST.v, recipes: {}, labels: {}, latest: {}, first: {} };

/**
 * What the page knows of the vault's recipes: `phase` (idle, loading, ready, failed), the `feed` they are read from,
 * the `vault`, how many (`count`), why none were (`error`), the entries the reader refused (`refused`), every ref a
 * build asked for that the vault doesn't give (`missed`) and every one whose file wasn't handed over, after the page
 * waited for it (`unread`: it may well be in the vault), each saying why; and how many files are being read now
 * (`reading`) and how many of them wait for the feed to answer again (`waiting`).
 */
export const recipes = { phase: 'idle', feed: '', vault: '', count: 0, error: '', refused: [], missed: [], unread: [], reading: 0, waiting: 0 };

/** @type {Set<(r: typeof recipes) => void>} */
const watchers = new Set();
let telling = false;
/**
 * What the page knows, told to whoever watches: a moment later, once, however many things changed meanwhile, so a
 * ref told missed while a component works out what it shows (a Svelte `$derived`) changes nothing of it then.
 */
const tell = () => {
	if (telling) return;
	telling = true;
	queueMicrotask(() => {
		telling = false;
		for (const f of watchers)
			try {
				f(recipes);
			} catch {
				// a watcher that fails is its own
			}
	});
};
/** heard now and whenever what the page knows of the recipes changes; the function returned stops it */
export function watchRecipes(f) {
	watchers.add(f);
	f(recipes);
	return () => watchers.delete(f);
}

/** the most refs told missed (a world that asks for hundreds of one ref tells it once) */
const MOST_MISSED = 200;
/** a ref the vault couldn't give, or whose file wasn't handed over (`Unread`), told on the page and in the console,
 *  once @param {Error} e */
function noted(e) {
	const list = e instanceof Unread ? 'unread' : 'missed';
	if (e instanceof NotInVault && !recipes[list].includes(e.message) && recipes[list].length < MOST_MISSED) {
		recipes[list] = [...recipes[list], e.message];
		console.error(`asset recipes: ${e.message}`);
		tell();
	}
	return e;
}

/** the vault's recipes as ./sources/avendb.js `vaultRecipes` reads them off the index's rows, once they are in */
let source = null;
// A newer reactive answer invalidates an older one-shot catalog load.
let catalogRevision = 0;



/** the index filled in place with what the vault holds (empty for nothing) */
function fill(index) {
	for (const k of ['recipes', 'labels', 'latest', 'first']) {
		for (const key of Object.keys(INDEX[k])) delete INDEX[k][key];
		Object.assign(INDEX[k], index?.[k] ?? {});
	}
	INDEX.engine = index?.engine ?? LATEST.v;
}

/** where a locally read recipe file is cached on this device, by the recipe's hash (./cache.js) */
const KEPT = { get: cache.fileAt, put: cache.keepFile };

/** the recipe each row of the feed is, by its hash, once the rows are proven: its file is kept on the device by it */
const hashOfRow = new WeakMap();


/** how many files are read now (`recipes.reading`), told as it changes @param {number} n */
function reads(n) {
	recipes.reading = Math.max(0, recipes.reading + n);
	tell();
}

/** Hash-checked local cache, then local avenDB only. Missing bytes wait for peer sync. */
const readerOf = ({ kept, patience = READ }) => async (row) => {
 const hash = hashOfRow.get(row);
 const had = hash ? await Promise.resolve(kept.get(hash)).catch(() => undefined) : undefined;
 if (had && holds(had, hash)) return had;
 const file = Array.isArray(row?.files) ? row.files.at(-1) : undefined;
 if (!file) throw new Error('its entry brings no file');
 if (file.len > MOST) throw new Error('its file exceeds the recipe size limit');
 reads(1);
 try {
  const bytes = await deviceFile(file, { wait: patience });
  if (!bytes) throw new Error('Waiting for this recipe file to sync into local avenDB. Retry after synchronization.');
  if (hash && !holds(bytes, hash)) throw new Error('local recipe file does not match its accepted hash');
  if (hash) Promise.resolve(kept.put(hash, bytes)).catch(() => {});
  return bytes;
 } finally { reads(-1); }
};

/** a row the vault deleted (tagged so: src/lib/avendb/seed.js GONE) is no recipe of it */
const live = (r) => !(r?.tags ?? []).includes('avendb:deleted');

/**
 * The recipes of `rows`, read off by `read` (`vaultRecipes`), each entry held to the newest version this device
 * proved of it (game/code/fresh.js `fresh`, kept in `newest`): a ref that names no version is refused off an entry
 * handed out older, naming both. Rows a device checked or a proof proved (`proven`) are kept as their entries' newest;
 * a listing on the server's word never is.
 */
const recipesOf = (rows, read, newest, proven) => {
	const held = rows.filter(live);
	return vaultRecipes(held, { read, stale: fresh(held, { proven, keep: newest }).stale });
};

/** Read only locally verified entries. No remote listing, proof or file fallback. */
async function load({ kept = KEPT, patience = READ, vault = MAIA_CITY, newest = KEPT_NEWEST } = {}) {
 const generation = ++catalogRevision;
 source = null;
 fill(null);
 Object.assign(recipes, { phase: 'loading', feed: 'this device', vault, count: 0, error: '', refused: [], missed: [], unread: [] });
 tell();
 try {
  if (!/^[0-9a-f]{64}$/.test(String(vault))) throw new Error(NO_ANCHOR);
  if (!deviceOf()) throw new Error('Local avenDB is not connected. Unlock or connect this device, then retry.');
  const rows = await deviceRows(['recipe'], { vault });
  if (generation !== catalogRevision) return recipes;
  if (!rows?.length) {
   Object.assign(recipes, {phase:'loading',error:'Waiting for asset recipes to sync into local avenDB.'});
   tell(); return recipes;
  }
  const how = { kept, patience };
  const read = recipesOf(rows, readerOf(how), newest, true);
  if (!Object.keys(read.index.recipes).length) throw new Error(`No usable recipes in local avenDB: ${read.refused.join('; ')}`);
  const result = ready(read, null, vault, 'this device');
  void fresher(vault, how, newest);
  return result;
 } catch (e) {
  if (generation !== catalogRevision) return recipes;
  Object.assign(recipes, { phase: 'failed', error: String(e.message ?? e) });
  tell();
  return recipes;
 }
}

/**
 * The recipes read again off the page's device once its peers brought it new edits of vault `vault` (its bring, which
 * goes on while the page reads what the device held): the builds asked for from then on read the vault as they hold it.
 * Nothing where the page has moved on to another source meanwhile.
 * @param {string} vault @param {Parameters<typeof readerOf>[0]} how @param {typeof KEPT_NEWEST} newest
 */
async function fresher(vault, how, newest) {
	const was = source;
	const b = await whenBrought(vault);
	if (!b?.ok?.new || source !== was) return;
	const rows = await deviceRows(['recipe'], { vault });
	if (!rows || source !== was) return;
	const read = recipesOf(rows, readerOf(how), newest, true);
	if (Object.keys(read.index.recipes).length) ready(read, null, String(rows[0]?.vault ?? vault), 'this device');
}

/** Mounted lifetime owns its reactive query and typed discovery lease. Device
 * replacement and route cleanup are handled by api.observe's shared read window. */
export function watchRecipeCatalog(api, { vault = MAIA_CITY, kept = KEPT, patience = READ, newest = KEPT_NEWEST } = {}) {
 const d=deviceOf();
 if (loadedWith !== d || recipes.vault !== vault || recipes.phase !== 'ready') {
  catalogRevision++;
  source=null;fill(null);
  Object.assign(recipes,{phase:'loading',count:0,vault,feed:'this device',error:''});tell();
 }
 loadedWith=d;
 // Builds beginning after the first reactive catalog answer reuse that catalog,
 // rather than restarting the legacy one-shot/full-vault bring path.
 loading=Promise.resolve(recipes);
 return observeRecipeCatalog(api, vault, state => {
  catalogRevision++;
  if (state.phase !== 'local') {
   // Do not turn a missing local catalog into a confirmed absence, or retain
   // recipes from a revoked/locked reader after an unavailable response.
   source = null; fill(null);
   Object.assign(recipes, {phase:state.phase === 'waiting' ? 'loading' : 'failed',count:0,
    vault,feed:'this device',error:state.error ?? 'Waiting for asset recipes to sync into local avenDB.'});
   tell(); return;
  }
  const read=recipesOf(state.rows,readerOf({kept,patience}),newest,true);
  if (!Object.keys(read.index.recipes).length) {
   source=null;fill(null);
   Object.assign(recipes,{phase:'loading',count:0,vault,error:'Waiting for usable recipe records in local avenDB.',refused:[...read.refused]});
   tell();return;
  }
  ready(read,null,vault,'this device');
 });
}

/**
 * The recipes `read` in (a ./sources/avendb.js `vaultRecipes`), of vault `vault`, read from `from` (the feed's address,
 * or this device): what the page knows of them now. `proving` proves each before it is built (`proverOf`); none for
 * what the page's own device read, or the dev server's stand-in.
 */
function ready(read, proving, vault, from) {
	if (!proving) for (const h of Object.keys(read.index.recipes)) hashOfRow.set(read.rowOf(h), h);
	source = read;
	fill(read.index);
	Object.assign(recipes, { phase: 'ready', error: '', feed: from, vault, count: Object.keys(INDEX.recipes).length, refused: [...read.refused] });
	for (const r of read.refused) console.error(`asset recipes: refused, ${r}`);
	tell();
	return recipes;
}

let loading = null;
/** Load the local catalog once, or explicitly retry it. Options only configure local reads/cache. */
export function loadRecipes(o) {
	const d = deviceOf();
	if (o) return ((loadedWith = d), (loading = load(o)));
	// a device the page opened since they were read off the feed (or failed to be): read again, off it (local first)
	if (loading && d !== loadedWith) loading = null;
	loadedWith = d;
	return (loading ??= load());
}
/** the device the recipes were last asked for with (game/code/sources/device.js `deviceOf`) */
let loadedWith = /** @type {any} */ (undefined);

/** the recipes loaded again, from local avenDB (a page whose load failed asks again) */
export const reloadRecipes = () => ((loadedWith = deviceOf()), (loading = load()));

/** why a ref can't be built while the recipes aren't in @param {string} what */
const notIn = (what) =>
	new NotInVault(
		recipes.phase === 'failed'
			? `${what} can't be built: ${recipes.error}`
			: `${what} can't be built yet: the asset recipes of the Maia City vault are not loaded (a page loads them before its first build: loadRecipes)`
	);

/**
 * A world's name for an asset (Samuel 2026-10-22: sandboxes and worlds name assets only by their avenDB entries):
 * `pin:<game>/<key>[?its=values]`, the pin `{ entry, at }` that game's config `configs/<game>/assets` keeps under
 * `key`, an entry of Maia City and the heads of its version. The config is the Maia City vault's once loaded
 * (game/code/index.js `configAt`), else the repo's seed of it, and a newer version reaches a world only by an AIP on it.
 * No old ref stands behind a key: one the config doesn't pin names nothing.
 */
export const WORLD_PIN = /^pin:([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)(?:\?([^#\s]*))?$/;

/** A world's name for its asset `key` (`WORLD_PIN`), with the values it is built with. @param {string} game @param {string} key @param {Record<string, number | string>} [values] */
export const assetIn = (game, key, values = {}) => {
	const q = queryOf(values);
	return `pin:${game}/${key}${q ? `?${q}` : ''}`;
};

/**
 * A ref as the vault reads it: a world's name for an asset (`WORLD_PIN`) as the pin its game's config keeps, written
 * out (`vault:<vault>/<entry>@<heads>?its=values`); any other ref as it is. Throws NotInVault for a key its config
 * doesn't pin.
 * @template T @param {T} ref @returns {T | string}
 */
export function pinnedOf(ref) {
	const m = typeof ref === 'string' ? WORLD_PIN.exec(ref) : null;
	if (!m) return ref;
	const [, game, key, query = ''] = m;
	/** @type {any} */
	let pins;
	try {
		pins = configAt(`configs/${game}/assets`);
	} catch (e) {
		throw new NotInVault(`${ref}: ${game} keeps no assets config (${e instanceof Error ? e.message : String(e)})`);
	}
	const pin = pins && Object.hasOwn(pins, key) ? pins[key] : undefined;
	if (!parsePin(pin)) throw new NotInVault(`${ref}: ${game}’s assets config (configs/${game}/assets) pins no asset ${key}`);
	return pinRef({ vault: MAIA_CITY, entry: pin.entry, at: pin.at }, query);
}

/**
 * The hash a ref names in the Maia City vault: a world's name for an asset (`WORLD_PIN`), read as the pin its config
 * keeps; a pin, an asset by its entry and the heads of its version
 * (`vault:<vault>/<entry>@<heads>?its=values`, or `{ entry, at }`, ./sources/avendb.js `PIN_REF`), or an old ref read
 * through the entries' cards, `plants/apple@2:variant?its=values`, its latest version when none is named, its first
 * variant when none is, never another variant than the one it names. Throws NotInVault naming the ref for one the
 * vault doesn't hold (and while the recipes aren't in), and tells it (`recipes.missed`).
 * @param {string | { entry: string, at: string[] }} ref @returns {string}
 */
export function hashOf(ref) {
	try {
		if (!source) throw notIn(typeof ref === 'string' ? ref : JSON.stringify(ref));
		return source.hashOf(pinnedOf(ref));
	} catch (e) {
		throw noted(e);
	}
}

/** The values a ref names its build with, as text: a pin's, or an old ref's. @param {string | { params?: any }} ref */
export const paramsOf = (ref) => {
	const pin = parsePin(pinnedOf(ref));
	return pin ? pin.params : parseRef(/** @type {string} */ (ref)).params;
};

/** A build named from a ref and its values: the hash the ref names in the vault, the same values. @param {string} ref */
export const buildAt = (ref) => buildOf(hashOf(ref), paramsOf(ref));

/**
 * A recipe's name, avenDB's alone ("Oats v1 · 1a2b3c4d…": its title, its version's number, its entry's short id), as
 * every page shows it; its old ref while the recipes aren't in, or the hash's start for one the vault doesn't hold.
 * @param {string} hash
 */
export const nameOf = (hash) => source?.nameOf(hash) ?? recipeInfo(hash)?.label ?? `recipe ${String(hash).slice(0, 12)}…`;

/** The name of what a ref names in the vault (`nameOf`), or the ref itself where it names nothing, never told missed. */
export function refName(ref) {
	try {
		const hash = source?.hashOf(pinnedOf(ref));
		if (hash) return nameOf(hash);
	} catch {
		// named as it is written
	}
	return typeof ref === 'string' ? ref : JSON.stringify(ref);
}

/** The pin that names a recipe of the vault, `{ vault, entry, at }`, where its rows say; undefined otherwise. */
export const pinOf = (hash) => source?.pinOf(hash);

/** What a hash names in the vault's index: its group, id, version, variant, label and parameters; undefined if none. */
export const recipeInfo = (hash) => (typeof hash === 'string' && Object.hasOwn(INDEX.recipes, hash) ? INDEX.recipes[hash] : undefined);

/** What a hash names in the vault's index, or NotInVault naming it (told, as `hashOf` tells one). @param {string} hash */
export function heldAt(hash) {
	const at = recipeInfo(hash);
	if (at) return at;
	throw noted(source ? new NotInVault(`no recipe ${String(hash).slice(0, 12)}… is in the Maia City vault`) : notIn(`recipe ${String(hash).slice(0, 12)}…`));
}

/** The card the vault keeps beside a recipe (Recipe, v1's `card`, a build of it at its own values); undefined if none. */
export const cardOf = (hash) => (recipeInfo(hash) ? source?.rowOf(hash)?.record?.card : undefined);

/**
 * What the vault's entry declares beside a recipe (Recipe, v1's `manifest` and `contract`), which ../load.js holds its
 * builds to; undefined if none.
 */
export const declaredOf = (hash) => {
	const r = recipeInfo(hash) ? source?.rowOf(hash)?.record : undefined;
	return r ? { manifest: r.manifest, contract: r.contract } : undefined;
};

/**
 * A build's page: on the root, its recipe's hash as an address reads it ($lib/ids.js), its name in words (`?t=`,
 * never one of its values), then its values, sorted ($lib/assets/AssetPage.svelte).
 * @param {string} base the site's base path @param {string} hash @param {Record<string, unknown>} [values]
 */
export const pageOf = (base, hash, values) => {
	const q = queryOf(values);
	return `${base}/${idOf(hash)}/?t=${slug(recipeInfo(hash) ? nameOf(hash) : '', 'asset')}${q ? `&${q}` : ''}`;
};

/**
 * That recipe `hash` is about to be built (../load.js `canonical`): its entry's proof is asked for with the others the
 * page wants meanwhile, so a world's kinds go in one proof (`provenAt`). Nothing for a hash the index doesn't hold.
 * @param {string} hash
 */
export function wants(hash) { /* The local device already verified the entry. */ }

export async function provenAt(hash) {
 await loadRecipes();
 if (!source || !recipeInfo(hash)) throw noted(source ? new NotInVault(`Recipe ${String(hash).slice(0, 12)} is not yet in local avenDB; waiting for sync`) : notIn(`recipe ${hash}`));
 return source;
}

/**
 * A recipe of the vault by its hash: `{ hash, code }`, once its entry's proof checks out (`provenAt`), its file read
 * from local avenDB once a page and held to the hash, the version and the variant its proven card names
 * (./sources/avendb.js `vaultRecipes`). Rejects with NotInVault naming its ref for one the vault doesn't hold, or holds
 * otherwise, whose proof fails or whose file can't be read; told, as `hashOf` tells one.
 * @param {string} hash @returns {Promise<{ hash: string, code: string }>}
 */
export async function recipeAt(hash) {
	const proven = await provenAt(hash);
	try {
		return await proven.recipeAt(hash);
	} catch (e) {
		throw noted(e);
	}
}
