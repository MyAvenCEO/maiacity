/**
 * The siting module: criteria grids (cached per state of the land, roads and woods), goal scores,
 * candidate sites and their reasons.
 */
import { defineModule, parseOrThrow, s, type ReadCtx } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import { GoalSchema, SitingGoalSchema, type Candidate, type Goal, type SiteGrid, type SitingPort, type TermScore } from './contract.ts';
import { CELL, computeCriterion, CRITERIA, landOf } from './criteria.ts';


/** the grids of a land state: keyed by the terrain's heights and the woods' trees (both new objects per revision) and the road network's revision */
const cache = new WeakMap<object, WeakMap<object, Map<number, Map<string, SiteGrid>>>>();

function gridsOf(read: ReadCtx): Map<string, SiteGrid> {
  const heights = read.port('terrain').heights();
  const trees = read.port('vegetation').trees();
  const rev = read.port('routing').revision();
  let a = cache.get(heights);
  if (!a) cache.set(heights, (a = new WeakMap()));
  let b = a.get(trees);
  if (!b) a.set(trees, (b = new Map()));
  let c = b.get(rev);
  if (!c) {
    b.clear(); // an older road network is not asked about again
    b.set(rev, (c = new Map()));
  }
  return c;
}

function grid(read: ReadCtx, id: string): SiteGrid {
  const grids = gridsOf(read);
  let g = grids.get(id);
  if (!g) grids.set(id, (g = computeCriterion(landOf(read), id)));
  return g;
}

/** the goal presets of the world's practice: what "a good place" usually means for some purposes (none without the data) */
function presetsOf(read: ReadCtx): Goal[] {
  const data = read.hasData('sitingGoals') ? (read.data('sitingGoals') ?? {}) : {};
  return Object.entries(data).map(([id, g]) => ({ id, label: g.label, ...(g.description ? { description: g.description } : {}), terms: g.terms }));
}

/** a goal given by preset id or as a definition, checked */
function resolveGoal(read: ReadCtx, goal: Goal | string): Goal {
  const presets = presetsOf(read);
  const g = typeof goal === 'string' ? presets.find((x) => x.id === goal) : parseOrThrow(GoalSchema, goal, 'goal');
  if (!g) throw new Error(`siting: no goal preset '${goal as string}' (presets: ${presets.map((x) => x.id).join(', ') || 'none in this world'})`);
  for (const t of g.terms) if (!CRITERIA.some((c) => c.id === t.criterion)) throw new Error(`siting: goal '${g.id}' uses unknown criterion '${t.criterion}' (criteria: ${CRITERIA.map((c) => c.id).join(', ')})`);
  if (!g.terms.length) throw new Error(`siting: goal '${g.id}' has no criteria`);
  return g;
}

function termScore(read: ReadCtx, goal: Goal, k: number): { score: number; ruledOut: boolean; terms: TermScore[] } {
  const terms: TermScore[] = [];
  let lnSum = 0;
  let wSum = 0;
  let ruledOut = false;
  for (const t of goal.terms) {
    const g = grid(read, t.criterion);
    const v = g.values[k]!;
    const c = CRITERIA.find((x) => x.id === t.criterion)!;
    const u = t.best === t.worst ? 1 : Math.max(0, Math.min(1, (v - t.worst) / (t.best - t.worst)));
    const out = t.min !== undefined && v < t.min ? `below ${t.min} ${c.unit}` : t.max !== undefined && v > t.max ? `above ${t.max} ${c.unit}` : undefined;
    if (out) ruledOut = true;
    terms.push({ criterion: t.criterion, label: c.label, value: Math.round(v * 100) / 100, unit: c.unit, utility: Math.round(u * 1000) / 1000, weight: t.weight, ...(out ? { ruledOut: out } : {}) });
    lnSum += t.weight * Math.log(Math.max(0.02, u));
    wSum += t.weight;
  }
  return { score: ruledOut ? 0 : Math.exp(lnSum / wSum), ruledOut, terms };
}

const sitingPort = (read: ReadCtx): SitingPort => {
  const land = () => landOf(read);
  const score = (goal: Goal | string): SiteGrid => {
    const g = resolveGoal(read, goal);
    const L = land();
    const values = new Float32Array(L.nx * L.nz);
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < values.length; k += 1) {
      const t = termScore(read, g, k);
      const v = t.ruledOut ? NaN : t.score;
      values[k] = v;
      if (Number.isFinite(v)) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    return { id: `goal:${g.id}`, label: g.label, unit: '1', x0: L.x0, z0: L.z0, cell: CELL, nx: L.nx, nz: L.nz, values, min, max };
  };
  const at = (L: ReturnType<typeof landOf>, p: Vec2): number => {
    const i = Math.max(0, Math.min(L.nx - 1, Math.floor((p[0] - L.x0) / CELL)));
    const j = Math.max(0, Math.min(L.nz - 1, Math.floor((p[1] - L.z0) / CELL)));
    return j * L.nx + i;
  };
  return {
    criteria: () => CRITERIA,
    goals: () => presetsOf(read),
    goal: (goal) => resolveGoal(read, goal),
    grid: (id) => grid(read, id),
    score,
    candidates(goal, opts = {}) {
      const g = resolveGoal(read, goal);
      const L = land();
      const s = score(g);
      const count = opts.count ?? 5;
      const sep = opts.separation ?? 150;
      const order = [...s.values.keys()].filter((k) => Number.isFinite(s.values[k]!)).sort((a, b) => s.values[b]! - s.values[a]! || a - b);
      const picked: Candidate[] = [];
      for (const k of order) {
        if (picked.length >= count) break;
        const p = L.centre(k % L.nx, Math.floor(k / L.nx));
        if (opts.near && opts.radius !== undefined && Math.hypot(p[0] - opts.near[0], p[1] - opts.near[1]) > opts.radius) continue;
        if (picked.some((c) => Math.hypot(c.at[0] - p[0], c.at[1] - p[1]) < sep)) continue;
        const t = termScore(read, g, k);
        picked.push({ at: p, score: Math.round(t.score * 1000) / 1000, ruledOut: t.ruledOut, terms: t.terms });
      }
      return picked;
    },
    explain(goal, p) {
      const g = resolveGoal(read, goal);
      const L = land();
      const k = at(L, p);
      const t = termScore(read, g, k);
      return { at: L.centre(k % L.nx, Math.floor(k / L.nx)), score: Math.round(t.score * 1000) / 1000, ruledOut: t.ruledOut, terms: t.terms };
    },
  };
};

const summary = (g: SiteGrid) => {
  const finite = [...g.values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const q = (f: number) => (finite.length ? Math.round(finite[Math.min(finite.length - 1, Math.floor(f * finite.length))]! * 100) / 100 : null);
  return { id: g.id, label: g.label, unit: g.unit, cell: g.cell, cells: g.values.length, ruledOut: g.values.length - finite.length, min: q(0), p10: q(0.1), median: q(0.5), p90: q(0.9), max: q(1) };
};

export const sitingModule = defineModule({
  id: 'siting',
  label: 'Scouting for sites',
  provides: ['siting'],
  requires: ['terrain', 'vegetation', 'routing'],
  data: { sitingGoals: s.record(SitingGoalSchema).optional() },
  ports: { siting: sitingPort },
  projections: {
    'siting.criteria': {
      label: 'Site criteria and goal presets',
      compute: (read: ReadCtx) => ({ criteria: CRITERIA, goals: presetsOf(read) }),
    },
    'siting.grid': {
      label: 'A criterion or a goal over the land (summary)',
      description: 'args: criterion (id) or goal (preset id or {id, label, terms})',
      compute: (read: ReadCtx, args: Record<string, unknown>) => {
        const p = read.port('siting');
        return summary(args.criterion !== undefined ? p.grid(String(args.criterion)) : p.score(args.goal as Goal | string));
      },
    },
    'siting.candidates': {
      label: 'The best places for a goal, with their reasons',
      description: 'args: goal (preset id or {id, label, terms}), count?, separation?, near? [x, z], radius?',
      compute: (read: ReadCtx, args: Record<string, unknown>) =>
        read.port('siting').candidates(args.goal as Goal | string, {
          ...(args.count !== undefined ? { count: Number(args.count) } : {}),
          ...(args.separation !== undefined ? { separation: Number(args.separation) } : {}),
          ...(Array.isArray(args.near) ? { near: args.near as Vec2 } : {}),
          ...(args.radius !== undefined ? { radius: Number(args.radius) } : {}),
        }),
    },
  },
});
