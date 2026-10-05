/*
 * HERBS — the kitchen herbs, each a description for one of three builders:
 *
 * The mint family (Lamiaceae): square stems, leaves in opposite pairs, each pair turned a quarter from the last; side
 * shoots from the leaf axils; little two-lipped flowers in whorls up spikes at the tips, or in the axils. Basil, mint
 * (which runs underground and over it), sage, thyme, rosemary, oregano, lemon balm — soft and annual, or woody and
 * evergreen.
 *
 * The carrot family (Apiaceae): a rosette of divided leaves, then a hollow stem carrying flat umbels of tiny flowers,
 * each ray ending in a smaller umbel, then the seeds. Parsley, dill, coriander.
 *
 * The onion family (Allium): chives, a clump of hollow tubular leaves with purple pompoms; Bärlauch (wild garlic), a
 * woodland bulb with two or three broad leaves and a white star-flowered umbel in spring, then gone till next year.
 */
import * as THREE from 'three';
import { Bag, about, aim, bead, between, chance, clamp, lerp, mix, root, sheet, span, table, tube, v3 } from './grow.js';
import { sprout } from './sprout.js';
import { pinnate } from './leaves.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/* ------------------------------------------------------------------------------------------------ mint family */

/**
 * @typedef {{
 *   seed: { size: number, colour: string }, height: [number, number][], internode: number, branching: number, depth: number,
 *   spread: number, stem: string, woody?: string, leaf: { length: number, width: number, shape: (u: number) => number, colour: string, young: string, droop: number, wrinkle?: number, grey?: number },
 *   flower: { colour: string, at: number, kind: 'spike' | 'axils' | 'cluster', size: number, seed?: string }, runners?: number, stems?: number
 * }} Bush — a mint-family herb: its seed, its height through the stages, the spacing of its leaf pairs, how readily it
 *   branches and how deep, its leaves (and how grey or wrinkled), its flowers (in spikes at the tips, in the leaf
 *   axils, or in clusters), and whether it runs (mint)
 */

/**
 * @param {Bush} spec
 * @returns {(g: number, seed: string) => THREE.Group}
 */
export function bush(spec) {
	return (g, seed) => {
		const bag = new Bag();
		const vigour = about(chance(seed, 'plant'), 1, 0.1);
		const at = v3(0, -0.004, 0);
		const s = sprout(bag, {
			seed, at, size: v3(spec.seed.size, spec.seed.size * 0.6, spec.seed.size * 0.7), coat: spec.seed.colour, coatShade: '#3a2a20',
			stem: table(g, [[0, 0], [0.3, 0.0005], [1, 0.006], [2, 0.014], [9, 0.016]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
			radius: 0.0005 + 0.0012 * span(g, 1, 4), stemColor: spec.stem,
			leaf: { length: 0.006, width: 0.0028, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6), color: '#6aa046', vein: '#a6c47e' },
			open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 3, 3.8)
		});
		root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.25, grown: table(g, [[0, 0], [0.3, 0.02], [1, 0.08], [3, 0.4], [5, 0.85], [7, 1]]), radius: 0.0012 + 0.0025 * span(g, 3, 8), down: 0.04, wander: 0.2, laterals: 10, lateral: 0.4, depth: 2, age: span(g, 3, 8), young: '#f4ead6', old: '#a8865a' });
		const H = table(g, spec.height) * vigour;
		// a few stems from the base for the shrubby ones, one for the rest
		const stems = spec.stems ?? 1;
		for (let k = 0; k < stems; k++) {
			const sr = chance(seed, 'stem', k);
			const a = k * 2.39996 + sr() * 0.5;
			const lean = k === 0 ? 0.05 : between(sr, 0.25, 0.6);
			const born = 2 + k * 0.35;
			if (g <= born) break;
			shoot(bag, spec, seed, ['s', k], s.top.clone(), v3(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean)), H * (k === 0 ? 1 : between(sr, 0.65, 0.9)), clamp((g - born) / 2.5) * (H > 0 ? 1 : 0), 0, g, vigour);
		}
		// mint's runners: stolons over and under the soil, rooting and sending up new shoots
		for (let k = 0; k < (spec.runners ?? 0); k++) {
			const rr = chance(seed, 'runner', k);
			const born = 3.4 + k * 0.35;
			if (g <= born) break;
			const a = k * 2.39996 + rr() * 0.6;
			const len = Math.min(0.35, (g - born) * 0.12) * vigour;
			const pts = [];
			for (let m = 0; m <= 8; m++) pts.push(v3(Math.cos(a + Math.sin(m) * 0.2) * len * (m / 8), -0.008 + 0.006 * Math.sin(m * 1.3), Math.sin(a + Math.sin(m) * 0.2) * len * (m / 8)));
			bag.add('body', tube(pts, () => 0.0018, () => '#c8b8a0', 4));
			const end = pts[8];
			root(bag, { seed, key: ['run-root', k], from: end.clone(), dir: v3(0, -1, 0), length: 0.08, grown: clamp((g - born) / 1.5), radius: 0.0008, laterals: 4, depth: 1, young: '#f4ead6', old: '#c8a878' });
			shoot(bag, spec, seed, ['r', k], end.clone().setY(0), v3(rr() * 0.2, 1, rr() * 0.2), H * 0.7, clamp((g - born - 0.3) / 1.8), 1, g, vigour);
		}
		return bag.build();
	};
}

/**
 * A square stem, its leaves in opposite pairs, its side shoots from the axils, its flowers at the tip or along it.
 * @param {Bag} bag @param {Bush} spec @param {string} seed @param {(string | number)[]} key @param {THREE.Vector3} from
 * @param {THREE.Vector3} dir @param {number} length @param {number} grown @param {number} order @param {number} g @param {number} vigour
 */
function shoot(bag, spec, seed, key, from, dir, length, grown, order, g, vigour) {
	if (grown <= 0.01 || length < 0.005) return;
	const r = chance(seed, 'shoot', ...key);
	const reach = length * clamp(grown);
	const nodes = Math.max(1, Math.floor(reach / spec.internode));
	const d = dir.clone().normalize();
	const pts = [from.clone()];
	for (let k = 0; k < 10; k++) {
		d.lerp(v3(0, 1, 0), 0.08).add(v3((r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.06)).normalize();
		pts.push(pts[k].clone().addScaledVector(d, reach / 10));
	}
	const woody = spec.woody ? span(g, 3.5, 7) * (1 - order * 0.4) : 0;
	const radius = (0.0012 + 0.0022 * clamp(length / 0.5)) * (order ? 0.7 : 1) * (1 + woody);
	bag.add('body', tube(pts, (u) => radius * (1 - 0.5 * u), (u) => mix(spec.stem, spec.woody ?? spec.stem, woody * (1 - u)), 4));
	const along = (/** @type {number} */ u) => {
		const f = clamp(u) * 10, k = Math.min(9, Math.floor(f));
		return { p: pts[k].clone().lerp(pts[k + 1], f - k), t: pts[k + 1].clone().sub(pts[k]).normalize() };
	};
	const L = spec.leaf;
	const flowering = g > spec.flower.at;
	for (let n = 0; n < nodes; n++) {
		const u = (n + 0.5) / nodes;
		const { p, t } = along(u);
		// each pair a quarter-turn from the last
		const turn = n * (Math.PI / 2) + r() * 0.15;
		const side = new THREE.Vector3().crossVectors(t, v3(0, 1, 0));
		if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
		side.normalize().applyAxisAngle(t, turn);
		// young leaves at the tip small and upright, older ones below full and spreading; the lowest of a woody herb gone
		const age = clamp((1 - u) * reach / 0.12);
		const size = lerp(0.35, 1, age) * vigour * (order ? 0.85 : 1);
		if (spec.woody && u < 0.25 * woody) continue;
		for (const s of [-1, 1]) {
			const out = side.clone().multiplyScalar(s);
			const dirL = out.clone().multiplyScalar(lerp(0.4, 1, age)).addScaledVector(t, lerp(0.9, 0.25, age)).add(v3(0, -L.droop * age, 0)).normalize();
			const len = L.length * size;
			bag.add(
				'sheet',
				sheet({
					length: len,
					width: L.width * size,
					shape: L.shape,
					lift: (uu, v) => 0.1 * v * v * (1 - age * 0.5) - 0.05 * uu * uu + (L.wrinkle ?? 0) * Math.sin(uu * 30 + v * 7) * 0.01,
					paint: (uu, v) => mix(mix(L.young, L.colour, age), '#b8bca8', L.grey ?? 0).lerp(new THREE.Color('#d8e0b8'), Math.abs(v) < 0.1 ? 0.25 : 0),
					along: 6,
					across: 2
				}),
				aim(p, dirL, 0)
			);
			// flowers in the axils (lemon balm, rosemary)
			if (flowering && spec.flower.kind === 'axils' && n % 2 === 0 && u > 0.3) {
				const f = span(g, spec.flower.at, spec.flower.at + 0.5) * (1 - span(g, spec.flower.at + 1.6, spec.flower.at + 2.4));
				if (f > 0) for (let m = 0; m < 3; m++) bag.add('body', bead(p.clone().addScaledVector(out, 0.004 + m * 0.002).add(v3(0, 0.002, 0)), v3(1, 1.3, 1).multiplyScalar(spec.flower.size * f), spec.flower.colour, 2));
			}
		}
		// side shoots from the axils of the lower and middle pairs
		if (order < spec.depth && u < 0.75 && n > 0) {
			for (const s of [-1, 1]) {
				const br = chance(seed, 'branch', ...key, n, s);
				if (br() > spec.branching) continue;
				const sd = side.clone().multiplyScalar(s * spec.spread).addScaledVector(t, 1).normalize();
				const sub = length * (1 - u) * between(br, 0.55, 0.85);
				shoot(bag, spec, seed, [...key, n, s], p, sd, sub, (reach - u * reach) / (sub * 1.4), order + 1, g, vigour);
			}
		}
	}
	// the flowers at the tip: whorls up a spike, or a cluster
	if (!flowering || spec.flower.kind === 'axils' || grown < 0.6) return;
	const f = span(g, spec.flower.at, spec.flower.at + 0.6);
	const seeding = span(g, spec.flower.at + 1.5, spec.flower.at + 2.5);
	const tip = pts[10];
	const td = pts[10].clone().sub(pts[9]).normalize();
	if (spec.flower.kind === 'spike') {
		const spikeLen = 0.06 * f * (order ? 0.7 : 1);
		const end = tip.clone().addScaledVector(td, spikeLen);
		bag.add('body', tube([tip, end], () => radius * 0.5, () => spec.stem, 3));
		for (let w = 0; w < 6; w++) {
			const p = tip.clone().lerp(end, (w + 0.5) / 6);
			for (let m = 0; m < 6; m++) {
				const a = (m / 6) * Math.PI * 2 + w;
				bag.add('body', bead(p.clone().add(v3(Math.cos(a) * 0.004, 0, Math.sin(a) * 0.004)), v3(1, 1.4, 1).multiplyScalar(spec.flower.size * (w > 3 ? 0.6 : 1)), seeding > 0.5 ? (spec.flower.seed ?? '#6a5a3a') : spec.flower.colour, 2));
			}
		}
	} else {
		for (let m = 0; m < 14; m++) {
			const a = m * 2.39996, rr = Math.sqrt(m / 14) * 0.012;
			bag.add('body', bead(tip.clone().add(v3(Math.cos(a) * rr, 0.003 - rr * 0.3, Math.sin(a) * rr)), v3(1, 1, 1).multiplyScalar(spec.flower.size * f), seeding > 0.5 ? (spec.flower.seed ?? '#6a5a3a') : spec.flower.colour, 2));
		}
	}
}

/** leaf shapes: ovate, lanceolate, needle, round, toothed-ovate, heart-shaped */
const ovate = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.7);
const lance = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.65);
const needle = (/** @type {number} */ u) => (1 - u * 0.6) * Math.min(1, u * 8 + 0.3);
const round = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * u), 0.55);
const toothed = (/** @type {number} */ u) => ovate(u) * (1 + (u > 0.1 && u < 0.9 ? ((u * 12) % 1) * 0.12 : 0));
const heart = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 0.6) * (1 + (u > 0.1 && u < 0.92 ? ((u * 11) % 1) * 0.12 : 0));

/** the ten stages of a herb grown from seed, its own words for the last ones */
const herbStages = (/** @type {string} */ seedNote, /** @type {[string, number, string][]} */ later) =>
	stages([['Seed', 0, seedNote], ['Germination', 7, 'The radicle goes down, the hook comes up.'], ['Seed leaves', 12, 'Two small round seed leaves.'], ['True leaves', 21, 'The first pair of true leaves, already smelling of the herb.'], ...later]);

export const BASIL_STAGES = herbStages('A tiny black seed that turns jelly-coated when wet, barely covered: basil wants warmth and light.', [
	['Young plant', 35, 'Pairs of glossy cupped leaves up a soft square stem.'],
	['Pinched', 45, 'The tip pinched out: two side shoots from every axil, a bushy plant.'],
	['Bushy', 60, 'A bush of bright green, cupped, sweet-smelling leaves: harvest from the top.'],
	['Buds', 75, 'Flower spikes form at the tips.'],
	['Flowering', 85, 'White whorled spikes, loud with bees; the leaves now fewer and sharper.'],
	['Seeding', 100, 'The spikes brown and set seed; an annual, it is done for the year.']
]);
export const basil = bush({
	seed: { size: 0.0009, colour: '#1a1a1a' }, height: [[2, 0], [3, 0.04], [4, 0.14], [5, 0.25], [6, 0.35], [7, 0.42], [8, 0.48], [9, 0.5]],
	internode: 0.035, branching: 0.85, depth: 2, spread: 1.0, stem: '#6a9a3a',
	leaf: { length: 0.055, width: 0.024, shape: ovate, colour: '#3f8a2a', young: '#7ac04a', droop: 0.25 },
	flower: { colour: '#f4f2ea', at: 7.0, kind: 'spike', size: 0.002 }
});

export const MINT_STAGES = herbStages('A dust-fine brown seed on the surface — or, as most do, a piece of runner from a friend.', [
	['Young plant', 30, 'Toothed, wrinkled leaves in pairs on a purplish square stem.'],
	['Running', 50, 'Runners creep out over and under the soil, rooting as they go.'],
	['Spreading', 80, 'A patch: new shoots come up wherever the runners root. Plant it in a pot or it takes the garden.'],
	['Buds', 100, 'Slim flower spikes at the tips.'],
	['Flowering', 110, 'Lilac whorled spikes humming with bees and butterflies.'],
	['Seeding', 130, 'The spikes brown; the runners keep spreading underground.']
]);
export const mint = bush({
	seed: { size: 0.0006, colour: '#5a4030' }, height: [[2, 0], [3, 0.04], [4, 0.18], [5, 0.3], [6, 0.4], [7, 0.5], [8, 0.55], [9, 0.55]],
	internode: 0.035, branching: 0.4, depth: 1, spread: 0.8, stem: '#6a5a4a',
	leaf: { length: 0.05, width: 0.02, shape: toothed, colour: '#3a7a2a', young: '#6aa84a', droop: 0.15, wrinkle: 0.4 },
	flower: { colour: '#c8a0d8', at: 7.0, kind: 'spike', size: 0.0018 }, runners: 6
});

export const SAGE_STAGES = herbStages('A round dark seed, a few millimetres down.', [
	['Young plant', 45, 'Soft grey-green leaves, pebbled and felted.'],
	['Bushing', 120, 'A low bush; its oldest stems turning woody.'],
	['Woody', 365, 'An evergreen shrub on woody stems, the leaves silver-grey.'],
	['Buds', 400, 'Tall flower spikes rise above the leaves in its second spring.'],
	['Flowering', 420, 'Violet-blue two-lipped flowers in whorls up the spikes.'],
	['Seeding', 450, 'Cut back after flowering, it pushes new soft growth.']
]);
export const sage = bush({
	seed: { size: 0.0016, colour: '#2a2a20' }, height: [[2, 0], [3, 0.04], [4, 0.15], [5, 0.3], [6, 0.45], [7, 0.55], [9, 0.6]],
	internode: 0.04, branching: 0.6, depth: 2, spread: 1.0, stem: '#8a9a7a', woody: '#7a6a54', stems: 3,
	leaf: { length: 0.065, width: 0.022, shape: ovate, colour: '#7a8a6a', young: '#9aa88a', droop: 0.2, wrinkle: 0.6, grey: 0.25 },
	flower: { colour: '#7a6ac8', at: 7.0, kind: 'spike', size: 0.0028 }
});

export const THYME_STAGES = herbStages('A seed like dust, sown on the surface: thyme wants light.', [
	['Young plant', 40, 'Wiry stems with tiny pointed leaves in pairs.'],
	['Bushing', 120, 'A dense mound of wiry branches.'],
	['Woody', 365, 'A little evergreen shrub, its stems woody and twisted.'],
	['Buds', 400, 'Tiny buds crowd the shoot tips.'],
	['Flowering', 410, 'Clouds of tiny pink flowers, alive with bees.'],
	['Seeding', 440, 'Trimmed after flowering, it stays compact for years.']
]);
export const thyme = bush({
	seed: { size: 0.0005, colour: '#4a3a2a' }, height: [[2, 0], [3, 0.02], [4, 0.07], [5, 0.13], [6, 0.18], [7, 0.22], [9, 0.24]],
	internode: 0.012, branching: 0.75, depth: 3, spread: 1.2, stem: '#7a6a4a', woody: '#6a5040', stems: 6,
	leaf: { length: 0.008, width: 0.0028, shape: lance, colour: '#4a6a3a', young: '#6a8a4a', droop: 0.1, grey: 0.15 },
	flower: { colour: '#e0a8c8', at: 7.0, kind: 'cluster', size: 0.0016 }
});

export const ROSEMARY_STAGES = herbStages('A small brown seed, slow and fickle — most rosemary is grown from cuttings.', [
	['Young plant', 60, 'An upright stem crowded with dark needle leaves, white beneath.'],
	['Bushing', 180, 'Several stems, the lower ones going woody.'],
	['Woody', 450, 'An evergreen shrub of upright woody stems, resinous to the touch.'],
	['Buds', 520, 'Buds in the leaf axils along last year’s shoots.'],
	['Flowering', 540, 'Pale blue flowers all along the stems in late winter and spring.'],
	['Seeding', 580, 'Flowering over; cut back the tips to keep it dense.']
]);
export const rosemary = bush({
	seed: { size: 0.0016, colour: '#6a4a30' }, height: [[2, 0], [3, 0.04], [4, 0.2], [5, 0.38], [6, 0.55], [7, 0.68], [9, 0.75]],
	internode: 0.008, branching: 0.12, depth: 1, spread: 0.5, stem: '#6a7a4a', woody: '#6a5a4a', stems: 4,
	leaf: { length: 0.028, width: 0.0022, shape: needle, colour: '#2f4f2a', young: '#5a7a4a', droop: 0.05 },
	flower: { colour: '#a8b8e8', at: 7.0, kind: 'axils', size: 0.0022 }
});

export const OREGANO_STAGES = herbStages('A seed like dust, sown on the surface.', [
	['Young plant', 35, 'A low mat of small round downy leaves.'],
	['Spreading', 80, 'Creeping stems spread the mat wide.'],
	['Upright', 120, 'Upright stems rise from the mat.'],
	['Buds', 140, 'The stems branch at their tops into tight bud clusters.'],
	['Flowering', 150, 'Flat clusters of tiny pink-purple flowers with purple bracts: the bees’ favourite.'],
	['Seeding', 180, 'Cut the stems in flower and dry them: that is when it tastes strongest.']
]);
export const oregano = bush({
	seed: { size: 0.0004, colour: '#4a3a2a' }, height: [[2, 0], [3, 0.03], [4, 0.1], [5, 0.2], [6, 0.32], [7, 0.4], [9, 0.45]],
	internode: 0.025, branching: 0.55, depth: 2, spread: 1.1, stem: '#7a4a4a', stems: 7,
	leaf: { length: 0.02, width: 0.011, shape: round, colour: '#4a7a3a', young: '#7aa04a', droop: 0.2 },
	flower: { colour: '#c878b0', at: 7.0, kind: 'cluster', size: 0.0022 }
});

export const LEMON_BALM_STAGES = herbStages('A small dark seed on the surface, kept moist.', [
	['Young plant', 40, 'Bright green, heart-shaped, toothed and crinkled leaves, smelling of lemon.'],
	['Bushing', 90, 'A dense clump of upright branching stems.'],
	['Clump', 150, 'A clump half a metre high and wide; it self-seeds freely.'],
	['Buds', 170, 'Tiny buds in the leaf axils along the upper stems.'],
	['Flowering', 180, 'Small white flowers in the axils: Melissa, the bees’ herb.'],
	['Seeding', 210, 'It seeds everywhere unless cut back after flowering.']
]);
export const lemonBalm = bush({
	seed: { size: 0.0012, colour: '#2a2018' }, height: [[2, 0], [3, 0.04], [4, 0.16], [5, 0.3], [6, 0.42], [7, 0.5], [9, 0.55]],
	internode: 0.04, branching: 0.5, depth: 2, spread: 0.9, stem: '#7a9a4a', stems: 4,
	leaf: { length: 0.05, width: 0.024, shape: heart, colour: '#5a9a3a', young: '#8ac05a', droop: 0.2, wrinkle: 0.5 },
	flower: { colour: '#f6f2e8', at: 7.0, kind: 'axils', size: 0.0016 }
});

/* ------------------------------------------------------------------------------------------------ carrot family */

/**
 * @typedef {{
 *   seed: { size: number, colour: string }, leaves: number, leafLength: number, leaflet: { length: number, width: number, shape: (u: number) => number }, pairs: number,
 *   colour: string, stalk: number, stalkAt: number, bloomAt: number, seedAt: number, umbel: { colour: string, rays: number, size: number, seed: string }, feathery?: boolean, curly?: boolean
 * }} Umbel
 */

/** a feathery leaflet: thread-thin (dill), or cut into narrow lobes (coriander's upper leaves) */
const thread = (/** @type {number} */ u) => 0.15 * (1 - u) + 0.05;
const flatLeaf = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.7) * (1 + (u > 0.2 ? Math.abs(Math.sin(u * 14)) * 0.3 : 0));

/**
 * @param {Umbel} spec
 * @returns {(g: number, seed: string) => THREE.Group}
 */
export function umbellifer(spec) {
	return (g, seed) => {
		const bag = new Bag();
		const vigour = about(chance(seed, 'plant'), 1, 0.1);
		const at = v3(0, -0.006, 0);
		const s = sprout(bag, {
			seed, at, size: v3(spec.seed.size, spec.seed.size * 0.5, spec.seed.size * 0.5), coat: spec.seed.colour, coatShade: '#5a4a30',
			stem: table(g, [[0, 0], [0.3, 0.0006], [1, 0.01], [2, 0.02], [9, 0.02]]), hook: table(g, [[0, 1], [1, 1], [1.5, 0]]),
			radius: 0.0006 + 0.001 * span(g, 1, 4), stemColor: '#7a9a4a',
			leaf: { length: 0.018, width: 0.002, shape: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.6), color: '#5a9a3c', vein: '#9cc46e' },
			open: span(g, 1.1, 2), shed: span(g, 1, 1.5), wither: span(g, 3.5, 4.5)
		});
		root(bag, { seed, key: ['tap'], from: at.clone(), dir: v3(0, -1, 0), length: 0.3, grown: table(g, [[0, 0], [0.3, 0.02], [1, 0.1], [3, 0.4], [5, 0.85], [7, 1]]), radius: 0.0015 + 0.003 * span(g, 3, 7), down: 0.05, wander: 0.15, laterals: 9, lateral: 0.35, depth: 2, age: span(g, 3, 8), young: '#f6efdc', old: '#d8c49a' });
		// the rosette of divided leaves
		const fade = span(g, spec.seedAt - 0.3, spec.seedAt + 1);
		for (let i = 0; i < spec.leaves; i++) {
			const born = 2 + i * (3 / spec.leaves);
			if (g <= born) break;
			const lr = chance(seed, 'leaf', i);
			const grown = clamp((g - born) / 1);
			pinnate(bag, {
				seed, key: ['u', i], at: s.top.clone(), out: v3(Math.cos(i * 2.39996), 0, Math.sin(i * 2.39996)), lift: between(lr, 0.7, 1.15) - fade * 0.6,
				length: spec.leafLength * lerp(0.4, 1, clamp(i / 5)) * vigour, pairs: spec.pairs,
				leaflet: { length: spec.leaflet.length * vigour, width: spec.leaflet.width * vigour, shape: spec.leaflet.shape, colour: spec.colour, young: '#8ac05a', vein: spec.colour, old: '#c8b04a' },
				grown, old: fade, stalk: '#7aa04a', radius: 0.0012, terminal: 1, between: spec.feathery, curl: spec.curly ? 0.6 : 0
			});
		}
		// the flowering stem: up, branching, an umbel at each end
		const rise = span(g, spec.stalkAt, spec.stalkAt + 1);
		if (rise <= 0) return bag.build();
		const H = spec.stalk * rise * vigour;
		const top = s.top.clone().add(v3(0.01, H, 0));
		bag.add('body', tube([s.top, s.top.clone().add(v3(0, H * 0.5, 0.005)), top], (u) => 0.004 * (1 - 0.5 * u), () => mix('#7a9a4a', '#b8a060', fade), 6));
		const ends = [top];
		for (let b = 0; b < 3; b++) {
			const br = chance(seed, 'branch', b);
			const from = s.top.clone().add(v3(0, H * (0.45 + b * 0.15), 0));
			const a = b * 2.4 + br() * 0.5;
			const end = from.clone().add(v3(Math.cos(a) * H * 0.18, H * 0.32, Math.sin(a) * H * 0.18));
			bag.add('body', tube([from, end], () => 0.0022, () => mix('#7a9a4a', '#b8a060', fade), 4));
			ends.push(end);
			if (spec.feathery) pinnate(bag, { seed, key: ['stem-leaf', b], at: from, out: v3(Math.cos(a + 1.5), 0, Math.sin(a + 1.5)), lift: 0.6, length: spec.leafLength * 0.4, pairs: 2, leaflet: { length: spec.leaflet.length * 0.7, width: spec.leaflet.width * 0.7, shape: thread, colour: spec.colour, young: '#8ac05a', vein: spec.colour }, grown: 1, old: fade, stalk: '#7aa04a', radius: 0.0008, terminal: 1 });
		}
		const bloom = span(g, spec.bloomAt, spec.bloomAt + 0.6);
		const seeds = span(g, spec.seedAt, spec.seedAt + 0.8);
		ends.forEach((end, e) => {
			const size = spec.umbel.size * (e === 0 ? 1 : 0.7) * lerp(0.3, 1, bloom);
			for (let k = 0; k < spec.umbel.rays; k++) {
				const a = (k / spec.umbel.rays) * Math.PI * 2;
				const ray = end.clone().add(v3(Math.cos(a) * size, size * 0.35, Math.sin(a) * size));
				bag.add('body', tube([end, ray], () => 0.0006, () => '#8aa85a', 3));
				for (let m = 0; m < 7; m++) {
					const b2 = (m / 7) * Math.PI * 2;
					bag.add('body', bead(ray.clone().add(v3(Math.cos(b2) * size * 0.18, size * 0.06, Math.sin(b2) * size * 0.18)), v3(1, 1, 1).multiplyScalar(0.0016 * lerp(0.5, 1, bloom)), seeds > 0.3 ? mix('#8aa85a', spec.umbel.seed, seeds) : mix('#b8c88a', spec.umbel.colour, bloom), 2));
				}
			}
		});
		return bag.build();
	};
}

export const PARSLEY_STAGES = herbStages('A ribbed grey-brown seed, slow: three or four weeks to come up.', [
	['Rosette', 60, 'A rosette of flat, deeply divided, toothed leaves on long stalks: cut from the outside.'],
	['Full rosette', 120, 'A full dark-green rosette, cut and cut again all summer.'],
	['Winter', 240, 'It sits through the winter, a few leaves green.'],
	['Bolting', 300, 'Its second spring: a stem shoots up from the middle.'],
	['Flowering', 320, 'Flat umbels of tiny yellow-green flowers.'],
	['Seeding', 350, 'Ribbed seeds ripen and brown; the plant dies, having seeded.']
]);
export const parsley = umbellifer({
	seed: { size: 0.0025, colour: '#8a7a5a' }, leaves: 16, leafLength: 0.22, pairs: 2, colour: '#2f6a28',
	leaflet: { length: 0.03, width: 0.026, shape: flatLeaf }, stalk: 0.7, stalkAt: 6.6, bloomAt: 7.6, seedAt: 8.5, umbel: { colour: '#d8d880', rays: 14, size: 0.035, seed: '#6a5a3a' }
});

export const DILL_STAGES = herbStages('A flat oval ribbed seed, a centimetre down, straight where it is to grow.', [
	['Feathery', 30, 'Thread-fine blue-green leaves, a feathery plume.'],
	['Stem', 45, 'A single hollow, ribbed stem shoots up, feathery leaves along it.'],
	['Tall', 55, 'A metre of blue-green stem.'],
	['Umbels', 65, 'Big flat umbels of tiny yellow flowers, like fireworks.'],
	['Flowering', 75, 'Umbel after umbel open; the hoverflies come.'],
	['Seeding', 95, 'Flat seeds ripen brown in the umbels: dill seed, for pickles.']
]);
export const dill = umbellifer({
	seed: { size: 0.0035, colour: '#7a6a4a' }, leaves: 6, leafLength: 0.25, pairs: 4, colour: '#4a7a5a',
	leaflet: { length: 0.05, width: 0.004, shape: thread }, stalk: 1.0, stalkAt: 4.6, bloomAt: 6.6, seedAt: 8.4, umbel: { colour: '#f2d82a', rays: 22, size: 0.07, seed: '#7a5a3a' }, feathery: true
});

export const CORIANDER_STAGES = herbStages('A round, ridged, pale brown seed — it is two seeds in one husk.', [
	['Leafy', 30, 'Broad, rounded, lobed lower leaves: the coriander leaf (cilantro).'],
	['Bolting', 45, 'A stem shoots up; its upper leaves are fine and feathery.'],
	['Tall', 55, 'Branching stems, the leaf harvest over.'],
	['Umbels', 60, 'Small umbels of white and pale pink flowers, the outer petals larger.'],
	['Flowering', 70, 'Lacy white umbels everywhere.'],
	['Seeding', 90, 'Round green seeds that ripen pale brown: coriander seed, the spice.']
]);
export const coriander = umbellifer({
	seed: { size: 0.003, colour: '#b89a6a' }, leaves: 9, leafLength: 0.14, pairs: 1, colour: '#3f8a2e',
	leaflet: { length: 0.035, width: 0.03, shape: flatLeaf }, stalk: 0.6, stalkAt: 4.6, bloomAt: 6.6, seedAt: 8.4, umbel: { colour: '#f4e8ec', rays: 8, size: 0.03, seed: '#b89a6a' }, feathery: true
});

/* ------------------------------------------------------------------------------------------------ onion family */

export const CHIVES_STAGES = herbStages('A small black angular seed, a centimetre down.', [
	['Grass', 25, 'Thin hollow green leaves like fine grass.'],
	['Tuft', 50, 'A tuft of tubular leaves from little bulbs.'],
	['Clump', 90, 'A dense clump, cut down and growing back again and again.'],
	['Buds', 365, 'Its second spring: buds in papery sheaths on firm stalks.'],
	['Flowering', 380, 'Purple pompoms of little star flowers — edible too.'],
	['Seeding', 410, 'The heads dry and drop black seeds; cut back, it grows fresh leaves.']
]);

/**
 * Chives: a clump of little bulbs, hollow tubular leaves, purple pompoms.
 * @param {number} g @param {string} seed
 */
export function chives(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.1);
	const shoots = Math.round(table(g, [[1, 1], [2, 2], [3, 5], [4, 12], [5, 26], [6, 34], [9, 40]]));
	for (let i = 0; i < shoots; i++) {
		const sr = chance(seed, 'chive', i);
		const d = Math.sqrt(i / 40) * 0.06, a = i * 2.39996;
		const base = v3(Math.cos(a) * d, -0.01, Math.sin(a) * d);
		const H = table(g, [[1, 0.02], [2, 0.06], [3, 0.14], [4, 0.24], [9, 0.3]]) * between(sr, 0.7, 1.1) * vigour;
		bag.add('body', bead(base, v3(0.004, 0.008, 0.004), '#f0e8d8', 4));
		if (i % 2 === 0) root(bag, { seed, key: ['r', i], from: base.clone(), dir: v3(sr() - 0.5, -1, sr() - 0.5), length: 0.15, grown: span(g, 0.5, 4), radius: 0.0007, laterals: 3, depth: 1, young: '#f6efe0', old: '#e0d0b0' });
		for (let k = 0; k < 3; k++) {
			const lean = between(sr, 0.05, 0.35);
			const b = sr() * Math.PI * 2;
			const pts = [];
			for (let m = 0; m <= 8; m++) {
				const t = m / 8;
				pts.push(base.clone().add(v3(Math.cos(b) * Math.sin(lean) * H * t + Math.cos(b) * lean * 0.05 * t * t * H * 3, H * t * Math.cos(lean * 0.5), Math.sin(b) * Math.sin(lean) * H * t)));
			}
			bag.add('body', tube(pts, (u) => 0.0018 * (1 - 0.85 * u), (u) => mix('#3f7a2e', '#7ab04a', u * 0.4), 5));
		}
		// a flower stalk on some, its pompom
		if (g < 6.4 || sr() > 0.45) continue;
		const bloom = span(g, 7.2, 7.9), seeding = span(g, 8.5, 9.2);
		const top = base.clone().add(v3((sr() - 0.5) * 0.03, H * 1.1, (sr() - 0.5) * 0.03));
		bag.add('body', tube([base, top], () => 0.0016, () => '#5a8a3a', 4));
		if (bloom <= 0) {
			bag.add('body', bead(top, v3(0.004, 0.009, 0.004), '#d8d0c0', 4));
			continue;
		}
		for (let m = 0; m < 26; m++) {
			const p = m / 26, phi = Math.acos(1 - 2 * p), th = m * 2.39996;
			bag.add('body', bead(top.clone().add(v3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)).multiplyScalar(0.011 * bloom)), v3(0.0028, 0.0028, 0.0028).multiplyScalar(lerp(0.5, 1, bloom)), mix('#b878c8', '#8a7a5a', seeding), 2));
		}
	}
	return bag.build();
}

export const WILD_GARLIC_STAGES = stages([
	['Seed', 0, 'A small black seed dropped in the leaf litter of a damp beech wood in early summer.'],
	['Winter cold', 180, 'It needs a winter’s cold before it will wake.'],
	['Germination', 270, 'In early spring a root, and a single thread-like leaf.'],
	['First bulb', 330, 'A tiny bulb forms; the leaf yellows and is gone by summer.'],
	['Young plant', 640, 'Its second spring: one narrow leaf on a stalk, the bulb a little bigger.'],
	['Spring leaves', 1000, 'In its third or fourth spring, two or three broad bright-green leaves: Bärlauch, smelling strongly of garlic.'],
	['Bud', 1030, 'A bud rises on a three-sided stalk, wrapped in a papery spathe.'],
	['Flowering', 1045, 'The spathe splits: a loose ball of white six-pointed stars. The wood floor goes white.'],
	['Seeds', 1070, 'Green three-lobed capsules swell where the stars were; the leaves begin to yellow.'],
	['Dieback', 1090, 'The leaves die back to the bulb; the seeds drop; above ground, nothing until next March.']
]);

/**
 * Wild garlic: a patch of bulbs in the leaf litter, broad leaves, white star umbels, gone by summer.
 * @param {number} g @param {string} seed
 */
export function wildGarlic(g, seed) {
	const bag = new Bag();
	const vigour = about(chance(seed, 'plant'), 1, 0.1);
	// the mother and her offsets: a patch
	const plants = g < 5 ? 1 : 5;
	for (let p = 0; p < plants; p++) {
		const pr = chance(seed, 'bulb', p);
		const d = p === 0 ? 0 : between(pr, 0.07, 0.14), a = p * 2.39996;
		const base = v3(Math.cos(a) * d, -0.05, Math.sin(a) * d);
		const age = p === 0 ? 1 : 0.6 + pr() * 0.3;
		const bulb = span(g, 2.6, 5.5) * age;
		if (g < 2) {
			if (p === 0) bag.add('body', bead(v3(0, -0.005, 0), v3(0.0015, 0.0012, 0.0012), '#1a1a1a', 4));
			if (g < 1.8) continue;
		}
		bag.add('body', bead(base, v3(0.003 + 0.007 * bulb, 0.005 + 0.016 * bulb, 0.003 + 0.007 * bulb), '#f4f0e6', 6));
		root(bag, { seed, key: ['r', p], from: base.clone().add(v3(0, -0.01, 0)), dir: v3(0, -1, 0), length: 0.12, grown: span(g, 1.8, 5), radius: 0.0008, laterals: 8, lateral: 0.3, depth: 1, young: '#f6f0e4', old: '#e0d4bc' });
		// the leaves: one thread in the first spring, one narrow leaf in the second, then two or three broad ones
		const die = span(g, 8.4, 9.5);
		const thread = g < 4.5;
		const n = thread ? 1 : g < 5 ? 1 : 2 + Math.floor(pr() * 2);
		const up = g < 3 ? span(g, 2, 2.6) * (1 - span(g, 2.9, 3.4)) : thread ? span(g, 3.6, 4.2) : span(g, 4.6, 5.2);
		if (up <= 0.01) continue;
		for (let k = 0; k < n; k++) {
			const lr = chance(seed, 'garlic-leaf', p, k);
			const b = k * 2.6 + pr() * 6;
			const out = v3(Math.cos(b), 0, Math.sin(b));
			const len = (thread ? 0.06 : g < 5 ? 0.12 : between(lr, 0.18, 0.25)) * vigour * up * age;
			const stalk = len * 0.45;
			const s0 = base.clone().add(v3(0, 0.05, 0));
			const s1 = s0.clone().addScaledVector(out, stalk * 0.25).add(v3(0, stalk, 0));
			bag.add('body', tube([base, s0, s1], () => 0.002, () => mix('#8ab05a', '#c8b05a', die), 4));
			const tilt = lerp(0.3, 0.9 + lr() * 0.3, up) + die * 0.6;
			const dir = out.clone().multiplyScalar(Math.sin(tilt)).add(v3(0, Math.cos(tilt), 0)).normalize();
			bag.add('sheet', sheet({ length: len, width: thread ? 0.002 : len * 0.2, shape: lance, lift: (u, v) => 0.05 * v * v - (0.08 + die * 0.2) * u * u, paint: (u, v) => mix('#3f8a2e', '#d8c050', clamp(die * 1.3 - (1 - u) * 0.3)).lerp(new THREE.Color('#8ac06a'), Math.abs(v) < 0.08 ? 0.3 : 0), along: 8, across: 3 }), aim(s1, dir, 0));
		}
		// the flowers, on the older bulbs
		if (age < 0.8 && p !== 0) continue;
		if (g < 5.6) continue;
		const rise = span(g, 5.6, 6.3), bloom = span(g, 6.6, 7.1), seeds = span(g, 7.6, 8.4), drop = span(g, 9, 9.6);
		const top = base.clone().add(v3(0.01, 0.05 + 0.24 * rise * vigour, 0));
		bag.add('body', tube([base, top], () => 0.0018, () => mix('#7aa04a', '#c8b05a', die), 3));
		if (bloom <= 0) {
			bag.add('body', bead(top, v3(0.006, 0.012, 0.006), '#e8ecd8', 4));
			continue;
		}
		const stars = 16;
		for (let m = 0; m < stars; m++) {
			const phi = Math.acos(1 - (m / stars) * 1.1), th = m * 2.39996;
			const pedicel = top.clone().add(v3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)).multiplyScalar(0.025));
			bag.add('body', tube([top, pedicel], () => 0.0005, () => '#8ab05a', 3));
			if (drop > 0.5) continue;
			if (seeds > 0.4) bag.add('body', bead(pedicel, v3(0.003, 0.003, 0.003), mix('#7aa04a', '#a89a5a', die), 3));
			else for (let q = 0; q < 6; q++) {
				const t = (q / 6) * Math.PI * 2;
				bag.add('sheet', sheet({ length: 0.007 * bloom, width: 0.002, shape: lance, paint: () => '#fbfbf6', along: 2, across: 1 }), aim(pedicel, v3(Math.cos(t), 0.6, Math.sin(t)).normalize(), 0));
			}
		}
	}
	// the leaf litter of a beech wood
	const lr = chance(seed, 'litter');
	for (let k = 0; k < 60; k++) {
		const d = Math.sqrt(lr()) * 0.22, a = lr() * Math.PI * 2;
		bag.add('sheet', sheet({ length: 0.04, width: 0.012, shape: lance, paint: () => mix('#8a5a2a', '#b88a4a', lr()), along: 3, across: 1 }), aim(v3(Math.cos(a) * d, 0.002 + lr() * 0.004, Math.sin(a) * d), v3(Math.cos(lr() * 6.28), 0.05, Math.sin(lr() * 6.28)).normalize(), 0));
	}
	return bag.build();
}
