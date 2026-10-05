/*
 * GINGER — Zingiber officinale, grown not from seed but from a piece of rhizome (a "hand") with a few plump eyes on it,
 * planted just under the soil. The rhizome creeps sideways: each eye swells into a fat knob, each knob sends up one
 * reed-like leafy stem and puts out the next knobs to either side of it, so the hand grows into a branched, knobbly
 * clump of fingers, ringed with scars and pink where the young stems rise. The stems are not true stems but
 * pseudostems, rolled leaf sheaths a metre high, carrying two ranks of narrow lance leaves; they yellow and fall in
 * autumn, when the rhizome is fullest, and it is lifted. Its last four stages are the rhizome's own: young fingers,
 * baby ginger, swelling, harvest.
 *
 * All at real measure (metres), the soil's surface at y = 0; the viewer cuts the soil away to show the hand.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, tube, v3 } from './grow.js';

export const GINGER_STAGES = [
	{ name: 'Seed piece', day: 0, note: 'A plump piece of rhizome with two or three eyes, laid flat five centimetres down in warm, moist soil.' },
	{ name: 'Sprouting', day: 14, note: 'The eyes swell, pink and green-tipped; white roots go down from the underside.' },
	{ name: 'Shoot', day: 30, note: 'A pointed shoot, rolled tight, breaks the soil.' },
	{ name: 'First leaves', day: 50, note: 'A reed-like stem unrolls its leaves in two ranks, one to each side in turn.' },
	{ name: 'Clump', day: 90, note: 'New knobs on the rhizome, each sending up a stem of its own.' },
	{ name: 'Reeds', day: 130, note: 'A clump of leafy stems a metre high; below, the hand branching into fingers.' },
	{ name: 'Young fingers', day: 160, note: 'New fingers of rhizome fill out under the soil, pink where each stem rises.' },
	{ name: 'Baby ginger', day: 190, note: 'Tender, thin-skinned, pink-tipped: dug now, it is mild and needs no peeling.' },
	{ name: 'Swelling', day: 230, note: 'The fingers fatten and their skins toughen to tan, ringed with scars.' },
	{ name: 'Harvest', day: 270, note: 'The leaves yellow and fall over: lift the clump, keep a hand back to plant again.' }
];

const DEPTH = 0.05;

/** a lance leaf, narrow and long-pointed */
const lance = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.65)), 0.75) * (u < 0.04 ? u / 0.04 : 1);

/**
 * @typedef {{ pts: THREE.Vector3[], tip: THREE.Vector3, dir: THREE.Vector3, gen: number, key: (string | number)[], born: number, grown: number }} Knob
 */

/**
 * The ginger at a stage (0 … 9, between them on the way) from the seed id.
 * @param {number} g
 * @param {string} seed
 */
export function ginger(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.08);
	const swell = span(g, 5.3, 9);
	// the leaves die back at the end, the oldest stems first
	const die = span(g, 8.2, 9.4);
	/** @type {Knob[]} */
	const knobs = [];

	/**
	 * A knob of rhizome and the knobs that branch from it: sideways and a little up, the same whatever the stage.
	 * @param {(string | number)[]} key @param {THREE.Vector3} from @param {THREE.Vector3} dir @param {number} gen @param {number} born
	 */
	const knob = (key, from, dir, gen, born) => {
		const r = chance(seed, 'knob', ...key);
		const len = (gen === 0 ? 0.055 : between(r, 0.026, 0.042)) * vigour;
		const d = dir.clone().setY(0).normalize();
		const path = [from.clone()];
		for (let k = 1; k <= 6; k++) {
			const t = k / 6;
			// a knob bulges up a little and turns its tip toward the surface, where its stem rises
			path.push(from.clone().addScaledVector(d, len * t).add(v3(0, (gen === 0 ? 0 : 0.006) * t * t, 0)));
		}
		const grown = gen === 0 ? 1 : clamp((g - born) / 0.9);
		if (grown <= 0) {
			// an eye, swelling, before it breaks
			if (g > born - 0.8) bag.add('body', bead(from, v3(1, 0.8, 1).multiplyScalar(0.003 * span(g, born - 0.8, born)), '#e8a0a8', 4));
			return;
		}
		const pts = grown >= 1 ? path : path.map((p) => from.clone().lerp(p, grown));
		knobs.push({ pts, tip: pts[6].clone(), dir: d, gen, key, born, grown });
		if (gen >= 4) return;
		const n = gen === 0 ? 2 : r() < (gen < 3 ? 0.8 : 0.25) ? 2 : 1;
		for (let i = 0; i < n; i++) {
			const side = i === 0 ? -1 : 1;
			const turn = side * between(r, 0.5, 1.05) + (gen === 0 ? side * 0.6 : 0);
			const next = born + (gen === 0 ? 0.6 + i * 0.7 : between(r, 0.7, 1.2) + i * 0.35);
			if (next > 7.4) continue;
			// from the knob's far end, on its side
			const at = gen === 0 ? path[2 + i * 3].clone() : path[5].clone();
			knob([...key, i], at, d.clone().applyAxisAngle(v3(0, 1, 0), turn), gen + 1, next);
		}
	};
	const r0 = chance(seed, 'hand');
	knob(['hand'], v3(-0.025, -DEPTH, 0), v3(Math.cos(r0() * 6.28), 0, Math.sin(r0() * 6.28)), 0, -1);

	for (const k of knobs) {
		const kr = chance(seed, 'knob-body', ...k.key);
		// fat and round, the mother piece older and greyer, the youngest pink at the tip
		const R = k.gen === 0 ? 0.011 : (0.004 + 0.008 * clamp(k.grown) * lerp(0.6, 1.35, swell)) * about(kr, 1, 0.12) * vigour;
		const young = clamp(1 - (g - k.born) / 3.5) * (1 - swell * 0.7);
		bag.add(
			'body',
			tube(k.pts, (u) => R * Math.pow(Math.max(0, Math.sin(Math.PI * (0.07 + 0.86 * u))), 0.45) * (1 + 0.06 * Math.sin(u * 19 + kr())), (u) => {
				const skin = k.gen === 0 ? mix('#c8a878', '#8a7454', span(g, 4, 9)) : mix(mix('#f2dcbc', '#c89a5e', swell), '#e88a96', young * clamp((u - 0.55) * 2.5));
				// ringed with the scars of the scale leaves
				return skin.lerp(new THREE.Color('#7a5a3a'), Math.pow(Math.abs(Math.sin(u * Math.PI * 4.5)), 24) * 0.55);
			}, 8)
		);
		// fibrous roots from its underside
		root(bag, { seed, key: ['g-root', ...k.key], from: k.pts[3].clone().add(v3(0, -R * 0.7, 0)), dir: v3(kr() - 0.5, -1, kr() - 0.5), length: between(kr, 0.08, 0.16), grown: (g - Math.max(0.3, k.born + 0.3)) / 1.6, radius: 0.0009, down: 0.04, wander: 0.25, laterals: 4, lateral: 0.3, depth: 1, age: (g - k.born - 1) / 3, young: '#f6efe0', old: '#c8b090' });
		if (k.gen === 0) {
			root(bag, { seed, key: ['g-root', 'hand', 2], from: k.pts[5].clone().add(v3(0, -R * 0.7, 0)), dir: v3(0.3, -1, -0.2), length: 0.14, grown: (g - 0.4) / 1.6, radius: 0.0009, down: 0.04, wander: 0.25, laterals: 4, lateral: 0.3, depth: 1, young: '#f6efe0', old: '#c8b090' });
			continue;
		}
		// its stem: a pseudostem of rolled sheaths, up from the knob's tip
		stem(bag, seed, k, R, g, vigour, die);
	}
	return bag.build();
}

/**
 * A pseudostem and its two ranks of leaves, unrolling from the top as it rises.
 * @param {Bag} bag @param {string} seed @param {Knob} k @param {number} R @param {number} g @param {number} vigour @param {number} die
 */
function stem(bag, seed, k, R, g, vigour, die) {
	const sr = chance(seed, 'stem', ...k.key);
	const born = k.born + 0.5;
	const rise = span(g, born, born + 2.4);
	if (rise <= 0) return;
	const full = (k.gen === 1 ? 1.05 : k.gen === 2 ? 0.92 : 0.75) * between(sr, 0.82, 1.08) * vigour;
	const H = DEPTH + full * rise;
	const base = k.tip.clone().add(v3(0, R * 0.5, 0));
	// leaning a little away from the clump, bowing as it lengthens
	const lean = k.dir.clone().multiplyScalar(between(sr, 0.04, 0.16));
	const at = (/** @type {number} */ h) => base.clone().add(v3(lean.x * h * h * 0.6, h, lean.z * h * h * 0.6));
	const pts = [];
	for (let m = 0; m <= 8; m++) pts.push(at((m / 8) * H));
	// its own dying back: the oldest stems first
	const dead = clamp(die * 1.4 - (k.gen - 1) * 0.25);
	bag.add('body', tube(pts, (u) => 0.0055 * (1 - 0.55 * u) * lerp(0.6, 1, rise), (u) => mix(mix('#e8a0a0', '#5f8f3a', clamp((u * H - DEPTH * 0.6) / 0.12)), '#c8b060', dead * u), 6));
	// two ranks: every leaf to one side of the stem or the other, in one plane
	const plane = sr() * Math.PI * 2;
	const out = v3(Math.cos(plane), 0, Math.sin(plane));
	const n = 13;
	for (let j = 0; j < n; j++) {
		const f = 0.3 + 0.62 * (j / (n - 1));
		const h = DEPTH + full * f;
		// a leaf unrolls once the stem has grown past it
		const lg = clamp((H - h) / 0.14);
		if (lg <= 0) break;
		const side = j % 2 ? 1 : -1;
		const size = (0.17 + 0.07 * Math.sin(Math.PI * (0.25 + 0.6 * (j / (n - 1))))) * vigour * about(sr, 1, 0.08);
		const tilt = lerp(0.12, between(sr, 0.85, 1.15) - 0.25 * (j / n), lg) + dead * 0.5;
		const o = out.clone().multiplyScalar(side).applyAxisAngle(v3(0, 1, 0), about(sr, 0, 0.15));
		const dir = o.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
		const colour = mix(mix('#8ac05a', '#3f7a2e', lg), '#d8c060', clamp(dead * 1.3 - (1 - j / n) * 0.2));
		bag.add(
			'sheet',
			sheet({
				length: size * lerp(0.35, 1, lg),
				width: size * 0.085 * lerp(0.4, 1, lg),
				shape: lance,
				// rolled while it unfurls, then flat, arching over at the tip
				lift: (u, v) => (1 - lg) * 0.25 * v * v + 0.03 * v * v - (0.12 + dead * 0.3) * u * u,
				paint: (u, v) => colour.clone().lerp(new THREE.Color('#a8c88a'), Math.abs(v) < 0.08 ? 0.35 : 0),
				along: 9,
				across: 2
			}),
			aim(at(h).addScaledVector(o, 0.004), dir, 0)
		);
	}
}
