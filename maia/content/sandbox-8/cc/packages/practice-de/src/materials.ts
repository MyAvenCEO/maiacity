/**
 * Material properties for durability (decision 0014): natural durability as measured properties
 * with their sources, reference service lives for the ISO 15686 factor method, and the decay doses
 * the decay-dose model is anchored on. The two models are anchored independently: reference lives
 * per use class for the one, field tests for the other.
 *
 * Reference exposure: the Göttingen valley (DWD 1991–2020 normals) as resolved by the exposure
 * model, west (weather side) walls, ten generated years.
 */
import { p } from './sources.ts';

const EN350 = { title: 'EN 350:2016 Durability of wood and wood-based products — natural durability classes (Picea abies: DC 4, termites S)', publisher: 'CEN', year: 2016 };
const BNB = { title: 'BBSR: Nutzungsdauern von Bauteilen für Lebenszyklusanalysen nach BNB (timber cladding, roof structures)', publisher: 'BBSR', year: 2017 };
const EN252 = { title: 'EN 252 in-ground field tests of untreated Norway spruce in central Europe: mean lives of about 3–6 years (e.g. Brischke & Rapp 2008, Wood Science and Technology 42)', publisher: 'Springer', year: 2008 };
const ABOVE = { title: 'Above-ground field tests (double-layer, lap-joint) of untreated Norway spruce in northern Germany: failure after about 10–15 years (Brischke & Rapp 2008; Meyer-Veltrup et al. 2017, Wood Material Science & Engineering)', publisher: 'Springer / Taylor & Francis', year: 2017 };
const MODEL = { title: 'Decay hours of the reference placements in the Göttingen valley, from the exposure model (10 generated years; see docs/MODELS.md)', publisher: 'Constructible City', year: 2026 };

export const materialProperties = {
  'spruce.untreated': {
    label: 'Norway spruce (Picea abies), untreated',
    kind: 'timber',
    density: p(450, 'kg/m3', EN350, { range: [400, 500], confidence: 'medium', note: 'at 12 % moisture content' }),
    durability: {
      fungi: 4,
      termites: 'S',
      source: EN350,
      referenceServiceLife: {
        UC1: p(100, 'a', BNB, { confidence: 'medium', note: 'dry interior: not limited by decay; a lower bound (roof structures of softwood ≥ 50 a in BNB, many centuries in practice)' }),
        UC2: p(60, 'a', BNB, { range: [40, 100], confidence: 'low', note: 'under cover, occasional wetting (estimate)' }),
        'UC3.1': p(40, 'a', BNB, { range: [25, 50], confidence: 'low', note: 'sheltered cladding of untreated softwood (order of magnitude)' }),
        'UC3.2': p(11, 'a', ABOVE, { range: [8, 25], confidence: 'low', note: 'exposed untreated spruce above ground; chosen in the field range so that the factor method is continuous at the UC3.1/UC3.2 boundary (11 × 669 ≤ 40 × 188 decay h)' }),
        UC4: p(5, 'a', EN252, { range: [3, 6], confidence: 'medium', note: 'ground contact, untreated spruce stakes' }),
      },
      referenceDecayHours: {
        UC1: p(0, 'h/a', MODEL, { confidence: 'medium', note: 'dry interior: no wetting' }),
        UC2: p(0, 'h/a', MODEL, { confidence: 'medium', note: 'under cover: no wetting by rain' }),
        'UC3.1': p(188, 'h/a', MODEL, { confidence: 'medium', note: 'west wall under a 1 m overhang (3 m wall)' }),
        'UC3.2': p(669, 'h/a', MODEL, { confidence: 'medium', note: 'exposed west wall' }),
        UC4: p(4204, 'h/a', MODEL, { confidence: 'medium', note: 'post 0–60 cm in loess loam' }),
      },
      decayDoseCapacity: {
        aboveGround: p(10000, 'h', ABOVE, { range: [8000, 12000], confidence: 'low', note: 'calibrated: a horizontally exposed board in the reference climate (801 decay h/a) fails after about 12 years' }),
        inGround: p(21000, 'h', EN252, { range: [12500, 25000], confidence: 'low', note: 'calibrated: a post in the reference climate (4,204 decay h/a) fails after about 5 years' }),
      },
    },
  },
};

/** ISO 15686 factor C (work execution): poorly executed work shortens lives; experienced work is the reference */
export const workExecution = {
  floor: p(0.8, '1', { title: 'ISO 15686-8:2008 Reference service life and service-life estimation: factor C (work execution level) typically 0.8 (poor) … 1.2 (excellent)', publisher: 'ISO', year: 2008 }, { range: [0.7, 0.9], confidence: 'medium', note: 'the least practised work; an experienced crew is 1 (better than the reference is not modelled)' }),
};
