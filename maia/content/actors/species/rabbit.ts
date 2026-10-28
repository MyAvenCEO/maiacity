/*
 * THE RABBIT — a domestic rabbit of 2–3 kg (Oryctolagus cuniculus), in six coats: the wild agouti (grey-brown ticked,
 * white underneath, the tail white below), the Dutch (white blaze, collar and forefeet, the rest black), the lop (fawn,
 * its ears hanging), the white (pink-eyed), the black and the fawn. It sits as rabbits do, hunched, the long hind feet
 * flat on the ground and the haunches round; it hops in a half-bound, both hind feet landing together ahead of where
 * the forefeet came down, the back arching and stretching with each.
 *
 * Measures: about 0.4 m long, 0.2 m high sitting; a lazy hop is 0.25–0.35 m, two to three a second.
 */
import * as THREE from 'three';
import { egg, rig, type Cast, type PartSpec, type V3 } from '../rig';
import { sculpt, mix, ramp, type Surface } from '../sculpt';
import { animalMaterials, eyes } from '../features';
import { quadMoves, quadSkeleton, LEGS, type QuadJoints } from '../plans/quadruped';
import { fbm3 } from '../noise';

export type RabbitCoat = 'wild' | 'dutch' | 'lop' | 'white' | 'black' | 'fawn';
export const RABBIT_COATS: RabbitCoat[] = ['wild', 'dutch', 'lop', 'white', 'black', 'fawn'];

type Look = { coat: string; belly: string; iris: string; lop: boolean };
const LOOK: Record<RabbitCoat, Look> = {
	wild: { coat: '#86705a', belly: '#e9e2d6', iris: '#3a2416', lop: false },
	dutch: { coat: '#22201f', belly: '#f2efe9', iris: '#2a1a10', lop: false },
	lop: { coat: '#c99a63', belly: '#ecdcc2', iris: '#3a2416', lop: true },
	white: { coat: '#f3f0ea', belly: '#f6f3ee', iris: '#c8505a', lop: false },
	black: { coat: '#1f1c1b', belly: '#2c2826', iris: '#2a1a10', lop: false },
	fawn: { coat: '#d4ab78', belly: '#efe3cf', iris: '#4a2a14', lop: false }
};

const J: QuadJoints = {
	body: [0, 0.118, -0.02],
	chest: [0, 0.11, 0.06],
	pelvis: [0, 0.12, -0.085],
	neck: [[0, 0.115, 0.085], [0, 0.145, 0.105]],
	head: [0, 0.172, 0.118],
	muzzle: [0, 0.148, 0.2],
	jaw: [0, 0.152, 0.13],
	ear: [[0.018, 0.2, 0.112], [0.03, 0.3, 0.07]],
	tail: [[0, 0.105, -0.15], [0, 0.115, -0.175], [0, 0.12, -0.19]],
	fore: [[0.032, 0.088, 0.07], [0.034, 0.052, 0.05], [0.03, 0.02, 0.074], [0.03, 0.008, 0.086], [0.03, 0, 0.106]],
	hind: [[0.038, 0.1, -0.088], [0.05, 0.072, -0.02], [0.045, 0.014, -0.135], [0.045, 0.009, -0.045], [0.045, 0, -0.018]]
};

/** `moves`: the body plan's way of moving it (an older version's, for the Actors gallery's history) */
export function rabbit(coat: RabbitCoat = 'wild', moves: typeof quadMoves = quadMoves): Cast {
	const L = LOOK[coat];
	const q = quadSkeleton(J);
	const s = sculpt(q.bones);
	const fur = { tag: 'fur' };
	// a round back, the haunches, the chest
	s.egg([0, 0.112, -0.035], [0.066, 0.072, 0.118], { chain: ['pelvis', 'body', 'chest'], ...fur }, [-0.12, 0, 0]);
	s.egg([0, 0.095, 0.055], [0.05, 0.058, 0.055], { bone: 'chest', k: 0.03, ...fur });
	for (const x of [-1, 1]) s.egg([x * 0.042, 0.085, -0.075], [0.04, 0.058, 0.068], { bone: `upperH${x > 0 ? 'L' : 'R'}`, k: 0.035, ...fur });
	s.egg([0, 0.06, -0.02], [0.05, 0.035, 0.08], { chain: ['pelvis', 'body', 'chest'], k: 0.04, tag: 'belly' });
	// the neck hidden in the ruff, the head: the skull, the cheeks, the muzzle split under the nose
	s.cone([0, 0.115, 0.075], [0, 0.155, 0.112], 0.042, 0.036, { chain: ['neck', 'neck2'], k: 0.03, ...fur });
	const head = { bone: 'head', k: 0.018, tag: 'fur' };
	s.egg([0, 0.172, 0.132], [0.038, 0.04, 0.052], head, [0.3, 0, 0]);
	for (const x of [-1, 1]) s.egg([x * 0.024, 0.153, 0.148], [0.024, 0.026, 0.03], head);
	s.egg([0, 0.152, 0.178], [0.022, 0.022, 0.026], { ...head, tag: 'muzzle', k: 0.014 });
	s.egg([0, 0.138, 0.162], [0.018, 0.012, 0.025], { bone: 'jaw', k: 0.01, tag: 'belly' });
	// the legs: slim forelegs, and the long hind feet flat on the ground
	for (const leg of LEGS) {
		const side = leg[1] === 'L' ? 1 : -1;
		const p = (leg[0] === 'F' ? J.fore : J.hind).map((v) => [v[0] * side, v[1], v[2]] as V3);
		if (leg[0] === 'F') {
			s.cone([p[0]![0], p[0]![1] + 0.01, p[0]![2]], p[1]!, 0.018, 0.012, { bone: `upper${leg}`, k: 0.015, ...fur });
			s.cone(p[1]!, p[2]!, 0.01, 0.008, { bone: `lower${leg}`, k: 0.008, tag: 'paw' });
			s.cone(p[2]!, p[4]!, 0.0085, 0.009, { bone: `foot${leg}`, k: 0.006, tag: 'paw' });
		} else {
			s.cone(p[1]!, p[2]!, 0.018, 0.011, { bone: `lower${leg}`, k: 0.02, ...fur });
			s.cone(p[2]!, p[3]!, 0.012, 0.011, { bone: `cannon${leg}`, k: 0.01, tag: 'paw' });
			s.cone(p[3]!, p[4]!, 0.011, 0.01, { bone: `foot${leg}`, k: 0.008, tag: 'paw' });
		}
	}
	// the tail: a white puff
	s.ball([0, 0.118, -0.16], 0.022, { chain: q.tail.slice(0, 1), k: 0.015, tag: 'tail' });

	const base = new THREE.Color(L.coat), belly = new THREE.Color(L.belly), t = new THREE.Color();
	const paint = (c: THREE.Color, at: Surface) => {
		const { p, n } = at;
		c.copy(base);
		if (coat === 'wild') {
			// agouti: each hair banded, the coat ticked light and dark, darker along the back
			c.multiplyScalar(0.85 + 0.3 * fbm3(p.x * 160, p.y * 160, p.z * 160, 2, 7));
			mix(c, '#5d4a39', 0.4 * ramp(n.y, 0.5, 0.95));
		} else c.multiplyScalar(0.94 + 0.08 * fbm3(p.x * 60, p.y * 60, p.z * 60, 2, 7));
		// the belly, the chin and the tail's underside light
		const under = Math.max(ramp(-n.y, 0.2, 0.7) * ramp(0.09, 0.06, p.y), at.tag('belly'), at.tag('tail') * ramp(0.2, -0.5, n.y));
		t.copy(belly);
		c.lerp(t, under * (coat === 'black' ? 0.25 : 0.9));
		if (coat === 'dutch') {
			// the white blaze up the face, the collar and chest, the forefeet; the hind feet white
			const front = ramp(p.z, 0.04, 0.07) * (1 - at.tag('fur') * ramp(0.02, 0.035, Math.abs(p.x)) * ramp(p.y, 0.14, 0.16) * ramp(0.16, 0.13, p.z));
			const blaze = at.tag('muzzle') + ramp(0.012, 0.004, Math.abs(p.x)) * ramp(p.z, 0.14, 0.16);
			mix(c, belly, Math.max(front, blaze, at.tag('paw')));
		}
		if (at.main === 'muzzle') mix(c, belly, 0.4);
	};
	const skin = s.skin(0.0056, paint, `rabbit-${coat}`);

	const parts: PartSpec[] = [{ skin }];
	// the ears: tall and turning, or a lop's hanging beside its face
	for (const [side, x] of [['L', 1], ['R', -1]] as const) {
		const base3: V3 = [x * 0.018, 0.2, 0.112];
		const len = L.lop ? 0.12 : 0.105;
		const dir = L.lop ? new THREE.Vector3(x * 0.55, -1, 0.1).normalize() : new THREE.Vector3(x * 0.18, 1, -0.35).normalize();
		const mid = new THREE.Vector3(...base3).addScaledVector(dir, len * 0.5);
		const q4 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
		const rot = new THREE.Euler().setFromQuaternion(q4);
		const out = egg([mid.x, mid.y, mid.z], [0.024, len * 0.5, 0.008], [rot.x, rot.y, rot.z]);
		const inner = egg([mid.x + dir.z * 0, mid.y, mid.z + (L.lop ? 0 : 0.004)], [0.016, len * 0.43, 0.006], [rot.x, rot.y, rot.z]);
		const tip = coat === 'wild' ? '#4a3a2c' : L.coat;
		parts.push({ geo: out, color: (pp) => (pp.distanceTo(new THREE.Vector3(...base3)) > len * 0.85 ? tip : L.coat), bone: `ear${side}` });
		parts.push({ geo: inner, color: coat === 'black' || coat === 'dutch' ? '#3a2f2c' : '#e2b4a8', bone: `ear${side}` });
	}
	parts.push(...eyes([0.034, 0.176, 0.148], 0.0085, [0.9, 0.18, 0.35], L.iris, 'round', 'head', { irisR: 0.82, pupilR: 0.5 }));
	parts.push({ geo: egg([0, 0.158, 0.2], [0.006, 0.004, 0.003]), color: '#c98f86', bone: 'head' });

	const r = rig(q.bones, parts, animalMaterials(0.9));
	r.object.name = `rabbit-${coat}`;
	const clips = moves(q, {
		seed: RABBIT_COATS.indexOf(coat) + 31,
		gaits: {
			// a lazy half-bound: the hind feet together, landing ahead of where the forefeet came down
			hop: { speed: 0.55, stride: 0.3, duty: 0.32, feet: { FL: 0, FR: 0.08, HL: 0.42, HR: 0.45 }, lift: 0.035, bob: 0.03, roll: 0, pitch: 0.12, tilt: 0.7, fold: [0.6, 0.35], flip: 0.6, nod: 0.03, flex: 0.18, bobs: 1 }
		},
		tail: { sway: 0.05, carry: -0.2, hz: 2 },
		ears: L.lop ? 0.15 : 0.6
	});
	return { rig: r, clips, first: 'idle', gears: { hop: 0.55 }, feet: LEGS.map((l) => `foot${l}`) };
}
