/**
 * Carrying by hand (decision 0025): material in a store beyond reach of the work front has to be
 * fetched. A person carries what they can safely lift, walks there and back at the pace the slope
 * allows (Tobler's hiking function, slower loaded), and works in between. Supply and work run side
 * by side through the stock at the front: alone, a person alternates; a crew splits into carrying
 * and working as the stock rises and falls. Either way N people deliver N / (1/work + 1/carry) units
 * an hour: the carrying is a factor carry / (work + carry) on the work rate.
 */
import { ex, type EntityId, type Explained, type ReadCtx } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import { isCounted, unitMass, type Material } from '../../inventory/src/index.ts';
import { s, type Infer } from '../../kernel/src/index.ts';

/** how people lift and carry, and how fast they walk (practice pack) */
export const HandlingSchema = s.object({
  /** what one person may lift and carry in one go */
  safeLoad: s.param('kg'),
  /** a team lifting together manages this share of the sum of its members' loads (2, 3, 4 people) */
  team: s.array(s.param('1')),
  /** within this distance the work front is in reach: no walking */
  reach: s.param('m'),
  /** loading and setting down a load, per trip */
  tripHandling: s.param('h'),
  /** walking speed on flat ground, Tobler's slope factor and offset */
  walk: s.object({ flat: s.param('km/h'), slope: s.param('1'), offset: s.param('1'), loaded: s.param('1') }),
  /** errands: the vehicle profile a person on foot is on the network, and the time at a counter */
  errand: s.object({ profile: s.string(), atCounter: s.param('h') }),
  /** a heap: each other kind of goods in it adds this share to the handling of a trip (finding, moving what is on top) */
  heapPerKind: s.param('1').optional(),
  /** drawing water by hand at a creek or a pond: the good it is, and filling the canisters */
  /** water drawn at a creek or a pond: the good it is by the kind of water it is drawn from (`material`: any other) */
  drawWater: s.object({ material: s.string(), bySource: s.record(s.string()).optional(), fill: s.param('h') }).optional(),
});
export type Handling = Infer<typeof HandlingSchema>;

/** walking speed (km/h) on a slope (rise over run, positive uphill), after Tobler */
export const walkSpeed = (h: Handling, slope: number, loaded: boolean): number => h.walk.flat.value * Math.exp(-h.walk.slope.value * Math.abs(slope + h.walk.offset.value)) / Math.exp(-h.walk.slope.value * h.walk.offset.value) * (loaded ? h.walk.loaded.value : 1);

/** people needed to lift one piece: one, or a team whose share of their sum carries it */
export function liftersFor(h: Handling, mass: number): number {
  if (mass <= h.safeLoad.value) return 1;
  for (let n = 2; n <= h.team.length + 1; n += 1) if (mass <= n * h.safeLoad.value * h.team[n - 2]!.value) return n;
  return Number.POSITIVE_INFINITY;
}

/**
 * Where a good is carried: drawn from a store (or where one will be) to the work front; made onto a store
 * from the front (`to`); or along legs of their own, each loaded from where it lies to where it goes, with
 * its share of the good (felled wood: each tree to the heap).
 */
export type Carry = EntityId | Vec2 | { to: EntityId | Vec2 } | { legs: { from: Vec2; to: Vec2; share: number }[] };

/**
 * The factor carrying puts on the work rate, explained; null when everything is in reach.
 * `perUnit`: material per unit of work; `work`: one person's rate of work (units/h).
 */
export function carryFactor(read: ReadCtx, front: Vec2, perUnit: Record<string, number>, storeOf: Record<string, Carry | undefined>, work: number, unit: string, aid?: { label: string; capacityKg: number; capacityM3?: number; share: number }, total?: number, heads = 1): Explained | null {
  const h = read.data('handling');
  if (!h) return null;
  const hold = read.port('holdings');
  const terrain = read.port('terrain');
  let hoursPerUnit = 0;
  // the whole job's trips, and the longest: more hands than trips do not make one trip shorter
  let jobTrips = 0;
  let tripHours = 0;
  let longest = 0;
  const parts: Explained[] = [];
  const posOf = (x: EntityId | Vec2) => (Array.isArray(x) ? (x as Vec2) : hold.where(x as EntityId));
  for (const [mat, q] of Object.entries(perUnit)) {
    const where = storeOf[mat];
    if (!(q > 0) || where === undefined) continue;
    // its legs, loaded from → to; a store it is drawn from (whose heap may be in the way)
    let legs: { from: Vec2; to: Vec2; share: number }[] = [];
    let st: EntityId | undefined;
    if (typeof where === 'object' && !Array.isArray(where) && 'legs' in where) legs = where.legs;
    else if (typeof where === 'object' && !Array.isArray(where) && 'to' in where) {
      const at = posOf(where.to);
      if (at) legs = [{ from: front, to: [at[0], at[1]], share: 1 }];
    } else {
      const at = posOf(where as EntityId | Vec2);
      if (typeof where === 'string' && hold.exists(where)) st = where;
      if (at) legs = [{ from: [at[0], at[1]], to: front, share: 1 }];
    }
    const m = hold.material(mat);
    const mass = unitMass(m);
    // a trip: goods counted in pieces go whole (as many as one can carry, or one piece by as many as it
    // takes); bulk goods are shovelled or scooped, as much as one carries
    const counted = isCounted(m);
    const lifters = counted ? liftersFor(h, mass) : 1;
    const perTrip = !counted ? h.safeLoad.value / mass : lifters > 1 ? 1 / lifters : Math.max(1, Math.floor(h.safeLoad.value / mass));
    // with a wheelbarrow (or another aid), those who have one take its load a trip (a piece that fits it):
    // bulk goods by its load or its volume, whichever is less (a barrow of brash is full long before it is heavy);
    // taken only where it carries more than one's arms
    const byVolume = aid?.capacityM3 && m.density ? aid.capacityM3 / ((mass / 1000) / m.density.value) : Infinity;
    const aided0 = !aid ? 0 : !counted ? Math.min(aid.capacityKg / mass, byVolume) : mass <= aid.capacityKg ? Math.max(1, Math.floor(aid.capacityKg / mass)) : 0;
    const aided = aided0 > perTrip + 1e-12 ? aided0 : 0;
    const share = aided ? Math.min(1, aid!.share) : 0;
    // picking it up: in a heap, what else lies there is in the way; in a store laid out, it is in its place
    const kinds = st ? Object.entries(hold.contents(st)).filter(([k, v]) => v > 1e-9 && k !== mat).length : 0;
    const heap = st && !hold.laidOut(st) && h.heapPerKind ? 1 + h.heapPerKind.value * kinds : 1;
    let hours = 0;
    let dist = 0;
    let carried = 0;
    let trips = 0;
    for (const leg of legs) {
      const line = Math.hypot(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]);
      // (each leg by its own way: what lies within reach is no walk)
      if (line <= h.reach.value || !(leg.share > 0)) continue;
      // the way walked, not the line drawn: round a creek, or none (finding 15: carried across water 0.5 m deep)
      const way = read.hasPort('routing') ? read.port('routing').route(leg.from, leg.to, h.errand.profile, { maxOffroad: 5000 }) : null;
      if (read.hasPort('routing') && !way) return ex.value(0, '1', `${m.label}: no way on foot from where it lies to the work (water in between?)`);
      const d = way?.length ?? line;
      if (!Number.isFinite(lifters)) return ex.value(0, '1', `${m.label}: a piece of ${Math.round(mass)} kg is too heavy to carry by hand`);
      const slope = (terrain.heightAt(leg.to[0], leg.to[1]) - terrain.heightAt(leg.from[0], leg.from[1])) / d;
      const there = d / 1000 / walkSpeed(h, slope, true);
      const back = d / 1000 / walkSpeed(h, -slope, false);
      const trip = there + back + h.tripHandling.value * heap;
      const qq = q * leg.share;
      // (a barrow takes what it holds a trip: pieces whole, bulk goods by its capacity, a fraction of a tonne)
      // (what is left to carry of the whole job takes a whole trip at least: a jerrycan across the site is a walk; Qwen S177)
      // (one way to carry, as a move of goods; wood from many trees goes in loads of their own)
      const whole = (n: number) => (total && total > 0 && legs.length === 1 ? Math.max(n, 1 / total) : n);
      hours += (1 - share) * whole(qq / perTrip) * trip + (share > 0 ? share * whole(qq / aided) * trip : 0);
      if (total && total > 0 && legs.length === 1) {
        const n = Math.ceil(total * qq * ((1 - share) / perTrip + (share > 0 ? share / aided : 0)) - 1e-9);
        jobTrips += n;
        tripHours += n * trip;
        longest = Math.max(longest, trip);
      }
      dist += d * leg.share;
      trips += trip * leg.share;
      carried += leg.share;
    }
    if (!(hours > 0)) continue;
    hoursPerUnit += hours;
    const mean = dist / Math.max(1e-9, carried);
    const meanTrip = trips / Math.max(1e-9, carried);
    parts.push(ex.value(hours, `h/${unit}`, `${m.label}: ${Math.round(mean)} m to carry${legs.length > 1 ? ' on average' : ''}, ${aided ? `${+aided.toFixed(3)} ${m.unit} a trip in a ${aid!.label.toLowerCase()}${share < 1 ? ` (${Math.round(share * 100)} % of the crew), else ` : ''}` : ''}${share < 1 ? (lifters > 1 ? `${lifters} people a piece` : `${+perTrip.toFixed(3)} ${m.unit} a trip by hand`) : ''}, ${Math.round(meanTrip * 60)} min a trip${heap > 1 ? ` (from a heap of ${kinds + 1} kinds of goods: picking takes ${Math.round(heap * 100)} %; laying the store out saves it)` : ''}`, h.walk.flat.source));
  }
  if (hoursPerUnit <= 0) return null;
  const carry = 1 / hoursPerUnit;
  const factor = ex.div('carrying (work and carrying side by side)', '1', ex.value(carry, `${unit}/h`, 'one person carrying'), ex.sum(undefined, `${unit}/h`, ex.value(work, `${unit}/h`, 'one person working'), ex.value(carry, `${unit}/h`, 'one person carrying', undefined, parts.map((p) => p.label).join('; '))));
  // (a crew bigger than the job's trips: each trip is still walked whole, by one; Qwen S221: four hands made a trip in a quarter)
  // at least the longest trip, and the trips shared out among the crew (shorter ones walked while the longest is)
  if (!(total && total > 0 && heads > 1 && jobTrips > 0 && longest > 0)) return factor;
  const least = Math.max(longest, tripHours / heads);
  const most = total / least / (work * heads);
  return most < factor.v ? ex.min('carrying (no faster than its trips)', '1', factor, ex.value(most, '1', `${jobTrips} trip${jobTrips > 1 ? 's' : ''} (the longest ${Math.round(longest * 60)} min) for ${heads} people: ${Math.round(least * 60)} min at least`)) : factor;
}
