/**
 * THE SKY — one sky for every avenCITY world, and the single source of truth for its light and its time.
 *
 * Every world is a view of the same universe (./universe.js), only zoomed in more or less: Sandbox 2's planet is
 * seen from space — a dark blue universe, the stars, the sun a blinding star, the planet turning in its light — and
 * the closer you come, the deeper you are in its air and the bluer and lighter the sky; the islands and the domes
 * are the same sky from the ground.
 *
 *   · `sunAt(hour)`, `lightAt(hour)` — where the sun stands over the ground and what its light is (warm and low at
 *     dawn and dusk, the cold moon at night, the fill from the sky);
 *   · `createSkyClock()` — which hour it is: the in-game clock or the hour set by hand (./skyTime.svelte.js, the
 *     time control ./SkyControl.svelte), or the hour a film pins (`window.__interiorHour`);
 *   · `createSky(renderer, scene, { view: 'ground' })` — the sky over a world on the ground: the universe dome, the
 *     sun that throws shadows and is the moon at night, the fill, the light the sky casts on everything, and the fog
 *     in the colour of the real horizon, so what is far away melts into the sky that is there;
 *   · `createSky(renderer, scene, { view: 'planet' })` — the universe round a planet: the sun's light from where it
 *     really is at that hour (day on one side, night on the other), and the air thickening as the camera comes down
 *     (`sky.view(up, atmosphere)` every frame).
 *
 * A world chooses only its size (how far the shadows and the fog reach, how far off the light stands) and its lens
 * (`exposure`); never how the sky behaves. Give the renderer ACES tone mapping and soft shadows (`createStage` in
 * ./stage.js does), call `tick()` every frame and `follow(x, z)` with where the camera stands. What else changes with
 * the hour in your world — lamps that glow at night — goes in `onHour`.
 *
 * The film camera (src/lib/film, ./film.js) steers every world through it: it pins the hour with
 * `window.__interiorHour`, opens the lens for a dark shot with `window.__exposure`, and sets `window.__worldTime`
 * while it holds the clock.
 */
import * as THREE from 'three';
import { celestial, createUniverse, groundStars, horizonAt } from './universe.js';
import { skyHour, skyTime } from './skyTime.svelte.js';

/**
 * @typedef {{ hour: number, e: number, day: number, low: number, night: number }} SkyLight
 *   the hour, the sun's height (-1…1, below the horizon under 0), how much of the day there is (0…1),
 *   how low and warm the sun is (0…1) and how dark the night is (0…1: lamps glow by it)
 */

/**
 * @typedef {SkyLight & {
 *   dir: THREE.Vector3, from: THREE.Vector3, moon: THREE.Vector3,
 *   sun: { color: THREE.Color, intensity: number },
 *   fill: { color: THREE.Color, intensity: number },
 *   environment: number
 * }} Light
 *   dir: where the sun stands; from: where the light comes from (the sun by day, the moon by night); moon: where the
 *   moon stands (opposite the sun, high); sun, fill: the key light and the sky's fill; environment: how strongly the
 *   sky's own light falls on everything
 */

/**
 * @typedef {object} SkyClock which hour the sky shows
 * @property {() => number} hour the film's, or the time control's (the clock's, or set by hand)
 */

/**
 * @typedef {object} SkyHandle
 * @property {() => number} hour the hour the sky shows now
 * @property {(hour?: number) => void} set set the sky to an hour now (its clock's by default)
 * @property {(now?: number) => void} tick call every frame: the sky follows the time control at once, the clock once a second
 * @property {(x: number, z: number) => void} follow the shadows follow whoever stands here (on the ground)
 * @property {(up: THREE.Vector3, atmosphere: number, limb?: number) => void} view where up is, how deep in the air the
 *   camera is and how far its horizon dips (a planet)
 * @property {() => SkyLight} light the light the sky was last set to
 * @property {THREE.DirectionalLight} sun the sun by day and the moon by night
 * @property {THREE.HemisphereLight} fill
 * @property {THREE.Mesh} dome the sky itself
 * @property {() => void} dispose
 */

/**
 * @typedef {{ sun: THREE.DirectionalLight, fill: THREE.HemisphereLight, renderer: THREE.WebGLRenderer, scene: THREE.Scene }} SkyParts
 */

/**
 * @typedef {{
 *   view?: 'ground' | 'planet',
 *   clock?: () => number,
 *   shadowReach?: number,
 *   shadowMap?: number,
 *   shadowGrid?: number,
 *   shadowsAt?: [number, number] | null,
 *   shadowNear?: number,
 *   shadowFar?: number,
 *   shadowBias?: { bias: number, normal: number },
 *   lightDistance?: number,
 *   fog?: { near: number, far: number } | null,
 *   exposure?: { day: number, night: number },
 *   clouds?: number,
 *   onHour?: (light: SkyLight, parts: SkyParts) => void
 * }} SkyOptions
 *   view: 'ground' (the default), or 'planet' (the universe round a planet, at the origin); clock: the hour, 0…24
 *   (the time control's); shadowReach: how far round the camera the sun's shadows reach; shadowMap: their resolution;
 *   shadowGrid: the shadows move in steps this big, so they do not shimmer as you walk; shadowsAt: the shadows stay
 *   round this point instead of following the camera (a world as small as one dome, or an island seen whole);
 *   shadowNear, shadowFar, shadowBias: the shadow camera; lightDistance: how far off the light stands; fog: how near
 *   it starts and how far it closes, or null for none (its colour is the horizon's); exposure: the world's lens by
 *   day and by night; clouds: how much of the sky they cover; onHour: everything else in the world that changes
 *   with the hour (called once already as the sky is made, so it must not need the sky — the sun and the fill are
 *   handed to it)
 */

/**
 * The hour's sun over the ground: where it stands in the sky (a unit vector) and how high, -1…1. It rises in the
 * east (+x) at five, is highest in the south (−z) at half past twelve, and sets in the west at eight.
 * @param {number} hour
 */
export function sunAt(hour) {
	const e = Math.sin(((hour - 5) / 15) * Math.PI);
	const alt = e * THREE.MathUtils.degToRad(68);
	const az = THREE.MathUtils.degToRad(90 + ((hour - 5) / 15) * 180);
	return { dir: new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - alt, az), e };
}

const WARM = new THREE.Color('#ffb070'), WHITE = new THREE.Color('#fff1d8'), MOON = new THREE.Color('#8ea6dc');
const FILL = new THREE.Color('#f4f0e6');

/**
 * The light of an hour on the ground: everything every world's light follows. Pure: the same hour, the same light.
 * @param {number} hour
 * @returns {Light}
 */
export function lightAt(hour) {
	const { dir, e } = sunAt(hour);
	const day = THREE.MathUtils.smoothstep(e, -0.05, 0.35);
	const low = 1 - THREE.MathUtils.smoothstep(e, 0, 0.6);
	const night = 1 - THREE.MathUtils.smoothstep(e, -0.02, 0.18);
	const up = e > -0.02;
	// the moon stands opposite the sun, high on the far side of the sky (it is full)
	const moon = dir.clone().negate().setY(Math.abs(dir.y) + 0.4).normalize();
	return {
		hour,
		e,
		day,
		low,
		night,
		dir,
		moon,
		from: up ? dir.clone() : moon.clone(),
		sun: { color: up ? WHITE.clone().lerp(WARM, low) : MOON.clone(), intensity: up ? 0.5 + 2.5 * day : 1.1 },
		fill: { color: FILL.clone().lerp(MOON, 1 - day), intensity: 0.34 + 0.08 * day },
		environment: 0.12 + 0.18 * day
	};
}

/**
 * Which hour the sky shows: the film's (`window.__interiorHour`), else the time control's — the in-game clock, or
 * the hour set by hand (./skyTime.svelte.js).
 * @param {{ clock?: () => number }} [o]
 * @returns {SkyClock}
 */
export function createSkyClock({ clock = skyHour } = {}) {
	const dev = /** @type {{ __interiorHour?: number }} */ (/** @type {unknown} */ (window));
	return { hour: () => dev.__interiorHour ?? clock() };
}

/**
 * Put the sky over a world.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {SkyOptions} [options]
 * @returns {SkyHandle}
 */
export function createSky(renderer, scene, options = {}) {
	const planet = options.view === 'planet';
	const {
		shadowReach = 170,
		shadowMap = 4096,
		shadowGrid = 8,
		shadowsAt = null,
		shadowNear = 10,
		shadowFar = 1400,
		shadowBias = { bias: -0.0005, normal: 0.05 },
		lightDistance = planet ? 1000 : 700,
		fog = planet ? null : { near: 180, far: 1400 },
		exposure = planet ? { day: 0.9, night: 0.9 } : { day: 0.42, night: 0.92 },
		clouds = planet ? 0 : 0.4,
		onHour
	} = options;
	const dev = /** @type {{ __exposure?: number, __worldTime?: number, __interiorHour?: number }} */ (/** @type {unknown} */ (window));
	const clock = createSkyClock(options);

	const universe = createUniverse({ clouds });
	scene.add(universe.dome, universe.stars);
	// the light the sky casts on everything: the same sky, drawn into an environment map (on the ground)
	const pmrem = planet ? null : new THREE.PMREMGenerator(renderer);
	const envUniverse = planet ? null : createUniverse({ clouds: 0 });
	const envScene = new THREE.Scene();
	if (envUniverse) envScene.add(envUniverse.dome);

	const sun = new THREE.DirectionalLight('#fff1d8', 2.4);
	sun.castShadow = !planet;
	if (!planet) {
		sun.shadow.mapSize.set(shadowMap, shadowMap);
		const sc = sun.shadow.camera;
		sc.left = sc.bottom = -shadowReach;
		sc.right = sc.top = shadowReach;
		sc.near = shadowNear;
		sc.far = shadowFar;
		sun.shadow.bias = shadowBias.bias;
		sun.shadow.normalBias = shadowBias.normal;
	}
	scene.add(sun, sun.target);
	const fill = new THREE.HemisphereLight('#f4f0e6', '#6d5a3c', 0.4);
	scene.add(fill);
	if (fog) scene.fog = new THREE.Fog('#e3e9e6', fog.near, fog.far);

	/** @type {THREE.Vector3 | null} */
	let envAt = null;
	/** where the light comes from, sun or moon: the shadows follow you, the direction stays the sky's */
	const lightDir = new THREE.Vector3(0, 1, 0);
	const lastDir = new THREE.Vector3();
	if (!planet) renderer.shadowMap.autoUpdate = false;
	const follow = (/** @type {number} */ x, /** @type {number} */ z) => {
		if (planet) return;
		if (shadowsAt) [x, z] = shadowsAt;
		// snapped to a grid, so the shadows do not shimmer as you walk; and drawn again only
		// when that changes or the sun has moved, not every frame
		const gx = Math.round(x / shadowGrid) * shadowGrid, gz = Math.round(z / shadowGrid) * shadowGrid;
		if (gx !== sun.target.position.x || gz !== sun.target.position.z || !lightDir.equals(lastDir)) {
			renderer.shadowMap.needsUpdate = true;
			lastDir.copy(lightDir);
		}
		sun.target.position.set(gx, 0, gz);
		sun.position.copy(lightDir).multiplyScalar(lightDistance).add(sun.target.position);
	};

	/* ── a planet seen from space: where up is and how deep in the air the camera is, every frame ── */
	const viewUp = new THREE.Vector3(0, 1, 0);
	let viewAir = planet ? 0 : 1;
	let viewLimb = 0;
	/** the sun, the moon and the stars of the hour, for a planet */
	let planetSky = { sun: new THREE.Vector3(0, 0, 1), moon: new THREE.Vector3(0, 0, -1), stars: new THREE.Quaternion() };
	// the air round a planet is the ground's sky, under the planet's lens: as bright as it is over the islands
	const showPlanet = () => universe.set({ sun: planetSky.sun, moon: planetSky.moon, up: viewUp, atmosphere: viewAir, stars: planetSky.stars, skyScale: 0.42 / exposure.day, limb: viewLimb });

	/** @type {SkyLight} */
	let light = { hour: 0, e: 0, day: 0, low: 0, night: 0 };
	const setGround = (/** @type {number} */ hour) => {
		const l = lightAt(hour);
		const view = { sun: l.dir, moon: l.moon, up: new THREE.Vector3(0, 1, 0), atmosphere: 1, stars: groundStars(hour) };
		universe.set(view);
		envUniverse?.set(view);
		lightDir.copy(l.from);
		follow(sun.target.position.x, sun.target.position.z);
		sun.color.copy(l.sun.color);
		sun.intensity = l.sun.intensity;
		fill.color.copy(l.fill.color);
		fill.intensity = l.fill.intensity;
		// the air at the horizon: distant things melt into the sky that is really there
		if (fog && scene.fog instanceof THREE.Fog) scene.fog.color.copy(horizonAt(l.dir));
		scene.environmentIntensity = l.environment;
		// the film camera may open the lens for a dark shot: a multiplier, 1 in the game
		renderer.toneMappingExposure = (exposure.day + (exposure.night - exposure.day) * (1 - l.day)) * (dev.__exposure ?? 1);
		light = { hour, e: l.e, day: l.day, low: l.low, night: l.night };
		// the sky's light is made again when the sun has moved — on film at any move at all, so that no frame depends
		// on the frame drawn before it
		if (pmrem && (!envAt || (dev.__worldTime !== undefined ? !envAt.equals(l.dir) : envAt.angleTo(l.dir) > 0.04))) {
			envAt = l.dir.clone();
			const old = scene.environment;
			scene.environment = pmrem.fromScene(envScene).texture;
			old?.dispose();
		}
	};
	const setPlanet = (/** @type {number} */ hour) => {
		const c = celestial(hour);
		const stars = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -c.turn);
		planetSky = { sun: c.sun, moon: c.sun.clone().negate().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.09), stars };
		showPlanet();
		// in space the sun is white and the same at every hour: the hour is which side of the planet it lights
		sun.position.copy(c.sun).multiplyScalar(lightDistance);
		sun.color.set('#fff6ec');
		sun.intensity = 2.1;
		// the night side is dark, a faint cold light from the stars and the air keeps its shape
		fill.color.set('#9fb6e8');
		fill.groundColor.set('#0b1020');
		fill.intensity = 0.16;
		renderer.toneMappingExposure = exposure.day * (dev.__exposure ?? 1);
		// the hour on the ground under the camera, for whatever the world lights with it
		const e = c.sun.dot(viewUp);
		const day = THREE.MathUtils.smoothstep(e, -0.05, 0.35);
		light = { hour, e, day, low: 1 - THREE.MathUtils.smoothstep(e, 0, 0.6), night: 1 - THREE.MathUtils.smoothstep(e, -0.02, 0.18) };
	};
	const set = (hour = clock.hour()) => {
		if (planet) setPlanet(hour);
		else setGround(hour);
		onHour?.(light, { sun, fill, renderer, scene });
	};
	set();

	let checked = 0;
	/** the time control as the sky last followed it: a change shows at once, not at the next once-a-second look */
	let control = '';
	return {
		hour: clock.hour,
		set,
		tick: (now = performance.now()) => {
			const c = dev.__interiorHour !== undefined ? `film ${dev.__interiorHour}` : skyTime.auto ? 'auto' : `hand ${skyTime.hour}`;
			if (c === control && now - checked < 1000) return;
			control = c;
			checked = now;
			set();
		},
		follow,
		view(up, atmosphere, limb = 0) {
			viewUp.copy(up);
			viewAir = atmosphere;
			viewLimb = limb;
			showPlanet();
		},
		light: () => light,
		sun,
		fill,
		dome: universe.dome,
		dispose() {
			scene.remove(universe.dome, universe.stars, sun, sun.target, fill);
			universe.dispose();
			envUniverse?.dispose();
			sun.shadow.map?.dispose();
			if (pmrem) {
				scene.environment?.dispose();
				scene.environment = null;
				pmrem.dispose();
			}
		}
	};
}
