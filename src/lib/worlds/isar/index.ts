/*
 * THE ISAR IN MUNICH — a real place as a world: the river from the Wittelsbacherbrücke south to the railway bridge
 * (the Braunauer Eisenbahnbrücke), about 700 m of it, flowing north. Its ground is the survey's (DGM1), its banks,
 * paths, gravel, woods, benches, bridges and town are OpenStreetMap's (./map.ts), its look the photos' (July 2023).
 *
 * Walked on foot along the east bank — the gravel path, the meadow, the bank down to the water — and into the river:
 * wading over the gravel, swimming where it is deep, carried downstream by the current while you swim; up the ramp at
 * the bridge's east end and across the Wittelsbacherbrücke's deck. Not up the steep west bank, nor over the dike into
 * the park behind it. The sky is Munich's as it truly turns: the sun rising over the east bank, setting behind the west
 * bank's trees.
 *
 * Shot like every sandbox (`world.sandbox: 'isar'`): the river flows, the grass and the leaves stir on the shot's
 * clock; the bridge's lamps are the shot's `lamps`.
 */
import * as THREE from 'three';
import { connectFilm, createObstacles, createSky, createStage, createWalker, filmDraws, filmHoldsSize, worldTime } from '$lib/sandbox-kit';
import { DOWNSTREAM, MAP, nOf, sOf, waterAt, xOf, zOf } from './map';
import { buildGround } from './ground';
import { buildWater, type Water } from './water';
import { buildBridges, type Bridges } from './bridges';
import { buildTown, type Town } from './town';
import { buildFurniture, buildGrass, buildTrees, plantTrees } from './green';
import { noise } from './surfaces';

export type IsarHandle = { move: (x: number, y: number, hurry: boolean) => void; look: (dx: number, dy: number) => void; dispose: () => void };

/** the walk's ends along the river: just under the railway bridge in the south, past the Wittelsbacherbrücke in the north */
const WALK = { s0: -380, s1: 405 };
/** how high the eye floats over the water when swimming (m), and how tall one stands */
const EYE = 1.7, SWIM = 0.32;
/** true north here, from the survey's grid north: the meridians close in, 1.9° (UTM 32N, 11.565° E, 48.12° N) */
const NORTH = -0.0333;

export async function mountIsar(container: HTMLElement, onProgress: (label: string) => void = () => {}): Promise<IsarHandle> {
	const stage = createStage(container, { far: 4200 });
	const { renderer, scene, camera } = stage;
	camera.near = 0.08;
	camera.updateProjectionMatrix();
	let bridges: Bridges | undefined;
	let town: Town | undefined;
	let river: Water | undefined;
	const sky = createSky(renderer, scene, {
		map: true,
		north: NORTH,
		shadowReach: 130,
		shadowMap: 4096,
		lightDistance: 420,
		shadowNear: 20,
		shadowFar: 900,
		shadowBias: { bias: -0.0003, normal: 0.04 },
		fog: { near: 280, far: 3400 },
		onHour: ({ night, day }) => {
			bridges?.light(night);
			town?.light(night);
			river?.light(day);
		}
	});

	onProgress('Shaping the ground');
	const ground = await buildGround();
	scene.add(ground.mesh);
	onProgress('Letting the river run');
	const water = (river = buildWater(ground, noise()));
	scene.add(water.mesh);
	onProgress('Building the bridges');
	bridges = buildBridges(ground.at);
	scene.add(bridges.group);
	const bridge = bridges;
	onProgress('Building the town');
	town = buildTown();
	scene.add(town.group);
	sky.set();
	onProgress('Planting the trees');
	const trees = buildTrees(plantTrees(ground, bridge.clear));
	scene.add(trees.group);
	const furniture = buildFurniture(ground);
	scene.add(furniture.group);
	const grassTime = { value: 0 };
	const grass = buildGrass(ground, bridge.clear, grassTime);
	scene.add(grass.mesh);

	/* ── the walk ── */
	// the dike's crest along the east side, column by column: how far east one may go
	const crest = new Float64Array(ground.gs.length);
	{
		const { gs, gn, h } = ground;
		const NS = gs.length;
		for (let i = 0; i < NS; i++) {
			let best = 70, top = -Infinity;
			for (let j = 0; j < gn.length; j++) {
				const n = gn[j]!;
				if (n < 70 || n > 140) continue;
				if (h[j * NS + i]! > top) (top = h[j * NS + i]!), (best = n);
			}
			crest[i] = best;
		}
		const raw = Float64Array.from(crest);
		for (let i = 0; i < NS; i++) {
			let sum = 0, k = 0;
			for (let d = -8; d <= 8; d++) {
				const j = Math.min(NS - 1, Math.max(0, i + d));
				sum += raw[j]!;
				k++;
			}
			crest[i] = sum / k;
		}
	}
	const crestAt = (s: number) => {
		const gs = ground.gs;
		let lo = 0, hi = gs.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (gs[mid]! <= s) lo = mid;
			else hi = mid;
		}
		return crest[lo]!;
	};
	/** where one may be on the ground: between the river's west foot and the dike's crest, from bridge to bridge — and
	 *  up the paths to the Wittelsbacherbrücke's east end */
	const zone = (s: number, n: number) => {
		if (s < WALK.s0 || s > WALK.s1) return false;
		const [west] = ground.banks(s);
		if (n < west - 1.2) return false;
		if (n <= crestAt(s) + 3) return true;
		if (s > 270 && n < 128) {
			const [gravel, , asphalt] = ground.surface(s, n);
			return gravel > 0.3 || asphalt > 0.3;
		}
		return false;
	};
	/** the ground underfoot: the bed where one can wade, the water's surface (less a swimmer's depth) where one swims */
	const groundFloor = (x: number, z: number) => {
		const s = sOf(x, z);
		return Math.max(ground.at(x, z), waterAt(s) + SWIM - EYE);
	};
	const floorAt = (x: number, z: number, on: number) => {
		const deck = bridge.deckAt(x, z);
		if (deck !== null && Math.abs(on - deck) < 1.4) return deck;
		return groundFloor(x, z);
	};
	const obstacles = createObstacles(
		[...trees.trunks.filter((t) => zone(sOf(t.x, t.z), nOf(t.x, t.z))), ...furniture.solid].map((o) => ({ ...o, y: ground.at(o.x, o.z) })),
		{ pad: 0.28, floor: 2 }
	);
	/** may one step to x, z from the floor one stands on (`here`)? */
	const canStand = (x: number, z: number, here: number, _on: number, from: { x: number; z: number }) => {
		const next = floorAt(x, z, here);
		// no climbing a wall or dropping off the bridge: one stride never goes up or down more than a step
		if (Math.abs(next - here) > 0.8) return false;
		const deck = bridge.deckAt(x, z);
		if (deck !== null && Math.abs(next - deck) < 0.01) return true;
		if (!zone(sOf(x, z), nOf(x, z))) return false;
		if (!bridge.clear(x, z, next)) return false;
		return !obstacles.blocks(x, z, { y: next, from });
	};
	// on the gravel path on the east bank, a little north of the middle, looking downstream to the Wittelsbacherbrücke
	const START = { s: 40, n: 28.5 };
	const walker = createWalker(camera, renderer.domElement, {
		x: xOf(START.s, START.n),
		z: zOf(START.s, START.n),
		yaw: Math.atan2(-DOWNSTREAM.x, -DOWNSTREAM.z),
		pitch: 0.02,
		eye: EYE,
		// brisk, for 700 m of river: two and a half times the first pace (2.2 m/s, Shift 8), Shift with it
		walk: 5.5,
		hurry: 20,
		stride: 0.25,
		canStand,
		floorAt
	});
	walker.place(walker.position.x, walker.position.z, walker.yaw(), walker.pitch(), groundFloor(walker.position.x, walker.position.z));
	onProgress('ready');

	/** the river's clock: the water, the caustics, the leaves and the grass */
	const animate = (t: number) => {
		water.time.value = t;
		ground.time.value = t;
		trees.wind.value = t;
		grassTime.value = t;
	};
	/** swimming, the current carries you downstream, as fast as the water runs there */
	const drift = (dt: number) => {
		const { x, z } = walker.position;
		const s = sOf(x, z), n = nOf(x, z);
		const depth = waterAt(s) - ground.atSN(s, n);
		if (depth < EYE - SWIM - 0.05 || walker.ground() > waterAt(s)) return;
		const [w, e] = ground.banks(s);
		const speed = Math.min(1.4, 0.4 + depth * 0.45) * Math.min(1, Math.max(0.2, Math.min(n - w, e - n) / 6));
		const nx = x + DOWNSTREAM.x * speed * dt, nz = z + DOWNSTREAM.z * speed * dt;
		if (canStand(nx, nz, walker.ground(), walker.ground(), walker.position)) {
			walker.position.x = nx;
			walker.position.z = nz;
		}
	};

	const start = performance.now();
	let frame = 0, last = start;
	const tick = () => {
		const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
		walker.update(dt);
		if (!walker.flying() && !filmDraws()) drift(dt);
		animate(worldTime() ?? (now - start) / 1000);
		grass.update(camera.position.x, camera.position.z);
		trees.update(camera.position.x, camera.position.z);
		sky.follow(camera.position.x, camera.position.z);
		sky.tick(now);
		if (!filmDraws()) renderer.render(scene, camera);
		stage.adapt(now, filmHoldsSize());
		last = now;
		frame = requestAnimationFrame(tick);
	};
	tick();

	const film = connectFilm({
		sandbox: 'isar',
		renderer,
		scene,
		camera,
		hold: walker,
		sky,
		place: (x, z, yaw, pitch, y) => walker.place(x, z, yaw, pitch, y ?? floorAt(x, z, bridge.deckAt(x, z) ?? groundFloor(x, z))),
		animate,
		// the grass grows round wherever the shot's camera is, and the trees there are drawn full
		advance: () => {
			grass.update(camera.position.x, camera.position.z);
			trees.update(camera.position.x, camera.position.z);
		},
		lights: {
			lamps: (k: number, color?: string) => bridge.light(sky.light().night, k, color)
		},
		// for the console: the map, the ground, the frame, and the walk's own rules
		extra: { isar: { map: MAP, ground, sOf, nOf, xOf, zOf, walker, canStand, floorAt, zone } }
	});

	return {
		move: walker.move,
		look: walker.look,
		dispose() {
			cancelAnimationFrame(frame);
			film.disconnect();
			walker.dispose();
			grass.dispose();
			trees.dispose();
			town?.dispose();
			bridge.dispose();
			water.dispose();
			ground.dispose();
			sky.dispose();
			stage.dispose();
		}
	};
}
