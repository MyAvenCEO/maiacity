/*
 * THE BIOMES AND THEIR COVER, BUILT IN THE BOX — the `biomes` group the asset box builds ($lib/assets/groups.js), kept
 * in the Maia City vault as every other asset is:
 *
 *   each biome   a patch of its floor, its card its numbers: what a world reads from the vault to lay that floor round
 *                you (./floors.js; Samuel 2026-10-20: biomes as dynamic as every other asset, from avenDB)
 *   the cover    what stands on a biome's floor (./cover.js: a grass clump, a fern, a wood anemone, a fallen branch…),
 *                each kind one shape a builder hands back as one three.js object: one asset, its kinds its variants,
 *                built at a seed, `biomes/cover@1:fern?seed=7139`. The worlds and the Biomes explorer (/app/biomes/)
 *                draw a floor's cover from these through the universal renderer ($lib/assets/render), laid out where
 *                ./stream.js lays it (`coverLaid`)
 *
 * A world lays a biome as a floor without an edge, round wherever the eye is, its ground painted by a shader of the
 * page's (./surfaces.js `groundMaterial`); its layout is plain sums, the same every time. The kinds cast shadows, as
 * the cover streamed on a page with shadows always has (./stream.js `shadows`). Each version is kept in HISTORY below
 * (all at v1 so far).
 */
import { COVER } from './cover.js';
import { FLOORS } from './floors.js';
import { registerAssets } from '$lib/assets/register.js';

/**
 * the cover's older versions, with their frozen builders (none yet)
 * @type {Record<string, import('../app/versions.js').Change[]>}
 */
const HISTORY = {};

/** a kind built at a seed, casting its shadow @param {(seed: number) => import('three').Object3D} build */
const casting = (build) => (/** @type {number} */ seed) => {
	const g = build(seed);
	g.traverse((o) => {
		if (/** @type {import('three').Mesh} */ (o).isMesh) o.castShadow = true;
	});
	return g;
};

/** every kind, in ./cover.js's order: the cover's variants */
const KINDS = Object.entries(COVER).map(([id, c]) => ({ id, label: c.label, make: casting(c.build) }));

const LIST = [
	...FLOORS,
	{
		id: 'cover',
		label: 'Biome cover',
		note: 'What stands on a biome’s floor, kind by kind: grasses, moss, flowers, berries, ferns, fallen leaves, deadwood, stones and mushrooms, each one shape in its own colours, a little different at each seed.',
		from: 'Every biome’s floor',
		params: [{ id: 'seed', label: 'Seed', type: /** @type {const} */ ('integer'), value: 7100, min: 0, max: 2147483647 }],
		make: KINDS
	}
];

/** the biomes and the cover, their versions and history ($lib/app/versions.js): the `biomes` group's recipes */
export const BUILT = registerAssets(LIST, 'make', HISTORY);

/**
 * A kind of cover built at a seed, as its ref: what a biome's floor asks the renderer for.
 * @param {string} kind @param {number} seed
 */
export const coverRef = (kind, seed) => `biomes/cover:${kind}?seed=${seed}`;
