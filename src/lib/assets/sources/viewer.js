// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * THE MAIA CITY VAULT'S ASSETS, BUILT FROM THE VAULT ALONE (V5 of the avenDB migration): a build of one of a vault's
 * recipes as a viewer of the vault shows it (the avenDB app's Assets, $lib/avendb/Assets.svelte, with
 * ../VaultAsset.svelte), with no repo fallback (Samuel 2026-10-17): its entry's file, read from the vault and held to its
 * hash before anything else (./avendb.js `vaultRecipes`), then this device's cache or the box, checked either way
 * (`vaultBuild`); the list it is picked from is ./shelf.js's. Nothing here reads the repo's index or its libraries
 * (../recipes.js, ../load.js, the `virtual:asset-recipes` modules): the frozen engines, the box, the device's cache and
 * the renderer are the kernel, as they are for every page.
 */
import { rebuild } from '../box/rebuild.js';
import * as cache from '../cache.js';
import { engineAt } from '../engines.js';
import { queryOf, valuesOf } from '../params.js';
import { checkCard } from '../schemas/index.js';
import { NotInVault } from './avendb.js';

/** a value an object holds of its own, never one it inherits @param {Record<string, any>} o @param {string} k */
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);

/** a build's name: its recipe's hash and every value it takes, sorted, as ../recipes.js names one @param {string} hash @param {Record<string, unknown>} [values] */
export const buildName = (hash, values) => {
	const q = queryOf(values);
	return q ? `${hash}?${q}` : hash;
};

/** a box's or the cache's build, checked and built into objects; throws with the reason it was refused */
function open({ data, card }, hash, label) {
	const verdict = checkCard(card);
	if (!verdict.ok) throw new Error(`${label}: refused, its card does not fit: ${verdict.errors.slice(0, 3).join('; ')}`);
	if (card.recipe !== hash) throw new Error(`${label}: refused, its card names another recipe`);
	return { obj: rebuild(data), card, data };
}

/**
 * A build of one of the vault's recipes (`hash`, with the values `given` as text, its own where not given), from the
 * vault alone, as ../load.js `loadAsset` makes one of the repo's: first its recipe's file, read from the vault and held
 * to its hash, its version and its variant (`source.recipeAt`, which throws NotInVault naming its ref), so what the
 * vault lacks fails even where this device has built it before; then this device's cache, under the key a build of
 * that recipe on that engine with those values is kept by wherever its recipe came from (the same bytes are the same
 * build); else the box, which runs the file on the engine the vault's entries are made for. Checked either way: its
 * card against the card's schema and the recipe it names, its data by ../box/rebuild.js.
 * @param {ReturnType<typeof import('./avendb.js').vaultRecipes>} source the vault's recipes
 * @param {string} hash @param {Record<string, string>} [given]
 * @param {{ box: import('../box/host.js').AssetBox, store?: Pick<typeof cache, 'get' | 'put' | 'drop'>, keep?: boolean, phase?: (step: 'file' | 'cache' | 'build') => void }} o
 *   the box it builds in, the cache (this device's), and whether the cache is read and kept to
 * @returns {Promise<{ obj: any, card: any, data: any, from: 'cache' | 'box', name: string, label: string,
 *   recipe: { hash: string, code: string }, values: Record<string, number | string> | undefined,
 *   given: Record<string, string> | undefined, stored: Promise<boolean> }>}
 */
export async function vaultBuild(source, hash, given = {}, { box, store = cache, keep = true, phase = () => {} }) {
	const at = typeof hash === 'string' ? own(source.index.recipes, hash) : undefined;
	if (!at) throw new NotInVault(`no recipe ${String(hash).slice(0, 12)}… is in the Maia City vault`);
	const asked = Object.keys(given).length ? given : undefined;
	if (asked && !at.params?.length) throw new Error(`${at.label} takes no parameters`);
	let values;
	try {
		values = at.params?.length ? valuesOf(at.params, given) : undefined;
	} catch (e) {
		throw new Error(`${at.label}: ${e instanceof Error ? e.message : String(e)}`);
	}
	phase('file');
	const recipe = await source.recipeAt(hash);
	const engine = engineAt(source.index.engine);
	if (!engine) throw new Error(`${at.label}: no engine ${source.index.engine}`);
	const key = cache.keyOf({ engine: engine.blake3, recipe: hash, params: values });
	const text = values && Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
	const said = { name: buildName(hash, values), label: at.label, recipe, values, given: text };
	if (keep) {
		phase('cache');
		const hit = await store.get(key);
		if (hit) {
			try {
				return { ...open(hit, hash, at.label), ...said, from: 'cache', stored: Promise.resolve(true) };
			} catch {
				// spoiled, or kept by an older page: gone, and built anew
				await store.drop(key);
			}
		}
	}
	let built;
	phase('build');
	try {
		built = await box.build(recipe, text);
	} catch (e) {
		throw new Error(`${at.label}: the box could not build it (${e instanceof Error ? e.message : String(e)})`);
	}
	const got = open(built, hash, at.label);
	const stored = keep ? store.put(key, built).catch(() => false) : Promise.resolve(false);
	return { ...got, ...said, from: 'box', stored };
}
