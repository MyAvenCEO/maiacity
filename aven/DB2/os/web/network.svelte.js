// avenOS on an Aven Peer's host without a cast (PRODUCTION.md, Part A): the host's `/aven.json` names its Aven Peer
// and the passkeys' RP ID. This browser runs a Peer-Light with its own device key, made in the browser and kept in
// its OPFS (peer/worker.js), and hears from the Aven Peer whether the network is claimed and, once this browser is
// one of its devices, its tree, whose views the Peer-Light pushes (id.svelte.js). The claim and the sign-in are WebAuthn ceremonies here, on the page, since a worker
// has no `navigator.credentials`; their statements go to the Aven Peer through the worker.
import { askThrough, challenge, claimText, deviceId, hearViews, passkeyId, personId, signInText, tree, validPersonName } from './id.svelte.js';
import { live, take, timeline } from './peers.svelte.js';
import { hear, speakThrough } from './room.svelte.js';

// `me` and `key`: this browser's device and its key; `claimed`: null until the Aven Peer has said; `tree`: the
// network's tree as cast JSON, told to its devices only; `refused`: why the last claim or sign-in was refused;
// `trouble`: why the Peer-Light is not live, as it last said (its start failed, the Aven Peer didn't answer), shown
// under the status line so a screenshot names the cause; `door`: whether the relay lets this browser in, null until it
// has said (MILESTONE2.md: after the claim, only members get in)
export const net = $state({ me: null, key: null, claimed: null, tree: null, refused: null, trouble: null, door: null });

let port;

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

export function runNetwork(config) {
	timeline.box = false;
	const url = new URL('./peer/worker.js', import.meta.url);
	const shared = typeof SharedWorker === 'function';
	const worker = shared ? new SharedWorker(url, { type: 'module', name: 'network' }) : new Worker(url, { type: 'module' });
	port = shared ? worker.port : worker;
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
		if (line.event === 'refused') net.refused = line.why;
		if (line.event === 'door') net.door = line.admitted;
		if (line.event === 'status' || line.event === 'failed') live.own = line.event === 'failed' ? { ...line, phase: 'offline', peers: 0 } : line;
		if (line.event === 'stored') live.ownStored = line;
		if (line.peer === net.me) take(line);
		hear(line);
	};
	speakThrough(port);
	askThrough(port);
	port.start?.();
	port.postMessage({ start: { name: '', secret: 'opfs', avenKey: config.peer, avenName: 'aven-peer' } });
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
	port.postMessage({ send: JSON.stringify(frame) });
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

// Sign in with the passkey that claimed the network: this browser becomes one more of its devices
export async function signIn(config) {
	const statement = { network: config.network, device: { id: await deviceId(net.key), key: net.key } };
	statement.assertion = await assertion(config, await signInText(config.network, statement.device.id, net.key));
	send({ frame: 'sign_in', statement: JSON.stringify(statement) });
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
