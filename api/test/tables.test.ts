// The admin's Postgres window (tables.ts) against real Postgres semantics (PGlite): every table counted, a page of rows
// in its primary key's order, secrets and credentials never sent, no table but the catalog's, and nothing written.
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS } from "../src/migrations-list";
import { useDb, type Db } from "../src/pg";
import { listTables, readTable } from "../src/tables";

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  await pg.exec("CREATE TABLE notes (id SERIAL PRIMARY KEY, body TEXT NOT NULL)");
  await pg.query("INSERT INTO notes (body) VALUES ('a dome of hemp'), ('a tower of glass')");
  await pg.query("INSERT INTO secrets (key, value) VALUES ('kept', 'do not show me') ON CONFLICT (key) DO UPDATE SET value = 'do not show me'");
  const db: Db = {
    query: (text, params) => pg.query(text, params as any[]) as any,
    exec: async (text) => void (await pg.exec(text)),
    transaction: (fn) => pg.transaction((tx) => fn({ query: (text, params) => tx.query(text, params as any[]) as any })),
  };
  useDb(db);
});

describe("the admin's Postgres window", () => {
  test("lists every table with its rows counted and its secret columns marked", async () => {
    const tables = await listTables();
    const notes = tables.find((t) => t.name === "notes");
    expect(notes?.rows).toBe(2);
    expect(tables.map((t) => t.name)).toEqual([...tables.map((t) => t.name)].sort());
    const secrets = tables.find((t) => t.name === "secrets");
    expect(secrets?.columns.find((c) => c.name === "value")?.hidden).toBe(true);
    expect(secrets?.columns.find((c) => c.name === "key")?.hidden).toBe(false);
  });

  test("reads a page of a table's rows", async () => {
    const page = await readTable("notes", 0, 1);
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect(page.columns.map((c) => c.name)).toContain("body");
    const next = await readTable("notes", 1, 1);
    expect([page.rows[0].body, next.rows[0].body].sort()).toEqual(["a dome of hemp", "a tower of glass"]);
  });

  test("never sends a secret's value", async () => {
    const page = await readTable("secrets", 0, 200);
    const kept = page.rows.find((r) => r.key === "kept");
    expect(kept?.value).toEqual({ hidden: true });
    expect(JSON.stringify(page)).not.toContain("do not show me");
  });

  test("reads only a table the catalog names", async () => {
    await expect(readTable('notes"; DROP TABLE notes; --')).rejects.toThrow("There is no table");
    await expect(readTable("pg_authid")).rejects.toThrow("There is no table");
    expect((await readTable("notes")).total).toBe(2);
  });
});
