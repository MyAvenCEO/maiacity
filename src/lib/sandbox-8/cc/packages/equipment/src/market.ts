/**
 * The used-plant market (decision 0015): what a machine of ours would fetch, and how long a sale
 * takes. Two implementations: a depreciation curve (economy pack), and entered comparable sales
 * (an auction record bound by the world definition).
 */
import { DAY, defineModule, ex, s, type EntityId, type ModelDescriptor, type Provenance, type ReadCtx } from '../../kernel/src/index.ts';
import { UsedPlantCurveSchema, UsedPlantSalesSchema, type UsedPlantPort, type UsedPlantValue } from './contract.ts';

const YEAR_S = 365.25 * DAY;
const round = (x: number) => Math.round(x);

/** the machine, its model, its age and hours, and the price a new one costs now */
function machineFacts(read: ReadCtx, id: EntityId) {
  const m = read.require('Machine', id);
  const md = read.data('machineModels')[m.model];
  if (!md) throw new Error(`usedPlant: unknown model ${m.model}`);
  const newPrice = md.purchasePrice.value * read.port('prices').index(read.now);
  return { m, md, ageYears: Math.max(0, (read.now - m.acquiredAt) / YEAR_S), hours: m.engineHours, newPrice };
}


// ------------------------------------------------------------------ a depreciation curve

export const USED_PLANT_CURVE_MODEL: ModelDescriptor = {
  contract: 'usedPlant',
  implementation: 'depreciation-curve',
  kind: 'model',
  label: 'Used-plant prices from a depreciation curve (a first drop, a yearly decline, more or fewer hours than typical use)',
  validity: { ranges: { ageYears: [0, 20] }, notes: 'Typical construction plant; condition beyond hours (damage, repairs) is not known. Older machines are valued at the floor.' },
  resolution: 'per machine',
  confidence: 'low',
  sources: [{ title: 'economy pack: usedPlantMarket' }],
};

function curveValue(read: ReadCtx, id: EntityId): UsedPlantValue {
  const c = read.data('usedPlantMarket');
  if (!c) throw new Error('usedPlant (depreciation curve): the world has no usedPlantMarket data');
  const { md, ageYears, hours, newPrice } = machineFacts(read, id);
  const extraYears = (hours - ageYears * c.hoursPerYear.value) / c.hoursPerYear.value;
  // fewer hours than typical help, but never above a machine just sold on
  const share = Math.max(c.floor.value, Math.min(c.firstDrop.value, c.firstDrop.value * (1 - c.annualDecline.value) ** ageYears * (1 - c.hoursPenalty.value * extraYears)));
  const explain = ex.mul(`market value of a used ${md.label}`, 'EUR', ex.value(newPrice, 'EUR', 'new price today (price index)'), ex.max('share of the new price', '1', ex.param(c.floor, 'floor'), ex.mul('by age and use', '1', ex.param(c.firstDrop, 'after the first sale'), ex.value((1 - c.annualDecline.value) ** ageYears, '1', `${ageYears.toFixed(1)} years at −${(c.annualDecline.value * 100).toFixed(0)} %/a`, c.annualDecline.source), ex.value(1 - c.hoursPenalty.value * extraYears, '1', `${round(hours)} h against ${round(ageYears * c.hoursPerYear.value)} h of typical use`, c.hoursPenalty.source))));
  const provenance: Provenance = { kind: 'model', source: 'depreciation-curve', confidence: 'low', ...(ageYears > 20 ? { note: `outside validity: ${ageYears.toFixed(0)} years old` } : {}) };
  return { value: round(newPrice * share), explain, provenance };
}

export const usedPlantCurveModule = defineModule({
  id: 'used-plant-curve',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Machine'],
  label: 'Used-plant market (depreciation curve)',
  provides: ['usedPlant'],
  requires: ['prices'],
  data: { usedPlantMarket: UsedPlantCurveSchema.optional() },
  models: [USED_PLANT_CURVE_MODEL],
  ports: {
    usedPlant: (read: ReadCtx): UsedPlantPort => ({
      value: (id) => curveValue(read, id),
      buyers: () => {
        const c = read.data('usedPlantMarket')!;
        return { meanDays: c.daysToSell.value, spread: c.spread.value, ...(c.offers ? { offers: { below: c.offers.below.value, days: c.offers.days.value, round: c.offers.round.value } } : {}) };
      },
    }),
  },
});

// ------------------------------------------------------------------ comparable sales

export const USED_PLANT_COMPARABLES_MODEL: ModelDescriptor = {
  contract: 'usedPlant',
  implementation: 'comparables',
  kind: 'entered',
  label: 'Used-plant prices from comparable sales (the nearest by class, age and hours)',
  validity: { notes: 'As good as the record: machines unlike any sale in it (another class, much older, far more hours) are valued from the nearest there are, and marked.' },
  resolution: 'per machine',
  confidence: 'medium',
  sources: [{ title: 'world definition: usedPlantSales' }],
};

/** the k nearest sales of the class, by age (per 5 years) and hours (per 5,000 h) */
function comparables(read: ReadCtx, id: EntityId) {
  const b = read.data('usedPlantBinding');
  const set = b ? read.data('usedPlantSales')?.[b.dataset] : undefined;
  if (!set) throw new Error('usedPlant (comparables): the world binds no usedPlantSales dataset');
  const { md, ageYears, hours, newPrice } = machineFacts(read, id);
  const same = set.sales.filter((x) => x.class === md.class);
  const pool = same.length ? same : set.sales;
  const near = pool
    .map((x) => ({ x, d: Math.hypot((x.ageYears - ageYears) / 5, (x.hours - hours) / 5000) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  if (!near.length) throw new Error('usedPlant (comparables): the dataset has no sales');
  const share = near.reduce((a, n) => a + n.x.priceShare, 0) / near.length;
  const days = near.reduce((a, n) => a + n.x.daysOnMarket, 0) / near.length;
  const far = !same.length || near[0]!.d > 1;
  return { set, md, newPrice, share, days, far, near: near.length };
}

function comparablesValue(read: ReadCtx, id: EntityId): UsedPlantValue {
  const c = comparables(read, id);
  const binding = read.data('usedPlantBinding')!;
  const explain = ex.mul(`market value of a used ${c.md.label}`, 'EUR', ex.value(c.newPrice, 'EUR', 'new price today (price index)'), ex.value(c.share, '1', `price share of the ${c.near} nearest comparable sales`, c.set.source));
  const provenance: Provenance = { kind: 'entered', source: binding.dataset, confidence: c.far ? 'low' : 'medium', ...(c.far ? { note: 'outside validity: no close comparable sale' } : {}) };
  return { value: round(c.newPrice * c.share), explain, provenance };
}

export const usedPlantComparablesModule = defineModule({
  id: 'used-plant-comparables',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Machine'],
  label: 'Used-plant market (comparable sales)',
  provides: ['usedPlant'],
  requires: ['prices'],
  data: { usedPlantSales: s.record(UsedPlantSalesSchema).optional(), usedPlantBinding: s.object({ dataset: s.string() }).optional() },
  models: [USED_PLANT_COMPARABLES_MODEL],
  ports: {
    usedPlant: (read: ReadCtx): UsedPlantPort => ({
      value: (id) => comparablesValue(read, id),
      buyers: (id) => {
        const c = comparables(read, id);
        return { meanDays: c.days, spread: c.set.spread.value, ...(c.set.offers ? { offers: { below: c.set.offers.below.value, days: c.set.offers.days.value, round: c.set.offers.round.value } } : {}) };
      },
    }),
  },
});

