// The box's PRF stand-in (id/caps/README.md, "Passkeys and the PRF step"). Playwright's virtual authenticator
// (`context.credentials`), which WebKit and Firefox run the box's passkeys on, has no PRF, and a passkey without PRF
// makes no vault (Samuel, 31 Oct 2026). So the box stands in for a provider that has one: a ceremony's
// `prf.eval.first` is answered with SHA-256 of a label, the credential's id and WebAuthn's salt, the same for the same
// passkey on any engine and in any context. Only the box does this: the page's code is the one that runs everywhere,
// and the PRF itself is checked against Chromium's own virtual authenticator (claim.mjs). Chromium's carries its PRF
// secret only on the profile that made the passkey: a passkey copied to another profile over CDP answers no PRF, so a
// synced passkey's second browser stands in this way too.

export async function withPrf(context) {
	await context.addInitScript(prfStandIn);
}

// The owner and seal keys' public halves this session's Peer-Light derived, as the page shows them for checks
// (`owner-keys`), or null: the same on the dev server and the release build.
export async function ownerKeys(page) {
	const shown = page.getByTestId('owner-keys');
	if (!(await shown.waitFor({ state: 'attached', timeout: 10_000 }).then(() => true, () => false))) return null;
	return { owner: await shown.getAttribute('data-owner'), seal: await shown.getAttribute('data-seal') };
}

function prfStandIn() {
	const credentials = navigator.credentials;
	const bytes = (x) => new Uint8Array(x instanceof ArrayBuffer ? x : x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength));
	const join = (...parts) => {
		const all = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : bytes(p)));
		const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
		let at = 0;
		for (const p of all) (out.set(p, at), (at += p.length));
		return out;
	};
	const wrap = (ceremony) =>
		async function (options) {
			const credential = await ceremony.call(credentials, options);
			const first = options?.publicKey?.extensions?.prf?.eval?.first;
			if (!credential || !first) return credential;
			const salt = await crypto.subtle.digest('SHA-256', join('WebAuthn PRF\0', first));
			const output = await crypto.subtle.digest('SHA-256', join('avenSANDBOX test prf\0', credential.rawId, salt));
			const own = credential.getClientExtensionResults.bind(credential);
			Object.defineProperty(credential, 'getClientExtensionResults', {
				value: () => ({ ...own(), prf: { enabled: true, results: { first: output } } }),
			});
			return credential;
		};
	credentials.create = wrap(credentials.create);
	credentials.get = wrap(credentials.get);
}
