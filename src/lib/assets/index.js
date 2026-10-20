/*
 * EVERY ASSET BY ONE NAME — the asset groups of the app (the Factories, the Things, the Machines, the Actors, the
 * Plants, the Biomes, the Buildings, the Worlds) behind one way to name an asset at a version, so anything can ask for
 * anything:
 *
 *   group/id@v            machines/powercube@3, plants/apple@1, things/pickup@2, factories/batterypack-line@1
 *   group/id@v:variant    machines/powercube@1:powercube-electric (a kind's variant, as it was at that version)
 *   group/id              its latest version
 *   vault:<vault id>/group/id@v    the same, kept in a vault: read (`readRef`), and refused by every loader while
 *                                  avenDB storage is not switched on (./sources)
 *
 * `assetAt(ref)` gives back the version and its builder, the one the group's explorer shows for it ($lib/app/versions.js:
 * a version's own frozen builder, or `kept: false` when only its note is left); `objectAt(ref, …)` builds it, as the
 * object to put into a scene or to carry in another asset ($lib/assets/parts.js). A world, a building or a film names
 * what it puts in by such a ref and so stays anchored to the asset as it was when it was made. Each group is loaded
 * only when it is asked for.
 */

import { OBJECT_GROUPS } from './groups.js';
import { assetIn, objectIn } from './refs.js';
import { repoRef } from './sources/index.js';
export { parseRef, refOf } from './refs.js';
export { readRef, repoRef } from './sources/index.js';

/** @typedef {import('./groups.js').AnyVersion} AnyVersion */
/** @typedef {import('./groups.js').Item} Item an asset as its group lists it */

/**
 * Every group: the ones built as one object (./groups.js, which the asset box loads too: every biome among them, a patch
 * of its floor) and what is not (a factory's spec, a dome's interior kind, a world's page).
 * @type {Record<string, import('./groups.js').Group>}
 */
export const GROUPS = {
	// a factory is its spec, not an object: objectAt throws for it ($lib/factories/index.js)
	factories: { label: 'Factories', list: async () => (await import('$lib/factories/index.js')).FACTORIES },
	...OBJECT_GROUPS,
	// every building: the ones built as one object, which the box builds (./groups.js), and the tent and the domes, worlds
	// in disguise built by Sandbox 3's interiors (objectAt throws for one of them, as for a factory)
	buildings: { ...OBJECT_GROUPS.buildings, list: async () => /** @type {Item[]} */ (/** @type {unknown} */ ((await import('$lib/buildings')).BUILDINGS)) },
	worlds: {
		label: 'Worlds',
		list: async () => {
			const { PLAY, WORLDS } = await import('$lib/app/places');
			// a world's id is the last part of its address: sandbox-5, tired-land
			return [...PLAY, ...WORLDS].filter((p) => p.versions).map((p) => ({ ...p, id: idOfHref(p.href), versions: /** @type {AnyVersion[]} */ (p.versions), version: p.version ?? 1 }));
		}
	}
};

/** a world's id from its address @param {string} href */
export const idOfHref = (href) => href.replace(/\/+$/, '').split('/').pop() ?? href;

/**
 * An asset at a version, by its ref: the item as its group lists it, the version, its builder (a kind's: the variant
 * asked for, or its first) and whether that builder is the version's own. Undefined if there is no such asset or
 * version.
 * @param {string} ref
 */
export const assetAt = async (ref) => (repoRef(ref), assetIn(GROUPS, ref));

/**
 * An asset at a version, built: the object a thing's builder, a plant's `grow`, or a machine's or an actor's variant
 * makes, its ref on it (`userData.ref`) so `carry` names it on every part it brings. The arguments go to the builder
 * (a thing's options, a plant's stage and seed). Throws when the version was not kept, or when the group's versions
 * are not built as one object (a biome's recipe, a dome's interior, a world's page).
 * @param {string} ref
 * @param {...any} args
 */
export const objectAt = async (ref, ...args) => (repoRef(ref), objectIn(GROUPS, ref, ...args));
