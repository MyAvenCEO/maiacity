// The money, end to end, against real Postgres semantics (PGlite in-process):
// mint the income, found a coop, invest, and check that hearts are never lost —
// they become maiaHEARTS in the treasury, one for one.
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { migrateLedger } from "../src/ledger/store";
import { account, balanceOf, claim, identityOf, totalSupply } from "../src/ledger/hearts";
import { coopDetail, coopIdentity, createCoop, invest } from "../src/ledger/coopstore";
import { ledgerView } from "../src/ledger/view";
import { CITY } from "../src/ledger/schema";
import { buildGlobe, FREQUENCY, LAND, WATER } from "../../game/globe";
import { decodeLand } from "../../game/map";
import { ONE } from "../../game/policy";
import { calendar, format, toDemurraged } from "../../game/time";
import land from "../../game/data/land.json";

const pg = new PGlite();
const spendable = (v: bigint) => toDemurraged(v, calendar().dayIndex);
const hearts = (n: number) => BigInt(n) * ONE;

let landTile = -1;
const A = "founder-a";
const B = "founder-b";

beforeAll(async () => {
  useDb(pg as unknown as Db);
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  await migrateLedger();
  await pg.query("INSERT INTO founders (id, name) VALUES ($1, 'Samuel'), ($2, 'Maia')", [A, B]);
  await pg.query("UPDATE founders SET role = 'admin' WHERE id = $1", [A]);
  const tiles = buildGlobe({ frequency: FREQUENCY, land: LAND, isLand: decodeLand(land as never) });
  landTile = tiles.findIndex((t) => !WATER.has(t.biome));
});

describe("the income", () => {
  test("the first mint carries the 500-heart founding stake", async () => {
    const { claimed } = await claim(A);
    expect(claimed).toBeGreaterThanOrEqual(hearts(500));
    const a = await account(A);
    expect(a.startingPending).toBe(false);
    expect(a.balance).toBeGreaterThanOrEqual(hearts(500));
    expect(a.token).toBe("Samuel♥");
  });

  test("renaming a citizen does not touch their money", async () => {
    const before = (await account(A)).balance;
    await pg.query("UPDATE founders SET name = 'avenSAMUEL' WHERE id = $1", [A]);
    const after = await account(A);
    expect(after.balance).toBe(before);
    expect(after.token).toBe("avenSAMUEL♥");
  });
});

describe("investing converts hearts into maiaHEARTS", () => {
  test("founding a coop: the stake leaves your hearts and lands in the treasury as maiaHEARTS", async () => {
    const own = identityOf(A);
    const before = await balanceOf(own, own);
    const coop = await createCoop(A, { name: "Solar", pitch: "Panels for every dome cell.", tile: landTile });

    const after = await balanceOf(own, own);
    const treasury = await balanceOf(CITY, coopIdentity("solar"));
    // One for one in the notes themselves: exactly the units that left came in.
    expect(before - after).toBe(treasury);
    // And in what a person sees: 500 in, 500 maiaHEARTS — to the last display unit.
    expect(spendable(treasury)).toBe(hearts(500));
    expect(spendable(before) - spendable(after) - hearts(500)).toBeLessThanOrEqual(1n);
    expect(coop.treasuryToken).toBe("maiaHEARTS");
    expect(coop.raisedLabel).toBe("500");
  });

  test("the investor receives every MIND — 500 hearts buy 11.5 solar☉ through milestones 1–6", async () => {
    const mine = spendable(await balanceOf(coopIdentity("solar"), identityOf(A)));
    // milestones 1–5 cost 290♥ for 8☉; the other 210♥ buy 3.5☉ at milestone 6's 60♥ each
    expect(format(mine)).toBe("11.50");
    const inTreasury = spendable(await balanceOf(coopIdentity("solar"), coopIdentity("solar")));
    expect(inTreasury).toBe(0n);
  });

  test("a second citizen invests 100 hearts: one for one into the treasury", async () => {
    await claim(B);
    const own = identityOf(B);
    const before = await balanceOf(own, own);
    const treasuryBefore = await balanceOf(CITY, coopIdentity("solar"));
    const coop = await invest(B, "solar", hearts(100));
    const after = await balanceOf(own, own);
    const treasuryAfter = await balanceOf(CITY, coopIdentity("solar"));

    expect(before - after).toBe(treasuryAfter - treasuryBefore);
    expect(spendable(treasuryAfter)).toBe(hearts(600));
    expect(coop.raisedLabel).toBe("600");
    expect(coop.backers).toBe(2);
    // 90♥ finish milestone 6 at 60 (1.5☉), 10♥ open milestone 7 at 70 (0.14☉)
    expect(format(spendable(await balanceOf(coopIdentity("solar"), own)))).toBe("1.64");
  });

  test("no heart is lost: maiaHEARTS in existence equal everything ever invested", async () => {
    const supply = spendable(await totalSupply(CITY));
    const detail = await coopDetail("solar", null);
    expect(supply).toBe(hearts(600));
    expect(detail.treasuryLabel).toBe("600");
  });

  test("investing more than you hold changes nothing — the transaction rolls back whole", async () => {
    await expect(invest(B, "solar", hearts(100_000))).rejects.toThrow(/Not enough/);
    const detail = await coopDetail("solar", B);
    expect(detail.raisedLabel).toBe("600");
    expect(spendable(await totalSupply(CITY))).toBe(hearts(600));
  });

  test("the ledger tells the investor what happened", async () => {
    const view = await ledgerView(B);
    const titles = view.transactions.map((t) => t.title);
    expect(titles).toContain("Minted your income");
    expect(titles.some((t) => t.startsWith("Invested in Solar — became maiaHEARTS"))).toBe(true);
    expect(titles).toContain("Received solar☉ for your investment");
    expect(view.holdings.map((h) => h.token)).toContain("solar☉");
  });
});
