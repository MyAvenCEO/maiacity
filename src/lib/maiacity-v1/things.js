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
	stake: 'things/plant-stake@1',
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

/** the bell tent's lantern, a light the box hands over as a plain node (the world hangs its own light there, set as the
 *  dusk goes: engine 5 will carry lights): where it hangs (in its part `lantern`, the path of children down to it), its
 *  colour, reach and fall-off; and the canvas's glow by day (its material's emissive, which the world turns warm at
 *  night: how it finds that material) */
export const TENT_LAMP = { part: 'lantern', path: [0, 2], color: 0xffcf8a, distance: 5, decay: 1.6 };
export const TENT_CLOTH = { emissive: 0x5a4c34 };

/** the fire place (things/fire-place@1): its light, a plain node in the build (in its part `flames`, by that path), its
 *  colour, reach and fall-off; its flames' and embers' materials (by their glow) and how far each goes lit; and the
 *  stretch of its build (0 … 1) its fire catches over, the last: built that far it burns as much as `lit` asks */
export const FIRE = {
	light: { part: 'flames', path: [0, 3], color: 0xff9a4a, distance: 7, decay: 1.8 },
	flame: { emissive: 0xff7a1a, opacity: 0.85 },
	embers: { emissive: 0xff4a12, glow: 0.9 },
	catches: [0.86, 1]
};
