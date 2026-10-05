/*
 * SANDBOX 5 — Sandbox 4's dome cell (./village.ts), its food forest grown from our own plants ($lib/plants) through
 * ./flora.js: each plant at a stage of its life, from the young tree to the ripe fruit, so the forest is never all one
 * age. Outside, under the open sky, the plants of a middle-European forest garden; inside the domes, under the glass,
 * the ones that need the warmth — the mango, the banana, the coconut palm, the coffee and the cacao.
 *
 * Every plant is anchored to the version it was planted with (`v`, $lib/app/versions.js): a plant changed in the
 * plants library later is a new version there, and Sandbox 5 keeps growing the one written here until it is planted
 * again on purpose.
 */

/**
 * @typedef {{ id: string, v: number, stages: number[], weight?: number }} Planting a plant of the library at its version, at
 *   one of `stages` (the stage indices 0 … 9; 9 the ripe fruit), drawn `weight` times as often as a plant of weight 1
 */
/**
 * @typedef {{ trees: Planting[], shrubs: Planting[], climbers: Planting[], cover: Planting[] }} Garden
 *   a forest garden's layers: its trees (canopy and sub-canopy), its shrubs, its climbers, and the cover under them
 *   (herbs, vegetables, the ground layer and the fungi)
 */

/** the stages a fruit tree is planted at: young, in flower, its fruit green, ripe — the ripe ones the most */
const TREE = [4, 5, 7, 9];
/** a shrub's: in flower, in green fruit, ripe */
const SHRUB = [5, 7, 9];
/** a vegetable's or a herb's: growing, ready, and gone on to flower and fruit or seed */
const CROP = [5, 7, 9];

/** @type {Garden} */
const OUTSIDE = {
	trees: [
		{ id: 'apple', v: 1, stages: TREE, weight: 3 },
		{ id: 'pear', v: 1, stages: TREE, weight: 2 },
		{ id: 'cherry', v: 1, stages: TREE, weight: 2 },
		{ id: 'plum', v: 1, stages: TREE, weight: 2 },
		{ id: 'apricot', v: 1, stages: TREE },
		{ id: 'peach', v: 1, stages: TREE },
		{ id: 'mulberry', v: 1, stages: TREE },
		{ id: 'persimmon', v: 1, stages: TREE },
		{ id: 'fig', v: 1, stages: TREE }
	],
	shrubs: [
		{ id: 'raspberry', v: 1, stages: SHRUB, weight: 2 },
		{ id: 'blueberry', v: 1, stages: SHRUB, weight: 2 },
		{ id: 'lavender', v: 1, stages: SHRUB },
		{ id: 'sage', v: 1, stages: SHRUB },
		{ id: 'comfrey', v: 1, stages: SHRUB, weight: 2 }
	],
	climbers: [
		{ id: 'grape', v: 1, stages: SHRUB, weight: 2 },
		{ id: 'beans', v: 1, stages: CROP },
		{ id: 'cucumber', v: 1, stages: CROP }
	],
	cover: [
		{ id: 'strawberry', v: 1, stages: CROP, weight: 3 },
		{ id: 'clover', v: 1, stages: CROP, weight: 3 },
		{ id: 'wild-garlic', v: 1, stages: CROP, weight: 2 },
		{ id: 'moss', v: 1, stages: [6, 9], weight: 2 },
		{ id: 'pumpkin', v: 1, stages: CROP },
		{ id: 'tomato', v: 1, stages: CROP },
		{ id: 'oxheart', v: 1, stages: CROP },
		{ id: 'lettuce', v: 1, stages: CROP },
		{ id: 'chard', v: 1, stages: CROP },
		{ id: 'kale', v: 1, stages: CROP },
		{ id: 'radish', v: 1, stages: CROP },
		{ id: 'carrot', v: 1, stages: CROP },
		{ id: 'garlic', v: 1, stages: CROP },
		{ id: 'chives', v: 1, stages: CROP },
		{ id: 'mint', v: 1, stages: CROP },
		{ id: 'lemon-balm', v: 1, stages: CROP },
		{ id: 'thyme', v: 1, stages: CROP },
		{ id: 'oregano', v: 1, stages: CROP },
		{ id: 'parsley', v: 1, stages: CROP },
		{ id: 'dill', v: 1, stages: CROP },
		{ id: 'coriander', v: 1, stages: CROP },
		{ id: 'wine-cap', v: 1, stages: [6, 9] },
		{ id: 'shiitake', v: 1, stages: [6, 9] },
		{ id: 'oyster', v: 1, stages: [6, 9] }
	]
};

/** @type {Garden} */
const INSIDE = {
	trees: [
		{ id: 'mango', v: 1, stages: TREE, weight: 3 },
		{ id: 'avocado', v: 1, stages: TREE, weight: 2 },
		{ id: 'orange', v: 1, stages: TREE, weight: 2 },
		{ id: 'lemon', v: 1, stages: TREE, weight: 2 },
		{ id: 'king-coconut', v: 1, stages: [5, 7, 9], weight: 2 },
		{ id: 'banana', v: 1, stages: [5, 7, 9], weight: 2 },
		{ id: 'red-banana', v: 1, stages: [5, 7, 9] },
		{ id: 'papaya', v: 1, stages: [5, 7, 9], weight: 2 },
		{ id: 'jackfruit', v: 1, stages: TREE },
		{ id: 'durian', v: 1, stages: TREE },
		{ id: 'safou', v: 1, stages: TREE },
		{ id: 'sapodilla', v: 1, stages: TREE },
		{ id: 'soursop', v: 1, stages: TREE },
		{ id: 'pomegranate', v: 1, stages: TREE },
		{ id: 'olive', v: 1, stages: TREE },
		{ id: 'cacao', v: 1, stages: TREE, weight: 2 }
	],
	shrubs: [
		{ id: 'coffee', v: 1, stages: SHRUB, weight: 3 },
		{ id: 'rosemary', v: 1, stages: SHRUB },
		{ id: 'pepper', v: 1, stages: CROP },
		{ id: 'eggplant', v: 1, stages: CROP }
	],
	climbers: [{ id: 'passion-fruit', v: 1, stages: SHRUB }],
	cover: [
		{ id: 'pineapple', v: 1, stages: CROP, weight: 2 },
		{ id: 'ginger', v: 1, stages: CROP, weight: 2 },
		{ id: 'basil', v: 1, stages: CROP },
		{ id: 'strawberry', v: 1, stages: CROP },
		{ id: 'clover', v: 1, stages: CROP }
	]
};

/** Sandbox 5: the village of ./village.ts, its forest these gardens (`flora`). */
export const SANDBOX_5 = {
	sandbox: /** @type {const} */ ('sandbox-5'),
	flora: { seed: 'sandbox-5', outside: OUTSIDE, inside: INSIDE }
};

/** @typedef {typeof SANDBOX_5.flora} Flora */

/**
 * One planting of a layer, drawn by its weight, at one of its stages: the kind to grow.
 * @param {Planting[]} layer @param {() => number} r @param {string} seed
 * @returns {import('./flora.grow.js').Kind}
 */
export function pick(layer, r, seed) {
	const total = layer.reduce((a, p) => a + (p.weight ?? 1), 0);
	let x = r() * total;
	let p = layer[layer.length - 1];
	for (const q of layer) if ((x -= q.weight ?? 1) < 0) {
		p = q;
		break;
	}
	// the later stages a little more often: a food forest is mostly grown
	const k = Math.min(p.stages.length - 1, Math.floor(Math.pow(r(), 0.8) * p.stages.length));
	return { id: p.id, v: p.v, stage: p.stages[k], seed };
}

/** every plant a garden can grow, as kinds (for growing them all ahead) @param {Garden} garden @param {string} seed */
export const kindsOf = (garden, seed) =>
	Object.values(garden).flatMap((layer) => layer.flatMap((/** @type {Planting} */ p) => p.stages.map((stage) => ({ id: p.id, v: p.v, stage, seed }))));
