/**
 * Workforce module: individual people with jobs and qualifications, a weekly shift calendar,
 * stochastic absences (sickness as a Poisson process, vacation planned in seasonal blocks
 * with a concurrency cap) and daily payroll (paid absences included: Entgeltfortzahlung /
 * Urlaubsentgelt).
 */
import { ACCOUNTS, pay, receive } from '../../economy/src/index.ts';
import { actorOf, endedBlock, mustBeLive, partyLabel, wordBlock } from '../../parties/src/index.ts';
import { command, DAY, defineModule, ex, HOUR, s, type EntityId, type Explained, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type { LegRequest, Route } from '../../network/src/index.ts';
import { holidayOn } from './holidays.ts';
import {
  CourseOfferSchema,
  CourseSchema,
  JobSchema,
  LabourSettingsSchema,
  QualificationSchema,
  TownEmployerSchema,
  type Employment,
  type Engaged,
  type Helper,
  type HelperOffer,
  type LabourSettings,
  type Person,
  type Vacancy,
  type Presence,
  type RosterEntry,
  type WorkforcePort,
  type WorkforceState,
} from './contract.ts';

// ------------------------------------------------------------------ model constants

/** Module id (it provides the port of the same name; consumers should require the port). */
export const WORKFORCE_MODULE_ID = 'workforce';

/** Sickness episode length in scheduled workdays: geometric(p) truncated to 1..MAX. */
export const SICK_EPISODE_P = 0.25;
export const SICK_EPISODE_MAX = 10;
/** Share of the staff that may be on vacation at the same time. */
export const VACATION_CAP_SHARE = 0.2;

/**
 * Speed relative to an expert after `hours` of practice: a learning curve (Wright 1936) — every
 * doubling of practice cuts the time per unit by (1 − rate) — reaching 1 at `expertHours`, and
 * counting at least the first instruction. Times the person's aptitude.
 */
export function learningSpeed(hours: number, aptitude: number, learning: { rate: number; expertHours: number; firstHours: number }): number {
  const b = -Math.log2(learning.rate);
  const practised = Math.max(hours, learning.firstHours);
  return aptitude * Math.min(1, (practised / learning.expertHours) ** b);
}

/** Truncated geometric pmf / mean. */
const geomWeights = Array.from({ length: SICK_EPISODE_MAX }, (_, i) => (1 - SICK_EPISODE_P) ** i * SICK_EPISODE_P);
const geomTotal = geomWeights.reduce((a, b) => a + b, 0);
export const SICK_EPISODE_MEAN = geomWeights.reduce((a, w, i) => a + (i + 1) * w, 0) / geomTotal;

/** the weight of a block of leave starting on a day (the practice's `vacationSeason`: the last weight begun by then; before the first, the year's last; none: every week alike) */
function vacationWeight(season: LabourSettings['vacationSeason'], month: number, day: number): number {
  const key = (m: number, d: number) => m * 100 + d;
  const sorted = [...season.weights].sort((a, b) => key(a.month, a.day) - key(b.month, b.day));
  return (sorted.filter((w) => key(w.month, w.day) <= key(month, day)).at(-1) ?? sorted.at(-1))?.weight.value ?? 1;
}

/** whether a month lies from one month to another (over the new year when `from` is the later) */
function withinMonths(months: { from: number; to: number }, month: number): boolean {
  return months.from <= months.to ? month >= months.from && month <= months.to : month >= months.from || month <= months.to;
}

// ------------------------------------------------------------------ helpers

interface ShiftWindow {
  start: number;
  end: number;
  paidHours: number;
}

/** a business keeps the working time of the practice pack; persons, households and groups their own day */
function scheduleOf(ctx: ReadCtx, party?: EntityId): 'business' | 'own' {
  const kind = party ? ctx.get('Party', party)?.kind : undefined;
  return kind === 'person' || kind === 'household' || kind === 'group' ? 'own' : 'business';
}

function shiftWindow(ctx: ReadCtx, t: number, party?: EntityId, paid = false): ShiftWindow | null {
  const set = ctx.data('labourSettings');
  const day = ctx.calendar.startOfDay(t);
  // a business does not work on a public holiday kept as a day of rest (one working for themselves keeps their
  // own days); paid hours are none where the region does not pay it
  const holiday = holidayOn(ctx, day, set.holidays);
  if (holiday && (paid ? !set.holidays!.paid : scheduleOf(ctx, party) === 'business')) return null;
  const sd = (scheduleOf(ctx, party) === 'own' ? set.ownSchedule : set.schedule)[ctx.calendar.at(day).weekday];
  if (!sd || sd.end.value <= sd.start.value) return null;
  return {
    start: day + sd.start.value * HOUR,
    end: day + sd.end.value * HOUR,
    paidHours: Math.max(0, sd.end.value - sd.start.value - sd.breaks.value),
  };
}

const isWorkday = (ctx: ReadCtx, t: number) => shiftWindow(ctx, t) !== null;

function employedAt(e: Readonly<Employment> | undefined, t: number): boolean {
  return Boolean(e) && e!.hiredAt <= t && (e!.leavesAt === undefined || e!.leavesAt > t);
}

function absentAt(p: Readonly<Presence> | undefined, t: number): boolean {
  if (!p) return true;
  if (p.status === 'available') return false;
  if (p.status === 'gone') return true;
  return p.until === undefined || p.until > t;
}

/** 00:00 after the k-th scheduled workday counted from the day containing t0. */
function afterWorkdays(ctx: ReadCtx, t0: number, k: number): number {
  let day = ctx.calendar.startOfDay(t0);
  let left = k;
  for (let i = 0; i < 800; i += 1) {
    if (isWorkday(ctx, day)) left -= 1;
    day += DAY;
    if (left <= 0) return day;
  }
  return day;
}

function workdaysPerYear(ctx: ReadCtx): number {
  const set = ctx.data('labourSettings');
  const perWeek = set.schedule.filter((d) => d.end.value > d.start.value).length;
  return (perWeek * 365.25) / 7;
}

/** the full months from `from` that have ended by `to` (a month: to the day before the same date a month on) */
function fullMonths(read: ReadCtx, from: number, to: number): number {
  let k = 0;
  while (k < 24 && read.calendar.addMonths(from, k + 1) <= to) k += 1;
  return k;
}

/** a working day's pay (§ 11 BUrlG as the practice's: the week's paid hours over its working days) */
function dayPay(read: ReadCtx, hourlyWage: number): number {
  const week = read.data('labourSettings').schedule.filter((d) => d.end.value > d.start.value);
  return week.length ? (hourlyWage * week.reduce((a, d) => a + Math.max(0, d.end.value - d.start.value - d.breaks.value), 0)) / week.length : 0;
}

/**
 * The leave of a calendar year at one employment, from `hiredAt` until `leaves` (none: through the year): one fact for
 * a hire's leave and its settlement at the end (decision 0028 rule 4; review y). By the labour law of the practice pack
 * (`leaveLaw`): the law's least leave in full once the waiting months have passed within the year and they do not leave
 * in its first half, else a twelfth of it for each full month employed in the year; the contract's leave above it by
 * the full months; a fraction of at least half a day a whole day. Without it: the year's leave by its full months.
 */
function leaveOfYear(read: ReadCtx, year: number, hiredAt: number, leaves?: number): number {
  const set = read.data('labourSettings');
  const full = set.vacationDaysPerYear.value;
  const to = Math.min(leaves ?? Infinity, read.calendar.timeOf({ year: year + 1, month: 1, day: 1 }));
  const from = Math.max(hiredAt, read.calendar.timeOf({ year, month: 1, day: 1 }));
  if (to <= from) return 0;
  const months = Math.min(12, fullMonths(read, from, to));
  const law = set.leaveLaw;
  if (!law) return Math.round((full * months) / 12);
  const workdays = set.schedule.filter((d) => d.end.value > d.start.value).length;
  const least = Math.min(full, (law.minimum.value * workdays) / law.perWeek.value);
  const waited = read.calendar.addMonths(hiredAt, law.waiting.value) <= to;
  const firstHalf = leaves !== undefined && leaves <= read.calendar.timeOf({ year, month: 7, day: 1 });
  const x = Math.round(((waited && !firstHalf ? least : (least * months) / 12) + ((full - least) * months) / 12) * 1000) / 1000;
  return x % 1 >= 0.5 ? Math.ceil(x) : x;
}

/** the leave a hire is given for the year they start in: the year's, less what an earlier employer gave that year (§ 6 BUrlG as the practice's) */
function hireLeave(read: ReadCtx, person: EntityId, hiredAt: number): number {
  const year = read.calendar.at(hiredAt).year;
  const given = read.state('workforce').leaveGiven?.[person];
  return Math.max(0, leaveOfYear(read, year, hiredAt) - (read.data('labourSettings').leaveLaw && given?.year === year ? given.days : 0));
}

/**
 * An employment ends (decision 0028 rule 1: its leave ends with it, legibly; review y): the leave of its last year is
 * what was earned by the day they leave, not the year's given at its start; what is left of it and of the years before
 * is paid out with the last wages (`leaveLaw.payout`: a working day's pay with the employer's surcharge; an employer
 * beyond the map pays there, the net comes home), to the heirs on a death; taken beyond it is not asked back. What was
 * given counts against a later employer's that year (`leaveLaw.earlier`).
 */
function settleLeave(ctx: WriteCtx, person: EntityId, leaves: number, death = false): void {
  const set = ctx.data('labourSettings');
  const e = ctx.get('Employment', person);
  const pr = ctx.get('Presence', person);
  if (!set.leaveLaw || !e || !pr || leaves <= e.hiredAt) return;
  const year = ctx.calendar.at(leaves - 1).year;
  const earned = leaveOfYear(ctx, year, e.hiredAt, leaves);
  // (what was given for the year at its start, or at the hire, less what is earned by now: not theirs; an earlier
  // employer's that year was taken off both alike. Given in the year: the year's leave earned here, an earlier one's
  // included, § 6)
  const cut = Math.max(0, leaveOfYear(ctx, year, e.hiredAt) - earned);
  const days = Math.round(Math.max(0, pr.vacationDaysLeft - cut) * 100) / 100;
  const st = ctx.state('workforce');
  const was = st.leaveGiven?.[person];
  ctx.patchState('workforce', { leaveGiven: { ...(st.leaveGiven ?? {}), [person]: { year, days: Math.max(was?.year === year ? was.days : 0, earned) } } });
  ctx.patch('Presence', person, { vacationDaysLeft: 0 });
  if (days < 0.01) return;
  const name = ctx.get('Person', person)?.name ?? person;
  const town = ctx.hasData('employers') ? ctx.data('employers')?.[e.employer] : undefined;
  const gross = days * dayPay(ctx, e.hourlyWage);
  const heirs = death ? ' to their heirs' : '';
  const said = `${name}: ${days} day${days === 1 ? '' : 's'} of leave not taken paid out${heirs} with the last wages (${set.leaveLaw.payout.split(':')[0]})`;
  if (town) {
    const home = ctx.get('Helper', person)?.of;
    const net = Math.round(gross * set.netShare.value * 100) / 100;
    if (home) receive(ctx, home, ACCOUNTS.wages, net, `${said}, from ${town.label} (net)`, [person]);
    ctx.log('info', `${said}: ${net.toFixed(2)} EUR net from ${town.label}.`, [person]);
    return;
  }
  const cost = Math.round(gross * (1 + set.employerSurcharge.value) * 100) / 100;
  pay(ctx, e.employer, ACCOUNTS.labour, cost, said, [person]);
  ctx.log('info', `${said}: ${cost.toFixed(2)} EUR with the employer's contributions.`, [person]);
}

function hourlyCostExplain(ctx: ReadCtx, person: EntityId): Explained {
  // (one of the household at its own work, with a job elsewhere: their own time, unpaid here)
  const h = ctx.get('Helper', person);
  const own = h && ctx.get('Employment', person)?.employer !== h.of && helperHere(h, ctx.now) && !atJobElsewhere(ctx, person, ctx.now);
  if (!ctx.get('Employment', person) || own) return ex.value(0, 'EUR/h', 'unpaid help (family or friend): their meals are paid per day here');
  const e = ctx.require('Employment', person);
  const set = ctx.data('labourSettings');
  const job = ctx.data('jobs')[e.job];
  const wage = job ? ex.param({ ...job.hourlyWage, value: e.hourlyWage }, `wage ${job.label}`) : ex.value(e.hourlyWage, 'EUR/h', 'wage');
  return ex.mul(
    'loaded labour cost',
    'EUR/h',
    wage,
    ex.sum('1 + employer surcharge', '', ex.value(1, ''), ex.param(set.employerSurcharge, 'employer surcharge')),
  );
}

/** when a helper asked now would arrive: after their travel, the next day at the earliest */
const arrivalIfAsked = (ctx: ReadCtx, h: Readonly<Helper>): number => ctx.calendar.startOfDay(ctx.now) + Math.max(1, Math.ceil(h.travelDays)) * DAY;

/** is a helper (family, friend) here at t: living with you, or within their stay */
function helperHere(h: Readonly<Helper> | undefined, t: number): boolean {
  return Boolean(h) && (h!.resident || (h!.stay !== undefined && h!.stay.from <= t && t < h!.stay.until));
}

type ShortTimeLaw = NonNullable<LabourSettings['shortTime']>;

/** is this month in short time's bad-weather season */
function inShortSeason(law: ShortTimeLaw, month: number): boolean {
  return withinMonths(law.season, month);
}

/** the time from `from` to `now` that lay in the bad-weather season (month by month: a few dozen steps at most) */
function seasonTimeBetween(read: ReadCtx, law: ShortTimeLaw, from: number, now: number): number {
  let total = 0;
  for (let t = from, i = 0; t < now && i < 400; i += 1) {
    const c = read.calendar.at(t);
    const next = read.calendar.timeOf({ year: c.month === 12 ? c.year + 1 : c.year, month: c.month === 12 ? 1 : c.month + 1, day: 1 });
    if (inShortSeason(law, c.month)) total += Math.min(next, now) - t;
    t = next;
  }
  return total;
}

/** someone's short time: since when, its pauses of a month or more, and the bad-weather season in its pauses */
type ShortRecord = { from: number; paused?: number; seasonIdle?: number };

/** of a lost hour's wage cost on short time, the employer's share today: in the season, outside it, or all once the most months are over */
function shortTimeShare(read: ReadCtx, now: number, r: ShortRecord, employer: EntityId): number {
  const law = read.data('labourSettings').shortTime;
  if (!law) return 1;
  // (only a business gets it; the winter season's only a construction firm)
  const kind = read.get('Party', employer)?.kind ?? '';
  if (!law.eligible.includes(kind)) return 1;
  const seasonal = law.seasonalFor.includes(kind);
  const inSeason = seasonal && inShortSeason(law, read.calendar.at(now).month);
  // (the season's allowance is paid for the season whatever went before, and its time is not counted in the months:
  // law.seasonApart, § 104 Abs. 4 SGB III; Qwen S508 saw it so)
  if (inSeason && law.seasonApart) return law.seasonal.value;
  // (only the season's time on short time, when its allowance was drawn: a pause that falls in the season is a pause, and
  // is counted once, § 104 Abs. 2 and Abs. 4 Satz 2 SGB III; review x)
  const apart = seasonal && law.seasonApart ? Math.max(0, seasonTimeBetween(read, law, r.from, now) - (r.seasonIdle ?? 0)) : 0;
  // (a pause of a month or more lengthens the period, § 104 Abs. 2 SGB III)
  if (now - r.from - (r.paused ?? 0) - apart > law.maxMonths.value * 30.44 * DAY) return 1;
  return inSeason ? law.seasonal.value : law.remanence.value;
}

/** whether short time pays nothing any more for one on it (its months over; or no allowance for such an employer): sent home, they are paid in full */
const noAllowance = (read: ReadCtx, now: number, r: ShortRecord, employer: EntityId): boolean => shortTimeShare(read, now, r, employer) >= 1;

/** the first day a notice may end on from `t` (a day's start; the law's: after the 15th, after a month's end): Qwen S115 */
function noticeEnd(ctx: ReadCtx, t: number): number {
  const to = ctx.data('labourSettings').noticeTo;
  if (!to?.length) return t;
  for (let d = ctx.calendar.startOfDay(t) + (t > ctx.calendar.startOfDay(t) ? DAY : 0), i = 0; i < 40; d += DAY, i += 1) {
    const day = ctx.calendar.at(d + HOUR).day;
    if ((to.includes('15th') && day === 16) || (to.includes('monthEnd') && day === 1)) return d;
  }
  return t;
}

/** short time ended for someone (notice given): back at work from the next day */
function endShort(ctx: WriteCtx, person: EntityId): void {
  const short = ctx.state('workforce').shortTime ?? {};
  const tomorrow = ctx.calendar.startOfDay(ctx.now) + DAY;
  if (!short[person] || short[person]!.until <= tomorrow) return;
  // (from the next day: today is paid as a day of short time)
  ctx.patchState('workforce', { shortTime: { ...short, [person]: { ...short[person]!, until: tomorrow } } });
  const pr = ctx.get('Presence', person);
  if (pr?.status === 'shortTime') ctx.set('Presence', person, { ...pr, until: tomorrow });
  ctx.emit('workforce.absence', { person, kind: 'shortTime', until: tomorrow });
}

/** whether someone is on short time now: its days running, and no notice given (none is paid on short time under notice) */
function shortTimeOn(read: ReadCtx, person: EntityId, r: { from: number; until: number } | undefined, now: number): boolean {
  return Boolean(r) && r!.from <= now && now < r!.until && read.get('Employment', person)?.leavesAt === undefined;
}

/** employees on the payroll, and helpers who are here */
function memberAt(ctx: ReadCtx, id: EntityId, t: number): boolean {
  return employedAt(ctx.get('Employment', id), t) || helperHere(ctx.get('Helper', id), t);
}

function staffAt(ctx: ReadCtx, t: number, party?: EntityId): EntityId[] {
  const out: EntityId[] = [];
  for (const [id, e] of ctx.all('Employment')) if (employedAt(e, t) && (party === undefined || e.employer === party)) out.push(id);
  // a member who works for someone else (a job in town) works there on its shift and the way there and back, and is
  // one of the household's hands the rest of the day (the five friends: not at any hour); counted once for everyone
  for (const [id, h] of ctx.all('Helper')) {
    if (!helperHere(h, t) || (party !== undefined && h.of !== party)) continue;
    const e = ctx.get('Employment', id);
    if (!employedAt(e, t)) out.push(id);
    else if (party !== undefined && e!.employer !== party && !atJobElsewhere(ctx, id, t)) out.push(id);
  }
  return out;
}

/** one of a household at a job of someone else's at t: on its shift and on the way there and back, they are there, not here (until when) */
function jobElsewhere(ctx: ReadCtx, id: EntityId, t: number): number | undefined {
  const h = ctx.get('Helper', id);
  const e = ctx.get('Employment', id);
  if (!h || !e || e.employer === h.of || !employedAt(e, t) || absentAt(ctx.get('Presence', id), t)) return undefined;
  const w = shiftWindow(ctx, t, e.employer);
  if (!w) return undefined;
  const ways = ctx.contributions('commute').map((c) => c.impl(ctx, id)).filter((x): x is { out: number; back: number } => Boolean(x));
  const out = Math.max(0, ...ways.map((x) => x.out)) * HOUR;
  const back = Math.max(0, ...ways.map((x) => x.back)) * HOUR;
  return t >= w.start - out && t < w.end + back ? w.end + back : undefined;
}
const atJobElsewhere = (ctx: ReadCtx, id: EntityId, t: number): boolean => jobElsewhere(ctx, id, t) !== undefined;

// ------------------------------------------------------------------ where people are (design/physical-state.md I2)

/** how far off the network a walk to work may go (across a site, a field) */
const WALK_OFFROAD = 5000;
/** how far from where they are going commuters may leave their car and walk on (m) */
const PARK_WITHIN = 2000;
/** how long before a shift its commutes are planned (each sets out so as to be there at its start) */
const REPORT_LEAD = 3 * HOUR;
/** the hour someone going away (on leave, to a course, for good) sets out, when the day's reckoning sends them */
const LEAVE_HOUR = 6 * HOUR;

// ------------------------------------------------------------------ the word (design/physical-state.md I9, VISION 11)

/** the person a party acts through: the one it put in charge, else the first of its people (alive, still of it) */
function leadOf(read: ReadCtx, party: EntityId): EntityId | undefined {
  const set = read.state('workforce').leads?.[party];
  const ours = (p: EntityId) => !read.get('Person', p)?.died && (worksFor(read, p) === party || read.get('Helper', p)?.of === party) && read.get('Presence', p)?.status !== 'gone';
  if (set && ours(set)) return set;
  // (the same one all day: a member at a job in town is still the household's)
  const helpers = [...read.all('Helper')].filter(([id, h]) => h.of === party && helperHere(h, read.now) && ours(id)).map(([id]) => id);
  // (none of them here: a member living beyond the map still speaks for the household, by phone from there; else the
  // household had nobody to give the word but a command that moved one of them back unasked: Qwen S514)
  return [...new Set([...staffAt(read, read.now, party).filter(ours), ...helpers])].sort()[0] ?? membersOf(read, party)[0] ?? population(read, party)[0];
}

/**
 * A party's people now (one fact, decision 0028 rule 4; review x): alive and not gone for good, its household's members
 * wherever they live (a room in town, at their parents', in hospital), its staff and the helpers here now. Its word
 * goes out through them; a friend at home who helps now and then is not of it.
 */
function population(read: ReadCtx, party: EntityId): EntityId[] {
  const alive = (id: EntityId) => !read.get('Person', id)?.died && read.get('Presence', id)?.status !== 'gone';
  const members = [...read.all('Helper')].filter(([, h]) => h.of === party && h.relation === 'member').map(([id]) => id);
  return [...new Set([...members, ...staffAt(read, read.now, party)])].filter(alive).sort();
}

/** who is bound to come to a party and is not of it yet: a hire still to start, a helper whose stay is to come */
function bound(read: ReadCtx, party: EntityId): EntityId[] {
  const alive = (id: EntityId) => !read.get('Person', id)?.died && read.get('Presence', id)?.status !== 'gone';
  const out: EntityId[] = [];
  for (const [id, h] of read.all('Helper')) if (h.of === party && h.stay !== undefined && h.stay.from > read.now && alive(id)) out.push(id);
  for (const [id, e] of read.all('Employment')) if (e.employer === party && e.hiredAt > read.now && (e.leavesAt === undefined || e.leavesAt > e.hiredAt) && alive(id)) out.push(id);
  return out.sort();
}

/** a household's members, wherever they live now (a room in town too), its lead first: not friends who help or hands it hires */
function membersOf(read: ReadCtx, party: EntityId): EntityId[] {
  const lead = read.state('workforce').leads?.[party];
  const all = population(read, party).filter((id) => read.get('Helper', id)?.of === party && read.get('Helper', id)?.relation === 'member');
  return lead && all.includes(lead) ? [lead, ...all.filter((x) => x !== lead)] : all;
}

/** someone's age in whole years this calendar year (from their year of birth) */
const ageOf = (read: ReadCtx, id: EntityId): number => read.calendar.at(read.now).year - (read.get('Person', id)?.birthYear ?? read.calendar.at(read.now).year);

/**
 * What stands against one of a household looking for work for it now (one fact: workforce.seekWork, the household's
 * offers of it and the hire when an opening comes; robustness step 4): not a member (wherever they live now), employed
 * by the party itself, already working, or too young for a job (the practice's minWorkingAge: children are not taken on)
 */
function seekBlock(read: ReadCtx, party: EntityId, person: EntityId): { code: string; params: Record<string, string | number> } | null {
  const name = read.get('Person', person)?.name ?? person;
  if (read.get('Helper', person)?.of !== party && read.get('Employment', person)?.employer === party) return { code: 'workforce.employedHere', params: { person: name, party: partyLabel(read, party) } };
  if (!membersOf(read, party).includes(person)) return { code: 'workforce.notAMember', params: { person: name, party: partyLabel(read, party) } };
  if (read.get('Employment', person)) return { code: 'workforce.alreadyWorking', params: { person: name } };
  const min = read.data('labourSettings').minWorkingAge;
  if (min && ageOf(read, person) < min.value) return { code: 'workforce.tooYoung', params: { person: name, age: ageOf(read, person), min: min.value, rule: min.source?.title ?? 'the law of the place' } };
  return null;
}

/** who of a household may look for work now (the population of seekBlock): its members with no job, old enough for one */
function jobSeekersOf(read: ReadCtx, party: EntityId): EntityId[] {
  return membersOf(read, party).filter((id) => seekBlock(read, party, id) === null);
}

/**
 * The ways beyond the map that stop where a phone is charged (VISION 11): home and back, a job and back, a walk into
 * town; and any way that ends beyond the map (home, a lodging, a hospital). A walk to a shop, to meet a van or to tell
 * someone beyond the map stops at a counter or a roadside, by no socket: the phone runs on down (Qwen S511: one charged
 * in full by each errand never ran flat)
 */
const CHARGED_BEYOND = new Set(['report', 'to work', 'home from work', 'errand']);

/**
 * A phone plugged in for so many hours (one fact, decision 0028 rule 4: on the map from a power source by them, beyond
 * it wherever they stay by a socket): what it lacks, over what its charger keeps, as fast as the charger draws (review
 * x: a walk into town with no stay charged a flat phone in full). `kWh`: drawn from the source; `charge`: kept.
 */
function phoneCharge(read: ReadCtx, charge: number, hours: number): { kWh: number; charge: number } {
  const ways = read.data('labourSettings').ways;
  const lacks = ((1 - charge) * ways.phoneBattery.value) / ways.phoneCharging.value;
  const kWh = lacks > 1e-9 ? Math.min(lacks, ways.phoneCharger.value * Math.max(0, hours)) : 0;
  return { kWh, charge: Math.min(1, charge + (kWh * ways.phoneCharging.value) / ways.phoneBattery.value) };
}

/** the hours at a charger a phone this charged needs to be full (by `phoneCharge`'s rate) */
function hoursToCharge(read: ReadCtx, charge: number): number {
  const ways = read.data('labourSettings').ways;
  return ((1 - Math.min(1, charge)) * ways.phoneBattery.value) / ways.phoneCharging.value / ways.phoneCharger.value;
}

type PhoneRec = { charge: number; at: number; socket?: boolean };

/** a phone at time t from its record: at a socket from `at` until `left` (beyond the map), running down from then on */
function chargeAt(read: ReadCtx, ph: PhoneRec, t: number, left = t): number {
  const days = read.data('labourSettings').ways.phoneDays.value;
  const end = ph.socket ? Math.max(ph.at, Math.min(t, left)) : ph.at;
  const c = ph.socket ? phoneCharge(read, ph.charge, (end - ph.at) / HOUR).charge : ph.charge;
  return Math.max(0, Math.min(1, c - (t - end) / (days * DAY)));
}

/** what is left in a phone: charged by the hours at a socket (beyond the map, or from power by them), running down otherwise */
function phoneOf(read: ReadCtx, person: EntityId): number {
  if (!read.hasPort('moves')) return 1;
  const moves = read.port('moves');
  const ph = read.state('workforce').phones?.[person];
  // (none known: beyond the map since before they came to us, at home there; on it, never charged since they came)
  if (!ph) return moves.where(person) ? 0 : 1;
  // (set out again from where they charged it: on the way in)
  const on = ph.socket ? moves.placeOf(person)?.on : undefined;
  const mv = on !== undefined ? read.get('Move', on) : undefined;
  const left = mv?.legs.find((l) => l.fromNode !== undefined && l.depart >= ph.at && l.depart <= read.now)?.depart;
  return chargeAt(read, ph, read.now, left);
}

/**
 * Whether a word from a party reaches one of its people now: they are its lead, or within hearing of its lead, or both
 * have a phone with charge left; else why not, and whether walking over would do (both on the map).
 */
function tell(read: ReadCtx, party: EntityId, person: EntityId): { how: 'self' | 'hearing' | 'phone' } | { why: string; walk: boolean } {
  const lead = leadOf(read, party);
  if (!lead) return { why: 'nobody of ours to give the word', walk: false };
  if (lead === person) return { how: 'self' };
  if (!read.hasPort('moves')) return { how: 'hearing' };
  const moves = read.port('moves');
  const a = moves.where(lead);
  const b = moves.where(person);
  if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= read.data('labourSettings').ways.hearing.value) return { how: 'hearing' };
  const pa = phoneOf(read, lead);
  const pb = phoneOf(read, person);
  if (pa > 0 && pb > 0) return { how: 'phone' };
  const name = (p: EntityId) => read.get('Person', p)?.name ?? p;
  const flat = [...(pa <= 0 ? [name(lead)] : []), ...(pb <= 0 ? [name(person)] : [])];
  return { why: `${name(person)} is out of hearing of ${name(lead)}${flat.length ? `, and ${flat.join('’s and ')}’s phone is flat` : ''}`, walk: Boolean(a && b) };
}

/**
 * What would get the word to someone it does not reach now: the one in charge walks over (both on the map); one of ours
 * it reaches who could pass it on put in charge; or one of ours walks into town, from where it gets out (S4)
 */
function wordWays(read: ReadCtx, party: EntityId, person: EntityId, told: { why: string; walk: boolean }): Remedy[] {
  const name = (p: EntityId) => read.get('Person', p)?.name ?? p;
  if (told.walk) return [{ label: `Walk over to ${name(person)}`, command: { type: 'workforce.goTo', payload: { person } } }];
  const lead = leadOf(read, party);
  const others = population(read, party).filter((p) => p !== lead && p !== person);
  // (put in charge, they reach the person: within hearing, or both phones with charge)
  const relay = others.find((p) => {
    if ('why' in tell(read, party, p)) return false;
    const a = read.hasPort('moves') ? read.port('moves').where(p) : undefined;
    const b = read.hasPort('moves') ? read.port('moves').where(person) : undefined;
    return (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= read.data('labourSettings').ways.hearing.value) || (phoneOf(read, p) > 0 && phoneOf(read, person) > 0);
  });
  if (relay) return [{ label: `Put ${name(relay)} in charge: their word reaches ${name(person)}`, command: { type: 'workforce.setLead', payload: { person: relay } } }];
  return wordBlock(read, party)?.remedies ?? [];
}

/** someone's phone recorded: as it is now (`socket`: at a charger from now on), or as given (one put into the world with it charged) */
function phoneAt(ctx: WriteCtx, person: EntityId, rec: { socket: boolean } | PhoneRec): void {
  if (!ctx.hasPort('moves')) return;
  const ph: PhoneRec = 'charge' in rec ? rec : { charge: phoneOf(ctx, person), at: ctx.now, ...(rec.socket ? { socket: true } : {}) };
  ctx.setState('workforce', { ...ctx.state('workforce'), phones: { ...(ctx.state('workforce').phones ?? {}), [person]: ph } });
}

/**
 * What someone's phone draws from a power source by them over so many hours (design/physical-state.md 8g, Qwen S512):
 * plugged in wherever there is power within reach (a power station, a running generator), at whatever hour they are
 * there; what it lacks, over what its charger keeps, as fast as the charger draws. The source finds the people by it
 * (decision 0025: per source, its party's people within its reach)
 */
function phoneDraw(read: ReadCtx, person: EntityId, hours: number): number {
  if (!read.hasPort('moves') || read.get('Person', person)?.died) return 0;
  const moves = read.port('moves');
  if (!moves.where(person) || moves.placeOf(person)?.on !== undefined) return 0;
  return phoneCharge(read, phoneOf(read, person), hours).kWh;
}

/** the first answer of the modules that know: a party's base, someone's home, someone's post */
function firstOf(read: ReadCtx, name: 'base' | 'home' | 'post', arg: EntityId): Vec2 | undefined {
  for (const c of read.contributions(name)) {
    const v = c.impl(read, arg);
    if (v) return v;
  }
  return undefined;
}

/** the party someone works for here: their employer on the map, else the household they are of */
function partyHere(read: ReadCtx, id: EntityId): EntityId | undefined {
  const e = read.get('Employment', id);
  return e && read.get('Party', e.employer) ? e.employer : (read.get('Helper', id)?.of ?? e?.employer);
}

/** where someone is to be; `loose`: only for one not on the map yet (on shift without a post: one here stays where they are) */
type Wanted = { at: Vec2; why: string; loose?: boolean } | { beyond: true; why: string };

/**
 * Where someone belongs at t: on their shift at their post (the work they are put to) or else their party's base;
 * off it at home (beyond the map, if that is where they live); ill or on leave at home; away, on a course or gone
 * beyond the map. Undefined: nobody to send (dead, unknown), or a job beyond the map, which the household's morning
 * sends them to by their own way.
 */
function wanted(read: ReadCtx, id: EntityId, t: number): Wanted | undefined {
  const pr = read.get('Presence', id);
  if (!pr || read.get('Person', id)?.died) return undefined;
  if (atJobElsewhere(read, id, t)) return undefined;
  const home = firstOf(read, 'home', id);
  const off = (why: string): Wanted => (home ? { at: home, why } : { beyond: true, why });
  if (pr.status === 'gone') return { beyond: true, why: 'gone' };
  if ((pr.status === 'away' || pr.status === 'training') && absentAt(pr, t)) return { beyond: true, why: pr.status === 'training' ? 'to the course' : 'away' };
  if (absentAt(pr, t)) return off(pr.status === 'sick' ? 'home ill' : 'home');
  if (!memberAt(read, id, t)) return off('home');
  const party = partyHere(read, id);
  const w = party ? shiftWindow(read, t, party) : null;
  if (w && t >= w.start && t < w.end) {
    const post = firstOf(read, 'post', id);
    if (post) return { at: post, why: 'to work' };
    const at = (party ? firstOf(read, 'base', party) : undefined) ?? home;
    return at ? { at, why: 'to work', loose: true } : undefined;
  }
  // (one of the household with no home of their own on the map stays at the base; a helper here for a stay who does not
  // live with us goes home off shift, beyond the map, as one who comes in to work does: design/realism-plan.md S1, A3)
  const h = read.get('Helper', id);
  if (!home && h && h.resident) {
    const base = firstOf(read, 'base', h.of);
    if (base) return { at: base, why: 'back to where they stay' };
  }
  return off('home');
}

/**
 * Send someone where they belong (by `by`: there by then, setting out in time): on foot on the map, by their own
 * way from beyond it (the commute profile); nobody moves but by a move. Someone on a move already is left to it.
 */
function report(ctx: WriteCtx, id: EntityId, by = ctx.now): void {
  if (!ctx.hasPort('moves')) return;
  // (no way to where one of ours was to be ends when they are no longer ours: the employment over, the stay or the life
  // ended; decision 0028, what depends on something ends with it. Where they are to go now is asked afresh below)
  if (ctx.state('workforce').noWay?.[id] && !memberAt(ctx, id, ctx.now)) wayFound(ctx, id);
  // (held for a purpose of another: they stay; the hold's end sends them, decision 0028)
  if (engagedNow(ctx, id)) return;
  const place = ctx.port('moves').placeOf(id);
  if (place?.on !== undefined) return;
  const want = wanted(ctx, id, by);
  // (not in the world yet: the world being made puts them where they belong, once that is known; else they come in
  // from beyond the map)
  if (!place) {
    const ext = ctx.port('routing').externalNodes()[0];
    if (want && 'at' in want && (ctx.setup || ctx.trusted)) {
      ctx.command('moves.place', { unit: id, at: [want.at[0], want.at[1]] });
      phoneAt(ctx, id, { charge: 1, at: ctx.now });
    } else if (!(ctx.setup || ctx.trusted) && ext !== undefined) {
      ctx.command('moves.place', { unit: id, beyond: ext });
      report(ctx, id, by);
    }
    return;
  }
  if (!want) return;
  const ways = ctx.data('labourSettings').ways;
  // (going away, not to work: in the morning, not in the night the day's reckoning finds it)
  const morning = Math.max(ctx.now, ctx.calendar.startOfDay(ctx.now) + LEAVE_HOUR);
  let way: Way | undefined;
  let tried: string[] = [];
  if ('beyond' in want) {
    if (place.beyond !== undefined || !place.at) return;
    // (out: each way tried by its dispatch, the first that goes is taken; they leave when it is time)
    if (morning > ctx.now + 60 && want.why !== 'home') {
      ctx.at(morning, 'reportAt', { person: id, by: morning });
      return;
    }
    const tried2: string[] = [];
    for (const w of waysOut(ctx, id, place.at)) {
      const r = ctx.command('moves.dispatch', { legs: w.legs, purpose: 'report', ref: id, requester: WORKFORCE_MODULE_ID, departAt: ctx.now });
      if (r.ok) return wayFound(ctx, id, want.why);
      tried2.push(`${w.label}: ${r.reasons.map((b) => ctx.formatBlocker(b)).join('; ')}`);
    }
    return noWay(ctx, id, want.why, tried2);
  } else if (place.beyond !== undefined) ({ way, tried } = firstWay(ctx, waysIn(ctx, id, place.beyond, want.at)));
  else {
    const at = place.at!;
    if (want.loose || Math.hypot(at[0] - want.at[0], at[1] - want.at[1]) <= ways.reach.value) return wayFound(ctx, id, want.why);
    ({ way, tried } = firstWay(ctx, [{ label: 'on foot', legs: () => { const r = ctx.port('routing').route(at, want.at, ways.walk, { maxOffroad: WALK_OFFROAD, unit: id }); return r ? { legs: [walkLeg(ctx, id, at, want.at)], seconds: r.duration } : r === null ? 'no way on foot' : undefined; } }]));
  }
  if (!way) return noWay(ctx, id, want.why, tried);
  // they set out when they must, and are free until then (r36: not taken up hours before by the walk to come)
  const leave = way.seconds !== undefined && by > ctx.now ? by - way.seconds : ctx.now;
  if (leave > ctx.now + 60) {
    ctx.at(leave, 'reportAt', { person: id, by: Math.max(by, leave) });
    return;
  }
  const r = ctx.command('moves.dispatch', { legs: way.legs, purpose: 'report', ref: id, requester: WORKFORCE_MODULE_ID, departAt: Math.max(ctx.now, leave) });
  if (!r.ok) return noWay(ctx, id, want.why, [...tried, `${way.label}: ${r.reasons.map((b) => ctx.formatBlocker(b)).join('; ')}`]);
  wayFound(ctx, id, want.why);
}

/** a way someone goes, as the legs of one move, and how long it takes (when the router knows) */
type Way = { label: string; legs: LegRequest[]; seconds?: number };
/**
 * One rung of the ladder of means (robustness plan, step 3): its legs and time if it goes; why not if it does not
 * (a reason), or undefined if it does not apply here.
 */
type Rung = { label: string; legs: () => { legs: LegRequest[]; seconds: number } | string | undefined };

/** the first rung that goes, and why each one before it did not */
function firstWay(ctx: ReadCtx, rungs: Rung[]): { way?: Way; tried: string[] } {
  const tried: string[] = [];
  for (const r of rungs) {
    const got = r.legs();
    if (got === undefined) continue;
    if (typeof got === 'string') tried.push(`${r.label}: ${got}`);
    else return { way: { label: r.label, ...got }, tried };
  }
  return { tried };
}

const carLeg = (ctx: ReadCtx, id: EntityId, q: Vec2): LegRequest => ({ carrier: { class: ctx.data('labourSettings').ways.commute }, from: [q[0], q[1]], to: [q[0], q[1]], loads: [{ person: id }], maxOffroad: WALK_OFFROAD });
const walkLeg = (ctx: ReadCtx, id: EntityId, a: Vec2, b: Vec2): LegRequest => ({ carrier: { class: ctx.data('labourSettings').ways.walk, unit: id }, from: [a[0], a[1]], to: [b[0], b[1]], maxOffroad: WALK_OFFROAD });
const sum = (...rs: ({ duration: number } | null)[]) => (rs.every((r) => r) ? rs.reduce((a, r) => a + r!.duration, 0) : null);

/**
 * The ways in from beyond the map to `to`, in the order one tries them: by car all the way; by car as near as it gets
 * and on foot from there (it does not ford a creek a person wades through); dropped by car at the way in and on foot
 * from there; on foot all the way, the way beyond the map too (a footpath over the hill: Qwen S502/S506, no car comes
 * in at all).
 */
function waysIn(ctx: ReadCtx, id: EntityId, node: EntityId, to: Vec2): Rung[] {
  const ways = ctx.data('labourSettings').ways;
  const routing = ctx.port('routing');
  const opts = { maxOffroad: WALK_OFFROAD };
  const gate = ctx.get('NetNode', node)?.pos;
  return [
    { label: 'by car', legs: () => { const r = routing.routeFromExternal(node, to, ways.commute, opts); return r ? { legs: [{ ...carLeg(ctx, id, to), externalNode: node }], seconds: r.duration } : 'no way for a car all the way'; } },
    { label: 'by car as near as it gets, and on foot from there', legs: () => {
      const park = parkingFor(ctx, node, to, 'in');
      if (!park) return undefined;
      const t = sum(routing.routeFromExternal(node, park, ways.commute, opts), routing.route(park, to, ways.walk, { ...opts, unit: id }));
      return t !== null ? { legs: [{ ...carLeg(ctx, id, park), externalNode: node }, walkLeg(ctx, id, park, to)], seconds: t } : 'no way on foot from where a car can stop';
    } },
    { label: 'by car to the way in, and on foot from there', legs: () => {
      if (!gate) return undefined;
      const t = sum(routing.routeFromExternal(node, [gate[0], gate[1]], ways.commute, opts), routing.route([gate[0], gate[1]], to, ways.walk, { ...opts, unit: id }));
      return t !== null ? { legs: [{ ...carLeg(ctx, id, [gate[0], gate[1]]), externalNode: node }, walkLeg(ctx, id, [gate[0], gate[1]], to)], seconds: t } : 'no car comes to the way in';
    } },
    { label: 'on foot all the way', legs: () => { const r = routing.routeFromExternal(node, to, ways.walk, { ...opts, unit: id }); return r ? { legs: [{ ...walkLeg(ctx, id, to, to), externalNode: node }], seconds: r.duration } : 'no way on foot either'; } },
  ];
}

/**
 * The ways out from `from` to beyond the map, in the same order (S417: on foot to the way in, picked up there): their
 * legs only; the move's own dispatch finds whether each goes (the way out needs no time ahead: they leave when it is time)
 */
function waysOut(ctx: ReadCtx, id: EntityId, from: Vec2): { label: string; legs: LegRequest[] }[] {
  const ways = ctx.data('labourSettings').ways;
  const ext = ctx.port('routing').externalNodes()[0];
  if (ext === undefined) return [];
  const gate = ctx.get('NetNode', ext)?.pos;
  const park = parkingFor(ctx, ext, from, 'out');
  return [
    { label: 'by car', legs: [{ ...carLeg(ctx, id, from), externalDestination: ext }] },
    ...(park && Math.hypot(park[0] - from[0], park[1] - from[1]) > ways.reach.value ? [{ label: 'they walk to where a car can stop, and drive from there', legs: [walkLeg(ctx, id, from, park), { ...carLeg(ctx, id, park), externalDestination: ext }] }] : []),
    ...(gate ? [{ label: 'they walk out to the way in, to be picked up there', legs: [walkLeg(ctx, id, from, [gate[0], gate[1]]), { ...carLeg(ctx, id, [gate[0], gate[1]]), externalDestination: ext }] }] : []),
    { label: 'on foot', legs: [{ ...walkLeg(ctx, id, from, from), externalDestination: ext }] },
  ];
}

/**
 * No way at all where someone is to be: they do not get there. Said once as a blocker on them (with what would give
 * them a way), not every hour as a warning (Qwen S502/S506: 126× "cannot get to work"); a day they cannot get to
 * work is no work and no wage (the way to work is the employee's risk, Wegerisiko: BAG 8.9.1982, 5 AZR 283/80).
 */
function noWay(ctx: WriteCtx, id: EntityId, why: string, tried: string[]): void {
  const st = ctx.state('workforce');
  const was = st.noWay?.[id];
  const text = tried.join('; ') || 'no way out of the map';
  // (a day they find no way to work is that day's record: its payroll reads it, review x)
  const notCome = why === 'to work' ? { notCome: { ...(st.notCome ?? {}), [id]: ctx.calendar.startOfDay(ctx.now) } } : {};
  ctx.setState('workforce', { ...st, noWay: { ...(st.noWay ?? {}), [id]: { since: was?.since ?? ctx.now, why, tried: text } }, ...notCome });
  noWayBlocker(ctx, id);
}

/**
 * The blocker of one with no way, from its record, with what would give them one, each a command that would be accepted
 * now (decision 0028: set again when what it offers changes, e.g. once notice is given)
 */
function noWayBlocker(ctx: WriteCtx, id: EntityId): void {
  const nw = ctx.state('workforce').noWay?.[id];
  if (!nw) return;
  const party = partyHere(ctx, id);
  const base = party ? baseStoreOf(ctx, party) : undefined;
  const remedies: Remedy[] = [
    ...(base && nw.why === 'to work' ? [{ label: `Let them live at ${ctx.port('holdings').label(base) ?? base}`, command: { type: 'living.moveIn', payload: { person: id, store: base } } }] : []),
    ...(party && !noticeBlock(ctx, id, party) ? [{ label: 'Give them notice', command: { type: 'workforce.dismiss', payload: { person: id } } }] : []),
  ];
  ctx.blockers.set(id, [{ code: 'workforce.noWay', severity: 'block', params: { person: ctx.get('Person', id)?.name ?? id, where: nw.why, tried: nw.tried ?? 'no way out of the map' }, remedies }]);
}

/** what stands against a party giving someone notice now (one fact: workforce.dismiss and the remedies that offer it) */
function noticeBlock(read: ReadCtx, person: EntityId, party: EntityId): { code: string; params: Record<string, string> } | null {
  const e = read.get('Employment', person);
  const name = read.get('Person', person)?.name ?? person;
  if (!e) return { code: 'workforce.unknownPerson', params: { person } };
  if (worksFor(read, person) !== party) return { code: 'workforce.notOurs', params: { person: name, party: partyLabel(read, party) } };
  if (e.leavesAt !== undefined) return { code: 'workforce.notEmployed', params: { person } };
  return null;
}

/** the store at a party's base (its camp, its yard): where one of its people would live */
function baseStoreOf(ctx: ReadCtx, party: EntityId): EntityId | undefined {
  const at = firstOf(ctx, 'base', party);
  return at && ctx.hasPort('holdings') ? ctx.port('holdings').ofParty(party, { kept: true, general: true, near: at })[0] : undefined;
}

/** the hold on someone now (decision 0028), if it has not ended */
function engagedNow(read: ReadCtx, id: EntityId): Readonly<Engaged> | undefined {
  const e = read.get('Engaged', id);
  return e && e.until > read.now ? e : undefined;
}

/**
 * What keeps `by` (a module, acting for `party`) from sending someone anywhere now (decision 0028, one owner of a
 * person's time): a hold of another module, with what would free them; nothing when they are free for it, held by `by`
 * itself, or held at the party's own word (the one in charge staying by someone they told), which its next command
 * takes over. The one function every command that moves a person asks (errands, the walk over to someone, a hold).
 */
function heldFrom(read: ReadCtx, id: EntityId, by: string, party?: EntityId): { code: string; params: Record<string, string>; remedies: Remedy[] } | undefined {
  const held = engagedNow(read, id);
  if (!held || held.by === by || (party !== undefined && held.party === party)) return undefined;
  const until = read.calendar.format(held.until);
  return { code: 'workforce.engaged', params: { person: read.get('Person', id)?.name ?? id, purpose: held.purpose, until }, remedies: [{ label: `Wait until ${read.get('Person', id)?.name ?? id} is free (${held.purpose}, at the latest ${until})`, wait: { until: held.until } }] };
}

/**
 * Hold someone where they are for a purpose (decision 0028): refused when another holds them (heldFrom); the same module
 * holds them again for longer. The hold ends at `until` by itself (every hold ends), or when its module releases it.
 * `party`: held at that party's own word, which its next command takes over.
 */
function engage(ctx: WriteCtx, id: EntityId, by: string, purpose: string, ref: string | undefined, until: number, party?: EntityId): boolean {
  if (heldFrom(ctx, id, by, party)) return false;
  const was = ctx.get('Engaged', id);
  if (was?.timer !== undefined) ctx.cancel(was.timer);
  const timer = ctx.at(until, 'holdEnds', { person: id, until });
  ctx.set('Engaged', id, { by, ...(party !== undefined ? { party } : {}), purpose, ...(ref !== undefined ? { ref } : {}), since: ctx.now, until, timer });
  return true;
}

/**
 * `by` (a module, for `party`) takes someone's time to send them somewhere now: refused while another holds them
 * (heldFrom); a hold at the party's own word ends with it (they go where the new word sends them, not back to it)
 */
function take(ctx: WriteCtx, id: EntityId, by: string, party?: EntityId): void {
  const no = heldFrom(ctx, id, by, party);
  if (no) ctx.reject(no.code, no.params, no.remedies);
  const e = ctx.get('Engaged', id);
  if (e && e.by !== by && party !== undefined && e.party === party) {
    if (e.timer !== undefined) ctx.cancel(e.timer);
    ctx.remove('Engaged', id);
  }
}

/** a hold let go (by its module, or at its end): they go where they belong now */
function release(ctx: WriteCtx, id: EntityId, by?: string, ref?: string): void {
  const e = ctx.get('Engaged', id);
  if (!e || (by !== undefined && e.by !== by) || (ref !== undefined && e.ref !== ref)) return;
  if (e.timer !== undefined) ctx.cancel(e.timer);
  ctx.remove('Engaged', id);
  if (ctx.port('moves').placeOf(id)?.on === undefined) report(ctx, id);
}

/**
 * A way found again (to where they are to be, `to`: on the way to work, they come today after all), or what it was
 * about ended: the blocker is gone
 */
function wayFound(ctx: WriteCtx, id: EntityId, to?: string): void {
  const st = ctx.state('workforce');
  if (to === 'to work' && st.notCome?.[id] !== undefined) {
    const { [id]: _day, ...left } = st.notCome;
    ctx.patchState('workforce', { notCome: left });
  }
  if (!st.noWay?.[id]) return;
  const { [id]: _was, ...rest } = st.noWay;
  ctx.patchState('workforce', { noWay: rest });
  ctx.blockers.clear(id);
}

/**
 * Where a car coming in by a way (or going out by it) gets nearest to a point it cannot reach itself: back along the line
 * towards the way in, in steps, the first point it can drive to (or from); undefined if it reaches the point itself.
 */
function parkingFor(ctx: ReadCtx, node: EntityId, at: Vec2, dir: 'in' | 'out'): Vec2 | undefined {
  const ways = ctx.data('labourSettings').ways;
  const q = ctx.port('routing').approach(node, at, ways.commute, PARK_WITHIN, ways.walk, dir, { maxOffroad: WALK_OFFROAD });
  return q && (q[0] !== at[0] || q[1] !== at[1]) ? q : undefined;
}

/**
 * Someone comes into the world: when it is made (or a test harness makes it), at their party's base, or where they
 * will live once that is known (their first report); otherwise beyond the map at the way in, to come by a move.
 */
function placeNew(ctx: WriteCtx, id: EntityId, party: EntityId, here: boolean): void {
  if (!ctx.hasPort('moves')) return;
  const making = ctx.setup || ctx.trusted;
  const at = here && making ? firstOf(ctx, 'base', party) : undefined;
  const ext = ctx.port('routing').externalNodes()[0];
  if (at) {
    ctx.command('moves.place', { unit: id, at: [at[0], at[1]] });
    phoneAt(ctx, id, { charge: 1, at: ctx.now });
  } else if (here && making) return;
  else if (ext !== undefined) ctx.command('moves.place', { unit: id, beyond: ext });
}

/** each party's working day: its people sent to work for its start, and home at its end */
function planShifts(ctx: WriteCtx): void {
  const day = ctx.calendar.startOfDay(ctx.now);
  const parties = new Set<EntityId>();
  for (const id of staffAt(ctx, day + DAY - 1)) {
    const p = partyHere(ctx, id);
    if (p) parties.add(p);
  }
  for (const party of [...parties].sort()) {
    const w = shiftWindow(ctx, day, party);
    if (!w || w.end <= ctx.now) continue;
    ctx.at(Math.max(ctx.now, w.start - REPORT_LEAD), 'report', { party, by: w.start });
    ctx.at(w.end, 'report', { party, by: w.end });
  }
}

/** employees by their employer (sorted, for a stable order) */
function byEmployerOf(ctx: ReadCtx, employees: EntityId[]): Map<EntityId, EntityId[]> {
  const out = new Map<EntityId, EntityId[]>();
  for (const id of employees) {
    const e = ctx.require('Employment', id).employer;
    out.set(e, [...(out.get(e) ?? []), id]);
  }
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** the party someone works for (their employer, or whom they help) */
const worksFor = (ctx: ReadCtx, person: EntityId): EntityId | undefined => ctx.get('Employment', person)?.employer ?? ctx.get('Helper', person)?.of;

/** the acting party may only act on its own employees and helpers */
/**
 * The administrator's staff (insolvency proceedings opened): no one more is taken on (open vacancies withdrawn,
 * hires not yet begun called off), and everyone is given notice, the law's or at most its cap (§ 113 InsO),
 * a longer notice given before cut to it.
 */
function windUpStaff(ctx: WriteCtx, party: EntityId): void {
  const legal = ctx.data('labourSettings').dismissalNotice.value;
  const cap = ctx.hasData('insolvencyLaw') ? (ctx.data('insolvencyLaw')?.maxNotice.value ?? legal) : legal;
  for (const [id, v] of [...ctx.all('Vacancy')]) if (v.employer === party && v.status === 'open') ctx.set('Vacancy', id, { ...v, status: 'withdrawn', closedAt: ctx.now });
  for (const [id, e] of [...ctx.all('Employment')]) {
    if (e.employer !== party) continue;
    const latest = noticeEnd(ctx, ctx.calendar.startOfDay(ctx.now) + Math.ceil(Math.min(legal, cap)) * DAY);
    // not begun yet: the hire is called off (leaves the day it would have begun)
    const leavesAt = e.hiredAt > ctx.now ? e.hiredAt : Math.max(ctx.now, Math.min(e.leavesAt ?? Infinity, latest));
    if (e.leavesAt !== undefined && e.leavesAt <= leavesAt) continue;
    ctx.patch('Employment', id, { leavesAt });
    endShort(ctx, id);
    ctx.at(leavesAt, 'leave', { person: id });
    ctx.log('warn', e.hiredAt > ctx.now ? `${ctx.require('Person', id).name}: the hire is called off by the administrator.` : `${ctx.require('Person', id).name} is given notice by the administrator; leaves ${ctx.calendar.format(leavesAt)}.`, [id]);
  }
}

function mustBeOurs(ctx: WriteCtx, person: EntityId): void {
  const party = actorOf(ctx);
  if (worksFor(ctx, person) !== party) ctx.reject('workforce.notOurs', { person: ctx.get('Person', person)?.name ?? person, party: partyLabel(ctx, party) });
}

/** what else bears on how fast someone works today (their needs …), from the modules that know */
function capacity(read: ReadCtx, person: EntityId): { factor: number; explain: Explained }[] {
  const out: { factor: number; explain: Explained }[] = [];
  for (const c of read.contributions('workCapacity')) {
    const f = c.impl(read, person);
    if (f && f.factor !== 1) out.push(f);
  }
  return out;
}

function nextShiftStart(ctx: ReadCtx, t: number, party?: EntityId): number {
  let day = ctx.calendar.startOfDay(t);
  for (let i = 0; i < 800; i += 1) {
    const w = shiftWindow(ctx, day, party);
    if (w && w.start >= t) return w.start;
    day += DAY;
  }
  return Number.POSITIVE_INFINITY;
}

/** working days in [from, until), by calendar year */
function workdaysByYear(ctx: ReadCtx, from: number, until: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let d = ctx.calendar.startOfDay(from); d < until; d += DAY) {
    if (!isWorkday(ctx, d)) continue;
    const y = String(ctx.calendar.at(d).year);
    out[y] = (out[y] ?? 0) + 1;
  }
  return out;
}

/** the most working days a year someone can help: their own lives (the law on unpaid help is a matter of legality, not of time) */
function helpCap(_ctx: ReadCtx, h: Readonly<Helper>): number {
  return h.daysPerYear;
}

/** the law on unpaid help for a business: the days a year a relation may help a business unpaid (none for helping a household) */
function unpaidHelpLaw(ctx: ReadCtx, h: Pick<Helper, 'of' | 'relation'>) {
  if (scheduleOf(ctx, h.of) === 'own') return undefined;
  return ctx.data('labourSettings').unpaidHelpDaysPerYear[h.relation];
}

const helpDaysLeftIn = (ctx: ReadCtx, h: Readonly<Helper>, year: number): number => Math.max(0, Math.floor(helpCap(ctx, h) - (h.booked[String(year)] ?? 0)));

const coursesData = (ctx: ReadCtx) => ({ courses: ctx.hasData('courses') ? (ctx.data('courses') ?? {}) : {}, offers: ctx.hasData('courseOffers') ? (ctx.data('courseOffers') ?? {}) : {} });

/** a course's dates if enrolled at t: the next course after the lead time, then its working days away */
function courseDates(ctx: ReadCtx, courseId: string, t: number): { from: number; until: number } {
  const { courses, offers } = coursesData(ctx);
  const from = ctx.calendar.startOfDay(nextShiftStart(ctx, ctx.calendar.startOfDay(t) + Math.ceil(offers[courseId]!.leadTime.value) * DAY));
  return { from, until: afterWorkdays(ctx, from, courses[courseId]!.workdays.value) };
}

/** what stands against enrolling someone in a course now */
function enrolBlocker(ctx: ReadCtx, person: EntityId, courseId: string): { code: string; params: Record<string, string | number> } | null {
  const { courses, offers } = coursesData(ctx);
  const course = courses[courseId];
  if (!course || !offers[courseId]) return { code: 'workforce.unknownCourse', params: { course: courseId, courses: Object.keys(courses).filter((k) => offers[k]).join(', ') || 'none here' } };
  const p = ctx.get('Person', person);
  if (!p || !memberAt(ctx, person, ctx.now)) return { code: 'workforce.notHere', params: { person: p?.name ?? person } };
  const name = p.name;
  const pres = ctx.get('Presence', person);
  if (!pres || pres.status === 'training' || pres.status === 'gone') return { code: 'workforce.notFree', params: { person: name, status: pres?.status ?? 'gone' } };
  const pending = ctx.get('Enrolment', person);
  if (pending) return { code: 'workforce.alreadyEnrolled', params: { person: name, course: courses[pending.course]?.label ?? pending.course, from: ctx.calendar.format(pending.from, 'date') } };
  if (course.grants.every((q) => p.certificates.includes(q))) return { code: 'workforce.alreadyCertified', params: { person: name, course: course.label } };
  const { from, until } = courseDates(ctx, courseId, ctx.now);
  const fmt = (t: number) => ctx.calendar.format(t, 'date');
  const e = ctx.get('Employment', person);
  if (e?.leavesAt !== undefined && e.leavesAt < until) return { code: 'workforce.leavesBeforeCourse', params: { person: name, leaves: fmt(e.leavesAt), courseUntil: fmt(until) } };
  // a helper attends while staying with you
  const h = ctx.get('Helper', person);
  if (h && !h.resident && (!h.stay || until > h.stay.until)) return { code: 'workforce.courseOutlastsStay', params: { person: name, stayUntil: h.stay ? fmt(h.stay.until) : 'now', courseUntil: fmt(until) } };
  // already away then: sick past the start, or a holiday planned during it
  // (on short time one is free to train)
  if (pres.status !== 'shortTime' && absentAt(pres, from)) return { code: 'workforce.awayForCourse', params: { person: name, status: pres.status, from: fmt(from) } };
  for (const b of ctx.state('workforce').vacationPlan[person] ?? []) {
    if (b.start < until && afterWorkdays(ctx, b.start, b.days) > from) return { code: 'workforce.awayForCourse', params: { person: name, status: 'vacation planned', from: fmt(from) } };
  }
  return null;
}

function workforcePort(ctx: ReadCtx): WorkforcePort {
  const curve = (person: EntityId, q: string): number => {
    const p = ctx.get('Person', person);
    if (!p) return 0;
    const l = ctx.data('labourSettings').learning;
    return learningSpeed(p.experience[q] ?? 0, 1, { rate: l.rate.value, expertHours: l.expertHours.value, firstHours: l.firstHours.value });
  };
  const port: WorkforcePort = {
    shiftWindow: (t, party) => shiftWindow(ctx, t, party),
    onShift: (t, party) => {
      const w = shiftWindow(ctx, t, party);
      return w !== null && t >= w.start && t < w.end;
    },
    nextShiftStart: (t, party) => nextShiftStart(ctx, t, party),
    holiday: (t) => holidayOn(ctx, t, ctx.data('labourSettings').holidays),
    scheduleOf: (party) => scheduleOf(ctx, party),
    available: (person, t) => memberAt(ctx, person, t) && !absentAt(ctx.get('Presence', person), t) && port.onShift(t, worksFor(ctx, person)) && !atJobElsewhere(ctx, person, t),
    present: (person) => memberAt(ctx, person, ctx.now) && !absentAt(ctx.get('Presence', person), ctx.now) && !atJobElsewhere(ctx, person, ctx.now),
    elsewhere: (person, t) => atJobElsewhere(ctx, person, t),
    backAt: (person) => {
      const p = ctx.get('Presence', person);
      const away = jobElsewhere(ctx, person, ctx.now);
      const ill = p && absentAt(p, ctx.now) ? p.until : undefined;
      return away !== undefined && ill !== undefined ? Math.max(away, ill) : (away ?? ill);
    },
    canDo: (person, q) => {
      const p = ctx.get('Person', person);
      const qual = ctx.data('qualifications')[q];
      if (!p || !qual) return false;
      // ability is practice: a certificate brings it; the law is a separate question (licensed)
      return qual.open === true || p.certificates.includes(q) || (p.experience[q] ?? 0) >= ctx.data('labourSettings').learning.firstHours.value;
    },
    licensed: (person, q) => !ctx.data('qualifications')[q]?.certificate || Boolean(ctx.get('Person', person)?.certificates.includes(q)),
    skills: (person) => Object.keys(ctx.data('qualifications')).filter((q) => port.canDo(person, q)),
    level: (person, q) => curve(person, q),
    speed: (person, q) => {
      const p = ctx.get('Person', person);
      if (!p) return 0;
      const l = ctx.data('labourSettings').learning;
      return learningSpeed(p.experience[q] ?? 0, p.aptitude, { rate: l.rate.value, expertHours: l.expertHours.value, firstHours: l.firstHours.value }) * capacity(ctx, person).reduce((a, c) => a * c.factor, 1);
    },
    speedExplain: (person, q) => {
      const p = ctx.get('Person', person);
      const l = ctx.data('labourSettings').learning;
      const hours = p?.experience[q] ?? 0;
      const curve = Math.min(1, (Math.max(hours, l.firstHours.value) / l.expertHours.value) ** -Math.log2(l.rate.value));
      return ex.mul(`speed at ${ctx.data('qualifications')[q]?.label ?? q} (relative to an expert)`, '1', ex.value(p?.aptitude ?? 0, '1', 'aptitude (personal knack)'), ex.min('learning curve', '1', ex.value(1, '1', 'expert'), ex.value(curve, '1', `${Math.round(hours)} h of practice on a learning curve (rate ${l.rate.value}, expert at ${l.expertHours.value} h)`, l.rate.source)), ...capacity(ctx, person).map((c) => c.explain));
    },
    staff: (party) => staffAt(ctx, ctx.now, party),
    // (one of a household with a job elsewhere: theirs while not at it)
    worksFor: (person) => {
      const h = ctx.get('Helper', person);
      const e = ctx.get('Employment', person);
      return h && e && e.employer !== h.of && helperHere(h, ctx.now) && !atJobElsewhere(ctx, person, ctx.now) ? h.of : worksFor(ctx, person);
    },
    name: (person) => ctx.get('Person', person)?.name ?? person,
    hiresStarting: (job, employer) => {
      const out: number[] = [];
      // a pending hire who was let go before starting (leavesAt ≤ hiredAt) is not coming
      for (const [, e] of ctx.all('Employment')) if (e.job === job && (employer === undefined || e.employer === employer) && e.hiredAt > ctx.now && (e.leavesAt === undefined || e.leavesAt > e.hiredAt)) out.push(e.hiredAt);
      return out.sort((a, b) => a - b);
    },
    employed: (person, t) => employedAt(ctx.get('Employment', person), t),
    job: (id) => {
      const j = ctx.data('jobs')[id];
      if (!j) throw new Error(`Unknown job ${id}`);
      return j;
    },
    qualification: (id) => {
      const q = ctx.data('qualifications')[id];
      if (!q) throw new Error(`Unknown qualification ${id}`);
      return q;
    },
    hourlyCost: (person) => {
      const e = ctx.get('Employment', person);
      return e ? e.hourlyWage * (1 + ctx.data('labourSettings').employerSurcharge.value) : 0;
    },
    hourlyCostExplain: (person) => hourlyCostExplain(ctx, person),
    openVacancies: (job, employer) => openVacancies(ctx, job, employer),
    expectedStartDays: (jobId, queued) => {
      const job = ctx.data('jobs')[jobId];
      if (!job) return Infinity;
      const n = (queued ?? openVacancies(ctx, jobId).length) + 1;
      return n * applicantInterval(ctx, jobId) + job.market.noticePeriod.value;
    },
    helpersFor: (q, party) => {
      const out: HelperOffer[] = [];
      for (const [id, h] of ctx.all('Helper')) {
        if (h.of !== party || h.resident || (h.stay && h.stay.until > ctx.now) || !port.canDo(id, q)) continue;
        const arrives = arrivalIfAsked(ctx, h);
        const days = helpDaysLeftIn(ctx, h, ctx.calendar.at(arrives).year);
        if (days < 1) continue;
        out.push({ person: id, name: ctx.require('Person', id).name, days, arrives, level: curve(id, q) });
      }
      return out.sort((a, b) => b.level - a.level);
    },
    coursesFor: (q) => {
      const { courses, offers } = coursesData(ctx);
      const index = ctx.port('prices').index(ctx.now);
      return Object.entries(courses)
        .filter(([id, c]) => offers[id] && c.grants.includes(q))
        .map(([id, c]) => ({ id, label: c.label, grants: c.grants, price: offers[id]!.price.value * index, workdays: c.workdays.value, leadTime: offers[id]!.leadTime.value, ...courseDates(ctx, id, ctx.now) }))
        .sort((a, b) => a.price - b.price);
    },
    trainingFor: (q, party) => {
      const courses = port.coursesFor(q);
      const grants = (c: string | undefined) => courses.find((x) => x.id === c);
      const waiting: ReturnType<WorkforcePort['trainingFor']>['waiting'] = [];
      for (const [id, e] of ctx.all('Enrolment')) {
        const c = worksFor(ctx, id) === party ? grants(e.course) : undefined;
        if (c) waiting.push({ person: id, name: ctx.get('Person', id)?.name ?? id, course: c.id, label: c.label, until: e.until });
      }
      for (const [id, pr] of ctx.all('Presence')) {
        const c = pr.status === 'training' && worksFor(ctx, id) === party ? grants(pr.course) : undefined;
        if (c && pr.until !== undefined) waiting.push({ person: id, name: ctx.get('Person', id)?.name ?? id, course: c.id, label: c.label, until: pr.until });
      }
      const candidates: ReturnType<WorkforcePort['trainingFor']>['candidates'] = [];
      for (const id of staffAt(ctx, ctx.now, party)) {
        if (port.canDo(id, q)) continue;
        const c = courses.find((x) => enrolBlocker(ctx, id, x.id) === null);
        if (c) candidates.push({ person: id, name: ctx.require('Person', id).name, course: c });
      }
      candidates.sort((a, b) => curve(b.person, q) - curve(a.person, q));
      return { waiting, candidates };
    },
    enrolBlocker: (person, course) => enrolBlocker(ctx, person, course),
    lead: (party) => leadOf(ctx, party),
    members: (party) => membersOf(ctx, party),
    population: (party) => population(ctx, party),
    inCustody: (person, of) => (ctx.get('Presence', person)?.custody ?? []).some((c) => c.until > ctx.now && (of !== undefined ? c.for === of : c.from <= ctx.now)),
    tell: (party, person) => tell(ctx, party, person),
    wordWays: (party, person, told) => wordWays(ctx, party, person, told),
    phone: (person) => phoneOf(ctx, person),
    engaged: (person) => engagedNow(ctx, person),
    heldFrom: (person, by, party) => heldFrom(ctx, person, by, party),
    jobSeekers: (party) => jobSeekersOf(ctx, party),
    phoneDraw: (person, hours) => phoneDraw(ctx, person, hours),
    helpDaysLeft: (person) => {
      const h = ctx.get('Helper', person);
      return h ? (h.resident ? 0 : helpDaysLeftIn(ctx, h, ctx.calendar.at(ctx.now).year)) : 0;
    },
  };
  return port;
}

// ------------------------------------------------------------------ labour market

/**
 * People whose own lives are told (a person, a household, a group): their colds and recoveries are
 * news. A firm's employees fall ill as its sick days count them, not line by line in everyone's log
 * (0004: what a household would not know; 0025: a city's colds are no news).
 */
function ofHousehold(read: ReadCtx, person: EntityId): boolean {
  // one of a household working for someone else is still theirs
  const party = read.get('Helper', person)?.of ?? worksFor(read, person);
  const kind = party ? (read.get('Party', party) as { kind?: string } | undefined)?.kind : undefined;
  return kind === 'person' || kind === 'household' || kind === 'group';
}

function openVacancies(ctx: ReadCtx, job?: string, employer?: EntityId): EntityId[] {
  const out: EntityId[] = [];
  for (const [id, v] of ctx.all('Vacancy')) if (v.status === 'open' && (job === undefined || v.job === job) && (employer === undefined || v.employer === employer)) out.push(id);
  return out;
}

/** the share of a job's pool of job seekers still there (8c: hires empty it, the inflow fills it again); 1 without a pool */
function poolShare(read: ReadCtx, jobId: string, t = read.now): number {
  const pool = read.data('jobs')[jobId]?.market.pool;
  if (!pool || !(pool.size.value > 0)) return 1;
  const p = read.state('workforce').pools?.[jobId];
  const taken = p ? Math.max(0, p.taken - (pool.inflow.value * Math.max(0, t - p.at)) / (365.25 * DAY)) : 0;
  return Math.max(0, 1 - taken / pool.size.value);
}

/** the mean days between suitable applicants now: the rarer the emptier the pool (at least one in a hundred of its days) */
const applicantInterval = (read: ReadCtx, jobId: string): number => read.data('jobs')[jobId]!.market.meanApplicantInterval.value / Math.max(0.01, poolShare(read, jobId));

/** draw the next applicant for a job with open vacancies (Poisson arrivals, memoryless) */
function scheduleApplicant(ctx: WriteCtx, jobId: string): void {
  const st = ctx.state('workforce');
  if (st.nextApplicant[jobId] !== undefined) return;
  const at = Math.round(ctx.now + ctx.rng('labour-market').exponential(applicantInterval(ctx, jobId) * DAY));
  ctx.patchState('workforce', {
    nextApplicant: { ...st.nextApplicant, [jobId]: at },
  });
  ctx.at(at, 'applicant', { job: jobId, at });
}

/** first day the hire can start: after the notice period, at the next shift start */
function startAfterNotice(ctx: WriteCtx, noticeDays: number): number {
  const port = workforcePort(ctx);
  return ctx.calendar.startOfDay(port.nextShiftStart(ctx.calendar.startOfDay(ctx.now) + Math.ceil(noticeDays) * DAY));
}

const clampAptitude = (ctx: ReadCtx, a: number): number => {
  const r = ctx.data('labourSettings').aptitude;
  return Math.min(r.max.value, Math.max(r.min.value, a));
};

/**
 * The jobs of the regional labour market, each as an advert one could place (decision 0002: an unknown job is refused
 * with the jobs there are; Qwen S513 guessed nine ids, the one valid only seen inside another blocker's remedy).
 */
function jobOffers(read: ReadCtx, count = 1): Remedy[] {
  const index = read.port('prices').index(read.now);
  return Object.entries(read.data('jobs')).map(([id, j]) => ({ label: `Advertise ${count} × ${j.label} (${id}): ${j.hourlyWage.value.toFixed(2)} €/h, the advert some ${Math.round(j.market.advertCost.value * index)} €, a start in about ${Math.round(workforcePort(read).expectedStartDays(id, openVacancies(read, id).length + count - 1))} days`, command: { type: 'workforce.recruit', payload: { job: id, count } } }));
}
const jobIds = (read: ReadCtx) => Object.keys(read.data('jobs')).join(', ');

function hire(ctx: WriteCtx, employer: EntityId, jobId: string, hiredAt: number, name?: string, aptitude?: number, experience?: Record<string, number>): EntityId {
  const job = ctx.data('jobs')[jobId];
  if (!job) ctx.reject('workforce.unknownJob', { job: jobId, jobs: jobIds(ctx) });
  // (nobody is taken on by a party that ended, whoever hires for it: the one check; review y)
  mustBeLive(ctx, employer);
  const set = ctx.data('labourSettings');
  const people = ctx.rng('people');
  let fullName = name;
  if (!fullName) {
    const names = ctx.rng('names');
    fullName = `${names.pick(set.names.first)} ${names.pick(set.names.last)}`;
  }
  const knack = clampAptitude(ctx, aptitude ?? people.normal(1, set.aptitude.sd.value));
  const age = Math.round(Math.min(64, Math.max(18, people.normal(42, 11))));
  // practice brought from earlier jobs: log-uniform across the job's range (newcomers to veterans)
  const [lo, hi] = job.experience.range ?? [job.experience.value / 3, job.experience.value * 3];
  const brought = (q: string) => experience?.[q] ?? Math.round(Math.exp(Math.log(Math.max(1, lo)) + people.next() * (Math.log(Math.max(lo + 1, hi)) - Math.log(Math.max(1, lo)))));
  const exp: Record<string, number> = {};
  for (const q of job.qualifications) exp[q] = brought(q);
  for (const [q, h] of Object.entries(experience ?? {})) exp[q] = h;
  const id = ctx.spawn('person', { name: fullName });
  const person: Person = { name: fullName, birthYear: ctx.calendar.at(hiredAt).year - age, certificates: job.qualifications.filter((q) => ctx.data('qualifications')[q]?.certificate), experience: exp, aptitude: knack };
  ctx.set('Person', id, person);
  ctx.set('Employment', id, { employer, job: jobId, hourlyWage: job.hourlyWage.value, hiredAt });
  ctx.set('Presence', id, { status: 'available', vacationDaysLeft: hireLeave(ctx, id, hiredAt), sickDaysThisYear: 0 });
  placeNew(ctx, id, employer, true);
  ctx.emit('workforce.person', { person: id, party: employer });
  // (one who comes into the world comes with a charged phone, S4)
  ctx.setState('workforce', { ...ctx.state('workforce'), phones: { ...(ctx.state('workforce').phones ?? {}), [id]: { charge: 1, at: ctx.now } } });
  return id;
}

function shuffled<T>(ctx: WriteCtx, items: T[], stream: string): T[] {
  const a = [...items];
  const r = ctx.rng(stream);
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = r.int(0, i);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Is t the first scheduled workday of its ISO week (vacation blocks start there)? */
function isWeekStart(ctx: ReadCtx, t: number): boolean {
  if (!isWorkday(ctx, t)) return false;
  const wd = ctx.calendar.at(t).weekday;
  for (let d = 1; d <= wd; d += 1) if (isWorkday(ctx, t - d * DAY)) return false;
  return true;
}

interface PlannedBlock {
  start: number;
  days: number;
}

/** First workdays of the ISO weeks from `from` (inclusive) to the end of its calendar year. */
function weekStarts(ctx: ReadCtx, from: number): number[] {
  const year = ctx.calendar.at(from).year;
  const out: number[] = [];
  for (let day = ctx.calendar.startOfDay(from); ctx.calendar.at(day).year === year; day += DAY) if (isWeekStart(ctx, day)) out.push(day);
  return out;
}

/**
 * Plan the not-yet-planned vacation entitlement of every employee into week blocks for the
 * rest of the year: one two-week block in the season's long months (`vacationSeason.long`) when possible, the rest in
 * weeks, weeks drawn by seasonal preference (`vacationSeason.weights`) among weeks that still have capacity under the
 * cap; days carried over from last year first, in weeks before they lapse (the practice's vacationCarryOver).
 * Days that cannot be placed stay in vacationDaysLeft and carry over into the next year (until that day).
 */
function planVacations(ctx: WriteCtx, staff: EntityId[], plan: Record<EntityId, PlannedBlock[]>, carried: Record<EntityId, number> = {}): Record<EntityId, PlannedBlock[]> {
  const today = ctx.calendar.startOfDay(ctx.now);
  // (leave carried over from last year is planned first, in the weeks before it lapses: the employer's part, BAG 9 AZR 541/15)
  const co = ctx.data('labourSettings').vacationCarryOver;
  const season = ctx.data('labourSettings').vacationSeason;
  const lapse = co ? ctx.calendar.timeOf({ year: ctx.calendar.at(today).year, month: co.until.month, day: co.until.day }) : undefined;
  const out: Record<EntityId, PlannedBlock[]> = {};
  for (const id of staff) out[id] = (plan[id] ?? []).filter((b) => b.start >= today);
  const starts = weekStarts(ctx, today + DAY);
  if (starts.length === 0) return out;
  const perWeek = Math.max(1, ctx.data('labourSettings').schedule.filter((d) => d.end.value > d.start.value).length);
  const weeksOf = (days: number) => Math.max(1, Math.ceil(days / perWeek));
  const cap = Math.max(1, Math.floor(VACATION_CAP_SHARE * staff.length));
  const index = new Map(starts.map((t, i) => [t, i]));
  const occ = new Array<number>(starts.length).fill(0);
  const mine = new Map<EntityId, Set<number>>();
  const mark = (id: EntityId, i0: number, n: number) => {
    const set = mine.get(id) ?? new Set<number>();
    for (let i = i0; i < Math.min(starts.length, i0 + n); i += 1) {
      occ[i]! += 1;
      set.add(i);
    }
    mine.set(id, set);
  };
  for (const id of staff) {
    const p = ctx.require('Presence', id);
    if (p.status === 'vacation' && p.until !== undefined) {
      let n = 0;
      while (n < starts.length && starts[n]! < p.until) n += 1;
      mark(id, 0, n);
    }
    for (const b of out[id]!) {
      const i = index.get(b.start);
      if (i !== undefined) mark(id, i, weeksOf(b.days));
    }
  }
  const r = ctx.rng('vacation');
  for (const id of shuffled(ctx, staff, 'vacation-order')) {
    const p = ctx.require('Presence', id);
    const blocks = out[id]!;
    let need = Math.floor(p.vacationDaysLeft - blocks.reduce((a, b) => a + b.days, 0));
    let early = lapse !== undefined && today < lapse ? Math.min(need, Math.floor((carried[id] ?? 0) - blocks.filter((b) => b.start < lapse).reduce((a, b) => a + b.days, 0))) : 0;
    let wantSummer = !blocks.some((b) => b.days >= 2 * perWeek);
    while (need > 0) {
      const len = early > 0 ? Math.min(perWeek, early) : wantSummer && need >= 2 * perWeek ? 2 * perWeek : Math.min(perWeek, need);
      const n = weeksOf(len);
      const own = mine.get(id);
      const cands: number[] = [];
      const weights: number[] = [];
      for (let i = 0; i + n <= starts.length; i += 1) {
        const c = ctx.calendar.at(starts[i]!);
        // (carried days: in weeks that end before they lapse)
        if (early > 0 && starts[i + n - 1]! + 7 * DAY > lapse! + 3 * DAY) continue;
        if (early <= 0 && len >= 2 * perWeek && !withinMonths(season.long, c.month)) continue;
        let free = true;
        for (let k = i; k < i + n; k += 1) if (occ[k]! >= cap || own?.has(k)) free = false;
        if (!free) continue;
        cands.push(i);
        weights.push(vacationWeight(season, c.month, c.day));
      }
      if (cands.length === 0) {
        // (no room before they lapse: the rest goes into the year as the rest does)
        if (early > 0) {
          early = 0;
          continue;
        }
        if (len >= 2 * perWeek) {
          wantSummer = false;
          continue;
        }
        break;
      }
      let u = r.next() * weights.reduce((a, b) => a + b, 0);
      let pick = cands[cands.length - 1]!;
      for (let j = 0; j < cands.length; j += 1) {
        u -= weights[j]!;
        if (u <= 0) {
          pick = cands[j]!;
          break;
        }
      }
      blocks.push({ start: starts[pick]!, days: len });
      mark(id, pick, n);
      need -= len;
      if (early > 0) early -= len;
      else if (len >= 2 * perWeek) wantSummer = false;
    }
    blocks.sort((a, b) => a.start - b.start);
  }
  return out;
}

function dailyRun(ctx: WriteCtx): void {
  const set = ctx.data('labourSettings');
  const now = ctx.now;
  const cal = ctx.calendar.at(now);
  let st = ctx.state('workforce');

  // --- new year: fresh entitlement (untaken days carry over: vacationCarryOver), reset sickness counter
  if (cal.year !== st.year) {
    const carried: Record<EntityId, number> = {};
    const older: Record<EntityId, number> = {};
    for (const [id, p] of ctx.all('Presence')) {
      if (p.status === 'gone') continue;
      if (ctx.get('Helper', id) && !ctx.get('Employment', id)) {
        ctx.patch('Presence', id, { sickDaysThisYear: 0 });
        continue;
      }
      // a hire starting this year or later already got the prorated entitlement of their first year
      const e = ctx.get('Employment', id);
      // (one whose employment has ended has no leave of a new year: theirs was settled when it ended)
      if (e && e.leavesAt !== undefined && e.leavesAt <= now) continue;
      const fresh = e !== undefined && ctx.calendar.at(e.hiredAt).year >= cal.year;
      // (what was left of last year is carried; of it, what is left of the year before (leave is taken oldest first) is
      // older now, kept from them all that year (by illness: the plan had room for it); the world's first day carries nothing)
      if (st.year !== 0 && !fresh && p.vacationDaysLeft >= 0.5) {
        const old = Math.min(p.vacationDaysLeft, st.carried?.[id] ?? 0);
        if (old >= 0.01) older[id] = old;
        if (p.vacationDaysLeft - old >= 0.5) carried[id] = p.vacationDaysLeft - old;
      }
      ctx.patch('Presence', id, { vacationDaysLeft: p.vacationDaysLeft + (fresh ? 0 : set.vacationDaysPerYear.value), sickDaysThisYear: 0 });
    }
    st = { ...st, year: cal.year, ...(set.vacationCarryOver ? { carried, carriedOlder: older } : {}) };
  }
  // --- leave lapses only where the employer made it possible to take it and the employee did not (BAG 19.2.2019, 9 AZR
  // 541/15): the employer's plan asks, and everyone here takes the leave planned for them when they can, so last year's
  // days still left were kept from them (by illness, or by the employer's own short time or lack of room) and are kept
  // (review x: they lapsed on 1 April while ill, and while on the firm's short time). Days illness kept from them lapse
  // fifteen months after the end of their year (keptMonths: EuGH C-214/10; BAG 9 AZR 353/10): those of the year before
  // last, at the carry-over day. Said once for each employer
  const co = set.vacationCarryOver;
  const keptEnds = co?.keptMonths ? ((m: number) => ctx.calendar.timeOf({ year: cal.year - 1 + Math.floor(m / 12), month: (m % 12) + 1, day: 1 }))(Math.round(co.keptMonths.value)) : undefined;
  if (co && keptEnds !== undefined && st.carriedOlder && Object.keys(st.carriedOlder).length && now >= keptEnds) {
    const lapsed = new Map<EntityId, string[]>();
    for (const [id, days] of Object.entries(st.carriedOlder).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const p = ctx.get('Presence', id);
      const e = ctx.get('Employment', id);
      if (!p || !e) continue;
      const lapse = Math.min(days, p.vacationDaysLeft);
      if (lapse < 0.01) continue;
      ctx.patch('Presence', id, { vacationDaysLeft: p.vacationDaysLeft - lapse });
      lapsed.set(e.employer, [...(lapsed.get(e.employer) ?? []), `${ctx.get('Person', id)?.name ?? id} ${Math.round(lapse * 10) / 10}`]);
    }
    for (const [employer, lines] of lapsed) ctx.log('info', `${partyLabel(ctx, employer)}: leave of ${cal.year - 2} that illness kept from being taken lapses (${co.keptRule ?? co.rule}): ${lines.slice(0, 5).join('; ')}${lines.length > 5 ? `; and ${lines.length - 5} more` : ''} days.`, [employer]);
    st = { ...st, carriedOlder: {} };
  }

  // --- back from a course (before anyone leaves: a stay may end with it): the certificates and the practice it gave
  for (const [id, p] of ctx.all('Presence')) {
    if (p.status !== 'training' || p.until === undefined || p.until > now) continue;
    const course = coursesData(ctx).courses[p.course ?? ''];
    const person = ctx.require('Person', id);
    if (course) {
      const experience = { ...person.experience };
      // the supervised practice is shared among the skills the course teaches
      for (const q of course.grants) experience[q] = (experience[q] ?? 0) + course.practice.value / course.grants.length;
      ctx.set('Person', id, { ...person, certificates: [...new Set([...person.certificates, ...course.grants])], experience });
      ctx.emit('workforce.certified', { person: id, course: p.course!, certificates: course.grants });
      ctx.log('success', `${person.name} passed ${course.label}: ${course.grants.map((q) => ctx.data('qualifications')[q]?.label ?? q).join(', ')}.`, [id]);
    }
    ctx.set('Presence', id, { status: 'available', vacationDaysLeft: p.vacationDaysLeft, sickDaysThisYear: p.sickDaysThisYear });
  }

  // --- helpers arrive for their stay and go home after it
  for (const [id, h] of ctx.all('Helper')) {
    const p = ctx.get('Presence', id);
    if (!p || h.resident || !h.stay) continue;
    if (h.stay.until <= now) {
      ctx.set('Presence', id, { status: 'away', vacationDaysLeft: 0, sickDaysThisYear: p.sickDaysThisYear });
      const { stay: _s, ...rest } = h;
      ctx.set('Helper', id, rest);
      // (said, as other comings and goings are: Qwen S114)
      ctx.log('info', `${ctx.get('Person', id)?.name ?? id} goes home after helping.`, [id]);
      ctx.emit('workforce.helperLeft', { person: id });
    } else if (h.stay.from <= now && p.status === 'away') {
      ctx.set('Presence', id, { status: 'available', vacationDaysLeft: 0, sickDaysThisYear: p.sickDaysThisYear });
      ctx.log('info', `${ctx.get('Person', id)?.name ?? id} has come to help, until ${ctx.calendar.format(h.stay.until, 'day')}.`, [id]);
      ctx.emit('workforce.helperArrived', { person: id });
    }
  }

  const staff = staffAt(ctx, now);
  const employees = staff.filter((id) => employedAt(ctx.get('Employment', id), now));
  // (the day's shift as the schedule has it: on a public holiday nobody works, and it is paid all the same)
  const shift = shiftWindow(ctx, now, undefined, true);
  // a holiday on a working day is said, so that a still site is not a riddle (Qwen R7: the halt was mute)
  const beyondMap = (id: EntityId) => ctx.hasData('employers') && Boolean(ctx.data('employers')?.[ctx.get('Employment', id)?.employer ?? '']);
  const sd = set.schedule[ctx.calendar.at(now).weekday];
  const holiday = sd && sd.end.value > sd.start.value ? holidayOn(ctx, now, set.holidays) : undefined;
  if (holiday && employees.some((id) => !ofHousehold(ctx, id) && !beyondMap(id))) ctx.log('info', `${holiday}: a public holiday. Firms do not work today${set.holidays!.paid ? ', and pay their people as on a working day' : '; it is not paid'}.`);

  // --- helpers here are fed (every day of their stay)
  // (members are the party: they live from its own stores)
  const relations = ctx.data('labourSettings').relations;
  // (one who lives from a store of ours eats its food, not bought meals: design/physical-state.md I1)
  const fed = staff.filter((id) => ctx.get('Helper', id) && relations[ctx.require('Helper', id).relation]?.fed !== false && ctx.get('Presence', id)?.status !== 'training' && !firstOf(ctx, 'home', id));
  for (const party of [...new Set(fed.map((id) => ctx.require('Helper', id).of))].sort()) {
    const theirs = fed.filter((id) => ctx.require('Helper', id).of === party);
    pay(ctx, party, ACCOUNTS.helperMeals, theirs.length * set.helperUpkeep.value, `Meals for ${theirs.length} helper${theirs.length > 1 ? 's' : ''}`, theirs);
    // (one who lives too far to go home each night sleeps near, at a bed paid for: design/realism-plan.md S1, A3)
    const far = theirs.filter((id) => (ctx.require('Helper', id).travelDays ?? 0) >= 1 && !ctx.require('Helper', id).resident);
    if (far.length && set.helperLodging) pay(ctx, party, ACCOUNTS.rentExpense, far.length * set.helperLodging.value, `A bed near the site for ${far.length} helper${far.length > 1 ? 's' : ''} from far away`, far);
  }

  // --- returns
  for (const id of staff) {
    const p = ctx.require('Presence', id);
    if ((p.status === 'sick' || p.status === 'vacation') && p.until !== undefined && p.until <= now) {
      ctx.set('Presence', id, { status: 'available', vacationDaysLeft: p.vacationDaysLeft, sickDaysThisYear: p.sickDaysThisYear });
      // well again (Qwen R05: recovery was silent)
      if (p.status === 'sick' && ofHousehold(ctx, id)) ctx.log('info', `${ctx.get('Person', id)?.name ?? id} is well again.`, [id]);
      ctx.emit('workforce.returned', { person: id });
    }
  }
  // --- short time (after the returns: one back from illness or leave goes on with it): while it runs
  // those on it stay home; its days over (or notice given), they are back. Its record stays: the months
  // it is paid for count from when it began, until a pause long enough to begin afresh.
  const short = { ...(st.shortTime ?? {}) };
  const overFor = new Map<EntityId, EntityId[]>();
  for (const id of Object.keys(short).sort()) {
    const p = ctx.get('Presence', id);
    if (!p || !ctx.get('Employment', id)) {
      delete short[id];
      continue;
    }
    if (shortTimeOn(ctx, id, short[id], now)) {
      if (p.status === 'available') {
        ctx.set('Presence', id, { ...p, status: 'shortTime', until: short[id]!.until });
        ctx.emit('workforce.absence', { person: id, kind: 'shortTime', until: short[id]!.until });
      }
      // its allowance over while it runs (the months used up): said once, for what it now is, home on full pay (Qwen S503)
      const employer = ctx.require('Employment', id).employer;
      const none = noAllowance(ctx, now, short[id]!, employer);
      if (none !== Boolean(short[id]!.over)) {
        const { over: _o, ...rest } = short[id]!;
        short[id] = none ? { ...rest, over: true } : rest;
        if (none) overFor.set(employer, [...(overFor.get(employer) ?? []), id]);
      }
    } else if (p.status === 'shortTime') {
      ctx.set('Presence', id, { status: 'available', vacationDaysLeft: p.vacationDaysLeft, sickDaysThisYear: p.sickDaysThisYear });
      ctx.emit('workforce.returned', { person: id });
    }
  }
  st = { ...st, shortTime: short };
  for (const [employer, people] of [...overFor].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const law = set.shortTime!;
    ctx.log('warn', `${partyLabel(ctx, employer)}: the short-time allowance for ${people.length} is over (${law.maxMonths.value} months, ${law.rule}): from today it is no short time; those at home are paid their wage in full (${law.afterwards ?? 'the employer owes it'}). workforce.endShortTime brings them back to work.`, people);
  }

  let sickDays = 0;
  let vacationDays = 0;
  if (shift) {
    // (a public holiday is paid like a working day; illness keeps no holidays)
    // --- sickness: Poisson process over available workdays
    const W = workdaysPerYear(ctx);
    const availableDays = Math.max(1, W - set.vacationDaysPerYear.value - set.sickDaysPerYear.value);
    const lambda = set.sickDaysPerYear.value / (SICK_EPISODE_MEAN * availableDays);
    const sick = ctx.rng('sickness');
    // a firm hears who is off today, one line a day (Qwen S113: absences were silent; 0025: a line each, not a line a person)
    const offToday = new Map<EntityId, string[]>();
    const tell = (id: EntityId, what: string) => {
      const employer = ctx.get('Employment', id)?.employer;
      if (!employer || ofHousehold(ctx, id) || beyondMap(id)) return;
      offToday.set(employer, [...(offToday.get(employer) ?? []), `${ctx.get('Person', id)?.name ?? id} ${what}`]);
    };
    for (const id of staff) {
      const p = ctx.require('Presence', id);
      if (p.status !== 'available') continue;
      if (!sick.chance(lambda)) continue;
      let u = sick.next() * geomTotal;
      let k = 1;
      for (const w of geomWeights) {
        u -= w;
        if (u <= 0) break;
        k += 1;
      }
      k = Math.min(k, SICK_EPISODE_MAX);
      const until = afterWorkdays(ctx, now, k);
      ctx.set('Presence', id, { status: 'sick', until, vacationDaysLeft: p.vacationDaysLeft, sickDaysThisYear: p.sickDaysThisYear });
      // said when it starts, as other illnesses are (Qwen R05: onset was silent), with what it is and how long (S504:
      // the firm heard no cause or degree); nothing keeps it away but time
      const what = `a cold or the like, ${k} working day${k > 1 ? 's' : ''} off: it passes by itself`;
      if (ofHousehold(ctx, id)) ctx.log('warn', `${ctx.get('Person', id)?.name ?? id} is ill (${what}) until ${ctx.calendar.format(until, 'day')}.`, [id]);
      tell(id, `is ill (${what}) until ${ctx.calendar.format(until, 'day')} (paid)`);
      ctx.emit('workforce.absence', { person: id, kind: 'sick', until });
    }

    // --- vacation: planned blocks start on the first workday of a week (capped concurrency)
    if (isWeekStart(ctx, now)) {
      const plan = { ...st.vacationPlan };
      for (const people of byEmployerOf(ctx, employees).values()) {
      const cap = Math.max(1, Math.floor(VACATION_CAP_SHARE * people.length));
      let away = people.filter((id) => ctx.require('Presence', id).status === 'vacation').length;
      for (const id of people) {
        const blocks = plan[id];
        const block = blocks?.find((b) => b.start === now);
        if (!blocks || !block) continue;
        plan[id] = blocks.filter((b) => b !== block);
        const p = ctx.require('Presence', id);
        // sick on the first day or no room: the days stay in the entitlement and are re-planned (on the firm's short time
        // the leave is taken, in full pay: leave before short time, § 96 Abs. 4 Satz 2 Nr. 2 SGB III; review x)
        if ((p.status !== 'available' && p.status !== 'shortTime') || away >= cap) continue;
        const days = Math.min(block.days, Math.floor(p.vacationDaysLeft));
        if (days <= 0) continue;
        const until = afterWorkdays(ctx, now, days);
        ctx.set('Presence', id, { status: 'vacation', until, vacationDaysLeft: p.vacationDaysLeft - days, sickDaysThisYear: p.sickDaysThisYear });
        // (the oldest days are taken first)
        const old = Math.min(days, st.carriedOlder?.[id] ?? 0);
        if (old > 0) st = { ...st, carriedOlder: { ...st.carriedOlder, [id]: st.carriedOlder![id]! - old } };
        if (st.carried?.[id] && days > old) st = { ...st, carried: { ...st.carried, [id]: Math.max(0, st.carried[id]! - (days - old)) } };
        tell(id, `is on vacation until ${ctx.calendar.format(until, 'day')} (paid)`);
        ctx.emit('workforce.absence', { person: id, kind: 'vacation', until });
        away += 1;
      }
      }
      st = { ...st, vacationPlan: plan };
    }
    for (const [employer, lines] of offToday) ctx.log('info', `${partyLabel(ctx, employer)}: ${lines.slice(0, 5).join('; ')}${lines.length > 5 ? `; and ${lines.length - 5} more` : ''}.`, [employer]);

    // --- count today's absence days (scheduled workdays only, a holiday none: Qwen S369; the world's totals leave
    // out employers beyond the map)
    for (const id of holiday ? [] : staff) {
      const p = ctx.require('Presence', id);
      if (p.status === 'sick') {
        if (!beyondMap(id)) sickDays += 1;
        ctx.patch('Presence', id, { sickDaysThisYear: p.sickDaysThisYear + 1 });
      } else if (p.status === 'vacation' && !beyondMap(id)) vacationDays += 1;
    }

    // --- the day's payroll, when its working day begins: by then the day's own facts are in (who came, who found no
    // way: review x, the flag of yesterday's report paid the wrong day)
    ctx.at(Math.max(now, shift.start), 'payroll', { day: ctx.calendar.startOfDay(now) });
    st = { ...st, totals: { ...st.totals, sickDays: st.totals.sickDays + sickDays, vacationDays: st.totals.vacationDays + vacationDays } };
  }
  // --- plan entitlement not yet planned (new hires, new year, postponed blocks)
  // (each employer plans its own people's leave, against its own cap: one world, many firms)
  let planned: Record<EntityId, PlannedBlock[]> = {};
  const early = Object.fromEntries([...new Set([...Object.keys(st.carried ?? {}), ...Object.keys(st.carriedOlder ?? {})])].map((id) => [id, (st.carried?.[id] ?? 0) + (st.carriedOlder?.[id] ?? 0)]));
  for (const people of byEmployerOf(ctx, employees).values()) planned = { ...planned, ...planVacations(ctx, people, st.vacationPlan, early) };
  st = { ...st, vacationPlan: planned };
  ctx.setState('workforce', st);
  // --- where everyone is to be: those away today go, and each party's working day is planned
  for (const [id] of [...ctx.all('Presence')].sort(([a], [b]) => (a < b ? -1 : 1))) report(ctx, id);
  planShifts(ctx);
}

/**
 * A day's payroll (run as its working day begins, `day` its 00:00): every employee of that day is paid the scheduled
 * hours by their employer, ill, on leave or at work alike; one who found no way to work that day is not (by the day's
 * own record, `notCome`: the day before a holiday, leave or the end of the employment too).
 */
function payroll(ctx: WriteCtx, day: number): void {
  const set = ctx.data('labourSettings');
  const shift = shiftWindow(ctx, day, undefined, true);
  if (!shift) return;
  const st = ctx.state('workforce');
  const sd = set.schedule[ctx.calendar.at(day).weekday];
  const holiday = sd && sd.end.value > sd.start.value ? holidayOn(ctx, day, set.holidays) : undefined;
  const beyondMap = (id: EntityId) => ctx.hasData('employers') && Boolean(ctx.data('employers')?.[ctx.get('Employment', id)?.employer ?? '']);
  const employees = staffAt(ctx, day).filter((id) => employedAt(ctx.get('Employment', id), day));
  const factor = 1 + set.employerSurcharge.value;
  let cost = 0;
  let hours = 0;
  const byEmployer = new Map<EntityId, { cost: number; people: EntityId[] }>();
  for (const id of employees) {
    const e = ctx.require('Employment', id);
    // on short time: the insurance pays the hours lost; the employer keeps its share of their cost
    // (ill during it: sick pay is short-time pay too, § 4 Abs. 3 EFZG)
    const status = ctx.require('Presence', id).status;
    // away without leave (gone from the place, with no way to work): no work, no wage (§ 326 BGB; ill or on leave is paid, Qwen's round 16)
    if (status === 'away' || status === 'gone') continue;
    // (no way to work that day: they did not come, and are not paid for it (the way is their risk, Wegerisiko: BAG
    // 8.9.1982, 5 AZR 283/80); ill or on leave they are paid as ever)
    if (status === 'available' && st.notCome?.[id] === day && !beyondMap(id)) continue;
    // (on a course during it too: the allowance goes on through training, § 106a SGB III)
    const onShort = (status === 'shortTime' || status === 'sick' || status === 'training') && shortTimeOn(ctx, id, st.shortTime?.[id], ctx.now) ? st.shortTime![id] : undefined;
    const share = onShort ? shortTimeShare(ctx, day, onShort, e.employer) : 1;
    const c = shift.paidHours * e.hourlyWage * factor * share;
    // (a working day at home on short time earns no leave: the year's leave shrinks by its share of the working days,
    // law.leaveShrinks; sent home on full pay, it does not)
    if (status === 'shortTime' && onShort && share < 1 && set.shortTime?.leaveShrinks && !holiday) {
      const pr = ctx.require('Presence', id);
      ctx.patch('Presence', id, { vacationDaysLeft: Math.max(0, pr.vacationDaysLeft - set.vacationDaysPerYear.value / workdaysPerYear(ctx)) });
    }
    // (an employer beyond the map pays there: not in this world's payroll)
    if (!beyondMap(id)) {
      cost += c;
      hours += shift.paidHours;
    }
    const b = byEmployer.get(e.employer) ?? { cost: 0, people: [] };
    b.cost += c;
    b.people.push(id);
    byEmployer.set(e.employer, b);
  }
  for (const employer of [...byEmployer.keys()].sort()) {
    const b = byEmployer.get(employer)!;
    // an employer beyond the map keeps its books there: what our people earn comes home, after their deductions
    const town = ctx.hasData('employers') ? ctx.data('employers')?.[employer] : undefined;
    if (town) {
      for (const id of b.people) {
        const home = ctx.get('Helper', id)?.of;
        const net = shift.paidHours * ctx.require('Employment', id).hourlyWage * set.netShare.value;
        if (home) receive(ctx, home, ACCOUNTS.wages, Math.round(net * 100) / 100, `Wages: ${ctx.get('Person', id)?.name ?? id} at ${town.label} (${shift.paidHours.toFixed(2)} h, net)`, [id]);
      }
      continue;
    }
    pay(ctx, employer, ACCOUNTS.labour, b.cost, `Payroll ${ctx.calendar.format(day, 'day')}: ${b.people.length} employees × ${shift.paidHours.toFixed(2)} h`, b.people);
  }
  // (the day's record of who did not come is read: what is left is of days to come)
  const notCome = Object.fromEntries(Object.entries(st.notCome ?? {}).filter(([, d]) => d > day));
  ctx.patchState('workforce', {
    notCome,
    totals: { ...st.totals, paidHours: st.totals.paidHours + hours, payroll: Math.round((st.totals.payroll + cost) * 100) / 100 },
  });
}

export const workforceModule = defineModule({
  id: WORKFORCE_MODULE_ID,
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Assignment', 'Move', 'NetNode', 'Party', 'WorkPackage'],
  commandDocs: {
    "workforce.employ": {
      internal: true,
    },
    "workforce.recruit": {
      description:
        'Advertise positions on the regional labour market (one advert cost per campaign). job: the id of one of the jobs there (the projection workforce.jobs lists them with their tariff wage, advert cost and expected start). Applicants turn up at random — skilled trades are scarce, expect months — and each hire starts after the notice period at their current employer. From then on they are paid the tariff wage plus employer surcharges every workday. There is no agency staff: every hire comes through the labour market (where the labour law of the practice pack bans agency work for construction, it stays banned).',
    },
    'workforce.withdrawVacancy': {
      description: 'Withdraw an open vacancy; nobody is hired for it.',
    },
    "workforce.dismiss": {
      description: 'Give notice to an employee (default 28 days). They keep working and are paid until they leave.',
    }
  },
  label: 'Workforce',
  description: 'People, jobs, qualifications, shift calendar, absences, payroll and recruitment.',
  provides: ['workforce'],
  // 'prices' is provided by the economy module, which also opens the ledger accounts used here
  requires: ['prices', 'parties'],
  optional: ['moves', 'routing'],
  // a person's knack is nobody's to read (it shows in their work); wages and helpers are their employer's business
  observe: {
    Person: (v: Person, viewer: EntityId, read: ReadCtx, id: EntityId) => {
      const { aptitude: _knack, ...seen } = v;
      return read.get('Employment', id)?.employer === viewer || read.get('Helper', id)?.of === viewer ? seen : { name: v.name, birthYear: v.birthYear, ...(v.died ? { died: v.died } : {}) };
    },
    Employment: (v: Employment, viewer: EntityId) => (v.employer === viewer ? v : { employer: v.employer, job: v.job }),
    Helper: (v: Helper, viewer: EntityId) => (v.of === viewer ? v : undefined),
  },
  components: {
    // a person held where they are for a purpose of a module (decision 0028: one owner of a person's time, and every
    // hold ends): nothing sends them elsewhere meanwhile; at `until` the hold ends and they go where they belong
    Engaged: s.object({ by: s.string(), purpose: s.string(), ref: s.string().optional(), since: s.number({ unit: 's' }), until: s.number({ unit: 's' }), timer: s.number().optional() }),
    Person: s.object({
      name: s.string(),
      birthYear: s.int(),
      certificates: s.array(s.string()),
      experience: s.record(s.number({ min: 0, unit: 'h' })),
      aptitude: s.number({ min: 0 }),
      died: s.object({ at: s.number({ unit: 's' }), cause: s.string(), where: s.point().optional() }).optional(),
    }),
    Employment: s.object({
      employer: s.ref('party'),
      job: s.string(),
      hourlyWage: s.number({ min: 0, unit: 'EUR/h' }),
      hiredAt: s.number({ unit: 's' }),
      leavesAt: s.number({ unit: 's' }).optional(),
    }),
    Vacancy: s.object({
      employer: s.ref('party'),
      job: s.string(),
      openedAt: s.number({ unit: 's' }),
      status: s.enum(['open', 'filled', 'withdrawn']),
      person: s.ref('person').optional(),
      closedAt: s.number({ unit: 's' }).optional(),
    }),
    Helper: s.object({
      of: s.ref('party'),
      relation: s.string(),
      resident: s.boolean(),
      daysPerYear: s.number({ min: 0, unit: 'd' }),
      booked: s.record(s.number({ min: 0, unit: 'd' })),
      travelDays: s.number({ min: 0, unit: 'd' }),
      stay: s.object({ from: s.number({ unit: 's' }), until: s.number({ unit: 's' }) }).optional(),
    }),
    Enrolment: s.object({ course: s.string(), from: s.number({ unit: 's' }), until: s.number({ unit: 's' }) }),
    Presence: s.object({
      status: s.enum(['available', 'sick', 'vacation', 'gone', 'away', 'training', 'released', 'shortTime']),
      course: s.string().optional(),
      until: s.number({ unit: 's' }).optional(),
      custody: s.array(s.object({ for: s.string(), from: s.number({ unit: 's' }), until: s.number({ unit: 's' }) })).optional(),
      vacationDaysLeft: s.number({ unit: 'd' }),
      sickDaysThisYear: s.number({ min: 0, unit: 'd' }),
    }),
  },
  data: {
    qualifications: s.record(QualificationSchema),
    courses: s.record(CourseSchema).optional(),
    courseOffers: s.record(CourseOfferSchema).optional(),
    jobs: s.record(JobSchema),
    labourSettings: LabourSettingsSchema,
    employers: s.record(TownEmployerSchema).optional(),
  },
  state: {
    initial: (): WorkforceState => ({ year: 0, vacationPlan: {}, totals: { paidHours: 0, payroll: 0, sickDays: 0, vacationDays: 0 }, nextApplicant: {} }),
  },
  events: {
    'workforce.person': s.object({ person: s.ref('person'), party: s.ref('party') }),
    'workforce.joined': s.object({ person: s.ref('person'), job: s.string() }),
    'workforce.left': s.object({ person: s.ref('person') }),
    'workforce.absence': s.object({ person: s.ref('person'), kind: s.enum(['sick', 'vacation', 'training', 'shortTime']), until: s.number() }),
    'workforce.certified': s.object({ person: s.ref('person'), course: s.string(), certificates: s.array(s.string()) }),
    'workforce.legalExposure': s.object({ person: s.ref('person'), party: s.ref('party'), what: s.string(), rule: s.string() }),
    'workforce.returned': s.object({ person: s.ref('person') }),
    'workforce.helperArrived': s.object({ person: s.ref('person') }),
    'workforce.helperLeft': s.object({ person: s.ref('person') }),
    'workforce.vacancyFilled': s.object({
      vacancy: s.ref('vacancy'),
      person: s.ref('person'),
      job: s.string(),
      starts: s.number(),
    }),
  },
  blockers: {
    'workforce.noWord': 'Our word cannot reach {to}: {why}',
    'workforce.unknownJob': 'No job called {job} on the labour market here (the jobs: {jobs}; see workforce.jobs)',
    'workforce.unknownPerson': 'Unknown employee {person}',
    'workforce.notEmployed': '{person} is not (or no longer) employed',
    'workforce.noShortTime': 'There is no short-time work here (no law for it in the practice pack)',
    'workforce.notOurEmployee': '{people} are not employees of {party}',
    'workforce.noEmployees': '{party} has no employees to put on short time',
    'workforce.notOnShortTime': 'None of {party} is on short time',
    'workforce.alreadyWorking': '{person} already works for someone',
    'workforce.unknownEmployer': 'No employer {employer} (there are: {employers})',
    'workforce.notHiring': '{employer} does not hire as {job} (they hire: {jobs})',
    'workforce.unknownVacancy': 'Unknown vacancy {vacancy}',
    'workforce.vacancyClosed': 'Vacancy {vacancy} is no longer open',
    'workforce.notOurs': '{person} does not work for {party}',
    'workforce.noWay': '{person} has no way {where}: {tried}',
    'workforce.engaged': '{person} is held for {purpose} until {until}',
    'workforce.noLead': '{party} has nobody of its own to act through',
    'workforce.cannotGo': '{lead} cannot walk over to {person}: {why}',
    'workforce.cannotLead': '{person} cannot be put in charge: {why}',
    'workforce.unreachable': 'The word does not reach {person} now: {why}',
    'workforce.notAMember': '{person} is not of the household of {party}: only its members look for work, or give notice, for it',
    'workforce.tooYoung': '{person} is {age}: nobody is taken on for a job before {min} ({rule})',
    'workforce.employedHere': '{person} is employed by {party}: wages from another employer would be their own; a firm earns by the work it takes on',
    'workforce.notAHelper': '{person} is not family or a friend who could help',
    'workforce.alreadyHere': '{person} lives here and helps already',
    'workforce.alreadyComing': '{person} is already here or on the way',
    'workforce.noTimeLeft': '{person} can come for {left} more working days in {year}, not {days}',
    'workforce.unknownRelation': 'No relationship {relation} here (relations: {relations})',
    'workforce.notStaying': '{person} is not staying with you',
    'workforce.noNotice': '{person} has not been given notice',
    'workforce.unknownQualification': 'Unknown skill {qualification}',
    'workforce.unknownCourse': 'Unknown course {course} (courses: {courses})',
    'workforce.notHere': '{person} is not with the company now',
    'workforce.notFree': '{person} cannot go now ({status})',
    'workforce.courseOutlastsStay': '{person} stays until {stayUntil}, the course ends {courseUntil}',
    'workforce.inTraining': '{person} is on a course until {until}',
    'workforce.alreadyEnrolled': '{person} is already enrolled in {course} (starts {from})',
    'workforce.alreadyCertified': '{person} already holds what {course} teaches',
    'workforce.leavesBeforeCourse': '{person} leaves on {leaves}, before the course ends ({courseUntil})',
    'workforce.awayForCourse': '{person} will be away when the course starts on {from} ({status})',
  },
  commands: {
    'workforce.practise': command(
      s.object({ person: s.ref('person'), skill: s.string(), hours: s.number({ min: 0 }) }),
      (ctx: WriteCtx, p) => {
        const person = ctx.get('Person', p.person);
        if (!person || p.hours <= 0) return;
        // learning by doing: hours of work add to the practice of the skill used
        ctx.set('Person', p.person, { ...person, experience: { ...person.experience, [p.skill]: (person.experience[p.skill] ?? 0) + p.hours } });
      },
      { label: 'Practice gained by working', internal: true },
    ),
    'workforce.addHelper': command(
      s.object({ of: s.ref('party'), name: s.string(), relation: s.string(), resident: s.boolean().optional(), daysPerYear: s.number({ min: 0 }).optional(), travelDays: s.number({ min: 0 }).optional(), birthYear: s.int().optional(), aptitude: s.number({ min: 0 }).optional(), certificates: s.array(s.string()).optional(), experience: s.record(s.number({ min: 0 })).optional() }),
      (ctx: WriteCtx, p) => {
        const quals = ctx.data('qualifications');
        for (const q of [...(p.certificates ?? []), ...Object.keys(p.experience ?? {})]) if (!quals[q]) ctx.reject('workforce.unknownQualification', { qualification: q });
        if (!ctx.data('labourSettings').relations[p.relation]) ctx.reject('workforce.unknownRelation', { relation: p.relation, relations: Object.keys(ctx.data('labourSettings').relations).join(', ') });
        const id = ctx.spawn('person', { name: p.name });
        ctx.set('Person', id, { name: p.name, birthYear: p.birthYear ?? ctx.calendar.at(ctx.now).year - 40, certificates: p.certificates ?? [], experience: { ...(p.experience ?? {}) }, aptitude: clampAptitude(ctx, p.aptitude ?? 1) });
        ctx.set('Helper', id, { of: p.of, relation: p.relation, resident: p.resident ?? false, daysPerYear: p.daysPerYear ?? 0, booked: {}, travelDays: p.travelDays ?? 0 });
        ctx.set('Presence', id, { status: p.resident ? 'available' : 'away', vacationDaysLeft: 0, sickDaysThisYear: 0 });
        placeNew(ctx, id, p.of, p.resident === true);
        ctx.emit('workforce.person', { person: id, party: p.of });
        // (one who comes into the world comes with a charged phone, S4)
        ctx.setState('workforce', { ...ctx.state('workforce'), phones: { ...(ctx.state('workforce').phones ?? {}), [id]: { charge: 1, at: ctx.now } } });
        return id;
      },
      { label: 'A family member or friend (scenario setup)', internal: true },
    ),
    'workforce.askForHelp': command(
      s.object({ person: s.ref('person'), days: s.int({ min: 1, max: 365 }) }),
      (ctx: WriteCtx, p) => {
        const h = ctx.get('Helper', p.person);
        if (!h) ctx.reject('workforce.notAHelper', { person: ctx.get('Person', p.person)?.name ?? p.person });
        mustBeOurs(ctx, p.person);
        const name = ctx.get('Person', p.person)!.name;
        if (h!.resident) ctx.reject('workforce.alreadyHere', { person: name });
        if (h!.stay && h!.stay.until > ctx.now) ctx.reject('workforce.alreadyComing', { person: name });
        const from = arrivalIfAsked(ctx, h!);
        const until = afterWorkdays(ctx, from, p.days);
        // the days count in the calendar year they are served: their own lives, and the law of the
        // practice pack (e.g. a friend's unpaid help for a business is an occasional favour)
        const days = workdaysByYear(ctx, from, until);
        const law = unpaidHelpLaw(ctx, h!);
        const booked = { ...h!.booked };
        for (const [y, n] of Object.entries(days)) {
          const used = booked[y] ?? 0;
          if (used + n > helpCap(ctx, h!)) ctx.reject('workforce.noTimeLeft', { person: name, days: n, year: y, left: helpDaysLeftIn(ctx, h!, Number(y)) });
          // beyond what the law allows unpaid help for a business: undeclared work, a legal exposure
          if (law && used + n > law.value) {
            const rule = law.source?.title ?? 'labour law';
            ctx.log('warn', `${name} helping ${partyLabel(ctx, h!.of)} unpaid for ${used + n} days in ${y} goes beyond the ${law.value} days a ${h!.relation} may help a business (${rule}): undeclared work if it comes out.`, [p.person]);
            ctx.emit('workforce.legalExposure', { person: p.person, party: h!.of, what: `unpaid help beyond ${law.value} days in ${y}`, rule });
          }
          booked[y] = used + n;
        }
        ctx.set('Helper', p.person, { ...h!, booked, stay: { from, until } });
        ctx.log('info', `${name} will come to help from ${ctx.calendar.format(from, 'date')} for ${p.days} working days.`, [p.person]);
        return { from, until };
      },
      { label: 'Ask a family member or friend to come and help', description: 'Ask someone from your circle (family, friends) to come and help for some working days. They arrive after their travel, work the shifts unpaid while here, and their meals are paid each day. Friends may help a business only occasionally (the labour law of the practice pack).' },
    ),
    'workforce.sendHome': command(
      s.object({ person: s.ref('person') }),
      (ctx: WriteCtx, p) => {
        const h = ctx.get('Helper', p.person);
        if (!h) ctx.reject('workforce.notAHelper', { person: ctx.get('Person', p.person)?.name ?? p.person });
        mustBeOurs(ctx, p.person);
        if (h!.resident || !h!.stay) ctx.reject('workforce.notStaying', { person: ctx.get('Person', p.person)!.name });
        const pres = ctx.get('Presence', p.person);
        if (pres?.status === 'training') ctx.reject('workforce.inTraining', { person: ctx.get('Person', p.person)!.name, until: ctx.calendar.format(pres.until!, 'date') });
        const until = Math.max(h!.stay!.from, ctx.calendar.startOfDay(ctx.now) + DAY);
        // the days not served are given back
        const booked = { ...h!.booked };
        for (const [y, n] of Object.entries(workdaysByYear(ctx, until, h!.stay!.until))) booked[y] = Math.max(0, (booked[y] ?? 0) - n);
        ctx.set('Helper', p.person, { ...h!, booked, stay: { from: h!.stay!.from, until } });
      },
      { label: 'Thank a helper and let them go home', description: 'A family member or friend goes home at the end of today (one who has not arrived yet stays at home); the days not served are not counted against next time.' },
    ),
    'workforce.enrol': command(
      s.object({ person: s.ref('person'), course: s.string() }),
      (ctx: WriteCtx, p) => {
        mustBeOurs(ctx, p.person);
        const no = enrolBlocker(ctx, p.person, p.course);
        if (no) ctx.reject(no.code, no.params);
        const { courses, offers } = coursesData(ctx);
        const course = courses[p.course]!;
        const offer = offers[p.course]!;
        const person = ctx.require('Person', p.person);
        // the next course after the lead time, then the course's working days away; the fee is paid now
        const { from, until } = courseDates(ctx, p.course, ctx.now);
        const price = offer.price.value * ctx.port('prices').index(ctx.now);
        pay(ctx, worksFor(ctx, p.person)!, ACCOUNTS.services, price, `${course.label}: ${person.name}`, [p.person]);
        ctx.set('Enrolment', p.person, { course: p.course, from, until });
        ctx.at(from, 'courseStarts', { person: p.person, course: p.course, until });
        ctx.log('info', `${person.name} will attend ${course.label} from ${ctx.calendar.format(from, 'date')} (${course.workdays.value} working days).`, [p.person]);
        return { from, until };
      },
      { label: 'Send someone to a course', description: 'Enrol an employee or a helper in a course that leads to certificates (e.g. operating earthmoving machines, chainsaw work, the CE driving licence). They are away for the course days (employees keep their wages), the fee is paid now, and afterwards they hold the certificates and some practice.' },
    ),
    'workforce.employ': command(
      s.object({ employer: s.ref('party'), job: s.string(), name: s.string().optional(), aptitude: s.number({ min: 0 }).optional(), experience: s.record(s.number({ min: 0 })).optional() }),
      (ctx: WriteCtx, p) => {
        const id = hire(ctx, p.employer, p.job, ctx.now, p.name, p.aptitude, p.experience);
        ctx.emit('workforce.joined', { person: id, job: p.job });
        return id;
      },
      'Employ (scenario setup)',
    ),
    'workforce.recruit': command(
      s.object({ job: s.string(), count: s.int({ min: 1, max: 500 }) }),
      (ctx: WriteCtx, p) => {
        const employer = actorOf(ctx);
        const job = ctx.data('jobs')[p.job];
        if (!job) ctx.reject('workforce.unknownJob', { job: p.job, jobs: jobIds(ctx) }, jobOffers(ctx, p.count));
        // (a vacancy is word to the job market: an advert, the agency, S4)
        const noWord = ctx.setup ? undefined : wordBlock(ctx, employer);
        if (noWord) ctx.reject('workforce.noWord', { to: 'the job market', why: noWord.why }, noWord.remedies);
        const expected = workforcePort(ctx).expectedStartDays(p.job, openVacancies(ctx, p.job).length + p.count - 1);
        const ids: EntityId[] = [];
        for (let i = 0; i < p.count; i += 1) {
          // (for its employer: it ends with it, decision 0028)
          const id = ctx.spawn('vacancy', { name: job.label, for: employer });
          ctx.set('Vacancy', id, {
            employer,
            job: p.job,
            openedAt: ctx.now,
            status: 'open',
          });
          ids.push(id);
        }
        const advert = job.market.advertCost.value * ctx.port('prices').index(ctx.now);
        pay(ctx, employer, ACCOUNTS.overhead, Math.round(advert * 100) / 100, `Job advert: ${p.count} × ${job.label}`, ids);
        scheduleApplicant(ctx, p.job);
        ctx.log('info', `Advertised ${p.count} × ${job.label} — the last start is expected in about ${Math.round(expected)} days`, ids);
        return ids;
      },
      'Recruit',
    ),
    'workforce.withdrawVacancy': command(
      s.object({ vacancy: s.ref('vacancy') }),
      (ctx: WriteCtx, p) => {
        const v = ctx.get('Vacancy', p.vacancy);
        if (!v) ctx.reject('workforce.unknownVacancy', { vacancy: p.vacancy });
        if (v!.employer !== actorOf(ctx)) ctx.reject('workforce.notOurs', { person: p.vacancy, party: partyLabel(ctx, actorOf(ctx)) });
        if (v.status !== 'open') ctx.reject('workforce.vacancyClosed', { vacancy: p.vacancy });
        ctx.set('Vacancy', p.vacancy, {
          ...v,
          status: 'withdrawn',
          closedAt: ctx.now,
        });
      },
      'Withdraw vacancy',
    ),
    'workforce.shortTime': command(
      s.object({ people: s.array(s.ref('person')).optional(), days: s.int({ min: 1 }) }),
      (ctx: WriteCtx, p) => {
        const law = ctx.data('labourSettings').shortTime;
        if (!law) return ctx.reject('workforce.noShortTime', {});
        const employer = actorOf(ctx);
        // (its own employees: all of them, or those named)
        const ours = [...ctx.all('Employment')].filter(([, e]) => e.employer === employer && e.leavesAt === undefined).map(([id]) => id).sort();
        const people = p.people ?? ours;
        const strangers = people.filter((x) => !ours.includes(x));
        if (strangers.length) ctx.reject('workforce.notOurEmployee', { people: strangers.map((x) => ctx.get('Person', x)?.name ?? x).join(', '), party: partyLabel(ctx, employer) });
        if (!people.length) ctx.reject('workforce.noEmployees', { party: partyLabel(ctx, employer) });
        const today = ctx.calendar.startOfDay(ctx.now);
        const until = today + p.days * DAY;
        const st = ctx.state('workforce');
        const short = { ...(st.shortTime ?? {}) };
        // (the months the insurance pays count from when it began, unless it paused long enough to begin afresh)
        const pause = law.restartAfter.value * 30.44 * DAY;
        for (const x of people) {
          const was = short[x];
          const gap = was ? Math.max(0, today - was.until) : Infinity;
          if (!(gap < pause)) {
            short[x] = { from: today, until };
            continue;
          }
          // (a pause of a month or more lengthens the period it is paid for; the bad-weather season in a pause had no
          // allowance drawn in it, so it is not taken off again as the season's: review x)
          const paused = (was!.paused ?? 0) + (gap >= 30.44 * DAY ? gap : 0);
          const seasonIdle = (was!.seasonIdle ?? 0) + (gap > 0 ? seasonTimeBetween(ctx, law, was!.until, today) : 0);
          short[x] = { from: was!.from, until, ...(paused > 0 ? { paused } : {}), ...(seasonIdle > 0 ? { seasonIdle } : {}) };
        }
        ctx.patchState('workforce', { shortTime: short });
        for (const x of people) {
          const pr = ctx.get('Presence', x);
          if (pr?.status === 'available') ctx.set('Presence', x, { ...pr, status: 'shortTime', until });
          if (pr?.status === 'shortTime') ctx.set('Presence', x, { ...pr, until });
          if (pr?.status === 'available' || pr?.status === 'shortTime') ctx.emit('workforce.absence', { person: x, kind: 'shortTime', until });
        }
        // (each one's share by their own months (§ 104 SGB III counts them per employee), as the payroll reckons it: one
        // whose months are used up and one never on it are told apart, review x)
        const shares = new Map(people.map((x) => [x, shortTimeShare(ctx, ctx.now, short[x]!, employer)]));
        const sent = people.filter((x) => shares.get(x)! >= 1);
        const on = people.filter((x) => shares.get(x)! < 1);
        const kind = ctx.get('Party', employer)?.kind ?? '';
        // (no allowance: what is left is sending them home, and that is no short time: the wage is owed in full, Qwen S503/S508)
        for (const x of people) {
          const { over: _o, ...rest } = short[x]!;
          short[x] = shares.get(x)! >= 1 ? { ...rest, over: true } : rest;
        }
        ctx.patchState('workforce', { shortTime: short });
        const date = ctx.calendar.format(until, 'day');
        if (sent.length) {
          const why = !law.eligible.includes(kind) ? 'there is no short-time allowance for it (only a business gets it)' : `${sent.length > 1 ? 'their' : 'the'} months of short-time allowance are over (${law.maxMonths.value} months, ${law.rule})`;
          ctx.log('warn', `${partyLabel(ctx, employer)} sends ${sent.length} home until ${date}: ${why}, so it is no short time: they are paid their wage in full while they stay home (${law.afterwards ?? 'the employer owes it'}).`, sent);
        }
        if (!on.length) return { until, share: 1, allowance: false };
        const share = Math.max(...on.map((x) => shares.get(x)!));
        const why = share === law.seasonal.value && law.seasonal.value !== law.remanence.value ? ' (the winter season)' : '';
        // (a course booked meanwhile is attended: training on short time is the custom)
        ctx.log('info', `${partyLabel(ctx, employer)} puts ${on.length} on short time until ${date} (${law.rule}): they stay home; the insurance pays the hours lost, the employer keeps ${Math.round(share * 100)} % of their wage cost${why}.`, on);
        return { until, share, allowance: true, ...(sent.length ? { fullPay: sent } : {}) };
      },
      { label: 'Put employees on short time', description: 'Put our employees (all, or those named) on short time for some days (Kurzarbeit, whole days): they stay home and do not work; the public insurance pays the hours lost (Kurzarbeitergeld), the firm keeps only a share of their wage cost (in the construction winter season none: Saison-Kurzarbeitergeld), for at most the law\'s months. workforce.endShortTime brings them back.' },
    ),
    'workforce.endShortTime': command(
      s.object({ people: s.array(s.ref('person')).optional() }),
      (ctx: WriteCtx, p) => {
        const employer = actorOf(ctx);
        const short = { ...(ctx.state('workforce').shortTime ?? {}) };
        // (from the next day: today is paid as a day of short time, so it is not worked; one ending already is not ended again)
        const tomorrow = ctx.calendar.startOfDay(ctx.now) + DAY;
        const on = (p.people ?? Object.keys(short)).filter((x) => short[x] && short[x]!.until > ctx.now && ctx.get('Employment', x)?.employer === employer);
        if (!on.length) ctx.reject('workforce.notOnShortTime', { party: partyLabel(ctx, employer) });
        // (those back tomorrow anyway stay as they are)
        const people = on.filter((x) => short[x]!.until > tomorrow);
        for (const x of people) {
          short[x] = { ...short[x]!, until: tomorrow };
          const pr = ctx.get('Presence', x);
          if (pr?.status === 'shortTime') ctx.set('Presence', x, { ...pr, until: tomorrow });
          // (said: work waiting for them sees when they are back)
          ctx.emit('workforce.absence', { person: x, kind: 'shortTime', until: tomorrow });
        }
        ctx.patchState('workforce', { shortTime: short });
        ctx.log('info', `${partyLabel(ctx, employer)} ends short time for ${on.length}: back at work from ${ctx.calendar.format(tomorrow, 'day')}.`, on);
      },
      { label: 'End short time', description: 'Bring employees on short time back to work (all, or those named), from the next day (today is paid as short time).' },
    ),
    'workforce.dismiss': command(
      s.object({ person: s.ref('person'), noticeDays: s.number({ min: 0 }).optional() }),
      (ctx: WriteCtx, p) => {
        const no = noticeBlock(ctx, p.person, actorOf(ctx));
        if (no) ctx.reject(no.code, no.params);
        const e = ctx.require('Employment', p.person);
        // a notice shorter than the law's takes effect at the law's date (§ 622 BGB as practice data):
        // until then the person is released from work and paid, never refused (decision 0025)
        const legal = ctx.data('labourSettings').dismissalNotice.value;
        const asked = p.noticeDays ?? legal;
        const leavesAt = Math.max(e.hiredAt, ctx.now, asked > legal ? ctx.calendar.startOfDay(ctx.now) + Math.ceil(asked) * DAY : noticeEnd(ctx, ctx.calendar.startOfDay(ctx.now) + Math.ceil(legal) * DAY));
        ctx.patch('Employment', p.person, { leavesAt });
        // (notice given: no short time any more, § 98 SGB III; back at work, or released)
        endShort(ctx, p.person);
        ctx.at(leavesAt, 'leave', { person: p.person });
        const name = ctx.require('Person', p.person).name;
        const released = asked < legal && e.hiredAt <= ctx.now && leavesAt > ctx.now;
        if (released) {
          // (one on short time is released all the same: off it, and taken up to the end of the notice)
          const pr = ctx.get('Presence', p.person);
          if (pr?.status === 'shortTime') ctx.set('Presence', p.person, { status: 'available', vacationDaysLeft: pr.vacationDaysLeft, sickDaysThisYear: pr.sickDaysThisYear });
          const now = ctx.get('Presence', p.person)!;
          ctx.set('Presence', p.person, { ...now, status: 'released', until: leavesAt });
          report(ctx, p.person);
        }
        // (what the blocker of one with no way to work offers changes with it: no second notice)
        noWayBlocker(ctx, p.person);
        ctx.log('info', leavesAt <= e.hiredAt ? `${name}: hiring cancelled before the start date` : released ? `${name} dismissed at ${Math.ceil(asked)} days' notice: the law's ${legal} days run on, so they are released from work and paid until ${ctx.calendar.format(leavesAt)}` : `${name} dismissed; leaves ${ctx.calendar.format(leavesAt)}`, [p.person]);
      },
      'Dismiss',
    ),
    'workforce.withdrawNotice': command(
      s.object({ person: s.ref('person') }),
      (ctx: WriteCtx, p) => {
        const e = ctx.get('Employment', p.person);
        const name = ctx.get('Person', p.person)?.name ?? p.person;
        if (!e || e.leavesAt === undefined) ctx.reject('workforce.noNotice', { person: name });
        // (one of a household takes back the notice they gave at a job elsewhere)
        if (ctx.get('Helper', p.person)?.of !== actorOf(ctx)) mustBeOurs(ctx, p.person);
        if (e!.leavesAt! <= ctx.now) ctx.reject('workforce.notEmployed', { person: name });
        const { leavesAt: _gone, ...kept } = e!;
        ctx.set('Employment', p.person, kept);
        noWayBlocker(ctx, p.person);
        // released from work for the notice: back at work (Qwen S115)
        const pr = ctx.get('Presence', p.person);
        if (pr?.status === 'released') {
          ctx.set('Presence', p.person, { status: 'available', vacationDaysLeft: pr.vacationDaysLeft, sickDaysThisYear: pr.sickDaysThisYear });
          ctx.emit('workforce.returned', { person: p.person });
        }
        ctx.log('info', `${name} stays: the notice is withdrawn${e!.hiredAt > ctx.now ? ' and the hire goes ahead' : ''}.`, [p.person]);
      },
      { label: 'Take back a notice', description: 'Withdraw a dismissal before the person has left (with their agreement, which they give while still employed here); a hire cancelled before its start goes ahead again.' },
    ),
    'workforce.seekWork': command(
      s.object({ person: s.ref('person'), employer: s.string(), job: s.string().optional() }),
      (ctx: WriteCtx, p) => {
        const party = actorOf(ctx);
        const name = ctx.get('Person', p.person)?.name ?? p.person;
        // one of the household, wherever they sleep now (a shelter in town too): their wages are its income; a friend at
        // home elsewhere earns for their own; one employed by a firm earns for themselves elsewhere, the firm by work it takes
        // on; a child takes no job (one fact, seekBlock: Qwen S503/S508/S513/S514, review x; robustness step 4)
        const no = seekBlock(ctx, party, p.person);
        if (no) ctx.reject(no.code, no.params);
        // (applying is word to the employer: by phone, or one of ours beyond the map, S4)
        const noWord = ctx.setup ? undefined : wordBlock(ctx, party);
        if (noWord) ctx.reject('workforce.noWord', { to: (ctx.hasData('employers') ? ctx.data('employers')?.[p.employer]?.label : undefined) ?? p.employer, why: noWord.why }, noWord.remedies);
        const town = ctx.hasData('employers') ? ctx.data('employers')?.[p.employer] : undefined;
        if (!town) ctx.reject('workforce.unknownEmployer', { employer: p.employer, employers: Object.keys((ctx.hasData('employers') ? ctx.data('employers') : undefined) ?? {}).join(', ') });
        const job = p.job ?? town!.jobs[0]!;
        if (!town!.jobs.includes(job) || !ctx.data('jobs')[job]) ctx.reject('workforce.notHiring', { employer: town!.label, job, jobs: town!.jobs.join(', ') });
        const st = ctx.state('workforce');
        if (st.seeking?.[p.person] !== undefined) ctx.cancel(st.seeking[p.person]!.timer);
        // when an opening comes is drawn now and not told (memoryless: a fork draws it again)
        const days = ctx.rng('seekWork').exponential(town!.opening.value);
        const timer = ctx.at(ctx.now + Math.round(days * DAY), 'jobOffer', { person: p.person, employer: p.employer, job });
        ctx.patchState('workforce', { seeking: { ...(st.seeking ?? {}), [p.person]: { employer: p.employer, job, timer } } });
        ctx.log('info', `${name} is looking for work at ${town!.label} (${ctx.data('jobs')[job]?.label ?? job}): an opening comes in some ${Math.round(town!.opening.value)} days on average.`, [p.person]);
        return { employer: town!.label, job };
      },
      { label: 'Look for a job in town', description: 'One of the household looks for paid work with an employer beyond the map (data: employers). When an opening comes (on average after the employer’s opening days, drawn and not told before) they are hired: from the next working day they work that employer’s shifts, commute the distance each day, are not the household’s hand meanwhile, and their wages come home after deductions. workforce.quit ends it with the law’s notice.' },
    ),
    'workforce.quit': command(
      s.object({ person: s.ref('person') }),
      (ctx: WriteCtx, p) => {
        const party = actorOf(ctx);
        const h = ctx.get('Helper', p.person);
        const e = ctx.get('Employment', p.person);
        const name = ctx.get('Person', p.person)?.name ?? p.person;
        if (!membersOf(ctx, party).includes(p.person)) ctx.reject('workforce.notAMember', { person: name, party: partyLabel(ctx, party) });
        // still looking: they stop looking
        const st = ctx.state('workforce');
        if (!e && st.seeking?.[p.person]) {
          ctx.cancel(st.seeking[p.person]!.timer);
          const { [p.person]: _gone, ...rest } = st.seeking;
          ctx.patchState('workforce', { seeking: rest });
          return { leaves: ctx.now };
        }
        if (!e || e.leavesAt !== undefined) ctx.reject('workforce.notEmployed', { person: name });
        // the law's notice (§ 622 BGB as practice data), for the employee as for the employer
        const leavesAt = noticeEnd(ctx, ctx.calendar.startOfDay(ctx.now) + Math.ceil(ctx.data('labourSettings').dismissalNotice.value) * DAY);
        ctx.patch('Employment', p.person, { leavesAt });
        ctx.at(leavesAt, 'leave', { person: p.person });
        ctx.log('info', `${name} gives notice at ${ctx.get('Party', e!.employer)?.label ?? e!.employer}: works until ${ctx.calendar.format(leavesAt, 'day')}.`, [p.person]);
        return { leaves: leavesAt };
      },
      { label: 'Give notice at a job', description: 'One of the household gives notice at a job in town (or stops looking): they work the law’s notice out and are home after it.' },
    ),
    'workforce.fallIll': command(
      s.object({ person: s.ref('person'), until: s.number({ unit: 's' }), reason: s.string() }),
      (ctx: WriteCtx, p) => {
        const pres = ctx.get('Presence', p.person);
        if (!pres || pres.status === 'gone' || pres.status === 'away') return;
        if (pres.status === 'sick' && (pres.until ?? 0) >= p.until) return;
        ctx.set('Presence', p.person, { ...pres, status: 'sick', until: p.until });
        report(ctx, p.person);
        ctx.emit('workforce.absence', { person: p.person, kind: 'sick', until: p.until });
        ctx.log('warn', `${ctx.get('Person', p.person)?.name ?? p.person} is ill (${p.reason}) until ${ctx.calendar.format(p.until, 'day')}.`, [p.person]);
      },
      { label: 'Someone falls ill (their needs, an accident)', internal: true },
    ),
    'workforce.setLead': command(
      s.object({ person: s.ref('person') }),
      (ctx: WriteCtx, p) => {
        const party = actorOf(ctx);
        if (worksFor(ctx, p.person) !== party && ctx.get('Helper', p.person)?.of !== party) return ctx.reject('workforce.notOurs', { person: ctx.get('Person', p.person)?.name ?? p.person, party: partyLabel(ctx, party) });
        const name = ctx.get('Person', p.person)?.name ?? p.person;
        if (ctx.get('Person', p.person)?.died || ctx.get('Presence', p.person)?.status === 'gone') return ctx.reject('workforce.cannotLead', { person: name, why: 'no longer here' });
        // (being put in charge is word too: it reaches them from the one in charge now, or they walk over: r39)
        const told = tell(ctx, party, p.person);
        if ('why' in told) return ctx.reject('workforce.unreachable', { person: name, why: told.why }, wordWays(ctx, party, p.person, told));
        ctx.setState('workforce', { ...ctx.state('workforce'), leads: { ...(ctx.state('workforce').leads ?? {}), [party]: p.person } });
        ctx.log('info', `${ctx.get('Person', p.person)?.name ?? p.person} is the one ${partyLabel(ctx, party)} acts through now.`, [p.person]);
      },
      { label: 'Put someone in charge', description: 'The person the party acts through: its word reaches others from where they are (within hearing, by phone), and they walk over to tell someone out of reach.' },
    ),
    'workforce.engage': command(
      s.object({ person: s.ref('person'), purpose: s.string(), ref: s.string().optional(), until: s.number({ unit: 's' }) }),
      (ctx: WriteCtx, p) => {
        if (!(p.until > ctx.now)) throw new Error(`workforce.engage: a hold of ${p.person} must end after now (decision 0028)`);
        const held = heldFrom(ctx, p.person, ctx.caller);
        if (held) ctx.reject(held.code, held.params, held.remedies);
        engage(ctx, p.person, ctx.caller, p.purpose, p.ref, p.until);
      },
      { label: 'Hold someone where they are for a purpose (a module, until a time)', internal: true },
    ),
    'workforce.take': command(
      s.object({ person: s.ref('person'), party: s.ref('party').optional() }),
      (ctx: WriteCtx, p) => take(ctx, p.person, ctx.caller, p.party),
      { label: 'Take someone\'s time to send them somewhere (refused while another holds them)', internal: true },
    ),
    'workforce.letGo': command(
      s.object({ person: s.ref('person'), ref: s.string().optional() }),
      (ctx: WriteCtx, p) => release(ctx, p.person, ctx.caller, p.ref),
      { label: 'Let go a hold on someone', internal: true },
    ),
    'workforce.goTo': command(
      s.object({ person: s.ref('person') }),
      (ctx: WriteCtx, p) => {
        const party = actorOf(ctx);
        const lead = leadOf(ctx, party);
        if (!lead) return ctx.reject('workforce.noLead', { party: partyLabel(ctx, party) });
        const moves = ctx.port('moves');
        const from = moves.where(lead);
        const to = moves.where(p.person);
        const name = (x: EntityId) => ctx.get('Person', x)?.name ?? x;
        if (p.person === lead) return ctx.reject('workforce.cannotGo', { lead: name(lead), person: name(p.person), why: 'they are the one in charge' });
        if (worksFor(ctx, p.person) !== party && ctx.get('Helper', p.person)?.of !== party) return ctx.reject('workforce.notOurs', { person: name(p.person), party: partyLabel(ctx, party) });
        // (one away or let go does not set out, nor one too ill to walk; ill but on their feet, they go: r39, illness by degrees)
        const status = ctx.get('Presence', lead)?.status ?? 'gone';
        const body = ctx.contributions('bodyCarries').map((c) => c.impl(ctx, lead)).find((x) => x !== null && x !== undefined);
        if (status === 'sick' && body && !(body.share > 0)) return ctx.reject('workforce.cannotGo', { lead: name(lead), person: name(p.person), why: `${name(lead)} is ${body.why}` });
        if (status !== 'available' && !(status === 'sick' && body)) return ctx.reject('workforce.cannotGo', { lead: name(lead), person: name(p.person), why: `${name(lead)} is ${status}` });
        if (!from || !to || moves.placeOf(lead)?.on !== undefined) return ctx.reject('workforce.cannotGo', { lead: name(lead), person: name(p.person), why: !to ? `${name(p.person)} is beyond the map` : `${name(lead)} is not free to go` });
        // (the one in charge held for another purpose (waiting at the road for a driver) does not walk off: decision 0028,
        // one owner of a person's time; review x)
        const held = heldFrom(ctx, lead, WORKFORCE_MODULE_ID, party);
        if (held) return ctx.reject(held.code, held.params, held.remedies);
        const r = ctx.command('moves.dispatch', { legs: [{ carrier: { class: ctx.data('labourSettings').ways.walk, unit: lead }, from, to, maxOffroad: WALK_OFFROAD }], purpose: 'to tell', ref: p.person, requester: WORKFORCE_MODULE_ID });
        if (!r.ok) return ctx.reject('workforce.cannotGo', { lead: name(lead), person: name(p.person), why: r.reasons.map((b) => ctx.formatBlocker(b)).join('; ') });
        const arrive = ctx.require('Move', r.value as EntityId).legs.at(-1)!.arrive;
        // (there to give the word, they stay by them for the rest of the working day (r39), an hour at least; held, then
        // to where they belong)
        const w = shiftWindow(ctx, arrive, party);
        engage(ctx, lead, WORKFORCE_MODULE_ID, 'to tell', p.person, Math.max(arrive + HOUR, w && w.end > arrive ? w.end : 0), party);
        return arrive;
      },
      { label: 'Walk over to someone', description: 'The one the party acts through walks to where someone is, to tell them what to do (within hearing when there): when they are out of hearing and a call does not reach them.' },
    ),
    'workforce.phonesCharged': command(
      s.object({ draws: s.record(s.number({ min: 0, unit: 'kWh' })) }),
      (ctx: WriteCtx, p) => {
        // what each phone drew from the source by it (its source took it from its battery or its fuel): what it keeps
        const ways = ctx.data('labourSettings').ways;
        const phones = { ...(ctx.state('workforce').phones ?? {}) };
        for (const [id, kWh] of Object.entries(p.draws).sort(([a], [b]) => (a < b ? -1 : 1))) phones[id] = { charge: Math.min(1, phoneOf(ctx, id) + (kWh * ways.phoneCharging.value) / ways.phoneBattery.value), at: ctx.now };
        ctx.setState('workforce', { ...ctx.state('workforce'), phones });
      },
      { label: 'Phones were charged from the power by them', internal: true },
    ),
    'workforce.report': command(
      s.object({ person: s.ref('person') }),
      (ctx: WriteCtx, p) => report(ctx, p.person),
      { label: 'Someone goes where they belong now (their post changed)', internal: true },
    ),
    'workforce.die': command(
      s.object({ person: s.ref('person'), cause: s.string() }),
      (ctx: WriteCtx, p) => {
        const person = ctx.get('Person', p.person);
        if (!person || person.died) return;
        const pres = ctx.get('Presence', p.person);
        // (where they are: the place the moves keep)
        const where = ctx.hasPort('moves') ? ctx.port('moves').where(p.person) : undefined;
        // (the leave not taken, to their heirs: EuGH C-569/16; review y)
        const was = ctx.get('Employment', p.person);
        if (was && (was.leavesAt === undefined || was.leavesAt > ctx.now)) settleLeave(ctx, p.person, ctx.now, true);
        ctx.set('Person', p.person, { ...person, died: { at: ctx.now, cause: p.cause, ...(where ? { where: [where[0], where[1]] as [number, number] } : {}) } });
        ctx.set('Presence', p.person, { status: 'gone', vacationDaysLeft: 0, sickDaysThisYear: pres?.sickDaysThisYear ?? 0 });
        const e = ctx.get('Employment', p.person);
        if (e && (e.leavesAt === undefined || e.leavesAt > ctx.now)) ctx.patch('Employment', p.person, { leavesAt: ctx.now });
        if (ctx.get('Helper', p.person)) ctx.remove('Helper', p.person);
        ctx.log('error', `${person.name} has died: ${p.cause}.`, [p.person]);
        ctx.emit('workforce.left', { person: p.person });
      },
      { label: 'Someone dies', internal: true },
    ),
    'workforce.detain': command(
      s.object({ person: s.ref('person'), days: s.number({ min: 0, unit: 'd' }), for: s.string(), reason: s.string() }),
      (ctx: WriteCtx, p) => {
        // taken into custody (docs/design/claims.md: detention is physical): away from home and work, unpaid, until
        // released; taken off the map by a move (the police come for them). Detentions for different things are served
        // one after the other (the second begins when the first ends)
        const pres = ctx.get('Presence', p.person);
        if (!pres || pres.status === 'gone') return;
        const held = (pres.custody ?? []).filter((c) => c.until > ctx.now);
        const from = Math.max(ctx.now, ...held.map((c) => c.until));
        const custody = [...held, { for: p.for, from, until: from + p.days * DAY }];
        const until = custody[custody.length - 1]!.until;
        ctx.set('Presence', p.person, { ...pres, status: 'away', until, custody });
        if (!held.length) {
          const moves = ctx.port('moves');
          const at = moves.where(p.person);
          const ext = ctx.port('routing').externalNodes()[0];
          if (at && ext !== undefined && moves.placeOf(p.person)?.on === undefined) ctx.command('moves.dispatch', { legs: [{ carrier: { class: ctx.data('labourSettings').ways.walk, unit: p.person }, from: [at[0], at[1]], to: [at[0], at[1]], externalDestination: ext, beyondKm: 5, maxOffroad: 5000, loads: [] }], purpose: 'into custody', ref: p.person, requester: WORKFORCE_MODULE_ID });
        }
        ctx.at(until, 'released', { person: p.person });
      },
      { label: 'Someone is taken into custody', internal: true },
    ),
    'workforce.release': command(
      s.object({ person: s.ref('person'), for: s.string(), why: s.string() }),
      (ctx: WriteCtx, p) => {
        // a detention ended early (the fine paid: § 97 Abs. 2 OWiG, § 459e StPO): those after it move up
        const pres = ctx.get('Presence', p.person);
        const was = pres?.custody?.find((c) => c.for === p.for);
        if (!pres || !was) return;
        const cut = was.until - Math.max(ctx.now, was.from);
        const custody = pres.custody!.filter((c) => c !== was && c.until > ctx.now).map((c) => (c.from >= was.until ? { ...c, from: c.from - cut, until: c.until - cut } : c));
        const until = custody.length ? custody[custody.length - 1]!.until : ctx.now;
        ctx.set('Presence', p.person, { ...pres, until, custody });
        if (was.from <= ctx.now) ctx.log('info', `${ctx.get('Person', p.person)?.name ?? p.person}: ${p.why}.`, [p.person]);
        ctx.at(until, 'released', { person: p.person });
      },
      { label: 'A detention ends early', internal: true },
    ),
    'workforce.livesElsewhere': command(
      s.object({ person: s.ref('person') }),
      (ctx: WriteCtx, p) => {
        // one of the household living beyond the map now (a room, a campsite, a shelter): not the household's hand on the
        // site, still at their job and paid for it (VISION "Leaving goes somewhere")
        const h = ctx.get('Helper', p.person);
        if (!h || !h.resident) return;
        ctx.set('Helper', p.person, { ...h, resident: false });
        const pres = ctx.get('Presence', p.person);
        if (pres?.status === 'away') ctx.set('Presence', p.person, { ...pres, status: 'available' });
      },
      { label: 'One of the household lives elsewhere now', internal: true },
    ),
    'workforce.moveIn': command(
      s.object({ person: s.ref('person') }),
      (ctx: WriteCtx, p) => {
        const h = ctx.get('Helper', p.person);
        if (!h || h.resident) return;
        ctx.set('Helper', p.person, { ...h, resident: true });
        const pres = ctx.get('Presence', p.person);
        if (pres?.status === 'away') ctx.set('Presence', p.person, { ...pres, status: 'available' });
        report(ctx, p.person);
      },
      { label: 'One of the household lives here again', internal: true },
    ),
    'workforce.goHome': command(
      s.object({ person: s.ref('person'), reason: s.string() }),
      (ctx: WriteCtx, p) => {
        const h = ctx.get('Helper', p.person);
        if (!h) return;
        // someone living here leaves the site: no longer resident, away
        if (h.resident) {
          ctx.set('Helper', p.person, { ...h, resident: false });
          const pres = ctx.get('Presence', p.person);
          if (pres && pres.status !== 'away') {
            ctx.set('Presence', p.person, { status: 'away', vacationDaysLeft: 0, sickDaysThisYear: pres.sickDaysThisYear });
            ctx.emit('workforce.helperLeft', { person: p.person });
          }
          ctx.log('warn', `${ctx.get('Person', p.person)?.name ?? p.person} leaves the site: ${p.reason}.`, [p.person]);
          report(ctx, p.person);
          return;
        }
        if (!h.stay || h.stay.until <= ctx.now) return;
        const until = Math.max(h.stay.from, ctx.now);
        const booked = { ...h.booked };
        for (const [y, n] of Object.entries(workdaysByYear(ctx, until, h.stay.until))) booked[y] = Math.max(0, (booked[y] ?? 0) - n);
        ctx.set('Helper', p.person, { ...h, booked, stay: { from: h.stay.from, until } });
        const pres = ctx.get('Presence', p.person);
        if (pres && pres.status !== 'away') {
          ctx.set('Presence', p.person, { status: 'away', vacationDaysLeft: 0, sickDaysThisYear: pres.sickDaysThisYear });
          ctx.emit('workforce.helperLeft', { person: p.person });
        }
        ctx.log('warn', `${ctx.get('Person', p.person)?.name ?? p.person} has had enough and goes home: ${p.reason}.`, [p.person]);
      },
      { label: 'A helper goes home early (they had enough)', internal: true },
    ),
  },
  /**
   * A hypothetical branch (a what-if fork): when the next applicants turn up is not known in the
   * real world, so it is drawn again (arrivals are memoryless: a fresh draw from now is exact).
   */
  branch(ctx) {
    // a fork does not know when an opening comes for someone looking for work: drawn again
    for (const [person, sk] of Object.entries(ctx.state('workforce').seeking ?? {})) {
      ctx.cancel(sk.timer);
      const town = ctx.data('employers')?.[sk.employer];
      if (!town) continue;
      const timer = ctx.at(ctx.now + Math.round(ctx.rng('seekWork').exponential(town.opening.value) * DAY), 'jobOffer', { person, employer: sk.employer, job: sk.job });
      ctx.patchState('workforce', { seeking: { ...(ctx.state('workforce').seeking ?? {}), [person]: { ...sk, timer } } });
    }
    const st = ctx.state('workforce');
    const jobs = Object.keys(st.nextApplicant);
    if (!jobs.length) return;
    ctx.patchState('workforce', { nextApplicant: {} });
    for (const job of jobs) scheduleApplicant(ctx, job);
  },
  // what was for a party that ended (decision 0028): its adverts are withdrawn; nobody is hired for a party with nobody left
  ended: {
    vacancy: (ctx, id, cause) => {
      const v = ctx.get('Vacancy', id);
      if (v?.status === 'open') {
        ctx.set('Vacancy', id, { ...v, status: 'withdrawn', closedAt: ctx.now });
        ctx.log('info', `The advert for ${ctx.data('jobs')[v.job]?.label ?? v.job} is withdrawn: ${cause.why}.`, [id]);
      }
      ctx.end(id, cause.why);
    },
  },
  timers: {
    // a working day begins: its payroll, by its own facts
    payroll(ctx, payload: { day: number }) {
      payroll(ctx, payload.day);
    },
    // a hold's end (decision 0028): the person goes where they belong
    holdEnds(ctx, payload: { person: EntityId; until: number }) {
      const e = ctx.get('Engaged', payload.person);
      if (e && e.until === payload.until) release(ctx, payload.person);
    },
    courseStarts(ctx, payload: { person: EntityId; course: string; until: number }) {
      const p = ctx.get('Presence', payload.person);
      if (ctx.get('Enrolment', payload.person)) ctx.remove('Enrolment', payload.person);
      if (!p) return;
      // sick, on holiday, left or gone home on the first day: the course is missed, the fee is lost
      const why = !memberAt(ctx, payload.person, ctx.now) ? 'no longer with you' : p.status === 'released' ? 'released from work for the notice' : p.status !== 'available' && p.status !== 'shortTime' ? p.status : null;
      if (why) {
        ctx.log('warn', `${ctx.get('Person', payload.person)?.name ?? payload.person} missed ${(ctx.hasData('courses') ? ctx.data('courses') : undefined)?.[payload.course]?.label ?? payload.course} (${why}); the fee is lost.`, [payload.person]);
        return;
      }
      ctx.set('Presence', payload.person, { status: 'training', until: payload.until, course: payload.course, vacationDaysLeft: p.vacationDaysLeft, sickDaysThisYear: p.sickDaysThisYear });
      report(ctx, payload.person);
      ctx.emit('workforce.absence', { person: payload.person, kind: 'training', until: payload.until });
    },
    applicant(ctx, payload: { job: string; at: number }) {
      const st = ctx.state('workforce');
      if (st.nextApplicant[payload.job] !== payload.at) return; // superseded
      const { [payload.job]: _done, ...rest } = st.nextApplicant;
      ctx.patchState('workforce', { nextApplicant: rest });
      // (no one is taken on by a party being wound up: its vacancies are withdrawn)
      const prices = ctx.hasPort('prices') ? ctx.port('prices') : undefined;
      const open = openVacancies(ctx, payload.job).filter((v) => !prices?.windingUp(ctx.require('Vacancy', v).employer) && !endedBlock(ctx, ctx.require('Vacancy', v).employer));
      const vacancy = open[0];
      if (!vacancy) return;
      const job = ctx.data('jobs')[payload.job]!;
      const starts = startAfterNotice(ctx, job.market.noticePeriod.value);
      const person = hire(ctx, ctx.require('Vacancy', vacancy).employer, payload.job, starts);
      // (one taken from the region's pool of job seekers for it: 8c)
      if (job.market.pool) {
        const pools = ctx.state('workforce').pools ?? {};
        const taken = (1 - poolShare(ctx, payload.job)) * job.market.pool.size.value;
        ctx.patchState('workforce', { pools: { ...pools, [payload.job]: { taken: taken + 1, at: ctx.now } } });
      }
      ctx.set('Vacancy', vacancy, {
        ...ctx.require('Vacancy', vacancy),
        status: 'filled',
        person,
        closedAt: ctx.now,
      });
      ctx.at(starts, 'arrive', { person });
      ctx.emit('workforce.vacancyFilled', {
        vacancy,
        person,
        job: payload.job,
        starts,
      });
      ctx.log('success', `Hired ${ctx.require('Person', person).name} as ${job.label} — starts ${ctx.calendar.format(starts)} after notice at their current employer`, [person, vacancy]);
      if (open.length > 1) scheduleApplicant(ctx, payload.job);
    },
    // out of custody: back to their own (home or work, by a move)
    released(ctx, payload: { person: EntityId }) {
      const pres = ctx.get('Presence', payload.person);
      if (!pres || pres.status !== 'away' || (pres.until ?? Infinity) > ctx.now) return;
      const { custody: _c, ...rest } = pres;
      ctx.set('Presence', payload.person, { ...rest, status: 'available' });
      ctx.log('info', `${ctx.get('Person', payload.person)?.name ?? payload.person} is released from custody.`, [payload.person]);
      report(ctx, payload.person);
    },
    arrive(ctx, payload: { person: EntityId }) {
      const e = ctx.get('Employment', payload.person);
      if (!e || !employedAt(e, ctx.now)) return;
      ctx.emit('workforce.joined', { person: payload.person, job: e.job });
      ctx.log('success', `${ctx.require('Person', payload.person).name} starts as ${ctx.data('jobs')[e.job]?.label ?? e.job}`, [payload.person]);
    },
    jobOffer(ctx, payload: { person: EntityId; employer: string; job: string }) {
      const st = ctx.state('workforce');
      const seeking = st.seeking?.[payload.person];
      if (!seeking || seeking.employer !== payload.employer) return;
      const { [payload.person]: _done, ...rest } = st.seeking!;
      ctx.patchState('workforce', { seeking: rest });
      const h = ctx.get('Helper', payload.person);
      const town = ctx.data('employers')![payload.employer]!;
      // (still one who may take a job: the same fact as the search's)
      if (!h || seekBlock(ctx, h.of, payload.person)) return;
      // the employer is a party of the world beyond the map
      if (!ctx.get('Party', payload.employer)) ctx.command('parties.add', { id: payload.employer, label: town.label, kind: 'company' });
      const job = ctx.data('jobs')[payload.job]!;
      // from the employer's next shift (today's, if it has not begun)
      const start = nextShiftStart(ctx, ctx.now, payload.employer);
      ctx.set('Employment', payload.person, { employer: payload.employer, job: payload.job, hourlyWage: job.hourlyWage.value, hiredAt: start });
      // the leave of their first year, as any hire's
      const pres = ctx.get('Presence', payload.person);
      // (leave not taken at a job before was paid out when it ended: the new one owes its own, from its start, less what
      // an earlier one gave this year, § 6 BUrlG)
      if (pres) ctx.set('Presence', payload.person, { ...pres, vacationDaysLeft: hireLeave(ctx, payload.person, start) });
      const name = ctx.get('Person', payload.person)?.name ?? payload.person;
      ctx.log('success', `${name} is hired by ${town.label} as ${job.label}: starts ${ctx.calendar.format(start, 'day')}, ${town.distance.value} km to work each way.`, [payload.person]);
      ctx.emit('workforce.joined', { person: payload.person, job: payload.job });
    },
    leave(ctx, payload: { person: EntityId }) {
      const p = ctx.get('Presence', payload.person);
      if (!p || p.status === 'gone') return;
      // a notice taken back (or replaced) is not this one
      const e = ctx.get('Employment', payload.person);
      if (!e || e.leavesAt === undefined || e.leavesAt > ctx.now) return;
      // (the leave not taken, paid out with the last wages: § 7 Abs. 4 BUrlG, review y)
      settleLeave(ctx, payload.person, e.leavesAt);
      // one of a household who worked for someone: the job ends, they are home
      if (ctx.get('Helper', payload.person)) {
        ctx.remove('Employment', payload.person);
        ctx.log('info', `${ctx.get('Person', payload.person)?.name ?? payload.person} has left the job and is home.`, [payload.person]);
        ctx.emit('workforce.returned', { person: payload.person });
        return;
      }
      ctx.set('Presence', payload.person, { status: 'gone', vacationDaysLeft: 0, sickDaysThisYear: p.sickDaysThisYear });
      const { [payload.person]: _dropped, ...plan } = ctx.state('workforce').vacationPlan;
      ctx.patchState('workforce', { vacationPlan: plan });
      ctx.emit('workforce.left', { person: payload.person });
      report(ctx, payload.person);
    },
    // someone sets out now, to be there by `by`
    reportAt(ctx, payload: { person: EntityId; by: number }) {
      report(ctx, payload.person, payload.by);
    },
    // a party's working day begins (its people there by `by`) or ends
    report(ctx, payload: { party: EntityId; by: number }) {
      for (const id of staffAt(ctx, payload.by)) if (partyHere(ctx, id) === payload.party) report(ctx, id, payload.by);
    },
  },
  systems: [
    { id: 'daily', every: DAY, phase: 'agents', run: (ctx) => dailyRun(ctx) },
  ],
  on: {
    // someone a move left somewhere (back from an errand, at the yard, at home): on to where they belong now, if that is
    // elsewhere (r36: one out after the shift stayed out until midnight)
    'moves.legDone': (ctx, e) => {
      // (one held there for a purpose stays for it: the one in charge come to give the word (r39), one come to take goods
      // from a driver (S5); decision 0028, the hold of a person's time, not a list of purposes)
      // (their phone: at a socket from when they are beyond the map where one charges it, as long as they stay; come in
      // again, what it gained there, running down from when they set out: one rule, `phoneCharge`; review x)
      const mv = ctx.get('Move', e.move);
      const leg = mv?.legs[e.leg];
      if (mv && leg && (leg.toNode !== undefined || leg.fromNode !== undefined)) {
        const units = [...(leg.carrier.unit ? [leg.carrier.unit] : []), ...leg.loads.flatMap((l) => ('person' in l ? [l.person] : []))].filter((u) => ctx.get('Presence', u));
        for (const u of units) {
          const ph = ctx.state('workforce').phones?.[u];
          if (leg.toNode !== undefined && (CHARGED_BEYOND.has(mv.purpose) || e.leg === mv.legs.length - 1)) phoneAt(ctx, u, { socket: true });
          else if (leg.fromNode !== undefined && (ph?.socket || !ph)) phoneAt(ctx, u, ph ? { charge: chargeAt(ctx, ph, leg.depart), at: leg.depart } : { charge: 1, at: leg.depart });
        }
      }
      for (const u of e.left ?? []) {
        if (!ctx.get('Presence', u)) continue;
        if (!engagedNow(ctx, u)) report(ctx, u);
      }
    },
    // a move stopped with them on it (broken down, run dry): they go on from where it stands, on foot
    'moves.stopped': (ctx, e) => {
      for (const u of e.units) if (ctx.get('Presence', u)) report(ctx, u);
    },
    // insolvency proceedings opened: the administrator gives the party's employees notice (the law's, at most its cap: § 113 InsO)
    'economy.insolvencyOpened': (ctx, p) => windUpStaff(ctx, p.party),
  },
  setup(ctx) {
    const set = ctx.data('labourSettings');
    const quals = ctx.data('qualifications');
    for (const [id, job] of Object.entries(ctx.data('jobs'))) {
      for (const q of job.qualifications) if (!quals[q]) throw new Error(`jobs.${id}: unknown qualification "${q}"`);
    }
    if (set.schedule.length !== 7) throw new Error(`labourSettings.schedule: expected 7 days (Mon..Sun), got ${set.schedule.length}`);
    set.schedule.forEach((d, i) => {
      if (d.end.value <= d.start.value) return;
      const presence = d.end.value - d.start.value;
      const paid = presence - d.breaks.value;
      const law = (p: { source?: { title: string } }) => (p.source ? ` (${p.source.title})` : '');
      if (paid > set.maxDailyHours.value + 1e-9) throw new Error(`labourSettings.schedule[${i}]: ${paid} h paid exceeds maxDailyHours ${set.maxDailyHours.value} h${law(set.maxDailyHours)}`);
      const rule = set.minBreaks.filter((b) => paid > b.over.value + 1e-9).sort((a, b) => b.break.value - a.break.value)[0];
      if (rule && d.breaks.value + 1e-9 < rule.break.value) throw new Error(`labourSettings.schedule[${i}]: ${d.breaks.value} h breaks < ${rule.break.value} h required for ${paid} h${law(rule.break)}`);
    });
    if (set.names.first.length === 0 || set.names.last.length === 0) throw new Error('labourSettings.names: need first and last names');
    // (a year's leave kept at most into the year after next: two carried buckets)
    const kept = set.vacationCarryOver?.keptMonths?.value;
    if (kept !== undefined && !(kept > 0 && kept <= 24)) throw new Error(`labourSettings.vacationCarryOver.keptMonths: ${kept} months (0 < months ≤ 24)`);
    ctx.setState('workforce', { ...ctx.state('workforce'), year: ctx.calendar.at(ctx.now).year });
  },
  ports: { workforce: workforcePort },
  contributes: {
    // who is left of a party (its end, decision 0025/0028): its people now, and those bound to come to it
    population: () => (read: ReadCtx, party: EntityId) => [...population(read, party), ...bound(read, party)],
    // how a party's word gets out to a firm (S4): a company, a bank, a public body by its office (beyond the map); a
    // household or a person by one of its people with a phone with charge left, or one beyond the map
    wordOut: () => (read: ReadCtx, party: EntityId) => {
      const kind = read.get('Party', party)?.kind;
      if (!kind) return undefined;
      if (kind !== 'household' && kind !== 'person' && kind !== 'group') return { via: 'office' };
      // (the word starts with the one in charge: beyond the map, or on their phone, or through one of ours they tell who
      // has a phone with charge left; review S4 #5)
      const lead = leadOf(read, party);
      // (none of its living people in the world: it lives beyond the map, where its word gets out)
      if (!lead) return { via: 'beyond' };
      const name = (p: EntityId) => read.get('Person', p)?.name ?? p;
      if (!read.hasPort('moves') || !read.port('moves').where(lead)) return { via: 'beyond' };
      if (phoneOf(read, lead) > 0) return { via: 'phone' };
      const people = population(read, party).filter((p) => p !== lead);
      for (const p of people) {
        const t = tell(read, party, p);
        if (!('why' in t) && (!read.port('moves').where(p) || phoneOf(read, p) > 0)) return { via: read.port('moves').where(p) ? 'phone' : 'beyond' };
      }
      // (the way: one of ours the word reaches, fit to walk, walks into town, where they phone and see people, and
      // charge the phone; review S4 #6)
      const routing = read.port('routing');
      const walk = read.data('labourSettings').ways.walk;
      const goer = [lead, ...people].find((p) => {
        const w = read.port('moves').where(p);
        if (!w || read.port('moves').placeOf(p)?.on !== undefined || read.get('Presence', p)?.status !== 'available' || 'why' in tell(read, party, p)) return false;
        return routing.externalNodes().some((n) => routing.routeToExternal([w[0], w[1]], n, walk) !== null);
      });
      // (nobody to go now, the one in charge on a way: until they are back)
      const on = read.port('moves').placeOf(lead)?.on;
      const back = on !== undefined && read.has('Move', on) ? read.require('Move', on).legs.at(-1)!.arrive : undefined;
      // (staying there as long as the phone takes to charge: its charger's hours, at least the hour the errand stays)
      const stay = goer ? Math.min(12, Math.max(1, Math.ceil(hoursToCharge(read, phoneOf(read, goer))))) : 1;
      const remedies: Remedy[] = goer ? [{ label: `${name(goer)} walks into town and stays ${stay} h: from there our word gets out, and the phone is charged`, command: { type: 'errands.goToTown', payload: { person: goer, hours: stay } } }] : back !== undefined ? [{ label: `Wait until ${name(lead)} is back (${read.calendar.format(back, 'time')})`, wait: { until: back } }] : [];
      return { why: `nobody of ours has a phone with charge left (${[lead, ...people].filter((p) => read.port('moves').where(p)).map(name).join(', ')}: flat), and the one in charge is not away where one reaches them`, remedies };
    },
    // where a household's money could come from: one of its own who may look for work (wherever they live; not a child)
    // and is not looking yet looks for it in town (the same population workforce.seekWork accepts: review x)
    financing: () => (read: ReadCtx, holder: EntityId) => {
      const employers = Object.entries((read.hasData('employers') ? read.data('employers') : undefined) ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
      if (!employers.length) return [];
      return jobSeekersOf(read, holder)
        .filter((id) => !read.state('workforce').seeking?.[id])
        .sort()
        .flatMap((id) => employers.map(([employer, e]) => ({ label: `${read.get('Person', id)?.name ?? id} looks for work: ${e.label} (an opening in some ${Math.round(e.opening.value)} days)`, command: { type: 'workforce.seekWork', payload: { person: id, employer } } })));
    },
  },
  projections: {
    'workforce.roster': {
      label: 'Staff roster',
      description: 'args: ids (optional: only these people), party (whose staff; a client sees its own)',
      compute(ctx, args?: { ids?: EntityId[]; party?: EntityId }): RosterEntry[] {
        const port = workforcePort(ctx);
        const out: RosterEntry[] = [];
        // only these (Qwen S113: the filter was ignored); until as a date too, not only in seconds
        const wanted = (id: EntityId) => !args?.ids?.length || args.ids.includes(id);
        const dated = (r: RosterEntry, party: EntityId): RosterEntry => {
          const t = tell(ctx, party, r.id);
          const word = { lead: leadOf(ctx, party) === r.id, ...('why' in t ? { why: t.why } : { how: t.how }), phone: Math.round(phoneOf(ctx, r.id) * 100) };
          const on = ctx.hasPort('moves') ? ctx.port('moves').placeOf(r.id)?.on : undefined;
          const mv = on !== undefined ? ctx.get('Move', on) : undefined;
          const onTheWay = mv ? { purpose: mv.purpose, until: mv.legs.at(-1)!.arrive, untilDate: ctx.calendar.format(mv.legs.at(-1)!.arrive) } : undefined;
          return { ...r, ...(r.until !== undefined ? { untilDate: ctx.calendar.format(r.until) } : {}), ...(r.status === 'gone' ? {} : { word }), ...(onTheWay ? { onTheWay } : {}) };
        };
        for (const [id, e] of ctx.all('Employment')) {
          const p = ctx.get('Presence', id);
          const person = ctx.get('Person', id);
          if (!p || !person) continue;
          if (p.status === 'gone' || !wanted(id) || (args?.party && e.employer !== args.party)) continue;
          const r: RosterEntry = {
            id,
            name: person.name,
            job: e.job,
            status: e.hiredAt > ctx.now ? 'recruiting' : absentAt(p, ctx.now) ? p.status : 'available',
            hourlyCost: port.hourlyCost(id),
            vacationDaysLeft: Math.round(p.vacationDaysLeft * 10) / 10,
            sickDaysThisYear: p.sickDaysThisYear,
          };
          if (e.hiredAt > ctx.now) r.until = e.hiredAt;
          else if (p.until !== undefined && p.until > ctx.now) r.until = p.until;
          // one of a household with a job elsewhere: one row, as theirs, at no cost to them
          const h = ctx.get('Helper', id);
          if (h) Object.assign(r, { hourlyCost: 0, helper: { relation: h.relation, resident: h.resident, moreDaysThisYear: 0 } });
          // (one of a household with a job elsewhere is told by the household's lead)
          out.push(dated(r, ctx.get('Helper', id)?.of ?? e.employer));
        }
        // the circle: family and friends, here or not
        for (const [id, h] of ctx.all('Helper')) {
          const p = ctx.get('Presence', id);
          const person = ctx.get('Person', id);
          if (!p || !person || ctx.get('Employment', id) || !wanted(id) || (args?.party && h.of !== args.party)) continue;
          const here = helperHere(h, ctx.now);
          out.push(dated({ id, name: person.name, job: h.relation, status: here ? (absentAt(p, ctx.now) ? p.status : 'available') : 'away', hourlyCost: 0, vacationDaysLeft: 0, sickDaysThisYear: p.sickDaysThisYear, helper: { relation: h.relation, resident: h.resident, moreDaysThisYear: h.resident ? 0 : helpDaysLeftIn(ctx, h, ctx.calendar.at(ctx.now).year), ...(h.stay ? { stay: h.stay } : {}) }, ...(h.stay && h.stay.until > ctx.now ? { until: here ? h.stay.until : h.stay.from } : {}) }, h.of));
        }
        return out;
      },
    },
    'workforce.jobs': {
      label: 'The jobs of the regional labour market (what workforce.recruit advertises)',
      compute(ctx) {
        const index = ctx.port('prices').index(ctx.now);
        return Object.entries(ctx.data('jobs')).map(([id, j]) => ({ id, label: j.label, qualifications: j.qualifications, hourlyWage: j.hourlyWage.value, advertCost: Math.round(j.market.advertCost.value * index), noticeDays: j.market.noticePeriod.value, expectedStartDays: Math.round(workforcePort(ctx).expectedStartDays(id)) }));
      },
    },
    'workforce.vacancies': {
      label: 'Open vacancies',
      compute(ctx) {
        const port = workforcePort(ctx);
        const byJob: Record<string, number> = {};
        const out: {
          id: EntityId;
          job: string;
          label: string;
          openedAt: number;
          expectedStartDays: number;
        }[] = [];
        for (const id of openVacancies(ctx)) {
          const v = ctx.require('Vacancy', id);
          const before = byJob[v.job] ?? 0;
          byJob[v.job] = before + 1;
          out.push({
            id,
            job: v.job,
            label: ctx.data('jobs')[v.job]?.label ?? v.job,
            openedAt: v.openedAt,
            expectedStartDays: port.expectedStartDays(v.job, before),
          });
        }
        return out;
      },
    },
    'workforce.totals': {
      label: 'Workforce statistics',
      compute: (ctx) => ctx.state('workforce').totals,
    },
  },
});
