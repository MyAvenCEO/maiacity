/**
 * The construction cycle (decision 0015): how busy the construction industry is against its
 * normal level, month by month: booms and busts. It moves the price index and the firms' order
 * books (how far out they can start, what they charge). Two implementations: a stochastic model
 * (a persistent random walk around normal on the log level, fitted to a recorded series), and a
 * recorded series (a dataset bound by the world definition, e.g. Eurostat production in
 * construction). Only the months up to now are known: the coming months are drawn (or read) when
 * they begin, so neither a player nor an agent can see where the cycle goes.
 */
import { DAY, defineModule, ex, s, type Explained, type Infer, type ModelDescriptor, type Provenance, type ReadCtx, type Source, type WriteCtx } from '../../kernel/src/index.ts';

/** the stochastic cycle: an AR(1) process on the log of the level */
export const CycleModelSchema = s.object({
  /** a known level (1 = normal) and its month 'YYYY-MM': the cycle at the epoch is drawn from here */
  start: s.param('1'),
  startMonth: s.string(),
  /** month-to-month persistence of the log level (1: never returns to normal) */
  persistence: s.param('1'),
  /** month-to-month shock: σ of the log level's change */
  shock: s.param('1'),
});
export type CycleModel = Infer<typeof CycleModelSchema>;

/** a recorded activity index: monthly values and the value that counts as normal */
export const CycleSeriesSchema = s.object({
  id: s.string(),
  label: s.string(),
  source: s.any<Source>(),
  normal: s.number({ min: 0 }),
  normalNote: s.string().optional(),
  /** season factors of the unadjusted series, January … December (not used by the cycle itself) */
  season: s.array(s.number({ min: 0 })).optional(),
  months: s.record(s.number({ min: 0 })),
});
export type CycleSeries = Infer<typeof CycleSeriesSchema>;

export const CycleBindingSchema = s.object({
  dataset: s.string(),
  /** a month the record does not have: continue with the model (marked) or fail */
  gap: s.object({ policy: s.enum(['fallback', 'fail']) }),
});

export interface CycleMonth {
  /** 'YYYY-MM' */
  month: string;
  /** construction activity against normal (1); a boom above, a bust below */
  level: number;
  provenance: Provenance;
}

/** the construction-cycle contract */
export interface ConstructionCyclePort {
  /** this month */
  current(): CycleMonth & { explain: Explained };
  /** the months so far, oldest first (the last `months` of them) */
  history(months?: number): CycleMonth[];
}

/** the months drawn or read so far; never a month after now */
export interface CycleState {
  months: Record<string, { level: number; provenance: Provenance }>;
}

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    constructionCycle: ConstructionCyclePort;
  }
  interface DataTypes {
    constructionCycleModel?: CycleModel;
    cycleSeries?: Record<string, CycleSeries>;
    cycleBinding?: Infer<typeof CycleBindingSchema>;
  }
  interface ModuleStateTypes {
    'cycle-model': CycleState;
    'cycle-recorded': CycleState;
  }
}

const monthOf = (read: ReadCtx, t: number) => {
  const c = read.calendar.at(t);
  return `${c.year}-${String(c.month).padStart(2, '0')}`;
};
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

/** one month on: the log level returns towards normal by the persistence, plus a shock */
function step(ctx: WriteCtx, model: CycleModel, prev: number): number {
  return Math.exp(model.persistence.value * Math.log(prev) + model.shock.value * ctx.rng('cycle').normal(0, 1));
}

/** `k` months on from a known level, in one draw (the AR(1) k-step distribution) */
function stepMany(ctx: WriteCtx, model: CycleModel, from: number, k: number): number {
  const rho = model.persistence.value;
  const sd = model.shock.value * Math.sqrt(rho >= 1 ? k : (1 - rho ** (2 * k)) / (1 - rho * rho));
  return Math.exp(rho ** k * Math.log(from) + sd * ctx.rng('cycle').normal(0, 1));
}

function readPort(read: ReadCtx, module: 'cycle-model' | 'cycle-recorded', explainOf: (m: CycleMonth) => Explained): ConstructionCyclePort {
  const list = () =>
    Object.entries(read.state(module).months)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, v]) => ({ month, level: v.level, provenance: v.provenance }));
  return {
    // read on every price: this month directly (the month just begun, before it is drawn: the last one)
    current: () => {
      const months = read.state(module).months;
      const key = monthOf(read, read.now);
      const v = months[key];
      const m = v ? { month: key, level: v.level, provenance: v.provenance } : list().at(-1);
      if (!m) throw new Error(`${module}: no month yet`);
      return { ...m, explain: explainOf(m) };
    },
    history: (months) => (months === undefined ? list() : list().slice(-months)),
  };
}

// ------------------------------------------------------------------ the stochastic model

export const CYCLE_MODEL: ModelDescriptor = {
  contract: 'constructionCycle',
  implementation: 'ar1',
  kind: 'model',
  label: 'Construction activity as a persistent random walk around normal (AR(1) on the log level, fitted to a recorded index)',
  validity: { ranges: { level: [0.6, 1.5] }, notes: 'Irregular booms and busts with the persistence and size of the fitted record; no shocks beyond it (a war, a pandemic), no regular period.' },
  resolution: 'monthly',
  confidence: 'low',
  sources: [{ title: 'economy pack: constructionCycleModel' }],
};

const modelProvenance = (note?: string): Provenance => ({ kind: 'model', source: 'ar1', confidence: 'low', ...(note ? { note } : {}) });

function setMonth(ctx: WriteCtx, module: 'cycle-model' | 'cycle-recorded', month: string, level: number, provenance: Provenance): void {
  ctx.patchState(module, { months: { ...ctx.state(module).months, [month]: { level: Math.round(level * 10000) / 10000, provenance } } });
  if (level < 0.6 || level > 1.5) ctx.outsideValidity('constructionCycle', `activity at ${level.toFixed(2)} of normal, outside the fitted range`);
}

export const cycleModelModule = defineModule({
  id: 'cycle-model',
  label: 'Construction cycle (stochastic)',
  provides: ['constructionCycle'],
  data: { constructionCycleModel: CycleModelSchema.optional() },
  models: [CYCLE_MODEL],
  state: { initial: (): CycleState => ({ months: {} }) },
  setup(ctx) {
    const model = ctx.data('constructionCycleModel');
    if (!model) throw new Error('constructionCycle (stochastic): the world has no constructionCycleModel data');
    const month = monthOf(ctx, ctx.now);
    const k = monthIndex(month) - monthIndex(model.startMonth);
    // the epoch lies k months after the last known level: what happened since is drawn
    setMonth(ctx, 'cycle-model', month, k > 0 ? stepMany(ctx, model, model.start.value, k) : model.start.value, modelProvenance(k > 0 ? `drawn ${k} months on from ${model.startMonth}` : undefined));
  },
  systems: [
    {
      id: 'next-month',
      every: DAY,
      phase: 'environment',
      run(ctx) {
        const month = monthOf(ctx, ctx.now);
        const months = ctx.state('cycle-model').months;
        if (months[month]) return;
        const prev = Object.keys(months).sort().at(-1)!;
        setMonth(ctx, 'cycle-model', month, step(ctx, ctx.data('constructionCycleModel')!, months[prev]!.level), modelProvenance());
      },
    },
  ],
  ports: {
    constructionCycle: (read: ReadCtx) =>
      readPort(read, 'cycle-model', (m) => {
        const model = read.data('constructionCycleModel')!;
        return ex.value(m.level, '1', `construction activity in ${m.month} against normal (drawn: persistence ${model.persistence.value}/month, shock σ ${model.shock.value})`, model.persistence.source);
      }),
  },
});

// ------------------------------------------------------------------ a recorded series

export const CYCLE_RECORDED: ModelDescriptor = {
  contract: 'constructionCycle',
  implementation: 'recorded',
  kind: 'measured',
  label: 'Construction activity from a recorded monthly index (e.g. production in construction), against its normal level',
  validity: { notes: "The record's months only; beyond them the binding's gap policy decides (the model, marked, or fail)." },
  resolution: 'monthly',
  confidence: 'medium',
  sources: [{ title: 'world definition: the bound dataset' }],
};

export const cycleRecordedModule = defineModule({
  id: 'cycle-recorded',
  label: 'Construction cycle (recorded)',
  provides: ['constructionCycle'],
  data: { cycleSeries: s.record(CycleSeriesSchema).optional(), cycleBinding: CycleBindingSchema.optional(), constructionCycleModel: CycleModelSchema.optional() },
  models: [CYCLE_RECORDED],
  state: { initial: (): CycleState => ({ months: {} }) },
  setup(ctx) {
    recordMonth(ctx);
  },
  systems: [{ id: 'next-month', every: DAY, phase: 'environment', run: (ctx) => recordMonth(ctx) }],
  ports: {
    constructionCycle: (read: ReadCtx) =>
      readPort(read, 'cycle-recorded', (m) => {
        const series = seriesOf(read);
        const v = series.months[m.month];
        return v === undefined ? ex.value(m.level, '1', `construction activity in ${m.month}: not in ${series.label}, ${m.provenance.note ?? 'drawn'}`) : ex.div(`construction activity in ${m.month} against normal`, '1', ex.value(v, '1', `${series.label}, ${m.month}`, series.source), ex.value(series.normal, '1', series.normalNote ?? 'normal level', series.source));
      }),
  },
});

function seriesOf(read: ReadCtx): CycleSeries {
  const b = read.data('cycleBinding');
  const series = b ? read.data('cycleSeries')?.[b.dataset] : undefined;
  if (!b || !series) throw new Error('constructionCycle (recorded): the world binds no cycle series');
  return series;
}

function recordMonth(ctx: WriteCtx): void {
  const month = monthOf(ctx, ctx.now);
  const st = ctx.state('cycle-recorded');
  if (st.months[month]) return;
  const series = seriesOf(ctx);
  const v = series.months[month];
  if (v !== undefined) return setMonth(ctx, 'cycle-recorded', month, v / series.normal, { kind: 'measured', source: series.id, confidence: 'medium' });
  // a month the record does not have
  const binding = ctx.data('cycleBinding')!;
  if (binding.gap.policy === 'fail') throw new Error(`constructionCycle: ${series.label} has no value for ${month}`);
  const model = ctx.data('constructionCycleModel');
  if (!model) throw new Error(`constructionCycle: ${series.label} has no value for ${month}, and the world has no constructionCycleModel to fall back on`);
  const prev = Object.keys(st.months).sort().at(-1);
  const last = Object.keys(series.months).sort().at(-1)!;
  const note = `fallback: ${series.label} ends ${last}`;
  if (prev) return setMonth(ctx, 'cycle-recorded', month, step(ctx, model, st.months[prev]!.level), modelProvenance(note));
  // the world begins after the record: from its last month, drawn on
  const k = monthIndex(month) - monthIndex(last);
  if (k <= 0) throw new Error(`constructionCycle: ${series.label} has no value for ${month}`);
  setMonth(ctx, 'cycle-recorded', month, stepMany(ctx, model, series.months[last]! / series.normal, k), modelProvenance(note));
}
