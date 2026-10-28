/**
 * What the law or a holder asks of a party to pay (a fine, the costs of a clearance, damages): a claim against it
 * (docs/design/claims.md), paid by its act or enforced step by step, where the world has the law of its kind; else
 * charged at once as before (a world whose practice says nothing of claims).
 */
import type { EntityId, WriteCtx } from '../../kernel/src/index.ts';
import { ACCOUNTS, pay, type AccountId } from '../../economy/src/index.ts';
import type {} from '../../agreements/src/index.ts';

export function charge(ctx: WriteCtx, o: { debtor: EntityId; creditor: EntityId; creditorLabel?: string; kind: 'coercive' | 'administrative' | 'criminal' | 'private' | 'public'; label: string; basis: string; amount: number; refs: EntityId[]; person?: EntityId }): void {
  if (!(o.amount > 0) || !ctx.port('prices').hasBooks(o.debtor)) return;
  const law = ctx.hasData('claimLaw') ? ctx.data('claimLaw')?.[o.kind] : undefined;
  if (!law) {
    const to: AccountId = o.kind === 'private' ? ACCOUNTS.damages : ACCOUNTS.fines;
    return pay(ctx, o.debtor, to, o.amount, `${o.label}: ${o.basis}`, o.refs);
  }
  // (the creditor is a party of the world: an authority known only by its id is added as a public body)
  if (!ctx.get('Party', o.creditor)) ctx.command('parties.add', { id: o.creditor, label: o.creditorLabel ?? o.creditor, kind: o.kind === 'private' ? 'company' : 'public' });
  const r = ctx.command('agreements.contract', { instrument: 'claim', label: o.label, holder: o.debtor, party: o.creditor, role: 'debtor', terms: { kind: o.kind, basis: o.basis, ...(o.refs[0] ? { about: o.refs[0] } : {}), ...(o.person ? { person: o.person } : {}) }, amount: Math.round(o.amount * 100) / 100 });
  if (!r.ok) throw new Error(`a claim of ${o.creditor} on ${o.debtor}: ${JSON.stringify(r.reasons)}`);
}

/** a matter has ended with what it was to compel done (the use ended, or allowed): its means of compulsion are let go */
export function relent(ctx: WriteCtx, subject: EntityId): void {
  for (const [id, a] of ctx.all('Agreement')) {
    if (a.instrument !== 'claim' || a.terms.about !== subject || a.status === 'ended' || a.end !== undefined) continue;
    if (!ctx.data('claimLaw')?.[String(a.terms.kind)]?.compels) continue;
    ctx.command('agreements.act', { agreement: id, action: 'relent' });
  }
}
