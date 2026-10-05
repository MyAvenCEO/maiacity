/*
 * THE PLANTS — every plant grown from code, as the plants viewer (/app/plants/) lists it: its name, what it is, its
 * ten stages from seed to ripe fruit (the last four the fruit's own: set, green, turning, ripe), and the function that
 * grows it at a stage from a seed id (./strawberry.js, ./cucumber.js, ./raspberry.js, ./tomato.js with its oxheart,
 * ./eggplant.js, ./coconut.js, ./grape.js, ./tropics.js (banana, pineapple), ./garden.js (pepper, pumpkin, blueberry), ./vegetables.js (radish, carrot, lettuce, garlic) and ./trees.js (mango,
 * apple, orange, lemon, durian, jackfruit, through ./orchard.js and ./crown.js) — all of it made of ./grow.js,
 * ./sprout.js, ./leaves.js, ./bloom.js and ./tree.js). The same seed id grows the same plant every time; another id, a
 * sister plant — leaner or bushier, its leaves turned otherwise, its roots another way through the soil. A new plant is
 * a file here and a line below.
 */
import { STAGES as STRAWBERRY, strawberry } from './strawberry.js';
import { STAGES as CUCUMBER, cucumber } from './cucumber.js';
import { STAGES as RASPBERRY, raspberry } from './raspberry.js';
import { OXHEART_STAGES, STAGES as TOMATO, oxheart, tomato } from './tomato.js';
import { STAGES as EGGPLANT, eggplant } from './eggplant.js';
import { STAGES as COCONUT, coconut } from './coconut.js';
import { APPLE_STAGES, DURIAN_STAGES, JACKFRUIT_STAGES, LEMON_STAGES, MANGO_STAGES, ORANGE_STAGES, apple, durian, jackfruit, lemon, mango, orange } from './trees.js';
import { CARROT_STAGES, GARLIC_STAGES, LETTUCE_STAGES, RADISH_STAGES, carrot, garlic, lettuce, radish } from './vegetables.js';
import { STAGES as GRAPE, grape } from './grape.js';
import { BANANA_STAGES, PINEAPPLE_STAGES, banana, pineapple } from './tropics.js';
import { BLUEBERRY_STAGES, PEPPER_STAGES, PUMPKIN_STAGES, blueberry, pepper, pumpkin } from './garden.js';

/** @typedef {{ name: string, day: number, note: string }} Stage */
/**
 * @typedef {{
 *   id: string, label: string, latin: string, note: string, from: string, stages: Stage[],
 *   grow: (stage: number, seed: string) => import('three').Group
 * }} Plant — `grow` builds it at a stage (0 … 9, the stages' indices; between them, on the way)
 */

/** @type {Plant[]} */
export const PLANTS = [
	{
		id: 'strawberry',
		label: 'Strawberry',
		latin: 'Fragaria × ananassa',
		note: 'From an achene on the soil to a rosette in fruit with a runner: trifoliate toothed leaves, white flowers, berries ripening from the tip.',
		from: 'Rosette · 150 days',
		stages: STRAWBERRY,
		grow: strawberry
	},
	{
		id: 'cucumber',
		label: 'Cucumber',
		latin: 'Cucumis sativus',
		note: 'From a flat seed to a vine on its stake: lobed rough leaves, coiling tendrils, yellow flowers, warted cucumbers hanging.',
		from: 'Vine · 70 days',
		stages: CUCUMBER,
		grow: cucumber
	},
	{
		id: 'raspberry',
		label: 'Raspberry',
		latin: 'Rubus idaeus · Himbeere',
		note: 'From a pitted seed to a prickly cane, leafy its first summer; its second, side shoots of small white flowers and clusters of red raspberries, new canes and a sucker beside it.',
		from: 'Cane · 2 summers',
		stages: RASPBERRY,
		grow: raspberry
	},
	{
		id: 'tomato',
		label: 'Tomato',
		latin: 'Solanum lycopersicum',
		note: 'From a flat hairy seed to a staked cordon: ragged compound leaves, trusses of nodding yellow stars, tomatoes ripening truss by truss from green through orange to red.',
		from: 'Cordon · 105 days',
		stages: TOMATO,
		grow: tomato
	},
	{
		id: 'oxheart',
		label: 'Oxheart tomato',
		latin: 'Solanum lycopersicum · Ochsenherz',
		note: 'A tall slender cordon, its wispy leaves hanging as if wilted; few, huge heart-shaped tomatoes to a truss, ribbed at the shoulders, ripening late to a pinkish red.',
		from: 'Cordon · 125 days',
		stages: OXHEART_STAGES,
		grow: oxheart
	},
	{
		id: 'eggplant',
		label: 'Eggplant',
		latin: 'Solanum melongena · Aubergine',
		note: 'A forked bush of big soft grey-green leaves with purple midribs, nodding violet stars, long glossy black-purple fruit under spiny green calyxes.',
		from: 'Bush · 115 days',
		stages: EGGPLANT,
		grow: eggplant
	},
	{
		id: 'king-coconut',
		label: 'King coconut',
		latin: "Cocos nucifera 'King' · Thambili",
		note: 'A palm from a whole golden nut: whole first leaves, then a ringed trunk and a crown of arching fronds, cream flower spikes and bunches of golden-orange nuts.',
		from: 'Palm · 7 years',
		stages: COCONUT,
		grow: coconut
	},
	{
		id: 'mango',
		label: 'Mango',
		latin: 'Mangifera indica',
		note: 'From a flat stone to a dome as wide as it is tall: a short trunk, scaffold limbs at 45°, flush after flush breaking in whorls from each tip; bronze-red new leaves, panicles at the tips, mangoes on long stalks turning gold and red.',
		from: 'Tree · 6 years',
		stages: MANGO_STAGES,
		grow: mango
	},
	{
		id: 'radish',
		label: 'Radish',
		latin: 'Raphanus sativus · Radieschen',
		note: 'Four weeks from seed: heart-shaped seed leaves, rough lobed leaves, the stem below them swelling into a red ball half out of the soil.',
		from: 'Root · 28 days',
		stages: RADISH_STAGES,
		grow: radish
	},
	{
		id: 'carrot',
		label: 'Carrot',
		latin: 'Daucus carota · Karotte',
		note: 'Grass-like seed leaves, then a fountain of ferny leaves over a taproot thickening down its length into a long orange cone.',
		from: 'Root · 95 days',
		stages: CARROT_STAGES,
		grow: carrot
	},
	{
		id: 'lettuce',
		label: 'Lettuce',
		latin: 'Lactuca sativa · Kopfsalat',
		note: 'A butterhead: a rosette of broad wavy leaves, the inner ones standing up and cupping over each other into a pale, buttery head.',
		from: 'Head · 55 days',
		stages: LETTUCE_STAGES,
		grow: lettuce
	},
	{
		id: 'garlic',
		label: 'Garlic',
		latin: 'Allium sativum · Knoblauch',
		note: 'A clove planted in autumn: roots from its base, flat blue-green leaves in two ranks, a winter’s rest, then a bulb of new cloves under purple-streaked skins and a curling scape.',
		from: 'Bulb · 9 months',
		stages: GARLIC_STAGES,
		grow: garlic
	},
	{
		id: 'grape',
		label: 'Red grape',
		latin: 'Vitis vinifera · Traube',
		note: 'From a pip to a vine trained on its post and wire: a woody trunk, two arms, green shoots with five-lobed leaves and tendrils, bunches turning red berry by berry.',
		from: 'Vine · 3 summers',
		stages: GRAPE,
		grow: grape
	},
	{
		id: 'apple',
		label: 'Apple',
		latin: 'Malus domestica · Apfel',
		note: 'From a pip to an open crown on scaffold limbs: toothed leaves, clusters of pink-budded white blossom, apples flushing red on the sunny side.',
		from: 'Tree · 6 years',
		stages: APPLE_STAGES,
		grow: apple
	},
	{
		id: 'orange',
		label: 'Orange',
		latin: 'Citrus × sinensis · Orange',
		note: 'A dense evergreen dome of glossy leaves, waxy white blossom heavy with scent, round fruit full-sized green before they turn orange.',
		from: 'Tree · 7 years',
		stages: ORANGE_STAGES,
		grow: orange
	},
	{
		id: 'lemon',
		label: 'Lemon',
		latin: 'Citrus × limon · Zitrone',
		note: 'An open, thorny little tree, its new leaves flushed purple, purple-budded white flowers, oval fruit with a nipple turning yellow from the tip.',
		from: 'Tree · 6 years',
		stages: LEMON_STAGES,
		grow: lemon
	},
	{
		id: 'durian',
		label: 'Durian',
		latin: 'Durio zibethinus',
		note: 'A tall conical tree, its near-level limbs in tiers; clusters of cream flowers along the limbs, then heavy spiny fruit hanging from them.',
		from: 'Tree · 8 years',
		stages: DURIAN_STAGES,
		grow: durian
	},
	{
		id: 'jackfruit',
		label: 'Jackfruit',
		latin: 'Artocarpus heterophyllus · Jackfrucht',
		note: 'A dense dome over a stout trunk; its flower heads and huge knobbly fruit burst straight out of the trunk and thickest limbs.',
		from: 'Tree · 6 years',
		stages: JACKFRUIT_STAGES,
		grow: jackfruit
	},
	{
		id: 'banana',
		label: 'Banana',
		latin: 'Musa acuminata · Banane',
		note: 'From a sucker: a pseudostem of rolled leaf sheaths, huge paddle leaves torn by the wind; the flower stalk bends over, purple bracts lift off hands of fingers curving up, the male bud hanging below.',
		from: 'Herb · 13 months',
		stages: BANANA_STAGES,
		grow: banana
	},
	{
		id: 'pepper',
		label: 'Bell pepper',
		latin: 'Capsicum annuum · Paprika',
		note: 'A little forking bush of glossy pointed leaves, a white flower nodding in every fork, blocky bells hanging green, then turning red.',
		from: 'Bush · 135 days',
		stages: PEPPER_STAGES,
		grow: pepper
	},
	{
		id: 'pumpkin',
		label: 'Pumpkin',
		latin: 'Cucurbita maxima · Kürbis (Hokkaido)',
		note: 'A vine running along the ground, rooting at its nodes, huge lobed leaves standing up, big yellow trumpets, ribbed pumpkins lying on the soil turning deep orange.',
		from: 'Vine · 110 days',
		stages: PUMPKIN_STAGES,
		grow: pumpkin
	},
	{
		id: 'pineapple',
		label: 'Pineapple',
		latin: 'Ananas comosus · Ananas',
		note: 'From a crown: a rosette of stiff spiny grey-green leaves; a red cone of violet flowers rises from its heart and fuses into one fruit, its eyes in spirals, yellowing from the base.',
		from: 'Rosette · 2 years',
		stages: PINEAPPLE_STAGES,
		grow: pineapple
	},
	{
		id: 'blueberry',
		label: 'Blueberry',
		latin: 'Vaccinium corymbosum · Blaubeere',
		note: 'A twiggy shrub of many canes, small elliptic leaves, hanging clusters of white urn-shaped bells, berries turning pink, then blue under a silvery bloom.',
		from: 'Shrub · 4 years',
		stages: BLUEBERRY_STAGES,
		grow: blueberry
	}
];

/** seed ids to start from: any text grows a plant */
export const SEEDS = ['maia', 'isar', 'samuel', 'backyard', 'seed-0042', 'sun', 'rain', 'domes'];

/** a fresh seed id, five letters and digits */
export const freshSeed = () => Math.random().toString(36).slice(2, 7);
