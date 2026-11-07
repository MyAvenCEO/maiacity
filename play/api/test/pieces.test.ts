// A recipe names a shared piece by hash (play/SPEC.md §4.5; intent 5a15e468) against a real Postgres: set
// TEST_DATABASE_URL, as for api.test.ts. A piece is a document of its own schema, made and changed by an intent's
// variant; each accepted version's source is kept among play's files by its hash; a minified piece is refused; an
// asset's version may require only an accepted piece version's hash, and keeps building the version it names.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { meOf } from "../src/access";
import { proposeAsset } from "../src/assetdocs";
import { createHuman } from "../src/auth";
import { folderStore, type BlobStore } from "../src/blobs";
import { hashText } from "../src/hash";
import { SCHEMA } from "../src/ids";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { MOST_DEEP, piecesShown } from "../src/pieces";
import { decide, docAt, docHistory, listDocs, proposeDocVersion } from "../src/versioned";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const COOP = "12f8d4e7-701f-8727-a327-de9b240ea867";

const pieceSource = (n: number) => `// the kit's wheels, as written\nconst three = require("three");\nmodule.exports.wheels = ${n};\nmodule.exports.three = three;\n`;
const assetSource = (piece: string) =>
  `const kit = require("${piece}");\nmodule.exports.recipe = function (id, v, variant) {\n  return { meta: { id, v, variant }, build() { return kit.wheels; } };\n};\n`;

suite("pieces", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string, store: BlobStore;
  let ada: string;
  const ctx = () => ({ db, store });
  const me = () => meOf(db, ada);

  /** an intent in Build, its spec approved and its one must check passed (no work without an intent) */
  const building = async (title: string) => {
    const id = crypto.randomUUID();
    const spec = { goal: "It changes.", scope: "A test fixture.", checks: [{ id: "c1", check: "It holds", how: "test", by: "true", run: "true", must: true, step: "mvp" }] };
    const results = { c1: { pass: true, evidence: "exit 0", by: null, at: new Date().toISOString() } };
    await db.query(
      `INSERT INTO play.intents (id, coop_id, kind, title, stage, author, via, spec, results, approved_by, approved_at) VALUES ($1, $2, 'improve', $3, 'build', $4, 'mcp', ($5::text)::jsonb, ($6::text)::jsonb, $4, now())`,
      [id, COOP, title, ada, JSON.stringify(spec), JSON.stringify(results)],
    );
    return id;
  };
  /** a new piece proposed and accepted: its UUID */
  const newPiece = async (label: string, source: string) => {
    const p = await proposeDocVersion(ctx(), await me(), { kind: "piece", whole: { schema: "piece/1", label, source }, note: `${label}, a piece`, intent: await building(label) });
    expect((await decide(ctx(), await me(), p.intent, "accept")).status).toBe("accepted");
    return p.doc as string;
  };

  beforeAll(async () => {
    name = `play_pieces_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    store = folderStore(mkdtempSync(join(tmpdir(), "play-pieces-")));
    ada = (await createHuman(db, "ada")).id;
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [ada]);
  });
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  test("after migrate the piece schema exists, a document of the meta-schema", async () => {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM play.doc_versions WHERE doc_id = $1`, [`schema:${SCHEMA.piece}`]);
    expect(rows[0].n).toBe(1);
    const schema = await docAt(ctx(), await me(), SCHEMA.piece);
    expect(schema.json.type).toBe("piece");
    expect(schema.json.name).toBe("piece/1");
  });

  test("propose_doc_version with kind piece makes one; its accepted version's source is kept by its hash", async () => {
    const piece = await newPiece("The car kit", pieceSource(4));
    const listed = await listDocs(db, await me(), "piece");
    expect(listed.map((d: any) => d.id)).toContain(piece);
    const hash = hashText(pieceSource(4));
    const { rows } = await db.query<any>(`SELECT hash, number, depth, requires FROM play.piece_versions WHERE piece_id = $1`, [piece]);
    expect(rows).toEqual([{ hash, number: 1, depth: 1, requires: [] }]);
    // kept among play's files, by its hash, byte for byte
    expect((await db.query(`SELECT size FROM play.files WHERE hash = $1`, [hash])).rows[0]).toBeTruthy();
    expect(new TextDecoder().decode((await store.get(hash))!)).toBe(pieceSource(4));
    // its History is its document's
    expect((await docHistory(ctx(), await me(), piece)).versions.map((v: any) => v.number)).toEqual([1]);
  });

  test("a minified piece, or one requiring anything but three.js and pieces, is refused", async () => {
    const min = `module.exports.k=function(){return ${"[1,2,3],".repeat(200)}0};`;
    await expect(proposeDocVersion(ctx(), await me(), { kind: "piece", whole: { schema: "piece/1", label: "Min", source: min }, note: "minified", intent: await building("Min") })).rejects.toThrow(/not readable/);
    await expect(proposeDocVersion(ctx(), await me(), { kind: "piece", whole: { schema: "piece/1", label: "Net", source: 'module.exports = require("https://example.com/x.js");\n' }, note: "a net module", intent: await building("Net") })).rejects.toThrow(/requires only three\.js/);
    // a piece requiring a hash that is no accepted piece version's
    const none = hashText("no piece");
    await expect(proposeDocVersion(ctx(), await me(), { kind: "piece", whole: { schema: "piece/1", label: "Lost", source: `module.exports = require("${none}");\n` }, note: "lost", intent: await building("Lost") })).rejects.toThrow(/no accepted version of a piece/);
    // nothing of a refused new piece is kept
    expect((await listDocs(db, await me(), "piece")).map((d: any) => d.label)).not.toContain("Min");
  });

  test("propose_asset requiring a hash that is no accepted piece version is refused; one that is lists it in its manifest", async () => {
    const none = hashText(pieceSource(99));
    await expect(proposeAsset(db, store, await me(), { card: { lod: { levels: "derived" } }, new: { group: "machines", label: "Cart" }, note: "a cart", source: assetSource(none), intent: await building("A cart") })).rejects.toThrow(/no accepted version of a piece/);
    const piece = await newPiece("Wheels", pieceSource(3));
    const hash = hashText(pieceSource(3));
    const p = await proposeAsset(db, store, await me(), { card: { lod: { levels: "derived" } }, new: { group: "machines", label: "Cart" }, note: "a cart on the kit", source: assetSource(hash), intent: await building("A cart") });
    const card = (await db.query<any>(`SELECT card FROM play.asset_versions WHERE id = $1`, [p.version])).rows[0].card;
    expect(card.manifest.pieces).toEqual([hash]);
    expect(card.manifest.libs).toEqual([]);
    expect(await piecesShown(db, card.manifest.pieces)).toEqual([{ hash, piece, label: "Wheels", version: 1 }]);
  });

  test("an accepted asset version keeps building the piece version it names after the piece's next version", async () => {
    const piece = await newPiece("Axles", pieceSource(2));
    const v1 = hashText(pieceSource(2));
    const p = await proposeAsset(db, store, await me(), { card: { lod: { levels: "derived" } }, new: { group: "machines", label: "Wagon" }, note: "a wagon", source: assetSource(v1), intent: await building("A wagon") });
    expect((await decide(ctx(), await me(), p.intent, "accept")).status).toBe("accepted");
    // the piece's next version
    const next = await proposeDocVersion(ctx(), await me(), { doc: piece, edits: [{ op: "set", path: ["source"], value: pieceSource(6) }], note: "six axles", intent: await building("Six axles") });
    expect((await decide(ctx(), await me(), next.intent, "accept")).status).toBe("accepted");
    const { rows } = await db.query<any>(`SELECT number, hash FROM play.piece_versions WHERE piece_id = $1 ORDER BY number`, [piece]);
    expect(rows).toEqual([{ number: 1, hash: v1 }, { number: 2, hash: hashText(pieceSource(6)) }]);
    // the wagon's version still names v1, whose source play still holds
    const { rows: w } = await db.query<any>(`SELECT v.card, f.hash AS recipe FROM play.asset_versions v JOIN play.files f ON f.hash = v.recipe_hash WHERE v.id = $1`, [p.version]);
    expect(w[0].card.manifest.pieces).toEqual([v1]);
    const recipe = new TextDecoder().decode((await store.get(w[0].recipe))!);
    expect(recipe).toContain(`require("${v1}")`);
    expect(new TextDecoder().decode((await store.get(v1))!)).toBe(pieceSource(2));
    // a piece's version is frozen
    await expect(db.query(`DELETE FROM play.piece_versions WHERE piece_id = $1`, [piece])).rejects.toThrow(/frozen/);
  });

  test(`a piece may require pieces, ${MOST_DEEP} deep at most counted from the recipe`, async () => {
    let below = hashText(pieceSource(1));
    await newPiece("Bolt", pieceSource(1));
    const chain = [below];
    for (let i = 2; i <= MOST_DEEP; i++) {
      const src = `module.exports = require("${below}") + ${i};\n`;
      await newPiece(`Layer ${i}`, src);
      below = hashText(src);
      chain.unshift(below);
    }
    const { rows } = await db.query<any>(`SELECT depth FROM play.piece_versions WHERE hash = $1`, [below]);
    expect(rows[0].depth).toBe(MOST_DEEP);
    // an asset on the top one lists every piece beneath it
    const p = await proposeAsset(db, store, await me(), { card: { lod: { levels: "derived" } }, new: { group: "machines", label: "Tower" }, note: "a tower", source: assetSource(below), intent: await building("A tower") });
    const card = (await db.query<any>(`SELECT card FROM play.asset_versions WHERE id = $1`, [p.version])).rows[0].card;
    expect(card.manifest.pieces).toEqual(chain);
    // one more layer is refused
    await expect(proposeDocVersion(ctx(), await me(), { kind: "piece", whole: { schema: "piece/1", label: "Too deep", source: `module.exports = require("${below}");\n` }, note: "too deep", intent: await building("Too deep") })).rejects.toThrow(/deep/);
  });
});
