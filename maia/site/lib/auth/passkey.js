/*
 * A new passkey, made by the browser from the API's options (WebAuthn's JSON form, binary fields in base64url) and
 * sent back in the same form, which the API's checker reads (@simplewebauthn/server's RegistrationResponseJSON). The
 * browser does every bit of the crypto; here only the bytes change form.
 */

/** base64url → bytes. @param {string} s */
const bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** bytes → base64url, unpadded. @param {ArrayBuffer | ArrayBufferView} b */
const b64url = (b) => {
	const u8 = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
	let s = '';
	for (const x of u8) s += String.fromCharCode(x);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The person's authenticator makes a passkey for `options` (the API's JSON creation options): the attestation, as JSON.
 * @param {any} options @returns {Promise<any>} */
export async function register(options) {
	const publicKey = {
		...options,
		challenge: bytes(options.challenge),
		user: { ...options.user, id: bytes(options.user.id) },
		excludeCredentials: (options.excludeCredentials ?? []).map((/** @type {any} */ c) => ({ ...c, id: bytes(c.id) }))
	};
	const credential = /** @type {PublicKeyCredential | null} */ (await navigator.credentials.create({ publicKey }));
	if (!credential) throw new Error('No passkey was made.');
	const response = /** @type {AuthenticatorAttestationResponse} */ (credential.response);
	const publicKeyBytes = response.getPublicKey?.();
	const authenticatorData = response.getAuthenticatorData?.();
	return {
		id: credential.id,
		rawId: b64url(credential.rawId),
		type: credential.type,
		authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
		clientExtensionResults: credential.getClientExtensionResults(),
		response: {
			attestationObject: b64url(response.attestationObject),
			clientDataJSON: b64url(response.clientDataJSON),
			transports: response.getTransports?.() ?? [],
			publicKeyAlgorithm: response.getPublicKeyAlgorithm?.(),
			publicKey: publicKeyBytes ? b64url(publicKeyBytes) : undefined,
			authenticatorData: authenticatorData ? b64url(authenticatorData) : undefined
		}
	};
}
