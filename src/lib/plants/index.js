/*
 * THE PLANTS — every plant grown from code, as the plants viewer (/app/plants/) lists it: its name, what it is, its
 * ten stages from seed to ripe fruit (the last four the fruit's own: set, green, turning, ripe), and the function that
 * grows it at a stage from a seed id (./strawberry.js, ./cucumber.js, ./raspberry.js, ./tomato.js, all of it made of
 * ./grow.js, ./sprout.js, ./leaves.js and ./bloom.js). The same seed id grows the same plant every time; another id, a
 * sister plant — leaner or bushier, its leaves turned otherwise, its roots another way through the soil. A new plant is
 * a file here and a line below.
 */
import { STAGES as STRAWBERRY, strawberry } from './strawberry.js';
import { STAGES as CUCUMBER, cucumber } from './cucumber.js';
import { STAGES as RASPBERRY, raspberry } from './raspberry.js';
import { STAGES as TOMATO, tomato } from './tomato.js';

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
	}
];

/** seed ids to start from: any text grows a plant */
export const SEEDS = ['maia', 'isar', 'samuel', 'backyard', 'seed-0042', 'sun', 'rain', 'domes'];

/** a fresh seed id, five letters and digits */
export const freshSeed = () => Math.random().toString(36).slice(2, 7);
