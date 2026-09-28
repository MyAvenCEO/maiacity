/**
 * Render jobs. Playing a timeline is live, in the studio; exporting it is a job: the studio queues it, a render
 * worker (bun film worker) claims it, reports its progress, and hands back the film's CID when it is in the library.
 */
import { db } from "./pg";
import { deliverRender, type Delivery } from "./content";

export class RenderError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Job = { id: string; timeline_id: string; status: string; progress: number; note: string | null; output_cid: string | null; created: string; updated: string };
const COLS = "id, timeline_id, status, progress, note, output_cid, created, updated";

export async function queueRender(founderId: string, timelineId: string): Promise<Job> {
  const { rows: t } = await db.query("SELECT 1 FROM timelines WHERE id = $1", [timelineId]);
  if (!t.length) throw new RenderError("No such timeline.", 404);
  const { rows: open } = await db.query<Job>(`SELECT ${COLS} FROM render_jobs WHERE timeline_id = $1 AND status IN ('queued', 'rendering')`, [timelineId]);
  if (open[0]) return open[0]; // one at a time per timeline
  return (await db.query<Job>(`INSERT INTO render_jobs (timeline_id, founder_id) VALUES ($1, $2) RETURNING ${COLS}`, [timelineId, founderId])).rows[0]!;
}

export async function rendersOf(timelineId: string): Promise<Job[]> {
  return (await db.query<Job>(`SELECT ${COLS} FROM render_jobs WHERE timeline_id = $1 ORDER BY created DESC LIMIT 10`, [timelineId])).rows;
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

export async function reportRender(id: string, body: { status?: unknown; progress?: unknown; note?: unknown; output_cid?: unknown; deliveries?: unknown }): Promise<Job> {
  const status = body.status === undefined ? null : String(body.status);
  if (status && !["rendering", "done", "failed"].includes(status)) throw new RenderError("A worker reports rendering, done or failed.");
  const { rows } = await db.query<Job>(
    `UPDATE render_jobs SET status = coalesce($2, status), progress = coalesce($3, progress), note = coalesce($4, note),
            output_cid = coalesce($5, output_cid), updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, status, body.progress === undefined ? null : Math.max(0, Math.min(1, Number(body.progress))), body.note === undefined ? null : String(body.note).slice(0, 300), body.output_cid ? String(body.output_cid) : null],
  );
  if (!rows[0]) throw new RenderError("No such job.", 404);
  // done, with its files: onto the calendar, ready for the upload step
  if (status === "done" && Array.isArray(body.deliveries) && body.deliveries.length) {
    const { rows: t } = await db.query<{ name: string; founder_id: string | null }>(
      "SELECT t.name, j.founder_id FROM timelines t JOIN render_jobs j ON j.timeline_id = t.id WHERE j.id = $1", [id]);
    const tl = t[0];
    if (tl) await deliverRender(tl.founder_id, rows[0].timeline_id, tl.name, body.deliveries as Delivery[]);
  }
  return rows[0];
}
