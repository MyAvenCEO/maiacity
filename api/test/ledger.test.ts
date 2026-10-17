// The hearts, end to end, against real Postgres semantics (PGlite in-process):
// mint the income, rename the player, and read it back on their ledger.
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { migrateLedger } from "../src/ledger/store";
import { account, claim } from "../src/ledger/hearts";
import { ledgerView } from "../src/ledger/view";
import { ONE } from "../../game/policy";

const pg = new PGlite();
const hearts = (n: number) => BigInt(n) * ONE;

const A = "founder-a";

beforeAll(async () => {
  useDb(pg as unknown as Db);
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  await migrateLedger();
  await pg.query("INSERT INTO founders (id, name) VALUES ($1, 'Samuel')", [A]);
});

describe("the income", () => {
  test("the first mint carries the 62,500-heart starting stake", async () => {
    const { claimed } = await claim(A);
    expect(claimed).toBeGreaterThanOrEqual(hearts(62_500));
    const a = await account(A);
    expect(a.startingPending).toBe(false);
    expect(a.token).toBe("Samuel♥");
  });

  test("renaming a player does not touch their money", async () => {
    const before = (await account(A)).balance;
    await pg.query("UPDATE founders SET name = 'avenSAMUEL' WHERE id = $1", [A]);
    const after = await account(A);
    expect(after.balance).toBe(before);
    expect(after.token).toBe("avenSAMUEL♥");
  });

  test("the ledger tells the player what happened", async () => {
    const view = await ledgerView(A);
    expect(view.transactions.map((t) => t.title)).toContain("Minted your income");
  });
});
