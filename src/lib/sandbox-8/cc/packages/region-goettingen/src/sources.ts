/**
 * Provenance shared within the region pack (decision 0006). Sources are those collected in
 * research/de/{climate,resources,roads}.json (compiled 2026-10-07). Where a value is NOT backed by
 * that research it cites `ASSUMPTION` / `SCENARIO` or a named standard work and carries confidence
 * 'low'; the note says so.
 */
import type { Source } from '../../kernel/src/index.ts';

export { cite, param as p, series } from '../../kernel/src/index.ts';

// ------------------------------------------------------------------ generic

export const ASSUMPTION: Source = {
  title: 'Assumption of the data-pack author (no source in research/de)',
  publisher: 'Constructible City region-goettingen',
  year: 2026,
};

export const SCENARIO: Source = {
  title: 'Scenario design: hilly rural site in southern Lower Saxony near Göttingen (Leine valley margin)',
  publisher: 'Constructible City region-goettingen',
  year: 2026,
};

// ------------------------------------------------------------------ climate (research/de/climate.json)

export const DWD_NORMALS: Source = {
  title: 'Vieljährige Mittelwerte 1991–2020, station 01691 Göttingen (temperature, precipitation, sunshine)',
  publisher: 'Deutscher Wetterdienst, Climate Data Center (CDC)',
  year: 2023,
  url: 'https://www.dwd.de/DE/leistungen/klimadatendeutschland/vielj_mittelwerte.html',
};

export const DWD_DERIVED: Source = {
  title: 'Derived from DWD CDC open data, station 01691 Göttingen, daily/hourly 1991-01-01..2020-12-31 (research/de/climate.json)',
  publisher: 'derived from Deutscher Wetterdienst CDC',
  year: 2026,
  url: 'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/historical/',
};

// ------------------------------------------------------------------ soils & vegetation

export const CAT_WEIGHTS: Source = {
  title: 'Caterpillar Performance Handbook Ed. 49, Section 30 Tables — Weight of Materials (bank / loose density, load factor); frost classes ZTV E-StB',
  publisher: 'Caterpillar / fertighaus.de',
  year: 2019,
  url: 'https://www.macallister.com/wp-content/uploads/sites/2/caterpillar-performance-handbook-49.pdf',
};

export const KA5: Source = {
  title: 'Ad-hoc-AG Boden: Bodenkundliche Kartieranleitung, 5. Auflage (KA5) — typical nutzbare Feldkapazität (nFK) by soil texture (not in research/de)',
  publisher: 'Bundesanstalt für Geowissenschaften und Rohstoffe (BGR), Hannover',
  year: 2005,
};

export const WALDMESSLEHRE: Source = {
  title: 'Kramer, H.; Akça, A.: Leitfaden zur Waldmesslehre — form factors (Formzahlen) of the main tree species (not in research/de)',
  publisher: "J. D. Sauerländer's Verlag, Frankfurt am Main",
  year: 2008,
};

export const FOREST_TYPICAL: Source = {
  title: 'Typical values for Central European forest trees (heights on good sites; green/fresh wood density) — general forestry literature, not in research/de',
  publisher: 'Constructible City region-goettingen',
  year: 2026,
};
