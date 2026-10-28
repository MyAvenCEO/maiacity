/**
 * Inventory module: matter in holdings (design/physical-state.md, I1 and I3). Goods bought from suppliers
 * beyond the map come in as truckloads over the network; they move between holdings at the same place (or
 * by a declared aggregate carrier), are used up into products and named sinks, are drawn from nature by the
 * module that owns it, and leave over the world's edge as sales and disposal hauls. Its audit checks every
 * material's books after every command.
 */
import { ACCOUNTS, acct } from '../../economy/src/index.ts';
import { actorOf, mustBeLive, partyLabel, wordBlock } from '../../parties/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type { Load } from '../../network/src/index.ts'; // routing/moves port, command and event typings
import { command, convert, DAY, defineModule, HOUR, MINUTE, parseUnit, s, sameDimension, type EntityId, type ReadCtx, type Remedy, type WriteCtx } from '../../kernel/src/index.ts';
import {
  MaterialSchema,
  unitMass,
  isCounted,
  SupplierSchema,
  RoadsideSchema,
  SupplierWeekSchema,
  type HoldingQuery,
  type HoldingsPort,
  type TradePort,
  type StoreUse,
  type InventoryState,
  type Material,
  type MaterialFlows,
  type MaterialQuantity,
  type NormalizedOffer,
  type Order,
  type Store,
  type Supplier,
  type Lots,
  type LorryLoad,
  type Nature,
  type Part as LotPart,
  type Sink,
  type StoreKind,
  type Via,
} from './contract.ts';

/** Module id (it provides the port of the same name; consumers should require the port). */
export const INVENTORY_MODULE_ID = 'inventory';
/** Trucks of one supplier are loaded one after another, every 20–40 min. */
export const LOADING_INTERVAL_MIN = 20;
export const LOADING_INTERVAL_MAX = 40;
/** Retry delay when a truck cannot be routed (road closed, no access). */
export const DISPATCH_RETRY_S = HOUR;
/** how often a firm with its fleet out looks again whether one is back */
const FLEET_RETRY_S = 30 * 60;

const EPS = 1e-9;
/** how long past when it was expected an order is overdue: past a delivery's usual window of a few hours (estimate; a rule of play) */
const OVERDUE_AFTER = 4 * HOUR;
/** the precision stores keep quantities in (tidy) */
const ROUND = 1e-6;
const tidy = (x: number) => Math.round(x * 1e6) / 1e6;
const round2 = (x: number) => Math.round(x * 100) / 100;
const MASS_UNIT = 't';
const VOLUME_UNIT = 'm3';

// ------------------------------------------------------------------ offer normalisation

const isVolume = (u: string) => u === 'm3' || u === 'l';

/**
 * Convert a supplier quantity or price to "per material unit". Mass ↔ volume is bridged with
 * the material's loose density (quarries quote EUR/t, earthworks account in m3).
 */
function toMaterialUnit(q: MaterialQuantity, mat: Material, kind: 'price' | 'quantity', where: string): number {
  if (!q || typeof q.value !== 'number' || !Number.isFinite(q.value) || typeof q.unit !== 'string') {
    throw new Error(`${where}: expected {value, unit}, got ${JSON.stringify(q)}`);
  }
  try {
    parseUnit(q.unit);
  } catch (e) {
    throw new Error(`${where}: ${(e as Error).message}`);
  }
  const target = kind === 'price' ? `EUR/${mat.unit}` : mat.unit;
  if (sameDimension(q.unit, target)) return convert(q.value, q.unit, target);
  const density = mat.density.value; // t/m3
  if (kind === 'price') {
    if (isVolume(mat.unit) && sameDimension(q.unit, `EUR/${MASS_UNIT}`) && density > 0) {
      return convert(convert(q.value, q.unit, `EUR/${MASS_UNIT}`) * density, `EUR/${VOLUME_UNIT}`, target);
    }
    if (mat.unit === MASS_UNIT && sameDimension(q.unit, `EUR/${VOLUME_UNIT}`) && density > 0) {
      return convert(q.value, q.unit, `EUR/${VOLUME_UNIT}`) / density;
    }
  } else {
    if (isVolume(mat.unit) && sameDimension(q.unit, MASS_UNIT) && density > 0) {
      return convert(convert(q.value, q.unit, MASS_UNIT) / density, VOLUME_UNIT, target);
    }
    if (mat.unit === MASS_UNIT && sameDimension(q.unit, VOLUME_UNIT) && density > 0) return convert(q.value, q.unit, VOLUME_UNIT) * density;
  }
  throw new Error(`${where}: ${q.unit} is not convertible to ${target} (material unit ${mat.unit}${mat.unit === 'pcs' ? '' : `, density ${density} t/m3`})`);
}

interface OfferTable {
  /** material → purchase offers sorted by price */
  buy: Record<string, NormalizedOffer[]>;
  /** material → disposal offers sorted by price */
  dispose: Record<string, NormalizedOffer[]>;
  /** material → what buyers pay, the best first */
  sell: Record<string, NormalizedOffer[]>;
}

const offerCache = new WeakMap<object, OfferTable>();

/** Validate and normalise every supplier offer (pure; memoised per data catalog object). */
export function normalizeOffers(materials: Record<string, Material>, suppliers: Record<string, Supplier>): OfferTable {
  const hit = offerCache.get(suppliers);
  if (hit) return hit;
  const table: OfferTable = { buy: {}, dispose: {}, sell: {} };
  for (const [mid, m] of Object.entries(materials)) if (m.perishesInto && (!materials[m.perishesInto] || !m.perishableHours)) throw new Error(`materials.${mid}.perishesInto: a known material, and its perishableHours`);
  for (const [sid, sup] of Object.entries(suppliers)) {
    if (!(sup.openTo.value > sup.openFrom.value)) throw new Error(`suppliers.${sid}: openTo (${sup.openTo.value} h) must be after openFrom (${sup.openFrom.value} h)`);
    for (const [mid, offer] of Object.entries(sup.offers)) {
      const mat = materials[mid];
      if (!mat) throw new Error(`suppliers.${sid}.offers.${mid}: unknown material "${mid}"`);
      const price = toMaterialUnit(offer.price, mat, 'price', `suppliers.${sid}.offers.${mid}.price`);
      const minOrder = toMaterialUnit(offer.minOrder, mat, 'quantity', `suppliers.${sid}.offers.${mid}.minOrder`);
      if (!(price >= 0)) throw new Error(`suppliers.${sid}.offers.${mid}.price: must be ≥ 0`);
      if (!(minOrder >= 0)) throw new Error(`suppliers.${sid}.offers.${mid}.minOrder: must be ≥ 0`);
      if (offer.byAge && (sup.kind !== 'buyer' || !mat.keepsAge || !(offer.byAge.life.value > 0) || !(offer.byAge.floor.value >= 0 && offer.byAge.floor.value <= 1))) throw new Error(`suppliers.${sid}.offers.${mid}.byAge: for a buyer of a good that keeps its age, with a life > 0 and a floor between 0 and 1`);
      const list = sup.kind === 'disposalSite' ? (table.dispose[mid] ??= []) : sup.kind === 'buyer' ? (table.sell[mid] ??= []) : (table.buy[mid] ??= []);
      const stock = offer.stock ? { held: toMaterialUnit(offer.stock.held, mat, 'quantity', `suppliers.${sid}.offers.${mid}.stock.held`), perDay: toMaterialUnit(offer.stock.perDay, mat, 'quantity', `suppliers.${sid}.offers.${mid}.stock.perDay`) } : undefined;
      if (stock && !(stock.held >= 0 && stock.perDay >= 0)) throw new Error(`suppliers.${sid}.offers.${mid}.stock: held and perDay must be ≥ 0`);
      list.push({ supplier: sid, price: Number(price.toPrecision(12)), leadTimeDays: offer.leadTime.value, minOrder: Number(minOrder.toPrecision(12)), ...(offer.byAge ? { byAge: { life: offer.byAge.life.value, floor: offer.byAge.floor.value } } : {}), ...(stock ? { stock } : {}) });
    }
  }
  for (const list of [...Object.values(table.buy), ...Object.values(table.dispose)]) list.sort((a, b) => a.price - b.price || (a.supplier < b.supplier ? -1 : 1));
  for (const list of Object.values(table.sell)) list.sort((a, b) => b.price - a.price || (a.supplier < b.supplier ? -1 : 1));
  offerCache.set(suppliers, table);
  return table;
}

const offersOf = (ctx: ReadCtx) => normalizeOffers(ctx.data('materials'), ctx.data('suppliers'));

/** what a buyer of used goods pays of its price for the pieces sold, by the age each has had in use (1: as new, or not a buyer of used goods) */
function usedShare(offer: NormalizedOffer, parts: readonly { qty: number; age?: number }[] | undefined): { share: number; note: string } {
  if (!offer.byAge) return { share: 1, note: '' };
  const { life, floor } = offer.byAge;
  const lots = parts?.length ? parts : [{ qty: 1, age: 0 }];
  const qty = lots.reduce((a, x) => a + x.qty, 0);
  const share = lots.reduce((a, x) => a + x.qty * Math.max(floor, 1 - (x.age ?? 0) / life), 0) / Math.max(1e-9, qty);
  const age = lots.reduce((a, x) => a + x.qty * (x.age ?? 0), 0) / Math.max(1e-9, qty);
  return { share, note: ` (${Math.round(age * 365)} days in use of a life of ${life} years: ${Math.round(share * 100)} % of what it pays for one as new)` };
}

/** can a buyer's lorry get from its way in to a place of ours and back out */
function collects(ctx: ReadCtx, supplierId: string, at: readonly [number, number]): boolean {
  const sup = ctx.data('suppliers')[supplierId]!;
  const dep = departure(ctx, supplierId);
  if (!dep) return false;
  const routing = ctx.port('routing');
  const pos: Vec2 = [at[0], at[1]];
  if ('pos' in dep) return routing.route(dep.pos, pos, sup.vehicleProfile) !== null && routing.route(pos, dep.pos, sup.vehicleProfile) !== null;
  return routing.routeFromExternal(dep.node, pos, sup.vehicleProfile) !== null && routing.routeToExternal(pos, dep.node, sup.vehicleProfile) !== null;
}
const index = (ctx: ReadCtx, t: number) => ctx.port('prices').index(t);

function material(ctx: ReadCtx, id: string): Material {
  const m = ctx.data('materials')[id];
  if (!m) throw new Error(`Unknown material ${id}`);
  return m;
}

// ------------------------------------------------------------------ helpers

/** Truck payload in material units for a vehicle profile (mass and volume limits). */
export function truckLoad(ctx: ReadCtx, profileId: string, mat: Material): number {
  const prof = ctx.port('routing').profile(profileId);
  // piece goods: whole pieces, as many as its payload and its bed take (design/physical-state.md I5: 110 m of culvert
  // pipe is 72 t, not one flatbed)
  // (energy is not loaded: it goes along a cable or in a battery carried)
  if (mat.unit === 'kWh') return 0;
  if (mat.unit === 'pcs') {
    const kg = unitMass(mat);
    const pcs: number[] = [];
    if (prof.payload) pcs.push(Math.floor((convert(prof.payload.value, prof.payload.unit, 't') * 1000) / kg + 1e-9));
    if (prof.payloadVolume && mat.density.value > 0) pcs.push(Math.floor(prof.payloadVolume.value / (kg / 1000 / mat.density.value) + 1e-9));
    const n = pcs.length ? Math.min(...pcs) : Number.POSITIVE_INFINITY;
    return n >= 1 ? n : 0;
  }
  const caps: number[] = [];
  const density = mat.density.value;
  // goods counted by mass (t, kg) or by volume (m3, l)
  const byMass = mat.unit === 't' || mat.unit === 'kg';
  if (prof.payload) {
    const t = prof.payload.value;
    caps.push(byMass ? convert(t, 't', mat.unit) : convert(t / density, 'm3', mat.unit));
  }
  if (prof.payloadVolume) {
    const v = prof.payloadVolume.value;
    caps.push(byMass ? convert(v * density, 't', mat.unit) : convert(v, 'm3', mat.unit));
  }
  const load = Math.min(...caps);
  return Number.isFinite(load) && load > 0 ? load : 0;
}

/** what a lorry brings, landed where it stands: set down there (a store of ours by it), paid; a disposal's or a sale's, gone (S5: after the handover) */
function landed(ctx: WriteCtx, orderId: EntityId, purpose: string, qty: number, to: Vec2, since?: number): void {
  const o = ctx.require('Order', orderId);
  const mat = material(ctx, o.material);
  const sup = ctx.data('suppliers')[o.supplier];
  const p = { ref: orderId, purpose, to };
  // set down at the store, or where the lorry could get to (a store of ours there, set up if need be)
  const into = p.purpose === 'delivery' ? setDownAt(ctx, o.store, p.to, `${mat.label} from ${sup?.label ?? o.supplier}`) : o.store;
  const delivered = o.delivered + qty;
  const done = o.status === 'open' && delivered + EPS >= o.qty;
  writeOrder(ctx, p.ref, { ...o, delivered, inTransit: Math.max(0, o.inTransit - qty), status: done ? 'complete' : o.status });
  const payer = ctx.require('Store', o.store).holder;
  if (p.purpose === 'delivery') {
    // (what goes off counts from when it was batched: as the lorry left the plant, G7)
    changeStock(ctx, into, o.material, qty, since !== undefined ? { since } : {});
    addFlow(ctx, o.material, 'delivered', qty);
    ctx.ledger.post({
      from: acct(payer, ACCOUNTS.cash),
      to: acct(payer, purchaseAccount(mat)),
      amount: qty * o.unitPrice,
      memo: `${fmtQty(qty)} ${mat.unit} ${mat.label} from ${sup?.label ?? o.supplier}`,
      category: purchaseAccount(mat),
      refs: [p.ref, o.store],
    });
    ctx.emit('inventory.delivered', { order: p.ref, store: into, material: o.material, qty });
  } else if (o.sale) {
    // sold: the buyer pays as it collects
    ctx.ledger.post({ from: acct(payer, ACCOUNTS.sales), to: acct(payer, ACCOUNTS.cash), amount: qty * o.unitPrice, memo: `${fmtQty(qty)} ${mat.unit} ${mat.label} sold to ${sup?.label ?? o.supplier}`, category: ACCOUNTS.sales, refs: [p.ref, o.store] });
  } else {
    ctx.ledger.post({
      from: acct(payer, ACCOUNTS.cash),
      to: acct(payer, ACCOUNTS.disposal),
      amount: qty * o.unitPrice,
      memo: `Disposal ${fmtQty(qty)} ${mat.unit} ${mat.label} at ${sup?.label ?? o.supplier}`,
      category: ACCOUNTS.disposal,
      refs: [p.ref, o.store],
    });
  }
  if (done) {
    ctx.emit('inventory.orderComplete', { order: p.ref });
    ctx.log('success', `${o.sale ? 'Sale' : o.direction === 'outbound' ? 'Disposal' : 'Order'} complete: ${fmtQty(o.qty)} ${mat.unit} ${mat.label}`, [p.ref]);
  }
}

/** how an order is handed over (S5): as it says, else as its supplier does; `drop` where neither says */
function handoverOf(read: ReadCtx, o: Order): 'attended' | 'drop' {
  return o.handover ?? read.data('suppliers')[o.supplier]?.handover ?? 'drop';
}

/** a party's people: who works for it, or of its household (the workforce's, as a person's) */
function peopleOf(read: ReadCtx, party: EntityId): EntityId[] {
  if (!read.hasPort('workforce')) return [];
  // (its staff, and its household's members and helpers: not every person of the world, 0025)
  const helpers = [...read.all('Helper')].filter(([, h]) => h.of === party).map(([id]) => id);
  return [...new Set([...read.port('workforce').staff(party), ...helpers])].filter((id) => !read.get('Person', id)?.died).sort();
}

/** one of a party's people at a place now, within reach of it (to take goods from a driver's hands, S5) */
function receiverAt(read: ReadCtx, party: EntityId, at: Vec2): EntityId | undefined {
  if (!read.hasPort('moves')) return undefined;
  const reach = read.hasData('labourSettings') ? read.data('labourSettings').ways.reach.value : 15;
  const moves = read.port('moves');
  return peopleOf(read, party).find((id) => {
    const w = moves.where(id);
    return w && moves.placeOf(id)?.on === undefined && Math.hypot(w[0] - at[0], w[1] - at[1]) <= reach;
  });
}

/**
 * A lorry with goods to hand over is at its drop point (S5): one of ours there takes them; else the driver rings (our
 * word: an office, a phone with charge) or calls out (one within hearing), and the nearest of ours who can walk there
 * within his wait comes; he waits that long, then the goods are handed over or go back with him.
 */
/** where a supplier's lorry goes back to from a drop point: its yard on the map, or the way out it came by */
function lorryHome(ctx: ReadCtx, o: Order, at: Vec2, carrier: { class: string; fleet?: string }): { at: Vec2; profile: string; fleet: string; home: Vec2; node?: EntityId; beyondKm?: number } {
  const sup = ctx.data('suppliers')[o.supplier]!;
  const dep = departure(ctx, o.supplier);
  const home: Vec2 = dep && 'pos' in dep ? dep.pos : [at[0], at[1]];
  const node = dep && 'node' in dep ? dep.node : undefined;
  const beyond = beyondKmOf(ctx, sup, o.supplier);
  return { at: [at[0], at[1]], profile: carrier.class, fleet: carrier.fleet ?? o.supplier, home, ...(node !== undefined ? { node } : {}), ...(beyond > 0 ? { beyondKm: beyond } : {}) };
}

function handoverArrived(ctx: WriteCtx, move: EntityId, loads: LorryLoad[], at: Vec2, carrier: { class: string; fleet?: string }, coming?: { person: EntityId; at: number; from: [number, number] }): void {
  const o = ctx.require('Order', loads[0]!.order);
  const sup = ctx.data('suppliers')[o.supplier]!;
  const payer = ctx.require('Store', o.store).holder;
  const until = ctx.now + Math.round((sup.failed?.wait.value ?? 15) * MINUTE);
  // (one set out when he rang ahead, on the way or there: S5b; held for this handover, let go when it is done, whoever
  // signs: review x; one who cannot be there before he goes is no longer held for it)
  const ahead = coming && coming.at <= until ? { person: coming.person, arrive: Math.max(ctx.now, coming.at), from: coming.from } : undefined;
  if (coming && !ahead) letGoMeeter(ctx, coming.person, move, coming.from);
  const rec: { loads: LorryLoad[]; until: number; meeter?: EntityId; back?: Vec2 } & ReturnType<typeof lorryHome> = { loads, until, ...lorryHome(ctx, o, at, carrier), ...(ahead ? { meeter: ahead.person, back: ahead.from } : {}) };
  let when = until;
  if (receiverAt(ctx, payer, at)) when = ctx.now;
  else {
    // (else the nearest who can come now)
    const come = ahead ?? whoComes(ctx, payer, at, until, move);
    if (come) {
      Object.assign(rec, { meeter: come.person, back: come.from });
      when = come.arrive;
    }
    const what = loads.map((l) => `${fmtQty(l.qty)} ${material(ctx, l.material).unit} ${material(ctx, l.material).label}`).join(', ');
    ctx.log(come ? 'info' : 'warn', come ? `The driver of ${sup.label} is at ${fmtPos(at)} with ${what}: ${ctx.port('workforce').name(come.person)} comes to take it (there ${ctx.calendar.format(come.arrive, 'time')}).` : `The driver of ${sup.label} is at ${fmtPos(at)} with ${what}, and nobody of ours to take it: he waits until ${ctx.calendar.format(until, 'time')}.`, loads.map((l) => l.order));
  }
  ctx.setState('inventory', { ...ctx.state('inventory'), handovers: { ...(ctx.state('inventory').handovers ?? {}), [move]: rec } });
  ctx.at(when, 'handover', { move });
}

/**
 * The nearest of a party's people who hears the driver and can walk to him before he goes, held for the handover of
 * this lorry and then sent there (S5): the hold is asked first, and only one it is granted for walks (decision 0028: one
 * owner of a person's time; review x, a walk was sent before the hold was refused)
 */
function whoComes(ctx: WriteCtx, party: EntityId, at: Vec2, until: number, lorry: EntityId): { person: EntityId; arrive: number; from: Vec2 } | undefined {
  if (!ctx.hasData('labourSettings')) return undefined;
  const ways = ctx.data('labourSettings').ways;
  const moves = ctx.port('moves');
  const routing = ctx.port('routing');
  // (the driver phones: it reaches one of ours by their own phone with charge (the household's, or the office passing it
  // on); else only one within hearing knows: review S5 #5)
  const wf = ctx.port('workforce');
  const can: { person: EntityId; arrive: number; from: Vec2 }[] = [];
  for (const id of peopleOf(ctx, party)) {
    const w = moves.where(id);
    if (!w || moves.placeOf(id)?.on !== undefined) continue;
    const st = ctx.get('Presence', id)?.status;
    if (st !== 'available' && st !== undefined) continue;
    if (Math.hypot(w[0] - at[0], w[1] - at[1]) > ways.hearing.value && !(wf.phone(id) > 0 && !wordBlock(ctx, party))) continue;
    const r = routing.route([w[0], w[1]], at, ways.walk);
    if (!r || ctx.now + r.duration > until) continue;
    can.push({ person: id, arrive: ctx.now + r.duration, from: [w[0], w[1]] });
  }
  // the nearest first; one held for another purpose stays with it
  for (const c of can.sort((a, b) => a.arrive - b.arrive || (a.person < b.person ? -1 : 1))) {
    // (held there for the handover: nothing sends them elsewhere until it is done, decision 0028; at most till he leaves)
    if (!ctx.command('workforce.engage', { person: c.person, purpose: 'to take goods from a driver', ref: lorry, until: until + HOUR }).ok) continue;
    const go = ctx.command('moves.dispatch', { legs: [{ carrier: { class: ways.walk, unit: c.person }, from: c.from, to: [at[0], at[1]], loads: [] }], purpose: 'meet', requester: INVENTORY_MODULE_ID });
    if (!go.ok) {
      ctx.command('workforce.letGo', { person: c.person, ref: lorry });
      continue;
    }
    return { ...c, arrive: ctx.require('Move', go.value as EntityId).legs.at(-1)!.arrive };
  }
  return undefined;
}

/**
 * The one of ours held to meet a lorry, let go (decision 0028: a hold ends with its purpose): its handover is done, it
 * will not come or not in time, or our consent to set its goods down needs nobody there. Only our own hold, by the
 * lorry (one held meanwhile for another purpose is not ours to send anywhere); still on the walk to the drop point, they
 * stop where they are; then they walk back to where they set out from (`back`), and are let go: the one function every
 * end of a meeter's hold goes through (review y: let go mid-walk or at the roadside, they stayed there).
 */
function letGoMeeter(ctx: WriteCtx, person: EntityId | undefined, lorry: EntityId, back?: Vec2): void {
  if (!person || ctx.port('workforce').engaged(person)?.ref !== lorry) return;
  const moves = ctx.port('moves');
  const on = moves.placeOf(person)?.on;
  const walk = on !== undefined ? ctx.get('Move', on) : undefined;
  if (on !== undefined && walk?.requester === INVENTORY_MODULE_ID && walk.purpose === 'meet') ctx.command('moves.stop', { move: on, why: 'no longer needed at the drop point' });
  const w = moves.where(person);
  if (back && w && moves.placeOf(person)?.on === undefined && ctx.hasData('labourSettings') && Math.hypot(w[0] - back[0], w[1] - back[1]) > 1) ctx.command('moves.dispatch', { legs: [{ carrier: { class: ctx.data('labourSettings').ways.walk, unit: person }, from: [w[0], w[1]], to: [back[0], back[1]], loads: [] }], purpose: 'meet:return', requester: INVENTORY_MODULE_ID });
  ctx.command('workforce.letGo', { person, ref: lorry });
}

const fmtPos = (p: Vec2) => `(${Math.round(p[0])}, ${Math.round(p[1])})`;

/**
 * A load nobody came for (S5): back with the driver; again on the supplier's next loading day, or, its tries used, off its
 * order. Every load on the lorry the same way, by its own order's state and its own try (review x): one called off on the
 * way is not brought again, its goods the supplier's again.
 */
function failedLoad(ctx: WriteCtx, load: LorryLoad, at: Vec2, fee: number): void {
  const { order: orderId, qty, attempt } = load;
  const o = ctx.require('Order', orderId);
  const sup = ctx.data('suppliers')[o.supplier]!;
  const mat = material(ctx, o.material);
  const attempts = sup.failed?.attempts ?? 2;
  // (called off while on the road: there is no next try, whichever lorry it rode on)
  const closed = o.status !== 'open';
  const last = closed || attempt >= attempts;
  const inTransit = Math.max(0, o.inTransit - qty);
  const total = closed ? o.qty : last ? Math.max(o.delivered, o.qty - qty) : o.qty;
  const ends = !closed && last && inTransit <= EPS && o.delivered + EPS >= total;
  const status = ends ? (o.delivered > EPS ? ('complete' as const) : ('cancelled' as const)) : o.status;
  // (the next try a loading of its own, booked in the supplier's calendar as any load: review y)
  const next = last ? undefined : freeSlot(ctx, sup, ctx.calendar.startOfDay(ctx.now) + DAY, bookedOf(ctx, o.supplier));
  // (what it is expected for now: the next try, not the first booking: one fact, the order's, robustness step 4; with its try)
  const slot = next !== undefined ? Math.round(next + externalLegS(ctx, sup, o.supplier)) : undefined;
  writeOrder(ctx, orderId, { ...o, qty: total, failures: (o.failures ?? 0) + 1, inTransit, status, ...(slot !== undefined ? { loads: [...(o.loads ?? []), slot], loadInfo: [...(o.loadInfo ?? []), { slot, attempt: attempt + 1 }], expected: slot } : {}) });
  // (a load taken off the order, or back with an order called off, is the supplier's again)
  if (last) releaseStock(ctx, o.supplier, o.material, orderId, qty);
  if (next !== undefined) ctx.at(next, 'truck', { order: orderId, qty, due: true, slot });
  const what = `${fmtQty(qty)} ${mat.unit} ${mat.label}`;
  if (closed) {
    ctx.log('warn', `Nobody of ours came to the driver of ${sup.label} at ${fmtPos(at)}: he took the ${what} back${fee > 0 ? ` (${fee.toFixed(2)} € for the trip)` : ''}; the order was called off, so it is not brought again.`, [orderId]);
    return;
  }
  ctx.log('warn', `Nobody of ours came to the driver of ${sup.label} at ${fmtPos(at)}: he took the ${what} back${fee > 0 ? ` (${fee.toFixed(2)} € for the trip)` : ''}${next !== undefined ? `; he comes again ${ctx.calendar.format(next)}` : status === 'cancelled' ? '; the order is called off' : `; the ${what} are no longer ours to come`}.`, [orderId]);
  news(ctx, orderId, 'inventory.deliveryFailed', { severity: 'warn', params: { supplier: sup.label, at: fmtPos(at), next: next !== undefined ? ctx.calendar.format(next) : status === 'cancelled' ? 'never: the order is called off' : 'never: that load is taken off the order' }, remedies: next !== undefined ? [{ label: `Agree with ${sup.label} that it is set down there with nobody to take it`, command: { type: 'inventory.setHandover', payload: { order: orderId, handover: 'drop' } } }] : [] });
  if (status === 'complete') ctx.emit('inventory.orderComplete', { order: orderId });
}

/** the lorry's way back from its drop point, empty or with what it could not hand over (S5) */
function lorryBack(ctx: WriteCtx, ref: EntityId, h: { at: Vec2; profile: string; fleet: string; home: Vec2; node?: EntityId; beyondKm?: number }, goods: { material: string; qty: number }[] = []): void {
  const loads = goods.map((g) => ({ goods: { material: g.material, qty: g.qty, unit: material(ctx, g.material).unit, mass: (g.qty * unitMass(material(ctx, g.material))) / 1000 } }));
  const leg = { carrier: { class: h.profile, fleet: h.fleet }, from: h.at, to: h.node !== undefined ? h.at : h.home, ...(h.node !== undefined ? { externalDestination: h.node, ...(h.beyondKm ? { beyondKm: h.beyondKm } : {}) } : {}), loads };
  const r = ctx.command('moves.dispatch', { legs: [leg], purpose: 'delivery:return', ref, requester: INVENTORY_MODULE_ID });
  if (!r.ok) ctx.log('warn', `The lorry of ${ref} cannot go back: ${r.reasons.map((b) => ctx.formatBlocker(b)).join('; ')}`, [ref]);
}

function hourOf(ctx: ReadCtx, t: number): number {
  return (t - ctx.calendar.startOfDay(t)) / HOUR;
}

/** Earliest t' ≥ t inside the supplier's loading hours on a loading day. */
function alignToOpening(ctx: ReadCtx, sup: Supplier, t: number): number {
  let cur = t;
  for (let i = 0; i < 30; i += 1) {
    const day = ctx.calendar.startOfDay(cur);
    if (workingDay(ctx, day)) {
      const h = hourOf(ctx, cur);
      if (h < sup.openFrom.value) return day + Math.round(sup.openFrom.value * HOUR);
      if (h < sup.openTo.value) return cur;
    }
    cur = day + DAY;
  }
  return cur;
}

/**
 * The way a supplier's trucks come by: its own access, else an external node labelled like it,
 * else the first way into the map its vehicle can use beyond the map (a van has no speed on a
 * footpath). Undefined: it cannot reach the map. A supplier on the map needs no way in.
 */
function externalNodeFor(ctx: ReadCtx, supplierId: string): EntityId | undefined {
  const routing = ctx.port('routing');
  const sup = ctx.data('suppliers')[supplierId];
  if (sup?.access) {
    const node = ctx.state('accesses').built[sup.access]?.node;
    return node !== undefined && usableOutside(ctx, node, sup.vehicleProfile) ? node : undefined;
  }
  const ids = routing.externalNodes().filter((id) => !sup || usableOutside(ctx, id, sup.vehicleProfile));
  for (const id of ids) {
    const label = ctx.get('NetNode', id)?.external?.label;
    if (label && (label === supplierId || label === sup?.label)) return id;
  }
  return ids[0];
}

/** can a vehicle go the way beyond the map from this node */
function usableOutside(ctx: ReadCtx, node: EntityId, profileId: string): boolean {
  const ext = ctx.get('NetNode', node)?.external;
  const prof = ctx.port('routing').profile(profileId);
  const surface = ext?.surface ?? 'external';
  return Boolean(ext) && Object.hasOwn(prof.surfaceSpeed, surface) && (prof.roadLegal || surface !== 'external');
}

/** can the supplier reach the map at all */
const reaches = (ctx: ReadCtx, supplierId: string): boolean => Boolean(ctx.data('suppliers')[supplierId]?.pos) || externalNodeFor(ctx, supplierId) !== undefined;

/** where a supplier's truck sets out: its place on the map, or the way it comes in by */
function departure(ctx: ReadCtx, supplierId: string): { pos: Vec2 } | { node: EntityId } | undefined {
  const sup = ctx.data('suppliers')[supplierId]!;
  if (sup.pos) return { pos: [sup.pos[0], sup.pos[1]] };
  const node = externalNodeFor(ctx, supplierId);
  return node === undefined ? undefined : { node };
}

/**
 * Time a truck needs from the supplier to the way into the map. When the external node is the
 * supplier's own (labelled like it), its route distance already covers the way → 0; a supplier
 * on the map has no way in.
 */
/** the kilometres from a supplier's yard to the way into the map (0: on the map, or the way in is its own) */
function beyondKmOf(ctx: ReadCtx, sup: Supplier, supplierId: string): number {
  if (sup.pos) return 0;
  const node = externalNodeFor(ctx, supplierId);
  const label = node === undefined ? undefined : ctx.get('NetNode', node)?.external?.label;
  return label !== undefined && (label === supplierId || label === sup.label) ? 0 : sup.distance.value;
}

/** how many of a firm's vehicles are out now (on a move for us, there or on the way back: design/physical-state.md I5) */
function fleetOut(read: ReadCtx, firm: string): number {
  let n = 0;
  for (const [, m] of read.all('Move')) if ((m.status === 'underway' || m.status === 'unloading') && m.legs.some((l) => l.carrier.fleet === firm)) n += 1;
  // (and one standing at a drop point, its driver waiting for one of ours: review S5 #7)
  for (const h of Object.values(read.state('inventory').handovers ?? {})) if (h.fleet === firm) n += 1;
  return n;
}

/** a firm with all its vehicles out: the load waits for one back, and the order says so */
function fleetBusy(ctx: WriteCtx, order: EntityId, firm: string, timer: 'truck' | 'haul', payload: { order: EntityId; qty: number; due?: boolean }): boolean {
  const sup = ctx.data('suppliers')[firm]!;
  const n = sup.fleet.value;
  if (fleetOut(ctx, firm) < n) {
    news(ctx, order, 'inventory.fleetBusy', null);
    return false;
  }
  news(ctx, order, 'inventory.fleetBusy', { severity: 'info', params: { firm: sup.label, n } });
  ctx.after(FLEET_RETRY_S, timer, { ...payload, due: true });
  return true;
}

/** an order's news, one entry per kind (late, held up, broken down): set or cleared without touching the others */
function news(ctx: WriteCtx, order: EntityId, code: string, b: { severity: 'info' | 'warn' | 'block'; params: Record<string, string | number>; remedies?: Remedy[] } | null): void {
  const rest = ctx.blockersOf(order).filter((x) => x.module === INVENTORY_MODULE_ID && x.code !== code);
  const next = b ? [...rest, { code, ...b }] : rest;
  if (next.length) ctx.blockers.set(order, next);
  else ctx.blockers.clear(order);
}

/** the orders whose goods a move carries (a tour's lorry carries several, each load tagged with its order: S5b), and the one it is for */
function ordersOn(m: { ref?: string; legs: readonly { loads: readonly Load[] }[] }): Set<string> {
  const out = new Set<string>(m.ref ? [m.ref] : []);
  for (const l of m.legs) for (const x of l.loads) if ('goods' in x && x.goods.order) out.add(x.goods.order);
  return out;
}

/** what of an order's goods a move carries (its loads tagged with it; untagged, those of the order it is for) */
function carriesOf(m: { ref?: string; legs: readonly { loads: readonly Load[] }[] }, order: string): number {
  return m.legs.at(-1)!.loads.reduce((a, l) => a + ('goods' in l && (l.goods.order ?? m.ref) === order ? l.goods.qty : 0), 0);
}

/** a lorry with goods of the order (its own or a tour's) that stood on the way and is not here yet: the latest of them, or none */
function stillDelayed(ctx: WriteCtx, order: EntityId): void {
  const late = ctx.port('moves').underway().filter(([, m]) => ordersOn(m).has(order) && (m.purpose === 'delivery' || m.purpose === 'carried' || m.purpose === 'disposal') && m.legs.some((l) => l.stops?.length));
  const last = late.map(([, m]) => m).sort((a, b) => b.legs.at(-1)!.arrive - a.legs.at(-1)!.arrive)[0];
  news(ctx, order, 'inventory.lorryDelayed', last ? { severity: 'info', params: { why: last.legs.flatMap((l) => l.stops ?? []).at(-1)!.why, at: ctx.calendar.format(last.legs.at(-1)!.arrive) } } : null);
}

function externalLegS(ctx: ReadCtx, sup: Supplier, supplierId: string): number {
  if (sup.pos) return 0;
  const node = externalNodeFor(ctx, supplierId);
  const label = node === undefined ? undefined : ctx.get('NetNode', node)?.external?.label;
  if (label !== undefined && (label === supplierId || label === sup.label)) return 0;
  const prof = ctx.port('routing').profile(sup.vehicleProfile);
  const outside = node === undefined ? 'external' : (ctx.get('NetNode', node)?.external?.surface ?? 'external');
  const kmh = prof.surfaceSpeed[outside]?.value ?? prof.maxSpeed.value;
  return Math.round((sup.distance.value / kmh) * HOUR);
}

function writeStore(ctx: WriteCtx, id: EntityId, contents: Record<string, number>): void {
  const st = ctx.require('Store', id);
  const clean: Record<string, number> = {};
  for (const k of Object.keys(contents).sort()) {
    const v = tidy(contents[k]!);
    if (Math.abs(v) > EPS) clean[k] = v;
  }
  // a good put in that has no place in the layout: it lands on top, and the store is a heap again
  const keeps = st.layout && Object.keys(clean).every((m) => st.layout!.order.includes(m) || (st.contents[m] ?? 0) >= clean[m]!);
  ctx.set('Store', id, { holder: st.holder, label: st.label, kind: st.kind, pos: [st.pos[0], st.pos[1]], contents: clean, ...(st.on ? { on: st.on } : {}), ...(st.capacity !== undefined ? { capacity: st.capacity } : {}), ...(st.rate !== undefined ? { rate: st.rate } : {}), ...(st.work ? { work: st.work } : {}), ...(st.for ? { for: st.for } : {}), ...(st.holds ? { holds: [...st.holds] } : {}), ...(st.layout && keeps ? { layout: st.layout } : {}) });
  // goods set down short of where they are meant to go: the blocker follows what lies there
  if (st.for) setDownBlocker(ctx, id);
}

/**
 * Where a delivery is set down: the ordered store if the lorry stops within reach of it (the handling
 * data's reach), else a store of ours at the point it got to (set up there if there is none), meant
 * for the ordered one (A3: delivered to the site, as far as it can drive).
 */
function setDownAt(ctx: WriteCtx, store: EntityId, at: Vec2, what: string): EntityId {
  const st = ctx.require('Store', store);
  const reach = ctx.hasData('handling') ? (ctx.data('handling') as { reach: { value: number } }).reach.value : 0;
  const d = (q: Vec2) => Math.hypot(q[0] - at[0], q[1] - at[1]);
  if (d(st.pos) <= reach) return store;
  // a store here already set down for this one (never one meant for another store)
  const near = [...ctx.all('Store')].filter(([, x]) => x.holder === st.holder && x.for === store && d(x.pos) <= reach).sort((x, y) => d(x[1].pos) - d(y[1].pos))[0];
  let drop = near?.[0];
  if (!drop) {
    const label = `Set down for ${st.label}`;
    drop = ctx.spawn('store', { name: label });
    ctx.set('Store', drop, { holder: st.holder, label, kind: 'stockpile', pos: [at[0], at[1]], contents: {}, for: store });
  }
  ctx.log('warn', `The lorry could not get to ${st.label}: ${what} set down ${Math.round(Math.hypot(st.pos[0] - at[0], st.pos[1] - at[1]))} m from it, at ${ctx.require('Store', drop).label}. Moving it on is our work.`, [drop, store]);
  return drop;
}

/** goods set down short of the store they are for: the ways to move them on, as ready-made commands */
function setDownBlocker(ctx: WriteCtx, drop: EntityId): void {
  const d = ctx.get('Store', drop);
  const target = d?.for ? ctx.get('Store', d.for) : undefined;
  if (!d || !target) return;
  const goods = Object.entries(d.contents).filter(([, q]) => q > EPS);
  if (!goods.length) return ctx.blockers.clear(drop);
  const away = Math.round(Math.hypot(target.pos[0] - d.pos[0], target.pos[1] - d.pos[1]));
  const remedies: Remedy[] = goods.flatMap(([mat, qty]) => {
    const m = material(ctx, mat);
    const move = (by: 'hand' | 'machine') => ({ type: 'production.moveGoods', payload: { from: drop, to: d.for!, material: mat, qty: tidy(qty), by } });
    return [{ label: `Carry ${fmtQty(qty)} ${m.unit} ${m.label} to ${target.label} by hand`, command: move('hand') }, ...(m.unit === 't' || m.unit === 'm3' ? [{ label: `Move ${fmtQty(qty)} ${m.unit} ${m.label} to ${target.label} with a loader and tippers`, command: move('machine') }] : [])];
  });
  ctx.blockers.set(drop, [{ code: 'inventory.setDown', severity: 'warn', params: { store: target.label, away, goods: goods.map(([mat, q]) => `${fmtQty(q)} ${material(ctx, mat).unit} ${material(ctx, mat).label}`).join(', ') }, remedies }]);
}

/** goods bought at a counter and carried home are in the store when the carrier is (paid at the counter) */
function carriedIn(ctx: WriteCtx, order: EntityId): void {
  const o = ctx.get('Order', order);
  if (!o || o.status !== 'open') return;
  putIn(ctx, o.store, o.material, o.inTransit);
  addFlow(ctx, o.material, 'delivered', o.inTransit);
  writeOrder(ctx, order, { ...o, delivered: o.delivered + o.inTransit, inTransit: 0, status: 'complete' });
  ctx.emit('inventory.delivered', { order, store: o.store, material: o.material, qty: o.inTransit });
}

/** a good that becomes another where it is kept: it seasons (days), or goes off after its hours from batching (G7) */
const turns = (m: Material): { into: string; after: number; keeps: number; off: boolean } | undefined =>
  m.seasons ? { into: m.seasons.into, after: m.seasons.days.value * DAY, keeps: m.seasons.keeps.value, off: false } : m.perishesInto && m.perishableHours ? { into: m.perishesInto, after: m.perishableHours.value * HOUR, keeps: 1, off: true } : undefined;

/** what seasons where it is kept and is old enough becomes the other good, keeping its share of the mass */
/**
 * The night at the roadside (S5b): goods in a heap in the open that a van stopping on a way can load from (within the
 * handling reach of one), whoever's and however they got there (a lorry's set-down, a heap of ours: decision 0027 rule 7,
 * status never exempts physics; review x), unwatched: taken, now and then. A claim on them (a sale, a haul, a carrier
 * coming) is our booking, not a lock: what of it is gone, its claim is cut and said.
 */
function roadsideNight(ctx: WriteCtx): void {
  if (!ctx.hasData('roadside') || !ctx.hasPort('moves')) return;
  const set = ctx.data('roadside')!;
  const moves = ctx.port('moves');
  const routing = ctx.port('routing');
  const reach = reachOf(ctx);
  const wf = ctx.hasPort('workforce') ? ctx.port('workforce') : undefined;
  for (const [sid, st] of [...ctx.all('Store')]) {
    // (a heap in the open; a depot or a site store is a yard or a container, shut)
    if (st.kind !== 'stockpile' || st.on !== undefined) continue;
    const goods = Object.entries(st.contents).filter(([, q]) => q > EPS);
    if (!goods.length) continue;
    // (a van stops on a way within reach of it)
    const way = routing.nearest([st.pos[0], st.pos[1]], { openOnly: true });
    if (!way || way.distance > reach) continue;
    // (one of ours by it: watched)
    const people = wf ? [...new Set([...wf.staff(st.holder), ...wf.members(st.holder)])] : [];
    if (people.some((p) => {
      const w = moves.where(p);
      return w && Math.hypot(w[0] - st.pos[0], w[1] - st.pos[1]) <= set.watch.value;
    })) continue;
    // (what is worth a thief's trip by its weight: tools, steel, fuel; not a heap of gravel)
    const priced = goods.map(([m, q]) => ({ m, q, each: offersOf(ctx).buy[m]?.[0]?.price ?? 0, kg: unitMass(material(ctx, m)) })).filter((g) => g.kg > 0 && g.each / g.kg >= set.dear.value);
    const worth = priced.reduce((a, g) => a + g.q * g.each, 0);
    if (!(worth > 0) || !ctx.rng('roadside').chance(set.perNight.value * Math.min(1, worth / set.worth.value))) continue;
    // a van's worth carried off, the dearest by weight first
    let room = set.load.value;
    const taken: string[] = [];
    for (const g of priced.sort((a, b) => b.each / Math.max(1e-9, b.kg) - a.each / Math.max(1e-9, a.kg) || (a.m < b.m ? -1 : 1))) {
      if (room <= 1e-9 || !(g.each > 0)) break;
      const q = isCounted(material(ctx, g.m)) ? Math.min(g.q, Math.floor(room / Math.max(1e-9, g.kg))) : Math.min(g.q, room / Math.max(1e-9, g.kg));
      if (!(q > EPS)) continue;
      // (taken whatever is booked on it: the bookings are cut after)
      changeStock(ctx, sid, g.m, -q);
      addFlow(ctx, g.m, 'disposed', q);
      shortClaims(ctx, sid, g.m, 'were taken in the night');
      room -= q * g.kg;
      taken.push(`${fmtQty(q)} ${material(ctx, g.m).unit} ${material(ctx, g.m).label}`);
    }
    if (taken.length) ctx.log('warn', `In the night, ${st.for ? 'goods set down at the roadside' : 'goods left by the road'} at ${st.label} were taken: ${taken.join(', ')}. Nobody of ours was by them.`, [sid]);
  }
}

/**
 * Goods claimed in a store (sold, sent off, a carrier coming for them) of which less is there than is claimed (gone in a
 * theft, rotted or gone off into another good): the claims cut by what is missing, the latest first; a sale or haul left
 * with nothing is off, said (review x, y): the one function whatever takes claimed goods away goes through
 */
function shortClaims(ctx: WriteCtx, store: EntityId, mat: string, why: string): void {
  let short = tidy(claimed(ctx, store, mat) - (ctx.get('Store', store)?.contents[mat] ?? 0));
  if (!(short > EPS)) return;
  const m = material(ctx, mat);
  // (a carrier of ours coming to load: it takes what is there)
  for (const [id, pk] of Object.entries(ctx.state('inventory').pickups ?? {}).reverse()) {
    if (short <= EPS || pk.store !== store || pk.material !== mat) continue;
    const cut = Math.min(short, pk.qty);
    short -= cut;
    ctx.setState('inventory', { ...ctx.state('inventory'), pickups: { ...ctx.state('inventory').pickups, [id]: { ...pk, qty: tidy(pk.qty - cut) } } });
  }
  const outs = openOrders(ctx).filter(([, o]) => o.direction === 'outbound' && o.store === store && o.material === mat).sort(([, a], [, b]) => b.orderedAt - a.orderedAt);
  for (const [id, o] of outs) {
    if (short <= EPS) break;
    const waiting = Math.max(0, o.qty - o.delivered - o.inTransit);
    const cut = Math.min(short, waiting);
    if (!(cut > EPS)) continue;
    short -= cut;
    const qty = tidy(o.qty - cut);
    const status = settled({ ...o, qty });
    writeOrder(ctx, id, { ...o, qty, status });
    if (status === 'complete') ctx.emit('inventory.orderComplete', { order: id });
    const buyer = ctx.data('suppliers')[o.supplier]?.label ?? o.supplier;
    ctx.log('warn', `${fmtQty(cut)} ${m.unit} ${m.label} ${o.sale ? `sold to ${buyer}` : `to go to ${buyer}`} ${why}: ${status === 'open' ? `the ${o.sale ? 'sale' : 'haul'} is ${fmtQty(qty)} ${m.unit} now` : `the ${o.sale ? 'sale' : 'haul'} is off`}.`, [id, store]);
  }
}

function season(ctx: WriteCtx, off: boolean): void {
  const all = ctx.state('inventory').seasoning ?? {};
  for (const key of Object.keys(all).sort()) {
    const [sid, id] = key.split('|') as [EntityId, string];
    const store = ctx.get('Store', sid);
    const m = ctx.data('materials')[id];
    const s = m ? turns(m) : undefined;
    // (seasoning by the day; what goes off, by the hour)
    if (!store || !m || !s || s.off !== off) continue;
    const ripe = (all[key] ?? []).filter((l) => ctx.now - l.since >= s.after).reduce((a, l) => a + l.qty, 0);
    if (ripe <= EPS) continue;
    const into = material(ctx, s.into);
    const qty = (ripe * unitMass(m) * s.keeps) / unitMass(into);
    // (the oldest go first: those are the ripe ones)
    // (a transform: what dries off goes to the air)
    const taken = Math.min(ripe, store.contents[id] ?? 0);
    changeStock(ctx, sid, id, -taken);
    addFlow(ctx, id, 'used', taken);
    // (what of it was sold or sent off is gone with it: its claims cut, said: review y)
    shortClaims(ctx, sid, id, `have turned into ${into.label.toLowerCase()} where they lay`);
    changeStock(ctx, sid, s.into, qty);
    addFlow(ctx, s.into, 'made', qty);
    sinkMass(ctx, 'air', taken * unitMass(m) - qty * unitMass(into));
    const r1 = (x: number) => Math.round(x * 10) / 10;
    // (crumbs left from what was used go off unsaid: what is said is what is worth a word)
    if (s.off && !(r1(ripe) > 0)) continue;
    if (s.off) ctx.log('warn', `${store.label}: ${r1(ripe)} ${m.unit} of ${m.label} not placed within ${r1(m.perishableHours!.value)} h of batching has gone off: ${r1(qty)} ${into.unit} of ${into.label} now.`, [sid]);
    else ctx.log('info', `${store.label}: ${Math.round(ripe * 10) / 10} ${m.unit} of ${m.label.toLowerCase()} has seasoned into ${Math.round(qty * 10) / 10} ${into.unit} of ${into.label.toLowerCase()}.`, [sid]);
  }
}

/**
 * Change a store's stock. A good that seasons, or one that keeps the age it has had in use (a tent
 * struck), is kept as lots: by when they began to season (what goes out goes from the oldest), or by
 * their age (the least worn goes out first). What comes in is a lot of its own, with the age it brings;
 * returned: when what went out began to season, and its age, on average (for it to keep them elsewhere).
 */
export type Part = { qty: number; since: number; age?: number };

function changeStock(ctx: WriteCtx, store: EntityId, mat: string, delta: number, lot: { since?: number; age?: number; parts?: Part[] } = {}): { since?: number; age?: number; parts?: Part[] } {
  const st = ctx.require('Store', store);
  writeStore(ctx, store, { ...st.contents, [mat]: (st.contents[mat] ?? 0) + delta });
  const m = material(ctx, mat);
  // (what is built in has been placed: ready-mix in a structure has set as it was meant to, G7)
  if ((!turns(m) && !m.keepsAge) || Math.abs(delta) <= EPS || (st.kind === 'built' && turns(m)?.off)) return {};
  const key = `${store}|${mat}`;
  const all = ctx.state('inventory').seasoning ?? {};
  const order = (a: { since: number; age?: number }, b: { since: number; age?: number }) => (m.keepsAge ? (a.age ?? 0) - (b.age ?? 0) : a.since - b.since);
  let lots = (all[key] ?? []).map((l) => ({ ...l }));
  const out: { since?: number; age?: number; parts?: Part[] } = {};
  if (delta > 0) {
    // the lots it comes in as (moved from another store of ours: as they were there), the rest as one
    // (no more of them than comes in)
    const parts: Part[] = [];
    let room = delta;
    for (const x of lot.parts ?? []) {
      const q = Math.min(room, x.qty);
      if (q > EPS) parts.push({ ...x, qty: q });
      room -= q;
    }
    const given = parts.reduce((a, x) => a + x.qty, 0);
    const rest = delta - given;
    lots = [...lots, ...parts.map((x) => ({ qty: x.qty, since: x.since, ...(m.keepsAge ? { age: x.age ?? 0 } : {}) })), ...(rest > EPS ? [{ qty: rest, since: lot.since ?? ctx.now, ...(m.keepsAge ? { age: lot.age ?? 0 } : {}) }] : [])].sort(order);
  } else {
    let cut = -delta;
    let mass = 0;
    let since = 0;
    let age = 0;
    const parts: Part[] = [];
    for (const l of lots) {
      if (cut <= EPS) break;
      const d = Math.min(cut, l.qty);
      l.qty -= d;
      cut -= d;
      mass += d;
      since += d * l.since;
      age += d * (l.age ?? 0);
      parts.push({ qty: d, since: l.since, ...(l.age !== undefined ? { age: l.age } : {}) });
    }
    lots = lots.filter((l) => l.qty > EPS);
    if (mass > EPS) {
      if (turns(m)) out.since = since / mass;
      if (m.keepsAge) out.age = age / mass;
      out.parts = parts;
    }
  }
  const { [key]: _was, ...rest } = all;
  ctx.patchState('inventory', { seasoning: lots.length ? { ...rest, [key]: lots } : rest });
  return out;
}

/** a lamp one setting out at `at` would take along: none if they carry one; else one free in a store of their party's by them (S7) */
function lampFor(read: ReadCtx, unit: EntityId, at: Vec2): { store: EntityId; material: string } | undefined {
  const mats = read.data('materials');
  const isLamp = (m: string) => Boolean(mats[m]?.light);
  for (const [, st] of read.all('Store')) if (st.on === unit && Object.entries(st.contents).some(([m, q]) => q > EPS && isLamp(m))) return undefined;
  const wf = read.hasPort('workforce') ? read.port('workforce') : undefined;
  if (!wf || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) return undefined;
  const reach = reachOf(read);
  for (const [sid, st] of [...read.all('Store')].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (st.on !== undefined || Math.hypot(st.pos[0] - at[0], st.pos[1] - at[1]) > reach) continue;
    if (!(wf.members(st.holder).includes(unit) || wf.staff(st.holder).includes(unit))) continue;
    const material = Object.keys(st.contents).sort().find((m) => isLamp(m) && free(read, sid, m) >= 1 - EPS);
    if (material) return { store: sid, material };
  }
  return undefined;
}

const NO_FLOWS: MaterialFlows = { stocked: 0, delivered: 0, extracted: 0, made: 0, used: 0, released: 0, disposed: 0, transit: 0 };

/** the lots `qty` would take from a store (the least worn or oldest first), after the first `skip` (claimed already), without taking them */
function lotsOf(read: ReadCtx, store: EntityId, mat: string, qty: number, skip = 0): LotPart[] {
  const m = material(read, mat);
  if (!turns(m) && !m.keepsAge) return [];
  const order = (a: { since: number; age?: number }, b: { since: number; age?: number }) => (m.keepsAge ? (a.age ?? 0) - (b.age ?? 0) : a.since - b.since);
  const out: LotPart[] = [];
  let left = qty;
  let skipped = skip;
  for (const l0 of [...(read.state('inventory').seasoning?.[`${store}|${mat}`] ?? [])].sort(order)) {
    if (left <= EPS) break;
    const s0 = Math.min(skipped, l0.qty);
    skipped -= s0;
    const l = { ...l0, qty: l0.qty - s0 };
    if (l.qty <= EPS) continue;
    const q = Math.min(left, l.qty);
    out.push({ ...l, qty: q });
    left -= q;
  }
  return out;
}

function addFlow(ctx: WriteCtx, mat: string, key: keyof MaterialFlows, qty: number): void {
  const st = ctx.state('inventory');
  const f = st.flows[mat] ?? NO_FLOWS;
  ctx.setState('inventory', { ...st, flows: { ...st.flows, [mat]: { ...f, [key]: tidy(f[key] + qty) } } });
}

/** what has gone to a sink, by mass (kg): the air, the ground (the per-material books say which goods; this says how much) */
function sinkMass(ctx: WriteCtx, sink: Sink, kg: number): void {
  if (!(Math.abs(kg) > 1e-9)) return;
  const st = ctx.state('inventory');
  ctx.setState('inventory', { ...st, sinks: { ...st.sinks, [sink]: tidy((st.sinks?.[sink] ?? 0) + kg) } });
}

/** goods into a holding: a vessel takes only what it is for, and no more than it holds */
function putIn(ctx: WriteCtx, store: EntityId, mat: string, qty: number, lot: Lots = {}): void {
  intoVessel(ctx, store, mat);
  const st = ctx.require('Store', store);
  // (energy is held only in a battery: never in a heap, a pack or a vehicle's load)
  if (material(ctx, mat).unit === 'kWh' && st.kind !== 'battery' && qty > 0) ctx.reject('inventory.notABattery', { store: st.label, material: material(ctx, mat).label });
  if (st.capacity !== undefined && (st.contents[mat] ?? 0) + qty > st.capacity + 1e-6) {
    const m = material(ctx, mat);
    ctx.reject('inventory.full', { store: st.label, capacity: st.capacity, unit: m.unit, have: tidy(st.contents[mat] ?? 0), qty: tidy(qty), material: m.label });
  }
  changeStock(ctx, store, mat, qty, lot);
}

/** room in a vessel for so much more, what is on order to it counted */
function fits(ctx: WriteCtx, store: EntityId, mat: string, qty: number): void {
  const st = ctx.require('Store', store);
  if (st.capacity === undefined) return;
  const have = (st.contents[mat] ?? 0) + onOrder(ctx, store, mat);
  if (have + qty > st.capacity + 1e-6) {
    const m = material(ctx, mat);
    ctx.reject('inventory.full', { store: st.label, capacity: st.capacity, unit: m.unit, have: tidy(have), qty: tidy(qty), material: m.label });
  }
}

/**
 * What of a good in a store is claimed (design/physical-state.md, decision point 8: a choice is explicit): sold or sent
 * for disposal and not yet loaded. Nothing else draws it; the haul that loads it does.
 */
/** what of a good in a store no order or carrier has claimed */
const free = (read: ReadCtx, store: EntityId, mat: string): number => Math.max(0, tidy((read.get('Store', store)?.contents[mat] ?? 0) - claimed(read, store, mat)));

function claimed(read: ReadCtx, store: EntityId, mat: string, except?: EntityId): number {
  let q = 0;
  for (const [id, pk] of Object.entries(read.state('inventory').pickups ?? {})) if (id !== except && pk.store === store && pk.material === mat) q += pk.qty;
  for (const [id, o] of openOrders(read)) if (id !== except && o.direction === 'outbound' && o.store === store && o.material === mat) q += Math.max(0, o.qty - o.delivered - o.inTransit);
  return tidy(q);
}

/** goods out of a holding: there and not claimed by another (a sale, a haul: `claim` is the order that may take them), or refused */
function takeOut(ctx: WriteCtx, store: EntityId, mat: string, qty: number, claim?: EntityId): Lots {
  const st = ctx.require('Store', store);
  const held = claimed(ctx, store, mat, claim);
  const have = Math.max(0, (st.contents[mat] ?? 0) - held);
  // (stores keep quantities to a millionth: what differs by less is all of it)
  if (have + ROUND < qty) {
    if (held > EPS) {
      const m = material(ctx, mat);
      ctx.reject('inventory.claimed', { store: st.label, material: m.label, have: tidy(have), held, need: qty, unit: m.unit });
    }
    const m = material(ctx, mat);
    ctx.reject('inventory.insufficient', { store: st.label, material: m.label, have: tidy(have), need: qty, unit: m.unit }, orderRemedy(ctx, store, mat, qty - have));
  }
  return changeStock(ctx, store, mat, -Math.min(qty, st.contents[mat] ?? 0));
}

/** where a holding is now: a riding one where its unit is (as the modules that keep units say) */
function placeOf(read: ReadCtx, store: EntityId): Vec2 | undefined {
  const st = read.get('Store', store);
  if (!st) return undefined;
  // (riding with a unit: where the unit is, as the moves module keeps it; with it beyond the map, nowhere here)
  if (st.on) return read.port('moves').placeOf(st.on) ? read.port('moves').where(st.on) : st.pos;
  return st.pos;
}

/** the reach within which goods change holdings by hand, without a carry (the practice's handling reach) */
const reachOf = (read: ReadCtx): number => (read.hasData('handling') ? ((read.data('handling') as { reach?: { value: number } }).reach?.value ?? 15) : 15);

/**
 * Where a good is drawn from at a store: the store itself; for energy, the batteries of its holder at the same place
 * (along a cable within reach), those whose output carries the draw (kW, if said), the fullest first
 */
function sources(read: ReadCtx, store: EntityId, mat: string, draw?: number): EntityId[] {
  const m = material(read, mat);
  if (m.unit !== 'kWh') return [store];
  const user = userOf(read, store);
  if (!user) return [];
  const out: EntityId[] = [];
  for (const [id, b] of read.all('Store')) {
    if (b.kind !== 'battery' || !(b.contents[mat]! > EPS) || userOf(read, id) !== user) continue;
    if (draw !== undefined && (b.rate ?? Infinity) + 1e-9 < draw) continue;
    if (id === store || together(read, store, id)) out.push(id);
  }
  return out.sort((a, b) => (read.get('Store', b)!.contents[mat] ?? 0) - (read.get('Store', a)!.contents[mat] ?? 0) || (a < b ? -1 : 1));
}

/** who uses a holding: its holder; one riding on a unit lent out is its borrower's to use (as the lending module says) */
function userOf(read: ReadCtx, store: EntityId): EntityId | undefined {
  const st = read.get('Store', store);
  if (!st) return undefined;
  if (st.on) for (const c of read.contributions('holdingUser')) {
    const u = c.impl(read, st.on);
    if (u) return u;
  }
  return st.holder;
}

/** two holdings at the same place: within the handling reach of each other; a work's fronts and what is built into it are (the material is built in where its fronts are) */
function together(read: ReadCtx, a: EntityId, b: EntityId): boolean {
  const sa = read.get('Store', a);
  const sb = read.get('Store', b);
  if (sa?.work && sa.work === sb?.work && (sa.kind === 'built' || sb.kind === 'built')) return true;
  // a flow's loads on the road are at both ends of it: the one declared exception (design/physical-state.md I5)
  if (sa?.kind === 'transit' || sb?.kind === 'transit') return true;
  const p = placeOf(read, a);
  const q = placeOf(read, b);
  return Boolean(p && q && Math.hypot(p[0] - q[0], p[1] - q[1]) <= reachOf(read) + 1e-6);
}

/** the modules that own each nature: only they draw from it (the ground and its water are the terrain's: design/physical-state.md §5; felled trees production's, from the vegetation) */
const NATURE: Record<Nature, string[]> = { ground: ['terrain'], trees: ['production', 'terrain'], rain: ['structures'], water: ['terrain'], sun: ['equipment'] };

/** water drawn on a move (at its first leg's end), into a store: from the water there, by the terrain that keeps it (§5) */
function drawnInto(ctx: WriteCtx, move: EntityId, into: EntityId, g: { material: string; qty: number; since?: number; age?: number; parts?: LotPart[] }): void {
  const at = ctx.get('Move', move)?.legs[0]?.route.to;
  const m = material(ctx, g.material);
  const m3 = (g.qty * unitMass(m)) / 1000;
  if (!at) return;
  ctx.command('terrain.draw', { at: [at[0], at[1]], material: g.material, qty: g.qty, m3, into, why: 'drawn' });
}
/** the modules at the world's edge besides inventory's own deliveries and hauls: a dealer's machine with its tank, a firm's site supplies; the quarry's scripted sales (a declared deviation); what a bailiff takes away from a yard cleared (land, § 885 ZPO) */
const EDGE = ['equipment', 'production', 'quarry', 'living', 'land'];

/**
 * An order's status once what is still to come of it is known: open while anything of it is still to come or on the
 * road; else complete when something of it was delivered or collected (short, if less than ordered), called off when
 * nothing was (one function for every way an order ends short: review y, a sale whose goods were gone ended 'complete')
 */
function settled(o: Pick<Order, 'qty' | 'delivered' | 'inTransit' | 'collecting' | 'status'>): Order['status'] {
  const open = o.qty - o.delivered - o.inTransit - (o.collecting ?? 0) > EPS || o.inTransit + (o.collecting ?? 0) > EPS;
  return open ? o.status : o.delivered > EPS ? 'complete' : 'cancelled';
}

/**
 * An order written: what goes with a load to come (its try, its lateness) is kept only as long as that load is still to
 * come (one record, the order's loads: review x), and the supplier's lateness is said as long as a load drawn late is
 */
function writeOrder(ctx: WriteCtx, id: EntityId, o: Order): void {
  const { loadInfo: info0, ...rest } = o;
  const info = o.status === 'open' ? (info0 ?? []).filter((x) => o.loads?.includes(x.slot)) : [];
  const out: Order = { ...rest, delivered: tidy(o.delivered), inTransit: tidy(o.inTransit), ...(info.length ? { loadInfo: info } : {}) };
  ctx.set('Order', id, out);
  // (the index of open orders: in while open, out once it ends)
  const st = ctx.state('inventory');
  if ((out.status === 'open') !== (st.open ?? []).includes(id)) ctx.setState('inventory', { ...st, open: out.status === 'open' ? [...(st.open ?? []), id] : (st.open ?? []).filter((x) => x !== id) });
  // (no longer open: nothing of it is overdue any more)
  if (out.status !== 'open' && ctx.blockersOf(id).some((b) => b.code === 'inventory.overdue')) news(ctx, id, 'inventory.overdue', null);
  const late = info.filter((x) => x.late).map((x) => x.slot);
  const sup = ctx.data('suppliers')[o.supplier];
  if (late.length && sup) news(ctx, id, 'inventory.supplierLate', { severity: 'info', params: { supplier: sup.label, at: ctx.calendar.format(Math.max(...late)) } });
  else if (ctx.blockersOf(id).some((b) => b.code === 'inventory.supplierLate')) news(ctx, id, 'inventory.supplierLate', null);
}

/** the open orders (inventory's index, kept by `writeOrder`), in the order they were made: what can still come, be late or hold the yard; never every order ever made (decision 0025; 0028 rule 4, a named population) */
function openOrders(read: ReadCtx): [EntityId, Readonly<Order>][] {
  const out: [EntityId, Readonly<Order>][] = [];
  for (const id of read.state('inventory').open ?? []) {
    const o = read.get('Order', id);
    if (o?.status === 'open') out.push([id, o]);
  }
  return out;
}

/** a load's try (1, or more after one nobody came for), as its order keeps it with the load */
const attemptOf = (o: Readonly<Order>, slot: number | undefined): number => (slot === undefined ? undefined : o.loadInfo?.find((x) => x.slot === slot)?.attempt) ?? 1;

/** the store; a player may act only on the stores its party holds (modules acting for the world may) */
/** a store that is a vessel for some goods only (a rain barrel) refuses others */
function intoVessel(ctx: WriteCtx, store: EntityId, mat: string): void {
  const st = ctx.get('Store', store);
  if (st?.holds && !st.holds.includes(mat)) ctx.reject('inventory.vessel', { store: st.label, material: material(ctx, mat).label, holds: st.holds.map((m) => material(ctx, m).label).join(', ') });
}

function requireStore(ctx: WriteCtx, id: EntityId): Readonly<Store> {
  const st = ctx.get('Store', id);
  if (!st) ctx.reject('inventory.unknownStore', { store: id });
  if (ctx.caller === 'client' && st.holder !== actorOf(ctx)) ctx.reject('inventory.notOurs', { store: st.label, party: partyLabel(ctx, actorOf(ctx)) });
  return st;
}

/** purchases of fuel are a fuel expense, everything else a materials expense */
function purchaseAccount(mat: Material): typeof ACCOUNTS.fuel | typeof ACCOUNTS.materials {
  return mat.category === 'fuel' ? ACCOUNTS.fuel : ACCOUNTS.materials;
}

function requireMaterial(ctx: WriteCtx, id: string): Material {
  const m = ctx.data('materials')[id];
  if (!m) ctx.reject('inventory.unknownMaterial', { material: id });
  return m;
}

const fmtQty = (q: number) => (Math.abs(q) >= 100 ? q.toFixed(0) : q.toFixed(2));

/** a day a supplier loads and works: a loading day of the usual week (`supplierWeek`), and no public holiday */
function workingDay(read: ReadCtx, day: number): boolean {
  return read.data('supplierWeek').loading.includes(read.calendar.at(day).weekday) && !(read.hasPort('workforce') && read.port('workforce').holiday(day + HOUR));
}

/**
 * A supplier's stock of a good (8c, finding 18; review r43): what it had (`qty`) at `at`, and the takes booked from then
 * on (loads at their slots, a sale over the counter, each by its order). It is made or restocked at `perDay` over its
 * working hours (a plant's 600 m³ a day in its ten hours: 60 m³ an hour), up to what it holds; ahead of a load it makes
 * as much as that load (a plant mixes into the lorry, a shop sets an order's goods aside).
 */
interface Stock { held: number; perDay: number; sup: Supplier; qty: number; at: number; takes: StockTake[] }
type StockTake = { t: number; qty: number; order?: EntityId };

/** a supplier's stock of a good; `without`: as if an order's takes booked after now were not (to ask whether its goods are there now) */
function stockOf(read: ReadCtx, supplierId: string, materialId: string, without?: EntityId): Stock | undefined {
  const stock = offersOf(read).buy[materialId]?.find((o) => o.supplier === supplierId)?.stock;
  const sup = read.data('suppliers')[supplierId];
  if (!stock || !sup) return undefined;
  const was = read.state('inventory').stocks?.[`${supplierId}|${materialId}`];
  const takes = (was?.takes ?? []).filter((k) => without === undefined || k.order !== without || k.t <= read.now);
  return { ...stock, sup, qty: was?.qty ?? stock.held, at: was?.at ?? Number.NEGATIVE_INFINITY, takes };
}

/** its rate an hour of working time */
const stockRate = (st: Stock) => st.perDay / Math.max(1, (st.sup.openTo.value - st.sup.openFrom.value) * HOUR);

/** what it has from `level` at t1 by t2, made or restocked over its working hours, up to `cap` */
function filled(read: ReadCtx, st: Stock, level: number, t1: number, t2: number, cap: number): number {
  if (!(t2 > t1) || level >= cap || !(st.perDay > 0)) return level;
  if (!Number.isFinite(t1)) return cap;
  let lv = level;
  for (let day = read.calendar.startOfDay(t1); day < t2 && lv < cap; day += DAY) {
    if (!workingDay(read, day)) continue;
    const from = Math.max(t1, day + st.sup.openFrom.value * HOUR);
    const to = Math.min(t2, day + st.sup.openTo.value * HOUR);
    if (to > from) lv += stockRate(st) * (to - from);
  }
  return Math.min(cap, lv);
}

/** the earliest time ≥ t1 by which `level` has grown to `need` over its working hours; never: Infinity */
function filledBy(read: ReadCtx, st: Stock, level: number, t1: number, need: number): number {
  if (level >= need - EPS) return t1;
  if (!(st.perDay > 0)) return Number.POSITIVE_INFINITY;
  let lv = level;
  // (within a year)
  for (let day = read.calendar.startOfDay(t1), n = 0; n < 366; day += DAY, n += 1) {
    if (!workingDay(read, day)) continue;
    const from = Math.max(t1, day + st.sup.openFrom.value * HOUR);
    const to = day + st.sup.openTo.value * HOUR;
    if (!(to > from)) continue;
    if (lv + stockRate(st) * (to - from) >= need - EPS) return Math.ceil(from + (need - lv) / stockRate(st));
    lv += stockRate(st) * (to - from);
  }
  return Number.POSITIVE_INFINITY;
}

/** what it has at t (the takes up to t done), and what is left after each take booked */
function levels(read: ReadCtx, st: Stock, t: number): { now: number; after: { t: number; left: number }[] } {
  let lv = st.qty;
  let at = st.at;
  let now: number | undefined;
  const after: { t: number; left: number }[] = [];
  for (const k of st.takes) {
    if (now === undefined && k.t > t) now = filled(read, st, lv, at, t, st.held);
    lv = Math.max(0, filled(read, st, lv, at, k.t, Math.max(st.held, k.qty)) - k.qty);
    at = k.t;
    after.push({ t: k.t, left: lv });
  }
  return { now: now ?? filled(read, st, lv, at, t, st.held), after };
}

/**
 * What a supplier can still give of a good at t: what it has then, as far as the loads booked after t leave it enough
 * (taken now, it would be missing from them); as much as wanted when its offer says nothing
 */
function stockAt(read: ReadCtx, supplierId: string, materialId: string, t: number): number {
  const st = stockOf(read, supplierId, materialId);
  if (!st) return Number.POSITIVE_INFINITY;
  const lv = levels(read, st, t);
  return Math.min(lv.now, ...lv.after.filter((a) => a.t > t).map((a) => a.left));
}

/** the earliest time ≥ t a supplier can give `qty` of a good (made or restocked meanwhile, the loads booked kept, but those of `without` still to come); never: Infinity */
function stockReady(read: ReadCtx, supplierId: string, materialId: string, qty: number, t: number, without?: EntityId): number {
  const st = stockOf(read, supplierId, materialId, without);
  if (!st) return t;
  const lv = levels(read, st, t);
  // from t, else from each take booked after it: filled up until the next take, as far as the later ones keep enough
  const later = lv.after.filter((a) => a.t > t);
  const starts = [{ t, left: lv.now }, ...later];
  for (let i = 0; i < starts.length; i += 1) {
    const rest = later.slice(i);
    if (rest.some((a) => a.left < qty - EPS)) continue;
    const ready = filledBy(read, st, starts[i]!.left, starts[i]!.t, qty);
    if (ready <= (rest[0]?.t ?? Number.POSITIVE_INFINITY)) return ready;
  }
  return Number.POSITIVE_INFINITY;
}

/** the stock written back, the takes before now folded into what it had */
function writeStock(ctx: WriteCtx, supplierId: string, materialId: string, st: Stock): void {
  const takes = [...st.takes].sort((a, b) => a.t - b.t);
  let qty = st.qty;
  let at = st.at;
  while (takes.length && takes[0]!.t < ctx.now) {
    const k = takes.shift()!;
    qty = Math.max(0, filled(ctx, st, qty, at, k.t, Math.max(st.held, k.qty)) - k.qty);
    at = k.t;
  }
  const inv = ctx.state('inventory');
  ctx.setState('inventory', { ...inv, stocks: { ...(inv.stocks ?? {}), [`${supplierId}|${materialId}`]: { qty, at: Number.isFinite(at) ? at : ctx.now, takes } } });
}

/** taken from a supplier's stock at t (a load at its slot, a sale over the counter now), for an order */
function takeStock(ctx: WriteCtx, supplierId: string, materialId: string, qty: number, t: number, order?: EntityId): void {
  const st = stockOf(ctx, supplierId, materialId);
  if (st) writeStock(ctx, supplierId, materialId, { ...st, takes: [...st.takes, { t, qty, ...(order ? { order } : {}) }] });
}

/**
 * Goods of an order that are the supplier's again (called off before they left, or back on its lorry): booked no more,
 * its latest takes first; what was taken off its shelf already is on it again (8c: the outside world is finite, and
 * what comes back is there again; review x)
 */
function releaseStock(ctx: WriteCtx, supplierId: string, materialId: string, order: EntityId, qty: number): void {
  const st = stockOf(ctx, supplierId, materialId);
  if (!st) return;
  let rest = qty;
  const takes = [...st.takes];
  for (let i = takes.length - 1; i >= 0 && rest > EPS; i -= 1) {
    if (takes[i]!.order !== order) continue;
    const back = Math.min(rest, takes[i]!.qty);
    rest -= back;
    if (takes[i]!.qty - back > EPS) takes[i] = { ...takes[i]!, qty: takes[i]!.qty - back };
    else takes.splice(i, 1);
  }
  writeStock(ctx, supplierId, materialId, { ...st, takes });
  if (rest > EPS) {
    const now = stockOf(ctx, supplierId, materialId)!;
    writeStock(ctx, supplierId, materialId, { ...now, qty: now.qty + rest });
  }
}

/** an order's load taken from the shelf now (it leaves on a lorry sooner than it was booked: a tour), not at its later booking */
function takeNow(ctx: WriteCtx, supplierId: string, materialId: string, order: EntityId, qty: number): void {
  const st = stockOf(ctx, supplierId, materialId);
  if (!st) return;
  let rest = qty;
  const takes = [...st.takes].sort((a, b) => a.t - b.t);
  for (let i = 0; i < takes.length && rest > EPS; i += 1) {
    if (takes[i]!.order !== order || takes[i]!.t <= ctx.now) continue;
    const moved = Math.min(rest, takes[i]!.qty);
    rest -= moved;
    takes[i] = { ...takes[i]!, qty: takes[i]!.qty - moved };
  }
  if (qty - rest > EPS) writeStock(ctx, supplierId, materialId, { ...st, takes: [...takes.filter((k) => k.qty > EPS), { t: ctx.now, qty: qty - rest, order }] });
}

/**
 * Schedule the truckloads of an order: loading slots at the supplier within opening hours,
 * spaced 20–40 min apart per supplier; each truck enters the map after the external leg.
 */
/**
 * A supplier's loading calendar (S5b; a calendar, not a cursor: a load booked days ahead for goods not made yet does not
 * hold up one whose goods are ready sooner, Qwen S509): when its lorries are loaded for the loads still to come of its
 * open orders, read from those loads (one record: a load called off, gone on another lorry or no longer to come holds
 * no time at the yard; review x)
 */
function bookedOf(read: ReadCtx, supplierId: string): number[] {
  const sup = read.data('suppliers')[supplierId];
  if (!sup) return [];
  const leg = externalLegS(read, sup, supplierId);
  const out: number[] = [];
  for (const [, o] of openOrders(read)) if (o.supplier === supplierId && o.loads) for (const t of o.loads) out.push(o.direction === 'outbound' ? t : t - leg);
  return out.sort((a, b) => a - b);
}

/**
 * The first loading time from t that no other load holds at a supplier's yard (one lorry loaded after another, at least
 * `LOADING_INTERVAL_MIN` apart), within its loading hours: the one booking of its calendar, for first loads and for loads
 * booked again (blocked, nobody came) alike (decision 0028 rule 4; review y: a try again booked into a taken minute)
 */
function freeSlot(ctx: ReadCtx, sup: Supplier, t: number, booked: readonly number[]): number {
  const gap = LOADING_INTERVAL_MIN * MINUTE;
  let at = alignToOpening(ctx, sup, t);
  for (let i = 0; i < 1000 && booked.some((b) => Math.abs(b - at) < gap); i += 1) at = alignToOpening(ctx, sup, Math.max(...booked.filter((b) => Math.abs(b - at) < gap)) + gap);
  return at;
}

function scheduleTrucks(ctx: WriteCtx, orderId: EntityId, sup: Supplier, supplierId: string, mat: Material, qty: number, earliest: number, timer: 'truck' | 'haul', materialId?: string): number {
  const perTruck = truckLoad(ctx, sup.vehicleProfile, mat);
  if (!(perTruck > 0)) ctx.reject('inventory.noPayload', { profile: sup.vehicleProfile, material: mat.label });
  const rng = ctx.rng(`loading:${supplierId}`);
  // (its calendar from now on: what is past is gone)
  const booked = bookedOf(ctx, supplierId).filter((t) => t >= ctx.now - DAY);
  let slot = earliest;
  let busyFirst = false;
  const leg = timer === 'truck' ? externalLegS(ctx, sup, supplierId) : 0;
  let left = qty;
  let trucks = 0;
  let first = Number.POSITIVE_INFINITY;
  let waited = false;
  let last = Number.NEGATIVE_INFINITY;
  const slots: number[] = [];
  while (left > EPS) {
    const load = Math.min(perTruck, left);
    slot = alignToOpening(ctx, sup, slot);
    // (a load leaves when the supplier has it: what it holds, then as it is made or restocked: 8c; a plant mixes it while
    // the lorry before is loaded); one that waits longer for its goods leaves the lorries to others meanwhile (review r43)
    let at = slot;
    let waits = false;
    if (materialId) {
      const ready = stockReady(ctx, supplierId, materialId, load, slot);
      if (!Number.isFinite(ready)) break;
      if (ready > slot) at = alignToOpening(ctx, sup, ready);
      waits = at - slot > LOADING_INTERVAL_MIN * MINUTE;
    }
    // (a time no other load holds at the yard: later when its lorries are booked then)
    const free = freeSlot(ctx, sup, at, booked);
    if (trucks === 0 && free - at > HOUR) busyFirst = true;
    at = free;
    booked.push(at);
    if (materialId) takeStock(ctx, supplierId, materialId, load, at, orderId);
    waited ||= waits;
    first = Math.min(first, at + leg);
    last = Math.max(last, at);
    // the lorry leaves the yard at its slot; the way to the map is part of its move (a collector's: it comes to load then)
    ctx.at(at, timer, { order: orderId, qty: tidy(load), slot: Math.round(at + leg) });
    slots.push(Math.round(at + leg));
    left -= load;
    trucks += 1;
    slot = at + Math.round(rng.range(LOADING_INTERVAL_MIN, LOADING_INTERVAL_MAX) * MINUTE);
  }
  // (what it is expected for: the order says it, and so does what is on the way, S420)
  const o = ctx.get('Order', orderId);
  if (o && Number.isFinite(first)) writeOrder(ctx, orderId, { ...o, ...(slots.length ? { loads: [...(o.loads ?? []), ...slots] } : {}), expected: Math.round(first) });
  // what comes, and in how many loads (the supplier's lorries come as its fleet allows: S413, not so many trucks); later
  // than it could be when they are busy, said so
  const what = `${fmtQty(qty)} ${mat.unit} of ${mat.label} ${timer === 'haul' ? 'to' : 'from'} ${sup.label}`;
  const busy = `${busyFirst ? ' (its lorries are booked then: later than it could be)' : ''}${waited ? ' (more than it has in stock: the rest as it is made or restocked)' : ''}`;
  ctx.log(busy ? 'warn' : 'info', `${Number.isFinite(perTruck) && trucks > 1 ? `${what} in ${trucks} loads (a load up to ${fmtQty(perTruck)} ${mat.unit} each), first ${ctx.calendar.format(first)}, the last load ${ctx.calendar.format(last + leg)}` : `${what} in one load${Number.isFinite(perTruck) ? ` (up to ${fmtQty(perTruck)} ${mat.unit})` : ''}, ${ctx.calendar.format(first)}`}${busy}`, [orderId]);
  return trucks;
}

/**
 * Goods on the way (stock not yet in our hands): for each open purchase, what is under way and when it
 * arrives, what has not left yet and from when it is due, and the hazards that could delay it, as the
 * world's own numbers (the supplier's punctuality, the lorry's rate of breakdowns), never a score.
 */
/**
 * The supplier's other orders a lorry takes along (S5b, a tour): open, for the same store, by the same terms, one load
 * left, booked for today and its goods at the yard now (a load booked later because it is made by then does not leave
 * before it is: review x), as much as the lorry carries besides what it is sent for (each load its share of what the
 * lorry carries of that good, by mass and by volume: `truckLoad`). A body that is tipped, pumped or discharged holds one
 * good: only more of the same rides in it; separate goods ride side by side on a bed (pallets, bars, pipes). Each comes
 * with its own try, as its order keeps it.
 */
function tourOf(ctx: ReadCtx, id: EntityId, o: Readonly<Order>, qty: number): (LorryLoad & { slot: number })[] {
  const sup = ctx.data('suppliers')[o.supplier]!;
  const prof = ctx.port('routing').profile(sup.vehicleProfile);
  const oneBody = prof.unloading !== undefined && ['tip', 'pump', 'discharge'].includes(prof.unloading.kind);
  const share = (m: string, q: number) => {
    const per = truckLoad(ctx, sup.vehicleProfile, material(ctx, m));
    return per > 0 ? q / per : Number.POSITIVE_INFINITY;
  };
  let used = share(o.material, qty);
  const end = ctx.calendar.startOfDay(ctx.now) + DAY;
  const out: (LorryLoad & { slot: number })[] = [];
  for (const [cid, c] of openOrders(ctx)) {
    if (cid === id || c.supplier !== o.supplier || c.store !== o.store || c.direction === 'outbound' || c.carried || handoverOf(ctx, c) !== handoverOf(ctx, o)) continue;
    if (c.loads?.length !== 1 || c.loads[0]! > end || (oneBody && c.material !== o.material)) continue;
    const left = tidy(c.qty - c.delivered - c.inTransit);
    if (!(left > EPS) || used + share(c.material, left) > 1 + 1e-9) continue;
    // (its goods there now: what the supplier has, its own later take aside, the others' kept: one fact, `stockReady`)
    if (stockReady(ctx, c.supplier, c.material, left, ctx.now, cid) > ctx.now) continue;
    used += share(c.material, left);
    out.push({ order: cid, material: c.material, qty: left, attempt: attemptOf(c, c.loads[0]), slot: c.loads[0]! });
  }
  return out;
}

/** a load's booked arrival taken off the order's loads to come (the one booked for `slot`, else the earliest) */
function dropSlot(loads: readonly number[], slot: number | undefined): number[] {
  const i = slotIndex(loads, slot);
  return i < 0 ? [...loads] : [...loads.slice(0, i), ...loads.slice(i + 1)];
}

/** which of an order's loads to come a lorry is for: the one booked for `slot`, else the earliest */
const slotIndex = (loads: readonly number[], slot: number | undefined): number => (slot !== undefined && loads.includes(slot) ? loads.indexOf(slot) : loads.indexOf(Math.min(...loads)));

/** a load booked again for later (late at the yard, blocked): the order says when it now comes, and keeps its try with it (and that it is late) */
function rebook(ctx: WriteCtx, order: EntityId, was: number | undefined, at: number, late = false): void {
  const o = ctx.get('Order', order);
  if (!o?.loads) return;
  const gone = o.loads[slotIndex(o.loads, was)];
  const note = o.loadInfo?.find((x) => x.slot === gone);
  const loads = [...dropSlot(o.loads, was), at];
  const info = { slot: at, ...(note?.attempt ? { attempt: note.attempt } : {}), ...(late || note?.late ? { late: true } : {}) };
  writeOrder(ctx, order, { ...o, loads, loadInfo: [...(o.loadInfo ?? []).filter((x) => x !== note), ...(info.attempt || info.late ? [info] : [])], expected: Math.min(...loads) });
}

/** an order's load on the road now (on its own lorry or another's): no longer a load to come */
function onTheRoad(ctx: WriteCtx, order: EntityId, qty: number, slot: number | undefined): void {
  const o = ctx.require('Order', order);
  writeOrder(ctx, order, { ...o, inTransit: o.inTransit + qty, ...(o.loads ? { loads: dropSlot(o.loads, slot) } : {}) });
}

/** open orders of goods coming in that are past when they were expected, with nothing on the road: overdue (S509) */
function overdue(ctx: WriteCtx): void {
  const underway = new Set(ctx.port('moves').underway().filter(([, m]) => m.purpose === 'delivery' || m.purpose === 'carried').flatMap(([, m]) => [...ordersOn(m)]));
  for (const [id, o] of openOrders(ctx)) {
    if (o.direction === 'outbound' || o.carried) continue;
    // (the earliest load still to come, as booked: one fact, the order's loads)
    const due = o.loads?.length ? Math.min(...o.loads) : (o.expected ?? o.earliest);
    const was = ctx.blockersOf(id).some((b) => b.code === 'inventory.overdue');
    const isOverdue = ctx.now > due + OVERDUE_AFTER && (o.loads?.length ? true : !underway.has(id)) && o.delivered + o.inTransit + EPS < o.qty;
    if (isOverdue === was) continue;
    const sup = ctx.data('suppliers')[o.supplier];
    const mat = material(ctx, o.material);
    const left = tidy(o.qty - o.delivered - o.inTransit);
    news(ctx, id, 'inventory.overdue', isOverdue ? { severity: 'warn', params: { supplier: sup?.label ?? o.supplier, qty: fmtQty(left), unit: mat.unit, material: mat.label, due: ctx.calendar.format(due) }, remedies: [{ label: 'Call off what has not come', command: { type: 'inventory.cancelOrder', payload: { order: id } } }, ...ctx.contributions('provision').flatMap((c) => c.impl(ctx, o.store, o.material, left))] } : null);
    if (isOverdue) ctx.log('warn', `${sup?.label ?? o.supplier} has not brought ${fmtQty(left)} ${mat.unit} ${mat.label}, expected ${ctx.calendar.format(due)}, and nothing of it is on the road.`, [id, o.store]);
  }
}

function onTheWay(ctx: ReadCtx) {
  const moves = ctx.port('moves');
  const underway = moves.underway();
  const profiles = ctx.data('vehicleProfiles');
  const orders = [...ctx.all('Order')]
    .filter(([, o]) => o.status === 'open' && o.direction !== 'outbound')
    .map(([id, o]) => {
      const sup = ctx.data('suppliers')[o.supplier];
      const mat = material(ctx, o.material);
      // (its own lorries, and another order's of a tour that carries its goods: S5b)
      const lorries = underway.filter(([, m]) => ordersOn(m).has(id) && (m.purpose === 'delivery' || m.purpose === 'carried'));
      const onRoad = lorries.map(([mid, m]) => ({ move: mid, qty: carriesOf(m, id), arrives: m.unloadUntil ?? m.legs.at(-1)!.arrive, ...(moves.positionAt(mid, ctx.now)?.stopped ? { stopped: moves.positionAt(mid, ctx.now)!.stopped } : {}) }));
      const onRoadQty = onRoad.reduce((a, l) => a + l.qty, 0);
      const notLeft = Math.max(0, o.qty - o.delivered - onRoadQty);
      // the hazards of who carries it: the supplier's lorries for a delivery, the carriers of the moves for what we carry home
      const pu = !o.carried ? sup?.punctuality : undefined;
      const classes = o.carried ? lorries.flatMap(([, m]) => m.legs.filter((l) => l.carrier.unit === undefined).map((l) => l.carrier.class)) : sup ? [sup.vehicleProfile] : [];
      const hazards = [
        ...(pu ? [`${sup!.label} comes on time in ${Math.round(pu.onTime.value * 100)} % of deliveries, else about ${+pu.late.value.toFixed(1)} h late (${pu.onTime.source?.title ?? 'estimate'})`] : []),
        ...[...new Set(classes)].flatMap((c) => {
          const bd = profiles[c]?.breakdown;
          return bd ? [`a ${profiles[c]!.label} breaks down about once in ${Math.round(bd.mtbf.value)} h on the road and then stands about ${+bd.standstill.value.toFixed(1)} h`] : [];
        }),
      ];
      return {
        order: id,
        material: o.material,
        label: mat.label,
        unit: mat.unit,
        store: o.store,
        supplier: sup?.label ?? o.supplier,
        ordered: o.qty,
        delivered: o.delivered,
        onRoad,
        notLeft,
        ...(notLeft > EPS ? { due: o.loads?.length ? Math.min(...o.loads) : (o.expected ?? o.earliest) } : {}),
        news: ctx.blockersOf(id).map((b) => ctx.formatBlocker(b)),
        hazards,
      };
    });
  // our own goods on a hired van from one of our stores to another
  const transfers = underway
    .filter(([, m]) => m.purpose === 'transfer')
    .flatMap(([mid, m]) =>
      m.legs.at(-1)!.loads.flatMap((l) => ('goods' in l ? [{ transfer: mid, material: l.goods.material, label: material(ctx, l.goods.material).label, unit: l.goods.unit, store: m.ref ?? '', qty: l.goods.qty, arrives: m.unloadUntil ?? m.legs.at(-1)!.arrive, ...(moves.positionAt(mid, ctx.now)?.stopped ? { stopped: moves.positionAt(mid, ctx.now)!.stopped } : {}), hazards: m.legs.filter((x) => x.carrier.unit === undefined && profiles[x.carrier.class]?.breakdown).map((x) => `a ${profiles[x.carrier.class]!.label} breaks down about once in ${Math.round(profiles[x.carrier.class]!.breakdown!.mtbf.value)} h on the road`).slice(0, 1) }] : [])),
    );
  // and ours going out (a sale, a disposal): the buyer's lorries coming to load, and what is loaded on its way to them (S409)
  const outbound = [...ctx.all('Order')]
    .filter(([, o]) => o.status === 'open' && o.direction === 'outbound')
    .map(([id, o]) => {
      const mat = material(ctx, o.material);
      const lorries = underway.filter(([, m]) => m.ref === id && m.purpose === 'disposal');
      // (loaded: past its first leg, the drive out to our store)
      const loaded = lorries.filter(([mid, m]) => (moves.positionAt(mid, ctx.now)?.leg ?? 0) >= 1 || (m.done ?? 0) >= 1);
      return {
        order: id,
        outbound: true,
        material: o.material,
        label: mat.label,
        unit: mat.unit,
        store: o.store,
        buyer: ctx.data('suppliers')[o.supplier]?.label ?? o.supplier,
        sold: o.qty,
        collected: o.delivered,
        comingToLoad: o.collecting ?? 0,
        onRoad: loaded.map(([mid, m]) => ({ move: mid, qty: m.legs.at(-1)!.loads.reduce((a, l) => a + ('goods' in l ? l.goods.qty : 0), 0), arrives: m.legs.at(-1)!.arrive })),
        news: ctx.blockersOf(id).map((b) => ctx.formatBlocker(b)),
      };
    });
  return [...orders, ...transfers, ...outbound];
}

function orderRemedy(ctx: ReadCtx, store: EntityId, matId: string, shortfall: number): Remedy[] {
  const offer = offersOf(ctx).buy[matId]?.[0];
  if (!offer) return [];
  const mat = material(ctx, matId);
  const qty = Math.max(Math.ceil(shortfall - EPS), offer.minOrder);
  return [{ label: `Order ${fmtQty(qty)} ${mat.unit} ${mat.label}`, command: { type: 'inventory.order', payload: { material: matId, qty, store } } }];
}

/**
 * What still uses a store (one fact, decision 0028: a thing still depended on is not ended; review x: a felling's heap
 * given up while another felling stacked onto it, and one of ours lived there): goods on order to it or on their way to
 * it, goods set down short of it for it, and what each module says of its own (`storeUses`). Asked before a store is
 * given up or closed, by the one way stores go (`inventory.closeStore`).
 */
function usesOf(read: ReadCtx, store: EntityId): StoreUse[] {
  const out: StoreUse[] = [];
  for (const [id, o] of openOrders(read)) if (o.store === store) out.push({ by: id, why: `goods on order (${id}) are to be delivered to it` });
  for (const [id, x] of read.all('Store')) if (x.for === store) out.push({ by: id, why: `${x.label} is set down short of it, for it` });
  if (read.hasPort('moves')) for (const [id, m] of read.port('moves').underway()) if ((m.purpose === 'transfer' || m.purpose === 'drawn') && m.ref === store) out.push({ by: id, why: 'goods of ours are on their way to it' });
  for (const c of read.contributions('storeUses')) out.push(...c.impl(read, store));
  return out;
}

/**
 * The holdings by holder, by the unit they ride on, by the holding they are set down for and by work, each in the order
 * they were made: what `ofParty`, `ridingOn`, `setDownFor` and `ofWork` answer from (decision 0028 rule 4: a named
 * population, never a scan of every holding per question). Built with inventory's own read context, again when a
 * holding is made or closed (the kernel's members revision): what it is indexed by (holder, unit, set-down target,
 * work) is fixed when a holding is made, and the audit checks that the index says what the holdings do.
 */
type HoldingIndex = { rev: number; rank: Map<EntityId, number>; byHolder: Map<EntityId, EntityId[]>; byUnit: Map<EntityId, EntityId[]>; byFor: Map<EntityId, EntityId[]>; byWork: Map<EntityId, EntityId[]> };
const holdingIndexes = new WeakMap<object, HoldingIndex>();
function holdingIndex(own: ReadCtx): HoldingIndex {
  const rev = own.revision('Store', 'members');
  const was = holdingIndexes.get(own.calendar);
  if (was && was.rev === rev) return was;
  const ix: HoldingIndex = { rev, rank: new Map(), byHolder: new Map(), byUnit: new Map(), byFor: new Map(), byWork: new Map() };
  const add = (m: Map<EntityId, EntityId[]>, key: EntityId, id: EntityId) => {
    const l = m.get(key);
    if (l) l.push(id);
    else m.set(key, [id]);
  };
  for (const [id, st] of own.all('Store')) {
    ix.rank.set(id, ix.rank.size);
    add(ix.byHolder, st.holder, id);
    if (st.on !== undefined) add(ix.byUnit, st.on, id);
    if (st.for !== undefined) add(ix.byFor, st.for, id);
    if (st.work !== undefined) add(ix.byWork, st.work, id);
  }
  holdingIndexes.set(own.calendar, ix);
  return ix;
}

/** a party's holdings as asked (design/modular-split.md §4.1): from the index, nearest first when a point is given (ties by id) */
function ofParty(own: ReadCtx, party: EntityId, q: HoldingQuery = {}): EntityId[] {
  const kinds = q.kind === undefined ? undefined : typeof q.kind === 'string' ? [q.kind] : q.kind;
  const out: { id: EntityId; d: number }[] = [];
  for (const id of holdingIndex(own).byHolder.get(party) ?? []) {
    if (id === q.except) continue;
    const st = own.get('Store', id);
    if (!st) continue;
    if (kinds && !kinds.includes(st.kind)) continue;
    if (q.riding !== undefined && q.riding !== (st.on !== undefined)) continue;
    if (q.kept && (st.on !== undefined || st.kind === 'front' || st.kind === 'built')) continue;
    if (q.general && st.holds) continue;
    if (q.accepts !== undefined && st.holds && !st.holds.includes(q.accepts)) continue;
    if (q.has !== undefined && !((st.contents[q.has] ?? 0) > EPS)) continue;
    if (!q.near) {
      out.push({ id, d: 0 });
      continue;
    }
    const p = placeOf(own, id);
    if (!p) continue;
    const d = Math.hypot(p[0] - q.near[0], p[1] - q.near[1]);
    if (q.within === undefined || d <= q.within) out.push({ id, d });
  }
  if (q.near) out.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  return out.map((x) => x.id);
}

/** what a holding's goods weigh (kg) */
function massOf(read: ReadCtx, store: EntityId): number {
  return Object.entries(read.get('Store', store)?.contents ?? {}).reduce((a, [m, q]) => a + q * unitMass(material(read, m)), 0);
}

const NONE: Readonly<Record<string, number>> = Object.freeze({});

function holdingsPort(ctx: ReadCtx): HoldingsPort {
  return {
    material: (id) => material(ctx, id),
    revision: () => ctx.revision('Store'),
    exists: (store) => ctx.has('Store', store),
    label: (store) => ctx.get('Store', store)?.label,
    kind: (store) => ctx.get('Store', store)?.kind,
    holder: (store) => ctx.get('Store', store)?.holder,
    userOf: (store) => userOf(ctx, store),
    where: (store) => placeOf(ctx, store),
    near: (store, point, within) => {
      const p = placeOf(ctx, store);
      return Boolean(p && Math.hypot(p[0] - point[0], p[1] - point[1]) <= within);
    },
    together: (a, b) => together(ctx, a, b),
    stock: (store, mat) => ctx.get('Store', store)?.contents[mat] ?? 0,
    free: (store, mat) => free(ctx, store, mat),
    supply: (store, mat, draw) => sources(ctx, store, mat, draw).reduce((a, id) => a + (ctx.get('Store', id)?.contents[mat] ?? 0), 0),
    contents: (store) => ctx.get('Store', store)?.contents ?? NONE,
    mass: (store) => massOf(ctx, store),
    accepts: (store, mat) => {
      const st = ctx.get('Store', store);
      return Boolean(st && (!st.holds || st.holds.includes(mat)));
    },
    holds: (store) => ctx.get('Store', store)?.holds,
    laidOut: (store) => Boolean(ctx.get('Store', store)?.layout),
    work: (store) => ctx.get('Store', store)?.work,
    builtInto: (work) => {
      const out: Record<string, number> = {};
      for (const id of holdingIndex(ctx).byWork.get(work) ?? []) {
        const st = ctx.get('Store', id);
        if (st?.kind === 'built') for (const [m, q] of Object.entries(st.contents)) out[m] = (out[m] ?? 0) + q;
      }
      return out;
    },
    ageIn: (store) => {
      if (!store) return 0;
      let oldest = 0;
      for (const [key, lots] of Object.entries(ctx.state('inventory').seasoning ?? {})) if (key.startsWith(`${store}|`)) for (const l of lots) oldest = Math.max(oldest, l.age ?? 0);
      return oldest;
    },
    sinceIn: (store, mat) => {
      const lots = ctx.state('inventory').seasoning?.[`${store}|${mat}`];
      const q = lots?.reduce((a, l) => a + l.qty, 0) ?? 0;
      return lots && q > EPS ? lots.reduce((a, l) => a + l.qty * l.since, 0) / q : undefined;
    },
    usesOf: (store) => usesOf(ctx, store),
    ofParty: (party, q) => ofParty(ctx, party, q),
    carriedBy: (person) => (holdingIndex(ctx).byUnit.get(person) ?? []).find((id) => ctx.get('Store', id)?.kind === 'carried'),
    atHand: (person, party, at, within) => {
      const ix = holdingIndex(ctx);
      // (within so far by the square of the distance: as the body's reckoning of what is by it always asked)
      const r2 = within * within;
      const by = ofParty(ctx, party, { kept: true }).filter((id) => {
        const p = placeOf(ctx, id)!;
        return (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 <= r2;
      });
      return [...(ix.byUnit.get(person) ?? []), ...by].sort((a, b) => ix.rank.get(a)! - ix.rank.get(b)!);
    },
    ridingOn: (unit) => [...(holdingIndex(ctx).byUnit.get(unit) ?? [])],
    setDownFor: (store) => [...(holdingIndex(ctx).byFor.get(store) ?? [])],
    meantFor: (store) => ctx.get('Store', store)?.for,
    ofWork: (work, kind) => (holdingIndex(ctx).byWork.get(work) ?? []).filter((id) => kind === undefined || ctx.get('Store', id)?.kind === kind),
  };
}

/** what of a good is on order to a store, or on its way to it from another store of ours */
function onOrder(read: ReadCtx, store: EntityId, mat: string): number {
  let sum = 0;
  for (const [, o] of openOrders(read)) if (o.store === store && o.material === mat && o.direction !== 'outbound') sum += o.qty - o.delivered;
  // our own goods on their way to it from another of our stores
  for (const [, m] of read.port('moves').underway()) {
    if ((m.purpose !== 'transfer' && m.purpose !== 'drawn') || m.ref !== store) continue;
    for (const l of m.legs.at(-1)!.loads) if ('goods' in l && l.goods.material === mat) sum += l.goods.qty;
  }
  return tidy(sum);
}

function tradePort(ctx: ReadCtx): TradePort {
  return {
    offers: (mat) => {
      const idx = index(ctx, ctx.now);
      const suppliers = ctx.data('suppliers');
      return (offersOf(ctx).buy[mat] ?? []).map((o) => ({ ...o, supplierLabel: suppliers[o.supplier]?.label ?? o.supplier, price: o.price * idx, delivers: suppliers[o.supplier]?.delivery !== 'collect' && reaches(ctx, o.supplier) }));
    },
    collectable: (store, mat) => {
      const at = ctx.get('Store', store)?.pos;
      const offer = offersOf(ctx).dispose[mat]?.[0] ?? offersOf(ctx).sell[mat]?.[0];
      return Boolean(at && offer && reaches(ctx, offer.supplier) && collects(ctx, offer.supplier, at));
    },
    order: (id) => {
      const o = ctx.get('Order', id);
      return o ? { store: o.store, material: o.material, status: o.status, qty: o.qty, delivered: o.delivered, direction: o.direction ?? 'inbound', ...(o.expected !== undefined ? { expected: o.expected } : {}) } : undefined;
    },
    isOpen: (id) => ctx.get('Order', id)?.status === 'open',
    onOrder: (store, mat) => onOrder(ctx, store, mat),
    firstDue: (store, mat) => {
      let first: number | undefined;
      for (const [, o] of openOrders(ctx)) if (o.direction !== 'outbound' && o.store === store && o.material === mat) first = Math.min(first ?? Infinity, o.earliest);
      return first;
    },
    openOrders: (f = {}) => openOrders(ctx).filter(([, o]) => (f.store === undefined || o.store === f.store) && (f.material === undefined || o.material === f.material) && (f.party === undefined || ctx.get('Store', o.store)?.holder === f.party)).map(([id]) => id),
  };
}

const QtySchema = s.number({ min: 0 });

export const inventoryModule = defineModule({
  id: INVENTORY_MODULE_ID,
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Agreement', 'Employment', 'Helper', 'Machine', 'Move', 'NetNode', 'Party', 'Person', 'Presence', 'Project', 'Tenure', 'WorkPackage'],
  commandDocs: {
    "inventory.createStore": {
      label: 'Set up a store',
      description: 'A place where goods are put down and kept: a stockpile on the ground, a corner of the camp, a site store. It costs nothing to set up; goods get there by being moved (production.moveGoods) or delivered. On another\'s land it is the land law that answers, not a refusal.',
    },
    "inventory.stock": {
      internal: true,
    },
    "inventory.order": {
      description:
        "Order a material for a store. The cheapest supplier with a fitting minimum order is used unless one is given; trucks deliver within the supplier's opening hours after its lead time, and each load is paid on arrival.",
    },
    "inventory.cancelOrder": {
      description: 'Cancel the undelivered part of an order; lorries already on the road still come and hand over by the order\'s terms (paid); with nobody to take an attended load, the driver takes it back and it is not brought again.',
    },
    "inventory.dispose": {
      description: 'Haul material from a store to the cheapest disposal site (e.g. surplus soil); the gate fee incl. haulage is paid per load.',
    }
  },
  label: 'Inventory',
  description: 'Materials, stores, suppliers, truck deliveries and disposal (mass-balanced).',
  provides: ['holdings', 'trade'],
  // 'prices' is provided by the economy module, which also opens the ledger accounts used here
  requires: ['prices', 'parties', 'routing', 'moves'],
  // another party's store is seen where it is, not what is in it; its orders are its own
  observe: {
    // (where it is: a holding that rides on a unit (a battery, a tank, what one carries) where the unit is now, derived,
    // never the place it was made at: S504, a battery shown where its power station stood before it was moved)
    Store: (v: Store, viewer: EntityId, read: ReadCtx, id: EntityId) => {
      const pos = v.on ? (placeOf(read, id) ?? v.pos) : v.pos;
      return v.holder === viewer ? { ...v, pos } : { holder: v.holder, label: v.label, kind: v.kind, pos };
    },
    Order: (v: Order, viewer: EntityId, read: ReadCtx) => (read.get('Store', v.store)?.holder === viewer ? v : undefined),
  },
  components: {
    Store: s.object({ holder: s.ref('party'), label: s.string(), kind: s.enum(['depot', 'stockpile', 'site', 'tank', 'front', 'built', 'transit', 'carried', 'battery']), pos: s.point(), contents: s.record(s.number({ min: -EPS })), on: s.ref().optional(), capacity: s.number({ min: 0 }).optional(), rate: s.number({ min: 0 }).optional(), work: s.ref().optional(), for: s.ref().optional(), holds: s.array(s.string()).optional(), layout: s.object({ order: s.array(s.string()), at: s.number() }).optional() }),
    Order: s.object({
      supplier: s.string(),
      material: s.string(),
      store: s.ref('store'),
      qty: s.number({ min: 0 }),
      delivered: s.number({ min: 0 }),
      inTransit: s.number({ min: 0 }),
      collecting: s.number({ min: 0 }).optional(),
      expected: s.number({ unit: 's' }).optional(),
      status: s.enum(['open', 'complete', 'cancelled']),
      orderedAt: s.number({ unit: 's' }),
      earliest: s.number({ unit: 's' }),
      unitPrice: s.number({ min: 0 }),
      direction: s.enum(['inbound', 'outbound']).optional(),
      carried: s.boolean().optional(),
      sale: s.boolean().optional(),
      parts: s.array(s.object({ qty: s.number({ min: 0 }), since: s.number(), age: s.number({ min: 0 }).optional() })).optional(),
      handover: s.enum(['attended', 'drop']).optional(),
      failures: s.int({ min: 0 }).optional(),
      loads: s.array(s.number({ unit: 's' })).optional(),
      loadInfo: s.array(s.object({ slot: s.number({ unit: 's' }), attempt: s.int({ min: 1 }).optional(), late: s.boolean().optional() })).optional(),
    }),
  },
  data: { materials: s.record(MaterialSchema), suppliers: s.record(SupplierSchema), supplierWeek: SupplierWeekSchema, roadside: RoadsideSchema.optional() },
  state: { initial: (): InventoryState => ({ flows: {} }) },
  events: {
    'inventory.delivered': s.object({ order: s.ref('order'), store: s.ref('store'), material: s.string(), qty: s.number() }),
    'inventory.orderComplete': s.object({ order: s.ref('order') }),
  },
  blockers: {
    'inventory.unknownMaterial': 'Unknown material {material}',
    'inventory.invalidQty': 'Quantity must be positive (got {qty})',
    'inventory.unknownStore': 'Unknown store {store}',
    'inventory.unknownOrder': 'Unknown order {order}',
    'inventory.orderClosed': 'Order {order} is already {status}',
    'inventory.notInStock': '{supplier} has {have} {unit} of {material} now',
    'inventory.noSupplier': 'No supplier offers {material}',
    'inventory.noDisposalSite': 'No disposal site accepts {material}',
    'inventory.noBuyer': 'Nobody buys {material} here',
    'inventory.cannotCollect': '{buyer}’s {vehicle} cannot get to {store}: move the goods to a store by a way it can use first',
    'inventory.noBooks': '{party} keeps no books to be paid into',
    'inventory.belowMinDisposal': '{site} takes {material} only from {minOrder} {unit} (offered {qty} {unit})',
    'inventory.belowMinSale': '{buyer} buys {material} only from {minOrder} {unit} (offered {qty} {unit})',
    'inventory.belowMinOrder': '{supplier} delivers {material} only from {minOrder} {unit} (ordered {qty} {unit})',
    'inventory.inWater': '{store} would lie in water {depth} m deep: goods are kept on dry ground',
    'inventory.noAccess': '{supplier} cannot reach the map: there is no way in a {vehicle} can use',
    'inventory.notOurs': '{store} is not held by {party}',
    'inventory.vessel': '{store} holds {holds} only, not {material}',
    'inventory.wholePieces': '{material} comes in whole pieces, not {qty}',
    'inventory.noFunds': 'Not enough liquidity for {material}: {cost} EUR (available {liquidity} EUR)',
    'inventory.noPayload': 'Vehicle {profile} cannot carry {material}',
    'inventory.insufficient': 'Only {have} {unit} {material} in {store}, {need} {unit} needed',
    'inventory.supplierLate': '{supplier} is late: now expected {at}',
    'inventory.overdue': '{supplier} has not brought {qty} {unit} {material} (expected {due}), and nothing of it is on the road',
    'inventory.lorryDelayed': 'On the way: {why}; now expected {at}',
    'inventory.notItsRoad': '{store} holds a haul’s loads on the road: only that work puts them on it and takes them off',
    'inventory.fleetBusy': 'All {n} vehicles of {firm} are out: the next load comes when one is back',
    'inventory.deliveryBlocked': 'Truck cannot reach the site: {reason}',
    'inventory.noWord': 'Our order cannot reach {supplier}: {why}',
    'inventory.deliveryFailed': 'Nobody of ours was at {at} to take it from the driver of {supplier}: he took it back; next {next}',
    'inventory.setDown': '{goods} set down {away} m short of {store}: moving it on is our work (work supplied from {store} draws on it where it lies); unwatched at the roadside overnight it may be taken',
    'inventory.collectOnly': '{supplier} does not deliver: {material} is fetched from there',
    'inventory.notABattery': '{material} is held only in a battery, not in {store}: it goes along a cable within reach, or in a battery carried',
    'inventory.full': '{store} holds {capacity} {unit} at most: it has {have}, {qty} {unit} {material} would not fit',
    'inventory.claimed': '{store} has {have} {unit} of {material} free to take: {held} {unit} are sold or sent off and wait for their lorry ({need} {unit} asked)',
    'inventory.apart': '{from} and {to} are {away} m apart (goods change hands within {reach} m): they are carried, not handed over',
  },
  commands: {
    'inventory.createStore': command(
      s.object({ holder: s.ref('party'), label: s.string(), kind: s.enum(['depot', 'stockpile', 'site', 'tank', 'front', 'built', 'transit', 'carried', 'battery']), pos: s.point(), holds: s.array(s.string()).optional(), on: s.ref().optional(), capacity: s.number({ min: 0 }).optional(), rate: s.number({ min: 0 }).optional(), work: s.ref().optional() }),
      (ctx, p) => {
        ctx.port('parties').require(p.holder, 'inventory.createStore');
        // a player sets up stores of its own party; world setup sets them up for anyone
        if (ctx.caller === 'client' && !ctx.trusted && p.holder !== actorOf(ctx)) ctx.reject('inventory.notOurs', { store: p.label, party: partyLabel(ctx, actorOf(ctx)) });
        // a player keeps no goods in standing water (Qwen S171: a stockpile was set up in a pond)
        const wet = ctx.caller === 'client' && ctx.hasPort('terrain') ? ctx.port('terrain').waterDepthAt(p.pos[0], p.pos[1]) : 0;
        if (wet > 0) ctx.reject('inventory.inWater', { store: p.label, depth: wet.toFixed(2) });
        // (a flow's loads on the road: its work's own)
        if (p.kind === 'transit' && ctx.caller !== 'production') throw new Error(`inventory.createStore by ${ctx.caller}: a holding on the road is a haul's own`);
        const id = ctx.spawn('store', { name: p.label });
        // (a player sets up heaps, depots and site stores; tanks, work fronts and what is built in are the modules')
        if (ctx.caller === 'client' && !ctx.trusted && !['depot', 'stockpile', 'site'].includes(p.kind)) ctx.reject('inventory.invalidQty', { qty: p.kind });
        ctx.set('Store', id, { holder: p.holder, label: p.label, kind: p.kind, pos: [p.pos[0], p.pos[1]], contents: {}, ...(p.holds ? { holds: p.holds } : {}), ...(p.on ? { on: p.on } : {}), ...(p.capacity !== undefined ? { capacity: p.capacity } : {}), ...(p.rate !== undefined ? { rate: p.rate } : {}), ...(p.work ? { work: p.work } : {}) });
        return id;
      },
      'Create a store / stockpile',
    ),
    'inventory.setLayout': command(
      s.object({ store: s.ref('store'), order: s.array(s.string()) }),
      (ctx, p) => {
        const st = requireStore(ctx, p.store);
        for (const m of p.order) requireMaterial(ctx, m);
        ctx.set('Store', p.store, { ...st, layout: { order: [...new Set(p.order)], at: ctx.now } });
        ctx.log('success', `${st.label} is laid out: ${p.order.map((m) => material(ctx, m).label).join(', ')}, in that order.`, [p.store]);
      },
      { label: 'A store is laid out (the work is done)', internal: true },
    ),
    'inventory.order': command(
      s.object({ material: s.string(), qty: s.number({ min: 0 }), store: s.ref('store'), supplier: s.string().optional(), handover: s.enum(['attended', 'drop']).optional() }),
      (ctx: WriteCtx, p) => {
        const mat = requireMaterial(ctx, p.material);
        const buyer = requireStore(ctx, p.store).holder;
        // (nothing is bought for a party that ended: the one check, whoever buys; review y)
        mustBeLive(ctx, buyer);
        // a vessel for some goods only (a rain barrel) takes nothing else, and no more than it holds
        intoVessel(ctx, p.store, p.material);
        if (!(p.qty > 0)) ctx.reject('inventory.invalidQty', { qty: p.qty });
        fits(ctx, p.store, p.material, p.qty);
        // pieces are bought whole
        if (isCounted(mat) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) ctx.reject('inventory.wholePieces', { material: mat.label, qty: p.qty });
        const suppliersData = ctx.data('suppliers');
        // a supplier who does not deliver is not ordered from: what it sells is fetched (an errand, a hired haulier)
        const all = offersOf(ctx).buy[p.material] ?? [];
        const offers = all.filter((o) => suppliersData[o.supplier]?.delivery !== 'collect');
        // (sold only over a counter, as petrol at a filling station: said so, with fetching it as the way; Qwen S512)
        const collectOnly = (supplier: string) => ctx.reject('inventory.collectOnly', { supplier: suppliersData[supplier]!.label, material: mat.label }, ctx.contributions('provision').flatMap((c) => c.impl(ctx, p.store, p.material, p.qty)));
        let offer: NormalizedOffer | undefined;
        if (p.supplier) {
          if (suppliersData[p.supplier]?.delivery === 'collect') collectOnly(p.supplier);
          offer = offers.find((o) => o.supplier === p.supplier);
          if (!offer) ctx.reject('inventory.noSupplier', { material: `${mat.label} at ${p.supplier}` });
        } else {
          if (offers.length === 0 && all.length > 0) collectOnly(all[0]!.supplier);
          if (offers.length === 0) ctx.reject('inventory.noSupplier', { material: mat.label });
          offer = offers.find((o) => o.minOrder <= p.qty + EPS) ?? offers[0]!;
        }
        const sup = ctx.data('suppliers')[offer.supplier]!;
        if (p.qty + EPS < offer.minOrder) {
          ctx.reject('inventory.belowMinOrder', { supplier: sup.label, material: mat.label, minOrder: offer.minOrder, qty: p.qty, unit: mat.unit }, [
            { label: `Order ${fmtQty(offer.minOrder)} ${mat.unit}`, command: { type: 'inventory.order', payload: { material: p.material, qty: offer.minOrder, store: p.store, supplier: offer.supplier } } },
          ]);
        }
        // (no lorry comes onto the map: what one of ours fetches from a counter, on foot or by bus, is the way: Qwen S506)
        if (!reaches(ctx, offer.supplier)) ctx.reject('inventory.noAccess', { supplier: ctx.data('suppliers')[offer.supplier]!.label, vehicle: ctx.port('routing').profile(ctx.data('suppliers')[offer.supplier]!.vehicleProfile).label }, ctx.contributions('provision').flatMap((c) => c.impl(ctx, p.store, p.material, p.qty)));
        // the order is word to the supplier: it gets out by an office, a phone with charge, or one of ours beyond the map;
        // else it is bought in person, where the supplier has a counter (S4)
        const noWord = wordBlock(ctx, buyer);
        if (noWord) ctx.reject('inventory.noWord', { supplier: sup.label, why: noWord.why }, [...ctx.contributions('provision').flatMap((c) => c.impl(ctx, p.store, p.material, p.qty)), ...noWord.remedies]);
        const unitPrice = offer.price * index(ctx, ctx.now);
        const prices = ctx.port('prices');
        const cost = round2(unitPrice * p.qty);
        if (!prices.canSpend(buyer, cost)) ctx.reject('inventory.noFunds', { material: mat.label, cost, liquidity: Math.round(prices.liquidity(buyer)) });
        const earliest = ctx.now + Math.round(offer.leadTimeDays * DAY);
        // (what it can never have: more than it holds, nothing made: 8c)
        if (!Number.isFinite(stockReady(ctx, offer.supplier, p.material, Math.min(p.qty, truckLoad(ctx, sup.vehicleProfile, mat)), earliest))) {
          const have = Math.floor(stockAt(ctx, offer.supplier, p.material, earliest) * 100) / 100;
          ctx.reject('inventory.notInStock', { supplier: sup.label, material: mat.label, have, unit: mat.unit }, have >= offer.minOrder && have > 0 ? [{ label: `Order the ${have} ${mat.unit} it has`, command: { type: 'inventory.order', payload: { ...p, qty: have } } }] : []);
        }
        const id = ctx.spawn('order', { name: `${fmtQty(p.qty)} ${mat.unit} ${mat.label}` });
        writeOrder(ctx, id, {
          supplier: offer.supplier,
          material: p.material,
          store: p.store,
          qty: p.qty,
          delivered: 0,
          inTransit: 0,
          status: 'open',
          orderedAt: ctx.now,
          earliest,
          unitPrice,
          direction: 'inbound',
          ...(p.handover ? { handover: p.handover } : {}),
        });
        scheduleTrucks(ctx, id, sup, offer.supplier, mat, p.qty, earliest, 'truck', p.material);
        return id;
      },
      'Order material',
    ),
    'inventory.buyAtCounter': command(
      s.object({ store: s.ref('store'), material: s.string(), qty: s.number({ min: 0 }), supplier: s.string(), arrives: s.number({ unit: 's' }), carrier: s.string() }),
      (ctx: WriteCtx, p) => {
        const mat = requireMaterial(ctx, p.material);
        const buyer = requireStore(ctx, p.store).holder;
        // (nothing is bought for a party that ended: the one check, whoever buys; review y)
        mustBeLive(ctx, buyer);
        // a vessel for some goods only (a rain barrel) takes nothing else
        intoVessel(ctx, p.store, p.material);
        if (!(p.qty > 0)) ctx.reject('inventory.invalidQty', { qty: p.qty });
        // pieces are bought whole
        if (isCounted(mat) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) ctx.reject('inventory.wholePieces', { material: mat.label, qty: p.qty });
        const offer = (offersOf(ctx).buy[p.material] ?? []).find((o) => o.supplier === p.supplier);
        if (!offer) ctx.reject('inventory.noSupplier', { material: `${mat.label} at ${p.supplier}` });
        const sup = ctx.data('suppliers')[p.supplier]!;
        // what is on the shelf (8c): no more
        const shelf = stockAt(ctx, p.supplier, p.material, ctx.now);
        if (shelf < p.qty - EPS) {
          const have = isCounted(mat) ? Math.floor(shelf + 1e-9) : Math.floor(shelf * 100) / 100;
          ctx.reject('inventory.notInStock', { supplier: sup.label, material: mat.label, have, unit: mat.unit });
        }
        takeStock(ctx, p.supplier, p.material, p.qty, ctx.now);
        // at the counter: what there is, at the day's price, paid on the spot
        const unitPrice = offer!.price * index(ctx, ctx.now);
        const cost = round2(unitPrice * p.qty);
        if (!ctx.port('prices').canSpend(buyer, cost)) ctx.reject('inventory.noFunds', { material: mat.label, cost, liquidity: Math.round(ctx.port('prices').liquidity(buyer)) });
        const id = ctx.spawn('order', { name: `${fmtQty(p.qty)} ${mat.unit} ${mat.label} (carried)` });
        writeOrder(ctx, id, { supplier: p.supplier, material: p.material, store: p.store, qty: p.qty, delivered: 0, inTransit: p.qty, status: 'open', orderedAt: ctx.now, earliest: p.arrives, unitPrice, direction: 'inbound', carried: true });
        ctx.ledger.post({ from: acct(buyer, ACCOUNTS.cash), to: acct(buyer, purchaseAccount(mat)), amount: cost, memo: `${fmtQty(p.qty)} ${mat.unit} ${mat.label} at ${sup.label}, carried by ${p.carrier}`, category: purchaseAccount(mat), refs: [id, p.store] });
        // the goods ride whoever carries them: the carrier's move (purpose 'carried', ref this order) brings them in
        return { order: id, cost };
      },
      { label: 'Buy at a counter and carry it home (an errand: the goods come with the carrier\'s move)', internal: true },
    ),
    'inventory.buyBeyond': command(
      s.object({ into: s.ref('store'), material: s.string(), qty: s.number({ min: 0 }), supplier: s.string(), carrier: s.string() }),
      (ctx: WriteCtx, p) => {
        // bought at a counter beyond the map by one who is there, into what they carry (it comes in with them, by their
        // move): the shop's shelf and the day's price, paid on the spot (design/realism-plan.md S2, shopping on the way home)
        if (!EDGE.includes(ctx.caller)) throw new Error(`inventory.buyBeyond by ${ctx.caller}: only ${EDGE.join(', ')} buy beyond the world's edge this way`);
        const mat = requireMaterial(ctx, p.material);
        const buyer = requireStore(ctx, p.into).holder;
        if (!(p.qty > 0)) ctx.reject('inventory.invalidQty', { qty: p.qty });
        if (isCounted(mat) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) ctx.reject('inventory.wholePieces', { material: mat.label, qty: p.qty });
        const offer = (offersOf(ctx).buy[p.material] ?? []).find((o) => o.supplier === p.supplier);
        if (!offer) ctx.reject('inventory.noSupplier', { material: `${mat.label} at ${p.supplier}` });
        const sup = ctx.data('suppliers')[p.supplier]!;
        const shelf = stockAt(ctx, p.supplier, p.material, ctx.now);
        if (shelf < p.qty - EPS) ctx.reject('inventory.notInStock', { supplier: sup.label, material: mat.label, have: Math.floor(shelf * 100) / 100, unit: mat.unit });
        const cost = round2(offer!.price * index(ctx, ctx.now) * p.qty);
        if (!ctx.port('prices').canSpend(buyer, cost)) ctx.reject('inventory.noFunds', { material: mat.label, cost, liquidity: Math.round(ctx.port('prices').liquidity(buyer)) });
        takeStock(ctx, p.supplier, p.material, p.qty, ctx.now);
        putIn(ctx, p.into, p.material, p.qty);
        addFlow(ctx, p.material, 'delivered', p.qty);
        ctx.ledger.post({ from: acct(buyer, ACCOUNTS.cash), to: acct(buyer, purchaseAccount(mat)), amount: cost, memo: `${fmtQty(p.qty)} ${mat.unit} ${mat.label} at ${sup.label}, carried home by ${p.carrier}`, category: purchaseAccount(mat), refs: [p.into] });
        return { cost };
      },
      { label: 'Bought at a counter beyond the map into what one carries there', internal: true },
    ),
    'inventory.setHandover': command(
      s.object({ order: s.ref('order'), handover: s.enum(['attended', 'drop']) }),
      (ctx: WriteCtx, p) => {
        const o = ctx.get('Order', p.order);
        if (!o) ctx.reject('inventory.unknownOrder', { order: p.order });
        const st = requireStore(ctx, o.store);
        if (o.status !== 'open' || o.direction === 'outbound') ctx.reject('inventory.orderClosed', { order: p.order, status: o.status !== 'open' ? o.status : 'a disposal haul' });
        // (agreed with the supplier: word to it, S4)
        const noWord = wordBlock(ctx, st.holder);
        if (noWord) ctx.reject('inventory.noWord', { supplier: ctx.data('suppliers')[o.supplier]?.label ?? o.supplier, why: noWord.why }, noWord.remedies);
        writeOrder(ctx, p.order, { ...o, handover: p.handover });
        news(ctx, p.order, 'inventory.deliveryFailed', null);
        // (set down by consent: a lorry on its way or waiting at the drop point with no load left to hand over needs nobody
        // of ours there; the one sent to meet it goes back, and one waiting sets its goods down now: review y)
        const needsNobody = (loads: readonly LorryLoad[]) => loads.every((l) => {
          const lo = ctx.get('Order', l.order);
          return !lo || handoverOf(ctx, lo) === 'drop';
        });
        const st0 = ctx.state('inventory');
        for (const [move, lorry] of Object.entries(st0.lorries ?? {})) {
          if (!lorry.coming || !lorry.loads.some((l) => l.order === p.order) || !needsNobody(lorry.loads)) continue;
          const { coming: _c, ...rest } = lorry;
          ctx.setState('inventory', { ...ctx.state('inventory'), lorries: { ...ctx.state('inventory').lorries, [move]: rest } });
          letGoMeeter(ctx, lorry.coming.person, move as EntityId, lorry.coming.from);
        }
        for (const [move, h] of Object.entries(st0.handovers ?? {})) if (h.loads.some((l) => l.order === p.order) && needsNobody(h.loads)) ctx.at(ctx.now, 'handover', { move: move as EntityId });
      },
      { label: 'Agree how an order is handed over', description: 'With the supplier: `attended` (one of ours takes it from the driver at the drop point; he rings when there and waits a while, then takes it back for a fee) or `drop` (it is set down there with nobody to take it: our consent, an Abstellgenehmigung).' },
    ),
    'inventory.cancelOrder': command(
      s.object({ order: s.ref('order') }),
      (ctx: WriteCtx, p) => {
        const o = ctx.get('Order', p.order);
        if (!o) ctx.reject('inventory.unknownOrder', { order: p.order });
        requireStore(ctx, o.store);
        if (o.status !== 'open' || (o.direction === 'outbound' && !o.sale)) ctx.reject('inventory.orderClosed', { order: p.order, status: o.status !== 'open' ? o.status : 'a disposal haul' });
        // (calling it off is word to the supplier too, S4)
        const noWord = ctx.caller === 'client' ? wordBlock(ctx, ctx.require('Store', o.store).holder) : undefined;
        if (noWord) ctx.reject('inventory.noWord', { supplier: ctx.data('suppliers')[o.supplier]?.label ?? o.supplier, why: noWord.why }, noWord.remedies);
        if (o.sale) {
          // a sale called off: what no lorry has taken is still in the store (it never left it)
          const back = tidy(o.qty - o.delivered - o.inTransit);
          // (a lorry on its way to load turns home empty: what it came for stays here, among `back`)
          writeOrder(ctx, p.order, { ...o, status: 'cancelled' });
          ctx.blockers.clear(p.order);
          const m = material(ctx, o.material);
          ctx.log('info', `Sale called off: ${fmtQty(back)} ${m.unit} ${m.label} stay in ${ctx.get('Store', o.store)?.label ?? o.store}${o.inTransit > 0 ? ` (${fmtQty(o.inTransit)} ${m.unit} on the road are sold still)` : ''}.`, [p.order, o.store]);
          return;
        }
        // bought at a counter: paid, and on its way home in someone's hands; nothing is left to cancel
        if (o.carried) ctx.reject('inventory.orderClosed', { order: p.order, status: 'bought and carried home' });
        // lorries already on the road still come, handed over by its terms (and paid); the rest are not loaded: theirs again (8c)
        writeOrder(ctx, p.order, { ...o, status: 'cancelled' });
        releaseStock(ctx, o.supplier, o.material, p.order, o.qty - o.delivered - o.inTransit);
        ctx.blockers.clear(p.order);
        // said (Qwen R30: orders were cancelled with no line in the log)
        const m = material(ctx, o.material);
        ctx.log('info', `Order cancelled: ${fmtQty(o.qty - o.delivered - o.inTransit)} ${m.unit} ${m.label} from ${ctx.data('suppliers')[o.supplier]?.label ?? o.supplier}${o.inTransit > 0 ? ` (${fmtQty(o.inTransit)} ${m.unit} on the road still come, handed over as agreed and paid)` : ''}.`, [p.order, o.store]);
      },
      'Cancel order',
    ),
    'inventory.transfer': command(
      s.object({ from: s.ref('store'), to: s.ref('store'), material: s.string(), qty: QtySchema, via: s.enum(['carried by the work', 'hauled by the work', 'carried in cans', 'passed at the toilet']).optional(), why: s.string().optional(), age: s.number({ min: 0 }).optional(), work: s.ref().optional() }),
      (ctx: WriteCtx, p): Lots => {
        requireMaterial(ctx, p.material);
        if (p.from === p.to || !(p.qty > 0)) return {};
        const from = ctx.require('Store', p.from);
        const to = ctx.require('Store', p.to);
        // (a flow's loads on the road: only the work that hauls them puts them on it and takes them off: r37)
        const road = from.kind === 'transit' ? from : to.kind === 'transit' ? to : undefined;
        if (road && (ctx.caller !== 'production' || p.work === undefined || p.work !== road.work)) ctx.reject('inventory.notItsRoad', { store: road.label });
        // at the same place, or by a carrier the work reckons (declared, until moves carry it)
        if (!p.via && !together(ctx, p.from, p.to)) {
          const a = placeOf(ctx, p.from)!;
          const b = placeOf(ctx, p.to)!;
          ctx.reject('inventory.apart', { from: from.label, to: to.label, away: Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])), reach: reachOf(ctx) });
        }
        const lots = takeOut(ctx, p.from, p.material, p.qty);
        // (a good that keeps its age in use, aged meanwhile where it was: a kit struck after a season standing)
        putIn(ctx, p.to, p.material, p.qty, p.age !== undefined ? { since: lots.since ?? ctx.now, age: p.age } : lots);
        return lots;
      },
      { label: 'Goods from one holding into another at the same place', internal: true },
    ),
    'inventory.transform': command(
      s.object({ at: s.ref('store'), take: s.array(s.object({ material: s.string(), qty: QtySchema })), give: s.array(s.object({ material: s.string(), qty: QtySchema, into: s.ref('store').optional(), since: s.number().optional() })), sink: s.enum(['air', 'ground']).optional(), ground: s.number({ min: 0 }).optional(), why: s.string() }),
      (ctx: WriteCtx, p): Lots => {
        let inKg = 0;
        let outKg = 0;
        let lots: Lots = {};
        for (const t of p.take) {
          if (!(t.qty > 0)) continue;
          lots = takeOut(ctx, p.at, t.material, t.qty);
          addFlow(ctx, t.material, 'used', t.qty);
          inKg += t.qty * unitMass(requireMaterial(ctx, t.material));
        }
        for (const g of p.give) {
          if (!(g.qty > 0)) continue;
          const into = g.into ?? p.at;
          // (what is made where the transform is, or beside it)
          if (into !== p.at && !together(ctx, p.at, into)) ctx.reject('inventory.apart', { from: ctx.require('Store', p.at).label, to: ctx.require('Store', into).label, away: 0, reach: reachOf(ctx) });
          // (made of what was: as old as it, a broken pole's brash as rotted as the pole had lain)
          putIn(ctx, into, g.material, g.qty, g.since !== undefined ? { since: g.since } : {});
          addFlow(ctx, g.material, 'made', g.qty);
          outKg += g.qty * unitMass(requireMaterial(ctx, g.material));
        }
        // balanced in mass: what is in no product goes to its sink; nothing is made of nothing
        const rest = inKg - outKg;
        if (rest < -1e-6 * Math.max(1, inKg)) throw new Error(`inventory.transform (${p.why}): ${outKg.toFixed(3)} kg made of ${inKg.toFixed(3)} kg (matter from nothing, design/physical-state.md I1)`);
        if (rest > 1e-6 * Math.max(1, inKg)) {
          if (!p.sink) throw new Error(`inventory.transform (${p.why}): ${rest.toFixed(3)} kg go nowhere: name the sink`);
          // (of the rest, so much to the ground: what a body leaves about a camp with no toilet that collects)
          const ground = Math.min(rest, p.ground ?? 0);
          sinkMass(ctx, 'ground', ground);
          sinkMass(ctx, p.sink, rest - ground);
        }
        return lots;
      },
      { label: 'Goods used up into others and a sink, balanced in mass', internal: true },
    ),
    'inventory.release': command(
      s.object({ from: s.ref('store'), material: s.string(), qty: QtySchema, to: s.enum(['air', 'ground']), why: s.string(), usedUp: s.boolean().optional() }),
      (ctx: WriteCtx, p): Lots => {
        const mat = requireMaterial(ctx, p.material);
        if (!(p.qty > 0)) return {};
        const lots = takeOut(ctx, p.from, p.material, p.qty);
        // what using it up leaves behind stays where it was kept (the packaging of what was eaten): matter is not lost
        const left = mat.leaves && p.usedUp ? p.qty * mat.leaves.per : 0;
        if (left > EPS) {
          addFlow(ctx, p.material, 'used', p.qty);
          putIn(ctx, p.from, mat.leaves!.material, left);
          addFlow(ctx, mat.leaves!.material, 'made', left);
          sinkMass(ctx, p.to, p.qty * unitMass(mat) - left * unitMass(material(ctx, mat.leaves!.material)));
        } else {
          addFlow(ctx, p.material, 'released', p.qty);
          sinkMass(ctx, p.to, p.qty * unitMass(mat));
        }
        return lots;
      },
      { label: 'Goods used up into a sink (burnt, poured out)', internal: true },
    ),
    'inventory.draw': command(
      s.object({ at: s.ref('store'), material: s.string(), qty: QtySchema, to: s.enum(['air', 'ground']), why: s.string(), draw: s.number({ min: 0 }).optional(), usedUp: s.boolean().optional() }),
      (ctx: WriteCtx, p): number => {
        // a good used up where it is drawn: from the store, or energy from the batteries within reach that carry the draw
        requireMaterial(ctx, p.material);
        let left = p.qty;
        for (const id of sources(ctx, p.at, p.material, p.draw)) {
          if (left <= EPS) break;
          const q = Math.min(left, ctx.get('Store', id)?.contents[p.material] ?? 0);
          if (q <= EPS) continue;
          const r = ctx.command('inventory.release', { from: id, material: p.material, qty: q, to: p.to, why: p.why, ...(p.usedUp ? { usedUp: true } : {}) });
          if (!r.ok) ctx.reject(r.reasons[0]!.code, r.reasons[0]!.params);
          left -= q;
        }
        return p.qty - Math.max(0, left);
      },
      { label: 'Goods used up where they are drawn (energy from the batteries within reach)', internal: true },
    ),
    'inventory.extract': command(
      s.object({ from: s.enum(['ground', 'trees', 'rain', 'water', 'sun']), into: s.ref('store'), material: s.string(), qty: QtySchema, why: s.string(), since: s.number().optional(), age: s.number({ min: 0 }).optional(), parts: s.array(s.object({ qty: s.number({ min: 0 }), since: s.number(), age: s.number({ min: 0 }).optional() })).optional() }),
      (ctx: WriteCtx, p) => {
        requireMaterial(ctx, p.material);
        // only the module whose nature it is draws from it
        if (!NATURE[p.from].includes(ctx.caller)) throw new Error(`inventory.extract from ${p.from} by ${ctx.caller}: only ${NATURE[p.from].join(', ')} may draw from it (design/physical-state.md I1)`);
        if (!(p.qty > 0)) return;
        putIn(ctx, p.into, p.material, p.qty, { ...(p.since !== undefined ? { since: p.since } : {}), ...(p.age !== undefined ? { age: p.age } : {}), ...(p.parts ? { parts: p.parts } : {}) });
        addFlow(ctx, p.material, 'extracted', p.qty);
      },
      { label: 'Goods drawn from nature (by the module that owns it)', internal: true },
    ),
    // our goods a carrier is coming for: claimed where they are until it is there (the end of leg `leg`) to load them
    'inventory.pickup': command(
      s.object({ move: s.ref('move'), store: s.ref('store'), material: s.string(), qty: QtySchema, leg: s.int({ min: 0 }) }),
      (ctx: WriteCtx, p) => {
        requireMaterial(ctx, p.material);
        if (free(ctx, p.store, p.material) + EPS < p.qty) ctx.reject('inventory.insufficient', { store: ctx.require('Store', p.store).label, material: material(ctx, p.material).label, have: fmtQty(free(ctx, p.store, p.material)), need: fmtQty(p.qty) });
        ctx.setState('inventory', { ...ctx.state('inventory'), pickups: { ...(ctx.state('inventory').pickups ?? {}), [p.move]: { store: p.store, material: p.material, qty: p.qty, leg: p.leg } } });
      },
      { label: 'Goods claimed for a carrier coming to load them', internal: true },
    ),
    // our goods off a carrier into a store where it stands (a stop on its round: fuel into a machine's tank)
    'inventory.unload': command(
      s.object({ store: s.ref('store'), material: s.string(), qty: QtySchema }),
      (ctx: WriteCtx, p) => {
        requireMaterial(ctx, p.material);
        if (!(p.qty > 0)) return;
        // (a vessel takes only what it is for: no petrol in a diesel tank, r38)
        intoVessel(ctx, p.store, p.material);
        changeStock(ctx, p.store, p.material, p.qty);
        addFlow(ctx, p.material, 'transit', -p.qty);
      },
      { label: 'Goods off a carrier into a store where it is (they were loaded onto it)', internal: true },
    ),
    // our goods taken onto a carrier to go to another of our stores: neither used nor made (decision 0001)
    'inventory.load': command(
      s.object({ store: s.ref('store'), material: s.string(), qty: QtySchema }),
      (ctx: WriteCtx, p): Lots => {
        requireMaterial(ctx, p.material);
        const lots = takeOut(ctx, p.store, p.material, p.qty);
        addFlow(ctx, p.material, 'transit', p.qty);
        return lots;
      },
      { label: 'Load goods onto a carrier (they arrive in another store with its move)', internal: true },
    ),
    'inventory.fromOutside': command(
      s.object({ into: s.ref('store'), material: s.string(), qty: QtySchema, why: s.string() }),
      (ctx: WriteCtx, p) => {
        requireMaterial(ctx, p.material);
        if (!EDGE.includes(ctx.caller)) throw new Error(`inventory.fromOutside by ${ctx.caller}: only ${EDGE.join(', ')} bring goods over the world's edge this way`);
        if (!(p.qty > 0)) return;
        putIn(ctx, p.into, p.material, p.qty);
        addFlow(ctx, p.material, 'delivered', p.qty);
      },
      { label: 'Goods in over the world’s edge (a dealer’s first tank, a firm’s supplies)', internal: true },
    ),
    'inventory.toOutside': command(
      s.object({ from: s.ref('store'), material: s.string(), qty: QtySchema, why: s.string() }),
      (ctx: WriteCtx, p): Lots => {
        requireMaterial(ctx, p.material);
        if (!EDGE.includes(ctx.caller)) throw new Error(`inventory.toOutside by ${ctx.caller}: only ${EDGE.join(', ')} send goods over the world's edge this way`);
        if (!(p.qty > 0)) return {};
        const lots = takeOut(ctx, p.from, p.material, p.qty);
        addFlow(ctx, p.material, 'disposed', p.qty);
        return lots;
      },
      { label: 'Goods out over the world’s edge (a machine handed back with what is in its tank)', internal: true },
    ),
    'inventory.closeStore': command(
      s.object({ store: s.ref('store') }),
      (ctx: WriteCtx, p) => {
        const st = ctx.require('Store', p.store);
        // matter is never closed away with its holding
        const left = Object.entries(st.contents).filter(([, q]) => q > EPS);
        if (left.length) throw new Error(`inventory.closeStore ${st.label}: it still holds ${left.map(([m, q]) => `${q} ${m}`).join(', ')}`);
        // nor from under what still uses it (decision 0028)
        const uses = usesOf(ctx, p.store);
        if (uses.length) throw new Error(`inventory.closeStore ${st.label}: it is still used (${uses.map((u) => u.why).join('; ')})`);
        ctx.destroy(p.store);
      },
      { label: 'A holding no longer needed (empty only)', internal: true },
    ),
    'inventory.takeAlong': command(
      s.object({ unit: s.ref(), at: s.point() }),
      (ctx: WriteCtx, p) => {
        const take = lampFor(ctx, p.unit as EntityId, p.at as Vec2);
        if (!take) return;
        const carried = [...ctx.all('Store')].find(([, st]) => st.on === p.unit)?.[0];
        const holder = ctx.require('Store', take.store).holder;
        const name = ctx.hasPort('workforce') ? ctx.port('workforce').name(p.unit as EntityId) : String(p.unit);
        const made = carried ? undefined : ctx.command('inventory.createStore', { holder, label: `${name}: what they carry`, kind: 'carried', pos: [p.at[0], p.at[1]], on: p.unit as EntityId });
        const into = carried ?? (made?.ok ? (made.value as EntityId) : undefined);
        if (!into) return;
        putIn(ctx, into, take.material, 1, takeOut(ctx, take.store, take.material, 1));
      },
      { label: 'One setting out takes a lamp of theirs along from a store by them (S7)', internal: true },
    ),
    'inventory.holdFor': command(
      s.object({ store: s.ref('store'), for: s.ref() }),
      (ctx: WriteCtx, p) => ctx.adopt(p.store, p.for),
      { label: 'A holding that exists for something: it ends with it (decision 0028)', internal: true },
    ),
    'inventory.genesis': command(
      s.object({ store: s.ref('store'), material: s.string(), qty: QtySchema, why: s.string() }),
      (ctx: WriteCtx, p) => {
        requireMaterial(ctx, p.material);
        if (!ctx.trusted && !ctx.setup) throw new Error('inventory.genesis: goods are given only by the world\'s definition (setup) or a test harness');
        putIn(ctx, p.store, p.material, p.qty);
        addFlow(ctx, p.material, 'stocked', p.qty);
      },
      { label: 'Goods the world begins with (world definition and tests only)', internal: true },
    ),
    'inventory.remove': command(
      s.object({ store: s.ref('store'), material: s.string(), qty: QtySchema, why: s.string() }),
      (ctx: WriteCtx, p) => {
        requireMaterial(ctx, p.material);
        if (!ctx.trusted) throw new Error('inventory.remove: goods are taken out of the world only by a test harness');
        takeOut(ctx, p.store, p.material, p.qty);
        addFlow(ctx, p.material, 'stocked', -p.qty);
      },
      { label: 'Goods taken out of the world (tests only)', internal: true },
    ),
    'inventory.stock': command(
      s.object({ store: s.ref('store'), material: s.string(), qty: QtySchema }),
      (ctx: WriteCtx, p) => {
        const mat = requireMaterial(ctx, p.material);
        const holder = requireStore(ctx, p.store).holder;
        if (!ctx.trusted && !ctx.setup) throw new Error('inventory.stock: opening stock is the world\'s definition (setup) or a test harness');
        const offer = offersOf(ctx).buy[p.material]?.[0];
        if (!offer) ctx.reject('inventory.noSupplier', { material: mat.label });
        putIn(ctx, p.store, p.material, p.qty);
        addFlow(ctx, p.material, 'stocked', p.qty);
        ctx.ledger.post({
          from: acct(holder, ACCOUNTS.cash),
          to: acct(holder, purchaseAccount(mat)),
          amount: p.qty * offer.price * index(ctx, ctx.now),
          memo: `Opening stock ${fmtQty(p.qty)} ${mat.unit} ${mat.label}`,
          category: purchaseAccount(mat),
          refs: [p.store],
        });
      },
      'Opening stock (scenario)',
    ),
    'inventory.sell': command(
      s.object({ store: s.ref('store'), material: s.string(), qty: QtySchema, buyer: s.string().optional(), party: s.ref('party').optional() }),
      (ctx: WriteCtx, p) => {
        const mat = requireMaterial(ctx, p.material);
        const st = requireStore(ctx, p.store);
        // (a party's administrator selling for it names it)
        const party = ctx.caller !== 'client' && p.party ? p.party : actorOf(ctx);
        if (st.holder !== party) ctx.reject('inventory.notOurs', { store: st.label, party: partyLabel(ctx, party) });
        if (!(p.qty > 0)) ctx.reject('inventory.invalidQty', { qty: p.qty });
        // (word to a buyer, S4)
        const noWord = wordBlock(ctx, party);
        if (noWord) ctx.reject('inventory.noWord', { supplier: p.buyer ? (ctx.data('suppliers')[p.buyer]?.label ?? p.buyer) : 'a buyer', why: noWord.why }, noWord.remedies);
        // (pieces go whole, as they are bought)
        if (isCounted(mat) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) ctx.reject('inventory.wholePieces', { material: mat.label, qty: p.qty });
        // (what is not sold or sent off already)
        const have = Math.max(0, (st.contents[p.material] ?? 0) - claimed(ctx, p.store, p.material));
        // (all of it, as shown to two decimals: Qwen S145)
        if (p.qty > have && p.qty - have <= 0.005 + EPS) p = { ...p, qty: have };
        if (have + EPS < p.qty) ctx.reject('inventory.insufficient', { store: st.label, material: mat.label, have: tidy(have), need: p.qty, unit: mat.unit });
        const offers = offersOf(ctx).sell[p.material] ?? [];
        // (the best buyer who takes this much; else the best, to say from how much)
        const offer = p.buyer ? offers.find((o) => o.supplier === p.buyer) : (offers.find((o) => p.qty + EPS >= o.minOrder) ?? offers[0]);
        if (!offer) ctx.reject('inventory.noBuyer', { material: mat.label });
        const sup = ctx.data('suppliers')[offer!.supplier]!;
        if (p.qty + EPS < offer!.minOrder) ctx.reject('inventory.belowMinSale', { buyer: sup.label, material: mat.label, minOrder: offer!.minOrder, unit: mat.unit, qty: p.qty });
        if (!reaches(ctx, offer!.supplier)) ctx.reject('inventory.noAccess', { supplier: sup.label, vehicle: ctx.port('routing').profile(sup.vehicleProfile).label });
        // the buyer's lorry has to get to the goods (and back out)
        if (!collects(ctx, offer!.supplier, st.pos)) ctx.reject('inventory.cannotCollect', { buyer: sup.label, vehicle: ctx.port('routing').profile(sup.vehicleProfile).label, store: st.label });
        if (!ctx.port('prices').hasBooks(party)) ctx.reject('inventory.noBooks', { party: partyLabel(ctx, party) });
        const id = ctx.spawn('order', { name: `Sale ${fmtQty(p.qty)} ${mat.unit} ${mat.label}` });
        // collected lorry by lorry from the buyer's lead time on: the goods stay ours, in the store, until a lorry is
        // loaded with them (paid as each load reaches the buyer)
        const from = ctx.now + Math.round(offer!.leadTimeDays * DAY);
        // used goods: each as much less as it is old (the age it has had in use), the least worn first
        const used = usedShare(offer!, lotsOf(ctx, p.store, p.material, p.qty, claimed(ctx, p.store, p.material)));
        const unitPrice = offer!.price * index(ctx, ctx.now) * used.share;
        writeOrder(ctx, id, { supplier: offer!.supplier, material: p.material, store: p.store, qty: p.qty, delivered: 0, inTransit: 0, status: 'open', orderedAt: ctx.now, earliest: from, unitPrice, direction: 'outbound', sale: true });
        scheduleTrucks(ctx, id, sup, offer!.supplier, mat, p.qty, from, 'haul');
        ctx.log('info', `${sup.label} buys ${fmtQty(p.qty)} ${mat.unit} ${mat.label} at ${unitPrice.toFixed(2)} € a ${mat.unit}${used.note}, collected from ${st.label}.`, [id]);
        return id;
      },
      { label: 'Sell goods to a buyer', description: 'Sell goods of a store of ours to a buyer who collects them (see inventory.buyers: who buys what, at what price, from how much); the goods are set aside now and paid for as each load reaches the buyer; a sale can be called off for what is not yet collected (inventory.cancelOrder).' },
    ),
    'inventory.dispose': command(
      s.object({ store: s.ref('store'), material: s.string(), qty: QtySchema }),
      (ctx: WriteCtx, p) => {
        const mat = requireMaterial(ctx, p.material);
        const st = requireStore(ctx, p.store);
        if (!(p.qty > 0)) ctx.reject('inventory.invalidQty', { qty: p.qty });
        if (isCounted(mat) && Math.abs(p.qty - Math.round(p.qty)) > 1e-9) ctx.reject('inventory.wholePieces', { material: mat.label, qty: p.qty });
        // (what is not sold or sent off already)
        const have = Math.max(0, (st.contents[p.material] ?? 0) - claimed(ctx, p.store, p.material));
        // (all of it, as shown to two decimals: Qwen S145)
        if (p.qty > have && p.qty - have <= 0.005 + EPS) p = { ...p, qty: have };
        if (have + EPS < p.qty) ctx.reject('inventory.insufficient', { store: st.label, material: mat.label, have: tidy(have), need: p.qty, unit: mat.unit });
        const offer = offersOf(ctx).dispose[p.material]?.[0];
        if (!offer) ctx.reject('inventory.noDisposalSite', { material: mat.label });
        if (!reaches(ctx, offer.supplier)) ctx.reject('inventory.noAccess', { supplier: ctx.data('suppliers')[offer.supplier]!.label, vehicle: ctx.port('routing').profile(ctx.data('suppliers')[offer.supplier]!.vehicleProfile).label });
        const sup = ctx.data('suppliers')[offer.supplier]!;
        // its vehicle has to get to the goods (and back out): else they would be set aside for a lorry that never comes
        if (!collects(ctx, offer.supplier, st.pos)) ctx.reject('inventory.cannotCollect', { buyer: sup.label, vehicle: ctx.port('routing').profile(sup.vehicleProfile).label, store: st.label });
        if (p.qty + EPS < offer.minOrder) ctx.reject('inventory.belowMinDisposal', { site: sup.label, material: mat.label, minOrder: offer.minOrder, unit: mat.unit, qty: p.qty });
        // (word to the firm that collects it, S4)
        const noWord = wordBlock(ctx, st.holder);
        if (noWord) ctx.reject('inventory.noWord', { supplier: sup.label, why: noWord.why }, noWord.remedies);
        // it comes for them after its lead time
        const from = ctx.now + Math.round(offer.leadTimeDays * DAY);
        const id = ctx.spawn('order', { name: `Disposal ${fmtQty(p.qty)} ${mat.unit} ${mat.label}` });
        // the goods stay in the store until each lorry is loaded with them
        writeOrder(ctx, id, {
          supplier: offer.supplier,
          material: p.material,
          store: p.store,
          qty: p.qty,
          delivered: 0,
          inTransit: 0,
          status: 'open',
          orderedAt: ctx.now,
          earliest: from,
          unitPrice: offer.price * index(ctx, ctx.now),
          direction: 'outbound',
        });
        scheduleTrucks(ctx, id, sup, offer.supplier, mat, p.qty, from, 'haul');
        return id;
      },
      'Haul material to a disposal site',
    ),
  },
  ended: {
    // a holding that existed for something that has ended (a felling called off, decision 0028): empty and used by
    // nothing else, it is given up (S504: a cancelled felling's empty heap stood in the stores for ever); still used
    // (another felling stacks onto it, one of ours lives there, goods coming) it stays, held for the next work that puts
    // its goods there, else an ordinary store of its holder; with goods in it too
    store: (ctx, id, cause) => {
      const st = ctx.require('Store', id);
      const held = Object.values(st.contents).some((q) => q > EPS);
      const uses = usesOf(ctx, id);
      if (!held && !uses.length) {
        ctx.log('info', `${st.label}, empty, is given up: ${cause.why}.`, [id]);
        ctx.command('inventory.closeStore', { store: id });
        return;
      }
      const next = uses.find((u) => u.holdFor && ctx.entity(u.by) && !ctx.ended(u.by));
      ctx.adopt(id, next?.by ?? null);
      ctx.log('info', `${st.label} stays${next ? '' : `, a store of ${partyLabel(ctx, st.holder)}`} (${cause.why}${uses.length ? `; ${uses.map((u) => u.why).join('; ')}` : ''}).`, [id]);
    },
  },
  systems: [
    { id: 'seasoning', every: DAY, offset: 12 * HOUR, phase: 'physical', run: (ctx) => season(ctx, false) },
    { id: 'perishing', every: HOUR, phase: 'physical', run: (ctx) => season(ctx, true) },
    // goods a lorry set down short of their store, at the roadside, with nobody of ours by them overnight (S5b)
    { id: 'roadside', every: DAY, offset: 3 * HOUR, phase: 'physical', run: (ctx) => roadsideNight(ctx) },
    // what should be here by now and is not, and nothing of it on the road: said, with what to do (robustness step 0:
    // a consequence that matters is told, Qwen S509: water three weeks late, nobody told)
    { id: 'overdue', every: HOUR, phase: 'report', run: (ctx) => overdue(ctx) },
  ],
  timers: {
    // the driver rings ahead (S5b): the word reaches one of ours (a phone with charge, or one in hearing of the drop
    // point), who sets out to be there when he is; nobody: he rings again on arrival
    ringAhead(ctx, payload: { move: EntityId }) {
      const lorry = ctx.state('inventory').lorries?.[payload.move];
      const mv = ctx.get('Move', payload.move);
      if (!lorry || !mv || !lorry.attended || lorry.coming) return;
      // (a load on it still to be taken from his hands: by its own order's terms, open or called off on the way)
      const loads = lorry.loads.filter((l) => {
        const lo = ctx.get('Order', l.order);
        return lo && handoverOf(ctx, lo) === 'attended';
      });
      if (!loads.length) return;
      const o = ctx.require('Order', loads[0]!.order);
      const sup = ctx.data('suppliers')[o.supplier]!;
      const leg = mv.legs.at(-1)!;
      const at: Vec2 = [leg.route.to[0], leg.route.to[1]];
      const payer = ctx.require('Store', o.store).holder;
      if (receiverAt(ctx, payer, at)) return;
      const until = leg.arrive + Math.round((sup.failed?.wait.value ?? 15) * MINUTE);
      const come = whoComes(ctx, payer, at, until, payload.move);
      if (!come) return;
      const st = ctx.state('inventory');
      ctx.setState('inventory', { ...st, lorries: { ...(st.lorries ?? {}), [payload.move]: { ...lorry, coming: { person: come.person, at: come.arrive, from: [come.from[0], come.from[1]] } } } });
      ctx.log('info', `The driver of ${sup.label} rings ahead: there about ${ctx.calendar.format(leg.arrive, 'time')} with ${loads.map((l) => material(ctx, l.material).label).join(', ')}; ${ctx.port('workforce').name(come.person)} goes to meet him at ${fmtPos(at)}.`, loads.map((l) => l.order));
    },
    // a lorry at its drop point: each load handed over to one of ours there, set down by our consent, or back with it (S5)
    handover(ctx, payload: { move: EntityId }) {
      const h = ctx.state('inventory').handovers?.[payload.move];
      if (!h) return;
      const { [payload.move]: _h, ...rest } = ctx.state('inventory').handovers ?? {};
      ctx.setState('inventory', { ...ctx.state('inventory'), handovers: rest });
      const ref = h.loads[0]!.order;
      const o = ctx.get('Order', ref);
      // (the one held to meet him: the handover is done, whatever came of it; they walk back to where they were, the goods
      // left where the lorry stood: carrying them on is ours)
      const done = () => letGoMeeter(ctx, h.meeter, payload.move, h.back);
      if (!o) {
        done();
        return lorryBack(ctx, ref, h);
      }
      const payer = ctx.require('Store', o.store).holder;
      const sup = ctx.data('suppliers')[o.supplier]!;
      const who = receiverAt(ctx, payer, h.at);
      // every load on the lorry the same way (S5b, review x), by its own order: taken by one of ours; or set down by our
      // consent given for it; else back with the driver (an order called off on the way included: its loads on the road
      // come and are handed over as agreed, and with nobody to take them go back)
      const back: LorryLoad[] = [];
      for (const l of h.loads) {
        const lo = ctx.get('Order', l.order);
        if (!lo) continue;
        if (!who && handoverOf(ctx, lo) !== 'drop') {
          back.push(l);
          continue;
        }
        const lm = material(ctx, lo.material);
        landed(ctx, l.order, 'delivery', l.qty, h.at, ctx.get('Move', payload.move)?.legs[0]?.depart);
        if (who) ctx.log('info', `${ctx.port('workforce').name(who)} takes ${fmtQty(l.qty)} ${lm.unit} ${lm.label} from the driver of ${sup.label}, signed for.`, [l.order]);
        else ctx.log('info', `The driver of ${sup.label} sets ${fmtQty(l.qty)} ${lm.unit} ${lm.label} down at ${fmtPos(h.at)}, as agreed.`, [l.order]);
        news(ctx, l.order, 'inventory.deliveryFailed', null);
      }
      done();
      if (!back.length) return lorryBack(ctx, ref, h);
      // nobody came for these: back with him; a fee for the trip (one for the lorry); each load again on its next loading
      // day, or, its tries used or its order called off, taken off its order (tries counted by the load: review S5 #3)
      const fee = sup.failed?.fee.value ?? 0;
      const first = material(ctx, back[0]!.material);
      if (fee > 0) ctx.ledger.post({ from: acct(payer, ACCOUNTS.cash), to: acct(payer, ACCOUNTS.transport), amount: fee, memo: `Failed delivery: ${sup.label}, nobody to take ${first.label}${back.length > 1 ? ` and ${back.length - 1} more` : ''}`, category: ACCOUNTS.transport, refs: back.map((l) => l.order) });
      for (const [i, l] of back.entries()) failedLoad(ctx, l, h.at, i === 0 ? fee : 0);
      lorryBack(ctx, ref, h, back.map((l) => ({ material: l.material, qty: l.qty })));
    },
    // a supplier's lorry due to leave its yard with a load of the order (and the others it takes along: a tour)
    truck(ctx, payload: { order: EntityId; qty: number; due?: boolean; slot?: number; blocked?: number }) {
      const o = ctx.get('Order', payload.order);
      if (!o || o.status !== 'open') return;
      // (its booking taken off: it went on another order's lorry, a tour: S5b)
      if (payload.slot !== undefined && o.loads && !o.loads.includes(payload.slot)) return;
      const sup = ctx.data('suppliers')[o.supplier]!;
      const st = ctx.require('Store', o.store);
      const mat = material(ctx, o.material);
      // the lorry is due: it comes, or the supplier is late (drawn now: nobody knows it before)
      const pu = sup.punctuality;
      if (!payload.due && pu) {
        const rng = ctx.rng(`punctuality:${o.supplier}`);
        if (!rng.chance(pu.onTime.value)) {
          // late by what the data says (held up at the yard or on the road), not by the yard's hours
          const late = Math.round(rng.exponential(pu.late.value) * HOUR);
          const slot = Math.round(ctx.now + late + externalLegS(ctx, sup, o.supplier));
          ctx.log('warn', `${sup.label} is late with ${fmtQty(payload.qty)} ${mat.unit} of ${mat.label}: now expected ${ctx.calendar.format(slot)}.`, [payload.order, o.store]);
          // (booked for later now: the order's load says so, and that it is late, for as long as it is still to come)
          rebook(ctx, payload.order, payload.slot, slot, true);
          ctx.at(ctx.now + late, 'truck', { ...payload, due: true, slot });
          return;
        }
      }
      if (fleetBusy(ctx, payload.order, o.supplier, 'truck', payload)) return;
      const dep = departure(ctx, o.supplier);
      const beyond = beyondKmOf(ctx, sup, o.supplier);
      // every order on the lorry a load of its own (S5b, review x): this one, and as a tour the supplier's other orders for
      // the same store, one load left each, booked for today, ready, on the same lorry as far as it carries (one shop's
      // items in one van)
      const lead: LorryLoad & { slot: number | undefined } = { order: payload.order, material: o.material, qty: payload.qty, attempt: attemptOf(o, o.loads?.[slotIndex(o.loads, payload.slot)]), slot: payload.slot };
      const tour = tourOf(ctx, payload.order, o, payload.qty);
      const loads = [lead, ...tour];
      const attended = handoverOf(ctx, o) === 'attended';
      const goodsLoads = loads.map((l) => ({ goods: { material: l.material, qty: l.qty, unit: material(ctx, l.material).unit, mass: (l.qty * unitMass(material(ctx, l.material))) / 1000, order: l.order } }));
      // the supplier's lorry, from their yard (beyond the way in, or on the map), as far towards our store as it can go
      const send = (to: Vec2) =>
        ctx.command('moves.dispatch', {
          // from the yard: the way to the map is part of the lorry's trip (it can break down there too)
          legs: [{ carrier: { class: sup.vehicleProfile, fleet: o.supplier }, from: 'pos' in dep! ? dep.pos : [st.pos[0], st.pos[1]], to: [to[0], to[1]], ...('node' in dep! ? { externalNode: dep.node, ...(beyond > 0 ? { beyondKm: beyond } : {}) } : {}) }],
          loads: goodsLoads,
          purpose: 'delivery',
          ref: payload.order,
          requester: INVENTORY_MODULE_ID,
          // (handed over to one of ours: the lorry waits at the drop point, and goes back when it is done there, S5)
          returnEmpty: !attended,
        });
      // to the site, as far as the lorry can go; to the kerb, only to the way nearest the store (carrying it in is ours)
      const kerb = sup.delivery === 'kerb' ? ctx.port('routing').nearest(st.pos, { openOnly: true, profile: sup.vehicleProfile })?.point : undefined;
      let r = dep === undefined ? null : send(kerb ?? st.pos);
      if (r && !r.ok) {
        // it cannot reach the store: it sets the goods down at the nearest point of a way it can use (A3)
        const near = ctx.port('routing').nearest(st.pos, { openOnly: true, profile: sup.vehicleProfile });
        const there = near ? send(near.point) : null;
        if (there?.ok) r = there;
      }
      if (!r || !r.ok) {
        const reason = !r ? `${sup.label} cannot reach the map` : r.reasons.map((b) => ctx.formatBlocker(b)).join('; ');
        // it cannot come: it tries again on its next loading day, a few times, then that load is called off (no hourly
        // try for ever: robustness step 1; Qwen S502); it was due: a retry does not draw its lateness again
        const blocked = (payload.blocked ?? 0) + 1;
        const attempts = sup.failed?.attempts ?? 2;
        const remedies: Remedy[] = [{ label: 'Call off what has not come', command: { type: 'inventory.cancelOrder', payload: { order: payload.order } } }, ...ctx.contributions('provision').flatMap((c) => c.impl(ctx, o.store, o.material, payload.qty))];
        if (blocked >= attempts) {
          const loads = o.loads ? dropSlot(o.loads, payload.slot) : undefined;
          const qty = Math.max(o.delivered + o.inTransit, o.qty - payload.qty);
          const ends = o.inTransit <= EPS && o.delivered + EPS >= qty;
          const status = ends ? (o.delivered > EPS ? ('complete' as const) : ('cancelled' as const)) : o.status;
          writeOrder(ctx, payload.order, { ...o, qty, status, ...(loads ? { loads } : {}) });
          releaseStock(ctx, o.supplier, o.material, payload.order, payload.qty);
          news(ctx, payload.order, 'inventory.deliveryBlocked', null);
          ctx.log('warn', `${sup.label} cannot bring ${fmtQty(payload.qty)} ${mat.unit} ${mat.label} to ${st.label} (${reason}): that load is called off${status === 'cancelled' ? ', and with it the order' : ''}.`, [payload.order, o.store]);
          if (status === 'complete') ctx.emit('inventory.orderComplete', { order: payload.order });
          return;
        }
        // (booked again in the supplier's calendar, its own booking now given up: review y)
        const booked = bookedOf(ctx, o.supplier);
        const own = payload.slot === undefined ? -1 : booked.findIndex((b) => Math.abs(b + externalLegS(ctx, sup, o.supplier) - payload.slot!) < 1);
        const next = freeSlot(ctx, sup, ctx.calendar.startOfDay(ctx.now) + DAY, own < 0 ? booked : [...booked.slice(0, own), ...booked.slice(own + 1)]);
        news(ctx, payload.order, 'inventory.deliveryBlocked', { severity: 'warn', params: { reason: `${reason}; it tries again ${ctx.calendar.format(next)}` }, remedies });
        const slot = Math.round(next + externalLegS(ctx, sup, o.supplier));
        rebook(ctx, payload.order, payload.slot, slot);
        ctx.at(next, 'truck', { ...payload, due: true, blocked, slot });
        return;
      }
      news(ctx, payload.order, 'inventory.deliveryBlocked', null);
      // (on the road now: no longer loads to come; a companion's goods taken off the shelf now, not at its later booking)
      for (const l of loads) {
        onTheRoad(ctx, l.order, l.qty, l.slot);
        if (l !== lead) takeNow(ctx, o.supplier, l.material, l.order, l.qty);
      }
      if (tour.length) ctx.log('info', `${sup.label} brings ${loads.length} orders to ${st.label} on one lorry: ${loads.map((l) => ctx.entity(l.order)?.name ?? l.order).join(', ')}.`, loads.map((l) => l.order));
      // (whether it hands over to one of ours, and every order's load on it with its own try: what it does at the drop point, S5)
      const st0 = ctx.state('inventory');
      ctx.setState('inventory', { ...st0, lorries: { ...(st0.lorries ?? {}), [r.value as EntityId]: { attended, loads: loads.map(({ order, material, qty, attempt }) => ({ order, material, qty, attempt })) } } });
      // (handed over to one of ours: the driver rings ahead, so that someone is there when he is, S5b)
      const ahead = (sup.ringsAhead?.value ?? 0) * MINUTE;
      if (attended && ahead > 0) ctx.at(Math.max(ctx.now, ctx.require('Move', r.value as EntityId).legs.at(-1)!.arrive - ahead), 'ringAhead', { move: r.value as EntityId });
    },
    haul(ctx, payload: { order: EntityId; qty: number; slot?: number }) {
      const o = ctx.get('Order', payload.order);
      if (!o || o.status !== 'open') return;
      // (its load taken off the order meanwhile: nothing to come for)
      if (payload.slot !== undefined && o.loads && !o.loads.includes(payload.slot)) return;
      const sup = ctx.data('suppliers')[o.supplier]!;
      const st = ctx.require('Store', o.store);
      const mat = material(ctx, o.material);
      // what is there to load (the goods were never set aside: what was used meanwhile is not there)
      const there = Math.min(payload.qty, st.contents[o.material] ?? 0);
      if (there <= EPS) {
        // (what is still to come of it is off: complete only for what was taken, called off when nothing was; paid as
        // taken, so nothing is owed for what is not: review y)
        const left = tidy(o.qty - o.delivered - o.inTransit - (o.collecting ?? 0));
        const qty = tidy(o.delivered + o.inTransit + (o.collecting ?? 0));
        const status = settled({ ...o, qty });
        writeOrder(ctx, payload.order, { ...o, qty, status, ...(o.loads ? { loads: [] } : {}) });
        ctx.log('warn', `${sup.label} came for ${fmtQty(payload.qty)} ${mat.unit} ${mat.label} at ${st.label}: there is none left there; ${status === 'cancelled' ? `the ${o.sale ? 'sale' : 'haul'} is off, nothing of it taken` : `the rest of the ${o.sale ? 'sale' : 'haul'} (${fmtQty(left)} ${mat.unit}) is off`}.`, [payload.order, o.store]);
        if (status === 'complete') ctx.emit('inventory.orderComplete', { order: payload.order });
        return;
      }
      payload = { ...payload, qty: there };
      if (fleetBusy(ctx, payload.order, o.supplier, 'haul', payload)) return;
      const dep = departure(ctx, o.supplier);
      const carrier = { class: sup.vehicleProfile, fleet: o.supplier };
      const here: Vec2 = [st.pos[0], st.pos[1]];
      const r = dep === undefined
        ? null
        : ctx.command('moves.dispatch', {
            // the buyer's or the disposal firm's lorry: out from their base, empty, to our store; loaded there, back to
            // their site (finding 19: it does not start loaded at our store, nor end there)
            // (from its base and home again: the firm's way beyond the map included, as for its deliveries: r37)
            legs: [
              { carrier, from: 'pos' in dep ? dep.pos : here, to: here, ...('node' in dep ? { externalNode: dep.node, ...(beyondKmOf(ctx, sup, o.supplier) > 0 ? { beyondKm: beyondKmOf(ctx, sup, o.supplier) } : {}) } : {}), loads: [] },
              { carrier, from: here, to: 'pos' in dep ? dep.pos : here, ...('node' in dep ? { externalDestination: dep.node, ...(beyondKmOf(ctx, sup, o.supplier) > 0 ? { beyondKm: beyondKmOf(ctx, sup, o.supplier) } : {}) } : {}), loads: [{ goods: { material: o.material, qty: payload.qty, unit: mat.unit, holder: st.holder } }] },
            ],
            purpose: 'disposal',
            ref: payload.order,
            requester: INVENTORY_MODULE_ID,
          });
      if (!r || !r.ok) {
        const reason = !r ? `${sup.label} cannot reach the map` : r.reasons.map((b) => ctx.formatBlocker(b)).join('; ');
        // a sale the buyer cannot collect can be called off (the goods stay ours)
        const off = o.sale ? [{ label: 'Call off the sale', command: { type: 'inventory.cancelOrder', payload: { order: payload.order } } }] : undefined;
        ctx.blockers.set(payload.order, [{ code: 'inventory.deliveryBlocked', severity: 'warn', params: { reason }, ...(off ? { remedies: off } : {}) }]);
        ctx.after(DISPATCH_RETRY_S, 'haul', payload);
        return;
      }
      ctx.blockers.clear(payload.order);
      // on its way to load: the goods stay ours, claimed by the order, until it is here (moves.legDone: r37); no longer a
      // load to come (its time at the yard is free again: the calendar is the orders' loads)
      writeOrder(ctx, payload.order, { ...o, collecting: (o.collecting ?? 0) + payload.qty, ...(o.loads ? { loads: dropSlot(o.loads, payload.slot) } : {}) });
    },
  },
  on: {
    // insolvency proceedings opened: the administrator sells what buyers collect of the party's goods (Qwen S150)
    'economy.insolvencyOpened': (ctx, e) => {
      const sold: string[] = [];
      for (const store of [...ctx.all('Store')].filter(([, st]) => st.holder === e.party).map(([id]) => id).sort()) {
        for (const [mat, have] of Object.entries(ctx.require('Store', store).contents).sort(([a], [b]) => (a < b ? -1 : 1))) {
          const m = material(ctx, mat);
          const qty = isCounted(m) ? Math.floor(have + 1e-9) : have;
          if (!(qty > EPS) || !(offersOf(ctx).sell[mat] ?? []).some((o) => qty + EPS >= o.minOrder && collects(ctx, o.supplier, ctx.require('Store', store).pos))) continue;
          const r = ctx.command('inventory.sell', { store, material: mat, qty, party: e.party });
          if (r.ok) sold.push(`${fmtQty(qty)} ${m.unit} ${m.label}`);
        }
      }
      if (sold.length) ctx.log('info', `The administrator sells ${partyLabel(ctx, e.party)}'s goods: ${sold.join(', ')}.`, [e.party]);
    },
    // a move with goods on it stopped on the way (design/physical-state.md I5): ours are set down where it stands, in a
    // store of ours there (beyond the map, they stay on it); a supplier's lorry turned back brings its load again
    'moves.stopped': (ctx, e) => {
      // a carrier that never got to our goods: they never left their store
      if (ctx.state('inventory').pickups?.[e.move]) {
        const { [e.move]: _gone, ...rest } = ctx.state('inventory').pickups ?? {};
        ctx.setState('inventory', { ...ctx.state('inventory'), pickups: rest });
        return;
      }
      if (e.requester !== INVENTORY_MODULE_ID || !e.ref) return;
      // a buyer's lorry stopped on its way to load: the goods were never taken; it comes again (r38: not a claim for ever)
      if (e.purpose === 'disposal' && e.leg === 0) {
        const o = ctx.get('Order', e.ref);
        const planned = ctx.get('Move', e.move)?.legs[1]?.loads.reduce((a, l) => a + ('goods' in l ? l.goods.qty : 0), 0) ?? 0;
        if (!o || o.status !== 'open' || !(planned > 0)) return;
        writeOrder(ctx, e.ref, { ...o, collecting: Math.max(0, (o.collecting ?? 0) - planned) });
        news(ctx, e.ref, 'inventory.deliveryBlocked', { severity: 'warn', params: { reason: e.why } });
        ctx.after(DISPATCH_RETRY_S, 'haul', { order: e.ref, qty: planned });
        return;
      }
      // a supplier's lorry turned back: every order's load on it (S5b, review x) the same way, by its own order: brought
      // again (its try kept), or, its order called off meanwhile, the supplier's again; the one sent to meet it let go
      if (e.purpose === 'delivery') {
        const lorry = ctx.state('inventory').lorries?.[e.move];
        if (!lorry) return;
        const { [e.move]: _l, ...lorries } = ctx.state('inventory').lorries ?? {};
        ctx.setState('inventory', { ...ctx.state('inventory'), lorries });
        letGoMeeter(ctx, lorry.coming?.person, e.move, lorry.coming?.from);
        for (const l of lorry.loads) {
          const o = ctx.get('Order', l.order);
          if (!o) continue;
          if (o.status !== 'open') {
            writeOrder(ctx, l.order, { ...o, inTransit: Math.max(0, o.inTransit - l.qty) });
            releaseStock(ctx, o.supplier, o.material, l.order, l.qty);
            const m = material(ctx, o.material);
            ctx.log('warn', `The lorry of ${ctx.data('suppliers')[o.supplier]?.label ?? o.supplier} with ${fmtQty(l.qty)} ${m.unit} ${m.label} stopped on the way (${e.why}); the order was called off, so it is not brought again.`, [l.order]);
            continue;
          }
          const slot = Math.round(ctx.now + DISPATCH_RETRY_S);
          writeOrder(ctx, l.order, { ...o, inTransit: Math.max(0, o.inTransit - l.qty), loads: [...(o.loads ?? []), slot], ...(l.attempt > 1 ? { loadInfo: [...(o.loadInfo ?? []), { slot, attempt: l.attempt }] } : {}) });
          news(ctx, l.order, 'inventory.deliveryBlocked', { severity: 'warn', params: { reason: e.why } });
          ctx.after(DISPATCH_RETRY_S, 'truck', { order: l.order, qty: l.qty, due: true, slot });
        }
        return;
      }
      // a collector's lorry stopped with our goods on it: what it carried is off the books of the haul
      if (e.purpose === 'disposal') {
        const o = ctx.get('Order', e.ref);
        const qty = e.loads.reduce((a, l) => a + ('goods' in l && o && l.goods.material === o.material ? l.goods.qty : 0), 0);
        if (!o || o.status !== 'open' || !(qty > 0)) return;
        writeOrder(ctx, e.ref, { ...o, inTransit: Math.max(0, o.inTransit - qty) });
        news(ctx, e.ref, 'inventory.deliveryBlocked', { severity: 'warn', params: { reason: e.why } });
        return;
      }
      // (taken on at a pickup: what was taken, as it was, r38)
      const ab = ctx.state('inventory').aboard?.[e.move];
      if (ab) {
        const { [e.move]: _a, ...aboard } = ctx.state('inventory').aboard ?? {};
        ctx.setState('inventory', { ...ctx.state('inventory'), aboard });
      }
      const goods = ab ? [{ ...ab, unit: material(ctx, ab.material).unit }] : e.loads.flatMap((l) => ('goods' in l && l.goods.qty > 0 ? [l.goods] : []));
      const order = e.purpose === 'carried' ? ctx.get('Order', e.ref) : undefined;
      // stopped on the way to the shop: nothing was bought; what was paid at booking comes back (r37)
      if (!goods.length && order && order.status === 'open' && order.carried && order.inTransit > 0) {
        const holder = ctx.get('Store', order.store)?.holder;
        const paid = (order.unitPrice ?? 0) * order.inTransit;
        const m = material(ctx, order.material);
        if (holder && paid > 0) ctx.ledger.post({ from: acct(holder, purchaseAccount(m)), to: acct(holder, ACCOUNTS.cash), amount: paid, memo: `${fmtQty(order.inTransit)} ${m.unit} ${m.label}: not bought, the way there stopped (${e.why})`, category: purchaseAccount(m), refs: [e.ref, order.store] });
        writeOrder(ctx, e.ref, { ...order, inTransit: 0, status: 'cancelled' });
        ctx.log('warn', `The errand for ${fmtQty(order.inTransit)} ${m.unit} ${m.label} stopped on the way there (${e.why}): nothing bought.`, [e.ref]);
        return;
      }
      if (!goods.length || !e.at) return;
      const owner = goods[0]!.holder ?? (order ? ctx.get('Store', order.store)?.holder : ctx.get('Store', e.ref)?.holder);
      if (!owner) return;
      const into = ctx.command('inventory.createStore', { holder: owner, label: `Left on the way (${e.why})`, kind: 'stockpile', pos: [e.at[0], e.at[1]] });
      if (!into.ok) return;
      for (const g of goods) {
        // (drawn at a creek: from the water there; ours on the way: out of transit; bought: delivered, where it stands)
        if (e.purpose === 'drawn') {
          drawnInto(ctx, e.move, into.value as EntityId, g);
          continue;
        }
        changeStock(ctx, into.value as EntityId, g.material, g.qty, { ...(g.since !== undefined ? { since: g.since } : {}), ...(g.age !== undefined ? { age: g.age } : {}), ...(g.parts ? { parts: g.parts } : {}) });
        addFlow(ctx, g.material, e.purpose === 'carried' ? 'delivered' : 'transit', e.purpose === 'carried' ? g.qty : -g.qty);
      }
      if (order && order.status === 'open') writeOrder(ctx, e.ref, { ...order, delivered: order.delivered + order.inTransit, inTransit: 0, status: 'complete' });
      ctx.log('warn', `${goods.map((g) => `${fmtQty(g.qty)} ${material(ctx, g.material).unit} ${material(ctx, g.material).label}`).join(', ')} left where the move stopped (${e.why}), at (${Math.round(e.at[0])}, ${Math.round(e.at[1])}).`, [into.value as EntityId]);
    },
    // a buyer's or disposal lorry at our store: loaded, the goods out of our books, over the world's edge with it
    'moves.legDone': (ctx, e) => {
      // a carrier come for our goods: they go onto it now
      const pk = ctx.state('inventory').pickups?.[e.move];
      if (pk && e.leg === pk.leg) {
        const { [e.move]: _done, ...rest } = ctx.state('inventory').pickups ?? {};
        ctx.setState('inventory', { ...ctx.state('inventory'), pickups: rest });
        const q = Math.min(pk.qty, ctx.get('Store', pk.store)?.contents[pk.material] ?? 0);
        if (q > EPS) {
          const lots = takeOut(ctx, pk.store, pk.material, q);
          addFlow(ctx, pk.material, 'transit', q);
          ctx.setState('inventory', { ...ctx.state('inventory'), aboard: { ...(ctx.state('inventory').aboard ?? {}), [e.move]: { material: pk.material, qty: q, ...lots } } });
        }
        return;
      }
      const m = ctx.get('Move', e.move);
      const ref = m?.ref;
      if (e.requester !== INVENTORY_MODULE_ID || e.purpose !== 'disposal' || e.leg !== 0 || !ref) return;
      const o = ctx.get('Order', ref);
      const load = m?.legs[1]?.loads.find((l) => 'goods' in l);
      if (!o || !load || !('goods' in load)) return;
      // (a sale called off meanwhile: it leaves empty, the goods stay)
      if (o.status !== 'open') return;
      // (what is there of it: what was claimed, unless lost meanwhile)
      const q = Math.min(load.goods.qty, ctx.get('Store', o.store)?.contents[o.material] ?? 0);
      if (q > EPS) {
        takeOut(ctx, o.store, o.material, q, ref);
        addFlow(ctx, o.material, 'disposed', q);
      }
      // (what it came for and is not there: off the sale or haul, said; nothing left to come, it ends: review x)
      const short = tidy(load.goods.qty - Math.max(0, q));
      const qty = short > EPS ? tidy(o.qty - short) : o.qty;
      const collecting = Math.max(0, (o.collecting ?? 0) - load.goods.qty);
      const inTransit = o.inTransit + Math.max(0, q);
      const status = settled({ ...o, qty, collecting, inTransit });
      writeOrder(ctx, ref, { ...o, qty, status, collecting, inTransit });
      if (short > EPS) {
        const mat = material(ctx, o.material);
        ctx.log('warn', `${ctx.data('suppliers')[o.supplier]?.label ?? o.supplier} came for ${fmtQty(load.goods.qty)} ${mat.unit} ${mat.label} at ${ctx.get('Store', o.store)?.label ?? o.store}: ${fmtQty(short)} ${mat.unit} of it are not there; ${status === 'open' ? `the ${o.sale ? 'sale' : 'haul'} is ${fmtQty(qty)} ${mat.unit} now` : `the ${o.sale ? 'sale' : 'haul'} is off`}.`, [ref, o.store]);
      }
      if (status === 'complete') ctx.emit('inventory.orderComplete', { order: ref });
    },
    // what we have on the way stood still: the order says why and when it is now expected
    // (every order whose goods it carries: a tour's companions too, S5b)
    'moves.delayed': (ctx, p) => {
      if (p.requester !== INVENTORY_MODULE_ID || !p.ref || p.purpose.endsWith(':return')) return;
      const mv = ctx.get('Move', p.move);
      for (const id of mv ? ordersOn(mv) : [p.ref]) if (ctx.get('Order', id)) stillDelayed(ctx, id);
    },
    'moves.arrived': (ctx, p) => {
      if (p.requester === INVENTORY_MODULE_ID && p.ref) for (const id of ordersOn({ ref: p.ref, legs: [{ loads: p.loads }] })) if (ctx.blockersOf(id).some((b) => b.code === 'inventory.lorryDelayed')) stillDelayed(ctx, id);
      if (p.requester !== INVENTORY_MODULE_ID || !p.ref) return;
      if (p.purpose === 'carried') return carriedIn(ctx, p.ref);
      // our goods from another of our stores: in this one when the carrier is here
      if (p.purpose === 'transfer' || p.purpose === 'drawn') {
        if (!ctx.get('Store', p.ref)) return;
        // (taken on at a pickup: what was taken, as it was, r38)
        const ab = ctx.state('inventory').aboard?.[p.move];
        if (ab) {
          const { [p.move]: _a, ...aboard } = ctx.state('inventory').aboard ?? {};
          ctx.setState('inventory', { ...ctx.state('inventory'), aboard });
          const { material: abm, qty: abq, ...lots } = ab;
          changeStock(ctx, p.ref, abm, abq, lots);
          addFlow(ctx, abm, 'transit', -abq);
          return;
        }
        for (const l of p.loads) {
          if (!('goods' in l) || l.goods.qty <= 0) continue;
          // drawn from nature (a creek, the pond): from the water there, as far as there is; ours from a store: out of transit
          if (p.purpose === 'drawn') {
            drawnInto(ctx, p.move, p.ref, l.goods);
            continue;
          }
          changeStock(ctx, p.ref, l.goods.material, l.goods.qty, { ...(l.goods.since !== undefined ? { since: l.goods.since } : {}), ...(l.goods.age !== undefined ? { age: l.goods.age } : {}), ...(l.goods.parts ? { parts: l.goods.parts } : {}) });
          addFlow(ctx, l.goods.material, 'transit', -l.goods.qty);
        }
        return;
      }
      if (p.purpose === 'disposal') {
        const o = ctx.get('Order', p.ref);
        if (!o) return;
        // a collector's lorry home: what it loaded (unloading takes no time yet: part A, step A2)
        const qty = Math.min(carriesOf({ ref: p.ref, legs: [{ loads: p.loads }] }, p.ref), o.inTransit);
        if (qty > 0) landed(ctx, p.ref, p.purpose, qty, p.to);
        return;
      }
      if (p.purpose !== 'delivery') return; // empty returns
      // a supplier's lorry at the drop point: every order's load on it the same way (S5b, review x). One that left to hand
      // over to one of ours waits for them (S5) for the loads whose orders are to be handed over now (open or called off
      // meanwhile: theirs on the road come as agreed, review S5 #2); a load with our consent (given for its own order) is
      // set down. One that left to set down (it goes back by itself) sets every load down.
      const lorry = ctx.state('inventory').lorries?.[p.move];
      if (!lorry) return;
      const { [p.move]: _l, ...lorries } = ctx.state('inventory').lorries ?? {};
      ctx.setState('inventory', { ...ctx.state('inventory'), lorries });
      const wait: LorryLoad[] = [];
      for (const l of lorry.loads) {
        const lo = ctx.get('Order', l.order);
        if (!lo) continue;
        if (lorry.attended && handoverOf(ctx, lo) === 'attended') wait.push(l);
        else landed(ctx, l.order, p.purpose, l.qty, p.to, ctx.get('Move', p.move)?.legs[0]?.depart);
      }
      if (wait.length) return handoverArrived(ctx, p.move, wait, p.to, p.carrier, lorry.coming);
      if (!lorry.attended) return;
      letGoMeeter(ctx, lorry.coming?.person, p.move, lorry.coming?.from);
      const o = ctx.get('Order', lorry.loads[0]!.order);
      if (o) lorryBack(ctx, lorry.loads[0]!.order, lorryHome(ctx, o, p.to, p.carrier));
    },
  },
  setup(ctx) {
    // a good counted in pieces states what a piece weighs (handling, carrying, unloading): never guessed
    for (const [id, m] of Object.entries(ctx.data('materials'))) if (m.unit === 'pcs' && !m.pieceMass) throw new Error(`materials.${id}: a good counted in pieces needs pieceMass`);
    // what a good leaves behind is a good of this world
    for (const [id, m] of Object.entries(ctx.data('materials'))) if (m.leaves && !ctx.data('materials')[m.leaves.material]) throw new Error(`materials.${id}: leaves '${m.leaves.material}', which is no material`);
    for (const [id, m] of Object.entries(ctx.data('materials'))) if (m.salvage?.rest && !ctx.data('materials')[m.salvage.rest]) throw new Error(`materials.${id}: breaks into '${m.salvage.rest}', which is no material`);
    normalizeOffers(ctx.data('materials'), ctx.data('suppliers'));
    const routing = ctx.port('routing');
    for (const [sid, sup] of Object.entries(ctx.data('suppliers'))) {
      try {
        routing.profile(sup.vehicleProfile);
      } catch {
        throw new Error(`suppliers.${sid}.vehicleProfile: unknown vehicle profile "${sup.vehicleProfile}"`);
      }
    }
  },
  ports: { holdings: holdingsPort, trade: tradePort },
  contributes: {
    // one who goes on foot with a light (S7): one in what they carry, or in a store of their party's within reach where
    // they set out (taken along). Contributions read with inventory's own context, not their caller's: the read graph
    // charges what they read to inventory (design/modular-split.md §4.1)
    carriesLight: (own) => (_read: ReadCtx, unit: EntityId, at: Vec2) => {
      const mats = own.data('materials');
      const lights = (st: { contents: Record<string, number> }) => Object.entries(st.contents).some(([m, q]) => q > EPS && mats[m]?.light);
      const wf = own.hasPort('workforce') ? own.port('workforce') : undefined;
      const reach = reachOf(own);
      for (const [sid, st] of own.all('Store')) {
        if (st.on === unit) {
          if (lights(st)) return true;
          continue;
        }
        if (st.on !== undefined || !lights(st) || Math.hypot(st.pos[0] - at[0], st.pos[1] - at[1]) > reach || free(own, sid, Object.keys(st.contents).find((m) => mats[m]?.light)!) <= EPS) continue;
        // (one of the party's, or a vehicle of its that one rides: the lamp taken along)
        if ((wf && (wf.members(st.holder).includes(unit) || wf.staff(st.holder).includes(unit))) || own.get('Machine', unit)?.holder === st.holder) return true;
      }
      return false;
    },
    // one setting out on foot from a place of theirs takes a lamp of theirs along from a store by them, if they carry none:
    // into what they carry (a transfer at one place), with them from then on, for the way back in the dark too (S7)
    setsOut: (own) => (_read: ReadCtx, unit: EntityId, at: Vec2) => (lampFor(own, unit, at) ? { type: 'inventory.takeAlong', payload: { unit, at: [at[0], at[1]] } } : undefined),
    // what goods weigh, by their material (design/physical-state.md I5: never as their sender says)
    loadMass: (own) => (_read: ReadCtx, load: Load) => {
      if (!('goods' in load) || !own.data('materials')[load.goods.material]) return undefined;
      return (load.goods.qty * unitMass(material(own, load.goods.material))) / 1000;
    },
    // where a party's people report: its yard (a depot), else the first store of its that stands somewhere (a camp, a heap)
    base: (own) => (_read: ReadCtx, party: EntityId) => {
      const kept = ofParty(own, party, { kept: true }).filter((id) => own.get('Store', id)?.kind !== 'tank' && own.get('Store', id)?.kind !== 'carried');
      const at = placeOf(own, kept.find((id) => own.get('Store', id)?.kind === 'depot') ?? kept[0] ?? '');
      return at ? ([at[0], at[1]] as Vec2) : undefined;
    },
  },
  // every material's books (design/physical-state.md I1): what is in the stores and on the way is what came in, less what went
  audit(read) {
    const held: Record<string, number> = {};
    const out: string[] = [];
    for (const [, st] of read.all('Store')) {
      for (const [m, q] of Object.entries(st.contents)) held[m] = (held[m] ?? 0) + q;
      // (and every riding holding's unit is there: design/modular-split.md §4.1)
      if (st.on !== undefined && !read.entity(st.on)) out.push(`${st.label} rides on ${st.on}, which is not there`);
    }
    // (and the index of the holdings says what they are: whose, what they ride on, what they are set down for, whose work)
    const ix = holdingIndex(read);
    let indexed = 0;
    for (const ids of ix.byHolder.values()) indexed += ids.length;
    if (indexed !== read.count('Store')) out.push(`the holdings index has ${indexed} holdings, there are ${read.count('Store')}`);
    for (const [id, st] of read.all('Store')) {
      const off = (m: Map<EntityId, EntityId[]>, key: EntityId | undefined) => key !== undefined && !m.get(key)?.includes(id);
      if (off(ix.byHolder, st.holder) || off(ix.byUnit, st.on) || off(ix.byFor, st.for) || off(ix.byWork, st.work)) out.push(`${st.label} is not in the holdings index as it is`);
    }
    const flows = read.state('inventory').flows;
    for (const m of new Set([...Object.keys(held), ...Object.keys(flows)])) {
      const f = { ...NO_FLOWS, ...flows[m] };
      const books = f.stocked + f.delivered + f.extracted + f.made - f.used - f.released - f.disposed;
      const off = (held[m] ?? 0) + f.transit - books;
      if (Math.abs(off) > 1e-5 * Math.max(1, Math.abs(books))) out.push(`${m}: ${tidy(held[m] ?? 0)} held + ${tidy(f.transit)} on the way, the books say ${tidy(books)}`);
    }
    return out;
  },
  projections: {
    'inventory.stocks': {
      label: 'Stores and stock',
      description: 'args: party (whose stores; a client sees its own)',
      // (with what of it is claimed: sold and waiting for its buyer, staged for a work, a carrier coming for it: S419)
      compute: (ctx, args?: { party?: EntityId }) =>
        [...ctx.all('Store')]
          .filter(([, st]) => !args?.party || st.holder === args.party)
          .map(([id, st]) => {
            const claimed = Object.fromEntries(Object.keys(st.contents).map((m) => [m, tidy((st.contents[m] ?? 0) - free(ctx, id, m))]).filter(([, q]) => (q as number) > EPS));
            // (a riding holding where its unit is now: derived, robustness step 6)
            return { id, ...st, ...(st.on ? { pos: placeOf(ctx, id) ?? st.pos } : {}), ...(Object.keys(claimed).length ? { claimed } : {}) };
          }),
    },
    'inventory.orders': {
      label: 'Orders and disposal hauls',
      description: 'args: party (whose orders; a client sees its own)',
      compute: (ctx, args?: { party?: EntityId }) => [...ctx.all('Order')].filter(([, o]) => !args?.party || ctx.get('Store', o.store)?.holder === args.party).map(([id, o]) => ({ id, ...o, blockers: ctx.blockersOf(id).map((b) => ctx.formatBlocker(b)) })),
    },
    'inventory.sellers': {
      label: 'Who sells what (delivered or at the counter), at what price, from how much, how soon; and until when their lorries are booked',
      description: 'args: material (optional: only these offers)',
      compute: (ctx, args: Record<string, unknown>) => {
        const idx = index(ctx, ctx.now);
        const calendars = new Map<string, number[]>();
        const bookedFor = (sid: string) => calendars.get(sid) ?? calendars.set(sid, bookedOf(ctx, sid)).get(sid)!;
        return Object.entries(offersOf(ctx).buy)
          .filter(([mat]) => typeof args.material !== 'string' || mat === args.material)
          .flatMap(([mat, list]) =>
            list.map((o) => {
              const sup = ctx.data('suppliers')[o.supplier];
              // (its calendar's last booking, when it reaches past the lead time)
              const booked = bookedFor(o.supplier);
              const until = booked.length ? Math.max(...booked) : undefined;
              // (a lead time is the supplier's when its lorries are free; booked, the order waits for one: S420)
              const has = stockAt(ctx, o.supplier, mat, ctx.now);
              return { material: mat, seller: o.supplier, label: sup?.label ?? o.supplier, price: Math.round(o.price * idx * 100) / 100, unit: material(ctx, mat).unit, minOrder: o.minOrder, leadTimeDays: o.leadTimeDays, ...(sup?.delivery ? { delivery: sup.delivery } : {}), ...(until !== undefined && until > ctx.now + o.leadTimeDays * DAY ? { lorriesBookedUntil: ctx.calendar.format(until) } : {}), ...(o.stock ? { inStock: Math.floor(has * 100) / 100, madePerDay: o.stock.perDay } : {}) };
            }),
          );
      },
    },
    'inventory.buyers': {
      label: 'Who buys what (collected from our store), at what price, from how much',
      description: 'args: store (optional: whether each buyer can collect from it)',
      compute: (ctx, args: Record<string, unknown>) => {
        const idx = index(ctx, ctx.now);
        const at = typeof args.store === 'string' ? ctx.get('Store', args.store)?.pos : undefined;
        return Object.entries(offersOf(ctx).sell).flatMap(([mat, list]) => list.map((o) => ({ material: mat, buyer: o.supplier, label: ctx.data('suppliers')[o.supplier]?.label ?? o.supplier, price: Math.round(o.price * idx * 100) / 100, unit: material(ctx, mat).unit, minOrder: o.minOrder, ...(o.byAge ? { used: `for one as new; less by the share of its life in use (${o.byAge.life} years), at least ${Math.round(o.byAge.floor * 100)} %` } : {}), collects: reaches(ctx, o.supplier) && (!at || collects(ctx, o.supplier, at)) })));
      },
    },
    'inventory.flows': { label: 'Material balance', compute: (ctx) => ctx.state('inventory').flows },
    'inventory.balance': {
      label: 'Every material’s books: held and on the way against what came in, less what went (off: what does not balance)',
      compute: (ctx) => {
        const held: Record<string, number> = {};
        for (const [, st] of ctx.all('Store')) for (const [m, q] of Object.entries(st.contents)) held[m] = (held[m] ?? 0) + q;
        const flows = ctx.state('inventory').flows;
        return [...new Set([...Object.keys(held), ...Object.keys(flows)])].sort().map((m) => {
          const f = { ...NO_FLOWS, ...flows[m] };
          const books = f.stocked + f.delivered + f.extracted + f.made - f.used - f.released - f.disposed;
          return { material: m, held: tidy(held[m] ?? 0), ...f, off: tidy((held[m] ?? 0) + f.transit - books) };
        });
      },
    },
    'inventory.onTheWay': {
      label: 'Goods on the way: what is ordered and not yet here, when it is expected, and what could delay it',
      compute: (ctx) => onTheWay(ctx),
    },
  },
});
