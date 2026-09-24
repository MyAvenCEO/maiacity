/**
 * THE LEDGER'S SHAPES — Paladin's Zeto domain, on purpose.
 *
 * These mirror what a Paladin node exposes (pstate_*, ptx_*, and the Zeto
 * domain's coin and receipt), field for field, so swapping the table-backed
 * ledger for a real node is a change of transport, not of vocabulary.
 * https://lfdt-paladin.github.io/paladin/head/reference/types/
 */

export type Bytes32 = `0x${string}`
export type HexBytes = `0x${string}`
export type EthAddress = `0x${string}`
export type HexUint256 = `0x${string}`

/** A state schema: an ABI tuple with `indexed` components as the labels. */
export type Schema = {
	id: Bytes32
	created: string
	domain: string
	type: 'abi'
	signature: string
	definition: AbiTuple
	labels: string[]
}

export type AbiComponent = { name: string; type: string; indexed?: boolean; internalType?: string }
export type AbiTuple = { name: string; type: 'tuple'; internalType: string; indexed?: boolean; components: AbiComponent[] }

/**
 * Zeto's fungible coin, verbatim from `domains/zeto/pkg/types/states.go`.
 * `owner` is the compressed BabyJubjub public key; the state id is the
 * Poseidon commitment `poseidon(amount, salt, owner.x, owner.y)`.
 */
export type ZetoCoin = { salt: HexUint256; owner: HexBytes; amount: HexUint256; locked: boolean }

/** One immutable UTXO state. `data` is private; `id` (the commitment) is all the base ledger sees. */
export type State<Data = Record<string, unknown>> = {
	id: HexUint256
	created: string
	domain: string
	schema: Bytes32
	contractAddress: EthAddress
	data: Data
	confirmed?: { transaction: string; blockNumber: number }
	spent?: { transaction: string; blockNumber: number }
	/** Set once spent: `poseidon(amount, salt, ownerPrivateKey)` — what the chain sees instead of the id. */
	nullifier?: { nullifier: HexUint256; spent: boolean }
}

/** What a caller submits — Paladin's TransactionInput, the private subset, with Zeto's functions. */
export type TransactionInput = {
	idempotencyKey?: string
	type: 'private'
	domain: string
	from: string
	to: EthAddress
	function: 'mint' | 'transfer' | 'burn'
	data:
		| { mints: { to: string; amount: HexUint256 }[] }
		| { transfers: { to: string; amount: HexUint256 }[]; data?: HexBytes }
		| { burn: { amount: HexUint256; reason?: string } }
}

/**
 * Zeto's proof, as the receipt carries it. Today `kind: 'mock'`: the server
 * ran the circuit's checks itself and attests to them. A real node puts a
 * Groth16 proof here for the same public inputs.
 */
export type Proof = {
	circuit: 'anon_nullifier'
	kind: 'mock' | 'groth16'
	publicInputs: { nullifiers: HexUint256[]; outputCommitments: HexUint256[]; burned?: HexUint256 }
	verified: boolean
}

/** Paladin's TransactionReceipt plus the Zeto domain receipt's states, transfers and proof. */
export type TransactionReceipt = {
	id: string
	sequence: number
	indexed: string
	domain: string
	success: boolean
	transactionHash: Bytes32
	blockNumber: number
	failureMessage?: string
	contractAddress: EthAddress
	states: { inputs: ReceiptState[]; outputs: ReceiptState[] }
	transfers: { from?: string; to?: string; amount: HexUint256 }[]
	proof: Proof
}

export type ReceiptState = { id: HexUint256; schema: Bytes32; data: ZetoCoin }
