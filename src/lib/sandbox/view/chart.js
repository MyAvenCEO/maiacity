// @ts-nocheck — plain JS, part of the view engine (./engine.js)
/*
 * OUR CHARTS — what `<maia-chart>` draws (./components.js): bars, lines, areas and stacked areas in our palette, as SVG
 * made element by element (every label set as text). Data only: a view hands it numbers, never markup.
 *
 *   kind="bars"   items=[{ label, value, color? }]                     one bar a row, its value at its end
 *   kind="line"   series=[{ name, values: [..], color? }] labels=[..]  a line a series, the labels along the bottom
 *   kind="area"   the same, each series filled to the axis
 *   kind="stack"  the same, the series stacked on each other
 */

/** our palette, in the order series take it */
export const PALETTE = ['#2f6f5e', '#efb54d', '#c8744f', '#7b5ea7', '#a8b88a', '#4f7fb8', '#24452f', '#d2453b'];
const SVG = 'http://www.w3.org/2000/svg';
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString('en', { maximumFractionDigits: 1 })}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toLocaleString('en', { maximumFractionDigits: 1 })}k` : v.toLocaleString('en', { maximumFractionDigits: 2 }));
/** a colour a view may give: a hex colour, nothing else */
const colour = (c, i) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : PALETTE[i % PALETTE.length]);

/** round steps for an axis from 0 to `max` */
function ticks(max, n = 4) {
	if (!(max > 0)) return [0, 1];
	const raw = max / n;
	const p = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
	const out = [];
	for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e9) / 1e9);
	if (out.at(-1) < max) out.push(out.at(-1) + step);
	return out;
}

/**
 * A chart as an SVG element of `doc`.
 * @param {Document} doc
 * @param {{ kind?: string, items?: any[], series?: any[], labels?: any[], unit?: string, height?: number }} o
 */
export function chart(doc, o) {
	const el = (tag, attrs = {}, text) => {
		const e = doc.createElementNS(SVG, tag);
		for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
		if (text != null) e.textContent = String(text);
		return e;
	};
	const kind = ['bars', 'line', 'area', 'stack'].includes(o.kind) ? o.kind : 'bars';
	const unit = o.unit ? ` ${String(o.unit).slice(0, 12)}` : '';
	if (kind === 'bars') {
		const items = (Array.isArray(o.items) ? o.items : []).slice(0, 40);
		const W = 600, row = 26, H = Math.max(row, items.length * row);
		const max = Math.max(1e-9, ...items.map((i) => num(i?.value)));
		const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', class: 'chart bars' });
		items.forEach((it, i) => {
			const y = i * row;
			const w = Math.max(0, (num(it?.value) / max) * (W - 220));
			svg.append(el('text', { x: 0, y: y + 17, class: 'label' }, String(it?.label ?? '').slice(0, 24)));
			svg.append(el('rect', { x: 140, y: y + 5, width: W - 220, height: 14, rx: 7, class: 'track' }));
			svg.append(el('rect', { x: 140, y: y + 5, width: w, height: 14, rx: 7, fill: colour(it?.color, 0) }));
			svg.append(el('text', { x: W, y: y + 17, 'text-anchor': 'end', class: 'value' }, fmt(num(it?.value)) + unit));
		});
		return svg;
	}
	const series = (Array.isArray(o.series) ? o.series : []).slice(0, 8).map((s, i) => ({ name: String(s?.name ?? '').slice(0, 30), color: colour(s?.color, i), values: (Array.isArray(s?.values) ? s.values : []).slice(0, 500).map(num) }));
	const n = Math.max(1, ...series.map((s) => s.values.length));
	const labels = (Array.isArray(o.labels) ? o.labels : []).slice(0, n).map((l) => String(l ?? '').slice(0, 12));
	const W = 600, H = Math.min(600, Math.max(160, num(o.height) || 240));
	const M = { t: 12, r: 12, b: 26, l: 46 };
	const tops = series.map(() => new Array(n).fill(0));
	const bottoms = series.map(() => new Array(n).fill(0));
	for (let k = 0; k < n; k++) {
		let acc = 0;
		series.forEach((s, i) => {
			const v = s.values[k] ?? 0;
			bottoms[i][k] = kind === 'stack' ? acc : 0;
			acc = kind === 'stack' ? acc + v : v;
			tops[i][k] = kind === 'stack' ? acc : v;
		});
	}
	const max = Math.max(1e-9, ...tops.flat());
	const steps = ticks(max);
	const top = steps.at(-1);
	const x = (k) => M.l + (n === 1 ? (W - M.l - M.r) / 2 : (k / (n - 1)) * (W - M.l - M.r));
	const y = (v) => H - M.b - (v / top) * (H - M.t - M.b);
	const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', class: `chart ${kind}` });
	for (const t of steps) {
		svg.append(el('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), class: 'grid' }));
		svg.append(el('text', { x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis' }, fmt(t)));
	}
	const every = Math.max(1, Math.ceil(n / 12));
	labels.forEach((l, k) => k % every === 0 && svg.append(el('text', { x: x(k), y: H - 8, 'text-anchor': 'middle', class: 'axis' }, l)));
	const path = (pts) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
	series.forEach((s, i) => {
		const line = tops[i].map((v, k) => [x(k), y(v)]);
		if (kind !== 'line') {
			const base = bottoms[i].map((v, k) => [x(k), y(v)]).reverse();
			svg.append(el('path', { d: path([...line, ...base]) + 'Z', fill: s.color, 'fill-opacity': kind === 'stack' ? 0.8 : 0.25 }));
		}
		svg.append(el('path', { d: path(line), fill: 'none', stroke: s.color, 'stroke-width': 2 }));
		svg.append(el('title', {}, s.name));
	});
	return svg;
}
