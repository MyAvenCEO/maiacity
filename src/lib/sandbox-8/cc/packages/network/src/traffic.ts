/**
 * `traffic` module: accumulates loads per network edge (vehicle passes and ESAL) and rolls
 * them into daily totals and 30-day averages at midnight. Sources are explicit commands
 * (`traffic.record`, e.g. logistics trips) plus any module contributing to the
 * `traffic-sources` extension point (background traffic, residents, haul cycles).
 */
import { command, DAY, defineModule, s, type EntityId, type WriteCtx } from '../../kernel/src/index.ts';
import type { EdgeTraffic, TrafficPort } from './contract.ts';

/** Days kept in `recent` and the EWMA horizon (α = 1/30 once 30 days are observed). */
export const TRAFFIC_WINDOW_DAYS = 30;

export const EdgeTrafficSchema = s.object({
  vehToday: s.number({ min: 0, unit: 'veh' }),
  esalToday: s.number({ min: 0, unit: 'esal' }),
  vehPerDay: s.number({ min: 0, unit: 'veh/d' }),
  esalPerDay: s.number({ min: 0, unit: 'esal/d' }),
  totalVeh: s.number({ min: 0, unit: 'veh' }),
  totalEsal: s.number({ min: 0, unit: 'esal' }),
  recent: s.array(s.object({ veh: s.number({ min: 0 }), esal: s.number({ min: 0 }) })),
});

const empty = (): EdgeTraffic => ({ vehToday: 0, esalToday: 0, vehPerDay: 0, esalPerDay: 0, totalVeh: 0, totalEsal: 0, recent: [] });

function record(ctx: WriteCtx, edges: readonly EntityId[], vehicles: number, esalPerVehicle: number): void {
  if (!(vehicles > 0)) return;
  const esal = vehicles * Math.max(0, esalPerVehicle);
  for (const id of edges) {
    // edges removed since the trip started are skipped silently
    if (!ctx.has('NetEdge', id)) continue;
    const t = ctx.get('EdgeTraffic', id) ?? empty();
    ctx.set('EdgeTraffic', id, {
      ...t,
      vehToday: t.vehToday + vehicles,
      esalToday: t.esalToday + esal,
      totalVeh: t.totalVeh + vehicles,
      totalEsal: t.totalEsal + esal,
    });
  }
}

export const trafficModule = defineModule({
  id: 'traffic',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['NetEdge'],
  commandDocs: {
    "traffic.record": {
      internal: true,
    }
  },
  label: 'Traffic loads',
  description: 'Vehicle passes and ESAL per network edge: today, last 30 days, 30-day average.',
  provides: ['traffic'],
  requires: ['routing'],
  components: { EdgeTraffic: EdgeTrafficSchema },
  commands: {
    'traffic.record': command(
      s.object({ edges: s.array(s.ref('net-edge')), vehicles: s.number({ min: 0 }), esalPerVehicle: s.number({ min: 0 }), kind: s.string() }),
      (ctx, p) => {
        record(ctx, p.edges, p.vehicles, p.esalPerVehicle);
      },
      'Record traffic on edges',
    ),
  },
  systems: [
    {
      id: 'rollover',
      every: DAY,
      offset: 0,
      phase: 'accounting',
      run: (ctx) => {
        // t = 0 is the start of the first day: nothing to close yet
        if (ctx.now <= 0) return;
        for (const c of ctx.contributions('traffic-sources')) {
          for (const trip of c.impl.dailyTrips()) record(ctx, trip.edges, trip.vehicles, trip.esalPerVehicle);
        }
        const rows = [...ctx.all('EdgeTraffic')];
        for (const [id, t] of rows) {
          const recent = [...t.recent, { veh: t.vehToday, esal: t.esalToday }].slice(-TRAFFIC_WINDOW_DAYS);
          // warm-up: plain mean until the window is full, then EWMA with α = 1/30
          const alpha = 1 / Math.min(recent.length, TRAFFIC_WINDOW_DAYS);
          ctx.set('EdgeTraffic', id, {
            ...t,
            vehPerDay: t.vehPerDay + alpha * (t.vehToday - t.vehPerDay),
            esalPerDay: t.esalPerDay + alpha * (t.esalToday - t.esalPerDay),
            vehToday: 0,
            esalToday: 0,
            recent,
          });
        }
      },
    },
  ],
  ports: {
    traffic: (ctx): TrafficPort => ({ edge: (id) => ctx.get('EdgeTraffic', id) }),
  },
  projections: {
    'traffic.edges': {
      label: 'Traffic per edge',
      compute: (ctx) => [...ctx.all('EdgeTraffic')].map(([id, t]) => ({ id, ...t })),
    },
  },
});
