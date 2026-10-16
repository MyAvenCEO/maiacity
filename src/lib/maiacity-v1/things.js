// @ts-nocheck — plain JS, kept loose on purpose
/*
 * MAIACITY V1'S THINGS — every asset of the library the world draws, by its ref at the version it stands at (built in
 * the asset box, drawn by the universal renderer or put in the scene as the box built it: ./drawn.js), never by calling
 * a builder; and the measures the world lays its story out by.
 *
 * A measure is a number an asset's builder decides (where the pickup's tailgate hangs, how long the ramp runs, where
 * the bell tent's fire place stands): the world needs them before anything is built, to lay out where a machine rolls
 * up the ramp or where the newcomer kneels to pitch the tent. So they are written down here, and ./things.test.js holds
 * each to what its builder hands back (and to the build's own nodes), as Sandbox 2's walk is held (#790).
 */

/** the library's assets the world puts in, at the version each stands at */
export const THINGS = {
	busStop: 'buildings/bus-stop@1',
	gasStation: 'buildings/gas-station@1',
	shed: 'buildings/old-shed@1',
	solar: 'things/solar-panel@1',
	ramp: 'things/loading-ramp@1',
	battery: 'machines/batterycube@10',
	cube: 'machines/electrocube@2',
	pickup: 'things/pickup@3',
	tent: 'things/bell-tent@1',
	fire: 'things/fire-place@1',
	bag: 'things/bell-tent-bag@1',
	pack: 'things/backpack@2',
	stake: 'things/plant-stake@2',
	earth: 'things/dug-earth@1',
	van: 'things/travel-van@1'
};

/** the MaiaCity centre (the library's maia-centre without its van and its road): the bus stop and the gas station
 *  where it stands them, in its own ground (x, z, and the turn about the upright) */
export const CENTRE_AT = {
	busStop: { x: -14, z: -6.5, turn: 0 },
	gasStation: { x: 10, z: 0, turn: -Math.PI / 2 }
};

/** the pickup (things/pickup@3), in its own frame (+z its front, +x its left): where its tailgate's hinge is along
 *  it and how long the tailgate is (let down flat, it reaches out behind by that); the driver's and the passenger's
 *  hips on their seats */
export const PICKUP = {
	tailgate: -2.62,
	gate: 0.44,
	driver: { x: 0.42, y: 0.84, z: 0.62 },
	passenger: { x: -0.42, y: 0.84, z: 0.62 }
};

/** the loading ramp (things/loading-ramp@1): how high its lip rises and how far its foot runs out from it */
export const RAMP = { rise: 1.16, run: 2 };

/** the bell tent (things/bell-tent@1): its radius at the ground, how far its guy pegs stand out from it, the stretch
 *  of its pitch (0 … 1) each step takes, and where its fire place stands in front of it (the tent's own frame) */
export const BELL_TENT = {
	R: 2.1,
	guyOut: 1.5,
	steps: { groundsheet: [0, 0.12], canvas: [0.12, 0.2], pole: [0.2, 0.42], wall: [0.42, 0.56], guys: [0.56, 0.78], door: [0.78, 0.86], inside: [0.86, 1] },
	fire: { x: 1.2, z: 4.2 }
};

/** what of the bell tent pitched stands in a walker's way (its wall's radius at the ground, the door's half width, the
 *  headroom at the wall's foot, and the pole and the things inside as circles), and of its fire place */
export const TENT_WALK = {
	r: 2.1,
	door: 0.55,
	headroom: 1.2985346840701377,
	colliders: [
		{ x: 0, z: 0, r: 0.2 },
		{ x: 0.95, z: 0.45, r: 0.35 },
		{ x: -1.3, z: 0.1, r: 0.28 },
		{ x: -1.25, z: 0.55, r: 0.28 }
	]
};
export const FIRE_WALK = {
	colliders: [
		{ x: 0, z: 0, r: 0.75 },
		{ x: -1.2, z: 0.6, r: 0.4 },
		{ x: 0.9, z: 1.1, r: 0.4 },
		{ x: -1.55, z: -0.2, r: 0.45 }
	]
};

/** the bell tent's lantern, the build's own light, which the world turns up as the dusk goes: where it hangs (in its
 *  part `lantern`, the path of children down to it); and the canvas's glow by day (its material's emissive, which the
 *  world turns warm at night: how it finds that material) */
export const TENT_LAMP = { part: 'lantern', path: [0, 2] };
export const TENT_CLOTH = { emissive: 0x5a4c34 };

/** the tent's bag (things/bell-tent-bag@1): what was in it, the last of its build's own parts, in this order */
export const BAG_PARTS = ['canvas', 'groundsheet', 'pole', 'wallPoles', 'pegs'];

/** the fire place (things/fire-place@1): the stretch of its build (0 … 1) its fire catches over, the last: built that
 *  far it burns as much as the ease of how far into it it is */
export const FIRE_CATCHES = [0.86, 1];

/** where the work is as the bell tent is pitched to k (its frame): the groundsheet's edge, a sheet peg, the canvas, the
 *  pole's foot, a wall pole or peg going in, a guy's peg, the door, a thing being put down. Its builder's `work`, read
 *  off its places: the pegs and guys each at its turn round the ring (the n-th of `of` round, the door's left out) */
const round = (of, r, from, to) => Array.from({ length: to - from + 1 }, (_, j) => (((from + j + 0.5) / of) * Math.PI * 2)).map((a) => ({ a, x: Math.sin(a) * r, z: Math.cos(a) * r }));
export const TENT_WORK = {
	sheetPegs: round(14, BELL_TENT.R + 0.03, 1, 12),
	wallPegs: round(22, BELL_TENT.R + 0.04, 1, 20),
	guys: round(12, 1, 1, 10).map((p) => p.a),
	spots: [[0, 0.55], [0, -0.6], [0, -0.6], [0, -1.2], [0.75, 0.6], [0.75, 0.6], [0.75, 0.6], [-0.9, 0.3], [0.3, 0.3]]
};
export function tentWork(k) {
	const { R, guyOut, steps } = BELL_TENT, { sheetPegs, wallPegs, guys, spots } = TENT_WORK;
	const clamp = (x) => Math.min(1, Math.max(0, x)), ease = (x) => x * x * (3 - 2 * x);
	const span = (x, [a, b]) => clamp((x - a) / (b - a));
	const at = (x, z) => ({ x, y: 0, z }), ring = (a, r) => at(Math.sin(a) * r, Math.cos(a) * r);
	const nth = (list, f) => list[Math.min(list.length - 1, Math.floor(f * list.length))];
	k = clamp(k);
	if (k <= steps.groundsheet[1]) {
		const gs = span(k, steps.groundsheet);
		if (gs < 0.7) return at(0, R - 2 * R * ease(clamp((gs - 0.35) / 0.35)));
		const p = nth(sheetPegs, clamp((gs - 0.7) / 0.3));
		return at(p.x, p.z);
	}
	if (k <= steps.canvas[1]) return at(0, R * 0.6 * (1 - span(k, steps.canvas)));
	if (k <= steps.pole[1]) return at(0, 0);
	if (k <= steps.wall[1]) {
		const ws = span(k, steps.wall);
		if (ws < 0.6) return ring(nth(guys, ws / 0.6), R + 0.3);
		const p = nth(wallPegs, (ws - 0.6) / 0.4);
		return at(p.x, p.z);
	}
	if (k <= steps.guys[1]) return ring(nth(guys, span(k, steps.guys)), R + guyOut - 0.3);
	if (k <= steps.door[1]) return at(0, R + 0.4);
	const [x, z] = nth(spots, span(k, steps.inside));
	return at(x, z);
}

/** a tree's plant stake, its flag printed with the tree's name and its plant (things/plant-stake@2) */
export const stakeRef = (name, seed) => `${THINGS.stake}?${new URLSearchParams({ name, seed })}`;
/** the stake's flag (the cloth on its wire, shown once a seed is picked): the path of children down to it */
export const STAKE_FLAG = { path: [14] };

/** the open backpack (things/backpack@2): the seeds' packets in it, each its node `seed-packet:<id>` (its bottle is
 *  `water-bottle`, its cap `cap`, what is in it `inside`), and where the bottle pours from, up its own upright */
export const PACK_PACKETS = ['apple', 'pear', 'cherry', 'plum', 'apricot', 'quince', 'mulberry', 'walnut', 'chestnut', 'hazel'];
export const BOTTLE_MOUTH = 0.268;

/** the people: the rigged stand-in (actors/stand-in@11), built with how tall they are and their look (./van.js PEOPLE,
 *  the players in their seat's colours), its moves played from the tables the box wrote down ($lib/assets/clips.js) */
export const STAND_IN = 'actors/stand-in@11';
/** a person's ref: their height (m) and what of their look is not the stand-in's, by name, in a steady order */
export const standInRef = (height, look = {}) =>
	`${STAND_IN}?${new URLSearchParams(Object.entries({ height, ...look }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, String(v)]))}`;
/** the stand-in's walk comes round every 1.05 s of its clip: played within one round of it, so its tables (written over
 *  32 s, their end blended into their start) are never read across that seam */
export const WALK_CYCLE = 1.05;
