// The asset groups, named once (intent 89f3ad37): list_assets' and propose_asset's enum (./mcp.ts) and the check of a
// new asset's group and of a move to another (./assetdocs.ts) all read this list. Each is an app of its own on the site
// ($lib/app/groups.ts): `actors` the animals, `characters` the people of Maia City (admins only). A group is only shown:
// an asset is named by its UUID, and moves to another group by its own document (its card's group), proposed naming an
// intent and accepted with it, never by a migration.
export const GROUPS = ["plants", "things", "machines", "buildings", "actors", "characters", "biomes", "worlds"] as const;
export type Group = (typeof GROUPS)[number];
/** whether `g` is one of the asset groups */
export const isGroup = (g: unknown): g is Group => typeof g === "string" && (GROUPS as readonly string[]).includes(g);
