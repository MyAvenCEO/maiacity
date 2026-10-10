// The economy sandbox's configs, MIPs and runs against real Postgres semantics (PGlite).
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { addDays, catalogue, createMip, decideMip, getConfig, getMip, getRun, listConfigs, listMips, listRuns, startRun, withdrawMip } from "../src/economy.js";
import { DEFAULT_PARAMS, HOOK_NAMES } from "../../game/economy/params.js";

const pg = new PGlite();
beforeAll(async () => {
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  const wrap = (q) => ({
    query: async (text, params = []) => {
      const r = await q.query(text, params);
      return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
    },
  });
  useDb({ ...wrap(pg), exec: async (t) => void (await pg.exec(t)), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) });
  await pg.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin'), ('alice', 'Alice', 'citizen')");
  W = (await startRun("admin", { config_id: "valley", config: { params: {} } })).id;
});
let W = ""; // the world every MIP here is proposed in

const card = (cfg, id) => cfg.cards.find((c) => c.id === id);

test("the valley is there from the start: the catalogue's defaults as cards, at version 1", async () => {
  const [valley] = await listConfigs();
  expect(valley.id).toBe("valley");
  expect(valley.version).toBe(1);
  expect(valley.cards.map((c) => c.id)).toEqual(["hearts", "trading", "brains", "avens", "bodies", "rot", "land", "harvests", "weather"]);
  expect(valley.params).toEqual(DEFAULT_PARAMS);
  expect((await getConfig("valley")).versions).toEqual([expect.objectContaining({ version: 1, mip: null })]);
  // what card code may export, for agents writing it over the MCP
  expect(catalogue().hooks.map((h) => h.name)).toEqual(HOOK_NAMES);
});

test("a MIP is a title, a description and whole cards; accepted, they go in as they are and the config gets a new version", async () => {
  const hearts = card(await getConfig("valley"), "hearts");
  const mip = await createMip("alice", { world_id: W,
    title: "Mint more, melt faster",
    description: "Avens hoard. More minting and faster decay should keep HEARTS moving.",
    config: "valley",
    cards: [{ ...hearts, values: { ...hearts.values, mint: 30, decay: 12 }, code: "export function mint({ value }) { return value + 6; }" }],
  });
  expect(mip.status).toBe("open");
  expect(mip.action).toBe("edit");
  expect(mip.author_name).toBe("Alice");
  expect(mip.world_id).toBe(W); // every MIP belongs to the world it was proposed in, in one global list
  expect(mip.world_name).toMatch(/^World /);
  await expect(createMip("alice", { title: "Nowhere", config: "valley", cards: [hearts] })).rejects.toThrow(/belongs to a world/);
  await expect(createMip("alice", { world_id: "nope", title: "Nowhere", config: "valley", cards: [hearts] })).rejects.toThrow(/No world nope/);
  expect(mip.base.hearts.values.mint).toBe(24); // what it was, so the proposal reads "from → to"
  expect(mip.base_version).toBe(1);
  const done = await decideMip(mip.number, "admin", { accept: true, note: "yes" });
  expect(done).toEqual({ number: mip.number, status: "accepted", config: "valley", version: 2 });
  const valley = await getConfig("valley");
  expect(valley.params.mint).toBe(30);
  expect(valley.params.decay).toBe(12);
  expect(card(valley, "hearts").code).toContain("return value + 6");
  expect(valley.versions[0]).toEqual(expect.objectContaining({ version: 2, mip: mip.number }));
  expect((await getConfig("valley", { version: 1 })).params.mint).toBe(24);
  await expect(decideMip(mip.number, "admin", { accept: true })).rejects.toThrow(/already accepted/);
});

test("cards are checked: unknown values refused, out of range clamped, ids and kinds checked", async () => {
  const bad = (cards, more = {}) => createMip("alice", { world_id: W, title: "x", config: "valley", cards, ...more });
  await expect(bad([{ id: "hearts", kind: "policy", values: { nope: 1 } }])).rejects.toThrow(/not a value/);
  await expect(bad([{ id: "hearts", kind: "policy", values: { mint: "lots" } }])).rejects.toThrow(/not a value/);
  await expect(bad([{ id: "Hearts!", kind: "policy" }])).rejects.toThrow(/card's id/);
  await expect(bad([{ id: "hearts", kind: "spell" }])).rejects.toThrow(/kind/);
  await expect(bad([], { config: "nowhere" })).rejects.toThrow(/No config/);
  await expect(bad([])).rejects.toThrow(/at least one card/);
  await expect(bad([], { remove: ["nope"] })).rejects.toThrow(/no card nope/);
  await expect(createMip("alice", { world_id: W, title: "", config: "valley", cards: [{ id: "hearts", kind: "policy" }] })).rejects.toThrow(/title/);
  const m = await bad([{ id: "hearts", kind: "policy", values: { mint: 1e12 } }]);
  expect(m.cards[0].values.mint).toBe(10000);
  await withdrawMip(m.number, "alice");
});

test("a MIP creates a config from another with new cards, edits and deletes; rejected and withdrawn ones change nothing", async () => {
  const create = await createMip("alice", { world_id: W,
    title: "A dry valley",
    description: "The same valley with half the rain, to see how prices of WATER move.",
    via: "mcp",
    config: "dry-valley",
    action: "create",
    name: "Dry valley",
    from: "valley",
    cards: [
      { id: "weather", kind: "world", name: "Weather", values: { rainChance: 5, dryChance: 20 } },
      { id: "wells", kind: "resource", name: "Wells", data: { id: "well", decay: 0 } },
    ],
    remove: ["harvests"],
  });
  expect(create.via).toBe("mcp");
  expect(create.base).toEqual({ weather: expect.objectContaining({ id: "weather" }), wells: null, harvests: expect.objectContaining({ id: "harvests" }) });
  expect(await decideMip(create.number, "admin", { accept: true })).toEqual(expect.objectContaining({ config: "dry-valley", version: 1 }));
  const dry = await getConfig("dry-valley");
  expect(dry.name).toBe("Dry valley");
  expect(dry.params.mint).toBe(30); // copied from the valley as it is now
  expect(dry.params.rainChance).toBe(5);
  expect(dry.params.swing).toBe(DEFAULT_PARAMS.swing); // its card taken out: the catalogue's default
  expect(dry.cards.map((c) => c.id)).toEqual(["hearts", "trading", "brains", "avens", "bodies", "rot", "land", "weather", "wells"]);
  await expect(createMip("alice", { world_id: W, title: "again", config: "dry-valley", action: "create" })).rejects.toThrow(/already a config/);

  const no = await createMip("alice", { world_id: W, title: "Rename", config: "dry-valley", name: "Desert" });
  expect((await decideMip(no.number, "admin", { accept: false, note: "keep it" })).status).toBe("rejected");
  expect((await getConfig("dry-valley")).name).toBe("Dry valley");

  const back = await createMip("alice", { world_id: W, title: "Never mind", config: "dry-valley", action: "delete" });
  expect((await withdrawMip(back.number, "alice")).status).toBe("withdrawn");
  await expect(withdrawMip(back.number, "alice")).rejects.toThrow(/open MIP/);

  const del = await createMip("alice", { world_id: W, title: "Delete it", config: "dry-valley", action: "delete" });
  await decideMip(del.number, "admin", { accept: true });
  expect((await listConfigs()).map((c) => c.id)).toEqual(["valley"]);
  expect((await listMips("open")).map((m) => m.number)).not.toContain(del.number);
  expect((await getMip(del.number)).result).toEqual({ config: "dry-valley", deleted: true });
  await expect(createMip("alice", { world_id: W, title: "Back", config: "dry-valley", action: "create" })).rejects.toThrow(/pick another id/);

  const last = await createMip("alice", { world_id: W, title: "No valley", config: "valley", action: "delete" });
  await expect(decideMip(last.number, "admin", { accept: true })).rejects.toThrow(/last config/);
});

test("a run keeps its config copy and its days: stats, trades, decisions", async () => {
  const run = await startRun("admin", { config_id: "valley", config_version: 2, seed: 42, brain: "d1:free", config: { params: { mint: 30 }, cards: [{ id: "hearts" }], local: { mint: 31 } }, summary: { avens: [{ id: 0, name: "Ama" }] } });
  expect(run.days).toBe(0);
  expect(run.summary.avens[0].name).toBe("Ama");
  await addDays(run.id, { days: [{ day: 0, stats: { day: 0, total: 10000 } }, { day: 1, stats: { day: 1, total: 10200 }, trades: [{ good: "water", qty: 2, price: 3 }], decisions: [{ aven: "Ama", changes: ["sells WATER at 3"] }] }], alive: 10 });
  await addDays(run.id, { days: [{ day: 1, stats: { day: 1, total: 10240 } }], summary: { leader: "Ama" }, ended: true });
  const all = await getRun(run.id, { detail: true });
  expect(all.days).toBe(1);
  expect(all.alive).toBe(10);
  expect(all.ended).not.toBeNull();
  expect(all.summary).toEqual({ leader: "Ama" });
  expect(all.config.local).toEqual({ mint: 31 });
  expect(all.day_rows.map((d) => d.stats.total)).toEqual([10000, 10240]);
  expect((await getRun(run.id, { from: 1 })).day_rows.map((d) => d.day)).toEqual([1]);
  expect((await listRuns()).map((r) => r.id)).toContain(run.id);
  await expect(addDays("nope", { days: [] })).rejects.toThrow(/No such run/);
  expect((await startRun("admin", { config_id: "gone", config: { params: {} } })).config_id).toBeNull();
});

test("a new world starts from the world it follows: its cards and values as played, the MIP's cards on top", async () => {
  const first = await createMip("admin", { title: "Auction world", world_id: W, action: "world", world: { name: "Auction", model: "qwen", values: { mint: 30 } }, cards: [{ id: "trading", kind: "policy", values: { haggleMax: 0 }, code: "export function haggle() { return null; }" }] });
  const a = await decideMip(first.number, "admin", { accept: true });
  const health = await createMip("admin", { title: "Health world", world_id: a.world, action: "world", world: { name: "Health", model: "qwen" }, cards: [{ id: "bodies", kind: "world", values: { healthMax: 10 } }] });
  expect(health.world.after_name).toBe("Auction");
  expect(health.world.diff).toEqual(["Health: 100 → 10 points"]);
  const h = await decideMip(health.number, "admin", { accept: true });
  const { rows } = await pg.query("SELECT state FROM econ_runs WHERE id = $1", [h.world]);
  const s = rows[0].state.settings;
  expect(s.after).toBe(a.world);
  expect(s.local.mint).toBe(30);
  expect(card(s.config, "trading").values.haggleMax).toBe(0);
  expect(card(s.config, "trading").code).toContain("return null");
  expect(card(s.config, "bodies").values.healthMax).toBe(10);
});

test("an amend MIP changes a running world's own rules, and nothing else", async () => {
  const made = await createMip("admin", { title: "A world to amend", world_id: W, action: "world", world: { name: "Amend me", model: "qwen" }, cards: [] });
  const w = await decideMip(made.number, "admin", { accept: true });
  const before = (await pg.query("SELECT version FROM econ_configs WHERE id = 'valley'")).rows[0].version;
  const step = await createMip("admin", { title: "A faster price", world_id: w.world, action: "amend", cards: [{ id: "trading", kind: "policy", values: { haggleMax: 0 }, code: "export function price({ price }) { return price; }" }] });
  expect(step.action).toBe("amend");
  expect(step.world.amends).toBe(w.world);
  expect(step.world.diff).toContain("Haggling: 100 → 0 %");
  const r = await decideMip(step.number, "admin", { accept: true });
  expect(r.amended).toBe(w.world);
  const { rows } = await pg.query("SELECT state FROM econ_runs WHERE id = $1", [w.world]);
  const t = card(rows[0].state.settings.config, "trading");
  expect(t.values.haggleMax).toBe(0);
  expect(t.code).toContain("export function price");
  expect((await pg.query("SELECT version FROM econ_configs WHERE id = 'valley'")).rows[0].version).toBe(before);
  await expect(createMip("admin", { title: "No world", action: "amend", world_id: null, cards: [] })).rejects.toThrow();
});
