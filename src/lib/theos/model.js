// @ts-nocheck — plain JS, kept loose on purpose
// The numbers behind the theOS paper: every figure and every number quoted in its text is computed here, so the
// prose and the charts can never drift apart.

/** the Universal Intent Allocation: HEARTS minted for every human, a day */
export const UIA_DAY = 24;
/** the hardcoded demurrage rate, a year */
export const RATE = 0.07;
/** Law 5, every sale pays its owners: the default share of every sale that goes at once to the seller's holders */
export const DIVIDEND_SHARE = 0.2;
/** a tenth of each treasury half flows into the protocol's pools. source: the liquidity rule (Section 6); scripts/theos-e2e-sim.mjs header ("10 % of treasury MIND flows into … baskets") */
export const POOL_DRIP = 0.1;
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

/** MIND a day that a founder controls when he invests all his HEARTS into his own COOP: both halves, less the tenth
 *  of the treasury half that drips into the pools; an honest investor keeps only the investor half */
export const selfDealDay = (pool = POOL_DRIP) => UIA_DAY * (0.5 + 0.5 * (1 - pool));
export const honestDay = () => UIA_DAY / 2;

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

/** Figure 6: the count of all HEARTS and MINDs per person (wallets, treasuries and pools) from three starts */
export const convergenceSeries = (r = RATE, years = 60) => {
	const star = steadyState(r);
	return [
		{ id: 'rich', label: 'Starts with 1,000,000 per person', b0: 1_000_000 },
		{ id: 'mid', label: `Starts at the 7 % steady state, ${fmt(steadyState(RATE))}`, b0: steadyState(RATE) },
		{ id: 'newborn', label: 'A new city, starts with 0', b0: 0 }
	].map((s) => ({ ...s, points: range(0, years, 240).map((t) => [t, balanceAt(s.b0, t, r)]), star }));
};

/** Figure 9: 1,000 HEARTS left idle and melting, against the yearly use of what they built, at a real rate of 0 or −1 % */
export const infraSeries = (years = 50) =>
	[
		{ id: 'idle', label: 'Idle HEARTS (−7 %)', r: RATE },
		{ id: 'loss', label: 'Project at −1 % real', r: 0.01 },
		{ id: 'flat', label: 'Project at 0 % real', r: 0 }
	].map((s) => ({ ...s, points: range(0, years, 200).map((t) => [t, decay(1000, s.r, t)]) }));

/** Figure 8: a basket's yearly LVR against how many MINDs it holds, for three kinds of MIND */
export const lvrSeries = () =>
	[
		{ id: 'calm', label: 'σ 20 %, independent', sigma: 0.2, rho: 0 },
		{ id: 'wild', label: 'σ 40 %, independent', sigma: 0.4, rho: 0 },
		{ id: 'linked', label: 'σ 40 %, correlated 0.6', sigma: 0.4, rho: 0.6 }
	].map((s) => ({ ...s, points: range(2, 8, 6).map((n) => [n, basketLvr(n, s.sigma, s.rho) * 100]) }));

/**
 * Figure 10: three cooperatives in one sector, replicator dynamics. Each COOP turns a HEART into f units of utility;
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

/** Figure 10 in numbers: the year in which C first leads the sector, and C's share (%) after `at` years */
export function selectionStats(learn = 0.05, at = 5, years = 30) {
	const [A, B, C] = selectionSeries(years, 0.25, learn).map((s) => s.points);
	const i = C.findIndex(([, c], j) => j > 0 && c > A[j][1] && c > B[j][1]);
	const k = C.findIndex(([t]) => Math.abs(t - at) < 1e-9);
	return { lead: i < 0 ? null : C[i][0], share: C[k][1] };
}

// ── Fair ownership (Section 9.3) ─────────────────────────────────────────────────────────────────────────────────────

/** Germany's wealth Gini today (Bundesbank PHF 2023), the start and the capitalism baseline of Figure 12 */
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

/** Figure 12: ownership inequality over 100 years, from Germany's spread today, under theOS with three spreads of returns */
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

/** Figure 13: the resting Gini against the spread of people's returns, for three demurrage rates; with `mu`, a fourth
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
// Source: sim-dynamic.md (research/e2e), run dyn:main of scripts/theos-e2e-sim.mjs, seed 20261012, 250 people × 60 years.
// Steady state = years 51–60. Every constant names its table; every ratio that the prose prints is a function below.

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
	shocks: 56, // D5
	restFrom: 51, // years 51–60: the run's rest, the years that the steady-state columns average
	runSeconds: 225, // the whole script's run time, s (sim-dynamic.md footer: "Runtime 225.1 s")
	seedCapacity: 1.15, // on day 1 the plants can make 115 % of the first needs, but nobody holds MIND
	shockAfterDays: 30, // proof check 1 looks at the 30 days after each shock …
	endAfterDays: 180 // … and the 180 days after each failure or exit
};

/** one day of basics for one person. source: scripts/theos-e2e-sim.mjs `BASIC`; proof check 1 (tolerance 98 %) */
export const BASIC_BUNDLE = { kcal: 2000, kWh: 3, m2: 20, L: 100, tolerance: 0.98 };

/** Proposition 3, checked per person on every day. source: sim-dynamic.md proof checks 1–2; D6.1; D6.2 */
export const PROOF = {
	fromDay: 8,
	personDays: 5_473_250,
	short: 0,
	worst: 1.0,
	shocks: 56,
	shockPersonDays: 2_055_250, // the 30 days after each shock
	shockWorst: 1.12,
	failures: 1,
	exits: 21,
	endedPersonDays: 777_000, // the 180 days after each failure or exit
	endedWorst: 1.4,
	shockShort: 0, // person-days short in the 30 days after the shocks (proof check 1)
	endedShort: 0, // … and in the 180 days after the ends
	genesis: { days: 7, worst: 0.12, short: 621, personDays: 1_750 },
	normal: { worst: 1.0, lowestHolding: 4_153, lowestYear: 2, livingThen: 13.91 }, // a day of living in year 2, R (D2)
	strict: {
		firstDay: 196, lastMissYear: 53, lastMissDay: 83, lastMissRatio: 0.96, shareAfter10: 0.9986, worst: 0.73, worstYear: 53,
		// the share of owner-only person-days that dividends alone covered, by year. source: D6.2 (years 1, 5, 10) and
		// sim-dynamic.csv, dyn:main, zero_aven_strict_share_of_days (years 3, 4, 6, 7, 8)
		byYear: { 1: 0.602, 3: 0.92, 4: 0.777, 5: 0.698, 6: 0.748, 7: 0.877, 8: 0.991, 10: 1.0 },
		lastShortYear: 8, // the last of the early years in which they missed on more than a few days (CSV)
		lateMissYears: [52, 53], // after year 10, the only years with a miss (CSV: 0.9946 and 0.9338; every other year 1)
		endRatio: 1.04 // the worst owner-only day in year 60: dividends ÷ basic bundle (D6.2)
	},
	bundleMindMax: 0.575, // the most MIND a day's basic bundle cost …
	bundleMindMaxYear: 3 // … in this year
};

/** the early year (from year `from` on; by default year 1, which holds the genesis week) in which dividends alone
 *  covered the fewest owner-only person-days, and that share. source: PROOF.strict.byYear (D6.2 and the CSV) */
export function strictWorstEarly(from = 1) {
	const e = Object.entries(PROOF.strict.byYear).filter(([y]) => +y >= from).sort((a, b) => a[1] - b[1])[0];
	return { year: +e[0], share: e[1] };
}

/** the normal test's margin: the MIND a day that a person's investing creates (half of the 24 HEARTS) against the most
 *  MIND that a day's basic bundle cost in the run. source: D6.2 / D7 ("bundle: max MIND a day (margin to 12)") */
export const bundleMargin = (max = PROOF.bundleMindMax) => UIA_DAY / 2 / max;

/** real consumption at the prices of day 1 (the genesis prices), R a person a day, by tenth of the people.
 *  source: sim-dynamic.md D6.3 */
export const DECILES = {
	years: [1, 5, 10, 20, 30, 40, 50, 60],
	d1: [12.6, 17.3, 28.5, 54.9, 84.8, 167.2, 206.7, 215.8],
	d5: [14.4, 26.4, 43.6, 226.7, 456.0, 1_057.5, 1_421.5, 1_984.4],
	d10: [18.8, 40.6, 72.5, 541.7, 1_223.8, 3_113.8, 4_767.9, 7_214.9],
	mean: [15.0, 28.0, 46.9, 255.1, 539.5, 1_279.7, 1_789.4, 2_564.8],
	gini: [0.06, 0.14, 0.14, 0.29, 0.32, 0.34, 0.36, 0.38] // the Gini index of real consumption
};

/** the same, every year (years 1–60), and the cost of a day's basic bundle in R.
 *  source: sim-dynamic.csv, run dyn:main, columns real_consumption_decile1/5/10 and basic_bundle_R */
export const LIVING = {
	d1: [12.6, 15.7, 16.0, 16.5, 17.3, 17.6, 18.9, 20.4, 26.2, 28.5, 28.4, 30.2, 31.8, 33.6, 36.4, 39.5, 49.7, 53.5, 55.1, 54.9, 60.7, 61.9, 62.3, 67.1, 70.1, 74.6, 78.8, 79.7, 83.9, 84.8, 83.2, 85.5, 88.7, 92.4, 98.2, 107.4, 120.0, 131.8, 147.4, 167.2, 187.3, 199.6, 214.6, 216.5, 223.9, 227.0, 226.3, 216.8, 211.4, 206.7, 200.5, 185.6, 183.2, 180.9, 188.7, 193.1, 196.9, 202.1, 205.9, 215.8],
	d5: [14.4, 19.2, 20.8, 23.4, 26.4, 29.7, 33.8, 37.5, 39.8, 43.6, 48.6, 56.9, 67.5, 83.0, 102.7, 123.1, 190.0, 218.9, 228.5, 226.7, 254.8, 257.6, 275.7, 302.8, 337.7, 358.6, 378.5, 401.2, 426.7, 456.0, 459.6, 492.6, 529.4, 569.5, 611.2, 682.3, 770.6, 850.3, 939.5, 1057.5, 1174.0, 1235.1, 1316.6, 1327.0, 1391.4, 1439.4, 1422.0, 1411.0, 1432.6, 1421.5, 1453.6, 1441.4, 1423.8, 1550.8, 1666.0, 1662.8, 1692.2, 1786.5, 1874.1, 1984.4],
	d10: [18.8, 27.9, 30.7, 35.8, 40.6, 45.6, 51.0, 60.4, 64.4, 72.5, 87.7, 108.3, 134.8, 174.2, 225.3, 278.0, 438.8, 520.4, 540.0, 541.7, 603.7, 621.6, 662.2, 717.0, 816.1, 898.7, 972.4, 1046.1, 1129.2, 1223.8, 1263.3, 1353.8, 1461.2, 1576.0, 1709.9, 1927.2, 2203.5, 2459.0, 2748.0, 3113.8, 3488.0, 3749.3, 4033.8, 4155.6, 4377.6, 4546.3, 4627.2, 4598.6, 4672.4, 4767.9, 4884.7, 4750.1, 5114.4, 5250.5, 5832.0, 6033.6, 6181.6, 6401.9, 6815.9, 7214.9],
	bundleR: [0.6612, 0.5972, 0.8462, 0.5044, 0.5241, 0.3995, 0.3836, 0.3340, 0.3148, 0.2778, 0.2463, 0.2218, 0.1993, 0.2302, 0.1982, 0.1902, 0.1880, 0.1785, 0.1723, 0.3124, 0.1802, 0.1653, 0.1632, 0.1612, 0.1593, 0.1576, 0.1558, 0.1541, 0.1525, 0.1510, 0.1495, 0.1482, 0.1468, 0.1453, 0.1441, 0.1428, 0.1415, 0.1404, 0.1393, 0.1383, 0.1373, 0.1363, 0.1354, 0.1345, 0.1337, 0.1961, 0.1315, 0.1305, 0.1294, 0.1291, 0.1265, 0.1491, 0.2035, 0.1181, 0.1122, 0.1059, 0.1018, 0.0994, 0.0974, 0.0961]
};

/** the owner-only people (every tenth person: their Avens deliver nothing, and they start with nothing).
 *  source: sim-dynamic.md D6.2 and its note (the mix at the end, and each MIND's dividend yield in year 60) */
export const OWNER_ONLY = {
	count: 25,
	holding40: 25_740, // mean holding, R, year 40
	holding60: 12_961, // year 60
	strictAvg40: 91.98, // dividends ÷ basic bundle, the group's average, year 40
	strictAvg60: 1.48, // year 60
	mix: { CITY: { share: 0.5, yield: 0.0 }, ARTS: { share: 0.11, yield: 0.015 }, WIND: { share: 0.06, yield: 0.0 } }
};

/** the dynamic world at rest (years 51–60), against the earlier static world. source: sim-dynamic.md D1, D8.
 *  mu and sigma are the CSV's rest means (mean_return, sigma_returns, years 51–60), so that giniRest gives D1's 0.24 */
export const DYN = {
	dayLiving: { y1: 5.2, y10: 81.1, y60: 209.0 }, // a day of living, R (D1)
	income: 247.5, // R a person a day (D1)
	spent: 0.87, // share of income spent (bought from COOPs) (D1)
	walletMelt: 0.12, // share of income that melts in wallets (D1)
	people: 0.75, // share of all MIND by value (D1)
	treasuries: 0.2,
	pools: 0.05,
	yield: 0.099, // dividend yield a year, all MIND by value (D1)
	mu: 0.0586, // lasting return: dividends plus price change (CSV rest mean; D1 prints 5.9 %)
	muRun: 0.0857, // the same over the whole run, years 2–60 (sim-dynamic.csv, dyn:main, mean of mean_return)
	muYearsAbove: { years: 39, of: 59 }, // years 2–60 in which mean_return was at or above the 7 % melt (same column)
	priceChange: -0.014, // MIND prices' yearly change in R at rest (D8 macro check: "price change -1.4 % a year in R")
	sigma: 0.0662, // its spread across people (CSV rest mean; D1 prints 6.6 %)
	gini2: 0.24, // Proposition 2's Gini from mu and sigma (D1)
	giniOwned: 0.37, // Gini of what people hold, years 51–60 (D1)
	giniOwnedBy: { y20: 0.3, y40: 0.34, y60: 0.38 }, // … by year, still rising at the end (D3)
	pricesMin: 0.3, // MIND prices at rest, R: lowest … (D1)
	pricesMax: 2.5, // … highest
	sdLog: 0.77,
	mindsAlive: 23, // (D1)
	outputPerPlant: 15.19, // output per unit of plant at the end, sales-weighted (D1); 1 on day 1
	failures: 1, // whole run (D1, D5)
	exits: 21,
	foundings: 29,
	money: 119_338, // MIND count a person (D1, D8)
	bundleChange: -0.029, // the basic bundle's yearly change in R, years 51–60 (D8)
	coopDaysShort: 1_436, // COOP-days short of working capital in 60 years (D8)
	coopDaysShortAfter10: 1_246, // … of them after year 10 (D8)
	topBottom: 2.9 // mean holding: top half of Aven pay ÷ bottom half (D8)
};

/** the earlier static world: one COOP per good (two for food), fixed tastes, prices capped at twice full cost, short
 *  reserves, no growth. source: sim-dynamic.md D1 (static column), S1, S5, S6.2, S6.3, S6.5, S6.6, S7; land: model.md §7.4 */
export const STATIC = {
	dayLiving: { y1: 13.9, y60: 12.1 }, // (D1)
	income: 35.2,
	spent: 0.34,
	walletMelt: 0.64,
	people: 0.94,
	treasuries: 0.01,
	pools: 0.05,
	yield: 0.008,
	mu: 0.005,
	giniOwned: 0.33,
	pricesMin: 0.99,
	pricesMax: 1.08,
	mindsAlive: 9,
	failures: 0,
	exits: 0,
	foundings: 0,
	topBottom: 2.6, // (S1)
	keepSurplus: 0.3, // people's share of MIND when treasuries keep their surplus (S1)
	routing: 0.0038, // routing cost of a payment at rest … (S1)
	routingFees: 0.0034, // … of it pool fees
	germany: [0.73, 0.44, 0.36], // Gini: made as unequal as Germany, then +10 and +20 years (S6.5)
	avenEven: 0.04, // Gini owned with all Avens alike (S5)
	avenDouble: 0.56, // with Avens that differ twice as much (S5)
	geo: { geo: 3.9, solar: 0.25 }, // 1 MIND after 20 years, with dividends, after the melt (S6.6)
	foodFailure: { withRule: 0.09, without: 1.0 }, // food shortfall the year after the main food COOP fails (S6.2)
	ring: { hearts: 0.0384, people: 0.016, income: 1.6, wealth: 1.5, years: 10 }, // a founder ring: share of HEARTS and of people, income and wealth (after 10 years) against others (S6.3)
	coldStart: { day1: 0.944, days1to30: 0.113, year1: 0.009 }, // shortfall without the bootstrap (S1)
	land: { private: 0.5, city: 0.29 }, // Gini after 40 years, private land against all land in the City COOP (model.md §7.4)
	coopDaysShort: 42 // COOP-days short of working capital in 60 years (S1)
};

/** Proposition 2 checked by simulating the process: an SDE run of 4,000 people against (10) at σ = 0.2.
 *  source: research/e2e/model.md, verification table ("SDE run (4,000 people): 0.287 against 0.291") */
export const SDE_CHECK = { sim: 0.287, formula: 0.291 };

/** treasuries at rest. source: sim-dynamic.md D4 (R a person a year, and reserves at the end in days of running costs) */
export const RESERVES = {
	months: 9,
	days: 270,
	minDays: 225,
	medianDays: 538,
	inflow: 85_593,
	items: 62_551,
	proposals: 4_309,
	dividends: 15_715
};
/** a share of all that flows into the treasuries at rest, as D4 books it (sales gross): 'items', 'proposals' or 'dividends' */
export const reserveShare = (k) => RESERVES[k] / RESERVES.inflow;
/** a share of what the treasury itself keeps of its inflow: sales after the Law 5 share, which goes at once from each
 *  sale to the holders and never passes through the treasury. 'items' or 'proposals'. source: D4 */
export const treasuryShare = (k) => RESERVES[k] / (RESERVES.inflow - RESERVES.dividends);

/** one run per variation of the main run. checks = [no one starves, no one has to work (normal), everyone gains];
 *  short = the basics short in the worst years; muAbove = μ at or above the 7 % melt; bundleMax = the most MIND a day's
 *  basic bundle cost (D7 proof checks, "bundle: max MIND a day"); shortYears / worstYear / worstYearShare = the years
 *  with basics short, and the worst of them (D7 notes). source: sim-dynamic.md D7 (both tables and the notes) */
export const LADDER = [
	{ id: 'main', bundleMax: 0.575, label: 'Main: Law 5 at 20 %, reserves 9 months', share: 0.2, months: 9, checks: [1, 1, 1], shortfall: 0, yield: 0.099, mu: 0.059, failures: 1, exits: 21, foundings: 29, short: [], broke: 'Nothing in checks 1 to 3. Dividends alone missed often in years 1 to 8' },
	{ id: 'law35', bundleMax: 72.398, label: 'Law 5 at 35 %', share: 0.35, checks: [0, 0, 0], shortfall: 0.0282, yield: 0.206, mu: 0.082, failures: 34, exits: 48, foundings: 70, short: ['food', 'energy', 'housing', 'water'], broke: 'Every basic ran short, worst in year 57; 34 COOPs failed' },
	{ id: 'law50', bundleMax: 2.433, label: 'Law 5 at 50 %', share: 0.5, checks: [0, 0, 0], shortfall: 0.0011, yield: 0.244, mu: 0.169, failures: 9, exits: 44, foundings: 64, short: ['food'], broke: 'Food ran short in years 1, 5 and 32' },
	{ id: 'res6', bundleMax: 0.541, label: 'Reserves 6 months', months: 6, checks: [0, 0, 0], shortfall: 0.0006, yield: 0.1, mu: 0.067, failures: 9, exits: 16, foundings: 20, short: ['food'], foodYear: 16, broke: 'Food ran short in year 16' },
	{ id: 'res12', bundleMax: 0.587, label: 'Reserves 12 months', months: 12, checks: [0, 0, 0], shortfall: 0.0003, yield: 0.1, mu: 0.051, failures: 4, exits: 17, foundings: 24, short: ['food'], foodYear: 3, broke: 'Food ran short in year 3' },
	{ id: 'prod0', bundleMax: 7.79, shortYears: 12, worstYear: 4, worstYearShare: 0.192, label: 'No productivity growth', checks: [0, 0, 0], shortfall: 0.0123, yield: 0.1, mu: 0.098, failures: 11, exits: 25, foundings: 36, short: ['food', 'housing'], broke: 'Basics ran short in 12 years, food worst; the poorest tenth stalled' },
	// plant: output per unit of plant in year 60 (sim-dynamic.csv, dyn:even, mean_productivity)
	{ id: 'even', bundleMax: 0.554, label: 'Even growth, 2 % for every COOP', checks: [1, 1, 0], shortfall: 0, yield: 0.101, mu: 0.11, failures: 0, exits: 9, foundings: 18, short: [], plant: 3.35, broke: 'The poorest tenth fell from year 30 to year 50' },
	{ id: 'wide', bundleMax: 0.534, label: 'Growth twice as uneven', checks: [0, 0, 1], shortfall: 0.001, yield: 0.1, mu: 0.08, failures: 3, exits: 17, foundings: 27, short: ['food'], broke: 'Food ran short in year 18, for owner-only people too' },
	{ id: 'wants', bundleMax: 0.897, label: 'Wants do not grow', checks: [0, 0, 0], shortfall: 0.0003, yield: 0.002, mu: -0.002, failures: 5, exits: 14, foundings: 19, short: ['food'], spent: 0.11, broke: 'People spent 11 % of income; dividends fell to almost nothing' },
	{ id: 'aven', bundleMax: 4.311, label: 'Fixed Aven capacity', checks: [0, 0, 0], shortfall: 0.0049, yield: 0.1, mu: 0.101, failures: 14, exits: 13, foundings: 18, short: ['food'], worst: 0.02, broke: 'Basics ran short in 13 years, food worst; the worst person-day had 2 %' },
	// ownerWorst: the worst owner-only person-day; poorOwner: the poorest owner-only person's real consumption, years 10 and 20
	{ id: 'pop', bundleMax: 0.585, label: 'Population grows 2 % a year (40 years)', checks: [0, 0, 0], shortfall: 0.0003, yield: 0.1, mu: 0.073, failures: 0, exits: 14, foundings: 21, short: ['food', 'energy', 'housing'], ownerWorst: 0.6, poorOwner: [13.7, 6.4], broke: 'Newcomers went short in their first weeks, and owner-only people too (worst 60 %)' }
];
/** the ten variations, without the main run */
export const variations = () => LADDER.filter((v) => v.id !== 'main');
/** how many variations reached a lasting return μ at or above the melt */
export const variationsMuAbove = (r = RATE) => variations().filter((v) => v.mu >= r).length;
/** how many variations ran short of food at all, and how many of nothing but food */
export const foodShort = () => variations().filter((v) => v.short.includes('food')).length;
export const foodOnlyShort = () => variations().filter((v) => v.short.length === 1 && v.short[0] === 'food').length;
/** how many variations left someone short of basics (check 1 failed) */
export const starveFail = () => variations().filter((v) => !v.checks[0]).length;
/** how many runs passed all three checks */
export const allPass = () => LADDER.filter((v) => v.checks.every(Boolean)).length;
/** the variation with this id */
export const variation = (id) => LADDER.find((v) => v.id === id);

/** prices in R and in days of living. source: sim-dynamic.md D2, first table */
export const PRICES_BY_YEAR = {
	1: { living: 5.24, bundleR: 0.661, bundleMind: 0.547, mindAvg: 1.21 },
	10: { living: 81.06, bundleR: 0.278, bundleMind: 0.185, mindAvg: 1.5 },
	30: { living: 180.58, bundleR: 0.151, bundleMind: 0.084, mindAvg: 1.79 },
	40: { living: 272.8, bundleR: 0.138, bundleMind: 0.055, mindAvg: 2.52 },
	60: { living: 209.0, bundleR: 0.096, bundleMind: 0.057, mindAvg: 1.68 }
};
/** a day's basic bundle as a share of a day of living, in year y */
export const bundleShareOfLiving = (y) => PRICES_BY_YEAR[y].bundleR / PRICES_BY_YEAR[y].living;

/** competition by good: the largest seller's share of what was made in year 1 and year 60 (null: none made that year),
 *  and the COOPs founded and ended over 60 years. source: sim-dynamic.md D5 (tables and lists) */
export const COMPETITION = [
	{ good: 'food', y1: 0.67, y60: 0.93, founded: 2, ended: 3 },
	{ good: 'energy', y1: 0.62, y60: 1.0, founded: 3, ended: 3 },
	{ good: 'housing', y1: 0.63, y60: 1.0, founded: 2, ended: 2 },
	{ good: 'water', y1: 1.0, y60: 1.0, founded: 0, ended: 0 },
	{ good: 'goods', y1: 0.59, y60: 0.94, founded: 4, ended: 2 },
	{ good: 'care', y1: 0.55, y60: 0.97, founded: 3, ended: 2 },
	{ good: 'experiences', y1: 0.55, y60: 0.97, founded: 5, ended: 5 },
	{ good: 'panels', y1: 1.0, y60: null, founded: 5, ended: 3 },
	{ good: 'materials', y1: 1.0, y60: 0.49, founded: 5, ended: 2 }
];
/** the one failure: the first food COOP, AGRI, in year 18 (D5) */
export const FAILURE = { coop: 'AGRI', good: 'food', year: 18 };
/** the three energy COOPs founded later, each of which exited within this many years (D5: y4→y7, y20→y23, y52→y55) */
export const ENERGY_ENTRANTS = { count: 3, years: 3 };

/** every MIND over its life. source: sim-dynamic.md D2, second table */
export const MIND_RETURNS = { minds: 45, ended: 22, withThreeYears: 44, aboveMelt: 19, aboveMeltEnded: 12, arts: { compounded: 0.187, years: 59 } };

/** the round trip at rest (years 51–60), in R a person a day. Places: people's wallets, COOP treasuries, pools; each with
 *  what flows in and out, what price moves did to what it holds, and the change of what it holds.
 *  source: sim-dynamic.md D8. No human labour is paid: every human's Aven delivers the work items. */
// net and rest: D8's own "in − out" and "not explained" columns, printed as D8 prints them (the sums of the rounded
// flows above can differ from them by 0.01)
export const ROUND_TRIP = {
	people: { in: { own: 21.3, items: 171.36, proposals: 11.81, dividends: 43.05 }, out: { buying: 215.14, melt: 30.14, retired: 0.02 }, net: 2.21, moves: -6.67, change: -4.49, rest: -0.03 },
	treasuries: { in: { own: 19.17, sales: 215.14 }, out: { dividends: 43.05, items: 171.36, proposals: 11.81, melt: 8.21 }, net: -0.13, moves: -2.82, change: -2.94, rest: 0.0 },
	pools: { in: { tenth: 2.13, routing: 0.04 }, out: { melt: 2.1, retired: 0.02 }, net: 0.05, moves: -0.26, change: -0.21, rest: 0.0 },
	issuedMind: 24.0, // MIND a person a day (24 HEARTS converted)
	meltedMind: 22.84,
	retiredMind: 0.17, // left with COOPs that ended
	stockGrowth: 0.99, // the MIND stock still grew by this much a person a day
	unexplainedMax: 0.0006, // the largest unexplained rest, as a share of a place's inflow (D8 macro check)
	between: { sales: 0.11, rent: 0.06 } // flows between treasuries, which cancel out
};

/** the same in the earlier static world. source: sim-dynamic.md S7 (no price moves were recorded there) */
export const ROUND_TRIP_STATIC = {
	people: { in: { own: 12.31, items: 3.95, proposals: 16.52, dividends: 2.46 }, out: { buying: 12.09, melt: 22.65 } },
	treasuries: { in: { own: 11.08, sales: 12.09 }, out: { dividends: 2.46, items: 3.95, proposals: 16.52, melt: 0.22 } },
	pools: { in: { tenth: 1.23 }, out: { melt: 1.21 } },
	issued: 24.62,
	melted: 24.08,
	money: 122_603
};

/** the mean cost of a day's basic bundle at rest, R, over the same years as D8. source: sim-dynamic.csv basic_bundle_R,
 *  dyn:main, mean of years 51–60 */
export const BUNDLE_REST = 0.121;

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

/** a flow as a share of a person's income (people's inflow), for Figure 14's arrows */
export const ofIncome = (v, rt = ROUND_TRIP) => v / flowSum(rt.people.in);

/** the share of income that people spend if they spend the share θ of what they hold a year: θ / (θ + r) */
export const spendShare = (theta = SIM.spendRate, r = RATE) => theta / (theta + r);

/** the normal test, as a property of what a person owns: years until a holding W (R) runs out if it alone pays the
 *  basic bundle p (R a day), with no dividends, no new ownership and the melt r: (1/r)·ln(1 + r·W / (365·p)).
 *  Default: the lowest owner-only holding (year 2) against that year's basic bundle (sim-dynamic.csv basic_bundle_R) */
export const holdingCoverYears = (W = PROOF.normal.lowestHolding, p = LIVING.bundleR[PROOF.normal.lowestYear - 1], r = RATE) =>
	Math.log(1 + (r * W) / (365 * p)) / r;
/** the lowest owner-only holding in days of living of its year (D2: a day of living in year 2) */
export const holdingLivingDays = () => PROOF.normal.lowestHolding / PROOF.normal.livingThen;

/** the strict test's threshold at rest: the share of the mean holding at which Law 5 dividends alone pay for a day's
 *  basics, p_b / (λ · Y), Y = what people buy from COOPs a day */
export const strictThreshold = () => BUNDLE_REST / (DIVIDEND_SHARE * ROUND_TRIP.people.out.buying);

/** the dividend yield of the owner-only people's holdings in year 60: dividends a year ÷ holding */
export const ownerOnlyYield = () => (OWNER_ONLY.strictAvg60 * PRICES_BY_YEAR[60].bundleR * 365) / OWNER_ONLY.holding60;

/** the yearly sales, as a share of the MIND that others hold, that a dividend yield implies: yield ÷ Law 5's share */
export const impliedSales = (y = DYN.yield, share = DIVIDEND_SHARE) => y / share;

/** years until a spread holding that is not spent halves, when it earns the lasting return mu: ln 2 / (r − μ) */
export const netHalfLife = (mu = DYN.mu, r = RATE) => Math.LN2 / (r - mu);

/** how far the lasting return stays below the melt, in points */
export const meltMargin = (mu = DYN.mu, r = RATE) => (r - mu) * 100;

/** what Eq. (3) predicts for the MIND stock's growth at the simulated level: (u − r·m) / 365, MIND a person a day */
export const stockGrowthDay = (m = DYN.money, r = RATE, u = UIA_DAY * 365) => (u - r * m) / 365;

/** how far the simulated money per person stays below u/r */
export const moneyGap = () => DYN.money / steadyState() - 1;

/** the owner-only people's dividends as a share of what flowed in to them, in year y (40 or 60): dividends (D6.2
 *  average × that year's bundle, R) against dividends plus the 12 MIND a day that their investing creates, valued at
 *  the average MIND price (D2). An estimate: the MIND they invest in need not trade at the average */
export const ownerOnlyDividendShare = (y) => {
	const div = OWNER_ONLY[`strictAvg${y}`] * PRICES_BY_YEAR[y].bundleR;
	return div / (div + (UIA_DAY / 2) * PRICES_BY_YEAR[y].mindAvg);
};

/** how many times a tenth's real consumption grew: 'd1', 'd5', 'd10' or 'mean', from year y0 to year y1 */
export const growth = (key, y0 = 1, y1 = 60) => DECILES[key][DECILES.years.indexOf(y1)] / DECILES[key][DECILES.years.indexOf(y0)];

/** the same as a yearly rate, compounded: growth(key)^(1/(y1 − y0)) − 1 */
export const growthRate = (key, y0 = 1, y1 = 60) => Math.pow(growth(key, y0, y1), 1 / (y1 - y0)) - 1;
/** output per unit of plant as a yearly rate (1 on day 1, DYN.outputPerPlant in year 60) */
export const plantGrowthRate = (end = DYN.outputPerPlant, years = SIM.years - 1) => Math.pow(end, 1 / years) - 1;

/** the ten-year windows in which the poorest tenth fell: [from, to] pairs over the yearly series */
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

/** Figure 15: real consumption a day of the poorest, the middle and the richest tenth, every year */
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
