/**
 * Electricity (design/physical-state.md 8g, VISION "Electricity is a supply like fuel"): a good in kWh, held in the
 * batteries units carry (a portable power station), never loaded as goods: it goes along a cable within reach, or in a
 * battery carried. A battery takes at its charge rate, stores a share of what goes in, takes nothing below its lowest
 * charging temperature, loses a little standing and holds less as it is cycled. A panel makes it from the sun of each
 * hour; a generator, started by one of ours at it, from its fuel, as much as the batteries and the phones by it take,
 * idling when they are full. Phones are plugged in wherever there is power by their people: a running generator, a
 * battery of theirs within reach.
 */
import { DAY, HOUR, type EntityId, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type { HourWeather } from '../../weather/src/index.ts';
import { fuelPerHour, inHand, type MachineModel } from './contract.ts';

export const ELECTRICITY = 'electricity';
const RAD = Math.PI / 180;

const modelOf = (read: ReadCtx, id: string): MachineModel => read.data('machineModels')[id]!;

/** the battery a unit carries: a holding of electricity riding with it, charged as shipped (over the world's edge, in its price) */
export function batteryFor(ctx: WriteCtx, id: EntityId, md: MachineModel, holder: EntityId, pos: Vec2, setup: boolean): EntityId | undefined {
  if (!md.battery) return undefined;
  const r = ctx.command('inventory.createStore', { holder, label: `${md.label}: battery`, kind: 'battery', pos: [pos[0], pos[1]], on: id, holds: [ELECTRICITY], capacity: md.battery.capacity.value, rate: md.battery.outputRate.value });
  if (!r.ok) throw new Error(`battery for ${md.label}: ${JSON.stringify(r.reasons)}`);
  const store = r.value as EntityId;
  const shipped = { store, material: ELECTRICITY, qty: md.battery.capacity.value * md.battery.shipped.value, why: `the ${md.label} as it is shipped` };
  if (shipped.qty > 1e-9) {
    const f = setup ? ctx.command('inventory.genesis', shipped) : ctx.command('inventory.fromOutside', { into: store, material: ELECTRICITY, qty: shipped.qty, why: shipped.why });
    if (!f.ok) throw new Error(`charging ${md.label}: ${JSON.stringify(f.reasons)}`);
  }
  return store;
}

/** what a battery holds at most now: its capacity, fading to 80 % over its cycle life (and on, to half) */
export function capacityOf(read: ReadCtx, machine: EntityId): number {
  const m = read.get('Machine', machine);
  const b = m && modelOf(read, m.model).battery;
  if (!b) return 0;
  const cycles = (m.charged ?? 0) / Math.max(1e-9, b.capacity.value);
  return b.capacity.value * Math.max(0.5, 1 - (0.2 * cycles) / b.cycles.value);
}

/** where a unit is, standing (not on a move) */
function standing(read: ReadCtx, id: EntityId): Vec2 | undefined {
  const moves = read.port('moves');
  if (moves.placeOf(id)?.on !== undefined) return undefined;
  const w = moves.where(id);
  return w ? [w[0], w[1]] : undefined;
}

/** who uses a unit: its borrower while it is lent out, else its holder */
export function userOfUnit(read: ReadCtx, id: EntityId): EntityId | undefined {
  const m = read.get('Machine', id);
  // (still to come, or handed back to its hire firm: nobody of ours uses it, charges from it or charges it)
  if (!m || !inHand(m)) return undefined;
  return read.contributions('machineUser').map((c) => c.impl(read, id)).find((x): x is EntityId => Boolean(x)) ?? m.holder;
}

/** the units that hold or make power (batteries, panels): the only ones the hour's and the day's power looks at (decision 0025) */
export const powered = (read: ReadCtx): EntityId[] => (read.state('equipment').powered ?? []).filter((id) => read.has('Machine', id));

/** a unit that holds or makes power, kept in the index from its acquiring until it leaves the world */
export function indexPowered(ctx: WriteCtx, id: EntityId, md: MachineModel, on: boolean): void {
  if (!md.battery && !md.panel) return;
  const was = ctx.state('equipment').powered ?? [];
  const next = on ? (was.includes(id) ? was : [...was, id]) : was.filter((x) => x !== id);
  if (next !== was) ctx.setState('equipment', { ...ctx.state('equipment'), powered: next });
}

/**
 * The batteries a party uses within a cable's reach of a place, and what each takes in an hour's share `f` (stored kWh):
 * its room, its own charge rate over the hour whatever charges it (what it took this hour from other sources counted),
 * nothing when too cold
 */
function takers(read: ReadCtx, party: EntityId, at: Vec2, cable: number, f: number, temp: number | undefined, took: ReadonlyMap<EntityId, number>): { machine: EntityId; store: EntityId; takes: number; cold: boolean; eff: number }[] {
  const hold = read.port('holdings');
  const out: { machine: EntityId; store: EntityId; takes: number; cold: boolean; eff: number }[] = [];
  for (const id of powered(read)) {
    const m = read.require('Machine', id);
    if (!m.battery || userOfUnit(read, id) !== party) continue;
    const b = modelOf(read, m.model).battery!;
    const pos = standing(read, id);
    if (!pos || Math.hypot(pos[0] - at[0], pos[1] - at[1]) > cable) continue;
    const cold = temp !== undefined && temp < b.minChargeTemp.value;
    const room = Math.max(0, capacityOf(read, id) - hold.stock(m.battery, ELECTRICITY));
    const rate = Math.max(0, b.chargeRate.value * f * b.efficiency.value - (took.get(id) ?? 0));
    out.push({ machine: id, store: m.battery, takes: cold ? 0 : Math.min(room, rate), cold, eff: b.efficiency.value });
  }
  return out;
}

/** energy a source offers (kWh) shared among the batteries that take it, by what each takes: what each stores, and what was taken from the source */
function share(offered: number, ts: ReturnType<typeof takers>): { stored: Map<EntityId, number>; used: number } {
  const want = ts.reduce((s, t) => s + t.takes / t.eff, 0);
  const stored = new Map<EntityId, number>();
  if (!(want > 1e-12) || !(offered > 1e-12)) return { stored, used: 0 };
  const k = Math.min(1, offered / want);
  let used = 0;
  for (const t of ts) {
    const input = (t.takes / t.eff) * k;
    if (input > 1e-12) stored.set(t.machine, input * t.eff);
    used += input;
  }
  return { stored, used };
}

/** a party's people (its staff here and its household's members), once an hour for all its sources (decision 0025) */
type People = (party: EntityId) => EntityId[];
function peopleOf(read: ReadCtx): People {
  const seen = new Map<EntityId, EntityId[]>();
  return (party) => {
    let out = seen.get(party);
    if (!out) {
      const wf = read.port('workforce');
      out = [...new Set([...wf.staff(party), ...wf.members(party)])].sort();
      seen.set(party, out);
    }
    return out;
  };
}

/**
 * The phones of a party's people standing within a source's reach, and what each would draw from it over the hour's
 * share `f` (kWh, what goes in before its charger's losses); a phone charged already this hour by another source is left
 */
function phonesBy(read: ReadCtx, people: People, party: EntityId, at: Vec2, within: number, f: number, charged: ReadonlySet<EntityId>): Map<EntityId, number> {
  const out = new Map<EntityId, number>();
  if (!read.hasPort('workforce')) return out;
  const wf = read.port('workforce');
  const moves = read.port('moves');
  for (const id of people(party)) {
    if (charged.has(id)) continue;
    const w = moves.where(id);
    if (!w || Math.hypot(w[0] - at[0], w[1] - at[1]) > within) continue;
    const draw = wf.phoneDraw(id, f);
    if (draw > 1e-12) out.set(id, draw);
  }
  return out;
}

/** phones charged from a source: what each drew, said to whom they belong (the source took it from its battery or its fuel) */
function phonesCharged(ctx: WriteCtx, draws: ReadonlyMap<EntityId, number>, charged: Set<EntityId>): void {
  const rec = Object.fromEntries([...draws].filter(([, q]) => q > 1e-12));
  if (!Object.keys(rec).length) return;
  ctx.command('workforce.phonesCharged', { draws: rec });
  for (const id of Object.keys(rec)) charged.add(id);
}

/** the energy taken in counts toward a battery's cycles */
function cycled(ctx: WriteCtx, machine: EntityId, kWh: number): void {
  const m = ctx.require('Machine', machine);
  ctx.set('Machine', machine, { ...m, charged: (m.charged ?? 0) + kWh });
}

/** a battery too cold to take a charge: said once a day */
function tooCold(ctx: WriteCtx, ts: ReturnType<typeof takers>, source: string): void {
  const day = Math.floor(ctx.now / DAY);
  const st = ctx.state('equipment');
  for (const t of ts.filter((x) => x.cold)) {
    if (st.coldSaid?.[t.machine] === day) continue;
    const md = modelOf(ctx, ctx.require('Machine', t.machine).model);
    ctx.log('warn', `${md.label} is too cold to take a charge (below ${md.battery!.minChargeTemp.value} °C): what the ${source} makes is lost.`, [t.machine]);
    ctx.setState('equipment', { ...ctx.state('equipment'), coldSaid: { ...(ctx.state('equipment').coldSaid ?? {}), [t.machine]: day } });
  }
}

/**
 * The sun on a panel facing south at its tilt, from the hour's sun on the flat (W/m²): the sky's diffuse light as the
 * part of the sky it sees, the sun's beam by its angle (isotropic sky, Liu & Jordan 1963); the beam's share of the light
 * from the cloud (an estimate)
 */
export function onPanel(ghi: number, elevation: number, azimuth: number, cloud: number, tilt: number): number {
  if (!(ghi > 0) || elevation <= 0) return 0;
  const beam = 0.75 * Math.max(0, 1 - cloud);
  const sinE = Math.sin(elevation * RAD);
  const cosT = sinE * Math.cos(tilt * RAD) + Math.cos(elevation * RAD) * Math.sin(tilt * RAD) * Math.cos((azimuth - 180) * RAD);
  const ratio = Math.min(3, Math.max(0, cosT) / Math.max(0.05, sinE));
  return ghi * ((1 - beam) * ((1 + Math.cos(tilt * RAD)) / 2) + beam * ratio);
}

/** the hour just past, [t, t + 1 h): panels made what its sun gave; generators what their batteries took */
export function powerHour(ctx: WriteCtx): void {
  const t = ctx.now - HOUR;
  // (the hour's weather, read only where something makes power, and never of an hour before the world began)
  let read = false;
  let hourW: HourWeather | undefined;
  const weather = () => {
    if (!read) hourW = t >= 0 && ctx.hasPort('weather') ? ctx.port('weather').hour(t) : undefined;
    read = true;
    return hourW;
  };
  // (what each battery has taken this hour, from whatever charged it; the phones charged this hour)
  const took = new Map<EntityId, number>();
  const charged = new Set<EntityId>();
  const people = peopleOf(ctx);
  const running = ctx.state('equipment').generating ?? {};
  for (const [id, g] of Object.entries(running)) generatorHour(ctx, id, g, t, weather()?.airTemp, took, people, charged);
  for (const id of powered(ctx)) {
    const m = ctx.require('Machine', id);
    const md = modelOf(ctx, m.model);
    if (!md.panel || m.status !== 'ready') continue;
    const hour = weather();
    if (!hour) continue;
    const temp = hour.airTemp;
    const at = standing(ctx, id);
    if (!at) continue;
    const made = (md.panel.peak.value * onPanel(hour.ghi, hour.sunElevation, hour.sunAzimuth, hour.cloud, md.panel.tilt.value) * md.panel.derate.value) / 1000;
    if (!(made > 1e-9)) continue;
    const user = userOfUnit(ctx, id);
    if (!user) continue;
    const ts = takers(ctx, user, at, md.panel.cable.value, 1, temp, took);
    tooCold(ctx, ts, md.label);
    const { stored } = share(made, ts);
    for (const [b, q] of stored) {
      ctx.command('inventory.extract', { from: 'sun', into: ctx.require('Machine', b).battery!, material: ELECTRICITY, qty: q, why: `the sun on the ${md.label}` });
      cycled(ctx, b, q);
      took.set(b, (took.get(b) ?? 0) + q);
    }
  }
  batteryPhones(ctx, people, charged);
}

/**
 * The hour's phones on the batteries (a power station): by each battery with charge in it, the phones of the people of
 * the party that uses it (its holder, or one it is lent to) standing within reach draw what they lack, as fast as their
 * chargers take, as far as the battery goes. Battery by battery and its party's people, not everyone against every
 * battery (decision 0025)
 */
function batteryPhones(ctx: WriteCtx, people: People, charged: Set<EntityId>): void {
  if (!ctx.hasPort('workforce')) return;
  const hold = ctx.port('holdings');
  const reach = ctx.data('labourSettings').ways.reach.value;
  for (const id of powered(ctx)) {
    const m = ctx.require('Machine', id);
    if (!m.battery) continue;
    const have = hold.stock(m.battery, ELECTRICITY);
    const user = userOfUnit(ctx, id);
    const at = standing(ctx, id);
    if (!(have > 1e-9) || !user || !at) continue;
    const draws = phonesBy(ctx, people, user, at, reach, 1, charged);
    const want = [...draws.values()].reduce((a, q) => a + q, 0);
    if (!(want > 1e-12)) continue;
    // (as far as it goes: shared by what each lacks)
    const k = Math.min(1, have / want);
    for (const [p, q] of draws) draws.set(p, q * k);
    ctx.command('inventory.release', { from: m.battery, material: ELECTRICITY, qty: want * k, to: 'air', why: `phones charged from the ${modelOf(ctx, m.model).label}` });
    phonesCharged(ctx, draws, charged);
  }
}

/** a generator's share of the hour past: fuel burnt by its load into the batteries and phones by it; idle when the batteries are full; stopped at its time or dry */
function generatorHour(ctx: WriteCtx, id: EntityId, g: { since: number; until: number; idle?: boolean }, t: number, temp: number | undefined, took: Map<EntityId, number>, people: People, charged: Set<EntityId>): void {
  const m = ctx.get('Machine', id);
  const stop = (why: string) => {
    const { [id]: _done, ...rest } = ctx.state('equipment').generating ?? {};
    ctx.setState('equipment', { ...ctx.state('equipment'), generating: rest });
    if (m) ctx.log('info', `${modelOf(ctx, m.model).label} has stopped: ${why}.`, [id]);
  };
  if (!m) return stop('it is gone');
  const md = modelOf(ctx, m.model);
  const at = standing(ctx, id);
  const f = Math.max(0, (Math.min(g.until, ctx.now) - Math.max(g.since, t)) / HOUR);
  if (!at || m.status !== 'ready' || !m.tank) return stop('it is not standing ready');
  if (f > 1e-9) {
    const hold = ctx.port('holdings');
    const fuel = md.engine?.fuel ?? 'diesel';
    const have = hold.stock(m.tank, fuel);
    const user = userOfUnit(ctx, id) ?? m.holder;
    const ts = takers(ctx, user, at, md.generator!.cable.value, f, temp, took);
    tooCold(ctx, ts, md.label);
    const most = md.generator!.output.value * f;
    // (the phones of ours within its lead plugged into it too: what they draw is load on it, as a battery's; Qwen S512)
    const phones = phonesBy(ctx, people, user, at, md.generator!.cable.value, f, charged);
    const { stored: all, used } = share(most, [...ts, ...[...phones].map(([p, q]) => ({ machine: p, store: '', takes: q, cold: false, eff: 1 }))]);
    const stored = new Map([...all].filter(([b]) => !phones.has(b)));
    // (burnt by its load; as far as its tank goes)
    const need = fuelPerHour(md, used / Math.max(1e-9, most)) * f;
    const k = need > 0 ? Math.min(1, have / need) : 1;
    const gives = [...stored].map(([b, q]) => ({ material: ELECTRICITY, qty: q * k, into: ctx.require('Machine', b).battery! }));
    if (need * k > 1e-9) ctx.command('inventory.transform', { at: m.tank, take: [{ material: fuel, qty: need * k }], give: gives, sink: 'air', why: `the ${md.label} running` });
    for (const [b, q] of stored) {
      cycled(ctx, b, q * k);
      took.set(b, (took.get(b) ?? 0) + q * k);
    }
    phonesCharged(ctx, new Map([...all].filter(([p]) => phones.has(p)).map(([p, q]) => [p, q * k])), charged);
    ctx.set('Machine', id, { ...ctx.require('Machine', id), engineHours: m.engineHours + f * k, hoursSinceService: m.hoursSinceService + f * k, lastActive: ctx.now });
    if (k < 1) return stop('it has run dry');
    // (idle: no battery takes a charge; a phone's few watts on a generator of kilowatts are next to nothing)
    const charging = [...stored.values()].some((q) => q > 1e-9);
    if (!charging && !g.idle) {
      ctx.log('warn', `${md.label} runs idle: no battery of ours within its cable takes a charge (they are full, or none is there), and it burns its fuel for next to nothing (a phone’s few watts at most).`, [id]);
      ctx.setState('equipment', { ...ctx.state('equipment'), generating: { ...ctx.state('equipment').generating, [id]: { ...g, idle: true } } });
    } else if (charging && g.idle) ctx.setState('equipment', { ...ctx.state('equipment'), generating: { ...ctx.state('equipment').generating, [id]: { ...g, idle: false } } });
  }
  if (g.until <= ctx.now) stop('its time is up');
}

/** a day standing: each battery loses its share (its cells, its electronics) */
export function selfDischarge(ctx: WriteCtx): void {
  const hold = ctx.port('holdings');
  for (const id of powered(ctx)) {
    const m = ctx.require('Machine', id);
    const b = m.battery && modelOf(ctx, m.model).battery;
    if (!b) continue;
    const lose = hold.stock(m.battery!, ELECTRICITY) * (b.selfDischarge.value * 12) / 365.25;
    if (lose > 1e-9) ctx.command('inventory.release', { from: m.battery!, material: ELECTRICITY, qty: lose, to: 'air', why: `the ${modelOf(ctx, m.model).label} standing` });
  }
}
