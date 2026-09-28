/**
 * The studio's timelines. A timeline is an edit over the media library: a list of clips, each naming a CID and
 * where it sits on a track, how far into the file it starts, how long it runs and how loud it plays. The bytes
 * stay in the library; a timeline only points at them, so it is small, and the same file can be in many.
 */
import { db } from "./pg";

export class TimelineError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Clip = { id: string; cid: string; track: string; start: number; in: number; dur: number; vol: number; fin?: number; fout?: number };
export type Timeline = { id: string; name: string; project: string | null; variant: string | null; description: string | null; aspect: string; tags: string[]; clips: Clip[]; created: string; updated: string };

const ASPECTS = ["1:1", "16:9", "9:16", "4:5"];
const num = (v: unknown, min = 0) => Math.max(min, Number.isFinite(Number(v)) ? Number(v) : min);

function clean(body: { name?: unknown; project?: unknown; variant?: unknown; description?: unknown; aspect?: unknown; tags?: unknown; clips?: unknown }) {
  const out: { name?: string; project?: string | null; variant?: string | null; description?: string | null; aspect?: string; tags?: string[]; clips?: Clip[] } = {};
  if (body.description !== undefined) out.description = String(body.description ?? "").trim().slice(0, 240) || null;
  if (body.project !== undefined) out.project = String(body.project ?? "").trim().slice(0, 80) || null;
  if (body.variant !== undefined) out.variant = String(body.variant ?? "").trim().slice(0, 12) || null;
  if (body.name !== undefined) {
    const n = String(body.name).trim().slice(0, 120);
    if (!n) throw new TimelineError("Give the timeline a name.");
    out.name = n;
  }
  if (body.aspect !== undefined) {
    if (!ASPECTS.includes(String(body.aspect))) throw new TimelineError(`The frame is one of ${ASPECTS.join(", ")}.`);
    out.aspect = String(body.aspect);
  }
  if (body.tags !== undefined) out.tags = (Array.isArray(body.tags) ? body.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  if (body.clips !== undefined) {
    if (!Array.isArray(body.clips) || body.clips.length > 500) throw new TimelineError("Send the clips as a list.");
    out.clips = body.clips.map((c: any) => {
      if (!/^baf[a-z2-7]{20,}$/.test(String(c?.cid))) throw new TimelineError("Every clip names a CID.");
      return { id: String(c.id ?? "").slice(0, 40), cid: String(c.cid), track: String(c.track ?? "V1").slice(0, 8), start: num(c.start), in: num(c.in), dur: num(c.dur, 0.05), vol: Math.min(1, num(c.vol)),
        ...(c.fin !== undefined ? { fin: Math.min(10, num(c.fin)) } : {}), ...(c.fout !== undefined ? { fout: Math.min(10, num(c.fout)) } : {}) };
    });
  }
  return out;
}

const COLS = "id, name, project, variant, description, aspect, tags, clips, created, updated";

export async function listTimelines(): Promise<Timeline[]> {
  // grouped by project, variants in order; timelines without a project after, newest first
  return (await db.query<Timeline>(`SELECT ${COLS} FROM timelines ORDER BY project NULLS LAST, variant NULLS LAST, updated DESC`)).rows;
}

export async function createTimeline(founderId: string, body: Record<string, unknown>): Promise<Timeline> {
  const t = clean({ name: "Untitled", ...body });
  const { rows } = await db.query<Timeline>(
    // arrays go in as JSON text: Bun's client does not send a JS array as text[]
    `INSERT INTO timelines (name, aspect, tags, clips, founder_id, project, variant, description)
     VALUES ($1, $2, ARRAY(SELECT jsonb_array_elements_text(($3::text)::jsonb)), ($4::text)::jsonb, $5, $6, $7, $8) RETURNING ${COLS}`,
    [t.name, t.aspect ?? "16:9", JSON.stringify(t.tags ?? []), JSON.stringify(t.clips ?? []), founderId, t.project ?? null, t.variant ?? null, t.description ?? null],
  );
  return rows[0]!;
}

export async function saveTimeline(id: string, body: Record<string, unknown>): Promise<Timeline> {
  const t = clean(body);
  const { rows } = await db.query<Timeline>(
    `UPDATE timelines SET name = coalesce($2, name), aspect = coalesce($3, aspect),
            tags = CASE WHEN $4::text IS NULL THEN tags ELSE ARRAY(SELECT jsonb_array_elements_text(($4::text)::jsonb)) END,
            clips = coalesce(($5::text)::jsonb, clips),
            project = CASE WHEN $6::boolean THEN $7 ELSE project END,
            variant = CASE WHEN $8::boolean THEN $9 ELSE variant END,
            description = CASE WHEN $10::boolean THEN $11 ELSE description END,
            updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, t.name ?? null, t.aspect ?? null, t.tags ? JSON.stringify(t.tags) : null, t.clips ? JSON.stringify(t.clips) : null,
     "project" in t, t.project ?? null, "variant" in t, t.variant ?? null, "description" in t, t.description ?? null],
  );
  if (!rows[0]) throw new TimelineError("No such timeline.", 404);
  return rows[0];
}

export async function deleteTimeline(id: string): Promise<void> {
  const r = await db.query("DELETE FROM timelines WHERE id = $1", [id]);
  if (!r.affectedRows) throw new TimelineError("No such timeline.", 404);
}
