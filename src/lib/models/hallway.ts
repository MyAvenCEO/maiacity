/*
 * THE HALLWAY'S MODELS — Samuel's apartment, without its clutter: the red retro fridge, the bar along the wall and its
 * stools, the pallet shelf above it, the red enamel pendant, the coat stand, a canvas print, and the doors (plain, and
 * the bathroom's with its mirror). Each to its real measure, standing on the floor at its origin, its
 * back towards −z (a wall-hung thing: its back at z 0), its front towards +z.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { bar, part, shared, std, v3 } from './parts';
import { canvasMeadow, pine } from './textures';

const m = {
	red: shared(() => new THREE.MeshPhysicalMaterial({ color: '#c41f27', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 })),
	chrome: std('#d4d4d4', 0.18, { metalness: 1 }),
	black: std('#1b1b1b', 0.5, { metalness: 0.4 }),
	white: std('#f2f1ec', 0.45),
	whiteMetal: std('#efefec', 0.3, { metalness: 0.2 }),
	rustic: shared(() => new THREE.MeshStandardMaterial({ map: pine(true), roughness: 0.7 })),
	enamel: shared(() => new THREE.MeshStandardMaterial({ color: '#b8232b', roughness: 0.3, side: THREE.FrontSide })),
	enamelInside: shared(() => new THREE.MeshStandardMaterial({ color: '#f5f2ea', roughness: 0.4, side: THREE.BackSide })),
	door: std('#f4f2ec', 0.5),
	canvas: shared(() => new THREE.MeshStandardMaterial({ map: canvasMeadow(), roughness: 0.9 }))
};

/** A red retro fridge (the Bosch kind), 56 × 63 × 127 cm: rounded, glossy, one door, its chrome lever on the left,
 *  the maker's badge at the top. */
export function retroFridge(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'retro fridge';
	const h = 1.19, d = 0.63, front = d / 2;
	const body = new THREE.Mesh(new RoundedBoxGeometry(0.56, h, d, 5, 0.07), m.red());
	body.position.set(0, 0.08 + h / 2, 0);
	body.castShadow = body.receiveShadow = true;
	g.add(body);
	part(g, 0.5, 0.08, d - 0.05, m.black(), 0, 0.04, -0.01); // the plinth
	part(g, 0.52, 0.006, 0.01, m.chrome(), 0, 1.19, front + 0.002, false); // the door's top seam
	part(g, 0.1, 0.018, 0.004, m.chrome(), 0, 1.1, front + 0.004, false); // the badge
	bar(g, v3(-0.22, 0.86, front + 0.01), v3(-0.22, 1.12, front + 0.01), 0.012, m.chrome());
	bar(g, v3(-0.22, 1.11, front), v3(-0.22, 1.11, front + 0.025), 0.01, m.chrome());
	bar(g, v3(-0.22, 0.87, front), v3(-0.22, 0.87, front + 0.025), 0.01, m.chrome());
	return g;
}

/** A bar stool, 75 cm: a round seat on four splayed tubes with a foot ring — red, or white. */
export function barStool(color: 'red' | 'white' = 'red'): THREE.Group {
	const g = new THREE.Group();
	g.name = `bar stool, ${color}`;
	const paint = color === 'red' ? m.red() : m.whiteMetal();
	const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.17, 0.05, 32), paint);
	seat.position.y = 0.735;
	seat.castShadow = true;
	g.add(seat);
	for (let k = 0; k < 4; k++) {
		const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
		bar(g, v3(Math.cos(a) * 0.1, 0.71, Math.sin(a) * 0.1), v3(Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19), 0.012, paint);
	}
	const ring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.01, 6, 28), paint);
	ring.rotation.x = Math.PI / 2;
	ring.position.y = 0.3;
	g.add(ring);
	return g;
}

/** A bar along a wall: a thick rustic plank, `length` long, 45 cm deep, at 1.05 m, on black steel brackets. */
export function barCounter({ length = 2.3 }: { length?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'bar counter';
	part(g, length, 0.045, 0.45, m.rustic(), 0, 1.03, 0.225);
	const n = Math.max(2, Math.round(length / 1.0) + 1);
	for (let i = 0; i < n; i++) {
		const x = -length / 2 + 0.1 + (i * (length - 0.2)) / (n - 1);
		part(g, 0.03, 0.03, 0.42, m.black(), x, 0.995, 0.21, false); // the arm under the plank
		bar(g, v3(x, 0.98, 0.36), v3(x, 0.6, 0.01), 0.012, m.black()); // the strut to the wall
	}
	return g;
}

/** A shelf of old pallet wood on the wall, `length` long, 25 cm deep, with a low front rail. Its back at z 0, its
 *  board at y 0 (hang it at the height you want). */
export function palletShelf({ length = 2.0 }: { length?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'pallet shelf';
	part(g, length, 0.03, 0.25, m.rustic(), 0, 0.015, 0.125);
	part(g, length, 0.09, 0.02, m.rustic(), 0, 0.06, 0.24);
	part(g, length, 0.2, 0.02, m.rustic(), 0, 0.12, 0.01);
	for (const x of [-length / 2 + 0.05, 0, length / 2 - 0.05]) part(g, 0.08, 0.2, 0.23, m.rustic(), x, 0.1, 0.125);
	return g;
}

/** A red enamel pendant lamp, white inside, on a black cord `drop` below the ceiling. It hangs from its origin.
 *  userData: `glass` (the bulb's material), `light` (where its light is). */
export function pendantLamp({ drop = 0.55 }: { drop?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'enamel pendant';
	bar(g, v3(0, 0, 0), v3(0, -drop, 0), 0.003, m.black());
	// the shade's profile from its rim up to its neck: turned so, the lathe's faces look outwards — the red enamel is
	// the outside, the white the inside
	const profile = [new THREE.Vector2(0.175, -0.2), new THREE.Vector2(0.15, -0.18), new THREE.Vector2(0.09, -0.12), new THREE.Vector2(0.045, -0.06), new THREE.Vector2(0.035, 0)];
	const shade = new THREE.LatheGeometry(profile, 36);
	// the shade casts no shadow: its own light is inside it, and the ceiling above takes the floor's bounce round it
	for (const mat of [m.enamel(), m.enamelInside()]) {
		const s = new THREE.Mesh(shade, mat);
		s.position.y = -drop;
		g.add(s);
	}
	// its neck closed by the fitting the cord goes into: red above, white below, inside the shade
	const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.04, 24), [m.enamel(), m.enamel(), m.white()]);
	cap.position.y = -drop + 0.02;
	g.add(cap);
	const glass = new THREE.MeshStandardMaterial({ color: '#fff4e0', emissive: '#ffd9a0', emissiveIntensity: 0.4 });
	const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), glass);
	bulb.position.y = -drop - 0.11;
	g.add(bulb);
	g.userData.glass = glass;
	g.userData.light = v3(0, -drop - 0.14, 0);
	return g;
}

/** A coat stand, 1.75 m: a black pole on a round foot, hooks at the top. */
export function coatStand(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'coat stand';
	const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.02, 32), m.black());
	foot.position.y = 0.01;
	g.add(foot);
	bar(g, v3(0, 0.02, 0), v3(0, 1.75, 0), 0.014, m.black());
	for (let k = 0; k < 4; k++) {
		const a = (k / 4) * Math.PI * 2;
		bar(g, v3(0, 1.66, 0), v3(Math.cos(a) * 0.12, 1.74, Math.sin(a) * 0.12), 0.007, m.black());
	}
	return g;
}

/** A canvas print on the wall, `w` × `h`, stretched on a frame 3 cm deep: a meadow under an evening sky. Its back at
 *  z 0, its lower edge at y 0. */
export function canvasPrint({ w = 1.0, h = 0.66 }: { w?: number; h?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = 'canvas print';
	const c = part(g, w, h, 0.03, m.white(), 0, h / 2, 0.015, false);
	c.castShadow = false;
	const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m.canvas());
	face.position.set(0, h / 2, 0.031);
	g.add(face);
	return g;
}

export type DoorFinish = 'white' | 'mirror';

/**
 * An interior door in its frame, 86 × 200 cm: the leaf (white, or with a mirror on its inside face), a lever handle on
 * the side away from the hinges, the vent at its foot. The frame's middle at its origin, the leaf's hinge at −x, its
 * face to +z; `open` swings it (radians, towards +z).
 */
export function door({ finish = 'white', open = 0, w = 0.86, h = 2.0 }: { finish?: DoorFinish; open?: number; w?: number; h?: number } = {}): THREE.Group {
	const g = new THREE.Group();
	g.name = `door, ${finish}`;
	for (const [fw, fh, x, y] of [
		[0.06, h + 0.06, -w / 2 - 0.03, (h + 0.06) / 2],
		[0.06, h + 0.06, w / 2 + 0.03, (h + 0.06) / 2],
		[w + 0.12, 0.06, 0, h + 0.03]
	] as const)
		part(g, fw, fh, 0.05, m.door(), x, y, 0, false);
	const leaf = new THREE.Group();
	leaf.position.set(-w / 2, 0, 0);
	leaf.rotation.y = -open;
	g.add(leaf);
	const slab = part(leaf, w - 0.01, h - 0.01, 0.04, m.door(), w / 2, h / 2, 0);
	slab.receiveShadow = true;
	if (finish === 'mirror') {
		// a true mirror: it shows the room in front of it (the scene drawn again from behind the glass), not the sky
		const glass = new Reflector(new THREE.PlaneGeometry(w * 0.6, h * 0.62), { color: 0xc9d0d3, textureWidth: 768, textureHeight: 1536 });
		glass.position.set(w / 2, h * 0.58, -0.021);
		glass.rotation.y = Math.PI;
		leaf.add(glass);
	}
	for (const side of [1, -1]) {
		const hx = w - 0.09;
		const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 18), m.chrome());
		rose.rotation.x = Math.PI / 2;
		rose.position.set(hx, 1.05, side * 0.025);
		leaf.add(rose);
		part(leaf, 0.12, 0.016, 0.02, m.chrome(), hx - 0.05, 1.05, side * 0.04, false);
	}
	for (let i = 0; i < 5; i++) part(leaf, 0.4, 0.007, 0.004, m.white(), w / 2, 0.05 + i * 0.012, 0.022, false);
	return g;
}
