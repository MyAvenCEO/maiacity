// Migration 0057 against real Postgres semantics (PGlite): founders 2 and 3 go with their passkeys, the invite one of
// them signed up on stays without them, and founder 1 keeps everything; a founder named by an id alone, or an admin,
// stays.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS } from "../src/migrations-list";

const DROP = MIGRATIONS.findIndex((m) => m.id === "0057-drop-founders-2-and-3");
const TWO = "de5116b9-8d50-45e0-b3f7-0092edc0e287";
const THREE = "d2e14742-b0dc-4425-90da-8537dccef51e";

const before = async () => {
  const pg = new PGlite();
  for (const m of MIGRATIONS.slice(0, DROP)) await pg.exec(m.sql);
  return pg;
};
const founders = async (pg: PGlite) =>
  (await pg.query<{ number: number; id: string }>("SELECT number::int AS number, id FROM founders ORDER BY number")).rows;
const count = async (pg: PGlite, sql: string) => (await pg.query<{ n: number }>(sql)).rows[0]!.n;

describe("0057-drop-founders-2-and-3", () => {
  test("founders 2 and 3 go with their passkeys, founder 1 keeps everything", async () => {
    const pg = await before();
    await pg.query("INSERT INTO founders (id, name, role) VALUES ('samuel', 'Samuel', 'admin')");
    await pg.query(`INSERT INTO founders (id, name, role) VALUES ('${TWO}', 'Daniel', 'citizen'), ('${THREE}', '', 'citizen')`);
    for (const [key, who] of [["k1", "samuel"], ["k2", TWO], ["k3", THREE]]) {
      await pg.query("INSERT INTO passkeys (id, founder_id, public_key) VALUES ($1, $2, 'pk')", [key, who]);
    }
    await pg.query("INSERT INTO api_keys (founder_id, hash, scope, label) VALUES ('samuel', 'h', 'media:read', 'Mac')");
    await pg.query("INSERT INTO signup_invites (code, made_by, expires_at, used_by, used_at) VALUES ('inv', 'samuel', now(), $1, now())", [THREE]);
    await pg.exec(MIGRATIONS[DROP]!.sql);
    expect(await founders(pg)).toEqual([{ number: 1, id: "samuel" }]);
    expect((await pg.query("SELECT id FROM passkeys")).rows).toEqual([{ id: "k1" }]);
    expect(await count(pg, "SELECT count(*)::int AS n FROM api_keys WHERE founder_id = 'samuel'")).toBe(1);
    expect((await pg.query("SELECT code, made_by, used_by FROM signup_invites")).rows).toEqual([
      { code: "inv", made_by: "samuel", used_by: null },
    ]);
  });

  test("a founder whose number and id don't both match, or an admin, stays", async () => {
    const pg = await before();
    await pg.query(`INSERT INTO founders (id, name, role) VALUES ('${TWO}', 'first', 'admin'), ('${THREE}', 'second', 'citizen')`);
    await pg.exec(MIGRATIONS[DROP]!.sql);
    expect(await founders(pg)).toEqual([
      { number: 1, id: TWO },
      { number: 2, id: THREE },
    ]);
  });

  test("a fresh database runs it with nothing to drop", async () => {
    const pg = new PGlite();
    for (const m of MIGRATIONS) await pg.exec(m.sql);
    expect(await founders(pg)).toEqual([]);
  });
});
