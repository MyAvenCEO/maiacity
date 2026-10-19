/**
 * The legacy studio's timelines, read only. Studio 2 cuts every film in avenDB, and the two films that came over from
 * here are frozen in the repo (films/legacy/*.json); the table stays as it is. Only the list is left, for the board's
 * scripts, which still find a film's legacy cut by its project and variant (api/scripts/day.ts, api/scripts/posts.ts).
 */
import { db } from "./pg";

/** A legacy timeline as its row holds it: its clips, colour and grade as they were last saved. */
export type Timeline = {
  id: string; name: string; project: string | null; variant: string | null; description: string | null; aspect: string; tags: string[]; clips: unknown[];
  stage: string; version: number; color: unknown; grade: unknown; created: string; updated: string;
};

const COLS = "id, name, project, variant, description, aspect, tags, clips, stage, version, color, grade, created, updated";

export async function listTimelines(): Promise<Timeline[]> {
  // grouped by project, variants in order; timelines without a project after, newest first
  return (await db.query<Timeline>(`SELECT ${COLS} FROM timelines ORDER BY project NULLS LAST, variant NULLS LAST, updated DESC`)).rows;
}
