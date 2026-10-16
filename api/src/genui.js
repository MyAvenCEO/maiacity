// @ts-nocheck — plain JS, kept loose on purpose
/**
 * Generated UI views in the database (game/genui/views.js holds what a view is and checks it). An agent writes them
 * over the MCP with the app's key; the page /app/genui/ reads them and draws each through the one view host. A view is
 * only ever kept checked by the one checker (game/code/check.js).
 */
import { db } from "./pg";
import { ViewError } from "../../game/genui/views.js";
import { checkCode } from "../../game/code/check.js";
import { EXAMPLES } from "../../game/genui/examples.js";

export { ViewError };

const row = (r) => ({ id: r.id, title: r.title, note: r.note, kind: r.kind, spec: r.spec, via: r.via, version: Number(r.version), updated: r.updated });

/** every view, the newest change first; the three first examples when there are none yet */
export async function listViews() {
  let { rows } = await db.query("SELECT * FROM genui_views ORDER BY updated DESC");
  if (!rows.length) {
    for (const v of [...EXAMPLES].reverse()) await putView(v, "example");
    ({ rows } = await db.query("SELECT * FROM genui_views ORDER BY updated DESC"));
  }
  return rows.map(row);
}

/** make a view, or replace one by its id (its version goes up) */
export async function putView(input, via = "mcp") {
  // the one checker (game/code/check.js): its shape, and nothing in it that could never work in a view's frame
  const r = checkCode("view", input);
  if (!r.ok) throw new ViewError(r.errors.join(" "));
  const v = r.value;
  const { rows } = await db.query(
    `INSERT INTO genui_views (id, title, note, kind, spec, via) VALUES ($1, $2, $3, $4, ($5::text)::jsonb, $6)
     ON CONFLICT (id) DO UPDATE SET title = $2, note = $3, kind = $4, spec = ($5::text)::jsonb, via = $6,
       version = genui_views.version + 1, updated = now()
     RETURNING *`,
    [v.id, v.title, v.note, v.kind, JSON.stringify(v.spec), String(via).slice(0, 20)],
  );
  // what is kept but will do nothing, for the agent that wrote it
  return { ...row(rows[0]), ...(r.notes.length ? { notes: r.notes } : {}) };
}

export async function deleteView(id) {
  const { affectedRows } = await db.query("DELETE FROM genui_views WHERE id = $1", [String(id)]);
  if (!affectedRows) throw new ViewError("No such view.", 404);
}
