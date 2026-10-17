// @ts-nocheck — plain JS, kept loose on purpose
/**
 * Generated UI views. The repo is the truth for the code that runs (Samuel 2026-10-16, C4): the views on the page are
 * the repo's (code/views/, for Generated UI), and a view an agent writes over the MCP (the app's key) is a draft in the
 * database until the admin keeps it; the landing job (.github/workflows/code-land.yml) then writes it into code/views/
 * and merges it by PR, and the deploy that follows drops the draft (dropLandedDrafts). Drafts show at once on the page,
 * through the same view host as the rest: nothing a view brings can reach us, so keeping one asks only whether we want
 * it. A view is only ever kept checked by the one checker (game/code/check.js).
 */
import { db } from "./pg";
import { ViewError } from "../../game/genui/views.js";
import { checkCode } from "../../game/code/check.js";
import { codeIn, viewOfEntry } from "../../game/code/index.js";
import { canonical } from "../../game/code/files.js";

export { ViewError };

const row = (r) => ({ id: r.id, title: r.title, note: r.note, kind: r.kind, spec: r.spec, via: r.via, version: Number(r.version), keep: Boolean(r.keep), updated: r.updated });
const viewOf = (r) => ({ id: r.id, title: r.title, note: r.note, kind: r.kind, spec: r.spec });

/** the repo's Generated UI views (code/views/): each with the hash it is kept under */
export const repoViews = () => codeIn("views/").filter((e) => e.for === "genui").map((e) => ({ ...viewOfEntry(e), hash: e.hash }));
const screenOf = (id) => codeIn("views/").find((e) => e.ref === `views/${id}`) ?? null;

/** the repo's views and every draft, the newest change first */
export async function listViews() {
  await dropLandedDrafts();
  const { rows } = await db.query("SELECT * FROM genui_views ORDER BY updated DESC");
  return { views: repoViews(), drafts: rows.map(row) };
}

/** make a draft, or replace one by its id (its version goes up, and it is no longer kept: a keep holds for what the admin saw) */
export async function putView(input, via = "mcp") {
  // the one checker (game/code/check.js): its shape, and nothing in it that could never work in a view's frame
  const r = checkCode("view", input);
  if (!r.ok) throw new ViewError(r.errors.join(" "));
  const v = r.value;
  const there = screenOf(v.id);
  if (there && there.for !== "genui") throw new ViewError(`${v.id} is the id of ${there.for}'s screen: pick another.`);
  const { rows } = await db.query(
    `INSERT INTO genui_views (id, title, note, kind, spec, via) VALUES ($1, $2, $3, $4, ($5::text)::jsonb, $6)
     ON CONFLICT (id) DO UPDATE SET title = $2, note = $3, kind = $4, spec = ($5::text)::jsonb, via = $6,
       version = genui_views.version + 1, keep = false, updated = now()
     RETURNING *`,
    [v.id, v.title, v.note, v.kind, JSON.stringify(v.spec), String(via).slice(0, 20)],
  );
  // what is kept but will do nothing, for the agent that wrote it
  return { ...row(rows[0]), draft: true, ...(there ? { changes: `views/${v.id}` } : {}), ...(r.notes.length ? { notes: r.notes } : {}) };
}

/** the admin keeps a draft (or takes that back): the landing job writes a kept draft into code/views/ */
export async function keepView(id, keep = true) {
  const { rows } = await db.query("SELECT * FROM genui_views WHERE id = $1", [String(id)]);
  if (!rows[0]) throw new ViewError("No such draft.", 404);
  if (keep) {
    // what lands in the repo holds nothing the rules refuse, and nothing that would only do nothing there
    const r = checkCode("view", viewOf(rows[0]));
    if (!r.ok) throw new ViewError(r.errors.join(" "));
    if (r.notes.length) throw new ViewError(`It can't be kept while it holds what does nothing: ${r.notes.join(" ")}`);
  }
  const { rows: kept } = await db.query("UPDATE genui_views SET keep = $2 WHERE id = $1 RETURNING *", [String(id), Boolean(keep)]);
  return row(kept[0]);
}

/** drop every draft the repo now holds as it is (the landing job merged it, or it never changed) */
export async function dropLandedDrafts() {
  const { rows } = await db.query("SELECT * FROM genui_views");
  const repo = Object.fromEntries(repoViews().map((v) => [v.id, v]));
  const same = (r) => {
    const v = repo[r.id];
    if (!v) return false;
    const a = checkCode("view", viewOf(r), { mode: "read" });
    const b = checkCode("view", v, { mode: "read" });
    return a.ok && b.ok && canonical(a.value) === canonical(b.value);
  };
  const landed = rows.filter(same).map((r) => r.id);
  if (landed.length) await db.query("DELETE FROM genui_views WHERE id = ANY($1::text[])", [landed]);
  return landed;
}

/** delete a draft; a view in the repo changes or goes only by PR */
export async function deleteView(id) {
  const { affectedRows } = await db.query("DELETE FROM genui_views WHERE id = $1", [String(id)]);
  if (affectedRows) return;
  if (screenOf(String(id))) throw new ViewError(`views/${id} is in the repo: a PR changes or removes it.`, 409);
  throw new ViewError("No such view.", 404);
}
