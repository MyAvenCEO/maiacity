/*
 * THE GOOSE — a domestic goose of 5–9 kg (Anser anser domesticus, and the Chinese, of Anser cygnoides), in three
 * breeds: the white Embden, the grey Toulouse (its belly white, its wings barred dark), and the Chinese (brown and
 * white, a dark stripe down the back of its neck, the knob on its bill). A long neck in three bones held up in an S;
 * a boat of a body on short legs set far back, so it waddles, rolling over each foot; webbed orange feet.
 *
 * Measures: about 0.8 m tall with its head up, 0.4 m at the back; walks at 0.4–0.6 m/s with a stride of about 0.3 m.
 */
import * as THREE from 'three';
import { egg, limb, rig, spike, type Cast, type PartSpec, type V3 } from '../rig';
import { sculpt, mix, ramp, type Surface } from '../sculpt';
import { animalMaterials, eyes } from '../features';
import { birdMoves, birdSkeleton, type BirdJoints } from '../plans/bird';
import { noise3 } from '../noise';

export type GooseBreed = 'embden' | 'toulouse' | 'chinese';
export const GOOSE_BREEDS: GooseBreed[] = ['embden', 'toulouse', 'chinese'];

const J: BirdJoints = {
	body: [0, 0.36, 0],
	neck: [[0, 0.42, 0.2], [0, 0.55, 0.25], [0, 0.68, 0.265]],
	head: [0, 0.775, 0.275],
	beak: [0, 0.755, 0.395],
	tail: [0, 0.4, -0.26],
	wing: [0.12, 0.43, 0.12],
	leg: [[0.07, 0.31, -0.01], [0.078, 0.25, 0.05], [0.078, 0.13, -0.005], [0.078, 0.012, 0.03], [0.078, 0, 0.11]]
};

export function goose(breed: GooseBreed = 'embden'): Cast {
	const b = birdSkeleton(J);
	const s = sculpt(b.bones);
	const feather = { tag: 'feather', bump: 0.004, lumps: 0.02 };
	// a boat of a body, the breast full, the belly low between the legs (a Toulouse's dewlap of a keel)
	s.egg([0, 0.36, -0.02], [0.135, 0.13, 0.27], { bone: 'body', ...feather }, [0.06, 0, 0]);
	s.egg([0, 0.35, 0.13], [0.12, 0.12, 0.12], { bone: 'body', k: 0.06, ...feather });
	s.egg([0, 0.28, -0.04], [0.11, 0.07 + (breed === 'toulouse' ? 0.02 : 0), 0.2], { bone: 'body', k: 0.06, ...feather, tag: 'belly' });
	s.egg([0, 0.4, -0.25], [0.08, 0.06, 0.08], { bone: 'tail', k: 0.04, ...feather, tag: 'tail' }, [-0.3, 0, 0]);
	// the neck: thick at its base, slim to the head
	s.cone([0, 0.4, 0.17], J.neck[1]!, 0.07, 0.04, { chain: ['neck1', 'neck2'], k: 0.05, ...feather, tag: 'neck' });
	s.cone(J.neck[1]!, J.head, 0.04, 0.033, { chain: ['neck2', 'neck3'], k: 0.03, ...feather, tag: 'neck' });
	s.egg([0, 0.778, 0.285], [0.033, 0.037, 0.05], { bone: 'head', k: 0.02, tag: 'head' });
	// the wings folded high on the back, their tips crossing over the tail
	for (const [side, x] of [['L', 1], ['R', -1]] as const) s.egg([x * 0.11, 0.41, -0.06], [0.04, 0.075, 0.24], { bone: `wing${side}`, k: 0.03, ...feather, tag: 'wing' }, [0.12, x * -0.08, 0]);
	for (const [side, x] of [['L', 1], ['R', -1]] as const) s.egg([x * J.leg[1][0], 0.2, 0.025], [0.038, 0.06, 0.05], { bone: `shank${side}`, k: 0.04, ...feather, tag: 'belly' }, [-0.5, 0, 0]);

	const white = new THREE.Color('#f5f3ee'), grey = new THREE.Color('#8a8a86'), brown = new THREE.Color('#9a7a5a'), dark = new THREE.Color('#4a3a2c');
	const paint = (c: THREE.Color, at: Surface) => {
		const { p, n } = at;
		const fine = noise3(p.x * 140, p.y * 140, p.z * 140, 3);
		if (breed === 'embden') c.copy(white).multiplyScalar(0.95 + 0.06 * fine);
		else if (breed === 'toulouse') {
			// grey, the belly white, the wings and the back barred with the feathers' pale edges
			c.copy(grey).multiplyScalar(0.92 + 0.1 * fine);
			const bars = Math.sin(p.z * 90 + p.y * 30);
			mix(c, '#c9c7c0', ramp(bars, 0.5, 0.9) * (at.tag('wing') + ramp(n.y, 0.3, 0.8) * at.tag('feather')) * 0.6);
			mix(c, white, Math.max(at.tag('belly'), ramp(-n.y, 0.1, 0.6)));
		} else {
			// the Chinese: fawn-brown above, white below and on the face, a dark stripe down the back of the neck
			c.copy(brown).multiplyScalar(0.93 + 0.1 * fine);
			mix(c, white, Math.max(ramp(-n.y, 0.0, 0.5), at.tag('belly') * 0.8, at.tag('neck') * ramp(n.z, -0.2, 0.4)));
			mix(c, dark, at.tag('neck') * ramp(-n.z, 0.4, 0.8));
			if (at.main === 'head') mix(c, white, 0.6);
		}
	};
	const skin = s.skin(0.011, paint, `goose-${breed}`);

	const bill = breed === 'chinese' ? '#2a2420' : '#e88a2c', feet = breed === 'chinese' ? '#e88a2c' : '#ea8e34';
	const parts: PartSpec[] = [{ skin }];
	// the bill, flat and broad; a Chinese goose's knob at its root
	parts.push({ geo: spike([0, 0.765, 0.322], [0, -0.18, 1], 0.022, 0.08, { flat: 1.25 }), color: bill, bone: 'head' });
	parts.push({ geo: egg([0, 0.755, 0.35], [0.017, 0.006, 0.035], [0.15, 0, 0]), color: bill, bone: 'head' });
	if (breed === 'chinese') parts.push({ geo: egg([0, 0.79, 0.318], [0.014, 0.014, 0.014]), color: '#2a2420', bone: 'head' });
	parts.push(...eyes([0.026, 0.79, 0.3], 0.0065, [0.9, 0.15, 0.35], breed === 'embden' ? '#4a8acb' : '#3a2a1a', 'round', 'head', { irisR: 0.7 }));
	// the legs and the webbed feet
	for (const [side, x] of [['L', 1], ['R', -1]] as const) {
		const ankle: V3 = [x * J.leg[2][0], J.leg[2][1], J.leg[2][2]], toes: V3 = [x * J.leg[3][0], J.leg[3][1], J.leg[3][2]];
		parts.push({ geo: limb(ankle, toes, 0.011, 0.009, { seg: 7 }), color: feet, bone: `tarsus${side}` });
		const web = new THREE.Shape();
		web.moveTo(0, 0);
		web.lineTo(-0.045, 0.075);
		web.quadraticCurveTo(0, 0.09, 0.045, 0.075);
		web.lineTo(0, 0);
		// the web laid flat, pointing forward, a few millimetres thick
		const solid = new THREE.ExtrudeGeometry(web, { depth: 0.004, bevelEnabled: false, curveSegments: 3 });
		solid.rotateX(Math.PI / 2);
		solid.translate(toes[0], 0.006, toes[2]);
		parts.push({ geo: solid, color: feet, bone: `toes${side}` });
	}

	const r = rig(b.bones, parts, animalMaterials(0.8));
	r.object.name = `goose-${breed}`;
	const clips = birdMoves(b, {
		seed: GOOSE_BREEDS.indexOf(breed) + 51,
		gaits: { walk: { speed: 0.45, stride: 0.3, duty: 0.64, feet: { L: 0, R: 0.5 }, lift: 0.035, bob: 0.008, roll: 0.13, pitch: 0.015, tilt: 0.4, fold: 0.9, curl: 0.8, hold: 0 } },
		wag: 0.25,
		carry: 0.15
	});
	return { rig: r, clips, first: 'walk', gears: { walk: 0.45 }, feet: ['toesL', 'toesR'] };
}
