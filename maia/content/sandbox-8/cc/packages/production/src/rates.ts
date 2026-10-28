/**
 * Production-rate models.
 *
 * Every activity's hourly output is the minimum of its rate components (the bottleneck —
 * an excavator cannot dig faster than its trucks carry away), times job efficiency, break
 * allowance, operator skill and environmental factors. All results are Explained traces
 * whose leaves cite the data pack, so the UI can show *why* a section takes 3.4 days.
 *
 * Earth volumes: loading/haul components work in BANK m³ (in-situ). Conversion to the
 * activity's measure uses the soil class at the work front:
 *   loose = bank × swellFactor,  compacted = bank × compactionFactor.
 */
import { convert, ex, type Explained, type ReadCtx } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type { MachineModel } from '../../equipment/src/index.ts';
import type { SoilClass } from '../../terrain/src/index.ts';
import type { Activity, FlexQuantity, RateComponent } from './contract.ts';

export interface RateResources {
  machines: { role: string; model: MachineModel; modelId: string }[];
  /** skill factors of the people operating machines of each role */
  operatorSkill: Record<string, number>;
  /** mean skill of the crew (non-operators) */
  crewSkill: number;
}

export interface RateContext {
  activity: Activity;
  activityId: string;
  pos: Vec2;
  params: Record<string, number>;
  haulTo?: Vec2;
  soil: SoilClass;
  soilId: string;
}

/**
 * How the trucks of a haul drive and unload (decision 0026 A2): from the carriers, the same
 * numbers a delivery uses, so a haul cycle and a lorry's run cannot disagree.
 */
export interface Haulage {
  /** seconds to drive from → to for a carrier class empty (null: no route) */
  travel(from: Vec2, to: Vec2, carrier: string): number | null;
  /** its pace loaded, as a share of empty (1 when not stated) */
  loadedPace(carrier: string): number;
  /** seconds it takes to unload `tonnes` itself */
  unload(carrier: string, tonnes: number): number;
}

export interface RateResult {
  rate: Explained;
  /** label of the limiting component */
  limiting: string;
}

const perHourUnit = (activity: Activity) => `${activity.unit}/h`;

/** Convert a data quantity (any unit of compatible dimension) into `to`. */
export function flexTo(q: FlexQuantity, to: string, what: string): number {
  try {
    return convert(q.value, q.unit, to);
  } catch (e) {
    throw new Error(`${what}: ${(e as Error).message}`);
  }
}

const flexLeaf = (q: FlexQuantity, to: string, label: string): Explained => ex.value(flexTo(q, to, label), to, label, q.source, q.note);

/**
 * Bulk-material mode: aggregates (frost layer, base course) are measured compacted and handled
 * loose. With params.density (compacted t/m³) and params.looseDensity (t/m³), "bank" volumes
 * of the earthworks components are read as *compacted* volumes and swell = density/looseDensity.
 */
function materialMode(ctx: RateContext): { density: number; swell: number } | null {
  const d = ctx.params.density;
  if (ctx.activity.measure !== 'none' || d === undefined) return null;
  const loose = ctx.params.looseDensity ?? d / 1.3;
  return { density: d, swell: d / loose };
}

/** factor converting bank m³ into the activity's measure */
function bankToMeasure(ctx: RateContext): Explained {
  if (materialMode(ctx)) return ex.value(1, '', 'compacted measure');
  const m = ctx.activity.measure;
  if (m === 'loose') return ex.param(ctx.soil.swellFactor, `swell factor (${ctx.soil.label})`);
  if (m === 'compacted') return ex.param(ctx.soil.compactionFactor, `compaction factor (${ctx.soil.label})`);
  return ex.value(1, '', 'bank measure');
}

/** factor converting compacted m³ into the activity's measure */
function compactedToMeasure(ctx: RateContext): Explained {
  const m = ctx.activity.measure;
  if (m === 'bank') return ex.div(`compacted → bank (${ctx.soil.label})`, '', ex.value(1, ''), ex.param(ctx.soil.compactionFactor, 'compaction factor'));
  if (m === 'loose') return ex.div(`compacted → loose (${ctx.soil.label})`, '', ex.param(ctx.soil.swellFactor, 'swell factor'), ex.param(ctx.soil.compactionFactor, 'compaction factor'));
  return ex.value(1, '', 'compacted measure');
}

function machinesOf(res: RateResources, role: string) {
  return res.machines.filter((m) => m.role === role);
}

function loadingRateBank(c: Extract<RateComponent, { kind: 'loading' }>, ctx: RateContext, res: RateResources): Explained {
  const ms = machinesOf(res, c.role);
  const cycle = (materialMode(ctx) ? c.cycleTime.easy : c.cycleTime[ctx.soil.excavation]) ?? c.cycleTime.medium;
  if (!cycle) throw new Error(`loading component of ${ctx.activityId}: no cycle time for ${ctx.soil.excavation}`);
  const mm = materialMode(ctx);
  const swell = mm ? ex.value(mm.swell, '', 'loose → compacted (material densities)') : ex.param(ctx.soil.swellFactor, `swell (${ctx.soil.label})`);
  const per = ms.map((m) => {
    const bucket = m.model.bucket;
    if (!bucket) throw new Error(`machine model ${m.modelId} (role ${c.role}) has no bucket size`);
    return ex.mul(`${m.model.label}`, 'm3/h', ex.param(bucket, 'bucket (heaped)'), ex.param(c.fillFactor, 'bucket fill factor'), ex.div('1/swell', '', ex.value(1, ''), swell), ex.div('cycles per hour', '1/h', ex.value(3600, 's/h'), ex.param(cycle, mm ? 'cycle time (loading stockpiled material)' : `cycle time (${ctx.soil.excavation} digging)`)));
  });
  return ex.sum(`${c.label ?? 'loading'} (bank)`, 'm3/h', ...per);
}

function component(c: RateComponent, ctx: RateContext, res: RateResources, haulage: Haulage): Explained {
  const unitH = perHourUnit(ctx.activity);
  switch (c.kind) {
    case 'crew': {
      return ex.mul(c.label ?? 'crew output', unitH, flexLeaf(c.output, unitH, 'crew output'), ex.value(res.crewSkill, '', 'crew skill'));
    }
    case 'perMachine': {
      const ms = machinesOf(res, c.role);
      const per = ms.map((m) => {
        let scale = 1;
        if (c.scaleBy !== 'none') {
          const attr =
            c.scaleBy === 'enginePower' ? m.model.engine?.power.value : c.scaleBy === 'workingWidth' ? m.model.workingWidth?.value : c.scaleBy === 'bucket' ? m.model.bucket?.value : c.scaleBy === 'payload' ? m.model.payload?.value : m.model.operatingWeight.value;
          if (attr === undefined) throw new Error(`machine ${m.modelId} lacks ${c.scaleBy} for ${ctx.activityId}`);
          scale = attr / (c.reference ?? attr);
        }
        return ex.mul(m.model.label, unitH, flexLeaf(c.output, unitH, `${c.label ?? 'output'} (reference machine)`), ex.value(scale, '', `size scale (${c.scaleBy})`), ex.value(res.operatorSkill[c.role] ?? 1, '', 'operator skill'));
      });
      return ex.sum(c.label ?? `${c.role} output`, unitH, ...per);
    }
    case 'loading': {
      const bank = loadingRateBank(c, ctx, res);
      const skill = ex.value(res.operatorSkill[c.role] ?? 1, '', 'operator skill');
      return ex.mul(c.label ?? 'loading', unitH, bank, skill, bankToMeasure(ctx));
    }
    case 'haul': {
      if (!ctx.haulTo) return ex.value(Number.POSITIVE_INFINITY, unitH, 'no haul (material stays at work front)');
      const loaderComp = ctx.activity.rate.find((r) => r.kind === 'loading' && r.role === c.loadingRole) as Extract<RateComponent, { kind: 'loading' }> | undefined;
      const loaderRate = loaderComp ? loadingRateBank(loaderComp, ctx, res).v * (res.operatorSkill[c.loadingRole] ?? 1) : 0;
      const trucks = machinesOf(res, c.role);
      if (trucks.length === 0) return ex.value(0, unitH, 'no trucks');
      let shortest = Number.POSITIVE_INFINITY;
      const per = trucks.map((t) => {
        const payloadT = t.model.payload?.value ?? 0;
        const payloadV = t.model.payloadVolume?.value ?? Number.POSITIVE_INFINITY;
        const mm = materialMode(ctx);
        const density = mm ? mm.density : ctx.soil.bulkDensity.value;
        const swellF = mm ? mm.swell : ctx.soil.swellFactor.value;
        const byMass = payloadT / density;
        const byVolume = payloadV / swellF;
        const payloadBank = ex.min(mm ? 'payload (compacted m³)' : 'payload (bank m³)', 'm3', ex.value(byMass, 'm3', `payload ${payloadT} t ÷ density ${density} t/m³`), ex.value(byVolume, 'm3', `body ${Number.isFinite(payloadV) ? payloadV : '∞'} m³ loose ÷ swell`));
        const loadS = loaderRate > 0 ? (payloadBank.v / loaderRate) * 3600 : 0;
        const carrier = t.model.transport?.vehicleProfile ?? 'van';
        const travel = haulage.travel(ctx.pos, ctx.haulTo!, carrier) ?? Number.POSITIVE_INFINITY;
        const pace = haulage.loadedPace(carrier);
        const cycle = ex.sum('cycle time', 's', ex.value(loadS, 's', 'loading'), ex.value(travel / pace, 's', `travel loaded (${Math.round(pace * 100)} % pace)`), ex.value(haulage.unload(carrier, payloadBank.v * density), 's', 'unloading (the carrier: tipping)'), ex.value(travel, 's', 'travel empty'), ex.param(c.manoeuvreTime, 'manoeuvring/queuing'));
        shortest = Math.min(shortest, cycle.v);
        return ex.mul(t.model.label, 'm3/h', payloadBank, ex.div('cycles/h', '1/h', ex.value(3600, 's/h'), cycle));
      });
      const haul = ex.mul(c.label ?? 'haul capacity', unitH, ex.sum('trucks (bank)', 'm3/h', ...per), bankToMeasure(ctx));
      // (a move smaller than the fleet takes at once still takes a whole cycle: a part load is a trip)
      const total = ctx.params.total;
      return total !== undefined && total > 0 && Number.isFinite(shortest) && shortest > 0 ? ex.min('haul capacity (a load a whole cycle at least)', unitH, haul, ex.value(total / (shortest / 3600), unitH, 'the whole move in one truck cycle')) : haul;
    }
    case 'compaction': {
      const ms = machinesOf(res, c.role);
      const thickness = ctx.params.layerThickness;
      const per = ms.map((m) => {
        const width = m.model.workingWidth?.value;
        if (!width) throw new Error(`roller ${m.modelId} has no workingWidth`);
        const area = ex.mul('area rate', 'm2/h', ex.convert(ex.param(c.speed, 'rolling speed'), 'm/h'), ex.sub('effective width', 'm', ex.value(width, 'm', 'drum width'), ex.param(c.overlap, 'overlap')), ex.div('1/passes', '', ex.value(1, ''), ex.param(c.passes, 'passes')), ex.value(res.operatorSkill[c.role] ?? 1, '', 'operator skill'));
        return area;
      });
      const area = ex.sum(c.label ?? 'compaction (area)', 'm2/h', ...per);
      if (ctx.activity.unit === 'm2') return area;
      if (thickness === undefined) throw new Error(`${ctx.activityId}: compaction in ${ctx.activity.unit} needs params.layerThickness`);
      return ex.mul(c.label ?? 'compaction', unitH, area, ex.value(thickness, 'm', 'layer thickness'), compactedToMeasure(ctx));
    }
    case 'grading': {
      const ms = machinesOf(res, c.role);
      const per = ms.map((m) => {
        const width = m.model.workingWidth?.value;
        if (!width) throw new Error(`machine ${m.modelId} has no workingWidth`);
        return ex.mul(m.model.label, 'm2/h', ex.convert(ex.param(c.speed, 'working speed'), 'm/h'), ex.value(width, 'm', 'blade width'), ex.param(c.effectiveWidth, 'effective width share'), ex.div('1/passes', '', ex.value(1, ''), ex.param(c.passes, 'passes')), ex.value(res.operatorSkill[c.role] ?? 1, '', 'operator skill'));
      });
      const area = ex.sum(c.label ?? 'grading (area)', 'm2/h', ...per);
      if (ctx.activity.unit === 'm2') return area;
      if (ctx.activity.unit === 'm') {
        const width = ctx.params.width;
        if (!width) throw new Error(`${ctx.activityId}: grading in m needs params.width`);
        return ex.div(c.label ?? 'grading', unitH, area, ex.value(width, 'm', 'section width'));
      }
      const thickness = ctx.params.layerThickness;
      if (thickness === undefined) throw new Error(`${ctx.activityId}: grading in ${ctx.activity.unit} needs params.layerThickness`);
      return ex.mul(c.label ?? 'spreading', unitH, area, ex.value(thickness, 'm', 'layer thickness'), compactedToMeasure(ctx));
    }
    case 'paving': {
      const ms = machinesOf(res, c.role);
      const thickness = ctx.params.layerThickness;
      const density = ctx.params.density ?? 2.4;
      if (thickness === undefined) throw new Error(`${ctx.activityId}: paving needs params.layerThickness`);
      const per = ms.map((m) => {
        const width = ctx.params.width ?? m.model.workingWidth?.value;
        if (!width) throw new Error(`paver ${m.modelId} has no workingWidth`);
        return ex.mul(m.model.label, 't/h', ex.convert(ex.param(c.speed, 'paving speed'), 'm/h'), ex.value(width, 'm', 'paving width'), ex.value(thickness, 'm', 'layer thickness'), ex.value(density, 't/m3', 'compacted density'));
      });
      const screed = ex.sum('screed capacity', 't/h', ...per);
      const t = ex.min(c.label ?? 'paving', 't/h', screed, ex.param(c.supply, 'mixing-plant supply'));
      return ctx.activity.unit === 't' ? t : ex.convert(t, unitH);
    }
  }
}

/** Hourly output of an activity with given resources, before environmental factors. */
/**
 * The haul as loads (design/physical-state.md I5, flows): the shortest truck cycle (s) and what its trucks take in one
 * (in the activity's unit), all of them; undefined without a haul or trucks.
 */
export function haulCycle(ctx: RateContext, res: RateResources, haulage: Haulage): { cycle: number; perLoad: number } | undefined {
  const c = ctx.activity.rate.find((r) => r.kind === 'haul') as Extract<RateComponent, { kind: 'haul' }> | undefined;
  if (!c || !ctx.haulTo) return undefined;
  const trucks = machinesOf(res, c.role);
  if (!trucks.length) return undefined;
  const loaderComp = ctx.activity.rate.find((r) => r.kind === 'loading' && r.role === c.loadingRole) as Extract<RateComponent, { kind: 'loading' }> | undefined;
  const loaderRate = loaderComp ? loadingRateBank(loaderComp, ctx, res).v * (res.operatorSkill[c.loadingRole] ?? 1) : 0;
  const mm = materialMode(ctx);
  const density = mm ? mm.density : ctx.soil.bulkDensity.value;
  const swellF = mm ? mm.swell : ctx.soil.swellFactor.value;
  let shortest = Number.POSITIVE_INFINITY;
  let bank = 0;
  for (const t of trucks) {
    const payloadBank = Math.min((t.model.payload?.value ?? 0) / density, (t.model.payloadVolume?.value ?? Number.POSITIVE_INFINITY) / swellF);
    const carrier = t.model.transport?.vehicleProfile ?? 'van';
    const travel = haulage.travel(ctx.pos, ctx.haulTo, carrier) ?? Number.POSITIVE_INFINITY;
    const loadS = loaderRate > 0 ? (payloadBank / loaderRate) * 3600 : 0;
    shortest = Math.min(shortest, loadS + travel / haulage.loadedPace(carrier) + haulage.unload(carrier, payloadBank * density) + travel + c.manoeuvreTime.value);
    bank += payloadBank;
  }
  // (every truck brings its load each cycle: r37, not one truck's)
  const perLoad = bank * bankToMeasure(ctx).v;
  return Number.isFinite(shortest) && shortest > 0 && perLoad > 0 ? { cycle: shortest, perLoad } : undefined;
}

export function baseRate(ctx: RateContext, res: RateResources, haulage: Haulage): RateResult {
  const unitH = perHourUnit(ctx.activity);
  const comps = ctx.activity.rate.map((c) => ({ c, e: component(c, ctx, res, haulage) }));
  if (comps.length === 0) throw new Error(`activity ${ctx.activityId} has no rate components`);
  let limiting = comps[0]!;
  for (const x of comps) if (x.e.v < limiting.e.v) limiting = x;
  const bottleneck = comps.length === 1 ? comps[0]!.e : ex.min('bottleneck', unitH, ...comps.map((x) => x.e));
  const rate = ex.mul(`${ctx.activity.label} rate`, unitH, bottleneck, ex.param(ctx.activity.jobEfficiency, 'job efficiency (productive min/h)'));
  return { rate, limiting: limiting.e.label ?? limiting.c.kind };
}

/** Rough per-hour fuel/repair/owning cost of a machine model for estimates (EUR/h). */
export function machineHourlyCostEstimate(model: MachineModel, dieselPrice: number, basisHours: number, load: number): Explained {
  return ex.sum(`${model.label} hourly cost`, 'EUR/h', ...(model.engine ? [ex.mul('fuel', 'EUR/h', ex.param(model.engine.fuelUse, 'fuel use'), ex.value(0.6 + 0.4 * load, '', 'load factor'), ex.value(dieselPrice, 'EUR/l', 'diesel'))] : []), ex.div('repairs', 'EUR/h', ex.param(model.repairCostPerMonth, 'repair cost/month'), ex.value(basisHours, 'h', 'utilisation basis')), ex.div('depreciation + interest', 'EUR/h', ex.param(model.owningCostPerMonth, 'owning cost/month'), ex.value(basisHours, 'h', 'utilisation basis')));
}

export function readSoil(read: ReadCtx, pos: Vec2, override?: string): { id: string; soil: SoilClass } {
  const terrain = read.port('terrain');
  const id = override ?? terrain.soilClassAtDepth(pos[0], pos[1], 0.6);
  return { id, soil: terrain.soilClass(id) };
}
