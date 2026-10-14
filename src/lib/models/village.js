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
		model: 'electrocube',
		note: 'the ElectroCube: our own cube on Open Source Ecology’s Power Cube frame (a 28 hp V-twin in a 27-inch steel frame) with a flat axial-flux generator on its shaft where the hydraulic pump would be, a power converter, breakers and sockets on the back, the same 27-inch size as every cube. Not an OSE design: its figures are inferred',
		specs: [['Size', '0.69 × 0.66 × 0.69 m'], ['Power', 'about 15 kW [inferred]'], ['Output', '400 V three-phase, 2 × 230 V'], ['Engine', '28 hp (20.9 kW) petrol V-twin'], ['Fuel tank', '7 gal (26.5 l)'], ['Design', 'ours, on the OSE Power Cube VII frame']]
	},
	solar: {
		model: 'solar-panel',
		note: 'one 1.72 × 1.13 m monocrystalline panel, about 410 W, on a galvanised ground rack tilted 30° to the sun, on ballast blocks',
		specs: [['Size', '1.72 × 1.13 m'], ['Peak power', 'about 410 W'], ['Cells', '60 monocrystalline'], ['Tilt', '30°, facing the sun'], ['Yield', 'about 1.4 kWh on a sunny day'], ['Weight', 'about 21 kg, on 4 ballast blocks']]
	},
	battery: {
		model: 'battery-pack',
		note: 'the BatteryCube: the Power Cube’s 27-inch frame with no engine, four BatteryPacks of 280 cells each stacked to its top (about 20.7 kWh) and a 6 kW hybrid inverter on its back that turns their 52 V into 230 V and takes a solar panel straight in. Our design: its figures are inferred',
		specs: [['Size', '0.69 × 0.66 × 0.69 m'], ['Capacity', 'about 20.7 kWh, 4 BatteryPacks'], ['Cells', '1,120 × 21700, 14S80P [inferred]'], ['Power', '6 kW at 230 V, 12 kW peak'], ['Solar in', 'MPPT, up to 8 kWp'], ['Weight', 'about 140 kg']]
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

/** The pickup as at v1: one closed body under dark glass, nothing inside. */
function pickupV1() {
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

/** where things are in the pickup (v2), in its own frame (+z ahead, its left +x, the ground at 0): the driver's and
 *  the passenger's hip points on their seats, the cab's floor, the steering wheel's middle, the bed's floor and its
 *  back edge (where the tailgate hinges), and how far the tailgate reaches when it is down */
export const PICKUP = {
	driver: v3(0.42, 0.84, 0.62),
	passenger: v3(-0.42, 0.84, 0.62),
	floor: 0.56,
	wheel: v3(0.42, 1.2, 1.12),
	bed: 1.16,
	tailgate: -2.62,
	gate: 0.44
};

const cab = {
	glass: shared(() => new THREE.MeshPhysicalMaterial({ color: '#cfe2ea', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })),
	plastic: std('#2c2e31', 0.7),
	dash: std('#24262a', 0.55),
	seat: std('#3b3f45', 0.95),
	seatSide: std('#2a2d31', 0.9),
	lining: std('#8d8a84', 0.95),
	mat: std('#1b1c1d', 0.98),
	door: std('#4a4c50', 0.8),
	gauge: shared(() => new THREE.MeshStandardMaterial({ color: '#0e1214', emissive: '#4a6f80', emissiveIntensity: 0.25, roughness: 0.4 })),
	needle: shared(() => new THREE.MeshStandardMaterial({ color: '#ff6a2a', emissive: '#ff6a2a', emissiveIntensity: 0.8 })),
	chrome: std('#b8bcc0', 0.25, { metalness: 0.9 })
};

/** a seat: its cushion, its back raked, a headrest on two posts; at (x, z) on the floor, facing +z */
function seat(g, x, z, w, mat = cab.seat) {
	const s = new THREE.Group();
	soft(s, w, 0.13, 0.5, 0.05, mat, 0, 0.215, 0); // the cushion, its top at 0.28 over the floor
	soft(s, w * 0.75, 0.16, 0.4, 0.02, cab.plastic(), 0, 0.08, 0); // its base and runners
	const back = new THREE.Group();
	back.position.set(0, 0.24, -0.24);
	back.rotation.x = -0.28;
	soft(back, w, 0.62, 0.12, 0.05, mat, 0, 0.31, 0);
	for (const sx of [-1, 1]) soft(back, 0.06, 0.5, 0.14, 0.03, cab.seatSide(), (sx * w) / 2, 0.26, 0.01); // its bolsters
	if (w < 0.8) {
		for (const sx of [-1, 1]) bar(back, v3(sx * 0.06, 0.6, 0), v3(sx * 0.06, 0.7, 0), 0.006, cab.chrome());
		soft(back, 0.26, 0.17, 0.09, 0.04, mat, 0, 0.77, 0);
	} else for (const hx of [-w / 3, 0, w / 3]) soft(back, 0.24, 0.15, 0.08, 0.04, mat, hx, 0.72, 0);
	s.add(back);
	s.position.set(x, PICKUP.floor, z);
	g.add(s);
	return s;
}

/** the steering wheel: a rim, three spokes, the hub and its pad; facing −z (the driver) and raked, on its column */
function steeringWheel(g) {
	const w = new THREE.Group();
	w.add(new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.016, 10, 48), cab.plastic()));
	const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.06, 20).rotateX(Math.PI / 2), cab.dash());
	w.add(hub);
	for (const a of [0, Math.PI, -Math.PI / 2]) {
		const sp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.02), cab.plastic());
		sp.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0);
		sp.rotation.z = a;
		w.add(sp);
	}
	w.position.copy(PICKUP.wheel);
	w.rotation.x = 0.42; // its top leans away, to the screen
	g.add(w);
	bar(g, PICKUP.wheel.clone().add(v3(0, -0.03, 0.06)), v3(PICKUP.wheel.x, 1.06, 1.42), 0.03, cab.plastic(), 0.04); // the column
}

/** The pickup: a double cab, 5.33 × 1.86 m, 1.82 m high, a 3.1 m wheelbase; four doors, an open 1.55 m bed with a
 *  tool box and a jerrycan in it. v2 (2026-10-14): clear glass all round and the cab inside it, seen from inside —
 *  two front seats and a bench behind, the dash with its gauges, screen and vents, the steering wheel on its column
 *  on the left, pedals, a gear stick on the console, door cards, sun visors and a mirror; and a tailgate that opens
 *  down flat (`tailgate`: 0 shut … 1 down; `userData.setTailgate(k)`). Where its seats, wheel and bed are: PICKUP. */
export function pickup({ v = 2, tailgate = 0 } = {}) {
	if (v < 2) return pickupV1();
	const g = new THREE.Group();
	g.name = 'pickup';
	for (const x of [-0.8, 0.8]) for (const z of [-1.5, 1.6]) wheel(g, x, z);
	const F = PICKUP.floor;
	// the body in three: the engine's bay under the bonnet, the cab's shell round its floor, the bed's sides
	soft(g, 1.86, 0.62, 1.08, 0.12, m.paint(), 0, 0.82, 2.06);
	soft(g, 1.8, 0.16, 0.9, 0.06, m.paint(), 0, 1.16, 1.95); // the bonnet's rise
	soft(g, 1.86, 0.62, 1.98, 0.12, m.paint(), 0, 0.82, -1.61);
	part(g, 1.78, 0.06, 2.22, m.trim(), 0, F - 0.03, 0.45); // the cab's floor pan
	for (const sx of [-1, 1]) {
		part(g, 0.05, 0.76, 2.22, m.paint(), sx * 0.905, 0.89, 0.45); // its sides up to the waist (the doors)
		part(g, 0.004, 0.6, 0.006, m.trim(), sx * 0.931, 0.92, -0.06); // the seam between the doors
		for (const z of [0.95, -0.1]) part(g, 0.02, 0.03, 0.18, m.trim(), sx * 0.935, 1.12, z); // their handles
	}
	part(g, 1.86, 0.76, 0.06, m.paint(), 0, 0.89, 1.55); // the firewall under the screen
	// the cab's back wall: up to the waist, then round its window
	part(g, 1.86, 0.79, 0.06, m.paint(), 0, 0.905, -0.66);
	for (const sx of [-1, 1]) part(g, 0.26, 0.45, 0.06, m.paint(), sx * 0.8, 1.52, -0.66);
	part(g, 1.86, 0.05, 0.06, m.paint(), 0, 1.74, -0.66);
	// the roof, its lining, the pillars and the glass between them
	soft(g, 1.76, 0.08, 1.96, 0.04, m.paint(), 0, 1.78, 0.27);
	part(g, 1.66, 0.012, 1.86, cab.lining(), 0, 1.733, 0.27);
	for (const sx of [-1, 1]) {
		bar(g, v3(sx * 0.88, 1.27, 1.54), v3(sx * 0.86, 1.75, 1.2), 0.035, m.paint()); // A
		part(g, 0.06, 0.48, 0.09, m.paint(), sx * 0.88, 1.51, 0.45); // B
		part(g, 0.06, 0.48, 0.12, m.paint(), sx * 0.88, 1.51, -0.6); // C
		part(g, 0.05, 0.03, 2.2, m.paint(), sx * 0.89, 1.27, 0.45); // the waist rail
		const side = new THREE.Shape([[-0.58, 1.285], [1.52, 1.285], [1.19, 1.735], [-0.58, 1.735]].map(([z, y]) => new THREE.Vector2(z, y)));
		const pane = new THREE.Mesh(new THREE.ShapeGeometry(side), cab.glass());
		pane.rotation.y = -Math.PI / 2;
		pane.position.x = sx * 0.885;
		pane.renderOrder = 2;
		g.add(pane);
	}
	const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.7, Math.hypot(0.48, 0.36)), cab.glass());
	screen.position.set(0, 1.51, 1.37);
	screen.rotation.x = -Math.atan2(0.36, 0.48);
	screen.renderOrder = 2;
	const back = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.42), cab.glass());
	back.position.set(0, 1.52, -0.66);
	back.renderOrder = 2;
	g.add(screen, back);
	// inside: the footwells' trim over the firewall, the floor's mat and the tunnel down its middle
	part(g, 1.74, 0.5, 0.02, cab.plastic(), 0, F + 0.25, 1.51);
	part(g, 1.74, 0.58, 0.02, cab.plastic(), 0, F + 0.29, -0.62);
	part(g, 1.72, 0.01, 2.0, cab.mat(), 0, F + 0.005, 0.5);
	soft(g, 0.26, 0.14, 1.9, 0.05, cab.mat(), 0, F + 0.07, 0.55);
	// the seats: two in front, a bench for three behind
	seat(g, PICKUP.driver.x, PICKUP.driver.z, 0.52);
	seat(g, PICKUP.passenger.x, PICKUP.passenger.z, 0.52);
	seat(g, 0, -0.2, 1.62);
	// the console between the front seats: the gear stick, the handbrake, a cup holder
	soft(g, 0.24, 0.26, 0.62, 0.04, cab.plastic(), 0, F + 0.2, 0.88);
	bar(g, v3(0, F + 0.33, 1.05), v3(0, F + 0.47, 1.0), 0.008, cab.chrome());
	const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 14, 10), cab.dash());
	knob.position.set(0, F + 0.49, 0.995);
	g.add(knob);
	part(g, 0.03, 0.04, 0.2, cab.dash(), 0.05, F + 0.35, 0.72).rotation.x = -0.3;
	// the dash: its body, its padded top, the binnacle over two gauges before the driver, the screen and four vents,
	// the glovebox before the passenger
	soft(g, 1.74, 0.3, 0.36, 0.05, cab.dash(), 0, 1.14, 1.38);
	soft(g, 1.74, 0.06, 0.3, 0.03, cab.plastic(), 0, 1.3, 1.4).rotation.x = -0.12;
	soft(g, 0.36, 0.09, 0.14, 0.035, cab.plastic(), PICKUP.driver.x, 1.31, 1.25);
	for (const dx of [-0.075, 0.075]) {
		const face = new THREE.Mesh(new THREE.CircleGeometry(0.05, 28), cab.gauge());
		face.position.set(PICKUP.driver.x + dx, 1.23, 1.198);
		face.rotation.y = Math.PI;
		const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.002), cab.needle());
		needle.position.set(PICKUP.driver.x + dx, 1.24, 1.196);
		needle.rotation.z = dx > 0 ? -0.7 : 0.5;
		g.add(face, needle);
	}
	const display = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), m.screen());
	display.position.set(0, 1.2, 1.196);
	display.rotation.y = Math.PI;
	g.add(display);
	for (const x of [-0.7, -0.16, 0.16, 0.7]) part(g, 0.1, 0.04, 0.01, m.louvre(), x, 1.25, 1.198);
	part(g, 0.4, 0.14, 0.01, cab.plastic(), PICKUP.passenger.x, 1.1, 1.198); // the glovebox's lid
	// the wheel, the pedals under it
	steeringWheel(g);
	for (const [dx, w] of [[-0.13, 0.05], [-0.04, 0.08], [0.08, 0.05]]) part(g, w, 0.07, 0.015, cab.dash(), PICKUP.driver.x + dx, F + 0.12, 1.42).rotation.x = -0.4;
	// the doors' cards, their pulls and armrests; sun visors; the mirror
	for (const sx of [-1, 1]) {
		for (const [z, len] of [[1.0, 1.05], [-0.1, 1.05]]) {
			part(g, 0.02, 0.68, len, cab.door(), sx * 0.872, F + 0.35, z);
			part(g, 0.05, 0.03, 0.3, cab.plastic(), sx * 0.85, 1.0, z);
			part(g, 0.02, 0.025, 0.06, cab.chrome(), sx * 0.86, 1.12, z + 0.25);
		}
		part(g, 0.36, 0.015, 0.16, cab.lining(), sx * 0.42, 1.71, 1.12).rotation.x = 0.15;
	}
	part(g, 0.22, 0.06, 0.02, cab.plastic(), 0, 1.62, 1.18);
	bar(g, v3(0, 1.65, 1.18), v3(0, 1.73, 1.2), 0.008, cab.plastic());
	// the bed: its floor, sides, the tailgate on its hinges at the floor's back edge
	part(g, 1.7, 0.04, 1.5, m.bedliner(), 0, 1.14, -1.8);
	for (const x of [-0.89, 0.89]) part(g, 0.08, 0.42, 1.6, m.paint(), x, 1.34, -1.8);
	const gate = new THREE.Group();
	gate.name = 'tailgate';
	gate.position.set(0, PICKUP.bed - 0.04, PICKUP.tailgate + 0.04);
	part(gate, 1.7, PICKUP.gate, 0.08, m.paint(), 0, PICKUP.gate / 2, 0);
	part(gate, 1.6, PICKUP.gate - 0.06, 0.01, m.bedliner(), 0, PICKUP.gate / 2, 0.045);
	part(gate, 0.2, 0.04, 0.02, m.trim(), 0, PICKUP.gate - 0.08, -0.045); // its handle
	g.add(gate);
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
	const setTailgate = (k) => (gate.rotation.x = (-Math.PI / 2) * Math.max(0, Math.min(1, k)));
	setTailgate(tailgate);
	g.userData = { tailgate: gate, setTailgate };
	return g;
}

/** the ramp's measures: from the ground up to the bed's floor (1.16 m) over 2 m, 0.86 m wide between its rails */
export const RAMP = { rise: PICKUP.bed, run: 2.0, w: 0.86 };

/** A loading ramp: one folding aluminium ramp, 0.86 m wide between two side rails, its deck crossed with grip bars
 *  every 10 cm, a hinged lip at the top to rest on the bed and rubber feet at the bottom, rising 1.16 m over 2 m
 *  (30°). Its origin is its foot, on the ground; it rises towards +z to its lip at (0, 1.16, 2.0): set it behind a
 *  pickup facing the same way, its lip on the bed's back edge (PICKUP.tailgate, or the tailgate's end when it is
 *  down). */
export function loadingRamp() {
	const g = new THREE.Group();
	g.name = 'loading-ramp';
	const { rise, run, w } = RAMP;
	const len = Math.hypot(rise, run), a = Math.atan2(rise, run);
	const deck = new THREE.Group();
	deck.rotation.x = -a;
	// along the deck: +z up the slope from the foot
	part(deck, w, 0.006, len - 0.12, m.galv(), 0, 0.03, len / 2);
	for (const sx of [-1, 1]) {
		part(deck, 0.04, 0.09, len, m.galv(), sx * (w / 2 + 0.02), 0.045, len / 2);
		part(deck, 0.045, 0.012, len, m.steel(), sx * (w / 2 + 0.02), 0.095, len / 2);
	}
	for (let z = 0.1; z < len - 0.1; z += 0.1) part(deck, w, 0.012, 0.014, m.steel(), 0, 0.039, z);
	for (const z of [len * 0.33, len * 0.66]) part(deck, w, 0.04, 0.03, m.galv(), 0, 0.012, z); // braces under it
	// the lip at the top, bent to lie flat on the bed; the feet at the bottom
	const lip = new THREE.Group();
	lip.position.set(0, 0.03, len);
	lip.rotation.x = a;
	part(lip, w + 0.08, 0.008, 0.14, m.galv(), 0, 0, 0.07);
	deck.add(lip);
	for (const sx of [-1, 1]) part(deck, 0.06, 0.03, 0.08, m.cable(), sx * (w / 2 + 0.02), 0.0, 0.03);
	deck.position.y = -0.03 * Math.cos(a); // the deck's top meets the ground at its foot and the bed at its lip
	g.add(deck);
	g.traverse((o) => o.isMesh && (o.castShadow = true));
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
