// @ts-nocheck — plain JS, kept loose on purpose
// The numbers behind the theOS paper: every figure and every number quoted in its text is computed here, so the
// prose and the charts can never drift apart.

/** the Universal Intent Allocation: HEARTS minted for every human, a day */
export const UIA_DAY = 24;
/** the hardcoded demurrage rate, a year */
export const RATE = 0.07;
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

/** Figure 2: 100 HEARTS left idle, under three rates */
export const idleSeries = (rates = [0.03, RATE, 0.1], years = 40) =>
	rates.map((r) => ({ r, points: range(0, years, 160).map((t) => [t, decay(100, r, t)]) }));

/** Figure 3: money per person (HEARTS and MINDs) from three starts under the same UIA and demurrage */
export const convergenceSeries = (r = RATE, years = 60) => {
	const star = steadyState(r);
	return [
		{ id: 'rich', label: 'Starts with 1,000,000 per person', b0: 1_000_000 },
		{ id: 'mid', label: 'Starts at 125,000 per person', b0: 125_000 },
		{ id: 'newborn', label: 'A new city, starts with 0', b0: 0 }
	].map((s) => ({ ...s, points: range(0, years, 240).map((t) => [t, balanceAt(s.b0, t, r)]), star }));
};

/** Figure 5: what 1,000 HEARTS of purchasing power is worth after t years, parked or built into infrastructure */
export const infraSeries = (years = 50) =>
	[
		{ id: 'idle', label: 'Idle HEARTS (−7 %)', r: RATE },
		{ id: 'loss', label: 'Project at −1 % real', r: 0.01 },
		{ id: 'flat', label: 'Project at 0 % real', r: 0 }
	].map((s) => ({ ...s, points: range(0, years, 200).map((t) => [t, decay(1000, s.r, t)]) }));

/** Figure 5: a basket's yearly LVR against how many MINDs it holds, for three kinds of MIND */
export const lvrSeries = () =>
	[
		{ id: 'calm', label: 'σ 20 %, independent', sigma: 0.2, rho: 0 },
		{ id: 'wild', label: 'σ 40 %, independent', sigma: 0.4, rho: 0 },
		{ id: 'linked', label: 'σ 40 %, correlated 0.6', sigma: 0.4, rho: 0.6 }
	].map((s) => ({ ...s, points: range(2, 8, 6).map((n) => [n, basketLvr(n, s.sigma, s.rho) * 100]) }));

/**
 * Figure 8: three cooperatives in one sector, replicator dynamics. Each COOP turns a HEART into f units of utility;
 * avens route a share k of the gap to the mean every month. Bureaucracy (B) loses efficiency while it argues, capture
 * (A) slowly turns extractive, C keeps improving. Shares of the sector's flow over ten years.
 */
export function selectionSeries(years = 10, k = 0.25) {
	const fit = {
		A: (t) => 1.0 - 0.06 * t, // capital-weighted: drifts towards extraction
		B: (t) => 0.95 - 0.02 * t, // demarchy: steady but slow
		C: (t) => 0.9 + 0.05 * t // QV + AI executive: learns
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

// ── Fair ownership (Section 9.2) ─────────────────────────────────────────────────────────────────────────────────────

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

const gini = (w) => {
	const v = [...w].sort((a, b) => a - b), n = v.length;
	let s = 0, tot = 0;
	for (let i = 0; i < n; i++) (s += (2 * (i + 1) - n - 1) * v[i]), (tot += v[i]);
	return s / (n * tot);
};

/** Figure 12: ownership inequality over 100 years, from Germany's spread today, under theOS with three spreads of returns */
export function giniSeries(years = 100, n = 1500, dt = 0.5) {
	const r = RATE, a = (UIA_DAY * 365) / 2, rest = a / r;
	const out = [{ id: 'cap', label: 'capitalism today', dash: '5 4', points: [[0, GINI_DE], [years, GINI_DE]] }];
	out.push({ id: 's0', label: 'theOS, same returns', points: Array.from({ length: years / 2 + 1 }, (_, i) => [i * 2, giniAt(GINI_DE, i * 2)]) });
	// a lognormal start with Gini 0.72 (σ_ln = √2·Φ⁻¹(0.86)), scaled to the resting level
	const sl = Math.SQRT2 * 1.0803;
	for (const [sigma, seed] of [[0.1, 7], [0.2, 11]]) {
		const z = rng(seed);
		let w = Array.from({ length: n }, () => Math.exp(sl * z()));
		const m = w.reduce((s, x) => s + x, 0) / n;
		w = w.map((x) => (x / m) * rest);
		const pts = [[0, gini(w)]];
		const k = Math.exp(-0.5 * sigma * sigma * dt - r * dt), q = sigma * Math.sqrt(dt);
		for (let step = 1; step <= years / dt; step++) {
			for (let i = 0; i < n; i++) w[i] = w[i] * k * Math.exp(q * z()) + a * dt;
			if ((step * dt) % 2 === 0) pts.push([step * dt, gini(w)]);
		}
		out.push({ id: `s${sigma}`, label: `theOS, spread ${Math.round(sigma * 100)} %`, points: pts });
	}
	return out;
}

/** Figure 13: the resting Gini against the spread of people's returns, for three demurrage rates */
export const dialSeries = (rates = [0.03, RATE, 0.1]) =>
	rates.map((r) => ({
		id: `d${r}`,
		label: `${Math.round(r * 100)} % a year`,
		points: Array.from({ length: 46 }, (_, i) => {
			const s = 0.05 + i * 0.01;
			return [s, giniRest(s, r)];
		})
	}));

export const fmt = (n, d = 0) => n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
