// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE GLAMPING DOME AS A BUILDING — the Buildings' glamping dome from v2 (`buildings/dome-glamp@2`), built in the asset
 * box like the tent and the factory from their v2: Sandbox 3's glamping dome (its v1, raised by that world's own code,
 * ./inside.js) as one object, by the same builders: the geodesic shell and its door, and the home for four inside it
 * round its garden, its stone ring and the deck at its door ($content/sandbox-2/interior/interior.ts `glampInside`), as
 * they stand in Sandbox 3 by day, without the forest round it. Walked in from just inside its door. What the world adds
 * round it (its sky and sun, the lamps lit as the light goes, the food forest outside) stays the world's.
 */
import * as THREE from 'three';
import { DOMES, geodesic, glampInside, mats, portal } from '$content/sandbox-2/interior/interior';

/** The glamping dome: its shell, its door and the home inside it, the middle of its floor at the origin. */
export function glampDome() {
	const spec = DOMES.glamp;
	const R = spec.diameter / 2;
	const m = mats();
	const g = new THREE.Group();
	g.name = 'glamping-dome';
	const shell = geodesic(spec, m, 'glamp');
	g.add(shell.group);
	for (const hole of shell.holes) g.add(portal(m, hole, 'glamp'));
	// the lamps' shades as they glow by day; their lights are the world's, lit as the light goes
	const glow = new THREE.MeshStandardMaterial({ color: '#fff0d0', emissive: '#ffc070', emissiveIntensity: 0.1, roughness: 0.5 });
	const home = glampInside({ scene: g, R, m, addLamp: () => {}, glowMat: glow });
	g.userData = { walk: { x: home.start.x, z: home.start.z, yaw: home.start.look, lamps: [] } };
	return g;
}
