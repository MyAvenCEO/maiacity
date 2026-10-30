// avenOS on an Aven Peer's host without a cast (PRODUCTION.md, Part A): the host's `/aven.json` names its Aven Peer
// and the passkeys' RP ID. This browser runs a Peer-Light with its own device key, made in the browser and kept in
// its OPFS (peer/worker.js), and hears from the Aven Peer whether the network is claimed and, once this browser is
// one of its devices, its tree, whose views the Peer-Light pushes (id.svelte.js). The claim and the sign-in are WebAuthn ceremonies here, on the page, since a worker
// has no `navigator.credentials`; their statements go to the Aven Peer through the worker.
import { askThrough, challenge, claimText, deviceId, hearViews, passkeyId, personId, signInText, tree, validPersonName } from './id.svelte.js';
import { openWorker } from './peer/open.js';
import { live, take, timeline } from './peers.svelte.js';
import { hear, speakThrough } from './room.svelte.js';

// `me` and `key`: this browser's device and its key; `claimed`: null until the Aven Peer has said; `tree`: the
// network's tree as cast JSON, told to its devices only; `refused`: why the last claim or sign-in was refused;
// `trouble`: why the Peer-Light is not live, as it last said (its start failed, the Aven Peer didn't answer), shown
// under the status line so a screenshot names the cause; `door`: whether the relay lets this browser in, null until it
// has said (MILESTONE2.md: after the claim, only members get in); `storage`: why this browser keeps no storage for the
// host, when it doesn't, and then no Peer-Light starts
export const net = $state({ me: null, key: null, claimed: null, tree: null, refused: null, trouble: null, door: null, storage: null, reset: false });

let port;
// the start this page gives its Peer-Light, sent again with every statement (peer/worker.js)
let starting;

// The host's Aven Peer, or null on a host that has none (a visitor's: avenOS is "coming soon" there)
export async function hostNetwork() {
	try {
		const answer = await fetch('/aven.json', { cache: 'no-store' });
		if (!answer.ok || !answer.headers.get('content-type')?.includes('json')) return null;
		const config = await answer.json();
		return config.peer && config.rpId ? config : null;
	} catch {
		return null;
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
		if (line.event === 'failed' || line.event === 'lost') net.trouble = line.why ?? line.event;
		if (line.event === 'status' && line.phase === 'live') net.trouble = null;
		if (line.event === 'started') Object.assign(net, { me: line.peer, key: line.key });
		if (line.event === 'network') Object.assign(net, { claimed: line.claimed, tree: line.tree });
		if (line.event === 'start?' && starting) port.postMessage({ start: starting });
		if (line.event === 'refused') net.refused = line.why;
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

// The passkey signs a statement's text: its challenge is the text's SHA-256, so the assertion holds for nothing else
export async function assertion(config, text, credential) {
	const allowCredentials = credential ? [{ type: 'public-key', id: credential }] : [];
	const got = await navigator.credentials.get({
		publicKey: { challenge: unbase64url(await challenge(text)), rpId: config.rpId, userVerification: 'required', allowCredentials },
	});
	const r = got.response;
	return { clientData: new TextDecoder().decode(r.clientDataJSON), authData: hex(r.authenticatorData), signature: hex(r.signature) };
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
		},
	});
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
	statement.assertion = await assertion(config, text, created.rawId);
	send({ frame: 'claim', statement: JSON.stringify(statement) });
}

// Sign in with your passkey, the admin's or a member's: this browser becomes one more device of the vault it owns. The
// page asks for any passkey of this RP ID and needn't know whose: the Aven Peer finds the vault by the assertion
// (Aven.ID.SignIn), and a passkey that owns none is refused with a word to ask for an invite.
export async function signIn(config) {
	const statement = { network: config.network, device: { id: await deviceId(net.key), key: net.key } };
	statement.assertion = await assertion(config, await signInText(config.network, statement.device.id, net.key));
	send({ frame: 'sign_in', statement: JSON.stringify(statement) });
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
