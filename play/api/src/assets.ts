// The asset library, read (play/SPEC.md §4, §7): every asset Maia City owns, each with its versions as a chain, each
// version's variants, and a ref resolved to the recipe file a sandbox builds.
import type { Queryable } from "./pg";
import { piecesShown } from "./pieces";
import { lodOf } from "./lod";

export class NotFound extends Error {
  status = 404;
}

/**
 * What a version's card says of it. Its measures (size, triangles, skinned) only where they were measured on its own
 * recipe: a version proposed before 2026-11-05 took its parent's card whole, its measures with it, so a measure the
 * same as its parent's is the parent's and is not shown.
 */
export const summary = (record: any, parent?: any) => {
  const c = record?.card ?? {};
  const p = parent?.card;
  const inherited = !!p && c.size != null && JSON.stringify(c.size) === JSON.stringify(p.size) && c.triangles === p.triangles;
  return {
    cardLabel: c.label ?? record?.title ?? null,
    size: inherited ? null : (c.size ?? null),
    triangles: inherited ? null : (c.triangles ?? null),
    skinned: inherited ? null : (c.skinned ?? null),
    params: record?.params ?? c.params ?? [],
    sheet: typeof record?.sheet === "string" ? record.sheet : null,
    datasheet: typeof record?.datasheet === "string" ? record.datasheet : null,
    brief: typeof record?.brief === "string" ? record.brief : null,
    // its levels of detail (./lod.ts): a version from before the contract names none, and is read as derived
    lod: lodOf(c),
  };
};

/** every asset with a version, by group and slug, with its newest version's summary */
export async function listAssets(db: Queryable, grp?: string) {
  const { rows } = await db.query<any>(
    `SELECT a.id, a.grp, a.slug, a.label, v.number AS head, v.card,
            (SELECT p.card FROM play.asset_versions p WHERE p.id = v.parents[1]) AS parent_card,
            (SELECT count(*) FROM play.asset_versions x WHERE x.asset_id = a.id AND x.number IS NOT NULL) AS versions
       FROM play.assets a JOIN play.asset_versions v ON v.id = a.head
      WHERE ($1::text IS NULL OR a.grp = $1)
      ORDER BY a.grp, a.slug`,
    [grp ?? null],
  );
  return rows.map((r) => ({ id: r.id, grp: r.grp, slug: r.slug, label: r.label, head: r.head, versions: Number(r.versions), ...summary(r.card, r.parent_card) }));
}

/** one asset and its whole chain, newest first */
export async function assetOf(db: Queryable, id: string) {
  const { rows: a } = await db.query<any>(`SELECT id, grp, slug, label, head, coop_id, created, sound, sound_gain FROM play.assets WHERE id = $1`, [id]);
  if (!a[0]) throw new NotFound(`There is no asset ${id}.`);
  const { rows: versions } = await db.query<any>(
    `SELECT v.id, v.number, v.parents, v.recipe_hash, v.source_hash, v.default_variant, v.card, v.engine, v.note, v.created, v.imported,
            (SELECT p.card FROM play.asset_versions p WHERE p.id = v.parents[1]) AS parent_card,
            au.name AS author, ap.name AS approved_by,
            COALESCE((SELECT json_agg(json_build_object('name', x.name, 'recipe', x.recipe_hash, 'source', x.source_hash, 'label', x.card->'card'->>'label') ORDER BY x.name)
                        FROM play.asset_variants x WHERE x.version_id = v.id), '[]') AS variants
       FROM play.asset_versions v
       LEFT JOIN play.humans au ON au.id = v.author
       LEFT JOIN play.humans ap ON ap.id = v.approved_by
      WHERE v.asset_id = $1 AND v.number IS NOT NULL
      ORDER BY v.number DESC`,
    [id],
  );
  const shown = await shownPieces(db, versions.map((v) => v.card));
  return {
    ...a[0],
    versions: versions.map((v) => ({
      pieces: shown(v.card),
      id: v.id, number: v.number, parents: v.parents, recipe: v.recipe_hash, source: v.source_hash, defaultVariant: v.default_variant,
      engine: v.engine, note: v.note, created: v.created, author: v.author ?? (v.imported ? v.imported.authors?.join(", ") : null),
      approvedBy: v.approved_by, imported: !!v.imported, variants: v.variants, ...summary(v.card, v.parent_card),
    })),
  };
}

/** one version of an asset with its whole record and its variants' records */
export async function versionOf(db: Queryable, id: string, number: number) {
  const { rows } = await db.query<any>(
    `SELECT v.*, COALESCE((SELECT json_agg(json_build_object('name', x.name, 'recipe', x.recipe_hash, 'source', x.source_hash, 'card', x.card) ORDER BY x.name)
                            FROM play.asset_variants x WHERE x.version_id = v.id), '[]') AS variants
       FROM play.asset_versions v WHERE v.asset_id = $1 AND v.number = $2`,
    [id, number],
  );
  if (!rows[0]) throw new NotFound(`There is no ${id}@${number}.`);
  const v = rows[0];
  return { id: v.id, asset: id, number: v.number, parents: v.parents, recipe: v.recipe_hash, source: v.source_hash, defaultVariant: v.default_variant, card: v.card, engine: v.engine, note: v.note, variants: v.variants, imported: v.imported };
}

/** what a sandbox draws: each slot, the build it pins (`<hash>?values`), and what that is, for showing; `state`: its
 * pins as a proposal would make them (./sandboxes.ts) instead of as they are */
export async function pinsOf(db: Queryable, sandbox: string, state?: { pins: Record<string, { version: string; variant: string | null; params: Record<string, string> | null }> }) {
  const { rows: s } = await db.query(`SELECT 1 FROM play.sandboxes WHERE id = $1`, [sandbox]);
  if (!s[0]) throw new NotFound(`There is no ${sandbox}.`);
  const pins = state
    ? Object.entries(state.pins).map(([slot, p]) => ({ slot, version_id: p.version, variant: p.variant, params: p.params }))
    : (await db.query<any>(`SELECT slot, version_id, variant, params FROM play.sandbox_pins WHERE sandbox_id = $1`, [sandbox])).rows;
  const { rows: vs } = await db.query<any>(
    `SELECT v.id, v.asset_id, v.number, v.recipe_hash, v.default_variant,
            COALESCE((SELECT json_object_agg(x.name, x.recipe_hash) FROM play.asset_variants x WHERE x.version_id = v.id), '{}') AS variants
       FROM play.asset_versions v WHERE v.id = ANY($1)`,
    [[...new Set(pins.map((p: any) => p.version_id))]],
  );
  const byId = new Map(vs.map((v) => [v.id, v]));
  return pins
    .sort((a: any, b: any) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0))
    .map((p: any) => {
      const v = byId.get(p.version_id);
      const used = p.variant ?? v.default_variant;
      const hash = p.variant ? v.variants[p.variant] : (v.recipe_hash ?? v.variants[v.default_variant]);
      const values = p.params ? Object.entries(p.params as Record<string, string>).sort(([a], [b]) => (a < b ? -1 : 1)) : [];
      const build = values.length ? `${hash}?${new URLSearchParams(values)}` : hash;
      return { slot: p.slot, build, hash, asset: v.asset_id, number: v.number, variant: used };
    });
}

/** whether `hash` is a file play keeps, and its type */
export async function fileOf(db: Queryable, hash: string) {
  const { rows } = await db.query<{ hash: string; size: string; media_type: string }>(`SELECT hash, size, media_type FROM play.files WHERE hash = $1`, [hash]);
  return rows[0] ?? null;
}

/**
 * The catalog (play/SPEC.md §4): every accepted version and variant by the BLAKE3 hash of its recipe file — the one
 * name a sandbox or another asset knows it by — with what it is (its asset, version, variant and label, for showing)
 * and its record (its card, manifest, contract and engine), which the site builds it by.
 */
export async function catalogOf(db: Queryable) {
  const { rows } = await db.query<any>(
    `SELECT v.asset_id, a.grp, a.slug, v.number, NULL::text AS variant, v.recipe_hash AS hash, v.card AS record, f.size, false AS is_default
       FROM play.asset_versions v JOIN play.assets a ON a.id = v.asset_id JOIN play.files f ON f.hash = v.recipe_hash
      WHERE v.number IS NOT NULL
     UNION ALL
     SELECT v.asset_id, a.grp, a.slug, v.number, x.name, x.recipe_hash, x.card, f.size, x.name = v.default_variant
       FROM play.asset_variants x JOIN play.asset_versions v ON v.id = x.version_id JOIN play.assets a ON a.id = v.asset_id
       JOIN play.files f ON f.hash = x.recipe_hash
      WHERE v.number IS NOT NULL
      ORDER BY 1, 4, 5 NULLS FIRST`,
  );
  const shown = await shownPieces(db, rows.map((r) => r.record));
  return rows.map((r) => ({
    hash: r.hash, size: Number(r.size), asset: r.asset_id, group: r.grp, slug: r.slug, v: r.number, variant: r.variant,
    first: !!r.is_default, label: r.record?.card?.label ?? r.record?.title ?? `${r.grp}/${r.slug}`, record: r.record,
    ...(r.record?.manifest?.pieces?.length ? { pieces: shown(r.record) } : {}),
  }));
}

/** the pieces records name in their manifests (play/SPEC.md §4.5), each as shown (its label, version and hash): one query for all */
async function shownPieces(db: Queryable, records: any[]) {
  const named = (r: any): string[] => (Array.isArray(r?.manifest?.pieces) ? r.manifest.pieces : []);
  const all = [...new Set(records.flatMap(named))];
  const by = new Map((await piecesShown(db, all)).map((p) => [p.hash, p]));
  return (r: any) => named(r).map((h) => by.get(h)!);
}

/**
 * A sandbox's config: its pins as `assets`, each slot the build it pins (`<hash>?values`), and every other config it
 * keeps by name (Sandbox 1's `garden`), each planting's slot handed out as its build (`asset`).
 */
export async function configOf(db: Queryable, sandbox: string, state?: { pins: Record<string, any>; configs: Record<string, unknown> }) {
  const pins = await pinsOf(db, sandbox, state);
  const assets = Object.fromEntries(pins.map((p) => [p.slot, p.build]));
  const numbers = Object.fromEntries(pins.map((p) => [p.slot, p.number]));
  const rows = state
    ? Object.entries(state.configs).map(([name, data]) => ({ name, data }))
    : (await db.query<{ name: string; data: any }>(`SELECT name, data FROM play.sandbox_configs WHERE sandbox_id = $1`, [sandbox])).rows;
  const withBuilds = (o: any): any => {
    if (Array.isArray(o)) return o.map(withBuilds);
    if (o && typeof o === "object") {
      const out = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, withBuilds(v)]));
      if (typeof o.slot === "string") {
        if (!assets[o.slot]) throw new NotFound(`${sandbox}'s config names slot ${o.slot}, which it doesn't pin`);
        out.asset = assets[o.slot];
        // a planting's version, as its pin now names it
        if ("v" in o) out.v = numbers[o.slot];
      }
      return out;
    }
    return o;
  };
  return { sandbox, assets, ...Object.fromEntries(rows.map((r) => [r.name, withBuilds(r.data)])) };
}
