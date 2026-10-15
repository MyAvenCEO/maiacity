/*
 * Records inside records, as the page words and walks them (avendb/docs/ARCHITECTURE.md §8): a path names a place of
 * a record at any depth, a field, then a row of the list in it by its id, then a field of that row, and so on
 * (`["nodes", {"id": 1}, "kids", {"id": 11}, "text"]`), and a rule of a share names any row or any field by "*". A
 * field holds a list of records (rows, each an object with an integer id), or a link to another entry or a row of one
 * (avendb's `ops::Link`), which a query follows a level at a time. Every walk here is a loop over a stack of its own,
 * never a recursion, as the device's are: a record nested deep can't overflow the page's stack.
 */

/** @typedef {string | number | { id: number, copy?: number }} Step */
/**
 * A link as a record holds it, and what a query that follows it shows: the record or row it leads to (`to`), or why it
 * shows none (`empty`, `why`).
 * @typedef {{ vault: string, entry: string, row?: Step[], at?: string[], to?: Record<string, unknown>,
 *   empty?: string, why?: string }} Link
 */

const HEX = /^[0-9a-f]{64}$/;
const LINK_KEYS = ['vault', 'entry', 'row', 'at', 'to', 'empty', 'why'];

/** Whether `v` is a plain object. @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Whether `v` is a list of records: an array whose every item is an object with an integer id, an empty one too.
 * @param {unknown} v @returns {v is { id: number, [k: string]: unknown }[]}
 */
export const isRows = (v) => Array.isArray(v) && v.every((x) => isObject(x) && Number.isInteger(x.id));

/** Whether `v` is a link, as a record holds it or as a query shows it followed. @param {unknown} v @returns {v is Link} */
export const isLink = (v) =>
	isObject(v) && HEX.test(String(v.vault)) && HEX.test(String(v.entry)) && Object.keys(v).every((k) => LINK_KEYS.includes(k));

/** Whether `v` is a list of links, at least one. @param {unknown} v @returns {v is Link[]} */
export const isLinks = (v) => Array.isArray(v) && v.length > 0 && v.every(isLink);

/** A row of a path in words: "row 11", "row 11 (its copy 2)", "any row". @param {Step} s */
const rowWords = (s) => {
	if (s === '*') return 'any row';
	if (isObject(s)) return s.copy ? `row ${s.id} (its copy ${s.copy + 1})` : `row ${s.id}`;
	return `item ${Number(s) + 1}`;
};

/**
 * A place in words, at any depth, from the field it ends on up to the record: "its status", "row 2 of its blocks",
 * "the text of row 11 of the kids of row 1 of its nodes", "any field of any row of its blocks"; `[]` is "anything".
 * @param {Step[] | undefined} path
 */
export function pathWords(path = []) {
	if (!path.length) return 'anything';
	/** @type {string[]} */
	const parts = [];
	for (let i = path.length - 1; i >= 0; i--) {
		const s = path[i];
		if (i % 2 === 1) parts.push(rowWords(s));
		else if (s === '*') parts.push('any field');
		else parts.push(`${i === 0 ? 'its' : 'the'} ${s}`);
	}
	return parts.join(' of ');
}

/** A value in a few words. @param {unknown} v */
export function valueWords(v) {
	if (v === null || v === undefined) return 'nothing';
	if (typeof v === 'string') return v ? `“${v.length > 60 ? `${v.slice(0, 60)}…` : v}”` : 'an empty text';
	if (isLink(v)) return `a link to ${v.row?.length ? `${pathWords(v.row)} of ` : ''}entry ${v.entry.slice(0, 8)}`;
	if (isRows(v)) return v.length ? `rows ${v.map((r) => r.id).join(', ')}` : 'no rows';
	if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
	return String(v);
}

/**
 * What one change of a write did, in words, as the engine's `history` names it (avendb's `ops::Change::to_json`): a
 * place's new value, a place taken out, or a list's rows now.
 * @param {{ set?: Step[], value?: unknown, unset?: Step[], rows?: string | Step[], keys?: { id: number }[] | null }} c
 */
export function changeWords(c) {
	if (c.set) return `set ${pathWords(c.set)} to ${valueWords(c.value)}`;
	if (c.unset) return `took out ${pathWords(c.unset)}`;
	const list = typeof c.rows === 'string' ? [c.rows] : (c.rows ?? []);
	if (!c.keys) return `took out the rows of ${pathWords(list)}`;
	return c.keys.length ? `${pathWords(list)}: rows ${c.keys.map((k) => k.id).join(', ')}` : `emptied ${pathWords(list)}`;
}

/**
 * Where two lines both changed one top row differently, at any depth below it: each place under `at` whose value
 * `ours` and `theirs` hold differently, each other than `base`, the deepest that differ, rows matched by id. A row one
 * side took out and the other changed is the row itself. A loop over a stack of its own.
 * @param {Step[]} at @param {unknown} base @param {unknown} ours @param {unknown} theirs @returns {Step[][]}
 */
export function clashes(at, base, ours, theirs) {
	/** @type {Step[][]} */
	const out = [];
	const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b);
	/** @type {[Step[], unknown, unknown, unknown][]} */
	const todo = [[at, base, ours, theirs]];
	while (todo.length) {
		const [path, b, o, t] = /** @type {[Step[], unknown, unknown, unknown]} */ (todo.pop());
		if (same(o, t) || same(o, b) || same(t, b)) continue;
		if (isObject(o) && isObject(t)) {
			const bo = isObject(b) ? b : {};
			const fields = new Set([...Object.keys(o), ...Object.keys(t)]);
			for (const f of fields) {
				const [x, y, z] = [bo[f], o[f], t[f]];
				if (isRows(y) && isRows(z)) {
					const rows = isRows(x) ? x : [];
					const ids = new Set([...y, ...z].map((r) => r.id));
					for (const id of ids) {
						const pick = (/** @type {{ id: number }[]} */ rs) => rs.find((r) => r.id === id);
						todo.push([[...path, f, { id }], pick(rows), pick(y), pick(z)]);
					}
				} else todo.push([[...path, f], x, y, z]);
			}
			continue;
		}
		out.push(path);
	}
	return out.length ? out : [at];
}

/**
 * The fields a share's rules may name in records of schema `json` (a JSON Schema, as the `schemas` op gives it), at
 * any depth: each field of the record, and each field of the rows of each list of records, by its path with "*" for
 * any row (`["nodes", "*", "kids", "*", "text"]`), with the values it takes where it takes only some (an enum, or true
 * and false), and whether it is a list of records, so a rule may add, delete or reorder its rows. A shape that holds
 * rows of its own shape is named down to `deep` lists of rows. A loop over a stack of its own.
 * @param {any} json @param {number} [deep]
 * @returns {{ path: string[], values: (string | number | boolean | null)[] | null, rows: boolean }[]}
 */
export function fieldPaths(json, deep = 3) {
	const defs = json?.$defs ?? {};
	/** @param {any} p */
	const resolve = (p) => {
		for (let n = 0; n < 32 && typeof p?.$ref === 'string'; n++) p = defs[p.$ref.replace('#/$defs/', '')];
		return p;
	};
	/** @type {{ path: string[], values: (string | number | boolean | null)[] | null, rows: boolean }[]} */
	const out = [];
	/** @type {[string[], any, number][]} each field still to name: its path, its property, and how many lists down */
	const todo = [];
	/** @param {any} shape @param {string[]} at @param {number} rows */
	const fieldsOf = (shape, at, rows) => {
		const fields = Object.entries(resolve(shape)?.properties ?? {});
		const named = fields.filter(([name]) => !(rows === 0 && name === 'kind') && !(rows > 0 && name === 'id'));
		for (const [name, p] of named.reverse()) todo.push([[...at, name], p, rows]);
	};
	fieldsOf(json, [], 0);
	// a field, then the fields of its rows, in the schema's order
	while (todo.length) {
		const [path, raw, rows] = /** @type {[string[], any, number]} */ (todo.pop());
		const p = resolve(raw);
		const items = resolve(p?.items);
		const isList = p?.type === 'array' && items?.type === 'object' && items?.properties?.id?.type === 'integer';
		out.push({ path, values: p?.enum ?? (p?.type === 'boolean' ? [true, false] : null), rows: isList });
		if (isList && rows < deep) fieldsOf(items, [...path, '*'], rows + 1);
	}
	return out;
}

/**
 * What is at `path` of `v`: each step a field, a row of a list of records by its id, an item of a list by its index,
 * or a link's record or row (`{ to: true }`); `undefined` where nothing is.
 * @param {unknown} v @param {(Step | { to: true })[]} path @returns {unknown}
 */
export function at(v, path) {
	let here = v;
	for (const s of path) {
		if (isObject(s) && 'to' in s) here = isLink(here) ? here.to : undefined;
		else if (isObject(s)) here = isRows(here) ? here.find((r) => r.id === s.id) : undefined;
		else if (typeof s === 'number') here = Array.isArray(here) ? here[s] : undefined;
		else here = isObject(here) ? here[s] : undefined;
		if (here === undefined) return undefined;
	}
	return here;
}

/**
 * The query that shows where a trail through a record ends (./RecordView.svelte): the places of the links it follows,
 * as a query's `follow` names them (a field, or a path to one through rows by their ids; a list of links by its
 * field), each from the record or row the hop before led to, each once; and how many levels down it reads, each row and
 * each hop one, as a query counts them, and one more, so the place it ends at shows its own rows. A query reads no
 * deeper than what is shown.
 * @param {(Step | { to: true })[]} trail @returns {{ follow: Step[][], depth: number }}
 */
export function trailQuery(trail) {
	/** @type {Step[][]} */
	const follow = [];
	/** @type {Step[]} */
	let from = [];
	let depth = 1;
	for (const s of trail) {
		if (isObject(s)) depth += 1;
		if (!(isObject(s) && 'to' in s)) {
			from.push(/** @type {Step} */ (s));
			continue;
		}
		const place = typeof from.at(-1) === 'number' ? from.slice(0, -1) : from;
		if (!follow.some((p) => JSON.stringify(p) === JSON.stringify(place))) follow.push(place);
		from = [];
	}
	return { follow, depth };
}
