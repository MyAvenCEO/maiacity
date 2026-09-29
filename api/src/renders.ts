/**
 * Render jobs. Playing a timeline is live, in the studio; exporting it is a job: the studio queues it, a render
 * worker (bun film worker) claims it, reports its progress, and hands back the film's CID when it is in the library.
 *
 * The same queue carries the worker's other work (migration 0024): `proxy` — read a new file's colour and make its
 * HD log proxy (queued for every new video, image and EXR sequence, and again when its colour is set by hand); and
 * `lut` — bake the studio viewer's preview LUTs into the library. Migration 0027 adds a proxy for a world shot version
 * (`shot_id` + `shot_version`, no file) and `frame` — a hero frame: one frame of a timeline (`params`: t, shape) rendered
 * at full precision through the whole chain, for grading against.
 */
import { db } from "./pg";
import { deliverRender, type Delivery } from "./content";

export class RenderError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type JobKind = "render" | "proxy" | "lut" | "frame";
export type Job = {
  id: string; kind: JobKind; timeline_id: string | null; media_cid: string | null; shot_id: string | null; shot_version: number | null;
  params: Record<string, unknown> | null; status: string; progress: number; note: string | null;
  output_cid: string | null; report: Record<string, unknown> | null; created: string; updated: string;
};
const COLS = "id, kind, timeline_id, media_cid, shot_id, shot_version, params, status, progress, note, output_cid, report, created, updated";
const SHAPES = ["16:9", "9:16", "1:1", "4:5"];

export async function queueRender(founderId: string, timelineId: string): Promise<Job> {
  const { rows: t } = await db.query("SELECT 1 FROM timelines WHERE id = $1", [timelineId]);
  if (!t.length) throw new RenderError("No such timeline.", 404);
  const { rows: open } = await db.query<Job>(`SELECT ${COLS} FROM render_jobs WHERE timeline_id = $1 AND kind = 'render' AND status IN ('queued', 'rendering')`, [timelineId]);
  if (open[0]) return open[0]; // one at a time per timeline
  return (await db.query<Job>(`INSERT INTO render_jobs (timeline_id, founder_id) VALUES ($1, $2) RETURNING ${COLS}`, [timelineId, founderId])).rows[0]!;
}

/**
 * A file's proxy (and colour detection) to be made. One waiting job per file is enough: a job already queued is
 * returned; one being made while the file's colour changed gets a new one after it.
 */
export async function queueProxy(cid: string, founderId: string | null = null): Promise<Job> {
  const { rows: open } = await db.query<Job>(`SELECT ${COLS} FROM render_jobs WHERE kind = 'proxy' AND media_cid = $1 AND status = 'queued'`, [cid]);
  if (open[0]) return open[0];
  return (await db.query<Job>(`INSERT INTO render_jobs (kind, media_cid, founder_id) VALUES ('proxy', $1, $2) RETURNING ${COLS}`, [cid, founderId])).rows[0]!;
}

/** A world shot version's HD proxy to be made (one waiting or finished job per version is enough). */
export async function queueShotProxy(shotId: string, version: number, founderId: string | null = null): Promise<Job> {
  const { rows: open } = await db.query<Job>(
    `SELECT ${COLS} FROM render_jobs WHERE kind = 'proxy' AND shot_id = $1 AND shot_version = $2 AND status IN ('queued', 'rendering', 'done')
      ORDER BY created DESC LIMIT 1`, [shotId, version]);
  if (open[0]) return open[0];
  return (await db.query<Job>(`INSERT INTO render_jobs (kind, shot_id, shot_version, founder_id) VALUES ('proxy', $1, $2, $3) RETURNING ${COLS}`, [shotId, version, founderId])).rows[0]!;
}

/** A hero frame: one frame of a timeline at time `t` in one delivery shape, rendered at full precision. */
export async function queueFrame(founderId: string, timelineId: string, body: { t?: unknown; shape?: unknown }): Promise<Job> {
  const t = Number(body.t), shape = String(body.shape ?? "16:9");
  if (!Number.isFinite(t) || t < 0) throw new RenderError("A hero frame is at a time on the timeline (seconds, from 0).");
  if (!SHAPES.includes(shape)) throw new RenderError(`A hero frame is in one of the shapes ${SHAPES.join(", ")}.`);
  const { rows: tl } = await db.query("SELECT 1 FROM timelines WHERE id = $1", [timelineId]);
  if (!tl.length) throw new RenderError("No such timeline.", 404);
  return (await db.query<Job>(`INSERT INTO render_jobs (kind, timeline_id, params, founder_id) VALUES ('frame', $1, ($2::text)::jsonb, $3) RETURNING ${COLS}`,
    [timelineId, JSON.stringify({ t: Math.round(t * 1000) / 1000, shape }), founderId])).rows[0]!;
}

/** The preview LUTs to be baked (again): one waiting job is enough. */
export async function queueLuts(founderId: string | null = null): Promise<Job> {
  const { rows: open } = await db.query<Job>(`SELECT ${COLS} FROM render_jobs WHERE kind = 'lut' AND status = 'queued'`);
  if (open[0]) return open[0];
  return (await db.query<Job>(`INSERT INTO render_jobs (kind, founder_id) VALUES ('lut', $1) RETURNING ${COLS}`, [founderId])).rows[0]!;
}

/** Has this file ever had a proxy job (in any state)? */
export async function hasProxyJob(cid: string): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM render_jobs WHERE kind = 'proxy' AND media_cid = $1 LIMIT 1", [cid]);
  return rows.length > 0;
}

export async function rendersOf(timelineId: string): Promise<Job[]> {
  return (await db.query<Job>(`SELECT ${COLS} FROM render_jobs WHERE timeline_id = $1 ORDER BY created DESC LIMIT 10`, [timelineId])).rows;
}

/** The latest jobs, newest first: of a kind, for a file — the studio's proxy status and render queue. */
export async function listJobs(filter: { kind?: string; cid?: string; timeline?: string; shot?: string; limit?: number } = {}): Promise<Job[]> {
  const kind = filter.kind && ["render", "proxy", "lut", "frame"].includes(filter.kind) ? filter.kind : null;
  const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const { rows } = await db.query<Job>(
    `SELECT ${COLS} FROM render_jobs WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR media_cid = $2)
        AND ($3::uuid IS NULL OR timeline_id = $3) AND ($4::uuid IS NULL OR shot_id = $4)
      ORDER BY created DESC LIMIT $5`,
    [kind, filter.cid || null, uuid(filter.timeline), uuid(filter.shot), Math.max(1, Math.min(500, filter.limit ?? 100))],
  );
  return rows;
}

/** The worker takes the oldest queued job — only one worker gets each. */
export async function claimRender(): Promise<Job | null> {
  const { rows } = await db.query<Job>(
    `UPDATE render_jobs SET status = 'rendering', updated = now(), note = 'starting'
      WHERE id = (SELECT id FROM render_jobs WHERE status = 'queued' ORDER BY created LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING ${COLS}`,
  );
  return rows[0] ?? null;
}

export async function reportRender(id: string, body: { status?: unknown; progress?: unknown; note?: unknown; output_cid?: unknown; deliveries?: unknown; report?: unknown }): Promise<Job> {
  const status = body.status === undefined ? null : String(body.status);
  if (status && !["rendering", "done", "failed"].includes(status)) throw new RenderError("A worker reports rendering, done or failed.");
  const report = body.report && typeof body.report === "object" && !Array.isArray(body.report) ? JSON.stringify(body.report) : null;
  const { rows } = await db.query<Job>(
    `UPDATE render_jobs SET status = coalesce($2, status), progress = coalesce($3, progress), note = coalesce($4, note),
            output_cid = coalesce($5, output_cid), report = coalesce(($6::text)::jsonb, report), updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, status, body.progress === undefined ? null : Math.max(0, Math.min(1, Number(body.progress))), body.note === undefined ? null : String(body.note).slice(0, 300), body.output_cid ? String(body.output_cid) : null, report],
  );
  if (!rows[0]) throw new RenderError("No such job.", 404);
  // done, with its files: onto the calendar, ready for the upload step
  if (status === "done" && rows[0].kind === "render" && Array.isArray(body.deliveries) && body.deliveries.length) {
    const { rows: t } = await db.query<{ name: string; founder_id: string | null }>(
      "SELECT t.name, j.founder_id FROM timelines t JOIN render_jobs j ON j.timeline_id = t.id WHERE j.id = $1", [id]);
    const tl = t[0];
    if (tl) await deliverRender(tl.founder_id, rows[0].timeline_id!, tl.name, body.deliveries as Delivery[]);
  }
  // a finished render of a locked or graded cut: the timeline has reached its last working step
  if (status === "done" && rows[0].kind === "render" && rows[0].timeline_id)
    await db.query("UPDATE timelines SET stage = 'rendered' WHERE id = $1 AND stage IN ('locked', 'graded')", [rows[0].timeline_id]);
  return rows[0];
}

/** The studio's preview LUTs: the newest library file of each transform (tag role:lut), by transform name. */
export async function previewLuts(): Promise<Record<string, { cid: string; hash: string; size: number }>> {
  const { rows } = await db.query<{ cid: string; meta: Record<string, unknown> }>(
    `SELECT m.cid, m.meta FROM media m WHERE EXISTS (SELECT 1 FROM media_tags t WHERE t.cid = m.cid AND t.tag = 'role:lut')
      ORDER BY m.created DESC, m.cid`,
  );
  const out: Record<string, { cid: string; hash: string; size: number }> = {};
  for (const r of rows) {
    const name = typeof r.meta?.transform === "string" ? r.meta.transform : null;
    if (name && !out[name]) out[name] = { cid: r.cid, hash: String(r.meta.hash ?? ""), size: Number(r.meta.size ?? 0) };
  }
  return out;
}
