// @ts-nocheck — plain JS
/*
 * THE VIEW HOST'S PAGE SIDE — what ./ViewHost.svelte needs besides itself: every kind of view we have read as the one
 * kind (HTML and CSS, our components, template marks, an optional draw script and optional logic), the frozen
 * engines it hands the frame, each checked against its hash, and the frame's first document.
 *
 *   viewOf(view)        a Generated UI view (a2ui or html) as the one kind
 *   viewOfCard(card)    a game's view card (MaiaCity V1's MIPs) as the one kind, the same object
 *                       while its code is, so its frame is never made again until a proposal changes it
 *   engineCode(kind)    a frozen engine's code: 'view', 'view-worker', or a library ('lib-three' ...)
 *   bootDoc(key, nonce) the frame's first document: its policy, and the one script that takes in our engine
 */
import { LIBS } from '../../../game/genui/views.js';
import { fromA2ui } from './view/a2ui.js';
import { latestOf, pathOf } from './engines.js';
import { frozen } from './frame.js';
import { VIEW_SCRIPT } from './policy.js';

/**
 * A view as the host shows it: `{ id, title, html, libs, height (0: as high as what it shows), data, input, logic? }`.
 * @param {{ id: string, title?: string, kind: string, spec: any }} v
 */
export function viewOf(v) {
	if (v?.html !== undefined && v?.spec === undefined) return v;
	const spec = v?.spec ?? {};
	if (v?.kind === 'a2ui') {
		const lens = fromA2ui(spec);
		return { id: v.id, title: v.title ?? v.id, html: lens.html, libs: [], height: 0, data: lens.data, input: {}, ...(lens.logic ? { logic: lens.logic } : {}) };
	}
	return { id: v?.id, title: v?.title ?? v?.id, html: String(spec.html ?? ''), libs: spec.libs ?? [], height: spec.height ?? 0, data: spec.data ?? {}, input: spec.input ?? {}, ...(spec.logic ? { logic: spec.logic } : {}) };
}

const cards = new Map();
/** a game's view card as the one kind of view @param {{ id: string, name?: string, code: string, data?: any }} c */
export function viewOfCard(c, height = 400) {
	const k = `${c.id}\n${c.code}\n${JSON.stringify(c.data ?? {})}`;
	if (!cards.has(k)) cards.set(k, { id: c.id, title: c.name ?? c.id, html: c.code, libs: c.data?.libs ?? [], height: c.data?.height ?? height, data: {}, input: {}, ...(c.logic ? { logic: c.logic } : {}) });
	return cards.get(k);
}

/** whether a view's HTML carries a script of its own (its draw script, run in the frame's worker) */
export const hasScript = (html) => /<script[\s>]/i.test(String(html ?? ''));

const engines = new Map();
/** the latest frozen engine of `kind`, its bytes checked against its hash (once a page) @param {string} kind */
export function engineCode(kind) {
	if (!engines.has(kind)) {
		const e = latestOf(kind);
		const got = e ? frozen(pathOf(kind, e.v), e.blake3, `${kind} engine ${e.v}`) : Promise.reject(new Error(`no ${kind} engine is frozen`));
		got.catch(() => engines.delete(kind));
		engines.set(kind, got);
	}
	return engines.get(kind);
}

/** what the frame needs for a view with a draw script: the worker engine and the libraries it names */
export async function workerOf(view) {
	const libs = (view.libs ?? []).filter((l) => LIBS[l]);
	const [code, ...codes] = await Promise.all([engineCode('view-worker'), ...libs.map((l) => engineCode(LIBS[l].engine))]);
	return { code, libs: Object.fromEntries(libs.map((l, i) => [l, codes[i]])) };
}

/** the frame's policy: our engine's script by its nonce and blob: URLs it makes, nothing in or out */
export const viewCsp = (nonce) =>
	[
		"default-src 'none'",
		`script-src 'nonce-${nonce}' blob:`,
		'worker-src blob:',
		'child-src blob:',
		"style-src 'unsafe-inline'",
		'img-src data: blob:',
		'font-src data:',
		'media-src data: blob:',
		"connect-src 'none'",
		"frame-src 'none'",
		"object-src 'none'",
		"manifest-src 'none'",
		"base-uri 'none'",
		"form-action 'none'"
	].join('; ');

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
