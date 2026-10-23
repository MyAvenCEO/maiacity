/**
 * Provenance shared within the practice pack (decision 0006). Sources are those collected in
 * research/de/{climate,resources,roads}.json (compiled 2026-10-07). Where a value is NOT backed by
 * that research it cites `ASSUMPTION` / `SCENARIO` or a named standard work and carries confidence
 * 'low'; the note says so.
 */
import type { Source } from '../../kernel/src/index.ts';

export { cite, param as p, series } from '../../kernel/src/index.ts';

// ------------------------------------------------------------------ generic

export const ASSUMPTION: Source = {
  title: 'Assumption of the data-pack author (no source in research/de)',
  publisher: 'Constructible City practice-de',
  year: 2026,
};

// ------------------------------------------------------------------ labour (research/de/resources.json)

export const TARIF_MV: Source = {
  title: 'Tarifdaten Baugewerbe (veröffentlicht 29.05.2026): Gehälter Poliere/Bauleiter, Regelarbeitszeit, Urlaub',
  publisher: 'Ministerium für Wirtschaft, Arbeit und Gesundheit Mecklenburg-Vorpommern',
  year: 2026,
  url: 'https://www.regierung-mv.de/static/Regierungsportal/Ministerium%20f%C3%BCr%20Wirtschaft%2c%20Arbeit%20und%20Gesundheit/Dateien/Downloads/tarifdaten/Baugewerbe.pdf',
};

export const ARBZG: Source = {
  title: 'Arbeitszeitgesetz (ArbZG) §§3, 4, 5, 9',
  publisher: 'Bundesministerium der Justiz (gesetze-im-internet.de)',
  year: 2024,
  url: 'https://www.gesetze-im-internet.de/arbzg/',
};

// ------------------------------------------------------------------ machines

export const CAT_PHB: Source = {
  title: 'Caterpillar Performance Handbook, Edition 49 (SEBD0351-49)',
  publisher: 'Caterpillar',
  year: 2019,
  url: 'https://www.macallister.com/wp-content/uploads/sites/2/caterpillar-performance-handbook-49.pdf',
};

export const WKO_ARGE: Source = {
  title: 'Sätze für die interne Verrechnung von Partnerleistungen bei Bau-ARGEn (1.5.2025–30.4.2026) — AUSTRIAN PROXY',
  publisher: 'WKO Bundesinnung Bau (Austria)',
  year: 2025,
  url: 'https://www.wko.at/stmk/gewerbe-handwerk/bau/verrechnungssaetze-ab-1-5-2025.pdf',
};

export const PERMITS: Source = {
  title: 'Baumaschinentransport richtig kalkulieren (28.05.2026): tracked machines, dozers, pavers, rollers need a low-loader; registered wheeled plant may self-drive',
  publisher: 'trans.info',
  year: 2026,
  url: 'https://trans.info/de/baumaschinentransport-richtig-kalkulieren-diese-versteckten-kosten-sollten-logistiker-kennen-478851',
};

export const HAMM: Source = {
  title: 'Hamm H 13i (12,860 kg, 115 kW, drum 2,140 mm, 0–12 km/h) and HD+ 90i VV (9,380 kg, 85 kW, drum 1,680 mm, 0–10 km/h) datasheets (via search summary)',
  publisher: 'Hamm AG (Wirtgen Group)',
  year: 2025,
};

// ------------------------------------------------------------------ transport

export const NAUMANN: Source = {
  title: 'Preisliste Schüttgut/Baustofflogistik gültig ab 01.01.2025 — Transportleistungen (3-axle 97.50, 4-axle 103.00 EUR/h with driver)',
  publisher: 'Naumann-Gruppe (Kies und Beton / BVFW), Hessen/Thüringen',
  year: 2025,
  url: 'https://www.kies-und-beton.eu/_docs/Preisliste_Schuttgut_2025_neu_22.01.2025.pdf',
};

export const BVFW: Source = {
  title: 'Preisliste BVFW gültig ab 01.01.2026 (Schüttgüter, Frachtpreisliste, Annahme Erdaushub)',
  publisher: 'Baustoffvertrieb Fulda-Werra (Naumann-Gruppe)',
  year: 2026,
  url: 'https://www.bvfw.eu/_docs/Preisliste_BVFW_2026.pdf',
};

export const SPEED_DERIVED: Source = {
  title: 'Derived from BVFW 2026 freight table and Naumann 2025 hourly rates: effective truck speed on public roads 50–60 km/h on longer runs (StVO §3: trucks > 7.5 t 60 km/h rural)',
  publisher: 'research/de derived',
  year: 2026,
  url: 'https://www.bvfw.eu/_docs/Preisliste_BVFW_2026.pdf',
};

export const RLW: Source = {
  title: 'Helmstädter, S.; Lorenzl, H.: Die neuen Richtlinien für den Ländlichen Wegebau (RLW). zfv 143(6), 349–353 (4-axle 32 t, axles 5/6/10.5/10.5 t: ΣÄF 2.62)',
  publisher: 'DVW / zfv',
  year: 2018,
  url: 'https://mail.geodaesie.info/images/zfv/143-jahrgang-2018/downloads/zfv_2018_6_Helmstaedter_Lorenzl.pdf',
};

export const AXLE_LIMITS: Source = {
  title: 'Jüngels, H.: Anforderungen an Wegenetze aus bautechnischer Sicht (axle 10 t / 11.5 t driven; GVW 18/26/32/40 t for 2/3/4/>4 axles)',
  publisher: 'DLR Eifel / Akademie Ländlicher Raum RLP',
  year: 2019,
  url: 'https://www.dlr.rlp.de/Internet/global/Themen.nsf/489c06cb7b4a57c7c1258807003be319/c408a65011c89b4fc125849700228c87/$FILE/ATTBVO0N.pdf/Vortrag_Helmut_Juengels.pdf',
};

export const FOURTH_POWER: Source = {
  title: 'Lorenzl, H.: Was bringen die neuen RLW? (Wegebautagung 20.06.2017): ÄF = (L / 10 t)^4',
  publisher: 'landentwicklung.de / DLKG',
  year: 2017,
  url: 'https://www.landentwicklung.de/fileadmin/sites/Landentwicklung/Dateien/Aktuelles/Wegebautagung2017/170620_RLW_Lorenzl.pdf',
};

export const ROADS_DERIVED: Source = {
  title: 'Derived in research/de/roads.json from the cited inputs (axle split assumed)',
  publisher: 'research/de derived',
  year: 2026,
};

// ------------------------------------------------------------------ materials

export const MARTA: Source = {
  title: 'Preisliste Steinbruch Marta ab 01.04.2025 / Stottmeier Hartsteinwerk ab 01.04.2025 (FSS, STS, Mineralgemisch, Oberboden)',
  publisher: 'Ross Bauservice (Steinbruch Marta) / Stottmeier-Hartsteinwerk GmbH',
  year: 2025,
  url: 'https://ross-bauservice.de/wp-content/uploads/Preisliste-Marta-Steinbruch-ab-2025-04-01.pdf',
};
