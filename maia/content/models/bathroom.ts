/*
 * THE WC AND THE BASIN — the wall-hung WC and the wall-hung basin with its tap, as the sanitary container fits them
 * (./containers.js). They were the bathroom's of Samuel's apartment; the bathroom's Things went with that world on
 * 2026-10-16, these two stay for the container. Each to its real measure; their back at z 0, standing on the floor at
 * their origin, their front towards +z.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bar, part, std, v3 } from './parts';

const m = {
	porcelain: std('#f7f7f4', 0.22),
	chrome: std('#dadada', 0.15, { metalness: 1 }),
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
