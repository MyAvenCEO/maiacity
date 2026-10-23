/**
 * Conformance suites of the routing and moves contracts (decision 0015). Every implementation must pass them: the
 * network's A* routing and its moves, and the fakes of `@cc/network/testing` (design/modular-split.md §7.2). What
 * only the real network does (ways, ground, breakdowns, reroutes) is not asked here.
 *
 * The suites set up their fixtures through internal commands (a trusted world), as the library tests do.
 */
import { check, command, defineModule, HOUR, Runtime, s, type ConformanceSuite, type EntityId, type RuntimeConfig } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type { Load, Move, Route } from './contract.ts';

export interface RoutingSubject {
  /** the configuration of a world with the implementation under test (same every call) */
  config(): RuntimeConfig;
  /** lays out what the routes run on in a fresh world (ways, a way in from beyond the map): that way in's node */
  prepare(rt: Runtime): { external: EntityId };
  /** a road-legal carrier class of the world's profiles */
  profile: string;
  /** places it is routed between: each pair has a route */
  trips: [Vec2, Vec2][];
}

export interface MovesSubject {
  config(): RuntimeConfig;
  prepare(rt: Runtime): { external: EntityId };
  /** a road-legal carrier class for goods */
  carrier: string;
  /** a class that drives itself (a machine of the world as the carrier of its leg) */
  driver: string;
  /** a move runs from a to b, and on to c (both carriers can go there) */
  a: Vec2;
  b: Vec2;
  c: Vec2;
}

const near = (p: readonly number[], q: readonly number[], tol = 1): boolean => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) <= tol;
const fmt = (p: readonly number[]): string => `(${p[0]!.toFixed(1)}, ${p[1]!.toFixed(1)})`;

// a unit of the world to be moved (a machine that drives itself)
const units = defineModule({ id: 'conformance-units', commands: { 'conformance.unit': command(s.object({}), (ctx) => ctx.spawn('unit')) } });

const worldOf = (subject: { config(): RuntimeConfig; prepare(rt: Runtime): { external: EntityId } }): { rt: Runtime; external: EntityId } => {
  const cfg = subject.config();
  const rt = Runtime.create({ ...cfg, modules: [...cfg.modules, units], trusted: true });
  return { rt, external: subject.prepare(rt).external };
};

const ok = <T>(r: { ok: true; value: unknown } | { ok: false; reasons: { code: string }[] }, what: string): T => {
  if (!r.ok) throw new Error(`${what} refused: ${r.reasons.map((b) => b.code).join(', ')}`);
  return r.value as T;
};

const routeOk = (r: Route | null, what: string): Route => {
  check(r !== null, `${what}: no route`);
  for (const k of ['length', 'networkLength', 'offroadLength', 'duration', 'externalKm'] as const) check(Number.isFinite(r[k]) && r[k] >= 0, `${what}: ${k} ${r[k]}`);
  for (const st of r.stretches) check(Number.isFinite(st.duration) && st.duration >= 0 && Number.isFinite(st.length) && st.length >= 0, `${what}: a ${st.kind} stretch of ${st.length} m in ${st.duration} s`);
  return r;
};

/** its stretches take its time, its stretches on the map are its length */
const consistent = (r: Route, what: string): void => {
  const time = r.stretches.reduce((a, st) => a + st.duration, 0);
  check(Math.abs(time - r.duration) <= 1e-6 * Math.max(1, r.duration), `${what}: stretches take ${time} s, the route ${r.duration} s`);
  const onMap = r.stretches.filter((st) => st.kind !== 'external').reduce((a, st) => a + st.length, 0);
  check(Math.abs(onMap - r.length) <= 1e-6 * Math.max(1, r.length), `${what}: stretches on the map ${onMap} m, the route ${r.length} m`);
  check(Math.abs(r.networkLength + r.offroadLength - r.length) <= 1e-6 * Math.max(1, r.length), `${what}: ${r.networkLength} m on the ways + ${r.offroadLength} m off them is not ${r.length} m`);
  const beyond = r.stretches.filter((st) => st.kind === 'external').reduce((a, st) => a + st.length, 0) / 1000;
  check(Math.abs(beyond - r.externalKm) <= 1e-6 * Math.max(1, r.externalKm), `${what}: stretches beyond the map ${beyond} km, the route ${r.externalKm} km`);
};

/** no faster than the carrier's top speed, on the map and beyond it */
const notTooFast = (rt: Runtime, r: Route, profile: string, crow: number, what: string): void => {
  const top = rt.read.port('routing').profile(profile).maxSpeed.value / 3.6;
  check(r.length >= crow - 1e-6, `${what}: ${r.length} m is shorter than the ${crow.toFixed(1)} m as the crow flies`);
  check(r.duration >= (crow + r.externalKm * 1000) / top - 1e-6, `${what}: ${r.duration} s for ${crow.toFixed(0)} m and ${r.externalKm} km beyond is faster than its top speed`);
};

export const routingConformance: ConformanceSuite<RoutingSubject> = {
  contract: 'routing',
  cases: [
    {
      name: 'a route is physical: lengths in metres and times in seconds, finite and not negative',
      run(subject) {
        const { rt } = worldOf(subject);
        const routing = rt.read.port('routing');
        for (const [a, b] of subject.trips) routeOk(routing.route(a, b, subject.profile), `${fmt(a)} → ${fmt(b)}`);
      },
    },
    {
      name: "a route's time is the time of its stretches, its length theirs",
      run(subject) {
        const { rt, external } = worldOf(subject);
        const routing = rt.read.port('routing');
        for (const [a, b] of subject.trips) consistent(routeOk(routing.route(a, b, subject.profile), 'route'), `${fmt(a)} → ${fmt(b)}`);
        const [, b] = subject.trips[0]!;
        consistent(routeOk(routing.routeFromExternal(external, b, subject.profile), 'in'), `in to ${fmt(b)}`);
        consistent(routeOk(routing.routeToExternal(b, external, subject.profile), 'out'), `out from ${fmt(b)}`);
      },
    },
    {
      name: 'a route runs from where it was asked to where it was asked, no faster than its carrier goes',
      run(subject) {
        const { rt } = worldOf(subject);
        const routing = rt.read.port('routing');
        for (const [a, b] of subject.trips) {
          const r = routeOk(routing.route(a, b, subject.profile), 'route');
          const what = `${fmt(a)} → ${fmt(b)}`;
          check(near(r.from, a) && near(r.polyline[0]!, a), `${what}: starts at ${fmt(r.from)}`);
          check(near(r.to, b) && near(r.polyline.at(-1)!, b), `${what}: ends at ${fmt(r.to)}`);
          notTooFast(rt, r, subject.profile, Math.hypot(b[0] - a[0], b[1] - a[1]), what);
        }
      },
    },
    {
      name: 'from a place to itself there is nothing to go',
      run(subject) {
        const { rt } = worldOf(subject);
        for (const [a] of subject.trips) {
          const r = rt.read.port('routing').route(a, a, subject.profile);
          check(r === null || (r.duration === 0 && r.length === 0), `${fmt(a)} → itself: ${r?.length} m in ${r?.duration} s`);
        }
      },
    },
    {
      name: 'in from beyond the map and out to it: the distance beyond is driven, at no more than top speed',
      run(subject) {
        const { rt, external } = worldOf(subject);
        const routing = rt.read.port('routing');
        const node = rt.read.get('NetNode', external);
        check(node?.external !== undefined, `${external} is not a way in`);
        check(routing.externalNodes().includes(external), `externalNodes() does not list ${external}`);
        for (const [, b] of subject.trips) {
          const inn = routeOk(routing.routeFromExternal(external, b, subject.profile), 'in');
          const out = routeOk(routing.routeToExternal(b, external, subject.profile), 'out');
          for (const [r, what] of [[inn, `in to ${fmt(b)}`], [out, `out from ${fmt(b)}`]] as const) {
            check(r.externalKm >= node.external.distanceKm - 1e-9, `${what}: ${r.externalKm} km beyond the map, the way in says ${node.external.distanceKm} km`);
            notTooFast(rt, r, subject.profile, 0, what);
          }
          check(near(inn.to, b) && near(out.from, b), `in ends at ${fmt(inn.to)}, out starts at ${fmt(out.from)}, not at ${fmt(b)}`);
        }
      },
    },
    {
      name: "a carrier's pass: its profile as the world has it, ESAL not negative, loaded no less than empty",
      run(subject) {
        const { rt } = worldOf(subject);
        const routing = rt.read.port('routing');
        const p = routing.profile(subject.profile);
        check(JSON.stringify(p) === JSON.stringify(rt.read.data('vehicleProfiles')[subject.profile]), 'profile() is not the world’s profile');
        const loaded = routing.esal(subject.profile, true);
        const empty = routing.esal(subject.profile, false);
        check(empty >= 0 && loaded >= empty, `ESAL loaded ${loaded}, empty ${empty}`);
        let threw = false;
        try {
          routing.profile('no-such-carrier');
        } catch {
          threw = true;
        }
        check(threw, 'an unknown profile was answered');
      },
    },
    {
      name: 'deterministic: two worlds made alike route alike, and the same question twice has the same answer',
      run(subject) {
        const ask = (rt: Runtime, external: EntityId) => JSON.stringify(subject.trips.map(([a, b]) => [rt.read.port('routing').route(a, b, subject.profile), rt.read.port('routing').routeFromExternal(external, b, subject.profile)]));
        const x = worldOf(subject);
        const y = worldOf(subject);
        const first = ask(x.rt, x.external);
        check(first === ask(y.rt, y.external), 'two worlds made alike route differently');
        check(first === ask(x.rt, x.external), 'the same question twice was answered differently');
        check(x.rt.read.port('routing').revision() === x.rt.read.port('routing').revision(), 'the revision moved without a change');
      },
    },
  ],
};

/** a move of goods from a to b (and on to c), with what it told */
const deliver = (subject: MovesSubject, rt: Runtime, opts: { on?: boolean; returnEmpty?: boolean; external?: EntityId } = {}): { id: EntityId; told: { type: string; t: number; p: Record<string, unknown> }[] } => {
  const told: { type: string; t: number; p: Record<string, unknown> }[] = [];
  rt.onEvent((type, p, t) => {
    if (type.startsWith('moves.')) told.push({ type, t, p: p as Record<string, unknown> });
  });
  const goods: Load = { goods: { material: 'sand', qty: 1, unit: 't', mass: 1 } };
  const first = opts.external ? { carrier: { class: subject.carrier }, from: subject.a, to: subject.b, externalNode: opts.external } : { carrier: { class: subject.carrier }, from: subject.a, to: subject.b };
  const legs = opts.on ? [first, { carrier: { class: subject.carrier }, from: subject.b, to: subject.c }] : [first];
  const id = ok<EntityId>(rt.dispatch('moves.dispatch', { legs, loads: [goods], purpose: 'conformance', ref: 'r1', requester: 'conformance', ...(opts.returnEmpty ? { returnEmpty: true } : {}) }), 'the move');
  return { id, told };
};

const arrivalsOf = (told: { type: string; t: number; p: Record<string, unknown> }[], move?: EntityId) => told.filter((e) => e.type === 'moves.arrived' && (move === undefined || e.p.move === move));
const end = (rt: Runtime, m: Readonly<Move>, subject: MovesSubject): number => m.legs.at(-1)!.arrive + rt.read.port('moves').unloadTime(subject.carrier, 1);

export const movesConformance: ConformanceSuite<MovesSubject> = {
  contract: 'moves',
  cases: [
    {
      name: 'a move arrives where it was sent, when its legs say, with what it carried',
      run(subject) {
        const { rt } = worldOf(subject);
        rt.advance(HOUR);
        const { id, told } = deliver(subject, rt);
        const m = rt.read.require('Move', id);
        const leg = m.legs[0]!;
        check(m.status === 'underway', `a new move is ${m.status}`);
        check(leg.depart === HOUR && leg.arrive === leg.depart + leg.route.duration, `leg from ${leg.depart} to ${leg.arrive} with a route of ${leg.route.duration} s`);
        check(rt.read.port('moves').underway().some(([u]) => u === id), 'underway() does not list it');
        const t = end(rt, m, subject);
        if (t - 1 > rt.now) rt.advance(t - 1);
        check(arrivalsOf(told, id).length === 0, `arrived before ${t}`);
        rt.advance(t);
        const a = arrivalsOf(told, id);
        check(a.length === 1, `${a.length} arrivals`);
        const e = a[0]!;
        check(e.t === t, `arrived at ${e.t}, not ${t}`);
        check(near(e.p.to as Vec2, subject.b), `arrived at ${fmt(e.p.to as Vec2)}, sent to ${fmt(subject.b)}`);
        check(e.p.requester === 'conformance' && e.p.purpose === 'conformance' && e.p.ref === 'r1', 'requester, purpose or ref not told back');
        const loads = e.p.loads as Load[];
        check(loads.length === 1 && 'goods' in loads[0]! && loads[0].goods.material === 'sand' && loads[0].goods.qty === 1, `delivered ${JSON.stringify(loads)}`);
        rt.advance(t + 1);
        check(!rt.read.port('moves').underway().some(([u]) => u === id), 'still under way after it arrived');
      },
    },
    {
      name: 'its legs follow one another, and each is done when it arrives',
      run(subject) {
        const { rt } = worldOf(subject);
        const { id, told } = deliver(subject, rt, { on: true });
        const m = rt.read.require('Move', id);
        const [l0, l1] = [m.legs[0]!, m.legs[1]!];
        check(l1.depart >= l0.arrive, `the second leg leaves at ${l1.depart}, before the first arrives at ${l0.arrive}`);
        const before = rt.read.port('moves').stats().completedLegs;
        rt.advance(end(rt, m, subject));
        const done = told.filter((e) => e.type === 'moves.legDone' && e.p.move === id);
        check(done.length === 2, `${done.length} legs done of 2`);
        done.forEach((e, i) => {
          const l = m.legs[i]!;
          check(e.p.leg === i && e.t === l.arrive, `leg ${e.p.leg} done at ${e.t}, its arrival is ${l.arrive}`);
          check(Math.abs((e.p.seconds as number) - (l.arrive - l.depart)) < 1e-6, `leg ${i}: ${e.p.seconds} s driven of ${l.arrive - l.depart}`);
          check(near(e.p.to as Vec2, l.route.to), `leg ${i} done at ${fmt(e.p.to as Vec2)}`);
        });
        check(arrivalsOf(told, id).length === 1 && near(arrivalsOf(told, id)[0]!.p.to as Vec2, subject.c), 'it did not arrive at the end of its last leg');
        check(rt.read.port('moves').stats().completedLegs === before + 2, `stats count ${rt.read.port('moves').stats().completedLegs - before} legs done of 2`);
      },
    },
    {
      name: 'a unit moved is on its move, then stands where it ends; it is on one move at a time',
      run(subject) {
        const { rt } = worldOf(subject);
        const unit = ok<EntityId>(rt.dispatch('conformance.unit', {}), 'a unit');
        ok(rt.dispatch('moves.place', { unit, at: subject.a }), 'placing it');
        const moves = rt.read.port('moves');
        check(near(moves.where(unit)!, subject.a), `placed at ${fmt(subject.a)}, it is at ${fmt(moves.where(unit) ?? [NaN, NaN])}`);
        const id = ok<EntityId>(rt.dispatch('moves.dispatch', { legs: [{ carrier: { class: subject.driver, unit }, from: subject.a, to: subject.b }], purpose: 'drive', requester: 'conformance' }), 'its move');
        check(moves.placeOf(unit)?.on === id, 'it is not on its move');
        const again = rt.dispatch('moves.dispatch', { legs: [{ carrier: { class: subject.driver, unit }, from: subject.a, to: subject.b }], purpose: 'twice', requester: 'conformance' });
        check(!again.ok, 'a unit on a move was sent on another');
        const m = rt.read.require('Move', id);
        const half = (m.legs[0]!.depart + m.legs[0]!.arrive) / 2;
        const mid = moves.whereAt(unit, half)!;
        check(Math.hypot(mid[0] - subject.a[0], mid[1] - subject.a[1]) <= Math.hypot(subject.b[0] - subject.a[0], subject.b[1] - subject.a[1]) + 1, `half way it is at ${fmt(mid)}`);
        rt.advance(m.legs[0]!.arrive);
        check(near(moves.placeOf(unit)?.at ?? [NaN, NaN], subject.b) && near(moves.where(unit)!, subject.b), `after its move it is at ${fmt(moves.where(unit) ?? [NaN, NaN])}, not ${fmt(subject.b)}`);
      },
    },
    {
      name: 'where a move is: at its start when it leaves, at its end when it arrives, never going back',
      run(subject) {
        const { rt } = worldOf(subject);
        const { id } = deliver(subject, rt, { on: true });
        const moves = rt.read.port('moves');
        const m = rt.read.require('Move', id);
        const t0 = m.legs[0]!.depart;
        const t1 = m.legs.at(-1)!.arrive;
        check(near(moves.positionAt(id, t0)!.pos, subject.a), `at ${fmt(moves.positionAt(id, t0)!.pos)} when it leaves`);
        check(near(moves.positionAt(id, t1)!.pos, subject.c), `at ${fmt(moves.positionAt(id, t1)!.pos)} when it arrives`);
        let last = -1;
        for (let k = 0; k <= 20; k += 1) {
          const p = moves.positionAt(id, t0 + ((t1 - t0) * k) / 20)!;
          check(p.progress >= 0 && p.progress <= 1 && p.progress >= last - 1e-9, `progress ${p.progress} after ${last}`);
          last = p.progress;
        }
        for (const l of m.legs) {
          check(near(moves.positionOnRoute(l.route, 0).pos, l.route.from), 'positionOnRoute at 0 is not where the route starts');
          check(near(moves.positionOnRoute(l.route, l.route.duration).pos, l.route.to), 'positionOnRoute at its duration is not where the route ends');
        }
      },
    },
    {
      name: 'an empty return comes back to where the last leg set out, after the move arrived',
      run(subject) {
        const { rt } = worldOf(subject);
        const { id, told } = deliver(subject, rt, { returnEmpty: true });
        const m = rt.read.require('Move', id);
        rt.advance(end(rt, m, subject) + 2 * (m.legs[0]!.arrive - m.legs[0]!.depart) + HOUR);
        const a = arrivalsOf(told);
        check(a.length === 2, `${a.length} arrivals of 2`);
        check(a[1]!.p.purpose === 'conformance:return' && a[1]!.p.requester === 'conformance' && a[1]!.p.ref === 'r1', `the return was told as ${a[1]!.p.purpose}`);
        check(a[1]!.t >= a[0]!.t && near(a[1]!.p.to as Vec2, subject.a), `back at ${fmt(a[1]!.p.to as Vec2)} at ${a[1]!.t}`);
      },
    },
    {
      name: 'in from beyond the map: the way beyond is driven before the way on it',
      run(subject) {
        const { rt, external } = worldOf(subject);
        const { id, told } = deliver(subject, rt, { external });
        const m = rt.read.require('Move', id);
        const r = m.legs[0]!.route;
        check(r.externalKm > 0, 'nothing driven beyond the map');
        rt.advance(end(rt, m, subject));
        check(arrivalsOf(told, id).length === 1 && near(arrivalsOf(told, id)[0]!.p.to as Vec2, subject.b), 'it did not arrive');
        check(rt.read.port('moves').stats().externalKm >= r.externalKm - 1e-9, 'stats do not count the km beyond the map');
      },
    },
    {
      name: 'a move that cannot be made is refused whole: an unknown carrier, no legs',
      run(subject) {
        const { rt } = worldOf(subject);
        const count = () => [...rt.read.all('Move')].length;
        check(!rt.dispatch('moves.dispatch', { legs: [{ carrier: { class: 'no-such-carrier' }, from: subject.a, to: subject.b }], purpose: 'x' }).ok, 'an unknown carrier was sent');
        check(!rt.dispatch('moves.dispatch', { legs: [], purpose: 'x' }).ok, 'a move without legs was made');
        check(count() === 0, `${count()} moves made by refused requests`);
      },
    },
    {
      name: 'deterministic: two worlds made alike move alike, and a restored snapshot moves on the same',
      run(subject) {
        const run = (cut?: number) => {
          const { rt } = worldOf(subject);
          const { id, told } = deliver(subject, rt, { on: true, returnEmpty: true });
          const t = end(rt, rt.read.require('Move', id), subject) + 2 * HOUR;
          if (cut === undefined) {
            rt.advance(t);
            return told.map((e) => [e.type, e.t, e.p]);
          }
          rt.advance(cut);
          const cfg = subject.config();
          const back = Runtime.restore({ ...cfg, modules: [...cfg.modules, units], trusted: true }, JSON.parse(JSON.stringify(rt.snapshot())));
          const after: { type: string; t: number; p: unknown }[] = [];
          back.onEvent((type, p, at) => {
            if (type.startsWith('moves.')) after.push({ type, t: at, p });
          });
          back.advance(t);
          return [...told.map((e) => [e.type, e.t, e.p]), ...after.map((e) => [e.type, e.t, e.p])];
        };
        const a = JSON.stringify(run());
        check(a === JSON.stringify(run()), 'two worlds made alike moved differently');
        const { rt } = worldOf(subject);
        const { id } = deliver(subject, rt, { on: true });
        const half = (rt.read.require('Move', id).legs[0]!.depart + rt.read.require('Move', id).legs[0]!.arrive) / 2;
        check(a === JSON.stringify(run(half)), 'the world restored half way moved on differently');
      },
    },
  ],
};
