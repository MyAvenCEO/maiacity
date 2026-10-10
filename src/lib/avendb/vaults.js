/*
 * What avenDB's vault screens share: a vault's name, initials and colour, the kinds and roles as a person reads them,
 * a cap's slice in words, and what a vault may do, by the caps and roles the device's world shows (avendb-browser's
 * `World::to_json`). A vault is a flat library: its entries are in it directly, each with a type and tags, and every
 * right is a cap on a slice of it, a selector over those (avendb-browser's `words`). The rules themselves are the
 * device's: every edit is checked against the acting vault's caps, as any peer checks it; these only say beforehand
 * what the page offers.
 */

/** @typedef {'human' | 'coop' | 'aven'} Kind */
/** @typedef {'relay' | 'read' | 'write' | 'owner'} Role */
/** @typedef {{ id: string, name?: string | null, me: boolean }} DeviceView */
/**
 * @typedef {{ id: string, kind: Kind, name: string | null, owners: ({ vault: string } | { signer: string })[],
 *   threshold: number, root: string | null, devices: DeviceView[], via: string[] | null }} VaultView
 */
/**
 * A test of a selector: an object of one field (avendb-browser's `words`).
 * @typedef {{ type: string[] } | { author: string[] } | { entry: string[] } | { created: [number, number] } |
 *   { tag: string } | { noTag: string[] } | { onlyTags: string[] }} Atom
 */
/** @typedef {'all' | Atom[][]} Selector */
/** @typedef {{ select: Selector, relabel: string[] }} Slice */
/**
 * @typedef {{ id: string, over: string, issuer: string, grantee: string, role: Role, wide: boolean,
 *   parent: string | null, chain: string[], slice: Slice | null, revokers: string[], entries: string[] }} CapView
 */
/** @typedef {{ device: string, through: string, opens: boolean }} Syncing */
/**
 * @typedef {{ id: string, vault: string, caps: string[], generation: number, entries: string[], readers: string[],
 *   public: boolean, syncs: Syncing[] }} CellView
 */
/**
 * @typedef {{ entry: string, vault: string, by: string, type: string | null, tags: string[] | null,
 *   created: number | null, cell: string, public: boolean, roles: Record<string, Role>,
 *   kind: 'note' | 'todo' | 'sealed', title: string | null, text: string | null,
 *   status: 'open' | 'doing' | 'done' | null, variantOf: string | null, edits: number, proposals: number }} EntryView
 */
/**
 * @typedef {{ me: string, mine: string, pqOnly: boolean, vaults: VaultView[], caps: CapView[], cells: CellView[],
 *   entries: EntryView[] }} WorldView
 */

/** Each role ranked: each includes the ones before it. */
const RANK = { relay: 1, read: 2, write: 3, owner: 4 };

/** Whether `role` allows `need`. @param {Role | null | undefined} role @param {Role} need */
export const allows = (role, need) => !!role && RANK[role] >= RANK[need];

/** The roles, the strongest first. */
export const STRONGEST = /** @type {const} */ (['owner', 'write', 'read', 'relay']);

/** The kinds, as a person reads them. */
export const KINDS = /** @type {const} */ ({ human: 'Human vault', coop: 'Coop vault', aven: 'Aven vault' });

/** What each kind is. */
export const KIND_HINTS = /** @type {const} */ ({
	human:
		"A person's vault. Its root is their passkey, which approves every change to it and is its only recovery; its devices act for it.",
	aven: "An aven: an agent's or a server's own vault, owned by human or coop vaults. It owns no vault itself.",
	coop: 'A coop: owned by human or coop vaults, with no devices of its own. It acts only through its owners.'
});

/** The roles, as a person reads them. */
export const ROLES = /** @type {const} */ ({
	relay: 'relays',
	read: 'reads',
	write: 'writes',
	owner: 'owns'
});

/** What each role allows. */
export const ROLE_HINTS = /** @type {const} */ ({
	relay: 'Keeps and forwards the ciphertext, and opens nothing: the server’s role',
	read: 'Opens and reads it',
	write: 'Reads and writes, and adds entries that fall in it',
	owner: 'Reads, writes, and shares it on: your passkey approves making a vault owner'
});

/** The first characters of an id, enough to tell two apart. @param {string | null | undefined} id */
export const short = (id) => (id ? `${id.slice(0, 4)} ${id.slice(4, 8)}` : '');

/** Vault `v`'s name, or what it is while it has none. @param {VaultView | undefined} v */
export const nameOf = (v) => (v ? (v.name ?? `${KINDS[v.kind]} ${short(v.id)}`) : 'A vault this browser doesn’t know');

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

/** Names as a person lists them: "a, b and c". @param {string[]} names @param {string} [and] */
export const list = (names, and = 'and') =>
	names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;

/** A tag or a title in quotes. @param {string} t */
const quote = (t) => `“${t}”`;

/**
 * Whether vault `actor` reads entry `e`: everyone may, or it holds read or more on it.
 * @param {EntryView} e @param {string} actor
 */
export const reads = (e, actor) => e.public || allows(e.roles[actor], 'read');

/**
 * Whether vault `actor` holds anything in vault `v`, or is it: a cap over it, to it or to everyone, or an entry of it
 * it reads.
 * @param {WorldView} world @param {string} v @param {string} actor
 */
export function reaches(world, v, actor) {
	if (v === actor) return true;
	return (
		world.caps.some((c) => c.over === v && (c.grantee === actor || c.grantee === 'public')) ||
		world.entries.some((e) => e.vault === v && reads(e, actor))
	);
}

/** The vaults that hold a role on an entry, the strongest first. @param {Record<string, Role>} roles */
export const holders = (roles) =>
	Object.entries(roles)
		.map(([id, role]) => ({ id, role }))
		.sort((a, b) => STRONGEST.indexOf(a.role) - STRONGEST.indexOf(b.role));

/** The types of entries, as a person names one and many. */
const NOUNS = /** @type {Record<string, [string, string]>} */ ({
	note: ['note', 'notes'],
	todo: ['todo', 'todos'],
	card: ['device card', 'device cards'],
	profile: ['profile', 'profiles']
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

/**
 * A slice in words: "todos tagged “work”", "the whole vault", or "a slice sealed from this device" where the device
 * doesn't read it, as its selector is sealed to the vault, its grantee and its issuer alone.
 * @param {Slice | null} slice @param {WorldView} world
 */
export function sliceWords(slice, world) {
	if (!slice) return 'a slice sealed from this device';
	if (slice.select === 'all') return 'the whole vault';
	if (!slice.select.length) return 'nothing';
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
	return slice.select.map(conjunction).join('; or ');
}

/** The tags of a slice's grantee may ask the vault's devices to add or remove, in words. @param {Slice | null} slice */
export const relabelWords = (slice) =>
	slice?.relabel.length ? `may ask to tag ${list(slice.relabel.map(quote), 'or')}` : '';

/** A cap's grantee, as a person reads it. @param {CapView} c @param {WorldView} world */
export const granteeOf = (c, world) => (c.grantee === 'public' ? 'Everyone' : nameOf(world.vaults.find((v) => v.id === c.grantee)));

/** A cap in words: "avenBOB reads todos tagged “work”". @param {CapView} c @param {WorldView} world */
export const capWords = (c, world) => `${granteeOf(c, world)} ${ROLES[c.role]} ${sliceWords(c.slice, world)}`;

/**
 * What a selector tests of an entry, as the device's `slice::Attrs`: its type, the vault that created it, its id, when
 * it was created (seconds since 1970) and its tags now.
 * @typedef {{ type: string, author: string, entry: string | null, created: number, tags: string[] }} Attrs
 */

/** Whether one test passes for `a`. @param {Atom} t @param {Attrs} a */
function passes(t, a) {
	if ('type' in t) return t.type.includes(a.type);
	if ('author' in t) return t.author.includes(a.author);
	if ('entry' in t) return !!a.entry && t.entry.includes(a.entry);
	if ('created' in t) return t.created[0] <= a.created && a.created < t.created[1];
	if ('tag' in t) return a.tags.includes(t.tag);
	if ('noTag' in t) return !t.noTag.some((x) => a.tags.includes(x));
	if ('onlyTags' in t) return a.tags.every((x) => t.onlyTags.includes(x));
	return false;
}

/** Whether selector `s` holds an entry of attributes `a`, as `avendb::slice::Selector::matches`. @param {Selector} s @param {Attrs} a */
export const matches = (s, a) => s === 'all' || s.some((d) => d.every((t) => passes(t, a)));

/** Entry `e`'s attributes, if the device reads them. @param {EntryView} e @returns {Attrs | null} */
export const attrsOf = (e) =>
	e.type === null || e.tags === null ? null : { type: e.type, author: e.by, entry: e.entry, created: e.created ?? 0, tags: e.tags };

/**
 * Whether vault `actor` may add an entry of type `type` with the tags `tags` to vault `vault`, and with which tags more:
 * the vault itself may add anything; any other vault through a cap over it it holds with write or more, whose slice
 * holds the new entry once it carries the tags its slice asks for (a tag it must carry, as "todos tagged “work”" asks
 * for "work"). The tags to add, or `null` if no cap lets it. The device decides: its rules check the cap, and the
 * vault's devices put the entry where its slice says.
 * @param {WorldView} world @param {string} vault @param {string} actor @param {string} type @param {string[]} [tags]
 * @returns {string[] | null}
 */
export function creates(world, vault, actor, type, tags = []) {
	if (vault === actor) return [];
	const now = Math.floor(Date.now() / 1000);
	for (const c of world.caps) {
		if (c.over !== vault || c.grantee !== actor || !allows(c.role, 'write')) continue;
		if (c.wide || !c.slice) return [];
		const select = c.slice.select;
		if (select === 'all') return [];
		for (const d of select) {
			const more = d.flatMap((t) => ('tag' in t && !tags.includes(t.tag) ? [t.tag] : []));
			const a = { type, author: actor, entry: null, created: now, tags: [...tags, ...new Set(more)] };
			if (d.every((t) => passes(t, a))) return [...new Set(more)];
		}
	}
	return null;
}

/**
 * Whether vault `actor` may share what it holds of vault `vault` on: it is the vault, or holds an owner cap over it,
 * on which the new cap then rests (and reaches no further than it).
 * @param {WorldView} world @param {string} vault @param {string} actor
 */
export const shares = (world, vault, actor) =>
	vault === actor || world.caps.some((c) => c.over === vault && c.grantee === actor && c.role === 'owner');

/**
 * The tags vault `actor` may add to or remove from entry `e`: any, as the vault itself, whose devices tag its entries
 * at once (`'any'`); else those its caps over the vault let it ask the vault's devices for, of the caps with write or
 * more that reach the entry.
 * @param {WorldView} world @param {EntryView} e @param {string} actor @returns {'any' | string[]}
 */
export function tagging(world, e, actor) {
	if (e.vault === actor) return 'any';
	const caps = world.caps.filter((c) => c.over === e.vault && c.grantee === actor && allows(c.role, 'write'));
	return [...new Set(caps.filter((c) => c.entries.includes(e.entry)).flatMap((c) => c.slice?.relabel ?? []))];
}

/** The tags of `entries`, as many as carry each, the most used first. @param {EntryView[]} entries */
export function tagsOf(entries) {
	const n = new Map();
	for (const e of entries) for (const t of e.tags ?? []) n.set(t, (n.get(t) ?? 0) + 1);
	return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, uses]) => ({ tag, uses }));
}

/** Tags as a person types them: split at commas and spaces, each once. @param {string} text */
export const tagsIn = (text) => [...new Set(text.split(/[\s,]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean))];

/**
 * A cell in words: the entries of a vault the same caps reach, under one key. Its own, where no cap reaches it beside
 * the vault's caps on the whole of it; else what reaches it.
 * @param {CellView | undefined} x @param {WorldView} world
 */
export function cellWords(x, world) {
	if (!x) return 'a cell this device doesn’t know';
	const caps = x.caps.map((id) => world.caps.find((c) => c.id === id)).filter((c) => !!c);
	if (!x.caps.length) return 'Its own entries: no cap but those on the whole vault reaches them';
	if (!caps.length) return `Reached by ${count(x.caps.length, 'cap')} no longer in force`;
	return `Shared: ${list(caps.map((c) => capWords(c, world)), 'and')}`;
}

/** Why the rules refused an edit, as a person reads it (avendb's `Refusal`). */
const WHY = /** @type {const} */ ({
	NoCap: 'the acting vault holds no cap for it',
	NotActing: 'this browser doesn’t act for that vault',
	BelowThreshold: 'it needs the approval of the vault’s owners',
	NoConsent: 'someone it names hasn’t signed it',
	BadParent: 'the acting vault’s own right to share it isn’t in force',
	PublicBeyondRead: 'everyone may only read',
	CapToSigner: 'caps go to vaults, never to a key',
	CapToItself: 'a vault holds every right over itself already',
	UnknownVault: 'this browser doesn’t know that vault yet',
	UnknownCap: 'that cap isn’t in force',
	UnknownEntry: 'this browser doesn’t know that entry yet',
	Revoked: 'that cap was revoked already',
	ReadOnly: 'this browser opens it read-only',
	Locked: 'this browser is locked',
	BadSignature: 'a signature didn’t check',
	WrongOwnerKind: 'that vault may not own it',
	Cycle: 'a vault would own itself'
});

/** An error's message with a refusal's reason in words. @param {string} message */
export function plain(message) {
	const m = /^(.*?):?\s*\b([A-Z][A-Za-z]+)\b\s*$/.exec(message);
	const why = m && WHY[/** @type {keyof typeof WHY} */ (m[2])];
	return why ? `${m[1].replace(/^\w/, (c) => c.toUpperCase())}: ${why}.` : message;
}
