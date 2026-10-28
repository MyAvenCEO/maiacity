/**
 * Errands (decision 0025): someone goes to a supplier's counter, buys what they can carry and
 * brings it back. They walk the way the network allows a person on foot, beyond the map along the
 * way in, wait for the shop to open if they arrive early, carry the load home more slowly, and are
 * taken up by it all the while. Paid at the counter; in the store when they are back.
 */
import { command, DAY, defineModule, HOUR, s, type EntityId, type Infer, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import { actorOf, partyLabel, wordBlock } from '../../parties/src/index.ts';
import { timetableDay } from '../../network/src/index.ts';
import type {} from '../../workforce/src/index.ts';
import { fillRemedies, isCounted, unitMass } from '../../inventory/src/index.ts';

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * The most of a good a load limit takes: whole pieces; else to a tenth of its unit, finer below one unit (three figures:
 * 25 kg of a good sold by the tonne is 0.025 t, not nothing; review x). One function for every carrier's share.
 */
const mostOf = (mat: Parameters<typeof unitMass>[0], limitKg: number): number => {
  const x = limitKg / unitMass(mat);
  if (isCounted(mat)) return Math.floor(x + 1e-9);
  if (!(x > 0) || !Number.isFinite(x)) return Math.max(0, x);
  const step = Math.min(0.1, 10 ** (Math.floor(Math.log10(x)) - 2));
  return Number((Math.floor(x / step + 1e-9) * step).toPrecision(12));
};

/** how fast a carrier goes beyond the map from a way in: at the speed of that way's surface (as moves reckon it) */
const beyondKmh = (read: ReadCtx, node: EntityId, profile: string): number => {
  const prof = read.port('routing').profile(profile);
  return prof.surfaceSpeed[read.get('NetNode', node)?.external?.surface ?? 'external']?.value ?? prof.maxSpeed.value;
};

/**
 * A service on call (decision 0026 A4, camp C8): a vehicle with its driver, held by another party
 * and booked for a trip (a van with its driver, a taxi). It comes from its base beyond the map when
 * it can, at the price agreed when booked: a call-out, its hours from leaving its base to being back,
 * and its kilometres. On the way it can break down like any firm's vehicle.
 */
export const ServiceSchema = s.object({
  label: s.string(),
  /** what it sends: a carrier class (vehicle profile), with its driver */
  vehicleProfile: s.string(),
  /** its base, this far beyond the way into the map it comes by */
  distance: s.param('km'),
  /** the way into the map it comes by (an access id); absent: the nearest it can use */
  access: s.string().optional(),
  /** how soon after booking it can set off */
  callOut: s.param('h'),
  openFrom: s.param('h'),
  openTo: s.param('h'),
  price: s.object({ fixed: s.param('EUR'), perHour: s.param('EUR/h'), perKm: s.param('EUR/km') }),
});
export type Service = Infer<typeof ServiceSchema>;

declare module '../../kernel/src/index.ts' {
  interface DataTypes {
    services: Record<string, Service>;
  }
}

/** the external way in a service comes by, and the kilometres beyond it to its base */
function serviceWayIn(read: ReadCtx, sv: Service, to: Vec2): { node: EntityId; beyondKm: number } | null {
  const routing = read.port('routing');
  const nodes = sv.access ? [read.state('accesses').built[sv.access]?.node].filter((x): x is EntityId => Boolean(x)) : routing.externalNodes();
  let best: { node: EntityId; beyondKm: number; t: number } | null = null;
  for (const n of nodes) {
    const r = routing.routeFromExternal(n, to, sv.vehicleProfile);
    if (!r) continue;
    const beyondKm = Math.max(0, sv.distance.value - (read.get('NetNode', n)?.external?.distanceKm ?? 0));
    const t = r.duration + (beyondKm / beyondKmh(read, n, sv.vehicleProfile)) * HOUR;
    if (!best || t < best.t) best = { node: n, beyondKm, t };
  }
  return best;
}

/** the first time at or after t within a service's hours */
function withinHours(read: ReadCtx, sv: Service, t: number): number {
  const day = read.calendar.startOfDay(t);
  const open = day + sv.openFrom.value * HOUR;
  const close = day + sv.openTo.value * HOUR;
  return t < open ? open : t >= close ? open + DAY : t;
}

/** the way to a supplier for a carrier (a person on foot, a car): there and back (s, back loaded), and by which way (the supplier on the map, or a way out of it), or why not */
function way(read: ReadCtx, from: Vec2, supplierId: string, profile = read.data('handling')!.errand.profile, unit?: EntityId): { there: number; back: number; via: { pos: Vec2 } | { node: EntityId } } | { why: string } {
  // (who goes: by night their light, S7)
  const who = unit !== undefined ? { unit } : undefined;
  const sup = read.data('suppliers')[supplierId]!;
  const routing = read.port('routing');
  const pace = routing.profile(profile).loadedSpeed?.value ?? 1;
  if (sup.pos) {
    const r = routing.route(from, [sup.pos[0], sup.pos[1]], profile, who);
    return r ? { there: r.duration, back: r.duration / pace, via: { pos: [sup.pos[0], sup.pos[1]] } } : { why: `no way for ${routing.profile(profile).label.toLowerCase()} to ${sup.label}` };
  }
  // beyond the map: by the supplier's own way in, else the quickest a person can walk
  const nodes = sup.access ? [read.state('accesses').built[sup.access]?.node].filter((x): x is EntityId => Boolean(x)) : routing.externalNodes();
  let best: number | null = null;
  let via: EntityId | null = null;
  for (const n of nodes) {
    const r = routing.routeToExternal(from, n, profile, who);
    if (!r) continue;
    // the supplier lies its distance beyond the way in, the way in's own distance is to the next town
    const ext = read.get('NetNode', n)!.external!;
    const extra = Math.max(0, sup.distance.value - ext.distanceKm) / beyondKmh(read, n, profile) * HOUR;
    const t = r.duration + extra;
    if (best === null || t < best) (best = t), (via = n);
  }
  return best === null ? { why: `${sup.label} cannot be reached by ${routing.profile(profile).label.toLowerCase()} from here` } : { there: best, back: best / pace, via: { node: via! } };
}

/** the nearest point at a creek or a pond a person can walk to from a place, and the way there (null: none) */
function nearestWater(read: ReadCtx, from: Vec2): { at: Vec2; kind: string; there: number } | null {
  const h = read.data('handling');
  if (!h) return null;
  const routing = read.port('routing');
  const points = read.port('terrain').waterBodies().flatMap((w) => w.points.map((p) => ({ at: p, kind: w.kind })));
  points.sort((a, b) => Math.hypot(a.at[0] - from[0], a.at[1] - from[1]) - Math.hypot(b.at[0] - from[0], b.at[1] - from[1]));
  for (const p of points.slice(0, 5)) {
    const r = routing.route(from, [p.at[0], p.at[1]], h.errand.profile);
    if (r) return { at: [p.at[0], p.at[1]], kind: p.kind, there: r.duration };
  }
  return null;
}

/**
 * A store as an errand needs it, from the holdings port: whose it is, what it is called and where it is now (one riding
 * with someone or something where they are: never where it was made, S504). Undefined: no such store, or not on the map.
 */
export function placed(read: ReadCtx, id: EntityId): { holder: EntityId; label: string; pos: Vec2 } | undefined {
  const hold = read.port('holdings');
  const pos = hold.where(id);
  const holder = hold.holder(id);
  return pos && holder !== undefined ? { holder, label: hold.label(id) ?? id, pos } : undefined;
}

/** what an errand to a store that is not on the map now says of it (it goes with someone who is away) */
export const unplaced = (read: ReadCtx, id: EntityId) => ({ store: read.port('holdings').label(id) ?? id });

/** fetching on foot as a way to fill a store: one remedy per supplier a person of its holder can walk to */
function provision(read: ReadCtx, store: EntityId, material: string, qty: number): Remedy[] {
  const st = placed(read, store);
  const h = read.hasData('handling') ? read.data('handling') : undefined;
  if (!st || !h) return [];
  const wf = read.port('workforce');
  // (one the word reaches first: else the errand's own refusal says to walk over)
  // (one who can go: well, or ill but on their feet, the strongest first; S420: not the one too ill to walk)
  // (not one held for another purpose: the errand would be refused, decision 0028)
  const ours = [...read.all('Presence')].filter(([id]) => wf.worksFor(id) === st.holder && fitToGo(read, id) > 0 && !wf.heldFrom(id, 'errands', st.holder)).map(([id]) => id).sort((a, b) => fitToGo(read, b) - fitToGo(read, a) || (a < b ? -1 : 1));
  const person = ours.find((id) => !('why' in wf.tell(st.holder, id))) ?? ours[0];
  if (!person) return [];
  const hold = read.port('holdings');
  const mat = hold.material(material);
  // pieces are fetched whole: what is short, rounded up, as much as one carries
  const want = isCounted(mat) ? Math.ceil(qty - 1e-9) : qty;
  const q = Math.min(want, mostOf(mat, h.safeLoad.value * fitToGo(read, person)));
  const out: (Remedy & { hours: number })[] = [];
  // on foot, what one can carry (nothing, for a piece too heavy)
  const later: Remedy[] = [];
  for (const o of q > 0 ? read.port('trade').offers(material) : []) {
    const w = way(read, [st.pos[0], st.pos[1]], o.supplier);
    if ('why' in w) continue;
    // (a shop that opens only hours after one would get there: walked to then)
    const sup = read.data('suppliers')[o.supplier]!;
    const at = atCounter(read, sup, read.now + w.there, h.errand.atCounter.value * HOUR);
    if (at - (read.now + w.there) > SET_OUT_WITHIN) {
      later.push({ label: `Wait until ${busTime(read, at - w.there)}: ${o.supplierLabel} opens ${busTime(read, at)}, ${wf.name(person)} can walk there then for ${q} ${mat.unit} ${mat.label}`, wait: { until: at - w.there } });
      continue;
    }
    out.push({ hours: w.there + w.back, label: `${wf.name(person)} walks to ${o.supplierLabel} for ${q} ${mat.unit} ${mat.label} (about ${round((w.there + w.back) / HOUR + h.errand.atCounter.value)} h there and back, ${(o.price * q).toFixed(2)} €)`, command: { type: 'errands.fetch', payload: { person, material, qty: q, store, supplier: o.supplier } } });
  }
  // the nearest first
  // water as it comes: drawn at the nearest creek or pond, carried home, and not safe untreated
  if (h.drawWater?.material === material) {
    const w = nearestWater(read, [st.pos[0], st.pos[1]]);
    const n = Math.min(qty, Math.floor((h.safeLoad.value * fitToGo(read, person)) / unitMass(mat)));
    if (w && n > 0) {
      const back = w.there / (read.port('routing').profile(h.errand.profile).loadedSpeed?.value ?? 1);
      out.push({ hours: w.there + back, label: `${wf.name(person)} draws ${n} ${mat.unit} at the ${w.kind} (about ${round((w.there + back) / HOUR + h.drawWater.fill.value)} h there and back): untreated, it can make one ill`, command: { type: 'errands.drawWater', payload: { person, store, qty: n } } });
    }
  }
  // by bus, to a shop in town a line goes to (what one can carry)
  for (const o of q > 0 ? read.port('trade').offers(material) : []) {
    const t = busTrip(read, { person, store, supplier: o.supplier, kg: q * unitMass(mat) });
    if ('why' in t) continue;
    if (t.leave - read.now > SET_OUT_WITHIN) {
      later.push({ label: `Wait until ${busTime(read, t.leave)}: ${wf.name(person)} can take the ${busTime(read, t.out)} bus to ${o.supplierLabel} then for ${q} ${mat.unit} ${mat.label} (fare ${t.fare.toFixed(2)} €)`, wait: { until: t.leave } });
      continue;
    }
    out.push({ hours: t.home - read.now, label: `${wf.name(person)} takes the bus to ${o.supplierLabel} for ${q} ${mat.unit} ${mat.label} (the ${busTime(read, t.out)} bus, back about ${busTime(read, t.home)}; fare ${t.fare.toFixed(2)} €, ${(o.price * q).toFixed(2)} € the goods)`, command: { type: 'errands.fetch', payload: { person, material, qty: q, store, supplier: o.supplier, bus: true } } });
  }
  const walks = out.sort((a, b) => a.hours - b.hours).map(({ hours: _, ...r }) => r);
  // a vehicle with its driver, for more than one can carry: each service once, to the nearest shop it can reach
  const hired: Remedy[] = [];
  for (const [id, sv] of Object.entries(read.hasData('services') ? read.data('services') : {})) {
    const most = mostOf(mat, (read.port('routing').profile(sv.vehicleProfile).payload?.value ?? 0) * 1000);
    const n = Math.min(want, most);
    if (n <= q) continue;
    for (const o of read.port('trade').offers(material)) {
      const t = serviceTrip(read, { person, material, qty: n, store, supplier: o.supplier, service: id }, st.holder);
      if ('code' in t) continue;
      hired.push({ label: `Book ${sv.label}: ${wf.name(person)} rides to ${o.supplierLabel} for ${n} ${mat.unit} ${mat.label}, back ${read.calendar.format(t.back)} (${t.price.toFixed(2)} € for the trip, ${(o.price * n).toFixed(2)} € the goods)`, command: { type: 'errands.fetch', payload: { person, material, qty: n, store, supplier: o.supplier, service: id } } });
      break;
    }
  }
  // (what can be done only later: the soonest wait, once)
  const soonest = later.sort((a, b) => (a.wait?.until ?? 0) - (b.wait?.until ?? 0)).slice(0, 1);
  return [...walks, ...hired, ...soonest];
}

export const errandsModule = defineModule({
  id: 'errands',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Employment', 'Helper', 'Machine', 'Move', 'NetNode', 'Party', 'Person', 'Presence'],
  label: 'Errands',
  description: 'Someone walks to a supplier, buys what they can carry at the counter and brings it back.',
  requires: ['holdings', 'trade', 'routing', 'moves', 'equipment', 'workforce', 'prices', 'parties', 'terrain'],
  blockers: {
    'errands.notOurs': '{person} does not work for {party}',
    'errands.notHere': '{person} is not here to go ({status})',
    'errands.notThere': 'Not {what} free in {store} to be taken',
    'errands.onTheWay': '{person} is on the way somewhere until {until}',
    'errands.held': '{person} is held for {purpose} until {until}',
    'errands.notTold': 'The word does not reach {person}: {why}',
    'errands.noWord': 'We cannot book {service}: {why}',
    'errands.tooHeavy': '{qty} {unit} of {material} weigh {kg} kg: one person carries {load} kg at most',
    'errands.tooHeavyFor': '{qty} {unit} of {material} weigh {kg} kg: the {vehicle} takes {load} kg at most',
    'errands.notOurVehicle': '{vehicle} is not a vehicle of {party}',
    'errands.notAVehicle': 'A {vehicle} does not drive on the roads',
    'errands.vehicleBusy': 'The {vehicle} is not free ({status})',
    'errands.noFuel': 'The {vehicle} has {have} l in the tank: the trip needs {need} l',
    'errands.noWay': '{why}',
    'errands.notSold': '{supplier} does not sell {material}',
    'errands.notOurStore': '{store} is not a store of {party}',
    'errands.nowhere': '{store} is not on the map now: it goes with one who is away',
    'errands.unknownService': 'No service {service} here',
    'errands.noWater': 'No water to draw: {why}',
    'errands.wholePieces': '{material} goes in whole pieces, not {qty}',
    'errands.noBus': 'No bus to {supplier}: {why}',
    'errands.notYet': '{what}: set out {when}, not hours before (order it then)',
    'errands.noFunds': 'Not enough liquidity for {what}: {cost} EUR (available {liquidity} EUR)',
    'errands.serviceNoWay': '{service} cannot come here: {why}',
  },
  events: {
    'errands.legalExposure': s.object({ person: s.ref('person'), party: s.ref('party'), what: s.string(), rule: s.string() }),
  },
  data: { services: s.record(ServiceSchema).optional() },
  contributes: {
    provision: () => provision,
  },
  commands: {
    'errands.drawWater': command(
      s.object({ person: s.ref('person'), store: s.ref('store'), qty: s.number({ min: 0 }), party: s.ref('party').optional(), routine: s.boolean().optional() }),
      (ctx, p) => {
        const party = errandParty(ctx, p);
        const wf = ctx.port('workforce');
        const name = wf.name(p.person);
        if (!ourPerson(ctx, p.person, party)) ctx.reject('errands.notOurs', { person: name, party: partyLabel(ctx, party) });
        const share = mustGo(ctx, p.person, name, p.routine === true && ctx.caller !== 'client');
        const store = placed(ctx, p.store) ?? ctx.reject('errands.nowhere', unplaced(ctx, p.store));
        if (store.holder !== party) ctx.reject('errands.notOurStore', { store: store.label, party: partyLabel(ctx, party) });
        const h = ctx.data('handling')!;
        if (!h.drawWater) ctx.reject('errands.noWater', { why: 'water cannot be drawn in this world' });
        const home: Vec2 = [store.pos[0], store.pos[1]];
        const w = nearestWater(ctx, home);
        if (!w) ctx.reject('errands.noWater', { why: `no creek or pond a person can walk to from ${store.label}` });
        // (the good it is, by the water it is drawn from: a pond's is not a creek's)
        const material = h.drawWater!.bySource?.[w!.kind] ?? h.drawWater!.material;
        const mat = ctx.port('holdings').material(material);
        const kg = p.qty * unitMass(mat);
        // (what this body carries now: an ill one less)
        const load = h.safeLoad.value * share;
        if (kg > load + 1e-9) {
          const most = mostOf(mat, load);
          ctx.reject('errands.tooHeavy', { qty: p.qty, unit: mat.unit, material: mat.label, kg: round(kg), load: Math.round(load) }, most > 0 ? [{ label: `Draw ${most} ${mat.unit}`, command: { type: 'errands.drawWater', payload: { ...p, qty: most } } }] : []);
        }
        const from = setOutFrom(ctx, p.person, name, party, p.routine === true && ctx.caller !== 'client');
        // the walk is a move: out empty, the canisters filled at the bank, back loaded; in the store when they are
        const walker = { class: h.errand.profile, unit: p.person };
        const water = { goods: { material, qty: p.qty, unit: mat.unit, holder: party, mass: kg / 1000 } };
        // (to the water from where they are: r36)
        const there = ctx.port('routing').route(from, w!.at, h.errand.profile, { unit: p.person })?.duration ?? w!.there;
        const filled = ctx.now + there + h.drawWater!.fill.value * HOUR;
        const trip = ctx.command('moves.dispatch', {
          legs: [
            { carrier: walker, from, to: w!.at, loads: [] },
            { carrier: walker, from: w!.at, to: home, loads: [water], notBefore: filled },
          ],
          // drawn from the creek: it enters the world's goods when it is in the store (a source, in the flows)
          purpose: 'drawn',
          ref: p.store,
          requester: 'inventory',
        });
        if (!trip.ok) ctx.reject(trip.reasons[0]!.code, trip.reasons[0]!.params);
        const back = filled + (ctx.port('routing').route(w!.at, home, h.errand.profile, { unit: p.person })?.duration ?? w!.there) / (ctx.port('routing').profile(h.errand.profile).loadedSpeed?.value ?? 1);
        return { back };
      },
      { label: 'Draw water at a creek or a pond', description: 'Someone walks to the nearest creek or pond, fills what one person can carry and carries it back into a store. It is water as it comes: drinking it untreated can make one ill (a water filter in the store removes most of that). They are away the whole time.' },
    ),
    'errands.carry': command(
      s.object({ person: s.ref('person'), from: s.ref('store'), to: s.ref('store'), material: s.string(), qty: s.number({ min: 0 }), party: s.ref('party').optional(), routine: s.boolean().optional() }),
      (ctx, p) => {
        // our own goods from one of our stores to another, by one of ours on foot: there empty, back with what one carries
        // (design/realism-plan.md S2, review #2 and #5: an errand in their own time, not a work in the shift's hours)
        const party = errandParty(ctx, p);
        const wf = ctx.port('workforce');
        const name = wf.name(p.person);
        if (!ourPerson(ctx, p.person, party)) ctx.reject('errands.notOurs', { person: name, party: partyLabel(ctx, party) });
        const share = mustGo(ctx, p.person, name, p.routine === true && ctx.caller !== 'client');
        const A = placed(ctx, p.from) ?? ctx.reject('errands.nowhere', unplaced(ctx, p.from));
        const B = placed(ctx, p.to) ?? ctx.reject('errands.nowhere', unplaced(ctx, p.to));
        for (const st of [A, B]) if (st.holder !== party) ctx.reject('errands.notOurStore', { store: st.label, party: partyLabel(ctx, party) });
        const hold = ctx.port('holdings');
        const mat = hold.material(p.material);
        if (isCounted(mat) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) ctx.reject('errands.wholePieces', { material: mat.label, qty: p.qty });
        const h = ctx.data('handling')!;
        const kg = p.qty * unitMass(mat);
        const load = h.safeLoad.value * share;
        if (kg > load + 1e-9) {
          const most = mostOf(mat, load);
          ctx.reject('errands.tooHeavy', { qty: p.qty, unit: mat.unit, material: mat.label, kg: round(kg), load: Math.round(load) }, most > 0 ? [{ label: `Carry ${most} ${mat.unit}`, command: { type: 'errands.carry', payload: { ...p, qty: most } } }] : []);
        }
        if (hold.free(p.from, p.material) + 1e-9 < p.qty) ctx.reject('errands.notThere', { what: `${p.qty} ${mat.unit} ${mat.label}`, store: A.label });
        const start = setOutFrom(ctx, p.person, name, party, p.routine === true && ctx.caller !== 'client');
        const walker = { class: h.errand.profile, unit: p.person };
        const goods = { goods: { material: p.material, qty: p.qty, unit: mat.unit, holder: party, mass: kg / 1000 } };
        const a: Vec2 = [A.pos[0], A.pos[1]];
        const b: Vec2 = [B.pos[0], B.pos[1]];
        const trip = ctx.command('moves.dispatch', { legs: [{ carrier: walker, from: start, to: a, loads: [] }, { carrier: walker, from: a, to: b, loads: [goods] }], purpose: 'transfer', ref: p.to, requester: 'inventory' });
        if (!trip.ok) return ctx.reject(trip.reasons[0]!.code, trip.reasons[0]!.params);
        // (claimed for them now, taken up when they are there: r37)
        ctx.command('inventory.pickup', { move: trip.value, store: p.from, material: p.material, qty: p.qty, leg: 0 });
        return { back: ctx.get('Move', trip.value)?.legs.at(-1)?.arrive ?? ctx.now };
      },
      { label: 'Carry our goods from one of our stores to another', description: 'Someone of ours walks to a store of ours, takes up what one person carries and carries it to another store. They are away the whole time.' },
    ),
    'errands.goToTown': command(
      s.object({ person: s.ref('person'), hours: s.number({ min: 0, max: 12 }).optional() }),
      (ctx, p) => {
        const party = actorOf(ctx);
        const wf = ctx.port('workforce');
        const name = wf.name(p.person);
        if (!ourPerson(ctx, p.person, party)) ctx.reject('errands.notOurs', { person: name, party: partyLabel(ctx, party) });
        mustGo(ctx, p.person, name);
        const from0 = setOutFrom(ctx, p.person, name, party);
        const h = ctx.data('handling')!;
        const routing = ctx.port('routing');
        const profile = h.errand.profile;
        // (the nearest town beyond a way out a person walks: its own distance beyond the map is walked too)
        let best: { node: EntityId; there: number; beyondKm: number } | undefined;
        for (const n of routing.externalNodes()) {
          const r = routing.routeToExternal(from0, n, profile);
          const ext = ctx.get('NetNode', n)?.external;
          if (!r || !ext) continue;
          const beyondS = (ext.distanceKm / beyondKmh(ctx, n, profile)) * HOUR;
          if (!best || r.duration + beyondS < best.there) best = { node: n, there: r.duration + beyondS, beyondKm: ext.distanceKm };
        }
        if (!best) ctx.reject('errands.noWay', { why: `no way on foot out of the map from where ${name} is` });
        const leaves = ctx.now + best!.there + (p.hours ?? 1) * HOUR;
        const walker = { class: profile, unit: p.person };
        const trip = ctx.command('moves.dispatch', {
          legs: [
            { carrier: walker, from: from0, to: from0, externalDestination: best!.node, beyondKm: best!.beyondKm, loads: [] },
            { carrier: walker, from: from0, to: from0, externalNode: best!.node, beyondKm: best!.beyondKm, loads: [], notBefore: leaves },
          ],
          purpose: 'errand',
          ref: p.person,
          requester: 'inventory',
        });
        if (!trip.ok) ctx.reject(trip.reasons[0]!.code, trip.reasons[0]!.params);
        ctx.log('info', `${name} walks into town (back about ${ctx.calendar.format(leaves + best!.there, 'time')}): from there our word gets out, and the phone is charged as long as they stay.`, [p.person]);
        return { back: leaves + best!.there };
      },
      { label: 'Go into town', description: 'Someone walks out of the map to the next town and back, staying `hours` (1 by default): while there they can phone, write and see people (our word gets out), and their phone is charged for as long as they stay (a flat one takes some 2 hours).' },
    ),
    'errands.fetch': command(
      s.object({ person: s.ref('person'), material: s.string(), qty: s.number({ min: 0 }), store: s.ref('store'), supplier: s.string(), vehicle: s.ref('machine').optional(), service: s.string().optional(), bus: s.boolean().optional(), party: s.ref('party').optional(), routine: s.boolean().optional() }),
      (ctx, p) => {
        if (p.service) return byService(ctx, p as typeof p & { service: string });
        if (p.bus) return byBus(ctx, p);
        const party = errandParty(ctx, p);
        const wf = ctx.port('workforce');
        const name = wf.name(p.person);
        if (!ourPerson(ctx, p.person, party)) ctx.reject('errands.notOurs', { person: name, party: partyLabel(ctx, party) });
        const share = mustGo(ctx, p.person, name, p.routine === true && ctx.caller !== 'client');
        const store = placed(ctx, p.store) ?? ctx.reject('errands.nowhere', unplaced(ctx, p.store));
        if (store.holder !== party) ctx.reject('errands.notOurStore', { store: store.label, party: partyLabel(ctx, party) });
        const sup = ctx.data('suppliers')[p.supplier];
        const mat = ctx.port('holdings').material(p.material);
        if (!sup || !sup.offers[p.material]) ctx.reject('errands.notSold', { supplier: sup?.label ?? p.supplier, material: mat.label });
        // pieces are bought and carried whole
        if (isCounted(mat) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) ctx.reject('errands.wholePieces', { material: mat.label, qty: p.qty });
        const h = ctx.data('handling')!;
        const routing = ctx.port('routing');
        const home0: Vec2 = [store.pos[0], store.pos[1]];
        // (they set out from where they are; what they bring goes into the store)
        const from0 = setOutFrom(ctx, p.person, name, party, p.routine === true && ctx.caller !== 'client');
        // on foot, or by one of our vehicles (decision 0026 A3: an errand is a composed move)
        const eq = ctx.port('equipment');
        const car = p.vehicle ? ctx.get('Machine', p.vehicle) : undefined;
        // (ours to use: ours and not lent out, or lent to us)
        if (p.vehicle && (!car || !eq.usableBy(p.vehicle, party))) ctx.reject('errands.notOurVehicle', { vehicle: p.vehicle, party: partyLabel(ctx, party) });
        const md = car ? eq.modelOf(p.vehicle!) : undefined;
        // only a road vehicle itself: a chainsaw's transport block says how it is carried, not that it carries
        if (md && (ctx.data('equipmentClasses')[md.class]?.kind !== 'vehicle' || !md.transport || !md.payload)) ctx.reject('errands.notAVehicle', { vehicle: md.label });
        if (car && car.status !== 'ready') ctx.reject('errands.vehicleBusy', { vehicle: md!.label, status: car.status });
        if (car && eq.withRider(p.vehicle!)) ctx.reject('errands.vehicleBusy', { vehicle: md!.label, status: 'away with the one who rides it to work' });
        if (car?.listing?.buyer) ctx.reject('errands.vehicleBusy', { vehicle: md!.label, status: `promised to ${car.listing.buyer}` });
        const profile = md ? md.transport!.vehicleProfile : h.errand.profile;
        // what one can carry: one person's safe load, or the vehicle's payload
        const kg = p.qty * unitMass(mat);
        const limitKg = md ? md.payload!.value * 1000 : h.safeLoad.value * share;
        if (kg > limitKg + 1e-9) {
          const most = mostOf(mat, limitKg);
          ctx.reject(md ? 'errands.tooHeavyFor' : 'errands.tooHeavy', { qty: p.qty, unit: mat.unit, material: mat.label, kg: round(kg), load: Math.round(limitKg), vehicle: md?.label ?? '' }, most > 0 ? [{ label: `Fetch ${most} ${mat.unit}`, command: { type: 'errands.fetch', payload: { ...p, qty: most } } }] : []);
        }
        // to the car first, if it is not where they are
        const reach = h.reach.value;
        const carAt: Vec2 | undefined = car ? ctx.port('equipment').positionAt(p.vehicle!, ctx.now) : undefined;
        const toCar = carAt && Math.hypot(carAt[0] - from0[0], carAt[1] - from0[1]) > reach ? routing.route(from0, carAt, h.errand.profile, { unit: p.person }) : null;
        if (carAt && Math.hypot(carAt[0] - from0[0], carAt[1] - from0[1]) > reach && !toCar) ctx.reject('errands.noWay', { why: `no way on foot to the ${md!.label}` });
        const startAt = carAt ?? from0;
        const w = way(ctx, startAt, p.supplier, profile, car ? p.vehicle! : p.person);
        if ('why' in w) ctx.reject('errands.noWay', { why: w.why });
        const { there, via } = w as { there: number; back: number; via: { pos: Vec2 } | { node: EntityId } };
        // at the counter in opening hours: wait for it to open if early
        // (on a day it is open: shops are closed on Sundays)
        const arrive = ctx.now + (toCar?.duration ?? 0) + there;
        const at = atCounter(ctx, sup!, arrive, h.errand.atCounter.value * HOUR);
        // (not hours at a closed door: set out when it opens)
        if (at - arrive > SET_OUT_WITHIN) ctx.reject('errands.notYet', { what: `${sup!.label} opens ${busTime(ctx, at)}`, when: busTime(ctx, at - (arrive - ctx.now)) }, [{ label: `Wait until ${busTime(ctx, at - (arrive - ctx.now))}`, wait: { until: at - (arrive - ctx.now) } }]);
        // the way back, loaded, ends at the store (the car parks by it); the part of the way beyond the map
        // (to the shop past the next town) is driven or walked in the legs, at top speed (A3 review: no free km)
        const pace = routing.profile(profile).loadedSpeed?.value ?? 1;
        const rider = { unit: car ? p.vehicle! : p.person };
        const backRoute = 'node' in via ? routing.routeFromExternal(via.node, home0, profile, rider) : routing.route(via.pos, home0, profile, rider);
        if (!backRoute) ctx.reject('errands.noWay', { why: `no way back to ${store.label}` });
        const outRoute = 'node' in via ? routing.routeToExternal(startAt, via.node, profile, rider) : routing.route(startAt, via.pos, profile, rider);
        const beyondKm = 'node' in via ? Math.max(0, sup!.distance.value - (ctx.get('NetNode', via.node)?.external?.distanceKm ?? sup!.distance.value)) : 0;
        const beyondS = 'node' in via ? (beyondKm / beyondKmh(ctx, via.node, profile)) * HOUR : 0;
        const leaves = at + h.errand.atCounter.value * HOUR;
        const unload = ctx.port('moves').unloadTime(profile, kg / 1000);
        const home = leaves + (backRoute!.duration + beyondS) / pace + (md ? unload : 0);
        // a car needs the fuel for the trip in its tank (decision 0002: nothing drives for free)
        if (md?.engine) {
          const hours = ((outRoute?.duration ?? 0) + beyondS + (backRoute!.duration + beyondS) / pace) / HOUR;
          const need = (md.engine.fuelUse.value) * hours;
          const inTank = ctx.port('equipment').fuel(p.vehicle!);
          if (inTank + 1e-9 < need) {
            const fuel = md.engine.fuel ?? 'diesel';
            ctx.reject('errands.noFuel', { vehicle: md.label, need: round(need), have: round(inTank) }, fillRemedies(ctx, p.store, fuel, Math.ceil(need - inTank)));
          }
          // driving without the licence: allowed, and a legal exposure (decision 0025: the law answers, it does not refuse)
          if (md.operatorQualification && !wf.canDo(p.person, md.operatorQualification)) ctx.emit('errands.legalExposure', { person: p.person, party, what: `driving the ${md.label} without a licence`, rule: wf.qualification(md.operatorQualification).label });
        }
        const bought = ctx.command('inventory.buyAtCounter', { store: p.store, material: p.material, qty: p.qty, supplier: p.supplier, arrives: home, carrier: name });
        if (!bought.ok) ctx.reject(bought.reasons[0]!.code, bought.reasons[0]!.params);
        // the errand is a move: out empty, a stop beyond the map or at the shop (the rest of the way, the opening hours, the counter), back loaded
        const walker = { class: h.errand.profile, unit: p.person };
        const carrier = md ? { class: profile, unit: p.vehicle! } : walker;
        const goods = { goods: { material: p.material, qty: p.qty, unit: mat.unit, holder: party, mass: kg / 1000 } };
        const by = md ? { inCharge: p.person } : {};
        const legs = [
          ...(toCar ? [{ carrier: walker, from: from0, to: carAt!, loads: [] }] : []),
          { carrier, from: startAt, to: 'pos' in via ? via.pos : startAt, ...('node' in via ? { externalDestination: via.node, beyondKm } : {}), loads: [], ...by },
          { carrier, from: 'pos' in via ? via.pos : home0, to: home0, ...('node' in via ? { externalNode: via.node, beyondKm } : {}), loads: [goods], notBefore: leaves, ...by },
        ];
        const trip = ctx.command('moves.dispatch', { legs, purpose: 'carried', ref: bought.ok ? bought.value.order : '', requester: 'inventory' });
        if (!trip.ok) ctx.reject(trip.reasons[0]!.code, trip.reasons[0]!.params);
        if (car && trip.ok) {
          const out = ctx.command('equipment.takeOut', { machine: p.vehicle!, move: trip.value, to: home0, until: home });
          if (!out.ok) ctx.reject(out.reasons[0]!.code, out.reasons[0]!.params);
        }
        return { order: bought.ok ? bought.value.order : '', back: home };
      },
      { label: 'Fetch from a shop', description: 'Someone goes to a supplier (beyond the map along a way they can use, or on the map), buys at the counter and brings it back into a store: on foot, what one person can carry; with `vehicle` (one of ours, e.g. a car), what it can take, driving it there and back (fuel from its tank; without a licence it is a legal exposure); with `bus`, to a shop in a town a bus line goes to: walking to the stop, by the timetable there and back the same day, what one can carry (the fare paid, none with a pass). They are away the whole time; shops keep their hours.' },
    ),
  },
});

/**
 * How long before it sets out an errand may be ordered: someone is taken up from the order on, so an errand
 * for a bus or a shop hours away waits to be ordered (a rule of play, not of the world)
 */
const SET_OUT_WITHIN = 2 * HOUR;

/** a time of day, with its day when it is not today's */
const busTime = (read: ReadCtx, t: number): string => (read.calendar.startOfDay(t) === read.calendar.startOfDay(read.now) ? read.calendar.format(t, 'time') : read.calendar.format(t));

/** whether a supplier's counter is open on the day of t (none said: the usual week's, `supplierWeek.counter`) */
const counterDay = (read: ReadCtx, sup: { openDays?: number[] }, t: number): boolean => (sup.openDays ?? read.data('supplierWeek').counter).includes(read.calendar.at(read.calendar.startOfDay(t) + HOUR).weekday) && !read.port('workforce').holiday(read.calendar.startOfDay(t) + HOUR);

/** the earliest time from t at the counter of a supplier that leaves the time at the counter before it closes, on a day it is open */
function atCounter(read: ReadCtx, sup: { openDays?: number[]; openFrom: { value: number }; openTo: { value: number } }, t: number, counter: number): number {
  let at = t;
  for (let i = 0; i < 14; i += 1) {
    const day = read.calendar.startOfDay(at);
    const open = day + sup.openFrom.value * HOUR;
    const close = day + sup.openTo.value * HOUR;
    if (counterDay(read, sup, day) && at + counter <= close) return Math.max(at, open);
    at = day + DAY;
  }
  return at;
}

/** the departures of a timetable from a time on (today's and the next days'), in order */
function departures(read: ReadCtx, times: { weekday: number[]; saturday: number[]; sunday: number[] }, from: number, days = 7): number[] {
  const out: number[] = [];
  for (let d = 0; d <= days; d += 1) {
    const day0 = read.calendar.startOfDay(from) + d * DAY;
    const kind = timetableDay(read, day0 + HOUR, Boolean(read.port('workforce').holiday(day0 + HOUR)));
    if (!kind) continue;
    for (const h of [...times[kind]].sort((a, b) => a - b)) if (day0 + h * HOUR >= from) out.push(day0 + h * HOUR);
  }
  return out;
}

/**
 * A shopping trip by bus (A4): from the store on foot to the line's stop at the way in, the first bus into
 * town that reaches the shop in its hours with a bus back the same day, the counter, the bus back, and home
 * on foot with the goods; the fare (none with a pass); or why not
 */
function busTrip(read: ReadCtx, p: { person: EntityId; store: EntityId; supplier: string; kg: number; from?: Vec2 }): { line: string; label: string; stop: Vec2; leave: number; atStop: number; out: number; atShop: number; back: number; atStopBack: number; home: number; fare: number } | { why: string } {
  const sup = read.data('suppliers')[p.supplier];
  if (!sup?.transit) return { why: 'it is not in a town a bus goes to' };
  const line = read.hasData('transitLines') ? read.data('transitLines')?.[sup.transit.line] : undefined;
  const stop = line ? read.state('accesses').built[line.access]?.point : undefined;
  if (!line || !stop) return { why: 'no such bus here' };
  const h = read.data('handling')!;
  const routing = read.port('routing');
  const at = read.port('holdings').where(p.store);
  if (!at) return { why: `${read.port('holdings').label(p.store) ?? p.store} is not on the map now` };
  const home: Vec2 = [at[0], at[1]];
  // (to the stop from where they set out; back from it to the store: r36)
  const to = routing.route(p.from ?? home, [stop[0], stop[1]], h.errand.profile, { unit: p.person });
  const fromStop = p.from ? routing.route([stop[0], stop[1]], home, h.errand.profile, { unit: p.person }) : to;
  if (!to || !fromStop) return { why: 'no way on foot to the stop' };
  const pace = routing.profile(h.errand.profile).loadedSpeed?.value ?? 1;
  const ride = line.minutes.value * 60;
  const walk = sup.transit.walk.value * 60;
  const counter = h.errand.atCounter.value * HOUR;
  const atStop = read.now + to.duration;
  const deps = departures(read, line.toTown, atStop);
  for (const [i, out] of deps.entries()) {
    const day = read.calendar.startOfDay(out);
    const open = day + sup.openFrom.value * HOUR;
    const close = day + sup.openTo.value * HOUR;
    if (!counterDay(read, sup, day)) continue;
    // (not one so early a later bus is there by the opening just as well)
    const next = deps[i + 1];
    if (next !== undefined && read.calendar.startOfDay(next) === day && next + ride + walk <= open) continue;
    const atShop = Math.max(out + ride + walk, open);
    if (atShop + counter > close) continue;
    // a bus back the same day
    const back = departures(read, line.fromTown, atShop + counter + walk, 0).find((t) => t < day + DAY);
    if (back === undefined) continue;
    const single = read.hasData('transitFares') ? read.data('transitFares')?.[sup.transit.line]?.single.value : undefined;
    if (single === undefined) return { why: 'no fare known for the line' };
    const pass = read.hasPort('agreements') ? read.port('agreements').permitting(null, p.person, 'transit') : undefined;
    const fare = pass ? 0 : 2 * single * read.port('prices').index(read.now);
    const atStopBack = back + ride;
    // (they set out in time for that bus, not before)
    return { line: sup.transit.line, label: line.label, stop: [stop[0], stop[1]], leave: Math.max(read.now, out - to.duration), atStop, out, atShop, back, atStopBack, home: atStopBack + fromStop.duration / pace, fare };
  }
  return { why: 'no bus gets there in its hours and back the same day within a week' };
}

/**
 * Whether someone can set out on an errand, and the share of a well person's load they carry: an illness keeps one from
 * work, not from fetching one's own water and food; only one too weak to walk stays (illness by degrees, VISION; the
 * five friends died of thirst with everyone ill)
 */
function fitToGo(read: ReadCtx, person: EntityId, own = false): number {
  const status = read.get('Presence', person)?.status ?? 'gone';
  const body = read.contributions('bodyCarries').map((c) => c.impl(read, person)).find((x) => x !== null && x !== undefined);
  if (status === 'available') return body?.share ?? 1;
  // (released from work, on short time or on leave: not at the employer's call, but free to see to their own needs where
  // they live: Qwen S507, a dismissed resident barred from fetching food for themselves)
  if (own && (status === 'released' || status === 'shortTime' || status === 'vacation')) return body?.share ?? 1;
  if (status === 'sick') return body?.share ?? 0;
  return 0;
}

/** refused unless they can go: the share of a load they carry */
function mustGo(ctx: WriteCtx, person: EntityId, name: string, own = false): number {
  const status = ctx.get('Presence', person)?.status ?? 'gone';
  const share = fitToGo(ctx, person, own);
  if (!(share > 0)) ctx.reject('errands.notHere', { person: name, status: status === 'sick' ? 'ill and too weak to walk' : status });
  return share;
}

/** where someone setting out is: on the map and on no other move (design/physical-state.md I2, I4) */
/**
 * Whose errand it is: the player's party; a household's own routine (needs: design/realism-plan.md S2) names its party,
 * which only the simulation may do
 */
function errandParty(ctx: WriteCtx, p: { party?: EntityId }): EntityId {
  return p.party !== undefined && ctx.caller !== 'client' ? p.party : actorOf(ctx);
}

/** one of ours to send: who works for us, or one of the household, though they have a job elsewhere (in their own time) */
function ourPerson(read: ReadCtx, person: EntityId, party: EntityId): boolean {
  return read.port('workforce').worksFor(person) === party || read.get('Helper', person)?.of === party;
}

function setOutFrom(ctx: WriteCtx, person: EntityId, name: string, party = actorOf(ctx), routine = false): Vec2 {
  const moves = ctx.port('moves');
  const on = moves.placeOf(person)?.on;
  if (on !== undefined && ctx.has('Move', on)) {
    const back = ctx.require('Move', on).legs.at(-1)!.arrive;
    ctx.reject('errands.onTheWay', { person: name, until: ctx.calendar.format(back) }, [{ label: `Wait until ${ctx.calendar.format(back, 'time')}`, wait: { until: back } }]);
  }
  const at = moves.where(person);
  if (!at) ctx.reject('errands.notHere', { person: name, status: 'beyond the map' });
  // (their time taken through its one owner: refused while held for another purpose (waiting at the road for a driver),
  // with when they are free; a hold at our own word gives way to it. Decision 0028; review x)
  const took = ctx.command('workforce.take', { person, party });
  if (!took.ok) ctx.reject('errands.held', took.reasons[0]?.params ?? { person: name, purpose: 'something else', until: '' }, took.reasons[0]?.remedies ?? []);
  // (and the word to go reaches them: design/physical-state.md I9; one who goes of their own accord needs no word)
  const told = routine ? { how: 'self' as const } : ctx.port('workforce').tell(party, person);
  if ('why' in told) ctx.reject('errands.notTold', { person: name, why: told.why }, told.walk ? [{ label: `Walk over to ${name}`, command: { type: 'workforce.goTo', payload: { person } } }] : []);
  return [at[0], at[1]];
}

function byBus(ctx: WriteCtx, p: { person: EntityId; material: string; qty: number; store: EntityId; supplier: string }) {
  const party = actorOf(ctx);
  const wf = ctx.port('workforce');
  const name = wf.name(p.person);
  if (wf.worksFor(p.person) !== party) ctx.reject('errands.notOurs', { person: name, party: partyLabel(ctx, party) });
  const share = mustGo(ctx, p.person, name);
  const store = placed(ctx, p.store) ?? ctx.reject('errands.nowhere', unplaced(ctx, p.store));
  if (store.holder !== party) ctx.reject('errands.notOurStore', { store: store.label, party: partyLabel(ctx, party) });
  const sup = ctx.data('suppliers')[p.supplier];
  const mat = ctx.port('holdings').material(p.material);
  if (!sup || !sup.offers[p.material]) ctx.reject('errands.notSold', { supplier: sup?.label ?? p.supplier, material: mat.label });
  if (isCounted(mat) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) ctx.reject('errands.wholePieces', { material: mat.label, qty: p.qty });
  const h = ctx.data('handling')!;
  const kg = p.qty * unitMass(mat);
  const load = h.safeLoad.value * share;
  if (kg > load + 1e-9) {
    const most = mostOf(mat, load);
    ctx.reject('errands.tooHeavy', { qty: p.qty, unit: mat.unit, material: mat.label, kg: round(kg), load: Math.round(load), vehicle: '' }, most > 0 ? [{ label: `Fetch ${most} ${mat.unit}`, command: { type: 'errands.fetch', payload: { ...p, qty: most, bus: true } } }] : []);
  }
  // (the bus they can catch from where they are)
  const from0 = setOutFrom(ctx, p.person, name);
  const t = busTrip(ctx, { person: p.person, store: p.store, supplier: p.supplier, kg, from: from0 });
  if ('why' in t) return ctx.reject('errands.noBus', { supplier: sup!.label, why: t.why });
  if (t.leave - ctx.now > SET_OUT_WITHIN) return ctx.reject('errands.notYet', { what: `the ${busTime(ctx, t.out)} bus to ${sup!.label}`, when: busTime(ctx, t.leave) }, [{ label: `Wait until ${busTime(ctx, t.leave)}`, wait: { until: t.leave } }]);
  // the fare out of the purse now (none with a pass)
  if (t.fare > 0 && !ctx.port('prices').canSpend(party, t.fare)) ctx.reject('errands.noFunds', { what: `the bus fare there and back`, cost: round(t.fare), liquidity: round(ctx.port('prices').liquidity(party)) });
  if (t.fare > 0) ctx.ledger.post({ from: acct(party, ACCOUNTS.cash), to: acct(party, ACCOUNTS.transport), amount: Math.round(t.fare * 100) / 100, memo: `${name}: bus to ${sup!.label} and back (${t.label})`, category: ACCOUNTS.transport, refs: [p.person] });
  const bought = ctx.command('inventory.buyAtCounter', { store: p.store, material: p.material, qty: p.qty, supplier: p.supplier, arrives: t.home, carrier: name });
  if (!bought.ok) ctx.reject(bought.reasons[0]!.code, bought.reasons[0]!.params);
  // on the map it is a move on foot: to the stop, and from it home with the goods once the bus is back
  const home0: Vec2 = [store.pos[0], store.pos[1]];
  const walker = { class: h.errand.profile, unit: p.person };
  const goods = { goods: { material: p.material, qty: p.qty, unit: mat.unit, holder: party, mass: kg / 1000 } };
  const trip = ctx.command('moves.dispatch', { legs: [{ carrier: walker, from: from0, to: t.stop, loads: [], notBefore: t.leave }, { carrier: walker, from: t.stop, to: home0, loads: [goods], notBefore: t.atStopBack }], purpose: 'carried', ref: bought.ok ? bought.value.order : '', requester: 'inventory' });
  if (!trip.ok) ctx.reject(trip.reasons[0]!.code, trip.reasons[0]!.params);
  // (taken up from now: they get ready and set out for the bus)
  return { order: bought.ok ? bought.value.order : '', back: t.home };
}

/** a service trip reckoned before it is booked: when it sets off, when the person is back, its legs and the price agreed (or why it cannot be) */
interface ServiceTrip {
  sv: Service;
  sets: number;
  back: number;
  price: number;
  hours: number;
  km: number;
  legs: unknown[];
  /** the way home to its base */
  home: { externalDestination: EntityId; beyondKm: number };
}

function serviceTrip(read: ReadCtx, p: { person: EntityId; material: string; qty: number; store: EntityId; supplier: string; service: string }, party: EntityId): ServiceTrip | { code: string; params: Record<string, string | number>; remedies?: Remedy[] } {
  const sv = read.hasData('services') ? read.data('services')[p.service] : undefined;
  if (!sv) return { code: 'errands.unknownService', params: { service: p.service } };
  // (a trip booked is word to the firm: by an office, a phone with charge, one of ours beyond the map, S4)
  const noWord = wordBlock(read, party);
  if (noWord) return { code: 'errands.noWord', params: { service: sv.label, why: noWord.why }, remedies: noWord.remedies };
  const sup = read.data('suppliers')[p.supplier];
  const mat = read.port('holdings').material(p.material);
  if (!sup || !sup.offers[p.material]) return { code: 'errands.notSold', params: { supplier: sup?.label ?? p.supplier, material: mat.label } };
  const store = placed(read, p.store);
  if (!store) return { code: 'errands.nowhere', params: unplaced(read, p.store) };
  const routing = read.port('routing');
  const profile = routing.profile(sv.vehicleProfile);
  const kg = p.qty * unitMass(mat);
  const limitKg = (profile.payload?.value ?? 0) * 1000;
  if (kg > limitKg + 1e-9) {
    const most = mostOf(mat, limitKg);
    return { code: 'errands.tooHeavyFor', params: { qty: p.qty, unit: mat.unit, material: mat.label, kg: round(kg), load: Math.round(limitKg), vehicle: profile.label }, remedies: most > 0 ? [{ label: `Fetch ${most} ${mat.unit}`, command: { type: 'errands.fetch', payload: { ...p, qty: most } } }] : [] };
  }
  // the vehicle comes to the store itself (where it cannot, it is refused: carrying in from the kerb is not offered yet)
  const stop: Vec2 = [store.pos[0], store.pos[1]];
  const came = serviceWayIn(read, sv, stop);
  if (!came) return { code: 'errands.serviceNoWay', params: { service: sv.label, why: `no way to ${store.label} for a ${profile.label.toLowerCase()}` } };
  const w = way(read, stop, p.supplier, sv.vehicleProfile);
  if ('why' in w) return { code: 'errands.serviceNoWay', params: { service: sv.label, why: w.why } };
  const { via } = w;
  const h = read.data('handling')!;
  // when it can set off, within its hours; at the shop within the shop's
  const sets = withinHours(read, sv, read.now + sv.callOut.value * HOUR);
  const toUs = routing.routeFromExternal(came.node, stop, sv.vehicleProfile)!;
  const beyondUs = (came.beyondKm / beyondKmh(read, came.node, sv.vehicleProfile)) * HOUR;
  const outRoute = 'node' in via ? routing.routeToExternal(stop, via.node, sv.vehicleProfile) : routing.route(stop, via.pos, sv.vehicleProfile);
  const beyondKm = 'node' in via ? Math.max(0, sup.distance.value - (read.get('NetNode', via.node)?.external?.distanceKm ?? sup.distance.value)) : 0;
  const beyondS = 'node' in via ? (beyondKm / beyondKmh(read, via.node, sv.vehicleProfile)) * HOUR : 0;
  const arrive = sets + toUs.duration + beyondUs + (outRoute?.duration ?? 0) + beyondS;
  const atShop = atCounter(read, sup, arrive, h.errand.atCounter.value * HOUR);
  // (not hours at a closed door: booked for when it opens)
  if (atShop - arrive > SET_OUT_WITHIN) return { code: 'errands.notYet', params: { what: `${sup.label} opens ${busTime(read, atShop)}`, when: busTime(read, atShop - (arrive - read.now)) }, remedies: [{ label: `Wait until ${busTime(read, atShop - (arrive - read.now))}`, wait: { until: atShop - (arrive - read.now) } }] };
  const leaves = atShop + h.errand.atCounter.value * HOUR;
  const backRoute = 'node' in via ? routing.routeFromExternal(via.node, stop, sv.vehicleProfile) : routing.route(via.pos, stop, sv.vehicleProfile);
  if (!backRoute) return { code: 'errands.serviceNoWay', params: { service: sv.label, why: `no way back to ${store.label}` } };
  const pace = profile.loadedSpeed?.value ?? 1;
  const back = leaves + (backRoute.duration + beyondS) / pace + read.port('moves').unloadTime(sv.vehicleProfile, kg / 1000);
  // the price agreed when booked: call-out, its hours from its base and back, its kilometres (to us and home again, to the shop and back)
  const hours = (back + toUs.duration + beyondUs - sets) / HOUR;
  const km = 2 * (toUs.length / 1000 + toUs.externalKm + came.beyondKm) + ((outRoute?.length ?? 0) / 1000 + (outRoute?.externalKm ?? 0) + beyondKm) + (backRoute.length / 1000 + backRoute.externalKm + beyondKm);
  const price = Math.round((sv.price.fixed.value + sv.price.perHour.value * hours + sv.price.perKm.value * km) * read.port('prices').index(read.now) * 100) / 100;
  const carrier = { class: sv.vehicleProfile };
  const goods = { goods: { material: p.material, qty: p.qty, unit: mat.unit, holder: party, mass: kg / 1000 } };
  const rider = { person: p.person };
  const legs = [
    { carrier, from: stop, to: stop, externalNode: came.node, beyondKm: came.beyondKm, loads: [], notBefore: sets },
    { carrier, from: stop, to: 'pos' in via ? via.pos : stop, ...('node' in via ? { externalDestination: via.node, beyondKm } : {}), loads: [rider] },
    { carrier, from: 'pos' in via ? via.pos : stop, to: stop, ...('node' in via ? { externalNode: via.node, beyondKm } : {}), loads: [goods, rider], notBefore: leaves },
  ];
  return { sv, sets, back, price, hours, km, legs, home: { externalDestination: came.node, beyondKm: came.beyondKm } };
}

/**
 * An errand by a service with its driver (A4): the vehicle comes from its base, picks our person up
 * at the store, takes them to the shop and brings them back with what they bought; then it goes
 * home. The price is agreed when booked and paid then; the person is away the whole time.
 */
function byService(ctx: WriteCtx, p: { person: EntityId; material: string; qty: number; store: EntityId; supplier: string; service: string }) {
  const party = actorOf(ctx);
  const wf = ctx.port('workforce');
  const name = wf.name(p.person);
  if (wf.worksFor(p.person) !== party) ctx.reject('errands.notOurs', { person: name, party: partyLabel(ctx, party) });
  mustGo(ctx, p.person, name);
  const store = placed(ctx, p.store) ?? ctx.reject('errands.nowhere', unplaced(ctx, p.store));
  if (store.holder !== party) ctx.reject('errands.notOurStore', { store: store.label, party: partyLabel(ctx, party) });
  // (picked up at the store: they must be there)
  const from0 = setOutFrom(ctx, p.person, name);
  if (Math.hypot(from0[0] - store.pos[0], from0[1] - store.pos[1]) > ctx.data('handling')!.reach.value) ctx.reject('errands.notHere', { person: name, status: `not at ${store.label}` });
  const m0 = ctx.port('holdings').material(p.material);
  if (isCounted(m0) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) ctx.reject('errands.wholePieces', { material: m0.label, qty: p.qty });
  const t = serviceTrip(ctx, p, party);
  if ('code' in t) return ctx.reject(t.code, t.params, t.remedies);
  const sup = ctx.data('suppliers')[p.supplier]!;
  const mat = ctx.port('holdings').material(p.material);
  // the trip and the goods, both paid now: the money must be there for both
  const goodsCost = (ctx.port('trade').offers(p.material).find((o) => o.supplier === p.supplier)?.price ?? 0) * p.qty;
  const prices = ctx.port('prices');
  if (!prices.canSpend(party, t.price + goodsCost)) ctx.reject('errands.noFunds', { what: `${t.sv.label} and ${p.qty} ${mat.unit} ${mat.label}`, cost: Math.round(t.price + goodsCost), liquidity: Math.round(prices.liquidity(party)) });
  const bought = ctx.command('inventory.buyAtCounter', { store: p.store, material: p.material, qty: p.qty, supplier: p.supplier, arrives: t.back, carrier: `${name} with ${t.sv.label}` });
  if (!bought.ok) ctx.reject(bought.reasons[0]!.code, bought.reasons[0]!.params);
  const trip = ctx.command('moves.dispatch', { legs: t.legs as never, purpose: 'carried', ref: bought.ok ? bought.value.order : '', requester: 'inventory', returnEmpty: true, returnVia: t.home });
  if (!trip.ok) ctx.reject(trip.reasons[0]!.code, trip.reasons[0]!.params);
  ctx.ledger.post({ from: acct(party, ACCOUNTS.cash), to: acct(party, ACCOUNTS.services), amount: t.price, memo: `${t.sv.label}: to ${sup.label} and back with ${name} (${round(t.hours)} h, ${Math.round(t.km)} km)`, category: ACCOUNTS.services, refs: [p.person, p.store] });
  ctx.log('info', `${t.sv.label} booked: sets off ${ctx.calendar.format(t.sets)}, ${name} back with ${p.qty} ${mat.unit} ${mat.label} about ${ctx.calendar.format(t.back)}; ${t.price.toFixed(2)} € agreed and paid.`, [p.person, p.store]);
  return { order: bought.ok ? bought.value.order : '', back: t.back, price: t.price };
}

/**
 * Our goods from one of our stores to another by a service with its driver (A4): the van comes from
 * its base to the first store, its driver loads (the goods are set aside for it when it is booked),
 * drives to the other and unloads; then it goes home. The price is agreed when booked and paid then.
 */
export function hireMove(ctx: WriteCtx, p: { from: EntityId; to: EntityId; material: string; qty: number; service: string }, party: EntityId): { move: EntityId; arrives: number; price: number } {
  const sv = ctx.hasData('services') ? ctx.data('services')[p.service] : undefined;
  if (!sv) return ctx.reject('errands.unknownService', { service: p.service });
  // (a trip booked is word to the firm, S4)
  const noWord = wordBlock(ctx, party);
  if (noWord) return ctx.reject('errands.noWord', { service: sv.label, why: noWord.why }, noWord.remedies);
  const hold = ctx.port('holdings');
  const mat = hold.material(p.material);
  const routing = ctx.port('routing');
  const profile = routing.profile(sv.vehicleProfile);
  // pieces go whole
  if (isCounted(mat) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) return ctx.reject('errands.wholePieces', { material: mat.label, qty: p.qty });
  const kg = p.qty * unitMass(mat);
  const limitKg = (profile.payload?.value ?? 0) * 1000;
  if (kg > limitKg + 1e-9) {
    const most = mostOf(mat, limitKg);
    return ctx.reject('errands.tooHeavyFor', { qty: p.qty, unit: mat.unit, material: mat.label, kg: round(kg), load: Math.round(limitKg), vehicle: profile.label }, most > 0 ? [{ label: `Move ${most} ${mat.unit} a trip`, command: { type: 'production.moveGoods', payload: { ...p, by: 'service', qty: most } } }] : []);
  }
  const A = placed(ctx, p.from) ?? ctx.reject('errands.nowhere', unplaced(ctx, p.from));
  const B = placed(ctx, p.to) ?? ctx.reject('errands.nowhere', unplaced(ctx, p.to));
  const a: Vec2 = [A.pos[0], A.pos[1]];
  const b: Vec2 = [B.pos[0], B.pos[1]];
  const came = serviceWayIn(ctx, sv, a);
  if (!came) return ctx.reject('errands.serviceNoWay', { service: sv.label, why: `no way to ${A.label} for a ${profile.label.toLowerCase()}` });
  const ab = routing.route(a, b, sv.vehicleProfile);
  if (!ab) return ctx.reject('errands.serviceNoWay', { service: sv.label, why: `no way from ${A.label} to ${B.label} for a ${profile.label.toLowerCase()}` });
  const home = routing.routeToExternal(b, came.node, sv.vehicleProfile);
  const beyond = (came.beyondKm / beyondKmh(ctx, came.node, sv.vehicleProfile)) * HOUR;
  const sets = withinHours(ctx, sv, ctx.now + sv.callOut.value * HOUR);
  const toA = routing.routeFromExternal(came.node, a, sv.vehicleProfile)!;
  // the driver loads by hand as they unload
  const handling = ctx.port('moves').unloadTime(sv.vehicleProfile, kg / 1000);
  const leaves = sets + toA.duration + beyond + handling;
  const arrives = leaves + ab.duration / (profile.loadedSpeed?.value ?? 1) + handling;
  const hours = (arrives + (home?.duration ?? toA.duration) + beyond - sets) / HOUR;
  const km = 2 * came.beyondKm + toA.length / 1000 + toA.externalKm + ab.length / 1000 + ((home?.length ?? toA.length) / 1000 + (home?.externalKm ?? toA.externalKm));
  const price = Math.round((sv.price.fixed.value + sv.price.perHour.value * hours + sv.price.perKm.value * km) * ctx.port('prices').index(ctx.now) * 100) / 100;
  const prices = ctx.port('prices');
  if (!prices.canSpend(party, price)) return ctx.reject('errands.noFunds', { what: sv.label, cost: Math.round(price), liquidity: Math.round(prices.liquidity(party)) });
  // claimed for the van now, loaded when it is there (r37: not taken out at the booking)
  if (ctx.port('holdings').free(p.from, p.material) + 1e-9 < p.qty) return ctx.reject('errands.notThere', { what: `${p.qty} ${mat.unit} ${mat.label}`, store: A.label });
  const carrier = { class: sv.vehicleProfile };
  const goods = { goods: { material: p.material, qty: p.qty, unit: mat.unit, holder: party, mass: kg / 1000 } };
  const trip = ctx.command('moves.dispatch', {
    legs: [
      { carrier, from: a, to: a, externalNode: came.node, beyondKm: came.beyondKm, loads: [], notBefore: sets },
      { carrier, from: a, to: b, loads: [goods], notBefore: leaves },
    ],
    purpose: 'transfer',
    ref: p.to,
    requester: 'inventory',
    // then home to its base, the way it came in
    returnEmpty: true,
    returnVia: { externalDestination: came.node, beyondKm: came.beyondKm },
  });
  if (!trip.ok) return ctx.reject(trip.reasons[0]!.code, trip.reasons[0]!.params);
  ctx.command('inventory.pickup', { move: trip.value as EntityId, store: p.from, material: p.material, qty: p.qty, leg: 0 });
  ctx.ledger.post({ from: acct(party, ACCOUNTS.cash), to: acct(party, ACCOUNTS.services), amount: price, memo: `${sv.label}: ${p.qty} ${mat.unit} ${mat.label} from ${A.label} to ${B.label} (${round(hours)} h, ${Math.round(km)} km)`, category: ACCOUNTS.services, refs: [p.from, p.to] });
  ctx.log('info', `${sv.label} booked: at ${A.label} ${ctx.calendar.format(sets + toA.duration + beyond)}, ${p.qty} ${mat.unit} ${mat.label} in ${B.label} about ${ctx.calendar.format(arrives)}; ${price.toFixed(2)} € agreed and paid.`, [p.from, p.to]);
  return { move: trip.value, arrives, price };
}
