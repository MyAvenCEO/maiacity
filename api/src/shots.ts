/**
 * World shots: shots of Sandbox 4 kept as data (game/film/shot.js) — where the world is loaded, the camera move, the
 * hour, the exposure, the lights and cues, the shutter and the framing per shape. A world clip on a timeline names a
 * shot and the version it was cut with. Saving a changed spec makes a new version; the old ones are kept.
 */
import { db } from "./pg";
import { normalize, sameSpec, ShotError as SpecError } from "../../game/film/shot.js";

export class ShotError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Shot = { id: string; name: string; project: string | null; version: number; spec: any; created: string; updated: string };
export type ShotVersion = { version: number; spec: any; created: string };

const COLS = "id, name, project, version, spec, created, updated";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanSpec(spec: unknown) {
  try {
    return normalize(spec);
  } catch (e) {
    if (e instanceof SpecError) throw new ShotError(e.message);
    throw e;
  }
}

function cleanName(v: unknown) {
  const n = String(v ?? "").trim().slice(0, 120);
  if (!n) throw new ShotError("Give the shot a name.");
  return n;
}

const cleanProject = (v: unknown) => String(v ?? "").trim().slice(0, 80) || null;

export async function listShots(filter: { project?: string | null } = {}): Promise<Shot[]> {
  if (filter.project) return (await db.query<Shot>(`SELECT ${COLS} FROM shots WHERE project = $1 ORDER BY name`, [filter.project])).rows;
  return (await db.query<Shot>(`SELECT ${COLS} FROM shots ORDER BY project NULLS LAST, name`)).rows;
}

/** A shot as it is now, or as it was at `version`. */
export async function getShot(id: string, version?: number): Promise<Shot> {
  if (!UUID.test(id)) throw new ShotError("No such shot.", 404);
  const { rows } = await db.query<Shot>(`SELECT ${COLS} FROM shots WHERE id = $1`, [id]);
  const shot = rows[0];
  if (!shot) throw new ShotError("No such shot.", 404);
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) throw new ShotError("A version is a whole number from 1.");
  if (version === undefined || version === shot.version) return shot;
  const v = (await db.query<ShotVersion>("SELECT version, spec, created FROM shot_versions WHERE shot_id = $1 AND version = $2", [id, version])).rows[0];
  if (!v) throw new ShotError(`The shot has no version ${version}.`, 404);
  return { ...shot, version: v.version, spec: v.spec, updated: v.created };
}

export async function shotVersions(id: string): Promise<ShotVersion[]> {
  await getShot(id);
  return (await db.query<ShotVersion>("SELECT version, spec, created FROM shot_versions WHERE shot_id = $1 ORDER BY version", [id])).rows;
}

export async function createShot(founderId: string, body: Record<string, unknown>): Promise<Shot> {
  const name = cleanName(body.name), project = cleanProject(body.project), spec = cleanSpec(body.spec);
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<Shot>(
      `INSERT INTO shots (name, project, spec, founder_id) VALUES ($1, $2, ($3::text)::jsonb, $4) RETURNING ${COLS}`,
      [name, project, JSON.stringify(spec), founderId],
    );
    const shot = rows[0]!;
    await tx.query("INSERT INTO shot_versions (shot_id, version, spec, founder_id) VALUES ($1, 1, ($2::text)::jsonb, $3)", [shot.id, JSON.stringify(spec), founderId]);
    return shot;
  });
}

/** Rename, move or change a shot. A spec that differs from the current one is a new version; the same spec is not. */
export async function saveShot(id: string, founderId: string, body: Record<string, unknown>): Promise<Shot> {
  const now = await getShot(id);
  const name = body.name !== undefined ? cleanName(body.name) : now.name;
  const project = body.project !== undefined ? cleanProject(body.project) : now.project;
  const spec = body.spec !== undefined ? cleanSpec(body.spec) : null;
  const changed = spec !== null && !sameSpec(spec, cleanSpec(now.spec));
  return db.transaction(async (tx) => {
    if (!changed) {
      const { rows } = await tx.query<Shot>(`UPDATE shots SET name = $2, project = $3, updated = now() WHERE id = $1 RETURNING ${COLS}`, [id, name, project]);
      return rows[0]!;
    }
    // the version is taken under the row's lock, so two saves at once make two versions, never one twice
    const { rows } = await tx.query<Shot>(
      `UPDATE shots SET name = $2, project = $3, spec = ($4::text)::jsonb, version = version + 1, updated = now() WHERE id = $1 RETURNING ${COLS}`,
      [id, name, project, JSON.stringify(spec)],
    );
    const shot = rows[0]!;
    await tx.query("INSERT INTO shot_versions (shot_id, version, spec, founder_id) VALUES ($1, $2, ($3::text)::jsonb, $4)", [id, shot.version, JSON.stringify(spec), founderId]);
    return shot;
  });
}

/** Which of these (shot, version) pairs exist — for checking a timeline's world clips. */
export async function missingShots(refs: { shot: string; shotVersion: number }[]): Promise<string[]> {
  const missing: string[] = [];
  for (const r of refs) {
    const ok = UUID.test(r.shot) && (await db.query("SELECT 1 FROM shot_versions WHERE shot_id = $1 AND version = $2", [r.shot, r.shotVersion])).rows.length > 0;
    if (!ok) missing.push(`${r.shot} v${r.shotVersion}`);
  }
  return missing;
}
