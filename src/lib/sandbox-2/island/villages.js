/*
 * A CITY'S VILLAGES. A city's island in Sandbox 2 is Sandbox 1's island ($lib/aven-city/game/three: the same ground,
 * nature, works and ring buildings, the generator in game/island); only how a settlement on it grows is Sandbox 2's.
 * Its settlements are VILLAGES that level up on the Fibonacci numbers (game/island/villages.ts): V1 … V12, each a mix
 * of Sandbox 1's ring buildings, laid evenly round the centre and turned as one until clear of what already stands.
 * The fire stays the heart of the village until the master dome takes the centre, and there is no pavilion in the
 * middle: from above it reads as the centre dome come early.
 */
import { planFor, ringBeds, VILLAGE_PLANS } from '../../../../game/island/villages';

/**
 * @typedef {`V${number}`} VillageKind
 * @typedef {import('$lib/aven-city/game/three/buildWorld').FactoryKind} FactoryKind
 * @typedef {import('$lib/aven-city/game/three/buildWorld').BuildingKind} BuildingKind
 * @typedef {VillageKind | FactoryKind} VillagePlacedKind  what a hex of a city's island carries
 */

/** Every village level, V1 … V12. */
export const VILLAGE_KINDS = VILLAGE_PLANS.map((p) => /** @type {VillageKind} */ (`V${p.level}`));

/** The village that stands for a level. @param {number} level @returns {VillageKind} */
export const villageKind = (level) => /** @type {VillageKind} */ (`V${Math.max(1, Math.min(VILLAGE_KINDS.length, level))}`);

/** @param {VillageKind} kind */
export const levelOf = (kind) => Number(kind.slice(1));

/** @type {BuildingKind[]} */
const RINGS = ['TENT', 'GLAMP', 'DOME3', 'DOME4'];

/** @type {import('$lib/aven-city/game/three/buildWorld').Settlements<VillageKind>} */
export const VILLAGES = {
	id: 'sandbox-2',
	levelOf,
	kindFor: villageKind,
	rings(level) {
		const plan = planFor(level);
		/** @type {Array<[BuildingKind, number]>} */
		const rings = RINGS.flatMap((k) => {
			const n = plan.counts[/** @type {keyof typeof plan.counts} */ (k)];
			return n ? [/** @type {[BuildingKind, number]} */ ([k, n])] : [];
		});
		return plan.master ? [...rings, ['DOME5', 1]] : rings;
	},
	// its ring beds, and the master dome's share up to the next level
	capacity(level) {
		const plan = planFor(level);
		return Math.max(ringBeds(plan), plan.master ? plan.to : 0);
	},
	stage: (level) => planFor(level).stage,
	forest: (level) => planFor(level).forest,
	layout: 'clear',
	pieces: { fire: [1, 4], pavilion: null },
	demo: {
		hero: 'V12',
		ring1: ['V11', 'SOLAR', 'V9', 'HEMP', 'V6', 'LIFETRAC'],
		ring2: ['POWER_CUBE', 'V9', null, 'BAMBOO', 'V11', 'V5', null, 'V12', 'V6', 'SOLAR', null, 'V9'],
		any: VILLAGE_KINDS,
		focus: ['V12', 'V11', 'V10']
	}
};
