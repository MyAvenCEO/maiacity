/**
 * Exposure classifications used in German practice (decision 0010): the rules that turn physical
 * exposure into the classes standards and codes speak in. The first matching rule gives the class.
 */
const EN335 = { title: 'DIN EN 335:2013 Durability of wood and wood-based products — Use classes', publisher: 'DIN', year: 2013 };
const ISO9223 = { title: 'ISO 9223 Corrosion of metals and alloys — Corrosivity of atmospheres (time-of-wetness categories τ1–τ5)', publisher: 'ISO', year: 1992 };

export const exposureClasses = {
  'EN 335': {
    label: 'Use class (wood)',
    source: { ...EN335, note: 'EN 335 defines the classes in words; the hour thresholds separating UC1/UC2 and UC3.1/UC3.2 are an interpretation of this pack (assumption, low confidence)' },
    rules: [
      { class: 'UC4', meets: ['ground', 'water'], note: 'in contact with ground or fresh water' },
      { class: 'UC3.2', meets: ['outside'], min: { wettingHoursPerYear: 1000 }, note: 'exterior, above ground, frequently wetted (wet more than about 11 % of the time)' },
      { class: 'UC3.1', meets: ['outside'], note: 'exterior, above ground, rarely wetted (sheltered, drains)' },
      { class: 'UC2', meets: ['space'], min: { hoursAbove80PerYear: 1000 }, note: 'under cover, occasional wetting (condensation)' },
      { class: 'UC1', meets: ['space'], note: 'interior, dry' },
    ],
  },
  'ISO 9223 TOW': {
    label: 'Time-of-wetness category (metals)',
    source: ISO9223,
    rules: [
      { class: 'τ1', max: { timeOfWetnessPerYear: 10 } },
      { class: 'τ2', max: { timeOfWetnessPerYear: 250 } },
      { class: 'τ3', max: { timeOfWetnessPerYear: 2500 } },
      { class: 'τ4', max: { timeOfWetnessPerYear: 5500 } },
      { class: 'τ5' },
    ],
  },
};
