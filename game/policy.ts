/** The monetary policy, loaded and typed. Values live in game/policy.hearts.json. */
import policyJson from './policy.hearts.json' with { type: 'json' }

export type Policy = {
	currency: { name: string; symbol: string; code: string; decimals: number; personal: boolean; naming: string }
	time: { epoch: string; realDayIsGameMonth: boolean; monthsPerYear: number }
	issuance: { kind: 'ubi'; toEveryHuman: boolean; perHour: string; perDay: string; maxBacklogDays: number; starting: string }
	demurrage: { ratePerGameYear: number }
	interchange: { kind: 'later' }
	ledger: { domain: string; kind: 'zeto'; schema: string; circuit: string }
	/** The city's own currency: maiaHEARTS, born only by investing personal hearts into a coop. */
	city: { identity: string; token: string; symbol: string }
}

export const policy = policyJson as unknown as Policy

/** One heart, in the smallest unit. */
export const ONE = 10n ** BigInt(policy.currency.decimals)

/** The founding stake, in the smallest unit. */
export const STARTING = BigInt(policy.issuance.starting) * ONE
