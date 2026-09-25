/**
 * HOW A VILLAGE GROWS. A settlement levels up on the Fibonacci numbers — 1, 2,
 * 3, 5, 8, 13, 21, 34, 55, 89, 144, 233 settlers — and every level builds
 * enough beds for everyone until the next one. The ring buildings are the
 * Sandbox 1 domes:
 *
 *   TENT   2 people, a camp tent             GLAMP  4, a glamping dome
 *   DOME3 12, apartments round a commons     DOME4 24, the large dome homes
 *
 * Nothing is torn down at once: tents are swapped for glamping domes a few at a
 * time, glamping domes for dome homes, dome homes are joined by large domes —
 * the way people actually upgrade a place they are committing to. Only
 * when both rings are whole, at level 11, the MASTER DOME in the centre, the
 * 136 m dome of the shared essentials, where the people the rings cannot
 * house live. At 233 the food forest is planted and the village is complete:
 * 216 in the rings and 17 in the master dome.
 */
import { coopPolicy } from '../coops'

export type RingBuilding = 'TENT' | 'GLAMP' | 'DOME3' | 'DOME4'

export type VillagePlan = {
	level: number
	/** The headcount this level starts at, and the last one it houses before the next. */
	from: number
	to: number
	/** Ring buildings standing at this level. */
	counts: Partial<Record<RingBuilding, number>>
	/** The master dome stands in the centre, housing the surplus. */
	master: boolean
	/** The food forest is planted round everything. */
	forest: boolean
	/** Which of the shared camp pieces stand — Sandbox 1's stages 1–6. */
	stage: number
}

const BEDS: Record<RingBuilding, number> = { TENT: 2, GLAMP: 4, DOME3: 12, DOME4: 24 }

export const LEVELS: number[] = coopPolicy.settlement.levels

const PLANS: Omit<VillagePlan, 'level' | 'from' | 'to'>[] = [
	{ counts: { TENT: 1 }, master: false, forest: false, stage: 1 }, //  1       2 beds: one person, one tent
	{ counts: { TENT: 1 }, master: false, forest: false, stage: 1 }, //  2       2: the tent is shared
	{ counts: { TENT: 2 }, master: false, forest: false, stage: 1 }, //  3–4     4
	{ counts: { TENT: 4 }, master: false, forest: false, stage: 1 }, //  5–7     8
	{ counts: { TENT: 6 }, master: false, forest: false, stage: 1 }, //  8–12   12: a camp round the fire
	{ counts: { TENT: 4, GLAMP: 3 }, master: false, forest: false, stage: 2 }, // 13–20  20: tents swapped for glamping domes
	{ counts: { TENT: 2, GLAMP: 5, DOME3: 1 }, master: false, forest: false, stage: 3 }, // 21–33  36: the first dome home
	{ counts: { GLAMP: 6, DOME3: 3 }, master: false, forest: false, stage: 3 }, // 34–54  60: the last tent comes down
	{ counts: { GLAMP: 4, DOME3: 6 }, master: false, forest: false, stage: 3 }, // 55–88  88: the ring of dome homes is whole
	{ counts: { GLAMP: 2, DOME3: 6, DOME4: 3 }, master: false, forest: false, stage: 4 }, //  89–143 152: large domes replace glamping
	{ counts: { DOME3: 6, DOME4: 6 }, master: true, forest: false, stage: 5 }, // 144–232 216 + master: both rings whole, then the master dome
	{ counts: { DOME3: 6, DOME4: 6 }, master: true, forest: true, stage: 6 } //   233    216 + 17, and the food forest
]

export const VILLAGE_PLANS: VillagePlan[] = PLANS.map((p, i) => ({
	...p,
	level: i + 1,
	from: LEVELS[i]!,
	to: i + 1 < LEVELS.length ? LEVELS[i + 1]! - 1 : LEVELS[i]!
}))

/** A settlement's level from its headcount: the last Fibonacci number it has reached. */
export function villageLevel(settlers: number): number {
	let level = 1
	LEVELS.forEach((n, i) => settlers >= n && (level = i + 1))
	return level
}

export const planFor = (level: number): VillagePlan => VILLAGE_PLANS[Math.max(1, Math.min(VILLAGE_PLANS.length, level)) - 1]!

/** Beds in the rings at a level. */
export const ringBeds = (plan: VillagePlan) => Object.entries(plan.counts).reduce((n, [k, c]) => n + BEDS[k as RingBuilding] * (c ?? 0), 0)

/** Who lives where at a headcount: in the rings, and the surplus in the master dome. */
export function housing(settlers: number): { level: number; ring: number; master: number } {
	const plan = planFor(villageLevel(settlers))
	const ring = Math.min(settlers, ringBeds(plan))
	return { level: plan.level, ring, master: settlers - ring }
}
