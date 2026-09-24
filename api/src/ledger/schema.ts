/**
 * THE COIN SCHEMA — Zeto's `ZetoCoin`, verbatim, and its hashes.
 *
 *   commitment = poseidon(amount, salt, owner.x, owner.y)   the state id
 *   nullifier  = poseidon(amount, salt, ownerPrivateKey)    published on spend
 *
 * Both exactly as Zeto's circuits compute them, so a note minted here has
 * the id it would have on a Paladin node running Zeto.
 *
 * PERSONAL CURRENCIES. Every citizen has their own token — `samuel♥` — which
 * is a Zeto contract of its own, at an address derived from the issuer's
 * identity. Only the issuer mints it. That is Circles: one currency per human.
 *
 * THE CITY'S CURRENCY. `maiaHEARTS` has one issuer, the city, and comes into
 * being only when a citizen invests: their personal hearts go out, the same
 * amount of maiaHEARTS comes into the coop's treasury.
 */
import { keccak256, toHex } from 'viem'
import { poseidon3, poseidon4 } from 'poseidon-lite'
import { unpackPoint } from '@zk-kit/baby-jubjub'
import type { AbiTuple, Bytes32, EthAddress, HexUint256, Schema, ZetoCoin } from './types'
import { policy } from '../../../game/policy'

export const ZetoCoinABI: AbiTuple = {
	name: 'ZetoCoin',
	indexed: true,
	type: 'tuple',
	internalType: 'struct ZetoCoin',
	components: [
		{ name: 'salt', type: 'uint256' },
		{ name: 'owner', type: 'bytes32', indexed: true },
		{ name: 'amount', type: 'uint256' },
		{ name: 'locked', type: 'bool', indexed: true }
	]
}

/** `type=ZetoCoin(uint256 salt,bytes32 owner,uint256 amount,bool locked),labels=[owner,locked]` */
export function schemaSignature(def: AbiTuple): string {
	const fields = def.components.map((c) => `${c.type} ${c.name}`).join(',')
	const labels = def.components.filter((c) => c.indexed).map((c) => c.name)
	return `type=${def.name}(${fields}),labels=[${labels.join(',')}]`
}

export const schemaId = (def: AbiTuple): Bytes32 => keccak256(toHex(schemaSignature(def)))

export const heartsSchema: Omit<Schema, 'created'> = {
	id: schemaId(ZetoCoinABI),
	domain: policy.ledger.domain,
	type: 'abi',
	signature: schemaSignature(ZetoCoinABI),
	definition: ZetoCoinABI,
	labels: ZetoCoinABI.components.filter((c) => c.indexed).map((c) => c.name)
}

const u256 = (n: bigint): HexUint256 => `0x${n.toString(16).padStart(64, '0')}`

/** The commitment: poseidon(amount, salt, owner.x, owner.y). */
export function commitment(coin: ZetoCoin): HexUint256 {
	const owner = unpackPoint(BigInt(coin.owner))
	if (!owner) throw new Error('owner is not a BabyJubjub point')
	return u256(poseidon4([BigInt(coin.amount), BigInt(coin.salt), owner[0], owner[1]]))
}

/** The nullifier: poseidon(amount, salt, ownerPrivateKey). Only the owner can compute it. */
export function nullifier(coin: ZetoCoin, ownerPrivateKey: bigint): HexUint256 {
	return u256(poseidon3([BigInt(coin.amount), BigInt(coin.salt), ownerPrivateKey]))
}

/** The Zeto contract that IS a citizen's currency, deterministic from the issuer. */
export function tokenAddress(issuerIdentity: string): EthAddress {
	return `0x${keccak256(toHex(`zeto:${policy.ledger.domain}:${issuerIdentity}:${policy.currency.code}`)).slice(26)}`
}

/** `samuel♥` — a citizen's own currency: their name and the heart. */
export const tokenName = (issuerName: string) => `${issuerName}${policy.currency.symbol}`

/** `solar☉` — a coop's currency, its MINDs; ☉ is to MINDs what ♥ is to hearts. */
export const mindName = (slug: string) => `${slug}☉`

/** The city's identity on the ledger — the only issuer of maiaHEARTS. */
export const CITY = policy.city.identity

/** `maiaHEARTS` — the city's common currency, born only from investment. */
export const CITY_TOKEN = policy.city.token

/**
 * What a token is called, from its issuer's identity. Citizens are keyed by
 * their account id — names change and repeat — so the caller supplies the
 * current name: `citizen/<id>` → `samuel♥`, `coop/solar` → `solar☉`,
 * `city/maia` → `maiaHEARTS`.
 */
export function tokenLabel(issuerIdentity: string, nameOf: (founderId: string) => string): string {
	if (issuerIdentity === CITY) return CITY_TOKEN
	if (issuerIdentity.startsWith('coop/')) return mindName(issuerIdentity.slice('coop/'.length))
	return tokenName(nameOf(issuerIdentity.replace(/^citizen\//, '')))
}
