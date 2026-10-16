// @ts-nocheck — plain JS, kept loose on purpose
/**
 * Generated UI (Samuel, 2026-10-13): mini app views an agent writes on the fly, over the MCP, and the page
 * /app/genui/ draws. Two kinds, after the two kinds of generative UI (A2UI and MCP Apps):
 *
 * - `a2ui`: DECLARATIVE. JSON only: a flat list of components from OUR catalog (below), each with an id, the root's
 *   id, a data model, and optional logic. The page draws it with its own Svelte components; text is always text.
 *   Nothing the agent wrote runs in the page. Its logic (`logic`, a JS module exporting `init(data)` and
 *   `on(event, data)`) runs in a QuickJS engine (src/lib/genui/logic.js, the same box as Sandbox 7's card code):
 *   no page, no network, no clock, 8 MB, a few ms a call. It only ever hands back a new data model.
 * - `html`: HTML and CSS, after MCP Apps (spec 2026-01-26: text/html;profile=mcp-app), for what no catalog can hold.
 *   Without a script it is a template: {{path}} marks filled from its data (as text, always), <template each|if>,
 *   and buttons or controls with data-event that name an event; it may carry `logic` as an a2ui view does. With a
 *   script (a three.js scene, a d3 chart, a canvas, the official MCP Apps SDK), the script draws: it runs in a worker
 *   on a copy of the DOM, never in a window, with the libraries in LIBS from our own frozen files (no CDN).
 *
 * Both kinds are ONE kind to the page: the view host (src/lib/sandbox/ViewHost.svelte) reads an a2ui view as HTML with
 * our components (src/lib/sandbox/view/a2ui.js) and shows every view the same way, merged or only proposed: a frame
 * with no origin and no connection, where only our frozen view engine writes the DOM, from HTML it made safe. Nothing
 * a view brings can reach the page, so there is nothing to trust and no Run button. A view speaks to the page only
 * as an MCP App speaks to its host: JSON-RPC (ui/initialize, then the view's `data` as its tool result), and of
 * those only the METHODS below.

 * The API (api/src/genui.js) and the page both check a view with `check` before keeping or drawing it.
 */

/** the components an a2ui view may use, and the props each takes (anything else is dropped) */
export const CATALOG = {
	Column: { props: ['gap', 'align'], children: true },
	Row: { props: ['gap', 'align', 'wrap'], children: true },
	Grid: { props: ['columns', 'gap'], children: true },
	Card: { props: ['title', 'subtitle', 'tone'], children: true },
	Heading: { props: ['text', 'level'] },
	Text: { props: ['text', 'tone', 'size'] },
	Metric: { props: ['label', 'value', 'unit', 'delta', 'tone'] },
	Badge: { props: ['text', 'tone'] },
	Progress: { props: ['label', 'value', 'max', 'tone'] },
	Bars: { props: ['label', 'items', 'unit'] },
	Table: { props: ['columns', 'rows'] },
	List: { props: ['items'] },
	Button: { props: ['label', 'event', 'value', 'tone'] },
	Slider: { props: ['label', 'event', 'value', 'min', 'max', 'step', 'unit'] },
	Divider: { props: [] }
};

/** colours a component may ask for: names, never CSS */
export const TONES = ['default', 'accent', 'good', 'warn', 'bad', 'muted'];

/**
 * The libraries an html view's script may use, each a frozen engine of ours (src/lib/sandbox/engines.json, built from
 * the npm package at this version): nothing else, and nothing from a CDN. A module script imports them by name:
 * `import * as THREE from 'three'` (addons from 'three/addons/…'), `import { App } from '@modelcontextprotocol/ext-apps'`;
 * d3 is also the global `d3`.
 */
export const LIBS = {
	three: { version: '0.186.0', engine: 'lib-three' },
	d3: { version: '7.9.0', engine: 'lib-d3' },
	// the MCP Apps SDK: import { App } from '@modelcontextprotocol/ext-apps'
	'mcp-apps': { version: '2.0.3', engine: 'lib-mcp-apps' }
};

/** the MCP Apps version this page speaks as a host */
export const PROTOCOL = '2026-01-26';

/**
 * What a code view may ask of the page (MCP Apps methods, View -> Host), and nothing else. ui/initialize is answered,
 * size-changed resizes the frame (within LIMITS.height), notifications/message, ui/update-model-context and ui/message
 * land in the page's feed as plain data. ui/open-link, tools/call and resources/read are refused: a generated view
 * never leaves its box, calls a tool or reads anything we did not hand it.
 */
export const METHODS = ['ui/initialize', 'ui/notifications/initialized', 'ui/notifications/size-changed', 'notifications/message', 'ui/update-model-context', 'ui/message', 'ui/request-display-mode', 'ping'];

export const LIMITS = { title: 80, note: 400, html: 200_000, components: 300, json: 100_000, logic: 20_000, height: [160, 1200] };

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

export class ViewError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

/** a prop's value: plain JSON, or a binding {$data: 'a.b'} to the view's data model */
const plain = (v, depth = 0) => {
	if (depth > 6) return null;
	if (v === null || typeof v === 'boolean') return v;
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string') return v.slice(0, 2000);
	if (Array.isArray(v)) return v.slice(0, 200).map((x) => plain(x, depth + 1));
	if (typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 50).map(([k, x]) => [k.slice(0, 40), plain(x, depth + 1)]));
	return null;
};

/** a declarative view's spec, cleaned: unknown components are refused, unknown props dropped */
function checkA2ui(spec) {
	const list = Array.isArray(spec?.components) ? spec.components : null;
	if (!list?.length) throw new ViewError('An a2ui view needs components: [{ id, type, ...props, children? }].');
	if (list.length > LIMITS.components) throw new ViewError(`At most ${LIMITS.components} components.`);
	const ids = new Set();
	const components = list.map((c, i) => {
		const type = c?.type;
		const def = CATALOG[type];
		if (!def) throw new ViewError(`Component ${i + 1}: "${String(type).slice(0, 30)}" is not in the catalog (${Object.keys(CATALOG).join(', ')}).`);
		const id = str(c.id, 48);
		if (!id || ids.has(id)) throw new ViewError(`Component ${i + 1}: each needs its own id.`);
		ids.add(id);
		const out = { id, type };
		for (const p of def.props) if (c[p] !== undefined) out[p] = plain(c[p]);
		if (def.children) out.children = Array.isArray(c.children) ? c.children.filter((x) => typeof x === 'string').slice(0, 100) : [];
		return out;
	});
	const root = str(spec.root, 48) || components[0].id;
	if (!ids.has(root)) throw new ViewError(`The root "${root}" is no component.`);
	for (const c of components) for (const k of c.children ?? []) if (!ids.has(k)) throw new ViewError(`${c.id}: no child "${k}".`);
	const data = plain(spec.data ?? {});
	if (JSON.stringify({ components, data }).length > LIMITS.json) throw new ViewError('The view is too big.');
	const logic = str(spec.logic, LIMITS.logic + 1);
	if (logic.length > LIMITS.logic) throw new ViewError(`Its logic is longer than ${LIMITS.logic} characters.`);
	return { root, components, data: data && typeof data === 'object' && !Array.isArray(data) ? data : {}, ...(logic.trim() ? { logic } : {}) };
}

function checkHtml(spec) {
	const html = typeof spec?.html === 'string' ? spec.html : '';
	if (!html.trim()) throw new ViewError('An html view needs html: the body, its <style> and <script> included.');
	if (html.length > LIMITS.html) throw new ViewError(`Its html is longer than ${LIMITS.html} characters.`);
	const libs = (Array.isArray(spec.libs) ? spec.libs : []).filter((l) => typeof l === 'string');
	const bad = libs.find((l) => !LIBS[l]);
	if (bad) throw new ViewError(`No library "${bad.slice(0, 30)}": only ${Object.keys(LIBS).join(', ')}.`);
	const h = Math.round(Number(spec.height) || 420);
	// what the view is handed as its tool's input and result (ui/notifications/tool-input, tool-result): plain JSON
	const input = plain(spec.input ?? {});
	const data = plain(spec.data ?? {});
	if (JSON.stringify({ input, data }).length > LIMITS.json) throw new ViewError('Its data is too big.');
	const logic = str(spec.logic, LIMITS.logic + 1);
	if (logic.length > LIMITS.logic) throw new ViewError(`Its logic is longer than ${LIMITS.logic} characters.`);
	return { html, libs: [...new Set(libs)], height: Math.min(LIMITS.height[1], Math.max(LIMITS.height[0], h)), input, data, ...(logic.trim() ? { logic } : {}) };
}

/** a whole view, as an agent sends it: { id, title, note?, kind, spec } -> the clean one, or a ViewError */
export function check(v) {
	const id = str(v?.id, 49);
	if (!ID.test(id)) throw new ViewError('Give the view an id: lowercase letters, digits and dashes, up to 48.');
	const title = str(v.title, LIMITS.title).trim();
	if (!title) throw new ViewError('Give the view a title.');
	const kind = v.kind;
	if (kind !== 'a2ui' && kind !== 'html') throw new ViewError('kind is "a2ui" (declarative JSON) or "html" (sandboxed code).');
	const spec = kind === 'a2ui' ? checkA2ui(v.spec) : checkHtml(v.spec);
	return { id, title, note: str(v.note, LIMITS.note).trim(), kind, spec };
}

/**
 * A view card (Samuel, 2026-10-13): a game's screen that a proposal carries beside its rules, an html view the view
 * host shows (src/lib/sandbox/ViewHost.svelte) and hands the game's state: as its template's data, and as its tool
 * result. { id, kind: 'view', name, description,
 * data: { slot: 'panel', libs, height }, code: its HTML }. Sandbox 7's config cards (game/economy/params.js) and
 * MaiaCity V1's MIPs (game/maiacity-v1/engine.js) both check theirs here: { card } or { error } in a sentence.
 */
export const VIEW_SLOTS = ['panel'];
export const MAX_VIEW = 100_000;
/** `slots`: where a game lets a screen stand (MaiaCity V1 names its own panels, game/maiacity-v1/views.js) */
export function checkViewCard(raw, slots = VIEW_SLOTS) {
	const id = String(raw?.id ?? '').trim();
	if (!/^[a-z][a-z0-9_-]{1,40}$/.test(id)) return { error: `A view card's id is lowercase letters, digits, - and _, 2 to 41 long (got "${id.slice(0, 40)}").` };
	const name = String(raw?.name ?? '').trim().slice(0, 80) || id;
	const description = String(raw?.description ?? '').trim().slice(0, 4000);
	const code = String(raw?.code ?? '');
	if (!code.trim()) return { error: `Card ${id}: a view's code is its HTML (an MCP App).` };
	if (code.length > MAX_VIEW) return { error: `Card ${id}: a view's code is at most ${MAX_VIEW} characters.` };
	const d = raw?.data ?? {};
	const slot = d.slot ?? 'panel';
	if (!slots.includes(slot)) return { error: `Card ${id}: a view's slot is one of ${slots.join(', ')}.` };
	const libs = Array.isArray(d.libs) ? d.libs.filter((l) => typeof l === 'string') : [];
	const bad = libs.find((l) => !LIBS[l]);
	if (bad) return { error: `Card ${id}: no library "${bad.slice(0, 30)}"; a view may load ${Object.keys(LIBS).join(', ')}.` };
	const height = Math.min(LIMITS.height[1], Math.max(LIMITS.height[0], Math.round(Number(d.height) || 520)));
	return { card: { id, kind: 'view', name, description, values: {}, data: { slot, libs: [...new Set(libs)], height }, code } };
}
