// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE VILLAGE COOP'S MACHINES — what the Village COOP owns in MaiaCity V1 (game/maiacity-v1/engine.js, COOPS.village):
 * the pickup, the powercube (Open Source Ecology's Power Cube, ../actors/powercube.js; the diesel genset below is its
 * first model, kept for the Assets' history), a solar panel on its ground rack and a big
 * battery pack. Each to its real measure, standing on the ground at its origin, its front towards +z (the solar
 * panel's face, too).
 */
import * as THREE from 'three';
import { bar, part, shared, soft, std, v3 } from './parts';
import { pvPanel } from './containers.js';

/** What each machine is, by the engine's asset id (COOPS.village): the Assets viewer's note, and the facts the game's asset card lists. */
export const VILLAGE_INFO = {
	pickup: {
		model: 'pickup',
		note: 'a double-cab pickup, 5.33 × 1.86 m, 1.82 m high, a 3.1 m wheelbase: four doors, an open 1.55 m bed with a tool box and a jerrycan in it',
		specs: [['Size', '5.33 × 1.86 × 1.82 m'], ['Seats', '5, a double cab'], ['Payload', 'about 1 t'], ['Bed', '1.55 × 1.52 m, open'], ['Fuel', 'diesel, about 9 l per 100 km'], ['Weight', 'about 2.1 t']]
	},
	powercube: {
		model: 'powercube',
		note: 'Open Source Ecology’s Power Cube VII / 7s, the open-source heart of their Global Village Construction Set: a 28 hp V-twin on a hydraulic gear pump in a 27-inch (0.69 m) steel cube of about 181 kg, with its tanks, cooler and two quick couplers. It is a hydraulic power unit, not an electric generator: it couples to the LifeTrac, the brick press or any machine of the village and gives it its strength',
		specs: [['Size', '0.69 × 0.66 × 0.69 m (27")'], ['Engine', '28 hp (20.9 kW) petrol V-twin'], ['Hydraulics', '15.2 gpm at 3,000 psi'], ['Tanks', '7 gal fuel, 7 gal oil'], ['Weight', 'about 181 kg'], ['Design', 'Open Source Ecology, open hardware']]
	},
	solar: {
		model: 'solar-panel',
		note: 'one 1.72 × 1.13 m monocrystalline panel, about 410 W, on a galvanised ground rack tilted 30° to the sun, on ballast blocks',
		specs: [['Size', '1.72 × 1.13 m'], ['Peak power', 'about 410 W'], ['Cells', '60 monocrystalline'], ['Tilt', '30°, facing the sun'], ['Yield', 'about 1.4 kWh on a sunny day'], ['Weight', 'about 21 kg, on 4 ballast blocks']]
	},
	battery: {
		model: 'battery-pack',
		note: 'an outdoor lithium iron phosphate cabinet, 1.3 × 1.1 m, 2.3 m high, about 230 kWh: two doors, vents, its status lights and screen, on a concrete plinth',
		specs: [['Size', '1.3 × 1.1 × 2.3 m'], ['Capacity', 'about 230 kWh'], ['Chemistry', 'lithium iron phosphate (LFP)'], ['Power', 'about 100 kW in or out'], ['Cycles', 'about 6,000'], ['Weight', 'about 2.5 t']]
	}
};

const m = {
	paint: shared(() => new THREE.MeshStandardMaterial({ color: '#3d6a8f', roughness: 0.35, metalness: 0.35 })),
	glass: shared(() => new THREE.MeshStandardMaterial({ color: '#1c2630', roughness: 0.08, metalness: 0.5 })),
	tyre: std('#1f1f1f', 0.9),
	rim: std('#9a9ea2', 0.35, { metalness: 0.8 }),
	trim: std('#2a2c2e', 0.6),
	light: shared(() => new THREE.MeshStandardMaterial({ color: '#f4f1e2', emissive: '#f4ecc8', emissiveIntensity: 0.5 })),
	tail: shared(() => new THREE.MeshStandardMaterial({ color: '#b3261e', emissive: '#7a140f', emissiveIntensity: 0.4 })),
	bedliner: std('#2b2b2b', 0.95),
	jerry: std('#3f5a2a', 0.6),
	box: std('#b6b8b8', 0.35, { metalness: 0.75 }),
	genset: std('#d9a332', 0.5, { metalness: 0.2 }),
	skid: std('#3a3c3e', 0.55, { metalness: 0.4 }),
	louvre: std('#2d2f31', 0.7),
	steel: std('#8b8f92', 0.4, { metalness: 0.7 }),
	screen: shared(() => new THREE.MeshStandardMaterial({ color: '#16303a', emissive: '#2c7f8f', emissiveIntensity: 0.6 })),
	galv: std('#aeb3b5', 0.45, { metalness: 0.4 }),
	concrete: std('#b9b5ab', 0.95),
	cabinet: std('#ecebe6', 0.45, { metalness: 0.1 }),
	ok: shared(() => new THREE.MeshStandardMaterial({ color: '#3fbf6a', emissive: '#3fbf6a', emissiveIntensity: 0.9 })),
	warn: std('#f2c230', 0.5),
	cable: std('#161616', 0.7)
};

function wheel(g, x, z) {
	const w = new THREE.Group();
	const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.27, 20), m.tyre());
	const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 12), m.rim());
	tyre.castShadow = true;
	w.add(tyre, rim);
	w.rotation.z = Math.PI / 2;
	w.position.set(x, 0.39, z);
	g.add(w);
}

/** The pickup: a double cab, 5.33 × 1.86 m, 1.82 m high, a 3.1 m wheelbase; four doors, an open 1.55 m bed with a tool box and a jerrycan in it. */
export function pickup() {
	const g = new THREE.Group();
	g.name = 'pickup';
	for (const x of [-0.8, 0.8]) for (const z of [-1.5, 1.6]) wheel(g, x, z);
	soft(g, 1.86, 0.62, 5.2, 0.12, m.paint(), 0, 0.82, 0); // the body, bonnet to tailgate
	soft(g, 1.8, 0.16, 0.9, 0.06, m.paint(), 0, 1.16, 1.95); // the bonnet's rise
	part(g, 1.78, 0.14, 2.3, m.paint(), 0, 1.2, 0.45); // the cab's waist
	part(g, 1.72, 0.46, 2.2, m.glass(), 0, 1.5, 0.45); // its windows round
	soft(g, 1.74, 0.1, 2.2, 0.04, m.paint(), 0, 1.77, 0.38); // the roof
	for (const z of [-0.6, 0.45, 1.5]) part(g, 1.76, 0.46, 0.08, m.paint(), 0, 1.5, z); // the pillars
	// the bed: its floor, sides and tailgate
	part(g, 1.7, 0.04, 1.5, m.bedliner(), 0, 1.14, -1.8);
	for (const x of [-0.89, 0.89]) part(g, 0.08, 0.42, 1.6, m.paint(), x, 1.34, -1.8);
	part(g, 1.86, 0.42, 0.08, m.paint(), 0, 1.34, -2.6);
	part(g, 1.6, 0.4, 0.4, m.box(), 0, 1.36, -0.9); // a tool box across its front
	part(g, 0.17, 0.47, 0.35, m.jerry(), 0.6, 1.4, -2.2); // a jerrycan
	// the front and the back
	part(g, 1.4, 0.3, 0.06, m.trim(), 0, 0.98, 2.6); // the grille
	part(g, 1.9, 0.18, 0.2, m.trim(), 0, 0.55, 2.62); // bumper
	part(g, 1.9, 0.16, 0.2, m.trim(), 0, 0.55, -2.62);
	for (const x of [-0.72, 0.72]) {
		part(g, 0.3, 0.12, 0.05, m.light(), x, 1.0, 2.6);
		part(g, 0.08, 0.32, 0.05, m.tail(), x * 1.2, 1.28, -2.65);
		part(g, 0.06, 0.14, 0.2, m.trim(), x * 1.3, 1.45, 1.45); // the mirrors
	}
	for (const x of [-0.93, 0.93]) for (const z of [0.95, -0.05]) part(g, 0.02, 0.03, 0.18, m.trim(), x, 1.12, z); // door handles
	return g;
}

/** The powercube: a diesel generator in a silenced cube, 2.2 m each way, about 60 kVA; a 500-litre tank in its skid, louvres each side, the control panel behind its front door, the exhaust up through its roof. */
export function powercube() {
	const g = new THREE.Group();
	g.name = 'powercube';
	part(g, 2.3, 0.3, 2.3, m.skid(), 0, 0.15, 0); // the skid, the fuel tank in it
	soft(g, 2.2, 1.9, 2.2, 0.05, m.genset(), 0, 1.25, 0); // the cube
	// louvres each side, air in at one, out at the other
	for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) part(g, 0.03, 0.06, 1.5, m.louvre(), sx * 1.11, 0.75 + i * 0.13, 0);
	// the front: two doors, the control panel's window in the left one
	part(g, 0.02, 1.6, 0.02, m.louvre(), 0, 1.25, 1.105);
	part(g, 0.5, 0.36, 0.03, m.screen(), -0.5, 1.6, 1.11);
	for (const x of [-0.12, 0.12]) part(g, 0.04, 0.22, 0.05, m.steel(), x, 1.3, 1.12); // the handles
	part(g, 1.6, 0.1, 0.03, m.louvre(), 0, 2.0, 1.11); // its name plate's strip
	// the exhaust, its rain cap; the fuel cap on the skid; lifting eyes on the roof
	bar(g, v3(0.6, 2.2, -0.6), v3(0.6, 2.75, -0.6), 0.075, m.steel());
	part(g, 0.22, 0.02, 0.22, m.steel(), 0.6, 2.78, -0.6).rotation.x = 0.35;
	part(g, 0.14, 0.08, 0.14, m.louvre(), 0.9, 0.34, 1.0);
	for (const [x, z] of [[-0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) bar(g, v3(x, 2.2, z), v3(x, 2.3, z), 0.04, m.steel());
	return g;
}

/** A solar row: n real panels side by side on their racks, 1.8 m apart, centred on the origin, along x. */
export function solarRow(n = 6) {
	const g = new THREE.Group();
	g.name = 'solar-row';
	for (let i = 0; i < n; i++) {
		const p = solarPanel();
		p.position.x = (i - (n - 1) / 2) * 1.8;
		g.add(p);
	}
	return g;
}

/** A solar panel: one 1.72 × 1.13 m monocrystalline panel, about 410 W, on a galvanised ground rack tilted 30° to the sun, its cable down to the ground. */
export function solarPanel() {
	const g = new THREE.Group();
	g.name = 'solar-panel';
	const tilt = Math.PI / 6;
	const low = 0.5, half = 1.13 / 2;
	pvPanel(g, 0, low + half * Math.sin(tilt), 0, tilt);
	const front = half * Math.cos(tilt), high = low + 1.13 * Math.sin(tilt);
	for (const x of [-0.7, 0.7]) {
		bar(g, v3(x, 0.1, front), v3(x, low - 0.03, front), 0.025, m.galv());
		bar(g, v3(x, 0.1, -front), v3(x, high - 0.03, -front), 0.025, m.galv());
		bar(g, v3(x, 0.12, front), v3(x, 0.12, -front), 0.02, m.galv());
		for (const z of [front, -front]) part(g, 0.3, 0.12, 0.3, m.concrete(), x, 0.06, z); // ballast blocks
	}
	part(g, 0.12, 0.08, 0.05, m.trim(), 0, high - 0.12, -front + 0.08); // the junction box
	bar(g, v3(0, high - 0.15, -front + 0.08), v3(0, 0.02, -front - 0.3), 0.012, m.cable());
	return g;
}

/** A big battery pack: an outdoor lithium iron phosphate cabinet, 1.3 × 1.1 m, 2.3 m high, about 230 kWh; two doors, vents, its status lights and screen, on a concrete plinth. */
export function batteryPack() {
	const g = new THREE.Group();
	g.name = 'battery-pack';
	part(g, 1.6, 0.15, 1.4, m.concrete(), 0, 0.075, 0); // the plinth
	soft(g, 1.3, 2.3, 1.1, 0.03, m.cabinet(), 0, 1.3, 0);
	part(g, 1.36, 0.06, 1.16, m.cabinet(), 0, 2.48, 0); // the roof, over its edges
	part(g, 0.015, 2.0, 0.02, m.trim(), 0, 1.3, 0.555); // the doors' seam
	for (const x of [-0.08, 0.08]) part(g, 0.03, 0.25, 0.04, m.steel(), x, 1.35, 0.57); // handles
	part(g, 0.28, 0.18, 0.02, m.screen(), -0.38, 1.8, 0.56);
	for (let i = 0; i < 4; i++) part(g, 0.04, 0.04, 0.02, m.ok(), 0.25 + i * 0.07, 1.85, 0.56); // status lights
	for (let i = 0; i < 6; i++) for (const x of [-0.38, 0.38]) part(g, 0.4, 0.025, 0.02, m.louvre(), x, 0.4 + i * 0.06, 0.56); // the vents low on its doors
	for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) part(g, 0.02, 0.03, 0.7, m.louvre(), sx * 0.655, 2.0 + i * 0.07, 0); // and high on its sides
	const sign = new THREE.Mesh(new THREE.CircleGeometry(0.09, 3), m.warn());
	sign.position.set(0.38, 1.55, 0.565);
	sign.rotation.z = Math.PI / 2;
	g.add(sign);
	bar(g, v3(0.5, 0.15, -0.55), v3(0.5, 0.02, -0.9), 0.025, m.cable()); // its cable out the back
	return g;
}
