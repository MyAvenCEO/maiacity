/**
 * The daily life of people who live on site (decision 0025). Every evening each resident eats and
 * drinks from their store what the day asked of them (the needs contract) and sleeps what the
 * night leaves. What is missing adds up: hunger and tiredness carry over, thirst is the day's. It
 * slows their work (the workforce's `workCapacity`), costs health, makes them ill; family and
 * friends who are not fed go home. People who commute meet their needs at home and are not here.
 */
import { command, DAY, defineModule, ex, HOUR, s, type Blocker, type EntityId, type Explained, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import { actorOf, partyLabel, populationOf } from '../../parties/src/index.ts';
import { fillRemedies, isCounted, perHourOf, unitMass, type Material, type StoreUse } from '../../inventory/src/index.ts';
import type {} from '../../weather/src/index.ts';
import type {} from '../../workforce/src/index.ts';
import type {} from '../../land/src/index.ts';
import type {} from '../../equipment/src/index.ts';
import { linesHere, timetableDay } from '../../network/src/index.ts';
import type {} from '../../agreements/src/index.ts';
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import { LivingSettingsSchema, LodgingSchema, PhysiologySchema, SphereSchema, type Body, type LivingState, type Lodging, type LodgingData, type Resident } from './contract.ts';

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** someone living here: where they live (Resident) and their body (Body), read together and written back to each */
type Life = Resident & Body;
function lifeOf(read: ReadCtx, id: EntityId): Life | undefined {
  const r = read.get('Resident', id);
  const b = read.get('Body', id);
  return r && b ? { ...r, ...b } : undefined;
}
function requireLife(read: ReadCtx, id: EntityId): Life {
  const l = lifeOf(read, id);
  if (!l) throw new Error(`living: ${id} does not live here`);
  return l;
}
function setLife(ctx: WriteCtx, id: EntityId, l: Life): void {
  const { party, store, since, went, ...body } = l;
  ctx.set('Resident', id, { party, store, since, ...(went ? { went } : {}) });
  ctx.set('Body', id, body);
}
/** whose a person is: the household they live with or help, else the firm that employs them */
function partyOfPerson(read: ReadCtx, person: EntityId): EntityId | undefined {
  return read.get('Resident', person)?.party ?? read.get('Helper', person)?.of ?? read.get('Employment', person)?.employer;
}
/** a body as it comes into the world: rested, fed and watered (design/realism-plan.md S1) */
const NEW_BODY: Body = { hunger: 0, thirst: 0, sleepDebt: 0, health: 1, unmetDays: 0, lastDay: -1 };

/** everyone living here, with their bodies */
const lives = (read: ReadCtx): [EntityId, Life][] => [...read.all('Resident')].flatMap(([id]) => {
  const l = lifeOf(read, id);
  return l ? [[id, l] as [EntityId, Life]] : [];
});
/** the ground a person's camp takes (a small tent, a fireplace, a stack of crates) */
const CAMP_M2 = 12;
/** the evening meal: when the day is settled */
const EVENING_H = 20;
const HOURS = s.object({ bed: s.number({ min: 0, max: 24 }), rise: s.number({ min: 0, max: 24 }) });

/** what is in a store to eat (kcal) and to drink (l), by material */
function provisions(read: ReadCtx, store: EntityId) {
  const hold = read.port('holdings');
  const food: { material: string; per: number; have: number }[] = [];
  const water: { material: string; per: number; have: number }[] = [];
  for (const id of Object.keys(read.data('materials')).sort()) {
    const m = hold.material(id);
    const have = hold.stock(store, id);
    if (have <= 1e-9) continue;
    if (m.energy && m.energy.value > 0) food.push({ material: id, per: m.energy.value, have });
    if (m.water && m.water.value > 0) water.push({ material: id, per: m.water.value, have });
  }
  // the cleanest water is drunk first (camp L2)
  water.sort((a, b) => (hold.material(a.material).pathogens?.value ?? 0) - (hold.material(b.material).pathogens?.value ?? 0));
  return { food, water, kcal: food.reduce((a, f) => a + f.per * f.have, 0), litres: water.reduce((a, w) => a + w.per * w.have, 0) };
}

/**
 * What a store has to cook with (camp L1): of the goods there that cook with their heat (a camping stove, a
 * grill, a wood stove's top) and have their fuel there, the one that gets the most heat into the pot from it
 */
function cookerOf(read: ReadCtx, store: EntityId): { material: string; label: string; fuel: string; perFuel: number; fuelHave: number } | null {
  const hold = read.port('holdings');
  let best: { material: string; label: string; fuel: string; perFuel: number; fuelHave: number } | null = null;
  for (const id of Object.keys(read.data('materials')).sort()) {
    const m = hold.material(id);
    if (!m.cooks || !m.heat || hold.stock(store, id) < 1 - 1e-9) continue;
    // (kWh into the pot a unit of its fuel gives; the fuel there, in its own unit: electricity from the batteries by it
    // that carry its draw)
    const perFuel = (m.heat.output.value * m.cooks.efficiency.value) / Math.max(1e-9, perHourOf(m.heat, hold.material(m.heat.fuel)));
    const fuelHave = hold.supply(store, m.heat.fuel, m.heat.draw?.value);
    if (!best || fuelHave * perFuel > best.fuelHave * best.perFuel) best = { material: id, label: m.label, fuel: m.heat.fuel, perFuel, fuelHave };
  }
  return best;
}

/**
 * Of the foods eaten cooked, how much of each can be cooked at a store, the cooker's fuel and the water
 * shared between them in order (the water beyond what the household drinks in a day: cooking does not take
 * the water to drink); what binds each, and why. Food eaten as it is: no bound.
 */
function cookable(read: ReadCtx, store: EntityId, foods: readonly { material: string; have: number }[], litres: number): Record<string, { qty: number; why?: string; lacks?: 'cooker' | 'fuel' | 'water' }> {
  const hold = read.port('holdings');
  const cooker = cookerOf(read, store);
  const reserve = householdNeed(read, store, tomorrowHigh(read)).drinking;
  let kwh = cooker ? cooker.fuelHave * cooker.perFuel : 0;
  // a heater burning the same fuel through the night takes its share of it: cooking gets what a day's
  // cooking takes of a day's cooking and a night's heating
  const night = cooker && read.get('Heating', store)?.night ? nightFuel(read, store, cooker.fuel) : 0;
  const first = foods.find((f) => hold.material(f.material).cook);
  if (cooker && night > 0 && first) {
    const c0 = hold.material(first.material).cook!;
    const day = (householdNeed(read, store, tomorrowHigh(read)).energy / Math.max(1e-9, hold.material(first.material).energy?.value ?? 1)) * (c0.heat.value / cooker.perFuel);
    kwh *= day / Math.max(1e-9, day + night);
  }
  let water = Math.max(0, litres - reserve);
  const out: Record<string, { qty: number; why?: string; lacks?: 'cooker' | 'fuel' | 'water' }> = {};
  for (const f of foods) {
    const c = hold.material(f.material).cook;
    if (!c) {
      out[f.material] = { qty: Infinity };
      continue;
    }
    if (!cooker) {
      out[f.material] = { qty: 0, why: 'nothing to cook on', lacks: 'cooker' };
      continue;
    }
    const byFuel = kwh / Math.max(1e-9, c.heat.value);
    const byWater = water / Math.max(1e-9, c.water.value);
    const fuel = hold.material(cooker.fuel).label.toLowerCase();
    const unit = hold.material(f.material).unit;
    const kept = night > 0 ? ', the rest kept for the night\'s heating' : '';
    out[f.material] = byFuel <= byWater ? { qty: byFuel, why: byFuel <= 1e-9 ? `no ${fuel} for the ${cooker.label.toLowerCase()}${kept}` : `${fuel} for ${round(byFuel)} ${unit} more${kept}`, lacks: 'fuel' } : { qty: byWater, why: byWater <= 1e-9 ? 'no water to cook it in beyond what is drunk' : `water to cook ${round(byWater)} ${unit} beyond what is drunk`, lacks: 'water' };
    // (what this takes is not there for the next)
    const q = Math.min(f.have, out[f.material]!.qty);
    kwh = Math.max(0, kwh - q * c.heat.value);
    water = Math.max(0, water - q * c.water.value);
  }
  return out;
}

/** the fuel (in its own unit) tonight's heated rooms burn of it from a store (each room's heater, as far as it can run there; a cooker only does not heat) */
function nightFuel(read: ReadCtx, store: EntityId, fuel: string): number {
  // (what tonight's rooms burn of it from this store: each room's heater, as far as it can run there)
  let q = 0;
  for (const room of roomsTonight(read).values()) if (room.store === store && room.fuel === fuel && room.share > 0) q += room.need;
  return q;
}

/** the food energy a store's food gives, food eaten cooked only as far as it can be cooked there */
function eatableKcal(read: ReadCtx, store: EntityId): number {
  const p = provisions(read, store);
  const caps = cookable(read, store, p.food, p.litres);
  return p.food.reduce((a, f) => a + f.per * Math.min(f.have, caps[f.material]!.qty), 0);
}

/**
 * take up to `amount` (kcal or l) from the store's provisions; returns what was had. Used up into `sink` at once
 * (washing water to the ground, cooking water to the air as steam), its packaging left behind; or, with `sink`
 * 'body', only counted in `taken`: what is eaten and drunk leaves the body by the day's transform (settleDay)
 */
function take(ctx: WriteCtx, store: EntityId, from: { material: string; per: number; have: number }[], amount: number, purpose: string, taken: Record<string, number> | undefined, sink: 'air' | 'ground' | 'body'): number {
  let got = 0;
  for (const f of from) {
    if (got >= amount - 1e-9) break;
    const qty = Math.min(f.have - (sink === 'body' ? (taken?.[f.material] ?? 0) : 0), (amount - got) / f.per);
    if (qty <= 1e-9) continue;
    const r = sink === 'body' ? { ok: true } : ctx.command('inventory.release', { from: store, material: f.material, qty, to: sink, why: purpose, usedUp: true });
    if (r.ok) {
      got += qty * f.per;
      if (taken) taken[f.material] = (taken[f.material] ?? 0) + qty;
    }
  }
  return got;
}

/** the hours someone worked today: their party's working day, if they were here for it; a job beyond the map, if they went this morning */
function workHoursToday(read: ReadCtx, person: EntityId, party: EntityId): { hours: number; span: number; commute: number; by?: { machine: EntityId; label: string }; bus?: string } {
  const wf = read.port('workforce');
  // they keep the working day of whoever they work for (a job in town, once begun: that employer's), and its way there and back
  const employer = employerAt(read, person, read.now);
  const win = wf.shiftWindow(read.now, employer ?? party);
  if (!win || !employer) return { hours: 0, span: 0, commute: 0 };
  const shift = (win.end - win.start) / HOUR;
  if (townOf(read, party, employer)) {
    // a job beyond the map: worked if they set out for it this morning (not ill then), by what they set out with
    const went = lifeOf(read, person)?.went;
    if (!went || went.day !== Math.floor(read.calendar.startOfDay(read.now) / DAY)) return { hours: 0, span: 0, commute: 0 };
    return { hours: win.paidHours, span: shift + went.hours, commute: went.hours, ...(went.by ? { by: { machine: went.by, label: read.port('equipment').modelOf(went.by).label } } : {}), ...(went.bus ? { bus: went.bus } : {}) };
  }
  if (!wf.present(person)) return { hours: 0, span: 0, commute: 0 };
  return { hours: win.paidHours, span: shift, commute: 0 };
}

/** whom someone works for at t: their employer once the job has begun, else the household they belong to */
function employerAt(read: ReadCtx, person: EntityId, t: number): EntityId | undefined {
  const wf = read.port('workforce');
  const h = read.get('Helper', person);
  const e = read.get('Employment', person);
  // (the job's employer, whose shifts bind them, also while they are home from it)
  return e && wf.employed(person, t) ? e.employer : (h?.of ?? wf.worksFor(person));
}

/** an employer beyond the map someone of the party works for (economy pack: employers) */
function townOf(read: ReadCtx, party: EntityId, employer: EntityId) {
  return employer !== party && read.hasData('employers') ? read.data('employers')?.[employer] : undefined;
}

type Way = { hours: number; by?: { machine: EntityId; label: string }; bus?: { line: string; label: string; fare: number; leave: number; out: number } };

/**
 * The way to a job beyond the map and back (h): by the vehicle they ride to work (camp L4) when it can
 * take them; else by the bus (A4) when walking to its stop, riding and the timetable make it quicker than
 * walking all the way and the fare is there; else on foot.
 */
function commuteOf(read: ReadCtx, person: EntityId, party: EntityId, employer: EntityId): Way {
  const town = townOf(read, party, employer);
  if (!town) return { hours: 0 };
  const ride = rideOf(read, person, party, 2 * town.distance.value);
  if (ride) return { hours: ride.hours, by: { machine: ride.machine, label: ride.label } };
  // on foot, at the practice's walking pace
  const pace = read.hasData('handling') ? read.data('handling')?.walk.flat.value : undefined;
  if (!pace) throw new Error(`living: ${read.port('workforce').name(person)} walks to work beyond the map, and the practice gives no walking pace (data: handling.walk)`);
  const walk = (2 * town.distance.value) / pace;
  const bus = busOf(read, person, employer, pace);
  // (a fare to pay needs the money; with a pass there is none)
  if (bus && bus.hours < walk && (bus.fare <= 0 || read.port('prices').liquidity(party) >= bus.fare)) return { hours: bus.hours, bus: { line: bus.line, label: bus.label, fare: bus.fare, leave: bus.leave, out: bus.out } };
  return { hours: walk };
}

/** the bus to work today: the stop at the way in on foot, the last bus that is there before the shift, the first back after it */
function busOf(read: ReadCtx, person: EntityId, employer: EntityId, pace: number): { line: string; label: string; hours: number; leave: number; out: number; fare: number } | undefined {
  const lines = read.hasData('transitLines') ? read.data('transitLines') : undefined;
  const store = lifeOf(read, person)?.store;
  const home = store ? read.port('holdings').where(store) : undefined;
  const win = read.port('workforce').shiftWindow(read.calendar.startOfDay(read.now), employer);
  if (!lines || !home || !win) return undefined;
  const day0 = read.calendar.startOfDay(win.start);
  const kind = timetableDay(read, win.start, Boolean(read.port('workforce').holiday(day0 + HOUR)));
  if (!kind) return undefined;
  let best: { line: string; label: string; hours: number; leave: number; out: number; fare: number } | undefined;
  // a pass is the person's, whoever pays for it (their household, a relative, an employer's job ticket)
  const pass = read.hasPort('agreements') ? read.port('agreements').permitting(null, person, 'transit') : undefined;
  for (const id of linesHere(read)) {
    const line = lines[id]!;
    const stop = read.state('accesses').built[line.access]!.point;
    const walkS = (Math.hypot(home[0] - stop[0], home[1] - stop[1]) / 1000 / pace) * HOUR;
    const ride = line.minutes.value * 60;
    const out = line.toTown[kind].map((h) => day0 + h * HOUR).filter((t) => t + ride <= win.start).sort((a, b) => b - a)[0];
    const back = line.fromTown[kind].map((h) => day0 + h * HOUR).filter((t) => t >= win.end).sort((a, b) => a - b)[0];
    if (out === undefined || back === undefined) continue;
    const leave = out - walkS;
    const hours = (win.start - leave + (back + ride + walkS - win.end)) / HOUR;
    const single = read.hasData('transitFares') ? read.data('transitFares')?.[id]?.single.value : undefined;
    if (single === undefined) continue;
    // with a pass that covers the buses (a Deutschlandticket), no ticket to buy
    const fare = pass ? 0 : 2 * single * read.port('prices').index(read.now);
    if (!best || hours < best.hours) best = { line: id, label: line.label, hours, leave, out: (win.start - leave) / HOUR, fare };
  }
  return best;
}

/** the vehicle someone rides to work, if it can take them now: theirs to ride, at the camp, sound and fuelled; the hours there and back at its pace on the roads beyond the map */
function rideOf(read: ReadCtx, person: EntityId, party: EntityId, km: number): { machine: EntityId; label: string; hours: number } | undefined {
  if (!read.hasPort('equipment')) return undefined;
  const eq = read.port('equipment');
  const v = eq.riddenBy(person);
  const m = v ? read.get('Machine', v) : undefined;
  if (!v || !m || !eq.usableBy(v, party) || m.status !== 'ready' || eq.withRider(v)) return undefined;
  const store = lifeOf(read, person)?.store;
  const home = store ? read.port('holdings').where(store) : undefined;
  const at = eq.positionAt(v, read.now);
  if (!home || Math.hypot(at[0] - home[0], at[1] - home[1]) > read.data('livingSettings').atHand.value) return undefined;
  const md = eq.modelOf(v);
  if (!md.transport) return undefined;
  const speed = (read.hasPort('routing') ? read.port('routing').profile(md.transport.vehicleProfile).surfaceSpeed.external?.value : undefined) ?? md.transport.travelSpeed.value;
  const hours = km / speed;
  if (md.engine && eq.fuel(v) + 1e-9 < md.engine.fuelUse.value * hours) return undefined;
  return { machine: v, label: md.label, hours };
}

/**
 * The morning (camp L4): who of the household sets out for a job beyond the map today. Each sets out
 * the way before the shift (as they would go now); then one ill or on leave stays home, one whose
 * vehicle is at the camp and sound takes it (it is away with them until they are back), else they walk.
 */
function morning(ctx: WriteCtx): void {
  const wf = ctx.port('workforce');
  const day = ctx.calendar.startOfDay(ctx.now);
  for (const [id, e] of [...ctx.all('Employment')].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const r = lifeOf(ctx, id);
    if (!r || !townOf(ctx, r.party, e.employer)) continue;
    const win = wf.shiftWindow(day, e.employer);
    if (!win || !wf.employed(id, win.start)) continue;
    const way = commuteOf(ctx, id, r.party, e.employer);
    ctx.at(Math.max(ctx.now, way.bus ? way.bus.leave : win.start - (way.hours / 2) * HOUR), 'setOut', { person: id, start: win.start });
  }
}

/** one of the household sets out for their job beyond the map, or does not */
function setOut(ctx: WriteCtx, person: EntityId, start: number): void {
  const r = lifeOf(ctx, person);
  const e = ctx.get('Employment', person);
  if (!r || !e || !atHome(ctx, person) || !ctx.port('workforce').employed(person, start)) return;
  const p = ctx.get('Presence', person);
  if (p && p.status !== 'available' && (p.until ?? Infinity) > start) return;
  const win = ctx.port('workforce').shiftWindow(start, e.employer);
  if (!win) return;
  const way = commuteOf(ctx, person, r.party, e.employer);
  // the way there is a move (design/physical-state.md I2): on foot, or on the vehicle they ride (its fuel and hours
  // are its legs'); by bus, on foot to the stop and on beyond the map
  // (the routine of a working day: a lunch taken along, from home)
  packLunch(ctx, person, r, win.paidHours);
  if (!commute(ctx, person, r, e.employer, way, 'out')) return;
  ctx.at(win.end, 'comeBack', { person });
  if (way.by) ctx.command('equipment.rideOut', { machine: way.by.machine, person, until: win.end + (way.hours / 2) * HOUR });
  // the bus: the fare there and back, paid by the household
  if (way.bus && way.bus.fare > 0) ctx.ledger.post({ from: acct(r.party, ACCOUNTS.cash), to: acct(r.party, ACCOUNTS.transport), amount: Math.round(way.bus.fare * 100) / 100, memo: `${ctx.port('workforce').name(person)}: the bus to work and back (${way.bus.label})`, category: ACCOUNTS.transport, refs: [person] });
  setLife(ctx, person, { ...r, went: { day: Math.floor(ctx.calendar.startOfDay(start) / DAY), hours: way.hours, ...(way.bus ? { out: way.bus.out } : {}), ...(way.by ? { by: way.by.machine } : {}), ...(way.bus ? { bus: way.bus.line } : {}) } });
}

/** the way to a job beyond the map, out or back, as a move: false when there is no way */
function commute(ctx: WriteCtx, person: EntityId, r: Readonly<Resident>, employer: EntityId, way: Way, dir: 'out' | 'back', after = 0): boolean {
  const town = townOf(ctx, r.party, employer);
  const ext = ctx.port('routing').externalNodes()[0];
  const home = ctx.port('holdings').where(r.store);
  if (!town || ext === undefined || !home) return false;
  const eq = ctx.hasPort('equipment') ? ctx.port('equipment') : undefined;
  const profile = way.by && eq ? eq.modelOf(way.by.machine).transport?.vehicleProfile : undefined;
  const carrier = way.by && profile ? { class: profile, unit: way.by.machine } : { class: ctx.data('labourSettings').ways.walk, unit: person };
  const ends = dir === 'out' ? { externalDestination: ext } : { externalNode: ext };
  const r2 = ctx.command('moves.dispatch', {
    legs: [{ carrier, from: [home[0], home[1]], to: [home[0], home[1]], ...ends, beyondKm: way.bus ? 0 : town.distance.value, maxOffroad: 5000, loads: [], ...(carrier.unit !== person ? { inCharge: person } : {}), ...(after > 0 ? { notBefore: ctx.now + after } : {}) }],
    purpose: dir === 'out' ? 'to work' : 'home from work',
    ref: person,
    requester: 'living',
  });
  if (!r2.ok) ctx.log('warn', `${ctx.port('workforce').name(person)} cannot go ${dir === 'out' ? `to work at ${town.label}` : 'home from work'}: ${r2.reasons.map((b) => ctx.formatBlocker(b)).join('; ')}`, [person]);
  return r2.ok;
}

/** how needs that went unmet bear on the pace of work, explained */
function capacity(read: ReadCtx, person: EntityId): { factor: number; explain: Explained } | null {
  const r = read.get('Body', person);
  if (!r) return null;
  const set = read.data('livingSettings');
  const need = read.port('needs').requirement(person, { workHours: 8, tMax: 20 });
  const hunger = 1 - set.hunger.slows.value * Math.min(1, r.hunger / set.hunger.deficit.value);
  // (one living beyond the map, on it now: what they have gone short of so far in the hours not yet settled, review S1 #4)
  const thirst = 1 - set.thirst.slows.value * Math.min(1, (r.thirst + (read.get('Resident', person) ? 0 : openShort(read, person))) / Math.max(0.1, need.water.v));
  const tired = 1 - set.tiredness.slows.value * Math.min(1, r.sleepDebt / set.tiredness.debt.value);
  const health = 0.5 + 0.5 * r.health;
  const factor = hunger * thirst * tired * health;
  if (factor >= 0.999) return null;
  return {
    factor,
    explain: ex.mul('how they are today', '1', ex.value(hunger, '1', `${Math.round(r.hunger)} kcal short`, set.hunger.slows.source), ex.value(thirst, '1', `${round(r.thirst)} l of water short yesterday`, set.thirst.slows.source), ex.value(tired, '1', `${round(r.sleepDebt)} h of sleep owed`, set.tiredness.slows.source), ex.value(health, '1', `health ${Math.round(r.health * 100)} %`)),
  };
}

/**
 * The night after today's evening, by the person's own hours: the window from going to bed to
 * getting up, less what of it a working day set by others takes (they get up for work), and no
 * more than today's work and waking hours leave.
 */
function night(read: ReadCtx, person: EntityId, r: { party: EntityId; sleep?: { bed: number; rise: number } }, span: number, from = bedtime(read, r)): { hours: number; window: number; lost: number; bed: number; rise: number } {
  const set = read.data('livingSettings');
  const bed = r.sleep?.bed ?? set.sleepWindow.bed.value;
  const rise = r.sleep?.rise ?? set.sleepWindow.rise.value;
  const window = (((rise - bed) % 24) + 24) % 24;
  const to = from + window * HOUR;
  // a working day holds them to its hours only when it is someone else's to set (an employer's);
  // working for themselves, they work when they are up
  const wf = read.port('workforce');
  // (the day they wake to: a job that begins then binds the night's sleep)
  const wake = read.calendar.startOfDay(to);
  const employer = employerAt(read, person, wake + 12 * HOUR);
  const bound = wf.present(person) && employer && wf.scheduleOf(employer) === 'business';
  const shift = bound ? wf.shiftWindow(wake, employer) : null;
  const lost = shift ? Math.max(0, Math.min(to, shift.end) - Math.max(from, shift.start)) / HOUR : 0;
  const lieIn = shift ? 0 : set.lieIn.value;
  return { hours: Math.max(0, Math.min(window + lieIn - lost, 24 - span - set.awake.value)), window, lost, bed, rise };
}

const hhmm = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** where someone sleeps tonight and how well: the best shelter any module offers them, or the open sky */
type Envelope = { volume: number; airChange: number; loss: number; flue: boolean };
type Place = { quality: number; label: string; why: string[]; warming: number; place?: EntityId; envelope?: Envelope; open?: boolean };

/** the best place any module offers someone to sleep tonight (null: none) */
function placeOf(read: ReadCtx, person: EntityId): Place | null {
  let best: Place | null = null;
  for (const c of read.contributions('shelter')) {
    const sh = c.impl(read, person);
    // what makes the night worse than the shelter at its best: the factors of its explain trace below 1
    const why = (sh?.explain.args ?? []).slice(1).filter((a) => a.v < 0.999 && a.label).map((a) => a.label!);
    if (sh && (!best || sh.quality > best.quality)) best = { quality: sh.quality, label: sh.explain.label ?? c.module, why, warming: sh.warming ?? 0, ...(sh.place ? { place: sh.place } : {}), ...(sh.envelope ? { envelope: sh.envelope } : {}), ...(sh.open ? { open: true } : {}) };
  }
  return best;
}

function shelterOf(read: ReadCtx, person: EntityId, rooms = roomsTonight(read), heated = true): { quality: number; label: string; why: string[]; bedding: string; cold?: { warming: number }; heat?: Heat; chill: number } {
  const where = placeOf(read, person) ?? { quality: read.data('livingSettings').outside.value, label: 'sleeping outside, with no shelter', why: [], warming: 0 };
  // the night composed (camp C6): the envelope, the heat in it, the bedding, the cold of the night inside
  const room = heated && where.place && inTheRoom(read, person) ? rooms.get(where.place) : undefined;
  const heat = room ? { ...room, dose: room.ppm * bedHours(read, person) * room.share } : undefined;
  const cold = coldOf(read, person, where.warming + (heat?.dT ?? 0));
  const notes = [...(heat?.note ? [heat.note] : []), ...(cold.factor < 0.999 ? [cold.why] : [])];
  // how far colder than the bedding keeps one warm in the night is (K)
  const chill = Math.max(0, cold.comfort - cold.inside);
  return { quality: where.quality * cold.factor, label: where.label, why: [...where.why, ...notes], bedding: cold.bedding, ...(cold.factor < 0.999 ? { cold: { warming: where.warming + (heat?.dT ?? 0) } } : {}), ...(heat ? { heat } : {}), chill };
}

/** a heater running in a room tonight: how much warmer, what it burns from which store, and what of its fumes stays in the air */
interface Room {
  place: EntityId;
  label: string;
  /** where its fuel comes from, which fuel, and how much the night asks (in the fuel's own unit) */
  store: EntityId;
  fuel: string;
  need: number;
  /** the share of the night the fuel lasts */
  share: number;
  dT: number;
  /** carbon monoxide in the closed room while it burns (ppm) */
  ppm: number;
  /** what it burns an hour (the fuel's unit), and while it burns: the warmth (K) and the fumes (ppm) */
  perHour: number;
  full: { dT: number; ppm: number };
  /** the worst dose of a sleeper in it (ppm × h), for telling the household */
  worst: number;
  /** who sleeps in it tonight, for how many hours, from when */
  sleepers: { person: EntityId; hours: number; bed: number }[];
  note?: string;
}
type Heat = Room & { dose: number };

/** the hours someone lies in bed tonight: their window (bed to rise), as night() reckons it */
function bedHours(read: ReadCtx, person: EntityId): number {
  const set = read.data('livingSettings');
  const r = lifeOf(read, person);
  const bed = r?.sleep?.bed ?? set.sleepWindow.bed.value;
  const rise = r?.sleep?.rise ?? set.sleepWindow.rise.value;
  return (((rise - bed) % 24) + 24) % 24;
}

/** when someone goes to bed tonight (an evening bedtime tonight, one after midnight in the small hours) */
function bedtime(read: ReadCtx, r: { sleep?: { bed: number } }): number {
  const bed = r.sleep?.bed ?? read.data('livingSettings').sleepWindow.bed.value;
  return read.calendar.startOfDay(read.now) + (bed >= 12 ? bed : 24 + bed) * HOUR;
}

/** the next time someone goes to bed at or after `after`: the night after the last one, whatever hours they keep */
function nextBed(read: ReadCtx, r: { sleep?: { bed: number } }, after: number): number {
  const bed = r.sleep?.bed ?? read.data('livingSettings').sleepWindow.bed.value;
  const t = read.calendar.startOfDay(after) + bed * HOUR;
  return t >= after ? t : t + DAY;
}

/** the night is begun at bedtime (a night under way ends before the next begins: its end schedules the next) */
function scheduleBed(ctx: WriteCtx, person: EntityId, at: number): void {
  const r = lifeOf(ctx, person);
  if (!r) return;
  setLife(ctx, person, { ...r, bedAt: at });
  ctx.at(at, 'bed', { person, at });
}

/** whether someone sleeps here tonight: at home, or back by bedtime (not away on a course, a job, an errand that keeps them out) */
function inTheRoom(read: ReadCtx, person: EntityId, at?: number): boolean {
  if (!read.get('Presence', person) || read.get('Person', person)?.died) return false;
  const set = read.data('livingSettings');
  const bed = lifeOf(read, person)?.sleep?.bed ?? set.sleepWindow.bed.value;
  // (at an hour of the night: there then or not; else tonight's bedtime)
  return homeBy(read, person, at ?? read.calendar.startOfDay(read.now) + (bed >= 12 ? bed : 24 + bed) * HOUR);
}

/**
 * By their home store (within reach), or on their way back to it (there by `by`, if said): where the moves keep them
 * (design/physical-state.md I2), not what their status says.
 */
function homeBy(read: ReadCtx, person: EntityId, by?: number): boolean {
  const store = lifeOf(read, person)?.store;
  const home = store ? read.port('holdings').where(store) : undefined;
  if (!home) return false;
  const near = (p: readonly number[] | undefined) => p !== undefined && Math.hypot(p[0]! - home[0], p[1]! - home[1]) <= read.data('livingSettings').atHand.value;
  const moves = read.port('moves');
  if (by !== undefined) return near(moves.whereAt(person, by));
  // (now: here, or on the way back here by tonight's bedtime)
  const r = read.get('Resident', person);
  const bed = read.get('Body', person)?.sleep?.bed ?? read.data('livingSettings').sleepWindow.bed.value;
  const tonight = read.calendar.startOfDay(read.now) + (bed >= 12 ? bed : 24 + bed) * HOUR;
  return near(moves.where(person)) || (r !== undefined && moves.placeOf(person)?.on !== undefined && near(moves.whereAt(person, tonight)));
}

/**
 * Tonight's heaters, as planned at the evening (or when the household turns them on later): each heated
 * place's heater, its fuel and store, what it burns an hour and what it gives while it burns. The night
 * burns it hour by hour (sleepHour): only while the household still runs its heaters and has the fuel.
 */
function planTonight(ctx: WriteCtx, rooms: Map<EntityId, Room>, only?: EntityId): void {
  const plans = new Map<EntityId, Record<string, { label: string; fuel: string; perHour: number; dT: number; ppm: number }>>();
  for (const room of rooms.values()) {
    if (room.perHour <= 0 || !room.sleepers.length || (only && room.store !== only)) continue;
    plans.set(room.store, { ...(plans.get(room.store) ?? {}), [room.place]: { label: room.label, fuel: room.fuel, perHour: room.perHour, dT: room.full.dT, ppm: room.full.ppm } });
  }
  for (const [store, h] of [...ctx.all('Heating')]) {
    if (only && store !== only) continue;
    const plan = plans.get(store);
    const { plan: _old, ...rest } = h;
    ctx.set('Heating', store, { ...rest, ...(plan ? { plan } : {}) });
  }
}

/**
 * The heater of a place for one hour of the night: it burns that hour's fuel once (the first sleeper whose
 * hour it is lights it), while the household still runs it and has the fuel; part of the hour when the fuel
 * runs out. Its warmth and its fumes are the hour's, as far as it burned.
 */
function heaterHour(ctx: WriteCtx, place: EntityId, hour: number): { dT: number; ppm: number; label?: string } {
  for (const [store, h] of [...ctx.all('Heating')]) {
    const plan = h.plan?.[place];
    if (!plan) continue;
    if (!h.night) return { dT: 0, ppm: 0 };
    let lit = h.burnt[place] === hour ? (h.lit?.[place] ?? 0) : -1;
    if (lit < 0) {
      // (an electric heater draws its power an hour from the batteries by it that carry it)
      const hold = ctx.port('holdings');
      const draw = hold.material(plan.fuel).unit === 'kWh' ? plan.perHour : undefined;
      const have = hold.supply(store, plan.fuel, draw);
      const burn = Math.min(plan.perHour, have);
      if (burn > 1e-9) ctx.command('inventory.draw', { at: store, material: plan.fuel, qty: burn, to: 'air', why: `${plan.label}: an hour of the night's heating`, usedUp: true, ...(draw !== undefined ? { draw } : {}) });
      lit = plan.perHour > 0 ? burn / plan.perHour : 0;
      ctx.set('Heating', store, { ...h, burnt: { ...h.burnt, [place]: hour }, lit: { ...(h.lit ?? {}), [place]: lit } });
    }
    return { dT: plan.dT * lit, ppm: plan.ppm * lit, label: plan.label };
  }
  return { dT: 0, ppm: 0 };
}

/**
 * Tonight's heated rooms, reckoned once for everyone (camp L1): each household that runs its heaters
 * at night (living.heat) hands them to the rooms its people sleep in, the strongest that can run
 * there first (a stove needs a flue through the room), one a room; its fuel goes to the rooms in turn
 * as the night burns it. A heater warms a room by its output over the room's heat loss while its
 * fuel lasts; without a flue its carbon monoxide stays at its emission over the air changed. Everyone
 * in a room breathes the same air.
 */
function roomsTonight(read: ReadCtx): Map<EntityId, Room> {
  const out = new Map<EntityId, Room>();
  const hold = read.port('holdings');
  // who sleeps in which room tonight
  const sleepers = new Map<EntityId, { label: string; envelope?: Envelope; open?: boolean; people: EntityId[]; stores: Set<EntityId> }>();
  // everyone in a room breathes its air, whoever's store heats it
  if (![...read.all('Heating')].some(([, h]) => h.night)) return out;
  for (const [id, r] of lives(read)) {
    const where = placeOf(read, id);
    // a room with its air, or an open shelter a fire before it warms
    if (!where?.place || (!where.envelope && !where.open) || !inTheRoom(read, id)) continue;
    const room = sleepers.get(where.place) ?? sleepers.set(where.place, { label: where.label.replace(/^sleeping in /, ''), ...(where.envelope ? { envelope: where.envelope } : {}), ...(where.open ? { open: true } : {}), people: [], stores: new Set() }).get(where.place)!;
    room.people.push(id);
    if (read.get('Heating', r.store)?.night) room.stores.add(r.store);
  }
  const fumes = read.data('livingSettings').fumes;
  // each household's heaters and fuel, to its rooms in turn
  const stores = [...new Set([...sleepers.values()].flatMap((x) => [...x.stores]))].sort();
  const fuelLeft = new Map<string, number>();
  // an open shelter no store of its sleepers has wood for: said once every store has had its turn
  const unlit = new Map<EntityId, Room>();
  for (const store of stores) {
    const heaters: { id: string; label: string; heat: NonNullable<ReturnType<typeof hold.material>['heat']> }[] = [];
    for (const [mat, q] of Object.entries(read.port('holdings').contents(store))) {
      const h = hold.material(mat).heat;
      // (a cooker only, a camping stove, is not left burning to warm a room)
      if (h && !hold.material(mat).cooks?.only) for (let i = 0; i < Math.floor(q + 1e-9); i += 1) heaters.push({ id: mat, label: hold.material(mat).label, heat: h });
    }
    heaters.sort((a, b) => b.heat.output.value - a.heat.output.value || (a.id < b.id ? -1 : 1));
    for (const place of [...sleepers.keys()].filter((pl) => sleepers.get(pl)!.stores.has(store)).sort()) {
      if (out.has(place)) continue;
      const room = sleepers.get(place)!;
      // an open shelter: a fire kept before it through the night, of the household's dry wood (its smoke goes up, not into the room)
      if (!room.envelope) {
        const fire = read.data('livingSettings').openFire;
        if (!fire || !room.open) continue;
        const fuel = hold.material(fire.fuel);
        const hours = Math.max(...room.people.map((p) => bedHours(read, p)));
        const need = (fire.use.value * hours) / unitMass(fuel);
        const key = `${store}|${fire.fuel}`;
        const have = fuelLeft.get(key) ?? hold.supply(store, fire.fuel);
        const share = need > 0 ? Math.min(1, have / need) : 1;
        fuelLeft.set(key, Math.max(0, have - need * share));
        const dT = fire.warming.value * share;
        // (no dry wood: said, not silent)
        const note = share <= 0 ? `no ${fuel.label.toLowerCase()} for a fire before it` : `an open fire before it ${share < 0.999 ? `${Math.round(share * 100)} % of the night (wood short)` : 'through the night'}: ${Math.round(dT)} K warmer`;
        const lit: Room = { place, label: 'an open fire', store, fuel: fire.fuel, need: need * share, share, dT, ppm: 0, perHour: fire.use.value / unitMass(fuel), full: { dT: fire.warming.value, ppm: 0 }, worst: 0, note, sleepers: room.people.map((p) => ({ person: p, hours: bedHours(read, p), bed: bedtime(read, lifeOf(read, p)!) })) };
        // (no wood in this store: another of its sleepers' stores may have some)
        if (share > 0) out.set(place, lit);
        else if (!unlit.has(place)) unlit.set(place, lit);
        continue;
      }
      const envelope = room.envelope;
      // the strongest that can run here: a stove that needs a flue only where a flue pipe can go
      const idx = heaters.findIndex((h) => !h.heat.flue || envelope.flue);
      if (idx < 0) continue;
      const h = heaters.splice(idx, 1)[0]!;
      const fuel = hold.material(h.heat.fuel);
      const hours = Math.max(...room.people.map((p) => bedHours(read, p)));
      // what it uses an hour, in its fuel's own unit (an electric heater its draw, from the batteries by it that carry it)
      const need = perHourOf(h.heat, fuel) * hours;
      const key = `${store}|${h.heat.fuel}`;
      const have = fuelLeft.get(key) ?? hold.supply(store, h.heat.fuel, h.heat.draw?.value);
      const share = need > 0 ? Math.min(1, have / need) : 1;
      fuelLeft.set(key, Math.max(0, have - need * share));
      const dT = ((h.heat.output.value * 1000) / Math.max(1e-6, envelope.loss)) * share;
      // mg/m³ to ppm for CO at 25 °C: × 24.45 / 28.01
      const ppm = h.heat.flue ? 0 : ((h.heat.co.value * 1000) / Math.max(1e-6, envelope.volume * envelope.airChange)) * (24.45 / 28.01);
      const worst = Math.max(...room.people.map((p) => ppm * bedHours(read, p) * share));
      const danger = fumes && worst >= fumes.deadly.value ? ' — deadly: a night in it is a night one does not wake from' : fumes && worst >= fumes.ill.value ? ' — one wakes poisoned (headache, sickness)' : '';
      const note = `${h.label} burning ${share < 0.999 ? `${Math.round(share * 100)} % of the night (fuel short)` : 'through the night'}: ${Math.round(dT)} K warmer${ppm > 0 ? `, carbon monoxide about ${Math.round(ppm)} ppm in the closed room${danger}` : ''}`;
      out.set(place, { place, label: h.label, store, fuel: h.heat.fuel, need: need * share, share, dT, ppm, perHour: perHourOf(h.heat, fuel), full: { dT: (h.heat.output.value * 1000) / Math.max(1e-6, envelope.loss), ppm }, worst, note, sleepers: room.people.map((p) => ({ person: p, hours: bedHours(read, p), bed: bedtime(read, lifeOf(read, p)!) })) });
    }
    // a stove that needs a flue, and nowhere to put one: say so
    // (an open shelter takes no stove: its fire is before it)
    for (const place of [...sleepers.keys()].filter((pl) => sleepers.get(pl)!.stores.has(store) && !out.has(pl) && sleepers.get(pl)!.envelope).sort()) {
      const flued = heaters.find((h) => h.heat.flue);
      if (flued) out.set(place, { place, label: flued.label, store, fuel: flued.heat.fuel, need: 0, share: 0, dT: 0, ppm: 0, perHour: 0, full: { dT: 0, ppm: 0 }, worst: 0, sleepers: [], note: `the ${flued.label.toLowerCase()} needs a flue, and no flue pipe goes through ${sleepers.get(place)!.label}` });
    }
  }
  for (const [place, room] of unlit) if (!out.has(place)) out.set(place, room);
  return out;
}


/** a piece of bedding: what it keeps warm by its insulation (a sleeping system can be both bag and mat) */
interface Piece {
  id: string;
  label: string;
  comfort?: number;
  r?: number;
}

/** the store's bedding, piece by piece (and one more of `extra`, to reckon what it would change) */
function piecesOf(read: ReadCtx, store: EntityId, extra?: string): Piece[] {
  const hold = read.port('holdings');
  const out: Piece[] = [];
  const add = (mat: string, n: number) => {
    const m = hold.material(mat);
    const ins = m.insulation;
    if (!ins?.comfort && !ins?.rValue) return;
    for (let i = 0; i < n; i += 1) out.push({ id: mat, label: m.label, ...(ins.comfort ? { comfort: ins.comfort.value } : {}), ...(ins.rValue ? { r: ins.rValue.value } : {}) });
  };
  for (const [mat, q] of Object.entries(read.port('holdings').contents(store))) add(mat, Math.floor(q + 1e-9));
  if (extra) add(extra, 1);
  return out;
}

/** the pieces handed out in turn, the best first: each piece to one sleeper; one that is bag and mat fills both */
function bedFor(pieces: Piece[], turn: number): { bag?: Piece; mat?: Piece } {
  const left = [...pieces];
  const take = (pick: (p: Piece) => number | undefined, better: (a: number, b: number) => boolean) => {
    let best = -1;
    left.forEach((p, i) => {
      const v = pick(p);
      if (v !== undefined && (best < 0 || better(v, pick(left[best]!)!))) best = i;
    });
    return best < 0 ? undefined : left.splice(best, 1)[0];
  };
  let bed: { bag?: Piece; mat?: Piece } = {};
  for (let i = 0; i <= turn; i += 1) {
    const bag = take((p) => p.comfort, (a, b) => a < b);
    const mat = bag?.r !== undefined ? bag : take((p) => p.r, (a, b) => a > b);
    bed = { ...(bag ? { bag } : {}), ...(mat ? { mat } : {}) };
  }
  return bed;
}

/**
 * The bedding a resident sleeps in tonight and how the night's cold takes from their sleep. Those
 * living from a store share its bags and mats in turn, the best first (as they share the places to
 * sleep); what keeps warm is the goods' insulation, whatever they are called.
 */
/** tonight's low as the household can know it: the bulletin issued now (tomorrow's minimum), never the night itself (I7) */
function tonightLow(read: ReadCtx): number {
  const f = read.port('weather').forecast(read.now, 2);
  return (f[1] ?? f[0])?.tMin ?? read.port('weather').normals(read.calendar.at(read.now).month).tMin;
}

/** tomorrow's heat as the household can know it: the bulletin issued now */
function tomorrowHigh(read: ReadCtx): number {
  const f = read.port('weather').forecast(read.now, 2);
  return (f[1] ?? f[0])?.tMax ?? read.port('weather').normals(read.calendar.at(read.now).month).tMax;
}

/** the household's stores within a few steps of a home store that nobody lives from: their bedding is fetched for the night (kept while the stores stand as they are) */
const aroundMemo = new WeakMap<object, { key: string; out: Map<EntityId, EntityId[]> }>();
function beddingAround(read: ReadCtx, r: Readonly<Resident>): EntityId[] {
  const key = `${read.now}|${read.port('holdings').revision()}|${read.revision('Resident')}`;
  let m = aroundMemo.get(read.calendar);
  if (!m || m.key !== key) aroundMemo.set(read.calendar, (m = { key, out: new Map() }));
  const hit = m.out.get(r.store);
  if (hit) return hit;
  const lived = new Set(lives(read).map(([, o]) => o.store));
  const out = aroundOf(read, r).filter((sid) => !lived.has(sid));
  m.out.set(r.store, out);
  return out;
}

/** how far the night's cold takes from someone's sleep: the air outside (`outside`: an hour of the night as it is; absent: tonight's low as forecast) and what warms them */
function coldOf(read: ReadCtx, person: EntityId, warming: number, extra?: string, outside?: number): { factor: number; why: string; bedding: string; comfort: number; inside: number } {
  const set = read.data('livingSettings').bedding;
  const r = lifeOf(read, person);
  const housemates = r ? lives(read).filter(([, o]) => o.store === r.store && o.party === r.party).map(([id]) => id).sort() : [person];
  // (their store's bedding, and what lies within a few steps in a store of the household nobody lives from: a sleeping
  // bag 60 m off in the next tent is fetched for a cold night, not slept without: Qwen S512, one froze beside four)
  const pieces = r ? [r.store, ...beddingAround(read, r)].flatMap((sid, i) => piecesOf(read, sid, i === 0 ? extra : undefined)) : [];
  const { bag, mat } = r ? bedFor(pieces, Math.max(0, housemates.indexOf(person))) : {};
  const rv = mat?.r ?? set.noMatR.value;
  const comfort = bag ? bag.comfort! + set.perR.value * Math.max(0, set.referenceR.value - rv) : set.noBag.value;
  const inside = (outside ?? tonightLow(read)) + warming;
  const factor = Math.max(set.floor.value, 1 - set.cold.value * Math.max(0, comfort - inside));
  const bedding = bag && mat === bag ? bag.label : `${bag ? bag.label : 'no sleeping bag'}, ${mat ? mat.label : 'no mat'}`;
  return { factor, bedding, comfort, inside, why: `a night of ${Math.round(inside)} °C ${warming > 0 ? 'inside' : 'out'}, colder than the bedding keeps one warm in (${Math.round(comfort)} °C: ${bedding})` };
}

/** a colder night than one's bedding keeps one warm in: the goods that would warm this sleeper most, carried in from where we hold them or bought */
function warmerRemedies(read: ReadCtx, person: EntityId, store: EntityId, warming: number): Remedy[] {
  const hold = read.port('holdings');
  const now = coldOf(read, person, warming).factor;
  const pos = read.port('holdings').where(store);
  const fromHeld = (h: { store: EntityId; label: string; qty: number; distance: number }, id: string): Remedy => ({
    label: `Carry 1 ${hold.material(id).unit} ${hold.material(id).label} in from ${h.label} (${Math.round(h.distance)} m)`,
    command: { type: 'production.moveGoods', payload: { from: h.store, to: store, material: id, qty: 1, by: 'hand' } },
  });
  // one more of each kind, handed out again in turn: what it would change for this sleeper
  const gains = Object.entries(read.data('materials'))
    .filter(([, m]) => m.insulation)
    .map(([id]) => ({ id, gain: coldOf(read, person, warming, id).factor - now }))
    .filter((g) => g.gain > 0.005)
    .sort((a, b) => b.gain - a.gain || (a.id < b.id ? -1 : 1));
  return gains.slice(0, 3).flatMap((g) => fillRemedies(read, store, g.id, 1, { ...(pos ? { pos } : {}), fromHeld: (h) => fromHeld(h, g.id) }).slice(0, 2));
}


/** what everyone living from a store needs a day: a household's days of food and water are its store over this */
/** a household's days of water and food at a store: its own and what is within reach of it (clean water and food as far as one walks for them) */
function daysAt(read: ReadCtx, store: EntityId, party: EntityId): { water: number; food: number } {
  const r = { store, party } as Readonly<Resident>;
  const hold = read.port('holdings');
  const need = householdNeed(read, store, read.port('weather').soFar(read.now).tMax);
  const near = [store, ...aroundOf(read, r)];
  const far = aroundOf(read, r, read.data('livingSettings').fetchWalk.value);
  const clean = (m: string) => !((hold.material(m).pathogens?.value ?? 0) > 0);
  const litres = near.reduce((a, s) => a + provisions(read, s).litres, 0) + far.filter((s) => !near.includes(s)).reduce((a, s) => a + provisions(read, s).water.filter((w) => clean(w.material)).reduce((b, w) => b + w.per * w.have, 0), 0);
  const kcal = [store, ...far].reduce((a, s) => a + eatableKcal(read, s), 0);
  return { water: need.water > 0 ? litres / need.water : Infinity, food: need.energy > 0 ? kcal / need.energy : Infinity };
}

function householdNeed(read: ReadCtx, store: EntityId, tMax: number): { energy: number; water: number; drinking: number } {
  let energy = 0;
  let drinking = 0;
  let washing = 0;
  for (const [id, r] of lives(read)) {
    // those away (gone home, on leave, a course) live from elsewhere meanwhile; one at work or on an errand is of it (r36)
    if (r.store !== store || !livesHere(read, id)) continue;
    const need = read.port('needs').requirement(id, { workHours: 8, tMax });
    energy += need.energy.v;
    drinking += need.water.v;
    washing += need.hygiene.v;
  }
  // water: drinking and washing (what the store's water goes to a day); drinking alone is what is kept back from washing
  return { energy: Math.max(1, energy), water: Math.max(0.1, drinking + washing), drinking: Math.max(0.1, drinking) };
}

/**
 * Washing (camp L3), after everyone has drunk: each washes with what is left beyond the household's
 * drinking for tomorrow (a working day), the dirtiest water first (what is clean is for drinking).
 * Days without enough are counted and said.
 */
function washAll(ctx: WriteCtx): void {
  const stores = new Map<EntityId, EntityId[]>();
  for (const [id, r] of lives(ctx)) if (r.lastDay === Math.floor(ctx.now / DAY) && atHome(ctx, id)) stores.set(r.store, [...(stores.get(r.store) ?? []), id]);
  for (const [store, people] of stores) {
    const reserve = householdNeed(ctx, store, tomorrowHigh(ctx)).drinking;
    for (const person of people.sort()) {
      const r = requireLife(ctx, person);
      // the hours they worked, as the evening counted them (an illness of the evening does not undo the day)
      const hours = r.worked ?? workHoursToday(ctx, person, r.party).hours;
      const tMax = ctx.port('weather').soFar(ctx.now).tMax;
      const need = ctx.port('needs').requirement(person, { workHours: hours, tMax });
      const have = provisions(ctx, store);
      // (the washing water runs off into the ground; its bottles stay)
      const washed = take(ctx, store, [...have.water].reverse(), Math.min(need.hygiene.v, Math.max(0, have.litres - reserve)), `${ctx.port('workforce').name(person)}: washing`, undefined, 'ground');
      const unwashedDays = washed < need.hygiene.v * 0.5 ? (r.unwashedDays ?? 0) + 1 : 0;
      const name = ctx.port('workforce').name(person);
      // with soap where the store has it (a day's use for one), else with water alone
      const soap = unwashedDays === 0 ? soapIn(ctx, store) : undefined;
      if (soap) ctx.command('inventory.release', { from: store, material: soap.material, qty: soap.qty, to: 'ground', why: `${name}: soap`, usedUp: true });
      const soaped = unwashedDays === 0 ? Boolean(soap) : r.soaped;
      const said = ownBlockers(ctx, person).filter((x) => x.code !== 'living.unwashed' && x.code !== 'living.smells' && x.code !== 'living.noSoap');
      if (unwashedDays === 0 && !soap && ctx.data('livingSettings').hygiene) said.push({ code: 'living.noSoap', severity: 'info', params: { person: name }, remedies: soapRemedies(ctx, store) });
      if (unwashedDays >= 2) said.push({ code: 'living.unwashed', severity: 'warn', params: { person: name, days: unwashedDays, need: round(need.hygiene.v) }, remedies: supplyRemedies(ctx, store, 'water') });
      // the day's sweat on the body (a little at rest, and the hours of work by the heat), less what the wash took
      const smell = ctx.data('livingSettings').smell;
      let sweat = r.sweat ?? 0;
      if (smell) {
        const worked = hours * (smell.work.value + smell.perDegree.value * Math.max(0, tMax - smell.reference.value));
        sweat = (sweat + smell.rest.value + worked) * (1 - Math.min(1, washed / Math.max(1e-9, need.hygiene.v)));
        const level = (x: number) => (x >= smell.strong.value ? 2 : x >= smell.noticed.value ? 1 : 0);
        const now = level(sweat);
        if (now > 0) {
          const how = `${unwashedDays > 0 ? `${unwashedDays} day${unwashedDays > 1 ? 's' : ''} without washing` : 'too little water to wash'}${worked > 0 ? `, after a day's sweaty work` : ''}`;
          said.push({ code: 'living.smells', severity: now === 2 ? 'warn' : 'info', params: { person: name, how: now === 2 ? 'strongly' : 'noticeably', why: how }, remedies: supplyRemedies(ctx, store, 'water') });
        }
        // others notice: told when it gets worse (what they remember of us comes from such moments)
        if (now > level(r.sweat ?? 0)) {
          ctx.log(now === 2 ? 'warn' : 'info', `${name} smells ${now === 2 ? 'strongly' : 'noticeably'}: those around notice.`, [person]);
          ctx.emit('living.noticed', { person, party: r.party, what: 'smell', level: now === 2 ? 'strong' : 'noticeable' });
        }
        // (told while it lasts: what the land's watchers hear once of each matter, a matter begun later too)
        if (now > 0 && ctx.hasPort('land')) ctx.command('land.complaint', { subject: r.store, party: r.party, what: 'smell' });
        // a friend who came to help (on a stay, not living here), smelling strongly with no water to wash for days: their patience wears out
        if (now === 2 && visiting(ctx, person) && unwashedDays >= ctx.data('livingSettings').patience.value) {
          // they wash at home: nothing of it is said of them while they are away, and they come back clean
          setLife(ctx, person, { ...r, unwashedDays: 0, sweat: 0, soaped: true });
          const rest = said.filter((x) => x.code !== 'living.unwashed' && x.code !== 'living.smells' && x.code !== 'living.noSoap');
          if (rest.length) ctx.blockers.set(person, rest);
          else ctx.blockers.clear(person);
          ctx.command('workforce.goHome', { person, reason: `they smell strongly after ${unwashedDays} days with no water to wash (they came to help, not to live like this)` });
          continue;
        }
      }
      setLife(ctx, person, { ...r, unwashedDays, sweat, ...(soaped === undefined ? {} : { soaped }) });
      if (said.length) ctx.blockers.set(person, said);
      else ctx.blockers.clear(person);
    }
  }
}

/** what living itself has said on a subject (others' word is theirs: setting ours never copies it) */
function ownBlockers(read: ReadCtx, subject: EntityId): Blocker[] {
  return read.blockersOf(subject).filter((b) => b.module === 'living');
}

/**
 * A household's money against its living (Qwen's year: five died of hunger with 0.69 € left and no
 * word before): what the store holds and what its money buys at today's prices, in days for everyone
 * living from it. Said on the store when it is less than three weeks, with where money could come from.
 */
function moneyNews(ctx: WriteCtx): void {
  const hold = ctx.port('holdings');
  const stores = new Set(lives(ctx).filter(([id]) => atHome(ctx, id)).map(([, r]) => r.store));
  // a warning on a store no one lives from tonight is stale (the stores it is said on: among those with something said)
  for (const id of ctx.blocked()) {
    if (stores.has(id) || !hold.exists(id) || !ownBlockers(ctx, id).some((b) => b.code === 'living.moneyLow')) continue;
    const rest = ownBlockers(ctx, id).filter((b) => b.code !== 'living.moneyLow');
    if (rest.length) ctx.blockers.set(id, rest);
    else ctx.blockers.clear(id);
  }
  // the cheapest food energy and water to be had (shelf prices of who sells them)
  const cheapest = (per: (m: string) => number) => Math.min(...Object.keys(ctx.data('materials')).filter((m) => per(m) > 0).flatMap((m) => ctx.port('trade').offers(m).map((o) => o.price / per(m))));
  // (of what is eaten as it is: food eaten cooked needs more than money)
  const kcalEur = cheapest((m) => (hold.material(m).cook ? 0 : (hold.material(m).energy?.value ?? 0)));
  const litreEur = cheapest((m) => (hold.material(m).pathogens?.value ? 0 : hold.material(m).water?.value ?? 0));
  if (!Number.isFinite(kcalEur) || !Number.isFinite(litreEur)) return;
  // reckoned per party: everyone it keeps, in all its camps, against all it holds (two camps share one purse and one larder)
  const byHolder = new Map<EntityId, EntityId[]>();
  for (const store of [...stores].sort()) {
    const holder = hold.holder(store);
    if (holder) byHolder.set(holder, [...(byHolder.get(holder) ?? []), store]);
  }
  const edible = Object.keys(ctx.data('materials')).filter((m) => hold.material(m).energy || hold.material(m).water);
  const tMax = ctx.port('weather').soFar(ctx.now).tMax;
  for (const [holder, camps] of byHolder) {
    const need = { energy: 0, water: 0 };
    for (const store of camps) {
      const n = householdNeed(ctx, store, tMax);
      need.energy += n.energy;
      need.water += n.water;
    }
    // what is theirs to eat and drink: in all their stores (set down at the kerb, in a shed) and on order
    let kcal = 0;
    let litres = 0;
    for (const sid of hold.ofParty(holder)) {
      const p = provisions(ctx, sid);
      // (food eaten cooked as far as it can be cooked there)
      kcal += eatableKcal(ctx, sid);
      litres += p.litres;
      for (const m of edible) {
        if (hold.material(m).cook && !cookerOf(ctx, sid)) continue;
        const q = ctx.port('trade').onOrder(sid, m);
        if (q > 0) (kcal += q * (hold.material(m).energy?.value ?? 0)), (litres += q * (hold.material(m).water?.value ?? 0));
      }
    }
    const food = kcal / need.energy;
    const water = litres / need.water;
    // the money buys what runs out first while the other lasts, then both
    const [first, second, firstCost] = food <= water ? [food, water, need.energy * kcalEur] : [water, food, need.water * litreEur];
    const both = need.energy * kcalEur + need.water * litreEur;
    const cash = Math.max(0, ctx.port('prices').liquidity(holder));
    const days = cash <= firstCost * (second - first) ? first + cash / firstCost : second + (cash - firstCost * (second - first)) / both;
    const remedies = days >= 21 ? [] : ctx.contributions('financing').flatMap((c) => c.impl(ctx, holder, Math.ceil(both * 30)));
    // said on each of its camps alike
    for (const store of camps) {
      const others = ownBlockers(ctx, store).filter((b) => b.code !== 'living.moneyLow');
      if (days >= 21) {
        if (ownBlockers(ctx, store).some((b) => b.code === 'living.moneyLow')) others.length ? ctx.blockers.set(store, others) : ctx.blockers.clear(store);
        continue;
      }
      ctx.blockers.set(store, [...others, { code: 'living.moneyLow', severity: days < 7 ? 'block' : 'warn', params: { store: ctx.port('holdings').label(store)!, days: round(days), inStore: round(Math.min(food, water)), cash: Math.round(cash), daily: round(both) }, remedies }]);
    }
  }
}

/**
 * Household waste (camp L3): what is used up leaves its packaging in the store (materials' `leaves`). Piled up
 * beyond what a camp keeps (livingSettings.waste), it is said, with the way it goes: collected by a waste
 * service (inventory.dispose), or carried elsewhere. Nothing takes it away by itself.
 */
function wastePiles(ctx: WriteCtx, camps: EntityId[]): void {
  const w = ctx.data('livingSettings').waste;
  if (!w) return;
  const hold = ctx.port('holdings');
  // the camps lived at, and any store this warning was said of (lived at no longer: its waste is still there, or gone)
  const said = ctx.blocked().filter((id) => hold.exists(id) && ownBlockers(ctx, id).some((b) => b.code === 'living.wastePiles'));
  for (const store of [...new Set([...camps, ...said])].sort()) {
    const kg = hold.stock(store, w.material) * unitMass(hold.material(w.material));
    const others = ownBlockers(ctx, store).filter((b) => b.code !== 'living.wastePiles');
    if (kg < w.pile.value) {
      if (others.length !== ownBlockers(ctx, store).length) others.length ? ctx.blockers.set(store, others) : ctx.blockers.clear(store);
      continue;
    }
    const qty = hold.stock(store, w.material);
    // (waste lying about is noticed and told)
    const holder = ctx.port('holdings').holder(store);
    if (holder && ctx.hasPort('land')) ctx.command('land.complaint', { subject: store, party: holder, what: 'waste' });
    // collected where a van can come; else it has to be carried to where one can (a store of ours by a way)
    const remedies = ctx.port('trade').collectable(store, w.material) ? [{ label: `Have the ${round(qty)} ${hold.material(w.material).unit} of ${hold.material(w.material).label.toLowerCase()} collected`, command: { type: 'inventory.dispose', payload: { store, material: w.material, qty: round(qty) } } }] : [];
    ctx.blockers.set(store, [...others, { code: 'living.wastePiles', severity: 'warn', params: { store: ctx.port('holdings').label(store)!, kg: Math.round(kg), way: remedies.length ? 'the waste service collects it' : 'no waste van gets here: carry it to a store of ours by a way it can use, and have it collected there' }, remedies }]);
  }
}

/** someone who came to help on a stay and does not live here (family or friends visiting) */
function visiting(read: ReadCtx, person: EntityId): boolean {
  const h = read.get('Helper', person);
  return Boolean(h && !h.resident && h.stay);
}

/** living here these days, wherever they are this hour (at work, on an errand): not away on leave, a course or gone */
function livesHere(read: ReadCtx, person: EntityId): boolean {
  const st = read.get('Presence', person)?.status;
  return !read.get('Person', person)?.died && st !== 'away' && st !== 'gone' && st !== 'training' && (st !== 'vacation' || Boolean(read.get('Helper', person)?.resident));
}

/** at home: by their home store, or on their way back to it (away on a course, at a job, gone: not) */
function atHome(read: ReadCtx, person: EntityId): boolean {
  return read.get('Presence', person)?.status !== 'gone' && homeBy(read, person);
}

/**
 * The ways to fill the store with food or water: order it, or fetch it (the inventory's one order of
 * remedies). When nobody here is fit to go, family or friends can be asked to come (found by an agent:
 * with everyone ill, the walk to the shop vanished and nothing was left to do).
 */
/** a way to treat drinking water, when nothing in the store treats it: one we hold elsewhere carried in, else bought */
function treatRemedies(read: ReadCtx, store: EntityId): Remedy[] {
  const hold = read.port('holdings');
  const contents = read.port('holdings').contents(store);
  const treats = Object.keys(read.data('materials')).filter((id) => hold.material(id).treats).sort();
  if (treats.some((id) => (contents[id] ?? 0) >= 1 - 1e-9)) return [];
  const pos = read.port('holdings').where(store);
  return treats.flatMap((id) =>
    fillRemedies(read, store, id, 1, {
      ...(pos ? { pos } : {}),
      fromHeld: (h) => ({ label: `Carry 1 ${hold.material(id).unit} ${hold.material(id).label} in from ${h.label} (${Math.round(h.distance)} m)`, command: { type: 'production.moveGoods', payload: { from: h.store, to: store, material: id, qty: 1, by: 'hand' } } }),
    }).slice(0, 1),
  );
}

function supplyRemedies(read: ReadCtx, store: EntityId, kind: 'food' | 'water'): Remedy[] {
  const hold = read.port('holdings');
  // what we hold elsewhere (water set down at the kerb …) is carried in first: the inventory's one order of remedies
  const pos = read.port('holdings').where(store);
  const fromHeld = (h: { store: EntityId; label: string; qty: number; distance: number }, id: string): Remedy => ({
    label: `Carry ${+h.qty.toFixed(2)} ${hold.material(id).unit} ${hold.material(id).label} in from ${h.label} (${Math.round(h.distance)} m)`,
    command: { type: 'production.moveGoods', payload: { from: h.store, to: store, material: id, qty: +h.qty.toFixed(6), by: 'hand' } },
  });
  const out = Object.keys(read.data('materials'))
    .sort()
    // (food eaten cooked only where there is something to cook it on)
    .filter((id) => (kind === 'food' ? hold.material(id).energy && (!hold.material(id).cook || cookerOf(read, store)) : hold.material(id).water))
    .flatMap((id) => fillRemedies(read, store, id, kind === 'food' ? 10 : 20, { ...(pos ? { pos } : {}), fromHeld: (h) => fromHeld(h, id) }));
  // water as it comes is safe only treated: offered or held, and nothing in the store treats it, a way to treat it
  // (by what the water carries, never by what it is called: drawing at a creek, or goods with a load of what makes one ill)
  const risky = (id: string | undefined) => Boolean(id && read.data('materials')[id] && (hold.material(id).pathogens?.value ?? 0) > 0);
  const offersRisky = out.some((r) => r.command?.type === 'errands.drawWater' || risky((r.command?.payload as { material?: string } | undefined)?.material));
  if (kind === 'water' && offersRisky) out.push(...treatRemedies(read, store));
  const holder = read.port('holdings').holder(store);
  const wf = read.port('workforce');
  const fit = lives(read).some(([id, r]) => r.store === store && wf.present(id) && read.get('Presence', id)?.status === 'available');
  if (!fit && holder) {
    for (const h of wf.helpersFor('labour', holder).slice(0, 2)) {
      out.push({ label: `Ask ${h.name} to come and help for ${h.days} days (arrives ${read.calendar.format(h.arrives, 'date')}; unpaid, meals paid)`, command: { type: 'workforce.askForHelp', payload: { person: h.person, days: h.days } } });
    }
  }
  return out;
}

/**
 * The household's toilet (camp L3): the one that keeps most of the excreta from the camp, among the
 * toilets in its store (one that needs cover, with what covers it) and a hole dug for each visit with
 * a tool the household holds. None: excreta are left about the camp.
 */
type Toilet = { contains: number; label: string; cover?: { material: string; qty: number }; uncovered?: string; collects?: { material: string; qty: number }; full?: { material: string; held: number } };
function toiletOf(read: ReadCtx, store: EntityId, holes: Map<EntityId, string>): Toilet {
  const hold = read.port('holdings');
  const contents = read.port('holdings').contents(store);
  let best: Toilet = { contains: 0, label: 'no toilet' };
  // a toilet that collects and is full, whatever else is used meanwhile (it waits to be emptied)
  let full: Toilet['full'];
  for (const [m, q] of Object.entries(contents).sort(([a], [b]) => a.localeCompare(b))) {
    const san = q >= 1 - 1e-9 ? hold.material(m).sanitation : undefined;
    if (!san) continue;
    // a toilet that collects and is full keeps nothing back until it is emptied
    const held = san.collects ? (contents[san.collects.material] ?? 0) * unitMass(hold.material(san.collects.material)) : 0;
    if (san.collects && held >= san.collects.capacity.value * Math.floor(q + 1e-9) - 1e-9) {
      full = { material: san.collects.material, held: contents[san.collects.material] ?? 0 };
      if (best.contains <= 0) best = { contains: 0, label: `${hold.material(m).label}, full (${Math.round(held)} kg): to be emptied` };
      continue;
    }
    // (the cover a person a day, in kg, as so much of the cover good)
    const use = san.cover ? san.cover.use.value / unitMass(hold.material(san.cover.material)) : 0;
    const covered = !san.cover || (contents[san.cover.material] ?? 0) >= use - 1e-9;
    const contains = covered ? san.contains.value : san.cover!.without.value;
    if (contains <= best.contains) continue;
    best = { contains, label: covered ? hold.material(m).label : `${hold.material(m).label}, with nothing to cover it (${hold.material(san.cover!.material).label.toLowerCase()})` };
    if (san.cover && covered) best.cover = { material: san.cover.material, qty: use };
    else if (san.cover) best.uncovered = san.cover.material;
    // what it collects: what one leaves (by what was eaten and drunk) and the cover over it (kg; reckoned in the evening)
    if (san.collects) best.collects = { material: san.collects.material, qty: covered && san.cover ? san.cover.use.value : 0 };
  }
  const hole = read.data('livingSettings').sanitation?.cathole;
  const tool = holes.get(store);
  if (hole && tool && hole.contains.value > best.contains) best = { contains: hole.contains.value, label: `a hole dug for each visit and covered (${tool})` };
  return full ? { ...best, full } : best;
}

/**
 * Tonight, for each store people live from: the tool the household has at hand to dig a hole for
 * each visit (camp L3): one of its own, here and sound (not on order, worn out or across the map).
 * Reckoned once an evening over the tools of that class, not for each person.
 */
function holesTonight(read: ReadCtx, stores: EntityId[]): Map<EntityId, string> {
  const out = new Map<EntityId, string>();
  const hole = read.data('livingSettings').sanitation?.cathole;
  if (!hole || !read.hasPort('equipment') || !stores.length) return out;
  const eq = read.port('equipment');
  const tools = eq.byClass(hole.tool).map((id) => ({ id, m: read.get('Machine', id) })).filter((t) => t.m && t.m.status === 'ready');
  const hold = read.port('holdings');
  for (const store of stores) {
    const pos = hold.where(store);
    const holder = hold.holder(store);
    if (!pos || holder === undefined) continue;
    // (a tool ours to use: ours and not lent out, or lent to us)
    const at = tools.find((t) => eq.usableBy(t.id, holder) && Math.hypot(eq.positionAt(t.id, read.now)[0] - pos[0], eq.positionAt(t.id, read.now)[1] - pos[1]) <= read.data('livingSettings').atHand.value);
    if (at) out.set(store, eq.modelOf(at.id).label.toLowerCase());
  }
  return out;
}

/** a toilet for a household without one (or without what covers it): what we hold elsewhere carried in first, else bought */
/**
 * The household's routine: a toilet that collects and is full is emptied onto a heap of ours near by
 * that keeps it, by hand (work: the next working hours of whoever is fit). Without such a heap it waits,
 * said (the way: set one up).
 */
function emptyToilets(ctx: WriteCtx, camps: EntityId[], holes: Map<EntityId, string>): void {
  for (const store of camps) {
    const t = toiletOf(ctx, store, holes);
    if (!t.full) continue;
    const hold = ctx.port('holdings');
    const holder = hold.holder(store);
    const label = hold.label(store);
    // (not twice: none is offered while a move of it from here is under way)
    const empty = emptyRemedies(ctx, store, t.full).find((r) => r.command?.type === 'production.moveGoods');
    if (holder === undefined || !empty) continue;
    const r = ctx.command('production.moveGoods', { ...(empty.command!.payload as { from: EntityId; to: EntityId; material: string; qty: number; by: 'hand' }), party: holder, label: `Empty the toilet at ${label}` });
    if (r.ok) ctx.log('info', `${label}: the toilet is full; it is to be emptied onto the heap.`, [store]);
  }
}

/** a move of what a toilet collected from here, under way */
function emptying(read: ReadCtx, store: EntityId, material: string): boolean {
  return [...read.all('WorkPackage')].some(([, w]) => w.status !== 'done' && w.status !== 'cancelled' && w.activity === 'hand.move' && w.store === store && Boolean(w.produces?.some((o) => o.material === material)));
}

/** a full toilet emptied: carried onto a heap of ours near by (one that keeps it), or a heap set up for it */
function emptyRemedies(read: ReadCtx, store: EntityId, full: { material: string; held: number }): Remedy[] {
  const hold = read.port('holdings');
  const pos = hold.where(store);
  const holder = hold.holder(store);
  if (!pos || holder === undefined) return [];
  const label = hold.label(store);
  const near = read.data('livingSettings').atHand.value;
  const heap = hold
    .ofParty(holder, { near: [pos[0], pos[1]], within: near, except: store })
    .filter((id) => hold.holds(id)?.includes(full.material))
    .sort((a, b) => (a < b ? -1 : 1))[0];
  const what = hold.material(full.material).label.toLowerCase();
  // being emptied already: nothing more to do
  if (emptying(read, store, full.material)) return [];
  // what does not compost (a mobile toilet's tank) is pumped out and taken away, where the service's vehicle gets to it
  if (!hold.material(full.material).seasons) {
    const called = read.port('trade').openOrders({ store, material: full.material }).length > 0;
    return !called && read.port('trade').collectable(store, full.material) ? [{ label: `Have the ${what} taken away (${Math.round(full.held)} kg)`, command: { type: 'inventory.dispose', payload: { store, material: full.material, qty: +full.held.toFixed(2) } } }] : [];
  }
  if (heap) return [{ label: `Empty it onto ${hold.label(heap)} (${Math.round(full.held)} kg of ${what})`, command: { type: 'production.moveGoods', payload: { from: store, to: heap, material: full.material, qty: +full.held.toFixed(6), by: 'hand' } } }];
  // a heap where it can compost, a few steps from the camp
  const seasoned = hold.material(full.material).seasons?.into;
  return [{ label: `Set up a compost heap beside ${label}, to empty it onto`, command: { type: 'inventory.createStore', payload: { holder, label: 'Compost heap', kind: 'stockpile', pos: [pos[0] + 8, pos[1]], holds: [full.material, ...(seasoned ? [seasoned] : [])] } } }];
}

/**
 * How goods of ours are carried over to a store a walk away: by hand, or a piece heavier than people lift together (a
 * mobile toilet's cabin) by a hired van with its driver (by the practice's handling data, where it gives them)
 */
function carryBy(read: ReadCtx, material: string): 'hand' | 'service' {
  if (!read.hasData('handling')) return 'hand';
  const h = read.data('handling' as never) as { safeLoad: { value: number }; team: { value: number }[] };
  const m = read.port('holdings').material(material);
  const mass = unitMass(m);
  if (!isCounted(m) || mass <= h.safeLoad.value) return 'hand';
  return h.team.some((t, i) => mass <= (i + 2) * h.safeLoad.value * t.value) ? 'hand' : 'service';
}

function toiletRemedies(read: ReadCtx, store: EntityId, missing?: string): Remedy[] {
  const hold = read.port('holdings');
  const holder = hold.holder(store);
  const pos = hold.where(store);
  const fill = (id: string, qty: number) =>
    fillRemedies(read, store, id, qty, {
      ...(pos ? { pos } : {}),
      fromHeld: (h) => {
        // (a toilet that collects is carried over only when the others there hold what its tanks hold: not a full one
        // whose contents would stay behind, review S1b #4)
        const c = hold.material(id).sanitation?.collects;
        if (c) {
          const held = (read.port('holdings').stock(h.store, c.material)) * unitMass(hold.material(c.material));
          if (held > c.capacity.value * (Math.floor(h.qty + 1e-9) - 1) + 1e-6) return null;
        }
        const by = carryBy(read, id);
        const what = `${+Math.min(h.qty, qty).toFixed(2)} ${hold.material(id).unit} ${hold.material(id).label}`;
        return { label: by === 'hand' ? `Carry ${what} in from ${h.label} (${Math.round(h.distance)} m)` : `Have ${what} brought over from ${h.label} (${Math.round(h.distance)} m) by a hired van: too heavy to carry`, command: { type: 'production.moveGoods', payload: { from: h.store, to: store, material: id, qty: +Math.min(h.qty, qty).toFixed(6), by } } };
      },
    }).slice(0, 1);
  // ten days of cover for one person
  const cover = (id: string, use: number) => Math.ceil((10 * use) / unitMass(hold.material(id)));
  if (missing) {
    const of = Object.keys(read.data('materials')).map((id) => hold.material(id).sanitation?.cover).find((c) => c?.material === missing);
    return fill(missing, of ? cover(missing, of.use.value) : 10);
  }
  // a toilet and what covers it; or the tool to dig a hole with (one of ours carried here, else bought)
  const out = Object.keys(read.data('materials'))
    .filter((id) => hold.material(id).sanitation)
    .sort()
    .flatMap((id) => {
      const c = hold.material(id).sanitation!.cover;
      return [...fill(id, 1), ...(c ? fill(c.material, cover(c.material, c.use.value)) : [])];
    });
  const hole = read.data('livingSettings').sanitation?.cathole;
  if (hole && pos && holder !== undefined && read.hasPort('equipment')) {
    const eq = read.port('equipment');
    const ours = eq.byClass(hole.tool).find((id) => eq.usableBy(id, holder) && read.get('Machine', id)?.status === 'ready');
    const models = Object.entries(read.data('machineModels')).filter(([, md]) => md.class === hole.tool).sort(([, a], [, b]) => a.purchasePrice.value - b.purchasePrice.value);
    if (ours) out.push({ label: `Bring the ${eq.modelOf(ours).label.toLowerCase()} to ${hold.label(store)}, to dig a hole for each visit`, command: { type: 'equipment.moveTo', payload: { machine: ours, to: pos } } });
    else if (models[0]) out.push({ label: `Buy a ${models[0][1].label.toLowerCase()} (${Math.round(models[0][1].purchasePrice.value)} €), to dig a hole for each visit`, command: { type: 'equipment.acquire', payload: { model: models[0][0], ownership: 'owned', pos, holder } } });
  }
  // (what we hold comes first, of any kind of toilet: one carried over before another is bought)
  const carried = (r: Remedy) => r.command?.type === 'production.moveGoods';
  return [...out.filter(carried), ...out.filter((r) => !carried(r))];
}

/** soap in the store for one person's wash today (camp L3): the good that cleans, a day's use of it */
function soapIn(read: ReadCtx, store: EntityId): { material: string; qty: number } | undefined {
  const hold = read.port('holdings');
  for (const [m, q] of Object.entries(read.port('holdings').contents(store)).sort(([a], [b]) => a.localeCompare(b))) {
    const c = hold.material(m).cleans;
    if (!c) continue;
    const qty = c.use.value / unitMass(hold.material(m));
    if (q >= qty - 1e-9) return { material: m, qty };
  }
  return undefined;
}

/** soap for a household washing with water alone: what we hold elsewhere carried in first, else bought (a month for one) */
/** the ways to cook at a store: something to cook on, its fuel, or water */
function cookRemedies(read: ReadCtx, store: EntityId, lacks: 'cooker' | 'fuel' | 'water'): Remedy[] {
  if (lacks === 'water') return supplyRemedies(read, store, 'water');
  const hold = read.port('holdings');
  const pos = read.port('holdings').where(store);
  const held = (id: string, qty: number) => (h: { store: EntityId; label: string; qty: number; distance: number }): Remedy => ({ label: `Carry ${+Math.min(h.qty, qty).toFixed(2)} ${hold.material(id).unit} ${hold.material(id).label} in from ${h.label} (${Math.round(h.distance)} m)`, command: { type: 'production.moveGoods', payload: { from: h.store, to: store, material: id, qty: +Math.min(h.qty, qty).toFixed(6), by: 'hand' } } });
  if (lacks === 'fuel') {
    // (a heater burning it through the night: letting it go out leaves the fuel to cook)
    const heat: Remedy[] = read.get('Heating', store)?.night ? [{ label: 'Let the fires go out at night: the fuel cooks instead', command: { type: 'living.heat', payload: { store, night: false } } }] : [];
    // the fuel of what is there to cook on (the first that cooks)
    const cooker = Object.keys(read.data('materials')).sort().find((id) => hold.material(id).cooks && hold.material(id).heat && hold.stock(store, id) >= 1 - 1e-9);
    const fuel = cooker ? hold.material(cooker).heat!.fuel : undefined;
    return [...(fuel ? fillRemedies(read, store, fuel, 5, { ...(pos ? { pos } : {}), fromHeld: held(fuel, 5) }).slice(0, 2) : []), ...heat];
  }
  return Object.keys(read.data('materials'))
    .filter((id) => hold.material(id).cooks && hold.material(id).heat)
    .sort()
    .flatMap((id) => fillRemedies(read, store, id, 1, { ...(pos ? { pos } : {}), fromHeld: held(id, 1) }).slice(0, 1));
}

function soapRemedies(read: ReadCtx, store: EntityId): Remedy[] {
  const hold = read.port('holdings');
  const pos = read.port('holdings').where(store);
  return Object.keys(read.data('materials'))
    .filter((id) => hold.material(id).cleans)
    .sort()
    .flatMap((id) => {
      const qty = Math.max(0.1, Math.ceil((30 * hold.material(id).cleans!.use.value) / unitMass(hold.material(id)) * 10) / 10);
      return fillRemedies(read, store, id, qty, {
        ...(pos ? { pos } : {}),
        fromHeld: (h) => ({ label: `Carry ${+Math.min(h.qty, qty).toFixed(2)} ${hold.material(id).unit} ${hold.material(id).label} in from ${h.label} (${Math.round(h.distance)} m)`, command: { type: 'production.moveGoods', payload: { from: h.store, to: store, material: id, qty: +Math.min(h.qty, qty).toFixed(6), by: 'hand' } } }),
      }).slice(0, 1);
    });
}

/**
 * What one's hands carry to the mouth, against hands washed with soap (1): unwashed, all that washing
 * with soap would have prevented comes back; washed with water alone, part of it (camp L3)
 */
function handsOf(read: ReadCtx, r: { unwashedDays?: number; soaped?: boolean }): number {
  const hy = read.data('livingSettings').hygiene;
  if (!hy) return 1;
  const kept = (r.unwashedDays ?? 0) > 0 ? 0 : r.soaped === false ? hy.handwashing.value * (hy.waterOnly?.value ?? 1) : hy.handwashing.value;
  return (1 - kept) / (1 - hy.handwashing.value);
}

/** what keeps an illness of the camp away: water treated, a toilet (or its cover), soap, water to wash */
type IllWay = 'treat' | 'toilet' | 'cover' | 'soap' | 'wash';

/**
 * An illness of the camp said whole (S504: said with no cause or degree, the hands' part unseen): what it is, what
 * brought it (`why`, as ' from …' or ': …'), how bad (its days, and whether it leaves one weak), and the hands' part
 */
function illnessSaid(illness: { days: { value: number } }, serious: { days: { value: number } } | undefined, why: string, hands?: { said: string }): string {
  const degree = serious ? `some ${Math.round(serious.days.value)} days, weak after` : `a bout of some ${Math.round(illness.days.value)} days`;
  return `${serious ? 'a serious gut infection' : 'diarrhoea'}${why}; ${degree}${hands ? `; ${hands.said}` : ''}`;
}

/** the hands' part in an illness, when they carried more of it than hands washed with soap would (handsOf) */
function handsSaid(r: { unwashedDays?: number; soaped?: boolean }): { said: string; way: IllWay } | undefined {
  if ((r.unwashedDays ?? 0) > 0) return { said: `hands unwashed for ${r.unwashedDays} day${r.unwashedDays! > 1 ? 's' : ''} carried more of it to the mouth`, way: 'wash' };
  if (r.soaped === false) return { said: 'hands washed without soap carried more of it to the mouth', way: 'soap' };
  return undefined;
}

/** the ways to keep an illness of the camp away, as remedies: each its own (water treated, a toilet, soap, water) */
function illRemedies(read: ReadCtx, store: EntityId, ways: readonly string[], toilet: Toilet): Remedy[] {
  return [...new Set(ways)].flatMap((w) => (w === 'treat' ? treatRemedies(read, store) : w === 'cover' ? toiletRemedies(read, store, toilet.uncovered) : w === 'toilet' ? [...(toilet.full ? emptyRemedies(read, store, toilet.full) : []), ...toiletRemedies(read, store)] : w === 'soap' ? soapRemedies(read, store) : supplyRemedies(read, store, 'water')));
}

/** the expected cases of illness in what someone drank today, after treatment; one is drawn from it */
function waterIllness(ctx: WriteCtx, store: EntityId, drunk: Record<string, number>, hands: number): { dose: number; ill: boolean; treated?: string } {
  const hold = ctx.port('holdings');
  let removal = 0;
  let treated: string | undefined;
  for (const [mat, q] of Object.entries(ctx.port('holdings').contents(store))) {
    const t = hold.material(mat).treats;
    if (q >= 1 - 1e-9 && t && t.removal.value > removal) (removal = t.removal.value), (treated = hold.material(mat).label);
  }
  // (what unwashed hands carry to the mouth: `hands`)
  const dose = (Object.entries(drunk).reduce((a, [mat, q]) => a + q * (hold.material(mat).pathogens?.value ?? 0), 0) * (1 - removal)) * hands;
  if (dose <= 0) return { dose: 0, ill: false };
  return { dose, ill: ctx.rng('water').chance(1 - Math.exp(-dose)), ...(treated ? { treated } : {}) };
}

/** the chance of falling ill today of excreta about the camp: what the toilet does not keep, carried by unwashed hands the more */
function sanitationIllness(ctx: WriteCtx, contains: number, hands: number): boolean {
  const set = ctx.data('livingSettings');
  if (!set.sanitation) return false;
  const dose = set.sanitation.open.value * (1 - contains) * hands;
  return dose > 0 && ctx.rng('sanitation').chance(1 - Math.exp(-dose));
}

/** someone who does not live through the night: told after the evening is settled for everyone */
type Death = { person: EntityId; party: EntityId; store: EntityId; cause: string };

/** a death settled: they are gone from the party, the log says why, the world sees it (the user: let people die) */
function die(ctx: WriteCtx, d: Death): void {
  if (!lifeOf(ctx, d.person)) return;
  ctx.remove('Resident', d.person);
  ctx.blockers.clear(d.person);
  // (where they are: the workforce asks the moves)
  ctx.command('workforce.die', { person: d.person, cause: d.cause });
  ctx.emit('living.died', { person: d.person, party: d.party, cause: d.cause });
  // the last of them: no one is left to receive, pay or work (Qwen: deliveries arrived and were paid for 70 days at an empty camp)
  // someone left: one of the household wherever they live (here, at a lodging or in hospital beyond the map, moved out to
  // town), at work for it, a helper here or on the way, a hire still to start (a friend at home is not): the one
  // population (decision 0028 rule 4; review x: a member living in town was not counted, and the household ended)
  if (populationOf(ctx, d.party).length) return;
  // (the party ends first: nothing new is begun for it from here, by anyone (a structure's work given up setting up its
  // "take back", a supply plan ordering again: the one check, `endedBlock`); what is for it ends with it (its adverts, its
  // offers), and its agreements are wound up as its estate's; decision 0028, Qwen S501, review y)
  ctx.command('parties.end', { party: d.party, why: `no one is left of it (${d.cause})` });
  for (const id of ctx.port('trade').openOrders({ party: d.party })) ctx.command('inventory.cancelOrder', { order: id });
  for (const [id, pr] of [...ctx.all('Project')]) if (pr.party === d.party && (pr.status === 'active' || pr.status === 'paused')) ctx.command('production.cancelProject', { project: id });
  // what it rents goes back (nobody pays a rental day for a camp no one lives in)
  for (const [id, m] of [...ctx.all('Machine')]) if (m.holder === d.party && m.ownership === 'rented') ctx.command('equipment.release', { machine: id });
  ctx.log('error', `No one is left of ${partyLabel(ctx, d.party)}: its open orders are cancelled, its work stops and what it rented goes back (what is on the road still arrives).`, [d.party]);
  ctx.emit('living.noOneLeft', { party: d.party });
}

/** the household's other holdings within a few steps of someone's home store (self-care's reach), nearest first */
function aroundOf(read: ReadCtx, r: Readonly<Resident>, reach = read.data('livingSettings').selfCare.value): EntityId[] {
  const hold = read.port('holdings');
  const home = hold.where(r.store);
  return home ? hold.ofParty(r.party, { kept: true, near: [home[0], home[1]], within: reach, except: r.store }) : [];
}

/**
 * The household's own errands (design/realism-plan.md S2, audit A11): at the hours of the day the household looks
 * (`livingSettings.routine.hours`), one of it at home and free goes for what the camp runs short of, by the errands a
 * player sends (a walk there and back with the load, the price paid at the counter): water when less than
 * `waterBelow` days are left or someone went thirsty (drawn at the creek when the camp can make it safe, else bought
 * where it is sold, else drawn as it comes), food when less than `foodBelow` days are left, from the nearest shop that
 * takes them now. Nothing is carried in without a walk; one who is thirsty goes whatever the hour.
 */
function routines(ctx: WriteCtx): void {
  const set = ctx.data('livingSettings');
  const rt = set.routine;
  if (!rt || !ctx.hasData('handling')) return;
  const tMax = ctx.port('weather').soFar(ctx.now).tMax;
  const camps = new Map<EntityId, { party: EntityId; people: EntityId[] }>();
  for (const [id, r] of lives(ctx)) {
    if (!livesHere(ctx, id)) continue;
    const c = camps.get(r.store) ?? { party: r.party, people: [] };
    c.people.push(id);
    camps.set(r.store, c);
  }
  for (const [store, c] of [...camps].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const need = householdNeed(ctx, store, tMax);
    const r0 = requireLife(ctx, c.people[0]!);
    const near = [store, ...aroundOf(ctx, r0)];
    const coming = comingIn(ctx, store, c.people);
    const litres = near.reduce((a, sid) => a + provisions(ctx, sid).litres, 0) + coming.litres;
    const kcal = near.reduce((a, sid) => a + eatableKcal(ctx, sid), 0) + coming.kcal;
    const thirsty = c.people.some((id) => (ctx.get('Body', id)?.thirst ?? 0) > 0.05);
    // who goes: one free (at home, awake, not on shift; one thirsty goes whatever), the fittest first (review S2 #9)
    const ill = (id: EntityId) => (ctx.get('Presence', id)?.status === 'sick' ? 1 : 0);
    const free = c.people.filter((id) => freeForErrand(ctx, id, thirsty)).sort((a, b) => ill(a) - ill(b) || (ctx.get('Body', b)?.health ?? 0) - (ctx.get('Body', a)?.health ?? 0) || (a < b ? -1 : 1));
    // (the household's own stores farther off first, carried in on foot; then the creek or a shop; and its own clean
    // water rather than drinking water as it comes, the user 2026-10-12)
    const clean = near.reduce((a, sid) => a + cleanWater(ctx, sid).reduce((b, w) => b + w.per * w.have, 0), 0) + coming.litres;
    if (free.length && (litres < need.water * rt.waterBelow.value || thirsty)) {
      const want = Math.max(0, need.water * rt.waterFor.value - litres);
      const who = free.shift()!;
      if (!fetchOwn(ctx, who, r0, 'water', want)) waterErrand(ctx, who, store, c.party, want);
    } else if (free.length && clean < need.drinking * rt.waterBelow.value && fetchOwn(ctx, free[0]!, r0, 'water', need.drinking * rt.waterFor.value - clean)) free.shift();
    if (free.length && kcal < need.energy * rt.foodBelow.value) {
      const want = Math.max(0, need.energy * rt.foodFor.value - kcal);
      const who = free.shift()!;
      if (!fetchOwn(ctx, who, r0, 'food', want)) foodErrand(ctx, who, store, c.party, want);
    }
  }
}

/**
 * What is on its way into a camp already (l of water, kcal of food): in the packs of those living there (shopping carried
 * home) and on the errands under way to it, bought or carried (review S2 #6: not bought twice)
 */
function comingIn(read: ReadCtx, store: EntityId, people: EntityId[]): { litres: number; kcal: number } {
  let litres = 0;
  let kcal = 0;
  const hold = read.port('holdings');
  for (const id of people) {
    const pack = packOf(read, id);
    if (!pack) continue;
    kcal += readyFood(read, pack).reduce((a, f) => a + f.per * Math.max(0, f.have - (read.get('Body', id)?.own?.[f.material] ?? 0)), 0);
  }
  for (const [, m] of read.port('moves').underway()) {
    if (m.ref !== store && !(m.purpose === 'carried' && read.port('trade').order(m.ref ?? '')?.store === store)) continue;
    for (const l of m.legs.at(-1)?.loads ?? []) {
      if (!('goods' in l)) continue;
      const mat = hold.material(l.goods.material);
      if (mat.water) litres += l.goods.qty * mat.water.value;
      if (mat.energy && !mat.cook) kcal += l.goods.qty * mat.energy.value;
    }
  }
  return { litres, kcal };
}

/**
 * The household's own clean water or food in a store of theirs farther off than a few steps (as far as one walks for
 * it), and where nobody lives: carried home on foot by one of them now, as much as one carries (an errand, in their own
 * time: review S2 #2, #5). True when they set out.
 */
function fetchOwn(ctx: WriteCtx, person: EntityId, r: Readonly<Life>, kind: 'water' | 'food', want: number): boolean {
  if (!(want > 1e-6)) return false;
  const set = ctx.data('livingSettings');
  const near = new Set([r.store, ...aroundOf(ctx, r)]);
  // (not another camp's: what its people live from is theirs to drink, not to fetch away)
  const homes = new Set(lives(ctx).map(([, x]) => x.store));
  const hold = ctx.port('holdings');
  const load = carries(ctx, person);
  for (const sid of aroundOf(ctx, r, set.fetchWalk.value)) {
    if (near.has(sid) || homes.has(sid)) continue;
    const p = provisions(ctx, sid);
    const goods = (kind === 'water' ? p.water.filter((w) => !((hold.material(w.material).pathogens?.value ?? 0) > 0)) : p.food).filter((g) => hold.free(sid, g.material) > 1e-6);
    const g = goods.sort((a, b) => b.have * b.per - a.have * a.per)[0];
    if (!g) continue;
    const mat = hold.material(g.material);
    let qty = Math.min(hold.free(sid, g.material), want / g.per, load / unitMass(mat));
    qty = isCounted(mat) ? Math.floor(qty) : Math.floor(qty * 100) / 100;
    if (!(qty > 0)) continue;
    const m = ctx.command('errands.carry', { person, from: sid, to: r.store, material: g.material, qty, party: r.party, routine: true });
    if (m.ok) {
      ctx.log('info', `${ctx.port('workforce').name(person)} fetches ${round(qty)} ${mat.unit} ${mat.label} from ${ctx.port('holdings').label(sid) ?? sid}.`, [person, r.store, sid]);
      return true;
    }
  }
  return false;
}

/** what in a store makes water as it comes safe to drink (a filter): its material, if any */
function treatmentIn(read: ReadCtx, store: EntityId): string | undefined {
  const hold = read.port('holdings');
  return Object.entries(read.port('holdings').contents(store)).find(([m, q]) => q >= 1 - 1e-9 && hold.material(m).treats)?.[0];
}

/**
 * free to go on an errand of the household's: at home on the map, on no move, fit to walk; not on the shift of the work
 * they are put to (review S2 #1: one assigned to a wall is free in the evening), not asleep by their own hours (#10); one
 * thirsty, or with someone thirsty at home, goes whatever
 */
function freeForErrand(read: ReadCtx, person: EntityId, urgent = false): boolean {
  if (!atHome(read, person) || read.port('moves').placeOf(person)?.on !== undefined || !read.port('moves').where(person)) return false;
  // (held where they are for a purpose: the household's errands wait, decision 0028)
  if (read.port('workforce').engaged(person)) return false;
  const status = read.get('Presence', person)?.status;
  // (released from work, on short time or on leave, they still see to their own: Qwen S507; as errands' fitToGo)
  const free = status === 'available' || status === 'released' || status === 'shortTime' || status === 'vacation';
  if (!free && status !== 'sick') return false;
  const body = read.contributions('bodyCarries').map((c) => c.impl(read, person)).find((x) => x !== null && x !== undefined);
  const fit = free ? (body?.share ?? 1) > 0 : (body?.share ?? 0) > 0;
  if (!fit) return false;
  if (urgent) return true;
  if (read.get('Body', person)?.night) return false;
  const party = partyOfPerson(read, person);
  return !(read.get('Assignment', person) && party && read.port('workforce').onShift(read.now, party));
}

/** what one carries now (kg): the safe load, less for one ill or weak */
function carries(read: ReadCtx, person: EntityId): number {
  const body = read.contributions('bodyCarries').map((c) => c.impl(read, person)).find((x) => x !== null && x !== undefined);
  return (read.data('handling')?.safeLoad.value ?? 25) * (body?.share ?? 1);
}

/** water for the camp: from the creek when the camp makes it safe, else bought where it is sold, else as it comes */
function waterErrand(ctx: WriteCtx, person: EntityId, store: EntityId, party: EntityId, want: number): void {
  const litres = Math.floor(Math.min(carries(ctx, person), Math.max(want, 5)));
  if (litres < 1) return;
  const name = ctx.port('workforce').name(person);
  const safe = treatmentIn(ctx, store) !== undefined;
  const draw = () => ctx.command('errands.drawWater', { person, store, qty: litres, party, routine: true });
  const buy = () => shopFor(ctx, person, store, party, (m) => Boolean(m.water) && !((m.pathogens?.value ?? 0) > 0), litres);
  const went = safe ? draw().ok || buy() : buy() || draw().ok;
  if (went) ctx.log('info', `${name} goes for water for the camp (${litres} l).`, [person, store]);
}

/** food for the camp: from the nearest shop that takes them now, as much as one carries */
function foodErrand(ctx: WriteCtx, person: EntityId, store: EntityId, party: EntityId, kcal: number): void {
  const went = shopFor(ctx, person, store, party, (m) => Boolean(m.energy && m.energy.value > 0 && !m.cook), carries(ctx, person), kcal);
  if (went) ctx.log('info', `${ctx.port('workforce').name(person)} goes shopping for the camp.`, [person, store]);
}

/**
 * One with a job beyond the map, at the end of the working day, while the camp runs short of food: groceries bought in
 * town on the way home (a shop beyond the map that is open now, the cheapest), as much as one carries, into what they
 * carry; they come in with them by the way home (design/realism-plan.md S2: the camper with a job never shopped)
 */
function shopOnTheWayHome(ctx: WriteCtx, person: EntityId, r: Readonly<Life>): number {
  const rt = ctx.data('livingSettings').routine;
  if (!rt) return 0;
  const tMax = ctx.port('weather').soFar(ctx.now).tMax;
  const need = householdNeed(ctx, r.store, tMax);
  // (what is at home, and what is on its way there: another's shopping, an errand under way; review S2 #6)
  const members = lives(ctx).filter(([, x]) => x.store === r.store).map(([id]) => id);
  const kcal = [r.store, ...aroundOf(ctx, r)].reduce((a, sid) => a + eatableKcal(ctx, sid), 0) + comingIn(ctx, r.store, members).kcal;
  if (kcal >= need.energy * rt.foodBelow.value) return 0;
  const hold = ctx.port('holdings');
  const hour = (ctx.now - ctx.calendar.startOfDay(ctx.now)) / HOUR;
  const weekday = ctx.calendar.at(ctx.now).weekday;
  const holiday = ctx.port('workforce').holiday(ctx.now);
  const open = Object.entries(ctx.data('suppliers') ?? {})
    .filter(([, sup]) => !sup.pos && !holiday && (!sup.openDays || sup.openDays.includes(weekday)) && hour >= sup.openFrom.value && hour < sup.openTo.value)
    .flatMap(([id, sup]) => Object.entries(sup.offers).filter(([m]) => { const mat = hold.material(m); return Boolean(mat.energy && mat.energy.value > 0 && !mat.cook); }).map(([m, o]) => ({ id, m, price: o.price.value })))
    .sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1));
  const shop = open[0];
  if (!shop) return 0;
  const pack = packFor(ctx, person, r.party);
  if (!pack) return 0;
  const mat = hold.material(shop.m);
  const price = shop.price * ctx.port('prices').index(ctx.now);
  // (as much as one carries, and as far as the money goes: review S2 #3)
  const kg = Math.min(((need.energy * rt.foodFor.value - kcal) / mat.energy!.value) * unitMass(mat), loadRoom(ctx, pack), price > 0 ? ((0.98 * ctx.port('prices').liquidity(r.party)) / price) * unitMass(mat) : Infinity);
  const qty = Math.floor((kg / unitMass(mat)) * 10) / 10;
  if (!(qty > 0)) return 0;
  const name = ctx.port('workforce').name(person);
  const b = ctx.command('inventory.buyBeyond', { into: pack, material: shop.m, qty, supplier: shop.id, carrier: name });
  if (!b.ok) return 0;
  const body = ctx.get('Body', person);
  if (body) ctx.set('Body', person, { ...body, bought: { ...body.bought, [shop.m]: (body.bought?.[shop.m] ?? 0) + qty } });
  ctx.log('info', `${name} buys ${qty} ${mat.unit} ${mat.label} in town on the way home.`, [person, r.store]);
  // (the time it takes: at the counter, and the way round by the shop: review S2 #8)
  return ((ctx.data('handling')?.errand.atCounter.value ?? 0.3) + (ctx.data('livingSettings').routine?.detour?.value ?? 0)) * HOUR;
}

/** the food one carried home put into the store they live from, once the day is reckoned (tomorrow's lunch is packed again in the morning) */
function unpackShopping(ctx: WriteCtx, person: EntityId, store: EntityId): void {
  const pack = packOf(ctx, person);
  // (home on the map: a move out to work ends beyond it, though it names home as its end)
  if (!pack || !ctx.port('moves').where(person)) return;
  const hold = ctx.port('holdings');
  const body = ctx.get('Body', person);
  const bought = body?.bought ?? {};
  // (only the shopping: what a player had them take along stays in their pack, review S2 #11)
  for (const [m, q] of Object.entries(bought)) {
    const qty = Math.min(q, hold.stock(pack, m));
    if (qty <= 1e-9 || !hold.together(pack, store)) continue;
    ctx.command('inventory.transfer', { from: pack, to: store, material: m, qty, why: `${ctx.port('workforce').name(person)}: the shopping put away` });
  }
  if (body?.bought) {
    const { bought: _b, ...rest } = ctx.get('Body', person)!;
    ctx.set('Body', person, rest);
  }
}

/** what someone carries: their holding riding on them, made if they have none (where they are, or at the way in when beyond the map) */
function packFor(ctx: WriteCtx, person: EntityId, party: EntityId): EntityId | undefined {
  const pack = packOf(ctx, person);
  if (pack) return pack;
  const at = ctx.port('moves').where(person);
  const ext = ctx.port('routing').externalNodes()[0];
  const edge = ext !== undefined ? ctx.get('NetNode', ext)?.pos : undefined;
  const pos = at ?? edge;
  if (!pos) return undefined;
  const made = ctx.command('inventory.createStore', { holder: party, label: `${ctx.port('workforce').name(person)}: what they carry`, kind: 'carried', pos: [pos[0], pos[1]], on: person });
  return made.ok ? (made.value as EntityId) : undefined;
}

/**
 * Fetch a good that fits from the nearest shop that sells it and takes the errand now (open, a way there, the money):
 * `kg` as most, or for `kcal` of food. True when someone set out.
 */
function shopFor(ctx: WriteCtx, person: EntityId, store: EntityId, party: EntityId, fits: (m: Material) => boolean, kg: number, kcal?: number): boolean {
  const hold = ctx.port('holdings');
  const shops = Object.entries(ctx.data('suppliers') ?? {})
    .flatMap(([id, sup]) => Object.entries(sup.offers).filter(([m]) => fits(hold.material(m))).map(([m, o]) => ({ id, m, o, d: sup.distance?.value ?? Infinity })))
    .sort((a, b) => a.d - b.d || a.o.price.value - b.o.price.value || (a.id < b.id ? -1 : 1));
  for (const x of shops) {
    const mat = hold.material(x.m);
    const per = unitMass(mat);
    let qty = kg / per;
    if (kcal !== undefined && mat.energy) qty = Math.min(qty, kcal / mat.energy.value);
    // (as far as the money goes: less than wanted rather than nothing, review S2 #3; the day's price may be a little more)
    const price = x.o.price.value * ctx.port('prices').index(ctx.now);
    if (price > 0) qty = Math.min(qty, (0.98 * ctx.port('prices').liquidity(party)) / price);
    qty = Math.max(qty, x.o.minOrder.value);
    if (qty * per > kg + 1e-9 || qty * price > ctx.port('prices').liquidity(party)) continue;
    qty = Math.floor(qty * 10) / 10;
    if (!(qty > 0)) continue;
    if (ctx.command('errands.fetch', { person, material: x.m, qty, store, supplier: x.id, party, routine: true }).ok) return true;
  }
  return false;
}

/**
 * What one fetches oneself from the household's holdings within a few steps of home (a rain barrel by the tent, a
 * canister in the next one) when the home store is short: carried in before eating and drinking. Self-care, not
 * work (design/physical-state.md §6: the five friends died of thirst 14 m from a full barrel).
 */
function fetchAround(ctx: WriteCtx, r: Readonly<Life>, kind: 'water' | 'food', short: number, name: string, only?: 'clean'): void {
  if (short <= 1e-9) return;
  let left = short;
  const hold = ctx.port('holdings');
  const clean = (m: string) => !((hold.material(m).pathogens?.value ?? 0) > 0);
  // clean water first, then anything, the cleanest first; then the creek or the pond, as it comes (the user, 2026-10-12);
  // all within a few steps of home: what lies farther is fetched by a walk, the household's routine (S2), never in here
  const walk = ctx.data('livingSettings').selfCare.value;
  const passes: { stores: EntityId[]; ok: (m: string) => boolean }[] = only === 'clean' ? [{ stores: aroundOf(ctx, r, walk), ok: clean }] : kind === 'food' ? [{ stores: aroundOf(ctx, r, walk), ok: () => true }] : [{ stores: aroundOf(ctx, r), ok: () => true }];
  for (const pass of passes) for (const id of pass.stores) {
    const p = provisions(ctx, id);
    for (const f of (kind === 'water' ? p.water : p.food).filter((x) => pass.ok(x.material))) {
      if (left <= 1e-9) return;
      const qty = Math.min(f.have, left / f.per);
      if (qty <= 1e-6) continue;
      const t = ctx.command('inventory.transfer', { from: id, to: r.store, material: f.material, qty, via: 'carried in cans', why: `${name}: fetched in for the day` });
      if (t.ok) left -= qty * f.per;
    }
  }
  // (and from water within those steps, as it comes: a camp by the creek or the pond drinks from it, untreated: §5)
  if (kind === 'water' && !only && left > 1e-9 && ctx.hasPort('terrain') && ctx.hasData('handling')) {
    const draw = ctx.data('handling')!.drawWater;
    const home = ctx.port('holdings').where(r.store);
    const near = home ? waterNear(ctx, [home[0], home[1]], ctx.data('livingSettings').selfCare.value) : undefined;
    // (the good it is, by the water it is drawn from)
    const raw = near ? (draw?.bySource?.[near.kind] ?? draw?.material) : undefined;
    const m = raw ? ctx.port('holdings').material(raw) : undefined;
    if (near && m && m.unit === 'l') ctx.command('terrain.draw', { at: near.at, material: raw!, qty: left, m3: left / 1000, into: r.store, why: `${name}: drawn at the water for the day` });
  }
}

/** the nearest point at a creek or the pond within `reach` of a place (none farther) */
function waterNear(read: ReadCtx, p: [number, number], reach: number): { at: [number, number]; kind: string } | undefined {
  let best: { at: [number, number]; d: number; kind: string } | undefined;
  for (const w of read.port('terrain').waterBodies()) {
    w.points.forEach((q, k) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]) - (w.widths ? w.widths[k]! / 2 : 0);
      if (d <= reach && (!best || d < best.d)) best = { at: [q[0], q[1]], d, kind: w.kind };
    });
  }
  return best ? { at: best.at, kind: best.kind } : undefined;
}

/**
 * Days away from here (on leave, on a course, living elsewhere): the body lives them where it is, fed, watered and
 * washed there, and sleeps there as on a free day (the boundary's model: design/physical-state.md §3, not frozen).
 * What it costs is theirs, beyond the map.
 */
function awayDays(ctx: WriteCtx, person: EntityId, days: number): void {
  const b = ctx.get('Body', person);
  if (!b || days <= 0) return;
  const set = ctx.data('livingSettings');
  const need = ctx.port('needs').requirement(person, { workHours: 0, tMax: 20 });
  const n = Math.min(days, 366);
  const sleepDebt = Math.max(0, b.sleepDebt - n * set.lieIn.value);
  const mends = sleepDebt <= 2 * set.tiredness.debt.value ? set.health.recovers.value * n : 0;
  // (a time away on the map ends with days beyond it: r42)
  const { away: _away, today: _today, ...b0 } = b;
  ctx.set('Body', person, { ...b0, hunger: Math.max(0, b.hunger - n * need.energy.v * 0.5), thirst: 0, dryDays: 0, unmetDays: 0, sweat: 0, unwashedDays: 0, sleepDebt, health: Math.min(1, b.health + mends), lastDay: Math.floor(ctx.now / DAY) });
}

/** the lodgings open now that one can be had at once, cheapest first (the shelter, which takes anyone, last) */
function lodgingsOpen(read: ReadCtx): [string, LodgingData][] {
  if (!read.hasData('lodgings')) return [];
  const month = read.calendar.at(read.now).month;
  return Object.entries(read.data('lodgings') ?? {})
    .filter(([, l]) => l.kind !== 'hospital' && (!l.months || l.months.includes(month)))
    .sort(([, a], [, b]) => Number(Boolean(a.always)) - Number(Boolean(b.always)) || a.perNight.value + a.food.value - (b.perNight.value + b.food.value));
}

/** whether those who come carry what a lodging asks one to bring (a tent and bedding for a pitch: r42) */
function brought(read: ReadCtx, people: EntityId[], l: LodgingData): boolean {
  const packs = people.map((p) => packOf(read, p)).filter((x): x is EntityId => Boolean(x));
  return (l.bring ?? []).every((alts) => alts.some((m) => packs.some((pk) => read.port('holdings').stock(pk, m) >= 1 - 1e-9)));
}

/** where someone of a party goes who leaves where they lived: the cheapest place open now the party can pay a month of, and they bring what it asks, else the shelter */
function lodgingFor(read: ReadCtx, party: EntityId, people: EntityId[]): string | undefined {
  const cash = read.port('prices').liquidity(party);
  const open = lodgingsOpen(read);
  const can = open.find(([, l]) => !l.wait && !l.always && cash >= 30 * people.length * (l.perNight.value + l.food.value) && brought(read, people, l));
  return (can ?? open.find(([, l]) => l.always))?.[0];
}

/**
 * One of the household leaves the place they lived for a lodging beyond the map (VISION "Leaving goes somewhere"): no
 * longer living on site, still one of the household, at their job and paid; they walk out with what they carry
 */
function lodge(ctx: WriteCtx, person: EntityId, party: EntityId, lodging: string, why: string): void {
  const l = ctx.data('lodgings')?.[lodging];
  if (!l) return;
  const name = ctx.port('workforce').name(person);
  if (lifeOf(ctx, person)) {
    ctx.remove('Resident', person);
    ctx.blockers.clear(person);
  }
  ctx.command('workforce.livesElsewhere', { person });
  // (a time away on the map ends with leaving it: r42)
  const body = ctx.get('Body', person);
  if (body && (body.away || body.today)) {
    const { away: _a, today: _t, ...rest } = body;
    ctx.set('Body', person, rest);
  }
  ctx.set('Lodging', person, { party, lodging, since: ctx.now });
  // out to the way in, on foot (beyond the map from there); on a move now, when it ends (r42)
  if (!walkOut(ctx, person)) ctx.set('Lodging', person, { ...ctx.require('Lodging', person), out: true });
  ctx.log('warn', `${name} leaves (${why}) for ${l.label.charAt(0).toLowerCase()}${l.label.slice(1)}: ${Math.round(l.perNight.value + l.food.value)} € a day with food, still one of ${partyLabel(ctx, party)}.`, [person]);
}

/** one who lives beyond the map now walks out to the way in (false: on a move, not yet) */
function walkOut(ctx: WriteCtx, person: EntityId): boolean {
  const moves = ctx.port('moves');
  if (moves.placeOf(person)?.on !== undefined) return false;
  const from = moves.where(person);
  const ext = ctx.port('routing').externalNodes()[0];
  if (!from || ext === undefined) return true;
  const r = ctx.command('moves.dispatch', { legs: [{ carrier: { class: ctx.data('labourSettings').ways.walk, unit: person }, from: [from[0], from[1]], to: [from[0], from[1]], externalDestination: ext, beyondKm: 5, maxOffroad: 5000, loads: [] }], purpose: 'leaving', ref: person, requester: 'living' });
  return r.ok;
}

/** a body giving out: health this low, or a day from dying of thirst or of hunger (the fatal days, less one) */
function givingOut(read: ReadCtx, r: Readonly<Body>): boolean {
  const set = read.data('livingSettings');
  if (!set.rescue) return false;
  const f = set.fatal;
  return r.health <= set.rescue.critical.value || (f !== undefined && ((r.dryDays ?? 0) >= f.dryDays.value - 1 || r.hunger >= f.starvation.value * 0.9));
}

/**
 * Whether someone needs a hospital's care (one fact for the 112 call and the discharge, decision 0028 rule 4): their body
 * giving out, or not well enough to be sent home (the discharge mark). The rescue service and the hospital act on medical
 * need (§ 60 Abs. 1 and § 39 Abs. 1 SGB V): one who is well is neither fetched nor kept.
 */
function needsCare(read: ReadCtx, person: EntityId): boolean {
  const b = read.get('Body', person);
  if (!b) return false;
  return b.health < (read.data('livingSettings').rescue?.discharge.value ?? 1) || givingOut(read, b);
}

/**
 * 112 for one whose body is giving out (Qwen S506/S507: a founder too weak to walk died with money and a phone, and
 * nobody called): they call, or one of theirs within hearing does, with a phone with charge (no charge, nobody near: no
 * call). The rescue service comes as near as its vehicle gets, its crew carries them from there on a stretcher, and
 * takes them to hospital beyond the map (a hospital stay: `living.inHospital`; home when well). `asked`: the player
 * called (a refusal says why); else the evening's own call, said once when it cannot be made.
 */
function rescue(ctx: WriteCtx, person: EntityId, asked: boolean): EntityId | undefined {
  const set = ctx.data('livingSettings').rescue;
  const r = lifeOf(ctx, person);
  const wf = ctx.port('workforce');
  const moves = ctx.port('moves');
  const name = wf.name(person);
  const fail = (code: string, params: Record<string, string | number>): undefined => {
    if (asked) ctx.reject(code, params);
    if (!ownBlockers(ctx, person).some((b) => b.code === code)) ctx.blockers.set(person, [...ownBlockers(ctx, person), { code, severity: 'block', params, remedies: [{ label: `Call 112 for ${name}`, command: { type: 'living.callRescue', payload: { person } } }] }]);
    return undefined;
  };
  if (!set || !r || !ctx.hasData('lodgings') || !Object.values(ctx.data('lodgings') ?? {}).some((l) => l.kind === 'hospital')) return fail('living.noRescue', { person: name, why: 'there is no rescue service in this world' });
  // (no emergency, no ambulance: a call for one who is well is refused with why; review x)
  if (!needsCare(ctx, person)) {
    if (asked) ctx.reject('living.noEmergency', { person: name, health: Math.round(r.health * 100) });
    return undefined;
  }
  // (where they are: the service is sent to a place on this map; one on the way has none yet, one beyond the map is not
  // where it goes; the player's call is refused with why, never taken silently: review y)
  const at = moves.where(person);
  if (!at) return asked ? ctx.reject('living.beyondMap', { person: name }) : undefined;
  if (moves.placeOf(person)?.on !== undefined) return asked ? ctx.reject('living.onTheWay', { person: name }) : undefined;
  // who calls: they themselves, or one of theirs within hearing, with charge in their phone
  const ways = ctx.data('labourSettings').ways;
  const near = [person, ...wf.population(r.party).filter((id) => id !== person)].filter((id) => {
    const w = moves.where(id);
    return w && moves.placeOf(id)?.on === undefined && Math.hypot(w[0] - at[0], w[1] - at[1]) <= ways.hearing.value;
  });
  const caller = near.find((id) => wf.phone(id) > 0);
  if (!caller) return fail('living.noRescue', { person: name, why: near.length > 1 ? 'nobody by them has a phone with charge' : 'their phone is flat and nobody is within hearing' });
  const ext = ctx.port('routing').externalNodes()[0];
  if (ext === undefined) return fail('living.noRescue', { person: name, why: 'no way into the map' });
  // the ambulance as near as it gets (a stretcher carried the rest); no way for it onto the map: its crew on foot from
  // the end of its road (a helicopter is not modelled yet)
  const routing = ctx.port('routing');
  const stop = routing.approach(ext, at, set.vehicle, 300, ways.walk, 'in', { maxOffroad: 5000 }) ?? undefined;
  const van = { class: set.vehicle, fleet: 'rescue' };
  const crew = { class: ways.walk, fleet: 'rescue' };
  const here: [number, number] = [at[0], at[1]];
  const legs = stop
    ? [
        { carrier: van, from: [stop[0], stop[1]] as [number, number], to: [stop[0], stop[1]] as [number, number], externalNode: ext, loads: [], maxOffroad: 5000 },
        ...(Math.hypot(stop[0] - at[0], stop[1] - at[1]) > ways.reach.value ? [{ carrier: crew, from: [stop[0], stop[1]] as [number, number], to: here, loads: [], maxOffroad: 5000 }, { carrier: crew, from: here, to: [stop[0], stop[1]] as [number, number], loads: [{ person }], maxOffroad: 5000 }] : []),
        { carrier: van, from: [stop[0], stop[1]] as [number, number], to: [stop[0], stop[1]] as [number, number], externalDestination: ext, loads: [{ person }], maxOffroad: 5000 },
      ]
    : [
        { carrier: crew, from: here, to: here, externalNode: ext, loads: [], maxOffroad: 5000 },
        { carrier: crew, from: here, to: here, externalDestination: ext, loads: [{ person }], maxOffroad: 5000 },
      ];
  const go = ctx.command('moves.dispatch', { legs, purpose: 'rescue', ref: person, requester: 'living' });
  if (!go.ok) return fail('living.noRescue', { person: name, why: go.reasons.map((b) => ctx.formatBlocker(b)).join('; ') });
  // no longer living on site: in hospital from when they are there (the stay, its days and its care, count from the
  // arrival: review y); the ride's share paid by the insured
  ctx.remove('Resident', person);
  ctx.blockers.clear(person);
  ctx.command('workforce.livesElsewhere', { person });
  const hospital = Object.entries(ctx.data('lodgings') ?? {}).find(([, l]) => l.kind === 'hospital')![0];
  const there = ctx.require('Move', go.value as EntityId).legs.at(-1)!.arrive;
  ctx.set('Lodging', person, { party: r.party, lodging: hospital, since: there, back: r.store });
  if (set.ride.value > 0) ctx.ledger.post({ from: acct(r.party, ACCOUNTS.cash), to: acct(r.party, ACCOUNTS.transport), amount: set.ride.value, memo: `${name}: the ride to hospital (the insured's share)`, category: ACCOUNTS.transport, refs: [person] });
  ctx.log('error', `${wf.name(caller)} calls 112 for ${name}${caller === person ? ' (their own call)' : ''}: the rescue service ${stop ? 'comes' : 'comes on foot from the end of its road'} and takes them to hospital, there about ${ctx.calendar.format(there)}.`, [person]);
  return go.value as EntityId;
}

/** a day at a lodging: paid by the household (the shelter's fee by the job centre when it cannot), the body kept there */
function lodgedDay(ctx: WriteCtx, person: EntityId): void {
  const ld = ctx.get('Lodging', person);
  if (!ld) return;
  // a room found: moved into now
  if (ld.next && ld.next.at <= ctx.now) {
    ctx.set('Lodging', person, { party: ld.party, lodging: ld.next.lodging, since: ctx.now });
    ctx.log('info', `${ctx.port('workforce').name(person)} moves into ${ctx.data('lodgings')?.[ld.next.lodging]?.label.toLowerCase() ?? ld.next.lodging}.`, [person]);
    return lodgedDay(ctx, person);
  }
  const l = ctx.data('lodgings')?.[ld.lodging];
  if (!l) return;
  const name = ctx.port('workforce').name(person);
  // in hospital: treated and fed there (the insured's share for each calendar day of the stay, the day of admission
  // too, for at most so many days a calendar year), sent away when well. The stay begins at the arrival: one still in
  // the ambulance is neither charged nor cared for there yet (review y)
  if (l.kind === 'hospital') {
    if (ld.since > ctx.now) return;
    const today = Math.floor(ctx.now / DAY);
    for (let d = Math.max(Math.floor(ld.since / DAY), (ld.paid ?? -Infinity) + 1); d <= today; d += 1) {
      const body = ctx.get('Body', person);
      const year = ctx.calendar.at(d * DAY).year;
      const paid = body?.copaid?.year === year ? body.copaid.days : 0;
      if (!(l.perNight.value > 0) || (l.daysAYear && paid >= l.daysAYear.value)) continue;
      ctx.ledger.post({ from: acct(ld.party, ACCOUNTS.cash), to: acct(ld.party, ACCOUNTS.rentExpense), amount: l.perNight.value, memo: `${name}: a day in hospital (the insured's share)`, category: ACCOUNTS.rentExpense, refs: [person] });
      if (body) ctx.set('Body', person, { ...body, copaid: { year, days: paid + 1 } });
    }
    ctx.set('Lodging', person, { ...ld, paid: today });
    awayDays(ctx, person, 1);
    if (!needsCare(ctx, person)) return discharge(ctx, person, ld);
    ctx.blockers.set(person, [{ code: 'living.inHospital', severity: 'info', params: { person: name } }]);
    return;
  }
  const cost = l.perNight.value + l.food.value;
  const cash = ctx.port('prices').liquidity(ld.party);
  // closed for the season, or more than the household can pay: to the cheapest open now, or the shelter
  const open = !l.months || l.months.includes(ctx.calendar.at(ctx.now).month);
  if (!l.always && (!open || cash < cost)) {
    const to = lodgingFor(ctx, ld.party, [person]);
    if (to && to !== ld.lodging) {
      // (a room still looked for is looked for on)
      ctx.set('Lodging', person, { party: ld.party, lodging: to, since: ctx.now, ...(ld.next ? { next: ld.next } : {}) });
      ctx.log('warn', `${name} has to leave ${l.label.toLowerCase()} (${!open ? 'closed for the season' : 'the household cannot pay it'}) for ${ctx.data('lodgings')![to]!.label.toLowerCase()}.`, [person]);
      return lodgedDay(ctx, person);
    }
  }
  // (the night is rent, the food bought is food: r42)
  const rent = Math.min(l.perNight.value, Math.max(0, cash));
  const food = Math.min(l.food.value, Math.max(0, cash - rent));
  if (rent > 0) ctx.ledger.post({ from: acct(ld.party, ACCOUNTS.cash), to: acct(ld.party, ACCOUNTS.rentExpense), amount: Math.round(rent * 100) / 100, memo: `${name}: a night at ${l.label.toLowerCase()}`, category: ACCOUNTS.rentExpense, refs: [person] });
  if (food > 0) ctx.ledger.post({ from: acct(ld.party, ACCOUNTS.cash), to: acct(ld.party, ACCOUNTS.food), amount: Math.round(food * 100) / 100, memo: `${name}: food bought while at ${l.label.toLowerCase()}`, category: ACCOUNTS.food, refs: [person] });
  // fed and rested there, as a day away
  awayDays(ctx, person, 1);
  const rooms = (ctx.data('lodgings') ? Object.entries(ctx.data('lodgings')!) : []).filter(([, x]) => x.wait && x.kind === 'room');
  ctx.blockers.set(person, [{ code: 'living.lodged', severity: 'info', params: { person: name, lodging: l.label, cost: Math.round(cost) }, remedies: rooms.map(([id, x]) => ({ label: `Look for ${x.label.charAt(0).toLowerCase()}${x.label.slice(1)} (some ${Math.round(x.wait!.value)} days to find; ${Math.round(x.perNight.value + x.food.value)} € a day with food)`, command: { type: 'living.lodge', payload: { person, lodging: id } } })) }]);
}

/**
 * Well again, out of hospital: a hospital discharges, and its discharge management arranges where to (§ 39 Abs. 1a SGB
 * V); every stay ends (decision 0028 rule 1; review x: the store she lived at given up meanwhile, she stayed for ever).
 * Home to the store they lived at; that gone, to where others of the household live; none, to a lodging beyond the map
 * (the cheapest open the household can pay, else the town's shelter); none of those either, home off the site to their
 * own people, with the ways back said.
 */
function discharge(ctx: WriteCtx, person: EntityId, ld: Readonly<Lodging>): void {
  const name = ctx.port('workforce').name(person);
  const gone = ld.back !== undefined && !ctx.port('holdings').exists(ld.back);
  // (where most of the household lives now)
  const counts = new Map<EntityId, number>();
  for (const [id, r] of lives(ctx)) if (id !== person && r.party === ld.party && !ctx.get('Person', id)?.died && ctx.port('holdings').exists(r.store)) counts.set(r.store, (counts.get(r.store) ?? 0) + 1);
  const home = !gone && ld.back ? ld.back : [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  ctx.remove('Lodging', person);
  ctx.blockers.clear(person);
  if (home) {
    ctx.log('success', `${name} is well again and leaves hospital for ${ctx.port('holdings').label(home)!}${gone ? ' (the place they lived at is no more: where others of the household live)' : ''}.`, [person]);
    // (back to live there: they come by a move, the way in, report)
    const back = ctx.command('living.settle', { person, party: ld.party, store: home });
    if (!back.ok) throw new Error(`${name} home from hospital: ${JSON.stringify(back.reasons)}`);
    ctx.command('workforce.moveIn', { person });
    return;
  }
  const to = lodgingFor(ctx, ld.party, [person]);
  if (to) {
    ctx.set('Lodging', person, { party: ld.party, lodging: to, since: ctx.now });
    ctx.log('warn', `${name} is well again and leaves hospital: the place they lived at is no more, and nobody of ${partyLabel(ctx, ld.party)} lives on site, so for ${ctx.data('lodgings')![to]!.label.charAt(0).toLowerCase()}${ctx.data('lodgings')![to]!.label.slice(1)} (living.moveIn to live at a store of ours again).`, [person]);
    return;
  }
  // (no lodging in this world: with their own people beyond the map, as one who moved out; still of the household)
  ctx.log('warn', `${name} is well again and leaves hospital, with nowhere of ${partyLabel(ctx, ld.party)} to live: they live beyond the map for now (living.moveIn to live at a store of ours again).`, [person]);
}

/** how many more kg someone can carry: the safe load less what they carry (r42) */
function loadRoom(read: ReadCtx, pack: EntityId | undefined): number {
  const hold = read.port('holdings');
  const load = read.hasData('handling') ? (read.data('handling')?.safeLoad.value ?? 25) : 25;
  const kg = pack ? Object.entries(read.port('holdings').contents(pack)).reduce((a, [m, q]) => a + q * unitMass(hold.material(m)), 0) : 0;
  return Math.max(0, load - kg);
}

/**
 * At home in the evening (after everyone has drunk, r42): what is not for carrying put down (the wrappers of the lunch
 * eaten, r42), and the bottles filled with clean water for tomorrow, as far as one carries
 */
function refill(ctx: WriteCtx, person: EntityId, home: EntityId): void {
  const pack = packOf(ctx, person);
  // (there now: not on the way back)
  if (!pack || !homeBy(ctx, person, ctx.now)) return;
  const hold = ctx.port('holdings');
  const via = hold.together(home, pack) ? {} : { via: 'carried in cans' as const };
  // (what is left of what was eaten: the packaging, put down at home)
  const leftovers = new Set(Object.keys(ctx.data('materials')).map((m) => hold.material(m).leaves?.material).filter((m): m is string => Boolean(m)));
  for (const [m, q] of Object.entries(ctx.port('holdings').contents(pack))) if (q > 1e-9 && leftovers.has(m)) ctx.command('inventory.transfer', { from: pack, to: home, material: m, qty: q, ...via, why: `${ctx.port('workforce').name(person)}: the wrappers put down` });
  let room = vessels(ctx, pack).litres - vessels(ctx, pack).water;
  for (const w of cleanWater(ctx, home)) {
    if (room <= 1e-6) break;
    const qty = Math.min(w.have, room / w.per, loadRoom(ctx, pack) / unitMass(hold.material(w.material)));
    if (qty <= 1e-9) continue;
    const r = ctx.command('inventory.transfer', { from: home, to: pack, material: w.material, qty, ...via, why: `${ctx.port('workforce').name(person)}: the bottle filled` });
    if (r.ok) room -= qty * w.per;
  }
}

/** the ways to have water along: a bottle of the household's into their pack, or one bought */
function carryRemedies(read: ReadCtx, person: EntityId, home: EntityId): Remedy[] {
  const hold = read.port('holdings');
  const bottles = Object.keys(read.data('materials')).filter((m) => hold.material(m).vessel);
  const pack = packOf(read, person);
  const name = read.port('workforce').name(person);
  // (a bottle carried already, refilled each evening: the room is the bottles' own)
  const have = bottles.find((m) => hold.stock(home, m) >= 1);
  if (have) return [{ label: `${name} takes a ${hold.material(have).label.toLowerCase()} along (filled at home each evening)`, command: { type: 'living.pack', payload: { person, material: have, qty: 1 } } }];
  const offer = bottles.flatMap((m) => read.port('trade').offers(m).map((o) => ({ m, o }))).sort((a, b) => a.o.price - b.o.price)[0];
  if (!offer) return [];
  return [{ label: `Buy ${pack && vessels(read, pack).litres > 0 ? 'another' : 'a'} ${hold.material(offer.m).label.toLowerCase()} (${Math.round(offer.o.price)} €) for ${name} to carry`, command: { type: 'inventory.order', payload: { material: offer.m, qty: 1, store: home, supplier: offer.o.supplier } } }];
}

/** what a person carries (design/physical-state.md 8b, VISION "What one carries goes along"): a holding riding on them */
function packOf(read: ReadCtx, person: EntityId): EntityId | undefined {
  return read.port('holdings').carriedBy(person);
}

/** the litres of water a holding's vessels hold, and the litres of water in it */
function vessels(read: ReadCtx, store: EntityId): { litres: number; water: number } {
  const hold = read.port('holdings');
  let litres = 0;
  let water = 0;
  for (const [m, q] of Object.entries(read.port('holdings').contents(store))) {
    const mat = hold.material(m);
    if (mat.vessel) litres += q * mat.vessel.litres.value;
    if (mat.water) water += q * mat.water.value;
  }
  return { litres, water };
}

/** clean water in a holding, as provisions (what can be drunk without harm) */
const cleanWater = (read: ReadCtx, store: EntityId) => provisions(read, store).water.filter((w) => !((read.port('holdings').material(w.material).pathogens?.value ?? 0) > 0));

/**
 * Drunk from a holding away from home: what leaves the body leaves it there (urine to the ground, the rest breathed and
 * sweated to the air), not into the home's toilet
 */
function drinkAway(ctx: WriteCtx, person: EntityId, store: EntityId, want: number, why: string, toilet?: { store: EntityId; material: string; room: number }): number {
  if (!(want > 1e-6)) return 0;
  const set = ctx.data('livingSettings');
  const tMax = ctx.port('weather').soFar(ctx.now).tMax;
  const ex = set.sanitation?.excreta;
  const urine = ex ? Math.min(1, ex.urine.value / Math.max(0.1, ctx.port('needs').requirement(person, { workHours: 0, tMax }).water.v)) : 0;
  let got = 0;
  for (const w of cleanWater(ctx, store)) {
    if (got >= want - 1e-9) break;
    const qty = Math.min(w.have, (want - got) / w.per);
    if (qty <= 1e-9) continue;
    // (into the toilet as far as its tank has room, the rest on the ground)
    const kept = urine > 0 && toilet ? passAt(ctx, store, toilet, w.material, qty * urine, why) : 0;
    if (urine > 0 && qty * urine - kept > 1e-9) ctx.command('inventory.release', { from: store, material: w.material, qty: qty * urine - kept, to: 'ground', why, usedUp: true });
    if (urine < 1) ctx.command('inventory.release', { from: store, material: w.material, qty: qty * (1 - urine), to: 'air', why, usedUp: true });
    got += qty * w.per;
  }
  return got;
}

/**
 * What one drank away from home and passed at a toilet that collects (a site's mobile toilet, realism S1b): it becomes
 * what the toilet collects where it was drunk, and goes into the toilet with them (a few steps: in the body). Returns
 * how much of `qty` went in: no more than its tank has room for (the rest the caller sets on the ground, review S1b
 * #5), so that a tank fills to the brim and is full, not left a few litres short of it for ever (S508)
 */
function passAt(ctx: WriteCtx, from: EntityId, toilet: { store: EntityId; material: string; room: number }, material: string, qty: number, why: string): number {
  const hold = ctx.port('holdings');
  const per = unitMass(hold.material(material)) / unitMass(hold.material(toilet.material));
  const into = Math.min(qty, Math.max(0, toilet.room) / per);
  if (!(into > 1e-9)) return 0;
  const passed = into * per;
  toilet.room -= passed;
  if (!ctx.command('inventory.transform', { at: from, take: [{ material, qty: into }], give: [{ material: toilet.material, qty: passed }], why }).ok) return 0;
  if (from === toilet.store) return into;
  const t = ctx.command('inventory.transfer', { from, to: toilet.store, material: toilet.material, qty: passed, ...(hold.together(from, toilet.store) ? {} : { via: 'passed at the toilet' }), why });
  if (!t.ok) ctx.command('inventory.release', { from, material: toilet.material, qty: passed, to: 'ground', why, usedUp: true });
  return into;
}

/** what the tanks of a store's toilets that collect a material have room for (in that material's units) */
function tankRoom(read: ReadCtx, store: EntityId, material: string): number {
  const hold = read.port('holdings');
  const contents = read.port('holdings').contents(store);
  let capacity = 0;
  for (const [m, q] of Object.entries(contents)) {
    const c = hold.material(m).sanitation?.collects;
    if (c && c.material === material && q >= 1 - 1e-9) capacity += c.capacity.value * Math.floor(q + 1e-9);
  }
  return Math.max(0, capacity / unitMass(hold.material(material)) - (contents[material] ?? 0));
}

/** the toilet of ours that keeps most from flies and hands among the stores by one away from home, if any (realism S1b) */
function toiletBy(read: ReadCtx, by: EntityId[]): { store: EntityId; toilet: Toilet } | undefined {
  let best: { store: EntityId; toilet: Toilet } | undefined;
  for (const store of by) {
    const toilet = toiletOf(read, store, new Map());
    if (toilet.contains > (best?.toilet.contains ?? 0) || (!best && toilet.full)) best = { store, toilet };
  }
  return best;
}

/** fallen ill of excreta where they worked away from home (S1b): a bout as from a camp's, its days and its harm */
function fallIllAway(ctx: WriteCtx, person: EntityId, why: string): void {
  const illness = ctx.data('livingSettings').waterIllness;
  const b = ctx.get('Body', person);
  if (!illness || !b) return;
  const serious = illness.serious && ctx.rng('illness-away').chance(illness.serious.share.value) ? illness.serious : undefined;
  ctx.set('Body', person, { ...b, health: Math.max(0, b.health - (serious ?? illness).harm.value) });
  const hands = handsSaid(b);
  ctx.command('workforce.fallIll', { person, until: ctx.calendar.startOfDay(ctx.now) + (serious ?? illness).days.value * DAY + EVENING_H * HOUR, reason: illnessSaid(illness, serious, `: ${why}`, hands) });
}

const SITE_CODES = ['living.siteDry', 'living.siteNoToilet'];

/**
 * A stint away from home settled by the stores of ours by where they were (realism S1b): today's record at the nearest
 * (a site's store), and what is said on it. Away from any store of ours, one who lives beyond the map is told so, with
 * a store to set up where they work (residents hear of the day in their evening).
 */
function siteDay(ctx: WriteCtx, person: EntityId, by: EntityId[], at: readonly [number, number], v: { want: number; short: number; open: boolean; toilet?: EntityId }): void {
  const away = (sid: EntityId) => {
    const p = ctx.port('holdings').where(sid)!;
    return Math.hypot(p[0] - at[0], p[1] - at[1]);
  };
  const store = [...by].sort((x, y) => away(x) - away(y) || (x < y ? -1 : 1))[0];
  if (!store) return nothingBy(ctx, person, at, v);
  // (by a store of ours now: what they were told away from any is said no more, review S1b #3)
  if (!ctx.get('Resident', person)) {
    const others = ownBlockers(ctx, person).filter((b) => b.code !== 'living.dryAway');
    if (others.length !== ownBlockers(ctx, person).length) others.length ? ctx.blockers.set(person, others) : ctx.blockers.clear(person);
  }
  const day = Math.floor(ctx.now / DAY);
  const st = ctx.state('living');
  const was = st.sites?.[store]?.day === day ? st.sites[store]! : { day, want: 0, short: 0, dry: [], open: [] };
  const short = v.short > 1e-6;
  // (and the toilet they had, or a full one: where it is to be emptied)
  const rec = { day, want: was.want + v.want, short: was.short + v.short, dry: short && !was.dry.includes(person) ? [...was.dry, person].sort() : was.dry, open: v.open && !was.open.includes(person) ? [...was.open, person].sort() : was.open, ...((v.toilet ?? was.toilet) ? { toilet: v.toilet ?? was.toilet } : {}) };
  // (said by the hour's look at the sites, once for all who were there: not reckoned again for each of them, review S1b)
  ctx.setState('living', { ...st, sites: { ...st.sites, [store]: { ...rec, ...(was.way ? { way: was.way } : {}), fresh: true } } });
}

/** what is said on a site's store of today there: water gone short (a working week's for those there), no toilet */
function sayAtSite(ctx: WriteCtx, store: EntityId, rec: { want: number; short: number; dry: EntityId[]; open: EntityId[]; toilet?: EntityId; way?: { water: boolean; toilet: boolean; waterHere: boolean; toiletHere: boolean } }): void {
  const set = ctx.data('livingSettings');
  const hold = ctx.port('holdings');
  const label = hold.label(store)!;
  const pos = hold.where(store)!;
  const others = ownBlockers(ctx, store).filter((b) => !SITE_CODES.includes(b.code));
  const said: Blocker[] = [...others];
  const drink = set.away?.bring?.drink;
  const way = onItsWay(ctx, store);
  if (rec.short >= (set.away?.short.value ?? 0.5) && !way.waterHere) {
    const coming = way.water;
    said.push({ code: 'living.siteDry', severity: 'warn', params: { store: label, people: rec.dry.length, short: round(rec.short), way: coming ? '; water is on its way' : '' }, remedies: drink && !coming ? fillRemedies(ctx, store, drink, Math.ceil(rec.want * 5), { pos }) : [] });
  }
  if (rec.open.length && !way.toiletHere) {
    // (the toilet there: a full one is emptied where it stands)
    const at = rec.toilet && hold.exists(rec.toilet) ? rec.toilet : store;
    const t = toiletOf(ctx, at, new Map());
    const per = set.sanitation?.perToilet?.value;
    const coming = !t.full && way.toilet;
    said.push({ code: 'living.siteNoToilet', severity: 'warn', params: { store: label, people: rec.open.length, toilet: t.label, per: coming ? '; a toilet is on its way' : per ? `; a toilet for every ${per}` : '' }, remedies: coming ? [] : [...(t.full ? emptyRemedies(ctx, at, t.full) : []), ...toiletRemedies(ctx, store)] });
  }
  if (said.length) ctx.blockers.set(store, said);
  else ctx.blockers.clear(store);
  const st0 = ctx.state('living');
  if (st0.sites?.[store]) {
    const { fresh: _f, ...kept } = st0.sites[store]!;
    ctx.setState('living', { ...st0, sites: { ...st0.sites, [store]: { ...kept, way } } });
  }
}

/** whether water, or a toilet, is on its way to a site's store (ordered to a store of ours by it, or carried there by work) */
function onItsWay(read: ReadCtx, store: EntityId): { water: boolean; toilet: boolean; waterHere: boolean; toiletHere: boolean } {
  const set = read.data('livingSettings');
  const hold = read.port('holdings');
  const at = hold.where(store)!;
  const drink = set.away?.bring?.drink;
  const standing = hold.ofParty(hold.holder(store)!, { riding: false });
  const near = (r: number) => standing.filter((sid) => hold.near(sid, at, r));
  const carrying = [...read.all('WorkPackage')].filter(([, w]) => w.status !== 'done' && w.status !== 'cancelled').flatMap(([, w]) => w.produces ?? []);
  const coming = (mats: string[], r: number) => near(r).some((sid) => mats.some((m) => read.port('trade').onOrder(sid, m) > 1e-9 || carrying.some((o) => o.store === sid && o.material === m)));
  const toilets = Object.keys(read.data('materials')).filter((m) => hold.material(m).sanitation);
  const reach = set.sanitation?.reach?.value ?? set.selfCare.value;
  // (and what is there now: clean water by it, a toilet within a walk that keeps something back, review S1b #2)
  const waterHere = near(set.selfCare.value).some((sid) => cleanWater(read, sid).some((w) => w.have * w.per > 1e-6));
  const toiletHere = (toiletBy(read, near(reach))?.toilet.contains ?? 0) > 0;
  return { water: drink !== undefined && coming([drink], set.selfCare.value), toilet: coming(toilets, reach), waterHere, toiletHere };
}

/** one who lives beyond the map, away from any store of ours where they worked: told, with a store to set up there */
function nothingBy(ctx: WriteCtx, person: EntityId, at: readonly [number, number], v: { want: number; short: number; open: boolean }): void {
  if (ctx.get('Resident', person)) return;
  const set = ctx.data('livingSettings');
  const party = partyOfPerson(ctx, person);
  const others = ownBlockers(ctx, person).filter((b) => b.code !== 'living.dryAway');
  const where = ctx.get('Body', person)?.today?.where ?? [];
  if (!party || v.short < (set.away?.short.value ?? 0.5)) {
    if (others.length !== ownBlockers(ctx, person).length) others.length ? ctx.blockers.set(person, others) : ctx.blockers.clear(person);
    return;
  }
  const name = ctx.port('workforce').name(person);
  const remedies: Remedy[] = [{ label: `Set up a store where ${name} works, for water and a toilet to be brought there`, command: { type: 'inventory.createStore', payload: { holder: party, label: 'Site store', kind: 'stockpile', pos: [Math.round(at[0]), Math.round(at[1])] } } }];
  ctx.blockers.set(person, [...others, { code: 'living.dryAway', severity: 'warn', params: { person: name, short: round(ctx.get('Body', person)?.today?.short ?? v.short), where: where.join('; ') || 'away from home' }, remedies }]);
}

/** today's sites said again: what was ordered or is carried to them since (S1b) */
function sitesNow(ctx: WriteCtx): void {
  const sites = ctx.state('living').sites;
  if (!sites) return;
  for (const [store, rec] of Object.entries(sites)) {
    if (!ctx.port('holdings').exists(store as EntityId) || !(rec.fresh || rec.short > 0 || rec.open.length)) continue;
    // (said again only when what is on its way has changed: the remedies are not reckoned anew each hour)
    const way = onItsWay(ctx, store as EntityId);
    if (rec.fresh || way.water !== rec.way?.water || way.toilet !== rec.way?.toilet || way.waterHere !== rec.way?.waterHere || way.toiletHere !== rec.way?.toiletHere) sayAtSite(ctx, store as EntityId, rec);
  }
}

/** the evening: what was said on a site's store of a day past is said no more (nobody worked there today) */
function sitesPast(ctx: WriteCtx): void {
  const st = ctx.state('living');
  if (!st.sites) return;
  const day = Math.floor(ctx.now / DAY);
  const keep: NonNullable<typeof st.sites> = {};
  for (const [store, rec] of Object.entries(st.sites)) {
    if (rec.day >= day) {
      keep[store] = rec;
      continue;
    }
    if (!ctx.port('holdings').exists(store as EntityId)) continue;
    const others = ownBlockers(ctx, store as EntityId).filter((b) => !SITE_CODES.includes(b.code));
    others.length ? ctx.blockers.set(store as EntityId, others) : ctx.blockers.clear(store as EntityId);
  }
  ctx.setState('living', { ...st, sites: keep });
}

/** food that is eaten as it is (not only cooked): what goes into a lunch */
const readyFood = (read: ReadCtx, store: EntityId) => provisions(read, store).food.filter((f) => !read.port('holdings').material(f.material).cook);

/** eaten from a holding away from home (kcal): what the body makes of it leaves it to the air (the rest later, at home) */
function eatAway(ctx: WriteCtx, store: EntityId, want: number, why: string): number {
  let got = 0;
  for (const f of readyFood(ctx, store)) {
    if (got >= want - 1e-6) break;
    const qty = Math.min(f.have, (want - got) / f.per);
    if (qty <= 1e-9) continue;
    const r = ctx.command('inventory.release', { from: store, material: f.material, qty, to: 'air', why, usedUp: true });
    if (r.ok) got += qty * f.per;
  }
  return got;
}

/** the midday meal's share of the day's food for someone (kcal), by the work they do today */
function lunchOf(read: ReadCtx, person: EntityId, workHours: number): number {
  const set = read.data('livingSettings').away;
  if (!set) return 0;
  const tMax = read.port('weather').soFar(read.now).tMax;
  return read.port('needs').requirement(person, { workHours, tMax }).energy.v * set.lunch.share.value;
}

/** a lunch taken along (the routine of one going out for the day): food eaten as it is, from home into what they carry */
function packLunch(ctx: WriteCtx, person: EntityId, r: Readonly<Life>, workHours: number): void {
  const want = lunchOf(ctx, person, workHours);
  if (!(want > 0)) return;
  const party = r.party;
  let pack = packOf(ctx, person);
  const carried = pack ? readyFood(ctx, pack).reduce((a, f) => a + f.per * f.have, 0) : 0;
  if (carried >= want - 1e-6) return;
  const home = readyFood(ctx, r.store);
  if (!home.length) return;
  if (!pack) {
    const made = ctx.command('inventory.createStore', { holder: party, label: `${ctx.port('workforce').name(person)}: what they carry`, kind: 'carried', pos: ctx.port('moves').where(person) ?? ctx.port('holdings').where(r.store)!, on: person });
    if (!made.ok) return;
    pack = made.value as EntityId;
  }
  const hold = ctx.port('holdings');
  let need = want - carried;
  for (const f of home) {
    if (need <= 1e-6) break;
    const qty = Math.min(f.have, need / f.per, loadRoom(ctx, pack) / unitMass(hold.material(f.material)));
    if (qty <= 1e-9) continue;
    const t = ctx.command('inventory.transfer', { from: r.store, to: pack, material: f.material, qty, ...(hold.together(r.store, pack) ? {} : { via: 'carried in cans' }), why: `${ctx.port('workforce').name(person)}: a lunch taken along` });
    if (t.ok) need -= qty * f.per;
  }
}

/**
 * The time away from home on the map, settled when they come back (or at the evening): the water the hours asked, of
 * the day's, drunk where they were (clean water of ours by them, then what they carry); what was not there they went
 * short of (design/physical-state.md 8b: a body drinks where it is, not from the household's books)
 */
function settleAway(ctx: WriteCtx, person: EntityId, until: number, stays: boolean): void {
  const r = ctx.get('Body', person);
  const a = r?.away;
  const party = partyOfPerson(ctx, person);
  if (!r || !a || !party) return;
  // (home: the store they live from; one who lives beyond the map is far from home all the while they are on it)
  const resident = ctx.get('Resident', person);
  const homeAt = resident ? ctx.port('holdings').where(resident.store) : undefined;
  const hours = Math.max(0, (until - a.since) / HOUR);
  if (hours > 1 / 60) {
    const set = ctx.data('livingSettings');
    const tMax = ctx.port('weather').soFar(ctx.now).tMax;
    const needs = ctx.port('needs');
    const rest = needs.requirement(person, { workHours: 0, tMax });
    const awake = Math.max(1, 24 - rest.sleep.v);
    // (working there: the sweat of those hours too)
    const working = ctx.get('Assignment', person) !== undefined;
    const want = (rest.water.v * Math.min(hours, awake)) / awake + (working ? needs.requirement(person, { workHours: hours, tMax }).water.v - rest.water.v : 0);
    const name = ctx.port('workforce').name(person);
    let got = 0;
    const hold = ctx.port('holdings');
    const kept = hold.ofParty(party, { kept: true });
    const by = kept.filter((sid) => hold.near(sid, a.at, set.selfCare.value));
    // (a toilet of ours within a walk of them that collects: what they pass there goes into it, else onto the ground, S1b)
    const reach = set.sanitation?.reach?.value ?? set.selfCare.value;
    const site = toiletBy(ctx, reach <= set.selfCare.value ? by : kept.filter((sid) => hold.near(sid, a.at, reach)));
    const into = site?.toilet.collects ? { store: site.store, material: site.toilet.collects.material, room: tankRoom(ctx, site.store, site.toilet.collects.material) } : undefined;
    for (const sid of by) got += drinkAway(ctx, person, sid, want - got, `${name}: a drink while away`, into);
    const pack = packOf(ctx, person);
    if (pack) got += drinkAway(ctx, person, pack, want - got, `${name}: a drink from what they carry`, into);
    const t = r.today ?? { drank: 0, short: 0, where: [] };
    const short = Math.max(0, want - got);
    // the midday meal, when they were away over it: at home when it is within a walk (one goes home to eat), else
    // what is by them, then what they carry (r: 8b)
    const lunch = set.away ? ctx.calendar.startOfDay(a.since) + set.away.lunch.at.value * HOUR : Infinity;
    const far = !homeAt || Math.hypot(a.at[0] - homeAt[0], a.at[1] - homeAt[1]) > set.fetchWalk.value;
    let ate = 0;
    let missed = 0;
    if (far && lunch >= a.since && lunch < until) {
      // (the lunch they took along first, then what is by them; one who lives beyond the map packed it for a working day:
      // the same lunch is eaten, review S1 #8)
      const meal = resident ? lunchOf(ctx, person, working ? hours : 0) : workLunch(ctx, person);
      if (pack) ate += eatAway(ctx, pack, meal, `${name}: the lunch they took along`);
      for (const sid of by) ate += eatAway(ctx, sid, meal - ate, `${name}: lunch`);
      missed = Math.max(0, meal - ate);
    }
    // away from home where they work: excreta left about (no toilet there) make one ill as about a camp, for the hours
    // spent there (S1b); the toilet's share kept from flies and hands
    const contains = site?.toilet.contains ?? 0;
    const open = far && set.sanitation && contains < 1 && Math.min(hours, awake) >= 1;
    const whereNow = [...t.where, ...(short > 1e-6 ? [`${Math.round(hours * 10) / 10} h away with ${got > 1e-6 ? `only ${round(got)} l` : 'nothing'} to drink`] : []), ...(missed > 1e-6 ? [`no lunch ${ate > 1e-6 ? 'enough ' : ''}where they were`] : []), ...(open && contains <= 0 ? ['no toilet where they were'] : [])];
    ctx.set('Body', person, { ...ctx.get('Body', person)!, today: { drank: t.drank + got, short: t.short + short, where: [...new Set(whereNow)], ate: (t.ate ?? 0) + ate, missed: (t.missed ?? 0) + missed } });
    if (open && ctx.get('Presence', person)?.status !== 'sick') {
      const dose = set.sanitation!.open.value * (Math.min(hours, awake) / 24) * (1 - contains) * handsOf(ctx, r);
      if (dose > 0 && ctx.rng('sanitation-away').chance(1 - Math.exp(-dose))) fallIllAway(ctx, person, contains > 0 ? `the toilet where they work (${site!.toilet.label.replace(/\s*\(.*\)/, '').toLowerCase()}) does not keep it all from flies and hands` : 'excreta left about where they work (no toilet there)');
    }
    // said on the store they were by (a site's): who went short there today, and who had no toilet (S1b)
    if (far) siteDay(ctx, person, by, a.at, { want, short, open: Boolean(open && contains <= 0), ...(site ? { toilet: site.store } : {}) });
  }
  // still there (the evening came first): reckoned on from now; back: no longer away
  const { away: _a, ...now } = ctx.get('Body', person)!;
  ctx.set('Body', person, stays ? { ...now, away: { since: until, at: a.at } } : now);
}

/**
 * One who lives beyond the map and is on it (an employee, a helper who comes for the day; design/realism-plan.md S1):
 * their hours here are drunk and eaten where they were (settleAway); what they went short of today shows in how they
 * work (thirst and hunger of the day, as a resident's), and is made up at home, beyond the map, before they come again
 */
function settleVisit(ctx: WriteCtx, person: EntityId, until: number, stays: boolean): void {
  if (ctx.get('Person', person)?.died) return leaveOnMap(ctx, person);
  if (ctx.get('Resident', person)) return settleAway(ctx, person, until, stays);
  settleAway(ctx, person, until, stays);
  const b = ctx.get('Body', person);
  if (!b) return;
  ctx.set('Body', person, { ...b, thirst: b.today?.short ?? 0, hunger: b.today?.missed ?? 0 });
}

/**
 * One who lives beyond the map has come somewhere by a move (design/realism-plan.md S1). Home, beyond the map: their
 * hours on it are settled to when they set out, and they pack for the next day. On the map: in from home (what the
 * last day lacked made up there), or on from elsewhere on it (those hours settled); from now they drink and eat here.
 */
function visitArrived(ctx: WriteCtx, person: EntityId, move: EntityId): void {
  const b = ctx.get('Body', person);
  const party = partyOfPerson(ctx, person);
  // (the dead drink and eat nothing: review S1 #1)
  if (!b || !party || ctx.get('Person', person)?.died) return leaveOnMap(ctx, person);
  const at = ctx.port('moves').where(person);
  const m = ctx.get('Move', move);
  if (!at) {
    const departed = m?.legs[0]?.depart ?? ctx.now;
    if (b.away) settleVisit(ctx, person, Math.max(b.away.since, departed), false);
    leaveOnMap(ctx, person);
    // (home: the wrappers of the lunch go into their own bin there; packed for the next day)
    takeHomeWaste(ctx, person);
    packFromHome(ctx, person, party);
    return;
  }
  // in from beyond the map (the move began there): a new day, what the last one lacked made up at home; on from
  // somewhere on the map: those hours settled, nothing made up (review S1 #2); a step of a minute or less is carried on
  // with the stint it belongs to (#10)
  const fromBeyond = m?.legs[0]?.fromNode !== undefined;
  if (b.away && ctx.now - b.away.since < 60) {
    ctx.set('Body', person, { ...b, away: { since: b.away.since, at: [at[0], at[1]] } });
    return;
  }
  if (b.away) settleVisit(ctx, person, ctx.now, false);
  if (fromBeyond && !b.away) {
    const { today: _t, ...rest } = ctx.get('Body', person)!;
    ctx.set('Body', person, { ...rest, thirst: 0, hunger: 0 });
  }
  ctx.set('Body', person, { ...ctx.get('Body', person)!, away: { since: ctx.now, at: [at[0], at[1]] } });
  const onMap = ctx.state('living').onMap;
  if (!onMap.includes(person)) ctx.setState('living', { ...ctx.state('living'), onMap: [...onMap, person].sort() });
}

/** no longer one of those on the map living beyond it (home, dead, come to live here: review S1 #9) */
function leaveOnMap(ctx: WriteCtx, person: EntityId): void {
  const onMap = ctx.state('living').onMap;
  if (onMap.includes(person)) ctx.setState('living', { ...ctx.state('living'), onMap: onMap.filter((x) => x !== person) });
}

/** the packaging one carried home goes with them into their own bin there, beyond the map (review S1 #7) */
function takeHomeWaste(ctx: WriteCtx, person: EntityId): void {
  const waste = ctx.data('livingSettings').waste?.material;
  const pack = packOf(ctx, person);
  if (!waste || !pack) return;
  const q = ctx.port('holdings').stock(pack, waste);
  if (q > 1e-9) ctx.command('inventory.toOutside', { from: pack, material: waste, qty: q, why: `${ctx.port('workforce').name(person)}: the wrappers taken home` });
}

/** goods of their own from home into what they carry, over the edge of the map with them: theirs, not the household's */
function bringIn(ctx: WriteCtx, person: EntityId, pack: EntityId, material: string, qty: number, why: string): void {
  if (!(qty > 1e-9) || !ctx.command('inventory.fromOutside', { into: pack, material, qty, why }).ok) return;
  const b = ctx.get('Body', person);
  if (b) ctx.set('Body', person, { ...b, own: { ...b.own, [material]: (b.own?.[material] ?? 0) + qty } });
}

/** what of a material in what someone carries is the household's to take: what is not their own (review S1 #3) */
function notOwn(read: ReadCtx, person: EntityId, pack: EntityId, material: string): number {
  const have = read.port('holdings').stock(pack, material);
  return Math.max(0, have - Math.min(have, read.get('Body', person)?.own?.[material] ?? 0));
}

/**
 * What one on the map has gone short of to drink in the hours of their stint not yet settled (l): what those hours asked
 * against the clean water by them and in what they carry (a reading, nothing is drunk; settleAway drinks it)
 */
function openShort(read: ReadCtx, person: EntityId): number {
  const b = read.get('Body', person);
  const a = b?.away;
  const party = partyOfPerson(read, person);
  if (!b || !a || !party) return 0;
  const hours = Math.max(0, (read.now - a.since) / HOUR);
  if (hours <= 0) return 0;
  const set = read.data('livingSettings');
  const tMax = read.port('weather').soFar(read.now).tMax;
  const needs = read.port('needs');
  const rest = needs.requirement(person, { workHours: 0, tMax });
  const awake = Math.max(1, 24 - rest.sleep.v);
  const working = read.get('Assignment', person) !== undefined;
  const want = (rest.water.v * Math.min(hours, awake)) / awake + (working ? needs.requirement(person, { workHours: hours, tMax }).water.v - rest.water.v : 0);
  // (the clean water by them and in what they carry, read straight from the holdings' contents: this is asked often)
  const hold = read.port('holdings');
  const clean = (contents: Readonly<Record<string, number>>) => {
    let l = 0;
    for (const [m, q] of Object.entries(contents)) {
      if (q <= 1e-9) continue;
      const mat = hold.material(m);
      if (mat.water && !((mat.pathogens?.value ?? 0) > 0)) l += q * mat.water.value;
    }
    return l;
  };
  let have = 0;
  for (const sid of hold.atHand(person, party, a.at, set.selfCare.value)) {
    have += clean(hold.contents(sid));
    if (have >= want) return 0;
  }
  return Math.max(0, want - have);
}

/** the lunch of a working day (kcal), as it is packed and as it is eaten: one rule for both (review S1 #8) */
function workLunch(read: ReadCtx, person: EntityId): number {
  const away = read.data('livingSettings').away;
  return away ? read.port('needs').requirement(person, { workHours: 8, tMax: 20 }).energy.v * away.lunch.share.value : 0;
}

/**
 * What one who lives beyond the map packs at home for a day on it: a filled bottle and a lunch box (design/
 * realism-plan.md S1). It is packed there, beyond the map (or as the world is made), into what they carry, and comes
 * in with them; nothing is put into their hands on the map.
 */
function packFromHome(ctx: WriteCtx, person: EntityId, party: EntityId): void {
  const bring = ctx.data('livingSettings').away?.bring;
  // (one who lives here, or comes to live here, packs from their store: packLunch, the bottles refilled at home)
  if (!bring || ctx.get('Resident', person) || ctx.get('Helper', person)?.resident || ctx.get('Person', person)?.died) return;
  const at = ctx.port('moves').where(person);
  if (at && !(ctx.setup || ctx.trusted)) return;
  const hold = ctx.port('holdings');
  const pack = packFor(ctx, person, party);
  if (!pack) return;
  const why = `${ctx.port('workforce').name(person)}: packed at home for the day`;
  const vessel = hold.material(bring.vessel).vessel?.litres.value ?? 1;
  const bottles = Math.ceil(bring.water.value / vessel - 1e-9);
  const have = hold.stock(pack, bring.vessel);
  if (bottles > have) bringIn(ctx, person, pack, bring.vessel, bottles - have, why);
  const water = cleanWater(ctx, pack).reduce((a, w) => a + w.per * w.have, 0);
  if (water < bring.water.value - 1e-6) bringIn(ctx, person, pack, bring.drink, (bring.water.value - water) / (hold.material(bring.drink).water?.value ?? 1), why);
  const food = hold.material(bring.food);
  // (a working day's lunch: its energy does not depend on the day's heat, which is not known before the day)
  const meal = workLunch(ctx, person);
  const carried = readyFood(ctx, pack).reduce((a, f) => a + f.per * f.have, 0);
  if (food.energy && meal > carried + 1e-6) bringIn(ctx, person, pack, bring.food, (meal - carried) / food.energy.value, why);
}

function settleDay(ctx: WriteCtx, person: EntityId, rooms: Map<EntityId, Room>, deaths: Death[], holes: Map<EntityId, string>): void {
  const r = requireLife(ctx, person);
  const day = Math.floor(ctx.now / DAY);
  if (r.lastDay === day) return;
  const set = ctx.data('livingSettings');
  const name = ctx.port('workforce').name(person);
  const { hours, span, commute, by, bus } = workHoursToday(ctx, person, r.party);
  // the vehicle they rode to work: its hours, its fuel (and the law, for one who drives without the licence)
  if (by) ctx.command('equipment.commuted', { machine: by.machine, person });
  const tMax = ctx.port('weather').soFar(ctx.now).tMax;
  const need = ctx.port('needs').requirement(person, { workHours: hours, tMax });
  // what was drunk away from home today (design/physical-state.md 8b): still away, the hours so far where they are
  if (r.away) settleAway(ctx, person, ctx.now, true);
  const today = requireLife(ctx, person).today ?? { drank: 0, short: 0, where: [] };
  let drankAway = today.drank;
  let shortAway = today.short;
  let ateAway = today.ate ?? 0;
  let missedAway = today.missed ?? 0;
  const where = [...today.where];
  // a job beyond the map: the workplace gives the working day's water (its tap, as the region's law asks), the way there
  // and back is drunk from what they carry
  const employer = employerAt(ctx, person, ctx.now);
  if (employer && townOf(ctx, r.party, employer) && hours > 0) {
    const rest = ctx.port('needs').requirement(person, { workHours: 0, tMax });
    const awake = Math.max(1, 24 - rest.sleep.v);
    const atWork = (rest.water.v * Math.min(Math.max(0, span - commute), awake)) / awake + (need.water.v - rest.water.v);
    const share = set.away?.workplace.value ?? 0;
    drankAway += atWork * share;
    shortAway += atWork * (1 - share);
    const way = (rest.water.v * Math.min(commute, awake)) / awake;
    const pack = packOf(ctx, person);
    // lunch at work: what they took along, else bought there (a canteen, a bakery), as the household can pay
    if (set.away) {
      const meal = lunchOf(ctx, person, hours);
      let got = pack ? eatAway(ctx, pack, meal, `${name}: the lunch they took along`) : 0;
      const price = set.away.lunch.canteen.value;
      if (got < meal - 1e-6 && price > 0 && ctx.port('prices').liquidity(r.party) >= price) {
        ctx.ledger.post({ from: acct(r.party, ACCOUNTS.cash), to: acct(r.party, ACCOUNTS.food), amount: price, memo: `${name}: lunch bought at work`, category: ACCOUNTS.food, refs: [person] });
        got = meal;
      }
      ateAway += got;
      if (meal - got > 1e-6) {
        missedAway += meal - got;
        where.push('no lunch at work (none taken along, nothing to buy it with)');
      }
    }
    const fromPack = pack ? drinkAway(ctx, person, pack, way, `${name}: a drink on the way to work`) : 0;
    drankAway += fromPack;
    if (way - fromPack > 1e-6) {
      shortAway += way - fromPack;
      where.push(`${round(commute)} h on the way to work and back with ${fromPack > 1e-6 ? `only ${round(fromPack)} l` : 'nothing'} to drink`);
    }
  }
  // short at home: what is within a few steps (the rain barrel by the tent) is fetched in first, as one does oneself
  const home0 = provisions(ctx, r.store);
  // clean water first, from as far as one walks for it, even with water as it comes at home (the user, 2026-10-12);
  // only then what is within a few steps, and the creek
  const invW = ctx.port('holdings');
  const cleanHome = home0.water.filter((w) => !((invW.material(w.material).pathogens?.value ?? 0) > 0)).reduce((a, w) => a + w.per * w.have, 0);
  fetchAround(ctx, r, 'water', need.water.v - drankAway - cleanHome, name, 'clean');
  fetchAround(ctx, r, 'water', need.water.v - drankAway - provisions(ctx, r.store).litres, name);
  fetchAround(ctx, r, 'food', need.energy.v + Math.min(r.hunger, need.energy.v * 0.5) - ateAway - home0.kcal, name);
  const have0 = provisions(ctx, r.store);
  // eat what the day asked, and some of what is owed; drink what the day asked
  // (what is eaten cooked, as far as there is something to cook on, its fuel and water to cook it in)
  const inv0 = ctx.port('holdings');
  const uncooked: { material: string; why: string; lacks: 'cooker' | 'fuel' | 'water' }[] = [];
  // (what needs cooking is eaten as far as it can be cooked: first while there is fuel and water to cook
  // for two days of it, else after the food eaten as it is, to keep the fuel and water for when that is gone)
  const ample = (f: { material: string; per: number; have: number }) => !inv0.material(f.material).cook || f.have * f.per >= need.energy.v * 2;
  const caps = cookable(ctx, r.store, have0.food, have0.litres);
  const food = have0.food
    .map((f) => {
      const c = caps[f.material]!;
      if (c.why && c.lacks && c.qty < f.have - 1e-9) uncooked.push({ material: f.material, why: c.why, lacks: c.lacks });
      return { ...f, have: Math.min(f.have, c.qty) };
    })
    .sort((a, b) => Number(!ample(a)) - Number(!ample(b)));
  const eaten: Record<string, number> = {};
  // (what was eaten away today is eaten; the rest at home: missed at midday, made up as far as the evening goes)
  const ate = ateAway + take(ctx, r.store, food, Math.max(0, need.energy.v + Math.min(r.hunger, need.energy.v * 0.5) - ateAway), `${name}: meals`, eaten, 'body');
  // cooked: the cooker's fuel burnt, the water boiled (the least clean first: boiling makes it safe)
  for (const [mat, qty] of Object.entries(eaten)) {
    const c = inv0.material(mat).cook;
    const cooker = c ? cookerOf(ctx, r.store) : null;
    if (!c || !cooker) continue;
    const fuel = Math.min(cooker.fuelHave, (qty * c.heat.value) / cooker.perFuel);
    // (burnt: to the air; electricity drawn from the batteries by it that carry its draw)
    const draw = inv0.material(cooker.material).heat?.draw?.value;
    if (fuel > 1e-9) ctx.command('inventory.draw', { at: r.store, material: cooker.fuel, qty: Math.min(fuel, inv0.supply(r.store, cooker.fuel, draw)), to: 'air', why: `${name}: cooking on the ${cooker.label.toLowerCase()}`, usedUp: true, ...(draw !== undefined ? { draw } : {}) });
    // (the water the food takes up is eaten with it; what boils off is steam: both leave by the body or the air)
    take(ctx, r.store, [...provisions(ctx, r.store).water].reverse(), qty * c.water.value, `${name}: cooking water`, undefined, 'air');
  }
  const have = provisions(ctx, r.store);
  const drunk: Record<string, number> = {};
  // (at home, what the day asked that was not drunk away: some of it made up now)
  const drankHome = take(ctx, r.store, have.water, Math.max(0, need.water.v - drankAway), `${name}: drinking water`, drunk, 'body');
  const drank = drankHome + drankAway;
  // untreated water can make one ill: the day's dose, less what the store's best treatment removes, drawn now
  // unwashed hands of the days before carry what one drinks to the mouth (washing comes after everyone has drunk)
  // (one bout at a time: someone ill already does not fall ill again)
  const ill = ctx.get('Presence', person)?.status === 'sick';
  const hands = handsOf(ctx, r);
  const sick = ill ? { dose: 0, ill: false } : waterIllness(ctx, r.store, drunk, hands);
  // and what is left about the camp: the day's visits to the toilet (its cover used), or none
  const toilet = toiletOf(ctx, r.store, holes);
  // what was eaten and drunk leaves the body: faeces by the food eaten, urine by the water drunk, the rest breathed and
  // sweated out to the air; into a toilet that collects (with its cover), else into the ground about the camp. The
  // packaging stays in the store. One transform, balanced in mass (design/physical-state.md I1)
  const ex = ctx.data('livingSettings').sanitation?.excreta;
  const inv1 = ctx.port('holdings');
  const intake = [...Object.entries(eaten), ...Object.entries(drunk)].reduce((acc, [m, q]) => acc.set(m, (acc.get(m) ?? 0) + q), new Map<string, number>());
  const excreta = ex ? ex.faeces.value * Math.min(1, ate / Math.max(1, need.energy.v)) + ex.urine.value * Math.min(1, drankHome / Math.max(0.1, need.water.v)) : 0;
  const intakeKg = [...intake].reduce((a, [m, q]) => a + q * unitMass(inv1.material(m)), 0);
  const passed = Math.min(excreta, intakeKg);
  const give: { material: string; qty: number }[] = [];
  for (const [m, q] of intake) {
    const leaves = inv1.material(m).leaves;
    if (leaves) give.push({ material: leaves.material, qty: q * leaves.per });
  }
  // (into a toilet that collects as far as its tank has room: what overflows it goes on the ground, as without one;
  // S508: a 250 l tank held 251 kg)
  const leftKg = passed + (toilet.cover ? toilet.cover.qty * unitMass(inv1.material(toilet.cover.material)) : 0);
  const tankKg = toilet.collects && ex ? Math.min(passed + toilet.collects.qty, tankRoom(ctx, r.store, toilet.collects.material) * unitMass(inv1.material(toilet.collects.material))) : 0;
  if (toilet.collects && ex && tankKg > 1e-9) give.push({ material: toilet.collects.material, qty: tankKg / unitMass(inv1.material(toilet.collects.material)) });
  const takeAll = [...intake].map(([material, qty]) => ({ material, qty }));
  if (toilet.cover) takeAll.push({ material: toilet.cover.material, qty: toilet.cover.qty });
  if (takeAll.length) {
    const t = ctx.command('inventory.transform', { at: r.store, take: takeAll, give, sink: 'air', ground: toilet.collects ? Math.max(0, leftKg - tankKg) : leftKg, why: `${name}: the day's meals and drink` });
    if (!t.ok) throw new Error(`${name}: the day's meals: ${JSON.stringify(t.reasons)}`);
  }
  const fouled = !ill && sanitationIllness(ctx, toilet.contains, hands);
  const hunger = Math.max(0, r.hunger + need.energy.v - ate);
  const thirst = Math.max(0, need.water.v - drank);
  // the night is not settled now (it has not happened, design/physical-state.md I7): it is slept hour by hour
  // from bedtime (sleepHour), each hour by its own air, the shelter and a heater that burns that hour, and
  // reckoned at the end of it (dawn). The evening settles the day: what was eaten and drunk.
  const nightly = night(ctx, person, r, span);
  const met = hunger < set.hunger.deficit.value * 0.1 && thirst <= 1e-6;
  const starved = set.hunger.harms.value * Math.min(1, hunger / set.hunger.deficit.value);
  const parched = set.thirst.harms.value * Math.min(1, thirst / Math.max(0.1, need.water.v));
  const health = Math.max(0, Math.min(1, r.health - starved - parched));
  const unmetDays = met ? 0 : r.unmetDays + 1;
  const dryDays = drank < need.water.v * 0.5 ? (r.dryDays ?? 0) + 1 : 0;
  // (what the day leaves for the night to come: the sleep it asked, whether the body was fed and watered, its other harms)
  const shelter = shelterOf(ctx, person, rooms, false);
  // (the day away reckoned: begun afresh; still away, from now on)
  const { today: _today, away: _away, ...r1 } = r;
  const still = requireLife(ctx, person).away;
  setLife(ctx, person, { ...r1, ...(still ? { away: still } : {}), day: { need: need.sleep.v, met, others: starved + parched, span }, hunger, thirst, health, unmetDays, dryDays, worked: hours, lastDay: day });
  // (the bottles they carry are filled at home for tomorrow when everyone has drunk: the evening)
  // a body gives out (the user's decision: people die of thirst and of hunger, after the days the physiology gives)
  const fatal = set.fatal;
  if (fatal && (dryDays >= fatal.dryDays.value || hunger >= fatal.starvation.value)) {
    const cause = dryDays >= fatal.dryDays.value ? `of thirst, after ${dryDays} days with too little to drink` : `of hunger, after going without some ${Math.round(hunger / 1000)},000 kcal of food`;
    deaths.push({ person, party: r.party, store: r.store, cause });
    return;
  }
  // no night to come in the book yet (moved in, or their hours changed while none was due): the next bedtime
  const now0 = requireLife(ctx, person);
  if (!now0.night && (now0.bedAt === undefined || now0.bedAt < ctx.now)) scheduleBed(ctx, person, nextBed(ctx, now0, ctx.now));
  // made ill by what they drank: days of sickness (only where the practice says how it goes: nothing made up)
  const illness = ctx.data('livingSettings').waterIllness;
  if ((sick.ill || fouled) && illness) {
    const now = requireLife(ctx, person);
    // (illness has degrees: most bouts pass in days, a share are serious)
    const serious = illness.serious && ctx.rng('illness').chance(illness.serious.share.value) ? illness.serious : undefined;
    const short = (label: string) => label.replace(/\s*\(.*\)/, '').toLowerCase();
    const inv0 = ctx.port('holdings');
    // what it is and how bad, what brought it, and what keeps it away (S504: an illness said with no cause or degree,
    // the hands' part in it unseen)
    const [why, ways]: [string, IllWay[]] = sick.ill ? (sick.treated ? [` from filtered water: the ${short(sick.treated)} does not take it all`, ['treat']] : [' from untreated water', ['treat']]) : toilet.uncovered ? [`: the toilet has nothing to cover each visit (${inv0.material(toilet.uncovered).label.toLowerCase()})`, ['cover']] : toilet.contains > 0 ? [`: the toilet (${short(toilet.label)}) does not keep it all from flies and hands`, ['toilet']] : [': excreta left about the camp (no toilet)', ['toilet']];
    const hands = handsSaid(now);
    const reason = illnessSaid(illness, serious, why, hands);
    const until = ctx.calendar.startOfDay(ctx.now) + (serious ?? illness).days.value * DAY + EVENING_H * HOUR;
    setLife(ctx, person, { ...now, health: Math.max(0, now.health - (serious ?? illness).harm.value), ill: { reason, until, ways: [...ways, ...(hands ? [hands.way] : [])] } });
    ctx.command('workforce.fallIll', { person, until, reason });
  }
  // legible: what they lack, and how to get it
  const blockers: { code: string; severity: 'warn' | 'block'; params: Record<string, string | number>; remedies?: Remedy[] }[] = [];
  // (the days without enough to drink, and how many a body lasts: they know they are parched)
  const lasts = set.fatal?.dryDays.value;
  if (thirst > 1e-6) blockers.push({ code: 'living.thirsty', severity: 'block', params: { person: name, short: round(thirst), need: round(need.water.v), dry: dryDays > 0 && lasts ? `; ${dryDays} of the ${lasts} days a body lasts with less than half of it` : '' }, remedies: supplyRemedies(ctx, r.store, 'water') });
  // gone short of water while away (no water where they were, nothing carried): said, with a bottle to carry
  if (set.away && shortAway >= set.away.short.value) blockers.push({ code: 'living.dryAway', severity: 'warn', params: { person: name, short: round(shortAway), where: where.join('; ') || 'away from home' }, remedies: carryRemedies(ctx, person, r.store) });
  // no lunch away from home: said, with a lunch to take along
  if (missedAway > 100) {
    const inv2 = ctx.port('holdings');
    const f = readyFood(ctx, r.store)[0];
    const meal = lunchOf(ctx, person, hours);
    blockers.push({ code: 'living.noLunch', severity: 'warn', params: { person: name, kcal: Math.round(missedAway), where: where.filter((w) => /lunch/.test(w)).join('; ') || 'away from home' }, remedies: f ? [{ label: `${name} takes a lunch along (${round(meal / f.per, 2)} ${inv2.material(f.material).unit} ${inv2.material(f.material).label.toLowerCase()})`, command: { type: 'living.pack', payload: { person, material: f.material, qty: round(meal / f.per, 2) } } }] : supplyRemedies(ctx, r.store, 'food') });
  }
  if (hunger > set.hunger.deficit.value * 0.1) blockers.push({ code: 'living.hungry', severity: hunger > set.hunger.deficit.value * 0.5 ? 'block' : 'warn', params: { person: name, short: Math.round(hunger) }, remedies: supplyRemedies(ctx, r.store, 'food') });
  // the sleep owed as the last night left it
  const sleepDebt = r.sleepDebt;
  if (sleepDebt > set.tiredness.debt.value * 0.25) {
    // why this person sleeps worse than another: their place, its ground, the night, and the hours work leaves them
    const why = [...shelter.why, ...(nightly.lost > 0 ? [`in bed ${hhmm(nightly.bed)}–${hhmm(nightly.rise)}, work takes ${round(nightly.lost)} h of it`] : []), ...(commute > 0 ? [`the ${by ? `ride (${by.label.replace(/\s*\(.*\)/, '').toLowerCase()})` : bus ? 'way by bus' : 'walk'} to work and back takes ${round(commute)} h of the day`] : [])];
    blockers.push({ code: 'living.tired', severity: 'warn', params: { person: name, owed: round(sleepDebt), where: `${shelter.label}: ${r.slept !== undefined ? `${round(r.slept)} h of sleep last night` : 'no night here yet'}, ${round(need.sleep.v)} h needed${why.length ? `; ${why.join('; ')}` : ''}` }, remedies: shelter.cold ? warmerRemedies(ctx, person, r.store, shelter.cold.warming) : [] });
  }
  // a night ahead colder than the bedding keeps one warm in, beyond what the body bears without harm (as the evening's
  // forecast tells it): a danger, said before it is too late, with what would warm them (r41)
  if (set.exposure && shelter.chill > set.exposure.margin.value) blockers.push({ code: 'living.cold', severity: 'block', params: { person: name, chill: Math.round(shelter.chill), bedding: shelter.bedding }, remedies: warmerRemedies(ctx, person, r.store, shelter.cold?.warming ?? 0) });
  // ill of what the camp's water, toilet or hands brought: said while it lasts, with what keeps it away (S504)
  const bout = requireLife(ctx, person).ill;
  if (bout && bout.until > ctx.now && ctx.get('Presence', person)?.status === 'sick') blockers.push({ code: 'living.ill', severity: 'warn', params: { person: name, reason: bout.reason, until: ctx.calendar.format(bout.until, 'day') }, remedies: illRemedies(ctx, r.store, bout.ways, toilet) });
  else if (bout) {
    const { ill: _i, ...rest } = requireLife(ctx, person);
    setLife(ctx, person, rest);
  }
  // drinking water as it comes with nothing to treat it: said, with the ways to treat it
  const hold = ctx.port('holdings');
  const raw = Object.entries(ctx.port('holdings').contents(r.store)).filter(([m, q]) => q > 1e-9 && (hold.material(m).pathogens?.value ?? 0) > 0 && hold.material(m).water);
  const treat = raw.length ? treatRemedies(ctx, r.store) : [];
  if (treat.length) blockers.push({ code: 'living.untreatedWater', severity: 'warn', params: { person: name, water: raw.map(([m, q]) => `${round(q)} ${hold.material(m).unit} ${hold.material(m).label}`).join(', ') }, remedies: treat });
  // no toilet (or one with nothing to cover it): said, with the ways to one; others notice it the first day
  const san = ctx.data('livingSettings').sanitation;
  if (san && (toilet.contains <= 0 || toilet.uncovered)) {
    const remedies = [...(toilet.full ? emptyRemedies(ctx, r.store, toilet.full) : []), ...toiletRemedies(ctx, r.store, toilet.uncovered)];
    if (!ctx.blockersOf(person).some((b) => b.code === 'living.noToilet') && toilet.contains <= 0) ctx.emit('living.noticed', { person, party: r.party, what: 'noToilet', level: 'noticeable' });
    // (told while it lasts: a matter begun later hears it too)
    if (toilet.contains <= 0 && ctx.hasPort('land')) ctx.command('land.complaint', { subject: r.store, party: r.party, what: 'noToilet' });
    blockers.push({ code: 'living.noToilet', severity: 'warn', params: { person: name, toilet: toilet.label }, remedies });
  }
  // food there is, eaten only cooked, and nothing to cook it with while hungry: said, with the ways to cook
  const short = uncooked.filter((u) => hold.stock(r.store, u.material) > 1e-9);
  if (short.length && ate < need.energy.v - 1e-6) blockers.push({ code: 'living.cannotCook', severity: 'warn', params: { person: name, food: short.map((u) => hold.material(u.material).label).join(', '), why: [...new Set(short.map((u) => u.why))].join('; ') }, remedies: cookRemedies(ctx, r.store, short[0]!.lacks) });
  const left = provisions(ctx, r.store);
  const household = householdNeed(ctx, r.store, tMax);
  // running low is said unless they already lack it (hungry or thirsty say so): other warnings do not hide it
  const lacking = blockers.some((b) => b.code === 'living.hungry' || b.code === 'living.thirsty');
  // (food eaten cooked counts as far as it can be cooked: the fuel or water running out is food running out)
  const eatable = eatableKcal(ctx, r.store);
  const leftCaps = cookable(ctx, r.store, left.food, left.litres);
  const binding = left.food.map((f) => ({ f, c: leftCaps[f.material]! })).find((x) => x.c.lacks && x.c.qty < x.f.have - 1e-9);
  if (!lacking && eatable < household.energy * 2) blockers.push({ code: 'living.runningLow', severity: 'warn', params: { person: name, days: round(eatable / household.energy) }, remedies: [...(binding ? cookRemedies(ctx, r.store, binding.c.lacks!) : []), ...supplyRemedies(ctx, r.store, 'food')] });
  if (!lacking && left.litres < household.water * 2) blockers.push({ code: 'living.waterLow', severity: 'warn', params: { person: name, days: round(left.litres / household.water) }, remedies: supplyRemedies(ctx, r.store, 'water') });
  if (blockers.length) ctx.blockers.set(person, blockers);
  else ctx.blockers.clear(person);
  // too weak to work: ill until health is back
  if (health < set.health.ill.value || (health < set.health.well.value && ctx.get('Presence', person)?.status === 'sick')) {
    // the reason is what harmed them most
    // (sleep long owed, as the last night left it)
    const worn = set.tiredness.harms ? set.tiredness.harms.value * Math.min(1, Math.max(0, r.sleepDebt - 2 * set.tiredness.debt.value) / set.tiredness.debt.value) : 0;
    const causes: [number, string][] = [[parched, 'thirst'], [starved, 'hunger'], [worn, 'exhaustion: sleep long owed']];
    const why = causes.sort((a, b) => b[0] - a[0])[0]!;
    ctx.command('workforce.fallIll', { person, until: ctx.calendar.startOfDay(ctx.now) + DAY + EVENING_H * HOUR, reason: why[0] > 0 ? why[1] : 'exhaustion' });
  }
  // family and friends who are not looked after go home
  if (visiting(ctx, person) && unmetDays >= set.patience.value) ctx.command('workforce.goHome', { person, reason: `${unmetDays} days without enough ${thirst > 0 ? 'water' : 'food'}` });
}

export const livingModule = defineModule({
  id: 'living',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Agreement', 'Assignment', 'Employment', 'Helper', 'Machine', 'Move', 'NetNode', 'Party', 'Person', 'Presence', 'Project', 'Structure', 'StructureCondition', 'Tenure', 'WorkPackage'],
  label: 'Living on site',
  description: 'People who live on site eat, drink and sleep; what is missing slows them, costs health, sends helpers home.',
  requires: ['needs', 'workforce', 'holdings', 'trade', 'weather', 'parties', 'moves'],
  // (the water by a camp, drunk where it is: §5)
  optional: ['terrain'],
  // the data of both needs models (a practice pack carries both; the world binds one)
  data: { livingSettings: LivingSettingsSchema, physiology: PhysiologySchema.optional(), sphereStandards: SphereSchema.optional(), lodgings: s.record(LodgingSchema).optional() },
  state: { initial: (): LivingState => ({ onMap: [] }) },
  // every person of a party has a body (design/realism-plan.md S1): none is a worker without one
  audit(read) {
    const out: string[] = [];
    for (const [id, p] of read.all('Person')) if (!p.died && (read.get('Helper', id) || read.get('Employment', id)) && !read.get('Body', id)) out.push(`${p.name} (${id}) has no body`);
    return out;
  },
  // a body's state is its party's to know (others notice what shows: the living.noticed events); so is its heating
  observe: {
    Resident: (v: { party: EntityId; store: EntityId }, viewer: EntityId) => (v.party === viewer ? v : { party: v.party, store: v.store }),
    // (whose the person is: where they live, else whom they help or work for)
    Body: (v: unknown, viewer: EntityId, read: ReadCtx, id: EntityId) => ((read.get('Resident', id)?.party ?? read.get('Helper', id)?.of ?? read.get('Employment', id)?.employer) === viewer ? v : undefined),
    Heating: (v: unknown, viewer: EntityId, read: ReadCtx, id: EntityId) => (read.port('holdings').holder(id) === viewer ? v : undefined),
  },
  components: {
    /** whether the household runs its heaters through the night, and the night each place was last heated */
    Heating: s.object({ night: s.boolean(), burnt: s.record(s.int()), lit: s.record(s.number({ min: 0, max: 1 })).optional(), plan: s.record(s.object({ label: s.string(), fuel: s.string(), perHour: s.number({ min: 0 }), dT: s.number({ min: 0 }), ppm: s.number({ min: 0 }) })).optional() }),
    Lodging: s.object({ party: s.ref('party'), lodging: s.string(), since: s.number({ unit: 's' }), paid: s.int().optional(), next: s.object({ lodging: s.string(), at: s.number({ unit: 's' }) }).optional(), out: s.boolean().optional(), back: s.ref('store').optional() }),
    Resident: s.object({ party: s.ref('party'), store: s.ref('store'), since: s.number({ unit: 's' }), went: s.object({ day: s.int(), hours: s.number({ min: 0 }), out: s.number({ min: 0 }).optional(), by: s.ref('machine').optional(), bus: s.string().optional() }).optional() }),
    Body: s.object({ copaid: s.object({ year: s.int(), days: s.int({ min: 0 }) }).optional(), hunger: s.number({ min: 0 }), dryDays: s.int({ min: 0 }).optional(), thirst: s.number({ min: 0 }), sleepDebt: s.number({ min: 0 }), health: s.number({ min: 0, max: 1 }), unmetDays: s.int({ min: 0 }), unwashedDays: s.int({ min: 0 }).optional(), soaped: s.boolean().optional(), sweat: s.number({ min: 0 }).optional(), night: s.object({ from: s.number({ unit: 's' }), hours: s.number({ min: 0 }), need: s.number({ min: 0 }), met: s.boolean(), others: s.number({ min: 0 }), slept: s.number({ min: 0 }), chill: s.number({ min: 0 }), dose: s.number({ min: 0 }), bedding: s.string(), bed: s.object({ quality: s.number({ min: 0 }), warming: s.number(), place: s.ref().optional() }).optional(), away: s.boolean().optional() }).optional(), slept: s.number({ min: 0 }).optional(), day: s.object({ need: s.number({ min: 0 }), met: s.boolean(), others: s.number({ min: 0 }), span: s.number({ min: 0 }) }).optional(), bedAt: s.number({ unit: 's' }).optional(), worked: s.number({ min: 0 }).optional(), lastDay: s.int(), sleep: HOURS.optional(), away: s.object({ since: s.number({ unit: 's' }), at: s.point() }).optional(), today: s.object({ drank: s.number({ min: 0 }), short: s.number({ min: 0 }), where: s.array(s.string()), ate: s.number({ min: 0 }).optional(), missed: s.number({ min: 0 }).optional() }).optional(), own: s.record(s.number({ min: 0 })).optional(), bought: s.record(s.number({ min: 0 })).optional(), ill: s.object({ reason: s.string(), until: s.number({ unit: 's' }), ways: s.array(s.enum(['treat', 'toilet', 'cover', 'soap', 'wash'])) }).optional() }),
  },
  events: {
    /** others notice something about a person (their smell …): what they remember of us comes from such moments */
    /** the last person of a party has died */
    'living.noOneLeft': s.object({ party: s.ref('party') }),
    'living.noticed': s.object({ person: s.ref('person'), party: s.ref('party'), what: s.string(), level: s.string() }),
    'living.died': s.object({ person: s.ref('person'), party: s.ref('party'), cause: s.string() }),
  },
  blockers: {
    'living.notResident': '{person} does not live on site',
    'living.notOurs': '{person} does not live with {party}',
    'living.notOurStore': '{store} is not a store of {party}',
    'living.notOurPerson': '{person} is not one of {party}',
    'living.dryAway': '{person} went {short} l short of water while away: {where}',
    'living.siteDry': '{people} of ours went {short} l short of water working by {store} today: nothing to drink there but what they carried{way}',
    'living.siteNoToilet': '{people} of ours worked by {store} today with no toilet ({toilet}){per}: excreta left about, flies and hands carry illness',
    'living.lodged': '{person} lives at {lodging} ({cost} € a day with food)',
    'living.noRescue': 'Nobody can call 112 for {person}: {why}',
    'living.noEmergency': '{person} is not in need of a hospital (health {health} %, not giving out): the rescue service comes for an emergency only (§ 60, § 39 SGB V)',
    'living.inHospital': '{person} is in hospital',
    'living.onTheWay': '{person} is on the way somewhere: the rescue service is sent to a place, so 112 is called for them where they stop',
    'living.beyondMap': '{person} is not here: beyond the map, where this rescue service does not go (those about them there call their own)',
    'living.noLodging': 'there is no lodging {lodging} (there are: {lodgings})',
    'living.lodgingClosed': '{lodging} is closed now',
    'living.lodgingBring': '{lodging} asks one to bring {bring}: none of it is carried',
    'living.noLunch': '{person} went without lunch ({kcal} kcal): {where}',
    'living.cold': '{person} faces a night some {chill} K colder than their bedding keeps one warm in ({bedding}): it harms the body',
    'living.notWithThem': '{store} is not where {person} is: they take things from a store they stand by',
    'living.noVessel': '{person} has nothing to carry water in: {have} l of bottles, {want} l wanted',
    'living.tooHeavyToCarry': '{person} would carry {kg} kg, more than the {load} kg one carries',
    'living.notCarried': '{person} does not carry {qty} {unit} {material} (carries {have})',
    'living.notHere': '{person} is no longer here',
    'living.notTold': 'The word to come and live here does not reach {person} now: {why}',
    'living.notLivingHere': '{person} does not live at a store of {party}',
    'living.thirsty': '{person} had {short} l too little to drink of the {need} l the day asked{dry}',
    'living.hungry': '{person} is {short} kcal short of food',
    'living.tired': '{person} owes {owed} h of sleep ({where})',
    'living.unwashed': '{person} has had no water to wash for {days} days ({need} l a day): unwashed hands make illness from what one eats and drinks likelier',
    'living.moneyLow': '{store}: food and water for {days} days, {inStore} of them in hand or on order and {cash} € to spend at about {daily} € a day: then nothing is left to buy them with',
    'living.smells': '{person} smells {how} ({why}): those around notice',
    'living.wastePiles': '{kg} kg of household waste pile up at {store}: it smells and draws animals ({way})',
    'living.untreatedWater': '{person} drinks water as it comes ({water}), with nothing to treat it: it can make one ill',
    'living.cannotCook': '{person} cannot cook {food}: {why}; goes hungry with food in the store',
    'living.noSoap': '{person} washes with water alone: hands washed without soap keep less illness away',
    'living.ill': '{person} is ill until {until}: {reason}',
    'living.theirOwn': '{material} in what {person} carries is their own, brought from home (of ours: {free})',
    'living.noToilet': '{person}: {toilet}. What is left about the camp spreads illness by flies and hands, and others notice it',
    'living.runningLow': "{person}: food for {days} more days in the store, for everyone living from it",
    'living.waterLow': "{person}: water for {days} more days in the store, drinking and washing, for everyone living from it (washing yields to drinking)",
  },
  commands: {
    'living.settle': command(
      s.object({ person: s.ref('person'), party: s.ref('party'), store: s.ref('store'), sleep: HOURS.optional() }),
      (ctx, p) => {
        // their body is made once, when they first live here; someone who lived elsewhere brings theirs, with the days away reckoned
        ctx.set('Resident', p.person, { party: p.party, store: p.store, since: ctx.now });
        // (no longer one living beyond the map who is on it: their hours here go on as a resident's, review S1 #9)
        leaveOnMap(ctx, p.person);
        const body = ctx.get('Body', p.person);
        if (!body) ctx.set('Body', p.person, { hunger: 0, thirst: 0, sleepDebt: 0, health: 1, unmetDays: 0, lastDay: -1, ...(p.sleep ? { sleep: p.sleep } : {}) });
        else {
          const { night: _n, bedAt: _b, ...kept } = body;
          ctx.set('Body', p.person, { ...kept, ...(p.sleep ? { sleep: p.sleep } : {}) });
          if (body.lastDay >= 0) awayDays(ctx, p.person, Math.floor(ctx.now / DAY) - body.lastDay - 1);
        }
        // their first night here: at the next bedtime
        scheduleBed(ctx, p.person, nextBed(ctx, requireLife(ctx, p.person), ctx.now));
        // one of the household's own who had gone lives here again (a friend on a stay stays a guest)
        const h = ctx.get('Helper', p.person);
        if (h && h.of === p.party && h.relation === 'member' && !h.resident) ctx.command('workforce.moveIn', { person: p.person });
        // and they go there (by a move; when the world is made, they are there)
        else ctx.command('workforce.report', { person: p.person });
      },
      { label: 'Someone lives on site (a starter, a move)', internal: true },
    ),
    'living.moveIn': command(
      s.object({ person: s.ref('person'), store: s.ref('store') }),
      (ctx, p) => {
        // one of ours comes to live at a store of ours (a camp, a caravan's): or moves there from where they lived
        const party = actorOf(ctx);
        if (ctx.port('holdings').holder(p.store) !== party) ctx.reject('living.notOurStore', { store: ctx.port('holdings').label(p.store) ?? p.store, party: partyLabel(ctx, party) });
        const name = ctx.get('Person', p.person)?.name ?? p.person;
        const h = ctx.get('Helper', p.person);
        const ours = h?.of === party || ctx.get('Employment', p.person)?.employer === party;
        if (!ours) ctx.reject('living.notOurPerson', { person: name, party: partyLabel(ctx, party) });
        if (ctx.get('Person', p.person)?.died || ctx.get('Presence', p.person)?.status === 'gone') ctx.reject('living.notHere', { person: name });
        // (where they live is theirs to be told: the word reaches them, within hearing of the one in charge or by phone,
        // design/physical-state.md I9; Qwen S514: a household all beyond the map moved one back with nobody to tell them)
        if (ctx.caller === 'client' && lifeOf(ctx, p.person)?.store !== p.store) {
          const told = ctx.port('workforce').tell(party, p.person);
          if ('why' in told) ctx.reject('living.notTold', { person: name, why: told.why }, ctx.port('workforce').wordWays(party, p.person, told));
        }
        // (back from a lodging: it ends)
        if (ctx.get('Lodging', p.person)) {
          ctx.remove('Lodging', p.person);
          ctx.blockers.clear(p.person);
        }
        const r = lifeOf(ctx, p.person);
        if (r) {
          if (r.store === p.store) return;
          // (the dwelling there begins now: the land counts the household's time in a zone across its moves)
          setLife(ctx, p.person, { ...r, store: p.store, since: ctx.now });
          // (they go there: by a move, now or when their work is over)
          ctx.command('workforce.report', { person: p.person });
        } else ctx.command('living.settle', { person: p.person, party, store: p.store });
        // (and what they will live on there: days of water and food within reach of it, said: runs 10 and 14 moved a
        // household away from its pantry and its water)
        const d = daysAt(ctx, p.store, party);
        const short = d.water < 2 || d.food < 2;
        ctx.log(short ? 'warn' : 'info', `${name} lives at ${ctx.port('holdings').label(p.store)} now: water for ${d.water.toFixed(1)} days and food for ${d.food.toFixed(1)} days within reach there${short ? ' — bring some, or have it fetched, before the evening' : ''}.`, [p.person, p.store]);
      },
      { label: 'Live at a store of ours', description: 'One of ours (a member of the household, a friend, an employee) lives at a store of ours from now on: a camp, a caravan set up beside it. They eat and drink from it, sleep in what shelters there, wash there and go to work from there. Someone living somewhere already moves there.' },
    ),
    'living.callRescue': command(
      s.object({ person: s.ref('person') }),
      (ctx, p) => {
        // one of ours too ill to help themselves: 112, called by them or one by them with a phone with charge
        const party = actorOf(ctx);
        const r = lifeOf(ctx, p.person);
        const name = ctx.get('Person', p.person)?.name ?? p.person;
        if (!r || r.party !== party) ctx.reject('living.notLivingHere', { person: name, party: partyLabel(ctx, party) });
        return rescue(ctx, p.person, true) ?? '';
      },
      { label: 'Call 112 for one of ours', description: 'One of ours living on site who is seriously ill or giving out: they or one of theirs within hearing calls 112 with a phone with charge. The rescue service comes as near as its vehicle gets, its crew carries them from there, and takes them to hospital beyond the map (the insured pay 10 € for the ride and 10 € a day); they come back when well. Called by itself in the evening for one whose body is giving out, when someone can.' },
    ),
    'living.moveOut': command(
      s.object({ person: s.ref('person') }),
      (ctx, p) => {
        const party = actorOf(ctx);
        const r = lifeOf(ctx, p.person);
        const name = ctx.get('Person', p.person)?.name ?? p.person;
        if (!r || r.party !== party) ctx.reject('living.notLivingHere', { person: name, party: partyLabel(ctx, party) });
        ctx.remove('Resident', p.person);
        ctx.blockers.clear(p.person);
        // one of the household's (or a friend) not living here goes home, off the site; an employee lives at home again
        if (ctx.get('Helper', p.person)?.resident) ctx.command('workforce.goHome', { person: p.person, reason: 'moves out' });
        else ctx.command('workforce.report', { person: p.person });
        ctx.log('info', `${name} no longer lives on site.`, [p.person]);
      },
      { label: 'No longer live on site', description: 'One of ours stops living at our store: an employee goes back to living at home, off the map; one of the household or a friend goes home, off the site.' },
    ),
    'living.heat': command(
      s.object({ store: s.ref('store'), night: s.boolean() }),
      (ctx, p) => {
        const party = actorOf(ctx);
        if (ctx.port('holdings').holder(p.store) !== party) ctx.reject('living.notOurStore', { store: ctx.port('holdings').label(p.store) ?? p.store, party: partyLabel(ctx, party) });
        ctx.set('Heating', p.store, { ...(ctx.get('Heating', p.store) ?? { burnt: {} }), night: p.night });
        // what it will do, said before the night: the warmth, the fuel, the fumes (the household decides; nothing refuses it)
        if (!p.night) return [];
        // the rooms this household heats, as the night will be (for the one who breathes the most of it);
        // turned on after the evening, tonight's fires are lit now (once a room a night)
        const hold = ctx.port('holdings');
        const rooms = roomsTonight(ctx);
        // (planned now whenever it is turned on: a heater lit at 00:30 burns the rest of the night)
        planTonight(ctx, rooms, p.store);
        return [...rooms.values()].filter((h) => h.store === p.store).map((h) => `${ctx.get('Structure', h.place)?.label ?? h.place}: ${(h.note ?? '').replace(' — deadly', ' — DEADLY')}${h.need > 0 ? `; ${round(h.need)} ${hold.material(h.fuel).unit} of ${hold.material(h.fuel).label.toLowerCase()} a night` : ''}`);
      },
      { label: 'Run the heaters and fires at night', description: 'Whether the household runs its heaters (goods with heat, in this store) through the night in its sleeping places, the strongest in the first place, and keeps a fire before an open shelter (a lean-to) of its dry firewood. A heater warms the room by its output over the room’s heat loss and burns its fuel from the store; one without a flue leaves its carbon monoxide in the closed room; an open fire warms by what it throws in. Nothing is lit where nobody sleeps. Returns what each place would get: the warmth, the fuel, the fumes.' },
    ),
    'living.pack': command(
      s.object({ person: s.ref('person'), material: s.string(), qty: s.number({ min: 0 }), from: s.ref('store').optional() }),
      (ctx, p) => {
        // what someone carries along: taken from a store of ours they stand by, into their pack (design/physical-state.md 8b)
        const party = actorOf(ctx);
        const name = ctx.port('workforce').name(p.person);
        const r = lifeOf(ctx, p.person);
        if (!r || r.party !== party) ctx.reject('living.notLivingHere', { person: name, party: partyLabel(ctx, party) });
        const from = p.from ?? r!.store;
        const hold = ctx.port('holdings');
        if (hold.holder(from) !== party) ctx.reject('living.notOurStore', { store: hold.label(from) ?? from, party: partyLabel(ctx, party) });
        const mat = hold.material(p.material);
        let pack = packOf(ctx, p.person);
        if (!pack) {
          const made = ctx.command('inventory.createStore', { holder: party, label: `${name}: what they carry`, kind: 'carried', pos: ctx.port('moves').where(p.person) ?? hold.where(from)!, on: p.person });
          if (!made.ok) return ctx.reject(made.reasons[0]!.code, made.reasons[0]!.params);
          pack = made.value;
        }
        if (!hold.together(from, pack)) ctx.reject('living.notWithThem', { store: hold.label(from)!, person: name });
        // water only in something that holds it
        if (mat.water) {
          const v = vessels(ctx, pack);
          if (v.water + p.qty * mat.water.value > v.litres + 1e-6) ctx.reject('living.noVessel', { person: name, have: round(v.litres), want: round(v.water + p.qty * mat.water.value) }, carryRemedies(ctx, p.person, from));
        }
        // as much as one carries
        const load = ctx.data('handling')?.safeLoad.value ?? 25;
        const kg = hold.mass(pack) + p.qty * unitMass(mat);
        if (kg > load + 1e-6) ctx.reject('living.tooHeavyToCarry', { person: name, kg: round(kg), load: Math.round(load) });
        const t = ctx.command('inventory.transfer', { from, to: pack, material: p.material, qty: p.qty, why: `${name} takes it along` });
        if (!t.ok) return ctx.reject(t.reasons[0]!.code, t.reasons[0]!.params);
        return pack;
      },
      { label: 'Take something along', description: 'Someone of ours takes goods from a store they stand by (default: the one they live from) into what they carry: a bottle, food, a tool. What one carries goes where they go; water only in a bottle (filled again with clean water at home each evening), as much as one carries (the safe load).' },
    ),
    'living.unpack': command(
      s.object({ person: s.ref('person'), material: s.string(), qty: s.number({ min: 0 }), to: s.ref('store').optional() }),
      (ctx, p) => {
        const party = actorOf(ctx);
        const name = ctx.port('workforce').name(p.person);
        const r = lifeOf(ctx, p.person);
        if (!r || r.party !== party) ctx.reject('living.notLivingHere', { person: name, party: partyLabel(ctx, party) });
        const to = p.to ?? r!.store;
        const hold = ctx.port('holdings');
        if (hold.holder(to) !== party) ctx.reject('living.notOurStore', { store: hold.label(to) ?? to, party: partyLabel(ctx, party) });
        const pack = packOf(ctx, p.person);
        const have = pack ? hold.stock(pack, p.material) : 0;
        const mat = hold.material(p.material);
        if (!pack || have < p.qty - 1e-9) ctx.reject('living.notCarried', { person: name, qty: p.qty, unit: mat.unit, material: mat.label, have: round(have) });
        // (what they brought from their own home beyond the map is theirs: review S1 #3)
        const free = notOwn(ctx, p.person, pack!, p.material);
        if (free < p.qty - 1e-9) ctx.reject('living.theirOwn', { person: name, material: mat.label, free: round(free) });
        if (!hold.together(to, pack!)) ctx.reject('living.notWithThem', { store: hold.label(to)!, person: name });
        const t = ctx.command('inventory.transfer', { from: pack!, to, material: p.material, qty: p.qty, why: `${name} puts it down` });
        if (!t.ok) return ctx.reject(t.reasons[0]!.code, t.reasons[0]!.params);
        return to;
      },
      { label: 'Put something down', description: 'Someone of ours puts goods they carry into a store they stand by (default: the one they live from).' },
    ),
    'living.lodge': command(
      s.object({ person: s.ref('person'), lodging: s.string() }),
      (ctx, p) => {
        // one of the household goes to live at a lodging beyond the map, or looks for another (a room takes weeks to find)
        const party = actorOf(ctx);
        const name = ctx.port('workforce').name(p.person);
        const h = ctx.get('Helper', p.person);
        if (h?.of !== party || h.relation !== 'member') ctx.reject('living.notOurPerson', { person: name, party: partyLabel(ctx, party) });
        const l = ctx.data('lodgings')?.[p.lodging];
        if (!l || l.kind === 'hospital') ctx.reject('living.noLodging', { lodging: p.lodging, lodgings: Object.entries(ctx.data('lodgings') ?? {}).filter(([, x]) => x.kind !== 'hospital').map(([k]) => k).join(', ') });
        if (l!.months && !l!.months.includes(ctx.calendar.at(ctx.now).month)) ctx.reject('living.lodgingClosed', { lodging: l!.label });
        if (!brought(ctx, [p.person], l!)) ctx.reject('living.lodgingBring', { lodging: l!.label, bring: (l!.bring ?? []).map((alts) => alts.map((m) => ctx.port('holdings').material(m).label).join(' or ')).join(', and ') });
        const ld = ctx.get('Lodging', p.person);
        if (l!.wait) {
          // looking for it: found some time on, by chance (moved into then)
          const at = ctx.now + Math.round(ctx.rng('lodging').exponential(l!.wait.value) * DAY);
          if (ld) ctx.set('Lodging', p.person, { ...ld, next: { lodging: p.lodging, at } });
          else lodge(ctx, p.person, party, lodgingFor(ctx, party, [p.person]) ?? p.lodging, 'to look for somewhere to live');
          const now = ctx.get('Lodging', p.person);
          if (now && !now.next) ctx.set('Lodging', p.person, { ...now, next: { lodging: p.lodging, at } });
          ctx.log('info', `${name} looks for ${l!.label.charAt(0).toLowerCase()}${l!.label.slice(1)} (found when it is: some ${Math.round(l!.wait.value)} days on average).`, [p.person]);
          return;
        }
        if (ld) ctx.set('Lodging', p.person, { party, lodging: p.lodging, since: ctx.now });
        else lodge(ctx, p.person, party, p.lodging, 'moves out');
      },
      { label: 'Live somewhere beyond the map', description: 'One of the household lives at a lodging beyond the map from now on (a campsite pitch in the season, a hostel bed, a room in a shared flat (found after some weeks), or the town’s shelter): paid a day by the household, with their food; still one of the household, at their job and paid for it. living.moveIn brings them back to a store of ours.' },
    ),
    'living.keepHours': command(
      s.object({ person: s.ref('person'), bed: s.number({ min: 0, max: 24 }), rise: s.number({ min: 0, max: 24 }) }),
      (ctx, p) => {
        const r = lifeOf(ctx, p.person);
        if (!r) ctx.reject('living.notResident', { person: p.person });
        if (ctx.caller === 'client' && r!.party !== actorOf(ctx)) ctx.reject('living.notOurs', { person: ctx.port('workforce').name(p.person), party: partyLabel(ctx, actorOf(ctx)) });
        setLife(ctx, p.person, { ...r!, sleep: { bed: p.bed, rise: p.rise } });
        // the next night by the new hours (one under way ends as it began; its end books the next)
        if (!r!.night) scheduleBed(ctx, p.person, nextBed(ctx, requireLife(ctx, p.person), ctx.now));
      },
      { label: 'Keep other hours', description: 'When someone goes to bed and gets up (hours of the day, e.g. bed 0.5, rise 8.5). What of it the working day takes is sleep lost.' },
    ),
  },
  timers: {
    setOut(ctx, payload: { person: EntityId; start: number }) {
      setOut(ctx, payload.person, payload.start);
    },
    // the shift beyond the map over: the way home (by the bus, when it goes back)
    comeBack(ctx, payload: { person: EntityId }) {
      const r = lifeOf(ctx, payload.person);
      const e = ctx.get('Employment', payload.person);
      if (!r || !e || ctx.port('moves').where(payload.person) !== undefined) return;
      // (back the way they went: on the vehicle that went with them, else on foot or by the bus)
      const { by: _now, ...way } = commuteOf(ctx, payload.person, r.party, e.employer);
      // (the vehicle only if it is there with them and sound: one that broke down on the way stays where it stands)
      const v = r.went?.by;
      const by = v && ctx.get('Machine', v)?.status === 'ready' && ctx.port('moves').placeOf(v)?.beyond !== undefined ? v : undefined;
      // (the camp short of food: bought in town on the way, into what they carry: S2)
      const shopping = shopOnTheWayHome(ctx, payload.person, r);
      commute(ctx, payload.person, r, e.employer, { ...way, ...(by ? { by: { machine: by, label: '' } } : {}), ...(r.went?.bus ? { bus: way.bus ?? { line: r.went.bus, label: '', fare: 0, leave: 0, out: 0 } } : {}) }, 'back', shopping);
    },
    // the morning after a cold night: what the cold took, less what a fire spared; it kills where the cold wore the body
    // down most (thirst and hunger have their own course, exhaustion alone does not kill), or makes one ill
    // bedtime: the night begins (with what the last evening left of the day; one never fed yet is no worse for it)
    bed(ctx, payload: { person: EntityId; at: number }) {
      const r = lifeOf(ctx, payload.person);
      if (!r || r.bedAt !== payload.at || r.night) return;
      const d = r.day ?? { need: ctx.port('needs').requirement(payload.person, { workHours: 0, tMax: ctx.port('weather').soFar(ctx.now).tMax }).sleep.v, met: true, others: 0, span: 0 };
      const hours = Math.max(0, night(ctx, payload.person, r, d.span, ctx.now).hours);
      // (the bedding label only: no room's heater is reckoned for it)
      const shelter = shelterOf(ctx, payload.person, new Map(), false);
      const { bedAt: _b, ...rest } = r;
      // (beyond the map at bedtime, and not back by it: the night is slept there; out on the map, it is slept from when
      // they are home, hour by hour: r36)
      const away = ctx.port('moves').where(payload.person) === undefined && !inTheRoom(ctx, payload.person, ctx.now);
      setLife(ctx, payload.person, { ...rest, night: { from: ctx.now, hours, need: d.need, met: d.met, others: d.others, slept: 0, chill: 0, dose: 0, bedding: shelter.bedding, ...(away ? { away: true } : {}) } });
      // the first hour of the night is reckoned when it is over; a night with no hours in bed is reckoned at once
      ctx.at(hours > 0 ? ctx.now + Math.min(1, hours) * HOUR : ctx.now, hours > 0 ? 'sleepHour' : 'dawn', { person: payload.person, k: 0 });
    },
    // an hour of the night, reckoned when it is over: its air, the shelter, the heater as far as it burned that hour
    sleepHour(ctx, payload: { person: EntityId; k: number }) {
      const r = lifeOf(ctx, payload.person);
      const n = r?.night;
      if (!r || !n) return;
      const set = ctx.data('livingSettings');
      const t0 = n.from + payload.k * HOUR;
      const end = n.from + n.hours * HOUR;
      const t1 = Math.min(end, t0 + HOUR);
      const dt = Math.max(0, (t1 - t0) / HOUR);
      let next = n;
      // away for the night (a course, a trip, home with family): slept there, as one sleeps; out past bedtime (an
      // errand) or up and gone in the hour (to work): not slept
      if (dt > 0 && n.away) {
        next = { ...n, slept: n.slept + dt };
        setLife(ctx, payload.person, { ...r, night: next });
      } else if (dt > 0 && inTheRoom(ctx, payload.person, t0) && inTheRoom(ctx, payload.person, t1)) {
        // where they lie down is where they sleep the night (a place freed in the night is not taken)
        const where = n.bed ?? (() => {
          const p = placeOf(ctx, payload.person);
          return p ? { quality: p.quality, warming: p.warming, ...(p.place ? { place: p.place } : {}) } : { quality: set.outside.value, warming: 0 };
        })();
        const heat = where.place ? heaterHour(ctx, where.place, Math.floor(t0 / HOUR)) : { dT: 0, ppm: 0 };
        const cold = coldOf(ctx, payload.person, where.warming + heat.dT, undefined, ctx.port('weather').hour(t0).airTemp);
        next = { ...n, bed: where, slept: n.slept + dt * where.quality * cold.factor, chill: Math.max(n.chill, Math.max(0, cold.comfort - cold.inside)), dose: n.dose + heat.ppm * dt, bedding: cold.bedding };
        setLife(ctx, payload.person, { ...r, night: next });
        // the shocking moment (the user: let people die): a room closed for the night with a fire in it, the hour it happens
        const fumes = set.fumes;
        if (fumes && heat.ppm > 0 && next.dose >= fumes.deadly.value) {
          return die(ctx, { person: payload.person, party: r.party, store: r.store, cause: `of carbon monoxide poisoning in their sleep: the ${(heat.label ?? 'heater').toLowerCase()} burned without a flue in the closed room (about ${Math.round(heat.ppm)} ppm)` });
        }
      }
      if (t1 < end - 1e-6) ctx.at(Math.min(end, t1 + HOUR), 'sleepHour', { person: payload.person, k: payload.k + 1 });
      else ctx.at(Math.max(ctx.now, end), 'dawn', { person: payload.person });
    },
    // the end of the night: the sleep it gave, the cold it brought, what the day's rest mends
    dawn(ctx, payload: { person: EntityId }) {
      const r = lifeOf(ctx, payload.person);
      const n = r?.night;
      if (!r || !n) return;
      const set = ctx.data('livingSettings');
      const { night: _n, ...rest } = r;
      const sleepDebt = Math.max(0, r.sleepDebt + n.need - n.slept);
      // exhaustion (sleep owed far beyond the limit) and the cold of a night well beyond what the bedding keeps one warm in
      // (from twice the debt that slows one: four nights owed; then it grows to its full harm by three times it)
      const worn = set.tiredness.harms ? set.tiredness.harms.value * Math.min(1, Math.max(0, sleepDebt - 2 * set.tiredness.debt.value) / set.tiredness.debt.value) : 0;
      const cold = set.exposure ? set.exposure.harm.value * Math.max(0, n.chill - set.exposure.margin.value) : 0;
      // the body mends after a day with what it needed, sleep among it (four nights owed and more mends nothing)
      const mend = n.met && sleepDebt <= 2 * set.tiredness.debt.value ? set.health.recovers.value : 0;
      const left = r.health - cold - worn + mend;
      if (left <= 0 && cold > 0 && cold + worn >= n.others) {
        die(ctx, { person: payload.person, party: r.party, store: r.store, cause: `of cold: nights far colder than the bedding kept them warm in (${n.bedding})${worn > 0 ? ', worn out by sleep long owed' : ''}` });
        return;
      }
      let health = Math.max(0, Math.min(1, left));
      // sleep long owed alone makes one ill, it does not kill: it wears the body down to illness and no further
      if (worn > 0 && cold <= 0) health = Math.max(health, Math.min(r.health, set.health.ill.value * 0.5));
      setLife(ctx, payload.person, { ...rest, sleepDebt, health, slept: n.slept });
      // the next night: at the next bedtime after this one
      scheduleBed(ctx, payload.person, nextBed(ctx, rest, ctx.now));
      if (cold > 1e-9 && health < set.health.ill.value && ctx.get('Presence', payload.person)?.status !== 'sick') {
        // (the cold harmed most that night, or it tipped them over: either way it is the cold that made them ill)
        ctx.command('workforce.fallIll', { person: payload.person, until: ctx.calendar.startOfDay(ctx.now) + EVENING_H * HOUR, reason: `the cold of the nights (bedding: ${n.bedding})` });
      }
      // a night's fumes that did not kill: one wakes poisoned
      const fumes = set.fumes;
      if (fumes && n.dose >= fumes.ill.value) {
        const now = requireLife(ctx, payload.person);
        setLife(ctx, payload.person, { ...now, health: Math.max(0, now.health - 0.3) });
        ctx.command('workforce.fallIll', { person: payload.person, until: ctx.calendar.startOfDay(ctx.now) + DAY + EVENING_H * HOUR, reason: 'carbon monoxide from a heater in the closed room: headache and sickness' });
      }
    },
  },
  systems: [
    // early: who sets out for a job beyond the map, and by what
    { id: 'morning', every: DAY, offset: 3 * HOUR, phase: 'biological', run: (ctx) => morning(ctx) },
    // what is said on the sites worked at today, as what is on its way to them changes (S1b; a few sites, not everyone)
    { id: 'sites', every: HOUR, phase: 'biological', run: (ctx) => sitesNow(ctx) },
    // the household's own errands, at the hours it looks (S2; the hours are the practice pack's: 7, 13, 18)
    ...[7, 13, 18].map((h) => ({ id: `routine${h}`, every: DAY, offset: h * HOUR, phase: 'biological' as const, run: (ctx: WriteCtx) => (ctx.data('livingSettings').routine?.hours.includes(h) ? routines(ctx) : undefined) })),
    {
      id: 'evening',
      every: DAY,
      offset: EVENING_H * HOUR,
      phase: 'biological',
      run(ctx) {
        // tonight's rooms for everyone at once: who sleeps where, which heater, whose fuel, what air; each
        // heater burns hour by hour through the night while the household runs it (it can still change its mind)
        const rooms = roomsTonight(ctx);
        planTonight(ctx, rooms);
        // the evening for each (who does not live through the night is told after, the turns of the night unchanged)
        const deaths: Death[] = [];
        const camps = [...new Set(lives(ctx).map(([, r]) => r.store))].sort();
        const holes = holesTonight(ctx, camps);
        emptyToilets(ctx, camps, holes);
        wastePiles(ctx, camps);
        for (const [id, r] of lives(ctx)) {
          // (the day reckoned, the lunch eaten: what they carried home is put away, S2)
          if (atHome(ctx, id)) (settleDay(ctx, id, rooms, deaths, holes), unpackShopping(ctx, id, r.store));
          // (out on the map: the day is reckoned when they are home this evening, from their store: r36)
          else if (ctx.port('moves').where(id) !== undefined) continue;
          else if (r.lastDay !== Math.floor(ctx.now / DAY)) {
            // away (on leave, a course, a night out): the day lived where they are; nothing of it is said here
            awayDays(ctx, id, 1);
            const rest = ownBlockers(ctx, id).filter((x) => x.code !== 'living.unwashed' && x.code !== 'living.smells' && x.code !== 'living.thirsty' && x.code !== 'living.hungry');
            if (rest.length) ctx.blockers.set(id, rest);
            else ctx.blockers.clear(id);
          }
        }
        // those living beyond the map who are on it still: their hours so far, drunk and eaten where they are (S1)
        for (const id of ctx.state('living').onMap) settleVisit(ctx, id, ctx.now, true);
        sitesPast(ctx);
        // the bottles they carry filled again with clean water at home, for tomorrow, when everyone has drunk (VISION, r42)
        for (const [id, r] of lives(ctx)) refill(ctx, id, r.store);
        for (const d of deaths) die(ctx, d);
        // a body giving out, and someone to call 112 for it: the rescue service fetches them (S506/S507)
        for (const [id, r] of lives(ctx)) if (atHome(ctx, id) && !ctx.get('Person', id)?.died && givingOut(ctx, r)) rescue(ctx, id, false);
        // those of ours living beyond the map: their day there
        for (const [id] of [...ctx.all('Lodging')]) lodgedDay(ctx, id);
        washAll(ctx);
        moneyNews(ctx);
      },
    },
  ],
  /** a fork does not know when a room looked for is found: drawn again (memoryless, as an applicant's arrival; r42) */
  branch(ctx) {
    for (const [id, ld] of [...ctx.all('Lodging')]) {
      const wait = ld.next ? ctx.data('lodgings')?.[ld.next.lodging]?.wait?.value : undefined;
      if (!ld.next || wait === undefined || ld.next.at <= ctx.now) continue;
      ctx.set('Lodging', id, { ...ld, next: { lodging: ld.next.lodging, at: ctx.now + Math.round(ctx.rng('lodging').exponential(wait) * DAY) } });
    }
  },
  contributes: {
    // (contributions read with living's own context, not their caller's: the read graph charges what they read to living,
    // design/modular-split.md §4.1)
    workCapacity: (own) => (_read: ReadCtx, person: EntityId) => capacity(own, person),
    // the store someone lives at is not given up or closed from under them (decision 0028; review x: a felling's heap one
    // of ours camped by was given up with the felling, and the next evening read a store that was gone)
    storeUses: (own) => (_read: ReadCtx, store: EntityId): StoreUse[] => lives(own).filter(([id, r]) => r.store === store && !own.get('Person', id)?.died).map(([id]) => ({ by: id, why: `${own.get('Person', id)?.name ?? id} lives there` })),
    // a pass for the buses and trains is of no use where none stops (Qwen S507: 63 € a month for a map without a bus)
    unusable: (own) => (_read: ReadCtx, permit: string) => (permit === 'transit' && !linesHere(own).length ? 'no bus or train stops on this map' : null),
    // what the body carries: ill but on one's feet, less; too weak to walk, nothing (illness by degrees)
    bodyCarries: (own) => (_read: ReadCtx, person: EntityId) => {
      const r = own.get('Body', person);
      if (!r) return null;
      const set = own.data('livingSettings').health;
      if (r.health < set.walk.value) return { share: 0, why: `too weak to walk (health ${Math.round(r.health * 100)} %)` };
      const sick = own.get('Presence', person)?.status === 'sick';
      const share = Math.min(1, r.health / set.well.value) * (sick ? 0.6 : 1);
      return share >= 0.999 ? null : { share, why: `${sick ? 'ill' : 'weak'}, health ${Math.round(r.health * 100)} %: carries ${Math.round(share * 100)} % of a well person's load` };
    },
    // where someone sleeps on the map: by the store they live from
    home: (own) => (_read: ReadCtx, person: EntityId) => {
      const store = lifeOf(own, person)?.store;
      const at = store ? own.port('holdings').where(store) : undefined;
      return at ? ([at[0], at[1]] as [number, number]) : undefined;
    },
    // the way to a job beyond the map, one way: as the evening reckons it (on foot, or by what they ride)
    commute: (own) => (_read: ReadCtx, person: EntityId) => {
      const r = lifeOf(own, person);
      // as they set out this morning; else as they would
      const split = (hours: number, out?: number) => ({ out: out ?? hours / 2, back: hours - (out ?? hours / 2) });
      if (r?.went && r.went.day === Math.floor(own.calendar.startOfDay(own.now) / DAY)) return split(r.went.hours, r.went.out);
      const party = r?.party ?? own.get('Helper', person)?.of;
      const job = own.get('Employment', person)?.employer;
      if (!party || !job) return null;
      const way = commuteOf(own, person, party, job);
      return split(way.hours, way.bus?.out);
    },
    // a camp: the people living from a store, on the land where it stands
    landUse: (own) => (_read: ReadCtx) => {
      const camps = new Map<EntityId, { party: EntityId; people: number; since?: number }>();
      for (const [id, r] of lives(own)) {
        const c = camps.get(r.store) ?? { party: r.party, people: 0 };
        c.people += 1;
        // a home: those of the household who live there (not a friend on a stay), since the first came
        if (own.get('Helper', id)?.resident) c.since = Math.min(c.since ?? r.since, r.since);
        camps.set(r.store, c);
      }
      const hold = own.port('holdings');
      return [...camps].map(([store, c]) => {
        const at = hold.where(store)!;
        return { subject: store, party: c.party, label: hold.label(store)!, pos: [at[0], at[1]] as [number, number], area: CAMP_M2 * c.people, people: c.people, ...(c.since !== undefined ? { dwelling: { since: c.since } } : {}) };
      });
    },
  },
  on: {
    // home late (after the evening): the day is reckoned now, from their store, as it would have been at the evening (r36)
    'moves.legDone': (ctx, e) => {
      const day = Math.floor(ctx.now / DAY);
      if (ctx.now < ctx.calendar.startOfDay(ctx.now) + EVENING_H * HOUR) return;
      for (const id of e.left ?? []) {
        const r = lifeOf(ctx, id);
        if (!r || r.lastDay === day || !atHome(ctx, id)) continue;
        const deaths: Death[] = [];
        settleDay(ctx, id, roomsTonight(ctx), deaths, holesTonight(ctx, [r.store]));
        unpackShopping(ctx, id, r.store);
        for (const d of deaths) die(ctx, d);
      }
    },
    // someone who has left (dismissed, gone): no longer living on site
    // away from home on the map, and back (design/physical-state.md 8b): the time away is drunk where they were
    'moves.arrived': (ctx, e) => {
      const people = [...(e.carrier.unit ? [e.carrier.unit] : []), ...e.loads.flatMap((l) => ('person' in l ? [l.person] : []))];
      for (const person of people) {
        // (left while on the way: out now, r42)
        const ld = ctx.get('Lodging', person);
        if (ld?.out && walkOut(ctx, person)) {
          const { out: _o, ...rest } = ld;
          ctx.set('Lodging', person, rest);
        }
        // (one who lives beyond the map: their hours on it, S1)
        if (!ctx.get('Resident', person) && ctx.get('Body', person)) {
          visitArrived(ctx, person, e.move);
          continue;
        }
        const r = lifeOf(ctx, person);
        const home = r ? ctx.port('holdings').where(r.store) : undefined;
        if (!r || !home) continue;
        const back = Math.hypot(e.to[0] - home[0], e.to[1] - home[1]) <= ctx.data('livingSettings').selfCare.value;
        if (back) {
          if (r.away) settleAway(ctx, person, ctx.now, false);
          continue;
        }
        // (beyond the map: a job's day is reckoned with the day's work; elsewhere it is not followed yet)
        const at = ctx.port('moves').where(person);
        if (!at) continue;
        if (r.away) settleAway(ctx, person, ctx.now, false);
        const departed = ctx.get('Move', e.move)?.legs[0]?.depart ?? ctx.now;
        setLife(ctx, person, { ...requireLife(ctx, person), away: { since: r.away ? ctx.now : Math.min(ctx.now, departed), at: [at[0], at[1]] } });
      }
    },
    // a person comes into the world: with a body of their own, and (living beyond the map) a day's water and lunch packed
    'workforce.person': (ctx, e) => {
      if (!ctx.get('Body', e.person)) ctx.set('Body', e.person, { ...NEW_BODY });
      packFromHome(ctx, e.person, e.party);
    },
    'workforce.left': (ctx, e) => {
      leaveOnMap(ctx, e.person);
      if (!lifeOf(ctx, e.person)) return;
      ctx.remove('Resident', e.person);
      ctx.blockers.clear(e.person);
    },
    // a camp struck or cleared: its people leave the site; the household's own for somewhere to live (VISION "Leaving
    // goes somewhere"), friends and employees home
    'land.vacate': (ctx, e) => {
      const gone = lives(ctx).filter(([, r]) => r.store === e.subject);
      for (const [id, r] of gone) {
        const h = ctx.get('Helper', id);
        const to = h?.relation === 'member' && h.of === r.party ? lodgingFor(ctx, r.party, gone.map(([p]) => p)) : undefined;
        if (to) {
          lodge(ctx, id, r.party, to, e.evicted ? 'evicted' : 'the camp is struck');
          continue;
        }
        ctx.remove('Resident', id);
        ctx.blockers.clear(id);
        ctx.command('workforce.goHome', { person: id, reason: e.evicted ? 'evicted' : 'the camp is struck' });
      }
    },
  },
  projections: {
    'living.residents': {
      label: 'The people living on site: what they lack, their health, and how long their store lasts (food and water days for everyone living from it)',
      description: 'args: party (whose people; a client sees its own)',
      compute: (read: ReadCtx, args?: { party?: EntityId }) => {
        // tonight's rooms, once for everyone
        const rooms = roomsTonight(read);
        return lives(read).filter(([, r]) => !args?.party || r.party === args.party).map(([id, r]) => {
          const household = householdNeed(read, r.store, read.port('weather').soFar(read.now).tMax);
          // (what is at home and within a few steps of it: what they eat and drink from)
          const stores = [r.store, ...aroundOf(read, r)];
          // (and clean water as far as one walks for it)
          const hold = read.port('holdings');
          // (what is here: what lies farther comes by a walk, S2; review S2 #7)
          void hold;
          const litres = stores.reduce((a, s) => a + provisions(read, s).litres, 0);
          const foodStores = stores;
          const kcal = foodStores.reduce((a, s) => a + eatableKcal(read, s), 0);
          // (and food held that cannot be eaten as it is: it waits for a fire and water to cook it, S416)
          const uncooked = Math.max(0, foodStores.reduce((a, s) => a + provisions(read, s).kcal, 0) - kcal);
          return { id, name: read.port('workforce').name(id), party: r.party, store: r.store, hungerKcal: Math.round(r.hunger), thirstL: round(r.thirst), dryDays: r.dryDays ?? 0, sleepOwedH: round(r.sleepDebt), health: round(r.health, 2), smell: (() => {
            // what others notice: the sweat since the last wash against what is noticed and what cannot be missed
            const sm = read.data('livingSettings').smell;
            const x = r.sweat ?? 0;
            return !livesHere(read, id) ? 'away' : !sm ? 'not modelled' : x >= sm.strong.value ? 'strong' : x >= sm.noticed.value ? 'noticeable' : 'none';
          })(), unwashedDays: r.unwashedDays ?? 0, sleeps: shelterOf(read, id, rooms).label, tonight: (() => {
            // the night composed: where, in what bedding, how much of it counts, and what takes from it
            const n = shelterOf(read, id, rooms);
            return { quality: round(n.quality, 2), bedding: n.bedding, why: n.why };
          })(), hours: r.sleep ? `${hhmm(r.sleep.bed)}–${hhmm(r.sleep.rise)}` : 'the custom of the place', foodDays: round(kcal / household.energy), waterDays: round(litres / household.water), ...(() => {
            // what they carry (design/physical-state.md 8b), and how far they went short of water away today
            const pack = packOf(read, id);
            const carries = pack ? Object.fromEntries(Object.entries(read.port('holdings').contents(pack)).filter(([, q]) => q > 1e-6).map(([m, q]) => [m, round(q, 2)])) : {};
            return { ...(Object.keys(carries).length ? { carries } : {}), ...(r.today && r.today.short > 1e-3 ? { shortAwayL: round(r.today.short) } : {}) };
          })(), ...(uncooked > household.energy * 0.1 ? { foodDaysIfCooked: round(uncooked / household.energy), cooking: 'the rest of the food is eaten only cooked: it needs something to cook on, its fuel and water' } : {}) };
        });
      },
    },
  },
});
