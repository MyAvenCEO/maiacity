/**
 * THE SKY — one sky for every avenCITY world, and the single source of truth for its light.
 *
 * One dial, the hour, sets it all, the same way in every sandbox:
 *   · `sunAt(hour)` — where the sun stands: it rises in the east at five, is highest at half past twelve, sets in
 *     the west at eight;
 *   · `lightAt(hour)` — what that light is: the sun's colour and strength (warm and low at dawn and dusk, a cold
 *     moon at night), the fill from the sky, the fog's colour (day, a warm dusk, night), how much of the day there
 *     is and how dark the night is;
 *   · `createSkyClock()` — which hour it is: the in-game clock (game/time), or day kept while the clock runs on
 *     (the Day switch, $lib/sandbox-kit/SkyToggle), or the hour a film pins (`window.__interiorHour`);
 *   · `createSky(renderer, scene)` — the sky itself over a world: a scattering sky dome, the light it casts on
 *     everything (an environment made again whenever the sun has moved), the sun that throws shadows and is the
 *     moon at night, the fill, the fog, and at night the stars and the moon's disc.
 *
 * A world differs only in its size (how far the shadows and the fog reach, how far off the light stands) and its
 * lens (`exposure`); never in how the sky behaves. A world that has no sky round it (Sandbox 2's planet, seen from
 * space) lights itself from `lightAt` and the same clock.
 *
 * The world owns the renderer and the scene; the sky only adds to them, set to the hour as it is made. Give the
 * renderer ACES tone mapping and soft shadows (`createStage` in ./stage.js does), call `tick()` every frame and
 * `follow(x, z)` with where the camera stands. What else changes with the hour in your world — lamps that glow at
 * night, the hour of a dome's inside — goes in `onHour`.
 *
 * The film camera (src/lib/film, ./film.js) steers every world through it: it pins the hour with
 * `window.__interiorHour`, opens the lens for a dark shot with `window.__exposure`, and sets `window.__worldTime`
 * while it holds the clock.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { gameHour } from '../../../game/time';

/** The hour the sky shows when it is kept at day: late morning, the shadows still long enough to read. */
export const DAY_HOUR = 11;

/**
 * @typedef {{ hour: number, e: number, day: number, low: number, night: number }} SkyLight
 *   the hour, the sun's height (-1…1, below the horizon under 0), how much of the day there is (0…1),
 *   how low and warm the sun is (0…1) and how dark the night is (0…1: lamps glow by it)
 */

/**
 * @typedef {SkyLight & {
 *   dir: THREE.Vector3, from: THREE.Vector3,
 *   sun: { color: THREE.Color, intensity: number },
 *   fill: { color: THREE.Color, intensity: number },
 *   fog: THREE.Color, environment: number
 * }} Light
 *   dir: where the sun stands; from: where the light comes from (the sun by day, the moon high on the far side of the
 *   sky by night); sun, fill: the key light and the sky's fill; fog: the colour of the air; environment: how strongly
 *   the sky's own light falls on everything
 */

/**
 * @typedef {object} SkyClock which hour the sky shows
 * @property {() => number} hour the film's, the kept day's, or the clock's
 * @property {(on: boolean) => void} alwaysDay keep the sky at day whatever the hour, or follow the clock again
 * @property {() => boolean} keptAtDay
 */

/**
 * @typedef {object} SkyHandle
 * @property {() => number} hour the hour the sky shows now: the film's, the kept day's, or the clock's
 * @property {(hour?: number) => void} set set the sun to an hour now (the clock's by default), not at the next check
 * @property {(now?: number) => void} tick call every frame: the sun is moved on to the clock once a second
 * @property {(x: number, z: number) => void} follow the shadows follow whoever stands here
 * @property {(on: boolean) => void} alwaysDay keep the sky at day whatever the hour, or follow the clock again
 * @property {() => boolean} keptAtDay
 * @property {() => SkyLight} light the light the sky was last set to
 * @property {THREE.DirectionalLight} sun the sun by day and the moon by night
 * @property {THREE.HemisphereLight} fill
 * @property {Sky} dome the sky itself
 * @property {() => void} dispose
 */

/**
 * @typedef {{ sun: THREE.DirectionalLight, fill: THREE.HemisphereLight, renderer: THREE.WebGLRenderer, scene: THREE.Scene }} SkyParts
 */

/**
 * @typedef {{
 *   dayHour?: number,
 *   clock?: () => number,
 *   size?: number,
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
 *   stars?: boolean,
 *   onHour?: (light: SkyLight, parts: SkyParts) => void
 * }} SkyOptions
 *   dayHour: the hour shown when kept at day; clock: the hour now, 0…24 (the in-game clock); size: the sky dome's
 *   radius; shadowReach: how far round the camera the sun's shadows reach; shadowMap: their resolution; shadowGrid:
 *   the shadows move in steps this big, so they do not shimmer as you walk; shadowsAt: the shadows stay round this
 *   point instead of following the camera (a world as small as one dome, or an island seen whole); shadowNear,
 *   shadowFar, shadowBias: the shadow camera; lightDistance: how far off the light stands; fog: how near it starts
 *   and how far it closes, or null for none (its colour is the sky's); exposure: the world's lens by day and by night;
 *   stars: the night's stars and moon; onHour: everything else in the world that changes with the hour (called once
 *   already as the sky is made, so it must not need the sky — the sun and the fill are handed to it)
 */

/**
 * The hour's sun: where it stands in the sky (a unit vector) and how high, -1…1.
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
const FOG_DAY = new THREE.Color('#e3e9e6'), FOG_DUSK = new THREE.Color('#e9c9a8'), FOG_NIGHT = new THREE.Color('#1c2438');

/**
 * The light of an hour: everything every world's light follows. Pure: the same hour, the same light.
 * @param {number} hour
 * @returns {Light}
 */
export function lightAt(hour) {
	const { dir, e } = sunAt(hour);
	const day = THREE.MathUtils.smoothstep(e, -0.05, 0.35);
	const low = 1 - THREE.MathUtils.smoothstep(e, 0, 0.6);
	const night = 1 - THREE.MathUtils.smoothstep(e, -0.02, 0.18);
	const up = e > -0.02;
	return {
		hour,
		e,
		day,
		low,
		night,
		dir,
		// below the horizon the light is the moon's, high on the far side of the sky
		from: up ? dir.clone() : dir.clone().negate().setY(Math.abs(dir.y) + 0.4).normalize(),
		sun: { color: up ? WHITE.clone().lerp(WARM, low) : MOON.clone(), intensity: up ? 0.5 + 2.5 * day : 1.1 },
		fill: { color: FILL.clone().lerp(MOON, 1 - day), intensity: 0.34 + 0.08 * day },
		fog: FOG_DAY.clone().lerp(FOG_DUSK, low * day).lerp(FOG_NIGHT, 1 - day),
		environment: 0.12 + 0.18 * day
	};
}

/**
 * Which hour the sky shows: the film's (`window.__interiorHour`), else day if kept, else the clock's.
 * @param {{ dayHour?: number, clock?: () => number }} [o]
 * @returns {SkyClock}
 */
export function createSkyClock({ dayHour = DAY_HOUR, clock = gameHour } = {}) {
	const dev = /** @type {{ __interiorHour?: number }} */ (/** @type {unknown} */ (window));
	let keepDay = false;
	return {
		hour: () => dev.__interiorHour ?? (keepDay ? dayHour : clock()),
		alwaysDay: (on) => void (keepDay = on),
		keptAtDay: () => keepDay
	};
}

/** a seeded random generator: the same stars in every world, every frame, every film */
const seeded = (/** @type {number} */ seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/**
 * The night: stars over the whole sky and the moon's disc where its light comes from, faded in with the dark. Drawn
 * just inside the far plane round the camera, wherever it is: at the distance of the sky.
 */
function nightSky() {
	const r = seeded(20260903);
	const n = 1400;
	const pos = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		// evenly over the sky, a little below the horizon too (hills and the sea hide it)
		const y = -0.1 + r() * 1.1, a = r() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - y * y));
		pos.set([Math.cos(a) * s, y, Math.sin(a) * s], i * 3);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	const starMat = new THREE.PointsMaterial({ color: '#dfe6ff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
	const stars = new THREE.Points(geo, starMat);
	const moonMat = new THREE.MeshBasicMaterial({ color: '#e8eeff', transparent: true, opacity: 0, fog: false, depthWrite: false });
	const moon = new THREE.Mesh(new THREE.CircleGeometry(1, 32), moonMat);
	const moonDir = new THREE.Vector3(0, 1, 0);
	stars.frustumCulled = moon.frustumCulled = false;
	stars.onBeforeRender = (_r, _s, cam) => {
		stars.position.copy(cam.position);
		stars.scale.setScalar(/** @type {THREE.PerspectiveCamera} */ (cam).far * 0.9);
		stars.updateMatrixWorld();
	};
	moon.onBeforeRender = (_r, _s, cam) => {
		const far = /** @type {THREE.PerspectiveCamera} */ (cam).far;
		moon.position.copy(cam.position).addScaledVector(moonDir, far * 0.85);
		moon.scale.setScalar(far * 0.018);
		moon.lookAt(cam.position);
		moon.updateMatrixWorld();
	};
	return {
		objects: [stars, moon],
		/** @param {Light} l */
		set(l) {
			starMat.opacity = 0.9 * l.night;
			moonMat.opacity = l.night;
			stars.visible = moon.visible = l.night > 0.01;
			moonDir.copy(l.from);
		},
		dispose() {
			geo.dispose();
			starMat.dispose();
			moon.geometry.dispose();
			moonMat.dispose();
		}
	};
}

/**
 * Put the sky over a world.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {SkyOptions} [options]
 * @returns {SkyHandle}
 */
export function createSky(renderer, scene, options = {}) {
	const {
		size = 4000,
		shadowReach = 170,
		shadowMap = 4096,
		shadowGrid = 8,
		shadowsAt = null,
		shadowNear = 10,
		shadowFar = 1400,
		shadowBias = { bias: -0.0005, normal: 0.05 },
		lightDistance = 700,
		fog = { near: 180, far: 1400 },
		exposure = { day: 0.42, night: 0.92 },
		stars = true,
		onHour
	} = options;
	const dev = /** @type {{ __exposure?: number, __worldTime?: number }} */ (/** @type {unknown} */ (window));
	const clock = createSkyClock(options);

	const dome = new Sky();
	dome.scale.setScalar(size);
	const u = dome.material.uniforms;
	u['turbidity'].value = 3;
	u['rayleigh'].value = 1.2;
	u['mieCoefficient'].value = 0.004;
	u['mieDirectionalG'].value = 0.8;
	scene.add(dome);
	// the light the sky casts on everything: a copy of it, drawn into an environment map
	const pmrem = new THREE.PMREMGenerator(renderer);
	const envScene = new THREE.Scene();
	const envSky = new Sky();
	envSky.scale.setScalar(1000);
	Object.assign(envSky.material.uniforms, THREE.UniformsUtils.clone(u));
	envScene.add(envSky);
	const night = stars ? nightSky() : null;
	if (night) scene.add(...night.objects);

	const sun = new THREE.DirectionalLight('#fff1d8', 2.4);
	sun.castShadow = true;
	sun.shadow.mapSize.set(shadowMap, shadowMap);
	const sc = sun.shadow.camera;
	sc.left = sc.bottom = -shadowReach;
	sc.right = sc.top = shadowReach;
	sc.near = shadowNear;
	sc.far = shadowFar;
	sun.shadow.bias = shadowBias.bias;
	sun.shadow.normalBias = shadowBias.normal;
	scene.add(sun, sun.target);
	const fill = new THREE.HemisphereLight('#f4f0e6', '#6d5a3c', 0.4);
	scene.add(fill);
	if (fog) scene.fog = new THREE.Fog(FOG_DAY, fog.near, fog.far);

	/** @type {THREE.Vector3 | null} */
	let envAt = null;
	/** where the light comes from, sun or moon: the shadows follow you, the direction stays the sky's */
	const lightDir = new THREE.Vector3(0, 1, 0);
	const lastDir = new THREE.Vector3();
	renderer.shadowMap.autoUpdate = false;
	const follow = (/** @type {number} */ x, /** @type {number} */ z) => {
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

	/** @type {SkyLight} */
	let light = { hour: 0, e: 0, day: 0, low: 0, night: 0 };
	const set = (hour = clock.hour()) => {
		const l = lightAt(hour);
		u['sunPosition'].value.copy(l.dir);
		lightDir.copy(l.from);
		follow(sun.target.position.x, sun.target.position.z);
		sun.color.copy(l.sun.color);
		sun.intensity = l.sun.intensity;
		fill.color.copy(l.fill.color);
		fill.intensity = l.fill.intensity;
		if (fog && scene.fog instanceof THREE.Fog) scene.fog.color.copy(l.fog);
		scene.environmentIntensity = l.environment;
		night?.set(l);
		// the film camera may open the lens for a dark shot: a multiplier, 1 in the game
		renderer.toneMappingExposure = (exposure.day + (exposure.night - exposure.day) * (1 - l.day)) * (dev.__exposure ?? 1);
		light = { hour, e: l.e, day: l.day, low: l.low, night: l.night };
		onHour?.(light, { sun, fill, renderer, scene });
		// the sky's light is made again when the sun has moved — on film at any move at all, so that no frame depends
		// on the frame drawn before it
		if (!envAt || (dev.__worldTime !== undefined ? !envAt.equals(l.dir) : envAt.angleTo(l.dir) > 0.04)) {
			envAt = l.dir.clone();
			envSky.material.uniforms['sunPosition'].value.copy(l.dir);
			const old = scene.environment;
			scene.environment = pmrem.fromScene(envScene).texture;
			old?.dispose();
		}
	};
	set();

	let checked = 0;
	return {
		hour: clock.hour,
		set,
		tick: (now = performance.now()) => {
			if (now - checked < 1000) return;
			checked = now;
			set();
		},
		follow,
		alwaysDay: (on) => {
			clock.alwaysDay(on);
			set();
		},
		keptAtDay: clock.keptAtDay,
		light: () => light,
		sun,
		fill,
		dome,
		dispose() {
			scene.remove(dome, sun, sun.target, fill);
			if (night) {
				scene.remove(...night.objects);
				night.dispose();
			}
			dome.geometry.dispose();
			dome.material.dispose();
			envSky.geometry.dispose();
			envSky.material.dispose();
			sun.shadow.map?.dispose();
			scene.environment?.dispose();
			scene.environment = null;
			pmrem.dispose();
		}
	};
}
