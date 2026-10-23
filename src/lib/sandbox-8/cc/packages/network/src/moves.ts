/**
 * `moves` module (decision 0026 part A): carries loads (goods, machines and vehicles, people) along
 * a chain of legs, each leg one carrier's run along a route. A move exists as an entity while it is
 * under way (rendering via `positionAt`); at the end of each leg it applies the carrier's pass to
 * the traversed edges (`traffic.record`), at the end of the last it tells the requester
 * (`moves.arrived`) with the loads to unload, optionally sends the carrier back empty, and is then
 * removed. Completed legs only survive as running totals in the module state.
 *
 * A carrier is also a load: a low-loader carries an excavator, a transporter a car. A machine that
 * drives itself is the carrier of its leg, not a load.
 */
import { command, defineModule, ex, HOUR, s, type EntityId, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import { deliveredBy, loadMass, type Carrier, type Leg, type LegRequest, type Load, type Move, type MovePosition, type MovesPort, type MoveStats, type Place, type Route } from './contract.ts';
import { dist, headingOf } from './geom.ts';

const CarrierSchema = s.object({ class: s.string(), unit: s.ref().optional(), fleet: s.string().optional() });
const LoadSchema = s.any<Load>();

export const MoveSchema = s.object({
  requester: s.string(),
  ref: s.string().optional(),
  purpose: s.string(),
  legs: s.array(s.object({ carrier: CarrierSchema, route: s.any<Route>(), depart: s.number({ unit: 's' }), arrive: s.number({ unit: 's' }), loads: s.array(LoadSchema), loaded: s.boolean(), inCharge: s.ref().optional(), stops: s.array(s.object({ at: s.number({ unit: 's' }), until: s.number({ unit: 's' }), why: s.string() })).optional(), fromNode: s.ref().optional(), toNode: s.ref().optional(), maxOffroad: s.number({ min: 0 }).optional(), drivenBefore: s.number({ min: 0, unit: 's' }).optional() })),
  unloadUntil: s.number({ unit: 's' }).optional(),
  status: s.enum(['underway', 'unloading', 'arrived', 'stopped']),
  /** the legs done so far (a leg is done once: a rerouted leg's earlier timer finds it done) */
  done: s.int({ min: 0 }).optional(),
  /** when its carrier of ours runs dry on it, if it does */
  dryAt: s.number({ unit: 's' }).optional(),
  /** its carrier of ours on a tow truck from beyond the map (broken down there): it drives no more */
  towed: s.boolean().optional(),
});

const PlaceSchema = s.object({ at: s.point().optional(), on: s.ref('move').optional(), beyond: s.ref().optional() });

/** the units a leg moves: its carrier when it is a thing of the world, and the machines it carries (people: slice 3b) */
/** the units a leg moves: its carrier (a machine, or a person walking), the one in charge, the machines and people it carries */
const unitsOf = (leg: Pick<Leg, 'carrier' | 'loads' | 'inCharge'>): EntityId[] => [
  ...new Set([...(leg.carrier.unit !== undefined ? [leg.carrier.unit] : []), ...(leg.inCharge !== undefined ? [leg.inCharge] : []), ...leg.loads.flatMap((l) => ('machine' in l ? [l.machine] : 'person' in l ? [l.person] : []))]),
];

/** where a unit is now (on a move: where the move is); beyond the map, undefined */
function whereOf(read: ReadCtx, unit: EntityId, t = read.now): Vec2 | undefined {
  const p = read.get('Place', unit);
  if (!p) return undefined;
  if (p.at) return [p.at[0], p.at[1]];
  if (p.on) {
    const m = read.get('Move', p.on);
    if (!m) return undefined;
    // its own legs: on the one under way; between them where the last one done ended; before them where the first starts
    const mine = m.legs.filter((l) => unitsOf(l).includes(unit));
    const leg = mine.filter((l) => l.depart <= t).at(-1);
    if (!leg) return mine[0] && mine[0].fromNode === undefined ? [mine[0].route.from[0], mine[0].route.from[1]] : undefined;
    if (t >= leg.arrive) return leg.toNode === undefined ? [leg.route.to[0], leg.route.to[1]] : undefined;
    // (on the part of its way beyond the map: there)
    const at = positionOnRoute(leg.route, movingTime(leg, t));
    return at.offMap ? undefined : at.pos;
  }
  return undefined;
}

const StatsSchema = s.object({
  completedLegs: s.number({ min: 0 }),
  vehicleKm: s.number({ min: 0, unit: 'km' }),
  externalKm: s.number({ min: 0, unit: 'km' }),
  esal: s.number({ min: 0, unit: 'esal' }),
  breakdowns: s.number({ min: 0 }),
  hazards: s.record(s.number()),
});

const DispatchSchema = s.object({
  legs: s.array(
    s.object({
      carrier: CarrierSchema,
      from: s.point(),
      to: s.point(),
      externalNode: s.ref('net-node').optional(),
      externalDestination: s.ref('net-node').optional(),
      maxOffroad: s.number({ min: 0 }).optional(),
      loads: s.array(LoadSchema).optional(),
      notBefore: s.number().optional(),
      inCharge: s.ref().optional(),
      beyondKm: s.number({ min: 0 }).optional(),
    }),
  ),
  loads: s.array(LoadSchema).optional(),
  purpose: s.string(),
  ref: s.string().optional(),
  departAt: s.number().optional(),
  returnEmpty: s.boolean().optional(),
  /** the empty return goes out of the map by this way (and on beyond it), not back the way the last leg came: a firm's vehicle going home to its base */
  returnVia: s.object({ externalDestination: s.ref('net-node'), beyondKm: s.number({ min: 0 }).optional() }).optional(),
  requester: s.string().optional(),
});

/** a position along one route: where, facing which way, how far along (0..1) */
type RoutePosition = Omit<MovePosition, 'leg'>;

const isVec2 = (p: unknown): p is Vec2 => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const fmt = (p: Vec2) => `(${p[0].toFixed(0)}, ${p[1].toFixed(0)})`;

/** Position along a route at `elapsed` seconds after departure (constant speed within each stretch). */
export function positionOnRoute(route: Route, elapsed: number): RoutePosition {
  const D = route.duration;
  const e = Math.min(Math.max(elapsed, 0), D);
  const progress = D > 0 ? e / D : 1;
  const stretches = route.stretches;
  if (stretches.length === 0) return { pos: [route.from[0], route.from[1]], heading: 0, progress };
  const firstHeading = (pts: readonly Vec2[]): number | null => {
    for (let i = 1; i < pts.length; i += 1) if (dist(pts[i - 1]!, pts[i]!) > 1e-9) return headingOf(pts[i - 1]!, pts[i]!);
    return null;
  };
  const lastHeading = (pts: readonly Vec2[]): number | null => {
    for (let i = pts.length - 1; i > 0; i -= 1) if (dist(pts[i - 1]!, pts[i]!) > 1e-9) return headingOf(pts[i - 1]!, pts[i]!);
    return null;
  };
  let acc = 0;
  let prevHeading: number | null = null;
  for (let si = 0; si < stretches.length; si += 1) {
    const st = stretches[si]!;
    const isLast = si === stretches.length - 1;
    if (e <= acc + st.duration || isLast) {
      const f = st.duration > 0 ? Math.min(1, Math.max(0, (e - acc) / st.duration)) : 1;
      if (st.kind === 'external') {
        let heading = prevHeading;
        if (heading === null) {
          for (let k = si + 1; k < stretches.length && heading === null; k += 1) if (stretches[k]!.kind !== 'external') heading = firstHeading(stretches[k]!.points);
        }
        const r: RoutePosition = { pos: [st.from[0], st.from[1]], heading: heading ?? 0, progress };
        if (f < 1) r.offMap = true;
        return r;
      }
      const pts = st.points;
      let total = 0;
      for (let i = 1; i < pts.length; i += 1) total += dist(pts[i - 1]!, pts[i]!);
      const target = f * total;
      let run = 0;
      let heading = firstHeading(pts) ?? prevHeading ?? 0;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const sl = dist(a, b);
        if (sl <= 1e-9) continue;
        heading = headingOf(a, b);
        if (run + sl >= target || i === pts.length - 1) {
          const t = Math.min(1, Math.max(0, (target - run) / sl));
          return { pos: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], heading, progress };
        }
        run += sl;
      }
      const end = pts[pts.length - 1] ?? st.to;
      return { pos: [end[0], end[1]], heading, progress };
    }
    acc += st.duration;
    if (st.kind !== 'external') prevHeading = lastHeading(st.points) ?? prevHeading;
  }
  return { pos: [route.to[0], route.to[1]], heading: prevHeading ?? 0, progress };
}

interface DispatchPayload {
  legs: LegRequest[];
  loads?: Load[];
  purpose: string;
  ref?: string;
  departAt?: number;
  returnEmpty?: boolean;
  returnVia?: { externalDestination: EntityId; beyondKm?: number };
  requester?: string;
}

/** the route of one leg, or a rejection that says why there is none */
function routeOf(ctx: WriteCtx, l: LegRequest): Route {
  const profiles = ctx.data('vehicleProfiles');
  const prof = Object.hasOwn(profiles, l.carrier.class) ? profiles[l.carrier.class] : undefined;
  if (!prof) ctx.reject('moves.unknownCarrier', { carrier: l.carrier.class });
  if (!isVec2(l.from) || !isVec2(l.to)) ctx.reject('moves.invalidRequest', { reason: 'from/to must be [x, z] points' });
  if (l.externalNode && l.externalDestination) ctx.reject('moves.invalidRequest', { reason: 'a leg cannot both start and end outside the map' });
  for (const node of [l.externalNode, l.externalDestination]) {
    if (node === undefined) continue;
    if (!ctx.get('NetNode', node)?.external) ctx.reject('moves.notExternal', { node });
    if (!prof!.roadLegal) ctx.reject('moves.notRoadLegal', { carrier: prof!.label, node });
  }
  const routing = ctx.port('routing');
  const opts = { ...(l.maxOffroad !== undefined ? { maxOffroad: l.maxOffroad } : {}), ...(l.carrier.unit ? { unit: l.carrier.unit } : {}) };
  const route = l.externalNode
    ? routing.routeFromExternal(l.externalNode, l.to, l.carrier.class, opts)
    : l.externalDestination
      ? routing.routeToExternal(l.from, l.externalDestination, l.carrier.class, opts)
      : routing.route(l.from, l.to, l.carrier.class, opts);
  if (!route) ctx.reject('moves.noRoute', { carrier: prof!.label, from: l.externalNode ?? fmt(l.from), to: l.externalDestination ?? fmt(l.to) });
  // the rest of the way beyond the map (where the next town is not yet the place): part of the leg, at top speed
  if (l.beyondKm && l.beyondKm > 0 && (l.externalNode || l.externalDestination)) {
    // at the speed of the way out there (its surface), else at top speed
    const surface = ctx.get('NetNode', (l.externalNode ?? l.externalDestination)!)?.external?.surface ?? 'external';
    const extra = (l.beyondKm / (prof!.surfaceSpeed[surface]?.value ?? prof!.maxSpeed.value)) * 3600;
    const at: Vec2 = l.externalNode ? [route!.from[0], route!.from[1]] : [route!.to[0], route!.to[1]];
    const st = { kind: 'external' as const, from: at, to: at, length: l.beyondKm * 1000, duration: extra, points: [at] };
    return { ...route!, duration: route!.duration + extra, externalKm: route!.externalKm + l.beyondKm, stretches: l.externalNode ? [st, ...route!.stretches] : [...route!.stretches, st] };
  }
  return route!;
}

const carrierOf = (c: Carrier): Carrier => ({ class: c.class, ...(c.unit !== undefined ? { unit: c.unit } : {}), ...(c.fleet !== undefined ? { fleet: c.fleet } : {}) });

/** a route driven at a share of its pace (a loaded carrier): every stretch takes longer by 1/pace */
function atPace(route: Route, pace: number, label: string): Route {
  if (!(pace > 0) || pace === 1) return route;
  return { ...route, duration: route.duration / pace, stretches: route.stretches.map((st) => ({ ...st, duration: st.duration / pace })), explain: ex.div(label, 's', route.explain, ex.value(pace, '1', 'pace loaded')) };
}

/** how long a carrier class takes to unload `tonnes` itself; 0 when it cannot (the receiver unloads it: A3) */
function unloadTime(read: ReadCtx, carrier: string, tonnes: number): number {
  const u = read.data('vehicleProfiles')[carrier]?.unloading;
  return u ? u.fixed.value + (u.perTonne?.value ?? 0) * Math.max(0, tonnes) : 0;
}

function onMap(read: ReadCtx, p: Vec2): boolean {
  if (!read.hasPort('terrain')) return true;
  const b = read.port('terrain').bounds;
  return p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.z0 && p[1] <= b.z1;
}

/** refused: a point off the map (the world beyond is reached by a way out) */
export function offMap(ctx: WriteCtx, p: Vec2): never {
  const b = ctx.port('terrain').bounds;
  return ctx.reject('moves.offMap', { at: `[${Math.round(p[0])}, ${Math.round(p[1])}]`, x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
}

/** a load as the catalogues weigh it (the first module that knows: goods, machines, people); else as its sender says */
function weighed(read: ReadCtx, l: Load): Load {
  for (const c of read.contributions('loadMass')) {
    const t = c.impl(read, l);
    if (t === undefined) continue;
    if ('goods' in l) return { goods: { ...l.goods, mass: t } };
    if ('machine' in l) return { ...l, mass: t };
    return l;
  }
  return l;
}

/**
 * A move stops where it is (design/physical-state.md I5): broken down, run dry, its way closed, or called off. Its
 * units stand there now (beyond the map: by the way it was taking), and its requester is told, with what it carried.
 * Never a rollback.
 */
function stopMove(ctx: WriteCtx, id: EntityId, cause: 'breakdown' | 'dry' | 'closed' | 'stopped', why: string): void {
  const m = ctx.get('Move', id);
  if (!m || m.status !== 'underway') return;
  const at = positionOf(m, ctx.now);
  const leg = m.legs[at.leg]!;
  const node = leg.toNode ?? leg.fromNode;
  const units: EntityId[] = [];
  for (const u of new Set(m.legs.flatMap(unitsOf))) {
    if (!ctx.entity(u) || ctx.get('Place', u)?.on !== id) continue;
    const w = whereOf(ctx, u, ctx.now);
    ctx.set('Place', u, w ? { at: [w[0], w[1]] } : node !== undefined ? { beyond: node } : { at: [leg.route.from[0], leg.route.from[1]] });
    units.push(u);
  }
  const st = ctx.state('moves');
  if (st.hazards[id] !== undefined) ctx.cancel(st.hazards[id]);
  const { [id]: _h, ...hazards } = st.hazards;
  ctx.setState('moves', { ...st, hazards });
  ctx.patch('Move', id, { status: 'stopped' });
  // (driven on the leg it stopped on, its fuel and hours, not the time it stood; where, unless beyond the map)
  const seconds = Math.max(0, movingTime(leg, ctx.now)) + (leg.drivenBefore ?? 0);
  ctx.emit('moves.stopped', { move: id, requester: m.requester, purpose: m.purpose, ...(m.ref !== undefined ? { ref: m.ref } : {}), leg: at.leg, carrier: { ...leg.carrier }, ...(leg.inCharge ? { inCharge: leg.inCharge } : {}), seconds, cause, why, ...(at.offMap || ctx.now < m.legs[0]!.depart ? {} : { at: [at.pos[0], at.pos[1]] as Vec2 }), units, loads: structuredClone(leg.loads) });
  ctx.at(ctx.now, 'reap', { move: id });
}

/** a move stands on its leg for a while and goes on (said as a delay: what it was, until when) */
function standFor(ctx: WriteCtx, id: EntityId, legIdx: number, stand: number, why: string): void {
  const m = ctx.require('Move', id);
  const legs = m.legs.map((l, i) => (i < legIdx ? l : i === legIdx ? { ...l, arrive: l.arrive + stand, stops: [...(l.stops ?? []), { at: ctx.now, until: ctx.now + stand, why }] } : { ...l, depart: l.depart + stand, arrive: l.arrive + stand }));
  ctx.patch('Move', id, { legs });
  ctx.emit('moves.delayed', { move: id, requester: m.requester, purpose: m.purpose, ...(m.ref !== undefined ? { ref: m.ref } : {}), leg: legIdx, by: stand, arrive: legs.at(-1)!.arrive, why });
  drawHazard(ctx, id, ctx.now + stand);
}

/**
 * The network changed under moves under way: a leg whose way is closed now is rerouted from where it is (one not begun,
 * from its start), and the legs after it shift; with no way left, the move stops there (finding 22).
 */
function replan(ctx: WriteCtx, id: EntityId, changed: ReadonlySet<EntityId>): void {
  const m = ctx.get('Move', id);
  if (!m || m.status !== 'underway') return;
  const now = ctx.now;
  const cur = positionOf(m, now);
  // (only the way still ahead: what it has driven is behind it, r38)
  const closed = (l: Leg, i: number) => {
    let acc = 0;
    const gone = i === cur.leg && now > l.depart ? movingTime(l, now) : i < cur.leg ? Infinity : 0;
    return l.route.stretches.some((st) => {
      acc += st.duration;
      return acc > gone && st.kind === 'network' && st.edge !== undefined && changed.has(st.edge) && !ctx.get('NetEdge', st.edge)?.open;
    });
  };
  let shift = 0;
  const legs: Leg[] = [];
  for (const [i, l0] of m.legs.entries()) {
    const l = shift ? { ...l0, depart: l0.depart + shift, arrive: l0.arrive + shift, ...(l0.stops ? { stops: l0.stops.map((s) => ({ ...s, at: s.at + shift, until: s.until + shift })) } : {}) } : l0;
    if (i < cur.leg || !closed(l, i)) {
      legs.push(l);
      continue;
    }
    // (under way on the map: from where it is now; not begun, or still beyond the map: from its start, by its way in; a
    // leg out of the map: to its way out. Its part beyond the map stays as it was: r37)
    const routing = ctx.port('routing');
    const onTheMap = i === cur.leg && now > l.depart && !cur.offMap;
    const from: Vec2 = onTheMap ? [cur.pos[0], cur.pos[1]] : [l.route.from[0], l.route.from[1]];
    const opts = { openOnly: true, ...(l.maxOffroad !== undefined ? { maxOffroad: l.maxOffroad } : {}), ...(l.carrier.unit ? { unit: l.carrier.unit } : {}) };
    const route0 = !onTheMap && l.fromNode !== undefined ? routing.routeFromExternal(l.fromNode, l.route.to, l.carrier.class, opts) : l.toNode !== undefined ? routing.routeToExternal(from, l.toNode, l.carrier.class, opts) : routing.route(from, l.route.to, l.carrier.class, opts);
    if (!route0) {
      // beyond the map with no way in open: it waits there for one (r38: not stranded out of reach with what it
      // carries); a leg still to come in from beyond is looked at again when it is reached
      const beyond = l.fromNode !== undefined && (i > cur.leg || cur.offMap || now <= l.depart);
      if (beyond && i > cur.leg) {
        legs.push(l);
        continue;
      }
      if (beyond) {
        ctx.patch('Move', id, { legs: [...legs, ...m.legs.slice(i)] });
        return waitBeyond(ctx, id, i);
      }
      return stopMove(ctx, id, 'closed', `the way is closed${i === cur.leg ? '' : ' ahead'}`);
    }
    // (its time beyond what its stretches take, as it was driven: at its pace; unpaced here, paced with the rest below)
    const pace = l.loaded ? (ctx.data('vehicleProfiles')[l.carrier.class]?.loadedSpeed?.value ?? 1) : 1;
    const beyond = Math.max(0, (l.route.duration - l.route.stretches.reduce((a, st) => a + st.duration, 0)) * pace);
    const route = beyond > 0 ? { ...route0, duration: route0.duration + beyond } : route0;
    const r = l.loaded ? atPace(route, ctx.data('vehicleProfiles')[l.carrier.class]?.loadedSpeed?.value ?? 1, 'travel loaded') : route;
    const depart = i === cur.leg && now > l.depart ? now : l.depart;
    // (a way round is longer; one that happens to be shorter is not done before the leg was due)
    // (what it drove before the way round is driven still: its fuel and hours, r39)
    const before = i === cur.leg && now > l.depart ? (l.drivenBefore ?? 0) + Math.max(0, movingTime(l, now)) : l.drivenBefore;
    const next = { ...l, route: r, depart, arrive: Math.max(depart + r.duration, l.arrive), ...(before ? { drivenBefore: before } : {}) };
    delete (next as { stops?: unknown }).stops;
    shift += next.arrive - l.arrive;
    legs.push(next);
  }
  ctx.patch('Move', id, { legs });
  // a way round longer than its tank: it runs dry where the tank ends (r37)
  if (ctx.require('Move', id).dryAt === undefined) checkRange(ctx, id);
}

/** how long a move held beyond the map by a closed way in waits before it tries again */
const WAIT_BEYOND = HOUR;

/** a move coming in from beyond the map stands there while its way in is closed, and tries again in a while */
function waitBeyond(ctx: WriteCtx, id: EntityId, legIdx: number): void {
  const m = ctx.require('Move', id);
  const l = m.legs[legIdx]!;
  // (not begun: it sets out later; on its way: it stands where it is beyond the map)
  if (ctx.now <= l.depart) {
    const by = Math.max(0, ctx.now + WAIT_BEYOND - l.depart);
    ctx.patch('Move', id, { legs: m.legs.map((x, i) => (i < legIdx ? x : { ...x, depart: x.depart + by, arrive: x.arrive + by, ...(x.stops ? { stops: x.stops.map((st) => ({ ...st, at: st.at + by, until: st.until + by })) } : {}) })) });
    ctx.emit('moves.delayed', { move: id, requester: m.requester, purpose: m.purpose, ...(m.ref !== undefined ? { ref: m.ref } : {}), leg: legIdx, by, arrive: ctx.require('Move', id).legs.at(-1)!.arrive, why: 'the way in is closed: waiting beyond the map' });
  } else standFor(ctx, id, legIdx, WAIT_BEYOND, 'the way in is closed: waiting beyond the map');
  ctx.at(ctx.now + WAIT_BEYOND, 'retry', { move: id });
}

/** a carrier of ours runs as far as its tank takes it: beyond that it stands where it ran dry (finding 24) */
function checkRange(ctx: WriteCtx, id: EntityId): void {
  const m = ctx.require('Move', id);
  const driven = new Map<EntityId, number>();
  // (against what is in the tank now: the legs done were burnt when they were done, r38)
  for (const leg of m.legs.slice(m.done ?? 0)) {
    const u = leg.carrier.unit;
    if (u === undefined) continue;
    const range = ctx.contributions('range').map((c) => c.impl(ctx, u)).find((x) => x !== undefined);
    const before = driven.get(u) ?? 0;
    const drives = movingTime(leg, leg.arrive) + (leg.drivenBefore ?? 0);
    driven.set(u, before + drives);
    if (range !== undefined && before <= range && before + drives > range + 1) {
      const at = Math.max(ctx.now, atMoving(leg, range - before - (leg.drivenBefore ?? 0)));
      ctx.at(at, 'runsDry', { move: id, unit: u });
      ctx.patch('Move', id, { dryAt: at });
      return;
    }
  }
}

/** the machines a leg carries as loads (a trailer behind the car, plant on a low-loader) */
const carriedOf = (leg: Leg): EntityId[] => leg.loads.flatMap((l) => ('machine' in l ? [l.machine] : []));

function dispatch(ctx: WriteCtx, p: DispatchPayload): EntityId {
  if (!p.legs.length) ctx.reject('moves.invalidRequest', { reason: 'a move needs at least one leg' });
  // a place on the map: beyond its edge there is only the world outside, reached by a way out (an external node)
  for (const req of p.legs) for (const pt of [req.from, req.to]) if (pt && !onMap(ctx, pt)) offMap(ctx, pt);
  // every leg is routed before anything happens: a move that cannot be made is refused whole
  const profiles = ctx.data('vehicleProfiles');
  let t = Math.max(ctx.now, p.departAt ?? ctx.now);
  const legs: Leg[] = p.legs.map((req, i) => {
    // what it carries weighs what the catalogues say, not what its sender says (I5, finding 20); loaded when it carries mass
    const loads = (req.loads ?? p.loads ?? []).map((l) => weighed(ctx, structuredClone(l)));
    // (a trailer behind it is towed, not carried: what it may tow is its own rule)
    const mass = loadMass(loads.filter((l) => !('machine' in l && l.towed)));
    const payload = profiles[req.carrier.class]?.payload?.value;
    if (payload !== undefined && mass > payload * (1 + 1e-6) + 1e-9) ctx.reject('moves.overloaded', { leg: i + 1, carrier: profiles[req.carrier.class]!.label ?? req.carrier.class, mass: Math.round(mass * 1000) / 1000, payload });
    const loaded = mass > 1e-9 || loads.some((l) => ('goods' in l && l.goods.qty > 0) || ('machine' in l && !l.towed));
    // (one setting out on foot from a place of theirs takes along what they take: a lamp into the dark, S7)
    if (req.carrier.unit && !req.externalNode && profiles[req.carrier.class]?.walks && isVec2(req.from))
      for (const c of ctx.contributions('setsOut')) {
        const take = c.impl(ctx, req.carrier.unit, req.from);
        if (take) ctx.command(take.type as never, take.payload as never);
      }
    // a loaded carrier goes at its loaded pace
    const route = loaded ? atPace(routeOf(ctx, req), profiles[req.carrier.class]?.loadedSpeed?.value ?? 1, 'travel loaded') : routeOf(ctx, req);
    const depart = Math.max(t, req.notBefore ?? t);
    const leg: Leg = { carrier: carrierOf(req.carrier), route, depart, arrive: depart + route.duration, loads, loaded, ...(req.inCharge ? { inCharge: req.inCharge } : {}), ...(req.externalNode ? { fromNode: req.externalNode } : {}), ...(req.externalDestination ? { toNode: req.externalDestination } : {}), ...(req.maxOffroad !== undefined ? { maxOffroad: req.maxOffroad } : {}) };
    t = leg.arrive;
    return leg;
  });
  // a journey, not jumps: each leg starts where the one before ended (beyond the map: by the same way)
  const reach = ctx.data('networkSettings').atPlace.value;
  const near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) <= reach;
  legs.forEach((leg, i) => {
    const prev = legs[i - 1];
    if (!prev) return;
    const joins = prev.toNode !== undefined ? leg.fromNode === prev.toNode : leg.fromNode === undefined && near(prev.route.to, leg.route.from);
    if (!joins) ctx.reject('moves.legsApart', { leg: i + 1, why: prev.toNode !== undefined ? 'the one before ends beyond the map' : `${Math.round(Math.hypot(prev.route.to[0] - leg.route.from[0], prev.route.to[1] - leg.route.from[1]))} m from where the one before ends` });
  });
  // each unit starts where it is (I2: a dispatch does not put anything anywhere)
  const first = new Set<EntityId>();
  for (const leg of legs)
    for (const u of unitsOf(leg)) {
      if (first.has(u)) continue;
      first.add(u);
      const pl = ctx.get('Place', u);
      if (!pl || pl.on !== undefined) continue;
      const there = pl.beyond !== undefined ? leg.fromNode === pl.beyond : pl.at !== undefined && leg.fromNode === undefined && near(pl.at, leg.route.from);
      if (!there) ctx.reject('moves.notThere', { unit: u, where: pl.beyond !== undefined ? 'beyond the map' : `${Math.round(Math.hypot(pl.at![0] - leg.route.from[0], pl.at![1] - leg.route.from[1]))} m from where its leg starts` });
    }
  // a unit it moves is a thing in the world, there to be moved, and on no other move: one thing at a time (I4)
  for (const leg of legs)
    for (const u of unitsOf(leg)) {
      if (!ctx.entity(u)) ctx.reject('moves.invalidRequest', { reason: `${u} is nothing in the world to move` });
      const on = ctx.get('Place', u)?.on;
      if (on !== undefined && ctx.has('Move', on)) ctx.reject('moves.unitBusy', { unit: u, until: ctx.calendar.format(ctx.require('Move', on).legs.at(-1)!.arrive) });
    }
  const move: Move = { requester: p.requester ?? 'client', purpose: p.purpose, legs, status: 'underway' };
  if (p.ref !== undefined) move.ref = p.ref;
  const id = ctx.spawn('move');
  ctx.set('Move', id, move);
  // the units it moves are on it from now, waiting where their first leg starts until it does: one thing at a time
  // (design/physical-state.md I2, I4: a unit changes place only by a move)
  for (const leg of legs) for (const u of unitsOf(leg)) ctx.set('Place', u, { on: id });
  drawHazard(ctx, id, ctx.now);
  checkRange(ctx, id);
  ctx.at(legs[0]!.arrive, 'legDone', { move: id, leg: 0, returnEmpty: p.returnEmpty === true, ...(p.returnVia ? { returnVia: p.returnVia } : {}), ...(p.legs.at(-1)!.maxOffroad !== undefined ? { maxOffroad: p.legs.at(-1)!.maxOffroad } : {}), ...(p.legs.at(-1)!.externalNode ? { fromExternal: p.legs.at(-1)!.externalNode } : {}), ...(p.legs.at(-1)!.externalDestination ? { toExternal: p.legs.at(-1)!.externalDestination } : {}) });
  return id;
}

interface LegDonePayload {
  move: EntityId;
  leg: number;
  returnEmpty: boolean;
  /** where the empty return goes instead of back the last leg's way */
  returnVia?: { externalDestination: EntityId; beyondKm?: number };
  /** the last leg's way in or out and off-network reach, for the empty return */
  fromExternal?: EntityId;
  toExternal?: EntityId;
  maxOffroad?: number;
}

/** time under way on a leg by t: since it left, less the time it stood */
const movingTime = (leg: Readonly<Leg>, t: number): number => t - leg.depart - (leg.stops ?? []).reduce((a, st) => a + Math.max(0, Math.min(t, st.until) - st.at), 0);

/** when a leg has been driven for `s` seconds (its stops on the way apart) */
function atMoving(leg: Readonly<Leg>, s: number): number {
  let t = leg.depart + s;
  for (const st of [...(leg.stops ?? [])].sort((a, b) => a.at - b.at)) if (st.at < t) t += st.until - st.at;
  return t;
}

/** where a move is at time t: on which leg, and where along its route */
function positionOf(m: Readonly<Move>, t: number): MovePosition {
  const under = m.legs.findIndex((l) => t < l.arrive);
  const i = under < 0 ? m.legs.length - 1 : under;
  const leg = m.legs[i]!;
  const total = m.legs.at(-1)!.arrive - m.legs[0]!.depart;
  const stopped = leg.stops?.find((st) => t >= st.at && t < st.until);
  return { ...positionOnRoute(leg.route, movingTime(leg, t)), leg: i, progress: total > 0 ? Math.min(1, Math.max(0, (t - m.legs[0]!.depart) / total)) : 1, ...(stopped ? { stopped: stopped.why } : {}) };
}

/**
 * Draw the next breakdown of a move from `from` on: for each leg on a firm's vehicle that can break
 * down, the time to failure is exponential with its mean time between failures. Only a timer is
 * kept (the time is not state), and a fork draws again: nobody knows when a lorry will break down.
 */
function drawHazard(ctx: WriteCtx, id: EntityId, from: number): void {
  const st = ctx.state('moves');
  if (st.hazards[id] !== undefined) ctx.cancel(st.hazards[id]);
  const { [id]: _old, ...hazards } = st.hazards;
  const m = ctx.get('Move', id);
  let timer: number | undefined;
  if (m?.status === 'underway') {
    const profiles = ctx.data('vehicleProfiles');
    const rng = ctx.rng('breakdown');
    m.legs.forEach((leg, i) => {
      // a firm's vehicle by its profile; one of ours by the machine itself (its age, its care: design/physical-state.md I5)
      const unit = leg.carrier.unit;
      if (unit !== undefined && m.towed) return;
      const mtbf = unit !== undefined ? ctx.contributions('failures').map((c) => c.impl(ctx, unit)).find((x) => x !== undefined) : profiles[leg.carrier.class]?.breakdown?.mtbf.value;
      // standing still it does not break down again: the clock runs from when it goes on
      const standing = leg.stops?.find((st) => from >= st.at && from < st.until);
      const start = Math.max(leg.depart, standing ? standing.until : from);
      if (timer !== undefined || mtbf === undefined || !(mtbf > 0) || start >= leg.arrive) return;
      const ttf = rng.exponential(mtbf) * HOUR;
      if (start + ttf < leg.arrive) timer = ctx.at(start + ttf, 'breakdown', { move: id, leg: i });
    });
  }
  ctx.setState('moves', { ...ctx.state('moves'), hazards: timer !== undefined ? { ...hazards, [id]: timer } : hazards });
}

/** read models of the moves under way */
const PROJECTIONS = {
  'moves.underway': {
    label: 'Moves under way (and unloading): carriers and what they carry',
    compute: (ctx: ReadCtx) =>
      [...ctx.all('Move')]
        .filter(([, m]) => m.status !== 'arrived')
        .map(([id, m]) => {
          const at = positionOf(m, ctx.now);
          const leg = m.legs[at.leg]!;
          return { id, purpose: m.purpose, status: m.status, carrier: leg.carrier, leg: at.leg, legs: m.legs.length, depart: m.legs[0]!.depart, arrive: m.legs.at(-1)!.arrive, ...(m.unloadUntil !== undefined ? { unloadUntil: m.unloadUntil } : {}), loaded: leg.loaded, loads: leg.loads, position: at };
        }),
  },
};

export const movesModule = defineModule({
  id: 'moves',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Machine', 'NetEdge', 'NetNode'],
  commandDocs: {
    'moves.dispatch': {
      internal: true,
    },
  },
  label: 'Moves',
  description: 'Loads carried along legs, each leg on a carrier: timing, positions, traffic loads, arrival events.',
  provides: ['moves'],
  requires: ['routing', 'traffic'],
  components: { Move: MoveSchema, Place: PlaceSchema },
  state: { schema: StatsSchema, initial: (): MoveStats => ({ completedLegs: 0, vehicleKm: 0, externalKm: 0, esal: 0, breakdowns: 0, hazards: {} }) },
  events: {
    'moves.legDone': s.object({ move: s.ref('move'), requester: s.string(), purpose: s.string(), leg: s.int(), carrier: CarrierSchema, seconds: s.number({ unit: 's' }), to: s.point(), inCharge: s.ref().optional(), carried: s.array(s.ref('machine')).optional(), left: s.array(s.ref()).optional() }),
    'moves.stopped': s.object({ move: s.ref('move'), requester: s.string(), purpose: s.string(), ref: s.string().optional(), leg: s.int(), carrier: CarrierSchema, inCharge: s.ref().optional(), seconds: s.number({ unit: 's' }), cause: s.enum(['breakdown', 'dry', 'closed', 'stopped']), why: s.string(), at: s.point().optional(), units: s.array(s.ref()), loads: s.array(LoadSchema) }),
    'moves.delayed': s.object({ move: s.ref('move'), requester: s.string(), purpose: s.string(), ref: s.string().optional(), leg: s.int(), by: s.number({ unit: 's' }), arrive: s.number({ unit: 's' }), why: s.string() }),
    'moves.arrived': s.object({ move: s.ref('move'), requester: s.string(), purpose: s.string(), ref: s.string().optional(), carrier: CarrierSchema, loads: s.array(LoadSchema), to: s.point() }),
  },
  blockers: {
    'moves.noRoute': 'No route for {carrier} from {from} to {to}',
    'moves.unknownCarrier': 'Unknown carrier {carrier}',
    'moves.notExternal': 'Node {node} is not an external connection',
    'moves.notRoadLegal': '{carrier} is not road-legal and cannot use the external connection {node}',
    'moves.invalidRequest': 'Invalid move: {reason}',
    'moves.unitBusy': '{unit} is on another move until {until}',
    'moves.overloaded': 'Leg {leg}: {mass} t is more than the {carrier} carries ({payload} t)',
    'moves.legsApart': 'Leg {leg} does not start where the one before ends: {why}',
    'moves.notThere': '{unit} is not where its leg starts: it is {where}',
    'moves.offMap': '{at} is off the map (x {x0} to {x1}, z {z0} to {z1}): the world beyond is reached by a way out',
  },
  commands: {
    'moves.dispatch': command(DispatchSchema, dispatch, 'Dispatch a move'),
    'moves.stop': command(
      s.object({ move: s.ref('move'), why: s.string() }),
      (ctx, p) => stopMove(ctx, p.move, 'stopped', p.why),
      { label: 'A move is called off: it stops where it is, its units stand there', internal: true },
    ),
    'moves.place': command(
      s.object({ unit: s.ref(), at: s.point().optional(), beyond: s.ref().optional() }),
      (ctx, p) => {
        // a unit has one place: it comes into the world once, and after that only a move changes it
        if (ctx.get('Place', p.unit)) throw new Error(`moves.place: ${p.unit} is somewhere already: only a move takes it elsewhere (design/physical-state.md I2)`);
        if (p.at && !p.beyond && !ctx.setup && !ctx.trusted) throw new Error(`moves.place: ${p.unit} cannot appear at a place on the map in play: it comes in from beyond it, by a move`);
        if (!p.at === !p.beyond) throw new Error('moves.place: at a place, or beyond the map at a way in');
        ctx.set('Place', p.unit, p.at ? { at: [p.at[0], p.at[1]] } : { beyond: p.beyond! });
      },
      { label: 'A unit comes into the world (world setup and tests at a place, else beyond the map)', internal: true },
    ),
  },
  on: {
    // the way changed under moves under way: rerouted, or stopped where they are
    'network.changed': (ctx, e) => {
      const changed = new Set(e.edges);
      for (const [id, m] of [...ctx.all('Move')]) if (m.status === 'underway') replan(ctx, id, changed);
    },
  },
  timers: {
    legDone: (ctx, payload: LegDonePayload) => {
      const m = ctx.get('Move', payload.move);
      if (!m || m.status !== 'underway') return;
      const leg = m.legs[payload.leg]!;
      // it stood on the way: it arrives later; a leg rerouted shorter is done by its own timer, once
      if (ctx.now < leg.arrive) {
        ctx.at(leg.arrive, 'legDone', payload);
        return;
      }
      if ((m.done ?? 0) > payload.leg) return;
      ctx.patch('Move', payload.move, { done: payload.leg + 1 });
      // the carrier's pass over the edges it used
      const edges: EntityId[] = [];
      for (const st of leg.route.stretches) {
        if (st.kind === 'network' && st.edge && edges[edges.length - 1] !== st.edge) edges.push(st.edge);
      }
      const esal = ctx.port('routing').esal(leg.carrier.class, leg.loaded);
      if (edges.length) {
        const r = ctx.command('traffic.record', { edges, vehicles: 1, esalPerVehicle: esal, kind: m.purpose });
        if (!r.ok) ctx.log('warn', `Move ${payload.move}: traffic not recorded (${r.reasons.map((b) => b.code).join(', ')})`, [payload.move]);
      }
      // the units whose last leg of the move this was are where it ended (or beyond the map); one with a leg still to
      // come stays on the move, waiting where this one left it (r36: freed between its legs, it could be taken)
      const later = new Set(m.legs.slice(payload.leg + 1).flatMap(unitsOf));
      const left: EntityId[] = [];
      for (const u of unitsOf(leg))
        if (!later.has(u) && ctx.get('Place', u)?.on === payload.move) {
          ctx.set('Place', u, leg.toNode ? { beyond: leg.toNode } : { at: [leg.route.to[0], leg.route.to[1]] });
          left.push(u);
        }
      ctx.emit('moves.legDone', { move: payload.move, requester: m.requester, purpose: m.purpose, leg: payload.leg, carrier: { ...leg.carrier }, seconds: movingTime(leg, leg.arrive) + (leg.drivenBefore ?? 0), to: [leg.route.to[0], leg.route.to[1]], ...(leg.inCharge ? { inCharge: leg.inCharge } : {}), ...(carriedOf(leg).length ? { carried: carriedOf(leg) } : {}), ...(left.length ? { left } : {}) });
      const st = ctx.state('moves');
      ctx.setState('moves', { ...st, completedLegs: st.completedLegs + 1, vehicleKm: st.vehicleKm + leg.route.length / 1000 + leg.route.externalKm, externalKm: st.externalKm + leg.route.externalKm, esal: st.esal + esal });
      if (payload.leg < m.legs.length - 1) {
        ctx.at(m.legs[payload.leg + 1]!.arrive, 'legDone', { ...payload, leg: payload.leg + 1 });
        // (the next comes in from beyond the map: its way in may have closed meanwhile)
        const nx = m.legs[payload.leg + 1]!;
        if (nx.fromNode !== undefined) replan(ctx, payload.move, new Set(nx.route.stretches.flatMap((st) => (st.kind === 'network' && st.edge !== undefined ? [st.edge] : []))));
        return;
      }
      // the carrier unloads itself (tipping, its crane, its pump …) before the loads are there
      // (a trailer behind it is unhitched, not unloaded)
      const carried = leg.loads.filter((l) => !('machine' in l && l.towed));
      const unload = leg.loaded && carried.length ? unloadTime(ctx, leg.carrier.class, loadMass(carried)) : 0;
      if (unload > 0) {
        ctx.patch('Move', payload.move, { status: 'unloading', unloadUntil: ctx.now + unload });
        ctx.at(ctx.now + unload, 'unloaded', payload);
        return;
      }
      arrived(ctx, payload);
    },
    breakdown: (ctx, payload: { move: EntityId; leg: number }) => {
      const m = ctx.get('Move', payload.move);
      const leg = m?.legs[payload.leg];
      const st = ctx.state('moves');
      const { [payload.move]: _done, ...hazards } = st.hazards;
      ctx.setState('moves', { ...st, hazards });
      if (!m || !leg || m.status !== 'underway' || ctx.now < leg.depart || ctx.now >= leg.arrive) return;
      const prof = ctx.data('vehicleProfiles')[leg.carrier.class]!;
      // one of ours stands where it broke down until it is mended or fetched: the move ends there; beyond the map a
      // recovery service tows it on (r37: not stranded out of reach)
      if (leg.carrier.unit !== undefined) {
        if (!positionOnRoute(leg.route, movingTime(leg, ctx.now)).offMap) return stopMove(ctx, payload.move, 'breakdown', `${prof.label} broke down`);
        // (on the tow truck from here: it drives no more on this move, and breaks down no more)
        ctx.patch('Move', payload.move, { towed: true });
        return standFor(ctx, payload.move, payload.leg, ctx.data('networkSettings').recovery.towed.value * HOUR, `${prof.label} broke down beyond the map: towed on`);
      }
      // how long it stands: a roadside repair, a tow, or another lorry taking the load over
      const stand = Math.round(ctx.rng('breakdown').exponential(prof.breakdown!.standstill.value) * HOUR);
      const why = `${prof.label} broke down`;
      const legs = m.legs.map((l, i) => (i < payload.leg ? l : i === payload.leg ? { ...l, arrive: l.arrive + stand, stops: [...(l.stops ?? []), { at: ctx.now, until: ctx.now + stand, why }] } : { ...l, depart: l.depart + stand, arrive: l.arrive + stand }));
      ctx.patch('Move', payload.move, { legs });
      ctx.setState('moves', { ...ctx.state('moves'), breakdowns: ctx.state('moves').breakdowns + 1 });
      const where = positionOnRoute(leg.route, movingTime(leg, ctx.now));
      const mass = loadMass(leg.loads);
      ctx.log('warn', `${why} on the way${where.offMap ? ' (beyond the map)' : ` at ${fmt(where.pos)}`}${mass > 0 ? ` with ${mass >= 1 ? mass.toFixed(1) : mass.toFixed(2)} t` : ''}: it goes on in about ${Math.max(1, Math.round(stand / 60))} min.`, [payload.move, ...(m.ref ? [m.ref] : [])]);
      ctx.emit('moves.delayed', { move: payload.move, requester: m.requester, purpose: m.purpose, ...(m.ref !== undefined ? { ref: m.ref } : {}), leg: payload.leg, by: stand, arrive: legs.at(-1)!.arrive, why });
      drawHazard(ctx, payload.move, ctx.now + stand);
    },
    // its tank empty on the way: it stands where it ran dry
    runsDry: (ctx, payload: { move: EntityId; unit: EntityId }) => {
      const m = ctx.get('Move', payload.move);
      if (!m || m.status !== 'underway') return;
      const at = positionOf(m, ctx.now);
      // beyond the map: to a station and filled up (r37); on it: it stands where it ran dry
      if (!at.offMap) return stopMove(ctx, payload.move, 'dry', 'ran dry');
      const { dryAt: _d, ...rest } = m;
      ctx.set('Move', payload.move, rest as Move);
      standFor(ctx, payload.move, at.leg, ctx.data('networkSettings').recovery.refuel.value * HOUR, 'ran dry beyond the map: filled up at a station');
    },
    // a move waiting beyond the map for its way in: is one open now?
    retry: (ctx, payload: { move: EntityId }) => {
      const m = ctx.get('Move', payload.move);
      if (!m || m.status !== 'underway') return;
      replan(ctx, payload.move, new Set(m.legs.flatMap((l) => l.route.stretches.flatMap((st) => (st.kind === 'network' && st.edge !== undefined ? [st.edge] : [])))));
    },
    unloaded: (ctx, payload: LegDonePayload) => {
      if (ctx.get('Move', payload.move)?.status !== 'unloading') return;
      arrived(ctx, payload);
    },
    reap: (ctx, payload: { move: EntityId }) => {
      if (ctx.has('Move', payload.move)) ctx.destroy(payload.move);
    },
  },
  ports: {
    moves: (ctx): MovesPort => ({
      where: (unit) => whereOf(ctx, unit),
      whereAt: (unit, t) => whereOf(ctx, unit, Math.max(ctx.now, t)),
      placeOf: (unit) => ctx.get('Place', unit),
      onMap: (p) => onMap(ctx, p),
      underway: () => {
        const out: [EntityId, Readonly<Move>][] = [];
        for (const [id, m] of ctx.all('Move')) if (m.status !== 'arrived') out.push([id, m]);
        return out;
      },
      positionAt: (move, t) => {
        const m = ctx.get('Move', move);
        return m ? positionOf(m, t) : null;
      },
      unloadTime: (carrier, tonnes) => unloadTime(ctx, carrier, tonnes),
      positionOnRoute,
      stats: () => ctx.state('moves'),
    }),
  },
  projections: PROJECTIONS,
  /** a fork does not know when a lorry will break down, nor whether: every move under way is drawn again */
  branch(ctx) {
    for (const [id, m] of [...ctx.all('Move')]) if (m.status === 'underway') drawHazard(ctx, id, ctx.now);
  },
});

/** the end of a move: the requester is told, the move is reaped, the carrier may go back empty */
function arrived(ctx: WriteCtx, payload: LegDonePayload): void {
  const m = ctx.require('Move', payload.move);
  const leg = m.legs.at(-1)!;
  ctx.patch('Move', payload.move, { status: 'arrived' });
  drawHazard(ctx, payload.move, ctx.now);
  const ev: { move: EntityId; requester: string; purpose: string; ref?: string; carrier: Carrier; loads: Load[]; to: Vec2 } = { move: payload.move, requester: m.requester, purpose: m.purpose, carrier: { ...leg.carrier }, loads: structuredClone(deliveredBy(m)), to: [leg.route.to[0], leg.route.to[1]] };
  if (m.ref !== undefined) ev.ref = m.ref;
  ctx.emit('moves.arrived', ev);
  // keep the arrived move readable for event handlers at this instant, then remove it
  ctx.at(ctx.now, 'reap', { move: payload.move });
  if (payload.returnEmpty) {
    const back: LegRequest = { carrier: { ...leg.carrier }, from: [leg.route.to[0], leg.route.to[1]], to: [leg.route.from[0], leg.route.from[1]] };
    if (payload.returnVia) {
      back.externalDestination = payload.returnVia.externalDestination;
      if (payload.returnVia.beyondKm) back.beyondKm = payload.returnVia.beyondKm;
    } else {
      if (payload.fromExternal) back.externalDestination = payload.fromExternal;
      if (payload.toExternal) back.externalNode = payload.toExternal;
    }
    if (payload.maxOffroad !== undefined) back.maxOffroad = payload.maxOffroad;
    const r = ctx.command('moves.dispatch', { legs: [back], purpose: `${m.purpose}:return`, requester: m.requester, ...(m.ref !== undefined ? { ref: m.ref } : {}) });
    if (!r.ok) ctx.log('warn', `Return of ${payload.move} not possible: ${r.reasons.map((b) => ctx.formatBlocker(b)).join('; ')}`, [payload.move]);
  }
}
