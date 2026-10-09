/*
 * What avenDB's vault screens share: a vault's name, initials and colour, the kinds and roles as a person reads them,
 * and what a vault may do, by the roles the device's world shows (avendb-browser's `World::to_json`). The rules
 * themselves are the device's: every op is checked against the acting vault's caps, as any peer checks it; these only
 * say beforehand what the page offers.
 */

/** @typedef {'human' | 'coop' | 'aven'} Kind */
/** @typedef {'relay' | 'read' | 'write' | 'owner'} Role */
/** @typedef {{ id: string, name?: string | null, me: boolean }} DeviceView */
/**
 * @typedef {{ id: string, kind: Kind, name: string | null, owners: ({ vault: string } | { signer: string })[],
 *   threshold: number, root: string | null, devices: DeviceView[], via: string[] | null, home: string | null }} VaultView
 */
/**
 * @typedef {{ id: string, role: Role, grantee: string, issuer: string, entry: string | null, parent: string | null,
 *   revokers: string[] }} GrantView
 */
/**
 * @typedef {{ entry: string, by: string | null, public: boolean, roles: Record<string, Role>,
 *   kind: 'note' | 'todo' | 'sealed', title: string | null, text: string | null,
 *   status: 'open' | 'doing' | 'done' | null, variantOf: string | null, edits: number, proposals: number }} ItemView
 */
/**
 * @typedef {{ id: string, founder: string, public: boolean, roles: Record<string, Role>, grants: GrantView[],
 *   syncs: { device: string, through: string, opens: boolean }[], items: ItemView[] }} SpaceView
 */
/** @typedef {{ me: string, mine: string, pqOnly: boolean, vaults: VaultView[], spaces: SpaceView[] }} WorldView */

/** Each role ranked: each includes the ones before it. */
const RANK = { relay: 1, read: 2, write: 3, owner: 4 };

/** Whether `role` allows `need`. @param {Role | null | undefined} role @param {Role} need */
export const allows = (role, need) => !!role && RANK[role] >= RANK[need];

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
	write: 'Reads and writes',
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

/**
 * Whether vault `actor` reads item `item`: everyone may, or it holds read or more on it.
 * @param {ItemView} item @param {string} actor
 */
export const reads = (item, actor) => item.public || allows(item.roles[actor], 'read');

/**
 * Whether vault `actor` holds any cap in vault `v`'s spaces, or is it.
 * @param {WorldView} world @param {string} v @param {string} actor
 */
export function reaches(world, v, actor) {
	if (v === actor) return true;
	return world.spaces.some(
		(s) => s.founder === v && (s.public || s.roles[actor] || s.items.some((i) => i.public || i.roles[actor]))
	);
}

/** One, or many, of a thing. @param {number} n @param {string} one @param {string} [many] */
export const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Names as a person lists them: "a, b and c". @param {string[]} names */
export const list = (names) =>
	names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Why the rules refused an op, as a person reads it (avendb's `Refusal`). */
const WHY = /** @type {const} */ ({
	NoCap: 'the acting vault holds no cap for it',
	NotActing: 'this browser doesn’t act for that vault',
	BelowThreshold: 'it needs the approval of the vault’s owners',
	NoConsent: 'someone it names hasn’t signed it',
	BadParent: 'the acting vault’s own right to share it isn’t in force',
	PublicBeyondRead: 'everyone may only read',
	GrantToSigner: 'caps go to vaults, never to a key',
	UnknownVault: 'this browser doesn’t know that vault yet',
	UnknownSpace: 'this browser doesn’t know that space yet',
	UnknownGrant: 'that grant isn’t in force',
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
