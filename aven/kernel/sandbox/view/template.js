// @ts-nocheck — plain JS, part of the view engine (./engine.js)
/*
 * A VIEW'S TEMPLATE — how a view without a draw script shows its state: plain HTML (already sanitized, ./sanitize.js)
 * with a few marks our engine fills in from the state the page hands it (the view's data, or what its logic made of
 * it). Every value goes in as text or as an attribute's text, never as markup, and an attribute's text filled from the
 * state passes the sanitizer's rules for that attribute again (./sanitize.js `cleanAttr`).
 *
 *   {{a.b}}                       the value at a.b (numbers as the page shows them: 1,234.5)
 *   attr="{{a.b}}"                an attribute's value; alone in it, a list or an object goes in as JSON (for our
 *                                 components: <maia-chart items="{{beds}}">)
 *   <template each="list" as="x"> once for each item of `list`, `x` and `index` inside it
 *   <template if="a.b">           only where a.b is true (`if="!a.b"`: where it is not)
 *   data-event="name"             a click (or a control's new value) is the event `name` the page is told of, its value
 *                                 the control's (a number for a range) or data-value's JSON
 *   data-on="a.b"                 the element gets the class `on` where a.b equals its data-value (`*`: any value at
 *                                 the top of the state)
 */

import { cleanAttr } from './sanitize.js';

const MARK = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** the value at `path` in `state` (and the names a loop gave) */
export function valueAt(scope, path) {
	const p = String(path ?? '').trim();
	if (!p) return undefined;
	if (/^-?\d+(\.\d+)?$/.test(p)) return Number(p);
	return p.split('.').reduce((o, k) => (o == null ? undefined : Object.hasOwn(Object(o), k) ? o[k] : undefined), scope);
}

/** a value as text */
export const textOf = (v) => (v == null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? v.toLocaleString('en', { maximumFractionDigits: 2 }) : '') : typeof v === 'object' ? JSON.stringify(v) : String(v));
/** a value as an attribute: alone, a number as it is and a list or object as JSON */
const attrOf = (v, alone) => (v == null ? '' : alone ? (typeof v === 'object' ? JSON.stringify(v) : String(v)) : textOf(v));

const fill = (text, scope) => text.replace(MARK, (_, p) => textOf(valueAt(scope, p)));
const truthy = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

/**
 * The template `source` (a DOM node's children, untouched) rendered for `state` into a new fragment of `doc`.
 * @param {Document} doc @param {ParentNode} source @param {object} state
 * @returns {DocumentFragment}
 */
export function render(doc, source, state) {
	const out = doc.createDocumentFragment();
	const LIMIT = { nodes: 20000 };
	const into = (target, from, scope, depth) => {
		if (depth > 40) return;
		for (const node of from.childNodes) {
			if (--LIMIT.nodes < 0) return;
			if (node.nodeType === 3) {
				target.append(doc.createTextNode(fill(node.data, scope)));
				continue;
			}
			if (node.nodeType !== 1) continue;
			if (node.localName === 'template') {
				const inner = node.content ?? node;
				if (node.hasAttribute('each')) {
					const list = valueAt(scope, node.getAttribute('each'));
					const as = /^[a-z_$][\w$]*$/i.test(node.getAttribute('as') ?? '') ? node.getAttribute('as') : 'item';
					(Array.isArray(list) ? list.slice(0, 2000) : []).forEach((item, index) => into(target, inner, { ...scope, [as]: item, index }, depth + 1));
				} else if (node.hasAttribute('if')) {
					const cond = node.getAttribute('if').trim();
					const yes = cond.startsWith('!') ? !truthy(valueAt(scope, cond.slice(1))) : truthy(valueAt(scope, cond));
					if (yes) into(target, inner, scope, depth + 1);
				}
				continue;
			}
			const el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ? doc.createElementNS(node.namespaceURI, node.localName) : doc.createElement(node.localName);
			for (const a of node.attributes) {
				const m = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(a.value);
				const value = m ? attrOf(valueAt(scope, m[1]), true) : fill(a.value, scope);
				// the markup was made safe before it was a template; a value the state filled in is held to the same
				// rules again, before the element has it: a script, a handler or an address it may not name is dropped
				const kept = value === a.value ? value : cleanAttr(el, a.name, value);
				if (kept != null) el.setAttribute(a.name, kept);
			}
			const on = el.getAttribute('data-on');
			if (on != null) {
				let want;
				try {
					want = JSON.parse(el.getAttribute('data-value') ?? 'null');
				} catch {
					want = el.getAttribute('data-value');
				}
				const hit = on === '*' ? Object.values(scope ?? {}).includes(want) : valueAt(scope, on) === want;
				if (hit) el.classList.add('on');
			}
			into(el, node, scope, depth + 1);
			target.append(el);
		}
	};
	into(out, source, state ?? {}, 0);
	return out;
}

/**
 * The event a control or a click on `el` names: `{ name, value }`, or null where none is named.
 * @param {Element} el the element the event happened on
 * @param {string} type the DOM event (click, input, change)
 */
export function eventOf(el, type) {
	const at = el?.closest?.('[data-event]');
	if (!at) return null;
	const name = String(at.getAttribute('data-event')).slice(0, 40);
	const control = /^(INPUT|SELECT|TEXTAREA)$/i.test(at.tagName);
	if (control) {
		if (type === 'click' && at.type !== 'checkbox' && at.type !== 'radio') return null;
		if (type !== 'click' && (at.type === 'checkbox' || at.type === 'radio') && type !== 'change') return null;
		const value = at.type === 'checkbox' ? at.checked : at.type === 'range' || at.type === 'number' ? Number(at.value) : String(at.value).slice(0, 2000);
		return { name, value };
	}
	if (type !== 'click') return null;
	let value = null;
	const raw = at.getAttribute('data-value');
	if (raw != null)
		try {
			value = JSON.parse(raw);
		} catch {
			value = raw.slice(0, 2000);
		}
	return { name, value };
}
