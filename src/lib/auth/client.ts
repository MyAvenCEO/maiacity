// The browser half of the signup service. The journal itself stays a static
// site on the CDN; only these calls reach a server, and only when somebody
// actually signs up.
import { dev } from '$app/environment';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

/** api.maia.city in production, the local container in development. */
export const API = dev ? 'http://localhost:3000' : 'https://api.maia.city';

export type Founder = {
	id: string;
	/** their place in the line — founder number 1, 2, 3 … */
	number: number;
	name: string;
	since: string;
};

/** Every call carries the session cookie, and every failure carries a sentence
 *  a person can read rather than a status code. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		...init,
		credentials: 'include',
		headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(body?.error ?? 'Something went wrong. Please try again.');
	return body as T;
}

export const founderCount = () => call<{ count: number; step: number }>('/api/founders/count');

export const me = () => call<Founder>('/api/me');

export const rename = (name: string) =>
	call<Founder>('/api/me', { method: 'PATCH', body: JSON.stringify({ name }) });

export const signOut = () =>
	fetch(`${API}/api/session`, { method: 'DELETE', credentials: 'include' });

/** Sign up: create a passkey, and the passkey is the whole account. */
export async function signUp(name: string): Promise<Founder> {
	const options = await call<any>('/api/passkey/register/options', {
		method: 'POST',
		body: JSON.stringify({ name })
	});
	const attestation = await startRegistration({ optionsJSON: options });
	return call<Founder>('/api/passkey/register/finish', {
		method: 'POST',
		body: JSON.stringify(attestation)
	});
}

/** Sign in: no username field anywhere — the passkey already knows who it is. */
export async function signIn(): Promise<Founder> {
	const options = await call<any>('/api/passkey/login/options', { method: 'POST' });
	const assertion = await startAuthentication({ optionsJSON: options });
	return call<Founder>('/api/passkey/login/finish', {
		method: 'POST',
		body: JSON.stringify(assertion)
	});
}

/** Does this browser do passkeys at all? Checked before anything is promised. */
export const passkeysAvailable = () =>
	typeof window !== 'undefined' && !!window.PublicKeyCredential;
