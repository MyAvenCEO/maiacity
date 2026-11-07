// A sandbox's layout as a document (src/sandboxes.ts, play/SPEC.md §4.6) against a real Postgres: set TEST_DATABASE_URL,
// as for ./api.test.ts.
//
// c1: a sandbox's layout is sandbox:<uuid>, versioned like every other document through src/versioned.ts: edited in an
// intent variant with its pin, pin_latest, unpin, set and delete as edit helpers (doc_edit), proposed
// (propose_doc_version), reviewed on the board with each pin's asset label and version before and after, accepted by an
// admin, its pins and configs then written from Main, and /api/sandboxes/<uuid>/config answering as before.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import { Rate } from "../src/limits";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { RECIPE_HEAD } from "../src/recipes";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

/** Sandbox 2, as migration 0003 made it (its UUID from 0017) */
const S2 = "7a7894a9-f37a-8181-9164-920389ee7675";
const recipe = (id: string, v: number, variant: string | null = null) =>
  `${RECIPE_HEAD}module.exports.recipe = () => ({});\nreturn module.exports.recipe(${JSON.stringify(id)}, ${v}, ${JSON.stringify(variant)});\n});\n`;
const SPEC = {
  goal: "Sandbox 2's pawpaws on their newest version.",
  nothing_to_reduce: "A test fixture: nothing to reduce.",
  scope: "Sandbox 2's layout. Nothing else changes.",
  checks: [{ check: "It holds", how: "test", by: "true", run: "true" }],
};

suite("a sandbox's layout as a document", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  const who: Record<string, { id: string; cookie: string }> = {};
  let token = "";

  beforeAll(async () => {
    name = `play_sandboxdocs_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    await initSessions(db);
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0) });
    for (const n of ["ada", "cit"]) {
      const h = await createHuman(db, n);
      who[n] = { id: h.id, cookie: `play_session=${tokenFor(h.id)}` };
    }
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [who.ada.id]);
    await db.query(`UPDATE play.memberships SET level = 'citizen' WHERE human_id = $1`, [who.cit.id]);
    token = (await call("ada", "POST", "/api/tokens", { name: "agent" })).data.token;
  });
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  const call = async (as: string | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (as) headers.cookie = who[as].cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await api.fetch(new Request(`http://play.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  let n = 0;
  const rpc = async (method: string, params: unknown) =>
    (await (await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) }))).json()).result;
  /** a tool called over MCP by ada's token: its result as JSON, or its error's text */
  const raw = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const res = await rpc("tools/call", { name, arguments: args });
    const text = res.content[0].text;
    return res.isError ? { error: text as string } : JSON.parse(text);
  };
  /** an intent in Build, its spec approved and its one check passed: ready to take work (no work without an intent) */
  const ready = async (title: string) => {
    const i = await raw("add_intent", { title });
    await raw("specify_intent", { intent: i.id, ...SPEC });
    await call("ada", "POST", `/api/intents/${i.id}/approve`);
    await raw("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] });
    return i.id as string;
  };
  /** every edit and every piece of work is an intent's (intents 847c5d38, 706ed873): an edit or a propose this test
   * makes without naming one is made for an intent of its own, ready to take it */
  const tool = async (name: string, args: Record<string, unknown>): Promise<any> => {
    if ((name !== "doc_edit" && name !== "propose_doc_version") || args.intent !== undefined) return raw(name, args);
    return raw(name, { ...args, intent: await ready(`${name}: ${args.message ?? args.note}`) });
  };
  const config = async (as = "cit", intent?: string) => (await call(as, "GET", `/api/sandboxes/${S2}/config${intent ? `?intent=${intent}` : ""}`)).data;

  test("c1: edited in an intent variant with its helpers, proposed, reviewed pin by pin, accepted, its rows written from Main", async () => {
    // a plant of two versions, the second of variants, pinned in Sandbox 2 at v1 as the import writes pins
    const p1 = await call("ada", "POST", "/api/intents", { new: { group: "plants", slug: "pawpaw-t", label: "Pawpaw" }, recipe: recipe("pawpaw-t", 1), card: { lod: { levels: "derived" } }, intent: await ready("A pawpaw") });
    await call("ada", "POST", `/api/intents/${p1.data.intent}/accept`);
    const asset = p1.data.asset, v1 = p1.data.version;
    await db.query(`INSERT INTO play.sandbox_pins (sandbox_id, slot, version_id, params) VALUES ($1, 'grove/pawpaw', $2, '{"stage":"9"}'), ($1, 'gate', $2, NULL)`, [S2, v1]);
    await db.query(`INSERT INTO play.sandbox_configs (sandbox_id, name, data) VALUES ($1, 'grove', '{"trees":[{"id":"pawpaw","v":1,"slot":"grove/pawpaw","weight":2,"at":[0,0]}]}')`, [S2]);
    const p2 = await call("ada", "POST", "/api/intents", { asset, variants: { both: { recipe: recipe("pawpaw-t", 2, "both") }, male: { recipe: recipe("pawpaw-t", 2, "male") } }, defaultVariant: "both", intent: await ready("A pawpaw of kinds") });
    await call("ada", "POST", `/api/intents/${p2.data.intent}/accept`);
    const v2 = (await db.query<any>(`SELECT recipe_hash FROM play.asset_variants WHERE version_id = $1 AND name = 'both'`, [p2.data.version])).rows[0].recipe_hash;
    const before = await config();

    // its layout is a document named by the sandbox's UUID: v1 its pins and configs as they stand
    expect((await tool("list_docs", { kind: "sandbox" })).find((d: any) => d.id === S2)).toMatchObject({ kind: "sandbox", label: "Sandbox 2" });
    const at = await tool("doc_at", { doc: S2 });
    expect(at).toMatchObject({ id: S2, kind: "sandbox", number: 1 });
    expect(at.json).toEqual({
      schema: "sandbox/1", title: "Sandbox 2",
      pins: { gate: { version: v1, variant: null, params: null }, "grove/pawpaw": { version: v1, variant: null, params: { stage: "9" } } },
      configs: { grove: { trees: [{ id: "pawpaw", v: 1, slot: "grove/pawpaw", weight: 2, at: [0, 0] }] } },
    });
    expect((await tool("get_sandbox", { sandbox: S2 })).pins.find((x: any) => x.slot === "grove/pawpaw")).toMatchObject({ asset, number: 1, latest: 2 });

    // refused, each edit checked whole: a ref in a config, a slot no pin would draw, a variant it lacks, a path not there, helpers mixed with a document's edits
    const bad = async (edits: unknown[]) => (await tool("doc_edit", { doc: S2, message: "x", edits })).error;
    expect(await bad([{ op: "set", config: "grove", path: ["trees", 0, "ref"], value: "plants/apple@2" }])).toContain("by a slot");
    expect(await bad([{ op: "unpin", slot: "grove/pawpaw" }])).toContain("would not pin");
    expect(await bad([{ op: "pin", slot: "gate", variant: "female" }])).toContain("no variant female");
    expect(await bad([{ op: "set", config: "grove", path: ["nope", "x"], value: 1 }])).toContain("is not there");
    expect(await bad([{ op: "unpin", slot: "gate" }, { op: "set", path: ["title"], value: "x" }])).toContain("not both");
    expect(await bad([{ op: "set", path: ["pins", "gate", "version"], value: "0".repeat(64) }])).toContain("no accepted version");

    // the papaya case, as an intent's variant made edit by edit: every slot of the plant on its newest version, then a planting moved and weighted
    const intent = (await tool("add_intent", { title: "Sandbox 2's pawpaws on v2" })).id;
    await tool("specify_intent", { intent, ...SPEC });
    await call("ada", "POST", `/api/intents/${intent}/approve`);
    await tool("check_intent", { intent, results: [{ check: "c1", pass: true, evidence: "exit 0" }] });
    const e1 = await tool("doc_edit", { doc: S2, intent, message: "the pawpaws on v2", edits: [{ op: "pin_latest", asset }] });
    expect(e1).toMatchObject({ kind: "sandbox", changed: true, edits: 1 });
    const e2 = await tool("doc_edit", { doc: S2, intent, variant: e1.variant, message: "the grove's tree further out", edits: [{ op: "set", config: "grove", path: ["trees", 0, "at"], value: [4, 2] }, { op: "set", config: "grove", path: ["trees", 0, "weight"], value: 3 }] });
    expect(e2).toMatchObject({ variant: e1.variant, edits: 2 });
    // nobody sees an intent variant as the layout until it is accepted
    expect(await config()).toEqual(before);
    const r = await tool("propose_doc_version", { doc: S2, variant: e1.variant, note: "the pawpaws on v2; the grove's tree further out", intent });
    expect(r).toMatchObject({ intent, stage: "proposal", kind: "sandbox", number: 2, edits: 2 });

    // the board: each pin before and after by its asset's label and version, the configs field by field, its edits
    const listed = (await call("ada", "GET", "/api/intents?stage=proposal")).data.find((i: any) => i.id === intent).work;
    expect(listed).toMatchObject({ kind: "sandbox_version", grp: "sandboxes", what: "layout", label: "Sandbox 2", doc: S2, number: 2, via: "mcp" });
    const review = (await call("ada", "GET", `/api/intents/${intent}`)).data.review;
    expect(review.pins.map((c: any) => [c.slot, c.before.label, c.before.number, c.after.label, c.after.number, c.after.usedVariant])).toEqual([
      ["gate", "Pawpaw", 1, "Pawpaw", 2, "both"],
      ["grove/pawpaw", "Pawpaw", 1, "Pawpaw", 2, "both"],
    ]);
    expect(review.changes.map((c: any) => c.path)).toEqual(expect.arrayContaining(["$.configs.grove.trees[id=pawpaw].at[0]", "$.configs.grove.trees[id=pawpaw].weight"]));
    expect(review.edits.map((e: any) => e.message)).toEqual(["the pawpaws on v2", "the grove's tree further out"]);
    expect(review).toMatchObject({ holds: true, moved: false, seedNumber: 1, doc: { id: S2, kind: "sandbox", open: `/sandboxes/${S2}/?intent=${intent}` }, sandbox: { route: "/sandbox-2/", open: `/sandbox-2/?layout=${encodeURIComponent(`${S2}/${intent}`)}` } });

    // the sandbox as it would be, before anyone decides (admins); as it is, for everyone else
    const proposed = await config("ada", intent);
    expect(proposed.assets["grove/pawpaw"]).toBe(`${v2}?stage=9`);
    expect(proposed.grove.trees[0]).toMatchObject({ at: [4, 2], weight: 3, v: 2, asset: `${v2}?stage=9` });
    expect((await call("cit", "GET", `/api/sandboxes/${S2}/config?intent=${intent}`)).status).toBe(403);
    expect((await config()).grove.trees[0]).toMatchObject({ at: [0, 0], v: 1 });

    // no tool accepts; a citizen may not; an admin does, on the page: Main's v2, its pins and configs written for the worlds
    expect((await call("cit", "POST", `/api/intents/${intent}/accept`)).status).toBe(403);
    expect((await call("ada", "POST", `/api/intents/${intent}/accept`)).data).toMatchObject({ stage: "accepted", decision: { status: "accepted", number: 2 } });
    const after = await config();
    expect(after.assets).toEqual({ gate: v2, "grove/pawpaw": `${v2}?stage=9` });
    expect(after.grove.trees[0]).toMatchObject({ at: [4, 2], weight: 3, v: 2, asset: `${v2}?stage=9` });
    const rows = (await db.query<any>(`SELECT slot, version_id, variant, params FROM play.sandbox_pins WHERE sandbox_id = $1 ORDER BY slot`, [S2])).rows;
    expect(rows).toEqual([{ slot: "gate", version_id: p2.data.version, variant: null, params: null }, { slot: "grove/pawpaw", version_id: p2.data.version, variant: null, params: { stage: "9" } }]);
    const history = await tool("doc_history", { doc: S2 });
    expect(history.versions.map((v: any) => v.number)).toEqual([1, 2]);
    expect(history.variants.find((v: any) => v.id === e1.variant)).toMatchObject({ type: "intent", status: "accepted", seed: 1, edits: 2, intent: { id: intent, stage: "accepted" } });
    expect((await tool("doc_at", { doc: S2, version: 1 })).json.pins.gate.version).toBe(v1);
    expect((await call("ada", "GET", `/api/docs/${S2}/history`)).data.versions.length).toBe(2);
    expect((await call("ada", "GET", `/api/intents/${intent}`)).data.review.pins.length).toBe(2);
    // its History: each version and edit read with its pins named, and the world opened at any of them (admins)
    expect((await tool("doc_at", { doc: S2, version: 1 })).pins.find((x: any) => x.slot === "gate")).toMatchObject({ label: "Pawpaw", number: 1 });
    expect((await config("ada", undefined)).grove.trees[0].v).toBe(2);
    expect((await call("ada", "GET", `/api/sandboxes/${S2}/config?v=1`)).data.grove.trees[0]).toMatchObject({ at: [0, 0], v: 1 });
    expect((await call("ada", "GET", `/api/sandboxes/${S2}/config?edit=${history.edits[1].seq}`)).data.assets.gate).toBe(v2);
    expect((await call("cit", "GET", `/api/sandboxes/${S2}/config?v=1`)).status).toBe(403);
    const step = await call("ada", "GET", `/api/docs/${S2}/changes?variant=${e1.variant}`);
    expect(step.data.pins.map((c: any) => [c.slot, c.before.number, c.after.number])).toEqual([["gate", 1, 2], ["grove/pawpaw", 1, 2]]);

    // two changes of the same field: the first accepted, the second archived as a clash; a document's edit too, by path
    const first = await tool("propose_doc_version", { doc: S2, note: "no position", edits: [{ op: "delete", config: "grove", path: ["trees", 0, "at"] }] });
    const stale = await tool("propose_doc_version", { doc: S2, note: "the gate's male, the tree elsewhere", edits: [{ op: "pin", slot: "gate", variant: "male" }, { op: "set", config: "grove", path: ["trees", 0, "at"], value: [9, 9] }] });
    const byPath = await tool("propose_doc_version", { doc: S2, note: "a heavier tree", edits: [{ op: "set", path: ["configs", "grove", "trees", { id: "pawpaw" }, "weight"], value: 5 }] });
    expect((await call("ada", "POST", `/api/intents/${first.intent}/accept`)).data.decision).toMatchObject({ status: "accepted", number: 3 });
    expect((await call("ada", "POST", `/api/intents/${stale.intent}/accept`)).data.decision).toMatchObject({ status: "archived" });
    expect((await call("ada", "POST", `/api/intents/${byPath.intent}/accept`)).data.decision).toMatchObject({ status: "accepted", number: 4 });
    expect((await config()).grove.trees[0]).toMatchObject({ weight: 5 });
    expect((await config()).grove.trees[0].at).toBeUndefined();
    expect((await config()).assets.gate).toBe(v2);

    // an agent archives its own; unpinned on Main only once accepted
    const mine = await tool("propose_doc_version", { doc: S2, note: "unpin the gate", edits: [{ op: "unpin", slot: "gate" }] });
    expect((await call("ada", "GET", `/api/intents/${mine.intent}`)).data.review.pins).toEqual([{ slot: "gate", before: expect.objectContaining({ label: "Pawpaw", number: 2 }), after: null }]);
    expect((await tool("archive_intent", { intent: mine.intent })).stage).toBe("archived");
    expect((await config()).assets.gate).toBe(v2);

    // propose_sandbox_change is gone: a layout changes as every document does
    const names = (await rpc("tools/list", {})).tools.map((t: any) => t.name);
    expect(names).not.toContain("propose_sandbox_change");
    expect(names).toEqual(expect.arrayContaining(["get_sandbox", "doc_edit", "propose_doc_version"]));
  }, 60_000);
});
