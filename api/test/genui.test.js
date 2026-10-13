// Generated UI views against real Postgres semantics (PGlite): the three examples come first, a view is kept only
// checked (catalog components, pinned libraries), replacing one raises its version, and deleting works.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, test } from "bun:test";
import { useDb } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { deleteView, listViews, putView } from "../src/genui.js";

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

test("the three examples come first", async () => {
  const v = await listViews();
  expect(v.map((x) => x.id).sort()).toEqual(["coop-chart", "dome-planner", "village-scene"]);
});

test("a view outside the catalog or the libraries is refused", async () => {
  await expect(putView({ id: "x", title: "X", kind: "a2ui", spec: { components: [{ id: "a", type: "Script" }] } })).rejects.toThrow(/not in the catalog/);
  await expect(putView({ id: "x", title: "X", kind: "html", spec: { html: "<p>hi</p>", libs: ["evil"] } })).rejects.toThrow(/No library/);
  await expect(putView({ id: "Bad Id", title: "X", kind: "html", spec: { html: "<p>hi</p>" } })).rejects.toThrow(/id/);
});

test("replacing a view raises its version; unknown props are dropped", async () => {
  const a = await putView({ id: "hello", title: "Hello", kind: "a2ui", spec: { components: [{ id: "t", type: "Text", text: "hi", onclick: "steal()" }] } });
  expect(a.version).toBe(1);
  expect(a.spec.components[0].onclick).toBeUndefined();
  const b = await putView({ id: "hello", title: "Hello again", kind: "html", spec: { html: "<p>hi</p>", height: 5000 } });
  expect(b.version).toBe(2);
  expect(b.spec.height).toBe(1200);
  await deleteView("hello");
  await expect(deleteView("hello")).rejects.toThrow(/No such view/);
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
