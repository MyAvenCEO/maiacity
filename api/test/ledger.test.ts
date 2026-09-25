// The money, end to end, against real Postgres semantics (PGlite in-process):
// mint the income, found a city, join it, found and join settlements by invitation —
// and check that hearts are never lost: they become the city's HEARTS, one for one.
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { migrateLedger } from "../src/ledger/store";
import { account, balanceOf, claim, identityOf, totalSupply } from "../src/ledger/hearts";
import { acceptInvite, cityIdentity, cityOf, coopDetail, coopIdentity, createInvite, foundCity, foundSettlement, invest, inviteInfo, listCities, settlementOf } from "../src/ledger/coopstore";
import { buildable, cellKey, islandCells, islandSeed, settlementLevel } from "../../game/island/island";
import { housing, planFor } from "../../game/island/villages";
import { ledgerView } from "../src/ledger/view";
import { heartsIssuer } from "../src/ledger/schema";
import { buildGlobe, FREQUENCY, LAND, WATER } from "../../game/globe";
import { decodeLand } from "../../game/map";
import { ONE } from "../../game/policy";
import { calendar, format, toDemurraged } from "../../game/time";
import land from "../../game/data/land.json";

const pg = new PGlite();
const spendable = (v: bigint) => toDemurraged(v, calendar().dayIndex);
const hearts = (n: number) => BigInt(n) * ONE;
const maiaHEARTS = heartsIssuer("maia");
const near = (a: bigint, b: bigint) => (a > b ? a - b : b - a) <= 10n;
/** Six real hours of income: 180 hearts, minted. */
const topUp = async (id: string) => {
  await pg.query("UPDATE founders SET last_claim_at = now() - interval '6 hours' WHERE id = $1", [id]);
  await claim(id);
};

const landTiles: number[] = [];
/** Free land cells on Maia's island, from the same generator the API uses. */
const cellsOf = (tile: number) => [...islandCells(islandSeed(tile)).values()].filter(buildable).map(cellKey);

const A = "founder-a";
const B = "founder-b";
const C = "founder-c";

beforeAll(async () => {
  useDb(pg as unknown as Db);
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  await migrateLedger();
  await pg.query("INSERT INTO founders (id, name) VALUES ($1, 'Samuel'), ($2, 'Maia'), ($3, 'Rui')", [A, B, C]);
  const tiles = buildGlobe({ frequency: FREQUENCY, land: LAND, isLand: decodeLand(land as never) });
  tiles.forEach((t, i) => !WATER.has(t.biome) && landTiles.length < 3 && landTiles.push(i));
});

describe("the income", () => {
  test("the first mint carries the 30,000-heart starting stake", async () => {
    const { claimed } = await claim(A);
    expect(claimed).toBeGreaterThanOrEqual(hearts(30_000));
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
});

describe("a city unlocks a card, and citizenship is for good", () => {
  test("founding takes at least the 25,000-heart citizenship", async () => {
    await expect(foundCity(A, { name: "Maia", pitch: "A city of a million co-founders.", tile: landTiles[0], hearts: hearts(10_000) })).rejects.toThrow(/25,000/);
    expect(await cityOf(A)).toBeNull();
  });

  test("founding Maia: 25,000 personal hearts become 25,000 maiaHEARTS, and the founder receives maiaMINDS", async () => {
    const own = identityOf(A);
    const before = await balanceOf(own, own);
    const city = await foundCity(A, { name: "Maia", pitch: "A city of a million co-founders.", tile: landTiles[0], hearts: hearts(25_000) });
    const after = await balanceOf(own, own);
    const treasury = await balanceOf(maiaHEARTS, cityIdentity("maia"));

    // One for one in the notes themselves: exactly the units that left came in.
    expect(before - after).toBe(treasury);
    expect(spendable(treasury)).toBe(hearts(25_000));
    expect(city.kind).toBe("city");
    expect(city.heartsToken).toBe("maiaHEARTS");
    expect(city.mindToken).toBe("maiaMINDS");
    expect(city.citizens).toBe(1);
    expect(spendable(await balanceOf(cityIdentity("maia"), own))).toBeGreaterThan(0n);
    expect((await cityOf(A))?.slug).toBe("maia");
  });

  test("a citizen cannot found a second city", async () => {
    await expect(foundCity(A, { name: "Porto", pitch: "Another one.", tile: landTiles[1], hearts: hearts(25_000) })).rejects.toThrow(/already a citizen/);
  });

  test("joining takes the citizenship too, and then you live there", async () => {
    await claim(B);
    await expect(invest(B, "maia", hearts(10_000))).rejects.toThrow(/25,000/);
    const city = await invest(B, "maia", hearts(25_000));
    expect(city.citizens).toBe(2);
    expect(city.treasuryLabel).toBe("50,000");
    expect((await cityOf(B))?.slug).toBe("maia");
  });

  test("once a citizen, never another city's", async () => {
    await claim(C);
    await foundCity(C, { name: "Porto", pitch: "A harbour city.", tile: landTiles[1], hearts: hearts(25_000) });
    await expect(invest(B, "porto", hearts(25_000))).rejects.toThrow(/citizen of Maia/);
    await expect(invest(C, "maia", hearts(25_000))).rejects.toThrow(/citizen of Porto/);
  });

  test("a citizen may invest more into their own city, any amount", async () => {
    const city = await invest(A, "maia", hearts(100));
    expect(city.treasuryLabel).toBe("50,100");
  });
});

describe("the second step: a home in a settlement, founded or joined by invitation", () => {
  test("a player without a city cannot found a settlement", async () => {
    await pg.query("INSERT INTO founders (id, name) VALUES ('founder-d', 'Lea')");
    await claim("founder-d");
    await expect(foundSettlement("founder-d", { name: "Riverside", pitch: "Domes by the river.", cell: cellsOf(landTiles[0])[0], hearts: hearts(5_000) })).rejects.toThrow(/citizen of one first/);
  });

  test("a settlement stands on land of the city's island, and takes at least 5,000 hearts", async () => {
    const water = [...islandCells(islandSeed(landTiles[0])).values()].find((t) => !buildable(t))!;
    await expect(foundSettlement(A, { name: "Riverside", pitch: "Domes by the river.", cell: cellKey(water), hearts: hearts(5_000) })).rejects.toThrow(/on land/);
    await expect(foundSettlement(A, { name: "Riverside", pitch: "Domes by the river.", cell: cellsOf(landTiles[0])[0], hearts: hearts(1_000) })).rejects.toThrow(/5,000/);
  });

  test("founding Riverside: 5,000 hearts become maiaHEARTS in its treasury, riversideMINDS to the founder, and a home", async () => {
    await topUp(A);
    const s = await foundSettlement(A, { name: "Riverside", pitch: "Domes by the river.", cell: cellsOf(landTiles[0])[0], hearts: hearts(5_000) });
    expect(s.kind).toBe("settlement");
    expect(s.city).toEqual({ slug: "maia", name: "Maia" });
    expect(s.heartsToken).toBe("maiaHEARTS");
    expect(s.mindToken).toBe("riversideMINDS");
    expect(s.settlers).toBe(1);
    expect(s.level).toBe(1);
    expect(spendable(await balanceOf(maiaHEARTS, coopIdentity("riverside")))).toBe(hearts(5_000));
    expect((await settlementOf(A))?.slug).toBe("riverside");
    await expect(foundSettlement(A, { name: "Hilltop", pitch: "Another.", cell: cellsOf(landTiles[0])[1], hearts: hearts(5_000) })).rejects.toThrow(/already live/);
  });

  test("a cell holds one settlement", async () => {
    await expect(foundSettlement(B, { name: "Hilltop", pitch: "Domes on the hill.", cell: cellsOf(landTiles[0])[0], hearts: hearts(5_000) })).rejects.toThrow(/taken/);
  });

  test("joining is by invitation only", async () => {
    await expect(invest(B, "riverside", hearts(5_000))).rejects.toThrow(/by invitation/);
    await expect(createInvite(B, "riverside")).rejects.toThrow(/Only its settlers/);
  });

  test("a settler's invite admits one citizen of the city, once", async () => {
    const invite = await createInvite(A, "riverside");
    expect(invite.usable).toBe(true);
    expect(invite.invitedBy).toBe("avenSAMUEL");
    await expect(acceptInvite(C, invite.token, hearts(5_000))).rejects.toThrow(/citizen of Porto/);
    await expect(acceptInvite(B, invite.token, hearts(1_000))).rejects.toThrow(/5,000/);
    const s = await acceptInvite(B, invite.token, hearts(5_000));
    expect(s.settlers).toBe(2);
    expect(s.treasuryLabel).toBe("10,000");
    expect((await settlementOf(B))?.slug).toBe("riverside");
    await expect(acceptInvite("founder-d", invite.token, hearts(5_000))).rejects.toThrow(/already been used/);
    expect((await inviteInfo(invite.token)).usable).toBe(false);
  });

  test("an invite for someone without citizenship asks them to join the city first", async () => {
    const invite = await createInvite(A, "riverside");
    await expect(acceptInvite("founder-d", invite.token, hearts(5_000))).rejects.toThrow(/First become a citizen of Maia/);
  });

  test("an expired invite admits nobody", async () => {
    const old = new Date(Date.now() - 8 * 86_400_000);
    const invite = await createInvite(A, "riverside", old);
    expect((await inviteInfo(invite.token)).usable).toBe(false);
    await invest("founder-d", "maia", hearts(25_000));
    await expect(acceptInvite("founder-d", invite.token, hearts(5_000))).rejects.toThrow(/expired/);
  });

  test("settlers may invest more into their own settlement, nobody else", async () => {
    await topUp(B);
    expect((await invest(B, "riverside", hearts(100))).treasuryLabel).toBe("10,100");
    await expect(invest("founder-d", "riverside", hearts(100))).rejects.toThrow(/by invitation/);
  });

  test("no heart is lost: maiaHEARTS in existence equal everything invested in Maia", async () => {
    // 25,000 + 25,000 + 100 (city) + 25,000 (Lea) + 5,000 + 5,000 + 100 (Riverside)
    expect(near(spendable(await totalSupply(maiaHEARTS)), hearts(85_200))).toBe(true);
  });

  test("investing more than you hold changes nothing — the transaction rolls back whole", async () => {
    await expect(invest(B, "riverside", hearts(1_000_000))).rejects.toThrow(/Not enough/);
    expect((await coopDetail("riverside", B)).raisedLabel).toBe("10,100");
    expect(near(spendable(await totalSupply(maiaHEARTS)), hearts(85_200))).toBe(true);
  });

  test("the planet lists cities with their island and settlements", async () => {
    const cities = await listCities();
    const maia = cities.find((c) => c.slug === "maia")!;
    expect(maia.citizens).toBe(3);
    expect(maia.island).toBe(islandSeed(landTiles[0]));
    expect(maia.settlements.map((c) => [c.slug, c.settlers, c.cell])).toEqual([["riverside", 2, cellsOf(landTiles[0])[0]]]);
  });

  test("a settlement levels up on the Fibonacci numbers, up to 233", () => {
    expect([1, 2, 3, 4, 5, 8, 12, 13, 21, 34, 55, 88, 89, 143, 144, 232, 233].map(settlementLevel)).toEqual([1, 2, 3, 3, 4, 5, 5, 6, 7, 8, 9, 9, 10, 10, 11, 11, 12]);
  });

  test("every headcount has a bed: the rings, then the master dome for the surplus", () => {
    for (let n = 1; n <= 233; n++) {
      const h = housing(n);
      expect(h.ring + h.master).toBe(n);
      expect(h.master === 0 || planFor(h.level).master).toBe(true);
    }
    expect(housing(233)).toEqual({ level: 12, ring: 216, master: 17 });
  });

  test("the ledger tells the investor what happened", async () => {
    const view = await ledgerView(B);
    const titles = view.transactions.map((t) => t.title);
    expect(titles).toContain("Minted your income");
    expect(titles).toContain("Invested in Maia — became maiaHEARTS");
    expect(titles).toContain("Invested in Riverside — became maiaHEARTS");
    expect(titles).toContain("Received maiaMINDS for your investment");
    expect(view.holdings.map((h) => h.token)).toEqual(expect.arrayContaining(["maiaMINDS", "riversideMINDS"]));
  });
});
