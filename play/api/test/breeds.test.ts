// Breeds (play/SPEC.md "Breeds"; intent 7c8085db-ccdb-44cf-8d6c-0ff984d71f41) against a real Postgres: set
// TEST_DATABASE_URL, as for ./api.test.ts.
//
// c1: a breed tracks Main. An edit accepted on Main appears in every breed, except on a field the breed overrides,
// where the breed keeps its value; a field both changed (a clash) keeps the breed's.
//
// c2: a breed changes by its own intent variant, seeded from it (propose_doc_version's `breed`), and a new breed is made
// by one too (`new_breed`); either Accept makes the asset's next frozen version, every breed's recipe built and its
// asset_variants row written.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import { hashText } from "../src/hash";
import { Rate } from "../src/limits";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { RECIPE_HEAD, recipeTail } from "../src/recipes";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

const SPEC = {
  goal: "A breed changes.",
  nothing_to_reduce: "A test fixture: nothing to reduce.",
  scope: "One breed. Nothing else changes.",
  checks: [{ check: "It holds", how: "test", by: "true", run: "true" }],
};
const SOURCE = (line: string) => `module.exports.recipe = function (id, v, variant) {\n  // ${line}\n  return { meta: { id, v, variant }, build: () => null };\n};\n`;

suite("breeds", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  let cookie = "";
  let token = "";
  let papaya = "";

  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await api.fetch(new Request(`http://play.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  let n = 0;
  /** a tool called over MCP by the admin's token: its result as JSON, or its error's text */
  const tool = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const r = await api.fetch(
      new Request("http://play.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }),
      }),
    );
    const res = (await r.json()).result;
    const text = res.content[0].text;
    return res.isError ? { error: text as string } : JSON.parse(text);
  };
  /** an intent in Build, its spec approved, its one must check passed: ready to take work (every edit is an intent's) */
  const readyIntent = async (title: string) => {
    const i = await tool("add_intent", { title });
    await tool("specify_intent", { intent: i.id, ...SPEC });
    expect((await call("POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] })).stage).toBe("proposal");
    return i.id as string;
  };
  const accept = async (intent: string) => (await call("POST", `/api/intents/${intent}/accept`)).data;
  const breedsOf = async () => (await tool("doc_history", { doc: papaya })).variants.filter((v: any) => v.type === "breed");
  const breed = async (name: string) => {
    const b = (await breedsOf()).find((x: any) => x.name === name);
    return (await tool("doc_at", { doc: papaya, breed: b.id })).json;
  };
  /** the asset's frozen head: its number and each variant's row */
  const head = async () => {
    const { rows } = await db.query<any>(`SELECT v.id, v.number, v.default_variant FROM play.assets a JOIN play.asset_versions v ON v.id = a.head WHERE a.id = $1`, [papaya]);
    const { rows: xs } = await db.query<any>(`SELECT name, recipe_hash, source_hash, card FROM play.asset_variants WHERE version_id = $1 ORDER BY name`, [rows[0].id]);
    return { ...rows[0], variants: Object.fromEntries(xs.map((x) => [x.name, x])) };
  };

  beforeAll(async () => {
    name = `play_breeds_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    await initSessions(db);
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0) });
    const h = await createHuman(db, "ada");
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [h.id]);
    cookie = `play_session=${tokenFor(h.id)}`;
    token = (await call("POST", "/api/tokens", { name: "agent" })).data.token;

    // a papaya of two kinds, proposed as a version of variants and accepted: its variants are its breeds from then on
    const made = await tool("propose_asset", { lod: { levels: "derived" },
      group: "plants", label: "Papaya", note: "its first version", default_variant: "female", intent: await readyIntent("A papaya of two kinds"),
      variants: [
        { name: "female", label: "Papaya: Female", source: SOURCE("a female papaya") },
        { name: "male", label: "Papaya: Male", source: SOURCE("a male papaya") },
      ],
    });
    expect(made.error).toBeUndefined();
    expect((await accept(made.intent)).decision).toMatchObject({ status: "accepted", number: 1 });
    papaya = made.asset;
  });
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  test("an asset's variants are breeds of its document beside Main, Main holding none", async () => {
    expect((await breedsOf()).map((b: any) => b.name)).toEqual(["female", "male"]);
    const main = (await tool("doc_at", { doc: papaya })).json;
    expect(main.variants).toBeUndefined();
    expect(main.defaultVariant).toBe("female");
    expect((await breed("female")).source).toContain("a female papaya");
    expect((await breed("male")).source).toContain("a male papaya");
    expect((await breed("male")).card.card.label).toBe("Papaya: Male");
    // the asset viewer's chips: the frozen version's variants, as before
    expect(Object.keys((await head()).variants)).toEqual(["female", "male"]);
  });

  test("c1: an edit accepted on Main appears in every breed, except where a breed overrides the field; a clash keeps the breed's", async () => {
    const main = (await tool("doc_at", { doc: papaya })).json;
    // Main's source is its default breed's (female overrides no source; male does), its card female's
    expect(main.source).toContain("a female papaya");
    const p = await tool("propose_doc_version", {
      doc: papaya, note: "taller, and noted", intent: await readyIntent("A taller papaya"),
      edits: [
        { op: "replace", find: "a female papaya", replace: "a taller papaya" },
        { op: "set", path: ["note"], value: "grown taller" },
        { op: "set", path: ["card", "card", "height"], value: 3 },
        { op: "set", path: ["card", "card", "label"], value: "Papaya" },
      ],
    });
    expect(p.error).toBeUndefined();
    expect((await accept(p.intent)).decision).toMatchObject({ status: "accepted", number: 2 });
    const female = await breed("female"), male = await breed("male");
    // a field no breed overrides: in every breed
    for (const b of [female, male]) {
      expect(b.note).toBe("grown taller");
      expect(b.card.card.height).toBe(3);
    }
    // the source: female overrides none, so takes Main's; male overrides it, and keeps its own (a clash: the breed's)
    expect(female.source).toContain("a taller papaya");
    expect(male.source).toContain("a male papaya");
    expect(male.source).not.toContain("taller");
    // the card's label: female's card was Main's (it overrides none of it) and takes Main's; male overrides it (a
    // clash): it keeps its own
    expect(female.card.card.label).toBe("Papaya");
    expect(male.card.card.label).toBe("Papaya: Male");
    // the breed's history: the merge of Main into it
    const b = (await breedsOf()).find((x: any) => x.name === "male");
    const own = (await tool("doc_history", { doc: papaya, variant: b.id })).edits;
    expect(own.at(-1)).toMatchObject({ kind: "merge", message: "tracks Main v2" });
    // the frozen version: every breed built as its variant, from the breed as it now is
    const v2 = await head();
    expect(v2.number).toBe(2);
    expect(v2.variants.female.source_hash).toBe(hashText(female.source));
    expect(v2.variants.male.source_hash).toBe(hashText(male.source));
    expect(v2.variants.female.recipe_hash).toBe(hashText(RECIPE_HEAD + female.source + recipeTail("papaya", 2, "female")));
    expect(v2.variants.male.recipe_hash).toBe(hashText(RECIPE_HEAD + male.source + recipeTail("papaya", 2, "male")));
    expect(v2.variants.male.card.card).toMatchObject({ label: "Papaya: Male", height: 3 });
  });

  test("c2: a breed changes by its own intent variant seeded from it; its Accept makes the next frozen version with every breed built", async () => {
    const male = (await breedsOf()).find((x: any) => x.name === "male");
    const was = await head();
    // a breed changes only its own fields
    const wrong = await tool("propose_doc_version", { doc: papaya, breed: male.id, intent: await readyIntent("A male's note"), note: "a male's note", edits: [{ op: "set", path: ["note"], value: "only the male" }] });
    expect(wrong.error).toContain("A breed changes only its own source and card");
    // edited in an intent variant seeded from the breed, edit by edit, then proposed
    const stronger = await readyIntent("A stronger male papaya");
    const one = await tool("doc_edit", { doc: papaya, intent: stronger, breed: male.id, message: "a stronger male", edits: [{ op: "replace", find: "a male papaya", replace: "a stronger male papaya" }] });
    expect(one).toMatchObject({ changed: true, edits: 1 });
    const hist = await tool("doc_history", { doc: papaya });
    expect(hist.variants.find((v: any) => v.id === one.variant)).toMatchObject({ type: "intent", breed: male.id, breedName: "male", seed: 2 });
    const p = await tool("propose_doc_version", { doc: papaya, variant: one.variant, intent: stronger, note: "the male, stronger" });
    expect(p.error).toBeUndefined();
    const review = (await call("GET", `/api/intents/${p.intent}`)).data.review;
    expect(review.doc).toMatchObject({ id: papaya, breed: "male" });
    expect(review.changes.map((c: any) => c.path)).toEqual(["$.source"]);
    // Main stays as it was until it is accepted
    expect((await breed("male")).source).not.toContain("stronger");
    expect((await accept(p.intent)).decision).toMatchObject({ status: "accepted", number: was.number + 1 });
    const v = await head();
    expect(v.number).toBe(was.number + 1);
    const m = await breed("male"), f = await breed("female");
    expect(m.source).toContain("a stronger male papaya");
    expect(v.variants.male.source_hash).toBe(hashText(m.source));
    expect(v.variants.male.recipe_hash).toBe(hashText(RECIPE_HEAD + m.source + recipeTail("papaya", v.number, "male")));
    // the other breed, unchanged, built again as the new version's
    expect(v.variants.female.source_hash).toBe(was.variants.female.source_hash);
    expect(v.variants.female.recipe_hash).toBe(hashText(RECIPE_HEAD + f.source + recipeTail("papaya", v.number, "female")));
    // Main unchanged: the same document, a version named all the same
    const at = await tool("doc_at", { doc: papaya });
    expect(at.number).toBe(v.number);
    expect(at.json.source).toContain("a taller papaya");
  });

  test("c2: a new breed is made by an intent too, and tracks Main from then on", async () => {
    const was = await head();
    const p = await tool("propose_doc_version", {
      doc: papaya, new_breed: "hermaphrodite", note: "a third kind", intent: await readyIntent("A third kind"),
      edits: [{ op: "set", path: ["card", "card", "label"], value: "Papaya: Hermaphrodite" }],
    });
    expect(p.error).toBeUndefined();
    expect((await accept(p.intent)).decision).toMatchObject({ status: "accepted", number: was.number + 1 });
    expect((await breedsOf()).map((b: any) => b.name)).toEqual(["female", "hermaphrodite", "male"]);
    const v = await head();
    expect(Object.keys(v.variants)).toEqual(["female", "hermaphrodite", "male"]);
    expect(v.variants.hermaphrodite.card.card.label).toBe("Papaya: Hermaphrodite");
    // a name a breed has is taken
    expect((await tool("doc_edit", { doc: papaya, intent: await readyIntent("A second male"), new_breed: "male", message: "again", edits: [{ op: "set", path: ["card", "card", "label"], value: "x" }] })).error).toContain("breed male already");
    // Main moves: the new breed takes it, keeping its own label
    const q = await tool("propose_doc_version", { doc: papaya, intent: await readyIntent("Taller still"), note: "taller still", edits: [{ op: "replace", find: "a taller papaya", replace: "a tallest papaya" }] });
    expect((await accept(q.intent)).decision.status).toBe("accepted");
    const h = await breed("hermaphrodite");
    expect(h.source).toContain("a tallest papaya");
    expect(h.card.card.label).toBe("Papaya: Hermaphrodite");
    expect((await breed("female")).source).toContain("a tallest papaya");
    expect((await breed("male")).source).toContain("a stronger male papaya");
    expect(Object.keys((await head()).variants)).toEqual(["female", "hermaphrodite", "male"]);
  });

  test("an asset of breeds is changed through its document, so every breed is built from it", async () => {
    const r = await call("POST", "/api/intents", { asset: papaya, intent: await readyIntent("A whole new papaya"), source: SOURCE("a whole new papaya"), note: "over every breed" });
    expect(r.status).toBe(409);
    expect(r.data.error).toContain("This asset has breeds");
  });
});
