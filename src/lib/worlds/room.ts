/*
 * THE ROOM — a real bedroom, built from photos to its measure (Day 02, "thinking outside the box"): about 14 m²,
 * 3.10 m wide and 4.50 m long, 2.55 m high. Only what makes it: the bed (140 × 200) against the back wall between two
 * towers of wine crates, the window in the right wall with the radiator under it and the curtain knotted to one side,
 * a red chair by the window, a brown one by the left wall, the door in the front wall, and a yellow retro bulb hanging
 * from the ceiling. Walked like every sandbox (the kit's walker, at a room's pace) and shot like every sandbox
 * (connectFilm: `world.sandbox: 'room'`; the bulb is the shot's `lamps` light).
 *
 * Its axes: x across the room (−1.55 the left wall, +1.55 the window wall), z along it (−2.25 the back wall behind
 * the bed, +2.25 the front wall with the door), y up from the floor. Metres.
 */
import * as THREE from 'three';
import { connectFilm, createSky, createStage, createWalker, filmDraws, filmHoldsSize, worldTime } from '$lib/sandbox-kit';
import { oak } from '$lib/sandbox-2/interior/textures';

/** The room's measure (m). */
export const ROOM = { width: 3.1, length: 4.5, height: 2.55 } as const;
const W = ROOM.width / 2, L = ROOM.length / 2, H = ROOM.height;
/** the window in the right wall: along z, its sill and its top */
const WIN = { z0: -1.2, z1: 0.1, sill: 0.85, top: 2.35, depth: 0.32 } as const;
/** the door in the front wall: across x */
const DOOR = { x0: -1.35, x1: -0.5, top: 2.0 } as const;
const BULB = { x: 0, z: 0.3, drop: 0.32 } as const;

export type RoomHandle = { move: (x: number, y: number, hurry: boolean) => void; look: (dx: number, dy: number) => void; dispose: () => void };

export async function mountRoom(container: HTMLElement, onProgress: (label: string) => void = () => {}): Promise<RoomHandle> {
	const stage = createStage(container);
	const { renderer, scene, camera } = stage;
	camera.near = 0.05;
	camera.updateProjectionMatrix();

	// the bulb: warm, glowing more as the day goes (and as a shot turns it up: its `lamps`)
	const bulbGlass = new THREE.MeshStandardMaterial({ color: '#f1b34c', emissive: '#ffb347', emissiveIntensity: 1.2, roughness: 0.2, transparent: true, opacity: 0.92 });
	const bulbLight = new THREE.PointLight('#ffb35a', 1.6, 9, 2);
	bulbLight.castShadow = true;
	bulbLight.shadow.mapSize.set(1024, 1024);
	bulbLight.shadow.bias = -0.002;
	let bulbBase = 1.6;
	const sky = createSky(renderer, scene, {
		// a room's reach: the sun through the window casts crisp shadows on the floor
		shadowReach: 9,
		shadowMap: 2048,
		fog: { near: 60, far: 900 },
		onHour: ({ night }) => {
			bulbBase = 1.2 + 2.2 * night;
			bulbLight.intensity = bulbBase;
			bulbGlass.emissiveIntensity = 1 + 2.5 * night;
		}
	});
	onProgress('Building the room');

	const mat = {
		wall: new THREE.MeshStandardMaterial({ color: '#f3ede2', roughness: 0.92 }),
		ceiling: new THREE.MeshStandardMaterial({ color: '#f5f3ef', roughness: 0.95 }),
		white: new THREE.MeshStandardMaterial({ color: '#f4f4f1', roughness: 0.5 }),
		sill: new THREE.MeshStandardMaterial({ color: '#d9d4c8', roughness: 0.6 }),
		glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0.95, transparent: true, opacity: 0.15, depthWrite: false }),
		pine: new THREE.MeshStandardMaterial({ color: '#c99a62', roughness: 0.75 }),
		pineDark: new THREE.MeshStandardMaterial({ color: '#a8743f', roughness: 0.8 }),
		crateWhite: new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.8 }),
		bedOak: new THREE.MeshStandardMaterial({ color: '#c48d55', roughness: 0.7 }),
		sheet: new THREE.MeshStandardMaterial({ color: '#7f9fb4', roughness: 0.95 }),
		duvet: new THREE.MeshStandardMaterial({ color: '#8d8c88', roughness: 1 }),
		cushion: new THREE.MeshStandardMaterial({ color: '#e0a63a', roughness: 0.95 }),
		red: new THREE.MeshStandardMaterial({ color: '#b8242a', roughness: 0.5 }),
		leather: new THREE.MeshStandardMaterial({ color: '#8b4a2b', roughness: 0.55 }),
		steel: new THREE.MeshStandardMaterial({ color: '#8a8c8f', roughness: 0.35, metalness: 0.7 }),
		curtain: new THREE.MeshStandardMaterial({ color: '#77767b', roughness: 1, side: THREE.DoubleSide }),
		cord: new THREE.MeshStandardMaterial({ color: '#1d1d1d', roughness: 0.6 }),
		socket: new THREE.MeshStandardMaterial({ color: '#f6f6f3', roughness: 0.4 }),
		handle: new THREE.MeshStandardMaterial({ color: '#c9c6bd', roughness: 0.3, metalness: 0.6 })
	};
	const floorTex = oak();
	floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
	floorTex.repeat.set(ROOM.width / 1.2, ROOM.length / 1.2);
	const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 });

	const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
		const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
		b.position.set(x, y, z);
		b.castShadow = shadow;
		b.receiveShadow = true;
		scene.add(b);
		return b;
	};

	/* ── the shell: floor, ceiling, four walls, the window's opening in the right wall ── */
	const T = 0.15; // the walls' thickness, outside the room
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.length), floorMat);
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = true;
	scene.add(floor);
	box(ROOM.width + 2 * T, T, ROOM.length + 2 * T, mat.ceiling, 0, H + T / 2, 0);
	box(ROOM.width + 2 * T, H, T, mat.wall, 0, H / 2, -L - T / 2); // the back wall, behind the bed
	box(T, H, ROOM.length, mat.wall, -W - T / 2, H / 2, 0); // the left wall
	// the front wall, round the door
	box(DOOR.x0 + W, H, T, mat.wall, (-W + DOOR.x0) / 2, H / 2, L + T / 2);
	box(W - DOOR.x1, H, T, mat.wall, (DOOR.x1 + W) / 2, H / 2, L + T / 2);
	box(DOOR.x1 - DOOR.x0, H - DOOR.top, T, mat.wall, (DOOR.x0 + DOOR.x1) / 2, (H + DOOR.top) / 2, L + T / 2);
	// the window wall, round its opening, as deep as the window's reveal
	const RT = WIN.depth;
	box(RT, H, WIN.z0 + L, mat.wall, W + RT / 2, H / 2, (-L + WIN.z0) / 2);
	box(RT, H, L - WIN.z1, mat.wall, W + RT / 2, H / 2, (WIN.z1 + L) / 2);
	box(RT, WIN.sill, WIN.z1 - WIN.z0, mat.wall, W + RT / 2, WIN.sill / 2, (WIN.z0 + WIN.z1) / 2);
	box(RT, H - WIN.top, WIN.z1 - WIN.z0, mat.wall, W + RT / 2, (H + WIN.top) / 2, (WIN.z0 + WIN.z1) / 2);
	// skirting, low and white, round the floor
	for (const [w, d, x, z] of [[ROOM.width, 0.015, 0, -L + 0.008], [0.015, ROOM.length, -W + 0.008, 0], [0.015, ROOM.length, W - 0.008, 0]] as const) box(w, 0.06, d, mat.white, x, 0.03, z, false);

	/* ── the window: a white frame, the glass, a stone sill, the radiator under it, the curtain knotted aside ── */
	const wx = W + RT - 0.06; // the frame sits towards the outside of the reveal
	const wmid = (WIN.z0 + WIN.z1) / 2, wlen = WIN.z1 - WIN.z0, wh = WIN.top - WIN.sill;
	for (const z of [WIN.z0 + 0.04, WIN.z1 - 0.04]) box(0.07, wh, 0.08, mat.white, wx, WIN.sill + wh / 2, z);
	for (const y of [WIN.sill + 0.04, WIN.top - 0.04]) box(0.07, 0.08, wlen, mat.white, wx, y, wmid);
	box(0.06, wh - 0.1, 0.06, mat.white, wx, WIN.sill + wh / 2, wmid + 0.15); // the casement's meeting stile
	const pane = new THREE.Mesh(new THREE.PlaneGeometry(wlen - 0.12, wh - 0.12), mat.glass);
	pane.rotation.y = -Math.PI / 2;
	pane.position.set(wx, WIN.sill + wh / 2, wmid);
	scene.add(pane);
	box(RT + 0.06, 0.04, wlen + 0.06, mat.sill, W + RT / 2 - 0.03, WIN.sill + 0.02, wmid); // the sill, a little proud
	// the radiator: a flat white panel with its grille on top
	box(0.1, 0.62, 1.12, mat.white, W - 0.07, 0.14 + 0.31, wmid);
	box(0.11, 0.02, 1.12, mat.steel, W - 0.07, 0.76, wmid, false);
	// the curtain: a grey drape on a rod over the window, pulled to the front end and knotted
	box(0.02, 0.02, wlen + 0.5, mat.steel, W - 0.05, WIN.top + 0.12, wmid, false);
	const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.08, 1.55, 14, 6, true), mat.curtain);
	drape.position.set(W - 0.14, WIN.top - 0.68, WIN.z1 - 0.12);
	drape.scale.set(0.6, 1, 1.2);
	drape.castShadow = true;
	scene.add(drape);
	const swag = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, wlen * 0.55, 10, 1, true), mat.curtain);
	swag.rotation.x = Math.PI / 2;
	swag.rotation.z = 0.35;
	swag.position.set(W - 0.12, WIN.top + 0.02, WIN.z1 - wlen * 0.3);
	scene.add(swag);

	/* ── outside the window: trees in autumn and the white house over the road ── */
	const outside = new THREE.Group();
	const leaf = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true });
	const leaves = [leaf('#7f9a3a'), leaf('#a8a336'), leaf('#c4772f'), leaf('#6c8a34')];
	for (let i = 0; i < 9; i++) {
		const t = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3 + (i % 3) * 0.4, 1), leaves[i % leaves.length]!);
		t.position.set(6 + (i % 3) * 1.4, 1.6 + (i % 2) * 1.2, -3.5 + i * 0.95);
		outside.add(t);
	}
	const house = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 14), new THREE.MeshStandardMaterial({ color: '#e9e7e2', roughness: 0.9 }));
	house.position.set(15, 3.5, -1);
	outside.add(house);
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#59683f', roughness: 1 }));
	ground.rotation.x = -Math.PI / 2;
	ground.position.set(20, -3.2, 0); // the room is on an upper floor
	outside.add(ground);
	scene.add(outside);

	/* ── the bed: a low oak frame, 140 × 200, the blue sheet, the grey duvet, two mustard cushions ── */
	const bed = { x: -0.05, z0: -L, w: 1.4, len: 2.0 };
	const bz = bed.z0 + bed.len / 2;
	box(bed.w + 0.08, 0.2, bed.len + 0.04, mat.bedOak, bed.x, 0.18, bz); // the frame's sides
	for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) box(0.12, 0.1, 0.12, mat.bedOak, bed.x + dx * (bed.w / 2 - 0.02), 0.05, bz + dz * (bed.len / 2 - 0.04));
	box(bed.w - 0.02, 0.2, bed.len - 0.04, mat.sheet, bed.x, 0.38, bz); // the mattress in its sheet
	box(bed.w + 0.08, 0.12, 0.06, mat.bedOak, bed.x, 0.54, bed.z0 + 0.03); // the head board, low
	// the duvet: crumpled over most of the bed (a box with its top pushed about)
	const duvetGeo = new THREE.BoxGeometry(bed.w + 0.04, 0.16, bed.len * 0.72, 10, 1, 12);
	const pos = duvetGeo.attributes.position!;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
		if (y > 0) pos.setY(i, y + Math.sin(x * 7.1 + z * 3.3) * 0.035 + Math.cos(z * 5.7) * 0.03);
		else if (Math.abs(x) > bed.w / 2 - 0.02) pos.setY(i, y - 0.08); // it hangs a little over the sides
	}
	duvetGeo.computeVertexNormals();
	const duvet = new THREE.Mesh(duvetGeo, mat.duvet);
	duvet.position.set(bed.x, 0.54, bed.z0 + bed.len * 0.62);
	duvet.castShadow = duvet.receiveShadow = true;
	scene.add(duvet);
	for (const dx of [-0.36, 0.34]) {
		const c = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), mat.cushion);
		c.scale.set(0.55, 0.22, 0.32);
		c.position.set(bed.x + dx, 0.62, bed.z0 + 0.22);
		c.rotation.x = -0.5;
		c.castShadow = true;
		scene.add(c);
	}

	/* ── the wine crates: a tower each side of the bed, open towards the room ── */
	const CRATE = { w: 0.5, h: 0.42, d: 0.33, t: 0.02 };
	const crate = (x: number, y: number, m: THREE.Material) => {
		const g = new THREE.Group();
		const part = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
			const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
			p.position.set(px, py, pz);
			p.castShadow = p.receiveShadow = true;
			g.add(p);
		};
		const { w, h, d, t } = CRATE;
		part(w, h, t, 0, h / 2, -d / 2 + t / 2); // the back, against the wall
		part(t, h, d, -w / 2 + t / 2, h / 2, 0);
		part(t, h, d, w / 2 - t / 2, h / 2, 0);
		part(w, t, d, 0, t / 2, 0);
		part(w, t, d, 0, h - t / 2, 0);
		part(w - 2 * t, t, d - t, 0, h / 2, t / 2); // a shelf in the middle
		g.position.set(x, y, -L + d / 2 + 0.01);
		scene.add(g);
		return g;
	};
	const leftX = bed.x - bed.w / 2 - 0.06 - CRATE.w / 2, rightX = bed.x + bed.w / 2 + 0.06 + CRATE.w / 2;
	[mat.crateWhite, mat.pine, mat.pineDark].forEach((m, i) => crate(leftX, i * CRATE.h, m));
	[mat.crateWhite, mat.crateWhite, mat.pine].forEach((m, i) => crate(rightX, i * CRATE.h, m));
	// what is in them: folded clothes, books, a box — a few soft shapes, enough to read as lived in
	const stuff = [new THREE.MeshStandardMaterial({ color: '#2c3540', roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#c9c3b6', roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 0.8 })];
	for (const [x, n] of [[leftX, 3], [rightX, 3]] as const)
		for (let i = 0; i < n; i++)
			for (const lvl of [0.03, CRATE.h / 2 + 0.01]) box(0.38, 0.09 + ((i + lvl * 10) % 3) * 0.02, 0.22, stuff[(i + (lvl > 0.1 ? 1 : 0)) % stuff.length]!, x + (i - 1) * 0.02, i * CRATE.h + lvl + 0.06, -L + 0.18, false);

	/* ── the chairs: the red one by the window, the brown one by the left wall ── */
	const chair = (x: number, z: number, face: number, seat: THREE.Material, frame: THREE.Material) => {
		const g = new THREE.Group();
		const add = (w: number, h: number, d: number, px: number, py: number, pz: number, m: THREE.Material) => {
			const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
			p.position.set(px, py, pz);
			p.castShadow = true;
			g.add(p);
		};
		for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) add(0.03, 0.44, 0.03, dx * 0.19, 0.22, dz * 0.19, frame);
		add(0.42, 0.03, 0.42, 0, 0.45, 0, seat);
		for (const dx of [-1, 1]) add(0.03, 0.42, 0.03, dx * 0.19, 0.66, -0.2, frame);
		add(0.4, 0.16, 0.025, 0, 0.8, -0.2, seat);
		g.position.set(x, 0, z);
		g.rotation.y = face;
		scene.add(g);
	};
	chair(W - 0.42, -0.05, -Math.PI / 2 + 0.25, mat.red, mat.red);
	chair(-W + 0.3, -1.35, Math.PI / 2 - 0.2, mat.leather, mat.steel);

	/* ── the door: white, a lever handle, the vent at its foot ── */
	const door = box(DOOR.x1 - DOOR.x0 - 0.02, DOOR.top - 0.01, 0.04, mat.white, (DOOR.x0 + DOOR.x1) / 2, DOOR.top / 2, L - 0.02);
	door.receiveShadow = true;
	for (const [w, h, x, y] of [[0.05, DOOR.top + 0.05, DOOR.x0 - 0.02, (DOOR.top + 0.05) / 2], [0.05, DOOR.top + 0.05, DOOR.x1 + 0.02, (DOOR.top + 0.05) / 2], [DOOR.x1 - DOOR.x0 + 0.09, 0.05, (DOOR.x0 + DOOR.x1) / 2, DOOR.top + 0.025]] as const)
		box(w, h, 0.03, mat.white, x, y, L - 0.015, false);
	box(0.12, 0.02, 0.05, mat.handle, DOOR.x1 - 0.12, 1.05, L - 0.07, false);
	box(0.4, 0.06, 0.01, mat.sill, (DOOR.x0 + DOOR.x1) / 2, 0.06, L - 0.045, false);
	// the sockets and the round boxes in the walls
	for (const [x, y, z, ry] of [[-W + 0.005, 0.3, 1.6, Math.PI / 2], [-W + 0.005, 1.15, 1.9, Math.PI / 2], [W - 0.005, 1.1, 1.0, -Math.PI / 2]] as const) {
		const s = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 16), mat.socket);
		s.rotation.set(0, 0, Math.PI / 2);
		s.rotation.y = ry;
		s.position.set(x, y, z);
		scene.add(s);
	}

	/* ── the bulb: a yellow Edison bulb on a short black cord ── */
	const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, BULB.drop, 6), mat.cord);
	cord.position.set(BULB.x, H - BULB.drop / 2, BULB.z);
	scene.add(cord);
	const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 12), mat.socket);
	holder.position.set(BULB.x, H - BULB.drop - 0.03, BULB.z);
	scene.add(holder);
	const bulbGeo = new THREE.SphereGeometry(0.045, 20, 14);
	bulbGeo.scale(1, 1.55, 1);
	const bulb = new THREE.Mesh(bulbGeo, bulbGlass);
	bulb.position.set(BULB.x, H - BULB.drop - 0.12, BULB.z);
	scene.add(bulb);
	bulbLight.position.copy(bulb.position);
	scene.add(bulbLight);

	// indoors the sky reaches only through the window: its light off every surface is turned down to what a room gets,
	// so the walls stay warm white (the outside keeps the full sky)
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh) || outside.children.includes(o)) return;
		for (const m of [o.material].flat()) if (m instanceof THREE.MeshStandardMaterial) m.envMapIntensity = 0.35;
	});

	/* ── walking it: at a room's pace, kept off the walls and out of the furniture ── */
	const solid: [number, number, number, number][] = [
		[bed.x - bed.w / 2 - 0.04, bed.x + bed.w / 2 + 0.04, -L, -L + bed.len + 0.02], // the bed
		[leftX - CRATE.w / 2, leftX + CRATE.w / 2, -L, -L + CRATE.d + 0.02],
		[rightX - CRATE.w / 2, rightX + CRATE.w / 2, -L, -L + CRATE.d + 0.02],
		[W - 0.68, W, -0.3, 0.2], // the red chair
		[-W, -W + 0.55, -1.6, -1.1], // the brown chair
		[W - 0.16, W, WIN.z0, WIN.z1] // the radiator
	];
	const M = 0.18; // how close to a wall or a thing you may stand
	const canStand = (x: number, z: number) =>
		Math.abs(x) < W - M && z > -L + M && z < L - M && !solid.some(([x0, x1, z0, z1]) => x > x0 - M && x < x1 + M && z > z0 - M && z < z1 + M);
	const walker = createWalker(camera, renderer.domElement, { x: -0.55, z: 1.75, yaw: 0.15, pitch: -0.05, eye: 1.62, walk: 1.3, hurry: 2.6, stride: 0.12, canStand });
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
		// the hour gives the bulb its glow first, then the shot's own `lamps`
		advance: () => {
			bulbLight.intensity = bulbBase;
		},
		lights: {
			lamps: (k: number, color?: string) => {
				bulbLight.intensity = bulbBase * k;
				bulbGlass.emissiveIntensity *= k;
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
