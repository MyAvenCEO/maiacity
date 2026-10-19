// Migration 0055 against real Postgres semantics (PGlite): an invite of avenDB's, named by its share's id, is kept once
// someone signs up on it, made by no founder of the API's, and a second sign-up on it finds it taken.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS } from "../src/migrations-list";

const SHARE = "ab".repeat(32);

describe("0055-avendb-invites", () => {
  test("a share's id signs one person up, made by no founder", async () => {
    const pg = new PGlite();
    for (const m of MIGRATIONS) await pg.exec(m.sql);
    await pg.query("INSERT INTO founders (id, name, role) VALUES ('erin', '', 'citizen'), ('frank', '', 'citizen')");
    const use = (who: string) =>
      pg.query<{ code: string }>(
        `INSERT INTO signup_invites (code, expires_at, used_by, used_at) VALUES ($1, now(), $2, now())
         ON CONFLICT (code) DO NOTHING RETURNING code`,
        [SHARE, who],
      );
    expect((await use("erin")).rows).toEqual([{ code: SHARE }]);
    expect((await use("frank")).rows).toEqual([]);
    const [row] = (await pg.query<any>("SELECT made_by, used_by FROM signup_invites WHERE code = $1", [SHARE])).rows;
    expect(row).toEqual({ made_by: null, used_by: "erin" });
  });
});
