/*
 * THE GOAT — a dairy doe of 0.75 m at the withers (Capra hircus), in five breeds: the Saanen (white, hornless), the
 * Alpine (bay with a black stripe down its back, black legs and face stripes), a pied one (white in patches of brown
 * and black), the Nubian (red-tan, a Roman nose, long hanging ears) and the Boer (white with a red-brown head, heavy,
 * horns sweeping back). Leaner than a sheep and all angles — the withers, the hip bones and the pins show under its
 * short coat, the rumen rounds its belly — with a beard, an upright tail that flicks, and the goat's pale golden eye
 * with its bar of a pupil.
 *
 * Measures: a doe stands 0.7–0.8 m at the withers; walks at 0.6–1 m/s with a stride of about 0.7 m, two thirds of it
 * on each foot, in the lateral sequence.
 */
import * as THREE from 'three';
import { egg, limb, rig, spike, type Cast, type PartSpec, type V3 } from '../rig';
import { sculpt, mix, ramp, type Surface } from '../sculpt';
import { animalMaterials, eyes } from '../features';
import { quadMoves, quadSkeleton, LEGS, type QuadJoints } from '../plans/quadruped';
import { fbm3 } from '../noise';

export type GoatBreed = 'saanen' | 'alpine' | 'pied' | 'nubian' | 'boer';
export const GOAT_BREEDS: GoatBreed[] = ['saanen', 'alpine', 'pied', 'nubian', 'boer'];

type Look = { coat: string; dark: string; nose: string; horns: boolean; ears: 'up' | 'long'; beard: boolean; heavy: number };
const LOOK: Record<GoatBreed, Look> = {
	saanen: { coat: '#efe9dc', dark: '#d8cfbf', nose: '#d9b2a2', horns: false, ears: 'up', beard: true, heavy: 0 },
	alpine: { coat: '#8a5a33', dark: '#1f1a17', nose: '#2a2420', horns: true, ears: 'up', beard: true, heavy: 0 },
	pied: { coat: '#ece5d6', dark: '#5a3a24', nose: '#3a2c24', horns: true, ears: 'up', beard: true, heavy: 0 },
	nubian: { coat: '#9a6238', dark: '#4a2d1c', nose: '#3a2a22', horns: false, ears: 'long', beard: false, heavy: 0.3 },
	boer: { coat: '#f0eadf', dark: '#8e4a26', nose: '#5a3a2c', horns: true, ears: 'long', beard: true, heavy: 1 }
};

const J: QuadJoints = {
	body: [0, 0.66, -0.02],
	chest: [0, 0.66, 0.27],
	pelvis: [0, 0.7, -0.3],
	neck: [[0, 0.62, 0.39], [0, 0.8, 0.49]],
	head: [0, 0.96, 0.555],
	muzzle: [0, 0.81, 0.78],
	jaw: [0, 0.9, 0.59],
	ear: [[0.045, 0.985, 0.55], [0.15, 0.97, 0.52]],
	tail: [[0, 0.73, -0.44], [0, 0.79, -0.47], [0, 0.85, -0.48]],
	fore: [[0.09, 0.56, 0.31], [0.09, 0.4, 0.24], [0.085, 0.22, 0.285], [0.085, 0.07, 0.295], [0.085, 0, 0.345]],
	hind: [[0.09, 0.62, -0.32], [0.1, 0.45, -0.22], [0.09, 0.26, -0.4], [0.085, 0.07, -0.37], [0.085, 0, -0.32]]
};

/** `moves`: the body plan's way of moving it (an older version's, for the Actors gallery's history) */
export function goat(breed: GoatBreed = 'saanen', moves: typeof quadMoves = quadMoves): Cast {
	const L = LOOK[breed];
	const q = quadSkeleton(J);
	const s = sculpt(q.bones);
	const hv = L.heavy;
	const coat = { tag: 'coat' };
	// the trunk: the ribs, the rumen's round belly, the brisket, the bony withers, the hip bones and the pins
	s.egg([0, 0.635, -0.02], [0.14 + 0.02 * hv, 0.16, 0.35], { chain: ['pelvis', 'body', 'chest'], ...coat });
	s.egg([0, 0.55, -0.05], [0.15 + 0.02 * hv, 0.12, 0.25], { chain: ['pelvis', 'body', 'chest'], k: 0.1, ...coat });
	s.egg([0, 0.6, 0.27], [0.11 + 0.02 * hv, 0.15, 0.12], { bone: 'chest', k: 0.07, ...coat });
	s.egg([0, 0.725, 0.22], [0.06, 0.05, 0.13], { bone: 'chest', k: 0.06, tag: 'back' });
	for (const x of [-1, 1]) s.egg([x * 0.085, 0.745, -0.25], [0.04, 0.035, 0.05], { bone: 'pelvis', k: 0.05, tag: 'back' });
	s.egg([0, 0.7, -0.34], [0.1 + 0.02 * hv, 0.1, 0.11], { bone: 'pelvis', k: 0.07, ...coat }, [-0.3, 0, 0]);
	// the neck, long and lean, and its dewlap of muscle under it
	s.cone([0, 0.64, 0.35], [0, 0.88, 0.52], 0.085 + 0.015 * hv, 0.055, { chain: ['neck', 'neck2'], k: 0.06, tag: 'neck' });
	// the head: the skull, the long face (a Nubian's Roman-nosed), the muzzle, the jaw
	const face = { bone: 'head', k: 0.03, tag: 'face' };
	s.egg([0, 0.955, 0.585], [0.055, 0.058, 0.07], face);
	s.egg([0, 0.9, 0.665], [0.046, 0.052, 0.12], face, [0.78 - 0.08 * (breed === 'nubian' ? 1 : 0), 0, 0]);
	if (breed === 'nubian') s.egg([0, 0.905, 0.7], [0.03, 0.035, 0.09], face, [0.55, 0, 0]);
	s.egg([0, 0.835, 0.745], [0.035, 0.036, 0.052], { ...face, tag: 'nose', k: 0.025 }, [0.78, 0, 0]);
	s.egg([0, 0.855, 0.67], [0.032, 0.026, 0.075], { bone: 'jaw', tag: 'face', k: 0.02 }, [0.7, 0, 0]);
	// the legs: muscle above, bone and tendon below the knee and the hock
	for (const leg of LEGS) {
		const side = leg[1] === 'L' ? 1 : -1;
		const p = (leg[0] === 'F' ? J.fore : J.hind).map((v) => [v[0] * side, v[1], v[2]] as V3);
		if (leg[0] === 'F') s.cone([p[0]![0] * 0.9, p[0]![1] + 0.05, p[0]![2] - 0.01], p[1]!, 0.065 + 0.01 * hv, 0.042, { bone: `upper${leg}`, k: 0.06, ...coat });
		else s.egg([p[0]![0] * 1.05, 0.56, -0.27], [0.065 + 0.012 * hv, 0.12, 0.09], { bone: `upper${leg}`, k: 0.06, ...coat });
		s.cone(p[1]!, p[2]!, leg[0] === 'F' ? 0.03 : 0.038, 0.021, { bone: `lower${leg}`, k: 0.03, tag: 'leg' });
		s.cone(p[2]!, p[3]!, 0.019, 0.015, { bone: `cannon${leg}`, k: 0.018, tag: 'shin' });
		s.cone(p[3]!, [p[4]![0], 0.03, (p[3]![2] + p[4]![2]) / 2], 0.016, 0.017, { bone: `foot${leg}`, k: 0.01, tag: 'shin' });
	}
	s.cone(J.tail[0]!, J.tail[2]!, 0.024, 0.014, { chain: q.tail, k: 0.03, tag: 'tail' });

	const base = new THREE.Color(L.coat), dark = new THREE.Color(L.dark), nose = new THREE.Color(L.nose), light = base.clone().lerp(new THREE.Color('#ffffff'), 0.25);
	const paint = (c: THREE.Color, at: Surface) => {
		const { p, n } = at;
		c.copy(base).multiplyScalar(0.93 + 0.1 * fbm3(p.x * 18, p.y * 18, p.z * 18, 3, 2));
		// countershading: a shade darker along the back, lighter under the belly
		mix(c, light, 0.35 * ramp(-n.y, 0.2, 0.9));
		const below = (y: number) => ramp(y - p.y, -0.03, 0.03);
		if (breed === 'alpine') {
			// the chamoisée's black: a stripe down the spine, the belly, the legs below the knees, the face's two stripes
			const stripe = ramp(n.y, 0.75, 0.95) * ramp(0.05, 0.02, Math.abs(p.x)) * ramp(p.z, -0.45, -0.4);
			const face = at.tag('face') + at.tag('nose');
			const stripes = face * ramp(0.035, 0.015, Math.abs(Math.abs(p.x) - 0.03 + 0.15 * (p.z - 0.7)));
			mix(c, dark, Math.max(stripe, below(0.32), ramp(-n.y, 0.6, 0.9) * ramp(0.62, 0.55, p.y), stripes, at.tag('nose')));
		} else if (breed === 'pied') {
			const patch = fbm3(p.x * 4.5 + 3, p.y * 4.5, p.z * 4.5, 3, 9);
			mix(c, dark, ramp(patch, 0.05, 0.12));
			mix(c, '#1f1a17', ramp(fbm3(p.x * 6, p.y * 6 + 2, p.z * 6, 2, 13), 0.25, 0.3) * 0.9);
		} else if (breed === 'boer') {
			// white, the head and neck red-brown, a white blaze down the face
			const head = Math.max(at.tag('face') + at.tag('nose'), ramp(p.z, 0.47, 0.53) * ramp(p.y, 0.78, 0.84));
			const blaze = ramp(0.022, 0.01, Math.abs(p.x)) * ramp(n.y + n.z, 0.3, 0.8);
			mix(c, dark, head * (1 - blaze));
		} else if (breed === 'nubian') {
			mix(c, dark, 0.6 * ramp(n.y, 0.6, 0.95) * ramp(0.04, 0.0, Math.abs(p.x)) + 0.4 * below(0.2));
		}
		if (at.main === 'nose') mix(c, nose, 0.85);
		if (at.main === 'shin') c.multiplyScalar(0.92);
	};
	const skin = s.skin(0.013, paint, `goat-${breed}`);

	const parts: PartSpec[] = [{ skin }];
	// the ears: out sideways, or a Nubian's and a Boer's long and hanging
	for (const [side, x] of [['L', 1], ['R', -1]] as const) {
		const base3: V3 = [x * 0.045, 0.985, 0.55];
		const long = L.ears === 'long';
		const len = long ? 0.17 : 0.11;
		const dir = new THREE.Vector3(x * (long ? 0.35 : 1), long ? -1 : 0.05, long ? 0.15 : -0.1).normalize();
		const mid: V3 = [base3[0] + dir.x * len * 0.5, base3[1] + dir.y * len * 0.5, base3[2] + dir.z * len * 0.5];
		const tilt: V3 = long ? [0, 0, x * 0.35] : [0, x * 0.15, x * -0.05];
		const earGeo = long ? egg(mid, [0.016, len * 0.5, 0.045], tilt) : egg(mid, [len * 0.5, 0.012, 0.033], tilt);
		const earC = breed === 'boer' ? L.dark : breed === 'alpine' ? L.coat : L.coat;
		parts.push({ geo: earGeo, color: earC, bone: `ear${side}` });
	}
	parts.push(...eyes([0.047, 0.935, 0.625], 0.0135, [0.85, 0.15, 0.45], '#d9b44a', 'bar'));
	// horns: ridged, sweeping up and back from the poll
	if (L.horns) {
		for (const x of [-1, 1]) {
			const pts: V3[] = [];
			const sweep = breed === 'boer' ? 1.35 : 1;
			for (let i = 0; i <= 6; i++) {
				const t = i / 6, a = 0.25 + t * 1.6 * sweep;
				pts.push([x * (0.03 + 0.03 * t), 1.0 + 0.11 * Math.sin(a) * sweep, 0.565 - 0.1 * (1 - Math.cos(a)) * sweep]);
			}
			for (let i = 0; i < 6; i++) parts.push({ geo: limb(pts[i]!, pts[i + 1]!, 0.017 * (1 - i / 7) + 0.003, 0.017 * (1 - (i + 1) / 7) + 0.003, { seg: 8 }), color: i % 2 ? '#7a6a58' : '#6c5c4b', bone: 'head' });
		}
	}
	if (L.beard) parts.push({ geo: spike([0, 0.83, 0.67], [0, -1, -0.2], 0.022, 0.09, { flat: 0.5 }), color: breed === 'alpine' ? '#2a221d' : breed === 'boer' ? L.dark : L.coat, bone: 'jaw' });
	for (const leg of LEGS) {
		const side = leg[1] === 'L' ? 1 : -1;
		const toe = (leg[0] === 'F' ? J.fore : J.hind)[4];
		for (const dx of [-0.01, 0.01]) parts.push({ geo: egg([toe[0] * side + dx, 0.016, toe[2] - 0.016], [0.011, 0.017, 0.025], [-0.25, 0, 0]), color: '#2c2723', bone: `foot${leg}` });
	}

	const r = rig(q.bones, parts, animalMaterials(0.85));
	r.object.name = `goat-${breed}`;
	const clips = moves(q, {
		seed: GOAT_BREEDS.indexOf(breed) + 21,
		gaits: {
			walk: { speed: 0.65, stride: 0.7, duty: 0.66, feet: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, lift: 0.08, bob: 0.012, roll: 0.02, pitch: 0.012, tilt: 0.35, fold: [1.1, 0.5], flip: 0.7, nod: 0.06, flex: 0.02 },
			trot: { speed: 1.8, stride: 1.2, duty: 0.4, feet: { HL: 0, FR: 0, FL: 0.5, HR: 0.5 }, lift: 0.1, bob: 0.025, roll: 0.02, pitch: 0.015, tilt: 0.5, fold: [1.5, 0.75], flip: 1.0, nod: 0.03, flex: 0.03 }
		},
		tail: { sway: 0.25, carry: -0.35, hz: 3.2 },
		ears: L.ears === 'long' ? 0.2 : 0.5
	});
	return { rig: r, clips, first: 'graze', gears: { walk: 0.65, trot: 1.8 }, feet: LEGS.map((l) => `foot${l}`) };
}
