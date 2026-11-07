// Every asset is a Loro document too (play/SPEC.md §4.4, "Version control"): `asset:<uuid>`, holding its readable
// source as text (kept line by line and character by character), its label, note, engine and card, and its variants of
// kind (a plant's kinds, an animal's breeds). It is one entry of ./versioned.ts, whose hooks are here: the asset's
// versions (play.asset_versions, content-addressed, numbered on accept) stay what the catalog, the pins and the box
// read, frozen; the document keeps every edit under them. An agent drafts a change edit by edit on an intent variant
// (doc_edit, a replace by its text among its edits), proposes it (propose_doc_version: here its recipe files are made
// and its frozen version written), and accepting merges the intent variant and numbers the version, the document's
// version of the same number. The first time an asset is touched here its document is made from its history: each
// accepted version an edit at its own date, named its own number (the work kept between two versions,
// ../import/history, as the edits between them); each intent's work not accepted an intent variant at its seed,
// closed as it was decided.
//
// A source is code: it is never merged unseen. An asset's work is accepted only on the head it was made on (a moved
// head archives it), so the merged result is the proposed version itself, the one the board built and showed in the
// asset box; the document's own rule (a code merge that met other edits needs the hash of its previewed result) stands
// behind it.
import { byOf } from "./intents";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { admin, COOP, must, type Me } from "./access";
import { keyOf, type BlobStore } from "./blobs";
import * as docs from "./docs";
import { HASH, hashText } from "./hash";
import type { Db, Queryable } from "./pg";
import { NOTE_MOST } from "./notes";
import { labelOf, libraryOf, RECIPE_HEAD, recipeTail } from "./recipes";
import { libsOf, PieceError, piecesHeld, piecesOf, piecesShown } from "./pieces";
import { boxEngine, LATEST_BOX } from "./engines";
import { readableRefs } from "../import/plan";
import { versionId } from "./versions";
import { newId, UUID } from "./uuid";
import { asVersionError, named, versionAt, VersionError, type Ctx, type Verdict } from "./versioned";
import { closeWork, holdVariant, putAtProposal, settle, stageAfter, WORK_OF, WorkError } from "./work";
import { SCHEMA } from "./ids";
import { GROUPS, isGroup } from "./groups";

export const HISTORY = join(import.meta.dir, "../import/history");
export const assetDocId = (asset: string) => `asset:${asset}`;
export class AssetDocError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type AssetJson = {
  schema: "asset/1";
  label: string;
  note?: string;
  source: string;
  engine?: number;
  card?: any;
  defaultVariant?: string;
  variants?: { name: string; source?: string; card?: any }[];
};

export const authorOf = (me: Pick<Me, "id"> | null, via: string | null | undefined): docs.Author => ({
  human: me?.id || null,
  via: via === "mcp" ? "mcp" : via === "import" ? "import" : via === "system" ? "system" : "site",
});
const firstLine = (s: string, n = 160) => (s ?? "").split("\n")[0].slice(0, n);

const asAssetError = asVersionError;

// ---- an asset version as a document's state

/**
 * A version as the document holds it: the version's own source (or, for a kind of variants, its default variant's) as
 * `source`; each variant's card, and its source only where it differs from that one.
 */
export function asAssetJson(label: string, v: { note?: string | null; engine?: number | null; card?: any; defaultVariant?: string | null; source: string; variants?: { name: string; source: string; card?: any }[] }): AssetJson {
  const json: AssetJson = { schema: "asset/1", label: label || "An asset", source: v.source };
  if (v.note) json.note = `${v.note}`.slice(0, NOTE_MOST);
  if (Number.isInteger(v.engine) && (v.engine as number) >= 1) json.engine = v.engine as number;
  if (v.card && typeof v.card === "object" && !Array.isArray(v.card)) json.card = v.card;
  if (v.variants?.length) {
    json.variants = [...v.variants].sort((a, b) => (a.name < b.name ? -1 : 1)).map((x) => ({ name: x.name, ...(x.source !== v.source ? { source: x.source } : {}), ...(x.card ? { card: x.card } : {}) }));
    if (v.defaultVariant) json.defaultVariant = v.defaultVariant;
  }
  return json;
}

async function textOf(store: BlobStore, hash: string | null): Promise<string | null> {
  if (!hash) return null;
  const b = await store.get(hash);
  return b ? new TextDecoder().decode(b) : null;
}
/** a version's readable source: its own, else the library its recipe file wraps (the code the box runs) */
async function sourceOf(store: BlobStore, source: string | null, recipe: string | null): Promise<string> {
  const own = await textOf(store, source);
  if (own !== null) return own;
  const file = await textOf(store, recipe);
  const lib = file ? libraryOf(file) : null;
  if (lib !== null) return lib;
  throw new AssetDocError(`a version's source can't be read (source ${source ?? "none"}, recipe ${recipe ?? "none"})`, 500);
}

type VersionRow = { id: string; number: number | null; recipe_hash: string | null; source_hash: string | null; default_variant: string | null; card: any; engine: number | null; note: string; author: string | null; approved_by: string | null; created: Date; imported: any; via: string | null };

/** one version of an asset, from play's tables, as its document's state */
async function versionJson(q: Queryable, store: BlobStore, label: string, v: VersionRow): Promise<AssetJson> {
  const { rows: xs } = await q.query<{ name: string; recipe_hash: string; source_hash: string | null; card: any }>(
    `SELECT name, recipe_hash, source_hash, card FROM play.asset_variants WHERE version_id = $1 ORDER BY name`, [v.id],
  );
  const variants = await Promise.all(xs.map(async (x) => ({ name: x.name, source: await sourceOf(store, x.source_hash, x.recipe_hash), card: x.card })));
  const own = v.recipe_hash ? await sourceOf(store, v.source_hash, v.recipe_hash) : variants.find((x) => x.name === v.default_variant)?.source ?? variants[0]?.source ?? "";
  return asAssetJson(label, { note: v.note, engine: v.engine, card: v.card, defaultVariant: v.default_variant, source: own, variants });
}

const VERSIONS = `SELECT v.id, v.number, v.recipe_hash, v.source_hash, v.default_variant, v.card, v.engine, v.note, v.author, v.approved_by, v.created, v.imported,
         (SELECT i.proposed_via FROM play.intents i WHERE i.version = v.id AND i.stage = 'accepted' LIMIT 1) AS via
    FROM play.asset_versions v`;

// ---- the work kept between two versions (../import/history)

type Kept = { asset: string; name?: string; after: number; before: number; from: string; lands: string; by: "before"; via: string; steps: { file: string; hash: string; at: string; message: string }[]; final?: { file: string; hash: string } };
/** the edits kept for the asset `asset` (its UUID: the folder ../import/history/<uuid>), or null */
export function keptFor(asset: string, dir = HISTORY): (Kept & { dir: string }) | null {
  if (!UUID.test(asset)) return null;
  const at = join(dir, asset);
  if (!existsSync(join(at, "index.json"))) return null;
  const k = JSON.parse(readFileSync(join(at, "index.json"), "utf8")) as Kept;
  if (k.asset !== asset) throw new AssetDocError(`${at}/index.json names ${k.asset}`, 500);
  return { ...k, dir: at };
}
/** one kept edit's text, held to its hash */
function keptText(k: Kept & { dir: string }, file: string, hash: string): string {
  const text = readFileSync(join(k.dir, file), "utf8");
  if (hashText(text) !== hash) throw new AssetDocError(`${k.asset}: ${file} is not ${hash}`, 500);
  return text;
}

// ---- making an asset's document from its history

/** the frontiers of the document's version `number` */
async function versionFrontiers(q: Queryable, docId: string, number: number): Promise<docs.Frontiers | null> {
  const { rows } = await q.query<{ frontiers: docs.Frontiers }>(`SELECT frontiers FROM play.doc_versions WHERE doc_id = $1 AND number = $2`, [docId, number]);
  return rows[0]?.frontiers ?? null;
}

/**
 * The asset's document, made from its history the first time (in the caller's transaction, the asset's row locked):
 * every accepted version an edit at its date, named its own number, and the edits kept between two of them; then an
 * intent variant for each intent's work on it that has none yet (at Proposal proposed, the rest closed as they ended).
 */
export async function ensureAssetDoc(q: Queryable, store: BlobStore, asset: string, dir = HISTORY): Promise<{ id: string; made: boolean; variants: number; kept: number; breeds: number }> {
  const id = assetDocId(asset);
  const { rows: a } = await q.query<{ grp: string; slug: string; label: string }>(`SELECT grp, slug, label FROM play.assets WHERE id = $1 FOR UPDATE`, [asset]);
  if (!a[0]) throw new AssetDocError(`there is no asset ${asset}`, 404);
  const { slug } = a[0];
  const label = a[0].label || slug;
  const { rows: have } = await q.query(`SELECT 1 FROM play.docs WHERE id = $1`, [id]);
  let made = false, keptSteps = 0;
  if (!have.length) {
    made = true;
    const { rows: vs } = await q.query<VersionRow>(`${VERSIONS} WHERE v.asset_id = $1 AND v.number IS NOT NULL ORDER BY v.number`, [asset]);
    // an asset not accepted yet stands on an empty source: its first intent variant fills it
    if (!vs.length) await docs.createDoc(q, { id, schema: SCHEMA.asset, json: { schema: "asset/1", label, source: "" }, author: { human: null, via: "system" }, message: "a new asset, not yet accepted" });
    const kept = keptFor(asset, dir);
    let prev: AssetJson | null = null;
    for (const [i, v] of vs.entries()) {
      const json = await versionJson(q, store, label, v);
      const via = v.imported ? "import" : v.via === "mcp" ? "mcp" : "site";
      // the work kept between the version before and this one, where the two are exactly the versions it ran between
      if (kept && prev && vs[i - 1].number === kept.after && v.number === kept.before && vs[i - 1].source_hash === kept.from && v.source_hash === kept.lands) {
        const by: docs.Author = { human: v.author, via: kept.via === "mcp" ? "mcp" : "site" };
        for (const s of kept.steps) {
          const e = await docs.commit(q, id, { target: { ...prev, source: keptText(kept, s.file, s.hash) }, message: s.message, author: by, kind: "edit", at: new Date(s.at) });
          if (e) keptSteps++;
        }
        if (kept.final && keptText(kept, kept.final.file, kept.final.hash) !== json.source) throw new AssetDocError(`${kept.asset}: the kept edits do not lead to v${v.number}'s source`, 500);
      }
      const message = `v${v.number}: ${firstLine(v.note) || (i === 0 ? "its first version" : "a new version")}`;
      if (i === 0) await docs.createDoc(q, { id, schema: SCHEMA.asset, json, author: { human: v.author, via }, message, at: v.created, version: v.note ?? "", number: v.number! });
      else {
        await docs.commit(q, id, { target: json, message, author: { human: v.author, via }, kind: "import", at: v.created });
        await docs.nameVersion(q, id, { note: v.note ?? "", author: { human: v.approved_by, via: v.imported ? "import" : "site" }, at: v.created, number: v.number! });
      }
      prev = json;
    }
  }
  // each intent's work that has no intent variant yet: one seeded at its base, the proposed version its one edit
  const { rows: ps } = await q.query<{ id: string; status: string; base_number: number | null; author: string | null; via: string | null; note: string; created: Date; version: string }>(
    `SELECT i.id, CASE i.stage WHEN 'proposal' THEN 'proposal' ELSE 'archived' END AS status, b.number AS base_number, i.proposed_by AS author,
            i.proposed_via AS via, COALESCE(i.work_note, '') AS note, i.proposed_at AS created, i.version
       FROM play.intents i LEFT JOIN play.asset_versions b ON b.id = i.base
      WHERE i.asset_id = $1 AND NOT EXISTS (SELECT 1 FROM play.intent_variants iv WHERE iv.intent_id = i.id) AND i.stage <> 'accepted' ORDER BY i.proposed_at`,
    [asset],
  );
  for (const p of ps) {
    const { rows: v } = await q.query<VersionRow>(`${VERSIONS} WHERE v.id = $1`, [p.version]);
    const json = await versionJson(q, store, label, v[0]);
    const b = await variantAt(q, id, p.base_number, { human: p.author, via: p.via === "mcp" ? "mcp" : "site" }, p.note);
    await docs.commit(q, id, { variant: b, target: json, message: firstLine(p.note) || "proposed", author: { human: p.author, via: p.via === "mcp" ? "mcp" : "site" }, at: p.created });
    await docs.propose(q, id, b, { note: p.note, author: { human: p.author, via: p.via === "mcp" ? "mcp" : "site" } });
    if (p.status !== "proposal") await docs.close(q, id, b, { author: { human: null, via: "system" }, status: p.status as "archived" });
    await holdVariant(q, null, p.id, id, Number(b));
  }
  const breeds = await breedsFromVariants(q, id);
  return { id, made, variants: ps.length, kept: keptSteps, breeds };
}

/**
 * The asset's document for reading (its history, an edit, the recipe at an edit): where it is there already and every
 * intent's work has its intent variant, its id straight away, with no transaction and no lock on the asset; only where something is
 * missing, made under the lock as ensureAssetDoc does. A read never waits behind another's intent variant.
 */
export async function assetDocFor(db: Db, store: BlobStore, asset: string): Promise<{ id: string }> {
  const id = assetDocId(asset);
  const { rows } = await db.query<{ ready: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM play.docs WHERE id = $1)
            AND NOT EXISTS (SELECT 1 FROM play.intents i WHERE i.asset_id = $2 AND NOT EXISTS (SELECT 1 FROM play.intent_variants iv WHERE iv.intent_id = i.id) AND i.stage <> 'accepted') AS ready`,
    [id, asset],
  );
  if (rows[0]?.ready) return { id };
  return db.transaction((q) => ensureAssetDoc(q, store, asset));
}

/**
 * A new intent variant of the asset's document seeded at version `base` (the head its work was made on), or, for a new
 * asset's first version, at the document's empty start (a variant made on it merges into it field by field).
 */
async function variantAt(q: Queryable, docId: string, base: number | null, author: docs.Author, note: string): Promise<number> {
  let at: docs.Frontiers | undefined;
  if (base !== null) {
    const f = await versionFrontiers(q, docId, base);
    if (!f) throw new AssetDocError(`${docId} has no version ${base}`, 500);
    at = f;
  } else if ((await docs.versionsOf(q, docId)).length) at = [];
  return (await docs.variant(q, docId, { author, note, ...(at ? { at } : {}) })).id;
}

/** every asset's document, made where it is missing or where an intent's work on it has no intent variant yet (the deploy's import) */
export async function ensureAssetDocs(db: Db, store: BlobStore, dir = HISTORY): Promise<AssetDocsReport> {
  const out: AssetDocsReport = { made: 0, variants: 0, kept: 0, breeds: 0, edits: 0, versions: 0, bytes: 0, errors: [] };
  const { rows } = await db.query<{ id: string; grp: string; slug: string }>(
    `SELECT a.id, a.grp, a.slug FROM play.assets a
      WHERE NOT EXISTS (SELECT 1 FROM play.docs d WHERE d.id = 'asset:' || a.id::text)
         OR EXISTS (SELECT 1 FROM play.intents i WHERE i.asset_id = a.id AND NOT EXISTS (SELECT 1 FROM play.intent_variants iv WHERE iv.intent_id = i.id) AND i.stage <> 'accepted')
         -- an asset of variants whose document has no breeds yet (play/SPEC.md "Breeds")
         OR (EXISTS (SELECT 1 FROM play.asset_variants x JOIN play.asset_versions v ON v.id = x.version_id WHERE v.asset_id = a.id AND v.number IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM play.doc_variants b WHERE b.doc_id = 'asset:' || a.id::text AND b.type = 'breed'))
      ORDER BY a.grp, a.slug`,
  );
  for (const r of rows) {
    try {
      const got = await db.transaction((q) => ensureAssetDoc(q, store, r.id, dir));
      out.made += got.made ? 1 : 0;
      out.variants += got.variants;
      out.breeds += got.breeds;
      out.kept += got.kept;
    } catch (e) {
      out.errors.push(`${r.grp}/${r.slug}: ${(e as Error).message}`);
    }
  }
  const { rows: t } = await db.query<{ docs: string; edits: string; bytes: string; versions: string }>(
    `SELECT (SELECT count(*) FROM play.docs WHERE type = 'asset') AS docs,
            (SELECT count(*) FROM play.doc_edits u JOIN play.docs d ON d.id = u.doc_id WHERE d.type = 'asset') AS edits,
            (SELECT COALESCE(sum(length(u.bytes)), 0) FROM play.doc_edits u JOIN play.docs d ON d.id = u.doc_id WHERE d.type = 'asset') AS bytes,
            (SELECT count(*) FROM play.doc_versions v JOIN play.docs d ON d.id = v.doc_id WHERE d.type = 'asset') AS versions`,
  );
  out.docs = Number(t[0].docs);
  out.edits = Number(t[0].edits);
  out.bytes = Number(t[0].bytes);
  out.versions = Number(t[0].versions);
  return out;
}
export type AssetDocsReport = { made: number; variants: number; kept: number; breeds: number; edits: number; versions: number; bytes: number; docs?: number; errors: string[] };

// ---- an intent's work as an intent variant (./versioned.ts, ./work.ts)

/** an asset's intent variant `v`, still open for edits, and the version it was seeded from */
export async function openVariantOf(q: Queryable, asset: string, v: unknown): Promise<{ id: number; base: number | null; status: string }> {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new AssetDocError("An intent variant is named by its number.");
  const docId = assetDocId(asset);
  const { rows } = await q.query<{ id: string; status: string; seed: docs.Frontiers; main_seed: docs.Frontiers | null }>(`SELECT id, status, seed, main_seed FROM play.doc_variants WHERE id = $1 AND doc_id = $2 AND type = 'intent'`, [n, docId]);
  if (!rows[0]) throw new AssetDocError(`This asset has no intent variant ${n}.`, 404);
  if (rows[0].status !== "open") throw new AssetDocError(`Variant ${n} was ${rows[0].status}: start a new one.`, 409);
  return { id: n, base: await baseOf(q, docId, rows[0].main_seed ?? rows[0].seed), status: rows[0].status };
}

/**
 * The version a variant seeded at Main's point `at` grew from: the version named there; or, where Main moved past its
 * newest version only by the import's own edits (its variants turned into breeds), that newest version.
 */
async function baseOf(q: Queryable, docId: string, at: docs.Frontiers): Promise<number | null> {
  const versions = await docs.versionsOf(q, docId);
  const n = versionAt(versions, at);
  if (n !== null || !versions.length) return n;
  const last = versions.at(-1)!;
  const { rows } = await q.query<{ n: string }>(
    `SELECT count(*) AS n FROM play.doc_edits e JOIN play.doc_variants m ON m.id = e.variant AND m.type = 'main'
      WHERE e.doc_id = $1 AND e.kind <> 'import' AND e.seq > (SELECT max(e2.seq) FROM play.doc_edits e2 JOIN play.doc_variants m2 ON m2.id = e2.variant AND m2.type = 'main'
                                                         WHERE e2.doc_id = $1 AND e2.frontiers = ($2::text)::jsonb)`,
    [docId, JSON.stringify(last.frontiers)],
  );
  const { rows: head } = await q.query<{ head: docs.Frontiers }>(`SELECT head FROM play.docs WHERE id = $1`, [docId]);
  return Number(rows[0]?.n ?? 1) === 0 && docs.frontiersKey(head[0].head) === docs.frontiersKey(at) ? last.number : null;
}

// ---- breeds (play/SPEC.md "Breeds"): an asset's variants as variants of its document beside Main

/**
 * An asset's variants, where its Main holds them (a document made from its history, or a version proposed with
 * `variants`), turned into breeds: each variant a breed of its name, its source (where it has its own) and its card
 * the fields it overrides; then Main without them, merged into every breed. The asset's frozen versions are untouched.
 * Gives back how many breeds it made or changed.
 */
export async function breedsFromVariants(q: Queryable, docId: string): Promise<number> {
  const main = (await docs.readDoc(q, docId)).json as AssetJson;
  if (!main.variants?.length) return 0;
  const author: docs.Author = { human: null, via: "system" };
  const have = new Map((await docs.variantsOf(q, docId)).filter((v) => v.type === "breed").map((v) => [v.name!, v.id]));
  for (const x of main.variants) {
    const id = have.get(x.name) ?? (await docs.breed(q, docId, { name: x.name, author, note: `the variant ${x.name}` })).id;
    const now = (await docs.readDoc(q, docId, { breed: id })).json;
    const target = { ...now, source: x.source ?? main.source };
    if (x.card) target.card = x.card;
    await docs.commit(q, docId, { variant: id, target, message: `breed ${x.name}: the variant ${x.name}'s own source and card`, author, kind: "import" });
  }
  const { variants: _v, ...rest } = main;
  await docs.commit(q, docId, { target: rest, message: "its variants are breeds now, beside Main", author, kind: "import" });
  await docs.trackMainInBreeds(q, docId, { message: "tracks Main", author });
  return main.variants.length;
}
/** an intent variant's state: the whole asset as it stands on it */
export async function variantState(q: Queryable, asset: string, v: number): Promise<AssetJson> {
  return (await docs.readDoc(q, assetDocId(asset), { variant: v })).json as AssetJson;
}

/**
 * The intent variant of an intent's work (in the proposing transaction, the asset's document made first): the one it
 * was made on, its last edit the version as proposed; or a new one seeded at the head it was made on, the version its
 * one edit. Proposed.
 */
export async function proposalVariant(q: Queryable, store: BlobStore, o: { asset: string; base: number | null; json: AssetJson | null; note: string; author: docs.Author; variant?: number }): Promise<number> {
  return asAssetError(async () => {
    const { id } = await ensureAssetDoc(q, store, o.asset);
    const message = firstLine(o.note) || "proposed";
    const v = o.variant !== undefined ? (await openVariantOf(q, o.asset, o.variant)).id : await variantAt(q, id, o.base, o.author, o.note);
    // the version as proposed, its intent variant's last edit (an asset of breeds: its variant as it stands, each breed built from it)
    if (o.json) await docs.commit(q, id, { variant: v, target: o.json, message, author: o.author });
    await docs.propose(q, id, v, { note: o.note, author: o.author });
    return v;
  });
}

/** an intent's accepted work: its intent variant merged into the asset's Main and named its version `n` */
export async function acceptVariant(q: Queryable, store: BlobStore, p: { id: string; asset_id: string; note: string }, me: Me, n: number): Promise<void> {
  await asAssetError(async () => {
    const { id } = await ensureAssetDoc(q, store, p.asset_id);
    const { rows } = await q.query<{ doc_variant: string | null }>(`SELECT variant_id AS doc_variant FROM play.intent_variants WHERE intent_id = $1 ORDER BY position LIMIT 1`, [p.id]);
    const v = rows[0]?.doc_variant;
    if (v == null) throw new AssetDocError(`intent ${p.id}'s work has no intent variant`, 500);
    const named_ = await docs.accept(q, id, Number(v), { author: authorOf(me, "site"), note: p.note });
    if (named_.number !== n) throw new Error(`asset ${p.asset_id} and its document disagree: version ${n} against ${named_.number}`);
  });
}

// ---- edits (MCP doc_edit on an asset): a replace by its text among the document's own

/** a replace by its text into the range edit it is, against the text as the edits before it left it */
export function assetEdits(cur: AssetJson, edits: unknown): docs.Edit[] {
  if (!Array.isArray(edits) || !edits.length) throw new AssetDocError("Give the edits as a list.");
  if (edits.length > 500) throw new AssetDocError("At most 500 edits at once.");
  const texts = new Map<string, string>();
  const textAt = (path: (string | number)[]) => {
    const k = JSON.stringify(path);
    if (!texts.has(k)) {
      let v: any = cur;
      for (const p of path) v = v?.[p as any];
      texts.set(k, typeof v === "string" ? v : "");
    }
    return texts.get(k)!;
  };
  return edits.map((e: any, i) => {
    if (!e || typeof e !== "object") throw new AssetDocError(`Edit ${i + 1} is not an edit.`);
    if (Array.isArray(e.path) && e.path[0] === "schema") throw new AssetDocError(`Edit ${i + 1}: an asset's schema is not edited.`);
    if (e.op === "replace") {
      const field = e.field === "note" ? "note" : "source";
      let path: (string | number)[] = [field];
      if (e.variant !== undefined) {
        const j = (cur.variants ?? []).findIndex((v) => v.name === e.variant);
        if (j < 0) throw new AssetDocError(`Edit ${i + 1}: there is no variant ${e.variant}.`);
        if (typeof cur.variants![j].source !== "string") throw new AssetDocError(`Edit ${i + 1}: variant ${e.variant} has the asset's own source: edit that.`);
        path = ["variants", j, "source"];
      }
      if (typeof e.find !== "string" || !e.find) throw new AssetDocError(`Edit ${i + 1}: say what to find.`);
      if (typeof e.replace !== "string") throw new AssetDocError(`Edit ${i + 1}: say what to replace it with.`);
      const t = textAt(path);
      const at = t.indexOf(e.find);
      if (at < 0) throw new AssetDocError(`Edit ${i + 1}: the text to find is not in the ${path.join(".")}.`);
      if (t.indexOf(e.find, at + 1) >= 0) throw new AssetDocError(`Edit ${i + 1}: the text to find is in the ${path.join(".")} more than once: give more of it.`);
      texts.set(JSON.stringify(path), t.slice(0, at) + e.replace + t.slice(at + e.find.length));
      return { op: "text", path, index: at, delete: e.find.length, insert: e.replace } as docs.Edit;
    }
    if (e.op === "text" && Array.isArray(e.path)) {
      const t = textAt(e.path);
      const idx = Number(e.index), del = Number(e.delete ?? 0), ins = `${e.insert ?? ""}`;
      texts.set(JSON.stringify(e.path), t.slice(0, idx) + ins + t.slice(idx + del));
    }
    if (!["set", "insert", "delete", "move", "text"].includes(e.op)) throw new AssetDocError(`Edit ${i + 1}: an edit is one of replace, text, set, insert, delete, move.`);
    return e as docs.Edit;
  });
}

// ---- an asset at an edit, or as an intent's variant would make it

const HISTORY_ADMINS = "An asset's history, edit by edit, is for Maia City's admins.";

/** the edit an asset is read at: the one named, or an intent's variant's last */
async function editOf(db: Queryable, docId: string, at: { edit?: number; intent?: string }): Promise<number> {
  if (at.intent !== undefined) {
    const { rows } = await db.query<{ doc_variant: string | null }>(`SELECT variant_id AS doc_variant FROM play.intent_variants WHERE intent_id::text = $1 AND doc_id = $2`, [`${at.intent}`.toLowerCase(), docId]);
    if (!rows[0]?.doc_variant) throw new AssetDocError(`This asset has no variant of intent ${at.intent}.`, 404);
    const last = (await docs.history(db, docId, { variant: Number(rows[0].doc_variant) })).at(-1);
    if (!last) throw new AssetDocError(`Intent ${at.intent}'s variant holds no edit yet.`, 404);
    return last.seq;
  }
  if (!Number.isInteger(at.edit) || (at.edit as number) < 1) throw new AssetDocError(`${at.edit} is not an edit.`, 404);
  return at.edit as number;
}

/** asset `asset` as it was at edit `edit` of its history, or as intent `intent`'s variant would make it: its whole state, its source as text */
export async function assetAt(db: Db, store: BlobStore, me: Me | null, asset: string, at: { edit?: number; intent?: string }) {
  admin(me, HISTORY_ADMINS);
  return asAssetError(async () => {
    const { id: docId } = await assetDocFor(db, store, asset);
    const edit = await editOf(db, docId, at);
    const json = (await docs.stateAt(db, docId, { edit })) as AssetJson;
    return { asset, edit, ...(at.intent !== undefined ? { intent: `${at.intent}`.toLowerCase() } : {}), ...json, sourceHash: hashText(json.source) };
  });
}

/**
 * The version an edit leads to: the version it was named, where it was; else the one after the last version before
 * it (an edit on an intent variant: the one after the version it was seeded from).
 */
async function numberAt(q: Queryable, docId: string, seq: number): Promise<{ n: number; exact: number | null }> {
  const { rows } = await q.query<{ type: string; seed: docs.Frontiers; main_seed: docs.Frontiers | null; status: string; version: number | null }>(
    `SELECT v.type, v.seed, v.main_seed, v.status, v.version FROM play.doc_edits u JOIN play.doc_variants v ON v.id = u.variant WHERE u.doc_id = $1 AND u.seq = $2`, [docId, seq],
  );
  if (!rows[0]) throw new AssetDocError(`no edit ${seq}`, 404);
  const versions = await docs.versionsOf(q, docId);
  // a breed's edit: the breed as it stands in the newest version (each Accept builds every breed as its variant)
  if (rows[0].type === "breed") return { n: versions.at(-1)?.number ?? 1, exact: versions.at(-1)?.number ?? null };
  // an edit of an intent variant of a breed, or making one: the version after the one it was seeded from (its own, once accepted)
  if (rows[0].main_seed) {
    if (rows[0].status === "accepted" && rows[0].version) return { n: rows[0].version, exact: null };
    return { n: (versionAt(versions, rows[0].main_seed) ?? versions.at(-1)?.number ?? 0) + 1, exact: null };
  }
  const edits = await named(q, await docs.history(q, docId), versions);
  const i = edits.findIndex((s) => s.seq === seq);
  if (i < 0) {
    const base = rows[0].type === "intent" ? versionAt(versions, rows[0].seed) : null;
    return { n: (base ?? 0) + 1, exact: null };
  }
  if (edits[i].version) return { n: edits[i].version!, exact: edits[i].version! };
  let last = 0;
  for (let j = 0; j < i; j++) if (edits[j].version) last = edits[j].version!;
  return { n: last + 1, exact: null };
}

/**
 * The recipe file asset `asset` builds at edit `edit` (or at an intent's variant's last), as the catalog lists a build
 * (its hash, its size, its record), so the asset viewer builds it in the box like any other: at an edit that is a
 * version, that version's own recipe file; at any other, one made the same way (the box's header, the edit's source,
 * the line naming the asset and the version the edit leads to), kept among play's files by its hash. Admins only.
 */
export async function recipeAt(db: Db, store: BlobStore, me: Me | null, asset: string, at: { edit?: number; intent?: string }) {
  admin(me, HISTORY_ADMINS);
  return asAssetError(async () => {
    const { id: docId } = await assetDocFor(db, store, asset);
    const seq = await editOf(db, docId, at);
    const { rows: a } = await db.query<{ grp: string; slug: string; label: string }>(`SELECT grp, slug, label FROM play.assets WHERE id = $1`, [asset]);
    const json = (await docs.stateAt(db, docId, { edit: seq })) as AssetJson;
    const { n, exact } = await numberAt(db, docId, seq);
    // an edit of a breed's (on its own line, or on an intent variant changing or making it) builds that breed
    const { rows: line } = await db.query<{ name: string | null }>(
      `SELECT COALESCE(l.name, b.name, l.makes) AS name FROM play.doc_edits e JOIN play.doc_variants l ON l.id = e.variant LEFT JOIN play.doc_variants b ON b.id = l.breed
        WHERE e.doc_id = $1 AND e.seq = $2`,
      [docId, seq],
    );
    const bred = line[0]?.name ?? null;
    const variant = bred ?? json.defaultVariant ?? null;
    const v = bred ? { name: bred, source: json.source, card: json.card } : variant ? json.variants?.find((x) => x.name === variant) : undefined;
    const record = (v?.card ?? json.card ?? {}) as any;
    const base = { asset, group: a[0].grp, slug: a[0].slug, v: n, variant, first: true, label: record?.card?.label ?? json.label, edit: seq };
    // a version's point: its own recipe file, as the catalog has it, where the edit holds that version's source
    if (exact !== null) {
      const { rows } = await db.query<{ hash: string; size: string; card: any; source_hash: string | null }>(
        `SELECT COALESCE(x.recipe_hash, v.recipe_hash) AS hash, f.size, COALESCE(x.card, v.card) AS card, COALESCE(x.source_hash, v.source_hash) AS source_hash
           FROM play.asset_versions v LEFT JOIN play.asset_variants x ON x.version_id = v.id AND x.name = COALESCE($3, v.default_variant)
           JOIN play.files f ON f.hash = COALESCE(x.recipe_hash, v.recipe_hash)
          WHERE v.asset_id = $1 AND v.number = $2`,
        [asset, exact, bred],
      );
      const src = v?.source ?? json.source;
      if (rows[0] && (rows[0].source_hash === null || rows[0].source_hash === hashText(src))) return { ...base, hash: rows[0].hash, size: Number(rows[0].size), record: rows[0].card, version: exact };
    }
    const source = v?.source ?? json.source;
    const text = RECIPE_HEAD + source + recipeTail(a[0].slug, n, variant);
    const hash = hashText(text);
    const bytes = new TextEncoder().encode(text);
    const key = (await store.has(hash)) ? keyOf(hash) : await store.put(hash, bytes, "text/javascript");
    await db.query(`INSERT INTO play.files (hash, size, media_type, bucket_key) VALUES ($1, $2, 'text/javascript', $3) ON CONFLICT (hash) DO NOTHING`, [hash, bytes.length, key]);
    const pieces = (await piecesHeld(db, piecesOf(source)).catch(() => ({ all: piecesOf(source) }))).all;
    const made = { ...record, manifest: { ...(record.manifest ?? {}), libs: libsOf(source), pieces }, card: { ...(record.card ?? {}), recipe: hash, version: n, v: n, ...(variant ? { variant } : {}) } };
    return { ...base, hash, size: bytes.length, record: made, version: null };
  });
}

// ---- proposing a version and deciding it (the asset's hooks of ./versioned.ts)

/** the work an asset's version is */
const ASSET_WORK = "asset_version";

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** a label as a slug: its letters and digits, lowercase, joined by '-' */
const slugOf = (label: string) =>
  label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
const VARIANT = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const MOST_FILE = 16 * 1024 * 1024;
const MEDIA = "text/javascript";

type Upload = { source?: string; recipe?: string; record?: any; label?: string };
export type ProposalBody = {
  asset?: string; // an existing asset, by its UUID
  new?: { group: string; slug?: string; label: string }; // or a new one: its group and label (its slug made from the label if none)
  label?: string;
  note?: string;
  base?: string | null; // the head it was made from, as the proposer saw it
  record?: any; // the version's record (card, params, contract …)
  source?: string; // the version's readable source: the library its recipe file wraps (module.exports.recipe = …)
  recipe?: string; // or its recipe file, as text, whose library must be that readable source
  variants?: Record<string, Upload>;
  defaultVariant?: string;
  card?: Record<string, unknown>; // card fields set over the record it takes (its params when the recipe declares new ones), on the version and on each variant
  variant?: number; // an intent variant made edit by edit (doc_edit), proposed as it stands
  sheet?: string | null; // its reference sheet: an image play keeps, by its hash (a plant's plate of every stage and organ); null takes the head's away
  datasheet?: string | null; // its data sheet: a Markdown document play keeps, by its hash; null takes the head's away
  brief?: string | null; // the brief its reference sheet was made from: a Markdown document play keeps, by its hash
  intent?: string; // the intent it is the work of, by its UUID, held to its gate before (./intents.ts intentReady): no work without an intent
};

/**
 * Why a source is not readable, or null: people decide on what they can read (Samuel 2026-11-02), so a proposal brings
 * the code as written, not bundled or minified. Minified code is told by its lines: long ones, or few for its size.
 */
export function unreadable(source: string): string | null {
  const lines = source.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  if (longest > 1000) return `a line of it is ${longest} characters long: send the source as written, not bundled or minified (lines under 1000 characters)`;
  if (source.length > 4000 && source.length / lines.length > 120) return "its lines are too long on average for code people read: send the source as written, not bundled or minified";
  return null;
}

/**
 * A version's code as proposed, the readable source or a recipe file wrapping it: its source and the recipe file made
 * from it for this asset, this version and this variant (the same file the box builds, RECIPE_HEAD + source + its tail).
 */
function checkedCode(up: { source?: unknown; recipe?: unknown }, slug: string, n: number, variant: string | null) {
  let source: string;
  if (typeof up.source === "string" && up.source) {
    if (up.recipe) throw new VersionError("Give the readable source or the recipe file, not both.");
    if (up.source.startsWith(RECIPE_HEAD)) throw new VersionError("That is a recipe file: give it as the recipe, or give its source alone.");
    source = up.source;
  } else if (typeof up.recipe === "string" && up.recipe) {
    const label = labelOf(up.recipe);
    if (!label) throw new VersionError("That is not a recipe file of the asset box.");
    if (label.id !== slug || label.v !== n || label.variant !== variant)
      throw new VersionError(`The recipe file builds ${label.id}@${label.v}${label.variant ? `:${label.variant}` : ""}, not ${slug}@${n}${variant ? `:${variant}` : ""}.`);
    source = libraryOf(up.recipe)!;
  } else throw new VersionError("The version's readable source is missing.");
  if (Buffer.byteLength(source) > MOST_FILE) throw new VersionError("The source is larger than 16 MB.");
  if (!/module\.exports\.recipe\s*=|exports\.recipe\s*=/.test(source))
    throw new VersionError("The source sets no module.exports.recipe = function (id, v, variant) { … }: the recipe its file calls.");
  const why = unreadable(source);
  if (why) throw new VersionError(`The source is not readable: ${why}.`);
  const recipe = RECIPE_HEAD + source + recipeTail(slug, n, variant);
  return { source: { text: source, hash: hashText(source) }, recipe: { text: recipe, hash: hashText(recipe) }, libs: libsOf(source), pieces: piecesOf(source) };
}

/**
 * The pieces a source requires by hash (play/SPEC.md §4.5), each an accepted piece version's, with every piece beneath
 * them: what its manifest's `pieces` names. Refused, saying which, where one is no accepted piece's version or they go
 * more than four deep.
 */
async function piecesFor(db: Queryable, pieces: string[]): Promise<string[]> {
  try {
    return (await piecesHeld(db, pieces)).all;
  } catch (e) {
    throw e instanceof PieceError ? new VersionError(e.message) : e;
  }
}

/**
 * The engine a record names, held to the frozen ones (it chooses which engine the page runs the recipe on): one it
 * names must be frozen under its hash; none named, the latest. And the libraries it may require, the ones its source does.
 */
function heldRecord(record: any, libs: string[], source: string, pieces: string[] = []) {
  const named = record?.engine?.version ?? record?.card?.engine;
  const e = named === undefined ? LATEST_BOX : boxEngine(Number(named));
  if (!e) throw new VersionError(`Box engine ${named} is not one of the frozen engines.`);
  if (record?.engine?.hash !== undefined && record.engine.hash !== e.blake3) throw new VersionError(`Box engine ${e.v} is frozen under another hash.`);
  return {
    ...(record ?? {}),
    engine: { host: "box", version: e.v, hash: e.blake3 },
    manifest: { ...(record?.manifest ?? {}), libs, pieces },
    source,
    card: { ...(record?.card ?? {}), engine: e.v },
  };
}

const PARAM_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
/**
 * The card fields a proposal may set over the record it takes: its `params`, the parameters its recipe declares (its
 * meta.params), in the order its build takes them, checked for shape as the page will read them (site params.js).
 */
function cardFields(card: unknown): Record<string, unknown> {
  if (card === undefined || card === null) return {};
  if (typeof card !== "object" || Array.isArray(card)) throw new VersionError("The card's fields come as an object.");
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(card)) {
    if (k !== "params") throw new VersionError(`A proposal sets only the card's params, not ${k}.`);
    if (!Array.isArray(v) || v.length > 24) throw new VersionError("params is a list of at most 24 parameters.");
    const ids = new Set<string>();
    for (const p of v as any[]) {
      if (!p || typeof p !== "object" || !PARAM_KEY.test(`${p.id}`) || ids.has(p.id)) throw new VersionError("Each parameter has its own id (a letter, then letters, digits, _ . -).");
      if (!["number", "integer", "string"].includes(p.type)) throw new VersionError(`${p.id}: its type is number, integer or string.`);
      if (p.value === undefined || (p.type === "string" ? typeof p.value !== "string" : typeof p.value !== "number")) throw new VersionError(`${p.id}: its value is a ${p.type === "string" ? "string" : "number"}.`);
      ids.add(p.id);
    }
    out.params = v;
  }
  return out;
}

/** a record with its card naming what it is: the asset, the version, the variant and the file */
const recordOf = (record: any, grp: string, slug: string, n: number, variant: string | null, hash: string) => ({
  ...(record ?? {}),
  kind: "recipe",
  card: { ...(record?.card ?? {}), group: grp, id: slug, version: n, v: n, ...(variant ? { variant } : {}), recipe: hash },
});

/** a record with its documents set (each a hash), taken away (null) or left as they came (undefined): its reference
 *  sheet, its data sheet and its sheet's brief (play/SPEC.md §4.10) */
type Refs = { sheet?: string | null; datasheet?: string | null; brief?: string | null };
function withRefs(record: any, refs: Refs) {
  if (!record) return record;
  let out = record;
  for (const [k, v] of Object.entries(refs) as [keyof Refs, string | null | undefined][]) {
    if (v === undefined) continue;
    const { [k]: _, ...rest } = out;
    out = v === null ? rest : { ...rest, [k]: v };
  }
  return out;
}

/** what each document a version may name must be: its media type, and what to call it when it is not */
const REFS = {
  sheet: { is: (t: string) => t.startsWith("image/"), what: "A reference sheet is an image", add: "add_story_frame" },
  datasheet: { is: (t: string) => t === "text/markdown", what: "A data sheet is a Markdown document", add: "add_document" },
  brief: { is: (t: string) => t === "text/markdown", what: "A brief is a Markdown document", add: "add_document" },
} as const;

/**
 * What a version proposed from intent variant `v` holds of the asset's breeds, where it has any (or the variant makes
 * one): each breed as it would then be, its source and card (the breed the variant changes, or makes, as the variant
 * has it; every other one Main as it would then be beneath its own fields), and the breed shown first. A variant of a
 * breed, or one making a breed, changes only a breed's own fields (its source and card). Null: an asset of no breeds.
 */
async function breedsFor(q: Queryable, asset: string, v: number, json: AssetJson): Promise<{ variants: Record<string, { source: string; record: any }>; defaultVariant: string } | null> {
  const docId = assetDocId(asset);
  const row = await docs.variantOf(q, docId, v);
  const breeds = await docs.breedsOf(q, docId);
  if (!breeds.length && row.makes === null) return null;
  const onBreed = row.breed !== null || row.makes !== null;
  if (onBreed) {
    const outside = docs.outsideBreed(await docs.seedOf(q, docId, v), json);
    if (outside.length) throw new AssetDocError(`A breed changes only its own source and card, not ${outside.slice(0, 3).map((p) => p.join(".")).join(", ")}: change those on Main.`);
  }
  const main = onBreed ? ((await docs.readDoc(q, docId)).json as AssetJson) : json;
  const out: { name: string; json: AssetJson }[] = breeds.map((b) => ({ name: b.name, json: b.id === row.breed ? json : docs.breedOn(main, b.json, b.overrides) }));
  if (row.makes !== null) out.push({ name: row.makes, json });
  out.sort((x, y) => (x.name < y.name ? -1 : 1));
  const variants = Object.fromEntries(out.map((x) => [x.name, { source: x.json.source, record: x.json.card }]));
  const defaultVariant = main.defaultVariant && variants[main.defaultVariant] ? main.defaultVariant : out[0].name;
  return { variants, defaultVariant };
}

export async function proposeAsset(db: Db, store: BlobStore, me: Me | null, given: ProposalBody, via: "web" | "mcp" = "web") {
  const who = must(me, "propose", "asset_version");
  let body: ProposalBody = given ?? {};
  // the asset by its UUID; a new asset brings its group and slug (its label, shown) and gets a UUID of its own
  let asset: string;
  let grp: string;
  let slug: string;
  if (body?.asset !== undefined) {
    if (!UUID.test(`${body.asset}`)) throw new VersionError("Name the asset by its id (a UUID).");
    const { rows } = await db.query<{ grp: string; slug: string }>(`SELECT grp, slug FROM play.assets WHERE id = $1`, [body.asset]);
    if (!rows[0]) throw new VersionError("There is no such asset.", 404);
    ({ grp, slug } = rows[0]);
    asset = body.asset;
  } else {
    // a new asset is its new UUID; its group, label and slug are only shown (the slug, the name its recipe is called
    // with, made from the label where none is given), and another asset may share them
    grp = `${body?.new?.group ?? ""}`;
    slug = body?.new?.slug == null || body.new.slug === "" ? slugOf(`${body?.new?.label ?? ""}`) : `${body.new.slug}`;
    if (!isGroup(grp)) throw new VersionError(`A new asset needs its group (${GROUPS.join(", ")}).`);
    if (!SLUG.test(slug)) throw new VersionError("A new asset's slug is lowercase words joined by '-' (or give a label to make it from).");
    asset = newId();
  }
  const { rows: a } = await db.query<{ head: string | null; number: number | null; label: string; card: any; variants: Record<string, any> | null }>(
    `SELECT a.head, v.number, a.label, v.card,
            (SELECT json_object_agg(x.name, x.card) FROM play.asset_variants x WHERE x.version_id = v.id) AS variants
       FROM play.assets a LEFT JOIN play.asset_versions v ON v.id = a.head WHERE a.id = $1`, [asset],
  );
  // a proposal that brings no record of its own takes its head's (the engine it runs on, its label, its parameters),
  // with its own recipe and version written in: an upload of the recipe file alone makes a version the site can build
  // but never what was measured on the head's recipe (its size, triangles, whether it is skinned): this is another one
  const inherited = (own: any, from: any) => {
    if (own) return own;
    if (!from) return undefined;
    const { size: _s, triangles: _t, skinned: _k, ...card } = from.card ?? {};
    return { ...from, card };
  };
  // the card fields a proposal sets over the record it takes: its params, a variant's label
  const over = (record: any, card: Record<string, unknown>) => (Object.keys(card).length ? { ...(record ?? {}), card: { ...(record?.card ?? {}), ...card } } : record);
  let set = cardFields(body.card);
  const head = a[0]?.head ?? null;
  if (body.base !== undefined && (body.base ?? null) !== head)
    throw new VersionError("Someone changed this asset since you started: build it again on its newest version.", 409);
  const n = (a[0]?.number ?? 0) + 1;
  const label = `${body.new?.label ?? body.label ?? a[0]?.label ?? ""}`.trim().slice(0, 120);
  if (!label) throw new VersionError("A new asset needs a label.");

  // an intent variant made edit by edit (doc_edit): proposed as it stands, seeded from the head; its source and card
  // are the version's where the proposal brings none of its own
  let draft: number | undefined;
  let breeding = false;
  if (body.variant == null && body.asset !== undefined && (await db.query(`SELECT 1 FROM play.doc_variants WHERE doc_id = $1 AND type = 'breed' AND status = 'open'`, [assetDocId(asset)])).rows.length)
    throw new VersionError("This asset has breeds: change it with doc_edit and propose_doc_version (Main, a breed with `breed`, or a new one with `new_breed`), so every breed is built from it.", 409);
  if (body.variant != null) {
    if (body.asset === undefined) throw new VersionError("An intent variant is of an asset there already.");
    const d = await db
      .transaction(async (q) => {
        await ensureAssetDoc(q, store, asset);
        const dr = await openVariantOf(q, asset, body.variant);
        return { ...dr, json: await variantState(q, asset, dr.id), seed: await docs.seedOf(q, assetDocId(asset), dr.id) };
      })
      .catch((e) => {
        throw e instanceof AssetDocError ? new VersionError(e.message, e.status) : e;
      });
    if ((d.base ?? null) !== (a[0]?.number ?? null)) throw new VersionError(`This asset has a newer version than the one variant ${d.id} was seeded from: start a variant again on its head.`, 409);
    draft = d.id;
    // a move to another group (intent 89f3ad37): an edit of the asset's own document, its card's group, changed from
    // what it was at the variant's seed; the version is then of that group, and its Accept moves the asset there
    const to = d.json.card?.card?.group;
    if (to !== undefined && to !== grp && to !== d.seed?.card?.card?.group) {
      if (!isGroup(to)) throw new VersionError(`${to} is not an asset group (${GROUPS.join(", ")}).`);
      grp = to;
    }
    // an asset of breeds (play/SPEC.md "Breeds"): the version is Main as it would then be, with every breed built from
    // it as its variant (the breed the intent variant changes, or makes, as it changes it)
    const bred = await db.transaction((q) => breedsFor(q, asset, d.id, d.json)).catch((e) => {
      throw e instanceof AssetDocError ? new VersionError(e.message, e.status) : e;
    });
    if (bred) {
      breeding = true;
      body = { ...body, variants: bred.variants, defaultVariant: bred.defaultVariant };
    }
    if (!breeding && !body.source && !body.recipe && !body.variants) {
      if (d.json.variants?.length)
        body = { ...body, variants: Object.fromEntries(d.json.variants.map((x) => [x.name, { source: x.source ?? d.json.source, record: x.card }])), defaultVariant: d.json.defaultVariant ?? d.json.variants[0].name };
      else body = { ...body, source: d.json.source, ...(body.record === undefined && d.json.card ? { record: d.json.card } : {}) };
    }
    // what its card names (its reference sheet, data sheet and brief; the params its recipe declares) is held as a
    // proposal's own would be
    // (a breed's own record carries them, each its own)
    if (!breeding) {
      for (const k of ["sheet", "datasheet", "brief"] as const) if ((body as any)[k] === undefined && d.json.card && k in d.json.card) (body as any)[k] = d.json.card[k];
      // (params it changed, held as given ones are; the head's carried on as they were)
      if (body.card === undefined && Array.isArray(d.json.card?.card?.params) && JSON.stringify(d.json.card.card.params) !== JSON.stringify(a[0]?.card?.card?.params)) body = { ...body, card: { params: d.json.card.card.params } };
    }
    set = cardFields(body.card);
  }

  const variantNames = Object.keys(body.variants ?? {});
  if (!!(body.recipe || body.source) === !!variantNames.length) throw new VersionError("Give either the version's source (or recipe file) or its variants, not both.");
  const files: { text: string; hash: string }[] = [];
  let recipe: string | null = null;
  let source: string | null = null;
  let own: { libs: string[]; source: string; pieces: string[] } | null = null;
  let defaultVariant: string | null = null;
  const variants: Record<string, { recipe: string; source: string; card: any }> = {};
  // the readable sources as text, for the version's edit of the asset's document
  let ownText = "";
  const variantTexts: Record<string, string> = {};
  if (body.recipe || body.source) {
    const c = checkedCode(body, slug, n, null);
    files.push(c.source, c.recipe);
    recipe = c.recipe.hash;
    source = c.source.hash;
    own = { libs: c.libs, source: c.source.hash, pieces: await piecesFor(db, c.pieces) };
    ownText = c.source.text;
  } else {
    for (const name of variantNames) {
      if (!VARIANT.test(name)) throw new VersionError(`${name} is not a variant's name.`);
      const c = checkedCode(body.variants![name], slug, n, name);
      files.push(c.source, c.recipe);
      variantTexts[name] = c.source.text;
      const from = a[0]?.variants?.[name] ?? a[0]?.card;
      const label = body.variants![name].label === undefined ? {} : { label: `${body.variants![name].label}`.trim().slice(0, 120) };
      const record = heldRecord(over(inherited(body.variants![name].record, from), { ...set, ...label }), c.libs, c.source.hash, await piecesFor(db, c.pieces));
      variants[name] = { recipe: c.recipe.hash, source: c.source.hash, card: recordOf(record, grp, slug, n, name, c.recipe.hash) };
    }
    defaultVariant = body.defaultVariant ?? variantNames[0];
    if (!variants[defaultVariant]) throw new VersionError(`${defaultVariant} is not one of its variants.`);
  }
  // its documents (play/SPEC.md §4.10): its reference sheet (an image), its data sheet and its sheet's brief (Markdown),
  // each a file play keeps, named by its hash in the version's record, and carried on from the head like the rest of the
  // record unless the proposal names another (or null, none)
  const refs: Refs = {};
  for (const k of Object.keys(REFS) as (keyof typeof REFS)[]) {
    const given = (body as any)[k];
    if (given === undefined) continue;
    const h = given === null || given === "" ? null : `${given}`;
    if (h !== null) {
      if (!HASH.test(h)) throw new VersionError(`A ${k} is named by its BLAKE3 hash (64 hex characters).`);
      const { rows: f } = await db.query<{ media_type: string }>(`SELECT media_type FROM play.files WHERE hash = $1`, [h]);
      if (!f[0]) throw new VersionError(`play keeps no file by that hash: add the ${k} first (MCP ${REFS[k].add}).`);
      if (!REFS[k].is(f[0].media_type)) throw new VersionError(`${REFS[k].what}.`);
    }
    refs[k] = h;
  }
  for (const v of Object.values(variants)) v.card = withRefs(v.card, refs);
  const card = withRefs(recipe ? recordOf(heldRecord(over(inherited(body.record, a[0]?.card), set), own!.libs, own!.source, own!.pieces), grp, slug, n, null, recipe) : variants[defaultVariant!].card, refs);
  // every other asset a version names, it names by hash (play/SPEC.md §4)
  const readable = [card, ...Object.values(variants).map((x) => x.card)].flatMap((c) => readableRefs(c, `${grp}/${slug}`));
  if (readable.length) throw new VersionError(`Name other assets by their hash, not ${readable.slice(0, 3).join(", ")}.`);
  const engine = Number(card?.engine?.version ?? card?.card?.engine) || null;
  const content = { asset, parents: head ? [head] : [], recipe, defaultVariant, variants, card, engine };
  const id = versionId(content);

  for (const f of files) await store.put(f.hash, new TextEncoder().encode(f.text), MEDIA);
  let intent = "", variantId = 0, edits = 0;
  await db.transaction(async (tx) => {
    for (const f of files)
      await tx.query(`INSERT INTO play.files (hash, size, media_type, bucket_key) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [
        f.hash, Buffer.byteLength(f.text), MEDIA, `blobs/${f.hash.slice(0, 2)}/${f.hash}`,
      ]);
    await tx.query(`INSERT INTO play.assets (id, coop_id, grp, slug, label) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`, [asset, COOP, grp, slug, label]);
    await tx.query(
      `INSERT INTO play.asset_versions (id, asset_id, parents, recipe_hash, source_hash, default_variant, card, engine, author, note)
       VALUES ($1, $2, $3, $4, $5, $6, ($7::text)::jsonb, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
      [id, asset, content.parents, recipe, source, defaultVariant, JSON.stringify(card), engine, who.id, `${body.note ?? ""}`.slice(0, NOTE_MOST)],
    );
    for (const [name, x] of Object.entries(variants))
      await tx.query(`INSERT INTO play.asset_variants (version_id, name, recipe_hash, source_hash, card) VALUES ($1, $2, $3, $4, ($5::text)::jsonb) ON CONFLICT DO NOTHING`, [id, name, x.recipe, x.source, JSON.stringify(x.card)]);
    // its intent variant of the asset's Loro document (play/SPEC.md §4.4): the one it was made on, or a new one seeded
    // at its head, the version as proposed its last edit
    const note = `${body.note ?? ""}`.slice(0, NOTE_MOST);
    const json: AssetJson = asAssetJson(label, {
      note, engine, card, defaultVariant,
      source: recipe ? ownText : variantTexts[defaultVariant!],
      variants: Object.entries(variants).map(([name, x]) => ({ name, source: variantTexts[name], card: x.card })),
    });
    const v = await proposalVariant(tx, store, { asset, base: a[0]?.number ?? null, json: breeding ? null : json, note, author: authorOf(who, via === "mcp" ? "mcp" : "site"), variant: draft }).catch((e) => {
      throw e instanceof AssetDocError ? new VersionError(e.message, e.status) : e;
    });
    intent = await putAtProposal(tx, who, { intent: body.intent, work: { kind: ASSET_WORK, doc_id: assetDocId(asset), doc_variant: v, asset_id: asset, base: head, version: id }, note, via }).catch((e) => {
      throw e instanceof WorkError ? new VersionError(e.message, e.status) : e;
    });
    edits = (await docs.history(tx, assetDocId(asset), { variant: v })).length;
    variantId = v;
  });
  return { intent, stage: await stageAfter(db, intent), asset, version: id, number: n, base: head, variant: variantId, edits };
}

/** an asset's intent variant proposed as it stands (./versioned.ts propose_doc_version): its recipe files made, its frozen version written */
export async function proposeAssetVariant(ctx: Ctx, me: Me, o: { id: string; variant: number; note: string; intent?: string }, via: "web" | "mcp") {
  return proposeAsset(ctx.db, ctx.store, me, { asset: o.id, variant: o.variant, note: o.note, ...(o.intent ? { intent: o.intent } : {}) }, via);
}

/**
 * An asset's work as people review it beside its changes and edits (./versioned.ts reviewDoc; `p` the intent's work as
 * ./intents.ts lists it, with its label, group and number): its readable source and recipe files, the base's source to
 * set it beside, and the version as the catalog would list it once accepted (`builds`), so the page builds it in the
 * asset box, the sandboxed frame every recipe runs in, before anyone accepts it.
 */
export async function assetReview(db: Queryable, p: any) {
  const { rows: v } = await db.query<any>(
    `SELECT v.recipe_hash, v.source_hash, v.card, v.default_variant, f.size FROM play.asset_versions v
       LEFT JOIN play.files f ON f.hash = v.recipe_hash WHERE v.id = $1`, [p.version],
  );
  const { rows: x } = await db.query<any>(
    `SELECT x.name, x.recipe_hash, x.source_hash, x.card, f.size FROM play.asset_variants x
       JOIN play.files f ON f.hash = x.recipe_hash WHERE x.version_id = $1 ORDER BY x.name`, [p.version],
  );
  const { rows: b } = p.base
    ? await db.query<any>(
        `SELECT v.number, v.recipe_hash, v.source_hash, (SELECT x.source_hash FROM play.asset_variants x WHERE x.version_id = v.id AND x.name = v.default_variant) AS variant_source
           FROM play.asset_versions v WHERE v.id = $1`, [p.base],
      )
    : { rows: [] };
  const row = (hash: string, size: unknown, record: any, variant: string | null, first: boolean) => ({
    hash, size: Number(size), asset: p.asset_id, group: p.grp, slug: p.slug, v: p.number, variant, first,
    label: record?.card?.label ?? record?.title ?? p.label, record, proposed: true,
  });
  const builds = v[0]?.recipe_hash
    ? [row(v[0].recipe_hash, v[0].size, v[0].card, null, false)]
    : x.map((r) => row(r.recipe_hash, r.size, r.card, r.name, r.name === v[0]?.default_variant));
  return {
    source: v[0]?.source_hash ?? null,
    recipe: v[0]?.recipe_hash ?? null,
    variants: x.map((r) => ({ name: r.name, recipe: r.recipe_hash, source: r.source_hash })),
    baseVersion: b[0] ? { number: b[0].number, source: b[0].source_hash ?? b[0].variant_source ?? null, recipe: b[0].recipe_hash } : null,
    builds,
    // the pieces it names by hash (play/SPEC.md §4.5), each its label and version
    pieces: await piecesShown(db, [...new Set([v[0]?.card, ...x.map((r) => r.card)].flatMap((c) => (Array.isArray(c?.manifest?.pieces) ? c.manifest.pieces : [])))]),
  };
}

/**
 * Accept or archive an asset's work (its intent locked by the caller's transaction). It is accepted only on the head it
 * was made on (else it is archived, to be proposed again on the new head), so what is accepted is exactly the version
 * the board built and showed in the asset box; its intent variant is merged and named the version's number. The other
 * work made on the same head is archived then.
 */
export async function decideAsset(tx: Queryable, store: BlobStore, me: Me, p: any, verdict: Verdict) {
  const id = p.id as string;
  {
    must(me, "decide", "asset_version");
    if (verdict === "archive") {
      await settle(tx, id, "archived", me.id);
      await closeWork(tx, me, p);
      return { id, status: "archived" };
    }
    const { rows: a } = await tx.query<{ head: string | null; number: number | null }>(
      `SELECT a.head, v.number FROM play.assets a LEFT JOIN play.asset_versions v ON v.id = a.head WHERE a.id = $1 FOR UPDATE OF a`, [p.asset_id],
    );
    if ((a[0]?.head ?? null) !== (p.base ?? null)) {
      await settle(tx, id, "archived", null);
      await closeWork(tx, me, p);
      return { id, status: "archived", message: "This asset has a newer version than the one this was made on: build it again on its head." };
    }
    // the asset's document, made from its history first where it has none (and this work's intent variant, if it lacks one)
    await ensureAssetDoc(tx, store, p.asset_id).catch((e) => {
      throw e instanceof AssetDocError ? new VersionError(e.message, e.status) : e;
    });
    const n = (a[0]?.number ?? 0) + 1;
    await tx.query(`UPDATE play.asset_versions SET number = $2, approved_by = $3 WHERE id = $1`, [p.version, n, me.id]);
    // the asset stands in the group its accepted version names (a move by its document, intent 89f3ad37)
    const { rows: g } = await tx.query<{ grp: string | null }>(`SELECT card->'card'->>'group' AS grp FROM play.asset_versions WHERE id = $1`, [p.version]);
    const grp = isGroup(g[0]?.grp) ? g[0].grp : null;
    await tx.query(`UPDATE play.assets SET head = $2, grp = COALESCE($3, grp) WHERE id = $1`, [p.asset_id, p.version, grp]);
    await settle(tx, id, "accepted", byOf(me));
    await acceptVariant(tx, store, p, me, n);
    // a version proposed with its variants given whole: they are the asset's breeds from now on
    await asAssetError(() => breedsFromVariants(tx, assetDocId(p.asset_id)));
    // the other intents' work made on the same head can go in no more: archived, to be built again on the new one
    const { rows: stale } = await tx.query<any>(
      `SELECT ${WORK_OF} FROM play.intents i
        WHERE i.asset_id = $1 AND i.work = $4 AND i.stage IN ('build', 'proposal') AND i.id <> $2 AND i.base IS NOT DISTINCT FROM $3 FOR UPDATE`,
      [p.asset_id, id, p.base, ASSET_WORK],
    );
    for (const s of stale) {
      await settle(tx, s.id, "archived", null);
      await closeWork(tx, me, s);
    }
    return { id, status: "accepted", number: n, version: p.version };
  }
}

