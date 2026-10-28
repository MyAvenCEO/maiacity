/*
 * A software passkey for the devx checks (aven/ops/devx/fresh-device.mjs, live-device.mjs): one P-256 key and one
 * hmac-secret that every test device's authenticator holds, as a passkey synced by iCloud Keychain is. `authenticator`
 * runs in the page before any of its own code (Playwright's addInitScript, which a page's CSP doesn't stop) and stands
 * in for navigator.credentials: a `none` attestation for a new passkey, and assertions with WebAuthn's PRF (CTAP2's
 * hmac-secret over the salt hashed under its label), all with WebCrypto, the same in Chromium and WebKit. A browser's
 * virtual authenticator can't hand a passkey to another profile with its PRF secret, and WebKit has none.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

/** A new passkey: its credential id, its P-256 key (JWK) and its hmac-secret, base64url. */
export function passkey() {
	const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
	return { id: randomBytes(16).toString('base64url'), jwk: privateKey.export({ format: 'jwk' }), prf: randomBytes(32).toString('base64url') };
}

/** Runs in the page: navigator.credentials as an authenticator holding passkey `key` (`passkey()`'s). */
export function authenticator(key) {
	const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	const unb64u = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
	const bytes = (b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
	const join = (...parts) => {
		const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let at = 0;
		for (const p of parts) out.set(p, (at += p.length) - p.length);
		return out;
	};
	const sha = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
	const enc = new TextEncoder();
	const id = unb64u(key.id);
	const signing = crypto.subtle.importKey('jwk', key.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
	const { d: _, ...pub } = key.jwk;
	const spki = crypto.subtle
		.importKey('jwk', { ...pub, key_ops: ['verify'] }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
		.then((k) => crypto.subtle.exportKey('spki', k));
	const hmac = crypto.subtle.importKey('raw', unb64u(key.prf), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	/** WebAuthn's PRF: the salt hashed under its label, then the credential's hmac-secret over it */
	const prf = async (salt) =>
		crypto.subtle.sign('HMAC', await hmac, await sha(join(enc.encode('WebAuthn PRF'), new Uint8Array([0]), bytes(salt))));
	// CBOR, as much as a `none` attestation takes: small ints, negative ints, byte and text strings, maps
	const head = (major, n) =>
		n < 24 ? new Uint8Array([(major << 5) | n]) : n < 256 ? new Uint8Array([(major << 5) | 24, n]) : new Uint8Array([(major << 5) | 25, n >> 8, n & 255]);
	const cbor = (v) =>
		typeof v === 'number'
			? v < 0 ? head(1, -1 - v) : head(0, v)
			: typeof v === 'string'
				? join(head(3, enc.encode(v).length), enc.encode(v))
				: v instanceof Uint8Array
					? join(head(2, v.length), v)
					: join(head(5, v.length), ...v.flatMap(([k, x]) => [cbor(k), cbor(x)]));
	/** rpIdHash, flags (user present and verified, backup eligible and backed up, as a synced passkey; and attested
	 *  credential data, with `attested`), a zero counter */
	const authData = async (rpId, attested = null) =>
		join(await sha(enc.encode(rpId)), new Uint8Array([0x01 | 0x04 | 0x08 | 0x10 | (attested ? 0x40 : 0), 0, 0, 0, 0]), ...(attested ? [attested] : []));
	/** WebCrypto's r‖s as the DER WebAuthn's assertions carry */
	const der = (rs) => {
		const int = (x) => {
			let i = 0;
			while (i < x.length - 1 && x[i] === 0) i++;
			x = x.slice(i);
			return x[0] & 0x80 ? join(new Uint8Array([0]), x) : x;
		};
		const [r, s] = [int(rs.slice(0, 32)), int(rs.slice(32))];
		return join(new Uint8Array([0x30, r.length + s.length + 4, 2, r.length]), r, new Uint8Array([2, s.length]), s);
	};
	const clientData = (type, challenge) =>
		enc.encode(JSON.stringify({ type, challenge: b64u(bytes(challenge)), origin: location.origin, crossOrigin: false }));
	const counts = (globalThis.__ceremonies = { created: 0, asserted: 0 });
	const credential = (response, extensions) => ({
		id: key.id,
		rawId: id.buffer,
		type: 'public-key',
		authenticatorAttachment: 'platform',
		response,
		getClientExtensionResults: () => extensions,
		toJSON: () => ({ id: key.id })
	});
	const credentials = {
		async create({ publicKey }) {
			counts.created++;
			const data = clientData('webauthn.create', publicKey.challenge);
			const public_ = await spki;
			// the COSE key: EC2, ES256, P-256, x and y
			const cose = cbor([[1, 2], [3, -7], [-1, 1], [-2, unb64u(pub.x)], [-3, unb64u(pub.y)]]);
			const attested = join(new Uint8Array(16), new Uint8Array([id.length >> 8, id.length & 255]), id, cose);
			const auth = await authData(publicKey.rp?.id ?? location.hostname, attested);
			const attestation = cbor([['fmt', 'none'], ['attStmt', []], ['authData', auth]]);
			return credential(
				{
					clientDataJSON: data.buffer,
					attestationObject: attestation.buffer,
					getPublicKey: () => public_,
					getPublicKeyAlgorithm: () => -7,
					getAuthenticatorData: () => auth.buffer,
					getTransports: () => ['internal', 'hybrid']
				},
				{ prf: { enabled: true } }
			);
		},
		async get({ publicKey }) {
			const allowed = publicKey.allowCredentials ?? [];
			if (allowed.length && !allowed.some((c) => b64u(bytes(c.id)) === key.id)) throw new DOMException('no such passkey here', 'NotAllowedError');
			counts.asserted++;
			const data = clientData('webauthn.get', publicKey.challenge);
			const auth = await authData(publicKey.rpId ?? location.hostname);
			const signed = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signing, join(auth, await sha(data))));
			const ask = publicKey.extensions?.prf?.eval;
			const results = ask ? { first: await prf(ask.first), ...(ask.second ? { second: await prf(ask.second) } : {}) } : undefined;
			return credential(
				{ clientDataJSON: data.buffer, authenticatorData: auth.buffer, signature: der(signed).buffer, userHandle: null },
				results ? { prf: { results } } : {}
			);
		}
	};
	Object.defineProperty(navigator, 'credentials', { configurable: true, value: credentials });
	globalThis.PublicKeyCredential ??= /** @type {any} */ (class PublicKeyCredential {});
	PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
	PublicKeyCredential.getClientCapabilities = async () => ({ prf: true, extension_prf: true, passkeyPlatformAuthenticator: true, userVerifyingPlatformAuthenticator: true });
}
