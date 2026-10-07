/*
 * THE FRUIT TREES — each a description for ./orchard.js: the mango, the apple, the orange, the lemon, the durian, the
 * jackfruit, from their seeds.
 *
 * The mango, the apple and the citrus grow in flushes into a dome (./crown.js): a short trunk, three or four scaffold
 * limbs at about 45°, flush after flush breaking from the ring of buds at each tip. The mango and the citrus bear at
 * the tips of their shoots, the apple on short spurs along them. The durian and the jackfruit keep a leader and set
 * their limbs in tiers; the durian hangs its spiny fruit from its level limbs, the jackfruit bears straight from its
 * trunk and its thickest limbs (cauliflory).
 */
import * as THREE from 'three';
import { clamp, mix, v3 } from './grow.js';
import { orchard } from './orchard.js';
import { apple as appleV2 } from './apple.js';

/** a description frozen through and through, so a version kept cannot change @template T @param {T} o @returns {T} */
function deepFreeze(o) {
	if (o && typeof o === 'object' && !Object.isFrozen(o)) {
		Object.freeze(o);
		for (const v of Object.values(o)) if (!(v instanceof THREE.Vector3)) deepFreeze(v);
	}
	return o;
}

/** the ten stages of a fruit tree, its days and notes */
const stages = (/** @type {[string, number, string][]} */ rows) => rows.map(([name, day, note]) => ({ name, day, note }));

/** a leaf narrowing to a point at both ends */
const lance = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.65) * (u < 0.06 ? u / 0.06 : 1);
/** an elliptic leaf, broadest in its middle */
const ellipse = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * u), 0.6) * (u < 0.05 ? u / 0.05 : 1);
/** an ovate leaf with a toothed edge (the apple's) */
const toothed = (/** @type {number} */ u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.7) * (1 + (u > 0.1 && u < 0.95 ? ((u * 22) % 1) * 0.05 : 0));

/** a ripening colour: from green, through a turning colour, to ripe */
const ripening = (/** @type {string} */ green, /** @type {string} */ turning, /** @type {string} */ ripe) => (/** @type {number} */ t) => (t < 0.5 ? mix(green, turning, t * 2) : mix(turning, ripe, (t - 0.5) * 2));

const MANGO_COLOUR = ripening('#5f9a3a', '#c9c24a', '#f2b632');
const APPLE_BASE = ripening('#8cb84a', '#c9d05a', '#e6d36a');
const ORANGE_COLOUR = ripening('#3f7a2a', '#b8a83a', '#f2911c');
const LEMON_COLOUR = ripening('#4a8a2e', '#b8c44a', '#f5d72a');
const DURIAN_COLOUR = ripening('#6f8a36', '#8c9a42', '#b3a24c');
const JACK_COLOUR = ripening('#6c9a3c', '#9fae46', '#c9b244');

export const MANGO_STAGES = stages([
	['Stone', 0, 'The flat fibrous stone, ten centimetres long, laid flat a few centimetres down, kept warm and moist.'],
	['Germination', 14, 'A taproot dives; a hooked shoot comes up out of the stone — its seed leaves stay inside, feeding it.'],
	['Seedling', 40, 'A whorl of limp bronze-red leaves at the shoot’s tip, greening as they firm: the first flush.'],
	['Sapling', 365, 'A clear trunk, then three or four scaffold limbs at about 45° breaking from one ring of buds.'],
	['Young tree', 1100, 'Flush after flush: each tip breaks into two or three new shoots, the crown filling out into a dome.'],
	['Flowering', 2000, 'A dome as wide as tall; upright panicles of tiny pink-cream flowers at the shoot tips.'],
	['Fruit set', 2030, 'Most flowers fall; one or two small green fruit hold on each panicle.'],
	['Green fruit', 2080, 'Mangoes swelling on their long dangling stalks, green and hard; the next flush grows past them.'],
	['Colouring', 2120, 'They turn from green to gold, the sunny side blushing red.'],
	['Ripe', 2140, 'Ripe mangoes, golden and red, fragrant at the stalk: picking time.']
]);

export const mango = orchard({
	seed: { size: v3(0.05, 0.013, 0.026), coat: '#d9c49a', shade: '#8a7350', depth: 0.04 },
	hypogeal: true,
	flush: {
		trunk: 0.9, trunkBorn: 1.0, trunkFlush: 1.5, scaffolds: [3, 4], scaffoldAngle: 0.78,
		gens: 6, flush: 0.28, rest: 0.27, shoot: (gen) => [0, 1.3, 0.95, 0.7, 0.55, 0.45, 0.38][gen] ?? 0.38,
		whorl: [2, 4], spread: 0.55, up: 0.03, droop: 0.05, wander: 0.07, radius: 0.17, taper: 0.64, thicken: 4,
		bark: ['#7a8a4a', '#4e4238']
	},
	roots: { tap: 2.4, spread: 2.6, count: 18, radius: 0.06 },
	leaf: { length: 0.3, width: 0.065, shape: lance, colour: '#24502a', young: '#9a3f2e', style: 'whorl', per: 16, droop: 0.55 },
	flower: { panicle: true, size: 1, opens: 4.8, sites: 'tips', chance: 0.4, per: [1, 1] },
	fruit: {
		length: 0.13, width: 0.045, stalk: 0.22, keep: [1, 2], setFor: 1.8, ripeFrom: 2.9, ripeFor: 1.0, gloss: true,
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.55) * (1 - 0.15 * u),
		colour: (ripe, u, v) => MANGO_COLOUR(clamp(ripe * 1.4 - (1 - u) * 0.4)).lerp(new THREE.Color('#d6452e'), Math.max(0, Math.cos(v * Math.PI * 2)) * clamp(ripe * 1.2) * 0.8 * (1 - u * 0.5))
	}
});

export const APPLE_STAGES = stages([
	['Pip', 0, 'A brown teardrop pip, chilled through the winter, a centimetre down.'],
	['Germination', 20, 'The radicle goes down, the hook comes up; the seed leaves lift out of the soil.'],
	['Seedling', 35, 'Two oval seed leaves and the first toothed true leaves.'],
	['Sapling', 365, 'A slender red-brown whip, its oval leaves soft and downy beneath.'],
	['Young tree', 1460, 'A clear trunk, tiers of scaffold limbs and laterals along them; the first knobbly spurs, each a rosette of leaves.'],
	['Blossom', 2200, 'On every spur a rosette of young leaves and a cluster of five or six: deep pink buds, the king flower in the middle opening first, white flushed pink.'],
	['Fruit set', 2215, 'The petals fall; the king fruit and one or two others swell, the rest drop in the June drop.'],
	['Green apples', 2260, 'Hard green apples hanging on their short stalks among the leaves.'],
	['Colouring', 2300, 'The sunny side flushes red, the ground colour turns from green to yellow.'],
	['Ripe', 2320, 'Hundreds of red-striped apples in clusters, the laterals bowed under them; they come away with a lift and a twist.']
]);

/** its description at v1, frozen: ./orchard.v1.js grows it (the apple's history, ./index.js); v2 is ./apple.js
 * @type {import('./orchard.js').Orchard} */
export const APPLE_V1 = deepFreeze({
	seed: { size: v3(0.004, 0.0022, 0.002), coat: '#5a3a22', shade: '#3a2414', depth: 0.01 },
	hypogeal: false,
	cotyledon: { length: 0.012, width: 0.0045, colour: '#6aa046' },
	flush: {
		trunk: 0.75, trunkBorn: 1.6, trunkFlush: 1.4, scaffolds: [3, 4], scaffoldAngle: 0.88,
		gens: 6, flush: 0.28, rest: 0.27, shoot: (gen) => [0, 1.15, 0.8, 0.58, 0.42, 0.34, 0.28][gen] ?? 0.28,
		whorl: [2, 3], spread: 0.6, up: 0.035, droop: 0.06, wander: 0.1, radius: 0.12, taper: 0.6, thicken: 4,
		bark: ['#7d6a4c', '#5a4a3e']
	},
	roots: { tap: 1.2, spread: 2, count: 16, radius: 0.04 },
	leaf: { length: 0.09, width: 0.055, shape: toothed, colour: '#3f6f2e', young: '#8ab45a', style: 'along', per: 0, droop: 0.3 },
	flower: { kind: { petals: 5, length: 0.017, width: 0.012, colour: '#fbe9ec', heart: '#e8d06a', sepals: 5, sepal: 0.007, stamens: 18, stamenColour: '#f0d060' }, size: 1.2, opens: 4.6, sites: 'tips', chance: 0.45, per: [4, 6] },
	fruit: {
		length: 0.07, width: 0.042, stalk: 0.035, keep: [1, 2], setFor: 1.9, ripeFrom: 2.8, ripeFor: 1.0, gloss: true, calyx: '#5a4a2e',
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.42) * (1 - 0.14 * u),
		colour: (ripe, u, v) => APPLE_BASE(ripe).lerp(new THREE.Color('#b8232f'), clamp(ripe * 1.3 - 0.2) * (0.55 + 0.45 * Math.max(0, Math.cos(v * Math.PI * 2))) * (0.75 + 0.25 * Math.abs(Math.sin(v * Math.PI * 28))))
	}
});
/** the apple as it grows now: a half-standard grown branch by branch (./apple.js) */
export const apple = appleV2;

/** a citrus skin: round, finely pitted with oil glands */
const pitted = (/** @type {number} */ u, /** @type {number} */ v, /** @type {number} */ p = 0.5) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), p) * (1 + 0.012 * Math.sin(v * Math.PI * 2 * 31 + u * 47) * Math.sin(u * 61));
const citrusFlower = (/** @type {string} */ colour) => ({ petals: 5, length: 0.016, width: 0.006, colour, heart: '#f2e08a', sepals: 5, sepal: 0.004, stamens: 20, stamenColour: '#f6e070', flat: 0.4 });

export const ORANGE_STAGES = stages([
	['Seed', 0, 'A pale ridged seed a centimetre long, fresh from the fruit, a centimetre down.'],
	['Germination', 21, 'The root goes down; the shoot hooks up — its seed leaves stay below in the seed.'],
	['Seedling', 45, 'The first glossy leaves, their stalks winged, smelling of orange when crushed.'],
	['Sapling', 365, 'A bushy little tree, flush after flush of dark glossy leaves.'],
	['Young tree', 1460, 'A dense rounded crown on a short trunk, evergreen.'],
	['Blossom', 2400, 'Waxy white flowers in small clusters at the shoot tips, heavy with scent: orange blossom.'],
	['Fruit set', 2420, 'Little green fruit set; most drop, the strongest stay.'],
	['Green fruit', 2550, 'Round green oranges, full-sized long before they colour.'],
	['Colouring', 2650, 'In the cool of the season the green fades and the orange comes through.'],
	['Ripe', 2700, 'Deep orange fruit among dark leaves, sweet; they keep on the tree for weeks.']
]);

export const orange = orchard({
	seed: { size: v3(0.006, 0.003, 0.004), coat: '#efe6c8', shade: '#c9b98c', depth: 0.012 },
	hypogeal: true,
	flush: {
		trunk: 0.55, trunkBorn: 1.2, trunkFlush: 1.6, scaffolds: [3, 4], scaffoldAngle: 0.7,
		gens: 7, flush: 0.22, rest: 0.22, shoot: (gen) => [0, 0.85, 0.65, 0.5, 0.4, 0.33, 0.28, 0.25][gen] ?? 0.25,
		whorl: [2, 4], spread: 0.5, up: 0.04, droop: 0.05, wander: 0.08, radius: 0.1, taper: 0.64, thicken: 4,
		bark: ['#6f8a42', '#6a604c']
	},
	roots: { tap: 1.0, spread: 1.8, count: 16, radius: 0.03 },
	leaf: { length: 0.11, width: 0.055, shape: ellipse, colour: '#2a5424', young: '#7aa04a', style: 'along', per: 0, droop: 0.25 },
	flower: { kind: citrusFlower('#fbf8ef'), size: 1.1, opens: 4.6, sites: 'tips', chance: 0.45, per: [2, 4] },
	fruit: {
		length: 0.078, width: 0.04, stalk: 0.03, keep: [1, 2], setFor: 1.8, ripeFrom: 2.7, ripeFor: 1.2, gloss: true, calyx: '#5f7a34',
		shape: (u, v) => pitted(u, v, 0.5),
		colour: (ripe, u) => ORANGE_COLOUR(clamp(ripe * 1.3 - (1 - u) * 0.3))
	}
});

export const LEMON_STAGES = stages([
	['Seed', 0, 'A pale pointed seed, fresh from the fruit, a centimetre down.'],
	['Germination', 21, 'The root goes down; the shoot hooks up, its seed leaves staying in the seed.'],
	['Seedling', 45, 'Glossy leaves, the newest flushed purple-red.'],
	['Sapling', 365, 'An open, rangy little tree, a sharp thorn at every leaf.'],
	['Young tree', 1300, 'An irregular crown, flushing and flowering on and off all year.'],
	['Blossom', 2100, 'Purple-tinged buds opening white, sweet-scented, at the shoot tips.'],
	['Fruit set', 2120, 'Small dark-green lemons set below the falling petals.'],
	['Green fruit', 2220, 'Oval green lemons with a nipple at their tip, full-sized but sour.'],
	['Colouring', 2290, 'The green pales to yellow from the tip.'],
	['Ripe', 2320, 'Bright yellow lemons, fragrant, while the tree flowers again above them.']
]);

export const lemon = orchard({
	seed: { size: v3(0.006, 0.0028, 0.0035), coat: '#efe6c8', shade: '#c9b98c', depth: 0.012 },
	hypogeal: true,
	flush: {
		trunk: 0.45, trunkBorn: 1.2, trunkFlush: 1.5, scaffolds: [3, 4], scaffoldAngle: 0.8,
		gens: 7, flush: 0.22, rest: 0.22, shoot: (gen) => [0, 0.8, 0.65, 0.52, 0.42, 0.34, 0.3, 0.26][gen] ?? 0.26,
		whorl: [2, 3], spread: 0.7, up: 0.03, droop: 0.07, wander: 0.14, radius: 0.085, taper: 0.62, thicken: 4,
		bark: ['#6f8a42', '#6c6250']
	},
	roots: { tap: 0.9, spread: 1.6, count: 14, radius: 0.03 },
	leaf: { length: 0.11, width: 0.05, shape: ellipse, colour: '#3a6a2c', young: '#8a4a5a', style: 'along', per: 0, droop: 0.3 },
	flower: { kind: citrusFlower('#f9f2f4'), size: 1.1, opens: 4.5, sites: 'tips', chance: 0.45, per: [2, 4] },
	fruit: {
		length: 0.09, width: 0.031, stalk: 0.03, keep: [1, 2], setFor: 1.8, ripeFrom: 2.7, ripeFor: 1.0, gloss: true, calyx: '#5f7a34',
		// oval, a nipple at its blossom end
		shape: (u, v) => pitted(Math.min(1, u * 1.04), v, 0.62) * (1 + 0.25 * Math.exp(-Math.pow((u - 0.93) / 0.04, 2))),
		colour: (ripe, u) => LEMON_COLOUR(clamp(ripe * 1.3 - (1 - u) * 0.3))
	}
});

export const DURIAN_STAGES = stages([
	['Seed', 0, 'A big glossy brown seed, four centimetres long, sown fresh — it dies if it dries.'],
	['Germination', 10, 'A thick root goes down, the shoot comes up from between the fleshy halves.'],
	['Seedling', 40, 'A slender stem, its leaves glossy green above, golden-brown and scaly beneath.'],
	['Sapling', 365, 'A straight leader with its first level side limbs: a young cone.'],
	['Young tree', 1460, 'A tall conical tree, its limbs near level in tiers up the trunk; the lowest dying off.'],
	['Flowering', 2900, 'Clusters of big cream flowers hang along the limbs, opening at dusk for the bats.'],
	['Fruit set', 2920, 'A few flowers in each cluster set small green fruit, spiny from the start.'],
	['Green fruit', 2980, 'Heavy spiny fruit, as big as a head, hanging from the limbs on stout stalks.'],
	['Ripening', 3010, 'The spines turn from green to yellow-brown; the smell begins.'],
	['Ripe', 3020, 'Ripe durians, yellow-brown and fragrant, ready to fall in the night.']
]);

/** its description, kept for its versions (./orchard.v1.js grows its v1) @type {import('./orchard.js').Orchard} */
export const DURIAN = {
	seed: { size: v3(0.02, 0.013, 0.014), coat: '#7a4a2a', shade: '#4a2a18', depth: 0.03 },
	hypogeal: true,
	leader: {
		height: [[1.2, 0], [2, 0.18], [3, 0.7], [4, 2.4], [5, 5.2], [6, 7.6], [7, 9.2], [8, 10.6], [9, 12]],
		radius: 0.3, tiers: 34, clear: 2.4, spacing: 0.36, angle: 1.3, limb: (h) => 4.2 * (1 - 0.65 * h) + 0.8,
		rate: 2.2, crown: 8, sides: 1.2, side: 0.26, bark: ['#8a6a4a', '#6a5040'], droop: 0.05
	},
	roots: { tap: 2.2, spread: 3, count: 18, radius: 0.07 },
	leaf: { length: 0.17, width: 0.05, shape: lance, colour: '#3d5a2a', young: '#a8a050', style: 'along', per: 5, droop: 0.25 },
	flower: { kind: { petals: 5, length: 0.03, width: 0.012, colour: '#f1ead0', heart: '#e8d8a0', sepals: 5, sepal: 0.02, sepalBack: 0.2, stamens: 26, stamenColour: '#f4e8b0' }, size: 1.4, opens: 5.0, sites: 'limbs', chance: 1.1, per: [3, 6] },
	fruit: {
		length: 0.27, width: 0.105, stalk: 0.09, keep: [1, 2], setFor: 2.0, ripeFrom: 3.0, ripeFor: 0.8, gloss: false,
		shape: (u) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.55),
		colour: (ripe) => DURIAN_COLOUR(ripe),
		skin: { colour: (ripe) => (ripe < 0.5 ? '#6a8434' : '#9a8a42'), count: 230, size: 0.0065, length: 2.4 }
	}
};
export const durian = orchard(DURIAN);

export const JACKFRUIT_STAGES = stages([
	['Seed', 0, 'A pale brown seed three centimetres long, its slimy coat washed off, sown fresh.'],
	['Germination', 15, 'A root goes down, the shoot comes up; the fleshy seed leaves stay inside the seed below.'],
	['Seedling', 45, 'A slender green stem, its first leaves glossy and often two- or three-lobed; its sap white and sticky.'],
	['Sapling', 365, 'A straight leader a metre tall, its leaves now whole, its first side limbs breaking.'],
	['Young tree', 1300, 'A cone of near-level limbs round one straight trunk, big glossy leaves crowded at the shoot tips.'],
	['Flowering', 2200, 'A dense dome over a clear trunk; short leafy footstalks burst from the bark with club-shaped green flower heads.'],
	['Fruit set', 2220, 'The male heads blacken and drop; the female heads swell into small knobbly green fruit, right on the bark.'],
	['Green fruit', 2300, 'Huge oblong fruit hanging straight down against the trunk, knobbly with short blunt spines.'],
	['Ripening', 2360, 'The skin yellows, the spines flatten; it smells sweet.'],
	['Ripe', 2380, 'Ripe jackfruit, up to half a metre long and tens of kilograms, in clusters all up the trunk and along the limbs.']
]);

/** its description, kept for its versions (./orchard.v1.js grows its v1) @type {import('./orchard.js').Orchard} */
export const JACKFRUIT = {
	seed: { size: v3(0.016, 0.009, 0.01), coat: '#c9a678', shade: '#8a6a44', depth: 0.03 },
	hypogeal: true,
	// a dense dome on a stout trunk: a tall clear trunk (where the fruit comes), then flush after flush
	flush: {
		trunk: 2.0, trunkBorn: 1.2, trunkFlush: 2.2, scaffolds: [4, 5], scaffoldAngle: 0.8,
		gens: 6, flush: 0.28, rest: 0.25, shoot: (gen) => [0, 1.6, 1.15, 0.85, 0.62, 0.48, 0.38][gen] ?? 0.35,
		whorl: [2, 3], spread: 0.6, up: 0.03, droop: 0.05, wander: 0.08, radius: 0.24, taper: 0.62, thicken: 4,
		bark: ['#857462', '#6a5a48']
	},
	roots: { tap: 2, spread: 2.8, count: 18, radius: 0.07 },
	leaf: { length: 0.16, width: 0.075, shape: ellipse, colour: '#2a4f22', young: '#7aa04a', style: 'along', per: 0, droop: 0.25 },
	flower: { catkin: true, size: 1, opens: 4.9, sites: 'trunk', chance: 3, per: [1, 3] },
	fruit: {
		length: 0.45, width: 0.14, stalk: 0.06, keep: [1, 1], setFor: 2.3, ripeFrom: 3.1, ripeFor: 0.8, gloss: false,
		shape: (u, v) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.42) * (1 + 0.03 * Math.sin(v * Math.PI * 2 * 26) * Math.sin(u * 70)),
		colour: (ripe) => JACK_COLOUR(ripe),
		skin: { colour: (ripe) => (ripe < 0.5 ? '#5f8a34' : '#a89a3a'), count: 240, size: 0.006, length: 1.3 }
	}
};
export const jackfruit = orchard(JACKFRUIT);
