/*
 * THE TIRED LAND as a world of its own — the fields of one crop, the highway, the power lines and the trucks driving
 * it (./tiredLandSet.js, the same set Sandbox 4's Day 19 shots are filmed in), alone under the kit's sky: walked on
 * foot across the fields and along the road, the trucks going by on the world's clock, and shot like every sandbox
 * (`world.sandbox: 'tired-land'`). The set's own coordinates: the highway runs north–south at x = −470.
 */
import * as THREE from 'three';
import { connectFilm, createSky, createStage, createWalker, filmDraws, filmHoldsSize, worldTime } from '$lib/sandbox-kit';
import { buildTiredLand } from './tiredLandSet.js';

export type TiredLandHandle = { move: (x: number, y: number, hurry: boolean) => void; look: (dx: number, dy: number) => void; dispose: () => void };

/** where the fields reach (the set's plane: x −2698 … −398, z ±1300), a little inside */
const FIELDS = { x0: -2690, x1: -402, z: 1290 } as const;

export async function mountTiredLand(container: HTMLElement, onProgress: (label: string) => void = () => {}): Promise<TiredLandHandle> {
	const stage = createStage(container);
	const { renderer, scene, camera } = stage;
	const sky = createSky(renderer, scene, {});
	onProgress('Ploughing the fields');

	// the land round the fields, as far as the eye goes: the same dull ground, a little greener
	const land = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: '#6f6b4a', roughness: 1 }));
	land.rotation.x = -Math.PI / 2;
	land.receiveShadow = true;
	scene.add(land);
	const { set, drive } = buildTiredLand(1);
	scene.add(set);

	// on the verge east of the highway, looking north up the road
	const walker = createWalker(camera, renderer.domElement, {
		x: -461,
		z: 30,
		yaw: 0,
		pitch: 0.02,
		eye: 1.7,
		walk: 3.2,
		hurry: 12,
		canStand: (x, z) => x > FIELDS.x0 && x < FIELDS.x1 && Math.abs(z) < FIELDS.z
	});
	onProgress('ready');

	const start = performance.now();
	let frame = 0, last = start;
	const tick = () => {
		const now = performance.now();
		walker.update(Math.min(0.1, (now - last) / 1000));
		sky.follow(camera.position.x, camera.position.z);
		sky.tick(now);
		// the trucks on the world's clock (on film: the shot's); 0:32 is where the film's trucks are at its 32nd second
		drive(worldTime() ?? 32 + (now - start) / 1000);
		if (!filmDraws()) renderer.render(scene, camera);
		stage.adapt(now, filmHoldsSize());
		last = now;
		frame = requestAnimationFrame(tick);
	};
	tick();

	const film = connectFilm({ sandbox: 'tired-land', renderer, scene, camera, hold: walker, sky, animate: drive, place: walker.place });

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
