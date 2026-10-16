/*
 * A BIOME'S COVER, BUILT IN THE BOX — what stands on a biome's floor (./cover.js: a grass clump, a fern, a wood
 * anemone, a fallen branch…), each kind one shape a builder hands back as one three.js object, so each is a recipe of
 * the `biomes` group the asset box builds ($lib/assets/groups.js): one asset, the cover, its kinds its variants, built
 * at a seed, `biomes/cover@1:fern?seed=7139`. The Biomes explorer (/app/biomes/) draws a floor's cover from these
 * through the universal renderer ($lib/assets/render), laid out where ./stream.js lays it (`coverLaid`).
 *
 * The biome itself stays a recipe of numbers (./index.js): which surfaces, which kinds, how big their colonies, how
 * dense. It is not one object: it is a floor without an edge, laid out round wherever the eye is, its ground painted by
 * a shader of the page's; and its layout is plain sums, the same every time, with no code of anyone's to keep apart.
 *
 * The kinds cast shadows, as the cover streamed on a page with shadows always has (./stream.js `shadows`). Each
 * version is kept in HISTORY below (all at v1 so far).
 */
import { COVER } from './cover.js';
import { versioned } from '../app/versions.js';

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
	{
		id: 'cover',
		label: 'Biome cover',
		note: 'What stands on a biome’s floor, kind by kind: grasses, moss, flowers, berries, ferns, fallen leaves, deadwood, stones and mushrooms, each one shape in its own colours, a little different at each seed.',
		from: 'Every biome’s floor',
		params: [{ id: 'seed', label: 'Seed', type: /** @type {const} */ ('integer'), value: 7100, min: 0, max: 2147483647 }],
		make: KINDS
	}
];

/** the cover, its version and history ($lib/app/versions.js): the `biomes` group's recipes */
export const BUILT = versioned(LIST, 'make', HISTORY);

/**
 * A kind of cover built at a seed, as its ref: what a biome's floor asks the renderer for.
 * @param {string} kind @param {number} seed
 */
export const coverRef = (kind, seed) => `biomes/cover:${kind}?seed=${seed}`;
