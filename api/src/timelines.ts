/**
 * The studio's timelines. A timeline is an edit over the media vault: a list of clips, each naming a file by its
 * BLAKE3 hash and where it sits on a track, how far into the file it starts, how long it runs and how loud it plays.
 * The bytes stay in the vault; a timeline only points at them, so it is small, and the same file can be in many.
 *
 * A clip is a media clip (a vault file, by hash) or a world clip (a shot of Sandbox 4 kept as data, by shot id and
 * the version it was cut with — api/src/shots.ts). A clip may carry its own grade (an ASC CDL in ACEScct, the Grade
 * tab) and, for media, how it is reframed per delivery shape. The timeline itself has a working step — edit, locked,
 * graded, rendered — a version (one more at every unlock), its colour pipeline and the whole film's look.
 */
import { db } from "./pg";
import { cleanCdl } from "../../game/film/color.js";
import { missingShots } from "./shots";

export class TimelineError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Cdl = { slope: [number, number, number]; offset: [number, number, number]; power: [number, number, number]; sat: number };
export type Shape = "1:1" | "16:9" | "9:16" | "4:5";
export type Clip = {
  id: string; track: string; start: number; in: number; dur: number; vol: number; fin?: number; fout?: number;
  /** absent = "media" */
  kind?: "media" | "world";
  /** media clips: the vault file, by its BLAKE3 hash (64 hex) */
  hash?: string;
  /** world clips (V1 only): shots.id and the version cut in */
  shot?: string; shotVersion?: number;
  /** this clip's own grade, in ACEScct (absent = none) */
  grade?: Cdl;
  /** media clips: reframing per delivery shape; x, y in −1…1 of the free room, zoom ≥ 1 */
  frame?: Partial<Record<Shape, { x: number; y: number; zoom: number }>>;
};
export type Stage = "edit" | "locked" | "graded" | "rendered";
export type Color = { working: "acescct"; output: string };
export type Grade = { look: Cdl | null; preset?: string } | null;
export type Timeline = {
  id: string; name: string; project: string | null; variant: string | null; description: string | null; aspect: string; tags: string[]; clips: Clip[];
  stage: Stage; version: number; color: Color; grade: Grade; created: string; updated: string;
};

const ASPECTS = ["1:1", "16:9", "9:16", "4:5"];
const STAGES: Stage[] = ["edit", "locked", "graded", "rendered"];
const OUTPUTS = ["odt-rec709", "odt-rec2100-pq"];
const PRESETS = ["neutral", "cold", "dip", "bright", "night", "warm"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const num = (v: unknown, min = 0) => Math.max(min, Number.isFinite(Number(v)) ? Number(v) : min);
const clamp = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d));

function cleanClip(c: any): Clip {
  const kind = c?.kind ?? "media";
  if (kind !== "media" && kind !== "world") throw new TimelineError("A clip is a media clip or a world clip.");
  const base = { id: String(c.id ?? "").slice(0, 40), track: String(c.track ?? "V1").slice(0, 8), start: num(c.start), in: num(c.in), dur: num(c.dur, 0.05), vol: Math.min(1, num(c.vol)),
    ...(c.fin !== undefined ? { fin: Math.min(10, num(c.fin)) } : {}), ...(c.fout !== undefined ? { fout: Math.min(10, num(c.fout)) } : {}) };
  let clip: Clip;
  if (kind === "world") {
    if (c.hash !== undefined && c.hash !== null) throw new TimelineError("A world clip is a shot, not a file: it has no hash.");
    if (base.track !== "V1") throw new TimelineError("A world clip goes on the picture track (V1).");
    if (!UUID.test(String(c.shot))) throw new TimelineError("A world clip names its shot.");
    const v = Number(c.shotVersion);
    if (!Number.isInteger(v) || v < 1) throw new TimelineError("A world clip names the version of its shot it was cut with.");
    clip = { ...base, kind: "world", shot: String(c.shot).toLowerCase(), shotVersion: v };
  } else {
    if (!HASH.test(String(c?.hash))) throw new TimelineError("Every clip names its file by hash.");
    // an existing clip stays exactly as it was: `kind` is written only for world clips
    clip = { ...base, ...(c.kind === "media" ? { kind: "media" as const } : {}), hash: String(c.hash) };
  }
  if (c.grade !== undefined && c.grade !== null) {
    const g = cleanCdl(c.grade);
    if (g) clip.grade = g as Cdl;
  }
  if (c.frame !== undefined && c.frame !== null) {
    if (kind === "world") throw new TimelineError("A world clip is framed by its shot (its framing per shape), not by a crop.");
    if (typeof c.frame !== "object" || Array.isArray(c.frame)) throw new TimelineError("A clip's frame is set per shape.");
    const frame: NonNullable<Clip["frame"]> = {};
    for (const [shape, f] of Object.entries(c.frame as Record<string, any>)) {
      if (!ASPECTS.includes(shape)) throw new TimelineError(`A clip is framed per shape: ${ASPECTS.join(", ")}.`);
      frame[shape as Shape] = { x: clamp(f?.x, -1, 1, 0), y: clamp(f?.y, -1, 1, 0), zoom: clamp(f?.zoom, 1, 8, 1) };
    }
    if (Object.keys(frame).length) clip.frame = frame;
  }
  return clip;
}

function cleanColor(v: any): Color {
  if (!v || typeof v !== "object") throw new TimelineError("A timeline's colour is { working, output }.");
  if ((v.working ?? "acescct") !== "acescct") throw new TimelineError("The working colour space is ACEScct.");
  const output = String(v.output ?? "odt-rec709");
  if (!OUTPUTS.includes(output)) throw new TimelineError(`The output transform is one of ${OUTPUTS.join(", ")}.`);
  return { working: "acescct", output };
}

function cleanGrade(v: any): Grade {
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new TimelineError("The film's grade is { look, preset? }.");
  if (v.preset !== undefined && v.preset !== null && !PRESETS.includes(String(v.preset))) throw new TimelineError(`A preset is one of ${PRESETS.join(", ")}.`);
  const look = v.look === undefined || v.look === null ? null : (cleanCdl(v.look) as Cdl | null);
  return { look, ...(v.preset ? { preset: String(v.preset) } : {}) };
}

type Body = { name?: unknown; project?: unknown; variant?: unknown; description?: unknown; aspect?: unknown; tags?: unknown; clips?: unknown; stage?: unknown; color?: unknown; grade?: unknown };
type Clean = { name?: string; project?: string | null; variant?: string | null; description?: string | null; aspect?: string; tags?: string[]; clips?: Clip[]; stage?: Stage; color?: Color; grade?: Grade };

function clean(body: Body) {
  const out: Clean = {};
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
    out.clips = body.clips.map(cleanClip);
  }
  if (body.stage !== undefined) {
    if (!STAGES.includes(body.stage as Stage)) throw new TimelineError(`A timeline's stage is one of ${STAGES.join(", ")}.`);
    out.stage = body.stage as Stage;
  }
  if (body.color !== undefined) out.color = cleanColor(body.color);
  if (body.grade !== undefined) out.grade = cleanGrade(body.grade);
  return out;
}

/** Every world clip names a shot version that exists. */
async function checkShots(clips: Clip[] | undefined) {
  const refs = (clips ?? []).filter((c) => c.kind === "world").map((c) => ({ shot: c.shot!, shotVersion: c.shotVersion! }));
  if (!refs.length) return;
  const missing = await missingShots(refs);
  if (missing.length) throw new TimelineError(`No such shot: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}.`);
}

/** The cut itself — what is where, how long and how loud — without the grade, which may change after the lock. */
const cutOf = (clips: Clip[]) => JSON.stringify(clips.map(({ grade: _g, frame: _f, ...rest }) => Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)))));

const COLS = "id, name, project, variant, description, aspect, tags, clips, stage, version, color, grade, created, updated";

export async function listTimelines(): Promise<Timeline[]> {
  // grouped by project, variants in order; timelines without a project after, newest first
  return (await db.query<Timeline>(`SELECT ${COLS} FROM timelines ORDER BY project NULLS LAST, variant NULLS LAST, updated DESC`)).rows;
}

export async function getTimeline(id: string): Promise<Timeline> {
  if (!UUID.test(id)) throw new TimelineError("No such timeline.", 404);
  const t = (await db.query<Timeline>(`SELECT ${COLS} FROM timelines WHERE id = $1`, [id])).rows[0];
  if (!t) throw new TimelineError("No such timeline.", 404);
  return t;
}

export async function createTimeline(founderId: string, body: Record<string, unknown>): Promise<Timeline> {
  const t = clean({ name: "Untitled", ...body });
  await checkShots(t.clips);
  const { rows } = await db.query<Timeline>(
    // arrays go in as JSON text: Bun's client does not send a JS array as text[]
    `INSERT INTO timelines (name, aspect, tags, clips, founder_id, project, variant, description, stage, color, grade)
     VALUES ($1, $2, ARRAY(SELECT jsonb_array_elements_text(($3::text)::jsonb)), ($4::text)::jsonb, $5, $6, $7, $8, $9, ($10::text)::jsonb, ($11::text)::jsonb) RETURNING ${COLS}`,
    [t.name, t.aspect ?? "16:9", JSON.stringify(t.tags ?? []), JSON.stringify(t.clips ?? []), founderId, t.project ?? null, t.variant ?? null, t.description ?? null,
     t.stage ?? "edit", JSON.stringify(t.color ?? { working: "acescct", output: "odt-rec709" }), t.grade ? JSON.stringify(t.grade) : null],
  );
  return rows[0]!;
}

/**
 * Save changes. Once the edit is locked (stage past 'edit') the cut is fixed: clips may change only in their grade
 * and framing, until the timeline is unlocked (stage back to 'edit'), which makes it a new version.
 */
export async function saveTimeline(id: string, body: Record<string, unknown>): Promise<Timeline> {
  const t = clean(body);
  await checkShots(t.clips);
  const now = await getTimeline(id);
  const stage = t.stage ?? now.stage;
  if (t.clips && now.stage !== "edit" && stage !== "edit" && cutOf(t.clips) !== cutOf(now.clips.map(cleanClip)))
    throw new TimelineError("The edit is locked: unlock it to change the cut.", 409);
  const unlock = now.stage !== "edit" && stage === "edit";
  const { rows } = await db.query<Timeline>(
    `UPDATE timelines SET name = coalesce($2, name), aspect = coalesce($3, aspect),
            tags = CASE WHEN $4::text IS NULL THEN tags ELSE ARRAY(SELECT jsonb_array_elements_text(($4::text)::jsonb)) END,
            clips = coalesce(($5::text)::jsonb, clips),
            project = CASE WHEN $6::boolean THEN $7 ELSE project END,
            variant = CASE WHEN $8::boolean THEN $9 ELSE variant END,
            description = CASE WHEN $10::boolean THEN $11 ELSE description END,
            stage = $12,
            version = version + CASE WHEN $13::boolean THEN 1 ELSE 0 END,
            color = coalesce(($14::text)::jsonb, color),
            grade = CASE WHEN $15::boolean THEN ($16::text)::jsonb ELSE grade END,
            updated = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, t.name ?? null, t.aspect ?? null, t.tags ? JSON.stringify(t.tags) : null, t.clips ? JSON.stringify(t.clips) : null,
     "project" in t, t.project ?? null, "variant" in t, t.variant ?? null, "description" in t, t.description ?? null,
     stage, unlock, t.color ? JSON.stringify(t.color) : null, "grade" in t, t.grade ? JSON.stringify(t.grade) : null],
  );
  if (!rows[0]) throw new TimelineError("No such timeline.", 404);
  return rows[0];
}

export async function deleteTimeline(id: string): Promise<void> {
  const r = await db.query("DELETE FROM timelines WHERE id = $1", [id]);
  if (!r.affectedRows) throw new TimelineError("No such timeline.", 404);
}
