/**
 * Materials and suppliers.
 *
 * Supplier distances are counted from the map's external connection (which itself is 6 km from
 * Göttingen, the region's accesses). Prices are DELIVERED to site: ex-works list price +
 * BVFW 2026 bulk freight for the 4-axle tipper at the one-way distance supplier → site
 * (distance + 6 km). The inventory module books qty × price and runs the trucks without a separate
 * freight charge, so freight must be in the price. Disposal offers likewise include haulage.
 *
 * BVFW 2026 freight, 4-axle, EUR/t: 15 km 8.00 · 20 km 8.42 · 30 km 10.30 (linear in between).
 */
import type { MaterialQuantity } from '../../inventory/src/index.ts';
import type { Source } from '../../kernel/src/index.ts';
import {
  ASSUMPTION, BVFW, CAT_WEIGHTS, DIESEL, ELKA, HH_DISPOSAL, LEINWEBER, MARTA, PETROL, SCHMID, STAHLPREISE, cite, p,
} from './sources.ts';

/** BVFW 2026 freight table, 4-axle tipper (km → EUR/t). */
const FIRE_EST = { title: 'Estimate: what of it burns in a fire, and what is left (fire safety guidance; wood ash some 1–1.5 % of the wood, plastics leave a little char)', publisher: 'Constructible City' };
const FREIGHT_4AXLE: [number, number][] = [[1, 3.51], [5, 5.45], [10, 6.73], [15, 8.0], [20, 8.42], [30, 10.3], [38, 12.24], [42, 13.21], [50, 15.15]];
export function freight4Axle(km: number): number {
  for (let i = 1; i < FREIGHT_4AXLE.length; i += 1) {
    const [k1, f1] = FREIGHT_4AXLE[i]!;
    const [k0, f0] = FREIGHT_4AXLE[i - 1]!;
    if (km <= k1) return Number((f0 + ((f1 - f0) * (Math.max(km, k0) - k0)) / (k1 - k0)).toFixed(2));
  }
  return FREIGHT_4AXLE[FREIGHT_4AXLE.length - 1]![1];
}

/** km from the external connection to Göttingen (the region's road access, its externalDistance). */
const EXTERNAL_KM = 6;

const q = (value: number, unit: string, source?: Source, note?: string): MaterialQuantity => {
  const out: MaterialQuantity = { value, unit };
  if (source) out.source = source;
  if (note) out.note = note;
  return out;
};
/** Delivered price = ex works + 4-axle freight over (supplier distance + external distance). */
const delivered = (exWorks: number, supplierKm: number, source: Source, what: string, exRange?: [number, number]): MaterialQuantity => {
  const km = supplierKm + EXTERNAL_KM;
  const f = freight4Axle(km);
  const value = Number((exWorks + f).toFixed(2));
  const range = exRange ? `; ex-works range ${exRange[0]}–${exRange[1]} → delivered ${(exRange[0] + f).toFixed(2)}–${(exRange[1] + f).toFixed(2)}` : '';
  return q(value, 'EUR/t', source, `${what}: ex works ${exWorks} + BVFW 2026 4-axle freight ${f} EUR/t at ${km} km${range}`);
};
const d = (v: number, range?: [number, number]) => p(v, 'd', ASSUMPTION, range ? { range, confidence: 'low' } : { confidence: 'low' });
const h = (v: number) => p(v, 'h', ASSUMPTION, { confidence: 'low' });

const dens = (v: number, source: Source, range?: [number, number], note?: string, confidence: 'high' | 'medium' | 'low' = 'medium') =>
  p(v, 't/m3', source, { ...(range ? { range } : {}), ...(note ? { note } : {}), confidence });

export const materials = {
  'soil.topsoil': { label: 'Oberboden (topsoil)', unit: 't', density: dens(0.95, cite(CAT_WEIGHTS, 'Topsoil loose 0.95, bank 1.37 t/m3')), category: 'soil', color: '#4a3728' },
  'soil.fill': {
    label: 'Bodenaushub, verwertbar (suitable excavated soil, BM-0)',
    unit: 't',
    density: dens(1.5, cite(CAT_WEIGHTS, 'loose: loess loam 1.25, sand & gravel 1.72 t/m3 — mixed'), [1.25, 1.72]),
    category: 'soil',
    color: '#a88a5c',
  },
  'soil.spoil': {
    label: 'Bodenaushub, nicht verwertbar (unsuitable excavated soil)',
    unit: 't',
    density: dens(1.55, cite(CAT_WEIGHTS, 'loose: loess loam 1.25, clay 1.66 t/m3 (wet 1.66)'), [1.25, 1.66]),
    category: 'soil',
    color: '#6d5a48',
  },
  'agg.fill': {
    label: 'Füllmaterial / Frostschutzgemisch 0/45 (imported fill)',
    unit: 't',
    density: dens(1.7, cite(CAT_WEIGHTS, 'gravel pitrun loose 1.93; Marta bills FSS at 1.5 t/m3'), [1.5, 1.93]),
    category: 'aggregate',
    color: '#a69f92',
  },
  'agg.fss': {
    label: 'Frostschutzmaterial FSS 0/32',
    unit: 't',
    density: dens(1.7, cite(MARTA, 'loose billing factor 1.5 t/m3; pitrun gravel loose 1.93 (Cat)'), [1.5, 1.93]),
    category: 'aggregate',
    color: '#b3ab9c',
  },
  'agg.sts': {
    label: 'Schottertragschicht STS 0/32',
    unit: 't',
    density: dens(1.7, cite(MARTA, 'crushed, loose ~1.5–1.9 t/m3'), [1.5, 1.93]),
    category: 'aggregate',
    color: '#9c968c',
  },
  'agg.wearing': {
    label: 'Deckschicht ohne Bindemittel 0/16 (Mineralgemisch with fines)',
    unit: 't',
    density: dens(1.7, cite(MARTA, 'Mineralgemisch 0/16, loose ~1.5–1.9 t/m3'), [1.5, 1.93]),
    category: 'aggregate',
    color: '#c2b49a',
  },
  'agg.shoulder': {
    label: 'Bankettmaterial 0/32',
    unit: 't',
    density: dens(1.7, cite(MARTA, 'Mineralgemisch 0/32, loose ~1.5–1.9 t/m3'), [1.5, 1.93]),
    category: 'aggregate',
    color: '#a39a86',
  },
  'asphalt.base': {
    label: 'Asphalttragschicht AC 22 T S',
    unit: 't',
    density: dens(2.0, ASSUMPTION, [1.9, 2.2], 'hot mix loose in the truck body; compacted 2.32–2.5 t/m3 (Cat/NAPA, research)', 'low'),
    category: 'asphalt',
    perishableHours: p(3, 'h', ASSUMPTION, {
      range: [2, 5],
      note: 'hot mix in insulated bodies stays above laying temperature for a few hours (ZTV Asphalt-StB minimum temperatures)',
      confidence: 'low',
    }),
    // (cooled below its laying temperature it cannot be compacted: a lump of rubble, Ausbauasphalt, AVV 17 03 02)
    perishesInto: 'waste.construction',
    color: '#2b2b2b',
  },
  'asphalt.binder': {
    label: 'Asphaltbinder AC 16 B S',
    unit: 't',
    density: dens(2.0, ASSUMPTION, [1.9, 2.2], 'hot mix loose; compacted 2.32–2.5 t/m3', 'low'),
    category: 'asphalt',
    perishableHours: p(3, 'h', ASSUMPTION, {
      range: [2, 5],
      note: 'hot mix in insulated bodies stays above laying temperature for a few hours (ZTV Asphalt-StB minimum temperatures)',
      confidence: 'low',
    }),
    // (cooled below its laying temperature it cannot be compacted: a lump of rubble, Ausbauasphalt, AVV 17 03 02)
    perishesInto: 'waste.construction',
    color: '#262626',
  },
  'asphalt.surface': {
    label: 'Asphaltdeckschicht AC 11 D S',
    unit: 't',
    density: dens(2.0, ASSUMPTION, [1.9, 2.2], 'hot mix loose; compacted 2.32–2.5 t/m3', 'low'),
    category: 'asphalt',
    perishableHours: p(3, 'h', ASSUMPTION, {
      range: [2, 5],
      note: 'hot mix in insulated bodies stays above laying temperature for a few hours (ZTV Asphalt-StB minimum temperatures)',
      confidence: 'low',
    }),
    // (cooled below its laying temperature it cannot be compacted: a lump of rubble, Ausbauasphalt, AVV 17 03 02)
    perishesInto: 'waste.construction',
    color: '#1f1f1f',
  },
  'bitumen.emulsion': {
    label: 'Bitumenemulsion C40B5-S (tack coat)',
    unit: 't',
    density: dens(1.0, ASSUMPTION, [0.98, 1.03], 'cationic bitumen emulsion ≈ water density', 'medium'),
    category: 'binder',
    color: '#3a2a1a',
  },
  'pipe.culvert': {
    label: 'Stahlbetonrohr DN 800 (1 pcs = 1 m)',
    unit: 'pcs',
    density: dens(0.65, ASSUMPTION, [0.55, 0.8], '≈ 650 kg per metre over a ≈ 1 m3 envelope; piece goods ship one truck per order', 'low'),
    category: 'concrete',
    pieceMass: p(650, 'kg', ASSUMPTION, { range: [550, 800], confidence: 'low', note: 'a metre of DN 800 reinforced concrete pipe' }),
    color: '#9a9a96',
  },
  'pipe.drain300': {
    label: 'PE drain pipe DN 300, corrugated (1 pcs = 1 m)',
    unit: 'pcs',
    density: dens(0.08, ASSUMPTION, [0.05, 0.12], 'a light corrugated pipe over its own envelope', 'low'),
    category: 'other',
    pieceMass: p(6, 'kg', ASSUMPTION, { range: [4, 9], confidence: 'low', note: 'a metre of corrugated PE pipe DN 300 (to be sourced)' }),
    color: '#4a4a4a',
  },
  'concrete.c25': {
    label: 'Transportbeton C25/30',
    unit: 'm3',
    density: dens(2.4, ASSUMPTION, [2.3, 2.45], 'fresh normal-weight concrete', 'high'),
    category: 'concrete',
    perishableHours: p(1.5, 'h', ASSUMPTION, {
      range: [1, 2],
      note: 'DIN EN 206/DIN 1045-2: discharge within 90 min of batching',
      confidence: 'medium',
    }),
    // (set in the skip or the heap: concrete rubble, Bauschutt, AVV 17 01 01)
    perishesInto: 'waste.construction',
    color: '#bdbdb5',
  },
  'steel.rebar': {
    label: 'Betonstahl B500B',
    unit: 't',
    density: dens(7.85, ASSUMPTION, undefined, 'steel; loads are mass-limited', 'high'),
    category: 'steel',
    color: '#7a4b35',
  },
  'timber.kvh': {
    label: 'Konstruktionsvollholz KVH Fichte C24',
    unit: 'm3',
    density: dens(0.45, ASSUMPTION, [0.42, 0.5], 'C24 mean density 420 kg/m3 (DIN EN 338) at 15 % moisture', 'medium'),
    category: 'timber',
    color: '#d8b37a',
    burns: { share: p(1, '1', FIRE_EST, { confidence: 'high' }), ash: p(0.01, '1', FIRE_EST, { range: [0.005, 0.02], confidence: 'medium' }), ashAs: 'ash.wood' },
  },
  diesel: {
    label: 'Diesel (EN 590)',
    unit: 'l',
    density: dens(0.835, DIESEL, [0.82, 0.845], 'EN 590 density 820–845 kg/m3', 'high'),
    category: 'fuel',
    color: '#c9a227',
  },
  petrol: {
    label: 'Petrol (Super E10, EN 228)',
    unit: 'l',
    density: dens(0.745, ASSUMPTION, [0.72, 0.775], 'EN 228: 720–775 kg/m3', 'high'),
    category: 'fuel',
    color: '#e0b030',
  },
  electricity: {
    label: 'Electricity',
    unit: 'kWh',
    density: dens(0, ASSUMPTION, [0, 0], 'energy has no mass: held in a battery, carried in one or along a cable', 'high'),
    category: 'energy',
    color: '#f1c40f',
  },
  'petrol.2t': {
    label: 'Alkylate 2-stroke mix (Sonderkraftstoff 1:50)',
    unit: 'l',
    density: dens(0.72, ASSUMPTION, [0.69, 0.74], 'alkylate petrol ≈ 690–720 kg/m3 plus 2 % oil', 'medium'),
    category: 'fuel',
    color: '#d97a2b',
  },
  'brick.nf': {
    label: 'Solid clay brick NF (240 × 115 × 71 mm)',
    unit: 'pcs',
    density: dens(1.6, ASSUMPTION, [1.4, 1.8], 'stacked on pallets with gaps', 'low'),
    category: 'other',
    pieceMass: p(3.5, 'kg', { title: 'DIN EN 771-1 / DIN 105-100: Vollziegel NF, gross density ≈ 1.8 kg/dm³ × 1.96 dm³', publisher: 'DIN' }, { range: [3, 4], confidence: 'medium' }),
    // (an estimate: a dry-stacked wall comes down to whole bricks, but for a few that break; the broken ones serve as fill)
    salvage: { share: 0.95, rest: 'soil.fill' },
    color: '#b5532f',
  },
  'kit.tent2': {
    label: 'Two-person dome tent (packed)',
    unit: 'pcs',
    density: dens(0.15, ASSUMPTION, [0.1, 0.25], 'a packed tent of about 20 litres', 'low'),
    category: 'other',
    keepsAge: true,
    pieceMass: p(3, 'kg', ASSUMPTION, { range: [1.5, 4.5], confidence: 'medium', note: 'trekking and camping dome tents for two' }),
    color: '#4f7a3a',
    burns: { share: p(0.8, '1', FIRE_EST, { range: [0.6, 0.9], confidence: 'low', note: 'fly, inner and groundsheet of nylon and polyester; the aluminium poles and pegs do not burn' }), ash: p(0.05, '1', FIRE_EST, { confidence: 'low' }) },
  },
  // water as it comes (camp L2): drinkable, and not safe untreated
  'water.raw': {
    label: 'Creek water (untreated)',
    unit: 'l',
    density: dens(1, ASSUMPTION, [1, 1], 'water', 'high'),
    category: 'water',
    water: p(1, 'l', ASSUMPTION, { confidence: 'high', note: 'a litre is a litre' }),
    pathogens: p(0.013, '1/l', ASSUMPTION, { range: [0.002, 0.05], confidence: 'low', note: 'surface water in farmland (livestock, run-off): drinking 3 l a day untreated, an illness every few weeks (to be sourced)' }),
    color: '#5d8aa8',
  },
  'water.pond': {
    label: 'Pond water (untreated)',
    unit: 'l',
    density: dens(1, ASSUMPTION, undefined, 'water', 'high'),
    category: 'water',
    water: p(1, 'l', ASSUMPTION, { confidence: 'high' }),
    // (standing water: warm in summer, ducks and geese on it, the run-off of the fields round it)
    pathogens: p(0.03, '1/l', ASSUMPTION, { range: [0.005, 0.1], confidence: 'low', note: 'a village pond with waterfowl: more than a flowing creek (to be sourced)' }),
    color: '#5f7f4a',
  },
  'water.rain': {
    label: 'Rain water (from a tarp or roof)',
    unit: 'l',
    density: dens(1, ASSUMPTION, [1, 1], 'water', 'high'),
    category: 'water',
    water: p(1, 'l', ASSUMPTION, { confidence: 'high', note: 'a litre is a litre' }),
    pathogens: p(0.002, '1/l', ASSUMPTION, { range: [0.0005, 0.01], confidence: 'low', note: 'cleaner than a creek, not safe: bird droppings and dust on the catching surface, warm standing water (to be sourced)' }),
    color: '#7fb3d5',
  },
  'kit.rainCatcher': {
    label: 'Rain catcher (tarp, lines and a 200 l barrel, packed)',
    unit: 'pcs',
    density: dens(0.1, ASSUMPTION, [0.05, 0.2], 'a folded tarp and an empty barrel', 'low'),
    category: 'other',
    keepsAge: true,
    pieceMass: p(15, 'kg', ASSUMPTION, { range: [8, 25], confidence: 'low' }),
    color: '#5d8aa8',
    burns: { share: p(0.7, '1', FIRE_EST, { range: [0.5, 0.9], confidence: 'low', note: 'the tarp and the plastic barrel' }), ash: p(0.05, '1', FIRE_EST, { confidence: 'low' }) },
  },
  'bottle.water': {
    label: 'Water bottle (1 l, refillable)',
    unit: 'pcs',
    density: dens(0.12, ASSUMPTION, [0.08, 0.2], 'empty bottles packed together', 'low'),
    category: 'other',
    pieceMass: p(0.15, 'kg', ASSUMPTION, { range: [0.08, 0.35], confidence: 'medium', note: 'a plastic one about 0.1 kg, a steel one about 0.3 kg' }),
    vessel: { litres: p(1, 'l', ASSUMPTION, { confidence: 'high' }) },
    color: '#3f88c5',
  },
  'filter.gravity': {
    label: 'Water filter (gravity, hollow fibre)',
    unit: 'pcs',
    density: dens(0.2, ASSUMPTION, [0.1, 0.3], 'a filter with its bags', 'low'),
    category: 'other',
    pieceMass: p(0.5, 'kg', ASSUMPTION, { range: [0.2, 1], confidence: 'medium' }),
    treats: { removal: p(0.9999, '1', ASSUMPTION, { range: [0.99, 0.999999], confidence: 'low', note: 'hollow-fibre filters remove bacteria and protozoa (log 4–6), viruses hardly (to be sourced)' }) },
    color: '#4a90a4',
  },
  // toilets (camp L3): a dry toilet and what covers each visit; estimates to be sourced
  'toilet.bucket': {
    label: 'Bucket toilet (seat and lid on a 20 l bucket, dry)',
    unit: 'pcs',
    density: dens(0.1, ASSUMPTION, [0.05, 0.2], 'a bucket with a seat', 'low'),
    category: 'other',
    pieceMass: p(3, 'kg', ASSUMPTION, { range: [2, 6], confidence: 'medium' }),
    sanitation: {
      contains: p(0.97, '1', ASSUMPTION, { range: [0.9, 0.99], confidence: 'low', note: 'a lidded bucket, each visit covered: little reaches flies or hands (estimate, to be sourced)' }),
      cover: {
        material: 'cover.sawdust',
        use: p(0.15, 'kg/d', ASSUMPTION, { range: [0.05, 0.3], confidence: 'low', note: 'a person a day: a cup or two of sawdust over each visit; a 20 kg bale lasts a family of four about a month (estimate, to be sourced)' }),
        without: p(0.6, '1', ASSUMPTION, { range: [0.3, 0.8], confidence: 'low', note: 'uncovered, flies get at it (estimate, to be sourced)' }),
      },
      collects: { material: 'waste.humanure', capacity: p(18, 'kg', ASSUMPTION, { range: [12, 22], confidence: 'medium', note: 'a 20 l bucket, filled to below the seat' }) },
    },
    color: '#8d6e63',
  },
  // what a dry toilet collects: emptied onto a heap, it composts (camp L3)
  'waste.humanure': {
    label: 'Humanure (excreta and cover, from a dry toilet)',
    unit: 'kg',
    density: dens(0.8, ASSUMPTION, [0.6, 1], 'wet excreta with sawdust', 'low'),
    category: 'other',
    seasons: {
      into: 'soil.compost',
      days: p(365, 'd', ASSUMPTION, { range: [180, 730], confidence: 'low', note: 'a heap left a year or two (thermophilic composting kills most pathogens; WHO 2006 guidelines, to be sourced)' }),
      keeps: p(0.5, '1', ASSUMPTION, { range: [0.3, 0.7], confidence: 'low', note: 'water and what rots away leave about half (to be sourced)' }),
    },
    color: '#6d4c41',
  },
  // a site's toilet (realism S1b; ASR A4.1 asks toilets on a site): a cabin over a closed tank, pumped out by a service
  'toilet.mobile': {
    label: 'Mobile toilet (a cabin over a 250 l holding tank)',
    unit: 'pcs',
    density: dens(0.03, ASSUMPTION, [0.02, 0.05], 'a plastic cabin of some 1.1 × 1.2 × 2.3 m and 80 kg', 'low'),
    category: 'other',
    pieceMass: p(80, 'kg', ASSUMPTION, { range: [65, 100], confidence: 'medium', note: 'a standard site toilet cabin, empty (manufacturers give some 70–90 kg)' }),
    sanitation: {
      contains: p(0.99, '1', ASSUMPTION, { range: [0.95, 0.999], confidence: 'low', note: 'a closed tank under a lid, a door, a chemical against flies: next to nothing reaches flies or hands (estimate, to be sourced)' }),
      collects: { material: 'waste.sewage', capacity: p(250, 'kg', ASSUMPTION, { range: [200, 300], confidence: 'medium', note: 'the holding tank of a standard site toilet cabin: some 250 l (manufacturers’ data)' }) },
    },
    color: '#2e7d32',
  },
  // what a mobile toilet's tank holds: pumped out by a suction truck and taken to a sewage works
  'waste.sewage': {
    label: 'Toilet tank contents (excreta, flush water, chemical)',
    unit: 'kg',
    density: dens(1.0, ASSUMPTION, [0.98, 1.05], 'mostly water', 'high'),
    category: 'other',
    color: '#5d4037',
  },
  'soil.compost': {
    label: 'Compost',
    unit: 'kg',
    density: dens(0.6, ASSUMPTION, [0.4, 0.8], 'mature compost, loose', 'low'),
    category: 'soil',
    color: '#4e342e',
  },
  'soap.bar': {
    label: 'Soap (bars)',
    unit: 'kg',
    density: dens(1, ASSUMPTION, [0.8, 1.2], 'bars of soap in a box', 'medium'),
    category: 'other',
    cleans: { use: p(0.0083, 'kg/d', { title: 'The Sphere Handbook: Humanitarian Charter and Minimum Standards in Humanitarian Response (WASH: hygiene items)', publisher: 'Sphere Association', year: 2018 }, { range: [0.005, 0.015], confidence: 'medium', note: '250 g of bathing soap a person a month' }) },
    color: '#f3e5ab',
  },
  'cover.sawdust': {
    label: 'Sawdust and wood shavings (baled)',
    unit: 'kg',
    density: dens(0.15, ASSUMPTION, [0.1, 0.25], 'loose shavings', 'low'),
    category: 'other',
    color: '#d7b98e',
  },
  // heat (camp C4, C6): what a heater gives, burns and leaves in the air; estimates to be sourced
  'fuel.propane': {
    label: 'Propane (bottled, 5 or 11 kg)',
    unit: 'kg',
    density: dens(0.5, ASSUMPTION, [0.4, 0.6], 'liquid propane in its bottle', 'medium'),
    category: 'fuel',
    color: '#c0392b',
  },
  'fuel.charcoal': {
    label: 'Charcoal (bagged)',
    unit: 'kg',
    density: dens(0.25, ASSUMPTION, [0.2, 0.3], 'lump charcoal in bags', 'medium'),
    category: 'fuel',
    color: '#2b2b2b',
  },
  // felled trees (rung 2, site materials): the stem as logs, the crown as brash
  'wood.logs': {
    label: 'Logs (green roundwood, felled and limbed)',
    unit: 't',
    density: dens(0.6, ASSUMPTION, [0.5, 0.75], 'stacked green logs: some 0.8–1.0 t of wood a solid m³, about 0.7 m³ of wood in a stacked m³', 'medium'),
    // (an estimate: logs of a lean-to or a hut come off whole but for those split or rotten, which go as brash)
    salvage: { share: 0.85, rest: 'wood.brash' },
    category: 'timber',
    color: '#9a6b3f',
    burns: { share: p(1, '1', FIRE_EST, { confidence: 'high' }), ash: p(0.01, '1', FIRE_EST, { range: [0.005, 0.02], confidence: 'medium' }), ashAs: 'ash.wood' },
  },
  'wood.brash': {
    label: 'Brash (branches and tops, Reisig)',
    unit: 't',
    density: dens(0.15, ASSUMPTION, [0.08, 0.25], 'loose branches with their twigs (to be sourced)', 'low'),
    // (brash comes off and is piled again)
    salvage: { share: 1 },
    category: 'timber',
    // left on a heap it rots: in some three years it is crumbly earth, most of it gone to the air as water and CO2
    seasons: {
      into: 'soil.compost',
      days: p(1095, 'd', ASSUMPTION, { range: [730, 1825], confidence: 'low', note: 'twigs and leaves rot in two to five years on a heap in a temperate climate (to be sourced)' }),
      keeps: p(0.3, '1', ASSUMPTION, { range: [0.2, 0.45], confidence: 'low', note: 'green brash is about half water, and most of its dry matter is respired away (to be sourced)' }),
    },
    color: '#6f7d3a',
    burns: { share: p(1, '1', FIRE_EST, { confidence: 'high' }), ash: p(0.015, '1', FIRE_EST, { range: [0.01, 0.03], confidence: 'medium', note: 'as brash burnt on a fire (8h-1)' }), ashAs: 'ash.wood' },
  },
  'fuel.firewoodGreen': {
    label: 'Firewood (split, green)',
    unit: 'kg',
    density: dens(0.45, ASSUMPTION, [0.35, 0.55], 'freshly split wood stacked loose', 'low'),
    category: 'fuel',
    // it dries where it is stacked: green wood is some half water, seasoned some fifth
    seasons: {
      into: 'fuel.firewood',
      days: p(365, 'd', ASSUMPTION, { range: [180, 730], confidence: 'low', note: 'split and stacked under cover, a summer or two (softwood less, beech and oak more; to be sourced)' }),
      keeps: p(0.625, '1', ASSUMPTION, { range: [0.55, 0.75], confidence: 'medium', note: 'from about 50 % to about 20 % water by mass: 0.5 / 0.8 of the green mass is left' }),
    },
    color: '#a0703c',
  },
  'fuel.firewood': {
    label: 'Firewood (split, dry)',
    unit: 'kg',
    density: dens(0.4, ASSUMPTION, [0.3, 0.5], 'split logs stacked loose', 'medium'),
    category: 'fuel',
    color: '#8b5a2b',
  },
  'heater.gas': {
    label: 'Catalytic gas heater (1.5 kW, propane)',
    unit: 'pcs',
    density: dens(0.15, ASSUMPTION, [0.1, 0.25], 'a small heater with its hose', 'low'),
    category: 'other',
    pieceMass: p(3, 'kg', ASSUMPTION, { range: [2, 5], confidence: 'low' }),
    heat: {
      output: p(1.5, 'kW', ASSUMPTION, { range: [1, 3], confidence: 'medium', note: 'small catalytic and infrared propane heaters' }),
      fuel: 'fuel.propane',
      use: p(0.12, 'kg/h', ASSUMPTION, { range: [0.08, 0.2], confidence: 'medium', note: '1.5 kW from propane of about 46 MJ/kg' }),
      flue: false,
      co: p(0.4, 'g/h', ASSUMPTION, { range: [0.05, 3], confidence: 'low', note: 'little when it burns clean; it rises sharply as the oxygen in a closed room runs low (to be sourced)' }),
    },
    color: '#b03a2e',
  },
  'grill.charcoal': {
    label: 'Charcoal grill (small, for cooking outdoors)',
    unit: 'pcs',
    density: dens(0.1, ASSUMPTION, [0.05, 0.2], 'a kettle grill', 'low'),
    category: 'other',
    pieceMass: p(5, 'kg', ASSUMPTION, { range: [3, 10], confidence: 'low' }),
    heat: {
      output: p(2, 'kW', ASSUMPTION, { range: [1, 4], confidence: 'low', note: 'a small charcoal fire' }),
      fuel: 'fuel.charcoal',
      use: p(0.25, 'kg/h', ASSUMPTION, { range: [0.15, 0.5], confidence: 'low', note: '2 kW from charcoal of about 29 MJ/kg' }),
      flue: false,
      co: p(15, 'g/h', ASSUMPTION, { range: [5, 40], confidence: 'low', note: 'smouldering charcoal makes much carbon monoxide: the cause of most deaths by fumes in tents (to be sourced)' }),
    },
    cooks: { efficiency: p(0.25, '1', ASSUMPTION, { range: [0.15, 0.35], confidence: 'low', note: 'a pot on a grill over charcoal: much of the heat passes it by (to be sourced)' }) },
    color: '#3d3d3d',
  },
  'stove.tent': {
    label: 'Tent wood stove with flue pipe (3 kW)',
    unit: 'pcs',
    density: dens(0.2, ASSUMPTION, [0.1, 0.3], 'a folding steel stove and its pipe sections', 'low'),
    category: 'other',
    pieceMass: p(9, 'kg', ASSUMPTION, { range: [5, 15], confidence: 'low' }),
    heat: {
      output: p(3, 'kW', ASSUMPTION, { range: [2, 5], confidence: 'low', note: 'small stoves for canvas tents' }),
      fuel: 'fuel.firewood',
      use: p(0.8, 'kg/h', ASSUMPTION, { range: [0.5, 1.2], confidence: 'low', note: '3 kW from dry wood of about 15 MJ/kg at some 75 % efficiency' }),
      flue: true,
      co: p(0.02, 'g/h', ASSUMPTION, { range: [0, 0.2], confidence: 'low', note: 'with a sound flue the fumes go out; what leaks back is little' }),
    },
    cooks: { efficiency: p(0.3, '1', ASSUMPTION, { range: [0.2, 0.4], confidence: 'low', note: 'a pot on the stove’s top plate (to be sourced)' }) },
    color: '#555555',
  },
  // bedding (camp C4, C6): what keeps one warm at night is its insulation, as the standards rate it
  'bedding.bag3season': {
    label: 'Sleeping bag, three-season (comfort about 5 °C)',
    unit: 'pcs',
    density: dens(0.12, ASSUMPTION, [0.08, 0.2], 'a stuffed bag of about 12 litres', 'low'),
    category: 'other',
    pieceMass: p(1.4, 'kg', ASSUMPTION, { range: [0.9, 2], confidence: 'medium', note: 'synthetic three-season bags' }),
    insulation: { comfort: p(5, '°C', { title: 'EN ISO 23537-1: sleeping bags, comfort temperature', publisher: 'ISO/CEN' }, { range: [2, 9], confidence: 'medium', note: 'the comfort temperature of a typical three-season bag' }) },
    color: '#3b6ea5',
  },
  'bedding.bagWinter': {
    label: 'Sleeping bag, winter (comfort about −7 °C)',
    unit: 'pcs',
    density: dens(0.12, ASSUMPTION, [0.08, 0.2], 'a stuffed bag of about 20 litres', 'low'),
    category: 'other',
    pieceMass: p(2.3, 'kg', ASSUMPTION, { range: [1.4, 3], confidence: 'medium', note: 'synthetic or down winter bags' }),
    insulation: { comfort: p(-7, '°C', { title: 'EN ISO 23537-1: sleeping bags, comfort temperature', publisher: 'ISO/CEN' }, { range: [-12, -3], confidence: 'medium', note: 'the comfort temperature of a typical winter bag' }) },
    color: '#1f3f66',
  },
  'bedding.matFoam': {
    label: 'Closed-cell foam mat (R about 2)',
    unit: 'pcs',
    density: dens(0.04, ASSUMPTION, [0.02, 0.06], 'a rolled foam mat of about 10 litres', 'low'),
    category: 'other',
    pieceMass: p(0.4, 'kg', ASSUMPTION, { range: [0.25, 0.6], confidence: 'medium' }),
    insulation: { rValue: p(2, 'm2·K/W', { title: 'ASTM F3340: thermal resistance (R-value) of sleeping pads', publisher: 'ASTM International' }, { range: [1.5, 2.6], confidence: 'medium', note: 'closed-cell foam mats rate about 1.5–2.5' }) },
    color: '#c9b03a',
  },
  'bedding.matInsulated': {
    label: 'Insulated air mat (R about 4.5)',
    unit: 'pcs',
    density: dens(0.15, ASSUMPTION, [0.1, 0.25], 'a packed air mat of about 3 litres', 'low'),
    category: 'other',
    pieceMass: p(0.6, 'kg', ASSUMPTION, { range: [0.4, 0.9], confidence: 'medium' }),
    insulation: { rValue: p(4.5, 'm2·K/W', { title: 'ASTM F3340: thermal resistance (R-value) of sleeping pads', publisher: 'ASTM International' }, { range: [3.5, 6], confidence: 'medium', note: 'insulated air mats for three seasons and winter' }) },
    color: '#d06a2a',
  },
  'kit.kitchenTent': {
    label: 'Frame tent 6 × 12 m, a pack piece (frame, sheets, anchors)',
    unit: 'pcs',
    density: dens(0.4, ASSUMPTION, [0.2, 0.6], 'aluminium sections and folded PVC sheets on a pallet', 'low'),
    category: 'other',
    keepsAge: true,
    pieceMass: p(40, 'kg', ASSUMPTION, { range: [25, 60], confidence: 'low', note: 'a frame tent of some 600 kg comes in about 15 pieces: two people to a piece' }),
    color: '#4f7a3a',
    burns: { share: p(0.1, '1', FIRE_EST, { range: [0.05, 0.2], confidence: 'low', note: 'its PVC sheets; the steel frame does not burn' }), ash: p(0.05, '1', FIRE_EST, { confidence: 'low' }) },
  },
  'food.provisions': {
    label: 'Provisions (bread, pasta, rice, tins, cheese)',
    unit: 'kg',
    density: dens(0.45, ASSUMPTION, [0.3, 0.7], 'packed groceries in crates', 'low'),
    category: 'food',
    energy: p(2500, 'kcal', ASSUMPTION, { range: [1500, 3600], confidence: 'low', note: 'per kg of a mix of keeping foods: pasta and rice ≈ 3,500, bread ≈ 2,400, cheese ≈ 3,500, tins ≈ 800–1,200 kcal/kg (Bundeslebensmittelschlüssel orders of magnitude)' }),
    // (an estimate to be sourced: tins, jars, bags and cartons of keeping foods, some 10–20 % of what they hold)
    leaves: { material: 'waste.household', per: 0.15 },
    color: '#c9a66b',
  },
  'food.dry': {
    label: 'Dry food (pasta, rice, oats, lentils), eaten cooked',
    unit: 'kg',
    density: dens(0.6, ASSUMPTION, [0.45, 0.8], 'bags and packets in crates', 'low'),
    category: 'food',
    energy: p(3500, 'kcal', ASSUMPTION, { range: [3300, 3800], confidence: 'medium', note: 'dry pasta, rice and oats ≈ 3,500–3,700, lentils ≈ 3,300 kcal/kg (Bundeslebensmittelschlüssel orders of magnitude)' }),
    // (boiled: some 3 l of water a kg, rice taking it up, pasta's poured away; the heat to bring it to the boil and keep it there)
    cook: {
      heat: p(0.5, 'kWh', ASSUMPTION, { range: [0.3, 0.9], confidence: 'low', note: 'about 3 l of water heated from 15 °C to the boil (0.3 kWh) and kept simmering 10–20 minutes (to be sourced)' }),
      water: p(3, 'l', ASSUMPTION, { range: [2, 10], confidence: 'low', note: 'rice takes up some 2 l a kg; pasta is boiled in some 10 l a kg, much of it used again or for washing up (to be sourced)' }),
    },
    leaves: { material: 'waste.household', per: 0.04 },
    color: '#e3c58f',
  },
  'heater.electric': {
    label: 'Fan heater (2 kW, on its 1 kW setting)',
    unit: 'pcs',
    density: dens(0.15, ASSUMPTION, [0.1, 0.25], 'a small fan heater', 'low'),
    category: 'other',
    pieceMass: p(1.5, 'kg', ASSUMPTION, { range: [1, 3], confidence: 'low' }),
    heat: {
      output: p(1, 'kW', ASSUMPTION, { confidence: 'high', note: 'all it draws becomes heat in the room' }),
      fuel: 'electricity',
      draw: p(1, 'kW', ASSUMPTION, { range: [0.75, 2], confidence: 'medium', note: 'its lower setting (2 kW on the higher)' }),
      flue: false,
      co: p(0, 'g/h', ASSUMPTION, { confidence: 'high', note: 'nothing burns' }),
    },
    color: '#95a5a6',
  },
  'hob.induction': {
    label: 'Induction hob (one zone, cooking at 1.5 kW)',
    unit: 'pcs',
    density: dens(0.2, ASSUMPTION, [0.1, 0.3], 'a single induction plate', 'low'),
    category: 'other',
    pieceMass: p(2.5, 'kg', ASSUMPTION, { range: [2, 4], confidence: 'low' }),
    heat: {
      output: p(1.5, 'kW', ASSUMPTION, { range: [1.2, 2], confidence: 'medium', note: 'what it draws cooking (up to 2 kW at full power)' }),
      fuel: 'electricity',
      draw: p(1.5, 'kW', ASSUMPTION, { range: [1.2, 2], confidence: 'medium' }),
      flue: false,
      co: p(0, 'g/h', ASSUMPTION, { confidence: 'high', note: 'nothing burns' }),
    },
    // (a magnetic pot heated in itself: little lost)
    cooks: { efficiency: p(0.85, '1', ASSUMPTION, { range: [0.8, 0.9], confidence: 'medium', note: 'induction: some 85 % of what it draws into the pot (a gas flame some 40–50 %)' }), only: true },
    color: '#2c3e50',
  },
  'light.headlamp': {
    label: 'Headlamp (LED, batteries)',
    unit: 'pcs',
    density: dens(0.3, ASSUMPTION, [0.2, 0.5], 'a headlamp in its packing', 'low'),
    category: 'other',
    pieceMass: p(0.1, 'kg', ASSUMPTION, { range: [0.06, 0.2], confidence: 'medium', note: 'with its three AAA cells' }),
    light: { output: p(250, 'lm', ASSUMPTION, { range: [100, 600], confidence: 'medium', note: 'an ordinary LED headlamp: 100–600 lm' }) },
    color: '#e67e22',
  },
  'stove.camping': {
    label: 'Camping stove (two burners, propane, 2 × 2 kW)',
    unit: 'pcs',
    density: dens(0.15, ASSUMPTION, [0.1, 0.25], 'a folding two-burner stove in its case', 'low'),
    category: 'other',
    pieceMass: p(4, 'kg', ASSUMPTION, { range: [2, 7], confidence: 'low' }),
    heat: {
      output: p(2, 'kW', ASSUMPTION, { range: [1.5, 3], confidence: 'low', note: 'one burner at full flame' }),
      fuel: 'fuel.propane',
      use: p(0.16, 'kg/h', ASSUMPTION, { range: [0.12, 0.2], confidence: 'medium', note: '2 kW from propane of about 46 MJ/kg' }),
      flue: false,
      co: p(0.5, 'g/h', ASSUMPTION, { range: [0.1, 3], confidence: 'low', note: 'a gas flame under a pot: little in the open, more under a cold pot and in a closed tent (to be sourced)' }),
    },
    cooks: { efficiency: p(0.45, '1', ASSUMPTION, { range: [0.3, 0.6], confidence: 'low', note: 'a gas burner in still air with a lid on the pot (to be sourced)' }), only: true },
    color: '#2e6da4',
  },
  // what is taken down and cannot be used again stays as matter (design/physical-state.md I1): mixed rubble
  'waste.construction': {
    label: 'Construction and demolition waste (mixed rubble, Bauschutt)',
    unit: 't',
    density: dens(1.4, ASSUMPTION, [1.1, 1.7], 'mixed mineral demolition rubble, loose', 'low'),
    category: 'other',
    color: '#8a7f72',
  },
  // what building firms bring to a house as they build it (the trades' deliveries, design/physical-state.md 8a): goods of
  // the world's edge that go into the built holding, and come off again as rubble when it is taken down or comes down
  'masonry.block': {
    label: 'Planziegel and mortar (filled clay blocks, 36.5 cm)',
    unit: 't',
    density: dens(0.8, ASSUMPTION, [0.7, 0.9], 'filled Planziegel stacked on pallets (gross density about 0.65–0.75 kg/dm³ with gaps)', 'low'),
    category: 'other',
    // (mortar-bonded blocks break when taken down: rubble, recycled as crushed brick)
    salvage: { share: 0, rest: 'waste.construction' },
    color: '#c1440e',
  },
  'roof.package': {
    label: 'Roof package (rafters, insulation, battens, clay tiles)',
    unit: 't',
    density: dens(0.4, ASSUMPTION, [0.25, 0.6], 'timber, mineral wool and tiles as delivered', 'low'),
    category: 'other',
    salvage: { share: 0, rest: 'waste.construction' },
    color: '#8d3b2a',
  },
  windows: {
    label: 'Windows (frames with triple glazing)',
    unit: 't',
    density: dens(0.3, ASSUMPTION, [0.2, 0.5], 'window units on racks', 'low'),
    category: 'other',
    salvage: { share: 0, rest: 'waste.construction' },
    color: '#9fb7c9',
  },
  render: {
    label: 'Render (lime-cement, bagged)',
    unit: 't',
    density: dens(1.3, ASSUMPTION, [1.1, 1.5], 'bagged dry mortar on pallets', 'low'),
    category: 'binder',
    salvage: { share: 0, rest: 'waste.construction' },
    color: '#efe6d5',
  },
  paint: {
    label: 'Exterior silicate paint (in buckets)',
    unit: 't',
    density: dens(1.2, ASSUMPTION, [1, 1.5], 'paint in 15 l buckets', 'low'),
    category: 'other',
    salvage: { share: 0, rest: 'waste.construction' },
    color: '#f4efe6',
  },
  mep: {
    label: 'Building services (pipes, cables, boiler, radiators, sanitary ware)',
    unit: 't',
    density: dens(0.3, ASSUMPTION, [0.15, 0.5], 'mixed installation goods as delivered', 'low'),
    category: 'other',
    salvage: { share: 0, rest: 'waste.construction' },
    color: '#7f8c8d',
  },
  interior: {
    label: 'Interior finishes (screed, plaster, boards, flooring)',
    unit: 't',
    density: dens(1.2, ASSUMPTION, [0.8, 1.6], 'bagged screed and plaster, boards, flooring', 'low'),
    category: 'other',
    salvage: { share: 0, rest: 'waste.construction' },
    color: '#d7ccc8',
  },
  steel: {
    label: 'Structural steel (sections, bolted)',
    unit: 't',
    density: dens(2, ASSUMPTION, [1, 3], 'sections stacked with gaps; loads are mass-limited', 'low'),
    category: 'steel',
    // (a bolted frame comes apart for the most part; what is cut goes as scrap with the rubble)
    salvage: { share: 0.8, rest: 'waste.construction' },
    color: '#6d7b8a',
  },
  panels: {
    label: 'Sandwich panels (steel faces, PIR core)',
    unit: 't',
    density: dens(0.12, ASSUMPTION, [0.08, 0.2], 'panels stacked, about 12 kg/m² at 10 cm', 'low'),
    category: 'other',
    salvage: { share: 0.5, rest: 'waste.construction' },
    color: '#b0bec5',
  },
  'waste.household': {
    label: 'Household waste (packaging: tins, jars, bags, cartons)',
    unit: 'kg',
    density: dens(0.1, ASSUMPTION, [0.05, 0.2], 'loose packaging in sacks', 'low'),
    category: 'other',
    color: '#6b6b5a',
  },
  // what a fire leaves (8h, VISION "Fire is one process"): ash is still matter to be dealt with
  'waste.cinders': {
    label: 'Burnt rubbish (ash, cinders, tins, broken glass)',
    unit: 'kg',
    density: dens(0.6, ASSUMPTION, [0.4, 0.9], 'what is left in a burning barrel', 'low'),
    category: 'other',
    color: '#4a4744',
  },
  'waste.fireDebris': {
    label: 'Fire debris (charred and melted remains, Brandschutt)',
    unit: 'kg',
    density: dens(0.4, ASSUMPTION, [0.2, 0.8], 'charred timber, bent metal, melted plastic, loose', 'low'),
    category: 'other',
    color: '#3b3632',
  },
  'ash.wood': {
    label: 'Wood ash',
    unit: 'kg',
    density: dens(0.5, ASSUMPTION, [0.4, 0.7], 'loose wood ash', 'medium'),
    category: 'other',
    color: '#b8b4ad',
  },
  'water.drinking': {
    label: 'Drinking water (bottles, canisters)',
    unit: 'l',
    density: dens(1, ASSUMPTION, [0.998, 1], 'water: a litre weighs a kilogram (the bottles are their own waste, below)', 'high'),
    category: 'water',
    water: p(1, 'l', ASSUMPTION, { confidence: 'high', note: 'a litre is a litre' }),
    // the bottles: about 35 g of PET for 1.5 l (estimate); a canister refilled is not counted
    leaves: { material: 'waste.household', per: 0.025 },
    color: '#7fb3d5',
  },
};

const QUARRY_KM = 14;
const ASPHALT_KM = 18;
const DISPOSAL_KM = 12;
const TIMBER_YARD_KM = 18;

/**
 * Punctuality of deliveries: estimates, to be sourced (no German delivery-reliability statistic at
 * hand). Plants that deliver to a pour or a paver plan by the hour and are mostly on time; a
 * builders' merchant's lorry runs a round and is late more often, sometimes to the next day.
 */
const PUNCTUALITY_NOTE = 'estimate; no delivery-reliability statistic at hand (to be sourced)';
const PLANT_PUNCTUAL = { onTime: p(0.92, '1', ASSUMPTION, { range: [0.8, 0.98], confidence: 'low', note: PUNCTUALITY_NOTE }), late: p(1.5, 'h', ASSUMPTION, { range: [0.5, 4], confidence: 'low', note: 'a lorry held up at the plant or in traffic' }) };
const ROUND_PUNCTUAL = { onTime: p(0.85, '1', ASSUMPTION, { range: [0.7, 0.95], confidence: 'low', note: PUNCTUALITY_NOTE }), late: p(5, 'h', ASSUMPTION, { range: [1, 24], confidence: 'low', note: 'a delivery round: later in the day, now and then the next day' }) };

export const suppliers = {
  fuelDealer: {
    label: 'Mineralölhandel Leinetal (diesel)',
    kind: 'merchant',
    distance: p(10, 'km', ASSUMPTION, {
      confidence: 'low',
      note: 'regional fuel dealer; bulk deliveries to site tanks',
    }),
    punctuality: ROUND_PUNCTUAL,
    fleet: p(2, '1', ASSUMPTION, { range: [1, 4], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'tanker',
    openFrom: h(6),
    openTo: h(18),
    offers: {
      diesel: {
        price: q(1.96, 'EUR/l', DIESEL, 'bulk delivery price ≈ pump net price (Sept 2026 spike); fleet/bulk discounts 3–8 ct/l not applied'),
        leadTime: d(1, [1, 3]),
        minOrder: q(1000, 'l'),
      },
    },
  },
  quarry: {
    label: 'Kalksteinwerk Hainberg (Schotterwerk)',
    kind: 'quarry',
    distance: p(QUARRY_KM, 'km', ASSUMPTION, { note: 'Muschelkalk quarries around Göttingen; fictional site', confidence: 'low' }),
    punctuality: PLANT_PUNCTUAL,
    fleet: p(8, '1', ASSUMPTION, { range: [4, 16], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'tipper4',
    openFrom: h(6),
    openTo: h(17),
    offers: {
      'agg.fill': {
        price: delivered(10.85, QUARRY_KM, MARTA, 'Frostschutzgemisch 0/45 (Stottmeier 2025 10.85; Marta 14.00 EUR/t)', [10.85, 14.0]),
        leadTime: d(1, [1, 2]),
        minOrder: q(25, 't'),
      },
      'agg.fss': {
        price: delivered(13.0, QUARRY_KM, MARTA, 'FSS 0/32 (Stottmeier 10.85, Marta 14.50 EUR/t)', [10.85, 14.5]),
        leadTime: d(1, [1, 2]),
        minOrder: q(25, 't'),
      },
      'agg.sts': {
        price: delivered(13.3, QUARRY_KM, MARTA, 'STS 0/32 (Stottmeier 11.10, Marta 15.50 EUR/t)', [11.1, 15.5]),
        leadTime: d(1, [1, 2]),
        minOrder: q(25, 't'),
      },
      'agg.wearing': {
        price: delivered(14.9, QUARRY_KM, BVFW, 'Mineralgemisch 0/16 (BVFW 2026 Kalkstein 15.80, Marta 14.00 EUR/t)', [14.0, 16.8]),
        leadTime: d(1, [1, 2]),
        minOrder: q(25, 't'),
      },
      'agg.shoulder': {
        price: delivered(14.8, QUARRY_KM, BVFW, 'Mineralgemisch 0/32 as Bankettmaterial (BVFW 14.80–15.80, Marta 12.50 EUR/t)', [12.5, 15.8]),
        leadTime: d(1, [1, 2]),
        minOrder: q(25, 't'),
      },
      'soil.topsoil': {
        price: delivered(13.5, QUARRY_KM, MARTA, 'Oberboden sieved (Marta 12.50–13.50, Stottmeier 11.25–17.60, BVFW 17.20 EUR/t)', [11.25, 17.6]),
        leadTime: d(1, [1, 2]),
        minOrder: q(25, 't'),
      },
    },
  },
  asphaltPlant: {
    label: 'Asphaltmischwerk Leinetal',
    kind: 'asphaltPlant',
    distance: p(ASPHALT_KM, 'km', ASSUMPTION, { confidence: 'low', note: 'fictional plant' }),
    punctuality: PLANT_PUNCTUAL,
    fleet: p(10, '1', ASSUMPTION, { range: [5, 20], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'tipper4',
    openFrom: h(6),
    openTo: h(16),
    offers: {
      'asphalt.base': {
        price: delivered(109.2, ASPHALT_KM, SCHMID, 'AC 22 T S (Schmid 109.20; Schwarzenbeck 146.75; Weinheim with RA 63.90 EUR/t)', [63.9, 146.75]),
        leadTime: d(2, [1, 5]),
        minOrder: q(10, 't'),
      },
      'asphalt.binder': {
        price: delivered(133.4, ASPHALT_KM, SCHMID, 'AC 16 B S PmB (Weinheim 83.40, Schwarzenbeck AC 16 B N 163.77 EUR/t)', [83.4, 163.77]),
        leadTime: d(2, [1, 5]),
        minOrder: q(10, 't'),
      },
      'asphalt.surface': {
        price: delivered(138.2, ASPHALT_KM, SCHMID, 'AC 11 D S 50/70 (Weinheim 105.30, Schwarzenbeck AC 11 DN 201.60 EUR/t)', [105.3, 201.6]),
        leadTime: d(2, [1, 5]),
        minOrder: q(10, 't'),
      },
      'bitumen.emulsion': {
        price: q(1.6, 'EUR/kg', cite(SCHMID, 'Nr. 180 Haftkleber C40B5-S lose, 160.00 EUR per 100 kg'), 'ex works; freight for small quantities neglected. Spray rate ≈ 0.25 kg/m2 (estimate)'),
        leadTime: d(2, [1, 5]),
        minOrder: q(200, 'kg'),
      },
    },
  },
  merchant: {
    label: 'Baustoffhandel Göttingen',
    kind: 'merchant',
    distance: p(8, 'km', ASSUMPTION, { confidence: 'low', note: 'builders’ merchant at the edge of Göttingen' }),
    punctuality: ROUND_PUNCTUAL,
    fleet: p(3, '1', ASSUMPTION, { range: [1, 6], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'flatbed',
    openFrom: h(7),
    openTo: h(17),
    // (a crane lorry: our receiver shows where it goes and signs the delivery note, or it is set down by consent, S5)
    handover: 'attended',
    ringsAhead: p(30, 'min', ASSUMPTION, { range: [15, 60], confidence: 'low', note: 'a builders’ merchant’s crane lorry rings ahead of its arrival so someone is at the drop point (common practice: a call 15–60 min before; estimate)' }),
    failed: { fee: p(60, 'EUR', ASSUMPTION, { range: [30, 120], confidence: 'low', note: 'a lorry sent back unloaded: a second delivery charged as a trip (estimate)' }), wait: p(20, 'min', ASSUMPTION, { range: [10, 30], confidence: 'low', note: 'a builders’ merchant’s driver waits a while for someone to sign (estimate)' }), attempts: 2 },
    offers: {
      'pipe.drain300': {
        price: q(25, 'EUR/pcs', ASSUMPTION, 'ESTIMATE (to be sourced): corrugated PE drain pipe DN 300 per metre at a builders’ merchant, range 15–40 EUR/m'),
        leadTime: d(3, [1, 7]),
        minOrder: q(1, 'pcs'),
      },
      'pipe.culvert': {
        price: q(180, 'EUR/pcs', ASSUMPTION, 'ESTIMATE (not in research): reinforced concrete pipe DN 800 per metre delivered, range 120–260 EUR/m'),
        leadTime: d(5, [3, 10]),
        minOrder: q(1, 'pcs'),
      },
      'steel.rebar': {
        price: q(900, 'EUR/t', STAHLPREISE, 'market base 590–615 EUR/t (Jan 2026) + cut & bend / merchant delivery ≈ +300 (research: +300–600) → range 615–1,250'),
        leadTime: d(3, [2, 10]),
        minOrder: q(0.5, 't'),
      },
      'petrol.2t': {
        price: q(3.6, 'EUR/l', ASSUMPTION, 'ESTIMATE: ready-mixed alkylate 2T in 200 l drums ≈ 3–4 EUR/l net (5 l cans ≈ 4.5–5 EUR/l)'),
        leadTime: d(1, [1, 3]),
        minOrder: q(20, 'l'),
      },
      'brick.nf': {
        price: q(0.6, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: solid clay bricks NF from a builders’ merchant ≈ 0.4–0.9 EUR a piece'),
        leadTime: d(2, [1, 7]),
        minOrder: q(100, 'pcs'),
      },
      'timber.kvh': {
        price: q(700, 'EUR/m3', ELKA, 'KVH spruce 600–900 EUR/m3; free delivery above minimum assumed'),
        leadTime: d(2, [1, 7]),
        minOrder: q(0.5, 'm3'),
      },
    },
  },
  petrolStation: {
    label: 'Tankstelle Göttingen-Weende (fuel in cans)',
    kind: 'merchant',
    distance: p(6, 'km', ASSUMPTION, { confidence: 'low', note: 'a filling station on the edge of town' }),
    transit: { line: 'k412Bus', walk: p(5, 'min', ASSUMPTION, { range: [2, 15], confidence: 'low', note: 'from the town stop' }) },
    // (it sells at its pumps: fetched in approved cans by private persons, up to 60 l a can and 240 l a vehicle, ADR 1.1.3.1 a;
    // the cans are not a good of their own yet, as water is carried in cans: a limit)
    delivery: 'collect',
    fleet: p(1, '1', ASSUMPTION, { confidence: 'low', note: 'it delivers nothing' }),
    vehicleProfile: 'van',
    openDays: [0, 1, 2, 3, 4, 5, 6],
    openFrom: h(6),
    openTo: h(22),
    offers: {
      // (paid at the pump as anyone pays, tax included: the 2025 year's average; 2026 rose to 2.27 in September, ADAC)
      petrol: { price: q(1.69, 'EUR/l', PETROL, 'Super E10, ADAC yearly average 2025 (1.688 EUR/l at the pump); range 1.60–2.27 (2025 low months to September 2026)'), leadTime: d(0, [0, 0]), minOrder: q(1, 'l') },
    },
  },
  grocer: {
    label: 'Supermarkt Göttingen (delivery service)',
    kind: 'merchant',
    distance: p(9, 'km', ASSUMPTION, { confidence: 'low', note: 'a supermarket in Göttingen that delivers' }),
    // (in town: the bus into Göttingen stops some ten minutes' walk from it)
    transit: { line: 'k412Bus', walk: p(10, 'min', ASSUMPTION, { range: [3, 20], confidence: 'low', note: 'from the town stop to the supermarket' }) },
    // a delivery service brings it to the door, or the kerb: no further
    delivery: 'kerb',
    punctuality: ROUND_PUNCTUAL,
    fleet: p(2, '1', ASSUMPTION, { range: [1, 4], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'van',
    openFrom: h(8),
    openTo: h(20),
    // (handed to one of ours at the door: a delivery service rings, waits a few minutes, and takes it back: S5)
    handover: 'attended',
    ringsAhead: p(15, 'min', ASSUMPTION, { range: [5, 30], confidence: 'low', note: 'a supermarket delivery service’s driver rings shortly before (estimate)' }),
    failed: { fee: p(5, 'EUR', ASSUMPTION, { range: [0, 10], confidence: 'low', note: 'a missed delivery slot of a supermarket delivery service: a fee or the delivery charge lost (estimate)' }), wait: p(10, 'min', ASSUMPTION, { range: [5, 15], confidence: 'low', note: 'a driver on a round waits a few minutes at the door (estimate)' }), attempts: 2 },
    offers: {
      'soap.bar': { price: q(8, 'EUR/kg', ASSUMPTION, 'ESTIMATE: supermarket bar soap ≈ 0.5–1.2 EUR a 100 g bar'), leadTime: d(1, [0, 2]), minOrder: q(0.1, 'kg') },
      'food.dry': { price: q(2, 'EUR/kg', ASSUMPTION, 'ESTIMATE: pasta ≈ 1.2–2, rice ≈ 2–3, oats ≈ 1.5 EUR/kg at German supermarkets 2025/26'), leadTime: d(1, [0, 2]), minOrder: q(5, 'kg') },
      'food.provisions': {
        price: q(3.5, 'EUR/kg', ASSUMPTION, 'ESTIMATE: a basket of keeping foods at German supermarket prices 2025/26 (pasta ≈ 1.5–2, rice ≈ 2–3, bread ≈ 3–4, cheese ≈ 9–12 EUR/kg)'),
        leadTime: d(1, [0, 2]),
        minOrder: q(10, 'kg'),
      },
      'water.drinking': {
        price: q(0.3, 'EUR/l', ASSUMPTION, 'ESTIMATE: still mineral water at discounters ≈ 0.15–0.5 EUR/l'),
        leadTime: d(1, [0, 2]),
        minOrder: q(18, 'l'),
      },
    },
  },
  villageShop: {
    label: 'Dorfladen Rosdorf',
    kind: 'merchant',
    distance: p(3.5, 'km', ASSUMPTION, { confidence: 'low', note: 'the village shop of the next village over the hill' }),
    // a village shop: what is bought is carried home
    delivery: 'collect',
    fleet: p(1, '1', ASSUMPTION, { range: [1, 2], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'van',
    openFrom: h(7),
    openTo: h(18.5),
    offers: {
      'food.dry': { price: q(2.5, 'EUR/kg', ASSUMPTION, 'ESTIMATE: a village shop asks some 20 % above the supermarket'), leadTime: d(1, [0, 2]), minOrder: q(1, 'kg') },
      'food.provisions': {
        price: q(4.2, 'EUR/kg', ASSUMPTION, 'ESTIMATE: a village shop asks some 20 % above the supermarket'),
        leadTime: d(1, [0, 2]),
        minOrder: q(5, 'kg'),
      },
      'water.drinking': {
        price: q(0.45, 'EUR/l', ASSUMPTION, 'ESTIMATE: bottled water at a village shop'),
        leadTime: d(1, [0, 2]),
        minOrder: q(6, 'l'),
      },
      'soap.bar': { price: q(10, 'EUR/kg', ASSUMPTION, 'ESTIMATE: a village shop: a bar ≈ 1 EUR'), leadTime: d(1, [0, 2]), minOrder: q(0.1, 'kg') },
    },
  },
  outdoor: {
    label: 'Outdoor- und Zeltverleih Göttingen',
    kind: 'merchant',
    distance: p(7, 'km', ASSUMPTION, { confidence: 'low', note: 'an outdoor shop that also sells used event tents' }),
    transit: { line: 'k412Bus', walk: p(15, 'min', ASSUMPTION, { range: [5, 25], confidence: 'low', note: 'from the town stop to the shop' }) },
    // sent by van to the kerb
    delivery: 'kerb',
    punctuality: ROUND_PUNCTUAL,
    fleet: p(1, '1', ASSUMPTION, { range: [1, 2], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'van',
    openFrom: h(9),
    openTo: h(19),
    // (a parcel or a van to the kerb: handed over and signed for, S5)
    handover: 'attended',
    ringsAhead: p(0, 'min', ASSUMPTION, { range: [0, 10], confidence: 'low', note: 'a parcel service does not ring ahead: it rings at the door (estimate)' }),
    failed: { fee: p(0, 'EUR', ASSUMPTION, { range: [0, 10], confidence: 'low', note: 'a parcel not delivered: tried again the next working day without charge (estimate)' }), wait: p(5, 'min', ASSUMPTION, { range: [2, 10], confidence: 'low', note: 'a parcel driver rings and moves on (estimate)' }), attempts: 2 },
    offers: {
      'kit.rainCatcher': { price: q(80, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: a 3 × 4 m tarp ≈ 25 EUR, a 200 l rain barrel ≈ 40 EUR, lines and poles'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'filter.gravity': { price: q(60, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: gravity water filters ≈ 40–120 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'bottle.water': { price: q(12, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: refillable 1 l bottles ≈ 5–30 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'toilet.bucket': { price: q(45, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: camping bucket toilets ≈ 25–80 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'soap.bar': { price: q(9, 'EUR/kg', ASSUMPTION, 'ESTIMATE: a 100 g bar of soap ≈ 0.6–1.5 EUR'), leadTime: d(1, [0, 3]), minOrder: q(0.1, 'kg') },
      'cover.sawdust': { price: q(0.5, 'EUR/kg', ASSUMPTION, 'ESTIMATE: a 20 kg bale of shavings ≈ 8–15 EUR'), leadTime: d(1, [0, 3]), minOrder: q(10, 'kg') },
      'heater.gas': { price: q(60, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: small propane heaters ≈ 40–120 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'grill.charcoal': { price: q(40, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: small kettle grills ≈ 25–80 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'stove.tent': { price: q(250, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: tent stoves ≈ 150–500 EUR'), leadTime: d(3, [1, 10]), minOrder: q(1, 'pcs') },
      'fuel.propane': { price: q(3.5, 'EUR/kg', ASSUMPTION, 'ESTIMATE: an 11 kg bottle refilled ≈ 30–45 EUR'), leadTime: d(1, [0, 3]), minOrder: q(5, 'kg') },
      'stove.camping': { price: q(70, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: two-burner camping stoves ≈ 40–150 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'light.headlamp': { price: q(25, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: LED headlamps ≈ 15–60 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'heater.electric': { price: q(30, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: fan heaters ≈ 20–60 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'hob.induction': { price: q(60, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: single induction hobs ≈ 40–100 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'fuel.charcoal': { price: q(2, 'EUR/kg', ASSUMPTION, 'ESTIMATE: bagged charcoal ≈ 1.5–3 EUR/kg'), leadTime: d(1, [0, 3]), minOrder: q(3, 'kg') },
      'fuel.firewood': { price: q(0.3, 'EUR/kg', ASSUMPTION, 'ESTIMATE: split firewood ≈ 0.2–0.5 EUR/kg'), leadTime: d(1, [0, 3]), minOrder: q(10, 'kg') },
      'bedding.bag3season': { price: q(70, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: three-season synthetic bags ≈ 40–120 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'bedding.bagWinter': { price: q(180, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: winter bags ≈ 120–400 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'bedding.matFoam': { price: q(20, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: foam mats ≈ 10–40 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'bedding.matInsulated': { price: q(90, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: insulated air mats ≈ 60–180 EUR'), leadTime: d(1, [0, 3]), minOrder: q(1, 'pcs') },
      'kit.tent2': {
        price: q(150, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: a solid two-person dome tent ≈ 80–300 EUR'),
        leadTime: d(1, [0, 3]),
        minOrder: q(1, 'pcs'),
      },
      'kit.kitchenTent': {
        price: q(220, 'EUR/pcs', ASSUMPTION, 'ESTIMATE: a used 6 × 12 m frame tent ≈ 2,500–4,500 EUR, in its 15 pieces'),
        leadTime: d(3, [1, 10]),
        minOrder: q(15, 'pcs'),
      },
    },
  },
  concretePlant: {
    label: 'Transportbetonwerk Göttingen',
    kind: 'concretePlant',
    distance: p(10, 'km', ASSUMPTION, { confidence: 'low' }),
    punctuality: PLANT_PUNCTUAL,
    fleet: p(4, '1', ASSUMPTION, { range: [2, 8], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'mixer',
    openFrom: h(6),
    openTo: h(16),
    offers: {
      'concrete.c25': {
        price: q(
          196,
          'EUR/m3',
          LEINWEBER,
          '2024 list 188.50 delivered (incl. Maut/Diesel/CO2) + ~4 % to 2026; range 165–215. Winter +6.50, loads < 7 m3 +25 EUR/m3 not modelled. Delivered by truck mixer',
        ),
        leadTime: d(1, [1, 3]),
        minOrder: q(1, 'm3'),
      },
    },
  },
  biomassPlant: {
    label: 'Biomasse-Heizkraftwerk Göttingen (wood chips)',
    kind: 'buyer',
    distance: p(10, 'km', ASSUMPTION, { confidence: 'low', note: 'fictional biomass heating plant; collects green wood for chipping with its tipper' }),
    fleet: p(2, '1', ASSUMPTION, { range: [1, 4], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'tipper4',
    openFrom: h(7),
    openTo: h(16),
    offers: {
      'wood.brash': {
        price: q(12, 'EUR/t', ASSUMPTION, 'ESTIMATE, to be sourced: branches and tops for chipping, collected (forest residue chips ≈ 60–100 EUR/t dry delivered; green brash at the roadside little: 0–25 EUR/t)'),
        leadTime: d(7, [3, 21]),
        minOrder: q(5, 't', ASSUMPTION, 'ESTIMATE: a tipper load is not sent for less'),
      },
    },
  },
  landscaper: {
    label: 'Garten- und Landschaftsbau Leinetal (topsoil)',
    kind: 'buyer',
    distance: p(8, 'km', ASSUMPTION, { confidence: 'low', note: 'fictional landscaping firm; takes good topsoil for gardens' }),
    fleet: p(2, '1', ASSUMPTION, { range: [1, 4], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'tipper4',
    openFrom: h(7),
    openTo: h(16),
    offers: {
      'soil.topsoil': {
        price: q(4, 'EUR/t', ASSUMPTION, 'ESTIMATE, to be sourced: unscreened topsoil taken from a site (screened garden topsoil sells at some 20–35 EUR/t; raw, the firm pays little)'),
        leadTime: d(5, [2, 14]),
        minOrder: q(10, 't', ASSUMPTION, 'ESTIMATE: a tipper load'),
      },
    },
  },
  secondHand: {
    label: 'Gebrauchtwaren Outdoor Göttingen (used camping gear)',
    kind: 'buyer',
    distance: p(7, 'km', ASSUMPTION, { confidence: 'low', note: 'fictional second-hand outdoor shop; comes for what it buys with its van' }),
    fleet: p(1, '1', ASSUMPTION, { range: [1, 2], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'van',
    openFrom: h(10),
    openTo: h(18),
    offers: {
      'kit.tent2': {
        price: q(60, 'EUR/pcs', ASSUMPTION, 'ESTIMATE, to be sourced: a two-person dome tent hardly used, bought in at some 40 % of new (150 EUR)'),
        leadTime: d(3, [1, 7]),
        minOrder: q(1, 'pcs'),
        // a tent pitched all year lasts some two years (the tent's life in practice-de structures)
        byAge: { life: p(2, 'a', ASSUMPTION, { range: [0.5, 5], confidence: 'low', note: 'pitched all year round, sunlight weakens the fly within a year or two' }), floor: p(0.1, '1', ASSUMPTION, { range: [0, 0.25], confidence: 'low', note: 'ESTIMATE, to be sourced: a worn-out tent still bought for its poles and pegs' }) },
      },
      'bedding.bag3season': { price: q(15, 'EUR/pcs', ASSUMPTION, 'ESTIMATE, to be sourced: a used three-season bag bought in'), leadTime: d(3, [1, 7]), minOrder: q(1, 'pcs') },
      'bedding.bagWinter': { price: q(50, 'EUR/pcs', ASSUMPTION, 'ESTIMATE, to be sourced: a used winter bag bought in'), leadTime: d(3, [1, 7]), minOrder: q(1, 'pcs') },
    },
  },
  timberYard: {
    label: 'Holzhof Leinetal (sawmill and firewood yard)',
    kind: 'buyer',
    distance: p(TIMBER_YARD_KM, 'km', ASSUMPTION, { confidence: 'low', note: 'fictional sawmill with a firewood yard; buys roadside and collects with its own timber lorry' }),
    fleet: p(2, '1', ASSUMPTION, { range: [1, 4], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'flatbed',
    openFrom: h(7),
    openTo: h(16),
    offers: {
      // what the yard pays at the roadside (frei Waldstraße): it collects, so no haulage comes off
      'wood.logs': {
        price: q(55, 'EUR/t', ASSUMPTION, 'ESTIMATE, to be sourced: mixed small roundwood of a hand felling, mostly industrial and firewood grade, roadside ≈ 30–110 EUR/t (sawlogs of spruce ≈ 90–100 EUR/fm, industrial wood ≈ 35–50 EUR/fm, some 0.8–1.0 t a fm green)'),
        leadTime: d(7, [3, 21]),
        minOrder: q(10, 't', ASSUMPTION, 'ESTIMATE: a timber lorry is not sent for less than about half a load'),
      },
      'fuel.firewood': {
        price: q(0.12, 'EUR/kg', ASSUMPTION, 'ESTIMATE, to be sourced: seasoned split firewood bought in by a dealer ≈ 0.08–0.18 EUR/kg (retail ≈ 0.2–0.5 EUR/kg)'),
        leadTime: d(5, [2, 14]),
        minOrder: q(1000, 'kg', ASSUMPTION, 'ESTIMATE: about two stacked m³'),
      },
    },
  },
  // site toilets (realism S1b): bought from a sanitary hire firm and set down by its lorry with a crane; its suction truck
  // pumps the tank out on call. (Hire with a weekly service is how firms usually have them: not modelled, the toilet is
  // bought and each pump-out ordered: MODELS.md)
  toiletHire: {
    label: 'Sanitärservice Leinetal (mobile toilets: sale and service)',
    kind: 'merchant',
    distance: p(12, 'km', ASSUMPTION, { confidence: 'low', note: 'a sanitary hire firm serving the district' }),
    punctuality: ROUND_PUNCTUAL,
    fleet: p(1, '1', ASSUMPTION, { range: [1, 3], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'flatbed',
    openFrom: h(7),
    openTo: h(16),
    // (set up where we show it: one of ours there, S5)
    handover: 'attended',
    ringsAhead: p(30, 'min', ASSUMPTION, { range: [15, 60], confidence: 'low', note: 'a hire firm’s driver rings ahead when he is on his way (estimate)' }),
    failed: { fee: p(60, 'EUR', ASSUMPTION, { range: [30, 100], confidence: 'low', note: 'a wasted trip of the hire firm’s lorry (estimate)' }), wait: p(20, 'min', ASSUMPTION, { range: [10, 30], confidence: 'low', note: 'its driver waits for someone to show where it goes (estimate)' }), attempts: 2 },
    offers: {
      'toilet.mobile': { price: q(950, 'EUR/pcs', ASSUMPTION, 'ESTIMATE, to be sourced: a new site toilet cabin ≈ 700–1,400 EUR, used ones from ≈ 400 EUR (hire ≈ 60–100 EUR a month with a weekly service)'), leadTime: d(2, [1, 5]), minOrder: q(1, 'pcs') },
    },
  },
  toiletService: {
    label: 'Sanitärservice Leinetal (suction truck: toilet tanks pumped out)',
    kind: 'disposalSite',
    distance: p(12, 'km', ASSUMPTION, { confidence: 'low', note: 'the same firm’s suction truck, to a sewage works' }),
    fleet: p(1, '1', ASSUMPTION, { range: [1, 2], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'tanker',
    openFrom: h(7),
    openTo: h(16),
    offers: {
      'waste.sewage': {
        price: q(0.16, 'EUR/kg', ASSUMPTION, 'ESTIMATE, to be sourced: a pump-out and clean of a site toilet ≈ 30–50 EUR for its 250 l tank, call-out included'),
        leadTime: d(2, [1, 5]),
        minOrder: q(25, 'kg', ASSUMPTION, 'ESTIMATE: not called out for a tank a tenth full'),
      },
    },
  },
  wasteService: {
    label: 'Entsorgungsbetrieb Göttingen (waste collection, sack and skip service)',
    kind: 'disposalSite',
    distance: p(9, 'km', ASSUMPTION, { confidence: 'low', note: 'the district’s waste service and its contractors in Göttingen' }),
    fleet: p(2, '1', ASSUMPTION, { range: [1, 4], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'van',
    openFrom: h(7),
    openTo: h(15),
    offers: {
      'waste.household': {
        price: q(0.6, 'EUR/kg', ASSUMPTION, 'ESTIMATE, to be sourced: residual waste collected on call in sacks (fee per sack of some 70 l and 7–10 kg, about 4–8 EUR, collection included)'),
        leadTime: d(3, [1, 10]),
        minOrder: q(10, 'kg', ASSUMPTION, 'ESTIMATE: a sack or so'),
      },
      'waste.cinders': {
        price: q(0.6, 'EUR/kg', ASSUMPTION, 'ESTIMATE: as residual waste, in sacks'),
        leadTime: d(3, [1, 10]),
        minOrder: q(10, 'kg', ASSUMPTION, 'ESTIMATE: a sack or so'),
      },
    },
  },
  disposal: {
    label: 'Bodendeponie / Verfüllung Rosdorf (BM-0 / Z0)',
    kind: 'disposalSite',
    distance: p(DISPOSAL_KM, 'km', ASSUMPTION, { confidence: 'low', note: 'fictional soil recycling / backfill site' }),
    fleet: p(6, '1', ASSUMPTION, { range: [3, 12], confidence: 'low', note: 'vehicles it sends to one customer at once (an estimate)' }),
    vehicleProfile: 'tipper4',
    openFrom: h(7),
    openTo: h(16),
    offers: {
      'soil.fill': {
        price: delivered(13.7, DISPOSAL_KM, BVFW, 'gate fee BM-0 with BGA analysis (ErsatzbaustoffV/BBodSchV) 13.70 EUR/t + haulage; Stottmeier 13.30', [13.3, 18.7]),
        leadTime: d(1, [0, 2]),
        minOrder: q(1, 't'),
      },
      'soil.spoil': {
        price: delivered(14.7, DISPOSAL_KM, cite(BVFW, 'LAGA Z0 with analysis 14.70, without 18.70; HH Z0* 15–28, Z1.1 17.50–28 EUR/t'), 'gate fee Z0 (unsuitable but uncontaminated soil) + haulage', [14.7, 28.0]),
        leadTime: d(1, [0, 2]),
        minOrder: q(1, 't'),
      },
      'waste.construction': {
        price: delivered(25, DISPOSAL_KM, ASSUMPTION, 'gate fee for mixed mineral demolition waste (Bauschutt, ESTIMATE 15–40 EUR/t) + haulage', [15, 40]),
        leadTime: d(1, [0, 2]),
        minOrder: q(1, 't'),
      },
      'waste.fireDebris': {
        price: delivered(250, DISPOSAL_KM, ASSUMPTION, 'gate fee for mixed fire debris (Brandschutt: sorted, often treated as contaminated, ESTIMATE 150–400 EUR/t) + haulage', [150, 400]),
        leadTime: d(1, [0, 2]),
        minOrder: q(0.1, 't'),
      },
      'soil.topsoil': {
        price: delivered(10, DISPOSAL_KM, cite(HH_DISPOSAL, 'topsoil is usually re-sold, gate fee below mineral soil — ESTIMATE'), 'gate fee topsoil (ESTIMATE 5–14 EUR/t) + haulage', [5, 14]),
        leadTime: d(1, [0, 2]),
        minOrder: q(1, 't'),
      },
    },
  },
};

/**
 * What each supplier has of what it sells (design/physical-state.md 8c, finding 18: the outside world is finite): at
 * most `held`, made or restocked at `perDay`; held 0 is made to order at that rate (a plant mixes each load). Estimates
 * of the size of such businesses, low confidence; a supplier said nothing of has as much as wanted (the supermarket's
 * delivery service, the fuel dealer's tankers).
 */
const STOCK_SRC = { title: 'Estimate: the size of such a business near Göttingen (to be sourced)', publisher: 'Constructible City' };
const stocks: Record<string, Record<string, [number, number, string]>> = {
  // a quarry's stockpiles and its crusher's day (some 150 t an hour)
  quarry: { 'agg.fill': [20000, 1500, 't'], 'agg.fss': [20000, 1500, 't'], 'agg.sts': [15000, 1200, 't'], 'agg.wearing': [8000, 800, 't'], 'agg.shoulder': [8000, 800, 't'], 'soil.topsoil': [3000, 200, 't'] },
  // hot mix is made to order (some 150 t an hour, one product at a time)
  asphaltPlant: { 'asphalt.base': [0, 1200, 't'], 'asphalt.binder': [0, 1200, 't'], 'asphalt.surface': [0, 1200, 't'], 'bitumen.emulsion': [30, 15, 't'] },
  // a mixing plant of some 60 m³ an hour
  concretePlant: { 'concrete.c25': [0, 600, 'm3'] },
  // the builders' merchant's yard, restocked by its wholesalers
  merchant: { 'pipe.drain300': [120, 40, 'pcs'], 'pipe.culvert': [40, 10, 'pcs'], 'steel.rebar': [25, 10, 't'], 'petrol.2t': [400, 200, 'l'], 'brick.nf': [30000, 8000, 'pcs'], 'timber.kvh': [30, 10, 'm3'] },
  // a village shop's shelves, filled each morning
  villageShop: { 'food.dry': [40, 25, 'kg'], 'food.provisions': [60, 40, 'kg'], 'water.drinking': [180, 120, 'l'], 'soap.bar': [3, 1.5, 'kg'] },
  // an outdoor shop: a few of each on the shelf, more from the wholesaler in days
  // a sanitary hire firm's yard: cabins on hand, more from its depots
  toiletHire: { 'toilet.mobile': [20, 4, 'pcs'] },
  outdoor: { 'light.headlamp': [20, 5, 'pcs'], 'kit.rainCatcher': [3, 1, 'pcs'], 'filter.gravity': [4, 1, 'pcs'], 'bottle.water': [30, 10, 'pcs'], 'toilet.bucket': [3, 1, 'pcs'], 'soap.bar': [2, 1, 'kg'], 'cover.sawdust': [200, 100, 'kg'], 'heater.gas': [3, 1, 'pcs'], 'grill.charcoal': [3, 1, 'pcs'], 'stove.tent': [2, 0.5, 'pcs'], 'fuel.propane': [220, 110, 'kg'], 'stove.camping': [4, 1, 'pcs'], 'fuel.charcoal': [100, 50, 'kg'], 'fuel.firewood': [300, 150, 'kg'], 'bedding.bag3season': [6, 2, 'pcs'], 'bedding.bagWinter': [3, 1, 'pcs'], 'bedding.matFoam': [10, 3, 'pcs'], 'bedding.matInsulated': [6, 2, 'pcs'], 'kit.tent2': [4, 1, 'pcs'], 'kit.kitchenTent': [30, 15, 'pcs'] },
};
for (const [sid, offers] of Object.entries(stocks)) {
  for (const [mid, [held, perDay, unit]] of Object.entries(offers)) {
    const offer = (suppliers as unknown as Record<string, { offers: Record<string, Record<string, unknown>> }>)[sid]!.offers[mid];
    if (!offer) throw new Error(`stocks: ${sid} does not offer ${mid}`);
    offer.stock = { held: q(held, unit, STOCK_SRC, 'what it holds at most'), perDay: q(perDay, unit, STOCK_SRC, 'what it makes or restocks a working day, over its opening hours') };
  }
}
