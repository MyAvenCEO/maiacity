// The publishing calendar against real Postgres semantics (PGlite).
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { createContent, deleteContent, listContent, saveContent } from "../src/content";

const pg = new PGlite();
beforeAll(async () => {
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  const wrap = (q: { query: PGlite["query"] }) => ({
    query: async (text: string, params: unknown[] = []) => {
      const r = await q.query<any>(text, params as any[]);
      return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
    },
  });
  useDb({ ...wrap(pg), exec: async (t) => void (await pg.exec(t)), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as any))) } as Db);
  await pg.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin')");
});

test("an idea goes to the backlog; given a date it is scheduled; moved, it keeps what it carries", async () => {
  const idea = await createContent("admin", { title: "Day 19 film", kind: "film", channels: ["youtube", "instagram"], tags: ["Day 19"] });
  expect(idea.status).toBe("idea");
  expect(idea.scheduled_at).toBeNull();
  const when = "2026-10-01T16:00:00.000Z";
  const s = await saveContent(idea.id, { scheduled_at: when, status: "scheduled", cids: ["bafybeieyz3wtzq4m35upckldkjtf2clzsxqnix6g63pvtun7nuhhfqr5de"] });
  expect(new Date(s.scheduled_at!).toISOString()).toBe(when);
  expect(s.channels).toEqual(["youtube", "instagram"]);
  const moved = await saveContent(idea.id, { scheduled_at: "2026-10-03T16:00:00.000Z" });
  expect(moved.cids.length).toBe(1);
  expect(moved.tags).toEqual(["Day 19"]);
  const october = await listContent("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
  expect(october.map((i) => i.id)).toContain(idea.id);
  expect((await listContent("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).map((i) => i.id)).not.toContain(idea.id);
  const back = await saveContent(idea.id, { scheduled_at: null });
  expect(back.scheduled_at).toBeNull();
  await expect(createContent("admin", { title: "x", kind: "hologram" })).rejects.toThrow(/kind is one of/);
  await expect(saveContent(idea.id, { channels: ["myspace"] })).rejects.toThrow(/One of/);
  await deleteContent(idea.id);
  expect((await listContent()).length).toBe(0);
});
