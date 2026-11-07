// The API against a real Postgres: set TEST_DATABASE_URL (a server where this may create and drop a database), e.g.
// postgres://postgres@127.0.0.1:5544/postgres. Without it these tests are skipped.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { runningCommit } from "../src/ship";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore, type BlobStore } from "../src/blobs";
import { importSources } from "../import/sources";
import { legacyRan, runImport } from "../import/run";
import { seedStories, STORIES } from "../import/stories";
import { storyVersionId } from "../src/versions";
import { foldStories } from "../src/stories";
import { NOTE_MOST } from "../src/notes";
import { hashText } from "../src/hash";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { RECIPE_HEAD } from "../src/recipes";
import { UUID } from "../src/uuid";
import { SANDBOX } from "../src/ids";
/** the repo's papaya story (import/stories/papaya-v2-devlog/story.json names it by this) */
const PAPAYA_STORY = "7adaf0b3-01a9-8bb9-b250-d2bee7016c4c";
import { Rate } from "../src/limits";
import { COOP } from "../src/access";
import { randomUUID } from "node:crypto";
import { leveled } from "./fixtures/lod";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

const recipe = (id: string, v: number, variant: string | null = null, note = "") =>
  `${RECIPE_HEAD}module.exports.recipe = () => ({});${note}\nreturn module.exports.recipe(${JSON.stringify(id)}, ${v}, ${JSON.stringify(variant)});\n});\n`;

suite("play API", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  let store: BlobStore;
  const who: Record<string, { id: string; cookie: string }> = {};
  /** each asset made here, by its slug: its UUID */
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    name = `play_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    await initSessions(db);
    store = folderStore(mkdtempSync(join(tmpdir(), "play-blobs-")));
    api = app({ db, store, rate: new Rate(0) });
    for (const n of ["ada", "eve", "cit", "cit2", "trav"]) {
      const h = await createHuman(db, n);
      who[n] = { id: h.id, cookie: `play_session=${tokenFor(h.id)}` };
    }
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = ANY($1)`, [[who.ada.id, who.eve.id]]);
    await db.query(`UPDATE play.memberships SET level = 'citizen' WHERE human_id = ANY($1)`, [[who.cit.id, who.cit2.id]]);
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
    const text = await r.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: r.status, data, headers: r.headers };
  };
  /**
   * no work without an intent (play/SPEC.md §4.12): an intent ready for work, in Build with its spec approved and its
   * one must check passed, by admin `as`; each proposal here is its own intent's
   */
  const ready = async (as = "ada", title = "A test's work") => {
    const id = randomUUID();
    const spec = { goal: "It changes.", scope: "A test fixture.", nothing_to_reduce: "A test fixture.", checks: [{ id: "c1", check: "It holds", how: "test", by: "true", run: "true", must: true, step: "mvp" }] };
    const results = { c1: { pass: true, evidence: "exit 0", by: null, at: new Date().toISOString() } };
    await db.query(
      `INSERT INTO play.intents (id, coop_id, kind, title, note, stage, author, via, spec, results, specified_by, specified_at, approved_by, approved_at)
       VALUES ($1, $2, 'improve', $3, '', 'build', $4, 'mcp', ($5::text)::jsonb, ($6::text)::jsonb, $4, now(), $4, now())`,
      [id, COOP, title, who[as].id, JSON.stringify(spec), JSON.stringify(results)],
    );
    return id;
  };
  /** an asset's version proposed over HTTP (POST /api/intents) by admin `as`, for an intent of its own made ready for it */
  const propose = async (as: string, body: Record<string, unknown>) => call(as, "POST", "/api/intents", { intent: await ready(as), ...leveled(body) });
  /** an intent's work decided by an admin: what the work came to (its status, number, version, merged, message), or the refusal */
  const decided = async (intent: string, verdict: "accept" | "archive") => {
    const r = await call("ada", "POST", `/api/intents/${intent}/${verdict}`);
    return r.data?.decision ? { ...r.data.decision, stage: r.data.stage } : r.data;
  };
  /** the intents at Proposal, each as its work (its kind, label, status, who proposed it, how), named by the intent's id */
  const waiting = async () => (await call("ada", "GET", "/api/intents?stage=proposal")).data.map((i: any) => ({ ...i.work, id: i.id, intent: i }));


  test("knows its commit: GET /api/version answers the commit its image was built with (PLAY_COMMIT), to anyone; /api/health as it was", async () => {
    const commit = "9876ef0070dd4b648badc43e7a33993b00000001";
    const built = app({ db, store, rate: new Rate(0), commit: runningCommit({ PLAY_COMMIT: commit }) });
    const r = await built.fetch(new Request("http://play.test/api/version"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ commit });
    // built without one: null, said so
    expect((await call(null, "GET", "/api/version")).data).toEqual({ commit: process.env.PLAY_COMMIT ? runningCommit() : null });
    expect(await (await built.fetch(new Request("http://play.test/api/health"))).json()).toEqual({ ok: true });
  });

  test("a visitor may do nothing but sign in", async () => {
    expect((await call(null, "GET", "/api/health")).status).toBe(200);
    expect((await call(null, "GET", "/api/assets")).status).toBe(401);
    expect((await call(null, "GET", "/api/sandboxes/ec08b07d-6ec0-8f65-92b2-3efe7d91df5d/config")).status).toBe(401);
    expect((await call(null, "POST", "/api/intents", {})).status).toBe(401);
  });

  test("a traveler reads sandboxes and assets, but proposes nothing", async () => {
    expect((await call("trav", "GET", "/api/me")).data.level).toBe("traveler");
    expect((await call("trav", "GET", "/api/sandboxes/ec08b07d-6ec0-8f65-92b2-3efe7d91df5d/config")).status).toBe(200);
    expect((await call("trav", "GET", "/api/sandboxes")).status).toBe(404);
    expect((await call("trav", "GET", "/api/assets")).status).toBe(200);
    const r = await call("trav", "POST", "/api/intents", { new: { group: "plants", slug: "fern", label: "Fern" }, recipe: recipe("fern", 1) });
    expect(r.status).toBe(403);
    // naming an intent changes nothing: work is an admin's, for an intent
    expect((await call("trav", "POST", "/api/intents", { intent: await ready(), new: { group: "plants", slug: "fern", label: "Fern" }, recipe: recipe("fern", 1) })).status).toBe(403);
  });

  test("an admin proposes a new asset for an intent, an admin accepts it, everyone reads it; a citizen proposes nothing", async () => {
    // no work without an intent (play/SPEC.md §4.12): a citizen keeps no intents, so proposes nothing, named or not
    const fern = { new: { group: "plants", slug: "fern", label: "Fern" }, note: "first", recipe: recipe("fern", 1), record: { card: { label: "Fern" } } };
    expect((await call("cit", "POST", "/api/intents", fern)).status).toBe(403);
    expect((await call("cit", "POST", "/api/intents", { ...fern, intent: await ready() })).status).toBe(403);
    // an admin without an intent: refused, naming add_intent, nothing written
    const none = await call("ada", "POST", "/api/intents", fern);
    expect(none.status).toBe(400);
    expect(none.data.error).toContain("add_intent");
    expect((await db.query(`SELECT 1 FROM play.assets`)).rows).toEqual([]);
    const p = await propose("ada", { new: { group: "plants", slug: "fern", label: "Fern" }, note: "first", recipe: recipe("fern", 1), record: { card: { label: "Fern" } } });
    expect(p.status).toBe(201);
    expect(p.data.number).toBe(1);
    expect(p.data.asset).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    ids.fern = p.data.asset;
    expect((await call("trav", "GET", "/api/assets")).data.find((a: any) => a.id === ids.fern)).toBeUndefined();
    expect((await call("cit", "POST", `/api/intents/${p.data.intent}/accept`)).status).toBe(403);
    const ok = await call("ada", "POST", `/api/intents/${p.data.intent}/accept`);
    expect(ok.data).toMatchObject({ id: p.data.intent, stage: "accepted", decision: { status: "accepted", number: 1 } });
    const a = await call("trav", "GET", `/api/assets/${ids.fern}`);
    expect(a.data.versions.map((v: any) => [v.number, v.author, v.approvedBy])).toEqual([[1, "ada", "ada"]]);
    const f = await call("trav", "GET", `/api/files/${a.data.versions[0].recipe}`);
    expect(f.status).toBe(200);
    expect(hashText(f.data)).toBe(a.data.versions[0].recipe);
    const cat = (await call("trav", "GET", "/api/catalog")).data;
    expect(cat.find((r: any) => r.hash === a.data.versions[0].recipe)).toMatchObject({ asset: ids.fern, v: 1, variant: null });
  });

  test("a version proposed without a record takes its head's, with its own recipe and number", async () => {
    const head = (await call("trav", "GET", `/api/assets/${ids.fern}/1`)).data;
    expect(head.card.card.label).toBe("Fern");
    const p = await propose("ada", { asset: ids.fern, recipe: recipe("fern", 2, null, "/* bare */") });
    const v = (await db.query<any>(`SELECT card FROM play.asset_versions WHERE id = $1`, [p.data.version])).rows[0].card;
    expect(v.card).toMatchObject({ label: "Fern", version: 2, id: "fern", group: "plants" });
    expect(v.card.recipe).not.toBe(head.card.card.recipe);
    await call("ada", "POST", `/api/intents/${p.data.intent}/archive`);
  });

  test("a recipe file must name the version it is proposed for", async () => {
    const r = await propose("ada", { asset: ids.fern, recipe: recipe("fern", 1, null, "/* again */") });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain("not fern@2");
  });

  test("of two proposals on one head, the second goes stale", async () => {
    const a = await propose("ada", { asset: ids.fern, recipe: recipe("fern", 2, null, "/* a */") });
    const b = await propose("eve", { asset: ids.fern, recipe: recipe("fern", 2, null, "/* b */") });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await call("ada", "POST", `/api/intents/${b.data.intent}/accept`)).data.decision.status).toBe("accepted");
    expect((await call("ada", "POST", `/api/intents/${a.data.intent}/accept`)).status).toBe(409);
    const list = await call("trav", "GET", "/api/intents");
    expect(list.status).toBe(403); // the board is the admins'
    // its work archived by itself (its base moved), its intent goes back to Build to be built again on the new head
    expect((await call("ada", "GET", "/api/intents")).data.find((i: any) => i.id === a.data.intent)).toMatchObject({ stage: "build", results: null });
    const chain = (await call("trav", "GET", `/api/assets/${ids.fern}`)).data.versions;
    expect(chain.map((v: any) => v.number)).toEqual([2, 1]);
    expect(chain[0].parents).toEqual([chain[1].id]);
    // a base the proposer saw that is no longer the head is refused at once
    expect((await propose("ada", { asset: ids.fern, base: chain[1].id, recipe: recipe("fern", 3) })).status).toBe(409);
  });

  test("the legacy import runs once: after it, Postgres is the source of truth and a run writes none of it again", async () => {
    expect(await legacyRan(db)).toBeNull();
    await db.query(`INSERT INTO play.imports (name) VALUES ('legacy')`);
    expect(await legacyRan(db)).toBeString();
    // what play changed since: a label, a head set where play set it
    const first = (await db.query<{ id: string }>(`SELECT id FROM play.asset_versions WHERE asset_id = $1 AND number = 1`, [ids.fern])).rows[0].id;
    await db.query(`UPDATE play.assets SET label = 'Fern, renamed in play', head = $2 WHERE id = $1`, [ids.fern, first]);
    const before = (await db.query(`SELECT id, label, head, sound FROM play.assets ORDER BY id`)).rows;
    const members = (await db.query(`SELECT human_id, level FROM play.memberships ORDER BY human_id`)).rows;
    // a run (every deploy runs it) reads no feed, writes none of the legacy import, and changes none of it
    const report = await runImport(db, store, { cache: mkdtempSync(join(tmpdir(), "play-cache-")), founders: true, admins: [1], dry: false, media: false, log: () => {} });
    expect(report.legacy.skipped).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.feed.recipes).toBe(0);
    expect(Object.values(report.written).every((n) => n === 0)).toBe(true);
    // …but it writes the repo's stories play doesn't hold yet (./stories), with every deploy
    expect(report.stories.seeded).toContain(PAPAYA_STORY);
    expect(report.stories.errors).toEqual([]);
    expect((await db.query(`SELECT id, label, head, sound FROM play.assets ORDER BY id`)).rows).toEqual(before);
    expect((await db.query(`SELECT human_id, level FROM play.memberships ORDER BY human_id`)).rows).toEqual(members);
    // play's own again, for the tests after this one
    const newest = (await db.query<{ id: string }>(`SELECT id FROM play.asset_versions WHERE asset_id = $1 AND number IS NOT NULL ORDER BY number DESC LIMIT 1`, [ids.fern])).rows[0].id;
    await db.query(`UPDATE play.assets SET label = 'Fern', head = $2 WHERE id = $1`, [ids.fern, newest]);
  });

  test("an accepted version can't be changed", async () => {
    await expect(db.query(`UPDATE play.asset_versions SET note = 'x' WHERE asset_id = $1 AND number = 1`, [ids.fern])).rejects.toThrow(/frozen/);
    await expect(db.query(`DELETE FROM play.asset_versions WHERE asset_id = $1`, [ids.fern])).rejects.toThrow(/never deleted/);
  });

  test("a kind of variants: each variant its own hash in the catalog, its default marked", async () => {
    const p = await propose("ada", {
      new: { group: "actors", slug: "goat", label: "Goat" },
      variants: { "goat-saanen": { recipe: recipe("goat", 1, "goat-saanen"), record: { card: { label: "Goat: Saanen" } } }, "goat-pied": { recipe: recipe("goat", 1, "goat-pied") } },
      defaultVariant: "goat-saanen",
    });
    expect(p.status).toBe(201);
    ids.goat = p.data.asset;
    await call("ada", "POST", `/api/intents/${p.data.intent}/accept`);
    const goats = (await call("trav", "GET", "/api/catalog")).data.filter((r: any) => r.asset === ids.goat);
    expect(goats.map((g: any) => [g.variant, g.first])).toEqual([["goat-pied", false], ["goat-saanen", true]]);
    expect(goats[0].hash).not.toBe(goats[1].hash);
  });

  test("an agent proposes a plant as a kind of variants over MCP: each its own recipe and label, the params its recipe declares", async () => {
    const t = (await call("ada", "POST", "/api/tokens", { name: "kinds" })).data.token;
    const src = "// a fern of three kinds\nmodule.exports.recipe = function (id, v, variant) {\n  return { meta: { id, v, variant }, build: () => null };\n};\n";
    const params = [
      { id: "stage", label: "Stage", type: "number", min: 0, max: 9, value: 9 },
      { id: "pollen", label: "Pollen", type: "integer", min: 0, max: 1, value: 1, names: ["None", "A male near"] },
    ];
    const head = (await call("trav", "GET", `/api/assets/${ids.fern}`)).data.head;
    const kinds = [{ name: "both", label: "Fern: Both" }, { name: "female", label: "Fern: Female" }, { name: "male", label: "Fern: Male" }];
    const r = await tool("propose_version", { asset: ids.fern, base: head, source: src, note: "its kinds", variants: kinds, default_variant: "both", params }, t);
    expect(r.error).toBeNull();
    const rows = (await db.query<any>(`SELECT name, card FROM play.asset_variants WHERE version_id = $1 ORDER BY name`, [r.out.version])).rows;
    expect(rows.map((x) => [x.name, x.card.card.label, x.card.card.variant])).toEqual([["both", "Fern: Both", "both"], ["female", "Fern: Female", "female"], ["male", "Fern: Male", "male"]]);
    for (const x of rows) expect(x.card.card.params).toEqual(params);
    expect(new Set(rows.map((x) => x.card.card.recipe)).size).toBe(3);
    const v = (await db.query<any>(`SELECT default_variant, recipe_hash FROM play.asset_versions WHERE id = $1`, [r.out.version])).rows[0];
    expect(v).toMatchObject({ default_variant: "both", recipe_hash: null });
    expect((await tool("propose_version", { asset: ids.fern, source: src, note: "bad", params: [{ id: "1x", type: "number", value: 1 }] }, t)).error).toContain("own id");
    expect((await tool("propose_version", { asset: ids.fern, source: src, note: "twice", variants: [{ name: "a" }, { name: "a" }] }, t)).error).toContain("taken twice");
    await call("ada", "POST", `/api/intents/${r.out.intent}/archive`);
  });

  test("a new version never shows what was measured on its parent's recipe (its size, triangles)", async () => {
    const first = await propose("ada", { new: { group: "plants", slug: "sedge", label: "Sedge" }, recipe: recipe("sedge", 1, null, "/* measured */"), record: { card: { label: "Sedge", size: [1.5, 2.5, 1.25], triangles: 4200 } } });
    expect(first.status).toBe(201);
    const asset = first.data.asset;
    await call("ada", "POST", `/api/intents/${first.data.intent}/accept`);
    const shown = async () => (await call("trav", "GET", `/api/assets/${asset}`)).data.versions;
    expect((await shown())[0]).toMatchObject({ size: [1.5, 2.5, 1.25], triangles: 4200 });
    // the next takes the head's record, but not its measures
    const next = await propose("ada", { asset, recipe: recipe("sedge", 2, null, "/* another recipe */") });
    expect(next.status).toBe(201);
    const card = (await db.query<any>(`SELECT card FROM play.asset_versions WHERE id = $1`, [next.data.version])).rows[0].card;
    expect(card.card.label).toBe("Sedge");
    expect(card.card.size).toBeUndefined();
    expect(card.card.triangles).toBeUndefined();
    await call("ada", "POST", `/api/intents/${next.data.intent}/accept`);
    const [after, before] = await shown();
    expect(after).toMatchObject({ number: 2, size: null, triangles: null });
    expect(before).toMatchObject({ number: 1, size: [1.5, 2.5, 1.25], triangles: 4200 });
  });

  test("a proposal naming another asset by a readable ref is refused", async () => {
    const r = await propose("ada", { asset: ids.fern, recipe: recipe("fern", 3, null, "/* r */"), record: { card: { label: "Fern", parts: [{ ref: "actors/goat@1" }] } } });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain("by their hash");
  });

  test("a file is served in part by its bytes (Range), so a sound plays from anywhere in it at once", async () => {
    const hash = (await call("trav", "GET", `/api/assets/${ids.fern}`)).data.versions[0].recipe;
    const whole = (await call("trav", "GET", `/api/files/${hash}`));
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    const text: string = whole.data;
    const get = (range: string) => api.fetch(new Request(`http://play.test/api/files/${hash}`, { headers: { cookie: who.trav.cookie, range } }));
    const part = await get("bytes=10-19");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 10-19/${text.length}`);
    expect(await part.text()).toBe(text.slice(10, 20));
    const tail = await get("bytes=-5");
    expect(await tail.text()).toBe(text.slice(-5));
    expect((await get(`bytes=${text.length - 3}-`)).headers.get("content-range")).toBe(`bytes ${text.length - 3}-${text.length - 1}/${text.length}`);
    expect((await get(`bytes=${text.length}-`)).status).toBe(416);
    expect((await get("bytes=0-1,5-6")).status).toBe(200);
  });

  test("a sandbox's config hands every slot out as the build it pins", async () => {
    const v = (await db.query<any>(`SELECT id, recipe_hash FROM play.asset_versions WHERE asset_id = $1 AND number = 1`, [ids.fern])).rows[0];
    await db.query(`INSERT INTO play.sandbox_pins (sandbox_id, slot, version_id, params) VALUES ('ec08b07d-6ec0-8f65-92b2-3efe7d91df5d', 'fern', $1, '{"stage":"9","seed":"a"}')`, [v.id]);
    await db.query(`INSERT INTO play.sandbox_configs (sandbox_id, name, data) VALUES ('ec08b07d-6ec0-8f65-92b2-3efe7d91df5d', 'garden', '{"outside":{"trees":[{"id":"fern","v":1,"slot":"fern"}]}}')`);
    const c = (await call("trav", "GET", "/api/sandboxes/ec08b07d-6ec0-8f65-92b2-3efe7d91df5d/config")).data;
    expect(c.assets.fern).toBe(`${v.recipe_hash}?seed=a&stage=9`);
    expect(c.garden.outside.trees[0].asset).toBe(c.assets.fern);
    expect((await call(null, "GET", "/api/sandboxes/ec08b07d-6ec0-8f65-92b2-3efe7d91df5d/config")).status).toBe(401);
  });

  test("the Factories are the admins' alone", async () => {
    expect((await call(null, "GET", "/api/sandboxes/9862777e-04c2-8362-b028-27ff7e0591b8/config")).status).toBe(401);
    expect((await call("trav", "GET", "/api/sandboxes/9862777e-04c2-8362-b028-27ff7e0591b8/config")).status).toBe(403);
    expect((await call("cit", "GET", "/api/sandboxes/9862777e-04c2-8362-b028-27ff7e0591b8/config")).status).toBe(403);
    expect((await call("ada", "GET", "/api/sandboxes/9862777e-04c2-8362-b028-27ff7e0591b8/config")).status).toBe(200);
  });

  test("an asset is named by its UUID; its group and slug are only a name, which another asset may share", async () => {
    expect((await call("trav", "GET", "/api/assets/plants/fern")).status).toBe(404);
    const again = await propose("ada", { new: { group: "plants", slug: "fern", label: "Fern again" }, recipe: recipe("fern", 1, null, "/* twin */") });
    expect(again.status).toBe(201);
    expect(again.data.asset).toMatch(UUID);
    expect(again.data.asset).not.toBe(ids.fern);
    // a new asset needs no slug: it is made from its label, only to name the recipe's call
    const named = await propose("ada", { new: { group: "plants", label: "Fern, the third" }, source: "module.exports.recipe = function (id, v) {\n  return { meta: { id, v } };\n};\n" });
    expect(named.status).toBe(201);
    expect((await call("ada", "GET", `/api/intents/${named.data.intent}`)).data.review.slug).toBe("fern-the-third");
    for (const p of [again, named]) await call("ada", "POST", `/api/intents/${p.data.intent}/archive`);
    expect((await propose("ada", { asset: "plants/fern", recipe: recipe("fern", 3) })).status).toBe(400);
  });

  test("a proposal ends accepted or archived: archived by its author or by an admin", async () => {
    const a = await propose("ada", { asset: ids.fern, recipe: recipe("fern", 3, null, "/* w */") });
    expect((await call("cit", "POST", `/api/intents/${a.data.intent}/archive`)).status).toBe(403);
    expect((await call("ada", "POST", `/api/intents/${a.data.intent}/withdraw`)).status).toBe(404);
    expect((await call("ada", "POST", `/api/intents/${a.data.intent}/archive`)).data.decision.status).toBe("archived");
    expect((await call("ada", "GET", `/api/intents/${a.data.intent}`)).data).toMatchObject({ stage: "archived", decided_by: "ada", work: { status: "archived" } });
    const b = await propose("ada", { asset: ids.fern, recipe: recipe("fern", 3, null, "/* r */") });
    expect((await call("eve", "POST", `/api/intents/${b.data.intent}/archive`)).data.decision.status).toBe("archived");
  });

  test("sign-up is by invite only: an invite makes a traveler, once", async () => {
    expect((await call("trav", "POST", "/api/invites")).status).toBe(403);
    const inv = await call("ada", "POST", "/api/invites");
    expect(inv.status).toBe(201);
    expect(inv.data.level).toBe("traveler");
    expect((await call(null, "GET", `/api/invites/${inv.data.code}`)).data.open).toBe(true);
    const none = await call(null, "POST", "/api/passkey/register/options", { name: "Newcomer" });
    expect(none.status).toBe(400);
    expect(none.data.error).toContain("invite-only");
    expect((await call(null, "POST", "/api/passkey/register/options", { name: "Newcomer", invite: "nope" })).status).toBe(400);
    expect((await call(null, "POST", "/api/passkey/register/options", { name: "Newcomer", invite: inv.data.code })).data.challenge).toBeTruthy();
    // the passkey made (no browser here): the human, a traveler let in by the admin who made the invite, the invite used
    const h = await createHuman(db, "Newcomer", undefined, inv.data.code);
    const { rows } = await db.query(`SELECT level, granted_by, via_invite FROM play.memberships WHERE human_id = $1`, [h.id]);
    expect(rows[0]).toMatchObject({ level: "traveler", granted_by: who.ada.id, via_invite: inv.data.code });
    expect((await call(null, "GET", `/api/invites/${inv.data.code}`)).data.open).toBe(false);
    await expect(createHuman(db, "Second", undefined, inv.data.code)).rejects.toThrow("used up");
    expect((await db.query(`SELECT 1 FROM play.humans WHERE name = 'Second'`)).rows.length).toBe(0);
    expect((await call("trav", "POST", `/api/invites/${inv.data.code}/claim`)).status).toBe(404);
  });

  test("an admin's agent proposes over MCP by their token; it accepts nothing, archives only its own, and stops with the token or the admin", async () => {
    expect((await call("cit", "POST", "/api/tokens", { name: "laptop" })).status).toBe(403);
    const made = await call("ada", "POST", "/api/tokens", { name: "Claude laptop" });
    expect(made.status).toBe(201);
    expect(made.data.token).toMatch(/^play_/);
    expect((await call("ada", "GET", "/api/tokens")).data.map((t: any) => t.name)).toContain("Claude laptop");
    expect(JSON.stringify((await call("ada", "GET", "/api/tokens")).data)).not.toContain(made.data.token);
    let n = 0;
    const rpc = async (token: string | null, method: string, params?: unknown) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const r = await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) }));
      return { status: r.status, data: await r.json().catch(() => null) };
    };
    expect((await rpc(null, "initialize")).status).toBe(401);
    expect((await rpc("play_notarealtokenatallxxxxxxxx", "initialize")).status).toBe(401);
    const init = await rpc(made.data.token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.data.result.protocolVersion).toBe("2025-06-18");
    const names = (await rpc(made.data.token, "tools/list")).data.result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_assets", "get_asset", "get_file", "propose_doc_version", "propose_asset", "list_intents", "archive_intent"]));
    expect(names.some((x: string) => /accept|reject|decide/.test(x))).toBe(false);
    const listed = await rpc(made.data.token, "tools/call", { name: "list_assets", arguments: { group: "plants" } });
    expect(listed.data.result.isError).toBeUndefined();
    const proposed = await rpc(made.data.token, "tools/call", {
      name: "propose_asset",
      arguments: { intent: await ready(), group: "plants", slug: "mcp-fern", label: "MCP fern", source: "module.exports.recipe = function (id, v) {\n  return { meta: { id, v } };\n};\n", note: "proposed by an agent", lod: { levels: "derived" } },
    });
    expect(proposed.data.result.isError).toBeUndefined();
    const open = (await waiting()).find((p: any) => p.slug === "mcp-fern");
    expect(open).toMatchObject({ via: "mcp", author: "ada", status: "proposal" });
    // it archives its own open proposal, and nothing else: not one made on the page, not anyone else's
    const archive = (intent: string) => rpc(made.data.token, "tools/call", { name: "archive_intent", arguments: { intent } });
    const byPage = await propose("ada", { asset: ids.fern, recipe: recipe("fern", 3, null, "/* on the page */") });
    const theirsOpen = await propose("eve", { asset: ids.fern, recipe: recipe("fern", 3, null, "/* another admin's */") });
    expect([byPage.status, theirsOpen.status, byPage.data?.error, theirsOpen.data?.error]).toEqual([201, 201, undefined, undefined]);
    for (const id of [byPage.data.intent, theirsOpen.data.intent]) {
      const r = await archive(id);
      expect(r.data.result.isError).toBe(true);
      expect(r.data.result.content[0].text).toContain("over MCP");
    }
    expect((await call("ada", "GET", `/api/intents/${byPage.data.intent}`)).data.review.status).toBe("proposal");
    expect((await archive("not-an-id")).data.result.content[0].text).toContain("by its id");
    const done = await archive(open.id);
    expect(done.data.result.isError).toBeUndefined();
    expect(done.data.result.structuredContent).toEqual({ id: open.id, status: "archived", intent: open.id, stage: "archived" });
    expect((await call("ada", "GET", `/api/intents/${open.id}`)).data).toMatchObject({ stage: "archived", decided_by: "ada" });
    expect((await archive(open.id)).data.result.content[0].text).toContain("at the archived stage");
    // a world (play/SPEC.md §4.11) is a group like the others: listed, proposed, archived
    const worlds = await rpc(made.data.token, "tools/call", { name: "list_assets", arguments: { group: "worlds" } });
    expect(worlds.data.result.isError).toBeUndefined();
    const world = await rpc(made.data.token, "tools/call", {
      name: "propose_asset",
      arguments: { intent: await ready(), group: "worlds", slug: "mcp-test-world", label: "Test world", source: "module.exports.recipe = function (id, v) {\n  return { meta: { group: 'worlds', id, v } };\n};\n", note: "a stand-in world", lod: { levels: "derived" } },
    });
    expect(world.data.result.isError).toBeUndefined();
    const worldOpen = (await waiting()).find((p: any) => p.slug === "mcp-test-world");
    expect(worldOpen).toMatchObject({ via: "mcp", status: "proposal" });
    expect((await archive(worldOpen.id)).data.result.isError).toBeUndefined();
    // a new asset with its variants at once (a truck's kinds), each its own recipe
    const kinds = await rpc(made.data.token, "tools/call", {
      name: "propose_asset",
      arguments: { lod: { levels: "derived" }, intent: await ready(), group: "machines", slug: "mcp-truck", label: "Truck", source: "module.exports.recipe = function (id, v, variant) {\n  return { meta: { id, v, variant } };\n};\n", variants: [{ name: "box" }, { name: "tanker", label: "Truck: Tanker" }], default_variant: "tanker", note: "two kinds" },
    });
    expect(kinds.data.result.isError).toBeUndefined();
    const kindsOpen = (await waiting()).find((p: any) => p.slug === "mcp-truck");
    expect(kindsOpen).toMatchObject({ via: "mcp", status: "proposal" });
    expect((await archive(kindsOpen.id)).data.result.isError).toBeUndefined();
    // a recipe that declares params is refused without them, and records them when given
    const PARAMS = [{ id: "kind", label: "Kind", type: "integer", min: 0, max: 1, value: 0 }];
    const withParams = "module.exports.recipe = function (id, v) {\n  return { meta: { id, v, params: PARAMS } };\n};\nconst PARAMS = [];\n";
    const noParams = await rpc(made.data.token, "tools/call", { name: "propose_asset", arguments: { lod: { levels: "derived" }, intent: await ready(), group: "things", slug: "mcp-lamp", label: "Lamp", source: withParams, note: "params left out" } });
    expect(noParams.data.result.isError).toBe(true);
    expect(noParams.data.result.content[0].text).toContain("params");
    const given = await rpc(made.data.token, "tools/call", { name: "propose_asset", arguments: { lod: { levels: "derived" }, intent: await ready(), group: "things", slug: "mcp-lamp", label: "Lamp", source: withParams, params: PARAMS, note: "params given" } });
    expect(given.data.result.isError).toBeUndefined();
    const lampOpen = (await waiting()).find((p: any) => p.slug === "mcp-lamp");
    const lamp = (await call("ada", "GET", `/api/intents/${lampOpen.id}`)).data.review;
    expect(JSON.stringify(lamp)).toContain('"kind"');
    expect((await archive(lampOpen.id)).data.result.isError).toBeUndefined();
    const none = await rpc(made.data.token, "tools/call", { name: "propose_asset", arguments: { lod: { levels: "derived" }, intent: await ready(), group: "machines", label: "Nothing", note: "no source" } });
    expect(none.data.result.isError).toBe(true);
    for (const id of [byPage.data.intent, theirsOpen.data.intent]) await call("ada", "POST", `/api/intents/${id}/archive`);
    const wrong = await rpc(made.data.token, "tools/call", {
      name: "propose_asset",
      arguments: { intent: await ready(), group: "plants", slug: "mcp-moss", label: "Moss", source: `module.exports.recipe=function(){return{a:${"1+".repeat(800)}1}};`, note: "minified" },
    });
    expect(wrong.data.result.isError).toBe(true);
    expect(wrong.data.result.content[0].text).toContain("not readable");
    const bundled = await rpc(made.data.token, "tools/call", { name: "propose_asset", arguments: { lod: { levels: "derived" }, intent: await ready(), group: "plants", slug: "mcp-moss", label: "Moss", recipe: recipe("mcp-moss", 1), note: "no source" } });
    expect(bundled.data.result.isError).toBe(true);
    expect((await call("ada", "DELETE", `/api/tokens/${made.data.id}`)).data.revoked).toBe(true);
    expect((await rpc(made.data.token, "tools/list")).status).toBe(401);
    // a token opens nothing once its owner is no admin
    await call("ada", "POST", `/api/members/${who.cit.id}/level`, { level: "admin" });
    const theirs = await call("cit", "POST", "/api/tokens", { name: "theirs" });
    expect((await rpc(theirs.data.token, "ping")).status).toBe(200);
    await call("ada", "POST", `/api/members/${who.cit.id}/level`, { level: "citizen" });
    expect((await rpc(theirs.data.token, "ping")).status).toBe(401);
  });

  test("an admin's token opens the world's read-only routes, so an agent can film a sandbox; nothing else, and nothing that writes", async () => {
    const t = (await call("ada", "POST", "/api/tokens", { name: "camera" })).data;
    const get = async (path: string, method = "GET", token = t.token) =>
      (await api.fetch(new Request(`http://play.test${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: "{}" }) }))).status;
    expect(await get("/api/me")).toBe(200);
    expect(await get("/api/catalog")).toBe(200);
    expect(await get(`/api/assets/${ids.fern}`)).toBe(200);
    expect(await get("/api/sandboxes/ec08b07d-6ec0-8f65-92b2-3efe7d91df5d/config")).toBe(200);
    for (const path of ["/api/members", "/api/tokens", "/api/intents", "/api/stories", "/api/postgres/tables"]) expect(await get(path)).toBeGreaterThanOrEqual(401);
    expect(await get("/api/intents", "POST")).toBe(401);
    expect(await get("/api/catalog", "GET", "play_notarealtokenatallxxxxxxxx")).toBe(401);
    await call("ada", "DELETE", `/api/tokens/${t.id}`);
    expect(await get("/api/catalog")).toBe(401);
  });

  test("a proposal brings its readable source: play wraps it into the recipe, keeps both, and serves them as text", async () => {
    const source = "// a fern, version 3\nconst THREE = require('three');\nmodule.exports.recipe = function (id, v) {\n  return { meta: { id, v } };\n};\n";
    const p = await propose("ada", { asset: ids.fern, source, note: "readable" });
    expect(p.status).toBe(201);
    const r = (await call("ada", "GET", `/api/intents/${p.data.intent}`)).data.review;
    expect(r.source).toBe(hashText(source));
    expect(r.builds).toHaveLength(1);
    expect(r.builds[0]).toMatchObject({ hash: r.recipe, proposed: true, v: p.data.number });
    expect(r.builds[0].record.manifest.libs).toEqual(["three"]);
    expect(r.builds[0].record.engine.host).toBe("box");
    expect(r.builds[0].record.source).toBe(r.source);
    const file = await call("ada", "GET", `/api/files/${r.recipe}`);
    expect(file.data).toBe(`${RECIPE_HEAD}${source}\nreturn module.exports.recipe("fern", ${p.data.number}, null);\n});\n`);
    expect(file.headers.get("content-type")).toStartWith("text/plain");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
    expect((await call("ada", "GET", `/api/files/${r.source}`)).data).toBe(source);
    await call("ada", "POST", `/api/intents/${p.data.intent}/archive`);
  });

  test("an imported version and its variants are given their readable source once, and nothing else of them changes", async () => {
    // two imported versions as the import writes them: their recipe files among play's files, no source
    const put = async (text: string) => {
      const h = hashText(text);
      const key = await store.put(h, new TextEncoder().encode(text), "text/javascript");
      await db.query(`INSERT INTO play.files (hash, size, media_type, bucket_key) VALUES ($1, $2, 'text/javascript', $3) ON CONFLICT DO NOTHING`, [h, text.length, key]);
      return h;
    };
    const legacy = "module.exports.recipe = function (id, v, variant) {\n  return { meta: { id, v, variant }, build: () => null };\n};\n";
    const own = await put(recipe("thyme-old", 1)), hen = await put(recipe("hen-old", 1, "hen-red"));
    const thyme = "8a1e2b44-0000-4000-8000-000000000001", hens = "8a1e2b44-0000-4000-8000-000000000002";
    await db.query(`INSERT INTO play.assets (id, coop_id, grp, slug, label) VALUES ($1, '12f8d4e7-701f-8727-a327-de9b240ea867', 'plants', 'thyme-old', 'Thyme'), ($2, '12f8d4e7-701f-8727-a327-de9b240ea867', 'actors', 'hen-old', 'Hen')`, [thyme, hens]);
    await db.query(
      `INSERT INTO play.asset_versions (id, asset_id, number, recipe_hash, default_variant, card, engine, imported) VALUES
        ($1, $2, 1, $3, NULL, '{"card":{}}', 5, '{"from":"avendb"}'), ($4, $5, 1, NULL, 'hen-red', '{"card":{}}', 5, '{"from":"avendb"}')`,
      [hashText("thyme-old@1"), thyme, own, hashText("hen-old@1"), hens],
    );
    await db.query(`INSERT INTO play.asset_variants (version_id, name, recipe_hash, card) VALUES ($1, 'hen-red', $2, '{"card":{}}')`, [hashText("hen-old@1"), hen]);
    // the sources and their index, as legacy/sources keeps them
    const dir = mkdtempSync(join(tmpdir(), "play-sources-"));
    const index = (recipes: Record<string, any>, text = legacy) => {
      mkdirSync(join(dir, "plants"), { recursive: true });
      writeFileSync(join(dir, "plants/old.js"), text);
      writeFileSync(join(dir, "index.json"), JSON.stringify({ sources: { [hashText(legacy)]: "plants/old.js" }, recipes }));
    };
    const src = hashText(legacy);
    index({ [own]: { asset: "plants/thyme-old", v: 1, variant: null, source: src, commit: "c" }, [hen]: { asset: "actors/hen-old", v: 1, variant: "hen-red", source: src, commit: "c" } });
    const first = await importSources(db, store, dir);
    expect(first).toEqual({ files: 1, attached: 2, recipesAbsent: 0, errors: [] });
    const got = await call("trav", "GET", `/api/assets/${thyme}`);
    expect(got.data.versions[0].source).toBe(src);
    expect((await call("trav", "GET", `/api/assets/${hens}`)).data.versions[0].variants[0].source).toBe(src);
    expect((await call("trav", "GET", `/api/files/${src}`)).data).toBe(legacy);
    // run again, nothing more is written
    expect(await importSources(db, store, dir)).toEqual({ files: 0, attached: 0, recipesAbsent: 0, errors: [] });
    // a source is given once; the rest stays frozen
    await expect(db.query(`UPDATE play.asset_versions SET source_hash = $1 WHERE asset_id = $2`, [own, thyme])).rejects.toThrow(/given once/);
    await expect(db.query(`UPDATE play.asset_versions SET source_hash = NULL WHERE asset_id = $1`, [thyme])).rejects.toThrow(/given once/);
    await expect(db.query(`UPDATE play.asset_versions SET note = 'x' WHERE asset_id = $1`, [thyme])).rejects.toThrow(/frozen/);
    await expect(db.query(`UPDATE play.asset_variants SET source_hash = NULL WHERE recipe_hash = $1`, [hen])).rejects.toThrow(/never changed/);
    await expect(db.query(`UPDATE play.asset_variants SET card = '{}' WHERE recipe_hash = $1`, [hen])).rejects.toThrow(/never changed/);
    // an index that says the wrong version, for a version that lacks its source, or a source that is not its hash, is refused
    const sage = await put(recipe("sage-old", 1)), sageId = "8a1e2b44-0000-4000-8000-000000000003";
    await db.query(`INSERT INTO play.assets (id, coop_id, grp, slug, label) VALUES ($1, '12f8d4e7-701f-8727-a327-de9b240ea867', 'plants', 'sage-old', 'Sage')`, [sageId]);
    await db.query(`INSERT INTO play.asset_versions (id, asset_id, number, recipe_hash, default_variant, card, engine, imported) VALUES ($1, $2, 1, $3, NULL, '{"card":{}}', 5, '{"from":"avendb"}')`, [hashText("sage-old@1"), sageId, sage]);
    index({ [sage]: { asset: "plants/sage-old", v: 2, variant: null, source: src, commit: "c" } });
    expect((await importSources(db, store, dir)).errors[0]).toMatch(/builds sage-old@1, not plants\/sage-old@2/);
    expect((await db.query(`SELECT source_hash FROM play.asset_versions WHERE asset_id = $1`, [sageId])).rows[0].source_hash).toBeNull();
    index({}, legacy + "// changed\n");
    expect((await importSources(db, store, dir)).errors[0]).toMatch(/its text is not/);
  });

  test("minified code, a source that sets no recipe, and an engine that is not frozen are refused", async () => {
    const min = await propose("ada", { asset: ids.fern, source: `module.exports.recipe=function(){return ${"[1,2,3],".repeat(200)}0};` });
    expect(min.status).toBe(400);
    expect(min.data.error).toContain("not readable");
    expect((await propose("ada", { asset: ids.fern, source: "// nothing here\n" })).data.error).toContain("module.exports.recipe");
    const engine = await propose("ada", { asset: ids.fern, source: "module.exports.recipe = () => ({});\n", record: { engine: { version: 99 } } });
    expect(engine.data.error).toContain("not one of the frozen engines");
  });

  test("admins run the members, and one admin always stays", async () => {
    expect((await call("cit", "GET", "/api/members")).status).toBe(403);
    expect((await call("ada", "GET", "/api/members")).data.length).toBe(6);
    // the second admin a citizen again: ada is the one admin left, and stays
    expect((await call("ada", "POST", `/api/members/${who.eve.id}/level`, { level: "citizen" })).data.level).toBe("citizen");
    expect((await call("ada", "POST", `/api/members/${who.ada.id}/level`, { level: "traveler" })).status).toBe(409);
    expect((await call("ada", "POST", `/api/members/${who.cit2.id}/level`, { level: "traveler" })).data.level).toBe("traveler");
  });

  test("an asset hands out its sound and the sound's gain", async () => {
    const list = (await call("trav", "GET", "/api/assets")).data as { id: string }[];
    const a = (await call("trav", "GET", `/api/assets/${list[0].id}`)).data;
    expect(a).toHaveProperty("sound", null);
    expect(a.sound_gain).toBe(1);
  });

  test("anyone signed in renames themselves", async () => {
    expect((await call(null, "POST", "/api/me/name", { name: "Nobody" })).status).toBe(401);
    expect((await call("cit", "POST", "/api/me/name", { name: "a" })).status).toBe(400);
    expect((await call("cit", "POST", "/api/me/name", { name: " Cita  Zen " })).data.name).toBe("Cita Zen");
    expect((await call("cit", "GET", "/api/me")).data.name).toBe("Cita Zen");
  });

  test("an admin renames and removes a member, never themselves or the history's names", async () => {
    expect((await call("cit", "POST", `/api/members/${who.trav.id}/name`, { name: "Wanda" })).status).toBe(403);
    expect((await call("ada", "POST", `/api/members/${who.trav.id}/name`, { name: " x " })).status).toBe(400);
    expect((await call("ada", "POST", `/api/members/${who.trav.id}/name`, { name: "  Wanda   Walker " })).data.name).toBe("Wanda Walker");
    expect((await call("ada", "DELETE", `/api/members/${who.ada.id}`)).status).toBe(409);
    expect((await call("cit", "DELETE", `/api/members/${who.trav.id}`)).status).toBe(403);
    // the second admin made a version above: kept, with their name on it
    const kept = await call("ada", "DELETE", `/api/members/${who.eve.id}`);
    expect(kept.status).toBe(409);
    expect(kept.data.error).toContain("asset version");
    const before = (await call("ada", "GET", "/api/members")).data.length;
    expect((await call("ada", "DELETE", `/api/members/${who.trav.id}`)).data.removed).toBe(true);
    expect((await call("ada", "GET", "/api/members")).data.length).toBe(before - 1);
    expect((await call("ada", "DELETE", `/api/members/${who.trav.id}`)).status).toBe(404);
    expect((await call("trav", "GET", "/api/me")).status).toBe(401);
  });

  test("only an admin looks into the database, read only, its secrets never sent", async () => {
    expect((await call(null, "GET", "/api/tables")).status).toBe(401);
    expect((await call("cit", "GET", "/api/tables")).status).toBe(403);
    const tables = (await call("ada", "GET", "/api/tables")).data as { name: string; rows: number; columns: { name: string; hidden: boolean }[] }[];
    expect(tables.map((t) => t.name)).toContain("asset_versions");
    expect(tables.find((t) => t.name === "secrets")!.columns.find((c) => c.name === "value")!.hidden).toBe(true);
    const secrets = (await call("ada", "GET", "/api/tables/secrets")).data;
    expect(secrets.rows.length).toBeGreaterThan(0);
    for (const r of secrets.rows) expect(r.value).toEqual({ hidden: true });
    const humans = (await call("ada", "GET", "/api/tables/humans?limit=2&offset=1")).data;
    expect(humans.rows.length).toBe(2);
    expect(humans.total).toBeGreaterThanOrEqual(3);
    expect((await call("ada", "GET", "/api/tables/pg_user")).status).toBe(404);
    expect((await call("ada", "GET", `/api/tables/${encodeURIComponent('humans"; DROP TABLE play.humans; --')}`)).status).toBe(404);
  });


  // ---- Stories: films as timelines, versioned like the assets, changed only by proposal over MCP
  const frameOf = (n: string) => readFileSync(join(STORIES, "papaya-v2-devlog", "frames", n));
  let storyToken = "";
  let m = 1000;
  const rawTool = async (name: string, args: Record<string, unknown>, token = storyToken) => {
    // no work without an intent: every propose names one, made ready for it, unless the test names its own
    if ((name.startsWith("propose_") || name === "add_artifact" || name === "update_artifact") && args.intent === undefined) args = { ...args, intent: await ready() };
    const r = await api.fetch(new Request("http://play.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++m, method: "tools/call", params: { name, arguments: args } }),
    }));
    const data: any = await r.json();
    const res = data.result;
    return { error: res?.isError ? res.content[0].text as string : null, out: res?.isError ? null : res?.structuredContent };
  };
  /**
   * The story tools as a test calls them: a story's version proposed with its edits (a title among them), its whole
   * timeline, or an intent variant made edit by edit (doc_edit, propose_doc_version, ../src/versioned.ts).
   */
  /** every edit is an intent's: each variant a test drafts is made for an intent of its own, ready to propose */
  const variantIntent = new Map<number, string>();
  const readyIntent = async (title: string, token = storyToken) => {
    const i = (await rawTool("add_intent", { title }, token)).out;
    await rawTool("specify_intent", { intent: i.id, goal: "It changes.", nothing_to_reduce: "A test fixture: nothing to reduce.", scope: "One story.", checks: [{ check: "It holds", how: "test", by: "true", run: "true" }] }, token);
    await call("ada", "POST", `/api/intents/${i.id}/approve`);
    await rawTool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] }, token);
    return i.id as string;
  };
  const tool = async (name: string, args: Record<string, any>, token = storyToken) => {
    const editsOf = (a: Record<string, any>) => (a.title !== undefined ? [...(a.edits ?? []), { op: "set", fields: { title: a.title } }] : a.edits);
    if (name === "propose_story_version") {
      const { story, note, body, variant } = args;
      const intent = args.intent ?? (variant != null ? variantIntent.get(Number(variant)) : undefined);
      if (body !== undefined && args.edits !== undefined) return { error: "Give edits or the whole document, not both.", out: null };
      return rawTool("propose_doc_version", { doc: story, note, ...(variant != null ? { variant } : {}), ...(intent ? { intent } : {}), ...(body !== undefined ? { whole: { ...(args.title !== undefined ? { title: args.title } : {}), ...body } } : editsOf(args) !== undefined ? { edits: editsOf(args) } : {}) }, token);
    }
    if (name === "story_edit") {
      const { story, message, body, variant } = args;
      const intent = args.intent ?? (variant != null ? variantIntent.get(Number(variant)) : undefined) ?? (await readyIntent(`An edit of ${story}`, token));
      const r = await rawTool("doc_edit", { doc: story, intent, message, ...(variant != null ? { variant } : {}), ...(body !== undefined ? { whole: { ...(args.title !== undefined ? { title: args.title } : {}), ...body } } : { edits: editsOf(args) ?? [] }) }, token);
      if (r.out?.variant != null) variantIntent.set(Number(r.out.variant), intent);
      return r;
    }
    if (name === "propose_version") {
      // an asset's version: its source, its kinds, the params its recipe declares and its documents, each a field of
      // the asset's document, edited on an intent variant and proposed
      const { asset, note, source, variants, default_variant, params } = args;
      const edits: any[] = [];
      if (source !== undefined) edits.push({ op: "set", path: ["source"], value: source });
      if (variants) {
        edits.push({ op: "set", path: ["variants"], value: variants.map((x: any) => ({ name: x.name, ...(x.source ? { source: x.source } : {}), card: { card: { label: x.label ?? x.name } } })) });
        edits.push({ op: "set", path: ["defaultVariant"], value: default_variant ?? variants[0].name });
      }
      if (params !== undefined) edits.push({ op: "set", path: ["card", "card", "params"], value: params });
      for (const k of ["sheet", "datasheet", "brief"]) if (args[k] !== undefined) edits.push(args[k] === null ? { op: "delete", path: ["card", k] } : { op: "set", path: ["card", k], value: args[k] });
      return rawTool("propose_doc_version", { doc: asset, note, edits }, token);
    }
    return rawTool(name, args, token);
  };
  /** the stories made here, each by the UUID play gave it */
  const S: Record<string, string> = {};
  const tracks = (frame: string, line = "Every papaya begins as a seed.") => [
    { id: "shots", kind: "shots", clips: [{ id: "s1", at: 0, duration: 3, frame, transition: "Match cut" }, { id: "s2", duration: 4, frame: null, transition: "" }] },
    { id: "voice", kind: "voice", clips: [{ id: "v1", at: 0, duration: 3, who: "SAMUEL", line: "This is our papaya…" }, { id: "v2", at: 3, duration: 4, who: "MAIA", line }] },
    { id: "notes", kind: "notes", clips: [{ id: "n1", at: 0, duration: 7, section: "HOOK", camera: "Low angle", retention: "Payoff first", mood: "↑", custom: { kept: true } }] },
  ];

  test("only an admin reads the Stories, and no route writes one: a story changes only by proposal", async () => {
    expect((await call(null, "GET", "/api/stories")).status).toBe(401);
    expect((await call("cit", "GET", "/api/stories")).status).toBe(403);
    expect((await call("cit2", "GET", `/api/stories/${PAPAYA_STORY}`)).status).toBe(403);
    expect((await call("ada", "PUT", `/api/stories/${PAPAYA_STORY}`, { title: "x" })).status).toBe(405);
    expect((await call("ada", "POST", "/api/stories/frames", {})).status).toBe(405);
    // the papaya story, written by the deploy's import run above as its accepted v1, its frames kept as files
    const list = (await call("ada", "GET", "/api/stories")).data;
    expect(list.find((s: any) => s.id === PAPAYA_STORY)).toMatchObject({ number: 1, versions: 1, shots: 25, tracks: 3 });
    const story = (await call("ada", "GET", `/api/stories/${PAPAYA_STORY}`)).data;
    const given = JSON.parse(readFileSync(join(STORIES, "papaya-v2-devlog", "story.json"), "utf8"));
    expect(story).toMatchObject({ schema: "story/1", format: "9:16", fps: 30, number: 1, title: given.title });
    expect(story.tracks.map((t: any) => t.kind)).toEqual(["shots", "voice", "notes"]);
    expect(story.tracks[1].clips.map((c: any) => c.line)).toEqual(given.tracks[1].clips.map((c: any) => c.line));
    for (const c of story.tracks[0].clips) expect(c.frame).toMatch(/^[0-9a-f]{64}$/);
    const frame = await api.fetch(new Request(`http://play.test/api/files/${story.tracks[0].clips[0].frame}`, { headers: { cookie: who.ada.cookie } }));
    expect(frame.headers.get("content-type")).toBe("image/jpeg");
    // its id is its content's: the same primitive as an asset version's
    const { schema, format, fps, duration } = story;
    expect(storyVersionId({ story: PAPAYA_STORY, parents: [], title: story.title, body: { schema, format, fps, duration, tracks: story.tracks } })).toBe(story.version);
  });

  test("an admin's agent adds frames and proposes a new story over MCP; an admin accepts it, and only then is it a story", async () => {
    storyToken = (await call("ada", "POST", "/api/tokens", { name: "stories" })).data.token;
    const names = (await (await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${storyToken}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }))).json()).result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_stories", "get_story", "propose_story", "propose_doc_version", "add_story_frame"]));
    expect(names.some((x: string) => /accept|reject|decide/.test(x))).toBe(false);

    const added = await tool("add_story_frame", { data: frameOf("02.jpg").toString("base64"), media_type: "image/jpeg" });
    expect(added.error).toBeNull();
    expect(added.out.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await tool("add_story_frame", { data: frameOf("02.jpg").toString("base64"), media_type: "image/jpeg" })).out.hash).toBe(added.out.hash);
    expect((await tool("add_story_frame", { data: Buffer.from("<svg onload=alert(1)>").toString("base64"), media_type: "image/png" })).error).toContain("JPEG, PNG or WebP");
    expect((await tool("add_story_frame", { data: frameOf("02.jpg").toString("base64"), media_type: "image/png" })).error).toContain("not image/png");

    const proposed = await tool("propose_story", { title: "Seed to fruit", note: "a first cut", body: { format: "9:16", fps: 30, tracks: tracks(added.out.hash) } });
    expect(proposed.error).toBeNull();
    S.seed = proposed.out.story;
    expect(S.seed).toMatch(UUID); // a new story is its new UUID; its title is only shown
    expect(proposed.out).toMatchObject({ story: S.seed, number: 1, base: null, duration: 7 });
    expect((await call("ada", "GET", `/api/stories/${S.seed}`)).status).toBe(404); // not a story until it is accepted
    const open = (await waiting()).find((p: any) => p.id === proposed.out.intent);
    expect(open).toMatchObject({ kind: "story_version", grp: "stories", story_id: S.seed, slug: null, label: "Seed to fruit", number: 1, via: "mcp", author: "ada" });
    // a story's proposals are the admins' alone
    expect((await call("cit", "GET", "/api/intents")).status).toBe(403);
    expect((await call("cit", "GET", `/api/intents/${proposed.out.intent}`)).status).toBe(403);
    const review = (await call("ada", "GET", `/api/intents/${proposed.out.intent}`)).data.review;
    expect(review.story.tracks[2].clips[0].custom).toEqual({ kept: true }); // a field no kind names is kept
    expect(review.baseStory).toBeNull();
    expect(review.diff.tracks.map((t: any) => t.state)).toEqual(["added", "added", "added"]);
    expect((await call("cit", "POST", `/api/intents/${proposed.out.intent}/accept`)).status).toBe(403);
    expect((await call("ada", "POST", `/api/intents/${proposed.out.intent}/accept`)).data.decision).toMatchObject({ status: "accepted", number: 1 });
    const story = (await call("ada", "GET", `/api/stories/${S.seed}`)).data;
    expect(story).toMatchObject({ title: "Seed to fruit", number: 1, duration: 7, note: "a first cut" });
  });


  test("a version names its reference sheet: kept with it, carried on, shown in the asset library and the Library", async () => {
    const sheet = await tool("add_story_frame", { data: frameOf("03.jpg").toString("base64"), media_type: "image/jpeg", label: "Reference sheet · Fern · 1" });
    expect(sheet.error).toBeNull();
    const src = "// a fern held to its sheet\nmodule.exports.recipe = function (id, v) {\n  return { meta: { id, v }, build: () => null };\n};\n";
    // only an image play keeps, named by its hash
    expect((await tool("propose_version", { asset: ids.fern, source: src, note: "x", sheet: "fern" })).error).toContain("BLAKE3");
    expect((await tool("propose_version", { asset: ids.fern, source: src, note: "x", sheet: "0".repeat(64) })).error).toContain("add the sheet first");
    const code = (await db.query<any>(`SELECT hash FROM play.files WHERE media_type = 'text/javascript' LIMIT 1`)).rows[0].hash;
    expect((await tool("propose_version", { asset: ids.fern, source: src, note: "x", sheet: code })).error).toContain("an image");
    // proposed: in the version's record, and the Library names the proposal beside the image
    const head = (await call("ada", "GET", `/api/assets/${ids.fern}`)).data.head;
    const p = await tool("propose_version", { asset: ids.fern, base: head, source: src, note: "held to its sheet", sheet: sheet.out.hash });
    expect(p.error).toBeNull();
    expect((await db.query<any>(`SELECT card->>'sheet' AS s FROM play.asset_versions WHERE id = $1`, [p.out.version])).rows[0].s).toBe(sheet.out.hash);
    const before = (await call("ada", "GET", `/api/library?kind=image&q=${sheet.out.hash.slice(0, 16)}`)).data.files[0];
    expect(before.used.filter((u: any) => u.as === "sheet")).toEqual([expect.objectContaining({ asset: ids.fern, as: "sheet", accepted: false })]);
    // accepted: the version lists its sheet, and the Library names the plant's version
    expect((await call("ada", "POST", `/api/intents/${p.out.intent}/accept`)).data.decision.status).toBe("accepted");
    const fern = (await call("ada", "GET", `/api/assets/${ids.fern}`)).data;
    expect(fern.versions[0]).toMatchObject({ id: p.out.version, sheet: sheet.out.hash });
    const after = (await call("ada", "GET", `/api/library?kind=image&q=${sheet.out.hash.slice(0, 16)}`)).data.files[0];
    expect(after.used.filter((u: any) => u.as === "sheet")).toEqual([expect.objectContaining({ asset: ids.fern, number: fern.versions[0].number, as: "sheet", accepted: true })]);
    // the next version carries it on unless it names another, and null takes it away
    const q = await tool("propose_version", { asset: ids.fern, base: p.out.version, source: src + "// again\n", note: "the same sheet" });
    expect((await db.query<any>(`SELECT card->>'sheet' AS s FROM play.asset_versions WHERE id = $1`, [q.out.version])).rows[0].s).toBe(sheet.out.hash);
    await call("ada", "POST", `/api/intents/${q.out.intent}/archive`);
    const r = await tool("propose_version", { asset: ids.fern, base: p.out.version, source: src + "// none\n", note: "no sheet", sheet: null });
    expect((await db.query<any>(`SELECT card ? 'sheet' AS has FROM play.asset_versions WHERE id = $1`, [r.out.version])).rows[0].has).toBe(false);
    await call("ada", "POST", `/api/intents/${r.out.intent}/archive`);
  });

  test("a version names its data sheet and brief: Markdown documents kept by hash, in the Library as documents", async () => {
    const ds = await tool("add_document", { text: "# Data sheet · Fern\n\n| Row | Value | Source |\n|---|---|---|\n| Frond | 0.6 m | S1 |\n", label: "Data sheet · Fern" });
    expect(ds.error).toBeNull();
    expect(ds.out).toMatchObject({ media_type: "text/markdown" });
    expect((await tool("add_document", { text: "# Data sheet · Fern\n\n| Row | Value | Source |\n|---|---|---|\n| Frond | 0.6 m | S1 |\n" })).out.hash).toBe(ds.out.hash);
    expect((await tool("add_document", { text: "   " })).error).toContain("Markdown");
    const brief = await tool("add_document", { text: "A fern, its fronds unrolling.\n\nLAYOUT: row 1 the stages.", label: "Brief · Fern" });
    const img = await tool("add_story_frame", { data: frameOf("04.jpg").toString("base64"), media_type: "image/jpeg" });
    const src = "// a fern with its data sheet\nmodule.exports.recipe = function (id, v) {\n  return { meta: { id, v }, build: () => null };\n};\n";
    // each is what it must be: a data sheet and a brief are documents, a sheet an image
    expect((await tool("propose_version", { asset: ids.fern, source: src, note: "x", datasheet: img.out.hash })).error).toContain("Markdown document");
    expect((await tool("propose_version", { asset: ids.fern, source: src, note: "x", sheet: ds.out.hash })).error).toContain("an image");
    const head = (await call("ada", "GET", `/api/assets/${ids.fern}`)).data.head;
    const p = await tool("propose_version", { asset: ids.fern, base: head, source: src, note: "its data sheet", datasheet: ds.out.hash, brief: brief.out.hash });
    expect(p.error).toBeNull();
    const card = (await db.query<any>(`SELECT card FROM play.asset_versions WHERE id = $1`, [p.out.version])).rows[0].card;
    expect(card).toMatchObject({ datasheet: ds.out.hash, brief: brief.out.hash });
    // the Library lists documents as their own kind, never the recipe sources, each with the plant that names it
    const lib = (await call("ada", "GET", "/api/library?kind=document")).data;
    expect(lib.files.every((f: any) => f.media_type === "text/markdown")).toBe(true);
    const doc = lib.files.find((f: any) => f.hash === ds.out.hash);
    expect(doc.label).toBe("Data sheet · Fern");
    expect(doc.used).toEqual([expect.objectContaining({ asset: ids.fern, as: "datasheet", accepted: false })]);
    expect(lib.counts.document).toBeGreaterThanOrEqual(2);
    // accepted, the version lists them; the next one carries them on
    expect((await call("ada", "POST", `/api/intents/${p.out.intent}/accept`)).data.decision.status).toBe("accepted");
    expect((await call("ada", "GET", `/api/assets/${ids.fern}`)).data.versions[0]).toMatchObject({ datasheet: ds.out.hash, brief: brief.out.hash });
    const q = await tool("propose_version", { asset: ids.fern, base: p.out.version, source: src + "// again\n", note: "the same documents" });
    expect((await db.query<any>(`SELECT card FROM play.asset_versions WHERE id = $1`, [q.out.version])).rows[0].card).toMatchObject({ datasheet: ds.out.hash, brief: brief.out.hash });
    await call("ada", "POST", `/api/intents/${q.out.intent}/archive`);
  });
  test("every clip is editable by a proposed version, made as edits on the head; accepted, it is the new head and the old one stays", async () => {
    const head = (await tool("get_story", { story: S.seed })).out;
    const edited = await tool("propose_story_version", {
      story: S.seed, base: head.version, note: "a sharper line, a longer hook, a callout track", title: "From seed to fruit",
      edits: [
        { op: "set_clip", track: "voice", clip: "v2", fields: { line: "Every papaya begins as a black seed in a coat of jelly." } },
        { op: "shift", from: 3, by: 1 },
        { op: "set_clip", track: "shots", clip: "s1", fields: { duration: 4 } },
        { op: "set_clip", track: "voice", clip: "v1", fields: { duration: 4 } },
        { op: "set_clip", track: "notes", clip: "n1", fields: { duration: 8, mood: "↑↑", custom: null } },
        { op: "add_track", track: { id: "callouts", kind: "callout", clips: [{ id: "c1", at: 1, duration: 2, text: "GIANT HERB", style: { y: 0.7 } }] } },
      ],
    });
    expect(edited.error).toBeNull();
    expect(edited.out).toMatchObject({ number: 2, base: head.version, duration: 8 });
    const review = (await call("ada", "GET", `/api/intents/${edited.out.intent}`)).data.review;
    expect(review.diff.title).toEqual({ from: "Seed to fruit", to: "From seed to fruit" });
    const voice = review.diff.tracks.find((t: any) => t.id === "voice");
    expect(voice.changed.find((c: any) => c.id === "v2").changes.map((x: any) => x.field).sort()).toEqual(["at", "line"]);
    expect(review.diff.tracks.find((t: any) => t.id === "callouts").state).toBe("added");
    expect(review.diff.tracks.find((t: any) => t.id === "notes").changed[0].changes.find((x: any) => x.field === "custom")).toEqual({ field: "custom", from: { kept: true }, to: null });
    expect((await call("ada", "POST", `/api/intents/${edited.out.intent}/accept`)).data.decision).toMatchObject({ status: "accepted", number: 2 });
    const now = (await call("ada", "GET", `/api/stories/${S.seed}`)).data;
    expect(now).toMatchObject({ number: 2, title: "From seed to fruit", duration: 8 });
    expect(now.versions.map((v: any) => v.number)).toEqual([2, 1]);
    expect(now.tracks.find((t: any) => t.id === "callouts").clips[0]).toEqual({ id: "c1", at: 1, duration: 2, text: "GIANT HERB", style: { y: 0.7 } });
    expect((await call("ada", "GET", `/api/stories/${S.seed}?v=1`)).data).toMatchObject({ number: 1, title: "Seed to fruit", duration: 7 });
    expect((await call("ada", "GET", `/api/stories/${S.seed}?v=9`)).status).toBe(404);
    // a version is written once, and history can't be changed under its id
    await expect(db.query(`UPDATE play.story_versions SET title = 'x' WHERE id = $1`, [now.version])).rejects.toThrow(/frozen/);
    await expect(db.query(`DELETE FROM play.story_versions WHERE id = $1`, [now.version])).rejects.toThrow(/never deleted/);
    // the whole timeline given instead of edits: removing a track and a clip
    // a whole changelog as its note: kept whole up to NOTE_MOST characters, refused past it
    const changelog = "- one line of what changed, and why.\n".repeat(200);
    const tooLong = await tool("propose_story_version", { story: S.seed, base: now.version, note: "x".repeat(NOTE_MOST + 1), edits: [{ op: "set_clip", track: "voice", clip: "v1", fields: { line: "x" } }] });
    expect(tooLong.error).toContain(`longer than ${NOTE_MOST} characters`);
    const whole = await tool("propose_story_version", { story: S.seed, base: now.version, note: changelog, body: { format: "9:16", fps: 30, tracks: now.tracks.filter((t: any) => t.id !== "notes").map((t: any) => (t.id === "shots" ? { ...t, clips: t.clips.slice(0, 1) } : t)) } });
    expect(whole.error).toBeNull();
    expect(changelog.length).toBeGreaterThan(2000);
    expect((await call("ada", "GET", `/api/intents/${whole.out.intent}`)).data.review.note).toBe(changelog.trim());
    const removed = (await call("ada", "GET", `/api/intents/${whole.out.intent}`)).data.review.diff.tracks;
    expect(removed.find((t: any) => t.id === "notes").state).toBe("removed");
    expect(removed.find((t: any) => t.id === "shots").removed.map((c: any) => c.id)).toEqual(["s2"]);
    // rejected, it stays as a side line in the history, and the head is as it was
    expect((await call("ada", "POST", `/api/intents/${whole.out.intent}/archive`)).data.decision.status).toBe("archived");
    expect((await call("ada", "GET", `/api/stories/${S.seed}`)).data.number).toBe(2);
    expect((await db.query(`SELECT number FROM play.story_versions WHERE id = $1`, [whole.out.version])).rows[0].number).toBeNull();
  });

  test("of two story proposals made on the same head, the second to be accepted is archived, as an asset's would", async () => {
    const head = (await tool("get_story", { story: S.seed })).out;
    const a = await tool("propose_story_version", { story: S.seed, base: head.version, note: "A", edits: [{ op: "set_clip", track: "voice", clip: "v1", fields: { line: "A's line" } }] });
    const b = await tool("propose_story_version", { story: S.seed, base: head.version, note: "B", edits: [{ op: "set_clip", track: "voice", clip: "v1", fields: { line: "B's line" } }] });
    expect(a.out.base).toBe(head.version);
    expect(b.out.base).toBe(head.version);
    expect((await call("ada", "POST", `/api/intents/${a.out.intent}/accept`)).data.decision).toMatchObject({ status: "accepted", number: 3 });
    // B was made on a head that is no longer the head: accepting it is refused, and it is kept, archived
    const late = await decided(b.out.intent, "accept");
    expect(late.status === "archived" || late.error).toBeTruthy();
    expect((await call("ada", "GET", `/api/intents/${b.out.intent}`)).data.review.status).toBe("archived");
    const now = (await call("ada", "GET", `/api/stories/${S.seed}`)).data;
    expect(now.version).toBe(a.out.version);
    expect(now.tracks.find((t: any) => t.id === "voice").clips[0].line).toBe("A's line");
    // proposed now, it is seeded from Main's newest version, A's
    const c = await tool("propose_story_version", { story: S.seed, note: "late", edits: [{ op: "set_clip", track: "voice", clip: "v1", fields: { line: "C" } }] });
    expect(c.out.base).toBe(a.out.version);
    await call("ada", "POST", `/api/intents/${c.out.intent}/archive`);
  });

  test("a shot moves: an agent adds a video, and a shot plays it over its still from video_in; only a kept video will do", async () => {
    // an MP4's first bytes (its ftyp box), and a WebM's (Matroska's EBML header)
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(300, 7)]);
    const clip = await tool("add_story_video", { data: mp4.toString("base64"), media_type: "video/mp4" });
    expect(clip.error).toBeNull();
    expect(clip.out).toMatchObject({ media_type: "video/mp4", size: mp4.length });
    expect((await tool("add_story_video", { data: mp4.toString("base64"), media_type: "video/mp4" })).out.hash).toBe(clip.out.hash);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100, 3)]);
    expect((await tool("add_story_video", { data: webm.toString("base64"), media_type: "video/webm" })).out.media_type).toBe("video/webm");
    expect((await tool("add_story_video", { data: frameOf("02.jpg").toString("base64"), media_type: "video/mp4" })).error).toContain("MP4 or a WebM");
    expect((await tool("add_story_video", { data: mp4.toString("base64"), media_type: "video/webm" })).error).toContain("not video/webm");
    const served = await api.fetch(new Request(`http://play.test/api/files/${clip.out.hash}`, { headers: { cookie: who.ada.cookie, range: "bytes=0-11" } }));
    expect(served.status).toBe(206);
    expect(served.headers.get("content-type")).toBe("video/mp4");

    const head = (await tool("get_story", { story: S.seed })).out;
    const shot = head.tracks.find((t: any) => t.id === "shots").clips[0];
    const moving = await tool("propose_story_version", { story: S.seed, base: head.version, note: "the first shot moves", edits: [{ op: "set_clip", track: "shots", clip: shot.id, fields: { video: clip.out.hash, video_in: 0.5 } }] });
    expect(moving.error).toBeNull();
    const body = (await call("ada", "GET", `/api/intents/${moving.out.intent}`)).data.review.story;
    expect(body.tracks.find((t: any) => t.id === "shots").clips[0]).toMatchObject({ frame: shot.frame, video: clip.out.hash, video_in: 0.5 });
    // a frame's hash is no video, and a hash play does not hold is refused
    const still = await tool("propose_story_version", { story: S.seed, base: head.version, note: "no", edits: [{ op: "set_clip", track: "shots", clip: shot.id, fields: { video: shot.frame } }] });
    expect(still.error).toContain("add_story_video");
    expect((await tool("propose_story_version", { story: S.seed, base: head.version, note: "no", edits: [{ op: "set_clip", track: "shots", clip: shot.id, fields: { video: "nope" } }] })).error).toContain("video's file hash");
  });

  test("the Library: every image, video and recording play keeps, newest first, labelled, and where stories use it; admins only", async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(400, 9)]);
    const clip = await tool("add_story_video", { data: mp4.toString("base64"), media_type: "video/mp4", label: "Omni take 3 · the city to his smile" });
    expect(clip.error).toBeNull();
    const head = (await tool("get_story", { story: S.seed })).out;
    const shot = head.tracks.find((t: any) => t.id === "shots").clips[0];
    const all = await call("ada", "GET", "/api/library");
    expect(all.status).toBe(200);
    expect(all.data.counts.video).toBeGreaterThanOrEqual(1);
    const mine = all.data.files.find((f: any) => f.hash === clip.out.hash);
    expect(mine).toMatchObject({ media_type: "video/mp4", size: mp4.length, label: "Omni take 3 · the city to his smile", used: [] });
    // the seed story's newest version uses its first shot's still
    const still = (await call("ada", "GET", `/api/library?kind=image&q=${shot.frame.slice(0, 10)}`)).data.files[0];
    expect(still.hash).toBe(shot.frame);
    expect(still.used).toContainEqual(expect.objectContaining({ story: S.seed, track: "shots", clip: shot.id, as: "frame" }));
    // found by its label, not by another kind; renamed by an admin; a label given again replaces it
    expect((await call("ada", "GET", "/api/library?kind=video&q=omni%20take")).data.files.map((f: any) => f.hash)).toContain(clip.out.hash);
    expect((await call("ada", "GET", "/api/library?kind=audio&q=omni%20take")).data.files).toHaveLength(0);
    expect((await call("ada", "POST", `/api/library/${clip.out.hash}/label`, { label: "  The first fly-over  " })).data.label).toBe("The first fly-over");
    await tool("add_story_video", { data: mp4.toString("base64"), media_type: "video/mp4" });
    expect((await call("ada", "GET", `/api/library?q=${clip.out.hash.slice(0, 12)}`)).data.files[0].label).toBe("The first fly-over");
    expect((await call("ada", "POST", `/api/library/${clip.out.hash}/label`, { label: "x".repeat(201) })).status).toBe(400);
    expect((await call("ada", "GET", "/api/library?kind=text")).status).toBe(400);
    // nobody else opens it
    expect((await call("cit", "GET", "/api/library")).status).toBe(403);
    expect((await call(null, "GET", "/api/library")).status).toBe(401);
  });

  test("a story sounds: an agent adds recordings, and any clip of any track plays one, with its trim, gain, fades, EQ and keys", async () => {
    // a tenth of a second of silence as a WAV, and an MP3's first bytes
    const wav = (n = 4800) => {
      const b = Buffer.alloc(44 + n * 2);
      b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
      b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
      b.write("data", 36); b.writeUInt32LE(n * 2, 40);
      return b;
    };
    const take = await tool("add_story_audio", { data: wav().toString("base64"), media_type: "audio/wav" });
    expect(take.error).toBeNull();
    expect(take.out).toMatchObject({ media_type: "audio/wav", size: 44 + 9600 });
    expect((await tool("add_story_audio", { data: wav().toString("base64"), media_type: "audio/wav" })).out.hash).toBe(take.out.hash);
    const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 1)]);
    const cue = await tool("add_story_audio", { data: mp3.toString("base64"), media_type: "audio/mpeg" });
    expect(cue.out.media_type).toBe("audio/mpeg");
    expect((await tool("add_story_audio", { data: frameOf("02.jpg").toString("base64"), media_type: "audio/mpeg" })).error).toContain("MP3, WAV");
    expect((await tool("add_story_audio", { data: wav().toString("base64"), media_type: "audio/mpeg" })).error).toContain("not audio/mpeg");
    // served as audio, never sniffed
    const served = await api.fetch(new Request(`http://play.test/api/files/${take.out.hash}`, { headers: { cookie: who.ada.cookie } }));
    expect(served.headers.get("content-type")).toBe("audio/wav");

    const head = (await tool("get_story", { story: S.seed })).out;
    const frame = head.tracks.find((t: any) => t.id === "shots").clips[0].frame;
    const sounding = await tool("propose_story", {
      title: "Seed to fruit, heard", note: "with its sound",
      body: {
        tracks: [
          ...tracks(frame),
          { id: "music", kind: "music", gain: -12, clips: [{ id: "m1", at: 0, duration: 7, audio: cue.out.hash, audio_in: 2.5, fade_in: 1.5, fade_out: 4, eq: [{ type: "highpass", f: 80 }, { type: "peaking", f: 3000, gain: -3, q: 1.2 }], keys: [[5, -6], [0, 0]] }] },
          { id: "sfx", kind: "sfx", mute: true, clips: [{ id: "x1", at: 1, duration: 1, audio: take.out.hash, gain: 3 }, { id: "x2", at: 1.5, duration: 1, audio: take.out.hash }] },
        ].map((t: any) => (t.id === "voice" ? { ...t, clips: t.clips.map((c: any) => ({ ...c, audio: take.out.hash })) } : t)),
      },
    });
    expect(sounding.error).toBeNull();
    const body = (await call("ada", "GET", `/api/intents/${sounding.out.intent}`)).data.review.story;
    const music = body.tracks.find((t: any) => t.id === "music");
    expect(music.gain).toBe(-12);
    expect(music.clips[0]).toMatchObject({ audio: cue.out.hash, audio_in: 2.5, fade_in: 1.5, fade_out: 4, keys: [[0, 0], [5, -6]] });
    expect(music.clips[0].eq).toEqual([{ type: "highpass", f: 80, gain: 0, q: 0.707 }, { type: "peaking", f: 3000, gain: -3, q: 1.2 }]);
    expect(body.tracks.find((t: any) => t.id === "sfx")).toMatchObject({ mute: true }); // sound clips may overlap
    expect(body.tracks.find((t: any) => t.id === "voice").clips.every((c: any) => c.audio === take.out.hash)).toBe(true);

    const bad = async (clip: Record<string, unknown>) =>
      (await tool("propose_story", { title: "x", note: "x", body: { tracks: [{ id: "music", kind: "music", clips: [{ id: "m", at: 0, duration: 2, ...clip }] }] } })).error;
    expect(await bad({ audio: "f".repeat(64) })).toContain("add_story_audio first");
    expect(await bad({ audio: frame })).toContain("add_story_audio first"); // an image is no recording
    expect(await bad({ audio: "not-a-hash" })).toContain("recording's file hash");
    expect(await bad({ audio: take.out.hash, gain: 40 })).toContain("gain");
    expect(await bad({ audio: take.out.hash, eq: [{ type: "fuzz", f: 100 }] })).toContain("type is one of");
    expect(await bad({ audio: take.out.hash, eq: [{ type: "lowpass", f: 5 }] })).toContain("frequency");
    expect(await bad({ audio: take.out.hash, keys: [[1, 30]] })).toContain("gain (dB)");
  });

  test("a story proposal is checked whole: its format, its clips, its frames and its times", async () => {
    const head = (await tool("get_story", { story: S.seed })).out;
    const frame = head.tracks.find((t: any) => t.id === "shots").clips[0].frame;
    const edit = (edits: unknown[]) => tool("propose_story_version", { story: S.seed, note: "bad", edits });
    expect((await edit([{ op: "set_clip", track: "voice", clip: "v2", fields: { at: 1 } }])).error).toContain("before clip");
    expect((await edit([{ op: "set_clip", track: "shots", clip: "s1", fields: { frame: "0".repeat(64) } }])).error).toContain("add_story_frame");
    expect((await edit([{ op: "set_clip", track: "shots", clip: "s1", fields: { frame: "not a hash" } }])).error).toContain("hash");
    expect((await edit([{ op: "set_clip", track: "voice", clip: "nope", fields: { line: "x" } }])).error).toContain("no clip nope");
    expect((await edit([{ op: "set_clip", track: "voice", clip: "v1", fields: { duration: -2 } }])).error).toContain("duration");
    expect((await edit([{ op: "add_clip", track: "voice", clip: { id: "v1", duration: 1 } }])).error).toContain("Two clips");
    expect((await edit([{ op: "set", fields: { fps: 29.97 } }])).error).toContain("frame rate");
    expect((await edit([{ op: "explode" }])).error).toContain("not an operation");
    expect((await edit([{ op: "set_clip", track: "voice", clip: "v1", fields: { line: head.tracks.find((t: any) => t.id === "voice").clips[0].line } }])).error).toContain("nothing changed");
    expect((await tool("propose_story_version", { story: S.seed, note: "both", body: { tracks: [] }, edits: [] })).error).toContain("not both");
    expect((await tool("propose_story_version", { story: "00000000-0000-4000-8000-000000000000", note: "x", edits: [{ op: "set", fields: { fps: 25 } }] })).error).toContain("no document");
    expect((await tool("propose_story_version", { story: "seed-to-fruit", note: "x", edits: [{ op: "set", fields: { fps: 25 } }] })).error).toContain("UUID"); // a story is named by its UUID, never by a slug;
    expect((await tool("propose_story", { title: "x", note: "x", body: { tracks: [{ id: "voice", kind: "voice", clips: [] }] } })).error).toContain("at least one clip");
  });

  test("a voice clip may set its own subtitles, one of them apart and large: kept in time order, checked", async () => {
    const voice = (cues: unknown) => ({ tracks: [{ id: "voice", kind: "voice", clips: [{ id: "t1", at: 0, duration: 6, who: "SAMUEL", line: "One million humans build a hundred times better way of living.", cues }] }] });
    const ok = await tool("propose_story", {
      title: "100x", note: "its own subtitles",
      body: voice([{ at: 2.4, text: "100x", em: true }, { at: 0, text: "One million humans build" }, { at: 3.2, text: "better way of living.", em: "yes" }]),
    });
    expect(ok.error).toBeNull();
    const clip = (await call("ada", "GET", `/api/intents/${ok.out.intent}`)).data.review.story.tracks[0].clips[0];
    expect(clip.cues).toEqual([{ at: 0, text: "One million humans build" }, { at: 2.4, text: "100x", em: true }, { at: 3.2, text: "better way of living." }]);
    const bad = async (cues: unknown) => (await tool("propose_story", { title: "x", note: "x", body: voice(cues) })).error;
    expect(await bad("100x")).toContain("list of subtitles");
    expect(await bad([{ at: 7, text: "late" }])).toContain("seconds into the clip");
    expect(await bad([{ at: 1, text: " " }])).toContain("text is missing");
    expect(await bad([{ at: 1, text: "x".repeat(201) }])).toContain("longer than 200");
    expect(await bad(Array.from({ length: 65 }, (_, i) => ({ at: i / 20, text: "x" })))).toContain("at most 64");
  });

  test("the repo's stories are written into Postgres once, as their accepted v1, and never over play's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "play-stories-"));
    const SEEDED = "5eed7e57-0000-4000-8000-000000000001";
    mkdirSync(join(dir, "seed-test", "frames"), { recursive: true });
    writeFileSync(join(dir, "seed-test", "frames", "a.jpg"), frameOf("03.jpg"));
    writeFileSync(join(dir, "seed-test", "story.json"), JSON.stringify({ id: SEEDED, title: "Seeded", note: "from the repo", schema: "story/1", tracks: [{ id: "shots", kind: "shots", clips: [{ id: "s1", duration: 2, frame: "a.jpg" }, { id: "s2", duration: 3 }] }] }));
    expect(await seedStories(db, store, dir)).toEqual({ seeded: [SEEDED], present: [], errors: [], documents: [] });
    const seeded = (await call("ada", "GET", `/api/stories/${SEEDED}`)).data;
    expect(seeded).toMatchObject({ number: 1, duration: 5, title: "Seeded", note: "from the repo" });
    expect(await seedStories(db, store, dir)).toEqual({ seeded: [], present: [SEEDED], errors: [], documents: [] });
    mkdirSync(join(dir, "Bad_Name"));
    expect((await seedStories(db, store, dir)).errors[0]).toMatch(/Bad_Name/);
  });

  // ---- every story is a Loro document too (play/SPEC.md §4.4): every step kept, drafts as branches, versions in step
  test("an agent makes a change edit by edit over MCP; proposed and accepted, every edit stays in the story's history", async () => {
    const tools = (await (await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${storyToken}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }))).json()).result.tools.map((t: any) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["doc_edit", "doc_history", "doc_at", "list_docs", "propose_doc_version"]));
    expect(tools).not.toContain("story_edit");
    const head = (await tool("get_story", { story: S.seed })).out;
    const line = head.tracks.find((t: any) => t.id === "voice").clips[0].line as string;
    const first = await tool("story_edit", { story: S.seed, message: "a word in the hook", edits: [{ op: "edit_text", track: "voice", clip: "v1", field: "line", index: 0, insert: "Look: " }] });
    expect(first.error).toBeNull();
    const draft = first.out.variant;
    expect(first.out).toMatchObject({ doc: S.seed, kind: "story", changed: true, edits: 1 });
    await tool("story_edit", { story: S.seed, variant: draft, message: "a longer last shot", edits: [{ op: "set_clip", track: "notes", clip: "n1", fields: { retention: "Payoff first, then the question" } }] });
    const third = await tool("story_edit", { story: S.seed, variant: draft, message: "a callout", edits: [{ op: "add_track", track: { id: "titles", kind: "callout", clips: [{ id: "t1", at: 0, duration: 2, text: "SEED" }] } }] });
    expect(third.out.edits).toBe(3);
    // a step that breaks the story is refused and leaves the draft as it was
    expect((await tool("story_edit", { story: S.seed, variant: draft, message: "overlap", edits: [{ op: "set_clip", track: "voice", clip: "v1", fields: { duration: 30 } }] })).error).toContain("before clip");
    expect((await tool("story_edit", { story: S.seed, variant: draft, message: "range", edits: [{ op: "edit_text", track: "voice", clip: "v1", field: "line", index: 999, insert: "x" }] })).error).toContain("outside");
    // nobody sees a draft as the story
    expect((await call("ada", "GET", `/api/stories/${S.seed}`)).data.version).toBe(head.version);
    const own = (await tool("doc_history", { doc: S.seed, variant: draft })).out;
    expect(own.edits.map((s: any) => s.message)).toEqual(["a word in the hook", "a longer last shot", "a callout"]);
    expect(own.edits.every((s: any) => s.via === "mcp" && s.author === "ada")).toBe(true);
    // any step reads back as the story was then
    const atFirst = (await tool("get_story", { story: S.seed, edit: own.edits[0].seq })).out;
    expect(atFirst.tracks.find((t: any) => t.id === "voice").clips[0].line).toBe(`Look: ${line}`);
    expect(atFirst.tracks.some((t: any) => t.id === "titles")).toBe(false);
    // proposed: its steps go with it, to the admins deciding
    const proposed = await tool("propose_story_version", { story: S.seed, variant: draft, note: "a sharper hook, drafted in three steps" });
    expect(proposed.error).toBeNull();
    expect(proposed.out).toMatchObject({ variant: draft, edits: 3, base: head.version });
    const review = (await call("ada", "GET", `/api/intents/${proposed.out.intent}`)).data.review;
    expect(review.edits.map((s: any) => s.message)).toEqual(["a word in the hook", "a longer last shot", "a callout"]);
    // and through the intent's variant, as the board opens it
    expect((await tool("get_story", { story: S.seed, intent: proposed.out.intent })).out.tracks.some((t: any) => t.id === "titles")).toBe(true);
    expect(review.diff.tracks.find((t: any) => t.id === "titles").state).toBe("added");
    // a proposed draft takes no more steps
    expect((await tool("story_edit", { story: S.seed, variant: draft, message: "late", title: "x" })).error).toContain("proposed already");
    const accepted = await decided(proposed.out.intent, "accept");
    expect(accepted).toMatchObject({ status: "accepted", number: head.number + 1 });
    const hist = (await call("ada", "GET", `/api/docs/${S.seed}/history`)).data;
    const messages = hist.edits.map((s: any) => s.message);
    for (const m of ["a word in the hook", "a longer last shot", "a callout"]) expect(messages).toContain(m);
    expect(hist.edits.at(-1).kind).toBe("merge");
    expect(hist.edits.at(-1).version).toBe(head.number + 1);
    // the document's versions are the story's, number for number
    expect(hist.versions.map((v: any) => v.number)).toEqual((await call("ada", "GET", `/api/stories/${S.seed}`)).data.versions.map((v: any) => v.number).reverse());
    expect(hist.variants.find((d: any) => d.id === draft)).toMatchObject({ type: "intent", status: "accepted", intent: { id: proposed.out.intent, stage: "accepted" }, edits: 3 });
    const step = (await call("ada", "GET", `/api/stories/${S.seed}?edit=${own.edits[1].seq}`)).data;
    expect(step.tracks.find((t: any) => t.id === "notes").clips[0].retention).toBe("Payoff first, then the question");
    expect((await call("cit", "GET", `/api/docs/${S.seed}/history`)).status).toBe(403);
  });

  test("two story proposals on one head that touch different fields both go in: the second merged, its parents both", async () => {
    const head = (await tool("get_story", { story: S.seed })).out;
    const a = await tool("propose_story_version", { story: S.seed, base: head.version, note: "A: the speaker", edits: [{ op: "set_clip", track: "voice", clip: "v1", fields: { who: "SAMUEL (VO)" } }] });
    const b = await tool("propose_story_version", { story: S.seed, base: head.version, note: "B: the camera", edits: [{ op: "set_clip", track: "notes", clip: "n1", fields: { camera: "Low angle, 35 mm" } }] });
    expect((await call("ada", "POST", `/api/intents/${a.out.intent}/accept`)).data.decision).toMatchObject({ status: "accepted", number: head.number + 1 });
    const late = await decided(b.out.intent, "accept");
    expect(late).toMatchObject({ status: "accepted", number: head.number + 2, merged: true });
    const now = (await call("ada", "GET", `/api/stories/${S.seed}`)).data;
    expect(now.tracks.find((t: any) => t.id === "voice").clips[0].who).toBe("SAMUEL (VO)");
    expect(now.tracks.find((t: any) => t.id === "notes").clips[0].camera).toBe("Low angle, 35 mm");
    const { rows } = await db.query<{ parents: string[] }>(`SELECT parents FROM play.story_versions WHERE id = $1`, [now.version]);
    expect(rows[0].parents).toEqual([a.out.version, b.out.version]);
    // its content and the document's agree
    const d = (await call("ada", "GET", `/api/docs/${S.seed}/history`)).data;
    expect(d.versions.at(-1).number).toBe(now.number);
    // archived, its intent variant is closed and its edit kept on its own line
    const c = await tool("propose_story_version", { story: S.seed, note: "C", edits: [{ op: "set", fields: { fps: 25 } }] });
    expect((await call("ada", "POST", `/api/intents/${c.out.intent}/archive`)).data.decision.status).toBe("archived");
    expect((await call("ada", "GET", `/api/docs/${S.seed}/history`)).data.variants.find((x: any) => x.id === c.out.variant).status).toBe("archived");
  });

  test("a story from before the documents gets one made from its history: each version a step at its date, work waiting at Proposal a branch", async () => {
    const body = (line: string) => ({ schema: "story/1", format: "9:16", fps: 30, duration: 4, tracks: [{ id: "voice", kind: "voice", clips: [{ id: "v1", at: 0, duration: 4, who: "MAIA", line }] }] });
    const OLD = "0d5707e5-0000-4000-8000-000000000001";
    const v1 = storyVersionId({ story: OLD, parents: [], title: "Old", body: body("first") });
    const v2 = storyVersionId({ story: OLD, parents: [v1], title: "Old", body: body("second") });
    const p3 = storyVersionId({ story: OLD, parents: [v2], title: "Old", body: body("third") });
    await db.query(`INSERT INTO play.stories (id, coop_id, title) VALUES ('${OLD}', '12f8d4e7-701f-8727-a327-de9b240ea867', 'Old')`);
    await db.query(`INSERT INTO play.story_versions (id, story_id, number, parents, title, body, note, created) VALUES ($1, '${OLD}', 1, '{}', 'Old', ($2::text)::jsonb, 'one', '2026-10-01T10:00:00Z')`, [v1, JSON.stringify(body("first"))]);
    await db.query(`INSERT INTO play.story_versions (id, story_id, number, parents, title, body, note, created) VALUES ($1, '${OLD}', 2, $2, 'Old', ($3::text)::jsonb, 'two', '2026-10-02T10:00:00Z')`, [v2, [v1], JSON.stringify(body("second"))]);
    await db.query(`INSERT INTO play.story_versions (id, story_id, parents, title, body, note, author) VALUES ($1, '${OLD}', $2, 'Old', ($3::text)::jsonb, 'three', $4)`, [p3, [v2], JSON.stringify(body("third")), who.ada.id]);
    await db.query(`UPDATE play.stories SET head = $1 WHERE id = '${OLD}'`, [v2]);
    // an intent at Proposal (specified, as every one there is) whose work was proposed before the documents: it has no
    // intent variant yet
    const pid = await ready("ada", "Old v3");
    await db.query(
      `UPDATE play.intents SET stage = 'proposal', work = 'story_version', story_id = '${OLD}', story_base = $2, story_version = $3, work_note = 'three', proposed_by = $4, proposed_via = 'mcp', proposed_at = now() WHERE id = $1`,
      [pid, v2, p3, who.ada.id],
    );
    const h = (await call("ada", "GET", `/api/docs/${OLD}/history`)).data;
    expect(h.edits.map((s: any) => s.message)).toEqual(["v1: one", "v2: two"]);
    expect(h.edits.map((s: any) => s.at.slice(0, 10))).toEqual(["2026-10-01", "2026-10-02"]);
    expect(h.versions.map((v: any) => v.number)).toEqual([1, 2]);
    const iv = h.variants.filter((v: any) => v.type === "intent");
    expect(iv).toHaveLength(1);
    expect(iv[0]).toMatchObject({ seed: 2, intent: { id: pid, stage: "proposal" } });
    expect((await call("ada", "GET", `/api/stories/${OLD}?edit=${h.edits[0].seq}`)).data.tracks[0].clips[0].line).toBe("first");
    // the old work is an intent variant now, and accepting it goes through the document like any other
    expect((await call("ada", "POST", `/api/intents/${pid}/accept`)).data.decision).toMatchObject({ status: "accepted", number: 3 });
    expect((await call("ada", "GET", `/api/stories/${OLD}`)).data.tracks[0].clips[0].line).toBe("third");
    expect((await call("ada", "GET", `/api/docs/${OLD}/history`)).data.versions.map((v: any) => v.number)).toEqual([1, 2, 3]);
  });

  test("stories folded into one: each its versions in turn as the timeline's next, the work of its intent at Proposal moved, then listed no more", async () => {
    const frame = (await tool("add_story_frame", { data: frameOf("02.jpg").toString("base64"), media_type: "image/jpeg" })).out.hash;
    const make = async (title: string, line: string): Promise<string> => {
      const p = await tool("propose_story", { title, note: `${title} v1`, body: { format: "9:16", fps: 30, tracks: tracks(frame, line) } });
      expect(p.error).toBeNull();
      await call("ada", "POST", `/api/intents/${p.out.intent}/accept`);
      return p.out.story;
    };
    const A = await make("Devlog", "one");
    const B = await make("Day 1", "two");
    const b2 = await tool("propose_story_version", { story: B, note: "fold-b v2", edits: [{ op: "set_clip", track: "voice", clip: "v2", fields: { line: "three" } }] });
    expect(b2.error).toBeNull();
    await call("ada", "POST", `/api/intents/${b2.out.intent}/accept`);
    const C = await make("Three seeds", "four");
    const c2 = await tool("propose_story_version", { story: C, note: "its voice", edits: [{ op: "set_clip", track: "voice", clip: "v2", fields: { line: "five" } }] });
    expect(c2.error).toBeNull();

    expect((await foldStories(db, [{ into: "fold-a", from: ["fold-b"] }])).errors[0]).toContain("UUIDs");
    const r = await foldStories(db, [{ into: A, from: [B, C] }]);
    expect(r).toEqual({ folded: [B, C], present: [], errors: [] });
    const a = (await call("ada", "GET", `/api/stories/${A}`)).data;
    expect(a.versions.map((v: any) => v.number)).toEqual([4, 3, 2, 1]);
    expect(a).toMatchObject({ title: "Three seeds", number: 4 });
    expect(a.tracks.find((t: any) => t.id === "voice").clips[1].line).toBe("four");
    expect(a.versions[2].note).toContain("Brought from story “Day 1”, its v1");
    const lines = [];
    for (const n of [2, 3]) lines.push((await call("ada", "GET", `/api/stories/${A}?v=${n}`)).data.tracks.find((t: any) => t.id === "voice").clips[1].line);
    expect(lines).toEqual(["two", "three"]);
    // the intent at Proposal is on the one timeline now: the same intent, its work moved, its branch on the old story closed
    const open = (await waiting()).filter((p: any) => p.story_id === A);
    expect(open.length).toBe(1);
    expect(open[0].id).toBe(c2.out.intent);
    expect(open[0].note).toContain("Moved from story “Three seeds”");
    expect((await db.query<any>(`SELECT status FROM play.doc_variants WHERE id = $1`, [c2.out.variant])).rows[0].status).toBe("archived");
    expect((await call("ada", "POST", `/api/intents/${open[0].id}/accept`)).data.decision).toMatchObject({ status: "accepted", number: 5 });
    // the folded stories are kept but listed no more, and take no proposal
    const listed = (await tool("list_stories", {})).out.items.map((x: any) => x.id);
    expect(listed).toContain(A);
    expect(listed).not.toContain(B);
    expect((await call("ada", "GET", `/api/stories/${B}`)).data.number).toBe(2);
    expect((await tool("propose_story_version", { story: B, note: "x", edits: [{ op: "set_clip", track: "voice", clip: "v2", fields: { line: "x" } }] })).error).toContain(`part of story ${A}`);
    // run again: nothing brought twice
    expect(await foldStories(db, [{ into: A, from: [B, C] }])).toEqual({ folded: [], present: [B, C], errors: [] });
    expect((await call("ada", "GET", `/api/stories/${A}`)).data.number).toBe(5);
  });

  // ---- linked stories (Samuel 2026-11-04): the trailer its own timeline, a version of it linked into every film
  const accept = async (r: { error: string | null; out: any }) => {
    expect(r.error).toBeNull();
    expect((await call("ada", "POST", `/api/intents/${r.out.intent}/accept`)).data.decision.status).toBe("accepted");
    return r.out;
  };
  const TRAILER_BODY = {
    format: "9:16", fps: 30, tracks: [
      { id: "voice", kind: "voice", clips: [{ id: "t1", at: 0, duration: 4, who: "SAMUEL", line: "This is the story of how one million humans build a hundred times better way of living." }] },
      { id: "notes", kind: "notes", clips: [{ id: "n", at: 0, duration: 5, section: "TRAILER", camera: "Wide", retention: "The promise", mood: "↑↑" }] },
      { id: "music", kind: "music", clips: [{ id: "m", at: 0, duration: 5, note: "the trailer's theme" }] },
    ],
  };
  const filmBody = (trailer: string, version: string, extra: Record<string, unknown> = {}) => ({
    format: "9:16", fps: 30, tracks: [
      { id: "voice", kind: "voice", clips: [{ id: "intro", at: 0, duration: 3, who: "MAIA", line: "Three seeds." }, { id: "body", at: 8, duration: 4, who: "MAIA", line: "One will never give fruit." }] },
      // the film's own notes run under the trailer, which a link may (its content is never checked against the film's own clips)
      { id: "notes", kind: "notes", clips: [{ id: "all", at: 0, duration: 12, section: "DAY 1", camera: "", retention: "", mood: "↕" }] },
      { id: "trailer", kind: "story", clips: [{ id: "trailer", at: 3, story: trailer, version, ...extra }] },
    ],
  });
  const linkTrack = (story: string, version?: string, at = 12, extra: Record<string, unknown> = {}) => [{ op: "add_track", track: { id: "more", kind: "story", clips: [{ id: "l", at, story, ...(version ? { version } : {}), ...extra }] } }];
  const L: Record<string, string> = {};

  test("a film links a version of the trailer: checked when proposed, read with its links resolved, the link listed like any clip", async () => {
    const t = await accept(await tool("propose_story", { title: "The trailer", note: "the trailer as its own story", body: TRAILER_BODY }));
    L.trailer = t.story;
    L.t1 = t.version;
    const T = L.trailer;
    // its duration left out: the version's own
    const made = await tool("propose_story", { title: "Day 1", note: "the film, linking the trailer's v1", body: filmBody(T, L.t1) });
    expect(made.error).toBeNull();
    L.film = made.out.story;
    expect(made.out.duration).toBe(12);
    const review = (await call("ada", "GET", `/api/intents/${made.out.intent}`)).data.review;
    expect(review.story.tracks.find((x: any) => x.kind === "story").clips).toEqual([{ id: "trailer", at: 3, duration: 5, story: T, version: L.t1 }]);
    expect(review.story.links[L.t1]).toMatchObject({ id: T, title: "The trailer", number: 1, version: L.t1, duration: 5, newest: 1 });
    expect(review.story.links[L.t1].body.tracks[0].clips[0].line).toContain("one million humans");
    expect(review.diff.tracks.find((x: any) => x.id === "trailer")).toMatchObject({ kind: "story", state: "added", added: [{ id: "trailer", story: T, version: L.t1 }] });
    await accept(made);

    const read = (await call("ada", "GET", `/api/stories/${L.film}`)).data;
    expect(read.links).toEqual({ [L.t1]: { id: T, title: "The trailer", number: 1, version: L.t1, duration: 5, newest: 1, body: expect.objectContaining({ schema: "story/1", duration: 5 }) } });
    // over MCP the links come without their timelines unless asked for
    expect((await tool("get_story", { story: L.film })).out.links).toEqual({ [L.t1]: { id: T, title: "The trailer", number: 1, version: L.t1, duration: 5, newest: 1 } });
    expect((await tool("get_story", { story: L.film, links: true })).out.links[L.t1].body.tracks.map((x: any) => x.kind)).toEqual(["voice", "notes", "music"]);
    // a step of its history reads its links too; the trailer knows who links it, and at which version
    const hist = (await call("ada", "GET", `/api/docs/${L.film}/history`)).data;
    expect((await call("ada", "GET", `/api/stories/${L.film}?edit=${hist.edits.at(-1).seq}`)).data.links[L.t1].number).toBe(1);
    const trailer = (await call("ada", "GET", `/api/stories/${T}`)).data;
    expect(trailer.links).toEqual({});
    expect(trailer.linked_by).toEqual([{ id: L.film, title: "Day 1", number: 1, version: L.t1, plays: 1 }]);
  });

  test("a link is refused without a version, to an unknown story, to itself, by a title, around a loop, to a version not its story's or never accepted, at another length", async () => {
    const { film: F, trailer: T, t1 } = L;
    const refused = async (story: string, edits: unknown[]) => (await tool("propose_story_version", { story, note: "x", edits })).error;
    expect(await refused(F, linkTrack(T))).toContain("names no version");
    expect(await refused(F, linkTrack("00000000-0000-4000-8000-000000000000", t1))).toContain("no such story");
    expect(await refused(F, linkTrack(F, (await tool("get_story", { story: F })).out.version))).toContain("itself");
    expect(await refused(F, linkTrack("The trailer", t1))).toContain("UUID"); // never by its title (play/SPEC.md §4.7)
    const film = (await tool("get_story", { story: F })).out;
    expect(await refused(T, linkTrack(F, film.version))).toContain("loop"); // the trailer → the film → the trailer
    expect(await refused(F, linkTrack(T, film.version))).toContain("not a version of story"); // the film's own version, named as the trailer's
    expect(await refused(F, linkTrack(T, "abc"))).toContain("hash");
    const unaccepted = await tool("propose_story", { title: "Not yet", note: "x", body: TRAILER_BODY });
    expect(await refused(F, linkTrack(unaccepted.out.story, unaccepted.out.version))).toContain("never accepted");
    expect(await refused(F, linkTrack(T, unaccepted.out.version))).toContain("not a version of story");
    expect(await refused(F, linkTrack(T, t1, 12, { duration: 7 }))).toContain("holds its whole version");
    // two links on one track never overlap
    expect(await refused(F, [{ op: "add_clip", track: "trailer", clip: { id: "again", at: 6, story: T, version: t1 } }])).toContain("before clip trailer ends");
    // a draft's step is checked the same
    expect((await tool("story_edit", { story: F, message: "x", edits: linkTrack(T) })).error).toContain("names no version");
  });

  test("a film plays the version it links: a new trailer changes no film; two films play two versions; moving one is a proposal on it; links nest", async () => {
    const { film: F, trailer: T, t1 } = L;
    const t2 = await accept(await tool("propose_story_version", { story: T, note: "a sharper, longer trailer", edits: [{ op: "set_clip", track: "voice", clip: "t1", fields: { line: "This is the story of how one million humans build their own city." } }, { op: "set_clip", track: "notes", clip: "n", fields: { duration: 6 } }] }));
    L.t2 = t2.version;
    // the film plays the trailer's v1 still, and only says a v2 is there
    const still = (await call("ada", "GET", `/api/stories/${F}`)).data;
    expect(still.number).toBe(1);
    expect(still.links[t1]).toMatchObject({ number: 1, newest: 2 });
    expect(still.links[t1].body.tracks[0].clips[0].line).toContain("a hundred times better");
    // a second film links the trailer's v2: each plays its own
    const other = await accept(await tool("propose_story", { title: "Day 2", note: "the next film, on the new trailer", body: filmBody(T, t2.version) }));
    const day2 = (await call("ada", "GET", `/api/stories/${other.story}`)).data;
    expect(Object.keys(day2.links)).toEqual([t2.version]);
    expect(day2.links[t2.version]).toMatchObject({ id: T, number: 2, duration: 6 });
    expect(day2.links[t2.version].body.tracks[0].clips[0].line).toContain("their own city");
    expect(day2.tracks.find((x: any) => x.kind === "story").clips[0].duration).toBe(6);
    expect((await call("ada", "GET", `/api/stories/${T}`)).data.linked_by.map((x: any) => [x.title, x.plays])).toEqual([["Day 1", 1], ["Day 2", 2]]);
    // moving Day 1 to the new trailer: its link's version set (its length the new version's), what follows shifted
    const moved = await tool("propose_story_version", { story: F, note: "the new trailer", edits: [{ op: "shift", from: 8, by: 1 }, { op: "set_clip", track: "trailer", clip: "trailer", fields: { version: t2.version } }] });
    expect(moved.error).toBeNull();
    const diff = (await call("ada", "GET", `/api/intents/${moved.out.intent}`)).data.review.diff.tracks.find((x: any) => x.id === "trailer");
    expect(diff.changed[0].changes.map((c: any) => [c.field, c.from, c.to])).toEqual(expect.arrayContaining([["duration", 5, 6], ["version", t1, t2.version]]));
    await accept(moved);
    const now = (await call("ada", "GET", `/api/stories/${F}`)).data;
    expect(now).toMatchObject({ number: 2, duration: 13 });
    expect(Object.keys(now.links)).toEqual([t2.version]);

    // a story linking the film reads both, the film's version and the trailer's it links
    const N = (await accept(await tool("propose_story", { title: "Season 1", note: "the films in a row", body: { tracks: [{ id: "films", kind: "story", clips: [{ id: "day-1", at: 0, story: F, version: now.version }] }] } }))).story;
    const season = (await call("ada", "GET", `/api/stories/${N}`)).data;
    expect(season.duration).toBe(13);
    expect(Object.keys(season.links).sort()).toEqual([now.version, t2.version].sort());

    // links nest at most four stories deep
    const aside = await accept(await tool("propose_story", { title: "An aside", note: "x", body: { tracks: [{ id: "voice", kind: "voice", clips: [{ id: "a", at: 0, duration: 2, who: "MAIA", line: "An aside." }] }] } }));
    const chain = [aside];
    for (let i = 1; i <= 4; i++) {
      const prev = chain[i - 1];
      chain.push(await accept(await tool("propose_story", { title: `Level ${i}`, note: "x", body: { tracks: [{ id: "in", kind: "story", clips: [{ id: "l", at: 0, story: prev.story, version: prev.version }] }] } })));
    }
    expect(Object.keys((await call("ada", "GET", `/api/stories/${chain[4].story}`)).data.links).length).toBe(4);
    expect((await tool("propose_story", { title: "Too deep", note: "x", body: { tracks: [{ id: "in", kind: "story", clips: [{ id: "l", at: 0, story: chain[4].story, version: chain[4].version }] }] } })).error).toContain("at most 4 stories deep");
  });

  test("a link clip goes through a draft step by step like any clip: kept in the story's history, proposed and accepted", async () => {
    const { film: F, trailer: T, t1, t2 } = L;
    const first = await tool("story_edit", { story: F, message: "back to the first trailer", edits: [{ op: "set_clip", track: "trailer", clip: "trailer", fields: { version: t1 } }] });
    expect(first.error).toBeNull();
    const draft = first.out.variant;
    const second = await tool("story_edit", { story: F, variant: draft, message: "close the gap it leaves", edits: [{ op: "shift", from: 9, by: -1 }] });
    expect(second.error).toBeNull();
    const own = (await tool("doc_history", { doc: F, variant: draft })).out;
    expect(own.edits.map((s: any) => s.message)).toEqual(["back to the first trailer", "close the gap it leaves"]);
    const atFirst = (await tool("get_story", { story: F, edit: own.edits[0].seq })).out;
    expect(atFirst.tracks.find((x: any) => x.kind === "story").clips[0]).toEqual({ id: "trailer", at: 3, duration: 5, story: T, version: t1 });
    expect(Object.keys(atFirst.links)).toEqual([t1]);
    const proposed = await tool("propose_story_version", { story: F, variant: draft, note: "the first trailer again, drafted in two steps" });
    expect(proposed.error).toBeNull();
    const review = (await call("ada", "GET", `/api/intents/${proposed.out.intent}`)).data.review;
    expect(review.diff.tracks.find((x: any) => x.id === "trailer").changed[0].changes.map((c: any) => c.field).sort()).toEqual(["duration", "version"]);
    expect(review.edits.length).toBe(2);
    expect(review.baseStory.links[t2]).toMatchObject({ number: 2 });
    expect(review.story.links[t1]).toMatchObject({ number: 1 });
    await accept(proposed);
    const now = (await call("ada", "GET", `/api/stories/${F}`)).data;
    expect(now.tracks.find((x: any) => x.kind === "story").clips[0]).toEqual({ id: "trailer", at: 3, duration: 5, story: T, version: t1 });
    expect(now.duration).toBe(12);
    const hist = (await call("ada", "GET", `/api/docs/${F}/history`)).data;
    expect(hist.edits.map((s: any) => s.message)).toEqual(expect.arrayContaining(["back to the first trailer", "close the gap it leaves"]));
  });

  // a sandbox's layout, changed only by proposal: its own test, ./sandboxdocs.test.ts
});
