// @ts-nocheck — plain JS, kept loose on purpose
// The numbers behind the theOS paper: every figure and every number quoted in its text is computed here, so the
// prose and the charts can never drift apart.

/** the Universal Intent Allocation: HEARTS minted for every human, a day */
export const UIA_DAY = 24;
/** the hardcoded demurrage rate, a year */
export const RATE = 0.07;
/** Law 5, every sale pays its owners: the default share of every sale that goes at once to the seller's holders */
export const DIVIDEND_SHARE = 0.2;
/** the liquidity rule (Law 4, Section 6): each HEART invested into a COOP makes 1 MIND of that COOP: 0.5 to the
 *  investor, 0.4 to the COOP's treasury, 0.1 to the city's pools (the City COOP holds their LP tokens).
 *  source: scripts/theos-e2e-sim.mjs POOL_SHARE and its header */
export const INVESTOR_SHARE = 0.5;
export const POOL_SHARE = 0.1;
export const TREASURY_SHARE = 1 - INVESTOR_SHARE - POOL_SHARE;
/** the old pool rule of the paper's earlier version: 0.05 of each HEART to the pools (a tenth of the treasury's half);
 *  the simulation keeps it as a variation (LADDER 'pool05') */
export const OLD_POOL_SHARE = 0.05;
export const SECONDS_YEAR = 31_536_000;

/** a balance after t years of continuous demurrage at rate r */
export const decay = (b, r, t) => b * Math.exp(-r * t);

/** the share of a balance lost in one day */
export const dailyLoss = (r = RATE) => 1 - Math.exp(-r / 365);

/** years until half of an idle balance is gone */
export const halfLife = (r = RATE) => Math.LN2 / r;

/** the balance every member converges to: inflow u a year against outflow r·B */
export const steadyState = (r = RATE, u = UIA_DAY * 365) => u / r;

/** dB/dt = u − rB, solved: a member who starts with b0 */
export const balanceAt = (b0, t, r = RATE, u = UIA_DAY * 365) => steadyState(r, u) + (b0 - steadyState(r, u)) * Math.exp(-r * t);

/** the share of an idle balance that a continuous rate r takes in one year: 1 − e^(−r) */
export const yearlyLoss = (r = RATE) => 1 - Math.exp(-r);

/** Law 5: a COOP's dividend yield is share × yearly sales ÷ the MIND that others hold. It
 *  stays below the melt r while yearly sales stay below this fraction of the MIND that others hold: r / share */
export const salesBound = (share = DIVIDEND_SHARE, r = RATE) => r / share;

/** the steady state when the population grows at the rate nu a year: u / (r + ν) */
export const steadyStateGrowth = (nu, r = RATE, u = UIA_DAY * 365) => u / (r + nu);

/** years until a city that starts with nothing reaches the share f of its steady state */
export const yearsToReach = (f, r = RATE) => -Math.log(1 - f) / r;

/** the rate u / m(t) at which a member's relative balance moves, in a city that started with nothing */
export const relativeRate = (t, r = RATE) => r / (1 - Math.exp(-r * t));

/** MIND a day that a founder controls when he invests all his HEARTS into his own COOP: the investor's part and the
 *  treasury's part, everything but the pools' part; an honest investor keeps only the investor's half */
export const selfDealDay = (pool = POOL_SHARE) => UIA_DAY * (1 - pool);
export const honestDay = () => UIA_DAY * INVESTOR_SHARE;

/** what is left of an equal-weight pool of n MINDs when one MIND's price falls to the share p: p^(1/n) */
export const poolAfterCrash = (p, n) => Math.pow(p, 1 / n);
/** the same tokens simply held, not in a pool */
export const heldAfterCrash = (p, n) => (n - 1 + p) / n;

/** how many exchange rates n currencies have between them */
export const pairCount = (n) => (n * (n - 1)) / 2;

/** Laborde's RTM rate from life expectancy: c = ln(ev/2) / (ev/2) */
export const rtmRate = (ev) => Math.log(ev / 2) / (ev / 2);

/** the life expectancy whose RTM rate equals r (the branch above ev/2 = e) */
export function lifeForRate(r = RATE) {
	let lo = Math.E, hi = 1000;
	for (let i = 0; i < 80; i++) {
		const m = (lo + hi) / 2;
		if (Math.log(m) / m > r) lo = m;
		else hi = m;
	}
	return 2 * lo;
}

/**
 * loss-versus-rebalancing of an equal-weight basket of n MINDs, a share of the pool a year: ½(Σ wᵢσᵢ² − wᵀΣw) with
 * wᵢ = 1/n, every MIND at volatility sigma and pairwise correlation rho, so ½σ²(1 − ρ)(1 − 1/n)
 */
export const basketLvr = (n, sigma, rho = 0) => 0.5 * sigma * sigma * (1 - rho) * (1 - 1 / n);

const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

/** Figure 4: 100 HEARTS or MINDs left idle, under three rates */
export const idleSeries = (rates = [0.03, RATE, 0.1], years = 40) =>
	rates.map((r) => ({ r, points: range(0, years, 160).map((t) => [t, decay(100, r, t)]) }));

/** Figure 5: the count of all HEARTS and MINDs per person (wallets, treasuries and pools) from three starts */
export const convergenceSeries = (r = RATE, years = 60) => {
	const star = steadyState(r);
	return [
		{ id: 'rich', label: 'Starts with 1,000,000 per person', b0: 1_000_000 },
		{ id: 'mid', label: `Starts at the 7 % steady state, ${fmt(steadyState(RATE))}`, b0: steadyState(RATE) },
		{ id: 'newborn', label: 'A new city, starts with 0', b0: 0 }
	].map((s) => ({ ...s, points: range(0, years, 240).map((t) => [t, balanceAt(s.b0, t, r)]), star }));
};

/** Figure 8: 1,000 HEARTS left idle and melting, against the yearly use of what they built, at a real rate of 0 or −1 % */
export const infraSeries = (years = 50) =>
	[
		{ id: 'idle', label: 'Idle HEARTS (−7 %)', r: RATE },
		{ id: 'loss', label: 'Project at −1 % real', r: 0.01 },
		{ id: 'flat', label: 'Project at 0 % real', r: 0 }
	].map((s) => ({ ...s, points: range(0, years, 200).map((t) => [t, decay(1000, s.r, t)]) }));

/** Figure 7: a basket's yearly LVR against how many MINDs it holds, for three kinds of MIND */
export const lvrSeries = () =>
	[
		{ id: 'calm', label: 'σ 20 %, independent', sigma: 0.2, rho: 0 },
		{ id: 'wild', label: 'σ 40 %, independent', sigma: 0.4, rho: 0 },
		{ id: 'linked', label: 'σ 40 %, correlated 0.6', sigma: 0.4, rho: 0.6 }
	].map((s) => ({ ...s, points: range(2, 8, 6).map((n) => [n, basketLvr(n, s.sigma, s.rho) * 100]) }));

/**
 * Figure 9: three cooperatives in one sector, replicator dynamics. Each COOP turns a HEART into f units of utility;
 * avens route a share k of the gap to the mean every month. Bureaucracy (B) loses efficiency while it argues, capture
 * (A) slowly turns extractive, C keeps improving. Shares of the sector's flow over ten years.
 */
export function selectionSeries(years = 10, k = 0.25, learn = 0.05) {
	const fit = {
		A: (t) => 1.0 - 0.06 * t, // capital-weighted: drifts towards extraction
		B: (t) => 0.95 - 0.02 * t, // demarchy: steady but slow
		C: (t) => 0.9 + learn * t // QV + AI executive: learns
	};
	let s = { A: 1 / 3, B: 1 / 3, C: 1 / 3 };
	const steps = years * 12;
	const out = { A: [[0, 100 / 3]], B: [[0, 100 / 3]], C: [[0, 100 / 3]] };
	for (let i = 1; i <= steps; i++) {
		const t = i / 12;
		const f = { A: fit.A(t), B: fit.B(t), C: fit.C(t) };
		const mean = s.A * f.A + s.B * f.B + s.C * f.C;
		const next = {};
		for (const c of ['A', 'B', 'C']) next[c] = Math.max(0, s[c] * (1 + k * (f[c] - mean)));
		const sum = next.A + next.B + next.C;
		for (const c of ['A', 'B', 'C']) {
			s[c] = next[c] / sum;
			out[c].push([t, s[c] * 100]);
		}
	}
	return [
		{ id: 'A', label: 'COOP A · 1 token, 1 vote', points: out.A },
		{ id: 'B', label: 'COOP B · 1 person, 1 vote', points: out.B },
		{ id: 'C', label: 'COOP C · QV + AI executive', points: out.C }
	];
}

/** Figure 9 in numbers: the year in which C first leads the sector, and C's share (%) after `at` years */
export function selectionStats(learn = 0.05, at = 5, years = 30) {
	const [A, B, C] = selectionSeries(years, 0.25, learn).map((s) => s.points);
	const i = C.findIndex(([, c], j) => j > 0 && c > A[j][1] && c > B[j][1]);
	const k = C.findIndex(([t]) => Math.abs(t - at) < 1e-9);
	return { lead: i < 0 ? null : C[i][0], share: C[k][1] };
}

// ── Fair ownership (Section 9.3) ─────────────────────────────────────────────────────────────────────────────────────

/** Germany's wealth Gini today (Bundesbank PHF 2023), the start and the capitalism baseline of Figure 11 */
export const GINI_DE = 0.72;

/** the MIND a person owns at rest: half of their own HEARTS a year, against the melt */
export const ownLevel = (r = RATE, u = UIA_DAY * 365) => u / 2 / r;

/** the Gini of everyone's holdings after t years, from a start with Gini g0 and mean m0 (no spread of returns) */
export const giniAt = (g0, t, r = RATE, m0 = ownLevel(r)) => {
	const e = Math.exp(-r * t);
	return (g0 * e * m0) / (e * m0 + ownLevel(r) * (1 - e));
};

/** years until a fortune k times the resting level is down to twice it */
export const levelYears = (k, r = RATE) => Math.log(k - 1) / r;

/** a share of the resting level reached after t years, starting from nothing (a newborn) */
export const reachedBy = (t, r = RATE) => 1 - Math.exp(-r * t);

// ln Γ(z), Lanczos
const LG = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lgamma(z) {
	if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
	z -= 1;
	let x = 0.99999999999980993;
	for (let i = 0; i < 8; i++) x += LG[i] / (z + i + 1);
	const t = z + 7.5;
	return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Proposition 2: the shape α of the resting (inverse-gamma) spread, and its Gini Γ(α−½)/(√π Γ(α)) */
export const shape = (sigma, r = RATE, mu = 0) => 1 + (2 * (r - mu)) / (sigma * sigma);
export const giniRest = (sigma, r = RATE, mu = 0) => {
	const a = shape(sigma, r, mu);
	return a <= 1 ? 1 : Math.exp(lgamma(a - 0.5) - lgamma(a)) / Math.sqrt(Math.PI);
};

// a small seeded random source, so the page and the server draw the same simulation
function rng(seed) {
	let s = seed >>> 0;
	const u = () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** the Gini index of a list of holdings: the average gap between two people, divided by twice the mean */
export const giniOf = (w) => {
	const v = [...w].sort((a, b) => a - b), n = v.length;
	let s = 0, tot = 0;
	for (let i = 0; i < n; i++) (s += (2 * (i + 1) - n - 1) * v[i]), (tot += v[i]);
	return s / (n * tot);
};

/** Figure 11: ownership inequality over 100 years, from Germany's spread today, under theOS with three spreads of returns */
export function giniSeries(years = 100, n = 1500, dt = 0.5) {
	const r = RATE, a = (UIA_DAY * 365) / 2, rest = a / r;
	const out = [{ id: 'cap', label: 'capitalism today', dash: '5 4', points: [[0, GINI_DE], [years, GINI_DE]] }];
	out.push({ id: 's0', label: 'theOS, everyone keeps the same', points: Array.from({ length: years / 2 + 1 }, (_, i) => [i * 2, giniAt(GINI_DE, i * 2)]) });
	// a lognormal start with Gini 0.72 (σ_ln = √2·Φ⁻¹(0.86)), scaled to the resting level
	const sl = Math.SQRT2 * 1.0803;
	for (const [sigma, seed] of [[0.1, 7], [0.2, 11]]) {
		const z = rng(seed);
		let w = Array.from({ length: n }, () => Math.exp(sl * z()));
		const m = w.reduce((s, x) => s + x, 0) / n;
		w = w.map((x) => (x / m) * rest);
		const pts = [[0, giniOf(w)]];
		const k = Math.exp(-0.5 * sigma * sigma * dt - r * dt), q = sigma * Math.sqrt(dt);
		for (let step = 1; step <= years / dt; step++) {
			for (let i = 0; i < n; i++) w[i] = w[i] * k * Math.exp(q * z()) + a * dt;
			if ((step * dt) % 2 === 0) pts.push([step * dt, giniOf(w)]);
		}
		out.push({ id: `s${sigma}`, label: `theOS, spread ${Math.round(sigma * 100)} %`, points: pts });
	}
	return out;
}

/** Figure 12: the resting Gini against the spread of people's returns, for three demurrage rates; with `mu`, a fourth
 *  series at the 7 % melt whose holdings also earn the lasting return mu (the dynamic world's dividends) */
export const dialSeries = (rates = [0.03, RATE, 0.1], mu = null) => {
	const line = (r, m) => Array.from({ length: 46 }, (_, i) => {
		const s = 0.05 + i * 0.01;
		return [s, giniRest(s, r, m)];
	});
	const out = rates.map((r) => ({ id: `d${r}`, label: `${Math.round(r * 100)} % a year`, points: line(r, 0) }));
	if (mu != null) out.push({ id: 'dmu', label: '7 %, with the dynamic world\'s dividends', points: line(RATE, mu) });
	return out;
};

// ── The dynamic world (Sections 6.3, 8.2, 9, 10, 12) ─────────────────────────────────────────────────────────────────
// Source: sim-dynamic.md, the output of scripts/theos-e2e-sim.mjs (run dyn:main, seed 20261012, 250 people × 60 years,
// the liquidity rule 0.5 / 0.4 / 0.1). Steady state = years 51–60. Every constant names its table; every ratio that the
// prose prints is a function below. The unit is the HEART (Section 6.3): the script values every flow at the HEART
// index of the step in which it happens and prints these values in its tables H1 to H8 ("H2" … name them); the tables
// D1 to D8 and S1 to S7 count in R, the old basket of three MINDs. R a HEART drifted from 1.15 (year 1) to 1.11
// (year 40) and 1.65 (year 60), so numbers in R and in HEARTS differ (OLD_R).

/** the simulated city. source: sim-dynamic.md header; D5 (shocks) */
export const SIM = {
	people: 250,
	years: 60,
	seed: 20261012,
	ownerOnlyEvery: 10, // every tenth person is owner-only
	ownerOnly: 25,
	goods: 9, // food, energy, housing, water, goods, care, experiences, panels, materials (D5)
	reserveMonths: 9, // treasuries keep 9 months of running costs plus planned building
	lawShare: 0.2,
	spendRate: 0.5, // people spend about half of what they hold a year (θ); D3 note
	foundingMargin: 0.3, // a rival is founded when a margin over full cost stays above 30 % …
	foundingDays: 90, // … for 90 days
	prodGrowth: 0.02, // productivity rises about 2 % a year, unevenly (an assumption)
	prodRange: [-0.005, 0.06], // each COOP's yearly rate is drawn around it, between these (scripts/theos-e2e-sim.mjs drawGrowth)
	shockDepth: [0.3, 0.5], // capacity shocks of 30–50 % …
	shockMonths: [2, 8], // … for 2–8 months
	shocks: 77, // D5
	restFrom: 51, // years 51–60: the run's rest, the years that the steady-state columns average
	runSeconds: 242, // the whole script's run time, s (sim-dynamic.md footer: "Runtime 241.5 s")
	seedCapacity: 1.15, // on day 1 the plants can make 115 % of the first needs, but nobody holds MIND
	shockAfterDays: 30, // proof check 1 looks at the 30 days after each shock …
	endAfterDays: 180 // … and the 180 days after each failure or exit
};

/** one day of basics for one person. source: scripts/theos-e2e-sim.mjs `BASIC`; proof check 1 (tolerance 98 %) */
export const BASIC_BUNDLE = { kcal: 2000, kWh: 3, m2: 20, L: 100, tolerance: 0.98 };

/** Proposition 3, checked per person on every day. source: sim-dynamic.md proof checks 1–2; D6.1; D6.2; D7 notes */
export const PROOF = {
	fromDay: 8,
	personDays: 5_473_250,
	short: 9_975, // person-days below 98 % of the basics, from day 8 (check 1 fails)
	worst: 0.0, // the worst person-day from day 8: none of one basic …
	worstYear: 17, // … in year 17, day 217
	worstDay: 217,
	// the two years with basics short (D7 notes: the share of that year's person-days, and the goods short)
	shortYears: [
		{ year: 17, share: 0.096, goods: ['water', 'food'] },
		{ year: 48, share: 0.013, goods: ['food'] }
	],
	shocks: 77,
	shockPersonDays: 2_678_250, // the 30 days after each shock
	shockWorst: 0.0,
	failures: 14,
	exits: 16,
	endedPersonDays: 1_022_000, // the 180 days after each failure or exit
	endedWorst: 0.3,
	shockShort: 9_975, // person-days short in the 30 days after the shocks (proof check 1)
	endedShort: 1_225, // … and in the 180 days after the ends
	genesis: { days: 7, worst: 0.12, short: 517, personDays: 1_750 },
	// the normal test (check 2) fails: the owner-only people were short too, when the basics ran short (D7 note: worst
	// 0 %, 1,050 person-days below 98 %). Their lowest holding from year 2 on, HEARTS, and a day of living that year,
	// HEARTS (H3 note)
	normal: { worst: 0.0, short: 1_050, lowestHolding: 3_518, lowestYear: 2, livingThen: 10.239 },
	strict: {
		firstDay: 182, lastMissYear: 46, lastMissDay: 279, lastMissRatio: 0.99, shareAfter10: 0.9773, worst: 0.45, worstYear: 41,
		// the share of owner-only person-days that dividends alone covered, by year. source: D6.2 (years 1, 5, 10) and
		// sim-dynamic.csv, dyn:main, zero_aven_strict_share_of_days (years 2, 3, 4, 6, 7, 8, 9)
		byYear: { 1: 0.614, 2: 0.989, 3: 0.883, 4: 0.861, 5: 0.777, 6: 0.721, 7: 0.94, 8: 0.999, 9: 0.999, 10: 1.0 },
		lastShortYear: 7, // the last of the early years in which they missed on more than a few days (CSV)
		lateMiss: { from: 39, to: 46 }, // after year 10, the only years with a miss (CSV: 0.96 down to 0.76; every other year 1)
		endRatio: 36.36 // the worst owner-only day in year 60: dividends ÷ basic bundle (D6.2)
	},
	bundleMax: 0.864, // the most a day's basic bundle cost in a year, HEARTS … (H2; the script's year-end "in MIND" gives 0.601 in year 3)
	bundleMaxYear: 1 // … in this year
};

/** the early year (from year `from` on; by default year 1, which holds the genesis week) in which dividends alone
 *  covered the fewest owner-only person-days, and that share. source: PROOF.strict.byYear (D6.2 and the CSV) */
export function strictWorstEarly(from = 1) {
	const e = Object.entries(PROOF.strict.byYear).filter(([y]) => +y >= from).sort((a, b) => a[1] - b[1])[0];
	return { year: +e[0], share: e[1] };
}

/** the normal test's margin: the MIND a day that a person's investing creates (half of the 24 HEARTS, worth about 12
 *  HEARTS by (7)) against the most that a day's basic bundle cost in a year of the run, HEARTS. source: H2 and H6 */
export const bundleMargin = (max = PROOF.bundleMax) => UIA_DAY / 2 / max;

/** real consumption at the prices of day 1 (the genesis prices), HEARTS a person a day, by tenth of the people.
 *  source: sim-dynamic.md D6.3, which counts in R. On day 1 every MIND trades at par, so 1 R = 1 MIND = 1 HEART, and
 *  values at day-1 prices are the same in both units */
export const DECILES = {
	years: [1, 5, 10, 20, 30, 40, 50, 60],
	d1: [12.8, 16.5, 24.8, 41.8, 73.0, 62.1, 258.7, 222.2],
	d5: [14.4, 24.7, 44.0, 163.6, 319.1, 467.1, 877.8, 1_485.0],
	d10: [18.5, 41.0, 79.1, 379.1, 789.3, 1_138.6, 2_302.7, 4_279.4],
	mean: [14.9, 26.8, 47.9, 183.1, 366.6, 521.7, 1_043.5, 1_814.2],
	gini: [0.06, 0.14, 0.17, 0.27, 0.3, 0.31, 0.29, 0.34] // the Gini index of real consumption
};

/** the same, every year (years 1–60), and the cost of a day's basic bundle in HEARTS.
 *  source: sim-dynamic.csv, run dyn:main, columns real_consumption_decile1/5/10 and basic_bundle_H (each step's cost
 *  at that step's HEART values, averaged over the year; H8) */
export const LIVING = {
	d1: [12.8, 14.8, 15.6, 16.7, 16.5, 17.5, 18.3, 18.6, 20.0, 24.8, 27.4, 29.0, 31.2, 33.1, 37.1, 39.4, 35.6, 37.2, 40.8, 41.8, 44.5, 47.9, 49.7, 54.8, 58.0, 61.6, 67.3, 71.2, 72.9, 73.0, 72.5, 70.0, 71.9, 71.7, 68.5, 64.2, 62.8, 61.8, 61.5, 62.1, 63.4, 64.0, 63.9, 64.3, 64.2, 71.4, 114.0, 194.0, 248.2, 258.7, 261.9, 268.9, 274.9, 284.4, 291.9, 278.3, 259.9, 252.3, 246.5, 222.2],
	d5: [14.4, 17.7, 19.6, 23.0, 24.7, 28.0, 32.3, 35.5, 38.7, 44.0, 50.5, 59.4, 71.8, 85.7, 115.5, 132.5, 119.0, 130.3, 151.4, 163.6, 178.9, 192.1, 206.2, 221.0, 232.0, 250.9, 273.2, 292.2, 309.7, 319.1, 333.9, 344.3, 372.9, 392.2, 403.4, 399.6, 412.2, 424.8, 437.5, 467.1, 502.9, 519.1, 518.9, 550.0, 549.8, 568.6, 628.0, 729.7, 827.5, 877.8, 956.4, 1086.0, 1242.0, 1408.4, 1482.4, 1421.0, 1418.7, 1508.2, 1578.3, 1485.0],
	d10: [18.5, 25.7, 29.3, 37.1, 41.0, 46.6, 56.3, 60.4, 66.5, 79.1, 95.7, 117.7, 150.6, 188.0, 272.5, 319.1, 285.6, 300.9, 345.4, 379.1, 415.2, 452.6, 489.0, 519.2, 570.5, 614.1, 661.1, 711.7, 754.7, 789.3, 823.6, 857.1, 924.9, 983.3, 1025.1, 1045.7, 1057.6, 1069.6, 1084.1, 1138.6, 1216.3, 1258.9, 1278.3, 1340.3, 1330.0, 1432.1, 1764.6, 2133.5, 2332.8, 2302.7, 2315.6, 2534.5, 2895.4, 3358.7, 3766.2, 3889.2, 3948.9, 4217.6, 4474.6, 4279.4],
	bundle: [0.8637, 0.4933, 0.6023, 0.4664, 0.5574, 0.5631, 0.3919, 0.3527, 0.3025, 0.2016, 0.1955, 0.1912, 0.1876, 0.1838, 0.1751, 0.1725, 0.4182, 0.54, 0.1863, 0.2421, 0.167, 0.2064, 0.1586, 0.1521, 0.1398, 0.1346, 0.1265, 0.1211, 0.1319, 0.1166, 0.1154, 0.115, 0.1177, 0.1075, 0.1104, 0.1168, 0.1206, 0.1243, 0.126, 0.1216, 0.1144, 0.1143, 0.11, 0.0877, 0.0849, 0.0828, 0.0801, 0.0669, 0.0653, 0.0596, 0.0556, 0.0497, 0.0438, 0.0386, 0.0361, 0.0368, 0.0359, 0.0343, 0.0331, 0.0341]
};

/** the owner-only people (every tenth person: their Avens deliver nothing, and they start with nothing).
 *  source: H3 note (holdings, HEARTS), D6.2 (the group's average of dividends ÷ basic bundle) and its note (the mix at
 *  the end, and each MIND's dividend yield in year 60) */
export const OWNER_ONLY = {
	count: 25,
	holding40: 8_524, // mean holding, HEARTS, year 40 (H3 note)
	holding60: 10_361, // year 60
	strictAvg40: 7.71, // dividends ÷ basic bundle, the group's average, year 40
	strictAvg60: 75.8, // year 60
	mix: { EXP6: { share: 0.35, yield: 0.219 }, CITY: { share: 0.27, yield: 0.0 }, PANEL4: { share: 0.18, yield: 0.0 } }
};

/** the dynamic world at rest (years 51–60), against the earlier static world. source: sim-dynamic.md D1, D8, and for
 *  every value in HEARTS H2. mu and sigma are the rest means of each year's mean return and its spread across people,
 *  in HEARTS (H2). In R the script printed mu 11.9 % (D1); the gap is R's drift (Section 6.3) */
export const DYN = {
	dayLiving: { y1: 4.5, y10: 51.4, y60: 107.4 }, // a day of living, HEARTS (H2)
	income: 130.9, // HEARTS a person a day (H2)
	spent: 0.86, // share of income spent (bought from COOPs) (D1)
	walletMelt: 0.12, // share of income that melts in wallets (D1)
	people: 0.712, // share of all MIND by HEART value (H2)
	treasuries: 0.193,
	pools: 0.095,
	yield: 0.1, // dividend yield a year, all MIND by value (D1, H2)
	mu: 0.0944, // lasting return in HEARTS: dividends plus price change, at rest (H2: 9.44 %; in R 11.93 %)
	muRun: 0.0935, // the same over the whole run, years 2–60 (H2: 9.35 %; in R 9.45 %)
	muYearsAbove: { years: 52, of: 59 }, // years 2–60 in which it was at or above the 7 % melt (H2; in R 45 of 59)
	priceChange: -0.0067, // the price part of mu at rest, in HEARTS (H2: −0.67 %; in R +1.76 %)
	sigma: 0.0541, // its spread across people (H2: 5.41 %; in R 4.95 %)
	gini2: 1.0, // Proposition 2's Gini from mu and sigma (H2): 1 when mu is at or above the melt
	giniOwned: 0.31, // Gini of what people hold, years 51–60 (D1; H2: 0.314)
	giniOwnedBy: { y20: 0.29, y40: 0.32, y50: 0.29, y60: 0.35 }, // … by year (D3; H8)
	giniTrend: 0.006, // its least-squares trend over years 41–60, a 10 years (H2, H8: +0.006)
	pricesMin: 0.14, // MIND values at rest, HEARTS: lowest … (H2)
	pricesMax: 1.66, // … highest
	sdLog: 0.7,
	mindsAlive: 23, // (D1)
	outputPerPlant: 9.42, // output per unit of plant at the end, sales-weighted (D1); 1 on day 1
	failures: 14, // whole run (D1, D5)
	exits: 16,
	foundings: 25,
	money: 115_698, // MIND count a person (D1, D8)
	bundleChange: -0.0544, // the basic bundle's yearly change in HEARTS, years 51–60 (H2; in R −1.9 %, D8)
	coopDaysShort: 3_892, // COOP-days short of working capital in 60 years (D8)
	coopDaysShortAfter10: 3_647, // … of them after year 10 (D8)
	topBottom: 2.5 // mean holding: top half of Aven pay ÷ bottom half (D8)
};

/** the earlier static world: one COOP per good (two for food), fixed tastes, prices capped at twice full cost, short
 *  reserves, no growth. source: sim-dynamic.md D1 (static column), S1, S5, S6.2, S6.3, S6.5, S6.6, S7, and in HEARTS
 *  H2 (static column) and H7; land: model.md §7.4 */
export const STATIC = {
	dayLiving: { y1: 11.3, y60: 11.9 }, // HEARTS (H2)
	income: 33.3, // HEARTS a person a day (H2)
	spent: 0.36,
	walletMelt: 0.63,
	people: 0.891, // by HEART value (H2)
	treasuries: 0.009,
	pools: 0.1,
	yield: 0.008,
	mu: 0.0057, // HEARTS (H2: 0.57 %)
	giniOwned: 0.34,
	pricesMin: 0.98, // HEARTS (H2)
	pricesMax: 1.04,
	mindsAlive: 9,
	failures: 0,
	exits: 0,
	foundings: 0,
	topBottom: 2.7, // (S1)
	keepSurplus: 0.29, // people's share of MIND when treasuries keep their surplus (S1)
	routing: 0.0039, // routing cost of a payment at rest … (S1)
	routingFees: 0.0035, // … of it pool fees
	germany: [0.72, 0.45, 0.36], // Gini: made as unequal as Germany, then +10 and +20 years (S6.5)
	avenEven: 0.05, // Gini owned with all Avens alike (S5)
	avenDouble: 0.59, // with Avens that differ twice as much (S5)
	geo: { geo: 1.62, solar: 0.25 }, // 1 MIND after 20 years, with dividends, after the melt, HEARTS (S6.6; H7: 1.62 and 0.25)
	foodFailure: { withRule: 0.09, without: 1.0 }, // food shortfall the year after the main food COOP fails (S6.2)
	ring: { hearts: 0.0365, people: 0.016, income: 1.6, wealth: 1.4, years: 10 }, // a founder ring: share of HEARTS and of people, income and wealth (after 10 years) against others (S6.3)
	coldStart: { day1: 0.944, days1to30: 0.14, year1: 0.011 }, // shortfall without the bootstrap (S1)
	land: { private: 0.5, city: 0.29 }, // Gini after 40 years, private land against all land in the City COOP (model.md §7.4)
	coopDaysShort: 40 // COOP-days short of working capital in 60 years (S1)
};

/** Proposition 2 checked by simulating the process: an SDE run of 4,000 people against (11) at σ = 0.2.
 *  source: research/e2e/model.md, verification table ("SDE run (4,000 people): 0.287 against 0.291") */
export const SDE_CHECK = { sim: 0.287, formula: 0.291 };

/** treasuries at rest. source: sim-dynamic.md D4 (reserves at the end in days of running costs) and H3 note
 *  (HEARTS a person a year, booked as D4 books them) */
export const RESERVES = {
	months: 9,
	days: 270,
	minDays: 62,
	medianDays: 445,
	inflow: 45_176,
	items: 32_931,
	proposals: 1_713,
	dividends: 8_247
};
/** a share of all that flows into the treasuries at rest, as D4 books it (sales gross): 'items', 'proposals' or 'dividends' */
export const reserveShare = (k) => RESERVES[k] / RESERVES.inflow;
/** a share of what the treasury itself keeps of its inflow: sales after the Law 5 share, which goes at once from each
 *  sale to the holders and never passes through the treasury. 'items' or 'proposals'. source: D4 */
export const treasuryShare = (k) => RESERVES[k] / (RESERVES.inflow - RESERVES.dividends);

/** one run per variation of the main run. checks = [no one starves, no one has to work (normal), everyone gains];
 *  short = the basics short in the worst years; mu = the lasting return at rest, HEARTS (H6); sigma its spread (H6);
 *  bundleMax = the most a day's basic bundle cost in a year, HEARTS (H6); shortYears / worstYear / worstYearShare =
 *  the years with basics short, and the worst of them (D7 notes). source: sim-dynamic.md D7 (both tables and the
 *  notes) and H6 (mu, sigma, bundleMax) */
export const LADDER = [
	{ id: 'main', bundleMax: 0.864, label: 'Main: Law 5 at 20 %, reserves 9 months', share: 0.2, months: 9, checks: [0, 0, 0], shortfall: 0.0018, yield: 0.1, mu: 0.0944, sigma: 0.0541, failures: 14, exits: 16, foundings: 25, short: ['food', 'water'], broke: 'Water and food ran short in year 17, food in year 48; all 14 failures were food COOPs' },
	// crash: the run fell in years 38–40 (μ −3.4 % in year 39, in HEARTS) and boomed again, so its μ at rest is not a
	// resting state (sim-dynamic.csv, dyn:law35, mean_return_H)
	{ id: 'law35', bundleMax: 1.038, label: 'Law 5 at 35 %', share: 0.35, checks: [0, 0, 0], shortfall: 0.0003, yield: 0.173, mu: 0.1199, sigma: 0.0888, failures: 7, exits: 33, foundings: 54, short: ['food'], crash: { from: 38, to: 40, low: -0.0344 }, broke: 'Food ran short in year 31; the run fell in years 38 to 40 and boomed again' },
	{ id: 'law50', bundleMax: 2.031, label: 'Law 5 at 50 %', share: 0.5, checks: [0, 0, 0], strict: 1, shortfall: 0.0045, yield: 0.249, mu: 0.1446, sigma: 0.1258, failures: 18, exits: 43, foundings: 65, short: ['food', 'energy', 'housing', 'water'], broke: 'Nine COOPs failed in year 34; every basic ran short in year 38' },
	{ id: 'res6', bundleMax: 0.877, label: 'Reserves 6 months', months: 6, checks: [0, 0, 0], shortfall: 0.0006, yield: 0.1, mu: 0.0622, sigma: 0.0719, failures: 4, exits: 15, foundings: 22, short: ['food'], foodYears: [2, 34], broke: 'Food ran short in years 2 and 34' },
	{ id: 'res12', bundleMax: 1.35, label: 'Reserves 12 months', months: 12, checks: [1, 1, 1], shortfall: 0, yield: 0.1, mu: 0.058, sigma: 0.0603, failures: 9, exits: 13, foundings: 20, short: [], broke: 'Nothing in checks 1 to 3. Dividends alone missed on 5.7 % of owner-only days after year 10' },
	{ id: 'prod0', bundleMax: 7.268, shortYears: 4, worstYear: 29, worstYearShare: 0.212, label: 'No productivity growth', checks: [0, 0, 0], shortfall: 0.0076, yield: 0.1, mu: 0.1047, sigma: 0.0633, failures: 9, exits: 24, foundings: 29, short: ['food', 'energy', 'housing'], broke: 'Basics ran short in 4 years, food worst; the poorest tenth stalled' },
	// plant: output per unit of plant in year 60 (sim-dynamic.csv, dyn:even, mean_productivity)
	{ id: 'even', bundleMax: 0.863, label: 'Even growth, 2 % for every COOP', checks: [1, 1, 0], shortfall: 0, yield: 0.1, mu: 0.1079, sigma: 0.0497, failures: 0, exits: 12, foundings: 19, short: [], plant: 3.56, broke: 'The poorest tenth fell from year 30 to year 40, and from year 50 to year 60' },
	{ id: 'wide', bundleMax: 0.87, label: 'Growth twice as uneven', checks: [1, 1, 0], shortfall: 0, yield: 0.1, mu: 0.0627, sigma: 0.049, failures: 0, exits: 13, foundings: 19, short: [], broke: 'The poorest person fell from year 20 to year 30' },
	{ id: 'wants', bundleMax: 0.918, label: 'Wants do not grow', checks: [1, 1, 0], shortfall: 0, yield: 0.001, mu: 0.0006, sigma: 0.0004, failures: 1, exits: 9, foundings: 14, short: [], spent: 0.05, broke: 'People spent 5 % of income; dividends fell to almost nothing, and consumption stopped rising' },
	{ id: 'aven', bundleMax: 2.196, label: 'Fixed Aven capacity', checks: [0, 0, 0], shortfall: 0.0023, yield: 0.1, mu: 0.0966, sigma: 0.0486, failures: 14, exits: 9, foundings: 14, short: ['food'], worst: 0.13, broke: 'Food ran short in 8 years; the worst person-day had 13 %' },
	// ownerWorst: the worst owner-only person-day; poorOwner: the poorest owner-only person's real consumption, years 10 and 20
	{ id: 'pop', bundleMax: 0.895, label: 'Population grows 2 % a year (40 years)', checks: [0, 0, 0], shortfall: 0.0005, yield: 0.1, mu: 0.0803, sigma: 0.0798, failures: 3, exits: 15, foundings: 20, short: ['food', 'energy', 'housing', 'water'], ownerWorst: 0.64, poorOwner: [10.9, 6.0], broke: 'Newcomers went short in their first weeks, and owner-only people too (worst 64 %)' },
	// the old pool rule (0.05 of each HEART to the pools, a tenth of the treasury's half): the main run of the paper's
	// earlier version, run again; H6 gives μ 7.50 % and σ 6.63 %, as before
	{ id: 'pool05', bundleMax: 0.862, label: 'The old pool rule: 0.05 of each HEART to the pools', pool: 0.05, checks: [1, 1, 1], shortfall: 0, yield: 0.099, mu: 0.075, sigma: 0.0663, failures: 1, exits: 21, foundings: 29, short: [], broke: 'Nothing in checks 1 to 3. Dividends alone missed often in years 1 to 8' }
];
/** strict: 1 marks the one run whose strict test passed (D7: "(✓)") */
/** the variations, without the main run */
export const variations = () => LADDER.filter((v) => v.id !== 'main');
/** how many variations reached a lasting return μ at or above the melt */
export const variationsMuAbove = (r = RATE) => variations().filter((v) => v.mu >= r).length;
/** how many variations ran short of food at all, and how many of nothing but food */
export const foodShort = () => variations().filter((v) => v.short.includes('food')).length;
export const foodOnlyShort = () => variations().filter((v) => v.short.length === 1 && v.short[0] === 'food').length;
/** how many variations left someone short of basics (check 1 failed) */
export const starveFail = () => variations().filter((v) => !v.checks[0]).length;
/** how many runs passed all three checks, and their labels */
export const allPass = () => LADDER.filter((v) => v.checks.every(Boolean)).length;
export const passing = () => LADDER.filter((v) => v.checks.every(Boolean));
/** true when every run whose owner-only people went short (check 2) also had the basics run short (check 1) */
export const ownerShortOnlyWithBasics = () => LADDER.every((v) => v.checks[1] || !v.checks[0]);
/** the variation with this id */
export const variation = (id) => LADDER.find((v) => v.id === id);

/** the dynamic main on eight seeds (20261012–20261019): the same run, eight histories. new = the liquidity rule
 *  0.5 / 0.4 / 0.1; old = the old pool rule (0.05 to the pools). mu in HEARTS at rest; margin = the melt less mu, the
 *  smallest of the eight and its seed; below = seeds with mu below the melt; pass = seeds on which all three checks of
 *  Proposition 3 pass; gini = the measured Gini of holdings in HEARTS in year 60, lowest and highest; rising = seeds
 *  whose Gini still rose over years 41–60. source: scripts/theos-e2e-sim.mjs --seeds 20261012-20261019 (new) and the
 *  same with --set poolShare=0.05 (old); research/e2e/pool-10 seeds-new.md and seeds-old.md */
export const SEEDS = {
	from: 20261012,
	to: 20261019,
	n: 8,
	new: { muMin: 0.0661, muMax: 0.1008, muMedian: 0.0756, below: 2, marginMin: -0.0308, marginMinSeed: 20261016, pass: 3, check1: 4, check2: 4, check3: 3, gini: [0.27, 0.39], rising: 7 },
	old: { muMin: 0.0626, muMax: 0.0963, muMedian: 0.0692, below: 5, marginMin: -0.0263, marginMinSeed: 20261016, pass: 2, check1: 2, check2: 2, check3: 6, gini: [0.31, 0.41], rising: 8 }
};

/** the melt tests (Section 9.3): the dynamic main on the same eight seeds, with one lever changed at a time. new: under
 *  the liquidity rule of this paper, from scripts/theos-e2e-sim.mjs --seeds 20261012-20261019 with --set turnDiv=0.1,
 *  --set turnDiv=0.15, --set capDays=365, --melt 0.08 or --melt 0.09 (research/e2e/pool-10, melt-*.md); old: the same
 *  levers under the old pool rule, from fixes.md (Appendix G); the script with --set poolShare=0.05 reruns each of
 *  these rows and gives the same numbers (research/e2e/pool-10, melt-old-*.md). melt = the run's melt; mu = μ at rest in HEARTS, lowest and highest of the eight seeds; below =
 *  seeds with μ below that run's melt; marginMin = the smallest margin (melt − μ); pass = seeds on which all three
 *  checks of Proposition 3 pass; yieldMid = the median dividend yield */
export const MELT_TESTS = {
	law10: { share: 0.1, melt: 0.07, new: { mu: [0.0312, 0.0482], below: 8, marginMin: 0.0218, pass: 3, yieldMid: 0.05 }, old: { mu: [0.0343, 0.0438], below: 8, marginMin: 0.0262, pass: 4, yieldMid: 0.05 } },
	law15: { share: 0.15, melt: 0.07, new: { mu: [0.044, 0.0688], below: 8, marginMin: 0.0012, pass: 2, yieldMid: 0.075 }, old: { mu: [0.052, 0.0793], below: 6, marginMin: -0.0093, pass: 2, yieldMid: 0.075 } },
	res12: { months: 12, melt: 0.07, new: { mu: [0.058, 0.102], below: 5, marginMin: -0.032, pass: 4 }, old: { mu: [0.0559, 0.0886], below: 4, marginMin: -0.0186, pass: 0 } },
	melt8: { melt: 0.08, new: { mu: [0.0598, 0.0979], below: 7, marginMin: -0.0179, pass: 2 }, old: { mu: [0.0654, 0.0786], below: 8, marginMin: 0.0014, pass: 1 } },
	melt9: { melt: 0.09, new: { mu: [0.0595, 0.0957], below: 7, marginMin: -0.0057, pass: 0 }, old: { mu: [0.0631, 0.0895], below: 8, marginMin: 0.0005, pass: 0 } }
};

/** values in HEARTS and in days of living: a day of living, a day's basic bundle, and the lowest and highest MIND value
 *  that year. source: sim-dynamic.md H3 */
export const PRICES_BY_YEAR = {
	1: { living: 4.54, bundle: 0.864, vMin: 0.35, vMax: 1.98 },
	10: { living: 51.35, bundle: 0.2016, vMin: 0.07, vMax: 3.12 },
	30: { living: 96.54, bundle: 0.1166, vMin: 0.13, vMax: 1.37 },
	40: { living: 110.86, bundle: 0.1216, vMin: 0.28, vMax: 1.38 },
	60: { living: 107.42, bundle: 0.0341, vMin: 0.01, vMax: 1.48 }
};
/** a day's basic bundle as a share of a day of living, in year y */
export const bundleShareOfLiving = (y) => PRICES_BY_YEAR[y].bundle / PRICES_BY_YEAR[y].living;

/** the retired yardstick R (the geometric mean of the prices of SOLAR, HABITAT and CITY), in R a HEART: how far it
 *  drifted against the average MIND, and the lasting return at rest that the script prints in R (D1, D7).
 *  source: sim-dynamic.md H1, H2 and H6 ("R a HEART at rest", "μ, R") */
export const OLD_R = { y1: 1.15, y40: 1.11, y60: 1.65, rest: 1.67, mainMu: 0.1193 };

/** competition by good: the largest seller's share of what was made in year 1 and year 60 (null: none made that year),
 *  and the COOPs founded and ended over 60 years (a successor that leases a failed plant is not counted as founded).
 *  source: sim-dynamic.md D5 (tables and lists) */
export const COMPETITION = [
	{ good: 'food', y1: 0.68, y60: 1.0, founded: 4, ended: 16 },
	{ good: 'energy', y1: 0.62, y60: 1.0, founded: 2, ended: 2 },
	{ good: 'housing', y1: 0.64, y60: 1.0, founded: 1, ended: 1 },
	{ good: 'water', y1: 1.0, y60: 1.0, founded: 0, ended: 0 },
	{ good: 'goods', y1: 0.64, y60: 0.85, founded: 2, ended: 1 },
	{ good: 'care', y1: 0.52, y60: 0.92, founded: 2, ended: 2 },
	{ good: 'experiences', y1: 0.56, y60: 0.75, founded: 7, ended: 6 },
	{ good: 'panels', y1: 1.0, y60: 0.5, founded: 3, ended: 0 },
	{ good: 'materials', y1: 1.0, y60: 0.97, founded: 4, ended: 2 }
];
/** the goods (water aside) that one COOP made alone in year 60 */
export const soleMakers = () => COMPETITION.filter((g) => g.good !== 'water' && g.y60 === 1).map((g) => g.good);
/** the failures: every one was a food COOP. FOOD3, founded in year 7, failed first, in year 11; the City COOP leased its
 *  plant to one successor after another, and most of them failed too; FOOD4's line went the same way. source: D5 */
export const FAILURE = { coop: 'FOOD3', good: 'food', year: 11, count: 14, food: 14 };
/** the energy COOPs founded later, each of which exited within this many years (D5: y5→y8, y17→y20) */
export const ENERGY_ENTRANTS = { count: 2, years: 3 };

/** every MIND over its life. source: sim-dynamic.md D2, second table, valued in HEARTS in H5 */
export const MIND_RETURNS = { minds: 52, ended: 30, withThreeYears: 44, aboveMelt: 15, aboveMeltEnded: 9, arts: { compounded: 0.233, years: 59 } }; // in HEARTS (H5)

/** the round trip at rest (years 51–60), in HEARTS a person a day. Places: people's wallets, COOP treasuries, pools;
 *  each with what flows in and out, what price moves did to what it holds, and the change of what it holds. Flows are
 *  valued at the HEART values of their step; price moves are what the change of HEART values from one step to the next
 *  did to what each place holds. source: sim-dynamic.md H4 (the same books as D8, which counts in R).
 *  No human labour is paid: every human's Aven delivers the work items. */
// net and rest: H4's own "in − out" and "not explained" columns, printed as H4 prints them (the sums of the rounded
// flows above can differ from them by 0.01). Liquidations were 0.00 at rest and are left out. own: the investor's part
// (people) or the treasury's part (treasuries) of each HEART invested; pool: the pools' part
export const ROUND_TRIP = {
	people: { in: { own: 13.44, items: 90.21, proposals: 4.7, dividends: 22.59 }, out: { buying: 112.93, melt: 15.86, retired: 0.37 }, net: 1.78, moves: -3.06, change: -1.34, rest: -0.06 },
	treasuries: { in: { own: 10.75, sales: 112.93 }, out: { dividends: 22.59, items: 90.21, proposals: 4.7, melt: 4.22, retired: 0.01 }, net: 1.95, moves: -0.43, change: 1.54, rest: 0.01 },
	pools: { in: { pool: 2.69, routing: 0.04 }, out: { melt: 2.12, retired: 0.03 }, net: 0.58, moves: -0.91, change: -0.33, rest: -0.01 },
	issuedMind: 24.0, // MIND a person a day (24 HEARTS converted); in HEARTS 26.88 (H4)
	meltedMind: 22.21, // MIND a person a day; in HEARTS the same 22.21, because by (7) all MIND is worth as many HEARTS as there are MINDs
	retiredMind: 1.94, // MIND that left with COOPs that ended (D8)
	stockGrowth: -0.14, // the MIND stock changed by this much a person a day (D8): it shrank a little
	unexplainedMax: 0.00216, // the largest unexplained rest, as a share of a place's inflow (H4)
	between: { sales: 0.02, rent: 0.05 } // flows between treasuries, which cancel out (H4)
};
/** what new MIND, the melt and the MIND retired with COOPs that ended leave over, as a share of new MIND (D8: −0.6 %) */
export const issueGap = (rt = ROUND_TRIP) => (rt.issuedMind - rt.meltedMind - rt.retiredMind) / rt.issuedMind;

/** the same in the earlier static world, in HEARTS a person a day. source: sim-dynamic.md H7 (S7 in R) */
export const ROUND_TRIP_STATIC = {
	people: { in: { own: 12.0, items: 3.9, proposals: 14.98, dividends: 2.43 }, out: { buying: 11.92, melt: 20.91 } },
	treasuries: { in: { own: 9.6, sales: 11.92 }, out: { dividends: 2.43, items: 3.9, proposals: 14.98, melt: 0.22 } },
	pools: { in: { pool: 2.4 }, out: { melt: 2.35 } },
	issued: 24.0,
	melted: 23.48,
	money: 122_603 // MIND a person (S7)
};

/** the mean cost of a day's basic bundle at rest, HEARTS, over the same years as H4. source: sim-dynamic.md H3
 *  note ("a day's basic bundle at rest") */
export const BUNDLE_REST = 0.0398;

/** what the treasuries keep of people's purchases: sales less the Law 5 share, which each sale pays at once to the
 *  holders (D8 books sales gross and the dividends as a treasury outflow; this is the same flow, netted at the sale) */
export const salesAfterLaw5 = (rt = ROUND_TRIP) => rt.treasuries.in.sales - rt.treasuries.out.dividends;

/** the total of a set of flows */
export const flowSum = (flows) => Object.values(flows).reduce((s, v) => s + v, 0);

/** what flows in, less what flows out, of one place in the round trip */
export const flowNet = (place) => flowSum(place.in) - flowSum(place.out);

/** what flows and price moves do not explain: in − out + price moves − change (must stay near zero) */
export const flowCheck = (place) => flowNet(place) + (place.moves || 0) - (place.change || 0);

/** one source of a person's income, as a share of all that flows into people's wallets */
export const incomeShare = (k, rt = ROUND_TRIP) => rt.people.in[k] / flowSum(rt.people.in);

/** a flow as a share of a person's income (people's inflow), for Figure 13's arrows */
export const ofIncome = (v, rt = ROUND_TRIP) => v / flowSum(rt.people.in);

/** the share of income that people spend if they spend the share θ of what they hold a year: θ / (θ + r) */
export const spendShare = (theta = SIM.spendRate, r = RATE) => theta / (theta + r);

/** the normal test, as a property of what a person owns: years until a holding W (HEARTS) runs out if it alone pays
 *  the basic bundle p (HEARTS a day), with no dividends, no new ownership and the melt r: (1/r)·ln(1 + r·W / (365·p)).
 *  Default: the lowest owner-only holding (year 2) against that year's basic bundle (LIVING.bundle) */
export const holdingCoverYears = (W = PROOF.normal.lowestHolding, p = LIVING.bundle[PROOF.normal.lowestYear - 1], r = RATE) =>
	Math.log(1 + (r * W) / (365 * p)) / r;
/** the lowest owner-only holding in days of living of its year (H3: a day of living in year 2) */
export const holdingLivingDays = () => PROOF.normal.lowestHolding / PROOF.normal.livingThen;

/** the strict test's threshold at rest: the share of the mean holding at which Law 5 dividends alone pay for a day's
 *  basics, p_b / (λ · Y), Y = what people buy from COOPs a day */
export const strictThreshold = () => BUNDLE_REST / (DIVIDEND_SHARE * ROUND_TRIP.people.out.buying);

/** the dividend yield of the owner-only people's holdings in year 60: dividends a year ÷ holding */
export const ownerOnlyYield = () => (OWNER_ONLY.strictAvg60 * PRICES_BY_YEAR[60].bundle * 365) / OWNER_ONLY.holding60;

/** the yearly sales, as a share of the MIND that others hold, that a dividend yield implies: yield ÷ Law 5's share */
export const impliedSales = (y = DYN.yield, share = DIVIDEND_SHARE) => y / share;

/** years until a spread holding that is not spent halves, when it earns the lasting return mu: ln 2 / (r − μ);
 *  Infinity when μ is at or above the melt (then it does not halve at all) */
export const netHalfLife = (mu = DYN.mu, r = RATE) => (mu >= r ? Infinity : Math.LN2 / (r - mu));

/** how far the lasting return stays below the melt, in points (negative: above it) */
export const meltMargin = (mu = DYN.mu, r = RATE) => (r - mu) * 100;

/** what Eq. (3) predicts for the MIND stock's growth at the simulated level: (u − r·m) / 365, MIND a person a day */
export const stockGrowthDay = (m = DYN.money, r = RATE, u = UIA_DAY * 365) => (u - r * m) / 365;

/** how far the simulated money per person stays below u/r */
export const moneyGap = () => DYN.money / steadyState() - 1;

/** the owner-only people's dividends as a share of what flowed in to them, in year y (40 or 60): dividends (D6.2
 *  average × that year's bundle, HEARTS) against dividends plus the 12 MIND a day that their investing creates, at
 *  1 HEART each, the average MIND (7). An estimate: the MIND they invest in need not trade at the average */
export const ownerOnlyDividendShare = (y) => {
	const div = OWNER_ONLY[`strictAvg${y}`] * PRICES_BY_YEAR[y].bundle;
	return div / (div + UIA_DAY / 2);
};

/** how many times a tenth's real consumption grew: 'd1', 'd5', 'd10' or 'mean', from year y0 to year y1 */
export const growth = (key, y0 = 1, y1 = 60) => DECILES[key][DECILES.years.indexOf(y1)] / DECILES[key][DECILES.years.indexOf(y0)];

/** the same as a yearly rate, compounded: growth(key)^(1/(y1 − y0)) − 1 */
export const growthRate = (key, y0 = 1, y1 = 60) => Math.pow(growth(key, y0, y1), 1 / (y1 - y0)) - 1;
/** output per unit of plant as a yearly rate (1 on day 1, DYN.outputPerPlant in year 60) */
export const plantGrowthRate = (end = DYN.outputPerPlant, years = SIM.years - 1) => Math.pow(end, 1 / years) - 1;

/** the ten-year windows in which the poorest tenth fell: [from, to] pairs over the yearly series (50 windows in 60 years) */
export const tenYearFalls = (s = LIVING.d1) => s.flatMap((v, i) => (i + 10 < s.length && s[i + 10] < v ? [[i + 1, i + 11]] : []));

/** the poorest tenth's deepest fall: its peak, the low after it, and the fall as a share */
export function poorestDip(s = LIVING.d1) {
	let best = { from: 0, to: 0, fall: 0 };
	for (let i = 0; i < s.length; i++)
		for (let j = i + 1; j < s.length; j++) if (s[j] / s[i] - 1 < best.fall) best = { from: i + 1, to: j + 1, fall: s[j] / s[i] - 1 };
	return { ...best, high: s[best.from - 1], low: s[best.to - 1] };
}

/** a value of a yearly LIVING series in year y */
export const livingAt = (key, y) => LIVING[key][y - 1];

/** Figure 14: real consumption a day of the poorest, the middle and the richest tenth, every year */
export const livingSeries = () =>
	[
		{ id: 'd10', label: 'Richest tenth' },
		{ id: 'd5', label: 'Middle tenth' },
		{ id: 'd1', label: 'Poorest tenth' }
	].map((s) => ({ ...s, points: LIVING[s.id].map((v, i) => [i + 1, v]) }));

// ── Energy and physical limits (Sections 8.2, 12.5, Appendix H) ─────────────────────────────────────────────────────
// Source: world-model research §5.1–5.5 (design numbers for the test city; "estimate" marks a number nobody has checked).

/** source: world-model research §5.2 (a full village), §5.3 (recipes and floors), §5.5 (what binds first) */
export const ENERGY = {
	village: { people: 1_488, el: 35.8, heat: 104, useEl: 12, useHeat: 6 }, // GWh a year (§5.2)
	smilGJ: [50, 70], // Smil's plateau, GJ of primary energy a person a year (§5.1)
	dome: { people: 250, harvest: 1.3, use: 0.39, build: 3.0, decHarvest: 27, decUse: 33 }, // GWh a year; December MWh, use at least (§5.5)
	pvPayback: 1.1, // years, Northern Europe (§5.2, Fraunhofer ISE)
	pvMunich: 1, // MWh a year per kWp in Munich (§5.3)
	recipes: { glulam: 0.5, steel: 3.6, glass: 1.3, clay: 0.5, panels: 2.0 }, // MWh a tonne (§5.3)
	floors: { sq: 0.33, photosynthesis: 0.046, photosynthesisC4: 0.06, steelMin: 2.9, glassMin: 0.69 }, // one single-junction cell; C3 and C4 plants (Zhu et al.); steel from ore, the practical minimum on a fuel basis, MWh a tonne (§5.3)
	forest: { y1: 0.1, fullYear: 10, kgM2: 0.74 }, // food forest: share of food in year 1, full in year 10, kg/m² a year (§5.3)
	water: { supply: 140, need: 100, dry: 0.3, dryYear: 0.98 }, // L a bed a day; a year 30 % drier gives 0.98 of need (§5.3)
	wood: { t: 150, ha: 10, tPerBed: 6, beds: 25 }, // t a year from 10 ha; t a bed; beds a year (§5.5)
	compute: [9, 37], // kWh a person a year, estimate (§5.3)
	geo: { el: 3.4, heat: 12.6, carnot: 0.36, eroiHeat: [15, 35] }, // MW a plant; Carnot limit; EROI with heat, estimate (§5.2)
	foodStockDays: 5 // days of food in hand (§2.2, §4.4)
};

/** the euro border (Section 12.4): the euros that the test village of about 1,500 people needs from outside, and the
 *  years within which its exports do not repay them. source: maiaCITY's euro plan for the test village (Samuel Andert,
 *  2026-10-13: the City COOP is the euro bank at the border; about €600 M; not repaid in 60 years) */
export const EURO_BORDER = { people: 1_500, euros: 600e6, years: 60 };

/** average power a person, kW, from GWh a year for n people */
export const kwPerPerson = (gwh, n = ENERGY.village.people) => (gwh * 1e6) / 8_760 / n;

/** GJ a year as average power, kW */
export const gjToKw = (gj) => (gj * 1e9) / (365.25 * 86_400) / 1_000;

/** years until a dome's yearly surplus of energy builds the materials of one more dome. Computed from §5.5's 1.3 and
 *  0.39 GWh, it gives 3.3; §5.5 prints "about 3.4 years" because it rounds the surplus to ~0.9 GWh */
export const domeYears = (d = ENERGY.dome) => d.build / (d.harvest - d.use);
/** beds a year that the energy surplus alone could build (a dome a domeYears()), against ENERGY.wood.beds from wood */
export const bedsFromEnergy = (d = ENERGY.dome) => d.people / domeYears(d);
/** December's energy deficit, MWh: at least the use, less the harvest */
export const decemberGap = (d = ENERGY.dome) => d.decUse - d.decHarvest;

export const fmt = (n, d = 0) => n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
