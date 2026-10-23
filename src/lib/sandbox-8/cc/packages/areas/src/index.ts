/**
 * Areas (design/modular-split.md §5.3): which law and practice apply at a place.
 *
 * An area is a named territory with a parent (a country, a state in it, a district in that). Law and practice come in
 * packs, and a pack says for which area it speaks: a law pack for the area whose authority made the law, a practice
 * pack for the areas where people work that way. A pack that speaks for no area (a region's place physics, its
 * economy) applies everywhere in the world it is chosen for.
 *
 * The `areas` port answers two questions:
 * - `at(place)`: the chain of areas at a place, from the most general to the most specific. The world lies in one
 *   area (its world definition says which); a place inside a part of it with its own bounds (a second state, a town's
 *   statute) gets that part too. Today no area has bounds, so every place of a world has the world's one chain; a
 *   border later is data (`bounds`), not code.
 * - `catalog(name, place, keys)`: the named catalog as the packs give it there, merged key by key along the chain,
 *   the specific over the general (a state's building code over the federal default), then the practice of the
 *   party's own and of the person's own, the most specific of all (someone who prays at set times keeps to them in
 *   any area). The keys and the data shape for own practice are here; no pack fills them in yet.
 *
 * The world's merged view, `read.data(name)`, is the same merge along the world's one chain, made when the world is
 * laid out (`layPacks`) and normalized by the owning module's schema. Call sites keep reading it and move to the port
 * when the split touches them; the port gives the catalog as the packs wrote it (units as written), for its owner
 * to parse with the catalog's schema.
 */
import { defineModule, s, type EntityId, type Infer, type ModuleDef, type ReadCtx } from '../../kernel/src/index.ts';
import { polygonContains, type Vec2 } from '../../geo/src/index.ts';

/** an area: its label, the area it lies in, and (for a part of its parent only) its bounds in world metres */
export const AreaSchema = s.object({
  label: s.string(),
  parent: s.string().optional(),
  /** where a part covers less of its parent than all of it within the world: a polygon on the ground plane (absent: all of it) */
  bounds: s.array(s.point()).optional(),
});
export type Area = Infer<typeof AreaSchema>;

/** what a pack is to a world: place physics, economy, practice, law (decision 0010), or who arrives with what (decision 0011) */
export const PACK_ROLES = ['region', 'economy', 'practice', 'law', 'starter'] as const;
export type PackRole = (typeof PACK_ROLES)[number];

/**
 * A data pack: its role, its catalogs, and the area it speaks for. Practice and law speak for an area; place
 * physics, a market and what the players bring are the world's own (no area), everywhere in it. An L3 pack may
 * bring code (a starter's setup).
 */
export interface Pack {
  role: PackRole;
  area?: string;
  catalogs: Record<string, unknown>;
  modules?: ModuleDef[];
}

/** whether a pack of this role speaks for an area (practice, law) or is the world's own (place physics, market, starters) */
export const speaksForArea = (role: PackRole): boolean => role === 'practice' || role === 'law';

/** catalog name → catalog, as a pack or one's own practice gives it */
const CatalogsSchema = s.record(s.any<unknown>());

/**
 * How the world's packs lie on its areas, for lookups by place: the area the world lies in, every pack as listed
 * (the port orders them along the chain at each place), and the practice of parties and persons of their own (by
 * party or person id, then catalog).
 */
export const AreaLayersSchema = s.object({
  world: s.string(),
  packs: s.array(s.object({ id: s.string(), area: s.string().optional(), catalogs: CatalogsSchema })),
  own: s.object({ party: s.record(CatalogsSchema), person: s.record(CatalogsSchema) }),
});
export type AreaLayers = Infer<typeof AreaLayersSchema>;

/** whose own practice a lookup takes in: a party's (a firm's way of working, a household's customs), a person's */
export interface PracticeKeys {
  party?: EntityId;
  person?: EntityId;
}

export interface AreasPort {
  /** the areas at a place, from the most general to the most specific */
  at(place: Vec2): string[];
  /** a catalog at a place: merged key by key along its areas, then the party's and the person's own practice; undefined where no pack has it */
  catalog(name: string, place: Vec2, keys?: PracticeKeys): unknown;
  area(id: string): Area | undefined;
}

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    areas: AreasPort;
  }
  interface DataTypes {
    areas: Record<string, Area>;
    areaLayers: AreaLayers;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Catalogs merge by key (decision 0010): the practice pack gives the labour settings their working-time law, the
 * economy pack their surcharges, the region its people. A later catalog's entry replaces an earlier one.
 */
export function mergeCatalogs(into: Record<string, unknown>, catalogs: Record<string, unknown>): Record<string, unknown> {
  for (const [name, catalog] of Object.entries(catalogs)) {
    const old = into[name];
    into[name] = isRecord(old) && isRecord(catalog) ? { ...old, ...catalog } : catalog;
  }
  return into;
}

/** the chain of an area: its ancestors from the most general, and itself */
export function chainOf(areas: Readonly<Record<string, Area>>, id: string): string[] {
  const chain: string[] = [];
  for (let at: string | undefined = id; at !== undefined; at = areas[at]?.parent) {
    if (!areas[at]) throw new Error(chain.length ? `area '${chain[0]}' lies in '${at}', which is no known area` : `unknown area '${at}'`);
    if (chain.includes(at)) throw new Error(`the areas above '${id}' go round in a circle`);
    chain.unshift(at);
  }
  return chain;
}

/** the chain at a place: the world's area and its ancestors, then each part below whose bounds hold the place */
export function areasAt(areas: Readonly<Record<string, Area>>, world: string, place: Vec2): string[] {
  const chain = chainOf(areas, world);
  for (;;) {
    const last = chain[chain.length - 1];
    const part = Object.keys(areas).sort().find((id) => areas[id]!.parent === last && areas[id]!.bounds !== undefined && polygonContains(areas[id]!.bounds!, place));
    if (part === undefined) return chain;
    chain.push(part);
  }
}

/** the packs that speak at a chain of areas, in merge order: the world's own first, then from the most general area to the most specific */
export function packsAlong<P extends { area?: string }>(packs: readonly P[], chain: readonly string[]): P[] {
  const rank = (p: P) => (p.area === undefined ? 0 : chain.indexOf(p.area) + 1);
  return packs.filter((p) => p.area === undefined || chain.includes(p.area)).map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(({ p }) => p);
}

/** a catalog merged along the packs of a chain, then one's own practice (a party's, then a person's); undefined where nobody gives it */
export function catalogAlong(name: string, packs: readonly { catalogs: Readonly<Record<string, unknown>> }[], own: readonly (Readonly<Record<string, unknown>> | undefined)[] = []): unknown {
  const out: Record<string, unknown> = {};
  for (const c of [...packs.map((p) => p.catalogs), ...own]) if (c && name in c) mergeCatalogs(out, { [name]: c[name] });
  return out[name];
}

/**
 * Lay a world's packs on its areas (world resolution, decision 0021): the areas the packs declare (their `areas`
 * catalogs), the chain of the area the world lies in, and the world's merged view along it: its own packs first in
 * the order listed, then the area packs from the most general area to the most specific, each area's in the order
 * listed. A pack for an area the world does not reach is refused; one for a bounded part of the world's area applies
 * only at the places inside it, through the port, and not in the merged view. The result carries the layers the
 * `areas` port looks things up in (`areaLayers`).
 */
export function layPacks(packs: readonly { id: string; pack: Pack }[], world: string): { data: Record<string, unknown>; chain: string[] } {
  const { areas, chain } = reachOf(packs, world);
  const data: Record<string, unknown> = {};
  for (const { pack } of packsAlong(packs.map((p) => ({ ...p, area: p.pack.area })), chain)) mergeCatalogs(data, pack.catalogs);
  // (the layers are the world's own copy: a runtime freezes its data, and the packs are shared by every world made of them)
  const layers = packs.map(({ id, pack }) => ({ id, ...(pack.area !== undefined ? { area: pack.area } : {}), catalogs: structuredClone(pack.catalogs) }));
  // (every area a pack declares, a bounded part's too; no pack gives own practice yet: its keys and shape wait for the scenario that needs them)
  data.areas = areas;
  data.areaLayers = { world, packs: layers, own: { party: {}, person: {} } };
  return { data, chain };
}

/**
 * The areas a world's packs declare (their `areas` catalogs) and the chain of the area the world lies in; throws where
 * the world's area is unknown or a pack speaks for an area the world does not reach.
 */
export function reachOf(packs: readonly { id: string; pack: Pack }[], world: string): { areas: Record<string, Area>; chain: string[] } {
  const areas: Record<string, Area> = {};
  for (const { pack } of packs) Object.assign(areas, (pack.catalogs.areas as Record<string, Area> | undefined) ?? {});
  const chain = chainOf(areas, world);
  for (const { id, pack } of packs) {
    if (pack.area === undefined || chain.includes(pack.area)) continue;
    // (a part below the world's area is reached only where it has bounds, and so is every area between)
    const below = chainOf(areas, pack.area);
    if (!below.includes(world) || below.slice(below.indexOf(world) + 1).some((a) => areas[a]!.bounds === undefined)) throw new Error(`pack '${id}' speaks for area '${pack.area}', which the world in '${world}' does not reach`);
  }
  return { areas, chain };
}

function areasPort(read: ReadCtx): AreasPort {
  const areas = read.data('areas');
  const layers = read.data('areaLayers');
  return {
    at: (place) => areasAt(areas, layers.world, place),
    catalog: (name, place, keys = {}) => catalogAlong(name, packsAlong(layers.packs, areasAt(areas, layers.world, place)), [keys.party !== undefined ? layers.own.party[keys.party] : undefined, keys.person !== undefined ? layers.own.person[keys.person] : undefined]),
    area: (id) => areas[id],
  };
}

export const areasModule = defineModule({
  id: 'areas',
  label: 'Areas',
  description: 'Which law and practice apply at a place: the chain of areas there, and catalogs merged along it.',
  provides: ['areas'],
  data: { areas: s.record(AreaSchema), areaLayers: AreaLayersSchema },
  ports: { areas: areasPort },
});
