/**
 * The stories board. An item is one story — from the first idea on its brainstorm pad to what went live — moving
 * idea → journey → hook → writing → movie → derivatives → scheduled → published: its journey (the arc beat by beat,
 * the feeling of each), the hook (its title, description and thumbnail), the long-form master article (writing), the
 * film (movie, made in the studio); moving it on to "derivatives" locks the article, and everything that goes out is
 * derived from it then. Three things carry a story out, each its own job: the hook grabs attention and is the title
 * everywhere (picked from the variants tried, `hooks`); the intro, the first 3–30 s of a film, sparks curiosity and
 * says why to care and what the viewer's transformation is; the description is the overview and the detail.
 * A film is one item, whatever its cuts: every render of the project's timelines files its
 * deliveries on it (the 4K master, the 1080 copy, the 9:16 Reel, their thumbnails), and its posts, one per platform,
 * are written for them — prepared, never typed in a form. Once a story has a hook, the Mac app files it in a story
 * of its own in the media vault (an iroh-docs bucket), and its id is kept here.
 */
import { db } from "./pg";

export class ContentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const KINDS = ["film", "reel", "post", "thread", "article", "newsletter", "story", "podcast"];
/** where we post, for now — and our own journal, where the day's base article goes out */
export const CHANNELS = ["journal", "youtube", "linkedin", "instagram", "x"];
/** what a derivative is, across platforms: an article (the blog post; on X, an X Article — long form), a film, a
 *  YouTube Short (≤ 3 min, square or vertical), a Reel, a post, a thread */
export const FORMATS = ["article", "video", "short", "reel", "post", "thread"];
export const STATUSES = ["idea", "journey", "hook", "thumbnail", "writing", "movie", "derivatives", "scheduled", "published"];
/** from the derivatives on, the base article is locked: they were written from it */
const LOCKED = ["derivatives", "scheduled", "published"];
/** what a beat of the journey is (arc.md's hidden machine, with the low, the turn and the vision a movement ends on) */
export const BEATS = ["hook", "context", "problem", "intention", "obstacle", "low", "turn", "solution", "vision"];

/**
 * One beat of a story's journey: what happens, what kind of step it is, how it follows the beat before (*but* — it
 * turns; *therefore* — it follows), and what the viewer should feel there, with the tension it holds (0 calm … 1 most).
 */
export type Beat = { id: string; title: string; type: string; text: string; link?: "but" | "therefore"; feel?: string; tension?: number };
/** The journey: the transformation (from → to), the one arching question, and the beats in order. */
export type Journey = { from?: string; to?: string; question?: string; beats?: Beat[] };

/** The parts a hook is assembled from (the hook-writer skill): four required, two optional, and the feeling. */
export const HOOK_PARTS = ["subject", "action", "end", "contrast", "proof", "time", "anchor"] as const;
/**
 * One hook tried for a story: the line itself, its parts named so it can be judged (point at the subject, the verb,
 * the contrast), the promise and the objection killer that follow it, how far up the extreme dial it sits (1 mild …
 * 3 extreme, 4 false), and a note. The one whose line is the story's `hook` is the one on the title card.
 */
export type HookVariant = {
  id: string; text: string;
  subject?: string; action?: string; end?: string; contrast?: string; proof?: string; time?: string; anchor?: string;
  promise?: string; objection?: string; dial?: number; note?: string;
};

/** The kinds of layer a title card is designed from, bottom to top as they usually go. */
export const LAYER_KINDS = ["image", "cutout", "text", "badge"] as const;
/**
 * One layer of the title card, placed on its 16:9 canvas in percent of the canvas (x, y: the top-left corner; w: the
 * width; size: a text's size, in percent of the canvas width): a picture (the background, usually), a cut-out (a
 * transparent PNG: his face, out of a frame), the hook as text (an empty text is the story's hook), or a badge ("DAY 1").
 */
export type Layer = {
  id: string; kind: (typeof LAYER_KINDS)[number]; name?: string;
  /** shown, or hidden for the moment */
  on?: boolean;
  /** a picture or a cut-out: the vault file, by hash; how the background fills the canvas */
  hash?: string; fit?: "cover" | "contain";
  /** a text or a badge: its words; its colour (white, gold) */
  text?: string; color?: string; align?: "left" | "center" | "right";
  x?: number; y?: number; w?: number; size?: number;
};
/** The title card as designed: its layers, and the 16:9 card rendered from them (by hash), once there is one. */
export type Thumbnail = { layers?: Layer[]; card?: string | null };

/** One file a film is delivered as: which channels it is for, and what it is (for the upload step, later). */
export type Delivery = {
  channels: string[];
  /** the file, by its BLAKE3 hash (64 hex) */
  hash: string; format: string; aspect: string; width: number; height: number;
  codec: string; bytes: number; seconds: number; note?: string;
  /** a video (the default), or the thumbnail / cover it goes out with */
  kind?: "video" | "thumbnail";
  /** the timeline (cut) it was rendered from, and that cut's name: "Full shots 2", "Reel 90s" */
  timeline?: string; cut?: string;
};

/** One post, for one platform: its words, and which of the film's files and thumbnail it goes out with. */
export type Post = {
  platform: string; format?: string; title?: string; text: string;
  /** an X thread: one entry per tweet (text is then its first) */
  thread?: string[];
  /** when this one goes out — the day's derivatives are spread around it */
  scheduled_at?: string;
  /** Instagram only: the feed (the full film, 1:1) or the Reels (a cut of 90 s at most, 9:16) */
  placement?: "feed" | "reel";
  /** the delivery it posts: the film cut for this shape and codec, and its thumbnail */
  aspect: string; codec: string; note?: string;
  /** the timeline (cut) it posts */
  timeline?: string;
  /** once it is out: where it is (the platform's own link, Zernio's platformPostUrl) */
  url?: string;
};

export type Item = {
  id: string; title: string; kind: string; channels: string[]; status: string; scheduled_at: string | null;
  body: string;
  /** the vault files it carries, by hash */
  hashes: string[]; link: string | null; tags: string[]; deliveries: Delivery[]; posts: Post[]; timeline_id: string | null;
  project: string | null;
  /** the base article's file in the repo (blog/day-NN-…/post.md); its text is `body` */
  source: string | null;
  /** the hook: the title set into the day's title cards ("The 1 million lives decision — I almost didn't dare to take") */
  hook: string | null;
  /** the hooks tried, the one on the card among them */
  hooks: HookVariant[];
  /** the brainstorm pad: links, concepts, fragments (Markdown) */
  idea: string;
  /** the intro, the trailer: the first 3–30 s of the film (by its length), why to care and the transformation */
  intro: string;
  /** the description that goes under the hook (YouTube's, the journal's lede): the overview and the detail */
  description: string;
  journey: Journey;
  /** the title card as designed, layer by layer, and the card rendered from it */
  thumbnail: Thumbnail;
  /** the media vault's story it is filed in (an iroh namespace id), once the Mac app has made it */
  story: string | null;
  created: string; updated: string;
};

const list = (v: unknown, allowed?: string[]) => {
  const out = (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean);
  if (allowed && out.some((x) => !allowed.includes(x))) throw new ContentError(`One of: ${allowed.join(", ")}.`);
  return [...new Set(out)];
};

const text = (v: unknown, max: number) => String(v ?? "").slice(0, max);

/**
 * The article itself, for the lock: not whether the post is out yet (its `draft:` line — publishing flips it), nor the
 * pictures and film it is shown with (its cover, banner, poster, the files its images point at).
 */
const articleOf = (b: string) =>
  b.replace(/^(draft|cover|coverPosition|coverAlt|banner|poster|videoLocal|authorImage):.*\n/gm, "").replace(/(!\[[^\]]*\])\([^)]*\)/g, "$1()");

/** A journey as sent: kept to its fields and their lengths; a beat of an unknown kind, or without a title, refused. */
function journeyOf(v: unknown): Journey {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ContentError("Send the journey as an object.");
  const j = v as Record<string, unknown>;
  const beats = j.beats === undefined ? [] : j.beats;
  if (!Array.isArray(beats) || beats.length > 80) throw new ContentError("The journey's beats are a list (80 at most).");
  return {
    from: text(j.from, 500), to: text(j.to, 500), question: text(j.question, 500),
    beats: beats.map((x, i): Beat => {
      const b = (x ?? {}) as Record<string, unknown>;
      const title = text(b.title, 160).trim();
      if (!title) throw new ContentError("Every beat needs its title.");
      if (!BEATS.includes(String(b.type))) throw new ContentError(`A beat is one of: ${BEATS.join(", ")}.`);
      const link = b.link === "but" || b.link === "therefore" ? b.link : undefined;
      const tension = Number(b.tension);
      return {
        id: text(b.id, 40) || `b${i + 1}`, title, type: String(b.type), text: text(b.text, 4000),
        ...(link ? { link } : {}),
        ...(b.feel ? { feel: text(b.feel, 80) } : {}),
        ...(Number.isFinite(tension) ? { tension: Math.min(1, Math.max(0, tension)) } : {}),
      };
    }),
  };
}

/** The hooks tried, as sent: each with its line, kept to their fields and lengths; one without a line refused. */
function hooksOf(v: unknown): HookVariant[] {
  if (!Array.isArray(v) || v.length > 40) throw new ContentError("The hooks are a list (40 at most).");
  return v.map((x, i): HookVariant => {
    const h = (x ?? {}) as Record<string, unknown>;
    const line = text(h.text, 300).trim();
    if (!line) throw new ContentError("Every hook needs its line.");
    const out: HookVariant = { id: text(h.id, 40) || `h${i + 1}`, text: line };
    for (const k of HOOK_PARTS) if (h[k]) out[k] = text(h[k], 160);
    if (h.promise) out.promise = text(h.promise, 300);
    if (h.objection) out.objection = text(h.objection, 300);
    if (h.note) out.note = text(h.note, 200);
    const dial = Number(h.dial);
    if (Number.isFinite(dial)) out.dial = Math.min(4, Math.max(1, Math.round(dial)));
    return out;
  });
}

/** The title card as sent: its layers kept to their kinds, fields and lengths; a layer of an unknown kind refused. */
function thumbnailOf(v: unknown): Thumbnail {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ContentError("Send the thumbnail as an object.");
  const t = v as Record<string, unknown>;
  const layers = t.layers === undefined ? [] : t.layers;
  if (!Array.isArray(layers) || layers.length > 24) throw new ContentError("The thumbnail's layers are a list (24 at most).");
  const hash = (h: unknown) => (h && /^[0-9a-f]{64}$/.test(String(h)) ? String(h) : undefined);
  const num = (n: unknown, lo: number, hi: number) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n) * 100) / 100)) : undefined);
  const out: Thumbnail = {
    layers: layers.map((x, i): Layer => {
      const l = (x ?? {}) as Record<string, unknown>;
      const kind = String(l.kind);
      if (!(LAYER_KINDS as readonly string[]).includes(kind)) throw new ContentError(`A layer is one of: ${LAYER_KINDS.join(", ")}.`);
      if (l.hash && !hash(l.hash)) throw new ContentError("A layer's picture is a vault file, by its hash.");
      const o: Layer = { id: text(l.id, 40) || `l${i + 1}`, kind: kind as Layer["kind"], on: l.on !== false };
      if (l.name) o.name = text(l.name, 60);
      if (hash(l.hash)) o.hash = hash(l.hash);
      if (l.fit === "contain" || l.fit === "cover") o.fit = l.fit;
      if (l.text !== undefined) o.text = text(l.text, 300);
      if (l.color) o.color = text(l.color, 24);
      if (l.align === "left" || l.align === "center" || l.align === "right") o.align = l.align;
      for (const k of ["x", "y", "w", "size"] as const) {
        const n = num(l[k], -100, 300);
        if (n !== undefined) o[k] = n;
      }
      return o;
    }),
  };
  if (t.card !== undefined) {
    if (t.card !== null && t.card !== "" && !hash(t.card)) throw new ContentError("The card is a vault file, by its hash.");
    out.card = hash(t.card) ?? null;
  }
  return out;
}

function clean(b: Record<string, unknown>, partial: boolean) {
  const o: Partial<Item> = {};
  if (b.title !== undefined || !partial) {
    const t = String(b.title ?? "").trim().slice(0, 200);
    if (!t) throw new ContentError("Give it a title.");
    o.title = t;
  }
  if (b.kind !== undefined || !partial) {
    const k = String(b.kind ?? "post");
    if (!KINDS.includes(k)) throw new ContentError(`The kind is one of: ${KINDS.join(", ")}.`);
    o.kind = k;
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(String(b.status))) throw new ContentError(`The status is one of: ${STATUSES.join(", ")}.`);
    o.status = String(b.status);
  }
  if (b.channels !== undefined) o.channels = list(b.channels, CHANNELS);
  if (b.hashes !== undefined) {
    o.hashes = list(b.hashes);
    if (o.hashes.some((h) => !/^[0-9a-f]{64}$/.test(h))) throw new ContentError("Attach files by their hash.");
  }
  if (b.tags !== undefined) o.tags = list(b.tags);
  if (b.body !== undefined) o.body = String(b.body).slice(0, 200000);
  if (b.hook !== undefined) o.hook = b.hook ? text(b.hook, 300).trim() : null;
  if (b.idea !== undefined) o.idea = text(b.idea, 100000);
  if (b.description !== undefined) o.description = text(b.description, 5000);
  if (b.intro !== undefined) o.intro = text(b.intro, 5000);
  if (b.journey !== undefined) o.journey = journeyOf(b.journey);
  if (b.hooks !== undefined) o.hooks = hooksOf(b.hooks);
  if (b.thumbnail !== undefined) o.thumbnail = thumbnailOf(b.thumbnail);
  if (b.project !== undefined) o.project = b.project ? text(b.project, 40).trim() || null : null;
  if (b.story !== undefined) {
    if (b.story !== null && !/^[0-9a-f]{64}$/.test(String(b.story))) throw new ContentError("A story is filed by its vault id.");
    o.story = (b.story as string | null) ?? null;
  }
  if (b.link !== undefined) o.link = b.link ? String(b.link).slice(0, 500) : null;
  // the derivatives, sent back whole (the calendar moves one to another day): each still a known platform and format
  if (b.posts !== undefined) {
    if (!Array.isArray(b.posts) || b.posts.some((p) => !p || !CHANNELS.includes(p.platform) || (p.format && !FORMATS.includes(p.format)) || typeof p.text !== "string"))
      throw new ContentError("Send the derivatives as a list, each with its platform and text.");
    o.posts = b.posts as Post[];
  }
  if (b.scheduled_at !== undefined) {
    if (b.scheduled_at === null || b.scheduled_at === "") o.scheduled_at = null;
    else {
      const d = new Date(String(b.scheduled_at));
      if (Number.isNaN(d.getTime())) throw new ContentError("That is not a date.");
      o.scheduled_at = d.toISOString();
    }
  }
  return o;
}

const COLS = "id, title, kind, channels, status, scheduled_at, body, hashes, link, tags, deliveries, posts, timeline_id, project, source, hook, hooks, idea, intro, description, journey, thumbnail, story, created, updated";
// arrays travel as JSON text: Bun's client does not send a JS array as text[]
const arr = (i: number) => `ARRAY(SELECT jsonb_array_elements_text(($${i}::text)::jsonb))`;

/** Everything dated within [from, to), and every undated item (the backlog). */
export async function listContent(from?: string, to?: string): Promise<Item[]> {
  const { rows } = await db.query<Item>(
    `SELECT ${COLS} FROM content_items
      WHERE scheduled_at IS NULL OR (($1::timestamptz IS NULL OR scheduled_at >= $1) AND ($2::timestamptz IS NULL OR scheduled_at < $2))
      ORDER BY scheduled_at NULLS FIRST, created`,
    [from ?? null, to ?? null],
  );
  return rows;
}

/** A day ("Day 19") names one story only: a second one with the same day is refused, not merged. */
async function once<T>(q: Promise<T>): Promise<T> {
  try {
    return await q;
  } catch (e) {
    if (/ix_content_project|duplicate key/i.test(String((e as Error).message))) throw new ContentError("Another story already has that day.", 409);
    throw e;
  }
}

export async function createContent(founderId: string, body: Record<string, unknown>): Promise<Item> {
  const o = clean(body, false);
  const status = o.status ?? (o.scheduled_at ? "scheduled" : "idea");
  const { rows } = await once(db.query<Item>(
    `INSERT INTO content_items (title, kind, channels, status, scheduled_at, body, hashes, link, tags, founder_id, idea, description, hook, project, journey, hooks, intro, thumbnail)
     VALUES ($1, $2, ${arr(3)}, $4, $5, $6, ${arr(7)}, $8, ${arr(9)}, $10, $11, $12, $13, $14, ($15::text)::jsonb, ($16::text)::jsonb, $17, ($18::text)::jsonb) RETURNING ${COLS}`,
    [o.title, o.kind, JSON.stringify(o.channels ?? []), status, o.scheduled_at ?? null, o.body ?? "", JSON.stringify(o.hashes ?? []), o.link ?? null, JSON.stringify(o.tags ?? []), founderId,
     o.idea ?? "", o.description ?? "", o.hook ?? null, o.project ?? null, JSON.stringify(o.journey ?? {}), JSON.stringify(o.hooks ?? []), o.intro ?? "", JSON.stringify(o.thumbnail ?? {})],
  ));
  return rows[0]!;
}

export async function saveContent(id: string, body: Record<string, unknown>): Promise<Item> {
  const o = clean(body, true);
  const has = (k: keyof Item) => k in o;
  if (has("body")) {
    const { rows: had } = await db.query<Item>(`SELECT ${COLS} FROM content_items WHERE id = $1`, [id]);
    if (had[0] && LOCKED.includes(o.status ?? had[0].status) && articleOf(had[0].body) !== articleOf(o.body ?? ""))
      throw new ContentError("The base article is locked — its derivatives were written from it. Move the story back to Writing to change it.", 409);
  }
  const { rows } = await once(db.query<Item>(
    `UPDATE content_items SET
        title = coalesce($2, title), kind = coalesce($3, kind),
        channels = CASE WHEN $4::text IS NULL THEN channels ELSE ${arr(4)} END,
        status = coalesce($5, status),
        scheduled_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE scheduled_at END,
        body = coalesce($8, body),
        hashes = CASE WHEN $9::text IS NULL THEN hashes ELSE ${arr(9)} END,
        link = CASE WHEN $10::boolean THEN $11 ELSE link END,
        tags = CASE WHEN $12::text IS NULL THEN tags ELSE ${arr(12)} END,
        posts = CASE WHEN $13::text IS NULL THEN posts ELSE ($13::text)::jsonb END,
        hook = CASE WHEN $14::boolean THEN $15 ELSE hook END,
        idea = coalesce($16, idea), description = coalesce($17, description),
        journey = CASE WHEN $18::text IS NULL THEN journey ELSE ($18::text)::jsonb END,
        project = CASE WHEN $19::boolean THEN $20 ELSE project END,
        story = CASE WHEN $21::boolean THEN $22 ELSE story END,
        hooks = CASE WHEN $23::text IS NULL THEN hooks ELSE ($23::text)::jsonb END,
        intro = coalesce($24, intro),
        thumbnail = CASE WHEN $25::text IS NULL THEN thumbnail ELSE ($25::text)::jsonb END,
        updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, o.title ?? null, o.kind ?? null, has("channels") ? JSON.stringify(o.channels) : null, o.status ?? null,
     has("scheduled_at"), o.scheduled_at ?? null, o.body ?? null, has("hashes") ? JSON.stringify(o.hashes) : null,
     has("link"), o.link ?? null, has("tags") ? JSON.stringify(o.tags) : null, has("posts") ? JSON.stringify(o.posts) : null,
     has("hook"), o.hook ?? null, o.idea ?? null, o.description ?? null, has("journey") ? JSON.stringify(o.journey) : null,
     has("project"), o.project ?? null, has("story"), o.story ?? null, has("hooks") ? JSON.stringify(o.hooks) : null, o.intro ?? null,
     has("thumbnail") ? JSON.stringify(o.thumbnail) : null],
  ));
  if (!rows[0]) throw new ContentError("No such item.", 404);
  return rows[0];
}

/** The film's item: one per project ("Day 19"), made the first time any of its cuts delivers or gets its posts. */
async function filmItem(founderId: string | null, timelineId: string, title?: string): Promise<{ id: string; project: string; timeline: string }> {
  const { rows: t } = await db.query<{ name: string; project: string | null }>("SELECT name, project FROM timelines WHERE id = $1", [timelineId]);
  if (!t[0]) throw new ContentError("No such timeline.", 404);
  const project = t[0].project ?? `timeline ${timelineId}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO content_items (title, kind, status, project, timeline_id, founder_id) VALUES ($1, 'film', 'movie', $2, $3, $4)
     ON CONFLICT (project) WHERE project IS NOT NULL DO UPDATE SET title = CASE WHEN $5::boolean THEN excluded.title ELSE content_items.title END
     RETURNING id`,
    [title ?? `${t[0].project ?? "Film"} — ${t[0].name}`, project, timelineId, founderId, !!title],
  );
  return { id: rows[0]!.id, project, timeline: timelineId };
}

/**
 * A render is done: its files go onto the film's item, in place of whatever that same cut delivered before (the
 * other cuts' files stay). Its stage stays as it is: only moving the card on locks the base article — a render
 * never does (a day's article is audited while it is written).
 */
export async function deliverRender(founderId: string | null, timelineId: string, cut: string, deliveries: Delivery[]): Promise<Item> {
  const item = await filmItem(founderId, timelineId);
  const mine = deliveries.map((d) => ({ ...d, timeline: timelineId, cut }));
  const { rows } = await db.query<Item>(
    `UPDATE content_items SET
        deliveries = coalesce((SELECT jsonb_agg(d) FROM jsonb_array_elements(deliveries) d WHERE d->>'timeline' IS DISTINCT FROM $2), '[]'::jsonb) || ($3::text)::jsonb,
        hashes = ARRAY(SELECT DISTINCT unnest(hashes || ${arr(4)})),
        channels = ARRAY(SELECT DISTINCT unnest(channels || ${arr(5)})),
        updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [item.id, timelineId, JSON.stringify(mine), JSON.stringify([...new Set(mine.map((d) => d.hash))]),
     JSON.stringify([...new Set(mine.flatMap((d) => d.channels).filter((c) => CHANNELS.includes(c)))])],
  );
  return rows[0]!;
}

/**
 * A render's deliveries taken off a card again (a test render, a cut that was dropped): its films and their hashes go;
 * everything else on the card stays. The inverse of deliverRender for that timeline.
 */
export async function dropDeliveries(id: string, timelineId: string): Promise<Item> {
  const { rows } = await db.query<Item>(
    `UPDATE content_items SET
        hashes = ARRAY(SELECT h FROM unnest(hashes) h WHERE h NOT IN (
          SELECT d->>'hash' FROM jsonb_array_elements(deliveries) d WHERE d->>'timeline' = $2)),
        deliveries = coalesce((SELECT jsonb_agg(d) FROM jsonb_array_elements(deliveries) d WHERE d->>'timeline' IS DISTINCT FROM $2), '[]'::jsonb),
        timeline_id = CASE WHEN timeline_id::text = $2 THEN NULL ELSE timeline_id END,
        updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, timelineId],
  );
  if (!rows[0]) throw new ContentError("No such item.", 404);
  return rows[0];
}

/** A cut's posts, one per platform, onto the film's item, in place of that cut's posts before (the others stay). */
export async function savePosts(founderId: string | null, timelineId: string, posts: Post[], title?: string): Promise<Item> {
  if (!Array.isArray(posts) || posts.some((p) => !p || typeof p.platform !== "string" || typeof p.text !== "string"))
    throw new ContentError("Send the posts as a list, each with its platform and text.");
  if (posts.some((p) => !CHANNELS.includes(p.platform))) throw new ContentError(`We post to ${CHANNELS.join(", ")}.`);
  const item = await filmItem(founderId, timelineId, title);
  const mine = posts.map((p) => ({ ...p, timeline: timelineId }));
  const { rows } = await db.query<Item>(
    `UPDATE content_items SET
        posts = coalesce((SELECT jsonb_agg(p) FROM jsonb_array_elements(posts) p WHERE p->>'timeline' IS DISTINCT FROM $2), '[]'::jsonb) || ($3::text)::jsonb,
        channels = ARRAY(SELECT DISTINCT unnest(channels || ${arr(4)})),
        updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [item.id, timelineId, JSON.stringify(mine), JSON.stringify([...new Set(mine.map((p) => p.platform))])],
  );
  return rows[0]!;
}

/**
 * A day onto the board, from the folder its story is written in (bun api/scripts/day.ts): its brainstorm pad
 * (idea.md), its hook and description, its journey, the article — until the derivatives lock it; only moving the
 * story back to Writing opens it again — and, once the base is locked, its derivatives, each with its time: the whole
 * set at once. Sending derivatives locks the article (the story moves on to "derivatives"); a story that is only an
 * idea has no base to derive from. The item is the project's ("Day 19"), made if it is new. The films' files come
 * separately, from their renders.
 */
export async function saveDay(
  founderId: string | null, project: string,
  day: {
    title?: string; body?: string; source?: string; scheduled_at?: string; posts?: Post[]; deliveries?: Delivery[]; status?: string; hook?: string;
    idea?: string; description?: string; journey?: Journey;
  },
): Promise<Item> {
  // only its stage (the publish step moves a scheduled day on to "published")
  if (day.status !== undefined && [day.body, day.posts, day.idea, day.description, day.journey, day.hook].every((v) => v === undefined)) {
    if (!STATUSES.includes(day.status)) throw new ContentError(`The status is one of: ${STATUSES.join(", ")}.`);
    const { rows } = await db.query<Item>(`UPDATE content_items SET status = $2, updated = now() WHERE project = $1 RETURNING ${COLS}`, [project, day.status]);
    if (!rows[0]) throw new ContentError("No such day.", 404);
    return rows[0];
  }
  const { rows: had } = await db.query<Item>(`SELECT ${COLS} FROM content_items WHERE project = $1`, [project]);
  const now = had[0];
  const posts = day.posts;
  if (posts !== undefined) {
    if (!Array.isArray(posts)) throw new ContentError("Send the derivatives as a list.");
    const bad = posts.find((p) => !p || !CHANNELS.includes(p.platform) || (p.format && !FORMATS.includes(p.format)) || typeof p.text !== "string");
    if (bad) throw new ContentError(`Each derivative goes to one of ${CHANNELS.join(", ")}, as one of ${FORMATS.join(", ")}.`);
  }
  if (day.body !== undefined) {
    if (typeof day.body !== "string" || !day.title?.trim()) throw new ContentError("A base article needs its title and its text.");
    if (now && LOCKED.includes(now.status) && articleOf(now.body) !== articleOf(day.body))
      throw new ContentError("The base article is locked — its derivatives were written from it. Move the story back to Writing to change it.", 409);
  }
  const base = day.body ?? now?.body ?? "";
  if (posts?.length && !base.trim()) throw new ContentError("There is no base article to derive from yet.");
  const when = day.scheduled_at ? new Date(day.scheduled_at) : null;
  if (when && Number.isNaN(when.getTime())) throw new ContentError("That is not a date.");
  const journey = day.journey !== undefined ? journeyOf(day.journey) : undefined;
  // the stage it has reached: its journey first, then the hook (the title, its cards), then the article written from
  // them, then its posts — never back
  const order = (s: string | undefined) => STATUSES.indexOf(s ?? "idea");
  const status = (s: string | undefined) => {
    const reached = posts?.length ? "derivatives" : day.body !== undefined ? "writing" : day.hook !== undefined ? "hook"
      : journey?.beats?.length ? "journey" : "idea";
    return order(s) >= order(reached) ? s! : reached;
  };
  const { rows } = await db.query<Item>(
    `INSERT INTO content_items (title, kind, status, project, body, source, posts, channels, scheduled_at, founder_id, deliveries, hook, idea, description, journey)
     VALUES ($1, 'post', $2, $3, $4, $5, ($6::text)::jsonb, ${arr(7)}, $8, $9, ($12::text)::jsonb, $13, coalesce($14, ''), coalesce($15, ''), coalesce(($16::text)::jsonb, '{}'::jsonb))
     ON CONFLICT (project) WHERE project IS NOT NULL DO UPDATE SET
        idea = coalesce($14, content_items.idea), description = coalesce($15, content_items.description),
        journey = coalesce(($16::text)::jsonb, content_items.journey),
        title = excluded.title, body = excluded.body, source = coalesce(excluded.source, content_items.source),
        posts = CASE WHEN $10::boolean THEN excluded.posts ELSE content_items.posts END,
        -- the day's own files (a film already in the post, its copies): in place of the day's before, renders kept
        deliveries = CASE WHEN $11::boolean THEN coalesce((SELECT jsonb_agg(d) FROM jsonb_array_elements(content_items.deliveries) d WHERE d->>'timeline' IS DISTINCT FROM 'day'), '[]'::jsonb) || excluded.deliveries ELSE content_items.deliveries END,
        channels = ARRAY(SELECT DISTINCT unnest(content_items.channels || excluded.channels)),
        scheduled_at = coalesce(content_items.scheduled_at, excluded.scheduled_at),
        hook = coalesce(excluded.hook, content_items.hook),
        status = excluded.status, updated = now()
     RETURNING ${COLS}`,
    [(day.title ?? now?.title ?? project).trim().slice(0, 200), status(now?.status), project, base.slice(0, 200000), day.source ?? null,
     JSON.stringify(posts ?? now?.posts ?? []), JSON.stringify([...new Set((posts ?? []).map((p) => p.platform))]),
     when?.toISOString() ?? null, founderId, posts !== undefined, day.deliveries !== undefined,
     JSON.stringify((day.deliveries ?? []).map((d) => ({ ...d, timeline: "day", cut: d.cut ?? "the day's film" }))), day.hook ?? null,
     day.idea !== undefined ? text(day.idea, 100000) : null, day.description !== undefined ? text(day.description, 5000) : null,
     journey ? JSON.stringify(journey) : null],
  );
  return rows[0]!;
}

/**
 * The stories the Mac app is to file in the media vault: past the idea and not filed yet. It makes each one's vault
 * story (an iroh-docs bucket) and says so with fileStory.
 */
export async function unfiledStories(): Promise<Pick<Item, "id" | "title" | "hook" | "description" | "project" | "status">[]> {
  const { rows } = await db.query<Item>(
    `SELECT id, title, hook, description, project, status FROM content_items WHERE story IS NULL AND status <> 'idea' ORDER BY created`,
  );
  return rows;
}

/** A story is filed in the vault: its bucket's id (an iroh namespace id). */
export async function fileStory(id: string, story: string): Promise<Item> {
  if (!/^[0-9a-f]{64}$/.test(story)) throw new ContentError("A story is filed by its vault id.");
  const { rows } = await db.query<Item>(`UPDATE content_items SET story = $2, updated = now() WHERE id = $1 RETURNING ${COLS}`, [id, story]);
  if (!rows[0]) throw new ContentError("No such item.", 404);
  return rows[0];
}

export async function deleteContent(id: string): Promise<void> {
  const r = await db.query("DELETE FROM content_items WHERE id = $1", [id]);
  if (!r.affectedRows) throw new ContentError("No such item.", 404);
}
