// Invites and joins, on the page (MILESTONE2.md, "Decisions"; the statements as thread A's PR #1431 states them):
// only the admin invites, an invite is a one-time Ed25519 key, and its link, `#/join/<secret>`, carries that key's
// secret. Making and withdrawing one is an owner's act on the network, signed with the passkey of a person whose vault
// owns the admin, which the statement names; joining is a statement signed by the one-time key and by the joiner's
// new passkey. What each statement's text says is aven-id's (inviteText, withdrawText, joinText, computed in the Peer-Light); the
// Aven Peer decides what it takes, and the Peer-Light tells the invites and their states (room.svelte.js). The
// one-time key is made here with WebCrypto and its secret lives only in the link. A join is sent as the claim is; the
// Peer-Light also hands it to the relay, so the door lets a newcomer in to deliver it (#1431).
import { deviceId, inviteText, joinText, oneTimePublic, owners, passkeyId, personId, signJoin, tree, validPersonName, withdrawText } from './id.svelte.js';
import { assertion, net, send } from './network.svelte.js';

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function oneTimeKey() {
	const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
	const secret = hex((await crypto.subtle.exportKey('pkcs8', pair.privateKey)).slice(-32));
	return { secret, key: hex(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

// The link a person opens to join, on this host
export const linkOf = (secret) => `${location.origin}/#/join/${secret}`;

// `#/join/<secret>`, or null
export function readLink(hash) {
	const found = /^#\/join\/([0-9a-f]{64})$/.exec(hash);
	return found ? { secret: found[1] } : null;
}

// the passkey of the person `account` acts as, which signs its owner's acts
const passkeyOf = (account) => owners(account).find((owner) => owner.kind === 'key' && owner.id.startsWith('passkey-'))?.id;

// Whether `account` may invite into `network`: a passkey of its own, and the network among what it governs. This is
// aven-id's rule for the admin's key (Members::admin_key), read through the tree's own queries.
export const mayInvite = (account, network) => Boolean(network && passkeyOf(account) && tree.governs(account).includes(network));

// Makes an invite, signed by the passkey of `account`, an owner of the admin, on this browser; returns its link,
// shown once
export async function invite(config, account) {
	const { secret, key } = await oneTimeKey();
	const statement = { network: config.network, invite: key, passkey: passkeyOf(account) };
	statement.assertion = await assertion(config, await inviteText(config.network, key));
	send({ frame: 'invite', statement: JSON.stringify(statement) });
	return linkOf(secret);
}

// Withdraws an open invite, named by its key: the same owner's act
export async function withdraw(config, account, key) {
	const statement = { network: config.network, invite: key, passkey: passkeyOf(account) };
	statement.assertion = await assertion(config, await withdrawText(config.network, key));
	send({ frame: 'withdraw', statement: JSON.stringify(statement) });
}

// Joins with an invite's link: a name, a new passkey (ES256, attestation none, as the claim's), and the statement
// that founds the person's vault with this browser as its device, signed by that passkey and by the one-time key.
export async function join(config, { secret }, name) {
	if (!(await validPersonName(name))) throw new Error('a name is 1 to 48 characters, without control characters');
	const key = await oneTimePublic(secret);
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
		invite: key,
		person: await personId(spki),
		name,
		passkey: { id: await passkeyId(spki), spki },
		device: { id: await deviceId(net.key), key: net.key },
	};
	const text = await joinText(config.network, key, statement.person, name, statement.passkey.id, spki, statement.device.id, net.key);
	statement.assertion = await assertion(config, text, created.rawId);
	statement.signature = await signJoin(secret, text);
	send({ frame: 'join', statement: JSON.stringify(statement) });
}
