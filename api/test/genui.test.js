// Generated UI views against real Postgres semantics (PGlite): the views are the repo's (code/views/), an agent's view
// is a draft until the admin keeps it (a kept draft lands in the repo by the landing job, and is dropped then); a draft
// is kept only checked (catalog components, pinned libraries), replacing one raises its version, and deleting works.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, test } from "bun:test";
import { useDb } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { deleteView, keepView, listViews, putView } from "../src/genui.js";
import { EXAMPLES } from "../../game/genui/examples.js";

beforeAll(async () => {
  const pg = new PGlite();
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  useDb({
    query: async (text, params = []) => {
      const r = await pg.query(text, params);
      return { rows: r.rows, affectedRows: r.affectedRows ?? r.rows.length };
    },
    exec: async (text) => void (await pg.exec(text)),
    transaction: (fn) => pg.transaction((tx) => fn({ query: async (t, p = []) => { const r = await tx.query(t, p); return { rows: r.rows, affectedRows: r.affectedRows ?? r.rows.length }; } })),
  });
});

test("the repo's views come first, and no drafts", async () => {
  const { views, drafts } = await listViews();
  expect(views.map((x) => x.id).sort()).toEqual(["coop-chart", "dome-planner", "village-scene"]);
  expect(views.every((v) => /^[0-9a-f]{64}$/.test(v.hash))).toBe(true);
  expect(drafts).toEqual([]);
});

test("a view outside the catalog or the libraries is refused", async () => {
  await expect(putView({ id: "x", title: "X", kind: "a2ui", spec: { components: [{ id: "a", type: "Script" }] } })).rejects.toThrow(/not in the catalog/);
  await expect(putView({ id: "x", title: "X", kind: "html", spec: { html: "<p>hi</p>", libs: ["evil"] } })).rejects.toThrow(/No library/);
  await expect(putView({ id: "Bad Id", title: "X", kind: "html", spec: { html: "<p>hi</p>" } })).rejects.toThrow(/id/);
});

test("a draft: replacing it raises its version and takes back its keep; deleting works", async () => {
  const a = await putView({ id: "hello", title: "Hello", kind: "a2ui", spec: { components: [{ id: "t", type: "Text", text: "hi", onclick: "steal()" }] } });
  expect([a.version, a.draft, a.keep]).toEqual([1, true, false]);
  expect(a.spec.components[0].onclick).toBeUndefined();
  expect((await keepView("hello")).keep).toBe(true);
  const b = await putView({ id: "hello", title: "Hello again", kind: "html", spec: { html: "<p>hi</p>", height: 5000 } });
  expect([b.version, b.keep]).toEqual([2, false]); // kept is what the admin saw, not what came after
  expect(b.spec.height).toBe(1200);
  expect((await listViews()).drafts.map((d) => d.id)).toEqual(["hello"]);
  await deleteView("hello");
  await expect(deleteView("hello")).rejects.toThrow(/No such view/);
  await expect(keepView("hello")).rejects.toThrow(/No such draft/);
});

test("only a view with nothing that does nothing is kept; a game's screen id is not an agent's", async () => {
  await putView({ id: "fetchy", title: "Fetchy", kind: "html", spec: { html: "<script>fetch('/x')</script>" } });
  await expect(keepView("fetchy")).rejects.toThrow(/does nothing/);
  await deleteView("fetchy");
  await expect(putView({ id: "view-wants", title: "Mine", kind: "html", spec: { html: "<p>hi</p>" } })).rejects.toThrow(/sandbox-7's screen/);
});

test("a draft the repo holds as it is goes; a change to a repo view stays a draft; the repo's views go only by PR", async () => {
  const [scene] = EXAMPLES;
  await putView(scene);
  await putView({ ...EXAMPLES[1], title: "COOP treasuries, by month" });
  const { views, drafts } = await listViews();
  expect(drafts.map((d) => d.id)).toEqual(["coop-chart"]);
  expect(views.length).toBe(3);
  await expect(deleteView("village-scene")).rejects.toThrow(/a PR changes or removes it/);
  await deleteView("coop-chart");
});

test("a view card is a screen a MIP may carry: checked, pinned libraries only", async () => {
  const { checkCard } = await import("../../game/economy/params.js");
  const { DEFAULT_VIEWS, viewsOf } = await import("../../game/economy/views.js");
  expect(checkCard(DEFAULT_VIEWS[0]).card.data).toEqual({ slot: "panel", libs: [], height: 520 });
  expect(checkCard({ id: "vw", kind: "view", code: "<p>hi</p>", data: { libs: ["evil"] } }).error).toMatch(/no library/);
  expect(checkCard({ id: "vw", kind: "view", code: "" }).error).toMatch(/HTML/);
  const mine = { id: "view-wants", kind: "view", name: "Wants 2", code: "<p>2</p>" };
  expect(viewsOf([mine]).map((v) => v.name)).toEqual(["Wants 2"]);
  expect(viewsOf([]).map((v) => v.id)).toEqual(["view-wants"]);
});
