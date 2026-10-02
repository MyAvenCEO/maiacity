# The sandbox kit

What every avenCITY sandbox world is made with — the same sky, the same day switch, the same cameras, and the same hold for the studio's film camera — so a new sandbox starts with all of it, and the studio can shoot movies in any of them. Taken out of Sandbox 4 and used by every sandbox:

| Sandbox | stage | sky | camera | on film (`/games/<sandbox>/?film`) |
|---|---|---|---|---|
| 1 · the island (`src/lib/aven-city`) | its own canvas | `createSky` (island size) | `createOrbitRig` | the island from its seed |
| 2 · the planet (`src/lib/sandbox-2/world`) | its own | `lightAt` + `createSkyClock` (no sky round a planet; its sun rides with the camera) | its own globe rig + `createCameraHold` | `&area=planet` |
| 2 · a city's island (`src/lib/sandbox-2/island`) | its own canvas | `createSky` (island size) | `createOrbitRig` | `&area=island`, grown from `world.seed` |
| 3 · inside a dome (`src/lib/sandbox-2/interior`) | `createStage` | `createSky` (dome size) | `createWalker` | `&area=home` … `factory` |
| 4 · a dome cell (`src/lib/sandbox-2/interior/village.ts`) | `createStage` | `createSky` | `createWalker` | the cell, its domes built as the camera comes |

**One sky, one source of truth.** Every world's light is `lightAt(hour)` and every world's hour is `createSkyClock()` (`sky.js`): the in-game clock, day kept by the switch, or the hour a film pins. Every world has the same Day/Real sky switch. A world chooses only its size — how far the shadows and fog reach, how far off the light stands — and its lens (`exposure`: the islands' pale clay takes a little less light than a walk among the domes); never how the sky behaves.

| | |
|---|---|
| `createStage(container)` | the canvas, the scene and the camera, kept to their container's size; `adapt(now)` each frame keeps it smooth on a slow phone |
| `createSky(renderer, scene, { onHour })` | the one sky: a scattering sky dome and the light it casts, a sun that follows the in-game clock (`game/time`) and is the moon at night, shadows, a fog that warms at dusk, the stars and the moon's disc at night; `alwaysDay(on)` keeps it at day |
| `lightAt(hour)`, `createSkyClock()` | the sky's light and its hour, for a world with no sky round it |
| `createWalker(camera, canvas, { canStand, floorAt })` | the first-person camera: WASD/arrows, Shift to hurry, drag to look; `move`/`look` for a phone |
| `createOrbitRig(camera, canvas, { … })` | the map camera: WASD travels, drag turns and tilts, the wheel zooms to the cursor, Q/E turn; `freeMove: false` is a turntable |
| `connectFilm({ sandbox, area, renderer, scene, camera, hold, sky, … })` | hands the world to the studio's film camera (`window.__world`); `createCameraHold(camera)` for a world with its own camera controls |
| `<SkyToggle>` | the "Real sky / Day" switch |
| `<WorldClock>` | the in-game time |
| `<WalkHint>` | how to walk, for keys and for fingers |
| `$lib/touch/TouchStick` | the phone's joystick (already shared) |

## A new world

```js
// src/lib/sandbox-5/world.js
import * as THREE from 'three';
import { connectFilm, createSky, createStage, createWalker, filmDraws, filmHoldsSize, worldTime } from '$lib/sandbox-kit';

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

	const mill = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 0.2), lamp);
	mill.position.set(0, 4, 0);
	scene.add(mill);
	const animate = (/** @type {number} */ t) => (mill.rotation.z = t * 0.8);

	let frame = 0, last = performance.now();
	const start = performance.now();
	const tick = () => {
		const now = performance.now();
		walker.update(Math.min(0.1, (now - last) / 1000));
		sky.follow(camera.position.x, camera.position.z); // the shadows follow you
		sky.tick(now); // the sun moves on with the clock
		animate(worldTime() ?? (now - start) / 1000); // on film: the shot's clock
		if (!filmDraws()) renderer.render(scene, camera); // on film: the film draws
		stage.adapt(now, filmHoldsSize());
		last = now;
		frame = requestAnimationFrame(tick);
	};
	tick();

	// the studio can shoot it (add 'sandbox-5' to game/film/worlds.js and its /games/sandbox-5/?film page)
	const film = connectFilm({ sandbox: 'sandbox-5', renderer, scene, camera, hold: walker, sky, animate, place: walker.place });

	return {
		move: walker.move,
		look: walker.look,
		alwaysDay: sky.alwaysDay,
		dispose() {
			cancelAnimationFrame(frame);
			film.disconnect();
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

## On film: the studio's virtual camera

The studio shoots a world shot (`game/film/shot.js`) frame by frame through film mode (`src/lib/film`), every frame set from the shot alone — the camera's pose and lens, the hour, the world's clock, the lights — so the same shot renders the same pixels every time: live in the studio's world viewer, as an HD proxy and as a 4K plate on the Mac. A shot names its world (`world.sandbox`, `world.area`: `game/film/worlds.js`); each world's film page is `/games/<sandbox>/?film&area=<area>`.

A world is filmable once it does four things:

1. **Hand itself over** with `connectFilm`: its stage, its sky, its camera controller as a hold (the walker and the orbit rig are holds; `createCameraHold(camera)` for any other), what it animates (`animate(t)`), what else a frame needs (`advance`), its own lights a shot may scale (`lights: { lamps: (k, color) => … }`), and — when a shot needs something built first — `stage(world)`.
2. **Draw nothing itself while the film draws**: `if (!filmDraws()) renderer.render(scene, camera)`.
3. **Run its animations on the shot's clock**: `const t = worldTime() ?? (now - start) / 1000`.
4. **Keep its resolution while a film holds it**: `stage.adapt(now, filmHoldsSize())`.

Then add its film page: `src/routes/games/<sandbox>/+page.svelte` with `<FilmRoute sandbox to mount />` (`src/lib/film/FilmRoute.svelte`), and its entry in `game/film/worlds.js`. The sky reads the film's hour (`window.__interiorHour`) and lens (`window.__exposure`) by itself. Nothing in the world may depend on the browser's storage or the live server on film: a shot must render the same every time.
