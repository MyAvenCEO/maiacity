// Invites and joins, on the page (MILESTONE2.md, "Decisions"): only the admin invites, an invite names a one-time
// Ed25519 key, and its link, `#/join/<invite>.<secret>`, carries that key's secret. Making and withdrawing one is an
// owner's act on the network, signed with the passkey of a person whose vault owns the admin; joining is a statement
// signed by the one-time key and by the joiner's new passkey. What each statement says is aven-id's (its wasm's
// inviteText, withdrawText, joinText and inviteId); the Aven Peer decides what it takes, and tells the open invites
// back to the admin's owners' devices (room.svelte.js). The one-time key is made here with WebCrypto and its secret
// lives only in the link.
import * as aven from 'aven-id';
import { deviceId, passkeyId, personId } from './id.js';
import { assertion, net, send } from './network.svelte.js';

// STAND-IN until aven-id's wasm has them (thread A): any text, since the stand-in checks no signature
const said = (what) => (...parts) => JSON.stringify([what, ...parts]);
const ids = {
	inviteId: aven.inviteId ?? ((key) => `invite-${key.slice(0, 16)}`),
	inviteText: aven.inviteText ?? said('invite'),
	withdrawText: aven.withdrawText ?? said('withdraw'),
	joinText: aven.joinText ?? said('join'),
};

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (text) => Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
// PKCS #8 for an Ed25519 seed: this prefix and the 32 bytes (RFC 8410)
const pkcs8 = (seed) => new Uint8Array([...unhex('302e020100300506032b657004220420'), ...seed]);

async function oneTimeKey() {
	const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
	const secret = hex((await crypto.subtle.exportKey('pkcs8', pair.privateKey)).slice(-32));
	return { secret, key: hex(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

async function signWith(secret, text) {
	const key = await crypto.subtle.importKey('pkcs8', pkcs8(unhex(secret)), { name: 'Ed25519' }, false, ['sign']);
	return hex(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(text)));
}

// The link a person opens to join, on this host
export const linkOf = (invite, secret) => `${location.origin}/#/join/${invite}.${secret}`;

// `#/join/<invite>.<secret>`, or null
export function readLink(hash) {
	const found = /^#\/join\/([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(hash);
	return found ? { invite: found[1], secret: found[2] } : null;
}

// Makes an invite, signed by the admin's owner's passkey on this browser; returns its link, shown once
export async function invite(config) {
	const { secret, key } = await oneTimeKey();
	const id = ids.inviteId(key);
	const statement = { network: config.network, invite: { id, key } };
	statement.assertion = await assertion(config, ids.inviteText(config.network, id, key));
	send({ frame: 'invite', statement: JSON.stringify(statement) });
	return linkOf(id, secret);
}

// Withdraws an open invite: the same owner's act
export async function withdraw(config, id) {
	const statement = { network: config.network, invite: id };
	statement.assertion = await assertion(config, ids.withdrawText(config.network, id));
	send({ frame: 'withdraw', statement: JSON.stringify(statement) });
}

// Joins with an invite's link: a name, a new passkey (ES256, attestation none, as the claim's), and the statement
// that founds the person's vault with this browser as its device, signed by that passkey and by the one-time key.
export async function join(config, { invite: id, secret }, name) {
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
		invite: id,
		person: personId(spki),
		name,
		passkey: { id: passkeyId(spki), spki },
		device: { id: deviceId(net.key), key: net.key },
	};
	const text = ids.joinText(config.network, id, statement.person, name, statement.passkey.id, spki, statement.device.id, net.key);
	statement.assertion = await assertion(config, text, created.rawId);
	statement.signature = await signWith(secret, text);
	send({ frame: 'join', statement: JSON.stringify(statement) });
}
