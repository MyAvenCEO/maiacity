/**
 * Regional firms the players can subcontract to (fictional companies, southern Lower Saxony): road
 * and paving gangs, forestry, building trades. Their crews, price levels and order backlogs are
 * the region's construction market.
 */
import { eurostatCoprDe } from './datasets/eurostat-copr-de.ts';
import { ASSUMPTION, p } from './sources.ts';

const ROAD_EST = { title: 'Estimate (no calculation-grade German source found)', publisher: 'Constructible City', year: 2026 };
const BUILDING_EST = { title: 'Agent estimate (research/de/buildings.md, low confidence)', publisher: 'Constructible City research', year: 2026 };
const ZDH = { title: 'ZDH Konjunkturbericht Q4/2025 — Auftragsreichweite', publisher: 'Zentralverband des Deutschen Handwerks', year: 2025 };
const SEASON = 'paving gangs are booked out in the season; weeks of backlog are usual';

const roadFirm = (label: string, trades: string[], crews: number, priceFactor: number, leadDays: number, rebookDays: number) => ({
  label,
  trades,
  crews,
  priceFactor: p(priceFactor, '1', ROAD_EST, { note: 'relative to the market reference price of the trade', confidence: 'low' }),
  leadTime: p(leadDays, 'd', ROAD_EST, { note: SEASON, confidence: 'low' }),
  rebookDelay: p(rebookDays, 'd', ROAD_EST, { note: 'when the site is not ready the gang goes to another job first', confidence: 'low' }),
});

/** regional road contractors (fictional companies, southern Lower Saxony) */
const roadContractors = {
  'asphaltbau-leinetal': roadFirm('Leinetal Asphaltbau GmbH', ['paving.base', 'paving.binder', 'paving.surface', 'maint.patching', 'maint.crackSeal', 'maint.surfaceTreatment'], 2, 1.0, 21, 7),
  'strassenbau-harz': roadFirm('Harz Straßen- und Tiefbau', ['paving.base', 'paving.binder', 'paving.surface', 'maint.patching', 'maint.crackSeal', 'maint.surfaceTreatment'], 1, 0.93, 35, 10),
  'forst-solling': roadFirm('Forstservice Solling', ['clearing.fell'], 2, 1.0, 7, 5),
  'erdbau-goettingen': roadFirm('Göttinger Erd- und Tiefbau GmbH', ['earth.topsoil', 'earth.excavate', 'earth.fill', 'earth.backfill', 'earth.subgrade'], 2, 1.0, 21, 7),
  'erdbau-weserbergland': roadFirm('Erdbau Weserbergland', ['earth.topsoil', 'earth.excavate', 'earth.fill', 'earth.backfill', 'earth.subgrade'], 1, 0.92, 35, 10),
  'vermessung-hainberg': roadFirm('Vermessungsbüro Hainberg', ['survey.stakeout'], 2, 1.0, 10, 5),
};

const ZDH_NOTE = 'order backlog around the ZDH Q4/2025 trade averages (main trades 12.5 wk, finishing 9.9 wk); individual companies are scenario design';
const buildingFirm = (label: string, trades: string[], crews: number, priceFactor: number, leadDays: number, rebookDays: number) => ({
  label,
  trades,
  crews,
  priceFactor: p(priceFactor, '1', BUILDING_EST, {
    note: 'relative to the market reference price of the trade',
    confidence: 'low',
  }),
  leadTime: p(leadDays, 'd', ZDH, { note: ZDH_NOTE, confidence: 'medium' }),
  rebookDelay: p(rebookDays, 'd', BUILDING_EST, {
    note: 'when the site is not ready the crew goes to another job first',
    confidence: 'low',
  }),
});

/** regional contractors (fictional companies, southern Lower Saxony) */
const buildingContractors = {
  'rohbau-meyer': buildingFirm('Meyer Hoch- und Tiefbau GmbH', ['bld.foundation', 'bld.walls', 'bld.slab', 'bld.internalWalls', 'bld.hallSlab'], 2, 1.0, 88, 12),
  'bau-schroeder': buildingFirm('Bauunternehmung Schröder', ['bld.foundation', 'bld.walls', 'bld.slab', 'bld.internalWalls'], 1, 0.94, 115, 14),
  'zimmerei-wolf': buildingFirm('Zimmerei & Dachdeckerei Wolf', ['bld.roof'], 1, 1.0, 70, 10),
  'dach-krueger': buildingFirm('Krüger Bedachungen', ['bld.roof'], 2, 1.09, 45, 7),
  'fenster-lange': buildingFirm('Fensterbau Lange', ['bld.windows'], 1, 1.0, 75, 10),
  'putz-hartmann': buildingFirm('Hartmann Putz & Stuck', ['bld.render', 'bld.interior'], 2, 1.0, 60, 8),
  'maler-braun': buildingFirm('Malerbetrieb Braun', ['bld.paint', 'bld.interior'], 2, 0.97, 40, 7),
  'haustechnik-koenig': buildingFirm('König Haustechnik (SHK + Elektro)', ['bld.services', 'bld.hallServices'], 1, 1.0, 70, 10),
  'elektro-schmitt': buildingFirm('Elektro Schmitt', ['bld.services', 'bld.hallServices'], 2, 1.1, 42, 7),
  'stahlbau-zimmermann': buildingFirm('Stahlbau Zimmermann', ['bld.steelFrame', 'bld.sandwich', 'bld.hallSlab'], 1, 1.0, 85, 14),
};

/** all regional contractors: building trades and road trades */
export const contractors = { ...buildingContractors, ...roadContractors };

const COPR = eurostatCoprDe.source;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** how the region's firms' order books behave: with the construction cycle, the season, their luck */
export const contractorMarket = {
  reference: {
    level: p(1.009, '1', COPR, { note: 'Q4/2025, when ZDH surveyed the order backlogs the lead times come from: adjusted index 90.2 against the 2000–2026 mean 89.4', confidence: 'medium' }),
    season: p(1.112, '1', COPR, { note: 'October–December season factors (1.138, 1.138, 1.060)', confidence: 'medium' }),
  },
  cycleElasticity: p(3, '1', ASSUMPTION, { range: [1.5, 4], confidence: 'low', note: 'order backlogs swing much more than output: ZDH backlogs of the main trades roughly doubled from the 2010 low (activity ≈ 0.91) to the 2021 boom (≈ 1.11), ln 2 / ln 1.22 ≈ 3.5' }),
  season: eurostatCoprDe.season.map((v, k) => p(v, '1', COPR, { note: `${MONTHS[k]}: unadjusted over adjusted production in construction, mean 2000–2026`, confidence: 'medium' })),
  seasonElasticity: p(0.5, '1', ASSUMPTION, { range: [0.2, 1], confidence: 'low', note: 'winter thins the order books less than it thins the work: spring jobs are ordered in winter' }),
  adjustDays: p(45, 'd', ASSUMPTION, { range: [20, 90], confidence: 'low', note: 'a firm works through about one order book in this time; new orders replace the old at the market\'s pace' }),
  firmSpread: p(0.3, '1', ASSUMPTION, { range: [0.15, 0.5], confidence: 'low', note: 'some firms have little work while others are booked out (a lost or won large job)' }),
  priceElasticity: p(0.15, '1', ASSUMPTION, { range: [0.05, 0.3], confidence: 'low', note: 'a firm with twice its normal backlog quotes ≈ 11 % more; an idle one bids lower' }),
  fullAt: p(2.5, '1', ASSUMPTION, { range: [1.8, 4], confidence: 'low', note: 'beyond this a firm turns new clients away rather than quoting half a year out' }),
  rush: {
    days: p(5, 'd', ASSUMPTION, { range: [2, 10], confidence: 'low', note: 'a crew moved from another job, or overtime and Saturday work' }),
    premium: p(0.2, '1', ASSUMPTION, { range: [0.1, 0.5], confidence: 'low', note: 'overtime surcharges (25–50 % on wages) and the other client\'s delay, on the whole price; times how busy the firm is' }),
  },
  overrun: {
    mean: p(0.15, '1', ASSUMPTION, { range: [0, 0.4], confidence: 'low', note: 'the jobs ahead of ours take longer than planned more often than not (weather, late predecessors, changes)' }),
    spread: p(0.25, '1', ASSUMPTION, { range: [0.1, 0.5], confidence: 'low' }),
    noticeDays: p(5, 'd', ASSUMPTION, { range: [1, 14], confidence: 'low', note: 'the firm calls about a week before the date it gave' }),
  },
  regularAfter: p(3, '1', ASSUMPTION, { range: [1, 8], confidence: 'low', note: 'after a few jobs a firm counts us among its regular clients' }),
  graceDays: p(3, 'd', ASSUMPTION, { range: [0, 7], confidence: 'low', note: 'a regular client\'s firm waits a few days for a late site before it moves the crew on' }),
};
