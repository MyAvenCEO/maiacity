// Access, end to end against real Postgres semantics (PGlite): roles are rows of capabilities, seeded from
// caps.ts, reconciled once per new capability, and edited without anyone locking the city out of itself.
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { assignRole, can, capabilities, createRole, deleteRole, initRoles, listRoles, setRoleCaps } from "../src/acl";
import { ALL_CAPS, CITIZEN_CAPS, ROLE_CAPS } from "../src/caps";
import { addIdea, deleteIdea, listIdeas, updateIdea } from "../src/ideas";

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
    expect(can({ role: "citizen" }, "ideas:admin")).toBe(false);
    expect(can({ role: "admin" }, "ideas:admin")).toBe(true);
    expect(can(null, "hearts:mint")).toBe(false);
  });

  test("a capability the admin took away stays away at the next boot", async () => {
    await setRoleCaps("founder", ROLE_CAPS.founder!.filter((c) => c !== "intent:read"));
    await initRoles();
    expect(capabilities("founder").has("intent:read")).toBe(false);
  });

  test("a capability new in ROLE_CAPS reaches the roles that name it, once", async () => {
    await pg.query("UPDATE secrets SET value = $1 WHERE key = 'caps_reconciled'", [JSON.stringify(ALL_CAPS.filter((c) => c !== "ideas:admin"))]);
    await pg.query("UPDATE roles SET capabilities = replace(capabilities, ',ideas:admin', '') WHERE name = 'admin'");
    await initRoles();
    expect(capabilities("admin").has("ideas:admin")).toBe(true);
  });

  test("nobody can take roles:admin from the admin role, or delete it", async () => {
    await expect(setRoleCaps("admin", ["ideas:admin"])).rejects.toThrow(/keeps the right/);
    await expect(deleteRole("admin")).rejects.toThrow(/cannot be deleted/);
    await expect(setRoleCaps("citizen", ["everything"])).rejects.toThrow(/Not a capability/);
  });

  test("a new role is a row: created, given to someone, and only deletable once nobody holds it", async () => {
    await createRole("gardener", ["ledger:read", "ideas:admin"]);
    expect(can({ role: "gardener" }, "ideas:admin")).toBe(true);
    expect(can({ role: "gardener" }, "hearts:mint")).toBe(false);
    await assignRole("second", "gardener");
    expect((await listRoles()).find((r) => r.name === "gardener")?.people).toBe(1);
    await expect(deleteRole("gardener")).rejects.toThrow(/still has this role/);
    await assignRole("second", "citizen");
    await deleteRole("gardener");
    expect(capabilities("gardener").size).toBe(0);
  });

  test("the first signup cannot be demoted", async () => {
    await expect(assignRole("first", "citizen")).rejects.toThrow(/first admin/);
  });
});

describe("the admin's notebook", () => {
  test("write, edit, tick off and delete an idea", async () => {
    const a = await addIdea("first", "  Rooftop orchards on every large dome  ");
    expect(a.body).toBe("Rooftop orchards on every large dome");
    expect(a.author).toBe("first");
    const b = await addIdea("first", "A night market by the master dome");
    await updateIdea(a.id, { done: true });
    const list = await listIdeas();
    expect(list.map((i) => i.id)).toEqual([b.id, a.id]); // open first
    expect((await updateIdea(b.id, { body: "A night market on Fridays" })).body).toBe("A night market on Fridays");
    await expect(addIdea("first", "   ")).rejects.toThrow(/Write something/);
    await deleteIdea(a.id);
    expect((await listIdeas()).length).toBe(1);
  });
});
