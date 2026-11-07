// @ts-nocheck — plain JS, runs in the page
/*
 * THE CATALOG — play's one source of assets (play/SPEC.md §4). Every accepted version and variant of Maia City's
 * assets, by the BLAKE3 hash of its recipe file, from play's API (/api/catalog); each file read from /api/files/<hash>,
 * held to that hash and kept on this device by it (./cache.js).
 *
 * An asset is named only by a hash: a build, `<hash>?values` (./builds.js), or a slot of its sandbox's pins,
 * `pin:<sandbox>/<slot>?values`, which the sandbox's config (play's database, ../game/code/index.js) maps to a build.
 * Nothing is looked up by a readable name: a version's number, an asset's id and a label are only shown.
 */
import { holds } from '../game/hash.js';
import { configAt } from '../game/code/index.js';
import { buildOf, hashText, parseBuild } from './builds.js';
import * as cache from './cache.js';
import { LATEST } from './engines.js';
import { queryOf } from './params.js';
import { handedPieces } from './box/pieces.js';
import { lodOf } from './lodcard.js';

export { buildOf, checked, hashText, parseBuild } from './builds.js';

/** a build the catalog can't give: a hash it doesn't hold, a slot its sandbox doesn't pin, or a name that is no hash */
export class NotInCatalog extends Error {}

/** the largest recipe file a page reads */
export const MOST = 16_000_000;

/**
 * What the page knows of each recipe by its hash: its asset's group and id, its version, its variant, its label and
 * the values it takes (for showing and for the box's details), and the engine every build runs on by default.
 */
export const INDEX = { engine: LATEST.v, recipes: {} };
/** each recipe's record (its card, manifest, contract and engine), by its hash */
const records = new Map();
/** each recipe's file's size, by its hash */
const sizes = new Map();

/** where the catalog is: `phase` (idle, loading, ready, failed), how many recipes, why none */
export const catalog = { phase: 'idle', count: 0, error: '' };

async function load() {
	Object.assign(catalog, { phase: 'loading', count: 0, error: '' });
	try {
		// asked again, twice, where the proxy got no answer for a moment (502, 503, 504)
		let res = await fetch('/api/catalog', { credentials: 'same-origin' });
		for (const wait of [1000, 3000]) {
			if (![502, 503, 504].includes(res.status)) break;
			await new Promise((ok) => setTimeout(ok, wait));
			res = await fetch('/api/catalog', { credentials: 'same-origin' });
		}
		if (!res.ok) throw new Error(res.status === 401 ? 'Please sign in first.' : `The asset catalog could not be read (HTTP ${res.status}).`);
		const rows = await res.json();
		for (const k of Object.keys(INDEX.recipes)) delete INDEX.recipes[k];
		records.clear();
		for (const r of rows) keep(r);
		// what was handed to this page by hand stays beside it, over a row of the same hash (the bench's guests)
		for (const r of handedRows.values()) keep(r);
		INDEX.engine = LATEST.v;
		Object.assign(catalog, { phase: 'ready', count: rows.length });
	} catch (e) {
		Object.assign(catalog, { phase: 'failed', error: String(e?.message ?? e) });
	}
	return catalog;
}

/** one catalog row into the index, its record and its size */
const keep = (r) => {
	const params = r.record?.card?.params;
	// its levels of detail as its card names them (./lodcard.js): a version from before the contract read as it drew
	const lod = lodOf(r.record?.card);
	INDEX.recipes[r.hash] = { group: r.group, id: r.id ?? r.slug, v: r.v, variant: r.variant, first: r.first, asset: r.asset, label: r.label, lod, ...(r.proposed ? { proposed: true } : {}), ...(params?.length ? { params } : {}) };
	records.set(r.hash, r.record);
	sizes.set(r.hash, r.size);
};

/**
 * A proposed version's builds (play's /api/intents/:id `review.builds`), held beside the accepted ones so the intents' board
 * can build it to be seen before anyone decides. It builds the way every recipe does: its file read from play by its
 * hash and held to it, then run in the asset box (./box/host.js), the sandboxed frame with no origin, on the frozen
 * engine its record names. Nothing else names a proposed hash, so no sandbox ever draws one.
 * @param {any[]} rows
 */
export async function admitProposed(rows) {
	await loadRecipes();
	for (const r of rows) keep({ ...r, proposed: true });
}

let loading = null;
/** play's catalog read now, even where recipes handed by hand stood in for it (the world bench with --play) */
export function readRecipes() {
	loading = load();
	return loading;
}

/** the catalog, read once a page (again after a failure) */
export function loadRecipes() {
	if (catalog.phase === 'failed') loading = null;
	return (loading ??= load());
}

/** a slot of a sandbox's pins, `pin:<sandbox>/<slot>[?values]` */
export const SLOT = /^pin:([a-z0-9][a-z0-9-]*)\/([a-zA-Z0-9][a-zA-Z0-9/-]*)(?:\?([^#\s]*))?$/;

/** a sandbox's slot, with the values it is built with @param {string} sandbox @param {string} slot @param {Record<string, unknown>} [values] */
export const assetIn = (sandbox, slot, values = {}) => {
	const q = queryOf(values);
	return `pin:${sandbox}/${slot}${q ? `?${q}` : ''}`;
};

/**
 * A name as the build it is: a build as it is; a slot as the build its sandbox pins there, the slot's own values
 * after the pin's. Anything else is refused: an asset is named by its hash.
 * @param {string} name @returns {{ hash: string, params?: Record<string, string> }}
 */
export function resolve(name) {
	if (typeof name !== 'string') throw new NotInCatalog(`not a build: ${JSON.stringify(name)}`);
	const slot = SLOT.exec(name);
	if (!slot) {
		if (!/^[0-9a-f]{64}(\?|$)/.test(name)) throw new NotInCatalog(`${name}: an asset is named by its hash (a build, <hash>?values) or a sandbox's slot`);
		return parseBuild(name);
	}
	const [, sandbox, key, query = ''] = slot;
	const pins = configAt(`configs/${sandbox}/assets`);
	const pinned = pins && Object.hasOwn(pins, key) ? pins[key] : undefined;
	if (typeof pinned !== 'string') throw new NotInCatalog(`${name}: ${sandbox} pins no asset in slot ${key}`);
	return parseBuild(query ? `${pinned}${pinned.includes('?') ? '&' : '?'}${query}` : pinned);
}

/** the hash a build or a slot names, held by the catalog @param {string} name */
export function hashOf(name) {
	const { hash } = resolve(name);
	heldAt(hash);
	return hash;
}

/** the values a build or a slot names its build with @param {string} name */
export const paramsOf = (name) => resolve(name).params;

/** a build or a slot as a build's name, `<hash>?values` @param {string} name */
export const buildAt = (name) => {
	const { hash, params } = resolve(name);
	return buildOf(hash, params);
};

/** what the catalog knows of a hash, or undefined */
export const recipeInfo = (hash) => (typeof hash === 'string' && Object.hasOwn(INDEX.recipes, hash) ? INDEX.recipes[hash] : undefined);

/** what the catalog knows of a hash, or NotInCatalog naming it */
export function heldAt(hash) {
	const at = recipeInfo(hash);
	if (at) return at;
	throw new NotInCatalog(
		catalog.phase === 'ready'
			? `no recipe ${String(hash).slice(0, 12)}… is in play's catalog`
			: `recipe ${String(hash).slice(0, 12)}… can't be built yet: ${catalog.error || "play's catalog is not loaded (loadRecipes)"}`
	);
}

/** a recipe's name as it is shown: its label and its version ("Goat: Saanen v2") */
export const nameOf = (hash) => {
	const at = recipeInfo(hash);
	return at ? `${at.label} v${at.v}` : `recipe ${String(hash).slice(0, 12)}…`;
};

/** the card the catalog keeps beside a recipe; undefined if none */
export const cardOf = (hash) => (recipeInfo(hash) ? records.get(hash)?.card : undefined);

/** what a recipe's record declares (its manifest and contract), which ./load.js holds its builds to */
export const declaredOf = (hash) => {
	const r = recipeInfo(hash) ? records.get(hash) : undefined;
	return r ? { manifest: r.manifest, contract: r.contract } : undefined;
};

/**
 * A recipe by its hash: `{ hash, code, pieces }`, its file from this device's cache or play's API, held to the hash.
 * @param {string} hash @returns {Promise<{ hash: string, code: string }>}
 */
export async function recipeAt(hash) {
	// the pieces its manifest names go with it: the box reads them from play's files (./box/pieces.js)
	const pieces = records.get(hash)?.manifest?.pieces ?? [];
	// a recipe handed in by hand (the benches) takes every piece handed in beside it
	if (handed.has(hash)) return { hash, code: handed.get(hash), pieces: pieces.length ? pieces : handedPieces() };
	await loadRecipes();
	heldAt(hash);
	if ((sizes.get(hash) ?? 0) > MOST) throw new NotInCatalog(`${nameOf(hash)}: its file is larger than a page reads`);
	let bytes = await Promise.resolve(cache.fileAt(hash)).catch(() => undefined);
	if (!bytes || !holds(bytes, hash)) {
		const res = await fetch(`/api/files/${hash}`, { credentials: 'same-origin' });
		if (!res.ok) throw new NotInCatalog(`${nameOf(hash)}: its file could not be read (HTTP ${res.status})`);
		bytes = new Uint8Array(await res.arrayBuffer());
		if (!holds(bytes, hash)) throw new NotInCatalog(`${nameOf(hash)}: its file does not hash to its name`);
		Promise.resolve(cache.keepFile(hash, bytes)).catch(() => {});
	}
	return { hash, code: new TextDecoder().decode(bytes), pieces };
}

/** the catalog as the asset viewer reads it (./VaultAsset.svelte, ./sources/viewer.js `vaultBuild`): its index, a
 *  recipe by its hash, its name */
export const source = { index: INDEX, recipeAt, nameOf, hashOf, cardOf };

/** what play's database says of a plant version (its record's `plant`): its Latin name, layer, origin, note and
 *  stages; undefined for anything else */
export const plantOf = (hash) => (recipeInfo(hash) ? records.get(hash)?.plant : undefined);

/** recipe files handed to this page by hand (the render bench's guests, in development), by their hashes */
const handed = new Map();
/** and their rows, kept over play's catalog when it is read after them */
const handedRows = new Map();
/**
 * Recipes handed to this page by hand: the render bench's guests (the plants a dome names, made on this machine from
 * their readable sources), each `{ hash, code, group, id, v, variant, label, params }`, held to its hash and kept beside
 * the catalog for this page alone. A page that never reads play's catalog (the bench) takes them as its catalog.
 * @param {{ hash: string, code: string, group: string, id: string, v: number, variant?: string | null, label: string, params?: any[], card?: any }[]} rows
 */
export function admitHanded(rows) {
	for (const r of rows) {
		if (hashText(r.code) !== r.hash) throw new Error(`refused: the recipe handed as ${String(r.hash).slice(0, 12)}… hashes otherwise`);
		handed.set(r.hash, r.code);
		const row = { hash: r.hash, group: r.group, id: r.id, v: r.v, variant: r.variant ?? null, label: r.label, record: { card: r.card ?? { params: r.params ?? [] } }, size: r.code.length };
		handedRows.set(r.hash, row);
		keep(row);
	}
	if (catalog.phase !== 'ready') {
		Object.assign(catalog, { phase: 'ready', count: Object.keys(INDEX.recipes).length, error: '' });
		loading = Promise.resolve(catalog);
	}
}
