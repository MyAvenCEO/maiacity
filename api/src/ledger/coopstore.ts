/**
 * CITIES AND SETTLEMENTS — a card of the planet is unlocked by founding a city
 * on it; the city opens as an island of cells, and settlements stand on them.
 *
 * A city is itself a coop: the same Fibonacci milestones, a treasury, MINDS.
 * What makes it a city is its name on the money. Maia issues maiaHEARTS — the
 * common currency every investment in Maia turns into — and maiaMINDS, the
 * ownership of the city.
 *
 * Joining a city takes two steps. First citizenship: at least 25,000 personal
 * hearts into the city. Then a home: a settlement — a dome cluster on one cell
 * of the island, itself a coop with its own MINDS (riversideMINDS). A citizen
 * founds one, or joins one through an invite link from one of its settlers:
 * at least 5,000 hearts either way. Both are for good: one city, one
 * settlement per player.
 *
 * Every step of an investment — the personal hearts out, the city's HEARTS in,
 * the MINDS to the investor, the raised count, the record, the membership, the
 * used invite — is one database transaction. It lands whole or not at all.
 */
import { randomBytes } from 'node:crypto'
import { db, type Queryable } from '../pg'
import landJson from '../../../game/data/land.json' with { type: 'json' }
import { buildGlobe, FREQUENCY, LAND, WATER } from '../../../game/globe'
import { decodeLand } from '../../../game/map'
import { coopPolicy, LAST, milestoneFor, mindsFor, phaseOf, room, schedule, soldOut, toNextMilestone, type MilestoneState } from '../../../game/coops'
import { ONE } from '../../../game/policy'
import { calendar, format, toDemurraged, toInflationary } from '../../../game/time'
import { buildable, islandCells, islandSeed, settlementLevel } from '../../../game/island/island'
import { balanceOf, burn, identityOf, LedgerError, mint, totalSupply } from './hearts'
import { cityIdentity, coopIdentity, heartsIssuer, heartsToken, mindsToken } from './schema'

export { cityIdentity, coopIdentity }

/** MINDS for people: whole when whole, else up to two places — 3.5, never a rounded 4. */
const compact = (amount: bigint) => format(amount, 2).replace(/\.?0+$/, '')

/* The same globe the client draws — same frequency, same coastline — so a tile index means the same card here. */
let tilesCache: ReturnType<typeof buildGlobe> | null = null
const tiles = () => (tilesCache ??= buildGlobe({ frequency: FREQUENCY, land: LAND, isLand: decodeLand(landJson as never) }))

let buildableCache: number | null = null
/** How many cards a city could stand on: every card that is not water or ice. */
export const buildableCards = () => (buildableCache ??= tiles().filter((t) => !WATER.has(t.biome)).length)

/** The least a player invests into a city to become its citizen, in spendable units. */
export const CITIZENSHIP = BigInt(coopPolicy.city.citizenshipMinHearts) * ONE
/** The least a citizen invests into a settlement to make it their home. */
export const SETTLING = BigInt(coopPolicy.settlement.joinMinHearts) * ONE
const MAX_SETTLERS = coopPolicy.settlement.maxSettlers

export type Kind = 'city' | 'settlement' | 'coop'

export type CoopSummary = {
	slug: string
	kind: Kind
	name: string
	founder: string
	tile: number
	/** A settlement's cell on its city's island, "q,r"; null for a city. */
	cell: string | null
	/** The city it belongs to — for a city, itself. */
	city: { slug: string; name: string }
	milestone: number
	phase: string
	raised: bigint
	raisedLabel: string
	/** MINDS emitted so far — the total supply. */
	supplyLabel: string
	backers: number
	/** How many players are citizens of the city. Only for cities. */
	citizens: number
	/** How many players live in the settlement, and its Sandbox 1 level from that. */
	settlers: number
	level: number
}

export type CitySummary = CoopSummary & { island: number; settlements: CoopSummary[] }

export type ScheduleLine = { milestone: number; minds: string; price: string; cost: string; cumulativeMinds: string; cumulativeHearts: string; state: MilestoneState; status: string; fill: number; progress: string; phase: string; phaseHeading: string }

export type CoopDetail = CoopSummary & {
	pitch: string
	mindToken: string
	/** The city's HEARTS, which this treasury holds. */
	heartsToken: string
	priceLabel: string
	nextLabel: string
	/** Progress through the open milestone, 0..100. */
	fill: number
	/** The viewer's MINDS here — empty when nobody is signed in. */
	myMindsLabel: string
	createdAt: string
	treasuryLabel: string
	/** "Milestone 8 of 49 open · 5 of 13☉ emitted". */
	milestoneOf: string
	soldOut: boolean
	schedule: ScheduleLine[]
	/** A city's settlements, largest first. Empty otherwise. */
	settlements: CoopSummary[]
	/** The seed of the city's island. */
	island: number
	/** The least a newcomer invests: citizenship for a city, a home for a settlement. */
	entryLabel: string
}

const STATUS: Record<MilestoneState, string> = { filled: 'achieved', current: 'open now', locked: 'locked' }
const minds = (v: bigint) => `${format(v, 0)}☉`
const left = (v: bigint) => (v > 0n && v < ONE ? '<1☉' : minds(v))

type Row = {
	id: string
	slug: string
	kind: Kind
	name: string
	founder: string
	pitch: string
	tile: number
	cell: string | null
	raised: string
	created_at: string
	backers: number
	citizens: number
	settlers: number
	city_id: string | null
	city_slug: string | null
	city_name: string | null
}
const SELECT = `SELECT c.id, c.slug, c.kind, c.name, f.name AS founder, c.pitch, c.tile, c.cell, c.raised::text AS raised, c.created_at,
	c.city_id, p.slug AS city_slug, p.name AS city_name,
	(SELECT count(DISTINCT founder_id)::int FROM investments i WHERE i.coop_id = c.id) AS backers,
	(SELECT count(*)::int FROM founders z WHERE z.city_id = c.id) AS citizens,
	(SELECT count(*)::int FROM founders z WHERE z.settlement_id = c.id) AS settlers
	FROM coops c JOIN founders f ON f.id = c.founder_id LEFT JOIN coops p ON p.id = c.city_id`

const treasuryOf = (kind: Kind, slug: string) => (kind === 'city' ? cityIdentity(slug) : coopIdentity(slug))

function summary(r: Row): CoopSummary {
	const raised = BigInt(r.raised)
	const m = milestoneFor(raised)
	return {
		slug: r.slug,
		kind: r.kind,
		name: r.name,
		founder: r.founder,
		tile: Number(r.tile),
		cell: r.cell,
		city: r.kind === 'city' ? { slug: r.slug, name: r.name } : { slug: r.city_slug!, name: r.city_name! },
		milestone: m.milestone,
		phase: phaseOf(m.milestone).name,
		raised,
		raisedLabel: format(raised, 0),
		supplyLabel: compact(mindsFor(0n, raised).total),
		backers: Number(r.backers),
		citizens: Number(r.citizens),
		settlers: Number(r.settlers),
		level: r.kind === 'settlement' ? settlementLevel(Number(r.settlers)) : 0
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
	const treasury = treasuryOf(r.kind, r.slug)
	const [held, supply] = await Promise.all([balanceOf(heartsIssuer(s.city.slug), treasury), totalSupply(treasury)])
	const mine = viewerId ? toDemurraged(await balanceOf(treasury, identityOf(viewerId)), day) : null
	const settlements = r.kind === 'city' ? (await db.query<Row>(`${SELECT} WHERE c.city_id = $1 ORDER BY c.raised DESC, c.created_at ASC`, [r.id])).rows.map(summary) : []
	return {
		...s,
		supplyLabel: compact(toDemurraged(supply, day)),
		pitch: r.pitch,
		mindToken: mindsToken(r.slug),
		heartsToken: heartsToken(s.city.slug),
		priceLabel: done ? 'sold out' : `${m.price}♥ per ☉`,
		nextLabel: done ? 'max supply reached' : next === null ? `${format(remaining, 0)}♥ to max supply` : `${format(remaining, 0)}♥ to milestone ${next}`,
		fill: Math.max(0, Math.min(100, fill)),
		myMindsLabel: mine === null ? '' : format(mine),
		createdAt: new Date(r.created_at).toISOString(),
		treasuryLabel: format(toDemurraged(held, day), 0),
		milestoneOf: done ? `Sold out: all ${LAST.milestone} milestones achieved.` : `Milestone ${m.milestone} of ${LAST.milestone} open · ${compact(soFar)} of ${minds(m.minds)} emitted`,
		soldOut: done,
		settlements,
		island: islandSeed(Number(r.tile)),
		entryLabel: format(r.kind === 'city' ? CITIZENSHIP : SETTLING, 0),
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

/** Every city, each with its settlements — what the planet and the islands draw. */
export async function listCities(now = new Date()): Promise<CitySummary[]> {
	const r = await db.query<Row>(`${SELECT} ORDER BY c.raised DESC, c.created_at ASC`)
	const day = calendar(now).dayIndex
	const all = await Promise.all(r.rows.map(async (x) => ({ row: x, s: { ...summary(x), supplyLabel: compact(toDemurraged(await totalSupply(treasuryOf(x.kind, x.slug)), day)) } })))
	return all
		.filter((x) => x.row.kind === 'city')
		.map((x) => ({ ...x.s, island: islandSeed(x.s.tile), settlements: all.filter((y) => y.row.city_id === x.row.id).map((y) => y.s) }))
}

export async function coopDetail(slug: string, viewerId: string | null, now = new Date()): Promise<CoopDetail> {
	const r = await db.query<Row>(`${SELECT} WHERE c.slug = $1`, [slug.toLowerCase()])
	if (!r.rows[0]) throw new LedgerError(404, 'No such city or coop.')
	return detail(r.rows[0], viewerId, now)
}

type Place = { id: string; slug: string; name: string }

/** The city a player is a citizen of, if any. */
export async function cityOf(founderId: string, tx: Queryable = db): Promise<Place | null> {
	const r = await tx.query<Place>('SELECT c.id, c.slug, c.name FROM founders f JOIN coops c ON c.id = f.city_id WHERE f.id = $1', [founderId])
	return r.rows[0] ?? null
}

/** The settlement a player lives in, if any. */
export async function settlementOf(founderId: string, tx: Queryable = db): Promise<Place | null> {
	const r = await tx.query<Place>('SELECT c.id, c.slug, c.name FROM founders f JOIN coops c ON c.id = f.settlement_id WHERE f.id = $1', [founderId])
	return r.rows[0] ?? null
}

const NAME = /^[A-Za-z][A-Za-z0-9]{2,23}$/

function checkNameAndPitch(input: { name?: unknown; pitch?: unknown }, what: string) {
	const name = String(input.name ?? '').trim()
	const pitch = String(input.pitch ?? '').trim()
	if (!NAME.test(name)) throw new LedgerError(400, `A ${what} name is 3–24 letters and digits, starting with a letter.`)
	if (!pitch || pitch.length > coopPolicy.founding.pitchMaxChars) throw new LedgerError(400, `One line on what it is for: 1–${coopPolicy.founding.pitchMaxChars} characters.`)
	return { name, pitch, slug: name.toLowerCase() }
}

async function nameFree(tx: Queryable, slug: string) {
	if ((await tx.query('SELECT 1 FROM coops WHERE slug = $1', [slug])).rows.length) throw new LedgerError(409, 'That name is taken.')
}

type Target = { id: string; slug: string; kind: Kind; citySlug: string; raised: bigint }

/**
 * The conversion itself, inside a transaction the caller owns: the investor's
 * personal hearts are burned, the same amount of the city's HEARTS is minted
 * into the target's treasury, and the investor receives its MINDS.
 */
async function convert(tx: Queryable, founderId: string, target: Target, hearts: bigint, now: Date) {
	const space = room(target.raised)
	if (hearts > space) throw new LedgerError(400, space === 0n ? 'Sold out: this has reached its max supply of MINDS.' : `Only ${format(space, 0)}♥ of room left before the max supply.`)

	const citizen = identityOf(founderId)
	const treasury = treasuryOf(target.kind, target.slug)
	const day = calendar(now).dayIndex
	/* Every currency melts at the same rate, so one for one in spendable units is one for one in the notes too. */
	const units = toInflationary(hearts, day)

	await burn(citizen, citizen, units, `${target.kind}:${target.slug}`, now, tx, 'hearts of your own — mint first')
	await mint(heartsIssuer(target.citySlug), treasury, units, now, tx)

	const emitted = mindsFor(target.raised, hearts)
	if (emitted.investor > 0n) await mint(treasury, citizen, toInflationary(emitted.investor, day), now, tx)
	if (emitted.treasury > 0n) await mint(treasury, treasury, toInflationary(emitted.treasury, day), now, tx)

	await tx.query('UPDATE coops SET raised = raised + $2 WHERE id = $1', [target.id, hearts.toString()])
	await tx.query('INSERT INTO investments (coop_id, founder_id, hearts, minds, milestone) VALUES ($1, $2, $3, $4, $5)', [
		target.id,
		founderId,
		hearts.toString(),
		emitted.total.toString(),
		milestoneFor(target.raised).milestone
	])
}

async function ownBalance(tx: Queryable, founderId: string, now: Date) {
	return toDemurraged(await balanceOf(identityOf(founderId), identityOf(founderId), tx), calendar(now).dayIndex)
}

const citizenshipText = `Becoming a citizen takes at least ${format(CITIZENSHIP, 0)}♥ of your own`

/** Lock the player's row, so two requests cannot give them two cities or two homes. */
async function lockPlayer(tx: Queryable, founderId: string): Promise<{ city: string | null; settlement: string | null }> {
	const r = await tx.query<{ city_id: string | null; settlement_id: string | null }>('SELECT city_id, settlement_id FROM founders WHERE id = $1 FOR UPDATE', [founderId])
	if (!r.rows[0]) throw new LedgerError(404, 'No such player.')
	return { city: r.rows[0].city_id, settlement: r.rows[0].settlement_id }
}

/**
 * Found a city on an empty card of land. The founder's investment — at least
 * the citizenship — is the city's first, and makes them its first citizen.
 */
export async function foundCity(founderId: string, input: { name?: unknown; pitch?: unknown; tile?: unknown; hearts: bigint }, now = new Date()): Promise<CoopDetail> {
	const { name, pitch, slug } = checkNameAndPitch(input, 'city')
	const tile = Number(input.tile)
	const t = tiles()[tile]
	if (!t || WATER.has(t.biome)) throw new LedgerError(400, 'A city stands on land.')
	if (input.hearts < CITIZENSHIP) throw new LedgerError(400, `${citizenshipText} — founding a city is the first of them.`)

	await db.transaction(async (tx) => {
		if ((await lockPlayer(tx, founderId)).city) throw new LedgerError(409, 'You are already a citizen of a city, and that is for good.')
		if ((await tx.query("SELECT 1 FROM coops WHERE kind = 'city' AND tile = $1", [tile])).rows.length) throw new LedgerError(409, 'That card already holds a city.')
		await nameFree(tx, slug)
		if ((await ownBalance(tx, founderId, now)) < input.hearts) throw new LedgerError(400, `Not enough hearts of your own — founding takes ${format(input.hearts, 0)}♥. Mint first.`)
		const r = await tx.query<{ id: string }>("INSERT INTO coops (slug, kind, name, founder_id, pitch, tile) VALUES ($1, 'city', $2, $3, $4, $5) RETURNING id", [slug, name, founderId, pitch, tile])
		const id = r.rows[0]!.id
		await convert(tx, founderId, { id, slug, kind: 'city', citySlug: slug, raised: 0n }, input.hearts, now)
		await tx.query('UPDATE founders SET city_id = $2 WHERE id = $1', [founderId, id])
	})
	return coopDetail(slug, founderId, now)
}

/**
 * Invest `hearts` (spendable units) of your own currency into a city or a
 * settlement. Into a city you are not yet part of, it is your citizenship: at
 * least the minimum, and for good. Into your own city, any amount. Into a
 * settlement, only your own — a new home is founded, or joined by invitation.
 */
export async function invest(founderId: string, slug: string, hearts: bigint, now = new Date()): Promise<CoopDetail> {
	if (hearts <= 0n) throw new LedgerError(400, 'Nothing to invest.')
	await db.transaction(async (tx) => {
		const me = await lockPlayer(tx, founderId)
		const target = await lockTarget(tx, slug)
		if (target.kind === 'city') {
			if (me.city && me.city !== target.id) throw new LedgerError(403, `You are a citizen of ${(await cityOf(founderId, tx))?.name}, for good. You back your own city.`)
			const joining = !me.city
			if (joining && hearts < CITIZENSHIP) throw new LedgerError(400, `${citizenshipText} into ${target.name}.`)
			await convert(tx, founderId, targetOf(target), hearts, now)
			if (joining) await tx.query('UPDATE founders SET city_id = $2 WHERE id = $1', [founderId, target.id])
			return
		}
		if (me.settlement !== target.id) {
			if (me.settlement) throw new LedgerError(403, `You live in ${(await settlementOf(founderId, tx))?.name}. You back your own settlement.`)
			throw new LedgerError(403, `${target.name} grows by invitation. Ask one of its settlers for an invite link, or found your own settlement.`)
		}
		await convert(tx, founderId, targetOf(target), hearts, now)
	})
	return coopDetail(slug, founderId, now)
}

type Locked = { id: string; slug: string; kind: Kind; name: string; city_id: string | null; city_slug: string | null; city_name: string | null; raised: string }

async function lockTarget(tx: Queryable, slug: string): Promise<Locked> {
	const c = await tx.query<Locked>(
		`SELECT c.id, c.slug, c.kind, c.name, c.city_id, p.slug AS city_slug, p.name AS city_name, c.raised::text AS raised
		 FROM coops c LEFT JOIN coops p ON p.id = c.city_id WHERE c.slug = $1 FOR UPDATE OF c`,
		[slug.toLowerCase()]
	)
	if (!c.rows[0]) throw new LedgerError(404, 'No such city or settlement.')
	return c.rows[0]
}

const targetOf = (t: Locked): Target => ({ id: t.id, slug: t.slug, kind: t.kind, citySlug: t.kind === 'city' ? t.slug : t.city_slug!, raised: BigInt(t.raised) })

const settlingText = `A home in a settlement takes at least ${format(SETTLING, 0)}♥ of your own`

async function settlers(tx: Queryable, settlementId: string) {
	return Number((await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM founders WHERE settlement_id = $1', [settlementId])).rows[0]!.n)
}

/**
 * Found a settlement on a free cell of your city's island — the second step
 * into a city. The founder's investment is its first, and makes it their home.
 */
export async function foundSettlement(founderId: string, input: { name?: unknown; pitch?: unknown; cell?: unknown; hearts: bigint }, now = new Date()): Promise<CoopDetail> {
	const { name, pitch, slug } = checkNameAndPitch(input, 'settlement')
	const cell = String(input.cell ?? '')
	if (input.hearts < SETTLING) throw new LedgerError(400, `${settlingText} — founding one is the first of them.`)

	await db.transaction(async (tx) => {
		const me = await lockPlayer(tx, founderId)
		if (!me.city) throw new LedgerError(403, 'Settlements stand inside a city. Become a citizen of one first.')
		if (me.settlement) throw new LedgerError(409, 'You already live in a settlement, and that is for good.')
		const city = (await tx.query<{ id: string; slug: string; tile: number }>('SELECT id, slug, tile FROM coops WHERE id = $1 FOR UPDATE', [me.city])).rows[0]!
		const at = islandCells(islandSeed(Number(city.tile))).get(cell)
		if (!at || !buildable(at)) throw new LedgerError(400, 'A settlement stands on land, not on water.')
		if ((await tx.query('SELECT 1 FROM coops WHERE city_id = $1 AND cell = $2', [city.id, cell])).rows.length) throw new LedgerError(409, 'That cell is taken.')
		await nameFree(tx, slug)
		if ((await ownBalance(tx, founderId, now)) < input.hearts) throw new LedgerError(400, `Not enough hearts of your own — founding takes ${format(input.hearts, 0)}♥. Mint first.`)
		const r = await tx.query<{ id: string }>("INSERT INTO coops (slug, kind, city_id, name, founder_id, pitch, tile, cell) VALUES ($1, 'settlement', $2, $3, $4, $5, $6, $7) RETURNING id", [slug, city.id, name, founderId, pitch, city.tile, cell])
		const id = r.rows[0]!.id
		await convert(tx, founderId, { id, slug, kind: 'settlement', citySlug: city.slug, raised: 0n }, input.hearts, now)
		await tx.query('UPDATE founders SET settlement_id = $2 WHERE id = $1', [founderId, id])
	})
	return coopDetail(slug, founderId, now)
}

export type Invite = { token: string; expiresAt: string; settlement: { slug: string; name: string }; city: { slug: string; name: string }; invitedBy: string; usable: boolean; reason: string }

/** A settler makes an invite link: one person, for a week. */
export async function createInvite(founderId: string, slug: string, now = new Date()): Promise<Invite> {
	const token = randomBytes(12).toString('base64url')
	await db.transaction(async (tx) => {
		const s = (await tx.query<{ id: string; kind: Kind }>('SELECT id, kind FROM coops WHERE slug = $1', [slug.toLowerCase()])).rows[0]
		if (!s || s.kind !== 'settlement') throw new LedgerError(404, 'No such settlement.')
		const me = await lockPlayer(tx, founderId)
		if (me.settlement !== s.id) throw new LedgerError(403, 'Only its settlers invite people into a settlement.')
		if ((await settlers(tx, s.id)) >= MAX_SETTLERS) throw new LedgerError(409, `The settlement is full: ${MAX_SETTLERS} people live there.`)
		const expires = new Date(now.getTime() + coopPolicy.settlement.inviteDays * 86_400_000)
		await tx.query('INSERT INTO invites (token, settlement_id, created_by, expires_at) VALUES ($1, $2, $3, $4)', [token, s.id, founderId, expires])
	})
	return inviteInfo(token, now)
}

/** What an invite link opens: whose it is, where to, and whether it still works. */
export async function inviteInfo(token: string, now = new Date(), tx: Queryable = db): Promise<Invite> {
	const r = await tx.query<{ token: string; expires_at: string; used_by: string | null; slug: string; name: string; city_slug: string; city_name: string; inviter: string }>(
		`SELECT i.token, i.expires_at, i.used_by, s.slug, s.name, c.slug AS city_slug, c.name AS city_name, f.name AS inviter
		 FROM invites i JOIN coops s ON s.id = i.settlement_id JOIN coops c ON c.id = s.city_id JOIN founders f ON f.id = i.created_by WHERE i.token = $1`,
		[token]
	)
	const i = r.rows[0]
	if (!i) throw new LedgerError(404, 'This invite link does not exist.')
	const expired = new Date(i.expires_at).getTime() < now.getTime()
	return {
		token: i.token,
		expiresAt: new Date(i.expires_at).toISOString(),
		settlement: { slug: i.slug, name: i.name },
		city: { slug: i.city_slug, name: i.city_name },
		invitedBy: i.inviter,
		usable: !i.used_by && !expired,
		reason: i.used_by ? 'This invite has already been used.' : expired ? 'This invite has expired. Ask for a new one.' : ''
	}
}

/** Accept an invite: the citizen's investment makes the settlement their home, and the link is spent. */
export async function acceptInvite(founderId: string, token: string, hearts: bigint, now = new Date()): Promise<CoopDetail> {
	let slug = ''
	await db.transaction(async (tx) => {
		const inv = (await tx.query<{ settlement_id: string; used_by: string | null; expires_at: string }>('SELECT settlement_id, used_by, expires_at FROM invites WHERE token = $1 FOR UPDATE', [token])).rows[0]
		if (!inv) throw new LedgerError(404, 'This invite link does not exist.')
		if (inv.used_by) throw new LedgerError(409, 'This invite has already been used.')
		if (new Date(inv.expires_at).getTime() < now.getTime()) throw new LedgerError(410, 'This invite has expired. Ask for a new one.')
		const me = await lockPlayer(tx, founderId)
		const target = await lockTarget(tx, (await tx.query<{ slug: string }>('SELECT slug FROM coops WHERE id = $1', [inv.settlement_id])).rows[0]!.slug)
		slug = target.slug
		if (me.city !== target.city_id) throw new LedgerError(403, me.city ? `You are a citizen of ${(await cityOf(founderId, tx))?.name}, for good. ${target.name} is in ${target.city_name}.` : `First become a citizen of ${target.city_name} — then the invite takes you home.`)
		if (me.settlement) throw new LedgerError(409, 'You already live in a settlement, and that is for good.')
		if (hearts < SETTLING) throw new LedgerError(400, `${settlingText}.`)
		if ((await settlers(tx, target.id)) >= MAX_SETTLERS) throw new LedgerError(409, `${target.name} is full: ${MAX_SETTLERS} people live there.`)
		await convert(tx, founderId, targetOf(target), hearts, now)
		await tx.query('UPDATE founders SET settlement_id = $2 WHERE id = $1', [founderId, target.id])
		await tx.query('UPDATE invites SET used_by = $2, used_at = $3 WHERE token = $1', [token, founderId, now])
	})
	return coopDetail(slug, founderId, now)
}

type Plain<T> = Omit<T, 'raised' | 'settlements'> & { raised: string }

/** JSON-safe: bigints become strings, all the way down. */
export function plain<T extends { raised: bigint; settlements?: CoopSummary[] }>(c: T): Plain<T> & { settlements?: Plain<CoopSummary>[] } {
	const { settlements, ...rest } = c
	return { ...rest, raised: c.raised.toString(), ...(settlements ? { settlements: settlements.map((x) => ({ ...x, raised: x.raised.toString() })) } : {}) } as Plain<T> & { settlements?: Plain<CoopSummary>[] }
}
