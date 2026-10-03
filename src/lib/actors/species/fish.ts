/*
 * THE FISH — the carp of the ponds (Cyprinus carpio, as koi: the orange, the kohaku white with red, the gold ogon, and
 * the plain bronze carp) and the tilapia of the aquaponics tanks (the Nile, grey-green with dark bars and a red edge
 * to its tail; the red). A body that swims as a fish's does: a wave travelling down it, small at the head and growing
 * to the tail, one beat of the tail for each length of the body swum (as fish do, near enough: three quarters of a
 * length a beat); turning, the body curves into the turn; slow, the pectoral fins scull.
 *
 * Measures: a pond koi 0.3–0.5 m, a tilapia 0.2–0.3 m; cruising at about half a body length a second.
 */
import * as THREE from 'three';
import { egg, limb, rig, type BoneSpec, type Cast, type Clip, type PartSpec, type Pose, type V3 } from '../rig';
import { sculpt, mix, ramp, type Surface } from '../sculpt';
import { animalMaterials, eyes } from '../features';
import { clamp, onTheSpot, TAU } from '../motion';
import { fbm3 } from '../noise';

export type FishKind = 'koi' | 'kohaku' | 'ogon' | 'carp' | 'nile' | 'redtilapia';
export const FISH_KINDS: FishKind[] = ['koi', 'kohaku', 'ogon', 'carp', 'nile', 'redtilapia'];

const SPINE = ['head', 'body1', 'body2', 'body3', 'body4', 'tail', 'fin'];

/** a fish `len` long, its middle at height y */
export function fish(kind: FishKind = 'koi', len?: number, y = 0.15): Cast {
	const tilapia = kind === 'nile' || kind === 'redtilapia';
	const L = len ?? (tilapia ? 0.26 : 0.36);
	const Z = (k: number) => L * k;
	// along the spine from the head back: where each bone turns
	const at = [0.3, 0.17, 0.04, -0.09, -0.21, -0.33, -0.42];
	const bones: BoneSpec[] = [
		...SPINE.map((name, i) => ({ name, parent: i ? SPINE[i - 1] : undefined, at: [0, y, Z(at[i]!)] as V3 })),
		{ name: 'pectL', parent: 'head', at: [L * 0.06, y - L * 0.06, Z(0.22)] },
		{ name: 'pectR', parent: 'head', at: [-L * 0.06, y - L * 0.06, Z(0.22)] }
	];
	const deep = tilapia ? 1.18 : 1;
	const s = sculpt(bones);
	const chain = ['head', 'body1', 'body2', 'body3', 'body4', 'tail'];
	s.egg([0, y, Z(0.02)], [L * 0.075, L * 0.125 * deep, L * 0.4], { chain, tag: 'body' });
	s.egg([0, y - L * 0.005, Z(0.27)], [L * 0.068, L * 0.1 * deep, L * 0.15], { bone: 'head', k: L * 0.06, tag: 'head' });
	s.egg([0, y, Z(-0.34)], [L * 0.032, L * 0.055 * deep, L * 0.11], { chain: ['body4', 'tail'], k: L * 0.06, tag: 'body' });
	s.egg([0, y - L * 0.02, Z(0.405)], [L * 0.03, L * 0.028, L * 0.03], { bone: 'head', k: L * 0.02, tag: 'lips' });

	const look = {
		koi: { base: '#e86a1e', belly: '#f6c08a', patch: '#e86a1e' },
		kohaku: { base: '#f3f0ea', belly: '#f6f3ee', patch: '#d23a1c' },
		ogon: { base: '#d9a63a', belly: '#f0d48a', patch: '#d9a63a' },
		carp: { base: '#6e5a32', belly: '#d8b46a', patch: '#6e5a32' },
		nile: { base: '#717a70', belly: '#d4d6cc', patch: '#3e4640' },
		redtilapia: { base: '#e48a6a', belly: '#f4cdb8', patch: '#e48a6a' }
	}[kind];
	const base = new THREE.Color(look.base), belly = new THREE.Color(look.belly);
	const paint = (c: THREE.Color, at: Surface) => {
		const { p, n } = at;
		c.copy(base);
		mix(c, belly, ramp(-n.y, -0.2, 0.6));
		// darker along the back
		c.multiplyScalar(1 - 0.25 * ramp(n.y, 0.4, 0.95));
		// the scales: a staggered grid, each scale's rim a little darker
		const sc = L * 0.045;
		const row = Math.floor(p.y / sc), u = p.z / sc + (row % 2 ? 0.5 : 0);
		const d = Math.hypot(u - Math.round(u), p.y / sc - row - 0.5);
		if (!at.tag('head') || at.tag('body') > 0.5) c.multiplyScalar(1 - 0.12 * ramp(d, 0.3, 0.5));
		if (kind === 'kohaku') mix(c, look.patch, ramp(fbm3(p.x * 18 / L, p.y * 12 / L, p.z * 9 / L, 3, 5), 0.05, 0.12) * ramp(n.y, -0.3, 0.2));
		if (kind === 'nile') mix(c, look.patch, 0.55 * ramp(Math.sin((p.z / L) * 52), 0.55, 0.85) * ramp(n.y, -0.5, 0.2) * ramp(p.z, Z(-0.36), Z(-0.3)) * ramp(Z(0.22), Z(0.16), p.z));
		if (at.main === 'lips') mix(c, belly, 0.5);
	};
	const skin = s.skin(L * 0.016, paint, `fish-${kind}-${L.toFixed(2)}-${y.toFixed(2)}`);

	const fin = kind === 'kohaku' ? '#f2ece4' : kind === 'nile' ? '#6a6a5e' : look.base;
	const parts: PartSpec[] = [{ skin }];
	// the tail fin, forked, its two lobes
	for (const up of [1, -1]) parts.push({ geo: egg([0, y + up * L * 0.08, Z(-0.5)], [L * 0.006, L * 0.1, L * 0.055], [up * -0.65, 0, 0]), color: kind === 'nile' ? (p) => (p.z < Z(-0.53) ? '#b8523a' : fin) : fin, bone: 'fin' });
	// the dorsal fin along the back, the anal and pelvic fins below
	parts.push({ geo: egg([0, y + L * 0.13 * deep, Z(tilapia ? -0.02 : 0.0)], [L * 0.005, L * 0.055, L * (tilapia ? 0.24 : 0.2)], [0.15, 0, 0]), color: fin, chain: { bones: ['body1', 'body2', 'body3', 'body4'], soft: L * 0.05 } });
	parts.push({ geo: egg([0, y - L * 0.12 * deep, Z(-0.2)], [L * 0.005, L * 0.045, L * 0.07], [-0.4, 0, 0]), color: fin, bone: 'body4' });
	for (const x of [-1, 1]) parts.push({ geo: egg([x * L * 0.04, y - L * 0.11, Z(0.03)], [L * 0.005, L * 0.035, L * 0.06], [-0.5, 0, x * 0.5]), color: fin, bone: 'body2' });
	for (const [side, x] of [['L', 1], ['R', -1]] as const) parts.push({ geo: egg([x * L * 0.085, y - L * 0.075, Z(0.17)], [L * 0.004, L * 0.035, L * 0.06], [-0.5, x * 0.6, x * 0.5]), color: fin, bone: `pect${side}` });
	parts.push(...eyes([L * 0.06, y + L * 0.025, Z(0.35)], L * 0.022, [1, 0.05, 0.25], tilapia ? '#c9b26a' : '#d9b45a', 'round', 'head', { irisR: 0.8, pupilR: 0.55 }));
	// a carp's barbels at the corners of its mouth
	if (!tilapia) for (const x of [-1, 1]) parts.push({ geo: limb([x * L * 0.022, y - L * 0.03, Z(0.42)], [x * L * 0.05, y - L * 0.07, Z(0.44)], L * 0.004, L * 0.003, { seg: 5 }), color: look.belly, bone: 'head' });

	const r = rig(bones, parts, animalMaterials(0.35, { metalness: kind === 'ogon' ? 0.45 : 0.12 }));
	r.object.name = `fish-${kind}`;
	const cruise = 0.5 * L;
	const wave = (t: number, m: { dist: number; speed: number; turn?: number }): Pose => {
		// a beat for each three quarters of a body length swum, and a slow one hanging still
		const ph = m.dist / (0.75 * L) + t * 0.35;
		const pace = clamp(m.speed / cruise, 0, 2);
		const amp = 0.06 + 0.1 * Math.min(1, pace);
		const bend = clamp(m.turn ?? 0, -2, 2) * 0.12;
		const pose: Pose = { root: [0, 0.004 * L * Math.sin(t * 1.3), 0] };
		SPINE.forEach((n, i) => {
			const grow = [0.25, 0.35, 0.5, 0.7, 0.95, 1.25, 1.1][i]!;
			pose[n] = [0, amp * grow * Math.sin(TAU * ph - 0.9 * i) + (i ? bend : -bend * 0.5), 0];
		});
		const scull = (1 - Math.min(1, pace)) * 0.5 + 0.15;
		pose.pectL = [0, 0, 0.3 + scull * Math.sin(t * 6)];
		pose.pectR = [0, 0, -0.3 - scull * Math.sin(t * 6 + 0.5)];
		return pose;
	};
	const swim: Clip = (t, m) => wave(t, onTheSpot(t, cruise, m));
	const turn: Clip = (t, m) => wave(t, { ...onTheSpot(t, cruise, m), turn: 1.2 * Math.sin(t * 0.8) });
	const hang: Clip = (t) => wave(t, { dist: 0, speed: 0 });
	return { rig: r, clips: { swim, turn, hang }, first: 'swim', gears: { swim: cruise } };
}

/** the carp of the old list, by name: a koi */
export const carp = () => fish('koi');
export const tilapia = () => fish('nile');
