/** The monetary policy, loaded and typed. Values live in game/policy.hearts.json. */
import policyJson from './policy.hearts.json' with { type: 'json' }

export type Policy = {
	currency: { name: string; symbol: string; code: string; decimals: number; personal: boolean; naming: string }
	time: { epoch: string; realDayIsGameMonth: boolean; monthsPerYear: number }
	issuance: { kind: 'ubi'; toEveryHuman: boolean; perHour: string; perDay: string; maxBacklogDays: number; starting: string }
	demurrage: { ratePerGameYear: number }
	interchange: { kind: 'later' }
	ledger: { domain: string; kind: 'zeto'; schema: string; circuit: string }
	/** Every city's own two currencies are its name plus these: maia + HEARTS, maia + MINDS. */
	city: { heartsSuffix: string; mindsSuffix: string }
}

export const policy = policyJson as unknown as Policy

/** One heart, in the smallest unit. */
export const ONE = 10n ** BigInt(policy.currency.decimals)

/** The founding stake, in the smallest unit. */
export const STARTING = BigInt(policy.issuance.starting) * ONE
