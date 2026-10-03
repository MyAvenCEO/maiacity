/*
 * TWO LEGS AND WINGS — the body plan of a hen, a rooster, a chick, a goose: one skeleton by the same names for each,
 * built from where a species' joints are (the left; the right its mirror), and one way of moving it.
 *
 * The bones: the `body` (everything rides it), the neck in two or three (`neck1`…), the `head`, the `tail`, the wings
 * (`wingL`, `wingR`), and each leg in four: the `thigh` (hidden in the body's feathers, the knee pointing forward),
 * the `shank` (the drumstick, down to the ankle that bends backward), the scaly `tarsus` and the `toes`.
 *
 * Walking, each foot is set down and kept there while the body passes over it, the toes flat and curling as the foot
 * lifts; the body rolls over the foot it stands on (a goose's waddle) and rises and falls twice a stride. A hen's head
 * holds still in the air while her body walks on under it, then shoots forward to the next hold — her head stays
 * where her eyes can keep the ground still — worked out by bending the neck to keep the head where it was.
 */
import * as THREE from 'three';
import type { BoneSpec, Clip, Motion, Pose, Turn, V3 } from '../rig';
import { aim, clamp, footAt, frac, onTheSpot, point, reach, skeleton, smooth, swung, TAU, type Gait, type Skeleton } from '../motion';
import { wander } from '../noise';

export type BirdJoints = {
	body: V3;
	/** the neck's joints from its base, two or three */
	neck: V3[];
	head: V3;
	/** the tip of the beak */
	beak: V3;
	tail: V3;
	/** the left shoulder */
	wing: V3;
	/** hip, knee, ankle, the toes' joint, the middle toe's tip (left) */
	leg: [V3, V3, V3, V3, V3];
};

const mirror = (p: V3): V3 => [-p[0], p[1], p[2]];
const SIDES = ['L', 'R'] as const;

export type BirdSkeleton = { bones: BoneSpec[]; j: BirdJoints; neck: string[]; sk: Skeleton; toe: Record<'L' | 'R', V3> };

export function birdSkeleton(j: BirdJoints): BirdSkeleton {
	const neck = j.neck.map((_, i) => `neck${i + 1}`);
	const bones: BoneSpec[] = [
		{ name: 'body', at: j.body },
		...neck.map((name, i) => ({ name, parent: i ? neck[i - 1] : 'body', at: j.neck[i]! })),
		{ name: 'head', parent: neck[neck.length - 1], at: j.head },
		{ name: 'tail', parent: 'body', at: j.tail },
		...SIDES.flatMap((s): BoneSpec[] => {
			const m = (p: V3) => (s === 'L' ? p : mirror(p));
			return [
				{ name: `wing${s}`, parent: 'body', at: m(j.wing) },
				{ name: `thigh${s}`, parent: 'body', at: m(j.leg[0]) },
				{ name: `shank${s}`, parent: `thigh${s}`, at: m(j.leg[1]) },
				{ name: `tarsus${s}`, parent: `shank${s}`, at: m(j.leg[2]) },
				{ name: `toes${s}`, parent: `tarsus${s}`, at: m(j.leg[3]) }
			];
		})
	];
	return { bones, j, neck, sk: skeleton(bones), toe: { L: j.leg[4], R: mirror(j.leg[4]) } };
}

/**
 * How a bird walks: a gait (./motion.ts) and how its legs work in it — `tilt` how far the tarsus leans as the leg
 * sweeps under the body, `fold` how far the ankle folds it back in the swing, `curl` how far the toes curl as the foot
 * lifts; `hold`: how much of each step the head holds still (0: it rides with the body, a goose's).
 */
export type BirdGait = Gait & { speed: number; tilt: number; fold: number; curl: number; hold: number };

/** Both legs to their feet: on the ground where the gait (or `plant`) puts them, the body as `pose` has it. */
export function birdLegs(b: BirdSkeleton, pose: Pose, g: BirdGait | null, m: Motion | null, pace: number, plant: Partial<Record<'L' | 'R', { y?: number; z?: number; curl?: number }>> = {}) {
	const { sk, toe } = b;
	for (const s of SIDES) {
		const ankle = sk.at(`tarsus${s}`), toes = sk.at(`toes${s}`);
		const step = g && m ? footAt(g, m, s, pace) : { stance: true, u: 0.5, z: 0, y: 0 };
		const extra = plant[s];
		const target = new THREE.Vector3(toes[0], toes[1] + step.y + (extra?.y ?? 0), toes[2] + step.z + (extra?.z ?? 0));
		let lean = 0, curl = extra?.curl ?? 0;
		if (g) {
			if (step.stance) lean = g.tilt * pace * (step.u - 0.5);
			else {
				lean = g.tilt * pace * (0.5 - step.u) + g.fold * Math.min(1, pace * 1.5) * Math.sin(Math.PI * step.u);
				curl += g.curl * Math.min(1, pace * 1.5) * Math.sin(Math.PI * Math.min(1, step.u * 1.2));
			}
		}
		const tarsus = swung(ankle, toes, lean);
		const len = Math.hypot(toes[0] - ankle[0], toes[1] - ankle[1], toes[2] - ankle[2]);
		reach(sk, pose, `thigh${s}`, `shank${s}`, ankle, target.clone().addScaledVector(tarsus, -len));
		point(sk, pose, `tarsus${s}`, toes, tarsus);
		point(sk, pose, `toes${s}`, toe[s], swung(toes, toe[s], curl));
	}
}

/** The head carried to a point (model space) by the last two neck bones, the beak along `look`. */
export function birdHead(b: BirdSkeleton, pose: Pose, target: THREE.Vector3, look: THREE.Vector3) {
	const { sk, j, neck } = b;
	const n = neck.length;
	reach(sk, pose, neck[n - 2]!, neck[n - 1]!, j.head, target);
	aim(sk, pose, 'head', j.beak, look);
}

export type BirdLife = {
	gaits: Record<string, BirdGait>;
	seed?: number;
	/** how far the tail wags walking (rad) */
	wag?: number;
	/** a goose's: the neck's base held up and back (rad) */
	carry?: number;
};

/**
 * A bird's moves: each gait in `life.gaits`, standing (`idle`), and from the ground: `peck` (a hen's quick strikes),
 * `scratch` (a hen raking the ground back with one foot, then the other), `graze` (a goose's long-necked cropping),
 * `flap` (the wings beaten), `hiss` (a goose's neck low and wings half out).
 */
export function birdMoves(b: BirdSkeleton, life: BirdLife): Record<string, Clip> {
	const { j, neck } = b;
	const seed = life.seed ?? 1;
	const beakDir = new THREE.Vector3(j.beak[0] - j.head[0], j.beak[1] - j.head[1], j.beak[2] - j.head[2]).normalize();
	const headLen = Math.hypot(j.beak[0] - j.head[0], j.beak[1] - j.head[1], j.beak[2] - j.head[2]);
	const rest = (t: number): Pose => ({
		tail: [0.04 * Math.sin(t * 1.3 + seed), 0.06 * wander(t, 2.5, seed + 4), 0],
		root: [0, 0.002 * Math.sin(t * 2.2), 0],
		...(life.carry ? { [neck[0]!]: [-life.carry, 0, 0] as Turn } : {})
	});
	const moves: Record<string, Clip> = {};
	for (const [name, g] of Object.entries(life.gaits)) {
		moves[name] = (t, m) => {
			const mo = onTheSpot(t, g.speed, m);
			const pace = clamp(mo.speed / g.speed, 0, 1.4);
			const ph = mo.dist / g.stride;
			const sway = Math.sin(TAU * ph);
			const turn = clamp(mo.turn ?? 0, -1.5, 1.5);
			const pose: Pose = {
				root: [-g.roll * 0.15 * pace * sway, -g.bob * pace * (0.5 + 0.5 * Math.cos(TAU * 2 * ph)), 0],
				body: [g.pitch * pace * Math.sin(TAU * 2 * ph), -turn * 0.1, g.roll * pace * sway],
				tail: [0.05 * pace, (life.wag ?? 0.1) * pace * Math.sin(TAU * ph - 1), 0]
			};
			if (life.carry) pose[neck[0]!] = [-life.carry, 0, 0];
			birdLegs(b, pose, g, mo, Math.min(1, pace));
			if (g.hold > 0) {
				// the head held still in the air for most of each step, then thrust on to the next hold
				const u = frac(2 * ph);
				const span = (g.stride / 2) * g.hold * Math.min(1, pace);
				const z = u < g.hold ? span * (0.5 - u / g.hold) : span * (-0.5 + smooth((u - g.hold) / (1 - g.hold)));
				birdHead(b, pose, new THREE.Vector3(0, j.head[1], j.head[2] + z + 0.01), beakDir.clone());
			} else {
				pose[neck[neck.length - 1]!] = [0.06 * Math.sin(TAU * 2 * ph), turn * 0.2, 0];
				pose.head = [-0.06 * Math.sin(TAU * 2 * ph), turn * 0.2, 0];
			}
			return pose;
		};
	}
	moves.idle = (t) => {
		const pose = rest(t);
		// a look one way and then the other: a bird turns its head to look with one eye
		const look = wander(t, 1.6, seed + 1), up = wander(t, 2.3, seed + 3);
		birdLegs(b, pose, null, null, 0);
		birdHead(b, pose, new THREE.Vector3(0.01 * look, j.head[1] + 0.01 * up, j.head[2] - 0.01 + 0.01 * up), beakDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.9 * look).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.15 * up));
		return pose;
	};
	/** the head down to the ground ahead of the feet, `k` of the way (0: up as it stands) */
	const down = (pose: Pose, k: number, ahead: number, side = 0) => {
		const look = new THREE.Vector3(0, -0.85, 0.5).normalize().lerp(beakDir, 1 - k).normalize();
		const ground = new THREE.Vector3(side, 0.006, b.toe.L[2] + ahead);
		const low = ground.clone().addScaledVector(look, -headLen);
		const target = new THREE.Vector3(...j.head).lerp(low, k);
		birdHead(b, pose, target, look);
	};
	moves.peck = (t) => {
		const pose = rest(t);
		// bursts of quick strikes, a look between them
		const burst = frac(t / 2.4) < 0.6;
		const strike = burst ? Math.pow(Math.max(0, Math.sin(t * 11)), 3) : 0;
		const bend = 0.55 + 0.4 * strike;
		pose.body = [0.35 * (burst ? 1 : 0.6), 0, 0];
		birdLegs(b, pose, null, null, 0);
		down(pose, burst ? bend : 0.35, 0.06 + 0.01 * wander(t, 1, seed), 0.02 * wander(t, 1.7, seed + 5));
		return pose;
	};
	moves.scratch = (t) => {
		const pose = rest(t);
		// a foot raked back twice along the ground, then the other; then a look at what was turned up
		const u = frac(t / 2.2);
		const s = u < 0.5 ? 'L' : 'R';
		const k = frac(u * 4);
		const rake = u < 0.92 ? k : 0;
		const z = 0.05 - 0.12 * smooth(rake) + 0.07 * smooth((rake - 0.75) / 0.25);
		const y = rake > 0.75 ? 0.03 * Math.sin(Math.PI * (rake - 0.75) / 0.25) : 0;
		pose.body = [0.2, 0, (s === 'L' ? -1 : 1) * 0.06];
		birdLegs(b, pose, null, null, 0, { [s]: { z, y, curl: rake > 0.75 ? 0.6 : -0.15 } });
		down(pose, 0.35 + 0.2 * Math.sin(t * 3), 0.05);
		return pose;
	};
	moves.graze = (t) => {
		const pose = rest(t);
		const nibble = Math.max(0, Math.sin(t * 7)) ** 2;
		pose.body = [0.3, 0, 0];
		if (life.carry) pose[neck[0]!] = [0.5, 0.15 * wander(t, 3, seed), 0];
		birdLegs(b, pose, null, null, 0);
		down(pose, 0.9 + 0.08 * nibble, 0.1, 0.04 * wander(t, 2, seed + 6));
		return pose;
	};
	moves.flap = (t) => {
		const pose = rest(t);
		const w = Math.sin(t * 15);
		pose.root = [0, 0.012 * Math.max(0, w), 0];
		pose.body = [-0.35, 0, 0];
		pose.wingL = [0.2 * w, 0, 0.5 + 0.9 * (0.5 + 0.5 * w)];
		pose.wingR = [0.2 * w, 0, -0.5 - 0.9 * (0.5 + 0.5 * w)];
		birdLegs(b, pose, null, null, 0);
		birdHead(b, pose, new THREE.Vector3(0, j.head[1] + 0.02, j.head[2] - 0.02), new THREE.Vector3(0, 0.3, 1).normalize());
		return pose;
	};
	moves.hiss = (t) => {
		const pose = rest(t);
		const sway = Math.sin(t * 2.5);
		pose.body = [0.15, 0, 0];
		if (life.carry) pose[neck[0]!] = [0.75, 0.1 * sway, 0];
		pose.wingL = [0, 0, 0.55 + 0.1 * Math.sin(t * 9)];
		pose.wingR = [0, 0, -0.55 - 0.1 * Math.sin(t * 9)];
		birdLegs(b, pose, null, null, 0);
		const k = new THREE.Vector3(0.03 * sway, j.body[1] + 0.08, j.head[2] + headLen * 1.2);
		birdHead(b, pose, k, new THREE.Vector3(0.1 * sway, -0.1, 1).normalize());
		return pose;
	};
	return moves;
}
