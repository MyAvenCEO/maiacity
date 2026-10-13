// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE WAYSIDE — what a newcomer to MaiaCity V1 meets first, on the dusty highway at the city's centre: the old rusty
 * travel van that brings them, the bus stop it drops them at, the abandoned gas station beside it, and the broken shed
 * at the village's centre where the Village COOP keeps its powercube. Each to its real measure, standing on the
 * ground at its origin, its front towards +z. Two places put them together: the MaiaCity centre (bus stop, gas
 * station, van) and the village store (the shed with its powercube, the solar row and the battery beside it).
 */
import * as THREE from 'three';
import { bar, part, shared, soft, std, v3 } from './parts';
import { batteryPack, powercube, solarPanel } from './village.js';

export const WAYSIDE_INFO = {
	van: { name: 'The travel van', note: 'an old minibus that has crossed a continent: 5.0 × 1.9 m, 2.3 m high, its blue paint sun-faded and rusting through, a sliding side door, a roof rack piled with bags, a sack of rice and a spare tyre' },
	busStop: { name: 'The bus stop', note: 'a bus stop on the dusty highway: a concrete slab, a rusty corrugated roof on two steel posts, a plank bench, a round sign on a pole and a faded timetable' },
	gasStation: { name: 'The old gas station', note: 'an abandoned gas station, 24 × 16 m: a faded canopy on four pillars with a panel missing, two old pumps, a kiosk with broken windows, a leaning sign with nothing on it, oil drums and cracked concrete' },
	shed: { name: 'The old shed', note: 'an old timber shed, 6 × 4 m, 2.8 m high: grey planks with gaps, half its corrugated roof gone, one door hanging. The Village COOP keeps its powercube here: the village centre’s future store' }
};

const m = {
	vanPaint: std('#5f8aa6', 0.75, { metalness: 0.15 }),
	vanCream: std('#e2d8bf', 0.8),
	rust: std('#8a4a26', 0.95),
	glass: shared(() => new THREE.MeshStandardMaterial({ color: '#27323a', roughness: 0.15, metalness: 0.4 })),
	tyre: std('#1f1f1f', 0.9),
	rim: std('#8d8f90', 0.5, { metalness: 0.6 }),
	trim: std('#2a2c2e', 0.7),
	light: std('#efe6c6', 0.4),
	tail: std('#8f2a20', 0.6),
	rack: std('#3b3b3b', 0.6, { metalness: 0.5 }),
	bagRed: std('#9c3b2f', 0.95),
	bagGreen: std('#4f6b3a', 0.95),
	bagBlue: std('#2f4f7a', 0.95),
	sack: std('#d8ccaa', 1),
	concrete: std('#b9b2a2', 0.95),
	crackedConcrete: std('#a39b8a', 1),
	corrugated: std('#8e6a4a', 0.85, { metalness: 0.3 }),
	steel: std('#6d6f70', 0.6, { metalness: 0.5 }),
	plank: std('#8a7a62', 0.95),
	greyPlank: std('#7d776b', 1),
	sign: std('#c8b88a', 0.8),
	signRed: std('#a8473a', 0.8),
	canopy: std('#d8d2c2', 0.8),
	canopyStripe: std('#b8574a', 0.8),
	pump: std('#c9a24a', 0.8),
	pumpFace: std('#3a3a36', 0.7),
	kiosk: std('#d9cfb8', 0.95),
	dark: std('#1d1d1b', 1),
	drum: std('#4a6a7a', 0.8, { metalness: 0.3 }),
	tumble: std('#a08b5c', 1),
	sand: std('#d6c39a', 1)
};

function wheel(g, x, z, r = 0.36) {
	const w = new THREE.Group();
	const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.22, 18), m.tyre());
	const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.23, 10), m.rim());
	tyre.castShadow = true;
	w.add(tyre, rim);
	w.rotation.z = Math.PI / 2;
	w.position.set(x, r, z);
	g.add(w);
}

/** The old rusty travel van: a minibus 5.0 × 1.9 m, 2.3 m high, faded blue over cream, rust through its sills and
 *  arches, a sliding side door, a roof rack piled with bags, a sack of rice and a spare tyre. */
export function travelVan() {
	const g = new THREE.Group();
	g.name = 'travel-van';
	for (const x of [-0.82, 0.82]) for (const z of [-1.55, 1.6]) wheel(g, x, z);
	soft(g, 1.9, 0.9, 4.9, 0.1, m.vanCream(), 0, 0.85, 0); // the lower body, cream
	soft(g, 1.88, 0.85, 4.6, 0.12, m.vanPaint(), 0, 1.7, -0.12); // the upper body, faded blue
	soft(g, 1.84, 0.5, 0.5, 0.15, m.vanPaint(), 0, 1.25, 2.3); // the short nose
	part(g, 1.86, 0.08, 4.5, m.vanPaint(), 0, 2.15, -0.12); // the roof
	// windows round, the windscreen raked
	for (const x of [-0.95, 0.95]) for (const z of [-1.6, -0.6, 0.4]) part(g, 0.02, 0.48, 0.8, m.glass(), x, 1.78, z);
	const screen = part(g, 1.7, 0.6, 0.04, m.glass(), 0, 1.72, 2.12);
	screen.rotation.x = -0.25;
	part(g, 1.86, 0.5, 0.02, m.glass(), 0, 1.78, -2.43); // the back window
	part(g, 0.02, 0.9, 1.1, m.trim(), 0.96, 1.25, 0.9); // the sliding door's line
	// rust: on the sills, round the arches, a patch on the side
	for (const x of [-0.96, 0.96]) {
		part(g, 0.02, 0.12, 4.6, m.rust(), x, 0.45, 0);
		for (const z of [-1.55, 1.6]) part(g, 0.03, 0.22, 0.85, m.rust(), x, 0.78, z);
		part(g, 0.02, 0.25, 0.5, m.rust(), x, 1.25, -0.9);
	}
	part(g, 1.92, 0.16, 0.2, m.trim(), 0, 0.5, 2.5); // bumpers
	part(g, 1.92, 0.16, 0.2, m.trim(), 0, 0.5, -2.5);
	for (const x of [-0.7, 0.7]) {
		part(g, 0.26, 0.18, 0.04, m.light(), x, 1.0, 2.52);
		part(g, 0.14, 0.3, 0.04, m.tail(), x * 1.15, 1.1, -2.47);
		part(g, 0.05, 0.16, 0.18, m.trim(), x * 1.42, 1.65, 1.95); // mirrors
	}
	// the roof rack and its load
	for (const x of [-0.85, 0.85]) bar(g, v3(x, 2.32, -2.1), v3(x, 2.32, 1.9), 0.025, m.rack());
	for (const z of [-2.1, -0.7, 0.6, 1.9]) bar(g, v3(-0.85, 2.32, z), v3(0.85, 2.32, z), 0.02, m.rack());
	part(g, 0.7, 0.4, 0.9, m.bagRed(), -0.4, 2.55, -1.3);
	part(g, 0.6, 0.35, 0.8, m.bagBlue(), 0.4, 2.52, -1.2);
	part(g, 0.8, 0.45, 0.7, m.bagGreen(), 0.25, 2.57, 0.1);
	soft(g, 0.6, 0.35, 0.9, 0.15, m.sack(), -0.4, 2.52, 0.2);
	const spare = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.11, 8, 16), m.tyre());
	spare.rotation.x = Math.PI / 2;
	spare.position.set(0, 2.45, 1.4);
	g.add(spare);
	return g;
}

/** A bus stop on the dusty highway: a concrete slab, a rusty corrugated roof on two steel posts, a plank bench, a
 *  round sign on a pole and a faded timetable. 4 × 2 m, 2.6 m high. */
export function busStop() {
	const g = new THREE.Group();
	g.name = 'bus-stop';
	part(g, 4.4, 0.15, 2.2, m.concrete(), 0, 0.075, 0);
	for (const x of [-1.8, 1.8]) bar(g, v3(x, 0.15, -0.8), v3(x, 2.5, -0.8), 0.05, m.steel());
	for (const x of [-1.8, 1.8]) bar(g, v3(x, 0.15, -0.8), v3(x, 2.3, 0.6), 0.03, m.steel()); // the braces
	const roof = part(g, 4.4, 0.05, 2.0, m.corrugated(), 0, 2.5, -0.1);
	roof.rotation.x = 0.12;
	for (let x = -2; x <= 2; x += 0.4) part(g, 0.04, 0.03, 2.0, m.rust(), x, 2.53, -0.1); // its ribs, rust in the folds
	part(g, 3.2, 0.06, 0.4, m.plank(), 0, 0.5, -0.5); // the bench
	for (const x of [-1.4, 1.4]) part(g, 0.08, 0.4, 0.35, m.steel(), x, 0.3, -0.5);
	part(g, 3.2, 0.3, 0.04, m.plank(), 0, 0.85, -0.72); // its back
	part(g, 0.8, 1.0, 0.03, m.sign(), 1.1, 1.5, -0.83); // the timetable, faded
	// the sign on its pole by the road
	bar(g, v3(2.6, 0, 0.9), v3(2.6, 2.6, 0.9), 0.04, m.steel());
	const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 20), m.signRed());
	disc.rotation.x = Math.PI / 2;
	disc.position.set(2.6, 2.6, 0.9);
	disc.castShadow = true;
	g.add(disc);
	const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.035, 20), m.sign());
	inner.rotation.x = Math.PI / 2;
	inner.position.set(2.6, 2.6, 0.9);
	g.add(inner);
	return g;
}

/** An abandoned gas station, 24 × 16 m: cracked concrete, a faded canopy on four pillars with a panel missing, two
 *  old pumps, a kiosk with broken windows and a dark door, a leaning sign pole with nothing left on it, oil drums,
 *  a tumbleweed. */
export function gasStation() {
	const g = new THREE.Group();
	g.name = 'gas-station';
	part(g, 24, 0.12, 16, m.crackedConcrete(), 0, 0.06, 0, false);
	for (const [x, z, w, d] of [[-6, 3, 7, 0.1], [2, -2, 0.1, 6], [7, 5, 5, 0.1]]) part(g, w, 0.02, d, m.dark(), x, 0.13, z, false); // cracks
	// the canopy over the pumps
	for (const x of [-4.5, 4.5]) for (const z of [1.5, 6.5]) part(g, 0.4, 4.6, 0.4, m.canopy(), x, 2.3, z);
	part(g, 11, 0.5, 7, m.canopy(), 0, 4.85, 4);
	part(g, 11.05, 0.25, 7.05, m.canopyStripe(), 0, 4.6, 4);
	part(g, 2.5, 0.06, 2.5, m.dark(), -2.8, 5.12, 2.8, false); // a panel gone
	// the pumps on their island
	part(g, 5, 0.25, 1.2, m.concrete(), 0, 0.25, 4);
	for (const x of [-1.4, 1.4]) {
		part(g, 0.7, 1.7, 0.5, m.pump(), x, 1.2, 4);
		part(g, 0.5, 0.45, 0.02, m.pumpFace(), x, 1.55, 4.26);
		bar(g, v3(x + 0.36, 1.2, 4), v3(x + 0.5, 0.4, 4.4), 0.03, m.dark()); // the hose, hanging
	}
	// the kiosk behind, its windows broken, its door dark
	part(g, 9, 3.2, 5, m.kiosk(), 0, 1.72, -4.5);
	part(g, 9.4, 0.25, 5.4, m.rust(), 0, 3.4, -4.5);
	for (const x of [-3, -1]) part(g, 1.6, 1.2, 0.04, m.dark(), x, 1.9, -1.98);
	part(g, 1.4, 0.4, 0.04, m.glass(), -3, 2.3, -1.97); // what is left of a pane
	part(g, 1.1, 2.1, 0.04, m.dark(), 2.2, 1.2, -1.98);
	// the sign pole, leaning, its face blank
	const pole = new THREE.Group();
	part(pole, 0.3, 7, 0.3, m.steel(), 0, 3.5, 0);
	part(pole, 2.6, 1.8, 0.25, m.sign(), 0, 7.2, 0);
	part(pole, 2.7, 0.2, 0.3, m.signRed(), 0, 6.25, 0);
	pole.position.set(9.5, 0, 6.5);
	pole.rotation.z = -0.08;
	g.add(pole);
	// oil drums, one on its side, and a tumbleweed
	for (const [x, z] of [[5.5, -2.5], [6.3, -2.2], [5.9, -1.5]]) {
		const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), m.drum());
		d.position.set(x, 0.57, z);
		d.castShadow = true;
		g.add(d);
	}
	const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), m.rust());
	fallen.rotation.z = Math.PI / 2;
	fallen.position.set(7.2, 0.42, -1.8);
	g.add(fallen);
	const weed = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), m.tumble());
	weed.position.set(-8, 0.5, 6);
	g.add(weed);
	return g;
}

/** An old timber shed, 6 × 4 m, 2.8 m high: grey planks with gaps, half its corrugated roof gone, one door hanging. */
export function oldShed() {
	const g = new THREE.Group();
	g.name = 'old-shed';
	part(g, 6.2, 0.1, 4.2, m.concrete(), 0, 0.05, 0, false);
	// corner posts and a ridge
	for (const x of [-3, 3]) for (const z of [-2, 2]) part(g, 0.14, 2.6, 0.14, m.greyPlank(), x, 1.3, z);
	part(g, 6.1, 0.14, 0.14, m.greyPlank(), 0, 2.8, 0);
	// plank walls with gaps: the back, the sides; the front has its door opening
	for (let x = -2.9; x <= 2.9; x += 0.32) part(g, 0.24, 2.4, 0.04, x % 1.3 < 0.2 ? m.plank() : m.greyPlank(), x, 1.25, -2);
	for (const sx of [-3, 3]) for (let z = -1.85; z <= 1.85; z += 0.32) if (Math.abs(z - 0.6 * sx) > 0.3) part(g, 0.04, 2.4, 0.24, m.greyPlank(), sx, 1.25, z);
	for (let x = -2.9; x <= 2.9; x += 0.32) if (Math.abs(x) > 1.1) part(g, 0.24, 2.4, 0.04, m.greyPlank(), x, 1.25, 2);
	// the door, hanging off one hinge
	const door = new THREE.Group();
	part(door, 1.0, 2.1, 0.05, m.plank(), 0.5, 1.05, 0);
	door.position.set(-1.05, 0.05, 2.05);
	door.rotation.set(0, -1.1, 0.12);
	g.add(door);
	// the roof: one slope whole, the other half gone, rust in its folds
	const a = part(g, 6.2, 0.04, 2.3, m.corrugated(), 0, 2.45, -1.0);
	a.rotation.x = -0.32;
	const b = part(g, 3.0, 0.04, 2.3, m.rust(), -1.6, 2.45, 1.0);
	b.rotation.x = 0.32;
	bar(g, v3(0.2, 2.75, 0.3), v3(2.9, 2.2, 1.9), 0.04, m.greyPlank()); // a bare rafter where the rest fell
	return g;
}

/** A place: the MaiaCity centre as the newcomer finds it, where the dusty highway ends: the road comes in from the
 *  west (−x) and stops at this place's origin, the abandoned gas station's forecourt facing its end, the bus stop on
 *  its south side, the old travel van pulled up at it, its side door to the stop. About 70 × 30 m. */
export function maiaCentre({ withVan = true, withRoad = true } = {}) {
	const g = new THREE.Group();
	g.name = 'maia-centre';
	const road = new THREE.Mesh(new THREE.PlaneGeometry(60, 7), m.sand());
	road.rotation.x = -Math.PI / 2;
	road.position.set(-30, 0.02, 0);
	road.receiveShadow = true;
	if (withRoad) g.add(road);
	const stop = busStop();
	stop.position.set(-14, 0, -6.5);
	const station = gasStation();
	station.position.set(10, 0, 0);
	station.rotation.y = -Math.PI / 2; // its canopy and pumps to the road's end
	g.add(stop, station);
	if (withVan) {
		const van = travelVan();
		van.position.set(-14, 0, -1.8);
		van.rotation.y = Math.PI / 2;
		g.add(van);
	}
	return g;
}

/** A place: the village store, the village centre's future storage area: the broken shed with the powercube inside,
 *  and beside it the solar row and the big battery that still stand there. About 30 × 20 m. */
export function villageStore({ withPowercube = true } = {}) {
	const g = new THREE.Group();
	g.name = 'village-store';
	const shed = oldShed();
	g.add(shed);
	if (withPowercube) {
		const cube = powercube();
		cube.position.set(0.6, 0.1, -0.4);
		g.add(cube);
	}
	const solar = solarPanel();
	solar.scale.set(6, 2, 2);
	solar.position.set(0, 0, -9);
	solar.rotation.y = Math.PI;
	const battery = batteryPack();
	battery.position.set(7, 0, -2);
	g.add(solar, battery);
	return g;
}
