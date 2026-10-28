/**
 * Soils, trees and the default terrain scenario (southern Lower Saxony hills near Göttingen:
 * loess-covered Buntsandstein uplands, alluvial clays and Leine gravels in the valleys).
 *
 * Bank/loose densities and swell factors: Caterpillar "Weight of Materials" (research/de
 * resources tables.soil_properties; swell factor = 1 / load factor). Compaction factors there
 * are estimates. Frost classes per ZTV E-StB. Plant-available water (nFK) is not in the research:
 * typical KA5 values, low confidence.
 */
import { ASSUMPTION, CAT_WEIGHTS, FOREST_TYPICAL, KA5, SCENARIO, WALDMESSLEHRE, cite, p } from './sources.ts';

const est = (note: string) => ({ confidence: 'low' as const, note });
const DIN1054 = { title: 'DIN 1054:2010-12, Annex A, Tables A 6.1–A 6.8: presumptive bearing pressures (Sohlwiderstand) of strip footings b ≈ 0.5 m, d ≈ 0.5 m', publisher: 'DIN' };


export const soilClasses = {
  topsoil: {
    label: 'Oberboden (Mutterboden), humoser schluffiger Lehm',
    description: 'Humus-rich A horizon; stripped and stockpiled separately (DIN 18915), never used as fill.',
    group: 'topsoil',
    bulkDensity: p(1.37, 't/m3', cite(CAT_WEIGHTS, 'Topsoil: bank 1.37, loose 0.95 t/m3'), { confidence: 'medium' }),
    swellFactor: p(1.43, '1', cite(CAT_WEIGHTS, 'load factor 0.70 → swell 43 %'), { confidence: 'medium' }),
    compactionFactor: p(1.1, '1', ASSUMPTION, { range: [1.0, 1.2], ...est('re-spread topsoil is only lightly tracked, stays looser than in situ; no source in research') }),
    frostClass: 'F3',
    bearing: p(50, 'kPa', ASSUMPTION, { range: [0, 80], confidence: 'low', note: 'humous topsoil is no founding soil (DIN 1054 gives no value): a nominal figure for building on it anyway' }),
    excavation: 'easy',
    fieldCapacity: p(220, 'mm/m', KA5, { range: [180, 260], ...est('humous silt loam (Ut/Lu), nFK typical') }),
    hydraulics: { drainage: p(0.2, '1/d', KA5, est('humous topsoil; drainage recession, KA5 orders of magnitude')), excessStorage: p(0.4, '1', KA5, est('storage above field capacity as a fraction of it (from air capacity)')), stefan: p(0.047 ** 2, 'm2/K/d', ASSUMPTION, est('Stefan coefficient 2λ/L at field capacity: (0.047 m/√(K·d))², German frost-depth practice')) },
    cohesive: true,
    suitableFill: false,
    color: '#4a3728',
  },
  loessLoam: {
    label: 'Lösslehm (UL/TL)',
    description: 'Weathered loess silt; frost-susceptible F3, water-sensitive. Usable as fill at optimum water content (or lime-improved), DPr ≥ 97 %.',
    group: 'cohesive',
    bulkDensity: p(1.54, 't/m3', cite(CAT_WEIGHTS, 'Silt / loess loam: bank 1.54, loose 1.25 t/m3'), {
      range: [1.54, 1.9],
      confidence: 'medium',
      note: 'Cat "loam" value; moist natural loess loam is often 1.7–1.9 t/m3 (upper range)',
    }),
    swellFactor: p(1.23, '1', cite(CAT_WEIGHTS, 'load factor 0.81 → swell 23 %'), { confidence: 'medium' }),
    compactionFactor: p(0.9, '1', cite(CAT_WEIGHTS, 'compaction factor estimate (compacted ÷ bank)'), { range: [0.88, 0.92], confidence: 'low' }),
    frostClass: 'F3',
    bearing: p(140, 'kPa', DIN1054, { range: [110, 180], confidence: 'low', note: 'silt (UL), stiff: Table A 6.7' }),
    excavation: 'medium',
    fieldCapacity: p(220, 'mm/m', KA5, { range: [190, 260], ...est('loess silt (Ut3/Ut4) has among the highest nFK of German soils') }),
    hydraulics: { drainage: p(0.12, '1/d', KA5, est('clays/silts: air capacity 2–8 vol-%, waterlogged for days; drainage recession, KA5 orders of magnitude')), excessStorage: p(0.3, '1', KA5, est('storage above field capacity as a fraction of it (from air capacity)')), stefan: p(0.047 ** 2, 'm2/K/d', ASSUMPTION, est('Stefan coefficient 2λ/L at field capacity: (0.047 m/√(K·d))², German frost-depth practice')) },
    cohesive: true,
    suitableFill: true,
    color: '#b89664',
    landscape: ['upland', 'slope'],
  },
  clay: {
    label: 'Auelehm / Ton (TA/TM)',
    description: 'Plastic alluvial clay of the valley floor; frost class F2 (TA), hard digging, unsuitable as fill without improvement.',
    group: 'cohesive',
    bulkDensity: p(2.02, 't/m3', cite(CAT_WEIGHTS, 'Clay, natural bed: bank 2.02, loose 1.66 t/m3 (wet clay 2.08)'), { range: [2.02, 2.08], confidence: 'medium' }),
    swellFactor: p(1.22, '1', cite(CAT_WEIGHTS, 'load factor 0.82 → swell 22 % (wet 25 %)'), { range: [1.22, 1.25], confidence: 'medium' }),
    compactionFactor: p(0.9, '1', cite(CAT_WEIGHTS, 'compaction factor estimate'), { range: [0.88, 0.92], confidence: 'low' }),
    frostClass: 'F2',
    bearing: p(100, 'kPa', DIN1054, { range: [80, 130], confidence: 'low', note: 'clay (TA/TM), soft-stiff to stiff: Table A 6.6 lower values' }),
    excavation: 'hard',
    fieldCapacity: p(140, 'mm/m', KA5, { range: [110, 170], ...est('clay (Tt/Tl): high field capacity but much of it not plant-available') }),
    hydraulics: { drainage: p(0.12, '1/d', KA5, est('clays/silts: air capacity 2–8 vol-%, waterlogged for days; drainage recession, KA5 orders of magnitude')), excessStorage: p(0.3, '1', KA5, est('storage above field capacity as a fraction of it (from air capacity)')), stefan: p(0.047 ** 2, 'm2/K/d', ASSUMPTION, est('Stefan coefficient 2λ/L at field capacity: (0.047 m/√(K·d))², German frost-depth practice')) },
    cohesive: true,
    suitableFill: false,
    color: '#7a6652',
    landscape: ['valleyFloor'],
  },
  sandGravel: {
    label: 'Sand-Kies (GW/GI/SW), Leine-Niederterrasse',
    description: 'Well-graded river sand and gravel; frost-safe F1, excellent fill.',
    group: 'granular',
    bulkDensity: p(1.93, 't/m3', cite(CAT_WEIGHTS, 'Sand & gravel dry: bank 1.93, loose 1.72 t/m3; gravel pitrun 2.17'), { range: [1.6, 2.17], confidence: 'medium' }),
    swellFactor: p(1.12, '1', cite(CAT_WEIGHTS, 'load factor 0.89 → swell 12 %'), { confidence: 'medium' }),
    compactionFactor: p(0.97, '1', cite(CAT_WEIGHTS, 'compaction factor estimate'), { range: [0.95, 0.97], confidence: 'low' }),
    frostClass: 'F1',
    bearing: p(250, 'kPa', DIN1054, { range: [200, 300], confidence: 'low', note: 'sand-gravel, medium dense: Table A 6.1' }),
    excavation: 'easy',
    fieldCapacity: p(70, 'mm/m', KA5, { range: [50, 100], ...est('gravelly medium sand, nFK typical') }),
    hydraulics: { drainage: p(0.7, '1/d', KA5, est('sands/gravels: air capacity 20–30 vol-%, drain within a day or two; drainage recession, KA5 orders of magnitude')), excessStorage: p(1.2, '1', KA5, est('storage above field capacity as a fraction of it (from air capacity)')), stefan: p(0.058 ** 2, 'm2/K/d', ASSUMPTION, est('Stefan coefficient 2λ/L at field capacity: (0.058 m/√(K·d))², German frost-depth practice')) },
    cohesive: false,
    suitableFill: true,
    color: '#c8b07e',
    landscape: ['waterside'],
  },
  rock: {
    label: 'Buntsandstein, verwittert (Zersatz / Hangschutt)',
    description: 'Weathered Middle Buntsandstein; rippable to hard digging, crushed it makes frost-safe rockfill.',
    group: 'rock',
    bulkDensity: p(2.28, 't/m3', cite(CAT_WEIGHTS, 'Decomposed rock 50/50: bank 2.28, loose 1.72 t/m3; sandstone blasted 2.52 / 1.51'), { range: [2.28, 2.52], confidence: 'medium' }),
    swellFactor: p(1.33, '1', cite(CAT_WEIGHTS, 'load factor 0.75 → swell 33 % (blasted sandstone 0.60 → 67 %)'), { range: [1.33, 1.67], confidence: 'medium' }),
    compactionFactor: p(1.1, '1', cite(CAT_WEIGHTS, 'compaction factor estimate (decomposed rock 1.10, rockfill 1.25)'), { range: [1.1, 1.25], confidence: 'low' }),
    frostClass: 'F1',
    bearing: p(1000, 'kPa', ASSUMPTION, { range: [500, 2000], confidence: 'low', note: 'weathered sandstone: EN 1997-1 Annex G orders of magnitude' }),
    excavation: 'rock',
    fieldCapacity: p(40, 'mm/m', KA5, { range: [20, 60], ...est('fissured weathered sandstone with sandy matrix') }),
    hydraulics: { drainage: p(0.3, '1/d', KA5, est('fissured rock; drainage recession, KA5 orders of magnitude')), excessStorage: p(0.3, '1', KA5, est('storage above field capacity as a fraction of it (from air capacity)')), stefan: p(0.06 ** 2, 'm2/K/d', ASSUMPTION, est('Stefan coefficient 2λ/L at field capacity: (0.06 m/√(K·d))², German frost-depth practice')) },
    cohesive: false,
    suitableFill: true,
    color: '#9c5b43',
  },
};

const forest = (note: string) => ({ confidence: 'low' as const, note });

export const treeSpecies = {
  beech: {
    label: 'Rotbuche (Fagus sylvatica)',
    kind: 'broadleaf',
    matureHeight: p(32, 'm', FOREST_TYPICAL, { range: [25, 40], ...forest('dominant species of the Göttingen Forest on limestone/loess') }),
    woodDensity: p(1.0, 't/m3', FOREST_TYPICAL, { range: [0.95, 1.1], ...forest('green (fresh-felled) density') }),
    formFactor: p(0.5, '1', WALDMESSLEHRE, { range: [0.4, 0.6], confidence: 'medium', note: 'stem form factor (unechte Formzahl) of grown trees; to be checked against the tables' }),
    crownWood: p(0.25, '1', ASSUMPTION, { range: [0.1, 0.45], confidence: 'low', note: 'branches and top as a share of the stem mass (to be sourced: biomass expansion factors of the national forest inventory)' }),
    color: '#4f7a3a',
  },
  oak: {
    label: 'Stiel-/Traubeneiche (Quercus robur/petraea)',
    kind: 'broadleaf',
    matureHeight: p(30, 'm', FOREST_TYPICAL, { range: [25, 35], ...forest('typical stand height') }),
    woodDensity: p(1.05, 't/m3', FOREST_TYPICAL, { range: [0.95, 1.15], ...forest('green density') }),
    formFactor: p(0.5, '1', WALDMESSLEHRE, { range: [0.4, 0.6], confidence: 'medium', note: 'stem form factor (unechte Formzahl) of grown trees; to be checked against the tables' }),
    crownWood: p(0.3, '1', ASSUMPTION, { range: [0.1, 0.45], confidence: 'low', note: 'branches and top as a share of the stem mass (to be sourced: biomass expansion factors of the national forest inventory)' }),
    color: '#46602f',
  },
  ash: {
    label: 'Gemeine Esche (Fraxinus excelsior)',
    kind: 'broadleaf',
    matureHeight: p(30, 'm', FOREST_TYPICAL, { range: [25, 38], ...forest('riparian and valley sites') }),
    woodDensity: p(0.85, 't/m3', FOREST_TYPICAL, { range: [0.75, 0.95], ...forest('green density') }),
    formFactor: p(0.5, '1', WALDMESSLEHRE, { range: [0.4, 0.6], confidence: 'medium', note: 'stem form factor (unechte Formzahl) of grown trees; to be checked against the tables' }),
    crownWood: p(0.2, '1', ASSUMPTION, { range: [0.1, 0.45], confidence: 'low', note: 'branches and top as a share of the stem mass (to be sourced: biomass expansion factors of the national forest inventory)' }),
    color: '#5f8a45',
  },
  maple: {
    label: 'Bergahorn (Acer pseudoplatanus)',
    kind: 'broadleaf',
    matureHeight: p(28, 'm', FOREST_TYPICAL, { range: [20, 33], ...forest('typical stand height') }),
    woodDensity: p(0.9, 't/m3', FOREST_TYPICAL, { range: [0.8, 1.0], ...forest('green density') }),
    formFactor: p(0.5, '1', WALDMESSLEHRE, { range: [0.4, 0.6], confidence: 'medium', note: 'stem form factor (unechte Formzahl) of grown trees; to be checked against the tables' }),
    crownWood: p(0.2, '1', ASSUMPTION, { range: [0.1, 0.45], confidence: 'low', note: 'branches and top as a share of the stem mass (to be sourced: biomass expansion factors of the national forest inventory)' }),
    color: '#6b9440',
  },
  spruce: {
    label: 'Gemeine Fichte (Picea abies)',
    kind: 'conifer',
    matureHeight: p(35, 'm', FOREST_TYPICAL, { range: [28, 45], ...forest('plantation stands; heavy bark-beetle losses since 2018') }),
    woodDensity: p(0.8, 't/m3', FOREST_TYPICAL, { range: [0.7, 0.9], ...forest('green density') }),
    formFactor: p(0.48, '1', WALDMESSLEHRE, { range: [0.4, 0.6], confidence: 'medium', note: 'stem form factor (unechte Formzahl) of grown trees; to be checked against the tables' }),
    crownWood: p(0.3, '1', ASSUMPTION, { range: [0.1, 0.45], confidence: 'low', note: 'branches and top as a share of the stem mass (to be sourced: biomass expansion factors of the national forest inventory)' }),
    color: '#2f4f36',
  },
  pine: {
    label: 'Waldkiefer (Pinus sylvestris)',
    kind: 'conifer',
    matureHeight: p(28, 'm', FOREST_TYPICAL, { range: [20, 35], ...forest('typical stand height') }),
    woodDensity: p(0.75, 't/m3', FOREST_TYPICAL, { range: [0.65, 0.9], ...forest('green density') }),
    formFactor: p(0.47, '1', WALDMESSLEHRE, { range: [0.4, 0.6], confidence: 'medium', note: 'stem form factor (unechte Formzahl) of grown trees; to be checked against the tables' }),
    crownWood: p(0.2, '1', ASSUMPTION, { range: [0.1, 0.45], confidence: 'low', note: 'branches and top as a share of the stem mass (to be sourced: biomass expansion factors of the national forest inventory)' }),
    color: '#3d5a3a',
  },
};

const scenario = (note: string) => ({ note });

export const terrainSettings = {
  // the soil map everyone has (the state survey's BÜK 1:50,000: units of some hectares; it misses what changes within them)
  soilMap: { cell: p(250, 'm', { title: 'LBEG Niedersachsen: Bodenübersichtskarte 1:50,000 (BÜK50), NIBIS map server', publisher: 'LBEG' }, { range: [100, 500], confidence: 'medium', note: 'the size of a map unit at 1:50,000' }) },
  sizeX: p(1600, 'm', SCENARIO),
  sizeZ: p(1600, 'm', SCENARIO),
  cellSize: p(4, 'm', SCENARIO, scenario('grid resolution; 401 × 401 vertices')),
  baseElevation: p(150, 'm', SCENARIO, scenario('Leine valley floor near Göttingen ≈ 140–160 m a.s.l. (DWD station 01691 at 167.4 m)')),
  relief: p(45, 'm', SCENARIO, { range: [30, 80], note: 'gentle loess hills at the valley margin' }),
  hilliness: 0.45,
  creek: true,
  pond: true,
  pondRefill: p(30, 'd', ASSUMPTION, { range: [5, 120], confidence: 'low', note: 'a village pond in the valley floor fed by the ground water: drawn down, it comes back towards the water table over weeks (to be sourced: pond water balance in loess valleys)' }),
  forestCover: 0.28,
  scatteredTreesPerHa: p(1.5, 'pcs/ha', SCENARIO, scenario('hedgerow, field and riparian trees outside woodland')),
  soil: {
    topsoilClass: 'topsoil',
    topsoilDepth: p(0.3, 'm', SCENARIO, { range: [0.2, 0.4], note: 'Ap horizon of arable loess soils' }),
    subsoilClasses: ['loessLoam', 'clay', 'sandGravel'],
    rockClass: 'rock',
    rockDepth: p(2.5, 'm', SCENARIO, { range: [1.0, 5.0], note: 'loess cover over Buntsandstein, thinner on crests' }),
  },
};

/** the ways into the valley (decision 0025): 0..n, any mode */
export const accesses = {
  k412: {
    label: 'K 412 to Göttingen',
    mode: 'road',
    side: 'west',
    offset: 0.1,
    length: p(220, 'm', SCENARIO, scenario('the county road runs into the valley to the yard')),
    surface: 'asphalt',
    width: p(6, 'm', SCENARIO, scenario('a two-lane county road')),
    speedLimit: p(70, 'km/h', SCENARIO, scenario('outside built-up areas, a narrow county road')),
    externalDistance: p(6, 'km', SCENARIO, scenario('public road distance to the edge of Göttingen (suppliers are counted from here)')),
    outside: 'external',
  },
};

/**
 * The bus at the way in (A4): a regional line on the K 412 into Göttingen, hourly on working days,
 * every two hours on Saturdays, three times on Sundays (a rural line's timetable; scenario data).
 */
export const transitLines = {
  k412Bus: {
    label: 'Regional bus on the K 412 to Göttingen',
    access: 'k412',
    minutes: p(25, 'min', SCENARIO, scenario('from the stop at the way in to the town centre')),
    toTown: { weekday: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5], saturday: [7.5, 9.5, 11.5, 13.5, 15.5, 17.5], sunday: [9.5, 13.5, 17.5] },
    fromTown: { weekday: [6.25, 7.25, 8.25, 9.25, 10.25, 11.25, 12.25, 13.25, 14.25, 15.25, 16.25, 17.25, 18.25, 19.25, 20.25, 22.25], saturday: [8.25, 10.25, 12.25, 14.25, 16.25, 18.25], sunday: [10.25, 14.25, 18.25] },
    source: SCENARIO,
  },
};

/** the same hills reached from the other side: no road, a footpath over the hill from Rosdorf */
export const hillsideAccesses = {
  rosdorfPath: {
    label: 'Footpath over the hill from Rosdorf',
    mode: 'footpath',
    side: 'west',
    offset: 0.1,
    length: p(260, 'm', SCENARIO, scenario('a field path down into the valley')),
    surface: 'path',
    width: p(1.5, 'm', SCENARIO, scenario('a trodden path between fields')),
    speedLimit: p(6, 'km/h', SCENARIO, scenario('walking')),
    externalDistance: p(3.5, 'km', SCENARIO, scenario('over the hill to the shops of Rosdorf')),
    outside: 'path',
  },
};
