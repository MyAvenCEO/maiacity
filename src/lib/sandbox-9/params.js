// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · EVERY PARAMETER OF A RUN, IN PLAIN WORDS — labels, units and groups for the settings a world ran with
 * (./genesis.js DEFAULTS merged with the run's overrides) and the catalog constants it was built from (`w.c`, read
 * from ./primitives.js and the village modules). The page's World tab (./WorldParams.svelte) shows them side by side
 * for the two worlds of an experiment, or for the base world on the Proof tab.
 *
 * Only words and formats live here: no number of the world is set or copied in this file. A key the engine adds that
 * is not listed below still shows, under "Other", with its own name and a plain format, so the tab never hides a
 * parameter.
 */

/** the groups, in the order the tab shows them */
export const GROUPS = [
	{ id: 'people', label: 'People and land' },
	{ id: 'village', label: 'The village and its buildings' },
	{ id: 'founding', label: 'The founding (day 0)' },
	{ id: 'food', label: 'Food' },
	{ id: 'water', label: 'Water' },
	{ id: 'energy', label: 'Energy' },
	{ id: 'materials', label: 'Materials and works' },
	{ id: 'economy', label: 'Economy rules' },
	{ id: 'coops', label: 'COOPs and prices' },
	{ id: 'avens', label: 'Avens and spending' },
	{ id: 'rd', label: 'Innovation (R&D)' },
	{ id: 'border', label: 'The euro border' },
	{ id: 'shocks', label: 'Weather and shocks' },
	{ id: 'run', label: 'The run' },
	{ id: 'other', label: 'Other' }
];

// ── formats ──────────────────────────────────────────────────────────────────────────────────────────────────────
const GOOD_NAMES = ['food', 'water', 'energy', 'bed', 'glulam', 'steel', 'glass', 'solar panels', 'goods', 'warm ponds', 'Aven services'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** a number in plain form: thousands apart, at most three significant digits below 1,000 */
export function num(x, digits = 3) {
	if (typeof x !== 'number') return String(x);
	if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : '–';
	if (x === 0) return '0';
	const a = Math.abs(x);
	if (a >= 1e9) return `${trim((x / 1e9).toPrecision(3))} bn`;
	if (a >= 1e6) return `${trim((x / 1e6).toPrecision(3))} M`;
	if (a >= 1000) return Math.round(x).toLocaleString('en-GB');
	if (a >= 1e-4) return trim(x.toPrecision(digits));
	return x.toExponential(1);
}
const trim = (s) => (s.includes('e') ? s : s.includes('.') ? s.replace(/\.?0+$/, '') : s);
const pct = (x) => (typeof x === 'number' ? `${trim((x * 100).toPrecision(3))} %` : String(x));
const onOff = (x) => (x ? 'on' : 'off');
const yesNo = (x) => (x ? 'yes' : 'no');
/** a list of 12 monthly numbers as "Jan 2.6 · Feb 2.7 · …" */
const months = (a, f = num) => (Array.isArray(a) && a.length === 12 ? a.map((v, i) => `${MONTHS[i]} ${f(v)}`).join(' · ') : plain(a));
/** an object or list keyed by good index (or good id) as "food 1.41 · water 100 · …" */
const byGood = (o, f = num, units = []) => {
	const u = (i) => (units[i] ? ` ${units[i]}` : '');
	if (Array.isArray(o)) return o.map((v, i) => `${GOOD_NAMES[i] ?? i} ${f(v)}${u(i)}`).join(' · ');
	if (o && typeof o === 'object') return Object.entries(o).map(([k, v]) => `${GOOD_NAMES[+k] ?? k} ${typeof v === 'number' ? f(v) : plain(v)}${Number.isInteger(+k) ? u(+k) : ''}`).join(' · ');
	return plain(o);
};
/** what a shock is, in a few words */
const SHOCK = {
	drought: (s) => `drought: rain ${s.factor != null ? `× ${num(s.factor)}` : 'down'} for ${s.days ?? '?'} days`,
	darkWinter: (s) => `dark winter: sun ${s.factor != null ? `× ${num(s.factor)}` : 'down'} for ${s.days ?? '?'} days`,
	coopFail: (s) => `${s.coop ?? 'a COOP'} fails (output × ${num(s.factor ?? 0)}) for ${s.days ?? 365} days`,
	wellFail: (s) => `geothermal well down for ${s.days ?? '?'} days`,
	germany: () => 'holdings made as unequal as Germany’s',
	ring: (s) => `a founder ring of ${s.size ?? 4} for ${s.days ?? '?'} days`
};
const shocks = (list) =>
	Array.isArray(list) && list.length
		? list.map((s) => `${(SHOCK[s.kind] ?? ((x) => x.kind))(s)} from day ${s.day ?? 0} (year ${Math.floor((s.day ?? 0) / 365) + 1})`).join('; ')
		: 'none';

/** any value in plain words: numbers, lists, small objects, catalog records { v, u } */
export function plain(v) {
	if (v === null || v === undefined) return '–';
	if (typeof v === 'boolean') return onOff(v);
	if (typeof v === 'number') return num(v);
	if (typeof v === 'string') return v;
	if (Array.isArray(v)) {
		if (v.length === 12 && v.every((x) => typeof x === 'number')) return months(v);
		if (v.every((x) => typeof x !== 'object' || x === null)) return v.map(plain).join(' · ');
		return v.map(plain).join('; ');
	}
	if (typeof v === 'object') {
		if ('v' in v && ('u' in v || 'src' in v)) {
			if (v.v && typeof v.v === 'object' && !Array.isArray(v.v)) return withUnit(v.v, v.u);
			if (typeof v.v === 'boolean') return yesNo(v.v);
			if (v.u === '€' && typeof v.v === 'number') return `€${plain(v.v)}`;
			return `${plain(v.v)}${v.u ? ` ${v.u}` : ''}`;
		}
		if ('kind' in v && SHOCK[v.kind]) return shocks([v]);
		const e = Object.entries(v);
		if (!e.length) return 'none';
		return e.map(([k, x]) => `${words(k)} ${plain(x)}`).join(' · ');
	}
	return String(v);
}
/** an object of numbers with one unit: "glulam 1,200 t · steel 300 t", nested as "timber: glulam 80 t, steel 40 t" */
function withUnit(o, u) {
	return Object.entries(o)
		.map(([k, x]) => (x && typeof x === 'object' ? `${k}: ${Object.entries(x).map(([k2, y]) => `${k2} ${plain(y)}${u ? ` ${u}` : ''}`).join(', ')}` : `${k} ${plain(x)}${u ? ` ${u}` : ''}`))
		.join(' · ');
}
/** a key in words: camelCase and snake_case split, the first letter capital */
export function words(key) {
	const s = String(key)
		.replace(/_/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.toLowerCase();
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── the settings (./genesis.js DEFAULTS) ─────────────────────────────────────────────────────────────────────────
/** g: group · label · unit (after the number) · f: a format of its own · hide: never shown (only names a world) */
export const SETTINGS = {
	people: { g: 'people', label: 'People', unit: 'people', f: (v) => num(v) },
	fieldPeople: { g: 'people', label: 'People the village is built for', f: (v) => (v == null ? '250 a living hex' : `${num(v)} people`) },
	popGrowth: { g: 'people', label: 'Population growth', f: (v) => (v ? `${pct(v)} a year` : 'none (held constant)') },
	ownerOnlyShare: { g: 'people', label: 'Owner-only people (their Aven delivers nothing, they start with nothing)', f: pct },
	landHa: { g: 'people', label: 'Land', f: (v) => (v == null ? 'the village’s seven hexes' : `${num(v)} ha`) },
	springSites: { g: 'people', label: 'Warm-pond sites a living hex (fixed by nature)', unit: 'sites' },
	livingHexes: { g: 'village', label: 'Living hexes round the centre hex', unit: 'hexes' },
	peoplePerHex: { g: 'village', label: 'People a living hex', unit: 'people', f: (v) => num(v) },
	beds: { g: 'village', label: 'Beds', unit: 'beds' },
	tower: { g: 'village', label: 'The Tower180 in the centre hex', f: (v) => (v ? 'yes, at its real cost' : 'no: one more Dome120 of utilities and halls') },
	led: { g: 'food', label: 'LED light in the food domes in the dark months', f: onOff },
	reserveYears: { g: 'border', label: 'Euros left in the reserve at the founding', f: (v) => (v == null ? 'the catalog’s (see the border constants)' : `${num(v)} years of the village’s food at wholesale`) },
	exportEurMwh: { g: 'border', label: 'Exported electricity sells at', f: (v) => (v == null ? 'the catalog’s price (see below)' : `€${num(v)} a MWh`) },
	importPrice: { g: 'border', label: 'Import prices, times the catalog’s', f: (v) => `× ${num(v)}` },
	weather: { g: 'shocks', label: 'Weather drawn from the seed each month', f: (v) => (v ? 'yes, around the monthly normals' : 'no, the normals every year') },
	shocks: { g: 'shocks', label: 'Scheduled shocks', f: shocks },
	forestYield: { g: 'food', label: 'Food forest yield, times the research figure', f: (v) => `× ${num(v)}` },
	foodSplit: { g: 'coops', label: 'Share of the food forest the second food COOP holds', f: pct },
	geothermal: { g: 'energy', label: 'Geothermal plant', f: onOff },
	geoStages: { g: 'energy', label: 'Geothermal stages built', f: (v) => `${num(v)} stage${v === 1 ? '' : 's'}` },
	chipImport: { g: 'border', label: 'Accelerators bought through the euro border', f: (v) => (v === false ? 'no: the city is closed' : 'yes, by the COMPUTE COOPs from the reserve') },
	law5: { g: 'economy', label: 'Law 5: share of every sale paid at once to the holders', f: pct },
	melt: { g: 'economy', label: 'Melt of HEARTS and MINDs', f: (v) => `${pct(v)} a year` },
	heartsPerDay: { g: 'economy', label: 'HEARTS a person a day', unit: 'HEARTS' },
	rateIndexed: { g: 'economy', label: 'Aven rate card and ground rent follow the HEARTS a day', f: yesNo },
	basicRation: { g: 'economy', label: 'A short basic is shared', f: (v) => (v === 'equal' ? 'equally: everyone’s need first' : v === 'proportion' ? 'in proportion to the orders' : plain(v)) },
	landRule: { g: 'economy', label: 'Land', f: (v) => (v === 'private' ? 'owned by people, rent paid to them' : 'the City COOP’s, leased for ground rent') },
	bootstrap: { g: 'economy', label: 'Day-0 bootstrap: the first HEARTS go to the COOPs a person will buy from', f: onOff },
	rIndex: { g: 'economy', label: 'The unit R', f: (v) => (v === 'basket' ? 'the paper’s basket of MINDs' : 'what one HEART’s MIND is worth') },
	coopsPerGood: { g: 'coops', label: 'COOPs selling each good at the founding', unit: 'a good' },
	coopsOf: { g: 'coops', label: 'Exceptions to that', f: (v) => (v ? Object.entries(v).map(([g, n]) => `${n} ${g} COOP${n > 1 ? 's' : ''}`).join(', ') : 'none') },
	priceRule: { g: 'coops', label: 'How COOPs set prices', f: (v) => ({ forward: 'forward margin', mark0: 'cost with no margin', primer: 'Primer’s adaptive price' })[v] ?? plain(v) },
	payout: { g: 'coops', label: 'Treasuries pay their surplus out for work proposals', f: yesNo },
	reserveDays: { g: 'coops', label: 'Reserve a treasury keeps', unit: 'days of running costs' },
	payoutRate: { g: 'coops', label: 'Share of a week’s surplus paid out each week', f: pct },
	auditExit: { g: 'coops', label: 'Receivership after a failed output audit', f: yesNo },
	allocBy: { g: 'avens', label: 'Avens send HEARTS between sellers by', f: (v) => (v === 'price' ? 'the MIND’s pool price' : 'delivered output per HEART') },
	avenSpread: { g: 'avens', label: 'Spread of Aven output (lognormal σ)' },
	spendRate: { g: 'avens', label: 'Share of the holding above its resting level spent a day', f: (v) => (v > 0 && v < 1 ? `1/${num(1 / v)}` : num(v)) },
	keep: { g: 'avens', label: 'Share of the HEARTS half an Aven keeps as ownership', f: pct },
	ownerKeep: { g: 'avens', label: 'Share an owner-only person’s Aven keeps', f: pct },
	keepOther: { g: 'avens', label: 'Share of dividends and Aven pay kept', f: pct },
	inflowDays: { g: 'avens', label: 'An Aven budgets on the mean inflow of', unit: 'days' },
	logitBeta: { g: 'avens', label: 'How sharply buyers choose the cheaper seller (logit β)' },
	extrasSigma: { g: 'avens', label: 'How easily extras replace each other (CES σ)' },
	ownerSpend: { g: 'avens', label: 'Owner-only people spend', f: (v) => (v === 'dividends' ? 'their dividends only' : 'dividends and some of what they hold') },
	rd: { g: 'rd', label: 'R&D from surplus energy', f: onOff },
	rdAsks: { g: 'rd', label: 'What R&D asks for counts as demand', f: yesNo },
	rdShare: { g: 'rd', label: 'Share of a payout that goes to R&D', f: pct },
	seed: { g: 'run', label: 'Seed (weather, people, Avens)', f: (v) => String(v) },
	maxYears: { g: 'run', label: 'Years the world is sized for', unit: 'years' },
	dailySlow: { g: 'run', label: 'Slow loop every day (else weekly after year 1)', f: yesNo },
	testMode: { g: 'run', label: 'Ledger leaks recorded instead of stopping', f: yesNo },
	label: { hide: true }
};

// ── the catalog constants (w.c, from ./primitives.js) ────────────────────────────────────────────────────────────
export const CATALOG = {
	scale: { g: 'run', label: 'People ÷ 250 (the old one-hex field)', f: (v) => `× ${num(v)}` },
	vf: { g: 'village', label: 'Village built, times the plan (people it is built for ÷ 250 a living hex)', f: (v) => `× ${num(v)}` },
	kcalNeed: { g: 'people', label: 'Food a person needs a day', unit: 'kcal' },
	proteinNeed: { g: 'people', label: 'Protein a person needs a day', unit: 'g' },
	waterNeedL: { g: 'people', label: 'Fresh water a person needs a day', unit: 'L' },
	homeKwhNeed: { g: 'people', label: 'Electricity a person needs at home a day', unit: 'kWh' },
	need: { g: 'people', label: 'The basic bundle a day (food in units of 1,000 kcal)', f: (v) => (Array.isArray(v) ? `food ${num(v[0])} · water ${num(v[1])} L · electricity ${num(v[2])} kWh · ${num(v[3])} bed` : plain(v)) },
	sat: { g: 'people', label: 'The most a person uses a day (satiation)', f: (o) => byGood(o, num, ['thousand kcal', 'L', 'kWh', 'bed', 't', 't', 't', 'kWp', 'kg', 'h', 'h']) },
	foodKcalUnit: { g: 'food', label: 'One unit of food', unit: 'kcal of the village diet' },
	homeM2PerBed: { g: 'village', label: 'Home a bed (gross floor)', unit: 'm²' },
	beds: { g: 'village', label: 'Beds', unit: 'beds' },
	bedsHome: { g: 'village', label: 'Beds in the home domes', unit: 'beds' },
	landM2: { g: 'people', label: 'The village’s land', f: (v) => `${num(v / 1e4)} ha` },
	domeKwhYear: { g: 'energy', label: 'Solar cells in the dome glass, the whole village', f: (v) => `${num(v / 1e6)} GWh a year` },
	battKwh: { g: 'energy', label: 'Batteries', f: (v) => `${num(v / 1000)} MWh` },
	ghLight: { g: 'food', label: 'Light under the glass and its cells, share of the outside', f: pct },
	ledKwh: { g: 'food', label: 'LED light: electricity for 1,000 kcal', f: (v) => (v == null ? 'off' : `${num(v)} kWh`) },
	protOut: { g: 'food', label: 'Protein in 1,000 kcal grown outdoors', unit: 'g' },
	protIn: { g: 'food', label: 'Protein in 1,000 kcal grown indoors', unit: 'g' },
	protImp: { g: 'food', label: 'Protein in 1,000 kcal imported', unit: 'g' },
	ghClimateM2: { g: 'food', label: 'Food domes: climate electricity a m² a day', unit: 'kWh' },
	eurMwh: { g: 'border', label: 'Exported electricity sells at', f: (v) => `€${num(v)} a MWh` },
	eur: { g: 'border', label: 'Border prices', f: (o) => (o && typeof o === 'object' ? Object.entries(o).map(([k, x]) => `${{ food: 'food', logs: 'logs', scrap: 'steel scrap', float: 'float glass', cells: 'solar cells', glulam: 'glulam' }[k] ?? k} €${num(x)} ${{ food: 'a 1,000 kcal', cells: 'a kWp' }[k] ?? 'a t'}`).join(' · ') : plain(o)) },
	reserveYears: { g: 'border', label: 'Euros left in the reserve at the founding', unit: 'years of the village’s food at wholesale' },
	accountDays: { g: 'border', label: 'A COOP keeps in its euro account', unit: 'days of its imports' },
	importAhead: { g: 'border', label: 'A COOP buys at the border ahead', unit: 'days of supply' },
	foodStoreDays: { g: 'founding', label: 'Food in the stores at the founding', unit: 'days' },
	storesDays: { g: 'founding', label: 'Materials and goods in the stores at the founding', unit: 'days' },
	scrapBack: { g: 'materials', label: 'Steel that comes back as scrap', f: pct },
	extras: { g: 'avens', label: 'How an Aven splits spending above the basics', f: (v) => byGood(v, pct) },
	rateR: { g: 'economy', label: 'Aven rate card', unit: 'R an Aven hour' },
	rentIdx: { g: 'economy', label: 'Ground-rent index', f: (v) => `× ${num(v)}` },
	p0: { g: 'coops', label: 'First price guesses (the day-0 fixed point finds the real ones)', unit: 'R a unit', f: byGood },
	p0base: { hide: true },
	p0g: { hide: true },
	domeKwhPerBed: { g: 'energy', label: 'Solar cells on the dome glass, a bed', unit: 'kWh a year' },
	geoMwhYear: { g: 'energy', label: 'Geothermal a year', unit: 'MWh' },
	kwhPerKwp: { g: 'energy', label: 'Field solar', unit: 'kWh a kWp a year' },
	geoKw: { g: 'energy', label: 'Geothermal, net electric a stage', unit: 'kW' },
	geoQin: { g: 'energy', label: 'Geothermal brine heat into the ORC a stage', unit: 'kW' },
	geoGross0: { g: 'energy', label: 'Geothermal gross electric a stage', unit: 'kW' },
	geoPumps: { g: 'energy', label: 'Geothermal pumps and fans a stage', unit: 'kW' },
	geoLoss: { g: 'energy', label: 'Geothermal heat lost a stage', unit: 'kW' },
	exergyLimit: { g: 'energy', label: 'Geothermal exergy limit', f: pct },
	geoHeatKw: { g: 'energy', label: 'Geothermal heat at 90 → 60 °C a stage', unit: 'kW' },
	geoLowKw: { g: 'energy', label: 'Geothermal low heat at 30–40 °C a stage', unit: 'kW' },
	geoUptime: { g: 'energy', label: 'Geothermal uptime', f: pct },
	geoMax: { g: 'energy', label: 'Most geothermal stages', unit: 'stages' },
	battRT: { g: 'energy', label: 'Battery round trip', f: pct },
	battFade: { g: 'energy', label: 'Battery fade', f: (v) => `${pct(v)} of its first capacity a year` },
	cop: { g: 'energy', label: 'Heat pump, year average', unit: 'kWh heat a kWh' },
	copMonth: { g: 'energy', label: 'Heat pump by month', unit: 'kWh heat a kWh', f: (v) => months(v) },
	rainMm: { g: 'water', label: 'Rain', unit: 'mm a year' },
	caught: { g: 'water', label: 'Share of the rain on roofs caught', f: pct },
	roofPerBed: { g: 'water', label: 'Roof a bed', unit: 'm²' },
	rechargeL: { g: 'water', label: 'Groundwater recharge', unit: 'L a day' },
	forest100: { g: 'food', label: 'Food forest outdoors at maturity', f: (v) => `${num(v * 1000)} kcal a m² a year (${num(v * 10)} M kcal a ha)` },
	forestRot: { g: 'food', label: 'Food store lost a day', f: pct },
	ghYield: { g: 'food', label: 'Food forest under glass at maturity', f: (v) => `${num(v * 1000)} kcal a m² a year (${num(v * 10)} M kcal a ha)` },
	ghHeatM2: { g: 'food', label: 'Food domes: heat a m² a year', unit: 'kWh' },
	timberT: { g: 'materials', label: 'Timber land yield', unit: 't a m² a year', f: (v) => `${num(v * 1e4)} t a ha a year`, noUnit: true },
	timberRamp: { g: 'materials', label: 'New timber land, share of full yield by year since planting', f: (v) => (Array.isArray(v) ? v.map(pct).join(' · ') : plain(v)) },
	standYears: { g: 'materials', label: 'Years of wood that can stand uncut', unit: 'years' },
	oreT: { g: 'materials', label: 'Iron ore a pit', unit: 't a year' },
	oreMax: { g: 'materials', label: 'Iron ore pits', unit: 'pits' },
	oreTPit: { g: 'materials', label: 'Ore in a pit', unit: 't' },
	sandT: { g: 'materials', label: 'Glass sand a pit', unit: 't a year' },
	sandMax: { g: 'materials', label: 'Sand pits', unit: 'pits' },
	sandTPit: { g: 'materials', label: 'Sand in a pit', unit: 't' },
	springHeat: { g: 'energy', label: 'Warm-pond heat a bather-hour', unit: 'kWh', f: (v) => months(v) },
	standingKwhT: { g: 'energy', label: 'A building’s standing electricity a tonne built', unit: 'kWh a day' },
	chipKwh: { g: 'border', label: 'Exported electricity that buys one accelerator', unit: 'kWh' },
	chipEur: { g: 'border', label: 'Price of an accelerator', f: (v) => `€${num(v)}` },
	eurPerKwh: { g: 'border', label: 'Exported electricity earns', f: (v) => `€${num(v * 1000)} a MWh` },
	lineKwhDay: { g: 'border', label: 'Export line', unit: 'kWh a day' },
	chipsSpare: { g: 'border', label: 'Spare accelerators in each COMPUTE COOP at the founding', unit: 'accelerators' },
	K0: { g: 'rd', label: 'Knowledge a recipe already embodies (K₀)', unit: 'MWh of R&D' },
	kDecay: { g: 'rd', label: 'R&D knowledge forgotten', f: (v) => `${pct(v)} a year` },
	replant: { g: 'rd', label: 'Timber land replanted', f: (v) => `${pct(v)} a year` },
	learnRates: { g: 'rd', label: 'Learning a doubling (by doing / by searching)', f: (v) => (v && typeof v === 'object' ? Object.entries(v).map(([k, r]) => `${k} ${pct(r?.doing ?? r)} / ${pct(r?.search ?? r)}`).join(' · ') : plain(v)) }
};

/**
 * The rows of a world's parameters, grouped: [{ id, label, rows: [{ key, kind, label, values, text, diff, set }] }].
 *
 * `sets`: one param set per world, each { settings, catalog, defaults? } (settings: the merged config the world ran
 * with; catalog: its constants; defaults: ./genesis.js DEFAULTS, to mark what this run sets apart from them). A
 * catalog may also be a tree of records { v, u, src }: each leaf record shows its own unit and its source.
 */
export function paramRows(sets, defaults = null) {
	const list = sets.filter(Boolean);
	if (!list.length) return [];
	const groups = new Map(GROUPS.map((g) => [g.id, { ...g, rows: [] }]));
	const add = (kind, key, spec, values) => {
		if (spec?.hide) return;
		const g = groups.get(spec?.g) ?? groups.get('other');
		const fmt = (v) => {
			if (v === undefined) return '–';
			const s = spec?.f ? spec.f(v) : plain(v);
			const unit = spec?.unit && !spec.noUnit && !(spec.noUnitIf && spec.noUnitIf(v)) && typeof v !== 'boolean' && v !== null && !(v && typeof v === 'object' && 'u' in v) ? ` ${spec.unit}` : '';
			return s + unit;
		};
		const text = values.map(fmt);
		const raw = values.map((v) => JSON.stringify(v ?? null));
		// marked changed only where the worlds differ as shown (a difference below the shown digits is not marked)
		const diff = raw.some((r) => r !== raw[0]) && text.some((t) => t !== text[0]);
		const def = kind === 'setting' && defaults && key in defaults ? JSON.stringify(defaults[key] ?? null) : null;
		const set = def != null && raw.some((r) => r !== def);
		// a record with a key that says nothing (row1, row2 …) is named by its source
		const label = /(^|\.)row\d+$/.test(key) && srcOf(values[0]) ? `${keyLabel(key).split(':')[0]}: ${srcOf(values[0])}` : (spec?.label ?? words(key));
		g.rows.push({ key, kind, label, values, text, diff, set, src: srcOf(values[0]), est: !!values[0]?.est });
	};
	// the settings, in the order of SETTINGS and then any others the worlds carry
	const sKeys = orderKeys(list.map((s) => s.settings ?? {}), SETTINGS);
	for (const k of sKeys) add('setting', k, SETTINGS[k] ?? guessSpec(k), list.map((s) => s.settings?.[k]));
	// the catalog: flat constants (w.c) by CATALOG, or a tree of records flattened to dotted keys
	const flat = list.map((s) => flatten(s.catalog ?? {}));
	const cKeys = orderKeys(flat, CATALOG);
	for (const k of cKeys) add('catalog', k, CATALOG[k] ?? guessSpec(k), flat.map((c) => c[k]));
	// the village facts (a tree of records from the village plan): in their own group unless their name says otherwise
	const vil = list.map((s) => flatten(s.village ?? {}));
	for (const k of orderKeys(vil, {})) add('village', k, guessSpec(k, 'village'), vil.map((c) => c[k]));
	return [...groups.values()].filter((g) => g.rows.length);
}

/** the keys of several objects: first those listed in `spec`, in its order, then the rest as they come */
function orderKeys(objs, spec) {
	const all = new Set();
	for (const o of objs) for (const k of Object.keys(o)) all.add(k);
	const known = Object.keys(spec).filter((k) => all.has(k));
	return [...known, ...[...all].filter((k) => !(k in spec))];
}
const isRecord = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'v' in v && ('u' in v || 'src' in v);
/** does a tree hold records { v, u } anywhere below (so it is a branch to open, not a value) */
const holdsRecords = (v, depth = 0) => !!v && typeof v === 'object' && !Array.isArray(v) && depth < 5 && Object.values(v).some((x) => isRecord(x) || holdsRecords(x, depth + 1));
/** a catalog tree to dotted keys, stopping at records { v, u } and at plain values */
function flatten(o, pre = '', out = {}) {
	if (!o || typeof o !== 'object') return out;
	for (const [k, v] of Object.entries(o)) {
		const key = pre ? `${pre}.${k}` : k;
		if (!isRecord(v) && holdsRecords(v) && key.split('.').length < 6) flatten(v, key, out);
		else out[key] = v;
	}
	return out;
}
const srcOf = (v) => (v && typeof v === 'object' && typeof v.src === 'string' ? v.src : '');
/** which group a name belongs to, by the words in it (tested on the branch of a dotted key first, then on the whole) */
const GROUP_WORDS = [
	['founding', /\b(found\w*|bill|day0)\b/],
	['food', /\b(food|forest|kcal|protein|crops?|harvest|diet|greenhouse|indoor|led|lettuce|orchard)\b/],
	['water', /\b(water|rain|well|tanks?|recharge|aquifer)\b/],
	['energy', /\b(geo\w*|solar|kwh|kwp|batt\w*|energy|cop|heat|egs|grid|electric\w*|pv)\b/],
	['border', /\b(eur|euros?|imports?|exports?|reserve|border|chips?|accel\w*|prices?)\b/],
	['village', /\b(domes?|hex|hexes|tower|beds?|homes?|village|layout|halls?)\b/],
	['materials', /\b(steel|glass|wood|woodland|glulam|timber|ore|sand|lime|hemp|concrete|materials?|works|soda|logs?|bamboo|pits?)\b/],
	['rd', /\b(learn\w*|rd|k0|knowledge)\b/],
	['shocks', /\b(shocks?|drought|weather|winter)\b/],
	['people', /\b(land|nature|people|persons?)\b/]
];
/** the words of a key: camelCase and dots split, lower case */
const tokens = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._-]/g, ' ').toLowerCase();
/** a group and a label for a key nobody listed: by words in its name (else `dflt`) */
function guessSpec(key, dflt = 'other') {
	const parts = key.split('.');
	const test = (t) => GROUP_WORDS.find(([, re]) => re.test(t))?.[0];
	const g = (parts.length > 1 && test(tokens(parts[0]))) || test(tokens(key)) || dflt;
	return { g, label: keyLabel(key) };
}
/** a dotted key in words: "land.outdoorFoodHa" → "Land: outdoor food" (the unit shows with the value) */
function keyLabel(key) {
	const parts = key.split('.');
	const leaf = words(parts.pop().replace(/([a-z])(Ha|M2|kWh|KWh|MWh|GWh|kWp|kW|MW|Eur|T|Kg|L|Mm)$/, '$1'))
		.replace(/\bm2\b/g, 'm²')
		.replace(/\bkwh\b/gi, 'kWh');
	if (!parts.length) return leaf;
	return `${parts.map(words).join(' · ')}: ${leaf.charAt(0).toLowerCase() + leaf.slice(1)}`;
}

// ── the living standards and the import ledger (the Living and Imports tabs) ─────────────────────────────────────
/** the three tenths by MIND holdings the Living tab shows, in the order of a record's `tenths` */
export const TENTHS = [
	{ id: 'poorest', label: 'Poorest' },
	{ id: 'middle', label: 'Middle' },
	{ id: 'richest', label: 'Richest' }
];
/**
 * What a person gets, per person (k: the key in a tenth's record · unit · need: the key in the record's `need`, when
 * there is one · short: a short name for a chip)
 */
export const LIVING = [
	{ k: 'kcal', label: 'Food eaten', unit: 'kcal a day', need: 'kcal', short: 'Food', digits: 4 },
	{ k: 'protein', label: 'Protein', unit: 'g a day', need: 'protein' },
	{ k: 'homeM2', label: 'Home', unit: 'm² a person', short: 'Home' },
	{ k: 'waterL', label: 'Water', unit: 'litres a day', need: 'waterL' },
	{ k: 'kwh', label: 'Electricity at home', unit: 'kWh a day', need: 'kwh', short: 'Electricity' },
	{ k: 'avenH', label: 'Aven help', unit: 'hours a day', short: 'Aven' },
	{ k: 'goodsKg', label: 'Goods', unit: 'kg a year' },
	{ k: 'pondH', label: 'Warm ponds', unit: 'hours a week', short: 'Ponds' },
	{ k: 'short', label: 'People short', unit: 'of anything, that year', short: 'Short' }
];

// ── reading the engine's yearly records (contract: ./records.js livingYears, villageYears, borderYears, foundingBill)
const TENTH_KEYS = ['poorest', 'middle', 'richest'];
/** one tenth's (or everyone's) record in the page's keys */
const tenthOf = (t) =>
	t ? { kcal: t.kcal, protein: t.protein, homeM2: t.homeM2, waterL: t.waterL, kwh: t.homeKwh ?? t.kwh, avenH: t.avenH, goodsKg: t.goodsKgYear ?? t.goodsKg, pondH: t.pondHWeek ?? t.pondH, short: t.shortPeople ?? t.short } : null;
const ENERGY_MADE = { solar: 'solar', geothermal: 'geothermal', battery: 'from the battery' };
const ENERGY_WENT = { basics: 'basics at home', running: 'works and extras', building: 'building', rd: 'R&D', export: 'exported', storage: 'into storage', curtailed: 'curtailed', losses: 'losses' };
const GOOD_WORDS = { food: 'Food', water: 'Water', energy: 'Electricity', bed: 'Homes', goods: 'Goods', spring: 'Warm ponds', compute: 'Aven services', glulam: 'Glulam', wood: 'Glulam', steel: 'Steel', glass: 'Glass', panel: 'Solar panels', panels: 'Solar panels' };
/** a year of village totals in the page's shape */
function villageOf(v) {
	if (!v) return null;
	const made = v.energy?.made ?? {};
	const went = v.energy?.went ?? {};
	const sum = (o) => Object.values(o).reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
	return {
		food: v.food ? { out: v.food.outdoors, in: v.food.indoors, imp: v.food.imported, eaten: v.food.eaten } : null,
		indoorByMonth: v.indoorByMonth ?? null,
		energy: v.energy
			? {
					made: typeof made === 'number' ? made : sum(made),
					from: Object.entries(made && typeof made === 'object' ? made : {}).map(([k, x]) => ({ label: ENERGY_MADE[k] ?? words(k).toLowerCase(), v: x })),
					uses: Object.entries(went).map(([k, x]) => ({ label: ENERGY_WENT[k] ?? words(k).toLowerCase(), v: x }))
				}
			: null,
		binds: v.binds ? Object.entries(v.binds).map(([g, why]) => ({ good: GOOD_WORDS[g] ?? words(g), why: String(why) })) : []
	};
}
/**
 * The Living tab's record of one world: `L` from livingYears(w), `V` from villageYears(w), `catalog` the world's
 * constants (for the needs). { need, years: [{ y, days, partial, tenths: [poorest, middle, richest], all, village }] }
 */
export function livingOf(L, V, catalog = {}, fallbackNeed = {}) {
	if (!Array.isArray(L) || !L.length) return null;
	const byYear = new Map((V ?? []).map((v) => [v.year, v]));
	const n = catalog?.need;
	const need = {
		kcal: catalog?.kcalNeed ?? fallbackNeed.kcal ?? null,
		protein: catalog?.proteinNeed ?? fallbackNeed.protein ?? null,
		waterL: catalog?.waterNeedL ?? (Array.isArray(n) ? n[1] : null),
		kwh: catalog?.homeKwhNeed ?? (Array.isArray(n) ? n[2] : null)
	};
	return {
		need,
		years: L.map((r) => ({
			y: r.year,
			days: r.days,
			partial: r.days != null && r.days < 365,
			tenths: TENTH_KEYS.map((k) => tenthOf(r.tenths?.[k])),
			all: r.all ? { ...tenthOf(r.all), short: r.shortPeople ?? r.all.shortPeople } : null,
			village: villageOf(byYear.get(r.year))
		}))
	};
}
/** what a border line is: its label and its unit */
export const BORDER_ITEMS = {
	food: { label: 'Food', unit: 'kcal', q: 'kcal' },
	glulam: { label: 'Glulam', unit: 't', q: 't' },
	logs: { label: 'Logs', unit: 't', q: 't' },
	steel: { label: 'Steel', unit: 't', q: 't' },
	scrap: { label: 'Steel scrap', unit: 't', q: 't' },
	float: { label: 'Float glass', unit: 't', q: 't' },
	glass: { label: 'Glass', unit: 't', q: 't' },
	soda: { label: 'Soda ash', unit: 't', q: 't' },
	panels: { label: 'Solar panels', unit: 'kWp', q: 'kwp' },
	cells: { label: 'Solar cells for the glass', unit: 'kWp', q: 'kwp' },
	accelerators: { label: 'Accelerators', unit: '', q: 'n' }
};
/**
 * The Imports tab's record of one world: `B` from borderYears(w), `F` from foundingBill(w), `V` villageYears(w) (for
 * food in kcal a person a day), `marks` { firstFedYear, exportsCoverYear } when the record carries them.
 */
export function importsOf(B, F, V, marks = {}, L = null) {
	if (!(Array.isArray(B) && B.length) && !F) return null;
	const vBy = new Map((V ?? []).map((v) => [v.year, v]));
	const dBy = new Map((L ?? []).map((r) => [r.year, r.days]));
	const years = (B ?? []).map((b) => {
		const im = b.imports ?? {};
		const materials = {}, solar = {}, items = [];
		for (const [k, x] of Object.entries(im)) {
			const it = BORDER_ITEMS[k] ?? { label: words(k), unit: x?.t != null ? 't' : '', q: x?.t != null ? 't' : x?.kwp != null ? 'kwp' : x?.n != null ? 'n' : 'kcal' };
			const q = x?.[it.q];
			items.push({ id: k, label: it.label, unit: it.unit, q, eur: x?.eur });
			if (it.q === 't' && k !== 'food') materials[it.label] = q ?? 0;
			if (it.q === 'kwp') solar[it.label] = q ?? 0;
		}
		const v = vBy.get(b.year);
		const days = b.days ?? dBy.get(b.year) ?? v?.days;
		return {
			y: b.year,
			days,
			partial: days != null && days < 365,
			foodKcal: v?.food?.imported ?? null,
			foodShare: v?.food && v.food.eaten > 0 ? v.food.imported / v.food.eaten : null,
			materials,
			materialsT: Object.values(materials).reduce((a, x) => a + (x || 0), 0),
			solarKwp: Object.values(solar).reduce((a, x) => a + (x || 0), 0),
			accel: im.accelerators?.n ?? null,
			items,
			importEur: b.importEur,
			exportEur: b.exportEur,
			exportKwh: b.exportKwh,
			reserveEur: b.reserveEur,
			shortDays: b.importShortDays ?? null,
			fedSelf: !!b.fedSelf,
			exportsCover: !!b.exportsCover
		};
	});
	const first = (k) => years.find((r) => r[k] && !r.partial)?.y ?? years.find((r) => r[k])?.y ?? null;
	// the first year the border could not pay for what was needed (days the reserve had no euros for an import), or
	// the reserve stood at nothing
	const neg = years.find((r) => r.shortDays > 0) ?? years.find((r) => Number.isFinite(r.reserveEur) && r.reserveEur <= 0);
	return {
		founding: F
			? {
					rows: (F.rows ?? []).map((r) => ({ id: r.id, label: r.label, t: r.t, kwp: r.kwp, n: r.n, kcal: r.kcal, ha: r.ha, m2: r.m2, m3: r.m3, eur: r.eur, group: r.group })),
					t: F.tonnes ?? (F.rows ?? []).reduce((a, r) => a + (Number.isFinite(r.t) ? r.t : 0), 0),
					builtEur: F.builtEur ?? null,
					eur: F.totalEur ?? (F.rows ?? []).reduce((a, r) => a + (Number.isFinite(r.eur) ? r.eur : 0), 0),
					rowsEur: (F.rows ?? []).reduce((a, r) => a + (Number.isFinite(r.eur) ? r.eur : 0), 0),
					note: F.foodStoreDays != null ? `On day 0 the food stores hold ${num(F.foodStoreDays)} days of imported food.` : ''
				}
			: null,
		reserve0: F?.reserveEur ?? null,
		years,
		selfFedYear: marks.firstFedYear !== undefined ? marks.firstFedYear : first('fedSelf'),
		exportsPayYear: marks.exportsCoverYear !== undefined ? marks.exportsCoverYear : first('exportsCover'),
		runOut: neg?.y ?? null
	};
}
