# The sandbox kit

What every avenCITY sandbox world is made with, taken out of Sandbox 4 (`src/lib/sandbox-2/interior/village.ts`, `src/routes/app/games/sandbox-4/`) so a new sandbox starts with the same sky, the same day switch and the same way to walk.

| | |
|---|---|
| `createStage(container)` | the canvas, the scene and the camera, kept to their container's size; `adapt(now)` each frame keeps it smooth on a slow phone |
| `createSky(renderer, scene, { onHour })` | the sky, a sun and moon that follow the in-game clock (`game/time`), shadows, fog; `alwaysDay(on)` keeps it at day |
| `createWalker(camera, canvas, { canStand, floorAt })` | the first-person camera: WASD/arrows, Shift to hurry, drag to look; `move`/`look` for a phone |
| `<SkyToggle>` | the "Real sky / Day" switch |
| `<WorldClock>` | the in-game time |
| `<WalkHint>` | how to walk, for keys and for fingers |
| `$lib/touch/TouchStick` | the phone's joystick (already shared) |

## A new world

```js
// src/lib/sandbox-5/world.js
import * as THREE from 'three';
import { createSky, createStage, createWalker } from '$lib/sandbox-kit';

export function mountWorld(container) {
	const stage = createStage(container);
	const { renderer, scene, camera } = stage;
	const lamp = new THREE.MeshStandardMaterial({ emissive: '#ffc070' });
	// onHour runs once already as the sky is made: what it touches must be there before it
	const sky = createSky(renderer, scene, {
		// whatever else changes with the hour: lamps that glow at night, …
		onHour: ({ night }) => (lamp.emissiveIntensity = 0.1 + 2.4 * night)
	});

	const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#7a9a5a' }));
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);

	const walker = createWalker(camera, renderer.domElement, {
		x: 0, z: 20,
		// where you may stand (here: anywhere on the ground), and how high the floor is
		canStand: (x, z) => Math.abs(x) < 200 && Math.abs(z) < 200,
		floorAt: () => 0
	});

	let frame = 0, last = performance.now();
	const tick = () => {
		const now = performance.now();
		walker.update(Math.min(0.1, (now - last) / 1000));
		sky.follow(camera.position.x, camera.position.z); // the shadows follow you
		sky.tick(now); // the sun moves on with the clock
		renderer.render(scene, camera);
		stage.adapt(now);
		last = now;
		frame = requestAnimationFrame(tick);
	};
	tick();

	return {
		move: walker.move,
		look: walker.look,
		alwaysDay: sky.alwaysDay,
		dispose() {
			cancelAnimationFrame(frame);
			walker.dispose();
			sky.dispose();
			stage.dispose();
		}
	};
}
```

## Its page

```svelte
<script>
	import { onMount } from 'svelte';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { SkyToggle, WalkHint, WorldClock } from '$lib/sandbox-kit';

	/** @type {HTMLDivElement | undefined} */
	let stage = $state();
	/** @type {ReturnType<typeof import('$lib/sandbox-5/world.js').mountWorld> | null} */
	let world = null;
	onMount(() => {
		import('$lib/sandbox-5/world.js').then(({ mountWorld }) => (world = mountWorld(stage)));
		return () => world?.dispose();
	});
</script>

<div class="world">
	<div class="stage" bind:this={stage}></div>
	<div class="bar">
		<WorldClock />
		<SkyToggle onchange={(on) => world?.alwaysDay(on)} />
	</div>
	<WalkHint />
	<TouchStick move={(x, y, hurry) => world?.move(x, y, hurry)} look={(dx, dy) => world?.look(dx, dy)} {stage} taps=".bar a, .bar button" />
</div>
```

Both components take a `class`, for placing them in your bar (`.bar :global(.my-class) { margin-left: auto }`).

## On film

The film camera (`src/lib/film`) can steer a world built on the kit: it pins the hour with `window.__interiorHour`, opens the lens with `window.__exposure` and sets `window.__worldTime` while it holds the clock (the sky reads all three), and it takes the camera with `walker.fly(x, y, z, yaw, pitch)` and gives it back with `walker.place(…)`. Sandbox 4 hands these over as `window.__village`.
