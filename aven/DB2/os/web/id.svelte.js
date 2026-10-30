// avenOS's views of the vault tree, as this origin's Peer-Light pushes them (README rules 1 and 8): one snapshot of
// every view (whom this host may act as, each vault's name, kind, owners, what it owns, governs and sees, whom it acts
// for and through), stamped with the head it is correct at (`at`), and a new one whenever the tree changes
// (peer/light/src/views.rs). The page only looks answers up here and never asks again; until the first snapshot
// arrives it knows no vault. Who may act for whom is avenID's, inside the Peer-Light: the page has no WebAssembly of
// its own. Only how a page names things stays here.
let shown = $state.raw(null);
let index = new Map();

// The worker's lines: a `views` line is the new snapshot, an `answer` line the Peer-Light's answer to an ask
export function hearViews(line) {
	// a snapshot of the same tree for the same device is no change
	if (line.event === 'views' && line.vaults && (line.at !== shown?.at || line.device !== shown?.device)) {
		index = new Map(line.vaults.map((vault) => [vault.id, vault]));
		shown = line;
	}
	if (line.event === 'answer') answered(line);
}

// Whether a snapshot has arrived, and the head it is correct at
export const ready = () => shown !== null;
export const at = () => shown?.at ?? null;

const vault = (id) => (shown && index.get(id)) || null;
const list = (id, field) => vault(id)?.[field] ?? [];

// The tree as avenOS's apps read it: answers looked up in the snapshot, an unknown vault has none
export const tree = {
	vaults: () => shown?.vaults.map((v) => v.id) ?? [],
	has: (id) => Boolean(vault(id)),
	name: (id) => vault(id)?.name ?? null,
	kind: (id) => vault(id)?.kind ?? null,
	owners: (id) => list(id, 'owners'),
	key: (id) => shown?.keys[id] ?? null,
	owned: (id) => list(id, 'owned'),
	governs: (id) => list(id, 'governs'),
	chain: (id) => list(id, 'chain'),
	actsFor: (id) => vault(id)?.actsFor ?? null,
	actsThrough: (id) => list(id, 'actsThrough'),
	sees: (id) => list(id, 'sees'),
	// whom this host may act as: the person its device serves, or every person from the box's own view
	accounts: () => shown?.accounts ?? [],
};

export const vaultName = (id) => tree.name(id) ?? id;
// A vault's owners as the cast writes them, `key:<id>` or `vault:<id>`, split for the page.
export const owners = (id) =>
	tree.owners(id).map((owner) => {
		const [kind, of] = owner.split(':');
		return { kind, id: of };
	});
// An owner as a person reads it: another vault by name, a key by the start of its public half.
export const ownerName = (owner) => (owner.kind === 'vault' ? vaultName(owner.id) : `key ${tree.key(owner.id)?.slice(0, 8)}…`);

// A person's acts need what avenID computes (PRODUCTION.md, Parts A and C; MILESTONE2.md): what a passkey signs, the
// ids a browser, a passkey and a person go by, an invite's one-time key. The page runs the WebAuthn ceremony, which a
// worker can't, and asks the Peer-Light for these (peer/light/src/acts.rs); each answers once, asynchronously.
let port;
const waiting = new Map();
let asked = 0;

export function askThrough(p) {
	port = p;
}

function answered({ id, value, error }) {
	const pending = waiting.get(id);
	if (!pending) return;
	waiting.delete(id);
	if (error === undefined) pending.resolve(value);
	else pending.reject(new Error(error));
}

const ask =
	(fn) =>
	(...args) =>
		new Promise((resolve, reject) => {
			if (!port) return reject(new Error("this page runs no Peer-Light to ask"));
			const id = ++asked;
			waiting.set(id, { resolve, reject });
			port.postMessage({ ask: { id, fn, args } });
		});

export const challenge = ask('challenge');
export const claimText = ask('claimText');
export const signInText = ask('signInText');
export const deviceId = ask('deviceId');
export const passkeyId = ask('passkeyId');
export const personId = ask('personId');
export const validPersonName = ask('validPersonName');
export const inviteId = ask('inviteId');
export const inviteText = ask('inviteText');
export const withdrawText = ask('withdrawText');
export const joinText = ask('joinText');
export const oneTimePublic = ask('oneTimePublic');
export const signJoin = ask('signJoin');
