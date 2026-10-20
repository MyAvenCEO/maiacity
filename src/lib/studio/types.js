// The studio's and the stories' shapes, as data: a file of the media library, its colour, a grade, a timeline and its
// clips (contract C1), a render job and its report (C6), a world shot (C2), and a story's journey, hooks, title card,
// deliveries and posts. Types alone but for a few lists a page walks (the beats, a shot's lights, …). They lived in
// $lib/auth/client.ts, beside the API's sign-in, which kept only that; the Mac's renderer reads the timeline's shape
// from here too (vault/crates/vault-render/src/timeline.rs).

// ─────────────────────────────── the media library ───────────────────────────────

/**
 * A file in the vault's catalog (iroh-docs, on every paired device), by its BLAKE3 hash.
 * @typedef {{
 *   hash: string,
 *   mime: string,
 *   kind: 'image' | 'video' | 'audio' | 'document' | 'other' | string,
 *   size: number,
 *   added: string,
 *   title: string,
 *   description: string,
 *   tags: string[],
 *   meta: Record<string, unknown>,
 *   public: boolean,
 *   original_name?: string,
 *   story?: string,
 *   class?: string
 * }} MediaItem
 * `added`: when it came into the vault; `tags`: how it is found and sorted ("Day 18", "role:cover", "shot:05 the
 * edge", "shape:16x9", …); `meta`: what else is known (a voice take's words, voice, model, duration, its colour, its
 * proxy); `public`: shown by the site or a platform, served by the gateway without a login; `original_name`: the name
 * it came in with, a fact about it, never how it is found; `story`: its one story (none: the inbox); `class`: default ·
 * original · proxy · delivery.
 */

// ─────────────────────────────── colour (C5) ───────────────────────────────

/**
 * A picture's colour, as the ingest detected it (media meta.color); `override` is the one set by hand in the studio;
 * `output`, on a film we rendered: the output transform baked in (e.g. odt-rec709).
 * @typedef {{ profile: string, output?: string, primaries?: string, transfer?: string, matrix?: string, range?: string, bitDepth?: number, detectedFrom?: string, override?: string }} ColorInfo
 */
/**
 * A grading tool on a stack (game/film/grade-tools.js: `{ tool, on?, ...its controls, tools? }`, vault-render `tools::Item`).
 * @typedef {{ tool: string, on?: boolean, tools?: GradeTool[], [control: string]: unknown }} GradeTool
 */
/**
 * A stack of tools: a shot's base correct or clip look, a scene's look, the timeline's look (its texture last).
 * @typedef {{ strength?: number, tools: GradeTool[] }} GradeStack
 */
/** @typedef {import('../../../game/film/sound.js').EqBand} EqBand */
/**
 * A grade: ASC CDL in ACEScct (game/film/color.js).
 * @typedef {{ slope: [number, number, number], offset: [number, number, number], power: [number, number, number], sat: number }} Cdl
 */

// ─────────────────────────────── the studio's timelines ───────────────────────────────

/** The delivery shapes: every film goes out in each, framed for it. @typedef {'16:9' | '9:16' | '1:1' | '4:5'} Shape */
/** A media clip's framing in one shape: x, y in −1…1 of the room the picture has to move in; zoom ≥ 1. @typedef {{ x: number, y: number, zoom: number }} ClipFrame */
/** @typedef {{ temp: number, tint: number, exposure: number, contrast: number, highlights: number, shadows: number, sat: number }} Balance */
/** @typedef {{ scene?: string, label?: string, description?: string, notes?: string, size?: string }} ClipScript */
/**
 * One clip on the timeline (contract C1). `fin` / `fout`: the clip's own fade in and out, in seconds — a sound bed
 * crossfades, a hit comes in at once. A media clip (`kind` absent or 'media') names a vault file by `hash`; a world
 * clip (`kind: 'world'`, V1 only) names a world shot record and the version it was cut with. A world clip's shot-local
 * time is `in + (timelineTime − start)`.
 *
 * `kind` 'slate': a shot of the script not filmed yet (V1); 'line': a line not recorded yet (A1, its `text`).
 * `section` (S1): which part of the story; `tension`: 0…1 at points 0…1 of its length, and the feeling the viewer
 * should have there (curiosity, unease, awe …), the emotional journey the story leads them through. `stacks`: a V1
 * clip's grade as stacks of tools, `base` (its base correction) and `clip` (its own look). `eq`: a sound clip's EQ
 * (game/film/sound.js `cleanEq`), bands in order, the render's and the studio's playback's; `keys`: its gain keys
 * ([seconds into the clip, dB], `cleanKeys`). `script`: where a picture clip stands in the script. `text`: a line's
 * words to be said. `frame`: a media clip's reframing per delivery shape. `link`: a video's picture (V1) and its own
 * sound (an A track, the same hash) share one, moved and trimmed together in the studio; the sound plays from the
 * original (the render) or its audio proxy (the studio).
 * @typedef {{
 *   id: string,
 *   track: 'V1' | 'A1' | 'A2' | 'A3',
 *   start: number,
 *   in: number,
 *   dur: number,
 *   vol: number,
 *   fin?: number,
 *   fout?: number,
 *   kind?: 'media' | 'world' | 'slate' | 'line' | 'section',
 *   section?: 'thumbnail' | 'hook' | 'act1' | 'act2' | 'act3' | 'cliffhanger',
 *   tension?: { t: number, v: number, feel?: string }[],
 *   hash?: string,
 *   shot?: string,
 *   shotVersion?: number,
 *   stacks?: { base?: GradeStack, clip?: GradeStack },
 *   eq?: EqBand[],
 *   keys?: [number, number][],
 *   script?: ClipScript,
 *   text?: string,
 *   frame?: Partial<Record<Shape, ClipFrame>>,
 *   link?: string
 * }} TimelineClip
 */
/** Where a timeline stands: cut (edit), picture and sound locked, graded, rendered. @typedef {'edit' | 'locked' | 'graded' | 'rendered'} TimelineStage */
/**
 * A timeline. `stage` and `version` (C1) are absent on an API that does not know them yet (read as 'edit', version 1);
 * `grade`: the film's grade above its shots', as stacks of tools, each scene's look (by the scene its clips name) and
 * the timeline's look; `chapters`: its named parts, each from its start to the next one's (./studio.svelte.js).
 * @typedef {{
 *   id: string,
 *   name: string,
 *   project: string | null,
 *   variant: string | null,
 *   description: string | null,
 *   aspect: string,
 *   tags: string[],
 *   clips: TimelineClip[],
 *   created: string,
 *   updated: string,
 *   stage?: TimelineStage,
 *   version?: number,
 *   color?: { working: 'acescct', output: 'odt-rec709' },
 *   grade?: { scenes?: Record<string, GradeStack>, timeline?: GradeStack } | null,
 *   chapters?: Chapter[]
 * }} Timeline
 */
/** A chapter of a timeline: where it starts (seconds) and what it is called. @typedef {{ id: number, at: number, name: string }} Chapter */

// ─────────────────────────────── the stories ───────────────────────────────

/**
 * Where a story stands, in the order it moves: its brainstorm pad; its journey (the arc, beat by beat); its hook (the
 * title, the intro, the description); its thumbnail (the 16:9 title card, designed in layers); the long-form master
 * article (writing); the film (movie); the article locked and the posts derived from it; dated; out.
 */
export const STATUSES = /** @type {const} */ (['idea', 'hook', 'thumbnail', 'journey', 'writing', 'movie', 'derivatives', 'scheduled', 'published']);
/** @typedef {(typeof STATUSES)[number]} Status */

/** What a beat of the journey is, as the arc moves (storyteller, arc.md) — each its own colour on the board. */
export const BEATS = /** @type {const} */ (['hook', 'context', 'problem', 'intention', 'obstacle', 'low', 'turn', 'solution', 'vision']);
/** @typedef {(typeof BEATS)[number]} BeatType */

/**
 * One beat of a story's journey: what happens, what kind of step it is, how it follows the beat before (but: it
 * turns; therefore: it follows), and what the viewer should feel there, with the tension it holds (0 calm … 1 most).
 * @typedef {{ id: string, title: string, type: BeatType, text: string, link?: 'but' | 'therefore', feel?: string, tension?: number }} Beat
 */
/** The journey: the transformation (from → to), the one arching question, and the beats in order. @typedef {{ from?: string, to?: string, question?: string, beats?: Beat[] }} Journey */

/** The parts a hook is assembled from (the hook-writer skill): four required, two optional, and the feeling it anchors. */
export const HOOK_PARTS = /** @type {const} */ (['subject', 'action', 'end', 'contrast', 'proof', 'time', 'anchor']);
/** @typedef {(typeof HOOK_PARTS)[number]} HookPart */
/**
 * One hook tried for a story: the line, its parts named (so the subject, the verb and the contrast can be pointed
 * at), the promise and the objection killer after it, how far up the extreme dial it sits (1 mild … 3 extreme, 4
 * false) and a note. The one whose line is the story's `hook` is on the title card.
 * @typedef {{ id: string, text: string, promise?: string, objection?: string, dial?: number, note?: string, image_title?: string[] } & Partial<Record<HookPart, string>>} HookVariant
 */

/** The kinds of layer a title card is designed from, bottom to top as they usually go. */
export const LAYER_KINDS = /** @type {const} */ (['image', 'cutout', 'text', 'badge']);
/** @typedef {(typeof LAYER_KINDS)[number]} LayerKind */
/**
 * One layer of the title card on its 16:9 canvas, in percent of the canvas (x, y: the top-left corner; w: the width;
 * size: a text's size in percent of the canvas width): a picture (the background), a cut-out (a transparent PNG: a
 * face out of a frame), the hook as text (an empty text is the story's hook) or a badge ("DAY 1"). `on`: shown, or
 * hidden for the moment; `hash`: a picture's or a cut-out's vault file, and `fit` how a background fills the canvas;
 * `text` and `color`: a text's or a badge's words and colour (white, gold; a badge: gold, alert, ink, white); `rot`:
 * turned, in degrees about its centre.
 * @typedef {{
 *   id: string,
 *   kind: LayerKind,
 *   name?: string,
 *   on?: boolean,
 *   hash?: string,
 *   fit?: 'cover' | 'contain',
 *   text?: string,
 *   color?: string,
 *   align?: 'left' | 'center' | 'right',
 *   x?: number,
 *   y?: number,
 *   w?: number,
 *   size?: number,
 *   rot?: number
 * }} Layer
 */
/** The title card as designed: its layers, and the 16:9 card rendered from them (by hash), once there is one. @typedef {{ layers?: Layer[], card?: string | null }} Thumbnail */

/**
 * One file a film is delivered as: which channels it is for, and what it is. `kind`: a video (the default), or the
 * thumbnail / cover it goes out with; `timeline` and `cut`: the timeline (cut) it was rendered from, and that cut's
 * name ("Full shots 2", "Reel 90s").
 * @typedef {{
 *   channels: string[],
 *   hash: string,
 *   format: string,
 *   aspect: string,
 *   width: number,
 *   height: number,
 *   codec: string,
 *   bytes: number,
 *   seconds: number,
 *   note?: string,
 *   kind?: 'video' | 'thumbnail',
 *   timeline?: string,
 *   cut?: string
 * }} Delivery
 */

/** Where a post goes: our own journal (the base article itself), or one of the platforms. @typedef {'journal' | 'youtube' | 'linkedin' | 'x' | 'instagram'} Platform */
/**
 * What kind of thing it is, whatever the platform: the article (our journal's, or an X Article), a film, a YouTube
 * Short, a Reel, a text post, a thread.
 * @typedef {'article' | 'video' | 'short' | 'reel' | 'post' | 'thread'} Format
 */
/**
 * One derivative of the day's base article, for one platform, going out at its own time. A video or Reel posts the
 * delivery with the same aspect and codec; a post with an aspect goes out with the thumbnail of that shape. `thread`:
 * an X thread, one entry per tweet; `placement`: Instagram's feed (the full film, 1:1) or its Reels (a short cut,
 * 9:16); `scheduled_at`: when this one goes out (else the item's date); `timeline`: the cut it posts; `url`: once it
 * is out, the platform's own link to it.
 * @typedef {{
 *   platform: Platform,
 *   format?: Format,
 *   title?: string,
 *   text: string,
 *   thread?: string[],
 *   placement?: 'feed' | 'reel',
 *   aspect?: string,
 *   codec?: string,
 *   scheduled_at?: string,
 *   note?: string,
 *   timeline?: string,
 *   url?: string
 * }} Post
 */

// ─────────────────────────────── exporting a timeline ───────────────────────────────

/**
 * A job for the render worker (C6): a timeline's render or a hero frame (`proxy` and `lut` jobs are history).
 * `report` is what the worker says it did: for a render `{ color: { transforms }, conformed, plates, warnings,
 * deliveries: [{ hash, aspect, codec, qc, loudness }] }`, for a world shot's proxy `{ shot, shotVersion, proxy }`.
 * Fields past `updated` come from newer APIs and may be missing: `shot_id` and `shot_version`, a world shot's proxy
 * job's shot and the version it renders; `params`, a hero frame's place on the timeline and its delivery shape.
 * @typedef {{
 *   id: string,
 *   timeline_id: string | null,
 *   status: 'queued' | 'rendering' | 'done' | 'failed',
 *   progress: number,
 *   note: string | null,
 *   output_hash: string | null,
 *   created: string,
 *   updated: string,
 *   kind?: 'render' | 'proxy' | 'lut' | 'frame',
 *   media_hash?: string | null,
 *   shot_id?: string | null,
 *   shot_version?: number | null,
 *   params?: { t?: number, shape?: string } | null,
 *   report?: RenderReport | null
 * }} RenderJob
 */
/**
 * A render's report (stream A's worker): every transform by its config hash, what was conformed, the plates, QC.
 * @typedef {{
 *   color?: { transforms?: Record<string, unknown>, [k: string]: unknown },
 *   conformed?: { clip: string, proxy: string, original: string }[],
 *   plates?: { clip: string, aspect: string, key?: string, fingerprint?: string, reused?: boolean }[],
 *   warnings?: string[],
 *   deliveries?: { hash: string, aspect: string, codec: string, qc?: Record<string, unknown>, loudness?: Record<string, unknown> }[],
 *   [k: string]: unknown
 * }} RenderReport
 */

// ─────────────────────────────── world shots (C2) ───────────────────────────────

/** A camera keyframe of a world shot: shot-local seconds, where the camera is and where it looks. @typedef {{ t: number, position: [number, number, number], aim?: [number, number, number], yaw?: number, pitch?: number, fov?: number }} CameraKey */
/** A value over a shot: a constant, or [t, value] keys (linear between them). @typedef {number | [number, number][]} Curve */
/** The lights a shot can set, over what the hour gives them (game/film/shot.js LIGHTS). */
export const SHOT_LIGHTS = /** @type {const} */ (['sun', 'fill', 'glow', 'lamps', 'sky', 'glass', 'cb60']);
/**
 * A world shot as data (contract C2, game/film/shot.js `Spec`): everything the world needs to draw every frame of it.
 * `world`: which world and where in it (game/film/worlds.js, the one registry of them; `dome` and `props` are Sandbox
 * 4's); `aspect`: the shape the shot is composed for, which the others follow; `camera` (game/film/camera.js): a move,
 * or `world` (the world's own camera), with `frame` one of the world's frames its poses are in; `parts`: the world's
 * moving parts the shot moves (game/film/worlds.js `parts`), each by its channels, a constant or keys.
 * @typedef {{
 *   world: { sandbox: import('../../../game/film/worlds.js').Sandbox, area?: string, build: { commit: string, hash: string, file?: string } | null, seed: number, stand: [number, number], dome?: number, props?: string, clock: number },
 *   seconds: number,
 *   fps: number,
 *   aspect: Shape,
 *   camera: { kind: 'move' | 'orbit' | 'turn' | 'fly' | 'whip' | 'keys' | 'world', curve?: 'glide' | 'ease' | 'landing' | 'drift', keys?: CameraKey[], frame?: string, [arg: string]: unknown },
 *   lens: { fov: number, fovTo?: number, near?: number },
 *   time: { hour: number, hourTo?: number },
 *   exposure: { meter: 'lock' | 'ramp' | 'fixed', stops: Curve, ev?: number },
 *   lights: { id: (typeof SHOT_LIGHTS)[number], intensity?: Curve, color?: string }[],
 *   parts?: { id: string, [channel: string]: Curve | string }[],
 *   cues: ({ at: number, kind: 'sound', hash: string, level: number } | { at: number, kind: 'event', name: string, args?: unknown })[],
 *   shutter: { angle: number, samples: number },
 *   framing: Partial<Record<Shape, { fov?: number, yaw?: number, pitch?: number, dx?: number, dy?: number }>>,
 *   look?: string,
 *   meta?: Record<string, unknown>
 * }} ShotSpec
 */
/** @typedef {{ id: string, name: string, project: string | null, version: number, spec: ShotSpec, created: string, updated: string }} Shot */
