// The browser half of the signup service. The journal itself stays a static
// site on the CDN; only these calls reach a server, and only when somebody
// actually signs up.
import { dev } from '$app/environment';
import { startRegistration } from '@simplewebauthn/browser';
import { command, native } from '$lib/native';

/** api.maia.city in production, the local container in development. */
// 3100 locally, so it can run beside other projects' stacks on 3000.
export const API = dev
	? ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3100')
	: 'https://api.maia.city';

/** Who is signed in, as maiaCITY's API knows them: their id, place in the line and role. Their profile, their name
 *  among it, lives in their avenDB human vault alone ($lib/avendb/session.svelte.js `session.name`); what they open of
 *  the app, the Maia City cap groups they hold there ($lib/app/access.svelte.js), never a Postgres role. */
export type Founder = {
	id: string;
	/** their place in the line — founder number 1, 2, 3 … */
	number: number;
	since: string;
	/** only on /api/me: their role, which the API's own routes ask of (no page is gated by it) */
	role?: string;
};

/** Where each call's pass comes from: the page's avenDB device, once the app has it open (`passBy`). */
let passFor: (() => Promise<string | null>) | null = null;

/** The app's way in hands over how its avenDB device signs a pass for each call: the API knows the person by their
 *  vault, as avenDB's server names the device's (api/src/founders.js), with no sign-in of its own. */
export const passBy = (fn: () => Promise<string | null>) => void (passFor = fn);

/** Every call carries a pass of the person's avenDB device (`X-Avendb-Pass`), a new one each time, as the API takes a
 *  pass once, and every failure carries a sentence a person can read rather than a status code. In the Mac app the
 *  call goes out natively, and the app's own Rust adds its device's pass (vault/app/src/auth.rs). */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
	if (native()) {
		const r = await command<{ status: number; body: any }>('api', {
			method: init.method ?? 'GET',
			path,
			body: typeof init.body === 'string' ? JSON.parse(init.body) : null
		});
		if (r.status >= 400) throw new ApiError(r.body?.error ?? 'Something went wrong. Please try again.', r.status);
		return r.body as T;
	}
	const pass = passFor ? await passFor().catch(() => null) : null;
	const res = await fetch(`${API}${path}`, {
		...init,
		credentials: 'include',
		// a JSON body says so; a plain GET without a pass sends no header of its own, so it needs no CORS preflight (a
		// route an older API does not have then answers a readable 404, instead of failing its preflight)
		headers: {
			...(init.body ? { 'content-type': 'application/json' } : {}),
			...(pass ? { 'x-avendb-pass': pass } : {}),
			...(init.headers ?? {})
		}
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new ApiError(body?.error ?? 'Something went wrong. Please try again.', res.status);
	return body as T;
}

/** A refusal with its HTTP status, so a caller can tell "not there (yet)" (404) from a real failure. */
export class ApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}
/** The route does not exist on this API (yet): a newer API's feature, answered by a fallback in the studio. */
export const missing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);

export const founderCount = () => call<{ count: number; step: number }>('/api/founders/count');

export const me = () => call<Founder>('/api/me');

export const signOut = () =>
	native()
		? command('auth_sign_out')
		: fetch(`${API}/api/session`, { method: 'DELETE', credentials: 'include' });

/** Sign up, with the invite an admin gave (none for the very first person, who runs the city): create a passkey, and
 *  the passkey is the whole account. `name` labels the passkey in the person's authenticator; their profile takes it in
 *  their human vault, which the app founds with the passkey as they come in ($lib/app/entry.js). */
export async function signUp(name: string, invite = ''): Promise<Founder> {
	const options = await call<any>('/api/passkey/register/options', {
		method: 'POST',
		body: JSON.stringify({ name, invite })
	});
	const attestation = await startRegistration({ optionsJSON: forAvenDB(options) });
	return call<Founder>('/api/passkey/register/finish', {
		method: 'POST',
		body: JSON.stringify(attestation)
	});
}

/** The API's options for a new passkey, asking for what lets the same passkey be the root of its person's avenDB
 *  vault (src/lib/avendb), for the same relying party: its PRF, from which avenDB derives their keys (a security key
 *  turns it on only for a passkey made with it), and a P-256 key (COSE -7) first among the API's algorithms, as
 *  avenDB's ceremonies take P-256 signatures alone. A browser or an authenticator without PRF makes the passkey all
 *  the same: maiaCITY never needs it. */
function forAvenDB(options: any) {
	const params: { alg: number }[] = options.pubKeyCredParams ?? [];
	return {
		...options,
		pubKeyCredParams: [...params.filter((p) => p.alg === -7), ...params.filter((p) => p.alg !== -7)],
		extensions: { ...options.extensions, prf: {} }
	};
}

/** Whether an invite may still be used to sign up with: an invite of Maia City's in avenDB, by its share's id, that no
 *  vault claimed yet, or an older code of the API's, unused and unexpired. */
export const inviteOpen = (code: string) =>
	call<{ open: boolean }>(`/api/invites/${encodeURIComponent(code)}`).then((r) => r.open);

/** Does this browser do passkeys at all? Checked before anything is promised. */
export const passkeysAvailable = () =>
	typeof window !== 'undefined' && !!window.PublicKeyCredential;

/** Any API call, the same way as every helper here. */
export const apiCall = <T>(path: string, init: RequestInit = {}) => call<T>(path, init);
