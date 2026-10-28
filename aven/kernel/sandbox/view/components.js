// @ts-nocheck — plain JS, part of the view engine (./engine.js)
/*
 * OUR COMPONENTS — tags a view may write as plain HTML, drawn by our engine from their attributes alone: every value
 * set as text, colours only by tone name, lists and series as JSON. Each draws into its own shadow root, so a view's
 * draw script, which owns the page's DOM (./worker.js), can set their attributes but never what they draw.
 *
 *   <maia-card title subtitle tone>…</maia-card>          a card; what it holds stays the view's
 *   <maia-metric label value unit delta tone>             one number, large
 *   <maia-badge tone text>                                a word in a pill (or its own words)
 *   <maia-progress label value max tone>                  a bar filled to value of max (of 100: a percentage)
 *   <maia-chart kind label items series labels unit height>  ./chart.js
 *   <maia-table columns rows>                             a table of plain values
 *   <maia-list items>                                     a list of plain values
 */
import { chart } from './chart.js';
import { PARTS } from './theme.js';
import { textOf } from './template.js';

const TONES = ['accent', 'good', 'warn', 'bad', 'muted'];
const tone = (t) => (TONES.includes(t) ? t : 'default');
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
const json = (v) => {
	if (v == null || v === '') return null;
	try {
		return JSON.parse(v);
	} catch {
		return null;
	}
};

/** the components, each drawing from its attributes */
const DRAW = {
	'maia-card'(h, a) {
		const card = h('section', { class: `card ${tone(a.tone)}` });
		if (a.title) card.append(h('h3', {}, a.title));
		if (a.subtitle) card.append(h('p', { class: 'sub' }, a.subtitle));
		card.append(h('slot'));
		return card;
	},
	'maia-metric'(h, a) {
		const box = h('div', { class: `metric ${tone(a.tone)}` }, h('span', { class: 'label' }, a.label ?? ''));
		const v = h('b', {}, textOf(a.value != null && a.value !== '' && Number.isFinite(Number(a.value)) ? Number(a.value) : a.value));
		if (a.unit) v.append(h('small', {}, a.unit));
		box.append(v);
		if (a.delta) box.append(h('span', { class: 'delta' }, a.delta));
		return box;
	},
	'maia-badge'(h, a) {
		return h('span', { class: `badge ${tone(a.tone)}` }, a.text ?? h('slot'));
	},
	'maia-progress'(h, a) {
		const max = num(a.max, 100), v = num(a.value);
		const box = h('div', { class: `progress ${tone(a.tone)}` });
		box.append(h('span', { class: 'label' }, `${a.label ?? ''} `, h('b', {}, `${textOf(v)}${max === 100 ? ' %' : ` / ${textOf(max)}`}`)));
		const bar = h('i');
		bar.style.width = `${Math.min(100, Math.max(0, (v / Math.max(1e-9, max)) * 100))}%`;
		box.append(h('span', { class: 'track' }, bar));
		return box;
	},
	'maia-chart'(h, a, doc) {
		const box = h('div', { class: 'box' });
		if (a.label) box.append(h('span', { class: 'label' }, a.label));
		box.append(chart(doc, { kind: a.kind, items: json(a.items), series: json(a.series), labels: json(a.labels), unit: a.unit, height: num(a.height) }));
		return box;
	},
	'maia-table'(h, a) {
		const cols = (json(a.columns) ?? []).slice(0, 12);
		const rows = (json(a.rows) ?? []).slice(0, 500);
		const head = h('tr', {}, ...cols.map((c) => h('th', {}, textOf(c))));
		const body = rows.map((r) => h('tr', {}, ...(Array.isArray(r) ? r : Object.values(r ?? {})).slice(0, 12).map((v) => h('td', {}, textOf(v)))));
		return h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
	},
	'maia-list'(h, a) {
		return h('ul', {}, ...(json(a.items) ?? []).slice(0, 200).map((it) => h('li', {}, textOf(it))));
	}
};

/** the attributes each one reads */
const OBSERVED = ['title', 'subtitle', 'tone', 'label', 'value', 'unit', 'delta', 'text', 'max', 'kind', 'items', 'series', 'labels', 'height', 'columns', 'rows'];

/** our components, defined in window `win` (the frame's) */
export function defineComponents(win) {
	const doc = win.document;
	const sheet = new win.CSSStyleSheet();
	sheet.replaceSync(PARTS);
	for (const [name, draw] of Object.entries(DRAW)) {
		if (win.customElements.get(name)) continue;
		win.customElements.define(
			name,
			class extends win.HTMLElement {
				static observedAttributes = OBSERVED;
				#root = null;
				#queued = false;
				connectedCallback() {
					this.#draw();
				}
				attributeChangedCallback() {
					if (this.#queued || !this.isConnected) return;
					this.#queued = true;
					queueMicrotask(() => ((this.#queued = false), this.#draw()));
				}
				#draw() {
					this.#root ??= this.attachShadow({ mode: 'closed' });
					this.#root.adoptedStyleSheets = [sheet];
					const a = Object.fromEntries(OBSERVED.map((k) => [k, this.getAttribute(k) ?? undefined]));
					// every value as text: an element made here, its words set with textContent
					const h = (tag, attrs = {}, ...kids) => {
						const e = doc.createElement(tag);
						for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
						for (const k of kids) e.append(typeof k === 'string' ? doc.createTextNode(k) : k);
						return e;
					};
					this.#root.replaceChildren(draw(h, a, doc));
				}
			}
		);
	}
}
