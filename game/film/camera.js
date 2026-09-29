// THE FILM CAMERA AS DATA — every camera move of a world shot is a plain object (JSON), and one evaluator turns it
// into a pose at any moment. A pose is [x, y, z, yaw, pitch], as Sandbox 4's camera takes it (`__village.fly`).
//
//   { kind: 'move',  from, to, aimFrom, aimTo, curve }          from one position and aim to another
//   { kind: 'orbit', centre: [x, z], a0, a1, r0, r1, y0, y1, aim, curve }   round a centre, looking at `aim`
//   { kind: 'turn',  at, yaw0, yaw1, pitch0, pitch1, curve }      turn in place
//   { kind: 'fly',   keys: [[position, aim], …], curve }         a drone flight through points (Catmull-Rom)
//   { kind: 'whip',  path: <camera>, out, into, d }                a whip pan at the end (out) or start (into)
//   { kind: 'keys',  keys: [{ t, position, aim } | { t, position, yaw, pitch }, … + fov?], curve }
//                                                                  keyframes in shot seconds (a recorded flight)
//
// `curve` is one of CURVES by name. The maths is exactly scripts/film/camera.mjs's (which is now built on this file),
// so a shot list written with camera.mjs becomes data without a single pose changing.
// Plain JavaScript, shared by the browser (film mode), the worker, the API and the scripts.

/** @typedef {[number, number, number, number, number]} Pose  x, y, z, yaw, pitch */
/** @typedef {[number, number, number]} Vec3 */
/** @typedef {'glide' | 'ease' | 'landing' | 'drift'} CurveName */
/**
 * @typedef {{ kind: 'move', from: Vec3, to: Vec3, aimFrom: Vec3, aimTo: Vec3, curve?: CurveName }
 *   | { kind: 'orbit', centre: [number, number], a0: number, a1: number, r0: number, r1: number, y0: number, y1: number, aim: Vec3, curve?: CurveName }
 *   | { kind: 'turn', at: Vec3, yaw0: number, yaw1: number, pitch0: number, pitch1: number, curve?: CurveName }
 *   | { kind: 'fly', keys: [Vec3, Vec3][], curve?: CurveName }
 *   | { kind: 'whip', path: Camera, out?: number, into?: number, d?: number }
 *   | { kind: 'keys', keys: Key[], curve?: CurveName }} Camera
 */
/** @typedef {{ t: number, position: Vec3, aim?: Vec3, yaw?: number, pitch?: number, fov?: number }} Key */

const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;

/** The default: an even speed from the first frame to the last (a shot is cut out of a move already going). */
export const glide = (/** @type {number} */ t) => t;
/** Starts and stops gently, the way a dolly or a crane moves. */
export const ease = (/** @type {number} */ t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Already moving at the first frame, coming softly to rest at the last. */
export const landing = (/** @type {number} */ t) => 1 - (1 - t) * (1 - t);
/** A slower, steadier ease. */
export const drift = (/** @type {number} */ t) => t * t * (3 - 2 * t);

/** @type {Record<CurveName, (t: number) => number>} */
export const CURVES = { glide, ease, landing, drift };

/** The name of a curve function, if it is one of CURVES. */
export const curveName = (/** @type {Function} */ fn) => /** @type {CurveName | undefined} */ (Object.keys(CURVES).find((k) => CURVES[/** @type {CurveName} */ (k)] === fn));

const curveOf = (/** @type {string | undefined} */ name) => {
	if (name === undefined) return glide;
	const c = CURVES[/** @type {CurveName} */ (name)];
	if (!c) throw new Error(`unknown curve "${name}" (one of ${Object.keys(CURVES).join(', ')})`);
	return c;
};

/** A pose that looks from point p at point q. @returns {Pose} */
export const look = (/** @type {number[]} */ p, /** @type {number[]} */ q) => {
	const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
	return [p[0], p[1], p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
};

/** Catmull-Rom through four points, at u (0–1 between p1 and p2). */
const cr = (/** @type {number[]} */ p0, /** @type {number[]} */ p1, /** @type {number[]} */ p2, /** @type {number[]} */ p3, /** @type {number} */ u) =>
	p1.map((_, i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u * u + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u * u * u));

/**
 * The camera's path: a function of the shot's progress (0 at its first frame, 1 at its end) giving a pose.
 * `seconds` is the shot's length (only keyframed cameras, whose keys are in seconds, need it).
 * @param {Camera} cam @param {number} [seconds]
 * @returns {(t: number) => Pose}
 */
export function pathOf(cam, seconds = 1) {
	switch (cam.kind) {
		case 'move': {
			const { from, to, aimFrom, aimTo } = cam, curve = curveOf(cam.curve);
			return (t) => {
				const e = curve(t);
				return look(from.map((v, i) => lerp(v, to[i], e)), aimFrom.map((v, i) => lerp(v, aimTo[i], e)));
			};
		}
		case 'orbit': {
			const { centre, a0, a1, r0, r1, y0, y1, aim } = cam, curve = curveOf(cam.curve);
			return (t) => {
				const e = curve(t), a = lerp(a0, a1, e), r = lerp(r0, r1, e);
				return look([centre[0] + r * Math.sin(a), lerp(y0, y1, e), centre[1] + r * Math.cos(a)], aim);
			};
		}
		case 'turn': {
			const { at, yaw0, yaw1, pitch0, pitch1 } = cam, curve = curveOf(cam.curve);
			return (t) => {
				const e = curve(t);
				return [at[0], at[1], at[2], lerp(yaw0, yaw1, e), lerp(pitch0, pitch1, e)];
			};
		}
		case 'fly': {
			const keys = cam.keys, curve = curveOf(cam.curve);
			const along = (/** @type {0 | 1} */ k) => (/** @type {number} */ t) => {
				const n = keys.length - 1, x = Math.min(n - 1e-9, Math.max(0, t * n)), i = Math.floor(x), u = x - i;
				const at = (/** @type {number} */ j) => keys[Math.max(0, Math.min(n, j))][k];
				return cr(at(i - 1), at(i), at(i + 1), at(i + 2), u);
			};
			const pos = along(0), aim = along(1);
			return (t) => look(pos(curve(t)), aim(curve(t)));
		}
		case 'whip': {
			const path = pathOf(cam.path, seconds), out = cam.out ?? 0, into = cam.into ?? 0, d = cam.d ?? 0.12;
			return (t) => {
				const p = path(t);
				const a = t > 1 - d && out ? out * Math.pow((t - (1 - d)) / d, 2) : 0;
				const b = t < d && into ? -into * Math.pow((d - t) / d, 2) : 0;
				return [p[0], p[1], p[2], p[3] + a + b, p[4]];
			};
		}
		case 'keys': {
			const curve = curveOf(cam.curve), keys = keyPoses(cam.keys);
			return (t) => sampleKeys(keys, curve(t) * seconds).pose;
		}
		default:
			throw new Error(`unknown camera kind "${/** @type {any} */ (cam).kind}"`);
	}
}

/** Keys as poses, their yaw unwrapped (a turn through ±π goes the short way round, never spins). */
function keyPoses(/** @type {Key[]} */ keys) {
	/** @type {{ t: number, v: number[] }[]} */
	const out = [];
	for (const k of [...keys].sort((a, b) => a.t - b.t)) {
		const p = k.aim ? look(k.position, k.aim) : [k.position[0], k.position[1], k.position[2], k.yaw ?? 0, k.pitch ?? 0];
		const prev = out.at(-1);
		if (prev) while (p[3] - prev.v[3] > Math.PI) p[3] -= 2 * Math.PI;
		if (prev) while (p[3] - prev.v[3] < -Math.PI) p[3] += 2 * Math.PI;
		out.push({ t: k.t, v: [...p, k.fov ?? NaN] });
	}
	return out;
}

/** Keyframes at shot time s: Catmull-Rom between the keys (uniform per span), held before the first and after the last. */
function sampleKeys(/** @type {{ t: number, v: number[] }[]} */ keys, /** @type {number} */ s) {
	if (!keys.length) throw new Error('a keyframed camera needs keys');
	const n = keys.length - 1;
	let i = 0;
	while (i < n - 1 && s >= keys[i + 1].t) i++;
	const a = keys[i], b = keys[Math.min(n, i + 1)];
	const u = b.t > a.t ? Math.min(1, Math.max(0, (s - a.t) / (b.t - a.t))) : 0;
	const at = (/** @type {number} */ j) => keys[Math.max(0, Math.min(n, j))].v;
	const v = n === 0 ? a.v : cr(at(i - 1), at(i), at(i + 1), at(i + 2), u);
	return { pose: /** @type {Pose} */ (v.slice(0, 5)), fov: Number.isFinite(v[5]) ? v[5] : undefined };
}

/**
 * The lens a keyframed camera sets at progress t (keys may carry fov), else undefined.
 * @param {Camera} cam @param {number} t @param {number} seconds
 */
export function fovOf(cam, t, seconds) {
	if (cam.kind === 'whip') return fovOf(cam.path, t, seconds);
	if (cam.kind !== 'keys' || !cam.keys.some((k) => Number.isFinite(k.fov))) return undefined;
	const keys = keyPoses(cam.keys.map((k) => ({ ...k, fov: k.fov ?? cam.keys.find((q) => Number.isFinite(q.fov))?.fov })));
	return sampleKeys(keys, curveOf(cam.curve)(t) * seconds).fov;
}

const finite = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
const vec = (/** @type {unknown} */ v, /** @type {number} */ n) => Array.isArray(v) && v.length === n && v.every(finite);

/**
 * A camera checked: the right fields, every number finite. Throws an Error naming what is wrong.
 * @param {any} cam @param {string} [where] @returns {Camera}
 */
export function checkCamera(cam, where = 'camera') {
	const bad = (/** @type {string} */ s) => {
		throw new Error(`${where}: ${s}`);
	};
	if (!cam || typeof cam !== 'object') bad('missing');
	if (cam.curve !== undefined && !(cam.curve in CURVES)) bad(`unknown curve "${cam.curve}"`);
	const need = (/** @type {string[]} */ ks, /** @type {number} */ n) => ks.forEach((k) => (n ? vec(cam[k], n) : finite(cam[k])) || bad(`${k} must be ${n ? `${n} numbers` : 'a number'}`));
	switch (cam.kind) {
		case 'move':
			need(['from', 'to', 'aimFrom', 'aimTo'], 3);
			return { kind: 'move', from: cam.from, to: cam.to, aimFrom: cam.aimFrom, aimTo: cam.aimTo, ...(cam.curve ? { curve: cam.curve } : {}) };
		case 'orbit':
			need(['centre'], 2), need(['aim'], 3), need(['a0', 'a1', 'r0', 'r1', 'y0', 'y1'], 0);
			return { kind: 'orbit', centre: cam.centre, a0: cam.a0, a1: cam.a1, r0: cam.r0, r1: cam.r1, y0: cam.y0, y1: cam.y1, aim: cam.aim, ...(cam.curve ? { curve: cam.curve } : {}) };
		case 'turn':
			need(['at'], 3), need(['yaw0', 'yaw1', 'pitch0', 'pitch1'], 0);
			return { kind: 'turn', at: cam.at, yaw0: cam.yaw0, yaw1: cam.yaw1, pitch0: cam.pitch0, pitch1: cam.pitch1, ...(cam.curve ? { curve: cam.curve } : {}) };
		case 'fly':
			if (!Array.isArray(cam.keys) || cam.keys.length < 2 || cam.keys.length > 200 || !cam.keys.every((/** @type {any} */ k) => Array.isArray(k) && vec(k[0], 3) && vec(k[1], 3))) bad('a flight is 2–200 [position, aim] keys');
			return { kind: 'fly', keys: cam.keys, ...(cam.curve ? { curve: cam.curve } : {}) };
		case 'whip':
			for (const k of ['out', 'into', 'd']) if (cam[k] !== undefined && !finite(cam[k])) bad(`${k} must be a number`);
			if (cam.d !== undefined && (cam.d <= 0 || cam.d > 1)) bad('d is a share of the shot, 0–1');
			return { kind: 'whip', path: checkCamera(cam.path, `${where}.path`), ...(cam.out ? { out: cam.out } : {}), ...(cam.into ? { into: cam.into } : {}), ...(cam.d !== undefined ? { d: cam.d } : {}) };
		case 'keys':
			if (!Array.isArray(cam.keys) || !cam.keys.length || cam.keys.length > 5000) bad('keys: 1–5000 keyframes');
			return {
				kind: 'keys',
				keys: cam.keys.map((/** @type {any} */ k, /** @type {number} */ i) => {
					if (!finite(k?.t) || !vec(k.position, 3)) bad(`key ${i} needs t and position`);
					if (k.aim !== undefined ? !vec(k.aim, 3) : !finite(k.yaw) || !finite(k.pitch)) bad(`key ${i} needs aim, or yaw and pitch`);
					if (k.fov !== undefined && !(finite(k.fov) && k.fov > 0.5 && k.fov < 170)) bad(`key ${i}: fov is 0.5–170 degrees`);
					return { t: k.t, position: k.position, ...(k.aim ? { aim: k.aim } : { yaw: k.yaw, pitch: k.pitch }), ...(k.fov !== undefined ? { fov: k.fov } : {}) };
				}),
				...(cam.curve ? { curve: cam.curve } : {})
			};
		default:
			return bad(`unknown kind "${cam.kind}"`);
	}
}

/**
 * Thin a recorded flight into keyframes: poses sampled at `t` (seconds), smoothed with a small moving average, and
 * thinned so a key is kept only where the path turns or speeds up — within `tolerance` metres / radians.
 * @param {{ t: number, pose: Pose, fov?: number }[]} samples
 * @param {{ smooth?: number, tolerance?: number }} [opts]
 * @returns {Key[]}
 */
export function keysFromFlight(samples, { smooth = 2, tolerance = 0.05 } = {}) {
	if (!samples.length) return [];
	const s = samples.map((x) => ({ ...x, pose: /** @type {Pose} */ ([...x.pose]) }));
	for (let i = 1; i < s.length; i++) {
		while (s[i].pose[3] - s[i - 1].pose[3] > Math.PI) s[i].pose[3] -= 2 * Math.PI;
		while (s[i].pose[3] - s[i - 1].pose[3] < -Math.PI) s[i].pose[3] += 2 * Math.PI;
	}
	const sm = s.map((x, i) => {
		// a window centred on the sample, narrowed at the ends so the first and last poses stay where they were
		const r = Math.min(smooth, i, s.length - 1 - i), lo = i - r, hi = i + r, n = hi - lo + 1;
		const pose = /** @type {Pose} */ ([0, 1, 2, 3, 4].map((k) => s.slice(lo, hi + 1).reduce((a, y) => a + y.pose[k], 0) / n));
		return { t: x.t, pose, fov: x.fov };
	});
	const keep = [0];
	for (let i = 1; i < sm.length - 1; i++) {
		const a = sm[keep.at(-1) ?? 0], b = sm[i + 1], u = (sm[i].t - a.t) / Math.max(1e-9, b.t - a.t);
		const off = sm[i].pose.reduce((m, v, k) => Math.max(m, Math.abs(v - lerp(a.pose[k], b.pose[k], u))), 0);
		if (off > tolerance) keep.push(i);
	}
	if (sm.length > 1) keep.push(sm.length - 1);
	const r = (/** @type {number} */ v) => Math.round(v * 1e4) / 1e4;
	return keep.map((i) => {
		const x = sm[i];
		return { t: r(x.t), position: /** @type {Vec3} */ ([r(x.pose[0]), r(x.pose[1]), r(x.pose[2])]), yaw: r(x.pose[3]), pitch: r(x.pose[4]), ...(x.fov !== undefined ? { fov: r(x.fov) } : {}) };
	});
}
