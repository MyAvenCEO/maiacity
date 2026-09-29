/**
 * The content board. An item is one snippet we put out — from the first idea in the swipe file to what went live —
 * moving idea → draft → derivatives → scheduled → published: a draft is the base article alone; moving it on to
 * "derivatives" locks it, and everything that goes out is derived from it then. A film is one item, whatever its cuts: every render of the
 * project's timelines files its deliveries on it (the 4K master, the 1080 copy, the 9:16 Reel, the 1:1 feed video,
 * their thumbnails), and its posts, one per platform, are written for them — prepared, never typed in a form.
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
export const STATUSES = ["idea", "hook", "draft", "derivatives", "scheduled", "published"];
/** past the draft, the base article is locked: the derivatives were written from it */
const LOCKED = ["derivatives", "scheduled", "published"];

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
  created: string; updated: string;
};

const list = (v: unknown, allowed?: string[]) => {
  const out = (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean);
  if (allowed && out.some((x) => !allowed.includes(x))) throw new ContentError(`One of: ${allowed.join(", ")}.`);
  return [...new Set(out)];
};

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
  if (b.body !== undefined) o.body = String(b.body).slice(0, 40000);
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

const COLS = "id, title, kind, channels, status, scheduled_at, body, hashes, link, tags, deliveries, posts, timeline_id, project, source, hook, created, updated";
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

export async function createContent(founderId: string, body: Record<string, unknown>): Promise<Item> {
  const o = clean(body, false);
  const status = o.status ?? (o.scheduled_at ? "scheduled" : "idea");
  const { rows } = await db.query<Item>(
    `INSERT INTO content_items (title, kind, channels, status, scheduled_at, body, hashes, link, tags, founder_id)
     VALUES ($1, $2, ${arr(3)}, $4, $5, $6, ${arr(7)}, $8, ${arr(9)}, $10) RETURNING ${COLS}`,
    [o.title, o.kind, JSON.stringify(o.channels ?? []), status, o.scheduled_at ?? null, o.body ?? "", JSON.stringify(o.hashes ?? []), o.link ?? null, JSON.stringify(o.tags ?? []), founderId],
  );
  return rows[0]!;
}

export async function saveContent(id: string, body: Record<string, unknown>): Promise<Item> {
  const o = clean(body, true);
  const has = (k: keyof Item) => k in o;
  const { rows } = await db.query<Item>(
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
        updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, o.title ?? null, o.kind ?? null, has("channels") ? JSON.stringify(o.channels) : null, o.status ?? null,
     has("scheduled_at"), o.scheduled_at ?? null, o.body ?? null, has("hashes") ? JSON.stringify(o.hashes) : null,
     has("link"), o.link ?? null, has("tags") ? JSON.stringify(o.tags) : null, has("posts") ? JSON.stringify(o.posts) : null],
  );
  if (!rows[0]) throw new ContentError("No such item.", 404);
  return rows[0];
}

/** The film's item: one per project ("Day 19"), made the first time any of its cuts delivers or gets its posts. */
async function filmItem(founderId: string | null, timelineId: string, title?: string): Promise<{ id: string; project: string; timeline: string }> {
  const { rows: t } = await db.query<{ name: string; project: string | null }>("SELECT name, project FROM timelines WHERE id = $1", [timelineId]);
  if (!t[0]) throw new ContentError("No such timeline.", 404);
  const project = t[0].project ?? `timeline ${timelineId}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO content_items (title, kind, status, project, timeline_id, founder_id) VALUES ($1, 'film', 'draft', $2, $3, $4)
     ON CONFLICT (project) WHERE project IS NOT NULL DO UPDATE SET title = CASE WHEN $5::boolean THEN excluded.title ELSE content_items.title END
     RETURNING id`,
    [title ?? `${t[0].project ?? "Film"} — ${t[0].name}`, project, timelineId, founderId, !!title],
  );
  return { id: rows[0]!.id, project, timeline: timelineId };
}

/**
 * A render is done: its files go onto the film's item, in place of whatever that same cut delivered before (the
 * other cuts' files stay). Its stage stays as it is: only moving the card on locks the base article — a render
 * never does (a day is audited as a draft first).
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
 * A day onto the board, from where its base article is written (bun api/scripts/day.ts): the article — while the
 * card is an idea or a draft; past that it is locked and only moving the card back to Draft opens it again — and,
 * once the base is locked, its derivatives, each with its time: the whole set at once. Sending derivatives for a
 * draft locks it (the card moves on to "derivatives"); a card that is only an idea has no base to derive from.
 * The item is the project's ("Day 19"), made if it is new. The films' files come separately, from their renders.
 */
export async function saveDay(
  founderId: string | null, project: string,
  day: { title?: string; body?: string; source?: string; scheduled_at?: string; posts?: Post[]; deliveries?: Delivery[]; status?: string; hook?: string },
): Promise<Item> {
  // only its stage (the publish step moves a scheduled day on to "published")
  if (day.status !== undefined && day.body === undefined && day.posts === undefined) {
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
    // (whether the post is out yet — its `draft:` line — is not the article: publishing flips it; nor are the
    // pictures and film it is shown with — its cover, banner, poster, the files its images point at)
    const text = (b: string) =>
      b.replace(/^(draft|cover|coverPosition|coverAlt|banner|poster|videoLocal|authorImage):.*\n/gm, "").replace(/(!\[[^\]]*\])\([^)]*\)/g, "$1()");
    if (now && LOCKED.includes(now.status) && text(now.body) !== text(day.body))
      throw new ContentError("The base article is locked — its derivatives were written from it. Move the card back to Draft to change it.", 409);
  }
  const base = day.body ?? now?.body ?? "";
  if (posts?.length && !base.trim()) throw new ContentError("There is no base article to derive from yet.");
  const when = day.scheduled_at ? new Date(day.scheduled_at) : null;
  if (when && Number.isNaN(when.getTime())) throw new ContentError("That is not a date.");
  // the stage it has reached: the hook (the title, its cards) first, then the article written from it, then its posts
  const order = (s: string | undefined) => STATUSES.indexOf(s ?? "idea");
  const status = (s: string | undefined) => {
    const reached = posts?.length ? "derivatives" : day.body !== undefined ? "draft" : day.hook !== undefined ? "hook" : "idea";
    return order(s) >= order(reached) ? s! : reached;
  };
  const { rows } = await db.query<Item>(
    `INSERT INTO content_items (title, kind, status, project, body, source, posts, channels, scheduled_at, founder_id, deliveries, hook)
     VALUES ($1, 'post', $2, $3, $4, $5, ($6::text)::jsonb, ${arr(7)}, $8, $9, ($12::text)::jsonb, $13)
     ON CONFLICT (project) WHERE project IS NOT NULL DO UPDATE SET
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
     JSON.stringify((day.deliveries ?? []).map((d) => ({ ...d, timeline: "day", cut: d.cut ?? "the day's film" }))), day.hook ?? null],
  );
  return rows[0]!;
}

export async function deleteContent(id: string): Promise<void> {
  const r = await db.query("DELETE FROM content_items WHERE id = $1", [id]);
  if (!r.affectedRows) throw new ContentError("No such item.", 404);
}
