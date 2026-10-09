/*
 * What the database studio's views share (Database.svelte and the views it shows): a vault's database as the acting
 * vault opens it (`studio`), its tables, a JSON Schema field's type as Postgres would name its like, a value as a
 * grid's cell shows it, the families of schemas the lenses join version by version, a lens's steps, and what each
 * signed edit of the database's history does, in words. The device decides all of it (avendb-browser's
 * `Device::database` and `Device::history`); these only lay it out.
 */
import { allows, count, list, nameOf, short } from './vaults.js';

/**
 * @typedef {{ id: string, title: string, json: string }} SchemaView
 * @typedef {{ id: string, title: string, from: string, to: string, json: string }} LensView
 * @typedef {{ entry: string, kind: string, tag: 'card' | 'profile' | null, title: string | null, record: any,
 *   authored: string[], edits: number, held: number, lines: number, proposals: (string | null)[], epoch: number,
 *   bytes: number, author: string | null, actor: string | null, public: boolean,
 *   roles: Record<string, import('./vaults.js').Role> }} RowView
 * @typedef {{ founded: number, writes: number, checkpoints: number, keys: number, grants: number, revokes: number,
 *   published: number }} EditCounts
 * @typedef {{ id: string, public: boolean, epoch: number, edits: EditCounts, schemas: SchemaView[], lenses: LensView[],
 *   rows: RowView[] }} SpaceView
 * @typedef {{ vault: string, held: { edits: number, keys: number },
 *   builtIn: { schemas: SchemaView[], lenses: LensView[] }, spaces: SpaceView[] }} Db
 * @typedef {{ signer: string, by: 'device' | 'passkey', classical: 'ed25519' | 'p256', batch: number | null,
 *   pq: number | null }} SigView
 * @typedef {{ n: number, id: string, kind: string, fields: any, author: string, cosigners: string[], sigs: SigView[],
 *   parents: string[], depth: number, bytes: number, vaults: string[], counted: boolean | null }} SignedEdit
 * @typedef {{ name: string, type: string, hint: string, required: boolean, fallback: string | null,
 *   fields: Field[] }} Field
 * @typedef {{ schemas: SchemaView[], lenses: (LensView | null)[], name: string }} Family
 * @typedef {{ id: string, label: string, hint: string, family: string | null, rows: (RowView & { space: string })[] }} Table
 */

/**
 * Vault `vault`'s database as the page shows it to vault `actor`: what this browser holds of it, the schemas and
 * lenses the acting vault may read (the app's own, then what the spaces it reads publish), and how to name what the
 * views show: vaults, devices and passkeys, spaces, entries, schemas.
 * @param {import('./vaults.js').WorldView} world @param {Db | null} db @param {string} vault @param {string} actor
 */
export function studio(world, db, vault, actor) {
	const byId = new Map(world.vaults.map((v) => [v.id, v]));
	const here = byId.get(vault);
	const as = byId.get(actor);
	const spaces = db?.vault === vault ? db.spaces : [];
	/** whether the acting vault reads space `id`: its lane's schemas show only to who reads it */
	const readsSpace = (/** @type {string} */ id) => {
		const s = world.spaces.find((x) => x.id === id);
		return !!s && (s.public || allows(s.roles[actor], 'read'));
	};
	/** Whether the acting vault opens row `r`, and this browser holds its record. @param {RowView} r */
	const opens = (r) => (r.public || allows(r.roles[actor], 'read')) && r.record !== null;
	const read = spaces.filter((s) => readsSpace(s.id));
	const schemas = byIds([...(db?.builtIn.schemas ?? []), ...read.flatMap((s) => s.schemas)]);
	const lenses = byIds([...(db?.builtIn.lenses ?? []), ...read.flatMap((s) => s.lenses)]);
	/** the rows the acting vault opens, by the schemas they were written under */
	const uses = new Map();
	for (const r of spaces.flatMap((s) => s.rows).filter(opens)) for (const id of r.authored) uses.set(id, (uses.get(id) ?? 0) + 1);

	/** The vault or signer `id` names, as a person reads it: a vault, a device by its name, a vault's passkey. */
	const signer = (/** @type {string} */ id) => {
		for (const v of world.vaults) {
			const d = v.devices.find((d) => d.id === id);
			if (d) return d.name ?? `a device of ${nameOf(v)}`;
			if (v.root === id) return `${nameOf(v)}’s passkey`;
		}
		return `key ${short(id)}`;
	};
	/** Space `id`, by its vault: "Home" or "Space 2" in this vault, "avenALICE’s home" in another. */
	const space = (/** @type {string} */ id) => {
		const s = world.spaces.find((x) => x.id === id);
		if (!s) return `space ${short(id)}`;
		const founder = byId.get(s.founder);
		const n = world.spaces.filter((x) => x.founder === s.founder).indexOf(s);
		const own = founder?.home === id ? 'home' : `space ${n + 1}`;
		return s.founder === vault ? own[0].toUpperCase() + own.slice(1) : `${nameOf(founder)}’s ${own}`;
	};
	/** Entry `entry` of space `sp`: its title in quotes if the acting vault reads it, else its id. */
	const entry = (/** @type {string} */ sp, /** @type {string} */ entry) => {
		const row = spaces.find((s) => s.id === sp)?.rows.find((r) => r.entry === entry);
		if (row && opens(row) && row.title) return `“${row.title}”`;
		const item = world.spaces.find((s) => s.id === sp)?.items.find((i) => i.entry === entry);
		if (item && item.kind !== 'sealed' && (item.public || allows(item.roles[actor], 'read')) && item.title)
			return `“${item.title}”`;
		return `entry ${short(entry)}`;
	};
	/** A schema by its id: its title, or the start of its id. @param {string} id */
	const schemaName = (id) => schemas.get(id)?.title ?? `schema ${short(id)}`;

	return { byId, here, as, spaces, opens, schemas, lenses, uses, signer, space, entry, schemaName, vaultName: (/** @type {string} */ id) => nameOf(byId.get(id)) };
}

/** @typedef {ReturnType<typeof studio>} Studio */

/** @template {{ id: string }} T @param {T[]} all @returns {Map<string, T>} */
function byIds(all) {
	const map = new Map();
	for (const x of all) if (!map.has(x.id)) map.set(x.id, x);
	return map;
}

/** The tables of a vault's database: its entries, by what they are, as the acting vault sees them. */
const TABLES = /** @type {const} */ ([
	['notes', 'Notes: Markdown documents', 'document'],
	['todos', 'Todos', 'todo'],
	['device_cards', 'Each device’s card: a document in its vault’s home, named for the device', 'document'],
	['vault_profiles', 'The vault’s profile: a document in its home, titled with its name', 'document'],
	['records', 'Records of any other kind', null],
	['sealed', 'What the acting vault holds no cap to read: its ciphertext, as avenDB’s server holds it', null]
]);

/**
 * The tables of the spaces `spaces` (one of them, or all), each with its rows, as `s.opens` says the acting vault
 * opens them: `records` only when it has any.
 * @param {Studio} s @param {string} only a space's id, or '' for every space
 * @returns {Table[]}
 */
export function tables(s, only) {
	const rows = s.spaces.filter((sp) => !only || sp.id === only).flatMap((sp) => sp.rows.map((r) => ({ ...r, space: sp.id })));
	/** @param {RowView} r */
	const table = (r) =>
		!s.opens(r)
			? 'sealed'
			: r.tag === 'card'
				? 'device_cards'
				: r.tag === 'profile'
					? 'vault_profiles'
					: r.kind === 'document'
						? 'notes'
						: r.kind === 'todo'
							? 'todos'
							: 'records';
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
	['writes', 'Writes', ['write']],
	['checkpoints', 'Checkpoints', ['checkpoint']],
	['keys', 'Keys', ['keys']],
	['caps', 'Caps', ['grant', 'revoke']],
	['vaults', 'Vaults & devices', ['genesis', 'addOwner', 'removeOwner', 'setThreshold', 'addDevice', 'removeDevice', 'setRoot']],
	['spaces', 'Spaces & schemas', ['foundSpace', 'publish']]
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
	foundSpace: 'found space',
	grant: 'grant',
	revoke: 'revoke',
	write: 'write',
	keys: 'keys',
	publish: 'publish',
	checkpoint: 'checkpoint'
});

/** What a role lets its holder do, as a verb. */
const VERBS = /** @type {Record<string, string>} */ ({ relay: 'relay', read: 'read', write: 'write', owner: 'own' });

/**
 * What edit `edit` does, in words, naming what it touches as `s` names it; `grantOf` finds a grant's edit, for a
 * revocation.
 * @param {SignedEdit} edit @param {Studio} s @param {(id: string) => SignedEdit | undefined} grantOf
 */
export function describe(edit, s, grantOf) {
	const f = edit.fields ?? {};
	/** @param {any} p */
	const who = (p) => (!p ? 'nobody' : p === 'public' ? 'everyone' : p.vault ? s.vaultName(p.vault) : s.signer(p.signer));
	/** @param {any} sc */
	const scope = (sc) => (sc?.entry ? `${s.entry(sc.space, sc.entry)} in ${s.space(sc.space)}` : s.space(sc?.space));
	/** @param {any} k */
	const key = (k) => (k?.vault ? `${s.vaultName(k.vault)}’s vault key` : k?.entry ? `the key of ${s.entry(k.space, k.entry)}` : `the key of ${s.space(k?.space)}`);
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
		case 'foundSpace':
			return `${s.vaultName(f.actor)} founds ${s.space(edit.id)}`;
		case 'grant':
			return `Lets ${who(f.grantee)} ${VERBS[f.role] ?? f.role} ${scope(f.scope)}`;
		case 'revoke': {
			const g = grantOf(f.grant)?.fields;
			return g ? `Revokes ${who(g.grantee)}’s right to ${VERBS[g.role] ?? g.role} ${scope(g.scope)}` : `Revokes grant ${short(f.grant)}`;
		}
		case 'write': {
			const line = f.starts ? ', proposing a change' : f.line ? ', on a proposal' : '';
			return `${s.vaultName(f.actor)} writes ${s.entry(f.space, f.entry)}${line}: ${size(f.sealed)} sealed`;
		}
		case 'keys': {
			const to = f.boxes?.length ? `, sealed to ${count(f.boxes.length, 'holder')}` : '';
			return `${f.epoch ? `Rotates ${key(f.key)} to epoch ${f.epoch}` : `Makes ${key(f.key)}`}${to}`;
		}
		case 'publish':
			return `Publishes ${f.title ? `“${f.title}”` : `a blob of ${size(f.bytes)}`} into ${s.space(f.space)}`;
		case 'checkpoint':
			return `Checkpoints ${s.entry(f.space, f.entry)}, covering ${count(f.covers?.length ?? 0, 'write')}`;
		default:
			return edit.kind;
	}
}
