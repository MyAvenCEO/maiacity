/**
 * THE LEDGER, FOR A PERSON — what the ledger sheet shows: what they hold, and
 * what happened, told from their side. Amounts in spendable units, labelled
 * with the tokens' current names.
 */
import { db } from '../pg'
import { calendar, format, toDemurraged } from '../../../game/time'
import { account, history, namesOf } from './hearts'
import { heartsToken, tokenAddress, tokenLabel } from './schema'

export type LedgerRow = { id: string; title: string; token: string; indexed: string; figure: string; sign: '+' | '-' }

export type LedgerView = {
	holdings: { token: string; balanceLabel: string; kind: string }[]
	transactions: LedgerRow[]
}

export async function ledgerView(founderId: string, now = new Date()): Promise<LedgerView> {
	const a = await account(founderId, now)
	const day = calendar(now).dayIndex
	const nameOf = await namesOf()
	const issuers = await db.query<{ identity: string }>('SELECT identity FROM ledger_keys')
	const tokenOf = new Map(issuers.rows.map((r) => [tokenAddress(r.identity), tokenLabel(r.identity, nameOf)]))
	const coops = await db.query<{ slug: string; name: string; city: string }>('SELECT c.slug, c.name, COALESCE(p.slug, c.slug) AS city FROM coops c LEFT JOIN coops p ON p.id = c.city_id')
	const coopOf = new Map(coops.rows.map((c) => [c.slug, c]))

	const transactions = (await history(founderId)).map((t): LedgerRow => {
		const token = tokenOf.get(t.contractAddress as `0x${string}`) ?? '?'
		const d = t.data as { mints?: { to: string; amount: string }[]; burn?: { amount: string; reason?: string } }
		if (t.function === 'burn') {
			const amount = toDemurraged(BigInt(d.burn?.amount ?? '0x0'), day)
			const [, slug] = /^(?:city|settlement|coop):(.+)$/.exec(d.burn?.reason ?? '') ?? []
			const c = slug ? coopOf.get(slug) : undefined
			const into = c ? `Invested in ${c.name} — became ${heartsToken(c.city)}` : 'Burned'
			return { id: t.id, title: into, token, indexed: t.indexed, figure: format(amount), sign: '-' }
		}
		const amount = toDemurraged(BigInt(d.mints?.[0]?.amount ?? '0x0'), day)
		const own = t.from === a.identity
		const title = own ? 'Minted your income' : t.from.startsWith('coop/') || t.from.startsWith('city/') ? `Received ${token} for your investment` : `Received ${token}`
		return { id: t.id, title, token, indexed: t.indexed, figure: format(amount), sign: '+' }
	})

	return {
		holdings: a.holdings.map((h) => ({ token: h.token, balanceLabel: h.balanceLabel, kind: h.kind })),
		transactions
	}
}
