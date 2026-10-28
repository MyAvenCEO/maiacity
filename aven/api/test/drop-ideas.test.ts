// Migration 0056 against real Postgres semantics (PGlite): the admin's notebook goes while it is empty, and stays,
// whole, while it holds an idea.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS } from "../src/migrations-list";

const DROP = MIGRATIONS.findIndex((m) => m.id === "0056-drop-ideas");
const exists = async (pg: PGlite) => (await pg.query<{ t: string | null }>("SELECT to_regclass('ideas') AS t")).rows[0]?.t !== null;

describe("0056-drop-ideas", () => {
  test("drops the notebook while it is empty", async () => {
    const pg = new PGlite();
    for (const m of MIGRATIONS) await pg.exec(m.sql);
    expect(await exists(pg)).toBe(false);
  });

  test("keeps a notebook that holds an idea", async () => {
    const pg = new PGlite();
    for (const m of MIGRATIONS.slice(0, DROP)) await pg.exec(m.sql);
    await pg.query("INSERT INTO founders (id, name, role) VALUES ('erin', '', 'admin')");
    await pg.query("INSERT INTO ideas (author_id, body) VALUES ('erin', 'a dome of hemp')");
    await pg.exec(MIGRATIONS[DROP]!.sql);
    expect(await exists(pg)).toBe(true);
    expect((await pg.query<{ body: string }>("SELECT body FROM ideas")).rows).toEqual([{ body: "a dome of hemp" }]);
  });
});
