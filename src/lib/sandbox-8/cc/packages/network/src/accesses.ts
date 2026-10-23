/**
 * The ways into the map (decision 0025): a world is reached by 0..n accesses of any mode — a
 * public road, a farm track, a footpath, a railway, a river — each entering at the map's edge and
 * running some way in. Outside the map it goes on for a distance to the places beyond (a town,
 * its suppliers). The region's data say which there are; this module lays them down at the
 * world's start. What can use one follows from the vehicle profiles: only those that list its
 * surface (a van has no speed on a footpath).
 */
import { defineModule, s, type ReadCtx } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type {} from '../../terrain/src/index.ts';
import { AccessSchema, TransitFareSchema, TransitLineSchema, type ResolvedAccess, type TimetableDay } from './contract.ts';

/** keep an access this far from a creek, so a road does not start in the channel (m) */
const CLEAR_OF_WATER = 25;

function distToPolyline(p: Vec2, pts: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (az + t * dz)));
  }
  return best;
}

/** where an access enters: the point on its side at its offset, moved along the edge clear of creeks */
export function entryPoint(read: ReadCtx, side: 'west' | 'east' | 'north' | 'south', offset: number): { point: Vec2; inward: Vec2 } {
  const t = read.port('terrain');
  const b = t.bounds;
  const along = side === 'west' || side === 'east' ? b.z1 - b.z0 : b.x1 - b.x0;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const at = (off: number): { point: Vec2; inward: Vec2 } => {
    const o = clamp(off, -0.5, 0.5) * along;
    switch (side) {
      case 'west':
        return { point: [b.x0, clamp(o, b.z0, b.z1)], inward: [1, 0] };
      case 'east':
        return { point: [b.x1, clamp(o, b.z0, b.z1)], inward: [-1, 0] };
      case 'north':
        return { point: [clamp(o, b.x0, b.x1), b.z0], inward: [0, 1] };
      case 'south':
        return { point: [clamp(o, b.x0, b.x1), b.z1], inward: [0, -1] };
    }
  };
  const creeks = t.waterBodies().filter((w) => w.kind === 'creek');
  const clear = (p: Vec2) => creeks.every((c) => distToPolyline(p, c.points) > CLEAR_OF_WATER);
  const first = at(offset);
  if (clear(first.point)) return first;
  // search outward along the edge in 8 m steps (up to ±25 % of the side)
  for (let k = 1; k <= Math.ceil((0.25 * along) / 8); k += 1) {
    for (const a of [at(offset + (k * 8) / along), at(offset - (k * 8) / along)]) if (clear(a.point)) return a;
  }
  return first;
}

/** the accesses of the world, laid down (by id) */
export const accessesOf = (read: ReadCtx): ResolvedAccess[] => Object.entries(read.state('accesses').built).sort(([a], [b]) => a.localeCompare(b)).map(([, a]) => a);

/** the bus and train lines that stop on this map (at a way in that is laid down): none, no pass is of use here (one fact for every reader) */
export const linesHere = (read: ReadCtx): string[] => {
  const lines = read.hasData('transitLines') ? (read.data('transitLines') ?? {}) : {};
  const built = read.state('accesses').built;
  return Object.entries(lines).filter(([, l]) => built[l.access] !== undefined).map(([id]) => id).sort();
};

/**
 * the kind of day the timetables run on the day of t: a public holiday's when it is one, else its weekday's, as the
 * practice has it (`networkSettings.timetableDays`); none: no departures that day (one fact for every reader)
 */
export const timetableDay = (read: ReadCtx, t: number, holiday: boolean): TimetableDay | undefined => {
  const kinds = read.data('networkSettings').timetableDays;
  return holiday ? kinds.holiday : kinds.week[read.calendar.at(t).weekday];
};

/** the first access of a mode, or of any mode in the order given */
export const accessOf = (read: ReadCtx, ...modes: ResolvedAccess['mode'][]): ResolvedAccess | undefined => {
  const all = accessesOf(read);
  for (const m of modes) {
    const a = all.find((x) => x.mode === m);
    if (a) return a;
  }
  return modes.length ? undefined : all[0];
};

export const accessesModule = defineModule({
  id: 'accesses',
  label: 'Ways into the map',
  description: 'The roads, tracks, footpaths, railways and rivers by which a world is reached (0..n), laid down at the start from the region data.',
  requires: ['terrain', 'routing'],
  data: { accesses: s.record(AccessSchema).optional(), transitLines: s.record(TransitLineSchema).optional(), transitFares: s.record(TransitFareSchema).optional() },
  state: { initial: () => ({ built: {} }) },
  setup(ctx) {
    const built: Record<string, ResolvedAccess> = {};
    for (const [id, a] of Object.entries(ctx.data('accesses') ?? {}).sort(([x], [y]) => x.localeCompare(y))) {
      const { point, inward } = entryPoint(ctx, a.side, a.offset);
      const node = ctx.command('network.addNode', { pos: point, external: { label: a.label, distanceKm: a.externalDistance.value, surface: a.outside } });
      if (!node.ok) throw new Error(`access ${id}: ${node.reasons.map((r) => ctx.formatBlocker(r)).join('; ')}`);
      // on the map it runs inwards, following the terrain gently
      const pts: Vec2[] = [];
      const along = (d: number): Vec2 => [point[0] + inward[0] * d, point[1] + inward[1] * d];
      for (let d = 0; d <= a.length.value + 1e-6; d += 20) pts.push(along(d));
      if (a.length.value - (pts.length - 1) * 20 > 1) pts.push(along(a.length.value));
      const line = ctx.command('network.addPolyline', { points: pts, open: true, surface: a.surface, width: a.width.value, speedLimit: a.speedLimit.value, label: a.label });
      if (!line.ok) throw new Error(`access ${id}: ${line.reasons.map((r) => ctx.formatBlocker(r)).join('; ')}`);
      built[id] = { id, label: a.label, mode: a.mode, point, inward, end: pts[pts.length - 1]!, points: pts, node: node.value, edges: line.value.edges, width: a.width.value };
    }
    ctx.setState('accesses', { built });
  },
  projections: {
    'accesses.list': {
      label: 'The ways into the map: mode, where they enter, how far to the places beyond',
      compute: (read: ReadCtx) => accessesOf(read).map((a) => ({ id: a.id, label: a.label, mode: a.mode, point: a.point, end: a.end, distanceKm: read.get('NetNode', a.node)?.external?.distanceKm })),
    },
  },
});
