/*
 * THE KITCHEN'S MODELS — Samuel's galley kitchen without its clutter: the run of cabinets (the washing machine, the
 * oven under a black gas hob, drawers, the black sink), the tall wooden X-shelf, the gas boiler on the wall, the red
 * pedal bin, a rail of pans. Each to its real measure, standing on the floor at its origin (a wall-hung thing: its back
 * at z 0), its back towards −z, its front towards +z.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bar, part, shared, std, v3 } from './parts';
import { pine } from './textures';

const m = {
	black: std('#161616', 0.45, { metalness: 0.3 }),
	blackMatte: std('#1d1d1d', 0.75),
	glass: std('#0b0d0e', 0.08, { metalness: 0.4 }),
	chrome: std('#cfcfcf', 0.2, { metalness: 1 }),
	worktop: shared(() => new THREE.MeshStandardMaterial({ map: pine(true), roughness: 0.55 })),
	front: shared(() => new THREE.MeshStandardMaterial({ map: pine(), color: '#e8c79a', roughness: 0.6 })),
	shelfWood: shared(() => new THREE.MeshStandardMaterial({ color: '#c98a4b', map: pine(), roughness: 0.6 })),
	white: std('#f3f3f0', 0.4),
	pipe: std('#b9b9b6', 0.3, { metalness: 0.9 }),
	red: shared(() => new THREE.MeshPhysicalMaterial({ color: '#c41f27', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.12 })),
	steel: std('#8d8f91', 0.3, { metalness: 0.95 })
};

export type KitchenModule = 'washer' | 'oven' | 'drawers' | 'sink';

/**
 * A run of kitchen cabinets 60 cm wide each, in the order given from −x to +x: a black front-loading washing machine,
 * a black oven with a four-burner gas hob above it, drawers with wooden fronts, a cabinet with a black sink and a tall
 * faucet. A rustic worktop over them all at 90 cm, 62 cm deep. Its back at z 0.
 */
export function kitchenRun(modules: KitchenModule[] = ['washer', 'oven', 'drawers', 'sink']): THREE.Group {
	const g = new THREE.Group();
	g.name = 'kitchen run';
	const W = 0.6, L = modules.length * W, D = 0.6;
	part(g, L, 0.04, D + 0.02, m.worktop(), 0, 0.9, D / 2 + 0.01);
	part(g, L, 0.1, D - 0.05, m.blackMatte(), 0, 0.05, D / 2 - 0.03, false); // the plinth
	modules.forEach((kind, i) => {
		const x = -L / 2 + W / 2 + i * W, front = D;
		if (kind === 'washer') {
			part(g, W - 0.01, 0.78, D - 0.02, m.black(), x, 0.49, D / 2);
			part(g, W - 0.05, 0.1, 0.01, m.blackMatte(), x, 0.82, front - 0.005, false); // the panel
			const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 10, 40), m.chrome());
			ring.position.set(x, 0.45, front);
			g.add(ring);
			const window = new THREE.Mesh(new THREE.CircleGeometry(0.15, 36), m.glass());
			window.position.set(x, 0.45, front + 0.004);
			g.add(window);
		} else if (kind === 'oven') {
			part(g, W - 0.01, 0.78, D - 0.02, m.black(), x, 0.49, D / 2);
			part(g, W - 0.12, 0.34, 0.01, m.glass(), x, 0.45, front - 0.003, false);
			bar(g, v3(x - 0.24, 0.68, front + 0.03), v3(x + 0.24, 0.68, front + 0.03), 0.01, m.chrome());
			for (const k of [-0.15, 0, 0.15]) {
				const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 16), m.chrome());
				knob.rotation.x = Math.PI / 2;
				knob.position.set(x + k, 0.8, front + 0.01);
				g.add(knob);
			}
			// the gas hob: a black plate in the worktop, four burners under cast-iron grates
			part(g, W - 0.04, 0.01, 0.5, m.black(), x, 0.925, D / 2 + 0.01, false);
			for (const [bx, bz] of [[-0.13, -0.12], [0.13, -0.12], [-0.13, 0.12], [0.13, 0.12]] as const) {
				const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.02, 20), m.blackMatte());
				burner.position.set(x + bx, 0.935, D / 2 + 0.01 + bz);
				g.add(burner);
			}
			for (const gz of [-0.12, 0.12]) part(g, W - 0.08, 0.012, 0.012, m.blackMatte(), x, 0.955, D / 2 + 0.01 + gz, false);
			for (const gx of [-0.13, 0.13]) part(g, 0.012, 0.012, 0.44, m.blackMatte(), x + gx, 0.955, D / 2 + 0.01, false);
		} else if (kind === 'drawers') {
			for (let k = 0; k < 3; k++) {
				const h = 0.24, y = 0.17 + k * 0.26 + h / 2;
				part(g, W - 0.015, h, 0.02, m.front(), x, y, front - 0.01);
				bar(g, v3(x - 0.08, y + 0.06, front + 0.015), v3(x + 0.08, y + 0.06, front + 0.015), 0.006, m.black());
			}
			part(g, W - 0.01, 0.78, D - 0.04, m.white(), x, 0.49, D / 2 - 0.02, false);
		} else {
			part(g, W - 0.015, 0.76, 0.02, m.front(), x, 0.5, front - 0.01);
			bar(g, v3(x + 0.22, 0.62, front + 0.015), v3(x + 0.22, 0.78, front + 0.015), 0.006, m.black());
			part(g, W - 0.01, 0.78, D - 0.04, m.white(), x, 0.49, D / 2 - 0.02, false);
			// the black sink set into the worktop, and a tall faucet behind it
			part(g, 0.46, 0.012, 0.42, m.blackMatte(), x, 0.921, D / 2 + 0.02, false);
			part(g, 0.4, 0.004, 0.36, m.glass(), x, 0.928, D / 2 + 0.02, false);
			bar(g, v3(x, 0.92, 0.1), v3(x, 1.28, 0.1), 0.014, m.black());
			bar(g, v3(x, 1.28, 0.1), v3(x, 1.24, 0.3), 0.012, m.black());
		}
	});
	return g;
}

/** A tall open shelf of light wood, 45 × 40 cm and 1.9 m high: four posts, X braces on its sides and back, five
 *  shelves. */
export function xShelf({ w = 0.45, d = 0.4, h = 1.9 }: { w?: number; d?: number; h?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'X-shelf';
	const wood = m.shelfWood();
	for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) part(g, 0.035, h, 0.035, wood, (sx * (w - 0.035)) / 2, h / 2, (sz * (d - 0.035)) / 2);
	for (let k = 0; k < 5; k++) part(g, w - 0.04, 0.02, d - 0.04, wood, 0, 0.12 + k * ((h - 0.2) / 4), 0, true);
	const panel = (h - 0.2) / 4;
	for (let k = 0; k < 4; k++) {
		const y0 = 0.12 + k * panel, y1 = y0 + panel;
		for (const sx of [-1, 1]) {
			const x = (sx * (w - 0.035)) / 2;
			bar(g, v3(x, y0, -d / 2 + 0.02), v3(x, y1, d / 2 - 0.02), 0.009, wood);
			bar(g, v3(x, y0, d / 2 - 0.02), v3(x, y1, -d / 2 + 0.02), 0.009, wood);
		}
		bar(g, v3(-w / 2 + 0.02, y0, -d / 2 + 0.02), v3(w / 2 - 0.02, y1, -d / 2 + 0.02), 0.009, wood);
		bar(g, v3(w / 2 - 0.02, y0, -d / 2 + 0.02), v3(-w / 2 + 0.02, y1, -d / 2 + 0.02), 0.009, wood);
	}
	return g;
}

/** A gas boiler on the wall (the white kind), 44 × 72 × 34 cm, its flue rising to the ceiling, its pipes below. Its
 *  back at z 0, its bottom at y 0. */
export function gasBoiler(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'gas boiler';
	const box = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.72, 0.34, 3, 0.03), m.white());
	box.position.set(0, 0.36, 0.17);
	box.castShadow = box.receiveShadow = true;
	g.add(box);
	part(g, 0.42, 0.012, 0.005, std('#d9dad8', 0.4)(), 0, 0.18, 0.342, false);
	bar(g, v3(0, 0.72, 0.17), v3(0, 1.05, 0.17), 0.05, m.pipe());
	for (const x of [-0.14, -0.07, 0, 0.07, 0.14]) bar(g, v3(x, 0, 0.12), v3(x, -0.28, 0.1), 0.008, m.pipe());
	return g;
}

/** A red pedal bin, 30 cm across, 65 cm high, its lid domed, a chrome pedal. */
export function pedalBin(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'pedal bin';
	const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.58, 32), m.red());
	body.position.y = 0.3;
	body.castShadow = true;
	g.add(body);
	const lid = new THREE.Mesh(new THREE.SphereGeometry(0.152, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.red());
	lid.scale.y = 0.4;
	lid.position.y = 0.59;
	g.add(lid);
	part(g, 0.08, 0.015, 0.06, m.chrome(), 0, 0.025, 0.16, false);
	return g;
}

/** A steel rail on the wall with two pans hanging from it (a wok and a pot), `length` long. Its back at z 0, the
 *  rail at y 0. */
export function panRail({ length = 1.0 }: { length?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'pan rail';
	bar(g, v3(-length / 2, 0, 0.06), v3(length / 2, 0, 0.06), 0.008, m.steel());
	const wok = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), m.blackMatte());
	wok.rotation.x = -Math.PI / 2 - 0.1;
	wok.position.set(-length * 0.2, -0.22, 0.1);
	wok.castShadow = true;
	g.add(wok);
	const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.12, 24), m.steel());
	pot.position.set(length * 0.25, -0.12, 0.13);
	pot.castShadow = true;
	g.add(pot);
	return g;
}
