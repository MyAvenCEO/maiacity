/*
 * THE BIOMES AS ASSETS — each biome an asset of the `biomes` group the asset box builds (./built.js lists them before
 * the cover), kept in the Maia City vault as every other asset is (Samuel 2026-10-20: biomes as dynamic as every other
 * asset, loaded from avenDB, not from the repo): a patch of its floor (./patch.js), its card (./card.js) its surfaces,
 * its density and its cover, each kind the cover's asset at its seed. A world reads that card from the vault to lay
 * the floor round you ($lib/assets/sources/biome.js); this list only makes the recipes the vault is given.
 *
 * Its numbers are written in ./index.js, which only these recipes read. The list is written out, each biome by its id
 * and name, so the box's narrowing (./box/narrow.js) keeps one biome in its own recipe and none in the cover's.
 */
import { BIOMES, coverSeed } from './index.js';
import { floorPatch } from './patch.js';

/** the cover's version every biome's kinds are of (as ./built.js's HISTORY has it) */
const COVER_V = 1;

/**
 * A biome's patch, its note and where it is met, each kind of its cover the cover's asset at its seed.
 * @param {string} id
 */
const floor = (id) => {
	const b = /** @type {import('./index.js').Recipe} */ (BIOMES.find((x) => x.id === id));
	return {
		note: b.note,
		from: b.from,
		make: () => floorPatch(b, { ref: (kind, i) => `biomes/cover@${COVER_V}:${kind}?seed=${coverSeed(i, /** @type {import('./cover.js').Cover} */ (kind))}` })
	};
};

export const FLOORS = [
	{ id: 'food-forest', label: 'Food forest floor', ...floor('food-forest') },
	{ id: 'warm-food-forest', label: 'Food forest under glass', ...floor('warm-food-forest') },
	{ id: 'beech-forest', label: 'Beech forest', ...floor('beech-forest') },
	{ id: 'spruce-forest', label: 'Spruce forest', ...floor('spruce-forest') },
	{ id: 'meadow', label: 'Meadow', ...floor('meadow') },
	{ id: 'clover-lawn', label: 'Clover lawn', ...floor('clover-lawn') }
];
