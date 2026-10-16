// @ts-nocheck — plain JS
/*
 * HOW FINELY TO DRAW A THING — chosen by how big it looks, never by how far off it is, so one rule fits a cup and a
 * tree: its size on the screen (the ball that holds it, as a share of the view's height). An asset has up to three
 * levels of its shape (its recipe at a lower `detail`, phase 5 for every asset) and, smallest, its picture
 * (./impostors.js). Each level is drawn while the thing looks at least as big as its threshold; a coarser one fades in
 * under it (the dither of ./presets.js) over the last stretch before, so when it takes over it is already there.
 *
 * The thresholds are the ones Sandbox 4's forest draws its trees by (src/lib/sandbox-2/interior/flora.js: fine to
 * 16 m, coarse to 40 m, a picture beyond, for a tree 12 m across), as shares of the view, so every asset gets the same.
 */

/** the sizes on screen down to which each level of a shape is drawn, finest first; smaller than the last, its picture */
export const LEVELS = [2.4, 1.2, 0.45];
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
