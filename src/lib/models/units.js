// @ts-nocheck — plain JS
/*
 * ONE MEASURE FOR EVERY ASSET AND EVERY WORLD (Samuel 2026-10-13): one scene unit is one metre. Every model is built
 * at its real size and placed without scaling; distances on a map and speeds on a road are metres and metres a
 * second. Write a size as 1.8 * M, 686 * MM or 35 * KMH so the measure reads in the code, and list a new asset in
 * REAL_SIZES so the size test (sizes.test.js) holds it to the real thing.
 */

/** a metre, a centimetre, a millimetre, a kilometre: in scene units */
export const M = 1;
export const CM = 0.01;
export const MM = 0.001;
export const KM = 1000;
/** a kilometre an hour, in metres a second */
export const KMH = 1000 / 3600;

/** how fast things move, at real speeds */
export const SPEED = {
	walk: 5 * KMH,
	track: 30 * KMH, // the pickup on a narrow offroad track with ruts
	highway: 80 * KMH // the old van on the sand highway
};

/** the real outer size of each asset, width (x) × height (y) × length (z), in metres, as its model must measure */
export const REAL_SIZES = {
	pickup: { size: [1.86, 1.82, 5.33], what: 'a double-cab pickup' },
	powerCube: { size: [0.74, 0.75, 0.76], what: 'Open Source Ecology’s Power Cube VII, a 27" (0.69 m) frame, its couplers, caps and handles out of it (actors/powercube.js)' },
	electroCube: { size: [0.74, 0.75, 0.76], what: 'our ElectroCube: the Power Cube’s 27" frame and size, a flat axial-flux generator in it (actors/electrocube.js)' },
	batteryCube: { size: [0.73, 0.75, 0.76], what: 'our BatteryCube: the Power Cube’s 27" frame, four BatteryPacks and an inverter in it (actors/batterycube.js)' },
	batteryPack: { size: [0.47, 0.13, 0.52], what: 'our BatteryPack: a 460 × 480 × 125 mm rack module, its handles and terminals out of its face (actors/batterypack.js)' },
	genset: { size: [2.3, 2.83, 2.3], what: 'a 60 kVA silenced diesel genset (the Assets’ powercube v1)' },
	solarPanel: { size: [1.72, 1.08, 1.4], what: 'one 410 W panel on its 30° ground rack, ballast blocks and cable' },
	batteryCabinet: { size: [1.6, 2.51, 1.6], what: 'a 230 kWh outdoor battery cabinet on its plinth, its cable out the back' },
	travelVan: { size: [1.95, 2.8, 5.0], what: 'an old travel van, bags tied on its roof' },
	busStop: { size: [5, 2.9, 2.2], what: 'a bus shelter with its sign' },
	gasStation: { size: [24, 8.2, 16], what: 'a forecourt with its canopy and price sign' },
	oldShed: { size: [6.2, 2.9, 5], what: 'a small half-roofed shed' },
	person: { size: [0.52, 1.8, 0.55], what: 'a grown-up, backpack and all (the heart over them not counted)' },
	tent: { size: [7.11, 3.16, 6.16], what: 'the MaiaCity V1 tent: the bell tent pitched (bellTent), 4.2 m across at its wall, its guy pegs 1.5 m out' },
	domeTent: { size: [5.6, 2.24, 5.6], what: 'the dome tent pitched: 4 m across and 2 m high, its cover 3 cm out over the tubes, on its 5.6 m deck 15 cm high' },
	tentBag: { size: [0.9, 0.41, 0.41], what: 'the dome tent rolled up in its bag, its straps buckled' },
	storageTent: { size: [11.2, 4.28, 11.2], what: 'the storage tent pitched: the dome tent twice the size, 8 m across and 4 m high, its cover 6 cm out over the tubes, on its 11.2 m deck 15 cm high' },
	storageTentBag: { size: [1, 0.71, 0.71], what: 'the storage tent rolled up in its bag, its straps buckled' },
	bellTent: { size: [7.11, 3.16, 6.16], what: 'the bell tent pitched: 4.2 m across at its wall, the pole’s spike at 3.15 m, its guy pegs 1.5 m out from the wall (none in front of the door)' },
	firePlace: { size: [3.08, 1.08, 2.28], what: 'the fire place: its ring of stones 1.2 m across, the woodpile beside it, two camp chairs facing it, the flames' },
	bellTentBag: { size: [1.1, 0.51, 0.51], what: 'the bell tent rolled up in its bag, its straps buckled' },
	loadingRamp: { size: [0.96, 1.27, 2.18], what: 'a folding aluminium loading ramp, 0.86 m between its rails, up to the bed at 1.16 m over 2 m, its rails 10 cm over its deck' },
	backpack: { size: [0.48, 0.63, 0.48], what: 'a 35 l hiker’s pack, open, its lid thrown back, its hip belt’s wings out, a bottle and seed packets in it' },
	waterBottle: { size: [0.077, 0.3, 0.077], what: 'a 1 l refillable bottle with its cap' },
	seedPacket: { size: [0.07, 0.1, 0.005], what: 'a 7 × 10 cm seed packet' },
	markerSticks: { size: [0.54, 0.35, 0.04], what: 'two 35 cm marker sticks (5 cm of it in the ground), half a metre apart, leaning a little' },
	plantStake: { size: [0.14, 1.13, 0.04], what: 'a 1 m plant stake, its 10 × 7 cm name flag on a wire past its top' },
	dugEarth: { size: [0.64, 0.09, 0.64], what: 'a patch of dug earth about 60 cm across, its hollow 3 cm down, clods on it' }
};
