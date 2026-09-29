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
/** @typedef {{ evaluate: (spec: ShotSpec, t: number, shape?: Shape) => Evaluated }} ShotModule */

// ── game/film/shot.js (stream B) ───────────────────────────────────────────────────────────────────────────────────
// ADAPTER: shot.js does not exist on this branch yet. import.meta.glob finds it when it does (and finds nothing, with
// no build error, until then); the fallback below evaluates only what the studio itself writes (camera keys, hour,
// exposure, lights). Remove `fallbackEvaluate` once stream B's shot.js has landed.
const found = /** @type {Record<string, () => Promise<ShotModule>>} */ (/** @type {unknown} */ (import.meta.glob('../../../game/film/shot.js')));
/** @type {ShotModule | null} */
let shotJs = null;
export const shotModule = (async () => {
	const load = Object.values(found)[0];
	shotJs = load ? await load().catch(() => null) : null;
	return shotJs;
})();
/** Is stream B's evaluate() here (presets, framing per shape), or only the studio's own fallback? */
export const hasShotJs = () => !!shotJs;

/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;
/** Where a pose looks from p to q (as scripts/film/camera.mjs `look`). @param {number[]} p @param {number[]} q @returns {Pose} */
const look = (p, q) => {
	const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
	return [p[0], p[1], p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
};
/** @param {CameraKey} k @returns {Pose} */
const keyPose = (k) => (k.aim ? look(k.position, k.aim) : [k.position[0], k.position[1], k.position[2], k.yaw ?? 0, k.pitch ?? 0]);

/** @param {ShotSpec} spec @param {number} t @returns {Evaluated} */
function fallbackEvaluate(spec, t) {
	const p = spec.seconds > 0 ? Math.min(1, Math.max(0, t / spec.seconds)) : 0;
	const keys = [...(spec.camera.keys ?? [])].sort((a, b) => a.t - b.t);
	/** @type {Pose} */
	let pose = [0, 10, 0, 0, 0];
	let fov = spec.lens?.fov ?? 50;
	if (keys.length) {
		const j = keys.findIndex((k) => k.t > t);
		const a = keys[j < 0 ? keys.length - 1 : Math.max(0, j - 1)], b = keys[j < 0 ? keys.length - 1 : j];
		const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
		const pa = keyPose(a), pb = keyPose(b);
		pose = /** @type {Pose} */ (pa.map((v, i) => lerp(v, pb[i], u)));
		fov = lerp(a.fov ?? fov, b.fov ?? fov, u);
	} else if (spec.lens?.fovTo !== undefined) fov = lerp(spec.lens.fov, spec.lens.fovTo, p);
	/** @param {number | [number, number][] | undefined} v */
	const at = (v) =>
		Array.isArray(v) ? (v.find(([k]) => k >= t)?.[1] ?? v.at(-1)?.[1] ?? 1) : (v ?? 1);
	return {
		pose,
		fov,
		hour: lerp(spec.time?.hour ?? 12, spec.time?.hourTo ?? spec.time?.hour ?? 12, p),
		stops: spec.exposure?.stops ?? 0,
		lights: (spec.lights ?? []).map((l) => ({ id: l.id, intensity: at(l.intensity) })),
		cues: spec.cues ?? []
	};
}

/**
 * What the shot is at shot-local time t: the camera, the hour, the exposure, the lights, the cues.
 * @param {ShotSpec} spec @param {number} t @param {Shape} [shape] @returns {Evaluated}
 */
export const evaluate = (spec, t, shape) => (shotJs ? shotJs.evaluate(spec, t, shape) : fallbackEvaluate(spec, t));

/**
 * The camera as keys: a preset move sampled once a second (only with shot.js; keys stay keys).
 * @param {ShotSpec} spec @returns {CameraKey[] | null}
 */
export function toKeys(spec) {
	if (spec.camera.kind === 'keys') return spec.camera.keys ?? [];
	const js = shotJs;
	if (!js) return null;
	const n = Math.max(2, Math.ceil(spec.seconds) + 1);
	return Array.from({ length: n }, (_, i) => {
		const t = (i / (n - 1)) * spec.seconds;
		const e = js.evaluate(spec, t);
		return { t, position: [e.pose[0], e.pose[1], e.pose[2]], yaw: e.pose[3], pitch: e.pose[4], fov: e.fov };
	});
}

/**
 * An empty shot to start from: noon, a still camera over the city, metered and locked.
 * @returns {ShotSpec}
 */
export const blankSpec = (seconds = 6) => ({
	world: { sandbox: 'sandbox-4', build: null, seed: 1, stand: [0, 0], clock: 0 },
	seconds,
	fps: 30,
	camera: { kind: 'keys', curve: 'glide', keys: [{ t: 0, position: [0, 40, 60], aim: [0, 0, 0], fov: 50 }] },
	lens: { fov: 50 },
	time: { hour: 12 },
	exposure: { meter: 'lock', stops: 0 },
	lights: [],
	cues: [],
	shutter: { angle: 180, samples: 1 },
	framing: {}
});

// ── the records: the API (stream B's /api/shots), or this browser until it exists ─────────────────────────────────
// ADAPTER: while `/api/shots` answers 404, shots are kept in this browser's localStorage (versioned the same way), so
// the lanes can be worked on. Remove the `local` branch once stream B's route is live.
const LOCAL = 'studio:shots';
/** @type {'api' | 'local' | null} */
let mode = null;
export const shotsMode = () => mode;

/** @returns {Record<string, Shot[]>} */
const readLocal = () => {
	try {
		return JSON.parse(localStorage.getItem(LOCAL) ?? '{}');
	} catch {
		return {};
	}
};
/** @param {Record<string, Shot[]>} all */
const writeLocal = (all) => {
	try {
		localStorage.setItem(LOCAL, JSON.stringify(all));
	} catch {
		/* full or blocked: kept for this session only */
	}
};

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
	if (mode !== 'local') {
		try {
			const list = await listShots(project);
			mode = 'api';
			return list.map(keep);
		} catch (e) {
			if (!missing(e)) throw e;
			mode = 'local';
		}
	}
	return Object.values(readLocal())
		.map((v) => v.at(-1))
		.filter((s) => !!s && (!project || s.project === project))
		.map((s) => keep(/** @type {Shot} */ (s)));
}

/**
 * One shot at the version a clip was cut with.
 * @param {string} id @param {number} [version] @returns {Promise<Shot | null>}
 */
export async function shotAt(id, version) {
	const hit = version ? cache.get(key(id, version)) : undefined;
	if (hit) return hit;
	if (mode !== 'local') {
		try {
			return keep(await getShot(id, version));
		} catch (e) {
			if (!missing(e)) return null;
			if (mode === 'api') return null; // the route is there: the shot is not
			mode = 'local';
		}
	}
	const v = readLocal()[id];
	const s = version ? v?.find((x) => x.version === version) : v?.at(-1);
	return s ? keep(s) : null;
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
export async function saveSpec(s, spec) {
	if (mode !== 'local') {
		try {
			return keep(await saveShot(s.id, { spec }));
		} catch (e) {
			if (!missing(e)) throw e;
			mode = 'local';
		}
	}
	const all = readLocal();
	const list = all[s.id] ?? [s];
	/** @type {Shot} */
	const next = { ...s, version: (list.at(-1)?.version ?? s.version) + 1, spec, updated: new Date().toISOString() };
	all[s.id] = [...list, next];
	writeLocal(all);
	return keep(next);
}

/** @param {string} name @param {string | null} project @returns {Promise<Shot>} */
export async function newShot(name, project, spec = blankSpec()) {
	if (mode !== 'local') {
		try {
			return keep(await createShot({ name, project, spec }));
		} catch (e) {
			if (!missing(e)) throw e;
			mode = 'local';
		}
	}
	const now = new Date().toISOString();
	/** @type {Shot} */
	const s = { id: crypto.randomUUID(), name, project, version: 1, spec, created: now, updated: now };
	const all = readLocal();
	all[s.id] = [s];
	writeLocal(all);
	return keep(s);
}
