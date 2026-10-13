// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · PROPOSITION 3, CHECKED — reads a world's records (./records.js) and says, part by part, whether the
 * world kept the proposition, with the evidence: the worst person and the worst day, the first day the strict test
 * held, each decile's series. Nothing here is an average over people; every test is per person and per day.
 *
 *   P1  every person gets at least 98 % of each basic every day after day 0.
 *   P2  the owner-only cohort (5 %, Aven output 0, holdings 0 at the start):
 *       strict: today's Law 5 dividends alone pay today's basic bundle (target: from day 120 on, every day);
 *       normal: dividends and some held MIND pay for the basics every day, and the holding never runs out.
 *   P3  judged in REAL UNITS per tenth (Samuel, 2026-10-13 06:48): the people sorted into tenths by MIND holdings
 *       and by Aven output; each tenth's yearly mean a person of each item:
 *       basics (kcal, protein, water, electricity at home, a bed) at or above need every year (within 1 %);
 *       extras (m² of home, kg of goods a year, hours of Aven help, hours at the warm ponds a week) never fall more
 *       than 2 % over any 5-year window, except an item at satiation or held by a physical limit named in the
 *       village's binds column that year (food above need is not counted as an extra: the engine has no variety);
 *       over the run each tenth's basket rises: at least one extra clearly up (5 % or more, first full year to last)
 *       and none down beyond 2 %. Ramp years count like any other: per person, each person in the tenth they are in
 *       that day (a newcomer arrives with nothing held, so in the poorest tenth by holdings, and in the tenth of their
 *       Aven's output). COOPs stay solvent or exit by receivership with no basic shortfall, and nothing is delivered
 *       unpaid. Every failing item, tenth and window is listed. The round-2 test on the money index (every decile's
 *       index never falls more than 2 % in 5 years, and rises or ends near the capacity ceiling) is kept beside it as
 *       "old money index (comparison)".
 *   Abundance: the basics' binding limit is never MIND while the physics ceiling is at least need (the twin-world
 *       tests, doubling HEARTS and doubling a binding physical limit, are ./experiments.js X9 and X11).
 *
 * Living standards swing with the seasons (more spring time in winter, more food in autumn), so a fall is read two
 * ways and the stricter sets the verdict: on each decile's 365-day trailing mean (a fall of the year-round living
 * standard), and season against season (each 30-day block of the year against the same block in each of the five
 * years before). The index is also read without Aven services (compute), so the reader sees what the rise is made of.
 * The ceiling is the capacity a person (the mean over people) of the plants standing that day, not a bound from
 * land, energy and deposits alone (./records.js physicsCeiling).
 */
import { BASICS, GOOD_IDS, G, LIMIT_NAMES, PHYSICAL, BED, GOODS_, COMPUTE, SPRING } from './consts.js';
import { livingYears } from './records.js';

const YEAR = 365;
const BASIC_NAMES = BASICS.map((b) => GOOD_IDS[b]);

/** check every part of Proposition 3 on a world that has run; `opts.window` (days, default 5 years) */
export function prop3(w, opts = {}) {
	const rec = w.rec, n = rec.n;
	const P1 = checkP1(w);
	const P2 = checkP2(w, opts);
	const P3 = checkP3(w, opts);
	const abundance = checkAbundance(w);
	return { days: n, people: w.N, P1, P2, P3, abundance, pass: P1.pass && P2.pass && P3.pass && abundance.pass, limits: bindingSummary(w), energy: energyByDecile(w) };
}

// ── P1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function checkP1(w) {
	const rec = w.rec, n = rec.n;
	const minMet = [Infinity, Infinity, Infinity, Infinity], minDay = [-1, -1, -1, -1];
	for (let d = 1; d < n; d++)
		for (let b = 0; b < 4; b++) {
			const x = rec.minMet[d * 4 + b];
			if (x < minMet[b]) (minMet[b] = x), (minDay[b] = d);
		}
	let peopleShort = 0;
	for (let i = 0; i < w.N; i++) if (rec.personShort[i] > 0) peopleShort++;
	const worst = rec.worst.i >= 0 ? { person: rec.worst.i, day: rec.worst.day, good: GOOD_IDS[rec.worst.g], met: rec.worst.met } : null;
	return {
		pass: rec.shortAnyPD === 0,
		personDaysShort: Object.fromEntries(BASIC_NAMES.map((g, b) => [g, rec.shortPD[b]])),
		personDaysShortAny: rec.shortAnyPD,
		peopleEverShort: peopleShort,
		lowestShareMet: Object.fromEntries(BASIC_NAMES.map((g, b) => [g, { share: minMet[b], day: minDay[b] }])),
		worst
	};
}

// ── P2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function checkP2(w, opts) {
	const rec = w.rec, n = rec.n, target = opts.strictTarget ?? 120;
	let first = -1, holdsFrom = -1, failAfter = 0, worstAfter = { ratio: Infinity, day: -1 };
	for (let d = 1; d < n; d++) if (rec.strict[d] >= 1) { first = d; break; }
	// the first day from which it held every day to the end
	if (n > 1 && rec.strict[n - 1] >= 1) {
		holdsFrom = n - 1;
		while (holdsFrom > 1 && rec.strict[holdsFrom - 1] >= 1) holdsFrom--;
	}
	if (first > 0)
		for (let d = first; d < n; d++) {
			if (!(rec.strict[d] >= 1)) failAfter++;
			if (rec.strict[d] < worstAfter.ratio) worstAfter = { ratio: rec.strict[d], day: d };
		}
	const strictByYear = yearly(rec, 'strict', 1, 0, Math.min);
	const strictMedByYear = yearly(rec, 'strictMed', 1, 0);
	// normal: every owner-only person met every basic and still held MIND, every day
	const holdDays = series1(rec, 'ownerHoldDays');
	const byYear = [];
	for (let y = 0; y * YEAR < n; y++) {
		let m = Infinity;
		for (let d = Math.max(1, y * YEAR); d < Math.min(n, (y + 1) * YEAR); d++) m = Math.min(m, holdDays[d]);
		byYear.push(m);
	}
	// the trend of the lowest holding over the last ten years (days of the bundle a year): a falling holding runs out
	const yrs = byYear.length, from = Math.max(1, yrs - 10);
	const slope = yrs - from >= 3 ? fitSlope(byYear.slice(from, yrs)) : 0;
	const last = byYear[yrs - 1];
	const runsOutInYears = slope < 0 ? last / -slope : Infinity;
	let ownerMetMin = Infinity, ownerMetDay = -1;
	for (let d = 1; d < n; d++) if (rec.ownerMet[d] < ownerMetMin) (ownerMetMin = rec.ownerMet[d]), (ownerMetDay = d);
	const strict = {
		pass: holdsFrom > 0 && holdsFrom <= target,
		target,
		firstDay: first,
		holdsEveryDayFrom: holdsFrom,
		failDaysAfterFirst: failAfter,
		worstAfterFirst: first > 0 ? worstAfter : null,
		daysHeld: rec.strictDays,
		lowestRatioByYear: strictByYear,
		medianRatioByYear: strictMedByYear
	};
	const normal = {
		pass: rec.normalFailPD === 0 && runsOutInYears > 100,
		// person-days an owner-only person was short of a basic or held nothing (exact; firstFailures lists examples)
		failures: rec.normalFailPD,
		firstFailures: rec.normalFail.slice(0, 5),
		lowestShareMet: { share: ownerMetMin, day: ownerMetDay },
		lowestHoldingDaysByYear: byYear,
		holdingTrendDaysPerYear: slope,
		runsOutInYears
	};
	return { pass: strict.pass && normal.pass, cohort: w.ownerIds.length, strict, normal };
}

// ── P3 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function checkP3(w, opts) {
	const rec = w.rec, n = rec.n;
	const W = Math.min(opts.window ?? 5 * YEAR, Math.max(YEAR, n - YEAR));
	const exempt = shockWindows(w);
	const ceil = trailing(series1(rec, 'Lceil'));
	const deciles = [];
	for (const [by, key] of [['holdings', 'decH'], ['aven', 'decA']])
		for (let x = 0; x < 10; x++) deciles.push({ by, decile: x + 1, ...decileCheck(rec, key, x, ceil, W, exempt, n) });
	// the same, on the index without Aven services
	const ceilX = trailing(series1(rec, 'LceilX'));
	const decilesX = [];
	for (const [by, key] of [['holdings', 'decHx'], ['aven', 'decAx']])
		for (let x = 0; x < 10; x++) decilesX.push({ by, decile: x + 1, ...decileCheck(rec, key, x, ceilX, W, exempt, n) });
	const coops = coopCheck(w);
	const failed = deciles.filter((d) => !d.pass);
	const failedX = decilesX.filter((d) => !d.pass);
	const real = realUnits(w);
	return {
		// the verdict: real units per tenth (Samuel, 06:48); the money index below is the comparison
		pass: real.pass && coops.pass,
		failed: real.failedTenths,
		real,
		oldIndex: { pass: failed.length === 0 && coops.pass, failed: failed.map((d) => `${d.by} decile ${d.decile}`), netPass: deciles.every((d) => d.windowsFailed === 0) },
		windowDays: W,
		reading: 'fall: the larger of (a) the largest drop of the 365-day trailing mean from any earlier point within the window and (b) the largest drop of a 30-day block of the year against the same block in any of the five years before; rise: every full window ends higher than it began or within 5 % of the capacity ceiling',
		exemptWindows: exempt,
		deciles,
		netPass: deciles.every((d) => d.windowsFailed === 0),
		withoutCompute: { pass: failedX.length === 0, failed: failedX.map((d) => `${d.by} decile ${d.decile}`), deciles: decilesX },
		share: computeShare(w),
		coops
	};
}

/** the items of the real-units test: key in the yearly tenth rows (./records.js livingYears), plain name, unit */
const BASIC_ITEMS = [
	['kcal', 'food', 'kcal a day'],
	['protein', 'protein', 'g a day'],
	['waterL', 'water', 'L a day'],
	['homeKwh', 'electricity at home', 'kWh a day'],
	['bed', 'a bed', 'beds']
];
const EXTRA_ITEMS = [
	['homeM2', 'home', 'm²', BED],
	['goodsKgYear', 'goods', 'kg a year', GOODS_],
	['avenH', 'Aven help', 'hours a day', COMPUTE],
	['pondHWeek', 'warm ponds', 'hours a week', SPRING]
];
const FALL = 0.02, UP = 0.05, BASIC_TOL = 0.01;

/**
 * Proposition 3 in real units per tenth (Samuel, 2026-10-13 06:48), on the yearly means a person of each tenth by MIND
 * holdings and by Aven output (./records.js livingYears). Full years only (a last partial year is left out unless the
 * run is shorter than a year). See the header for the rule.
 */
export function realUnits(w, opts = {}) {
	const L = livingYears(w);
	const full = L.filter((y) => y.days >= 365);
	const Y = full.length ? full : L.slice(0, 1);
	const yrs = w.rec?.years ?? [];
	const c = w.c;
	const need = { kcal: c.kcalNeed, protein: c.proteinNeed, waterL: c.waterNeedL ?? c.need[1], homeKwh: c.homeKwhNeed ?? c.need[2], bed: 1 };
	// satiation of each extra, in the item's unit
	const sat = { homeM2: c.homeM2PerBed * 1, goodsKgYear: c.sat[GOODS_] * 365, avenH: c.sat[COMPUTE], pondHWeek: c.sat[SPRING] * 7 };
	// the year's binding limit of a good (the most frequent badge), and whether it is physical
	const bindOf = (y, g) => {
		const Yr = yrs[y];
		if (!Yr) return { code: -1, words: '', physical: false };
		let best = 0, n = -1;
		for (let x = 0; x < 32; x++) if (Yr.badges[g * 32 + x] > n) (n = Yr.badges[g * 32 + x]), (best = x);
		return { code: best, words: LIMIT_NAMES[best] ?? String(best), physical: PHYSICAL.includes(best) };
	};
	const W = Math.round((opts.window ?? 5 * YEAR) / YEAR);
	const failures = [], excused = [], basicsFail = [], riseFail = [];
	const tenths = [];
	for (const [by, key] of [['holdings', 'byHoldings'], ['aven', 'byAven']])
		for (let x = 0; x < 10; x++) {
			const rows = Y.map((y) => y[key]?.[x]).filter(Boolean);
			const yearNo = Y.map((y) => y.year);
			const t = { by, tenth: x + 1, pass: true, basics: true, extras: true, rise: true, first: {}, last: {}, change: {}, worstFall: {} };
			if (!rows.length) {
				t.pass = false;
				tenths.push(t);
				continue;
			}
			// basics: at or above need every year
			for (const [k, name, unit] of BASIC_ITEMS)
				rows.forEach((r, i) => {
					if (r.personDays > 0 && r[k] < need[k] * (1 - BASIC_TOL)) {
						t.basics = false;
						basicsFail.push({ by, tenth: x + 1, item: name, unit, year: yearNo[i], value: r[k], need: need[k] });
					}
				});
			// extras: no fall beyond 2 % within any window of W years, unless at satiation or a physical limit binds
			for (const [k, name, unit, g] of EXTRA_ITEMS) {
				let worst = { fall: 0, from: null, to: null };
				for (let b = 1; b < rows.length; b++) {
					let wb = null;
					for (let a = Math.max(0, b - W); a < b; a++) {
						const va = rows[a][k], vb = rows[b][k];
						if (!(va > 0)) continue;
						const fall = 1 - vb / va;
						if (fall > FALL && (!wb || fall > wb.fall)) wb = { fall, from: yearNo[a], to: yearNo[b], va, vb };
					}
					if (!wb) continue;
					if (wb.fall > worst.fall) worst = { fall: wb.fall, from: wb.from, to: wb.to };
					const atSat = rows[b][k] >= sat[k] * 0.98;
					const bind = bindOf(yearNo[b] - 1, g);
					const rec = { by, tenth: x + 1, item: name, unit, from: wb.from, to: wb.to, fall: wb.fall, before: wb.va, after: wb.vb };
					if (atSat) excused.push({ ...rec, why: 'at satiation' });
					else if (bind.physical) excused.push({ ...rec, why: `physical limit: ${bind.words}` });
					else {
						t.extras = false;
						failures.push({ ...rec, bind: bind.words });
					}
				}
				t.worstFall[k] = worst;
				t.first[k] = rows[0][k];
				t.last[k] = rows[rows.length - 1][k];
				t.change[k] = rows[0][k] > 0 ? rows[rows.length - 1][k] / rows[0][k] - 1 : rows[rows.length - 1][k] > 0 ? Infinity : 0;
			}
			// the rise over the run: one extra clearly up, none down beyond 2 % (unless at satiation or a physical limit)
			if (rows.length >= 2) {
				const up = EXTRA_ITEMS.filter(([k]) => t.change[k] >= UP).map(([, name]) => name);
				const down = EXTRA_ITEMS.filter(([k, , , g]) => t.change[k] < -FALL && !(t.last[k] >= sat[k] * 0.98) && !bindOf(yearNo[rows.length - 1] - 1, g).physical).map(([, name]) => name);
				t.up = up;
				t.down = down;
				if (!up.length || down.length) {
					t.rise = false;
					riseFail.push({ by, tenth: x + 1, up, down, from: yearNo[0], to: yearNo[rows.length - 1] });
				}
			}
			t.pass = t.basics && t.extras && t.rise;
			tenths.push(t);
		}
	const failedTenths = tenths.filter((t) => !t.pass).map((t) => `${t.by} tenth ${t.tenth}`);
	return {
		pass: failedTenths.length === 0,
		rule: 'basics (kcal, protein, water, home kWh, a bed) at or above need every year (within 1 %); extras (home m², goods kg a year, Aven hours, pond hours a week) never down more than 2 % over any 5-year window unless at satiation or a physical limit binds that year; each tenth’s basket rises over the run (one extra up 5 % or more, none down beyond 2 %); tenths by MIND holdings and by Aven output, yearly means a person, full years',
		newcomers: 'every person counts in the tenth they are in that day. A newcomer arrives with an Aven and nothing held (so in the poorest tenth by holdings, and in the tenth of its Aven’s output), gets its 24 HEARTS from its first day, and its Aven puts them where the people already here put theirs on average; every twentieth newcomer is owner-only (an Aven that delivers nothing)',
		years: Y.length,
		failedTenths,
		basicsFail,
		failures,
		excused,
		riseFail,
		tenths
	};
}

/** the share of the living-standard index that is Aven services (compute), by year, for everyone and the poorest tenth */
function computeShare(w) {
	const rec = w.rec, n = rec.n, out = [];
	for (let y = 0; y * YEAR < n; y++) {
		let a = 0, ax = 0, p = 0, px = 0;
		for (let d = Math.max(1, y * YEAR); d < Math.min(n, (y + 1) * YEAR); d++) {
			a += rec.Lmean[d];
			let lx = 0;
			for (let x = 0; x < 10; x++) lx += rec.decHx[d * 10 + x] / 10;
			ax += lx;
			p += rec.decH[d * 10];
			px += rec.decHx[d * 10];
		}
		out.push({ year: y + 1, all: a > 0 ? 1 - ax / a : NaN, poorest: p > 0 ? 1 - px / p : NaN });
	}
	return out;
}

function decileCheck(rec, key, x, ceil, W, exempt, n) {
	const s = new Array(n);
	for (let d = 0; d < n; d++) s[d] = rec[key][d * 10 + x];
	const T = trailing(s);
	const d0 = YEAR - 1;
	if (n <= d0 + 1) return { pass: false, reason: 'shorter than a year', first: NaN, last: NaN };
	// the largest fall from any earlier point within the window (sliding maximum)
	let worstDD = { fall: 0, peakDay: -1, day: -1 };
	const dq = [];
	for (let d = d0; d < n; d++) {
		while (dq.length && T[dq[dq.length - 1]] <= T[d]) dq.pop();
		dq.push(d);
		while (dq[0] < d - W) dq.shift();
		if (isExempt(d, exempt)) continue;
		const pk = dq[0];
		const fall = 1 - T[d] / T[pk];
		if (fall > worstDD.fall) worstDD = { fall, peakDay: pk, day: d };
	}
	// the net change over each full window
	let worstNet = { change: Infinity, from: -1, to: -1 };
	for (let d = d0 + W; d < n; d++) {
		if (isExempt(d, exempt)) continue;
		const ch = T[d] / T[d - W] - 1;
		if (ch < worstNet.change) worstNet = { change: ch, from: d - W, to: d };
	}
	if (!isFinite(worstNet.change)) worstNet = { change: T[n - 1] / T[d0] - 1, from: d0, to: n - 1 };
	// season against season: each 30-day block of a year against the same block in each of the five years before
	const BL = 30, perYear = 12;
	const blk = (y, j) => {
		let a = 0, c = 0;
		for (let d = y * YEAR + j * BL; d < Math.min(n, y * YEAR + (j + 1) * BL); d++) if (Number.isFinite(s[d])) (a += s[d]), c++;
		return c === BL ? a / c : NaN;
	};
	let seasonal = { fall: 0, day: -1, from: -1 };
	const years = Math.floor(n / YEAR) + 1;
	const B = [];
	for (let y = 0; y < years; y++) for (let j = 0; j < perYear; j++) B.push(blk(y, j));
	const yearsBack = Math.round(W / YEAR);
	for (let y = 1; y < years; y++)
		for (let j = 0; j < perYear; j++) {
			const v = B[y * perYear + j], day = y * YEAR + j * BL;
			if (!Number.isFinite(v) || isExempt(day, exempt)) continue;
			for (let k = Math.max(0, y - yearsBack); k < y; k++) {
				const u = B[k * perYear + j];
				// day 0 is no reading (everyone starts with nothing)
				if (!Number.isFinite(u) || (k === 0 && j === 0)) continue;
				const fall = 1 - v / u;
				if (fall > seasonal.fall) seasonal = { fall, day, from: k * YEAR + j * BL };
			}
		}
	// every full window: it ends higher than it began, or within 5 % of the capacity ceiling
	let windowsFailed = 0, worstWindow = null;
	for (let d = d0 + W; d < n; d++) {
		if (isExempt(d, exempt)) continue;
		const up = T[d] >= T[d - W], near = T[d] >= 0.95 * ceil[d];
		if (!up && !near) {
			windowsFailed++;
			const ch = T[d] / T[d - W] - 1;
			if (!worstWindow || ch < worstWindow.change) worstWindow = { change: ch, from: d - W, to: d, ofCeiling: T[d] / ceil[d] };
		}
	}
	const first = T[d0], last = T[n - 1], ceiling = ceil[n - 1];
	const rises = last > first;
	const nearCeiling = last >= 0.95 * ceiling;
	const byYear = [];
	for (let y = 0; y * YEAR < n; y++) {
		let a = 0, c = 0;
		for (let d = y * YEAR; d < Math.min(n, (y + 1) * YEAR); d++) if (Number.isFinite(s[d])) (a += s[d]), c++;
		byYear.push(c ? a / c : NaN);
	}
	// a run shorter than a window has no full window: then the run's end against its first year
	const riseOk = n - d0 > W ? windowsFailed === 0 : rises || nearCeiling;
	const fall = Math.max(worstDD.fall, seasonal.fall);
	return { pass: fall <= 0.02 && riseOk, fall, first, last, ceiling, rises, nearCeiling, worstDrawdown: worstDD, seasonalFall: seasonal, windowsFailed, worstWindow, worstNet, byYear };
}

/**
 * The scheduled shocks' windows in which a fall is excused: the shock itself, up to 90 days of it, and then 2 years
 * of recovery. A longer shock is not a shock but a new climate: from its 91st day on the falls count again until it
 * ends, and its 2 years of recovery start only when it ends.
 */
const SHOCK_EXCUSED_DAYS = 90;
function shockWindows(w) {
	const out = [];
	for (const s of w.cfg.shocks ?? []) {
		const len = s.days ?? (s.kind === 'coopFail' ? 365 : 90);
		out.push({ kind: s.kind, from: s.day, to: s.day + Math.min(len, SHOCK_EXCUSED_DAYS) - 1, part: 'shock' });
		out.push({ kind: s.kind, from: s.day + len, to: s.day + len + 2 * YEAR, part: 'recovery' });
	}
	return out;
}
const isExempt = (d, ex) => ex.some((e) => d >= e.from && d <= e.to);

function coopCheck(w) {
	const rec = w.rec, n = rec.n;
	const exits = w.events.filter((e) => e.kind === 'receivership');
	const list = exits.map((e) => {
		let pd = 0;
		// a basic short from a month before the exit to a year after it is laid at the receivership's door (a failing
		// COOP's plants change hands, wear and are rebuilt over months, not weeks)
		for (let d = Math.max(1, e.day - 30); d < Math.min(n, e.day + YEAR); d++) for (let b = 0; b < 4; b++) pd += rec.shortN[d * 4 + b];
		const co = w.coops.find((c) => c.id === e.coop);
		return { day: e.day, coop: e.coop, good: co ? GOOD_IDS[co.good] : '?', heir: e.heir, why: e.why, basicShortPersonDaysAround: pd };
	});
	const insolvent = w.coops.filter((c) => c.alive && !c.city && c.lowDays > 0).map((c) => ({ coop: c.id, lowDays: c.lowDays }));
	// goods and energy delivered and not paid for (a breach of the rule that every sale is paid), against all sales
	let unpaidR = 0, salesR = 0;
	for (let d = 0; d < n; d++) unpaidR += rec.unpaidR[d];
	for (let d = 0; d < n; d++) salesR += rec.basicCostR[d] * w.N;
	return {
		// unpaid deliveries fail the part: every sale is paid. The tolerance is floating-point rounding only (a
		// billionth of what the basic bundles cost), not a share of sales
		pass: list.every((x) => x.basicShortPersonDaysAround === 0) && insolvent.every((c) => c.lowDays < 30) && (w.coopLowDays ?? 0) === 0 && unpaidR <= 1e-9 * salesR,
		unpaidBy: Object.fromEntries(Object.entries(w.unpaidBy ?? {}).filter(([, v]) => v > 0)),
		coopDaysUnableToPay30: w.coopLowDays ?? 0,
		unpaidR,
		unpaidShare: salesR > 0 ? unpaidR / salesR : 0,
		receiverships: list,
		insolventNow: insolvent,
		alive: w.coops.filter((c) => c.alive).length,
		founded: w.events.filter((e) => e.kind === 'found').length
	};
}

// ── abundance ────────────────────────────────────────────────────────────────────────────────────────────────────
function checkAbundance(w) {
	const rec = w.rec, v = rec.mindViolations;
	return {
		pass: rec.mindDayGoods === 0,
		// day-goods (a day and a basic) on which MIND bound a basic while the physics ceiling was at or above need: exact
		mindBindsBasics: rec.mindDayGoods,
		mindDays: rec.mindDays,
		mindBy: Object.fromEntries(BASIC_NAMES.map((g, b) => [g, rec.mindDayGoodsBy[b]])),
		examples: v.slice(0, 5).map((x) => ({ day: x.day, good: GOOD_IDS[x.good], minMet: x.minMet }))
	};
}

/** each good's binding limit: the share of days under each limit, by period */
export function bindingSummary(w, periods) {
	const rec = w.rec, n = rec.n;
	periods = periods ?? [[1, Math.min(n, YEAR)], [YEAR, Math.min(n, 5 * YEAR)], [5 * YEAR, Math.min(n, 15 * YEAR)], [15 * YEAR, n]].filter(([a, b]) => b > a);
	const out = [];
	for (let g = 0; g < G; g++) {
		const row = { good: GOOD_IDS[g], periods: [] };
		for (const [a, b] of periods) {
			const cnt = new Map();
			for (let d = a; d < b; d++) {
				const x = rec.badge[d * G + g];
				cnt.set(x, (cnt.get(x) ?? 0) + 1);
			}
			const shares = [...cnt.entries()].sort((p, q) => q[1] - p[1]).map(([k, c]) => ({ limit: LIMIT_NAMES[k], code: k, share: c / (b - a) }));
			let ceil = 0;
			for (let d = a; d < b; d++) ceil += rec.ceil[d * G + g];
			row.periods.push({ from: a, to: b, shares, ceilingPerPerson: ceil / (b - a) });
		}
		out.push(row);
	}
	return out;
}

/** energy per person (own use, kWh a day) against the living standard, per decile, by year */
export function energyByDecile(w) {
	const rec = w.rec, n = rec.n, out = { holdings: [], aven: [], ePP: [], surplusPP: [], exportPP: [] };
	for (let y = 0; y * YEAR < n; y++) {
		const a = y * YEAR, b = Math.min(n, (y + 1) * YEAR);
		const row = (keyL, keyE) =>
			Array.from({ length: 10 }, (_, x) => {
				let l = 0, e = 0, c = 0;
				for (let d = a; d < b; d++) {
					const L = rec[keyL][d * 10 + x], E = rec[keyE][d * 10 + x];
					if (Number.isFinite(L) && Number.isFinite(E)) (l += L), (e += E), c++;
				}
				return { living: c ? l / c : NaN, kwh: c ? e / c : NaN };
			});
		out.holdings.push(row('decH', 'decHE'));
		out.aven.push(row('decA', 'decAE'));
		let ep = 0, sp = 0, xp = 0;
		for (let d = a; d < b; d++) (ep += rec.ePP[d]), (sp += rec.surplusPP[d]), (xp += rec.exportPP?.[d] ?? 0);
		out.ePP.push(ep / (b - a));
		out.surplusPP.push(sp / (b - a));
		out.exportPP.push(xp / (b - a));
	}
	return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
function series1(rec, key) {
	const out = new Array(rec.n);
	for (let d = 0; d < rec.n; d++) out[d] = rec[key][d];
	return out;
}

/** the 365-day trailing mean (NaN before the first full year) */
function trailing(s) {
	const n = s.length, out = new Array(n).fill(NaN);
	let sum = 0;
	for (let d = 0; d < n; d++) {
		sum += s[d];
		if (d >= YEAR) sum -= s[d - YEAR];
		if (d >= YEAR - 1) out[d] = sum / YEAR;
	}
	return out;
}

function yearly(rec, key, width, col, fold) {
	const out = [];
	for (let y = 0; y * YEAR < rec.n; y++) {
		let a = fold ? Infinity : 0, c = 0;
		for (let d = Math.max(1, y * YEAR); d < Math.min(rec.n, (y + 1) * YEAR); d++) {
			const v = rec[key][d * width + col];
			if (!Number.isFinite(v)) continue;
			a = fold ? fold(a, v) : a + v;
			c++;
		}
		out.push(fold ? a : c ? a / c : NaN);
	}
	return out;
}

function fitSlope(ys) {
	const n = ys.length;
	let sx = 0, sy = 0, sxx = 0, sxy = 0;
	for (let i = 0; i < n; i++) (sx += i), (sy += ys[i]), (sxx += i * i), (sxy += i * ys[i]);
	return (n * sxy - sx * sy) / Math.max(1e-12, n * sxx - sx * sx);
}


