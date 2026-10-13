// MaiaCity V1's rules (game/maiacity-v1/engine.js): HEARTS, the 50/50 MIND split, the pool, rent and the melt.
import { expect, test } from "bun:test";
import { DAY_MS, act, advance, invariant, ledgerOf, monthsAt, newGame, price, quote, supply, weights } from "../../game/maiacity-v1/engine.js";

const T0 = Date.UTC(2026, 9, 13);
/** a game whose players have a full day of HEARTS grown, ready to mint at T0 */
const grown = (s) => { for (const p of Object.values(s.players)) { p.lastMint = T0 - DAY_MS; p.starter = true; } return s; };

test("the first mint brings the 720 HEARTS starter pack; then HEARTS grow 24 a day, at most the last 24 h of growth", () => {
  let s = newGame(T0, { demurrage: 0 });
  s = act(s, "A", { type: "mint" }, T0 + 6 * 3600e3);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(726, 6);
  expect(s.players.A.starter).toBe(true);
  expect(() => act(s, "A", { type: "mint" }, T0 + 6 * 3600e3)).toThrow();
  s = act(s, "A", { type: "mint" }, T0 + 7 * 3600e3);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(727, 6);
  // three days away: only the last 24 h count, and the HEARTS held stay
  s = act(s, "A", { type: "mint" }, T0 + 7 * 3600e3 + 3 * DAY_MS);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(751, 6);
});

test("investing splits 50/50, and 5 % of the treasury half goes to the pool", () => {
  let s = act(newGame(T0), "A", { type: "mint" }, T0 + DAY_MS);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 10 }, T0 + DAY_MS);
  expect(s.players.A.wallet.MAIA).toBeCloseTo(5, 6);
  expect(s.coops.maia.treasury.MAIA).toBeCloseTo(4.75, 6);
  expect(s.pool.MAIA).toBeCloseTo(0.25, 6);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(734, 6);
  expect(price(s)).toBe(null);
});

test("a virtual year melts every balance by 7 %", () => {
  let s = act(grown(newGame(T0, { tentRent: 0, hexRent: 0 })), "A", { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 24 }, T0);
  s = advance(s, T0 + 13 * DAY_MS);
  expect(s.players.A.wallet.MAIA).toBeCloseTo(12 * 0.93, 6);
  expect(supply(s).MAIA).toBeCloseTo(24 * 0.93, 6);
});

test("rent: the players pay the tent in SettlementMIND, the Settlement COOP pays the hex in MaiaMIND through the pool", () => {
  let s = grown(newGame(T0, { demurrage: 0 }));
  for (const seat of ["A", "B"]) s = act(s, seat, { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "settlement", amount: 24 }, T0);
  s = act(s, "B", { type: "invest", coop: "maia", amount: 20 }, T0);
  s = act(s, "B", { type: "invest", coop: "village", amount: 4 }, T0);
  s = act(s, "B", { type: "swap", token: "MAIA", to: "VILLAGE", amount: 0.01 }, T0);
  s = advance(s, T0 + DAY_MS);
  // A paid 10 of 12 SettlementMIND; B had none and swapped other MINDs, then owes the rest
  expect(s.players.A.wallet.SETTLEMENT).toBeCloseTo(2, 6);
  expect(s.players.B.arrears).toBeGreaterThan(0);
  expect(ledgerOf(s, "player:B").some((e) => e.kind === "swap" && e.out.token === "SETTLEMENT")).toBe(true);
  expect(ledgerOf(s, "coop:settlement").some((e) => e.kind === "rent" && e.to === "coop:maia")).toBe(true);
  // nothing is made or lost by rent and swaps: supply is unchanged without the melt
  const all = supply(s);
  expect(all.MAIA + all.SETTLEMENT + all.VILLAGE).toBeCloseTo(48, 6);
});

test("a MIP needs two signatures and applies at once in the same game: settings and payouts to any wallet", () => {
  let s = grown(newGame(T0, { demurrage: 0 }));
  s = act(s, "A", { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 20 }, T0);
  expect(() => act(s, "A", { type: "settings", settings: { tentRent: 1 } }, T0)).toThrow();
  s = act(s, "A", { type: "propose", mip: { title: "Cheaper tent", description: "Rent down", settings: { tentRent: 3 }, payouts: [{ from: "coop:maia", to: "player:B", token: "MAIA", amount: 4 }] } }, T0);
  expect(s.mips[0].status).toBe("open");
  expect(s.settings.tentRent).toBe(10);
  expect(() => act(s, "A", { type: "sign", number: 1 }, T0)).toThrow();
  s = act(s, "B", { type: "sign", number: 1 }, T0);
  expect(s.mips[0].status).toBe("accepted");
  expect(s.settings.tentRent).toBe(3);
  expect(s.players.B.wallet.MAIA).toBeCloseTo(4, 6);
  expect(s.coops.maia.treasury.MAIA).toBeCloseTo(9.5 - 4, 6);
  // a payout larger than the treasury is refused; a rejected MIP changes nothing
  expect(() => act(s, "B", { type: "propose", mip: { title: "Too much", payouts: [{ from: "coop:maia", to: "player:B", token: "MAIA", amount: 100 }] } }, T0)).toThrow();
  s = act(s, "B", { type: "propose", mip: { title: "Pool share up", settings: { poolShare: 0.2 } } }, T0);
  s = act(s, "A", { type: "reject", number: 2, note: "no" }, T0);
  expect(s.mips[1].status).toBe("rejected");
  expect(s.settings.poolShare).toBe(0.05);
});

test("a MIP may change every setting and every COOP: the clock speed, the mint window, signatures, names and assets", () => {
  let s = newGame(T0, { demurrage: 0 });
  // 12 h a month from day 2: the clock keeps where it stood and runs twice as fast from then
  s = act(s, "A", { type: "propose", mip: { title: "Faster", settings: { hoursPerMonth: 12, mintWindowHours: 48 } } }, T0 + DAY_MS / 2);
  s = act(s, "B", { type: "sign", number: 1 }, T0 + DAY_MS / 2);
  s = advance(s, T0 + DAY_MS);
  expect(monthsAt(s, T0 + DAY_MS)).toBeCloseTo(1.5, 6);
  expect(s.month).toBe(1);
  s = act(s, "A", { type: "mint" }, T0 + 3 * DAY_MS);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(720 + 48, 6);
  // the Village COOP renamed, its assets rewritten; then one signature is enough
  s = act(s, "A", { type: "propose", mip: { title: "Village kit", coops: { village: { name: "Valley COOP", assets: [{ name: "The pickup", kind: "Vehicle" }, { name: "A tractor", kind: "Vehicle" }] } }, settings: { signatures: 1 } } }, T0 + 3 * DAY_MS);
  s = act(s, "B", { type: "sign", number: 2 }, T0 + 3 * DAY_MS);
  expect(s.coops.village.name).toBe("Valley COOP");
  expect(s.coops.village.assets.map((x) => x.id)).toEqual(["asset-1", "asset-2"]);
  s = act(s, "A", { type: "propose", mip: { title: "Cheap", settings: { tentRent: 1 } } }, T0 + 3 * DAY_MS);
  expect(s.mips[2].status).toBe("accepted");
  expect(() => act(s, "A", { type: "propose", mip: { title: "Bad", coops: { nowhere: { name: "x" } } } }, T0 + 3 * DAY_MS)).toThrow();
});

test("the pool is a Balancer weighted basket of all three MINDs: equal weights, the invariant never falls", () => {
  let s = grown(newGame(T0, { demurrage: 0, poolShare: 0.5 }));
  for (const seat of ["A", "B"]) s = act(s, seat, { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 14 }, T0);
  s = act(s, "A", { type: "invest", coop: "settlement", amount: 10 }, T0);
  s = act(s, "B", { type: "invest", coop: "village", amount: 16 }, T0);
  expect(weights(s)).toEqual({ MAIA: 1 / 3, SETTLEMENT: 1 / 3, VILLAGE: 1 / 3 });
  expect(price(s, "SETTLEMENT")).toBeCloseTo(3.5 / 2.5, 9);
  const v0 = invariant(s);
  // equal weights: Balancer's out-given-in is the pair's x·y = k, the fee taken from what goes in
  const q = quote(s, "VILLAGE", "SETTLEMENT", 1);
  expect(q).toBeCloseTo((2.5 * 0.997) / (4 + 0.997), 9);
  s = act(s, "B", { type: "swap", token: "VILLAGE", to: "SETTLEMENT", amount: 1 }, T0);
  expect(invariant(s)).toBeGreaterThan(v0);
  // weights a MIP may change: MaiaMIND at 1/2 makes it dearer against the others at once
  s = act(s, "A", { type: "propose", mip: { title: "Heavier MaiaMIND", settings: { weightMAIA: 2 } } }, T0);
  s = act(s, "B", { type: "sign", number: 1 }, T0);
  expect(weights(s).MAIA).toBeCloseTo(0.5, 9);
  const out = quote(s, "SETTLEMENT", "MAIA", 1);
  const bi = s.pool.SETTLEMENT, bo = s.pool.MAIA;
  expect(out).toBeCloseTo(bo * (1 - Math.pow(bi / (bi + 0.997), 0.25 / 0.5)), 9);
});

// the shared game in the database (PGlite): seats, moves, locks
import { PGlite } from "@electric-sql/pglite";
import { useDb } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { getGame, move, resetGame, takeSeat } from "../src/maiacity-v1.js";

test("two founders take the two seats and only move their own", async () => {
  const pg = new PGlite();
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  const wrap = (q) => ({ query: async (text, params = []) => { const r = await q.query(text, params); return { rows: r.rows, affectedRows: r.affectedRows ?? 0 }; } });
  useDb({ ...wrap(pg), exec: async (t) => void (await pg.exec(t)), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) });
  const g = await getGame(T0);
  expect(g.players.A.founder).toBe(null);
  await takeSeat({ id: "sam", name: "Samuel" }, "A", T0);
  await expect(takeSeat({ id: "bob", name: "Bob" }, "A", T0)).rejects.toThrow();
  await expect(takeSeat({ id: "sam", name: "Samuel" }, "B", T0)).rejects.toThrow();
  await takeSeat({ id: "bob", name: "Bob" }, "B", T0);
  let s = await move({ id: "sam" }, false, "A", { type: "mint" }, T0 + 3600e3);
  expect(s.players.A.name).toBe("Samuel");
  await expect(move({ id: "sam" }, false, "B", { type: "mint" }, T0 + 3600e3)).rejects.toThrow();
  s = await move({ id: "sam" }, true, "B", { type: "mint" }, T0 + 3600e3);
  expect(s.players.B.wallet.HEARTS).toBeCloseTo(721, 4);
  s = await getGame(T0 + 3 * DAY_MS);
  expect(s.month).toBe(3);
  s = await resetGame(T0 + 3 * DAY_MS);
  expect(s.month).toBe(0);
  expect(s.players.B.founder).toBe("bob");
});
