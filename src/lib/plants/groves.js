/*
 * GROVES — four more descriptions for ./orchard.js, from the warm side of the food forest: the pomegranate and the
 * olive of the Mediterranean, and from the tropics coffee and cacao, both grown in the shade of taller trees.
 *
 * The pomegranate is a small tree of many stems from the base, twiggy, its narrow glossy leaves bronze when new; its
 * scarlet trumpets open at the shoot tips and swell into round leathery fruit still wearing the calyx as a crown. The
 * olive is a gnarled grey trunk under a dome of narrow silvery leaves; its tiny cream flowers come in short sprays in
 * the leaf axils of last year's shoots at the crown's edge, and the olives ripen there from green through violet to
 * black. Coffee keeps one upright stem and sets near-level branches in pairs up it, tier on tier; its white star
 * flowers and then its cherries crowd the leaf axils along those branches. Cacao grows a stem to a jorquette, where it
 * fans out into three to five level branches; its tiny flowers and its big ridged pods come straight out of the trunk
 * and the thick limbs (cauliflory), never the leafy twigs.
 */
import * as THREE from 'three';
import { clamp, mix, v3 } from './grow.js';
import { orchard } from './orchard.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));
/** leaves: narrow and pointed; elliptic and long-tipped */
const lance = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.65) * (u < 0.06 ? u / 0.06 : 1);
const pointed = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.6) * (u < 0.05 ? u / 0.05 : 1) * (u > 0.85 ? 1 - (u - 0.85) * 2.5 : 1);
/** a dome-shaped flushing crown, with a few of its numbers changed */
const crown = (/** @type {Partial<import('./crown.js').Flush>} */ o) => ({
	trunk: 0.8, trunkBorn: 1.6, trunkFlush: 1.4, scaffolds: /** @type {[number, number]} */ ([3, 4]), scaffoldAngle: 0.8,
	gens: 6, flush: 0.28, rest: 0.27, shoot: (/** @type {number} */ gen) => [0, 1.15, 0.8, 0.58, 0.42, 0.34, 0.28][gen] ?? 0.28,
	whorl: /** @type {[number, number]} */ ([2, 3]), spread: 0.6, up: 0.035, droop: 0.06, wander: 0.1, radius: 0.12, taper: 0.6, thicken: 4,
	bark: /** @type {[string, string]} */ (['#7d6a4c', '#5a4a3e']),
	...o
});

/* ------------------------------------------------------------------------------------------------ pomegranate */

export const POMEGRANATE_STAGES = stages([
	['Seed', 0, 'A small angular seed from an aril, its juicy red coat washed off, a centimetre down.'],
	['Germination', 20, 'The radicle goes down, the hook comes up.'],
	['Seedling', 40, 'Two small round seed leaves, then narrow glossy leaves in pairs on a reddish stem.'],
	['Sapling', 365, 'Shoot after shoot from the base: a twiggy little bush, a few twigs ending in a thorn.'],
	['Young tree', 1100, 'A small tree of several stems, three metres high; narrow glossy leaves, bronze when new.'],
	['Flowering', 1300, 'Scarlet trumpets at the shoot tips: a fleshy red calyx and crumpled petals round a boss of yellow stamens.'],
	['Fruit set', 1320, 'The petals fall; the calyx swells into a little round fruit, still crowned with its lobes.'],
	['Green fruit', 1380, 'Round green fruit the size of a fist, heavy on the bending twigs.'],
	['Colouring', 1440, 'The skin turns yellow, then flushes red from the sunny side.'],
	['Ripe', 1480, 'Leathery red pomegranates under their crowns: inside, hundreds of seeds in ruby arils.']
]);

/**
 * A pomegranate: round, a little flattened at the stalk, faintly angled; at its blossom end a short neck flaring into
 * the crown of the calyx, its lobes standing round a hollow — the tube's last rings, so the fruit and its crown are one.
 * @param {number} u @param {number} v
 */
function pomegranateShape(u, v) {
	if (u < 0.8) return Math.pow(Math.max(0, Math.sin(Math.PI * (u / 0.8) * 0.93)), 0.5) * (1 + 0.025 * Math.cos(v * Math.PI * 12));
	const t = (u - 0.8) / 0.2;
	const lobes = Math.max(0, Math.cos(v * Math.PI * 2 * 6));
	return t < 0.75 ? 0.44 - 0.5 * t + 0.5 * t * t + lobes * t * 0.22 : 0.3 - (t - 0.75) * 0.9;
}

export const pomegranate = orchard({
	seed: { size: v3(0.006, 0.0035, 0.004), coat: '#e8dcc0', shade: '#b8a07a', depth: 0.01 },
	hypogeal: false,
	cotyledon: { length: 0.012, width: 0.006, colour: '#6aa046' },
	// many stems from near the ground: a short trunk breaking at once into steep limbs, arching out as they lengthen
	flush: crown({ trunk: 0.25, trunkFlush: 1.0, scaffolds: [5, 7], scaffoldAngle: 0.42, gens: 6, whorl: [2, 3], spread: 0.6, up: 0.03, droop: 0.075, wander: 0.14, radius: 0.09, taper: 0.62, shoot: (gen) => [0, 1.15, 0.7, 0.48, 0.36, 0.28, 0.22][gen] ?? 0.22, bark: ['#8a7a68', '#5e5248'] }),
	roots: { tap: 1.0, spread: 1.6, count: 14, radius: 0.035 },
	leaf: { length: 0.075, width: 0.012, shape: lance, colour: '#2f5a24', young: '#86803a', style: 'along', per: 0, droop: 0.3, from: 4, gloss: true },
	flower: { kind: { petals: 6, length: 0.022, width: 0.015, colour: '#e2301e', heart: '#f0c040', sepals: 6, sepal: 0.016, sepalColour: '#c8402a', sepalBack: 0.05, stamens: 30, stamenColour: '#f2d24a', flat: -0.35 }, size: 1.1, opens: 4.6, sites: 'tips', chance: 0.55, per: [1, 2] },
	fruit: {
		length: 0.1, width: 0.044, stalk: 0.012, keep: [1, 1], setFor: 2.0, ripeFrom: 2.8, ripeFor: 1.1, gloss: true,
		shape: pomegranateShape,
		colour: (ripe, u, v) => {
			const ground = ripe < 0.45 ? mix('#86a44a', '#d8b04a', ripe / 0.45) : mix('#d8b04a', '#b8202a', (ripe - 0.45) / 0.55);
			// the red spreading from the sunny side, the crown darker and dull
			const blush = clamp(ripe * 1.6 - 0.3) * (0.5 + 0.5 * Math.cos(v * Math.PI * 2));
			return ground.lerp(new THREE.Color('#a01a24'), blush * 0.6).lerp(new THREE.Color(ripe > 0.5 ? '#7a2a22' : '#7a8a3a'), u > 0.82 ? 0.45 : 0);
		}
	}
});

/* ------------------------------------------------------------------------------------------------ olive */

export const OLIVE_STAGES = stages([
	['Stone', 0, 'A hard ridged olive stone, its flesh rotted off, two centimetres down: slow and fickle — most olives are grown from cuttings.'],
	['Germination', 40, 'Weeks later the stone splits; the root goes down, the hook comes up.'],
	['Seedling', 70, 'Two narrow seed leaves, then grey-green leaves in pairs.'],
	['Sapling', 400, 'A slender young tree, silvery, its bark smooth and grey.'],
	['Young tree', 1800, 'A round crown of narrow silvery leaves on a trunk already twisting.'],
	['Flowering', 2200, 'Short sprays of tiny creamy flowers in the leaf axils of last year’s shoots, smelling of honey.'],
	['Fruit set', 2215, 'Most flowers fall; a few little green olives hold, one to three a spray.'],
	['Green olives', 2300, 'Firm green olives filling out among the leaves: picked now for green olives.'],
	['Turning', 2370, 'They turn straw-coloured, then blush violet from the tip.'],
	['Ripe', 2400, 'Purple-black olives, glossy, at the crown’s edge: picked now for oil.']
]);

export const olive = orchard({
	seed: { size: v3(0.014, 0.0065, 0.0065), coat: '#a8906a', shade: '#7a6448', depth: 0.02 },
	hypogeal: false,
	cotyledon: { length: 0.016, width: 0.0045, colour: '#6a8a4a' },
	// a short trunk wandering as it goes, gnarled limbs, a dome of thin twiggy shoots
	flush: crown({ trunk: 0.9, trunkFlush: 1.0, flush: 0.25, rest: 0.2, scaffolds: [3, 4], scaffoldAngle: 0.65, gens: 6, whorl: [2, 3], spread: 0.6, up: 0.04, droop: 0.06, wander: 0.15, radius: 0.17, taper: 0.6, thicken: 3.5, shoot: (gen) => [0, 1.1, 0.8, 0.6, 0.45, 0.35, 0.28][gen] ?? 0.26, bark: ['#9a988a', '#6a675e'] }),
	roots: { tap: 1.2, spread: 2.4, count: 18, radius: 0.05 },
	leaf: { length: 0.065, width: 0.0065, shape: lance, colour: '#62735a', young: '#9aa88a', style: 'along', per: 0, droop: 0.3, from: 4 },
	flower: { kind: { petals: 4, length: 0.0035, width: 0.0022, colour: '#f4f0d6', heart: '#e2d690', sepals: 4, sepal: 0.0012, stamens: 2, stamenColour: '#e8c040', flat: 0.2 }, size: 1, opens: 4.6, sites: 'shoots', chance: 0.45, axils: [3, 5], per: [6, 9] },
	fruit: {
		length: 0.024, width: 0.0085, stalk: 0.014, keep: [1, 3], setFor: 2.0, ripeFrom: 2.6, ripeFor: 1.3, gloss: true,
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.5) * (1 + 0.06 * Math.sin(Math.PI * u * 1.4)),
		// green, then straw, then violet spreading up from the tip, then black
		colour: (ripe, u) => {
			const r = clamp(ripe + (u - 0.5) * 0.25);
			return r < 0.35 ? mix('#6f8f32', '#b0a84a', r / 0.35) : r < 0.7 ? mix('#b0a84a', '#6a2a48', (r - 0.35) / 0.35) : mix('#6a2a48', '#1e1420', (r - 0.7) / 0.3);
		}
	}
});

/* ------------------------------------------------------------------------------------------------ coffee */

export const COFFEE_STAGES = stages([
	['Bean', 0, 'A coffee bean still in its parchment, sown fresh and flat side down, a centimetre deep in the shade.'],
	['Germination', 40, 'The root goes down; the stem rises like a match, the parchment still on its head (the soldier).'],
	['Seed leaves', 70, 'The parchment drops: two round, wavy seed leaves open like a butterfly.'],
	['Sapling', 365, 'One upright stem of glossy dark leaves in pairs; the first pairs of level branches.'],
	['Young shrub', 900, 'Two metres of shrub, its level branches tier on tier, the lowest the longest.'],
	['Flowering', 1100, 'After the first rains, white star flowers crowd the leaf axils along the branches, scented like jasmine — for two days.'],
	['Fruit set', 1120, 'Little green cherries set in clusters where the flowers were.'],
	['Green cherries', 1250, 'Clusters of hard green cherries along the branches, filling for months.'],
	['Turning', 1340, 'Cherry by cherry they yellow, then blush red.'],
	['Ripe', 1370, 'Glossy red cherries crowding the branches, two beans in each: picked by hand, the ripe ones only.']
]);

export const coffee = orchard({
	seed: { size: v3(0.011, 0.0055, 0.0075), coat: '#d8c8a0', shade: '#a8905a', depth: 0.012 },
	hypogeal: false,
	cotyledon: { length: 0.03, width: 0.016, colour: '#4f8a34' },
	// one upright stem, level branches in tiers up it, side shoots along them
	leader: {
		height: [[2, 0], [3, 0.35], [4, 1.1], [5, 1.8], [6, 2.1], [7, 2.25], [9, 2.4]], radius: 0.16, tiers: 22, clear: 0.25, spacing: 0.1, angle: 1.2,
		limb: (h) => 0.95 - 0.55 * h, rate: 0.9, crown: 3, sides: 0.22, side: 0.2, bark: ['#8a8064', '#6a6250'], droop: 0.12
	},
	roots: { tap: 0.6, spread: 1.2, count: 14, radius: 0.025 },
	leaf: { length: 0.13, width: 0.026, shape: pointed, colour: '#1e4a1e', young: '#6a9a3a', style: 'along', per: 2, droop: 0.25, gloss: true },
	flower: { kind: { petals: 5, length: 0.01, width: 0.0035, colour: '#fbfaf4', heart: '#f0ecd0', sepals: 5, sepal: 0.0015, stamens: 5, stamenColour: '#f0e8a0', flat: 0.15 }, size: 1, opens: 4.6, sites: 'limbs', chance: 3.2, per: [4, 6] },
	fruit: {
		length: 0.016, width: 0.0072, stalk: 0.008, keep: [2, 4], setFor: 2.0, ripeFrom: 2.6, ripeFor: 1.2, gloss: true,
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.45),
		colour: (ripe, u) => (ripe < 0.45 ? mix('#5f8f2e', '#d8c040', ripe / 0.45) : mix('#d8c040', '#b8141e', (ripe - 0.45) / 0.55)).lerp(new THREE.Color('#3a2a1a'), u > 0.94 ? 0.6 : 0)
	}
});

/* ------------------------------------------------------------------------------------------------ cacao */

export const CACAO_STAGES = stages([
	['Bean', 0, 'A fresh cacao bean from a split pod, still sticky with pulp, sown at once in the shade — it dies if it dries.'],
	['Germination', 10, 'The root goes down; the thick seed leaves are lifted out of the soil.'],
	['Seedling', 35, 'Long, soft, drooping leaves, pink-red as they unfold.'],
	['Sapling', 365, 'One straight stem with its leaves in a spiral, a metre and a half high.'],
	['Young tree', 1100, 'At the jorquette the stem fans out into four or five level branches; flush after flush of limp red leaves.'],
	['Flowering', 1460, 'Cushions of tiny pink-white flowers straight out of the bark of the trunk and the thick limbs, pollinated by midges.'],
	['Fruit set', 1480, 'A few in a hundred set: little green pods (cherelles) on the trunk.'],
	['Green pods', 1560, 'Big ridged pods hanging from the trunk and the limbs, growing for months.'],
	['Colouring', 1610, 'The furrows yellow first, then the ridges: green to yellow to orange.'],
	['Ripe', 1640, 'Heavy yellow-orange pods rattling with beans in their white pulp: cut, split, ferment, dry.']
]);

export const cacao = orchard({
	seed: { size: v3(0.024, 0.012, 0.015), coat: '#9a6a5a', shade: '#6a3a30', depth: 0.02 },
	hypogeal: false,
	cotyledon: { length: 0.035, width: 0.016, colour: '#7a9a4a' },
	// a straight stem to the jorquette, then a fan of level branches
	flush: crown({ trunk: 1.3, trunkFlush: 1.6, scaffolds: [4, 5], scaffoldAngle: 1.0, gens: 5, whorl: [2, 3], spread: 0.55, up: 0.012, droop: 0.06, wander: 0.1, radius: 0.13, taper: 0.62, shoot: (gen) => [0, 1.5, 1.05, 0.75, 0.55, 0.42][gen] ?? 0.4, bark: ['#8a7262', '#655448'] }),
	roots: { tap: 1.4, spread: 2.2, count: 16, radius: 0.045 },
	leaf: { length: 0.3, width: 0.05, shape: pointed, colour: '#2a5424', young: '#b8506a', style: 'along', per: 0, droop: 0.75, gloss: true },
	flower: { kind: { petals: 5, length: 0.007, width: 0.0022, colour: '#f6ece6', heart: '#c86a8a', sepals: 5, sepal: 0.006, sepalColour: '#e8bcc4', sepalBack: 0.8, stamens: 5, stamenColour: '#a8507a', flat: 0.5 }, size: 1, opens: 4.6, sites: 'trunk', chance: 5, per: [5, 9] },
	fruit: {
		length: 0.2, width: 0.048, stalk: 0.03, keep: [1, 2], setFor: 2.2, ripeFrom: 3.0, ripeFor: 0.9, gloss: false,
		// long, ten-ridged, the ridges warty, narrowing at the stalk and drawn out to a blunt point
		shape: (u, v) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.04 + u * 0.98))), 0.62) * (1 - 0.18 * Math.pow(u, 2)) * (1 + 0.075 * Math.abs(Math.cos(v * Math.PI * 5)) + 0.012 * Math.sin(u * 60) * Math.abs(Math.cos(v * Math.PI * 5))),
		colour: (ripe, u, v) => {
			const ridge = Math.abs(Math.cos(v * Math.PI * 5));
			// the furrows turn first, the ridges after
			const r = clamp(ripe * 1.15 - ridge * 0.15);
			return (r < 0.5 ? mix('#4a7a2a', '#d0b830', r * 2) : mix('#d0b830', '#d8702a', (r - 0.5) * 2)).lerp(new THREE.Color('#2f4a20'), ripe < 0.2 ? ridge * 0.2 : 0);
		}
	}
});
