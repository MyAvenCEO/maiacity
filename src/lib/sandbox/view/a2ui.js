// @ts-nocheck — plain JS
/*
 * THE A2UI LENS — a declarative view as the agents wrote it until now (game/code/views.js, kind `a2ui`: a flat list
 * of catalog components bound to a data model, with logic in QuickJS) read as a view of the one kind: HTML with our
 * components and template marks (./template.js), the same data and the same logic. Every string an agent wrote goes
 * in as escaped text or an attribute's text; a binding {$data: 'a.b'} becomes {{a.b}}.
 */

const ESCAPED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPED[c]);
const PATH = /^[\w$]+(\.[\w$]+)*$/;

/** a prop as template text: a binding as {{path}}, anything else as its escaped text (lists and objects as JSON) */
const val = (v) => {
	if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.$data === 'string') return PATH.test(v.$data) ? `{{${v.$data}}}` : '';
	if (v == null) return '';
	// braces an agent wrote are text, not marks
	const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
	return esc(text).replace(/\{\{/g, '{&#8203;{');
};
const attr = (name, v) => (v == null || v === '' ? '' : ` ${name}="${val(v)}"`);
const TONES = ['accent', 'good', 'warn', 'bad', 'muted'];
const tone = (t) => (typeof t === 'string' && TONES.includes(t) ? t : '');
const gap = (g) => (['s', 'm', 'l'].includes(g) ? ` gap-${g}` : '');
const align = (a) => (['start', 'center', 'end'].includes(a) ? ` align-${a}` : '');

/**
 * An a2ui spec as a view: `{ html, data, logic? }`.
 * @param {{ root?: string, components: any[], data?: object, logic?: string }} spec
 */
export function fromA2ui(spec) {
	const byId = Object.fromEntries((spec?.components ?? []).map((c) => [c.id, c]));
	const kids = (c, depth) => (c.children ?? []).map((k) => node(k, depth + 1)).join('');
	function node(id, depth) {
		const c = byId[id];
		if (!c || depth > 24) return '';
		switch (c.type) {
			case 'Column':
				return `<div class="col${gap(c.gap)}${align(c.align)}">${kids(c, depth)}</div>`;
			case 'Row':
				return `<div class="row${c.wrap ? ' wrap' : ''}${gap(c.gap)}${align(c.align)}">${kids(c, depth)}</div>`;
			case 'Grid': {
				const cols = Math.min(6, Math.max(1, Math.round(Number(c.columns) || 2)));
				return `<div class="grid${gap(c.gap)}" style="--cols:${cols}">${kids(c, depth)}</div>`;
			}
			case 'Card':
				return `<maia-card${attr('title', c.title)}${attr('subtitle', c.subtitle)}${attr('tone', tone(c.tone))}>${kids(c, depth)}</maia-card>`;
			case 'Heading':
				return Number(c.level) > 2 ? `<h4>${val(c.text)}</h4>` : `<h2>${val(c.text)}</h2>`;
			case 'Text': {
				const cls = [tone(c.tone), c.size === 's' ? 'small' : c.size === 'l' ? 'large' : ''].filter(Boolean).join(' ');
				return `<p${cls ? ` class="${cls}"` : ''}>${val(c.text)}</p>`;
			}
			case 'Metric':
				return `<maia-metric${attr('label', c.label)}${attr('value', c.value)}${attr('unit', c.unit)}${attr('delta', c.delta)}${attr('tone', c.tone)}></maia-metric>`;
			case 'Badge':
				return `<maia-badge${attr('text', c.text)}${attr('tone', c.tone)}></maia-badge>`;
			case 'Progress':
				return `<maia-progress${attr('label', c.label)}${attr('value', c.value)}${attr('max', c.max)}${attr('tone', c.tone)}></maia-progress>`;
			case 'Bars':
				return `<maia-chart kind="bars"${attr('label', c.label)}${attr('items', c.items)}${attr('unit', c.unit)}></maia-chart>`;
			case 'Table':
				return `<maia-table${attr('columns', c.columns)}${attr('rows', c.rows)}></maia-table>`;
			case 'List':
				return `<maia-list${attr('items', c.items)}></maia-list>`;
			case 'Button': {
				const event = esc(String(c.event ?? '').slice(0, 40));
				const value = c.value === undefined ? '' : ` data-value="${esc(JSON.stringify(c.value))}" data-on="*"`;
				return `<button type="button" data-event="${event}"${value}${tone(c.tone) ? ` class="${tone(c.tone)}"` : ''}>${val(c.label)}</button>`;
			}
			case 'Slider': {
				const event = esc(String(c.event ?? '').slice(0, 40));
				const unit = c.unit != null ? ` ${val(c.unit)}` : '';
				return `<label><span class="label">${val(c.label)} <b>${val(c.value)}${unit}</b></span><input type="range" data-event="${event}"${attr('min', c.min ?? 0)}${attr('max', c.max ?? 100)}${attr('step', c.step ?? 1)}${attr('value', c.value)}></label>`;
			}
			case 'Divider':
				return '<hr>';
			default:
				return '';
		}
	}
	const root = spec?.root && byId[spec.root] ? spec.root : spec?.components?.[0]?.id;
	return { html: node(root, 0), data: spec?.data ?? {}, ...(spec?.logic?.trim() ? { logic: spec.logic } : {}) };
}
