/**
 * World definitions (decisions 0021, 0022) and world manifests (design/modular-split.md §6.1).
 *
 * Defining a world is separate from acting in it. A world definition says what a world *is*: the
 * area it lies in, and which data packs describe the place, its economy, and the practice and law
 * of its areas (each such pack speaks for an area, `@cc/areas`); the starter pack (what
 * the players arrive with); how every model contract is bound to its source — a built-in model, an
 * external simulation, measured or entered data — and what happens where a source has a gap; and
 * the clock. Players and their agents only act in the world they find; nothing here is reachable
 * through player commands.
 *
 * A game supplies a registry of what it can offer (packs, datasets, the sources it can bind per
 * contract); `manifestOf` turns a definition into a manifest: the modules, the implementation chosen
 * per contract, the packs in their roles, the area, what the bindings bring, the locale. `composeWorld`
 * checks a manifest against the packs and the locale it names (outside the kernel, before anything runs), lays the packs
 * on the world's areas (`layPacks`) and turns it into a runtime configuration, its calendar writing dates in that locale. A game without definitions (the quarry) writes its manifest directly.
 */
import { parseOrThrow, s, type CalendarDate, type EntityId, type Infer, type Locale, type ModuleDef, type RuntimeConfig } from '../../kernel/src/index.ts';
import { areasModule, layPacks, mergeCatalogs, reachOf, speaksForArea, type Pack, type PackRole } from '../../areas/src/index.ts';

export const BindingSchema = s.object({
  /** the contract (port) being bound, e.g. 'weather' */
  contract: s.string(),
  source: s.object({
    kind: s.enum(['model', 'external', 'measured', 'entered']),
    /** model or external implementation id (kind 'model' / 'external') */
    implementation: s.string().optional(),
    /** dataset id (kind 'measured' / 'entered') */
    dataset: s.string().optional(),
    /** connection id of the gRPC bridge (kind 'external', decision 0024) */
    connection: s.string().optional(),
    /** fields the author accepts from the model where the data has none (declared, never silent) */
    modelledFields: s.array(s.string()).optional(),
  }),
  /** what happens where the source has no value: wait (legibly), fall back to the model (marked), or fail */
  gap: s.object({ policy: s.enum(['wait', 'fallback', 'fail']) }).optional(),
});
export type Binding = Infer<typeof BindingSchema>;

/** an outside source the world definition connects (decision 0024): a measurement feed or an external model */
export const ConnectionSchema = s.object({
  id: s.string(),
  label: s.string().optional(),
  /** 'feed': pushes measurements to the host's Bridge service; 'model': an ExternalModel service the host calls */
  kind: s.enum(['feed', 'model']),
  /** where an external model listens (kind 'model'), e.g. 'http://127.0.0.1:50051' */
  url: s.string().optional(),
  /**
   * the environment variable holding the secret token: a feed must present it, a model is sent it.
   * Never the token itself: a world definition is saved, journaled and shared. Local feeds may go without.
   */
  tokenEnv: s.string().optional(),
});
export type Connection = Infer<typeof ConnectionSchema>;

export const WorldDefinitionSchema = s.object({
  id: s.string(),
  label: s.string(),
  description: s.string().optional(),
  seed: s.int(),
  epoch: s.object({ year: s.int(), month: s.int({ min: 1, max: 12 }), day: s.int({ min: 1, max: 31 }) }),
  /** the area the world lies in (design/modular-split.md §5.3): the law and practice packs of it and of the areas above it apply */
  area: s.string(),
  /**
   * data packs: place physics, economy, practice, law (decision 0010). Catalogs of several packs merge by key; the
   * world's own packs (no area) first in the order listed, then the area packs from the most general area to the most
   * specific (`layPacks`); a later pack's entry replaces an earlier one
   */
  packs: s.array(s.string()),
  /** who is there at the start, each a party with what it brings (decisions 0011, 0025); the first is the seat a single-seat host plays */
  starters: s.array(s.string()),
  bindings: s.array(BindingSchema),
  /** outside sources: measurement feeds and external models (decision 0024) */
  connections: s.array(ConnectionSchema).optional(),
  /** 'free' (default): time runs when players run it; 'realtime': follows the wall clock (live feeds) */
  clock: s.enum(['free', 'realtime']).optional(),
  /** how dates and numbers are written for whoever reads (a BCP 47 tag, design/modular-split.md §5.3): the reader's, not the place's */
  locale: s.string(),
});
export type WorldDefinition = Infer<typeof WorldDefinitionSchema>;

/** what a binding resolves to: the modules providing the contract and the data they need */
export interface BoundSource {
  modules: ModuleDef[];
  data?: Record<string, unknown>;
}

/** everything a game can offer to world definitions */
export interface WorldRegistry {
  /** pack id → the pack: region, economy, practice and law packs (the last two speak for an area), and the starter packs (who arrives with what, and the modules that set them up) */
  packs: Record<string, Pack>;
  /** BCP 47 tag → how a locale writes dates (`@cc/locales`): those a definition can name */
  locales: Record<string, Locale>;
  /** dataset id → dataset (e.g. a weather series), referenced by bindings */
  datasets: Record<string, unknown>;
  /** modules every world of this game has (bound contracts excluded) */
  base: ModuleDef[];
  /** per contract: the default source and the sources it can be bound to (by kind or implementation id) */
  contracts: Record<string, { default: BoundSource; sources: Record<string, (binding: Binding, dataset: unknown, connection?: Connection) => BoundSource> }>;
}

/** a pack as a manifest takes it: by id, in its role; `catalogs`: only these of its catalogs (a world without the modules that read the rest) */
export interface PackUse {
  id: string;
  role: PackRole;
  catalogs?: string[];
}

/**
 * A world as a declared manifest (design/modular-split.md §6.1): everything the runtime is made of, in
 * one place, checked before anything runs (`checkManifest`).
 */
export interface WorldManifest {
  id: string;
  label: string;
  /** the modules of the packages the world runs, in order (the kernel orders them by what they require; ties keep this order); the packs' modules follow */
  modules: ModuleDef[];
  /** the implementation chosen per model contract (decision 0015): contract → implementation id, as its module declares it */
  implementations: Record<string, string>;
  /** the area the world lies in: the practice and law packs of it and of the areas above it apply (design/modular-split.md §5.3) */
  area: string;
  /**
   * the packs in their roles (decision 0010), merged by key: the world's own (region, economy) in this order, then the
   * area packs (practice, law) from the most general area to the most specific (`layPacks`), then the starters
   */
  packs: PackUse[];
  /** what the bindings bring, set after the packs (decision 0022): the datasets they deliver as truth (0023) and how each is bound */
  bound: Record<string, unknown>;
  /** catalogs set outright after everything else (a test's or a host's override of whole catalogs) */
  data?: Record<string, unknown>;
  /** the bindings, as the world definition says (shown, decision 0022); what they resolve to is in `modules`, `implementations` and `bound` */
  bindings: Binding[];
  connections: Connection[];
  clock: 'free' | 'realtime';
  /** how dates are written for whoever reads (a BCP 47 tag, one of the locales the world is composed with): the reader's, not the place's */
  locale: string;
  seed: number;
  epoch: CalendarDate;
  /** the party a single-seat host plays */
  actor?: EntityId;
}

export interface ResolvedWorld {
  config: RuntimeConfig;
  definition: WorldDefinition;
  manifest: WorldManifest;
  /** per contract: which source it is bound to (for display, decision 0022) */
  bound: Record<string, string>;
}

export class WorldDefinitionError extends Error {
  constructor(world: string, message: string) {
    super(`world '${world}': ${message}`);
    this.name = 'WorldDefinitionError';
  }
}

/** the implementation of a contract its modules declare (undefined: none, or known only at run time, as an external model's) */
const implementationOf = (contract: string, modules: ModuleDef[]): string | undefined => {
  for (const m of modules) if (Array.isArray(m.models)) for (const d of m.models) if (d.contract === contract) return d.implementation;
  return undefined;
};

/** a world definition as a manifest: the packs it names in their roles, each binding resolved to its modules and data (decisions 0021, 0022) */
export function manifestOf(input: unknown, registry: WorldRegistry, opts: { epoch?: CalendarDate; seed?: number } = {}): { manifest: WorldManifest; definition: WorldDefinition; bound: Record<string, string> } {
  const def = parseOrThrow(WorldDefinitionSchema, input, 'world definition');
  const fail = (message: string): never => {
    throw new WorldDefinitionError(def.id, message);
  };
  const packs: PackUse[] = def.packs.map((id) => {
    const pack = registry.packs[id] ?? fail(`unknown pack '${id}'`);
    if (pack.role === 'starter') fail(`'${id}' is a starter pack: a definition names it among its starters`);
    return { id, role: pack.role };
  });
  if (def.starters.length === 0) fail('no starter: somebody has to be there');
  for (const id of def.starters) {
    if (registry.packs[id]?.role !== 'starter') fail(`unknown starter pack '${id}'`);
    packs.push({ id, role: 'starter' });
  }
  const seen = new Set<string>();
  const modules: ModuleDef[] = [...registry.base];
  const implementations: Record<string, string> = {};
  const data: Record<string, unknown> = {};
  const bound: Record<string, string> = {};
  for (const b of def.bindings) {
    if (seen.has(b.contract)) fail(`contract '${b.contract}' is bound twice`);
    seen.add(b.contract);
    const contract = registry.contracts[b.contract] ?? fail(`unknown contract '${b.contract}'`);
    const key = b.source.implementation ?? b.source.kind;
    const make = contract.sources[key] ?? contract.sources[b.source.kind] ?? fail(`contract '${b.contract}' cannot be bound to '${key}'`);
    let dataset: unknown;
    const connection = b.source.connection ? ((def.connections ?? []).find((c) => c.id === b.source.connection) ?? fail(`unknown connection '${b.source.connection}'`)) : undefined;
    if (b.source.kind === 'measured' || b.source.kind === 'entered') {
      if (!b.source.dataset && !connection) fail(`binding of '${b.contract}' to ${b.source.kind} data needs a dataset or a connection`);
      if (b.source.dataset) dataset = registry.datasets[b.source.dataset] ?? fail(`unknown dataset '${b.source.dataset}'`);
      if (connection && connection.kind !== 'feed') fail(`binding of '${b.contract}' to ${b.source.kind} data needs a feed connection, '${connection.id}' is a ${connection.kind}`);
    }
    if (b.source.kind === 'external') {
      if (!connection || connection.kind !== 'model' || !connection.url) fail(`binding of '${b.contract}' to an external model needs a model connection with a url`);
    }
    if (b.source.kind !== 'model' && !b.gap) fail(`binding of '${b.contract}' to ${b.source.kind} data needs a gap policy (wait, fallback or fail)`);
    const src = make(b, dataset, connection);
    modules.push(...src.modules);
    Object.assign(data, src.data ?? {});
    implementations[b.contract] = implementationOf(b.contract, src.modules) ?? key;
    bound[b.contract] = b.source.dataset ? `${b.source.kind}: ${b.source.dataset}` : connection ? `${b.source.kind}: ${connection.label ?? connection.id}` : `${b.source.kind}: ${key}`;
  }
  for (const [name, contract] of Object.entries(registry.contracts)) {
    if (seen.has(name)) continue;
    modules.push(...contract.default.modules);
    Object.assign(data, contract.default.data ?? {});
    implementations[name] = implementationOf(name, contract.default.modules) ?? 'model';
    bound[name] = 'model (default)';
  }
  const manifest: WorldManifest = {
    id: def.id,
    label: def.label,
    modules,
    implementations,
    packs,
    bound: data,
    bindings: def.bindings,
    connections: def.connections ?? [],
    clock: def.clock ?? 'free',
    locale: def.locale,
    area: def.area,
    seed: opts.seed ?? def.seed,
    epoch: opts.epoch ?? def.epoch,
  };
  return { manifest, definition: def, bound };
}

/** the modules a manifest composes: its own, then those its packs bring (each once), then the areas port over the packs laid out (last, so it moves no other module's place in the order) */
const modulesOf = (m: WorldManifest, packs: Record<string, Pack>): ModuleDef[] => {
  const out = [...m.modules];
  for (const use of m.packs) for (const mod of packs[use.id]?.modules ?? []) if (!out.includes(mod)) out.push(mod);
  if (!out.includes(areasModule)) out.push(areasModule);
  return out;
};

const article = (role: PackRole): string => `${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role}`;

/** what a pack gives a manifest: its catalogs, or only those the manifest takes */
const catalogsOf = (use: PackUse, pack: Pack): Record<string, unknown> => (use.catalogs ? Object.fromEntries(use.catalogs.filter((c) => c in pack.catalogs).map((c) => [c, pack.catalogs[c]])) : pack.catalogs);

/** the packs laid on the world's areas, as the manifest takes them: all but the starters (what the players bring is nobody's area's; it is merged over them) */
const laidOf = (m: WorldManifest, packs: Record<string, Pack>): { id: string; pack: Pack }[] =>
  m.packs.filter((use) => use.role !== 'starter' && packs[use.id]).map((use) => ({ id: use.id, pack: use.catalogs ? { ...packs[use.id]!, catalogs: catalogsOf(use, packs[use.id]!) } : packs[use.id]! }));

/**
 * What is wrong with a manifest, in words (empty: nothing). Checked at composition, outside the kernel:
 *   - its locale is one of those given;
 *   - every pack it names exists, in the role it names, with the catalogs it takes; practice and law speak for an
 *     area the world reaches, the world's own packs for none;
 *   - every module is there once; every port it requires has a provider, and exactly one;
 *   - every contract a module implements has its implementation chosen, and every choice is implemented;
 *   - every data catalog given is declared by some module, and every catalog a module needs is given.
 */
export function checkManifest(m: WorldManifest, packs: Record<string, Pack>, locales: Record<string, Locale>): string[] {
  const problems: string[] = [];
  if (!Object.hasOwn(locales, m.locale)) problems.push(`unknown locale '${m.locale}' (known: ${Object.keys(locales).sort().join(', ') || 'none'})`);
  for (const use of m.packs) {
    const pack = packs[use.id];
    if (!pack) {
      problems.push(`unknown pack '${use.id}' (${use.role})`);
      continue;
    }
    if (pack.role !== use.role) problems.push(`pack '${use.id}' is ${article(pack.role)} pack, not ${article(use.role)} pack`);
    for (const c of use.catalogs ?? []) if (!(c in pack.catalogs)) problems.push(`pack '${use.id}' has no catalog '${c}'`);
    if (speaksForArea(pack.role) && pack.area === undefined) problems.push(`pack '${use.id}' is ${article(pack.role)} pack but speaks for no area`);
    if (!speaksForArea(pack.role) && pack.area !== undefined) problems.push(`pack '${use.id}' is ${article(pack.role)} pack, the world's own, but speaks for area '${pack.area}'`);
  }
  try {
    reachOf(laidOf(m, packs), m.area);
  } catch (e) {
    problems.push((e as Error).message);
  }
  const modules = modulesOf(m, packs);
  const ids = new Set<string>();
  const providers = new Map<string, string>();
  for (const mod of modules) {
    if (ids.has(mod.id)) problems.push(`module '${mod.id}' is listed twice`);
    ids.add(mod.id);
    for (const p of mod.provides ?? []) {
      if (providers.has(p)) problems.push(`port '${p}' is provided by both '${providers.get(p)}' and '${mod.id}'`);
      else providers.set(p, mod.id);
    }
  }
  for (const mod of modules) for (const r of mod.requires ?? []) if (!ids.has(r) && !providers.has(r)) problems.push(`module '${mod.id}' requires '${r}', which no module of the world provides`);
  const implemented = new Set<string>();
  for (const mod of modules) {
    if (!Array.isArray(mod.models)) continue;
    for (const d of mod.models) {
      implemented.add(d.contract);
      const chosen = m.implementations[d.contract];
      if (chosen === undefined) problems.push(`module '${mod.id}' implements contract '${d.contract}' ('${d.implementation}'), but the manifest chooses no implementation for it`);
      else if (chosen !== d.implementation) problems.push(`contract '${d.contract}': the manifest chooses '${chosen}', but module '${mod.id}' implements '${d.implementation}'`);
    }
  }
  // (a module whose models are known only at run time, an external model's, may implement any contract)
  const atRunTime = modules.some((mod) => typeof mod.models === 'function');
  for (const [contract, chosen] of Object.entries(m.implementations)) if (!implemented.has(contract) && !atRunTime) problems.push(`contract '${contract}': no module of the world implements '${chosen}'`);
  const declared = new Map<string, string>();
  for (const mod of modules) for (const name of Object.keys(mod.data ?? {})) if (!declared.has(name)) declared.set(name, mod.id);
  const given = new Map<string, string>();
  for (const use of m.packs) if (packs[use.id]) for (const name of Object.keys(catalogsOf(use, packs[use.id]!))) given.set(name, `pack '${use.id}'`);
  // (the packs laid out: the areas they declare, and their layers for the areas port)
  for (const name of ['areas', 'areaLayers']) given.set(name, 'the areas');
  for (const name of Object.keys(m.bound)) given.set(name, 'the bindings');
  for (const name of Object.keys(m.data ?? {})) given.set(name, 'the manifest');
  for (const [name, from] of given) if (!declared.has(name)) problems.push(`catalog '${name}' (from ${from}) is declared by no module of the world`);
  for (const mod of modules) {
    for (const [name, schema] of Object.entries(mod.data ?? {})) {
      if (given.has(name)) continue;
      const errors: string[] = [];
      schema.parse(undefined, name, errors);
      if (errors.length) problems.push(`catalog '${name}', which module '${mod.id}' needs, is given by no pack`);
    }
  }
  return problems;
}

export class ManifestError extends Error {
  constructor(
    world: string,
    readonly problems: string[],
  ) {
    super(`world '${world}': ${problems.join('; ')}`);
    this.name = 'ManifestError';
  }
}

/** a manifest as a runtime configuration, once it checks out (design/modular-split.md §6.1); its calendar writes dates in the manifest's locale */
export function composeWorld(m: WorldManifest, packs: Record<string, Pack>, locales: Record<string, Locale>, opts: { strict?: boolean; trusted?: boolean } = {}): RuntimeConfig {
  const problems = checkManifest(m, packs, locales);
  if (problems.length) throw new ManifestError(m.id, problems);
  const { data } = layPacks(laidOf(m, packs), m.area);
  for (const use of m.packs) if (use.role === 'starter') mergeCatalogs(data, catalogsOf(use, packs[use.id]!));
  Object.assign(data, m.bound, m.data ?? {});
  const config: RuntimeConfig = { modules: modulesOf(m, packs), data, seed: m.seed, epoch: m.epoch, locale: locales[m.locale]! };
  if (opts.strict !== undefined) config.strict = opts.strict;
  if (opts.trusted !== undefined) config.trusted = opts.trusted;
  if (m.actor !== undefined) config.actor = m.actor;
  return config;
}

/** a world definition as a runnable world: its manifest, composed (decision 0021) */
export function resolveWorld(input: unknown, registry: WorldRegistry, opts: { strict?: boolean; trusted?: boolean; epoch?: CalendarDate; seed?: number; data?: Record<string, unknown> } = {}): ResolvedWorld {
  const { manifest, definition, bound } = manifestOf(input, registry, { ...(opts.epoch ? { epoch: opts.epoch } : {}), ...(opts.seed !== undefined ? { seed: opts.seed } : {}) });
  if (opts.data) manifest.data = opts.data;
  const config = composeWorld(manifest, registry.packs, registry.locales, { ...(opts.strict !== undefined ? { strict: opts.strict } : {}), ...(opts.trusted !== undefined ? { trusted: opts.trusted } : {}) });
  return { config, definition, manifest, bound };
}
