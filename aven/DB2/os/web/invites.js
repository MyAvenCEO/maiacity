// Invites and joins, on the page (MILESTONE2.md, "Decisions"; the statements as thread A's PR #1431 states them):
// only the admin invites, an invite is a one-time Ed25519 key, and its link, `#/join/<secret>`, carries that key's
// secret. Making and withdrawing one is an owner's act on the network, signed with the passkey of a person whose vault
// owns the admin, which the statement names; joining is a statement signed by the one-time key and by the joiner's
// new passkey. What each statement's text says is aven-id's (its wasm's inviteText, withdrawText, joinText); the
// Aven Peer decides what it takes, and tells the invites back to the admin's owners' devices (room.svelte.js). The
// one-time key is made here with WebCrypto and its secret lives only in the link.
import * as aven from 'aven-id';
import { deviceId, owners, passkeyId, personId } from './id.js';
import { assertion, net, send } from './network.svelte.js';

// STAND-IN until aven-id's wasm has them (thread A): the texts as #1431 states them
const ids = {
	inviteText: aven.inviteText ?? ((n, k) => `avenID invite 1\nnetwork ${n}\ninvite ${k}\n`),
	withdrawText: aven.withdrawText ?? ((n, k) => `avenID withdraw 1\nnetwork ${n}\ninvite ${k}\n`),
	joinText:
		aven.joinText ??
		((n, k, p, id, spki, d, key) => `avenID join 1\nnetwork ${n}\ninvite ${k}\nperson ${p}\npasskey ${id} ${spki}\ndevice ${d} ${key}\n`),
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

// the one-time key's public half, from its secret: the private key's JWK carries it as `x`
async function publicOf(secret) {
	const key = await crypto.subtle.importKey('pkcs8', pkcs8(unhex(secret)), { name: 'Ed25519' }, true, ['sign']);
	const { x } = await crypto.subtle.exportKey('jwk', key);
	return hex(Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
}

async function signWith(secret, text) {
	const key = await crypto.subtle.importKey('pkcs8', pkcs8(unhex(secret)), { name: 'Ed25519' }, false, ['sign']);
	return hex(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(text)));
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

// Makes an invite, signed by the passkey of `account`, an owner of the admin, on this browser; returns its link,
// shown once
export async function invite(config, account) {
	const { secret, key } = await oneTimeKey();
	const statement = { network: config.network, invite: key, passkey: passkeyOf(account) };
	statement.assertion = await assertion(config, ids.inviteText(config.network, key));
	send({ frame: 'invite', statement: JSON.stringify(statement) });
	return linkOf(secret);
}

// Withdraws an open invite, named by its key: the same owner's act
export async function withdraw(config, account, key) {
	const statement = { network: config.network, invite: key, passkey: passkeyOf(account) };
	statement.assertion = await assertion(config, ids.withdrawText(config.network, key));
	send({ frame: 'withdraw', statement: JSON.stringify(statement) });
}

// Joins with an invite's link: a name, a new passkey (ES256, attestation none, as the claim's), and the statement
// that founds the person's vault with this browser as its device, signed by that passkey and by the one-time key.
export async function join(config, { secret }, name) {
	const key = await publicOf(secret);
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
		person: personId(spki),
		name,
		passkey: { id: passkeyId(spki), spki },
		device: { id: deviceId(net.key), key: net.key },
	};
	const text = ids.joinText(config.network, key, statement.person, statement.passkey.id, spki, statement.device.id, net.key);
	statement.assertion = await assertion(config, text, created.rawId);
	statement.signature = await signWith(secret, text);
	send({ frame: 'join', statement: JSON.stringify(statement) });
}
