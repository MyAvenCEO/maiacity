// The media vault's API side: pairing a Mac's iroh node, revoking it, and what a device needs to join the catalog.
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { joinInfo, listDevices, listVaultFiles, pairDevice, revokeDevice } from "../src/vault";

const pg = new PGlite();
const node = (c: string) => c.repeat(64).slice(0, 64);

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
  await pg.query("INSERT INTO founders (id, name, role) VALUES ('first', 'first', 'admin')");
});

describe("pairing a Mac's node", () => {
  test("an EndpointId is 64 hex; pairing again renews only the label", async () => {
    await expect(pairDevice("first", "nope", "x")).rejects.toThrow(/64 hex/);
    const d = await pairDevice("first", node("a").toUpperCase(), "maiaCITY Studio · Mac");
    expect(d.endpoint_id).toBe(node("a"));
    expect((await pairDevice("first", node("a"), "renamed")).label).toBe("renamed");
    expect((await listDevices()).map((x) => x.endpoint_id)).toEqual([node("a")]);
  });

  test("a revoked node stays revoked", async () => {
    expect(await revokeDevice(node("a"))).toBe(true);
    expect(await revokeDevice(node("a"))).toBe(false);
    await expect(pairDevice("first", node("a"), "again")).rejects.toThrow(/revoked/);
  });
});

describe("joining", () => {
  test("says what the server peer published, and nothing before it did", async () => {
    expect(await joinInfo()).toEqual({ server: null, catalog: null, relay: null });
    await pg.query("INSERT INTO vault_config (key, value) VALUES ('server', 's'), ('catalog', 'docticket'), ('relay', 'https://api.maia.city')");
    expect(await joinInfo()).toEqual({ server: "s", catalog: "docticket", relay: "https://api.maia.city" });
  });

  test("the mirror lists files newest first, by kind and tag", async () => {
    await pg.query(
      `INSERT INTO vault_files (hash, size, mime, kind, tags, added) VALUES
        ($1, 10, 'video/mp4', 'video', '{"Day 01"}', now() - interval '1 day'), ($2, 20, 'image/jpeg', 'image', '{}', now())`,
      [node("b"), node("c")],
    );
    expect((await listVaultFiles()).map((f) => f.hash)).toEqual([node("c"), node("b")]);
    expect((await listVaultFiles({ kind: "video" })).map((f) => f.size)).toEqual([10]);
    expect((await listVaultFiles({ tag: "Day 01" })).map((f) => f.hash)).toEqual([node("b")]);
  });
});
