// @ts-nocheck — plain JS, kept loose on purpose
/**
 * Generated UI views in the database (game/genui/views.js holds what a view is and checks it). An agent writes them
 * over the MCP with the app's key; the page /app/genui/ reads them and draws each in its own box. A view is only
 * ever kept checked, so the page never sees a component outside the catalog or a library outside the pinned list.
 */
import { db } from "./pg";
import { check, ViewError } from "../../game/genui/views.js";
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
  const v = check(input);
  const { rows } = await db.query(
    `INSERT INTO genui_views (id, title, note, kind, spec, via) VALUES ($1, $2, $3, $4, ($5::text)::jsonb, $6)
     ON CONFLICT (id) DO UPDATE SET title = $2, note = $3, kind = $4, spec = ($5::text)::jsonb, via = $6,
       version = genui_views.version + 1, updated = now()
     RETURNING *`,
    [v.id, v.title, v.note, v.kind, JSON.stringify(v.spec), String(via).slice(0, 20)],
  );
  return row(rows[0]);
}

export async function deleteView(id) {
  const { affectedRows } = await db.query("DELETE FROM genui_views WHERE id = $1", [String(id)]);
  if (!affectedRows) throw new ViewError("No such view.", 404);
}
