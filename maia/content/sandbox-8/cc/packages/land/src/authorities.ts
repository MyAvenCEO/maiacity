/**
 * The authorities (decision 0025): what someone does against the law of the place — work without
 * the certificate the law asks for, unpaid help for a business beyond a favour — is not refused.
 * It is an exposure the authorities may come to know of, at the rate of their checks (drawn,
 * hidden), and then it is fined.
 */
import { DAY, defineModule, HOUR, type WriteCtx } from '../../kernel/src/index.ts';
import { partyLabel } from '../../parties/src/index.ts';
import { charge } from './charge.ts';
import type {} from '../../workforce/src/index.ts';
import type {} from '../../production/src/index.ts';
import type {} from '../../equipment/src/index.ts';
import { EnforcementSchema, type AuthorityState } from './contract.ts';

function expose(ctx: WriteCtx, kind: string, e: { person: string; party: string; what: string; rule: string }): void {
  const rule = ctx.data('enforcement')[kind];
  if (!rule) return;
  const st = ctx.state('authorities');
  // one exposure per person and kind of wrong: what is already pending is not counted twice
  if (Object.values(st.exposures).some((x) => x.person === e.person && x.kind === kind)) return;
  const id = String(st.next);
  const years = -Math.log(Math.max(1e-12, 1 - ctx.rng('authorities').next())) / Math.max(1e-6, rule.foundPerYear.value);
  ctx.setState('authorities', { exposures: { ...st.exposures, [id]: { ...e, kind, at: ctx.now } }, foundAt: { ...st.foundAt, [id]: Math.round(ctx.now + years * 365.25 * DAY) }, next: st.next + 1 });
}

export const authoritiesModule = defineModule({
  id: 'authorities',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Party'],
  label: 'Authorities',
  description: 'What is against the law of the place may come out, at the rate of the checks, and is fined.',
  requires: ['parties', 'prices'],
  data: { enforcement: EnforcementSchema },
  state: { initial: (): AuthorityState => ({ exposures: {}, foundAt: {}, next: 1 }) },
  on: {
    'workforce.legalExposure': (ctx, e) => expose(ctx, 'undeclaredWork', e),
    'production.legalExposure': (ctx, e) => expose(ctx, e.kind ?? 'unlicensedWork', e),
    'errands.legalExposure': (ctx, e) => expose(ctx, 'unlicensedDriving', e),
    'equipment.legalExposure': (ctx, e) => expose(ctx, 'unlicensedDriving', e),
  },
  systems: [
    {
      id: 'checks',
      every: DAY,
      offset: 11 * HOUR,
      phase: 'agents',
      run(ctx) {
        const st = ctx.state('authorities');
        const due = Object.keys(st.exposures).filter((id) => ctx.now >= (st.foundAt[id] ?? Infinity));
        if (!due.length) return;
        const exposures = { ...st.exposures };
        const foundAt = { ...st.foundAt };
        for (const id of due) {
          const x = exposures[id]!;
          const rule = ctx.data('enforcement')[x.kind]!;
          const fine = rule.fine.value * ctx.port('prices').index(ctx.now);
          // (a fine of the authority that found it: a claim against the party, paid or enforced; a criminal fine is the
          // offender's own, who sits it out if it is not paid)
          charge(ctx, { debtor: x.party, creditor: rule.by ?? 'authorities', ...(rule.byLabel ? { creditorLabel: rule.byLabel } : {}), kind: rule.kind ?? 'administrative', label: `${rule.label}: ${x.what}`, basis: x.rule, amount: fine, refs: [x.person], ...(rule.kind === 'criminal' ? { person: x.person } : {}) });
          ctx.log('error', `${rule.label}: ${x.what} (${x.rule}) has come out — ${partyLabel(ctx, x.party)} is fined ${Math.round(fine)} €.`, [x.person]);
          delete exposures[id];
          delete foundAt[id];
        }
        ctx.setState('authorities', { ...st, exposures, foundAt });
      },
    },
  ],
  /** a fork does not know when a check comes */
  branch(ctx) {
    const st = ctx.state('authorities');
    const foundAt: Record<string, number> = {};
    for (const [id, x] of Object.entries(st.exposures)) {
      const rule = ctx.data('enforcement')[x.kind]!;
      foundAt[id] = Math.round(ctx.now + (-Math.log(Math.max(1e-12, 1 - ctx.rng('authorities').next())) / Math.max(1e-6, rule.foundPerYear.value)) * 365.25 * DAY);
    }
    ctx.patchState('authorities', { foundAt });
  },
});
