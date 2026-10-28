/**
 * Production module: turns projects into physical work over time.
 *
 * Hourly cycle (phase 'operations', plus immediate re-dispatch on relevant events and exact
 * shift-boundary timers):
 *   1. account   — operating hours → equipment wear/fuel, attributed labour/equipment cost,
 *                  staged materials consumed, produced materials stored
 *   2. release   — waiting packages whose predecessors are satisfied become ready
 *   3. assign    — complete crews (qualified operators per machine + crew roles) and machines;
 *                  never partial (no hoarding); missing resources become blockers with remedies
 *   4. rate      — shift, weather, soil, frost, breakdowns, absences, machine location and
 *                  material staging decide the hourly rate; the kernel process integrates it
 */
import { command, convert, covers, DAY, defineModule, ex, HOUR, leftOf, s, tolerance, wholeIfNear, type EntityId, type Explained, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import { containsXZ, type Vec2 } from '../../geo/src/index.ts';
import type { ForecastDay } from '../../weather/src/index.ts';
import type { SoilColumn } from '../../terrain/src/index.ts';
import { fuelOf, fuelPerHour, type MachineModel } from '../../equipment/src/index.ts';
import { fillRemedies, heldElsewhere, heldText, isCounted, unitMass, type StoreUse } from '../../inventory/src/index.ts';
import {
  award,
  awardRemedies,
  bookingRemedies,
  bookSupply,
  commute,
  consumeSupplies,
  dispatchDeliveries,
  maybePostpone,
  onTheJob,
  supplyAccessProblem,
  bookingWarning,
  reschedule,
  hurry,
  hurryOffer,
  offersFor,
  onCrewArrived,
  onSupplyArrived,
  releaseBooking,
  siteAccessProblem,
  suppliedUnits,
  wastePerishables,
  partyOf,
  frontAt,
  builtOf,
  workParty,
  inMaterialUnit,
} from './supply.ts';
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import { actorOf, mustBeLive, partyLabel, wordBlock } from '../../parties/src/index.ts';
import { jobDone, marketDay, openBooks, redrawSlips, type FirmBook, type Slip } from './firms.ts';
import { ActivitySchema, ContractorMarketSchema, ContractorSchema, isSubcontracted, ProductionSettingsSchema, subcontractOnly, type Activity, type Estimate, type PackageSpec, type ProductionPort, type Project, type ScheduleRow, type WorkPackage } from './contract.ts';
import { baseRate, flexTo, haulCycle, machineHourlyCostEstimate, readSoil, type Haulage, type RateContext, type RateResources } from './rates.ts';
import { curingAhead, forecastSchedule, lightNeed } from './schedule.ts';
import { fellsOf } from './wood.ts';
import { clearSnags, orderJustInTime, orderUpfront, supplyOptions, SupplyPolicySchema } from './supplyplan.ts';
import { hireMove, placed, unplaced } from './errands.ts';
import { carryFactor, HandlingSchema, type Carry } from './carry.ts';

interface ProductionState {
  /** areas felled by work and done: counted, what is kept of them is asked again when one is added (S3) */
  felled?: number;
  dispatchTimer: number | null;
  boundaryTimer: number | null;
  /** contractor → booked jobs */
  bookings: Record<string, { package: string; start: number; end: number }[]>;
  /** contractor → its order book and our history with it */
  firms: Record<string, FirmBook>;
  /** the month the firms' luck was last drawn */
  firmMonth: number;
  /** package → how far the jobs ahead push its start back (hidden until the firm says so) */
  slips: Record<string, Slip>;
  /** day index of the last morning commute / evening wrap-up */
  lastMorning: Record<string, number>;
  /** day index of the last hot-mix call-off decision (made before the shift) */
  lastCallOff: Record<string, number>;
  lastEvening: Record<string, number>;
  /** packages completed (stats) */
  completed: number;
  /** test pits dug (8d): whose, where, and the column seen to its depth (the class down to each depth) */
  probes?: { party: EntityId; at: Vec2; t: number; seen: { to: number; id: string }[] }[];
}

/**
 * The soil column as a party knows it there (design/physical-state.md 8d, decision 0017): the column seen in its nearest
 * test pit within reach, as deep as it went, the region's soil map below; without a pit (or without a party: a plan
 * made for nobody), the soil map (anyone's, wrong where the soil changes within a map unit). A world without these
 * rules knows the ground as it is. Plans are reckoned on it; the work meets the ground as it is.
 */
function knownColumn(read: ReadCtx, party: EntityId | undefined, pos: Vec2): { column: SoilColumn; from: 'test pit' | 'soil map' | 'the ground'; at?: Vec2; pit?: number } {
  const terrain = read.port('terrain');
  const set = read.data('productionSettings').soilKnowledge;
  if (!set) return { column: terrain.soilAt(pos[0], pos[1]), from: 'the ground' };
  const map = terrain.soilMapColumn(pos[0], pos[1]);
  let best: { d: number; p: NonNullable<ProductionState['probes']>[number] } | undefined;
  for (const p of party ? (read.state('production').probes ?? []) : []) {
    if (p.party !== party) continue;
    const d = Math.hypot(p.at[0] - pos[0], p.at[1] - pos[1]);
    if (d <= set.reach.value && (!best || d < best.d)) best = { d, p };
  }
  if (!best?.p.seen.length) return { column: map, from: 'soil map' };
  // (the pit's layers as seen, then the map's below the pit's depth)
  const layers: SoilColumn['layers'] = [];
  let top = 0;
  for (const x of best.p.seen) {
    layers.push({ classId: x.id, thickness: x.to - top });
    top = x.to;
  }
  let d = 0;
  for (const l of map.layers) {
    const below = Math.max(top, d);
    d += l.thickness;
    if (d > below) layers.push({ classId: l.classId, thickness: d - below });
  }
  return { column: { layers, rockDepth: Math.max(top, map.rockDepth) }, from: 'test pit', at: best.p.at, pit: top };
}

/** what a party knows of the soil at a depth there (no party: what the soil map says): `knownColumn` at that depth */
function knownSoil(read: ReadCtx, party: EntityId | undefined, pos: Vec2, depth: number): { id: string; from: 'test pit' | 'soil map' | 'the ground'; at?: Vec2 } {
  const k = knownColumn(read, party, pos);
  let d = 0;
  let id = k.column.layers[k.column.layers.length - 1]!.classId;
  for (const l of k.column.layers) {
    d += l.thickness;
    if (depth < d) {
      id = l.classId;
      break;
    }
  }
  // (a pit tells only of what it went through)
  if (k.from === 'test pit' && depth >= k.pit!) return { id, from: 'soil map' };
  return { id, from: k.from, ...(k.at ? { at: k.at } : {}) };
}

declare module '../../kernel/src/index.ts' {
  interface ModuleStateTypes {
    production: ProductionState;
  }
}

// ---------------------------------------------------------------- geometry helpers (local, tiny)

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function polylineLength(path: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i += 1) l += dist(path[i - 1]!, path[i]!);
  return l;
}

function pointAlong(path: Vec2[], s: number): Vec2 {
  let rest = s;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const l = dist(a, b);
    if (rest <= l || i === path.length - 1) {
      const f = l > 0 ? Math.min(1, Math.max(0, rest / l)) : 0;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    rest -= l;
  }
  return path[0] ?? [0, 0];
}

/** current work front: moves along linear works with progress */
export function workFront(pkg: Pick<WorkPackage, 'pos' | 'path'>, progress: number): Vec2 {
  if (!pkg.path || pkg.path.length < 2) return pkg.pos;
  return pointAlong(pkg.path, polylineLength(pkg.path) * Math.min(1, Math.max(0, progress)));
}

// ---------------------------------------------------------------- helpers

function activityOf(read: ReadCtx, id: string): Activity {
  const a = read.data('activities')[id];
  if (!a) throw new Error(`Unknown activity ${id}`);
  return a;
}

function progressOf(read: ReadCtx, pkg: Readonly<WorkPackage>): number {
  if (pkg.status === 'done' || pkg.status === 'hold') return 1;
  if (!pkg.process) return 0;
  const p = read.process(pkg.process);
  return p ? p.done / p.total : 0;
}

function doneOf(read: ReadCtx, pkg: Readonly<WorkPackage>): number {
  if (!pkg.process) return pkg.status === 'done' ? pkg.quantity : 0;
  return read.process(pkg.process)?.done ?? 0;
}

function projectPackages(read: ReadCtx): [EntityId, Readonly<WorkPackage>][] {
  const out: [EntityId, Readonly<WorkPackage>][] = [];
  for (const [id, pkg] of read.all('WorkPackage')) out.push([id, pkg]);
  return out;
}

function materialsPerUnit(read: ReadCtx, activity: Activity, activityId: string, pkg: Pick<WorkPackage, 'consumes'>): Record<string, number> {
  const out: Record<string, number> = {};
  const hold = read.port('holdings');
  for (const [mat, q] of Object.entries(activity.materials)) {
    const m = hold.material(mat);
    out[mat] = flexTo(q, `${m.unit}/${activity.unit}`, `activity ${activityId} material ${mat}`);
  }
  for (const [mat, v] of Object.entries(pkg.consumes)) out[mat] = v;
  return out;
}

/** materials per unit actually in use (after substitutions) and the store each comes from */
function effectiveMaterials(read: ReadCtx, id: EntityId): { per: Record<string, number>; storeOf: Record<string, EntityId | undefined> } {
  const pkg = read.require('WorkPackage', id);
  const activity = activityOf(read, pkg.activity);
  const project = read.require('Project', pkg.project);
  const defaultStore = pkg.store ?? project.store;
  const per: Record<string, number> = {};
  const storeOf: Record<string, EntityId | undefined> = {};
  for (const [mat, q] of Object.entries(materialsPerUnit(read, activity, pkg.activity, pkg))) {
    const sub = pkg.substitutes?.[mat];
    if (sub && pkg.switched?.includes(mat)) {
      per[sub.material] = (per[sub.material] ?? 0) + sub.perUnit;
      storeOf[sub.material] = pkg.supply?.[sub.material] ?? sub.store ?? defaultStore;
    } else {
      per[mat] = (per[mat] ?? 0) + q;
      storeOf[mat] = pkg.supply?.[mat] ?? defaultStore;
    }
  }
  // goods set down for the store that supplies the work (a delivery that could not reach it: the roadside drop of a
  // site's yard in a soaked field) are the yard's: the work draws from where they lie when the yard has none (S3)
  const hold = read.port('holdings');
  for (const [mat, st] of Object.entries(storeOf)) {
    if (!st || hold.free(st, mat) > 1e-6) continue;
    // (the nearest such drop to the yard, review S3 #7)
    const at = hold.where(st);
    const away = (sid: EntityId) => {
      const p = hold.where(sid);
      return at && p ? Math.hypot(p[0] - at[0], p[1] - at[1]) : 0;
    };
    const drop = hold.setDownFor(st).filter((sid) => hold.free(sid, mat) > 1e-6).sort((a, b) => away(a) - away(b) || (a < b ? -1 : 1))[0];
    if (drop) storeOf[mat] = drop;
  }
  // and what lies at the work front in another store of ours is what the work takes, the store it was told to draw from
  // having none (Qwen S502/S507/S509: a kit 0 m from the work, "materials short"; one fact: what is at hand, robustness
  // step 4); never from where the work itself puts what it makes
  const party = project.party;
  const front = workFront(pkg, progressOf(read, pkg));
  const reach = read.data('productionSettings').workReach.value;
  for (const [mat, st] of Object.entries(storeOf)) {
    if (st && hold.free(st, mat) > 1e-6) continue;
    const here = hold.ofParty(party, { kept: true, near: [front[0], front[1]], within: reach }).find((sid) => !pkg.produces?.some((o) => o.store === sid) && hold.free(sid, mat) > 1e-6);
    if (here) storeOf[mat] = here;
  }
  return { per, storeOf };
}

/** felled wood carried to the heap: from where each tree fell, in its share of the wood (logs by its stem, brash by its crown) */
function woodLegs(heap: readonly [number, number], trees: { x: number; z: number }[], amounts: number[]): Carry {
  const total = amounts.reduce((a, x) => a + x, 0);
  return { legs: trees.map((t, i) => ({ from: [t.x, t.z] as Vec2, to: [heap[0], heap[1]] as Vec2, share: total > 0 ? amounts[i]! / total : 1 / trees.length })) };
}

/** what hand work carries per unit: what it draws (its materials) and what it makes onto a store (goods produced, wood felled) */
function carriedOf(read: ReadCtx, pkg: Readonly<WorkPackage>, per0: Record<string, number>, storeOf0: Record<string, EntityId | undefined>): { per: Record<string, number>; storeOf: Record<string, Carry | undefined> } {
  const per = { ...per0 };
  const storeOf: Record<string, Carry | undefined> = { ...storeOf0 };
  // (what it moves, it draws and puts down: carried once, from where it is drawn)
  for (const p of pkg.produces ?? []) {
    if (per0[p.material] !== undefined) continue;
    per[p.material] = (per[p.material] ?? 0) + p.perUnit;
    // (made here, carried to its store)
    storeOf[p.material] = { to: p.store };
  }
  // felling: each tree's wood, on average over the trees still standing, to the heap (in the goods' units)
  const f = pkg.fells;
  if (f && f.trees.length > (pkg.felled ?? 0)) {
    const veg = read.port('vegetation');
    const left = f.trees.slice(pkg.felled ?? 0).map((t) => veg.tree(t.id)).filter((t): t is NonNullable<typeof t> => Boolean(t));
    if (left.length) {
      const hold = read.port('holdings');
      const wood = left.map((t) => veg.wood(t));
      // the work still to do for the trees still standing, in the package's unit (trees, or m³ of wood)
      const workLeft = (pkg.quantity * left.length) / Math.max(1, f.trees.length);
      const perUnit = (tons: number, mat: string) => (tons * 1000) / unitMass(hold.material(mat)) / Math.max(1e-9, workLeft);
      per[f.logs] = (per[f.logs] ?? 0) + perUnit(wood.reduce((a, w) => a + w.stem, 0), f.logs);
      per[f.brash] = (per[f.brash] ?? 0) + perUnit(wood.reduce((a, w) => a + w.crown, 0), f.brash);
      // carried from where each tree fell to the heap, each its own way
      const heap = read.port('holdings').where(f.store);
      storeOf[f.logs] = heap ? woodLegs(heap, left, wood.map((w) => w.stem)) : { to: f.store };
      storeOf[f.brash] = heap ? woodLegs(heap, left, wood.map((w) => w.crown)) : { to: f.store };
    }
  }
  return { per, storeOf };
}

function standardResources(read: ReadCtx, activity: Activity): { res: RateResources; equipment: Estimate['equipment'] } {
  const settings = read.data('productionSettings');
  const eq = read.port('equipment');
  const machines: RateResources['machines'] = [];
  const equipment: Estimate['equipment'] = [];
  for (const role of activity.equipment) {
    const cls = role.classes.find((c) => settings.standardModels[c]);
    if (!cls) throw new Error(`No standard model for any of ${role.classes.join('/')}`);
    const modelId = settings.standardModels[cls]!;
    const model = eq.model(modelId);
    for (let i = 0; i < role.count; i += 1) machines.push({ role: role.role, model, modelId });
    equipment.push({ role: role.role, model: modelId, count: role.count });
  }
  const operatorSkill: Record<string, number> = {};
  for (const r of activity.equipment) operatorSkill[r.role] = 1;
  return { res: { machines, operatorSkill, crewSkill: 1 }, equipment };
}

/** the haul's trucks drive and unload as carriers do (the moves port and the carrier classes) */
/** how far from where it stands a loader reaches into a truck (m): an excavator's boom some 8–10 m, an estimate */
const LOAD_REACH = 10;
/** the room either side of a truck in a lane felled for it through trees (m): an estimate */
const HAUL_LANE_ROOM = 2;

function haulageOf(read: ReadCtx, firm: boolean): Haulage {
  const routing = read.port('routing');
  return {
    // (a plan's haul over the ground as if dry and firm; the work's own trucks over the ground as it is today: S3,
    // review S3 #1)
    travel: (from, to, carrier) => {
      const go = (p: Vec2) => routing.route(p, to, carrier, { maxOffroad: 5000, openOnly: true, firm })?.duration ?? null;
      const t = go(from);
      if (t !== null) return t;
      // (a truck is loaded where it stands within the loader's reach of the face: at the edge of a pit dug below it)
      for (const r of [LOAD_REACH / 2, LOAD_REACH])
        for (let k = 0; k < 8; k += 1) {
          const v = go([from[0] + Math.cos((k * Math.PI) / 4) * r, from[1] + Math.sin((k * Math.PI) / 4) * r]);
          if (v !== null) return v;
        }
      return null;
    },
    loadedPace: (carrier) => routing.profile(carrier).loadedSpeed?.value ?? 1,
    unload: (carrier, tonnes) => read.port('moves').unloadTime(carrier, tonnes),
  };
}

function cheapestJobCost(read: ReadCtx, qualification: string): number {
  const jobs = read.data('jobs');
  const settings = read.data('labourSettings');
  let best = Number.POSITIVE_INFINITY;
  for (const job of Object.values(jobs)) {
    if (job.qualifications.includes(qualification)) best = Math.min(best, job.hourlyWage.value);
  }
  if (!Number.isFinite(best)) return 0;
  return best * (1 + settings.employerSurcharge.value);
}

/** break allowance: share of the shift span that is productive */
/** the share of the working day's span that is worked, by the day of those who work it (a household works on a public holiday) */
function breakFactor(read: ReadCtx, t: number, party?: EntityId): Explained {
  const w = read.port('workforce').shiftWindow(t, party);
  if (!w) return ex.value(0, '', 'off shift');
  const span = (w.end - w.start) / HOUR;
  return ex.div('break allowance', '', ex.value(w.paidHours, 'h', 'paid hours'), ex.value(span, 'h', 'shift span'));
}

function estimatePackage(read: ReadCtx, spec: Pick<PackageSpec, 'activity' | 'quantity' | 'pos' | 'params' | 'haulTo' | 'soilClass' | 'consumes' | 'store' | 'produces' | 'fells'>, party?: EntityId): Estimate {
  const activity = activityOf(read, spec.activity);
  if (subcontractOnly(activity)) return estimateSubcontract(read, activity, spec);
  const { res, equipment } = standardResources(read, activity);
  const soilClassId = spec.soilClass ?? read.data('productionSettings').standardSoil;
  // (reckoned on what the party knows of the ground, when it is said whose plan it is: 8d)
  // (a plan for nobody in particular: on the soil map, never the ground as it is)
  const known = spec.pos && !spec.soilClass ? knownSoil(read, party, spec.pos, 0.6).id : undefined;
  const { id: soilId, soil } = spec.pos ? readSoil(read, spec.pos, spec.soilClass ?? known) : { id: soilClassId, soil: read.port('terrain').soilClass(soilClassId) };
  const rctx: RateContext = { activity, activityId: spec.activity, pos: spec.pos, params: spec.params ?? {}, soil, soilId };
  if (spec.haulTo) rctx.haulTo = spec.haulTo;
  let { rate } = baseRate(rctx, res, haulageOf(read, true));
  // hand work fed from a store out of reach: the standard crew carries as well as works
  if ((spec.store || spec.produces?.length || spec.fells) && spec.pos && rate.v > 0) {
    // what it draws from its store, and what it makes onto theirs: carried both ways (a store only planned: where it will be)
    const per: Record<string, number> = { ...materialsPerUnit(read, activity, spec.activity, { consumes: spec.consumes ?? {} }) };
    const at = (store: EntityId | undefined) => (store && read.port('holdings').exists(store) ? store : spec.haulTo);
    const storeOf: Record<string, Carry | undefined> = Object.fromEntries(Object.keys(per).map((m) => [m, at(spec.store)]));
    for (const p of spec.produces ?? []) {
      if (per[p.material] !== undefined) continue;
      per[p.material] = (per[p.material] ?? 0) + p.perUnit;
      const to = at(p.store);
      if (to) storeOf[p.material] = { to };
    }
    // the wood a felling brings down, to its heap
    if (spec.fells && spec.quantity > 0) {
      const veg = read.port('vegetation');
      const hold = read.port('holdings');
      const trees = spec.fells.trees.map((t) => veg.tree(t.id)).filter((t): t is NonNullable<typeof t> => Boolean(t));
      const wood = trees.map((t) => veg.wood(t));
      const units = (tons: number, mat: string) => (tons * 1000) / unitMass(hold.material(mat)) / spec.quantity;
      per[spec.fells.logs] = (per[spec.fells.logs] ?? 0) + units(wood.reduce((a, w) => a + w.stem, 0), spec.fells.logs);
      per[spec.fells.brash] = (per[spec.fells.brash] ?? 0) + units(wood.reduce((a, w) => a + w.crown, 0), spec.fells.brash);
      const heap = read.port('holdings').where(spec.fells.store);
      const to = at(spec.fells.store);
      storeOf[spec.fells.logs] = heap ? woodLegs(heap, trees, wood.map((x) => x.stem)) : to ? { to } : undefined;
      storeOf[spec.fells.brash] = heap ? woodLegs(heap, trees, wood.map((x) => x.crown)) : to ? { to } : undefined;
    }
    const barrows = res.machines.filter((m) => m.model.class === 'wheelbarrow');
    const carry = handCarrying(read, activity, spec.pos, per, storeOf, rate.v, activity.crew.reduce((a, c) => a + c.count, 0), barrows[0]?.model, barrows.length, spec.quantity);
    // pieces too heavy for hands are no reason to refuse the plan: the work says so when it comes to it
    if (carry && carry.v > 1e-9) rate = ex.mul('rate with carrying', rate.u, rate, carry);
  }
  const hours = rate.v > 0 ? spec.quantity / rate.v : Number.POSITIVE_INFINITY;
  const eqSettings = read.data('equipmentSettings');
  const crewCost = activity.crew.map((c) => ex.mul(`${c.count} × ${c.role}`, 'EUR/h', ex.value(c.count, ''), ex.value(cheapestJobCost(read, c.qualification), 'EUR/h', `loaded wage (${c.qualification})`)));
  const operatorCost = res.machines.map((m) => ex.value(cheapestJobCost(read, m.model.operatorQualification), 'EUR/h', `operator ${m.model.label}`));
  const machineCost = res.machines.map((m) => machineHourlyCostEstimate(m.model, eqSettings.dieselPrice.value, eqSettings.repairBasisHours.value, activity.machineLoad.value));
  const hourly = ex.sum('resources per hour', 'EUR/h', ...crewCost, ...operatorCost, ...machineCost);
  const perUnit = materialsPerUnit(read, activity, spec.activity, { consumes: spec.consumes ?? {} });
  const hold = read.port('holdings');
  // goods only moved (what is used comes out again elsewhere) are ours already: no material cost, as when booked
  const matCosts = Object.entries(perUnit).filter(([mat]) => !spec.produces?.some((o) => o.material === mat)).map(([mat, q]) => {
    const offer = read.port('trade').offers(mat)[0];
    return ex.mul(`${hold.material(mat).label}`, 'EUR', ex.value(q * spec.quantity, hold.material(mat).unit, 'quantity'), ex.value(offer?.price ?? 0, `EUR/${hold.material(mat).unit}`, offer ? `best offer (${offer.supplierLabel})` : 'no supplier (own stock)'));
  });
  for (const [mat, q] of Object.entries(activity.directSupply ?? {})) {
    const m = hold.material(mat);
    const per1 = flexTo(q, `${m.unit}/${activity.unit}`, `activity ${spec.activity} direct supply ${mat}`);
    const offer = read.port('trade').offers(mat)[0];
    matCosts.push(ex.mul(`${m.label} (just-in-time)`, 'EUR', ex.value(per1 * spec.quantity, m.unit, 'quantity'), ex.value(offer?.price ?? 0, `EUR/${m.unit}`, offer ? `best offer (${offer.supplierLabel})` : 'no supplier')));
  }
  const cost = ex.sum('estimated cost', 'EUR', ex.mul('labour & equipment', 'EUR', hourly, ex.value(hours, 'h', 'working hours')), ...matCosts);
  return {
    rate,
    hours,
    crew: activity.crew.map((c) => ({ ...c })),
    equipment,
    cost,
  };
}

/**
 * The carrying a hand activity's crew does besides the work, from a store out of reach: a factor on
 * the work rate (machines bring their own; hand tools and aids such as a wheelbarrow do not). The
 * crew's wheelbarrows: the share of the crew that has one, and what one takes. Null: no carrying.
 */
function handCarrying(read: ReadCtx, activity: Activity, front: Vec2, per: Record<string, number>, storeOf: Record<string, Carry | undefined>, rate: number, heads: number, barrow: MachineModel | undefined, barrows: number, total?: number): Explained | null {
  const classes = read.data('equipmentClasses');
  // (tools in hand, powered or not, carry nothing: only machines and vehicles bring their own)
  const byHand = activity.equipment.every((e) => e.classes.every((c) => classes[c]?.kind === 'hand' || classes[c]?.kind === 'powered'));
  if (!byHand || !activity.crew.length || !heads) return null;
  const aid = barrow?.payload ? { label: barrow.label, capacityKg: barrow.payload.value * 1000, ...(barrow.payloadVolume ? { capacityM3: barrow.payloadVolume.value } : {}), share: barrows / heads } : undefined;
  return carryFactor(read, front, per, storeOf, rate / heads, activity.unit, aid, total, heads);
}

function subcontractRate(activity: Activity, activityId: string): Explained {
  const sc = activity.subcontract!;
  const unitH = `${activity.unit}/h`;
  return ex.mul(`${activity.label} rate`, unitH, ex.value(flexTo(sc.output, unitH, `activity ${activityId} subcontract output`), unitH, `${sc.label}: crew of ${sc.crewSize}`, sc.output.source, sc.output.note), ex.param(activity.jobEfficiency, 'job efficiency'));
}

function estimateSubcontract(read: ReadCtx, activity: Activity, spec: Pick<PackageSpec, 'activity' | 'quantity' | 'consumes'>): Estimate {
  const sc = activity.subcontract!;
  const rate = subcontractRate(activity, spec.activity);
  const price = flexTo(sc.price, `EUR/${activity.unit}`, `activity ${spec.activity} subcontract price`);
  const hold = read.port('holdings');
  const perUnit = materialsPerUnit(read, activity, spec.activity, { consumes: spec.consumes ?? {} });
  const matCosts = Object.entries(perUnit).map(([mat, q]) => {
    const offer = read.port('trade').offers(mat)[0];
    return ex.mul(hold.material(mat).label, 'EUR', ex.value(q * spec.quantity, hold.material(mat).unit, 'quantity'), ex.value(offer?.price ?? 0, `EUR/${hold.material(mat).unit}`, offer ? `best offer (${offer.supplierLabel})` : 'no supplier'));
  });
  for (const [mat, q] of Object.entries(activity.directSupply ?? {})) {
    const m = hold.material(mat);
    const per1 = flexTo(q, `${m.unit}/${activity.unit}`, `activity ${spec.activity} direct supply ${mat}`);
    const offer = read.port('trade').offers(mat)[0];
    matCosts.push(ex.mul(`${m.label} (just-in-time)`, 'EUR', ex.value(per1 * spec.quantity, m.unit, 'quantity'), ex.value(offer?.price ?? 0, `EUR/${m.unit}`, offer ? `best offer (${offer.supplierLabel})` : 'no supplier')));
  }
  const cost = ex.sum('estimated cost', 'EUR', ex.mul(`${sc.label} (subcontract)`, 'EUR', ex.value(spec.quantity, activity.unit, 'quantity'), ex.value(price, `EUR/${activity.unit}`, 'unit price', sc.price.source, sc.price.note)), ...matCosts);
  return { rate, hours: rate.v > 0 ? spec.quantity / rate.v : Number.POSITIVE_INFINITY, crew: activity.crew.map((c) => ({ ...c })), equipment: [], cost };
}

// ---------------------------------------------------------------- dispatch internals

function requestDispatch(ctx: WriteCtx): void {
  const st = ctx.state('production');
  if (st.dispatchTimer !== null) return;
  ctx.patchState('production', { dispatchTimer: ctx.at(ctx.now, 'dispatch') });
}

/** how fast a person works at the skill of their assignment (1 when the skill is not known) */
function skillSpeed(read: ReadCtx, p: EntityId): number {
  const skill = read.get('Assignment', p)?.skill;
  return skill ? read.port('workforce').speed(p, skill) : 1;
}

function account(ctx: WriteCtx, id: EntityId): void {
  const pkg = ctx.require('WorkPackage', id);
  if (!pkg.process || (pkg.status !== 'active' && pkg.status !== 'hold')) return;
  const done = ctx.process(pkg.process)?.done ?? pkg.accounted;
  const delta = Math.max(0, done - pkg.accounted);
  const worked = pkg.activeSince !== undefined ? (ctx.now - pkg.activeSince) / HOUR : 0;
  const activity = activityOf(ctx, pkg.activity);
  let pkgWorkmanship = pkg.workmanship;
  /** the practice of the hands that did this interval's work (null: none of the crew used a skill) */
  let hands: number | null = null;
  const cost = { ...pkg.cost };
  if (worked > 0) {
    const eq = ctx.port('equipment');
    const wf = ctx.port('workforce');
    for (const m of pkg.machines) {
      const logged = ctx.command('equipment.logWork', { machine: m, hours: worked, load: activity.machineLoad.value });
      if (!logged.ok && logged.reasons[0]?.code === 'equipment.noFuel') {
        // ran dry inside the interval: log the hours the tank allowed (the rate decision stops it next)
        const fph = fuelPerHour(eq.modelOf(m), activity.machineLoad.value);
        ctx.command('equipment.logWork', { machine: m, hours: Math.max(0, eq.fuel(m) / fph - 1e-6), load: activity.machineLoad.value });
      }
      cost.equipment += eq.hourlyCost(m) * worked;
    }
    let crewHours = 0;
    let crewSum = 0;
    for (const p of pkg.crew) {
      cost.labour += wf.hourlyCost(p) * worked;
      const skill = ctx.get('Assignment', p)?.skill;
      if (skill) {
        // the quality of the work follows how practised the crew is (capped at an expert's)
        crewHours += worked;
        crewSum += worked * Math.min(1, wf.speed(p, skill));
        // learning by doing
        ctx.command('workforce.practise', { person: p, skill, hours: worked });
      }
    }
    if (crewHours > 0) hands = crewSum / crewHours;
  }
  if (delta > 0) {
    const { per } = effectiveMaterials(ctx, id);
    const hold = ctx.port('holdings');
    const staged = stagedOf(ctx, pkg);
    // what the staged goods allowed: no more comes out than went in (0001)
    let made = delta;
    for (const [mat, q] of Object.entries(per)) if (q > 0) made = Math.min(made, workFor(ctx, mat, q, pkg.accounted, staged[mat] ?? 0));
    // goods moved (what goes in comes out again elsewhere) are the same goods: no material cost, and they go on, not in
    const moved = new Set((pkg.produces ?? []).map((o) => o.material).filter((m) => (per[m] ?? 0) > 0));
    const used: { material: string; qty: number }[] = [];
    for (const [mat, q] of Object.entries(per)) {
      // pieces are used whole: those the work has come to by now, less those used before (as they come out whole, C1);
      // the work done, its last one too, part of it as it may be (r41)
      const pieces = (u: number) => (leftOf(pkg.quantity, u) <= 0 ? Math.ceil(wholeIfNear(u * q)) : Math.floor(wholeIfNear(u * q)));
      const qty = Math.min(isCounted(hold.material(mat)) ? pieces(done) - pieces(pkg.accounted) : q * delta, staged[mat] ?? 0);
      if (qty <= 0) continue;
      if (moved.has(mat)) continue;
      used.push({ material: mat, qty });
      const offer = ctx.port('trade').offers(mat)[0];
      cost.materials += q * delta * (offer?.price ?? 0);
    }
    // how well this work was done: by whoever did it (a package may be begun by the own crew and let to a firm)
    const w = isSubcontracted(pkg, activity) ? 1 : hands;
    if (w !== null) pkgWorkmanship = { qty: (pkgWorkmanship?.qty ?? 0) + delta, sum: (pkgWorkmanship?.sum ?? 0) + delta * w };
    // booked hot-mix is paid on delivery (supply.ts); here the delivered material is built in
    if (isSubcontracted(pkg, activity)) {
      // a firm's price is fixed at the award; without one, the market reference price of today
      const amount = (pkg.contract?.price ?? flexTo(activity.subcontract!.price, `EUR/${activity.unit}`, `activity ${pkg.activity} subcontract price`) * ctx.port('prices').index(ctx.now)) * delta;
      cost.subcontract += amount;
      const who = pkg.contractor ? (ctx.data('contractors')[pkg.contractor]?.label ?? pkg.contractor) : activity.subcontract!.label;
      const payer = partyOf(ctx, id);
      ctx.ledger.post({ from: acct(payer, ACCOUNTS.cash), to: acct(payer, ACCOUNTS.services), amount, memo: `${who}: ${delta.toFixed(1)} ${activity.unit} → ${pkg.label}`, category: 'subcontract', refs: [id, pkg.project] });
    }
    consumeSupplies(ctx, id, delta);
    // what it makes of what it uses (sawn, split, crushed: a transform at the front, the dust and the loss to the ground), or
    // what it moves on; what it makes of nothing it draws from nature (soil dug, design/physical-state.md: the terrain's, slice 7)
    const outputs: { material: string; qty: number; store: EntityId }[] = [];
    for (const out of pkg.ground?.op === 'dig' ? [] : (pkg.produces ?? [])) {
      // goods counted in pieces come out whole: the pieces finished by now, less those already put in (C1)
      const counted = isCounted(hold.material(out.material));
      const whole = (u: number) => Math.floor(wholeIfNear(u * out.perUnit));
      const qty = counted ? whole(done) - whole(pkg.accounted) : out.perUnit * made;
      if (qty > 0) outputs.push({ material: out.material, qty, store: out.store });
    }
    const front = pkg.front;
    const via = activity.equipment.length ? ('hauled by the work' as const) : ('carried by the work' as const);
    // hauled: on the road first, at the heap load by load (a flow: design/physical-state.md I5, finding 16)
    const road = pkg.haul && pkg.haulTo ? roadOf(ctx, id) : undefined;
    const dest = (o: { store: EntityId }) => road ?? o.store;
    // (of what the work made since it was last reckoned, only its trucks' loads of this cycle are still on the road; the
    // earlier loads are at the heap already: r37, not an hour's output on the trucks)
    const settle = () => {
      if (!road || !pkg.haul) return;
      let room = pkg.haul.perLoad * (pkg.produces?.[0]?.perUnit ?? 1);
      for (const out of haulOuts(ctx, pkg)) {
        const on = hold.stock(road, out.material);
        const keep = Math.min(on, room);
        room -= keep;
        const over = on - keep;
        if (over > 1e-9) {
          ctx.command('inventory.transfer', { from: road, to: out.store, material: out.material, qty: over, via: 'hauled by the work', why: `${pkg.label}: loads at the heap`, work: id });
          // (driven by its trucks: their passes recorded, as each load's)
          haulTraffic(ctx, id, (over * unitMass(hold.material(out.material))) / 1000);
        }
      }
    };
    for (const o of outputs.filter((x) => moved.has(x.material))) {
      // moved on from the front to where it goes (the carrying is the work's own)
      if (front) ctx.command('inventory.transfer', { from: front, to: dest(o), material: o.material, qty: Math.min(o.qty, hold.stock(front, o.material)), via, why: pkg.label, ...(road ? { work: id } : {}) });
    }
    const makes = outputs.filter((x) => !moved.has(x.material));
    if (used.length && makes.length && front) {
      // a transform at the front: the goods made go on to their store
      const t = ctx.command('inventory.transform', { at: front, take: used, give: makes.map((o) => ({ material: o.material, qty: o.qty })), sink: activity.loss ?? 'ground', why: pkg.label });
      if (!t.ok) throw new Error(`${pkg.label}: ${JSON.stringify(t.reasons)}`);
      for (const o of makes) ctx.command('inventory.transfer', { from: front, to: dest(o), material: o.material, qty: o.qty, via, why: pkg.label, ...(road ? { work: id } : {}) });
    } else {
      // what it uses is built into its work (the road, the structure: a holding of its own); fill laid into the ground
      if (used.length && front && pkg.ground?.op === 'fill') {
        const tonnes = used.reduce((a, u) => a + (u.qty * unitMass(hold.material(u.material))) / 1000, 0);
        ctx.command('terrain.fill', { cells: groundSlice(pkg, made), cls: pkg.ground.clsOf?.[used[0]!.material] ?? pkg.ground.cls ?? pkg.soilClass, from: front, take: used, tonnes, why: pkg.label });
      } else if (used.length && front) {
        const into = builtOf(ctx, id);
        for (const u of used) ctx.command('inventory.transfer', { from: front, to: into, material: u.material, qty: u.qty, why: pkg.label });
      }
      // what it digs comes out of the ground as it is dug (§5: the hole and the heap one number)
      if (pkg.ground?.op === 'dig' && made > 0) {
        const into = road ?? pkg.ground.store ?? pkg.produces?.[0]?.store;
        if (into) ctx.command('terrain.dig', { cells: groundSlice(pkg, made), as: pkg.ground.as!, into, why: pkg.label, ...(pkg.ground.topsoilOnly ? { topsoilOnly: true } : {}) });
      }
      for (const o of makes) {
        const r = ctx.command('inventory.extract', { from: pkg.fells ? 'trees' : 'ground', into: dest(o), material: o.material, qty: o.qty, why: pkg.label });
        if (!r.ok) throw new Error(`${pkg.label}: ${JSON.stringify(r.reasons)}`);
      }
    }
    settle();
  }
  // the loads on the road arrive by their trucks' cycles
  if (pkg.haul && pkg.haulTo) haulOn(ctx, id);
  const felled = pkg.fells ? fell(ctx, pkg, done) : undefined;
  const patch: Partial<WorkPackage> = { accounted: done, workedHours: pkg.workedHours + worked, cost, ...(pkgWorkmanship ? { workmanship: pkgWorkmanship } : {}), ...(felled ? { felled: felled.n, felledLogs: (pkg.felledLogs ?? 0) + felled.logs, ...(felled.where.length ? { felledAt: [...(pkg.felledAt ?? []), ...felled.where] } : {}) } : {}) };
  if (pkg.activeSince !== undefined) patch.activeSince = ctx.now;
  ctx.patch('WorkPackage', id, patch);
}

/**
 * Where one stands to work at a place: the place, or the nearest dry ground within the work's reach of it when it is
 * under water deeper than one wades (the front of a crossing over a creek is worked from its bank: §5)
 */
function standAt(read: ReadCtx, at: Vec2): Vec2 {
  if (!read.hasPort('terrain') || !read.hasData('handling')) return [at[0], at[1]];
  const t = read.port('terrain');
  const prof = read.port('routing').profile(read.data('handling')!.errand.profile);
  const wade = prof.wading ? convert(prof.wading.value, prof.wading.unit, 'm') : 0;
  if (t.waterDepthAt(at[0], at[1]) <= wade + 1e-3) return [at[0], at[1]];
  const reach = read.data('productionSettings').workReach.value;
  for (const r of [2, 5, 10, 15, 20, 25, 35, 50].filter((x) => x <= reach)) {
    for (let k = 0; k < 8; k += 1) {
      const q: Vec2 = [at[0] + Math.cos((k * Math.PI) / 4) * r, at[1] + Math.sin((k * Math.PI) / 4) * r];
      if (t.waterDepthAt(q[0], q[1]) <= wade + 1e-3) return q;
    }
  }
  return [at[0], at[1]];
}

/** what a haul carries to its heaps: its produces, and what its ground may give besides (topsoil in a cut), each to its store */
function haulOuts(read: ReadCtx, pkg: Readonly<WorkPackage>): { material: string; store: EntityId }[] {
  const out = (pkg.produces ?? []).map((o) => ({ material: o.material, store: o.store }));
  const fallback = pkg.ground?.store ?? pkg.produces?.[0]?.store;
  for (const m of Object.values(pkg.ground?.as ?? {})) if (fallback && !out.some((o) => o.material === m)) out.push({ material: m, store: fallback });
  return out;
}

/** a ground work's share for so many units of its work: the cells it reaches, from where it is (its done units) on */
function groundSlice(pkg: Readonly<WorkPackage>, units: number): [number, number, number][] {
  const g = pkg.ground!;
  const total = g.cells.reduce((a, c) => a + c[2], 0);
  if (!(pkg.quantity > 0) || !(total > 0)) return [];
  const from = (total * pkg.accounted) / pkg.quantity;
  const to = Math.min(total, (total * (pkg.accounted + units)) / pkg.quantity);
  const out: [number, number, number][] = [];
  let acc = 0;
  for (const [i, j, v] of g.cells) {
    const a = Math.max(acc, from);
    const b = Math.min(acc + v, to);
    if (b > a + 1e-12) out.push([i, j, b - a]);
    acc += v;
    if (acc >= to) break;
  }
  return out;
}

/** a haul's trip over the network (out loaded, back empty): its traffic, as any move's (the sweep: hauls drove no road) */
function haulTraffic(ctx: WriteCtx, id: EntityId, tonnes: number): void {
  const pkg = ctx.require('WorkPackage', id);
  // its trucks: what they are and take (kept: the last loads come in after the work has let them go)
  const isTruck = (md: { class: string; payload?: unknown; transport?: unknown }) => md.class === 'tipper' || (md.payload !== undefined && Boolean(md.transport));
  const models = pkg.machines.map((m) => ctx.port('equipment').modelOf(m)).filter(isTruck);
  const profile0 = models[0]?.transport?.vehicleProfile;
  const truck = profile0 && pkg.haul ? { profile: profile0, t: (pkg.haul.perLoad * (pkg.produces?.[0]?.perUnit ?? 1)) / models.length } : pkg.haul?.truck;
  const profile = truck?.profile;
  if (!profile || !pkg.haulTo || !(tonnes > 0)) return;
  // (a pass out and back for every truckload: r38, not one for all the trucks of a cycle; a part load counted with the next)
  const tally = (pkg.haul?.tally ?? 0) + tonnes / Math.max(1e-6, truck.t);
  const loads = Math.floor(tally + 1e-6);
  if (pkg.haul) ctx.patch('WorkPackage', id, { haul: { ...pkg.haul, tally: Math.max(0, tally - loads), truck } });
  if (loads < 1) return;
  const route = ctx.port('routing').route(workFront(pkg, progressOf(ctx, pkg)), pkg.haulTo, profile, { maxOffroad: 5000, openOnly: true });
  const edges = [...new Set((route?.stretches ?? []).flatMap((s) => (s.kind === 'network' && s.edge ? [s.edge] : [])))];
  if (!edges.length) return;
  const routing = ctx.port('routing');
  for (const loaded of [true, false]) ctx.command('traffic.record', { edges, vehicles: loads, esalPerVehicle: routing.esal(profile, loaded), kind: 'haul' });
}

/** a haul's holding on the road: its loads between the front and the heap (made the first time it hauls) */
function roadOf(ctx: WriteCtx, id: EntityId): EntityId {
  const pkg = ctx.require('WorkPackage', id);
  if (pkg.haul?.store && ctx.port('holdings').exists(pkg.haul.store)) return pkg.haul.store;
  const r = ctx.command('inventory.createStore', { holder: partyOf(ctx, id), label: `${pkg.label}: loads on the road`, kind: 'transit', pos: [pkg.pos[0], pkg.pos[1]], work: id });
  if (!r.ok) throw new Error(`${pkg.label}: the haul road: ${JSON.stringify(r.reasons)}`);
  ctx.patch('WorkPackage', id, { haul: { ...pkg.haul!, store: r.value as EntityId } });
  return r.value as EntityId;
}

/** the next load at the heap, if one is on the road and none is due yet */
function haulOn(ctx: WriteCtx, id: EntityId): void {
  const h = ctx.require('WorkPackage', id).haul;
  if (!h?.store || (h.next !== undefined && h.next > ctx.now)) return;
  if (!Object.values(ctx.port('holdings').contents(h.store)).some((q) => q > 1e-9)) return;
  const next = ctx.now + h.cycle;
  ctx.patch('WorkPackage', id, { haul: { ...h, next } });
  ctx.at(next, 'haulLoad', { pkg: id });
}

/** an hour of curing at this air temperature, as equivalent hours at the reference (Nurse-Saul: linear above the datum) */
function maturityHour(c: NonNullable<Activity['cures']>, air: number): number {
  return Math.max(0, air - c.datum.value) / (c.reference.value - c.datum.value);
}

/** what a finished piece of work must cure (its activity's), none for one taken down (what comes off does not harden) */
function curesOf(read: ReadCtx, pkg: Readonly<WorkPackage>): Activity['cures'] {
  if (pkg.status !== 'done' || (pkg.data as { removal?: boolean } | undefined)?.removal) return undefined;
  return activityOf(read, pkg.activity).cures;
}

/** how many equivalent hours a piece of work still has to cure before what follows may go on it (0: none, or cured) */
function curingLeft(read: ReadCtx, pkg: Readonly<WorkPackage>): number {
  const c = curesOf(read, pkg);
  return c ? Math.max(0, c.age.value - (pkg.cured ?? 0)) : 0;
}

/** what waits on work that cures says so, and until about when at the air of the hour (S6) */
function curingNews(ctx: WriteCtx, id: EntityId, pkg: Readonly<WorkPackage>): void {
  const curing = pkg.after.filter((l) => l.type === 'FS').map((l) => ctx.get('WorkPackage', l.package)).filter((p): p is Readonly<WorkPackage> => Boolean(p) && curingLeft(ctx, p!) > 0);
  const had = ctx.blockersOf(id).some((b) => b.code === 'production.curing');
  if (!curing.length) {
    if (had) ctx.blockers.set(id, ctx.blockersOf(id).filter((b) => b.module === 'production' && b.code !== 'production.curing'));
    return;
  }
  const air = ctx.port('weather').hour(ctx.now).airTemp;
  const p = curing[0]!;
  const c = activityOf(ctx, p.activity).cures!;
  const per = maturityHour(c, air);
  const until = per > 1e-6 ? ctx.now + Math.round((curingLeft(ctx, p) / per) * HOUR) : undefined;
  const rest = ctx.blockersOf(id).filter((b) => b.module === 'production' && b.code !== 'production.curing');
  ctx.blockers.set(id, [...rest, { code: 'production.curing', severity: 'info', params: { work: p.label, what: c.what, until: until !== undefined ? ctx.calendar.format(until) : 'when it is warmer (it does not harden at this cold)' }, remedies: until !== undefined ? [{ label: `Wait until ${ctx.calendar.format(until)}`, wait: { until } }] : [{ label: 'Wait for warmer days', wait: {} }] }]);
}

function predecessorsSatisfied(read: ReadCtx, pkg: Readonly<WorkPackage>): boolean {
  for (const link of pkg.after) {
    const pred = read.get('WorkPackage', link.package);
    if (!pred || pred.status === 'cancelled') continue;
    if (link.type === 'FS') {
      if (pred.status !== 'done') return false;
      if ((pred.completedAt ?? 0) + link.lag * HOUR > read.now) return false;
      // (concrete hardened, render dry: what follows goes on it only then, S6)
      if (curingLeft(read, pred) > 0) return false;
    } else if (progressOf(read, pred) < link.lag - 1e-9 && pred.status !== 'done') return false;
  }
  return true;
}

/** SS no-overtake cap: follower progress may not exceed its predecessor's */
function overtakeCap(read: ReadCtx, pkg: Readonly<WorkPackage>): number {
  let cap = 1;
  for (const link of pkg.after) {
    if (link.type !== 'SS') continue;
    const pred = read.get('WorkPackage', link.package);
    if (!pred || pred.status === 'done' || pred.status === 'hold' || pred.status === 'cancelled') continue;
    cap = Math.min(cap, progressOf(read, pred));
  }
  return cap;
}

function isFreePerson(read: ReadCtx, id: EntityId): boolean {
  return !read.has('Assignment', id) && read.port('workforce').present(id);
}

function isFreeMachine(read: ReadCtx, id: EntityId): boolean {
  if (read.has('Assignment', id)) return false;
  const m = read.get('Machine', id);
  return Boolean(m && (m.status === 'ready' || m.status === 'travelling'));
}

/** not at work at all (ill, on leave, on a course, away): unlike someone busy elsewhere or on an errand, nobody can wait for them to be free */
const AWAY = new Set(['sick', 'vacation', 'training', 'away', 'gone', 'shortTime', 'released']);

/** someone dismissed and released from work for the rest of their notice */
const released = (read: ReadCtx, p: EntityId): boolean => read.get('Presence', p)?.status === 'released';

interface ResourcePick {
  machines: { id: EntityId; role: string; operator: EntityId; skill: string }[];
  crew: { id: EntityId; role: string; skill: string }[];
  /** busy: we have such a resource, it is just working elsewhere right now (or on an errand); absent: those who could do it but are ill or away */
  missing: { kind: 'qualification' | 'machine'; what: string; role: string; busy: boolean; need?: number; have?: number; absent?: { id?: EntityId; name: string; status: string; until?: number }[]; fit?: number; on?: string }[];
}

/**
 * Choose machines and people for an activity.
 * 1. machines: nearest free machine per role instance (any class the role accepts)
 * 2. people: all person requirements (operators of the chosen machines + crew roles) are filled
 *    most-constrained first, and each picks the candidate whose OTHER skills are least needed —
 *    by this activity first, then by the scarcity among free staff (an asphalt paver crew must
 *    not use up the only screed men as roller drivers).
 */
/** the party's machines of these classes (what it holds) */
// (ours to use: held by us and not lent out, or lent to us)
const machinesOf = (read: ReadCtx, party: EntityId, classes: readonly string[]): EntityId[] => classes.flatMap((c) => read.port('equipment').byClass(c as never)).filter((m) => read.port('equipment').usableBy(m, party));

/** how far a point is from a work's own section (its stretch of road; else its place) */
function toWork(pkg: Pick<WorkPackage, 'pos' | 'path'>, p: readonly number[]): number {
  const path = pkg.path;
  if (!path || path.length < 2) return Math.hypot(p[0]! - pkg.pos[0], p[1]! - pkg.pos[1]);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const [a, b] = [path[i]!, path[i + 1]!];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0]! - a[0]) * dx + (p[1]! - a[1]) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(p[0]! - (a[0] + t * dx), p[1]! - (a[1] + t * dz)));
  }
  return best;
}

/**
 * At the work: present, standing (not on a move) within the site's reach of its front (design/physical-state.md I2;
 * slice 5 narrows the reach to the front's own extent).
 */
function atWork(read: ReadCtx, person: EntityId, pkg: Readonly<WorkPackage>): boolean {
  if (!read.port('workforce').present(person)) return false;
  const moves = read.port('moves');
  if (moves.placeOf(person)?.on !== undefined) return false;
  const at = moves.where(person);
  return at !== undefined && toWork(pkg, at) <= read.data('productionSettings').workReach.value;
}

/**
 * How much the crew gets done against the standard crew: the speeds of the hands at work (and how
 * well their tools work) over the standard number. The standard crew at standard speed gives 1.
 */
function crewFactor(ctx: ReadCtx, pkg: Readonly<WorkPackage>, activity: Activity): number {
  const role = (id: EntityId) => ctx.get('Assignment', id)?.role ?? '';
  const standard = activity.crew.reduce((a, r) => a + r.count, 0);
  if (!standard) return 1;
  let sum = 0;
  for (const r of activity.crew) {
    const people = pkg.crew.filter((p) => role(p) === r.role);
    const tools = pkg.machines.filter((m) => role(m) === `${r.role} tool`);
    const tool = tools.length ? tools.reduce((a, m) => a + ctx.port('equipment').condition(m), 0) / tools.length : 1;
    sum += people.filter((p) => atWork(ctx, p, pkg)).reduce((a, p) => a + skillSpeed(ctx, p), 0) * tool;
  }
  return sum / standard;
}

function pickResources(read: ReadCtx, activity: Activity, pos: Vec2, party: EntityId, takenPeople: Set<EntityId>, takenMachines: Set<EntityId>): ResourcePick {
  const eq = read.port('equipment');
  const wf = read.port('workforce');
  const pick: ResourcePick = { machines: [], crew: [], missing: [] };
  const usedP = new Set(takenPeople);
  const usedM = new Set(takenMachines);
  // only the party's own people and machines work its projects
  const staff = wf.staff(party).filter((p) => !usedP.has(p) && isFreePerson(read, p));
  // what someone is good for (scarcity of skills among the free staff)
  const quals = (p: EntityId) => wf.skills(p);

  // 1. machines: the standard number of each role where free; below the fewest the work can go on with, it is missing
  const chosen: { id: EntityId; role: string; qual: string; optional: boolean }[] = [];
  for (const role of activity.equipment) {
    const fewest = Math.min(role.count, role.min ?? role.count);
    let got = 0;
    for (let i = 0; i < role.count; i += 1) {
      const candidates = machinesOf(read, party, role.classes).filter((m) => !usedM.has(m) && isFreeMachine(read, m));
      candidates.sort((a, b) => dist(eq.positionAt(a, read.now), pos) - dist(eq.positionAt(b, read.now), pos) || (a < b ? -1 : 1));
      const m = candidates[0];
      if (!m) break;
      usedM.add(m);
      chosen.push({ id: m, role: role.role, qual: eq.modelOf(m).operatorQualification, optional: got >= fewest });
      got += 1;
    }
    if (got < fewest) {
      const owned = machinesOf(read, party, role.classes).filter((x) => read.get('Machine', x)?.status !== 'broken').length;
      for (let i = got; i < fewest; i += 1) pick.missing.push({ kind: 'machine', what: role.classes[0]!, role: role.role, busy: owned >= fewest, need: fewest, have: got });
    }
  }

  // 2. people: the crew, and operators for the machines (the machines beyond the fewest only if someone is free to drive them)
  interface Need {
    qual: string;
    role: string;
    machine?: EntityId;
    optional?: boolean;
  }
  const needs: Need[] = [];
  for (const c of chosen) if (c.qual) needs.push({ qual: c.qual, role: `${c.role} operator`, machine: c.id, optional: c.optional });
  // the crew: the fewest the work needs, and more hands where there is room and someone free
  for (const role of activity.crew) {
    const fewest = Math.min(role.min ?? role.count, role.max ?? role.count);
    for (let i = 0; i < Math.max(role.count, role.max ?? role.count); i += 1) if (i < (role.max ?? role.count)) needs.push({ qual: role.qualification, role: role.role, optional: i >= fewest });
  }
  const demand = new Map<string, number>();
  for (const n of needs) demand.set(n.qual, (demand.get(n.qual) ?? 0) + 1);
  const holders = new Map<string, number>();
  for (const p of staff) for (const q of quals(p)) holders.set(q, (holders.get(q) ?? 0) + 1);
  const eligible = (q: string) => staff.filter((p) => !usedP.has(p) && wf.canDo(p, q)).length;
  const remaining = [...needs];
  const assigned = new Map<Need, EntityId>();
  while (remaining.length) {
    // what the work cannot go without first, then the most constrained
    remaining.sort((a, b) => Number(Boolean(a.optional)) - Number(Boolean(b.optional)) || eligible(a.qual) - eligible(b.qual) || a.role.localeCompare(b.role));
    const need = remaining.shift()!;
    let best: EntityId | undefined;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const p of staff) {
      if (usedP.has(p) || !wf.canDo(p, need.qual)) continue;
      // the licensed first (working without the certificate the law asks for is a legal exposure), then the
      // most practised (a novice only when nobody better is free), then keep scarce skills free
      let cost = (wf.licensed(p, need.qual) ? 0 : 1000) + 100 * (1 - wf.speed(p, need.qual));
      for (const q of quals(p)) {
        if (q === need.qual) continue;
        cost += 10 * (demand.get(q) ?? 0) + 1 / Math.max(1, holders.get(q) ?? 1);
      }
      if (cost < bestCost - 1e-9) {
        best = p;
        bestCost = cost;
      }
    }
    demand.set(need.qual, Math.max(0, (demand.get(need.qual) ?? 1) - 1));
    if (!best) {
      if (need.optional) continue; // that machine stays where it is
      const needed = needs.filter((n) => n.qual === need.qual && !n.optional).length;
      const able = wf.staff(party).filter((p) => wf.canDo(p, need.qual));
      // the ill and the away cannot be waited for as if they were working elsewhere
      const absent = able.filter((p) => AWAY.has(read.get('Presence', p)?.status ?? 'available') || released(read, p)).map((p) => {
        const pr = read.get('Presence', p);
        // released for the rest of their notice: they do not come back
        if (released(read, p)) return { name: wf.name(p), status: 'released until they leave' };
        return { id: p, name: wf.name(p), status: pr?.status === 'shortTime' ? 'on short time' : (pr?.status ?? 'away'), ...(pr?.until !== undefined ? { until: pr.until } : {}) };
      });
      // and one of ours at a job elsewhere now: away until they are back, not "nobody" (the five friends)
      const atJob = [...read.all('Helper')]
        .filter(([p, h]) => h.of === party && wf.elsewhere(p, read.now) && wf.canDo(p, need.qual))
        .map(([p]) => ({ id: p, name: wf.name(p), status: 'at work elsewhere', ...(wf.backAt(p) !== undefined ? { until: wf.backAt(p)! } : {}) }));
      const away = [...absent, ...atJob];
      // who is busy, and on what: the queue is legible (round 16: "busy elsewhere" with nobody named)
      const work = new Map<string, string[]>();
      for (const p of able) {
        const a = read.get('Assignment', p);
        const label = a ? read.get('WorkPackage', a.package)?.label : undefined;
        if (label) work.set(label, [...(work.get(label) ?? []), wf.name(p)]);
      }
      const on = [...work].map(([label, names]) => `${names.join(', ')} on ${label}`).join('; ');
      pick.missing.push({ kind: 'qualification', what: need.qual, role: need.role, busy: able.length - absent.length >= needed, need: needed, have: [...assigned.keys()].filter((n) => n.qual === need.qual).length, ...(away.length ? { absent: away, fit: able.length - absent.length } : {}), ...(on ? { on } : {}) });
      continue;
    }
    usedP.add(best);
    for (const q of quals(best)) holders.set(q, Math.max(0, (holders.get(q) ?? 1) - 1));
    assigned.set(need, best);
  }
  for (const c of chosen) {
    const need = needs.find((n) => n.machine === c.id);
    const op = need ? assigned.get(need) : undefined;
    if (c.qual && !op) continue;
    pick.machines.push({ id: c.id, role: c.role, operator: op ?? '', skill: c.qual });
  }
  for (const n of needs) if (!n.machine && assigned.has(n)) pick.crew.push({ id: assigned.get(n)!, role: n.role, skill: n.qual });
  // tools: everyone of a role that needs one takes a tool of the party's; without, they cannot do it
  for (const role of activity.crew) {
    if (!role.tool) continue;
    const free = machinesOf(read, party, [role.tool]).filter((m) => !usedM.has(m) && isFreeMachine(read, m));
    const people = pick.crew.filter((c) => c.role === role.role);
    let kept = 0;
    for (const c of people) {
      const tool = free.shift();
      if (!tool) {
        pick.crew = pick.crew.filter((x) => x !== c);
        continue;
      }
      usedM.add(tool);
      pick.machines.push({ id: tool, role: `${role.role} tool`, operator: '', skill: '' });
      kept += 1;
    }
    const fewest = Math.min(role.min ?? role.count, role.max ?? role.count);
    if (kept < fewest && people.length >= fewest) {
      const owned = machinesOf(read, party, [role.tool]).length;
      pick.missing.push({ kind: 'machine', what: role.tool, role: `${role.role} tool`, busy: owned >= fewest, need: fewest, have: kept });
    }
  }
  return pick;
}

/** bringing people of ours back from short time, one remedy for them all */
function backFromShortTime(read: ReadCtx, people: EntityId[]): Remedy[] {
  // (not those it is ended for already: back tomorrow)
  const tomorrow = read.calendar.startOfDay(read.now) + DAY;
  const short = read.state('workforce').shortTime ?? {};
  const ids = [...new Set(people)].filter((p) => (short[p]?.until ?? 0) > tomorrow).sort();
  if (!ids.length) return [];
  const wf = read.port('workforce');
  return [{ label: `End short time for ${ids.map((p) => wf.name(p)).join(', ')}: back at work from the next day`, command: { type: 'workforce.endShortTime', payload: { people: ids } } }];
}

function remediesFor(read: ReadCtx, missing: ResourcePick['missing'], pos: Vec2, party: EntityId): Remedy[] {
  // one of ours on short time who could do it: brought back
  const out: Remedy[] = backFromShortTime(read, missing.flatMap((m) => (m.absent ?? []).filter((a) => a.status === 'on short time' && a.id).map((a) => a.id!)));
  const counts = new Map<string, { m: ResourcePick['missing'][number]; n: number }>();
  for (const m of missing) {
    const key = `${m.kind}:${m.what}`;
    const c = counts.get(key);
    if (c) c.n += 1;
    else counts.set(key, { m, n: 1 });
  }
  const jobs = read.data('jobs');
  const settings = read.data('productionSettings');
  for (const { m, n } of counts.values()) {
    if (m.kind === 'qualification') {
      // the job that asks this most plainly (a labourer for labour, not an asphalt worker who also labours)
      const job = Object.entries(jobs).filter(([, j]) => j.qualifications.includes(m.what)).sort((a, b) => a[1].qualifications.length - b[1].qualifications.length || a[1].hourlyWage.value - b[1].hourlyWage.value)[0];
      if (job) {
        // people already coming: open vacancies and hires working their notice elsewhere
        const wf = read.port('workforce');
        const open = wf.openVacancies(job[0], party).length;
        const starts = wf.hiresStarting(job[0], party);
        const starting = starts.length;
        const firstStart = starts[0] ?? Infinity;
        // people already coming may be meant for other packages: show them, and leave the decision to the player
        if (starting > 0) out.push({ label: `Wait: ${starting} × ${job[1].label} hired, first starts ${read.calendar.format(firstStart, 'day')}`, wait: { until: firstStart } });
        if (open > 0) out.push({ label: `Wait: ${open} × ${job[1].label} advertised, next start expected in ~${Math.round(wf.expectedStartDays(job[0], 0))} days`, wait: {} });
        // the ill and the away who come back: enough of them by a known day
        const back = (m.absent ?? []).filter((a) => a.until !== undefined).map((a) => a.until!).sort((a, b) => a - b);
        const short = (m.need ?? 1) - (m.fit ?? 0);
        if (short > 0 && back.length >= short) out.push({ label: `Wait: enough ${read.port('workforce').qualification(m.what)?.label ?? m.what} back by ${read.calendar.format(back[short - 1]!, 'day')}`, wait: { until: back[short - 1]! } });
        // the labour market's queue is everyone's: a new advert comes after all open ones, as workforce.recruit reckons
        const days = wf.expectedStartDays(job[0], wf.openVacancies(job[0]).length + n - 1);
        out.push({
          label: `Advertise ${n > 1 ? `${n} × ` : ''}${job[1].label}${open + starting > 0 ? ' more' : ''} (last starts in ~${Math.round(days)} days, random)`,
          command: { type: 'workforce.recruit', payload: { job: job[0], count: n } },
        });
      }
      out.push(...circleAndCourses(read, m.what, n, party));
    } else {
      const model = settings.standardModels[m.what];
      if (!model) continue;
      const md = read.port('equipment').model(model);
      // machines are rented by the day; what nobody rents out (a spade) is bought
      const rent = Boolean(md.rentalPerDay);
      const price = Math.round(md.purchasePrice.value * read.port('prices').index(read.now));
      for (let i = 1; i <= n; i += 1) out.push({ label: `${rent ? 'Rent' : `Buy (${price} €)`} ${md.label}${n > 1 ? ` (${i}/${n})` : ''}`, command: { type: 'equipment.acquire', payload: { model, ownership: rent ? 'rented' : 'owned', pos } } });
    }
  }
  return out;
}

/** the people's own ways to the missing skill: someone of the family or friends who can do it, or a course for someone on the team */
/** a broken machine: wait for its repair, or get another (the package takes a free one of its classes at once) */
function replacementRemedies(read: ReadCtx, machine: EntityId, pos: Vec2): Remedy[] {
  const m = read.require('Machine', machine);
  const md = read.port('equipment').model(m.model);
  const out: Remedy[] = [];
  const repair = read.blockersOf(machine).find((b) => b.code === 'equipment.broken');
  if (repair) out.push({ label: `Wait for the repair: ${String(repair.params?.stage ?? 'under way')}`, wait: m.until !== undefined && m.until > read.now ? { until: m.until } : {} });
  // what nobody rents out (a spade) is bought; a worn-out tool is not repaired
  const rent = Boolean(md.rentalPerDay);
  const price = Math.round(md.purchasePrice.value * read.port('prices').index(read.now));
  out.push({ label: `${rent ? 'Rent' : `Buy (${price} €)`} another ${md.label}${repair ? ' meanwhile' : ''}: the work takes it as soon as it is here`, command: { type: 'equipment.acquire', payload: { model: m.model, ownership: rent ? 'rented' : 'owned', pos } } });
  return out;
}

function circleAndCourses(read: ReadCtx, skill: string, n: number, party: EntityId): Remedy[] {
  const out: Remedy[] = [];
  const wf = read.port('workforce');
  const label = read.data('qualifications')[skill]?.label ?? skill;
  const day = (t: number) => read.calendar.format(t, 'date');
  for (const h of wf.helpersFor(skill, party).slice(0, n + 1)) {
    out.push({ label: `Ask ${h.name} to come and help for ${h.days} days (${label}: practised ${Math.round(h.level * 100)} % of an expert; arrives ${day(h.arrives)}; unpaid, meals paid)`, command: { type: 'workforce.askForHelp', payload: { person: h.person, days: h.days } } });
  }
  const { waiting, candidates } = wf.trainingFor(skill, party);
  for (const w of waiting) out.push({ label: `Wait: ${w.name} is on the way to it (${w.label}), certified ${day(w.until)}`, wait: { until: w.until } });
  for (const c of candidates.slice(0, n)) {
    out.push({ label: `Send ${c.name} to ${c.course.label} (EUR ${Math.round(c.course.price)} now, away ${day(c.course.from)} – ${day(c.course.until)}, certified then)`, command: { type: 'workforce.enrol', payload: { person: c.person, course: c.course.id } } });
  }
  return out;
}

/** how well a package's work was done, per unit of work (null before any) */
function workmanshipOf(read: ReadCtx, id: EntityId): number | null {
  const p = read.get('WorkPackage', id);
  if (!p) return null;
  if (p.workmanship && p.workmanship.qty > 0) return p.workmanship.sum / p.workmanship.qty;
  // work done by a contractor's experienced crew before anything was accounted here
  return isSubcontracted(p, activityOf(read, p.activity)) && p.status === 'done' ? 1 : null;
}

/**
 * How much more work what is at the front allows: pieces are used whole as the work reaches them, so the one under
 * way is laid already and the front's pieces go beyond it; bulk goes as far as it is there
 */
function workFor(read: ReadCtx, mat: string, q: number, accounted: number, staged: number): number {
  if (!isCounted(read.port('holdings').material(mat))) return staged / q;
  return Math.max(0, (Math.floor(wholeIfNear(accounted * q)) + staged) / q - accounted);
}

function release(ctx: WriteCtx, id: EntityId): void {
  const pkg = ctx.require('WorkPackage', id);
  for (const p of [...pkg.crew, ...pkg.machines]) {
    if (ctx.get('Assignment', p)?.package === id) ctx.remove('Assignment', p);
  }
  ctx.patch('WorkPackage', id, { crew: [], machines: [] });
}

function assign(ctx: WriteCtx, ordered: EntityId[]): void {
  for (const id of ordered) {
    const pkg = ctx.require('WorkPackage', id);
    if (pkg.status !== 'ready') continue;
    const project = ctx.require('Project', pkg.project);
    if (project.status !== 'active') continue;
    const activity = activityOf(ctx, pkg.activity);
    const short = materialShortfall(ctx, id);
    if (short.length) {
      ctx.blockers.set(id, [materialBlocker(ctx, id, short, 'block')]);
      continue;
    }
    if (subcontractOnly(activity) && !pkg.contractor) {
      // no company has been engaged for this trade — a decision for the player / agent
      const remedies = [
        {
          label: 'Award all open trades of this project (in sequence, earliest start)',
          command: {
            type: 'production.awardProject',
            payload: { project: pkg.project },
          },
        },
        ...awardRemedies(ctx, id),
      ];
      ctx.blockers.set(id, [
        {
          code: 'production.noContractor',
          severity: 'block',
          params: { trade: activity.subcontract!.label },
          remedies,
        },
      ]);
      continue;
    }
    if (isSubcontracted(pkg, activity) && pkg.earliestStart !== undefined && ctx.now < pkg.earliestStart) {
      const who = ctx.data('contractors')[pkg.contractor ?? '']?.label ?? activity.subcontract!.label;
      // sooner, at a price: the firm squeezes it in as a rush job
      const sooner = pkg.contractor ? hurryOffer(ctx, id) : null;
      const remedies: Remedy[] = sooner ? [{ label: `Buy it forward: on site from ${ctx.calendar.format(sooner.start, 'day')} at ${sooner.price.toFixed(0)} € a unit (rush)`, command: { type: 'production.hurry', payload: { package: id } } }] : [];
      ctx.blockers.set(id, [{ code: 'production.subcontractorBooked', severity: 'info', params: { who, date: ctx.calendar.format(pkg.earliestStart) }, ...(remedies.length ? { remedies } : {}) }]);
      continue;
    }
    if (activity.directSupply && Object.keys(activity.directSupply).length && !pkg.supplyBooking) {
      ctx.blockers.set(id, [
        {
          code: 'production.supplyNotBooked',
          severity: 'block',
          // (what it is: hot mix, ready-mix, a mineral mix: Qwen S207)
          params: { package: pkg.label, material: Object.keys(activity.directSupply).map((k) => ctx.port('holdings').material(k).label).join(', ') },
          // (a trade a firm can be let: its offers too, not only once the crew is found missing: Qwen S179)
          remedies: [...bookingRemedies(ctx, id), ...(activity.subcontract && !pkg.contractor ? awardRemedies(ctx, id) : [])],
        },
      ]);
      continue;
    }
    if (pkg.supplyBooking && ctx.now < pkg.supplyBooking.from) {
      ctx.blockers.set(id, [
        {
          code: 'production.supplyBooked',
          severity: 'info',
          params: {
            date: ctx.calendar.format(pkg.supplyBooking.from, 'day'),
          },
        },
      ]);
      continue;
    }
    const ground = environment(ctx, activity, workFront(pkg, progressOf(ctx, pkg))).blockers.filter((b) => b.code === 'production.soilTooWet' || b.code === 'production.groundFrozen');
    if (ground.length) {
      ctx.blockers.set(id, ground);
      continue;
    }
    // a let package brings the contractor's crew and plant: none of ours is needed
    const pick = isSubcontracted(pkg, activity) && !subcontractOnly(activity) ? { machines: [], crew: [], missing: [] } : pickResources(ctx, activity, workFront(pkg, 0), partyOf(ctx, id), new Set(), new Set());
    if (pick.missing.length) {
      const qlabel = (q: string) => ctx.port('workforce').qualification(q)?.label ?? q;
      const count = (m: (typeof pick.missing)[number]) => (m.need !== undefined && m.need > 1 ? ` (needs ${m.need}, ${m.have ?? 0} free)` : '');
      const absence = (a: NonNullable<(typeof pick.missing)[number]['absent']>[number]) => `${a.name} ${a.status}${a.until !== undefined ? ` until ${ctx.calendar.format(a.until, 'date')}` : ''}`;
      const person = (m: (typeof pick.missing)[number]) => {
        if (m.busy) return `${qlabel(m.what)} busy elsewhere${m.on ? ` (${m.on})` : ''}`;
        if (!m.absent?.length) return `nobody qualified as ${qlabel(m.what)}`;
        const away = m.absent.map(absence).join(', ');
        // too few hands while the others are away (the fit ones may be at other work)
        return m.fit ? `only ${m.fit} ${qlabel(m.what)} fit to work (${away})` : `no ${qlabel(m.what)} fit to work (${away})`;
      };
      // (a kind of machine named by what it is: "no saw" while a chainsaw stood in the fleet read as a contradiction, S505)
      const such = (cls: string) => {
        const std = ctx.data('productionSettings').standardModels[cls];
        return std ? ` (one such as a ${ctx.port('equipment').model(std).label.replace(/^./, (c) => c.toLowerCase())})` : '';
      };
      const summary = pick.missing.map((m) => `${m.role}: ${m.kind === 'machine' ? (m.busy ? `${m.what} busy elsewhere` : (m.have ?? 0) > 0 ? `too few ${m.what}s` : `no ${m.what} in the fleet${such(m.what)}`) : person(m)}${count(m)}`);
      const allBusy = pick.missing.every((m) => m.busy);
      // waiting for busy resources is normal sequencing; lacking them entirely needs a decision
      // trades a contractor could do instead: letting the package is the alternative to hiring and renting
      const letting = activity.subcontract ? awardRemedies(ctx, id) : [];
      if (allBusy) {
        ctx.blockers.set(id, [{ code: 'production.waitingResources', severity: 'info', params: { missing: [...new Set(summary)].join('; ') }, remedies: [...remediesFor(ctx, pick.missing, pkg.pos, partyOf(ctx, id)), ...letting] }]);
        continue;
      }
      // each thing missing its own blocker with its own ways out: waiting for one does not settle another
      const groups = new Map<string, number[]>();
      pick.missing.forEach((m, i) => groups.set(`${m.kind}:${m.what}`, [...(groups.get(`${m.kind}:${m.what}`) ?? []), i]));
      let first = true;
      const out: BlockerSpec[] = [];
      for (const idx of groups.values()) {
        const ms = idx.map((i) => pick.missing[i]!);
        const busy = ms.every((m) => m.busy);
        out.push({ code: busy ? 'production.waitingResources' : 'production.resources', severity: busy ? 'info' : 'block', params: { missing: [...new Set(idx.map((i) => summary[i]!))].join('; ') }, remedies: [...remediesFor(ctx, ms, pkg.pos, partyOf(ctx, id)), ...(!busy && first ? letting : [])] });
        if (!busy) first = false;
      }
      // the blocking ones first
      ctx.blockers.set(id, out.sort((a, b) => Number(a.severity !== 'block') - Number(b.severity !== 'block')));
      continue;
    }
    const crew: EntityId[] = [];
    const machines: EntityId[] = [];
    for (const m of pick.machines) {
      ctx.set('Assignment', m.id, { package: id, role: m.role });
      machines.push(m.id);
      if (m.operator) {
        ctx.set('Assignment', m.operator, { package: id, role: `${m.role} operator`, skill: m.skill });
        crew.push(m.operator);
      }
    }
    for (const c of pick.crew) {
      ctx.set('Assignment', c.id, { package: id, role: c.role, skill: c.skill });
      crew.push(c.id);
    }
    // someone doing work the law asks a certificate for, without it
    const wfp = ctx.port('workforce');
    for (const x of [...pick.machines.filter((m) => m.operator).map((m) => ({ id: m.operator!, skill: m.skill! })), ...pick.crew.map((c) => ({ id: c.id, skill: c.skill }))]) {
      if (!x.skill || wfp.licensed(x.id, x.skill)) continue;
      const q = wfp.qualification(x.skill);
      ctx.log('warn', `${wfp.name(x.id)} does ${q.label} work without the certificate the law asks for: a legal exposure if it comes out.`, [x.id, id]);
      ctx.emit('production.legalExposure', { person: x.id, party: partyOf(ctx, id), what: `${q.label} work without the certificate`, rule: q.label });
    }
    const patch: Partial<WorkPackage> = { status: 'active', crew, machines };
    if (!pkg.process) {
      patch.process = ctx.proc.start({ kind: `production:${pkg.activity}`, subject: id, label: pkg.label, unit: pkg.unit, total: pkg.quantity, rate: 0, onComplete: 'packageDone', payload: { package: id } });
      patch.startedAt = ctx.now;
      if (!project.startedAt) ctx.patch('Project', pkg.project, { startedAt: ctx.now });
      ctx.emit('production.packageStarted', { package: id, project: pkg.project });
    } else {
      ctx.proc.resume(pkg.process, 0);
    }
    ctx.patch('WorkPackage', id, patch);
    ctx.blockers.clear(id);
  }
}

/** materials not available for at least one hour of work at the estimated rate */
function materialShortfall(read: ReadCtx, id: EntityId): string[] {
  const pkg = read.require('WorkPackage', id);
  const { per, storeOf } = effectiveMaterials(read, id);
  if (!Object.keys(per).length) return [];
  const hold = read.port('holdings');
  const remaining = leftOf(pkg.quantity, doneOf(read, pkg));
  const hourOut = Math.min(remaining, Math.max(pkg.estimate.rate, 1e-6));
  const out: string[] = [];
  for (const [mat, q] of Object.entries(per)) {
    if (q <= 0) continue;
    const store = storeOf[mat];
    const have = (store ? hold.stock(store, mat) : 0) + (stagedOf(read, pkg)[mat] ?? 0);
    if (!covers(have, Math.min(hourOut * q, remaining * q))) out.push(mat);
  }
  return out;
}

/**
 * Materials short at the work front: where the party holds them, and the ways to get them there, in
 * the order of design/camp.md C2: supply from another of its stores first, then a substitute, then
 * order or fetch.
 */
function materialBlocker(read: ReadCtx, id: EntityId, mats: string[], severity: 'warn' | 'block') {
  const pkg = read.require('WorkPackage', id);
  const { per, storeOf } = effectiveMaterials(read, id);
  const hold = read.port('holdings');
  const party = read.require('Project', pkg.project).party;
  const front = workFront(pkg, progressOf(read, pkg));
  const remaining = leftOf(pkg.quantity, doneOf(read, pkg));
  const fromHeld: Remedy[] = [];
  const substitutes: Remedy[] = [];
  const buy: Remedy[] = [];
  const held: string[] = [];
  // wood nobody sells, by the store it is missing at: won by felling, logs and brash from the same trees
  const toFell = new Map<EntityId, Record<string, number>>();
  for (const mat of mats) {
    const store = storeOf[mat];
    const unit = hold.material(mat).unit;
    const where = heldText(read, party, mat, front, store);
    if (where) held.push(`${hold.material(mat).label}: ${where}`);
    // never from where the work itself puts it (goods moved: their destination)
    for (const h of heldElsewhere(read, party, mat, front, store).filter((x) => !pkg.produces?.some((o) => o.store === x.store))) {
      fromHeld.push({ label: `Supply ${pkg.label} from ${h.label} (${+h.qty.toFixed(2)} ${unit} there, ${Math.round(h.distance)} m from the work front)`, command: { type: 'production.supplyFrom', payload: { package: id, store: h.store, material: mat } } });
    }
    const sub = pkg.substitutes?.[mat];
    if (sub && !(pkg.switched ?? []).includes(mat)) substitutes.push({ label: `Use ${hold.material(sub.material).label} instead of ${hold.material(mat).label} (orders it)`, command: { type: 'production.useSubstitute', payload: { package: id, material: mat } } });
    // with no store to supply the work, buying goes to our nearest store, to be supplied from there
    const into = store ?? hold.ofParty(party, { kept: true, general: true, near: [front[0], front[1]] })[0];
    if (into) {
      // only what is missing there: never buy again what we hold
      const need = leftOf(remaining * (per[mat] ?? 0), (stagedOf(read, pkg)[mat] ?? 0) + hold.stock(into, mat) + read.port('trade').onOrder(into, mat));
      if (need > 0) buy.push(...fillRemedies(read, into, mat, need));
      if (need > 0) toFell.set(into, { ...(toFell.get(into) ?? {}), [mat]: need });
    }
  }
  for (const [into, needs] of toFell) buy.push(...fellRemedies(read, into, needs));
  const stores = new Set(mats.map((m) => storeOf[m]));
  const onOrder = mats.every((mat) => storeOf[mat] && read.port('trade').onOrder(storeOf[mat]!, mat) > 0);
  const where = held.length ? ` (held: ${held.join('; ')})` : stores.has(undefined) ? ' (no store supplies this work: name one with production.supplyFrom)' : '';
  const seen = new Set<string>();
  const remedies = [...fromHeld, ...substitutes, ...buy].filter((r) => {
    const key = JSON.stringify(r.command);
    return !seen.has(key) && Boolean(seen.add(key));
  });
  return { code: onOrder ? 'production.materialsOnOrder' : 'production.materialsShort', severity: onOrder ? ('warn' as const) : severity, params: { materials: mats.map((m) => hold.material(m).label).join(', '), where }, remedies };
}

/** trees near a store that give what is missing of a good felling yields (logs, brash), felled by hand onto it */
/** the trees open work will fell (a tree is felled once) */
function treesInWork(read: ReadCtx): Set<string> {
  const claimed = new Set<string>();
  for (const [, w] of read.all('WorkPackage')) {
    if (w.status === 'done' || w.status === 'cancelled') continue;
    for (const t of w.fells?.trees.slice(w.felled ?? 0) ?? []) claimed.add(t.id);
  }
  return claimed;
}

/**
 * Wood nobody sells is won by felling: the nearest trees no work fells yet that give what is missing at a
 * store (logs and brash from the same trees), less what fellings under way will still put there.
 */
function fellRemedies(read: ReadCtx, store: EntityId, needs: Record<string, number>): Remedy[] {
  const f = read.data('productionSettings').felling;
  const hold = read.port('holdings');
  const at = hold.where(store);
  if (!f || !at) return [];
  const veg = read.port('vegetation');
  // in the material's unit: what is missing, less what fellings onto this store will still bring
  const left: Record<string, number> = {};
  for (const [mat, need] of Object.entries(needs)) if (mat === f.logs || mat === f.brash) left[mat] = need;
  if (!Object.keys(left).length) return [];
  const inUnit = (mat: string, t: number) => (t * 1000) / unitMass(hold.material(mat));
  const yields = (w: { stem: number; crown: number }) => ({ [f.logs]: w.stem, [f.brash]: w.crown });
  for (const [, w] of read.all('WorkPackage')) {
    if (w.status === 'done' || w.status === 'cancelled' || w.fells?.store !== store) continue;
    for (const t of w.fells.trees.slice(w.felled ?? 0)) {
      const tree = veg.tree(t.id);
      if (!tree) continue;
      const y = yields(veg.wood(tree));
      for (const mat of Object.keys(left)) left[mat] = left[mat]! - inUnit(mat, y[mat] ?? 0);
    }
  }
  if (Object.values(left).every((x) => x <= 0)) return [];
  const claimed = treesInWork(read);
  // the nearest trees that give what is missing: ours to fell first; failing that, another's too (said whose, with the ask for leave)
  const party = hold.holder(store);
  const whose = (x: number, z: number) => (party === undefined ? null : (read.contributions('notOursToFell').map((c) => c.impl(read, party, [x, z])).find((w) => w !== null) ?? null));
  const near = [...veg.treesNear(at, 150)].filter((t) => !claimed.has(t.id)).sort((a, b) => Math.hypot(a.x - at[0], a.z - at[1]) - Math.hypot(b.x - at[0], b.z - at[1]) || (a.id < b.id ? -1 : 1));
  const pick = (others: boolean) => {
    const need = { ...left };
    const trees: string[] = [];
    const holders = new Map<string, Remedy[]>();
    for (const t of near) {
      if (Object.values(need).every((x) => x <= 0)) break;
      const w = whose(t.x, t.z);
      if (w && !others) continue;
      if (w) holders.set(w.holder, w.ask);
      const y = yields(veg.wood(t));
      for (const mat of Object.keys(need)) need[mat] = need[mat]! - inUnit(mat, y[mat] ?? 0);
      trees.push(t.id);
    }
    return Object.values(need).some((x) => x > 0) || !trees.length ? undefined : { trees, holders };
  };
  const got = pick(false) ?? pick(true);
  if (!got) return [];
  const what = Object.keys(left).map((m) => hold.material(m).label.toLowerCase()).join(' and ');
  const n = got.trees.length;
  const on = got.holders.size ? `, on land of ${[...got.holders.keys()].join(' and ')} without their leave: they may claim the wood` : '';
  const asks = [...got.holders.values()].flat();
  return [...asks, { label: `Fell ${n} ${n === 1 ? 'tree' : 'trees'} near by for ${what} (by hand, onto ${hold.label(store)}${on})`, command: { type: 'production.fell', payload: { trees: got.trees, by: 'hand', store } } }];
}

/** mend a package's crew and machines; true when it had to let go of a machine and is no longer at work */
function repairCrew(ctx: WriteCtx, id: EntityId): boolean {
  const pkg0 = ctx.require('WorkPackage', id);
  const eq = ctx.port('equipment');
  // a machine no longer ours to use (lent out, or the one lent to us asked back): let go, and the work picks again
  const party = partyOf(ctx, id);
  const lost = pkg0.machines.filter((m) => ctx.get('Machine', m) && !eq.usableBy(m, party));
  if (lost.length) {
    for (const m of lost) if (ctx.get('Assignment', m)?.package === id) ctx.remove('Assignment', m);
    ctx.patch('WorkPackage', id, { machines: pkg0.machines.filter((m) => !lost.includes(m)) });
    if (pkg0.status === 'active') {
      account(ctx, id);
      if (pkg0.process) ctx.proc.setRate(pkg0.process, 0);
      clearActive(ctx, id);
      release(ctx, id);
      ctx.patch('WorkPackage', id, { status: 'ready' });
    }
    requestDispatch(ctx);
    return true;
  }
  const pkg = ctx.require('WorkPackage', id);
  const wf = ctx.port('workforce');
  let crew = [...pkg.crew];
  let machines = [...pkg.machines];
  let changed = false;
  for (const m of pkg.machines) {
    const mach = ctx.get('Machine', m);
    if (mach && mach.status !== 'broken' && mach.status !== 'servicing') continue;
    const role = ctx.get('Assignment', m)?.role ?? '';
    const classes = activityOf(ctx, pkg.activity).equipment.find((r) => r.role === role)?.classes ?? [];
    const replacement = machinesOf(ctx, partyOf(ctx, id), classes).find((x) => isFreeMachine(ctx, x) && ctx.get('Machine', x)?.status === 'ready');
    if (!replacement) continue;
    ctx.remove('Assignment', m);
    ctx.set('Assignment', replacement, { package: id, role });
    machines = machines.map((x) => (x === m ? replacement : x));
    changed = true;
  }
  for (const p of pkg.crew) {
    if (wf.present(p)) continue;
    const a = ctx.get('Assignment', p);
    if (!a) continue;
    // which qualification did this person cover?
    const activity = activityOf(ctx, pkg.activity);
    const crewRole = activity.crew.find((r) => r.role === a.role);
    let qual = crewRole?.qualification;
    if (!qual && a.role.endsWith(' operator')) {
      const mRole = a.role.slice(0, -' operator'.length);
      const mach = machines.find((m) => ctx.get('Assignment', m)?.role === mRole);
      if (mach) qual = eq.modelOf(mach).operatorQualification;
    }
    if (!qual) continue;
    const replacement = wf
      .staff(partyOf(ctx, id))
      .filter((x) => isFreePerson(ctx, x) && wf.canDo(x, qual!))
      .sort((x, y) => wf.speed(y, qual!) - wf.speed(x, qual!) || (x < y ? -1 : 1))[0];
    if (!replacement) continue;
    ctx.remove('Assignment', p);
    ctx.set('Assignment', replacement, { package: id, role: a.role, skill: qual });
    crew = crew.map((x) => (x === p ? replacement : x));
    changed = true;
  }
  if (changed) ctx.patch('WorkPackage', id, { crew, machines });
  return false;
}

type BlockerSpec = { code: string; severity: 'info' | 'warn' | 'block'; params?: Record<string, string | number>; remedies?: Remedy[] };

/** the areas felled by work, done (kept for each world, by its routing port, until a package changes) */
const felledCaches = new WeakMap<object, { rev: number; areas: Vec2[][] }>();
function felledAreas(read: ReadCtx): Vec2[][] {
  const world = read.port('routing') as object;
  const rev = read.state('production').felled ?? 0;
  const kept = felledCaches.get(world);
  if (kept?.rev === rev) return kept.areas;
  const areas = [...read.all('WorkPackage')].filter(([, w]) => w.status === 'done' && (w.data as { cleared?: Vec2[] } | undefined)?.cleared).map(([, w]) => (w.data as { cleared: Vec2[] }).cleared);
  felledCaches.set(world, { rev, areas });
  return areas;
}

/**
 * The trees that bar a haul's trucks between the front and the heap on ground they go on today (S3): the trunks about
 * the straight way between them; undefined when it is the ground (soaked, water) or nothing standing that bars it
 */
function haulTrees(ctx: ReadCtx, from: Vec2, to: Vec2, profile: string): { trees: string[]; lane: Vec2[] } | undefined {
  const prof = ctx.port('routing').profile(profile);
  if (!prof.ground || !ctx.hasPort('vegetation')) return undefined;
  const soil = ctx.port('soil-state');
  const terrain = ctx.port('terrain');
  const veg = ctx.port('vegetation');
  const L = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const n = Math.max(1, Math.ceil(L / 5));
  const ids = new Set<string>();
  const half = prof.ground.width.value / 2 + HAUL_LANE_ROOM;
  for (let k = 0; k <= n; k += 1) {
    const q: Vec2 = [from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n];
    if (!(prof.ground[soil.trafficability(q[0], q[1])].value > 0) || terrain.waterDepthAt(q[0], q[1]) > (prof.wading?.value ?? 0)) return undefined;
    for (const t of veg.treesNear(q, half)) ids.add(t.id);
  }
  if (!ids.size) return undefined;
  // (a lane felled between them, as wide as the truck with room either side)
  const nx = -(to[1] - from[1]) / (L || 1);
  const nz = (to[0] - from[0]) / (L || 1);
  const lane: Vec2[] = [[from[0] + nx * half, from[1] + nz * half], [to[0] + nx * half, to[1] + nz * half], [to[0] - nx * half, to[1] - nz * half], [from[0] - nx * half, from[1] - nz * half]];
  return { trees: [...ids].sort(), lane: lane.map((q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10] as Vec2) };
}

/** the way out of the weather is waiting: until when, by the published forecast (what anyone can know, never the weather to come) */
function waitFor(ctx: ReadCtx, what: string, ok: (f: ForecastDay) => boolean): Remedy[] {
  const fc = ctx.port('weather').forecast(ctx.calendar.startOfDay(ctx.now), 5).filter((f) => f.lead >= 1);
  const f = fc.find(ok);
  return [f ? { label: `Wait: the forecast gives ${what} on ${ctx.calendar.format(f.day * DAY, 'day')}`, wait: { until: f.day * DAY } } : { label: `Wait: the 5-day forecast gives none yet (${what})`, wait: {} }];
}

/** weather and ground conditions at the work front: stop reasons and rate factors */
function environment(ctx: ReadCtx, activity: Activity, front: Vec2): { blockers: BlockerSpec[]; factors: Explained[] } {
  const blockers: BlockerSpec[] = [];
  const factors: Explained[] = [];
  const w = activity.weather;
  const hour = ctx.port('weather').hour(ctx.now);
  const wait = (what: string, ok: (f: ForecastDay) => boolean): Remedy[] => waitFor(ctx, what, ok);
  if (w.maxPrecip && hour.precip > w.maxPrecip.value) blockers.push({ code: 'production.weatherRain', severity: 'block', params: { precip: hour.precip, limit: w.maxPrecip.value }, remedies: wait('a dry day', (f) => f.precipProbability < 0.4) });
  if (w.minTemp && hour.airTemp < w.minTemp.value) blockers.push({ code: 'production.weatherCold', severity: 'block', params: { temp: hour.airTemp, limit: w.minTemp.value }, remedies: wait(`a day above ${w.minTemp.value} °C`, (f) => f.tMax >= w.minTemp!.value) });
  if (w.maxWind && hour.wind > w.maxWind.value) blockers.push({ code: 'production.weatherWind', severity: 'block', params: { wind: hour.wind, limit: w.maxWind.value }, remedies: wait('a calmer day', (f) => f.wind <= w.maxWind!.value) });
  const soilState = ctx.port('soil-state');
  if (w.maxFrostDepth && soilState.frostDepthAt(front[0], front[1]) > w.maxFrostDepth.value) {
    blockers.push({ code: 'production.groundFrozen', severity: 'block', params: { depth: soilState.frostDepthAt(front[0], front[1]), limit: w.maxFrostDepth.value }, remedies: wait('nights without frost (the ground then thaws over days)', (f) => !f.frost && f.tMin > 0) });
  }
  if (w.trafficability && w.trafficability !== 'any') {
    const tr = soilState.trafficability(front[0], front[1]);
    if (tr === 'none' || (w.trafficability === 'good' && tr === 'reduced')) blockers.push({ code: 'production.soilTooWet', severity: 'block', params: { state: tr }, remedies: wait('a dry day (the ground then dries over days)', (f) => f.precipProbability < 0.3 && f.precip < 1) });
    else if (tr === 'reduced' && w.reducedFactor) factors.push(ex.param(w.reducedFactor, 'wet soil (reduced trafficability)'));
  }
  return { blockers, factors };
}

/**
 * The light own work outdoors needs (S7, audit D1), and where it comes from: daylight (the sun's elevation, dimmed by the
 * hour's cloud), else a light tower of the party's within reach of the work (ready, fuelled, giving as much light). A
 * firm's crew brings its own lights. null: no gate (enough daylight, a firm, no requirement)
 */
function lightAt(ctx: ReadCtx, id: EntityId, pkg: Readonly<WorkPackage>, activity: Activity, front: Vec2): { need: number; day: number; tower?: EntityId } | null {
  const need = lightNeed(ctx, pkg, activity);
  if (need === undefined || !ctx.hasPort('weather')) return null;
  const day = ctx.port('weather').light(ctx.now);
  if (day >= need) return null;
  const eq = ctx.port('equipment');
  const party = workParty(ctx, id);
  for (const m of [...eq.machines()].sort()) {
    const md = eq.modelOf(m);
    const mc = ctx.get('Machine', m);
    if (!md.light || !mc || mc.status !== 'ready' || md.light.lux.value < need || (party && !eq.usableBy(m, party))) continue;
    const at = eq.positionAt(m, ctx.now);
    if (Math.hypot(at[0] - front[0], at[1] - front[1]) > Math.sqrt(md.light.area.value / Math.PI)) continue;
    if (md.engine && !(mc.tank && ctx.port('holdings').stock(mc.tank, fuelOf(md)) > 0.5)) continue;
    return { need, day, tower: m };
  }
  return { need, day };
}

/** a light tower's hours lighting a work, booked (its engine run, its fuel burnt): S7 */
function litFor(ctx: WriteCtx, id: EntityId, lit: { by: EntityId; since: number }): void {
  const { lit: _l, ...rest } = ctx.require('WorkPackage', id);
  ctx.set('WorkPackage', id, rest as WorkPackage);
  const hours = Math.min(24, (ctx.now - lit.since) / HOUR);
  if (hours > 1e-6 && ctx.get('Machine', lit.by)?.status === 'ready') ctx.command('equipment.logWork', { machine: lit.by, hours, load: 1 });
}

/** when it is next light enough (the sun's course, known ahead, under the sky as it is now): the first quarter hour from now at `need` lx */
function lightAgain(ctx: ReadCtx, need: number): number | undefined {
  const w = ctx.port('weather');
  // (as dim as the clouds make it now: under an overcast sky later in the morning)
  const clear = w.clearLight(ctx.now);
  const dim = clear > 1e-6 ? Math.min(1, w.light(ctx.now) / clear) : 1;
  for (let t = Math.floor(ctx.now / (HOUR / 4)) * (HOUR / 4) + HOUR / 4; t < ctx.now + 2 * DAY; t += HOUR / 4) if (w.clearLight(t) * dim >= need) return t;
  return undefined;
}

interface RateDecision {
  rate: number;
  /** a light tower lighting the work meanwhile (it runs, and burns its fuel, while the work goes on: S7) */
  litBy?: EntityId;
  /** give the crew back (nothing to work with) */
  release?: boolean;
  /** when the staged material runs out at this rate: decided again then (the crew and plant are not held for the rest of the hour) */
  runsOut?: number;
  explain?: Explained;
  blockers: { code: string; severity: 'info' | 'warn' | 'block'; params?: Record<string, string | number>; remedies?: Remedy[] }[];
}

function decideRate(ctx: WriteCtx, id: EntityId, until: number): RateDecision {
  const pkg = ctx.require('WorkPackage', id);
  const project = ctx.require('Project', pkg.project);
  const activity = activityOf(ctx, pkg.activity);
  if (project.status !== 'active') return { rate: 0, blockers: [{ code: 'production.projectPaused', severity: 'info' }] };
  const wf = ctx.port('workforce');
  if (!wf.onShift(ctx.now, workParty(ctx, id))) {
    // a holiday is said on the work it stills, with when it goes on (Qwen S370: active, 0/h, and no word why)
    const holiday = wf.scheduleOf(workParty(ctx, id)) === 'business' ? wf.holiday(ctx.now) : undefined;
    return { rate: 0, blockers: holiday ? [{ code: 'production.holiday', severity: 'info', params: { holiday, next: ctx.calendar.format(wf.nextShiftStart(ctx.now, workParty(ctx, id))) } }] : [] };
  }
  const blockers: RateDecision['blockers'] = [];
  const progress = progressOf(ctx, pkg);
  const front = workFront(pkg, progress);
  const settings = ctx.data('productionSettings');
  // people present, and at the work (design/physical-state.md I2: those on the way, or elsewhere, do not work here)
  const moves = ctx.port('moves');
  const coming = pkg.crew.filter((p) => wf.present(p) && !atWork(ctx, p, pkg));
  if (coming.length) {
    const role = (p: EntityId) => ctx.get('Assignment', p)?.role ?? '';
    const short = coming.some((p) => role(p).endsWith(' operator')) || activity.crew.some((r) => pkg.crew.filter((p) => role(p) === r.role && atWork(ctx, p, pkg)).length < Math.min(r.min ?? r.count, r.max ?? r.count));
    if (short) {
      const on = coming.map((p) => moves.placeOf(p)?.on).filter((m): m is EntityId => m !== undefined && ctx.has('Move', m));
      const by = on.length === coming.length ? Math.max(...on.map((m) => ctx.require('Move', m).legs.at(-1)!.arrive)) : undefined;
      // (all on their way: they come by themselves, the work waits; someone who cannot get there blocks it)
      return { rate: 0, blockers: [{ code: 'production.crewOnTheWay', severity: by !== undefined ? 'info' : 'block', params: { names: coming.map((p) => wf.name(p)).join(', ') }, ...(by !== undefined ? { remedies: [{ label: `Wait: there by ${ctx.calendar.format(by, 'time')}`, wait: { until: by } }] } : {}) }] };
    }
  }
  const absent = pkg.crew.filter((p) => !wf.present(p));
  if (absent.length) {
    // the work stops only when a role has fewer hands than it needs (or a machine lacks its operator)
    const role = (p: EntityId) => ctx.get('Assignment', p)?.role ?? '';
    const short = absent.some((p) => role(p).endsWith(' operator')) || activity.crew.some((r) => pkg.crew.filter((p) => role(p) === r.role && wf.present(p)).length < Math.min(r.min ?? r.count, r.max ?? r.count));
    // back on a known day: the work waits for them (someone released for their notice does not come back)
    const back = absent.map((p) => (released(ctx, p) ? undefined : wf.backAt(p)));
    const until = back.every((u) => u !== undefined) ? Math.max(...(back as number[])) : undefined;
    const back2 = backFromShortTime(ctx, absent.filter((p) => ctx.get('Presence', p)?.status === 'shortTime'));
    const waits = until !== undefined ? [{ label: `Wait: all back by ${ctx.calendar.format(until, 'day')}`, wait: { until } }] : [];
    blockers.push({ code: 'production.crewAbsent', severity: short ? 'block' : 'warn', params: { names: absent.map((p) => ctx.port('workforce').name(p)).join(', ') }, ...(waits.length || back2.length ? { remedies: [...back2, ...waits] } : {}) });
  }
  // machines working and on site?
  const eq = ctx.port('equipment');
  for (const m of pkg.machines) {
    const mach = { ...ctx.require('Machine', m), pos: ctx.port('equipment').positionAt(m, ctx.now) };
    const md = eq.modelOf(m);
    const label = `${md.label} (${m})`;
    // offered for sale while at work: when a buyer comes, it goes (RUNS2 S26: said, before it happens)
    if (mach.listing && !mach.listing.buyer) blockers.push({ code: 'production.machineForSale', severity: 'warn', params: { machine: label }, remedies: [{ label: `Withdraw the ${md.label} from sale`, command: { type: 'equipment.withdrawListing', payload: { machine: m } } }] });
    if (mach.status === 'broken') blockers.push({ code: 'production.machineBroken', severity: 'block', params: { machine: label }, remedies: replacementRemedies(ctx, m, pkg.pos) });
    else if (mach.status === 'servicing') blockers.push({ code: 'production.machineService', severity: 'block', params: { machine: label }, remedies: [{ label: `Wait: in service${mach.until !== undefined ? ` until ${ctx.calendar.format(mach.until)}` : ''}`, wait: mach.until !== undefined ? { until: mach.until } : {} }] });
    else if (mach.status === 'travelling' || mach.status === 'arriving') blockers.push({ code: 'production.machineTravelling', severity: 'warn', params: { machine: label } });
    else if (ctx.port('equipment').fuel(m) < fuelPerHour(md, activity.machineLoad.value)) {
      // less than an hour of fuel (the decision interval): the machine stands until it is refuelled from a stock
      const hold = ctx.port('holdings');
      // (topped up from our own stock where there is some: the work waits for the way there and back)
      const top = ctx.command('equipment.topUp', { machine: m });
      if (top.ok) {
        const until = (top.value as { until: number }).until;
        blockers.push({ code: 'production.machineRefuelling', severity: 'block', params: { machine: label, until: ctx.calendar.format(until, 'time') }, remedies: [{ label: `Wait: ${label} back at work ${ctx.calendar.format(until, 'time')}`, wait: { until } }] });
        continue;
      }
      const material = fuelOf(md);
      const mat = hold.material(material);
      // (its fuel is its user's: the one it is lent to, or its holder)
      const user = partyOf(ctx, id);
      const tank = hold.ofParty(user, { kept: true, near: [mach.pos[0], mach.pos[1]], has: material, accepts: material })[0] ?? hold.ofParty(user, { kind: 'depot' })[0];
      const offer = ctx.port('trade').offers(material)[0];
      const onOrder = tank ? ctx.port('trade').onOrder(tank, material) : 0;
      // a yard fills up for weeks: diesel by the 15,000 l tanker load, other fuels by the drum/minimum order
      const qty = offer ? Math.max(offer.minOrder, material === 'diesel' ? 15_000 : (md.engine?.tankSize.value ?? 0) * 20) : 0;
      const fmt = (x: number) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const remedies: Remedy[] =
        onOrder > 0
          ? [{ label: `Wait: ${fmt(onOrder)} ${mat.unit} ${mat.label} on order for the yard; machines refuel at night`, wait: {} }]
          : tank && offer
            ? [{ label: `Order ${fmt(qty)} ${mat.unit} ${mat.label} for the yard`, command: { type: 'inventory.order', payload: { material, qty, store: tank } } }]
            : [];
      blockers.push({ code: 'production.machineNoFuel', severity: 'block', params: { machine: label, fuel: mat.label }, remedies });
    } else if (toWork(pkg, mach.pos) > settings.workReach.value) {
      // its operator takes it (a tool: one of the crew who works with it): r36, nothing goes with nobody
      const role = ctx.get('Assignment', m)?.role ?? '';
      const by = (r: string) => pkg.crew.filter((x) => ctx.get('Assignment', x)?.role === r).sort()[0];
      const driver = role.endsWith(' tool') ? by(role.slice(0, -' tool'.length)) : by(`${role} operator`);
      // (to the front, or as near it as it can get within the site: a van at the bank of a creek it cannot ford)
      const r = ctx.command('equipment.moveTo', { machine: m, to: front, near: settings.workReach.value * 0.9, ...(driver ? { driver } : {}) });
      blockers.push(
        r.ok
          ? { code: 'production.machineTravelling', severity: 'warn', params: { machine: label } }
          : { code: 'production.machineUnreachable', severity: 'block', params: { machine: label, reason: r.reasons.map((x) => ctx.formatBlocker(x)).join('; ') } },
      );
    }
  }
  if (blockers.some((b) => b.severity === 'block' || b.code === 'production.machineTravelling')) return { rate: 0, blockers };

  // environment
  const env = environment(ctx, activity, front);
  blockers.push(...env.blockers);
  const factors = env.factors;
  // the crew waits out a shower, but is redeployed when the ground itself is unworkable
  if (env.blockers.some((b) => b.code === 'production.soilTooWet' || b.code === 'production.groundFrozen')) return { rate: 0, blockers, release: true };
  // the light (S7): too dark without a light tower at the work, it waits until it is light, or until one comes
  const light = lightAt(ctx, id, pkg, activity, front);
  if (light && !light.tower) {
    const again = lightAgain(ctx, light.need);
    const tower = Object.entries(ctx.data('machineModels') ?? {}).find(([, md]) => md.light && md.light.lux.value >= light.need && md.rentalPerDay);
    const remedies: Remedy[] = [
      ...(again !== undefined ? [{ label: `Wait until it is light: about ${ctx.calendar.format(again)}`, wait: { until: again } }] : []),
      ...(tower ? [{ label: `Hire a ${tower[1].label} for the work (lit to ${tower[1].light!.lux.value} lx)`, command: { type: 'equipment.acquire', payload: { model: tower[0], ownership: 'rented', pos: [front[0] + 8, front[1] + 8] } } }] : []),
    ];
    blockers.push({ code: 'production.dark', severity: 'block', params: { lux: light.day < 1 ? 'less than 1' : String(Math.round(light.day)), need: light.need, until: again !== undefined ? `about ${ctx.calendar.format(again)}` : 'not within two days' }, remedies });
    // (decided again when it gets light, not at the next hour)
    if (blockers.every((b) => b.severity !== 'block' || b.code === 'production.dark') && again !== undefined) return { rate: 0, blockers, runsOut: again };
  }
  if (blockers.some((b) => b.severity === 'block')) return { rate: 0, blockers };

  // base rate with the actual resources
  const operatorSkill: Record<string, number> = {};
  const machinesRes: RateResources['machines'] = [];
  for (const m of pkg.machines) {
    const role = ctx.get('Assignment', m)?.role ?? '';
    const model = eq.modelOf(m);
    machinesRes.push({ role, model, modelId: ctx.require('Machine', m).model });
    // how practised the operators are at this machine (learning curve × aptitude)
    const skills = pkg.crew.filter((p) => ctx.get('Assignment', p)?.role === `${role} operator`).map((p) => skillSpeed(ctx, p));
    operatorSkill[role] = skills.length ? skills.reduce((a, b) => a + b, 0) / skills.length : 1;
  }
  const res: RateResources = { machines: machinesRes, operatorSkill, crewSkill: crewFactor(ctx, pkg, activityOf(ctx, pkg.activity)) };
  let base: Explained;
  let limiting = '';
  if (isSubcontracted(pkg, activity)) base = subcontractRate(activity, pkg.activity);
  else {
    const soil = ctx.port('terrain').soilClass(pkg.soilClass);
    const rctx: RateContext = { activity, activityId: pkg.activity, pos: front, params: pkg.params, soil, soilId: pkg.soilClass };
    if (pkg.haulTo) rctx.haulTo = pkg.haulTo;
    const br = baseRate(rctx, res, haulageOf(ctx, false));
    base = br.rate;
    limiting = br.limiting;
    // the trucks have no way between the front and the heap over today's ground, which a firm, dry day gives them: the
    // work waits for the ground (said, with the forecast's dry day)
    if (pkg.haulTo && !(base.v > 0 && Number.isFinite(base.v)) && baseRate(rctx, res, haulageOf(ctx, true)).rate.v > 0) {
      const to = `(${Math.round(pkg.haulTo[0])}, ${Math.round(pkg.haulTo[1])})`;
      // (trees in the way, on ground firm enough today: felled, the trucks go; else the ground: a dry day)
      const way = haulTrees(ctx, front, pkg.haulTo, pkg.haul?.truck?.profile ?? 'tipper4');
      if (way) {
        // (the trees the lane holds, as the felling takes them; a felling of them already under way: it is waited for)
        const inLane = ctx.port('vegetation').treesIn(way.lane).map((t) => t.id);
        const claimed = treesInWork(ctx);
        const felling = [...ctx.all('WorkPackage')].find(([, w]) => w.status !== 'done' && w.status !== 'cancelled' && w.fells?.trees.slice(w.felled ?? 0).some((t) => inLane.includes(t.id)));
        if (felling || inLane.some((t) => claimed.has(t))) blockers.push({ code: 'production.haulTrees', severity: 'block', params: { to, n: inLane.length }, remedies: [{ label: `Wait: a lane is being felled (${felling?.[1].label ?? 'other work'})`, wait: {} }] });
        else blockers.push({ code: 'production.haulTrees', severity: 'block', params: { to, n: inLane.length }, remedies: [{ label: `Fell a lane for the trucks (${inLane.length} trees)`, command: { type: 'production.fell', payload: { area: way.lane, by: 'chainsaw' } } }] });
      }
      else blockers.push({ code: 'production.haulNoWay', severity: 'block', params: { to }, remedies: waitFor(ctx, 'a dry day (the ground then dries over days)', (f) => f.precipProbability < 0.3 && f.precip < 1) });
      return { rate: 0, blockers, release: true };
    }
    // the haul as loads: its trucks' cycle and what one takes, as these trucks make them now
    const hc = haulCycle(rctx, res, haulageOf(ctx, false));
    const now = ctx.require('WorkPackage', id).haul;
    if (hc && (now?.cycle !== hc.cycle || now?.perLoad !== hc.perLoad)) ctx.patch('WorkPackage', id, { haul: { ...now, cycle: hc.cycle, perLoad: hc.perLoad } });
  }
  if (!(base.v > 0) || !Number.isFinite(base.v)) {
    blockers.push({ code: 'production.noOutput', severity: 'block', params: { limiting: limiting || 'rate' } });
    return { rate: 0, blockers, release: true };
  }
  let rate = ex.mul('effective rate', base.u, base, breakFactor(ctx, ctx.now, workParty(ctx, id)), ...factors);
  if (isSubcontracted(pkg, activity) && !pkg.crewOnSite) {
    const noAccess = siteAccessProblem(ctx, id, ['van']);
    if (noAccess) {
      blockers.push({ code: 'production.siteNoAccess', severity: 'block', params: { reason: noAccess } });
      return { rate: 0, blockers, release: true };
    }
    blockers.push({
      code: 'production.crewArriving',
      severity: 'info',
      params: {
        who: ctx.data('contractors')[pkg.contractor ?? '']?.label ?? activity.subcontract!.label,
      },
    });
    return { rate: 0, blockers };
  }
  if (pkg.supplyBooking?.calledOffDay === Math.floor(ctx.now / DAY)) {
    blockers.push({ code: 'production.supplyCalledOff', severity: 'info' });
    return { rate: 0, blockers };
  }
  // a rounding residue of work needs no material (nothing would be ordered for it)
  const residue = (1 - progress) * pkg.quantity <= 1e-6 * Math.max(1, pkg.quantity);
  if (pkg.supplies?.length && !residue) {
    const units = suppliedUnits(pkg);
    if (units <= 1e-6) {
      const noAccess = pkg.supplies.every((x) => x.inbound <= 1e-6) ? supplyAccessProblem(ctx, id, pkg.supplies.map((x) => x.profile)) : null;
      if (noAccess) {
        blockers.push({ code: 'production.siteNoAccess', severity: 'block', params: { reason: noAccess } });
        return { rate: 0, blockers, release: true }; // the crew is redeployed meanwhile
      }
      blockers.push({
        code: 'production.awaitingDelivery',
        severity: 'warn',
        params: { what: pkg.supplies.map((x) => x.label).join(', ') },
      });
      return { rate: 0, blockers };
    }
    const hrs = Math.max(1 / 60, (until - ctx.now) / HOUR);
    if (units / hrs < rate.v) rate = ex.min('limited by material delivered to the work front', rate.u, rate, ex.value(units / hrs, rate.u, 'delivered material allows'));
  }

  // follower may not overtake its SS predecessor (limit the rate so it cannot pass before the next decision)
  const cap = overtakeCap(ctx, pkg);
  if (cap < 1 && progress >= cap - 1e-6) {
    blockers.push({ code: 'production.waitingForFront', severity: 'info' });
    return { rate: 0, blockers };
  }
  if (cap < 1) {
    const hoursToDecision = Math.max(1 / 60, (until - ctx.now) / HOUR);
    rate = ex.min('limited by preceding work front', rate.u, rate, ex.value(((cap - progress) * pkg.quantity) / hoursToDecision, rate.u, 'catch-up limit'));
  }

  // material staging for the period until `until`
  const { per, storeOf } = effectiveMaterials(ctx, id);
  // hand work fed from a store out of reach, or making goods onto one (soil dug, wood felled): the crew carries
  // as well as works (machines bring their own; hand tools and aids such as a wheelbarrow do not)
  if (rate.v > 0) {
    const carried = carriedOf(ctx, pkg, per, storeOf);
    const heads = pkg.crew.filter((p) => atWork(ctx, p, pkg)).length;
    const barrows = pkg.machines.filter((m) => ctx.port('equipment').modelOf(m).class === 'wheelbarrow');
    const carry = handCarrying(ctx, activity, workFront(pkg, progress), carried.per, carried.storeOf, rate.v, heads, barrows.length ? ctx.port('equipment').modelOf(barrows[0]!) : undefined, barrows.length, pkg.quantity);
    if (carry) {
      rate = ex.mul('rate with carrying', rate.u, rate, carry);
      if (carry.v <= 1e-9) {
        blockers.push({ code: 'production.tooHeavy', severity: 'block', params: { why: carry.label ?? '' } });
        return { rate: 0, blockers };
      }
    }
  }
  const hours = Math.max(0, (until - ctx.now) / HOUR);
  const remaining = leftOf(pkg.quantity, doneOf(ctx, pkg));
  if (Object.keys(per).length && hours > 0 && remaining > 0) {
    const planned = Math.min(remaining, rate.v * hours);
    const hold = ctx.port('holdings');
    let feasible = planned;
    // what is at the front already, and what is drawn to it now: carried from its store by the work (its rate reckons
    // the carrying, until carrying is moves of its own: design/physical-state.md slice 4)
    const staged = { ...stagedOf(ctx, ctx.require('WorkPackage', id)) };
    for (const [mat, q] of Object.entries(per)) {
      if (q <= 0) continue;
      const need = Math.max(0, (planned - workFor(ctx, mat, q, pkg.accounted, staged[mat] ?? 0)) * q);
      const store = storeOf[mat];
      if (need > 0 && store) {
        // pieces are taken to the front whole; bulk as much as the work needs
        const counted = isCounted(hold.material(mat));
        const available = hold.stock(store, mat);
        const take = counted ? Math.min(Math.ceil(wholeIfNear(need)), Math.floor(wholeIfNear(available))) : Math.min(need, available);
        if (take > 0) {
          const front = frontOf(ctx, id);
          const r = ctx.command('inventory.transfer', { from: store, to: front, material: mat, qty: take, ...(hold.together(store, front) ? {} : { via: activity.equipment.length ? 'hauled by the work' : 'carried by the work' }), why: pkg.label });
          if (r.ok) {
            staged[mat] = (staged[mat] ?? 0) + take;
            // where it came from (a kit struck goes back where it came from)
            const w = ctx.require('WorkPackage', id);
            ctx.patch('WorkPackage', id, { drawn: { ...(w.drawn ?? {}), [mat]: { ...(w.drawn?.[mat] ?? {}), [store]: (w.drawn?.[mat]?.[store] ?? 0) + take } } });
          }
        }
      }
      feasible = Math.min(feasible, workFor(ctx, mat, q, pkg.accounted, staged[mat] ?? 0));
    }
    if (!covers(feasible, planned)) {
      const missingMats = Object.entries(per)
        .filter(([mat, q]) => q > 0 && !covers(workFor(ctx, mat, q, pkg.accounted, staged[mat] ?? 0), planned))
        .map(([mat]) => mat);
      // a residue within the tolerance is nothing: the work stops and frees its crew
      const none = feasible <= tolerance(planned);
      blockers.push(materialBlocker(ctx, id, missingMats, none ? 'block' : 'warn'));
      if (none) return { rate: 0, blockers, release: true };
      // the work goes at its pace while the material lasts, and stops then (not spread thin over the hour)
      if (rate.v > 0) return { rate: rate.v, explain: rate, blockers, runsOut: ctx.now + Math.ceil((feasible / rate.v) * HOUR), ...(light?.tower ? { litBy: light.tower } : {}) };
    }
  }
  return { rate: rate.v, explain: rate, blockers, ...(light?.tower && rate.v > 0 ? { litBy: light.tower } : {}) };
}

const BOOKING_WARNINGS = new Set(['production.bookingTooEarly', 'production.bookingAtRisk', 'production.crewWaitingForSite']);

/** the trees the work has come to by now: felled, gone from the land, their wood on the heap (a tree gone already gives nothing) */
function fell(ctx: WriteCtx, pkg: Readonly<WorkPackage>, done: number): { n: number; logs: number; where: [number, number, number, number][] } {
  const f = pkg.fells!;
  const veg = ctx.port('vegetation');
  let n = pkg.felled ?? 0;
  let cum = f.trees.slice(0, n).reduce((a, t) => a + t.q, 0);
  const now: string[] = [];
  const where: [number, number, number, number][] = [];
  let logs = 0;
  let brash = 0;
  while (n < f.trees.length && cum + f.trees[n]!.q <= done + tolerance(Math.max(done, 1))) {
    const t = f.trees[n]!;
    cum += t.q;
    n += 1;
    const tree = veg.tree(t.id);
    if (!tree) continue;
    const w = veg.wood(tree);
    logs += w.stem;
    brash += w.crown;
    now.push(t.id);
    where.push([tree.x, tree.z, w.stem, ctx.now]);
  }
  if (now.length) {
    ctx.command('vegetation.removeTrees', { ids: now, reason: pkg.label });
    // (from the trees felled: nature's, drawn by the work)
    if (logs > 0) ctx.command('inventory.extract', { from: 'trees', into: f.store, material: f.logs, qty: logs, why: pkg.label });
    if (brash > 0) ctx.command('inventory.extract', { from: 'trees', into: f.store, material: f.brash, qty: brash, why: pkg.label });
  }
  return { n, logs, where };
}

/** order a project's materials by its supply policy (none: the player orders) */
function orderSupply(ctx: WriteCtx, project: EntityId): void {
  const pr = ctx.require('Project', project);
  if (pr.status !== 'active' || !pr.supply) return;
  const done = (w: Readonly<WorkPackage>) => doneOf(ctx, w);
  if (pr.supply.mode === 'upfront') orderUpfront(ctx, project, effectiveMaterials, done);
  else orderJustInTime(ctx, project, effectiveMaterials, done);
}

function step(ctx: WriteCtx): void {
  const now = ctx.now;
  const packages = projectPackages(ctx);
  // 1. account
  for (const [id, pkg] of packages) if (pkg.status === 'active') account(ctx, id);
  // (the light towers that lit the work since the last decision: their hours run, their fuel burnt, S7)
  for (const [id, pkg] of packages) if (pkg.lit) litFor(ctx, id, pkg.lit);
  // 2. release waiting → ready, hold → done handled by timers; contractors re-book unready sites
  const forecasts = new Map<EntityId, Map<EntityId, ScheduleRow>>();
  const forecastOf = (project: EntityId) => forecasts.get(project) ?? forecasts.set(project, new Map(forecastSchedule(ctx, project).map((r) => [r.package, r]))).get(project)!;
  // work that cures: an hour more of its equivalent age by the air of the hour (S6)
  const air = ctx.hasPort('weather') ? ctx.port('weather').hour(now).airTemp : undefined;
  for (const [id, pkg] of packages) {
    const cures = air !== undefined ? curesOf(ctx, pkg) : undefined;
    if (cures && (pkg.cured ?? 0) < cures.age.value) ctx.patch('WorkPackage', id, { cured: (pkg.cured ?? 0) + maturityHour(cures, air!) });
  }
  for (const [id] of packages) {
    const pkg = ctx.require('WorkPackage', id);
    if (pkg.status === 'waiting') curingNews(ctx, id, pkg);
    if (pkg.status === 'waiting' && predecessorsSatisfied(ctx, pkg)) ctx.patch('WorkPackage', id, { status: 'ready' });
    else if (pkg.status === 'waiting' && pkg.contractor) {
      // (a firm on the job comes when its forecast start allows: the work before done and cured)
      const row = onTheJob(ctx, id, pkg.contractor) ? forecastOf(pkg.project).get(id) : undefined;
      maybePostpone(ctx, id, row ? (Number.isFinite(row.start) && !row.stalled ? row.start : null) : undefined);
      const warning = bookingWarning(ctx, id, forecastOf(pkg.project));
      if (warning) ctx.blockers.set(id, [warning]);
      else if (ctx.blockersOf(id).some((b) => BOOKING_WARNINGS.has(b.code))) ctx.blockers.clear(id);
    }
  }
  // just in time: orders go out as the schedule reaches them
  for (const [id, pr] of ctx.all('Project')) if (pr.status === 'active' && pr.supply?.mode === 'justInTime') orderSupply(ctx, id);
  // 3. assign in priority order
  const ordered = projectPackages(ctx)
    .filter(([, p]) => p.status === 'ready')
    .sort(([a, pa], [b, pb]) => {
      const A = ctx.require('Project', pa.project);
      const B = ctx.require('Project', pb.project);
      return B.priority - A.priority || A.createdAt - B.createdAt || (pa.project < pb.project ? -1 : pa.project > pb.project ? 1 : 0) || (a < b ? -1 : 1);
    })
    .map(([id]) => id);
  assign(ctx, ordered);
  // 4. rate
  const nextTick = (Math.floor(now / HOUR) + 1) * HOUR;
  const wf = ctx.port('workforce');
  let boundary = nextTick;
  // the next start or end of a working day of anyone working a package
  const parties = new Set<EntityId | undefined>([undefined, ...projectPackages(ctx).map(([pid]) => workParty(ctx, pid))]);
  for (const party of parties) {
    const win = wf.shiftWindow(now, party);
    if (!win) continue;
    if (win.start > now && win.start < boundary) boundary = win.start;
    if (win.end > now && win.end < boundary) boundary = win.end;
  }
  // and when a package's material runs out
  let reRate = boundary;
  for (const [id] of projectPackages(ctx)) {
    const pkg = ctx.require('WorkPackage', id);
    if (pkg.status !== 'active' || !pkg.process) continue;
    if (repairCrew(ctx, id)) continue;
    // its crew to its front: those on shift and not there go (on foot, by a move: design/physical-state.md I2)
    if (wf.onShift(now, workParty(ctx, id))) for (const p of pkg.crew) if (wf.present(p) && !atWork(ctx, p, pkg) && ctx.port('moves').placeOf(p)?.on === undefined) ctx.command('workforce.report', { person: p });
    const d = decideRate(ctx, id, boundary);
    if (d.runsOut !== undefined && d.runsOut > now && d.runsOut < reRate) reRate = d.runsOut;
    ctx.proc.setRate(pkg.process, d.rate, d.explain);
    // (the light tower runs while the work goes on by its light, to the next decision: its fuel burnt, S7)
    // (by a light tower's light from now: it runs, and its hours are booked when the next decision is made, S7)
    if (d.litBy && d.rate > 0) ctx.patch('WorkPackage', id, { lit: { by: d.litBy, since: now } });
    ctx.blockers.set(id, d.blockers);
    const fresh = ctx.require('WorkPackage', id);
    const { activeSince: _a, ...rest } = fresh;
    const next = { ...rest, rate: d.rate } as WorkPackage;
    // the accounting pass at the top of step() already booked work up to `now`
    if (d.rate > 0) next.activeSince = fresh.activeSince ?? now;
    ctx.set('WorkPackage', id, next);
    if (d.release) {
      release(ctx, id);
      ctx.patch('WorkPackage', id, { status: 'ready' });
    }
  }
  // 5. site logistics: contractor crews commute, deliveries run ahead of the work, hot-mix is called off on bad days
  siteLogistics(ctx);
  // exact re-rate at shift boundaries inside the hour
  const st = ctx.state('production');
  ctx.cancel(st.boundaryTimer ?? undefined);
  ctx.patchState('production', { boundaryTimer: reRate < nextTick ? ctx.at(reRate, 'boundary') : null, dispatchTimer: null });
}

/** blockers that only wait for the booked material/crew themselves do not stop deliveries */
const SUPPLY_WAITS = new Set(['production.awaitingDelivery', 'production.supplyCalledOff', 'production.crewArriving', 'production.supplyBooked', 'production.subcontractorBooked']);

const WEATHER_BLOCKS = new Set(['production.weatherRain', 'production.weatherCold', 'production.weatherWind']);

/**
 * Why the work of a package with a booked supply cannot go ahead now (null = it can). The morning
 * call-off ignores the current hour's weather (the day's forecast decides); trucks during the day
 * are held while it rains.
 */
function blockedBeyondSupply(ctx: ReadCtx, id: EntityId, ignoreWeather = false): string | null {
  const pkg = ctx.require('WorkPackage', id);
  if (pkg.status !== 'active' && pkg.status !== 'ready') return 'not started';
  const hard = ctx.blockersOf(id).filter((b) => b.severity === 'block' && !SUPPLY_WAITS.has(b.code) && !(ignoreWeather && WEATHER_BLOCKS.has(b.code)));
  if (hard.length) return hard.map((b) => ctx.formatBlocker(b)).join('; ');
  if (pkg.status === 'ready') return 'crew or machines not assigned';
  return null;
}

/**
 * What the foreman knows in the morning before calling the plant: who is off sick or on leave,
 * and which machines are down, away or without fuel (null = the crew and plant are there).
 */
function crewOrPlantProblem(ctx: ReadCtx, id: EntityId): string | null {
  const pkg = ctx.require('WorkPackage', id);
  const wf = ctx.port('workforce');
  const absent = pkg.crew.filter((p) => !wf.present(p));
  if (absent.length) return `crew absent: ${absent.map((p) => ctx.port('workforce').name(p)).join(', ')}`;
  const activity = activityOf(ctx, pkg.activity);
  const eq = ctx.port('equipment');
  for (const m of pkg.machines) {
    const mach = ctx.require('Machine', m);
    const md = eq.modelOf(m);
    if (mach.status === 'broken' || mach.status === 'servicing' || mach.status === 'travelling' || mach.status === 'arriving') return `${md.label} ${mach.status}`;
    if (eq.fuel(m) < fuelPerHour(md, activity.machineLoad.value)) return `${md.label} without fuel`;
  }
  return null;
}

/** how long before the shift start hot-mix trucks may be sent off */
const PRE_SHIFT_DISPATCH_S = 2 * HOUR;

/** the site's day for every kind of working day: a business's, and the own day of people working for themselves */
function siteLogistics(ctx: WriteCtx): void {
  const wf = ctx.port('workforce');
  const groups = new Map<string, { party: EntityId | undefined; pkgs: [EntityId, Readonly<WorkPackage>][] }>();
  for (const entry of projectPackages(ctx)) {
    const party = workParty(ctx, entry[0]);
    const kind = wf.scheduleOf(party);
    const g = groups.get(kind) ?? { party, pkgs: [] };
    g.pkgs.push(entry);
    groups.set(kind, g);
  }
  for (const [kind, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) siteDay(ctx, kind, g.party, g.pkgs);
}

function siteDay(ctx: WriteCtx, kind: string, party: EntityId | undefined, pkgs: [EntityId, Readonly<WorkPackage>][]): void {
  const wf = ctx.port('workforce');
  const day = Math.floor(ctx.now / DAY);
  const st = ctx.state('production');
  const onShift = wf.onShift(ctx.now, party);
  const mark = (key: 'lastMorning' | 'lastCallOff' | 'lastEvening') => ctx.patchState('production', { [key]: { ...ctx.state('production')[key], [kind]: day } });
  // hot-mix trucks leave before the shift so the first load is there when the crew starts
  const win = wf.shiftWindow(ctx.now, party);
  const preShift = !!win && ctx.now < win.start && win.start - ctx.now <= PRE_SHIFT_DISPATCH_S;
  if ((onShift || preShift) && st.lastCallOff[kind] !== day) {
    mark('lastCallOff');
    // the foreman decides on the morning forecast, not on the weather that will actually come
    const weather = ctx.port('weather').forecast(ctx.now, 1)[0] ?? ctx.port('weather').soFar(ctx.now);
    for (const [id, pkg] of pkgs) {
      if (!pkg.supplyBooking || pkg.supplyBooking.from > ctx.now || (pkg.status !== 'active' && pkg.status !== 'ready')) continue;
      const activity = activityOf(ctx, pkg.activity);
      // the foreman calls off the hot-mix delivery when the forecast, the ground or the site rules out paving
      const w = activity.weather;
      const bad = weather.precip >= 3 || (w.minTemp !== undefined && weather.tMax < w.minTemp.value);
      const ground = environment(ctx, activity, workFront(pkg, progressOf(ctx, pkg))).blockers.find((b) => b.code === 'production.groundFrozen' || b.code === 'production.soilTooWet');
      const stuck = (ground ? ctx.formatBlocker(ground) : null) ?? crewOrPlantProblem(ctx, id) ?? blockedBeyondSupply(ctx, id, true);
      if (bad || stuck) {
        ctx.patch('WorkPackage', id, { supplyBooking: { ...pkg.supplyBooking, calledOffDay: day } });
        ctx.log('info', `${pkg.label}: delivery called off for today (${stuck ? `the work cannot go ahead: ${stuck}` : `forecast ${weather.precip.toFixed(0)} mm, max ${weather.tMax.toFixed(0)} °C`}).`, [id]);
      }
    }
  }
  if (onShift && st.lastMorning[kind] !== day) {
    mark('lastMorning');
    for (const [id, pkg] of pkgs) {
      const activity = activityOf(ctx, pkg.activity);
      const startsToday = (pkg.status === 'active' || pkg.status === 'ready') && (pkg.earliestStart ?? 0) <= ctx.now + 12 * HOUR;
      if (activity.subcontract && pkg.contractor && startsToday) commute(ctx, id, 'in');
    }
  }
  if (onShift || preShift) {
    for (const [id] of pkgs) {
      const pkg = ctx.require('WorkPackage', id);
      if (!pkg.supplies?.length || pkg.status === 'done' || pkg.status === 'cancelled' || pkg.status === 'waiting') continue;
      if (pkg.supplyBooking) {
        if (pkg.supplyBooking.from > ctx.now || pkg.supplyBooking.calledOffDay === day) continue;
        const sup = ctx.data('suppliers')[pkg.supplyBooking.supplier];
        const hour = (ctx.now - ctx.calendar.startOfDay(ctx.now)) / HOUR;
        if (sup && (hour < sup.openFrom.value || hour >= sup.openTo.value)) continue;
        // hold further trucks at the plant while the paving is stopped (rain, breakdown, crew …)
        if (onShift && blockedBeyondSupply(ctx, id)) continue;
      } else if (!pkg.crewOnSite) continue;
      // material that sets is not sent while the work waits for the preceding work front, or is stopped
      // by anything but the material itself (the cold, rain, its crew): it would set before it is placed
      if (pkg.supplies.some((x) => x.perishableHours) && (ctx.blockersOf(id).some((b) => b.code === 'production.waitingForFront') || blockedBeyondSupply(ctx, id))) continue;
      dispatchDeliveries(ctx, id, pkg.rate);
    }
  } else if (st.lastEvening[kind] !== day && st.lastMorning[kind] === day) {
    mark('lastEvening');
    for (const [id, pkg] of pkgs) {
      if (pkg.crewOnSite) commute(ctx, id, 'out');
      if (pkg.supplies?.some((x) => x.perishableHours)) wastePerishables(ctx, id);
    }
  }
}

/** stop the working clock of a package (after accounting) */
function clearActive(ctx: WriteCtx, id: EntityId): void {
  const pkg = ctx.require('WorkPackage', id);
  if (pkg.activeSince === undefined && pkg.rate === 0) return;
  const { activeSince: _a, ...rest } = pkg;
  ctx.set('WorkPackage', id, { ...rest, rate: 0 } as WorkPackage);
}

/** the goods at a package's work front (its holding there) */
export function stagedOf(read: ReadCtx, pkg: Readonly<WorkPackage>): Record<string, number> {
  return pkg.front ? read.port('holdings').contents(pkg.front) : {};
}

/** a package's work front, where its work now is (design/physical-state.md I1) */
const frontOf = (ctx: WriteCtx, id: EntityId): EntityId => frontAt(ctx, id, workFront(ctx.require('WorkPackage', id), progressOf(ctx, ctx.require('WorkPackage', id))));

/**
 * The work done or given up: what is left at its front stays there (it is not carried back by itself, finding 14),
 * said, with the ways to move it to where it came from; an empty front is no holding any more.
 */
function leftAtFront(ctx: WriteCtx, id: EntityId): void {
  const pkg = ctx.require('WorkPackage', id);
  if (!pkg.front || !ctx.port('holdings').exists(pkg.front)) return;
  const left = Object.entries(ctx.port('holdings').contents(pkg.front)).filter(([, q]) => q > tolerance(0));
  if (!left.length) {
    ctx.command('inventory.closeStore', { store: pkg.front });
    const { front: _f, ...rest } = ctx.require('WorkPackage', id);
    ctx.set('WorkPackage', id, rest as WorkPackage);
    return;
  }
  const hold = ctx.port('holdings');
  const remedies = left.flatMap(([mat, qty]) => {
    const to = Object.keys(pkg.drawn?.[mat] ?? {}).find((sid) => hold.exists(sid)) ?? pkg.store;
    if (!to || !hold.exists(to)) return [];
    const m = hold.material(mat);
    const q = isCounted(m) ? Math.floor(wholeIfNear(qty)) : qty;
    if (q <= 0) return [];
    return [{ label: `Carry ${Math.round(q * 100) / 100} ${m.unit} ${m.label} back to ${hold.label(to)} by hand`, command: { type: 'production.moveGoods', payload: { from: pkg.front!, to, material: mat, qty: q, by: 'hand' } } }];
  });
  ctx.blockers.set(pkg.front, [{ code: 'production.leftAtFront', severity: 'info', params: { work: pkg.label, goods: left.map(([m, q]) => `${Math.round(q * 100) / 100} ${hold.material(m).unit} ${hold.material(m).label}`).join(', ') }, remedies }]);
}

function finishPackage(ctx: WriteCtx, id: EntityId): void {
  const pkg = ctx.require('WorkPackage', id);
  // a cancelled package (e.g. during its hold point) must not complete
  if (pkg.status !== 'hold' && pkg.status !== 'active') return;
  ctx.patch('WorkPackage', id, { status: 'done', completedAt: ctx.now, rate: 0 });
  // work against the law of the place, done (rubbish burnt in the open): the authorities may find it (8h)
  const offence = activityOf(ctx, pkg.activity).offence;
  if (offence) {
    const doer = pkg.crew[0] ?? ctx.port('workforce').lead(ctx.require('Project', pkg.project).party);
    if (doer) ctx.emit('production.legalExposure', { person: doer, party: ctx.require('Project', pkg.project).party, what: pkg.label, rule: activityOf(ctx, pkg.activity).label, kind: offence });
  }
  // a test pit dug: its party has seen the column there, to its depth (8d)
  const know = ctx.data('productionSettings').soilKnowledge;
  if (know && pkg.activity === know.testPit) {
    const terrain = ctx.port('terrain');
    const seen: { to: number; id: string }[] = [];
    for (let d = 0.1; d <= know.depth.value + 1e-9; d += 0.1) {
      const id0 = terrain.soilClassAtDepth(pkg.pos[0], pkg.pos[1], d - 0.05);
      if (seen.length && seen.at(-1)!.id === id0) seen.at(-1)!.to = Math.round(d * 100) / 100;
      else seen.push({ to: Math.round(d * 100) / 100, id: id0 });
    }
    const st = ctx.state('production');
    ctx.patchState('production', { probes: [...(st.probes ?? []), { party: ctx.require('Project', pkg.project).party, at: [pkg.pos[0], pkg.pos[1]], t: ctx.now, seen }] });
    ctx.log('info', `Test pit ${pkg.label}: ${seen.map((x, k) => `${k ? Math.round(seen[k - 1]!.to * 100) : 0}–${Math.round(x.to * 100)} cm ${terrain.soilClass(x.id).label ?? x.id}`).join(', ')}.`, [id]);
  }
  releaseBooking(ctx, id);
  if (pkg.contractor) jobDone(ctx, pkg.contractor, ctx.require('Project', pkg.project).party);
  ctx.blockers.clear(id);
  const project = ctx.require('Project', pkg.project);
  if ((pkg.data as { cleared?: unknown } | undefined)?.cleared) ctx.setState('production', { ...ctx.state('production'), felled: (ctx.state('production').felled ?? 0) + 1 });
  ctx.emit('production.packageCompleted', { package: id, project: pkg.project, owner: project.owner, ref: project.ref, key: pkg.key, activity: pkg.activity, data: pkg.data });
  // a store laid out: each kind of goods now in its place
  const lay = (pkg.data as { layout?: { store: EntityId; order: string[] } } | undefined)?.layout;
  // (only sorting work that covered the store's goods lays it out: a token package does not)
  const hold = ctx.port('holdings');
  const sorted = lay && pkg.activity === 'hand.sort' && hold.exists(lay.store) ? lay.store : undefined;
  const inStore = sorted ? Object.entries(hold.contents(sorted)).reduce((a, [m, q]) => a + (q > 0 ? (q * unitMass(hold.material(m))) / 1000 : 0), 0) : 0;
  if (sorted && hold.holder(sorted) === project.party && pkg.quantity >= inStore * 0.9 - 1e-9) ctx.command('inventory.setLayout', { store: lay!.store, order: lay!.order });
  ctx.patchState('production', { completed: ctx.state('production').completed + 1 });
  maybeComplete(ctx, pkg.project);
  requestDispatch(ctx);
}

/** a project whose packages are all done or cancelled is complete */
function maybeComplete(ctx: WriteCtx, id: EntityId): void {
  const project = ctx.require('Project', id);
  const allDone = project.packages.every((p) => {
    const x = ctx.get('WorkPackage', p);
    return !x || x.status === 'done' || x.status === 'cancelled';
  });
  if (allDone && project.status === 'active') {
    ctx.patch('Project', id, { status: 'complete', completedAt: ctx.now });
    clearSnags(ctx, id);
    ctx.emit('production.projectCompleted', { project: id, owner: project.owner, ref: project.ref });
    ctx.log('success', `Project completed: ${project.label}`, [id]);
  }
}

/**
 * The planner of a store's layout (decision 0026 A3, the site layout as a plan): its goods in the order
 * the work drawing from it will need them (the forecast schedule), the rest after, heaviest first.
 */
function layoutOrder(read: ReadCtx, store: EntityId): string[] {
  const need = new Map<string, number>();
  for (const [pid, pr] of read.all('Project')) {
    if (pr.status !== 'active' && pr.status !== 'paused') continue;
    for (const row of read.port('production').schedule(pid)) {
      if (row.status === 'done' || row.status === 'cancelled') continue;
      const { per, storeOf } = effectiveMaterials(read, row.package);
      for (const mat of Object.keys(per)) if (storeOf[mat] === store) need.set(mat, Math.min(need.get(mat) ?? Infinity, row.start));
    }
  }
  const hold = read.port('holdings');
  const contents = hold.contents(store);
  const mass = (m: string) => (contents[m] ?? 0) * unitMass(hold.material(m));
  return [...new Set([...Object.keys(contents).filter((m) => (contents[m] ?? 0) > 1e-9), ...need.keys()])].sort((a, b) => (need.get(a) ?? Infinity) - (need.get(b) ?? Infinity) || mass(b) - mass(a) || (a < b ? -1 : 1));
}

/** stop one package that is not done: what it has staged goes back, its people and machines are free */
function cancelOne(ctx: WriteCtx, id: EntityId): void {
  const pkg = ctx.require('WorkPackage', id);
  if (pkg.status === 'done' || pkg.status === 'cancelled') return;
  if (pkg.status === 'active') account(ctx, id);
  if (pkg.process) ctx.proc.cancel(pkg.process);
  clearActive(ctx, id);
  release(ctx, id);
  takenBack(ctx, id);
  leftAtFront(ctx, id);
  releaseBooking(ctx, id);
  ctx.patch('WorkPackage', id, { status: 'cancelled', cancelledAt: ctx.now });
  ctx.blockers.clear(id);
}

/**
 * A firm's work called off: what it brought and did not lay is its own and goes back with it (its price was for what is
 * laid, r41); goods the client bought for the work stay
 */
function takenBack(ctx: WriteCtx, id: EntityId): void {
  const pkg = ctx.require('WorkPackage', id);
  const front = pkg.front && ctx.port('holdings').exists(pkg.front) ? pkg.front : undefined;
  if (!front) return;
  const hold = ctx.port('holdings');
  for (const s of pkg.supplies ?? []) {
    if (s.kind !== 'subcontract' || !(s.delivered > 1e-9)) continue;
    const qty = Math.min(hold.stock(front, s.material), inMaterialUnit(ctx, s, s.delivered));
    if (qty > 1e-9) ctx.command('inventory.toOutside', { from: front, material: s.material, qty, why: `${s.label}: taken back by the firm, ${pkg.label} called off` });
  }
}

/** make the work packages of specs in a project (`ids`: the keys it has already); their estimated hours and cost */
function makePackages(ctx: WriteCtx, project: EntityId, store: EntityId | undefined, specs: PackageSpec[], ids: Record<string, EntityId>): { hours: number; cost: number; made: EntityId[] } {
  const acts = ctx.data('activities');
  const made: EntityId[] = [];
  for (const spec of specs) {
    if (!acts[spec.activity]) ctx.reject('production.unknownActivity', { activity: spec.activity });
    if (ids[spec.key]) ctx.reject('production.duplicateKey', { key: spec.key });
    ids[spec.key] = ctx.spawn('workPackage', { name: spec.label });
    made.push(ids[spec.key]!);
  }
  let hours = 0;
  let cost = 0;
  for (const spec of specs) {
    const after = (spec.after ?? []).map((a) => {
      const pid = ids[a.key];
      if (!pid) ctx.reject('production.badLink', { key: spec.key, after: a.key });
      return { package: pid!, type: a.type, lag: a.lag ?? (a.type === 'SS' ? 0.1 : 0) };
    });
    let est: Estimate;
    try {
      // (the plan's estimate on what its party knows of the ground; the work meets the ground as it is: 8d)
      est = estimatePackage(ctx, { ...spec, ...(spec.store ?? store ? { store: spec.store ?? store } : {}) }, ctx.get('Project', project)?.party);
    } catch (e) {
      return ctx.reject('production.invalidPackage', { key: spec.key, reason: (e as Error).message });
    }
    if (!(est.rate.v > 0) || !Number.isFinite(est.hours)) ctx.reject('production.invalidPackage', { key: spec.key, reason: `no output possible (${est.rate.label ?? 'rate 0'})` });
    hours += est.hours;
    cost += est.cost.v;
    const activity = acts[spec.activity]!;
    // (the work meets the ground as it is: 8d)
    const soil = spec.soilDepth !== undefined ? ctx.port('terrain').soilClassAtDepth(spec.pos[0], spec.pos[1], spec.soilDepth) : (spec.soilClass ?? ctx.port('terrain').soilClassAtDepth(spec.pos[0], spec.pos[1], 0.6));
    const pkg: WorkPackage = {
      project,
      key: spec.key,
      activity: spec.activity,
      label: spec.label,
      quantity: Math.max(spec.quantity, 1e-6),
      unit: activity.unit,
      pos: spec.pos,
      after,
      params: spec.params ?? {},
      consumes: spec.consumes ?? {},
      soilClass: soil,
      status: 'waiting',
      crew: [],
      machines: [],
      rate: 0,
      accounted: 0,
      workedHours: 0,
      cost: { labour: 0, equipment: 0, materials: 0, subcontract: 0 },
      estimate: { rate: est.rate.v, hours: est.hours, rateExplain: est.rate, cost: est.cost.v },
    };
    if (spec.path) pkg.path = spec.path;
    if (spec.haulTo) pkg.haulTo = spec.haulTo;
    if (spec.produces) pkg.produces = spec.produces;
    if (spec.fells?.trees.length) pkg.fells = spec.fells;
    if (spec.ground?.cells.length) pkg.ground = spec.ground;
    if (spec.store) pkg.store = spec.store;
    if (spec.substitutes) pkg.substitutes = spec.substitutes;
    if (spec.data !== undefined) pkg.data = spec.data;
    ctx.set('WorkPackage', ids[spec.key]!, pkg);
  }
  return { hours, cost, made };
}

// ---------------------------------------------------------------- schemas (runtime validation of components)

const V2 = s.point();
const PackageSchema = s.object(
  {
    project: s.ref('project'),
    key: s.string(),
    activity: s.string(),
    label: s.string(),
    quantity: s.number({ min: 0 }),
    unit: s.string(),
    pos: V2,
    status: s.enum(['waiting', 'ready', 'active', 'hold', 'done', 'cancelled']),
  },
  { passthrough: true },
);

const SpecSchema = s.object(
  {
    key: s.string(),
    activity: s.string(),
    label: s.string(),
    quantity: s.number({ min: 0 }),
    pos: V2,
  },
  { passthrough: true },
);

/** a player acts only on its own party's projects (modules acting for the world may) */
function mustOwnProject(ctx: WriteCtx, project: EntityId): void {
  if (ctx.caller !== 'client') return;
  const pr = ctx.get('Project', project);
  if (pr && pr.party !== actorOf(ctx)) ctx.reject('production.notOurs', { what: pr.label, party: partyLabel(ctx, actorOf(ctx)) });
}
const mustOwnPackage = (ctx: WriteCtx, pkg: EntityId): void => {
  const w = ctx.get('WorkPackage', pkg);
  if (w) mustOwnProject(ctx, w.project);
};

export const productionModule = defineModule({
  id: 'production',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Employment', 'Helper', 'Machine', 'Move', 'NetNode', 'Parcel', 'Party', 'Person', 'Presence'],
  commandDocs: {
    "production.createProject": {
      internal: true,
    },
    "production.setPriority": {
      description: "Change a project's priority; higher priority projects get crews and machines first.",
    },
    "production.pauseProject": {
      description: 'Pause a project: crews and machines are released, progress is kept.',
    },
    "production.resumeProject": {
      description: 'Resume a paused project.',
    },
    "production.cancelProject": {
      description: 'Cancel a project: unfinished work packages stop, staged material returns to its store. Completed work stays.',
    }
  },
  label: 'Production',
  provides: ['production'],
  requires: ['terrain', 'weather', 'soil-state', 'routing', 'moves', 'workforce', 'equipment', 'holdings', 'trade', 'prices', 'parties'],
  optional: ['constructionCycle'],
  // another party's work is seen on site (what is done there, how far), not its costs and its contracts
  observe: {
    Project: (v: Project, viewer: EntityId) => (v.party === viewer ? v : { label: v.label, owner: v.owner, party: v.party, ...(v.ref ? { ref: v.ref } : {}) }),
    WorkPackage: (v: WorkPackage, viewer: EntityId, read: ReadCtx) => (read.get('Project', v.project)?.party === viewer ? v : { label: v.label, activity: v.activity, status: v.status, project: v.project }),
  },
  components: {
    Project: s.object({ label: s.string(), owner: s.string(), party: s.ref('party'), status: s.enum(['active', 'paused', 'complete', 'cancelled']), priority: s.number(), site: V2 }, { passthrough: true }),
    WorkPackage: PackageSchema,
    Assignment: s.object({ package: s.ref('workPackage'), role: s.string(), skill: s.string().optional() }),
  },
  data: { activities: s.record(ActivitySchema), productionSettings: ProductionSettingsSchema, contractors: s.record(ContractorSchema), contractorMarket: ContractorMarketSchema.optional(), handling: HandlingSchema.optional() },
  state: { initial: (): ProductionState => ({ dispatchTimer: null, boundaryTimer: null, completed: 0, bookings: {}, firms: {}, firmMonth: 0, slips: {}, lastMorning: {}, lastCallOff: {}, lastEvening: {} }) },
  events: {
    'production.packageStarted': s.object({ package: s.string(), project: s.string() }),
    'production.legalExposure': s.object({ person: s.string(), party: s.string(), what: s.string(), rule: s.string(), kind: s.string().optional() }),
    'production.packageCompleted': s.any(),
    'production.projectCompleted': s.any(),
    'production.projectCancelled': s.any(),
  },
  blockers: {
    'production.resources': 'Missing resources — {missing}',
    'production.waitingResources': 'Queued — {missing}',
    'production.curing': 'Waiting for {work} to {what}: about {until}',
    'production.crewAbsent': 'Crew absent: {names}',
    'production.noWord': 'We cannot call off {project}: our word does not reach {whom} ({why})',
    'production.crewOnTheWay': 'Not yet at the work: {names}',
    'production.notItsRoad': '{store} holds a haul’s loads on the road: they reach its heap with its trucks',
    'production.machineBroken': '{machine} is broken down',
    'production.machineService': '{machine} is in service',
    'production.machineNoFuel': '{machine} has run out of fuel ({fuel}), and there is none of ours to top it up from',
    'production.machineRefuelling': '{machine} is being topped up with fuel, back at work {until}',
    'production.machineTravelling': '{machine} is on its way to the work front',
    'production.machineUnreachable': '{machine} cannot reach the work front: {reason}',
    'production.weatherRain': 'Rain {precip} mm/h exceeds {limit} mm/h for this work',
    'production.weatherCold': 'Air temperature {temp} °C below {limit} °C for this work',
    'production.weatherWind': 'Wind {wind} m/s above {limit} m/s',
    'production.groundFrozen': 'Ground frozen to {depth} m (limit {limit} m)',
    'production.soilTooWet': 'Soil not trafficable ({state}) — cohesive soil too wet to work',
    'production.haulTrees': 'The trucks have no way to the heap at {to}: {n} trees stand between the work and it',
    'production.haulNoWay': 'The trucks have no way to the heap at {to} over today’s ground (soaked soil, trees, water between): the haul waits for the ground to dry',
    'production.materialsShort': 'Materials short at the work front: {materials}{where}',
    'production.materialsOnOrder': 'Waiting for deliveries: {materials}',
    'production.waitingForFront': 'Waiting for the preceding work front',
    'production.dark': 'Too dark for this work: {lux} lx of daylight, it needs {need} lx (ASR A3.4); light again {until}',
    'production.noOutput': 'No output possible ({limiting}) — e.g. haul route unreachable or missing trucks',
    'production.invalidPackage': 'Package {key}: {reason}',
    'production.duplicateKey': 'Duplicate package key {key}',
    'production.projectPaused': 'Project paused',
    'production.hold': 'Hold point: inspection/acceptance ({hours} h)',
    'production.subcontractorBooked': '{who} booked — on site from {date}',
    'production.noContractor': 'No contractor engaged for {trade} — award the work',
    'production.crewArriving': '{who}: crew on the way to site',
    'production.supplyNotBooked': 'Delivery of {material} not booked for {package}',
    'production.supplyBooked': 'Hot-mix booked — deliveries from {date}',
    'production.supplyCalledOff': 'Delivery called off for today (forecast)',
    'production.awaitingDelivery': 'Waiting for delivery: {what}',
    'production.siteNoAccess': 'Deliveries and crews cannot get to the site: {reason}',
    'production.notSubcontracted': '{package} is done by own crews, not a subcontractor',
    'production.ownCrewWorking': '{package} is already being worked by our own crew',
    'production.alreadyAwarded': '{package} is already awarded to {contractor}',
    'production.packageClosed': '{package} is already finished or cancelled',
    'production.unknownMaterial': 'There is no material {material}',
    'production.layoutTwice': 'A layout of {store} names a material twice',
    'production.notNeeded': '{package} does not use {material}',
    'production.conducted': '{material} is not carried as goods: it goes along a cable within reach, or in a battery carried there',
    'production.sameStore': 'The goods are in {store} already',
    'production.nothingToMove': 'Nothing to move of {material}',
    'production.notBulk': '{material} comes in {unit}: a loader and tippers move bulk goods; pieces go by hand (or by forklift and lorry, later)',
    'production.contractorUnsuited': '{contractor} does not do this trade ({package})',
    'production.tooHeavy': '{why}: it needs a machine or a wheeled aid',
    'production.leftAtFront': 'Left at the front of {work}: {goods}. It stays where it is until someone moves it',
    'production.notOurs': '{what} is not a project of {party}',
    'production.notOurStore': '{store} is not a store of {party}',
    'production.nowhere': '{store} is not on the map now: it goes with one who is away',
    'production.projectClosed': '{project} is finished or cancelled',
    'production.contractorFull': '{contractor} takes no new orders: booked {weeks} weeks ahead',
    'production.noRush': '{contractor} cannot start this sooner than its queue allows',
    'production.supplyFailed': '{material} could not be ordered: {why}',
    'production.bookingAtRisk': '{who} is booked from {date}, but nothing tells when the work before will be done: {before}. If the site is not ready when the crew comes, the job goes to the back of their queue',
    'production.crewWaitingForSite': '{who}’s crew is here and waits for the site until {until}; if it is not ready by then, they go to their next client and the job to the back of their queue',
    'production.bookingTooEarly': '{who} is booked from {date}, but the work before is forecast to allow it only from {ready}: move the booking in time, or the crew finds the site not ready and the job goes to the back of their queue',
    'production.notBooked': '{package} is not booked with a firm',
    'production.alreadyStarted': '{package} has started (or is past its booked start): it cannot be moved',
    'production.noDirectSupply': '{package} needs no hot-mix booking',
    'production.alreadyBooked': '{package} is already booked',
    'production.noSupplier': 'No supplier offers {material}',
    'production.holiday': '{holiday}: a public holiday, no work today; it goes on {next}',
    'production.noSubstitute': 'No substitute defined for {material} in {package}{has}',
    'production.unknownActivity': 'Unknown activity {activity}',
    'production.noSoilKnowledge': 'nothing in this world says how the ground is learned',
    'production.notThere': 'Cannot move {qty} {unit} {material}: {store} holds {there} {unit} free with what is on its way{claimed}',
    'production.noFelling': 'This world has no felling practice',
    'production.makesNothing': '{activity} makes nothing of goods',
    'production.noSooner': '{contractor} can come no sooner for {package} (booked from {start})',
    'production.cannotHold': '{store} cannot hold {goods}',
    'production.notEnoughFor': 'Not enough for {quantity} {unit} of {activity}: {store} has (with what is on its way) what {most} {unit} need',
    'production.machineForSale': '{machine} is offered for sale while it works here: when a buyer comes, it goes',
    'production.noSuchTree': 'No standing tree {trees}',
    'production.noTrees': 'No trees to fell: name them, or an area with trees in it',
    'production.treesTaken': '{count} of these trees are felled by other work already ({trees})',
    'production.badLink': 'Package {key} depends on unknown package {after}',
  },
  setup(ctx) {
    // validate material units of all activities once, early and loudly
    const acts = ctx.data('activities');
    for (const [id, a] of Object.entries(acts)) {
      materialsPerUnit(ctx, a, id, { consumes: {} });
      for (const [mat, q] of Object.entries(a.directSupply ?? {})) flexTo(q, `${ctx.port('holdings').material(mat).unit}/${a.unit}`, `activity ${id} direct supply ${mat}`);
      if (a.rate.length === 0 && !a.subcontract) throw new Error(`activity ${id} has neither rate components nor a subcontract`);
      if (a.subcontract) {
        flexTo(a.subcontract.price, `EUR/${a.unit}`, `activity ${id} subcontract price`);
        flexTo(a.subcontract.output, `${a.unit}/h`, `activity ${id} subcontract output`);
      }
      for (const c of a.rate) {
        if (c.kind === 'crew' || c.kind === 'perMachine') flexTo(c.output, `${a.unit}/h`, `activity ${id} ${c.kind} output`);
      }
    }
    openBooks(ctx);
  },
  systems: [
    { id: 'hourly', every: HOUR, phase: 'operations', run: (ctx) => step(ctx) },
    { id: 'contractor-market', every: DAY, phase: 'economy', run: (ctx) => marketDay(ctx) },
  ],
  /** a fork does not know whether the jobs ahead of ours will overrun */
  branch(ctx) {
    redrawSlips(ctx);
  },
  timers: {
    // a load of the haul at the heap: off the road into its store; the haul road wears by its trips; the next one comes
    haulLoad: (ctx, payload: { pkg: EntityId }) => {
      const pkg = ctx.get('WorkPackage', payload.pkg);
      const h = pkg?.haul;
      if (!pkg || !h?.store) return;
      if (!ctx.port('holdings').exists(h.store)) return;
      // (what is on the road as the load comes)
      const on = ctx.port('holdings').contents(h.store);
      let tonnes = 0;
      let room = h.perLoad * (pkg.produces?.[0]?.perUnit ?? 1);
      for (const out of haulOuts(ctx, pkg)) {
        const have = on[out.material] ?? 0;
        if (have <= 1e-9 || room <= 1e-9) continue;
        const qty = Math.min(have, room);
        room -= qty;
        const r = ctx.command('inventory.transfer', { from: h.store, to: out.store, material: out.material, qty, via: 'hauled by the work', why: `${pkg.label}: a load`, work: payload.pkg });
        if (r.ok) tonnes += (qty * unitMass(ctx.port('holdings').material(out.material))) / 1000;
      }
      if (tonnes > 0 && pkg.haulTo) haulTraffic(ctx, payload.pkg, tonnes);
      ctx.patch('WorkPackage', payload.pkg, { haul: { ...ctx.require('WorkPackage', payload.pkg).haul!, next: ctx.now } });
      haulOn(ctx, payload.pkg);
    },
    dispatch: (ctx) => step(ctx),
    boundary: (ctx) => {
      ctx.patchState('production', { boundaryTimer: null });
      step(ctx);
    },
    packageDone: (ctx, payload: { package: EntityId }) => {
      const id = payload.package;
      if (ctx.require('WorkPackage', id).status !== 'active') return;
      account(ctx, id);
      const pkg = ctx.require('WorkPackage', id);
      const { activeSince: _a, ...rest } = pkg;
      ctx.set('WorkPackage', id, { ...rest, rate: 0 } as WorkPackage);
      release(ctx, id);
      leftAtFront(ctx, id);
      const activity = activityOf(ctx, pkg.activity);
      if (activity.holdAfter && activity.holdAfter.value > 0) {
        ctx.patch('WorkPackage', id, { status: 'hold', holdUntil: ctx.now + activity.holdAfter.value * HOUR });
        ctx.blockers.set(id, [{ code: 'production.hold', severity: 'info', params: { hours: activity.holdAfter.value } }]);
        ctx.after(activity.holdAfter.value * HOUR, 'holdEnd', { package: id });
        requestDispatch(ctx);
        return;
      }
      finishPackage(ctx, id);
    },
    holdEnd: (ctx, payload: { package: EntityId }) => finishPackage(ctx, payload.package),
  },
  on: {
    // insolvency proceedings opened: the administrator gives up the party's work
    'economy.insolvencyOpened': (ctx, p) => {
      for (const [id, pr] of [...ctx.all('Project')]) if (pr.party === p.party && pr.status !== 'complete' && pr.status !== 'cancelled') ctx.command('production.cancelProject', { project: id });
    },
    'equipment.brokeDown': (ctx) => requestDispatch(ctx),
    'equipment.repaired': (ctx) => requestDispatch(ctx),
    'equipment.arrived': (ctx) => requestDispatch(ctx),
    'equipment.acquired': (ctx) => requestDispatch(ctx),
    // a machine sold or returned while at work: its package lets go of it and picks again
    'equipment.released': (ctx, e) => {
      for (const [id, pkg] of [...ctx.all('WorkPackage')]) {
        if (!pkg.machines.includes(e.machine)) continue;
        ctx.patch('WorkPackage', id, { machines: pkg.machines.filter((m) => m !== e.machine) });
        if (pkg.status === 'active') {
          account(ctx, id);
          if (pkg.process) ctx.proc.setRate(pkg.process, 0);
          clearActive(ctx, id);
          release(ctx, id);
          ctx.patch('WorkPackage', id, { status: 'ready' });
        }
      }
      requestDispatch(ctx);
    },
    'workforce.joined': (ctx) => requestDispatch(ctx),
    'workforce.absence': (ctx) => requestDispatch(ctx),
    'workforce.returned': (ctx) => requestDispatch(ctx),
    'inventory.delivered': (ctx) => requestDispatch(ctx),
    'moves.arrived': (ctx, e) => {
      // someone come to their work: it may go on from now, not from the next hour
      if (e.purpose === 'report' && e.ref && ctx.get('Assignment', e.ref)) requestDispatch(ctx);
      if (e.requester !== 'production' || !e.ref) return;
      const qty = e.loads.reduce((a, l) => a + ('goods' in l ? l.goods.qty : 0), 0);
      if (e.purpose === 'site-supply' && qty > 0) {
        onSupplyArrived(ctx, e.ref, qty);
        requestDispatch(ctx);
      } else if (e.purpose === 'commute-in') {
        onCrewArrived(ctx, e.ref);
        requestDispatch(ctx);
      }
    },
  },
  commands: {
    'production.createProject': command(
      s.object({ label: s.string(), owner: s.string(), party: s.ref('party').optional(), ref: s.string().optional(), priority: s.number().optional(), site: V2, store: s.string().optional(), supply: SupplyPolicySchema.optional(), packages: s.array(SpecSchema) }),
      (ctx, p) => {
        // a project is the acting party's (a world module setting one up names it)
        const party = p.party ?? actorOf(ctx);
        ctx.port('parties').require(party, 'production.createProject');
        // (no work is begun for a party that ended, whoever sets it up: the one check; review y)
        mustBeLive(ctx, party);
        // work draws from the party's own stores (decision 0025: another's goods are not ours to use)
        for (const st of [p.store, ...(p.packages as unknown as PackageSpec[]).map((x) => x.store)]) {
          const holder = st ? ctx.port('holdings').holder(st) : undefined;
          if (holder !== undefined && holder !== party) ctx.reject('production.notOurStore', { store: ctx.port('holdings').label(st!)!, party: partyLabel(ctx, party) });
        }
        const specs = p.packages as unknown as PackageSpec[];
        if (specs.length === 0) ctx.reject('production.unknownActivity', { activity: '(no packages)' });
        const project = ctx.spawn('project', { name: p.label });
        const ids: Record<string, EntityId> = {};
        const { hours, cost } = makePackages(ctx, project, p.store, specs, ids);
        ctx.set('Project', project, {
          label: p.label,
          owner: p.owner,
          party,
          ...(p.ref ? { ref: p.ref } : {}),
          status: 'active',
          priority: p.priority ?? 0,
          site: p.site,
          ...(p.store ? { store: p.store } : {}),
          createdAt: ctx.now,
          packages: specs.map((sp) => ids[sp.key]!),
          estimate: { hours, cost, finish: 0 },
        });
        const rows = forecastSchedule(ctx, project);
        const finish = rows.reduce((m, r) => Math.max(m, r.finish), ctx.now);
        ctx.patch('Project', project, { estimate: { hours, cost, finish } });
        ctx.log('info', `Project created: ${p.label} (${specs.length} work packages, est. ${hours < 1 ? `${Math.max(1, Math.round(hours * 60))} working minutes` : `${Math.round(hours)} working hours`})`, [project]);
        if (p.supply) {
          ctx.patch('Project', project, { supply: p.supply });
          orderSupply(ctx, project);
        }
        requestDispatch(ctx);
        return { project, packages: ids };
      },
    ),
    'production.award': command(
      s.object({ package: s.ref('workPackage'), contractor: s.string(), rush: s.boolean().optional() }),
      (ctx, p) => {
        mustOwnPackage(ctx, p.package);
        const o = award(ctx, p.package, p.contractor, undefined, p.rush ?? false);
        requestDispatch(ctx);
        return {
          contractor: o.contractor,
          price: o.price,
          start: o.start,
          end: o.end,
        };
      },
      {
        description:
          "Award a work package to a contractor: building trades always go to contractors; road trades such as asphalt paving or tree felling may be let instead of using own crews and plant (their crew and plant come with them). The price per unit (fixed at the award) and the crew start come from the firm's order book: a job queues behind its other clients' work, which grows in a building boom and shrinks in a bust; busy firms charge more, full firms take no new orders. rush: the firm squeezes the job in ahead of its queue, at a surcharge. See the package's remedies for the offers. If the site is not ready when the crew is due, the job goes back into the firm's queue (firms we have given work to before fit us in sooner).",
      },
    ),
    'production.reschedule': command(
      s.object({ package: s.ref('workPackage'), notBefore: s.number({ unit: 's' }) }),
      (ctx, p) => {
        mustOwnPackage(ctx, p.package);
        const start = reschedule(ctx, p.package, p.notBefore);
        requestDispatch(ctx);
        return { start };
      },
      {
        description: "Move a booked job to a later start, with notice (e.g. when the work before it runs late): the firm queues it again from today, behind its other clients' work (a firm we have given work to before fits it in sooner). Better than letting the crew find the site not ready, which sends the job to the back of the queue from that day. notBefore: the earliest start wanted (sim time).",
      },
    ),
    'production.hurry': command(
      s.object({ package: s.ref('workPackage'), notBefore: s.number({ unit: 's' }).optional() }),
      (ctx, p) => {
        mustOwnPackage(ctx, p.package);
        const o = hurry(ctx, p.package, p.notBefore);
        requestDispatch(ctx);
        return o;
      },
      {
        description: "Buy a booked job forward: the firm squeezes it in ahead of its queue as a rush job, at its rush surcharge on the agreed price (a job that went to the back of the queue when the site was not ready, or one booked too late). Only before the crew has begun; refused if the firm can come no sooner. notBefore: the earliest start wanted (sim time).",
      },
    ),
    'production.awardProject': command(
      s.object({
        project: s.ref('project'),
        strategy: s.enum(['earliest', 'cheapest']).optional(),
      }),
      (ctx, p) => {
        mustOwnProject(ctx, p.project);
        const pr = ctx.require('Project', p.project);
        let n = 0;
        // (in the order the work follows: a storey's walls after the slab below them, though made before it, H1)
        const forecast = new Map(forecastSchedule(ctx, p.project).map((r) => [r.package, r]));
        for (const id of [...forecast.keys(), ...pr.packages.filter((x) => !forecast.has(x))]) {
          const pkg = ctx.require('WorkPackage', id);
          const act = activityOf(ctx, pkg.activity);
          if (!subcontractOnly(act) || pkg.contractor || pkg.status === 'done' || pkg.status === 'cancelled') continue;
          // book in sequence: a trade cannot start before its predecessors' contracts end (own work: as forecast), and
          // what they leave has cured (S6)
          const notBefore = Math.max(
            ctx.now,
            ...pkg.after.map((l) => {
              const pred = ctx.get('WorkPackage', l.package);
              const row = forecast.get(l.package);
              if (l.type === 'SS') return pred?.contract?.start ?? row?.start ?? 0;
              const end = pred?.contract?.end ?? row?.finish ?? 0;
              return end + l.lag * HOUR + curingAhead(ctx, l.package, end);
            }),
          );
          // (in the firms' ordinary queues: a rush is bought job by job, production.hurry; chosen by its own start)
          const offers = offersFor(ctx, id, notBefore).filter((o) => !o.rush);
          if (!offers.length) continue;
          const pick = p.strategy === 'cheapest' ? [...offers].sort((a, b) => a.price - b.price)[0]! : offers[0]!;
          award(ctx, id, pick.contractor, notBefore);
          n += 1;
        }
        requestDispatch(ctx);
        return n;
      },
      {
        description: 'Award all not-yet-awarded subcontracted packages of a project, in sequence, each to the contractor with the earliest start (default) or the lowest price.',
      },
    ),
    'production.bookSupply': command(
      s.object({
        package: s.ref('workPackage'),
        supplier: s.string().optional(),
      }),
      (ctx, p) => {
        mustOwnPackage(ctx, p.package);
        const r = bookSupply(ctx, p.package, p.supplier);
        requestDispatch(ctx);
        return r;
      },
      {
        description:
          'Book hot-mix asphalt (or other just-in-time material) for a paving package at a supplier. Deliveries start after the supplier lead time on working days; the foreman calls off days with bad forecasts; material not laid by the end of the shift is waste.',
      },
    ),
    'production.useSubstitute': command(
      s.object({ package: s.ref('workPackage'), material: s.string() }),
      (ctx, p) => {
        mustOwnPackage(ctx, p.package);
        const pkg = ctx.require('WorkPackage', p.package);
        const sub = pkg.substitutes?.[p.material];
        if (!sub) {
          // name what it can replace, and by what (Qwen S176: given the substitute, it said there was none)
          const hold = ctx.port('holdings');
          const alts = Object.entries(pkg.substitutes ?? {}).map(([m, x]) => `${m} by ${hold.material(x.material).label}`);
          ctx.reject('production.noSubstitute', {
            material: p.material,
            package: pkg.label,
            has: alts.length ? `; it can replace ${alts.join(', ')} (pass the material replaced)` : '',
          });
        }
        ctx.patch('WorkPackage', p.package, {
          switched: [...new Set([...(pkg.switched ?? []), p.material])],
        });
        const store = sub!.store ?? pkg.store ?? ctx.require('Project', pkg.project).store;
        const remaining = pkg.quantity - doneOf(ctx, pkg);
        const hold = ctx.port('holdings');
        const need = Math.max(0, remaining * sub!.perUnit - hold.stock(store!, sub!.material) - ctx.port('trade').onOrder(store!, sub!.material));
        if (need > 0.5 && store) {
          const qty = Math.ceil(Math.max(need, ctx.port('trade').offers(sub!.material)[0]?.minOrder ?? 0));
          const r = ctx.command('inventory.order', {
            material: sub!.material,
            qty,
            store,
          });
          if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        }
        ctx.log('info', `${pkg.label}: switching to ${hold.material(sub!.material).label}.`, [p.package]);
        requestDispatch(ctx);
      },
      {
        description: 'Use the defined substitute material for a package (e.g. imported fill when suitable excavated soil runs out) and order what is needed.',
      },
    ),
    'production.testPit': command(
      s.object({ at: s.point(), label: s.string().optional() }),
      (ctx, p) => {
        // a test pit dug by our people (8d, decision 0017): what is under the ground there is known when it is dug, to its depth
        const know = ctx.data('productionSettings').soilKnowledge;
        if (!know) ctx.reject('production.noSoilKnowledge', {});
        const label = p.label ?? `Test pit at ${Math.round(p.at[0])}, ${Math.round(p.at[1])}`;
        const r = ctx.command('production.createProject', { label, owner: 'production', party: actorOf(ctx), site: [p.at[0], p.at[1]], packages: [{ key: 'pit', activity: know!.testPit, label, quantity: 1, pos: [p.at[0], p.at[1]] }] });
        if (!r.ok) return ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        return r.value;
      },
      { label: 'Dig a test pit', description: 'Our people dig a test pit by hand where the ground is to be known (some 1.5 m deep, an hour or two with a spade, filled in again): its column is known to our plans from then on, within some 25 m of it; elsewhere they go by the region\'s soil map, which misses what changes within its units. The work itself meets the ground as it is.' },
    ),
    'production.moveGoods': command(
      s.object({ from: s.ref('store'), to: s.ref('store'), material: s.string(), qty: s.number({ min: 0 }), by: s.enum(['hand', 'machine', 'service']), service: s.string().optional(), label: s.string().optional(), party: s.ref('party').optional() }),
      (ctx, p) => {
        // (a haul's loads on the road are its own: r37)
        const hold = ctx.port('holdings');
        for (const sid of [p.from, p.to]) if (hold.kind(sid) === 'transit') ctx.reject('production.notItsRoad', { store: hold.label(sid)! });
        // moving our own goods is work like any other (decision 0026): by hand, the carrying rules and
        // setting down at the other end; by machine, the loader-and-haul cycle of the earthworks
        // (a household's own routine, set going by a module, names its party)
        const party = ctx.caller !== 'client' && p.party ? p.party : actorOf(ctx);
        const from = placed(ctx, p.from) ?? ctx.reject('production.nowhere', unplaced(ctx, p.from));
        const to = placed(ctx, p.to) ?? ctx.reject('production.nowhere', unplaced(ctx, p.to));
        for (const st of [from, to]) if (st.holder !== party) ctx.reject('production.notOurStore', { store: st.label, party: partyLabel(ctx, party) });
        if (p.from === p.to) ctx.reject('production.sameStore', { store: from.label });
        // (electricity goes along a cable or in a battery carried: never loaded as goods)
        if (ctx.port('holdings').material(p.material)?.unit === 'kWh') ctx.reject('production.conducted', { material: ctx.port('holdings').material(p.material).label });
        if (!(p.qty > 0)) ctx.reject('production.nothingToMove', { material: p.material });
        // a vessel takes what it is for only (a rain barrel, a compost heap)
        if (!hold.accepts(p.to, p.material)) ctx.reject('production.cannotHold', { store: to.label, goods: hold.material(p.material).label });
        // by a service with its driver: a booked trip, not our work
        if (p.by === 'service') return hireMove(ctx, { from: p.from, to: p.to, material: p.material, qty: p.qty, service: p.service ?? 'vanWithDriver' }, party);
        const mat = hold.material(p.material);
        const bulk = mat.unit === 't' || mat.unit === 'm3';
        if (p.by === 'machine' && !bulk) ctx.reject('production.notBulk', { material: mat.label, unit: mat.unit });
        // only what is there and free (not sold and waiting for its buyer's lorry: S419), or on its way there
        const there = hold.free(p.from, p.material) + ctx.port('trade').onOrder(p.from, p.material);
        if (p.qty > there + tolerance(p.qty)) {
          const all = isCounted(mat) ? Math.floor(wholeIfNear(there)) : Math.floor(there * 100) / 100;
          const claimed = hold.stock(p.from, p.material) - hold.free(p.from, p.material);
          ctx.reject('production.notThere', { qty: +p.qty.toFixed(2), unit: mat.unit, material: mat.label, store: from.label, there: +there.toFixed(2), claimed: claimed > 1e-6 ? `; ${+claimed.toFixed(2)} ${mat.unit} more there are sold or claimed, waiting to be collected` : '' }, all > 0 ? [{ label: `Move the ${all} ${mat.unit} there are`, command: { type: 'production.moveGoods', payload: { ...p, qty: all } } }] : []);
        }
        // the activity's unit: tonnes by hand, cubic metres by machine; the goods per unit of work
        const perUnit = p.by === 'hand' ? 1000 / unitMass(mat) : mat.unit === 'm3' ? 1 : mat.density.value;
        const quantity = p.qty / perUnit;
        const label = p.label ?? `Move ${+p.qty.toFixed(2)} ${mat.unit} ${mat.label} from ${from.label} to ${to.label}`;
        const spec: PackageSpec = {
          key: 'move',
          activity: p.by === 'hand' ? 'hand.move' : 'machine.move',
          label,
          quantity,
          // by hand the work is at the destination (the walk is reckoned from the store); by machine, loading at the source and hauling to the destination
          pos: p.by === 'hand' ? [to.pos[0], to.pos[1]] : [from.pos[0], from.pos[1]],
          // (the whole move: a load less than a truck's still takes a whole cycle; Qwen S171)
          ...(p.by === 'machine' ? { haulTo: [to.pos[0], to.pos[1]] as Vec2, params: { density: mat.density.value, looseDensity: mat.density.value, total: quantity } } : {}),
          store: p.from,
          consumes: { [p.material]: perUnit },
          produces: [{ material: p.material, perUnit, store: p.to }],
        };
        const r = ctx.command('production.createProject', { label, owner: 'production', party, site: spec.pos, store: p.from, packages: [spec] as never });
        if (!r.ok) return ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        return r.value;
      },
      { label: 'Move our goods to another store', description: 'Move goods between two of our stores, by hand (anything people can carry, at the pace of the carrying rules) or by machine (bulk goods: a wheel loader and tippers). It is a project with one work package: it needs people (and machines) and is blocked legibly when they are missing.' },
    ),
    'production.process': command(
      s.object({ activity: s.string(), quantity: s.number({ min: 0 }), store: s.ref('store'), label: s.string().optional() }),
      (ctx, p) => {
        // work that makes goods of goods (decision 0026: a work package like any other, its yields into a store)
        const party = actorOf(ctx);
        const act = ctx.data('activities')[p.activity];
        if (!act) ctx.reject('production.unknownActivity', { activity: p.activity });
        const makes = Object.entries(act!.yields ?? {});
        if (!makes.length) ctx.reject('production.makesNothing', { activity: act!.label });
        const st = placed(ctx, p.store) ?? ctx.reject('production.nowhere', unplaced(ctx, p.store));
        if (st.holder !== party) ctx.reject('production.notOurStore', { store: st.label, party: partyLabel(ctx, party) });
        // what it makes is put down where the work is: a store that holds only some goods takes no others
        const foreign = makes.map(([mat]) => mat).filter((mat) => !ctx.port('holdings').accepts(p.store, mat));
        if (foreign.length) ctx.reject('production.cannotHold', { store: st.label, goods: foreign.join(', ') });
        if (!(p.quantity > 0)) ctx.reject('production.nothingToMove', { material: act!.label });
        const hold = ctx.port('holdings');
        // only as much as what it is made of allows (there, or on its way there)
        let most = Infinity;
        for (const [mat, q] of Object.entries(act!.materials)) {
          const per = flexTo(q, `${hold.material(mat).unit}/${act!.unit}`, `activity ${p.activity} material ${mat}`);
          if (per > 0) most = Math.min(most, (hold.stock(p.store, mat) + ctx.port('trade').onOrder(p.store, mat)) / per);
        }
        if (p.quantity > most + tolerance(p.quantity)) {
          const all = Math.floor(most * 100) / 100;
          ctx.reject('production.notEnoughFor', { activity: act!.label, quantity: +p.quantity.toFixed(2), unit: act!.unit, store: ctx.port('holdings').label(p.store)!, most: all }, all > 0 ? [{ label: `Do ${all} ${act!.unit}, what there is for`, command: { type: 'production.process', payload: { ...p, quantity: all } } }] : []);
        }
        const into = p.store;
        const at = ctx.port('holdings').where(p.store)!;
        const label = p.label ?? `${act!.label}: ${+p.quantity.toFixed(2)} ${act!.unit}`;
        const spec: PackageSpec = {
          key: 'work',
          activity: p.activity,
          label,
          quantity: p.quantity,
          pos: [at[0], at[1]],
          store: p.store,
          produces: makes.map(([mat, q]) => ({ material: mat, perUnit: flexTo(q, `${hold.material(mat).unit}/${act!.unit}`, `activity ${p.activity} yield ${mat}`), store: into })),
        };
        const r = ctx.command('production.createProject', { label, owner: 'production', party, site: spec.pos, store: p.store, packages: [spec] as never });
        if (!r.ok) return ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        return r.value;
      },
      { label: 'Make goods of goods', description: 'Do work that makes goods of other goods (an activity with yields, e.g. wood.split: logs split into firewood) at a store of ours: what it is made of is taken from there and what it makes is put down there (move it on with production.moveGoods). Only as much as the goods there (or on their way) allow.' },
    ),
    'production.fell': command(
      s.object({ trees: s.array(s.string()).optional(), area: s.array(s.point()).optional(), by: s.enum(['chainsaw', 'hand']), store: s.ref('store').optional(), label: s.string().optional() }),
      (ctx, p) => {
        // felling for the wood (rung 2, site materials): felled, limbed and cut to length where the trees stand,
        // their stems as logs and their crowns as brash on a heap; the stumps stay
        const party = actorOf(ctx);
        const veg = ctx.port('vegetation');
        const felling = ctx.data('productionSettings').felling ?? ctx.reject('production.noFelling', {});
        const ids = [...new Set(p.trees ?? (p.area && p.area.length >= 3 ? veg.treesIn(p.area as Vec2[]).map((t) => t.id) : []))].sort();
        const unknown = ids.filter((id) => !veg.tree(id));
        if (unknown.length) ctx.reject('production.noSuchTree', { trees: unknown.slice(0, 5).join(', ') });
        if (!ids.length) ctx.reject('production.noTrees', {});
        // a tree is felled once: not one already in work that fells it (ours, a road's)
        const claimed = treesInWork(ctx);
        const taken = ids.filter((id) => claimed.has(id));
        if (taken.length) ctx.reject('production.treesTaken', { count: taken.length, trees: taken.slice(0, 5).join(', ') });
        const trees = ids.map((id) => veg.tree(id)!);
        const wood = trees.map((t) => veg.wood(t));
        const volume = wood.reduce((a, w) => a + w.stemVolume, 0);
        const at: Vec2 = [trees.reduce((a, t) => a + t.x, 0) / trees.length, trees.reduce((a, t) => a + t.z, 0) / trees.length];
        let store = p.store;
        if (store) {
          const st = placed(ctx, store) ?? ctx.reject('production.nowhere', unplaced(ctx, store));
          if (st.holder !== party) ctx.reject('production.notOurStore', { store: st.label, party: partyLabel(ctx, party) });
          // the logs and the brash both go onto it: not a vessel for something else
          const foreign = [felling.logs, felling.brash].filter((x) => !ctx.port('holdings').accepts(store!, x));
          if (foreign.length) ctx.reject('production.cannotHold', { store: st.label, goods: foreign.map((x) => ctx.port('holdings').material(x).label).join(', ') });
        } else {
          const r = ctx.command('inventory.createStore', { holder: party, label: `Felled wood (${trees.length} ${trees.length === 1 ? 'tree' : 'trees'})`, kind: 'stockpile', pos: at });
          if (!r.ok) return ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
          store = r.value;
        }
        const label = p.label ?? `Fell ${trees.length} ${trees.length === 1 ? 'tree' : 'trees'} for their wood (${volume.toFixed(1)} m³)`;
        const spec: PackageSpec = {
          key: 'fell',
          activity: p.by === 'hand' ? felling.hand : felling.chainsaw,
          label,
          quantity: volume,
          pos: at,
          fells: fellsOf(ctx, ids, felling, store!, 'm3'),
          // (an area felled is cleared ground once done: a lane through a wood, S3)
          ...(p.area && p.area.length >= 3 && !p.trees ? { data: { cleared: p.area } } : {}),
        };
        const r = ctx.command('production.createProject', { label, owner: 'production', party, site: at, packages: [spec] as never });
        if (!r.ok) return ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        // (a heap set up for the felling is for it: called off, it goes with it when empty, decision 0028; S504)
        if (!p.store) ctx.command('inventory.holdFor', { store: store!, for: r.value.project });
        return { ...r.value, store: store!, volume, trees: ids.length };
      },
      { label: 'Fell trees for their wood', description: 'Fell trees (by id, or all in an area polygon), limb them and cut them to length where they stand: by chainsaw (a qualified operator and a helper within call) or by hand (a bow saw each, one or two people). The stems become logs and the crowns brash (t), put on a heap (a new stockpile by the trees, or a store of ours) as the work goes on; the stumps stay. Whose land it is is not asked yet.' },
    ),
    'production.layOut': command(
      s.object({ store: s.ref('store'), order: s.array(s.string()).optional() }),
      (ctx, p) => {
        // laying a store out is work: sorting and stacking its goods in the order of use (the planner's, or ours)
        const party = actorOf(ctx);
        const st = placed(ctx, p.store) ?? ctx.reject('production.nowhere', unplaced(ctx, p.store));
        if (st.holder !== party) ctx.reject('production.notOurStore', { store: st.label, party: partyLabel(ctx, party) });
        const order = p.order ?? layoutOrder(ctx, p.store);
        const materials = ctx.data('materials');
        const unknown = order.find((m) => !materials[m]);
        if (unknown) ctx.reject('production.unknownMaterial', { material: unknown });
        if (new Set(order).size !== order.length) ctx.reject('production.layoutTwice', { store: st.label });
        const hold = ctx.port('holdings');
        const tonnes = Object.entries(hold.contents(p.store)).reduce((a, [m, q]) => a + (q > 0 ? (q * unitMass(hold.material(m))) / 1000 : 0), 0);
        if (tonnes <= 1e-6) {
          ctx.command('inventory.setLayout', { store: p.store, order });
          return { project: '', packages: {} };
        }
        const label = `Lay out ${st.label}`;
        const spec: PackageSpec = { key: 'sort', activity: 'hand.sort', label, quantity: tonnes, pos: [st.pos[0], st.pos[1]], data: { layout: { store: p.store, order } } };
        const r = ctx.command('production.createProject', { label, owner: 'production', party, site: spec.pos, packages: [spec] as never });
        if (!r.ok) return ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        return r.value;
      },
      { label: 'Lay out a store', description: 'Sort and stack the goods of one of our stores, each kind in its place, in the order the work will need them (the planner\'s order from the schedule, or one given). It is work now; afterwards every trip from the store is picked without searching. A store left as a heap is slower by every other kind of goods in it.' },
    ),
    'production.supplyFrom': command(
      s.object({ package: s.ref('workPackage'), store: s.ref('store'), material: s.string().optional() }),
      (ctx, p) => {
        mustOwnPackage(ctx, p.package);
        const pkg = ctx.require('WorkPackage', p.package);
        if (pkg.status === 'done' || pkg.status === 'cancelled') ctx.reject('production.packageClosed', { package: pkg.label });
        const party = ctx.require('Project', pkg.project).party;
        const st = placed(ctx, p.store) ?? ctx.reject('production.nowhere', unplaced(ctx, p.store));
        if (st.holder !== party) ctx.reject('production.notOurStore', { store: st.label, party: partyLabel(ctx, party) });
        if (p.material) {
          if (!(p.material in effectiveMaterials(ctx, p.package).per)) ctx.reject('production.notNeeded', { material: p.material, package: pkg.label });
          ctx.patch('WorkPackage', p.package, { supply: { ...pkg.supply, [p.material]: p.store } });
        } else ctx.patch('WorkPackage', p.package, { store: p.store, supply: {} });
        ctx.log('info', `${pkg.label}: ${p.material ? `${ctx.port('holdings').material(p.material).label} ` : ''}supplied from ${st.label}.`, [p.package]);
        // (a store with none of it, and none on its way there: said, not refused; Qwen S159)
        const hold = ctx.port('holdings');
        const lacking = (p.material ? [p.material] : Object.keys(effectiveMaterials(ctx, p.package).per)).filter((m0) => hold.stock(p.store, m0) <= 1e-9 && ctx.port('trade').onOrder(p.store, m0) <= 1e-9);
        if (lacking.length) ctx.log('warn', `${st.label} holds none of ${lacking.map((m0) => hold.material(m0).label).join(', ')}, and none is on its way there: ${pkg.label} waits until some is brought or ordered there.`, [p.package, p.store]);
        requestDispatch(ctx);
      },
      { label: 'Supply work from a store', description: 'Draw a material of a work package (or all of them, without `material`) from one of our stores; it is carried from there to the work front by hand or by machine.' },
    ),
    'production.setPriority': command(s.object({ project: s.ref('project'), priority: s.number() }), (ctx, p) => {
      mustOwnProject(ctx, p.project);
      ctx.patch('Project', p.project, { priority: p.priority });
      requestDispatch(ctx);
    }),
    'production.pauseProject': command(s.object({ project: s.ref('project') }), (ctx, p) => {
      mustOwnProject(ctx, p.project);
      const pr = ctx.require('Project', p.project);
      if (pr.status !== 'active') return;
      ctx.patch('Project', p.project, { status: 'paused' });
      for (const id of pr.packages) {
        const pkg = ctx.require('WorkPackage', id);
        if (pkg.status === 'active') {
          account(ctx, id);
          if (pkg.process) ctx.proc.setRate(pkg.process, 0);
          clearActive(ctx, id);
          release(ctx, id);
          ctx.patch('WorkPackage', id, { status: 'ready' });
        }
      }
      requestDispatch(ctx);
    }),
    'production.resumeProject': command(s.object({ project: s.ref('project') }), (ctx, p) => {
      mustOwnProject(ctx, p.project);
      const pr = ctx.require('Project', p.project);
      if (pr.status !== 'paused') return;
      ctx.patch('Project', p.project, { status: 'active' });
      // ordering chosen while it was paused: now
      orderSupply(ctx, p.project);
      requestDispatch(ctx);
    }),
    'production.extendProject': command(
      s.object({ project: s.ref('project'), packages: s.array(SpecSchema) }),
      (ctx, p) => {
        const pr = ctx.require('Project', p.project);
        if (pr.status === 'complete' || pr.status === 'cancelled') ctx.reject('production.projectClosed', { project: pr.label });
        const ids: Record<string, EntityId> = {};
        for (const id of pr.packages) ids[ctx.require('WorkPackage', id).key] = id;
        const { hours, cost, made } = makePackages(ctx, p.project, pr.store, p.packages as unknown as PackageSpec[], ids);
        ctx.patch('Project', p.project, { packages: [...pr.packages, ...made], estimate: { ...pr.estimate, hours: pr.estimate.hours + hours, cost: pr.estimate.cost + cost } });
        // more work, more to order (up front: now)
        orderSupply(ctx, p.project);
        requestDispatch(ctx);
        return Object.fromEntries((p.packages as unknown as PackageSpec[]).map((sp) => [sp.key, ids[sp.key]!]));
      },
      { label: 'Add work to a project (a plan revised)', internal: true },
    ),
    'production.cancelPackage': command(
      s.object({ package: s.ref('workPackage') }),
      (ctx, p) => {
        const pkg = ctx.require('WorkPackage', p.package);
        // what of it was not begun leaves the plan (Qwen S209: a revised project's plan added both versions up)
        const left = pkg.status === 'done' || pkg.status === 'cancelled' ? 0 : 1 - progressOf(ctx, pkg);
        cancelOne(ctx, p.package);
        const pr = ctx.require('Project', pkg.project);
        if (left > 0) ctx.patch('Project', pkg.project, { estimate: { ...pr.estimate, hours: Math.max(0, pr.estimate.hours - left * (pkg.estimate.hours || 0)), cost: Math.max(0, pr.estimate.cost - left * (pkg.estimate.cost ?? 0)) } });
        // what followed it now follows what it followed
        for (const id of ctx.require('Project', pkg.project).packages) {
          const w = ctx.require('WorkPackage', id);
          if (!w.after.some((l) => l.package === p.package)) continue;
          const after = [...w.after.filter((l) => l.package !== p.package), ...pkg.after.filter((l) => !w.after.some((x) => x.package === l.package))];
          ctx.patch('WorkPackage', id, { after });
        }
        maybeComplete(ctx, pkg.project);
        requestDispatch(ctx);
      },
      { label: 'Drop a work package (a plan revised)', internal: true },
    ),
    'production.setSupply': command(
      s.object({ project: s.ref('project'), mode: s.enum(['upfront', 'justInTime', 'none']), bufferHours: s.number({ min: 0, unit: 'h' }).optional(), coverDays: s.number({ min: 0.5, unit: 'd' }).optional() }),
      (ctx, p) => {
        mustOwnProject(ctx, p.project);
        const pr = ctx.require('Project', p.project);
        if (pr.status === 'complete' || pr.status === 'cancelled') ctx.reject('production.projectClosed', { project: pr.label });
        if (p.mode === 'none') {
          const { supply: _s, ...rest } = pr;
          ctx.set('Project', p.project, rest as Project);
          clearSnags(ctx, p.project);
        } else ctx.patch('Project', p.project, { supply: { mode: p.mode, ...(p.bufferHours !== undefined ? { bufferHours: p.bufferHours } : {}), ...(p.coverDays !== undefined ? { coverDays: p.coverDays } : {}) } });
        orderSupply(ctx, p.project);
        return ctx.require('Project', p.project).supply ?? null;
      },
      {
        description:
          "How a project's materials are ordered (a store serves all our work that draws from it, net of what our own work puts in). upfront: everything the remaining work needs, now (money tied up and room on the site; the work still waits where it needs goods before the lead time lets them come). justInTime: production orders against the schedule, so that deliveries land bufferHours (default 8) before the work needs them, each covering coverDays (default 5) of use; cheaper to hold, but a late supplier or a lorry broken down on the way makes the work wait. none: you order yourself. Compare first with the projection production.supplyOptions {project}.",
      },
    ),
    'production.cancelProject': command(s.object({ project: s.ref('project') }), (ctx, p) => {
      mustOwnProject(ctx, p.project);
      const pr = ctx.require('Project', p.project);
      if (pr.status === 'complete' || pr.status === 'cancelled') return;
      // (calling it off is word to the others it involves, S4: a firm doing part of it, the suppliers of what has not
      // come; our own crew hear it at the morning's report, a limit: Qwen S514, called off with no word getting out)
      const open = (pr.orders ?? []).filter((o) => ctx.port('trade').isOpen(o));
      // (a player's: the chain of commands a client began, not the world's own course)
      const noWord = ctx.actor !== null && !ctx.setup ? wordBlock(ctx, pr.party) : undefined;
      if (noWord && ctx.caller === 'client') {
        const firms = [...new Set(pr.packages.map((id) => ctx.require('WorkPackage', id)).filter((w) => w.contractor && w.status !== 'done' && w.status !== 'cancelled').map((w) => ctx.data('contractors')[w.contractor!]?.label ?? w.contractor!))];
        if (firms.length || open.length) ctx.reject('production.noWord', { project: pr.label, whom: [...firms, ...(open.length ? [`the suppliers of ${open.length} order${open.length > 1 ? 's' : ''}`] : [])].join(' and '), why: noWord.why }, noWord.remedies);
      }
      for (const id of pr.packages) cancelOne(ctx, id);
      // what was ordered for it and has not come: cancelled with it (lorries on the road still deliver); called off by
      // another deed of ours (the camp struck) while our word cannot get out, it still comes until we can tell them
      if (noWord && open.length) ctx.log('warn', `${pr.label}: ${open.length} order${open.length > 1 ? 's' : ''} for it still stand${open.length > 1 ? '' : 's'}: our word cannot reach the supplier (${noWord.why}); call ${open.length > 1 ? 'them' : 'it'} off when it can (inventory.cancelOrder).`, [p.project, ...open]);
      else for (const o of open) ctx.command('inventory.cancelOrder', { order: o });
      ctx.patch('Project', p.project, { status: 'cancelled', completedAt: ctx.now });
      clearSnags(ctx, p.project);
      // what it had ordered may have been counted by our other work ordering up front: they reckon again
      for (const [id, other] of [...ctx.all('Project')]) if (other.party === pr.party && other.status === 'active' && other.supply?.mode === 'upfront') orderSupply(ctx, id);
      ctx.log('warn', `Project cancelled: ${pr.label}`, [p.project]);
      // its owner (a road, a structure) answers for what it was building (else the thing stays half-built forever)
      ctx.emit('production.projectCancelled', { project: p.project, owner: pr.owner, ...(pr.ref ? { ref: pr.ref } : {}) });
      // and what was set up for it ends with it (decision 0028)
      ctx.end(p.project, `${pr.label}: called off`);
      requestDispatch(ctx);
    }),
  },
  contributes: {
    // the stores live work puts its goods into or draws them from (a felling's heap another felling stacks onto too):
    // not given up or closed from under it, and held for it when the work it was set up for ends (decision 0028, review x)
    storeUses: () => (read: ReadCtx, store: EntityId) => {
      const out: StoreUse[] = [];
      const live = (pr: Readonly<Project> | undefined) => pr?.status === 'active' || pr?.status === 'paused';
      for (const [id, pr] of read.all('Project')) if (live(pr) && pr.store === store) out.push({ by: id, why: `${pr.label} puts its goods there`, holdFor: true });
      for (const [, w] of read.all('WorkPackage')) {
        // (its own work front is its own to close)
        if (w.status === 'done' || w.status === 'cancelled' || w.front === store || !live(read.get('Project', w.project))) continue;
        const uses = w.store === store || w.fells?.store === store || w.haul?.store === store || w.ground?.store === store || (w.produces ?? []).some((x) => x.store === store) || Object.values(w.supply ?? {}).includes(store) || Object.values(w.substitutes ?? {}).some((x) => x.store === store);
        if (uses && !out.some((u) => u.by === w.project)) out.push({ by: w.project, why: `${w.label} (${read.require('Project', w.project).label}) takes from it or puts into it`, holdFor: true });
      }
      return out;
    },
    // an area felled by work is cleared ground: no stand there for a vehicle (S3)
    clearedGround: () => ({ at: (read: ReadCtx, x: number, z: number) => felledAreas(read).some((a) => containsXZ(a, x, z)), revision: (read: ReadCtx) => read.state('production').felled ?? 0 }),
    // where someone's work is: the front of the package they are put to, while it is at work or to be
    post: () => (read: ReadCtx, person: EntityId) => {
      const a = read.get('Assignment', person);
      const pkg = a ? read.get('WorkPackage', a.package) : undefined;
      if (!pkg || (pkg.status !== 'active' && pkg.status !== 'ready')) return undefined;
      return standAt(read, workFront(pkg, progressOf(read, pkg)));
    },
  },
  ports: {
    production: (read): ProductionPort => ({
      activity: (id) => activityOf(read, id),
      estimate: (spec, party) => estimatePackage(read, spec, party),
      knownSoil: (party, pos, depth) => knownSoil(read, party, pos, depth),
      knownColumn: (party, pos) => knownColumn(read, party, pos).column,
      schedule: (project): ScheduleRow[] => forecastSchedule(read, project, (id) => effectiveMaterials(read, id)),
      progress: (pkg) => {
        const p = read.get('WorkPackage', pkg);
        return p ? progressOf(read, p) : 0;
      },
      workmanship: (pkg) => workmanshipOf(read, pkg),
      projectCost: (project) =>
        (read.get('Project', project)?.packages ?? []).reduce((a, id) => {
          const c = read.get('WorkPackage', id)?.cost;
          return a + (c ? c.labour + c.equipment + c.materials + c.subcontract : 0);
        }, 0),
      projectWorkmanship: (project, which) => {
        let weight = 0;
        let sum = 0;
        for (const id of read.get('Project', project)?.packages ?? []) {
          const p = read.get('WorkPackage', id);
          const w = workmanshipOf(read, id);
          if (!p || w === null || (which && !which(p.data))) continue;
          // packages differ in unit (m², m³, t): their cost is the common measure of their share of the work
          const c = p.cost.labour + p.cost.equipment + p.cost.materials + p.cost.subcontract;
          if (c <= 0) continue;
          weight += c;
          sum += c * w;
        }
        return weight > 0 ? sum / weight : null;
      },
    }),
  },
  projections: {
    'production.soilKnowledge': {
      label: 'What we know of the ground: our test pits and what they showed (elsewhere our plans go by the region’s soil map)',
      description: 'args: party (whose; a client sees its own)',
      compute: (read: ReadCtx, args?: { party?: EntityId }) => (read.state('production').probes ?? []).filter((p) => !args?.party || p.party === args.party).map((p) => ({ at: p.at, dug: read.calendar.format(p.t), layers: p.seen.map((x) => ({ to: x.to, soil: read.port('terrain').soilClass(x.id).label ?? x.id })) })),
    },
    'production.supplyOptions': {
      label: "A project's materials ordered up front or just in time: the money tied up against the hours the work is expected to wait for lorries",
      description: 'args: project, bufferHours?, coverDays?',
      compute: (read: ReadCtx, args: Record<string, unknown> = {}) => {
        const project = args.project as EntityId | undefined;
        if (!project || !read.get('Project', project)) return null;
        const policy = { mode: 'justInTime' as const, ...(typeof args.bufferHours === 'number' ? { bufferHours: args.bufferHours } : {}), ...(typeof args.coverDays === 'number' ? { coverDays: args.coverDays } : {}) };
        return supplyOptions(read, project, effectiveMaterials, (w) => doneOf(read, w), policy);
      },
    },
    'production.projects': {
      label: 'Projects',
      description: 'args: party (whose projects; a client sees its own)',
      compute: (read, args?: { party?: EntityId }) =>
        [...read.all('Project')].filter(([, p]) => !args?.party || p.party === args.party).map(([id, p]) => {
          const pkgs = p.packages.map((x) => read.get('WorkPackage', x)!).filter(Boolean);
          const total = pkgs.reduce((a, x) => a + (x.estimate.hours || 0), 0);
          const done = pkgs.reduce((a, x) => a + (x.estimate.hours || 0) * progressOf(read, x), 0);
          return {
            id,
            label: p.label,
            status: p.status,
            owner: p.owner,
            progress: total > 0 ? done / total : 0,
            packages: pkgs.length,
            active: pkgs.filter((x) => x.status === 'active').length,
            blocked: p.packages.filter((x) => read.blockersOf(x).some((b) => b.severity === 'block')).length,
            // (what is still planned at its estimate, what was given up at what it cost: Qwen S209; `planned`: as estimated, with
            // what revisions added and dropped)
            estimate: (() => {
              const spent = (x: (typeof pkgs)[number]) => x.cost.labour + x.cost.equipment + x.cost.materials + (x.cost.subcontract ?? 0);
              // (what is done or given up at what it cost; what is still to do at its estimate)
              const live = pkgs.filter((x) => x.status !== 'cancelled' && x.status !== 'done');
              const gone = pkgs.filter((x) => x.status === 'cancelled' || x.status === 'done');
              return { hours: live.reduce((a, x) => a + (x.estimate.hours || 0), 0) + gone.reduce((a, x) => a + (x.workedHours || 0), 0), cost: Math.round((live.reduce((a, x) => a + (x.estimate.cost ?? 0), 0) + gone.reduce((a, x) => a + spent(x), 0)) * 100) / 100, finish: p.estimate.finish };
            })(),
            planned: p.estimate,
            // when it finishes as things stand: the actual end once done, otherwise the forecast schedule
            finish: p.status === 'complete' ? (p.completedAt ?? read.now) : Math.max(0, ...read.port('production').schedule(id).map((r) => r.finish)),
            cost: pkgs.reduce((a, x) => a + x.cost.labour + x.cost.equipment + x.cost.materials + (x.cost.subcontract ?? 0), 0),
          };
        }),
    },
  },
});

export { estimatePackage, progressOf, doneOf };
