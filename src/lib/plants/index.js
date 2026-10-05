/*
 * THE PLANTS — every plant grown from code, as the plants viewer (/app/plants/) lists it: its name, what it is, its
 * ten stages from seed to ripe fruit (the last four the fruit's own: set, green, turning, ripe), and the function that
 * grows it at a stage from a seed id (./strawberry.js, ./cucumber.js, ./raspberry.js, ./tomato.js with its oxheart,
 * ./eggplant.js, ./coconut.js, ./mango.js — all of it made of ./grow.js, ./sprout.js, ./leaves.js, ./bloom.js and
 * ./tree.js). The same seed id grows the same plant every time; another id, a
 * sister plant — leaner or bushier, its leaves turned otherwise, its roots another way through the soil. A new plant is
 * a file here and a line below.
 */
import { STAGES as STRAWBERRY, strawberry } from './strawberry.js';
import { STAGES as CUCUMBER, cucumber } from './cucumber.js';
import { STAGES as RASPBERRY, raspberry } from './raspberry.js';
import { OXHEART_STAGES, STAGES as TOMATO, oxheart, tomato } from './tomato.js';
import { STAGES as EGGPLANT, eggplant } from './eggplant.js';
import { STAGES as COCONUT, coconut } from './coconut.js';
import { STAGES as MANGO, mango } from './mango.js';

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
		note: 'From a flat stone to a domed tree: bronze-red flushes greening to leathery leaves, upright panicles of tiny flowers, mangoes on long stalks turning gold and red.',
		from: 'Tree · 6 years',
		stages: MANGO,
		grow: mango
	}
];

/** seed ids to start from: any text grows a plant */
export const SEEDS = ['maia', 'isar', 'samuel', 'backyard', 'seed-0042', 'sun', 'rain', 'domes'];

/** a fresh seed id, five letters and digits */
export const freshSeed = () => Math.random().toString(36).slice(2, 7);
