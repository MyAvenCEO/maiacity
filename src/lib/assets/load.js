// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * LOADING AN ASSET — the one way a page gets a build, by its name, `<recipe hash>?its=values` (./recipes.js), as
 * anyone's would be got: from this device's cache (./cache.js) when it was built here before, else from the asset box
 * (./box/host.js), which runs the recipe on the frozen engine it was made for. Either way it is checked (its card
 * against the card's schema, its data by ./box/rebuild.js) and built into three.js objects by our own code. The recipe
 * is the only truth; what it made stays on this device, so a page that finds it in the cache loads no recipe and
 * starts no box.
 */
import { AssetBox } from './box/host.js';
import { rebuild } from './box/rebuild.js';
import * as cache from './cache.js';
import { engineAt } from './engines.js';
import { valuesOf } from './params.js';
import { INDEX, buildOf, parseBuild, recipeAt } from './recipes.js';
import { checkCard } from './schemas/index.js';

const boxes = new Map();
/** the page's box for an engine, started when a build first needs it @param {number} [v] */
export const boxOf = (v = INDEX.engine) => {
	if (!boxes.has(v)) boxes.set(v, new AssetBox({ engine: v }));
	return boxes.get(v);
};

/**
 * A build of one of our recipes, named as it is kept: its hash and every value it takes, its own where not given, so
 * two names of one build are one. Throws for a value its recipe does not take.
 * @param {string} name `<hash>?its=values`
 */
export function canonical(name) {
	const { hash, params } = parseBuild(name);
	const at = INDEX.recipes[hash];
	if (!at) throw new Error(`no recipe ${hash.slice(0, 12)}… on this device`);
	const values = at.params?.length ? valuesOf(at.params, params) : undefined;
	if (params && !values) throw new Error(`${at.label} takes no parameters`);
	return { hash, at, values, name: buildOf(hash, values), engine: engineAt(INDEX.engine) };
}

/** the cache key of a build @param {string} name */
export const keyOf = (name) => {
	const c = canonical(name);
	return cache.keyOf({ engine: c.engine.blake3, recipe: c.hash, params: c.values });
};

const now = () => performance.now();

/** a box's or the cache's build, checked and built into objects; throws with the reason it was refused */
function open({ data, card }, hash) {
	const verdict = checkCard(card);
	if (!verdict.ok) throw new Error(`refused: its card does not fit: ${verdict.errors.slice(0, 3).join('; ')}`);
	if (card.recipe !== hash) throw new Error('refused: its card names another recipe');
	return { obj: rebuild(data), card, data };
}

/**
 * A build, ready to put into a scene: `obj`, its `card`, its plain `data`, where it came `from` ('cache' or 'box'),
 * its `name` and `key`, its times in ms, and `stored`, which settles once a box's build is kept in the cache (true) or
 * was not (false).
 * @param {string} name `<recipe hash>?its=values`
 * @param {{ box?: AssetBox, cache?: boolean }} [o] `cache: false` builds in the box and keeps nothing
 */
export async function loadAsset(name, { box, cache: useCache = true } = {}) {
	const t0 = now();
	const c = canonical(name);
	const key = cache.keyOf({ engine: c.engine.blake3, recipe: c.hash, params: c.values });
	const said = { name: c.name, key, label: c.at.label };
	if (useCache) {
		const hit = await cache.get(key);
		const t1 = now();
		if (hit) {
			try {
				const got = open(hit, c.hash);
				return { ...got, ...said, from: 'cache', stored: Promise.resolve(true), ms: { read: Math.round(t1 - t0), rebuild: Math.round(now() - t1), total: Math.round(now() - t0) } };
			} catch {
				// spoiled, or kept by an older page: gone, and built anew
				await cache.drop(key);
			}
		}
	}
	const t1 = now();
	const recipe = await recipeAt(c.hash);
	const t2 = now();
	const given = c.values && Object.fromEntries(Object.entries(c.values).map(([k, v]) => [k, String(v)]));
	const built = await (box ?? boxOf(INDEX.engine)).build(recipe, given);
	const t3 = now();
	const got = open(built, c.hash);
	const t4 = now();
	const stored = useCache ? cache.put(key, built).catch(() => false) : Promise.resolve(false);
	return { ...got, ...said, from: 'box', stored, ms: { read: Math.round(t1 - t0), recipe: Math.round(t2 - t1), start: built.ms.start, build: built.ms.build, serialize: built.ms.serialize, box: Math.round(t3 - t2), rebuild: Math.round(t4 - t3), total: Math.round(t4 - t0) } };
}
