// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE EURO PALLET — the empty EPAL (1200 × 800 × 144 mm) the machines carry ($lib/actors/pallet.js: the goods pod's
 * hold, the forklift's forks) as a model of its own: the pallets a factory's line stacks its raw material and its
 * product on ($lib/factories), built in the asset box like every other asset. Its pieces are the machines' own, each
 * in its wood.
 */
import * as THREE from 'three';
import { euroPallet } from '../actors/pallet.js';

/** An empty Euro pallet lying along x, the middle of its underside at the origin: one mesh a piece. */
export function pallet() {
	const g = new THREE.Group();
	g.name = 'euro-pallet';
	const woods = new Map();
	euroPallet(
		(geo, color, _bone, mat) => {
			if (mat) return;
			if (!woods.has(color)) woods.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04 }));
			const m = new THREE.Mesh(geo, woods.get(color));
			m.castShadow = m.receiveShadow = true;
			g.add(m);
		},
		[0, 0, 0],
		0,
		'x',
		{ stack: 0 }
	);
	return g;
}
