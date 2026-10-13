// MaiaCity V1's rules (game/maiacity-v1/engine.js): HEARTS, the 50/50 MIND split, the pool, rent and the melt.
import { expect, test } from "bun:test";
import { DAY_MS, act, advance, ledgerOf, newGame, price, supply } from "../../game/maiacity-v1/engine.js";

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
