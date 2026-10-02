/**
 * THE SKY OF A SANDBOX — a sun and a moon that follow the in-game clock.
 *
 * Every world has the same sky controls: one dial, the hour, sets it all; keep it at day
 * (`alwaysDay`) and it stays at late morning while the clock runs on; the film camera pins
 * any hour. Two looks share them:
 *
 *   'scattering' (Sandbox 3 and 4: walked at eye height) — a scattering sky dome, the light it
 *     casts on everything (an environment made again whenever the sun has moved), a sun that
 *     throws shadows and is a cold moon at night, fog that darkens, a lens that opens at night;
 *   'clay' (Sandbox 1 and 2's islands: a board seen from above) — a flat sky colour that runs
 *     through dawn, noon, golden hour and blue hour, a visible sun disc on the light's arc,
 *     and a cold fill that keeps the board readable at night instead of going black.
 *
 * The world owns the renderer and the scene; the sky only adds to them, set to the hour as it
 * is made. For 'scattering', give the renderer ACES tone mapping and soft shadows
 * (`createStage` in ./stage.js does) and call `follow(x, z)` with where the camera stands.
 * Call `tick()` every frame. What else changes with the hour in your world — lamps that glow
 * at night, the hour of a dome's inside — goes in `onHour`.
 *
 * The film camera (src/lib/film, ./film.js) steers any world built on this sky: it pins the
 * hour with `window.__interiorHour`, opens the lens for a dark shot with `window.__exposure`,
 * and sets `window.__worldTime` while it holds the clock.
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
 * @property {'scattering' | 'clay'} style
 * @property {() => number} hour the hour the sky shows now: the film's, the kept day's, or the clock's
 * @property {(hour?: number) => void} set set the sun to an hour now (the clock's by default), not at the next check
 * @property {(now?: number) => void} tick call every frame: the sun is moved on to the clock once a second
 * @property {(x: number, z: number) => void} follow the shadows follow whoever stands here ('scattering')
 * @property {(on: boolean) => void} alwaysDay keep the sky at day whatever the hour, or follow the clock again
 * @property {() => boolean} keptAtDay
 * @property {() => SkyLight} light the light the sky was last set to
 * @property {THREE.DirectionalLight} sun the sun by day and the moon by night
 * @property {THREE.HemisphereLight} fill
 * @property {THREE.Object3D} dome the sky itself ('scattering'), or the sun's disc ('clay')
 * @property {THREE.Color} color the colour of the sky now ('clay': the page behind the world can match it)
 * @property {() => void} dispose
 */

/**
 * @typedef {{ sun: THREE.DirectionalLight, fill: THREE.HemisphereLight, renderer: THREE.WebGLRenderer, scene: THREE.Scene }} SkyParts
 */

/**
 * @typedef {{
 *   style?: 'scattering' | 'clay',
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
 *   fog?: { day: string, night: string, dusk?: string, near: number, far: number } | null,
 *   exposure?: { day: number, night: number },
 *   onHour?: (light: SkyLight, parts: SkyParts) => void
 * }} SkyOptions
 *   style: the look (see above); dayHour: the hour shown when kept at day (11: late morning, the shadows still long
 *   enough to read); clock: the hour now, 0…24 (the in-game clock); size: the sky dome's radius ('scattering'), or how
 *   far out the sun's disc rides ('clay'); shadowReach: how far round the camera the sun's shadows reach; shadowMap:
 *   their resolution; shadowGrid: the shadows move in steps this big, so they do not shimmer as you walk; shadowsAt:
 *   the shadows stay round this point instead of following the camera (a world as small as one dome); shadowNear,
 *   shadowFar, shadowBias: the shadow camera; lightDistance: how far off the light stands; fog: its colours by day,
 *   at dusk and by night and its distances, or null for none ('scattering'); exposure: the lens by day and by night
 *   ('scattering'); onHour: everything else in the world that changes with the hour (called once already as the
 *   sky is made, so it must not need the sky — the sun and the fill are handed to it)
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
 * The clay sky's sun: its swing across the sky (an angle round the y axis, morning and evening light from opposite
 * sides) and its height, -1…1. A world framing its opening view on the sun uses the same swing.
 * @param {number} hour
 */
export function claySunAt(hour) {
	return { azimuth: ((hour - 5) / 15) * Math.PI * 0.9 + 0.35, e: Math.sin(((hour - 5) / 15) * Math.PI) };
}

/**
 * Put a sky over a world.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {SkyOptions} [options]
 * @returns {SkyHandle}
 */
export function createSky(renderer, scene, options = {}) {
	const { style = 'scattering', dayHour = 11, clock = gameHour, onHour } = options;
	const dev = /** @type {{ __interiorHour?: number, __exposure?: number, __worldTime?: number }} */ (/** @type {unknown} */ (window));
	let keepDay = false;
	const hourNow = () => dev.__interiorHour ?? (keepDay ? dayHour : clock());
	const look = style === 'clay' ? clay(renderer, scene, options, dev) : scattering(renderer, scene, options, dev);

	/** @type {SkyLight} */
	let light = { hour: 0, e: 0, day: 0, low: 0, night: 0 };
	const set = (hour = hourNow()) => {
		light = look.set(hour);
		onHour?.(light, { sun: look.sun, fill: look.fill, renderer, scene });
	};
	set();
	let checked = 0;
	return {
		style,
		hour: hourNow,
		set,
		tick: (now = performance.now()) => {
			if (now - checked < 1000) return;
			checked = now;
			set();
		},
		follow: look.follow,
		alwaysDay: (on) => {
			keepDay = on;
			set();
		},
		keptAtDay: () => keepDay,
		light: () => light,
		sun: look.sun,
		fill: look.fill,
		dome: look.dome,
		color: look.color,
		dispose: look.dispose
	};
}

/**
 * The scattering sky: Sandbox 4's, walked at eye height.
 * @param {THREE.WebGLRenderer} renderer @param {THREE.Scene} scene @param {SkyOptions} o
 * @param {{ __exposure?: number, __worldTime?: number }} dev
 */
function scattering(renderer, scene, o, dev) {
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
		fog = { day: '#e3e9e6', night: '#1c2438', near: 180, far: 1400 },
		exposure = { day: 0.42, night: 0.92 }
	} = o;
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
	sc.near = shadowNear;
	sc.far = shadowFar;
	sun.shadow.bias = shadowBias.bias;
	sun.shadow.normalBias = shadowBias.normal;
	scene.add(sun, sun.target);
	const fill = new THREE.HemisphereLight('#f4f0e6', '#6d5a3c', 0.4);
	scene.add(fill);
	if (fog) scene.fog = new THREE.Fog(fog.day, fog.near, fog.far);
	const fogDay = new THREE.Color(fog?.day ?? '#ffffff'), fogNight = new THREE.Color(fog?.night ?? '#000000');
	const fogDusk = fog?.dusk ? new THREE.Color(fog.dusk) : null;
	const warm = new THREE.Color('#ffb070'), white = new THREE.Color('#fff1d8'), moon = new THREE.Color('#8ea6dc');
	const color = fogDay.clone();

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

	return {
		sun,
		fill,
		dome,
		color,
		follow,
		set(/** @type {number} */ hour) {
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
			color.copy(fogDay);
			if (fogDusk) color.lerp(fogDusk, low * day);
			color.lerp(fogNight, 1 - day);
			if (fog && scene.fog instanceof THREE.Fog) scene.fog.color.copy(color);
			scene.environmentIntensity = 0.12 + 0.18 * day;
			// the film camera may open the lens for a dark shot: a multiplier, 1 in the game
			renderer.toneMappingExposure = (exposure.day + (exposure.night - exposure.day) * (1 - day)) * (dev.__exposure ?? 1);
			// the sky's light is made again when the sun has moved — on film at any move at all, so that no frame depends
			// on the frame drawn before it
			if (!envAt || (dev.__worldTime !== undefined ? !envAt.equals(dir) : envAt.angleTo(dir) > 0.04)) {
				envAt = dir.clone();
				envSky.material.uniforms['sunPosition'].value.copy(dir);
				const old = scene.environment;
				scene.environment = pmrem.fromScene(envScene).texture;
				old?.dispose();
			}
			return { hour, e, day, low, night };
		},
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

/** Key colours of a clay day, in order: deep night, dawn, noon, dusk, the blue hour, back to night. */
const SKY_STOPS = /** @type {[number, string][]} */ ([
	[0, '#101a2e'],
	[4.5, '#2b3f5e'],
	[6, '#cfa88f'],
	[7.5, '#cde9ec'],
	[17, '#cde9ec'],
	[19, '#e8b48c'],
	// blue hour: the few minutes after sunset when the whole sky turns blue
	[19.9, '#6f84b8'],
	[20.5, '#3d3f63'],
	[22, '#101a2e'],
	[24, '#101a2e']
]);
const SUN_STOPS = /** @type {[number, string][]} */ ([
	[0, '#5f7bb5'],
	[5, '#8e7fa8'],
	[6.5, '#ffb37a'],
	[8.5, '#fff2dd'],
	[16, '#fff2dd'],
	[18.5, '#ffb37a'],
	[20, '#c2739b'],
	[21.5, '#5f7bb5'],
	[24, '#5f7bb5']
]);
/** @param {[number, string][]} stops @param {number} hour @param {THREE.Color} out */
function gradientAt(stops, hour, out) {
	const h = ((hour % 24) + 24) % 24;
	for (let i = 0; i < stops.length - 1; i++) {
		const [h0, c0] = stops[i];
		const [h1, c1] = stops[i + 1];
		if (h >= h0 && h <= h1) return out.set(c0).lerp(new THREE.Color(c1), h1 === h0 ? 0 : (h - h0) / (h1 - h0));
	}
	return out.set(stops[stops.length - 1][1]);
}

/**
 * The clay sky: Sandbox 1's and Sandbox 2's islands, a board seen from above. The light keeps the board's own clay
 * look: no environment, no fog of its own (the world's fog takes the sky's colour), the lens left as the world set it.
 * @param {THREE.WebGLRenderer} renderer @param {THREE.Scene} scene @param {SkyOptions} o
 * @param {{ __exposure?: number }} dev
 */
function clay(renderer, scene, o, dev) {
	const { shadowReach = 90, shadowFar = 280, shadowMap = 2048, size: distance = 120 } = o;
	const lens = renderer.toneMappingExposure;
	const fill = new THREE.HemisphereLight('#eaf6ff', '#d8c9a8', 0.95);
	scene.add(fill);
	const sun = new THREE.DirectionalLight('#fff2dd', 2.1);
	sun.castShadow = true;
	sun.shadow.mapSize.set(shadowMap, shadowMap);
	sun.shadow.camera.left = -shadowReach;
	sun.shadow.camera.right = shadowReach;
	sun.shadow.camera.top = shadowReach;
	sun.shadow.camera.bottom = -shadowReach;
	sun.shadow.camera.far = shadowFar;
	sun.shadow.bias = -0.0004;
	scene.add(sun);
	// the visible sun: an unlit disc riding the same arc as the light
	const discMat = new THREE.MeshBasicMaterial({ color: '#fff6e0', fog: false });
	const disc = new THREE.Mesh(new THREE.SphereGeometry(distance * 0.045, 16, 12), discMat);
	scene.add(disc);
	const color = new THREE.Color('#cde9ec');
	const sunColor = new THREE.Color('#fff2dd');
	const white = new THREE.Color('#ffffff'), fillDay = new THREE.Color('#eaf6ff'), groundNight = new THREE.Color('#2a3348');

	return {
		sun,
		fill,
		dome: disc,
		color,
		follow: (/** @type {number} */ _x, /** @type {number} */ _z) => {},
		set(/** @type {number} */ hour) {
			const { azimuth, e } = claySunAt(hour);
			const height = Math.max(e, -0.35);
			const horizontal = Math.cos(Math.asin(Math.max(-1, Math.min(1, height))));
			sun.position.set(Math.cos(azimuth) * horizontal * distance, height * distance, Math.sin(azimuth) * horizontal * distance);
			disc.position.copy(sun.position);
			gradientAt(SKY_STOPS, hour, color);
			gradientAt(SUN_STOPS, hour, sunColor);
			sun.color.copy(sunColor);
			// daylight fades out as the sun sets; a cold fill keeps night readable. Full light until the sun is low, and
			// still generous in the last minutes before it sets — golden hour should glow, not go dim
			const day = Math.max(0, Math.min(1, e * 6.5));
			sun.intensity = 0.12 + day * 2.0;
			sun.visible = e > -0.12;
			disc.visible = e > -0.05;
			discMat.color.copy(sunColor).lerp(white, 0.35);
			fill.intensity = 0.34 + day * 0.65;
			fill.color.copy(color).lerp(fillDay, 0.55);
			fill.groundColor.set('#d8c9a8').lerp(groundNight, 1 - day);
			scene.background = color;
			if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(color);
			// the film camera may open the lens for a dark shot
			renderer.toneMappingExposure = lens * (dev.__exposure ?? 1);
			const low = 1 - THREE.MathUtils.smoothstep(e, 0, 0.6);
			return { hour, e, day, low, night: 1 - THREE.MathUtils.smoothstep(e, -0.02, 0.18) };
		},
		dispose() {
			scene.remove(fill, sun, disc);
			disc.geometry.dispose();
			discMat.dispose();
			fill.dispose();
			sun.dispose();
		}
	};
}
