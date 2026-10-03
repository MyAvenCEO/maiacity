/*
 * THE BACKYARD'S PLAN — where everything is, in one place: the measures every other file of the world builds from.
 * Rough, not surveyed: laid out from seventeen photos, the things in it to their real measure.
 *
 * Axes: x east, z south, y up, in metres; the origin on the ground at the middle of the old workshop's front (the
 * annex), under the pergola's roof. North is −z: the house and the workshop face south, into the sun.
 *
 *   the house      the courtyard's north side: four storeys of apricot render, its face at z −1.2 from the west wall
 *                  (x −15) to x −0.6; on its ground floor from the west, the small window, the front door under its
 *                  canopy, the old workshop's steel window and its brown double door;
 *   the workshop   (the annex) a single storey of saffron render built out in front of the house's east end, x −2.6…3.2,
 *                  its face at z 0: the big steel window, 13 × 9 panes, a studio behind it;
 *   the terrace    under the pergola in front of it, x −3.3…5.4, z 0…4.0: flagstones, the leather sofa, the bistro set in
 *                  the corner behind the workshop's east end (to z −1.3), planters, the olive tree, lanterns;
 *   the east side  the neighbour's wall, saffron to 1.72 m and polycarbonate over it, along the terrace's back and east;
 *   the garden     the north-west corner: gravel, the teak table and its chairs, beds and hedges, the trees;
 *   the shed       on the south side, x −13…−6.2, its long wall facing the courtyard: the lilac, the rain barrel, the
 *                  insect hotel; the gate under its glass canopy west of it, the driveway out to the street east of it.
 */

/** x0, x1, z0, z1 */
export type Rect = [number, number, number, number];

export const HOUSE = { x0: -15, x1: -0.6, z: -1.2, back: -12, floors: [3.4, 3.0, 3.0], eaves: 9.4, ridge: 13.2 } as const;
/** the house's ground floor, from the west: its openings along x, their sills (0 a door) and tops */
export const HOUSE_GROUND = {
	smallWindow: { x0: -11.9, x1: -10.9, sill: 0.95, top: 2.35 },
	frontDoor: { x0: -10.1, x1: -8.8, sill: 0, top: 2.75 },
	steelWindow: { x0: -7.6, x1: -5.4, sill: 1.0, top: 2.6 },
	workshopDoor: { x0: -5.3, x1: -3.5, sill: 0, top: 2.62 }
} as const;
/** the upper floors' window axes (x) and their size */
export const HOUSE_AXES = [-13.4, -11.4, -9.45, -6.5, -4.4, -1.85] as const;
export const UPPER_WINDOW = { w: 1.05, h: 1.45, sill: 0.9 } as const;

export const ANNEX = { x0: -2.6, x1: 3.2, z: 0, back: -7.5, h: 3.55, wall: 0.32 } as const;
/** the big steel window in the workshop's front */
export const BIG_WINDOW = { x0: -1.8, x1: 2.1, sill: 0.95, top: 3.2, cols: 13, rows: 9 } as const;

export const TERRACE = { x0: -3.3, x1: 5.4, z0: 0, z1: 4.0 } as const;
/** the corner behind the workshop's east end, the bistro set in it */
export const INSET = { x0: 3.2, x1: 5.4, z0: -1.3, z1: 0 } as const;
/** the pergola's roof: its edges, its height at the back (the workshop's front) and at the front (the gutter) */
export const ROOF = { x0: -4.0, x1: 5.36, z0: 0, z1: 4.2, back: 3.77, front: 3.42 } as const;
/** the roof's height over z (it falls to the front) */
export const roofAt = (z: number) => ROOF.back + ((ROOF.front - ROOF.back) * z) / ROOF.z1;
/** the neighbour's wall: saffron to `low`, a timber ledge on it, polycarbonate over it to `high` */
export const EAST = { x: 5.4, z0: -1.3, z1: 4.6, low: 1.72, high: 4.5 } as const;
/** the steel: the diagonal strut from the roof's west edge down to the workshop's corner, the fat column and the slim one */
export const STRUT = { top: [-4.0, 3.08, 2.45], foot: [-2.8, 0, 0.32] } as const;
export const COLUMN = { x: 4.9, z: 1.6, collar: 2.3 } as const;
export const SLIM = { x: 5.12, z: -1.05 } as const;
/** the timber frame's posts: [foot x, foot z, top x] (the west ones lean out) */
export const POSTS = [[-3.3, 4.0, -3.9], [0.4, 4.0, 0.4], [4.15, 4.0, 4.15], [-3.3, 1.25, -3.9]] as const;

export const WEST_WALL = { x: -15, z0: -1.2, z1: 10.6, h: 3.0 } as const;
export const SHED = { x0: -13, x1: -6.2, z0: 10.6, z1: 13.8, eaves: 2.75, top: 3.25 } as const;
export const DRIVE = { x0: -6.2, x1: -3.0, z0: 10.4, z1: 17.4 } as const;
export const SOUTH_WALL = { z: 10.4, x0: -3.0, x1: 5.4, h: 3.0 } as const;
/** the gate between the shed and the west wall, under its glass canopy */
export const GATE = { x0: -15, x1: -13, z: 10.6, canopy: 8.9 } as const;

/** the garden corner: the gravel's outline, the beds' rectangles */
export const GRAVEL: [number, number][] = [[-14.1, 0.45], [-12.2, 0.45], [-11.25, 0.85], [-10.7, 1.7], [-10.55, 2.9], [-10.75, 4.3], [-11.5, 5.35], [-12.6, 5.75], [-14.1, 5.8]];
export const BEDS: Record<string, Rect> = {
	house: [-15, -10.45, -1.2, -0.3], // the hedge along the house, the maple
	west: [-15, -14.1, -0.3, 6.25], // under the west wall: the privet, the corkscrew willow, rhododendrons
	south: [-15, -11.0, 6.25, 10.6], // the ivy cone, honeysuckle
	shed: [-13, -6.2, 9.25, 10.6] // along the shed: the lilac, the barrel, the sapling
};

/** the garden table, its long axis along z */
export const TABLE = { x: -12.45, z: 2.9 } as const;
/** where one may walk */
export const COURT: Rect = [-15, 5.4, -1.2, 10.4];
