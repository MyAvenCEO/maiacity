/**
 * Letting what we own: a building (or anything a module says is lettable) is offered for a use —
 * a home, business premises, a hall by the day — at an asking rent. Tenants come over time, sooner
 * the lower the ask (the tenant-demand model contract, two implementations), and sign a lease. Long
 * lets end when the tenant gives notice; bookings end by themselves, and the next one comes.
 */
import { DAY, defineModule, ex, command, s, shareWillingToPay, type EntityId, type ModelDescriptor, type Provenance, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import { actorOf, endedBlock, partyLabel } from '../../parties/src/index.ts';
import { LettingUseSchema, RentLevelSchema, RentTableSchema, type LettableFacts, type LettingOption, type LettingPort, type LettingState, type LettingUse, type TenantDemandPort } from './contract.ts';

/** days per month, to turn a daily rent level into a month's rent */
const DAYS_PER_MONTH = 365.25 / 12;
const round = (x: number) => Math.round(x);

function factsOf(read: ReadCtx, subject: EntityId): LettableFacts | null {
  for (const c of read.contributions('lettables')) {
    const f = c.impl(read, subject);
    if (f) return f;
  }
  return null;
}

const usesOf = (read: ReadCtx): Record<string, LettingUse> => (read.hasData('lettingUses') ? (read.data('lettingUses') ?? {}) : {});

function useOf(read: ReadCtx, use: string): LettingUse {
  const u = usesOf(read)[use];
  if (!u) throw new Error(`letting: no use '${use}'`);
  return u;
}

/** the let area and what a rent period is in days */
function basis(read: ReadCtx, subject: EntityId, use: string) {
  const f = factsOf(read, subject);
  if (!f) throw new Error(`letting: ${subject} is not lettable`);
  const u = useOf(read, use);
  return { f, u, area: f.area * u.areaShare.value, periodDays: u.period === 'day' ? 1 : DAYS_PER_MONTH };
}

/** the expected days until a prospective tenant who takes this ask comes */
function expectedDays(read: ReadCtx, subject: EntityId, use: string, ask: number): number {
  const d = read.port('tenantDemand');
  const t = d.tenants(subject, use);
  return t.meanDays / Math.max(1e-6, shareWillingToPay(ask, d.rent(subject, use).rent, t.spread));
}

// ------------------------------------------------------------------ the rent-level model

export const RENT_LEVEL_MODEL: ModelDescriptor = {
  contract: 'tenantDemand',
  implementation: 'rent-level',
  kind: 'model',
  label: 'Tenants from a market rent level per m² (by use), less for poor condition; vacancy at the market rent, longer the higher the ask',
  validity: { notes: 'One rent level per use for the whole map; no location within the map, no size or fittings premium, no rent index over time beyond the price index.' },
  resolution: 'per subject and use',
  confidence: 'low',
  sources: [{ title: 'economy pack: rentLevels' }],
};

function levelOf(read: ReadCtx, use: string) {
  const l = read.hasData('rentLevels') ? read.data('rentLevels')?.[use] : undefined;
  if (!l) throw new Error(`tenantDemand (rent level): no rent level for '${use}'`);
  return l;
}

export const rentLevelModule = defineModule({
  id: 'tenant-demand-rent-level',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Plot', 'Structure', 'StructureCondition'],
  label: 'Tenant demand (rent levels)',
  provides: ['tenantDemand'],
  requires: ['prices'],
  data: { rentLevels: s.record(RentLevelSchema).optional() },
  models: [RENT_LEVEL_MODEL],
  ports: {
    tenantDemand: (read: ReadCtx): TenantDemandPort => {
      const rent = (subject: EntityId, use: string) => {
        const { f, area, periodDays, u } = basis(read, subject, use);
        const l = levelOf(read, use);
        const index = read.port('prices').index(read.now);
        const condition = 1 - l.conditionWeight.value * (1 - f.condition);
        const value = l.rentPerM2.value * area * periodDays * condition * index;
        const explain = ex.mul(`market rent for ${f.label} (${u.label}) per ${u.period}`, 'EUR', ex.param(l.rentPerM2, `rent level per m² and day (${use})`), ex.value(area, 'm2', `let area: ${round(f.area)} m² × ${u.areaShare.value}`, u.areaShare.source), ex.value(periodDays, 'd', `days per ${u.period}`), ex.value(condition, '1', `condition ${f.condition.toFixed(2)}`, l.conditionWeight.source), ex.value(index, '1', 'price index'));
        const provenance: Provenance = { kind: 'model', source: 'rent-level', confidence: 'low' };
        return { rent: round(value), explain, provenance };
      };
      return {
        rent,
        tenants: (_subject, use) => {
          const l = levelOf(read, use);
          return { meanDays: l.vacancyDays.value, spread: l.spread.value };
        },
        behaviour: (_subject, use) => {
          const l = levelOf(read, use);
          return { ...(l.stayDays ? { stayDays: l.stayDays.value } : {}), ...(l.stayElasticity ? { stayElasticity: l.stayElasticity.value } : {}), lateShare: l.lateShare?.value ?? 0, lateDays: l.lateDays?.value ?? 0 };
        },
      };
    },
  },
});

// ------------------------------------------------------------------ an entered rent table

export const RENT_TABLE_MODEL: ModelDescriptor = {
  contract: 'tenantDemand',
  implementation: 'rent-table',
  kind: 'entered',
  label: 'Tenants from an entered rent table (rent per m² and month by use and size, with vacancy and what tenants did)',
  validity: { notes: 'As good as the table: sizes outside its rows take the nearest row, marked.' },
  resolution: 'per subject and use',
  confidence: 'medium',
  sources: [{ title: 'world definition: rentTables' }],
};

function tableRow(read: ReadCtx, subject: EntityId, use: string) {
  const b = read.data('rentTableBinding');
  const table = b ? read.data('rentTables')?.[b.dataset] : undefined;
  if (!table) throw new Error('tenantDemand (rent table): the world binds no rent table');
  const { area } = basis(read, subject, use);
  const rows = table.rows.filter((r) => r.use === use);
  if (!rows.length) throw new Error(`tenantDemand (rent table): no row for '${use}'`);
  const inside = rows.find((r) => area >= r.minArea && area < r.maxArea);
  const row = inside ?? [...rows].sort((a, b) => Math.min(Math.abs(area - a.minArea), Math.abs(area - a.maxArea)) - Math.min(Math.abs(area - b.minArea), Math.abs(area - b.maxArea)))[0]!;
  return { table, row, inside: Boolean(inside), dataset: b!.dataset };
}

export const rentTableModule = defineModule({
  id: 'tenant-demand-rent-table',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Plot'],
  label: 'Tenant demand (rent table)',
  provides: ['tenantDemand'],
  requires: ['prices'],
  data: { rentTables: s.record(RentTableSchema).optional(), rentTableBinding: s.object({ dataset: s.string() }).optional() },
  models: [RENT_TABLE_MODEL],
  ports: {
    tenantDemand: (read: ReadCtx): TenantDemandPort => {
      const rent = (subject: EntityId, use: string) => {
        const { f, area, periodDays, u } = basis(read, subject, use);
        const t = tableRow(read, subject, use);
        const value = (t.row.rentPerM2Month / DAYS_PER_MONTH) * area * periodDays;
        const explain = ex.mul(`rent for ${f.label} (${u.label}) per ${u.period}`, 'EUR', ex.value(t.row.rentPerM2Month, 'EUR/m2/mo', `rent table: ${use}, ${t.row.minArea}–${t.row.maxArea} m²`, t.table.source), ex.value(area, 'm2', 'let area'), ex.value(periodDays / DAYS_PER_MONTH, 'mo', `months per ${u.period}`));
        const provenance: Provenance = { kind: 'entered', source: t.dataset, confidence: t.inside ? 'medium' : 'low', ...(t.inside ? {} : { note: 'outside validity: no row for this size' }) };
        return { rent: round(value), explain, provenance };
      };
      return {
        rent,
        tenants: (subject, use) => {
          const t = tableRow(read, subject, use);
          return { meanDays: t.row.vacancyDays, spread: t.table.spread.value };
        },
        behaviour: (subject, use) => {
          const t = tableRow(read, subject, use);
          return { ...(t.row.stayDays ? { stayDays: t.row.stayDays } : {}), ...(t.row.stayElasticity ? { stayElasticity: t.row.stayElasticity } : {}), lateShare: t.row.lateShare ?? 0, lateDays: t.row.lateDays ?? 0 };
        },
      };
    },
  },
});

// ------------------------------------------------------------------ offering to let

function options(read: ReadCtx, subject: EntityId): LettingOption[] {
  const f = factsOf(read, subject);
  if (!f || !read.hasPort('tenantDemand')) return [];
  const demand = read.port('tenantDemand');
  return Object.entries(usesOf(read))
    .filter(([, u]) => u.types.includes(f.type))
    .map(([use, u]) => {
      const r = demand.rent(subject, use);
      return { use, label: u.label, period: u.period, rent: r.rent, ...(u.rentCap ? { maxAsk: Math.floor(r.rent * u.rentCap.value) } : {}), expectedDays: Math.round(expectedDays(read, subject, use, r.rent) * 10) / 10, provenance: r.provenance };
    });
}

/** the next prospective tenant comes after an exponential wait (the world knows when; the players only the expected days) */
function scheduleTenant(ctx: WriteCtx, subject: EntityId, from = ctx.now): void {
  const l = ctx.require('Letting', subject);
  const at = Math.round(from + ctx.rng('tenants').exponential(ctx.port('tenantDemand').tenants(subject, l.use).meanDays * DAY));
  ctx.patchState('letting', { next: { ...ctx.state('letting').next, [subject]: at } });
  ctx.at(at, 'tenant', { subject, at });
}

/** the most a new let may ask under the use's rent cap, if it has one */
const capOf = (market: number, u: LettingUse): number | undefined => (u.rentCap ? Math.floor(market * u.rentCap.value) : undefined);

function forget(ctx: WriteCtx, subject: EntityId): void {
  const { [subject]: _gone, ...rest } = ctx.state('letting').next;
  ctx.patchState('letting', { next: rest });
}

export const lettingModule = defineModule({
  id: 'letting',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Agreement', 'Party', 'Plot', 'Structure', 'StructureCondition'],
  label: 'Letting',
  description: 'Offer what we own to let; tenants come through the tenant-demand model and sign leases.',
  requires: ['agreements', 'tenantDemand'],
  provides: ['letting'],
  components: { Letting: s.object({ use: s.string(), ask: s.number({ min: 0 }), since: s.number() }) },
  state: { initial: (): LettingState => ({ next: {} }) },
  data: { lettingUses: s.record(LettingUseSchema).optional() },
  blockers: {
    'letting.notLettable': '{subject} cannot be let (nothing in the world says it is ours to let now)',
    'letting.unknownUse': '{subject} cannot be let as {use} (as: {uses})',
    'letting.alreadyLet': '{subject} is let already ({agreement})',
    'letting.notOurs': '{subject} is not held by {party}',
    'letting.notOffered': '{subject} is not offered to let',
    'letting.offered': 'Offered as {use} at {ask} € a {period}; the market rent is {rent} €',
  },
  commands: {
    'letting.offer': command(
      s.object({ subject: s.ref(), use: s.string(), ask: s.number({ min: 1, unit: 'EUR' }).optional() }),
      (ctx: WriteCtx, p) => {
        const f = factsOf(ctx, p.subject);
        if (!f) ctx.reject('letting.notLettable', { subject: ctx.entity(p.subject)?.name ?? p.subject });
        if (ctx.caller === 'client' && f!.holder !== actorOf(ctx)) ctx.reject('letting.notOurs', { subject: f!.label, party: partyLabel(ctx, actorOf(ctx)) });
        const opts = options(ctx, p.subject);
        const o = opts.find((x) => x.use === p.use);
        if (!o) ctx.reject('letting.unknownUse', { subject: f!.label, use: p.use, uses: opts.map((x) => x.use).join(', ') || 'none' });
        // held already: let, or a lease signed that starts tomorrow
        const held = ctx.port('agreements').holderOf(p.subject);
        if (held) ctx.reject('letting.alreadyLet', { subject: f!.label, agreement: ctx.get('Agreement', held)?.label ?? held });
        const ask = Math.round(p.ask ?? o!.rent);
        const u = useOf(ctx, p.use);
        ctx.set('Letting', p.subject, { use: p.use, ask, since: ctx.now });
        scheduleTenant(ctx, p.subject);
        const days = expectedDays(ctx, p.subject, p.use, ask);
        ctx.blockers.set(p.subject, [{ code: 'letting.offered', severity: 'info', params: { use: o!.label, ask, period: o!.period, rent: o!.rent } }]);
        ctx.log('info', `${f!.label} offered ${o!.label.toLowerCase()} at ${ask} € a ${o!.period} (market rent ${o!.rent} €): a tenant is expected in about ${Math.round(days)} days.`, [p.subject]);
        // the law does not refuse an ask above the cap (0025): what is over it is void, and a tenant may claim it
        const cap = capOf(o!.rent, u);
        if (cap !== undefined && ask > cap) ctx.log('warn', `${f!.label}: ${ask} € a ${o!.period} is above the ${cap} € a ${o!.period} a new let may ask (${u.rentCap!.source?.title ?? 'a rent cap'}): what is over it is void, and a tenant may claim it.`, [p.subject]);
        return { ask, rent: o!.rent, expectedDays: Math.round(days * 10) / 10 };
      },
      { label: 'Offer to let', description: 'Offer a finished building of ours to let for a use (a home, business premises, a hall by the day: see query letting.options) at an asking rent (default: the market rent). Tenants come over time, sooner the lower the ask, and sign a lease; rent comes in each period, a deposit is held. Offering again changes the ask.' },
    ),
    'letting.withdraw': command(
      s.object({ subject: s.ref() }),
      (ctx: WriteCtx, p) => {
        if (!ctx.get('Letting', p.subject)) ctx.reject('letting.notOffered', { subject: factsOf(ctx, p.subject)?.label ?? p.subject });
        const f = factsOf(ctx, p.subject);
        if (ctx.caller === 'client' && f && f.holder !== actorOf(ctx)) ctx.reject('letting.notOurs', { subject: f.label, party: partyLabel(ctx, actorOf(ctx)) });
        ctx.remove('Letting', p.subject);
        forget(ctx, p.subject);
        ctx.blockers.clear(p.subject);
      },
      { label: 'Stop offering to let', description: 'Withdraw a letting offer (a lease already signed stays).' },
    ),
  },
  timers: {
    tenant(ctx, payload: { subject: EntityId; at: number }) {
      const l = ctx.get('Letting', payload.subject);
      if (!l || ctx.state('letting').next[payload.subject] !== payload.at) return; // withdrawn or superseded
      const f = factsOf(ctx, payload.subject);
      if (!f) {
        ctx.remove('Letting', payload.subject);
        forget(ctx, payload.subject);
        return;
      }
      // (its holder has ended, nobody left of it: its estate lets nothing new, the offer stands no more; the one check,
      // review y)
      const ended = endedBlock(ctx, f.holder);
      if (ended) {
        ctx.remove('Letting', payload.subject);
        forget(ctx, payload.subject);
        ctx.blockers.clear(payload.subject);
        ctx.log('info', `${f.label} is no longer offered to let: ${ended.params.party} has ended (${ended.params.why}).`, [payload.subject]);
        return;
      }
      const held = ctx.port('agreements').holderOf(payload.subject);
      if (held) {
        // still let (a booking runs): the next one comes after it
        scheduleTenant(ctx, payload.subject, ctx.get('Agreement', held)?.end ?? ctx.now + DAY);
        return;
      }
      const u = useOf(ctx, l.use);
      const demand = ctx.port('tenantDemand');
      const market = demand.rent(payload.subject, l.use).rent;
      // what this one would pay at most: around the market rent
      const willing = market * Math.exp(demand.tenants(payload.subject, l.use).spread * ctx.rng('tenants').normal(0, 1));
      if (willing < l.ask) {
        ctx.log('info', `A prospective ${u.tenantLabel.toLowerCase()} looked at ${f.label} but would not pay ${l.ask} € a ${u.period}.`, [payload.subject]);
        scheduleTenant(ctx, payload.subject);
        return;
      }
      const b = demand.behaviour(payload.subject, l.use);
      const n = ctx.count('Party') + 1;
      const party = ctx.command('parties.add', { label: `${u.tenantLabel} ${n}`, kind: u.tenantKind });
      if (!party.ok) throw new Error('letting: could not add the tenant');
      // above the cap the excess is void: a tenant who claims it pays the cap (said so)
      const cap = capOf(market, u);
      const claims = cap !== undefined && l.ask > cap && ctx.rng('tenants').next() < (u.capClaim?.value ?? 0);
      const rent = claims ? cap! : l.ask;
      const terms: Record<string, number | string> = {
        rent,
        period: u.period,
        tenantNotice: u.tenantNotice.value,
        ...(u.landlordNotice ? { landlordNotice: u.landlordNotice.value } : {}),
        ...(u.arrearsLimit ? { arrearsLimit: u.arrearsLimit.value } : {}),
        ...(u.depositPeriods && u.depositPeriods.value > 0 ? { deposit: Math.round(rent * u.depositPeriods.value) } : {}),
        ...(u.bookingDays ? { days: u.bookingDays.value } : {}),
      };
      // a tenant paying above the market stays shorter
      const stayDays = b.stayDays ? b.stayDays * Math.min(1, (market / rent) ** (b.stayElasticity ?? 0)) : undefined;
      const behaviour = { ...(stayDays ? { stayDays } : {}), ...(b.lateShare > 0 ? { lateShare: b.lateShare, lateDays: b.lateDays } : {}) };
      // the lease starts the next morning
      const start = ctx.calendar.startOfDay(ctx.now) + DAY;
      const r = ctx.command('agreements.contract', { instrument: 'lease', label: `${u.label}: ${f.label}`, holder: f.holder, party: party.value as EntityId, role: 'lessor', subject: payload.subject, terms, start, behaviour });
      if (!r.ok) throw new Error('letting: could not make the lease');
      ctx.log('success', `${u.tenantLabel} ${n} takes ${f.label} (${u.label.toLowerCase()}) at ${rent} € a ${u.period}, from ${ctx.calendar.format(start, 'day')}.`, [payload.subject]);
      if (claims) ctx.log('warn', `${u.tenantLabel} ${n} pays ${rent} € a ${u.period}: the ${l.ask - rent} € over the cap are void (${u.rentCap!.source?.title ?? 'a rent cap'}).`, [payload.subject]);
      if (u.bookingDays) {
        // day hire stays on offer: the next booking after this one
        scheduleTenant(ctx, payload.subject, start + u.bookingDays.value * DAY);
      } else {
        ctx.remove('Letting', payload.subject);
        forget(ctx, payload.subject);
        ctx.blockers.clear(payload.subject);
      }
    },
  },
  /** a fork does not know when tenants come */
  branch(ctx) {
    for (const [id] of [...ctx.all('Letting')]) scheduleTenant(ctx, id);
  },
  ports: { letting: (read: ReadCtx): LettingPort => ({ options: (subject) => options(read, subject) }) },
  projections: {
    'letting.options': {
      label: 'What a building of ours could be let for (by use: market rent, expected days to a tenant)',
      description: 'args: subject (entity id); without: every lettable thing',
      compute: (read: ReadCtx, args: Record<string, unknown>) => {
        const subjects = typeof args.subject === 'string' ? [args.subject] : read.entities().map((e) => e.id).filter((id) => factsOf(read, id));
        return subjects.map((id) => {
          const held = read.port('agreements').holderOf(id);
          const l = read.get('Letting', id);
          return { subject: id, label: factsOf(read, id)?.label ?? id, let: held ? (read.get('Agreement', held)?.label ?? 'let') : null, offered: l ? { use: l.use, ask: l.ask, expectedDays: Math.round(expectedDays(read, id, l.use, l.ask) * 10) / 10 } : null, options: options(read, id) };
        });
      },
    },
  },
});
