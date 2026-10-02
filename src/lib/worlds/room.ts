/*
 * THE ROOM — a real bedroom, built from photos to its measure (Day 02, "thinking outside the box"): about 14 m²,
 * 3.10 m wide and 4.50 m long, 2.55 m high. The bed (140 × 200) against the back wall between two shelves of wine
 * crates, the window in the right wall with its deep reveal, the radiator under it and the curtain knotted to one
 * side, a red café chair by the window, a brown school chair by the left wall, the door in the front wall, the picture
 * between the window and the front corner, the sheepskin at the foot of the bed, a yellow Edison bulb on a short cord.
 * Its furniture is the 3D models' (src/lib/models). Walked like every sandbox (the kit's walker, at a room's pace) and
 * shot like every sandbox (connectFilm: `world.sandbox: 'room'`; the bulb is the shot's `lamps` light).
 *
 * Its axes: x across the room (−1.55 the left wall, +1.55 the window wall), z along it (−2.25 the back wall behind
 * the bed, +2.25 the front wall with the door), y up from the floor. Metres.
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { connectFilm, createSky, createStage, createWalker, filmDraws, filmHoldsSize } from '$lib/sandbox-kit';
import { CRATE, bed, chair, crateTower, edisonBulb, framedPicture, sheepskin } from '$lib/models/furniture';
import { limedOak, plasterBump } from '$lib/models/textures';

/** The room's measure (m). */
export const ROOM = { width: 3.1, length: 4.5, height: 2.55 } as const;
const W = ROOM.width / 2, L = ROOM.length / 2, H = ROOM.height;
/** the window in the right wall: along z, its sill and its top, its reveal's depth */
const WIN = { z0: -1.2, z1: 0.1, sill: 0.85, top: 2.35, depth: 0.32 } as const;
/** the door in the front wall: across x */
const DOOR = { x0: -0.75, x1: 0.1, top: 2.0 } as const;
const BULB = { x: 0, z: 0.3, drop: 0.32 } as const;

export type RoomHandle = { move: (x: number, y: number, hurry: boolean) => void; look: (dx: number, dy: number) => void; dispose: () => void };

export async function mountRoom(container: HTMLElement, onProgress: (label: string) => void = () => {}): Promise<RoomHandle> {
	RectAreaLightUniformsLib.init();
	const stage = createStage(container);
	const { renderer, scene, camera } = stage;
	camera.near = 0.03;
	camera.updateProjectionMatrix();

	// the light: the sun through the window (the sky's, with its shadows), the daylight off the sky as a soft light
	// filling the window, and the bulb — warm, glowing more as the day goes (and as a shot turns it up: its `lamps`)
	const lamp = edisonBulb({ drop: BULB.drop });
	const glass = lamp.userData.glass as THREE.MeshPhysicalMaterial;
	const bulbLight = new THREE.PointLight('#ffad55', 1.6, 8, 2);
	bulbLight.castShadow = true;
	bulbLight.shadow.mapSize.set(1024, 1024);
	bulbLight.shadow.bias = -0.002;
	bulbLight.shadow.radius = 4;
	const daylight = new THREE.RectAreaLight('#e8eefc', 3, WIN.z1 - WIN.z0, WIN.top - WIN.sill);
	let bulbBase = 1.6, dayBase = 3;
	const sky = createSky(renderer, scene, {
		shadowReach: 9,
		shadowMap: 2048,
		// a room is small: the sun stands near and its shadows' depth is short, so their bias (a share of that depth)
		// stays a centimetre — over a sky's 1400 m it is half a metre, and the sun shone in over the walls' tops
		lightDistance: 40,
		shadowNear: 5,
		shadowFar: 80,
		shadowBias: { bias: -0.0002, normal: 0.01 },
		fog: { near: 60, far: 900 },
		onHour: ({ night }) => {
			bulbBase = 0.9 + 2.4 * night;
			bulbLight.intensity = bulbBase;
			glass.emissiveIntensity = 0.5 + 2.2 * night;
			dayBase = 4.2 * (1 - night) + 0.15;
			daylight.intensity = dayBase;
		}
	});
	onProgress('Building the room');

	const plaster = plasterBump();
	plaster.repeat.set(3, 3);
	const mat = {
		wall: new THREE.MeshStandardMaterial({ color: '#f3eee5', roughness: 0.93, bumpMap: plaster, bumpScale: 0.6 }),
		ceiling: new THREE.MeshStandardMaterial({ color: '#f6f4ef', roughness: 0.96, bumpMap: plaster, bumpScale: 0.4 }),
		white: new THREE.MeshStandardMaterial({ color: '#f4f3ef', roughness: 0.42 }),
		pvc: new THREE.MeshStandardMaterial({ color: '#f7f7f4', roughness: 0.35 }),
		sill: new THREE.MeshStandardMaterial({ color: '#d8d3c9', roughness: 0.45 }),
		glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.03, transparent: true, opacity: 0.1, depthWrite: false }),
		radiator: new THREE.MeshStandardMaterial({ color: '#f2f1ec', roughness: 0.4 }),
		grille: new THREE.MeshStandardMaterial({ color: '#5d5f61', roughness: 0.5, metalness: 0.4 }),
		curtain: new THREE.MeshPhysicalMaterial({ color: '#6c6b6f', roughness: 0.95, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color('#9a999e'), side: THREE.DoubleSide }),
		blanket: new THREE.MeshPhysicalMaterial({ color: '#b9c9d6', roughness: 0.95, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color('#e3edf5') }),
		handle: new THREE.MeshStandardMaterial({ color: '#d7d4cc', roughness: 0.25, metalness: 0.8 }),
		vent: new THREE.MeshStandardMaterial({ color: '#d9cbb0', roughness: 0.6 }),
		hole: new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8 }),
		shade: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, depthWrite: false })
	};
	const floorTex = limedOak();
	floorTex.repeat.set(ROOM.width / 1.08, ROOM.length / 2.4);
	const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.58 });

	const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
		const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
		b.position.set(x, y, z);
		b.castShadow = shadow;
		b.receiveShadow = true;
		scene.add(b);
		return b;
	};

	/* ── the shell: the oak floor, the ceiling, four walls, the window's opening ── */
	const T = 0.15; // the walls' thickness, outside the room
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.length), floorMat);
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = true;
	scene.add(floor);
	box(ROOM.width + 2 * T + 0.7, T, ROOM.length + 2 * T, mat.ceiling, 0.35, H + T / 2, 0);
	box(ROOM.width + 2 * T + 0.7, H, T, mat.wall, 0.35, H / 2, -L - T / 2); // the back wall, behind the bed
	box(T, H, ROOM.length, mat.wall, -W - T / 2, H / 2, 0); // the left wall
	// the front wall, round the door
	box(DOOR.x0 + W + T, H, T, mat.wall, (-W - T + DOOR.x0) / 2, H / 2, L + T / 2);
	box(W + 0.7 - DOOR.x1, H, T, mat.wall, (DOOR.x1 + W + 0.7) / 2, H / 2, L + T / 2);
	box(DOOR.x1 - DOOR.x0, H - DOOR.top, T, mat.wall, (DOOR.x0 + DOOR.x1) / 2, (H + DOOR.top) / 2, L + T / 2);
	// the window wall, round its opening, as deep as the window's reveal
	const RT = WIN.depth;
	box(RT, H, WIN.z0 + L, mat.wall, W + RT / 2, H / 2, (-L + WIN.z0) / 2);
	box(RT, H, L - WIN.z1, mat.wall, W + RT / 2, H / 2, (WIN.z1 + L) / 2);
	box(RT, WIN.sill, WIN.z1 - WIN.z0, mat.wall, W + RT / 2, WIN.sill / 2, (WIN.z0 + WIN.z1) / 2);
	box(RT, H - WIN.top, WIN.z1 - WIN.z0, mat.wall, W + RT / 2, (H + WIN.top) / 2, (WIN.z0 + WIN.z1) / 2);
	// skirting, low and white, round the floor (not across the door)
	for (const [w, d, x, z] of [
		[ROOM.width, 0.014, 0, -L + 0.007],
		[0.014, ROOM.length, -W + 0.007, 0],
		[0.014, ROOM.length, W - 0.007, 0],
		[DOOR.x0 + W, 0.014, (-W + DOOR.x0) / 2, L - 0.007],
		[W - DOOR.x1, 0.014, (DOOR.x1 + W) / 2, L - 0.007]
	] as const)
		box(w, 0.06, d, mat.white, x, 0.03, z, false);
	// the corners darken a little where the light reaches them less (floor and ceiling edges): soft shade strips
	const shadeTex = (() => {
		const c = document.createElement('canvas');
		c.width = 2;
		c.height = 64;
		const x = c.getContext('2d')!;
		const g = x.createLinearGradient(0, 0, 0, 64);
		g.addColorStop(0, 'rgba(0,0,0,0.32)');
		g.addColorStop(1, 'rgba(0,0,0,0)');
		x.fillStyle = g;
		x.fillRect(0, 0, 2, 64);
		return new THREE.CanvasTexture(c);
	})();
	const shadeMat = new THREE.MeshBasicMaterial({ map: shadeTex, transparent: true, depthWrite: false });
	const strip = (len: number, size: number, pos: THREE.Vector3, rot: THREE.Euler) => {
		const s = new THREE.Mesh(new THREE.PlaneGeometry(len, size), shadeMat);
		s.position.copy(pos);
		s.rotation.copy(rot);
		s.renderOrder = 1;
		scene.add(s);
	};
	// on each wall, at the floor (rising) and at the ceiling (falling)
	for (const [len, at, rotY] of [
		[ROOM.width, new THREE.Vector3(0, 0, -L + 0.002), 0],
		[ROOM.length, new THREE.Vector3(-W + 0.002, 0, 0), Math.PI / 2],
		[ROOM.length, new THREE.Vector3(W - 0.002, 0, 0), -Math.PI / 2],
		[ROOM.width, new THREE.Vector3(0, 0, L - 0.002), Math.PI]
	] as const) {
		strip(len, 0.35, at.clone().setY(0.175), new THREE.Euler(0, rotY, Math.PI));
		strip(len, 0.3, at.clone().setY(H - 0.15), new THREE.Euler(0, rotY, 0));
	}

	/* ── the window: a white tilt-and-turn window, its glass, a stone sill, the radiator, the curtain knotted aside ── */
	const wx = W + RT - 0.07; // the frame sits towards the outside of the reveal
	const wmid = (WIN.z0 + WIN.z1) / 2, wlen = WIN.z1 - WIN.z0, wh = WIN.top - WIN.sill;
	// the outer frame
	for (const z of [WIN.z0 + 0.035, WIN.z1 - 0.035]) box(0.08, wh, 0.07, mat.pvc, wx, WIN.sill + wh / 2, z);
	for (const y of [WIN.sill + 0.035, WIN.top - 0.035]) box(0.08, 0.07, wlen, mat.pvc, wx, y, wmid);
	// the sash, a little inside it, and its handle
	const sz0 = WIN.z0 + 0.07, sz1 = WIN.z1 - 0.07, sy0 = WIN.sill + 0.07, sy1 = WIN.top - 0.07;
	for (const z of [sz0 + 0.03, sz1 - 0.03]) box(0.07, sy1 - sy0, 0.06, mat.pvc, wx - 0.03, (sy0 + sy1) / 2, z);
	for (const y of [sy0 + 0.03, sy1 - 0.03]) box(0.07, 0.06, sz1 - sz0, mat.pvc, wx - 0.03, y, (sz0 + sz1) / 2);
	box(0.03, 0.14, 0.025, mat.pvc, wx - 0.08, WIN.sill + wh * 0.55, sz1 - 0.04, false);
	const pane = new THREE.Mesh(new THREE.PlaneGeometry(sz1 - sz0 - 0.1, sy1 - sy0 - 0.1), mat.glass);
	pane.rotation.y = -Math.PI / 2;
	pane.position.set(wx - 0.02, (sy0 + sy1) / 2, (sz0 + sz1) / 2);
	scene.add(pane);
	box(RT + 0.05, 0.03, wlen + 0.06, mat.sill, W + RT / 2 - 0.025, WIN.sill + 0.015, wmid); // the sill, a little proud
	// the daylight: the window as a soft light, facing into the room
	daylight.position.set(W + 0.02, WIN.sill + wh / 2, wmid);
	daylight.lookAt(0, WIN.sill + wh / 2 - 0.3, wmid);
	scene.add(daylight);
	// on the sill: a light blue blanket, folded
	const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.5, 4, 2, 6), mat.blanket);
	const bp = blanket.geometry.attributes.position!;
	for (let i = 0; i < bp.count; i++) bp.setY(i, bp.getY(i) + Math.sin(bp.getZ(i) * 14 + bp.getX(i) * 9) * 0.012);
	blanket.geometry.computeVertexNormals();
	blanket.position.set(W + 0.1, WIN.sill + 0.07, WIN.z0 + 0.32);
	blanket.rotation.y = 0.15;
	blanket.castShadow = blanket.receiveShadow = true;
	scene.add(blanket);
	// the radiator: a flat white panel with its fins, a grille on top, the valve below
	const radW = 1.12, radH = 0.6, radY = 0.14;
	box(0.07, radH, radW, mat.radiator, W - 0.06, radY + radH / 2, wmid);
	for (let i = 0; i < 28; i++) box(0.012, radH - 0.04, 0.008, mat.radiator, W - 0.1, radY + radH / 2, wmid - radW / 2 + 0.03 + (i * (radW - 0.06)) / 27, false);
	box(0.09, 0.012, radW, mat.grille, W - 0.06, radY + radH + 0.006, wmid, false);
	box(0.04, 0.05, 0.04, mat.handle, W - 0.06, radY - 0.04, wmid - radW / 2 - 0.03, false);
	// the curtain: on a rod over the window, pulled to the front end and knotted — cloth in folds
	box(0.018, 0.018, wlen + 0.5, mat.grille, W - 0.05, WIN.top + 0.12, wmid, false);
	const drapeGeo = new THREE.PlaneGeometry(0.62, 1.7, 24, 30);
	const dp = drapeGeo.attributes.position!;
	for (let i = 0; i < dp.count; i++) {
		const x = dp.getX(i), y = dp.getY(i); // y from +0.85 (the rod) to −0.85
		const t = (0.85 - y) / 1.7; // 0 at the rod, 1 at the hem
		const gather = 1 - 0.75 * Math.min(1, t * 1.6); // gathered into the knot
		dp.setX(i, x * gather);
		dp.setZ(i, Math.sin(x * 26) * 0.035 * (0.4 + gather));
	}
	drapeGeo.computeVertexNormals();
	const drape = new THREE.Mesh(drapeGeo, mat.curtain);
	drape.rotation.y = -Math.PI / 2;
	drape.position.set(W - 0.12, WIN.top + 0.12 - 0.85, WIN.z1 - 0.2);
	drape.castShadow = true;
	scene.add(drape);
	const knot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), mat.curtain);
	knot.scale.set(0.8, 1.2, 1);
	knot.position.set(W - 0.12, WIN.top - 0.85, WIN.z1 - 0.2);
	knot.castShadow = true;
	scene.add(knot);
	const swagGeo = new THREE.PlaneGeometry(wlen * 0.75, 0.42, 30, 6);
	const sp = swagGeo.attributes.position!;
	for (let i = 0; i < sp.count; i++) {
		const x = sp.getX(i), y = sp.getY(i);
		sp.setY(i, y - (1 - ((2 * x) / (wlen * 0.75)) ** 2) * 0.08 * (0.21 - y));
		sp.setZ(i, Math.sin(x * 30 + y * 6) * 0.02);
	}
	swagGeo.computeVertexNormals();
	const swag = new THREE.Mesh(swagGeo, mat.curtain);
	swag.rotation.y = -Math.PI / 2;
	swag.position.set(W - 0.1, WIN.top - 0.06, WIN.z1 - 0.2 - wlen * 0.36);
	scene.add(swag);

	/* ── outside the window: trees in autumn and the white house over the road ── */
	const outside = new THREE.Group();
	const leaf = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true });
	const leaves = [leaf('#7f9a3a'), leaf('#a8a336'), leaf('#c4772f'), leaf('#6c8a34'), leaf('#b8562c')];
	for (let i = 0; i < 14; i++) {
		const t = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + (i % 3) * 0.5, 1), leaves[i % leaves.length]!);
		t.position.set(5 + (i % 4) * 1.1, 0.8 + ((i * 7) % 5) * 0.55, -4 + i * 0.62);
		outside.add(t);
	}
	const house = new THREE.Mesh(new THREE.BoxGeometry(2, 12, 18), new THREE.MeshStandardMaterial({ color: '#ecebe6', roughness: 0.9 }));
	house.position.set(16, 3.5, -1);
	outside.add(house);
	for (let r = 0; r < 4; r++)
		for (let c = 0; c < 7; c++) {
			const win = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.4), new THREE.MeshStandardMaterial({ color: '#7c8a96', roughness: 0.3 }));
			win.rotation.y = -Math.PI / 2;
			win.position.set(14.98, 0.5 + r * 2.6, -8 + c * 2.4);
			outside.add(win);
		}
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#59683f', roughness: 1 }));
	ground.rotation.x = -Math.PI / 2;
	ground.position.set(20, -3.2, 0); // the room is on an upper floor
	outside.add(ground);
	scene.add(outside);

	/* ── the furniture (the 3D models) ── */
	const place = (o: THREE.Object3D, x: number, z: number, rotY = 0, y = 0) => {
		o.position.set(x, y, z);
		o.rotation.y = rotY;
		scene.add(o);
		return o;
	};
	const bedAt = { x: -0.05, w: 1.4, len: 2.0 };
	place(bed({ width: bedAt.w, length: bedAt.len }), bedAt.x, -L + 0.03 + bedAt.len / 2);
	const leftX = bedAt.x - bedAt.w / 2 - 0.1 - CRATE.w / 2, rightX = bedAt.x + bedAt.w / 2 + 0.1 + CRATE.w / 2;
	place(crateTower(['white', 'pine', 'dark']), leftX, -L + CRATE.d / 2 + 0.01);
	place(crateTower(['white', 'white', 'pine']), rightX, -L + CRATE.d / 2 + 0.01);
	// what is in them: folded clothes, books, a box — soft shapes, enough to read as lived in
	const stuff = [new THREE.MeshStandardMaterial({ color: '#2c3540', roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#c9c3b6', roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 0.8 })];
	for (const x of [leftX, rightX])
		for (let i = 0; i < 3; i++)
			for (const lvl of [0.03, CRATE.h / 2 + 0.01]) box(0.36, 0.08 + ((i + lvl * 10) % 3) * 0.02, 0.22, stuff[(i + (lvl > 0.1 ? 1 : 0)) % stuff.length]!, x + (i - 1) * 0.02, i * CRATE.h + lvl + 0.055, -L + 0.19, false);
	place(chair('red'), W - 0.45, -0.05, -Math.PI / 2 + 0.3);
	place(chair('leather'), -W + 0.32, -1.3, Math.PI / 2 - 0.25);
	place(sheepskin(), bedAt.x + 0.1, -L + bedAt.len + 0.55, 0.25);
	// the picture: on the window wall, between the window and the front corner
	place(framedPicture(), W, 1.05, -Math.PI / 2, 1.5);

	/* ── the door: a white flush door in its frame, a lever handle, the vent at its foot ── */
	const door = box(DOOR.x1 - DOOR.x0 - 0.02, DOOR.top - 0.01, 0.04, mat.white, (DOOR.x0 + DOOR.x1) / 2, DOOR.top / 2, L - 0.02);
	door.receiveShadow = true;
	for (const [w, h, x, y] of [
		[0.06, DOOR.top + 0.06, DOOR.x0 - 0.025, (DOOR.top + 0.06) / 2],
		[0.06, DOOR.top + 0.06, DOOR.x1 + 0.025, (DOOR.top + 0.06) / 2],
		[DOOR.x1 - DOOR.x0 + 0.11, 0.06, (DOOR.x0 + DOOR.x1) / 2, DOOR.top + 0.03]
	] as const)
		box(w, h, 0.03, mat.white, x, y, L - 0.015, false);
	// the handle on the side away from the hinges: a rose, a lever
	const hx = DOOR.x1 - 0.1;
	const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 20), mat.handle);
	rose.rotation.x = Math.PI / 2;
	rose.position.set(hx, 1.05, L - 0.045);
	scene.add(rose);
	box(0.13, 0.018, 0.02, mat.handle, hx - 0.055, 1.05, L - 0.06, false);
	box(0.025, 0.06, 0.006, mat.handle, hx, 0.98, L - 0.043, false);
	// the vent: slats at the door's foot
	for (let i = 0; i < 5; i++) box(0.42, 0.008, 0.006, mat.vent, (DOOR.x0 + DOOR.x1) / 2, 0.05 + i * 0.012, L - 0.041, false);

	/* ── in the walls and on the ceiling: the round flush boxes, the smoke detector ── */
	for (const [x, y, z, ry] of [
		[-W + 0.004, 0.3, 1.6, Math.PI / 2],
		[-W + 0.004, 1.15, 1.9, Math.PI / 2],
		[W - 0.004, 1.1, 1.75, -Math.PI / 2],
		[0.55, 0.3, L - 0.004, Math.PI],
		[0.55, 1.12, L - 0.004, Math.PI]
	] as const) {
		const ring = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.035, 24), mat.white);
		const hole = new THREE.Mesh(new THREE.CircleGeometry(0.018, 24), mat.hole);
		for (const o of [ring, hole]) {
			o.position.set(x, y, z);
			o.rotation.y = ry;
			scene.add(o);
		}
	}
	const smoke = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.035, 24), mat.white);
	smoke.position.set(-0.6, H - 0.0175, 1.1);
	scene.add(smoke);

	/* ── the bulb: hung from the ceiling, its light at its glass ── */
	place(lamp, BULB.x, BULB.z, 0, H);
	bulbLight.position.set(BULB.x, H, BULB.z).add(lamp.userData.light as THREE.Vector3);
	scene.add(bulbLight);

	// indoors the sky reaches only through the window: its light off every surface is turned down to what a room gets
	// (the outside keeps the full sky)
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh) || outside.children.includes(o)) return;
		for (const m of [o.material].flat()) if (m instanceof THREE.MeshStandardMaterial) m.envMapIntensity = 0.3;
	});

	/* ── walking it: at a room's pace, kept off the walls and out of the furniture ── */
	const solid: [number, number, number, number][] = [
		[bedAt.x - bedAt.w / 2 - 0.05, bedAt.x + bedAt.w / 2 + 0.05, -L, -L + bedAt.len + 0.06], // the bed
		[leftX - CRATE.w / 2, leftX + CRATE.w / 2, -L, -L + CRATE.d + 0.02],
		[rightX - CRATE.w / 2, rightX + CRATE.w / 2, -L, -L + CRATE.d + 0.02],
		[W - 0.7, W, -0.3, 0.2], // the red chair
		[-W, -W + 0.58, -1.55, -1.05], // the brown chair
		[W - 0.12, W, WIN.z0, WIN.z1] // the radiator
	];
	const M = 0.18; // how close to a wall or a thing you may stand
	const canStand = (x: number, z: number) =>
		Math.abs(x) < W - M && z > -L + M && z < L - M && !solid.some(([x0, x1, z0, z1]) => x > x0 - M && x < x1 + M && z > z0 - M && z < z1 + M);
	const walker = createWalker(camera, renderer.domElement, { x: -0.3, z: 1.75, yaw: 0.12, pitch: -0.05, eye: 1.62, walk: 1.3, hurry: 2.6, stride: 0.12, canStand });
	onProgress('ready');

	let frame = 0, last = performance.now();
	const tick = () => {
		const now = performance.now();
		walker.update(Math.min(0.1, (now - last) / 1000));
		sky.follow(0, 0); // the room stands still: its shadows are always the room's
		sky.tick(now);
		if (!filmDraws()) renderer.render(scene, camera);
		stage.adapt(now, filmHoldsSize());
		last = now;
		frame = requestAnimationFrame(tick);
	};
	tick();

	const film = connectFilm({
		sandbox: 'room',
		renderer,
		scene,
		camera,
		hold: walker,
		sky,
		place: walker.place,
		// the hour gives the bulb and the daylight their strength first, then the shot's own `lamps`
		advance: () => {
			bulbLight.intensity = bulbBase;
			daylight.intensity = dayBase;
		},
		lights: {
			lamps: (k: number, color?: string) => {
				bulbLight.intensity = bulbBase * k;
				glass.emissiveIntensity *= k;
				if (color) bulbLight.color.set(color);
			}
		}
	});

	return {
		move: walker.move,
		look: walker.look,
		dispose() {
			cancelAnimationFrame(frame);
			film.disconnect();
			walker.dispose();
			sky.dispose();
			stage.dispose();
		}
	};
}
