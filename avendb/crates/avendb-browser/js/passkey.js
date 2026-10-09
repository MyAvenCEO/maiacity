// avenDB's passkey in the browser's own authenticator (P8e): WebAuthn with the PRF extension. The passkey never
// leaves the authenticator; each ceremony brings back an assertion over a challenge and the PRF output on the app's
// salt, and the one that unlocks a device also the output on the device's own salt, from which the device's keys
// derive. The device (avendb-browser's `Device`) asks for each ceremony it needs.

/** The relying party: maia.city, or localhost for a page served on this machine (a test's). */
export function rpId() {
	return location.hostname === 'localhost' ? 'localhost' : 'maia.city';
}

/** Bytes as base64url, as WebAuthn names a credential. */
export function base64url(bytes) {
	let text = '';
	for (const b of new Uint8Array(bytes)) text += String.fromCharCode(b);
	return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Bytes from base64url. */
export function unbase64url(text) {
	const plain = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
	return Uint8Array.from(plain, (c) => c.charCodeAt(0));
}

/**
 * Makes the person's passkey, named `person`: its credential's id (base64url) and its public key info (SPKI), from
 * which the device takes its P-256 key.
 */
export async function create(person) {
	const credential = await navigator.credentials.create({
		publicKey: {
			rp: { id: rpId(), name: 'avenDB' },
			user: { id: crypto.getRandomValues(new Uint8Array(16)), name: person, displayName: person },
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
			authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
			extensions: { prf: {} }
		}
	});
	const spki = credential.response.getPublicKey();
	if (!spki) throw new Error('the browser shows no public key of the passkey');
	return { id: base64url(credential.rawId), spki: new Uint8Array(spki) };
}

/**
 * A ceremony of the passkey whose credential's id is `id` (any of the person's if none) over `challenge`: its
 * assertion and the PRF output on `salt`, and on `deviceSalt` if given (`devicePrf`), each bytes, and the credential's
 * id.
 */
export async function ceremony(id, challenge, salt, deviceSalt) {
	const evaluate = deviceSalt ? { first: salt, second: deviceSalt } : { first: salt };
	const credential = await navigator.credentials.get({
		publicKey: {
			challenge,
			rpId: rpId(),
			userVerification: 'required',
			allowCredentials: id ? [{ type: 'public-key', id: unbase64url(id) }] : [],
			extensions: { prf: { eval: evaluate } }
		}
	});
	const prf = credential.getClientExtensionResults().prf?.results;
	if (!prf?.first || (deviceSalt && !prf.second)) {
		throw new Error('this passkey has no PRF: avenDB needs a passkey that has one');
	}
	const response = credential.response;
	return {
		id: base64url(credential.rawId),
		authenticatorData: new Uint8Array(response.authenticatorData),
		clientDataJSON: new Uint8Array(response.clientDataJSON),
		signature: new Uint8Array(response.signature),
		prf: new Uint8Array(prf.first),
		devicePrf: prf.second ? new Uint8Array(prf.second) : undefined
	};
}

/**
 * The ceremonies of a device of avenDB's module `avendb` (its `prfSalt` and `deviceSalt`) with the passkey whose
 * credential's id is `id` (any of the person's if none): `unlock(nonce)` unlocks the device whose salt ends in `nonce`
 * and remembers which passkey did, and `sign(challenge, step)` is every ceremony the device asks for after it.
 */
export function ceremonies(avendb, id) {
	const salt = avendb.prfSalt();
	const held = { id };
	return {
		held,
		async unlock(nonce) {
			const challenge = crypto.getRandomValues(new Uint8Array(32));
			const unlock = await ceremony(held.id, challenge, salt, avendb.deviceSalt(nonce));
			held.id = unlock.id;
			return { ...unlock, nonce };
		},
		sign: (challenge, step) => ceremony(held.id, challenge, salt)
	};
}
