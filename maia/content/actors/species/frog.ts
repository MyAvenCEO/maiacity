/*
 * THE FROG — in three: an American bullfrog (Lithobates catesbeianus, olive-brown and mottled, its head green), a pale
 * green one, and the common frog (Rana temporaria: brown, smaller, the dark mask behind its eye). It sits as a frog
 * sits, its front held up on straight arms, its long hind legs folded in a Z beside its body — thigh forward, shin
 * back, the long ankle forward again — and it hops by unfolding them all at once: a crouch, the legs thrown out
 * straight behind it, an arc through the air, a landing on its hands, the legs drawn in again. Its throat pulses as it
 * breathes and swells into a sac as it croaks; its eyes are gold with a frog's level bar of a pupil.
 *
 * The world moves a frog steadily; the hop takes it forward only while it is in the air, so it sits still on the
 * ground between: its own body is held back as the world carries it on, and thrown forward when it leaps.
 *
 * Measures: a bullfrog's body is 10–15 cm; a hop of 0.3–0.6 m, the leap itself a third of a second.
 */
import * as THREE from 'three';
import { limb, rig, type BoneSpec, type Cast, type Clip, type PartSpec, type Pose, type V3 } from '../rig';
import { sculpt, mix, ramp, type Surface } from '../sculpt';
import { animalMaterials, eyes } from '../features';
import { clamp, frac, onTheSpot, point, skeleton, smooth } from '../motion';
import { fbm3, wander } from '../noise';

export type FrogKind = 'bullfrog' | 'green' | 'common';
export const FROG_KINDS: FrogKind[] = ['bullfrog', 'green', 'common'];

const SIDES = [['L', 1], ['R', -1]] as const;

export function frog(kind: FrogKind = 'bullfrog'): Cast {
	const k = kind === 'common' ? 0.7 : 1;
	const P = (x: number, y: number, z: number): V3 => [x * k, y * k, z * k];
	// the left limbs: shoulder, elbow, wrist, the fingers' tip; hip, knee, ankle, the foot's joint, the toes' tip
	const arm = [P(0.024, 0.032, 0.03), P(0.034, 0.016, 0.042), P(0.03, 0.005, 0.058), P(0.036, 0, 0.074)];
	const leg = [P(0.018, 0.03, -0.042), P(0.052, 0.022, 0.0), P(0.036, 0.012, -0.056), P(0.05, 0.005, -0.014), P(0.068, 0, 0.026)];
	const m = (p: V3, x: number): V3 => [p[0] * x, p[1], p[2]];
	const bones: BoneSpec[] = [
		{ name: 'body', at: P(0, 0.035, -0.005) },
		{ name: 'head', parent: 'body', at: P(0, 0.042, 0.035) },
		{ name: 'throat', parent: 'head', at: P(0, 0.022, 0.05) },
		...SIDES.flatMap(([s, x]): BoneSpec[] => [
			{ name: `arm${s}`, parent: 'body', at: m(arm[0]!, x) },
			{ name: `forearm${s}`, parent: `arm${s}`, at: m(arm[1]!, x) },
			{ name: `hand${s}`, parent: `forearm${s}`, at: m(arm[2]!, x) },
			{ name: `thigh${s}`, parent: 'body', at: m(leg[0]!, x) },
			{ name: `shin${s}`, parent: `thigh${s}`, at: m(leg[1]!, x) },
			{ name: `tarsus${s}`, parent: `shin${s}`, at: m(leg[2]!, x) },
			{ name: `foot${s}`, parent: `tarsus${s}`, at: m(leg[3]!, x) }
		])
	];
	const sk = skeleton(bones);
	const s = sculpt(bones);
	// the body a pear, low behind and raised in front; the wide flat head; the throat under it
	s.egg(P(0, 0.034, -0.012), [0.034 * k, 0.024 * k, 0.05 * k], { bone: 'body', tag: 'back' }, [-0.25, 0, 0]);
	s.egg(P(0, 0.042, 0.04), [0.032 * k, 0.018 * k, 0.034 * k], { bone: 'head', k: 0.018 * k, tag: 'head' }, [-0.1, 0, 0]);
	s.egg(P(0, 0.026, 0.045), [0.026 * k, 0.012 * k, 0.026 * k], { bone: 'throat', k: 0.012 * k, tag: 'belly' });
	s.egg(P(0, 0.024, -0.005), [0.03 * k, 0.014 * k, 0.04 * k], { bone: 'body', k: 0.015 * k, tag: 'belly' });
	// the bulging eyes' lids
	for (const [, x] of SIDES) s.ball(P(x * 0.017, 0.054, 0.046), 0.0105 * k, { bone: 'head', k: 0.008 * k, tag: 'head' });
	for (const [side, x] of SIDES) {
		const a = arm.map((p) => m(p, x)), l = leg.map((p) => m(p, x));
		s.cone(a[0]!, a[1]!, 0.007 * k, 0.0055 * k, { bone: `arm${side}`, k: 0.006 * k, tag: 'limb' });
		s.cone(a[1]!, a[2]!, 0.0055 * k, 0.0045 * k, { bone: `forearm${side}`, k: 0.004 * k, tag: 'limb' });
		// the thigh thick with the muscle that throws it, the shin, the long ankle
		s.cone(l[0]!, l[1]!, 0.013 * k, 0.009 * k, { bone: `thigh${side}`, k: 0.01 * k, tag: 'limb' });
		s.cone(l[1]!, l[2]!, 0.008 * k, 0.0055 * k, { bone: `shin${side}`, k: 0.006 * k, tag: 'limb' });
		s.cone(l[2]!, l[3]!, 0.0048 * k, 0.004 * k, { bone: `tarsus${side}`, k: 0.004 * k, tag: 'limb' });
	}

	const look = {
		bullfrog: { back: '#5e6a32', head: '#6f8a3a', spots: '#3a3a22', belly: '#e8e0b8' },
		green: { back: '#7a9a42', head: '#8fb04a', spots: '#4a5e2a', belly: '#efe8c4' },
		common: { back: '#8a7048', head: '#8a7048', spots: '#3a2c1e', belly: '#e6d8b8' }
	}[kind];
	const back = new THREE.Color(look.back), head = new THREE.Color(look.head), belly = new THREE.Color(look.belly);
	const paint = (c: THREE.Color, at: Surface) => {
		const { p, n } = at;
		c.copy(back).lerp(head, at.tag('head'));
		// mottled, the mottles in bands across the legs
		const blot = fbm3(p.x * 110 / k, p.y * 110 / k, p.z * 110 / k, 3, 17);
		mix(c, look.spots, ramp(blot, 0.15, 0.3) * (at.tag('limb') ? 1 : 0.8));
		mix(c, belly, Math.max(at.tag('belly') * ramp(-n.y, -0.2, 0.3), ramp(-n.y, 0.4, 0.8)));
		// the common frog's dark mask from the eye back over the eardrum
		if (kind === 'common' && at.main === 'head') mix(c, '#3a2a1c', ramp(n.x * Math.sign(p.x), 0.5, 0.8) * ramp(0.045 * k, 0.035 * k, p.y) * ramp(p.z, 0.02 * k, 0.03 * k));
		// the eardrum, a disc behind the eye
		const ear = Math.hypot(Math.abs(p.x) - 0.026 * k, p.y - 0.046 * k, p.z - 0.03 * k);
		if (at.main === 'head') mix(c, kind === 'bullfrog' ? '#4e5a2c' : '#6a5a3a', ramp(0.0075 * k, 0.006 * k, ear));
		c.multiplyScalar(0.95 + 0.08 * fbm3(p.x * 400, p.y * 400, p.z * 400, 2, 2));
	};
	const skin = s.skin(0.0026 * k, paint, `frog-${kind}`);

	const parts: PartSpec[] = [{ skin }];
	parts.push(...eyes(P(0.019, 0.058, 0.049), 0.0072 * k, [0.75, 0.55, 0.35], '#c9a23a', 'bar', 'head', { irisR: 0.82, pupilR: 0.42 }));
	// the hands' four fingers, the feet's five long webbed toes
	for (const [side, x] of SIDES) {
		const w = m(arm[2]!, x);
		for (const a of [-0.6, -0.2, 0.2, 0.6]) parts.push({ geo: limb(w, [w[0] + x * Math.sin(a + 0.4) * 0.014 * k, 0, w[2] + Math.cos(a + 0.4) * 0.014 * k], 0.0018 * k, 0.0022 * k, { seg: 5 }), color: look.back, bone: `hand${side}` });
		const f = m(leg[3]!, x);
		const web = new THREE.Shape();
		web.moveTo(0, 0);
		for (let i = 0; i <= 4; i++) {
			const a = -0.5 + i * 0.25;
			web.lineTo(Math.sin(a) * 0.04 * k, Math.cos(a) * 0.04 * k * (1 - Math.abs(i - 2.5) * 0.12));
			if (i < 4) web.lineTo(Math.sin(a + 0.125) * 0.03 * k, Math.cos(a + 0.125) * 0.03 * k);
		}
		web.lineTo(0, 0);
		const g = new THREE.ExtrudeGeometry(web, { depth: 0.0015 * k, bevelEnabled: false, curveSegments: 2 });
		g.rotateX(Math.PI / 2);
		g.rotateY(x * 0.5);
		g.translate(f[0], 0.003 * k, f[2]);
		parts.push({ geo: g, color: look.spots, bone: `foot${side}` });
	}

	const r = rig(bones, parts, animalMaterials(0.4, { metalness: 0.05 }));
	r.object.name = `frog-${kind}`;

	// at rest, every limb as built; thrown out, the arms forward and the legs straight out behind
	const restDir = (a: V3, b: V3) => new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
	const legSeg = (side: 'L' | 'R') => {
		const x = side === 'L' ? 1 : -1;
		const l = leg.map((p) => m(p, x));
		return { l, rest: [0, 1, 2, 3].map((i) => restDir(l[i]!, l[i + 1]!)), out: [new THREE.Vector3(x * 0.25, -0.15, -1), new THREE.Vector3(x * 0.15, -0.3, -1), new THREE.Vector3(x * 0.1, -0.35, -1), new THREE.Vector3(x * 0.05, -0.5, -1)].map((v) => v.normalize()) };
	};
	const legs = { L: legSeg('L'), R: legSeg('R') };
	const names = ['thigh', 'shin', 'tarsus', 'foot'];
	/** the hind legs thrown out by `e` (0: folded, 1: straight out behind) */
	const throwLegs = (pose: Pose, e: number) => {
		for (const [side] of SIDES) {
			const L = legs[side];
			names.forEach((n, i) => point(sk, pose, `${n}${side}`, L.l[i + 1]!, L.rest[i]!.clone().lerp(L.out[i]!, e).normalize()));
		}
	};
	// the throat swelling (a breath, a croak's sac)
	const throat = (big: number) => [0, 0, 0, 1 + big] as [number, number, number, number];
	const breathe = (t: number) => 0.12 * Math.max(0, Math.sin(t * 5.5));
	const idle: Clip = (t) => {
		const pose: Pose = { throat: throat(breathe(t)), head: [0.03 * wander(t, 5, 3), 0.08 * wander(t, 4, 7), 0], root: [0, 0.0006 * Math.sin(t * 5.5), 0] };
		throwLegs(pose, 0);
		return pose;
	};
	const croak: Clip = (t) => {
		const sac = Math.pow(Math.max(0, Math.sin(t * 3.2)), 2);
		const pose: Pose = { throat: throat(1.1 * sac), body: [-0.08 * sac, 0, 0], head: [-0.1 * sac, 0, 0] };
		throwLegs(pose, 0);
		return pose;
	};
	const L = 0.32 * k;
	const hop: Clip = (t, mo) => {
		const mm = onTheSpot(t, 0.4 * k, mo);
		const u = frac(mm.dist / L);
		// a crouch, the leap (its legs thrown out), the landing on its hands, the legs drawn in again
		const air = clamp((u - 0.12) / 0.4, 0, 1);
		const launch = smooth((u - 0.06) / 0.1) * (1 - smooth((u - 0.5) / 0.35));
		const height = Math.sin(Math.PI * air) * 0.09 * k;
		// held back on the ground as the world carries it, thrown forward through the air
		const z = L * (smooth(air) - u);
		const pose: Pose = {
			root: [0, height - 0.004 * k * Math.sin(Math.PI * clamp(u / 0.12, 0, 1)), z],
			body: [air > 0 && air < 1 ? -0.45 * Math.sin(Math.PI * air) + 0.3 * smooth((air - 0.6) / 0.4) * (1 - smooth((u - 0.55) / 0.2)) : 0, 0, 0],
			throat: throat(0.05)
		};
		throwLegs(pose, launch);
		for (const [side, x] of SIDES) pose[`arm${side}`] = [-0.6 * Math.sin(Math.PI * air), x * 0.2 * Math.sin(Math.PI * air), 0];
		return pose;
	};
	return { rig: r, clips: { idle, croak, hop }, first: 'idle', gears: { hop: 0.4 * k } };
}
