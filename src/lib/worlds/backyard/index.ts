/*
 * THE BACKYARD — a real Munich backyard as a world, built from seventeen photos (October 2026): a courtyard of grey
 * pavers between apricot and saffron houses; in front of the old workshop the pergola and its terrace — a leather sofa
 * under paper lanterns, the bistro set in the corner, herbs in tall white planters, an old olive tree — and in the
 * north-west corner a garden of gravel and beds, a teak table and its chairs under a corkscrew willow; the shed with its
 * lilac and rain barrel, the gate under its glass canopy and its station clock, the driveway out under the front house.
 * The plan is ./layout.ts; the houses ./buildings.ts, the pergola and the terrace ./pergola.ts, the ground and the
 * garden ./garden.ts; the models are the 3D models' (src/lib/models: ./terrace.ts and ./yard.ts there).
 *
 * Walked like every sandbox (the kit's walker, at a courtyard's pace) and shot like every sandbox (connectFilm:
 * `world.sandbox: 'backyard'`; the lanterns, the festoon, the front door's lamp, the studio's bulbs and the lit windows
 * are the shot's `lamps`). The sky turns as Munich's does (`map`): the house and the workshop face south, the sun
 * stands over the front house at noon and the sails shade the sofa.
 */
import * as THREE from 'three';
import { connectFilm, createObstacles, createSky, createStage, createWalker, filmDraws, filmHoldsSize } from '$lib/sandbox-kit';
import { standIn } from '$lib/actors/human';
import { builder, freeze } from './kit';
import { buildBuildings, type Lamp } from './buildings';
import { buildPergola } from './pergola';
import { buildGarden } from './garden';
import { COURT, DRIVE, INSET, type Rect } from './layout';

export type BackyardHandle = { move: (x: number, y: number, hurry: boolean) => void; look: (dx: number, dy: number) => void; dispose: () => void };

/** how close to a wall or a thing one may stand (m), and how tall one stands */
const M = 0.2, EYE = 1.62;

export async function mountBackyard(container: HTMLElement, onProgress: (label: string) => void = () => {}): Promise<BackyardHandle> {
	const stage = createStage(container, { far: 900 });
	const { renderer, scene, camera } = stage;
	camera.near = 0.05;
	camera.updateProjectionMatrix();

	// the lamps (built below), their own colours, and the hour as the sky last gave it
	let lamps: Lamp[] = [];
	const own = new Map<THREE.Light, THREE.Color>();
	let night = 0, day = 1;
	let sails: THREE.MeshStandardMaterial | undefined;
	const light = (k = 1, color?: string) => {
		for (const l of lamps) {
			for (const { light: s, share } of l.lights) {
				s.intensity = 2.6 * night * share * k;
				s.color.copy(own.get(s) ?? s.color);
				if (color) s.color.set(color);
			}
			if (l.glass) l.glass.emissiveIntensity = l.glow * (0.02 + night) * k;
		}
	};
	const sky = createSky(renderer, scene, {
		map: true,
		// a courtyard: the shadows held round it, its houses and the neighbours' all in them; near, so their bias is a
		// centimetre or two
		shadowsAt: [-4.5, 6],
		shadowReach: 27,
		shadowMap: 4096,
		lightDistance: 60,
		shadowNear: 15,
		shadowFar: 125,
		shadowBias: { bias: -0.0002, normal: 0.02 },
		fog: { near: 160, far: 900 },
		onHour: ({ night: n, day: d }) => {
			night = n;
			day = d;
			light();
			// the sun through the sails' cloth: they glow from beneath by day
			if (sails) sails.emissiveIntensity = 0.42 * day;
		}
	});

	const statics = new THREE.Group();
	statics.name = 'the backyard';
	scene.add(statics);
	const b = builder(statics);
	onProgress('Building the houses');
	await new Promise((r) => setTimeout(r));
	const houses = buildBuildings(b, scene);
	onProgress('Putting up the pergola');
	await new Promise((r) => setTimeout(r));
	const pergola = buildPergola(b, scene);
	onProgress('Planting the garden');
	await new Promise((r) => setTimeout(r));
	const garden = buildGarden(b);
	lamps = [...houses.lamps, ...pergola.lamps];
	sails = pergola.sails;
	sails.emissiveIntensity = 0.42 * day;
	for (const l of lamps) for (const { light: s } of l.lights) own.set(s, s.color.clone());
	light();

	// the stand-ins: a neutral figure where someone will sit, to block a shot before it is filmed — each a set a shot
	// names (`world.props`), hidden otherwise
	const sets = ((window as unknown as { __sets?: Record<string, THREE.Object3D> }).__sets ??= {});
	const standIns: Record<string, THREE.Object3D> = {};
	for (const [name, [x, z, facing, drop]] of Object.entries({ ...pergola.sets, ...garden.sets })) {
		const s = standIn('sit');
		s.position.set(x, drop, z);
		s.rotation.y = facing;
		s.visible = false;
		scene.add(s);
		standIns[name] = sets[name] = s;
	}

	// everything that never moves, welded into a few meshes by material
	onProgress('Settling the courtyard');
	await new Promise((r) => setTimeout(r));
	scene.add(freeze(statics));
	renderer.shadowMap.needsUpdate = true;

	/* ── walking it: the courtyard, the terrace's corner, the driveway; kept off the walls, the beds, the things ── */
	const floors: Rect[] = [COURT, [INSET.x0, INSET.x1, INSET.z0, 0], [DRIVE.x0, DRIVE.x1, DRIVE.z0 - 0.1, DRIVE.z1]];
	const solids: Rect[] = [...houses.solid, ...pergola.solid, ...garden.solid];
	const obstacles = createObstacles([...pergola.round, ...garden.round], { pad: M });
	const canStand = (x: number, z: number, _here: number, _on: number, from: { x: number; z: number }) =>
		floors.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1) &&
		!solids.some(([x0, x1, z0, z1]) => x > x0 - M && x < x1 + M && z > z0 - M && z < z1 + M) &&
		!obstacles.blocks(x, z, { from });
	// in the courtyard, looking north at the pergola and the workshop as the first photo does
	const walker = createWalker(camera, renderer.domElement, { x: 0.9, z: 8.6, yaw: 0, pitch: 0.06, eye: EYE, walk: 1.4, hurry: 3.2, keyboard: { walk: 1.7, hurry: 3.8 }, stride: 0.15, canStand });
	onProgress('ready');

	let frame = 0, last = performance.now();
	const tick = () => {
		const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
		walker.update(dt);
		sky.follow(camera.position.x, camera.position.z);
		sky.tick(now);
		if (!filmDraws()) renderer.render(scene, camera);
		stage.adapt(now, filmHoldsSize());
		last = now;
		frame = requestAnimationFrame(tick);
	};
	tick();

	const film = connectFilm({
		sandbox: 'backyard',
		renderer,
		scene,
		camera,
		hold: walker,
		sky,
		place: walker.place,
		lights: {
			// the lanterns, the festoon, the front door's lamp, the studio, the lit windows: k over what the hour gives them
			lamps: (k: number, color?: string) => light(k, color)
		}
	});

	return {
		move: walker.move,
		look: walker.look,
		dispose() {
			cancelAnimationFrame(frame);
			film.disconnect();
			for (const name of Object.keys(standIns)) delete sets[name];
			walker.dispose();
			sky.dispose();
			stage.dispose();
		}
	};
}
