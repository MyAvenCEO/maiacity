// A WORLD SHOT AS DATA — everything the film camera needs to render one shot of a sandbox, as a plain record (the
// `shots` table keeps it, versioned; a world clip on a timeline names it). Nothing in it is a picture: the world
// renders it on demand — live in the studio, as a proxy, or as a 4K log plate at render time.
//
//   spec = {
//     world:    { sandbox: 'sandbox-1' … 'sandbox-4' | 'room' | 'tired-land' | 'isar', area?, build: { commit, hash, file? } | null, seed, stand: [x, z],
//                 dome?, props?, clock },   which world (game/film/worlds.js) and where in it; dome and props are Sandbox 4's
//     seconds, fps: 30, aspect: '1:1',          the shot's length, frame rate, and the shape it was composed for
//     camera:   game/film/camera.js (move · orbit · turn · fly · whip · keys, with a curve),
//     lens:     { fov, fovTo? },                vertical field of view in degrees (for `aspect`), zooming to fovTo
//     time:     { hour, hourTo? },              the hour, and where a time-lapse runs to
//     exposure: { meter: 'lock' | 'ramp' | 'fixed', stops, ev? },   metered like a camera (middle grey 18%), `stops`
//               over or under it; `ev` = the metered (or, fixed, the given) gain in stops — once known, it is pinned
//     lights:   [{ id: 'sun' | 'fill' | 'glow' | 'lamps' | 'sky' | 'glass' | 'cb60', intensity?: k | [[t, k], …], color? }],  multipliers
//               (glass: the low sun's warm sheen on the domes' glass, 0 = none, about 1–4 a glow; cb60: the room's Neewer CB60,
//               off unless a shot names it, 1 = full)
//     cues:     [{ at, kind: 'sound', hash, level } | { at, kind: 'event', name, args }],  on the shot's clock (seconds)
//     shutter:  { angle: 180, samples: 1 },     motion blur: the shutter open for angle/360 of a frame, in samples
//     framing:  { [shape]: { fov?, yaw?, pitch?, dx?, dy? } },  a native camera per delivery shape (else the rule)
//     look?:    preset name (vault-render `grade::PRESETS`) — the grade it was lit for; a suggestion, never applied here
//     meta?:    { … }                           notes (size, scene, where it came from): not part of the picture
//   }
//
// A shot's time t is in seconds from its first frame; its progress is t / seconds. The world's own clock (animals,
// water, the trucks of a set) runs at world.clock + t, so the same shot always sees the same world.
// Plain JavaScript, shared by the browser (film mode), the API, the worker and the scripts.
import { checkCamera, fovOf, pathOf } from './camera.js';
import { DEFAULT_SANDBOX, WORLDS } from './worlds.js';

/** @typedef {import('./camera.js').Camera} Camera @typedef {import('./camera.js').Pose} Pose */
/** @typedef {'1:1' | '16:9' | '9:16' | '4:5'} Shape */
/** @typedef {number | [number, number][]} Curve  a constant, or [t, value] keys (linear between them) */
/** @typedef {{ commit: string, hash: string, file?: string } | null} Build */
/** @typedef {{ at: number, kind: 'sound', hash: string, level: number } | { at: number, kind: 'event', name: string, args?: unknown }} Cue */
/** @typedef {{ fov?: number, yaw?: number, pitch?: number, dx?: number, dy?: number }} Frame */
/**
 * @typedef {{
 *   world: { sandbox: Sandbox, area?: string, build: Build, seed: number, stand: [number, number], dome?: number, props?: string, clock: number },
 *   seconds: number, fps: number, aspect: Shape,
 *   camera: Camera,
 *   lens: { fov: number, fovTo?: number },
 *   time: { hour: number, hourTo?: number },
 *   exposure: { meter: 'lock' | 'ramp' | 'fixed', stops: Curve, ev?: number },
 *   lights: { id: LightId, intensity?: Curve, color?: string }[],
 *   cues: Cue[],
 *   shutter: { angle: number, samples: number },
 *   framing: Partial<Record<Shape, Frame>>,
 *   look?: string,
 *   meta?: Record<string, unknown>
 * }} Spec
 */
/** @typedef {'sun' | 'fill' | 'glow' | 'lamps' | 'sky' | 'glass' | 'cb60'} LightId */
/** @typedef {'sandbox-1' | 'sandbox-2' | 'sandbox-3' | 'sandbox-4' | 'room' | 'tired-land' | 'isar'} Sandbox */

/** The delivery shapes, width over height. */
export const SHAPES = /** @type {Record<Shape, number>} */ ({ '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:5': 4 / 5 });
/** The lights a shot can set, over what the hour gives them. */
export const LIGHTS = /** @type {LightId[]} */ (['sun', 'fill', 'glow', 'lamps', 'sky', 'glass', 'cb60']);
/** The sets a shot can build into the world (scripts/film/props.mjs). */
export const SETS = ['tired-land'];
/** The looks a shot may suggest (vault-render `grade::PRESETS`). */
export const LOOKS = ['neutral', 'cold', 'dip', 'bright', 'night', 'warm'];

export class ShotError extends Error {}

const finite = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;

/**
 * A spec checked and completed: defaults filled in, every number finite and in range, unknown fields dropped.
 * Throws a ShotError naming the first thing wrong.
 * @param {any} s @returns {Spec}
 */
export function normalize(s) {
	const bad = (/** @type {string} */ m) => {
		throw new ShotError(m);
	};
	if (!s || typeof s !== 'object') bad('A shot is an object.');
	const num = (/** @type {unknown} */ v, /** @type {string} */ name, /** @type {number} */ lo, /** @type {number} */ hi, /** @type {number | undefined} */ d = undefined) => {
		if (v === undefined && d !== undefined) return d;
		if (!finite(v) || /** @type {number} */ (v) < lo || /** @type {number} */ (v) > hi) bad(`${name} must be a number from ${lo} to ${hi}.`);
		return /** @type {number} */ (v);
	};
	const curve = (/** @type {unknown} */ v, /** @type {string} */ name, /** @type {number} */ lo, /** @type {number} */ hi) => {
		if (Array.isArray(v)) {
			if (!v.length || v.length > 2000) bad(`${name}: 1–2000 [t, value] keys.`);
			return /** @type {[number, number][]} */ (v.map((k, i) => [num(k?.[0], `${name} key ${i} time`, -1e6, 1e6), num(k?.[1], `${name} key ${i} value`, lo, hi)]).sort((a, b) => a[0] - b[0]));
		}
		return num(v, name, lo, hi);
	};
	const w = s.world ?? {};
	const sandbox = /** @type {Sandbox} */ (w.sandbox ?? DEFAULT_SANDBOX);
	const where = WORLDS[sandbox];
	if (!where) bad(`world.sandbox is one of ${Object.keys(WORLDS).join(', ')}.`);
	const areas = where.areas;
	if (w.area !== undefined && w.area !== null && !areas?.includes(w.area)) bad(areas ? `world.area in ${sandbox} is one of ${areas.join(', ')}.` : `${sandbox} has no areas.`);
	if (w.dome !== undefined && w.dome !== null && !where.domes) bad(`world.dome names a dome of Sandbox 4; ${sandbox} has none.`);
	if (!Array.isArray(w.stand) || w.stand.length !== 2 || !w.stand.every(finite)) bad('world.stand is where the world is loaded: [x, z].');
	/** @type {Build} */
	let build = null;
	if (w.build) {
		const commit = String(w.build.commit ?? ''), hash = String(w.build.hash ?? '');
		if (!/^[0-9a-f]{7,64}$/.test(commit) || !/^[0-9a-z]{8,80}$/.test(hash)) bad('world.build names the game build: { commit, hash, file? }.');
		if (w.build.file !== undefined && !/^[0-9a-f]{64}$/.test(String(w.build.file))) bad('world.build.file is the build in the vault, by its hash.');
		build = { commit, hash, ...(w.build.file ? { file: String(w.build.file) } : {}) };
	}
	if (w.props !== undefined && !(where.sets ?? []).includes(w.props)) bad(where.sets ? `world.props is one of ${where.sets.join(', ')}.` : `${sandbox} has no sets.`);
	const world = {
		sandbox,
		// a sandbox with areas always names one (its first by default); Sandbox 4 is one place, and its shots stay as they were
		...(areas ? { area: /** @type {string} */ (w.area ?? areas[0]) } : {}),
		build,
		seed: Math.round(num(w.seed, 'world.seed', 0, 2 ** 31, 1)),
		stand: /** @type {[number, number]} */ ([w.stand[0], w.stand[1]]),
		...(w.dome !== undefined && w.dome !== null ? { dome: Math.round(num(w.dome, 'world.dome', 0, /** @type {number} */ (where.domes) - 1)) } : {}),
		...(w.props ? { props: String(w.props) } : {}),
		clock: num(w.clock, 'world.clock', -1e6, 1e6, 0)
	};
	const aspect = s.aspect ?? '1:1';
	if (!(aspect in SHAPES)) bad(`aspect is one of ${Object.keys(SHAPES).join(', ')}.`);
	let camera;
	try {
		camera = checkCamera(s.camera);
	} catch (e) {
		bad(/** @type {Error} */ (e).message);
	}
	const lens = { fov: num(s.lens?.fov, 'lens.fov', 0.5, 170, 45), ...(s.lens?.fovTo !== undefined ? { fovTo: num(s.lens.fovTo, 'lens.fovTo', 0.5, 170) } : {}) };
	const time = { hour: num(s.time?.hour, 'time.hour', 0, 48), ...(s.time?.hourTo !== undefined ? { hourTo: num(s.time.hourTo, 'time.hourTo', 0, 48) } : {}) };
	const meter = s.exposure?.meter ?? 'lock';
	if (!['lock', 'ramp', 'fixed'].includes(meter)) bad('exposure.meter is lock, ramp or fixed.');
	if (meter === 'fixed' && !finite(s.exposure?.ev)) bad('A fixed exposure gives its ev.');
	const exposure = { meter, stops: curve(s.exposure?.stops ?? 0, 'exposure.stops', -12, 12), ...(s.exposure?.ev !== undefined && s.exposure?.ev !== null ? { ev: num(s.exposure.ev, 'exposure.ev', -40, 40) } : {}) };
	if (s.lights !== undefined && (!Array.isArray(s.lights) || s.lights.length > 20)) bad('lights is a list.');
	const lights = (s.lights ?? []).map((/** @type {any} */ l, /** @type {number} */ i) => {
		if (!LIGHTS.includes(l?.id)) bad(`lights[${i}].id is one of ${LIGHTS.join(', ')}.`);
		if (l.color !== undefined && !/^#[0-9a-f]{6}$/i.test(String(l.color))) bad(`lights[${i}].color is #rrggbb.`);
		return { id: l.id, ...(l.intensity !== undefined ? { intensity: curve(l.intensity, `lights[${i}].intensity`, 0, 1000) } : {}), ...(l.color ? { color: String(l.color).toLowerCase() } : {}) };
	});
	if (s.cues !== undefined && (!Array.isArray(s.cues) || s.cues.length > 200)) bad('cues is a list.');
	const cues = (s.cues ?? []).map((/** @type {any} */ c, /** @type {number} */ i) => {
		const at = num(c?.at, `cues[${i}].at`, -1e6, 1e6);
		if (c.kind === 'sound') {
			if (!/^[0-9a-f]{64}$/.test(String(c.hash))) bad(`cues[${i}] names a sound by its hash.`);
			return { at, kind: 'sound', hash: String(c.hash), level: num(c.level, `cues[${i}].level`, 0, 4, 1) };
		}
		if (c.kind === 'event') {
			if (!/^[a-z][a-z0-9-]{0,40}$/.test(String(c.name))) bad(`cues[${i}].name is a short event name.`);
			return { at, kind: 'event', name: String(c.name), ...(c.args !== undefined ? { args: c.args } : {}) };
		}
		return bad(`cues[${i}].kind is sound or event.`);
	});
	cues.sort((/** @type {any} */ a, /** @type {any} */ b) => a.at - b.at);
	const shutter = { angle: num(s.shutter?.angle, 'shutter.angle', 0, 360, 180), samples: Math.round(num(s.shutter?.samples, 'shutter.samples', 1, 64, 1)) };
	/** @type {Spec['framing']} */
	const framing = {};
	for (const [shape, f] of Object.entries(s.framing ?? {})) {
		if (!(shape in SHAPES)) bad(`framing is by shape: ${Object.keys(SHAPES).join(', ')}.`);
		/** @type {Frame} */
		const out = {};
		if (f?.fov !== undefined) out.fov = num(f.fov, `framing.${shape}.fov`, 0.5, 170);
		for (const k of /** @type {const} */ (['yaw', 'pitch'])) if (f?.[k] !== undefined) out[k] = num(f[k], `framing.${shape}.${k}`, -Math.PI, Math.PI);
		for (const k of /** @type {const} */ (['dx', 'dy'])) if (f?.[k] !== undefined) out[k] = num(f[k], `framing.${shape}.${k}`, -1000, 1000);
		framing[/** @type {Shape} */ (shape)] = out;
	}
	if (s.look !== undefined && s.look !== null && !LOOKS.includes(s.look)) bad(`look is one of ${LOOKS.join(', ')}.`);
	const meta = s.meta && typeof s.meta === 'object' && !Array.isArray(s.meta) ? s.meta : undefined;
	if (meta && JSON.stringify(meta).length > 4000) bad('meta is for short notes.');
	return {
		world,
		seconds: num(s.seconds, 'seconds', 0.04, 600),
		fps: num(s.fps, 'fps', 1, 120, 30),
		aspect: /** @type {Shape} */ (aspect),
		camera: /** @type {Camera} */ (camera),
		lens,
		time,
		exposure: /** @type {Spec['exposure']} */ (exposure),
		lights,
		cues: /** @type {Cue[]} */ (cues),
		shutter,
		framing,
		...(s.look ? { look: String(s.look) } : {}),
		...(meta ? { meta } : {})
	};
}

/** A curve's value at shot time t. */
export const valueAt = (/** @type {Curve} */ c, /** @type {number} */ t) => {
	if (!Array.isArray(c)) return c;
	if (t <= c[0][0]) return c[0][1];
	for (let i = 1; i < c.length; i++) if (t < c[i][0]) return lerp(c[i - 1][1], c[i][1], (t - c[i - 1][0]) / (c[i][0] - c[i - 1][0]));
	return c[c.length - 1][1];
};

/**
 * The vertical field of view for a shape. A shot is composed for its `aspect`; every other shape sees at least that
 * whole frame: a wider shape keeps the height (and shows more to the sides), a taller one keeps the width (and shows
 * more above and below) — never a centre crop. A shape's own `framing.fov` overrides the rule.
 * @param {number} fov  the composed vertical fov, degrees @param {Shape} from @param {Shape} to
 */
export function fovFor(fov, from, to) {
	const a = SHAPES[from], b = SHAPES[to];
	if (b >= a) return fov;
	return (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (a / b)) * 180) / Math.PI;
}

/**
 * Everything about a shot at time t (seconds from its first frame), for one delivery shape.
 * @param {Spec} spec @param {number} t @param {Shape} [shape]
 * @returns {{ pose: Pose, fov: number, hour: number, stops: number, lights: { id: LightId, intensity: number, color?: string }[], cues: Cue[], clock: number, progress: number }}
 */
export function evaluate(spec, t, shape) {
	const p = Math.min(1, Math.max(0, t / spec.seconds));
	const pose = pathOf(spec.camera, spec.seconds)(p);
	const keyed = fovOf(spec.camera, p, spec.seconds);
	const composed = keyed ?? (spec.lens.fovTo === undefined ? spec.lens.fov : lerp(spec.lens.fov, spec.lens.fovTo, p));
	const to = shape ?? spec.aspect, f = spec.framing[to] ?? {};
	let fov = f.fov ?? fovFor(composed, spec.aspect, to);
	/** @type {Pose} */
	let out = [...pose];
	if (f.yaw) out[3] += f.yaw;
	if (f.pitch) out[4] += f.pitch;
	if (f.dx || f.dy) {
		// sideways and up, in the camera's own frame (yaw about y, then pitch)
		const dx = f.dx ?? 0, dy = f.dy ?? 0, yaw = out[3], pitch = out[4];
		out[0] += Math.cos(yaw) * dx - Math.sin(yaw) * Math.sin(pitch) * dy;
		out[1] += Math.cos(pitch) * dy;
		out[2] += -Math.sin(yaw) * dx - Math.cos(yaw) * Math.sin(pitch) * dy;
	}
	return {
		pose: out,
		fov,
		hour: spec.time.hourTo === undefined ? spec.time.hour : lerp(spec.time.hour, spec.time.hourTo, p),
		stops: valueAt(spec.exposure.stops, t),
		lights: spec.lights.map((l) => ({ id: l.id, intensity: l.intensity === undefined ? 1 : valueAt(l.intensity, t), ...(l.color ? { color: l.color } : {}) })),
		cues: spec.cues.filter((c) => c.at <= t),
		clock: spec.world.clock + t,
		progress: p
	};
}

/** The times (shot seconds) a frame's shutter samples: `samples` instants spread over angle/360 of the frame. */
export function shutterTimes(/** @type {Spec} */ spec, /** @type {number} */ t) {
	const n = spec.shutter.samples, open = spec.shutter.angle / 360 / spec.fps;
	if (n <= 1 || open <= 0) return [t];
	return Array.from({ length: n }, (_, i) => t + (open * i) / n);
}

// ── fingerprints ─────────────────────────────────────────────────────────────────────────────────────────────────

/** JSON with its keys sorted at every level: the same data always gives the same text. */
export function stable(/** @type {unknown} */ v) {
	/** @returns {string} */
	const go = (/** @type {any} */ x) => {
		if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
		if (Array.isArray(x)) return `[${x.map(go).join(',')}]`;
		return `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${go(x[k])}`).join(',')}}`;
	};
	return go(v);
}

/** SHA-256 of a string (UTF-8), hex — synchronous, the same in the browser, Bun and Node. */
export function sha256(/** @type {string} */ text) {
	const bytes = new TextEncoder().encode(text);
	const K = new Uint32Array([
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
		0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
		0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
		0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
	]);
	const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
	const len = bytes.length, padded = new Uint8Array((((len + 9 + 63) >> 6) << 6));
	padded.set(bytes);
	padded[len] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
	view.setUint32(padded.length - 4, (len * 8) >>> 0);
	const W = new Uint32Array(64);
	const rotr = (/** @type {number} */ x, /** @type {number} */ n) => (x >>> n) | (x << (32 - n));
	for (let off = 0; off < padded.length; off += 64) {
		for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
			W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
		}
		let [a, b, c, d, e, f, g, h] = H;
		for (let i = 0; i < 64; i++) {
			const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
			const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
			(h = g), (g = f), (f = e), (e = (d + t1) >>> 0), (d = c), (c = b), (b = a), (a = (t1 + t2) >>> 0);
		}
		H[0] += a, H[1] += b, H[2] += c, H[3] += d, H[4] += e, H[5] += f, H[6] += g, H[7] += h;
	}
	return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * A stable hash of what a shot's pixels depend on — the world, its build and seed, the camera, lens, hour, exposure,
 * lights, events, shutter and framing — plus whatever the render adds (`extra`: from, to, shape, size, transform
 * ids…). Notes, the suggested look and sound cues do not change a frame and are left out, so editing them never
 * throws a plate away.
 * @param {Spec} spec @param {Record<string, unknown>} [extra]
 */
export function fingerprint(spec, extra = {}) {
	const { look: _l, meta: _m, cues, ...rest } = spec;
	return sha256(stable({ v: 1, spec: { ...rest, cues: cues.filter((c) => c.kind !== 'sound') }, extra }));
}

/** Two specs the same shot (as the shots table decides whether a save is a new version). */
export const sameSpec = (/** @type {Spec} */ a, /** @type {Spec} */ b) => stable(a) === stable(b);

// ── the shot lists written before shots were data (scripts/film/day-19-d.mjs …) ──────────────────────────────────

/**
 * How far over or under middle grey a legacy shot is metered, in stops: grade.mjs's per-hour brightness targets
 * (mean display luma of the lower 60% of the frame: 108 by day) as offsets. Luma is display-referred (gamma ≈ 2.4),
 * so a luma ratio r is 2.4·log2(r) stops. Night is deliberately under; the dip dull and heavy.
 * @param {{ hour: number, mood?: string, bright?: number }} shot
 */
export function legacyStops(shot) {
	const DAY = 108;
	const target = shot.bright ?? (shot.mood === 'dip' ? 86 : shot.mood === 'bright' ? 118 : shot.hour < 5.2 ? 100 : shot.hour < 6.2 ? 106 : shot.hour >= 20.2 ? 72 : shot.hour >= 19.5 ? 88 : DAY);
	return Math.round(2.4 * Math.log2(target / DAY) * 100) / 100;
}

/** The look a legacy shot was graded with (its mood, its `grade`), as a preset name — a suggestion, never baked. */
export function legacyLook(/** @type {{ mood?: string, grade?: string, extra?: string }} */ shot) {
	if (shot.mood === 'dip') return 'dip'; // COLD + DIP: the world as it was
	if (shot.mood === 'bright') return 'bright';
	const g = `${shot.grade ?? ''}`;
	if (/saturation=0\.45/.test(g)) return 'cold';
	if (/saturation=1\.08/.test(g)) return 'night';
	return undefined;
}

/**
 * A shot of a legacy shot list (scripts/film/day-19-d.mjs: name, size, hour, hourTo, fov, fovTo, stand, dome, props,
 * exposure, blur, mood, grade, extra, sfx, path built with camera.mjs, start, seconds) as a spec.
 *   · its path's `.spec` (camera.mjs attaches it) becomes the camera;
 *   · `start` (its place on the film's clock) becomes world.clock: the trucks of a set drive on the same clock;
 *   · `blur: n` (n poses averaged over a whole frame) becomes a 360° shutter with n samples;
 *   · `exposure` (the lens opened for grade.mjs's 8-bit pre-grade) is not needed in log: the meter exposes, and
 *     grade.mjs's per-hour brightness target becomes a stop offset (legacyStops);
 *   · `mood` / `grade` / `extra` become a `look` preset name (legacyLook) — never baked;
 *   · `sfx` (['<hash>.mp3', level]) become sound cues at the shot's first frame.
 * `opts.seconds` / `opts.clock` give its length and place when the list itself has no timing (no library/).
 * @param {any} shot @param {{ seconds?: number, clock?: number, fps?: number, aspect?: Shape, build?: Build, seed?: number }} [opts]
 * @returns {Spec}
 */
export function fromLegacy(shot, opts = {}) {
	if (!shot?.path?.spec) throw new ShotError(`${shot?.name ?? 'a shot'}: its path is not data (build it with scripts/film/camera.mjs)`);
	const seconds = opts.seconds ?? shot.seconds;
	if (!finite(seconds)) throw new ShotError(`${shot.name}: how long is it? (give opts.seconds)`);
	const sfx = /** @type {[string, number][]} */ (shot.sfx ?? []);
	return normalize({
		world: { sandbox: 'sandbox-4', build: opts.build ?? null, seed: opts.seed ?? 1, stand: shot.stand, ...(shot.dome !== undefined ? { dome: shot.dome } : {}), ...(shot.props ? { props: shot.props } : {}), clock: opts.clock ?? shot.start ?? 0 },
		seconds,
		fps: opts.fps ?? 30,
		aspect: opts.aspect ?? '1:1',
		camera: shot.path.spec,
		lens: { fov: shot.fov ?? 45, ...(shot.fovTo !== undefined ? { fovTo: shot.fovTo } : {}) },
		time: { hour: shot.hour, ...(shot.hourTo !== undefined ? { hourTo: shot.hourTo } : {}) },
		// a time-lapse through sunrise follows the light (ramp); everything else is metered once and held
		exposure: { meter: shot.hourTo !== undefined && Math.abs(shot.hourTo - shot.hour) > 0.05 ? 'ramp' : 'lock', stops: legacyStops(shot) },
		lights: [],
		cues: sfx.map(([file, level]) => ({ at: 0, kind: 'sound', hash: String(file).replace(/\.[a-z0-9]+$/, ''), level })),
		shutter: shot.blur ? { angle: 360, samples: shot.blur } : { angle: 180, samples: 1 },
		framing: {},
		look: legacyLook(shot),
		meta: { name: shot.name, ...(shot.size ? { size: shot.size } : {}), ...(shot.scene ? { scene: shot.scene } : {}), ...(shot.exposure !== undefined ? { legacyExposure: shot.exposure } : {}) }
	});
}
