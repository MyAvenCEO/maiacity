/**
 * The publishing calendar. An item is one thing we put out — a film, a reel, a post, a thread, an article — with
 * the channels it goes to, where it stands (idea → draft → ready → scheduled → published), when it goes live, its
 * text or script, and the library files it carries by CID. An item without a date is in the backlog.
 */
import { db } from "./pg";

export class ContentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const KINDS = ["film", "reel", "post", "thread", "article", "newsletter", "story", "podcast"];
export const CHANNELS = ["youtube", "instagram", "tiktok", "x", "linkedin", "journal", "newsletter"];
export const STATUSES = ["idea", "draft", "ready", "scheduled", "published"];

export type Item = {
  id: string; title: string; kind: string; channels: string[]; status: string; scheduled_at: string | null;
  body: string; cids: string[]; link: string | null; tags: string[]; created: string; updated: string;
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
  if (b.cids !== undefined) {
    o.cids = list(b.cids);
    if (o.cids.some((c) => !/^baf[a-z2-7]{20,}$/.test(c))) throw new ContentError("Attach library files by their CID.");
  }
  if (b.tags !== undefined) o.tags = list(b.tags);
  if (b.body !== undefined) o.body = String(b.body).slice(0, 40000);
  if (b.link !== undefined) o.link = b.link ? String(b.link).slice(0, 500) : null;
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

const COLS = "id, title, kind, channels, status, scheduled_at, body, cids, link, tags, created, updated";
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
    `INSERT INTO content_items (title, kind, channels, status, scheduled_at, body, cids, link, tags, founder_id)
     VALUES ($1, $2, ${arr(3)}, $4, $5, $6, ${arr(7)}, $8, ${arr(9)}, $10) RETURNING ${COLS}`,
    [o.title, o.kind, JSON.stringify(o.channels ?? []), status, o.scheduled_at ?? null, o.body ?? "", JSON.stringify(o.cids ?? []), o.link ?? null, JSON.stringify(o.tags ?? []), founderId],
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
        cids = CASE WHEN $9::text IS NULL THEN cids ELSE ${arr(9)} END,
        link = CASE WHEN $10::boolean THEN $11 ELSE link END,
        tags = CASE WHEN $12::text IS NULL THEN tags ELSE ${arr(12)} END,
        updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, o.title ?? null, o.kind ?? null, has("channels") ? JSON.stringify(o.channels) : null, o.status ?? null,
     has("scheduled_at"), o.scheduled_at ?? null, o.body ?? null, has("cids") ? JSON.stringify(o.cids) : null,
     has("link"), o.link ?? null, has("tags") ? JSON.stringify(o.tags) : null],
  );
  if (!rows[0]) throw new ContentError("No such item.", 404);
  return rows[0];
}

export async function deleteContent(id: string): Promise<void> {
  const r = await db.query("DELETE FROM content_items WHERE id = $1", [id]);
  if (!r.affectedRows) throw new ContentError("No such item.", 404);
}
