// Access, end to end against real Postgres semantics (PGlite): roles are rows of capabilities, seeded from
// caps.ts, reconciled once per new capability, and edited without anyone locking the city out of itself.
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { assignRole, can, capabilities, createRole, deleteRole, initRoles, listRoles, setRoleCaps } from "../src/acl";
import { ALL_CAPS, CITIZEN_CAPS, ROLE_CAPS } from "../src/caps";
import { addIdea, deleteIdea, listIdeas, updateIdea } from "../src/ideas";
import { approveDevice, deviceInfo, keyHolder, redeemDevice, revokeKey, startDevice } from "../src/keys";

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

describe("a terminal signs in with the admin's approval", () => {
  const bearer = (key: string) => new Request("http://x/", { headers: { authorization: `Bearer ${key}` } });

  test("code → approval → a key that can do what was asked, until it is revoked", async () => {
    const d = await startDevice("media:admin", "bun media on a laptop");
    expect(d.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await redeemDevice(d.device_code)).toEqual({ pending: true });
    expect((await deviceInfo(d.user_code.toLowerCase())).scope).toEqual(["media:admin"]);
    await expect(approveDevice(d.user_code, { id: "second", role: "citizen" })).rejects.toThrow(/cannot hand on/);
    await approveDevice(d.user_code, { id: "first", role: "admin" });
    const r = await redeemDevice(d.device_code);
    const key = (r as { key: string }).key;
    expect(key).toStartWith("mck_");
    await expect(redeemDevice(d.device_code)).rejects.toThrow(/used or expired/);
    expect(await keyHolder(bearer(key))).toEqual({ id: "first", role: "admin", scope: ["media:admin"] });
    expect(await keyHolder(bearer("mck_wrong"))).toBeNull();
    expect(await revokeKey(bearer(key))).toBe(true);
    expect(await keyHolder(bearer(key))).toBeNull();
  });

  test("only known capabilities can be asked for", async () => {
    await expect(startDevice("everything", "x")).rejects.toThrow(/known capabilities/);
  });
});
