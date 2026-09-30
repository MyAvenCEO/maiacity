/**
 * Render jobs. Playing a timeline is live, in the studio; exporting it is a job: the studio queues it, a render
 * worker (bun film worker) claims it, reports its progress, and hands back the film's hash when it is in the vault.
 *
 * The same queue carries the worker's other work: `frame` — a hero frame: one frame of a timeline (`params`: t, shape)
 * rendered at full precision through the whole chain, for grading against. Proxies and the viewer's LUTs are no jobs
 * here: the Mac app makes a file's proxy when it comes in (meta.proxy on the original), a world shot version's when a
 * timeline plays it (vault/app/src/world.rs, in its own world), and bakes every LUT the viewer uses (`color_lut`).
 * `proxy` rows — of files (media_hash) or of shot versions (shot_id + shot_version) — and `lut` rows (the preview LUTs
 * the worker once baked) are history, nothing more; one still waiting is closed by the worker when it claims it.
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
  id: string; kind: JobKind; timeline_id: string | null; media_hash: string | null; shot_id: string | null; shot_version: number | null;
  params: Record<string, unknown> | null; status: string; progress: number; note: string | null;
  output_hash: string | null; report: Record<string, unknown> | null; created: string; updated: string;
};
const COLS = "id, kind, timeline_id, media_hash, shot_id, shot_version, params, status, progress, note, output_hash, report, created, updated";
const HASH = /^[0-9a-f]{64}$/;
const SHAPES = ["16:9", "9:16", "1:1", "4:5"];

export async function queueRender(founderId: string, timelineId: string): Promise<Job> {
  const { rows: t } = await db.query("SELECT 1 FROM timelines WHERE id = $1", [timelineId]);
  if (!t.length) throw new RenderError("No such timeline.", 404);
  const { rows: open } = await db.query<Job>(`SELECT ${COLS} FROM render_jobs WHERE timeline_id = $1 AND kind = 'render' AND status IN ('queued', 'rendering')`, [timelineId]);
  if (open[0]) return open[0]; // one at a time per timeline
  return (await db.query<Job>(`INSERT INTO render_jobs (timeline_id, founder_id) VALUES ($1, $2) RETURNING ${COLS}`, [timelineId, founderId])).rows[0]!;
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

export async function rendersOf(timelineId: string): Promise<Job[]> {
  return (await db.query<Job>(`SELECT ${COLS} FROM render_jobs WHERE timeline_id = $1 ORDER BY created DESC LIMIT 10`, [timelineId])).rows;
}

/** The latest jobs, newest first: of a kind, for a timeline or a shot — the studio's render queue. */
export async function listJobs(filter: { kind?: string; timeline?: string; shot?: string; limit?: number } = {}): Promise<Job[]> {
  const kind = filter.kind && ["render", "proxy", "lut", "frame"].includes(filter.kind) ? filter.kind : null;
  const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const { rows } = await db.query<Job>(
    `SELECT ${COLS} FROM render_jobs WHERE ($1::text IS NULL OR kind = $1)
        AND ($2::uuid IS NULL OR timeline_id = $2) AND ($3::uuid IS NULL OR shot_id = $3)
      ORDER BY created DESC LIMIT $4`,
    [kind, uuid(filter.timeline), uuid(filter.shot), Math.max(1, Math.min(500, filter.limit ?? 100))],
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

export async function reportRender(id: string, body: { status?: unknown; progress?: unknown; note?: unknown; output_hash?: unknown; deliveries?: unknown; report?: unknown }): Promise<Job> {
  const status = body.status === undefined ? null : String(body.status);
  if (status && !["rendering", "done", "failed"].includes(status)) throw new RenderError("A worker reports rendering, done or failed.");
  const report = body.report && typeof body.report === "object" && !Array.isArray(body.report) ? JSON.stringify(body.report) : null;
  const output = body.output_hash ? String(body.output_hash) : null;
  if (output && !HASH.test(output)) throw new RenderError("A job's output is named by its hash (64 hex).");
  const { rows } = await db.query<Job>(
    `UPDATE render_jobs SET status = coalesce($2, status), progress = coalesce($3, progress), note = coalesce($4, note),
            output_hash = coalesce($5, output_hash), report = coalesce(($6::text)::jsonb, report), updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, status, body.progress === undefined ? null : Math.max(0, Math.min(1, Number(body.progress))), body.note === undefined ? null : String(body.note).slice(0, 300), output, report],
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
