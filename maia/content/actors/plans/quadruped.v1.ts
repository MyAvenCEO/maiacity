/* FROZEN: the four-legged plan as goats, sheep and rabbits were at v1 (their grazing head folded back between the forelegs), kept for the Actors gallery's history. Do not change.
 *
 * FOUR LEGS — the body plan of a sheep, a goat, a rabbit: one skeleton with the same bones by the same names for all
 * of them, built from where a species' joints are (measured, the left side; the right is its mirror), and one way of
 * moving it, tuned by numbers per species.
 *
 * The bones: `body` in the middle of the trunk (it carries the rest: the whole animal pitches, rolls and bobs on it),
 * `chest` and `pelvis` at the two girdles (the spine flexes between them), the neck in two (`neck`, `neck2`) and the
 * `head` (a `jaw`, the ears), the tail in its segments (`tail1`…), and each leg (FL, FR, HL, HR) in four: `upper`
 * (the upper arm, the thigh), `lower` (the forearm, the shin), `cannon` (below the knee or the hock) and `foot` (the
 * pastern and hoof, the toes).
 *
 * Walking, each hoof is set down where the gait puts it and kept there; the two upper bones of each leg are bent to
 * reach it (./motion.ts), the cannon leaning as the leg sweeps under the body and folding as it swings through, the
 * hoof flat on the ground and flipping as it lifts. Standing and grazing, the head is carried to the grass and the legs
 * stand where they stood.
 */
import * as THREE from 'three';
import type { BoneSpec, Clip, Motion, Pose, Turn, V3 } from '../rig';
import { aim, bobOf, clamp, footAt, onTheSpot, point, reach, skeleton, smooth, swung, TAU, wave, type Gait, type Skeleton } from '../motion';
import { now, wander } from '../noise';

export type Leg = 'FL' | 'FR' | 'HL' | 'HR';
export const LEGS: Leg[] = ['FL', 'FR', 'HL', 'HR'];

/** Where a four-legged animal's joints rest (m, facing +z, its left +x), the left legs top to toe. */
export type QuadJoints = {
	body: V3;
	chest: V3;
	pelvis: V3;
	/** the neck's base and its middle */
	neck: [V3, V3];
	/** the poll, where the head turns on the neck */
	head: V3;
	/** the tip of the muzzle, where the head points */
	muzzle: V3;
	jaw?: V3;
	/** the left ear's base and tip */
	ear?: [V3, V3];
	/** the tail's joints from its root, and its tip */
	tail: V3[];
	/** shoulder, elbow, knee (carpus), fetlock, toe tip */
	fore: [V3, V3, V3, V3, V3];
	/** hip, stifle, hock, fetlock, toe tip */
	hind: [V3, V3, V3, V3, V3];
};

const mirror = (p: V3): V3 => [-p[0], p[1], p[2]];

export type QuadSkeleton = { bones: BoneSpec[]; j: QuadJoints; tail: string[]; sk: Skeleton; toe: Record<Leg, V3> };

export function quadSkeleton(j: QuadJoints): QuadSkeleton {
	const tail = j.tail.slice(0, -1).map((_, i) => `tail${i + 1}`);
	const bones: BoneSpec[] = [
		{ name: 'body', at: j.body },
		{ name: 'chest', parent: 'body', at: j.chest },
		{ name: 'pelvis', parent: 'body', at: j.pelvis },
		{ name: 'neck', parent: 'chest', at: j.neck[0] },
		{ name: 'neck2', parent: 'neck', at: j.neck[1] },
		{ name: 'head', parent: 'neck2', at: j.head },
		...(j.jaw ? [{ name: 'jaw', parent: 'head', at: j.jaw }] : []),
		...(j.ear ? [{ name: 'earL', parent: 'head', at: j.ear[0] }, { name: 'earR', parent: 'head', at: mirror(j.ear[0]) }] : []),
		...tail.map((name, i) => ({ name, parent: i ? tail[i - 1] : 'pelvis', at: j.tail[i]! })),
		...LEGS.flatMap((leg): BoneSpec[] => {
			const pts = (leg[0] === 'F' ? j.fore : j.hind).map((p) => (leg[1] === 'L' ? p : mirror(p)));
			return [
				{ name: `upper${leg}`, parent: leg[0] === 'F' ? 'chest' : 'pelvis', at: pts[0]! },
				{ name: `lower${leg}`, parent: `upper${leg}`, at: pts[1]! },
				{ name: `cannon${leg}`, parent: `lower${leg}`, at: pts[2]! },
				{ name: `foot${leg}`, parent: `cannon${leg}`, at: pts[3]! }
			];
		})
	];
	const toe = Object.fromEntries(LEGS.map((leg) => {
		const p = (leg[0] === 'F' ? j.fore : j.hind)[4];
		return [leg, leg[1] === 'L' ? p : mirror(p)];
	})) as Record<Leg, V3>;
	return { bones, j, tail, sk: skeleton(bones), toe };
}

/**
 * How a species walks: a gait (./motion.ts) and how its legs work in it — `tilt` how far the cannon leans as the leg
 * sweeps under the body (rad), `fold` how far the knee (fore) and hock (hind) fold the cannon back in the swing,
 * `flip` how far the hoof turns up as it leaves the ground, `nod` the head's nod, `flex` the spine's.
 */
export type QuadGait = Gait & { speed: number; tilt: number; fold: [number, number]; flip: number; nod: number; flex: number; bobs?: number };

/** The legs of a quadruped standing or walking: every leg to where its hoof is (the root and body as `pose` has them). */
export function legs(q: QuadSkeleton, pose: Pose, g: QuadGait | null, m: Motion | null, pace: number, plant: Partial<Record<Leg, { y?: number; z?: number }>> = {}) {
	const { sk, toe } = q;
	for (const leg of LEGS) {
		const fore = leg[0] === 'F';
		const top = sk.at(`cannon${leg}`), fet = sk.at(`foot${leg}`);
		const step = g && m ? footAt(g, m, leg, pace) : { stance: true, u: 0.5, z: 0, y: 0 };
		const extra = plant[leg];
		const target = new THREE.Vector3(fet[0], fet[1] + step.y + (extra?.y ?? 0), fet[2] + step.z + (extra?.z ?? 0));
		let lean = 0, flip = 0;
		if (g) {
			const tilt = g.tilt * pace, fold = g.fold[fore ? 0 : 1] * Math.min(1, pace * 1.5);
			// late on the ground the heel lifts and the hoof tips onto its toe: the toe stays, the fetlock rises
			const heel = g.flip * 0.5 * pace;
			if (step.stance) {
				lean = tilt * (step.u - 0.5);
				flip = heel * smooth((step.u - 0.65) / 0.35);
				if (flip > 0) {
					const t3 = toe[leg];
					const tipAt = new THREE.Vector3(t3[0], t3[1], t3[2] + step.z);
					target.copy(tipAt).add(new THREE.Vector3(fet[0] - t3[0], fet[1] - t3[1], fet[2] - t3[2]).applyAxisAngle(new THREE.Vector3(1, 0, 0), flip));
				}
			} else {
				lean = tilt * (0.5 - step.u) + fold * Math.sin(Math.PI * step.u);
				flip = heel * (1 - smooth(step.u / 0.3)) + g.flip * pace * Math.sin(Math.PI * Math.min(1, step.u * 1.3));
			}
		}
		const cannon = swung(top, fet, lean);
		const len = Math.hypot(fet[0] - top[0], fet[1] - top[1], fet[2] - top[2]);
		reach(sk, pose, `upper${leg}`, `lower${leg}`, top, target.clone().addScaledVector(cannon, -len));
		point(sk, pose, `cannon${leg}`, fet, cannon);
		point(sk, pose, `foot${leg}`, toe[leg], swung(fet, toe[leg], flip));
	}
}

/**
 * The head carried to a point (model space) by its two neck bones, the muzzle pointing along `look` — the grass in
 * front of the forefeet, a hand held out, the horizon.
 */
export function headTo(q: QuadSkeleton, pose: Pose, target: THREE.Vector3, look: THREE.Vector3) {
	const { sk, j } = q;
	reach(sk, pose, 'neck', 'neck2', j.head, target);
	aim(sk, pose, 'head', j.muzzle, look);
}

/** The pieces of a quadruped's life a species sets its numbers to. */
export type QuadLife = {
	gaits: Record<string, QuadGait>;
	/** the tail's sway at rest and walking (rad), its carriage (rad, + down), how it wags (Hz) */
	tail?: { sway: number; carry: number; hz: number; axis?: 0 | 1 };
	/** how far the ears flick and turn */
	ears?: number;
	/** seeds of its habits */
	seed?: number;
	/** how far below the eye the head is carried walking (m), and how high it lifts when it looks round */
	carry?: number;
};

/**
 * A quadruped's moves: each gait in `life.gaits` (walk, trot …), and standing (`idle`), grazing (`graze`), looking
 * up (`alert`).
 */
export function quadMoves(q: QuadSkeleton, life: QuadLife): Record<string, Clip> {
	const { j, tail } = q;
	const seed = life.seed ?? 1;
	const tl = life.tail ?? { sway: 0.15, carry: 0, hz: 1.2 };
	const earSwing = life.ears ?? 0.4;
	/** what every pose has: the tail, the ears' flicks, a breath */
	const living = (t: number, moving: number): Pose => {
		const p: Pose = wave(tail, t, tl.hz * (1 + moving), tl.sway * (0.6 + moving), tl.axis ?? 1, 0.7, 1.2);
		tail.forEach((n, i) => ((p[n] as Turn)[0] += (tl.carry / tail.length) * (i ? 1 : 0.5)));
		const flick = now(t, 2.8, 0.35, seed + 3), turn = wander(t, 3.5, seed + 9);
		const f = flick >= 0 ? Math.sin(Math.PI * flick) : 0;
		p.earL = [earSwing * (0.25 * turn - 0.5 * f), 0, earSwing * 0.3 * f];
		p.earR = [earSwing * (-0.25 * turn), 0, 0];
		return p;
	};
	const moves: Record<string, Clip> = {};
	for (const [name, g] of Object.entries(life.gaits)) {
		moves[name] = (t, m) => {
			const mo = onTheSpot(t, g.speed, m);
			const pace = clamp(mo.speed / g.speed, 0, 1.4);
			const ph = mo.dist / g.stride;
			const per = g.bobs ?? 2;
			const bob = bobOf(g, mo, 0.1, per);
			const sway = Math.sin(TAU * ph);
			const turn = clamp(mo.turn ?? 0, -1.5, 1.5);
			const pose: Pose = {
				...living(t, Math.min(1, pace)),
				root: [0, -g.bob * pace * (0.5 + 0.5 * bob), 0],
				body: [g.pitch * pace * Math.sin(TAU * per * ph), -turn * 0.08, g.roll * pace * sway - turn * 0.04],
				chest: [g.flex * pace * Math.sin(TAU * ph + 0.5), 0.04 * pace * sway + turn * 0.05, 0],
				pelvis: [-g.flex * pace * Math.sin(TAU * ph + 0.5), -0.04 * pace * sway - turn * 0.03, 0]
			};
			// the head carried a little lower and forward as it goes, nodding with the forelegs
			const nod = g.nod * pace * Math.sin(TAU * 2 * ph - 0.6);
			pose.neck = [0.08 * pace + nod, turn * 0.15, 0];
			pose.neck2 = [0.05 * pace - nod * 0.4, turn * 0.15, 0];
			pose.head = [-0.1 * pace - nod * 0.5, turn * 0.1, 0];
			legs(q, pose, g, mo, Math.min(1, pace));
			return pose;
		};
	}
	const stand = (t: number): Pose => ({
		...living(t, 0),
		root: [0.004 * Math.sin(t * 0.5 + seed), 0.002 * Math.sin(t * 1.6), 0],
		body: [0, 0, 0.01 * Math.sin(t * 0.5 + seed)]
	});
	moves.idle = (t) => {
		const pose = stand(t);
		// looks round now and then, and back
		const look = wander(t, 4.2, seed + 1), up = wander(t, 6.1, seed + 2);
		pose.neck = [-0.08 + 0.1 * up, 0.25 * look, 0];
		pose.neck2 = [0, 0.25 * look, 0];
		pose.head = [0.05 - 0.1 * up, 0.35 * look, 0.08 * look];
		if (j.jaw) pose.jaw = [0.04 * Math.max(0, Math.sin(t * 7)), 0.03 * Math.sin(t * 3.5), 0];
		legs(q, pose, null, null, 0);
		return pose;
	};
	moves.alert = (t) => {
		const pose = stand(t);
		const look = wander(t, 2.2, seed + 4);
		pose.neck = [-0.25, 0.15 * look, 0];
		pose.neck2 = [-0.15, 0.15 * look, 0];
		pose.head = [0.25, 0.3 * look, 0];
		pose.earL = [-0.3, 0, 0];
		pose.earR = [-0.3, 0, 0];
		legs(q, pose, null, null, 0);
		return pose;
	};
	moves.graze = (t) => {
		const pose = stand(t);
		// the forefeet set a little apart and forward, the body leaning to them, the mouth down in the grass
		const shift = wander(t, 5, seed + 5);
		pose.body = [0.06, 0.04 * shift, 0];
		pose.chest = [0.05, 0, 0];
		const headLen = Math.hypot(j.muzzle[0] - j.head[0], j.muzzle[1] - j.head[1], j.muzzle[2] - j.head[2]);
		const bite = Math.max(0, Math.sin(t * 5.5)) ** 2;
		const look = new THREE.Vector3(0.15 * shift, -1, 0.45).normalize();
		// the muzzle just off the ground, a little ahead of the forefeet
		const mouth = new THREE.Vector3(0.05 * shift, 0.012 + 0.015 * bite, j.fore[4][2] + headLen * 0.35);
		headTo(q, pose, mouth.addScaledVector(look, -headLen), look);
		if (j.jaw) pose.jaw = [0.12 * bite, 0.04 * Math.sin(t * 5.5), 0];
		legs(q, pose, null, null, 0, { FL: { z: 0.02 }, FR: { z: -0.02 } });
		return pose;
	};
	return moves;
}
