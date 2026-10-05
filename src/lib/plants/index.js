/*
 * THE PLANTS — every plant grown from code, as the plants viewer (/app/plants/) lists it: its name, what it is, its
 * seven stages from seed to fruit, and the function that grows it at a stage from a seed id (./strawberry.js,
 * ./cucumber.js, all of it made of ./grow.js). The same seed id grows the same plant every time; another id, a
 * sister plant — leaner or bushier, its leaves turned otherwise, its roots another way through the soil. A new plant is
 * a file here and a line below.
 */
import { STAGES as STRAWBERRY, strawberry } from './strawberry.js';
import { STAGES as CUCUMBER, cucumber } from './cucumber.js';

/** @typedef {{ name: string, day: number, note: string }} Stage */
/**
 * @typedef {{
 *   id: string, label: string, latin: string, note: string, from: string, stages: Stage[],
 *   grow: (g: number, seed: string) => import('three').Group
 * }} Plant — `grow` builds it at growth g (0 … 6, the stages' indices; between them, on the way)
 */

/** @type {Plant[]} */
export const PLANTS = [
	{
		id: 'strawberry',
		label: 'Strawberry',
		latin: 'Fragaria × ananassa',
		note: 'From an achene on the soil to a rosette in fruit with a runner: trifoliate toothed leaves, white flowers, berries ripening from the tip.',
		from: 'Rosette · 140 days',
		stages: STRAWBERRY,
		grow: strawberry
	},
	{
		id: 'cucumber',
		label: 'Cucumber',
		latin: 'Cucumis sativus',
		note: 'From a flat seed to a vine on its stake: lobed rough leaves, coiling tendrils, yellow flowers, warted cucumbers hanging.',
		from: 'Vine · 60 days',
		stages: CUCUMBER,
		grow: cucumber
	}
];

/** seed ids to start from: any text grows a plant */
export const SEEDS = ['maia', 'isar', 'samuel', 'backyard', 'seed-0042', 'sun', 'rain', 'domes'];

/** a fresh seed id, five letters and digits */
export const freshSeed = () => Math.random().toString(36).slice(2, 7);
