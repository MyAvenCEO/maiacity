/**
 * Provenance shared within the starter packs (decision 0006). Sources are those collected in
 * research/de/{climate,resources,roads}.json (compiled 2026-10-07). Where a value is NOT backed by
 * that research it cites `ASSUMPTION` / `SCENARIO` or a named standard work and carries confidence
 * 'low'; the note says so.
 */
import type { Source } from '../../kernel/src/index.ts';

export { cite, param as p, series } from '../../kernel/src/index.ts';

// ------------------------------------------------------------------ generic

export const SCENARIO: Source = {
  title: 'Scenario design: hilly rural site in southern Lower Saxony near Göttingen (Leine valley margin)',
  publisher: 'Constructible City starter-packs',
  year: 2026,
};

export const ASSUMPTION: Source = {
  title: 'Assumption of the data-pack author (no source in research/de)',
  publisher: 'Constructible City starter-packs',
  year: 2026,
};

// ------------------------------------------------------------------ a firm's fixed costs (wave 24/25: S503, S508)

/**
 * What a small building firm pays a year whatever it does, outside wages, machines, rent and what the sites use (those
 * are modelled where they arise): the chamber, the tax adviser, liability insurance, office, phone and software.
 */
export const FIRM_FIXED_COSTS: Source = {
  title:
    'Handwerkskammer Hildesheim-Südniedersachsen, Wirtschaftssatzung 2026 (Grundbeitrag 480 € for a company, Zusatzbeitrag 0.91 % of the trade profit); IHK Hannover, Wirtschaftssatzung 2026 (Grundbeitrag 369 € above 150,000 € trade profit, 0.062 % of it); StBVV §§ 33–35 with Tabellen B and C (payroll 6–30 € an employee a month, bookkeeping 2/10–12/10 of a Tabelle C fee a month, annual accounts 10/10–40/10 of Tabelle B); Destatis Kostenstrukturerhebung im Baugewerbe 2024 (WZ 43.12, 20–49 employees: other costs 6.0 % of turnover)',
  publisher: 'HWK Hildesheim-Südniedersachsen; IHK Hannover; BMJ (gesetze-im-internet.de); Statistisches Bundesamt',
  year: 2026,
  url: 'https://www.gesetze-im-internet.de/stbgebv/__33.html',
};
