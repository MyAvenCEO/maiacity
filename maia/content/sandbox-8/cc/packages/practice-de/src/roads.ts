/**
 * Road classes, design settings, deterioration constants and maintenance interventions.
 * Sources: research/de/roads.json (RStO 12/24, RLW 2016, RASt 06, ZEB, HDM-4 / Paterson 1991).
 */
const RSTO = { title: 'RStO 12/24 — Richtlinien für die Standardisierung des Oberbaus (Tafel 1 Zeile 1, Tab. 6/7), as quoted in planning documents', publisher: 'FGSV', year: 2024 };
const RLW = { title: 'RLW 2016 / DWA-A 904-1 Richtlinien für den Ländlichen Wegebau', publisher: 'DWA', year: 2016 };
const RAST = { title: 'RASt 06 — Richtlinien für die Anlage von Stadtstraßen', publisher: 'FGSV', year: 2006 };
const ZEB = { title: 'ZEB support points (federal 2018, RLP adaptation)', publisher: 'BASt / LBM RLP', year: 2018 };
const HDM4 = { title: 'HDM-4 Vol. 6 — Modelling road deterioration and works effects', publisher: 'PIARC / World Bank', year: 2000 };
const PAT = { title: 'Paterson, W.D.O. (1991): Deterioration and maintenance of unpaved roads: models of roughness and material loss', publisher: 'Transportation Research Record 1291', year: 1991 };
const HDM3 = { title: 'HDM-III structural cracking initiation (Watanatada et al. 1987)', publisher: 'World Bank', year: 1987 };
const PEINE = { title: 'Landkreis Peine Beschlussvorlage 2024/138 (maintenance costs & life extension)', publisher: 'Landkreis Peine', year: 2024 };
const CAT = { title: 'Caterpillar Performance Handbook, Edition 49 — Weight of Materials', publisher: 'Caterpillar Inc.', year: 2019 };
const EST = { title: 'Model assumption (documented, no direct source)', publisher: 'Constructible City', year: 2026 };

const p = (value: number, unit: string, source: object, extra: Record<string, unknown> = {}) => ({ value, unit, source, ...extra });

const asphaltLayer = (id: string, label: string, kind: string, cm: number, material: string, activity: string) => ({
  id,
  label,
  kind,
  thickness: p(cm, 'cm', RSTO),
  material,
  activity,
  compactedDensity: p(2.45, 't/m3', EST, { range: [2.35, 2.5], note: 'compacted asphalt' }),
  looseDensity: p(2.0, 't/m3', EST),
  extraWidth: p(0, 'm', EST),
});
const fss = {
  id: 'fss',
  label: 'Frost protection layer 0/32',
  kind: 'frostProtection',
  material: 'agg.fss',
  activity: 'base.fss',
  compactedDensity: p(2.2, 't/m3', CAT, { range: [2.1, 2.3] }),
  looseDensity: p(1.7, 't/m3', CAT),
  extraWidth: p(0.5, 'm', RSTO, { note: 'layers widen downwards under the shoulders' }),
};

export const roadClasses = {
  // rung 2: a path made by hand, for walking, bikes and barrows (no car has a speed on 'path')
  pfad: {
    label: 'Gravel path, built by hand',
    description: 'A footpath of 1.2 m: topsoil cut out with spades, the bed tamped, 10 cm of gravel barrowed in, raked and tamped. For walking, bikes and barrows; no car fits.',
    standard: 'EAÖ 2002 (walking ways, by analogy)',
    surface: 'gravel',
    networkSurface: 'path',
    carriageway: p(1.2, 'm', EST, { range: [0.8, 1.5], confidence: 'low', note: 'two can pass, a barrow fits' }),
    shoulder: p(0, 'm', EST),
    crossfall: p(3, '%', EST),
    designSpeed: p(5, 'km/h', EST),
    minRadius: p(3, 'm', EST, { range: [2, 6], confidence: 'low' }),
    maxGrade: p(15, '%', EST, { range: [10, 20], confidence: 'low', note: 'steeper takes steps' }),
    speedLimit: p(15, 'km/h', EST),
    layers: [
      { id: 'wearing', label: 'Gravel 0/16, raked and tamped', kind: 'unboundSurface', thickness: p(10, 'cm', EST, { range: [5, 15], confidence: 'low' }), material: 'agg.wearing', activity: 'hand.gravel', compactedDensity: p(2.0, 't/m3', CAT, { note: 'hand-tamped, less dense than rolled' }), looseDensity: p(1.7, 't/m3', CAT), extraWidth: p(0, 'm', EST) },
    ],
    shoulderMaterial: 'agg.shoulder',
    shoulderMass: p(0, 't/m', EST),
    swales: false,
    activities: { survey: 'hand.stakeout', clearing: 'clearing.fellHand', topsoil: 'hand.topsoil', excavation: 'hand.dig', fill: 'hand.fill', subgrade: 'hand.tamp', acceptance: 'inspection.walk', culvert: 'hand.culvert', inspection: 'hand.survey', grading: 'hand.rake', regravel: 'hand.gravel' },
    freeboard: p(0.3, 'm', EST, { range: [0.2, 0.5], confidence: 'low', note: 'a footpath over a small culvert: dry feet in a flood, not a road’s 1.2 m' }),
    color: '#cdbb94',
  },
  feldweg: {
    label: 'Farm track, unbound',
    description: 'Wirtschaftsweg with unbound wearing course on crushed stone base — cheap, dusty, needs regular grading.',
    standard: 'RLW 2016',
    surface: 'gravel',
    carriageway: p(3.0, 'm', RLW),
    shoulder: p(0.5, 'm', RLW),
    crossfall: p(6, '%', RLW),
    designSpeed: p(30, 'km/h', RLW),
    minRadius: p(15, 'm', RLW, { range: [15, 120] }),
    maxGrade: p(8, '%', RLW, { note: '12 % exceptional; unbound surfaces only up to 8 %' }),
    speedLimit: p(30, 'km/h', EST),
    layers: [
      { id: 'wearing', label: 'Unbound wearing course 0/16', kind: 'unboundSurface', thickness: p(5, 'cm', RLW), material: 'agg.wearing', activity: 'surface.unbound', compactedDensity: p(2.2, 't/m3', CAT), looseDensity: p(1.7, 't/m3', CAT), extraWidth: p(0, 'm', EST) },
      { id: 'sts', label: 'Crushed stone base 0/32', kind: 'unboundBase', thickness: p(25, 'cm', RLW, { range: [25, 30] }), material: 'agg.sts', activity: 'base.sts', compactedDensity: p(2.25, 't/m3', CAT), looseDensity: p(1.7, 't/m3', CAT), extraWidth: p(0.25, 'm', EST) },
    ],
    shoulderMaterial: 'agg.shoulder',
    shoulderMass: p(0.15, 't/m', EST, { note: '0.5 m × 0.15 m × 2.0 t/m³' }),
    swales: true,
    color: '#b9a98c',
  },
  wirtschaftsweg: {
    label: 'Main farm road, asphalt',
    description: 'Hauptwirtschaftsweg: 8 cm asphalt on 25 cm crushed stone base, 3.5 m with trafficable side strips.',
    standard: 'RLW 2016',
    surface: 'asphalt',
    carriageway: p(3.5, 'm', RLW),
    shoulder: p(0.75, 'm', RLW),
    crossfall: p(2.5, '%', RLW),
    designSpeed: p(40, 'km/h', RLW),
    minRadius: p(30, 'm', RLW, { range: [15, 120] }),
    maxGrade: p(8, '%', RLW),
    speedLimit: p(50, 'km/h', EST),
    layers: [
      asphaltLayer('ac', 'Asphalt AC 16 (single layer)', 'asphaltBinder', 8, 'asphalt.binder', 'paving.binder'),
      { id: 'sts', label: 'Crushed stone base 0/32', kind: 'unboundBase', thickness: p(25, 'cm', RLW), material: 'agg.sts', activity: 'base.sts', compactedDensity: p(2.25, 't/m3', CAT), looseDensity: p(1.7, 't/m3', CAT), extraWidth: p(0.3, 'm', EST) },
    ],
    shoulderMaterial: 'agg.shoulder',
    shoulderMass: p(0.23, 't/m', EST, { note: '0.75 m × 0.15 m × 2.0 t/m³' }),
    swales: true,
    color: '#4a4a4a',
  },
  wohnstrasse: {
    label: 'Residential street (Bk0,3)',
    description: 'Wohnstraße per RASt 06: 5.0 m carriageway, 4 cm wearing course + 10 cm asphalt base on a frost protection layer (RStO Tafel 1 Zeile 1).',
    standard: 'RStO 12/24 Bk0,3 · RASt 06',
    surface: 'asphalt',
    loadClass: 'Bk0,3',
    carriageway: p(5.0, 'm', RAST, { range: [4.75, 5.0] }),
    shoulder: p(0.75, 'm', EST),
    crossfall: p(2.5, '%', RAST),
    designSpeed: p(30, 'km/h', RAST),
    minRadius: p(15, 'm', RAST, { note: 'built-up streets min 10 m' }),
    maxGrade: p(8, '%', RAST, { note: '12 % exceptional' }),
    speedLimit: p(30, 'km/h', RAST),
    layers: [asphaltLayer('surface', 'Asphalt wearing course AC 11 D', 'asphaltSurface', 4, 'asphalt.surface', 'paving.surface'), asphaltLayer('base', 'Asphalt base AC 22 T', 'asphaltBase', 10, 'asphalt.base', 'paving.base'), fss],
    frostSafe: { F2: p(40, 'cm', RSTO), F3: p(50, 'cm', RSTO, { confidence: 'low' }) },
    minFrostLayer: p(20, 'cm', EST, { note: 'bearing minimum on F1 subgrade (35 cm FSS lifts Ev2 45→120 MPa)' }),
    shoulderMaterial: 'agg.shoulder',
    shoulderMass: p(0.23, 't/m', EST),
    swales: true,
    color: '#3d3d3d',
  },
  sammelstrasse: {
    label: 'Collector street (Bk1,0)',
    description: 'Sammelstraße per RASt 06: 6.5 m carriageway (bus traffic), 4 cm wearing course + 14 cm asphalt base on frost protection layer.',
    standard: 'RStO 12/24 Bk1,0 · RASt 06',
    surface: 'asphalt',
    loadClass: 'Bk1,0',
    carriageway: p(6.5, 'm', RAST),
    shoulder: p(1.0, 'm', EST),
    crossfall: p(2.5, '%', RAST),
    designSpeed: p(50, 'km/h', RAST),
    minRadius: p(25, 'm', RAST, { note: 'built-up; 80 m outside built-up areas' }),
    maxGrade: p(8, '%', RAST),
    speedLimit: p(50, 'km/h', RAST),
    layers: [asphaltLayer('surface', 'Asphalt wearing course AC 11 D', 'asphaltSurface', 4, 'asphalt.surface', 'paving.surface'), asphaltLayer('base', 'Asphalt base AC 22 T', 'asphaltBase', 14, 'asphalt.base', 'paving.base'), fss],
    frostSafe: { F2: p(50, 'cm', RSTO), F3: p(60, 'cm', RSTO) },
    minFrostLayer: p(20, 'cm', EST),
    shoulderMaterial: 'agg.shoulder',
    shoulderMass: p(0.3, 't/m', EST),
    swales: true,
    color: '#353535',
  },
};

const NSTRG = { title: '§ 6 NStrG (Widmung) and § 11 BauGB (Erschließungsvertrag): a developer builds the streets and hands them over; the municipality dedicates them to public use and keeps them', publisher: 'Niedersächsisches Vorschriftsinformationssystem; BMJ (gesetze-im-internet.de)' };

/**
 * Handing a road over to the municipality (RUNS2 H10): it takes streets built to its standard (the
 * residential and collector streets of RASt; farm tracks stay the farmers'), in good condition at its
 * survey, joined to the network, and decides after its council has met. Numbers are estimates to be sourced.
 */
export const roadDedication = {
  authority: 'gemeinde',
  classes: ['wohnstrasse', 'sammelstrasse'],
  worstGrade: p(2.5, '1', EST, { range: [1.5, 3.5], confidence: 'low', note: 'ZEB grade at the handover survey: defects found are to be mended first (to be sourced; an Erschließungsvertrag sets its own acceptance)' }),
  days: p(90, 'd', EST, { range: [30, 180], confidence: 'low', note: 'acceptance survey, council resolution and the dedication published (to be sourced)' }),
  rule: '§ 6 NStrG, § 11 BauGB',
};

export const roadSettings = {
  frostZone: 'II',
  frostZoneAddition: { I: p(0, 'cm', RSTO), II: p(5, 'cm', RSTO), III: p(15, 'cm', RSTO, { confidence: 'medium' }) },
  cutAddition: p(5, 'cm', RSTO, { note: 'Tab. 7 D: grade line in cut' }),
  highEmbankmentDeduction: p(5, 'cm', RSTO, { note: 'Tab. 7 D: embankment > 2 m' }),
  highEmbankment: p(2, 'm', RSTO),
  sideSlope: p(1.5, '1', EST, { note: 'slopes 1:1.5 (typical for cohesive soils)' }),
  stationSpacing: p(5, 'm', EST),
  sectionLength: p(120, 'm', EST),
  freeboard: p(1.2, 'm', EST, { note: 'road surface above water level at culverts' }),
  connectDistance: p(15, 'm', EST),
  swaleWidth: p(1.5, 'm', RAST, { note: 'Mulde 1.5–2.0 m' }),
  swaleDepth: p(0.3, 'm', EST),
  culvertActivity: 'drainage.culvert',
  culvertMaterial: 'pipe.culvert',
  materials: { topsoil: 'soil.topsoil', fill: 'soil.fill', spoil: 'soil.spoil', importFill: 'agg.fill', logs: 'wood.logs', brash: 'wood.brash' },
  activities: {
    survey: 'survey.stakeout',
    clearing: 'clearing.fell',
    topsoil: 'earth.topsoil',
    excavation: 'earth.excavate',
    fill: 'earth.fill',
    subgrade: 'earth.subgrade',
    shoulder: 'finish.shoulder',
    swale: 'drainage.swale',
    acceptance: 'inspection.acceptance',
    inspection: 'inspection.visual',
  },
  importFillDensity: p(2.0, 't/m3', CAT),
  importFillClass: 'sandGravel',
  fillLayerThickness: p(30, 'cm', EST),
  wasteAllowance: p(0.03, '1', EST),
  deterioration: {
    envCoefficient: p(0.06, '1/a', HDM4, { note: 'temperate, shallow freezing, sub-humid (Germany)' }),
    initialIri: p(1.5, 'm/km', EST, { range: [1.0, 2.0] }),
    workmanshipRoughness: p(0.6, '1', HDM4, { range: [0.3, 1.0], confidence: 'low', note: 'roughness at construction rises with poor construction quality; novice work starts up to ~60 % rougher (assumption on HDM-4\'s construction-quality effect)' }),
    crackInitKcia: p(1.0, '1', HDM4),
    crackGrowth: p(0.55, '1/a', EST, { note: 'logistic: ~7.6 a from initiation to 25 % cracked area' }),
    rutBase: p(0.4, 'mm/a', EST),
    rutPerMesal: p(30, 'mm', EST, { note: 'additional rut depth per year per million ESAL/a' }),
    potholeGrowth: p(6, '%/a', EST, { note: 'at 100 % cracking; ×4 on freeze–thaw days' }),
    gravelP075: p(12, '%', PAT, { note: 'passing 0.075 mm, typical well-graded wearing course' }),
    gravelPI: p(6, '%', PAT),
    unpavedRiMax: p(18, 'm/km', PAT, { range: [14, 21] }),
    unpavedRiMin: p(4, 'm/km', PAT),
    unpavedRate: p(0.000173, '1', PAT, { note: 'calibrated: 6 → 12 m/km IRI after ~4,000 passes (optimal blading interval)' }),
    bladingReduction: p(0.35, '1', PAT, { range: [0.17, 0.45] }),
  },
  zeb: {
    rut: { values: [15, 25], unit: 'mm', source: ZEB },
    cracks: { values: [15, 25], unit: '%', source: ZEB },
    patchesPotholes: { values: [15, 30], unit: '%', source: ZEB },
    iri: { values: [3.5, 5.0], unit: 'm/km', source: EST, note: 'ZEB uses AUN, not IRI — mapping is an assumption' },
    unpavedIri: { values: [10, 14], unit: 'm/km', source: EST, note: 'no ZEB for unbound roads — assumption' },
    gravelLossShare: { values: [0.5, 0.8], unit: '1', source: EST },
  },
};

export const roadInterventions = {
  grading: {
    label: 'Grading (blading)',
    surface: 'gravel',
    activity: 'maint.grading',
    basis: 'area',
    effect: { iriFactor: 0.65 },
    description: 'Motor grader re-profiles the wearing course; roughness drops by 17–45 % (Paterson). Optimal roughly every 4,000 vehicle passes.',
  },
  regravel: {
    label: 'Re-gravelling (5 cm)',
    surface: 'gravel',
    activity: 'maint.regravel',
    basis: 'surfaceLayerVolume',
    thickness: p(5, 'cm', RLW),
    density: p(2.2, 't/m3', CAT),
    effect: { laysGravel: true, iriSet: p(5, 'm/km', EST) },
    description: 'New unbound wearing course when the gravel layer is worn away.',
  },
  crackSeal: {
    label: 'Crack sealing',
    surface: 'asphalt',
    activity: 'maint.crackSeal',
    basis: 'cracks',
    effect: { cracks: 3 },
    description: 'Cracks are routed and sealed to keep water out — cheap, buys 2–4 years (estimate).',
  },
  patching: {
    label: 'Pothole patching',
    surface: 'asphalt',
    activity: 'maint.patching',
    basis: 'patches',
    effect: { potholes: 0, patchesAdd: true, iriFactor: 0.9 },
    description: 'Hot-mix patches; potholes become patches (ZEB counts patches too).',
  },
  surfaceTreatment: {
    label: 'Surface treatment (Oberflächenbehandlung)',
    surface: 'asphalt',
    activity: 'maint.surfaceTreatment',
    basis: 'area',
    effect: { cracks: 0, iriFactor: 0.95, resetSurfaceAge: true },
    description: 'Bitumen spray + chippings seal the surface; +5–15 years (Landkreis Peine 2024).',
  },
  overlay: {
    label: 'Asphalt overlay 4 cm (Hocheinbau)',
    surface: 'asphalt',
    activity: 'paving.surface',
    basis: 'surfaceLayerMass',
    thickness: p(4, 'cm', RSTO),
    density: p(2.45, 't/m3', EST),
    effect: { iriSet: p(1.6, 'm/km', EST), cracks: 0, potholes: 0, rutFactor: 0.2, resetSurfaceAge: true },
    description: 'New 4 cm wearing course laid on top (milling not modelled); resets the surface.',
  },
};

export const ROAD_SOURCES = { RSTO, RLW, RAST, ZEB, HDM4, PAT, HDM3, PEINE, CAT, EST };
