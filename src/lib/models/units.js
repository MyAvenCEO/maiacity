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
	powercube: { size: [1.45, 1.15, 0.8], what: 'a 20 kVA silenced diesel generator on its skid' },
	solarPanel: { size: [1.72, 1.08, 1.4], what: 'one 410 W panel on its 30° ground rack, ballast blocks and cable' },
	batteryPack: { size: [1.6, 2.51, 1.6], what: 'a 230 kWh outdoor battery cabinet on its plinth, its cable out the back' },
	travelVan: { size: [1.95, 2.8, 5.0], what: 'an old travel van, bags tied on its roof' },
	busStop: { size: [5, 2.9, 2.2], what: 'a bus shelter with its sign' },
	gasStation: { size: [24, 8.2, 16], what: 'a forecourt with its canopy and price sign' },
	oldShed: { size: [6.2, 2.9, 5], what: 'a small half-roofed shed' },
	person: { size: [0.52, 1.8, 0.66], what: 'a grown-up, backpack and all (the heart over them not counted)' },
	tent: { size: [5.6, 2.1, 5.6], what: 'a 4 m geodesic dome tent on its 5.6 m deck' }
};
