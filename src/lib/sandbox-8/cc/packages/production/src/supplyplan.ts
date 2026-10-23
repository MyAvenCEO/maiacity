/**
 * Ordering a project's materials (stock on the way, the user 2026-10-09): all at once up front, or
 * just in time against the schedule. Just in time, an order goes out when the forecast says the
 * stock in hand and on order runs out within the supplier's lead time and the buffer the player
 * chose, and it covers the days of use the player chose. It saves money tied up and room on the
 * site, and it is fragile: a late lorry (the supplier's punctuality) or one broken down on the way
 * (its rate of breakdowns) makes the work wait. The comparison is made of those numbers, never a
 * risk score.
 *
 * A store serves all the work that draws from it: what a store lacks is reckoned against every
 * active project of its holder that uses it, net of what their own work puts into it (soil dug
 * out and used again), and with what was set down short of it on the way (a lorry that could not
 * get there) counted as in hand.
 */
import { DAY, HOUR, s, type EntityId, type Infer, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import { fillRemedies, isCounted, unitMass } from '../../inventory/src/index.ts';
import type { Project, WorkPackage } from './contract.ts';
import { forecastSchedule } from './schedule.ts';

export const SupplyPolicySchema = s.object({
  /** up front: everything ordered when the project is made; just in time: ordered against the schedule */
  mode: s.enum(['upfront', 'justInTime']),
  /** just in time: deliveries are meant to land this long before the work needs them */
  bufferHours: s.number({ min: 0, unit: 'h' }).optional(),
  /** just in time: each order covers this many days of use (fewer, larger orders against more, smaller ones) */
  coverDays: s.number({ min: 0.5, unit: 'd' }).optional(),
});
export type SupplyPolicy = Infer<typeof SupplyPolicySchema>;

/** the player's choice when they name none (a policy, not a fact of the world) */
export const DEFAULT_BUFFER_H = 8;
export const DEFAULT_COVER_D = 5;

/** what a package draws from which store per unit of work (production's own reckoning) */
export type MaterialsOf = (read: ReadCtx, pkg: EntityId) => { per: Record<string, number>; storeOf: Record<string, EntityId | undefined> };
type DoneOf = (pkg: Readonly<WorkPackage>) => number;

/** one stretch of use (or, negative, of our own work putting it in): `qty` evenly between `from` and `to` */
interface Use {
  from: number;
  to: number;
  qty: number;
  pkg: EntityId;
}

interface Demand {
  store: EntityId;
  material: string;
  uses: Use[];
  /** the most the uses ever exceed what our own work brings, at any time */
  peak: number;
  /** what this project's own work still wants of it, net of what it brings: what it orders for at most */
  own: number;
  /** our own work puts it into this store: not bought */
  made?: boolean;
}

/** used (net of what our own work brings) by time t */
const usedBy = (uses: Use[], t: number): number => uses.reduce((a, u) => a + (t >= u.to ? u.qty : t <= u.from ? 0 : (u.qty * (t - u.from)) / (u.to - u.from)), 0);
const breakpoints = (uses: Use[]) => [...new Set(uses.flatMap((u) => [u.from, u.to]))].sort((a, b) => a - b);

/** the first time the net use exceeds `have` (null: it never does) */
function runsOutAt(uses: Use[], have: number): number | null {
  const times = breakpoints(uses);
  let prev = times[0] ?? 0;
  if (usedBy(uses, prev) > have + 1e-9) return prev;
  for (const t of times.slice(1)) {
    if (usedBy(uses, t) > have + 1e-9) {
      // within (prev, t] the net use changes linearly
      const a = usedBy(uses, prev);
      const b = usedBy(uses, t);
      return prev + ((have - a) / Math.max(b - a, 1e-12)) * (t - prev);
    }
    prev = t;
  }
  return null;
}

/**
 * What the party's active projects draw from its stores and when (by their forecasts), net of what
 * their own work puts in, for the stores and materials `project` uses.
 */
export function demandOf(read: ReadCtx, project: EntityId, materialsOf: MaterialsOf, done: DoneOf): Demand[] {
  const party = read.require('Project', project).party;
  const out = new Map<string, Demand>();
  const ours = new Set<string>();
  // stores our own work puts a material into (done or still to come): the plan uses that, it is not bought
  const made = new Set<string>();
  const add = (store: EntityId, material: string, u: Use) => {
    const key = `${store}|${material}`;
    (out.get(key) ?? out.set(key, { store, material, uses: [], peak: 0, own: 0 }).get(key)!).uses.push(u);
  };
  for (const [id, pr] of read.all('Project')) {
    if (pr.party !== party || (pr.status !== 'active' && pr.status !== 'paused' && id !== project)) continue;
    for (const row of forecastSchedule(read, id)) {
      const pkg = read.require('WorkPackage', row.package);
      if (row.status !== 'cancelled') for (const o of pkg.produces ?? []) made.add(`${o.store}|${o.material}`);
      if (row.status === 'done' || row.status === 'cancelled' || !Number.isFinite(row.finish)) continue;
      const left = Math.max(0, pkg.quantity - done(pkg));
      const window = { from: Math.max(row.start, read.now), to: Math.max(row.finish, row.start, read.now), pkg: row.package };
      const { per, storeOf } = materialsOf(read, row.package);
      for (const [mat, q] of Object.entries(per)) {
        const store = storeOf[mat];
        if (!store || q <= 0 || read.port('holdings').holder(store) !== party) continue;
        const qty = Math.max(0, left * q - (pkg.front ? read.port('holdings').stock(pkg.front, mat) : 0));
        if (qty <= 1e-9) continue;
        add(store, mat, { ...window, qty });
        if (id === project) ours.add(`${store}|${mat}`);
      }
      // what the work digs out or makes goes into a store: it is there to be used again
      for (const o of pkg.produces ?? []) if (read.port('holdings').holder(o.store) === party && left * o.perUnit > 1e-9) add(o.store, o.material, { ...window, qty: -left * o.perUnit });
    }
  }
  return [...out.entries()]
    .filter(([key]) => ours.has(key))
    .map(([, d]) => {
      const mine = d.uses.filter((u) => read.get('WorkPackage', u.pkg)?.project === project);
      // what our own work puts into the store is planned to be used again: never bought for it (the work waits for
      // it, and where it runs short a package's substitute is the way out, as the plan says)
      const self = made.has(`${d.store}|${d.material}`);
      const peakOf = (us: Use[]) => (self ? 0 : Math.max(0, ...breakpoints(us).map((t) => usedBy(us, t))));
      return { ...d, made: self, peak: peakOf(d.uses), own: peakOf(mine) };
    });
}

/** in hand for a store: its stock, what is on order for it, and what was set down short of it on the way */
function inHand(read: ReadCtx, store: EntityId, material: string): number {
  const hold = read.port('holdings');
  let have = hold.stock(store, material) + read.port('trade').onOrder(store, material);
  for (const id of hold.setDownFor(store)) have += hold.stock(id, material);
  return have;
}

/** the delivering offer production orders from: the cheapest supplier that brings it */
const offerFor = (read: ReadCtx, material: string) => read.port('trade').offers(material).find((o) => o.delivers);

/** what stands in the way of a project's ordering, one entry a material */
interface Snag {
  material: string;
  why: string;
  remedies: Remedy[];
}

/** order what a demand still lacks, as one order; the order is the project's (a snag when it cannot be) */
function order(ctx: WriteCtx, project: EntityId, d: Demand, qty: number, why: string): Snag | null {
  const hold = ctx.port('holdings');
  const mat = hold.material(d.material);
  const offer = offerFor(ctx, d.material);
  // nobody brings it: say so, with the ways to get it (fetch it, collect it, another store of ours)
  if (!offer) return { material: d.material, why: `no supplier delivers ${mat.label}`, remedies: fillRemedies(ctx, d.store, d.material, qty) };
  // pieces are bought whole
  const whole = isCounted(mat) ? Math.ceil(qty - 1e-9) : Math.ceil(qty * 100) / 100;
  const n = Math.max(whole, offer.minOrder);
  const r = ctx.command('inventory.order', { material: d.material, qty: n, store: d.store, supplier: offer.supplier });
  if (!r.ok) {
    // besides what the refusal offers: order it yourself when there is the money, or stop the work that needs it
    const own: Remedy[] = [
      { label: `Leave the ordering to me (production.setSupply none) and order ${mat.label} when there is the money`, command: { type: 'production.setSupply', payload: { project, mode: 'none' } } },
      { label: `Pause ${ctx.require('Project', project).label}`, command: { type: 'production.pauseProject', payload: { project } } },
    ];
    return { material: d.material, why: r.reasons.map((b) => ctx.formatBlocker(b)).join('; '), remedies: [...r.reasons.flatMap((b) => b.remedies ?? []), ...own] };
  }
  const pr = ctx.require('Project', project);
  ctx.patch('Project', project, { orders: [...(pr.orders ?? []), r.value as EntityId] });
  ctx.log('info', `${pr.label}: ordered ${n} ${mat.unit} ${mat.label} (${why}).`, [project, r.value as EntityId]);
  return null;
}

/** a project that orders no more (finished, cancelled, ordering left to the player): its ordering problems are gone */
export function clearSnags(ctx: WriteCtx, project: EntityId): void {
  if (ctx.blockersOf(project).some((b) => b.code === 'production.supplyFailed')) snags(ctx, project, []);
}

/** a project's ordering problems as its blockers: set while they last, told once when they begin */
function snags(ctx: WriteCtx, project: EntityId, list: Snag[]): void {
  const label = ctx.require('Project', project).label;
  // told once when a material begins to fail (the reason's numbers change from hour to hour)
  const before = new Set(ctx.blockersOf(project).filter((b) => b.code === 'production.supplyFailed').map((b) => String(b.params?.material)));
  const mats = ctx.port('holdings');
  const next = list.map((x) => ({ code: 'production.supplyFailed', severity: 'warn' as const, params: { material: mats.material(x.material).label, why: x.why }, remedies: x.remedies }));
  for (const b of next) if (!before.has(b.params.material)) ctx.log('warn', `${label}: ${b.params.material} could not be ordered (${b.params.why}).`, [project]);
  const rest = ctx.blockersOf(project).filter((b) => b.module === 'production' && b.code !== 'production.supplyFailed');
  if (rest.length + next.length) ctx.blockers.set(project, [...rest, ...next]);
  else ctx.blockers.clear(project);
}

/** up front: everything the remaining work needs that is not in hand */
export function orderUpfront(ctx: WriteCtx, project: EntityId, materialsOf: MaterialsOf, done: DoneOf): void {
  const out: Snag[] = [];
  for (const d of demandOf(ctx, project, materialsOf, done)) {
    // the store's stock serves all the work drawing from it; each project orders for its own work at most
    const lack = Math.min(d.peak - inHand(ctx, d.store, d.material), d.own);
    if (lack <= 1e-6) continue;
    const snag = order(ctx, project, d, lack, 'all the work needs, up front');
    if (snag) out.push(snag);
  }
  snags(ctx, project, out);
}

/** just in time: an order goes out when what is in hand runs out within the lead time and the buffer */
export function orderJustInTime(ctx: WriteCtx, project: EntityId, materialsOf: MaterialsOf, done: DoneOf): void {
  const pr = ctx.require('Project', project);
  const policy = pr.supply!;
  const buffer = (policy.bufferHours ?? DEFAULT_BUFFER_H) * HOUR;
  const cover = (policy.coverDays ?? DEFAULT_COVER_D) * DAY;
  const out: Snag[] = [];
  for (const d of demandOf(ctx, project, materialsOf, done)) {
    const have = inHand(ctx, d.store, d.material);
    // made by our own work as well: not bought (see demandOf)
    if (d.made) continue;
    const runs = runsOutAt(d.uses, have);
    if (runs === null) continue;
    const offer = offerFor(ctx, d.material);
    const lead = (offer?.leadTimeDays ?? 0) * DAY;
    if (ctx.now < runs - buffer - lead) continue;
    // enough for the days of use it covers from when it runs out, never more than the work will want
    const want = Math.min(Math.min(Math.max(...[runs + cover, ...breakpoints(d.uses).filter((t) => t <= runs + cover)].map((t) => usedBy(d.uses, t))), d.peak) - have, d.own);
    if (want <= 1e-6) continue;
    const snag = order(ctx, project, d, want, `just in time: the stock runs out ${ctx.calendar.format(runs, 'day')}, ${Math.round(buffer / HOUR)} h buffer`);
    if (snag) out.push(snag);
  }
  snags(ctx, project, out);
}

/**
 * The two ways compared for a project's materials, in the world's own numbers: up front, the money
 * tied up and for how long on average, and how long the work waits where it needs the goods before
 * they can be here; just in time, how many deliveries, and the hours the work is expected to wait
 * for them (late lorries beyond the buffer, breakdowns on the way).
 */
export function supplyOptions(read: ReadCtx, project: EntityId, materialsOf: MaterialsOf, done: DoneOf, policy?: SupplyPolicy) {
  const pr = read.require('Project', project) as Readonly<Project>;
  const p = policy ?? pr.supply ?? { mode: 'justInTime' };
  const buffer = p.bufferHours ?? DEFAULT_BUFFER_H;
  const coverD = p.coverDays ?? DEFAULT_COVER_D;
  const hold = read.port('holdings');
  const suppliers = read.data('suppliers');
  const profiles = read.data('vehicleProfiles');
  // what nobody delivers (soil dug on the site, our own stock) is not ordered either way
  return demandOf(read, project, materialsOf, done)
    .filter((d) => offerFor(read, d.material) && d.own > 1e-9)
    .map((d) => {
      const offer = offerFor(read, d.material)!;
      const mat = hold.material(d.material);
      // this project's own share of the store's use
      const uses = d.uses.filter((u) => u.qty > 0 && read.get('WorkPackage', u.pkg)?.project === project);
      const qty = uses.reduce((a, u) => a + u.qty, 0);
      // offers come at today's prices already
      const value = d.own * offer.price;
      const arrive = read.now + offer.leadTimeDays * DAY;
      // up front: each unit waits from the delivery until it is used; used before it can be here, the work waits instead
      const waits = uses.reduce((a, u) => a + u.qty * Math.max(0, (u.from + u.to) / 2 - arrive), 0) / Math.max(qty, 1e-9) / DAY;
      const first = Math.min(...uses.map((u) => u.from));
      const upfrontWait = Math.max(0, arrive - first) / HOUR;
      const sup = suppliers[offer.supplier];
      const prof = sup ? profiles[sup.vehicleProfile] : undefined;
      const span = Math.max(...uses.map((u) => u.to)) - first;
      const orders = Math.max(1, Math.ceil(span / (coverD * DAY)));
      // every lorry can break down: as many as the mass takes, at least one an order
      const tonnes = (d.own * unitMass(mat)) / 1000;
      const lorries = Math.max(orders, prof?.payload?.value ? Math.ceil(tonnes / prof.payload.value) : orders);
      // a late lorry makes the work wait for what it is late beyond the buffer (late times exponential)
      const pu = sup?.punctuality;
      const late = pu ? (1 - pu.onTime.value) * pu.late.value * Math.exp(-buffer / pu.late.value) : 0;
      const trip = sup && prof ? sup.distance.value / prof.maxSpeed.value : 0;
      const bd = prof?.breakdown;
      const broken = bd ? (trip / bd.mtbf.value) * bd.standstill.value * Math.exp(-buffer / bd.standstill.value) : 0;
      // the first delivery cannot come before the lead time either way
      const waitH = orders * late + lorries * broken + upfrontWait;
      // what standing costs: the people at the work that uses it now (none yet: said in hours only)
      const wf = read.port('workforce');
      const crew = [...new Set(uses.flatMap((u) => read.require('WorkPackage', u.pkg).crew))];
      const perHour = crew.reduce((a, c) => a + wf.hourlyCost(c), 0);
      const hazards = [pu ? `${sup!.label} on time in ${Math.round(pu.onTime.value * 100)} %, else ~${pu.late.value} h late` : 'no punctuality data', bd ? `a lorry breaks down once in ~${Math.round(bd.mtbf.value)} h on the road` : 'no breakdown data'].join('; ');
      return {
        store: d.store,
        material: d.material,
        label: mat.label,
        unit: mat.unit,
        qty: d.own,
        supplier: sup?.label ?? offer.supplier,
        upfront: {
          value: Math.round(value),
          daysTiedUp: +waits.toFixed(1),
          waitHours: +upfrontWait.toFixed(1),
          note: `${Math.round(value)} € of ${mat.label}${waits >= 0.05 ? ` on the site for ${waits.toFixed(1)} days on average before it is used` : ''}${upfrontWait > 0 ? `${waits >= 0.05 ? ';' : ':'} the work needs it ${upfrontWait.toFixed(1)} h before it can be here (${offer.leadTimeDays} days' lead), and waits` : ''}`,
        },
        justInTime: {
          bufferHours: buffer,
          coverDays: coverD,
          orders,
          expectedWaitHours: +waitH.toFixed(2),
          ...(perHour > 0 ? { expectedWaitCost: Math.round(waitH * perHour) } : {}),
          note: `${orders} order(s); the work is expected to wait ${waitH.toFixed(2)} h in all for late or broken-down lorries${upfrontWait > 0 ? ' and the first delivery' : ''} (${hazards})${perHour > 0 ? `, about ${Math.round(waitH * perHour)} € of the crew at work standing` : ''}`,
        },
      };
    });
}
