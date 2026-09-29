// World shots as data (contract C2): the records a world clip names, their versions, and what a shot is at a moment.
// Every save of a changed spec is a new version; a clip names the version it was cut with and follows a new one only
// when the studio says so.
import { createShot, getShot, listShots, missing, saveShot } from '$lib/auth/client';

/** @typedef {import('$lib/auth/client').CameraKey} CameraKey */
/** @typedef {import('$lib/auth/client').Shape} Shape */
/** @typedef {import('$lib/auth/client').Shot} Shot */
/** @typedef {import('$lib/auth/client').ShotSpec} ShotSpec */
/** @typedef {[number, number, number, number, number]} Pose */
/** @typedef {{ pose: Pose, fov: number, hour: number, stops: number, lights: { id: string, intensity: number }[], cues: ShotSpec['cues'] }} Evaluated */

// what a shot is at a moment: game/film/shot.js, the same code the film camera and the worker run
import { evaluate as evaluateShot } from '../../../game/film/shot.js';

/**
 * What the shot is at shot-local time t: the camera, the hour, the exposure, the lights, the cues.
 * @param {ShotSpec} spec @param {number} t @param {Shape} [shape] @returns {Evaluated}
 */
export const evaluate = (spec, t, shape) => /** @type {Evaluated} */ (/** @type {unknown} */ (evaluateShot(/** @type {any} */ (spec), t, shape)));

/**
 * The camera as keys: a preset move sampled once a second (keys stay keys).
 * @param {ShotSpec} spec @returns {CameraKey[]}
 */
export function toKeys(spec) {
	if (spec.camera.kind === 'keys') return spec.camera.keys ?? [];
	const n = Math.max(2, Math.ceil(spec.seconds) + 1);
	return Array.from({ length: n }, (_, i) => {
		const t = (i / (n - 1)) * spec.seconds;
		const e = evaluate(spec, t);
		return { t, position: [e.pose[0], e.pose[1], e.pose[2]], yaw: e.pose[3], pitch: e.pose[4], fov: e.fov };
	});
}

/**
 * An empty shot to start from: noon, a still camera over the city, metered and locked.
 * @param {import('$lib/auth/client').Shape} [aspect] @returns {ShotSpec}
 */
export const blankSpec = (aspect = '16:9', seconds = 6) => ({
	world: { sandbox: 'sandbox-4', build: null, seed: 1, stand: [0, 0], clock: 0 },
	seconds,
	fps: 30,
	aspect,
	camera: { kind: 'keys', curve: 'glide', keys: [{ t: 0, position: [0, 40, 60], aim: [0, 0, 0], fov: 50 }] },
	lens: { fov: 50 },
	time: { hour: 12 },
	exposure: { meter: 'lock', stops: 0 },
	lights: [],
	cues: [],
	shutter: { angle: 180, samples: 1 },
	framing: {}
});

// ── the records: /api/shots ────────────────────────────────────────────────────────────────────────────────────

/** `${id}@${version}` → record @type {Map<string, Shot>} */
const cache = new Map();
/** @param {string} id @param {number} v */
const key = (id, v) => `${id}@${v}`;
/** @param {Shot} s */
const keep = (s) => (cache.set(key(s.id, s.version), s), s);

/**
 * Every shot (its newest version).
 * @param {string} [project] @returns {Promise<Shot[]>}
 */
export async function allShots(project) {
	return (await listShots(project)).map(keep);
}

/**
 * One shot at the version a clip was cut with (null when it is gone).
 * @param {string} id @param {number} [version] @returns {Promise<Shot | null>}
 */
export async function shotAt(id, version) {
	const hit = version ? cache.get(key(id, version)) : undefined;
	if (hit) return hit;
	try {
		return keep(await getShot(id, version));
	} catch (e) {
		if (missing(e)) return null;
		throw e;
	}
}
/**
 * A shot already fetched (synchronous, for the frame loop).
 * @param {string | undefined} id @param {number | undefined} version @returns {Shot | null}
 */
export const cached = (id, version) => (id && version ? (cache.get(key(id, version)) ?? null) : null);

/**
 * A changed spec: a new version of the shot.
 * @param {Shot} s @param {ShotSpec} spec @returns {Promise<Shot>}
 */
export const saveSpec = async (s, spec) => keep(await saveShot(s.id, { spec }));

/** @param {string} name @param {string | null} project @param {ShotSpec} spec @returns {Promise<Shot>} */
export const newShot = async (name, project, spec) => keep(await createShot({ name, project, spec }));
