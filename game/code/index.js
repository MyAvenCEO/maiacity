// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE ONE LOADER for code entries: codeAt(ref) for every view and logic module our pages and the API run, wherever
 * it is kept. Their home is the Maia City vault in avenDB (./sources/avendb.js, C10; Samuel 2026-10-17: every dynamic
 * config and every piece of code our hosts run goes through avenDB), loaded once with `loadCode()`; the repo's code/
 * (bundled as code/index.js by scripts/code-index.mjs) is the seed, served offline, before that load, and for any path
 * the vault does not hold. Reading stays synchronous: what was loaded is read as the seed is.
 *
 *   codeAt('views/village-scene')            the entry: { ref, type, title, ..., files, hash }
 *   codeAt('views/village-scene@3f2a…')       the same, only while its hash starts so (a ref pinned to a version)
 *   codeIn('configs/sandbox-5/')             every entry under a path, in order
 *   configAt('configs/sandbox-5/rules')      a game's settings, as plain JSON (A3: the Maia City COOP keeps them)
 *   viewOfEntry(e), cardOfEntry(e)           a view entry as a Generated UI view, or as a game's view card
 *
 * An entry is { type: 'view' | 'logic' | 'config', title, note?, ... } and its files: a view's view.html (or a2ui.json),
 * data.json, input.json and logic.js; a logic module's logic.js; a config's config.json. Every one passes the one
 * checker (./check.js) in a test, and a config from the vault is held to the shape of the seed's.
 */
import { ENTRIES } from '../../code/index.js';
import { AVENDB_REF, avendb, loadCode as load } from './sources/avendb.js';

export class CodeError extends Error {}

const REPO_REF = /^((?:views|logic|configs)\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)(?:@([0-9a-f]{6,64}))?$/;

/** a ref read: { source: 'repo', path, hash? } or { source: 'avendb', vault, entry, heads } */
export function parseCodeRef(ref) {
	const s = String(ref ?? '');
	const repo = s.match(REPO_REF);
	if (repo) return { source: 'repo', path: repo[1], ...(repo[2] ? { hash: repo[2] } : {}) };
	const db = s.match(AVENDB_REF);
	if (db) return { source: 'avendb', vault: db[1], entry: db[2], heads: db[3] };
	throw new CodeError(`"${s.slice(0, 80)}" is no code ref: views/<id>, logic/<group>/<id>, configs/<game>/<id>, optionally @<hash>`);
}

/** the entry `ref` names @param {string} ref */
export function codeAt(ref) {
	const r = parseCodeRef(ref);
	if (r.source === 'avendb') return avendb.at(r);
	const e = avendb.byPath(r.path) ?? ENTRIES[r.path];
	if (!e) throw new CodeError(`no code entry ${r.path}`);
	if (r.hash && !e.hash.startsWith(r.hash)) throw new CodeError(`${r.path} is ${e.hash.slice(0, 12)}… now, not ${r.hash.slice(0, 12)}…`);
	return e;
}

/**
 * The settings config entry `ref` holds, as plain JSON: the vault's once loaded (`loadCode`), else the seed's. A copy, so
 * a game that changes what it reads changes nothing here.
 * @param {string} ref
 */
export function configAt(ref) {
	const e = codeAt(ref);
	if (e.type !== 'config') throw new CodeError(`${e.ref} is a ${e.type}, not a config`);
	return JSON.parse(e.files['config.json'] ?? '{}');
}

/** every entry under `prefix`, in the order of their refs */
export const codeIn = (prefix) => {
	const all = { ...ENTRIES, ...avendb.all() };
	return Object.keys(all)
		.filter((k) => k.startsWith(prefix))
		.sort()
		.map((k) => all[k]);
};

/**
 * Load the vault's code entries once (./sources/avendb.js `loadCode`); every later codeAt and codeIn reads them, the
 * seed's where they are not. Resolves to what was taken and left out, or why nothing was loaded; never throws.
 */
let loading = null;
export const loadCode = (opts) => (opts ? load(viewOfEntry, opts) : (loading ??= load(viewOfEntry)));

const json = (e, name, fallback) => (e.files[name] != null ? JSON.parse(e.files[name]) : fallback);
const idOf = (e) => e.ref.split('/').at(-1);

/** a view entry as a Generated UI view: { id, title, note, kind, spec } */
export function viewOfEntry(e) {
	const logic = e.files['logic.js'];
	const spec =
		e.kind === 'a2ui'
			? { ...json(e, 'a2ui.json', {}), data: json(e, 'data.json', {}), ...(logic ? { logic } : {}) }
			: { html: e.files['view.html'] ?? '', libs: e.libs ?? [], height: e.height ?? 420, data: json(e, 'data.json', {}), input: json(e, 'input.json', {}), ...(logic ? { logic } : {}) };
	return { id: idOf(e), title: e.title, note: e.note ?? '', kind: e.kind ?? 'html', spec };
}

/** a view entry as a game's view card: { id, kind: 'view', name, description, values, data: { slot, libs, height }, code } */
export function cardOfEntry(e) {
	return { id: idOf(e), kind: 'view', name: e.title, description: e.note ?? '', values: {}, data: { slot: e.slot ?? 'panel', libs: e.libs ?? [], height: e.height ?? 520 }, code: e.files['view.html'] ?? '' };
}
