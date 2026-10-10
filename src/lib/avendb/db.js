/*
 * What the database studio's views share (Database.svelte and the views it shows): a vault's database as the acting
 * vault opens it (`studio`), its tables, a JSON Schema field's type as Postgres would name its like, a value as a
 * grid's cell shows it, the families of schemas the lenses join version by version, a lens's steps, and what each
 * signed edit of the database's history does, in words. The device decides all of it (avendb-browser's
 * `Device::database` and `Device::history`); these only lay it out.
 */
import {
	allows,
	capWords,
	cellWords,
	count,
	granteeOf,
	list,
	nameOf,
	reaches,
	ROLES,
	short,
	singular,
	sliceWords
} from './vaults.js';

/**
 * @typedef {{ id: string, title: string, json: string }} SchemaView
 * @typedef {{ id: string, title: string, from: string, to: string, json: string }} LensView
 * @typedef {{ entry: string, type: string | null, tags: string[] | null, kind: string, title: string | null,
 *   record: any, authored: string[], edits: number, held: number, lines: number, proposals: (string | null)[],
 *   cell: string, generation: number, bytes: number, author: string | null, actor: string | null, public: boolean,
 *   roles: Record<string, import('./vaults.js').Role> }} RowView
 * @typedef {{ id: string, caps: string[], generation: number, entries: number }} CellRow
 * @typedef {{ founded: number, writes: number, moves: number, checkpoints: number, keys: number, caps: number,
 *   revokes: number, published: number }} EditCounts
 * @typedef {{ vault: string, held: { edits: number, keys: number },
 *   builtIn: { schemas: SchemaView[], lenses: LensView[] }, seed: number, edits: EditCounts, schemas: SchemaView[],
 *   lenses: LensView[], cells: CellRow[], rows: RowView[] }} Db
 * @typedef {{ signer: string, by: 'device' | 'passkey', classical: 'ed25519' | 'p256', batch: number | null,
 *   pq: number | null }} SigView
 * @typedef {{ n: number, id: string, kind: string, fields: any, author: string, cosigners: string[], sigs: SigView[],
 *   parents: string[], depth: number, bytes: number, vaults: string[], counted: boolean | null }} SignedEdit
 * @typedef {{ name: string, type: string, hint: string, required: boolean, fallback: string | null,
 *   fields: Field[] }} Field
 * @typedef {{ schemas: SchemaView[], lenses: (LensView | null)[], name: string }} Family
 * @typedef {{ id: string, label: string, hint: string, family: string | null, rows: RowView[] }} Table
 */

/**
 * Vault `vault`'s database as the page shows it to vault `actor`: what this browser holds of it, its cells, the schemas
 * and lenses the acting vault may read (the app's own, then what the vault's lane publishes, to who holds anything in
 * it), and how to name what the views show: vaults, devices and passkeys, cells, caps, entries, schemas.
 * @param {import('./vaults.js').WorldView} world @param {Db | null} db @param {string} vault @param {string} actor
 */
export function studio(world, db, vault, actor) {
	const byId = new Map(world.vaults.map((v) => [v.id, v]));
	const here = byId.get(vault);
	const as = byId.get(actor);
	const held = db?.vault === vault ? db : null;
	const rows = held?.rows ?? [];
	const cells = held?.cells ?? [];
	/** Whether the acting vault opens row `r`, and this browser holds its record. @param {RowView} r */
	const opens = (r) => (r.public || allows(r.roles[actor], 'read')) && r.record !== null;
	const lane = reaches(world, vault, actor);
	const schemas = byIds([...(db?.builtIn.schemas ?? []), ...(lane ? (held?.schemas ?? []) : [])]);
	const lenses = byIds([...(db?.builtIn.lenses ?? []), ...(lane ? (held?.lenses ?? []) : [])]);
	/** the rows the acting vault opens, by the schemas they were written under */
	const uses = new Map();
	for (const r of rows.filter(opens)) for (const id of r.authored) uses.set(id, (uses.get(id) ?? 0) + 1);

	/** The vault or signer `id` names, as a person reads it: a vault, a device by its name, a vault's passkey. */
	const signer = (/** @type {string} */ id) => {
		for (const v of world.vaults) {
			const d = v.devices.find((d) => d.id === id);
			if (d) return d.name ?? `a device of ${nameOf(v)}`;
			if (v.root === id) return `${nameOf(v)}’s passkey`;
		}
		return `key ${short(id)}`;
	};
	/** Cap `id` in words, where it is in force and this browser knows it. @param {string} id */
	const cap = (id) => {
		const c = world.caps.find((x) => x.id === id);
		return c ? capWords(c, world) : `cap ${short(id)}`;
	};
	/** Cap `id`'s slice in words, where it is in force and this browser reads it. @param {string} id */
	const slice = (id) => {
		const c = world.caps.find((x) => x.id === id);
		return c?.slice ? sliceWords(c.slice, world) : null;
	};
	/** Cell `id` in words: what reaches it. @param {string} id */
	const cell = (id) => cellWords(world.cells.find((x) => x.id === id), world);
	/** Cell `id`, short, as a grid's cell names it: "its own", or the roles the caps that reach it give. @param {string} id */
	const cellName = (id) => {
		const caps = world.cells.find((x) => x.id === id)?.caps ?? cells.find((x) => x.id === id)?.caps;
		if (!caps) return `cell ${short(id)}`;
		if (!caps.length) return 'its own';
		const named = caps.map((id) => {
			const c = world.caps.find((x) => x.id === id);
			return c ? `${granteeOf(c, world)} ${ROLES[c.role]}` : 'a cap';
		});
		return list(named);
	};
	/** Entry `entry`: its title in quotes if the acting vault reads it, else what it is and its id. @param {string} entry */
	const entry = (entry) => {
		const row = rows.find((r) => r.entry === entry);
		if (row && opens(row) && row.title) return `“${row.title}”`;
		const e = world.entries.find((x) => x.entry === entry);
		if (e && e.kind !== 'sealed' && (e.public || allows(e.roles[actor], 'read')) && e.title) return `“${e.title}”`;
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
		opens,
		schemas,
		lenses,
		uses,
		signer,
		cap,
		slice,
		cell,
		cellName,
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

/** The tables of a vault's database: its entries, by their type, as the acting vault sees them. */
const TABLES = /** @type {const} */ ([
	['notes', 'Notes: Markdown documents', 'document'],
	['todos', 'Todos', 'todo'],
	['device_cards', 'Each device’s card: a document of its vault, named for the device', 'document'],
	['vault_profiles', 'The vault’s profile: a document of it, titled with its name', 'document'],
	['records', 'Entries of any other type', null],
	['sealed', 'What the acting vault holds no cap to read: its ciphertext, as avenDB’s server holds it', null]
]);

/** The table of each type. */
const BY_TYPE = /** @type {Record<string, string>} */ ({ note: 'notes', todo: 'todos', card: 'device_cards', profile: 'vault_profiles' });

/**
 * The tables of the vault's entries, of one cell or of all of them, each with its rows, as `s.opens` says the acting
 * vault opens them: `records` only when it has any.
 * @param {Studio} s @param {string} only a cell's id, or '' for every cell
 * @returns {Table[]}
 */
export function tables(s, only) {
	const rows = s.rows.filter((r) => !only || r.cell === only);
	/** @param {RowView} r */
	const table = (r) => (!s.opens(r) ? 'sealed' : (BY_TYPE[r.type ?? ''] ?? 'records'));
	return TABLES.map(([id, hint, family]) => ({ id, label: id, hint, family, rows: rows.filter((r) => table(r) === id) })).filter(
		(t) => t.id !== 'records' || t.rows.length
	);
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

/** A size in bytes, as a person reads it. @param {number} n */
export const size = (n) => (n < 1000 ? `${n} B` : n < 1e6 ? `${(n / 1e3).toFixed(1)} kB` : `${(n / 1e6).toFixed(1)} MB`);

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

/** The family a table's rows belong to: the one whose schemas' `kind` is `kind`. @param {Family[]} all @param {string} kind */
export const familyOf = (all, kind) => all.find((f) => f.schemas.some((s) => parsed(s.json)?.properties?.kind?.const === kind));

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
	['writes', 'Writes & moves', ['write', 'move']],
	['checkpoints', 'Checkpoints', ['checkpoint']],
	['keys', 'Keys', ['keys']],
	['caps', 'Caps', ['cap', 'revoke']],
	['vaults', 'Vaults & devices', ['genesis', 'addOwner', 'removeOwner', 'setThreshold', 'addDevice', 'removeDevice', 'setRoot']],
	['schemas', 'Schemas', ['publish']]
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
	cap: 'cap',
	revoke: 'revoke',
	write: 'write',
	move: 'move',
	keys: 'keys',
	publish: 'publish',
	checkpoint: 'checkpoint'
});

/** What a role lets its holder do, as a verb. */
const VERBS = /** @type {Record<string, string>} */ ({ relay: 'relay', read: 'read', write: 'write', owner: 'own' });

/**
 * What edit `edit` does, in words, naming what it touches as `s` names it; `edits` finds an edit by its id, a cap's
 * for its revocation. A cap's slice is sealed in its edit: it shows in words where the cap is in force and this browser
 * reads it.
 * @param {SignedEdit} edit @param {Studio} s @param {(id: string) => SignedEdit | undefined} edits
 */
export function describe(edit, s, edits) {
	const f = edit.fields ?? {};
	/** a principal, or a cap's grantee: a vault's id or "public" @param {any} p */
	const who = (p) =>
		!p ? 'nobody' : p === 'public' ? 'everyone' : typeof p === 'string' ? s.vaultName(p) : p.vault ? s.vaultName(p.vault) : s.signer(p.signer);
	/** what the cap edit `id`, of fields `c`, gives: its slice in words, or that it is sealed @param {string} id @param {any} c */
	const reach = (id, c) =>
		c.wide ? `the whole of ${s.vaultName(c.over)}` : `${s.slice(id) ?? `a slice (${size(c.sealed ?? 0)} sealed)`} of ${s.vaultName(c.over)}`;
	/** a key of the schedule, by its name @param {any} k */
	const key = (k) =>
		k?.signer
			? `${s.signer(k.signer)}’s own key`
			: k?.seed
				? `${s.vaultName(k.seed)}’s seed`
				: k?.cap
					? `the key of ${s.cap(k.cap)}`
					: k?.cell
						? `the key of the cell ${s.cellName(k.cell)} of ${s.vaultName(k.vault)}`
						: k?.entry
							? `the key of ${s.entry(k.entry)}`
							: 'a key';
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
		case 'cap': {
			const through = f.parent ? `, through its own cap ${short(f.parent)}` : '';
			return `${s.vaultName(f.issuer)} lets ${who(f.grantee)} ${VERBS[f.role] ?? f.role} ${reach(edit.id, f)}${through}`;
		}
		case 'revoke': {
			const c = edits(f.cap);
			if (!c) return `${s.vaultName(f.actor)} revokes cap ${short(f.cap)}`;
			const right = `${VERBS[c.fields.role] ?? c.fields.role} ${reach(c.id, c.fields)}`;
			return `${s.vaultName(f.actor)} revokes ${who(c.fields.grantee)}’s right to ${right}`;
		}
		case 'write': {
			const line = f.starts ? ', proposing a change' : f.line ? ', on a proposal' : '';
			const made = f.create
				? `creates ${s.entry(f.entry)} in ${f.create.length ? `the cell of ${list(f.create.map(s.cap))}` : 'the vault’s own cell'}`
				: `writes ${s.entry(f.entry)}${line}`;
			return `${s.vaultName(f.actor)} ${made}: ${size(f.sealed)} sealed`;
		}
		case 'move':
			return `Moves ${s.entry(f.entry)} to ${f.to?.length ? `the cell of ${list(f.to.map(s.cap))}` : 'the vault’s own cell'}`;
		case 'keys': {
			const to = f.boxes?.length ? `, sealed to ${count(f.boxes.length, 'holder')}` : '';
			const at = f.key?.generation ? `Rotates ${key(f.key)} to generation ${f.key.generation}` : `Makes ${key(f.key)}`;
			return `${at}${to}${f.public ? ', announcing its public half' : ''}${f.clear ? ', in the clear: everyone reads it' : ''}`;
		}
		case 'publish':
			return `Publishes ${f.title ? `“${f.title}”` : `a blob of ${size(f.bytes)}`} into ${s.vaultName(f.vault)}’s lane`;
		case 'checkpoint':
			return `Checkpoints ${s.entry(f.entry)}, covering ${count(f.covers?.length ?? 0, 'write')}`;
		default:
			return edit.kind;
	}
}
