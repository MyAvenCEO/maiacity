/**
 * THE BIOMES — how each kind of card is painted and how tall it stands.
 *
 * The world's palette is not the HUD's. The overlay wears the brand's muted
 * earth; the world below it is painted after Soundfall: saturated teal
 * water, foam-white shallows, cream sand, soft green grass, a deep forest
 * green with red fruit in the canopies, and snow at the poles. Every value
 * is data here so a biome is a row, not a branch.
 */
import type { Biome } from '../../../../game/globe'

export type BiomePaint = {
	/** Three shades: light, mid, dark — chosen by the card's value. */
	shades: [string, string, string]
	/** How far above (or below) the sea level the card's top sits. */
	lift: number
	/** How many trees a card grows, on average. */
	trees: number
}

export const BIOMES: Record<Biome, BiomePaint> = {
	/* The sea's three shades are a ramp by depth: shelf, deep, trench. */
	sea: { shades: ['#4fc1c8', '#2a93a8', '#154e6b'], lift: -0.6, trees: 0 },
	shallow: { shades: ['#a9e6e6', '#7fd6db', '#5cc7d1'], lift: -0.35, trees: 0 },
	/* Pack ice: sea, but white with a cold blue in it, and it sits on the water. */
	ice: { shades: ['#f4f9fc', '#e3eef5', '#cfe0ec'], lift: -0.3, trees: 0 },
	sand: { shades: ['#f2d9a4', '#e9c98c', '#dcb87a'], lift: 0.05, trees: 0 },
	earth: { shades: ['#d2bf9c', '#bfa780', '#a89066'], lift: 0.1, trees: 0.06 },
	grass: { shades: ['#a9d98a', '#8fc773', '#79b45f'], lift: 0.12, trees: 0.4 },
	forest: { shades: ['#6fae6a', '#4f9459', '#3d7d4a'], lift: 0.2, trees: 2.4 },
	taiga: { shades: ['#5f9a7e', '#43816a', '#336655'], lift: 0.22, trees: 2.0 },
	mountain: { shades: ['#bdb5a8', '#9e968a', '#7f776c'], lift: 0.6, trees: 0.5 },
	snow: { shades: ['#fbfdff', '#eef4f9', '#d9e6f0'], lift: 0.28, trees: 0 }
}

/** The trees: a chunky trunk, a round canopy, and sometimes red fruit. */
export const TREE = {
	trunk: '#8b5e3c',
	canopy: ['#3f8f5a', '#5aa66a', '#2f7a4c'],
	fruit: '#e0524a',
	/** Height of a trunk and radius of a canopy, in world units. */
	trunkHeight: 0.55,
	canopyRadius: 0.42,
	/** The share of trees that carry fruit. */
	fruited: 0.35
}
