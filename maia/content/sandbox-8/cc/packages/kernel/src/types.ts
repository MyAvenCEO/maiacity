/**
 * Kernel contracts.
 *
 * Domain packages extend the registries below through TypeScript declaration merging:
 *
 *   declare module '@cc/kernel' {
 *     interface ComponentTypes { Machine: Machine }
 *     interface EventTypes { 'equipment.brokeDown': { machine: EntityId } }
 *     interface PortTypes { weather: WeatherPort }
 *   }
 *
 * so every `ctx.get('Machine', id)`, `ctx.emit(...)`, `ctx.port('weather')` is fully typed
 * without the kernel knowing any domain.
 */
import type { Explained } from './explain.ts';
import type { Rng } from './rng.ts';
import type { Schema, Source } from './schema.ts';
import type { Calendar, SimTime } from './time.ts';

export type EntityId = string;

/* eslint-disable @typescript-eslint/no-empty-interface */
/** Component name → data type. */
export interface ComponentTypes {}
/** Event type → payload. */
export interface EventTypes {
  'entity.destroyed': { id: EntityId; kind: string };
  /** an entity ended (decision 0028): what was spawned for it has ended with it */
  'entity.ended': { id: EntityId; kind: string; why: string };
}
/** Command type → { payload; result }. */
export interface CommandTypes {}
/** Port (interface) name → implementation type. */
export interface PortTypes {}
/**
 * Extension point name → contribution type. Unlike ports (exactly one provider), any number
 * of modules may contribute to an extension point (e.g. several traffic sources, many heat
 * consumers, every asset class reporting condition). Contributions are read-only views.
 */
export interface ContributionTypes {}
/** Data catalog name → normalized data type. */
export interface DataTypes {}
/** Module id → module singleton state type. */
export interface ModuleStateTypes {}
/** Timer name (module-scoped, written `module/timer`) → payload. Optional typing aid. */
export interface TimerTypes {}

export type ComponentName = keyof ComponentTypes & string;
export type EventName = keyof EventTypes & string;
export type CommandName = keyof CommandTypes & string;
export type PortName = keyof PortTypes & string;
export type DataName = keyof DataTypes & string;
export type ContributionName = keyof ContributionTypes & string;
export type StatefulModule = keyof ModuleStateTypes & string;

type CommandPayload<K extends CommandName> = CommandTypes[K] extends { payload: infer P } ? P : never;
type CommandResultValue<K extends CommandName> = CommandTypes[K] extends { result: infer R } ? R : void;

export interface EntityMeta {
  id: EntityId;
  kind: string;
  name?: string;
  createdBy: string;
  createdAt: SimTime;
  /**
   * what it exists for (decision 0028): it ends with any of them (an advert with its party; an offer with its subject,
   * its maker or the one it is made to)
   */
  for?: readonly EntityId[];
  /** it has ended (a party with nobody left, a project called off): when and why; it stays, as a record */
  ended?: { at: SimTime; why: string };
}

/** Structured, legible reason why something cannot proceed. */
export interface Blocker {
  code: string;
  severity: 'info' | 'warn' | 'block';
  params?: Record<string, string | number>;
  /** Suggested remedies the UI can offer as buttons. */
  remedies?: Remedy[];
  since?: SimTime;
  /** Entity the blocker is about (filled in by the kernel). */
  subject?: EntityId;
  /** Module that raised it (filled in by the kernel). */
  module?: string;
}

export interface Remedy {
  label: string;
  command?: { type: string; payload: unknown };
  /** a remedy that is only waiting: the blocker passes by itself (at `until`, when known) */
  wait?: { until?: number };
}

export type CommandResult<R = unknown> = { ok: true; value: R } | { ok: false; reasons: Blocker[] };

export interface ProcessView {
  id: string;
  module: string;
  kind: string;
  subject?: EntityId;
  label?: string;
  unit: string;
  total: number;
  /** progress integrated up to `now` */
  done: number;
  /** current rate in unit per hour */
  rate: number;
  status: 'active' | 'paused' | 'complete' | 'cancelled';
  startedAt: SimTime;
  updatedAt: SimTime;
  completedAt?: SimTime;
  /** predicted completion at current rate (Infinity when rate = 0) */
  eta: SimTime;
  rateExplain?: Explained;
  data?: unknown;
}

export interface LedgerAccount {
  id: string;
  label: string;
  kind: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  unit: string;
  balance: number;
  /** the party whose books the account is in (decision 0025) */
  holder?: EntityId;
}

export interface LedgerEntry {
  t: SimTime;
  from: string;
  to: string;
  amount: number;
  unit: string;
  memo: string;
  module: string;
  category?: string;
  refs?: EntityId[];
}

export interface LogEntry {
  /** its place in the log: each line said (a line folded too) comes after all said before it */
  seq: number;
  t: SimTime;
  level: 'info' | 'warn' | 'error' | 'success';
  module: string;
  message: string;
  refs?: EntityId[];
  /** said again within a day: how often, since when, and the line as said (the message then counts them) */
  times?: number;
  since?: SimTime;
  said?: string;
}

/** Read-only view of the world. Ports and projections receive this. */
export interface ReadCtx {
  readonly now: SimTime;
  readonly calendar: Calendar;
  readonly seed: number;
  get<K extends ComponentName>(component: K, id: EntityId): Readonly<ComponentTypes[K]> | undefined;
  require<K extends ComponentName>(component: K, id: EntityId): Readonly<ComponentTypes[K]>;
  has(component: ComponentName, id: EntityId): boolean;
  /** All entities carrying `component`, in deterministic (creation) order. */
  all<K extends ComponentName>(component: K): IterableIterator<[EntityId, Readonly<ComponentTypes[K]>]>;
  count(component: ComponentName): number;
  entity(id: EntityId): Readonly<EntityMeta> | undefined;
  /** whether the entity has ended (decision 0028), and when and why */
  ended(id: EntityId): { at: SimTime; why: string } | undefined;
  entities(kind?: string): Readonly<EntityMeta>[];
  state<M extends StatefulModule>(module: M): Readonly<ModuleStateTypes[M]>;
  port<K extends PortName>(name: K): PortTypes[K];
  hasPort(name: string): boolean;
  /**
   * All contributions to an extension point, in module order, tagged with the contributing module.
   * A contribution is created once per world and kept: read state inside its methods, never capture
   * it when the contribution is made.
   */
  contributions<K extends ContributionName>(name: K): { module: string; impl: ContributionTypes[K] }[];
  data<K extends DataName>(name: K): DataTypes[K];
  hasData(name: string): boolean;
  process(id: string): ProcessView | undefined;
  listProcesses(filter?: { module?: string; subject?: EntityId; kind?: string; status?: ProcessView['status'] }): ProcessView[];
  balance(account: string): number;
  account(id: string): Readonly<LedgerAccount> | undefined;
  /** every ledger account (of one holder's books), in the order they were opened */
  accounts(holder?: EntityId): Readonly<LedgerAccount>[];
  blockersOf(id: EntityId): Blocker[];
  /** every subject that has blockers now, in id order (for alerts that cover the whole world) */
  blocked(): EntityId[];
  /**
   * Revision counter of a component store (or the whole world) — for memoizing derived caches. `'members'`: of which
   * entities have the component (it changes only when one gains or loses it), for an index of what does not change
   * once written
   */
  revision(component?: ComponentName, of?: 'members'): number;
  formatBlocker(blocker: Blocker): string;
  /** the model implementations behind the contracts of this world (decision 0015) */
  models(): ModelDescriptor[];
  /** contracts currently used outside an implementation's validity (decision 0015) */
  validity(): ValidityNote[];
}

// ------------------------------------------------------------------ model contracts (decisions 0015, 0022)

/** Where a value comes from. Carried by every value a bound contract delivers (decision 0022). */
export interface Provenance {
  kind: 'model' | 'external' | 'measured' | 'entered';
  /** implementation id, station or dataset id */
  source: string;
  confidence: 'high' | 'medium' | 'low';
  /** e.g. 'hourly values disaggregated from daily measurements', 'fallback: no measurement' */
  note?: string;
}

/** Where an implementation's results can be trusted: named ranges over its inputs. */
export interface Validity {
  ranges?: Record<string, [number, number] | string[]>;
  notes?: string;
}

/** An implementation of a model contract (a port), declared by the module that provides it. */
export interface ModelDescriptor {
  contract: string;
  implementation: string;
  kind: Provenance['kind'];
  label: string;
  validity: Validity;
  /** e.g. 'daily, disaggregated to hours' */
  resolution: string;
  confidence: Provenance['confidence'];
  sources: Source[];
}

/** A contract used outside its implementation's validity — shown to players and agents as an estimate. */
export interface ValidityNote {
  contract: string;
  module: string;
  reason: string;
  since: SimTime;
  count: number;
}

/** A data source has no data beyond `until`: the world waits there, legibly (gap policy 'wait', decision 0022). */
export interface DataHorizon {
  until: SimTime;
  reason: string;
}

export interface ProcessStart {
  kind: string;
  subject?: EntityId;
  label?: string;
  unit: string;
  total: number;
  rate?: number;
  rateExplain?: Explained;
  /** module timer called on completion with { process: id, ...payload } */
  onComplete?: string;
  payload?: Record<string, unknown>;
  paused?: boolean;
  data?: unknown;
}

export interface WriteCtx extends ReadCtx {
  /** id of the module this context acts for */
  readonly module: string;
  /** record that `contract` is being used outside this module's declared validity (shown as an estimate) */
  outsideValidity(contract: string, reason: string): void;
  /** who issued the command currently executing: 'client' (player/agent), 'input' (world definition: feeds, bridge), or a module id */
  readonly caller: string;
  /** the party acting the command currently executing (nested commands act for it too); null outside commands or when none was given */
  readonly actor: EntityId | null;
  /** runtime is a trusted harness (tests/tooling) */
  readonly trusted: boolean;
  /** the world is being made (module setup hooks): what it starts with is defined now */
  readonly setup: boolean;
  /**
   * a new entity; `for`: what it exists for (one or several, all of them existing and not ended), ending with any of
   * them (decision 0028: the module declares how, `ended[kind]`)
   */
  spawn(kind: string, opts?: { name?: string; id?: string; for?: EntityId | readonly EntityId[] }): EntityId;
  destroy(id: EntityId): void;
  /**
   * The entity ends (decision 0028): what was spawned for it ends with it, each by its module's `ended` handler, which
   * ends it, destroys it or gives it to something else (`adopt`); one left for an ended owner is an orphan, a defect
   */
  end(id: EntityId, why: string): void;
  /** what an entity exists for, changed (null: for nothing, its own; an owner that ended is refused) */
  adopt(id: EntityId, owner: EntityId | null): void;
  rename(id: EntityId, name: string): void;
  set<K extends ComponentName>(component: K, id: EntityId, value: ComponentTypes[K]): void;
  patch<K extends ComponentName>(component: K, id: EntityId, partial: Partial<ComponentTypes[K]>): void;
  remove(component: ComponentName, id: EntityId): void;
  setState<M extends StatefulModule>(module: M, value: ModuleStateTypes[M]): void;
  patchState<M extends StatefulModule>(module: M, partial: Partial<ModuleStateTypes[M]>): void;
  emit<K extends EventName>(type: K, payload: EventTypes[K]): void;
  /** Schedule one of this module's timers at absolute time. Returns timer id. */
  at(time: SimTime, timer: string, payload?: unknown): number;
  after(delay: number, timer: string, payload?: unknown): number;
  cancel(timerId: number | undefined): void;
  rng(stream: string): Rng;
  command<K extends CommandName>(type: K, payload: CommandPayload<K>): CommandResult<CommandResultValue<K>>;
  /** Abort the current command with structured reasons (rolls back its writes). */
  reject(code: string, params?: Record<string, string | number>, remedies?: Remedy[]): never;
  readonly proc: ProcessApi;
  readonly ledger: LedgerApi;
  readonly blockers: BlockerApi;
  log(level: LogEntry['level'], message: string, refs?: EntityId[]): void;
}

export interface ProcessApi {
  start(spec: ProcessStart): string;
  setRate(id: string, rate: number, rateExplain?: Explained): void;
  /** Add (or subtract) progress directly, e.g. discrete work. */
  advance(id: string, amount: number): void;
  setTotal(id: string, total: number): void;
  pause(id: string): void;
  resume(id: string, rate?: number): void;
  cancel(id: string): void;
  patchData(id: string, data: unknown): void;
}

export interface LedgerApi {
  open(id: string, opts: { label: string; kind: LedgerAccount['kind']; unit?: string; holder?: EntityId }): void;
  post(entry: { from: string; to: string; amount: number; memo: string; category?: string; refs?: EntityId[] }): void;
}

export interface BlockerApi {
  /** Replace this module's blockers on `subject`. Keeps `since` for codes that persist. */
  set(subject: EntityId, blockers: Omit<Blocker, 'subject' | 'module'>[]): void;
  clear(subject: EntityId): void;
}

export type Phase = 'environment' | 'physical' | 'biological' | 'agents' | 'operations' | 'economy' | 'accounting' | 'report';

export const PHASE_RANK: Record<Phase, number> = {
  environment: 10,
  physical: 20,
  biological: 30,
  agents: 40,
  operations: 50,
  economy: 60,
  accounting: 70,
  report: 80,
};

export interface SystemDef {
  id: string;
  /** period in seconds */
  every: number;
  /** offset in seconds from multiples of `every` (e.g. 6*HOUR with every=DAY → 06:00 daily) */
  offset?: number;
  phase: Phase;
  run(ctx: WriteCtx, dt: number): void;
}

export interface CommandDef<P = unknown, R = unknown> {
  payload: Schema<P>;
  label?: string;
  /** what the command does, its preconditions and costs — shown to players and AI agents */
  description?: string;
  /** internal commands are for other modules only (not offered to players/agents) */
  internal?: boolean;
  /** a recorded input from outside (a data feed, an external model): the host may dispatch it with dispatchInput (decision 0024) */
  input?: boolean;
  handle(ctx: WriteCtx, payload: P): R;
}

export type EventHandlers = { [K in EventName]?: (ctx: WriteCtx, payload: EventTypes[K]) => void };
export type PortFactories = { [K in PortName]?: (ctx: ReadCtx) => PortTypes[K] };
export type ContributionFactories = { [K in ContributionName]?: (ctx: ReadCtx) => ContributionTypes[K] };

export interface ProjectionDef {
  label?: string;
  description?: string;
  compute(ctx: ReadCtx, args: Record<string, unknown>): unknown;
}

export interface ModuleDef {
  id: string;
  label?: string;
  description?: string;
  /** Ports (interfaces) this module implements. */
  provides?: PortName[];
  /** Ports or module ids this module needs; they are ordered before it. */
  requires?: string[];
  /** Ports used if present. */
  optional?: string[];
  /** Components this module owns (sole writer). */
  components?: Record<string, Schema<unknown>>;
  /**
   * Other modules' components this module still reads raw, not through their owner's port (design/modular-split.md
   * P2): a recorded deviation that only shrinks. An undeclared read is refused in audited runtimes (tests), as an
   * unowned write is everywhere; `Runtime.foreignReads()` reports what is read.
   */
  reads?: string[];
  /**
   * What a party may observe of each component (decision 0023, design/physical-state.md I7): 'hidden' (the
   * world's truth, known only by an observation of its own: a road's condition, by survey), or a function
   * giving what a viewer sees of the value (undefined: nothing; another party's store shows where it is, not
   * what is in it). Absent: what anyone standing there sees.
   */
  observe?: Record<string, 'hidden' | ((value: any, viewer: EntityId, read: ReadCtx, id: EntityId) => unknown)>;
  state?: { schema?: Schema<unknown>; initial: () => unknown };
  /** Data catalogs this module owns/validates. */
  data?: Record<string, Schema<unknown>>;
  commands?: Record<string, CommandDef<any, any>>;
  /** player/agent documentation and visibility of commands (alternative to fields on CommandDef) */
  commandDocs?: Record<string, { description?: string; internal?: boolean }>;
  /** Events this module may emit (with payload schemas — used for docs and strict validation). */
  events?: Record<string, Schema<unknown>>;
  on?: EventHandlers;
  timers?: Record<string, (ctx: WriteCtx, payload: any) => void>;
  /**
   * What happens to an entity of this kind the module spawned `for` an owner, when the owner ends or is destroyed
   * (decision 0028): it must end it, destroy it, or adopt it to something else. Required for every kind spawned `for`.
   */
  ended?: Record<string, (ctx: WriteCtx, id: EntityId, cause: { owner: EntityId; why: string }) => void>;
  systems?: SystemDef[];
  ports?: PortFactories;
  contributes?: ContributionFactories;
  projections?: Record<string, ProjectionDef>;
  /** Blocker code → message template with {param} placeholders. */
  blockers?: Record<string, string>;
  /** Runs once when a new world is created (not on restore). */
  setup?(ctx: WriteCtx): void;
  /**
   * The module's physical invariants (design/physical-state.md: matter balances, one place per unit): what is
   * violated, in words; empty when all hold. Run after every command and advance in audited runtimes.
   */
  audit?(read: ReadCtx): string[];
  /** model implementations this module provides (decision 0015); a function when they become known at run time (external models) */
  models?: ModelDescriptor[] | ((read: ReadCtx) => ModelDescriptor[]);
  /** a data source's horizon: the world cannot advance past it until more data arrives (decision 0022) */
  horizon?(read: ReadCtx): DataHorizon | null;
  /**
   * The runtime became a hypothetical branch (Runtime.branch, e.g. a what-if fork): re-draw any
   * exogenous future this module derives from the seed rather than from RNG streams.
   */
  branch?(ctx: WriteCtx, salt: number): void;
}

export function defineModule<const M extends ModuleDef>(def: M): M {
  return def;
}

/** Helper to infer a command handler's payload type from its schema. */
export function command<P, R>(payload: Schema<P>, handle: (ctx: WriteCtx, payload: P) => R, label?: string | { label?: string; description?: string; internal?: boolean; input?: boolean }): CommandDef<P, R> {
  if (typeof label === 'string') return { payload, handle, label };
  return { payload, handle, ...(label ?? {}) };
}
