/**
 * COOPS — founded on a card of land, funded by investment, growing by milestone.
 *
 * Ported from avenCITY, with the rethink Day 09 describes. In avenCITY an
 * investment burned the investor's hearts and split the new MINDs between the
 * investor and the coop. Here nothing is lost: the investor's personal hearts
 * convert one for one into maiaHEARTS — the city's common currency — which the
 * coop's treasury holds to build with, and the investor receives the MINDs,
 * the ownership. The coops belong to the people who backed them.
 *
 * All of it — the burn, the maiaHEARTS, the MINDs, the raised count and the
 * record — is one database transaction. It lands whole or not at all.
 */
import { db, type Queryable } from '../pg'
import landJson from '../../../game/data/land.json' with { type: 'json' }
import { buildGlobe, FREQUENCY, LAND, WATER } from '../../../game/globe'
import { decodeLand } from '../../../game/map'
import { coopPolicy, LAST, milestoneFor, mindsFor, phaseOf, room, schedule, soldOut, toNextMilestone, type MilestoneState } from '../../../game/coops'
import { ONE } from '../../../game/policy'
import { calendar, format, toDemurraged, toInflationary } from '../../../game/time'
import { balanceOf, burn, identityOf, LedgerError, mint, totalSupply } from './hearts'
import { CITY, CITY_TOKEN, mindName } from './schema'

/** MINDs for people: whole when whole, else up to two places — 3.5, never a rounded 4. */
const compact = (amount: bigint) => format(amount, 2).replace(/\.?0+$/, '')

/* The same globe the client draws — same frequency, same coastline — so a tile index means the same card here. */
let tilesCache: ReturnType<typeof buildGlobe> | null = null
const tiles = () => (tilesCache ??= buildGlobe({ frequency: FREQUENCY, land: LAND, isLand: decodeLand(landJson as never) }))

let buildableCache: number | null = null
/** How many cards a coop could stand on: every card that is not water or ice. */
export const buildableCards = () => (buildableCache ??= tiles().filter((t) => !WATER.has(t.biome)).length)

export const coopIdentity = (slug: string) => `coop/${slug}`

export type CoopSummary = {
	slug: string
	name: string
	founder: string
	tile: number
	milestone: number
	phase: string
	raised: bigint
	raisedLabel: string
	/** MINDs emitted so far — the coop's total supply, whole MINDs. */
	supplyLabel: string
	backers: number
}

export type ScheduleLine = { milestone: number; minds: string; price: string; cost: string; cumulativeMinds: string; cumulativeHearts: string; state: MilestoneState; status: string; fill: number; progress: string; phase: string; phaseHeading: string }

export type CoopDetail = CoopSummary & {
	pitch: string
	mindToken: string
	priceLabel: string
	nextLabel: string
	/** Progress through the open milestone, 0..100. */
	fill: number
	/** The viewer's MINDs in this coop — empty when nobody is signed in. */
	myMindsLabel: string
	createdAt: string
	/** maiaHEARTS the treasury holds: every heart ever invested, converted. */
	treasuryLabel: string
	treasuryToken: string
	/** "Milestone 8 of 49 open · 5 of 13☉ emitted". */
	milestoneOf: string
	soldOut: boolean
	schedule: ScheduleLine[]
}

const STATUS: Record<MilestoneState, string> = { filled: 'achieved', current: 'open now', locked: 'locked' }
const minds = (v: bigint) => `${format(v, 0)}☉`
const left = (v: bigint) => (v > 0n && v < ONE ? '<1☉' : minds(v))

type Row = { id: string; slug: string; name: string; founder: string; pitch: string; tile: number; raised: string; created_at: string; backers: number }
const SELECT = `SELECT c.id, c.slug, c.name, f.name AS founder, c.pitch, c.tile, c.raised::text AS raised, c.created_at,
	(SELECT count(DISTINCT founder_id)::int FROM investments i WHERE i.coop_id = c.id) AS backers
	FROM coops c JOIN founders f ON f.id = c.founder_id`

function summary(r: Row): CoopSummary {
	const raised = BigInt(r.raised)
	const m = milestoneFor(raised)
	return {
		slug: r.slug,
		name: r.name,
		founder: r.founder,
		tile: Number(r.tile),
		milestone: m.milestone,
		phase: phaseOf(m.milestone).name,
		raised,
		raisedLabel: format(raised, 0),
		supplyLabel: compact(mindsFor(0n, raised).total),
		backers: Number(r.backers)
	}
}

async function detail(r: Row, viewerId: string | null, now: Date): Promise<CoopDetail> {
	const s = summary(r)
	const m = milestoneFor(s.raised)
	const { next, remaining } = toNextMilestone(s.raised)
	const done = soldOut(s.raised)
	const fill = done ? 100 : m.cost > 0n ? Number(((s.raised - m.opensAt) * 100n) / m.cost) : 0
	const soFar = done ? m.minds : (s.raised - m.opensAt) / m.price
	const day = calendar(now).dayIndex
	const coop = coopIdentity(r.slug)
	const [treasury, supply] = await Promise.all([balanceOf(CITY, coop), totalSupply(coop)])
	const mine = viewerId ? toDemurraged(await balanceOf(coop, identityOf(viewerId)), day) : null
	return {
		...s,
		supplyLabel: compact(toDemurraged(supply, day)),
		pitch: r.pitch,
		mindToken: mindName(r.slug),
		priceLabel: done ? 'sold out' : `${m.price}♥ per ☉`,
		nextLabel: done ? 'max supply reached' : next === null ? `${format(remaining, 0)}♥ to max supply` : `${format(remaining, 0)}♥ to milestone ${next}`,
		fill: Math.max(0, Math.min(100, fill)),
		myMindsLabel: mine === null ? '' : format(mine),
		createdAt: new Date(r.created_at).toISOString(),
		treasuryLabel: format(toDemurraged(treasury, day), 0),
		treasuryToken: CITY_TOKEN,
		milestoneOf: done ? `Sold out: all ${LAST.milestone} milestones achieved.` : `Milestone ${m.milestone} of ${LAST.milestone} open · ${compact(soFar)} of ${minds(m.minds)} emitted`,
		soldOut: done,
		schedule: schedule(s.raised).map((row) => ({
			milestone: row.milestone,
			minds: `+${minds(row.minds)}`,
			price: `${row.price}♥`,
			cost: `${format(row.cost, 0)}♥`,
			cumulativeMinds: minds(row.cumulativeMinds),
			cumulativeHearts: `${format(row.closesAt, 0)}♥`,
			state: row.state,
			status: STATUS[row.state],
			phase: phaseOf(row.milestone).name.toLowerCase(),
			phaseHeading: phaseOf(row.milestone).from === row.milestone ? phaseOf(row.milestone).name : '',
			fill: row.fill,
			progress: row.state === 'current' ? `${row.fill}% sold · ${left(row.minds - row.soFar)} left` : ''
		}))
	}
}

export async function listCoops(now = new Date()): Promise<CoopSummary[]> {
	const r = await db.query<Row>(`${SELECT} ORDER BY c.raised DESC, c.created_at ASC`)
	const day = calendar(now).dayIndex
	return Promise.all(r.rows.map(async (x) => ({ ...summary(x), supplyLabel: compact(toDemurraged(await totalSupply(coopIdentity(x.slug)), day)) })))
}

export async function coopDetail(slug: string, viewerId: string | null, now = new Date()): Promise<CoopDetail> {
	const r = await db.query<Row>(`${SELECT} WHERE c.slug = $1`, [slug.toLowerCase()])
	if (!r.rows[0]) throw new LedgerError(404, 'No such coop.')
	return detail(r.rows[0], viewerId, now)
}

async function coopAt(tile: number, tx: Queryable = db): Promise<string | null> {
	const r = await tx.query<{ slug: string }>('SELECT slug FROM coops WHERE tile = $1', [tile])
	return r.rows[0]?.slug ?? null
}

const NAME = /^[A-Za-z][A-Za-z0-9]{2,23}$/

/**
 * The conversion itself, inside a transaction the caller owns: the investor's
 * personal hearts are burned, the same amount of maiaHEARTS is minted into the
 * coop's treasury, and the investor receives the MINDs for it.
 */
async function convert(tx: Queryable, founderId: string, coop: { id: string; slug: string; raised: bigint }, hearts: bigint, now: Date) {
	const left = room(coop.raised)
	if (hearts > left) throw new LedgerError(400, left === 0n ? 'Sold out: this coop has reached its max supply of ☉.' : `Only ${format(left, 0)}♥ of room left before the max supply.`)

	const citizen = identityOf(founderId)
	const treasury = coopIdentity(coop.slug)
	const day = calendar(now).dayIndex
	/* Every currency melts at the same rate, so one for one in spendable units is one for one in the notes too. */
	const units = toInflationary(hearts, day)

	await burn(citizen, citizen, units, `coop:${coop.slug}`, now, tx, 'hearts of your own — mint first')
	await mint(CITY, treasury, units, now, tx)

	const emitted = mindsFor(coop.raised, hearts)
	if (emitted.investor > 0n) await mint(treasury, citizen, toInflationary(emitted.investor, day), now, tx)
	if (emitted.treasury > 0n) await mint(treasury, treasury, toInflationary(emitted.treasury, day), now, tx)

	await tx.query('UPDATE coops SET raised = raised + $2 WHERE id = $1', [coop.id, hearts.toString()])
	await tx.query('INSERT INTO investments (coop_id, founder_id, hearts, minds, milestone) VALUES ($1, $2, $3, $4, $5)', [
		coop.id,
		founderId,
		hearts.toString(),
		emitted.total.toString(),
		milestoneFor(coop.raised).milestone
	])
}

/** Invest `hearts` (spendable units) of your own currency into a coop. */
export async function invest(founderId: string, slug: string, hearts: bigint, now = new Date()): Promise<CoopDetail> {
	if (hearts <= 0n) throw new LedgerError(400, 'Nothing to invest.')
	await db.transaction(async (tx) => {
		const c = await tx.query<{ id: string; slug: string; raised: string }>('SELECT id, slug, raised::text AS raised FROM coops WHERE slug = $1 FOR UPDATE', [slug.toLowerCase()])
		if (!c.rows[0]) throw new LedgerError(404, 'No such coop.')
		await convert(tx, founderId, { id: c.rows[0].id, slug: c.rows[0].slug, raised: BigInt(c.rows[0].raised) }, hearts, now)
	})
	return coopDetail(slug, founderId, now)
}

/** Found a coop on a land card. The founder's own stake is its first investment. */
export async function createCoop(founderId: string, input: { name: string; pitch: string; tile: number }, now = new Date()): Promise<CoopDetail> {
	const name = String(input.name ?? '').trim()
	const pitch = String(input.pitch ?? '').trim()
	const tile = Number(input.tile)
	if (!NAME.test(name)) throw new LedgerError(400, 'A coop name is 3–24 letters and digits, starting with a letter.')
	if (!pitch || pitch.length > coopPolicy.founding.pitchMaxChars) throw new LedgerError(400, `A pitch is 1–${coopPolicy.founding.pitchMaxChars} characters.`)
	const t = tiles()[tile]
	if (!t || WATER.has(t.biome)) throw new LedgerError(400, 'A coop stands on land.')
	const slug = name.toLowerCase()
	const stake = BigInt(coopPolicy.founding.founderStakeHearts) * ONE

	await db.transaction(async (tx) => {
		if (await coopAt(tile, tx)) throw new LedgerError(409, 'That card is taken.')
		if ((await tx.query('SELECT 1 FROM coops WHERE slug = $1', [slug])).rows.length) throw new LedgerError(409, 'That coop name is taken.')
		const mine = toDemurraged(await balanceOf(identityOf(founderId), identityOf(founderId), tx), calendar(now).dayIndex)
		if (mine < stake) throw new LedgerError(400, `Founding takes ${coopPolicy.founding.founderStakeHearts}♥ of your own — mint first.`)
		const r = await tx.query<{ id: string }>('INSERT INTO coops (slug, name, founder_id, pitch, tile) VALUES ($1, $2, $3, $4, $5) RETURNING id', [slug, name, founderId, pitch, tile])
		await convert(tx, founderId, { id: r.rows[0]!.id, slug, raised: 0n }, stake, now)
	})
	return coopDetail(slug, founderId, now)
}

/** JSON-safe: bigints become strings. */
export function plain<T extends { raised: bigint }>(c: T): Omit<T, 'raised'> & { raised: string } {
	return { ...c, raised: c.raised.toString() }
}
