/*
 * What avenDB's vault screens share: a vault's name, initials and colour, the kinds as a person reads them, a share
 * in words (who · level · what), who an entry is shared with, a signer's name, a size, and a refusal's reason. A vault
 * is a flat library: its entries are in it directly, each with a type and tags, and every right is a share: a named
 * group of JSON ops on a slice of it, a query's `where` over their labels (avendb's `slice` and `rules`), or one of its
 * owners or devices. The rules are the device's alone: what each vault may do the page reads from its answers (the
 * world's `acting`, each share's `group`, `whole`, `reads` and `gets`, each entry's `readers`, `writers` and
 * `sharers`, the `shares` op's rows, and `may`), and these only word them.
 */

/** @typedef {'human' | 'coop' | 'aven'} Kind */
/**
 * A share's level, the class of its strongest op (avendb's `words::level_name`); a keep share's, its mode, which grants
 * nothing: it says only what one of the vault's devices keeps of it.
 * @typedef {'relay' | 'backup' | 'read' | 'write' | 'owner' | 'keepWhole' | 'keepOpened' | 'keepNever'} Role
 */
/** @typedef {{ id: string, name?: string | null, me: boolean }} DeviceView */
/**
 * What the person may do in a vault, as the device says: the vault they act as in it (the vault itself where theirs
 * owns it, else the vault of theirs that holds the strongest share over it, else their own), whether that vault
 * reaches anything of it, and whether it may share some of it on.
 * @typedef {{ as: string, reaches: boolean, shares: boolean }} Acting
 */
/**
 * @typedef {{ id: string, kind: Kind, name: string | null,
 *   owners: ({ vault: string } | { signer: string, recovery: boolean })[],
 *   threshold: number, root: string | null, devices: DeviceView[], via: string[] | null, acting: Acting }} VaultView
 */
/**
 * A test of a label: an object of one field (avendb's `slice::Atom`).
 * @typedef {{ type: string[] } | { author: string[] } | { entry: string[] } | { created: [number, number] } |
 *   { tag: string } | { noTag: string[] } | { onlyTags: string[] }} Atom
 */
/**
 * What a cap picks: a query's `where` of labels alone (avendb's `slice::Selector::to_json`); `{ all: [] }` is the whole
 * vault, `{ any: [] }` nothing.
 * @typedef {Atom | { all: Where[] } | { any: Where[] }} Where
 */
/**
 * An op a share names (avendb's `rules`, avendb/docs/ARCHITECTURE.md §8): relay, back up or read its slice; add
 * entries; change a value at or under a path whose steps may be "*" (any one field or row), only to some values; add,
 * delete or reorder rows; ask for tags (any, or those listed); start proposals; merge, on the main line or on
 * proposals; share it on.
 * @typedef {{ op: 'relay' | 'backup' | 'read' | 'create' | 'set' | 'insert' | 'remove' | 'move' | 'tag' | 'propose' |
 *   'merge' | 'share', path?: (string | { id: number })[], to?: (string | number | boolean | null)[],
 *   on?: 'main' | 'proposals', tags?: string[] }} Op
 */
/**
 * A cap as its readers read it: its name, what it picks, its ops, and those of the caps it rests on, root first
 * (`above`), which every write through it keeps to as well (avendb's `slice::Slice::to_json`).
 * @typedef {{ name: string, where: Where, ops: Op[], above: Op[][] }} Slice
 */
/**
 * A built-in group of ops, as the share dialog offers it (avendb's `rules::Group`), with its level.
 * @typedef {{ name: string, hint: string, ops: Op[], everyone: boolean, level: Role }} Group
 */
/**
 * A share in force: `grantee` a vault's id, `"everyone"`, or for a keep share one of its vault's devices; `role` its
 * level; `slice` `null` where the device doesn't read it. As the device says: `group` the built-in group it is, if any;
 * `whole` whether it is on the whole vault; `reads` whether its grantee reads what it reaches; `gets` whether its
 * grantee's devices receive it. A keep share does neither: it never counts as access.
 * @typedef {{ id: string, over: string, issuer: string, grantee: string, role: Role, wide: boolean,
 *   parent: string | null, chain: string[], slice: Slice | null, revokers: string[], entries: string[],
 *   group: string | null, whole: boolean, reads: boolean, gets: boolean }} CapView
 */
/**
 * A device that gets a cell's edits: the vault it gets them through, whether it opens them, and the role it holds
 * them by, where the device's world says (`"backup"` for one that only keeps an encrypted copy).
 * @typedef {{ device: string, through: string, opens: boolean, role?: Role }} Syncing
 */
/**
 * @typedef {{ id: string, vault: string, caps: string[], generation: number, entries: string[], readers: string[],
 *   public: boolean, syncs: Syncing[] }} CellView
 */
/**
 * An entry as the device shows it: `readers`, `writers` and `sharers` the vaults that read it, change it and may share
 * it on, its own vault first; `syncedTo` the devices that hold it; `title` a schema's title or a lens's name for those.
 * @typedef {{ entry: string, vault: string, by: string, type: string | null, tags: string[] | null,
 *   created: number | null, cell: string, public: boolean, roles: Record<string, Role>,
 *   readers: string[], writers: string[], sharers: string[], syncedTo: string[],
 *   kind: 'note' | 'todo' | 'file' | 'schema' | 'lens' | 'sealed', title: string | null, text: string | null,
 *   status: 'open' | 'doing' | 'done' | null, variantOf: string | null, deleted: boolean, edits: number,
 *   proposals: number, media: string | null, files: import('./files.js').FileView[] }} EntryView
 */
/**
 * The device's world (avendb-browser's `World::to_json`): `ownsAven` whether the person's vault owns an aven,
 * `backsUp` whether avenDB's server keeps an encrypted copy of it, `null` where it holds no share on it.
 * @typedef {{ me: string, mine: string, recovery: string | null, vaults: VaultView[], caps: CapView[],
 *   cells: CellView[], entries: EntryView[], groups: Group[], ownsAven: boolean, backsUp: boolean | null }} WorldView
 */
/**
 * What the device answers `may` for one op: it would make it, it would once those signers approve it, or why not.
 * @typedef {true | { approve: { signers: string[] } } | { refused: string, why: string }} Verdict
 */
/**
 * A share over a vault as the `shares` op lists them, owners and devices among them: who holds it, its level and
 * group, what it is on (`"everything"`, a `where`, or `null` where the device doesn't read it), how many entries it
 * reaches now, and whether the acting vault may revoke it.
 * @typedef {{ kind: 'owner' | 'device' | 'grant' | 'keep', id: string | null, over: string,
 *   who: { vault: string } | { signer: string } | { device: string } | 'everyone', level: Role | 'actsFor',
 *   group: string | null, name: string | null, what: 'everything' | Where | null, ops: Op[] | null,
 *   above: Op[][] | null, issuer: string | null, parent: string | null, reaches: number, recovery: boolean,
 *   root: boolean, revoke: Verdict }} ShareRow
 */
/**
 * Every share over vault `over`, for vault `as`: whether it may share some of it on, and the rows.
 * @typedef {{ over: string, as: string, share: Verdict, rows: ShareRow[] }} Shares
 */

/** The levels in the order the page lists them: the strongest first, then the keep levels, which grant nothing. */
export const STRONGEST = /** @type {const} */ ([
	'owner',
	'write',
	'read',
	'backup',
	'relay',
	'keepWhole',
	'keepOpened',
	'keepNever'
]);

/** Where level `role` comes in `STRONGEST`, any other last. @param {string} role */
export const order = (role) => {
	const at = STRONGEST.indexOf(/** @type {Role} */ (role));
	return at < 0 ? STRONGEST.length : at;
};

/** The kinds, as a person reads them. */
export const KINDS = /** @type {const} */ ({ human: 'Human vault', coop: 'Coop vault', aven: 'Aven vault' });

/** What each kind is. */
export const KIND_HINTS = /** @type {const} */ ({
	human:
		"A person's vault. Its root is their passkey, which approves every change to it; the master recovery key can also recover it while avenDB is young. Its devices act for it.",
	aven: "An aven: an agent's or a server's own vault, owned by human or coop vaults. It owns no vault itself.",
	coop: 'A coop: owned by human or coop vaults, with no devices of its own. It acts only through its owners.'
});

/** The first characters of an id, enough to tell two apart. @param {string | null | undefined} id */
export const short = (id) => (id ? `${id.slice(0, 4)} ${id.slice(4, 8)}` : '');

/** Vault `v`'s name, or what it is while it has none. @param {VaultView | undefined} v */
export const nameOf = (v) => (v ? (v.name ?? `${KINDS[v.kind]} ${short(v.id)}`) : 'A vault this device doesn’t know');

/**
 * A vault's initials for its circle: the first letters of its first two words, or of its one word, an aven's without its
 * "aven" (avenALICE: Al).
 * @param {VaultView | undefined} v
 */
export function initials(v) {
	const name = (v?.name ?? '?').replace(/^aven(?=[A-Z])/, '');
	const words = name.split(/\s+/).filter(Boolean);
	if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
	const word = words[0] ?? '?';
	return word[0].toUpperCase() + (word[1] ?? '').toLowerCase();
}

/** A vault's colour, from its id: the same on every device. @param {string} id */
export function hue(id) {
	return Math.round((parseInt(id.slice(0, 4), 16) / 0xffff) * 360);
}

/** One, or many, of a thing. @param {number} n @param {string} one @param {string} [many] */
export const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A size in bytes, as a person reads it: "512 B", "2.1 kB", "35 MB", "1.4 GB". @param {number} n */
export function size(n) {
	const units = ['B', 'kB', 'MB', 'GB', 'TB'];
	let [v, u] = [n, 0];
	while (v >= 1000 && u < units.length - 1) [v, u] = [v / 1000, u + 1];
	return u === 0 ? `${n} B` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** Names as a person lists them: "a, b and c". @param {string[]} names @param {string} [and] */
export const list = (names, and = 'and') =>
	names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;

/** A tag or a title in quotes. @param {string} t */
const quote = (t) => `“${t}”`;

/** Whether vault `actor` reads entry `e`, as the device says. @param {EntryView} e @param {string} actor */
export const reads = (e, actor) => e.public || e.readers.includes(actor);

/** Whether vault `actor` changes entry `e`, as the device says. @param {EntryView} e @param {string} actor */
export const writes = (e, actor) => e.writers.includes(actor);

/** Whether vault `actor` may share entry `e` on, as the device says. @param {EntryView} e @param {string} actor */
export const sharesOn = (e, actor) => e.sharers.includes(actor);

/**
 * What the person may do in vault `v`, as the device says (its `acting`); for a vault the device doesn't know, as
 * their own vault, which reaches only itself.
 * @param {WorldView} world @param {string} v @returns {Acting}
 */
export const acting = (world, v) =>
	world.vaults.find((x) => x.id === v)?.acting ?? {
		as: world.mine,
		reaches: v === world.mine,
		shares: v === world.mine
	};

/**
 * Who signer `id` is, as a person reads it: a device by its card's name, else as a device of its vault, an aven's as
 * its server; a vault's root as its passkey; the master recovery key; a passkey that owns a vault; else a key by the
 * start of its id. `lead` capitalises what starts a line, where it isn't a name.
 * @param {WorldView} world @param {string} id @param {boolean} [lead]
 */
export function signerName(world, id, lead = false) {
	const say = (/** @type {string} */ s) => (lead ? s[0].toUpperCase() + s.slice(1) : s);
	if (id === world.recovery) return say('the master recovery key');
	for (const v of world.vaults) {
		const d = v.devices.find((x) => x.id === id);
		if (d) return d.name ?? (v.kind === 'aven' ? `${nameOf(v)}’s server` : say(`a device of ${nameOf(v)}`));
		if (v.root === id) return `${nameOf(v)}’s passkey`;
	}
	const owned = world.vaults.find((v) => v.owners.some((o) => 'signer' in o && o.signer === id));
	return say(owned ? `a passkey of ${nameOf(owned)}` : `key ${short(id)}`);
}

/** The types of entries, as a person names one and many. */
const NOUNS = /** @type {Record<string, [string, string]>} */ ({
	note: ['note', 'notes'],
	todo: ['todo', 'todos'],
	file: ['file', 'files'],
	card: ['device card', 'device cards'],
	profile: ['profile', 'profiles'],
	schema: ['schema', 'schemas'],
	lens: ['lens', 'lenses']
});

/** Entries of type `t`, as a person names many. @param {string} t */
export const plural = (t) => NOUNS[t]?.[1] ?? `${t} entries`;

/** An entry of type `t`, as a person names one. @param {string | null | undefined} t */
export const singular = (t) => (t ? (NOUNS[t]?.[0] ?? `${t} entry`) : 'entry');

/** Entry `e` as a sentence names it: its title in quotes, else what it is. @param {WorldView} world @param {string} e */
export function titleOf(world, e) {
	const x = world.entries.find((y) => y.entry === e);
	return x?.title ? quote(x.title) : `${x?.type ? `a ${singular(x.type)}` : 'an entry'} ${short(e)}`;
}

/** A day, as a person reads it. @param {number} at seconds since 1970 */
const day = (at) => new Date(at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** A cap's grantee for everyone: the Public group's. */
export const EVERYONE = 'everyone';

/**
 * A `where` of labels as the entries that pass every test of one of its conjunctions, for its words: `'all'` for the
 * whole vault (avendb's `ops::Where::cover`).
 * @param {Where} w @returns {'all' | Atom[][]}
 */
function conjunctions(w) {
	if ('all' in w) {
		/** @type {Atom[][]} */
		let out = [[]];
		for (const x of w.all) {
			const c = conjunctions(x);
			if (c !== 'all') out = out.flatMap((d) => c.map((e) => [...d, ...e]));
		}
		return out.some((d) => !d.length) ? 'all' : out;
	}
	if ('any' in w) {
		const cs = w.any.map(conjunctions);
		return cs.includes('all') ? 'all' : cs.flatMap((c) => /** @type {Atom[][]} */ (c));
	}
	return [[w]];
}

/**
 * What a cap picks, in words: "todos tagged “work”", "the whole vault", or "a filter sealed from this device" where the
 * device doesn't read it, as a cap's slice is sealed to the vault, its grantee and its issuer alone.
 * @param {Where | null | undefined} where @param {WorldView} world
 */
export function whereWords(where, world) {
	if (!where) return 'a filter sealed from this device';
	const select = conjunctions(where);
	if (select === 'all') return 'the whole vault';
	if (!select.length) return 'nothing';
	const byId = new Map(world.vaults.map((v) => [v.id, v]));
	/** @param {Atom[]} atoms */
	const conjunction = (atoms) => {
		let noun = 'every entry';
		/** @type {string[]} */
		const rest = [];
		for (const a of atoms) {
			if ('type' in a) noun = a.type.length ? list(a.type.map(plural)) : 'no entry';
			else if ('entry' in a)
				noun = a.entry.length === 1 ? titleOf(world, a.entry[0]) : `${count(a.entry.length, 'entry', 'entries')}: ${list(a.entry.map((e) => titleOf(world, e)))}`;
			else if ('tag' in a) rest.push(`tagged ${quote(a.tag)}`);
			else if ('noTag' in a) rest.push(`not tagged ${list(a.noTag.map(quote), 'or')}`);
			else if ('onlyTags' in a) rest.push(a.onlyTags.length ? `with no tag but ${list(a.onlyTags.map(quote), 'or')}` : 'with no tag');
			else if ('author' in a) rest.push(`written by ${list(a.author.map((v) => nameOf(byId.get(v))), 'or')}`);
			else if ('created' in a) rest.push(`created from ${day(a.created[0])} to ${day(a.created[1])}`);
		}
		return [noun, ...rest].join(' ');
	};
	return select.map(conjunction).join('; or ');
}

/**
 * Who `id` is, as a share names it: Everyone, a vault by its name, or, for a keep share, one of a vault's devices.
 * @param {string} id @param {WorldView} world
 */
export function whoName(id, world) {
	if (id === EVERYONE) return 'Everyone';
	const v = world.vaults.find((x) => x.id === id);
	return v || !world.vaults.some((x) => x.devices.some((d) => d.id === id)) ? nameOf(v) : signerName(world, id, true);
}

/** A cap's grantee, as a person reads it. @param {CapView} c @param {WorldView} world */
export const granteeOf = (c, world) => whoName(c.grantee, world);

/** Who a row of the `shares` op names, as a person reads it. @param {ShareRow['who']} who @param {WorldView} world */
export function whoOf(who, world) {
	if (who === EVERYONE) return 'Everyone';
	if ('vault' in who) return nameOf(world.vaults.find((v) => v.id === who.vault));
	return signerName(world, 'signer' in who ? who.signer : who.device, true);
}

/**
 * A rule's place in words: "anything", "its status", "any row of its blocks", "the checked of row 2 of its blocks".
 * @param {Op['path']} path
 */
function placeWords(path = []) {
	const field = (/** @type {string | { id: number }} */ s) => (s === '*' ? 'any field' : `its ${s}`);
	const row = (/** @type {string | { id: number }} */ s) => (typeof s === 'object' ? `row ${s.id}` : 'any row');
	const [f, r, g] = path;
	if (!path.length) return 'anything';
	if (path.length === 1) return field(f);
	if (path.length === 2) return `${row(r)} of ${field(f)}`;
	const cell = g === '*' ? 'any field' : `the ${g}`;
	return path.length === 3 ? `${cell} of ${row(r)} of ${field(f)}` : path.map((s) => JSON.stringify(s)).join(' › ');
}

/** The lines an op holds on, in words. @param {Op['on']} on */
const onWords = (on) => (on === 'main' ? ' on the main line' : on === 'proposals' ? ' on a proposal' : '');

/** An op in words: "set its status to “done”", "change anything on a proposal", "start proposals". @param {Op} r */
export function opWords(r) {
	const [on, rows] = [onWords(r.on), r.path?.length ? placeWords(r.path) : 'any list'];
	switch (r.op) {
		case 'set': {
			const place = placeWords(r.path ?? []);
			const values = r.to?.map((v) => (typeof v === 'string' ? quote(v) : String(v)));
			return `${values ? `set ${place} to ${list(values, 'or') || 'no value'}` : `change ${place}`}${on}`;
		}
		case 'insert':
			return `add rows to ${rows}${on}`;
		case 'remove':
			return `delete rows of ${rows}${on}`;
		case 'move':
			return `reorder the rows of ${rows}${on}`;
		case 'merge':
			if (r.on === 'main') return 'merge proposals into the main line';
			return r.on === 'proposals' ? 'bring the main line into a proposal' : 'merge one line into another';
		case 'propose':
			return 'start proposals';
		case 'create':
			return 'add new entries';
		case 'tag':
			return r.tags ? `ask for the tags ${list(r.tags.map(quote), 'or')}` : 'ask for any tag';
		case 'read':
			return 'read';
		case 'backup':
			return 'keep an encrypted copy';
		case 'relay':
			return 'find its devices';
		case 'share':
			return 'share it on';
		default:
			return JSON.stringify(r);
	}
}

/** Ops in words: "read, set its status to “done” and add new entries". @param {Op[]} ops */
export const opsWords = (ops) => list(ops.map(opWords)) || 'nothing';

/** The built-in group a cap is, as the device says, for its hint. @param {CapView} c @param {WorldView} world */
export const groupOf = (c, world) => (c.group ? world.groups.find((g) => g.name === c.group) : undefined);

/** The groups of the keep levels, which the share dialog doesn't offer (avendb's `Level::group`). */
const KEEP_GROUPS = /** @type {Record<string, string>} */ ({
	keepWhole: 'Keep whole',
	keepOpened: 'Keep when opened',
	keepNever: 'Never keep'
});

/**
 * The built-in group of a level, by its name (avendb's `Level::group`): Owner, Editor, Viewer, Backup, Relay, or a keep
 * level's.
 * @param {WorldView} world @param {string} role
 */
export const roleGroup = (world, role) =>
	world.groups.find((g) => !g.everyone && g.level === role)?.name ?? KEEP_GROUPS[role] ?? role;

/**
 * A cap's level, as its share names it: its built-in group's name, the Public group's as its level's group, as its who
 * is Everyone; else the name of its own group; else, where the device doesn't read its slice, its level's group.
 * @param {CapView} c @param {WorldView} world
 */
export function levelName(c, world) {
	const g = groupOf(c, world);
	if (g) return g.everyone ? roleGroup(world, g.level) : g.name;
	return c.group ?? c.slice?.name ?? roleGroup(world, c.role);
}

/** What a share does that opens nothing, beside its level's name. */
export const KEEPS = /** @type {Record<string, string>} */ ({
	backup: 'keeps an encrypted copy',
	relay: 'connects only',
	keepWhole: 'syncs it and keeps its files whole',
	keepOpened: 'syncs it and fetches its files as they open',
	keepNever: 'doesn’t sync it'
});

/** The keep modes of the `keep` op, each with its level. */
export const MODES = /** @type {const} */ ([
	['whole', 'keepWhole'],
	['opened', 'keepOpened'],
	['never', 'keepNever']
]);

/** What a share is on: "Everything", or what its slice picks, in words. @param {CapView} c @param {WorldView} world */
export const shareWhat = (c, world) => (c.whole ? 'Everything' : whereWords(c.slice?.where, world));

/** The kind of record each type of entry holds. */
const KIND_OF = /** @type {Record<string, string>} */ ({ note: 'document', todo: 'todo', file: 'document' });

/**
 * The fields of the newest schema of the records of entries of type `type`, of those a vault's entries are read through
 * (the `schemas` op's answer: the one no lens reads on to a newer one), each with the values it takes where it takes
 * only some (an enum, or true and false): what a rule may name.
 * @param {{ schemas: { id: string, kind: string, json: string }[], lenses: { from: string }[] } | null} lane
 * @param {string} type @returns {{ name: string, values: (string | number | boolean | null)[] | null }[]}
 */
export function fieldsOf(lane, type) {
	const kind = KIND_OF[type] ?? type;
	const s = lane?.schemas.find((x) => x.kind === kind && !lane.lenses.some((l) => l.from === x.id));
	try {
		const props = s ? (JSON.parse(s.json).properties ?? {}) : {};
		return Object.entries(props)
			.filter(([name]) => name !== 'kind')
			.map(([name, p]) => ({ name, values: p.enum ?? (p.type === 'boolean' ? [true, false] : null) }));
	} catch {
		return [];
	}
}

/**
 * A cap in words, as a share, who · level · what: "avenBOB · Viewer · todos tagged “work”", "avenCEO · Backup ·
 * Everything", "avenBOB · Tick done · “Fix the door”: read and set its status to “done”"; a built-in group's ops go
 * without saying.
 * @param {CapView} c @param {WorldView} world
 */
export function shareWords(c, world) {
	const ops = c.group || !c.slice ? '' : `: ${opsWords(c.slice.ops)}`;
	return `${granteeOf(c, world)} · ${levelName(c, world)} · ${shareWhat(c, world)}${ops}`;
}

/**
 * A row of the `shares` op's level, as its share names it: its group's name (an owner's Owner, the Public group's as
 * its level's group), else its own group's, else its level's group; a device's "Acts for it".
 * @param {ShareRow} r @param {WorldView} world
 */
export function rowLevel(r, world) {
	if (r.level === 'actsFor') return 'Acts for it';
	const g = r.group ? world.groups.find((x) => x.name === r.group) : undefined;
	if (g) return g.everyone ? roleGroup(world, g.level) : g.name;
	return r.group ?? r.name ?? roleGroup(world, r.level);
}

/** What a row of the `shares` op is on, in words. @param {ShareRow} r @param {WorldView} world */
export const rowWhat = (r, world) => (r.what === 'everything' ? 'Everything' : whereWords(r.what, world));

/** The tags of `entries`, as many as carry each, the most used first. @param {EntryView[]} entries */
export function tagsOf(entries) {
	const n = new Map();
	for (const e of entries) for (const t of e.tags ?? []) n.set(t, (n.get(t) ?? 0) + 1);
	return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, uses]) => ({ tag, uses }));
}

/** Tags as a person types them: split at commas and spaces, each once. @param {string} text */
export const tagsIn = (text) => [...new Set(text.split(/[\s,]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean))];

/**
 * Who entries are shared with: a vault's id or `"everyone"`, its name, and the levels it holds them at, Owner for
 * their own vault; none where it only keeps an encrypted copy (Backup).
 * @typedef {{ id: string, name: string, levels: string[] }} Sharer
 * @typedef {{ who: Sharer[], gone: number }} Shared who, and how many of the caps named are no longer in force
 */

/**
 * Who the entries of vault `vault` that caps `caps` pick are shared with, from the caps alone: the vault itself first,
 * their Owner; then the grantee of each of those caps in force whose devices get them, and of each such cap on the
 * whole vault, by its name and the levels of its caps that read, the strongest first, and one that only keeps an
 * encrypted copy last. A Relay holder never gets an entry, and a keep share only says what a device keeps: both go
 * unsaid.
 * @param {WorldView} world @param {string} vault @param {string[]} caps @returns {Shared}
 */
export function sharedThrough(world, vault, caps) {
	const live = world.caps.filter((c) => c.over === vault && c.gets && (c.wide || caps.includes(c.id)));
	/** @type {Map<string, { levels: string[], rank: number }>} */
	const by = new Map();
	for (const c of live.sort((a, b) => order(a.role) - order(b.role))) {
		const x = by.get(c.grantee) ?? { levels: [], rank: STRONGEST.length };
		const level = c.reads ? levelName(c, world) : '';
		if (level && !x.levels.includes(level)) x.levels.push(level);
		by.set(c.grantee, { levels: x.levels, rank: Math.min(x.rank, order(c.role)) });
	}
	const who = [...by]
		.sort(([, a], [, b]) => a.rank - b.rank)
		.map(([id, x]) => ({ id, name: whoName(id, world), levels: x.levels }));
	const own = { id: vault, name: whoName(vault, world), levels: [roleGroup(world, 'owner')] };
	return { who: [own, ...who], gone: caps.filter((id) => !world.caps.some((c) => c.id === id)).length };
}

/**
 * Who entry `entry` of vault `vault` is shared with: by the caps in force that reach it, those on the whole vault too.
 * @param {WorldView} world @param {string} vault @param {string} entry
 */
export const sharedWith = (world, vault, entry) =>
	sharedThrough(world, vault, world.caps.filter((c) => c.over === vault && c.entries.includes(entry)).map((c) => c.id));

/**
 * One who entries are shared with, in words: "avenBOB (Editor)", "avenCEO (keeps an encrypted copy)".
 * @param {Sharer} x
 */
export const sharerWords = (x) => `${x.name} (${x.levels.join(', ') || KEEPS.backup})`;

/** Who entries are shared with, in words. @param {Shared} s */
export const sharedWords = (s) =>
	list([...s.who.map(sharerWords), ...(s.gone ? [`${count(s.gone, 'share')} no longer in force`] : [])]);

/** Why the rules refused an edit, as a person reads it (avendb's `Refusal`, avendb/docs/ARCHITECTURE.md §5). */
const WHY = /** @type {Record<string, string>} */ ({
	NoCap: 'nothing shared with the acting vault allows it',
	NotActing: 'this device doesn’t act for that vault',
	BelowThreshold: 'it needs the approval of the vault’s owners',
	NoConsent: 'someone it names hasn’t signed it',
	BadParent: 'the acting vault’s own right to share it isn’t in force',
	PublicBeyondRead: 'everyone may only read: the Public group',
	BadCap: 'a share needs a name and at least one op',
	CapToItself: 'a vault holds every right over itself already',
	WideOwner: 'Owner of everything makes a co-owner: share Owner on a slice, or add an owner',
	KeepNeedsDevice: 'a keep share names one of the vault’s own devices, never a vault or everyone',
	DeviceOnlyKeeps: 'only a keep share names a device: share with its vault',
	NotDevice: 'that device isn’t one of the acting vault’s',
	NotAllowed: 'the ops of the share it writes through don’t allow that change',
	UnknownVault: 'this device doesn’t know that vault yet',
	UnknownCap: 'that share isn’t in force',
	UnknownEntry: 'this device doesn’t know that entry yet',
	Revoked: 'that share was revoked already',
	BadMark: 'a mark marks an audience, the keep shares that want its entry, or both',
	BadAudience: 'an audience is shares over the vault, none of them on the whole of it, in order',
	SameAudience: 'the entry is in that audience already',
	BadWants: 'the keep shares that want an entry are keep shares over its vault, none on the whole of it, in order',
	SameWants: 'those keep shares want it already',
	LastOwner: 'a vault keeps at least one owner',
	AlreadyMember: 'it is an owner or a device of it already',
	NotMember: 'it isn’t an owner or a device of it',
	BadThreshold: 'a vault needs at least one approval, and no more than it has owners',
	NotRoot: 'only the vault’s root hands the root on',
	ReadOnly: 'this device opens it read-only',
	Locked: 'this device is locked',
	BadSignature: 'a signature didn’t check',
	WrongOwnerKind: 'that vault may not own it',
	Cycle: 'a vault would own itself'
});

/**
 * Why the device refused, in the page's words where it has them, else the device's.
 * @param {{ refused?: string, why?: string } | null | undefined} out
 */
export const why = (out) =>
	(out?.refused && WHY[out.refused]) || out?.why || out?.refused || 'the device didn’t answer';

/** An error's message with a refusal's reason in words. @param {string} message */
export function plain(message) {
	const m = /^(.*?):?\s*\b([A-Z][A-Za-z]+)\b\s*$/.exec(message);
	const said = m && WHY[m[2]];
	return said ? `${m[1].replace(/^\w/, (c) => c.toUpperCase())}: ${said}.` : message;
}
