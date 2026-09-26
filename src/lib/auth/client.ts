// The browser half of the signup service. The journal itself stays a static
// site on the CDN; only these calls reach a server, and only when somebody
// actually signs up.
import { dev } from '$app/environment';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

/** api.maia.city in production, the local container in development. */
// 3100 locally, so it can run beside other projects' stacks on 3000.
export const API = dev
	? ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3100')
	: 'https://api.maia.city';

export type Founder = {
	id: string;
	/** their place in the line — founder number 1, 2, 3 … */
	number: number;
	name: string;
	since: string;
	/** only on /api/me: their role, and every capability it holds */
	role?: string;
	caps?: string[];
};

/** May they? The API decides for real; this only keeps the site from offering what it would refuse. */
export const may = (founder: Founder | null | undefined, cap: string) => !!founder?.caps?.includes(cap);

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

// ─────────────────────────────── the admin's notebook ───────────────────────────────

export type Idea = {
	id: string;
	body: string;
	done: boolean;
	author: string | null;
	created_at: string;
	updated_at: string;
};

export const listIdeas = () => call<Idea[]>('/api/ideas');

export const addIdea = (body: string) =>
	call<Idea>('/api/ideas', { method: 'POST', body: JSON.stringify({ body }) });

export const updateIdea = (id: string, patch: { body?: string; done?: boolean }) =>
	call<Idea>(`/api/ideas/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export async function deleteIdea(id: string): Promise<void> {
	const res = await fetch(`${API}/api/ideas/${id}`, { method: 'DELETE', credentials: 'include' });
	if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Could not delete it.');
}

// ─────────────────────────────── the media library ───────────────────────────────

export type MediaItem = {
	cid: string;
	mime: string;
	kind: 'image' | 'video' | 'audio' | 'document' | 'other';
	size: number;
	created: string;
	paths: string[];
	/** where it is used: "Day 18", "cover", "in the post", "site", its folder, "unused" */
	tags: string[];
	/** what the file is about: a voice take's words, voice, model, duration */
	meta: Record<string, unknown>;
	cdn_path: string | null;
	stream_guid: string | null;
	distributed_at: string | null;
};

export const listMedia = (q?: { kind?: string; q?: string }) =>
	call<{ media: MediaItem[]; total: number }>(`/api/media${q ? `?${new URLSearchParams(q as Record<string, string>)}` : ''}`);

// ─────────────────────────────── signing a terminal in ───────────────────────────────

export type DeviceRequest = { scope: string[]; descriptions: string[]; label: string; approved_at: string | null; expires_at: string };

export const deviceRequest = (code: string) => call<DeviceRequest>(`/api/device/${encodeURIComponent(code)}`);

export const approveDevice = (code: string) =>
	call<{ ok: true }>(`/api/device/${encodeURIComponent(code)}/approve`, { method: 'POST' });

// ─────────────────────────────── the studio's timelines ───────────────────────────────

export type TimelineClip = { id: string; cid: string; track: 'V1' | 'A1' | 'A2' | 'A3'; start: number; in: number; dur: number; vol: number };
export type Timeline = { id: string; name: string; aspect: string; tags: string[]; clips: TimelineClip[]; created: string; updated: string };

export const listTimelines = () => call<Timeline[]>('/api/timelines');
export const createTimeline = (t: Partial<Timeline>) => call<Timeline>('/api/timelines', { method: 'POST', body: JSON.stringify(t) });
export const saveTimeline = (id: string, t: Partial<Timeline>) =>
	call<Timeline>(`/api/timelines/${id}`, { method: 'PUT', body: JSON.stringify(t) });
export async function deleteTimeline(id: string): Promise<void> {
	const res = await fetch(`${API}/api/timelines/${id}`, { method: 'DELETE', credentials: 'include' });
	if (!res.ok) throw new Error('Could not delete the timeline.');
}
