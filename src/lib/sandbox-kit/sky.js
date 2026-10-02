/**
 * THE SKY OF A SANDBOX — a sun and a moon that follow the in-game clock.
 *
 * Taken out of Sandbox 4 so every world has the same sky: a scattering sky
 * dome, the light it casts on everything (an environment made again whenever
 * the sun has moved), a sun that throws shadows and is a cold moon at night,
 * a soft fill from above and below, and fog that darkens with the hour. Keep it
 * at day (`alwaysDay`) and the sky stays at late morning while the clock runs on.
 *
 * The world owns the renderer and the scene; the sky only adds to them, set to
 * the hour as it is made. Give the renderer ACES tone mapping and soft shadows
 * (`createStage` in ./stage.js does), call `tick()` every frame
 * and `follow(x, z)` with where the camera stands (the shadows follow it).
 * What else changes with the hour in your world — lamps that glow at night,
 * the hour of a dome's inside — goes in `onHour`.
 *
 * The film camera (src/lib/film) steers any world built on this sky: it pins
 * the hour with `window.__interiorHour`, opens the lens for a dark shot with
 * `window.__exposure`, and sets `window.__worldTime` while it holds the clock.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { gameHour } from '../../../game/time';

/**
 * @typedef {{ hour: number, e: number, day: number, low: number, night: number }} SkyLight
 *   the hour, the sun's height (-1…1, below the horizon under 0), how much of the day there is (0…1),
 *   how low and warm the sun is (0…1) and how dark the night is (0…1: lamps glow by it)
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
 * The hour's sun: where it stands in the sky (a unit vector) and how high, -1…1. It rises in the east at five,
 * is highest at half past twelve and sets in the west at eight.
 * @param {number} hour
 */
export function sunAt(hour) {
	const e = Math.sin(((hour - 5) / 15) * Math.PI);
	const alt = e * THREE.MathUtils.degToRad(68);
	const az = THREE.MathUtils.degToRad(90 + ((hour - 5) / 15) * 180);
	return { dir: new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - alt, az), e };
}

/**
 * Put a sky over a world.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {{
 *   dayHour?: number,
 *   clock?: () => number,
 *   size?: number,
 *   shadowReach?: number,
 *   shadowMap?: number,
 *   shadowGrid?: number,
 *   fog?: { day: string, night: string, near: number, far: number } | null,
 *   exposure?: { day: number, night: number },
 *   onHour?: (light: SkyLight) => void
 * }} [options]
 *   dayHour: the hour shown when kept at day (11: late morning, the shadows still long enough to read);
 *   clock: the hour now, 0…24 (the in-game clock); size: the sky dome's radius; shadowReach: how far round
 *   the camera the sun's shadows reach, in metres; shadowMap: their resolution; shadowGrid: the shadows move
 *   in steps this big, so they do not shimmer as you walk; fog: its colours by day and night and its
 *   distances, or null for none; exposure: the lens by day and by night; onHour: everything else in the
 *   world that changes with the hour (called once already as the sky is made, so it must not need the sky)
 * @returns {SkyHandle}
 */
export function createSky(renderer, scene, options = {}) {
	const {
		dayHour = 11,
		clock = gameHour,
		size = 4000,
		shadowReach = 170,
		shadowMap = 4096,
		shadowGrid = 8,
		fog = { day: '#e3e9e6', night: '#1c2438', near: 180, far: 1400 },
		exposure = { day: 0.42, night: 0.92 },
		onHour
	} = options;
	const dev = /** @type {{ __interiorHour?: number, __exposure?: number, __worldTime?: number }} */ (/** @type {unknown} */ (window));
	let keepDay = false;
	const hourNow = () => dev.__interiorHour ?? (keepDay ? dayHour : clock());

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

	const sun = new THREE.DirectionalLight('#fff1d8', 2.4);
	sun.castShadow = true;
	sun.shadow.mapSize.set(shadowMap, shadowMap);
	const sc = sun.shadow.camera;
	sc.left = sc.bottom = -shadowReach;
	sc.right = sc.top = shadowReach;
	sc.near = 10;
	sc.far = 1400;
	sun.shadow.bias = -0.0005;
	sun.shadow.normalBias = 0.05;
	scene.add(sun, sun.target);
	const fill = new THREE.HemisphereLight('#f4f0e6', '#6d5a3c', 0.4);
	scene.add(fill);
	if (fog) scene.fog = new THREE.Fog(fog.day, fog.near, fog.far);
	const fogDay = new THREE.Color(fog?.day ?? '#ffffff'), fogNight = new THREE.Color(fog?.night ?? '#000000');
	const warm = new THREE.Color('#ffb070'), white = new THREE.Color('#fff1d8'), moon = new THREE.Color('#8ea6dc');

	/** @type {THREE.Vector3 | null} */
	let envAt = null;
	/** where the light comes from, sun or moon: the shadows follow you, the direction stays the sky's */
	const lightDir = new THREE.Vector3(0, 1, 0);
	const lastDir = new THREE.Vector3();
	renderer.shadowMap.autoUpdate = false;
	const follow = (/** @type {number} */ x, /** @type {number} */ z) => {
		// snapped to a grid, so the shadows do not shimmer as you walk; and drawn again only
		// when that changes or the sun has moved, not every frame
		const gx = Math.round(x / shadowGrid) * shadowGrid, gz = Math.round(z / shadowGrid) * shadowGrid;
		if (gx !== sun.target.position.x || gz !== sun.target.position.z || !lightDir.equals(lastDir)) {
			renderer.shadowMap.needsUpdate = true;
			lastDir.copy(lightDir);
		}
		sun.target.position.set(gx, 0, gz);
		sun.position.copy(lightDir).multiplyScalar(700).add(sun.target.position);
	};

	/** @type {SkyLight} */
	let light = { hour: 0, e: 0, day: 0, low: 0, night: 0 };
	const set = (hour = hourNow()) => {
		const { dir, e } = sunAt(hour);
		const day = THREE.MathUtils.smoothstep(e, -0.05, 0.35);
		const low = 1 - THREE.MathUtils.smoothstep(e, 0, 0.6);
		const night = 1 - THREE.MathUtils.smoothstep(e, -0.02, 0.18);
		u['sunPosition'].value.copy(dir);
		// below the horizon the light is the moon's, high on the far side of the sky
		lightDir.copy(e > -0.02 ? dir : dir.clone().negate().setY(Math.abs(dir.y) + 0.4).normalize());
		follow(sun.target.position.x, sun.target.position.z);
		sun.color.copy(e > -0.02 ? white.clone().lerp(warm, low) : moon);
		sun.intensity = e > -0.02 ? 0.5 + 2.5 * day : 1.1;
		fill.intensity = 0.34 + 0.08 * day;
		fill.color.set('#f4f0e6').lerp(moon, 1 - day);
		if (fog && scene.fog instanceof THREE.Fog) scene.fog.color.copy(fogDay).lerp(fogNight, 1 - day);
		scene.environmentIntensity = 0.12 + 0.18 * day;
		// the film camera may open the lens for a dark shot: a multiplier, 1 in the game
		renderer.toneMappingExposure = (exposure.day + (exposure.night - exposure.day) * (1 - day)) * (dev.__exposure ?? 1);
		light = { hour, e, day, low, night };
		onHour?.(light);
		// the sky's light is made again when the sun has moved — on film at any move at all, so that no frame depends
		// on the frame drawn before it
		if (!envAt || (dev.__worldTime !== undefined ? !envAt.equals(dir) : envAt.angleTo(dir) > 0.04)) {
			envAt = dir.clone();
			envSky.material.uniforms['sunPosition'].value.copy(dir);
			const old = scene.environment;
			scene.environment = pmrem.fromScene(envScene).texture;
			old?.dispose();
		}
	};

	set();
	let checked = 0;
	return {
		hour: hourNow,
		set,
		tick: (now = performance.now()) => {
			if (now - checked < 1000) return;
			checked = now;
			set();
		},
		follow,
		alwaysDay: (on) => {
			keepDay = on;
			set();
		},
		keptAtDay: () => keepDay,
		light: () => light,
		sun,
		fill,
		dome,
		dispose() {
			scene.remove(dome, sun, sun.target, fill);
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
