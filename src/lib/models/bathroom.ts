/*
 * THE BATHROOM'S MODELS — the wall-hung WC, the wall-hung basin and its tap, the glass shower with its rain head, the
 * white towel radiator. Each to its real measure; wall-hung things have their back at z 0 and stand on the floor at
 * their origin, their front towards +z.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bar, part, shared, std, v3 } from './parts';

const m = {
	porcelain: std('#f7f7f4', 0.22),
	chrome: std('#dadada', 0.15, { metalness: 1 }),
	glass: shared(() => new THREE.MeshPhysicalMaterial({ color: '#e9f1f2', roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.25, depthWrite: false })),
	white: std('#f4f4f1', 0.35)
};

/** A wall-hung WC: the bowl 36 × 54 cm, its seat at 42 cm, the white flush plate on the wall above it. */
export function wallToilet(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'wall-hung WC';
	const bowl = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m.porcelain());
	bowl.scale.set(0.18, 0.16, 0.27);
	bowl.position.set(0, 0.3, 0.27);
	bowl.castShadow = true;
	g.add(bowl);
	const tank = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.2, 0.12, 3, 0.04), m.porcelain());
	tank.position.set(0, 0.32, 0.06);
	g.add(tank);
	const seat = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 8, 32), m.porcelain());
	seat.scale.set(0.17, 0.25, 0.18);
	seat.rotation.x = Math.PI / 2;
	seat.position.set(0, 0.42, 0.29);
	g.add(seat);
	part(g, 0.25, 0.16, 0.012, m.white(), 0, 1.02, 0.006, false); // the flush plate
	return g;
}

/** A wall-hung basin, `w` wide and 42 cm deep, its rim at 85 cm, a chrome spout from the wall above it. */
export function washbasin({ w = 0.6 }: { w?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'washbasin';
	const basin = new THREE.Mesh(new RoundedBoxGeometry(w, 0.14, 0.42, 3, 0.02), m.porcelain());
	basin.position.set(0, 0.78, 0.21);
	basin.castShadow = true;
	g.add(basin);
	part(g, w - 0.08, 0.004, 0.32, std('#e8e8e4', 0.2)(), 0, 0.852, 0.22, false); // the bowl, seen from above
	bar(g, v3(0, 1.0, 0), v3(0, 1.0, 0.16), 0.012, m.chrome());
	const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 16), m.chrome());
	lever.rotation.x = Math.PI / 2;
	lever.position.set(0, 1.1, 0.005);
	g.add(lever);
	return g;
}

/** A frameless glass shower, `w` × `d`: a fixed glass wall and a glass door on the open side, a rain head under the
 *  ceiling (`ceiling` m high) and a hand shower on its rail. Its back wall at z 0, its floor at y 0. */
export function glassShower({ w = 0.9, d = 0.9, ceiling = 2.5 }: { w?: number; d?: number; ceiling?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'glass shower';
	const pane = (pw: number, x: number, z: number, ry: number) => {
		const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, 2.0), m.glass());
		p.position.set(x, 1.0, z);
		p.rotation.y = ry;
		g.add(p);
	};
	pane(w, 0, d, 0); // the front, the door in it
	bar(g, v3(-w / 2, 2.0, d), v3(w / 2, 2.0, d), 0.006, m.chrome());
	const head = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 32), m.chrome());
	head.position.set(0, ceiling - 0.12, d / 2);
	g.add(head);
	bar(g, v3(0, ceiling, d / 2), v3(0, ceiling - 0.12, d / 2), 0.01, m.chrome());
	bar(g, v3(w / 2 - 0.15, 0.9, 0.02), v3(w / 2 - 0.15, 1.9, 0.02), 0.01, m.chrome()); // the rail
	part(g, 0.6, 0.012, 0.05, std('#333', 0.5)(), 0, 0.006, d - 0.08, false); // the drain
	return g;
}

/** A white towel radiator, `w` × `h`: two uprights, a ladder of round rails. Its back at z 0, its foot at y 0.15. */
export function towelRadiator({ w = 0.5, h = 1.4 }: { w?: number; h?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'towel radiator';
	for (const x of [-w / 2, w / 2]) bar(g, v3(x, 0.15, 0.05), v3(x, 0.15 + h, 0.05), 0.016, m.white());
	const n = 14;
	for (let k = 0; k < n; k++) {
		const y = 0.2 + (k * (h - 0.1)) / (n - 1);
		bar(g, v3(-w / 2, y, 0.05), v3(w / 2, y, 0.05), 0.011, m.white());
	}
	return g;
}
