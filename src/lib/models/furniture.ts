/*
 * THE TRUCK — the tired land's truck, built to its real measure (metres) by one function: the Machines list it
 * (machines/truck@1, $lib/machines) and the tired land's set drives a fleet of them (src/lib/worlds/tiredLandSet.js).
 * The furniture this file once held (the room's bed, crates, chairs, bulb, picture, sheepskin and the CB60 on its
 * stand) went with the room's Things on 2026-10-16.
 *
 * It stands on the ground at its origin (y 0 is the ground), its middle over x = 0, z = 0, its front towards +z.
 */
import * as THREE from 'three';
import { part, std } from './parts';

const tyreMat = std('#1a1a1a', 0.9);

/* ── the truck ──────────────────────────────────────────────────────────── */

const truckGlass = std('#223038', 0.15, { metalness: 0.4 });

/**
 * A truck: a cab and a box trailer on a long chassis, eight wheels — about 16 m long, 2.55 m wide, 4 m high. It drives
 * towards +z. `cab` and `box` are their paint.
 */
export function truck({ cab = '#c8c4bc', box = '#dcdad4' }: { cab?: string; box?: string } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'truck';
	const paint = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
	const tyre = tyreMat();
	// as the tired land's trucks always were (Day 19's shots): shadows cast, none caught
	part(g, 2.55, 3.1, 12, paint(box), 0, 2.45, -1.2, false); // the trailer
	part(g, 2.5, 2.6, 2.4, paint(cab), 0, 2.1, 6.2, false); // the cab
	part(g, 2.3, 1.0, 0.05, truckGlass(), 0, 2.7, 7.42, false); // its windscreen
	part(g, 2.3, 0.5, 15, tyre, 0, 0.7, 0, false); // the chassis
	for (const z of [-5.8, -4.6, 3.4, 6.4])
		for (const x of [-1.15, 1.15]) {
			const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), tyre);
			wheel.rotation.z = Math.PI / 2;
			wheel.position.set(x, 0.5, z);
			wheel.castShadow = true;
			g.add(wheel);
		}
	return g;
}
