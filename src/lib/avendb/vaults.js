/*
 * What avenDB's vault screens share: a vault's name, initials and colour, the kinds as a person reads them, a share
 * in words (who · level · what), who an entry is shared with, a signer's name, a size, and a refusal's reason. A vault
 * is a flat library: its entries are in it directly, each with a type and tags, and every right is a share: a named
 * group of JSON ops on a slice of it, a query's `where` over their labels (avendb's `slice` and `rules`), or one of its
 * owners or devices. The rules are the device's alone: what each vault may do the page reads from its answers (the
 * world's `acting`, each share's `group`, `whole`, `reads` and `gets`, each entry's `readers`, `writers` and
 * `sharers`, the `shares` op's rows, and `may`), and these only word them.
 */

import { fieldPaths, pathWords } from './paths.js';

/** @typedef {'human' | 'coop' | 'aven' | 'device'} Kind */
/**
 * A kind's row of the kind table, as the world carries it (avendb's `Kind::rules`, `words::kinds_json`): who may own a
 * vault of it, `"signers"` (passkeys) or the kinds of vault that may; how many owners it takes at most, `null` for any
 * number; whether it holds devices; and how many vaults of it one owner may own, `null` for any number. The page reads
 * every kind rule here, and decides none.
 * @typedef {{ kind: Kind, ownedBy: 'signers' | Kind[], most: number | null, devices: boolean, each: number | null }}
 *   KindRules
 */
/**
 * A share's level, the class of its strongest op (avendb's `words::level_name`); a keep share's, its mode, which grants
 * nothing: it says only what one of the vault's devices keeps of it.
 * @typedef {'relay' | 'backup' | 'read' | 'write' | 'owner' | 'keepWhole' | 'keepOpened' | 'keepNever'} Role
 */
/**
 * A device of a vault: its name, by its card; whether it is this one; and its copy setting, what it keeps of every vault
 * it syncs: `full`, every entry and file, or `light`, every entry and a file as it is opened, `null` where it set none;
 * `next`, its next key, where the key move kept it beside that key (an owner key too), `null` otherwise; and `old`,
 * whether it still signs as before the key move, never unlocked since its person's keys moved.
 * @typedef {{ id: string, name?: string | null, me: boolean, copy?: 'full' | 'light' | null, next?: string | null,
 *   old?: boolean }} DeviceView
 */
/**
 * What the person may do in a vault, as the device says: the vault they act as in it (the vault itself where theirs
 * owns it, else the vault of theirs that holds the strongest share over it, else their own), whether that vault
 * reaches anything of it, and whether it may share some of it on.
 * @typedef {{ as: string, reaches: boolean, shares: boolean }} Acting
 */
/**
 * @typedef {{ id: string, kind: Kind, name: string | null,
 *   owners: ({ vault: string } | { signer: string, recovery: boolean, legacy?: boolean,
 *     by: 'device' | 'passkey' | 'touch' | null, next: string | null })[],
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
 * proposals, only lines whose changes all lie at or under a path, if it names one; share it on.
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
 * A share in force: `who` a vault's id, `"everyone"`, or for a keep share one of its vault's devices; `level` its
 * level; `slice` `null` where the device doesn't read it. As the device says: `group` the built-in group it is, if any;
 * `drafts` whether its ops let its who propose new entries (`create` on proposals, in every share of its chain),
 * `null` where the device doesn't read its slice, so a Suggester's made before drafts reads apart (`OLD_SUGGESTER`);
 * `whole` whether it is on the whole vault; `reads` whether its who reads what it reaches; `gets` whether its
 * who's devices receive it. A keep share does neither: it never counts as access. `capGroup` the entry of the vault's
 * cap group the share names, if it names one (./capgroups.js), whose version in force decides what it gives.
 * @typedef {{ id: string, over: string, issuer: string, who: string, level: Role, wide: boolean,
 *   parent: string | null, chain: string[], slice: Slice | null, revokers: string[], entries: string[],
 *   group: string | null, capGroup?: string | null, drafts: boolean | null, whole: boolean, reads: boolean,
 *   gets: boolean }} CapView
 */
/**
 * A device that gets a cell's edits: the vault it gets them through, whether it opens them, and the level it holds
 * them by, where the device's world says (`"backup"` for one that only keeps an encrypted copy).
 * @typedef {{ device: string, through: string, opens: boolean, level?: Role }} Syncing
 */
/**
 * @typedef {{ id: string, vault: string, shares: string[], epoch: number, entries: string[], readers: string[],
 *   public: boolean, syncs: Syncing[] }} CellView
 */
/**
 * A device Synced to lists for an entry or a file: how much of it it holds, `has`, of how much this device holds,
 * `of`: of an entry, edits of its log; of a file, its sealed pieces. All of it when they are equal. `checked` when the
 * device last said so, in the statement it signed, in seconds since 1970 by its clock: `null` for this device and for
 * one connected now, whose word is live.
 * @typedef {{ device: string, has: number, of: number, checked: number | null }} Holder
 */
/**
 * An entry as the device shows it: `readers`, `writers` and `sharers` the vaults that read it, change it and may share
 * it on, its own vault first; `syncedTo` the devices that hold some of it, each with how many of its edits; `title` a
 * schema's title or a lens's name for those; `record` the record of a flow, a function, a post or a story (kind
 * `record`), or of a spark (kind `note`, ./sparks.js), each field it leaves out at its default.
 * @typedef {{ entry: string, vault: string, by: string, authors?: string[], type: string | null, tags: string[] | null,
 *   created: number | null, audience: string, public: boolean, levels: Record<string, Role>,
 *   readers: string[], writers: string[], sharers: string[], syncedTo: Holder[],
 *   kind: 'note' | 'todo' | 'file' | 'schema' | 'lens' | 'record' | 'sealed', title: string | null,
 *   text: string | null, status: 'open' | 'doing' | 'done' | null, forkOf: string | null,
 *   forkAt: string[] | null, deleted: boolean, edits: number, proposals: number, variants: number, media: string | null,
 *   record: Record<string, any> | null, files: import('./files.js').FileView[] }} EntryView
 */
/**
 * The device's world (avendb-browser's `World::to_json`): `ownsServer` whether the person's vault owns avenMAIA,
 * the device vault Maia City owns and the server is a device of, directly or through owners of owners; `backsUp`
 * whether avenDB's server keeps an encrypted copy of it, `null` where it holds no share on it; `kinds` the kind table.
 * @typedef {{ me: string, mine: string, recovery: string | null, vaults: VaultView[], shares: CapView[],
 *   audiences: CellView[], entries: EntryView[], groups: Group[], kinds: KindRules[], ownsServer: boolean,
 *   backsUp: boolean | null }} WorldView
 */
/**
 * What the device answers `may` for one op: it would make it, it would once those signers approve it, or why not.
 * @typedef {true | { approve: { signers: string[] } } | { refused: string, why: string }} Verdict
 */
/**
 * A share over a vault as the `shares` op lists them, owners and devices among them: who holds it, its level and
 * group, whether it lets its who propose new entries (`drafts`, as a CapView's), what it is on (`"everything"`, a
 * `where`, or `null` where the device doesn't read it), how many entries it reaches now, and whether the acting vault
 * may revoke it.
 * A grant's `capGroup` is the entry of the vault's cap group it names, if it names one, and `who` an invite key where no
 * vault claimed that invite yet.
 * @typedef {{ kind: 'owner' | 'device' | 'grant' | 'keep', id: string | null, over: string,
 *   who: { vault: string } | { signer: string } | { device: string } | { invite: string } | 'everyone',
 *   level: Role | 'actsFor', group: string | null, capGroup?: string | null, name: string | null, drafts: boolean | null, what: 'everything' | Where | null,
 *   ops: Op[] | null, above: Op[][] | null, issuer: string | null, parent: string | null, reaches: number,
 *   recovery: boolean, root: boolean, revoke: Verdict }} ShareRow
 */
/**
 * Every share over vault `over`, for vault `as`: whether it may share some of it on, and the rows.
 * @typedef {{ over: string, as: string, share: Verdict, rows: ShareRow[] }} Shares
 */

/**
 * An access request an agent device on the Mac left (avendb-device's `agent`, ./AccessRequest.svelte): its device's
 * name (agentClaude) and key, its offer while it belongs to no vault yet, the level it asks for, why, the vaults it
 * names, and whether its device runs now, to cosign its joining. It names no aven: an agent always joins its person's
 * one aven.
 * @typedef {{ name: string, kind: string, device: string, offer: string | null, level: string, why: string,
 *   vaults: string[], online: boolean }} AccessRequestView
 */

/**
 * An access request, a record of avenDB's `request` schema the asking vault `from` writes in itself and shares with the
 * vault it asks, `to`, which may read it and set its answer and its part alone (the `ask` op): what it asks for, a
 * share (`share`), to co-own `to` (`owner`) or, an invitation, for `to` to co-own `from` (`invite`); the level, a
 * built-in group, Owner for the two others; why; the vaults it asks that level on, `to` itself where it names none, as
 * an agent asking its aven names the person's vaults; the answer, once `to` gave it; for an owner add, whether `to`
 * wrote its part of the edit, signed by its passkey, for `from` to finish (`part`), and whether the owner is added
 * (`done`); and when it was made, in seconds since 1970, where the device says.
 * @typedef {{ entry: string, from: string, to: string, asks?: 'share' | 'owner' | 'invite', level: string, why: string,
 *   vaults: string[], answer: 'granted' | 'denied' | null, part?: boolean, done?: boolean, created: number | null }}
 *   RequestRow
 */
/**
 * The access requests the device knows (the `requests` op): `asked`, those not answered yet that ask a vault it acts
 * for, the consent screen's; `made`, every one a vault it acts for made, with its answer.
 * @typedef {{ asked: RequestRow[], made: RequestRow[] }} Requests
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
export const KINDS = /** @type {const} */ ({
	human: 'Human vault',
	coop: 'Coop vault',
	aven: 'Aven vault',
	device: 'Device vault'
});

/** Each kind as one word, which a rule's words list. */
const KIND_WORDS = /** @type {Record<string, string>} */ ({ human: 'human', coop: 'coop', aven: 'aven', device: 'device' });

/** What each kind is for, before the kind table's rules for it. */
const KIND_IS = /** @type {Record<string, string>} */ ({
	human: "A person's vault: the identity everything they do starts from.",
	coop: 'A coop: a company or a group, which hires avens by sharing with them.',
	aven: 'An aven: the AI identity of the coop that owns it, which its server and its agents act as, each a device of it.',
	device: 'A device vault: the keys of one agent, server or drive, with only the rights its owner passes on to it.'
});

/** Kind `kind`'s row of the kind table. @param {WorldView} world @param {string} kind @returns {KindRules | undefined} */
export const kindRules = (world, kind) => world.kinds?.find((k) => k.kind === kind);

/** The vaults vault `id` owns directly, as this device knows them. @param {WorldView} world @param {string} id */
export const ownedBy = (world, id) => world.vaults.filter((v) => v.owners.some((o) => 'vault' in o && o.vault === id));

/**
 * Whether a vault of kind `kind` acts for its one owner alone, as the kind table says (`most` 1): an aven, a device
 * vault, never a vault to work in or co-own.
 * @param {WorldView} world @param {string} kind
 */
export const oneOwner = (world, kind) => kindRules(world, kind)?.most === 1;

/**
 * Whether vault `owner` may own one more vault of kind `kind`, as the kind table says: the kind is owned by vaults of
 * `owner`'s kind, and `owner` owns fewer of it than one owner may (`each`), of those this device knows.
 * @param {WorldView} world @param {VaultView} owner @param {string} kind
 */
export function mayOwn(world, owner, kind) {
	const r = kindRules(world, kind);
	if (!r || r.ownedBy === 'signers' || !r.ownedBy.includes(owner.kind)) return false;
	return r.each == null || ownedBy(world, owner.id).filter((v) => v.kind === kind).length < r.each;
}

/**
 * Whether vault `x` may become an owner of vault `v` too, as the kind table says: `v`'s kind takes one more owner
 * (`most`), and `x` may own one more of it (`mayOwn`).
 * @param {WorldView} world @param {VaultView} v @param {VaultView} x
 */
export function mayCoOwn(world, v, x) {
	const r = kindRules(world, v.kind);
	return !!r && (r.most == null || v.owners.length < r.most) && mayOwn(world, x, v.kind);
}

/**
 * How a vault of kind `kind` acts, by the kind table: its devices act for it; or it holds none, and its owners act for
 * it, and where it may own a kind that holds devices, those vaults act with what it passes on to them.
 * @param {WorldView} world @param {string} kind
 */
export function actsWords(world, kind) {
	const r = kindRules(world, kind);
	if (!r) return '';
	if (r.devices) return 'Its devices act for it.';
	const delegates = world.kinds.some((k) => k.devices && k.ownedBy !== 'signers' && k.ownedBy.includes(r.kind));
	const owners = r.most === 1 ? 'its owner acts' : 'its owners act';
	return `It holds no devices: ${owners} for it${delegates ? ', and the device vaults it owns act with what it passes on to them' : ''}.`;
}

/**
 * What a vault of kind `kind` is, in words: what it is for, then the kind table's rules for it, who may own it and how
 * many, how it acts, and whether it owns anything.
 * @param {WorldView} world @param {string} kind
 */
export function kindHint(world, kind) {
	const r = kindRules(world, kind);
	if (!r) return KIND_IS[kind] ?? '';
	const by = r.ownedBy === 'signers' ? [] : r.ownedBy.map((k) => KIND_WORDS[k] ?? k);
	const owners =
		r.ownedBy === 'signers'
			? 'Owned by its keys: passkeys, a Mac’s Touch ID key, the master recovery key'
			: r.most === 1
				? `Owned by one ${list(by, 'or')} vault alone`
				: `Owned by ${list(by, 'or')} vaults${r.most == null ? '' : `, ${r.most} at most`}`;
	const each = r.each == null ? '' : `; a vault owns ${r.each === 1 ? 'one' : r.each} of them at most`;
	const owns = world.kinds.some((k) => k.ownedBy !== 'signers' && k.ownedBy.includes(r.kind)) ? '' : ' It owns no vault.';
	return `${KIND_IS[kind] ?? ''} ${owners}${each}. ${actsWords(world, kind)}${owns}`.trim();
}

/**
 * Owners or devices as a list shows them: a key the key move kept beside its next (`next`) is that same passkey,
 * Touch ID key or device, so each is listed once, by its newest key.
 * @template {object} T @param {T[]} xs @returns {T[]}
 */
export const newest = (xs) => xs.filter((x) => !('next' in x && x.next));

/**
 * Key `id` as a list shows it: its next key where the key move kept it beside one (`next`), else itself.
 * @param {WorldView} world @param {string} id
 */
export function newestKey(world, id) {
	for (const v of world.vaults) {
		const d = v.devices.find((x) => x.id === id);
		if (d) return d.next ?? id;
		const o = v.owners.find((x) => 'signer' in x && x.signer === id);
		if (o && 'next' in o && o.next) return o.next;
	}
	return id;
}

/**
 * Whether vault `a` owns vault `b`, directly or through owners of owners, as this device knows them.
 * @param {WorldView} world @param {string} a @param {string} b
 */
export function owns(world, a, b) {
	const byId = new Map(world.vaults.map((v) => [v.id, v]));
	const seen = new Set([b]);
	const up = [b];
	for (let at = up.pop(); at !== undefined; at = up.pop()) {
		for (const o of byId.get(at)?.owners ?? []) {
			if (!('vault' in o) || seen.has(o.vault)) continue;
			if (o.vault === a) return true;
			seen.add(o.vault);
			up.push(o.vault);
		}
	}
	return false;
}

/**
 * The aven the person's agents run under: their seed coop's one aven, avenMAIA, else the first aven they see.
 * @param {WorldView} world @returns {VaultView | undefined}
 */
export const avenOf = (world) => seeded(world)[1]?.[0] ?? world.vaults.find((v) => v.kind === 'aven');

/**
 * Who wrote an entry, or a version of it, in words (Samuel 2026-10-18: never the coop, always its aven and its human
 * collaborators): its authors as avendb's `world::authors` lists them, the coop's aven first and then each human vault
 * whose device signed a write of it, joined by " + ": "avenMAIA + Samuel + Alice". Each is a vault's id, which `world`
 * names, or `{vault, name}` as the feed and the history give it. `fallback` where it has none.
 * @param {WorldView | null | undefined} world @param {(string | { vault: string, name?: string | null })[] | null | undefined} authors
 * @param {string} [fallback]
 */
export function authorsLine(world, authors, fallback = '') {
	const byId = new Map((world?.vaults ?? []).map((v) => [v.id, v]));
	const named = (/** @type {string | { vault: string, name?: string | null }} */ a) => {
		const id = typeof a === 'string' ? a : a.vault;
		const given = typeof a === 'string' ? null : a.name;
		return given || (byId.has(id) ? nameOf(byId.get(id)) : `vault ${short(id)}`);
	};
	return (authors ?? []).length ? (authors ?? []).map(named).join(' + ') : fallback;
}

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

/**
 * World `w`'s vaults as the app's nav pill lists them ($lib/app/pill.svelte.js): the person's own first, their profile,
 * then the rest, each by its name, its kind, its initials in its colour and its shape, with how many changes wait in it
 * (`waiting`, by vault).
 * @param {WorldView} w @param {Record<string, number>} [waiting]
 */
export function pillVaults(w, waiting = {}) {
	const mine = w.vaults.find((v) => v.id === w.mine);
	// a device vault with no device left (its last one removed, as the studio's old workers were) acts for nobody: not one to switch to
	return [mine, ...w.vaults.filter((v) => v.id !== w.mine && !(v.kind === 'device' && !v.devices?.length))]
		.filter((v) => !!v)
		.map((v) => ({
			id: v.id,
			label: nameOf(v),
			sub: v.id === w.mine ? 'You' : KINDS[v.kind],
			text: initials(v),
			colour: `hsl(${hue(v.id)} 38% 42%)`,
			shape: v.kind,
			badge: waiting[v.id] ?? 0
		}));
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

/**
 * How long ago `at`, seconds since 1970, was, roughly: "just now", "5 min ago", "3 h ago", "2 days ago".
 * @param {number} at @param {number} [now] milliseconds since 1970
 */
export const ago = (at, now = Date.now()) => {
	const s = Math.max(0, Math.floor(now / 1000) - at);
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	const days = Math.floor(s / 86400);
	return `${days} ${days === 1 ? 'day' : 'days'} ago`;
};

/**
 * How much of it a holder holds, and since when, in words: "3 of 8", "checked 2 h ago", or both; `null` for a device
 * connected now that holds all of it.
 * @param {Holder} h
 */
export const heldWords = (h) =>
	[h.has >= h.of ? '' : `${h.has} of ${h.of}`, h.checked == null ? '' : `checked ${ago(h.checked)}`]
		.filter(Boolean)
		.join(', ') || null;

/**
 * When each device last said what it holds, by the entries and files it holds (`syncedTo`): `null` for this one and one
 * connected now, else its newest signed statement's time, seconds since 1970. A device that never said is in none.
 * @param {WorldView} world @returns {Map<string, number | null>}
 */
export function lastSaid(world) {
	/** @type {Map<string, number | null>} */
	const out = new Map();
	const take = (/** @type {Holder} */ h) => {
		const was = out.get(h.device);
		if (was !== null) out.set(h.device, h.checked == null ? null : Math.max(was ?? 0, h.checked));
	};
	for (const e of world.entries) {
		e.syncedTo?.forEach(take);
		for (const f of e.files ?? []) f.syncedTo?.forEach(take);
	}
	return out;
}

/**
 * Where an entry or a file is synced to, in words, one wording for both: each device by name, with how much of it it
 * holds where that is only some, and when it last said so where it isn't connected now, as "this browser, the server
 * (3 of 8), the iPhone (checked 2 h ago)". `null` for none.
 * @param {Holder[] | undefined} holders @param {(device: string) => string} name
 */
export const syncedWords = (holders, name) =>
	list(
		(holders ?? []).map((h) => {
			const held = heldWords(h);
			return held ? `${name(h.device)} (${held})` : name(h.device);
		})
	) || null;

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
 * Who signer `id` is, as a person reads it: a device by its card's name, else as a device of its vault, a device
 * vault's by the vault's own name, as avenMAIA's server or agentClaude's agent; a vault's root as its passkey;
 * the master recovery key, and the one from before the key move as the old one; a Mac's Touch ID key or a passkey
 * that owns a vault; else a key by the start of its id.
 * `lead` capitalises what
 * starts a line, where it isn't a name.
 * @param {WorldView} world @param {string} id @param {boolean} [lead]
 */
export function signerName(world, id, lead = false) {
	const say = (/** @type {string} */ s) => (lead ? s[0].toUpperCase() + s.slice(1) : s);
	if (id === world.recovery) return say('the master recovery key');
	const legacy = (/** @type {VaultView} */ v) => v.owners.some((o) => 'signer' in o && o.signer === id && o.legacy);
	if (world.vaults.some(legacy)) return say('the old/legacy recovery key');
	for (const v of world.vaults) {
		const d = v.devices.find((x) => x.id === id);
		if (d) return d.name ?? (v.kind === 'device' && v.name ? v.name : say(`a device of ${nameOf(v)}`));
		if (v.root === id) return `${nameOf(v)}’s passkey`;
	}
	for (const v of world.vaults) {
		const o = v.owners.find((x) => 'signer' in x && x.signer === id);
		if (o && 'by' in o) return say(`${o.by === 'touch' ? 'a Mac Touch ID key' : 'a passkey'} of ${nameOf(v)}`);
	}
	return say(`key ${short(id)}`);
}

/** The device an offer's text names (avendb-net's `Offer::to_text`): `AVENDB1`, then in base32 without padding its
 *  endpoint's 32 bytes, then its device's 32, in hex; null if it is no offer. @param {string} offer */
export function offerDevice(offer) {
	if (!offer?.startsWith('AVENDB1')) return null;
	const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	/** @type {number[]} */
	const bytes = [];
	let [bits, value] = [0, 0];
	for (const c of offer.slice('AVENDB1'.length)) {
		const n = ALPHABET.indexOf(c);
		if (n < 0) return null;
		[value, bits] = [((value << 5) | n) & 0xffff, bits + 5];
		if (bits >= 8) {
			bits -= 8;
			bytes.push((value >> bits) & 0xff);
		}
		if (bytes.length === 64) break;
	}
	if (bytes.length < 64) return null;
	return bytes
		.slice(32, 64)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Names for the devices of avens, which carry no card, as a person reads them: avenDB's server, by the device its offer
 * `offer` names; each agent `agents` names (the Mac app's `agentDevices`), on this Mac, or the cloud sessions' one it
 * added; and where `agents` is given, as in the Mac app, any other device of an aven, which runs on no Mac of theirs:
 * their cloud sessions' agent, or, where the Mac noted that one, an agent elsewhere. Each name goes to every key of its
 * device, before and after its key move (`next`).
 * Where the device's card names it, that name stays.
 * @param {WorldView} world @param {string} offer
 * @param {{ name: string, device: string, cloud: boolean }[] | null} [agents]
 * @returns {Map<string, string>}
 */
export function deviceRoles(world, offer, agents = null) {
	/** @type {Map<string, string>} */
	const next = new Map();
	/** @type {Set<string>} */
	const named = new Set();
	for (const v of world.vaults)
		for (const d of v.devices) {
			if (d.next) next.set(d.id, d.next);
			if (d.name) named.add(d.id);
		}
	/** @type {Map<string, string>} */
	const roles = new Map();
	/** device `id` and each key it moved to, named `name` @param {string} id @param {string} name */
	const along = (id, name) => {
		for (let at = /** @type {string | undefined} */ (id), n = 0; at && n < 16 && !roles.has(at); at = next.get(at), n++)
			roles.set(at, name);
	};
	// a key that moved to one named is named so too
	const back = () => {
		for (let again = true; again; ) {
			again = false;
			for (const [old, to] of next)
				if (!roles.has(old) && roles.has(to)) {
					roles.set(old, /** @type {string} */ (roles.get(to)));
					again = true;
				}
		}
	};
	const server = offerDevice(offer);
	if (server) along(server, 'avenDB’s server');
	for (const a of agents ?? []) along(a.device, a.cloud ? `${a.name}, for cloud sessions` : `${a.name} on this Mac`);
	back();
	// any other device of an aven runs on no Mac of theirs: the cloud sessions' agent, unless this Mac noted that one
	const other = agents?.some((a) => a.cloud) ? 'An agent not on this Mac' : 'agentCloud, for cloud sessions';
	if (agents)
		for (const v of world.vaults)
			if (v.kind === 'aven') for (const d of v.devices) if (!roles.has(d.id)) along(d.id, other);
	back();
	for (const id of named) roles.delete(id);
	return roles;
}

/**
 * Who stands behind an edit, link by link back to the passkeys (avendb's `data::Audit::chain`): the author's device in
 * the vault it belongs to, then each vault it acted through as an owner of the next, up to the vault it acted for. Each
 * link names the latest edit that made it so, `null` where no edit this device holds does, and that edit's signers,
 * each by the vault it is in now and how. Then who owns the vault it acted for now.
 * @typedef {{ signer: string, vault: string | null, as: 'root' | 'owner' | 'device' | null }} ChainSigner
 * @typedef {{ who: { signer: string } | { vault: string }, in: string, as: 'device' | 'root' | 'owner',
 *   edit: string | null, signers: ChainSigner[] }} ChainLink
 * @typedef {{ links: ChainLink[], owners: ({ vault: string } | { signer: string })[] }} Chain
 */

/**
 * Who made an edit, in words: its device, the vault it acted for, and the owners it acted through, from the device's
 * vault up: "Samuel’s Mac, for Maia COOP through Samuel".
 * @param {WorldView} world @param {string} author @param {string} actor @param {string[] | null | undefined} via
 */
export function actingWords(world, author, actor, via) {
	const name = (/** @type {string} */ id) => nameOf(world.vaults.find((v) => v.id === id));
	const through = via?.length ? ` through ${list([...via].reverse().map(name))}` : '';
	return `${signerName(world, author, true)}, for ${name(actor)}${through}`;
}

/**
 * Chain `chain` as sentences, one a link, from the device up to the vault the edit acted for, each with the edit that
 * made it so: "Samuel’s Mac is a device of Samuel, added by Samuel’s passkey and Samuel’s Mac", "Samuel is an owner of
 * Maia COOP since its founding, signed by Samuel’s passkey"; then, for a vault owned by vaults, who owns it now.
 * @param {WorldView} world @param {Chain} chain
 * @returns {{ says: string, edit: string | null }[]}
 */
export function chainSteps(world, chain) {
	const name = (/** @type {string} */ id) => nameOf(world.vaults.find((v) => v.id === id));
	const by = (/** @type {ChainSigner[]} */ ss) => list(ss.map((x) => signerName(world, x.signer)));
	const steps = chain.links.map((l) => {
		const who = 'vault' in l.who ? name(l.who.vault) : signerName(world, l.who.signer, true);
		const is = { root: 'the root passkey of', owner: 'an owner of', device: 'a device of' }[l.as];
		const how =
			l.edit === null
				? ', which no edit this browser holds shows'
				: l.edit === l.in
					? ` since its founding, signed by ${by(l.signers)}`
					: `, added by ${by(l.signers)}`;
		return { says: `${who} is ${is} ${name(l.in)}${how}`, edit: l.edit };
	});
	const actor = chain.links.at(-1)?.in;
	if (actor && chain.owners.some((o) => 'vault' in o)) {
		const owner = (/** @type {Chain['owners'][number]} */ o) => ('vault' in o ? name(o.vault) : signerName(world, o.signer));
		steps.push({ says: `${name(actor)} is owned now by ${list(chain.owners.map(owner))}`, edit: null });
	}
	return steps;
}

/**
 * The names of the seed a person's claim of avenDB's server founds (avendb's `world::SEED_NAMES`): Maia City, the one
 * coop of the seed, which their vault owns and where the content lives, and avenMAIA, its one aven, which lives on the
 * server, its device (Samuel 2026-10-18: no holding, no company coop, one aven per coop and none per person, and the
 * server's vault and the coop's aven one vault).
 */
export const SEED = /** @type {const} */ (['Maia City', 'avenMAIA']);

/** The kinds of the seed's chain, the person's vault owning the first (avendb's `world::SEED`). */
const SEED_KINDS = /** @type {const} */ (['coop', 'aven']);

/**
 * The seed of the person's vault, each vault of it with its name in `SEED`, if their claim of the server founded one:
 * an aven with a device, the server, owned alone by a coop their vault owns alone (avendb's `world::seeder`). Empty
 * where their vault founded no seed.
 * @param {WorldView} world @returns {[VaultView, string][]}
 */
export function seeded(world) {
	const byId = new Map(world.vaults.map((v) => [v.id, v]));
	/** the one vault that owns `v`, if one alone does @param {VaultView | undefined} v */
	const owner = (v) => (v?.owners.length === 1 && 'vault' in v.owners[0] ? byId.get(v.owners[0].vault) : undefined);
	const last = SEED_KINDS.at(-1);
	for (const server of world.vaults.filter((v) => v.kind === last && v.devices.length)) {
		/** @type {VaultView[]} */
		const chain = [server];
		for (let up = owner(server); up && chain.length < SEED_KINDS.length; up = owner(up)) chain.unshift(up);
		const kinds = chain.length === SEED_KINDS.length && chain.every((v, i) => v.kind === SEED_KINDS[i]);
		if (kinds && owner(chain[0])?.id === world.mine) return /** @type {[VaultView, string][]} */ (chain.map((v, i) => [v, SEED[i]]));
	}
	return [];
}

/** The seed's coop, Maia City, if the person's claim founded it (`seeded`). @param {WorldView} world */
export const seedCity = (world) => seeded(world)[0]?.[0];

/** The seed's aven, avenMAIA, the server's vault, if the person's claim founded it (`seeded`). @param {WorldView} world */
export const seedServer = (world) => seeded(world)[1]?.[0];

/**
 * Maia City as anyone's world shows it, whoever founded it (avendb's `world::avenceo` and `seeder`): the coop of the
 * seed whose aven is the server the person's vault is kept by: an aven with a device, owned alone by a coop owned alone
 * by a human vault, to which their vault gives relay or more on the whole of it, as it did as it was founded through
 * the server. Never by its name, which anyone may give a vault. Undefined where the world shows no such server.
 * @param {WorldView} world @returns {VaultView | undefined}
 */
export function serverCity(world) {
	const byId = new Map(world.vaults.map((v) => [v.id, v]));
	/** the one vault that owns `v`, if one alone does @param {VaultView | undefined} v */
	const owner = (v) => (v?.owners.length === 1 && 'vault' in v.owners[0] ? byId.get(v.owners[0].vault) : undefined);
	for (const c of world.shares) {
		if (c.over !== world.mine || !c.whole || !['relay', 'backup', 'read', 'write', 'owner'].includes(c.level)) continue;
		const server = byId.get(c.who);
		const city = owner(server);
		if (server?.kind === 'aven' && server.devices.length && city?.kind === 'coop' && owner(city)?.kind === 'human') return city;
	}
	return undefined;
}

/** The types of entries, as a person names one and many. */
const NOUNS = /** @type {Record<string, [string, string]>} */ ({
	note: ['note', 'notes'],
	todo: ['todo', 'todos'],
	article: ['article', 'articles'],
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

/** A share's who for everyone: the Public group's. */
export const EVERYONE = 'everyone';

/** The types of the entries that name a vault, its profile, which everyone reads by default: a vault's own device
 *  shares them Public as it names a vault it just founded, signed with its owner's key, and its owners may take that
 *  back in its settings (Samuel 2026-10-18: "the profile is set to public by default"). Nobody else can. */
export const NAME_TYPES = ['profile'];

/** The share that lets everyone read vault `vault`'s name, as world `w` shows its shares, if it has one.
 *  @param {WorldView} w @param {string} vault */
export const nameShared = (w, vault) =>
	w.shares.find(
		(c) => c.over === vault && c.who === EVERYONE && [...(/** @type {any} */ (c.slice?.where)?.type ?? [])].sort().join() === NAME_TYPES.join()
	);

/** The op by which vault `vault` lets everyone read its name. @param {string} vault */
export const nameShare = (vault) => ({
	op: 'share',
	over: vault,
	who: EVERYONE,
	level: 'Public',
	what: { type: NAME_TYPES },
	as: vault
});

/**
 * What the name of a standing grant starts with (avendb's `world::STANDING`): a share on the whole of the person's
 * vault given for "all my vaults, now and later", which every vault founded under it from then on gives too, and every
 * share that followed it, named the same. Its group's name follows.
 */
export const STANDING = 'avendb:standing:';

/** Whether a share named `name` is a standing grant, or followed one. @param {string | null | undefined} name */
export const isStanding = (name) => !!name?.startsWith(STANDING);

/** A share's name as a person reads it: a standing grant's without its mark. @param {string | null | undefined} name */
export const plainName = (name) => (isStanding(name) ? (name ?? '').slice(STANDING.length) : name);

/**
 * The ops of a standing grant at `level`, all of the person's vaults in world `world`, now and later, to `agent`, a
 * device vault of their aven `aven`: their vault's to the aven, then the aven's, resting on it, to the agent (the
 * `share` op's `standing`). Every vault they own follows both now, and every vault they found later follows them as it
 * is founded. A Suggester's brings an AIP author's share beside it over each vault of theirs it reaches now
 * (`aipAuthorOps`); one they found later follows the Suggester's alone.
 * @param {WorldView} world @param {string} aven @param {string} agent @param {string} level
 */
export const standingOps = (world, aven, agent, level) => [
	{ op: 'share', over: world.mine, who: { vault: aven }, level, standing: true, as: world.mine },
	{ op: 'share', over: world.mine, who: { vault: agent }, level, standing: true, as: aven },
	...(level === SUGGESTS ? theirsNow(world).flatMap((v) => aipAuthorOps(world, v, aven, agent)) : [])
];

/**
 * The level whose agents also open AIPs: a Suggester writes only on proposals, where it may propose new entries too
 * (drafts, which its vault lands as it accepts them), and bundles its lines in an AIP.
 */
export const SUGGESTS = 'Suggester';

/**
 * What a Suggester's share made before drafts is called (avendb's `rules::suggester_before_drafts`): avenDB still
 * names it Suggester, and it still reads, writes on proposals and starts them, but it proposes no new entry, as it
 * lacks `create` on proposals (`drafts` false). The Mac's agent grant passes its agents' on again in the new form; one
 * given by hand is given again to propose new entries.
 */
export const OLD_SUGGESTER = 'Suggester (before drafts)';

/**
 * A group's name, a Suggester's made before drafts told apart.
 * @param {string} name @param {boolean | null} [drafts]
 */
const groupName = (name, drafts) => (name === SUGGESTS && drafts === false ? OLD_SUGGESTER : name);

/**
 * The group of its own an agent given Suggester over a vault gets there besides (avendb-device's `agent::aip_author`):
 * it adds an entry and sets its fields, on the vault's AIPs alone (`AIPS`), so it opens AIPs over the proposal lines it
 * wrote and promotes them as their author, while the vault alone reviews them.
 */
export const AIP_AUTHOR = { name: 'AIP author', ops: [{ op: 'create' }, { op: 'set', path: [] }] };

/** What an AIP author's share is on: the vault's AIPs, its entries of type `aip`. */
export const AIPS = { type: ['aip'] };

/**
 * The vaults of the person's a standing grant reaches now: their own, and each their vault owns, but those that act
 * for their one owner alone (an aven, a device vault).
 * @param {WorldView} world
 */
const theirsNow = (world) =>
	world.vaults.filter((v) => (v.id === world.mine || v.via?.length) && !oneOwner(world, v.kind)).map((v) => v.id);

/**
 * The ops that give `agent`, a device vault of the person's aven `aven`, an AIP author's share over vault `over`, beside
 * the Suggester's it gets there, as the Mac's grant does (avendb-device's `agent::pass_on_aips`): the aven's to the
 * agent, acting as the aven, resting on one the aven holds there that gives all it gives (the `share` op rests a share
 * on such a one first): an AIP author's, or an Editor's on the whole vault. Over a vault of the person's, `over` gives
 * the aven its AIP author's share first where it holds neither, acting as itself; over the aven, the aven's own; over
 * another, as a coop that hired the aven, none where the aven holds neither there. None where the agent holds one
 * already.
 * @param {WorldView} world @param {string} over @param {string} aven @param {string} agent
 */
export function aipAuthorOps(world, over, aven, agent) {
	/** @param {CapView} c @param {string} who */
	const author = (c, who) => c.over === over && c.who === who && c.slice?.name === AIP_AUTHOR.name;
	if (world.shares.some((c) => author(c, agent))) return [];
	/** @param {string} who @param {string} as */
	const share = (who, as) => ({ op: 'share', over, who: { vault: who }, level: AIP_AUTHOR, what: AIPS, as });
	const editor = (/** @type {CapView} */ c) => c.over === over && c.who === aven && c.wide && c.group === 'Editor';
	if (over === aven || world.shares.some((c) => author(c, aven) || editor(c))) return [share(agent, aven)];
	const theirs = over === world.mine || owns(world, world.mine, over);
	return theirs ? [share(aven, over), share(agent, aven)] : [];
}

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

/** A share's who, as a person reads it. @param {CapView} c @param {WorldView} world */
export const granteeOf = (c, world) => whoName(c.who, world);

/** Who a row of the `shares` op names, as a person reads it. @param {ShareRow['who']} who @param {WorldView} world */
export function whoOf(who, world) {
	if (who === EVERYONE) return 'Everyone';
	if ('vault' in who) return nameOf(world.vaults.find((v) => v.id === who.vault));
	if ('invite' in who) return 'An invite no one claimed yet';
	return signerName(world, 'signer' in who ? who.signer : who.device, true);
}

/**
 * A rule's place in words, at any depth (./paths.js `pathWords`): "anything", "its status", "any row of its blocks",
 * "the text of any row of the kids of any row of its nodes".
 * @param {Op['path']} path
 */
const placeWords = (path = []) => pathWords(path);

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
		case 'merge': {
			const only = r.path?.length ? `, changes to ${placeWords(r.path)} only` : '';
			if (r.on === 'main') return `merge proposals into the main line${only}`;
			return `${r.on === 'proposals' ? 'bring the main line into a proposal' : 'merge one line into another'}${only}`;
		}
		case 'propose':
			return 'start proposals';
		case 'create':
			return r.on === 'proposals' ? 'propose new entries' : `add new entries${on}`;
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

/**
 * Ops in words: "read, set its status to “done” and add new entries"; a Suggester's "read, propose new entries, change
 * anything on a proposal, start proposals and bring the main line into a proposal".
 * @param {Op[]} ops
 */
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
	if (g) return g.everyone ? roleGroup(world, g.level) : groupName(g.name, c.drafts);
	return c.group ?? plainName(c.slice?.name) ?? roleGroup(world, c.level);
}

/** What a share does that opens nothing, beside its level's name. */
export const KEEPS = /** @type {Record<string, string>} */ ({
	backup: 'keeps an encrypted copy',
	relay: 'connects only',
	keepWhole: 'syncs it and keeps its files whole',
	keepOpened: 'syncs it and fetches its files as they open',
	keepNever: 'doesn’t sync it'
});

/** What a share is on: "Everything", or what its slice picks, in words. @param {CapView} c @param {WorldView} world */
export const shareWhat = (c, world) => (c.whole ? 'Everything' : whereWords(c.slice?.where, world));

/** The kind of record each type of entry holds. */
const KIND_OF = /** @type {Record<string, string>} */ ({
	note: 'document',
	todo: 'todo',
	article: 'article',
	file: 'file',
	card: 'card',
	profile: 'profile'
});

/**
 * The fields of the newest schema of the records of entries of type `type`, of those a vault's entries are read through
 * (the `schemas` op's answer: the one no lens reads on to a newer one), at any depth (./paths.js `fieldPaths`): each
 * field of the record and of the rows of its lists of records, by its path, "*" for any row, in words, with the values
 * it takes where it takes only some (an enum, or true and false), and whether it is a list of records: what a rule may
 * name. Each is named by its path as JSON.
 * @param {{ schemas: { id: string, kind: string, json: string }[], lenses: { from: string }[] } | null} lane
 * @param {string} type
 * @returns {{ name: string, path: string[], words: string, values: (string | number | boolean | null)[] | null,
 *   rows: boolean }[]}
 */
export function fieldsOf(lane, type) {
	const kind = KIND_OF[type] ?? type;
	const s = lane?.schemas.find((x) => x.kind === kind && !lane.lenses.some((l) => l.from === x.id));
	try {
		const fields = s ? fieldPaths(JSON.parse(s.json)) : [];
		return fields.map((f) => ({ ...f, name: JSON.stringify(f.path), words: pathWords(f.path) }));
	} catch {
		return [];
	}
}

/**
 * A cap in words, as a share, who · level · what: "avenBOB · Viewer · todos tagged “work”", "avenMAIA ·
 * Backup · Everything", "avenBOB · Tick done · “Fix the door”: read and set its status to “done”"; a built-in group's ops go
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
	if (g) return g.everyone ? roleGroup(world, g.level) : groupName(g.name, r.drafts);
	return r.group ?? plainName(r.name) ?? roleGroup(world, r.level);
}

/**
 * What a row of the `shares` op's level does, for its title: its built-in group's hint; a Suggester's made before
 * drafts says it may not propose new entries yet; a share of its own that may propose them says so.
 * @param {ShareRow} r @param {WorldView} world
 */
export function rowHint(r, world) {
	const hint = r.group ? world.groups.find((g) => g.name === r.group)?.hint : undefined;
	if (r.group === SUGGESTS && r.drafts === false)
		return 'Reads it and suggests changes to merge; given before drafts, it may not propose new entries yet';
	return hint ?? (r.drafts ? 'May propose new entries' : undefined);
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
 * their Owner; then the who of each of those caps in force whose devices get them, and of each such cap on the
 * whole vault, by its name and the levels of its caps that read, the strongest first, and one that only keeps an
 * encrypted copy last. A Relay holder never gets an entry, and a keep share only says what a device keeps: both go
 * unsaid.
 * @param {WorldView} world @param {string} vault @param {string[]} caps @returns {Shared}
 */
export function sharedThrough(world, vault, caps) {
	const live = world.shares.filter((c) => c.over === vault && c.gets && (c.wide || caps.includes(c.id)));
	/** @type {Map<string, { levels: string[], rank: number }>} */
	const by = new Map();
	for (const c of live.sort((a, b) => order(a.level) - order(b.level))) {
		const x = by.get(c.who) ?? { levels: [], rank: STRONGEST.length };
		const level = c.reads ? levelName(c, world) : '';
		if (level && !x.levels.includes(level)) x.levels.push(level);
		by.set(c.who, { levels: x.levels, rank: Math.min(x.rank, order(c.level)) });
	}
	const who = [...by]
		.sort(([, a], [, b]) => a.rank - b.rank)
		.map(([id, x]) => ({ id, name: whoName(id, world), levels: x.levels }));
	const own = { id: vault, name: whoName(vault, world), levels: [roleGroup(world, 'owner')] };
	return { who: [own, ...who], gone: caps.filter((id) => !world.shares.some((c) => c.id === id)).length };
}

/**
 * Who entry `entry` of vault `vault` is shared with: by the caps in force that reach it, those on the whole vault too.
 * @param {WorldView} world @param {string} vault @param {string} entry
 */
export const sharedWith = (world, vault, entry) =>
	sharedThrough(world, vault, world.shares.filter((c) => c.over === vault && c.entries.includes(entry)).map((c) => c.id));

/**
 * One who entries are shared with, in words: "avenBOB (Editor)", "avenMAIA (keeps an encrypted copy)".
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
	NotAccepted: 'one of the vault’s owners accepts the proposal first, as it stands now',
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
	NotRoot: 'it needs one of the vault’s owners',
	ReadOnly: 'this device opens it read-only',
	Locked: 'this device is locked',
	BadSignature: 'a signature didn’t check',
	WrongOwnerKind: 'that vault may not own it',
	OneOwner: 'an aven or a device vault has one owner alone',
	SecondAven: 'that vault owns as many of its kind as one owner may: a person owns one aven',
	NoDevices: 'a coop holds no devices: its owners act for it',
	NotHuman: 'only a person’s vault has a root passkey',
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
