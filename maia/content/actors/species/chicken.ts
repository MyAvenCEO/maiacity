/*
 * THE CHICKEN — Gallus gallus domesticus: a hen of about 2.2 kg in six breeds, the rooster, and a chick. The red
 * (a brown layer: chestnut, its hackles gold, its tail dark), the white Leghorn (its big single comb flopping over,
 * white earlobes, yellow legs), the black Australorp (a green sheen, slate legs), the barred Plymouth Rock (grey and
 * white in bars across every feather), the buff Orpington (golden and fluffed up big) and the speckled Sussex
 * (mahogany, every feather tipped white); the rooster red and gold over a black-green breast, his sickle feathers
 * arching over his tail; the chick a yellow ball of down.
 *
 * A hen walks with her head held still in the air while her body passes under it, then thrust forward to the next
 * hold; she pecks in quick bursts, and scratches the ground back with one foot and then the other to see what turns up.
 *
 * Measures: a hen stands about 0.4 m to her comb, 0.3 m at the back; walks at 0.3–0.6 m/s, a stride of about 0.24 m,
 * each foot down 60–65 % of it.
 */
import * as THREE from 'three';
import { egg, limb, rig, spike, type Cast, type PartSpec, type V3 } from '../rig';
import { sculpt, mix, ramp, type Surface } from '../sculpt';
import { animalMaterials, eyes } from '../features';
import { birdMoves, birdSkeleton, type BirdJoints } from '../plans/bird';
import { fbm3, noise3 } from '../noise';

export type ChickenKind = 'red' | 'leghorn' | 'australorp' | 'barred' | 'buff' | 'speckled' | 'rooster' | 'chick';
export const CHICKEN_KINDS: ChickenKind[] = ['red', 'leghorn', 'australorp', 'barred', 'buff', 'speckled', 'rooster', 'chick'];

type Look = { body: string; neck: string; wing: string; tail: string; legs: string; comb: number; lobe: string; fluff: number };
const LOOK: Record<Exclude<ChickenKind, 'chick'>, Look> = {
	red: { body: '#9a5a2e', neck: '#c98a45', wing: '#7e4523', tail: '#2c2620', legs: '#e3b85a', comb: 1, lobe: '#c63a2c', fluff: 1 },
	leghorn: { body: '#f4f1ea', neck: '#f7f4ee', wing: '#ebe7de', tail: '#f1eee6', legs: '#efc34a', comb: 1.45, lobe: '#f2efe6', fluff: 0.92 },
	australorp: { body: '#1b1d1b', neck: '#202421', wing: '#1a1c1a', tail: '#151816', legs: '#4a4a52', comb: 1.05, lobe: '#c63a2c', fluff: 1.06 },
	barred: { body: '#8e9090', neck: '#9a9c9b', wing: '#888a8a', tail: '#7e8080', legs: '#e8c050', comb: 1, lobe: '#c63a2c', fluff: 1.05 },
	buff: { body: '#d9a45a', neck: '#e3b469', wing: '#cf9a50', tail: '#c48c44', legs: '#e8d2c0', comb: 0.9, lobe: '#c63a2c', fluff: 1.16 },
	speckled: { body: '#6e3a1e', neck: '#7a4422', wing: '#673620', tail: '#2a221c', legs: '#ead6c4', comb: 0.95, lobe: '#c63a2c', fluff: 1.08 },
	rooster: { body: '#9a3a1a', neck: '#e09a3a', wing: '#8a3218', tail: '#16201c', legs: '#e3b85a', comb: 1.9, lobe: '#c63a2c', fluff: 1 }
};

/** a hen's joints; the rooster stands taller, the chick is a third her size with a big head */
function joints(kind: ChickenKind): { j: BirdJoints; k: number } {
	const j: BirdJoints = {
		body: [0, 0.245, 0],
		neck: [[0, 0.29, 0.1], [0, 0.35, 0.135]],
		head: [0, 0.415, 0.155],
		beak: [0, 0.405, 0.215],
		tail: [0, 0.3, -0.12],
		wing: [0.085, 0.29, 0.07],
		leg: [[0.045, 0.22, 0.005], [0.05, 0.165, 0.055], [0.05, 0.105, -0.01], [0.05, 0.012, 0.012], [0.05, 0, 0.075]]
	};
	if (kind === 'rooster') {
		const up = (p: V3, dy: number, dz = 0): V3 => [p[0], p[1] + dy, p[2] + dz];
		return {
			j: { body: up(j.body, 0.04), neck: [up(j.neck[0]!, 0.06, 0.01), up(j.neck[1]!, 0.09, 0.01)], head: up(j.head, 0.12, 0.0), beak: up(j.beak, 0.12, 0.005), tail: up(j.tail, 0.05), wing: up(j.wing, 0.045), leg: [up(j.leg[0], 0.04), up(j.leg[1], 0.035, 0.005), up(j.leg[2], 0.02), j.leg[3], j.leg[4]] },
			k: 1.15
		};
	}
	if (kind === 'chick') {
		const s = 0.36;
		const sc = (p: V3, big = 1): V3 => [p[0] * s * big, p[1] * s * big, p[2] * s * big];
		return { j: { body: sc(j.body), neck: [sc(j.neck[0]!), sc(j.neck[1]!)], head: [0, 0.4 * s * 1.03, 0.15 * s * 1.1], beak: [0, 0.395 * s * 1.03, 0.2 * s * 1.12], tail: sc(j.tail), wing: sc(j.wing), leg: j.leg.map((p) => sc(p)) as BirdJoints['leg'] }, k: s };
	}
	return { j, k: 1 };
}

export function chicken(kind: ChickenKind = 'red'): Cast {
	const { j, k } = joints(kind);
	const b = birdSkeleton(j);
	const s = sculpt(b.bones);
	const chick = kind === 'chick';
	const L: Look = chick ? { body: '#f2d36a', neck: '#f4da78', wing: '#ecc95c', tail: '#ecc95c', legs: '#f0b860', comb: 0, lobe: '#f2d36a', fluff: 1 } : LOOK[kind];
	const f = L.fluff;
	const at = (p: V3): V3 => [p[0] * k, p[1] * k, p[2] * k];
	const feather = { tag: 'feather', bump: chick ? 0.0015 : 0.004 * f, lumps: chick ? 0.004 : 0.011 };
	if (chick) {
		// a ball of down, a big head on it
		s.egg([0, 0.088, 0], [0.034, 0.033, 0.042], { bone: 'body', ...feather }, [0.2, 0, 0]);
		s.ball(j.head, 0.022, { bone: 'head', k: 0.012, ...feather });
		s.cone(j.neck[0]!, j.head, 0.02, 0.018, { chain: b.neck, k: 0.01, ...feather });
		for (const x of [-1, 1]) s.egg([x * 0.03, 0.09, 0.0], [0.008, 0.02, 0.028], { bone: `wing${x > 0 ? 'L' : 'R'}`, k: 0.008, ...feather, tag: 'wing' });
	} else {
		// the body: tilted, breast low and forward, back rising to the tail; the fluff behind the legs
		s.egg(at([0, 0.245, -0.005]), [0.09 * f, 0.1 * f, 0.145 * f], { bone: 'body', ...feather }, [0.3, 0, 0]);
		s.egg(at([0, 0.222, 0.07]), [0.082 * f, 0.088 * f, 0.08 * f], { bone: 'body', k: 0.04, ...feather });
		s.egg(at([0, 0.295, -0.06]), [0.07 * f, 0.055 * f, 0.1], { bone: 'body', k: 0.04, ...feather }, [-0.25, 0, 0]);
		s.egg(at([0, 0.2, -0.095]), [0.075 * f, 0.065 * f, 0.065 * f], { bone: 'body', k: 0.04, ...feather });
		// the neck in its hackles, the head
		s.cone(j.neck[0]!, j.head, (kind === 'rooster' ? 0.05 : 0.045) * f, 0.026, { chain: b.neck, k: 0.035, ...feather, tag: 'neck' });
		s.ball(j.head, 0.03 * (kind === 'rooster' ? 1.05 : 1), { bone: 'head', k: 0.015, tag: 'neck', bump: 0.001, lumps: 0.008 });
		// the wings folded against the sides
		for (const [side, x] of [['L', 1], ['R', -1]] as const) s.egg([x * 0.083 * f * k, 0.265 * k, -0.005 * k], [0.028, 0.068 * f, 0.12 * f], { bone: `wing${side}`, k: 0.02, ...feather, tag: 'wing' }, [0.32, 0, 0]);
		// the tail coverts
		s.cone(at([0, 0.3, -0.1]), at([0, 0.37, -0.165]), 0.052 * f, 0.025, { bone: 'tail', k: 0.03, ...feather, tag: 'tail' });
	}
	// the drumsticks
	for (const [side, x] of [['L', 1], ['R', -1]] as const) {
		const knee = j.leg[1], ankle = j.leg[2];
		s.egg([x * knee[0], (knee[1] + ankle[1]) / 2 + 0.006 * k, (knee[2] + ankle[2]) / 2], [0.032 * k * f, 0.05 * k, 0.04 * k * f], { bone: `shank${side}`, k: 0.03 * k, ...feather, tag: 'thigh' }, [-0.6, 0, 0]);
	}

	const body = new THREE.Color(L.body), neck = new THREE.Color(L.neck), wing = new THREE.Color(L.wing), tail = new THREE.Color(L.tail), red = new THREE.Color('#c8392b');
	const sheen = new THREE.Color('#1d3a2c'), white = new THREE.Color('#f3efe6'), t = new THREE.Color();
	const paint = (c: THREE.Color, sf: Surface) => {
		const { p, n } = sf;
		const parts: [THREE.Color, number][] = [[body, sf.tag('feather') + sf.tag('thigh')], [neck, sf.tag('neck')], [wing, sf.tag('wing')], [tail, sf.tag('tail')]];
		c.setRGB(0, 0, 0);
		let sum = 0;
		for (const [col, w] of parts) {
			c.r += col.r * w;
			c.g += col.g * w;
			c.b += col.b * w;
			sum += w;
		}
		c.multiplyScalar(1 / (sum || 1));
		// the feathers' edges: a fine scale of light and dark
		const scale = noise3(p.x * 260, p.y * 260, p.z * 260, 3);
		c.multiplyScalar(0.94 + 0.1 * scale);
		if (kind === 'barred') {
			// bars across every feather: light and dark bands, broken by the feathers' layering
			const bar = Math.sin((p.y * 0.6 - p.z * 0.8) * 420 + 3 * fbm3(p.x * 40, p.y * 40, p.z * 40, 2, 5));
			t.set('#3a3c3d');
			c.lerp(white, ramp(bar, 0.1, 0.4) * 0.7).lerp(t, ramp(-bar, 0.2, 0.5) * 0.6);
		} else if (kind === 'speckled') {
			const dot = noise3(p.x * 180, p.y * 180, p.z * 180, 11);
			c.lerp(white, ramp(dot, 0.45, 0.6)).lerp(t.set('#151210'), ramp(dot, 0.3, 0.42) * (1 - ramp(dot, 0.45, 0.6)) * 0.7);
		} else if (kind === 'australorp' || kind === 'rooster') {
			// black feathers shining green where the light comes off them
			const shine = ramp(n.y, 0.2, 0.9) * (kind === 'rooster' ? sf.tag('tail') + ramp(0.25, 0.18, p.y) * sf.tag('feather') : 1);
			if (kind === 'rooster') c.lerp(t.set('#15211b'), ramp(0.3, 0.22, p.y) * sf.tag('feather') * ramp(p.z, -0.02, 0.06));
			c.lerp(sheen, 0.35 * shine);
		} else if (kind === 'red') {
			// a hen's chestnut lighter on the breast, the hackles gold streaked dark
			mix(c, '#b8743c', 0.4 * ramp(n.z, 0.3, 0.9) * sf.tag('feather'));
			mix(c, '#5a3418', 0.3 * sf.tag('neck') * ramp(fbm3(p.x * 300, p.y * 80, p.z * 300, 2, 4), 0.1, 0.4));
		}
		// the bare red face round the eye
		if (!chick && sf.main === 'neck' && Math.hypot(Math.abs(p.x) - 0.025 * k, p.y - j.head[1] - 0.005, p.z - j.head[2] - 0.018) < 0.016 * k) mix(c, red, 0.8);
	};
	const skin = s.skin(chick ? 0.003 : kind === 'rooster' ? 0.0076 : 0.0068, paint, `chicken-${kind}`);

	const parts: PartSpec[] = [{ skin }];
	const beakC = kind === 'australorp' ? '#3c3a38' : chick ? '#e8a84a' : '#e0b45a';
	const hb = j.head, by = hb[1], bz = hb[2];
	/** the head's radius: the face is laid out on it */
	const rh = chick ? 0.022 : kind === 'rooster' ? 0.0315 : 0.03;
	// the beak, hooked a little at its tip
	parts.push({ geo: spike([0, by - 0.07 * rh, bz + 0.78 * rh], [0, -0.28, 1], 0.4 * rh, (chick ? 0.6 : 1.12) * rh, { flat: 0.8 }), color: beakC, bone: 'head' });
	parts.push(...eyes([0.73 * rh, by + 0.2 * rh, bz + 0.4 * rh], (chick ? 0.25 : 0.21) * rh, [0.9, 0.1, 0.42], chick ? '#1a1410' : '#d4762a', 'round', 'head', { irisR: 0.75, pupilR: 0.42 }));
	if (!chick) {
		// the single comb: its points along the top of the head, a Leghorn's tall and flopped over, a rooster's taller
		const c = L.comb;
		const flop = kind === 'leghorn' ? 0.5 : 0;
		for (let i = 0; i < 5; i++) {
			const z = bz - 0.018 + i * 0.012, h = (0.018 + 0.012 * Math.sin((Math.PI * (i + 0.5)) / 5)) * c;
			parts.push({ geo: egg([flop * h * 0.4, by + 0.024 + h * 0.5, z], [0.004, h * 0.55, 0.0075], [0, 0, -flop]), color: '#c8392b', bone: 'head' });
		}
		parts.push({ geo: egg([0, by + 0.024 + 0.006 * c, bz + 0.004], [0.004, 0.009 * c, 0.03], [0, 0, -flop * 0.6]), color: '#c8392b', bone: 'head' });
		// the wattles under the beak, the earlobes
		for (const x of [-1, 1]) {
			parts.push({ geo: egg([x * 0.007, by - 0.026 * c, bz + 0.018], [0.006, 0.014 * c, 0.01]), color: '#c8392b', bone: 'head' });
			parts.push({ geo: egg([x * 0.027 * k, by - 0.006, bz - 0.006], [0.003, 0.007, 0.006]), color: L.lobe, bone: 'head' });
		}
		// the tail feathers fanned up; a rooster's sickles arching over and down
		const fan = kind === 'rooster' ? 7 : 6;
		for (let i = 0; i < fan; i++) {
			const a = (i / (fan - 1) - 0.5) * 0.9;
			const len = (kind === 'rooster' ? 0.13 : 0.09) * (1 - Math.abs(a) * 0.4);
			const base: V3 = at([Math.sin(a) * 0.03, 0.34, -0.15]);
			const dir = new THREE.Vector3(Math.sin(a) * 0.35, 0.75, -0.6).normalize();
			const mid: V3 = [base[0] + dir.x * len * 0.5, base[1] + dir.y * len * 0.5, base[2] + dir.z * len * 0.5];
			parts.push({ geo: egg(mid, [0.004, len * 0.5, 0.022], [Math.atan2(-dir.z, dir.y), 0, -Math.sin(a) * 0.6]), color: L.tail, bone: 'tail' });
		}
		if (kind === 'rooster')
			for (const x of [-1, 1])
				for (let i = 0; i < 2; i++) {
					// a sickle: a long feather arching over the tail and down
					const pts: V3[] = [];
					for (let q = 0; q <= 6; q++) {
						const u = q / 6, a = 0.2 + u * 2.6;
						pts.push([x * (0.015 + 0.012 * i), 0.4 + 0.12 * Math.sin(a) * (1 - 0.15 * i), -0.15 - 0.13 * (1 - Math.cos(a)) * 0.6 - 0.05 * u]);
					}
					for (let q = 0; q < 6; q++) parts.push({ geo: limb(pts[q]!, pts[q + 1]!, 0.009 - q * 0.0011, 0.008 - q * 0.0011, { flat: 0.35, seg: 6 }), color: '#121a17', bone: 'tail' });
				}
	}
	// the legs: scaled shanks and four toes, three forward and one back
	for (const [side, x] of [['L', 1], ['R', -1]] as const) {
		const ankle: V3 = [x * j.leg[2][0], j.leg[2][1], j.leg[2][2]], toes: V3 = [x * j.leg[3][0], j.leg[3][1], j.leg[3][2]];
		parts.push({ geo: limb([ankle[0], ankle[1] + 0.008 * k, ankle[2]], toes, 0.0085 * k, 0.007 * k, { seg: 7 }), color: L.legs, bone: `tarsus${side}` });
		for (const [dx, dz, len] of [[0, 1, 0.062], [0.55, 0.85, 0.05], [-0.55, 0.85, 0.05], [0, -1, 0.026]] as const) {
			const tip: V3 = [toes[0] + x * dx * len * k * 0.7, 0.003 * k, toes[2] + dz * len * k];
			parts.push({ geo: limb(toes, tip, 0.0045 * k, 0.0028 * k, { seg: 5 }), color: L.legs, bone: `toes${side}` });
		}
	}

	const r = rig(b.bones, parts, animalMaterials(0.88));
	r.object.name = `chicken-${kind}`;
	const stride = 0.24 * (chick ? 0.45 : kind === 'rooster' ? 1.1 : 1);
	const clips = birdMoves(b, {
		seed: CHICKEN_KINDS.indexOf(kind) + 41,
		gaits: { walk: { speed: chick ? 0.25 : 0.45, stride, duty: 0.62, feet: { L: 0, R: 0.5 }, lift: 0.035 * k, bob: 0.006 * k, roll: 0.05, pitch: 0.02, tilt: 0.5, fold: 1.2, curl: 1.1, hold: 0.68 } },
		wag: 0.06
	});
	return { rig: r, clips, first: 'walk', gears: { walk: chick ? 0.25 : 0.45 }, feet: ['toesL', 'toesR'] };
}
