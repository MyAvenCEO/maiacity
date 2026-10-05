/*
 * MORE FRUIT TREES — descriptions for ./orchard.js, like ./trees.js: the stone fruit of a European garden (sweet cherry,
 * peach, apricot, the Zwetschge plum) and the pear; and from the tropics the safou (the African pear), the soursop
 * (corossol) and the sapodilla (sapotille).
 *
 * The cherry and the pear grow upright, their limbs steep; the peach and the apricot are opened into a vase of three
 * or four limbs; the plum in between. The safou and the sapodilla are dense evergreen domes, the sapodilla's leaves in
 * whorls at its shoot tips; the soursop bears its big spiny fruit along its limbs and old wood.
 */
import * as THREE from 'three';
import { clamp, mix, v3 } from './grow.js';
import { orchard } from './orchard.js';

const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));
/** a ripening colour: from green, through a turning colour, to ripe */
const ripening = (/** @type {string} */ green, /** @type {string} */ turning, /** @type {string} */ ripe) => (/** @type {number} */ t) => (t < 0.5 ? mix(green, turning, t * 2) : mix(turning, ripe, (t - 0.5) * 2));
/** leaves: narrow and pointed; elliptic; ovate and toothed */
const lance = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.65) * (u < 0.06 ? u / 0.06 : 1) * (1 + (u > 0.1 && u < 0.95 ? ((u * 28) % 1) * 0.03 : 0));
const ellipse = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * u), 0.6) * (u < 0.05 ? u / 0.05 : 1);
const toothed = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.7) * (1 + (u > 0.1 && u < 0.95 ? ((u * 22) % 1) * 0.05 : 0));
/** a round stone fruit: its suture a groove down one side (v near 0) */
const sutured = (/** @type {number} */ u, /** @type {number} */ v, /** @type {number} */ p = 0.5) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), p) * (1 - 0.08 * Math.exp(-Math.pow(Math.sin(Math.PI * v) / 0.12, 2)));
/** a rose-family flower, five petals */
const rosy = (/** @type {string} */ colour, length = 0.014) => ({ petals: 5, length, width: length * 0.75, colour, heart: '#e8d06a', sepals: 5, sepal: 0.005, stamens: 22, stamenColour: '#f0d060' });
/** a dome-shaped flushing crown, with a few of its numbers changed */
const crown = (/** @type {Partial<import('./crown.js').Flush>} */ o) => ({
	trunk: 0.8, trunkBorn: 1.6, trunkFlush: 1.4, scaffolds: /** @type {[number, number]} */ ([3, 4]), scaffoldAngle: 0.8,
	gens: 6, flush: 0.28, rest: 0.27, shoot: (/** @type {number} */ gen) => [0, 1.15, 0.8, 0.58, 0.42, 0.34, 0.28][gen] ?? 0.28,
	whorl: /** @type {[number, number]} */ ([2, 3]), spread: 0.6, up: 0.035, droop: 0.06, wander: 0.1, radius: 0.12, taper: 0.6, thicken: 4,
	bark: /** @type {[string, string]} */ (['#7d6a4c', '#5a4a3e']),
	...o
});
const PIP = { size: v3(0.004, 0.0022, 0.002), coat: '#5a3a22', shade: '#3a2414', depth: 0.01 };
const STONE = (/** @type {number} */ s) => ({ size: v3(s, s * 0.6, s * 0.75), coat: '#b89a6a', shade: '#8a6a44', depth: 0.03 });

/* ------------------------------------------------------------------------------------------------ cherry */

export const CHERRY_STAGES = stages([
	['Stone', 0, 'A cherry stone, chilled through the winter, three centimetres down.'],
	['Germination', 20, 'The stone cracks along its seam; the root goes down, the hook comes up.'],
	['Seedling', 40, 'Two fleshy seed leaves, then toothed true leaves, the stem reddish.'],
	['Sapling', 365, 'A straight leader, its side shoots in tiers.'],
	['Young tree', 1460, 'A tall, steep crown; short fruiting spurs on the thin outer branches.'],
	['Blossom', 1830, 'Clusters of white blossom on long stalks hang from every spur.'],
	['Fruit set', 1840, 'The petals snow down; little green cherries in pairs and threes.'],
	['Green cherries', 1860, 'Hard green cherries swelling on their long stalks.'],
	['Colouring', 1880, 'Yellow, then blushing, then red.'],
	['Ripe', 1890, 'Glossy dark red cherries hanging in pairs: picking time, before the birds.']
]);

export const cherry = orchard({
	seed: STONE(0.009),
	hypogeal: false,
	cotyledon: { length: 0.018, width: 0.008, colour: '#6aa046' },
	flush: crown({ trunk: 1.1, scaffolds: [4, 5], scaffoldAngle: 0.6, up: 0.05, droop: 0.04, radius: 0.13, bark: ['#8a5a4a', '#6a4a44'] }),
	roots: { tap: 1.4, spread: 2.2, count: 16, radius: 0.04 },
	leaf: { length: 0.11, width: 0.05, shape: toothed, colour: '#3a6a2a', young: '#9ab45a', style: 'along', per: 0, droop: 0.4 },
	flower: { kind: rosy('#fbf8f2', 0.013), size: 1.1, opens: 4.6, sites: 'spurs', chance: 6, per: [3, 4] },
	fruit: {
		length: 0.024, width: 0.0125, stalk: 0.045, keep: [2, 4], setFor: 1.5, ripeFrom: 2.2, ripeFor: 1.4, gloss: true,
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.5) * (1 + 0.08 * Math.sin(Math.PI * u)),
		colour: (ripe) => (ripe < 0.3 ? mix('#8ab84a', '#e8d05a', ripe / 0.3) : ripe < 0.6 ? mix('#e8d05a', '#d8302a', (ripe - 0.3) / 0.3) : mix('#d8302a', '#6a0a1a', (ripe - 0.6) / 0.4))
	}
});

/* ------------------------------------------------------------------------------------------------ pear */

export const PEAR_STAGES = stages([
	['Pip', 0, 'A black teardrop pip, chilled through the winter, a centimetre down.'],
	['Germination', 20, 'The radicle goes down, the seed leaves lift out of the soil.'],
	['Seedling', 35, 'Two oval seed leaves and the first glossy true leaves.'],
	['Sapling', 365, 'An upright whip, its branches steep.'],
	['Young tree', 1600, 'A tall narrow crown, spurs on its outer branches.'],
	['Blossom', 2200, 'White blossom with dark red anthers in clusters, early in the spring.'],
	['Fruit set', 2215, 'Little green pears on their stalks, the calyx still on their tips.'],
	['Green pears', 2270, 'The pears lengthen and fill, narrow at the stalk, broad below.'],
	['Colouring', 2320, 'Green turns to yellow, a russet blush on the sunny side.'],
	['Ripe', 2340, 'Yellow pears with a red cheek: picked hard, they soften indoors.']
]);

export const pear = orchard({
	seed: PIP,
	hypogeal: false,
	cotyledon: { length: 0.012, width: 0.005, colour: '#6aa046' },
	flush: crown({ trunk: 1.0, scaffolds: [3, 4], scaffoldAngle: 0.5, up: 0.06, droop: 0.03, spread: 0.45, radius: 0.13, bark: ['#6a5a4a', '#4a4038'] }),
	roots: { tap: 1.5, spread: 2, count: 16, radius: 0.04 },
	leaf: { length: 0.075, width: 0.05, shape: ellipse, colour: '#2f5f2a', young: '#8ab45a', style: 'along', per: 0, droop: 0.3 },
	flower: { kind: { ...rosy('#fbfbf6', 0.015), stamenColour: '#8a1a2a' }, size: 1.2, opens: 4.5, sites: 'spurs', chance: 1.6, per: [4, 6] },
	fruit: {
		length: 0.11, width: 0.035, stalk: 0.035, keep: [1, 2], setFor: 1.9, ripeFrom: 2.8, ripeFor: 1.0, gloss: false, calyx: '#4a3a2a',
		// narrow at the stalk, swelling into a round bottom
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.45) * (0.42 + 0.58 * Math.pow(clamp(u * 1.25), 1.6)),
		colour: (ripe, u, v) => ripening('#8ab04a', '#c8c858', '#e8cf5a')(ripe).lerp(new THREE.Color('#b8603a'), clamp(ripe * 1.2 - 0.3) * 0.6 * Math.max(0, Math.cos(v * Math.PI * 2))).lerp(new THREE.Color('#9a7a4a'), Math.pow(Math.abs(Math.sin(u * 50 + v * 40)), 30) * 0.4)
	}
});

/* ------------------------------------------------------------------------------------------------ peach */

export const PEACH_STAGES = stages([
	['Stone', 0, 'A deeply pitted peach stone, chilled through the winter, five centimetres down.'],
	['Germination', 25, 'The stone splits; a root goes down, a shoot comes up.'],
	['Seedling', 45, 'Long narrow leaves on a reddish stem.'],
	['Sapling', 365, 'Fast: a metre in its first year.'],
	['Young tree', 1100, 'Opened into a vase on three or four limbs, the middle kept open to the sun.'],
	['Blossom', 1300, 'Pink blossom all along last year’s shoots, before the leaves.'],
	['Fruit set', 1315, 'Fuzzy green peaches set below the falling petals.'],
	['Green peaches', 1370, 'The peaches swell, their suture showing, still green and hard.'],
	['Colouring', 1420, 'The ground colour turns yellow; a red blush spreads from the sunny side.'],
	['Ripe', 1435, 'Soft, fragrant, yellow and red under their fuzz.']
]);

export const peach = orchard({
	seed: STONE(0.03),
	hypogeal: true,
	flush: crown({ trunk: 0.6, scaffolds: [3, 4], scaffoldAngle: 1.0, droop: 0.07, spread: 0.55, radius: 0.11, bark: ['#8a5a4a', '#5a4038'] }),
	roots: { tap: 1.0, spread: 1.8, count: 14, radius: 0.035 },
	leaf: { length: 0.15, width: 0.035, shape: lance, colour: '#3a6a2a', young: '#9ab45a', style: 'along', per: 0, droop: 0.45 },
	flower: { kind: rosy('#f2a8c0', 0.016), size: 1.2, opens: 4.5, sites: 'shoots', chance: 0.55, axils: [2, 3], per: [1, 2] },
	fruit: {
		length: 0.068, width: 0.035, stalk: 0.012, keep: [1, 2], setFor: 1.9, ripeFrom: 2.8, ripeFor: 1.0, gloss: false,
		shape: (u, v) => sutured(u, v, 0.45),
		colour: (ripe, u, v) => ripening('#8ab050', '#e8c05a', '#f2b048')(ripe).lerp(new THREE.Color('#c83a3a'), clamp(ripe * 1.3 - 0.2) * (0.35 + 0.65 * Math.max(0, Math.cos(v * Math.PI * 2 + 1)))).lerp(new THREE.Color('#e8d0c0'), 0.08)
	}
});

/* ------------------------------------------------------------------------------------------------ apricot */

export const APRICOT_STAGES = stages([
	['Stone', 0, 'A smooth flat apricot stone, chilled through the winter, four centimetres down.'],
	['Germination', 25, 'The stone splits along its edge; the root goes down.'],
	['Seedling', 45, 'Round, pointed leaves on long reddish stalks.'],
	['Sapling', 365, 'A young tree, its bark reddish.'],
	['Young tree', 1100, 'An open, spreading crown, spurs on its outer branches.'],
	['Blossom', 1300, 'White blossom blushed pink, the very first of the year.'],
	['Fruit set', 1315, 'Small velvety green apricots set.'],
	['Green apricots', 1360, 'They fill out, their suture showing.'],
	['Colouring', 1400, 'Yellow-orange, freckled red on the sunny side.'],
	['Ripe', 1410, 'Orange apricots, soft and sweet, falling at a touch.']
]);

export const apricot = orchard({
	seed: STONE(0.024),
	hypogeal: true,
	flush: crown({ trunk: 0.7, scaffolds: [3, 4], scaffoldAngle: 0.95, droop: 0.06, radius: 0.12, bark: ['#8a4a3a', '#5a3a30'] }),
	roots: { tap: 1.1, spread: 1.9, count: 14, radius: 0.035 },
	leaf: { length: 0.08, width: 0.06, shape: (u) => toothed(u) * (1 - 0.25 * u), colour: '#3a6a2a', young: '#a85a4a', style: 'along', per: 0, droop: 0.3 },
	flower: { kind: rosy('#fbeef0', 0.014), size: 1.1, opens: 4.5, sites: 'spurs', chance: 4, per: [1, 2] },
	fruit: {
		length: 0.05, width: 0.024, stalk: 0.01, keep: [1, 3], setFor: 1.8, ripeFrom: 2.7, ripeFor: 1.0, gloss: false,
		shape: (u, v) => sutured(u, v, 0.45),
		colour: (ripe, u, v) => ripening('#8ab050', '#f0c050', '#f29a28')(ripe).lerp(new THREE.Color('#d8483a'), clamp(ripe * 1.3 - 0.3) * Math.max(0, Math.cos(v * Math.PI * 2)) * (0.5 + 0.5 * Math.pow(Math.abs(Math.sin(u * 40 + v * 50)), 6)))
	}
});

/* ------------------------------------------------------------------------------------------------ plum */

export const PLUM_STAGES = stages([
	['Stone', 0, 'A pointed Zwetschge stone, chilled through the winter, three centimetres down.'],
	['Germination', 25, 'The stone splits; the root goes down.'],
	['Seedling', 45, 'Toothed oval leaves on a downy stem.'],
	['Sapling', 365, 'A young tree, its shoots grey-brown.'],
	['Young tree', 1300, 'A rounded crown, its outer branches knobbly with spurs.'],
	['Blossom', 1700, 'White blossom in pairs, smothering the spurs.'],
	['Fruit set', 1715, 'Little green plums set.'],
	['Green plums', 1780, 'Oval green plums, their suture down one side.'],
	['Colouring', 1830, 'They turn purple, then blue-black under a pale bloom.'],
	['Ripe', 1850, 'Blue Zwetschgen, the stone coming clean from the yellow flesh: Zwetschgendatschi time.']
]);

export const plum = orchard({
	seed: STONE(0.02),
	hypogeal: true,
	flush: crown({ trunk: 0.9, scaffolds: [3, 4], scaffoldAngle: 0.75, droop: 0.065, radius: 0.12, bark: ['#5a5048', '#3a3430'] }),
	roots: { tap: 1.2, spread: 2, count: 16, radius: 0.04 },
	leaf: { length: 0.08, width: 0.04, shape: toothed, colour: '#2f5a2a', young: '#8ab45a', style: 'along', per: 0, droop: 0.35 },
	flower: { kind: rosy('#fbfbf6', 0.011), size: 1, opens: 4.5, sites: 'spurs', chance: 3, per: [2, 3] },
	fruit: {
		length: 0.05, width: 0.017, stalk: 0.02, keep: [2, 3], setFor: 1.8, ripeFrom: 2.7, ripeFor: 1.1, gloss: false,
		shape: (u, v) => sutured(u, v, 0.55) * (1 - 0.1 * u),
		colour: (ripe) => (ripe < 0.5 ? mix('#8ab04a', '#7a4a6a', ripe * 2) : mix('#7a4a6a', '#2a2a5a', (ripe - 0.5) * 2)).lerp(new THREE.Color('#9aa0c8'), ripe * 0.25)
	}
});

/* ------------------------------------------------------------------------------------------------ safou */

export const SAFOU_STAGES = stages([
	['Seed', 0, 'The big seed of a safou, sown fresh — it will not keep.'],
	['Germination', 14, 'A root goes down; the shoot comes up from between the fleshy seed leaves.'],
	['Seedling', 40, 'Its first leaves, compound, glossy.'],
	['Sapling', 365, 'A slender young tree.'],
	['Young tree', 1460, 'A dense, rounded evergreen crown of glossy compound leaves.'],
	['Flowering', 2200, 'Panicles of small yellowish flowers at the shoot tips.'],
	['Fruit set', 2220, 'Small pink fruit set in clusters.'],
	['Pink fruit', 2280, 'Oblong fruit swelling, pink and pale.'],
	['Colouring', 2320, 'They darken through violet toward blue.'],
	['Ripe', 2340, 'Clusters of deep blue-violet safous, their green-cream flesh buttery: roast them.']
]);

export const safou = orchard({
	seed: { size: v3(0.02, 0.01, 0.012), coat: '#6a4a3a', shade: '#4a3020', depth: 0.03 },
	hypogeal: false,
	cotyledon: { length: 0.03, width: 0.012, colour: '#5a8a3a' },
	flush: crown({ trunk: 1.4, scaffolds: [4, 5], scaffoldAngle: 0.75, gens: 6, whorl: [2, 3], radius: 0.18, shoot: (gen) => [0, 1.6, 1.15, 0.85, 0.62, 0.48, 0.38, 0.32][gen] ?? 0.3, bark: ['#8a8070', '#5a5448'] }),
	roots: { tap: 2, spread: 2.6, count: 18, radius: 0.06 },
	leaf: { length: 0.14, width: 0.05, shape: ellipse, colour: '#2a5424', young: '#a8a050', style: 'along', per: 0, droop: 0.3 },
	flower: { panicle: true, size: 0.8, opens: 4.7, sites: 'tips', chance: 0.4, per: [1, 1] },
	fruit: {
		length: 0.08, width: 0.023, stalk: 0.03, keep: [3, 6], setFor: 1.8, ripeFrom: 2.6, ripeFor: 1.2, gloss: true,
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.42),
		colour: (ripe) => (ripe < 0.4 ? mix('#e8a8b8', '#a85a9a', ripe / 0.4) : mix('#a85a9a', '#2a2a6a', (ripe - 0.4) / 0.6))
	}
});

/* ------------------------------------------------------------------------------------------------ soursop */

export const SOURSOP_STAGES = stages([
	['Seed', 0, 'A glossy black seed from the pulp, a centimetre down.'],
	['Germination', 21, 'A root goes down, the hook comes up.'],
	['Seedling', 45, 'Glossy dark leaves, aromatic when crushed.'],
	['Sapling', 365, 'A slender, upright little tree.'],
	['Young tree', 1100, 'A small tree, its limbs low, dense with glossy leaves.'],
	['Flowering', 1300, 'Thick fleshy yellow-green flowers, three big petals over three small, straight out of the limbs.'],
	['Fruit set', 1320, 'Small green fruit with soft curved spines.'],
	['Green fruit', 1400, 'Big heart-shaped soursops hanging from the limbs, spiny all over.'],
	['Ripening', 1460, 'The spines spread apart, the green dulls and yellows a little.'],
	['Ripe', 1470, 'Soft to a thumb: white custard flesh, sweet and sour — corossol.']
]);

export const soursop = orchard({
	seed: { size: v3(0.009, 0.005, 0.006), coat: '#1a1410', shade: '#3a2a20', depth: 0.01 },
	hypogeal: false,
	cotyledon: { length: 0.022, width: 0.009, colour: '#5a8a3a' },
	flush: crown({ trunk: 0.6, scaffolds: [3, 4], scaffoldAngle: 0.7, gens: 5, radius: 0.1, bark: ['#7a6a5a', '#5a4e44'] }),
	roots: { tap: 1.2, spread: 1.6, count: 14, radius: 0.04 },
	leaf: { length: 0.14, width: 0.05, shape: ellipse, colour: '#244f22', young: '#7aa04a', style: 'along', per: 0, droop: 0.3 },
	flower: { kind: { petals: 3, length: 0.03, width: 0.016, colour: '#d8d47a', heart: '#c8a84a', sepals: 3, sepal: 0.006, stamens: 0, flat: -0.3 }, size: 1.2, opens: 4.6, sites: 'limbs', chance: 2.2, per: [1, 1] },
	fruit: {
		length: 0.24, width: 0.075, stalk: 0.05, keep: [1, 1], setFor: 2.0, ripeFrom: 3.0, ripeFor: 0.8, gloss: false,
		// heart-shaped: broad at the stalk, bent, narrowing to a blunt end
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.05 + u))), 0.45) * (1.05 - 0.35 * u),
		colour: (ripe) => mix('#3f6a2a', '#8a9a4a', ripe),
		skin: { colour: (ripe) => (ripe < 0.5 ? '#2f5a24' : '#5a6a34'), count: 220, size: 0.003, length: 2.6 }
	}
});

/* ------------------------------------------------------------------------------------------------ sapodilla */

export const SAPODILLA_STAGES = stages([
	['Seed', 0, 'A glossy black flattened seed with a white scar, a centimetre down.'],
	['Germination', 30, 'Slow: a month before the root goes down and the hook comes up.'],
	['Seedling', 60, 'Glossy leaves crowded at the tip of the shoot.'],
	['Sapling', 400, 'A slow, symmetrical little tree, its sap a milky latex (chicle).'],
	['Young tree', 1800, 'A dense evergreen pyramid, its glossy leaves clustered at every shoot tip.'],
	['Flowering', 2500, 'Small bell-shaped whitish flowers among the leaves at the shoot tips.'],
	['Fruit set', 2520, 'Small rusty fruit set, a style sticking out of each tip.'],
	['Growing', 2600, 'Round-oval fruit with a sandy brown scurfy skin, growing slowly.'],
	['Maturing', 2680, 'Rub the scurf off: if the skin is no longer green beneath, it is ready to pick.'],
	['Ripe', 2700, 'Brown sapodillas — sapotilles — soft after picking, their flesh brown sugar and pear.']
]);

export const sapodilla = orchard({
	seed: { size: v3(0.01, 0.003, 0.006), coat: '#1a1410', shade: '#3a2a20', depth: 0.01 },
	hypogeal: false,
	cotyledon: { length: 0.025, width: 0.01, colour: '#5a8a3a' },
	flush: crown({ trunk: 1.1, scaffolds: [4, 5], scaffoldAngle: 0.65, gens: 6, whorl: [2, 3], radius: 0.16, shoot: (gen) => [0, 1.3, 0.95, 0.72, 0.55, 0.44, 0.36, 0.3][gen] ?? 0.3, bark: ['#6a5a4a', '#4a3e34'] }),
	roots: { tap: 1.8, spread: 2.4, count: 18, radius: 0.05 },
	leaf: { length: 0.12, width: 0.04, shape: lance, colour: '#204a20', young: '#8aa050', style: 'whorl', per: 9, droop: 0.35 },
	flower: { kind: { petals: 6, length: 0.008, width: 0.004, colour: '#f2eedc', heart: '#c8b48a', sepals: 6, sepal: 0.006, stamens: 0 }, size: 1, opens: 4.7, sites: 'tips', chance: 0.4, per: [2, 4] },
	fruit: {
		length: 0.075, width: 0.032, stalk: 0.025, keep: [1, 2], setFor: 2.2, ripeFrom: 3.0, ripeFor: 0.8, gloss: false,
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.5) * (1 + 0.05 * Math.sin(Math.PI * u)),
		colour: (ripe, u, v) => mix('#7a6a44', '#8a6a44', ripe).lerp(new THREE.Color('#5a4a34'), Math.pow(Math.abs(Math.sin(u * 60 + v * 45)), 18) * 0.5)
	}
});

/* ------------------------------------------------------------------------------------------------ avocado */

export const AVOCADO_STAGES = stages([
	['Stone', 0, 'The big round avocado stone, its broad end down, its tip just showing above the soil.'],
	['Germination', 30, 'The stone splits from its base; a thick root goes down, a reddish shoot comes up — the seed leaves stay inside the stone.'],
	['Seedling', 60, 'A tall bare shoot, then a tuft of big bronze-red leaves at its tip, greening.'],
	['Sapling', 365, 'A leggy young tree, flushing at its tip.'],
	['Young tree', 1500, 'A broad dense dome of big leathery leaves.'],
	['Flowering', 2200, 'Panicles of hundreds of small greenish-yellow flowers at the shoot tips.'],
	['Fruit set', 2220, 'Few flowers hold: small green avocados on long stalks.'],
	['Green fruit', 2350, 'Pear-shaped avocados hanging on their stalks, growing for months.'],
	['Mature', 2450, 'Full-sized, their pebbly Hass skin dull green; they ripen only once picked.'],
	['Ripe', 2480, 'Picked and darkened to purple-black, soft at the neck: ripe.']
]);

export const avocado = orchard({
	seed: { size: v3(0.026, 0.03, 0.026), coat: '#8a5a3a', shade: '#5a3a24', depth: 0.02 },
	hypogeal: true,
	flush: crown({ trunk: 1.0, scaffolds: [3, 5], scaffoldAngle: 0.85, gens: 6, whorl: [2, 3], radius: 0.17, droop: 0.055, shoot: (gen) => [0, 1.5, 1.1, 0.8, 0.6, 0.48, 0.38][gen] ?? 0.35, bark: ['#7a8a5a', '#5a5044'] }),
	roots: { tap: 1.4, spread: 2.6, count: 18, radius: 0.05 },
	leaf: { length: 0.2, width: 0.07, shape: ellipse, colour: '#2a5424', young: '#a04a3a', style: 'whorl', per: 11, droop: 0.45 },
	flower: { panicle: true, size: 0.8, opens: 4.7, sites: 'tips', chance: 0.45, per: [1, 1] },
	fruit: {
		length: 0.11, width: 0.036, stalk: 0.09, keep: [1, 2], setFor: 2.2, ripeFrom: 3.4, ripeFor: 0.6, gloss: false,
		// pear-shaped: a narrow neck under the stalk, a round body below; the skin pebbled
		shape: (u, v) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.45) * (0.5 + 0.5 * Math.pow(clamp(u * 1.35), 1.4)) * (1 + 0.03 * Math.sin(u * 70 + v * 50) * Math.sin(v * 41)),
		colour: (ripe, u, v) => mix('#3f6a2a', '#2a1a2a', ripe).lerp(new THREE.Color(ripe > 0.5 ? '#4a2a3a' : '#5a7a3a'), Math.pow(Math.abs(Math.sin(u * 70 + v * 50)), 8) * 0.35)
	}
});

/* ------------------------------------------------------------------------------------------------ persimmon */

export const PERSIMMON_STAGES = stages([
	['Seed', 0, 'A flat brown seed from a ripe kaki, chilled through the winter, two centimetres down.'],
	['Germination', 30, 'Slow: a thick root goes down first, then the hook comes up.'],
	['Seedling', 60, 'Two leathery seed leaves, then broad glossy true leaves.'],
	['Sapling', 365, 'A slender young tree, its bark already chequered.'],
	['Young tree', 1460, 'A rounded crown of big, glossy, leathery leaves.'],
	['Flowering', 2000, 'Small pale-yellow bell flowers, one in each leaf axil of the new shoots, under a big green calyx.'],
	['Fruit set', 2015, 'The bells drop; little green fruit sit in their four-lobed calyxes.'],
	['Green fruit', 2080, 'Round green fruit swelling among the leaves.'],
	['Colouring', 2160, 'They turn yellow, then orange, as the leaves turn scarlet.'],
	['Ripe', 2190, 'Glossy orange kaki like lanterns; they hang on even after the leaves have fallen.']
]);

export const persimmon = orchard({
	seed: { size: v3(0.009, 0.004, 0.006), coat: '#6a4a2a', shade: '#4a3020', depth: 0.02 },
	hypogeal: false,
	cotyledon: { length: 0.025, width: 0.012, colour: '#5a8a3a' },
	flush: crown({ trunk: 1.0, scaffolds: [3, 4], scaffoldAngle: 0.8, droop: 0.06, radius: 0.13, bark: ['#6a5a4a', '#3a3028'] }),
	roots: { tap: 1.6, spread: 2, count: 16, radius: 0.045 },
	leaf: { length: 0.14, width: 0.075, shape: ellipse, colour: '#2a5a24', young: '#9ab45a', style: 'along', per: 0, droop: 0.3 },
	flower: { kind: { petals: 4, length: 0.009, width: 0.006, colour: '#f0e8b0', heart: '#d8c87a', sepals: 4, sepal: 0.012, stamens: 0, flat: -0.6 }, size: 1.2, opens: 4.6, sites: 'shoots', chance: 0.7, axils: [2, 4], per: [1, 1] },
	fruit: {
		length: 0.06, width: 0.04, stalk: 0.012, keep: [1, 1], setFor: 1.9, ripeFrom: 2.8, ripeFor: 1.0, gloss: true, calyx: '#4a6a2a',
		// round, a little flattened, faintly four-sided
		shape: (u, v) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.38) * (1 + 0.035 * Math.cos(v * Math.PI * 8)),
		colour: (ripe) => (ripe < 0.5 ? mix('#6a9a3a', '#e8b02a', ripe * 2) : mix('#e8b02a', '#e8641a', (ripe - 0.5) * 2))
	}
});

/* ------------------------------------------------------------------------------------------------ mulberry */

export const MULBERRY_STAGES = stages([
	['Seed', 0, 'A tiny seed from a berry, sown on the surface.'],
	['Germination', 14, 'The radicle goes down, the hook comes up.'],
	['Seedling', 30, 'Two small seed leaves, then toothed, heart-shaped leaves.'],
	['Sapling', 365, 'Fast: a branching young tree, some leaves lobed, some whole.'],
	['Young tree', 1100, 'A broad, spreading, rounded crown.'],
	['Flowering', 1460, 'Small green catkins hang among the new leaves in spring.'],
	['Fruit set', 1470, 'The catkins swell into little green berries along their length.'],
	['Green berries', 1495, 'Clusters of hard green mulberries, like small blackberries.'],
	['Colouring', 1510, 'They go white, then red, berry by berry.'],
	['Ripe', 1525, 'Black mulberries, soft and juicy, ripening for weeks: the ground under the tree stained purple.']
]);

/** a mulberry leaf: heart-shaped, toothed, often cut into lobes */
const mulberryLeaf = (/** @type {number} */ u) => toothed(u) * (u > 0.3 && u < 0.7 ? 1 - 0.35 * Math.sin(((u - 0.3) / 0.4) * Math.PI) : 1);

export const mulberry = orchard({
	seed: { size: v3(0.002, 0.0012, 0.0015), coat: '#a8865a', shade: '#7a5a3a', depth: 0.004 },
	hypogeal: false,
	cotyledon: { length: 0.008, width: 0.004, colour: '#6aa046' },
	flush: crown({ trunk: 0.9, scaffolds: [4, 5], scaffoldAngle: 0.95, droop: 0.075, spread: 0.65, radius: 0.15, shoot: (gen) => [0, 1.4, 1.0, 0.75, 0.55, 0.42, 0.34][gen] ?? 0.3, bark: ['#8a7058', '#5a4838'] }),
	roots: { tap: 1.4, spread: 2.4, count: 16, radius: 0.05 },
	leaf: { length: 0.13, width: 0.08, shape: mulberryLeaf, colour: '#3a6a2a', young: '#9ac05a', style: 'along', per: 0, droop: 0.35 },
	flower: { catkin: true, size: 0.5, opens: 4.6, sites: 'shoots', chance: 0.6, axils: [2, 4], per: [1, 2] },
	fruit: {
		length: 0.03, width: 0.008, stalk: 0.012, keep: [2, 4], setFor: 1.6, ripeFrom: 2.2, ripeFor: 1.6, gloss: true,
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.5),
		colour: (ripe) => (ripe < 0.35 ? mix('#8ab84a', '#ece8d8', ripe / 0.35) : ripe < 0.65 ? mix('#ece8d8', '#c8283a', (ripe - 0.35) / 0.3) : mix('#c8283a', '#2a0a1a', (ripe - 0.65) / 0.35)),
		// its drupelets, a knobbly skin
		skin: { colour: (ripe) => (ripe < 0.35 ? '#9ac05a' : ripe < 0.65 ? '#e04a5a' : '#3a0a1a'), count: 16, size: 0.0032, length: 1 }
	}
});

/* ------------------------------------------------------------------------------------------------ fig */

export const FIG_STAGES = stages([
	['Seed', 0, 'A tiny seed from a fig — though most figs are grown from cuttings, pushed into the soil in spring.'],
	['Germination', 21, 'The radicle goes down, the hook comes up.'],
	['Seedling', 45, 'Small seed leaves, then rough, lobed leaves.'],
	['Sapling', 365, 'Thick grey shoots, big lobed leaves, the milky sap in every cut.'],
	['Young tree', 1100, 'A low, spreading, many-stemmed tree of big hand-shaped leaves, rough as sandpaper.'],
	['Breba', 1300, 'Early figs (brebas) swell on last year’s wood; the flowers are hidden inside them.'],
	['Fruit set', 1340, 'New little green figs in the leaf axils of this year’s shoots, one to each leaf.'],
	['Green figs', 1380, 'Pear-shaped green figs, swelling slowly, hard.'],
	['Colouring', 1420, 'They swell suddenly, soften and darken to purple, their eye at the tip opening.'],
	['Ripe', 1430, 'Soft purple figs hanging on their necks, a drop of nectar at the eye: picking time.']
]);

/** a fig leaf: three to five deep lobes, a long cut in either side */
const figLeaf = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.65)), 0.6) * (1 - 0.55 * Math.exp(-Math.pow((u - 0.45) / 0.08, 2)) - 0.35 * Math.exp(-Math.pow((u - 0.75) / 0.06, 2)));

export const fig = orchard({
	seed: { size: v3(0.0015, 0.001, 0.001), coat: '#c8a878', shade: '#8a6a44', depth: 0.004 },
	hypogeal: false,
	cotyledon: { length: 0.007, width: 0.0035, colour: '#6aa046' },
	flush: crown({ trunk: 0.5, scaffolds: [4, 6], scaffoldAngle: 1.0, gens: 5, droop: 0.06, spread: 0.6, radius: 0.12, taper: 0.66, shoot: (gen) => [0, 1.2, 0.9, 0.65, 0.48, 0.38][gen] ?? 0.32, bark: ['#9a9890', '#7a7a74'] }),
	roots: { tap: 1.2, spread: 2.6, count: 16, radius: 0.04 },
	leaf: { length: 0.2, width: 0.11, shape: figLeaf, colour: '#2f5f2a', young: '#8ab45a', style: 'along', per: 0, droop: 0.35 },
	// no flower to see: it blooms inside the fig
	flower: { size: 0.6, opens: 4.7, sites: 'shoots', chance: 0.6, axils: [2, 3], per: [1, 1] },
	fruit: {
		length: 0.06, width: 0.026, stalk: 0.012, keep: [1, 1], setFor: 2.0, ripeFrom: 2.9, ripeFor: 0.9, gloss: false,
		// pear-shaped: a narrow neck at the stalk, round at the end, the eye a small dimple
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.45) * (0.42 + 0.58 * Math.pow(clamp(u * 1.4), 1.3)) * (u > 0.96 ? 0.85 : 1),
		colour: (ripe, u, v) => mix('#7a9a4a', '#4a2a4a', clamp(ripe * 1.3 - (1 - u) * 0.3)).lerp(new THREE.Color('#9aa070'), Math.pow(Math.abs(Math.sin(v * Math.PI * 12)), 10) * 0.25)
	}
});
