// Access, end to end against real Postgres semantics (PGlite): roles are rows of capabilities, seeded from
// caps.ts and reconciled once per new capability.
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { can, capabilities, initRoles } from "../src/acl";
import { ALL_CAPS, CITIZEN_CAPS, ROLE_CAPS } from "../src/caps";

const pg = new PGlite();
const founder = (id: string, role: string) => pg.query("INSERT INTO founders (id, name, role) VALUES ($1, $1, $2)", [id, role]);

beforeAll(async () => {
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  const db: Db = {
    query: async (text, params = []) => {
      const r = await pg.query<any>(text, params as any[]);
      return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
    },
    exec: async (text) => void (await pg.exec(text)),
    transaction: (fn) => pg.transaction((tx) => fn({ query: async (t, p = []) => { const r = await tx.query<any>(t, p as any[]); return { rows: r.rows, affectedRows: r.affectedRows ?? 0 }; } })),
  };
  useDb(db);
  await initRoles();
  await founder("first", "admin");
  await founder("second", "citizen");
});

describe("roles are bundles of capabilities", () => {
  test("seeded from ROLE_CAPS: the admin holds every capability by name, a citizen only the everyday set", () => {
    expect([...capabilities("admin")].sort()).toEqual([...ALL_CAPS].sort());
    expect([...capabilities("citizen")].sort()).toEqual([...CITIZEN_CAPS].sort());
    expect(can({ role: "citizen" }, "economy:admin")).toBe(false);
    expect(can({ role: "admin" }, "economy:admin")).toBe(true);
    expect(can(null, "hearts:mint")).toBe(false);
  });

  test("a capability the admin took away stays away at the next boot", async () => {
    await pg.query("UPDATE roles SET capabilities = $1 WHERE name = 'founder'", [ROLE_CAPS.founder!.filter((c) => c !== "intent:read").join(",")]);
    await initRoles();
    expect(capabilities("founder").has("intent:read")).toBe(false);
  });

  test("a capability new in ROLE_CAPS reaches the roles that name it, once", async () => {
    await pg.query("UPDATE secrets SET value = $1 WHERE key = 'caps_reconciled'", [JSON.stringify(ALL_CAPS.filter((c) => c !== "economy:admin"))]);
    await pg.query("UPDATE roles SET capabilities = replace(capabilities, ',economy:admin', '') WHERE name = 'admin'");
    await initRoles();
    expect(capabilities("admin").has("economy:admin")).toBe(true);
  });
});
