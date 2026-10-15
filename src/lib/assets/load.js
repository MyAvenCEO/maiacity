// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * LOADING AN ASSET — the one way a page gets an asset by its ref as anyone's would be got: from this device's cache
 * (./cache.js) when it was built here before, else from the asset box (./box/host.js), which runs its recipe. Either
 * way it is checked (its card against the card's schema, its data by ./box/rebuild.js) and built into three.js objects
 * by our own code. The recipe is the only truth; what it made stays on this device, under a key named by the engine's
 * hash (`virtual:asset-box/engine`) and the ref, so a page that finds it in the cache loads no recipe, and starts no box.
 */
import ENGINE from 'virtual:asset-box/engine';
import { AssetBox } from './box/host.js';
import { rebuild } from './box/rebuild.js';
import * as cache from './cache.js';
import { checkCard } from './schemas/index.js';

export { ENGINE };

let shared;
/** the page's box, started when a build first needs it */
export const boxOf = () => (shared ??= new AssetBox());

/** the cache key of a ref under this page's engine @param {string} ref */
export const keyOf = (ref) => cache.keyOf(ref, { engine: ENGINE });

const now = () => performance.now();

/** a box's or the cache's build, checked and built into objects; throws with the reason it was refused */
function open({ data, card }) {
	const verdict = checkCard(card);
	if (!verdict.ok) throw new Error(`refused: its card does not fit: ${verdict.errors.slice(0, 3).join('; ')}`);
	return { obj: rebuild(data), card, data };
}

/**
 * An asset by its ref (`plants/apple@2?seed=maia&stage=9`), ready to put into a scene: `obj`, its `card`, its plain
 * `data`, where it came `from` ('cache' or 'box'), its `key`, its times in ms, and `stored`, which settles once a box's
 * build is kept in the cache (true) or was not (false).
 * @param {string} ref
 * @param {{ box?: AssetBox, cache?: boolean }} [o] `cache: false` builds in the box and keeps nothing
 */
export async function loadAsset(ref, { box = boxOf(), cache: useCache = true } = {}) {
	const t0 = now();
	const key = keyOf(ref);
	if (useCache) {
		const hit = await cache.get(key);
		const t1 = now();
		if (hit) {
			try {
				const got = open(hit);
				return { ...got, from: 'cache', key, stored: Promise.resolve(true), ms: { read: Math.round(t1 - t0), rebuild: Math.round(now() - t1), total: Math.round(now() - t0) } };
			} catch {
				// spoiled, or kept by an older page: gone, and built anew
				await cache.drop(key);
			}
		}
	}
	const t1 = now();
	const built = await box.build(ref);
	const t2 = now();
	const got = open(built);
	const t3 = now();
	const stored = useCache ? cache.put(key, built).catch(() => false) : Promise.resolve(false);
	return { ...got, from: 'box', key, stored, ms: { read: Math.round(t1 - t0), build: built.ms.build, serialize: built.ms.serialize, box: Math.round(t2 - t1), rebuild: Math.round(t3 - t2), total: Math.round(t3 - t0) } };
}
