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

/** Laborie's RTM rate from life expectancy: c = ln(ev/2) / (ev/2) */
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
	].map((s) => ({ ...s, points: range(2, 12, 10).map((n) => [n, basketLvr(n, s.sigma, s.rho) * 100]) }));

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

export const fmt = (n, d = 0) => n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
