// @ts-nocheck — plain JS, kept loose on purpose
// The numbers behind the theOS paper: every figure and every number quoted in its text is computed here, so the
// prose and the charts can never drift apart. The paper itself lives in Maia City alone (its doc `paper/theos`, read
// in avenDB's Docs view); `refs.js <key>` below names one of its references by the key its old page cited it by.

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
 *  the simulation keeps it as a variation (LADDER 'pool05') and as the comparison of SAME_SHOCK.pool */
export const OLD_POOL_SHARE = 0.05;
export const SECONDS_YEAR = 31_536_000;

/** a number in words, en-GB, with d decimals */
export const fmt = (n, d = 0) => n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
// a share (0.07) as a percentage (7 %), for labels built here
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
	// B5: the City COOP keeps a water part inside its reserve. A word, not a number: the economic model's upgrades of
	// round 1 tried one and did not keep it (UPGRADES.notKept.waterReserve)
	waterReserve: { kind: 'policy', audit: 'B5', keeper: 'the City COOP', within: 'its reserve', value: null, sim: 'none' },
	// B8(c): no COOP whose MIND trades in a basket may refuse an investment
	noRefusal: { kind: 'rule', audit: 'B8(c)', sim: 'same' },
	// B9: ground rent is a sale, so Law 5 pays its share to cityMIND's holders, not to the City COOP's own treasury. The
	// economic model books rent as a flow between treasuries, not a sale (D8, D6.2 note); its upgrades of round 1 ran
	// rent as a sale and did not keep it (UPGRADES.notKept.rentLaw5), and H15 tracks it
	groundRent: { kind: 'rule', audit: 'B9', share: DIVIDEND_SHARE, payee: "cityMIND's holders", sim: 'differs', hypothesis: 'H15' },
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
export const VERSION = { n: 'v8', date: 'October 2026' };

/** the name of our simulation and of its versions (Section 11), in one place, so that a rename is one edit here */
export const SIM_NAMES = {
	model: 'the economic model',
	// the economic model's versions (MODEL_VERSIONS ids)
	versions: {
		static: 'the static world',
		dynamic: 'the dynamic world',
		hearts: 'the HEART report',
		idle: 'the idle-plant rule',
		law5all: 'Law 5 paid to the pools',
		upgrades1: 'the upgrades of round 1',
		upgrades2: 'the upgrades of round 2'
	}
};

/** part 3 of Proposition 3, the rule for every tenth (Section 11.1): each basic at need every year (within `basics`); no
 *  extra down more than `fall` over any window of `years` years; and each tenth's basket up over the run: one extra up
 *  `rise` or more. source: the economic model's check by tenths (research/e2e/round-next, measures-main.md section 1),
 *  as research/e2e/round-next-2/verdict.md ("The rule") restates it under the verdict */
export const P3_RULE = { basics: 0.01, fall: 0.02, years: 5, rise: 0.05 };

/** how part 3 judges a single extra that falls (Section 11.1). Samuel chose the verdict on a card on 2026-10-14 (17:31):
 *  taste-adjusted, with the cap excuse (canon #19). Every verdict of the paper uses YARDSTICK, so a change is this one
 *  edit. 'taste' (the verdict): a fall counts only when the tenth got less of the extra than it wanted, and never while
 *  the good is at its natural or physical limit (the cap excuse); 'a': each extra: a fall counts unless the extra is at
 *  satiation or a physical limit binds that year; 'b': taste-adjusted without the cap excuse; 'c': one basket: the
 *  extras together, valued at fixed day-1 prices. The three side readings stay beside the verdict. mark: the letter the
 *  paper prints (none for the verdict). source: the economic model's check, research/e2e/round-next-2, verdict.md (the
 *  rule, its two excuses and the side columns) and yardsticks.md; scripts/theos-e2e-sim.mjs p3=2, the script's default */
export const YARDSTICK = 'taste';
export const YARDSTICKS = {
	taste: { name: 'Taste-adjusted', mark: '', verdict: true },
	a: { name: 'Each extra', mark: '(a)' },
	b: { name: 'Taste-adjusted, no cap excuse', mark: '(b)' },
	c: { name: 'One basket', mark: '(c)' }
};
/** the side readings beside the verdict, in order */
export const SIDE_YARDSTICKS = Object.keys(YARDSTICKS).filter((k) => k !== YARDSTICK);
/** who chose the verdict, and when (canon #19; the card of 2026-10-14, 17:31) */
export const P3_CHOICE = { by: 'Samuel', date: '2026-10-14', time: '17:31', canon: 19 };

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

// a small seeded random source, so every run draws the same simulation
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
// Source: research/e2e/round-next-2/sim-dynamic.md, .json and .csv, the output of scripts/theos-e2e-sim.mjs at commit
// 79f83e8, the script's default: new main 2, the main run of this paper (SIM_NAMES.versions.upgrades2). Run dyn:main,
// seed 20261012, 250 people × 60 years, Law 4's 0.5 / 0.4 / 0.1, Law 5 paid to every holder of the seller's MIND but
// its own treasury, the city's pools included (key divPools), the idle-plant rule (the City re-lets a failed COOP's
// plant only while its demand is at least a quarter of its capacity), round 1's kept switches (foodStore=54,
// techCopy=1, founding=2), round 2's (reroute=1, rentShort=1, waterStock=90) and part 3 judged by the verdict (p3=2).
// Run 2026-10-14. The earlier main run, Law 5 paid to the pools (law5all, research/e2e/law5-all, ab8ed86), keeps its
// numbers where a version is compared (LAW5ALL, SEEDS.law5all, MELT_TESTS, SAME_SHOCK.pool and .law5); so does the
// version before it (#599, Law 5 without the pools: SEEDS.law5old, SAME_SHOCK.v599, the 'law5old' row of LADDER).
// Steady state = years 51–60. Every constant names its table; every ratio that the prose prints is a function below.
// The unit is the HEART (Section 6.3): the script values every flow at the HEART index of the step in which it happens
// and prints these values in its tables H1 to H8 ("H2" … name them); the tables D1 to D8 and S1 to S7 count in R, the
// old basket of three MINDs. R a HEART drifted from 1.28 (year 1) to 1.17 (year 40) and 1.15 (year 60), so numbers in R
// and in HEARTS differ (OLD_R).

/** the simulated city. source: sim-dynamic.md header; D5 (shocks); the script's DYN (the switches) */
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
	shocks: 80, // D5
	restFrom: 51, // years 51–60: the run's rest, the years that the steady-state columns average
	runSeconds: 521, // the whole script's run time, s (sim-dynamic.md footer: "Runtime 521.4 s")
	// the switches of the two rounds that the main run keeps on (scripts/theos-e2e-sim.mjs DYN; each one's old rule is
	// key = 0): round 1's food store, technology copying and founding week, round 2's rerouting, ground rent that rises
	// only while land is short, and the water stock; p3 = 2 judges part 3 by the verdict
	switches: { foodStore: 54, techCopy: 1, founding: 2, reroute: 1, rentShort: 1, waterStock: 90, p3: 2 },
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
	worstYear: 1, // … in year 1, day 38
	worstDay: 38,
	// the years with basics short from day 8 (D7 notes: the share of that year's person-days, and the goods short): none
	shortYears: [],
	shocks: 80,
	shockPersonDays: 2_717_000, // the 30 days after each shock
	shockWorst: 1.39,
	failures: 0,
	exits: 7,
	endedPersonDays: 306_250, // the 180 days after each failure or exit
	endedWorst: 1.4,
	shockShort: 0, // person-days short in the 30 days after the shocks (proof check 1)
	endedShort: 0, // … and in the 180 days after the ends
	// the founding week (days 1–7): the worst person-day (year 1, day 3) and person-days short
	genesis: { days: 7, worst: 1.0, short: 0, personDays: 1_750 },
	// the normal test (check 2) holds: the owner-only people had their basics on every day from day 8 (worst 100 %, no
	// person-day below 98 %). Their lowest holding from year 2 on, HEARTS, and a day of living that year, HEARTS (H3 note)
	normal: { worst: 1.0, short: 0, lowestHolding: 3_434, lowestYear: 2, livingThen: 11.654 },
	strict: {
		firstDay: 146, lastMissYear: 60, lastMissDay: 363, lastMissRatio: 0.65, shareAfter10: 0.4353, worst: 0.29, worstYear: 24,
		// the share from day 8 (the part 3 section: 50.0 %)
		shareFrom8: 0.5,
		// the share of owner-only person-days that dividends alone covered, every year 1–60. source: sim-dynamic.csv,
		// dyn:main, zero_aven_strict_share_of_days (D6.2 prints years 1, 2, 5, 10, … 60)
		series: [0.6695, 0.7464, 0.5123, 0.5508, 0.9369, 0.8192, 0.9815, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.97, 0.96, 0.97, 0.9509, 0.7877, 0.6062, 0.5692, 0.5731, 0.5308, 0.4908, 0.4415, 0.4077, 0.8046, 0.6177, 0.3954, 0.1708, 0.11, 0.1102, 0.1054, 0.4808, 0.1346, 0.08, 0.04, 0.0315, 0.1358, 0.16, 0.2854, 0.45, 0.0977, 0.04, 0.0169, 0, 0.0115, 0, 0, 0.0562, 0.0085, 0.0085, 0, 0.0969, 0.0626],
		// the same for years 1–10
		byYear: { 1: 0.6695, 2: 0.7464, 3: 0.5123, 4: 0.5508, 5: 0.9369, 6: 0.8192, 7: 0.9815, 8: 1, 9: 1, 10: 1 },
		lastShortYear: 7, // the last of the early years in which they missed on some days (CSV)
		// after year 10, the years with a miss (CSV): every year from 20 to 60
		lateMiss: { from: 20, to: 60, runs: [[20, 60]] },
		lateMissEnd: 0.0626, // the share of owner-only person-days that dividends alone covered in year 60 (D6.2: 6.3 %)
		endRatio: 0.62 // the worst owner-only day in year 60: dividends ÷ basic bundle (D6.2)
	},
	bundleMax: 0.575, // the most a day's basic bundle cost in a year, HEARTS … (H2; from year 2 on 0.564 in year 2; the script's "in MIND" gives 0.634 in year 1)
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
	d1: [13.6, 18.5, 28.7, 39.0, 48.4, 63.6, 85.9, 115.1],
	d2: [14.3, 23.4, 42.8, 91.3, 138.8, 192.8, 248.5, 307.7], // the second tenth (D6.3, column D2)
	d5: [15.4, 30.4, 59.3, 170.1, 269.8, 389.8, 494.1, 577.8],
	d10: [20.1, 50.6, 118.9, 388.2, 624.9, 950.2, 1_308.8, 1_640.6],
	mean: [16.0, 32.5, 65.7, 185.6, 293.2, 430.5, 578.1, 703.1],
	gini: [0.06, 0.15, 0.2, 0.28, 0.29, 0.31, 0.32, 0.33] // the Gini index of real consumption
};

/** the same, every year (years 1–60), and the cost of a day's basic bundle in HEARTS. The CSV has no yearly column for
 *  the second tenth; DECILES.d2 has it at the marks.
 *  source: sim-dynamic.csv, run dyn:main, columns real_consumption_decile1/5/10 and basic_bundle_H (each step's cost
 *  at that step's HEART values, averaged over the year; H8) */
export const LIVING = {
	d1: [13.6, 16.4, 16.8, 17.8, 18.5, 19.6, 23.6, 25.3, 26.6, 28.7, 30.6, 33.4, 36.7, 36.8, 36.1, 36.1, 36.4, 37.5, 38.5, 39.0, 39.7, 40.8, 41.2, 43.0, 44.4, 45.1, 45.3, 46.4, 47.7, 48.4, 49.2, 49.7, 52.1, 54.0, 55.8, 57.3, 59.1, 60.1, 61.8, 63.6, 64.7, 66.8, 68.7, 70.5, 71.9, 74.6, 78.8, 81.8, 82.5, 85.9, 87.7, 89.8, 93.3, 96.5, 100.9, 102.3, 104.0, 107.4, 111.5, 115.1],
	d5: [15.4, 20.1, 22.4, 26.4, 30.4, 34.8, 40.4, 43.2, 49.3, 59.3, 71.8, 88.8, 108.2, 116.9, 120.6, 128.3, 135.4, 150.5, 160.9, 170.1, 179.0, 191.7, 200.7, 219.4, 230.5, 240.8, 247.0, 257.6, 263.8, 269.8, 282.6, 290.1, 305.1, 321.0, 337.0, 350.5, 362.5, 373.9, 382.3, 389.8, 392.6, 404.1, 407.5, 407.5, 415.8, 428.6, 450.3, 470.3, 474.3, 494.1, 499.9, 511.8, 527.5, 531.5, 543.8, 545.5, 552.6, 563.2, 574.6, 577.8],
	d10: [20.1, 29.8, 36.1, 44.8, 50.6, 60.0, 68.8, 75.8, 92.3, 118.9, 153.5, 200.4, 249.8, 288.7, 286.0, 296.3, 311.4, 348.6, 369.2, 388.2, 406.3, 434.3, 466.7, 503.5, 520.8, 544.3, 562.5, 595.3, 612.6, 624.9, 662.9, 692.3, 723.6, 753.5, 789.6, 825.3, 858.5, 892.6, 921.2, 950.2, 977.7, 1004.1, 1035.7, 1037.0, 1052.2, 1096.2, 1172.5, 1225.6, 1241.8, 1308.8, 1333.4, 1387.6, 1437.0, 1446.7, 1491.0, 1516.7, 1556.9, 1589.9, 1626.4, 1640.6],
	bundle: [0.5748, 0.5641, 0.5319, 0.4735, 0.3936, 0.3463, 0.272, 0.2151, 0.1989, 0.186, 0.1751, 0.1665, 0.1517, 0.1654, 0.1718, 0.1672, 0.161, 0.1574, 0.1508, 0.1449, 0.1381, 0.1346, 0.1351, 0.1706, 0.1285, 0.1264, 0.1225, 0.1191, 0.0751, 0.0704, 0.0687, 0.0675, 0.0664, 0.0648, 0.0621, 0.0604, 0.0592, 0.0579, 0.0573, 0.0561, 0.0557, 0.0543, 0.0544, 0.0541, 0.0524, 0.0508, 0.0501, 0.049, 0.0479, 0.0473, 0.0463, 0.046, 0.0449, 0.0433, 0.0429, 0.0425, 0.0426, 0.0417, 0.0406, 0.0399]
};

/** the owner-only people (every tenth person: their Avens deliver nothing, and they start with nothing).
 *  source: H3 note (holdings, HEARTS), D6.2 (the group's average of dividends ÷ basic bundle) and its note (the mix at
 *  the end, and each MIND's dividend yield in year 60: CARE2 0.1 %, GOODS 0.2 %, the others 0.0 %; WIND is an energy
 *  COOP with 3 % of its market in year 60, AGRI a food COOP with none, D5) */
export const OWNER_ONLY = {
	count: 25,
	holding40: 7_741, // mean holding, HEARTS, year 40 (H3 note)
	holding60: 7_444, // year 60
	strictAvg40: 0.81, // dividends ÷ basic bundle, the group's average, year 40
	strictAvg60: 0.76, // year 60
	mix: { CITY: { share: 0.42, yield: 0.0 }, CARE2: { share: 0.13, yield: 0.001 }, HABITAT: { share: 0.1, yield: 0.0 }, WIND: { share: 0.1, yield: 0.0 }, AGRI: { share: 0.07, yield: 0.0 }, GOODS: { share: 0.07, yield: 0.002 } }
};

/** the dynamic world in the last ten years (years 51–60), against the earlier static world. source: sim-dynamic.md D1, D8, and for
 *  every value in HEARTS H2. mu and sigma are the rest means of each year's mean return and its spread across people,
 *  in HEARTS (H2). In R the script printed mu 1.5 % (D1); the gap is R's drift (Appendix G) */
export const DYN = {
	dayLiving: { y1: 4.4, y10: 56.9, y60: 63.3 }, // a day of living, HEARTS (H2)
	income: 77.5, // HEARTS a person a day (H2)
	spent: 0.9, // share of income spent (bought from COOPs) (D1)
	walletMelt: 0.13, // share of income that melts in wallets (D1)
	people: 0.414, // share of all MIND by HEART value (H2)
	treasuries: 0.112,
	pools: 0.363,
	// the arbitrage bot (H2). Law 5 pays it as a holder: 5.34 HEARTS a person a day at rest, against 2.65 to people (H4).
	// Rerouting (reroute=1) passes a buyer's MIND through the pools to the second seller, so the bot trades more
	bot: 0.112,
	poolDepth: 44_144, // what the pools hold at rest, HEARTS a person (H2; 43,239 MIND)
	yield: 0.047, // dividend yield a year, all MIND by value (D1, H2: 4.7 %)
	mu: 0.0158, // lasting return in HEARTS: dividends plus price change, in the last ten years (H2: 1.58 %; in R 1.54 %)
	muRun: 0.0545, // the same over the whole run, years 2–60 (H2: 5.45 %; in R 5.26 %)
	muYearsAbove: { years: 17, of: 59 }, // years 2–60 in which it was at or above the 7 % melt (H2; in R 20 of 59)
	priceChange: -0.004, // the price part of mu in the last ten years, in HEARTS (H2: −0.40 %; in R −0.44 %)
	sigma: 0.024, // its spread across people (H2: 2.40 %; in R 2.40 %)
	gini2: 0.04, // Proposition 2's Gini from mu and sigma (H2): 1 when mu is at or above the melt
	giniOwned: 0.33, // Gini of what people hold, years 51–60 (D1; H2: 0.328)
	giniOwnedBy: { y20: 0.3, y40: 0.31, y50: 0.32, y60: 0.33 }, // … by year (D3; H8: 0.303, 0.312, 0.324, 0.330)
	giniTrend: 0.009, // its least-squares trend over years 41–60, a 10 years (H2, H8: +0.009)
	pricesMin: 0.25, // MIND values in the last ten years, HEARTS: lowest … (H2)
	pricesMax: 1.26, // … highest
	sdLog: 0.47,
	mindsAlive: 25, // (D1)
	outputPerPlant: 9.88, // output per unit of plant at the end, sales-weighted (D1); 1 on day 1
	failures: 0, // whole run (D1, D5)
	exits: 7,
	foundings: 17,
	money: 121_762, // MIND count a person (D1, D8)
	bundleChange: -0.017, // the basic bundle's yearly change in HEARTS, years 51–60 (H2: −1.70 %, cheaper; in R −1.66 %, D8 −1.7 %)
	coopDaysShort: 190, // COOP-days short of working capital in 60 years (D8)
	coopDaysShortAfter10: 14, // … of them after year 10 (D8)
	topBottom: 2.7 // mean holding: top half of Aven pay ÷ bottom half (D8)
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
	minDays: 216,
	medianDays: 656,
	inflow: 28_868,
	items: 20_325,
	proposals: 2_673,
	dividends: 5_077 // all Law 5 dividends that the treasuries pay: to people, other treasuries, the pools and the bot
};
/** a share of all that flows into the treasuries in the last ten years, as D4 books it (sales gross): 'items', 'proposals' or 'dividends' */
export const reserveShare = (k) => RESERVES[k] / RESERVES.inflow;
/** a share of what the treasury itself keeps of its inflow: sales after the Law 5 share, which goes at once from each
 *  sale to the holders and never passes through the treasury. 'items' or 'proposals'. source: D4 */
export const treasuryShare = (k) => RESERVES[k] / (RESERVES.inflow - RESERVES.dividends);

/** one run per variation of the main run (new main 2). checks = [no one starves, no one has to work (normal), everyone
 *  gains, by the old yardstick]; no run passed the strict test (D7: "(✗)" on every row; strict: 1 would mark one that
 *  did); short = the basics short in the worst years; mu = the lasting return in the last ten years, HEARTS (H6); sigma
 *  its spread (H6); bundleMax = the most a day's basic bundle cost in a year, HEARTS (H6); basicsYears / worstYear /
 *  worstYearShare = the years with basics short, and the worst of them (D7 notes). source: sim-dynamic.md D7 (both
 *  tables and the notes) and H6 (mu, sigma, bundleMax), research/e2e/round-next-2. The script also prints the earlier
 *  main runs as rows ('main1', the new main of round 1, and 'base', Law 5 paid to the pools): MODEL_VERSIONS holds them */
// fields that the words are built from: foodYears = the years with food short (foodShock: after a shock);
// basicsYears = the years with basics short; falls = [who, from year, to year], each a fall of real consumption
// between two ten-year marks; personFall = the poorest person's fall, when no tenth fell; spent = the share of income
// spent; worst = the worst person-day; ownerWorst = the worst owner-only person-day; newcomerShort = person-days of
// newcomers short; popGrowth / popYears = a growing population and for how long
const LADDER_ROWS = [
	{ id: 'main', bundleMax: 0.575, share: 0.2, months: 9, checks: [1, 1, 1], shortfall: 0, yield: 0.047, mu: 0.0158, sigma: 0.024, failures: 0, exits: 7, foundings: 17, short: [], falls: [] },
	{ id: 'law35', bundleMax: 0.648, share: 0.35, checks: [1, 1, 0], shortfall: 0, yield: 0.063, mu: 0.0436, sigma: 0.0821, failures: 7, exits: 19, foundings: 39, short: [], falls: [['the poorest tenth', 40, 50]] },
	{ id: 'law50', bundleMax: 0.986, share: 0.5, checks: [1, 1, 0], shortfall: 0, yield: 0.106, mu: 0.0522, sigma: 0.0953, failures: 6, exits: 37, foundings: 62, short: [], falls: [['the poorest tenth', 40, 50]] },
	{ id: 'res6', bundleMax: 0.573, months: 6, checks: [1, 1, 1], shortfall: 0, yield: 0.058, mu: 0.038, sigma: 0.0411, failures: 1, exits: 6, foundings: 17, short: [], falls: [] },
	{ id: 'res12', bundleMax: 0.598, months: 12, checks: [1, 1, 1], shortfall: 0, yield: 0.053, mu: 0.0121, sigma: 0.0381, failures: 1, exits: 9, foundings: 14, short: [], falls: [] },
	// basics short in years 24 (energy), 30 and 55 (food, 3.8 % of person-days)
	{ id: 'prod0', bundleMax: 5.092, basicsYears: [24, 30, 55], worstYear: 55, worstYearShare: 0.038, checks: [0, 0, 0], shortfall: 0.0007, yield: 0.057, mu: 0.043, sigma: 0.0325, failures: 4, exits: 25, foundings: 34, short: ['food', 'energy'], worst: 0.76, falls: [['the two poorest tenths', 20, 30], ['the two poorest tenths', 40, 50]] },
	// plant: output per unit of plant in year 60 (sim-dynamic.csv, dyn:even, mean_productivity)
	{ id: 'even', bundleMax: 0.576, growth: 0.02, checks: [1, 1, 1], shortfall: 0, yield: 0.055, mu: 0.0544, sigma: 0.06, failures: 0, exits: 13, foundings: 18, short: [], plant: 3.55, falls: [] },
	{ id: 'wide', bundleMax: 0.575, checks: [1, 1, 1], shortfall: 0, yield: 0.066, mu: 0.0664, sigma: 0.0455, failures: 2, exits: 8, foundings: 18, short: [], falls: [] },
	{ id: 'wants', bundleMax: 0.554, checks: [1, 1, 0], shortfall: 0, yield: 0.002, mu: -0.0029, sigma: 0.0016, failures: 0, exits: 4, foundings: 11, short: [], spent: 0.11 },
	{ id: 'aven', bundleMax: 1.795, checks: [0, 0, 0], shortfall: 0.001, yield: 0.07, mu: 0.0766, sigma: 0.0296, failures: 11, exits: 7, foundings: 11, short: ['food'], foodYears: [33, 35, 38, 43, 46], worst: 0.18, falls: [['the poorest tenth', 1, 10], ['the poorest tenth', 10, 20]] },
	// ownerWorst: the worst owner-only person-day; poorOwner: the poorest owner-only person's real consumption, years 10 and
	// 20; personFall: the poorest person's fall, years 20 to 30 (D7 notes); newcomerShort: all its person-days short were
	// newcomers' (D7: 126, of them 126 newcomers)
	{ id: 'pop', bundleMax: 0.603, popGrowth: 0.02, popYears: 40, checks: [0, 0, 0], shortfall: 0, yield: 0.08, mu: 0.0513, sigma: 0.0824, failures: 2, exits: 13, foundings: 22, short: [], worst: 0.82, ownerWorst: 0.94, newcomerShort: 126, poorOwner: [13.0, 6.5], personFall: [20, 30] },
	// the old pool rule (0.05 of each HEART to the pools, a tenth of the treasury's half), with the idle-plant rule
	{ id: 'pool05', bundleMax: 0.525, pool: OLD_POOL_SHARE, checks: [1, 1, 1], shortfall: 0, yield: 0.043, mu: -0.0012, sigma: 0.0013, failures: 3, exits: 8, foundings: 17, short: [], falls: [] },
	// Law 5 without the pools (script key divPools = 0): dividends to people and other treasuries only, the rule of the
	// paper's version #599
	{ id: 'law5old', law5Pools: false, bundleMax: 0.578, checks: [1, 1, 1], shortfall: 0, yield: 0.099, mu: 0.0822, sigma: 0.0757, failures: 1, exits: 8, foundings: 19, short: [], falls: [] }
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
	if (v.basicsYears) out.push(`basics ran short in ${yearWords(v.basicsYears)}`);
	if (v.worst != null) out.push(`the worst person-day had ${pcs(v.worst)}`);
	if (v.newcomerShort) out.push(`every person-day short was a newcomer's`);
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
 *  0.1 and the idle-plant rule (SIM.reletUse) unless named. new = this paper's main run, new main 2 (research/e2e/
 *  round-next-2, seeds-new2.md and .json); law5all = the earlier main run, Law 5 paid to the pools (research/e2e/law5-all,
 *  seeds-new.md and .json; its p3 from the rerun of that rule set under the verdict, round-next-2 seeds-base.json, which
 *  counts the MIND of a COOP that ended at zero, so its μ differs a little and is not used); law5old = Law 5 without the
 *  pools, the rule of the paper's version #599 (law5-all seeds-law5-old, --set divPools=0, which reproduces #599's
 *  seeds-new.md exactly); old = the old pool rule (0.05 to the pools) under Law 5 without the pools (#599; pool-10
 *  seeds-old.md; not rerun with the pools paid); newNoFix = the law5all main without the idle-plant rule (--set
 *  reletUse=0; law5-all seeds-new-nofix); noFix = the version before the idle-plant rule (#598: Law 5 without the pools,
 *  no idle-plant rule; pool-10 seeds-new-nofix.md), main = its main seed alone. mu in HEARTS in the last ten years;
 *  margin = the melt less mu, the smallest of the eight and its seed; below = seeds with mu below the melt; pass = seeds
 *  on which all three checks of Proposition 3 pass, check1 to check3 each check, tenths = seeds on which every tenth was
 *  higher at each ten-year mark; gini = the measured Gini of holdings in HEARTS in year 60, lowest and highest; rising =
 *  seeds whose Gini still rose over years 41–60 (flat = of them, the seeds whose trend was +0.000 per ten years); fails /
 *  food = COOP failures on the eight seeds, all and food COOPs; successors = successors on a failed plant that failed
 *  too; scrapped = idle plants scrapped; short = person-days short from day 8, summed; foundingShort = in the founding
 *  (days 1–7); year1 = seeds whose worst person-day from day 8 fell in the first weeks of year 1 (the seed check's
 *  notes); pools = the pools' share of all MIND, lowest and highest seed; oneSeller = basics (food, energy, housing)
 *  that end with one seller, of 24; strictShare = the mean share of owner-only person-days after year 10 that dividends
 *  alone paid. source: scripts/theos-e2e-sim.mjs --seeds 20261012-20261019.
 *  pass, check3 and tenths judge part 3 by the old yardstick (every decile higher, at day-1 prices, at each ten-year
 *  mark). p3: part 3 by the rule of Section 11.1 (P3_RULE), seed by seed in order: the tenths failing (of 20) under the
 *  verdict and each side reading (YARDSTICKS), and ok12, 1 where checks 1 and 2 (the normal test) both passed. A rule
 *  set with no p3 was not judged by tenths */
export const SEEDS = {
	from: 20261012,
	to: 20261019,
	n: 8,
	new: {
		muMin: -0.0057, muMax: 0.0767, muMedian: 0.0214, below: 7, marginMin: -0.0067, marginMinSeed: 20261015, pass: 6, check1: 8, check2: 8, check3: 6, tenths: 7, gini: [0.3, 0.36], rising: 2, flat: 0, fails: 6, food: 6, successors: 0, scrapped: 5, short: 0, foundingShort: 0, year1: 0, pools: [0.224, 0.505], oneSeller: 11, strictShare: 0.738,
		p3: { taste: [7, 10, 20, 20, 20, 15, 20, 20], a: [7, 20, 20, 20, 20, 15, 20, 20], b: [7, 10, 20, 20, 20, 15, 20, 20], c: [3, 4, 2, 20, 20, 15, 20, 20], ok12: [1, 1, 1, 1, 1, 1, 1, 1] }
	},
	law5all: {
		muMin: -0.0076, muMax: 0.0733, muMedian: 0.0032, below: 7, marginMin: -0.0033, marginMinSeed: 20261012, pass: 5, check1: 5, check2: 5, check3: 6, tenths: 7, gini: [0.32, 0.33], rising: 3, flat: 0, fails: 11, food: 11, successors: 3, scrapped: 5, short: 25_697, foundingShort: 4_091, year1: 0, pools: [0.204, 0.494], oneSeller: 22, strictShare: 0.563,
		p3: { taste: [20, 20, 20, 20, 20, 20, 20, 20], a: [20, 20, 20, 20, 20, 20, 20, 20], b: [20, 20, 20, 20, 20, 20, 20, 20], c: [12, 20, 20, 20, 19, 20, 20, 7], ok12: [1, 1, 0, 1, 0, 1, 1, 0] }
	},
	law5old: { muMin: 0.0624, muMax: 0.0974, muMedian: 0.0738, below: 2, marginMin: -0.0274, marginMinSeed: 20261019, pass: 2, check1: 4, check2: 4, check3: 3, tenths: 3, gini: [0.32, 0.39], rising: 7, flat: 1, fails: 16, food: 14, successors: 2, scrapped: 6, short: 18_888, year1: 2, pools: [0.097, 0.104] },
	old: { muMin: 0.0602, muMax: 0.0873, muMedian: 0.0684, below: 5, marginMin: -0.0173, marginMinSeed: 20261016, pass: 0, check1: 1, check2: 1, check3: 2, gini: [0.34, 0.4], rising: 8, fails: 16, food: 13, short: 40_157, year1: 3, law5Pools: false },
	newNoFix: { muMin: -0.0076, muMax: 0.04, muMedian: -0.0003, below: 8, pass: 3, check1: 3, check2: 3, check3: 7, fails: 18, food: 18, successors: 10, short: 52_318, main: { food: 2, successors: 0, short: 35_371, mu: -0.001 } },
	noFix: { muMin: 0.0661, muMax: 0.1008, muMedian: 0.0756, below: 2, pass: 3, check1: 4, check2: 4, check3: 3, fails: 34, food: 32, successors: 18, short: 27_113, main: { food: 14, successors: 11, short: 9_975, mu: 0.0944 } }
};

/** seeds on which part 3 holds under yardstick y (no tenth fails), and on which all three parts hold (the normal test
 *  for parts 1 and 2), from a seed set with a p3 entry; null when the seed set was not judged under y */
export const p3Held = (s, y = YARDSTICK) => (s?.p3?.[y] ? s.p3[y].filter((v) => v === 0).length : null);
export const allThreeHeld = (s, y = YARDSTICK) => (s?.p3?.[y] ? s.p3[y].filter((v, i) => v === 0 && s.p3.ok12[i]).length : null);
/** tenths failing under yardstick y, summed over a seed set's seeds (of 20 a seed); null when not judged */
export const p3Failing = (s, y = YARDSTICK) => (s?.p3?.[y] ? s.p3[y].reduce((a, v) => a + v, 0) : null);

/** the melt tests (Section 11.2.5): the earlier main run (law5all, Law 5 paid to the pools, without the switches of
 *  rounds 1 and 2) on the same eight seeds, with one lever changed at a time, all with the idle-plant rule and with Law 5
 *  paid to the pools too. Not rerun on new main 2. new: under Law 4 of this paper (the pools' part 0.1), from
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
 *  new: this paper's main run, new main 2, on the 24 seeds (research/e2e/round-next-2, crn-main2-base.md): pass and
 *  check3 by the old yardstick, passT and check3T by tenths under the verdict; foodShort / waterShort / foundingShort:
 *  person-days short of food and of water from day 8, and in the founding (days 1–7); strictShare: the mean share of
 *  owner-only person-days after year 10 that dividends alone paid; oneSeller: basics (food, energy, housing) that end
 *  with one seller, of 72; gini: the measured Gini of holdings in the last year, the mean; flips: food sellers' price
 *  flips from year 2; d1Last: decile 1's real consumption in the last year, the mean. UPGRADES2.same pairs it with the
 *  earlier main runs.
 *  pool: the pool comparison under the earlier main run (law5all: the pools' part 0.1, Law 5 paid to the pools too,
 *  none of the switches of rounds 1 and 2), new / old / tests: the rule of Law 4 against the old pool rule (0.05) under
 *  the same Law 5. source: scripts/theos-e2e-sim.mjs --pair 20261012-20261035 --vs poolShare=0.05 (research/e2e/law5-all,
 *  crn-new-old.md and .json). Not rerun on new main 2.
 *  law5: the same earlier main run (pool.new) against Law 5 without the pools (old: --vs divPools=0, the rule of #599;
 *  crn-law5-old.md and .json); its old side is v599.new, run again.
 *  v599: the pool comparison of the paper's version #599, both rules under Law 5 without the pools (research/e2e/pool-10,
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
	new: { short: 1_883, shortSeeds: 1, food: 16, foodSeeds: 12, fails: 17, successors: 0, scrapped: 15, pass: 21, passT: 0, check1: 23, check2: 23, check3: 22, check3T: 0, mu: [-0.0041, 0.0754], muMedian: 0.0237, below: 22, foodShort: 1_883, waterShort: 0, foundingShort: 0, strictShare: 0.8431, oneSeller: 37, gini: 0.337, flips: 1_869, d1Last: 243.4 },
	pool: {
		new: { short: 66_218, shortSeeds: 14, food: 19, foodSeeds: 14, fails: 22, successors: 3, scrapped: 9, pass: 9, check1: 10, check2: 10, check3: 22, mu: [-0.0043, 0.062], muMedian: 0.002, below: 24 },
		old: { short: 91_592, shortSeeds: 15, food: 33, foodSeeds: 20, fails: 39, successors: 2, scrapped: 25, pass: 6, check1: 9, check2: 9, check3: 18, mu: [-0.013, 0.0825], muMedian: 0.0013, below: 23 },
		tests: {
			short: { better: 11, worse: 7, same: 6, p: 0.4807 },
			food: { better: 11, worse: 4, same: 9, p: 0.1185 },
			fails: { better: 11, worse: 4, same: 9, p: 0.1185 },
			mu: { better: 14, worse: 10, same: 0, p: 0.5413 },
			pass: { better: 7, worse: 4, same: 13, p: 0.5488 }
		}
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
	1: { living: 4.36, bundle: 0.5748, vMin: 0.33, vMax: 1.61 },
	10: { living: 56.87, bundle: 0.186, vMin: 0.22, vMax: 4.99 },
	30: { living: 84.06, bundle: 0.0704, vMin: 0.29, vMax: 1.38 },
	40: { living: 82.08, bundle: 0.0561, vMin: 0.27, vMax: 1.36 },
	60: { living: 63.31, bundle: 0.0399, vMin: 0.23, vMax: 1.22 }
};
/** a day's basic bundle as a share of a day of living, in year y */
export const bundleShareOfLiving = (y) => PRICES_BY_YEAR[y].bundle / PRICES_BY_YEAR[y].living;

/** the retired yardstick R (the geometric mean of the prices of SOLAR, HABITAT and CITY), in R a HEART: how far it
 *  drifted against the average MIND, and the lasting return in the last ten years that the script prints in R (D1, D7).
 *  source: sim-dynamic.md H1, H2 and H6 ("R a HEART at rest", "μ, R") */
export const OLD_R = { y1: 1.28, y40: 1.17, y60: 1.15, rest: 1.15, mainMu: 0.0154 };

/** competition by good: the largest seller's share of what was made in year 1 and year 60 (null: none made that year),
 *  sellers60: for the basics, the sellers with 5 % or more of what was made in year 60 (the part 3 section, "Sellers of
 *  the basics in the last year"); and the COOPs founded and ended over 60 years (a successor that leases a failed plant
 *  is not counted as founded). source: sim-dynamic.md D5 (tables and lists) and the part 3 section */
export const COMPETITION = [
	{ good: 'food', y1: 0.7, y60: 0.69, sellers60: 2, founded: 3, ended: 1 },
	{ good: 'energy', y1: 0.6, y60: 0.97, sellers60: 1, founded: 1, ended: 1 },
	{ good: 'housing', y1: 0.63, y60: 0.94, sellers60: 2, founded: 0, ended: 0 },
	{ good: 'water', y1: 1.0, y60: 1.0, sellers60: 1, founded: 0, ended: 0 },
	{ good: 'goods', y1: 0.65, y60: 0.56, founded: 2, ended: 0 },
	{ good: 'care', y1: 0.5, y60: 0.82, founded: 1, ended: 0 },
	{ good: 'experiences', y1: 0.54, y60: 0.61, founded: 4, ended: 4 },
	{ good: 'panels', y1: 1.0, y60: 0.8, founded: 3, ended: 0 },
	{ good: 'materials', y1: 1.0, y60: 0.93, founded: 3, ended: 1 }
];
/** the share of a good's output from which a COOP counts as a seller in COMPETITION's sellers60 */
export const SELLER_MIN = 0.05;
/** the goods (water aside) that one COOP made alone, or almost alone (no other seller with SELLER_MIN or more), in year 60 */
export const soleMakers = () => COMPETITION.filter((g) => g.good !== 'water' && (g.y60 === 1 || g.sellers60 === 1)).map((g) => g.good);
/** the failures on the main seed: none (D5: "Failures (0): none"). coop / year / second: the first two, as the paper
 *  names them (null: none); list: all of them in order, with what the City COOP did with the plant. source: D5 */
export const FAILURE = { coop: null, good: null, year: null, count: 0, food: 0, scrapped: 0, leased: 0, second: null, list: [] };
/** the energy COOPs founded later, each of which exited within this many years (D5: ENERGY2, founded in year 4,
 *  exited in year 7) */
export const ENERGY_ENTRANTS = { count: 1, years: 3 };
/** the COOPs that exited on the main seed, in order: year and COOP (D5) */
export const EXITS = [[7, 'ENERGY2'], [10, 'FOOD3'], [17, 'EXP2'], [20, 'EXP3'], [23, 'EXP5'], [27, 'MAT4'], [28, 'EXP4']];

/** every MIND over its life, in HEARTS (H5). byMind: the MINDs of the first COOPs, each with the years it lived, its
 *  mean return a year (Law 5 dividends plus price change), its price change a year, and its compounded return a year
 *  (what one MIND held with its dividends became, the dividends kept as more of the same MIND); all before the melt.
 *  good: what its COOP makes; share1 / share60: its share of what was made of that good in year 1 and year 60 (D5;
 *  null: none made that year; ended: its COOP failed or exited, with the year, and its MIND counts −100 % that year).
 *  source: sim-dynamic.md D2 (second table), H5 and D5; sim-dynamic.json mindReturns */
export const MIND_RETURNS = {
	minds: 32,
	ended: 7,
	withThreeYears: 32,
	aboveMelt: 8,
	aboveMeltEnded: 5,
	arts: { compounded: 0.282, years: 59 },
	byMind: {
		CITY: { good: 'water', years: 59, mean: -0.003, priceChange: -0.003, compounded: -0.003, share1: 1.0, share60: 1.0 },
		SOLAR: { good: 'energy', years: 59, mean: 0.017, priceChange: 0.012, compounded: 0.011, share1: 0.6, share60: 0.97 },
		WIND: { good: 'energy', years: 59, mean: 0.005, priceChange: 0.002, compounded: 0.004, share1: 0.4, share60: 0.03 },
		HABITAT: { good: 'housing', years: 59, mean: 0.006, priceChange: 0.003, compounded: 0.005, share1: 0.63, share60: 0.94 },
		AGRI: { good: 'food', years: 59, mean: 0.014, priceChange: 0.009, compounded: 0.013, share1: 0.7, share60: 0.0 },
		PANEL: { good: 'panels', years: 59, mean: -0.026, priceChange: -0.027, compounded: -0.029, share1: 1.0, share60: 0.8 },
		BUILD: { good: 'materials', years: 59, mean: -0.004, priceChange: -0.006, compounded: -0.005, share1: 1.0, share60: 0.93 },
		ARTS: { good: 'experiences', years: 59, mean: 0.298, priceChange: 0.024, compounded: 0.282, share1: 0.54, share60: 0.39 }
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
// 0.01); rest: H4's "not explained" column, unrounded (sim-dynamic.json roundTrip, H4 prints −0.041, 0.004 and 0.002).
// Liquidations were 0.00 in the last ten years and are left out. own: the investor's part (people) or the treasury's
// part (treasuries) of each HEART invested; pool: the pools' part. Law 5 pays every holder but the seller's own
// treasury, so the treasuries pay dividends to people (dividends), to the pools (dividendsPools) and to the arbitrage
// bot (dividendsBot, not a place here), and the pools receive theirs (pools.in.dividends)
export const ROUND_TRIP = {
	people: { in: { own: 11.89, items: 55.68, proposals: 7.33, dividends: 2.65 }, out: { buying: 69.52, melt: 9.72, retired: 0.0 }, net: -1.7, moves: -0.59, change: -2.33, rest: -0.040975 },
	treasuries: { in: { own: 9.51, sales: 69.52 }, out: { dividends: 2.65, dividendsPools: 5.91, dividendsBot: 5.34, items: 55.68, proposals: 7.33, melt: 2.62, retired: 0.0 }, net: -0.5, moves: 0.46, change: -0.03, rest: 0.004213 },
	pools: { in: { pool: 2.38, dividends: 5.91, routing: 0.03 }, out: { melt: 8.47, retired: 0.0 }, net: -0.15, moves: -0.08, change: -0.23, rest: 0.001936 },
	issuedMind: 24.0, // MIND a person a day (24 HEARTS converted); in HEARTS 23.78 (H4)
	meltedMind: 23.31, // MIND a person a day; in HEARTS the same 23.31, because by (7) all MIND is worth as many HEARTS as there are MINDs
	retiredMind: 0.0, // MIND that left with COOPs that ended (D8)
	stockGrowth: 0.69, // the MIND stock changed by this much a person a day (D8): it still grew, towards u/r from below
	unexplainedMax: 0.00053, // the largest unexplained rest, as a share of a place's inflow (H4: 0.053 %)
	between: { sales: 0.01, rent: 0.03 } // flows between treasuries, which cancel out (H4)
};
/** the share of what people hold that leaves a year with the MIND of COOPs that ended: what is retired from people's
 *  wallets a year (H4) over what people hold (DYN.people × DYN.money; the average MIND is worth 1 HEART). With the
 *  dividends and the price change, it closes the lasting return μ (Section 11.2.5) */
export const retiredShare = (rt = ROUND_TRIP, d = DYN) => (rt.people.out.retired * 365) / (d.people * d.money);

/** what new MIND, the melt and the MIND retired with COOPs that ended leave over, as a share of new MIND (D8: 2.9 %) */
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
export const BUNDLE_REST = 0.0431;

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
// Design numbers for maiaCITY's first village, not simulation results. They come from maiaCITY's own design research
// (the energy files energy/village-energy.md and energy/energy.md, the dome files dome-research/dome-sizes.md, and the
// village's food, water and timber plans) and from the outside studies that refs.js cites where the paper prints them.
// "Estimate" marks a number that nobody has checked.

/** a full village and its geothermal plant; one great dome of about 250 people and what binds first there; the recipes
 *  and the physical floor of each material; the food forest, water and timber of the village's plans */
export const ENERGY = {
	village: { people: 1_488, el: 35.8, heat: 104, useEl: 12, useHeat: 6 }, // GWh a year: six great domes and the centre (village-energy.md)
	smilGJ: [50, 70], // Smil's plateau, GJ of primary energy a person a year (refs.js smil)
	dome: { people: 250, harvest: 1.3, use: 0.39, build: 3.0, decHarvest: 27, decUse: 33 }, // one great dome: GWh a year harvested, used at home and to build another; December MWh, use at least (village-energy.md, dome-sizes.md)
	pvPayback: 1.1, // years, Northern Europe (refs.js fraunhofer)
	pvMunich: 1, // MWh a year per kWp in Munich (village-energy.md)
	recipes: { glulam: 0.5, steel: 3.6, glass: 1.3, clay: 0.5, panels: 2.0 }, // MWh a tonne (energy.md and the village's works)
	floors: { sq: 0.33, photosynthesis: 0.046, photosynthesisC4: 0.06, steelMin: 2.9, glassMin: 0.69 }, // one single-junction cell (refs.js shockley); C3 and C4 plants (refs.js zhu); steel from ore, the practical minimum on a fuel basis, and glass, MWh a tonne
	forest: { y1: 0.1, fullYear: 10, kgM2: 0.74 }, // food forest: share of food in year 1, full in year 10, kg/m² a year (the village's food plan); the riskiest number (refs.js peters)
	water: { supply: 140, need: 100, dry: 0.3, dryYear: 0.98 }, // L a bed a day from rain; a year 30 % drier gives 0.98 of need (the village's water plan)
	wood: { t: 150, ha: 10, tPerBed: 6, beds: 25 }, // t a year from 10 ha, an estimate (it needs fast hemp and bamboo); t a bed; beds a year (the village's timber plan)
	geo: { el: 3.4, heat: 12.6, carnot: 0.36, eroiHeat: [15, 35] }, // MW a plant; Carnot limit; EROI with heat, estimate (village-energy.md; refs.js atlason)
	foodStockDays: 5 // days of food in hand (the fix that Section 11.2.6 proposes)
};

/** average power a person, kW, from GWh a year for n people */
export const kwPerPerson = (gwh, n = ENERGY.village.people) => (gwh * 1e6) / 8_760 / n;

/** GJ a year as average power, kW */
export const gjToKw = (gj) => (gj * 1e9) / (365.25 * 86_400) / 1_000;

/** years until a dome's yearly surplus of energy builds the materials of one more dome. Computed from ENERGY.dome's 1.3
 *  and 0.39 GWh, it gives 3.3; a rounded surplus of ~0.9 GWh would give about 3.4 years */
export const domeYears = (d = ENERGY.dome) => d.build / (d.harvest - d.use);
/** beds a year that the energy surplus alone could build (a dome a domeYears()), against ENERGY.wood.beds from wood */
export const bedsFromEnergy = (d = ENERGY.dome) => d.people / domeYears(d);
/** December's energy deficit, MWh: at least the use, less the harvest */
export const decemberGap = (d = ENERGY.dome) => d.decUse - d.decHarvest;

/** a p value of a sign test in words */
export const pWords = (p) => (p < 0.001 ? 'p < 0.001' : `p = ${fmt(p, 3)}`);

/** the economic model's first round of upgrades (Section 11.2.1). Each upgrade is a switch of scripts/theos-e2e-sim.mjs,
 *  run alone against the earlier main run (the base, SIM_NAMES.versions.law5all) on the 24 seeds with the same shocks
 *  and judged by the sign test. The round's own main run (the new main) switches on the three that helped their target
 *  with no check of Proposition 3 worse (kept). On the main seed it fails check 1, traced to orders that a seller
 *  cannot fill and that no other seller is asked for; round 2 fixed that (UPGRADES2). source: research/e2e/round-next
 *  (summary.md, crn-main-base.md, seeds-new.md and .json, sim-dynamic.md, measures-main.md, measures-base.md, one file
 *  per upgrade), merged at commit 91057fb; part 3 under the verdict and the side readings from the reruns of
 *  research/e2e/round-next-2 (verdict.md, crn-main2-main.md, seeds-new.json). μ there counts the MIND of a COOP that
 *  ended at zero, so the base's μ differs a little from SEEDS.law5all (main seed 7.32 % against 7.33 %) */
export const UPGRADES = {
	round: 1,
	commit: '91057fb',
	// strictShare counts the owner-only person-days after this year
	strictAfter: 10,
	// the three kept: a food store of `days` days of food; rivals copy the leader's technology after `years` years; the
	// founding week's HEARTS go into the sellers of the four basics
	kept: { foodStore: { days: 54 }, techCopy: { years: 2 }, founding: { goods: ['food', 'energy', 'housing', 'water'] } },
	// the main seed, the new main against the base (sim-dynamic.md and summary.md). checks: as MODEL_VERSIONS, part 3 by
	// the old yardstick; strictShare: owner-only person-days that dividends alone paid, after year 10; tenths: tenths
	// failing part 3 under the verdict (and under (a) and (b): 20; under (c): 0; round-next-2 verdict.md); d1: decile 1's
	// real consumption at day-1 prices, year 1 and year 60
	mainSeed: {
		checks: [0, 0, 1], short: 8_750, worst: 0.92, worstYear: 11, good: 'food', strictShare: 0.99, baseStrictShare: 0.774,
		tenths: 20, foundingShort: 0, baseFoundingShort: 449, mu: 0.0665, pools: 0.283, basePools: 0.204, gini: 0.35, failures: 2, exits: 5, foundings: 15,
		d1: [13.7, 164.8], baseD1: [12.8, 114.3],
		// why check 1 fails: a successor food seller's price flips each step; at the low price buyers ask it for `asked`
		// times its capacity and it delivers `delivered` of the orders, while `others` other food sellers hold `stockKcal`
		// kcal in store. Orders that a seller cannot fill are not passed to another seller
		trace: { asked: [3.5, 3.9], delivered: [0.42, 0.47], others: 2, stockKcal: 33e6 }
	},
	// the 8-seed check (seeds-new.md and .json), with the fields of SEEDS.new; p3 from the rerun under the verdict
	// (round-next-2 seeds-new.json, which reproduces every other number)
	seeds: {
		muMin: -0.0068, muMax: 0.0713, muMedian: 0.019, below: 7, pass: 5, check1: 6, check2: 6, check3: 7, short: 20_412, foundingShort: 0, fails: 8, gini: [0.32, 0.36], oneSeller: 11, strictShare: 0.765,
		p3: { taste: [20, 20, 20, 20, 20, 20, 20, 20], a: [20, 20, 20, 20, 20, 20, 20, 20], b: [20, 20, 20, 20, 20, 20, 20, 20], c: [0, 20, 3, 20, 2, 20, 20, 0], ok12: [0, 1, 0, 1, 1, 1, 1, 1] }
	},
	// the 24 same-shock seeds (crn-main-base.md): the base and the new main, summed or counted over the seeds. short:
	// person-days short from day 8; foundingShort: in the founding (days 1–7); check1 / pass: seeds passing check 1 /
	// all three checks (part 3 by the old yardstick); strictShare: as mainSeed, the mean of the seeds; above: the seeds
	// with μ above the melt and their μ; oneSeller: basics (food, energy, housing) that end with one seller, of oneSellerOf
	same: {
		n: 24,
		base: { short: 66_218, foundingShort: 12_346, check1: 10, pass: 9, strictShare: 0.5901, muMedian: 0.0005, below: 24, foodFails: 19, fails: 22, oneSeller: 53, gini: 0.327 },
		main: { short: 168, shortSeeds: 2, foodShort: 0, foundingShort: 0, check1: 22, pass: 21, strictShare: 0.7819, muMedian: 0.0441, below: 22, above: [[20261013, 0.0716], [20261021, 0.0781]], foodFails: 21, fails: 21, oneSeller: 32, gini: 0.337 },
		oneSellerOf: 72,
		tests: {
			short: { better: 12, worse: 1, same: 11, p: 0.003 },
			founding: { better: 24, worse: 0, same: 0, p: 1.2e-7 },
			check1: { better: 12, worse: 0, same: 12, p: 0.00049 },
			pass: { better: 12, worse: 0, same: 12, p: 0.00049 },
			strict: { better: 19, worse: 5, same: 0, p: 0.007 },
			mu: { higher: 19, lower: 5, same: 0, p: 0.007 },
			oneSeller: { better: 15, worse: 0, same: 9, p: 6.1e-5 },
			gini: { higher: 19, lower: 5, same: 0, p: 0.007 }
		},
		// the founding week alone (founding2.md): all COOP failures, base against the upgrade, and the sign test
		foundingFails: { base: 22, upgrade: 39, p: 0.041 }
	},
	// part 3 on the 24 seeds: tenths failing, of `of`, under the verdict and each side reading (round-next-2 verdict.md
	// and crn-main2-main.md, which rerun both rule sets under the verdict); falls of one extra by more than P3_RULE.fall
	// in P3_RULE.years years under (a), and how many of them came while the city's taste for that good fell
	// (measures-main.md and measures-base.md)
	p3: { of: 480, taste: { base: 480, main: 438 }, a: { base: 480, main: 463 }, b: { base: 480, main: 438 }, c: { base: 338, main: 201 }, falls: { base: 3_683, main: 2_967 }, tasteFell: { base: 2_084, main: 1_727 } },
	// the bound that Law 5 sets on the strict test, at rest (measures-main.md): all sales a person-day in day's basic
	// bundles; what the median owner-only person needs; how many bundles a day the bound allows; what dividends paid
	strictBound: { sales: { base: 1_401, main: 1_982 }, need: 66, allows: { base: 21.5, main: 30.5 }, paid: { base: 0.99, main: 1.55 } },
	// the upgrades not kept: each run alone against the base on the 24 seeds unless `seeds` says otherwise; why: worse
	// (it made its own target worse), met (its target was already met, and food COOP failures rose), luck (its target
	// was already met, and its gains had no mechanism), none (no clear effect), cost (another check got worse), test
	// (a test of the model, not a rule)
	notKept: {
		daily: { seeds: 8, broke: 3, why: 'test' },
		dailyShocks: { seeds: 8, why: 'none' },
		floorFull: { short: [66_218, 557_051], pShort: 0.0001, check1: [10, 0], why: 'worse' },
		fwdPrice: { short: [66_218, 642_422], pShort: 0.001, why: 'worse' },
		waterFloor: { food: [19, 45], pFood: 0.035, why: 'met' },
		waterReserve: { food: [19, 40], why: 'luck' },
		rentCover: { food: [19, 34], pFood: 0.049, fails: [22, 37], pFails: 0.031, why: 'met' },
		rentLaw5: { cityMu: [-0.0053, -0.0044], pCity: 0.31, strict: [0.59, 0.599], pStrict: 0.84, why: 'none' },
		holdFloor: { strict: [0.59, 0.647], pStrict: 0.54, retired: [218, 612], pRetired: 0.004, why: 'none' },
		payLeast: { strict: [0.59, 0.81], pStrict: 0.007, p3old: [22, 7], pP3: 0.001, why: 'cost' },
		founding1: { founding: [12_346, 42_000], check1: [10, 0], why: 'worse' },
		heirMind: { retired: [218, 221], successors: [3, 9], why: 'none' },
		endToCity: { food: [19, 25], pFood: 0.063, strict: [0.59, 0.557], pStrict: 0.15, why: 'none' },
		foundSignal: { oneSeller: [53, 50], pOne: 1, fails: [22, 41], pFails: 0.096, why: 'none' },
		avenOutput: { food: [19, 183], pass: [9, 2], pPass: 0.039, why: 'worse' }
	}
};

/** the earlier main run, Law 5 paid to the pools (SIM_NAMES.versions.law5all; research/e2e/law5-all, merged in fed68db
 *  from ab8ed86): the numbers of its main seed that the paper still compares (the versions table, the progress table,
 *  the same-shock pool comparison). checks by the old yardstick; strictShare after year 10; genesisShort: person-days
 *  short in the founding week; tenths / tenthsC: tenths failing part 3 on the main seed under the verdict and (c)
 *  (round-next-2 verdict.md; (a) and (b) 20 as the verdict); d1: decile 1, year 1 and year 60; flips: food price flips
 *  from year 2 (round-next-2 summary.md). source: research/e2e/law5-all sim-dynamic.md (D1, D5, D6, D7, H2, H6) */
export const LAW5ALL = {
	checks: [1, 1, 1], short: 0, genesisShort: 449, strictShare: 0.7735, failures: 3, foodFailures: 3, exits: 12, foundings: 19,
	mu: 0.0733, people: 0.654, pools: 0.204, bot: 0.001, bundleMax: 0.889, tenths: 20, tenthsC: 12, d1: [12.8, 114.3], flips: 162
};

/** the economic model's second round of upgrades (Section 11.2.1): new main 2, this paper's main run. Each change is a
 *  switch of scripts/theos-e2e-sim.mjs, run alone against the new main (round 1, UPGRADES) on the 24 seeds with the same
 *  shocks and judged by the sign test. New main 2 switches on together every change that helped its target with no
 *  check worse (kept), and part 3 is judged by the verdict (p3=2). source: research/e2e/round-next-2 (summary.md,
 *  verdict.md, yardsticks.md, crn-main2-base.md and .json, crn-main2-main.md and .json, seeds-new2.md and .json,
 *  sim-dynamic.md, drops.md, seed-20261014.md and one file per change: reroute.md, founding3.md, rentShort.md,
 *  reletUsed.md, waterStock.md), merged at commit 79f83e8 (its model is that of 55ffab9; the two commits since change
 *  only how part 3 is read and recorded). */
export const UPGRADES2 = {
	round: 2,
	commit: '79f83e8',
	// the script's default is new main 2 with the verdict (p3=2); these --set flags give the earlier main runs: the base
	// (law5all, with part 3 by the old yardstick, as it ran; leave out p3=0 to judge it by the verdict) and the new main
	// of round 1 (the script's usage note: ROUND_OFF and ROUND2_OFF)
	flags: { base: 'p3=0,foodStore=0,techCopy=0,founding=0,reroute=0,rentShort=0,waterStock=0', main1: 'reroute=0,rentShort=0,waterStock=0' },
	// the three kept, each run alone against the new main on the 24 seeds: [new main, with the change]. reroute: what a
	// sold-out seller cannot deliver passes at once to the other sellers of the good that still have stock or spare
	// capacity, at their price; cause: on the main seed one food seller's orders went unmet while the other had spare
	// capacity. rentShort: how the simulation models the City COOP's ground-rent policy: the City still lowers rent while
	// land lies empty and raises it while more than `over` of the land is let, but only while some COOP asks for land
	// the City cannot give; cause: rent rose `rise` times while the land was over 90 % let and nobody asked for more.
	// waterStock: the City COOP keeps `days` days of water as stock, filled from spare capacity (no tank cost or losses
	// in the model); cause: water short on 2 seeds when a shock cut the only water plant
	kept: {
		reroute: { mainSeedShort: [8_750, 0], short: [168, 63], taste: [438, 365], pTaste: 0.11, a: [463, 368], pA: 0.008, c: [201, 232], pC: 0.078, fails: [21, 21], flips: [1_758, 2_241], pFlips: 0.023 },
		rentShort: { over: 0.9, rise: [15, 106], fails: [21, 14], successors: [6, 0], taste: [438, 437], seed: 20261014, seedFails: [6, 4], seedShort: [11_662, 7_000], swing: [106, 5] },
		waterStock: { days: 90, waterShort: [168, 0], waterSeeds: 2, check12: [22, 24], fails: [21, 18], taste: [438, 451], pTaste: 0.69 }
	},
	// the two not kept, each run alone against the new main on the 24 seeds. founding3: the founding week only by the
	// day's needs; reletUsed: a successor leases only the part of the plant that was in use. why: as UPGRADES.notKept
	notKept: {
		founding3: { foundingShort: [0, 5_985], short: [168, 3_790], fails: [21, 24], why: 'worse' },
		reletUsed: { fails: [21, 16], seed: 20261014, seedShort: [11_662, 24_500], why: 'cost' }
	},
	// the main seed, each rule set its own run: [base, new main, new main 2] (summary.md; verdict.md). checks by the old
	// yardstick; tenths under the verdict, (a) and (c); strictShare after year 10; d1: decile 1 in year 1 and year 60;
	// flips: food price flips from year 2
	mainSeed: {
		short: [0, 8_750, 0], foundingShort: [449, 0, 0], failures: [3, 2, 0], checks: [[1, 1, 1], [0, 0, 1], [1, 1, 1]],
		taste: [20, 20, 7], a: [20, 20, 7], b: [20, 20, 7], c: [12, 0, 3], mu: [0.0732, 0.0665, 0.0158], strictShare: [0.774, 0.99, 0.4353],
		d1: [[12.8, 114.3], [13.7, 164.8], [13.6, 115.1]], flips: [162, 132, 232],
		// the price flips of new main 2 come from start-ups: FOOD4 in years 24–28 (154 flips) and the greenhouse in years 2–5
		flipsStartup: 154,
		// the 7 tenths that fail under the verdict: tenths 1–3 by holdings and 1–2 by Aven output on experiences in year 5,
		// after a shock took 49.5 % of an experiences seller's plant for 154 days; the top tenth by both on care in year
		// 5, rationed at its satiation level (4 hours) after a shock to a care seller
		fail: { experiences: { holdings: 3, aven: 2, year: 5, shock: 0.495, shockDays: 154 }, care: { tenth: 10, year: 5 } }
	},
	// the 8 seeds, each its own run: [base, new main, new main 2], summed over the seeds (summary.md)
	seeds8: { of: 160, taste: [160, 160, 132], a: [160, 160, 142], b: [160, 160, 132], c: [138, 85, 104], short: [25_697, 20_412, 0], foundingShort: [4_091, 0, 0], failures: [11, 8, 6], successors: [3, 4, 0] },
	// the 24 same-shock seeds: [base, new main, new main 2] (crn-main2-base.md, crn-main2-main.md, summary.md). pass:
	// all three checks by the old yardstick; passT: by tenths under the verdict; passC: part 3 by (c)
	same: {
		n: 24, of: 480,
		taste: [480, 438, 399], a: [480, 463, 405], b: [480, 438, 399], c: [338, 201, 304],
		short: [66_218, 168, 1_883], foodShort: [66_092, 0, 1_883], waterShort: [126, 168, 0], foundingShort: [12_346, 0, 0],
		fails: [22, 21, 17], foodFails: [19, 21, 16], successors: [3, 6, 0], check1: [10, 22, 23], check2: [10, 22, 23], pass: [9, 21, 21], passT: [0, 0, 0], passC: [0, 3, 0],
		muMedian: [0.0005, 0.0441, 0.0237], below: [24, 22, 22], strictShare: [0.5901, 0.7819, 0.8431], d1Last: [215.0, 201.3, 243.4], gini: [0.327, 0.337, 0.337], oneSeller: [53, 32, 37], oneSellerOf: 72, flips: [1_989, 1_758, 1_869],
		// new main 2 against each, seed by seed: higher / lower / same, and the two-sided sign test
		vsBase: {
			short: { higher: 0, lower: 14, same: 10, p: 0.00012 },
			founding: { higher: 0, lower: 24, same: 0, p: 1.2e-7 },
			fails: { higher: 6, lower: 7, same: 11, p: 1 },
			taste: { higher: 0, lower: 7, same: 17, p: 0.016 },
			a: { higher: 0, lower: 6, same: 18, p: 0.031 },
			c: { higher: 8, lower: 10, same: 6, p: 0.815 },
			mu: { higher: 21, lower: 3, same: 0, p: 0.00028 },
			strict: { higher: 19, lower: 5, same: 0, p: 0.007 },
			gini: { higher: 20, lower: 4, same: 0, p: 0.002 },
			oneSeller: { higher: 1, lower: 13, same: 10, p: 0.002 },
			flips: { higher: 14, lower: 10, same: 0, p: 0.541 }
		},
		vsMain: {
			short: { higher: 1, lower: 2, same: 21, p: 1 },
			fails: { higher: 7, lower: 8, same: 9, p: 1 },
			successors: { higher: 0, lower: 3, same: 21, p: 0.25 },
			taste: { higher: 3, lower: 5, same: 16, p: 0.727 },
			a: { higher: 1, lower: 6, same: 17, p: 0.125 },
			c: { higher: 14, lower: 6, same: 4, p: 0.115 },
			mu: { higher: 11, lower: 13, same: 0, p: 0.839 },
			strict: { higher: 14, lower: 10, same: 0, p: 0.541 },
			oneSeller: { higher: 6, lower: 2, same: 16, p: 0.289 },
			flips: { higher: 17, lower: 6, same: 1, p: 0.035 }
		}
	},
	// the cost on seed 20261020: person-days short of food in years 59–60. The greenhouse had been the only real food
	// seller since year 12, when the field COOP was scrapped idle; in year 59 a shock cut its plant by `shock`. The food
	// store covered the quantity, but the price rule raised the price 25 % a week, up to about `priceTimes` times within
	// two quarters, and the poorest could not pay. The price rule's step reads what is asked against capacity, not the
	// store. No single change does this alone (summary.md, "What still fails")
	foodCost: { seed: 20261020, short: 1_883, years: [59, 60], soleSince: 12, shock: 0.48, step: 0.25, priceTimes: 300 },
	// every fall the verdict still counts, traced (verdict.md): new main 2 on the 24 seeds. tenthYears in episodes;
	// experiences from a falling budget (the tenth got all it asked for, but asked for less as what it held fell against
	// its prices) and the failing tenth-seeds that fail mostly on them; of all falls from the budget, citywide ones (MIND
	// as a whole lost value against goods; in seedYears seed-years) and the poorest tenths' (their Law 5 dividends fell in
	// divFell of them, median divMedian); housing rationed after capacity shocks (the tenth asked for its satiation level
	// and got less; a shock held a housing seller back that year in `shock`); care; goods
	trace: {
		tenthYears: 1_962, episodes: 1_180,
		experiences: 1_070, experiencesTenths: 220, budget: 1_199, citywide: 793, seedYears: 49, poorest: 343, divFell: 304, divMedian: -0.66,
		housing: 517, housingTenths: 148, housingShock: 511, care: 249, goods: 62,
		// the traced case of the poorest: seed 20261018, years 25–30: the owner-only group held `from` of its MIND in one
		// experiences seller's in year 20, and `to` in year 29
		poorCase: { seed: 20261018, from: 0.68, to: 0.06 }
	},
	// the two other readings, not applied (verdict.md): tenth-seeds failing [base, new main, new main 2] if only a fall
	// in a year the tenth got less than it asked for counted (the literal first excuse), and if a capacity shock
	// counted as a hard limit
	readings: { literal: [454, 425, 289], shockLimit: [465, 394, 329] },
	// two findings (verdict.md): the cap excuse never applies in this model (a tenth's mean of an extra cannot exceed its
	// satiation level, so (b) with and without it fail the same tenths on every seed); land, the model's one physical
	// limit, bound in none of the counted falls (landBound of tenthYears), and at no year's end was all leasable land let
	// (the most, new main 2: landMax)
	finds: { capExcused: 0, landBound: 0, landMax: 0.957 },
	// the poorest tenth by holdings and by Aven output fails on every one of the 24 seeds under every rule set
	poorestFailsAll: true,
	// the largest yearly gap between MIND issued and MIND held, melted or burned, as a share of all MIND issued
	conservation: 1.2e-14
};

/** the upgrades of rounds 1 and 2 that were not kept, in words: what each is, what it did against that round's base
 *  (round 1: the base, law5all; round 2: the new main), and why it was not kept. Built from UPGRADES.notKept and
 *  UPGRADES2.notKept */
export function notKeptWords() {
	const u = UPGRADES.notKept;
	const v = UPGRADES2.notKept;
	const ch = (xs, f = (v) => fmt(v)) => `${f(xs[0])} → ${f(xs[1])}`;
	const share = (v) => pcs(v, 1);
	const mu = (v) => pcs(v, 2).replace('-', '−');
	const p = (v) => ` (${pWords(v)})`;
	const why = {
		worse: 'It made its own target worse',
		met: 'Its target was already met, and food COOP failures rose',
		luck: 'Its target was already met, and its gains had no mechanism',
		none: 'No clear gain',
		cost: 'Another check got worse',
		test: 'A test of the model, not a rule'
	};
	const rows = [
		['daily', `Daily steps for all ${SIM.years} years`, `on ${u.daily.broke} of ${u.daily.seeds} seeds, the only materials seller failed, nothing replaced it, and the city broke down`],
		['dailyShocks', 'Daily steps during every shock', `no clear change on ${u.dailyShocks.seeds} seeds`],
		['floorFull', 'A full price floor for large sellers', `person-days short ${ch(u.floorFull.short)}${p(u.floorFull.pShort)}; check 1 on ${ch(u.floorFull.check1)} seeds`],
		['fwdPrice', 'A price that reads the coming harvest', `person-days short ${ch(u.fwdPrice.short)}${p(u.fwdPrice.pShort)}`],
		['waterFloor', "A price floor for the City COOP's water", `food COOP failures ${ch(u.waterFloor.food)}${p(u.waterFloor.pFood)}`],
		['waterReserve', "A water part in the City COOP's reserve", `food COOP failures ${ch(u.waterReserve.food)}`],
		['rentCover', "Ground rent that covers the City COOP's upkeep", `food COOP failures ${ch(u.rentCover.food)}${p(u.rentCover.pFood)}; all COOP failures ${ch(u.rentCover.fails)}${p(u.rentCover.pFails)}`],
		['rentLaw5', 'Ground rent as a Law 5 sale', `cityMIND's return ${ch(u.rentLaw5.cityMu, mu)}${p(u.rentLaw5.pCity)}; dividends alone paid ${ch(u.rentLaw5.strict, share)} of owner-only person-days${p(u.rentLaw5.pStrict)}`],
		['holdFloor', "A holding floor in the basic sellers' MIND", `dividends alone paid ${ch(u.holdFloor.strict, share)} of owner-only person-days${p(u.holdFloor.pStrict)}; MIND retired a person a year ${ch(u.holdFloor.retired)}${p(u.holdFloor.pRetired)}`],
		['payLeast', 'Paying first with the MIND that earns least', `dividends alone paid ${ch(u.payLeast.strict, share)} of owner-only person-days${p(u.payLeast.pStrict)}; part 3 by the old yardstick on ${ch(u.payLeast.p3old)} seeds${p(u.payLeast.pP3)}`],
		['founding1', 'The founding week into food, water and energy only', `person-days short in the founding ${ch(u.founding1.founding)}; check 1 on ${ch(u.founding1.check1)} seeds: nobody held housing MIND`],
		['heirMind', "A successor carries on the failed COOP's MIND", `MIND retired a person a year ${ch(u.heirMind.retired)}; successors that failed ${ch(u.heirMind.successors)}`],
		['endToCity', "An ended COOP's other MINDs go to the City COOP", `food COOP failures ${ch(u.endToCity.food)}${p(u.endToCity.pFood)}; dividends alone paid ${ch(u.endToCity.strict, share)} of owner-only person-days${p(u.endToCity.pStrict)}`],
		['foundSignal', 'A founding signal on unmet need', `basics with one seller ${ch(u.foundSignal.oneSeller)}${p(u.foundSignal.pOne)}; all COOP failures ${ch(u.foundSignal.fails)}${p(u.foundSignal.pFails)}`],
		['avenOutput', 'Avens invest by delivered output', `food COOP failures ${ch(u.avenOutput.food)}; all three checks on ${ch(u.avenOutput.pass)} seeds${p(u.avenOutput.pPass)}`]
	];
	const rows2 = [
		['founding3', "The founding week only by the day's needs", `person-days short in the founding ${ch(v.founding3.foundingShort)}; from day 8 ${ch(v.founding3.short)}; all COOP failures ${ch(v.founding3.fails)}`],
		['reletUsed', 'A successor leases only the part of the plant in use', `all COOP failures ${ch(v.reletUsed.fails)}; but on seed ${v.reletUsed.seed}, its target, person-days short ${ch(v.reletUsed.seedShort)}; with ground rent that rises only while land is short, it changed nothing`]
	];
	return [
		...rows.map(([id, name, did]) => ({ id, round: UPGRADES.round, name, did, why: why[u[id].why] })),
		...rows2.map(([id, name, did]) => ({ id, round: UPGRADES2.round, name, did, why: why[v[id].why] }))
	];
}

/** the economic model's versions, in order (Section 11.2). Every version ran SIM.people people for SIM.years years.
 *  checks: [no one starves, no one has to work (the normal test), living standards rise (by the old yardstick)] on the
 *  main seed, 1 holds and 0 fails (null: not checked per person); strict: the strict test on the main seed, 1 holds and
 *  0 fails (left out: not reported); short: person-days short from day 8 on the main seed; unit: what the run counted
 *  in; mu: the lasting return on holdings in the last ten years, in that unit (muHearts: the same in HEARTS); law5Pools:
 *  whether Law 5 paid the city's pools too; seeds: the 8-seed check where one was run (its p3 holds part 3 under the
 *  verdict where the version was judged by it; null: not judged); main: this paper's main run.
 *  sources: model.js at #520/#522 (the static world), #524 (60a32b8), #598 (43d854e; its commit gives the #524 world's
 *  mu in HEARTS, 7.50 %, rerun with poolShare 0.05) and #599 (737c9b3; research/e2e/pool-10, reproduced exactly by
 *  law5-all seeds-law5-old). 'law5all' is LAW5ALL (research/e2e/law5-all, merged in fed68db from ab8ed86); 'upgrades1'
 *  is UPGRADES (research/e2e/round-next, 91057fb); 'upgrades2' is this paper's main run, new main 2 (research/e2e/
 *  round-next-2, 79f83e8): the constants above */
export const MODEL_VERSIONS = [
	{ id: 'static', pr: [520, 522], date: '2026-10-12', unit: 'R', poolShare: OLD_POOL_SHARE, checks: null, capped: true },
	{ id: 'dynamic', pr: [524], date: '2026-10-12', unit: 'R', poolShare: OLD_POOL_SHARE, checks: [1, 1, 1], short: 0, genesisShort: 621, mu: 0.0586, muHearts: 0.075, seeds: null },
	{ id: 'hearts', pr: [598], date: '2026-10-13', unit: 'HEARTS', poolShare: POOL_SHARE, checks: [0, 0, 0], short: SEEDS.noFix.main.short, foodFailures: SEEDS.noFix.main.food, mu: SEEDS.noFix.main.mu, muHearts: SEEDS.noFix.main.mu, seeds: SEEDS.noFix },
	{ id: 'idle', pr: [599], date: '2026-10-13', unit: 'HEARTS', poolShare: POOL_SHARE, law5Pools: false, checks: [0, 0, 0], strict: 0, short: 1_750, foodFailures: 2, mu: 0.084, muHearts: 0.084, seeds: SEEDS.law5old },
	{ id: 'law5all', pr: [], date: '2026-10-14', unit: 'HEARTS', poolShare: POOL_SHARE, law5Pools: true, checks: LAW5ALL.checks, strict: LAW5ALL.strictShare >= 1 ? 1 : 0, short: LAW5ALL.short, foodFailures: LAW5ALL.foodFailures, mu: LAW5ALL.mu, muHearts: LAW5ALL.mu, seeds: SEEDS.law5all, running: false, main: false },
	{ id: 'upgrades1', pr: [], date: '2026-10-14', unit: 'HEARTS', poolShare: POOL_SHARE, law5Pools: true, checks: UPGRADES.mainSeed.checks, strict: UPGRADES.mainSeed.strictShare >= 1 ? 1 : 0, short: UPGRADES.mainSeed.short, foodFailures: UPGRADES.mainSeed.failures, mu: UPGRADES.mainSeed.mu, muHearts: UPGRADES.mainSeed.mu, seeds: UPGRADES.seeds, running: false, main: false },
	{ id: 'upgrades2', pr: [], date: '2026-10-14', unit: 'HEARTS', poolShare: POOL_SHARE, law5Pools: SIM.law5Pools, checks: LADDER.find((v) => v.id === 'main').checks, strict: PROOF.strict.shareAfter10 >= 1 ? 1 : 0, short: PROOF.short, foodFailures: FAILURE.food, mu: DYN.mu, muHearts: DYN.mu, seeds: SEEDS.new, running: false, main: true }
];
/** this paper's main run among the versions */
export const mainVersion = () => MODEL_VERSIONS.find((v) => v.main);

/** a hypothesis's status from how many runs held, of how many: all → 'supported', none → 'failing', some → 'mixed',
 *  no run → 'open'. 'proven' is kept for mathematics */
export const statusFrom = (held, of) => (!of ? 'open' : held === of ? 'supported' : held === 0 ? 'failing' : 'mixed');

/** the same from a list of tests, each true (held), false (failed) or null (no simulation measures it yet): only the
 *  tests with a result count, so a hypothesis with no evidence at all comes out 'open' */
export const statusOf = (tests) => {
	const run = tests.filter((t) => t != null);
	return statusFrom(run.filter(Boolean).length, run.length);
};

/** the band around full cost within which Section 10's H6 calls a price "near cost" (audit B13: within 10 %) */
export const COST_BAND = 0.1;

const mainChecks = LADDER.find((v) => v.id === 'main').checks;
const infraBelow = INFRA_MINDS.filter((k) => MIND_RETURNS.byMind[k].mean < RATE);
const infraWon = INFRA_MINDS.filter((k) => MIND_RETURNS.byMind[k].share60 === 1);
// H6: the economic model records no price against full cost, so that half of H6 has no result yet (null)
const nearCost = null;
// H11 and H15: the upgrades of round 1 that tested them, each run on UPGRADES.same.n seeds. H11 (spread ownership pays
// the basics): the seeds on which dividends alone paid every owner-only person-day from day 8 (the strict test), under
// the holding floor and under paying first with the MIND that earns least (holdFloor.md and payLeast.md: 0 under each).
// H15 (ground rent as a Law 5 sale lifts cityMIND and the owner-only people): its two targets, each held when the rise
// was clear (p below SAME_SHOCK.alpha)
const spreadTests = [{ id: 'holdFloor', strictSeeds: 0 }, { id: 'payLeast', strictSeeds: 0 }];
const rentTargets = [UPGRADES.notKept.rentLaw5].flatMap((r) => [
	r.cityMu[1] > r.cityMu[0] && r.pCity < SAME_SHOCK.alpha,
	r.strict[1] > r.strict[0] && r.pStrict < SAME_SHOCK.alpha
]);

/** the hypotheses of Section 10 and their status, derived from the numbers where they can be, so that new numbers
 *  update them. The evidence is the economic model's: each part of Proposition 3 counts the 8-seed check of its main
 *  run (SEEDS.new); `model` is [held, of]. Part 3 and "all three" are judged by YARDSTICK, and part 2 by the normal
 *  test. A hypothesis that no simulation tests yet comes out 'open' through statusOf, with `untested` saying why. The
 *  words of each hypothesis are in the paper (Section 10) */
export const HYPOTHESES = {
	H1: { status: 'proven' }, // Proposition 1, Section 5.3
	H2: { status: 'proven' }, // Proposition 2, Section 9.2 (its condition is H4)
	H3: {
		yardstick: YARDSTICK,
		model: [allThreeHeld(SEEDS.new), SEEDS.n],
		main: mainChecks,
		status: statusFrom(allThreeHeld(SEEDS.new), SEEDS.n),
		parts: [
			{ model: [SEEDS.new.check1, SEEDS.n] },
			{ model: [SEEDS.new.check2, SEEDS.n] },
			{ model: [p3Held(SEEDS.new), SEEDS.n] }
		].map((p) => ({ ...p, status: statusFrom(p.model[0], p.model[1]) })),
		// the strict test, not claimed: dividends alone, on every owner-only person-day after year 10 of the main run
		strict: { model: [PROOF.strict.shareAfter10 >= 1 ? 1 : 0, 1] }
	},
	// μ below the melt: the 8-seed check and the 24 same-shock seeds
	H4: { model: [SEEDS.new.below, SEEDS.n], same: [SAME_SHOCK.new.below, SAME_SHOCK.n], status: statusFrom(SEEDS.new.below + SAME_SHOCK.new.below, SEEDS.n + SAME_SHOCK.n) },
	// long-lived projects get built (they made all of their good by the last year) and their rise is shared (their
	// MINDs returned less than the melt)
	H5: { won: infraWon, below: infraBelow, of: INFRA_MINDS.length, status: infraWon.length && infraBelow.length === INFRA_MINDS.length ? 'supported' : infraWon.length || infraBelow.length ? 'mixed' : 'failing' },
	// rivals keep basics near cost: prices within COST_BAND of full cost (no result: nearCost is null) and no basic but
	// water with one seller in the model's last year
	H6: { nearCost, sole: soleMakers(), status: statusOf([nearCost, !soleMakers().length]) },
	// only physics limits abundance: the economic model does not record what binds a basic, so nothing tests it yet
	H7: { status: statusOf([]), untested: 'binding' },
	// energy binds growth: the model assumes productivity growth and has no energy limit
	H8: { status: statusOf([]), untested: 'energy' },
	// the euro border balances: exports repay the euros the city needed. The economic model is a closed city (A1)
	H9: { status: statusOf([]), untested: 'border' },
	// the founding leaves no one short: the model's main run, whose founding week invests in the sellers of the four
	// basics (SIM.switches.founding), with no person-day short in its founding
	H10: {
		model: PROOF.genesis.short === 0,
		status: statusOf([PROOF.genesis.short === 0])
	},
	// spread ownership (C4) pays the basics: the strict test under the economic model's two Aven defaults of round 1
	H11: {
		tests: spreadTests.map((t) => t.id),
		held: [spreadTests.reduce((s, t) => s + t.strictSeeds, 0), spreadTests.length * UPGRADES.same.n],
		status: statusFrom(spreadTests.reduce((s, t) => s + t.strictSeeds, 0), spreadTests.length * UPGRADES.same.n)
	},
	// treasuries pay out, so people own most MIND: people's share of all MIND by value in the model's last ten years
	H12: { people: DYN.people, status: statusOf([DYN.people > 0.5]) },
	// the melt keeps money moving: the model assumes how much people spend
	H13: { status: statusOf([]), untested: 'spending' },
	// selection by where Avens invest improves governance
	H14: { status: statusOf([]), untested: 'governance' },
	// ground rent as a Law 5 sale lifts cityMIND and the owner-only people (ACCEPTED.groundRent): the economic model's
	// run with rent as a sale (UPGRADES.notKept.rentLaw5), its two targets
	H15: { held: [rentTargets.filter(Boolean).length, rentTargets.length], status: statusFrom(rentTargets.filter(Boolean).length, rentTargets.length) },
	// either estate rule keeps the Gini bounded (ACCEPTED.estates): no rule is chosen or simulated yet
	H16: { status: statusOf([]), untested: 'estates' }
};
