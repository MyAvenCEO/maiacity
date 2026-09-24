/**
 * THE STATE STORE AND THE BASE LEDGER — Paladin's split, in two tables.
 *
 * `ledger_states` is the node's PRIVATE state store: the full note (salt,
 * owner key, amount) that only the owner ever sees. `ledger_blocks` is the
 * BASE LEDGER: a transaction hash, the nullifiers it spent, the commitments
 * it created, and the proof — and nothing else. That is what a Zeto contract
 * holds on chain, which is why the upgrade path is a transport change.
 *
 * Keys are custodial, like Paladin's key manager: an identity locator
 * (`citizen/maia`) resolves to a BabyJubjub key pair the node holds (Zeto's
 * curve, for the commitment) and an Ethereum address (to submit with).
 */
import { Base8, mulPointEscalar, packPoint, subOrder } from '@zk-kit/baby-jubjub'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { db, type Queryable } from '../pg'
import type { EthAddress, HexBytes, HexUint256, State, ZetoCoin } from './types'
import { heartsSchema } from './schema'

export async function migrateLedger() {
	await db.exec(`
		CREATE TABLE IF NOT EXISTS ledger_schemas (
			id          text PRIMARY KEY,
			created     timestamptz NOT NULL DEFAULT now(),
			domain      text NOT NULL,
			type        text NOT NULL,
			signature   text NOT NULL,
			definition  jsonb NOT NULL,
			labels      jsonb NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ledger_keys (
			identity     text PRIMARY KEY,
			address      text NOT NULL UNIQUE,
			eth_key      text NOT NULL,
			bjj_key      text NOT NULL,
			bjj_pubkey   text NOT NULL UNIQUE,
			created      timestamptz NOT NULL DEFAULT now()
		);
		CREATE TABLE IF NOT EXISTS ledger_states (
			id               text PRIMARY KEY,
			created          timestamptz NOT NULL DEFAULT now(),
			domain           text NOT NULL,
			schema           text NOT NULL REFERENCES ledger_schemas(id),
			contract_address text NOT NULL,
			data             jsonb NOT NULL,
			owner            text NOT NULL,
			amount           numeric(78, 0) NOT NULL,
			confirmed_tx     uuid,
			spent_tx         uuid,
			nullifier        text UNIQUE
		);
		CREATE INDEX IF NOT EXISTS ledger_states_owner_unspent ON ledger_states (owner, contract_address) WHERE spent_tx IS NULL;
		CREATE TABLE IF NOT EXISTS ledger_transactions (
			id               uuid PRIMARY KEY,
			idempotency_key  text UNIQUE,
			sequence         bigserial,
			indexed          timestamptz NOT NULL DEFAULT now(),
			type             text NOT NULL,
			domain           text NOT NULL,
			from_identity    text NOT NULL,
			to_address       text NOT NULL,
			function         text NOT NULL,
			data             jsonb NOT NULL,
			success          boolean NOT NULL,
			failure_message  text,
			transaction_hash text NOT NULL,
			block_number     bigint NOT NULL,
			proof            jsonb NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ledger_tx_states (
			tx_id    uuid NOT NULL REFERENCES ledger_transactions(id),
			state_id text NOT NULL REFERENCES ledger_states(id),
			role     text NOT NULL,
			PRIMARY KEY (tx_id, state_id, role)
		);
		CREATE TABLE IF NOT EXISTS ledger_blocks (
			block_number     bigserial PRIMARY KEY,
			indexed          timestamptz NOT NULL DEFAULT now(),
			contract_address text NOT NULL,
			transaction_hash text NOT NULL UNIQUE,
			nullifiers       jsonb NOT NULL,
			outputs          jsonb NOT NULL,
			proof            jsonb NOT NULL
		);
	`)
	await db.query(
		`INSERT INTO ledger_schemas (id, domain, type, signature, definition, labels)
		 VALUES ($1, $2, $3, $4, $5::text::jsonb, $6::text::jsonb) ON CONFLICT (id) DO NOTHING`,
		[heartsSchema.id, heartsSchema.domain, heartsSchema.type, heartsSchema.signature, JSON.stringify(heartsSchema.definition), JSON.stringify(heartsSchema.labels)]
	)
}

/* ── keys ──────────────────────────────────────────────────────────────── */

export type Key = {
	identity: string
	/** The Ethereum address transactions are submitted from. */
	address: EthAddress
	/** The BabyJubjub private scalar — the only thing that can compute a nullifier. */
	bjjPrivate: bigint
	/** The compressed BabyJubjub public key: the `owner` of every note. */
	bjjPublic: HexBytes
}

const hex32 = (n: bigint): HexBytes => `0x${n.toString(16).padStart(64, '0')}`

/** Resolve an identity locator to its keys, creating them the first time. */
export async function resolveKey(identity: string, tx: Queryable = db): Promise<Key> {
	const found = await tx.query<{ address: string; bjj_key: string; bjj_pubkey: string }>(
		'SELECT address, bjj_key, bjj_pubkey FROM ledger_keys WHERE identity = $1',
		[identity]
	)
	const row = found.rows[0]
	if (row) return { identity, address: row.address as EthAddress, bjjPrivate: BigInt(row.bjj_key), bjjPublic: row.bjj_pubkey as HexBytes }
	const ethKey = generatePrivateKey()
	const address = privateKeyToAccount(ethKey).address
	const bytes = crypto.getRandomValues(new Uint8Array(32))
	const bjjPrivate = BigInt(`0x${Buffer.from(bytes).toString('hex')}`) % subOrder
	const bjjPublic = hex32(packPoint(mulPointEscalar(Base8, bjjPrivate)))
	await tx.query(
		'INSERT INTO ledger_keys (identity, address, eth_key, bjj_key, bjj_pubkey) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (identity) DO NOTHING',
		[identity, address, ethKey, hex32(bjjPrivate), bjjPublic]
	)
	return resolveKey(identity, tx)
}

/* ── states ────────────────────────────────────────────────────────────── */

type Row = { id: string; created: string; domain: string; schema: string; contract_address: string; data: ZetoCoin; confirmed_tx: string | null; spent_tx: string | null; nullifier: string | null; block_number?: number }

function toState(r: Row): State<ZetoCoin> {
	return {
		id: r.id as HexUint256,
		created: new Date(r.created).toISOString(),
		domain: r.domain,
		schema: r.schema as `0x${string}`,
		contractAddress: r.contract_address as EthAddress,
		data: r.data,
		...(r.confirmed_tx ? { confirmed: { transaction: r.confirmed_tx, blockNumber: r.block_number ?? 0 } } : {}),
		...(r.spent_tx ? { spent: { transaction: r.spent_tx, blockNumber: r.block_number ?? 0 } } : {}),
		...(r.nullifier ? { nullifier: { nullifier: r.nullifier as HexUint256, spent: true } } : {})
	}
}


/** Unspent notes of one currency owned by a key, largest first — the order coin selection wants. */
export async function unspentCoins(owner: HexBytes, contractAddress: EthAddress, tx: Queryable = db): Promise<State<ZetoCoin>[]> {
	const r = await tx.query<Row>(
		`SELECT * FROM ledger_states WHERE owner = $1 AND contract_address = $2 AND spent_tx IS NULL ORDER BY amount DESC, created ASC`,
		[owner, contractAddress]
	)
	return r.rows.map(toState)
}

/** Everything unspent of one currency, across every holder — its supply, in the units the states carry. */
export async function supplyOf(contractAddress: EthAddress): Promise<bigint> {
	const r = await db.query<{ total: string }>('SELECT coalesce(sum(amount), 0)::text AS total FROM ledger_states WHERE contract_address = $1 AND spent_tx IS NULL', [contractAddress])
	return BigInt(r.rows[0]?.total ?? '0')
}

/** Every currency a key holds, with the unspent total of each. */
export async function holdings(owner: HexBytes): Promise<{ contractAddress: EthAddress; total: bigint; notes: number }[]> {
	const r = await db.query<{ contract_address: string; total: string; notes: number }>(
		`SELECT contract_address, sum(amount)::text AS total, count(*)::int AS notes FROM ledger_states
		 WHERE owner = $1 AND spent_tx IS NULL GROUP BY contract_address ORDER BY sum(amount) DESC`,
		[owner]
	)
	return r.rows.map((x) => ({ contractAddress: x.contract_address as EthAddress, total: BigInt(x.total), notes: x.notes }))
}

export async function statesOf(owner: HexBytes, qualifier: 'available' | 'all' = 'all'): Promise<State<ZetoCoin>[]> {
	const r = await db.query<Row>(
		`SELECT s.*, t.block_number FROM ledger_states s LEFT JOIN ledger_transactions t ON t.id = s.confirmed_tx
		 WHERE s.owner = $1 ${qualifier === 'available' ? 'AND s.spent_tx IS NULL' : ''} ORDER BY s.created DESC`,
		[owner]
	)
	return r.rows.map(toState)
}

export async function insertState(tx: Queryable, state: State<ZetoCoin>, confirmedTx: string) {
	await tx.query(
		`INSERT INTO ledger_states (id, domain, schema, contract_address, data, owner, amount, confirmed_tx)
		 VALUES ($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8)`,
		[state.id, state.domain, state.schema, state.contractAddress, JSON.stringify(state.data), state.data.owner, BigInt(state.data.amount).toString(), confirmedTx]
	)
}

/** Spend a note by publishing its nullifier: refused if already spent — the double-spend check. */
export async function spendState(tx: Queryable, id: string, byTx: string, nullifierValue: HexUint256) {
	const r = await tx.query('UPDATE ledger_states SET spent_tx = $2, nullifier = $3 WHERE id = $1 AND spent_tx IS NULL', [id, byTx, nullifierValue])
	if (r.affectedRows !== 1) throw new Error(`state ${id} is already spent`)
}
