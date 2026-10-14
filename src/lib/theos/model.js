// @ts-nocheck — plain JS, kept loose on purpose
// The numbers behind the theOS paper: every figure and every number quoted in its text is computed here, so the
// prose and the charts can never drift apart.

/** the Universal Intent Allocation: HEARTS minted for every human, a day */
export const UIA_DAY = 24;
/** the hardcoded demurrage rate, a year */
export const RATE = 0.07;
/** Law 5, every sale pays its owners: the share of every sale, the same for every COOP, that goes at once to the
 *  seller's holders. Fixed like every law; it changes only by the rule-change path (Appendix F). */
export const DIVIDEND_SHARE = 0.2;
/** Law 4 (Section 4): each HEART invested into a COOP converts into 1 MIND of that COOP: 0.5 to the investor, 0.4 to
 *  the COOP's treasury, 0.1 (the pools' part) to the city's pools, whose LP tokens the City COOP holds (Section 6).
 *  source: scripts/theos-e2e-sim.mjs POOL_SHARE and its header */
export const INVESTOR_SHARE = 0.5;
export const POOL_SHARE = 0.1;
export const TREASURY_SHARE = 1 - INVESTOR_SHARE - POOL_SHARE;
/** the old pool rule of the paper's earlier version: 0.05 of each HEART to the pools (a tenth of the treasury's half);
 *  the simulation keeps it as a variation (LADDER 'pool05'), and the test city (round 5) still runs it */
export const OLD_POOL_SHARE = 0.05;
export const SECONDS_YEAR = 31_536_000;

/** a number in words, en-GB, with d decimals */
export const fmt = (n, d = 0) => n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
// a share (0.07) as a percentage (7 %), for labels built here; the page has its own pc()
const pcs = (v, d = 0) => `${fmt(v * 100, d)} %`;

/** the city's pools (Section 6): the fee of each swap, how many MINDs a basket holds, and how many basket partners a
 *  MIND has at least. source: scripts/theos-e2e-sim.mjs FEE; canon #13 */
export const POOL = { fee: 0.003, min: 4, max: 8, partners: 3 };

/** Circles v2's own numbers (Section 3): tokens a person a day, its demurrage a year, and its registered people.
 *  source: refs.js circles2 (Circles docs, mid-2026) */
export const CIRCLES = { day: 24, rate: 0.07, people: 25_000, asOf: 'mid-2026' };

/** the three kinds of basket of Figure 7 (Section 6.2): the volatility of calm and wild MINDs, a correlation, and the
 *  basket sizes the text compares */
export const LVR_CASES = { calm: 0.2, wild: 0.4, rho: 0.6, n: [4, 8] };

/** the crash example of Section 12.3: the share of its price that one MIND keeps, and a small and a large pool */
export const CRASH = { left: 0.01, small: 4, large: 8 };

/** who can change the rules (Appendix F): the least waiting time of a code change, days, and the longest a pause runs
 *  unless a large majority renews it, hours */
export const GOVERNANCE = { waitDays: 30, pauseHours: 72 };

/** the version of the paper being published, for the masthead and the cite-as line */
export const VERSION = { n: 'v7', date: 'October 2026' };

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
		{ id: 'mid', label: `Starts at the ${pcs(RATE)} steady state, ${fmt(steadyState(RATE))}`, b0: steadyState(RATE) },
		{ id: 'newborn', label: 'A new city, starts with 0', b0: 0 }
	].map((s) => ({ ...s, points: range(0, years, 240).map((t) => [t, balanceAt(s.b0, t, r)]), star }));
};

/** Figure 8: what a holder keeps of 1,000 HEARTS invested in year 1 of the main run, valued in HEARTS, against the
 *  same HEARTS left idle. Law 4 gives the investor INVESTOR_SHARE of a MIND for each HEART; each new MIND is worth about
 *  1 HEART (Section 6.3). The holding then grows at its MIND's compounded return of H5 (price change and Law 5 dividends,
 *  kept as more of the same MIND, before the melt) and melts at the rate r. Idle HEARTS only melt. The x axis is the
 *  year of the run. source: MIND_RETURNS.byMind (sim-dynamic.md H5) */
export const holderSeries = (ids = ['SOLAR', 'CITY', 'HABITAT', 'ARTS'], amount = 1000, r = RATE) => {
	const last = Math.max(...ids.map((k) => MIND_RETURNS.byMind[k].years));
	const xs = range(1, last + 1, last * 4);
	return [
		{ id: 'idle', label: `${fmt(amount)} idle HEARTS`, points: xs.map((x) => [x, decay(amount, r, x - 1)]) },
		...ids.map((k) => {
			const m = MIND_RETURNS.byMind[k];
			return {
				id: k,
				label: `${k.toLowerCase()}MIND`,
				points: xs.map((x) => [x, amount * INVESTOR_SHARE * Math.pow(1 + m.compounded, x - 1) * Math.exp(-r * (x - 1))])
			};
		})
	];
};

/** Figure 7: a basket's yearly LVR against how many MINDs it holds, for three kinds of MIND (LVR_CASES) */
export const lvrSeries = (c = LVR_CASES) =>
	[
		{ id: 'calm', label: `σ ${pcs(c.calm)}, independent`, sigma: c.calm, rho: 0 },
		{ id: 'wild', label: `σ ${pcs(c.wild)}, independent`, sigma: c.wild, rho: 0 },
		{ id: 'linked', label: `σ ${pcs(c.wild)}, correlated ${fmt(c.rho, 1)}`, sigma: c.wild, rho: c.rho }
	].map((s) => ({ ...s, points: range(2, POOL.max, POOL.max - 2).map((n) => [n, basketLvr(n, s.sigma, s.rho) * 100]) }));

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
		{ id: 'A', label: 'COOP A · 1 MIND, 1 vote', points: out.A },
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

// ── Fair ownership (Sections 9.2 and 10.6) ─────────────────────────────────────────────────────────────────────────────────────

/** Germany's wealth Gini today (Bundesbank PHF 2023), the start and the capitalism baseline of Figure 10 */
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

/** Figure 10: ownership inequality over 100 years, from Germany's spread today, under theOS with three spreads of returns */
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

/** Figure 11: the resting Gini against the spread of people's returns, for three demurrage rates */
export const dialSeries = (rates = [0.03, RATE, 0.1]) =>
	rates.map((r) => ({
		id: `d${r}`,
		label: `${pcs(r)} a year`,
		points: Array.from({ length: 46 }, (_, i) => {
			const s = 0.05 + i * 0.01;
			return [s, giniRest(s, r, 0)];
		})
	}));

// ── The dynamic world (Sections 6.3, 8, 9, 10, 12) ─────────────────────────────────────────────────────────────────
// Source: sim-dynamic.md, the output of scripts/theos-e2e-sim.mjs (run dyn:main, seed 20261012, 250 people × 60 years,
// Law 4's 0.5 / 0.4 / 0.1, and the idle-plant rule: the City re-lets a failed COOP's plant only while its
// demand is at least a quarter of its capacity). Steady state = years 51–60. Every constant names its table; every
// ratio that the prose prints is a function below. The unit is the HEART (Section 6.3): the script values every flow at
// the HEART index of the step in which it happens and prints these values in its tables H1 to H8 ("H2" … name them);
// the tables D1 to D8 and S1 to S7 count in R, the old basket of three MINDs. R a HEART drifted from 1.15 (year 1) to
// 1.51 (year 40) and 1.29 (year 60), so numbers in R and in HEARTS differ (OLD_R).

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
	shocks: 78, // D5
	restFrom: 51, // years 51–60: the run's rest, the years that the steady-state columns average
	runSeconds: 243, // the whole script's run time, s (sim-dynamic.md footer: "Runtime 243.3 s")
	seedCapacity: 1.15, // on day 1 the plants can make 115 % of the first needs, but nobody holds MIND
	shockAfterDays: 30, // proof check 1 looks at the 30 days after each shock …
	endAfterDays: 180, // … and the 180 days after each failure or exit
	// the idle-plant rule: when a COOP fails, the City COOP leases its plant to a successor only while the plant's
	// demand is at least this share of its capacity; an idle plant is scrapped and its land goes back to the City.
	// source: scripts/theos-e2e-sim.mjs DYN.reletUse (--set reletUse=0 runs without it)
	reletUse: 0.25
};

/** one day of basics for one person. source: scripts/theos-e2e-sim.mjs `BASIC`; proof check 1 (tolerance 98 %) */
export const BASIC_BUNDLE = { kcal: 2000, kWh: 3, m2: 20, L: 100, tolerance: 0.98 };

/** Proposition 3, checked per person on every day. source: sim-dynamic.md proof checks 1–2; D6.1; D6.2; D7 notes */
export const PROOF = {
	fromDay: 8,
	personDays: 5_473_250,
	short: 1_750, // person-days below 98 % of the basics, from day 8 (check 1 fails)
	worst: 0.96, // the worst person-day from day 8: 96 % of the basics …
	worstYear: 14, // … in year 14, day 108
	worstDay: 108,
	// the year with basics short (D7 note: the share of that year's person-days, and the goods short)
	shortYears: [{ year: 14, share: 0.019, goods: ['food'] }],
	shocks: 78,
	shockPersonDays: 2_488_500, // the 30 days after each shock
	shockWorst: 0.96,
	failures: 2,
	exits: 16,
	endedPersonDays: 736_750, // the 180 days after each failure or exit
	endedWorst: 1.34,
	shockShort: 1_750, // person-days short in the 30 days after the shocks (proof check 1)
	endedShort: 0, // … and in the 180 days after the ends
	genesis: { days: 7, worst: 0.12, short: 517, personDays: 1_750 },
	// the normal test (check 2) fails: the owner-only people were short too, when the basics ran short (D7 note: worst
	// 96 %, 175 person-days below 98 %). Their lowest holding from year 2 on, HEARTS, and a day of living that year,
	// HEARTS (H3 note)
	normal: { worst: 0.96, short: 175, lowestHolding: 3_518, lowestYear: 2, livingThen: 10.239 },
	strict: {
		firstDay: 182, lastMissYear: 60, lastMissDay: 363, lastMissRatio: 0.54, shareAfter10: 0.9479, worst: 0.52, worstYear: 56,
		// the share of owner-only person-days that dividends alone covered, by year. source: D6.2 (years 1, 5, 10) and
		// sim-dynamic.csv, dyn:main, zero_aven_strict_share_of_days (years 2, 3, 4, 6, 7, 8, 9)
		byYear: { 1: 0.614, 2: 0.989, 3: 0.883, 4: 0.861, 5: 0.777, 6: 0.721, 7: 0.94, 8: 0.999, 9: 0.999, 10: 1.0 },
		lastShortYear: 7, // the last of the early years in which they missed on more than a few days (CSV)
		lateMiss: { from: 55, to: 60 }, // after year 10, the only years with a miss (CSV: 0.99 in year 55 down to 0.04 in year 60; every other year 1)
		lateMissEnd: 0.04, // the share of owner-only person-days that dividends alone covered in year 60 (D6.2: 4.0 %)
		endRatio: 0.54 // the worst owner-only day in year 60: dividends ÷ basic bundle (D6.2)
	},
	bundleMax: 0.864, // the most a day's basic bundle cost in a year, HEARTS … (H2; the script's year-end "in MIND" gives 0.601 in year 3)
	bundleMaxYear: 1 // … in this year
};

/** the early year (from year `from` on; year 1 when not given, which holds the genesis week) in which dividends alone
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
	d1: [12.8, 16.5, 24.8, 47.2, 76.2, 234.5, 174.3, 134.5],
	d2: [13.5, 19.9, 35.3, 99.0, 195.5, 428.7, 563.6, 526.3], // the second tenth (D6.3, column D2)
	d5: [14.4, 24.7, 44.0, 168.7, 347.6, 666.8, 1_016.5, 1_185.7],
	d10: [18.5, 41.0, 79.1, 390.7, 874.0, 1_668.4, 2_866.2, 3_335.7],
	mean: [14.9, 26.8, 47.9, 189.3, 401.3, 781.1, 1_219.3, 1_402.0],
	gini: [0.06, 0.14, 0.17, 0.27, 0.3, 0.28, 0.33, 0.34] // the Gini index of real consumption
};

/** the same, every year (years 1–60), and the cost of a day's basic bundle in HEARTS. The CSV has no yearly column for
 *  the second tenth; DECILES.d2 has it at the marks.
 *  source: sim-dynamic.csv, run dyn:main, columns real_consumption_decile1/5/10 and basic_bundle_H (each step's cost
 *  at that step's HEART values, averaged over the year; H8) */
export const LIVING = {
	d1: [12.8, 14.8, 15.6, 16.7, 16.5, 17.5, 18.3, 18.6, 20.0, 24.8, 27.5, 28.7, 30.3, 32.5, 37.2, 38.2, 41.0, 44.2, 45.7, 47.2, 48.6, 51.5, 55.6, 62.8, 69.9, 74.4, 78.2, 79.2, 75.6, 76.2, 70.4, 69.6, 68.2, 79.0, 107.4, 177.9, 204.7, 224.4, 239.3, 234.5, 233.2, 226.2, 222.2, 213.8, 205.8, 198.8, 194.5, 194.8, 178.2, 174.3, 166.4, 162.6, 152.5, 143.4, 139.7, 129.0, 131.4, 133.1, 133.9, 134.5],
	d5: [14.4, 17.7, 19.6, 23.0, 24.7, 28.0, 32.3, 35.5, 38.7, 44.0, 50.5, 58.1, 68.6, 85.2, 115.2, 130.2, 139.7, 154.0, 164.2, 168.7, 180.6, 200.1, 217.0, 240.9, 259.6, 281.6, 299.0, 317.7, 327.9, 347.6, 347.8, 380.5, 411.4, 481.3, 522.7, 567.9, 587.1, 599.3, 629.8, 666.8, 731.8, 778.3, 806.2, 827.1, 859.9, 891.9, 916.9, 992.0, 998.2, 1016.5, 1050.6, 1093.0, 1110.7, 1094.6, 1089.8, 1038.5, 1096.2, 1138.9, 1162.4, 1185.7],
	d10: [18.5, 25.7, 29.3, 37.1, 41.0, 46.6, 56.3, 60.4, 66.5, 79.1, 95.6, 114.3, 141.4, 186.9, 267.1, 312.5, 325.0, 356.3, 375.9, 390.7, 417.7, 488.1, 517.6, 558.4, 613.2, 666.5, 722.6, 778.3, 820.7, 874.0, 876.7, 955.2, 1015.6, 1169.5, 1291.1, 1666.1, 1662.9, 1581.9, 1607.1, 1668.4, 1823.9, 1964.9, 2080.8, 2176.5, 2308.5, 2430.3, 2528.4, 2738.6, 2804.3, 2866.2, 2968.4, 3091.1, 3173.7, 3163.7, 3172.5, 2969.4, 3089.0, 3200.2, 3267.9, 3335.7],
	bundle: [0.8637, 0.4933, 0.6023, 0.4664, 0.5574, 0.5631, 0.3919, 0.3527, 0.3025, 0.2016, 0.1961, 0.1931, 0.1886, 0.2648, 0.1763, 0.3341, 0.2074, 0.1601, 0.157, 0.1525, 0.1503, 0.1514, 0.206, 0.134, 0.1255, 0.1192, 0.1138, 0.11, 0.1107, 0.1092, 0.1082, 0.1089, 0.1043, 0.0916, 0.0888, 0.0941, 0.1005, 0.1009, 0.0985, 0.0951, 0.0895, 0.0845, 0.0813, 0.079, 0.0767, 0.0752, 0.0748, 0.0711, 0.0725, 0.0744, 0.0732, 0.0711, 0.0732, 0.0744, 0.074, 0.0768, 0.074, 0.0736, 0.0744, 0.0753]
};

/** the owner-only people (every tenth person: their Avens deliver nothing, and they start with nothing).
 *  source: H3 note (holdings, HEARTS), D6.2 (the group's average of dividends ÷ basic bundle) and its note (the mix at
 *  the end, and each MIND's dividend yield in year 60: GREEN is a food COOP and WIND an energy COOP, each with a small
 *  share of its market in year 60, D5) */
export const OWNER_ONLY = {
	count: 25,
	holding40: 23_199, // mean holding, HEARTS, year 40 (H3 note)
	holding60: 8_170, // year 60
	strictAvg40: 242.91, // dividends ÷ basic bundle, the group's average, year 40
	strictAvg60: 0.68, // year 60
	mix: { CITY: { share: 0.5, yield: 0.0 }, GREEN: { share: 0.22, yield: 0.0 }, WIND: { share: 0.1, yield: 0.0 }, HABITAT: { share: 0.06, yield: 0.001 } }
};

/** the dynamic world in the last ten years (years 51–60), against the earlier static world. source: sim-dynamic.md D1, D8, and for
 *  every value in HEARTS H2. mu and sigma are the rest means of each year's mean return and its spread across people,
 *  in HEARTS (H2). In R the script printed mu 4.4 % (D1); the gap is R's drift (Appendix G) */
export const DYN = {
	dayLiving: { y1: 4.5, y10: 51.4, y60: 112.1 }, // a day of living, HEARTS (H2)
	income: 131.6, // HEARTS a person a day (H2)
	spent: 0.86, // share of income spent (bought from COOPs) (D1)
	walletMelt: 0.12, // share of income that melts in wallets (D1)
	people: 0.716, // share of all MIND by HEART value (H2)
	treasuries: 0.18,
	pools: 0.104,
	yield: 0.099, // dividend yield a year, all MIND by value (D1, H2)
	mu: 0.084, // lasting return in HEARTS: dividends plus price change, in the last ten years (H2: 8.40 %; in R 4.38 %)
	muRun: 0.0979, // the same over the whole run, years 2–60 (H2: 9.79 %; in R 9.42 %)
	muYearsAbove: { years: 56, of: 59 }, // years 2–60 in which it was at or above the 7 % melt (H2; in R 44 of 59)
	priceChange: -0.003, // the price part of mu in the last ten years, in HEARTS (H2: −0.30 %; in R −4.38 %)
	sigma: 0.0483, // its spread across people (H2: 4.83 %; in R 6.30 %)
	gini2: 1.0, // Proposition 2's Gini from mu and sigma (H2): 1 when mu is at or above the melt
	giniOwned: 0.34, // Gini of what people hold, years 51–60 (D1; H2: 0.340)
	giniOwnedBy: { y20: 0.29, y40: 0.28, y50: 0.33, y60: 0.34 }, // … by year (D3; H8: 0.287, 0.277, 0.329, 0.345)
	giniTrend: 0.029, // its least-squares trend over years 41–60, a 10 years (H2, H8: +0.029)
	pricesMin: 0.05, // MIND values in the last ten years, HEARTS: lowest … (H2)
	pricesMax: 1.49, // … highest
	sdLog: 0.76,
	mindsAlive: 22, // (D1)
	outputPerPlant: 10.7, // output per unit of plant at the end, sales-weighted (D1); 1 on day 1
	failures: 2, // whole run (D1, D5)
	exits: 16,
	foundings: 25,
	money: 115_001, // MIND count a person (D1, D8)
	bundleChange: 0.0012, // the basic bundle's yearly change in HEARTS, years 51–60 (H2: +0.12 %, dearer; in R −2.66 %, D8 −2.7 %)
	coopDaysShort: 728, // COOP-days short of working capital in 60 years (D8)
	coopDaysShortAfter10: 483, // … of them after year 10 (D8)
	topBottom: 2.7 // mean holding: top half of Aven pay ÷ bottom half (D8)
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
	routing: 0.0039, // routing cost of a payment in the last ten years … (S1)
	routingFees: 0.0035, // … of it pool fees
	germany: [0.72, 0.45, 0.36], // Gini: made as unequal as Germany, then +10 and +20 years (S6.5)
	avenEven: 0.05, // Gini owned with all Avens alike (S5)
	avenDouble: 0.59, // with Avens that differ twice as much (S5)
	foodFailure: { withRule: 0.09, without: 1.0 }, // food shortfall the year after the main food COOP fails (S6.2)
	ring: { hearts: 0.0365, people: 0.016, income: 1.6, wealth: 1.4, years: 10 }, // a founder ring: share of HEARTS and of people, income and wealth (after 10 years) against others (S6.3)
	coldStart: { day1: 0.944, days1to30: 0.14, year1: 0.011 }, // shortfall without the bootstrap (S1)
	land: { private: 0.5, city: 0.29 }, // Gini after 40 years, private land against all land in the City COOP (model.md §7.4)
	coopDaysShort: 40 // COOP-days short of working capital in 60 years (S1)
};

/** Proposition 2 checked by simulating the process: an SDE run of 4,000 people against the Gini formula of Section 9.2 at σ = 0.2.
 *  source: research/e2e/model.md, verification table ("SDE run (4,000 people): 0.287 against 0.291") */
export const SDE_CHECK = { sim: 0.287, formula: 0.291 };

/** treasuries in the last ten years. source: sim-dynamic.md D4 (reserves at the end in days of running costs) and H3 note
 *  (HEARTS a person a year, booked as D4 books them) */
export const RESERVES = {
	months: 9,
	days: 270,
	minDays: 202,
	medianDays: 618,
	inflow: 44_950,
	items: 32_933,
	proposals: 2_165,
	dividends: 8_234
};
/** a share of all that flows into the treasuries in the last ten years, as D4 books it (sales gross): 'items', 'proposals' or 'dividends' */
export const reserveShare = (k) => RESERVES[k] / RESERVES.inflow;
/** a share of what the treasury itself keeps of its inflow: sales after the Law 5 share, which goes at once from each
 *  sale to the holders and never passes through the treasury. 'items' or 'proposals'. source: D4 */
export const treasuryShare = (k) => RESERVES[k] / (RESERVES.inflow - RESERVES.dividends);

/** one run per variation of the main run. checks = [no one starves, no one has to work (normal), everyone gains];
 *  short = the basics short in the worst years; mu = the lasting return in the last ten years, HEARTS (H6); sigma its spread (H6);
 *  bundleMax = the most a day's basic bundle cost in a year, HEARTS (H6); shortYears / worstYear / worstYearShare =
 *  the years with basics short, and the worst of them (D7 notes). source: sim-dynamic.md D7 (both tables and the
 *  notes) and H6 (mu, sigma, bundleMax) */
// fields that the words are built from: foodYears = the years with food short (foodShock: after a shock);
// shortYears = how many years food ran short; falls = [who, from year, to year], each a fall of real consumption
// between two ten-year marks; personFall = the poorest person's fall, when no tenth fell; spent = the share of income
// spent; worst = the worst person-day; ownerWorst = the worst owner-only person-day; popGrowth / popYears = a growing
// population and for how long
const LADDER_ROWS = [
	{ id: 'main', bundleMax: 0.864, share: 0.2, months: 9, checks: [0, 0, 0], shortfall: 0.0003, yield: 0.099, mu: 0.084, sigma: 0.0483, failures: 2, exits: 16, foundings: 25, short: ['food'], foodYears: [14], foodShock: true, falls: [['the poorest tenth', 40, 60], ['the second tenth', 50, 60]] },
	{ id: 'law35', bundleMax: 1.038, share: 0.35, checks: [1, 1, 0], shortfall: 0, yield: 0.174, mu: 0.1033, sigma: 0.1136, failures: 3, exits: 30, foundings: 49, short: [], falls: [['the poorest tenth', 40, 50]] },
	{ id: 'law50', bundleMax: 1.153, share: 0.5, checks: [1, 1, 0], strict: 1, shortfall: 0, yield: 0.248, mu: 0.1792, sigma: 0.1033, failures: 6, exits: 42, foundings: 62, short: [], falls: [['the poorest tenth', 40, 50], ['the next three tenths', 50, 60]] },
	{ id: 'res6', bundleMax: 0.877, months: 6, checks: [0, 0, 0], shortfall: 0.0006, yield: 0.1, mu: 0.0625, sigma: 0.0701, failures: 1, exits: 16, foundings: 22, short: ['food'], foodYears: [2, 34] },
	{ id: 'res12', bundleMax: 1.35, months: 12, checks: [1, 1, 0], shortfall: 0, yield: 0.1, mu: 0.0659, sigma: 0.0588, failures: 2, exits: 11, foundings: 16, short: [], falls: [['the poorest tenth', 30, 50]] },
	{ id: 'prod0', bundleMax: 1.174, shortYears: 3, worstYear: 31, worstYearShare: 0.019, checks: [0, 0, 0], shortfall: 0.0008, yield: 0.101, mu: 0.0937, sigma: 0.0763, failures: 13, exits: 20, foundings: 32, short: ['food'], falls: [['the poorer tenths', 40, 50]] },
	// plant: output per unit of plant in year 60 (sim-dynamic.csv, dyn:even, mean_productivity)
	{ id: 'even', bundleMax: 0.863, growth: 0.02, checks: [1, 1, 0], shortfall: 0, yield: 0.1, mu: 0.1079, sigma: 0.0497, failures: 0, exits: 12, foundings: 19, short: [], plant: 3.56, falls: [['the poorest tenth', 30, 40], ['the poorest tenth', 50, 60]] },
	// part 3 is a claim about every tenth (Section 10.1): in this run no tenth fell, only the poorest person (D7 notes)
	{ id: 'wide', bundleMax: 0.87, checks: [1, 1, 1], shortfall: 0, yield: 0.1, mu: 0.0627, sigma: 0.049, failures: 0, exits: 13, foundings: 19, short: [], falls: [], personFall: [20, 30] },
	{ id: 'wants', bundleMax: 0.918, checks: [1, 1, 0], shortfall: 0, yield: 0.001, mu: 0.0006, sigma: 0.0004, failures: 1, exits: 9, foundings: 14, short: [], spent: 0.05 },
	{ id: 'aven', bundleMax: 2.196, checks: [0, 0, 0], shortfall: 0.0023, yield: 0.1, mu: 0.0966, sigma: 0.0486, failures: 14, exits: 9, foundings: 14, short: ['food'], shortYears: 8, worst: 0.13 },
	// ownerWorst: the worst owner-only person-day; poorOwner: the poorest owner-only person's real consumption, years 10 and 20
	{ id: 'pop', bundleMax: 0.895, popGrowth: 0.02, popYears: 40, checks: [0, 0, 0], shortfall: 0.0005, yield: 0.1, mu: 0.0826, sigma: 0.0776, failures: 2, exits: 14, foundings: 23, short: ['food', 'energy', 'housing', 'water'], ownerWorst: 0.64, poorOwner: [10.9, 5.6] },
	// the old pool rule (0.05 of each HEART to the pools, a tenth of the treasury's half), with the idle-plant rule
	{ id: 'pool05', bundleMax: 2.168, pool: OLD_POOL_SHARE, checks: [0, 0, 0], shortfall: 0.0008, yield: 0.1, mu: 0.0694, sigma: 0.0607, failures: 1, exits: 19, foundings: 27, short: ['food'], foodYears: [48], falls: [['the poorest tenth', 30, 40]] }
];
// 'year 14' or 'years 2 and 34'
const yearWords = (ys) => (ys.length === 1 ? `year ${ys[0]}` : `years ${ys.slice(0, -1).join(', ')} and ${ys.at(-1)}`);
/** a ladder row's name, built from its fields */
export function ladderLabel(v) {
	if (v.id === 'main') return `Main: Law 5 at ${pcs(v.share)}, reserves ${v.months} months`;
	if (v.share != null) return `Law 5 at ${pcs(v.share)}`;
	if (v.months != null) return `Reserves ${v.months} months`;
	if (v.growth != null) return `Even growth, ${pcs(v.growth)} for every COOP`;
	if (v.popGrowth != null) return `Population grows ${pcs(v.popGrowth)} a year (${v.popYears} years)`;
	if (v.pool != null) return `The old pool rule: ${fmt(v.pool, 2)} of each HEART to the pools`;
	return { prod0: 'No productivity growth', wide: 'Growth twice as uneven', wants: 'Wants do not grow', aven: 'Fixed Aven capacity' }[v.id];
}
/** what broke in a ladder row, built from its fields */
export function ladderBroke(v) {
	const out = [];
	if (v.foodYears) out.push(`food ran short in ${yearWords(v.foodYears)}${v.foodShock ? ', after a shock' : ''}`);
	if (v.shortYears) out.push(`food ran short in ${v.shortYears} years`);
	if (v.worst != null) out.push(`the worst person-day had ${pcs(v.worst)}`);
	if (v.spent != null) out.push(`people spent ${pcs(v.spent)} of income; dividends fell to almost nothing, and consumption stopped rising`);
	if (v.ownerWorst != null) out.push(`newcomers went short in their first weeks, and owner-only people too (worst ${pcs(v.ownerWorst)})`);
	if (v.falls && v.falls.length) {
		let t = '';
		v.falls.forEach(([who, a, b], i) => {
			const span = `from year ${a} to year ${b}`;
			if (i === 0) t = `${who} fell ${span}`;
			else if (who === v.falls[i - 1][0]) t += `, and ${span}`;
			else t += `, and ${who} ${span}`;
		});
		out.push(t);
	}
	if (v.falls && !v.falls.length) out.push('no tenth fell');
	if (v.personFall) out.push(`the poorest person fell from year ${v.personFall[0]} to year ${v.personFall[1]}`);
	const t = out.join('; ');
	return t[0].toUpperCase() + t.slice(1);
}
export const LADDER = LADDER_ROWS.map((v) => ({ ...v, label: ladderLabel(v), broke: ladderBroke(v) }));
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

/** the dynamic main on eight seeds (20261012–20261019): the same run, eight histories. new = Law 4's
 *  0.5 / 0.4 / 0.1; old = the old pool rule (0.05 to the pools); both with the idle-plant rule (SIM.reletUse). mu in
 *  HEARTS in the last ten years; margin = the melt less mu, the smallest of the eight and its seed; below = seeds with mu below the
 *  melt; pass = seeds on which all three checks of Proposition 3 pass; gini = the measured Gini of holdings in HEARTS
 *  in year 60, lowest and highest; rising = seeds whose Gini still rose over years 41–60 (flat = of them, the seeds
 *  whose trend was +0.000 per ten years: 20261017); fails / food = COOP failures
 *  on the eight seeds, all and food COOPs; short = person-days short from day 8, summed; year1 = seeds whose worst
 *  person-day from day 8 fell in the first weeks of year 1 (the seed check's notes). source: scripts/theos-e2e-sim.mjs
 *  --seeds 20261012-20261019 (new) and the same with --set poolShare=0.05 (old); research/e2e/pool-10 seeds-new.md and
 *  seeds-old.md. noFix: the new rule without the idle-plant rule (--set reletUse=0), as in the paper's last version;
 *  main = the main seed alone (seeds-new-nofix.md) */
export const SEEDS = {
	from: 20261012,
	to: 20261019,
	n: 8,
	new: { muMin: 0.0624, muMax: 0.0974, muMedian: 0.0738, below: 2, marginMin: -0.0274, marginMinSeed: 20261019, pass: 2, check1: 4, check2: 4, check3: 3, gini: [0.32, 0.39], rising: 7, flat: 1, fails: 16, food: 14, short: 18_888, year1: 2 },
	old: { muMin: 0.0602, muMax: 0.0873, muMedian: 0.0684, below: 5, marginMin: -0.0173, marginMinSeed: 20261016, pass: 0, check1: 1, check2: 1, check3: 2, gini: [0.34, 0.4], rising: 8, fails: 16, food: 13, short: 40_157, year1: 3 },
	noFix: { pass: 3, fails: 34, food: 32, successors: 18, short: 27_113, main: { food: 14, successors: 11, short: 9_975, mu: 0.0944 } }
};

/** the melt tests (Section 10.6): the dynamic main on the same eight seeds, with one lever changed at a time, all with
 *  the idle-plant rule. new: under Law 4 of this paper (the pools' part 0.1), from scripts/theos-e2e-sim.mjs --seeds
 *  20261012-20261019 with --set turnDiv=0.1, --set turnDiv=0.15, --set capDays=365, --melt 0.08 or --melt 0.09
 *  (research/e2e/pool-10, melt-*.md); old: the same levers under the old pool rule, the same commands with
 *  --set poolShare=0.05 added (melt-old-*.md). melt = the run's melt; mu = μ in the last ten years in HEARTS, lowest and highest of
 *  the eight seeds; below = seeds with μ below that run's melt; marginMin = the smallest margin (melt − μ), negative when
 *  μ was above the melt on some seed; pass = seeds on which all three checks of Proposition 3 pass; yieldMid = the
 *  median dividend yield */
export const MELT_TESTS = {
	law10: { share: 0.1, melt: 0.07, new: { mu: [0.0312, 0.049], below: 8, marginMin: 0.021, pass: 3, yieldMid: 0.05 }, old: { mu: [0.0343, 0.0438], below: 8, marginMin: 0.0262, pass: 3, yieldMid: 0.05 } },
	law15: { share: 0.15, melt: 0.07, new: { mu: [0.0447, 0.072], below: 7, marginMin: -0.002, pass: 3, yieldMid: 0.0751 }, old: { mu: [0.0354, 0.0796], below: 6, marginMin: -0.0096, pass: 0, yieldMid: 0.0753 } },
	res12: { months: 12, melt: 0.07, new: { mu: [0.0558, 0.102], below: 5, marginMin: -0.032, pass: 3 }, old: { mu: [0.0643, 0.0899], below: 3, marginMin: -0.0199, pass: 1 } },
	melt8: { melt: 0.08, new: { mu: [0.0592, 0.0971], below: 7, marginMin: -0.0171, pass: 2 }, old: { mu: [0.0645, 0.0803], below: 7, marginMin: -0.0003, pass: 2 } },
	melt9: { melt: 0.09, new: { mu: [0.0606, 0.0962], below: 7, marginMin: -0.0062, pass: 0 }, old: { mu: [0.0606, 0.0961], below: 7, marginMin: -0.0061, pass: 1 } }
};

/** the same-shock comparison (Appendix G): the pool rule of this paper (0.1 of each HEART to the pools) against the
 *  old one (0.05), both with the idle-plant rule, on 24 seeds, with common random numbers: on each seed both rules meet
 *  the same capacity shocks and the same drift of tastes. new / old: person-days short from day 8 and COOP failures
 *  (all, food COOPs, successors that failed, idle plants scrapped), summed over the 24 seeds; the seeds with any person-day
 *  short and with any food failure; the seeds on which all three checks of Proposition 3 pass, and each check; μ in the last ten years
 *  in HEARTS: lowest, highest and median seed; below = seeds with μ below the 7 % melt. tests: the new rule against the
 *  old, seed by seed: better = seeds on which the new rule had fewer person-days short, fewer failures, a lower μ, or
 *  passed all three checks where the old one failed; worse = the reverse; same = ties; p = the two-sided exact sign
 *  test (ties left out). source: scripts/theos-e2e-sim.mjs --pair 20261012-20261035 --vs poolShare=0.05 --names new,old
 *  (research/e2e/pool-10, crn-new-old.md and .json). fix: the idle-plant rule against none (--pair … --vs reletUse=0,
 *  crn-fix-nofix.md), both under the new pool rule. noFix: new against old without the idle-plant rule (--pair …
 *  --set reletUse=0 --vs poolShare=0.05, crn-new-old-nofix.md). collapse: the main run on seed 20261028, without
 *  common random numbers: the City COOP's treasury ran dry and water stopped for about a year (--seed-run 20261028;
 *  the worst person-day was in year 19; research food-failures.md §8) */
export const SAME_SHOCK = {
	from: 20261012,
	to: 20261035,
	n: 24,
	alpha: 0.05, // a difference with p below this the paper calls clear; above it, it could be luck
	new: { short: 31_522, shortSeeds: 11, food: 16, foodSeeds: 8, fails: 23, successors: 3, scrapped: 10, pass: 6, check1: 13, check2: 13, check3: 11, mu: [0.0569, 0.1014], muMedian: 0.0692, below: 15 },
	old: { short: 134_559, shortSeeds: 19, food: 33, foodSeeds: 19, fails: 33, successors: 5, scrapped: 20, pass: 1, check1: 5, check2: 5, check3: 7, mu: [0.0579, 0.1241], muMedian: 0.0738, below: 6 },
	tests: {
		short: { better: 16, worse: 3, same: 5, p: 0.0044 },
		food: { better: 15, worse: 4, same: 5, p: 0.0192 },
		fails: { better: 12, worse: 5, same: 7, p: 0.1435 },
		mu: { better: 16, worse: 8, same: 0, p: 0.1516 },
		pass: { better: 5, worse: 0, same: 19, p: 0.0625 }
	},
	fix: {
		yes: { short: 31_522, food: 16, fails: 23, successors: 3, pass: 6 },
		no: { short: 31_515, food: 46, fails: 53, successors: 30, pass: 6 },
		tests: { short: { better: 0, worse: 1, same: 23, p: 1 }, food: { better: 7, worse: 0, same: 17, p: 0.0156 }, fails: { better: 9, worse: 0, same: 15, p: 0.0039 } }
	},
	noFix: {
		new: { short: 31_515, food: 46, fails: 53, pass: 6 },
		old: { short: 113_048, food: 49, fails: 54, pass: 2 },
		tests: { short: { better: 15, worse: 3, same: 6, p: 0.0075 }, food: { better: 15, worse: 7, same: 2, p: 0.1338 } }
	},
	collapse: { seed: 20261028, short: 2_323_749, year: 19 }
};

/** one seed, one history (Section 10.7): the main seed, with the pools' part of each HEART moved by a hair. pool = the
 *  pools' part; mu = μ in the last ten years in HEARTS; short = person-days short from day 8; food = food COOP failures; pass = all
 *  three checks of Proposition 3 pass. source: scripts/theos-e2e-sim.mjs --seed-run 20261012 --set poolShare=…
 *  (research/e2e/pool-10, chaos/pool-*.json); 0.1 is the main run and 0.05 the old pool rule (LADDER) */
export const CHAOS = [
	{ pool: 0.0995, mu: 0.0902, short: 0, food: 1, pass: true },
	{ pool: 0.0999, mu: 0.0853, short: 0, food: 0, pass: true },
	{ pool: 0.1001, mu: 0.0879, short: 3_500, food: 1, pass: false },
	{ pool: 0.1005, mu: 0.093, short: 1_750, food: 5, pass: false },
	{ pool: 0.0499, mu: 0.0747, short: 0, food: 1, pass: false },
	{ pool: 0.0501, mu: 0.0687, short: 23_184, food: 3, pass: false }
];

/** values in HEARTS and in days of living: a day of living, a day's basic bundle, and the lowest and highest MIND value
 *  that year. source: sim-dynamic.md H3 */
export const PRICES_BY_YEAR = {
	1: { living: 4.54, bundle: 0.864, vMin: 0.35, vMax: 1.98 },
	10: { living: 51.35, bundle: 0.2016, vMin: 0.07, vMax: 3.12 },
	30: { living: 98.33, bundle: 0.1092, vMin: 0.06, vMax: 1.36 },
	40: { living: 111.2, bundle: 0.0951, vMin: 0.08, vMax: 1.61 },
	60: { living: 112.12, bundle: 0.0753, vMin: 0.06, vMax: 1.49 }
};
/** a day's basic bundle as a share of a day of living, in year y */
export const bundleShareOfLiving = (y) => PRICES_BY_YEAR[y].bundle / PRICES_BY_YEAR[y].living;

/** the retired yardstick R (the geometric mean of the prices of SOLAR, HABITAT and CITY), in R a HEART: how far it
 *  drifted against the average MIND, and the lasting return in the last ten years that the script prints in R (D1, D7).
 *  source: sim-dynamic.md H1, H2 and H6 ("R a HEART at rest", "μ, R") */
export const OLD_R = { y1: 1.15, y40: 1.51, y60: 1.29, rest: 1.49, mainMu: 0.0438 };

/** competition by good: the largest seller's share of what was made in year 1 and year 60 (null: none made that year),
 *  and the COOPs founded and ended over 60 years (a successor that leases a failed plant is not counted as founded).
 *  source: sim-dynamic.md D5 (tables and lists) */
export const COMPETITION = [
	{ good: 'food', y1: 0.68, y60: 0.95, founded: 3, ended: 3 },
	{ good: 'energy', y1: 0.62, y60: 1.0, founded: 3, ended: 3 },
	{ good: 'housing', y1: 0.64, y60: 1.0, founded: 0, ended: 0 },
	{ good: 'water', y1: 1.0, y60: 1.0, founded: 0, ended: 0 },
	{ good: 'goods', y1: 0.64, y60: 0.83, founded: 3, ended: 2 },
	{ good: 'care', y1: 0.52, y60: 0.93, founded: 3, ended: 2 },
	{ good: 'experiences', y1: 0.56, y60: 0.98, founded: 6, ended: 6 },
	{ good: 'panels', y1: 1.0, y60: null, founded: 3, ended: 0 },
	{ good: 'materials', y1: 1.0, y60: 1.0, founded: 4, ended: 2 }
];
/** the goods (water aside) that one COOP made alone in year 60 */
export const soleMakers = () => COMPETITION.filter((g) => g.good !== 'water' && g.y60 === 1).map((g) => g.good);
/** the failures: both were food COOPs founded later, FOOD3 (founded in year 7, failed in year 11) and FOOD4 (founded in
 *  year 14, failed in year 16). Each plant was idle when its COOP failed, so the City COOP scrapped it and took the land
 *  back (the idle-plant rule, SIM.reletUse). source: D5 */
export const FAILURE = { coop: 'FOOD3', good: 'food', year: 11, count: 2, food: 2, scrapped: 2, second: { coop: 'FOOD4', year: 16 } };
/** the energy COOPs founded later, each of which exited within this many years (D5: y5→y8, y16→y19, y23→y26) */
export const ENERGY_ENTRANTS = { count: 3, years: 3 };

/** every MIND over its life, in HEARTS (H5). byMind: the MINDs of the first COOPs, each with the years it lived, its
 *  mean return a year (Law 5 dividends plus price change), its price change a year, and its compounded return a year
 *  (what one MIND held with its dividends became, the dividends kept as more of the same MIND); all before the melt.
 *  good: what its COOP makes; share1 / share60: its share of what was made of that good in year 1 and year 60 (D5;
 *  null: none made that year). source: sim-dynamic.md D2 (second table), H5 and D5 */
export const MIND_RETURNS = {
	minds: 40,
	ended: 18,
	withThreeYears: 39,
	aboveMelt: 16,
	aboveMeltEnded: 9,
	arts: { compounded: 0.238, years: 59 },
	byMind: {
		CITY: { good: 'water', years: 59, mean: -0.002, priceChange: -0.002, compounded: -0.003, share1: 1.0, share60: 1.0 },
		SOLAR: { good: 'energy', years: 59, mean: 0.013, priceChange: 0.006, compounded: 0.006, share1: 0.62, share60: 1.0 },
		WIND: { good: 'energy', years: 59, mean: 0.014, priceChange: 0.01, compounded: 0.011, share1: 0.38, share60: 0.0 },
		HABITAT: { good: 'housing', years: 59, mean: 0.005, priceChange: 0.0, compounded: 0.003, share1: 0.64, share60: 1.0 },
		AGRI: { good: 'food', years: 59, mean: 0.014, priceChange: 0.004, compounded: 0.01, share1: 0.68, share60: 0.95 },
		PANEL: { good: 'panels', years: 59, mean: -0.01, priceChange: -0.012, compounded: -0.019, share1: 1.0, share60: null },
		BUILD: { good: 'materials', years: 59, mean: -0.002, priceChange: -0.004, compounded: -0.005, share1: 1.0, share60: 1.0 },
		ARTS: { good: 'experiences', years: 59, mean: 0.246, priceChange: 0.014, compounded: 0.238, share1: 0.44, share60: 0.98 }
	}
};
/** the MINDs of the city's infrastructure (water, energy, housing, materials) that Section 8.1 compares */
export const INFRA_MINDS = ['CITY', 'SOLAR', 'WIND', 'HABITAT', 'BUILD'];
/** the lowest and highest of a field over a set of MINDs: e.g. mindRange('mean') over INFRA_MINDS */
export const mindRange = (key, ids = INFRA_MINDS) => {
	const v = ids.map((k) => MIND_RETURNS.byMind[k][key]);
	return [Math.min(...v), Math.max(...v)];
};

/** how the simulation's Avens invest (Section 10.3; scripts/theos-e2e-sim.mjs updateAlloc, BASE.avenRule 'price'):
 *  each Aven puts `share` of its person's HEARTS into the `top` MINDs with the highest time-averaged pool price ×
 *  (1 + yieldWeight × Law 5 dividend yield), the yield smoothed over smoothDays, each weighted by (score ÷ best
 *  score)^sharpness; the rest goes by its person's own values. A newly founded COOP gets other people's HEARTS only
 *  after its pool has traded for waitYears; its founders invest all their HEARTS in it for that year. The script also
 *  has a rule by delivered output (avenRule 'output'), which the main run does not use */
export const AVEN_RULE = { share: 0.75, top: 6, yieldWeight: 3, sharpness: 10, waitYears: 1, smoothDays: 90 };

/** the round trip in the last ten years (years 51–60), in HEARTS a person a day. Places: people's wallets, COOP treasuries, pools;
 *  each with what flows in and out, what price moves did to what it holds, and the change of what it holds. Flows are
 *  valued at the HEART values of their step; price moves are what the change of HEART values from one step to the next
 *  did to what each place holds. source: sim-dynamic.md H4 (the same books as D8, which counts in R).
 *  No human labour is paid: every human's Aven delivers the work proposals. */
// net: H4's own "in − out" column, printed as H4 prints it (the sums of the rounded flows above can differ from it by
// 0.01); rest: H4's "not explained" column, unrounded (sim-dynamic.json roundTrip, H4 prints 0.005, 0.003 and 0.002). Liquidations were 0.00 in the last ten years and are left out. own: the investor's part
// (people) or the treasury's part (treasuries) of each HEART invested; pool: the pools' part
export const ROUND_TRIP = {
	people: { in: { own: 12.89, items: 90.23, proposals: 5.93, dividends: 22.56 }, out: { buying: 112.77, melt: 15.78, retired: 2.83 }, net: 0.22, moves: -0.5, change: -0.27, rest: 0.004995 },
	treasuries: { in: { own: 10.31, sales: 112.77 }, out: { dividends: 22.56, items: 90.23, proposals: 5.93, melt: 4.01, retired: 0.1 }, net: 0.25, moves: -1.03, change: -0.77, rest: 0.002778 },
	pools: { in: { pool: 2.58, routing: 0.02 }, out: { melt: 2.28, retired: 0.24 }, net: 0.08, moves: 0.1, change: 0.19, rest: 0.001816 },
	issuedMind: 24.0, // MIND a person a day (24 HEARTS converted); in HEARTS 25.77 (H4)
	meltedMind: 22.07, // MIND a person a day; in HEARTS the same 22.07, because by (7) all MIND is worth as many HEARTS as there are MINDs
	retiredMind: 2.79, // MIND that left with COOPs that ended (D8)
	stockGrowth: -0.86, // the MIND stock changed by this much a person a day (D8): it shrank a little
	unexplainedMax: 0.0007, // the largest unexplained rest, as a share of a place's inflow (H4: 0.070 %)
	between: { sales: 0.02, rent: 0.05 } // flows between treasuries, which cancel out (H4)
};
/** the share of what people hold that leaves a year with the MIND of COOPs that ended: what is retired from people's
 *  wallets a year (H4) over what people hold (DYN.people × DYN.money; the average MIND is worth 1 HEART). With the
 *  dividends and the price change, it closes the lasting return μ (Section 10.6) */
export const retiredShare = (rt = ROUND_TRIP, d = DYN) => (rt.people.out.retired * 365) / (d.people * d.money);

/** what new MIND, the melt and the MIND retired with COOPs that ended leave over, as a share of new MIND (D8: −3.6 %) */
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

/** the mean cost of a day's basic bundle in the last ten years, HEARTS, over the same years as H4. source: sim-dynamic.md H3
 *  note ("a day's basic bundle at rest") */
export const BUNDLE_REST = 0.074;

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

/** the strict test's threshold in the last ten years: the share of the mean holding at which Law 5 dividends alone pay for a day's
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

// ── Energy and physical limits (Sections 8.4, 12.5, Appendix H) ─────────────────────────────────────────────────────
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

// ── The test city (Section 11.2) ──────────────────────────────────────────────────────────────────────────────────
// Source: the test city, round 5, engine 20dd2478 (its proof report and engine notes, run 2026-10-13). A village of
// 1,500 residents over 60 years, built from day 0 with euro loans from the City COOP; Law 5 at 20 %, the 7 % melt, 24 HEARTS a day.

/** what the test city found in round 5. seeds: the five base seeds, each part per seed in that order; more: five more
 *  seeds (5–9) for parts 1 and 2. p1 = person-days short of a basic; p2normal = owner-only person-days failing the
 *  normal test; p2strict = the lowest owner-only resident's dividends ÷ basic bundle in the last year (the strict test
 *  never held on any seed); p3 = tenths failing part 3 in real units (of 20: ten by holdings, ten by Aven output), with
 *  the basics failing, the extras' falls and the baskets not rising; abundance = day-goods (a day and a basic) on which
 *  MIND, not physics, bound a basic. headline: part by part, on how many of the five base seeds each holds over 60
 *  years. suite: experiments and scenarios run, and how many pass, fail or only compare. poolShare: the pools' part
 *  the test city still gives (the old pool rule); ownerOnlyEvery: every twentieth newcomer is owner-only */
export const TEST_CITY = {
	round: 5,
	engine: '20dd2478',
	people: 1_500,
	years: 60,
	seeds: [20261012, 1, 2, 3, 4],
	poolShare: OLD_POOL_SHARE,
	ownerOnlyEvery: 20,
	p1: [0, 424, 1, 0, 1],
	p2normal: [0, 21, 0, 0, 0],
	p2strict: [0.36, 0.35, 0.33, 0.35, 0.38],
	p3: { of: 20, failing: [17, 13, 12, 18, 16], basics: [0, 0, 0, 0, 0], extrasFalls: [26, 14, 13, 25, 20], baskets: [0, 0, 0, 0, 0] },
	abundance: [0, 3, 2, 0, 2],
	headline: { of: 5, all: 0, p1: 2, p2: 0, p3: 0 },
	more: { seeds: [5, 6, 7, 8, 9], p1: 2, p2strict: 0, p2normal: 4, p3: 0 },
	suite: { experiments: 18, scenarios: 36, pass: 20, fail: 25, compare: 9 },
	// the bank at the border (the City COOP): the bootstrap number (the most the village owed outside at any moment, in
	// year 60) and its range over the five seeds; the build-out bill; euros lent to COOPs (euro loans) and repaid in their own
	// MIND by year 60, and still owed; exports and imports a year over the last ten years; the balance at the end; all
	// bought and sold abroad. Loans are repaid weekly, a 26th of what is owed, at most 5 % of the COOP's own treasury
	// MIND that week, with no interest. Exports never repaid the bootstrap within the 60 years
	bank: {
		bootstrap: 487.87e6,
		range: [478.04e6, 507.01e6],
		buildout: 405.15e6,
		advanced: 477.13e6,
		repaidMind: 449.51e6,
		owed: 27.62e6,
		exports: 5.66e6,
		imports: 5.94e6,
		balance: -487.66e6,
		bought: 773.12e6,
		sold: 285.46e6,
		repayWeeks: 26,
		repayCap: 0.05,
		repaid: false
	},
	// the scenarios and experiments the paper cites, each with its ids and verdict (pass: true, false, or null for a
	// comparison without a verdict)
	scenarios: {
		// the founding (bootstrap): person-days short in year 1 with it and without it; the share short on day 0 without it
		founding: { ids: ['X14', 'B14'], pass: true, shortWith: 0, shortWithout: 68_855, day0Without: 0.007 },
		// a food COOP fails: person-days short of food (one or two food COOPs); days until receivership
		foodFails: { ids: ['X5', 'B10'], pass: true, short: 0, receivershipDays: 29 },
		// newcomers in a slowly growing village: person-days short in their first three years, of how many
		newcomers: { ids: ['X12'], pass: true, short: 0, personDays: 64_705, from: 1_500, to: 1_606, years: 3 },
		// people arrive faster than beds are built
		bedsOutrun: { ids: ['B15'], pass: false, from: 1_500, to: 2_494, short: 763_834, personDays: 1_008_298, years: 3 },
		// a founder ring of four: its share of the people, the share of others' HEARTS it drew, and its members' holding
		// at the end against the others' mean, under the Avens' output rule and under the price rule
		ring: { ids: ['X6', 'B11'], pass: false, people: 0.01, drew: 0.002, endOutput: 1.02, endPrice: 0.8 },
		// sellers a basic (1, 2, 4): basics' price ÷ full cost, and the share of basics revenue sellers keep above
		// variable cost; X7: two sellers against one
		sellers: { ids: ['B31', 'X7'], pass: false, per: [1, 2, 4], cost: [1.0, 0.99, 1.02], keep: [0.54, 0.539, 0.559], two: { cost: 1.08, keep: 0.651 }, one: { cost: 1.07, keep: 0.645 } },
		// the melt rate swept: Proposition 3 fails at each; the Gini of holdings
		rates: { ids: ['B22'], pass: false, rates: [0.03, 0.05, 0.07, 0.1, 0.12], gini: [0.29, 0.29, 0.29, 0.29, 0.28] },
		// all land in the City COOP against private land: the Gini of holdings, and person-days short
		land: { ids: ['X13', 'B09'], pass: true, years: 8, giniCity: 0.33, giniPrivate: 0.34, shortCity: 0, shortPrivate: 58 },
		// a closed border: Aven service hours a person a day, person-days short, the mean living standard in the last
		// year, and tenths failing part 3 (open base against closed; 30 years)
		closed: { ids: ['B23'], pass: false, years: 30, hoursOpen: 23.8, hoursClosed: 0, shortOpen: 0, shortClosed: 14_951_097, livingOpen: 8.33, livingClosed: 0.8, p3Open: 17, p3Closed: 20 },
		// a drought, a dark winter, two failing COOPs and a failing well
		shocks: { ids: ['SH'], pass: false, short: 174_623, p3Failing: 20 },
		// the food forest at half, the same and one and a half times its yield
		forest: { ids: ['S02', 'B33'], pass: true, yields: [0.5, 1, 1.5], short: 0 },
		// surplus energy (geothermal and R&D) against none: person-days short, and the poorest tenth's living standard
		energy: { ids: ['X10'], pass: true, short: 0, shortWithout: 812_803, poorest: 8.3, poorestWithout: 6.69 },
		// twice the HEARTS: prices in the old index rose this many times; the largest change of what people got
		money: { ids: ['X9', 'B28'], pass: true, seeds: 5, prices: 2.0, largest: 0.003, consumption: 0.0004 },
		// Anna's lamp: the melt index after 30 years, 100 idle MIND after 10 years, the half-life (A04); a person's share
		// of all MIND after 30 years against the resting level (A05 fails: 85.1 % of it)
		melt: { ids: ['A04', 'A05'], pass: [true, false], years: 30, index30: 0.122456, idle: 100, idleYears: 10, keep10: 49.66, halfLife: 9.9, level30: 106_558, rest: 125_155 },
		// food bought abroad as a share of what was eaten, in the years of `at` and the last year; the first year the
		// village grew all it needs (comparison)
		food: { ids: ['F02', 'F03'], pass: null, bought: [0.76, 0.1, 0.06], at: [1, 10], selfYear: 9 },
		// treasuries pay out against keep their surplus: people's share of all MIND (X3 after 8 years, B02 after 30)
		payout: { ids: ['X3', 'B02'], pass: [true, false], years: [8, 30], x3: [0.893, 0.384], b02: [0.917, 0.435] },
		// holdings made as unequal as Germany's, then the melt: the Gini before, after the shock, and 10 years later
		germany: { ids: ['B05', 'X4'], pass: true, gini: [0.31, 0.7, 0.34], years: 10 },
		// Aven skills spread 0, 0.6 and 1.2: the Gini of holdings after 30 years
		avenSpread: { ids: ['B04'], pass: false, years: 30, spread: [0, 0.6, 1.2], gini: [0.05, 0.28, 0.43] },
		// Law 5 at 20, 35 and 50 %: the year from which the dividend yield stayed under the 7 % melt
		law5: { ids: ['B03'], pass: false, shares: [0.2, 0.35, 0.5], belowMeltFrom: [6, 8, 10] }
	}
};

/** the euro border (Section 8.3): the test village's people, the euros it needed from outside (the bootstrap number)
 *  and their range over five seeds, the build-out bill, and the years within which its exports did not repay them.
 *  An alias of TEST_CITY.bank */
export const EURO_BORDER = {
	people: TEST_CITY.people,
	euros: TEST_CITY.bank.bootstrap,
	range: TEST_CITY.bank.range,
	buildout: TEST_CITY.bank.buildout,
	years: TEST_CITY.years,
	repaid: TEST_CITY.bank.repaid
};
