/**
 * THE HEARTS DOMAIN — personal currencies, minted as basic income, spent as notes.
 *
 * Ported from avenCITY. The flow is Zeto's: to spend, pick unspent notes, make
 * the output notes (the recipient's and your own change), compute each input's
 * nullifier with your private key, and prove the inputs are yours and value is
 * conserved. The server is the prover here: it runs the circuit's checks and
 * records a mock proof carrying the real public inputs.
 *
 * Two changes from avenCITY. Citizens are keyed by their account id, not their
 * name — in maiaCITY names change and repeat, and a renamed citizen must not
 * lose their money. And every write can join an outer transaction, so an
 * investment's burn and mint land together or not at all.
 */
import { concatHex, keccak256, toHex } from 'viem'
import { db, type Queryable } from '../pg'
import { policy, ONE, STARTING } from '../../../game/policy'
import { accrued, calendar, format, toDemurraged, toInflationary } from '../../../game/time'
import { commitment, heartsSchema, nullifier, tokenAddress, tokenLabel, tokenName } from './schema'
import { holdings, insertState, resolveKey, spendState, supplyOf, unspentCoins, type Key } from './store'
import type { EthAddress, HexUint256, Proof, ReceiptState, State, TransactionInput, TransactionReceipt, ZetoCoin } from './types'

/** A citizen's ledger identity: their account id, so a rename never touches their money. */
export const identityOf = (founderId: string) => `citizen/${founderId}`

export class LedgerError extends Error {
	constructor(public status: number, message: string) {
		super(message)
	}
}

/** Current names for a set of citizen ids — tokens are labelled with them. */
export async function namesOf(): Promise<(founderId: string) => string> {
	const r = await db.query<{ id: string; name: string }>('SELECT id, name FROM founders')
	const m = new Map(r.rows.map((x) => [x.id, x.name]))
	return (id) => m.get(id) ?? 'someone'
}

/* ── notes ─────────────────────────────────────────────────────────────── */

const u256 = (n: bigint): HexUint256 => `0x${n.toString(16)}`

function newCoin(owner: Key, amount: bigint, contractAddress: EthAddress): State<ZetoCoin> {
	const bytes = crypto.getRandomValues(new Uint8Array(31)) // < field size
	const data: ZetoCoin = {
		salt: `0x${Buffer.from(bytes).toString('hex')}`,
		owner: owner.bjjPublic,
		amount: u256(amount),
		locked: false
	}
	return {
		id: commitment(data),
		created: new Date().toISOString(),
		domain: policy.ledger.domain,
		schema: heartsSchema.id,
		contractAddress,
		data
	}
}

const receiptState = (s: State<ZetoCoin>): ReceiptState => ({ id: s.id, schema: s.schema, data: s.data })
const sum = (states: State<ZetoCoin>[]) => states.reduce((a, s) => a + BigInt(s.data.amount), 0n)

/* ── the circuit ───────────────────────────────────────────────────────── */

/**
 * What Zeto's `anon_nullifier` circuit proves: every input is owned by the
 * prover, every nullifier is the prover's, and sum(inputs) == sum(outputs)
 * plus whatever is declared burned. Run here, attested with a mock proof.
 */
function prove(prover: Key, inputs: State<ZetoCoin>[], outputs: State<ZetoCoin>[], burned = 0n): { proof: Proof; nullifiers: HexUint256[] } {
	for (const s of inputs) {
		if (s.data.owner !== prover.bjjPublic) throw new LedgerError(403, `input ${s.id} is not owned by ${prover.identity}`)
		if (commitment(s.data) !== s.id) throw new LedgerError(400, `input ${s.id} does not match its commitment`)
	}
	for (const s of outputs) if (commitment(s.data) !== s.id) throw new LedgerError(400, 'output does not match its commitment')
	if (inputs.length && sum(inputs) !== sum(outputs) + burned) throw new LedgerError(400, 'value is not conserved')
	const nullifiers = inputs.map((s) => nullifier(s.data, prover.bjjPrivate))
	return {
		nullifiers,
		proof: { circuit: 'anon_nullifier', kind: 'mock', publicInputs: { nullifiers, outputCommitments: outputs.map((s) => s.id), ...(burned ? { burned: u256(burned) } : {}) }, verified: true }
	}
}

/* ── the contract ──────────────────────────────────────────────────────── */

/**
 * Commit one transaction: nullifiers and commitments to the base ledger, notes
 * to the private store. Inside `outer` when given, otherwise its own.
 */
async function commit(
	input: TransactionInput,
	inputs: State<ZetoCoin>[],
	outputs: State<ZetoCoin>[],
	nullifiers: HexUint256[],
	proof: Proof,
	transfers: TransactionReceipt['transfers'],
	now: Date,
	outer?: Queryable
): Promise<TransactionReceipt> {
	const transactionHash = keccak256(concatHex([toHex(input.function), input.to, ...nullifiers, ...outputs.map((s) => s.id)]))
	const id = crypto.randomUUID()
	const write = async (tx: Queryable): Promise<TransactionReceipt> => {
		const block = await tx.query<{ block_number: number }>(
			`INSERT INTO ledger_blocks (contract_address, transaction_hash, nullifiers, outputs, proof) VALUES ($1, $2, $3::text::jsonb, $4::text::jsonb, $5::text::jsonb) RETURNING block_number`,
			[input.to, transactionHash, JSON.stringify(nullifiers), JSON.stringify(outputs.map((s) => s.id)), JSON.stringify(proof)]
		)
		const blockNumber = Number(block.rows[0]!.block_number)
		const seq = await tx.query<{ sequence: number }>(
			`INSERT INTO ledger_transactions (id, idempotency_key, type, domain, from_identity, to_address, function, data, success, transaction_hash, block_number, proof)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, true, $9, $10, $11::text::jsonb) RETURNING sequence`,
			[id, input.idempotencyKey ?? null, input.type, input.domain, input.from, input.to, input.function, JSON.stringify(input.data), transactionHash, blockNumber, JSON.stringify(proof)]
		)
		for (const [i, s] of inputs.entries()) {
			await spendState(tx, s.id, id, nullifiers[i]!)
			await tx.query('INSERT INTO ledger_tx_states (tx_id, state_id, role) VALUES ($1, $2, $3)', [id, s.id, 'input'])
		}
		for (const s of outputs) {
			await insertState(tx, s, id)
			await tx.query('INSERT INTO ledger_tx_states (tx_id, state_id, role) VALUES ($1, $2, $3)', [id, s.id, 'output'])
		}
		return {
			id,
			sequence: Number(seq.rows[0]!.sequence),
			indexed: now.toISOString(),
			domain: input.domain,
			success: true,
			transactionHash,
			blockNumber,
			contractAddress: input.to,
			states: { inputs: inputs.map(receiptState), outputs: outputs.map(receiptState) },
			transfers,
			proof
		}
	}
	return outer ? write(outer) : db.transaction(write)
}

/** Largest notes first until `amount` is covered. */
async function select(owner: Key, contract: EthAddress, amount: bigint, tx: Queryable, label: string) {
	const coins = await unspentCoins(owner.bjjPublic, contract, tx)
	const inputs: State<ZetoCoin>[] = []
	let total = 0n
	for (const c of coins) {
		if (total >= amount) break
		inputs.push(c)
		total += BigInt(c.data.amount)
	}
	if (total < amount) throw new LedgerError(400, `Not enough ${label}.`)
	return { inputs, total }
}

/* ── the functions ─────────────────────────────────────────────────────── */

/** The issuer mints their own currency to an identity. Only the issuer may. */
export async function mint(issuerIdentity: string, toIdentity: string, amount: bigint, now = new Date(), outer?: Queryable): Promise<TransactionReceipt> {
	if (amount <= 0n) throw new LedgerError(400, 'Nothing to mint.')
	const issuer = await resolveKey(issuerIdentity, outer)
	const to = await resolveKey(toIdentity, outer)
	const contract = tokenAddress(issuerIdentity)
	const out = newCoin(to, amount, contract)
	const { proof, nullifiers } = prove(issuer, [], [out])
	return commit(
		{ type: 'private', domain: policy.ledger.domain, from: issuerIdentity, to: contract, function: 'mint', data: { mints: [{ to: toIdentity, amount: u256(amount) }] } },
		[], [out], nullifiers, proof, [{ to: to.bjjPublic, amount: u256(amount) }], now, outer
	)
}

/**
 * Burn `amount` (inflationary units) of one currency from an identity. The
 * inputs are spent, only the change comes back, and the burned amount is a
 * public input of the proof. In maiaCITY this is the first half of an
 * investment; the second half mints the same amount of maiaHEARTS.
 */
export async function burn(currencyIssuer: string, fromIdentity: string, amount: bigint, reason = '', now = new Date(), outer?: Queryable, label = 'hearts'): Promise<TransactionReceipt> {
	if (amount <= 0n) throw new LedgerError(400, 'Nothing to burn.')
	const run = async (tx: Queryable) => {
		const from = await resolveKey(fromIdentity, tx)
		const contract = tokenAddress(currencyIssuer)
		const { inputs, total } = await select(from, contract, amount, tx, label)
		const outputs = total > amount ? [newCoin(from, total - amount, contract)] : []
		const { proof, nullifiers } = prove(from, inputs, outputs, amount)
		return commit(
			{ type: 'private', domain: policy.ledger.domain, from: fromIdentity, to: contract, function: 'burn', data: { burn: { amount: u256(amount), reason } } },
			inputs, outputs, nullifiers, proof, [{ from: from.bjjPublic, amount: u256(amount) }], now, tx
		)
	}
	return outer ? run(outer) : db.transaction(run)
}

/** Unspent total of one currency held by an identity, in inflationary units. */
export async function balanceOf(currencyIssuer: string, holderIdentity: string, tx: Queryable = db): Promise<bigint> {
	const holder = await resolveKey(holderIdentity, tx)
	return sum(await unspentCoins(holder.bjjPublic, tokenAddress(currencyIssuer), tx))
}

/** A currency's whole supply, in inflationary units. */
export async function totalSupply(currencyIssuer: string): Promise<bigint> {
	return supplyOf(tokenAddress(currencyIssuer))
}

/* ── the basic income ──────────────────────────────────────────────────── */

export type Holding = { issuer: string; token: string; contractAddress: EthAddress; balance: bigint; balanceLabel: string; notes: number; kind: 'own' | 'hearts' | 'minds' | 'city' }

export type Account = {
	id: string
	number: number
	name: string
	role: string
	identity: string
	token: string
	/** Spendable units of my OWN currency today. */
	balance: bigint
	balanceLabel: string
	/** Accrued and not yet minted, in spendable units — the client ticks it forward. */
	claimable: bigint
	claimableLabel: string
	lastClaimAt: string
	/** True until the first mint: the founding stake is still waiting. */
	startingPending: boolean
	holdings: Holding[]
	calendarLabel: string
}

type Citizen = { id: string; number: number; name: string; role: string; last_claim_at: string; stake_at: string | null }

async function citizen(founderId: string, tx: Queryable = db): Promise<Citizen> {
	const u = await tx.query<Citizen>('SELECT id, number, name, role, last_claim_at, stake_at FROM founders WHERE id = $1', [founderId])
	if (!u.rows[0]) throw new LedgerError(404, 'No such citizen.')
	return u.rows[0]
}

export async function account(founderId: string, now = new Date()): Promise<Account> {
	const user = await citizen(founderId)
	const identity = identityOf(user.id)
	const key = await resolveKey(identity)
	const day = calendar(now).dayIndex
	const mine = tokenAddress(identity)
	const nameOf = await namesOf()
	const issuers = await db.query<{ identity: string }>('SELECT identity FROM ledger_keys')
	const byContract = new Map(issuers.rows.map((r) => [tokenAddress(r.identity), r.identity]))
	const held = (await holdings(key.bjjPublic)).map((h): Holding => {
		const issuer = byContract.get(h.contractAddress) ?? 'unknown'
		const balance = toDemurraged(h.total, day)
		const kind = h.contractAddress === mine ? 'own' : issuer.startsWith('coop/') ? 'minds' : issuer === policy.city.identity ? 'city' : 'hearts'
		return { issuer, token: tokenLabel(issuer, nameOf), contractAddress: h.contractAddress, balance, balanceLabel: format(balance), notes: h.notes, kind }
	})
	held.sort((a, b) => (a.kind === 'own' ? -1 : b.kind === 'own' ? 1 : 0))
	const own = held.find((h) => h.kind === 'own')
	const balance = own?.balance ?? 0n
	const startingPending = user.stake_at === null
	const claimable = accrued(new Date(user.last_claim_at), now) + (startingPending ? STARTING : 0n)
	const c = calendar(now)
	return {
		id: user.id,
		number: Number(user.number),
		name: user.name,
		role: user.role,
		identity,
		token: tokenName(user.name),
		balance,
		balanceLabel: format(balance),
		claimable,
		claimableLabel: format(claimable),
		lastClaimAt: new Date(user.last_claim_at).toISOString(),
		startingPending,
		holdings: held,
		calendarLabel: `Y${c.year} · M${c.month}`
	}
}

/**
 * Mint the income: everything accrued since the last mint — plus the founding
 * stake the first time — as one note of the citizen's own currency.
 */
export async function claim(founderId: string, now = new Date()): Promise<{ claimed: bigint }> {
	return db.transaction(async (tx) => {
		const user = await citizen(founderId, tx)
		const first = user.stake_at === null
		const claimed = accrued(new Date(user.last_claim_at), now) + (first ? STARTING : 0n)
		if (claimed < ONE / 100n) throw new LedgerError(400, 'Nothing to mint yet.')
		const identity = identityOf(user.id)
		await mint(identity, identity, toInflationary(claimed, calendar(now).dayIndex), now, tx)
		await tx.query('UPDATE founders SET last_claim_at = $2, stake_at = COALESCE(stake_at, $2) WHERE id = $1', [founderId, now])
		return { claimed }
	})
}

/** A citizen's transactions, newest first. */
export async function history(founderId: string) {
	const key = await resolveKey(identityOf(founderId))
	const r = await db.query<{ id: string; function: string; block_number: number; indexed: string; to_address: string; from_identity: string; data: unknown }>(
		`SELECT DISTINCT t.id, t.function, t.block_number, t.indexed, t.to_address, t.from_identity, t.data
		 FROM ledger_transactions t JOIN ledger_tx_states ts ON ts.tx_id = t.id JOIN ledger_states s ON s.id = ts.state_id
		 WHERE s.owner = $1 ORDER BY t.block_number DESC LIMIT 50`,
		[key.bjjPublic]
	)
	return r.rows.map((x) => ({
		id: x.id,
		function: x.function,
		blockNumber: Number(x.block_number),
		indexed: new Date(x.indexed).toISOString(),
		contractAddress: x.to_address,
		from: x.from_identity,
		data: typeof x.data === 'string' ? JSON.parse(x.data) : x.data
	}))
}
