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

// ─────────────────────────────── the media library ───────────────────────────────

export type MediaItem = {
	cid: string;
	mime: string;
	kind: 'image' | 'video' | 'audio' | 'document' | 'other';
	size: number;
	created: string;
	title: string;
	description: string;
	/** how it is found and sorted: "Day 18", "role:cover", "shot:05 the edge", "shape:16x9", … */
	tags: string[];
	/** what else is known: a voice take's words, voice, model, duration */
	meta: Record<string, unknown>;
	/** shown by the site or a platform: it gets a copy on the CDN */
	public: boolean;
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

/** `fin` / `fout`: the clip's own fade in and out, in seconds — a sound bed crossfades, a hit comes in at once. */
export type TimelineClip = { id: string; cid: string; track: 'V1' | 'A1' | 'A2' | 'A3'; start: number; in: number; dur: number; vol: number; fin?: number; fout?: number };
export type Timeline = { id: string; name: string; project: string | null; variant: string | null; description: string | null; aspect: string; tags: string[]; clips: TimelineClip[]; created: string; updated: string };

export const listTimelines = () => call<Timeline[]>('/api/timelines');
export const createTimeline = (t: Partial<Timeline>) => call<Timeline>('/api/timelines', { method: 'POST', body: JSON.stringify(t) });
export const saveTimeline = (id: string, t: Partial<Timeline>) =>
	call<Timeline>(`/api/timelines/${id}`, { method: 'PUT', body: JSON.stringify(t) });
export async function deleteTimeline(id: string): Promise<void> {
	const res = await fetch(`${API}/api/timelines/${id}`, { method: 'DELETE', credentials: 'include' });
	if (!res.ok) throw new Error('Could not delete the timeline.');
}

// ─────────────────────────────── the content board ───────────────────────────────

/**
 * Where a snippet stands, in the order it moves: the swipe file; its hook (the title, set into every title card); the
 * base article written from it; the article locked and the posts derived from it; dated; out. The API sends its own list with every GET /api/content — this is the
 * fallback until it has answered.
 */
export const STATUSES = ['idea', 'hook', 'draft', 'derivatives', 'scheduled', 'published'] as const;
export type Status = (typeof STATUSES)[number];

export type ContentItem = {
	id: string;
	title: string;
	kind: string;
	channels: string[];
	status: Status;
	scheduled_at: string | null;
	/** an idea's words, or the day's base article in Markdown: the one source every post derives from */
	body: string;
	cids: string[];
	link: string | null;
	tags: string[];
	/** every file a film is delivered as, from all of its cuts (made by the render worker, never edited here) */
	deliveries: Delivery[];
	/** the posts derived from the base article, several a day, each at its own time (prepared elsewhere; only previewed here) */
	posts: Post[];
	/** the studio timeline this item was first made from, when it is a film */
	timeline_id: string | null;
	/** the film project it belongs to ("Day 19"): one item per project, whatever its cuts */
	project: string | null;
	/** where the base article (the body) lives in the repo, when it came from a file */
	source?: string | null;
	/** the hook: the title set into the day's title cards (its thumbnails, in every shape) */
	hook?: string | null;
	created: string;
	updated: string;
};

/** One file a film is delivered as: which channels it is for, and what it is. */
export type Delivery = {
	channels: string[];
	cid: string;
	format: string;
	aspect: string;
	width: number;
	height: number;
	codec: string;
	bytes: number;
	seconds: number;
	note?: string;
	/** a video (the default), or the thumbnail / cover it goes out with */
	kind?: 'video' | 'thumbnail';
	/** the timeline (cut) it was rendered from, and that cut's name: "Full shots 2", "Reel 90s" */
	timeline?: string;
	cut?: string;
};

/** Where a post goes: our own journal (the base article itself), or one of the platforms. */
export type Platform = 'journal' | 'youtube' | 'linkedin' | 'x' | 'instagram';
/**
 * What kind of thing it is, whatever the platform: the article (our journal's, or an X Article), a film, a YouTube
 * Short, a Reel, a text post, a thread.
 */
export type Format = 'article' | 'video' | 'short' | 'reel' | 'post' | 'thread';

/**
 * One derivative of the day's base article, for one platform, going out at its own time. A video or Reel posts the
 * delivery with the same aspect and codec; a post with an aspect goes out with the thumbnail of that shape.
 */
export type Post = {
	platform: Platform;
	format?: Format;
	title?: string;
	text: string;
	/** an X thread: one entry per tweet */
	thread?: string[];
	/** Instagram only: the feed (the full film, 1:1) or the Reels (a short cut, 9:16) */
	placement?: 'feed' | 'reel';
	aspect?: string;
	codec?: string;
	/** when this one goes out (else the item's date) */
	scheduled_at?: string;
	note?: string;
	/** the timeline (cut) it posts */
	timeline?: string;
};

/** The first delivery that fits, preferring one rendered from the post's own cut. */
const pick = (deliveries: Delivery[], fits: (d: Delivery) => boolean, timeline?: string) =>
	(timeline && deliveries.find((d) => fits(d) && d.timeline === timeline)) || deliveries.find(fits);

/**
 * A post's film and the picture it goes out with — the picture each platform actually shows (as the upload step,
 * api/scripts/zernio.ts, sends it): YouTube Shorts and X videos take no custom thumbnail (their first frame shows);
 * an X Article shows its 5:2 cover; LinkedIn videos and Instagram take the title card in the film's own shape.
 */
export const postFiles = (post: Post, deliveries: Delivery[]) => {
	// the day's own title cards first (the Hook stage's: one set every platform shares), else the one a render made
	const thumb = (aspect: string) => {
		const fits = (d: Delivery) => d.kind === 'thumbnail' && d.aspect === aspect;
		return deliveries.find((d) => fits(d) && d.timeline === 'day') ?? pick(deliveries, fits, post.timeline);
	};
	const firstFrameOnly = (post.platform === 'youtube' && post.format === 'short') || (post.platform === 'x' && post.format === 'video');
	const video = post.aspect
		? pick(deliveries, (d) => (d.kind ?? 'video') === 'video' && d.aspect === post.aspect && d.codec === post.codec, post.timeline)
		: undefined;
	return {
		video,
		thumbnail:
			post.platform === 'x' && post.format === 'article'
				? (thumb('5:2') ?? thumb('16:9'))
				: firstFrameOnly
					? undefined // no cover image: a frame of the film shows, and the hook is over its opening
					: !post.aspect
						? undefined
						: thumb(post.aspect)
	};
};

export const listContent = (from?: string, to?: string) =>
	call<{ items: ContentItem[]; kinds: string[]; channels: string[]; statuses: Status[] }>(
		`/api/content${from ? `?${new URLSearchParams({ from, to: to ?? '' })}` : ''}`
	);
export const createContent = (item: Partial<ContentItem>) => call<ContentItem>('/api/content', { method: 'POST', body: JSON.stringify(item) });
export const saveContent = (id: string, item: Partial<ContentItem>) =>
	call<ContentItem>(`/api/content/${id}`, { method: 'PUT', body: JSON.stringify(item) });
export async function deleteContent(id: string): Promise<void> {
	const res = await fetch(`${API}/api/content/${id}`, { method: 'DELETE', credentials: 'include' });
	if (!res.ok) throw new Error('Could not delete it.');
}

// ─────────────────────────────── exporting a timeline ───────────────────────────────

export type RenderJob = { id: string; timeline_id: string; status: 'queued' | 'rendering' | 'done' | 'failed'; progress: number; note: string | null; output_cid: string | null; created: string; updated: string };

export const queueRender = (timelineId: string) => call<RenderJob>(`/api/timelines/${timelineId}/renders`, { method: 'POST' });
export const listRenders = (timelineId: string) => call<RenderJob[]>(`/api/timelines/${timelineId}/renders`);
