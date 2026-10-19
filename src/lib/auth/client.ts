// The browser half of the signup service. The journal itself stays a static
// site on the CDN; only these calls reach a server, and only when somebody
// actually signs up.
import { dev } from '$app/environment';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { APP_API, command, native } from '$lib/native';
import type { Sandbox } from '../../../game/film/worlds.js';

/** api.maia.city in production, the local container in development. */
// 3100 locally, so it can run beside other projects' stacks on 3000.
export const API = dev
	? ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3100')
	: 'https://api.maia.city';

/** Who is signed in, as maiaCITY's API knows them: their id, place in the line and role. Their profile, their name
 *  among it, lives in their avenDB human vault alone ($lib/avendb/session.svelte.js `session.name`). */
export type Founder = {
	id: string;
	/** their place in the line — founder number 1, 2, 3 … */
	number: number;
	since: string;
	/** only on /api/me: their role, and every capability it holds */
	role?: string;
	caps?: string[];
};

/** May they? The API decides for real; this only keeps the site from offering what it would refuse. */
export const may = (founder: Founder | null | undefined, cap: string) => !!founder?.caps?.includes(cap);

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

/** A sign-in's options: its challenge among them, which the passkey's assertion must be over. */
export const loginOptions = () => call<any>('/api/passkey/login/options', { method: 'POST' });

/** Signs in with `assertion`, a ceremony over a sign-in's challenge (WebAuthn's JSON): here, or in the ceremony that
 *  unlocks the person's avenDB on this browser too ($lib/app/entry.js). */
export const loginFinish = (assertion: object) =>
	call<Founder>('/api/passkey/login/finish', { method: 'POST', body: JSON.stringify(assertion) });

/** Sign in: no username field anywhere — the passkey already knows who it is. */
export async function signIn(): Promise<Founder> {
	const options = await loginOptions();
	return loginFinish(await startAuthentication({ optionsJSON: options }));
}

/** Whether an invite may still be used to sign up with: an invite of Maia City's in avenDB, by its share's id, that no
 *  vault claimed yet, or an older code of the API's, unused and unexpired. */
export const inviteOpen = (code: string) =>
	call<{ open: boolean }>(`/api/invites/${encodeURIComponent(code)}`).then((r) => r.open);

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

// ─────────────────────────────── colour (C5) ───────────────────────────────

/** A picture's colour, as the ingest detected it (media meta.color); `override` is the one set by hand in the studio. */
export type ColorInfo = { profile: string; /** a film we rendered: the output transform baked in (e.g. odt-rec709) */ output?: string; primaries?: string; transfer?: string; matrix?: string; range?: string; bitDepth?: number; detectedFrom?: string; override?: string };
/** A grading tool on a stack (game/film/grade-tools.js: `{ tool, on?, ...its controls, tools? }`, vault-render `tools::Item`). */
export type GradeTool = { tool: string; on?: boolean; tools?: GradeTool[]; [control: string]: unknown };
/** A stack of tools: a shot's base correct or clip look, a scene's look, the timeline's look (its texture last). */
export type GradeStack = { strength?: number; tools: GradeTool[] };

export type EqBand = import('../../../game/film/sound.js').EqBand;
/** A grade: ASC CDL in ACEScct (game/film/color.js). */
export type Cdl = { slope: [number, number, number]; offset: [number, number, number]; power: [number, number, number]; sat: number };
// ─────────────────────────────── signing a terminal in ───────────────────────────────

/** In The OS, a ceremony of the person's passkey over a new sign-in's challenge, in its sign-in sheet
 *  (src/routes/app/avendb/sheet/), which brings it back to the app alone: what the API takes as the person's own word
 *  as it signs The OS in. */
export async function sheetAssertion(): Promise<object> {
	const { SHEET } = await import('$lib/avendb/device/passkey.js');
	const options = await loginOptions();
	const back = await command<string>('passkey_sheet', {
		url: `${SHEET}#${new URLSearchParams({ what: 'signin', options: JSON.stringify(options) })}`
	});
	const answer = new URLSearchParams(back.split('#')[1] ?? '');
	const assertion = answer.get('assertion');
	if (!assertion) throw new Error(answer.get('error') || 'The sign-in sheet brought nothing back.');
	return JSON.parse(assertion);
}

/** The OS approves its own key with `assertion`, a passkey ceremony over a sign-in's challenge that its sign-in sheet
 *  brought back to it alone (src/routes/app/avendb/sheet/): no browser session, no code to compare. */
export const approveDeviceWithPasskey = (code: string, assertion: object) =>
	call<{ ok: true }>(`/api/device/${encodeURIComponent(code)}/passkey`, { method: 'POST', body: JSON.stringify(assertion) });

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
export type Balance = { temp: number; tint: number; exposure: number; contrast: number; highlights: number; shadows: number; sat: number };
export type ClipScript = { scene?: string; label?: string; description?: string; notes?: string; size?: string };
export type TimelineClip = {
	id: string;
	track: 'V1' | 'A1' | 'A2' | 'A3';
	start: number;
	in: number;
	dur: number;
	vol: number;
	fin?: number;
	fout?: number;
	/** 'slate': a shot of the script not filmed yet (V1); 'line': a line not recorded yet (A1, its `text`) */
	kind?: 'media' | 'world' | 'slate' | 'line' | 'section';
	/** sections (S1): which part of the story */
	section?: 'thumbnail' | 'hook' | 'act1' | 'act2' | 'act3' | 'cliffhanger';
	/** sections: tension 0…1 at points 0…1 of its length, and the feeling the viewer should have there (curiosity, unease,
	 *  awe …) — the emotional journey the story leads them through */
	tension?: { t: number; v: number; feel?: string }[];
	hash?: string;
	shot?: string;
	shotVersion?: number;
	/** a V1 clip's grade as stacks of tools: `base` (its base correction), `clip` (its own look) */
	stacks?: { base?: GradeStack; clip?: GradeStack };
	/** a sound clip's EQ (game/film/sound.js `cleanEq`): bands in order, the render's and the studio's playback's */
	eq?: EqBand[];
	/** a sound clip's gain keys ([seconds into the clip, dB], game/film/sound.js `cleanKeys`) */
	keys?: [number, number][];
	/** picture clips: where the clip stands in the script */
	script?: ClipScript;
	/** lines: the words to be said */
	text?: string;
	/** media clips: reframing per delivery shape */
	frame?: Partial<Record<Shape, ClipFrame>>;
	/**
	 * media clips: a video's picture (V1) and its own sound (an A track, the same hash) share one `link` — moved and
	 * trimmed together in the studio. The sound plays from the original (the render) or its audio proxy (the studio).
	 */
	link?: string;
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
	/** the film's grade above its shots', as stacks of tools: each scene's look (by the scene its clips name), the timeline's look */
	grade?: { scenes?: Record<string, GradeStack>; timeline?: GradeStack } | null;
	/** its chapters: named parts of the film, each from its start to the next one's (src/lib/studio/studio.svelte.js) */
	chapters?: Chapter[];
};
/** A chapter of a timeline: where it starts (seconds) and what it is called. */
export type Chapter = { id: number; at: number; name: string };

// ─────────────────────────────── the stories ───────────────────────────────

/**
 * Where a story stands, in the order it moves: its brainstorm pad; its journey (the arc, beat by beat); its hook (the
 * title, the intro, the description); its thumbnail (the 16:9 title card, designed in layers); the long-form master
 * article (writing); the film (movie); the article locked and the posts derived from it; dated; out.
 */
export const STATUSES = ['idea', 'hook', 'thumbnail', 'journey', 'writing', 'movie', 'derivatives', 'scheduled', 'published'] as const;
export type Status = (typeof STATUSES)[number];

/** What a beat of the journey is, as the arc moves (storyteller, arc.md) — each its own colour on the board. */
export const BEATS = ['hook', 'context', 'problem', 'intention', 'obstacle', 'low', 'turn', 'solution', 'vision'] as const;
export type BeatType = (typeof BEATS)[number];

/**
 * One beat of a story's journey: what happens, what kind of step it is, how it follows the beat before (but: it
 * turns; therefore: it follows), and what the viewer should feel there, with the tension it holds (0 calm … 1 most).
 */
export type Beat = { id: string; title: string; type: BeatType; text: string; link?: 'but' | 'therefore'; feel?: string; tension?: number };
/** The journey: the transformation (from → to), the one arching question, and the beats in order. */
export type Journey = { from?: string; to?: string; question?: string; beats?: Beat[] };

/** The parts a hook is assembled from (the hook-writer skill): four required, two optional, and the feeling it anchors. */
export const HOOK_PARTS = ['subject', 'action', 'end', 'contrast', 'proof', 'time', 'anchor'] as const;
export type HookPart = (typeof HOOK_PARTS)[number];
/**
 * One hook tried for a story: the line, its parts named (so the subject, the verb and the contrast can be pointed
 * at), the promise and the objection killer after it, how far up the extreme dial it sits (1 mild … 3 extreme, 4
 * false) and a note. The one whose line is the story's `hook` is on the title card.
 */
export type HookVariant = { id: string; text: string; promise?: string; objection?: string; dial?: number; note?: string; image_title?: string[] } & Partial<
	Record<HookPart, string>
>;

/** The kinds of layer a title card is designed from, bottom to top as they usually go. */
export const LAYER_KINDS = ['image', 'cutout', 'text', 'badge'] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];
/**
 * One layer of the title card on its 16:9 canvas, in percent of the canvas (x, y: the top-left corner; w: the width;
 * size: a text's size in percent of the canvas width): a picture (the background), a cut-out (a transparent PNG: a
 * face out of a frame), the hook as text (an empty text is the story's hook) or a badge ("DAY 1").
 */
export type Layer = {
	id: string;
	kind: LayerKind;
	name?: string;
	/** shown, or hidden for the moment */
	on?: boolean;
	/** a picture or a cut-out: the vault file by hash; how a background fills the canvas */
	hash?: string;
	fit?: 'cover' | 'contain';
	/** a text or a badge: its words, its colour (white, gold; a badge: gold, alert, ink, white) */
	text?: string;
	color?: string;
	align?: 'left' | 'center' | 'right';
	x?: number;
	y?: number;
	w?: number;
	size?: number;
	/** turned, in degrees about its centre */
	rot?: number;
};
/** The title card as designed: its layers, and the 16:9 card rendered from them (by hash), once there is one. */
export type Thumbnail = { layers?: Layer[]; card?: string | null };

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
	/** once it is out: where it is (the platform's own link) */
	url?: string;
};



// ─────────────────────────────── exporting a timeline ───────────────────────────────

/**
 * A job for the render worker (C6): a timeline's render or a hero frame (`proxy` and `lut` jobs are history).
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


// ─────────────────────────────── world shots (C2) ───────────────────────────────

/** A camera keyframe of a world shot: shot-local seconds, where the camera is and where it looks. */
export type CameraKey = { t: number; position: [number, number, number]; aim?: [number, number, number]; yaw?: number; pitch?: number; fov?: number };
/** A value over a shot: a constant, or [t, value] keys (linear between them). */
export type Curve = number | [number, number][];
/** The lights a shot can set, over what the hour gives them (game/film/shot.js LIGHTS). */
export const SHOT_LIGHTS = ['sun', 'fill', 'glow', 'lamps', 'sky', 'glass', 'cb60'] as const;
/** A world shot as data (contract C2, game/film/shot.js `Spec`): everything the world needs to draw every frame of it. */
export type ShotSpec = {
	/** which world and where in it (game/film/worlds.js, the one registry of them); dome and props are Sandbox 4's */
	world: { sandbox: Sandbox; area?: string; build: { commit: string; hash: string; file?: string } | null; seed: number; stand: [number, number]; dome?: number; props?: string; clock: number };
	seconds: number;
	fps: number;
	/** the shape the shot is composed for; the others follow its framing */
	aspect: Shape;
	/** game/film/camera.js: a move, or `world` (the world's own camera); `frame`: one of the world's frames its poses are in */
	camera: { kind: 'move' | 'orbit' | 'turn' | 'fly' | 'whip' | 'keys' | 'world'; curve?: 'glide' | 'ease' | 'landing' | 'drift'; keys?: CameraKey[]; frame?: string; [arg: string]: unknown };
	lens: { fov: number; fovTo?: number; near?: number };
	time: { hour: number; hourTo?: number };
	exposure: { meter: 'lock' | 'ramp' | 'fixed'; stops: Curve; ev?: number };
	lights: { id: (typeof SHOT_LIGHTS)[number]; intensity?: Curve; color?: string }[];
	/** the world's moving parts the shot moves (game/film/worlds.js `parts`): each by its channels, a constant or keys */
	parts?: { id: string; [channel: string]: Curve | string }[];
	cues: ({ at: number; kind: 'sound'; hash: string; level: number } | { at: number; kind: 'event'; name: string; args?: unknown })[];
	shutter: { angle: number; samples: number };
	framing: Partial<Record<Shape, { fov?: number; yaw?: number; pitch?: number; dx?: number; dy?: number }>>;
	look?: string;
	meta?: Record<string, unknown>;
};
export type Shot = { id: string; name: string; project: string | null; version: number; spec: ShotSpec; created: string; updated: string };

/** Any API call, the same way as every helper here. */
export const apiCall = <T>(path: string, init: RequestInit = {}) => call<T>(path, init);
