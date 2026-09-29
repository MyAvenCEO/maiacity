// World shots as data (contract C2): the records a world clip names, their versions, and what a shot is at a moment.
// Every save of a changed spec is a new version; a clip names the version it was cut with and follows a new one only
// when the studio says so.
import { createShot, getShot, listShots, missing, saveShot, type CameraKey, type Shape, type Shot, type ShotSpec } from '$lib/auth/client';

// ── game/film/shot.js (stream B) ───────────────────────────────────────────────────────────────────────────────────
// ADAPTER: shot.js does not exist on this branch yet. import.meta.glob finds it when it does (and finds nothing, with
// no build error, until then); the fallback below evaluates only what the studio itself writes (camera keys, hour,
// exposure, lights). Remove `fallbackEvaluate` once stream B's shot.js has landed.
type Evaluated = { pose: [number, number, number, number, number]; fov: number; hour: number; stops: number; lights: { id: string; intensity: number }[]; cues: ShotSpec['cues'] };
type ShotModule = { evaluate: (spec: ShotSpec, t: number, shape?: Shape) => Evaluated };
const found = import.meta.glob<ShotModule>('../../../game/film/shot.js');
let shotJs: ShotModule | null = null;
export const shotModule = (async () => {
	const load = Object.values(found)[0];
	shotJs = load ? await load().catch(() => null) : null;
	return shotJs;
})();
/** Is stream B's evaluate() here (presets, framing per shape), or only the studio's own fallback? */
export const hasShotJs = () => !!shotJs;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Where a pose looks from p to q (as scripts/film/camera.mjs `look`). */
const look = (p: number[], q: number[]): [number, number, number, number, number] => {
	const dx = q[0]! - p[0]!, dy = q[1]! - p[1]!, dz = q[2]! - p[2]!;
	return [p[0]!, p[1]!, p[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
};
const keyPose = (k: CameraKey): [number, number, number, number, number] =>
	k.aim ? look(k.position, k.aim) : [k.position[0], k.position[1], k.position[2], k.yaw ?? 0, k.pitch ?? 0];

function fallbackEvaluate(spec: ShotSpec, t: number): Evaluated {
	const p = spec.seconds > 0 ? Math.min(1, Math.max(0, t / spec.seconds)) : 0;
	const keys = [...(spec.camera.keys ?? [])].sort((a, b) => a.t - b.t);
	let pose: Evaluated['pose'] = [0, 10, 0, 0, 0];
	let fov = spec.lens?.fov ?? 50;
	if (keys.length) {
		const j = keys.findIndex((k) => k.t > t);
		const a = keys[j < 0 ? keys.length - 1 : Math.max(0, j - 1)]!, b = keys[j < 0 ? keys.length - 1 : j]!;
		const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
		const pa = keyPose(a), pb = keyPose(b);
		pose = pa.map((v, i) => lerp(v, pb[i]!, u)) as Evaluated['pose'];
		fov = lerp(a.fov ?? fov, b.fov ?? fov, u);
	} else if (spec.lens?.fovTo !== undefined) fov = lerp(spec.lens.fov, spec.lens.fovTo, p);
	const at = (v: number | [number, number][] | undefined) =>
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

/** What the shot is at shot-local time t: the camera, the hour, the exposure, the lights, the cues. */
export const evaluate = (spec: ShotSpec, t: number, shape?: Shape): Evaluated =>
	shotJs ? shotJs.evaluate(spec, t, shape) : fallbackEvaluate(spec, t);

/** The camera as keys: a preset move sampled once a second (only with shot.js; keys stay keys). */
export function toKeys(spec: ShotSpec): CameraKey[] | null {
	if (spec.camera.kind === 'keys') return spec.camera.keys ?? [];
	if (!shotJs) return null;
	const n = Math.max(2, Math.ceil(spec.seconds) + 1);
	return Array.from({ length: n }, (_, i) => {
		const t = (i / (n - 1)) * spec.seconds;
		const e = shotJs!.evaluate(spec, t);
		return { t, position: [e.pose[0], e.pose[1], e.pose[2]], yaw: e.pose[3], pitch: e.pose[4], fov: e.fov };
	});
}

/** An empty shot to start from: noon, a still camera over the city, metered and locked. */
export const blankSpec = (seconds = 6): ShotSpec => ({
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
let mode: 'api' | 'local' | null = null;
export const shotsMode = () => mode;

const readLocal = (): Record<string, Shot[]> => {
	try {
		return JSON.parse(localStorage.getItem(LOCAL) ?? '{}');
	} catch {
		return {};
	}
};
const writeLocal = (all: Record<string, Shot[]>) => {
	try {
		localStorage.setItem(LOCAL, JSON.stringify(all));
	} catch {
		/* full or blocked: kept for this session only */
	}
};

const cache = new Map<string, Shot>(); // `${id}@${version}` → record
const key = (id: string, v: number) => `${id}@${v}`;
const keep = (s: Shot) => (cache.set(key(s.id, s.version), s), s);

/** Every shot (its newest version). */
export async function allShots(project?: string): Promise<Shot[]> {
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
		.map((v) => v.at(-1)!)
		.filter((s) => s && (!project || s.project === project))
		.map(keep);
}

/** One shot at the version a clip was cut with. */
export async function shotAt(id: string, version?: number): Promise<Shot | null> {
	if (version && cache.has(key(id, version))) return cache.get(key(id, version))!;
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
/** A shot already fetched (synchronous, for the frame loop). */
export const cached = (id: string | undefined, version: number | undefined) => (id && version ? (cache.get(key(id, version)) ?? null) : null);

/** A changed spec: a new version of the shot. */
export async function saveSpec(s: Shot, spec: ShotSpec): Promise<Shot> {
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
	const next: Shot = { ...s, version: (list.at(-1)?.version ?? s.version) + 1, spec, updated: new Date().toISOString() };
	all[s.id] = [...list, next];
	writeLocal(all);
	return keep(next);
}

export async function newShot(name: string, project: string | null, spec = blankSpec()): Promise<Shot> {
	if (mode !== 'local') {
		try {
			return keep(await createShot({ name, project, spec }));
		} catch (e) {
			if (!missing(e)) throw e;
			mode = 'local';
		}
	}
	const now = new Date().toISOString();
	const s: Shot = { id: crypto.randomUUID(), name, project, version: 1, spec, created: now, updated: now };
	const all = readLocal();
	all[s.id] = [s];
	writeLocal(all);
	return keep(s);
}
