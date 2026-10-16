// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE ONE LOADER for code entries: codeAt(ref) for every view and logic module our pages and the API run, wherever
 * it is kept. Today that is the repo (code/, Samuel 2026-10-16: the source of truth until avenDB carries code; its
 * files bundled as code/index.js by scripts/code-index.mjs). avenDB's source is written and switched off
 * (./sources/avendb.js): its refs are read, and refused, until C10 turns it on.
 *
 *   codeAt('views/village-scene')            the entry: { ref, type, title, ..., files, hash }
 *   codeAt('views/village-scene@3f2a…')       the same, only while its hash starts so (a ref pinned to a version)
 *   codeIn('logic/sandbox-7/')               every entry under a path, in order
 *   viewOfEntry(e), cardOfEntry(e)           a view entry as a Generated UI view, or as a game's view card
 *
 * An entry is { type: 'view' | 'logic', title, note?, ... } and its files: a view's view.html (or a2ui.json), data.json,
 * input.json and logic.js; a logic module's logic.js. Every one passes the one checker (./check.js) in a test.
 */
import { ENTRIES } from '../../code/index.js';
import { AVENDB_REF, avendb } from './sources/avendb.js';

export class CodeError extends Error {}

const REPO_REF = /^((?:views|logic)\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)(?:@([0-9a-f]{6,64}))?$/;

/** a ref read: { source: 'repo', path, hash? } or { source: 'avendb', vault, entry, heads } */
export function parseCodeRef(ref) {
	const s = String(ref ?? '');
	const repo = s.match(REPO_REF);
	if (repo) return { source: 'repo', path: repo[1], ...(repo[2] ? { hash: repo[2] } : {}) };
	const db = s.match(AVENDB_REF);
	if (db) return { source: 'avendb', vault: db[1], entry: db[2], heads: db[3] };
	throw new CodeError(`"${s.slice(0, 80)}" is no code ref: views/<id>, logic/<group>/<id>, optionally @<hash>`);
}

/** the entry `ref` names @param {string} ref */
export function codeAt(ref) {
	const r = parseCodeRef(ref);
	if (r.source === 'avendb') return avendb.at(r);
	const e = ENTRIES[r.path];
	if (!e) throw new CodeError(`no code entry ${r.path}`);
	if (r.hash && !e.hash.startsWith(r.hash)) throw new CodeError(`${r.path} is ${e.hash.slice(0, 12)}… now, not ${r.hash.slice(0, 12)}…`);
	return e;
}

/** every entry under `prefix`, in the order of their refs */
export const codeIn = (prefix) =>
	Object.keys(ENTRIES)
		.filter((k) => k.startsWith(prefix))
		.sort()
		.map((k) => ENTRIES[k]);

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
