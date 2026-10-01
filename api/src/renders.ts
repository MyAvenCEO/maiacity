/**
 * Render jobs. Playing a timeline is live, in the studio; exporting it is a job: the studio (or an agent) queues it,
 * the render worker — the Mac app, rendering natively (vault/app/src/render.rs, vault/crates/vault-render) — claims it
 * with its key, reports its progress, and hands back the film's hash when it is in the vault.
 *
 * The same queue carries the worker's other work: `frame` — a file's graded still (`media_hash`, `params`: clip,
 * still), queued when a timeline save changes how the file looks; or a frame of a timeline (`params`: t, shape),
 * asked for by an agent: of a media clip it is that file's graded still too, so a file has two stills, never a
 * history — its grading still (ACEScct, for grading) and its graded still (its thumbnail). Proxies and the viewer's LUTs are no jobs
 * here: the Mac app makes a file's proxy when it comes in (meta.proxy on the original), a world shot version's when a
 * timeline plays it (vault/app/src/world.rs, in its own world), and bakes every LUT the viewer uses (`color_lut`).
 * `proxy` rows — of files (media_hash) or of shot versions (shot_id + shot_version) — and `lut` rows (the preview LUTs
 * the old worker once baked) are history, nothing more; one still waiting is closed by the app when it claims it.
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

/** The deliveries a render can make: "youtube-4k" — the 16:9 4K master for YouTube alone; none — every delivery. */
export const DELIVERIES = ["youtube-4k"];

export async function queueRender(founderId: string, timelineId: string, body: { delivery?: unknown } = {}): Promise<Job> {
  const delivery = body.delivery === undefined || body.delivery === null ? null : String(body.delivery);
  if (delivery !== null && !DELIVERIES.includes(delivery)) throw new RenderError(`A render makes one of the deliveries ${DELIVERIES.join(", ")} (or every one).`);
  const { rows: t } = await db.query("SELECT 1 FROM timelines WHERE id = $1", [timelineId]);
  if (!t.length) throw new RenderError("No such timeline.", 404);
  const { rows: open } = await db.query<Job>(`SELECT ${COLS} FROM render_jobs WHERE timeline_id = $1 AND kind = 'render' AND status IN ('queued', 'rendering')`, [timelineId]);
  if (open[0]) return open[0]; // one at a time per timeline
  return (await db.query<Job>(`INSERT INTO render_jobs (timeline_id, params, founder_id) VALUES ($1, ($2::text)::jsonb, $3) RETURNING ${COLS}`,
    [timelineId, delivery ? JSON.stringify({ delivery }) : null, founderId])).rows[0]!;
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

/**
 * A file's graded still: its grading still's frame through the clip that grades it (its stacks of tools — base,
 * clip, its scene's, the timeline's, the finishing — its 16:9 framing, the output), 1920 wide — the file's one preview, its thumbnail everywhere. A `frame` job for
 * the file (`media_hash`) with the clip in `params`; one waits per file: a newer ask takes the waiting one's place.
 */
export async function queueStill(founderId: string | null, hash: string, timelineId: string, clip: string): Promise<Job> {
  if (!HASH.test(hash)) throw new RenderError("A file is named by its hash (64 hex).");
  const params = JSON.stringify({ clip, still: true });
  const { rows: waiting } = await db.query<Job>(
    `UPDATE render_jobs SET timeline_id = $2, params = ($3::text)::jsonb, updated = now()
      WHERE id = (SELECT id FROM render_jobs WHERE kind = 'frame' AND media_hash = $1 AND status = 'queued' ORDER BY created LIMIT 1)
      RETURNING ${COLS}`, [hash, timelineId, params]);
  if (waiting[0]) return waiting[0];
  return (await db.query<Job>(`INSERT INTO render_jobs (kind, timeline_id, media_hash, params, founder_id) VALUES ('frame', $1, $2, ($3::text)::jsonb, $4) RETURNING ${COLS}`,
    [timelineId, hash, params, founderId])).rows[0]!;
}

type Graded = { id: string; track: string; kind?: string; hash?: string; stacks?: unknown; frame?: Record<string, unknown>; script?: { scene?: string } };

/** Per file, the first picture clip that plays it, and what its graded still is made of (its look on screen). */
function gradesOf(clips: Graded[], grade: unknown, color: unknown): Map<string, { clip: string; of: string; graded: boolean }> {
  const out = new Map<string, { clip: string; of: string; graded: boolean }>();
  for (const c of clips) {
    if (c.track !== "V1" || (c.kind && c.kind !== "media") || !c.hash || out.has(c.hash)) continue;
    const own = { stacks: c.stacks ?? null, frame: c.frame?.["16:9"] ?? null, scene: c.script?.scene ?? null };
    out.set(c.hash, { clip: c.id, of: JSON.stringify({ own, grade: grade ?? null, color: color ?? null }), graded: !!(c.stacks || c.frame?.["16:9"] || grade) });
  }
  return out;
}

/**
 * A timeline saved: every file whose look on screen changed gets its graded still made again (a file never graded,
 * and graded now by nothing, keeps the preview it was given when it came in).
 */
export async function queueStillsOf(founderId: string | null, before: { clips: unknown; grade: unknown; color: unknown } | null, after: { id: string; clips: unknown; grade: unknown; color: unknown }): Promise<Job[]> {
  const was = before ? gradesOf((before.clips as Graded[]) ?? [], before.grade, before.color) : new Map();
  const queued: Job[] = [];
  for (const [hash, now] of gradesOf((after.clips as Graded[]) ?? [], after.grade, after.color)) {
    const then = was.get(hash);
    if (then?.of === now.of || (!now.graded && !then?.graded)) continue;
    queued.push(await queueStill(founderId, hash, after.id, now.clip));
  }
  return queued;
}

/** A file's grading still was made again (a new moment): its graded still, through the clip that last graded it. */
export async function queueStillOfFile(founderId: string | null, hash: string): Promise<Job | null> {
  if (!HASH.test(hash)) throw new RenderError("A file is named by its hash (64 hex).");
  const { rows } = await db.query<{ id: string; clips: Graded[]; grade: unknown; color: unknown }>(
    `SELECT id, clips, grade, color FROM timelines WHERE clips @> ($1::text)::jsonb ORDER BY updated DESC LIMIT 1`,
    [JSON.stringify([{ hash, track: "V1" }])]);
  const t = rows[0];
  const g = t && gradesOf(t.clips ?? [], t.grade, t.color).get(hash);
  return g && g.graded ? queueStill(founderId, hash, t.id, g.clip) : null;
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
