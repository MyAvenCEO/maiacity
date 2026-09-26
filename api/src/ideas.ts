/**
 * The admin's notebook: quick ideas and notes, written down the moment they come. A line of text, when it was
 * written, and whether it is done. Nothing more — an idea that needs more has outgrown the notebook.
 */
import { db } from "./pg";

export type Idea = { id: string; body: string; done: boolean; author: string | null; created_at: string; updated_at: string };

export class IdeaError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const MAX = 4000;
const clean = (body: unknown) => {
  const b = String(body ?? "").trim();
  if (!b) throw new IdeaError("Write something first.");
  if (b.length > MAX) throw new IdeaError(`An idea is at most ${MAX} characters.`);
  return b;
};

const COLS = `i.id, i.body, i.done, f.name AS author, i.created_at, i.updated_at`;

/** Open ideas first, newest on top; the done ones after them. */
export async function listIdeas(): Promise<Idea[]> {
  const { rows } = await db.query<Idea>(
    `SELECT ${COLS} FROM ideas i LEFT JOIN founders f ON f.id = i.author_id ORDER BY i.done, i.created_at DESC`,
  );
  return rows;
}

export async function addIdea(authorId: string, body: unknown): Promise<Idea> {
  const { rows } = await db.query<{ id: string }>("INSERT INTO ideas (author_id, body) VALUES ($1, $2) RETURNING id", [authorId, clean(body)]);
  return (await one(rows[0]!.id))!;
}

export async function updateIdea(id: string, patch: { body?: unknown; done?: unknown }): Promise<Idea> {
  const body = patch.body === undefined ? null : clean(patch.body);
  const done = patch.done === undefined ? null : !!patch.done;
  const r = await db.query(
    `UPDATE ideas SET body = coalesce($2, body), done = coalesce($3, done), updated_at = now() WHERE id = $1`,
    [id, body, done],
  );
  if (!r.affectedRows) throw new IdeaError("No such idea.", 404);
  return (await one(id))!;
}

export async function deleteIdea(id: string): Promise<void> {
  const r = await db.query("DELETE FROM ideas WHERE id = $1", [id]);
  if (!r.affectedRows) throw new IdeaError("No such idea.", 404);
}

async function one(id: string): Promise<Idea | undefined> {
  const { rows } = await db.query<Idea>(`SELECT ${COLS} FROM ideas i LEFT JOIN founders f ON f.id = i.author_id WHERE i.id = $1`, [id]);
  return rows[0];
}
