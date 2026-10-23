/**
 * Provenance shared within the economy pack (decision 0006). Sources are those collected in
 * research/de/{climate,resources,roads}.json (compiled 2026-10-07). Where a value is NOT backed by
 * that research it cites `ASSUMPTION` / `SCENARIO` or a named standard work and carries confidence
 * 'low'; the note says so.
 */
import type { Source } from '../../kernel/src/index.ts';

export { cite, param as p, series } from '../../kernel/src/index.ts';

// ------------------------------------------------------------------ generic

export const ASSUMPTION: Source = {
  title: 'Assumption of the data-pack author (no source in research/de)',
  publisher: 'Constructible City economy-de',
  year: 2026,
};

export const SCENARIO: Source = {
  title: 'Scenario design: hilly rural site in southern Lower Saxony near Göttingen (Leine valley margin)',
  publisher: 'Constructible City economy-de',
  year: 2026,
};

// ------------------------------------------------------------------ labour (research/de/resources.json)

export const TV_LOHN: Source = {
  title: 'TV Lohn/West vom 14.06.2024 i.d.F. vom 25.06.2025, §2 Abs. 9 (Gesamttarifstundenlohn ab 01.04.2026, national from 04/2026)',
  publisher: 'ZDB / HDB / IG BAU',
  year: 2025,
  url: 'https://www.baufachmedien.de/media/99/90/ed/1787732235/TV Lohn West.pdf.pdf',
};

export const TARIF_MV: Source = {
  title: 'Tarifdaten Baugewerbe (veröffentlicht 29.05.2026): Gehälter Poliere/Bauleiter, Regelarbeitszeit, Urlaub',
  publisher: 'Ministerium für Wirtschaft, Arbeit und Gesundheit Mecklenburg-Vorpommern',
  year: 2026,
  url: 'https://www.regierung-mv.de/static/Regierungsportal/Ministerium%20f%C3%BCr%20Wirtschaft%2c%20Arbeit%20und%20Gesundheit/Dateien/Downloads/tarifdaten/Baugewerbe.pdf',
};

export const HDB_LZK: Source = {
  title: 'Lohnzusatzkosten (HDB-Musterberechnung, Stand Februar 2026)',
  publisher: 'Bauprofessor.de citing Hauptverband der Deutschen Bauindustrie',
  year: 2026,
  url: 'https://www.bauprofessor.de/lohnzusatzkosten/',
};

export const AOK_SICK: Source = {
  title: 'Pressemitteilung AU-Zahlen 2024 (Krankenstand nach Branchen): Baugewerbe 6.82 %',
  publisher: 'AOK Rheinland/Hamburg',
  year: 2025,
  url: 'https://www.aok.de/pp/fileadmin/bereiche/rheinland-hamburg/Dokumente/Pressemitteilungen/2025/20250220_PM_RH_AU_Zahlen.pdf',
};

export const BA_VACANCY: Source = {
  title: 'Berufe mit den längsten Vakanzzeiten (BA-Daten Feb 2025 – Jan 2026)',
  publisher: 'Statista / Bundesagentur für Arbeit',
  year: 2026,
  url: 'https://de.statista.com/infografik/35884/berufe-mit-den-laengsten-vakanzzeiten-von-arbeitsstellen-in-deutschland',
};

export const BGB_622: Source = {
  title: '§ 622 BGB Kündigungsfristen bei Arbeitsverhältnissen',
  publisher: 'Bundesministerium der Justiz (gesetze-im-internet.de)',
  year: 2024,
  url: 'https://www.gesetze-im-internet.de/bgb/__622.html',
};

// ------------------------------------------------------------------ machines

export const CAT_PHB: Source = {
  title: 'Caterpillar Performance Handbook, Edition 49 (SEBD0351-49)',
  publisher: 'Caterpillar',
  year: 2019,
  url: 'https://www.macallister.com/wp-content/uploads/sites/2/caterpillar-performance-handbook-49.pdf',
};

export const BAU_RENTAL: Source = {
  title: 'BAU Süddeutsche Baumaschinen Mietpreisliste (Stand 04/2024); Kraus Baumaschinen Preisliste (05/2024); Franken Baumaschinen Mietpreisliste 2025',
  publisher: 'BAU Süddeutsche Baumaschinen Handels GmbH / Kraus Baumaschinen / Guido Franken e.K.',
  year: 2025,
  url: 'https://bau-baumaschinen.de/wp-content/uploads/2024/07/BAU_Mietpreisliste_2024_DE_geaenderte-DW-KE-u-NU.pdf',
};

export const BGL_DERIVED: Source = {
  title: 'Derived: Abschreibung und Verzinsung nach BGL, k = 100/v + 6.5·n/(2v) %/month on estimated purchase price; repair %/month estimated (research/de resources tables.bgl_style_monthly_cost_estimates)',
  publisher: 'derived (formula: Bauprofessor.de)',
  year: 2026,
  url: 'https://www.bauprofessor.de/abschreibung-verzinsung-nach-bgl/',
};

export const BGL_REPAIR: Source = {
  title: 'Reparaturkosten der Baugeräte (BGL 2025): month = 170 Vorhaltestunden (one shift)',
  publisher: 'Bauprofessor.de',
  year: 2025,
  url: 'https://www.bauprofessor.de/reparaturkosten-der-baugeraete/',
};

export const PURCHASE_EST: Source = {
  title: 'Estimated new price (research/de resources tables.machines purchase_new_EUR_est — low confidence, no dealer list)',
  publisher: 'research/de estimate',
  year: 2026,
};

export const CAT_SERVICE: Source = {
  title: 'Cat 320 / 320 GC / 323 Maintenance and Service (engine oil + fuel filters every 500 h)',
  publisher: 'Caterpillar',
  year: 2024,
  url: 'https://www.cat.com/en_GB/support/caterpillar-service-center/cat-320-320GC-323-maintenance-and-service.html',
};

export const KROPIK: Source = {
  title: 'Kalkulation von Erdbaugeräten, Ausgabe 2022 (Kropik): fuel 0.10–0.15 l/(kW·h)',
  publisher: 'WKO Bundesinnung Bau (Austria)',
  year: 2022,
  url: 'https://WKO.at/oe/gewerbe-handwerk/bau/kalkulation-erdbaugeraete.pdf',
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

export const VOEGELE: Source = {
  title: 'VÖGELE SUPER 1800-3i datasheet (18,500 kg to 5 m / 21,050 kg to 8 m, 129 kW)',
  publisher: 'Wirtgen Group (Vögele)',
  year: 2024,
  url: 'https://www.wirtgen.de/binary/full/o205551v89_SUPER_18033(i)_mPW_deDE.pdf',
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

// ------------------------------------------------------------------ materials

export const MARTA: Source = {
  title: 'Preisliste Steinbruch Marta ab 01.04.2025 / Stottmeier Hartsteinwerk ab 01.04.2025 (FSS, STS, Mineralgemisch, Oberboden)',
  publisher: 'Ross Bauservice (Steinbruch Marta) / Stottmeier-Hartsteinwerk GmbH',
  year: 2025,
  url: 'https://ross-bauservice.de/wp-content/uploads/Preisliste-Marta-Steinbruch-ab-2025-04-01.pdf',
};

export const SCHMID: Source = {
  title: 'Preisliste Asphaltmischgut ab Werk gültig ab 23.03.2026 (cf. Schwarzenbeck 06/2026, Weinheim 03/2025)',
  publisher: 'Xaver Schmid GmbH (Bayern)',
  year: 2026,
  url: 'https://www.xaverschmid.de/hs/web.nsf/gfx/med_fdih-dt69yt_2552e4/$file/Preisliste%20Asphaltmischgut%20M%C3%A4rz%202026.pdf',
};

export const LEINWEBER: Source = {
  title: 'Preisliste Transportbeton (gültig ab 01.01.2024): C25/30 XC4/XF1 178.00 + Maut 5.25 + Diesel 2.00 + CO2 3.25 EUR/m3',
  publisher: 'Leinweber Baucentrum, Fulda',
  year: 2024,
  url: 'https://www.leinweber-baucentrum.de/api/rm/MH2F69S77CG45Y3/betonpreisliste-2026.pdf',
};

export const STAHLPREISE: Source = {
  title: 'Aktuelle Stahlpreise pro Tonne im Januar 2026 / Betonstahl Prognose Q1 2026',
  publisher: 'stahlpreise.eu',
  year: 2026,
  url: 'https://www.stahlpreise.eu/2026/01/aktuelle-stahlpreise-pro-tonne-1000-kg-entwicklung-im-januar-2026.html',
};

export const ELKA: Source = {
  title: 'Kantholz-Preis nach Querschnitt (01.09.2026); KVH NSi 669–720 EUR/m3 (03/2025 list)',
  publisher: 'elka-Holzwerke',
  year: 2026,
  url: 'https://www.elka-holzwerke.de/neuigkeiten/kantholz-preis-querschnitt/',
};

export const DIESEL: Source = {
  title: 'ADAC Spritpreise 2025 (diesel 1.612 EUR/l gross ≈ 1.355 net); EU Weekly Oil Bulletin 07.09.2026: 2.33 EUR/l gross ≈ 1.96 net',
  publisher: 'ADAC (via autohaus.de) / fuel-prices.eu',
  year: 2026,
  url: 'https://www.fuel-prices.eu/news/germany-diesel-above-2-30-eur-2026-09-07/',
};

export const PETROL: Source = {
  title: 'ADAC Kraftstoffpreisentwicklung: Super E10 yearly average 2024 1.739, 2025 1.688 EUR/l; monthly 2026 January 1.739, August 2.145, September 2.266 EUR/l (gross, at the pump)',
  publisher: 'ADAC',
  year: 2026,
  url: 'https://www.adac.de/verkehr/tanken-kraftstoff-antrieb/deutschland/kraftstoffpreisentwicklung/',
};

export const HH_DISPOSAL: Source = {
  title: 'Preisliste Kippgebühren gültig ab 01.04.2026 (Z0* 15.00–28.00, Z1.1 17.50–28.00 EUR/t)',
  publisher: 'HH-Basalt- und Diabaswerk GmbH (HH-Gruppe)',
  year: 2026,
  url: 'https://www.hh-gruppe.de/images/downloads/basalt_und_diabas/diabaswerk/preislisten/Preisliste_Entsorgung.pdf',
};

export const BAUPREIS_BW: Source = {
  title: 'Baupreisindex Baden-Württemberg (2021 = 100), Straßenbau: 2019 97.0, 2020 97.4, 2021 100, 2022 110.4, 2023 121.1; Aug 2024 +5.0 % y/y (Destatis)',
  publisher: 'Statistisches Landesamt BW via Bauwirtschaft Baden-Württemberg',
  year: 2024,
  url: 'https://bauwirtschaft-bw.de/fileadmin/user_upload/Bauwirtschaft_BW/Baupreisindex_2024.pdf',
};

// ------------------------------------------------------------------ soils & vegetation

export const CAT_WEIGHTS: Source = {
  title: 'Caterpillar Performance Handbook Ed. 49, Section 30 Tables — Weight of Materials (bank / loose density, load factor); frost classes ZTV E-StB',
  publisher: 'Caterpillar / fertighaus.de',
  year: 2019,
  url: 'https://www.macallister.com/wp-content/uploads/sites/2/caterpillar-performance-handbook-49.pdf',
};
