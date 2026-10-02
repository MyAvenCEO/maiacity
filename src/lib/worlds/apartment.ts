/*
 * THE APARTMENT OF SAMUEL — the rest of it, round his room (./room.ts), as he sketched it and as his photos show it:
 * the hallway, the kitchen, the bathroom. Rough, not surveyed — how the rooms join and about how big they are —
 * furnished with the 3D models (src/lib/models) and none of the clutter.
 *
 * In the room's axes (x across: +x the room's window wall, which looks north, −x its door wall; z along it; y up; m):
 *   the hallway  out of Samuel's door, x −4.60…−1.70, z 0.20…2.25: the wall beside his door painted as a chalkboard;
 *                along the other wall the shoe rack, the storeroom's door, the red fridge by the kitchen's doorway.
 *                Then its arm, x −4.60…−3.10, z 2.25…6.40: the bar along one wall under the pendant, the bathroom's
 *                door across from it, the front door at the far end, the coat stand and the print on the end wall;
 *   the kitchen  x −7.60…−4.75, z 0.20…2.25: a galley, the cabinets along the right as you come in, the window at the
 *                far end (it looks south: the sun comes in);
 *   the bathroom x −7.60…−4.75, z 2.40…4.40: long and narrow, the basin and the WC on the left, the towel radiator on
 *                the right, the glass shower at the far end under its tall window.
 */
import * as THREE from 'three';
import { barCounter, barStool, canvasPrint, coatStand, door, palletShelf, pendantLamp, retroFridge } from '$lib/models/hallway';
import { gasBoiler, kitchenRun, panRail, pedalBin, xShelf } from '$lib/models/kitchen';
import { glassShower, towelRadiator, washbasin, wallToilet } from '$lib/models/bathroom';
import { CRATE, crateTower, edisonBulb, wineCrate } from '$lib/models/furniture';
import { bar, v3 } from '$lib/models/parts';
import { brick, chalkboard, limedOak, stoneTiles } from '$lib/models/textures';

type Box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow?: boolean) => THREE.Mesh;
/** x0, x1, z0, z1 */
export type Rect = [number, number, number, number];
/** one of the apartment's lamps: its light, how strong (by day; brighter at night), the glass that glows with it */
export type Lamp = { light: THREE.PointLight | THREE.SpotLight; share: number; glass?: THREE.MeshStandardMaterial; glow: number; color: THREE.Color };

export type Apartment = {
	/** where one may stand, kept off the walls: the rooms and the doorways between them */
	walk: Rect[];
	/** the furniture, to keep out of */
	solid: Rect[];
	lamps: Lamp[];
	/** the light through the kitchen's and the bathroom's windows */
	daylights: THREE.RectAreaLight[];
};

export const HALL = { x0: -4.6, x1: -1.7, z0: 0.2, z1: 2.25 } as const;
export const ARM = { x0: -4.6, x1: -3.1, z0: 2.25, z1: 6.4 } as const;
export const KITCHEN = { x0: -7.6, x1: -4.75, z0: 0.2, z1: 2.25 } as const;
export const BATH = { x0: -7.6, x1: -4.75, z0: 2.4, z1: 4.4 } as const;
/** the doorways in the hallway's far wall: into the kitchen (no door), into the bathroom */
const KITCHEN_DOOR = { z0: 1.0, z1: 1.86 } as const;
const BATH_DOOR = { z0: 2.61, z1: 3.49 } as const;
/** the windows in the far wall: along z, their sill and their top */
const KITCHEN_WIN = { z0: 0.85, z1: 1.65, sill: 0.95, top: 2.3 } as const;
const BATH_WIN = { z0: 3.19, z1: 3.61, sill: 1.0, top: 2.35 } as const;

export function buildApartment(
	scene: THREE.Scene,
	outside: THREE.Group,
	box: Box,
	mat: { wall: THREE.Material; ceiling: THREE.Material; white: THREE.Material; pvc: THREE.Material; sill: THREE.Material; glass: THREE.Material },
	H: number,
	T: number
): Apartment {
	const place = (o: THREE.Object3D, x: number, z: number, rotY = 0, y = 0) => {
		o.position.set(x, y, z);
		o.rotation.y = rotY;
		scene.add(o);
		return o;
	};
	// a flat surface on a wall (rotY: which way it faces) or, lying, on the floor
	const plane = (w: number, h: number, m: THREE.Material, x: number, y: number, z: number, rotY: number, lying = false) => {
		const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
		p.position.set(x, y, z);
		if (lying) p.rotation.x = -Math.PI / 2;
		else p.rotation.y = rotY;
		p.receiveShadow = true;
		scene.add(p);
		return p;
	};
	// a texture laid at its own scale over a surface w × h: `size`, the metres one repeat of it covers
	const laid = (tex: THREE.Texture, w: number, h: number, size: [number, number], more: THREE.MeshStandardMaterialParameters = {}) => {
		const t = tex.clone();
		t.needsUpdate = true;
		t.repeat.set(w / size[0], h / size[1]);
		return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, ...more });
	};
	const floor = (x0: number, x1: number, z0: number, z1: number, tex: THREE.Texture, size: [number, number], more = {}) =>
		plane(x1 - x0, z1 - z0, laid(tex, x1 - x0, z1 - z0, size, more), (x0 + x1) / 2, 0, (z0 + z1) / 2, 0, true);
	// a wall: the box from corner (x0, z0) to corner (x1, z1), from y0 up to y1
	const wall = (x0: number, x1: number, z0: number, z1: number, y0 = 0, y1 = H) =>
		box(x1 - x0, y1 - y0, z1 - z0, mat.wall, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
	// a window in the far wall (x −7.75…−7.60): the wall under it and over it, a white frame, glass, a sill inside, and
	// the sky's light through it; `transom`: a bar across it, a small pane over the tall one
	const opening = (w: { z0: number; z1: number; sill: number; top: number }, transom = false) => {
		const x = KITCHEN.x0, mid = (w.z0 + w.z1) / 2, len = w.z1 - w.z0, h = w.top - w.sill;
		wall(x - T, x, w.z0, w.z1, 0, w.sill);
		wall(x - T, x, w.z0, w.z1, w.top, H);
		for (const z of [w.z0 + 0.035, w.z1 - 0.035]) box(0.07, h, 0.07, mat.pvc, x - 0.06, w.sill + h / 2, z);
		for (const y of [w.sill + 0.035, w.top - 0.035, ...(transom ? [w.top - 0.42] : [])]) box(0.07, 0.07, len, mat.pvc, x - 0.06, y, mid);
		const pane = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.1, h - 0.1), mat.glass);
		pane.rotation.y = Math.PI / 2;
		pane.position.set(x - 0.07, w.sill + h / 2, mid);
		scene.add(pane);
		box(0.2, 0.03, len + 0.06, mat.sill, x + 0.07, w.sill + 0.015, mid);
		const day = new THREE.RectAreaLight('#f4efe6', 0, len, h);
		day.position.set(x + 0.02, w.sill + h / 2, mid);
		day.lookAt(x + 2, w.sill + h / 2 - 0.3, mid);
		scene.add(day);
		return day;
	};
	// a lamp's light straight down in a cone, its shadows cast (so the walls keep it in its room): off until lit
	const downlight = (color: string, reach: number, angle: number, penumbra: number, at: THREE.Vector3) => {
		const l = new THREE.SpotLight(color, 0, reach, angle, penumbra, 2);
		l.position.copy(at);
		l.target.position.copy(at).setY(0);
		l.castShadow = true;
		l.shadow.mapSize.set(1024, 1024);
		l.shadow.bias = -0.002;
		l.shadow.camera.near = 0.05;
		scene.add(l, l.target);
		return l;
	};
	// a doorway's lining: white jambs and a head across the wall's thickness (x0…x1), round the gap z0…z1, 2 m high
	const lining = (x0: number, x1: number, z0: number, z1: number) => {
		for (const z of [z0 + 0.012, z1 - 0.012]) box(x1 - x0 + 0.02, 2.0, 0.024, mat.white, (x0 + x1) / 2, 1.0, z, false);
		box(x1 - x0 + 0.02, 0.024, z1 - z0, mat.white, (x0 + x1) / 2, 2.0 - 0.012, (z0 + z1) / 2, false);
	};

	/* ── the floors: oak in the hallway and the kitchen as in the room, stone tiles in the bathroom; the ceiling ── */
	const oak: [number, number] = [1.08, 2.4];
	floor(HALL.x0, HALL.x1 + T, HALL.z0, HALL.z1, limedOak(), oak, { roughness: 0.58 }); // on into Samuel's doorway
	floor(ARM.x0, ARM.x1, ARM.z0, ARM.z1, limedOak(), oak, { roughness: 0.58 });
	floor(KITCHEN.x0, KITCHEN.x1 + T, KITCHEN.z0, KITCHEN.z1, limedOak(), oak, { roughness: 0.58 });
	floor(BATH.x0, BATH.x1 + T, BATH.z0, BATH.z1, stoneTiles(), [1.2, 1.2], { roughness: 0.4, color: '#f3e6d2' });
	const c = { x0: KITCHEN.x0 - T, x1: HALL.x1, z0: HALL.z0 - T, z1: ARM.z1 + T };
	box(c.x1 - c.x0, T, c.z1 - c.z0, mat.ceiling, (c.x0 + c.x1) / 2, H + T / 2, (c.z0 + c.z1) / 2);

	/* ── the walls (the room's are in room.ts), their doorways and windows ── */
	wall(KITCHEN.x0 - T, HALL.x1, HALL.z0 - T, HALL.z0); // along the kitchen and the hallway, on the cabinets' side
	wall(ARM.x1, HALL.x1, HALL.z1, HALL.z1 + T); // the hallway's other wall, the chalkboard on it
	wall(ARM.x1, ARM.x1 + T, HALL.z1 + T, ARM.z1 + T); // the arm's, the bar on it
	wall(ARM.x0, ARM.x1, ARM.z1, ARM.z1 + T); // the arm's end, the print on it
	// the hallway's far wall: the kitchen's doorway, the bathroom's door, then on to the front door
	wall(ARM.x0 - T, ARM.x0, HALL.z0, KITCHEN_DOOR.z0);
	wall(ARM.x0 - T, ARM.x0, KITCHEN_DOOR.z0, KITCHEN_DOOR.z1, 2.0);
	wall(ARM.x0 - T, ARM.x0, KITCHEN_DOOR.z1, BATH_DOOR.z0);
	wall(ARM.x0 - T, ARM.x0, BATH_DOOR.z0, BATH_DOOR.z1, 2.0);
	wall(ARM.x0 - T, ARM.x0, BATH_DOOR.z1, ARM.z1 + T);
	lining(ARM.x0 - T, ARM.x0, KITCHEN_DOOR.z0, KITCHEN_DOOR.z1);
	wall(KITCHEN.x0, KITCHEN.x1, KITCHEN.z1, BATH.z0); // between the kitchen and the bathroom
	wall(KITCHEN.x0 - T, BATH.x1, BATH.z1, BATH.z1 + T); // the bathroom's other
	// the far wall, the windows in it
	wall(KITCHEN.x0 - T, KITCHEN.x0, KITCHEN.z0, KITCHEN_WIN.z0);
	const kitchenDay = opening(KITCHEN_WIN);
	wall(KITCHEN.x0 - T, KITCHEN.x0, KITCHEN_WIN.z1, BATH_WIN.z0);
	const bathDay = opening(BATH_WIN, true);
	wall(KITCHEN.x0 - T, KITCHEN.x0, BATH_WIN.z1, BATH.z1);
	// the heating pipes, painted red, along the hallway's walls under the ceiling and down its far corner
	const pipeRed = new THREE.MeshStandardMaterial({ color: '#b3262a', roughness: 0.45 });
	const pipes = new THREE.Group();
	bar(pipes, v3(HALL.x0 + 0.03, H - 0.12, HALL.z0 + 0.03), v3(HALL.x1 - 0.03, H - 0.12, HALL.z0 + 0.03), 0.016, pipeRed);
	bar(pipes, v3(ARM.x1 - 0.03, H - 0.12, HALL.z1 - 0.03), v3(ARM.x1 - 0.03, H - 0.12, ARM.z1 - 0.03), 0.016, pipeRed);
	bar(pipes, v3(ARM.x1 - 0.03, 0.12, ARM.z1 - 0.03), v3(ARM.x1 - 0.03, H - 0.12, ARM.z1 - 0.03), 0.016, pipeRed);
	scene.add(pipes);

	/* ── the hallway: the chalkboard by Samuel's door; the shoe rack, the storeroom's door, the fridge; the bar and its
	   stools under the pallet shelf and the pendant; the bathroom's door across from it; the front door, the coat
	   stand and the print at the end ── */
	// the chalkboard is the wall itself, painted with blackboard paint: no board, no frame
	plane(1.0, 2.2, new THREE.MeshStandardMaterial({ map: chalkboard(), roughness: 0.95 }), -2.35, 1.1, HALL.z1 - 0.002, Math.PI);
	place(crateTower(['white', 'white']), -2.05, HALL.z0 + CRATE.d / 2 + 0.01);
	place(door({ finish: 'white' }), -3.3, HALL.z0 + 0.012); // the storeroom's, shut
	place(retroFridge(), HALL.x0 + 0.3, HALL.z0 + 0.31);
	place(barCounter({ length: 2.3 }), ARM.x1, 3.65, -Math.PI / 2);
	place(palletShelf({ length: 2.0 }), ARM.x1, 3.65, -Math.PI / 2, 1.62);
	(['red', 'white', 'red', 'white'] as const).forEach((color, i) => place(barStool(color), ARM.x1 - 0.62, 2.8 + i * 0.57, i * 0.7));
	place(door({ finish: 'mirror', open: 1.45 }), ARM.x0 - T / 2, (BATH_DOOR.z0 + BATH_DOOR.z1) / 2, -Math.PI / 2); // open, into the bathroom
	place(door({ finish: 'white' }), ARM.x0 + 0.012, 5.75, Math.PI / 2); // the front door, shut
	place(coatStand(), ARM.x1 - 0.3, ARM.z1 - 0.32);
	place(canvasPrint({ w: 1.2, h: 0.8 }), (ARM.x0 + ARM.x1) / 2, ARM.z1, Math.PI, 1.45);
	// the pendant's light: down out of its shade, a wide cone (the ceiling above it stays dark)
	const pendant = place(pendantLamp({ drop: 0.55 }), (ARM.x0 + ARM.x1) / 2, 3.5, 0, H);
	const hallLight = downlight('#ffcf94', 8, 1.2, 0.75, pendant.position.clone().add(pendant.userData.light as THREE.Vector3));

	/* ── the kitchen: along the right as you come in, from the window, three modules — the washing machine, the oven
	   under the gas hob, and right beside it the black sink over drawers — under the brick wall, the dark crates and the
	   pans above them, the boiler over the sink, then the X-shelf; the dryer under the window; on the grey wall the
	   crate pantry and the bin ── */
	// the run's middle, the hob: the washing machine 60 cm towards the window, the sink 60 cm towards the door
	const run = KITCHEN.x0 + 0.9;
	place(kitchenRun(['washer', 'oven', 'sink']), run, KITCHEN.z0);
	place(kitchenRun(['washer']), KITCHEN.x0, (KITCHEN_WIN.z0 + KITCHEN_WIN.z1) / 2, Math.PI / 2); // the dryer
	plane(1.8, 0.86, laid(brick(), 1.8, 0.86, [0.96, 0.64], { roughness: 0.9 }), run, 0.92 + 0.43, KITCHEN.z0 + 0.003, 0);
	for (const x of [run - 0.55, run]) place(wineCrate('dark'), x, KITCHEN.z0 + CRATE.d / 2 + 0.005, 0, 1.8);
	place(panRail({ length: 0.8 }), run - 0.1, KITCHEN.z0, 0, 1.62);
	place(gasBoiler(), run + 0.6, KITCHEN.z0, 0, 1.6);
	place(xShelf(), run + 1.15, KITCHEN.z0 + 0.21);
	place(crateTower(['dark', 'dark', 'dark', 'dark']), KITCHEN.x0 + 0.35, KITCHEN.z1 - CRATE.d / 2 - 0.01, Math.PI);
	place(pedalBin(), run, 1.9);
	const grey = new THREE.MeshStandardMaterial({ color: '#a3a39f', roughness: 0.9 });
	plane(KITCHEN.x1 - KITCHEN.x0, 1.45, grey, (KITCHEN.x0 + KITCHEN.x1) / 2, 0.725, KITCHEN.z1 - 0.002, Math.PI); // grey up to 1.45 m
	const kitchenBulb = place(edisonBulb({ drop: 0.8 }), run + 0.3, KITCHEN.z0 + 0.42, 0, H); // between the hob and the sink
	// a bare bulb: its light all round, but not far — it has no shadows, and the walls would not stop it
	const kitchenLight = new THREE.PointLight('#ffad55', 0, 3.2, 2);
	kitchenLight.position.copy(kitchenBulb.position).add(kitchenBulb.userData.light as THREE.Vector3);
	scene.add(kitchenLight);

	/* ── the bathroom: the basin and the WC on the left as you come in, the towel radiator on the right, the glass
	   shower at the far end; stone tiles to 1.2 m, in the shower up to the ceiling; two spots in the ceiling ── */
	const tiles = (w: number, h: number, x: number, y: number, z: number, rotY: number) =>
		plane(w, h, laid(stoneTiles(), w, h, [1.2, 1.2], { roughness: 0.35, color: '#f3e6d2' }), x, y, z, rotY); // warm sand
	const showerX = KITCHEN.x0 + 0.95;
	for (const [z, rotY] of [[BATH.z0 + 0.002, 0], [BATH.z1 - 0.002, Math.PI]] as const) {
		tiles(BATH.x1 - BATH.x0, 1.2, (BATH.x0 + BATH.x1) / 2, 0.6, z, rotY);
		tiles(showerX - BATH.x0, H - 1.2, (BATH.x0 + showerX) / 2, (H + 1.2) / 2, z, rotY); // in the shower, on up
	}
	for (const [z0, z1] of [[BATH.z0, BATH_DOOR.z0], [BATH_DOOR.z1, BATH.z1]] as const) tiles(z1 - z0, 1.2, BATH.x1 - 0.002, 0.6, (z0 + z1) / 2, -Math.PI / 2);
	// the far wall, round its window
	const fx = BATH.x0 + 0.002, wz = (BATH_WIN.z0 + BATH_WIN.z1) / 2, ww = BATH_WIN.z1 - BATH_WIN.z0;
	tiles(BATH_WIN.z0 - BATH.z0, H, fx, H / 2, (BATH.z0 + BATH_WIN.z0) / 2, Math.PI / 2);
	tiles(BATH.z1 - BATH_WIN.z1, H, fx, H / 2, (BATH_WIN.z1 + BATH.z1) / 2, Math.PI / 2);
	tiles(ww, BATH_WIN.sill, fx, BATH_WIN.sill / 2, wz, Math.PI / 2);
	tiles(ww, H - BATH_WIN.top, fx, (H + BATH_WIN.top) / 2, wz, Math.PI / 2);
	place(washbasin({ w: 0.6 }), -5.45, BATH.z1, Math.PI);
	place(wallToilet(), -6.3, BATH.z1, Math.PI);
	place(towelRadiator(), -6.25, BATH.z0);
	place(glassShower({ w: BATH.z1 - BATH.z0, d: showerX - BATH.x0, ceiling: H }), BATH.x0, (BATH.z0 + BATH.z1) / 2, Math.PI / 2);
	const spotGlass = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4e2', emissiveIntensity: 0 });
	for (const x of [BATH.x1 - 0.8, BATH.x0 + 1.25]) {
		const disc = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), spotGlass);
		disc.rotation.x = Math.PI / 2;
		disc.position.set(x, H - 0.002, (BATH.z0 + BATH.z1) / 2);
		scene.add(disc);
	}
	// the spots' light: down from the ceiling, wide
	const bathLight = downlight('#fff1dc', 6, 1.25, 0.9, new THREE.Vector3((BATH.x0 + BATH.x1) / 2, H - 0.03, (BATH.z0 + BATH.z1) / 2));

	/* ── outside the kitchen's and the bathroom's windows: the courtyard, a white house across it ── */
	const facade = new THREE.Mesh(new THREE.BoxGeometry(1, 14, 18), new THREE.MeshStandardMaterial({ color: '#efeee9', roughness: 0.9 }));
	facade.position.set(-14, 3.5, 2);
	outside.add(facade);
	const pane = new THREE.MeshStandardMaterial({ color: '#7d8c98', roughness: 0.3 });
	for (let r = 0; r < 4; r++)
		for (let k = 0; k < 6; k++) {
			const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), pane);
			w.rotation.y = Math.PI / 2;
			w.position.set(-13.49, -1.2 + r * 2.6, -4 + k * 2.4);
			outside.add(w);
		}
	const yard = new THREE.Mesh(new THREE.PlaneGeometry(10, 30), new THREE.MeshStandardMaterial({ color: '#8a8780', roughness: 1 }));
	yard.rotation.x = -Math.PI / 2;
	yard.position.set(-14.5, -3.21, 2); // the apartment is on an upper floor
	outside.add(yard);

	const M = 0.18; // how close to a wall one may stand, as in the room
	const through = (z0: number, z1: number): Rect => [ARM.x0 - T - M - 0.02, ARM.x0 + M + 0.02, z0 + M, z1 - M];
	return {
		walk: [
			[HALL.x0 + M, HALL.x1 - M, HALL.z0 + M, HALL.z1 - M],
			[ARM.x0 + M, ARM.x1 - M, HALL.z0 + M, ARM.z1 - M],
			[KITCHEN.x0 + M, KITCHEN.x1 - M, KITCHEN.z0 + M, KITCHEN.z1 - M],
			[BATH.x0 + M, BATH.x1 - M, BATH.z0 + M, BATH.z1 - M],
			through(KITCHEN_DOOR.z0, KITCHEN_DOOR.z1),
			through(BATH_DOOR.z0, BATH_DOOR.z1)
		],
		solid: [
			[-2.3, -1.8, HALL.z0, HALL.z0 + CRATE.d + 0.02], // the shoe rack
			[HALL.x0, HALL.x0 + 0.6, HALL.z0, HALL.z0 + 0.62], // the fridge
			[ARM.x1 - 0.45, ARM.x1, 2.5, 4.8], // the bar
			[ARM.x1 - 0.82, ARM.x1 - 0.42, 2.6, 4.7], // its stools
			[ARM.x1 - 0.48, ARM.x1 - 0.12, ARM.z1 - 0.5, ARM.z1 - 0.14], // the coat stand
			[BATH.x1 - 0.86, BATH.x1, BATH_DOOR.z0 - 0.02, BATH_DOOR.z0 + 0.06], // the bathroom's door, open into it
			[KITCHEN.x0, KITCHEN.x0 + 1.8, KITCHEN.z0, KITCHEN.z0 + 0.62], // the cabinets
			[KITCHEN.x0, KITCHEN.x0 + 0.62, KITCHEN_WIN.z0 - 0.06, KITCHEN_WIN.z1 + 0.06], // the dryer
			[run + 0.92, run + 1.38, KITCHEN.z0, KITCHEN.z0 + 0.42], // the X-shelf
			[KITCHEN.x0 + 0.1, KITCHEN.x0 + 0.6, KITCHEN.z1 - CRATE.d - 0.02, KITCHEN.z1], // the pantry
			[run - 0.16, run + 0.16, 1.74, 2.06], // the bin
			[-5.75, -5.15, BATH.z1 - 0.42, BATH.z1], // the basin
			[-6.5, -6.1, BATH.z1 - 0.56, BATH.z1], // the WC
			[-6.5, -6.0, BATH.z0, BATH.z0 + 0.1], // the radiator
			[BATH.x0, showerX, BATH.z0, BATH.z1] // the shower
		],
		lamps: [
			{ light: hallLight, share: 2.6, glass: pendant.userData.glass as THREE.MeshStandardMaterial, glow: 1, color: hallLight.color.clone() },
			{ light: kitchenLight, share: 1.2, glass: kitchenBulb.userData.glass as THREE.MeshStandardMaterial, glow: 0.8, color: kitchenLight.color.clone() },
			{ light: bathLight, share: 2.4, glass: spotGlass, glow: 1.2, color: bathLight.color.clone() }
		],
		daylights: [kitchenDay, bathDay]
	};
}
