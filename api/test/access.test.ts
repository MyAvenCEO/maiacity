// Access, end to end against real Postgres semantics (PGlite): roles are rows of capabilities, seeded from
// caps.ts and reconciled once per new capability; a terminal's key reaches the media vault alone.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { can, capabilities, initRoles } from "../src/acl";
import { ALL_CAPS, CITIZEN_CAPS, ROLE_CAPS } from "../src/caps";
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

  test("a key reaches the media vault alone, whatever it asks or was given before", async () => {
    await expect(startDevice("everything", "x")).rejects.toThrow(/only work with the media vault/);
    await expect(startDevice("economy:admin,roles:admin", "x")).rejects.toThrow(/only work with the media vault/);
    // an older Mac app asks for more: it is given the media vault alone
    const d = await startDevice("media:admin,content:admin,economy:admin", "The OS");
    expect((await deviceInfo(d.user_code)).scope).toEqual(["media:admin"]);
    // a key given more before keeps only the media vault
    await pg.query("INSERT INTO api_keys (founder_id, hash, scope, label) VALUES ('first', $1, 'media:admin,content:admin,economy:admin', 'old Mac')", [createHash("sha256").update("mck_old_mac").digest("hex")]);
    expect((await keyHolder(bearer("mck_old_mac")))?.scope).toEqual(["media:admin"]);
  });
});
