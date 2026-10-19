/*
 * What the database studio's views share (Database.svelte and the views it shows): a vault's database as the acting
 * vault opens it (`studio`), its tables, one for each of its schemas, a JSON Schema field's type as Postgres would name
 * its like, a value as a grid's cell shows it, the families of schemas the lenses join version by version, a lens's
 * steps, and what each signed edit of the database's history does, in words. The device decides all of it (the
 * `database` and `log` ops, avendb-browser's `data`); these only lay it out.
 */
import {
	count,
	EVERYONE,
	granteeOf,
	levelName,
	list,
	nameOf,
	reads,
	roleGroup,
	sharedThrough,
	sharedWith,
	sharedWords,
	signerName,
	short,
	singular,
	size,
	whereWords
} from './vaults.js';

/**
 * @typedef {{ id: string, title: string, json: string }} SchemaView
 * @typedef {{ id: string, title: string, from: string, to: string, json: string }} LensView
 * @typedef {{ entry: string, type: string | null, tags: string[] | null, kind: string, title: string | null,
 *   record: any, authored: string[], edits: number, held: number, lines: number, proposals: (string | null)[],
 *   audience: string, epoch: number, bytes: number, author: string | null, actor: string | null, public: boolean,
 *   levels: Record<string, import('./vaults.js').Role>, brought?: { edit: string, line: string | null,
 *   version: number | null, files: { root: string, size: number, len: number | null }[], record: any }[] }} RowView
 * @typedef {{ id: string, shares: string[], epoch: number, entries: number }} CellRow
 * @typedef {{ founded: number, writes: number, moves: number, keys: number, shares: number, revokes: number }} EditCounts
 * @typedef {{ vault: string, held: { edits: number, keys: number },
 *   builtIn: { schemas: SchemaView[], lenses: LensView[] }, seed: number, edits: EditCounts, schemas: SchemaView[],
 *   lenses: LensView[], audiences: CellRow[], rows: RowView[] }} Db
 * @typedef {{ signer: string, by: 'device' | 'passkey' | 'touch', webauthn: 'edit' | 'batch' | 'pass' | null,
 *   batch: number | null, pq: number }} SigView
 * @typedef {{ n: number, id: string, kind: string, fields: any, author: string, cosigners: string[], sigs: SigView[],
 *   parents: string[], depth: number, bytes: number, vaults: string[], counted: boolean | null,
 *   allowed: boolean | null, why: 'builds-on' | 'sealed' | 'unfit' | 'policy' | 'ops' | null,
 *   chain: import('./vaults.js').Chain | null }} SignedEdit
 * @typedef {{ name: string, type: string, hint: string, required: boolean, fallback: string | null,
 *   fields: Field[] }} Field
 * @typedef {{ schemas: SchemaView[], lenses: (LensView | null)[], name: string }} Family
 * @typedef {{ id: string, label: string, hint: string, family: Family | null, rows: RowView[] }} Table
 */

/**
 * Vault `vault`'s database as the page shows it to vault `actor`: what this browser holds of it, its cells, its schemas
 * and lenses (the app's own, then the vault's lane: its own schema and lens entries, shared with Everyone, as they hold
 * no data, and so with every device that follows the vault), and how to name what the views show: vaults, devices and
 * passkeys, who entries are shared with, shares, entries, schemas.
 * @param {import('./vaults.js').WorldView} world @param {Db | null} db @param {string} vault @param {string} actor
 */
export function studio(world, db, vault, actor) {
	const byId = new Map(world.vaults.map((v) => [v.id, v]));
	const here = byId.get(vault);
	const as = byId.get(actor);
	const held = db?.vault === vault ? db : null;
	const rows = held?.rows ?? [];
	const cells = held?.audiences ?? [];
	const known = new Map(world.entries.map((e) => [e.entry, e]));
	/** Whether the acting vault reads entry `id`, as the device says. @param {string} id */
	const readable = (id) => {
		const e = known.get(id);
		return !!e && reads(e, actor);
	};
	/** Whether the acting vault opens row `r`, and this browser holds its record. @param {RowView} r */
	const opens = (r) => (r.public || readable(r.entry)) && r.record !== null;
	const schemas = byIds([...(db?.builtIn.schemas ?? []), ...(held?.schemas ?? [])]);
	const lenses = byIds([...(db?.builtIn.lenses ?? []), ...(held?.lenses ?? [])]);
	/** the ids of avenDB's own schemas and lenses: every app knows them, and avenCEO GmbH holds each as its entry */
	const standard = new Set([...(db?.builtIn.schemas ?? []), ...(db?.builtIn.lenses ?? [])].map((x) => x.id));
	/** the rows the acting vault opens, by the schemas they were written under */
	const uses = new Map();
	for (const r of rows.filter(opens)) for (const id of r.authored) uses.set(id, (uses.get(id) ?? 0) + 1);

	/** The vault or signer `id` names, as a person reads it: a device by its name, a vault's passkey. */
	const signer = (/** @type {string} */ id) => signerName(world, id);
	/**
	 * Cap `id` as a share, where it is in force: "avenBOB’s share of todos tagged “garden” as Editor".
	 * @param {string} id
	 */
	const share = (id) => {
		const c = world.shares.find((x) => x.id === id);
		const what = c && (c.whole ? 'everything' : whereWords(c.slice?.where, world));
		return c ? `${granteeOf(c, world)}’s share of ${what} as ${levelName(c, world)}` : `share ${short(id)}`;
	};
	/**
	 * Who the entries caps `caps` pick in vault `of` are shared with, in words, those on the whole vault too.
	 * @param {string[]} caps @param {string} [of]
	 */
	const through = (caps, of = vault) => sharedWords(sharedThrough(world, of, caps));
	/**
	 * Who the entries of cell `id` of vault `of` are shared with, in words: `null` for a cell this browser doesn't know.
	 * @param {string} id @param {string} [of]
	 */
	const sharedIn = (id, of = vault) => {
		const caps = world.audiences.find((x) => x.id === id)?.shares ?? cells.find((x) => x.id === id)?.shares;
		return caps ? through(caps, of) : null;
	};
	/**
	 * The vault's entries by who they are shared with: the cells whose shares read alike as one, so a filter lists each
	 * who once, the fewest entries first.
	 * @type {{ words: string, ids: string[], entries: number }[]}
	 */
	const byWho = [];
	for (const x of cells) {
		const words = sharedIn(x.id) ?? short(x.id);
		const g = byWho.find((y) => y.words === words);
		if (g) [g.ids, g.entries] = [[...g.ids, x.id], g.entries + x.entries];
		else byWho.push({ words, ids: [x.id], entries: x.entries });
	}
	byWho.sort((a, b) => a.entries - b.entries);
	/** Who entry `entry` of the vault is shared with. @param {string} entry */
	const sharers = (entry) => sharedWith(world, vault, entry);
	/** Who entry `entry` of the vault is shared with, in words. @param {string} entry */
	const shared = (entry) => sharedWords(sharers(entry));
	/** Entry `entry`: its title in quotes if the acting vault reads it, else what it is and its id. @param {string} entry */
	const entry = (entry) => {
		const row = rows.find((r) => r.entry === entry);
		if (row && opens(row) && row.title) return `“${row.title}”`;
		const e = known.get(entry);
		if (e && e.kind !== 'sealed' && reads(e, actor) && e.title) return `“${e.title}”`;
		return `${e?.type ? `a ${singular(e.type)}` : 'entry'} ${short(entry)}`;
	};
	/** A schema by its id: its title, or the start of its id. @param {string} id */
	const schemaName = (id) => schemas.get(id)?.title ?? `schema ${short(id)}`;

	return {
		byId,
		here,
		as,
		rows,
		cells,
		byWho,
		opens,
		schemas,
		lenses,
		standard,
		uses,
		world,
		known,
		readable,
		signer,
		share,
		through,
		sharedIn,
		sharers,
		shared,
		entry,
		schemaName,
		vaultName: (/** @type {string} */ id) => nameOf(byId.get(id))
	};
}

/** @typedef {ReturnType<typeof studio>} Studio */

/** @template {{ id: string }} T @param {T[]} all @returns {Map<string, T>} */
function byIds(all) {
	const map = new Map();
	for (const x of all) if (!map.has(x.id)) map.set(x.id, x);
	return map;
}

/**
 * The hint of the table of each type of the vault's lane, its schema and lens entries: each holds its JSON as written
 * (JSON Schema, a lens), no record of a schema of its own.
 */
const LANE = /** @type {Record<string, string>} */ ({
	schema: 'The vault’s schemas, each a JSON Schema its entries are written under: shared with Everyone, as every device that follows the vault reads them',
	lens: 'The vault’s lenses, each joining two versions of a schema, both ways: shared with Everyone, as its schemas are'
});

/** The hint of the sealed table. */
const SEALED = 'What the acting vault doesn’t open, of a type it can’t read: no share it holds opens it, or its key hasn’t come here yet';

/** The kind a schema's records name, its `kind` const. @param {SchemaView} sc @returns {string | undefined} */
const kindOf = (sc) => parsed(sc.json)?.properties?.kind?.const;

/**
 * What a family's table holds, for its hint: its newest version's description, or an older one's, else the versions
 * its rows are written under.
 * @param {Family} f
 */
function about(f) {
	const said = [...f.schemas].reverse().map((sc) => parsed(sc.json)?.description).find((d) => typeof d === 'string' && d.trim());
	if (said) return said.trim();
	const joined = f.lenses.length ? `, ${f.lenses.length === 1 ? 'which a lens joins' : 'which lenses join'}` : '';
	return `Entries written under ${list(f.schemas.map((sc) => sc.title), 'or')}${joined}`;
}

/**
 * The tables of the vault's entries, of those shared with the same vaults alike (`s.byWho`) or of all of them, each
 * with its rows, as `s.opens` says the acting vault opens them. Every table is a schema's: one for each family of the
 * schemas this device holds (`families`, avenDB's own and the vault's lane), named for it, of the rows written under
 * one of its versions, or else whose kind or type its `kind` names; and one for each type no schema held here names,
 * named for the type (the lane's own schema and lens entries too, each JSON as written). A row the acting vault doesn't
 * open shows sealed in its type's table, or in `sealed` where it can't read its type either. Only the tables with rows
 * show, or while none has any, every family's, empty.
 * @param {Studio} s @param {string} only who they are shared with, in words, or '' for every entry
 * @returns {Table[]}
 */
export function tables(s, only) {
	const ids = only ? new Set(s.byWho.find((g) => g.words === only)?.ids ?? []) : null;
	const rows = s.rows.filter((r) => !ids || ids.has(r.audience));
	const fams = families(s.schemas, s.lenses);
	/** @type {Table[]} */
	const byFamily = fams.map((f) => ({ id: f.schemas[0].id, label: f.name, hint: about(f), family: f, rows: [] }));
	// two families of one name, as a vault's own version no lens joins to avenDB's: each by its id too
	const twice = new Set(byFamily.filter((t, i) => byFamily.findIndex((x) => x.label === t.label) !== i).map((t) => t.label));
	for (const t of byFamily) if (twice.has(t.label)) t.label = `${t.label} ${short(t.id)}`;
	/** each family's kinds, as its versions name them */
	const kinds = fams.map((f) => new Set(f.schemas.map(kindOf)));
	/** the family each schema is a version of, by its place */
	const version = new Map(fams.flatMap((f, i) => f.schemas.map((sc) => /** @type {[string, number]} */ ([sc.id, i]))));
	/** the table of the family whose versions name kind `kind`, if one does @param {string | null} kind */
	const ofKind = (kind) => (kind ? byFamily[kinds.findIndex((k) => k.has(kind))] : undefined);
	/** @type {Map<string, Table>} the tables of the types no schema here names, by type */
	const typed = new Map();
	/** the table of type `type`'s own @param {string} type */
	const own = (type) => {
		const t = typed.get(type) ?? { id: `type:${type}`, label: type, hint: '', family: null, rows: [] };
		typed.set(type, t);
		return t;
	};
	/** @type {Table} */
	const sealed = { id: 'sealed', label: 'sealed', hint: SEALED, family: null, rows: [] };
	/**
	 * The table of row `r`, which the acting vault opens: its family's, by the schemas it was written under, its kind
	 * among them first, else by its kind or its type; else its type's own.
	 * @param {RowView} r
	 */
	const written = (r) => {
		const under = r.authored.flatMap((id) => version.get(id) ?? []);
		const i = under.find((x) => kinds[x].has(r.kind)) ?? under[0];
		return (i === undefined ? null : byFamily[i]) ?? ofKind(r.kind) ?? ofKind(r.type) ?? own(r.type ?? r.kind);
	};
	const placed = new Map(rows.filter(s.opens).map((r) => [r, written(r)]));
	/** @type {Map<string, Table>} the table of each type, as the first row of it the acting vault opens says */
	const ofType = new Map();
	for (const [r, t] of placed) if (r.type && !ofType.has(r.type)) ofType.set(r.type, t);
	for (const r of rows) {
		const t = placed.get(r) ?? (r.type === null ? sealed : (ofType.get(r.type) ?? ofKind(r.type) ?? own(r.type)));
		t.rows.push(r);
	}
	for (const [type, t] of typed)
		t.hint =
			LANE[type] ??
			(t.rows.some(s.opens)
				? `Schema not held here: no schema this device holds names the kind of the entries of type “${type}”, so their columns are the fields their records hold`
				: `Entries of type “${type}” the acting vault doesn’t open, so it can’t tell the schema they were written under`);
	const listed = [...byFamily, ...[...typed.values()].sort((a, b) => a.label.localeCompare(b.label)), sealed];
	const filled = listed.filter((t) => t.rows.length);
	return filled.length ? filled : byFamily;
}

/** A JSON Schema field's type, as Postgres names its like. @param {any} p @returns {string} */
export function pgType(p) {
	if (!p || typeof p !== 'object') return 'jsonb';
	if ('const' in p) return 'literal';
	if (p.enum) return 'enum';
	if (p.type === 'string') {
		if (p['x-loro'] === 'text') return 'loro_text';
		if (p.format === 'date') return 'date';
		if (p.format === 'date-time') return 'timestamptz';
		return 'text';
	}
	if (p.type === 'integer') return 'int8';
	if (p.type === 'number') return 'float8';
	if (p.type === 'boolean') return 'bool';
	if (p.type === 'array') return p.items?.type === 'object' ? 'jsonb[]' : `${pgType(p.items)}[]`;
	return 'jsonb';
}

/** A value's type, for a field no schema names. @param {unknown} v */
export function typeOf(v) {
	if (typeof v === 'string') return 'text';
	if (typeof v === 'boolean') return 'bool';
	if (typeof v === 'number') return Number.isInteger(v) ? 'int8' : 'float8';
	if (Array.isArray(v)) return 'jsonb[]';
	return 'jsonb';
}

/** What a field holds, in words, for its header's hint. @param {any} p @returns {string} */
export function hint(p) {
	const parts = [];
	if ('const' in p) parts.push(`always ${JSON.stringify(p.const)}`);
	if (p.enum) parts.push(`one of ${p.enum.map((/** @type {unknown} */ x) => JSON.stringify(x)).join(', ')}`);
	if (p['x-loro'] === 'text') parts.push('text that merges as people type (a Loro text)');
	if (p.format) parts.push(`a ${p.format}`);
	if ('minimum' in p) parts.push(`at least ${p.minimum}`);
	if ('default' in p) parts.push(`default ${JSON.stringify(p.default)}`);
	return parts.join('; ');
}

/**
 * A schema's fields, in its order: each one's type, hint, whether it's required and its default, and an object's or a
 * list of objects' own fields.
 * @param {any} node
 * @returns {Field[]}
 */
export function fields(node) {
	const required = new Set(node?.required ?? []);
	return Object.entries(node?.properties ?? {}).map(([name, p]) => {
		const inner = p.type === 'object' ? p : p.type === 'array' && p.items?.type === 'object' ? p.items : null;
		const fallback = 'default' in p ? JSON.stringify(p.default) : null;
		return { name, type: pgType(p), hint: hint(p), required: required.has(name), fallback, fields: inner ? fields(inner) : [] };
	});
}

/** JSON, parsed: `null` if it isn't. @param {string} json */
export function parsed(json) {
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}

/**
 * A value as a grid's cell shows it: one line of it, and whether it is NULL, an empty text, a number, a boolean or JSON.
 * @param {unknown} v
 * @returns {{ text: string, kind: 'null' | 'empty' | 'num' | 'bool' | 'json' | 'text' }}
 */
export function cell(v) {
	if (v === null || v === undefined) return { text: 'NULL', kind: 'null' };
	if (v === '') return { text: 'EMPTY', kind: 'empty' };
	if (typeof v === 'string') return { text: clip(v.replace(/\s+/g, ' ')), kind: 'text' };
	if (typeof v === 'number') return { text: String(v), kind: 'num' };
	if (typeof v === 'boolean') return { text: String(v), kind: 'bool' };
	return { text: clip(JSON.stringify(v)), kind: 'json' };
}

/** @param {string} s */
const clip = (s) => (s.length > 160 ? `${s.slice(0, 160)}…` : s);

/**
 * The schemas as families: each the versions a chain of lenses joins, oldest first, with the lens from each to the
 * next; a schema no lens joins is a family of its own. A family is named by its newest version's title, less its
 * version.
 * @param {Map<string, SchemaView>} schemas @param {Map<string, LensView>} lenses
 * @returns {Family[]}
 */
export function families(schemas, lenses) {
	/** @type {Map<string, LensView>} */
	const next = new Map();
	/** @type {Map<string, LensView>} */
	const prev = new Map();
	for (const l of lenses.values())
		if (schemas.has(l.from) && schemas.has(l.to) && !next.has(l.from) && !prev.has(l.to)) {
			next.set(l.from, l);
			prev.set(l.to, l);
		}
	/** @type {Set<string>} */
	const seen = new Set();
	/** @type {Family[]} */
	const out = [];
	for (const s of schemas.values()) {
		if (seen.has(s.id)) continue;
		let first = s.id;
		const back = new Set([first]);
		for (let l = prev.get(first); l && !seen.has(l.from) && !back.has(l.from); l = prev.get(first)) back.add((first = l.from));
		/** @type {SchemaView[]} */
		const chain = [];
		/** @type {(LensView | null)[]} */
		const via = [];
		for (let at = /** @type {string | undefined} */ (first); at && !seen.has(at); at = next.get(at)?.to) {
			seen.add(at);
			chain.push(/** @type {SchemaView} */ (schemas.get(at)));
			via.push(next.get(at) ?? null);
		}
		const newest = chain.at(-1)?.title ?? '';
		out.push({ schemas: chain, lenses: via.slice(0, -1), name: newest.replace(/,?\s*v\d+$/i, '') || newest });
	}
	return out;
}

/**
 * @typedef {{ add: string } | { in: string, steps: Step[] } |
 *   { from: string[], to: string[], forward: [any, any][], backward: [any, any][] }} Step
 */

/** A lens's steps, as its JSON writes them. @param {any} json @returns {Step[]} */
export function steps(json) {
	return (Array.isArray(json?.steps) ? json.steps : []).flatMap((/** @type {any} */ s) => {
		if (typeof s?.add === 'string') return [{ add: s.add }];
		if (s?.in) return [{ in: s.in.field, steps: steps(s.in) }];
		if (s?.convert)
			return [{ from: s.convert.from ?? [], to: s.convert.to ?? [], forward: s.convert.forward ?? [], backward: s.convert.backward ?? [] }];
		return [];
	});
}

/** A lens rule's side, as an equation: `kind = "h1"`, `type = "heading", level = 1`. @param {any} side */
export const sideOf = (side) =>
	Object.entries(side ?? {})
		.map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
		.join(', ') || 'anything';

/** The kinds of edits, as the History view groups them. */
export const GROUPS = /** @type {const} */ ([
	['all', 'All', []],
	['writes', 'Writes & marks', ['write', 'mark']],
	['keys', 'Keys', ['keys']],
	['shares', 'Shares', ['share', 'revoke']],
	[
		'vaults',
		'Vaults & devices',
		['genesis', 'addOwner', 'removeOwner', 'setThreshold', 'addDevice', 'removeDevice', 'setRoot']
	]
]);

/** Each kind of edit, as its chip names it. */
export const KIND_NAMES = /** @type {Record<string, string>} */ ({
	genesis: 'genesis',
	addOwner: 'add owner',
	removeOwner: 'remove owner',
	setThreshold: 'threshold',
	addDevice: 'add device',
	removeDevice: 'remove device',
	setRoot: 'set root',
	share: 'share',
	revoke: 'revoke',
	write: 'write',
	mark: 'mark',
	keys: 'keys'
});

/** What a keep share has its device do, by its level. */
const KEEPING = /** @type {Record<string, (what: string) => string>} */ ({
	keepWhole: (what) => `keep ${what} whole`,
	keepOpened: (what) => `keep ${what} when opened`,
	keepNever: (what) => `never keep ${what}`
});

/**
 * What edit `edit` does, in words, naming what it touches as `s` names it; `edits` finds an edit by its id, a cap's
 * for its revocation or for the keep shares a mark names. A cap's slice is sealed in its edit: it shows in words where
 * the cap is in force and this browser reads it.
 * @param {SignedEdit} edit @param {Studio} s @param {(id: string) => SignedEdit | undefined} edits
 */
export function describe(edit, s, edits) {
	const f = edit.fields ?? {};
	/** whether `id` is one of a vault's devices, as a keep share's grantee is @param {string} id */
	const device = (id) => s.world.vaults.some((v) => v.devices.some((d) => d.id === id));
	/** a principal, or a cap's grantee: a vault's id, a device's for a keep share, or "everyone" @param {any} p */
	const who = (p) => {
		if (!p) return 'nobody';
		if (p === EVERYONE) return 'everyone';
		if (typeof p === 'string') return device(p) ? s.signer(p) : s.vaultName(p);
		return p.vault ? s.vaultName(p.vault) : s.signer(p.signer);
	};
	/**
	 * where vault `over` is named, beside the vault `actor` that acts on it
	 * @param {string} actor @param {string} over
	 */
	const inside = (actor, over) => (actor === over ? '' : ` in ${s.vaultName(over)}`);
	/**
	 * the share the share edit `id`, of fields `c`, gives: to whom, at what level, and on what, in words where it is in
	 * force and this browser reads its slice, else by its size alone @param {string} id @param {any} c
	 */
	const granted = (id, c) => {
		const live = s.world.shares.find((x) => x.id === id);
		const level = live ? levelName(live, s.world) : roleGroup(s.world, c.level);
		const sealed = `a filter (${size(c.sealed ?? 0)} sealed)`;
		const read = live?.slice ? whereWords(live.slice.where, s.world) : sealed;
		return { to: who(c.who), level, what: c.wide || live?.whole ? 'everything' : read };
	};
	/** a key of the schedule, by its name @param {any} k */
	const key = (k) => {
		if (k?.signer) return `${s.signer(k.signer)}’s own key`;
		if (k?.seed) return `${s.vaultName(k.seed)}’s seed`;
		if (k?.share) return `the key of ${s.share(k.share)}`;
		if (k?.audience) {
			const shared = s.sharedIn(k.audience, k.vault);
			return `the key of ${shared ? `the entries shared with ${shared}` : `some entries of ${s.vaultName(k.vault)}`}`;
		}
		return k?.entry ? `the key of ${s.entry(k.entry)}` : 'a key';
	};
	switch (edit.kind) {
		case 'genesis': {
			const owners = list((f.owners ?? []).map(who));
			const agree = f.threshold > 1 ? `, ${f.threshold} of them to agree` : '';
			return `Founds ${s.vaultName(edit.id)}, a ${f.vaultKind} vault${owners ? `, owned by ${owners}` : ''}${agree}`;
		}
		case 'addOwner':
			return `Makes ${who(f.owner)} an owner of ${s.vaultName(f.vault)}`;
		case 'removeOwner':
			return `Takes ${who(f.owner)} off ${s.vaultName(f.vault)}’s owners`;
		case 'setThreshold':
			return `${s.vaultName(f.vault)} now needs ${count(f.threshold, 'owner')} to agree`;
		case 'addDevice':
			return `Links ${s.signer(f.device)} to ${s.vaultName(f.vault)}`;
		case 'removeDevice':
			return `Unlinks ${s.signer(f.device)} from ${s.vaultName(f.vault)}`;
		case 'setRoot':
			return f.root ? `Makes ${s.signer(f.root)} the root of ${s.vaultName(f.vault)}` : `Clears ${s.vaultName(f.vault)}’s root`;
		case 'share': {
			const g = granted(edit.id, f);
			const where = inside(f.issuer, f.over);
			if (KEEPING[f.level]) return `${s.vaultName(f.issuer)} has ${g.to} ${KEEPING[f.level](g.what)}${where}`;
			const through = f.parent ? `, through its own share ${short(f.parent)}` : '';
			return `${s.vaultName(f.issuer)} shares ${g.what}${where} with ${g.to} as ${g.level}${through}`;
		}
		case 'revoke': {
			const c = edits(f.share);
			if (!c) return `${s.vaultName(f.actor)} revokes share ${short(f.share)}`;
			const g = granted(c.id, c.fields);
			const where = inside(f.actor, c.fields.over);
			if (KEEPING[c.fields.level])
				return `${s.vaultName(f.actor)} no longer has ${g.to} ${KEEPING[c.fields.level](g.what)}${where}`;
			return `${s.vaultName(f.actor)} revokes ${g.to}’s share of ${g.what}${where} as ${g.level}`;
		}
		case 'write': {
			const line = f.starts ? ', proposing a change' : f.line ? ', on a proposal' : '';
			const made = f.create
				? `creates ${s.entry(f.entry)}, shared with ${s.through(f.create, f.vault)}`
				: `writes ${s.entry(f.entry)}${line}`;
			/** @type {{ root: string, size: number }[]} */
			const files = f.files ?? [];
			const bytes = files.reduce((n, x) => n + x.size, 0);
			const bringing = files.length ? `, bringing ${count(files.length, 'file')} (${size(bytes)})` : '';
			return `${s.vaultName(f.actor)} ${made}${bringing}: ${size(f.sealed)} sealed`;
		}
		case 'mark': {
			const entry = s.entry(f.entry);
			/** @type {string[]} */
			const parts = [];
			if (f.shares) parts.push(`is now shared with ${s.through(f.shares, f.vault)}`);
			if (f.wants) {
				/** @type {string[]} */
				const wants = f.wants;
				const grantee = (/** @type {string} */ id) =>
					edits(id)?.fields.who ?? s.world.shares.find((c) => c.id === id)?.who;
				const devices = [...new Set(wants.map(grantee).filter(Boolean))];
				const by = devices.length
					? list(devices.map(s.signer))
					: wants.length
						? count(wants.length, 'device')
						: 'no device';
				parts.push(`is wanted by ${by}`);
			}
			return `${entry[0].toUpperCase()}${entry.slice(1)} ${parts.join(', and ') || 'is marked as its shares say'}`;
		}
		case 'keys': {
			const to = f.boxes?.length ? `, sealed to ${count(f.boxes.length, 'holder')}` : '';
			const at = f.key?.epoch ? `Rotates ${key(f.key)}` : `Makes ${key(f.key)}`;
			return `${at}${to}${f.public ? ', announcing its public half' : ''}${f.clear ? ', in the clear: everyone reads it' : ''}`;
		}
		default:
			return edit.kind;
	}
}
