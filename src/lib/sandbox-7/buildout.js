// @ts-nocheck — plain JS
/**
 * SANDBOX 6 · ONE VILLAGE · THE BUILD-OUT — how the village is built from day 0, when two settlers launch the first
 * settlement, to the full village of 1,500 (Samuel, 2026-10-13): the starter kit bought once and reused for every
 * settlement, the schedule month by month and dome by dome, and the euro bill it takes to bootstrap the whole village.
 *
 * Terms: a hex is a settlement, seven hexes are a village. Each settlement is built and owned by its settlement COOP,
 * founded the month the settlement launches (Samuel, 2026-10-13 06:50): it owns every dome there, rents the beds to its
 * residents and dome space to the business COOPs. The centre hex's is the Village COOP (Samuel, 07:00): it owns the
 * centre's domes and the village geothermal plant, whose drilling is on its bill. The default village has no Tower180: the centre hex's middle holds
 * one more Dome120 of utilities and community halls (src/lib/sandbox-9/village.js centrePlan()).
 *
 * The villagers build everything themselves: no wages. The crew is the residents who build (a share of them, part of
 * their week), their Avens (robots), and the kit's machines. People arrive as beds are finished: the containers of the
 * starter camp first, then the homes, dome by dome. The order follows what a settlement needs first: the camp, the
 * roads, the outdoor food forest planted early (it takes years to bear), the first homes and a food dome, the
 * utilities; the geothermal plant once the first settlement stands and its drilling can be paid; the works once there
 * are people to run them (the steelworks first: it saves the most); then the next settlement, reusing the kit.
 *
 * Every dome's size, tonnes and prices come from Sandbox 6 (./specs.js shellOf, KINDS, PRICES, FITOUT; ./stats.js
 * FACTORY_RUN, EQUIPMENT); this module adds only what building it takes: the kit, the work rates (crew-hours, crane
 * lifts) and the order. Every rate and price says where it comes from (BUILD_SOURCES) or that it is an estimate.
 *
 * The scheduler is a month-by-month resource model: each month the crew's hours, the cranes' and the telehandlers'
 * days are handed out to the steps under way in priority order; a step runs through its phases (footing, frame, shell,
 * inside) and finishes when its last phase does. Frost slows outdoor work from December to February; the food forest
 * is planted only in the planting months. Nothing is tuned to finish on time: if the rates do not fit six years, the
 * plan says so and shows what would.
 *
 * Pure and deterministic: the same options give the same plan, in node or the browser. `buildPlan()` is cached.
 */
import { LIVING, TOWER_HEX, VILLAGE, HEX_AREA, landOf } from './layout.js';
import { KINDS, PRICES, DENSITY, EQUIPMENT, FITOUT, FITOUT_HOME, FLOOR_MATERIALS, ENERGY, FACTORIES, WORKS_MACHINES, shellOf, towerShell, towerFloors, geodesicOf } from './specs.js';
import { FACTORY_RUN, GEOTHERMAL, TOWER_EQUIPMENT } from './stats.js';

// ── sources ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** where the kit's prices and the work rates come from; `est` marks an estimate */
export const BUILD_SOURCES = {
	containers: { label: 'Site containers (dealer listings, 2025/26)', url: 'https://www.maschinensucher.de/mss/sanit%C3%A4rcontainer', note: 'A new 20 ft office/living container with heating and air conditioning 5,750 € net (Cologne maker, fixed price); a new 20 ft container with shower cabin, sink and hot-water tank 12,900 € net (dealer near Sittensen); small new WC/shower units 3,130–3,730 € net. Asking prices, not a market survey.' },
	solarContainer: { label: 'Solar containers', url: 'https://www.qualenergia.it/articoli/fotovoltaico-mobile-cresce-potenza-container-140-kw/', note: 'SolarCont: a ~140 kWp fold-out container 135,000–145,000 €, "about 1,000 € a kWp" (QualEnergia); AEP Solar-Box, a 20 ft container with modules and storage, ~125,000 € (pv magazine 2023); a used 130 kWp Solarfold 95,000 € (listing).' },
	battery: { label: 'Battery storage (BNEF 2025)', url: 'https://www.energy-storage.news/battery-storage-system-prices-continue-to-fall-sharply-bnef-and-ember-reports-find/', note: 'BNEF Energy Storage Systems Cost Survey 2025: turnkey systems average US$177/kWh in Europe (US$117 worldwide, US$73 in China), ≈ 155 €/kWh at 1.13 $/€. A single small container costs more a kWh: 200 €/kWh used here (estimate; 250 before the cost audit, 2026-10-13).' },
	joinery: { label: 'Beam joinery centre (used)', url: 'https://www.maschinensucher.de/mss/hundegger+abbundanlage', note: 'Used Hundegger beam processing centres (K2 and similar) listed at ~55,000–255,000 € (maschinensucher.de, 2025/26). One at ~150,000 € with ~50,000 € to move, set and wire it (estimate) lets the village cut its own struts from blank glulam instead of buying them CNC-cut (cost audit, 2026-10-13).' },
	design: { label: 'Engineering, permits and the village plan', url: 'https://www.ftimmobilien24.com/immobilienmakler-m%C3%BCnchen/baunebenkosten-muenchen-2026-hoai-lbk-statik/', note: 'Building side costs (KG 700) run 15–20 % of a build, the architect 8–12 %, the structural engineer 1.5–2.5 % (Munich 2026); a development plan (Bebauungsplan) 20,000–100,000 € and more (bau.de). Three dome types designed once and repeated, a village plan, a development plan, soil and environmental reports, a checking engineer for each dome type and the fire concept: ~3 M€ (1.5–6, estimate; 0.75 M€ before the cost audit, 2026-10-13).' },
	excavator: { label: 'Excavators (Bagger)', url: 'https://equipbook.ai/value/year/2025-caterpillar-320', note: 'A 2025 Cat 320 (22 t) MSRP ~US$265,000 (valuation model, equipbook); a new JCB 145XR (17 t) 150,000 € net (dealer listing, Eltmann). A 20–22 t crawler excavator at ~230,000 € and an 8 t one at ~95,000 € are estimates from these.' },
	towerCrane: { label: 'Tower cranes (used, dealer listings 2026)', url: 'https://www.truckscout24.com/tsp/ts-204-89-430', note: 'Potain MDT 109 (2019, 55 m jib, ~2,000 h) 283,827 € net; Potain MDT 259 (2018, 65 m jib) 374,850 € net. A 65 m jib reaches the middle of a Dome120 (60 m in radius) from a mast inside it.' },
	mobileCrane: { label: 'All-terrain mobile crane (used)', url: 'https://www.cranetrader.com/listings/for-sale/liebherr/ltm1060/all-terrain-cranes/1016', note: 'Liebherr LTM 1060-3.1 (2019, 60 t) listed at 485,000 €; LTM 1060s range from US$75,000 to 729,000 by age and hours (CraneTrader).' },
	craneHire: { label: 'Crane hire (rent instead of buy)', url: 'https://www.deutsche-handwerks-zeitung.de/', note: 'KranVergleich price report 2026 (Deutsche Handwerks Zeitung): a 30 t truck crane 500–800 € a day with its driver, a heavy crawler up to 5,000 € a day; tower cranes on request only. Over six years of near-daily use, buying used is far cheaper than hiring.' },
	telehandler: { label: 'Telehandlers', url: 'https://www.maschinensucher.de/manitou-mt+1840/i-21793858', note: 'A new Manitou MT 1840 (17.5 m) 99,500 € net EXW (2025 listing); a 2025 one with 416 h 95,000 €.' },
	scaffold: { label: 'System scaffolding', url: 'https://www.maschinensucher.de/layher-ger%C3%BCst/i-22318012', note: 'Used Layher scaffold ~28–30 €/m² (a 45,000 m² lot at 1.25 M€ net; 58.9 m² at 1,750 € on eBay); new ~110 €/m² (the seller’s figure).' },
	trucks: { label: 'Trucks and trailers', url: 'https://www.truckscout24.de', note: 'New 3-axle tipper semi-trailers 34,900–56,900 € net (listings 2025/26); a 3-axle tipper truck (~160,000 €) and a truck with a loader crane (~220,000 €) are estimates.' },
	geothermal: { label: 'Geothermal wells and plant', url: 'https://www.bund-naturschutz.de/fileadmin/Bilder_und_Dokumente/Themen/Energiewende/230615_BN_Informiert_Geothermie-final.pdf', note: 'Our village energy research (energy/village-energy.md): an EGS triplet (1 injector, 2 producers) ~5.5 km deep and ~1.5 km sideways, a 4.3 MW gross / 3.4 MW net ORC, 30–45 M€ today. A Bavarian deep well “quickly costs over 10 M€” (BUND Naturschutz 2023); a doublet’s wells 12–25 M€ (GGSC 2009); Holzkirchen spent over 30 M€ on preparation and drilling (2016–17); a drilling day costs ~80,000 € (Schwäbische Zeitung); Fervo drilled a 5,927 m well in 21 days (ThinkGeoEnergy 2026). Priced here per well and metre (GEO): ~7,000 m measured a well at ~2,400 €/m (1,400–3,500, estimate: Bavarian deep wells cost 10–15 M€ each, kommunal.de), the ORC, coolers, exchangers and the stimulation at ~3,500 €/kW gross (2,000–5,000, estimate: small binary plants 3,700–7,200 $/kW, ESMAP) — ~65.5 M€, 66.5 M€ with the grid link. That is 19,500 € a kW net, inside NREL’s ATB 2024 range for deep EGS (13,400–33,500 $/kW, mean 22,100: atb.nrel.gov/electricity/2024/geothermal). Before the cost audit (2026-10-13) the plant was 37.9 M€ at 1,400 €/m and 1,750 €/kW, about half of what EGS costs today; Fervo aims at 3,000–5,500 $/kW later (fervoenergy.com, Q2 2026).' },
	eden: { label: 'Eden Project biomes (1998–2001)', url: 'https://www.constructionnews.co.uk/sections/news/the-genesis-of-the-new-eden-28-09-2000/', note: 'A kit of unique steel tubes cut by machine (MERO), erected by SGB from a 12-level birdcage scaffold 25 m across (230 miles of poles), the tower crane lifting the scaffold and then the steel; 625 hexagons, 16 pentagons and 190 triangles of ETFE; 2½ years to build, opened March 2001. The method our big domes follow: a crane at the middle, a scaffold under the crown.' },
	domerama: { label: 'Geodesic dome kits', url: 'https://www.domerama.com/raising-a-dome/geodesic-domes-and-assembly-times/', note: 'A 30 ft (9 m) 3V kit: 20 h for 3 people; a 36 ft: 30 h for 3–4 (Domerama); Pacific Domes 30 ft: 6–14 h with 3–4; a 42 ft growing dome ~5 days (Growing Spaces). Light struts by hand: ~0.3–0.4 crew-hours a strut.' },
	gridshell: { label: 'Timber gridshells', url: 'https://www.woodsolutions.com.au/blog/uk-field-tour-day-four', note: 'Savill Building (Windsor, 2006): the larch gridshell by 20 carpenters (Green Oak Carpentry), the building ~12 months; Weald & Downland (2002): the laths bent by lowering the edges a few centimetres a day from a scaffold (Buro Happold, Structural Engineer 2001). Bent-lath gridshells are slower than a geodesic of cut struts: an upper bound.' },
	stadthaus: { label: 'Modular timber building', url: 'https://www.dezeen.com/2023/03/10/murray-grove-stadthaus-waugh-thistleton-timber-revolution/amp/', note: 'Stadthaus, Murray Grove (London 2009): eight storeys of CLT put up by four carpenters in 27 working days, the panels craned in as they arrived; 49 weeks for the whole building. A mass-timber crew erects ~216 m² a day against ~170 m² for a concrete crew twice its size (ASC 2022).' },
	selfbuild: { label: 'Self-building', url: 'https://www.hausbau-forum.de/posts/565242/', note: 'A 186 m² house: ~1,600 h by the owner, 250 by the spouse, 1,050 by the father, ~400 by friends: ~3,300 h, ~18 h a m² (one builder’s report). An hour of own work saves 40–50 € of a tradesman (immoportal). German building costs are about half labour: BKI’s 1,635–2,580 €/m² at ~55 €/h ≈ 15–23 h a m² for professionals.' },
	learning: { label: 'Learning on repeated work', url: 'https://www.construction-physics.com/p/where-are-my-damn-learning-curves', note: 'The UN’s “Effect of Repetition on Building Operations and Processes on Site” (1965) and site studies: formwork 83.5 %, rebar 87.9 % a doubling (ECAM 2017); most production 60–90 %. Used here: 90 % a doubling of the same dome, the first at 1.3× and never under 0.7× (estimate).' },
	cranes: { label: 'Crane lifts', url: 'https://www.iaarc.org/publications/fulltext/An_integrated_approach_to_the_development_of_construction_site_crane_operations.PDF', note: 'More than half of tower-crane lifts take under 4 minutes; 5–15 % over 15 minutes, precast up to 15 % (IAARC). A panel or a strut triangle held while it is bolted: ~20 minutes a lift, 24 lifts a crane-day (estimate).' },
	steelErection: { label: 'Steel erection', url: 'https://www.planningplanet.com/index.php/comment/97943', note: 'Practitioners quote 20–120 man-hours a tonne for steelwork, erection with alignment and bolting at the top (forum figures: a wide spread). Our hubs go up bolted to their struts, so the frame is counted by the piece and the lift instead.' },
	raw: { label: 'Raw inputs once the works stand', url: 'https://www.lwk-niedersachsen.de', note: 'Spruce sawlogs 84–120 €/m³ (LWK Niedersachsen, May 2025), larch and Douglas about twice; steel scrap ~300 €/t (EU 2025); float glass ~US$680 a t in Germany (IMARC 2026); TOPCon modules 0.10 €/Wp delivered (pv magazine, May 2025), TOPCon cells 0.036–0.040 $/W (pv magazine, May 2025), ~0.045 €/Wp delivered at ~200 Wp a m² (estimate; see-through cells at ~0.3 €/Wp and 80 Wp before the cost audit, 2026-10-13). Sandbox 8’s border prices used the same figures before the audit.' },
	sandbox6: { label: 'Sandbox 6 (./specs.js, ./stats.js)', note: 'Every dome’s tonnes, panels and prices, the fit-out per m² (BKI 2025), the utilities’ machines, the works’ yearly output (FACTORY_RUN), the land at 78,000 €/ha.' }
};

// ── the starter kit ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The starter kit: bought once at day 0 by the first settlement's COOP and lent on to each next settlement's COOP.
 * `n` how many, `eur` each, `src` the source, `est` an estimate. The camp's containers move to each settlement as its
 * work starts; the cranes move from dome to dome. `beds`, `kwp`, `kwh` what an item gives.
 */
export const KIT = [
	// the camp: homes and services for the first settlers
	{ id: 'live', group: 'camp', label: 'Living containers, 20 ft, insulated and heated, two beds each', n: 30, eur: 5750 + 1500, beds: 2, src: 'containers', est: true, note: '5,750 € the container, ~1,500 € beds, lockers and a table' },
	{ id: 'sanitary', group: 'camp', label: 'Sanitary containers, 20 ft: showers, WCs, hot water', n: 6, eur: 12900, src: 'containers', note: 'one for ~10 people' },
	{ id: 'kitchen', group: 'camp', label: 'Kitchen and dining containers, 20 ft, fitted', n: 3, eur: 22000, src: 'containers', est: true, note: 'the container and a commercial kitchen' },
	{ id: 'workshop', group: 'camp', label: 'Workshop and store containers, 20 ft, benches and racks', n: 4, eur: 8750, src: 'containers', est: true },
	{ id: 'office', group: 'camp', label: 'Site office and first-aid container', n: 1, eur: 9000, src: 'containers', est: true },
	{ id: 'delivery', group: 'camp', label: 'Delivering and setting down a container', n: 44, eur: 800, src: 'containers', est: true, note: 'the dealer’s truck crane sets them' },
	// power
	{ id: 'solar', group: 'power', label: 'Solar containers, ~140 kWp each, fold-out', n: 2, eur: 140000, kwp: 140, src: 'solarContainer' },
	{ id: 'battery', group: 'power', label: 'Battery container, 500 kWh LFP', n: 1, eur: 500 * 200, kwh: 500, src: 'battery', est: true, was: 500 * 250 },
	{ id: 'genset', group: 'power', label: 'Generator, 150 kVA, on HVO (winter and crane peaks)', n: 1, eur: 35000, src: 'sandbox6', est: true },
	{ id: 'power', group: 'power', label: 'Site power: distribution boards and cables', n: 1, eur: 25000, src: 'sandbox6', est: true },
	// water
	{ id: 'well', group: 'water', label: 'Drinking-water well with UV filter', n: 1, eur: 30000, src: 'sandbox6', est: true, note: '~100 m at 100–200 €/m and its treatment' },
	{ id: 'mbr', group: 'water', label: 'Water treatment container (membrane bioreactor) for 100 people', n: 1, eur: 150000, src: 'sandbox6', est: true, note: 'Sandbox 6: small membrane bioreactors 800–3,000 € a person' },
	{ id: 'tanks', group: 'water', label: 'Water tanks, 30 m³', n: 2, eur: 6000, src: 'sandbox6', est: true },
	// machines
	{ id: 'excavator', group: 'machines', label: 'Crawler excavators (Bagger), 20–22 t', n: 2, eur: 230000, src: 'excavator', est: true },
	{ id: 'mini', group: 'machines', label: 'Excavator, 8 t', n: 1, eur: 95000, src: 'excavator', est: true },
	{ id: 'tower', group: 'machines', label: 'Tower cranes, flat-top, 65 m jib (used)', n: 2, eur: 374850, src: 'towerCrane', note: 'stood at the middle of each Dome80 and Dome120 while its frame and glass go up' },
	{ id: 'mobile', group: 'machines', label: 'All-terrain mobile crane, 60 t (used)', n: 1, eur: 485000, src: 'mobileCrane', note: 'sets the tower cranes, the containers, the CLT and the works’ machines' },
	{ id: 'handler', group: 'machines', label: 'Telehandlers, 17.5 m', n: 2, eur: 99500, src: 'telehandler', note: 'lift the Dome40s’ struts and panels' },
	{ id: 'boom', group: 'machines', label: 'Boom lifts, 26 m (used)', n: 3, eur: 65000, src: 'sandbox6', est: true, note: 'to bolt the hubs at height' },
	{ id: 'scissor', group: 'machines', label: 'Scissor lifts, 12 m', n: 4, eur: 18000, src: 'sandbox6', est: true },
	{ id: 'tipper', group: 'machines', label: 'Tipper truck, 3 axles', n: 1, eur: 160000, src: 'trucks', est: true },
	{ id: 'crane-truck', group: 'machines', label: 'Truck with a loader crane', n: 1, eur: 220000, src: 'trucks', est: true },
	{ id: 'vans', group: 'machines', label: 'Vans and pick-ups (used)', n: 2, eur: 25000, src: 'sandbox6', est: true },
	// site gear
	{ id: 'scaffold', group: 'site', label: 'System scaffolding, 6,000 m² (used)', n: 6000, eur: 30, src: 'scaffold', note: 'the birdcage under each crown, as at the Eden Project' },
	{ id: 'shoring', group: 'site', label: 'Shoring towers and props for the crowns', n: 1, eur: 60000, src: 'sandbox6', est: true },
	{ id: 'survey', group: 'site', label: 'Survey kit: GNSS rover and total station', n: 1, eur: 30000, src: 'sandbox6', est: true },
	// workshop
	{ id: 'cnc', group: 'workshop', label: 'Timber workshop: 3 × 2 m CNC router, panel saw, planer, dust extraction', n: 1, eur: 160000, src: 'sandbox6', est: true, note: 'for the north cassettes and the fit-out joinery' },
	{ id: 'joinery', group: 'workshop', label: 'Beam joinery centre (used), to cut the struts from blank glulam', n: 1, eur: 200000, src: 'joinery', est: true, note: '~150,000 € used and ~50,000 € to move, set and wire it; it replaces buying the struts CNC-cut (cost audit, 2026-10-13)' },
	{ id: 'tools', group: 'workshop', label: 'Tools: power tools, welding, lifting gear, safety', n: 1, eur: 90000, src: 'sandbox6', est: true }
];
/** the kit's groups, for the page */
export const KIT_GROUPS = { camp: 'The camp', power: 'Power', water: 'Water', machines: 'Machines', site: 'Site gear', workshop: 'Workshop' };
/** running the kit: fuel, upkeep, insurance and tyres, a share of the machines' and the power kit's price a year
 * (estimate; fleets budget 10–15 % of a machine's value a year for maintenance alone, getclue.com 2025; the tower
 * cranes run on the site's power, so 15 % in all is about right, checked in the cost audit, 2026-10-13) */
const RUNNING_SHARE = 0.15;
/** the geothermal plant, bought as services (BUILD_SOURCES.geothermal; estimates, cost audit 2026-10-13): `wells` ×
 * `mWell` measured metres at `eurM`, the ORC, coolers, exchangers and the rock's stimulation at `eurKw` a kW gross,
 * and the grid link (a medium-voltage connection fee of 88–131 €/kW, Stadtwerke price sheets, and the line). Low–high:
 * 1,400–3,500 €/m and 2,000–5,000 €/kW. */
export const GEO = { wells: 3, mWell: 7000, eurM: 2400, kwGross: 4300, eurKw: 3500, grid: 1e6, est: true };
/** engineering, permits and the village plan, € (BUILD_SOURCES.design; estimate, 1.5–6 M€) */
export const DESIGN_EUR = 3e6;

// ── how fast the work goes ──────────────────────────────────────────────────────────────────────────────────────

/** work rates, crew-hours (a crew-hour: an hour of a person or its Aven's equivalent), professional pace before the learning curve */
export const RATES = {
	footing: { v: 3, unit: 'crew-h a m³ of lime-pozzolan footing (dig, form, pour)', src: 'sandbox6', est: true },
	lift: { v: (5 * 20) / 60, unit: 'crew-h a crane lift: 5 people, ~20 minutes held and bolted', src: 'cranes', est: true },
	liftsPerDay: { v: 24, unit: 'lifts a crane-day', src: 'cranes', est: true },
	strut: { v: 1, unit: 'crew-h a strut, bolted to its hubs into triangles on the ground', src: 'domerama', est: true },
	hub: { v: 1.5, unit: 'crew-h a hub, aligned and bolted at height', src: 'steelErection', est: true },
	glazing: { v: 0.6, unit: 'crew-h a m² of glass or solar panel: gaskets, seals, the cells’ wiring (besides its lift)', src: 'sandbox6', est: true },
	hemp: { v: 1, unit: 'crew-h a m² of the north shell: cassettes set, filled with hemp, sealed', src: 'sandbox6', est: true },
	craneSet: { v: 5, unit: 'crane-days to stand and strike a tower crane in a Dome80 or Dome120', src: 'towerCrane', est: true },
	homes: { v: 18, unit: 'crew-h a m² of home: the CLT block, its baths, kitchens, services, finishes', src: 'selfbuild' },
	halls: { v: 12, unit: 'crew-h a m² of the utilities’ halls and workspaces', src: 'selfbuild', est: true },
	water: { v: 5, unit: 'crew-h a m² of the water works and its planted wetland', src: 'sandbox6', est: true },
	garden: { v: 0.6, unit: 'crew-h a m² of garden under the glass: soil, pond, paths, planting', src: 'sandbox6', est: true },
	works: { v: 4, unit: 'crew-h a m² of a works’ floor: its hall and setting its machines', src: 'sandbox6', est: true },
	forest: { v: 250, unit: 'crew-h a ha of outdoor food forest: ~300 trees and ~1,500 shrubs, mulch, seed', src: 'sandbox6', est: true },
	woods: { v: 250, unit: 'crew-h a ha of timber woodland or bamboo planted', src: 'sandbox6', est: true },
	sow: { v: 20, unit: 'crew-h a ha of hemp sown', src: 'sandbox6', est: true },
	road: { v: 0.15, unit: 'crew-h a m² of gravel road or path, with the excavators and the tipper', src: 'sandbox6', est: true },
	lines: { v: 1000, unit: 'crew-h a km of heat-pipe pair and power cable laid in a trench', src: 'sandbox6', est: true },
	container: { v: 4, unit: 'crew-h to connect a container (set by the dealer)', src: 'containers', est: true },
	move: { v: 8, unit: 'crew-h to move and reconnect a container', src: 'containers', est: true },
	learning: { v: 0.9, first: 1.3, floor: 0.7, unit: 'hours × first, then 90 % a doubling of the same kind', src: 'learning', est: true }
};

/** who builds: residents, their Avens, the works' jobs (estimates) */
export const LABOUR = {
	share: { v: 0.6, note: 'of the residents build (the rest are children, the old, and those who run the food, care and kitchens)' },
	hours: { v: 108, note: 'hours a month a builder gives (25 a week; no wages: the rest of the week is food, care and their own life)' },
	pioneer: { v: 160, note: 'hours a month each of the first settlers gives (full time)' },
	aven: { v: 60, note: 'crew-hour equivalents a month from each resident’s Aven: a building robot at a fifth of a builder’s output over ~300 hours (today’s site robots dig, tie rebar, mark out and lift; none yet builds a home alone)' },
	jobs: { v: 35, note: 'people who run a works once it stands (Sandbox 6: ~35 a factory dome), each 140 hours a month' },
	winter: { v: 0.6, note: 'outdoor work from December to February runs at 60 % (frost, short days, curing)' },
	fte: { v: 160, note: 'hours a month of one full-time crew member, to state crew sizes' }
};

/** what a material costs bought finished (Sandbox 6's PRICES) and made in the village's own works from raw inputs (estimates) */
const OWN = {
	/** larch/Douglas logs ~210 €/m³ at ~0.5 m³ of glulam a m³ of logs, glue and wear ~40: € a m³ of glulam or CLT */
	timberM3: 210 / 0.5 + 40,
	/** scrap 300 €/t at 1.1 t a t, electrodes, alloys and zinc ~150: € a t of cast hubs and connectors */
	steelT: 300 * 1.1 + 150,
	/** float glass ~650 €/t at 0.05 t a m², interlayer, spacers and low-E ~25: € a m² of laminated double glazing */
	glassM2: 650 * 0.05 + 25,
	/** TOPCon cells 0.036–0.040 $/W FOB (pv magazine, May 2025), ~0.045 €/Wp delivered in small lots, at the ~200 Wp a
	 * m² that the model's 227 kWh/m² a year needs; encapsulant, ribbons and junctions ~6: € a m² of solar panel on top of
	 * its glass (estimate; 0.3 €/Wp × 80 Wp = 30 € before the cost audit, 2026-10-13) */
	pvM2: 0.045 * 200 + 6
};
/** what one works makes a month at full output (Sandbox 6 FACTORY_RUN), and how long it takes to get there */
const WORKS_OUT = { steel: { t: FACTORY_RUN.steel.t / 12 }, glass: { m2: 20000 / 12 }, timber: { t: FACTORY_RUN.timber.t / 12 } };
const WORKS_RAMP = 6;
/** works whose furnace or kiln needs the geothermal plant's power to run */
const NEEDS_GEO = new Set(['steel', 'lime', 'clay']);
/** the works that make what the build-out buys most of; the others are built but staffed after the build-out */
const MAKERS = new Set(['steel', 'glass', 'timber']);

// ── the village, piece by piece ─────────────────────────────────────────────────────────────────────────────────

/** the order the settlements are launched in (clockwise from the east), and their COOPs' names */
const LIVING_ORDER = ['living-e', 'living-se', 'living-sw', 'living-w', 'living-nw', 'living-ne'];
/** the order of a living hex's domes: the first homes and a food dome, the utilities, then the rest, small homes first */
const LIVING_SITES = ['h40-0', 'h40-1', 'foodW', 'h40-2', 'util', 'h80-1', 'h40-3', 'foodE', 'h80-0', 'h40-4', 'h80-2', 'h40-5', 'h80-3', 'h40-6', 'h40-7', 'h80-4', 'h40-8'];
/** the works in the order they are built: what saves the most first */
const WORKS_ORDER = ['steel', 'glass', 'timber', 'hemp', 'lime', 'recycling', 'bamboo', 'clay'];
const HEX_LABEL = Object.fromEntries(VILLAGE.map((h) => [h.key, h.key === 'tower' ? 'Centre hex' : h.label]));
const SHORT = (/** @type {string} */ key) => (HEX_LABEL[key] ?? key).replace(' hex', '');
/** a settlement's COOP: each living hex's own settlement COOP; the centre hex's is the Village COOP (Samuel, 2026-10-13
 * 07:00), which owns the centre's domes and the village's geothermal plant */
export const coopOf = (/** @type {string} */ key) => (key === 'tower' ? 'Village COOP' : `${SHORT(key)} settlement COOP`);

/** gross floor of the utilities dome's built blocks (no water works), and of its water works */
const UTIL_BUILT = KINDS.util120.zones.filter((z) => z.block && z.block !== 'water').reduce((a, z) => a + z.m2, 0);
const UTIL_WATER = KINDS.util120.zones.filter((z) => z.block === 'water').reduce((a, z) => a + z.m2, 0);
/** the timber a m² of the north shell's cassettes takes (specs.js CASSETTE_M) */
const CASSETTE_M = 0.06;

/** the land, counted once a plan */
const landCache = new Map();
const landM2 = (plan) => {
	let l = landCache.get(plan);
	if (!l) landCache.set(plan, (l = landOf(plan).m2));
	return l;
};

/**
 * One dome as a build step: its phases (footing, frame, shell, inside) with their crew-hours and lifts, its tonnes,
 * the euros of what is bought for it (finished, at Sandbox 6's prices), its beds and energy.
 * @param {string} kind dome40 | dome80 | food120 | util120 | factory120 | centre
 */
function domeWork(kind, factory) {
	const K = KINDS[kind === 'centre' ? 'util120' : kind];
	const sh = shellOf(K.D);
	const g = geodesicOf(K.D);
	const big = K.D >= 80;
	// a tower crane stands in the middle of a Dome80 or Dome120 while its frame and glass go up; the telehandlers lift a Dome40's
	const pool = big ? 'tower' : 'handler';
	const cassette = sh.north * CASSETTE_M;
	const struts = sh.m.timber - cassette;
	const R = RATES;
	const liftsFrame = Math.ceil(g.struts / 3);
	const glazedPanels = g.count.glass + g.count.solar;
	const phases = [
		{ id: 'footing', label: 'footing', h: sh.m.lime * R.footing.v, lifts: 0, pool: null, outdoor: true, eur: sh.eur.lime, t: { lime: sh.t.lime } },
		{
			id: 'frame', label: 'frame', h: liftsFrame * R.lift.v + g.struts * R.strut.v + g.hubs * R.hub.v, lifts: liftsFrame, set: big ? R.craneSet.v : 0, pool, outdoor: true,
			eur: struts * PRICES.glulam.eur + sh.eur.steel, t: { glulam: struts * DENSITY.glulam, steel: sh.t.steel }, own: { timberM3: struts, steelT: sh.t.steel, timberEur: struts * PRICES.glulam.eur }
		},
		{
			id: 'shell', label: 'glass and hemp', h: (glazedPanels + g.count.hemp) * R.lift.v + sh.glazed * R.glazing.v + sh.north * R.hemp.v, lifts: glazedPanels + g.count.hemp, pool, outdoor: true,
			eur: sh.eur.glass + sh.eur.pv + sh.eur.hemp + cassette * PRICES.cassette.eur, t: { glass: sh.t.glass, hemp: sh.t.hemp, glulam: cassette * DENSITY.glulam }, pvM2: sh.m.pv,
			own: { glassM2: sh.glazed, pvM2: sh.m.pv, timberM3: cassette, timberEur: cassette * PRICES.cassette.eur }
		}
	];
	// inside: what each kind of dome holds
	let inside, beds = 0, machines = 0, check = 0, use = sh.climate, label = K.label;
	const gardenM2 = (zones) => zones.filter((z) => z.use === 'indoorFood' || z.use === 'pond').reduce((a, z) => a + z.m2, 0);
	if (kind === 'dome40' || kind === 'dome80') {
		const clt = K.gfa * 0.28;
		const lifts = Math.ceil((K.gfa * 2) / 20);
		inside = { id: 'inside', label: 'homes inside', h: K.gfa * R.homes.v + gardenM2(K.zones) * R.garden.v + lifts * R.lift.v, lifts, pool: 'handler', eur: K.gfa * FITOUT_HOME * 0.5 + gardenM2(K.zones) * 40, t: { glulam: clt * DENSITY.clt }, own: { timberM3: clt, timberEur: clt * PRICES.clt.eur } };
		beds = K.people;
		check = big ? 15000 : 8000;
		use += beds * ENERGY.person + beds * ENERGY.water;
		label = `${K.label} home of ${K.people}`;
	} else if (kind === 'food120') {
		inside = { id: 'inside', label: 'the food forest under glass', h: gardenM2(K.zones) * R.garden.v + 300 * R.halls.v, lifts: 0, pool: null, eur: gardenM2(K.zones) * 40 + 300 * FITOUT.utilities * 0.5, t: {} };
		check = 30000;
		label = 'Dome120 food forest';
	} else if (kind === 'util120' || kind === 'centre') {
		const clt = UTIL_BUILT * 0.25;
		inside = { id: 'inside', label: kind === 'centre' ? 'halls and utilities' : 'utilities and workshops', h: UTIL_BUILT * R.halls.v + UTIL_WATER * R.water.v, lifts: 15 * R.liftsPerDay.v, pool: 'mobile', eur: UTIL_BUILT * FITOUT.utilities * 0.5, t: { glulam: clt * DENSITY.clt }, own: { timberM3: clt, timberEur: clt * PRICES.clt.eur } };
		// the centre keeps the village's 40 MWh of batteries (village.js: the tower's data centre and water works go)
		machines = kind === 'centre' ? TOWER_EQUIPMENT.filter((e) => /Batteries/.test(e.label)).reduce((a, e) => a + e.eur, 0) : EQUIPMENT.reduce((a, e) => a + e.eur, 0);
		check = 30000;
		use += kind === 'centre' ? 0 : ENERGY.datacenter + UTIL_BUILT * ENERGY.workshop;
		label = kind === 'centre' ? 'Dome120 centre: utilities and community halls' : 'Dome120 utilities';
	} else {
		// a works: its machines are bought (specs.js WORKS_MACHINES, listings and estimates); the hall is the dome. Before
		// the cost audit (2026-10-13) each works was 60 % of a factory's 1,500 €/m² fit-out: 10.2 M€ each.
		const floor = sh.cap.floor;
		inside = { id: 'inside', label: 'the works’ machines', h: floor * R.works.v, lifts: 20 * R.liftsPerDay.v, pool: 'mobile', eur: 0, t: {} };
		machines = WORKS_MACHINES[factory]?.eur ?? 2e6;
		check = 30000;
		const run = FACTORY_RUN[factory];
		use += run ? run.t * run.kwh : 0;
		label = FACTORIES.find((f) => f.id === factory)?.label ?? 'Works';
	}
	phases.push(inside);
	return { phases, beds, machines, check, label, energy: { solarKwhYear: sh.solar, useKwhYear: use, heatKwhYear: sh.heat } };
}

/** the tower, for the experiment with it: its diagrid, glass and floors as one step */
function towerWork(T) {
	const sh = towerShell(T);
	const floors = towerFloors(T);
	const R = RATES;
	const grid = sh.grid;
	const liftsFrame = Math.ceil(grid.struts / 3), panels = grid.panels.length;
	const floorM2 = floors.reduce((a, f) => a + f.m2, 0);
	const clt = floors.reduce((a, f) => a + f.m2 * (f.id === 'factory' || f.id === 'deck' || f.id === 'base' ? FLOOR_MATERIALS.longSpan : FLOOR_MATERIALS.timber), 0);
	const screed = floorM2 * FLOOR_MATERIALS.screed;
	const fit = floors.reduce((a, f) => a + f.m2 * (FITOUT[f.use] ?? 2500), 0);
	const phases = [
		{ id: 'footing', label: 'footing', h: sh.m.lime * R.footing.v, lifts: 0, pool: null, outdoor: true, eur: sh.eur.lime, t: { lime: sh.t.lime } },
		{ id: 'frame', label: 'frame', h: liftsFrame * R.lift.v + grid.struts * R.strut.v + grid.hubs * R.hub.v, lifts: liftsFrame, set: 20, pool: 'tower', outdoor: true, eur: sh.eur.timber + sh.eur.steel, t: { glulam: sh.t.timber, steel: sh.t.steel } },
		{ id: 'shell', label: 'glass and hemp', h: panels * R.lift.v + sh.glazed * R.glazing.v + sh.north * R.hemp.v, lifts: panels, pool: 'tower', outdoor: true, eur: sh.eur.glass + sh.eur.pv + sh.eur.hemp, t: { glass: sh.t.glass, hemp: sh.t.hemp }, pvM2: sh.m.pv },
		{ id: 'inside', label: 'floors inside', h: floorM2 * R.homes.v, lifts: Math.ceil(floorM2 / 10), pool: 'mobile', eur: fit * 0.5, t: { glulam: clt * DENSITY.clt, concrete: screed * DENSITY.concrete } }
	];
	const machines = TOWER_EQUIPMENT.filter((e) => !/Geothermal/.test(e.label)).reduce((a, e) => a + e.eur, 0);
	const apts = Math.round((floors.find((f) => f.id === 'apartments')?.m2 ?? 0) / 250);
	return { phases, beds: Math.round(apts * 2.2), machines, check: 250000, label: T.label, energy: { solarKwhYear: sh.solar, useKwhYear: sh.climate, heatKwhYear: sh.heat }, climbing: 3e6 };
}

/** euros of a hex's land, Sandbox 6's price */
const LAND_EUR = (HEX_AREA / 1e4) * PRICES.land.eur;

/**
 * The steps, in priority order: each settlement in turn (land, camp, roads, forest, its domes), the centre's pieces
 * between them, gated by what must come first.
 */
function makeSteps(o) {
	/** @type {any[]} */
	const steps = [];
	const R = RATES;
	const count = {};
	const learn = (kind) => {
		count[kind] = (count[kind] ?? 0) + 1;
		const n = count[kind];
		return Math.max(R.learning.floor, R.learning.first * Math.pow(n, Math.log2(R.learning.v)));
	};
	const containers = o.kit.filter((k) => k.group === 'camp' && k.id !== 'delivery').reduce((a, k) => a + k.n, 0);
	const add = (s) => {
		s.prio = steps.length;
		s.label ??= s.kind;
		s.phases = s.phases.map((p) => ({ lifts: 0, pool: null, eur: 0, t: {}, ...p }));
		steps.push(s);
		return s;
	};
	const dome = (hex, site, kind, factory, gate) => {
		const w = domeWork(kind, factory);
		const k = learn(kind === 'centre' ? 'util120' : kind);
		for (const p of w.phases) {
			p.h *= k * o.hoursFactor * (o.prefab && (p.id === 'frame' || p.id === 'shell') ? o.prefab.shellHours : 1) * (o.prefab && p.id === 'inside' && w.beds ? o.prefab.homeHours : 1);
			if (o.prefab && (p.id === 'frame' || p.id === 'shell')) p.lifts *= o.prefab.lifts;
		}
		const extra = o.prefab ? w.phases.filter((p) => p.id === 'frame' || p.id === 'shell').reduce((a, p) => a + p.eur, 0) * o.prefab.shellEur + (w.beds ? (kind === 'dome80' ? KINDS.dome80.gfa : KINDS.dome40.gfa) * o.prefab.homeEurM2 : 0) : 0;
		return add({ id: `${hex}/${site}`, hex, site, kind, factory, label: w.label, phases: w.phases, beds: w.beds, machines: w.machines, check: w.check, energy: w.energy, prefabEur: extra, maxCrew: kind === 'dome40' ? 14 : kind === 'dome80' ? 34 : 50, gate });
	};
	const settled = (key) => (st) => st.hexDone[key];

	// the engineering of the three dome types and the village plan, at day 0 (designs reused for every dome)
	add({ id: 'design', hex: LIVING_ORDER[0], site: 'design', kind: 'design', label: 'Engineering of the three dome types, the village plan and its permits', phases: [{ id: 'paper', h: 0, fixed: 1 }], services: DESIGN_EUR, maxCrew: 1 });

	LIVING_ORDER.forEach((key, i) => {
		const prev = LIVING_ORDER[i - 1];
		const launched = prev ? (st) => st.allStarted(prev) : null;
		const land = landM2(LIVING);
		add({ id: `${key}/land`, hex: key, site: 'land', kind: 'land', label: `Land, ${(HEX_AREA / 1e4).toFixed(1)} ha`, phases: [{ id: 'buy', h: 0 }], land: LAND_EUR, maxCrew: 1, gate: launched });
		add({
			id: `${key}/camp`, hex: key, site: 'camp', kind: 'camp', label: i ? 'Moving the camp' : 'The starter camp',
			phases: [{ id: 'set', label: i ? 'moving the containers' : 'setting up the containers', h: i ? containers * R.move.v : containers * R.container.v + 200, lifts: i ? containers * 2 : 0, pool: i ? 'mobile' : null }],
			camp: true, maxCrew: 20, gate: launched
		});
		const roadM2 = land.road ?? 0;
		add({
			id: `${key}/roads`, hex: key, site: 'roads', kind: 'roads', label: 'Roads, paths, heat and power lines',
			phases: [{ id: 'roads', label: 'roads and lines', h: roadM2 * R.road.v + R.lines.v, outdoor: true, eur: roadM2 * 0.3 * 1.8 * 16 + 1000 * 250, t: { gravel: roadM2 * 0.3 * 1.8 } }],
			maxCrew: 16, gate: launched
		});
		const forestHa = (land.foodForest ?? 0) / 1e4;
		add({ id: `${key}/forest`, hex: key, site: 'forest', kind: 'forest', label: `Planting the outdoor food forest, ${forestHa.toFixed(1)} ha`, phases: [{ id: 'plant', label: 'planting', h: forestHa * R.forest.v, outdoor: true, planting: true, eur: forestHa * 9000 }], forestHa, maxCrew: 60, gate: launched });
		for (const site of LIVING_SITES) dome(key, site, LIVING.sites.find((s) => s.id === site).kind, undefined, launched);

		// the centre's pieces, after the first settlement
		if (i === 0) {
			const after1 = (st) => st.hexDone[LIVING_ORDER[0]] && st.m >= 12;
			add({ id: 'tower/land', hex: 'tower', site: 'land', kind: 'land', label: `Land, ${(HEX_AREA / 1e4).toFixed(1)} ha`, phases: [{ id: 'buy', h: 0 }], land: LAND_EUR, maxCrew: 1, gate: after1 });
			add({
				id: 'tower/geothermal', hex: 'tower', site: 'geothermal', kind: 'geothermal', label: 'Geothermal: three wells ~7 km each, the ORC plant and the heat loop',
				phases: [{ id: 'drill', label: 'drilling the wells', h: 2000, fixed: 12, outdoor: true }, { id: 'plant', label: 'stimulating the rock, building the ORC', h: 1500, fixed: 6 }],
				services: GEO.wells * GEO.mWell * GEO.eurM + GEO.kwGross * GEO.eurKw, grid: GEO.grid, maxCrew: 6, gate: after1,
				energy: { solarKwhYear: 0, useKwhYear: 0, geoKwhYear: GEOTHERMAL, heatKwhYear: 104e6 }
			});
			const cl = landM2(TOWER_HEX);
			add({
				id: 'tower/roads', hex: 'tower', site: 'roads', kind: 'roads', label: 'Centre roads, yards, heat and power lines',
				phases: [{ id: 'roads', label: 'roads and lines', h: ((cl.road ?? 0) + (cl.yard ?? 0) * 0.3) * R.road.v + 2 * R.lines.v, outdoor: true, eur: ((cl.road ?? 0) + (cl.yard ?? 0) * 0.3) * 0.3 * 1.8 * 16 + 2000 * 250, t: { gravel: ((cl.road ?? 0) + (cl.yard ?? 0) * 0.3) * 0.3 * 1.8 } }],
				maxCrew: 16, gate: after1
			});
			const woodsHa = ((cl.woodland ?? 0) + (cl.bamboo ?? 0)) / 1e4, hempHa = (cl.hemp ?? 0) / 1e4;
			add({ id: 'tower/fields', hex: 'tower', site: 'fields', kind: 'fields', label: `Planting the woods and bamboo (${woodsHa.toFixed(1)} ha), sowing hemp (${hempHa.toFixed(1)} ha)`, phases: [{ id: 'plant', label: 'planting', h: woodsHa * R.woods.v + hempHa * R.sow.v, outdoor: true, planting: true, eur: woodsHa * 6000 + hempHa * 300 }], forestHa: 0, maxCrew: 40, gate: after1 });
		}
		// a works after each settlement from the first on, the steelworks first; the halls in the middle at 600 people
		if (i >= 0) {
			const ids = i === 0 ? WORKS_ORDER.slice(0, 2) : i === 1 ? WORKS_ORDER.slice(2, 3) : i === 2 ? WORKS_ORDER.slice(3, 5) : i === 3 ? WORKS_ORDER.slice(5, 6) : i === 4 ? WORKS_ORDER.slice(6) : [];
			for (const id of ids) {
				const s = TOWER_HEX.sites.find((x) => x.factory === id);
				const k = WORKS_ORDER.indexOf(id);
				dome('tower', s.id, 'factory120', id, (st) => st.hexDone[LIVING_ORDER[0]] && st.people >= 200 + 60 * k);
			}
			if (i === 2) {
				if (o.tower) {
					const w = towerWork(TOWER_HEX.tower);
					add({ id: 'tower/tower', hex: 'tower', site: 'tower', kind: 'tower', label: w.label, phases: w.phases, beds: w.beds, machines: w.machines, check: w.check, services: w.climbing, energy: w.energy, maxCrew: 200, gate: (st) => st.people >= 600 });
				} else dome('tower', 'centre', 'centre', undefined, (st) => st.people >= 600);
			}
		}
	});
	return steps;
}

// ── the scheduler ───────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KINDS_EUR = ['kit', 'running', 'materials', 'machines', 'services', 'land'];
/** the euro kinds, for the page */
export const EUR_KINDS = { kit: 'Starter kit', running: 'Running the kit', materials: 'Materials', machines: 'Machines', services: 'Services', land: 'Land' };

/**
 * Runs the month-by-month build: hands out the crew's hours and the lifts to the steps under way, starts the next
 * steps as hours are free and their gates open, moves people in as beds are finished.
 */
function schedule(o) {
	const steps = makeSteps(o);
	const kit = o.kit;
	const kitEur = kit.reduce((a, k) => a + k.n * k.eur, 0);
	const runEurMonth = (kit.filter((k) => k.group === 'machines' || k.group === 'power').reduce((a, k) => a + k.n * k.eur, 0) * RUNNING_SHARE) / 12;
	const nOf = (id) => kit.find((k) => k.id === id)?.n ?? 0;
	const towers = nOf('tower'), mobiles = nOf('mobile'), handlers = nOf('handler');
	const cranes = towers + mobiles;
	/** lifts a crane or telehandler makes in a month of 21 working days */
	const LIFTS_MONTH = 21 * RATES.liftsPerDay.v;
	/** the tower cranes: each stands in one dome from its frame to its last pane */
	const slots = Array.from({ length: towers }, () => ({ holder: null, left: 0, used: 0 }));
	const campBeds = kit.filter((k) => k.beds).reduce((a, k) => a + k.n * k.beds, 0);
	const L = o.labour;
	const hexes = [...LIVING_ORDER, 'tower'];
	for (const s of steps) {
		s.H = s.phases.reduce((a, p) => a + p.h, 0);
		s.lifts = s.phases.reduce((a, p) => a + (p.lifts ?? 0), 0);
		s.liftDays = s.phases.reduce((a, p) => a + (p.lifts ?? 0) / RATES.liftsPerDay.v + (p.set ?? 0), 0);
		s.matFinished = s.phases.reduce((a, p) => a + (p.eur ?? 0), 0);
		s.state = 'wait';
		s.phase = 0;
		s.pDone = 0; // progress of the current phase, 0..1
		s.done = 0; // hours done, for the overall progress
		s.prog = [];
		s.used = { h: 0, crane: 0, handler: 0 };
		s.eur = { materials: 0, materialsFinished: 0, worksSaved: 0, machines: 0, services: 0, land: 0, prefab: 0 };
		s.t = {};
		s.pvM2 = 0;
	}
	const st = {
		m: 0,
		people: o.settlers,
		hexDone: Object.fromEntries(hexes.map((k) => [k, false])),
		allStarted: (key) => steps.filter((s) => s.hex === key && s.kind !== 'design').every((s) => s.state !== 'wait')
	};
	let beds = 0, domeBeds = 0, campOn = false, campAt = null, campGone = null;
	const cum = Object.fromEntries(KINDS_EUR.map((k) => [k, 0]));
	const hexCum = Object.fromEntries(hexes.map((k) => [k, 0]));
	const months = [];
	const works = {}; // id -> month it stood
	let geoOn = null, peopleFull = null, end = null;
	const maxM = o.maxMonths;
	for (let m = 0; m <= maxM; m++) {
		st.m = m;
		const cal = (o.startMonth - 1 + m) % 12; // 0 = January
		const winter = cal === 11 || cal === 0 || cal === 1;
		const planting = cal === 2 || cal === 3 || cal === 9 || cal === 10;
		const eurM = Object.fromEntries(KINDS_EUR.map((k) => [k, 0]));
		const hexM = Object.fromEntries(hexes.map((k) => [k, 0]));
		if (m === 0) {
			eurM.kit += kitEur;
			hexM[LIVING_ORDER[0]] += kitEur;
		}
		// the crew this month
		const people = st.people;
		const pioneers = Math.min(people, o.settlers);
		const builders = Math.max(pioneers, people * L.share.v);
		const human = pioneers * L.pioneer.v + Math.max(0, builders - pioneers) * L.hours.v;
		const running = Object.keys(works).filter((id) => MAKERS.has(id) && m > works[id] && (!NEEDS_GEO.has(id) || (geoOn !== null && m > geoOn)));
		const worksH = running.length * L.jobs.v * 140;
		let pool = Math.max(0, human - worksH) + people * o.avenH;
		const poolStart = pool;
		const lifts = { mobile: mobiles * LIFTS_MONTH, handler: handlers * LIFTS_MONTH };
		const liftsStart = { ...lifts };
		for (const sl of slots) {
			sl.left = LIFTS_MONTH;
			sl.used = 0;
		}
		// steps waiting for a tower crane this month: a crane freed later in the month waits for them, not for a step behind
		const waiting = new Set();
		// materials wanted this month, for the works to cover
		const want = [];
		const work = (s) => {
			// a step works through its phases with what is left of the pool and the lifts
			let guard = 0;
			const cap = s.maxCrew * L.fte.v;
			let capLeft = cap;
			while (s.phase < s.phases.length && guard++ < 8) {
				const p = s.phases[s.phase];
				let dp = 1 - s.pDone;
				if (p.fixed) dp = Math.min(dp, 1 / p.fixed);
				const eff = (p.outdoor && winter ? L.winter.v : 1) * (p.planting && !planting ? 0 : 1);
				if (p.h > 0) dp = eff > 0 ? Math.min(dp, (Math.min(pool, capLeft) * eff) / p.h) : 0;
				const liftNeed = p.lifts > 0 && p.pool ? p.lifts + (p.set ?? 0) * RATES.liftsPerDay.v : 0;
				const weather = p.outdoor && winter ? L.winter.v : 1;
				let slot = null;
				if (liftNeed && p.pool === 'tower') {
					// a tower crane of its own, held until its last pane is in
					slot = slots.find((x) => x.holder === s) ?? (waiting.size && !waiting.has(s) ? null : slots.find((x) => x.holder === null)) ?? null;
					if (!slot) {
						waiting.add(s);
						break;
					}
					waiting.delete(s);
					slot.holder = s;
					dp = Math.min(dp, (slot.left * weather) / liftNeed);
				} else if (liftNeed) dp = Math.min(dp, (lifts[p.pool] * weather) / liftNeed);
				if (dp <= 1e-9) break;
				const h = p.h > 0 ? (dp * p.h) / eff : 0;
				pool -= h;
				capLeft -= h;
				s.used.h += h;
				s.done += dp * p.h;
				if (liftNeed) {
					const l = (dp * liftNeed) / weather;
					if (slot) {
						slot.left -= l;
						slot.used += l;
					} else lifts[p.pool] -= l;
					s.used[p.pool === 'handler' ? 'handler' : 'crane'] += l / RATES.liftsPerDay.v;
				}
				if (p.eur) want.push({ s, p, dp });
				s.pDone += dp;
				if (s.pDone >= 1 - 1e-9) {
					s.phase++;
					s.pDone = 0;
					// the last pane is in: the tower crane goes on to the next dome
					if (p.pool === 'tower' && s.phases[s.phase]?.pool !== 'tower') for (const x of slots) if (x.holder === s) x.holder = null;
				} else break;
			}
		};
		// first the steps under way, in priority order, then new ones
		for (const s of steps) if (s.state === 'run') work(s);
		for (const s of steps) {
			if (s.state !== 'wait') continue;
			if (s.gate && !s.gate(st)) continue;
			if (s.camp && s.hex !== LIVING_ORDER[0] && campAt === null) continue;
			// a dome starts only when its lifting will be free by the time its footing is in: no more big domes on the way
			// to their last pane than tower cranes and one, no more Dome40s than telehandlers and one
			const lifter = s.phases.find((p) => p.pool === 'tower' || (p.pool === 'handler' && p.id !== 'inside'))?.pool;
			if (lifter) {
				const busy = steps.filter((x) => x.state === 'run' && x.phases.some((p, k) => p.pool === lifter && p.id !== 'inside' && k >= x.phase)).length;
				if (busy >= (lifter === 'tower' ? towers : handlers) + 1) continue;
			}
			// it needs a quarter of its full crew for a month (or half of a small crew's month); when the hours are not there,
			// nothing further down the list starts either: the hours wait for the step that comes first
			const first = s.phases[0];
			const needs = first.h > 0 ? Math.min(first.h, s.maxCrew * L.fte.v * 0.25, poolStart * 0.5) : 0;
			if (pool < needs && !(first.fixed && pool > 0)) break;
			s.state = 'run';
			s.start = m;
			if (s.land) {
				s.eur.land += s.land;
				eurM.land += s.land;
				hexM[s.hex] += s.land;
			}
			if (s.services && s.kind === 'design') {
				s.eur.services += s.services;
				eurM.services += s.services;
				hexM[s.hex] += s.services;
			}
			if (s.prefabEur) {
				// prefabricated parts, bought on top of the materials
				s.eur.prefab += s.prefabEur;
				s.eur.materials += s.prefabEur;
				eurM.materials += s.prefabEur;
				hexM[s.hex] += s.prefabEur;
			}
			if (s.camp) campAt = s.hex;
			work(s);
		}
		// the works cover what they can of the steel, glazing and timber wanted
		const supply = {};
		for (const id of running) {
			const age = m - works[id];
			supply[id] = Math.min(1, age / WORKS_RAMP);
		}
		const demand = { steelT: 0, glassM2: 0, timberM3: 0 };
		for (const { p, dp } of want) if (p.own) for (const k of Object.keys(demand)) demand[k] += (p.own[k] ?? 0) * dp;
		const cover = {
			steelT: supply.steel ? Math.min(1, (WORKS_OUT.steel.t * supply.steel) / Math.max(1e-9, demand.steelT)) : 0,
			glassM2: supply.glass ? Math.min(1, (WORKS_OUT.glass.m2 * supply.glass) / Math.max(1e-9, demand.glassM2)) : 0,
			timberM3: supply.timber ? Math.min(1, (WORKS_OUT.timber.t / DENSITY.glulam) * supply.timber / Math.max(1e-9, demand.timberM3)) : 0
		};
		for (const { s, p, dp } of want) {
			const fin = (p.eur ?? 0) * dp;
			let saved = 0;
			if (p.own) {
				const ow = p.own;
				if (ow.steelT) saved += cover.steelT * ow.steelT * dp * (PRICES.hubs.eur - OWN.steelT);
				if (ow.glassM2) saved += cover.glassM2 * dp * (ow.glassM2 * (PRICES.glass.eur - OWN.glassM2) + (ow.pvM2 ?? 0) * (PRICES.pv.eur - OWN.pvM2));
				if (ow.timberM3) saved += cover.timberM3 * dp * Math.max(0, ow.timberEur - ow.timberM3 * OWN.timberM3);
			}
			if (!o.ownWorks) saved = 0;
			s.eur.materialsFinished += fin;
			s.eur.worksSaved += saved;
			s.eur.materials += fin - saved;
			eurM.materials += fin - saved;
			hexM[s.hex] += fin - saved;
			for (const [k, v] of Object.entries(p.t ?? {})) s.t[k] = (s.t[k] ?? 0) + v * dp;
			s.pvM2 += (p.pvM2 ?? 0) * dp;
		}
		// running the kit, shared by the settlements by the hours they took
		const usedH = poolStart - pool;
		if (end === null) {
			eurM.running += runEurMonth;
			const byHex = {};
			for (const s of steps) if (s.state === 'run' || s.end === m) byHex[s.hex] = (byHex[s.hex] ?? 0) + 1;
			const tot = Object.values(byHex).reduce((a, b) => a + b, 0) || 1;
			for (const [k, n] of Object.entries(byHex)) hexM[k] += (runEurMonth * n) / tot;
			if (!Object.keys(byHex).length) hexM[campAt ?? LIVING_ORDER[0]] += runEurMonth;
		}
		// steps that finished: their machines, checks, services, beds
		let newBeds = 0;
		for (const s of steps) {
			if (s.state === 'run') s.prog.push(s.H > 0 ? s.done / s.H : s.phase / s.phases.length);
			if (s.state === 'run' && s.phase >= s.phases.length) {
				s.state = 'done';
				s.end = m;
				s.prog[s.prog.length - 1] = 1;
				const svc = (s.check ?? 0) + (s.kind === 'geothermal' ? s.services + (s.grid ?? 0) : 0) + (s.kind === 'tower' ? s.services ?? 0 : 0);
				if (s.kind === 'geothermal') geoOn = m;
				s.eur.machines += s.machines ?? 0;
				s.eur.services += svc;
				eurM.machines += s.machines ?? 0;
				eurM.services += svc;
				hexM[s.hex] += (s.machines ?? 0) + svc;
				if (s.kind === 'factory120') works[s.factory] = m;
				if (s.camp && s.hex === LIVING_ORDER[0]) {
					campOn = true;
					newBeds += campBeds;
				}
				if (s.beds) {
					newBeds += s.beds;
					domeBeds += s.beds;
				}
			}
		}
		for (const k of hexes) if (!st.hexDone[k] && steps.filter((s) => s.hex === k && s.kind !== 'design').every((s) => s.state === 'done')) st.hexDone[k] = true;
		beds += newBeds;
		// the camp goes once every home stands
		const homesLeft = steps.some((s) => s.beds && s.state !== 'done');
		if (campOn && !homesLeft && campGone === null) {
			campGone = m;
			beds -= campBeds;
			campOn = false;
		}
		for (const k of KINDS_EUR) cum[k] += eurM[k];
		for (const k of hexes) hexCum[k] += hexM[k];
		const allDone = steps.every((s) => s.state === 'done');
		const building = steps.filter((s) => s.state === 'run' || (s.end === m && s.start !== m) || (s.start === m && s.end === m));
		const standing = steps.filter((s) => s.state === 'done' && s.phases.some((p) => p.id === 'shell')).length;
		const framing = steps.filter((s) => s.state === 'run' && s.phases.some((p) => p.id === 'shell')).length;
		months.push({
			m,
			year: Math.floor(m / 12) + 1,
			label: `${MONTHS[cal]} ${o.startYear + Math.floor((o.startMonth - 1 + m) / 12)}`,
			people,
			beds,
			domeBeds,
			campBeds: campOn ? campBeds : 0,
			camp: campOn || m === 0 ? campAt ?? LIVING_ORDER[0] : null,
			domes: standing,
			framing,
			building: building.map((s) => s.id),
			eur: eurM,
			cum: { ...cum },
			cumTotal: KINDS_EUR.reduce((a, k) => a + cum[k], 0),
			hexCum: { ...hexCum },
			hours: { pool: poolStart, used: usedH, avens: people * o.avenH, worksJobs: running.length * L.jobs.v },
			lifts: { crane: (slots.reduce((a, x) => a + x.used, 0) + liftsStart.mobile - lifts.mobile) / RATES.liftsPerDay.v, craneCap: cranes * 21, handler: (liftsStart.handler - lifts.handler) / RATES.liftsPerDay.v, handlerCap: handlers * 21 },
			works: running,
			geothermal: geoOn !== null && m >= geoOn,
			forestHa: steps.filter((s) => s.forestHa && s.state !== 'wait').reduce((a, s) => a + s.forestHa * Math.min(1, s.prog[s.prog.length - 1] ?? 0), 0),
			solarKwhYear: steps.filter((s) => s.state === 'done' && s.energy).reduce((a, s) => a + s.energy.solarKwhYear, 0) + (campOn ? kit.filter((k) => k.kwp).reduce((a, k) => a + k.n * k.kwp * 1000, 0) : 0)
		});
		// people come as beds are finished
		st.people = Math.max(o.settlers, Math.min(o.targetPeople, beds));
		if (peopleFull === null && st.people >= o.targetPeople) peopleFull = m + 1;
		if (allDone) {
			end = m;
			break;
		}
	}
	return { steps, months, end, peopleFull, geoOn, campGone, works, kitEur, runEurMonth, cranes, towers, handlers, campBeds };
}

// ── the plan ────────────────────────────────────────────────────────────────────────────────────────────────────

const DEFAULTS = { tower: false, settlers: 2, targetPeople: 1500, months: 72, startYear: 2027, startMonth: 3, ownWorks: true, maxMonths: 240 };
const cache = new Map();

/** a kit with some items changed: { id: n } */
const kitWith = (/** @type {Record<string, number>} */ ns) => KIT.map((k) => (ns[k.id] !== undefined ? { ...k, n: ns[k.id] } : k));

/** the camp's containers for `beds` beds: living containers of two, a sanitary container for ten, a kitchen for 25 */
const camp = (/** @type {number} */ beds) => {
	const live = Math.ceil(beds / 2), sanitary = Math.ceil(beds / 10), kitchen = Math.ceil(beds / 25);
	return { live, sanitary, kitchen, delivery: live + sanitary + kitchen + 5 };
};

/**
 * The kits tried in turn, cheapest first, until one builds the village in the months asked for: more tower cranes and
 * a bigger camp first (they cost little), then prefabrication and faster Avens (they cost much, or do not exist yet).
 * The work rates never change, only how many machines and beds there are to work with.
 */
export const KIT_LADDER = [
	{ id: 'starter', label: 'The starter kit: 2 tower cranes, a mobile crane, 2 telehandlers, a camp of 60 beds', short: 'Starter kit', kit: {} },
	{ id: 'c4b200', label: '4 tower cranes and a camp of 200 beds', short: '4 cranes, 200 beds', kit: { tower: 4, ...camp(200) } },
	{ id: 'c6b200', label: '6 tower cranes and a camp of 200 beds', short: '6 cranes, 200 beds', kit: { tower: 6, ...camp(200) } },
	{ id: 'c6b300', label: '6 tower cranes, 4 telehandlers and a camp of 300 beds', short: '6 cranes, 300 beds', kit: { tower: 6, handler: 4, ...camp(300) } },
	{ id: 'c6b300p', label: '6 tower cranes, 4 telehandlers, a camp of 300 beds and prefabricated shells and homes', short: '+ prefab', kit: { tower: 6, handler: 4, ...camp(300) }, prefab: true },
	{ id: 'c6b300pa', label: '6 tower cranes, 4 telehandlers, a camp of 300 beds, prefab and Avens at half a builder’s pace', short: '+ prefab, robots', kit: { tower: 6, handler: 4, ...camp(300) }, prefab: true, avenH: LABOUR.aven.v * 2.5 }
];

/**
 * The build-out plan.
 * @param {{ tower?: boolean, settlers?: number, targetPeople?: number, months?: number, startYear?: number, startMonth?: number, ownWorks?: boolean, kit?: 'auto' | string | Record<string, number>, avenH?: number, hoursFactor?: number, prefab?: boolean, maxMonths?: number, ladder?: boolean }} [opts]
 *   kit: 'auto' (the default) tries KIT_LADDER until the village stands within `months`; a rung's id (e.g. 'starter')
 *   takes that kit; an object sets how many of each kit item (by id). avenH: an Aven's crew-hour equivalents a month;
 *   prefab: shells lifted as glazed cassettes and homes from bought prefabricated elements; ladder: false skips
 *   working out the other rungs and the levers (faster)
 * @returns {any}
 */
export function buildPlan(opts = {}) {
	const key = 'plan' + JSON.stringify(opts);
	if (cache.has(key)) return cache.get(key);
	const { kit = 'auto', ladder: _l, ...rest } = opts;
	const months = rest.months ?? DEFAULTS.months;
	const rungOpts = (/** @type {any} */ g) => ({ ...rest, kit: g.kit, prefab: rest.prefab ?? g.prefab, avenH: rest.avenH ?? g.avenH });
	const tried = [];
	let chosen = null, rung = null;
	const row = (/** @type {any} */ g, /** @type {any} */ p) => ({ id: g.id, label: g.label, short: g.short, doneMonth: p.totals.doneMonth, peopleMonth: p.totals.peopleMonth, total: p.totals.total, kitEur: p.kit.eur, makes: p.totals.doneMonth !== null && p.totals.doneMonth <= months });
	if (kit === 'auto') {
		// cheapest first: the first rung that makes it, or the last one
		for (const g of KIT_LADDER) {
			const p = planFor(rungOpts(g));
			tried.push(row(g, p));
			chosen = p;
			rung = g;
			if (tried[tried.length - 1].makes) break;
		}
	} else if (typeof kit === 'string') {
		rung = KIT_LADDER.find((g) => g.id === kit);
		if (!rung) throw new Error(`buildPlan: no kit '${kit}' (try ${KIT_LADDER.map((g) => g.id).join(', ')})`);
		chosen = planFor(rungOpts(rung));
	} else {
		chosen = planFor({ ...rest, kit });
		rung = { id: 'custom', label: 'A kit of your own', short: 'Own kit', kit };
	}
	if (opts.ladder !== false) {
		// the whole ladder, for the page: what each rung would take
		for (const g of KIT_LADDER) if (!tried.some((t) => t.id === g.id)) tried.push(row(g, planFor(rungOpts(g))));
		tried.sort((a, b) => KIT_LADDER.findIndex((g) => g.id === a.id) - KIT_LADDER.findIndex((g) => g.id === b.id));
	}
	const starter = planFor(rungOpts(KIT_LADDER[0]));
	const base = { ...rest };
	const lever = (/** @type {string} */ label, /** @type {string} */ change, /** @type {any} */ more) => {
		const p = planFor({ ...base, ...more });
		return { label, change, doneMonth: p.totals.doneMonth, peopleMonth: p.totals.peopleMonth, total: p.totals.total, extraEur: p.totals.total - starter.totals.total, kitEur: p.kit.eur - starter.kit.eur };
	};
	const levers = opts.ladder === false ? [] : [
		lever('Two more tower cranes', '4 tower cranes instead of 2 (used, ~375,000 € each)', { kit: { tower: 4 } }),
		lever('Four more tower cranes', '6 tower cranes instead of 2', { kit: { tower: 6 } }),
		lever('A camp of 200 beds', '100 living containers instead of 30, with their washrooms and kitchens', { kit: camp(200) }),
		lever('Prefabricated shells and homes', 'glazed strut triangles lifted as one; homes from bought CLT elements and bath pods', { prefab: true }),
		lever('Avens that build at half a builder’s pace', `${LABOUR.aven.v * 2.5} crew-hours a month from each Aven instead of ${LABOUR.aven.v}`, { avenH: LABOUR.aven.v * 2.5 })
	];
	const p = chosen;
	const yrs = (/** @type {number | null} */ m) => (m === null ? 'never' : `month ${m} (${(m / 12).toFixed(1)} years, ${p.months[Math.min(m, p.months.length - 1)]?.label ?? ''})`);
	const syrs = (/** @type {number | null} */ m) => (m === null ? 'never' : `month ${m} (${(m / 12).toFixed(1)} years, ${starter.months[Math.min(m, starter.months.length - 1)]?.label ?? ''})`);
	const done = p.totals.doneMonth, sDone = starter.totals.doneMonth;
	const feasible = done !== null && done <= months;
	const starterOk = sDone !== null && sDone <= months;
	const at = (/** @type {any} */ q, /** @type {number} */ m) => q.months[Math.min(m, q.months.length - 1)];
	const n = (/** @type {number} */ x) => x.toLocaleString('en-US');
	const M = (/** @type {number} */ e) => `${(e / 1e6).toFixed(1)} M€`;
	let statement;
	if (starterOk) statement = `Yes: with the starter kit the village stands in ${syrs(sDone)}, within the ${months} months; all ${n(p.options.targetPeople)} people live there from month ${starter.totals.peopleMonth}.`;
	else if (feasible) statement = `Not with the starter kit: at these rates it builds the whole village by ${syrs(sDone)}; at month ${months} it has ${n(at(starter, months).people)} people and ${at(starter, months).domes} of ${starter.totals.domes} domes. Six years takes ${rung.label.replace(/^The /, 'the ')} (${M(p.kit.eur)} of kit instead of ${M(starter.kit.eur)}): then the village stands in ${yrs(done)} and all ${n(p.options.targetPeople)} people live there from month ${p.totals.peopleMonth}. The work rates are the same; only the cranes and the camp’s beds change.`;
	else statement = `No: at these rates even ${rung.label.replace(/^The /, 'the ')} builds the village by ${yrs(done)}, not month ${months}; the starter kit takes until ${syrs(sDone)}.`;
	const feasibility = {
		target: months,
		feasible,
		doneMonth: done,
		peopleMonth: p.totals.peopleMonth,
		atTarget: { people: at(p, months).people, beds: at(p, months).beds, domes: at(p, months).domes, of: p.totals.domes },
		kit: { id: rung.id, label: rung.label, short: rung.short },
		starter: { doneMonth: sDone, peopleMonth: starter.totals.peopleMonth, atTarget: { people: at(starter, months).people, domes: at(starter, months).domes }, total: starter.totals.total, kitEur: starter.kit.eur, feasible: starterOk },
		ladder: tried,
		levers,
		statement,
		binds: p.binds
	};
	const out = { ...p, feasibility, kitChoice: rung.id };
	cache.set(key, out);
	return out;
}

/** one plan for one kit (cached) @param {any} opts */
function planFor(opts = {}) {
	const key = JSON.stringify(opts);
	if (cache.has(key)) return cache.get(key);
	const o = {
		...DEFAULTS,
		...opts,
		kit: kitWith(opts.kit ?? {}),
		labour: LABOUR,
		avenH: opts.avenH ?? LABOUR.aven.v,
		hoursFactor: opts.hoursFactor ?? 1,
		prefab: opts.prefab ? PREFAB : null
	};
	const r = schedule(o);
	const { steps, months } = r;
	const doneMonth = r.end;
	const last = months[months.length - 1];

	// the steps as the page and the engine read them
	const outSteps = steps.map((s) => {
		const crew = s.end !== undefined ? s.used.h / LABOUR.fte.v / Math.max(1, s.end - s.start + 1) : 0;
		const eur = { ...s.eur, total: s.eur.materials + s.eur.machines + s.eur.services + s.eur.land };
		let acc = 0;
		const phases = s.phases.map((p) => {
			acc += p.h;
			return { id: p.id, label: p.label ?? p.id, to: s.H > 0 ? acc / s.H : 1 };
		});
		return {
			id: s.id,
			hex: s.hex,
			hexLabel: HEX_LABEL[s.hex],
			coop: coopOf(s.hex),
			site: s.site,
			kind: s.kind,
			factory: s.factory,
			label: s.label,
			start: s.start ?? null,
			end: s.end ?? null,
			months: s.end !== undefined ? s.end - s.start + 1 : null,
			crew: Math.round(crew * 10) / 10,
			crewMax: s.maxCrew,
			hours: Math.round(s.used.h),
			craneDays: Math.round(s.used.crane * 10) / 10,
			handlerDays: Math.round(s.used.handler * 10) / 10,
			t: Object.fromEntries(Object.entries(s.t).map(([k, v]) => [k, Math.round(v * 10) / 10])),
			pvM2: Math.round(s.pvM2),
			eur: Object.fromEntries(Object.entries(eur).map(([k, v]) => [k, Math.round(v)])),
			beds: s.beds ?? 0,
			energy: s.energy ?? null,
			forestHa: s.forestHa ?? 0,
			phases,
			prog: s.prog.map((p) => Math.round(p * 1000) / 1000)
		};
	});

	// totals
	const eur = { ...last.cum };
	const total = last.cumTotal;
	const byYear = [];
	for (const mo of months) {
		const y = byYear[mo.year - 1] ?? (byYear[mo.year - 1] = { year: mo.year, ...Object.fromEntries(KINDS_EUR.map((k) => [k, 0])), total: 0 });
		for (const k of KINDS_EUR) {
			y[k] += mo.eur[k];
			y.total += mo.eur[k];
		}
	}
	const sumT = (k) => outSteps.reduce((a, s) => a + (s.t[k] ?? 0), 0);
	const settlements = [...LIVING_ORDER, 'tower'].map((key) => {
		const own = outSteps.filter((s) => s.hex === key && s.kind !== 'design');
		const by = Object.fromEntries(['materials', 'machines', 'services', 'land'].map((k) => [k, own.reduce((a, s) => a + s.eur[k], 0)]));
		const first = key === LIVING_ORDER[0];
		const kitE = first ? r.kitEur : 0;
		const design = first ? outSteps.find((s) => s.kind === 'design')?.eur.services ?? 0 : 0;
		const runE = last.hexCum[key] - kitE - design - Object.values(by).reduce((a, b) => a + b, 0);
		const founded = Math.min(...own.map((s) => s.start ?? Infinity));
		return {
			key,
			label: HEX_LABEL[key],
			coop: coopOf(key),
			founded: Number.isFinite(founded) ? founded : null,
			done: Math.max(...own.map((s) => s.end ?? -1)),
			beds: own.reduce((a, s) => a + s.beds, 0),
			domes: own.filter((s) => s.phases.some((p) => p.id === 'shell')).length,
			eur: { kit: kitE, running: Math.max(0, runE), materials: by.materials, machines: by.machines, services: by.services + design, land: by.land, total: last.hexCum[key] }
		};
	});
	const totals = {
		eur,
		total,
		byYear,
		doneMonth,
		peopleMonth: r.peopleFull,
		geothermalMonth: r.geoOn,
		campGone: r.campGone,
		hours: outSteps.reduce((a, s) => a + s.hours, 0),
		craneDays: outSteps.reduce((a, s) => a + s.craneDays, 0),
		handlerDays: outSteps.reduce((a, s) => a + s.handlerDays, 0),
		worksSaved: outSteps.reduce((a, s) => a + s.eur.worksSaved, 0),
		materialsFinished: outSteps.reduce((a, s) => a + s.eur.materialsFinished, 0),
		t: { glulam: sumT('glulam'), steel: sumT('steel'), glass: sumT('glass'), hemp: sumT('hemp'), lime: sumT('lime'), concrete: sumT('concrete'), gravel: sumT('gravel') },
		pvM2: outSteps.reduce((a, s) => a + s.pvM2, 0),
		beds: outSteps.reduce((a, s) => a + s.beds, 0),
		domes: outSteps.filter((s) => s.phases.some((p) => p.id === 'shell')).length,
		perPerson: total / o.targetPeople
	};

	// what held the build back: the months the crew's hours ran out, and the months the tower cranes were all busy
	const binds = { hours: months.filter((x) => x.hours.used >= x.hours.pool * 0.98).length, cranes: months.filter((x) => x.lifts.crane >= x.lifts.craneCap * 0.66).length, months: months.length };

	const plan = {
		options: { tower: o.tower, settlers: o.settlers, targetPeople: o.targetPeople, months: o.months, startYear: o.startYear, startMonth: o.startMonth, ownWorks: o.ownWorks, avenH: o.avenH, prefab: !!o.prefab, kit: opts.kit ?? {} },
		kit: {
			items: o.kit.map((k) => ({ ...k, total: k.n * k.eur })),
			eur: r.kitEur,
			byGroup: Object.fromEntries(Object.keys(KIT_GROUPS).map((g) => [g, o.kit.filter((k) => k.group === g).reduce((a, k) => a + k.n * k.eur, 0)])),
			running: { eurYear: r.runEurMonth * 12, share: RUNNING_SHARE, note: 'fuel, upkeep, insurance and tyres: 15 % of the machines’ and the power kit’s price a year (estimate)' },
			cranes: r.cranes,
			towers: r.towers,
			handlers: r.handlers,
			campBeds: r.campBeds
		},
		steps: outSteps,
		months,
		totals,
		settlements,
		binds,
		rates: RATES,
		labour: { ...LABOUR, aven: { ...LABOUR.aven, v: o.avenH } },
		own: OWN,
		sources: BUILD_SOURCES
	};
	cache.set(key, plan);
	return plan;
}

/** what prefabrication changes: on-site hours and lifts down, bought elements up (estimates) */
const PREFAB = {
	/** a glazed strut triangle lifted as one: frame and shell hours × 0.6, lifts × 0.5 */
	shellHours: 0.6,
	lifts: 0.5,
	/** the shell's parts pre-assembled by the supplier: +15 % on them */
	shellEur: 0.15,
	/** homes from CLT wall and floor elements and bath pods: 10 crew-hours a m² instead of 18, +350 €/m² */
	homeHours: 10 / 18,
	homeEurM2: 350
};

// ── reading the plan at a moment ────────────────────────────────────────────────────────────────────────────────

/**
 * Where every dome stands at month `t` (a fraction runs between the ends of two months): its phase and progress.
 * Keys are `${hex}/${site}` with the layout's hex keys and site ids (the centre's middle is `tower/centre`).
 * @returns {Map<string, { phase: string, p: number, kind: string, step: any }>}
 */
export function sitesAt(plan, t) {
	const out = new Map();
	for (const s of plan.steps) {
		if (!s.phases.some((p) => p.id === 'shell')) continue;
		out.set(s.id, { ...phaseAt(s, t), kind: s.kind, step: s });
	}
	return out;
}

/** a step's progress at month t (0 before it starts, 1 once it is done), and the phase that progress is in */
export function phaseAt(s, t) {
	if (s.start === null || t < s.start) return { phase: 'none', p: 0 };
	const k = t - s.start;
	const i = Math.floor(k);
	const before = i <= 0 ? 0 : s.prog[Math.min(i - 1, s.prog.length - 1)] ?? 1;
	const after = s.prog[Math.min(i, s.prog.length - 1)] ?? 1;
	const p = s.end !== null && t >= s.end + 1 ? 1 : before + (after - before) * Math.min(1, k - i);
	if (p >= 1) return { phase: 'done', p: 1 };
	// the progress is kept to three decimals: a phase ends within half a thousandth of its mark
	const ph = s.phases.find((x) => p < x.to - 6e-4) ?? s.phases[s.phases.length - 1];
	return { phase: ph.id, p };
}

/** the month's record at month t (rounded down) */
export const monthAt = (plan, t) => plan.months[Math.max(0, Math.min(plan.months.length - 1, Math.floor(t)))];

/** a short line naming what is being built at month t */
export function nowLine(plan, t) {
	const mo = monthAt(plan, t);
	if (plan.totals.doneMonth !== null && t >= plan.totals.doneMonth + 1) return 'The village stands: every dome is built and lived in.';
	const live = plan.steps.filter((s) => mo.building.includes(s.id));
	if (!live.length) return mo.m >= (plan.totals.doneMonth ?? Infinity) ? 'The village stands: every dome is built and lived in.' : 'Waiting for the planting season and the next crews.';
	const word = (s) => {
		const ph = phaseAt(s, mo.m + 0.5);
		const where = s.hex === 'tower' ? 'Centre' : SHORT(s.hex);
		const what = s.kind === 'dome40' || s.kind === 'dome80' ? `${s.kind === 'dome40' ? 'Dome40' : 'Dome80'} home ${Number(s.site.split('-')[1]) + 1}` : s.kind === 'food120' ? `food dome ${s.site === 'foodW' ? 'west' : 'east'}` : s.kind === 'util120' ? 'utilities dome' : s.kind === 'centre' ? 'centre dome' : s.kind === 'factory120' ? s.label.toLowerCase() : s.kind === 'camp' ? (s.label === 'The starter camp' ? 'the starter camp' : 'moving the camp') : s.kind === 'forest' ? 'planting the food forest' : s.kind === 'fields' ? 'planting the woods' : s.kind === 'roads' ? 'roads and lines' : s.kind === 'geothermal' ? 'drilling the geothermal wells' : s.kind === 'tower' ? 'Tower180' : s.label;
		const phase = s.phases.find((p) => p.id === ph.phase)?.label;
		return `${where}: ${what}${phase && s.phases.length > 1 && ph.phase !== 'done' ? ` (${phase})` : ''}`;
	};
	const show = live.filter((s) => s.kind !== 'land' && s.kind !== 'design');
	const head = show.slice(0, 3).map(word).join(' · ');
	return show.length > 3 ? `${head} · and ${show.length - 3} more` : head || 'Buying the land and the kit.';
}
