/**
 * Equipment module: individual machines (owned or rented) that accrue engine hours, burn
 * diesel, need periodic service and break down stochastically; owning, rental, repair and
 * fuel costs are posted to the ledger; relocation and rental deliveries run as moves on carriers
 * (tracked machines go by low-loader).
 */
import { batteryFor, ELECTRICITY, indexPowered, powerHour, selfDischarge } from './power.ts';
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import { actorOf, partyLabel, wordBlock } from '../../parties/src/index.ts';
import type { Carrier, LegRequest, Load } from '../../network/src/index.ts'; // routing/moves port, command and event typings
import type { Vec2 } from '../../geo/src/index.ts';
import { fillRemedies } from '../../inventory/src/index.ts'; // inventory port: diesel stock for refuelling; the ways to get fuel
import type {} from '../../workforce/src/index.ts'; // drivers for machines moved by a player
import type {} from '../../agreements/src/index.ts'; // a machine is a thing that can be lent (its holder said to agreements)
import { command, convert, DAY, defineModule, shareWillingToPay, ex, HOUR, s, type Blocker, type EntityId, type Explained, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import { EquipmentClassSchema, engineOf, EquipmentSettingsSchema, fuelOf, fuelPerHour, inHand, MachineModelSchema, profileOf, type EquipmentPort, type EquipmentState, type Machine, type LowLoaderTransport, type MachineModel, type RepairJob } from './contract.ts';

/** Module id (it provides the port of the same name; consumers should require the port). */
export const EQUIPMENT_MODULE_ID = 'equipment';
/** Mean days per month for monthly cost rates (365.25 / 12). */
export const DAYS_PER_MONTH = 30.44;
/** Machines needing a low-loader may crawl up to this distance on their own tracks. */
export const LOW_LOADER_MIN_DISTANCE = 2000;
/** Loading + securing + unloading time billed per low-loader transport. */
export const LOW_LOADER_HANDLING_H = 1;
/** Hands-on breakdown repair time is clipped to this range (fitter working hours). */
export const REPAIR_MIN_H = 0.5;
export const REPAIR_MAX_H = 60;
/** time to take the call and load the van (the field service's days and hours are practice: `equipmentSettings.workingHours`) */
export const FIELD_SERVICE_DISPATCH_S = 2 * HOUR;
/** diagnosis on site before parts are ordered */
export const DIAGNOSIS_H = 1;
/** Services start after the working day. */
export const SERVICE_START_HOUR = 18;
/** Load assumed for hourly cost estimates (fuel factor 0.6 + 0.4 × 0.75 = 0.9). */
export const TYPICAL_LOAD = 0.75;
/** Working hours per rental day used to spread the day rate in hourly cost estimates. */
export const RENTAL_HOURS_PER_DAY = 8;
/** Rental delivery: machines leave the depot early morning on the delivery day. */
const DELIVERY_DEPART_HOUR = 6;

const round2 = (x: number) => Math.round(x * 100) / 100;
const fuelFactor = (load: number) => 0.6 + 0.4 * Math.min(1, Math.max(0, load)); // = fuelPerHour / fuelUse

const PointSchema = s.point();
const MachineSchema = s.object({
  model: s.string(),
  holder: s.ref('party'),
  ownership: s.enum(['owned', 'rented']),
  acquiredAt: s.number({ unit: 's' }),
  engineHours: s.number({ min: 0, unit: 'h' }),
  hoursSinceService: s.number({ min: 0, unit: 'h' }),
  tank: s.ref('store').optional(),
  battery: s.ref('store').optional(),
  charged: s.number({ min: 0, unit: 'kWh' }).optional(),
  status: s.enum(['ready', 'travelling', 'broken', 'servicing', 'arriving', 'offHired']),
  until: s.number({ unit: 's' }).optional(),
  hireEnds: s.number({ unit: 's' }).optional(),
  move: s.ref('move').optional(),
  destination: PointSchema.optional(),
  bookValue: s.number({ min: 0, unit: 'EUR' }).optional(),
  lastActive: s.number({ unit: 's' }).optional(),
  pendingPrice: s.number({ min: 0, unit: 'EUR' }).optional(),
  deliveryTries: s.number({ min: 0 }).optional(),
  setUp: s.boolean().optional(),
  listing: s.object({ ask: s.number({ min: 0, unit: 'EUR' }), since: s.number({ unit: 's' }), buyer: s.string().optional(), offer: s.object({ price: s.number({ min: 0, unit: 'EUR' }), until: s.number({ unit: 's' }) }).optional() }).optional(),
  ranBy: s.record(s.number({ min: 0 })).optional(),
  keptBy: s.record(s.number({ min: 0 })).optional(),
});

function model(ctx: ReadCtx, id: string): MachineModel {
  const m = ctx.data('machineModels')[id];
  if (!m) throw new Error(`Unknown machine model ${id}`);
  return m;
}

const index = (ctx: ReadCtx, t: number) => (ctx.hasPort('prices') ? ctx.port('prices').index(t) : 1);
const lowLoaderProfile = (ctx: ReadCtx) => ctx.data('equipmentSettings').lowLoaderProfile;
const lowLoaderRate = (ctx: ReadCtx) => ctx.data('equipmentSettings').lowLoaderRate.value;

/** a machine as it is, with where it is now (design/physical-state.md I2: its place is the moves module's, written only by a move) */
type Placed = Machine & { pos: Vec2 };
function machineGet(read: ReadCtx, id: EntityId): Readonly<Placed> | undefined {
  const m = read.get('Machine', id);
  if (!m) return undefined;
  // (beyond the map, at a dealer's or on the way in: where it is bound for)
  const pos = read.port('moves').where(id) ?? m.destination ?? [0, 0];
  return { ...m, pos: [pos[0], pos[1]] };
}
function machineAt(read: ReadCtx, id: EntityId): Readonly<Placed> {
  const m = machineGet(read, id);
  if (!m) throw new Error(`Entity ${id} has no component Machine`);
  return m;
}

/** the fuel in a machine's tank (its holding riding with it), in the fuel's unit */
export function fuelIn(read: ReadCtx, id: EntityId): number {
  const m = machineGet(read, id);
  return m?.tank ? read.port('holdings').stock(m.tank, fuelOf(model(read, m.model))) : 0;
}

/** burnt in its engine: from the tank to the air (design/physical-state.md I1) */
function burn(ctx: WriteCtx, id: EntityId, litres: number, why: string): void {
  const m = machineAt(ctx, id);
  const take = Math.min(litres, fuelIn(ctx, id));
  if (m.tank && take > 1e-9) {
    const r = ctx.command('inventory.release', { from: m.tank, material: fuelOf(model(ctx, m.model)), qty: take, to: 'air', why });
    if (!r.ok) throw new Error(`burn ${id}: ${JSON.stringify(r.reasons)}`);
  }
}

/** fuel into its tank from a store: by hand where both are, else by the carrier named (declared until moves carry it) */
/** fuel into its tank from a store where both are, by hand (from farther it is brought: bringFuel) */
function fill(ctx: WriteCtx, id: EntityId, from: EntityId, litres: number): boolean {
  const m = machineAt(ctx, id);
  if (!m.tank || !(litres > 1e-9)) return false;
  const r = ctx.command('inventory.transfer', { from, to: m.tank, material: fuelOf(model(ctx, m.model)), qty: litres, why: `fuel for the ${model(ctx, m.model).label}` });
  return r.ok;
}

/** the store of a party's nearest a point that keeps a fuel and has some (no machine's tank, nothing someone carries) */
const nearestFuel = (read: ReadCtx, at: Vec2, fuel: string, party: EntityId): EntityId | undefined => read.port('holdings').ofParty(party, { kept: true, near: at, has: fuel, accepts: fuel })[0];

/**
 * The ways to fill a machine run dry: topped up from fuel of its user's at hand, else its fuel bought or fetched into the
 * store of its user's nearest it (a filling station's petrol fetched in cans)
 */
function fuelRemedies(read: ReadCtx, id: EntityId, at: Vec2): Remedy[] {
  const m = machineAt(read, id);
  const md = model(read, m.model);
  const fuel = fuelOf(md);
  const user = userOf(read, id);
  const hold = read.port('holdings');
  const near = nearestFuel(read, at, fuel, user);
  if (near && hold.stock(near, fuel) > 1e-6) return [{ label: `Top the ${md.label} up from ${hold.label(near)}`, command: { type: 'equipment.topUp', payload: { machine: id } } }];
  const best = hold.ofParty(user, { kind: ['stockpile', 'depot', 'site'], near: at })[0];
  return best ? fillRemedies(read, best, fuel, md.engine?.tankSize.value ?? 1, { pos: at }).slice(0, 3) : [];
}

/**
 * The ways to get someone of ours to a machine that needs a hand at it (a generator's pull cord): it brought to where one
 * of ours is (the nearest carries it), one who helps us asked to come, or, with nobody at all, someone hired
 */
function someoneTo(read: ReadCtx, id: EntityId, party: EntityId, at: Vec2): Remedy[] {
  const md = model(read, machineAt(read, id).model);
  if (!read.hasPort('workforce')) return [];
  const wf = read.port('workforce');
  const moves = read.port('moves');
  const out: Remedy[] = [];
  const ours = wf.staff(party).map((x) => ({ x, w: moves.placeOf(x)?.on === undefined ? moves.where(x) : undefined })).filter((o): o is { x: EntityId; w: Vec2 } => Boolean(o.w)).sort((a, b) => Math.hypot(a.w[0] - at[0], a.w[1] - at[1]) - Math.hypot(b.w[0] - at[0], b.w[1] - at[1]));
  const first = ours[0];
  if (first) out.push({ label: `Have the ${md.label} brought to ${wf.name(first.x)}, where they are`, command: { type: 'equipment.moveTo', payload: { machine: id, to: [first.w[0], first.w[1]] } } });
  for (const h of wf.helpersFor('labour', party).slice(0, 2)) out.push({ label: `Ask ${h.name} to come and help (there from ${read.calendar.format(h.arrives, 'day')})`, command: { type: 'workforce.askForHelp', payload: { person: h.person, days: 1 } } });
  if (!out.length && read.data('jobs')?.worker) out.push({ label: 'Hire a worker', command: { type: 'workforce.recruit', payload: { job: 'worker', count: 1 } } });
  return out;
}

/** a generator running idle (the batteries by it full): nobody fills it to burn on for nothing */
const idling = (read: ReadCtx, id: EntityId): boolean => Boolean(read.state('equipment').generating?.[id]?.idle);

/** a quantity as said in the log: to a tenth below a hundred, whole above */
const fmtQty = (q: number): string => (q < 100 ? (Math.round(q * 10) / 10).toString() : Math.round(q).toString());

/**
 * Fuel brought to machines (design/physical-state.md I6, findings 6 and 7): a move, never a transfer at a distance. One
 * of the party's vehicles with a driver of theirs (who walks to it first) goes to the stock, is loaded there, drives to
 * each machine in turn and fills its tank where it stands, and brings the rest back; with no vehicle free, one of
 * theirs carries what one person can in cans. Returns when the last machine is filled, or why nobody can.
 */
function bringFuel(ctx: WriteCtx, party: EntityId, store: EntityId, wants: { machine: EntityId; qty: number }[], purpose: string): { arrive: number } | { why: string } {
  const hold = ctx.port('holdings');
  const named = hold.label(store) ?? store;
  const moves = ctx.port('moves');
  const at: Vec2 = [...hold.where(store)!];
  // (each machine its own fuel: diesel for the loader, two-stroke mix for the saw, in one round: r38)
  const stops = wants.filter((w) => w.qty > 1e-6 && moves.placeOf(w.machine)?.on === undefined && moves.where(w.machine)).map((w) => ({ ...w, material: fuelOf(model(ctx, machineAt(ctx, w.machine).model)) }));
  if (!stops.length) return { why: 'no machine to fill where it stands' };
  const have: Record<string, number> = {};
  for (const w of stops) have[w.material] = hold.stock(store, w.material);
  const label = (m: string) => hold.material(m).label;
  if (stops.every((w) => !(have[w.material]! > 1e-6))) return { why: `no ${[...new Set(stops.map((w) => label(w.material)))].join(' or ')} at ${named}` };
  // a vehicle of theirs that carries goods, sound and free, the nearest to the stock first
  const eq = equipmentPort(ctx);
  const vehicles = [...ctx.all('Machine')]
    .map(([v]) => v)
    .filter((v) => eq.usableBy(v, party) && ctx.data('equipmentClasses')[model(ctx, machineAt(ctx, v).model).class]?.kind === 'vehicle' && model(ctx, machineAt(ctx, v).model).payload && machineAt(ctx, v).status === 'ready' && moves.placeOf(v)?.on === undefined && moves.where(v) && !withRider(ctx, v))
    .sort((a, b) => Math.hypot(moves.where(a)![0] - at[0], moves.where(a)![1] - at[1]) - Math.hypot(moves.where(b)![0] - at[0], moves.where(b)![1] - at[1]) || (a < b ? -1 : 1));
  const reach = ctx.data('labourSettings').ways.reach.value;
  const goods = (load: Record<string, number>) => Object.entries(load).filter(([, q]) => q > 1e-6).map(([material, qty]) => ({ goods: { material, qty, unit: hold.material(material).unit, holder: party } }));
  for (const v of vehicles) {
    const vm = model(ctx, machineAt(ctx, v).model);
    const vAt = moves.where(v)!;
    const found = driverFor(ctx, party, vm.operatorQualification, vAt);
    if (!found) continue;
    // what it takes: each machine's want, of what the stock has, within the vehicle's payload
    let kg = vm.payload!.value * 1000;
    const left: Record<string, number> = {};
    const plan0: { machine: EntityId; material: string; qty: number }[] = [];
    const stock = { ...have };
    for (const w of stops) {
      const q = Math.min(w.qty, stock[w.material]!, kg / unitMassOf(hold.material(w.material)));
      if (!(q > 1e-6)) continue;
      stock[w.material]! -= q;
      kg -= q * unitMassOf(hold.material(w.material));
      left[w.material] = (left[w.material] ?? 0) + q;
      plan0.push({ machine: w.machine, material: w.material, qty: q });
    }
    if (!plan0.length) return { why: `no fuel for them at ${named}` };
    const load = { ...left };
    const carrier = { class: vm.transport!.vehicleProfile, unit: v };
    const legs: LegRequest[] = [...found.walk];
    if (Math.hypot(vAt[0] - at[0], vAt[1] - at[1]) > reach) legs.push({ carrier, from: [vAt[0], vAt[1]], to: at, maxOffroad: SITE_OFFROAD, inCharge: found.driver, loads: [] });
    const loadAt = legs.length - 1;
    const plan: { leg: number; machine: EntityId; material: string; qty: number }[] = [];
    let from = at;
    for (const w of plan0) {
      const to = moves.where(w.machine)!;
      legs.push({ carrier, from: [from[0], from[1]], to: [to[0], to[1]], maxOffroad: SITE_OFFROAD, inCharge: found.driver, loads: goods(left) });
      plan.push({ leg: legs.length - 1, ...w });
      left[w.material]! -= w.qty;
      from = to;
    }
    legs.push({ carrier, from: [from[0], from[1]], to: at, maxOffroad: SITE_OFFROAD, inCharge: found.driver, loads: goods(left) });
    const r = ctx.command('moves.dispatch', { legs, purpose, requester: EQUIPMENT_MODULE_ID });
    if (!r.ok) continue;
    startRun(ctx, r.value as EntityId, { store, loadAt, load, stops: plan });
    const m = ctx.require('Move', r.value as EntityId);
    // (said: who goes, with what, to whom: S410, not bookkeeping nobody sees)
    const wf = ctx.port('workforce');
    ctx.log('info', `${purpose === 'fuel round' ? 'Fuel round' : 'Fuel brought'}: ${wf.name(found.driver)} takes the ${vm.label} from ${named} with ${Object.entries(load).map(([mt, q]) => `${fmtQty(q)} ${hold.material(mt).unit} ${hold.material(mt).label}`).join(' and ')} to ${plan.length} machine(s), back ${ctx.calendar.format(m.legs.at(-1)!.arrive)}.`, [v, ...plan.map((x) => x.machine)]);
    return { arrive: m.legs[plan.at(-1)!.leg]!.arrive };
  }
  // in cans, by one of theirs on foot: what one carries, to the first machine whose fuel is there
  const person = driverFor(ctx, party, undefined, at);
  if (!person) return { why: 'nobody of theirs free to bring it' };
  const w = stops.find((x) => have[x.material]! > 1e-6)!;
  const mat = hold.material(w.material);
  const cans = (ctx.data('handling')?.safeLoad.value ?? 25) / unitMassOf(mat);
  const q = Math.min(w.qty, cans, have[w.material]!);
  const to = moves.where(w.machine)!;
  const walk = ctx.data('labourSettings').ways.walk;
  const legs: LegRequest[] = [...person.walk];
  const loadAt = legs.length - 1;
  legs.push({ carrier: { class: walk, unit: person.driver }, from: at, to: [to[0], to[1]], maxOffroad: SITE_OFFROAD, loads: goods({ [w.material]: q }) });
  const stopLeg = legs.length - 1;
  // (and back with the cans, and what did not go in)
  legs.push({ carrier: { class: walk, unit: person.driver }, from: [to[0], to[1]], to: at, maxOffroad: SITE_OFFROAD, loads: [] });
  const r = ctx.command('moves.dispatch', { legs, purpose, requester: EQUIPMENT_MODULE_ID });
  if (!r.ok) return { why: r.reasons.map((b) => ctx.formatBlocker(b)).join('; ') };
  startRun(ctx, r.value as EntityId, { store, loadAt, load: { [w.material]: q }, stops: [{ leg: stopLeg, machine: w.machine, material: w.material, qty: q }] });
  ctx.log('info', `Fuel in cans: ${ctx.port('workforce').name(person.driver)} carries ${fmtQty(q)} ${mat.unit} ${mat.label} from ${named} to the ${model(ctx, machineAt(ctx, w.machine).model).label}.`, [w.machine]);
  const rest = stops.filter((x) => x !== w).length;
  if (rest) ctx.log('warn', `Only the ${model(ctx, machineAt(ctx, w.machine).model).label} gets fuel tonight, in cans: no vehicle of ours free for a round; ${rest} more not refuelled.`, stops.filter((x) => x !== w).map((x) => x.machine));
  return { arrive: ctx.require('Move', r.value as EntityId).legs[stopLeg]!.arrive };
}

const unitMassOf = (mat: { unit: string; density: { value: number } }): number => (mat.unit === 'l' ? mat.density.value : mat.unit === 'kg' ? 1 : mat.unit === 't' ? 1000 : mat.density.value * 1000);

/** a fuel run under way: loaded at once if it starts at the stock */
function startRun(ctx: WriteCtx, move: EntityId, run: NonNullable<EquipmentState['fuelRuns']>[string]): void {
  ctx.setState('equipment', { ...ctx.state('equipment'), fuelRuns: { ...(ctx.state('equipment').fuelRuns ?? {}), [move]: run } });
  if (run.loadAt < 0) loadRun(ctx, move);
}

function loadRun(ctx: WriteCtx, move: EntityId): void {
  const run = ctx.state('equipment').fuelRuns?.[move];
  if (!run) return;
  const load: Record<string, number> = {};
  for (const [material, want] of Object.entries(run.load)) {
    const q = Math.min(want, ctx.port('holdings').stock(run.store, material));
    if (q > 1e-6) ctx.command('inventory.load', { store: run.store, material, qty: q });
    load[material] = Math.max(0, q);
  }
  ctx.setState('equipment', { ...ctx.state('equipment'), fuelRuns: { ...ctx.state('equipment').fuelRuns, [move]: { ...run, load } } });
}

/** a fuel run at a leg's end: loaded at the stock, a tank filled, the rest back into the stock at the end */
function runLeg(ctx: WriteCtx, move: EntityId, leg: number, last: boolean): void {
  const run = ctx.state('equipment').fuelRuns?.[move];
  if (!run) return;
  if (leg === run.loadAt) return loadRun(ctx, move);
  const load = { ...run.load };
  const stop = run.stops.find((s) => s.leg === leg);
  // (filled where it stands: a machine gone from where the round stops is not filled from there, r38)
  const to = ctx.get('Move', move)?.legs[leg]?.route.to;
  const there = stop && ctx.port('moves').placeOf(stop.machine)?.on === undefined && ctx.port('moves').where(stop.machine);
  const near = Boolean(there && to && Math.hypot(there[0] - to[0], there[1] - to[1]) <= ctx.data('labourSettings').ways.reach.value + 1e-6);
  if (stop && near) {
    const m = machineGet(ctx, stop.machine);
    // (an off-hired machine waiting for its hire firm is not ours to fill)
    const q = Math.min(stop.qty, load[stop.material] ?? 0, m?.tank && m.status !== 'offHired' ? Math.max(0, model(ctx, m.model).engine!.tankSize.value - fuelIn(ctx, stop.machine)) : 0);
    if (m?.tank && q > 1e-6) {
      ctx.command('inventory.unload', { store: m.tank, material: stop.material, qty: q });
      load[stop.material] = (load[stop.material] ?? 0) - q;
    }
  }
  if (last) {
    for (const [material, q] of Object.entries(load)) if (q > 1e-6) ctx.command('inventory.unload', { store: run.store, material, qty: q });
    const { [move]: _done, ...rest } = ctx.state('equipment').fuelRuns ?? {};
    ctx.setState('equipment', { ...ctx.state('equipment'), fuelRuns: rest });
    return;
  }
  ctx.setState('equipment', { ...ctx.state('equipment'), fuelRuns: { ...ctx.state('equipment').fuelRuns, [move]: { ...run, load } } });
}

/** a machine leaving the world (handed back, sold): what is in its tank goes with it over the edge, and its tank is closed */
/** nobody rides this vehicle to work any more (handed back, sold, gone): what depends on it ends with it */
function dropRiders(ctx: WriteCtx, id: EntityId): void {
  const was = ctx.state('equipment').riders ?? {};
  if (!Object.values(was).includes(id)) return;
  ctx.patchState('equipment', { riders: Object.fromEntries(Object.entries(was).filter(([, v]) => v !== id)) });
}

function goesOut(ctx: WriteCtx, id: EntityId): void {
  const m = machineGet(ctx, id);
  dropRiders(ctx, id);
  if (m) indexPowered(ctx, id, model(ctx, m.model), false);
  if (m?.battery) {
    const kWh = ctx.port('holdings').stock(m.battery, ELECTRICITY);
    if (kWh > 1e-9) ctx.command('inventory.toOutside', { from: m.battery, material: ELECTRICITY, qty: kWh, why: `in the battery of the ${model(ctx, m.model).label}, gone with it` });
    ctx.command('inventory.closeStore', { store: m.battery });
  }
  if (!m?.tank) return;
  const left = fuelIn(ctx, id);
  if (left > 1e-9) ctx.command('inventory.toOutside', { from: m.tank, material: fuelOf(model(ctx, m.model)), qty: left, why: `in the tank of the ${model(ctx, m.model).label}, gone with it` });
  ctx.command('inventory.closeStore', { store: m.tank });
}

/** a tank for a machine with an engine: a holding of its fuel riding with it */
function tankFor(ctx: WriteCtx, id: EntityId, md: MachineModel, holder: EntityId, pos: Vec2): EntityId | undefined {
  if (!md.engine) return undefined;
  const r = ctx.command('inventory.createStore', { holder, label: `${md.label}: tank`, kind: 'tank', pos: [pos[0], pos[1]], on: id, holds: [fuelOf(md)], capacity: md.engine.tankSize.value });
  if (!r.ok) throw new Error(`tank for ${md.label}: ${JSON.stringify(r.reasons)}`);
  return r.value as EntityId;
}

/** Write a full Machine record (optional fields omitted rather than set to undefined). */
function writeMachine(ctx: WriteCtx, id: EntityId, m: Machine): void {
  const out: Machine = {
    model: m.model,
    holder: m.holder,
    ownership: m.ownership,
    acquiredAt: m.acquiredAt,
    engineHours: m.engineHours,
    hoursSinceService: m.hoursSinceService,
    status: m.status,
  };
  if (m.tank !== undefined) out.tank = m.tank;
  if (m.battery !== undefined) out.battery = m.battery;
  if (m.charged !== undefined) out.charged = m.charged;
  if (m.until !== undefined) out.until = m.until;
  if (m.hireEnds !== undefined) out.hireEnds = m.hireEnds;
  if (m.move !== undefined) out.move = m.move;
  if (m.destination !== undefined) out.destination = [m.destination[0], m.destination[1]];
  if (m.bookValue !== undefined) out.bookValue = m.bookValue;
  if (m.lastActive !== undefined) out.lastActive = m.lastActive;
  if (m.pendingPrice !== undefined) out.pendingPrice = m.pendingPrice;
  if (m.deliveryTries !== undefined) out.deliveryTries = m.deliveryTries;
  if (m.listing !== undefined) out.listing = { ...m.listing, ...(m.listing.offer ? { offer: { ...m.listing.offer } } : {}) };
  if (m.setUp) out.setUp = true;
  if (m.ranBy && Object.keys(m.ranBy).length) out.ranBy = { ...m.ranBy };
  if (m.keptBy && Object.keys(m.keptBy).length) out.keptBy = { ...m.keptBy };
  ctx.set('Machine', id, out);
}

function update(ctx: WriteCtx, id: EntityId, patch: Partial<Machine>, clear: (keyof Machine)[] = []): Machine {
  const was = machineAt(ctx, id);
  const next = { ...was, ...patch } as Machine;
  // hours run by one who borrowed it for nothing are theirs to keep: counted toward the next service; serviced, counted afresh
  if (patch.hoursSinceService !== undefined) {
    const ran = patch.hoursSinceService - was.hoursSinceService;
    const k = ran > 0 ? keeperOf(ctx, id).party : was.holder;
    if (patch.hoursSinceService === 0) delete next.ranBy;
    else if (k !== was.holder) next.ranBy = { ...was.ranBy, [k]: (was.ranBy?.[k] ?? 0) + ran };
  }
  for (const k of clear) delete next[k];
  writeMachine(ctx, id, next);
  return next;
}

function hourlyCostExplain(ctx: ReadCtx, id: EntityId): Explained {
  const m = machineAt(ctx, id);
  const md = model(ctx, m.model);
  const set = ctx.data('equipmentSettings');
  const parts: Explained[] = md.engine ? [ex.mul('fuel', 'EUR/h', ex.param(md.engine.fuelUse, 'fuel use'), ex.value(fuelFactor(TYPICAL_LOAD), '', 'typical load factor'), ex.param(set.dieselPrice, 'diesel price'))] : [];
  if (m.ownership === 'owned') {
    const idx = ex.value(index(ctx, ctx.now), '', 'price index');
    parts.push(ex.div('repair accrual', 'EUR/h', ex.mul(undefined, 'EUR/mo', ex.param(md.repairCostPerMonth, 'repair cost'), idx), ex.param(set.repairBasisHours, 'utilisation basis')));
    parts.push(
      ex.div(
        'owning share',
        'EUR/h',
        ex.mul(undefined, 'EUR/mo', ex.param(md.owningCostPerMonth, 'owning cost (A+V)'), ex.value(index(ctx, m.acquiredAt), '', 'price index at purchase')),
        ex.param(set.repairBasisHours, 'utilisation basis'),
      ),
    );
  } else if (m.ownership === 'rented' && md.rentalPerDay) {
    parts.push(
      ex.div(
        'rental share',
        'EUR/h',
        ex.mul(undefined, 'EUR/d', ex.param(md.rentalPerDay, 'rental day rate'), ex.value(index(ctx, ctx.now), '', 'price index')),
        ex.value(RENTAL_HOURS_PER_DAY, 'h/d', 'working hours per rental day'),
      ),
    );
  }
  return ex.sum(`hourly cost ${md.label}`, 'EUR/h', ...parts);
}

function equipmentPort(ctx: ReadCtx): EquipmentPort {
  return {
    model: (id) => model(ctx, id),
    fuel: (machine) => fuelIn(ctx, machine),
    usableBy: (machine, party) => {
      const m = machineGet(ctx, machine);
      // (off-hired: handed back, the hire firm's until it collects it; nobody of ours may use it: inHand)
      if (!m || !inHand(m, true)) return false;
      const user = ctx.contributions('machineUser').map((c) => c.impl(ctx, machine)).find((x): x is EntityId => Boolean(x));
      return user ? user === party : m.holder === party;
    },
    modelOf: (machine) => model(ctx, machineAt(ctx, machine).model),
    byClass: (cls) => {
      const out: EntityId[] = [];
      for (const [id, m] of ctx.all('Machine')) if (model(ctx, m.model).class === cls) out.push(id);
      return out;
    },
    ready: (machine) => {
      const m = machineGet(ctx, machine);
      // (fuel only where it has an engine: a bicycle runs on its rider)
      return Boolean(m) && m!.status === 'ready' && !m!.setUp && (fuelIn(ctx, machine) > 0 || !model(ctx, m!.model).engine) && !withRider(ctx, machine);
    },
    riddenBy: (person) => ctx.state('equipment').riders?.[person],
    withRider: (machine) => withRider(ctx, machine),
    // (where the moves have it then; beyond the map, where it is to come)
    positionAt: (machine, t) => ctx.port('moves').whereAt(machine, t) ?? machineAt(ctx, machine).pos,
    hourlyCost: (machine) => hourlyCostExplain(ctx, machine).v,
    hourlyCostExplain: (machine) => hourlyCostExplain(ctx, machine),
    machines: () => [...ctx.all('Machine')].map(([id]) => id),
    condition: (machine) => {
      const m = machineGet(ctx, machine);
      const wear = m ? model(ctx, m.model).wear : undefined;
      if (!m || m.status === 'broken') return 0;
      return wear && m.hoursSinceService >= wear.careEvery.value ? wear.careFactor.value : 1;
    },
    equipmentClass: (cls) => {
      const c = ctx.data('equipmentClasses')[cls];
      if (!c) throw new Error(`Unknown equipment class ${cls}`);
      return c;
    },
  };
}

/** Low-loader charge for a transport of `oneWayS` seconds: round trip + handling, at the hire rate. */
function chargeLowLoader(ctx: WriteCtx, machine: EntityId, oneWayS: number, memo: string): void {
  const hours = (2 * oneWayS) / HOUR + LOW_LOADER_HANDLING_H;
  // (whoever has it moved pays: its user, the one it is lent to, or its holder)
  const holder = userOf(ctx, machine);
  ctx.ledger.post({
    from: acct(holder, ACCOUNTS.cash),
    to: acct(holder, ACCOUNTS.transport),
    amount: lowLoaderRate(ctx) * index(ctx, ctx.now) * hours,
    memo: `${memo}: low-loader ${hours.toFixed(1)} h`,
    category: ACCOUNTS.transport,
    refs: [machine],
  });
}

function nextServiceSlot(ctx: ReadCtx, from: number): number {
  const t = ctx.calendar.startOfDay(from) + SERVICE_START_HOUR * HOUR;
  return t >= from ? t : t + DAY;
}

function scheduleService(ctx: WriteCtx, id: EntityId, from: number): void {
  const st = ctx.state('equipment');
  if (st.serviceDue[id] !== undefined) return;
  const at = nextServiceSlot(ctx, from);
  ctx.at(at, 'serviceStart', { machine: id });
  ctx.setState('equipment', { ...st, serviceDue: { ...st.serviceDue, [id]: at } });
}

function dropServiceDue(ctx: WriteCtx, id: EntityId): void {
  const st = ctx.state('equipment');
  if (st.serviceDue[id] === undefined) return;
  const { [id]: _gone, ...rest } = st.serviceDue;
  ctx.setState('equipment', { ...st, serviceDue: rest });
}

function bumpTotals(ctx: WriteCtx, d: Partial<EquipmentState['totals']>): void {
  const st = ctx.state('equipment');
  const t = st.totals;
  ctx.setState('equipment', {
    ...st,
    totals: {
      engineHours: t.engineHours + (d.engineHours ?? 0),
      fuelLitres: t.fuelLitres + (d.fuelLitres ?? 0),
      breakdowns: t.breakdowns + (d.breakdowns ?? 0),
      services: t.services + (d.services ?? 0),
    },
  });
}

/** the dealers' and hire firms' usual week and their field service's hours (practice) */
const workingHours = (read: ReadCtx) => read.data('equipmentSettings').workingHours;
/** is the day of t one the dealers and hire firms work */
const isWorkingDay = (read: ReadCtx, t: number) => workingHours(read).days.includes(read.calendar.at(t).weekday);

/** the day's rent of rented machines, paid by each one's holder */
/**
 * is the day of t a day of hire owed for this machine: rented, delivered, not broken down, a working day, and not past
 * its off-hire day (the day the notice counts from, the day itself charged: § 535 Abs. 2 BGB, the hire firms' terms).
 * The one test of the days owed: every working day from its delivery to its off-hire day counts once (review x)
 */
function hireDayOwed(ctx: ReadCtx, m: Machine, t: number): boolean {
  if (m.ownership !== 'rented' || m.status === 'arriving' || m.status === 'broken' || !isWorkingDay(ctx, t)) return false;
  return m.hireEnds === undefined || ctx.calendar.startOfDay(t) <= m.hireEnds;
}

function postRentalDay(ctx: WriteCtx, machines: EntityId[], memo: string): void {
  const byHolder = new Map<EntityId, { amount: number; ids: EntityId[] }>();
  for (const id of machines) {
    const m = machineAt(ctx, id);
    const b = byHolder.get(m.holder) ?? { amount: 0, ids: [] };
    b.amount += (model(ctx, m.model).rentalPerDay?.value ?? 0) * index(ctx, ctx.now);
    b.ids.push(id);
    byHolder.set(m.holder, b);
  }
  for (const holder of [...byHolder.keys()].sort()) {
    const b = byHolder.get(holder)!;
    if (b.amount > 0) ctx.ledger.post({ from: acct(holder, ACCOUNTS.cash), to: acct(holder, ACCOUNTS.equipmentRental), amount: b.amount, memo: byHolder.size > 1 ? `${memo} (${b.ids.length} of ${partyLabel(ctx, holder)})` : memo, category: ACCOUNTS.equipmentRental, refs: b.ids });
  }
}

/** a player may act only on the machines its party holds (modules acting for the world may) */
/** the one who rides it to work, and whether they are at work now (the vehicle is with them) */
function riderOf(ctx: ReadCtx, machine: EntityId): EntityId | undefined {
  return Object.entries(ctx.state('equipment').riders ?? {}).find(([, m]) => m === machine)?.[0];
}
/** away with the one who rode it to work this morning, until they are back */
function withRider(ctx: ReadCtx, machine: EntityId): boolean {
  return (ctx.state('equipment').out?.[machine] ?? 0) > ctx.now;
}

/** whom a machine is lent to now, if anyone */
const lentTo = (read: ReadCtx, id: EntityId) => read.contributions('machineUser').map((c) => c.impl(read, id)).find((x): x is EntityId => Boolean(x));
/** who uses a machine now (moves it, pays its moves, drives it): the one it is lent to, or its holder */
const userOf = (read: ReadCtx, id: EntityId): EntityId => lentTo(read, id) ?? machineAt(read, id).holder;

/**
 * A cost of keeping a machine (a service, a month's upkeep) shared out: each who borrowed it for nothing and
 * keeps books pays their share (by the hours they ran it, the days they kept it), said so; its holder the rest
 */
function shareOut(ctx: WriteCtx, id: EntityId, m: Readonly<Machine>, cost: number, memo: string, shares: Record<EntityId, number>, why: (party: EntityId) => string): void {
  let rest = Math.round(cost * 100) / 100;
  for (const [p0, share] of Object.entries(shares).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (p0 === m.holder || !ctx.port('prices').hasBooks(p0)) continue;
    const amount = Math.min(rest, Math.round(cost * share * 100) / 100);
    if (amount <= 0) continue;
    ctx.ledger.post({ from: acct(p0, ACCOUNTS.cash), to: acct(p0, ACCOUNTS.equipmentRepair), amount, memo: `${memo}, borrowed from ${partyLabel(ctx, m.holder)}: the borrower's share to keep (${why(p0)})`, category: ACCOUNTS.equipmentRepair, refs: [id] });
    rest = Math.round((rest - amount) * 100) / 100;
  }
  if (rest > 0) ctx.ledger.post({ from: acct(m.holder, ACCOUNTS.cash), to: acct(m.holder, ACCOUNTS.equipmentRepair), amount: rest, memo, category: ACCOUNTS.equipmentRepair, refs: [id] });
}

/** who pays its ordinary upkeep (services, a month's care): one who borrows it for nothing, else its holder; and how it is said */
function keeperOf(read: ReadCtx, id: EntityId): { party: EntityId; note: string } {
  const holder = machineAt(read, id).holder;
  const k = read.contributions('machineKeeper').map((c) => c.impl(read, id)).find((x): x is EntityId => Boolean(x));
  // (one who keeps no books cannot be billed: its holder bears it)
  return k && k !== holder && read.port('prices').hasBooks(k) ? { party: k, note: `, borrowed from ${partyLabel(read, holder)}: the borrower's to keep` } : { party: holder, note: '' };
}

/** to dispose of it (sell it, send it back to the hire firm): its holder, and not while it is lent out (ask for it back first) */
function mustHold(ctx: WriteCtx, id: EntityId): void {
  if (ctx.caller !== 'client') return;
  const m = machineGet(ctx, id);
  if (m && m.holder !== actorOf(ctx)) ctx.reject('equipment.notOurs', { machine: model(ctx, m.model).label, party: partyLabel(ctx, actorOf(ctx)) });
  const to = m ? lentTo(ctx, id) : undefined;
  if (m && to) ctx.reject('equipment.lent', { machine: model(ctx, m.model).label, to: partyLabel(ctx, to) });
}

/** to use it (move it, ride it): ours to use now: held by us and not lent out, or lent to us */
function mustUse(ctx: WriteCtx, id: EntityId): void {
  if (ctx.caller !== 'client') return;
  const m = machineGet(ctx, id);
  if (m?.status === 'offHired') ctx.reject('equipment.notReady', { machine: model(ctx, m.model).label, status: 'off-hired, the hire firm’s until it collects it' });
  if (m && !equipmentPort(ctx).usableBy(id, actorOf(ctx))) {
    const to = lentTo(ctx, id);
    ctx.reject(to ? 'equipment.lent' : 'equipment.notOurs', { machine: model(ctx, m.model).label, party: partyLabel(ctx, actorOf(ctx)), to: to ? partyLabel(ctx, to) : '' });
  }
}

/** how soon a buyer is to be expected, in words: far above the market, hardly anyone would pay it (an average: buyers come when they come, Qwen S503) */
const buyerExpected = (days: number): string => (days > 3650 ? 'hardly anyone would pay that: no buyer is to be expected at this ask' : `a buyer is expected in about ${Math.round(days)} days on average (one may come in days, or take months)`);

/** the expected days until a buyer who takes this ask comes */
export function expectedDaysToSell(read: ReadCtx, id: EntityId, ask: number): number {
  const market = read.port('usedPlant');
  const b = market.buyers(id);
  return b.meanDays / Math.max(1e-6, shareWillingToPay(ask, market.value(id).value, b.spread));
}

/** the next prospective buyer comes after an exponential wait (the world knows when; the players only the expected days) */
function nextBuyer(ctx: WriteCtx, id: EntityId, from = ctx.now): void {
  const at = Math.round(from + ctx.rng('used-plant').exponential(ctx.port('usedPlant').buyers(id).meanDays * DAY));
  ctx.patchState('equipment', { buyers: { ...ctx.state('equipment').buyers, [id]: at } });
  ctx.at(at, 'buyer', { machine: id, at });
}

function forgetBuyer(ctx: WriteCtx, id: EntityId): void {
  const { [id]: _gone, ...rest } = ctx.state('equipment').buyers;
  ctx.patchState('equipment', { buyers: rest });
}

/** offer a machine for sale at an ask */
function list(ctx: WriteCtx, id: EntityId, ask: number, since = ctx.now): void {
  update(ctx, id, { listing: { ask, since } });
  nextBuyer(ctx, id);
  saleBlockers(ctx, id);
}

/** what is said on a machine for sale: its ask and when a buyer is to be expected, and an offer standing, with how to take it */
function saleBlockers(ctx: WriteCtx, id: EntityId): void {
  const l = machineAt(ctx, id).listing;
  if (!l || l.buyer) return;
  const out: Blocker[] = [{ code: 'equipment.forSale', severity: 'info', params: { ask: Math.round(l.ask), value: Math.round(ctx.port('usedPlant').value(id).value), when: buyerExpected(expectedDaysToSell(ctx, id, l.ask)) } }];
  if (l.offer) out.push({ code: 'equipment.offered', severity: 'info', params: { price: l.offer.price, ask: Math.round(l.ask), until: ctx.calendar.format(l.offer.until, 'day') }, remedies: [{ label: `Take the offer of ${l.offer.price} €`, command: { type: 'equipment.acceptOffer', payload: { machine: id } } }] });
  ctx.blockers.set(id, out);
}

/**
 * what keeps a machine of ours from being sold as it stands, if anything: broken or a wreck. The one test for listing it,
 * a buyer agreeing to it, an offer taken and the buyer taking it over: an offer and a sale are for the machine as it was
 * offered, and lapse when it is no longer that (review x)
 */
function unsaleable(read: ReadCtx, id: EntityId): string | undefined {
  const m = machineGet(read, id);
  if (!m) return 'gone';
  if (m.status === 'broken') return read.blockersOf(id).some((b) => b.code === 'equipment.wrecked') ? 'a wreck' : 'broken';
  return undefined;
}

/** a buyer agrees a price (the ask, or their offer taken): they come from outside to collect it, and pay then */
function agree(ctx: WriteCtx, id: EntityId, price: number): void {
  const m = machineAt(ctx, id);
  const md = model(ctx, m.model);
  const party = ctx.command('parties.add', { label: `Buyer of the ${md.label}`, kind: 'firm' });
  const buyer = party?.ok ? (ctx.get('Party', party.value as EntityId)?.label ?? 'a buyer') : 'a buyer';
  forgetBuyer(ctx, id);
  const { offer: _o, ...listing } = m.listing!;
  update(ctx, id, { listing: { ...listing, ask: price, buyer } });
  const ext = ctx.port('routing').externalNodes()[0];
  const coming = ext !== undefined ? ctx.command('moves.dispatch', { legs: [{ carrier: { class: md.transport?.needsLowLoader ? lowLoaderProfile(ctx) : 'van' }, from: [m.pos[0], m.pos[1]], to: [m.pos[0], m.pos[1]], externalNode: ext, maxOffroad: SITE_OFFROAD }], purpose: 'buyer-approach', ref: id, requester: EQUIPMENT_MODULE_ID }) : null;
  ctx.log('info', `${buyer} agrees to ${Math.round(price)} € for ${md.label} and comes to collect it.`, [id]);
  // no way in: the buyer collects at the gate of the region
  if (!coming?.ok) collected(ctx, id);
}

/** the buyer is here: pays the ask, the books take the sale, and the machine leaves with them */
function collected(ctx: WriteCtx, id: EntityId): void {
  const m = machineAt(ctx, id);
  const md = model(ctx, m.model);
  // out on a move (an errand, a drive across, to work with its rider): the buyer waits for it to be back
  if (m.status === 'travelling' || m.status === 'arriving' || withRider(ctx, id)) {
    ctx.after(HOUR, 'collect', { machine: id });
    return;
  }
  // (broken or wrecked since it was agreed: not what they agreed to buy; the risk is the seller's until it is handed over,
  // § 446 BGB: the buyer goes without it and pays nothing, and it is ours, no longer for sale)
  const not = unsaleable(ctx, id);
  if (not) {
    update(ctx, id, {}, ['listing']);
    forgetBuyer(ctx, id);
    ctx.log('warn', `${m.listing!.buyer} came for the ${md.label} and found it ${not}: not what they agreed to buy; they go without it, and it is no longer for sale.`, [id]);
    return;
  }
  const ask = m.listing!.ask;
  const book = round2(m.bookValue ?? 0);
  const h = m.holder;
  ctx.ledger.post({ from: acct(h, ACCOUNTS.fixedAssets), to: acct(h, ACCOUNTS.cash), amount: Math.min(ask, book), memo: `Sale of ${md.label} (book value part)`, category: ACCOUNTS.fixedAssets, refs: [id] });
  if (ask > book) ctx.ledger.post({ from: acct(h, ACCOUNTS.assetGain), to: acct(h, ACCOUNTS.cash), amount: round2(ask - book), memo: `Sale of ${md.label}: gain over book value`, category: ACCOUNTS.assetGain, refs: [id] });
  if (ask < book) ctx.ledger.post({ from: acct(h, ACCOUNTS.fixedAssets), to: acct(h, ACCOUNTS.assetLoss), amount: round2(book - ask), memo: `Sale of ${md.label}: loss against book value`, category: ACCOUNTS.assetLoss, refs: [id] });
  const ext = ctx.port('routing').externalNodes()[0];
  // it leaves on the buyer's carrier (on a low-loader, or under its own power); it is theirs from here
  // (it goes on the move: on their low-loader, or driven under its own power)
  if (ext !== undefined) ctx.command('moves.dispatch', { legs: [{ ...carriage(ctx, id, Boolean(md.transport?.needsLowLoader), profileOf(md)), from: [m.pos[0], m.pos[1]], to: [m.pos[0], m.pos[1]], externalDestination: ext, maxOffroad: SITE_OFFROAD }], purpose: 'sold', ref: id, requester: EQUIPMENT_MODULE_ID });
  ctx.log('success', `${md.label} sold to ${m.listing!.buyer} for ${Math.round(ask)} € (book value ${Math.round(book)} €); it leaves with them.`, [id]);
  dropServiceDue(ctx, id);
  setRepair(ctx, id, null);
  setTransport(ctx, id, null);
  ctx.emit('equipment.sold', { machine: id, price: ask });
  ctx.emit('equipment.released', { machine: id });
  goesOut(ctx, id);
  ctx.destroy(id);
}

function arrive(ctx: WriteCtx, id: EntityId): void {
  const m = machineAt(ctx, id);
  // a machine bought from a dealer is paid on delivery and goes on the books
  if (m.pendingPrice !== undefined) {
    ctx.ledger.post({ from: acct(m.holder, ACCOUNTS.cash), to: acct(m.holder, ACCOUNTS.fixedAssets), amount: m.pendingPrice, memo: `Purchase ${model(ctx, m.model).label} (paid on delivery)`, category: ACCOUNTS.fixedAssets, refs: [id] });
    update(ctx, id, { bookValue: m.pendingPrice }, ['pendingPrice']);
  }
  // (worn out on the way, it arrives broken)
  // (where it is: its move set it down there)
  update(ctx, id, { status: m.status === 'broken' ? 'broken' : 'ready', lastActive: ctx.now }, ['move', 'destination', 'until']);
  if (m.status === 'broken') return;
  ctx.blockers.clear(id);
  ctx.emit('equipment.arrived', { machine: id });
}

/** what one person carries (production's handling data: a safe load), in kg; nothing without it */
function carryKg(read: ReadCtx): number {
  return read.hasData('handling' as never) ? (read.data('handling' as never) as { safeLoad: { value: number } }).safeLoad.value : 0;
}

/**
 * The dealer's van stops at the end of its road beyond the way in, by appointment: one of the holder's people the word
 * reaches, free and on the map, walks out to meet it and carries the tool back in (the nearest of them; there before the
 * dealer's day ends). Their name, or undefined when nobody can go.
 */
function meetAtRoadEnd(ctx: WriteCtx, id: EntityId, ext: EntityId, home: Vec2): string | undefined {
  if (!ctx.hasPort('workforce') || !ctx.hasData('labourSettings' as never)) return undefined;
  const m = machineAt(ctx, id);
  const md = model(ctx, m.model);
  const wf = ctx.port('workforce');
  const moves = ctx.port('moves');
  const routing = ctx.port('routing');
  const walk = (ctx.data('labourSettings' as never) as { ways: { walk: string } }).ways.walk;
  const close = ctx.calendar.startOfDay(ctx.now) + workingHours(ctx).to.value * HOUR;
  let best: { person: EntityId; at: Vec2; out: number } | undefined;
  for (const person of [...new Set([...wf.staff(m.holder), ...wf.members(m.holder)])].sort()) {
    if (ctx.get('Person', person)?.died || ctx.get('Presence', person)?.status !== 'available') continue;
    const place = moves.placeOf(person);
    if (!place?.at || place.on !== undefined || 'why' in wf.tell(m.holder, person)) continue;
    const out = routing.routeToExternal(place.at, ext, walk, { maxOffroad: SITE_OFFROAD });
    if (!out || !routing.routeFromExternal(ext, home, walk, { maxOffroad: SITE_OFFROAD }) || ctx.now + out.duration > close) continue;
    if (!best || out.duration < best.out) best = { person, at: place.at, out: out.duration };
  }
  if (!best) return undefined;
  const carrier = { class: walk, unit: best.person };
  const r = ctx.command('moves.dispatch', {
    legs: [
      { carrier, from: [best.at[0], best.at[1]], to: [best.at[0], best.at[1]], externalDestination: ext, loads: [], maxOffroad: SITE_OFFROAD },
      { carrier, from: [home[0], home[1]], to: [home[0], home[1]], externalNode: ext, loads: [{ machine: id, mass: md.operatingWeight.value }], notBefore: ctx.now + best.out + HANDOVER_S, maxOffroad: SITE_OFFROAD },
    ],
    purpose: 'delivery',
    ref: id,
    requester: EQUIPMENT_MODULE_ID,
  });
  if (!r.ok) return undefined;
  const { arrive } = span(ctx, r.value);
  update(ctx, id, { move: r.value, until: arrive }, ['deliveryTries']);
  const name = wf.name(best.person);
  ctx.blockers.set(id, [{ code: 'equipment.arriving', severity: 'info', params: { until: ctx.calendar.format(arrive) } }]);
  ctx.log('info', `The ${m.ownership === 'rented' ? 'hire firm' : 'dealer'}’s van cannot get onto the map: ${name} walks out to meet it at the end of its road (${ctx.get('NetNode', ext)?.external?.label ?? 'beyond the way in'}) and carries the ${md.label} back, there about ${ctx.calendar.format(arrive)}.`, [id]);
  return name;
}

/** a delivery called off before it came: the machine stays the dealer's or the hire firm's, nothing paid (it never was here) */
function callOff(ctx: WriteCtx, id: EntityId): void {
  dropServiceDue(ctx, id);
  setRepair(ctx, id, null);
  setTransport(ctx, id, null);
  ctx.emit('equipment.released', { machine: id });
  goesOut(ctx, id);
  ctx.destroy(id);
}

/**
 * A trailer towed by a vehicle of ours (a caravan behind the car): the car drives to it, hitches it and
 * tows it there, with a driver of ours in charge; the car burns its fuel and both arrive together.
 */
function tow(ctx: WriteCtx, id: EntityId, to: Vec2, by: EntityId | undefined): number {
  const m = machineAt(ctx, id);
  const md = model(ctx, m.model);
  const weight = md.operatingWeight.value;
  const can = (v: EntityId) => {
    const c = machineGet(ctx, v);
    // (a car its user may use: theirs, or lent to them)
    return c && equipmentPort(ctx).usableBy(v, userOf(ctx, id)) && v !== id && (model(ctx, c.model).tows?.value ?? 0) >= weight;
  };
  if (!by) {
    const remedies = [...ctx.all('Machine')].filter(([v]) => can(v)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([v, c]) => ({ label: `Tow it with the ${model(ctx, c.model).label}`, command: { type: 'equipment.moveTo', payload: { machine: id, to, by: v } } }));
    // or a haulier brings it on a low-loader (booked, paid by the hour)
    remedies.push({ label: `Have a haulier bring it on a low-loader`, command: { type: 'equipment.moveTo', payload: { machine: id, to, haulier: true } as never } });
    return ctx.reject('equipment.needsTow', { machine: md.label, weight }, remedies);
  }
  const car = machineGet(ctx, by);
  const cm = car ? model(ctx, car.model) : undefined;
  if (!car || !cm) return ctx.reject('equipment.unknownMachine', { machine: by });
  const haulier = { label: `Have a haulier bring it on a low-loader`, command: { type: 'equipment.moveTo', payload: { machine: id, to, haulier: true } as never } };
  if (!can(by)) return ctx.reject('equipment.cannotTow', { vehicle: cm.label, machine: md.label, why: car.holder !== m.holder ? 'it is not ours' : `it tows ${cm.tows?.value ?? 0} t at most, and this weighs ${weight} t` }, [haulier]);
  if (car.status !== 'ready' || car.setUp || withRider(ctx, by)) return ctx.reject('equipment.notReady', { machine: cm.label, status: car.status });
  const wf = ctx.port('workforce');
  const q = cm.operatorQualification;
  const found = driverFor(ctx, userOf(ctx, id), q, car.pos);
  if (!found) return ctx.reject('equipment.noDriver', { machine: cm.label, skill: q ? wf.qualification(q).label : 'driving it' });
  const driver = found.driver;
  const profile = cm.transport?.vehicleProfile;
  if (!profile) return ctx.reject('equipment.cannotTow', { vehicle: cm.label, machine: md.label, why: 'it does not drive' });
  const unit = carriage(ctx, by, false, profile).carrier;
  const legs = [
    ...found.walk,
    ...(Math.hypot(car.pos[0] - m.pos[0], car.pos[1] - m.pos[1]) > 1 ? [{ carrier: unit, from: [car.pos[0], car.pos[1]] as Vec2, to: [m.pos[0], m.pos[1]] as Vec2, maxOffroad: SITE_OFFROAD, inCharge: driver, loads: [] }] : []),
    { carrier: unit, from: [m.pos[0], m.pos[1]] as Vec2, to: [to[0], to[1]] as Vec2, maxOffroad: SITE_OFFROAD, inCharge: driver, loads: [{ machine: id, towed: true }] },
  ];
  const r = ctx.command('moves.dispatch', { legs, purpose: 'relocate', requester: EQUIPMENT_MODULE_ID });
  if (!r.ok) return ctx.reject('equipment.noRoute', { machine: md.label, reason: r.reasons.map((b) => ctx.formatBlocker(b)).join('; ') });
  const { arrive } = span(ctx, r.value);
  // the fuel for the drive (0002): burnt as the legs are done; a tank too low is said before setting out
  if (cm.engine) {
    const need = fuelPerHour(cm, 1) * ((arrive - ctx.now) / HOUR);
    if (fuelIn(ctx, by) + 1e-9 < need) return ctx.reject('equipment.noFuel', { machine: cm.label, need: Math.ceil(need * 10) / 10, have: Math.round(fuelIn(ctx, by) * 10) / 10 });
  }
  for (const v of [id, by]) update(ctx, v, { status: 'travelling', move: r.value, destination: [to[0], to[1]], until: arrive });
  return arrive;
}

/** of the way from a machine to a point, the point nearest to it that the machine can get to (it, or within `near` of it) */
function nearestReachable(ctx: ReadCtx, m: Machine & { pos: Vec2 }, to: Vec2, near: number): Vec2 {
  const md = model(ctx, m.model);
  const profile = md.transport?.vehicleProfile ?? ctx.data('equipmentSettings').toolCarrier;
  if (!profile) return to;
  const routing = ctx.port('routing');
  const d = Math.hypot(to[0] - m.pos[0], to[1] - m.pos[1]);
  for (let back = 0; back <= Math.min(near, d); back += 10) {
    const f = d > 0 ? back / d : 0;
    const q: Vec2 = [to[0] + (m.pos[0] - to[0]) * f, to[1] + (m.pos[1] - to[1]) * f];
    if (routing.route(m.pos, q, profile, { maxOffroad: SITE_OFFROAD })) return q;
  }
  return to;
}

/** how far from a machine its fitter may leave the service van and walk on (m) */
const FITTER_WALK = 300;

/** one of a tool's user's people by it (to look after it, mend it, service it: its holder's own work) */
function holderWith(ctx: ReadCtx, id: EntityId): boolean {
  if (!ctx.hasPort('workforce')) return true;
  const moves = ctx.port('moves');
  const at = moves.where(id);
  if (!at) return false;
  const near = ctx.data('labourSettings').ways.reach.value * 2;
  const wf = ctx.port('workforce');
  // (free by it; or sent to mend it and there, waiting by it)
  const mending = (p: EntityId) => {
    const on = moves.placeOf(p)?.on;
    const mv = on !== undefined ? ctx.get('Move', on) : undefined;
    // (there once their walk is done: the last leg is the stay by it; with no walk, there from the start: r39)
    return mv?.purpose === 'to mend' && mv.ref === id && (mv.legs.length === 1 || ctx.now >= mv.legs.at(-2)!.arrive);
  };
  return wf.staff(userOf(ctx, id)).some((p) => (moves.placeOf(p)?.on === undefined || mending(p)) && ((q) => q !== undefined && Math.hypot(q[0] - at[0], q[1] - at[1]) <= near)(moves.where(p)));
}

/** what a machine broken and mended by its holder waits for: one of theirs by it for the hours left, and how to send one */
function mendingSaid(ctx: WriteCtx, id: EntityId): void {
  const left = ctx.state('equipment').mending?.[id];
  if (left === undefined) return;
  const md = model(ctx, machineAt(ctx, id).model);
  const by = holderWith(ctx, id);
  ctx.blockers.set(id, [{ code: 'equipment.mending', severity: 'block', params: { machine: md.label, hours: left.toFixed(1), who: by ? 'being mended by one of its holder\'s there' : 'nobody of its holder\'s by it to mend it' }, remedies: by ? [] : [{ label: `Send someone to mend the ${md.label}`, command: { type: 'equipment.mend', payload: { machine: id } } }] }]);
}

/** a service begun where the machine stands: out for its hours, the wear parts paid */
function beginService(ctx: WriteCtx, id: EntityId): void {
  const payload = { machine: id };
  const m = machineAt(ctx, id);
  const md = model(ctx, m.model);
      const until = ctx.now + Math.round(engineOf(md).serviceDuration.value * HOUR);
      update(ctx, payload.machine, { status: 'servicing', until, hoursSinceService: 0 });
      if (m.ownership === 'owned') {
        // the visit, and the wear parts renewed for the hours since the last service
        const set = ctx.data('equipmentSettings');
        // the service is part of the repair cost: the wear of the hours since the last pays for it, a visit costs at least its price
        const wear = (set.wearShare.value * md.repairCostPerMonth.value * m.hoursSinceService) / set.repairBasisHours.value;
        const cost = Math.max((engineOf(md).serviceCost ?? set.serviceCost).value, wear) * index(ctx, ctx.now);
        // the hours run by those who borrowed it for nothing are theirs to pay (by their share of the hours), the rest its holder's
        const memo = `Service ${md.label} at ${m.engineHours.toFixed(0)} h (wear parts for ${m.hoursSinceService.toFixed(0)} h)`;
        shareOut(ctx, payload.machine, m, cost, memo, Object.fromEntries(Object.entries(m.ranBy ?? {}).map(([p0, h]) => [p0, Math.min(1, h / Math.max(1e-9, m.hoursSinceService))])), (p0) => `${(m.ranBy![p0]!).toFixed(0)} of the ${m.hoursSinceService.toFixed(0)} h theirs`);
      }
      ctx.at(until, 'serviceDone', { machine: payload.machine });
      ctx.blockers.set(payload.machine, [{ code: 'equipment.servicing', severity: 'info', params: { until: ctx.calendar.format(until) } }]);
      ctx.emit('equipment.serviceStarted', { machine: payload.machine, until });
      bumpTotals(ctx, { services: 1 });
}

/** beyond the map (r37): broken down and towed on, it arrives broken; run dry, it was filled up at a station there */
function beyondTheMap(ctx: WriteCtx, e: { move: EntityId; leg: number; why: string }): void {
  const leg = ctx.get('Move', e.move)?.legs[e.leg];
  const id = leg?.carrier.unit;
  const m = id ? machineGet(ctx, id) : undefined;
  if (!id || !m) return;
  const md = model(ctx, m.model);
  // (what it drove on this leg until here is burnt now; the leg's end burns only the rest: r38)
  burnSoFar(ctx, e.move, e.leg, id);
  if (/broke down beyond the map/.test(e.why)) {
    ctx.setState('equipment', { ...ctx.state('equipment'), towed: { ...(ctx.state('equipment').towed ?? {}), [id]: true } });
    ctx.log('warn', `${md.label} broke down beyond the map: a recovery service tows it on, broken.`, [id]);
  } else if (/ran dry beyond the map/.test(e.why) && m.tank && md.engine) {
    const material = fuelOf(md);
    const qty = md.engine.tankSize.value - fuelIn(ctx, id);
    const price = (ctx.port('trade').offers(material)[0]?.price ?? 0) * index(ctx, ctx.now) * qty;
    if (qty > 1e-6) ctx.command('inventory.fromOutside', { into: m.tank, material, qty, why: `${md.label}: filled up at a station beyond the map` });
    if (price > 0) ctx.ledger.post({ from: acct(userOf(ctx, id), ACCOUNTS.cash), to: acct(userOf(ctx, id), ACCOUNTS.fuel), amount: Math.round(price * 100) / 100, memo: `${md.label}: ${Math.round(qty)} l at a station beyond the map`, category: ACCOUNTS.fuel, refs: [id] });
  }
}

/** a leg's driving up to now, burnt now (on to a station, onto a tow truck) and kept so the leg's end burns only the rest */
function burnSoFar(ctx: WriteCtx, move: EntityId, legIdx: number, id: EntityId): void {
  const leg = ctx.get('Move', move)?.legs[legIdx];
  const key = `${move}:${legIdx}`;
  if (!leg) return;
  const stood = (leg.stops ?? []).filter((st) => st.at < ctx.now).reduce((a, st) => a + Math.min(ctx.now, st.until) - st.at, 0);
  const so = Math.max(0, ctx.now - leg.depart - stood) + (leg.drivenBefore ?? 0);
  const before = ctx.state('equipment').drove?.[key] ?? 0;
  const md = model(ctx, machineAt(ctx, id).model);
  if (so > before && md.engine) burn(ctx, id, fuelPerHour(md, 1) * ((so - before) / HOUR), `${md.label}: driven`);
  ctx.setState('equipment', { ...ctx.state('equipment'), drove: { ...(ctx.state('equipment').drove ?? {}), [key]: Math.max(so, before) } });
}

/** a leg's seconds driven not yet burnt (and its record gone) */
function droveRest(ctx: WriteCtx, move: EntityId, legIdx: number, seconds: number): number {
  const key = `${move}:${legIdx}`;
  const before = ctx.state('equipment').drove?.[key];
  if (before === undefined) return seconds;
  const { [key]: _k, ...drove } = ctx.state('equipment').drove ?? {};
  ctx.setState('equipment', { ...ctx.state('equipment'), drove });
  return Math.max(0, seconds - before);
}

/** how far from where it is wanted a machine is set down when its low-loader cannot get there (m) */
const DELIVERY_NEAR = 300;

/** maximum off-network distance plant may cross on site (m) */
const SITE_OFFROAD = 4000;
/** the tool handed over at the van's door: a signature, a look at it (s) */
const HANDOVER_S = 10 * 60;

/**
 * Someone of the party to drive a vehicle standing at `at`: present, on the map and on no other move, able to drive it,
 * the nearest first; with their walk to it when they are not by it (design/physical-state.md I2: nobody is at the
 * wheel but by going there).
 */
function driverFor(ctx: WriteCtx, party: EntityId, q: string | undefined, at: Vec2, only?: EntityId, told?: (x: EntityId) => boolean): { driver: EntityId; walk: LegRequest[] } | undefined {
  const wf = ctx.port('workforce');
  const moves = ctx.port('moves');
  const ways = ctx.data('labourSettings').ways;
  const near = wf
    .staff(party)
    // (not one held for another purpose, at the road for a driver: decision 0028, one owner of a person's time)
    .filter((x) => (only === undefined || x === only) && (!told || told(x)) && wf.present(x) && (!q || wf.canDo(x, q)) && moves.placeOf(x)?.on === undefined && moves.where(x) !== undefined && !wf.heldFrom(x, EQUIPMENT_MODULE_ID, party))
    .map((x) => ({ x, d: Math.hypot(moves.where(x)![0] - at[0], moves.where(x)![1] - at[1]) }))
    .sort((a, b) => a.d - b.d || (a.x < b.x ? -1 : 1))[0];
  if (!near) return undefined;
  const from = moves.where(near.x)!;
  return { driver: near.x, walk: near.d > ways.reach.value ? [{ carrier: { class: ways.walk, unit: near.x }, from: [from[0], from[1]], to: [at[0], at[1]], maxOffroad: SITE_OFFROAD, loads: [] }] : [] };
}

// ------------------------------------------------------------------ breakdown repairs (field service)

const hourOf = (ctx: ReadCtx, t: number) => (t - ctx.calendar.startOfDay(t)) / HOUR;

/** next working morning at or after t (within a week: a week of the data without a working day ends there) */
function nextServiceMorning(ctx: ReadCtx, t: number): number {
  const from = workingHours(ctx).from.value * HOUR;
  let day = ctx.calendar.startOfDay(t);
  if (isWorkingDay(ctx, day) && t <= day + from) return day + from;
  for (let i = 0; i < 7; i += 1) {
    day += DAY;
    if (isWorkingDay(ctx, day)) break;
  }
  return day + from;
}

/** when the fitter leaves the dealer for a call received at t */
function fitterDeparture(ctx: ReadCtx, t: number): number {
  const h = hourOf(ctx, t);
  const { from, cutoff } = workingHours(ctx);
  if (isWorkingDay(ctx, t) && h >= from.value - 1 && h < cutoff.value) return Math.max(t + FIELD_SERVICE_DISPATCH_S, ctx.calendar.startOfDay(t) + from.value * HOUR);
  return nextServiceMorning(ctx, t);
}

/** t plus `hours` of field-service working time (its working days, from its hour to its hour) */
function addServiceHours(ctx: ReadCtx, t: number, hours: number): number {
  const { from, to } = workingHours(ctx);
  let now = t;
  let left = hours * HOUR;
  for (let guard = 0; guard < 400 && left > 0; guard += 1) {
    if (!isWorkingDay(ctx, now) || hourOf(ctx, now) >= to.value || hourOf(ctx, now) < from.value) now = nextServiceMorning(ctx, now);
    const end = ctx.calendar.startOfDay(now) + to.value * HOUR;
    const step = Math.min(left, end - now);
    now += step;
    left -= step;
  }
  return Math.round(now);
}

/** working days → time: parts arrive at the dealer the morning `days` working days later */
function addWorkingDays(ctx: ReadCtx, t: number, days: number): number {
  let day = ctx.calendar.startOfDay(t);
  const want = Math.max(1, Math.round(days));
  // (a working day a week at least: a week of the data without one ends the count)
  for (let n = 0, i = 0; n < want && i < 7 * want; i += 1) {
    day += DAY;
    if (isWorkingDay(ctx, day)) n += 1;
  }
  return day + workingHours(ctx).from.value * HOUR;
}

function setRepair(ctx: WriteCtx, id: EntityId, job: RepairJob | null): void {
  const st = ctx.state('equipment');
  const { [id]: _old, ...rest } = st.repairs;
  ctx.setState('equipment', {
    ...st,
    repairs: job ? { ...rest, [id]: job } : rest,
  });
}

function repairBlocker(ctx: WriteCtx, id: EntityId, job: RepairJob): void {
  const when = job.next !== undefined ? ctx.calendar.format(job.next) : '?';
  const stage =
    job.stage === 'awaitingFitter'
      ? `fitter leaves the dealer ${when}`
      : job.stage === 'fitterTravelling'
        ? `fitter on the way, on site ${when}`
        : job.stage === 'awaitingParts'
          ? `waiting for parts, fitter returns ${when}`
          : `fitter repairing, done ${when}`;
  ctx.blockers.set(id, [{ code: 'equipment.broken', severity: 'block', params: { stage } }]);
}

function postRepair(ctx: WriteCtx, id: EntityId, amount: number, memo: string): void {
  const m = machineAt(ctx, id);
  if (m.ownership !== 'owned' || amount <= 0) return; // rented: the rental company repairs at its cost
  ctx.ledger.post({
    from: acct(m.holder, ACCOUNTS.cash),
    to: acct(m.holder, ACCOUNTS.equipmentRepair),
    amount: Math.round(amount * 100) / 100,
    memo: `Breakdown ${model(ctx, m.model).label}: ${memo}`,
    category: ACCOUNTS.equipmentRepair,
    refs: [id],
  });
}

/** the fitter sets off from the dealer (outside the map) to the machine */
function dispatchFitter(ctx: WriteCtx, id: EntityId): void {
  const st = ctx.state('equipment');
  const job = st.repairs[id];
  const m = machineGet(ctx, id);
  if (!job || !m) return;
  const svc = ctx.data('equipmentSettings').repairService;
  const ext = ctx.port('routing').externalNodes()[0];
  // (as near the machine as the van gets: the fitter walks the rest with the kit)
  const to = ext !== undefined ? (ctx.port('routing').approach(ext, m.pos, svc.vehicleProfile, FITTER_WALK, ctx.hasData('labourSettings') ? ctx.data('labourSettings').ways.walk : undefined, 'in', { maxOffroad: SITE_OFFROAD }) ?? m.pos) : m.pos;
  const r =
    ext !== undefined
      ? ctx.command('moves.dispatch', {
          // the dealer's service van with its fitter (the dealer's people are not on our map as persons)
          legs: [{ carrier: { class: svc.vehicleProfile }, from: [to[0], to[1]], to: [to[0], to[1]], externalNode: ext, maxOffroad: SITE_OFFROAD }],
          purpose: 'repair-call',
          ref: id,
          requester: EQUIPMENT_MODULE_ID,
        })
      : null;
  if (!r || !r.ok) {
    // the van cannot reach the machine: try again next working morning (the player can move the machine or build access)
    const retry = nextServiceMorning(ctx, ctx.now + HOUR);
    const next: RepairJob = { ...job, stage: 'awaitingFitter', next: retry };
    setRepair(ctx, id, next);
    ctx.at(retry, 'fitterDepart', { machine: id });
    ctx.blockers.set(id, [
      {
        code: 'equipment.fitterNoAccess',
        severity: 'block',
        params: {
          reason: r && !r.ok ? r.reasons.map((x) => ctx.formatBlocker(x)).join('; ') : 'no road connection to the region',
        },
      },
    ]);
    return;
  }
  const next: RepairJob = {
    ...job,
    stage: 'fitterTravelling',
    move: r.value,
    next: span(ctx, r.value).arrive,
    visits: job.visits + 1,
  };
  setRepair(ctx, id, next);
  postRepair(ctx, id, svc.calloutFee.value * index(ctx, ctx.now), `fitter call-out (visit ${next.visits})`);
  repairBlocker(ctx, id, next);
}

function fitterArrived(ctx: WriteCtx, id: EntityId): void {
  const job = ctx.state('equipment').repairs[id];
  if (!job || job.stage !== 'fitterTravelling') return;
  const svc = ctx.data('equipmentSettings').repairService;
  const price = index(ctx, ctx.now);
  if (job.parts && !job.partsOrdered) {
    // diagnose, order parts, drive back; return when the parts are in
    const leave = addServiceHours(ctx, ctx.now, DIAGNOSIS_H);
    const back = fitterDeparture(ctx, addWorkingDays(ctx, leave, svc.partsLeadTime.value));
    const next: RepairJob = {
      ...job,
      stage: 'awaitingParts',
      partsOrdered: true,
      next: back,
    };
    delete next.move;
    setRepair(ctx, id, next);
    postRepair(ctx, id, svc.fitterRate.value * price * DIAGNOSIS_H, `diagnosis ${DIAGNOSIS_H} h`);
    postRepair(ctx, id, partsCost(ctx, model(ctx, machineAt(ctx, id).model)) * price, 'parts ordered');
    ctx.at(leave, 'fitterLeave', { machine: id });
    ctx.at(back, 'fitterDepart', { machine: id });
    repairBlocker(ctx, id, next);
    ctx.log('warn', `${model(ctx, machineAt(ctx, id).model).label}: parts ordered — fitter returns ${ctx.calendar.format(back)}`, [id]);
    return;
  }
  const done = addServiceHours(ctx, ctx.now, job.hours);
  const next: RepairJob = { ...job, stage: 'repairing', next: done };
  delete next.move;
  setRepair(ctx, id, next);
  update(ctx, id, { until: done });
  ctx.at(done, 'repaired', { machine: id });
  repairBlocker(ctx, id, next);
}

/** the service van drives back to the dealer */
function fitterLeaves(ctx: WriteCtx, id: EntityId): void {
  const m = machineGet(ctx, id);
  const ext = ctx.port('routing').externalNodes()[0];
  if (!m || ext === undefined) return;
  const svc = ctx.data('equipmentSettings').repairService;
  ctx.command('moves.dispatch', {
    // (from where the van stands: as near the machine as it got)
    legs: [{ carrier: { class: svc.vehicleProfile }, ...((q) => ({ from: q, to: q }))(ctx.port('routing').approach(ext, m.pos, svc.vehicleProfile, FITTER_WALK, ctx.hasData('labourSettings') ? ctx.data('labourSettings').ways.walk : undefined, 'out', { maxOffroad: SITE_OFFROAD }) ?? m.pos), externalDestination: ext, maxOffroad: SITE_OFFROAD }],
    purpose: 'repair-call:return',
    ref: id,
    requester: EQUIPMENT_MODULE_ID,
  });
}

// ------------------------------------------------------------------ low-loader relocations

function setTransport(ctx: WriteCtx, id: EntityId, tr: LowLoaderTransport | null): void {
  const st = ctx.state('equipment');
  const { [id]: _old, ...rest } = st.transports;
  ctx.setState('equipment', {
    ...st,
    transports: tr ? { ...rest, [id]: tr } : rest,
  });
}

/** loaded run + approach + return, estimated from straight routes for the booking's ETA */
function lowLoaderEta(ctx: ReadCtx, id: EntityId, pickup: number, to: Vec2): number {
  const m = machineAt(ctx, id);
  const routing = ctx.port('routing');
  const ext = routing.externalNodes()[0];
  const prof = lowLoaderProfile(ctx);
  const approach =
    ext !== undefined
      ? routing.routeFromExternal(ext, m.pos, prof, {
          maxOffroad: SITE_OFFROAD,
        })
      : null;
  const loaded = routing.route(m.pos, to, prof, { maxOffroad: SITE_OFFROAD });
  const dur = (r: { stretches: { duration: number }[] } | null) => (r ? r.stretches.reduce((a, l) => a + l.duration, 0) : 0);
  // loaded, driven, then driven off the ramp: the low-loader's own unloading
  return pickup + dur(approach) + LOW_LOADER_HANDLING_H * 0.5 * HOUR + dur(loaded) + ctx.port('moves').unloadTime(prof, model(ctx, m.model).operatingWeight.value);
}

/** when a move departs and when it arrives at the end of its last leg */
function span(ctx: ReadCtx, move: EntityId): { depart: number; arrive: number } {
  const m = ctx.require('Move', move);
  return { depart: m.legs[0]!.depart, arrive: m.legs.at(-1)!.arrive };
}

const moveHours = (ctx: ReadCtx, move: EntityId): number => (span(ctx, move).arrive - span(ctx, move).depart) / HOUR;

/**
 * How a machine travels (decision 0026, a carrier carried): on a low-loader as its load, or under its
 * own power as the carrier of the leg.
 */
function carriage(ctx: ReadCtx, id: EntityId, onLowLoader: boolean, own: string): { carrier: Carrier; loads: Load[] } {
  return onLowLoader ? { carrier: { class: lowLoaderProfile(ctx) }, loads: [{ machine: id, mass: model(ctx, machineAt(ctx, id).model).operatingWeight.value }] } : { carrier: { class: own, unit: id }, loads: [] };
}

function chargeHaulier(ctx: WriteCtx, id: EntityId, hours: number, memo: string, payer?: EntityId): void {
  // (whoever booked it pays: its user then)
  const holder = payer ?? ctx.state('equipment').transports[id]?.payer ?? userOf(ctx, id);
  ctx.ledger.post({
    from: acct(holder, ACCOUNTS.cash),
    to: acct(holder, ACCOUNTS.transport),
    amount: Math.round(lowLoaderRate(ctx) * index(ctx, ctx.now) * hours * 100) / 100,
    memo: `${memo}: low-loader ${hours.toFixed(1)} h`,
    category: ACCOUNTS.transport,
    refs: [id],
  });
}

function bookLowLoader(ctx: WriteCtx, id: EntityId, to: Vec2): number {
  const routing = ctx.port('routing');
  const ext = routing.externalNodes()[0];
  if (ext === undefined) ctx.reject('equipment.noRoute', { machine: id, reason: 'no road connection for a low-loader haulier' });
  // the haulier must be able to reach the machine and the destination — checked before booking
  const pos = machineAt(ctx, id).pos;
  const prof = lowLoaderProfile(ctx);
  if (!routing.routeFromExternal(ext, pos, prof, { maxOffroad: SITE_OFFROAD })) ctx.reject('equipment.noRoute', { machine: id, reason: 'a low-loader cannot reach the machine' });
  if (!routing.route(pos, to, prof, { maxOffroad: SITE_OFFROAD })) ctx.reject('equipment.noRoute', { machine: id, reason: 'no low-loader route to the destination' });
  const lead = ctx.data('equipmentSettings').lowLoaderLeadTime.value;
  const pickup = nextServiceMorning(ctx, addWorkingDays(ctx, ctx.now, lead) - workingHours(ctx).from.value * HOUR);
  const eta = lowLoaderEta(ctx, id, pickup, to);
  setTransport(ctx, id, { stage: 'booked', pickup, to: [to[0], to[1]], eta, payer: userOf(ctx, id) });
  ctx.at(pickup, 'lowLoaderDepart', { machine: id });
  update(ctx, id, { status: 'travelling', destination: [to[0], to[1]], until: eta }, ['move']);
  ctx.blockers.set(id, [
    {
      code: 'equipment.lowLoaderBooked',
      severity: 'info',
      params: { pickup: ctx.calendar.format(pickup) },
    },
  ]);
  ctx.log('info', `Low-loader booked for ${model(ctx, machineAt(ctx, id).model).label} — haulier comes ${ctx.calendar.format(pickup)}`, [id]);
  return eta;
}

/** how much more often a machine breaks down for being overdue for service (1 within its interval) */
function careHazard(set: { overdueHazard: { value: number } }, engine: { serviceInterval: { value: number } }, hoursSinceService: number): number {
  return 1 + set.overdueHazard.value * Math.max(0, hoursSinceService / engine.serviceInterval.value - 1);
}

/** what the cost list's repair cost leaves for each breakdown, after the wear renewed at services (EUR at base prices) */
function perBreakdown(ctx: ReadCtx, md: MachineModel): number {
  const set = ctx.data('equipmentSettings');
  return md.engine ? ((1 - set.wearShare.value) * md.repairCostPerMonth.value * md.engine.mtbf.value) / set.repairBasisHours.value : 0;
}

/** the field service's time on a breakdown, on average: a call-out and the repair, and for one needing parts a second call-out and the diagnosis (EUR at base prices) */
function fieldTime(ctx: ReadCtx, md: MachineModel): number {
  const svc = ctx.data('equipmentSettings').repairService;
  const e = md.engine!;
  return svc.calloutFee.value + svc.fitterRate.value * e.mttr.value + svc.partsShare.value * (svc.calloutFee.value + svc.fitterRate.value * DIAGNOSIS_H);
}

/** the ordered parts of a breakdown needing them: what is left per breakdown after the fitter's time (EUR at base prices) */
function partsCost(ctx: ReadCtx, md: MachineModel): number {
  if (!md.engine) return 0;
  return Math.max(0, (perBreakdown(ctx, md) - fieldTime(ctx, md)) / ctx.data('equipmentSettings').repairService.partsShare.value);
}

/**
 * The administrator's machines (insolvency proceedings opened): hired ones go back, owned ones are offered at
 * what an administrator asks to sell quickly. Done at the opening and each day after for what was away,
 * broken, set up or arriving then; what cannot go yet is said once, at the opening.
 */
function windUp(ctx: WriteCtx, party: EntityId, first: boolean): void {
  const share = ctx.hasData('insolvencyLaw') ? (ctx.data('insolvencyLaw')?.liquidationShare.value ?? 1) : 1;
  const notYet: string[] = [];
  for (const [id, m] of [...ctx.all('Machine')]) {
    if (m.holder !== party) continue;
    const label = model(ctx, m.model).label;
    if (m.status === 'travelling' || m.status === 'arriving') {
      notYet.push(`${label} (on its way: dealt with when it is here)`);
      continue;
    }
    const to = lentTo(ctx, id);
    if (to) {
      notYet.push(`${label} (lent to ${partyLabel(ctx, to)}: dealt with when it is back)`);
      continue;
    }
    if (m.ownership !== 'owned') {
      const r = ctx.command('equipment.release', { machine: id });
      if (!r.ok) notYet.push(`${label} (hired: ${r.reasons.map((b) => ctx.formatBlocker(b)).join('; ')})`);
      continue;
    }
    // (a buyer coming takes it; offered already at what the administrator would ask, or less, it stays so)
    const ask = ctx.hasPort('usedPlant') && m.status !== 'broken' ? Math.max(1, Math.round(ctx.port('usedPlant').value(id).value * share)) : undefined;
    if (m.listing && (m.listing.buyer || ask === undefined || m.listing.ask <= ask)) continue;
    if (m.status === 'broken') notYet.push(`${label} (broken: offered once repaired${ctx.blockersOf(id).some((b) => b.code === 'equipment.wrecked') ? '; a wreck is not' : ''})`);
    else if (m.setUp) notYet.push(`${label} (set up: offered once packed up)`);
    else if (!ctx.hasPort('usedPlant')) notYet.push(`${label} (no market for it)`);
    else {
      const r = ctx.command('equipment.sell', { machine: id, ask: ask! });
      if (!r.ok) notYet.push(`${label} (${r.reasons.map((b) => ctx.formatBlocker(b)).join('; ')})`);
    }
  }
  if (first && notYet.length) ctx.log('warn', `The administrator cannot deal with every machine of ${partyLabel(ctx, party)} yet: ${notYet.join('; ')}.`, [party]);
}

function breakDown(ctx: WriteCtx, id: EntityId): void {
  const m = machineAt(ctx, id);
  const md = model(ctx, m.model);
  // nobody buys a machine on jacks: off the market until it is repaired (a buyer already coming takes it as it is)
  if (m.listing && !m.listing.buyer) {
    update(ctx, id, {}, ['listing']);
    forgetBuyer(ctx, id);
    ctx.log('warn', `${md.label} has broken down: taken off the market until it is repaired (offer it again then).`, [id]);
  }
  const svc = ctx.data('equipmentSettings').repairService;
  const rng = ctx.rng('repair');
  const hours = Math.min(REPAIR_MAX_H, Math.max(REPAIR_MIN_H, rng.exponential(engineOf(md).mttr.value)));
  // mended by its holder (or taken to a workshop): out for the repair time, billed what the cost list leaves per breakdown
  // (its hours are done by one of theirs by it, an hour at a time: nobody there, nothing mended: r38)
  if (engineOf(md).repairBy === 'holder' && m.ownership === 'owned') {
    postRepair(ctx, id, perBreakdown(ctx, md) * index(ctx, ctx.now), `mended by its holder (${hours.toFixed(1)} h, parts)`);
    ctx.setState('equipment', { ...ctx.state('equipment'), mending: { ...(ctx.state('equipment').mending ?? {}), [id]: hours } });
    mendingSaid(ctx, id);
    ctx.at(ctx.now + HOUR, 'mended', { machine: id });
    ctx.emit('equipment.brokeDown', { machine: id });
    ctx.log('warn', `${md.label} broke down: one of its holder's mends it where it stands (about ${hours.toFixed(1)} h of work by it).`, [id]);
    return;
  }
  const parts = rng.chance(svc.partsShare.value);
  const depart = fitterDeparture(ctx, ctx.now);
  const job: RepairJob = {
    stage: 'awaitingFitter',
    brokeAt: ctx.now,
    hours,
    parts,
    visits: 0,
    next: depart,
  };
  setRepair(ctx, id, job);
  ctx.at(depart, 'fitterDepart', { machine: id });
  repairBlocker(ctx, id, job);
  ctx.emit('equipment.brokeDown', { machine: id });
  ctx.log('warn', `${md.label} broke down — ${m.ownership === 'owned' ? 'dealer' : 'rental company'} field service called, fitter leaves ${ctx.calendar.format(depart)}`, [id]);
}

export const equipmentModule = defineModule({
  id: EQUIPMENT_MODULE_ID,
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Agreement', 'Employment', 'Helper', 'Move', 'NetNode', 'Party', 'Person', 'Presence', 'Tenure'],
  commandDocs: {
    "equipment.logWork": {
      internal: true,
    },
    "equipment.acquire": {
      description:
        'Buy (ownership "owned": purchase price leaves cash, monthly depreciation and interest accrue) or rent (ownership "rented": day rate on workdays, delivered by low-loader after the rental lead time) a machine model at a position.',
    },
    "equipment.release": {
      description: 'Sell an owned machine at book value, or return a rented machine (off-hire transport is charged).',
    },
    "equipment.moveTo": {
      description: 'Drive a ready machine to a point; tracked plant going further than 2 km is moved by low-loader at a transport charge.',
    }
  },
  label: 'Equipment',
  description: 'Machines: ownership/rental cost, hours, fuel, service, stochastic breakdowns, relocation.',
  provides: ['equipment'],
  // 'prices' is provided by the economy module, which also opens the ledger accounts used here
  requires: ['prices', 'parties', 'routing', 'moves', 'holdings', 'trade'],
  optional: ['workforce'],
  // another party's machine is seen (what it is, where, whose), not its tank, its hours or its books
  observe: { Machine: (v: Machine, viewer: EntityId, read: ReadCtx, id: EntityId) => (v.holder === viewer || lentTo(read, id) === viewer ? v : { model: v.model, holder: v.holder, status: v.status }) },
  components: { Machine: MachineSchema },
  data: { equipmentClasses: s.record(EquipmentClassSchema), machineModels: s.record(MachineModelSchema), equipmentSettings: EquipmentSettingsSchema },
  state: {
    initial: (): EquipmentState => ({ buyers: {}, serviceDue: {}, repairs: {}, transports: {}, totals: { engineHours: 0, fuelLitres: 0, breakdowns: 0, services: 0 } }),
  },
  events: {
    'equipment.acquired': s.object({ machine: s.ref('machine'), model: s.string() }),
    'equipment.arrived': s.object({ machine: s.ref('machine') }),
    'equipment.brokeDown': s.object({ machine: s.ref('machine') }),
    'equipment.repaired': s.object({ machine: s.ref('machine') }),
    'equipment.serviceStarted': s.object({ machine: s.ref('machine'), until: s.number() }),
    'equipment.serviceDone': s.object({ machine: s.ref('machine') }),
    'equipment.released': s.object({ machine: s.ref('machine') }),
    'equipment.sold': s.object({ machine: s.ref('machine'), price: s.number({ unit: 'EUR' }) }),
    'equipment.legalExposure': s.object({ person: s.ref('person'), party: s.ref('party'), what: s.string(), rule: s.string() }),
  },
  blockers: {
    'equipment.noWord': 'We cannot get a {model}: {why}',
    'equipment.unknownModel': 'Unknown machine model {model}',
    'equipment.notRidden': 'The {machine} is not a vehicle one rides to work',
    'equipment.notTheirs': '{person} is not one of {party}: the {machine} is theirs',
    'equipment.unknownMachine': 'Unknown machine {machine}',
    'equipment.noFunds': 'Not enough liquidity to buy {model} for {price} EUR (available {liquidity} EUR)',
    'equipment.notReady': '{machine} is not ready ({status})',
    'equipment.noRoute': 'Cannot move {machine}: {reason}',
    'equipment.isSetUp': 'The {machine} is set up where it stands: pack it up first',
    'equipment.noFundsToHire': 'The hire firm will not deliver the {model}: {days} days of hire ({cover} EUR) are not there (available {liquidity} EUR, of it {committed} EUR held for what is hired or bought and on its way)',
    'equipment.wrecked': 'The {machine} is a wreck: {why}',
    'equipment.needsTow': 'The {machine} ({weight} t) moves behind a vehicle that can tow it',
    'equipment.cannotTow': 'The {vehicle} cannot tow the {machine}: {why}',
    'equipment.offMap': 'Cannot move the {machine} to {at}: that is off the map (the world beyond is reached by a way out)',
    'equipment.immediateIsSetup': 'A {model} cannot appear at once: that is how a world is set up, not how one is bought. Without `immediate` it is delivered after the dealer’s or rental company’s lead time',
    'equipment.broken': 'Broken down — {stage}',
    'equipment.noFuel': '{machine}: {need} l needed, {have} l in the tank',
    'equipment.notAGenerator': '{machine} makes no electricity',
    'equipment.nobodyAtIt': 'nobody of {party} is at the {machine} to start it: one of ours has to go there',
    'equipment.lowLoaderBooked': 'Low-loader booked — haulier sets off {pickup}',
    'equipment.lowLoaderComing': 'Low-loader on the way, loading at {at}',
    'equipment.lowLoaderNoAccess': 'The low-loader cannot reach the machine; the haulier retries {retry}',
    'equipment.offHired': '{machine} is off-hired: the hire firm collects it {at}',
    'equipment.deliveryNoAccess': 'It cannot be brought ({reason}); {firm} tries again {retry} ({left} more times, then it is called off)',
    'equipment.fitterNoAccess': 'Broken down — the service van cannot reach the machine ({reason}); retrying next working morning',
    'equipment.lent': '{machine} is lent to {to}: ask for it back first (agreements.notice)',
    'equipment.servicing': 'In service until {until}',
    'equipment.refuelling': 'Being topped up with fuel, back at work {until}',
    'equipment.mending': '{machine} is broken, about {hours} h of mending left: {who}',
    'equipment.nobodyToMend': 'Nobody of {party} free to go and mend the {machine}',
    'equipment.arriving': 'Delivery expected {until}',
    'equipment.sellOwned': '{machine} is ours: sell it on the used-plant market (equipment.sell) instead of giving it away',
    'equipment.notOwned': '{machine} is rented: return it to the rental company (equipment.release)',
    'equipment.noMarket': 'There is no used-plant market in this world',
    'equipment.cannotSell': '{machine} cannot be sold now ({status})',
    'equipment.notListed': '{machine} is not offered for sale',
    'equipment.notOurs': '{machine} is not held by {party}',
    'equipment.wornOut': '{machine} is worn out',
    'equipment.notTold': 'The word does not reach {person}, who could take it: {why}',
    'equipment.notTowed': 'The {machine} is not towed by the {by}: only a trailer goes behind another',
    'equipment.fitterCannotCome': 'The dealer’s fitter cannot get to the {machine} for its service: {why}',
    'equipment.noDriver': 'Nobody free to drive the {machine} ({skill}): everyone able is at work, away or missing',
    'equipment.notForHire': 'Nobody rents out {model}',
    'equipment.forSale': 'For sale at {ask} € (market value {value} €); {when}',
    'equipment.offered': 'A buyer offers {price} € (asked {ask} €), standing until {until}',
    'equipment.noOffer': 'No buyer’s offer stands for {machine}',
  },
  commands: {
    'equipment.acquire': command(
      s.object({ model: s.string(), ownership: s.enum(['owned', 'rented']), pos: s.point(), immediate: s.boolean().optional(), holder: s.ref('party').optional() }),
      (ctx: WriteCtx, p) => {
        const md = ctx.data('machineModels')[p.model];
        if (!md) ctx.reject('equipment.unknownModel', { model: p.model });
        if (p.ownership === 'rented' && !md!.rentalPerDay) ctx.reject('equipment.notForHire', { model: md!.label });
        const setup = p.immediate && (ctx.caller !== 'client' || ctx.trusted);
        // a machine already there is world setup (a starter's fleet); in play it is delivered (decision 0002)
        if (p.immediate && !setup) ctx.reject('equipment.immediateIsSetup', { model: md!.label });
        // a player acquires for its own party; a starter sets machines up for the party it equips
        const holder = setup && p.holder ? p.holder : actorOf(ctx);
        if (p.holder && p.holder !== holder) ctx.reject('equipment.notOurs', { machine: md.label, party: partyLabel(ctx, holder) });
        // (bought or hired: word to the dealer or the hire firm, S4)
        const noWord = setup ? undefined : wordBlock(ctx, holder);
        if (noWord) ctx.reject('equipment.noWord', { model: md!.label, why: noWord.why }, noWord.remedies);
        const id = ctx.spawn('machine', { name: md.label });
        const base: Machine = {
          model: p.model,
          holder,
          ownership: p.ownership,
          acquiredAt: ctx.now,
          engineHours: 0,
          hoursSinceService: 0,
          status: 'ready',
        };
        if (p.ownership === 'owned') {
          const price = round2(md.purchasePrice.value * index(ctx, ctx.now));
          const prices = ctx.hasPort('prices') ? ctx.port('prices') : null;
          // what is already ordered and not yet paid counts against the money too
          let committed = 0;
          for (const [, x] of ctx.all('Machine')) if (x.holder === holder) committed += x.pendingPrice ?? 0;
          if (prices && !prices.canSpend(holder, price + committed)) ctx.reject('equipment.noFunds', { model: md.label, price, liquidity: Math.round(prices.liquidity(holder) - committed) });
          if (setup) {
            // scenario setup only: a machine of the party already on site at the start
            ctx.ledger.post({ from: acct(holder, ACCOUNTS.cash), to: acct(holder, ACCOUNTS.fixedAssets), amount: price, memo: `Purchase ${md.label}`, category: ACCOUNTS.fixedAssets, refs: [id] });
            writeMachine(ctx, id, { ...base, bookValue: price });
          } else {
            // ordered from a dealer: delivered after the lead time, paid on delivery
            const set = ctx.data('equipmentSettings');
            const lead = (md.purchaseLeadTime ?? (md.engine || md.transport ? set.purchaseLeadTime : set.toolLeadTime)).value * DAY;
            const departAt = Math.max(ctx.now, ctx.calendar.startOfDay(ctx.now + lead) + DELIVERY_DEPART_HOUR * HOUR);
            writeMachine(ctx, id, { ...base, status: 'arriving', until: departAt, destination: [p.pos[0], p.pos[1]], pendingPrice: price });
            ctx.at(departAt, 'deliver', { machine: id });
            ctx.blockers.set(id, [{ code: 'equipment.arriving', severity: 'info', params: { until: ctx.calendar.format(departAt) } }]);
          }
        } else if (setup) {
          // scenario setup only: a machine already on site at game start (players always wait for delivery)
          writeMachine(ctx, id, base);
        } else {
          // the hire firm checks our money first: the first days of hire must be there (H1: no fleet hired at any debt)
          const prices = ctx.hasPort('prices') ? ctx.port('prices') : null;
          const days = ctx.data('equipmentSettings').rentalCover.value;
          const cover = round2(md.rentalPerDay!.value * index(ctx, ctx.now) * days);
          // what is already hired and on its way, and bought and not yet paid, counts against the money too
          let committed = 0;
          for (const [, x] of ctx.all('Machine')) {
            if (x.holder !== holder) continue;
            committed += x.pendingPrice ?? 0;
            const xm = model(ctx, x.model);
            if (x.ownership === 'rented' && x.status === 'arriving' && xm.rentalPerDay) committed += xm.rentalPerDay.value * index(ctx, ctx.now) * days;
          }
          if (prices && !prices.canSpend(holder, cover + committed)) ctx.reject('equipment.noFundsToHire', { model: md.label, cover, days, committed: Math.round(committed), liquidity: Math.round(prices.liquidity(holder)) }, ctx.contributions('financing').flatMap((c) => c.impl(ctx, holder, Math.ceil(cover + committed - prices.liquidity(holder)))));
          const lead = ctx.data('equipmentSettings').rentalLeadTime.value * DAY;
          const departAt = Math.max(ctx.now, ctx.calendar.startOfDay(ctx.now + lead) + DELIVERY_DEPART_HOUR * HOUR);
          writeMachine(ctx, id, { ...base, status: 'arriving', until: departAt, destination: [p.pos[0], p.pos[1]] });
          ctx.at(departAt, 'deliver', { machine: id });
          ctx.blockers.set(id, [{ code: 'equipment.arriving', severity: 'info', params: { until: ctx.calendar.format(departAt) } }]);
        }
        // its tank, full: one already there is the world's definition; one delivered comes filled by the dealer or the
        // hire firm, over the world's edge (in its price)
        // where it is: on the site when the world is made; else at the dealer's or the hire firm's, beyond the map, until its
        // delivery brings it in (design/physical-state.md I2)
        const ext = ctx.port('routing').externalNodes()[0];
        if (setup) ctx.command('moves.place', { unit: id, at: [p.pos[0], p.pos[1]] });
        else if (ext !== undefined) ctx.command('moves.place', { unit: id, beyond: ext });
        else ctx.reject('equipment.noRoute', { machine: md.label, reason: 'no way into the map for its delivery' });
        // its battery, charged as shipped
        const battery = batteryFor(ctx, id, md, holder, p.pos, Boolean(setup));
        if (battery) update(ctx, id, { battery });
        indexPowered(ctx, id, md, true);
        const tank = tankFor(ctx, id, md, holder, p.pos);
        if (tank) {
          update(ctx, id, { tank });
          const full = { material: fuelOf(md), qty: md.engine!.tankSize.value, why: `the tank of the ${md.label}` };
          const r = setup ? ctx.command('inventory.genesis', { store: tank, ...full }) : ctx.command('inventory.fromOutside', { into: tank, ...full });
          if (!r.ok) throw new Error(`filling the tank of ${md.label}: ${JSON.stringify(r.reasons)}`);
        }
        ctx.emit('equipment.acquired', { machine: id, model: p.model });
        const m = machineAt(ctx, id);
        const rent = Math.round((md.rentalPerDay?.value ?? 0) * index(ctx, ctx.now));
        ctx.log('info', p.ownership === 'owned' ? (m.status === 'arriving' ? `Ordered ${md.label} from the dealer: delivered from ${ctx.calendar.format(m.until!, 'day')}, ${Math.round(m.pendingPrice!)} € paid on delivery` : `Bought ${md.label}`) : m.status === 'arriving' ? `Rented ${md.label}: the rental company delivers it from ${ctx.calendar.format(m.until!, 'day')} (${rent} € a working day from its arrival until it is returned)` : `Rented ${md.label} (${rent} € a working day)`, [id]);
        return id;
      },
      { label: 'Buy or rent a machine', description: 'Buy a new machine from a dealer (delivered after the lead time, paid on delivery; refused when the money, counting what is already ordered, is not there) or rent one (delivered after the rental lead time, paid per working day until returned).' },
    ),
    'equipment.mend': command(
      s.object({ machine: s.ref('machine') }),
      (ctx: WriteCtx, p) => {
        const m = machineGet(ctx, p.machine);
        if (!m) ctx.reject('equipment.unknownMachine', { machine: p.machine });
        mustUse(ctx, p.machine);
        const md = model(ctx, m.model);
        if (m.status !== 'broken' || ctx.state('equipment').mending?.[p.machine] === undefined) ctx.reject('equipment.notReady', { machine: md.label, status: m.status === 'broken' ? 'mended by the field service' : 'not broken' });
        const pos = ctx.port('moves').where(p.machine);
        if (!pos) ctx.reject('equipment.notReady', { machine: md.label, status: 'beyond the map' });
        const party = userOf(ctx, p.machine);
        // (a player's word reaches whoever goes: within hearing of the one in charge, or by phone: r39)
        const wf = ctx.port('workforce');
        const told = ctx.caller === 'client' ? (x: EntityId) => !('why' in wf.tell(party, x)) : undefined;
        const found = driverFor(ctx, party, undefined, pos, undefined, told);
        if (!found) {
          const anyone = told && driverFor(ctx, party, undefined, pos);
          if (anyone) {
            const t = wf.tell(party, anyone.driver);
            return ctx.reject('equipment.notTold', { person: wf.name(anyone.driver), why: 'why' in t ? t.why : '' }, 'why' in t && t.walk ? [{ label: `Walk over to ${wf.name(anyone.driver)}`, command: { type: 'workforce.goTo', payload: { person: anyone.driver } } }] : []);
          }
          return ctx.reject('equipment.nobodyToMend', { party: partyLabel(ctx, party), machine: md.label });
        }
        // (there, they stay by it for the hours of mending left: the last leg waits where it stands)
        const there = found.walk.length ? ctx.port('routing').route(found.walk[0]!.from, pos, ctx.data('labourSettings').ways.walk, { maxOffroad: SITE_OFFROAD }) : null;
        const reach = ctx.now + (there?.duration ?? 0);
        const left = ctx.state('equipment').mending![p.machine]!;
        const stay = { carrier: { class: ctx.data('labourSettings').ways.walk, unit: found.driver }, from: [pos[0], pos[1]] as Vec2, to: [pos[0], pos[1]] as Vec2, maxOffroad: SITE_OFFROAD, loads: [], notBefore: reach + left * HOUR };
        const r = ctx.command('moves.dispatch', { legs: [...found.walk, stay], purpose: 'to mend', ref: p.machine, requester: EQUIPMENT_MODULE_ID });
        if (!r.ok) return ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
        ctx.blockers.clear(p.machine);
        mendingSaid(ctx, p.machine);
        return ctx.require('Move', r.value as EntityId).legs[0]!.arrive;
      },
      { label: 'Send someone to mend a machine', description: 'The nearest free person of the machine’s holder walks to where it stands; its mending goes on while one of theirs is by it.' },
    ),
    'equipment.release': command(
      s.object({ machine: s.ref('machine') }),
      (ctx: WriteCtx, p) => {
        const m = machineGet(ctx, p.machine);
        if (!m) ctx.reject('equipment.unknownMachine', { machine: p.machine });
        mustHold(ctx, p.machine);
        if (m.status === 'travelling') ctx.reject('equipment.notReady', { machine: p.machine, status: m.status });
        if (withRider(ctx, p.machine)) ctx.reject('equipment.notReady', { machine: p.machine, status: 'away with the one who rode it to work' });
        // (on a move, a round, a drive: handed back where it stops, not from under its load: r38)
        const on = ctx.port('moves').placeOf(p.machine)?.on;
        if (on !== undefined && ctx.get('Move', on)) {
          const back = ctx.require('Move', on).legs.at(-1)!.arrive;
          ctx.reject('equipment.notReady', { machine: p.machine, status: `on its way until ${ctx.calendar.format(back)}` }, [{ label: `Wait until ${ctx.calendar.format(back)}`, wait: { until: back } }]);
        }
        const md = model(ctx, m.model);
        // (one of our own is sold; one still to come is called off, nothing paid)
        if (m.ownership === 'owned' && m.status !== 'arriving') ctx.reject('equipment.sellOwned', { machine: md.label });
        if (m.status === 'offHired') ctx.reject('equipment.notReady', { machine: p.machine, status: 'off-hired, to be collected' });
        if (m.status !== 'arriving') {
          // off-hire is a notice in the hire firm's hours (Freimeldung, G11): the rent stops with it, its day charged (by the
          // day's rental run, as every day of hire: hireDayOwed); given after hours it counts from the next working morning,
          // and the evening's day is a day of hire too. The firm collects it on its next service morning (a real carrier on
          // the roads), until then it stands where it is, not ours to use; nobody can come for it: it stays, and the hire with it
          const ext = ctx.port('routing').externalNodes()[0];
          const carrier = carriage(ctx, p.machine, Boolean(md.transport?.needsLowLoader), profileOf(md)).carrier;
          if (ext === undefined || !ctx.port('routing').routeToExternal([m.pos[0], m.pos[1]], ext, carrier.class, { maxOffroad: SITE_OFFROAD })) ctx.reject('equipment.noRoute', { machine: md.label, reason: `the hire firm cannot come for it here (no way for its ${ctx.port('routing').profile(carrier.class).label})` });
          const notice = isWorkingDay(ctx, ctx.now) && hourOf(ctx, ctx.now) < workingHours(ctx).to.value ? ctx.now : nextServiceMorning(ctx, ctx.now);
          const collect = nextServiceMorning(ctx, notice + HOUR);
          // (broken down, no day of hire is owed while it is, as the day's run says: the hire ends with the day before)
          update(ctx, p.machine, { status: 'offHired', until: collect, hireEnds: m.status === 'broken' ? ctx.calendar.startOfDay(ctx.now) - 1 : notice });
          // (whoever rode it to work does not any more: it is the hire firm's)
          dropRiders(ctx, p.machine);
          ctx.at(collect, 'offHireCollect', { machine: p.machine });
          ctx.blockers.set(p.machine, [{ code: 'equipment.offHired', severity: 'info', params: { machine: md.label, at: ctx.calendar.format(collect) } }]);
          ctx.log('info', `${md.label} off-hired: the rent stops; the hire firm collects it ${ctx.calendar.format(collect)}.`, [p.machine]);
          return;
        }
        dropServiceDue(ctx, p.machine);
        setRepair(ctx, p.machine, null);
        setTransport(ctx, p.machine, null);
        ctx.emit('equipment.released', { machine: p.machine });
        goesOut(ctx, p.machine);
        ctx.destroy(p.machine);
      },
      { label: 'Return a rented machine (off-hire)', description: 'The rental company collects it; the rent stops (the day of off-hire is charged). Machines of our own are sold instead (equipment.sell).' },
    ),
    'equipment.logWork': command(
      s.object({ machine: s.ref('machine'), hours: s.number({ min: 0, max: 24, unit: 'h' }), load: s.number({ min: 0, max: 1 }) }),
      (ctx: WriteCtx, p) => {
        const m = machineGet(ctx, p.machine);
        if (!m) ctx.reject('equipment.unknownMachine', { machine: p.machine });
        if (m.status !== 'ready') ctx.reject('equipment.notReady', { machine: p.machine, status: m.status });
        if (p.hours <= 0) return;
        const md = model(ctx, m.model);
        const set = ctx.data('equipmentSettings');
        // fuel comes out of the machine's tank (filled nightly from the yard's stock, which is bought);
        // a machine cannot work hours it has no fuel for
        const litres = md.engine ? md.engine.fuelUse.value * p.hours * fuelFactor(p.load) : 0;
        if (litres > fuelIn(ctx, p.machine) + 0.5) ctx.reject('equipment.noFuel', { machine: md.label, need: Math.round(litres), have: Math.round(fuelIn(ctx, p.machine)) });
        burn(ctx, p.machine, litres, `${md.label}: ${p.hours.toFixed(2)} h of work`);
        // (repairs are billed as they happen: at the service and at a breakdown; the cost list's repair cost is for planning)
        const hoursSinceService = m.hoursSinceService + p.hours;
        let next: Partial<Machine> = { engineHours: m.engineHours + p.hours, hoursSinceService, lastActive: ctx.now };
        // stochastic failure of an engine: exponential time-to-failure in operating hours, more often the longer it is overdue for service
        let broke = false;
        if (md.engine && ctx.rng('breakdown').chance(1 - Math.exp(-(p.hours * careHazard(set, md.engine, m.hoursSinceService + p.hours / 2)) / md.engine.mtbf.value))) {
          next = { ...next, status: 'broken' };
          broke = true;
        }
        // a tool wears by use: worn out at the end of its life
        const wornOut = Boolean(md.wear && m.engineHours + p.hours >= md.wear.life.value);
        if (wornOut) next = { ...next, status: 'broken' };
        update(ctx, p.machine, next, broke ? ['until'] : []);
        if (broke) breakDown(ctx, p.machine);
        if (wornOut) {
          ctx.log('warn', `${md.label} is worn out after ${Math.round(m.engineHours + p.hours)} h of use.`, [p.machine]);
          ctx.blockers.set(p.machine, [{ code: 'equipment.wornOut', severity: 'block', params: { machine: md.label } }]);
          ctx.emit('equipment.released', { machine: p.machine });
        }
        bumpTotals(ctx, { engineHours: p.hours, fuelLitres: litres, breakdowns: broke ? 1 : 0 });
        if (md.engine && hoursSinceService >= md.engine.serviceInterval.value) scheduleService(ctx, p.machine, ctx.now);
      },
      'Report operating hours',
    ),
    'equipment.sell': command(
      s.object({ machine: s.ref('machine'), ask: s.number({ min: 1, unit: 'EUR' }).optional() }),
      (ctx: WriteCtx, p) => {
        const m = machineGet(ctx, p.machine);
        mustHold(ctx, p.machine);
        if (!m) ctx.reject('equipment.unknownMachine', { machine: p.machine });
        const md = model(ctx, m!.model);
        if (m!.ownership !== 'owned') ctx.reject('equipment.notOwned', { machine: md.label });
        if (m!.status === 'arriving' || m!.status === 'travelling') ctx.reject('equipment.cannotSell', { machine: md.label, status: m!.status });
        const not = unsaleable(ctx, p.machine);
        if (not) ctx.reject('equipment.cannotSell', { machine: md.label, status: not });
        if (m!.setUp) ctx.reject('equipment.isSetUp', { machine: md.label }, [{ label: `Pack the ${md.label} up`, command: { type: 'structures.strike', payload: { structure: p.machine } } }]);
        if (!ctx.hasPort('usedPlant')) ctx.reject('equipment.noMarket');
        if (m!.listing?.buyer) ctx.reject('equipment.cannotSell', { machine: md.label, status: `sold to ${m!.listing.buyer}, who is coming to collect it` });
        const market = ctx.port('usedPlant');
        const v = market.value(p.machine);
        const ask = Math.round(p.ask ?? v.value);
        list(ctx, p.machine, ask);
        const days = expectedDaysToSell(ctx, p.machine, ask);
        ctx.log('info', `${md.label} offered for sale at ${ask} € (the market values it at ${v.value} €; book value ${Math.round(m!.bookValue ?? 0)} €): ${buyerExpected(days)}.`, [p.machine]);
        // far above the market no buyer is to be expected: said so, not a number of days that means nothing
        return { ask, value: v.value, expectedDays: days > 3650 ? null : Math.round(days * 10) / 10, buyer: buyerExpected(days), provenance: v.provenance };
      },
      { label: 'Sell a machine of ours', description: 'Offer it on the used-plant market at an asking price (default: what the market values it at; see inspect: marketValue). Prospective buyers come over time (the expected days are an average: one may come in days, or take months) and take it if the ask is within what they would pay; one whose limit lies a little below the ask offers it, and the offer stands some days (equipment.acceptOffer takes it); the buyer comes to collect it, pays the ask and takes it away. Gains or losses against the book value are booked. Sell again to change the ask.' },
    ),
    'equipment.acceptOffer': command(
      s.object({ machine: s.ref('machine') }),
      (ctx: WriteCtx, p) => {
        const m = machineGet(ctx, p.machine);
        mustHold(ctx, p.machine);
        if (!m) ctx.reject('equipment.unknownMachine', { machine: p.machine });
        const md = model(ctx, m!.model);
        if (m!.listing?.buyer) ctx.reject('equipment.cannotSell', { machine: md.label, status: `sold to ${m!.listing.buyer}, who is coming to collect it` });
        const offer = m!.listing?.offer;
        // (an offer is for the machine as it was offered: broken or wrecked since, it is not that machine; the same test as sell)
        const not = unsaleable(ctx, p.machine);
        if (not) ctx.reject('equipment.cannotSell', { machine: md.label, status: offer ? `${not} since the offer of ${offer.price} € was made for it` : not });
        if (!offer || offer.until <= ctx.now) ctx.reject('equipment.noOffer', { machine: md.label }, m!.listing ? [] : [{ label: `Offer the ${md.label} for sale`, command: { type: 'equipment.sell', payload: { machine: p.machine } } }]);
        agree(ctx, p.machine, offer!.price);
        return { price: offer!.price };
      },
      { label: 'Take a buyer’s offer', description: 'Take the offer a prospective buyer made for a machine of ours on sale (below the ask; it stands some days): the buyer comes to collect it and pays the price offered.' },
    ),
    'equipment.withdrawListing': command(
      s.object({ machine: s.ref('machine') }),
      (ctx: WriteCtx, p) => {
        const m = machineGet(ctx, p.machine);
        mustHold(ctx, p.machine);
        if (!m?.listing) ctx.reject('equipment.notListed', { machine: m ? model(ctx, m.model).label : p.machine });
        if (m!.listing!.buyer) ctx.reject('equipment.cannotSell', { machine: model(ctx, m!.model).label, status: `sold to ${m!.listing!.buyer}, who is coming to collect it` });
        update(ctx, p.machine, {}, ['listing']);
        forgetBuyer(ctx, p.machine);
        ctx.blockers.clear(p.machine);
        ctx.log('info', `${model(ctx, m!.model).label} is no longer for sale.`, [p.machine]);
      },
      { label: 'Take a machine off the market', description: 'Withdraw the sale offer.' },
    ),
    'equipment.rideToWork': command(
      s.object({ machine: s.ref('machine'), person: s.ref('person').optional() }),
      (ctx: WriteCtx, p) => {
        const m = machineGet(ctx, p.machine);
        if (!m) ctx.reject('equipment.unknownMachine', { machine: p.machine });
        mustUse(ctx, p.machine);
        const md = model(ctx, m!.model);
        if (ctx.data('equipmentClasses')[md.class]?.kind !== 'vehicle' || !md.transport) ctx.reject('equipment.notRidden', { machine: md.label });
        const riders = { ...(ctx.state('equipment').riders ?? {}) };
        // whoever rode it before does not any more; one rides one vehicle
        for (const [who, v] of Object.entries(riders)) if (v === p.machine) delete riders[who];
        if (p.person) {
          const theirs = ctx.get('Helper', p.person)?.of ?? ctx.get('Employment', p.person)?.employer;
          const name = ctx.port('workforce').name(p.person);
          // (one of those it is ours to use for: its holder's, or the one it is lent to)
          const user = lentTo(ctx, p.machine) ?? m!.holder;
          if (theirs !== user) ctx.reject('equipment.notTheirs', { machine: md.label, person: name, party: partyLabel(ctx, user) });
          riders[p.person] = p.machine;
          ctx.log('info', `${name} rides the ${md.label.replace(/\s*\(.*\)/, '').toLowerCase()} to work.`, [p.person, p.machine]);
        }
        ctx.patchState('equipment', { riders });
      },
      { label: 'Ride a vehicle to work', description: 'One of ours takes this vehicle (a bicycle, a car) to their job beyond the map and back each working day: quicker than walking; while they are at work it is away with them. A car burns its fuel for the trips (from its tank; without it they walk); driving without the licence is a legal exposure, not refused. Without `person`, nobody rides it to work.' },
    ),
    'equipment.rideOut': command(
      s.object({ machine: s.ref('machine'), person: s.ref('person'), until: s.number({ unit: 's' }) }),
      (ctx: WriteCtx, p) => {
        const m = machineAt(ctx, p.machine);
        if (m.status !== 'ready' || withRider(ctx, p.machine)) ctx.reject('equipment.notReady', { machine: model(ctx, m.model).label, status: m.status });
        const out = Object.fromEntries(Object.entries(ctx.state('equipment').out ?? {}).filter(([, t]) => t > ctx.now));
        ctx.patchState('equipment', { out: { ...out, [p.machine]: p.until } });
      },
      { label: 'One of ours rides a vehicle of ours to work this morning', internal: true },
    ),
    'equipment.commuted': command(
      s.object({ machine: s.ref('machine'), person: s.ref('person') }),
      (ctx: WriteCtx, p) => {
        // (its fuel and hours went with its legs there and back: what the use leaves is reckoned here)
        const md = model(ctx, machineAt(ctx, p.machine).model);
        const now = machineAt(ctx, p.machine);
        if (md.engine && now.hoursSinceService >= md.engine.serviceInterval.value) scheduleService(ctx, p.machine, ctx.now);
        if (md.wear && now.engineHours >= md.wear.life.value) {
          update(ctx, p.machine, { status: 'broken' });
          ctx.log('warn', `${md.label} is worn out after ${Math.round(now.engineHours)} h of use.`, [p.machine]);
          ctx.blockers.set(p.machine, [{ code: 'equipment.wornOut', severity: 'block', params: { machine: md.label } }]);
          ctx.emit('equipment.released', { machine: p.machine });
        }
        // driving without the licence the law asks for: an exposure, never a refusal (decision 0025)
        const wf = ctx.port('workforce');
        if (md.operatorQualification && !wf.licensed(p.person, md.operatorQualification)) ctx.emit('equipment.legalExposure', { person: p.person, party: userOf(ctx, p.machine), what: `driving the ${md.label} to work without a licence`, rule: wf.qualification(md.operatorQualification).label });
      },
      { label: 'A vehicle of ours was ridden to work and back', internal: true },
    ),
    // run dry at work: topped up from its user's nearest stock of its fuel, a can fetched or a bowser driven
    // over (Qwen S145/S148: not idle till night with fuel at the yard); it stands for the way there and back
    'equipment.generate': command(
      s.object({ machine: s.ref('machine'), hours: s.number({ min: 0.25, max: 72, unit: 'h' }) }),
      (ctx, p) => {
        // a generator started by one of ours at it (it has a pull cord or a button, not a word from afar): it runs for the
        // hours said, charging the batteries and the phones of ours within its cable as fast as they take, idling when they are full
        const m = machineGet(ctx, p.machine);
        if (!m) return ctx.reject('equipment.unknownMachine', { machine: p.machine });
        mustUse(ctx, p.machine);
        const md = model(ctx, m.model);
        if (!md.generator) return ctx.reject('equipment.notAGenerator', { machine: md.label });
        const at = ctx.port('moves').placeOf(p.machine)?.on === undefined ? ctx.port('moves').where(p.machine) : undefined;
        if (m.status !== 'ready' || !at) return ctx.reject('equipment.notReady', { machine: md.label, status: m.status });
        if (!(fuelIn(ctx, p.machine) > 1e-6)) return ctx.reject('equipment.noFuel', { machine: md.label, need: Math.ceil(md.engine!.tankSize.value * 10) / 10, have: 0 }, fuelRemedies(ctx, p.machine, at));
        const party = actorOf(ctx);
        const reach = ctx.data('labourSettings').ways.reach.value;
        const moves = ctx.port('moves');
        const there = ctx.hasPort('workforce') ? ctx.port('workforce').staff(party).filter((x) => {
          const w = moves.where(x);
          return w && Math.hypot(w[0] - at[0], w[1] - at[1]) <= reach;
        }) : [];
        if (!there.length) return ctx.reject('equipment.nobodyAtIt', { machine: md.label, party: partyLabel(ctx, party) }, someoneTo(ctx, p.machine, party, at));
        const until = ctx.now + p.hours * HOUR;
        ctx.setState('equipment', { ...ctx.state('equipment'), generating: { ...(ctx.state('equipment').generating ?? {}), [p.machine]: { since: ctx.now, until } } });
        ctx.log('info', `${ctx.port('workforce').name(there[0]!)} starts the ${md.label}: it runs until ${ctx.calendar.format(until)}.`, [p.machine]);
        return { until };
      },
      { label: 'Run a generator', description: 'One of ours at the generator starts it for so many hours: it burns its fuel by its load and charges the batteries and the phones of ours within its cable as fast as they take; with the batteries full it runs idle, burning fuel for next to nothing. Electricity goes along a cable within reach, or in a battery carried.' },
    ),
    'equipment.topUp': command(
      s.object({ machine: s.ref('machine') }),
      (ctx, p) => {
        // (a player's too: the way a machine run dry is filled, offered where it is refused for want of fuel; review w26,
        // the remedy pointed at a command players were refused)
        mustUse(ctx, p.machine);
        const m = machineAt(ctx, p.machine);
        const md = model(ctx, m.model);
        if (!md.engine || m.status !== 'ready') return ctx.reject('equipment.notReady', { machine: md.label, status: m.status });
        const hold = ctx.port('holdings');
        const material = fuelOf(md);
        const user = userOf(ctx, p.machine);
        const store = nearestFuel(ctx, m.pos, material, user);
        const have = store ? hold.stock(store, material) : 0;
        const missing = md.engine.tankSize.value - fuelIn(ctx, p.machine);
        if (!store || have <= 1e-6 || missing <= 1e-6) return ctx.reject('equipment.noFuel', { machine: md.label, need: Math.ceil(missing * 10) / 10, have: Math.round(fuelIn(ctx, p.machine) * 10) / 10 });
        const take = Math.min(missing, have);
        // by the stock: filled there by hand; else brought to it (a round by one of our vehicles, or cans on foot)
        let until = ctx.now + 15 * 60;
        if (hold.together(store, m.tank ?? store)) {
          if (!fill(ctx, p.machine, store, take)) return ctx.reject('equipment.noFuel', { machine: md.label, need: Math.ceil(missing * 10) / 10, have: Math.round(fuelIn(ctx, p.machine) * 10) / 10 });
        } else {
          const brought = bringFuel(ctx, user, store, [{ machine: p.machine, qty: take }], 'top-up');
          if ('why' in brought) return ctx.reject('equipment.noFuel', { machine: md.label, need: Math.ceil(missing * 10) / 10, have: Math.round(fuelIn(ctx, p.machine) * 10) / 10 });
          until = brought.arrive + 5 * 60;
        }
        update(ctx, p.machine, { status: 'servicing', until });
        ctx.at(until, 'serviceDone', { machine: p.machine });
        ctx.blockers.set(p.machine, [{ code: 'equipment.refuelling', severity: 'info', params: { until: ctx.calendar.format(until) } }]);
        ctx.log('info', `${md.label} ran dry: topped up with ${Math.round(take * 10) / 10} l from ${hold.label(store)} (back at work ${ctx.calendar.format(until, 'time')}).`, [p.machine, store]);
        return { until };
      },
      { label: 'Top a machine up with fuel', description: 'Fill a machine of ours with its fuel from the nearest store of ours that has it: by hand where the fuel is by it, else brought to it (a round by one of our vehicles, or cans on foot); it is back at work when that is done.' },
    ),
    'equipment.takeOut': command(
      s.object({ machine: s.ref('machine'), move: s.ref('move'), to: s.point(), until: s.number({ unit: 's' }) }),
      (ctx, p) => {
        const m = machineAt(ctx, p.machine);
        if (m.status !== 'ready') ctx.reject('equipment.notReady', { machine: model(ctx, m.model).label, status: m.status });
        if (withRider(ctx, p.machine)) ctx.reject('equipment.notReady', { machine: model(ctx, m.model).label, status: `with ${ctx.port('workforce').name(riderOf(ctx, p.machine)!)} at work` });
        if (m.listing?.buyer) ctx.reject('equipment.notReady', { machine: model(ctx, m.model).label, status: `promised to ${m.listing.buyer}` });
        update(ctx, p.machine, { status: 'travelling', move: p.move, destination: [p.to[0], p.to[1]], until: p.until });
      },
      { label: 'A vehicle of ours is out on a move', internal: true },
    ),
    'equipment.setUp': command(
      s.object({ machine: s.ref('machine'), on: s.boolean() }),
      (ctx: WriteCtx, p) => {
        const m = machineAt(ctx, p.machine);
        if (p.on) update(ctx, p.machine, { setUp: true });
        else if (m.setUp) update(ctx, p.machine, {}, ['setUp']);
      },
      { label: 'A vehicle set up as something else, or packed up', internal: true },
    ),
    'equipment.wreck': command(
      s.object({ machine: s.ref('machine'), why: s.string() }),
      (ctx: WriteCtx, p) => {
        const m = machineAt(ctx, p.machine);
        const md = model(ctx, m.model);
        // (a wreck is not what was offered for sale: its listing and any offer for it end here; one agreed and coming finds it so)
        const listed = m.listing && !m.listing.buyer;
        update(ctx, p.machine, { status: 'broken' }, listed ? ['listing'] : []);
        if (listed) {
          forgetBuyer(ctx, p.machine);
          ctx.log('info', `${md.label} is no longer for sale${m.listing!.offer ? `; the offer of ${m.listing!.offer.price} € for it has lapsed` : ''}.`, [p.machine]);
        }
        ctx.blockers.set(p.machine, [{ code: 'equipment.wrecked', severity: 'block', params: { machine: md.label, why: p.why } }]);
        ctx.log('warn', `${md.label} is a wreck: ${p.why}.`, [p.machine]);
        ctx.emit('equipment.released', { machine: p.machine });
      },
      { label: 'A vehicle wrecked (overturned, crushed)', internal: true },
    ),
    'equipment.moveTo': command(
      s.object({ machine: s.ref('machine'), to: s.point(), by: s.ref('machine').optional(), haulier: s.boolean().optional(), driver: s.ref('person').optional(), near: s.number({ min: 0 }).optional() }),
      (ctx: WriteCtx, p0) => {
        const m = machineGet(ctx, p0.machine);
        // (as near as it can get, within `near` m: a van stops at the bank of a creek it cannot ford, its crew walks on)
        const p = m && p0.near ? { ...p0, to: nearestReachable(ctx, m, p0.to, p0.near) } : p0;
        // who takes it (design/physical-state.md I2, r36: nothing goes with nobody): the one named (a crew's operator),
        // else the nearest of its user's people who can; they walk to it first. A world without people moves it as it is.
        const takenBy = (q: string | undefined): { driver: EntityId; walk: LegRequest[] } | undefined => {
          if (!ctx.hasPort('workforce')) return undefined;
          const wf = ctx.port('workforce');
          const label = model(ctx, m!.model).label;
          const skill = q ? wf.qualification(q).label : 'taking it';
          const party = userOf(ctx, p.machine);
          // (a player's word reaches the driver from its lead: within hearing or by phone, design/physical-state.md I9;
          // a crew's operator was told at the morning's report)
          const told = ctx.caller === 'client' ? (x: EntityId) => !('why' in wf.tell(party, x)) : undefined;
          const notTold = (x: EntityId) => {
            const t = wf.tell(party, x);
            return ctx.reject('equipment.notTold', { person: wf.name(x), why: 'why' in t ? t.why : '' }, 'why' in t && t.walk ? [{ label: `Walk over to ${wf.name(x)}`, command: { type: 'workforce.goTo', payload: { person: x } } }] : []);
          };
          if (p.driver) {
            const ready = wf.staff(party).includes(p.driver) && wf.present(p.driver) && (!q || wf.canDo(p.driver, q));
            const found = ready ? driverFor(ctx, party, q, m!.pos, p.driver) : undefined;
            if (found && told && !told(p.driver)) return notTold(p.driver);
            return found ?? ctx.reject('equipment.noDriver', { machine: label, skill: `${skill}: ${wf.name(p.driver)} is not free here to do it` });
          }
          const found = driverFor(ctx, party, q, m!.pos, undefined, told);
          if (found) return found;
          const anyone = told && driverFor(ctx, party, q, m!.pos);
          return anyone ? notTold(anyone.driver) : ctx.reject('equipment.noDriver', { machine: label, skill });
        };
        mustUse(ctx, p.machine);
        if (!m) ctx.reject('equipment.unknownMachine', { machine: p.machine });
        if (m.status !== 'ready') ctx.reject('equipment.notReady', { machine: p.machine, status: m.status });
        if (withRider(ctx, p.machine)) ctx.reject('equipment.notReady', { machine: p.machine, status: 'away with the one who rode it to work' });
        const md = model(ctx, m.model);
        if (!ctx.port('moves').onMap(p.to)) ctx.reject('equipment.offMap', { machine: md.label, at: `[${Math.round(p.to[0])}, ${Math.round(p.to[1])}]` });
        if (m.setUp) ctx.reject('equipment.isSetUp', { machine: md.label }, [{ label: `Pack the ${md.label} up`, command: { type: 'structures.strike', payload: { structure: p.machine } } }]);
        // a trailer goes behind a vehicle of ours that can tow it
        if (ctx.data('equipmentClasses')[md.class]?.kind === 'trailer') return p.haulier ? bookLowLoader(ctx, p.machine, p.to) : tow(ctx, p.machine, p.to, p.by);
        // (only a trailer goes behind another; plant goes by itself or on a low-loader: S408, `by` was ignored)
        if (p.by) ctx.reject('equipment.notTowed', { machine: md.label, by: model(ctx, machineAt(ctx, p.by).model).label }, [{ label: `Move the ${md.label} itself (on a low-loader where it needs one)`, command: { type: 'equipment.moveTo', payload: { machine: p.machine, to: p.to } } }]);
        // a tool goes in someone's hands, at walking pace (decision 0026: no move without a carrier); a powered
        // one too (a chainsaw: its transport block says how it travels on a lorry, not that it drives)
        const kind = ctx.data('equipmentClasses')[md.class]?.kind;
        // (as long as one person can carry it: a survey kit with its van goes in the van, not in someone's arms)
        const handLoad = ctx.data('vehicleProfiles')[ctx.data('equipmentSettings').toolCarrier ?? '']?.payload;
        const carriable = !handLoad || convert(md.operatingWeight.value, md.operatingWeight.unit, 't') <= convert(handLoad.value, handLoad.unit, 't');
        if (!md.transport || ((kind === 'hand' || kind === 'powered') && carriable)) {
          const by = ctx.data('equipmentSettings').toolCarrier;
          // (no carrier, no move: it stays where it is; already there, nothing to do. A short way is a short move,
          // never a step without one: design/physical-state.md I2, finding 1)
          if (!by) ctx.reject('equipment.noRoute', { machine: p.machine, reason: 'nobody carries it' });
          if (Math.hypot(p.to[0] - m.pos[0], p.to[1] - m.pos[1]) < 1e-6) return ctx.now;
          const hands = takenBy(undefined);
          const r = ctx.command('moves.dispatch', { legs: [...(hands?.walk ?? []), { carrier: { class: by, ...(hands ? { unit: hands.driver } : {}) }, from: [m.pos[0], m.pos[1]], to: [p.to[0], p.to[1]], maxOffroad: SITE_OFFROAD, loads: [{ machine: p.machine }] }], purpose: 'relocate', requester: EQUIPMENT_MODULE_ID });
          if (!r.ok) ctx.reject('equipment.noRoute', { machine: p.machine, reason: r.reasons.map((b) => ctx.formatBlocker(b)).join('; ') });
          const { arrive } = span(ctx, r.value);
          update(ctx, p.machine, { status: 'travelling', move: r.value, destination: [p.to[0], p.to[1]], until: arrive });
          return arrive;
        }
        const routing = ctx.port('routing');
        // plant crosses construction sites off the network; up to a few km of site tracks
        const own = routing.route(m.pos, p.to, md.transport.vehicleProfile, { maxOffroad: SITE_OFFROAD });
        const distance = own?.length ?? Math.hypot(p.to[0] - m.pos[0], p.to[1] - m.pos[1]);
        const lowLoader = md.transport.needsLowLoader && distance > LOW_LOADER_MIN_DISTANCE;
        // tracked plant goes by low-loader: a haulier has to be booked (lead time) and drives out
        if (lowLoader) return bookLowLoader(ctx, p.machine, p.to);
        // else someone of ours drives it (or rides it: a bicycle needs no licence, but someone), leaving what they did
        const found = takenBy(md.operatorQualification);
        const driver = found?.driver;
        const walk = found?.walk ?? [];
        // under its own power: the machine is the carrier of its leg, and it needs the fuel for the drive (0002)
        if (md.engine && own) {
          const need = fuelPerHour(md, 1) * (own.duration / HOUR);
          if (fuelIn(ctx, p.machine) + 1e-9 < need) ctx.reject('equipment.noFuel', { machine: md.label, need: Math.ceil(need * 10) / 10, have: Math.round(fuelIn(ctx, p.machine) * 10) / 10 });
        }
        const r = ctx.command('moves.dispatch', {
          legs: [...walk, { carrier: carriage(ctx, p.machine, false, md.transport.vehicleProfile).carrier, from: [m.pos[0], m.pos[1]], to: [p.to[0], p.to[1]], maxOffroad: SITE_OFFROAD, ...(driver ? { inCharge: driver } : {}) }],
          purpose: 'relocate',
          requester: EQUIPMENT_MODULE_ID,
        });
        if (!r.ok) ctx.reject('equipment.noRoute', { machine: p.machine, reason: r.reasons.map((b) => ctx.formatBlocker(b)).join('; ') });
        const { arrive } = span(ctx, r.value);
        update(ctx, p.machine, { status: 'travelling', move: r.value, destination: [p.to[0], p.to[1]], until: arrive });
        // someone drives it there and is busy until it arrives (a work package's own operator is with it already)
        return arrive;
      },
      'Move a machine',
    ),
  },
  contributes: {
    // what rides on a machine lent out (its battery, its tank) is its borrower's to use meanwhile
    // (its tank and battery are used by the one it is lent to; handed back to its hire firm, by nobody of the world: the
    // unit itself is named, no party, so nobody draws its fuel or power: inHand)
    holdingUser: () => (read: ReadCtx, unit: EntityId) => {
      const m = read.get('Machine', unit);
      if (!m) return null;
      return inHand(m, true) ? (lentTo(read, unit) ?? null) : unit;
    },
    // on the road, one of ours breaks down by its engine's MTBF, more often the longer its service is overdue
    failures: () => (read: ReadCtx, unit: EntityId) => {
      const m = read.get('Machine', unit);
      const md = m ? model(read, m.model) : undefined;
      if (!m || !md?.engine) return undefined;
      return md.engine.mtbf.value / careHazard(read.data('equipmentSettings'), md.engine, m.hoursSinceService);
    },
    // how long it drives on what is in its tank
    range: () => (read: ReadCtx, unit: EntityId) => {
      const m = read.get('Machine', unit);
      const md = m ? model(read, m.model) : undefined;
      if (!m || !md?.engine) return undefined;
      const perHour = fuelPerHour(md, 1);
      return perHour > 0 ? (fuelIn(read, unit) / perHour) * HOUR : undefined;
    },
    // what a machine weighs, by its model
    loadMass: () => (read: ReadCtx, load: Load) => {
      if (!('machine' in load) || !read.get('Machine', load.machine)) return undefined;
      const w = model(read, read.require('Machine', load.machine).model).operatingWeight;
      return convert(w.value, w.unit, 't');
    },
    // a machine no longer there (sold and taken away, sent back to the hire firm): what is agreed about it ends
    gone: () => (read: ReadCtx, id: EntityId) => {
      const e = read.entity(id);
      return (!e || e.kind === 'machine') && !machineGet(read, id) ? `${e?.name ?? 'what it is about'} is no longer there` : null;
    },
    // a machine offered for sale is not lent (it could be sold from under the borrower)
    notLendable: () => (read: ReadCtx, subject: EntityId) => (machineGet(read, subject)?.listing ? 'it is offered for sale (withdraw the offer first: equipment.withdrawListing)' : null),
    // who holds a machine (what can be lent or let is its holder's to lend)
    holders: () => (read: ReadCtx, subject: EntityId) => machineGet(read, subject)?.holder ?? null,
    // where a party's money could come from: selling a machine of ours on the used-plant market
    financing: () => (read: ReadCtx, holder: EntityId) => {
      if (!read.hasPort('usedPlant')) return [];
      return [...read.all('Machine')]
        .filter(([id, m]) => m.holder === holder && m.ownership === 'owned' && m.status === 'ready' && !m.listing && !m.setUp && !lentTo(read, id))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([id, m]) => ({ label: `Sell the ${model(read, m.model).label} (the market values it at ${Math.round(read.port('usedPlant').value(id).value)} €)`, command: { type: 'equipment.sell', payload: { machine: id } } }));
    },
  },
  on: {
    // insolvency proceedings opened: hired machines go back, owned ones are offered at what the administrator asks to sell quickly
    'economy.insolvencyOpened': (ctx, p) => windUp(ctx, p.party, true),
    // a move of ours stood on the way (a low-loader or a fitter's van broke down): what waits for it says the new time
    'moves.delayed': (ctx, p) => {
      beyondTheMap(ctx, p);
      if (p.requester !== EQUIPMENT_MODULE_ID) return;
      const fmt = (t: number) => ctx.calendar.format(t);
      for (const [id, m] of [...ctx.all('Machine')]) {
        const st = ctx.state('equipment');
        const tr = st.transports[id];
        const job = st.repairs[id];
        if (m.move === p.move || tr?.move === p.move) {
          if (m.until !== undefined) update(ctx, id, { until: m.until + p.by });
          if (tr) setTransport(ctx, id, { ...tr, eta: tr.eta + p.by });
          // the machine's own time (with the drive off the ramp) where it has one, else the move's arrival
          const when = m.until !== undefined ? m.until + p.by : p.arrive;
          const later = (b: Blocker): Blocker => (b.code === 'equipment.arriving' ? { ...b, params: { ...b.params, until: fmt(when) } } : b.code === 'equipment.lowLoaderComing' ? { ...b, params: { ...b.params, at: fmt(p.arrive) } } : b);
          const bs = ctx.blockersOf(id);
          if (bs.some((b) => b.code === 'equipment.arriving' || b.code === 'equipment.lowLoaderComing')) ctx.blockers.set(id, bs.map(later));
        }
        if (job?.move === p.move && job.next !== undefined) {
          const next = { ...job, next: job.next + p.by };
          setRepair(ctx, id, next);
          repairBlocker(ctx, id, next);
        }
      }
    },
    // a machine that drives itself burns its fuel on the way and is where the leg ended (decision 0002: no free driving)
    // a move it was on stopped where it is: broken down there (the field service comes to it), run dry, its way
    // closed, called off: it stands there, its fuel and hours of the way it drove
    'moves.stopped': (ctx, e) => {
      // a fuel run stopped: what is on it is set down where it stands (in a store of its party's there)
      const run = ctx.state('equipment').fuelRuns?.[e.move];
      if (run) {
        const holder = ctx.port('holdings').holder(run.store);
        // (what it carries is what was loaded, less what went into tanks: not what the leg was planned with, r38)
        const loaded = e.leg > run.loadAt;
        const on = Object.entries(run.load).filter(([, q]) => q > 1e-6);
        if (holder && e.at && loaded && on.length) {
          const into = ctx.command('inventory.createStore', { holder, label: `Fuel left on the way (${e.why})`, kind: 'stockpile', pos: [e.at[0], e.at[1]] });
          if (into.ok) for (const [material, qty] of on) ctx.command('inventory.unload', { store: into.value as EntityId, material, qty });
        }
        const { [e.move]: _gone, ...rest } = ctx.state('equipment').fuelRuns ?? {};
        ctx.setState('equipment', { ...ctx.state('equipment'), fuelRuns: rest });
      }
      for (const id of e.units) {
        const m = machineGet(ctx, id);
        // (the move it was on; or the one it carried: a vehicle ridden to work: r37)
        if (!m || (m.move !== e.move && e.carrier.unit !== id)) continue;
        if (ctx.state('equipment').out?.[id] !== undefined) {
          const { [id]: _o, ...out } = ctx.state('equipment').out ?? {};
          ctx.setState('equipment', { ...ctx.state('equipment'), out });
        }
        const md = model(ctx, m.model);
        const driven = e.carrier.unit === id ? droveRest(ctx, e.move, e.leg, e.seconds) : 0;
        if (e.carrier.unit === id && e.seconds > 0) {
          const burnt = Math.min(fuelIn(ctx, id), fuelPerHour(md, 1) * (driven / HOUR));
          if (burnt > 0) burn(ctx, id, burnt, `${md.label}: driven`);
          const hours = e.inCharge !== undefined ? e.seconds / HOUR : 0;
          update(ctx, id, { engineHours: m.engineHours + hours, hoursSinceService: m.hoursSinceService + hours, lastActive: ctx.now });
        }
        if (ctx.state('equipment').transports[id]) setTransport(ctx, id, null);
        // (broken down, or towed in broken from beyond the map and stopped on the way: r38)
        const towedIn = Boolean(ctx.state('equipment').towed?.[id]);
        if (towedIn) {
          const { [id]: _t, ...towed } = ctx.state('equipment').towed ?? {};
          ctx.setState('equipment', { ...ctx.state('equipment'), towed });
        }
        const broke = (e.cause === 'breakdown' && e.carrier.unit === id) || towedIn;
        update(ctx, id, { status: broke ? 'broken' : 'ready', lastActive: ctx.now }, ['move', 'destination', 'until']);
        ctx.log('warn', `${md.label} ${e.why} on the way and stands ${e.at ? `at (${Math.round(e.at[0])}, ${Math.round(e.at[1])})` : 'beyond the map'}.`, [id]);
        if (broke) breakDown(ctx, id);
        else ctx.blockers.clear(id);
      }
    },
    'moves.legDone': (ctx, p) => {
      // towed in broken: broken where it is now, the field service called to it
      for (const id of p.left ?? []) {
        if (!ctx.state('equipment').towed?.[id]) continue;
        const { [id]: _t, ...towed } = ctx.state('equipment').towed ?? {};
        ctx.setState('equipment', { ...ctx.state('equipment'), towed });
        const m = machineGet(ctx, id);
        if (m && m.status !== 'broken') {
          update(ctx, id, { status: 'broken' }, ['move', 'destination', 'until']);
          breakDown(ctx, id);
        }
      }
      // a fuel run: loaded at the stock, a tank filled at its stop, the rest back
      if (p.requester === EQUIPMENT_MODULE_ID && ctx.state('equipment').fuelRuns?.[p.move]) runLeg(ctx, p.move, p.leg, p.leg === (ctx.get('Move', p.move)?.legs.length ?? 0) - 1);
      // a trailer towed behind one of our vehicles wears by the road (its hours of use); goods carried do not
      if (p.carrier.unit) {
        const leg = ctx.get('Move', p.move)?.legs[p.leg];
        for (const t of p.carried ?? []) {
          // (towed, not carried: a tool in someone's hands or on a lorry's bed does not wear by the road)
          if (!leg?.loads.some((l) => 'machine' in l && l.machine === t && l.towed)) continue;
          const c = machineGet(ctx, t);
          const cw = c ? model(ctx, c.model).wear : undefined;
          if (!c || !cw) continue;
          const now = update(ctx, t, { engineHours: c.engineHours + p.seconds / HOUR, hoursSinceService: c.hoursSinceService + p.seconds / HOUR });
          if (now.engineHours >= cw.life.value && now.status !== 'broken') {
            update(ctx, t, { status: 'broken' });
            ctx.log('warn', `${model(ctx, c.model).label} is worn out after ${Math.round(now.engineHours)} h on the road.`, [t]);
            ctx.blockers.set(t, [{ code: 'equipment.wornOut', severity: 'block', params: { machine: model(ctx, c.model).label } }]);
          }
        }
      }
      const m = p.carrier.unit ? machineGet(ctx, p.carrier.unit) : undefined;
      if (!m) return;
      // (on a tow truck: it did not drive, but up to the tow; driven up to a station: burnt there)
      const rest = droveRest(ctx, p.move, p.leg, p.seconds);
      if (ctx.get('Move', p.move)?.towed) return;
      const md = model(ctx, m.model);
      const burnt = fuelPerHour(md, 1) * (rest / HOUR);
      if (burnt > fuelIn(ctx, p.carrier.unit!) + 1e-9) ctx.log('warn', `${md.label} ran dry on the way (${Math.round(burnt)} l needed, ${Math.round(fuelIn(ctx, p.carrier.unit!))} l in the tank).`, [p.carrier.unit!]);
      // and the hours count as use, driven or ridden by someone of ours (towards its service, or its wear): a player's
      // driver, or the operator production moves it with; a dealer's delivery is not ours
      const ours = p.inCharge !== undefined || (p.requester === EQUIPMENT_MODULE_ID && p.purpose === 'relocate');
      const hours = ours ? p.seconds / HOUR : 0;
      bumpTotals(ctx, { engineHours: hours, fuelLitres: burnt, breakdowns: 0 });
      burn(ctx, p.carrier.unit!, burnt, `${md.label}: driven`);
      update(ctx, p.carrier.unit!, { engineHours: m.engineHours + hours, hoursSinceService: m.hoursSinceService + hours, lastActive: ctx.now });
    },
    'moves.arrived': (ctx, p) => {
      // the dealer's fitter come for a service: the machine stands for it where it is, then they drive home
      if (p.requester === EQUIPMENT_MODULE_ID && p.purpose === 'service-call' && p.ref) {
        const m = machineGet(ctx, p.ref);
        if (!m || m.status === 'broken' || ctx.port('moves').placeOf(p.ref)?.on !== undefined) {
          fitterLeaves(ctx, p.ref);
          if (m) scheduleService(ctx, p.ref, nextServiceMorning(ctx, ctx.now + HOUR));
          return;
        }
        ctx.setState('equipment', { ...ctx.state('equipment'), fitterServicing: { ...(ctx.state('equipment').fitterServicing ?? {}), [p.ref]: true } });
        beginService(ctx, p.ref);
        // (said: the fitter is there, S412)
        const until = machineGet(ctx, p.ref)?.until;
        ctx.log('info', `The dealer's fitter is at the ${model(ctx, m.model).label} for its service${until !== undefined ? `, until ${ctx.calendar.format(until)}` : ''}.`, [p.ref]);
        return;
      }
      if (p.requester === EQUIPMENT_MODULE_ID && p.purpose === 'buyer-approach' && p.ref) {
        if (machineGet(ctx, p.ref)?.listing?.buyer) collected(ctx, p.ref);
        return;
      }
      if (p.requester === EQUIPMENT_MODULE_ID && p.purpose === 'repair-call' && p.ref) {
        const job = ctx.state('equipment').repairs[p.ref];
        if (job?.move === p.move) fitterArrived(ctx, p.ref);
        return;
      }
      if (p.requester === EQUIPMENT_MODULE_ID && p.purpose === 'lowloader-approach' && p.ref) {
        const tr = ctx.state('equipment').transports[p.ref];
        if (tr?.move !== p.move) return;
        // load and secure the machine
        setTransport(ctx, p.ref, { ...tr, stage: 'loading' });
        ctx.after(LOW_LOADER_HANDLING_H * 0.5 * HOUR, 'lowLoaderLoaded', {
          machine: p.ref,
        });
        return;
      }
      // the machine that arrived: the carrier itself (under its own power, also on someone's errand), or a load (on a low-loader)
      // (a car towing a trailer: both)
      for (const load of p.loads) {
        const lid = 'machine' in load ? load.machine : undefined;
        if (lid && p.carrier.unit && lid !== p.carrier.unit && machineGet(ctx, lid)?.move === p.move) arrive(ctx, lid);
      }
      const id = p.carrier.unit ?? p.loads.map((l) => ('machine' in l ? l.machine : undefined)).find(Boolean);
      const m = id ? machineGet(ctx, id) : undefined;
      if (!id || !m || m.move !== p.move) return; // e.g. the low-loader's empty return
      const tr = ctx.state('equipment').transports[id];
      arrive(ctx, id);
      // home from driving itself: a service due, or worn out by the use
      if (p.carrier.unit === id) {
        const md = model(ctx, m.model);
        const now = machineAt(ctx, id);
        if (md.engine && now.hoursSinceService >= md.engine.serviceInterval.value) scheduleService(ctx, id, ctx.now);
        if (md.wear && now.engineHours >= md.wear.life.value) {
          update(ctx, id, { status: 'broken' });
          ctx.log('warn', `${md.label} is worn out after ${Math.round(now.engineHours)} h of use.`, [id]);
          ctx.blockers.set(id, [{ code: 'equipment.wornOut', severity: 'block', params: { machine: md.label } }]);
          ctx.emit('equipment.released', { machine: id });
        }
      }
      if (tr) {
        // driven off the ramp (the move's unloading), the haulier drives home empty
        const payer = tr.payer;
        setTransport(ctx, id, null);
        ctx.at(ctx.now, 'lowLoaderHome', { machine: id, ...(payer ? { payer } : {}) });
      }
    },
  },
  /** a what-if fork does not know when buyers come: their arrivals are drawn again */
  branch(ctx) {
    for (const [id, m] of [...ctx.all('Machine')]) if (m.listing && !m.listing.buyer && ctx.hasPort('usedPlant')) nextBuyer(ctx, id);
  },
  timers: {
    // the hire firm comes for an off-hired machine (G11): it leaves on their carrier, theirs again
    offHireCollect(ctx, payload: { machine: EntityId }) {
      const m = machineGet(ctx, payload.machine);
      if (!m || m.status !== 'offHired') return;
      const md = model(ctx, m.model);
      const ext = ctx.port('routing').externalNodes()[0];
      const r = ext === undefined ? null : ctx.command('moves.dispatch', { legs: [{ ...carriage(ctx, payload.machine, Boolean(md.transport?.needsLowLoader), profileOf(md)), from: [m.pos[0], m.pos[1]], to: [m.pos[0], m.pos[1]], externalDestination: ext, maxOffroad: SITE_OFFROAD }], purpose: 'off-hire', ref: payload.machine, requester: EQUIPMENT_MODULE_ID });
      if (r?.ok && md.transport?.needsLowLoader) chargeLowLoader(ctx, payload.machine, moveHours(ctx, r.value) * HOUR, `Off-hire transport ${md.label}`);
      if (!r?.ok) ctx.log('warn', `The hire firm could not take the ${md.label} away (${r ? r.reasons.map((b) => ctx.formatBlocker(b)).join('; ') : 'no way in'}): it is theirs and goes with them by other means.`, [payload.machine]);
      ctx.log('info', `The hire firm collects the ${md.label}.`, [payload.machine]);
      dropServiceDue(ctx, payload.machine);
      setRepair(ctx, payload.machine, null);
      setTransport(ctx, payload.machine, null);
      ctx.emit('equipment.released', { machine: payload.machine });
      goesOut(ctx, payload.machine);
      ctx.destroy(payload.machine);
    },
    collect(ctx, payload: { machine: EntityId }) {
      const m = machineGet(ctx, payload.machine);
      if (m?.listing?.buyer) collected(ctx, payload.machine);
    },
    buyer(ctx, payload: { machine: EntityId; at: number }) {
      const m = machineGet(ctx, payload.machine);
      if (!m?.listing || m.listing.buyer || ctx.state('equipment').buyers[payload.machine] !== payload.at) return; // superseded
      const md = model(ctx, m.model);
      // (broken or a wreck: not what is listed; they look and go)
      const not = unsaleable(ctx, payload.machine);
      if (not) {
        ctx.log('info', `A prospective buyer looked at ${md.label}: it is ${not}, not for them.`, [payload.machine]);
        nextBuyer(ctx, payload.machine);
        return;
      }
      const market = ctx.port('usedPlant');
      // what this one would pay at most: around the market value now
      const b = market.buyers(payload.machine);
      const willing = market.value(payload.machine).value * Math.exp(b.spread * ctx.rng('used-plant').normal(0, 1));
      if (willing < m.listing.ask) {
        // not far below the ask, they haggle: their limit offered, standing some days (the seller takes it or not); further
        // below, they go (each prospective buyer is another: one who would not pay the ask says nothing of the next, Qwen S503)
        // (a round figure, rounded to the price's scale: tens on a small tool, thousands on an excavator)
        const step = b.offers ? 10 ** Math.floor(Math.log10(Math.max(1, m.listing.ask * b.offers.round))) : 1;
        const price = Math.floor(willing / step) * step;
        if (b.offers && price > 0 && willing >= m.listing.ask * (1 - b.offers.below) && price > (m.listing.offer && m.listing.offer.until > ctx.now ? m.listing.offer.price : 0)) {
          const until = ctx.now + b.offers.days * DAY;
          update(ctx, payload.machine, { listing: { ...m.listing, offer: { price, until } } });
          ctx.at(until, 'offerLapses', { machine: payload.machine, until });
          ctx.log('info', `A prospective buyer looked at ${md.label}: not ${Math.round(m.listing.ask)} €, but offers ${price} €; the offer stands until ${ctx.calendar.format(until, 'day')} (equipment.acceptOffer takes it).`, [payload.machine]);
        } else ctx.log('info', `A prospective buyer looked at ${md.label} but would not pay ${Math.round(m.listing.ask)} €; others may.`, [payload.machine]);
        nextBuyer(ctx, payload.machine);
        saleBlockers(ctx, payload.machine);
        return;
      }
      // agreed at the ask (who would pay more does not say so)
      agree(ctx, payload.machine, m.listing.ask);
    },
    /** an offer not taken in its days lapses */
    offerLapses(ctx, payload: { machine: EntityId; until: number }) {
      const m = machineGet(ctx, payload.machine);
      if (!m?.listing?.offer || m.listing.buyer || m.listing.offer.until !== payload.until) return;
      const { offer, ...listing } = m.listing;
      update(ctx, payload.machine, { listing });
      ctx.log('info', `The offer of ${offer.price} € for ${model(ctx, m.model).label} has lapsed.`, [payload.machine]);
      saleBlockers(ctx, payload.machine);
    },
    deliver(ctx, payload: { machine: EntityId }) {
      const m = machineGet(ctx, payload.machine);
      if (!m || m.status !== 'arriving' || m.move) return;
      const md = model(ctx, m.model);
      const ext = ctx.port('routing').externalNodes()[0];
      const lowLoader = Boolean(md.transport?.needsLowLoader);
      const want = m.destination ?? m.pos;
      // (as near as its carrier gets: a low-loader stops at the edge of a cut or a bank, the machine drives off on its own
      // the last stretch: routing.approach, as a fitter's van, a crew's)
      const { carrier, loads } = carriage(ctx, payload.machine, lowLoader, profileOf(md));
      // (and a tool the dealer's van cannot bring to a camp on a footpath is set down where the van gets, at the kerb, to be
      // carried from there: run 5, axes "arriving" for ever)
      const routing = ctx.port('routing');
      const near = ext !== undefined ? (routing.approach(ext, want, carrier.class, DELIVERY_NEAR, lowLoader ? profileOf(md) : undefined, 'in', { maxOffroad: SITE_OFFROAD }) ?? routing.nearest(want, { openOnly: true, profile: carrier.class })?.point) : undefined;
      const to = near ?? want;
      if (near && Math.hypot(near[0] - want[0], near[1] - want[1]) > 30) ctx.log('info', `The ${md.label} cannot be brought to where it is wanted: it is set down ${Math.round(Math.hypot(near[0] - want[0], near[1] - want[1]))} m off, where the ${lowLoader ? 'low-loader' : 'van'} gets, at (${Math.round(near[0])}, ${Math.round(near[1])}).`, [payload.machine]);
      if (ext !== undefined) {
        // on the dealer's or rental company's low-loader, or under its own power
        const r = ctx.command('moves.dispatch', {
          legs: [{ carrier, from: [to[0], to[1]], to: [to[0], to[1]], externalNode: ext, maxOffroad: SITE_OFFROAD }],
          loads,
          purpose: 'delivery',
          requester: EQUIPMENT_MODULE_ID,
        });
        if (r.ok) {
          const { depart, arrive } = span(ctx, r.value);
          if (lowLoader) chargeLowLoader(ctx, payload.machine, arrive - depart, `${m.ownership === 'rented' ? 'Rental delivery' : 'Delivery from the dealer'} ${md.label}`);
          // there when it is off the ramp (the carrier's unloading), not when the low-loader stops
          const there = arrive + (lowLoader ? ctx.port('moves').unloadTime(lowLoaderProfile(ctx), md.operatingWeight.value) : 0);
          update(ctx, payload.machine, { move: r.value, until: there });
          ctx.blockers.set(payload.machine, [{ code: 'equipment.arriving', severity: 'info', params: { until: ctx.calendar.format(there) } }]);
          return;
        }
      }
      // the van cannot get onto the map at all (a camp on a footpath over the hill, Qwen S502/S506): a tool one can carry
      // is handed over at the end of its road, beyond the way in, to one of ours who walks out to meet it by appointment
      // and carries it back (robustness plan step 3: the ladder of means)
      const who = md.operatingWeight.value * 1000 <= carryKg(ctx) && ext !== undefined ? meetAtRoadEnd(ctx, payload.machine, ext, want) : undefined;
      if (who) return;
      // nobody to take it either: the dealer or the hire firm tries again its next working morning, a few times, then calls
      // it off (nothing was paid: a tool bought is paid on delivery, a hire starts with it); never every morning for ever
      const tries = (m.deliveryTries ?? 0) + 1;
      const attempts = ctx.data('equipmentSettings').deliveryAttempts.value;
      const firm = m.ownership === 'rented' ? 'the hire firm' : 'the dealer';
      const reason = ext === undefined ? 'no road connection to the region' : lowLoader || md.operatingWeight.value * 1000 > carryKg(ctx) ? 'no route for the transport to the delivery point' : 'no route for its van, and nobody of ours to meet it at the end of its road';
      const remedies: Remedy[] = [{ label: `Call it off with ${firm}`, command: { type: 'equipment.release', payload: { machine: payload.machine } } }];
      if (tries >= attempts) {
        ctx.log('warn', `${firm[0]!.toUpperCase()}${firm.slice(1)} gives up bringing the ${md.label} (${reason}): it is called off, nothing is paid.`, [payload.machine]);
        callOff(ctx, payload.machine);
        return;
      }
      const retry = nextServiceMorning(ctx, ctx.now + HOUR);
      update(ctx, payload.machine, { deliveryTries: tries, until: retry });
      ctx.at(retry, 'deliver', { machine: payload.machine });
      ctx.blockers.set(payload.machine, [{ code: 'equipment.deliveryNoAccess', severity: 'block', params: { reason, firm, retry: ctx.calendar.format(retry), left: attempts - tries }, remedies }]);
      ctx.log('warn', `${m.ownership === 'rented' ? 'The hire firm' : 'The dealer'} cannot bring the ${md.label} (${reason}): it tries again ${ctx.calendar.format(retry)}, ${attempts - tries === 1 ? 'a last time' : `${attempts - tries} more times`}.`, [payload.machine]);
    },
    lowLoaderDepart(ctx, payload: { machine: EntityId }) {
      const tr = ctx.state('equipment').transports[payload.machine];
      const m = machineGet(ctx, payload.machine);
      if (!tr || tr.stage !== 'booked' || !m) return;
      const ext = ctx.port('routing').externalNodes()[0];
      const r =
        ext !== undefined
          ? ctx.command('moves.dispatch', {
              legs: [{ carrier: { class: lowLoaderProfile(ctx) }, from: [m.pos[0], m.pos[1]], to: [m.pos[0], m.pos[1]], externalNode: ext, maxOffroad: SITE_OFFROAD }],
              purpose: 'lowloader-approach',
              ref: payload.machine,
              requester: EQUIPMENT_MODULE_ID,
            })
          : null;
      if (!r || !r.ok) {
        const retry = nextServiceMorning(ctx, ctx.now + HOUR);
        setTransport(ctx, payload.machine, { ...tr, pickup: retry });
        ctx.at(retry, 'lowLoaderDepart', { machine: payload.machine });
        ctx.blockers.set(payload.machine, [
          {
            code: 'equipment.lowLoaderNoAccess',
            severity: 'block',
            params: { retry: ctx.calendar.format(retry) },
          },
        ]);
        return;
      }
      chargeHaulier(ctx, payload.machine, moveHours(ctx, r.value), `Relocation ${model(ctx, m.model).label} (approach)`);
      setTransport(ctx, payload.machine, {
        ...tr,
        stage: 'approaching',
        move: r.value,
      });
      ctx.blockers.set(payload.machine, [
        {
          code: 'equipment.lowLoaderComing',
          severity: 'info',
          params: {
            at: ctx.calendar.format(span(ctx, r.value).arrive),
          },
        },
      ]);
    },
    lowLoaderLoaded(ctx, payload: { machine: EntityId }) {
      const tr = ctx.state('equipment').transports[payload.machine];
      const m = machineGet(ctx, payload.machine);
      if (!tr || tr.stage !== 'loading' || !m) return;
      const md = model(ctx, m.model);
      // the machine rides the low-loader: a carrier carried
      const { carrier, loads } = carriage(ctx, payload.machine, true, '');
      const r = ctx.command('moves.dispatch', {
        legs: [{ carrier, from: [m.pos[0], m.pos[1]], to: [tr.to[0], tr.to[1]], maxOffroad: SITE_OFFROAD }],
        loads,
        purpose: 'relocate',
        requester: EQUIPMENT_MODULE_ID,
      });
      if (!r.ok) {
        // destination unreachable after all: unload and send the haulier home (paid), machine stays
        setTransport(ctx, payload.machine, null);
        update(ctx, payload.machine, { status: 'ready' }, ['destination', 'until', 'move']);
        ctx.blockers.clear(payload.machine);
        ctx.after(LOW_LOADER_HANDLING_H * 0.5 * HOUR, 'lowLoaderHome', {
          machine: payload.machine,
          // (read before the transport was cleared: who pays the way home)
          ...(tr.payer ? { payer: tr.payer } : {}),
        });
        ctx.log('warn', `Low-loader cannot reach the destination of ${md.label}: ${r.reasons.map((b) => ctx.formatBlocker(b)).join('; ')}`, [payload.machine]);
        return;
      }
      // there when it is off the ramp (the carrier's unloading)
      const arrive = span(ctx, r.value).arrive + ctx.port('moves').unloadTime(lowLoaderProfile(ctx), md.operatingWeight.value);
      chargeHaulier(ctx, payload.machine, moveHours(ctx, r.value) + LOW_LOADER_HANDLING_H, `Relocation ${md.label} (loaded run, loading/unloading)`);
      setTransport(ctx, payload.machine, {
        ...tr,
        stage: 'loaded',
        move: r.value,
        eta: arrive,
      });
      update(ctx, payload.machine, { move: r.value, until: arrive });
      ctx.blockers.set(payload.machine, [
        {
          code: 'equipment.arriving',
          severity: 'info',
          params: { until: ctx.calendar.format(arrive) },
        },
      ]);
    },
    lowLoaderHome(ctx, payload: { machine: EntityId; payer?: EntityId }) {
      const m = machineGet(ctx, payload.machine);
      const ext = ctx.port('routing').externalNodes()[0];
      if (!m || ext === undefined) return;
      const r = ctx.command('moves.dispatch', {
        legs: [{ carrier: { class: lowLoaderProfile(ctx) }, from: [m.pos[0], m.pos[1]], to: [m.pos[0], m.pos[1]], externalDestination: ext, maxOffroad: SITE_OFFROAD }],
        purpose: 'lowloader-return',
        ref: payload.machine,
        requester: EQUIPMENT_MODULE_ID,
      });
      if (r.ok) chargeHaulier(ctx, payload.machine, moveHours(ctx, r.value), `Relocation ${model(ctx, m.model).label} (return)`, payload.payer);
    },
    fitterDepart(ctx, payload: { machine: EntityId }) {
      const job = ctx.state('equipment').repairs[payload.machine];
      if (!job || (job.stage !== 'awaitingFitter' && job.stage !== 'awaitingParts') || job.next !== ctx.now) return;
      dispatchFitter(ctx, payload.machine);
    },
    fitterLeave(ctx, payload: { machine: EntityId }) {
      fitterLeaves(ctx, payload.machine);
    },
    mended(ctx, payload: { machine: EntityId }) {
      const m = machineGet(ctx, payload.machine);
      const left = ctx.state('equipment').mending?.[payload.machine];
      if (!m || m.status !== 'broken' || ctx.state('equipment').repairs[payload.machine] || left === undefined) return;
      // (an hour of mending for each hour one of its holder's is by it)
      const now = holderWith(ctx, payload.machine) ? left - 1 : left;
      if (now > 1e-9) {
        ctx.setState('equipment', { ...ctx.state('equipment'), mending: { ...(ctx.state('equipment').mending ?? {}), [payload.machine]: now } });
        mendingSaid(ctx, payload.machine);
        ctx.at(ctx.now + Math.min(1, now) * HOUR, 'mended', payload);
        return;
      }
      const { [payload.machine]: _m, ...mending } = ctx.state('equipment').mending ?? {};
      ctx.setState('equipment', { ...ctx.state('equipment'), mending });
      update(ctx, payload.machine, { status: 'ready' }, ['until']);
      ctx.blockers.clear(payload.machine);
      ctx.emit('equipment.repaired', { machine: payload.machine });
      ctx.log('success', `${model(ctx, m.model).label} mended`, [payload.machine]);
    },
    repaired(ctx, payload: { machine: EntityId }) {
      const m = machineGet(ctx, payload.machine);
      const job = ctx.state('equipment').repairs[payload.machine];
      if (!m || m.status !== 'broken' || !job || job.stage !== 'repairing' || (m.until ?? 0) > ctx.now) return;
      const svc = ctx.data('equipmentSettings').repairService;
      postRepair(ctx, payload.machine, svc.fitterRate.value * index(ctx, ctx.now) * job.hours, `fitter ${job.hours.toFixed(1)} h on site`);
      setRepair(ctx, payload.machine, null);
      update(ctx, payload.machine, { status: 'ready' }, ['until']);
      ctx.blockers.clear(payload.machine);
      ctx.emit('equipment.repaired', { machine: payload.machine });
      ctx.log('success', `${model(ctx, m.model).label} repaired (${ctx.calendar.format(job.brokeAt)} → now)`, [payload.machine]);
      fitterLeaves(ctx, payload.machine);
    },
    // the evening's fuel round: machines by the stock filled there by hand, the others brought theirs by one of our vehicles
    fuelRound(ctx, payload: { party: EntityId }) {
      const hold = ctx.port('holdings');
      const moves = ctx.port('moves');
      // the end of the working day, its people still with their tools: a tool used today looked after (sharpened, set);
      // a service its holder does, done now (design/physical-state.md I6: by one of theirs, by it)
      for (const [id, m] of [...ctx.all('Machine')].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (userOf(ctx, id) !== payload.party || m.status !== 'ready' || !holderWith(ctx, id)) continue;
        const md = model(ctx, m.model);
        if (md.wear && m.hoursSinceService > 0 && m.lastActive !== undefined && m.lastActive > ctx.calendar.startOfDay(ctx.now)) update(ctx, id, { hoursSinceService: 0 });
        else if (md.engine && engineOf(md).repairBy === 'holder' && ctx.state('equipment').serviceDue[id] !== undefined && ctx.state('equipment').serviceDue[id]! <= ctx.now) {
          dropServiceDue(ctx, id);
          beginService(ctx, id);
        }
      }
      const byHand: string[] = [];
      // (a round per stock, each machine brought its own fuel: diesel for the loader, two-stroke mix for the saw, r38)
      const byStore = new Map<string, { store: EntityId; wants: { machine: EntityId; qty: number }[] }>();
      for (const [id, m] of [...ctx.all('Machine')].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const md = model(ctx, m.model);
        if (!md.engine || userOf(ctx, id) !== payload.party || m.status !== 'ready' || !m.tank || moves.placeOf(id)?.on !== undefined || !moves.where(id) || idling(ctx, id)) continue;
        const missing = md.engine.tankSize.value - fuelIn(ctx, id);
        if (missing <= Math.min(0.5, md.engine.tankSize.value * 0.05)) continue;
        const store = nearestFuel(ctx, moves.where(id)!, fuelOf(md), payload.party);
        if (!store) continue;
        if (hold.together(store, m.tank)) {
          if (fill(ctx, id, store, Math.min(missing, hold.stock(store, fuelOf(md))))) byHand.push(md.label);
        }
        else {
          const key = store;
          byStore.set(key, { store, wants: [...(byStore.get(key)?.wants ?? []), { machine: id, qty: missing }] });
        }
      }
      for (const { store, wants } of byStore.values()) {
        const r = bringFuel(ctx, payload.party, store, wants, 'fuel round');
        if ('why' in r) ctx.log('warn', `No fuel round tonight from ${hold.label(store)}: ${r.why}; ${wants.length} machine(s) not refuelled.`, wants.map((w) => w.machine));
      }
      if (byHand.length) ctx.log('info', `Tanks filled by hand at the stock: ${byHand.join(', ')}.`, []);
    },
    serviceStart(ctx, payload: { machine: EntityId }) {
      const m = machineGet(ctx, payload.machine);
      dropServiceDue(ctx, payload.machine);
      if (!m) return;
      const md = model(ctx, m.model);
      if (m.status !== 'ready') {
        // broken / travelling: try again at the next evening after it is free
        scheduleService(ctx, payload.machine, Math.max(ctx.now + 1, m.until ?? ctx.now + 1));
        return;
      }
      // (design/physical-state.md I6: someone does it, there) its holder's own, with one of theirs by it; else the dealer's
      // fitter, who comes to it (the machine works on until they are there)
      if (engineOf(md).repairBy === 'holder') {
        // (none of theirs by it now: done at the end of a working day, when one of them is: fuelRound)
        if (!holderWith(ctx, payload.machine)) {
          ctx.setState('equipment', { ...ctx.state('equipment'), serviceDue: { ...ctx.state('equipment').serviceDue, [payload.machine]: ctx.now } });
          return;
        }
        return beginService(ctx, payload.machine);
      }
      const svc = ctx.data('equipmentSettings').repairService;
      const ext = ctx.port('routing').externalNodes()[0];
      const to = ext !== undefined ? (ctx.port('routing').approach(ext, m.pos, svc.vehicleProfile, FITTER_WALK, ctx.hasData('labourSettings') ? ctx.data('labourSettings').ways.walk : undefined, 'in', { maxOffroad: SITE_OFFROAD }) ?? m.pos) : m.pos;
      const r = ext !== undefined ? ctx.command('moves.dispatch', { legs: [{ carrier: { class: svc.vehicleProfile }, from: [to[0], to[1]], to: [to[0], to[1]], externalNode: ext, maxOffroad: SITE_OFFROAD }], purpose: 'service-call', ref: payload.machine, requester: EQUIPMENT_MODULE_ID }) : null;
      if (!r || !r.ok) {
        // (said, with where it would have to go for the van to get there: r38, not tried in silence for ever)
        const md = model(ctx, m.model);
        const reachable = ext !== undefined ? ctx.port('routing').approach(ext, m.pos, svc.vehicleProfile, 2000, undefined, 'in', { maxOffroad: SITE_OFFROAD }) : undefined;
        const why = r && !r.ok ? r.reasons.map((b) => ctx.formatBlocker(b)).join('; ') : 'no way in for it';
        ctx.blockers.set(payload.machine, [{ code: 'equipment.fitterCannotCome', severity: 'warn', params: { machine: md.label, why }, remedies: reachable ? [{ label: `Move the ${md.label} to where the fitter's van gets (${Math.round(Math.hypot(reachable[0] - m.pos[0], reachable[1] - m.pos[1]))} m)`, command: { type: 'equipment.moveTo', payload: { machine: payload.machine, to: [reachable[0], reachable[1]] } } }] : [] }]);
        scheduleService(ctx, payload.machine, nextServiceMorning(ctx, ctx.now + HOUR));
      }
    },
    serviceDone(ctx, payload: { machine: EntityId }) {
      const m = machineGet(ctx, payload.machine);
      if (!m || m.status !== 'servicing') return;
      update(ctx, payload.machine, { status: 'ready' }, ['until']); // refuelled at night from the yard stock, like any day
      ctx.blockers.clear(payload.machine);
      ctx.emit('equipment.serviceDone', { machine: payload.machine });
      // (the dealer's fitter, done, drives home)
      if (ctx.state('equipment').fitterServicing?.[payload.machine]) {
        const { [payload.machine]: _done, ...rest } = ctx.state('equipment').fitterServicing ?? {};
        ctx.setState('equipment', { ...ctx.state('equipment'), fitterServicing: rest });
        fitterLeaves(ctx, payload.machine);
      }
    },
  },
  setup(ctx) {
    // every model is of a class the practice pack knows
    const classes = ctx.data('equipmentClasses');
    for (const [id, md] of Object.entries(ctx.data('machineModels'))) if (!classes[md.class]) throw new Error(`machineModels.${id}: no equipment class '${md.class}' in the practice pack`);
    // one repair model: a breakdown mended by the field service must be within what the cost list leaves for it (else it is the holder's to mend, or the data are wrong)
    for (const [id, md] of Object.entries(ctx.data('machineModels'))) {
      if (!md.engine || md.engine.repairBy === 'holder' || md.repairCostPerMonth.value <= 0) continue;
      const budget = perBreakdown(ctx, md);
      const field = fieldTime(ctx, md);
      if (field > budget * 1.05) throw new Error(`machineModels.${id}: the field service's time on a breakdown (${Math.round(field)} €) is more than its repair cost leaves per breakdown (${Math.round(budget)} €): mended by its holder (engine.repairBy: 'holder'), or the repair cost, MTBF or MTTR are wrong`);
    }
  },
  systems: [
    // electricity: the hour past made by panels and generators; a day's self-discharge of the batteries
    { id: 'power', every: HOUR, offset: 0, phase: 'physical', run: powerHour },
    { id: 'selfDischarge', every: DAY, offset: 3 * HOUR, phase: 'physical', run: selfDischarge },
    // the administrator goes on with what could not go at the opening (arrived since, repaired, packed up)
    { id: 'windUp', every: DAY, offset: 9 * HOUR, phase: 'agents', run: (ctx) => ctx.port('prices').woundUp().forEach((p) => windUp(ctx, p, false)) },
    {
      // 00:00: owning cost (non-cash: depreciation + imputed interest written off the book value) and nightly refuelling
      id: 'daily-owning',
      every: DAY,
      phase: 'economy',
      run(ctx) {
        const owning = new Map<EntityId, { amount: number; ids: EntityId[] }>();
        const dry: Record<string, EntityId[]> = {};
        for (const [id, m] of ctx.all('Machine')) {
          const md = model(ctx, m.model);
          const patch: Partial<Machine> = {};
          if (m.ownership === 'owned' && (m.bookValue ?? 0) > 0) {
            const daily = round2(Math.min(m.bookValue!, (md.owningCostPerMonth.value * index(ctx, m.acquiredAt)) / DAYS_PER_MONTH));
            const o = owning.get(m.holder) ?? { amount: 0, ids: [] };
            o.amount += daily;
            o.ids.push(id);
            owning.set(m.holder, o);
            patch.bookValue = round2(m.bookValue! - daily);
          }
          // upkeep of what has no engine to service (a caravan's seals, tyres and gas check): its cost list's repair cost, by the month
          // (only what is here and in use: not one on its way, nor a wreck or one worn out)
          // (shared with those who borrowed it for nothing, by the days of the month they kept it)
          const first = ctx.calendar.at(ctx.now).day === 1;
          if (m.ownership === 'owned' && !md.engine && md.repairCostPerMonth.value > 0 && m.status !== 'broken' && m.status !== 'arriving' && first && m.acquiredAt < ctx.now - DAY) {
            const days = ctx.calendar.at(ctx.now - DAY).day;
            shareOut(ctx, id, m, md.repairCostPerMonth.value * index(ctx, ctx.now), `Upkeep ${md.label} (a month)`, Object.fromEntries(Object.entries(m.keptBy ?? {}).map(([p0, d]) => [p0, Math.min(1, d / days)])), (p0) => `${m.keptBy![p0]} of the ${days} days theirs`);
          }
          // today kept by whom (a new month counted afresh)
          if (!md.engine && md.repairCostPerMonth.value > 0) {
            const k = keeperOf(ctx, id).party;
            const kept = first ? {} : { ...m.keptBy };
            if (k !== m.holder) kept[k] = (kept[k] ?? 0) + 1;
            if (first || k !== m.holder) patch.keptBy = kept;
          }
          // at night: machines by the stock filled there by hand (the others were brought theirs by the evening's fuel round)
          const tank = md.engine?.tankSize.value ?? 0;
          const missing = tank - fuelIn(ctx, id);
          const slack = Math.min(0.5, tank * 0.05);
          // (a tool used today was looked after at the end of the working day by one of its holder's, there: eveningCare)
          // (a generator running idle, its batteries full, is not filled to idle on)
          if (md.engine && (m.status === 'ready' || m.status === 'servicing') && missing > slack && !idling(ctx, id)) {
            const hold = ctx.port('holdings');
            const material = fuelOf(md);
            const store = nearestFuel(ctx, machineAt(ctx, id).pos, material, lentTo(ctx, id) ?? m.holder);
            const avail = store ? hold.stock(store, material) : 0;
            const take = Math.min(avail, missing);
            // (where it stands by the store, by hand; the others had theirs brought by the evening's round)
            if (take > 1e-6 && store && hold.together(store, m.tank ?? store)) fill(ctx, id, store, take);
            else if (take < missing - slack || !store) (dry[material] ??= []).push(id);
          }
          if (Object.keys(patch).length) update(ctx, id, patch);
        }
        for (const holder of [...owning.keys()].sort()) {
          const o = owning.get(holder)!;
          ctx.ledger.post({
            from: acct(holder, ACCOUNTS.fixedAssets),
            to: acct(holder, ACCOUNTS.equipmentOwning),
            amount: o.amount,
            memo: `Owning cost (depreciation + interest) ${o.ids.length} machines`,
            category: ACCOUNTS.equipmentOwning,
            refs: o.ids,
          });
        }
        for (const [material, ids] of Object.entries(dry)) {
          const label = ctx.port('holdings').material(material).label;
          ctx.log('warn', `${label} ran short: ${ids.length} machine(s) could not be refuelled fully tonight — order ${label} for the yard.`, ids);
        }
        // today's fuel round of each party with engines: a quarter of an hour before its working day ends, its people still there
        if (ctx.hasPort('workforce')) {
          const parties = new Set<EntityId>();
          for (const [id, m] of ctx.all('Machine')) if ((model(ctx, m.model).engine || model(ctx, m.model).wear) && m.status !== 'arriving') parties.add(userOf(ctx, id));
          for (const party of [...parties].sort()) {
            const w = ctx.port('workforce').shiftWindow(ctx.now, party);
            if (w && w.end - 15 * 60 > ctx.now) ctx.at(w.end - 15 * 60, 'fuelRound', { party });
          }
        }
      },
    },
    {
      // end of day: rental day rate for every working day (of the hire firms' week) the machine was on hire and not broken down
      id: 'daily-rental',
      every: DAY,
      offset: DAY - 1,
      phase: 'economy',
      run(ctx) {
        if (!isWorkingDay(ctx, ctx.now)) return;
        const rented: EntityId[] = [];
        const last: EntityId[] = [];
        // (off-hired: the rent runs to its off-hire day and stops; it stands for the hire firm to collect)
        for (const [id, m] of ctx.all('Machine')) if (hireDayOwed(ctx, m, ctx.now)) (m.status === 'offHired' && ctx.calendar.startOfDay(ctx.now) === ctx.calendar.startOfDay(m.hireEnds!) ? last : rented).push(id);
        postRentalDay(ctx, rented, `Rental ${ctx.calendar.format(ctx.now, 'day')}: ${rented.length} machines`);
        for (const id of last) postRentalDay(ctx, [id], `Rental ${model(ctx, machineAt(ctx, id).model).label} (off-hire day)`);
      },
    },
  ],
  ports: { equipment: equipmentPort },
  projections: {
    'equipment.fleet': {
      label: 'Machine fleet',
      description: 'args: party (whose machines, held or borrowed; a client sees its own)',
      compute(ctx, args?: { party?: EntityId }) {
        const port = equipmentPort(ctx);
        return [...ctx.all('Machine')].filter(([id, m]) => !args?.party || m.holder === args.party || lentTo(ctx, id) === args.party).map(([id, m]) => ({
          id,
          label: model(ctx, m.model).label,
          ...m,
          pos: port.positionAt(id, ctx.now),
          hourlyCost: port.hourlyCost(id),
          blockers: ctx.blockersOf(id).map((b) => ctx.formatBlocker(b)),
        }));
      },
    },
    'equipment.totals': { label: 'Fleet statistics', compute: (ctx) => ctx.state('equipment').totals },
  },
});
