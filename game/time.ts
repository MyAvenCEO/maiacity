/**
 * THE CALENDAR AND THE DEMURRAGE.
 *
 * One real day is one game month. Demurrage is Circles-style: amounts are
 * accounted in INFLATIONARY units that never change, and converted to the
 * demurraged units a citizen sees with a per-day factor. Issuance goes the
 * other way, so 24 hearts a day stays 24 hearts a day in what you can spend.
 *
 *   gamma        = (1 - rate) ^ (1 / monthsPerYear)     per real day
 *   demurraged   = inflationary * gamma^day
 *   inflationary = demurraged   / gamma^day
 */
import { ONE, policy } from './policy'

const DAY_MS = 86_400_000
const EPOCH = Date.parse(policy.time.epoch)
/** Game time runs this many times faster than real time: a real day is a game month of thirty days. */
export const SPEED = 30
/** A game day, in real milliseconds: 48 minutes. */
export const GAME_DAY_MS = DAY_MS / SPEED

/** Real days since the founding, fractional. */
export function daysSinceEpoch(now = new Date()): number {
	return (now.getTime() - EPOCH) / DAY_MS
}

/** The game calendar for a moment: year and month from 1, plus the game day within the month. */
export function calendar(now = new Date()): { year: number; month: number; day: number; dayIndex: number } {
	const d = Math.max(0, daysSinceEpoch(now))
	const dayIndex = Math.floor(d)
	const year = Math.floor(dayIndex / policy.time.monthsPerYear) + 1
	const month = (dayIndex % policy.time.monthsPerYear) + 1
	/* A game month has 30 days, so a real hour is a game day and a quarter. */
	const day = Math.floor((d - dayIndex) * 30) + 1
	return { year, month, day, dayIndex }
}

/**
 * The in-game clock, as a date. Game time starts at the founding
 * (03.09.2026 00:00) and runs thirty times faster than real time, so the
 * label is a real-looking date-time that counts up from that day.
 */
export function gameClock(now = new Date()): { date: Date; label: string } {
	const elapsed = Math.max(0, now.getTime() - EPOCH) * SPEED
	const date = new Date(EPOCH + elapsed)
	const pad = (n: number) => String(n).padStart(2, '0')
	const label = `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCFullYear() % 100)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
	return { date, label }
}

/** The hour of the in-game day, 0..24 with minutes as a fraction: what the sun follows. */
export function gameHour(now = new Date()): number {
	const d = gameClock(now).date
	return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
}

/**
 * How long ago, in GAME time: a real second is thirty game seconds, so what
 * happened two real minutes ago happened an in-game hour ago.
 */
export function gameAgo(from: Date, now = new Date()): string {
	const s = Math.max(0, (now.getTime() - from.getTime()) / 1000) * SPEED
	const min = s / 60, h = min / 60, d = h / 24, w = d / 7, mo = d / 30, y = mo / policy.time.monthsPerYear
	if (min < 1) return 'just now'
	if (h < 1) return `${Math.floor(min)} min ago`
	if (d < 1) return `${Math.floor(h)} h ago`
	if (w < 1) return `${Math.floor(d)} d ago`
	if (mo < 1) return `${Math.floor(w)} w ago`
	if (y < 1) return `${Math.floor(mo)} mo ago`
	return `${Math.floor(y)} y ago`
}

export function calendarLabel(now = new Date()): string {
	const c = calendar(now)
	return `Y${c.year} · M${c.month}`
}

/** gamma^day, as a fixed-point bigint scaled by ONE. */
export function demurrageFactor(day: number): bigint {
	const gamma = (1 - policy.demurrage.ratePerGameYear) ** (1 / policy.time.monthsPerYear)
	return BigInt(Math.round(gamma ** Math.max(0, day) * Number(ONE)))
}

/** What an inflationary amount is worth on a given day. */
export function toDemurraged(inflationary: bigint, day: number): bigint {
	return (inflationary * demurrageFactor(day)) / ONE
}

/** How many inflationary units it takes to be worth `demurraged` on a given day. */
export function toInflationary(demurraged: bigint, day: number): bigint {
	/* Rounded UP, so that toDemurraged(toInflationary(x)) is exactly x: the
	   factor is at most ONE, so the ceiling costs less than one unit and the
	   floor on the way back lands on x. */
	const f = demurrageFactor(day)
	return (demurraged * ONE + f - 1n) / f
}

/**
 * Hearts accrued between two moments, in demurraged (spendable) units.
 *
 * The rate is per GAME hour — 24 a game day, one every two real minutes —
 * and the backlog cap is in game days, so the whole income runs on the
 * same clock the world does.
 */
export function accrued(since: Date, now = new Date()): bigint {
	const cap = policy.issuance.maxBacklogDays * GAME_DAY_MS
	const realMs = Math.min(Math.max(0, now.getTime() - since.getTime()), cap)
	const gameMs = BigInt(Math.floor(realMs * SPEED))
	const perHour = BigInt(policy.issuance.perHour) * ONE
	return (perHour * gameMs) / 3_600_000n
}

/** `24.00`, for people. */
export function format(amount: bigint, places = 2): string {
	const negative = amount < 0n
	/* Rounded half up at the shown place, not truncated: a change note one
	   wei short of 14 is fourteen hearts to a person. */
	const half = ONE / 10n ** BigInt(places) / 2n
	const abs = (negative ? -amount : amount) + half
	const whole = abs / ONE
	const frac = abs % ONE
	const digits = frac.toString().padStart(policy.currency.decimals, '0').slice(0, places)
	return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${places ? `.${digits}` : ''}`
}

/** `"12.5"` -> smallest units. Refuses more precision than the currency has. */
export function parse(text: string): bigint {
	const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim())
	if (!m) throw new Error('Not an amount.')
	const frac = (m[2] ?? '').padEnd(policy.currency.decimals, '0')
	if (frac.length > policy.currency.decimals) throw new Error('Too many decimals.')
	return BigInt(m[1]!) * ONE + BigInt(frac)
}
