/**
 * The firms' order books (the contractor market). Every firm works through the jobs of its other
 * clients, and a new order queues behind them. How long that queue is follows the construction
 * cycle (a boom fills the books, a bust empties them), the season and each firm's luck that month.
 * Busy firms charge more and, when full, take no new orders; for a surcharge most can squeeze a job
 * in. The jobs ahead of ours overrun more often than not, which the firm tells us a few days before
 * the start it gave us (until then the overrun is hidden). A site that is not ready when the crew is due sends
 * our job to the back of the queue, unless we are a regular: then the firm waits a little and fits
 * us in sooner.
 */
import { DAY, type EntityId, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import type { Contractor, ContractorMarket } from './contract.ts';

/** a firm's order book and our history with it */
export interface FirmBook {
  /** days of other clients' work ahead of a new order */
  backlog: number;
  /** this month's luck: the log of the firm's order book against the market's */
  luck: number;
  /** per client party: jobs the firm finished for it, and slots it kept that the client's site was not ready for */
  clients: Record<string, { jobs: number; missed: number }>;
}

/** a booked job's start that the jobs ahead will push back (hidden until the firm says so) */
export interface Slip {
  planned: number;
  actual: number;
  /** when the job was booked, and the days of the firm's queue then ahead of it */
  from: number;
  ahead: number;
}

export function marketOf(read: ReadCtx): ContractorMarket {
  const m = read.data('contractorMarket');
  if (!m) throw new Error('production: the world has contractors but no contractorMarket data');
  return m;
}

const contractor = (read: ReadCtx, id: string): Contractor => {
  const c = read.data('contractors')[id];
  if (!c) throw new Error(`production: unknown contractor ${id}`);
  return c;
};

/** construction activity now (1 = normal); a world without a construction cycle is always at the market's reference */
export function activity(read: ReadCtx): number {
  return read.hasPort('constructionCycle') ? read.port('constructionCycle').current().level : marketOf(read).reference.level.value;
}

/** the order book the market pushes a firm towards now (days) */
function targetBacklog(read: ReadCtx, id: string, luck: number): number {
  const m = marketOf(read);
  const season = m.season[read.calendar.at(read.now).month - 1]!.value;
  return contractor(read, id).leadTime.value * (activity(read) / m.reference.level.value) ** m.cycleElasticity.value * (season / m.reference.season.value) ** m.seasonElasticity.value * Math.exp(luck);
}

export function bookOf(read: ReadCtx, id: string): FirmBook {
  const b = read.state('production').firms[id];
  if (!b) throw new Error(`production: no order book for ${id}`);
  return b;
}

/** how busy a firm is: its order book against its normal one (1 = normal) */
export const busyness = (read: ReadCtx, id: string): number => bookOf(read, id).backlog / Math.max(contractor(read, id).leadTime.value, 1);

/** a client party's history with a firm */
export const clientOf = (read: ReadCtx, id: string, party: EntityId): { jobs: number; missed: number } => bookOf(read, id).clients[party] ?? { jobs: 0, missed: 0 };

/** a client party's standing with a firm: 0 (a new client) … 1 (a regular) */
export function standing(read: ReadCtx, id: string, party: EntityId): number {
  const c = clientOf(read, id, party);
  return 1 - Math.exp(-Math.max(0, c.jobs - c.missed) / marketOf(read).regularAfter.value);
}

/** how long a firm waits for a site that is not ready before it moves the crew on (days; a regular's longer) */
export const graceDays = (read: ReadCtx, id: string, party: EntityId): number => Math.max(1, marketOf(read).graceDays.value * standing(read, id, party));

/** where a firm puts a job again (days from now): a new client behind the whole order book, a regular into the next gap */
export function requeueDays(read: ReadCtx, id: string, party: EntityId): number {
  const backlog = bookOf(read, id).backlog;
  const regular = standing(read, id, party);
  return regular * Math.min(backlog, contractor(read, id).rebookDelay.value) + (1 - regular) * backlog;
}

/** the firm takes no new orders */
export const isFull = (read: ReadCtx, id: string): boolean => busyness(read, id) >= marketOf(read).fullAt.value;

/** price factor of a busy (or idle) firm, and the rush surcharge on top */
export const busyPrice = (read: ReadCtx, id: string): number => busyness(read, id) ** marketOf(read).priceElasticity.value;
export const rushSurcharge = (read: ReadCtx, id: string): number => marketOf(read).rush.premium.value * busyness(read, id);

const patchFirm = (ctx: WriteCtx, id: string, patch: Partial<FirmBook>) => {
  const st = ctx.state('production');
  ctx.patchState('production', { firms: { ...st.firms, [id]: { ...st.firms[id]!, ...patch } } });
};

/** every firm's order book at the start: where the market has it, with this month's luck */
export function openBooks(ctx: WriteCtx): void {
  const ids = Object.keys(ctx.data('contractors')).sort();
  if (!ids.length) return;
  const m = marketOf(ctx);
  if (m.season.length !== 12) throw new Error(`production: contractorMarket.season has ${m.season.length} months, not 12`);
  const firms: Record<string, FirmBook> = {};
  for (const id of ids) {
    const luck = m.firmSpread.value * ctx.rng('firms').normal(0, 1);
    firms[id] = { backlog: targetBacklog(ctx, id, luck), luck, clients: {} };
  }
  ctx.patchState('production', { firms, firmMonth: ctx.calendar.at(ctx.now).month });
}

/** a day of the market: firms' luck turns each month, order books move towards the market, overruns are told */
export function marketDay(ctx: WriteCtx): void {
  const ids = Object.keys(ctx.data('contractors')).sort();
  if (!ids.length) return;
  const m = marketOf(ctx);
  const month = ctx.calendar.at(ctx.now).month;
  const newMonth = ctx.state('production').firmMonth !== month;
  for (const id of ids) {
    const b = bookOf(ctx, id);
    const luck = newMonth ? m.firmSpread.value * ctx.rng('firms').normal(0, 1) : b.luck;
    const backlog = b.backlog + (targetBacklog(ctx, id, luck) - b.backlog) / Math.max(1, m.adjustDays.value);
    patchFirm(ctx, id, { luck, backlog: Math.max(0, backlog) });
  }
  if (newMonth) ctx.patchState('production', { firmMonth: month });
  // the firms tell us their overruns a few days before the start they had given us
  for (const [pkg, slip] of Object.entries(ctx.state('production').slips)) if (ctx.now >= slip.planned - m.overrun.noticeDays.value * DAY) announceSlip(ctx, pkg, slip);
}

/**
 * Draw how far the jobs ahead push a booked start back (hidden until the firm says so): the queue
 * ahead, booked at `from`, takes longer than planned; a start with slack behind the queue absorbs it.
 */
export function drawSlip(ctx: WriteCtx, pkg: EntityId, planned: number, aheadDays: number, from = ctx.now): void {
  const m = marketOf(ctx);
  const share = Math.max(0, m.overrun.mean.value + m.overrun.spread.value * ctx.rng('overruns').normal(0, 1));
  const queueEnds = from + aheadDays * (1 + share) * DAY;
  const st = ctx.state('production');
  const slips = { ...st.slips };
  delete slips[pkg];
  if (queueEnds >= planned + DAY) slips[pkg] = { planned, actual: ctx.port('workforce').nextShiftStart(queueEnds), from, ahead: aheadDays };
  ctx.patchState('production', { slips });
}

export function forgetSlip(ctx: WriteCtx, pkg: EntityId): void {
  const st = ctx.state('production');
  if (!st.slips[pkg]) return;
  const slips = { ...st.slips };
  delete slips[pkg];
  ctx.patchState('production', { slips });
}

function announceSlip(ctx: WriteCtx, pkgId: string, slip: Slip): void {
  forgetSlip(ctx, pkgId);
  const pkg = ctx.get('WorkPackage', pkgId);
  if (!pkg?.contractor || !pkg.contract || pkg.status === 'done' || pkg.status === 'cancelled' || pkg.contract.start !== slip.planned) return;
  const shift = slip.actual - slip.planned;
  const st = ctx.state('production');
  // the firm keeps its own sequence: our jobs with it that the late one now runs into move by as much
  const end = pkg.contract.end + shift;
  const moved = (st.bookings[pkg.contractor] ?? []).filter((b) => b.package === pkgId || (b.start >= slip.planned && b.start < end)).map((b) => b.package);
  const books = (st.bookings[pkg.contractor] ?? []).map((b) => (moved.includes(b.package) ? { ...b, start: b.start + shift, end: b.end + shift } : b));
  ctx.patchState('production', { bookings: { ...st.bookings, [pkg.contractor]: books } });
  for (const id of moved) {
    const p = ctx.require('WorkPackage', id);
    ctx.patch('WorkPackage', id, { contract: { ...p.contract!, start: p.contract!.start + shift, end: p.contract!.end + shift }, earliestStart: p.contract!.start + shift });
    // a later job's own overrun is counted from its new date
    const later = ctx.state('production').slips[id];
    if (id !== pkgId && later) ctx.patchState('production', { slips: { ...ctx.state('production').slips, [id]: { ...later, planned: later.planned + shift, actual: later.actual + shift } } });
  }
  const others = moved.filter((id) => id !== pkgId).map((id) => ctx.require('WorkPackage', id).label);
  const days = Math.round(shift / DAY);
  ctx.log('warn', `${contractor(ctx, pkg.contractor).label}: the job before ours runs late. ${pkg.label} starts ${ctx.calendar.format(slip.actual, 'day')} instead of ${ctx.calendar.format(slip.planned, 'day')} (${days} days later)${others.length ? `; ${others.join(', ')} move with it` : ''}.`, [pkgId, ...moved.filter((id) => id !== pkgId)]);
}

/** a fork does not know whether the jobs ahead will overrun: the overruns not yet told are drawn again */
export function redrawSlips(ctx: WriteCtx): void {
  for (const [pkg, slip] of Object.entries(ctx.state('production').slips)) drawSlip(ctx, pkg, slip.planned, slip.ahead, slip.from);
}

/** a job the firm finished for a client: it becomes more of a regular */
export function jobDone(ctx: WriteCtx, firm: string, party: EntityId): void {
  if (!ctx.state('production').firms[firm]) return;
  const c = clientOf(ctx, firm, party);
  patchFirm(ctx, firm, { clients: { ...bookOf(ctx, firm).clients, [party]: { ...c, jobs: c.jobs + 1 } } });
}

/** a slot the firm kept for a client whose site was not ready */
export function slotMissed(ctx: WriteCtx, firm: string, party: EntityId): void {
  const c = clientOf(ctx, firm, party);
  patchFirm(ctx, firm, { clients: { ...bookOf(ctx, firm).clients, [party]: { ...c, missed: c.missed + 1 } } });
}
