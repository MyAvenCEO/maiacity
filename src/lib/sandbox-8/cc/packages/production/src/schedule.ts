/**
 * Schedule forecast (CPM forward pass on a working calendar with expected weather).
 *
 * Planning may only use what a real planner knows: the shift calendar and long-term
 * climate normals — never the actual future weather. Expected workability per month is
 * derived from normals (wet-day frequency, temperature distribution) and the activity's
 * weather limits. Resource levelling is not modelled here (packages are assumed to get their
 * crew when predecessors allow) — the live dispatcher decides the real sequence.
 */
import { DAY, HOUR, type EntityId, type ReadCtx } from '../../kernel/src/index.ts';
import { isSubcontracted, subcontractOnly, type Activity, type ScheduleRow, type WorkPackage } from './contract.ts';
import { workParty } from './supply.ts';

const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** standard normal CDF (Abramowitz–Stegun 7.1.26 via erf) */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** expected share of scheduled working time that weather allows, for a calendar month */
export function expectedWorkability(read: ReadCtx, activity: Activity, month: number): number {
  const n = read.port('weather').normals(month);
  const wetShare = Math.min(1, n.wetDays / DAYS_IN_MONTH[month - 1]!);
  let avail = 1;
  const w = activity.weather;
  // a wet day costs roughly half a shift for rain-sensitive work (rain is not all-day)
  if (w.maxPrecip) avail *= 1 - 0.5 * wetShare;
  // cohesive soil needs drying time after rain
  if (w.trafficability === 'good') avail *= 1 - 0.35 * wetShare;
  else if (w.trafficability === 'reduced') avail *= 1 - 0.15 * wetShare;
  if (w.minTemp) {
    const workingTemp = n.tMean + 0.5 * (n.tMax - n.tMean); // daytime temperature during shifts
    avail *= 1 - phi((w.minTemp.value - workingTemp) / 4.0);
  }
  if (w.maxFrostDepth) {
    if (n.tMean < 0) avail *= 0.4;
    else if (n.tMean < 2) avail *= 0.75;
  }
  return Math.max(0.05, Math.min(1, avail));
}

/** the light own work outdoors needs (lx, S7): its activity's, else the settings'; none for a firm's crew (it brings its lights) */
export function lightNeed(read: ReadCtx, pkg: { contractor?: string | undefined }, activity: Activity): number | undefined {
  if (isSubcontracted(pkg, activity)) return undefined;
  return activity.weather.minLight?.value ?? (read.data('productionSettings') as { light?: { work: { value: number } } }).light?.work.value;
}

/** a party with a light tower of its own to use: its work is not held to daylight in the plan (S7) */
function lightsOwn(read: ReadCtx, party: EntityId | undefined, need: number): boolean {
  if (!party) return false;
  const eq = read.port('equipment');
  return eq.machines().some((m) => (eq.modelOf(m).light?.lux.value ?? 0) >= need && read.get('Machine', m)?.status !== 'broken' && eq.usableBy(m, party));
}

/** when a day is light enough for work (lx), under a clear sky, between `from` and `to` (astronomy: known ahead), in quarter hours; cached */
const LIT = new Map<string, [number, number] | null>();
function litBetween(read: ReadCtx, from: number, to: number, need: number): [number, number] | null {
  const w = read.port('weather');
  const key = `${w.location.lat},${w.location.lon}|${from}|${to}|${need}`;
  const hit = LIT.get(key);
  if (hit !== undefined) return hit;
  let first: number | undefined;
  let last: number | undefined;
  for (let t = from; t <= to; t += HOUR / 4) {
    if (w.clearLight(t) < need) continue;
    first ??= t;
    last = t;
  }
  const out: [number, number] | null = first !== undefined ? [first, Math.min(to, last! + HOUR / 4)] : null;
  if (LIT.size > 20000) LIT.clear();
  LIT.set(key, out);
  return out;
}

/** walk the working calendar from t consuming `hours` of productive time (own work needing light: in the light of each day, S7) */
function addWorkingHours(read: ReadCtx, activity: Activity, t: number, hours: number, party?: EntityId, need?: number): number {
  const wf = read.port('workforce');
  let remaining = hours;
  let cursor = t;
  const dark = need !== undefined && read.hasPort('weather') && !lightsOwn(read, party, need);
  for (let guard = 0; guard < 3650 && remaining > 1e-9; guard += 1) {
    const dayStart = Math.floor(cursor / DAY) * DAY;
    const win0 = wf.shiftWindow(dayStart + 12 * HOUR, party);
    const lit = win0 && dark ? litBetween(read, win0.start, win0.end, need!) : undefined;
    const win = win0 && lit !== null ? (lit ? { ...win0, start: lit[0], end: lit[1] } : win0) : undefined;
    if (win && win0 && cursor < win.end) {
      const from = Math.max(cursor, win.start);
      // (the paid share of the shift as it is; the dark hours of it are not worked)
      const productive = (win0.paidHours / ((win0.end - win0.start) / HOUR)) * expectedWorkability(read, activity, read.calendar.at(dayStart).month);
      const capacity = ((win.end - from) / HOUR) * productive;
      if (capacity >= remaining) return from + (remaining / productive) * HOUR;
      remaining -= capacity;
    }
    cursor = dayStart + DAY;
  }
  return cursor;
}

/** stops of the weather and the ground pass by themselves; any other stop needs a decision */
const PASSING = new Set(['production.weatherRain', 'production.weatherCold', 'production.weatherWind', 'production.soilTooWet', 'production.groundFrozen']);

/**
 * Whether a package goes on by itself: `stalled` when a stop needs a decision (not let to a firm, or a
 * block that offers no waiting); `resumes` when its stops pass by themselves on known days.
 */
function stopsOf(read: ReadCtx, id: EntityId, p: Readonly<WorkPackage>, activity: Activity): { stalled?: string; resumes?: number } {
  if (subcontractOnly(activity) && !p.contractor) return { stalled: 'not let to a firm' };
  if (p.status !== 'ready' && p.status !== 'active') return {};
  let resumes: number | undefined;
  for (const b of read.blockersOf(id)) {
    if (b.severity !== 'block' || PASSING.has(b.code)) continue;
    const wait = b.remedies?.find((r) => r.wait)?.wait;
    if (!wait) return { stalled: `blocked: ${read.formatBlocker(b)}` };
    if (wait.until !== undefined) resumes = Math.max(resumes ?? 0, wait.until);
  }
  return resumes !== undefined ? { resumes } : {};
}

/** how long work that cures still takes after `from` (s): its equivalent age left, at the mean air of the month (S6) */
export function curingAhead(read: ReadCtx, id: EntityId, from: number): number {
  const pkg = read.get('WorkPackage', id);
  if (!pkg || pkg.status === 'cancelled' || (pkg.data as { removal?: boolean } | undefined)?.removal) return 0;
  const c = read.data('activities')[pkg.activity]?.cures;
  if (!c || !Number.isFinite(from)) return 0;
  const left = Math.max(0, c.age.value - (pkg.status === 'done' ? (pkg.cured ?? 0) : 0));
  if (left <= 0) return 0;
  const air = read.hasPort('weather') ? read.port('weather').normals(read.calendar.at(Math.max(from, read.now)).month).tMean : c.reference.value;
  const per = Math.max(0.05, (air - c.datum.value) / (c.reference.value - c.datum.value));
  return Math.round((left / per) * HOUR);
}

export function forecastSchedule(read: ReadCtx, project: EntityId, needs?: (id: EntityId) => { per: Record<string, number>; storeOf: Record<string, EntityId | undefined> }): ScheduleRow[] {
  const pr = read.get('Project', project);
  if (!pr) return [];
  const acts = read.data('activities');
  const pkgs = new Map<EntityId, Readonly<WorkPackage>>();
  for (const id of pr.packages) {
    const p = read.get('WorkPackage', id);
    if (p) pkgs.set(id, p);
  }
  // topological order (Kahn, stable)
  const order: EntityId[] = [];
  const placed = new Set<EntityId>();
  while (order.length < pkgs.size) {
    const next = [...pkgs.keys()].find((id) => !placed.has(id) && pkgs.get(id)!.after.every((l) => placed.has(l.package) || !pkgs.has(l.package)));
    if (!next) break;
    placed.add(next);
    order.push(next);
  }
  const rows = new Map<EntityId, ScheduleRow>();
  for (const id of order) {
    const p = pkgs.get(id)!;
    const activity = acts[p.activity]!;
    const proc = p.process ? read.process(p.process) : undefined;
    const done = proc?.done ?? (p.status === 'done' ? p.quantity : 0);
    const progress = p.quantity > 0 ? done / p.quantity : 1;
    const row: ScheduleRow = { package: id, label: p.label, activity: p.activity, start: read.now, finish: read.now, progress, status: p.status };
    if (p.startedAt !== undefined) row.actualStart = p.startedAt;
    if (p.completedAt !== undefined) row.actualFinish = p.completedAt;
    if (p.status === 'done' || p.status === 'cancelled') {
      row.start = p.startedAt ?? p.completedAt ?? read.now;
      row.finish = p.completedAt ?? read.now;
      rows.set(id, row);
      continue;
    }
    const stops = stopsOf(read, id, p, activity);
    if (stops.stalled) {
      row.stalled = stops.stalled;
      row.stalledAt = id;
    }
    let earliest = p.startedAt ?? read.now;
    for (const link of p.after) {
      const pred = rows.get(link.package);
      if (!pred) continue;
      // what holds the work before holds this too: the root is named
      if (pred.stalled && !row.stalled) {
        row.stalled = pred.stalled;
        row.stalledAt = pred.stalledAt!;
      }
      // (and work that cures before what follows goes on it, at the month's mean air: S6; one fact with readiness, which
      // waits for the same equivalent age by the air as it is)
      if (link.type === 'FS') earliest = Math.max(earliest, pred.finish + link.lag * HOUR + curingAhead(read, link.package, pred.finish));
      else earliest = Math.max(earliest, pred.start + link.lag * (pred.finish - pred.start));
    }
    if (p.startedAt === undefined) earliest = Math.max(earliest, read.now, p.earliestStart ?? 0);
    // not begun and short of what it builds in: not before the first delivery of it is due (Qwen S175)
    if (needs && p.startedAt === undefined) {
      const m = needs(id);
      for (const [mat, per] of Object.entries(m.per)) {
        const store = m.storeOf[mat];
        if (!store || per * (p.quantity - done) <= read.port('holdings').stock(store, mat) + 1e-9) continue;
        const due = read.port('trade').firstDue(store, mat);
        if (due !== undefined) earliest = Math.max(earliest, due);
      }
    }
    // live rates already include the break allowance that addWorkingHours applies — undo it here
    let rate = p.estimate.rate;
    if (p.status === 'active' && p.rate > 0) {
      const win = read.port('workforce').shiftWindow(read.now, workParty(read, id));
      const allowance = win ? win.paidHours / ((win.end - win.start) / HOUR) : 1;
      rate = p.rate / Math.max(0.5, allowance);
    }
    const hours = rate > 0 ? (p.quantity - done) / rate : Number.POSITIVE_INFINITY;
    row.start = p.startedAt ?? earliest;
    // stopped until a known day (the crew back, the repair done): the rest of the work from then
    let finish = Number.isFinite(hours) ? addWorkingHours(read, activity, Math.max(earliest, read.now, stops.resumes ?? 0), hours, workParty(read, id), lightNeed(read, p, activity)) : Number.POSITIVE_INFINITY;
    if (p.status === 'hold' && p.holdUntil) finish = Math.max(read.now, p.holdUntil);
    else if (activity.holdAfter) finish += activity.holdAfter.value * HOUR;
    // an SS follower cannot finish before its predecessor
    for (const link of p.after) {
      const pred = rows.get(link.package);
      if (pred && link.type === 'SS') finish = Math.max(finish, pred.finish);
    }
    row.finish = finish;
    rows.set(id, row);
  }
  return order.map((id) => rows.get(id)!);
}
