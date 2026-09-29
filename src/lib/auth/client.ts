// The browser half of the signup service. The journal itself stays a static
// site on the CDN; only these calls reach a server, and only when somebody
// actually signs up.
import { dev } from '$app/environment';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { APP_API, command, native } from '$lib/native';

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

/** A file's address, by its BLAKE3 hash: in maiaCITY Studio from this Mac's vault (with Range); on the web from the
 *  vault's gateway (a public file; a private one answers only the app). */
export const fileUrl = (hash: string) => (native() ? `vault://localhost/${hash}` : `https://api.maia.city/vault/files/${hash}`);

/** Every call carries the session cookie, and every failure carries a sentence
 *  a person can read rather than a status code. In the Mac app the call goes out natively, with the app's key. */
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
	const res = await fetch(`${API}${path}`, {
		...init,
		credentials: 'include',
		// a JSON body says so; a plain GET sends no header of its own, so it needs no CORS preflight (a route an older
		// API does not have then answers a readable 404, instead of failing its preflight)
		headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) }
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

export const rename = (name: string) =>
	call<Founder>('/api/me', { method: 'PATCH', body: JSON.stringify({ name }) });

export const signOut = () =>
	native()
		? command('auth_sign_out')
		: fetch(`${API}/api/session`, { method: 'DELETE', credentials: 'include' });

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

/** A file in the vault's catalog (iroh-docs, on every paired device), by its BLAKE3 hash. */
export type MediaItem = {
	hash: string;
	mime: string;
	kind: 'image' | 'video' | 'audio' | 'document' | 'other' | string;
	size: number;
	/** when it came into the vault */
	added: string;
	title: string;
	description: string;
	/** how it is found and sorted: "Day 18", "role:cover", "shot:05 the edge", "shape:16x9", … */
	tags: string[];
	/** what else is known: a voice take's words, voice, model, duration, its colour, its proxy */
	meta: Record<string, unknown>;
	/** shown by the site or a platform: served by the gateway without a login */
	public: boolean;
	/** the name it came in with — a fact about it, never how it is found */
	original_name?: string;
	/** its one story (a story id); none: the inbox */
	story?: string;
	/** default · original · proxy · delivery */
	class?: string;
};

// ── the media vault: devices the admin paired (only these sync), and revoking one ──
export type VaultDevice = { endpoint_id: string; label: string; created: string; seen: string | null; revoked_at: string | null };
export const listVaultDevices = () => call<VaultDevice[]>('/api/vault/devices');
export async function revokeVaultDevice(endpointId: string): Promise<void> {
	await call(`/api/vault/devices/${endpointId}`, { method: 'DELETE' });
}

/** Every file this Mac's vault knows (the catalog), newest first — maiaCITY Studio only. */
export async function listMedia(): Promise<MediaItem[]> {
	const all = await command<(Partial<MediaItem> & { hash: string; mime: string; kind: string; size: number })[]>('vault_list');
	return all.map((f) => ({
		hash: f.hash,
		mime: f.mime,
		kind: f.kind,
		size: f.size,
		added: f.added ?? '',
		title: f.title ?? '',
		description: f.description ?? '',
		tags: f.tags ?? [],
		meta: f.meta ?? {},
		public: f.public ?? false,
		original_name: f.original_name,
		story: f.story || undefined,
		class: f.class || 'default'
	}));
}

/** Set what is known about a file: each field given replaces the one before; meta is merged key by key. It syncs. */
export const describeMedia = (hash: string, about: { title?: string; description?: string; tags?: string[]; meta?: Record<string, unknown>; public?: boolean }) =>
	command<MediaItem>('vault_describe', { hash, patch: about });

// ─────────────────────────────── colour (C5) ───────────────────────────────

/** A picture's colour, as the ingest detected it (media meta.color); `override` is the one set by hand in the studio. */
export type ColorInfo = { profile: string; primaries?: string; transfer?: string; matrix?: string; range?: string; bitDepth?: number; detectedFrom?: string; override?: string };
/** A grade: ASC CDL in ACEScct (game/film/color.js). */
export type Cdl = { slope: [number, number, number]; offset: [number, number, number]; power: [number, number, number]; sat: number };
/** The preview LUTs the worker bakes for the studio's viewer (odt-rec709 and each profile's IDT), by name: the
 *  vault file (`file`, its hash) and the LUT's own content hash. */
export type FilmLuts = Record<string, { file: string; hash: string; size: number }>;
export const filmLuts = () => call<FilmLuts>('/api/film/luts');
// ─────────────────────────────── signing a terminal in ───────────────────────────────

export type DeviceRequest = { scope: string[]; descriptions: string[]; label: string; approved_at: string | null; expires_at: string };

export const deviceRequest = (code: string) => call<DeviceRequest>(`/api/device/${encodeURIComponent(code)}`);

export const approveDevice = (code: string) =>
	call<{ ok: true }>(`/api/device/${encodeURIComponent(code)}/approve`, { method: 'POST' });

// ─────────────────────────────── the studio's timelines ───────────────────────────────

/** The delivery shapes: every film goes out in each, framed for it. */
export type Shape = '16:9' | '9:16' | '1:1' | '4:5';
/** A media clip's framing in one shape: x, y in −1…1 of the room the picture has to move in; zoom ≥ 1. */
export type ClipFrame = { x: number; y: number; zoom: number };

/**
 * One clip on the timeline (contract C1). `fin` / `fout`: the clip's own fade in and out, in seconds — a sound bed
 * crossfades, a hit comes in at once. A media clip (`kind` absent or 'media') names a vault file by `hash`; a world
 * clip (`kind: 'world'`, V1 only) names a world shot record and the version it was cut with. A world clip's shot-local
 * time is `in + (timelineTime − start)`.
 */
export type TimelineClip = {
	id: string;
	track: 'V1' | 'A1' | 'A2' | 'A3';
	start: number;
	in: number;
	dur: number;
	vol: number;
	fin?: number;
	fout?: number;
	kind?: 'media' | 'world';
	hash?: string;
	shot?: string;
	shotVersion?: number;
	/** this clip's own grade (Grade tab), ACEScct */
	grade?: Cdl | null;
	/** media clips: reframing per delivery shape */
	frame?: Partial<Record<Shape, ClipFrame>>;
};
/** Where a timeline stands: cut (edit), picture and sound locked, graded, rendered. */
export type TimelineStage = 'edit' | 'locked' | 'graded' | 'rendered';
export type Timeline = {
	id: string;
	name: string;
	project: string | null;
	variant: string | null;
	description: string | null;
	aspect: string;
	tags: string[];
	clips: TimelineClip[];
	created: string;
	updated: string;
	/** C1: absent on an API that does not know them yet (read as 'edit', version 1) */
	stage?: TimelineStage;
	version?: number;
	color?: { working: 'acescct'; output: 'odt-rec709' };
	/** the whole film's look */
	grade?: { look: Cdl | null; preset?: string } | null;
};

export const listTimelines = () => call<Timeline[]>('/api/timelines');
export const createTimeline = (t: Partial<Timeline>) => call<Timeline>('/api/timelines', { method: 'POST', body: JSON.stringify(t) });
export const saveTimeline = (id: string, t: Partial<Timeline>) =>
	call<Timeline>(`/api/timelines/${id}`, { method: 'PUT', body: JSON.stringify(t) });
export async function deleteTimeline(id: string): Promise<void> {
	if (native()) return void (await call(`/api/timelines/${id}`, { method: 'DELETE' }));
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
	hashes: string[];
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
	hash: string;
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
	if (native()) return void (await call(`/api/content/${id}`, { method: 'DELETE' }));
	const res = await fetch(`${API}/api/content/${id}`, { method: 'DELETE', credentials: 'include' });
	if (!res.ok) throw new Error('Could not delete it.');
}

// ─────────────────────────────── exporting a timeline ───────────────────────────────

/**
 * A job for the render worker (C6): a timeline's render, a file's proxy (with its colour read), or the preview LUTs.
 * `report` is what the worker says it did: for a render `{ color: { transforms }, conformed, plates, warnings,
 * deliveries: [{ hash, aspect, codec, qc, loudness }] }`, for a world shot's proxy `{ shot, shotVersion, proxy }`.
 * Fields past the first line come from newer APIs and may be missing.
 */
export type RenderJob = {
	id: string;
	timeline_id: string | null;
	status: 'queued' | 'rendering' | 'done' | 'failed';
	progress: number;
	note: string | null;
	output_hash: string | null;
	created: string;
	updated: string;
	kind?: 'render' | 'proxy' | 'lut' | 'frame';
	media_hash?: string | null;
	/** a world shot's proxy job: the shot and the version it renders */
	shot_id?: string | null;
	shot_version?: number | null;
	/** a hero frame's job: where it is on the timeline, and in which delivery shape */
	params?: { t?: number; shape?: string } | null;
	report?: RenderReport | null;
};
/** A render's report (stream A's worker): every transform by its config hash, what was conformed, the plates, QC. */
export type RenderReport = {
	color?: { transforms?: Record<string, unknown>; [k: string]: unknown };
	conformed?: { clip: string; proxy: string; original: string }[];
	plates?: { clip: string; aspect: string; key?: string; fingerprint?: string; reused?: boolean }[];
	warnings?: string[];
	deliveries?: { hash: string; aspect: string; codec: string; qc?: Record<string, unknown>; loudness?: Record<string, unknown> }[];
	[k: string]: unknown;
};

export const queueRender = (timelineId: string) => call<RenderJob>(`/api/timelines/${timelineId}/renders`, { method: 'POST' });
export const listRenders = (timelineId: string) => call<RenderJob[]>(`/api/timelines/${timelineId}/renders`);
/** The latest jobs, newest first: of a kind, for a file (a file's proxy status; the worker's whole queue). */
export const listJobs = (q: { kind?: 'render' | 'proxy' | 'lut' | 'frame'; hash?: string; timeline?: string; shot?: string; limit?: number } = {}) =>
	call<RenderJob[]>(`/api/film/jobs?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`);
/** A film's proxy made again, natively on this Mac (its colour read again too). */
export const remakeProxy = (hash: string) => command<void>('vault_proxy', { hash });
/** A hero frame: one frame of the timeline at t (seconds) in a delivery shape, rendered by the worker at full precision. */
export const queueFrame = (timelineId: string, at: { t: number; shape: string }) =>
	call<RenderJob>(`/api/timelines/${timelineId}/frames`, { method: 'POST', body: JSON.stringify(at) });
/** The preview LUTs baked (again) by the worker. */
export const bakeLuts = () => call<RenderJob>('/api/film/luts', { method: 'POST' });

// ─────────────────────────────── world shots (C2) ───────────────────────────────

/** A camera keyframe of a world shot: shot-local seconds, where the camera is and where it looks. */
export type CameraKey = { t: number; position: [number, number, number]; aim?: [number, number, number]; yaw?: number; pitch?: number; fov?: number };
/** A value over a shot: a constant, or [t, value] keys (linear between them). */
export type Curve = number | [number, number][];
/** The lights a shot can set, over what the hour gives them (game/film/shot.js LIGHTS). */
export const SHOT_LIGHTS = ['sun', 'fill', 'glow', 'lamps', 'sky'] as const;
/** A world shot as data (contract C2, game/film/shot.js `Spec`): everything the world needs to draw every frame of it. */
export type ShotSpec = {
	world: { sandbox: 'sandbox-4'; build: { commit: string; hash: string; file?: string } | null; seed: number; stand: [number, number]; dome?: number; props?: string; clock: number };
	seconds: number;
	fps: number;
	/** the shape the shot is composed for; the others follow its framing */
	aspect: Shape;
	camera: { kind: 'move' | 'orbit' | 'turn' | 'fly' | 'whip' | 'keys'; curve?: 'glide' | 'ease' | 'landing' | 'drift'; keys?: CameraKey[]; [arg: string]: unknown };
	lens: { fov: number; fovTo?: number };
	time: { hour: number; hourTo?: number };
	exposure: { meter: 'lock' | 'ramp' | 'fixed'; stops: Curve; ev?: number };
	lights: { id: (typeof SHOT_LIGHTS)[number]; intensity?: Curve; color?: string }[];
	cues: ({ at: number; kind: 'sound'; hash: string; level: number } | { at: number; kind: 'event'; name: string; args?: unknown })[];
	shutter: { angle: number; samples: number };
	framing: Partial<Record<Shape, { fov?: number; yaw?: number; pitch?: number; dx?: number; dy?: number }>>;
	look?: string;
	meta?: Record<string, unknown>;
};
export type Shot = { id: string; name: string; project: string | null; version: number; spec: ShotSpec; created: string; updated: string };

export const listShots = (project?: string) => call<Shot[]>(`/api/shots${project ? `?${new URLSearchParams({ project })}` : ''}`);
/** One shot, at a version (else its newest). */
export const getShot = (id: string, version?: number) => call<Shot>(`/api/shots/${id}${version ? `?version=${version}` : ''}`);
export const createShot = (s: { name: string; project?: string | null; spec: ShotSpec }) => call<Shot>('/api/shots', { method: 'POST', body: JSON.stringify(s) });
/** A changed spec is saved as a new version; the old one stays (a clip cut with it keeps rendering it). */
export const saveShot = (id: string, s: { name?: string; spec?: ShotSpec }) => call<Shot>(`/api/shots/${id}`, { method: 'PUT', body: JSON.stringify(s) });
/** Every version of a shot, oldest first. */
export const shotVersions = (id: string) => call<{ version: number; spec: ShotSpec; created: string }[]>(`/api/shots/${id}/versions`);
