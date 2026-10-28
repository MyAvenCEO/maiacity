/**
 * Buildings: element-method types (DIN 276), subcontracted trade activities and settings.
 * Sources: research/de/buildings.json / .md (BKI 2025/2026 element prices, ARH Aufwandswerte,
 * Hofstadler, ZDH order backlog, BBSR/BNB service lives, maxit/Keim datasheets).
 * Prices are NET (BKI gross ÷ 1.19); subcontract prices include material.
 */
import type { Source } from '../../kernel/src/index.ts';
import { p } from './sources.ts';

const BKI26 = { title: 'BKI Baukosten 2026 — Bauelemente (Büro, einfacher Standard, free sample), net = gross/1.19', publisher: 'BKI', year: 2026 };
const BKI25 = { title: 'BKI Baukosten Positionen 2025', publisher: 'BKI', year: 2025 };
const ARH = { title: 'ARH Arbeitszeit-Richtwerte Hochbau (Mauerwerk), via IZB', publisher: 'Zeittechnik-Verlag / IZB', year: 2010 };
const HOF = { title: 'Hofstadler: Bauablaufplanung und Logistik im Baubetrieb (Schalung)', publisher: 'Springer', year: 2014 };
const ZDH = { title: 'ZDH Konjunkturbericht Q4/2025 — Auftragsreichweite', publisher: 'Zentralverband des Deutschen Handwerks', year: 2025 };
const BNB = { title: 'BBSR: Nutzungsdauern von Bauteilen für Lebenszyklusanalysen nach BNB', publisher: 'BBSR', year: 2017 };
const BFS = { title: 'bauforumstahl: Kosten Stahlhallen (4Q2023)', publisher: 'bauforumstahl', year: 2023 };
const TDS = { title: 'Manufacturer technical data sheets (maxit render, KEIM silicate paint)', publisher: 'maxit / KEIM', year: 2025 };
const DIN1996 = { title: 'DIN EN 1996-2/NA — no masonry in frost', publisher: 'DIN', year: 2019 };
const MATURITY = { title: 'ASTM C1074 (estimating concrete strength by the maturity method: Nurse-Saul, datum −10 °C) with DIN EN 13670 / DIN 1045-3 striking times (≈ 10 days at 15 °C, about double at 5–10 °C)', publisher: 'ASTM / DIN', year: 2019 };
const RENDER = { title: 'Putz- und Stuckgewerbe rule of thumb: a mineral render dries some 1 day per mm before it is painted (at 20 °C, 65 % RH); slower when cold', publisher: 'Bundesverband Ausbau und Fassade (guidance)', year: 2020 };
const EST = { title: 'Agent estimate (research/de/buildings.md, low confidence)', publisher: 'Constructible City research', year: 2026 };

const MAIN_LEAD = p(87.5, 'd', ZDH, { confidence: 'medium', note: 'Bauhauptgewerbe order backlog 12.5 weeks (Q4/2025)' });
const FIT_LEAD = p(69, 'd', ZDH, { confidence: 'medium', note: 'Ausbaugewerbe order backlog 9.9 weeks (Q4/2025)' });
const outdoor = (minTemp: number, src: Source = DIN1996) => ({ minTemp: p(minTemp, '°C', src), maxPrecip: p(1, 'mm/h', EST) });

type Delivery = {
  material: string;
  label: string;
  tPerUnit: number;
  profile: string;
  note: string;
};

const trade = (
  label: string,
  unit: string,
  category: string,
  price: [number, string, Source, Record<string, unknown>?],
  output: [number, Source, string],
  crewSize: number,
  lead: object,
  weather: object,
  color: string,
  delivery?: Delivery,
) => ({
  label,
  category,
  unit,
  measure: 'none',
  crew: [],
  equipment: [],
  rate: [],
  jobEfficiency: p(0.9, '1', EST, { note: 'subcontractor crew, organised site' }),
  weather,
  materials: {},
  subcontract: {
    label: `${label} contractor`,
    price: p(price[0], price[1], price[2], (price[3] ?? {}) as never),
    output: p(output[0], `${unit}/h`, output[1], { note: output[2] }),
    crewSize,
    leadTime: lead,
    ...(delivery
      ? {
          deliveries: {
            material: delivery.material,
            label: delivery.label,
            perUnit: p(delivery.tPerUnit, `t/${unit}`, EST, {
              note: delivery.note,
              confidence: 'low',
            }),
            profile: delivery.profile,
          },
        }
      : {}),
  },
  machineLoad: p(0, '1', EST),
  color,
});

export const buildingActivities = {
  'bld.foundation': { ...trade(
    'Foundations & ground slab (KG 322)',
    'm2',
    'structure',
    [205, 'EUR/m2', BKI26, { range: [142, 329], confidence: 'medium' }],
    [4.4, HOF, 'formwork 0.5 + rebar ≈0.4 + concrete ≈0.2 h/m² → ~0.9 h/m², crew of 4'],
    4,
    MAIN_LEAD,
    outdoor(5),
    '#9e9e9e',
    {
      material: 'concrete.c25',
      label: 'ready-mix concrete + rebar',
      tPerUnit: 0.62,
      profile: 'mixer',
      note: '≈ 0.25 m³/m² slab incl. strip footings × 2.4 t/m³ + ≈ 20 kg/m² rebar',
    },
  ), cures: { datum: p(-10, '°C', MATURITY, { confidence: 'medium' }), reference: p(20, '°C', MATURITY, { confidence: 'high' }), age: p(72, 'h', MATURITY, { range: [48, 120], confidence: 'low', note: 'a ground slab carries masonry after some 3 days at 20 °C' }), what: 'harden enough to build on' } },
  'bld.walls': trade(
    'External walls, filled Planziegel 36.5 (KG 331)',
    'm2',
    'structure',
    [190, 'EUR/m2', EST, { range: [160, 240], confidence: 'low' }],
    [6, ARH, '0.41–0.47 h/m² by hand (+0.10 storey height); crew of 3 masons'],
    3,
    MAIN_LEAD,
    outdoor(5),
    '#c1440e',
    {
      material: 'masonry.block',
      label: 'Planziegel & mortar',
      tPerUnit: 0.27,
      profile: 'flatbed',
      note: 'filled Planziegel 36.5 ≈ 0.7 t/m³ × 0.365 m + mortar',
    },
  ),
  'bld.slab': { ...trade(
    'In-situ concrete floor slab (KG 351)',
    'm2',
    'structure',
    [150, 'EUR/m2', EST, { range: [100, 214], confidence: 'low', note: 'bfs 2024 83–124 €/m² + small-job overheads' }],
    [3.6, HOF, 'formwork 0.4–0.5 + rebar ~0.4 + placing ~0.2 h/m², crew of 4'],
    4,
    MAIN_LEAD,
    outdoor(5),
    '#8d8d8d',
    {
      material: 'concrete.c25',
      label: 'ready-mix concrete + rebar',
      tPerUnit: 0.5,
      profile: 'mixer',
      note: '≈ 0.2 m³/m² × 2.4 t/m³ + ≈ 18 kg/m² rebar',
    },
  ), cures: { datum: p(-10, '°C', MATURITY, { confidence: 'medium' }), reference: p(20, '°C', MATURITY, { confidence: 'high' }), age: p(168, 'h', MATURITY, { range: [120, 240], confidence: 'medium', note: 'a floor slab struck and loaded after about a week at 20 °C (8–10 days at 15 °C, double at 5 °C)' }), what: 'harden before it is struck and built on' } },
  'bld.internalWalls': trade(
    'Internal walls (KG 341/342)',
    'm2',
    'structure',
    [120, 'EUR/m2', BKI26, { range: [96, 159], confidence: 'medium', note: 'mean of load-bearing 159 / non-load-bearing 96' }],
    [5, ARH, '≈0.6 h/m², crew of 3'],
    3,
    MAIN_LEAD,
    {},
    '#d7a27a',
    {
      material: 'masonry.block',
      label: 'bricks & mortar',
      tPerUnit: 0.15,
      profile: 'flatbed',
      note: 'mixed 11.5–24 cm internal walls',
    },
  ),
  'bld.roof': trade(
    'Pitched roof complete: rafters, insulation, tiles (KG 361/363/364)',
    'm2',
    'envelope',
    [320, 'EUR/m2', EST, { range: [250, 420], confidence: 'low' }],
    [2.9, EST, 'structure 0.6 + tiling 0.5 + insulation 0.3 h/m², crew of 4'],
    4,
    MAIN_LEAD,
    { maxPrecip: p(1, 'mm/h', EST), maxWind: p(14, 'm/s', EST, { confidence: 'low' }) },
    '#8e3b2f',
    {
      material: 'roof.package',
      label: 'timber, insulation & tiles',
      tPerUnit: 0.075,
      profile: 'flatbed',
      note: 'concrete tiles ≈ 45 kg/m² + rafters/battens ≈ 20 kg/m² + insulation',
    },
  ),
  'bld.windows': trade(
    'Windows PVC triple glazing (KG 334)',
    'm2',
    'envelope',
    [520, 'EUR/m2', EST, { range: [400, 650], confidence: 'low', note: 'bounded by BKI KG 334 426 €/m² net (office)' }],
    [1.2, EST, '≈3 h per window of ~1.8 m², crew of 2'],
    2,
    FIT_LEAD,
    {},
    '#90caf9',
    {
      material: 'windows',
      label: 'window units',
      tPerUnit: 0.035,
      profile: 'flatbed',
      note: 'triple-glazed PVC ≈ 35 kg/m²',
    },
  ),
  'bld.render': { ...trade('External render (KG 335)', 'm2', 'envelope', [99, 'EUR/m2', BKI26, { confidence: 'medium' }], [6.7, EST, '≈0.45 h/m², crew of 3'], 3, FIT_LEAD, outdoor(5, TDS), '#efe6d5', {
    material: 'render',
    label: 'render (bagged)',
    tPerUnit: 0.035,
    profile: 'flatbed',
    note: '≈ 20 mm lime-cement render ≈ 35 kg/m²',
  }), cures: { datum: p(0, '°C', RENDER, { confidence: 'low', note: 'drying all but stops near freezing' }), reference: p(20, '°C', RENDER, { confidence: 'medium' }), age: p(480, 'h', RENDER, { range: [240, 720], confidence: 'low', note: 'some 20 mm of render, a day a mm at 20 °C' }), what: 'dry before it is painted' } },
  'bld.paint': trade(
    'Exterior silicate paint',
    'm2',
    'finishing',
    [22, 'EUR/m2', EST, { range: [15, 30], confidence: 'low' }],
    [12, EST, '≈0.12 h/m² per coat ×2, crew of 2 + scaffold'],
    2,
    FIT_LEAD,
    outdoor(8, TDS),
    '#fff8e1',
    {
      material: 'paint',
      label: 'paint',
      tPerUnit: 0.0012,
      profile: 'van',
      note: '2 coats ≈ 0.6 kg/m² each',
    },
  ),
  'bld.services': trade(
    'Building services: heat pump, sanitary, electrical (KG 400)',
    'm2',
    'services',
    [330, 'EUR/m2', EST, { range: [250, 450], confidence: 'low', note: 'BKI KG 400 medians ≈190 €/m² office; EFH with air/water heat pump higher' }],
    [1.9, EST, 'electrical ≈200 h + plumbing/heating ≈180 h for ~240 m² GFA, crew of 3'],
    3,
    FIT_LEAD,
    {},
    '#ffb74d',
    {
      material: 'mep',
      label: 'pipes, cables, heat pump',
      tPerUnit: 0.02,
      profile: 'flatbed',
      note: 'installation material incl. heat pump unit',
    },
  ),
  'bld.interior': trade(
    'Interior finishes: screed, plaster, drywall, floors, paint',
    'm2',
    'finishing',
    [280, 'EUR/m2', EST, { range: [200, 380], confidence: 'low' }],
    [1.6, EST, '≈2.5 h/m² GFA across trades, crew of 4'],
    4,
    FIT_LEAD,
    {},
    '#bcaaa4',
    {
      material: 'interior',
      label: 'screed, plaster, drywall, flooring',
      tPerUnit: 0.14,
      profile: 'tipper3',
      note: '≈ 50 mm screed ≈ 110 kg/m² + plaster/drywall/floors',
    },
  ),
  'bld.hallSlab': { ...trade(
    'Industrial ground slab (hall)',
    'm2',
    'structure',
    [110, 'EUR/m2', EST, { range: [80, 150], confidence: 'low' }],
    [10, EST, 'large pours, laser screed, crew of 5'],
    5,
    MAIN_LEAD,
    outdoor(5),
    '#9e9e9e',
    {
      material: 'concrete.c25',
      label: 'ready-mix concrete + mesh',
      tPerUnit: 0.5,
      profile: 'mixer',
      note: '≈ 0.2 m³/m² industrial slab',
    },
  ), cures: { datum: p(-10, '°C', MATURITY, { confidence: 'medium' }), reference: p(20, '°C', MATURITY, { confidence: 'high' }), age: p(168, 'h', MATURITY, { range: [96, 240], confidence: 'low', note: 'an industrial slab bears the frame’s columns after about a week at 20 °C' }), what: 'harden before the frame stands on it' } },
  'bld.steelFrame': trade(
    'Steel frame erected (portal frames, 6 m spacing)',
    'm2',
    'structure',
    [100, 'EUR/m2', BFS, { range: [58, 187], confidence: 'medium', note: '2.30–3.40 €/kg × 25–35 kg/m² + purlins/rails' }],
    [3.4, BFS, '~8 weeks erection for ~1,100 m² (crane incl.)'],
    4,
    MAIN_LEAD,
    { maxWind: p(12, 'm/s', EST, { confidence: 'low' }) },
    '#607d8b',
    {
      material: 'steel',
      label: 'steel sections',
      tPerUnit: 0.035,
      profile: 'flatbed',
      note: '25–35 kg/m² (bauforumstahl) + purlins',
    },
  ),
  'bld.sandwich': trade(
    'Sandwich panels 120 mm, walls and roof',
    'm2',
    'envelope',
    [85, 'EUR/m2', EST, { range: [65, 120], confidence: 'low' }],
    [8, EST, 'panel erection with telehandler/crane, crew of 4'],
    4,
    MAIN_LEAD,
    { maxWind: p(10, 'm/s', EST, { confidence: 'low' }), maxPrecip: p(2, 'mm/h', EST) },
    '#b0bec5',
    {
      material: 'panels',
      label: 'sandwich panels',
      tPerUnit: 0.014,
      profile: 'flatbed',
      note: '120 mm PIR panels ≈ 14 kg/m²',
    },
  ),
  'bld.hallServices': trade(
    'Hall services: lighting, power, drainage',
    'm2',
    'services',
    [80, 'EUR/m2', EST, { range: [50, 150], confidence: 'low' }],
    [6, EST, 'crew of 3'],
    3,
    FIT_LEAD,
    {},
    '#ffb74d',
    {
      material: 'mep',
      label: 'cables, lights, drainage',
      tPerUnit: 0.006,
      profile: 'van',
      note: 'light installation',
    },
  ),
};

const el = (id: string, label: string, din276: string, basis: string, factor: number, activity: string, after: string[], stage: string, place: { on: string; side?: string }, life?: [number, Source], renewal?: { activity: string; factor: number; label: string }) => ({
  id,
  label,
  din276,
  basis,
  factor,
  activity,
  after,
  stage,
  place,
  ...(life ? { serviceLife: p(life[0], 'a', life[1]) } : {}),
  ...(renewal ? { renewal } : {}),
});

const EC1_1 = { title: 'DIN EN 1991-1-1/NA: imposed loads on floors, category A', publisher: 'DIN' };
const EC1_3 = { title: 'DIN EN 1991-1-3/NA: snow loads, zone 2', publisher: 'DIN' };

export const buildingTypes = {
  efh: {
    label: 'Single-family house (massive)',
    description: 'Einfamilienhaus: filled Planziegel 36.5 with lime-cement render, concrete slabs, pitched timber roof with concrete tiles, PVC windows, air/water heat pump. ≈1,660 €/m² GFA net for KG 300+400 (BKI-NHK 2026 Stufe 3 derived).',
    category: 'residential',
    length: p(12, 'm', EST),
    width: p(10, 'm', EST),
    floors: 2,
    storeyHeight: p(2.8, 'm', EST, { note: 'MBO § 47 clear height ≥ 2.40 m' }),
    roofPitch: p(38, 'deg', EST, { range: [30, 45] }),
    roofOverhang: p(0.5, 'm', EST),
    windowShare: p(0.18, '1', EST, { range: [0.15, 0.3], note: '≥ 1/8 of floor area as window opening (MBO)' }),
    minLength: p(8, 'm', EST),
    maxLength: p(16, 'm', EST),
    minWidth: p(7, 'm', EST),
    maxWidth: p(12, 'm', EST),
    maxFloors: 3,
    roofStyle: 'gable',
    wallColor: '#efe6d5',
    roofColor: '#8e3b2f',
    structure: {
      dead: p(10, 'kN/m2', EST, { range: [8, 13], confidence: 'low', note: 'a massive house (36.5 cm masonry, concrete slabs, tiled roof) weighs about 8–13 kN per m² of floor area (unit weights after EN 1991-1-1 Annex A)' }),
      imposed: p(1.5, 'kN/m2', EC1_1, { confidence: 'high', note: 'residential floors, category A (DIN EN 1991-1-1/NA)' }),
      bearer: p(0.365, 'm', EST, { confidence: 'medium', note: 'without a foundation the walls bear on the ground with their own thickness' }),
      foundation: 'foundation',
      // walls going up stand on their own above what braces them: the slab over a storey, the roof over the top one,
      // the storey's cross walls (laid alongside them, r41); masons brace them only against what they expect, so a gale
      // can bring them down (DIN EN 1996-2 asks for walls in construction to be secured; no table for when, hence the
      // rule of thumb below)
      unbraced: {
        walls: 'walls',
        slabs: 'slab',
        roof: 'roof',
        cross: 'internal',
        thickness: p(0.365, 'm', EST, { confidence: 'high', note: 'filled Planziegel 36.5' }),
        mass: p(270, 'kg/m2', EST, { range: [230, 330], confidence: 'medium', note: 'filled Planziegel ≈ 0.7 t/m³ × 0.365 m with its mortar (as the trade’s deliveries)' }),
        slenderness: p(7.5, '1', EST, { range: [5, 10], confidence: 'low', note: 'rule of thumb: a storey (2.75 m) of 36.5 cm masonry stands unbraced up to its gust rating' }),
        gust: p(21, 'm/s', EST, { range: [18, 26], confidence: 'low', note: 'a strong gale’s gusts (Bft 9): where the overturning reckoning brings a storey of this wall down (r41)' }),
      },
    },
    elements: [
      el('foundation', 'Foundations & ground slab', '322', 'footprint', 1, 'bld.foundation', [], 'foundation', { on: 'ground' }),
      // storey by storey (H1): a storey's walls, outer and cross, then the slab over it on them, hardened before the next
      // storey's walls go on it; the roof on the top storey's walls
      { ...el('walls', 'External walls', '331', 'wallNet', 1, 'bld.walls', ['foundation'], 'shell', { on: 'walls', side: 'outside' }), lifts: 'storeys' as const, on: ['slab'] },
      { ...el('slab', 'Floor slabs', '351', 'slabArea', 1, 'bld.slab', ['walls', 'internal'], 'shell', { on: 'floors' }), lifts: 'slabs' as const },
      // (the cross walls are laid alongside the outer walls, as masons do: they brace them, r41)
      { ...el('internal', 'Internal walls', '341', 'gfa', 0.5, 'bld.internalWalls', [], 'shell', { on: 'interior' }), with: ['walls'], lifts: 'storeys' as const, on: ['slab'] },
      el('roof', 'Roof (structure, insulation, tiles)', '360', 'roofArea', 1, 'bld.roof', ['walls', 'slab', 'internal'], 'roof', { on: 'roof', side: 'outside' }, [50, BNB], { activity: 'bld.roof', factor: 1, label: 'Re-roof' }),
      el('windows', 'Windows', '334', 'windowArea', 1, 'bld.windows', ['roof'], 'envelope', { on: 'walls', side: 'outside' }, [40, BNB], { activity: 'bld.windows', factor: 1, label: 'Replace windows' }),
      el('render', 'External render', '335', 'wallNet', 1, 'bld.render', ['windows'], 'envelope', { on: 'walls', side: 'outside' }, [45, BNB], { activity: 'bld.render', factor: 1, label: 'Re-render facade' }),
      el('paint', 'Exterior paint', '335', 'wallNet', 1, 'bld.paint', ['render'], 'finishing', { on: 'walls', side: 'outside' }, [15, BNB], { activity: 'bld.paint', factor: 1, label: 'Repaint facade' }),
      el('services', 'Building services (KG 400)', '400', 'gfa', 1, 'bld.services', ['roof'], 'services', { on: 'interior' }, [20, BNB], { activity: 'bld.services', factor: 0.25, label: 'Renew heating & installations' }),
      el('interior', 'Interior finishes', '350', 'gfa', 1, 'bld.interior', ['services', 'windows'], 'finishing', { on: 'interior' }, [15, BNB], { activity: 'bld.interior', factor: 0.3, label: 'Refurbish interior' }),
    ],
  },
  hall: {
    label: 'Steel hall (workshop / storage)',
    description: 'Gewerbehalle: steel portal frames at 6 m, 120 mm sandwich panels, industrial slab, basic services. ≈300–600 €/m² net for a cold hall.',
    category: 'commercial',
    length: p(40, 'm', BFS),
    width: p(25, 'm', BFS, { note: 'usual spans 10–30 m' }),
    floors: 1,
    storeyHeight: p(7, 'm', EST, { range: [5, 10] }),
    roofPitch: p(5, 'deg', EST),
    roofOverhang: p(0.3, 'm', EST),
    windowShare: p(0.05, '1', EST),
    minLength: p(15, 'm', EST),
    maxLength: p(80, 'm', EST),
    minWidth: p(12, 'm', EST),
    maxWidth: p(30, 'm', BFS),
    maxFloors: 1,
    roofStyle: 'shallow',
    wallColor: '#b0bec5',
    roofColor: '#78909c',
    structure: {
      dead: p(1, 'kN/m2', EST, { range: [0.6, 1.5], confidence: 'low', note: 'steel frame, sandwich roof and walls, over the floor area (the slab lies on the ground)' }),
      imposed: p(0.85, 'kN/m2', EC1_3, { range: [0.65, 1.1], confidence: 'medium', note: 'snow on the roof, zone 2 at about 250 m (DIN EN 1991-1-3/NA): the roof’s imposed load' }),
      bearer: p(0.3, 'm', EST, { confidence: 'low', note: 'without the slab, the frame’s columns and sole plates bear on the ground: a strip about 0.3 m wide round the perimeter' }),
      foundation: 'slab',
    },
    elements: [
      el('slab', 'Industrial slab', '322', 'footprint', 1, 'bld.hallSlab', [], 'foundation', { on: 'groundFloor', side: 'inside' }),
      el('frame', 'Steel frame', '330', 'footprint', 1, 'bld.steelFrame', ['slab'], 'shell', { on: 'interior' }),
      el('walls', 'Wall cladding', '335', 'wallNet', 1, 'bld.sandwich', ['frame'], 'envelope', { on: 'walls', side: 'outside' }, [40, BNB], { activity: 'bld.sandwich', factor: 1, label: 'Replace wall panels' }),
      el('roof', 'Roof cladding', '363', 'roofArea', 1, 'bld.sandwich', ['frame'], 'roof', { on: 'roof', side: 'outside' }, [40, BNB], { activity: 'bld.sandwich', factor: 1, label: 'Replace roof panels' }),
      el('services', 'Hall services', '400', 'gfa', 1, 'bld.hallServices', ['walls', 'roof'], 'services', { on: 'interior' }, [25, BNB], { activity: 'bld.hallServices', factor: 0.4, label: 'Renew installations' }),
    ],
  },
};

export const buildingSettings = {
  workingSpace: p(1.0, 'm', EST, { note: 'Arbeitsraum 0.6–1.0 m' }),
  excavationDepth: p(0.8, 'm', EST, { note: 'frost-free founding depth (≈0.8 m, low confidence)' }),
  fillLayerThickness: p(30, 'cm', EST, { note: 'fill laid and compacted in layers of about 30 cm (as for roads)' }),
  maxSlope: p(8, '%', EST),
  depreciation: p(0.03, '1/a', { title: '§ 7 Abs. 4 EStG: linear AfA of 3 % a year for buildings completed after 2022 (residential) and for business buildings', publisher: 'BMJ (gesetze-im-internet.de)' }, { range: [0.02, 0.04], confidence: 'high', note: 'tax depreciation; the useful life on the commercial books may differ' }),
  accessDistance: p(40, 'm', { title: 'Erschließung (BauGB § 30, NBauO § 5): a plot must be connected to a public road; 40 m of driveway is this pack\'s assumption', publisher: 'Constructible City (practice-de)', year: 2026 }, { confidence: 'low' }),
  clearance: p(3, 'm', { title: 'Abstandsflächen (NBauO § 5): 0.5 H, at least 3 m to the boundary', publisher: 'Land Niedersachsen', year: 2012 }, { confidence: 'medium' }),
  sideSlope: p(1.5, '1', EST),
  activities: { survey: 'survey.stakeout', clearing: 'clearing.fell', topsoil: 'earth.topsoil', platform: 'earth.excavate', fill: 'earth.backfill', excavation: 'earth.excavate', acceptance: 'inspection.acceptance', inspection: 'inspection.visual' },
  materials: { topsoil: 'soil.topsoil', soil: 'soil.fill', spoil: 'soil.spoil', importFill: 'agg.fill', logs: 'wood.logs', brash: 'wood.brash' },
  importFillDensity: p(2.0, 't/m3', EST, { note: 'imported granular fill, compacted (as for roads)' }),
  importFillClass: 'sandGravel',
};
