/**
 * Contractors and site supply — nothing arrives on site by itself.
 *
 * Subcontracted trades: the player (or their agent) awards each package to a contractor with
 * finite crews and a booking backlog. The crew commutes every workday in vans from outside the
 * map, and their materials (concrete in truck mixers, bricks, roof tiles, screed …) are
 * delivered by truck as the work proceeds — the work cannot run ahead of the deliveries, and
 * every trip loads the roads. The firms' order books (firms.ts) set when they can start and what
 * they charge; a site that is not ready on the booked date sends the job back into the queue.
 *
 * Hot-mix asphalt / ready-mix ("direct supply"): must be booked at a supplier (lead time). On
 * booked working days trucks run from the plant; the foreman calls off a day when the forecast
 * makes the work impossible; material delivered but not laid by the end of the shift is waste.
 */
import { DAY, HOUR, type Blocker, type EntityId, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import { subcontractOnly, type Activity, type Contractor, type ScheduleRow, type SiteSupply, type WorkPackage } from './contract.ts';
import { flexTo } from './rates.ts';
import { forecastSchedule } from './schedule.ts';
import { unitMass } from '../../inventory/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import { bookOf, busyPrice, drawSlip, forgetSlip, graceDays, isFull, marketOf, requeueDays, rushSurcharge, slotMissed, standing } from './firms.ts';

/** whose working time a package keeps: the firm's it is let to (a business's), or its own party's */
export function workParty(read: ReadCtx, pkgId: EntityId): EntityId | undefined {
  const pkg = read.require('WorkPackage', pkgId);
  return pkg.contractor ? undefined : read.require('Project', pkg.project).party;
}

/** the party whose project a package belongs to */
export const partyOf = (read: ReadCtx, pkgId: EntityId): EntityId => read.require('Project', read.require('WorkPackage', pkgId).project).party;

/** the work a package is part of: what its material is built into (its project's road or structure, else the project) */
const workOf = (read: ReadCtx, pkg: Readonly<WorkPackage>): EntityId => read.get('Project', pkg.project)?.ref ?? pkg.project;

/** a package's work front: a holding of the goods drawn or delivered to it (design/physical-state.md I1), made when first needed, at `at` */
export function frontAt(ctx: WriteCtx, id: EntityId, at: readonly [number, number]): EntityId {
  const pkg = ctx.require('WorkPackage', id);
  if (pkg.front && ctx.port('holdings').exists(pkg.front)) return pkg.front;
  const r = ctx.command('inventory.createStore', { holder: partyOf(ctx, id), label: `${pkg.label}: at the front`, kind: 'front', pos: [at[0], at[1]], work: workOf(ctx, pkg) });
  if (!r.ok) throw new Error(`front of ${pkg.label}: ${JSON.stringify(r.reasons)}`);
  ctx.patch('WorkPackage', id, { front: r.value as EntityId });
  return r.value as EntityId;
}

/** what a package's work is built of: one holding a work (its road, its structure), made when first needed */
export function builtOf(ctx: WriteCtx, id: EntityId): EntityId {
  const pkg = ctx.require('WorkPackage', id);
  const work = workOf(ctx, pkg);
  const built = ctx.port('holdings').ofWork(work, 'built')[0];
  if (built) return built;
  const pr = ctx.require('Project', pkg.project);
  const at = pr.site ?? pkg.pos;
  const r = ctx.command('inventory.createStore', { holder: partyOf(ctx, id), label: `${ctx.entity(work)?.name ?? pr.label}: built in`, kind: 'built', pos: [at[0], at[1]], work });
  if (!r.ok) throw new Error(`built holding of ${pr.label}: ${JSON.stringify(r.reasons)}`);
  return r.value as EntityId;
}

/** a site supply's quantity in its material's own unit (a firm's deliveries are reckoned in tonnes) */
export function inMaterialUnit(read: ReadCtx, s: SiteSupply, qty: number): number {
  const m = read.data('materials')[s.material];
  if (!m || m.unit === s.unit) return qty;
  return s.unit === 't' ? (qty * 1000) / unitMass(m) : qty;
}

const TRUCK_SPACING_S = 15 * 60;
/** deliveries keep this many working hours of material ahead of the work */
const AHEAD_HOURS = 3;
/** off-network distance trucks and vans may cover on site tracks (as plant does) */
export const SITE_ACCESS_OFFROAD = 4000;

/** why trucks/vans cannot reach a package's work site from outside the map (null = they can) */
export function siteAccessProblem(read: ReadCtx, pkgId: EntityId, profiles: string[]): string | null {
  const pkg = read.require('WorkPackage', pkgId);
  const routing = read.port('routing');
  const ext = routing.externalNodes()[0];
  if (ext === undefined) return 'no road connection to the region';
  for (const prof of new Set(profiles)) if (!parkNear(read, ext, pkg.pos, prof)) return `${routing.profile(prof).label} cannot reach the work site — build an access road`;
  return null;
}

/**
 * Where a vehicle from beyond the map gets to at a site: the site itself, or as near it as it can within the site's
 * reach where those it brings walk on (a van at the bank of a creek it cannot ford); undefined: nowhere near
 */
export function parkNear(read: ReadCtx, ext: EntityId, pos: Vec2, profile: string): Vec2 | undefined {
  const walk = read.hasData('handling') ? read.data('handling')?.errand.profile : undefined;
  return read.port('routing').approach(ext, pos, profile, read.data('productionSettings').walkOn.value, walk, 'in', { maxOffroad: SITE_ACCESS_OFFROAD, reach: read.data('productionSettings').workReach.value });
}

/** the way a supplier's lorry comes from beyond the map to the work front itself (what it brings is not walked on), or null */
function lorryRoute(read: ReadCtx, pos: Vec2, profile: string) {
  const routing = read.port('routing');
  const ext = routing.externalNodes()[0];
  return ext !== undefined ? routing.routeFromExternal(ext, pos, profile, { maxOffroad: SITE_ACCESS_OFFROAD }) : null;
}

/** what keeps the supplies' lorries from the work front (the same way as they are sent: one fact), or null */
export function supplyAccessProblem(read: ReadCtx, pkgId: EntityId, profiles: string[]): string | null {
  const pkg = read.require('WorkPackage', pkgId);
  for (const prof of new Set(profiles)) if (!lorryRoute(read, pkg.pos, prof)) return `${read.port('routing').profile(prof).label} cannot reach the work front — build an access road to it`;
  return null;
}

/** travel time from outside the map to the work site for a profile (s) */
function travelS(read: ReadCtx, pos: [number, number], profile: string): number {
  const r = lorryRoute(read, pos, profile);
  return r ? r.stretches.reduce((a, l) => a + l.duration, 0) : HOUR;
}

export interface ContractorOffer {
  contractor: string;
  label: string;
  price: number;
  unit: string;
  start: number;
  end: number;
  /** the firm squeezes the job in ahead of its queue, at a surcharge */
  rush?: true;
  /** days of the firm's queue ahead of the job */
  ahead: number;
}

export function contractorsFor(read: ReadCtx, activityId: string): [string, Contractor][] {
  return Object.entries(read.data('contractors')).filter(([, c]) => c.trades.includes(activityId));
}

function bookingsOf(read: ReadCtx, contractor: string): { package: string; start: number; end: number }[] {
  return read.state('production').bookings[contractor] ?? [];
}

/** earliest start a firm can give a job of `durationS`, not before `notBefore`: behind `queueDays` of other work and our own jobs with it (but `except`) */
export function earliestSlot(read: ReadCtx, contractor: string, notBefore: number, durationS: number, queueDays: number, except?: EntityId): number {
  const c = read.data('contractors')[contractor]!;
  let start = Math.max(notBefore, read.now + queueDays * DAY);
  const books = bookingsOf(read, contractor).filter((b) => b.package !== except);
  // a slot is free when fewer than `crews` of our bookings overlap it
  for (let guard = 0; guard < 200; guard += 1) {
    const end = start + durationS;
    const overlapping = books.filter((b) => b.start < end && b.end > start);
    if (overlapping.length < c.crews) return read.port('workforce').nextShiftStart(start);
    start = Math.min(...overlapping.map((b) => b.end));
  }
  return start;
}

/** calendar duration of a subcontract job from its estimate (8 productive h per working day, 5/7) */
export function jobDurationS(pkg: Pick<WorkPackage, 'estimate' | 'quantity'>): number {
  const hours = Number.isFinite(pkg.estimate.hours) ? pkg.estimate.hours : 40;
  return Math.max(1, Math.ceil(hours / 8)) * DAY * (7 / 5);
}

/**
 * a firm on the job already: it has work before this package in the same project (a storey's walls after the slab it
 * made, the slab on the walls it laid). It goes on with it in its own sequence, not behind its order book; while its
 * own work before is still under way or curing, it waits for it (H1: one firm for the shell, storey by storey)
 */
export function onTheJob(read: ReadCtx, pkgId: EntityId, firm: string): boolean {
  const pkg = read.get('WorkPackage', pkgId);
  return Boolean(pkg?.after.some((l) => {
    const pred = read.get('WorkPackage', l.package);
    return pred && pred.project === pkg.project && pred.contractor === firm && pred.status !== 'cancelled';
  }));
}

/** what the firms offer for a package now: a start behind their queue, and a rush start at a surcharge; full firms offer nothing */
export function offersFor(read: ReadCtx, pkgId: EntityId, notBefore?: number): ContractorOffer[] {
  const pkg = read.require('WorkPackage', pkgId);
  const activity = read.data('activities')[pkg.activity]!;
  if (!activity.subcontract) return [];
  const ref = flexTo(activity.subcontract.price, `EUR/${activity.unit}`, `activity ${pkg.activity} subcontract price`) * read.port('prices').index(read.now);
  // own-crew trades carry an own-crew estimate: a contractor's job length comes from their output
  const dur = subcontractOnly(activity) ? jobDurationS(pkg) : letDurationS(read, activity, pkg);
  const rushDays = marketOf(read).rush.days.value;
  return contractorsFor(read, pkg.activity)
    .filter(([id]) => onTheJob(read, pkgId, id) || !isFull(read, id))
    .flatMap(([id, c]) => {
      const price = ref * c.priceFactor.value * busyPrice(read, id);
      const ahead = onTheJob(read, pkgId, id) ? 0 : bookOf(read, id).backlog;
      const start = earliestSlot(read, id, notBefore ?? read.now, dur, ahead);
      const offer: ContractorOffer = { contractor: id, label: c.label, price, unit: activity.unit, start, end: start + dur, ahead };
      if (ahead <= rushDays) return [offer];
      const rushStart = earliestSlot(read, id, notBefore ?? read.now, dur, rushDays);
      return rushStart < start ? [offer, { ...offer, price: price * (1 + rushSurcharge(read, id)), start: rushStart, end: rushStart + dur, rush: true as const, ahead: rushDays }] : [offer];
    })
    .sort((a, b) => a.start - b.start || a.price - b.price);
}

/** firms of a trade that take no new orders now, with how far ahead they are booked */
export function fullFirms(read: ReadCtx, activityId: string): { label: string; weeks: number }[] {
  return contractorsFor(read, activityId)
    .filter(([id]) => isFull(read, id))
    .map(([id, c]) => ({ label: c.label, weeks: Math.round(bookOf(read, id).backlog / 7) }));
}

/** working days a contractor needs for what is left of an own-crew trade */
function letDurationS(read: ReadCtx, activity: Activity, pkg: WorkPackage): number {
  const sc = activity.subcontract!;
  const perH = flexTo(sc.output, `${activity.unit}/h`, `subcontract output`) * activity.jobEfficiency.value;
  const done = pkg.process ? (read.process(pkg.process)?.done ?? 0) : 0;
  const hours = Math.max(0, pkg.quantity - done) / Math.max(perH, 1e-6);
  return Math.max(1, Math.ceil(hours / 8)) * DAY * (7 / 5);
}

export function awardRemedies(read: ReadCtx, pkgId: EntityId): Remedy[] {
  const pkg = read.require('WorkPackage', pkgId);
  const own = !subcontractOnly(read.data('activities')[pkg.activity]!);
  const offers: Remedy[] = offersFor(read, pkgId).map((o) => ({
    label: `${own ? 'Let to' : 'Award to'} ${o.label}${own ? ' (their crew and plant)' : ''}${o.rush ? ' as a rush job' : ''}: ${o.price.toFixed(0)} €/${o.unit}, start ${read.calendar.format(o.start, 'day')}${standing(read, o.contractor, partyOf(read, pkgId)) >= 0.5 ? ' (we are regulars)' : ''}`,
    command: { type: 'production.award', payload: { package: pkgId, contractor: o.contractor, ...(o.rush ? { rush: true } : {}) } },
  }));
  const full = fullFirms(read, pkg.activity).map((f) => ({ label: `${f.label} takes no new orders: booked ${f.weeks} weeks ahead` }));
  return [...offers, ...full];
}

/** award a subcontracted package (command handler body) */
export function award(ctx: WriteCtx, pkgId: EntityId, contractor: string, notBefore?: number, rush = false): ContractorOffer {
  const pkg = ctx.require('WorkPackage', pkgId);
  const activity = ctx.data('activities')[pkg.activity]!;
  if (!activity.subcontract) ctx.reject('production.notSubcontracted', { package: pkg.label });
  if (pkg.contractor) ctx.reject('production.alreadyAwarded', { package: pkg.label, contractor: ctx.data('contractors')[pkg.contractor]?.label ?? pkg.contractor });
  if (pkg.status === 'done' || pkg.status === 'cancelled') ctx.reject('production.packageClosed', { package: pkg.label });
  if (pkg.status === 'active' && (pkg.crew.length > 0 || pkg.machines.length > 0) && !subcontractOnly(activity)) ctx.reject('production.ownCrewWorking', { package: pkg.label });
  const c = ctx.data('contractors')[contractor];
  if (!c || !c.trades.includes(pkg.activity)) ctx.reject('production.contractorUnsuited', { contractor, package: pkg.label });
  if (isFull(ctx, contractor)) ctx.reject('production.contractorFull', { contractor: c!.label, weeks: Math.round(bookOf(ctx, contractor).backlog / 7) }, awardRemedies(ctx, pkgId).filter((r) => r.command));
  const offers = offersFor(ctx, pkgId, notBefore).filter((o) => o.contractor === contractor);
  const offer = offers.find((o) => Boolean(o.rush) === rush);
  if (!offer) ctx.reject('production.noRush', { contractor: c!.label }, awardRemedies(ctx, pkgId).filter((r) => r.command));
  const st = ctx.state('production');
  ctx.patchState('production', { bookings: { ...st.bookings, [contractor]: [...(st.bookings[contractor] ?? []), { package: pkgId, start: offer!.start, end: offer!.end }] } });
  const supplies = subcontractSupplies(ctx, activity, pkg.activity);
  ctx.patch('WorkPackage', pkgId, { contractor, contract: { price: offer!.price, start: offer!.start, end: offer!.end }, earliestStart: offer!.start, ...(supplies.length ? { supplies } : {}) });
  drawSlip(ctx, pkgId, offer!.start, offer!.ahead);
  ctx.log('info', `Awarded ${pkg.label} to ${c!.label}${rush ? ' as a rush job' : ''}: ${offer!.price.toFixed(0)} €/${offer!.unit}, crew on site from ${ctx.calendar.format(offer!.start)}`, [pkgId]);
  return offer!;
}

export function releaseBooking(ctx: WriteCtx, pkgId: EntityId): void {
  const pkg = ctx.get('WorkPackage', pkgId);
  forgetSlip(ctx, pkgId);
  if (!pkg?.contractor) return;
  const st = ctx.state('production');
  const list = (st.bookings[pkg.contractor] ?? []).filter((b) => b.package !== pkgId);
  ctx.patchState('production', { bookings: { ...st.bookings, [pkg.contractor]: list } });
}

/**
 * The site is not ready when the crew is due: the firm moves on to its next client. Our job goes to
 * the back of its queue; a regular's firm waits a little first and fits the job in sooner.
 */
export function maybePostpone(ctx: WriteCtx, pkgId: EntityId, allow?: number | null): void {
  const pkg = ctx.require('WorkPackage', pkgId);
  if (!pkg.contractor || !pkg.contract || pkg.status !== 'waiting') return;
  const firm = pkg.contractor;
  const party = partyOf(ctx, pkgId);
  const regular = standing(ctx, firm, party);
  const c = ctx.data('contractors')[firm]!;
  const dur = pkg.contract.end - pkg.contract.start;
  // (a firm on the job waits for its own work before, and comes when it allows: no slot missed)
  if (onTheJob(ctx, pkgId, firm)) {
    if (ctx.now < pkg.contract.start || allow === null || allow === undefined || allow <= pkg.contract.start) return;
    const start = earliestSlot(ctx, firm, Math.max(ctx.now, allow), dur, 0, pkgId);
    if (start <= pkg.contract.start) return;
    const st = ctx.state('production');
    ctx.patchState('production', { bookings: { ...st.bookings, [firm]: (st.bookings[firm] ?? []).map((b) => (b.package === pkgId ? { ...b, start, end: start + dur } : b)) } });
    ctx.patch('WorkPackage', pkgId, { contract: queued(pkg.contract, start, dur), earliestStart: start });
    ctx.log('info', `${c.label} goes on with ${pkg.label} when its work before allows: on site from ${ctx.calendar.format(start, 'day')}.`, [pkgId]);
    return;
  }
  if (ctx.now < pkg.contract.start + graceDays(ctx, firm, party) * DAY) return;
  releaseBooking(ctx, pkgId);
  slotMissed(ctx, firm, party);
  // a new client queues behind the whole order book; a regular is fitted into the next gap
  const ahead = requeueDays(ctx, firm, party);
  const start = earliestSlot(ctx, firm, ctx.now, dur, ahead);
  const st = ctx.state('production');
  ctx.patchState('production', { bookings: { ...st.bookings, [firm]: [...(st.bookings[firm] ?? []), { package: pkgId, start, end: start + dur }] } });
  ctx.patch('WorkPackage', pkgId, { contract: queued(pkg.contract, start, dur), earliestStart: start });
  drawSlip(ctx, pkgId, start, ahead);
  const weeks = Math.round((start - ctx.now) / (7 * DAY));
  ctx.log('warn', `${c.label} could not start ${pkg.label}: the site was not ready, and the crew went to the next client. ${regular >= 0.5 ? 'As regulars we are fitted in again' : 'The job goes to the back of their queue'}: on site from ${ctx.calendar.format(start, 'day')} (in ${weeks} weeks)${hurryOffer(ctx, pkgId) ? '; it can be bought forward as a rush job (production.hurry)' : ''}.`, [pkgId]);
}

/** when the work before a package is forecast to let it start (null: nothing to go by); `unknown`: work before that has no forecast at all, by the package that needs the decision */
export function predecessorsAllow(read: ReadCtx, pkgId: EntityId, rows: ReadonlyMap<EntityId, ScheduleRow>): { at: number | null; unknown: { package: EntityId; label: string; why: string }[] } {
  const pkg = read.require('WorkPackage', pkgId);
  let at: number | null = null;
  const unknown = new Map<EntityId, { package: EntityId; label: string; why: string }>();
  for (const l of pkg.after) {
    const pre = rows.get(l.package);
    if (pre?.status === 'done' || pre?.status === 'cancelled') continue;
    if (!pre || !Number.isFinite(pre.finish) || pre.stalled) {
      const root = pre?.stalledAt ?? l.package;
      const label = rows.get(root)?.label ?? read.get('WorkPackage', root)?.label ?? root;
      unknown.set(root, { package: root, label, why: pre?.stalled ?? 'no forecast' });
      continue;
    }
    const t = l.type === 'FS' ? pre.finish + l.lag * HOUR : pre.start + l.lag * (pre.finish - pre.start);
    at = Math.max(at ?? 0, t);
  }
  return { at, unknown: [...unknown.values()] };
}

/** where a firm would put a job we move now: behind its queue from today (a regular's firm fits it in sooner) */
export function rescheduledStart(read: ReadCtx, pkgId: EntityId, notBefore: number): number {
  const pkg = read.require('WorkPackage', pkgId);
  const firm = pkg.contractor!;
  // (a firm on the job keeps it in its own sequence)
  const ahead = onTheJob(read, pkgId, firm) ? 0 : requeueDays(read, firm, partyOf(read, pkgId));
  // the job's own slot is free again for it
  return earliestSlot(read, firm, notBefore, pkg.contract!.end - pkg.contract!.start, ahead, pkgId);
}

/** a job back in the firm's ordinary queue: at the price agreed (a rush surcharge is for the rush) */
function queued(c: NonNullable<WorkPackage['contract']>, start: number, dur: number): NonNullable<WorkPackage['contract']> {
  const { agreed, ...rest } = c;
  return { ...rest, price: agreed ?? c.price, start, end: start + dur };
}

/** move a booked job to a later date, with notice: it queues again from today (no slot is missed) */
export function reschedule(ctx: WriteCtx, pkgId: EntityId, notBefore: number): number {
  const pkg = ctx.require('WorkPackage', pkgId);
  if (!pkg.contractor || !pkg.contract) ctx.reject('production.notBooked', { package: pkg.label });
  if (pkg.status === 'active' || pkg.status === 'done' || pkg.status === 'cancelled' || ctx.now >= pkg.contract!.start) ctx.reject('production.alreadyStarted', { package: pkg.label });
  const firm = pkg.contractor!;
  const dur = pkg.contract!.end - pkg.contract!.start;
  const start = rescheduledStart(ctx, pkgId, Math.max(ctx.now, notBefore));
  const ahead = (start - ctx.now) / DAY;
  const st = ctx.state('production');
  ctx.patchState('production', { bookings: { ...st.bookings, [firm]: (st.bookings[firm] ?? []).map((b) => (b.package === pkgId ? { ...b, start, end: start + dur } : b)) } });
  ctx.patch('WorkPackage', pkgId, { contract: queued(pkg.contract!, start, dur), earliestStart: start });
  if (onTheJob(ctx, pkgId, firm)) forgetSlip(ctx, pkgId);
  else drawSlip(ctx, pkgId, start, Math.min(ahead, bookOf(ctx, firm).backlog));
  ctx.log('info', `${ctx.data('contractors')[firm]!.label} moved ${pkg.label}: on site from ${ctx.calendar.format(start, 'day')} (was ${ctx.calendar.format(pkg.contract!.start, 'day')}).`, [pkgId]);
  return start;
}

/** where a firm would put a booked job if we pay to have it squeezed in ahead of its queue (a rush), and at what price; null: no sooner */
export function hurryOffer(read: ReadCtx, pkgId: EntityId, notBefore?: number): { start: number; price: number } | null {
  const pkg = read.require('WorkPackage', pkgId);
  if (!pkg.contractor || !pkg.contract) return null;
  // only where the site can be ready for it: the project going on, the work before forecast done by then
  if (read.get('Project', pkg.project)?.status !== 'active') return null;
  const rows = new Map(forecastSchedule(read, pkg.project).map((r) => [r.package, r] as const));
  const before = predecessorsAllow(read, pkgId, rows);
  if (before.unknown.length) return null;
  const firm = pkg.contractor;
  const dur = pkg.contract.end - pkg.contract.start;
  const start = earliestSlot(read, firm, Math.max(read.now, notBefore ?? read.now, before.at ?? 0), dur, marketOf(read).rush.days.value, pkgId);
  if (start >= pkg.contract.start) return null;
  // the surcharge on the price agreed (not on a rush price already)
  return { start, price: (pkg.contract.agreed ?? pkg.contract.price) * (1 + rushSurcharge(read, firm)) };
}

/** a booked job not yet begun, squeezed in ahead of the firm's queue at the rush surcharge (a job sent to the back of the queue, bought forward) */
export function hurry(ctx: WriteCtx, pkgId: EntityId, notBefore?: number): { start: number; price: number } {
  const pkg = ctx.require('WorkPackage', pkgId);
  if (!pkg.contractor || !pkg.contract) ctx.reject('production.notBooked', { package: pkg.label });
  if (pkg.status === 'active' || pkg.status === 'done' || pkg.status === 'cancelled') ctx.reject('production.alreadyStarted', { package: pkg.label });
  const firm = pkg.contractor!;
  const c = ctx.data('contractors')[firm]!;
  const o = hurryOffer(ctx, pkgId, notBefore);
  if (!o) ctx.reject('production.noSooner', { contractor: c.label, package: pkg.label, start: ctx.calendar.format(pkg.contract!.start, 'day') });
  const dur = pkg.contract!.end - pkg.contract!.start;
  const st = ctx.state('production');
  ctx.patchState('production', { bookings: { ...st.bookings, [firm]: (st.bookings[firm] ?? []).map((b) => (b.package === pkgId ? { ...b, start: o!.start, end: o!.start + dur } : b)) } });
  ctx.patch('WorkPackage', pkgId, { contract: { ...pkg.contract!, price: o!.price, start: o!.start, end: o!.start + dur, agreed: pkg.contract!.agreed ?? pkg.contract!.price }, earliestStart: o!.start });
  drawSlip(ctx, pkgId, o!.start, marketOf(ctx).rush.days.value);
  ctx.log('info', `${c.label} squeezes ${pkg.label} in as a rush job: on site from ${ctx.calendar.format(o!.start, 'day')} (was ${ctx.calendar.format(pkg.contract!.start, 'day')}), ${o!.price.toFixed(0)} € a unit.`, [pkgId]);
  return o!;
}

/** a booked job the work before is forecast to keep waiting longer than the firm waits for a site: move it now, or the crew finds the site not ready */
export function bookingWarning(read: ReadCtx, pkgId: EntityId, rows: ReadonlyMap<EntityId, ScheduleRow>): Blocker | null {
  const pkg = read.require('WorkPackage', pkgId);
  if (!pkg.contractor || !pkg.contract || pkg.status !== 'waiting') return null;
  const who = read.data('contractors')[pkg.contractor]!.label;
  const leaves = pkg.contract.start + graceDays(read, pkg.contractor, partyOf(read, pkgId)) * DAY;
  const day = (t: number) => read.calendar.format(t, 'day');
  // the crew is here and the site is not ready: they wait so long, then go to their next client
  if (read.now >= pkg.contract.start) return { module: 'production', code: 'production.crewWaitingForSite', severity: 'warn', params: { who, until: day(leaves) } };
  const { at: allow, unknown } = predecessorsAllow(read, pkgId, rows);
  // work before with no forecast (not let, or blocked): nobody can say the site will be ready
  if (unknown.length) {
    const names = unknown.map((u) => u.label).join(', ');
    return {
      module: 'production',
      code: 'production.bookingAtRisk',
      severity: 'warn',
      params: { who, date: day(pkg.contract.start), before: unknown.map((u) => `${u.label} (${u.why})`).join('; ') },
      remedies: [{ label: `Decide what ${names} ${unknown.length > 1 ? 'need' : 'needs'} (see ${unknown.length > 1 ? 'their' : 'its'} remedies); then move ${who}'s booking (production.reschedule) if it comes too early` }],
    };
  }
  if (allow === null || allow <= leaves) return null;
  const moved = rescheduledStart(read, pkgId, allow);
  return {
    module: 'production',
    code: 'production.bookingTooEarly',
    severity: 'warn',
    params: { who, date: read.calendar.format(pkg.contract.start, 'day'), ready: read.calendar.format(allow, 'day') },
    remedies: [{ label: `Move ${who}'s booking now: on site from ${read.calendar.format(moved, 'day')}`, command: { type: 'production.reschedule', payload: { package: pkgId, notBefore: allow } } }],
  };
}

function subcontractSupplies(read: ReadCtx, activity: Activity, activityId: string): SiteSupply[] {
  const d = activity.subcontract?.deliveries;
  if (!d) return [];
  const supply: SiteSupply = { kind: 'subcontract', material: d.material, label: d.label, perUnit: flexTo(d.perUnit, `t/${activity.unit}`, `activity ${activityId} subcontract deliveries`), unit: 't', profile: d.profile, delivered: 0, inbound: 0, used: 0, wasted: 0 };
  // ready-mix concrete etc. sets: what is not placed by the end of the shift is waste, for contractors too
  const mat = read.data('materials')[d.material];
  if (mat?.perishableHours) supply.perishableHours = mat.perishableHours.value;
  return [supply];
}

/** booked just-in-time supplies (asphalt) for a package */
export function bookSupply(ctx: WriteCtx, pkgId: EntityId, supplier?: string): { from: number; supplier: string } {
  const pkg = ctx.require('WorkPackage', pkgId);
  const activity = ctx.data('activities')[pkg.activity]!;
  const direct = Object.entries(activity.directSupply ?? {});
  if (!direct.length) ctx.reject('production.noDirectSupply', { package: pkg.label });
  if (pkg.supplyBooking) ctx.reject('production.alreadyBooked', { package: pkg.label });
  const hold = ctx.port('holdings');
  const [mainMat] = direct[0]!;
  const offers = ctx.port('trade').offers(mainMat);
  const offer = supplier ? offers.find((o) => o.supplier === supplier) : offers[0];
  if (!offer) ctx.reject('production.noSupplier', { material: hold.material(mainMat).label });
  const sup = ctx.data('suppliers')[offer!.supplier]!;
  // each material from one who offers it (the main supplier, or the first that does): none is booked from
  // one who does not, nor for nothing (0002)
  const supplies: SiteSupply[] = direct.map(([mat, q]) => {
    const m = hold.material(mat);
    const o = ctx.port('trade').offers(mat).find((x) => x.supplier === offer!.supplier) ?? ctx.port('trade').offers(mat)[0];
    if (!o) return ctx.reject('production.noSupplier', { material: m.label });
    const s: SiteSupply = { kind: 'booked', material: mat, label: m.label, perUnit: flexTo(q, `${m.unit}/${activity.unit}`, `activity ${pkg.activity} direct supply ${mat}`), unit: m.unit, profile: sup.vehicleProfile, supplier: o.supplier, price: o.price, delivered: 0, inbound: 0, used: 0, wasted: 0 };
    if (m.perishableHours) s.perishableHours = m.perishableHours.value;
    return s;
  });
  const from = ctx.calendar.startOfDay(ctx.now + offer!.leadTimeDays * DAY);
  ctx.patch('WorkPackage', pkgId, { supplies, supplyBooking: { supplier: offer!.supplier, from } });
  ctx.log('info', `Booked ${hold.material(mainMat).label} from ${offer!.supplierLabel} for ${pkg.label}, deliveries from ${ctx.calendar.format(from, 'day')}`, [pkgId]);
  return { from, supplier: offer!.supplier };
}

export function bookingRemedies(read: ReadCtx, pkgId: EntityId): Remedy[] {
  const pkg = read.require('WorkPackage', pkgId);
  const activity = read.data('activities')[pkg.activity]!;
  const main = Object.keys(activity.directSupply ?? {})[0];
  if (!main) return [];
  const hold = read.port('holdings');
  // the others come with it, from the same supplier or the first that has them: said (Qwen S227: the chippings went unnamed)
  // (a material nobody offers cannot be booked at all: said, with no booking to make)
  const unoffered = Object.keys(activity.directSupply ?? {}).filter((mat) => !read.port('trade').offers(mat).length);
  if (unoffered.length) return [{ label: `Nobody offers ${unoffered.map((mat) => hold.material(mat).label).join(', ')}: the delivery cannot be booked` }];
  const rest = (supplier: string) =>
    Object.keys(activity.directSupply ?? {})
      .slice(1)
      .map((mat) => {
        const o = read.port('trade').offers(mat).find((x) => x.supplier === supplier) ?? read.port('trade').offers(mat)[0]!;
        return `, with ${hold.material(mat).label}${o.supplier === supplier ? '' : ` from ${o.supplierLabel}`} (${o.price.toFixed(0)} €/${hold.material(mat).unit})`;
      })
      .join('');
  return read.port('trade').offers(main).map((o) => ({ label: `Book ${hold.material(main).label} from ${o.supplierLabel} (${o.price.toFixed(0)} €/${hold.material(main).unit}, lead ${o.leadTimeDays} d)${rest(o.supplier)}`, command: { type: 'production.bookSupply', payload: { package: pkgId, supplier: o.supplier } } }));
}

/** work units the delivered material allows (∞ when the package needs no site supply) */
export function suppliedUnits(pkg: Readonly<WorkPackage>): number {
  if (!pkg.supplies?.length) return Number.POSITIVE_INFINITY;
  return Math.min(...pkg.supplies.map((s) => (s.perUnit > 0 ? s.delivered / s.perUnit : Number.POSITIVE_INFINITY)));
}

/** book the material built in by `delta` units of work */
export function consumeSupplies(ctx: WriteCtx, pkgId: EntityId, delta: number): void {
  const pkg = ctx.require('WorkPackage', pkgId);
  if (!pkg.supplies?.length || delta <= 0) return;
  const supplies = pkg.supplies.map((s) => {
    const used = Math.min(s.delivered, s.perUnit * delta);
    // built in where it was set down
    if (used > 1e-9 && pkg.front && ctx.port('holdings').exists(pkg.front)) ctx.command('inventory.transfer', { from: pkg.front, to: builtOf(ctx, pkgId), material: s.material, qty: Math.min(inMaterialUnit(ctx, s, used), ctx.port('holdings').stock(pkg.front, s.material)), why: pkg.label });
    return { ...s, delivered: s.delivered - used, used: s.used + used };
  });
  ctx.patch('WorkPackage', pkgId, { supplies });
}

/** dispatch delivery trucks so that material runs AHEAD_HOURS ahead of the work */
export function dispatchDeliveries(ctx: WriteCtx, pkgId: EntityId, expectedRate: number): void {
  const pkg = ctx.require('WorkPackage', pkgId);
  if (!pkg.supplies?.length) return;
  const routing = ctx.port('routing');
  const ext = routing.externalNodes()[0];
  if (!ext) return;
  const remainingUnits = Math.max(0, pkg.quantity - (pkg.process ? (ctx.process(pkg.process)?.done ?? 0) : 0));
  // material for the work that can still be done today: trucks leave so that the first load is
  // there at the shift start, and nothing is ordered that could not be laid before the shift ends
  const win = ctx.port('workforce').shiftWindow(ctx.now, workParty(ctx, pkgId));
  if (!win || ctx.now >= win.end) return;
  const supplies = pkg.supplies.map((s) => ({ ...s }));
  let changed = false;
  // each supply's lorries for today, sent in turns (one of each, then the next of each): a plant's fleet is shared among
  // them, not taken by the first (the tack coat comes before the asphalt it is for)
  const plans: { s: (typeof supplies)[number]; idx: number; send: (k: number) => boolean; need: number; k: number }[] = [];
  supplies.forEach((s, idx) => {
    const travel = travelS(ctx, pkg.pos, s.profile);
    const depart0 = Math.max(ctx.now, win.start - travel);
    const workableH = Math.max(0, (win.end - Math.max(depart0 + travel, win.start)) / HOUR);
    // material that sets (ready-mix) or cools (hot mix) is called off for what can be placed within its workable time
    const aheadH = s.perishableHours ? Math.min(AHEAD_HOURS, s.perishableHours) : AHEAD_HOURS;
    // (what sets is called off by today's pace, not the plan's: a day's call-off no more than a shift places; Qwen S209)
    const rate = s.perishableHours && expectedRate > 0 ? expectedRate : Math.max(expectedRate, pkg.estimate.rate);
    const aheadUnits = Math.min(remainingUnits, rate * Math.min(aheadH, workableH));
    const prof = routing.profile(s.profile);
    const payloadT = prof.payload?.value ?? 15;
    // cargo per truck in the supply's unit (t for trade goods; material units for booked supplies)
    const perTruck = s.unit === 't' ? payloadT : s.unit === 'm3' ? payloadT / 2.4 : payloadT;
    const stillNeeded = Math.max(0, remainingUnits * s.perUnit - s.delivered - s.inbound);
    // keep a few hours of work on site in whole truckloads; what sets or cools comes as the pour needs it (part loads)
    const target = aheadUnits * s.perUnit;
    if (target - s.delivered - s.inbound <= 1e-6 || stillNeeded <= 1e-6) return;
    const need = Math.min(stillNeeded, s.perishableHours ? target - s.delivered - s.inbound : Math.max(target - s.delivered - s.inbound, perTruck));
    // (a plant sends no more of its lorries than it has: those out until they are home again: r37)
    const fleet = s.supplier ? ctx.data('suppliers')[s.supplier]?.fleet.value : undefined;
    const out = () => (s.supplier ? [...ctx.all('Move')].filter(([, m]) => (m.status === 'underway' || m.status === 'unloading') && m.legs.some((l) => l.carrier.fleet === s.supplier)).length : 0);
    const plan = { s, idx, need, k: 0, send: (k: number): boolean => false };
    plan.send = (k: number): boolean => {
      if (plan.need <= 1e-6 || k >= 12 || (fleet !== undefined && out() >= fleet)) return false;
      const qty = Math.min(perTruck, plan.need);
      // the plant's lorry, from beyond the way in to the work front
      const r = ctx.command('moves.dispatch', {
        legs: [{ carrier: { class: s.profile, ...(s.supplier ? { fleet: s.supplier } : {}) }, from: pkg.pos, to: pkg.pos, externalNode: ext, maxOffroad: SITE_ACCESS_OFFROAD }],
        loads: [{ goods: { material: s.material, qty, unit: s.unit, mass: supplyMass(ctx, s, qty) } }],
        purpose: 'site-supply',
        ref: `${pkgId}|${idx}`,
        requester: 'production',
        departAt: depart0 + k * TRUCK_SPACING_S,
        returnEmpty: true,
      });
      if (!r.ok) return false; // unreachable: decideRate reports production.siteNoAccess
      s.inbound += qty;
      plan.need -= qty;
      changed = true;
      return true;
    };
    plans.push(plan);
  });
  for (let any = true; any; ) {
    any = false;
    for (const p of plans) if (p.send(p.k)) (p.k += 1), (any = true);
  }
  if (changed) ctx.patch('WorkPackage', pkgId, { supplies });
}

/** the mass (t) of a quantity of a site supply, from its material (what the lorry takes to unload) */
function supplyMass(ctx: ReadCtx, s: SiteSupply, qty: number): number {
  if (s.unit === 't') return qty;
  const m = ctx.data('materials')[s.material];
  if (!m || m.unit !== s.unit) throw new Error(`site supply ${s.label}: no mass for ${s.unit} of ${s.material}`);
  return (qty * unitMass(m)) / 1000;
}

export function onSupplyArrived(ctx: WriteCtx, ref: string, qty: number): void {
  const [pkgId, idxS] = ref.split('|');
  const pkg = pkgId ? ctx.get('WorkPackage', pkgId) : undefined;
  if (!pkg?.supplies) return;
  const idx = Number(idxS);
  // the work called off or done meanwhile: the lorry takes its load back (r41: it is not set down for nothing)
  if (pkg.status === 'cancelled' || pkg.status === 'done') {
    ctx.patch('WorkPackage', pkgId!, { supplies: pkg.supplies.map((s, i) => (i === idx ? { ...s, inbound: Math.max(0, s.inbound - qty) } : s)) });
    const s0 = pkg.supplies[idx];
    if (s0) ctx.log('info', `${s0.label} for ${pkg.label}: the work is ${pkg.status === 'done' ? 'done' : 'called off'}, the lorry takes its ${qty.toFixed(1)} ${s0.unit} back.`, [pkgId!]);
    return;
  }
  const supplies = pkg.supplies.map((s, i) => (i === idx ? { ...s, inbound: Math.max(0, s.inbound - qty), delivered: s.delivered + qty } : s));
  ctx.patch('WorkPackage', pkgId!, { supplies });
  const s = pkg.supplies[idx];
  // set down at the front: goods come in over the world's edge (the firm's or the plant's), and lie there (design/physical-state.md I1)
  if (s) {
    const r = ctx.command('inventory.fromOutside', { into: frontAt(ctx, pkgId!, pkg.pos), material: s.material, qty: inMaterialUnit(ctx, s, qty), why: `${s.label} for ${pkg.label}` });
    // (a delivery that cannot come in as goods is a data error, not work done of nothing: finding 28)
    if (!r.ok) throw new Error(`${s.label} for ${pkg.label}: ${JSON.stringify(r.reasons)}`);
  }
  // material that sets or cools arriving after the shift has ended cannot be placed (the evening waste already ran)
  if (s?.perishableHours && !ctx.port('workforce').onShift(ctx.now, workParty(ctx, pkgId!))) {
    setHard(ctx, pkgId!, s, qty);
    ctx.patch('WorkPackage', pkgId!, { supplies: ctx.require('WorkPackage', pkgId!).supplies!.map((x, i) => (i === idx ? { ...x, delivered: Math.max(0, x.delivered - qty), wasted: x.wasted + qty } : x)) });
    ctx.log('warn', `${pkg.label}: ${qty.toFixed(1)} ${s.unit} of ${s.label} arrived after the shift and cannot be placed within its ${s.perishableHours} h — waste.`, [pkgId!]);
  }
  if (s?.kind === 'booked' && s.price) {
    const amount = qty * s.price * ctx.port('prices').index(ctx.now);
    const party = partyOf(ctx, pkgId!);
    ctx.ledger.post({ from: acct(party, ACCOUNTS.cash), to: acct(party, ACCOUNTS.materials), amount, memo: `${s.label} ${qty.toFixed(1)} ${s.unit} delivered to ${pkg.label}`, category: 'materials', refs: [pkgId!, pkg.project] });
    ctx.patch('WorkPackage', pkgId!, { cost: { ...ctx.require('WorkPackage', pkgId!).cost, materials: ctx.require('WorkPackage', pkgId!).cost.materials + amount } });
  }
}

/** what set or cooled at the front unplaced: rubble lying there (by mass, design/physical-state.md I1), not nothing */
function setHard(ctx: WriteCtx, pkgId: EntityId, s: SiteSupply, qty: number): void {
  const pkg = ctx.require('WorkPackage', pkgId);
  const hold = ctx.port('holdings');
  const front = pkg.front && ctx.port('holdings').exists(pkg.front) ? pkg.front : undefined;
  const rubble = ctx.data('materials')['waste.construction'] ? 'waste.construction' : undefined;
  if (!front || !rubble) return;
  const q = Math.min(inMaterialUnit(ctx, s, qty), hold.stock(front, s.material));
  if (q <= 1e-9) return;
  const kg = q * unitMass(hold.material(s.material));
  ctx.command('inventory.transform', { at: front, take: [{ material: s.material, qty: q }], give: [{ material: rubble, qty: kg / unitMass(hold.material(rubble)) }], why: `${s.label} set unplaced at ${pkg.label}` });
}

/** at the end of the shift, material that sets or cools and was not placed is waste */
export function wastePerishables(ctx: WriteCtx, pkgId: EntityId): void {
  const pkg = ctx.require('WorkPackage', pkgId);
  if (!pkg.supplies?.some((s) => s.perishableHours && s.delivered > 1e-6)) return;
  const lost: string[] = [];
  const supplies = pkg.supplies.map((s) => {
    if (!s.perishableHours || s.delivered <= 1e-6) return s;
    if (s.delivered >= 0.05) lost.push(`${s.delivered.toFixed(1)} ${s.unit} of ${s.label}`);
    setHard(ctx, pkgId, s, s.delivered);
    return { ...s, wasted: s.wasted + s.delivered, delivered: 0 };
  });
  ctx.patch('WorkPackage', pkgId, { supplies });
  if (lost.length) ctx.log('warn', `${pkg.label}: ${lost.join(', ')} not placed by the end of the shift (it sets or cools) — waste.`, [pkgId]);
}

/** contractor crews: vans in the morning, home in the evening */
export function commute(ctx: WriteCtx, pkgId: EntityId, direction: 'in' | 'out'): void {
  const pkg = ctx.require('WorkPackage', pkgId);
  const activity = ctx.data('activities')[pkg.activity]!;
  if (!activity.subcontract || !pkg.contractor) return;
  const routing = ctx.port('routing');
  const ext = routing.externalNodes()[0];
  if (!ext) return;
  const vans = Math.max(1, Math.ceil(activity.subcontract.crewSize / 3));
  // (as near the site as the van gets: the crew walks the rest)
  const at = parkNear(ctx, ext, pkg.pos, 'van') ?? pkg.pos;
  for (let i = 0; i < vans; i += 1) {
    // the firm's van with its crew (the firm's people are not on our map as persons)
    ctx.command('moves.dispatch', {
      legs: [{ carrier: { class: 'van' }, from: at, to: at, ...(direction === 'in' ? { externalNode: ext } : { externalDestination: ext }), maxOffroad: SITE_ACCESS_OFFROAD }],
      purpose: direction === 'in' ? 'commute-in' : 'commute-out',
      ref: pkgId,
      requester: 'production',
      departAt: ctx.now + i * 120,
    });
  }
  if (direction === 'out') ctx.patch('WorkPackage', pkgId, { crewOnSite: false });
}

export function onCrewArrived(ctx: WriteCtx, pkgId: string): void {
  const pkg = ctx.get('WorkPackage', pkgId);
  if (pkg && !pkg.crewOnSite) ctx.patch('WorkPackage', pkgId, { crewOnSite: true });
}

export { HOUR };
