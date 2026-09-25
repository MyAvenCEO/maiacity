/**
 * THE CAP TABLE RULE — milestones counted in MINDs.
 *
 * Milestone n is reached when the coop's total supply is fib(n) MINDs:
 * 1, 2, 3, 5, 8, 13 … So milestone n emits the difference to the one
 * before — fib(n) − fib(n−1): 1, 1, 1, 2, 3, 5 … — at 10 × n hearts per
 * MIND (10♥ in milestone 1, 20♥ in 2 …), and costs that many hearts to fill. It opens when every earlier
 * one is filled.
 *
 * The schedule runs up to the MAX SUPPLY of 8 billion MINDs per coop: the
 * last milestone emits only what is left under the cap, and after it the
 * coop is sold out. A coop's total supply is therefore never more than what
 * its filled milestones, plus the open one so far, have emitted.
 *
 * Pure: reads the policy, knows nothing about the database. The policy's
 * table is generated from this rule and kept for humans (and a test).
 */
import coopsJson from './policy.coops.json' with { type: 'json' }
import { ONE } from './policy'

export type MilestoneRow = { milestone: number; minds: string; heartsPerMind: string; costHearts: string; opensAtHearts: string; cumulativeMinds: string; cumulativeHearts: string }
export type CoopPolicy = {
	emission: { toInvestor: number; toTreasury: number }
	/** Invested hearts convert into this currency, into the coop's treasury, at this rate. */
	conversion: { into: string; rate: string }
	milestones: { rule: string; maxSupplyMinds: string; heartsPerMindStep: string; table: MilestoneRow[] }
	founding: { founderStakeHearts: string; pitchMaxChars: number; canvas: string[] }
	city: { citizenshipMinHearts: string }
	settlement: { joinMinHearts: string; maxSettlers: number; levels: number[]; inviteDays: number }
	phases: { table: Phase[] }
	signal: { weights: Record<string, number> }
}

/** One of a coop's five phases — IDEA, TEST, BUILD, SCALE, HERO — ten milestones each. */
export type Phase = { name: string; from: number; to: number }
export const coopPolicy = coopsJson as unknown as CoopPolicy

/** The most MINDs a coop can ever have emitted, in the smallest units. */
export const MAX_SUPPLY = BigInt(coopPolicy.milestones.maxSupplyMinds) * ONE

/** Hearts per MIND rise by this much every milestone: 10♥ in milestone 1, 20♥ in 2 … */
export const PRICE_STEP = BigInt(coopPolicy.milestones.heartsPerMindStep)

/** The n-th Fibonacci number, 1, 2, 3, 5, 8 … (n from 1). */
export function fib(n: number): bigint {
	let a = 1n, b = 2n
	for (let i = 1; i < n; i++) [a, b] = [b, a + b]
	return a
}

/** One milestone, in the smallest units. */
export type Milestone = {
	milestone: number
	minds: bigint
	price: bigint
	cost: bigint
	opensAt: bigint
	closesAt: bigint
	/** The total supply once this milestone is filled: fib(n) MINDs. */
	cumulativeMinds: bigint
	/** The last milestone, cut short by the max supply. */
	capped: boolean
}

/** Every milestone, built once from the rule until the max supply is reached. */
export const MILESTONES: Milestone[] = (() => {
	const rows: Milestone[] = []
	let cumulativeMinds = 0n
	let opensAt = 0n
	for (let n = 1; cumulativeMinds < MAX_SUPPLY; n++) {
		let total = fib(n) * ONE
		let capped = false
		if (total >= MAX_SUPPLY) {
			total = MAX_SUPPLY
			capped = true
		}
		const minds = total - cumulativeMinds
		const price = BigInt(n) * PRICE_STEP
		const cost = minds * price
		cumulativeMinds = total
		rows.push({ milestone: n, minds, price, cost, opensAt, closesAt: opensAt + cost, cumulativeMinds, capped })
		opensAt += cost
	}
	return rows
})()

export const LAST = MILESTONES[MILESTONES.length - 1]!

export const PHASES: Phase[] = coopPolicy.phases.table

/** The phase a milestone belongs to; the last phase runs to the end of the schedule. */
export function phaseOf(milestone: number): Phase {
	return PHASES.find((p) => milestone >= p.from && milestone <= p.to) ?? PHASES[PHASES.length - 1]!
}
/** Hearts a coop can take in over its whole life, until it is sold out. */
export const CAPACITY = LAST.closesAt

export function milestone(n: number): Milestone {
	const m = MILESTONES[n - 1]
	if (!m) throw new RangeError(`No milestone ${n}: the schedule ends at ${LAST.milestone}, the max supply.`)
	return m
}

/** The milestone a coop is in, given the hearts invested so far (smallest units). Sold out → the last one. */
export function milestoneFor(raised: bigint): Milestone {
	for (const m of MILESTONES) if (raised < m.closesAt) return m
	return LAST
}

/** Hearts a coop can still take before its max supply. */
export function room(raised: bigint): bigint {
	return raised >= CAPACITY ? 0n : CAPACITY - raised
}

export const soldOut = (raised: bigint) => raised >= CAPACITY

/** Hearts still needed to fill the current milestone; `next` is null when it is the last. */
export function toNextMilestone(raised: bigint): { next: number | null; opensAt: bigint; remaining: bigint } {
	const m = milestoneFor(raised)
	const remaining = raised >= m.closesAt ? 0n : m.closesAt - raised
	return { next: m.capped ? null : m.milestone + 1, opensAt: m.closesAt, remaining }
}

/**
 * MINDs minted for a conversion of `hearts`, walked milestone by milestone:
 * a conversion that fills a milestone pays its price up to the fill and the
 * next price after, exactly like closing one round and opening the next.
 * Throws past the max supply; callers check `room` first.
 */
export function mindsFor(raisedBefore: bigint, hearts: bigint): { total: bigint; investor: bigint; treasury: bigint } {
	if (hearts > room(raisedBefore)) throw new RangeError('Past the max supply.')
	let left = hearts
	let at = raisedBefore
	let total = 0n
	while (left > 0n) {
		const m = milestoneFor(at)
		const chunk = left < m.closesAt - at ? left : m.closesAt - at
		total += chunk / m.price
		left -= chunk
		at += chunk
	}
	const investor = (total * BigInt(Math.round(coopPolicy.emission.toInvestor * 1000))) / 1000n
	return { total, investor, treasury: total - investor }
}

export type MilestoneState = 'filled' | 'current' | 'locked'

/** One row of the emission schedule, with where the coop stands in it. */
export type ScheduleRow = Milestone & {
	/** MINDs this milestone has emitted so far, given what was raised. */
	soFar: bigint
	/** Hearts still to come in before this milestone is filled. */
	remaining: bigint
	/** 0–100 of the cost raised. */
	fill: number
	/** Achieved, open right now, or still locked. */
	state: MilestoneState
}

/**
 * The whole emission schedule, marked from a coop's position: every filled
 * milestone, the open one with its progress, and the rest locked. `mindsFor` walks the same milestones, so the two always agree.
 */
export function schedule(raised: bigint): ScheduleRow[] {
	const current = milestoneFor(raised).milestone
	const done = soldOut(raised)
	return MILESTONES.map((m) => {
		const inside = raised <= m.opensAt ? 0n : raised >= m.closesAt ? m.cost : raised - m.opensAt
		const n = m.milestone
		const state: MilestoneState = done || n < current ? 'filled' : n === current ? 'current' : 'locked'
		return { ...m, soFar: inside / m.price, remaining: m.cost - inside, fill: m.cost > 0n ? Number((inside * 100n) / m.cost) : 100, state }
	})
}
