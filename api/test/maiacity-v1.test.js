// MaiaCity V1's rules (game/maiacity-v1/engine.js): HEARTS, the 50/50 MIND split, the pool, rent and the melt.
import { expect, test } from "bun:test";
import { DAY_MS, act, advance, ledgerOf, newGame, price, supply } from "../../game/maiacity-v1/engine.js";

const T0 = Date.UTC(2026, 9, 13);

test("a mint gives 24 HEARTS once a day", () => {
  let s = act(newGame(T0), "A", { type: "mint" }, T0 + 1000);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(24, 4);
  expect(() => act(s, "A", { type: "mint" }, T0 + 2000)).toThrow();
  s = act(s, "A", { type: "mint" }, T0 + DAY_MS + 500);
  expect(s.players.A.wallet.HEARTS).toBeGreaterThan(47.8);
});

test("investing splits 50/50, and 5 % of the treasury half goes to the pool", () => {
  let s = act(newGame(T0), "A", { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 10 }, T0);
  expect(s.players.A.wallet.MAIA).toBeCloseTo(5, 6);
  expect(s.coops.maia.treasury.MAIA).toBeCloseTo(4.75, 6);
  expect(s.pool.MAIA).toBeCloseTo(0.25, 6);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(14, 6);
  expect(price(s)).toBe(null);
});

test("HEARTS not minted again within 24 h expire", () => {
  let s = act(newGame(T0), "A", { type: "mint" }, T0);
  s = advance(s, T0 + DAY_MS + 5);
  expect(s.players.A.wallet.HEARTS).toBe(0);
  expect(ledgerOf(s, "player:A").some((e) => e.kind === "expired")).toBe(true);
});

test("a virtual year melts every balance by 7 %", () => {
  let s = act(newGame(T0, { tentRent: 0, hexRent: 0 }), "A", { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 24 }, T0);
  s = advance(s, T0 + 12 * DAY_MS);
  expect(s.players.A.wallet.MAIA).toBeCloseTo(12 * 0.93, 6);
  expect(supply(s).MAIA).toBeCloseTo(24 * 0.93, 6);
});

test("rent: the players pay the tent in VillageMIND, the Settlement COOP pays the hex in MaiaMIND through the pool", () => {
  let s = newGame(T0, { demurrage: 0 });
  for (const seat of ["A", "B"]) s = act(s, seat, { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "village", amount: 24 }, T0);
  s = act(s, "B", { type: "invest", coop: "maia", amount: 24 }, T0);
  s = act(s, "B", { type: "swap", token: "MAIA", amount: 0.01 }, T0);
  s = advance(s, T0 + DAY_MS);
  // A paid 10 of 12 VillageMIND; B had none and swapped MaiaMIND, then owes the rest
  expect(s.players.A.wallet.VILLAGE).toBeCloseTo(2, 6);
  expect(s.players.B.arrears).toBeGreaterThan(0);
  expect(ledgerOf(s, "coop:village").some((e) => e.kind === "rent" && e.to === "coop:maia")).toBe(true);
  // nothing is made or lost by rent and swaps: supply is unchanged without the melt
  expect(supply(s).MAIA + supply(s).VILLAGE).toBeCloseTo(48, 6);
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
  let s = await move({ id: "sam" }, false, "A", { type: "mint" }, T0 + 10);
  expect(s.players.A.name).toBe("Samuel");
  await expect(move({ id: "sam" }, false, "B", { type: "mint" }, T0 + 10)).rejects.toThrow();
  s = await move({ id: "sam" }, true, "B", { type: "mint" }, T0 + 10);
  expect(s.players.B.wallet.HEARTS).toBeCloseTo(24, 6);
  s = await getGame(T0 + 3 * DAY_MS);
  expect(s.month).toBe(3);
  s = await resetGame(T0 + 3 * DAY_MS);
  expect(s.month).toBe(0);
  expect(s.players.B.founder).toBe("bob");
});
