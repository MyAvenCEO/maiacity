// @ts-nocheck: written by avendb/scripts/build-web.sh from avenDB
// avenDB's passkey in the browser's own authenticator (P8e): WebAuthn with the PRF extension. The passkey never
// leaves the authenticator; each ceremony brings back an assertion over a challenge and the PRF output on the app's
// salt, and the one that unlocks a device also the output on the device's own salt, which masks the secret the device's
// keys come from. The device (avendb-browser's `Device`) asks for each ceremony it needs. Every ceremony requires user
// verification: an authenticator's PRF (CTAP2's hmac-secret) answers with another secret without it, so the outputs
// stay the same only if each ceremony verifies the person. The passkey may be the one the person signed up to
// maiaCITY with, for the same relying party, if it has PRF: maiaCITY's sign-up asks for it (src/lib/auth/client.ts).
//
// In the Mac app (maiaCITY Studio) the page's web view may not use maia.city's passkeys: macOS lets an app's web view
// use a relying party's passkeys only with an Apple-signed entitlement tying the app to its domain. There each
// ceremony runs in a sign-in sheet instead (`inSheet`): maia.city's own page for it (src/routes/app/avendb/sheet/),
// in macOS's sign-in sheet over the app (vault/app/src/passkey.rs), runs it as `ceremony` does here and seals what it
// brings back to a key only this page holds (avendb-browser's `Sheet`), which opens it.

/**
 * The relying party: maia.city, for the site and its sign-in sheet, or localhost for a page served over http on this
 * machine (a test's, which only a build with avendb's `localhost-passkeys` takes).
 */
export function rpId() {
	return location.protocol === 'http:' && location.hostname === 'localhost' ? 'localhost' : 'maia.city';
}

/** Whether the page runs in the Mac app, maiaCITY Studio (Tauri), whose ceremonies run in its sign-in sheet. */
export function inApp() {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** The page the Mac app's sign-in sheet shows for a ceremony: maia.city's, whose passkeys these are. */
export const SHEET = 'https://maia.city/app/avendb/sheet/';

/** Where the sheet's page sends what it brings back: the app's own scheme, which the sheet hands to the app. */
export const BACK = 'city.maia.studio://avendb';

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
	if (inApp()) throw new Error('make your passkey on maia.city in your browser first: the app then signs in with it');
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
	// a passkey made without PRF never gets it: tell the authenticator nobody knows it, and say so
	if (credential.getClientExtensionResults().prf?.enabled === false) {
		const credentialId = base64url(credential.rawId);
		await PublicKeyCredential.signalUnknownCredential?.({ rpId: rpId(), credentialId }).catch(() => {});
		throw new Error('this authenticator makes passkeys without PRF, from which avenDB derives your keys: use another');
	}
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
		throw new Error('this passkey has no PRF, from which avenDB derives your keys: make a new passkey here instead');
	}
	const response = credential.response;
	// the PRF outputs as views of the browser's own buffers, which the device wipes once it holds them
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
 * A ceremony in the Mac app's sign-in sheet, as `ceremony` brings one back: the app (its command `passkey_sheet`)
 * shows the sheet's page with what to ask for in its fragment, `what` names the ceremony there, and `key` is the
 * public key of a `Sheet` of avenDB's module `avendb`, made for this ceremony alone, which opens what the page seals
 * to it and is freed after.
 */
export async function inSheet(avendb, what, id, challenge, salt, deviceSalt) {
	const sheet = new avendb.Sheet();
	try {
		const ask = new URLSearchParams({ what, challenge: base64url(challenge), salt: base64url(salt), key: base64url(sheet.key()) });
		if (deviceSalt) ask.set('device', base64url(deviceSalt));
		if (id) ask.set('id', id);
		const back = await window.__TAURI_INTERNALS__.invoke('passkey_sheet', { url: `${SHEET}#${ask}` });
		const answer = new URLSearchParams(String(back).split('#')[1] ?? '');
		const sealed = answer.get('sealed');
		if (!sealed) throw new Error(answer.get('error') || 'the sign-in sheet brought nothing back');
		return sheet.open(unbase64url(sealed), challenge);
	} finally {
		sheet.free();
	}
}

/**
 * The ceremonies of a device of avenDB's module `avendb` (its `prfSalt` and `deviceSalt`) with the passkey whose
 * credential's id is `id` (any of the person's if none): `unlock(nonce, challenge)` unlocks the device whose salt ends
 * in `nonce`, over `challenge` if given, a new device's, which makes the unlock its passkey's pass for it, and
 * remembers which passkey did; `sign(challenge, step)` is every ceremony the device asks for after it. In the Mac app,
 * each in its sign-in sheet.
 */
export function ceremonies(avendb, id) {
	const salt = avendb.prfSalt();
	const held = { id };
	const run = (what, challenge, deviceSalt) =>
		inApp()
			? inSheet(avendb, what, held.id, challenge, salt, deviceSalt)
			: ceremony(held.id, challenge, salt, deviceSalt);
	return {
		held,
		async unlock(nonce, challenge = crypto.getRandomValues(new Uint8Array(32))) {
			const unlock = await run('unlock', challenge, avendb.deviceSalt(nonce));
			held.id = unlock.id;
			return { ...unlock, nonce };
		},
		sign: (challenge, step) => run(step, challenge)
	};
}
