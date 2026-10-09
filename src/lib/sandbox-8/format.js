// @ts-nocheck — plain JS helpers
// How Sandbox 7 writes a price or an amount (Samuel, 2026-10-09: prices are free, from fractions of a HEART to tens of
// thousands): about two significant digits, thousands as k and millions as M, so a column stays narrow at any level;
// and the scale charts use for prices, logarithmic, so ×2 looks the same at 1 and at 10,000.

/** a number, short: 0.42, 3.8, 15, 120, 1.2k, 48k, 3.1M */
export function short(v) {
	if (v == null || !Number.isFinite(Number(v))) return '—';
	const n = Number(v);
	const a = Math.abs(n);
	const sig = (x, d) => Number(x.toPrecision(d)).toString();
	if (a >= 1e6) return `${sig(n / 1e6, a >= 1e7 ? 3 : 2)}M`;
	if (a >= 1e3) return `${sig(n / 1e3, a >= 1e4 ? 3 : 2)}k`;
	if (a >= 100) return String(Math.round(n));
	if (a >= 10) return sig(n, 3);
	if (a === 0) return '0';
	return sig(n, 2);
}
/** one value against another as a factor: ×2.3, ×0.4, ×1 */
export const times = (v, of) => (v == null || !of ? '' : `×${short(v / of)}`);

/** a log scale over positive values: its bottom and top (whole steps of 1, 2 and 5 per decade) and the ticks between */
export function logScale(values) {
	const pos = values.filter((v) => v != null && v > 0);
	if (!pos.length) return { lo: 0.1, hi: 100, ticks: [0.1, 1, 10, 100] };
	const steps = [1, 2, 5];
	const down = (v) => {
		const d = 10 ** Math.floor(Math.log10(v));
		return [...steps].reverse().map((s) => s * d).find((x) => x <= v) ?? d;
	};
	const up = (v) => {
		const d = 10 ** Math.floor(Math.log10(v));
		return [...steps, 10].map((s) => s * d).find((x) => x >= v) ?? 10 * d;
	};
	let lo = down(Math.min(...pos));
	let hi = up(Math.max(...pos));
	if (hi / lo < 10) (lo = down(lo / 2)), (hi = up(hi * 2));
	const decades = Math.log10(hi / lo);
	const ticks = [];
	for (let d = Math.floor(Math.log10(lo)); d <= Math.ceil(Math.log10(hi)); d++)
		for (const s of decades > 3 ? [1] : decades > 1.5 ? [1, 3] : steps) {
			const t = s * 10 ** d;
			if (t >= lo * 0.999 && t <= hi * 1.001) ticks.push(Number(t.toPrecision(3)));
		}
	return { lo, hi, ticks };
}
/** where a value sits on a log scale, 0 to 1 */
export const logAt = (v, lo, hi) => (v == null || v <= 0 ? 0 : Math.max(0, Math.min(1, Math.log(v / lo) / Math.log(hi / lo))));
