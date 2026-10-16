// @ts-nocheck — plain JS
/*
 * HOW FINELY TO DRAW A THING — chosen by how big it looks, never by how far off it is, so one rule fits a cup and a
 * tree: its size on the screen (the ball that holds it, as a share of the view's height). Every asset has three levels
 * of its shape and, smallest, its picture (./impostors.js): a recipe that takes a `detail` (the plants) is built at a
 * lower detail for each, and every other asset's lower levels are made from its finest by simplifying it
 * (./simplify.js), each within what it may cost (BUDGETS). Each level is drawn while the thing looks at least as big as
 * its threshold; a coarser one fades in under it (the dither of ./presets.js) over the last stretch before, so when it
 * takes over it is already there.
 *
 * The thresholds are the ones Sandbox 4's forest draws its trees by (src/lib/sandbox-2/interior/flora.js: its near
 * shape to 32 m, its middle one to 80 m, a picture beyond, for a tree 12 m across), as shares of the view, so every
 * asset gets the same; the whole shape, which Sandbox 4 never draws, only when it fills the view. A picture
 * (128 pixels a side) then never shows bigger than it was taken on a screen 720 pixels high, and little bigger on one
 * twice that.
 */

/** the sizes on screen down to which each level of a shape is drawn, finest first; smaller than the last, its picture */
export const LEVELS = [1.2, 0.28, 0.11];
/**
 * a shape this heavy (triangles) or more takes the picture at the last threshold; a lighter one keeps its shape until
 * it looks smaller, down to PICTURE (a chair of a thousand triangles costs nothing drawn whole, and looks crisper)
 */
export const HEAVY = 20000;
export const PICTURE = 0.04;
/** a coarser level fades in over sizes from its threshold up to (1 + BAND) times it */
export const BAND = 0.3;
/** a thing switches level only once its size is this much past the threshold (so it does not flicker on the line) */
export const HOLD = 0.06;
/** smaller than this on screen (about a pixel on a phone held upright), not drawn at all */
export const SMALLEST = 0.002;

/** the screen the levels are made for, its height in pixels: a laptop's, or a phone's held across */
export const SCREEN = 1080;

/**
 * What each level of a shape may cost, finest first, and how far one made by simplifying may stray from the finest:
 *
 * - level 0, the build as its recipe made it: held only by the box's own budgets (../box/rebuild.js);
 * - level 1, drawn from 1.2 down to 0.28 of the view: at most 0.3 of level 0's triangles, about what the plants'
 *   recipes keep at detail 0.25 (measured at stage 9: hazel 27 %, walnut 25 %, apple 24 %, redcurrant 18 %, rhubarb
 *   12 %, strawberry 10 %);
 * - level 2, from 0.28 down to its picture: at most 0.08, as the plants keep at detail 0.1 (2.5 to 7 %).
 *
 * A level made by simplifying never has more triangles than the pixels of the square it fills where it hands over to
 * the next, at its threshold on SCREEN ((LEVELS[L] × SCREEN)²: 91,445 for level 1, 14,113 for level 2): a triangle
 * smaller than a pixel there is never seen, and nearer, where it would be, the finer level is drawn. Nor is it made
 * lighter than `floor`: a few hundred triangles cost little more than the draw call that holds them, and a chair of a
 * thousand is cheap whole. A plant's levels are its recipe's own and are held to their share alone: a big tree's crown
 * at detail 0.1 (a walnut's 18,328, a linden's 20,358) is over its ceiling, but simplifying a crown only takes its
 * leaves away, and a thinned crown reads worse at its distance than the triangles cost.
 *
 * A level made by simplifying keeps within `px` pixels on SCREEN of the finest where it is drawn biggest (at the
 * threshold before it), as long as its triangles let it: the simplifier takes the edges whose loss shows least first.
 * Only a shape that cannot reach its share so (a machine's parts, hard edges at every corner) goes on to STRETCH times
 * that. A part smaller than a pixel there is left out.
 */
export const BUDGETS = [
	{ share: 1, floor: 0, px: 0 },
	{ share: 0.3, floor: 1000, px: 2 },
	{ share: 0.08, floor: 300, px: 2 }
];
export const STRETCH = 4;

/**
 * The most triangles level L may have, for a kind whose finest level has `tris` (not known, as for a plant whose
 * finest is built only once a copy is near: its ceiling alone).
 * @param {number} L @param {number} [tris] @param {number[]} [all] the thresholds of the levels (LEVELS)
 */
export function budgetOf(L, tris = Infinity, all = LEVELS) {
	if (L <= 0) return tris;
	const b = BUDGETS[Math.min(L, BUDGETS.length - 1)];
	const ceiling = Math.round((all[Math.min(L, all.length - 1)] * SCREEN) ** 2);
	return Math.min(ceiling, Math.max(b.floor, Math.ceil(b.share * tris)));
}

/** how far level L of a thing of `radius` may stray from its finest shape (m) @param {number} L @param {number} radius @param {number[]} [all] */
export const errorOf = (L, radius, all = LEVELS) => (L <= 0 ? 0 : (BUDGETS[Math.min(L, BUDGETS.length - 1)].px * 2 * radius) / (all[L - 1] * SCREEN));

/** the smallest part level L of a thing of `radius` draws (its ball's diameter, m): a pixel where it is drawn biggest */
export const smallestOf = (L, radius, all = LEVELS) => (L <= 0 ? 0 : (2 * radius) / (all[L - 1] * SCREEN));

/**
 * How big a thing looks: its ball's diameter as a share of the view's height.
 * @param {number} radius @param {number} distance @param {number} tanHalf tan of half the camera's vertical field of view
 */
export const sizeOn = (radius, distance, tanHalf) => radius / (Math.max(distance, 1e-3) * tanHalf);

/**
 * The thresholds of a kind with `levels` levels of its shape: the coarsest ones of LEVELS, as many as it has; the last
 * (where its picture takes over) lower for a light coarsest shape (`tris` triangles), see HEAVY.
 * @param {number} levels @param {number} [tris] @param {number[]} [all]
 */
export function thresholdsOf(levels, tris = HEAVY, all = LEVELS) {
	const out = all.slice(Math.max(0, all.length - levels));
	const last = out.length - 1;
	if (last >= 0) out[last] = Math.max(PICTURE, Math.min(out[last], out[last] * Math.sqrt(Math.max(0, tris) / HEAVY)));
	return out;
}

/** the level a size calls for: the first whose threshold it reaches; past the last, the picture (its index = levels) */
export function levelAt(size, thresholds) {
	for (let i = 0; i < thresholds.length; i++) if (size >= thresholds[i]) return i;
	return thresholds.length;
}

/**
 * The level a thing is drawn at, and the coarser one fading in under it, if any.
 * @param {number} size how big it looks (`sizeOn`)
 * @param {number[]} thresholds its levels' (`thresholdsOf`)
 * @param {number} [was] the level it was drawn at last, to hold it there near a threshold
 * @returns {{ level: number, fade: number }} `fade` how much of the next coarser level shows under it, 0 for none
 */
export function choose(size, thresholds, was = -1) {
	let level = levelAt(size, thresholds);
	if (was >= 0 && level !== was) {
		// past the line by only a little: held where it was
		const held = levelAt(size * (level > was ? 1 + HOLD : 1 - HOLD), thresholds);
		if (held === was) level = was;
	}
	const t = thresholds[level];
	if (t === undefined) return { level, fade: 0 };
	const top = t * (1 + BAND);
	return { level, fade: size < top ? Math.min(1, Math.max(0.001, (top - size) / (t * BAND))) : 0 };
}
