// Assets as Loro documents (src/assetdocs.ts, play/SPEC.md §4.4) against a real Postgres: set TEST_DATABASE_URL, as for
// api.test.ts. Each asset's history made from its versions (sources byte for byte, ids, hashes and pins unchanged), the
// papaya's kept rounds between v1 and v2, intents' work as intent variants (doc_edit's edits proposed with
// propose_doc_version), the recipe file at any edit, and the code rule: a merge that met other edits needs its previewed hash.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore, keyOf, type BlobStore } from "../src/blobs";
import { meOf } from "../src/access";
import { assetOf, catalogOf, pinsOf } from "../src/assets";
import { leveled } from "./fixtures/lod";
import { assetDocId, ensureAssetDocs, HISTORY, proposeAsset, recipeAt } from "../src/assetdocs";
import * as docs from "../src/docs";
import { hashText } from "../src/hash";
import { readSource } from "../import/sources";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { decide as decideWith, docEdit, docHistory, proposeDocVersion, reviewOf } from "../src/versioned";
import { RECIPE_HEAD, recipeTail } from "../src/recipes";
import { Rate } from "../src/limits";
import { makeToken } from "../src/tokens";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const COOP = "12f8d4e7-701f-8727-a327-de9b240ea867";
const src = (body: string) => `module.exports.recipe = function (id, v, variant) {\n  // ${body}\n  return { meta: {}, build() { return null; } };\n};\n`;

suite("assets as documents", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string, store: BlobStore, api: ReturnType<typeof app>;
  const who: Record<string, { id: string; cookie: string }> = {};
  const ids: Record<string, string> = {};
  /** the versions written here, by asset slug: number -> { id, source text, recipe hash } */
  const written: Record<string, Record<number, { id: string; source: string; recipe: string | null }>> = {};

  const put = async (text: string) => {
    const hash = hashText(text);
    const key = await store.put(hash, new TextEncoder().encode(text), "text/javascript");
    await db.query(`INSERT INTO play.files (hash, size, media_type, bucket_key) VALUES ($1, $2, 'text/javascript', $3) ON CONFLICT DO NOTHING`, [hash, Buffer.byteLength(text), key]);
    return hash;
  };
  /** an asset with versions written as the legacy import writes them (or as accepted proposals left them) */
  /** the papaya, whose kept rounds are in ../import/history/<its id> */
  const PAPAYA = "e46e8e6f-cd69-5c1e-88c8-cea2032bf600";
  async function writeAsset(grp: string, slug: string, versions: { n: number; source: string; variants?: Record<string, string>; author?: string; imported?: boolean; created?: string }[], id: string = crypto.randomUUID()) {
    ids[slug] = id;
    written[slug] = {};
    await db.query(`INSERT INTO play.assets (id, coop_id, grp, slug, label) VALUES ($1, $2, $3, $4, $5)`, [id, COOP, grp, slug, slug[0].toUpperCase() + slug.slice(1)]);
    let parent: string | null = null;
    for (const v of versions) {
      const vid = hashText(`${slug}|${v.n}|${v.source}`);
      const sourceHash = await put(v.source);
      const card = { kind: "recipe", card: { group: grp, id: slug, version: v.n, label: `${slug} v${v.n}`, params: [{ id: "stage", kind: "number" }] }, manifest: { libs: ["three"] } };
      if (v.variants) {
        await db.query(
          `INSERT INTO play.asset_versions (id, asset_id, parents, number, default_variant, card, engine, note, author, imported, created) VALUES ($1, $2, $3, $4, $5, ($6::text)::jsonb, 5, $7, $8, $9, COALESCE($10::timestamptz, now()))`,
          [vid, id, parent ? [parent] : [], v.n, Object.keys(v.variants)[0], JSON.stringify(card), `version ${v.n}`, v.author ?? null, v.imported === false ? null : JSON.stringify({ from: "avendb" }), v.created ?? null],
        );
        for (const [vn, vs] of Object.entries(v.variants)) {
          const s = await put(vs);
          const r = await put(RECIPE_HEAD + vs + recipeTail(slug, v.n, vn));
          await db.query(`INSERT INTO play.asset_variants (version_id, name, recipe_hash, source_hash, card) VALUES ($1, $2, $3, $4, ($5::text)::jsonb)`, [vid, vn, r, s, JSON.stringify({ ...card, card: { ...card.card, variant: vn, recipe: r } })]);
        }
        written[slug][v.n] = { id: vid, source: v.variants[Object.keys(v.variants)[0]], recipe: null };
      } else {
        const recipe = await put(RECIPE_HEAD + v.source + recipeTail(slug, v.n, null));
        await db.query(
          `INSERT INTO play.asset_versions (id, asset_id, parents, number, recipe_hash, source_hash, card, engine, note, author, imported, created) VALUES ($1, $2, $3, $4, $5, $6, ($7::text)::jsonb, 5, $8, $9, $10, COALESCE($11::timestamptz, now()))`,
          [vid, id, parent ? [parent] : [], v.n, recipe, sourceHash, JSON.stringify({ ...card, card: { ...card.card, recipe } }), `version ${v.n}`, v.author ?? null, v.imported === false ? null : JSON.stringify({ from: "avendb" }), v.created ?? null],
        );
        written[slug][v.n] = { id: vid, source: v.source, recipe };
      }
      parent = vid;
    }
    await db.query(`UPDATE play.assets SET head = $2 WHERE id = $1`, [id, parent]);
    return id;
  }

  beforeAll(async () => {
    name = `play_assetdocs_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    await initSessions(db);
    store = folderStore(mkdtempSync(join(tmpdir(), "play-assetdocs-")));
    api = app({ db, store, rate: new Rate(0) });
    for (const n of ["ada", "cit"]) {
      const h = await createHuman(db, n);
      who[n] = { id: h.id, cookie: `play_session=${tokenFor(h.id)}` };
    }
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [who.ada.id]);
    await db.query(`UPDATE play.memberships SET level = 'citizen' WHERE human_id = $1`, [who.cit.id]);
  });
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });
  const me = (n: string) => meOf(db, who[n].id);
  const ctx = () => ({ db, store });
  const decide = (_db: Db, _store: BlobStore, m: any, id: string, v: "accept" | "archive") => decideWith(ctx(), m, id, v);
  const propose: typeof proposeAsset = (db, store, me, body, via) => proposeAsset(db, store, me, leveled(body), via);
  const history = async (m: any, id: string) => docHistory(ctx(), m, id);

  test("every asset's history is made from its versions: each version a step named its own number, its source byte for byte, nothing else changed", async () => {
    await writeAsset("plants", "fern", [{ n: 1, source: src("first") }, { n: 2, source: src("second, a frond more") }, { n: 4, source: src("fourth: legacy skipped a number") }]);
    await writeAsset("things", "lamp", [{ n: 1, source: src("lamp"), variants: { off: src("lamp"), on: src("lamp, lit") } }, { n: 2, source: src("one lamp") }]);
    await db.query(`INSERT INTO play.sandbox_pins (sandbox_id, slot, version_id) VALUES ('ec08b07d-6ec0-8f65-92b2-3efe7d91df5d', 'fern', $1)`, [written.fern[2].id]);
    // an intent's work decided before the documents: an intent variant of its own, closed as it was
    const rejected = hashText("fern|rejected");
    const rs = await put(src("a rejected fern"));
    const rr = await put(RECIPE_HEAD + src("a rejected fern") + recipeTail("fern", 5, null));
    await db.query(`INSERT INTO play.asset_versions (id, asset_id, parents, recipe_hash, source_hash, card, engine, author, note) VALUES ($1, $2, $3, $4, $5, '{"card":{}}', 5, $6, 'not this')`, [rejected, ids.fern, [written.fern[4].id], rr, rs, who.cit.id]);
    await db.query(
      `INSERT INTO play.intents (id, coop_id, kind, title, stage, author, via, work, asset_id, base, version, work_note, proposed_by, proposed_via, proposed_at)
       VALUES ($1, $2, 'improve', 'Fern v5', 'archived', $6, 'web', 'asset_version', $3, $4, $5, 'not this', $6, 'web', now())`,
      [crypto.randomUUID(), COOP, ids.fern, written.fern[4].id, rejected, who.cit.id],
    );

    const before = { catalog: await catalogOf(db), pins: await pinsOf(db, "ec08b07d-6ec0-8f65-92b2-3efe7d91df5d"), versions: (await db.query(`SELECT id, number, recipe_hash, source_hash FROM play.asset_versions ORDER BY id`)).rows };
    const r = await ensureAssetDocs(db, store);
    expect(r.errors).toEqual([]);
    expect(r.made).toBe(2);
    expect(r.variants).toBe(1);
    // the versions, the catalog and the pins are exactly as they were
    expect((await db.query(`SELECT id, number, recipe_hash, source_hash FROM play.asset_versions ORDER BY id`)).rows).toEqual(before.versions);
    expect(await catalogOf(db)).toEqual(before.catalog);
    expect(await pinsOf(db, "ec08b07d-6ec0-8f65-92b2-3efe7d91df5d")).toEqual(before.pins);
    // each version's step holds its source byte for byte, under its own number (a gap kept)
    const fern = await docs.versionsOf(db, assetDocId(ids.fern));
    expect(fern.map((v) => v.number)).toEqual([1, 2, 4]);
    for (const n of [1, 2, 4]) expect((await docs.stateAt(db, assetDocId(ids.fern), { version: n })).source).toBe(written.fern[n].source);
    const lamp1 = await docs.stateAt(db, assetDocId(ids.lamp), { version: 1 });
    expect(lamp1.defaultVariant).toBe("off");
    expect(lamp1.variants.map((x: any) => [x.name, x.source ?? null])).toEqual([["off", null], ["on", src("lamp, lit")]]);
    expect((await docs.stateAt(db, assetDocId(ids.lamp), { version: 2 })).source).toBe(src("one lamp"));
    // the rejected work: an intent variant seeded at v4, closed, naming its intent
    const { rows: br } = await db.query<any>(`SELECT b.status FROM play.intents i JOIN play.intent_variants iv ON iv.intent_id = i.id JOIN play.doc_variants b ON b.id = iv.variant_id AND b.intent_id = i.id WHERE i.version = $1`, [rejected]);
    expect(br[0].status).toBe("archived");
    // run again, nothing new
    const again = await ensureAssetDocs(db, store);
    expect([again.made, again.variants, again.errors.length]).toEqual([0, 0, 0]);
  });

  test("the papaya's nine kept rounds stand between v1 and v2, by Maia over MCP, and lead to v2 byte for byte", async () => {
    const v1 = readSource("plants/papaya@963cc9dfc684.js");
    const v2 = readFileSync(join(HISTORY, PAPAYA, "v2.js"), "utf8");
    await writeAsset("plants", "papaya", [{ n: 1, source: v1, created: "2026-11-02T11:03:54Z" }, { n: 2, source: v2, author: who.ada.id, imported: false, created: "2026-11-03T08:52:33Z" }], PAPAYA);
    const r = await ensureAssetDocs(db, store);
    expect(r.errors).toEqual([]);
    expect(r.kept).toBe(9);
    const h: any = await history(await me("ada"), ids.papaya);
    expect(h.edits.map((s: any) => s.message.split(":")[0])).toEqual(["v1", ...Array.from({ length: 9 }, (_, i) => `round ${i + 1}`), "v2"]);
    expect(h.edits.filter((s: any) => s.message.startsWith("round")).every((s: any) => s.via === "mcp" && s.author === "ada")).toBe(true);
    expect(h.edits.map((s: any) => s.version)).toEqual([1, null, null, null, null, null, null, null, null, null, 2]);
    const index = JSON.parse(readFileSync(join(HISTORY, PAPAYA, "index.json"), "utf8"));
    for (const [i, s] of h.edits.slice(1, 10).entries()) expect(hashText((await docs.stateAt(db, assetDocId(ids.papaya), { edit: s.seq })).source)).toBe(index.steps[i].hash);
    expect((await docs.stateAt(db, assetDocId(ids.papaya), { version: 2 })).source).toBe(v2);

    // the recipe file at a step: a version's own at its point, one made the same way at a round, kept by its hash
    const atV2 = await recipeAt(db, store, await me("ada"), ids.papaya, { edit: h.edits[10].seq });
    expect(atV2.hash).toBe(written.papaya[2].recipe!);
    expect(atV2.version).toBe(2);
    const r5 = readFileSync(join(HISTORY, PAPAYA, "round5.js"), "utf8");
    const at5 = await recipeAt(db, store, await me("ada"), ids.papaya, { edit: h.edits[5].seq });
    expect(at5.hash).toBe(hashText(RECIPE_HEAD + r5 + recipeTail("papaya", 2, null)));
    expect(at5.v).toBe(2);
    expect(at5.record.card.recipe).toBe(at5.hash);
    expect(new TextDecoder().decode((await store.get(at5.hash))!)).toBe(RECIPE_HEAD + r5 + recipeTail("papaya", 2, null));
    expect((await recipeAt(db, store, await me("ada"), ids.papaya, { edit: h.edits[5].seq })).hash).toBe(at5.hash);
    // admins only
    await expect(recipeAt(db, store, await me("cit"), ids.papaya, { edit: h.edits[5].seq })).rejects.toThrow();
    const http = await api.fetch(new Request(`http://play.test/api/docs/${ids.papaya}/history`, { headers: { cookie: who.cit.cookie } }));
    expect(http.status).toBe(403);
    const ok = await api.fetch(new Request(`http://play.test/api/assets/${ids.papaya}/recipe?edit=${h.edits[3].seq}`, { headers: { cookie: who.ada.cookie } }));
    expect(ok.status).toBe(200);
  });

  /** an intent in Build, its spec approved and its one must check passed: what an edit and work are made for (no work without an intent) */
  const building = async (title: string) => {
    const id = crypto.randomUUID();
    const spec = { goal: "It changes.", scope: "A test fixture.", checks: [{ id: "c1", check: "It holds", how: "test", by: "true", run: "true", must: true, step: "mvp" }] };
    const results = { c1: { pass: true, evidence: "exit 0", by: null, at: new Date().toISOString() } };
    await db.query(
      `INSERT INTO play.intents (id, coop_id, kind, title, stage, author, via, spec, results, approved_by, approved_at) VALUES ($1, $2, 'improve', $3, 'build', $4, 'mcp', ($5::text)::jsonb, ($6::text)::jsonb, $4, now())`,
      [id, COOP, title, who.ada.id, JSON.stringify(spec), JSON.stringify(results)],
    );
    return id;
  };

  test("an intent variant made edit by edit with doc_edit is proposed with its edits and accepted as the version", async () => {
    const ada = (await me("ada"))!;
    const intent = await building("A curled frond");
    await expect(docEdit(ctx(), ada, { doc: ids.fern, message: "no intent", edits: [{ op: "replace", find: "legacy skipped a number", replace: "x" }] })).rejects.toThrow(/intent/);
    const s1 = await docEdit(ctx(), ada, { doc: ids.fern, intent, message: "a longer frond", edits: [{ op: "replace", find: "legacy skipped a number", replace: "a longer frond" }] });
    expect(s1.changed).toBe(true);
    const s2 = await docEdit(ctx(), ada, { doc: ids.fern, intent, variant: s1.variant, message: "and a curl", edits: [{ op: "replace", find: "a longer frond", replace: "a longer frond, curled at its tip" }] });
    expect(s2.edits).toBe(2);
    // a find that stands twice, or nowhere, is refused
    await expect(docEdit(ctx(), ada, { doc: ids.fern, intent, variant: s1.variant, message: "x", edits: [{ op: "replace", find: "nowhere at all", replace: "y" }] })).rejects.toThrow(/not in the source/);
    // Main is untouched by an intent variant
    expect((await docs.readDoc(db, assetDocId(ids.fern))).json.source).toBe(written.fern[4].source);
    // its head is from before the contract and names no levels of detail: the new version is refused until it names them
    await expect(proposeDocVersion(ctx(), ada, { doc: ids.fern, note: "a curled frond", variant: s1.variant, intent }, "mcp")).rejects.toThrow(/names its levels of detail/);
    await docEdit(ctx(), ada, { doc: ids.fern, intent, variant: s1.variant, message: "its levels derived", edits: [{ op: "set", path: ["card", "card", "lod"], value: { levels: "derived" } }] });
    const p: any = await proposeDocVersion(ctx(), ada, { doc: ids.fern, note: "a curled frond", variant: s1.variant, intent }, "mcp");
    expect(p.variant).toBe(s1.variant);
    expect(p.number).toBe(5);
    expect(p.edits).toBeGreaterThanOrEqual(3);
    const review: any = await reviewOf(db, p.intent, {});
    expect(review.edits.map((s: any) => s.message).slice(0, 2)).toEqual(["a longer frond", "and a curl"]);
    expect(review.changes.map((c: any) => c.path)).toContain("$.source");
    const d = await decide(db, store, ada, p.intent, "accept");
    expect(d).toMatchObject({ status: "accepted", number: 5, intent: p.intent, stage: "accepted" });
    const vs = await docs.versionsOf(db, assetDocId(ids.fern));
    expect(vs.map((v) => v.number)).toEqual([1, 2, 4, 5]);
    const head = (await docs.readDoc(db, assetDocId(ids.fern))).json;
    expect(head.source).toContain("a longer frond, curled at its tip");
    const { rows } = await db.query<any>(`SELECT v.source_hash, v.recipe_hash FROM play.asset_versions v WHERE v.asset_id = $1 AND v.number = 5`, [ids.fern]);
    expect(rows[0].source_hash).toBe(hashText(head.source));
    expect(rows[0].recipe_hash).toBe(hashText(RECIPE_HEAD + head.source + recipeTail("fern", 5, null)));
    // the history now holds the intent variant's edits where they were made, and v5
    const h: any = await history(ada, ids.fern);
    expect(h.edits.at(-1)?.version).toBe(5);
  });

  test("an intent variant seeded from an older head is refused when proposed; work proposed over the web gets an intent variant, archived by its author it is closed", async () => {
    const ada = (await me("ada"))!, cit = (await me("cit"))!;
    const intent = await building("A brighter lamp");
    // no work without an intent: a citizen's, or an admin's naming none, is refused and nothing is written
    const before = (await db.query(`SELECT count(*)::int AS n FROM play.doc_variants`)).rows[0].n;
    await expect(propose(db, store, cit, { asset: ids.lamp, note: "a dimmer lamp", source: src("one dim lamp") })).rejects.toThrow();
    await expect(propose(db, store, ada, { asset: ids.lamp, note: "a dimmer lamp", source: src("one dim lamp") })).rejects.toThrow(/add_intent/);
    expect((await db.query(`SELECT count(*)::int AS n FROM play.doc_variants`)).rows[0].n).toBe(before);
    const old = await docEdit(ctx(), ada, { doc: ids.lamp, intent, message: "brighter", edits: [{ op: "replace", find: "one lamp", replace: "one bright lamp" }] });
    const web = await propose(db, store, ada, { asset: ids.lamp, note: "a dimmer lamp", source: src("one dim lamp"), intent: await building("A dimmer lamp") });
    expect(web.variant).toBeGreaterThan(0);
    await decide(db, store, ada, web.intent, "accept");
    await expect(proposeDocVersion(ctx(), ada, { doc: ids.lamp, note: "brighter", variant: old.variant, intent }, "mcp")).rejects.toThrow(/newer version/);
    const again = await propose(db, store, ada, { asset: ids.lamp, note: "warmer", source: src("one warm lamp"), intent: await building("A warmer lamp") });
    await decide(db, store, ada, again.intent, "archive");
    const { rows } = await db.query<any>(`SELECT status FROM play.doc_variants WHERE id = $1`, [again.variant]);
    expect(rows[0].status).toBe("archived");
    // a new asset's first version: its document starts empty, its intent variant fills it
    const fresh = await propose(db, store, ada, { new: { group: "things", slug: "stool", label: "Stool" }, note: "a stool", source: src("a stool"), intent: await building("A stool") });
    await decide(db, store, ada, fresh.intent, "accept");
    const stool = await docs.readDoc(db, assetDocId(fresh.asset));
    expect(stool.json.source).toBe(src("a stool"));
    expect(stool.versions.map((v) => v.number)).toEqual([1]);
  });

  test("code is never merged unseen: an intent variant whose merge met other edits is accepted only with its previewed hash", async () => {
    const id = assetDocId(ids.fern);
    const a: docs.Author = { human: who.ada.id, via: "mcp" };
    const b1 = await docs.variant(db, id, { author: a });
    const b2 = await docs.variant(db, id, { author: a });
    const cur = (await docs.readDoc(db, id)).json;
    await docs.commit(db, id, { variant: b1.id, target: { ...cur, note: "one" }, message: "one", author: a });
    await docs.commit(db, id, { variant: b2.id, target: { ...cur, source: cur.source + "// two\n" }, message: "two", author: a });
    await docs.propose(db, id, b1.id, { note: "one", author: a });
    await docs.propose(db, id, b2.id, { note: "two", author: a });
    await docs.accept(db, id, b1.id, { author: a });
    const err = await docs.accept(db, id, b2.id, { author: a }).catch((e) => e);
    expect(err.extra?.needsPreview).toBe(true);
    const preview = await docs.previewMerge(db, id, b2.id);
    const v = await docs.accept(db, id, b2.id, { author: a, mergedHash: preview.contentHash });
    expect(v.contentHash).toBe(preview.contentHash);
  });

  test("a new version names its levels", async () => {
    const ada = (await me("ada"))!;
    const PARAMS = [{ id: "detail", label: "Detail", type: "number", value: 1, min: 0.05, max: 1 }];
    const derived = src("a stool, its levels derived");
    const declared = `${src("a shrub of its own levels")}module.exports.levels = [\n  { values: { detail: 0.25 } }, // L1\n  { values: { detail: 0.1 } }, // L2\n];\n`;
    const make = (body: any) => proposeAsset(db, store, ada, { new: { group: "plants", label: "Shrub" }, note: "levels", ...body });
    // a new asset version without card.lod is refused, saying so, and nothing is written
    const before = (await db.query(`SELECT count(*)::int AS n FROM play.asset_versions`)).rows[0].n;
    await expect(make({ source: derived, intent: await building("A stool") })).rejects.toThrow(/names its levels of detail on its card: lod = \{ levels: 'declared' \}/);
    expect((await db.query(`SELECT count(*)::int AS n FROM play.asset_versions`)).rows[0].n).toBe(before);
    // its shape and its source are held to it: an unknown level kind, a declared one its source doesn't export, a
    // derived one whose source exports levels, a level setting a value no param declares
    await expect(make({ source: derived, card: { lod: { levels: "some" } }, intent: await building("A stool") })).rejects.toThrow(/'declared'.*'derived'/);
    await expect(make({ source: derived, card: { lod: { levels: "declared" } }, intent: await building("A stool") })).rejects.toThrow(/declares none/);
    await expect(make({ source: declared, card: { params: PARAMS, lod: { levels: "derived" } }, intent: await building("A shrub") })).rejects.toThrow(/name them with lod.levels 'declared'/);
    await expect(make({ source: declared, card: { lod: { levels: "declared" } }, intent: await building("A shrub") })).rejects.toThrow(/params don't declare/);
    await expect(make({ source: `${derived}module.exports.levels = LEVELS;\n`, card: { params: PARAMS, lod: { levels: "declared" } }, intent: await building("A shrub") })).rejects.toThrow(/plain literal/);
    // with lod it is taken: derived, as named; declared, its levels read from its source onto its card
    const a = await make({ source: derived, card: { lod: { levels: "derived", budgets: [4000, 1200, 320] } }, intent: await building("A stool") });
    const ca = (await db.query<any>(`SELECT card FROM play.asset_versions WHERE id = $1`, [a.version])).rows[0].card;
    expect(ca.card.lod).toEqual({ levels: "derived", budgets: [4000, 1200, 320] });
    const b = await make({ source: declared, card: { params: PARAMS, lod: { levels: "declared" } }, intent: await building("A shrub") });
    const cb = (await db.query<any>(`SELECT card FROM play.asset_versions WHERE id = $1`, [b.version])).rows[0].card;
    expect(cb.card.lod).toEqual({ levels: "declared", values: [{ detail: 0.25 }, { detail: 0.1 }] });
    // accepted, its next version carries its levels on from its head
    await decide(db, store, ada, a.intent, "accept");
    const next = await proposeAsset(db, store, ada, { asset: a.asset, note: "a taller stool", source: src("a taller stool"), intent: await building("A taller stool") });
    expect((await db.query<any>(`SELECT card FROM play.asset_versions WHERE id = $1`, [next.version])).rows[0].card.card.lod).toEqual({ levels: "derived", budgets: [4000, 1200, 320] });
    // an existing version, from before the contract, names none and is read as derived
    const old = await assetOf(db, await writeAsset("plants", "old-shrub", [{ n: 1, source: src("an old shrub") }, { n: 2, source: src("an old shrub, taller") }]));
    expect(old.versions.map((v: any) => v.lod)).toEqual([{ levels: "derived" }, { levels: "derived" }]);
  });

  test("over MCP: doc_edit, doc_history, get_asset at an edit", async () => {
    const ada = await me("ada");
    const { token } = await makeToken(db, ada, "test");
    const call = async (name: string, args: unknown) => {
      const r = await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
      return (await r.json()).result;
    };
    const list = await (await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }))).json();
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(["doc_edit", "doc_history", "get_asset", "propose_doc_version"]));
    expect(names).not.toContain("asset_edit");
    const intent = await building("A taller papaya");
    expect((await call("doc_edit", { doc: ids.papaya, message: "a taller trunk", edits: [{ op: "set", path: ["note"], value: "taller" }] })).isError).toBe(true);
    const e = await call("doc_edit", { doc: ids.papaya, intent, message: "a taller trunk", edits: [{ op: "set", path: ["note"], value: "taller" }] });
    expect(e.isError).toBeFalsy();
    expect(e.structuredContent.variant).toBeGreaterThan(0);
    const h = await call("doc_history", { doc: ids.papaya });
    expect(h.structuredContent.edits.length).toBe(11);
    expect(h.structuredContent.variants.find((v: any) => v.id === e.structuredContent.variant)).toMatchObject({ type: "intent", status: "open", seed: 2, edits: 1, intent: { id: intent } });
    const at = await call("get_asset", { asset: ids.papaya, edit: h.structuredContent.edits[3].seq });
    expect(hashText(at.structuredContent.source)).toBe(at.structuredContent.sourceHash);
    const mine = await call("get_asset", { asset: ids.papaya, intent: "00000000-0000-4000-8000-000000000000" });
    expect(mine.isError).toBe(true);
    const bad = await call("doc_edit", { doc: ids.papaya, intent, message: "x", edits: [{ op: "set", path: ["schema"], value: "asset/2" }] });
    expect(bad.isError).toBe(true);
  });
});
