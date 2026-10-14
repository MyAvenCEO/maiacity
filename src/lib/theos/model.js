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
 *  unless a large majority renews it, hours. redeem: redemption from the city's pools (audit B16, accepted 2026-10-14):
 *  it needs this majority of the citizen shares; at most capYear of a pool may be redeemed in a year (a policy, set by
 *  MIP; this is its default); and it waits as long as a code change (Appendix F) */
const WAIT_DAYS = 30;
export const GOVERNANCE = {
	waitDays: WAIT_DAYS,
	pauseHours: 72,
	redeem: { majority: 2 / 3, of: 'citizen shares', capYear: 0.1, capKind: 'policy', waitDays: WAIT_DAYS }
};

/** what each holder of a COOP's MIND gets (the holder rule, Section 9): a Law 5 dividend, and a vote in the COOP. The
 *  COOP's own treasury gets neither; the city's pools get their dividend but no vote (the coordinator's default, which
 *  Samuel has not confirmed yet: answered false); people and other COOPs' treasuries get both. The economic model pays
 *  the arbitrage bot as a holder too (it has no vote in the model, which has no votes) */
export const HOLDER_RULE = {
	ownTreasury: { dividend: false, vote: false },
	pools: { dividend: true, vote: false, answered: false },
	people: { dividend: true, vote: true },
	otherTreasuries: { dividend: true, vote: true }
};

/** the rules and policies that Samuel accepted on 2026-10-14 (13:04: "apply all A, B, C where it still fits") and that
 *  Part II adds; packages B and C write their words. kind: 'rule' (part of the protocol; it changes only with a new
 *  version of it, Appendix F), 'policy' (a setting that the City COOP chooses by MIP; its default here) or 'open' (not
 *  decided; a hypothesis tracks it). audit: the open problem it answers. sim: how the economic model runs it today:
 *  'same', 'differs' (it runs otherwise, said in why), 'testing' (a run is under way) or 'none' (not modelled). The
 *  Avens' default investment rule (B7) is already in Part II's table of kinds; the MIP's long name waits on Samuel */
export const ACCEPTED = {
	// B16: redemption from the pools; the majority and the wait are rules, the yearly cap a policy
	redemption: { kind: 'rule', audit: 'B16', terms: GOVERNANCE.redeem, sim: 'none' },
	// B5: the City COOP keeps a water part inside its reserve. A word, not a number: no simulation sets one yet
	waterReserve: { kind: 'policy', audit: 'B5', keeper: 'the City COOP', within: 'its reserve', value: null, sim: 'none' },
	// B8(c): no COOP whose MIND trades in a basket may refuse an investment
	noRefusal: { kind: 'rule', audit: 'B8(c)', sim: 'same' },
	// B9: ground rent is a sale, so Law 5 pays its share to cityMIND's holders, not to the City COOP's own treasury. The
	// economic model books rent as a flow between treasuries, not a sale (D8, D6.2 note); a run with rent as a sale is
	// under way, and H15 tracks it
	groundRent: { kind: 'rule', audit: 'B9', share: DIVIDEND_SHARE, payee: "cityMIND's holders", sim: 'testing', hypothesis: 'H15' },
	// B12: only COOPs build (a person builds through a COOP)
	onlyCoopsBuild: { kind: 'rule', audit: 'B12', sim: 'same' },
	// B12: no person sells MIND for euros; only the City COOP's euro bank crosses the border (Section 8.3)
	euroBank: { kind: 'rule', audit: 'B12', sim: 'none' },
	// B12: the founders' euros are the MaiaCity COOP's starting balance from outside
	foundersEuros: { kind: 'rule', audit: 'B12', holder: 'the MaiaCity COOP', sim: 'none' },
	// B14: a successor that leases a failed plant carries on the failed COOP's MIND; nothing new is minted. The economic
	// model gives the successor a new MIND (scripts/theos-e2e-sim.mjs successor(): "same plant, new MIND")
	successorMind: { kind: 'rule', audit: 'B14', newMind: false, sim: 'differs' },
	// B15: what happens to a person's holdings when they die stays open; H16 tracks it
	estates: { kind: 'open', audit: 'B15', hypothesis: 'H16', sim: 'none' },
	// the holder rule for the pools' MIND (HOLDER_RULE.pools)
	poolMind: { kind: 'rule', audit: 'holder rule', dividend: true, vote: false, answered: false, sim: 'same' }
};

/** the version of the paper being published, for the masthead and the cite-as line */
export const VERSION = { n: 'v7', date: 'October 2026' };

/** the names of our simulations (Section 11), in one place, so that a rename is one edit here */
export const SIM_NAMES = {
	model: 'the economic model',
	testCity: 'the test city',
	round: (n) => `the test city, round ${n}`,
	roundShort: (n) => `round ${n}`,
	// the economic model's versions (MODEL_VERSIONS ids)
	versions: {
		static: 'the static world',
		dynamic: 'the dynamic world',
		hearts: 'the HEART report',
		idle: 'the idle-plant rule',
		law5all: 'Law 5 paid to the pools'
	}
};

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

/** the life expectancy in Laborde's worked example (years) */
export const RTM_LIFE = 80;

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

/** Figure 14: what a holder keeps of 1,000 HEARTS invested in year 1 of the main run, valued in HEARTS, against the
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
 * Figure 8: three cooperatives in one sector, replicator dynamics. Each COOP turns a HEART into f units of utility;
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

/** Figure 8 in numbers: the year in which C first leads the sector, and C's share (%) after `at` years */
export function selectionStats(learn = 0.05, at = 5, years = 30) {
	const [A, B, C] = selectionSeries(years, 0.25, learn).map((s) => s.points);
	const i = C.findIndex(([, c], j) => j > 0 && c > A[j][1] && c > B[j][1]);
	const k = C.findIndex(([t]) => Math.abs(t - at) < 1e-9);
	return { lead: i < 0 ? null : C[i][0], share: C[k][1] };
}

// ── Fair ownership (Sections 9.2 and 11.2.5) ─────────────────────────────────────────────────────────────────────────────────────

/** Germany's wealth Gini today (Bundesbank PHF 2023), the start and the capitalism baseline of Figure 9 */
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

/** Figure 9: ownership inequality over 100 years, from Germany's spread today, under theOS with three spreads of returns */
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

/** Figure 10: the resting Gini against the spread of people's returns, for three demurrage rates */
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
// Source: research/e2e/law5-all/sim-dynamic.md, .json and .csv, the output of scripts/theos-e2e-sim.mjs at the merge of
// ab8ed86 (run dyn:main, seed 20261012, 250 people × 60 years, Law 4's 0.5 / 0.4 / 0.1, Law 5 paid to every holder of
// the seller's MIND but its own treasury, the city's pools included (key divPools), and the idle-plant rule: the City
// re-lets a failed COOP's plant only while its demand is at least a quarter of its capacity). Run 2026-10-14. The
// paper's last version (#599) ran Law 5 without the pools; its numbers are kept where a version is compared
// (MODEL_VERSIONS, SEEDS.law5old, SAME_SHOCK.law5 and .v599, the 'law5old' row of LADDER). Steady state = years 51–60.
// Every constant names its table; every ratio that the prose prints is a function below. The unit is the HEART
// (Section 6.3): the script values every flow at the HEART index of the step in which it happens and prints these
// values in its tables H1 to H8 ("H2" … name them); the tables D1 to D8 and S1 to S7 count in R, the old basket of
// three MINDs. R a HEART drifted from 1.07 (year 1) to 1.30 (year 40) and 1.06 (year 60), so numbers in R and in HEARTS
// differ (OLD_R).

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
	// Law 5 pays every holder of the seller's MIND but its own treasury: people, other treasuries, the city's pools and
	// the arbitrage bot (scripts/theos-e2e-sim.mjs key divPools; false is the rule of the paper's last version, #599)
	law5Pools: true,
	spendRate: 0.5, // people spend about half of what they hold a year (θ); D3 note
	foundingMargin: 0.3, // a rival is founded when a margin over full cost stays above 30 % …
	foundingDays: 90, // … for 90 days
	prodGrowth: 0.02, // productivity rises about 2 % a year, unevenly (an assumption)
	prodRange: [-0.005, 0.06], // each COOP's yearly rate is drawn around it, between these (scripts/theos-e2e-sim.mjs drawGrowth)
	shockDepth: [0.3, 0.5], // capacity shocks of 30–50 % …
	shockMonths: [2, 8], // … for 2–8 months
	shocks: 70, // D5
	restFrom: 51, // years 51–60: the run's rest, the years that the steady-state columns average
	runSeconds: 288, // the whole script's run time, s (sim-dynamic.md footer: "Runtime 288.2 s")
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
	short: 0, // person-days below 98 % of the basics, from day 8 (check 1 holds)
	worst: 1.0, // the worst person-day from day 8: 100 % of the basics …
	worstYear: 1, // … in year 1, day 14
	worstDay: 14,
	// the years with basics short from day 8 (D7 notes: the share of that year's person-days, and the goods short): none
	shortYears: [],
	shocks: 70,
	shockPersonDays: 2_227_750, // the 30 days after each shock
	shockWorst: 1.09,
	failures: 3,
	exits: 12,
	endedPersonDays: 651_000, // the 180 days after each failure or exit
	endedWorst: 1.09,
	shockShort: 0, // person-days short in the 30 days after the shocks (proof check 1)
	endedShort: 0, // … and in the 180 days after the ends
	genesis: { days: 7, worst: 0.12, short: 449, personDays: 1_750 },
	// the normal test (check 2) holds: the owner-only people had their basics on every day from day 8 (worst 100 %, no
	// person-day below 98 %). Their lowest holding from year 2 on, HEARTS, and a day of living that year, HEARTS (H3 note)
	normal: { worst: 1.0, short: 0, lowestHolding: 3_438, lowestYear: 2, livingThen: 9.946 },
	strict: {
		firstDay: 212, lastMissYear: 60, lastMissDay: 363, lastMissRatio: 0.61, shareAfter10: 0.7735, worst: 0.3, worstYear: 39,
		// the share of owner-only person-days that dividends alone covered, every year 1–60. source: sim-dynamic.csv,
		// dyn:main, zero_aven_strict_share_of_days (D6.2 prints years 1, 2, 5, 10, … 60)
		series: [0.4615, 0.8015, 0.3969, 0.3546, 0.2654, 0.3238, 0.2477, 0.4631, 0.9147, 0.9992, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.9675, 0.8838, 0.7946, 0.7969, 0.9815, 0.7454, 0.6877, 0.8921, 1, 1, 1, 0.9931, 0.9162, 0.7669, 0.2453, 0.0015, 0, 0, 0, 0, 0, 0, 0, 0],
		// the same for years 1–10
		byYear: { 1: 0.4615, 2: 0.8015, 3: 0.3969, 4: 0.3546, 5: 0.2654, 6: 0.3238, 7: 0.2477, 8: 0.4631, 9: 0.9147, 10: 0.9992 },
		lastShortYear: 9, // the last of the early years in which they missed on more than a few days (CSV)
		// after year 10, the years with a miss (CSV): 37 to 44, and 48 to 60; years 45 to 47 had none
		lateMiss: { from: 37, to: 60, runs: [[37, 44], [48, 60]] },
		lateMissEnd: 0, // the share of owner-only person-days that dividends alone covered in year 60 (D6.2: 0.0 %)
		endRatio: 0.61 // the worst owner-only day in year 60: dividends ÷ basic bundle (D6.2)
	},
	bundleMax: 0.889, // the most a day's basic bundle cost in a year, HEARTS … (H2; from year 2 on 0.699 in year 6; the script's "in MIND" gives 0.671 in year 6)
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
	d1: [12.8, 17.2, 25.6, 42.9, 62.5, 70.0, 96.6, 114.3],
	d2: [13.5, 20.4, 34.7, 88.2, 162.7, 245.8, 365.9, 416.2], // the second tenth (D6.3, column D2)
	d5: [14.5, 25.4, 43.6, 151.7, 299.8, 481.4, 765.6, 983.2],
	d10: [18.7, 38.8, 79.7, 352.2, 738.9, 1_227.7, 2_010.3, 2_533.3],
	mean: [15.0, 26.9, 47.8, 169.1, 345.8, 556.9, 881.2, 1_096.8],
	gini: [0.06, 0.13, 0.17, 0.27, 0.3, 0.32, 0.33, 0.33] // the Gini index of real consumption
};

/** the same, every year (years 1–60), and the cost of a day's basic bundle in HEARTS. The CSV has no yearly column for
 *  the second tenth; DECILES.d2 has it at the marks.
 *  source: sim-dynamic.csv, run dyn:main, columns real_consumption_decile1/5/10 and basic_bundle_H (each step's cost
 *  at that step's HEART values, averaged over the year; H8) */
export const LIVING = {
	d1: [12.8, 15.2, 16.0, 15.7, 17.2, 18.3, 19.6, 19.2, 23.7, 25.6, 27.2, 29.0, 31.1, 33.7, 33.5, 35.7, 37.3, 38.9, 41.4, 42.9, 43.8, 44.9, 49.1, 51.1, 55.0, 56.9, 57.9, 60.1, 61.7, 62.5, 62.4, 64.4, 65.5, 66.0, 65.8, 65.9, 66.7, 67.3, 68.5, 70.0, 72.4, 75.1, 77.7, 80.4, 82.8, 85.8, 89.2, 91.9, 94.3, 96.6, 98.4, 100.8, 100.9, 105.5, 105.8, 106.7, 107.7, 109.6, 111.6, 114.3],
	d5: [14.5, 18.3, 20.2, 21.9, 25.4, 29.3, 33.9, 35.3, 39.3, 43.6, 51.3, 63.5, 78.5, 94.5, 95.5, 108.7, 119.7, 131.8, 141.2, 151.7, 163.6, 174.8, 176.9, 194.3, 220.7, 238.0, 251.6, 269.1, 284.7, 299.8, 311.1, 331.9, 350.7, 370.6, 390.1, 406.1, 433.1, 454.9, 469.8, 481.4, 489.1, 535.9, 575.8, 605.4, 630.0, 654.2, 686.5, 705.4, 735.8, 765.6, 791.7, 824.6, 816.1, 870.3, 846.2, 857.1, 885.2, 921.8, 955.3, 983.2],
	d10: [18.7, 26.3, 30.7, 34.3, 38.8, 44.2, 53.8, 58.2, 66.7, 79.7, 101.9, 138.1, 182.9, 234.7, 230.5, 256.5, 281.4, 305.1, 326.7, 352.2, 380.1, 412.5, 459.5, 468.4, 510.6, 559.0, 598.8, 641.9, 692.5, 738.9, 764.7, 811.5, 857.1, 906.6, 955.5, 1003.0, 1059.4, 1113.9, 1171.1, 1227.7, 1291.5, 1356.4, 1449.7, 1518.9, 1597.2, 1684.7, 1773.6, 1846.8, 1929.7, 2010.3, 2088.3, 2164.6, 2161.2, 2272.7, 2252.5, 2262.1, 2305.5, 2377.0, 2456.8, 2533.3],
	bundle: [0.8888, 0.5611, 0.6403, 0.5441, 0.5752, 0.6994, 0.4223, 0.5079, 0.3637, 0.2719, 0.2337, 0.2212, 0.2073, 0.2048, 0.2736, 0.2594, 0.1911, 0.1864, 0.1815, 0.1762, 0.1666, 0.1584, 0.1535, 0.1588, 0.1529, 0.1747, 0.2357, 0.1296, 0.1269, 0.1241, 0.1219, 0.1183, 0.1153, 0.1129, 0.1118, 0.1118, 0.1083, 0.1048, 0.1024, 0.1004, 0.1011, 0.0965, 0.0819, 0.0756, 0.0748, 0.0735, 0.0719, 0.0718, 0.07, 0.0693, 0.0683, 0.0681, 0.0692, 0.0692, 0.0735, 0.075, 0.0747, 0.0736, 0.0726, 0.0716]
};

/** the owner-only people (every tenth person: their Avens deliver nothing, and they start with nothing).
 *  source: H3 note (holdings, HEARTS), D6.2 (the group's average of dividends ÷ basic bundle) and its note (the mix at
 *  the end, and each MIND's dividend yield in year 60, all 0.0 %: MAT3 is a materials COOP, GOODS a goods COOP that
 *  sold almost nothing by year 60, and WIND an energy COOP with no share of its market in year 60, D5) */
export const OWNER_ONLY = {
	count: 25,
	holding40: 8_138, // mean holding, HEARTS, year 40 (H3 note)
	holding60: 8_151, // year 60
	strictAvg40: 3.78, // dividends ÷ basic bundle, the group's average, year 40
	strictAvg60: 0.66, // year 60
	mix: { CITY: { share: 0.43, yield: 0.0 }, MAT3: { share: 0.27, yield: 0.0 }, GOODS: { share: 0.08, yield: 0.0 }, WIND: { share: 0.07, yield: 0.0 }, HABITAT: { share: 0.06, yield: 0.0 } }
};

/** the dynamic world in the last ten years (years 51–60), against the earlier static world. source: sim-dynamic.md D1, D8, and for
 *  every value in HEARTS H2. mu and sigma are the rest means of each year's mean return and its spread across people,
 *  in HEARTS (H2). In R the script printed mu 5.1 % (D1); the gap is R's drift (Appendix G) */
export const DYN = {
	dayLiving: { y1: 4.6, y10: 47.4, y60: 108.6 }, // a day of living, HEARTS (H2)
	income: 124.0, // HEARTS a person a day (H2)
	spent: 0.87, // share of income spent (bought from COOPs) (D1)
	walletMelt: 0.12, // share of income that melts in wallets (D1)
	people: 0.654, // share of all MIND by HEART value (H2)
	treasuries: 0.14,
	pools: 0.204,
	bot: 0.001, // the arbitrage bot (H2)
	poolDepth: 24_589, // what the pools hold at rest, HEARTS a person (H2; 22,658 MIND)
	yield: 0.0755, // dividend yield a year, all MIND by value (D1, H2: 7.6 %)
	mu: 0.0733, // lasting return in HEARTS: dividends plus price change, in the last ten years (H2: 7.33 %; in R 5.14 %)
	muRun: 0.0847, // the same over the whole run, years 2–60 (H2: 8.47 %; in R 8.07 %)
	muYearsAbove: { years: 47, of: 59 }, // years 2–60 in which it was at or above the 7 % melt (H2; in R 40 of 59)
	priceChange: -0.0022, // the price part of mu in the last ten years, in HEARTS (H2: −0.22 %; in R −2.42 %)
	sigma: 0.0525, // its spread across people (H2: 5.25 %; in R 5.26 %)
	gini2: 1.0, // Proposition 2's Gini from mu and sigma (H2): 1 when mu is at or above the melt
	giniOwned: 0.33, // Gini of what people hold, years 51–60 (D1; H2: 0.331)
	giniOwnedBy: { y20: 0.29, y40: 0.34, y50: 0.33, y60: 0.33 }, // … by year (D3; H8: 0.290, 0.336, 0.329, 0.334)
	giniTrend: 0.007, // its least-squares trend over years 41–60, a 10 years (H2, H8: +0.007)
	pricesMin: 0.3, // MIND values in the last ten years, HEARTS: lowest … (H2)
	pricesMax: 1.43, // … highest
	sdLog: 0.4,
	mindsAlive: 20, // (D1)
	outputPerPlant: 10.78, // output per unit of plant at the end, sales-weighted (D1); 1 on day 1
	failures: 3, // whole run (D1, D5)
	exits: 12,
	foundings: 19,
	money: 120_414, // MIND count a person (D1, D8)
	bundleChange: 0.0032, // the basic bundle's yearly change in HEARTS, years 51–60 (H2: +0.32 %, dearer; in R −1.85 %, D8 −1.8 %)
	coopDaysShort: 1_529, // COOP-days short of working capital in 60 years (D8)
	coopDaysShortAfter10: 273, // … of them after year 10 (D8)
	topBottom: 2.6 // mean holding: top half of Aven pay ÷ bottom half (D8)
};

/** the earlier static world: one COOP per good (two for food), fixed tastes, prices capped at twice full cost, short
 *  reserves, no growth. source: sim-dynamic.md D1 (static column), S1, S5, S6.2, S6.3, S6.5, S6.6, S7, and in HEARTS
 *  H2 (static column) and H7; land: model.md §7.4 */
export const STATIC = {
	dayLiving: { y1: 11.8, y60: 11.9 }, // HEARTS (H2)
	income: 33.1, // HEARTS a person a day (H2)
	spent: 0.36,
	walletMelt: 0.63,
	people: 0.882, // by HEART value (H2)
	treasuries: 0.009,
	pools: 0.109,
	yield: 0.007,
	mu: 0.0052, // HEARTS (H2: 0.52 %)
	giniOwned: 0.34,
	pricesMin: 0.98, // HEARTS (H2)
	pricesMax: 1.04,
	mindsAlive: 9,
	failures: 0,
	exits: 0,
	foundings: 0,
	topBottom: 2.7, // (S1)
	keepSurplus: 0.25, // people's share of MIND when treasuries keep their surplus (S1)
	routing: 0.0039, // routing cost of a payment in the last ten years … (S1)
	routingFees: 0.0035, // … of it pool fees
	germany: [0.7, 0.42, 0.35], // Gini: made as unequal as Germany, then +10 and +20 years (S6.5)
	avenEven: 0.06, // Gini owned with all Avens alike (S5)
	avenDouble: 0.59, // with Avens that differ twice as much (S5)
	foodFailure: { withRule: 0.09, without: 1.0 }, // food shortfall the year after the main food COOP fails (S6.2)
	ring: { hearts: 0.0362, people: 0.016, income: 1.5, wealth: 1.4, years: 10 }, // a founder ring: share of HEARTS and of people, income and wealth (after 10 years) against others (S6.3)
	coldStart: { day1: 0.944, days1to30: 0.209, year1: 0.017 }, // shortfall without the bootstrap (S1)
	land: { private: 0.5, city: 0.29 }, // Gini after 40 years, private land against all land in the City COOP (model.md §7.4)
	coopDaysShort: 30 // COOP-days short of working capital in 60 years (S1)
};

/** Proposition 2 checked by simulating the process: an SDE run of 4,000 people against the Gini formula of Section 9.2 at σ = 0.2.
 *  source: research/e2e/model.md, verification table ("SDE run (4,000 people): 0.287 against 0.291") */
export const SDE_CHECK = { sim: 0.287, formula: 0.291 };

/** treasuries in the last ten years. source: sim-dynamic.md D4 (reserves at the end in days of running costs) and H3 note
 *  (HEARTS a person a year, booked as D4 books them) */
export const RESERVES = {
	months: 9,
	days: 270,
	minDays: 149,
	medianDays: 1_246,
	inflow: 43_067,
	items: 31_401,
	proposals: 2_735,
	dividends: 7_864 // all Law 5 dividends that the treasuries pay: to people, other treasuries, the pools and the bot
};
/** a share of all that flows into the treasuries in the last ten years, as D4 books it (sales gross): 'items', 'proposals' or 'dividends' */
export const reserveShare = (k) => RESERVES[k] / RESERVES.inflow;
/** a share of what the treasury itself keeps of its inflow: sales after the Law 5 share, which goes at once from each
 *  sale to the holders and never passes through the treasury. 'items' or 'proposals'. source: D4 */
export const treasuryShare = (k) => RESERVES[k] / (RESERVES.inflow - RESERVES.dividends);

/** one run per variation of the main run. checks = [no one starves, no one has to work (normal), everyone gains];
 *  no run passed the strict test (D7: "(✗)" on every row; strict: 1 would mark one that did);
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
	{ id: 'main', bundleMax: 0.889, share: 0.2, months: 9, checks: [1, 1, 1], shortfall: 0, yield: 0.0755, mu: 0.0733, sigma: 0.0525, failures: 3, exits: 12, foundings: 19, short: [], falls: [] },
	{ id: 'law35', bundleMax: 1.021, share: 0.35, checks: [1, 1, 0], shortfall: 0, yield: 0.0988, mu: 0.019, sigma: 0.0899, failures: 12, exits: 40, foundings: 57, short: [], falls: [['the poorest tenth', 30, 40], ['the second tenth', 30, 40]] },
	{ id: 'law50', bundleMax: 1.277, share: 0.5, checks: [0, 0, 0], shortfall: 0.0002, yield: 0.122, mu: 0.1154, sigma: 0.1103, failures: 8, exits: 47, foundings: 71, short: ['food'], foodYears: [47, 52], worst: 0.62, falls: [['the poorest tenth', 30, 40], ['the poorest tenth', 50, 60]] },
	{ id: 'res6', bundleMax: 0.906, months: 6, checks: [0, 0, 1], shortfall: 0.0003, yield: 0.0407, mu: -0.0001, sigma: 0.0065, failures: 5, exits: 18, foundings: 28, short: ['food'], foodYears: [8], worst: 0.77, falls: [] },
	{ id: 'res12', bundleMax: 0.911, months: 12, checks: [1, 1, 1], shortfall: 0, yield: 0.0404, mu: 0.002, sigma: 0.0037, failures: 1, exits: 13, foundings: 18, short: [], falls: [] },
	{ id: 'prod0', bundleMax: 3.301, shortYears: 5, worstYear: 7, worstYearShare: 0.096, checks: [0, 0, 0], shortfall: 0.0026, yield: 0.0608, mu: 0.049, sigma: 0.0534, failures: 5, exits: 16, foundings: 25, short: ['food'], worst: 0.69, falls: [['the poorest tenth', 30, 40], ['the three poorest tenths', 50, 60]] },
	// plant: output per unit of plant in year 60 (sim-dynamic.csv, dyn:even, mean_productivity)
	{ id: 'even', bundleMax: 0.92, growth: 0.02, checks: [1, 1, 1], shortfall: 0, yield: 0.0557, mu: 0.0068, sigma: 0.0271, failures: 2, exits: 8, foundings: 16, short: [], plant: 3.41, falls: [] },
	{ id: 'wide', bundleMax: 0.889, checks: [0, 0, 1], shortfall: 0.0006, yield: 0.0392, mu: 0.0009, sigma: 0.0023, failures: 2, exits: 15, foundings: 21, short: ['food'], foodYears: [9], worst: 0.79, falls: [] },
	{ id: 'wants', bundleMax: 0.93, checks: [1, 1, 0], shortfall: 0, yield: 0.0022, mu: 0.0017, sigma: 0.0016, failures: 0, exits: 8, foundings: 17, short: [], spent: 0.14 },
	{ id: 'aven', bundleMax: 1.855, checks: [0, 0, 0], shortfall: 0.0025, yield: 0.0771, mu: 0.0825, sigma: 0.0388, failures: 14, exits: 8, foundings: 13, short: ['food'], shortYears: 10, worst: 0.18, falls: [['the poorest tenth', 1, 10]] },
	// ownerWorst: the worst owner-only person-day; poorOwner: the poorest owner-only person's real consumption, years 10 and
	// 20; personFall: the poorest person's fall, years 20 to 30 (D7 notes)
	{ id: 'pop', bundleMax: 1.145, popGrowth: 0.02, popYears: 40, checks: [0, 0, 0], shortfall: 0.0031, yield: 0.0832, mu: 0.0851, sigma: 0.0657, failures: 0, exits: 14, foundings: 20, short: ['food', 'energy', 'housing'], worst: 0.57, ownerWorst: 0.6, poorOwner: [11.0, 5.4], personFall: [20, 30] },
	// the old pool rule (0.05 of each HEART to the pools, a tenth of the treasury's half), with the idle-plant rule
	{ id: 'pool05', bundleMax: 0.985, pool: OLD_POOL_SHARE, checks: [0, 0, 0], shortfall: 0.0052, yield: 0.043, mu: 0.0003, sigma: 0.0029, failures: 1, exits: 16, foundings: 23, short: ['food'], foodYears: [1, 3, 15], worst: 0.77, falls: [['the poorest tenth', 20, 30]] },
	// Law 5 without the pools (script key divPools = 0): dividends to people and other treasuries only, the rule of the
	// paper's last version (#599), whose main run this row reproduces
	{ id: 'law5old', law5Pools: false, bundleMax: 0.864, checks: [0, 0, 0], shortfall: 0.0003, yield: 0.0994, mu: 0.084, sigma: 0.0483, failures: 2, exits: 16, foundings: 25, short: ['food'], foodYears: [14], foodShock: true, worst: 0.96, falls: [['the poorest tenth', 40, 60], ['the second tenth', 50, 60]] }
];
// 'year 14' or 'years 2 and 34'
const yearWords = (ys) => (ys.length === 1 ? `year ${ys[0]}` : `years ${ys.slice(0, -1).join(', ')} and ${ys.at(-1)}`);
/** a ladder row's name, built from its fields */
export function ladderLabel(v) {
	if (v.id === 'main') return `Main: Law 5 at ${pcs(v.share)}, reserves ${v.months} months`;
	if (v.law5Pools === false) return 'Law 5 without the pools: dividends to people and other treasuries only';
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

/** the dynamic main on eight seeds (20261012–20261019): the same run, eight histories. All with Law 4's 0.5 / 0.4 /
 *  0.1 and the idle-plant rule (SIM.reletUse) unless named. new = this paper's main: Law 5 pays the pools too
 *  (research/e2e/law5-all, seeds-new.md and .json); law5old = Law 5 without the pools, the rule of the paper's last
 *  version (#599; law5-all seeds-law5-old, --set divPools=0, which reproduces #599's seeds-new.md exactly);
 *  old = the old pool rule (0.05 to the pools) under Law 5 without the pools (#599; pool-10 seeds-old.md; not rerun
 *  with the pools paid); newNoFix = this paper's main without the idle-plant rule (--set reletUse=0; law5-all
 *  seeds-new-nofix); noFix = the version before the idle-plant rule (#598: Law 5 without the pools, no idle-plant
 *  rule; pool-10 seeds-new-nofix.md), main = its main seed alone. mu in HEARTS in the last ten years; margin = the melt
 *  less mu, the smallest of the eight and its seed; below = seeds with mu below the melt; pass = seeds on which all
 *  three checks of Proposition 3 pass, check1 to check3 each check, tenths = seeds on which every tenth was higher at
 *  each ten-year mark; gini = the measured Gini of holdings in HEARTS in year 60, lowest and highest; rising = seeds
 *  whose Gini still rose over years 41–60 (flat = of them, the seeds whose trend was +0.000 per ten years); fails /
 *  food = COOP failures on the eight seeds, all and food COOPs; successors = successors on a failed plant that failed
 *  too; scrapped = idle plants scrapped; short = person-days short from day 8, summed; year1 = seeds whose worst
 *  person-day from day 8 fell in the first weeks of year 1 (the seed check's notes); pools = the pools' share of all
 *  MIND, lowest and highest seed. source: scripts/theos-e2e-sim.mjs --seeds 20261012-20261019 */
export const SEEDS = {
	from: 20261012,
	to: 20261019,
	n: 8,
	new: { muMin: -0.0076, muMax: 0.0733, muMedian: 0.0032, below: 7, marginMin: -0.0033, marginMinSeed: 20261012, pass: 5, check1: 5, check2: 5, check3: 6, tenths: 7, gini: [0.32, 0.33], rising: 3, flat: 0, fails: 11, food: 11, successors: 3, scrapped: 5, short: 25_697, year1: 0, pools: [0.204, 0.494] },
	law5old: { muMin: 0.0624, muMax: 0.0974, muMedian: 0.0738, below: 2, marginMin: -0.0274, marginMinSeed: 20261019, pass: 2, check1: 4, check2: 4, check3: 3, tenths: 3, gini: [0.32, 0.39], rising: 7, flat: 1, fails: 16, food: 14, successors: 2, scrapped: 6, short: 18_888, year1: 2, pools: [0.097, 0.104] },
	old: { muMin: 0.0602, muMax: 0.0873, muMedian: 0.0684, below: 5, marginMin: -0.0173, marginMinSeed: 20261016, pass: 0, check1: 1, check2: 1, check3: 2, gini: [0.34, 0.4], rising: 8, fails: 16, food: 13, short: 40_157, year1: 3, law5Pools: false },
	newNoFix: { muMin: -0.0076, muMax: 0.04, muMedian: -0.0003, below: 8, pass: 3, check1: 3, check2: 3, check3: 7, fails: 18, food: 18, successors: 10, short: 52_318, main: { food: 2, successors: 0, short: 35_371, mu: -0.001 } },
	noFix: { muMin: 0.0661, muMax: 0.1008, muMedian: 0.0756, below: 2, pass: 3, check1: 4, check2: 4, check3: 3, fails: 34, food: 32, successors: 18, short: 27_113, main: { food: 14, successors: 11, short: 9_975, mu: 0.0944 } }
};

/** the melt tests (Section 11.2.5): the dynamic main on the same eight seeds, with one lever changed at a time, all with
 *  the idle-plant rule and with Law 5 paid to the pools too. new: under Law 4 of this paper (the pools' part 0.1), from
 *  scripts/theos-e2e-sim.mjs --seeds 20261012-20261019 with --set turnDiv=0.1, --set turnDiv=0.15, --set capDays=365,
 *  --melt 0.08 or --melt 0.09 (research/e2e/law5-all, melt-*.json); old: the same levers under the old pool rule, the
 *  same commands with --set poolShare=0.05 added (melt-old-*.json). melt = the run's melt; mu = μ in the last ten years in HEARTS, lowest and highest of
 *  the eight seeds; below = seeds with μ below that run's melt; marginMin = the smallest margin (melt − μ), negative when
 *  μ was above the melt on some seed; pass = seeds on which all three checks of Proposition 3 pass; yieldMid = the
 *  median dividend yield */
export const MELT_TESTS = {
	law10: { share: 0.1, melt: 0.07, new: { mu: [-0.0014, 0.009], below: 8, marginMin: 0.061, pass: 4, yieldMid: 0.0288 }, old: { mu: [-0.0023, 0.0343], below: 8, marginMin: 0.0357, pass: 1, yieldMid: 0.0351 } },
	law15: { share: 0.15, melt: 0.07, new: { mu: [-0.0049, 0.0373], below: 8, marginMin: 0.0327, pass: 3, yieldMid: 0.0366 }, old: { mu: [-0.0225, 0.0569], below: 8, marginMin: 0.0131, pass: 2, yieldMid: 0.0489 } },
	res12: { months: 12, melt: 0.07, new: { mu: [0.0009, 0.0061], below: 8, marginMin: 0.0639, pass: 5 }, old: { mu: [-0.0035, 0.0769], below: 7, marginMin: -0.0069, pass: 2 } },
	melt8: { melt: 0.08, new: { mu: [-0.0017, 0.0628], below: 8, marginMin: 0.0172, pass: 5 }, old: { mu: [-0.0032, 0.0894], below: 7, marginMin: -0.0094, pass: 2 } },
	melt9: { melt: 0.09, new: { mu: [-0.0046, 0.0058], below: 8, marginMin: 0.0842, pass: 1 }, old: { mu: [-0.007, 0.0797], below: 8, marginMin: 0.0103, pass: 1 } }
};

/** the same-shock comparisons (Appendix G), on 24 seeds with common random numbers: on each seed both rules meet the
 *  same capacity shocks and the same drift of tastes. Per rule: person-days short from day 8 and COOP failures (all,
 *  food COOPs, successors that failed, idle plants scrapped), summed over the 24 seeds; the seeds with any person-day
 *  short and with any food failure; the seeds on which all three checks of Proposition 3 pass, and each check; μ in the
 *  last ten years in HEARTS: lowest, highest and median seed; below = seeds with μ below the 7 % melt. tests: one rule
 *  against the other, seed by seed: better = seeds on which the first had fewer person-days short, fewer failures, a
 *  lower μ, or passed all three checks where the other failed; worse = the reverse; same = ties; p = the two-sided
 *  exact sign test (ties left out).
 *  new / old / tests: this paper's main (the pools' part 0.1, Law 5 paid to the pools too) against the old pool rule
 *  (0.05) under the same Law 5. source: scripts/theos-e2e-sim.mjs --pair 20261012-20261035 --vs poolShare=0.05
 *  (research/e2e/law5-all, crn-new-old.md and .json).
 *  law5: this paper's main against Law 5 without the pools (old: --vs divPools=0, the rule of #599; crn-law5-old.md and
 *  .json); its old side is v599.new, run again.
 *  v599: the pool comparison of the paper's last version, both rules under Law 5 without the pools (research/e2e/pool-10,
 *  crn-new-old.md). fix: the idle-plant rule against none (--vs reletUse=0, pool-10 crn-fix-nofix.md) and noFix: new
 *  against old without the idle-plant rule (pool-10 crn-new-old-nofix.md), both under Law 5 without the pools; not rerun
 *  with the pools paid. collapse: the main run on seed 20261028 under #599's rules, without common random numbers: the
 *  City COOP's treasury ran dry and water stopped for about a year (--seed-run 20261028; the worst person-day was in
 *  year 19; research food-failures.md §8) */
export const SAME_SHOCK = {
	from: 20261012,
	to: 20261035,
	n: 24,
	alpha: 0.05, // a difference with p below this the paper calls clear; above it, it could be luck
	new: { short: 66_218, shortSeeds: 14, food: 19, foodSeeds: 14, fails: 22, successors: 3, scrapped: 9, pass: 9, check1: 10, check2: 10, check3: 22, mu: [-0.0043, 0.062], muMedian: 0.002, below: 24 },
	old: { short: 91_592, shortSeeds: 15, food: 33, foodSeeds: 20, fails: 39, successors: 2, scrapped: 25, pass: 6, check1: 9, check2: 9, check3: 18, mu: [-0.013, 0.0825], muMedian: 0.0013, below: 23 },
	tests: {
		short: { better: 11, worse: 7, same: 6, p: 0.4807 },
		food: { better: 11, worse: 4, same: 9, p: 0.1185 },
		fails: { better: 11, worse: 4, same: 9, p: 0.1185 },
		mu: { better: 14, worse: 10, same: 0, p: 0.5413 },
		pass: { better: 7, worse: 4, same: 13, p: 0.5488 }
	},
	law5: {
		old: { short: 31_522, shortSeeds: 11, food: 16, foodSeeds: 8, fails: 23, successors: 3, scrapped: 10, pass: 6, check1: 13, check2: 13, check3: 11, mu: [0.0569, 0.1014], muMedian: 0.0692, below: 15 },
		tests: {
			short: { better: 5, worse: 10, same: 9, p: 0.3018 },
			food: { better: 6, worse: 10, same: 8, p: 0.4545 },
			fails: { better: 6, worse: 7, same: 11, p: 1 },
			successors: { better: 2, worse: 2, same: 20, p: 1 },
			mu: { better: 24, worse: 0, same: 0, p: 1.2e-7 },
			pass: { better: 5, worse: 2, same: 17, p: 0.4531 }
		}
	},
	v599: {
		new: { short: 31_522, shortSeeds: 11, food: 16, foodSeeds: 8, fails: 23, successors: 3, scrapped: 10, pass: 6, check1: 13, check2: 13, check3: 11, mu: [0.0569, 0.1014], muMedian: 0.0692, below: 15 },
		old: { short: 134_559, shortSeeds: 19, food: 33, foodSeeds: 19, fails: 33, successors: 5, scrapped: 20, pass: 1, check1: 5, check2: 5, check3: 7, mu: [0.0579, 0.1241], muMedian: 0.0738, below: 6 },
		tests: {
			short: { better: 16, worse: 3, same: 5, p: 0.0044 },
			food: { better: 15, worse: 4, same: 5, p: 0.0192 },
			fails: { better: 12, worse: 5, same: 7, p: 0.1435 },
			mu: { better: 16, worse: 8, same: 0, p: 0.1516 },
			pass: { better: 5, worse: 0, same: 19, p: 0.0625 }
		}
	},
	fix: {
		law5Pools: false,
		yes: { short: 31_522, food: 16, fails: 23, successors: 3, pass: 6 },
		no: { short: 31_515, food: 46, fails: 53, successors: 30, pass: 6 },
		tests: { short: { better: 0, worse: 1, same: 23, p: 1 }, food: { better: 7, worse: 0, same: 17, p: 0.0156 }, fails: { better: 9, worse: 0, same: 15, p: 0.0039 } }
	},
	noFix: {
		law5Pools: false,
		new: { short: 31_515, food: 46, fails: 53, pass: 6 },
		old: { short: 113_048, food: 49, fails: 54, pass: 2 },
		tests: { short: { better: 15, worse: 3, same: 6, p: 0.0075 }, food: { better: 15, worse: 7, same: 2, p: 0.1338 } }
	},
	collapse: { seed: 20261028, short: 2_323_749, year: 19, law5Pools: false }
};

/** one seed, one history (Section 11.2.6): the main seed, with the pools' part of each HEART moved by a hair. pool = the
 *  pools' part; mu = μ in the last ten years in HEARTS; short = person-days short from day 8; food = food COOP failures; pass = all
 *  three checks of Proposition 3 pass. source: scripts/theos-e2e-sim.mjs --seed-run 20261012 --set poolShare=…
 *  (research/e2e/pool-10, chaos/pool-*.json); 0.1 is the main run and 0.05 the old pool rule. All under Law 5 without
 *  the pools (#599); not rerun with the pools paid, so this paper's main run (LADDER) is not among them */
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
	1: { living: 4.57, bundle: 0.8888, vMin: 0.34, vMax: 1.71 },
	10: { living: 47.38, bundle: 0.2719, vMin: 0.17, vMax: 3.79 },
	30: { living: 95.4, bundle: 0.1241, vMin: 0.08, vMax: 1.37 },
	40: { living: 99.3, bundle: 0.1004, vMin: 0.34, vMax: 1.38 },
	60: { living: 108.63, bundle: 0.0716, vMin: 0.33, vMax: 1.43 }
};
/** a day's basic bundle as a share of a day of living, in year y */
export const bundleShareOfLiving = (y) => PRICES_BY_YEAR[y].bundle / PRICES_BY_YEAR[y].living;

/** the retired yardstick R (the geometric mean of the prices of SOLAR, HABITAT and CITY), in R a HEART: how far it
 *  drifted against the average MIND, and the lasting return in the last ten years that the script prints in R (D1, D7).
 *  source: sim-dynamic.md H1, H2 and H6 ("R a HEART at rest", "μ, R") */
export const OLD_R = { y1: 1.07, y40: 1.3, y60: 1.06, rest: 1.14, mainMu: 0.0514 };

/** competition by good: the largest seller's share of what was made in year 1 and year 60 (null: none made that year),
 *  and the COOPs founded and ended over 60 years (a successor that leases a failed plant is not counted as founded).
 *  source: sim-dynamic.md D5 (tables and lists) */
export const COMPETITION = [
	{ good: 'food', y1: 0.67, y60: 0.99, founded: 2, ended: 3 },
	{ good: 'energy', y1: 0.61, y60: 1.0, founded: 3, ended: 3 },
	{ good: 'housing', y1: 0.63, y60: 1.0, founded: 0, ended: 0 },
	{ good: 'water', y1: 1.0, y60: 1.0, founded: 0, ended: 0 },
	{ good: 'goods', y1: 0.66, y60: 0.97, founded: 2, ended: 1 },
	{ good: 'care', y1: 0.53, y60: 1.0, founded: 1, ended: 2 },
	{ good: 'experiences', y1: 0.55, y60: 0.92, founded: 5, ended: 5 },
	{ good: 'panels', y1: 1.0, y60: null, founded: 3, ended: 0 },
	{ good: 'materials', y1: 1.0, y60: 0.99, founded: 3, ended: 1 }
];
/** the goods (water aside) that one COOP made alone in year 60 */
export const soleMakers = () => COMPETITION.filter((g) => g.good !== 'water' && g.y60 === 1).map((g) => g.good);
/** the failures: all three were food COOPs. FOOD2 (founded in year 7, failed in year 10), AGRI (a first food COOP,
 *  failed in year 11: its plant was idle, so the City COOP scrapped it and took the land back, the idle-plant rule,
 *  SIM.reletUse) and FOOD3 (founded in year 27, failed in year 44: the City COOP leased its plant to the successor
 *  FOOD3-B2, which made most of the food from then on). coop / year / second: the first two, as the page names them;
 *  list: all of them in order, with what the City COOP did with the plant. source: D5 */
export const FAILURE = {
	coop: 'FOOD2', good: 'food', year: 10, count: 3, food: 3, scrapped: 1, leased: 1,
	second: { coop: 'AGRI', year: 11 },
	list: [
		{ coop: 'FOOD2', good: 'food', founded: 7, year: 10, plant: null }, // D5 names nothing done with its plant
		{ coop: 'AGRI', good: 'food', founded: 1, year: 11, plant: 'scrapped' },
		{ coop: 'FOOD3', good: 'food', founded: 27, year: 44, plant: 'leased', successor: 'FOOD3-B2' }
	]
};
/** the energy COOPs founded later, each of which exited within this many years (D5: ENERGY2 y5→y8, ENERGY3 y8→y11,
 *  ENERGY4 y16→y19) */
export const ENERGY_ENTRANTS = { count: 3, years: 3 };

/** every MIND over its life, in HEARTS (H5). byMind: the MINDs of the first COOPs, each with the years it lived, its
 *  mean return a year (Law 5 dividends plus price change), its price change a year, and its compounded return a year
 *  (what one MIND held with its dividends became, the dividends kept as more of the same MIND); all before the melt.
 *  good: what its COOP makes; share1 / share60: its share of what was made of that good in year 1 and year 60 (D5;
 *  null: none made that year; ended: its COOP failed or exited, with the year, and its MIND counts −100 % that year).
 *  source: sim-dynamic.md D2 (second table), H5 and D5; sim-dynamic.json mindReturns */
export const MIND_RETURNS = {
	minds: 35,
	ended: 15,
	withThreeYears: 35,
	aboveMelt: 11,
	aboveMeltEnded: 6,
	arts: { compounded: 0.283, years: 59 },
	byMind: {
		CITY: { good: 'water', years: 59, mean: -0.001, priceChange: -0.001, compounded: -0.002, share1: 1.0, share60: 1.0 },
		SOLAR: { good: 'energy', years: 59, mean: 0.009, priceChange: 0.002, compounded: 0.004, share1: 0.61, share60: 1.0 },
		WIND: { good: 'energy', years: 59, mean: 0.013, priceChange: 0.01, compounded: 0.011, share1: 0.39, share60: 0.0 },
		HABITAT: { good: 'housing', years: 59, mean: 0.009, priceChange: 0.005, compounded: 0.007, share1: 0.63, share60: 1.0 },
		AGRI: { good: 'food', years: 10, mean: -0.083, priceChange: -0.028, compounded: -1.0, share1: 0.67, share60: 0.0, ended: 11 },
		PANEL: { good: 'panels', years: 59, mean: -0.01, priceChange: -0.012, compounded: -0.015, share1: 1.0, share60: null },
		BUILD: { good: 'materials', years: 59, mean: -0.004, priceChange: -0.007, compounded: -0.006, share1: 1.0, share60: 0.99 },
		ARTS: { good: 'experiences', years: 59, mean: 0.29, priceChange: 0.012, compounded: 0.283, share1: 0.45, share60: 0.92 }
	}
};
/** the MINDs of the city's infrastructure (water, energy, housing, materials) that Section 8.1 compares */
export const INFRA_MINDS = ['CITY', 'SOLAR', 'WIND', 'HABITAT', 'BUILD'];
/** the lowest and highest of a field over a set of MINDs: e.g. mindRange('mean') over INFRA_MINDS */
export const mindRange = (key, ids = INFRA_MINDS) => {
	const v = ids.map((k) => MIND_RETURNS.byMind[k][key]);
	return [Math.min(...v), Math.max(...v)];
};

/** how the simulation's Avens invest (Sections 7 and 11.2.1; scripts/theos-e2e-sim.mjs updateAlloc, BASE.avenRule 'price'):
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
// 0.01); rest: H4's "not explained" column, unrounded (sim-dynamic.json roundTrip, H4 prints −0.041, 0.006 and −0.003).
// Liquidations were 0.00 in the last ten years and are left out. own: the investor's part (people) or the treasury's
// part (treasuries) of each HEART invested; pool: the pools' part. Law 5 pays every holder but the seller's own
// treasury, so the treasuries pay dividends to people (dividends), to the pools (dividendsPools) and to the arbitrage
// bot (dividendsBot, not a place here), and the pools receive theirs (pools.in.dividends)
export const ROUND_TRIP = {
	people: { in: { own: 12.78, items: 86.03, proposals: 7.5, dividends: 17.73 }, out: { buying: 107.71, melt: 15.08, retired: 0.04 }, net: 1.22, moves: -0.62, change: 0.56, rest: -0.040508 },
	treasuries: { in: { own: 10.23, sales: 107.71 }, out: { dividends: 17.73, dividendsPools: 3.7, dividendsBot: 0.12, items: 86.03, proposals: 7.5, melt: 3.29, retired: 0.0 }, net: -0.43, moves: -1.0, change: -1.43, rest: 0.005655 },
	pools: { in: { pool: 2.56, dividends: 3.7, routing: 0.04 }, out: { melt: 4.65, retired: 0.02 }, net: 1.62, moves: 0.07, change: 1.69, rest: -0.002659 },
	issuedMind: 24.0, // MIND a person a day (24 HEARTS converted); in HEARTS 25.57 (H4)
	meltedMind: 23.04, // MIND a person a day; in HEARTS the same 23.04, because by (7) all MIND is worth as many HEARTS as there are MINDs
	retiredMind: 0.05, // MIND that left with COOPs that ended (D8)
	stockGrowth: 0.91, // the MIND stock changed by this much a person a day (D8): it still grew, towards u/r from below
	unexplainedMax: 0.0004, // the largest unexplained rest, as a share of a place's inflow (H4: 0.042 %)
	between: { sales: 0.02, rent: 0.04 } // flows between treasuries, which cancel out (H4)
};
/** the share of what people hold that leaves a year with the MIND of COOPs that ended: what is retired from people's
 *  wallets a year (H4) over what people hold (DYN.people × DYN.money; the average MIND is worth 1 HEART). With the
 *  dividends and the price change, it closes the lasting return μ (Section 11.2.5) */
export const retiredShare = (rt = ROUND_TRIP, d = DYN) => (rt.people.out.retired * 365) / (d.people * d.money);

/** what new MIND, the melt and the MIND retired with COOPs that ended leave over, as a share of new MIND (D8: 3.8 %) */
export const issueGap = (rt = ROUND_TRIP) => (rt.issuedMind - rt.meltedMind - rt.retiredMind) / rt.issuedMind;

/** the same in the earlier static world, in HEARTS a person a day. source: sim-dynamic.md H7 (S7 in R) */
export const ROUND_TRIP_STATIC = {
	people: { in: { own: 12.0, items: 3.91, proposals: 14.99, dividends: 2.24 }, out: { buying: 11.95, melt: 20.71 } },
	treasuries: { in: { own: 9.6, sales: 11.95 }, out: { dividends: 2.24, dividendsPools: 0.2, dividendsBot: 0.0, items: 3.91, proposals: 14.99, melt: 0.22 } },
	pools: { in: { pool: 2.4, dividends: 0.2 }, out: { melt: 2.55 } },
	issued: 24.0,
	melted: 23.48,
	money: 122_603 // MIND a person (S7)
};

/** the mean cost of a day's basic bundle in the last ten years, HEARTS, over the same years as H4. source: sim-dynamic.md H3
 *  note ("a day's basic bundle at rest") */
export const BUNDLE_REST = 0.0716;

/** the Law 5 dividends that the treasuries' sales pay a person a day: to people, to the pools and to the arbitrage bot */
export const law5Paid = (rt = ROUND_TRIP) => rt.treasuries.out.dividends + (rt.treasuries.out.dividendsPools || 0) + (rt.treasuries.out.dividendsBot || 0);

/** what the treasuries keep of people's purchases: sales less the Law 5 share, which each sale pays at once to the
 *  holders (D8 books sales gross and the dividends as a treasury outflow; this is the same flow, netted at the sale) */
export const salesAfterLaw5 = (rt = ROUND_TRIP) => rt.treasuries.in.sales - law5Paid(rt);

/** the total of a set of flows */
export const flowSum = (flows) => Object.values(flows).reduce((s, v) => s + v, 0);

/** what flows in, less what flows out, of one place in the round trip */
export const flowNet = (place) => flowSum(place.in) - flowSum(place.out);

/** what flows and price moves do not explain: in − out + price moves − change (must stay near zero) */
export const flowCheck = (place) => flowNet(place) + (place.moves || 0) - (place.change || 0);

/** one source of a person's income, as a share of all that flows into people's wallets */
export const incomeShare = (k, rt = ROUND_TRIP) => rt.people.in[k] / flowSum(rt.people.in);

/** a flow as a share of a person's income (people's inflow), for Figure 12's arrows */
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

/** Figure 13: real consumption a day of the poorest, the middle and the richest tenth, every year */
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

// ── The test city (Section 11.3.3) ──────────────────────────────────────────────────────────────────────────────────
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

/** the economic model's versions, in order (Section 11.2). Every version ran SIM.people people for SIM.years years.
 *  checks: [no one starves, no one has to work (the normal test), living standards rise] on the main seed, 1 holds and
 *  0 fails (null: not checked per person); strict: the strict test on the main seed, 1 holds and 0 fails (left out:
 *  not reported); short: person-days short from day 8 on the main seed; unit: what the run counted in; mu: the lasting
 *  return on holdings in the last ten years, in that unit (muHearts: the same in HEARTS); law5Pools: whether Law 5
 *  paid the city's pools too; seeds: the 8-seed check where one was run. sources: model.js at #520/#522 (the static
 *  world), #524 (60a32b8), #598 (43d854e; its commit gives the #524 world's mu in HEARTS, 7.50 %, rerun with poolShare
 *  0.05) and #599 (737c9b3; research/e2e/pool-10, reproduced exactly by law5-all seeds-law5-old and the 'law5old' row of
 *  LADDER). 'law5all' is this paper's main run (research/e2e/law5-all, merged in fed68db from ab8ed86): the constants
 *  above */
export const MODEL_VERSIONS = [
	{ id: 'static', pr: [520, 522], date: '2026-10-12', unit: 'R', poolShare: OLD_POOL_SHARE, checks: null, capped: true },
	{ id: 'dynamic', pr: [524], date: '2026-10-12', unit: 'R', poolShare: OLD_POOL_SHARE, checks: [1, 1, 1], short: 0, genesisShort: 621, mu: 0.0586, muHearts: 0.075, seeds: null },
	{ id: 'hearts', pr: [598], date: '2026-10-13', unit: 'HEARTS', poolShare: POOL_SHARE, checks: [0, 0, 0], short: SEEDS.noFix.main.short, foodFailures: SEEDS.noFix.main.food, mu: SEEDS.noFix.main.mu, muHearts: SEEDS.noFix.main.mu, seeds: SEEDS.noFix },
	{ id: 'idle', pr: [599], date: '2026-10-13', unit: 'HEARTS', poolShare: POOL_SHARE, law5Pools: false, checks: [0, 0, 0], strict: 0, short: 1_750, foodFailures: 2, mu: 0.084, muHearts: 0.084, seeds: SEEDS.law5old },
	{ id: 'law5all', pr: [], date: '2026-10-14', unit: 'HEARTS', poolShare: POOL_SHARE, law5Pools: SIM.law5Pools, checks: LADDER.find((v) => v.id === 'main').checks, strict: PROOF.strict.shareAfter10 >= 1 ? 1 : 0, short: PROOF.short, foodFailures: FAILURE.food, mu: DYN.mu, muHearts: DYN.mu, seeds: SEEDS.new, running: false }
];

/** the test city's rounds, in order (Section 11.3.2). Each round ran the five seeds 20261012, 1, 2, 3 and 4 for 60
 *  years; Avens follow fixed rules. Per seed: p1, person-days short; p2strict, the lowest owner-only dividends ÷ the
 *  basic bundle in the last year (1 or more passes) and strictFrom, the day from which dividends alone paid the bundle
 *  every day (null: never); p2normal, owner-only person-days failing the normal test, and normalSeeds, the seeds on
 *  which it held (it also needs the lowest holding to last over 100 years at its trend); p3, the tenths failing part 3
 *  (of p3of: ten by holdings and ten by Aven output), judged in real units from round 3 on and before that in a money
 *  index (p3unit); abundance, the day-goods on which MIND, not physics, bound a basic; bank, the bootstrap number on
 *  seed 20261012 and its range over the seeds (from round 3, which added the border); suite, the experiments and
 *  scenarios, with how many passed, failed or only compared. Every round ran the old pools' part (OLD_POOL_SHARE).
 *  sources: the test city's proof.json at each round's merge commit: round 1 #525 (bcc3ef2), round 2 #526 (d9d48db),
 *  round 3 #528 (8e513a1), round 4 #538 (431be78), round 5 #613 and #621 (acca3c0); round 5 is TEST_CITY */
export const SIM_HISTORY = [
	{
		round: 1, pr: [525], date: '2026-10-13', engine: 'b76e0243', people: 250,
		added: 'the economy alone, growing until physics binds, with Proposition 3 checked per person',
		p1: [0, 0, 0, 0, 0], p2strict: [0.48, 0.49, 0.48, 0.5, 0.46], strictFrom: [null, null, null, null, null],
		p2normal: [0, 0, 0, 0, 0], normalSeeds: 4, p3: [20, 20, 20, 20, 20], p3of: 20, p3unit: 'index',
		abundance: [0, 0, 0, 0, 0], bank: null,
		suite: { experiments: 16, scenarios: 28, pass: 19, fail: 25, compare: 0 }
	},
	{
		round: 2, pr: [526], date: '2026-10-13', engine: 'ed8f7071', people: 250,
		added: 'an energy order for the plants, and fixes to round 1',
		p1: [0, 0, 0, 0, 0], p2strict: [2.3, 2.81, 2.56, 3.18, 3.15], strictFrom: [1, 1, 1, 1, 1],
		p2normal: [0, 0, 0, 0, 0], normalSeeds: 5, p3: [20, 20, 20, 20, 20], p3of: 20, p3unit: 'index',
		abundance: [0, 0, 0, 0, 0], bank: null,
		suite: { experiments: 16, scenarios: 30, pass: 20, fail: 25, compare: 1 }
	},
	{
		round: 3, pr: [528], date: '2026-10-13', engine: 'e5239873', people: 1_500,
		added: 'the village built up from its first settlers, the euro border, and part 3 judged in real units',
		p1: [108, 95, 123, 148, 110], p2strict: [1.25, 1.26, 1.27, 1.34, 1.24], strictFrom: [4_355, 5_100, 4_391, 7_021, 4_411],
		p2normal: [0, 0, 0, 3, 0], normalSeeds: 3, p3: [20, 20, 20, 20, 20], p3of: 20, p3unit: 'real',
		abundance: [14, 12, 18, 45, 18], bank: { bootstrap: 724.6e6, range: [722.8e6, 731.1e6] },
		suite: { experiments: 17, scenarios: 36, pass: 10, fail: 35, compare: 8 }
	},
	{
		round: 4, pr: [538], date: '2026-10-13', engine: '1c0bea6c', people: 1_500,
		added: 'the AI market, audited prices for the village, and fixes to round 3',
		p1: [545, 408, 505, 432, 300], p2strict: [0.27, 0.25, 0.25, 0.27, 0.26], strictFrom: [null, null, null, null, null],
		p2normal: [238, 128, 195, 135, 82], normalSeeds: 0, p3: [20, 20, 20, 20, 19], p3of: 20, p3unit: 'real',
		abundance: [401, 350, 424, 390, 305], bank: { bootstrap: 602.29e6, range: [587.5e6, 603.8e6] },
		suite: { experiments: 18, scenarios: 36, pass: 14, fail: 31, compare: 9 }
	},
	{
		round: TEST_CITY.round, pr: [613, 621], date: '2026-10-13', engine: TEST_CITY.engine, people: TEST_CITY.people,
		added: 'the dome factory in the village, and fixes to round 4',
		p1: TEST_CITY.p1, p2strict: TEST_CITY.p2strict, strictFrom: [null, null, null, null, null],
		p2normal: TEST_CITY.p2normal, normalSeeds: 4, p3: TEST_CITY.p3.failing, p3of: TEST_CITY.p3.of, p3unit: 'real',
		abundance: TEST_CITY.abundance, bank: { bootstrap: TEST_CITY.bank.bootstrap, range: TEST_CITY.bank.range },
		suite: { experiments: TEST_CITY.suite.experiments, scenarios: TEST_CITY.suite.scenarios, pass: TEST_CITY.suite.pass, fail: TEST_CITY.suite.fail, compare: TEST_CITY.suite.compare }
	}
];

/** how many per-seed values pass `ok` (by default: the value is 0, as for person-days short) */
export const holdsCount = (xs, ok = (v) => v === 0) => xs.filter(ok).length;

/** a hypothesis's status from how many runs held, of how many: all → 'supported', none → 'failing', some → 'mixed',
 *  no run → 'open'. 'proven' is kept for mathematics */
export const statusFrom = (held, of) => (!of ? 'open' : held === of ? 'supported' : held === 0 ? 'failing' : 'mixed');

/** the band around full cost within which Section 10's H6 calls a price "near cost" (audit B13: within 10 %) */
export const COST_BAND = 0.1;

const tcN = TEST_CITY.seeds.length;
const tcScen = TEST_CITY.scenarios;
const mainChecks = LADDER.find((v) => v.id === 'main').checks;
const infraBelow = INFRA_MINDS.filter((k) => MIND_RETURNS.byMind[k].mean < RATE);
const infraWon = INFRA_MINDS.filter((k) => MIND_RETURNS.byMind[k].share60 === 1);
const nearCost = tcScen.sellers.cost.every((c) => Math.abs(c - 1) <= COST_BAND);
const payoutHeld = [DYN.people > 0.5, ...tcScen.payout.pass].filter(Boolean).length;

/** the hypotheses of Section 10 and their status, derived from the numbers where they can be, so that new numbers
 *  update them. Each part of Proposition 3 counts the 8-seed check of the economic model (SEEDS.new) and the base seeds
 *  of the test city's latest round (TEST_CITY); `model` and `city` are [held, of]. A status the numbers cannot give
 *  yet is 'open', with `untested` saying why. The words of each hypothesis are in the page (Section 10) */
export const HYPOTHESES = {
	H1: { status: 'proven' }, // Proposition 1, Section 5.3
	H2: { status: 'proven' }, // Proposition 2, Section 9.2 (its condition is H4)
	H3: {
		model: [SEEDS.new.pass, SEEDS.n],
		city: [TEST_CITY.headline.all, TEST_CITY.headline.of],
		main: mainChecks,
		status: statusFrom(SEEDS.new.pass + TEST_CITY.headline.all, SEEDS.n + TEST_CITY.headline.of),
		parts: [
			{ model: [SEEDS.new.check1, SEEDS.n], city: [holdsCount(TEST_CITY.p1), tcN] },
			{ model: [SEEDS.new.check2, SEEDS.n], city: [holdsCount(TEST_CITY.p2normal), tcN] },
			{ model: [SEEDS.new.check3, SEEDS.n], city: [holdsCount(TEST_CITY.p3.failing), tcN] }
		].map((p) => ({ ...p, status: statusFrom(p.model[0] + p.city[0], p.model[1] + p.city[1]) })),
		// the strict test, not claimed: dividends alone, on every owner-only person-day after year 10 of the model's main
		// run, and in the last year on the test city's base seeds
		strict: { model: [PROOF.strict.shareAfter10 >= 1 ? 1 : 0, 1], city: [holdsCount(TEST_CITY.p2strict, (v) => v >= 1), tcN] }
	},
	// μ below the melt: the 8-seed check and the 24 same-shock seeds
	H4: { model: [SEEDS.new.below, SEEDS.n], same: [SAME_SHOCK.new.below, SAME_SHOCK.n], status: statusFrom(SEEDS.new.below + SAME_SHOCK.new.below, SEEDS.n + SAME_SHOCK.n) },
	// long-lived projects get built (they made all of their good by the last year) and their rise is shared (their
	// MINDs returned less than the melt)
	H5: { won: infraWon, below: infraBelow, of: INFRA_MINDS.length, status: infraWon.length && infraBelow.length === INFRA_MINDS.length ? 'supported' : infraWon.length || infraBelow.length ? 'mixed' : 'failing' },
	// rivals keep basics near cost: the test city's sellers within COST_BAND of full cost; no basic but water with one
	// seller in the model's last year
	H6: { nearCost, sole: soleMakers(), status: nearCost && !soleMakers().length ? 'supported' : nearCost || !soleMakers().length ? 'mixed' : 'failing' },
	// only physics limits abundance: base seeds on which MIND never bound a basic, and twice the HEARTS changing what
	// people got by at most TEST_CITY.scenarios.money.largest
	H7: { city: [holdsCount(TEST_CITY.abundance), tcN], money: tcScen.money.pass, status: statusFrom(holdsCount(TEST_CITY.abundance) + (tcScen.money.pass ? 1 : 0), tcN + 1) },
	// energy binds growth: the model assumes productivity growth and has no energy limit
	H8: { energy: tcScen.energy.pass, status: 'open', untested: 'model' },
	// the euro border balances: exports repay the euros the city needed
	H9: { repaid: TEST_CITY.bank.repaid, status: TEST_CITY.bank.repaid ? 'supported' : 'failing' },
	// the founding leaves no one short: the model (no founding rule) and the test city (with it)
	H10: { model: PROOF.genesis.short === 0, city: tcScen.founding.shortWith === 0, status: statusFrom((PROOF.genesis.short === 0 ? 1 : 0) + (tcScen.founding.shortWith === 0 ? 1 : 0), 2) },
	// ownership spread by the Avens (C4) pays the basics: not modelled yet
	H11: { status: 'open', untested: 'C4' },
	// treasuries pay out, so people own most MIND: the model's last ten years and the test city's two payout scenarios
	H12: { held: payoutHeld, of: 1 + tcScen.payout.pass.length, status: statusFrom(payoutHeld, 1 + tcScen.payout.pass.length) },
	// the melt keeps money moving: the model assumes how much people spend
	H13: { status: 'open', untested: 'spending' },
	// selection by where Avens invest improves governance
	H14: { status: 'open', untested: 'governance' },
	// ground rent as a Law 5 sale lifts cityMIND and the owner-only people (ACCEPTED.groundRent): the economic model's
	// run with rent as a sale is under way
	H15: { status: 'open', untested: 'running' },
	// either estate rule keeps the Gini bounded (ACCEPTED.estates): no rule is chosen or simulated yet
	H16: { status: 'open', untested: 'estates' }
};
