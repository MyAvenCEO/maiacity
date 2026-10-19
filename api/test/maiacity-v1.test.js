// MaiaCity V1's rules (game/maiacity-v1/engine.js): HEARTS, the 50/50 MIND split, the pool, rent and the melt.
import { expect, test } from "bun:test";
import { DAY_MS, SEEDLINGS, act, advance, describe, dividendsOf, equilibriumOf, heartsValue, invariant, ledgerOf, monthsAt, newGame, payDaysOf, price, quote, rents, supply, weights } from "../../game/maiacity-v1/engine.js";

const T0 = Date.UTC(2026, 9, 13);
/** the starter pack: the 7 % equilibrium, rounded */
const STARTER = 124800;
/** a game whose players have a full day of HEARTS grown, ready to mint at T0 */
/** one game day: a real day is a game month of 28 */
const GAME_DAY = DAY_MS / 28;
/** a game started one game day before T0, its players' starter packs had: 24 HEARTS each ready to mint at T0 */
const grown = (s) => { s.started = s.t = T0 - GAME_DAY; for (const p of Object.values(s.players)) { p.lastMint = T0 - GAME_DAY; p.starter = true; } return s; };

test("the first mint brings the 124,800 HEARTS starter pack (the 7 % equilibrium); then HEARTS grow 24 a game day on the game clock, at most the last 24 real hours of growth", () => {
  const H = GAME_DAY / 24;
  let s = newGame(T0, { demurrage: 0 });
  s = act(s, "A", { type: "mint" }, T0 + 6 * H);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(STARTER + 6, 6);
  expect(s.players.A.starter).toBe(true);
  expect(() => act(s, "A", { type: "mint" }, T0 + 6 * H)).toThrow();
  s = act(s, "A", { type: "mint" }, T0 + 7 * H);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(STARTER + 7, 6);
  // three real days away: only the last 24 real hours count (a game month: 28 × 24), and the HEARTS held stay
  s = act(s, "A", { type: "mint" }, T0 + 7 * H + 3 * DAY_MS);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(STARTER + 7 + 672, 6);
});

test("investing splits each HEART: 0.5 to the investor, 0.4 to the treasury, 0.1 to the city pool", () => {
  let s = act(newGame(T0), "A", { type: "mint" }, T0 + DAY_MS);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 10 }, T0 + DAY_MS);
  expect(s.players.A.wallet.MAIA).toBeCloseTo(5, 6);
  expect(s.coops.maia.treasury.MAIA).toBeCloseTo(4, 6);
  expect(s.pool.MAIA).toBeCloseTo(1, 6);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(STARTER + 672 - 10, 6);
  expect(price(s)).toBe(null);
});

test("a virtual year melts every balance at the continuous 7 % rate (e^-0.07, 6.76 % lost)", () => {
  let s = act(grown(newGame(T0, { homeRent: 0, hexRent: 0 })), "A", { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 24 }, T0);
  s = advance(s, T0 + 13 * DAY_MS);
  expect(s.players.A.wallet.MAIA).toBeCloseTo(12 * Math.exp(-0.07), 6);
  expect(supply(s).MAIA).toBeCloseTo(24 * Math.exp(-0.07), 6);
});

test("rent down the chain: the players pay the Tribe COOP, it pays the Village COOP, which pays the MaiaCity COOP, through the pool", () => {
  let s = grown(newGame(T0, { demurrage: 0, dividendShare: 0, homeRent: 2.5 }));
  for (const seat of ["A", "B"]) s = act(s, seat, { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "tribe", amount: 24 }, T0);
  s = act(s, "B", { type: "invest", coop: "maia", amount: 20 }, T0);
  s = act(s, "B", { type: "invest", coop: "village", amount: 4 }, T0);
  s = act(s, "B", { type: "swap", token: "MAIA", to: "VILLAGE", amount: 0.01 }, T0);
  s = advance(s, T0 + DAY_MS);
  // A paid 10 of 12 tribeMIND; B had none and swapped other MINDs, then owes the rest
  expect(s.players.A.wallet.TRIBE).toBeCloseTo(2, 6);
  expect(s.players.B.arrears).toBeGreaterThan(0);
  expect(ledgerOf(s, "player:B").some((e) => e.kind === "swap" && e.out.token === "TRIBE")).toBe(true);
  expect(ledgerOf(s, "coop:tribe").some((e) => e.kind === "rent" && e.to === "coop:village")).toBe(true);
  expect(ledgerOf(s, "coop:village").some((e) => e.kind === "rent" && e.to === "coop:maia")).toBe(true);
  expect(ledgerOf(s, "coop:tribe").some((e) => e.kind === "rent" && e.to === "coop:maia")).toBe(false);
  // nothing is made or lost by rent and swaps: supply is unchanged without the melt
  const all = supply(s);
  expect(all.MAIA + all.TRIBE + all.VILLAGE).toBeCloseTo(48, 6);
});

test("a MIP needs two signatures and applies at once in the same game: settings and payouts to any wallet", () => {
  let s = grown(newGame(T0, { demurrage: 0, homeRent: 2.5 }));
  s = act(s, "A", { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 20 }, T0);
  expect(() => act(s, "A", { type: "settings", settings: { homeRent: 1 } }, T0)).toThrow();
  s = act(s, "A", { type: "propose", mip: { title: "Cheaper tent", description: "Rent down", settings: { homeRent: 0.75 }, payouts: [{ from: "coop:maia", to: "player:B", token: "MAIA", amount: 4 }] } }, T0);
  expect(s.mips[0].status).toBe("open");
  expect(s.settings.homeRent).toBe(2.5);
  expect(() => act(s, "A", { type: "sign", number: 1 }, T0)).toThrow();
  s = act(s, "B", { type: "sign", number: 1 }, T0);
  expect(s.mips[0].status).toBe("accepted");
  expect(s.settings.homeRent).toBe(0.75);
  expect(s.players.B.wallet.MAIA).toBeCloseTo(4, 6);
  expect(s.coops.maia.treasury.MAIA).toBeCloseTo(8 - 4, 6);
  // a payout larger than the treasury is refused; a rejected MIP changes nothing
  expect(() => act(s, "B", { type: "propose", mip: { title: "Too much", payouts: [{ from: "coop:maia", to: "player:B", token: "MAIA", amount: 100 }] } }, T0)).toThrow();
  s = act(s, "B", { type: "propose", mip: { title: "Pool share up", settings: { poolShare: 0.2 } } }, T0);
  s = act(s, "A", { type: "reject", number: 2, note: "no" }, T0);
  expect(s.mips[1].status).toBe("rejected");
  expect(s.settings.poolShare).toBe(0.1);
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
  // the 48 h window at 12 h a month: 4 game months of 28 days
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(STARTER + 4 * 28 * 24, 6);
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
  let s = grown(newGame(T0, { demurrage: 0, poolShare: 0.25 }));
  for (const seat of ["A", "B"]) s = act(s, seat, { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 14 }, T0);
  s = act(s, "A", { type: "invest", coop: "tribe", amount: 10 }, T0);
  s = act(s, "B", { type: "invest", coop: "village", amount: 16 }, T0);
  expect(weights(s)).toEqual({ MAIA: 1 / 3, TRIBE: 1 / 3, VILLAGE: 1 / 3 });
  expect(price(s, "TRIBE")).toBeCloseTo(3.5 / 2.5, 9);
  const v0 = invariant(s);
  // equal weights: Balancer's out-given-in is the pair's x·y = k, the fee taken from what goes in
  const q = quote(s, "VILLAGE", "TRIBE", 1);
  expect(q).toBeCloseTo((2.5 * 0.997) / (4 + 0.997), 9);
  s = act(s, "B", { type: "swap", token: "VILLAGE", to: "TRIBE", amount: 1 }, T0);
  expect(invariant(s)).toBeGreaterThan(v0);
  // weights a MIP may change: maiaMIND at 1/2 makes it dearer against the others at once
  s = act(s, "A", { type: "propose", mip: { title: "Heavier maiaMIND", settings: { weightMAIA: 2 } } }, T0);
  s = act(s, "B", { type: "sign", number: 1 }, T0);
  expect(weights(s).MAIA).toBeCloseTo(0.5, 9);
  const out = quote(s, "TRIBE", "MAIA", 1);
  const bi = s.pool.TRIBE, bo = s.pool.MAIA;
  expect(out).toBeCloseTo(bo * (1 - Math.pow(bi / (bi + 0.997), 0.25 / 0.5)), 9);
});

test("rent is paid on every weekly pay day, each a week's price, swapping on its own", () => {
  let s = grown(newGame(T0, { demurrage: 0, dividendShare: 0, homeRent: 2.5 }));
  s = act(s, "A", { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "tribe", amount: 24 }, T0);
  // one game week (a quarter of a real day): one pay day, the week's 2.5
  s = advance(s, T0 + DAY_MS / 4);
  expect(s.week).toBe(1);
  expect(s.month).toBe(0);
  expect(s.players.A.wallet.TRIBE).toBeCloseTo(12 - 2.5, 6);
  const days = ledgerOf(s, "player:A").filter((e) => e.kind === "rent");
  expect(days.length).toBe(1);
  expect(days[0].note).toContain("week 1");
  s = advance(s, T0 + DAY_MS);
  expect(s.week).toBe(4);
  expect(s.month).toBe(1);
  expect(s.players.A.wallet.TRIBE).toBeCloseTo(2, 6);
});

test("Law 5: 20 % of every sale goes at once to the COOP's MIND holders, pro rata, in its own MIND", () => {
  let s = grown(newGame(T0, { demurrage: 0, homeRent: 2.5, hexRent: 0, poolShare: 0 }));
  for (const seat of ["A", "B"]) s = act(s, seat, { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "tribe", amount: 24 }, T0);
  s = act(s, "B", { type: "invest", coop: "tribe", amount: 8 }, T0);
  // A holds 12 and B 4 tribeMIND; one pay day: each pays 2.5, the COOP passes 20 % of each on
  s = advance(s, T0 + DAY_MS / 4);
  const pot = 0.2 * 5;
  // before the dividends A held 9.5 and B 1.5 (A pays first, then the first dividend lands, then B pays)
  expect(s.players.A.wallet.TRIBE + s.players.B.wallet.TRIBE).toBeCloseTo(16 - 5 + pot, 6);
  expect(s.coops.tribe.treasury.TRIBE).toBeCloseTo(16 + 5 - pot, 6);
  expect(ledgerOf(s, "player:A").filter((e) => e.kind === "dividend").length).toBe(2);
  expect(supply(s).TRIBE).toBeCloseTo(32, 6);
});

test("the Tribe COOP rents the pickup, powercube, battery pack and solar panel from the Village COOP, a week in villageMIND", () => {
  let s = grown(newGame(T0, { demurrage: 0, homeRent: 0, hexRent: 0, hexSubRent: 0, poolShare: 0 }));
  s.coops.tribe.treasury.VILLAGE = 300;
  // one pay day: 100 + 50 + 50 + 50; the Tribe COOP is the only villageMIND holder, so the 20 % comes back to it
  s = advance(s, T0 + DAY_MS / 4);
  expect(s.coops.village.treasury.VILLAGE).toBeCloseTo(250 * 0.8, 6);
  expect(s.coops.tribe.treasury.VILLAGE).toBeCloseTo(300 - 250 * 0.8, 6);
  expect(ledgerOf(s, "coop:village").filter((e) => e.kind === "rent" && e.to === "coop:village").map((e) => e.note.split(",")[0]).sort()).toEqual(["battery pack rent", "pickup rent", "powercube rent", "solar panel rent"]);
  // with nothing to pay with, each rent is owed on its own: the Tribe COOP's machines, the Village COOP's hex
  let t = grown(newGame(T0, { demurrage: 0, homeRent: 0, hexSubRent: 0 }));
  t = advance(t, T0 + DAY_MS / 4);
  expect(t.coops.tribe.owed).toEqual({ pickup: 100, powercube: 50, battery: 50, solar: 50 });
  expect(t.coops.village.owed).toEqual({ hex: 100 });
});

test("a game from before the weekly prices takes them, its old monthly rents and debts gone", () => {
  let s = grown(newGame(T0));
  delete s.rentsWeekly;
  Object.assign(s.settings, { tentRent: 10, hexRent: 10, pickupRent: 4, powercubeRent: 3, batteryRent: 3 });
  delete s.settings.homeRent;
  delete s.settings.solarRent;
  s.players.A.arrears = 7;
  s.coops.tribe.arrears = 2;
  s = advance(s, T0);
  expect(s.settings).toMatchObject({ homeRent: 100, tentRent: 10, hexRent: 100, pickupRent: 100, powercubeRent: 50, batteryRent: 50, solarRent: 50 });
  expect(s.players.A.arrears).toBe(0);
  expect(s.coops.tribe.arrears).toBe(0);
});

test("the ledger's rents in and out, the dividends to expect, and what each pay day actually moved", () => {
  let s = grown(newGame(T0, { demurrage: 0, poolShare: 0, homeRent: 2.5 }));
  for (const seat of ["A", "B"]) s = act(s, seat, { type: "mint" }, T0);
  s = act(s, "A", { type: "invest", coop: "tribe", amount: 20 }, T0);
  s = act(s, "B", { type: "invest", coop: "tribe", amount: 20 }, T0);
  expect(rents(s).filter((r) => r.from === "coop:tribe").map((r) => r.what)).toEqual(["Pickup rent", "Powercube rent", "Battery pack rent", "Solar panel rent", "Hex rent"]);
  expect(rents(s).filter((r) => r.from === "coop:village").map((r) => [r.what, r.to, r.weekly])).toEqual([["Hex rent", "coop:maia", 100]]);
  expect(rents(s).filter((r) => r.to === "coop:tribe").map((r) => r.weekly)).toEqual([2.5, 2.5]);
  // A holds half the tribeMIND outside its treasury: half of 20 % of the 5 home rent a pay day
  expect(dividendsOf(s, "player:A").reduce((a, r) => a + r.weekly, 0)).toBeCloseTo(0.5, 6);
  s = advance(s, T0 + DAY_MS / 2);
  const days = payDaysOf(s, "player:A");
  expect(days.map((d) => d.week)).toEqual([2, 1]);
  expect(days[0].flows.TRIBE.out).toBeCloseTo(2.5, 6);
  expect(days[0].flows.TRIBE.in).toBeGreaterThan(0.4);
});

// the shared game in the database (PGlite): seats, moves, locks
import { PGlite } from "@electric-sql/pglite";
import { useDb } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { getGame, move, takeSeat } from "../src/maiacity-v1.js";

test("the first two founders to sign in take seat A and seat B; each moves only their own, an admin too", async () => {
  const pg = new PGlite();
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  const wrap = (q) => ({ query: async (text, params = []) => { const r = await q.query(text, params); return { rows: r.rows, affectedRows: r.affectedRows ?? 0 }; } });
  useDb({ ...wrap(pg), exec: async (t) => void (await pg.exec(t)), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) });
  let g = await getGame(null, T0);
  expect(g.players.A.founder).toBe(null);
  g = await getGame({ id: "sam", name: "Samuel" }, T0);
  expect([g.players.A.founder, g.players.A.name]).toEqual(["sam", "Samuel"]);
  g = await getGame({ id: "sam", name: "Samuel" }, T0);
  expect(g.players.B.founder).toBe(null);
  g = await getGame({ id: "bob", name: "Bob" }, T0);
  expect([g.players.B.founder, g.players.B.name]).toEqual(["bob", "Bob"]);
  await expect(takeSeat({ id: "eve", name: "Eve" }, "A", T0)).rejects.toThrow(/taken/);
  let s = await move({ id: "sam" }, false, "B", { type: "mint" }, T0 + 3600e3);
  // the seat asked for does not matter: a founder always moves for their own
  expect(s.players.A.wallet.HEARTS).toBeGreaterThan(0);
  expect(s.players.B.wallet.HEARTS).toBe(0);
  await expect(move({ id: "eve" }, true, "B", { type: "mint" }, T0 + 3600e3)).rejects.toThrow(/no seat/);
  s = await move({ id: "bob" }, false, "", { type: "mint" }, T0 + 3600e3);
  // a real hour is 28/24 game days: 28 HEARTS
  expect(s.players.B.wallet.HEARTS).toBeCloseTo(STARTER + 28, 4);
  s = await getGame(null, T0 + 3 * DAY_MS);
  expect(s.month).toBe(3);
  // a game kept by another engine version is never started again: it is refused, and stays as it was
  await pg.query("UPDATE v1_games SET state = jsonb_set(state, '{version}', '1'::jsonb)");
  await expect(getGame(null, T0 + 3 * DAY_MS)).rejects.toThrow(/waits, untouched, for a migration/);
  const kept = (await pg.query("SELECT state FROM v1_games")).rows[0].state;
  expect([kept.month, kept.players.B.founder]).toEqual([3, "bob"]);
});

test("a MIP brings a screen (a view card) with its signatures; it changes nothing of the play", async () => {
  const { viewsOf, defaultViews } = await import("../../game/maiacity-v1/views.js");
  let s = newGame(T0);
  expect(viewsOf(s).map((v) => v.id)).toEqual(["view-holders"]);
  const screen = { id: "view-rents", kind: "view", name: "Rents", code: "<p>rents</p>", data: { height: 9999 } };
  expect(() => act(s, "A", { type: "propose", mip: { title: "Bad", views: [{ ...screen, data: { libs: ["evil"] } }] } }, T0)).toThrow(/no library/);
  s = act(s, "A", { type: "propose", mip: { title: "A rents screen", views: [screen, { ...defaultViews()[0], name: "Holders 2" }] } }, T0);
  const before = JSON.stringify({ players: s.players, coops: s.coops, pool: s.pool, settings: s.settings });
  expect(s.views ?? []).toEqual([]);
  s = act(s, "B", { type: "sign", number: 1 }, T0);
  expect(s.mips[0].status).toBe("accepted");
  expect(viewsOf(s).map((v) => v.name)).toEqual(["Holders 2", "Rents"]);
  expect(s.views.find((v) => v.id === "view-rents").data.height).toBe(1200);
  expect(JSON.stringify({ players: s.players, coops: s.coops, pool: s.pool, settings: s.settings })).toBe(before);
  s = act(s, "A", { type: "propose", mip: { title: "No rents screen", removeViews: ["view-rents"] } }, T0);
  s = act(s, "B", { type: "sign", number: 2 }, T0);
  expect(viewsOf(s).map((v) => v.id)).toEqual(["view-holders"]);
});

test("a MIP stands a screen in one of the page's panels (a slot); an unknown slot is refused", async () => {
  const { slotsOf } = await import("../../game/maiacity-v1/views.js");
  let s = newGame(T0);
  const ledger = { id: "view-ledger", kind: "view", name: "Ledger 2", code: "<p>ledger</p>", data: { slot: "ledger" } };
  expect(() => act(s, "A", { type: "propose", mip: { title: "Bad", views: [{ ...ledger, data: { slot: "map" } }] } }, T0)).toThrow(/slot is one of/);
  s = act(s, "A", { type: "propose", mip: { title: "A new ledger", views: [ledger] } }, T0);
  expect(describe(s, s.mips[0])).toMatch(/new screen Ledger 2 in the Ledger/);
  s = act(s, "B", { type: "sign", number: 1 }, T0);
  expect(Object.keys(slotsOf(s))).toEqual(["ledger"]);
  expect(slotsOf(s).ledger.name).toBe("Ledger 2");
});

test("each newcomer marks a spot outside the core, picks a seed from the backpack and plants it: their first tree, named after them", () => {
  let s = newGame(T0);
  s.players.A.name = "Samuel";
  expect(SEEDLINGS.map((x) => x.id)).toEqual(["apple", "pear", "cherry", "plum", "apricot", "quince", "mulberry", "walnut", "chestnut", "hazel"]);
  expect(() => act(s, "A", { type: "plant" }, T0)).toThrow(/Mark where/);
  expect(() => act(s, "A", { type: "mark", x: 5, z: 3 }, T0)).toThrow(/Not in the middle/);
  expect(() => act(s, "A", { type: "mark", x: 90, z: 60 }, T0)).toThrow(/beyond your hex/);
  expect(() => act(s, "A", { type: "mark" }, T0)).toThrow(/Mark a place/);
  s = act(s, "A", { type: "mark", x: 30.123, z: -4 }, T0);
  expect(s.players.A.spot).toEqual({ x: 30.12, z: -4 });
  expect(() => act(s, "A", { type: "plant" }, T0)).toThrow(/Pick a seed/);
  expect(() => act(s, "A", { type: "seedling", plant: "mango" }, T0)).toThrow(/backpack/);
  s = act(s, "A", { type: "seedling", plant: "hazel" }, T0);
  s = act(s, "A", { type: "seedling", plant: "apple" }, T0 + 1);
  s = act(s, "A", { type: "plant", v: 2 }, T0 + DAY_MS);
  const m = monthsAt(s, T0 + DAY_MS);
  expect(s.players.A.tree).toEqual({ plant: "apple", v: 2, name: "Samuel", at: T0 + DAY_MS, months: m, x: 30.12, z: -4, grown: 0, watered: Math.floor(m) });
  expect(s.players.A.tree.months).toBeCloseTo(1, 6);
  expect(() => act(s, "A", { type: "plant" }, T0 + DAY_MS)).toThrow();
  expect(() => act(s, "A", { type: "seedling", plant: "pear" }, T0 + DAY_MS)).toThrow();
  expect(() => act(s, "A", { type: "mark", x: 40, z: 0 }, T0 + DAY_MS)).toThrow(/already planted/);
  expect(() => act(s, "B", { type: "mark", x: 31, z: -3 }, T0)).toThrow(/Too close/);
  s = act(s, "B", { type: "mark", x: -30, z: 10 }, T0);
  expect(s.players.B.tree).toBeUndefined();
});

test("a first tree grows one game month for each watering, once a game month; a month without water, it waits", () => {
  let s = newGame(T0);
  expect(() => act(s, "A", { type: "water" }, T0)).toThrow(/Plant your first tree/);
  s = act(s, "A", { type: "mark", x: 0, z: 40 }, T0);
  s = act(s, "A", { type: "seedling", plant: "pear" }, T0);
  s = act(s, "A", { type: "plant", v: 1 }, T0 + DAY_MS / 2);
  expect(s.players.A.tree.grown).toBe(0);
  // planted and watered with the bottle this month: the next watering is in the next game month
  expect(() => act(s, "A", { type: "water" }, T0 + DAY_MS * 0.9)).toThrow(/Come back tomorrow/);
  s = act(s, "A", { type: "water" }, T0 + DAY_MS * 1.1);
  expect(s.players.A.tree.grown).toBe(1);
  expect(() => act(s, "A", { type: "water" }, T0 + DAY_MS * 1.9)).toThrow(/Come back tomorrow/);
  // two days away: one watering on return, no catching up
  s = act(s, "A", { type: "water" }, T0 + DAY_MS * 4.2);
  expect(s.players.A.tree.grown).toBe(2);
  expect(() => act(s, "A", { type: "water" }, T0 + DAY_MS * 4.5)).toThrow(/Come back tomorrow/);
  expect(s.players.B.tree).toBeUndefined();
});

test("HEARTS values: every MIND counts 1 HEART till trades move the pool, whatever went into each COOP", () => {
  let s = newGame(T0);
  s = act(s, "A", { type: "mint" }, T0 + 1);
  s = act(s, "A", { type: "invest", coop: "maia", amount: 5000 }, T0 + 2);
  s = act(s, "A", { type: "invest", coop: "village", amount: 2000 }, T0 + 3);
  s = act(s, "A", { type: "invest", coop: "tribe", amount: 1000 }, T0 + 4);
  const v = heartsValue(s);
  for (const t of ["MAIA", "VILLAGE", "TRIBE"]) expect(v[t]).toBeCloseTo(1, 6);
  // buying tribeMIND out of the pool with maiaMIND: tribeMIND dearer, maiaMIND cheaper
  s = act(s, "A", { type: "swap", token: "MAIA", to: "TRIBE", amount: 100 }, T0 + 5);
  const w = heartsValue(s);
  expect(w.TRIBE).toBeGreaterThan(1);
  expect(w.MAIA).toBeLessThan(1);
});

test("the starter pack is the 7 % equilibrium: a year's growth equals the year's continuous melt", () => {
  expect(Math.round(equilibriumOf())).toBe(STARTER);
  // held at the equilibrium, a year of growth and a year of melt cancel out
  let s = act(newGame(T0, { homeRent: 0, hexRent: 0, pickupRent: 0, powercubeRent: 0, batteryRent: 0, solarRent: 0, hexSubRent: 0 }), "A", { type: "mint" }, T0);
  for (let d = 1; d <= 13; d++) s = act(s, "A", { type: "mint" }, T0 + d * DAY_MS);
  expect(Math.abs(s.players.A.wallet.HEARTS - STARTER) / STARTER).toBeLessThan(0.005);
});

test("the euro ingest: a player's first mint brings €12,500 into the MaiaCity COOP; later mints bring none, and euros never melt", () => {
  let s = act(newGame(T0), "A", { type: "mint" }, T0 + GAME_DAY);
  expect(s.coops.maia.treasury.EURO).toBeCloseTo(12500, 6);
  const ingest = s.ledger.filter((e) => e.token === "EURO");
  expect(ingest).toHaveLength(1);
  expect(ingest[0]).toMatchObject({ kind: "invest", from: "mint", to: "coop:maia", amount: 12500 });
  expect(ingest[0].note).toContain("system minted");
  expect(s.players.A.wallet.EURO).toBeUndefined();
  // the daily mints after it bring none; the second player's first mint brings theirs
  s = act(s, "A", { type: "mint" }, T0 + 2 * GAME_DAY);
  expect(s.coops.maia.treasury.EURO).toBeCloseTo(12500, 6);
  s = act(s, "B", { type: "mint" }, T0 + 3 * GAME_DAY);
  expect(s.coops.maia.treasury.EURO).toBeCloseTo(2 * 12500, 6);
  // a year on, the HEARTS have melted at the 7 % rate, the euros not at all
  const hearts = s.players.A.wallet.HEARTS;
  s = advance(s, T0 + 3 * GAME_DAY + 13 * DAY_MS);
  expect(s.players.A.wallet.HEARTS).toBeCloseTo(hearts * Math.exp(-0.07), 3);
  expect(s.coops.maia.treasury.EURO).toBeCloseTo(2 * 12500, 6);
  expect(s.ledger.some((e) => e.kind === "demurrage" && e.token === "EURO")).toBe(false);
});

test("the Tribe COOP pays the Village COOP for the hex it lives on, 25 a player a week in villageMIND", () => {
  let s = grown(newGame(T0, { demurrage: 0, dividendShare: 0, homeRent: 0, hexRent: 0, pickupRent: 0, powercubeRent: 0, batteryRent: 0, solarRent: 0, poolShare: 0 }));
  expect(rents(s).filter((r) => r.from === "coop:tribe").map((r) => [r.what, r.to, r.token, r.weekly])).toEqual([["Hex rent", "coop:village", "VILLAGE", 50]]);
  s.coops.tribe.treasury.VILLAGE = 60;
  s = advance(s, T0 + DAY_MS / 4);
  expect(s.coops.village.treasury.VILLAGE).toBeCloseTo(50, 6);
  expect(s.coops.tribe.treasury.VILLAGE).toBeCloseTo(10, 6);
  s = advance(s, T0 + DAY_MS / 2);
  expect(s.coops.tribe.owed.hexSub).toBeCloseTo(40, 6);
});
