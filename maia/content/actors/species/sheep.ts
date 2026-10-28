/*
 * THE SHEEP — a ewe of 0.7 m at the withers (Ovis aries), in five breeds: the whiteface (a Texel's white face and
 * pricked ears), the Suffolk (black face and legs, long black ears), the merino (a heavy crimped fleece down its legs
 * and over its brow), the black, and a ewe just shorn. Its fleece is sculpted lumpy, one skin from rump to poll; its
 * eyes are amber with the sheep's bar of a pupil, set wide on the sides of the head to watch all round while it grazes.
 *
 * Measures: a ewe stands 0.65–0.75 m at the withers, 1.0–1.2 m nose to rump; walks at 0.5–1 m/s with a stride of
 * about 0.6 m, each foot down for two thirds of it, the legs in the lateral sequence (hind left, fore left, hind right,
 * fore right).
 */
import * as THREE from 'three';
import { egg, rig, spike, type Cast, type PartSpec, type V3 } from '../rig';
import { sculpt, mix, ramp, type Surface } from '../sculpt';
import { animalMaterials, eyes } from '../features';
import { quadMoves, quadSkeleton, LEGS, type QuadJoints } from '../plans/quadruped';
import { fbm3 } from '../noise';

export type SheepBreed = 'whiteface' | 'suffolk' | 'merino' | 'black' | 'shorn';
export const SHEEP_BREEDS: SheepBreed[] = ['whiteface', 'suffolk', 'merino', 'black', 'shorn'];

type Look = { wool: string; face: string; legs: string; nose: string; depth: number; lumps: number; ears: 'pricked' | 'long' | 'short'; woolFace: number; woolLegs: number };
const LOOK: Record<SheepBreed, Look> = {
	whiteface: { wool: '#ece6d6', face: '#efe7dc', legs: '#e8dfd2', nose: '#c9a59a', depth: 1, lumps: 0.032, ears: 'pricked', woolFace: 0.15, woolLegs: 0 },
	suffolk: { wool: '#ebe4d2', face: '#211c19', legs: '#1f1a17', nose: '#151210', depth: 1, lumps: 0.032, ears: 'long', woolFace: 0, woolLegs: 0 },
	merino: { wool: '#e6dcc6', face: '#efe6da', legs: '#ebe2d6', nose: '#d3b3a5', depth: 1.25, lumps: 0.028, ears: 'short', woolFace: 1, woolLegs: 1 },
	black: { wool: '#2e2925', face: '#1d1916', legs: '#1d1916', nose: '#120f0d', depth: 1, lumps: 0.032, ears: 'pricked', woolFace: 0.15, woolLegs: 0 },
	shorn: { wool: '#e9e0cc', face: '#ece3d7', legs: '#e6dccf', nose: '#c8a194', depth: 0.25, lumps: 0.02, ears: 'pricked', woolFace: 0, woolLegs: 0 }
};

const J: QuadJoints = {
	body: [0, 0.6, -0.02],
	chest: [0, 0.6, 0.28],
	pelvis: [0, 0.62, -0.3],
	neck: [[0, 0.58, 0.38], [0, 0.74, 0.5]],
	head: [0, 0.88, 0.57],
	muzzle: [0, 0.74, 0.8],
	jaw: [0, 0.81, 0.6],
	ear: [[0.05, 0.905, 0.565], [0.15, 0.88, 0.52]],
	tail: [[0, 0.63, -0.5], [0, 0.55, -0.56], [0, 0.46, -0.58], [0, 0.38, -0.58]],
	fore: [[0.1, 0.5, 0.32], [0.1, 0.35, 0.25], [0.09, 0.2, 0.29], [0.09, 0.065, 0.3], [0.09, 0, 0.355]],
	hind: [[0.1, 0.56, -0.3], [0.11, 0.4, -0.2], [0.1, 0.23, -0.38], [0.09, 0.065, -0.35], [0.09, 0, -0.3]]
};

/** `moves`: the body plan's way of moving it (an older version's, for the Actors gallery's history) */
export function sheep(breed: SheepBreed = 'suffolk', moves: typeof quadMoves = quadMoves): Cast {
	const L = LOOK[breed];
	const q = quadSkeleton(J);
	const w = L.depth; // how much fleece over the body (1: a year's)
	const s = sculpt(q.bones);
	const wool = { tag: 'wool', bump: 0.008 + 0.014 * w, lumps: L.lumps };
	// the body: a barrel of ribs under the fleece, the rump and the shoulders in it
	s.egg([0, 0.6, -0.02], [0.15 + 0.08 * w, 0.17 + 0.07 * w, 0.38 + 0.08 * w], { chain: ['pelvis', 'body', 'chest'], ...wool });
	s.egg([0, 0.61, -0.29], [0.15 + 0.07 * w, 0.16 + 0.07 * w, 0.16 + 0.06 * w], { bone: 'pelvis', k: 0.08, ...wool });
	s.egg([0, 0.58, 0.27], [0.14 + 0.07 * w, 0.17 + 0.06 * w, 0.15 + 0.06 * w], { bone: 'chest', k: 0.08, ...wool });
	s.egg([0, 0.5 - 0.02 * w, -0.02], [0.13 + 0.05 * w, 0.09 + 0.04 * w, 0.3], { chain: ['pelvis', 'body', 'chest'], k: 0.1, ...wool });
	// the neck, thick with fleece, and the poll
	s.cone([0, 0.6, 0.34], [0, 0.78, 0.52], 0.09 + 0.06 * w, 0.05 + 0.03 * w, { chain: ['neck', 'neck2'], k: 0.07, ...wool });
	// the head: the skull, the face down to the muzzle, the jaw
	const face = { bone: 'head', tag: 'face', k: 0.035 };
	s.egg([0, 0.865, 0.6], [0.062, 0.07, 0.08], face);
	s.egg([0, 0.812, 0.68], [0.052, 0.062, 0.13], face, [0.62, 0, 0]);
	s.egg([0, 0.757, 0.765], [0.043, 0.045, 0.058], { ...face, tag: 'nose', k: 0.025 }, [0.62, 0, 0]);
	s.egg([0, 0.775, 0.69], [0.04, 0.03, 0.08], { bone: 'jaw', tag: 'face', k: 0.02 }, [0.5, 0, 0]);
	// a merino's fleece over its brow and cheeks
	if (L.woolFace > 0.5) s.egg([0, 0.885, 0.59], [0.078, 0.062, 0.072], { bone: 'head', k: 0.04, ...wool, bump: 0.012 });
	// the legs: the forearm and the gaskin in the fleece, bone and tendon below
	for (const leg of LEGS) {
		const side = leg[1] === 'L' ? 1 : -1;
		const p = (leg[0] === 'F' ? J.fore : J.hind).map((v) => [v[0] * side, v[1], v[2]] as V3);
		const fleece = L.woolLegs > 0.5 ? { ...wool, bump: 0.012 } : { tag: 'leg' };
		if (leg[0] === 'F') s.cone([p[0]![0] * 0.9, p[0]![1] + 0.04, p[0]![2]], p[1]!, 0.07 + 0.02 * w, 0.05, { bone: `upper${leg}`, k: 0.06, ...wool });
		else s.egg([p[0]![0] * 1.05, 0.48, -0.26], [0.085 + 0.03 * w, 0.13 + 0.02 * w, 0.11 + 0.02 * w], { bone: `upper${leg}`, k: 0.07, ...wool });
		s.cone(p[1]!, p[2]!, leg[0] === 'F' ? 0.034 : 0.04, 0.024, { bone: `lower${leg}`, k: 0.03, ...(leg[0] === 'H' ? wool : fleece), ...(leg[0] === 'H' ? { bump: 0.004 + 0.006 * w } : {}) });
		s.cone(p[2]!, p[3]!, 0.022, 0.017, { bone: `cannon${leg}`, k: 0.02, ...fleece });
		s.cone(p[3]!, [p[4]![0], 0.03, (p[3]![2] + p[4]![2]) / 2], 0.018, 0.019, { bone: `foot${leg}`, k: 0.012, tag: 'leg' });
	}
	// the tail, docked short in the fleece
	s.cone(J.tail[0]!, J.tail[2]!, 0.05 + 0.02 * w, 0.035, { chain: q.tail.slice(0, 2), k: 0.05, ...wool });

	const woolC = new THREE.Color(L.wool), faceC = new THREE.Color(L.face), legC = new THREE.Color(L.legs), noseC = new THREE.Color(L.nose);
	const dirt = new THREE.Color('#b5a387'), t1 = new THREE.Color(), t2 = new THREE.Color();
	const paint = (c: THREE.Color, at: Surface) => {
		const { p, n } = at;
		// the fleece: a little darker in its crevices and underneath, dirty toward the belly and the legs
		const crimp = fbm3(p.x * 30, p.y * 30, p.z * 30, 2, 3);
		t1.copy(woolC).multiplyScalar(0.92 + 0.1 * crimp);
		mix(t1, dirt, 0.35 * ramp(-n.y, -0.1, 0.8) * (L.wool === LOOK.black.wool ? 0.2 : 1) + 0.25 * ramp(0.42 - p.y, 0, 0.2));
		// the face and legs mottled faintly
		t2.copy(at.main === 'nose' ? noseC : at.main === 'leg' ? legC : faceC).multiplyScalar(0.95 + 0.08 * fbm3(p.x * 60, p.y * 60, p.z * 60, 2, 4));
		// the fleece's edge crisp, as it is where the face's short hair starts
		const wv = ramp(at.tag('wool'), 0.3, 0.7);
		c.copy(t2).lerp(t1, wv);
	};
	const skin = s.skin(0.015, paint, `sheep-${breed}`);

	const parts: PartSpec[] = [{ skin }];
	// the ears: a Suffolk's long and drooping, a whiteface's pricked out sideways, a merino's short in the wool
	const earLen = L.ears === 'long' ? 0.12 : L.ears === 'pricked' ? 0.095 : 0.07;
	/** a dark-faced breed's ears are dark inside too */
	const dark = new THREE.Color(L.face).getHSL({ h: 0, s: 0, l: 0 }).l < 0.3;
	const droop = L.ears === 'long' ? -0.75 : -0.15;
	for (const [side, x] of [['L', 1], ['R', -1]] as const) {
		const base: V3 = [x * 0.05, 0.9, 0.565];
		const tip = new THREE.Vector3(x, droop, -0.25).normalize().multiplyScalar(earLen);
		parts.push({ geo: egg([base[0] + tip.x * 0.5, base[1] + tip.y * 0.5, base[2] + tip.z * 0.5], [earLen * 0.5, 0.012, 0.03], [0, x * -0.25, Math.atan2(tip.y, Math.abs(tip.x)) * x]), color: L.face, bone: `ear${side}` });
		parts.push({ geo: egg([base[0] + tip.x * 0.52, base[1] + tip.y * 0.52 + 0.004, base[2] + tip.z * 0.52 + 0.006], [earLen * 0.42, 0.006, 0.022], [0, x * -0.25, Math.atan2(tip.y, Math.abs(tip.x)) * x]), color: dark ? '#3a2f2a' : '#d9b3a6', bone: `ear${side}` });
	}
	parts.push(...eyes([0.054, 0.855, 0.648], 0.0145, [0.85, 0.12, 0.45], '#b8862e', 'bar'));
	// the hooves: two toes each, dark horn
	for (const leg of LEGS) {
		const side = leg[1] === 'L' ? 1 : -1;
		const toe = (leg[0] === 'F' ? J.fore : J.hind)[4];
		for (const dx of [-0.011, 0.011]) parts.push({ geo: egg([toe[0] * side + dx, 0.017, toe[2] - 0.017], [0.012, 0.018, 0.026], [-0.25, 0, 0]), color: '#2b2622', bone: `foot${leg}` });
	}
	parts.push({ geo: spike([0, 0.745, 0.815], [0, -0.4, 1], 0.004, 0.004), color: L.nose, bone: 'head' });

	const r = rig(q.bones, parts, animalMaterials(0.95));
	r.object.name = `sheep-${breed}`;
	const clips = moves(q, {
		seed: SHEEP_BREEDS.indexOf(breed) + 11,
		gaits: {
			walk: { speed: 0.6, stride: 0.62, duty: 0.68, feet: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, lift: 0.07, bob: 0.012, roll: 0.025, pitch: 0.012, tilt: 0.35, fold: [1.0, 0.45], flip: 0.7, nod: 0.05, flex: 0.02 },
			trot: { speed: 1.6, stride: 1.1, duty: 0.42, feet: { HL: 0, FR: 0, FL: 0.5, HR: 0.5 }, lift: 0.09, bob: 0.025, roll: 0.02, pitch: 0.015, tilt: 0.5, fold: [1.4, 0.7], flip: 1.0, nod: 0.03, flex: 0.03 }
		},
		tail: { sway: 0.12, carry: 0.3, hz: 1.4 },
		ears: L.ears === 'long' ? 0.25 : 0.45
	});
	return { rig: r, clips, first: 'graze', gears: { walk: 0.6, trot: 1.6 }, feet: LEGS.map((l) => `foot${l}`) };
}
