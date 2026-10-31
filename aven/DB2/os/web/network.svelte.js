// avenOS on an Aven Peer's host without a cast (PRODUCTION.md, Part A): the host's `/aven.json` names its Aven Peer
// and the passkeys' RP ID. This browser runs a Peer-Light with its own device key, made in the browser and kept in
// its OPFS (peer/worker.js), and hears from the Aven Peer whether the network is claimed and, once this browser is
// one of its devices, its tree, whose views the Peer-Light pushes (id.svelte.js). The claim and the sign-in are WebAuthn ceremonies here, on the page, since a worker
// has no `navigator.credentials`; their statements go to the Aven Peer through the worker.
import {
	askThrough,
	challenge,
	claimText,
	deviceId,
	hearViews,
	passkeyId,
	personId,
	prfInput,
	prfKeys,
	signInText,
	tree,
	validPersonName,
} from './id.svelte.js';
import { openWorker } from './peer/open.js';
import { live, take, timeline } from './peers.svelte.js';
import { hear, speakThrough } from './room.svelte.js';

// `me` and `key`: this browser's device and its key; `claimed`: null until the Aven Peer has said; `tree`: the
// network's tree as cast JSON, told to its devices only; `refused`: why the last claim or sign-in was refused;
// `trouble`: why the Peer-Light is not live, as it last said (its start failed, the Aven Peer didn't answer), shown
// under the status line so a screenshot names the cause; `door`: whether the relay lets this browser in, null until it
// has said (MILESTONE2.md: after the claim, only members get in); `storage`: why this browser keeps no storage for the
// host, when it doesn't, and then no Peer-Light starts. Offline first (README rule 3): `claimed` and the tree come at
// once from what the Peer-Light keeps (`kept`), before any link; `unreachable`: why the link to the Aven Peer was lost,
// for the timeline only, while the page says it plainly; `pending`: a statement this browser signed waits in its store
// for the network (a sign-in made offline)
export const net = $state({
	me: null,
	key: null,
	claimed: null,
	tree: null,
	refused: null,
	trouble: null,
	door: null,
	storage: null,
	reset: false,
	unreachable: null,
	pending: false,
	// the passkey's PRF step (id/caps/README.md, "Passkeys and the PRF step"): null until a ceremony has asked, then
	// whether the passkey answered; `opened`: the vault whose owner and seal keys this session derived
	prf: null,
	opened: null,
});

// A passkey without PRF never makes a vault (Samuel, 31 Oct 2026; id/caps/README.md, "Passkeys and the PRF step"):
// sign-up refuses and says why, before anything is sent or kept. No ES256-only owner path, no second kind of vault.
export const NO_PRF_MESSAGE =
	"This passkey provider can't open your vault on another device. Use a passkey provider that can, such as iCloud Keychain or Google Password Manager.";

// The owner's epoch, which the PRF input names. No register carries one yet (the tree's ops will): until then, 1.
export const ownerEpoch = (_vault) => 1;

const unhex = (s) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));

let port;
// the start this page gives its Peer-Light, sent again with every statement (peer/worker.js)
let starting;

// The host's Aven Peer, or null on a host that has none (a visitor's: avenOS is "coming soon" there). Kept in this
// browser once read, so a page that can't reach its host still knows its network and opens offline
export async function hostNetwork() {
	const kept = () => {
		try {
			return JSON.parse(localStorage.getItem('aven.json') ?? 'null');
		} catch {
			return null;
		}
	};
	try {
		const answer = await fetch('/aven.json', { cache: 'no-store' });
		if (!answer.ok || !answer.headers.get('content-type')?.includes('json')) return null;
		const config = await answer.json();
		if (!config.peer || !config.rpId) return null;
		try {
			localStorage.setItem('aven.json', JSON.stringify(config));
		} catch {}
		return config;
	} catch {
		return kept();
	}
}

// Whether this browser may keep storage for the host: the Peer-Light's device key lives in its OPFS. Firefox throws a
// SecurityError from `getDirectory` when cookies and site data are blocked for the site, or it always browses privately
// (Samuel's Firefox on macOS, 30 Oct 2026: "Security error when calling GetDirectory" under "Connecting to the
// network…", where Chrome joined with the same link). Asked on the page, before the
// Peer-Light starts, so avenOS can say so plainly. Returns the technical reason, or null.
export async function storageBlocked() {
	try {
		if (!navigator.storage?.getDirectory) return 'this browser has no origin private file system (navigator.storage.getDirectory)';
		await navigator.storage.getDirectory();
		return null;
	} catch (error) {
		return `${error?.name ?? 'Error'}: ${error?.message ?? error}`;
	}
}

export function runNetwork(config) {
	timeline.box = false;
	const opened = openWorker('network');
	port = opened.port;
	const worker = opened.worker;
	worker.onerror = (event) => (net.trouble = `the Peer-Light's worker didn't load: ${event?.message || 'no reason given'}`);
	// a worker that says nothing at all is a cause too
	const silent = setTimeout(() => (net.trouble ??= 'the Peer-Light has said nothing for 15 s'), 15000);
	port.onmessage = ({ data }) => {
		clearTimeout(silent);
		const line = JSON.parse(data);
		hearViews(line);
		if (line.event === 'views' || line.event === 'answer') return;
		// a lost link is the network out of reach: said plainly on the page, its reason kept in the timeline
		if (line.event === 'lost') net.unreachable = line.why ?? line.event;
		if (line.event === 'failed') net.trouble = line.why ?? line.event;
		if (line.event === 'status' && line.phase === 'live') net.trouble = net.unreachable = null;
		if (line.event === 'pending') net.pending = true;
		if (line.event === 'started') Object.assign(net, { me: line.peer, key: line.key });
		if (line.event === 'network') Object.assign(net, { claimed: line.claimed, tree: line.tree });
		if (line.event === 'start?' && starting) port.postMessage({ start: starting });
		if (line.event === 'refused') Object.assign(net, { refused: line.why, pending: false });
		if (line.event === 'reset') net.reset = true;
		if (line.event === 'signed-out' && !signingOut) setTimeout(() => location.reload(), 2000);
		if (line.event === 'door') net.door = line.admitted;
		if (line.event === 'status' || line.event === 'failed') live.own = line.event === 'failed' ? { ...line, phase: 'offline', peers: 0 } : line;
		if (line.event === 'stored') live.ownStored = line;
		if (line.peer === net.me) take(line);
		hear(line);
	};
	starting = { name: '', secret: 'opfs', avenKey: config.peer, avenName: 'aven-peer' };
	speakThrough(port, starting);
	askThrough(port, starting);
	port.start?.();
	port.postMessage({ start: starting });
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unbase64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// The passkey signs a statement's text: its challenge is the text's SHA-256, so the assertion holds for nothing else.
// Given a vault, the same ceremony asks the passkey's PRF for that vault's owner at its epoch.
export async function assertion(config, text, credential, vault) {
	const allowCredentials = credential ? [{ type: 'public-key', id: credential }] : [];
	const extensions = vault ? { prf: { eval: { first: unhex(await prfInput(vault, ownerEpoch(vault))) } } } : undefined;
	const got = await navigator.credentials.get({
		publicKey: { challenge: unbase64url(await challenge(text)), rpId: config.rpId, userVerification: 'required', allowCredentials, extensions },
	});
	const r = got.response;
	if (vault) await openWith(vault, got);
	return {
		clientData: new TextDecoder().decode(r.clientDataJSON),
		authData: hex(r.authenticatorData),
		signature: hex(r.signature),
		credential: got.rawId,
	};
}

// The PRF output goes straight into the Peer-Light, which derives the owner and seal keys and keeps only their public
// halves; the page's copy is wiped at once. Whether the passkey answered is learnt here, never guessed (`net.prf`).
async function openWith(vault, got) {
	const first = got.getClientExtensionResults?.().prf?.results?.first;
	net.prf = !!first;
	if (!first) return;
	const output = new Uint8Array(first);
	try {
		await prfKeys(vault, ownerEpoch(vault), output);
		net.opened = vault;
	} finally {
		output.fill(0);
		if (first instanceof ArrayBuffer) new Uint8Array(first).fill(0);
	}
}

export function send(frame) {
	net.refused = null;
	port.postMessage({ start: starting, send: JSON.stringify(frame) });
}

// Sign up, so claim the network if nobody has: the person's name, then a new passkey (ES256, attestation none, its
// public key from getPublicKey(), so no CBOR), then its assertion over the claim, which names it, the person's vault
// and their name, and this browser (PRODUCTION.md, Part C). The claim founds `<name>'s vault`, the admin coop it owns
// (the Aven Peer's to name) and this browser as `<name>'s browser`.
// The Aven Peer decides only which signup came first, and its word never deletes a passkey: so none is made when the
// network is known to be claimed, unless the signup is deliberate (`#/claim`, where the Aven Peer refuses it). A race
// can still leave the loser a passkey that owns nothing, which its person can remove in their passkey manager.
export async function claim(config, { name, deliberate = false }) {
	if (net.claimed && !deliberate) throw new Error('this network is claimed already');
	name = name.trim();
	if (!(await validPersonName(name))) throw new Error('a name is 1 to 48 characters, without control characters');
	const created = await navigator.credentials.create({
		publicKey: {
			rp: { id: config.rpId, name: 'Aven' },
			user: { id: crypto.getRandomValues(new Uint8Array(16)), name, displayName: name },
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
			authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
			attestation: 'none',
			extensions: { prf: {} },
		},
	});
	// a platform that says outright it has no PRF stops here, before anything is signed
	if (created.getClientExtensionResults?.().prf?.enabled === false) {
		net.prf = false;
		throw new Error(NO_PRF_MESSAGE);
	}
	if (created.response.getPublicKeyAlgorithm() !== -7) throw new Error('the passkey is not ES256');
	const spki = hex(created.response.getPublicKey());
	const statement = {
		network: config.network,
		person: await personId(spki),
		name,
		passkey: { id: await passkeyId(spki), spki },
		device: { id: await deviceId(net.key), key: net.key },
	};
	const text = await claimText(statement.network, statement.person, name, statement.passkey.id, spki, statement.device.id, net.key);
	// the claim's own assertion asks the PRF too, for the vault it founds: no extra tap at sign-up
	const { credential: _, ...signed } = await assertion(config, text, created.rawId, statement.person);
	if (!net.prf) throw new Error(NO_PRF_MESSAGE);
	statement.assertion = signed;
	send({ frame: 'claim', statement: JSON.stringify(statement) });
}

// Sign in with your passkey, the admin's or a member's: this browser becomes one more device of the vault it owns. The
// page asks for any passkey of this RP ID and needn't know whose: the Aven Peer finds the vault by the assertion
// (Aven.ID.SignIn), and a passkey that owns none is refused with a word to ask for an invite.
// A new browser doesn't know its vault before the passkey answers, so the PRF waits for a second tap: once the network
// has taken the sign-in and told this device its tree, `openVault` asks the same passkey for its vault's PRF output.
let signedInWith = null;
export async function signIn(config) {
	const statement = { network: config.network, device: { id: await deviceId(net.key), key: net.key } };
	const { credential, ...signed } = await assertion(config, await signInText(config.network, statement.device.id, net.key));
	signedInWith = credential;
	statement.assertion = signed;
	send({ frame: 'sign_in', statement: JSON.stringify(statement) });
}

// The second tap on a new browser, and the first in a later session: the passkey's PRF for the vault this device acts
// for opens its owner and seal keys in the Peer-Light. Its assertion signs only a fresh challenge and goes nowhere.
export async function openVault(config) {
	const vault = net.me && tree.actsFor(net.me);
	if (!vault) throw new Error('this browser acts for no vault yet');
	const allowCredentials = signedInWith ? [{ type: 'public-key', id: signedInWith }] : [];
	const got = await navigator.credentials.get({
		publicKey: {
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			rpId: config.rpId,
			userVerification: 'required',
			allowCredentials,
			extensions: { prf: { eval: { first: unhex(await prfInput(vault, ownerEpoch(vault))) } } },
		},
	});
	await openWith(vault, got);
	if (!net.prf) throw new Error(NO_PRF_MESSAGE);
	return vault;
}

// Sign out of this browser: the Peer-Light's worker ends, then this origin's storage, where its device key lives, is
// cleared, so this browser acts for nobody and offers "Sign in with your passkey" again. The device stays in the tree
// until devices can be revoked (milestone 3), but nobody holds its key any more. Every other tab of avenOS here
// reloads once the worker has ended (`signed-out`).
let signingOut = false;
export async function signOut() {
	signingOut = true;
	port.postMessage({ start: starting, end: true });
	const root = await navigator.storage.getDirectory();
	// the worker's handles go with it, a moment after it ends
	for (let tries = 0; ; tries++) {
		try {
			const names = [];
			for await (const name of root.keys()) names.push(name);
			for (const name of names) await root.removeEntry(name, { recursive: true });
			break;
		} catch (error) {
			if (tries >= 40)
				throw new Error(`this browser's data couldn't be cleared (${error?.message ?? error}): close avenOS's other tabs and try again`);
			await new Promise((done) => setTimeout(done, 250));
		}
	}
	location.replace('/');
}

// The network's devices as avenOS's apps read a cast's peers, this one by name, from the views the Peer-Light pushed
export function castOf(me) {
	const peers = {};
	for (const id of tree.vaults()) {
		if (tree.kind(id) !== 'device') continue;
		peers[id] =
			id === 'aven-peer'
				? { name: 'Aven Peer', kind: 'peer', relay: true, store: 'S3' }
				: { name: id === me ? 'This browser' : tree.name(id), kind: 'peer-light', store: 'OPFS' };
	}
	return { peers };
}
