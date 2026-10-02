/**
 * THE FILM CAMERA'S HOLD ON A WORLD — what makes any sandbox a set the studio can shoot.
 *
 * The film camera (src/lib/film: the studio's world viewer, the Mac app's plate renderer, the shoot CLI) renders a
 * shot frame by frame, every frame set from the shot alone — the camera, the hour, the world's clock, the lights —
 * never from the frame before it, so the same shot renders the same pixels every time. It does that through one
 * contract, the same for every world: `window.__world`, made here by `connectFilm`.
 *
 * A world built on the kit hands over its stage (renderer, scene, camera), its sky, its camera controller (the
 * walker, the orbit rig, or a bare `createCameraHold`) and whatever else it animates, and keeps three rules in its
 * own frame loop while a film holds it:
 *   · draw nothing itself while `filmDraws()` (the film draws the canvas, only when asked);
 *   · run its animations on `worldTime()` when the film sets it (the shot's clock), else on its own;
 *   · keep its resolution while `filmHoldsSize()` (`stage.adapt(now, filmHoldsSize())`).
 *
 * A shot names its world (game/film/worlds.js): `world.sandbox`, and `world.area` where a sandbox has more than one.
 * Each sandbox's film page (/games/<sandbox>/?film) mounts the world for the area and calls `connectFilm`.
 */
import * as THREE from 'three';

/** @typedef {[x: number, y: number, z: number, yaw: number, pitch: number]} Pose */

/**
 * @typedef {object} CameraHold the camera as the film flies it: a pose, free of any controls, until let go
 * @property {(x: number, y: number, z: number, yaw: number, pitch: number) => void} fly
 * @property {() => Pose | null} flying
 * @property {() => boolean} apply put the camera at the held pose now (false when nothing is held)
 * @property {() => void} release let go: the world's own controls have the camera again
 */

/**
 * @typedef {{ id: string, intensity: number, color?: string }} FilmLight
 *   a light of the shot over what the hour gives it: 'sun', 'fill' and 'sky' in every world (the sky's), and a world's
 *   own ('glow', 'lamps' in the domes)
 */

/**
 * @typedef {{ sandbox: string, area?: string, stand: [number, number], dome?: number, props?: string, seed: number }} FilmWorldSpec
 */

const win = () => /** @type {{ __filmDraw?: boolean, __worldTime?: number, __film?: { virtual?: boolean }, __world?: unknown }} */ (/** @type {unknown} */ (window));
/** True while the film draws the canvas itself: the world must not spend a frame drawing for nobody. */
export const filmDraws = () => !!win().__filmDraw;
/** The world's clock in seconds while a film sets it (the shot's clock), else undefined: run animations on the world's own. */
export const worldTime = () => win().__worldTime;
/** True while a film holds the page's clock or draws: keep the resolution it asked for. */
export const filmHoldsSize = () => !!win().__film?.virtual || !!win().__filmDraw;

/**
 * A bare hold on a camera, for a world whose camera controls are its own (the planet's).
 * @param {THREE.Camera} camera
 * @returns {CameraHold}
 */
export function createCameraHold(camera) {
	/** @type {Pose | null} */
	let pose = null;
	return {
		fly: (x, y, z, yaw, pitch) => void (pose = [x, y, z, yaw, pitch]),
		flying: () => pose,
		apply() {
			if (!pose) return false;
			camera.position.set(pose[0], pose[1], pose[2]);
			camera.rotation.set(pose[4], pose[3], 0, 'YXZ');
			return true;
		},
		release: () => void (pose = null)
	};
}

/**
 * Hand a world to the film camera: makes `window.__world`.
 * @param {{
 *   sandbox: string,
 *   area?: string,
 *   renderer: THREE.WebGLRenderer,
 *   scene: THREE.Scene,
 *   camera: THREE.PerspectiveCamera,
 *   hold: CameraHold,
 *   sky?: import('./sky.js').SkyHandle | null,
 *   place?: (x: number, z: number, yaw: number, pitch: number, y?: number) => void,
 *   animate?: (t: number) => void,
 *   advance?: (t: number) => void,
 *   lights?: Record<string, (k: number, color?: string) => void>,
 *   stage?: (world: FilmWorldSpec) => Promise<void>,
 *   holds?: (world: FilmWorldSpec) => boolean,
 *   keep?: (worlds: FilmWorldSpec[]) => void,
 *   extra?: Record<string, unknown>
 * }} o
 *   sandbox, area: which world this is (a shot of another is refused); hold: the camera controller's hold (the walker
 *   and the orbit rig are holds); place: stand the world's walker here (where a shot is staged: what is near is
 *   built); animate: every animation to world time t; advance: anything else a frame needs once the hour is set
 *   (levels of detail, the nearest lamps); lights: the world's own lights a shot may scale and colour; stage: build
 *   what a shot needs and resolve when it is ready (default: stand at world.stand); holds: whether the world is still
 *   staged for that (default: yes); keep: keep built what these shots need; extra: more on window.__world (debugging,
 *   sets)
 */
export function connectFilm(o) {
	const { renderer, scene, camera, hold, sky = null } = o;
	const place = o.place ?? (() => hold.release());
	const was = /** @type {any} */ (window).__world;
	const world = {
		sandbox: o.sandbox,
		area: o.area,
		THREE,
		renderer,
		scene,
		camera,
		fly: hold.fly,
		place,
		/** set the sun to an hour now, not at the next once-a-second check (time-lapses) */
		sun: (/** @type {number} */ hour) => sky?.set(hour),
		...o.extra,
		film: {
			/**
			 * Bring the world to world time t (seconds), the camera where `fly` put it: animations, the sun and sky for the
			 * hour, whatever else the world advances, and the shadows drawn again. `lights` scales the lights over what the
			 * hour gives them (1 = as the hour has them) and may recolour them.
			 * @param {number} t @param {FilmLight[]} [lights]
			 */
			advance(t, lights = []) {
				if (hold.apply()) sky?.follow(camera.position.x, camera.position.z);
				camera.updateMatrixWorld();
				o.animate?.(t);
				sky?.set();
				o.advance?.(t);
				for (const l of lights) {
					const k = l.intensity;
					if (l.id === 'sun' && sky) {
						sky.sun.intensity *= k;
						if (l.color) sky.sun.color.set(l.color);
					} else if (l.id === 'fill' && sky) {
						sky.fill.intensity *= k;
						if (l.color) sky.fill.color.set(l.color);
					} else if (l.id === 'sky') scene.environmentIntensity *= k;
					else o.lights?.[l.id]?.(k, l.color);
				}
				renderer.shadowMap.needsUpdate = true;
			},
			/** @param {FilmWorldSpec} w */
			stage: o.stage ?? (async (w) => place(w.stand[0], w.stand[1], 0, 0)),
			/** @param {FilmWorldSpec} w */
			holds: o.holds ?? (() => true),
			/** @param {FilmWorldSpec[]} ws */
			keep: o.keep ?? (() => {})
		},
		/** the world is going: the film (and the console) no longer find it (a world opened over another hands it back) */
		disconnect() {
			const w = /** @type {any} */ (window);
			if (w.__world === world) w.__world = was;
		}
	};
	/** @type {any} */ (window).__world = world;
	return world;
}
