/*
 * THE GROUPS BUILT AS ONE OBJECT — the Things, the Machines, the Actors and the Plants: each asset of theirs is made by
 * a builder that hands back one three.js object. ./index.js adds the three groups that are not (Biomes, Buildings,
 * Worlds); the asset box (./box) loads only these, so it carries no page and no world.
 */

/** @typedef {import('$lib/app/versions.js').Version<any>} AnyVersion */
/**
 * @typedef {{ id: string, label: string, versions: AnyVersion[], version: number, params?: import('./params.js').Param[] }} Item
 *   an asset as its group lists it; `params`, what its recipe is built with (./params.js), if it takes any
 */
/** @typedef {{ label: string, list: () => Promise<Item[]> }} Group */

/** @type {Record<string, Group>} */
export const OBJECT_GROUPS = {
	things: { label: 'Things', list: async () => (await import('$lib/models')).MODELS },
	machines: { label: 'Machines', list: async () => (await import('$lib/machines/index.js')).MACHINES },
	actors: { label: 'Actors', list: async () => (await import('$lib/actors')).FAMILIES },
	plants: { label: 'Plants', list: async () => /** @type {Item[]} */ (/** @type {unknown} */ ((await import('$lib/plants')).PLANTS)) }
};
