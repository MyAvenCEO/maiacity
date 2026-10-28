/*
 * MOTION — how an actor's gaits are worked out, instead of drawn by hand: its feet set down on the ground and kept
 * there while the body passes over them, and its legs bent to reach them (inverse kinematics), the body bobbing and
 * swaying as the steps carry it.
 *
 * A gait is a table of numbers from how the animal really walks — how long a stride is, how long each foot is down
 * of it (the duty factor), when each foot lands in it (the footfalls) — and the stride's phase is the distance
 * walked, not the time: a foot on the ground moves back under the body exactly as fast as the body moves forward, so
 * it stays where it was set down, at any speed.
 *
 * Everything here is a function of where and when — no state carried from frame to frame — so a shot's frame is
 * the same however often, and in whatever order, it is drawn.
 */
import * as THREE from 'three';
import type { BoneSpec, Motion, Pose, Turn, V3 } from './rig';

export const TAU = Math.PI * 2;
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const smooth = (x: number) => {
	const t = clamp(x, 0, 1);
	return t * t * (3 - 2 * t);
};
export const frac = (x: number) => x - Math.floor(x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A skeleton at rest, to pose by reckoning: where each bone's joint goes when the bones above it are turned. */
export function skeleton(bones: BoneSpec[]) {
	const by = new Map(bones.map((b) => [b.name, b]));
	const root = bones[0]!.name;
	const e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), own = new THREE.Matrix4();
	/** the frame of a bone as posed: its joint at the origin, turned as it and every bone above it are (model space) */
	const frame = (pose: Pose, name: string, out = new THREE.Matrix4()): THREE.Matrix4 => {
		const b = by.get(name)!;
		// the bones above it first (they use the same scratch values)
		if (b.parent) frame(pose, b.parent, out);
		const t = pose[name] as Turn | undefined;
		q.setFromEuler(e.set(t?.[0] ?? 0, t?.[1] ?? 0, t?.[2] ?? 0));
		const k = t?.[3] ?? 1;
		s.set(k, k, k);
		if (!b.parent) {
			const r = (pose.root ?? [0, 0, 0]) as V3;
			return out.compose(v.set(b.at[0] + r[0], b.at[1] + r[1], b.at[2] + r[2]), q, s);
		}
		const p = by.get(b.parent)!;
		return out.multiply(own.compose(v.set(b.at[0] - p.at[0], b.at[1] - p.at[1], b.at[2] - p.at[2]), q, s));
	};
	/** where a bone's joint is, as posed */
	const joint = (pose: Pose, name: string) => new THREE.Vector3().setFromMatrixPosition(frame(pose, name));
	/** the frame a bone turns in: its parent's, moved to its joint */
	const seat = (pose: Pose, name: string) => {
		const b = by.get(name)!;
		if (!b.parent) {
			const r = (pose.root ?? [0, 0, 0]) as V3;
			return new THREE.Matrix4().makeTranslation(b.at[0] + r[0], b.at[1] + r[1], b.at[2] + r[2]);
		}
		const p = by.get(b.parent)!;
		return frame(pose, b.parent).multiply(new THREE.Matrix4().makeTranslation(b.at[0] - p.at[0], b.at[1] - p.at[1], b.at[2] - p.at[2]));
	};
	return { root, at: (name: string) => by.get(name)!.at, has: (name: string) => by.has(name), frame, joint, seat };
}
export type Skeleton = ReturnType<typeof skeleton>;

/* In a bone's own frame a limb swings about x: a direction (y, z) at angle φ = atan2(z, y), a turn about x adding to φ. */
const phi = (y: number, z: number) => Math.atan2(z, y);
const setTurn = (pose: Pose, name: string, x: number) => {
	const t = (pose[name] as Turn | undefined) ?? [0, 0, 0];
	pose[name] = [x, t[1], t[2], ...(t.length === 4 ? [t[3]] : [])] as Turn;
};

/**
 * Two bones (a thigh and a shin, a neck's two halves) bent so the far end of the second reaches `target` (model
 * space): the pair swung the shortest way to point at it, then the joint between them bent, on the side it bends at
 * rest, just enough for the far end to arrive. In three dimensions — a foot under a rolling body, a waddle's — and the
 * bones twisted no more than the swing needs. `end`: the joint at the far end (the next bone's, or a point).
 */
export function reach(sk: Skeleton, pose: Pose, a: string, b: string, end: V3, target: THREE.Vector3) {
	const A = sk.at(a), Bj = sk.at(b);
	const knee = new THREE.Vector3(Bj[0] - A[0], Bj[1] - A[1], Bj[2] - A[2]);
	const tip = new THREE.Vector3(end[0] - A[0], end[1] - A[1], end[2] - A[2]);
	const shin = tip.clone().sub(knee);
	const la = knee.length(), lb = shin.length();
	const to = target.clone().applyMatrix4(sk.seat(pose, a).invert());
	const d = clamp(to.length(), Math.abs(la - lb) * 1.01 + 1e-6, (la + lb) * 0.9995);
	const dir = to.normalize();
	// swung to point at the target, the knee carried round with it
	const swing = new THREE.Quaternion().setFromUnitVectors(tip.clone().normalize(), dir);
	const k1 = knee.clone().applyQuaternion(swing).normalize();
	const axis = dir.clone().cross(k1);
	if (axis.lengthSq() < 1e-12) axis.set(1, 0, 0).applyQuaternion(swing);
	axis.normalize();
	// and opened at the knee as far as the two lengths need
	const open = Math.acos(clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1));
	const kd = dir.clone().applyAxisAngle(axis, open);
	const qa = new THREE.Quaternion().setFromUnitVectors(k1, kd).multiply(swing);
	const want = dir.multiplyScalar(d).sub(kd.multiplyScalar(la)).applyQuaternion(qa.clone().invert()).normalize();
	const qb = new THREE.Quaternion().setFromUnitVectors(shin.normalize(), want);
	setQuat(pose, a, qa);
	setQuat(pose, b, qb);
}

const euler = new THREE.Euler();
/** a bone's turn as a quaternion (its size kept) */
function setQuat(pose: Pose, name: string, q: THREE.Quaternion) {
	euler.setFromQuaternion(q);
	const t = pose[name] as Turn | undefined;
	pose[name] = [euler.x, euler.y, euler.z, ...(t && t.length === 4 ? [t[3]] : [])] as Turn;
}

/**
 * A bone turned (about x, in its swing plane) so that it points along `dir` (model space), whatever its parents do:
 * `tip`, the point it points to at rest.
 */
export function aim(sk: Skeleton, pose: Pose, bone: string, tip: V3, dir: THREE.Vector3) {
	const at = sk.at(bone);
	const m = sk.seat(pose, bone);
	const local = dir.clone().transformDirection(m.invert());
	setTurn(pose, bone, phi(local.y, local.z) - phi(tip[1] - at[1], tip[2] - at[2]));
}

/**
 * A bone turned (any way) so that it points along `dir` (model space), whatever its parents do: `tip`, the point it
 * points to at rest. For limbs that do not swing in one plane (a frog's, folded out to the side).
 */
export function point(sk: Skeleton, pose: Pose, bone: string, tip: V3, dir: THREE.Vector3) {
	const at = sk.at(bone);
	const local = dir.clone().transformDirection(sk.seat(pose, bone).invert());
	const rest = new THREE.Vector3(tip[0] - at[0], tip[1] - at[1], tip[2] - at[2]).normalize();
	setQuat(pose, bone, new THREE.Quaternion().setFromUnitVectors(rest, local));
}

/** A direction: the rest direction from a to b, turned by `angle` about x (positive: its far end swings back). */
export const swung = (a: V3, b: V3, angle: number) => new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize().applyAxisAngle(new THREE.Vector3(1, 0, 0), angle);

/* ── gaits ─────────────────────────────────────────────────────────────── */

/**
 * One way of going, from how the animal walks: `stride` (m) a full cycle of its legs; `duty` how much of it each foot
 * is on the ground; `feet`, when each foot lands in the cycle (0…1, by leg); `lift`, how high a foot is carried (m);
 * `bob`, how far the body rises and falls (m); `roll`, `pitch` its sway (rad).
 */
export type Gait = { stride: number; duty: number; feet: Record<string, number>; lift: number; bob: number; roll: number; pitch: number };

/** A foot in the cycle: on the ground (`stance` true) or carried, how far through that it is (0…1). */
export function foot(g: Gait, m: Motion, leg: string) {
	const p = frac(m.dist / g.stride + 1 - (g.feet[leg] ?? 0));
	return p < g.duty ? { stance: true, u: p / g.duty } : { stance: false, u: (p - g.duty) / (1 - g.duty) };
}

/**
 * Where a foot is, from where it rests: forward (z) and up (y) in the body's frame. On the ground it slides back
 * under the body exactly as the body moves on (it stays where it was put down); carried, it swings forward and up.
 * `pace`: 0…1, how much of the gait is in it (0 standing: the foot at rest).
 */
export function footAt(g: Gait, m: Motion, leg: string, pace = 1) {
	const f = foot(g, m, leg);
	const sweep = g.stride * g.duty;
	if (f.stance) return { ...f, z: sweep * (0.5 - f.u) * pace, y: 0 };
	const u = smooth(f.u);
	// up quickly, forward, and down onto it
	const up = Math.sin(Math.PI * Math.pow(f.u, 0.75));
	return { ...f, z: sweep * (u - 0.5) * pace, y: g.lift * up * Math.min(1, pace * 2) };
}

/** a motion at a pace on the spot: for showing a gait where nothing moves the actor (the Actors gallery) */
export const onTheSpot = (t: number, speed: number, m?: Motion): Motion => m ?? { dist: t * speed, speed };

/** the body's rise and fall over a stride: twice per cycle (a walk's), or `per` times */
export const bobOf = (g: Gait, m: Motion, at = 0, per = 2) => Math.cos(TAU * per * (m.dist / g.stride - at));

/* ── a tail, an ear, a neck that follows: motion that lags what drives it ─ */

/** a chain's segments swaying as a wave runs down it: `amp` at the root growing by `grow` a segment, `lag` (rad) a segment */
export function wave(names: string[], t: number, freq: number, amp: number, axis: 0 | 1 | 2, lag = 0.6, grow = 1.25): Pose {
	const out: Pose = {};
	names.forEach((n, i) => {
		const r: Turn = [0, 0, 0];
		r[axis] = amp * Math.pow(grow, i) * Math.sin(TAU * freq * t - lag * i);
		out[n] = r;
	});
	return out;
}

/** poses laid one over another: each bone's turns added, the root's offsets added, sizes multiplied */
export function layer(...poses: Pose[]): Pose {
	const out: Pose = {};
	for (const p of poses)
		for (const k in p) {
			const v = p[k] as number[] | undefined;
			if (!v) continue;
			const o = (out[k] as number[] | undefined) ?? (k === 'root' ? [0, 0, 0] : [0, 0, 0, 1]);
			const sum = [o[0]! + v[0]!, o[1]! + v[1]!, o[2]! + v[2]!];
			if (k !== 'root') sum.push((o[3] ?? 1) * (v[3] ?? 1));
			out[k] = sum as Turn;
		}
	return out;
}

/** a pose scaled: every turn by k (0: rest) */
export function scaled(p: Pose, k: number): Pose {
	const out: Pose = {};
	for (const n in p) {
		const v = p[n] as number[] | undefined;
		if (!v) continue;
		out[n] = (n === 'root' ? [v[0]! * k, v[1]! * k, v[2]! * k] : [v[0]! * k, v[1]! * k, v[2]! * k, 1 + ((v[3] ?? 1) - 1) * k]) as Turn;
	}
	return out;
}
