// @ts-nocheck — plain JS
/*
 * THE VIEW HOST'S PAGE SIDE — what ./ViewHost.svelte needs besides itself: every kind of view we have read as the one
 * kind (HTML and CSS, our components, template marks, an optional draw script and optional logic), the frozen
 * engines it hands the frame, each checked against its hash, and the frame's first document.
 *
 *   viewOf(view)        a Generated UI view (a2ui or html) as the one kind
 *   viewOfCard(card)    a game's view card (MaiaCity V1's MIPs) as the one kind, the same object
 *                       while its code is, so its frame is never made again until a proposal changes it
 *   engineCode(kind, v) a frozen engine's code: 'view', 'view-worker', or a library ('lib-three' ...), version `v`
 *                       (the latest where none is given)
 *
 * A view runs on the view engine it names (its `engine`, a code entry's: ./engines.js `engineFor`, never below the
 * floor), and its script in the view worker that engine was frozen with (`workerFor`).
 *   bootDoc(key, nonce) the frame's first document: its policy, and the one script that takes in our engine
 */
import { LIBS } from '../../../game/code/limits.js';
import { fromA2ui } from './view/a2ui.js';
import { workerFor } from './engines.js';
import { engineCode } from './frame.js';
import { VIEW_SCRIPT, frameCsp } from './policy.js';

/**
 * A view as the host shows it: `{ id, title, html, libs, height (0: as high as what it shows), data, input, logic?,
 * engine? }`, `engine` the view engine version it names.
 * @param {{ id: string, title?: string, kind: string, spec: any, engine?: number }} v
 */
export function viewOf(v) {
	if (v?.html !== undefined && v?.spec === undefined) return v;
	const spec = v?.spec ?? {};
	const engine = v?.engine != null ? { engine: v.engine } : {};
	if (v?.kind === 'a2ui') {
		const lens = fromA2ui(spec);
		return { id: v.id, title: v.title ?? v.id, html: lens.html, libs: [], height: 0, data: lens.data, input: {}, ...(lens.logic ? { logic: lens.logic } : {}), ...engine };
	}
	return { id: v?.id, title: v?.title ?? v?.id, html: String(spec.html ?? ''), libs: spec.libs ?? [], height: spec.height ?? 0, data: spec.data ?? {}, input: spec.input ?? {}, ...(spec.logic ? { logic: spec.logic } : {}), ...engine };
}

const cards = new Map();
/**
 * a game's view card as the one kind of view @param {{ id: string, name?: string, code: string, data?: any, engine?: number }} c
 */
export function viewOfCard(c, height = 400) {
	const k = `${c.id}\n${c.code}\n${JSON.stringify(c.data ?? {})}\n${c.engine ?? ''}`;
	if (!cards.has(k)) cards.set(k, { id: c.id, title: c.name ?? c.id, html: c.code, libs: c.data?.libs ?? [], height: c.data?.height ?? height, data: {}, input: {}, ...(c.logic ? { logic: c.logic } : {}), ...(c.engine != null ? { engine: c.engine } : {}) });
	return cards.get(k);
}

/** whether a view's HTML carries a script of its own (its draw script, run in the frame's worker) */
export const hasScript = (html) => /<script[\s>]/i.test(String(html ?? ''));

/** frozen engine `v` of `kind`, checked (./frame.js, one loader for every host) */
export { engineCode };

/**
 * what the frame needs for a view with a draw script: the view worker view engine `engine` starts it in, and the
 * libraries it names (only those: an import of any other fails in the worker) @param {{ libs?: string[] }} view
 * @param {number} engine
 */
export async function workerOf(view, engine) {
	const libs = (view.libs ?? []).filter((l) => LIBS[l]);
	const worker = workerFor(engine);
	if (!worker) throw new Error(`no view worker is frozen for view engine ${engine}`);
	const [code, ...codes] = await Promise.all([engineCode('view-worker', worker.v), ...libs.map((l) => engineCode(LIBS[l].engine))]);
	return { code, libs: Object.fromEntries(libs.map((l, i) => [l, codes[i]])) };
}

/** the frame's policy: our engine's script by its nonce and blob: URLs it makes, nothing in or out */
export const viewCsp = (nonce) =>
	frameCsp({ script: `'nonce-${nonce}' blob:`, children: true, open: { 'style-src': "'unsafe-inline'", 'img-src': 'data: blob:', 'font-src': 'data:', 'media-src': 'data: blob:' } });

/**
 * The frame's first document: nothing of a view's in it, only the script that takes our engine (and the port it
 * speaks over) from this page, once, and starts it from a blob: URL (./policy.js VIEW_SCRIPT, the same text in every
 * frame, which the page's own policy names by its hash). The key it must be handed with is the document's own.
 * @param {string} key @param {string} nonce
 */
export const bootDoc = (key, nonce) => `<!doctype html><html data-key="${key}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${viewCsp(nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script nonce="${nonce}">${VIEW_SCRIPT}<\/script></head><body></body></html>`;
