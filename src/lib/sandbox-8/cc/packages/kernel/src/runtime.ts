/**
 * The simulation runtime: the narrow waist every model and client passes through.
 *
 * Guarantees:
 *  - Determinism: same modules + data + seed + command log ⇒ bit-identical state.
 *    Ordering is (time, phase rank, module order, sequence); randomness comes from
 *    named streams; no host clock.
 *  - Single writer: each component / module state has exactly one owning module.
 *    Other modules read it, or ask the owner via commands/events.
 *  - Atomic commands: a rejected or throwing command rolls back all its writes.
 *  - Event-driven time: models schedule timers and rate processes; recurring systems
 *    are just self-rescheduling timers. Progress of rate processes is integrated
 *    lazily, so completion times are exact regardless of step size.
 *  - Snapshot/restore and replay from plain JSON.
 */
import { explainToText } from './explain.ts';
import { Heap, type Keyed } from './queue.ts';
import { leftOf } from './quantity.ts';
import { hash32, Rng, seedState, type RngState } from './rng.ts';
import { parseOrThrow, s, schemaPrint, toJsonSchema, ValidationError, type Schema } from './schema.ts';
import { Calendar, DAY, type CalendarDate, type Locale, type SimTime } from './time.ts';
import {
  PHASE_RANK,
  type Blocker,
  type CommandResult,
  type EntityId,
  type EntityMeta,
  type LedgerAccount,
  type LedgerEntry,
  type LogEntry,
  type ModuleDef,
  type ProcessStart,
  type ProcessView,
  type ReadCtx,
  type Remedy,
  type SystemDef,
  type ValidityNote,
  type WriteCtx,
} from './types.ts';

/** command-log entry type of Runtime.branch */
export const BRANCH_COMMAND = 'kernel.branch';

export interface RuntimeConfig {
  modules: ModuleDef[];
  /** Raw data-pack catalogs keyed by catalog name; validated against module data schemas. */
  data?: Record<string, unknown>;
  seed: number;
  epoch: CalendarDate;
  /** how dates are written in the log and in what the modules say (the world definition's locale); none: the neutral ISO 8601 */
  locale?: Locale;
  /** Freeze stored values and validate component writes against schemas (tests). */
  strict?: boolean;
  /** Test harnesses and tooling may issue internal commands directly; games never set this. */
  trusted?: boolean;
  /**
   * Run every module's `audit` (its physical invariants: matter balances, design/physical-state.md) after each
   * command and each advance, throwing on a violation. Default: in strict and trusted runtimes (tests).
   */
  audit?: boolean;
  logLimit?: number;
  /**
   * The party a single-seat host's commands are acted by when a dispatch names none (the CLI, a
   * single-player browser, a test). A host with several seats names the actor on every dispatch.
   */
  actor?: EntityId;
}

/** a snapshot this runtime cannot continue: made by another version of the game (decision 0019: no conversion) */
export class SnapshotMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotMismatch';
  }
}

export class OwnershipError extends Error {}
export class CommandRejection extends Error {
  constructor(public readonly reasons: Blocker[]) {
    super(`command rejected: ${reasons.map((r) => r.code).join(', ')}`);
  }
}

interface TimerRec extends Keyed {
  id: number;
  module: string;
  timer: string;
  payload: unknown;
  system?: string;
  dead?: boolean;
}

interface ProcRec {
  id: string;
  module: string;
  kind: string;
  subject?: EntityId;
  label?: string;
  unit: string;
  total: number;
  done: number;
  rate: number;
  status: ProcessView['status'];
  startedAt: SimTime;
  updatedAt: SimTime;
  completedAt?: SimTime;
  timerId?: number;
  onComplete?: string;
  payload?: Record<string, unknown>;
  rateExplain?: ProcessView['rateExplain'];
  data?: unknown;
}

export interface Snapshot {
  format: 'cc-sim-snapshot';
  version: 2;
  modules: string[];
  /** a hash of the print of every module's component, state and data schemas (decision 0019: other shapes are not read) */
  schemas: string;
  seed: number;
  epochDay: number;
  now: SimTime;
  processedUntil: SimTime;
  seq: number;
  timerCounter: number;
  procCounter: number;
  idCounters: Record<string, number>;
  entities: EntityMeta[];
  components: Record<string, [EntityId, unknown][]>;
  states: Record<string, unknown>;
  timers: Omit<TimerRec, 'dead'>[];
  processes: ProcRec[];
  accounts: LedgerAccount[];
  entries: LedgerEntry[];
  blockers: [EntityId, string, Blocker[]][];
  rng: Record<string, RngState>;
  /** salts of hypothetical branches (Runtime.branch), in order; absent = the original world */
  branches?: number[];
  /** contracts used outside their implementation's validity */
  validity?: ValidityNote[];
  log: LogEntry[];
  commandLog: CommandLogEntry[];
}

export interface CommandLogEntry {
  t: SimTime;
  /** timers up to this time had been processed when the command was issued (−1: none yet) */
  processed: SimTime;
  type: string;
  payload: unknown;
  /** a recorded input from the world definition (bridge, live feed), not a player command (decision 0016) */
  input?: true;
  /** the party the command was acted by (decision 0025) */
  actor?: EntityId;
}

export interface AdvanceResult {
  from: SimTime;
  to: SimTime;
  timersFired: number;
  eventsDelivered: number;
  /** the world stopped short of `until` because a data source has no data beyond `to` (decision 0022) */
  waiting?: DataWait;
}

/** A data source the world is waiting for. */
export interface DataWait {
  module: string;
  until: SimTime;
  reason: string;
}

const KERNEL = 'kernel';
const KERNEL_MODULE: ModuleDef = {
  id: KERNEL,
  label: 'Kernel',
  events: { 'entity.destroyed': s.object({ id: s.string(), kind: s.string() }), 'entity.ended': s.object({ id: s.string(), kind: s.string(), why: s.string() }) },
  blockers: {
    'kernel.invalidPayload': 'Invalid command payload: {issues}',
    'kernel.unknownCommand': 'Unknown command {type}',
    'kernel.internalCommand': '{type} is internal to the simulation and cannot be issued by players or agents',
    'kernel.notAnInput': '{type} is not a recorded input from outside (only commands made for data feeds and external models are)',
    'kernel.wrongEntity': '{id} is not a {kind}{is}',
  },
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export class Runtime {
  readonly calendar: Calendar;
  readonly seed: number;
  readonly strict: boolean;
  readonly trusted: boolean;
  private readonly auditing: boolean;
  /** remedies offered are checked against the commands they name (tests: strict and trusted runtimes) */
  private readonly checkingRemedies: boolean;
  /** true while the world is being made (module setup hooks): what a world starts with is defined then */
  private inSetup = false;
  readonly modules: ModuleDef[];
  private readonly moduleIndex = new Map<string, number>();
  private readonly componentOwner = new Map<string, string>();
  private readonly componentSchema = new Map<string, Schema<unknown>>();
  private readonly eventOwner = new Map<string, string>();
  private readonly commandOwner = new Map<string, string>();
  private readonly portProvider = new Map<string, string>();
  private readonly projectionOwner = new Map<string, string>();
  private readonly blockerTemplates = new Map<string, string>();
  private readonly dataValues = new Map<string, unknown>();
  private readonly portCache = new Map<string, unknown>();
  private readonly contributionCache = new Map<string, { module: string; impl: unknown }[]>();
  private readonly ctxCache = new Map<string, WriteCtx>();
  private readonly readCache = new Map<string, ReadCtx>();
  /** `${module}|${component}` → reads of another module's component (design/modular-split.md P2) */
  private readonly foreign = new Map<string, number>();
  private readonly subscribers = new Map<string, string[]>();
  private readonly logLimit: number;

  // ---- authoritative state (snapshotted) ----
  now: SimTime = 0;
  /** all timers with time ≤ processedUntil have fired (−1 = none yet) */
  private processedUntil: SimTime = -1;
  private seq = 0;
  private timerCounter = 0;
  private procCounter = 0;
  private idCounters: Record<string, number> = {};
  private entityMeta = new Map<EntityId, EntityMeta>();
  /** owner → what was spawned for it (decision 0028), kept with the metas */
  private dependents = new Map<EntityId, Set<EntityId>>();
  private stores = new Map<string, Map<EntityId, unknown>>();
  private states = new Map<string, unknown>();
  private heap = new Heap<TimerRec>();
  private timerIndex = new Map<number, TimerRec>();
  private procs = new Map<string, ProcRec>();
  private accounts = new Map<string, LedgerAccount>();
  private entries: LedgerEntry[] = [];
  private blockerMap = new Map<EntityId, Map<string, Blocker[]>>();
  private rngs = new Map<string, Rng>();
  private validityNotes = new Map<string, ValidityNote>();
  private branches: number[] = [];
  private logEntries: LogEntry[] = [];
  commandLog: CommandLogEntry[] = [];

  // ---- transient ----
  private undo: (() => void)[] | null = null;
  private pendingEvents: { type: string; payload: unknown }[] = [];
  private revisions = new Map<string, number>();
  /** component → a revision of which entities have it (bumped when one gains or loses it, and when that is undone) */
  private memberRevisions = new Map<string, number>();
  private globalRevision = 0;
  private eventListeners: ((type: string, payload: unknown, t: SimTime) => void)[] = [];
  private draining = false;
  private callers: string[] = [];
  /** the party commands are acted by when a dispatch names none (RuntimeConfig.actor) */
  private readonly defaultActor: EntityId | null;
  /** the acting party of each command on the stack (null: none, e.g. a timer or a recorded input) */
  private actors: (EntityId | null)[] = [];
  private kernelEmit = false;
  readonly read: ReadCtx;

  private constructor(config: RuntimeConfig) {
    this.seed = config.seed >>> 0;
    this.strict = Boolean(config.strict);
    this.trusted = Boolean(config.trusted);
    this.auditing = config.audit ?? (Boolean(config.strict) || Boolean(config.trusted));
    this.checkingRemedies = Boolean(config.strict) || Boolean(config.trusted);
    this.logLimit = config.logLimit ?? 2000;
    this.defaultActor = config.actor ?? null;
    this.calendar = Calendar.fromDate(config.epoch, config.locale);
    this.modules = Runtime.orderModules([KERNEL_MODULE, ...config.modules]);
    this.modules.forEach((m, i) => this.moduleIndex.set(m.id, i));
    this.register(config.data ?? {});
    this.read = this.makeReadCtx();
  }

  /** Create a fresh world: initial module states, data validation, `setup` hooks, systems. */
  static create(config: RuntimeConfig): Runtime {
    const rt = new Runtime(config);
    for (const m of rt.modules) {
      if (m.state) rt.states.set(m.id, rt.freeze(m.state.initial()));
    }
    for (const m of rt.modules) {
      for (const sys of m.systems ?? []) rt.scheduleSystem(m.id, sys, 0, true);
    }
    rt.inSetup = true;
    try {
      for (const m of rt.modules) {
        if (m.setup) {
          rt.runTx(() => m.setup!(rt.ctx(m.id)));
          rt.drainEvents();
        }
      }
    } finally {
      rt.inSetup = false;
    }
    rt.audit('setup');
    return rt;
  }

  /** Recreate a runtime from a snapshot. Modules must match (same ids, same order of registration). */
  static restore(config: RuntimeConfig, snap: Snapshot): Runtime {
    if (snap.format !== 'cc-sim-snapshot' || snap.version !== 2) throw new SnapshotMismatch('the saved world was made by an earlier version of the game (its save format is older)');
    const rt = new Runtime({ ...config, seed: snap.seed });
    const ids = rt.modules.map((m) => m.id);
    if (ids.join('|') !== snap.modules.join('|')) {
      const missing = ids.filter((m) => !snap.modules.includes(m));
      const gone = snap.modules.filter((m) => !ids.includes(m));
      throw new SnapshotMismatch(`the saved world was made by another version of the game (${[...(missing.length ? [`it lacks ${missing.join(', ')}`] : []), ...(gone.length ? [`it has ${gone.join(', ')}, which this version does not`] : [])].join('; ') || 'its parts are in another order'})`);
    }
    if (rt.calendar.epochDay !== snap.epochDay) throw new SnapshotMismatch('the saved world starts on another day than its world definition');
    // the same parts, but the shapes of what they keep have changed: what it saved would be read wrongly
    if (snap.schemas !== rt.schemaHash()) throw new SnapshotMismatch('the saved world was made by another version of the game (the shape of what it keeps has changed since)');
    rt.now = snap.now;
    rt.processedUntil = snap.processedUntil;
    rt.seq = snap.seq;
    rt.timerCounter = snap.timerCounter;
    rt.procCounter = snap.procCounter;
    rt.idCounters = { ...snap.idCounters };
    for (const e of snap.entities) {
      rt.entityMeta.set(e.id, rt.freeze({ ...e }));
      for (const o of e.for ?? []) rt.linkDependent(o, e.id);
    }
    for (const [name, rows] of Object.entries(snap.components)) {
      if (!rt.componentOwner.has(name)) throw new Error(`Snapshot has unknown component ${name}`);
      const store = rt.store(name);
      for (const [id, value] of rows) store.set(id, rt.freeze(value));
    }
    for (const [mod, value] of Object.entries(snap.states)) rt.states.set(mod, rt.freeze(value));
    for (const t of snap.timers) {
      const rec: TimerRec = { ...t };
      rt.heap.push(rec);
      rt.timerIndex.set(rec.id, rec);
    }
    for (const p of snap.processes) rt.procs.set(p.id, { ...p });
    for (const a of snap.accounts) rt.accounts.set(a.id, { ...a });
    rt.entries = snap.entries.map((e) => ({ ...e }));
    for (const [id, mod, list] of snap.blockers) {
      if (!rt.blockerMap.has(id)) rt.blockerMap.set(id, new Map());
      rt.blockerMap.get(id)!.set(mod, list.map((b) => ({ ...b })));
    }
    for (const [key, state] of Object.entries(snap.rng)) rt.rngs.set(key, new Rng([...state] as RngState));
    rt.branches = [...(snap.branches ?? [])];
    for (const n of snap.validity ?? []) rt.validityNotes.set(`${n.contract}|${n.module}`, rt.freeze({ ...n }));
    rt.logEntries = snap.log.map((l) => ({ ...l }));
    rt.commandLog = snap.commandLog.map((c) => ({ ...c }));
    return rt;
  }

  /**
   * Turn this runtime into a hypothetical branch of the world (a what-if fork): everything that is
   * still random from now on is re-drawn. Every RNG stream (existing and future ones) is re-seeded
   * with the salt, and modules with exogenous futures (weather, markets …) resample theirs in their
   * `branch` hook. The past is unchanged. Without this, a fork restored from a snapshot would replay
   * the real world's future exactly — letting a player look ahead. Recorded in the command log.
   */
  branch(salt: number): void {
    const s = salt >>> 0;
    this.branches.push(s);
    for (const [key, r] of this.rngs) r.state = seedState((r.state[0] ^ r.state[2] ^ s) >>> 0, key);
    for (const m of this.modules) if (m.branch) this.runTx(() => m.branch!(this.ctx(m.id), s));
    this.commandLog.push({
      t: this.now,
      processed: this.processedUntil,
      type: BRANCH_COMMAND,
      payload: { salt: s },
    });
    this.drainEvents();
  }

  /** seed for new RNG streams: the world seed, mixed with every branch salt */
  private streamSeed(): number {
    let seed = this.seed >>> 0;
    for (const s of this.branches) seed = (Math.imul(seed ^ s, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
    return seed;
  }

  /** Deterministically re-run a command log from a fresh world. */
  static replay(config: RuntimeConfig, log: CommandLogEntry[], until?: SimTime): Runtime {
    const rt = Runtime.create(config);
    for (const entry of log) {
      if (entry.processed > rt.processedUntil || entry.t > rt.now) rt.advance(Math.max(entry.t, entry.processed));
      if (entry.type === BRANCH_COMMAND) rt.branch((entry.payload as { salt: number }).salt);
      else if (entry.input) rt.dispatchInput(entry.type, entry.payload);
      else rt.dispatch(entry.type as never, entry.payload as never, entry.actor !== undefined ? { actor: entry.actor } : undefined);
    }
    if (until !== undefined && until > rt.now) rt.advance(until);
    return rt;
  }

  // ------------------------------------------------------------------ registration

  private static orderModules(defs: ModuleDef[]): ModuleDef[] {
    const byId = new Map<string, ModuleDef>();
    for (const d of defs) {
      if (byId.has(d.id)) throw new Error(`Duplicate module id ${d.id}`);
      byId.set(d.id, d);
    }
    const providers = new Map<string, string>();
    for (const d of defs) {
      for (const p of d.provides ?? []) {
        if (providers.has(p)) throw new Error(`Port ${p} provided by both ${providers.get(p)} and ${d.id}`);
        if (byId.has(p) && p !== d.id) throw new Error(`Port name ${p} collides with the id of another module`);
        providers.set(p, d.id);
      }
    }
    const deps = new Map<string, string[]>();
    for (const d of defs) {
      const list: string[] = [];
      for (const r of d.requires ?? []) {
        const target = byId.has(r) ? r : providers.get(r);
        if (!target) throw new Error(`Module ${d.id} requires "${r}", which no module provides`);
        if (target !== d.id) list.push(target);
      }
      for (const r of d.optional ?? []) {
        const target = byId.has(r) ? r : providers.get(r);
        if (target && target !== d.id) list.push(target);
      }
      deps.set(d.id, list);
    }
    // stable Kahn topological sort (input order breaks ties)
    const ordered: ModuleDef[] = [];
    const placed = new Set<string>();
    while (ordered.length < defs.length) {
      const next = defs.find((d) => !placed.has(d.id) && deps.get(d.id)!.every((x) => placed.has(x)));
      if (!next) {
        const rest = defs.filter((d) => !placed.has(d.id)).map((d) => d.id);
        throw new Error(`Module dependency cycle among: ${rest.join(', ')}`);
      }
      placed.add(next.id);
      ordered.push(next);
    }
    return ordered;
  }

  private register(rawData: Record<string, unknown>): void {
    const dataOwners = new Map<string, string>();
    for (const m of this.modules) {
      for (const [name, schema] of Object.entries(m.components ?? {})) {
        if (this.componentOwner.has(name)) throw new Error(`Component ${name} owned by both ${this.componentOwner.get(name)} and ${m.id}`);
        this.componentOwner.set(name, m.id);
        this.componentSchema.set(name, schema);
      }
      for (const name of Object.keys(m.events ?? {})) {
        if (this.eventOwner.has(name)) throw new Error(`Event ${name} declared by both ${this.eventOwner.get(name)} and ${m.id}`);
        this.eventOwner.set(name, m.id);
      }
      for (const name of Object.keys(m.commands ?? {})) {
        if (this.commandOwner.has(name)) throw new Error(`Command ${name} declared by both ${this.commandOwner.get(name)} and ${m.id}`);
        this.commandOwner.set(name, m.id);
      }
      for (const p of m.provides ?? []) {
        if (!m.ports || !(p in m.ports)) throw new Error(`Module ${m.id} provides port ${p} but has no port factory`);
        this.portProvider.set(p, m.id);
      }
      for (const name of Object.keys(m.projections ?? {})) {
        if (this.projectionOwner.has(name)) throw new Error(`Projection ${name} declared twice`);
        this.projectionOwner.set(name, m.id);
      }
      for (const [code, tpl] of Object.entries(m.blockers ?? {})) {
        if (this.blockerTemplates.has(code)) throw new Error(`Blocker code ${code} declared twice`);
        this.blockerTemplates.set(code, tpl);
      }
      for (const [name, schema] of Object.entries(m.data ?? {})) {
        if (dataOwners.has(name)) throw new Error(`Data catalog ${name} declared by both ${dataOwners.get(name)} and ${m.id}`);
        dataOwners.set(name, m.id);
        try {
          this.dataValues.set(name, deepFreeze(parseOrThrow(schema, rawData[name], `data catalog "${name}" (module ${m.id})`)));
        } catch (e) {
          if (e instanceof ValidationError) throw e;
          throw e;
        }
      }
      const ids = new Set<string>();
      for (const sys of m.systems ?? []) {
        if (ids.has(sys.id)) throw new Error(`Duplicate system ${m.id}/${sys.id}`);
        ids.add(sys.id);
        if (!(sys.every > 0)) throw new Error(`System ${m.id}/${sys.id} needs every > 0`);
      }
    }
    for (const name of Object.keys(rawData)) {
      if (!dataOwners.has(name)) throw new Error(`Data catalog "${name}" supplied but no module declares it`);
    }
    for (const m of this.modules) {
      for (const evt of Object.keys(m.on ?? {})) {
        // (the events of a port it may do without: a world without that port never sends them)
        if (!this.eventOwner.has(evt) && !(m.optional ?? []).includes(evt.split('.')[0]!)) throw new Error(`Module ${m.id} subscribes to undeclared event ${evt}`);
        if (!this.subscribers.has(evt)) this.subscribers.set(evt, []);
        this.subscribers.get(evt)!.push(m.id);
      }
    }
  }

  // ------------------------------------------------------------------ public API

  /** A player command, acted by `actor` (a party the client controls; the host checks that) */
  dispatch(type: string, payload: unknown, opts?: { actor?: EntityId }): CommandResult<unknown> {
    return this.dispatchAs(type, payload, false, opts?.actor ?? this.defaultActor);
  }

  /**
   * A recorded input from outside the players' reach: what the world definition prescribes for
   * the run (a live measurement feed, the step of a co-simulated model). Internal commands are
   * allowed here; the input is logged and replayed like any command, so the run stays
   * reproducible without the source (decisions 0016, 0021). Hosts only — never for players.
   */
  dispatchInput(type: string, payload: unknown): CommandResult<unknown> {
    return this.dispatchAs(type, payload, true, null);
  }

  private dispatchAs(type: string, payload: unknown, input: boolean, actor: EntityId | null): CommandResult<unknown> {
    if (this.undo) throw new Error('dispatch() called re-entrantly; use ctx.command() inside handlers');
    const owner = this.commandOwner.get(type);
    if (!owner) return { ok: false, reasons: [{ code: 'kernel.unknownCommand', severity: 'block', params: { type } }] };
    const def = this.moduleDef(owner).commands![type]!;
    // only commands made for it arrive as recorded inputs from outside: never setup or plumbing
    if (input && !def.input) return { ok: false, reasons: [{ code: 'kernel.notAnInput', severity: 'block', params: { type } }] };
    // internal commands are plumbing between modules (e.g. adding material that was produced):
    // players and agents act only through the player-facing commands
    if (!input && !this.trusted && (def.internal || this.moduleDef(owner).commandDocs?.[type]?.internal)) {
      return { ok: false, reasons: [{ code: 'kernel.internalCommand', severity: 'block', params: { type } }] };
    }
    let parsed: unknown;
    try {
      parsed = parseOrThrow(def.payload, payload, `command ${type}`);
    } catch (e) {
      if (e instanceof ValidationError) {
        return { ok: false, reasons: [{ code: 'kernel.invalidPayload', severity: 'block', params: { issues: e.issues.join('; ') } }] };
      }
      throw e;
    }
    // an id where a thing of a kind is asked for must be one (Qwen S182/S183: not an internal error further in)
    const wrong = this.wrongRef(def.payload as Schema<unknown>, parsed);
    if (wrong) return { ok: false, reasons: [{ code: 'kernel.wrongEntity', severity: 'block', params: wrong }] };
    this.callers.push(input ? 'input' : 'client');
    this.actors.push(actor);
    let result: CommandResult<unknown>;
    try {
      result = this.runCommandTx(owner, () => def.handle(this.ctx(owner), parsed));
    } finally {
      this.callers.pop();
      this.actors.pop();
    }
    if (result.ok) this.commandLog.push({ t: this.now, processed: this.processedUntil, type, payload: clone(payload), ...(input ? { input: true as const } : {}), ...(actor !== null ? { actor } : {}) });
    this.drainEvents();
    this.audit(`after ${type}`);
    return result;
  }

  /** Advance simulation time to `until`, firing every due timer in deterministic order. */
  advance(target: SimTime): AdvanceResult {
    if (this.undo) throw new Error('advance() called from inside a handler');
    const from = this.now;
    // a data source without data beyond its horizon stops the world there (gap policy 'wait')
    const horizon = this.dataHorizon();
    // (a horizon behind the present fires nothing: not even what is due now)
    const until = horizon && horizon.until < target ? horizon.until : target;
    let fired = 0;
    let delivered = 0;
    // (audited runtimes check every module's invariants once a simulated day too, not only when the advance ends: a
    // broken invariant is caught the day it breaks, design/modular-split.md §7.3)
    let auditAt = this.auditing ? this.calendar.startOfDay(this.now) + DAY : Infinity;
    for (;;) {
      const top = this.heap.peek();
      if (!top || top.time > until) break;
      this.heap.pop();
      if (top.dead) continue;
      this.timerIndex.delete(top.id);
      const prevNow = this.now;
      this.now = Math.max(this.now, top.time);
      try {
        this.runTx(() => this.fire(top));
      } catch (e) {
        // a failing handler is a bug; keep the world consistent so a host can inspect it
        this.now = prevNow;
        this.heap.push(top);
        this.timerIndex.set(top.id, top);
        throw e;
      }
      fired += 1;
      delivered += this.drainEvents();
      if (this.now >= auditAt) {
        this.audit(`on ${this.calendar.format(this.now)}`);
        auditAt = this.calendar.startOfDay(this.now) + DAY;
      }
    }
    this.now = Math.max(this.now, until);
    this.processedUntil = Math.max(this.processedUntil, until);
    const result: AdvanceResult = { from, to: this.now, timersFired: fired, eventsDelivered: delivered };
    if (until < target && horizon) result.waiting = horizon;
    this.audit(`advancing to ${this.calendar.format(this.now)}`);
    return result;
  }

  /** The earliest data horizon of all data sources (null: no source limits time). */
  dataHorizon(): DataWait | null {
    let best: DataWait | null = null;
    for (const m of this.modules) {
      if (!m.horizon) continue;
      const h = m.horizon(this.ctx(m.id));
      if (h && (!best || h.until < best.until)) best = { module: m.id, until: h.until, reason: h.reason };
    }
    return best;
  }

  /** The data source the world is waiting for right now (its horizon is reached), or null. */
  dataWait(): DataWait | null {
    const h = this.dataHorizon();
    return h && h.until <= this.now ? h : null;
  }

  /** Time of the next scheduled timer (or Infinity). */
  nextTimerTime(): SimTime {
    while (this.heap.peek()?.dead) this.heap.pop();
    return this.heap.peek()?.time ?? Number.POSITIVE_INFINITY;
  }

  project(name: string, args: Record<string, unknown> = {}): unknown {
    const owner = this.projectionOwner.get(name);
    if (!owner) throw new Error(`Unknown projection ${name}`);
    return this.moduleDef(owner).projections![name]!.compute(this.read, args);
  }

  projectionNames(): string[] {
    return [...this.projectionOwner.keys()];
  }

  /** Every player-facing command with its JSON schema — the action surface for UIs and AI agents. */
  /**
   * Strict mode: remedies are offered to players (humans and agents), so they may only point at
   * existing player commands — never at internal ones a client would be refused.
   */
  checkRemedies(remedies: readonly Remedy[] | undefined, where: string): void {
    for (const r of remedies ?? []) {
      if (!r.command) continue;
      const owner = this.commandOwner.get(r.command.type);
      if (!owner) throw new Error(`${where}: remedy "${r.label}" points at unknown command ${r.command.type}`);
      const def = this.moduleDef(owner).commands![r.command.type]!;
      if (def.internal || this.moduleDef(owner).commandDocs?.[r.command.type]?.internal) throw new Error(`${where}: remedy "${r.label}" points at internal command ${r.command.type}`);
      // its payload as the command takes it, and the things it names of the kinds the command asks for: a remedy the
      // command would refuse for its shape is no remedy (Qwen S513: a land.apply naming what land.apply does not take)
      let parsed: unknown;
      try {
        parsed = parseOrThrow(def.payload, r.command.payload, `remedy "${r.label}"`);
      } catch (e) {
        if (e instanceof ValidationError) throw new Error(`${where}: remedy "${r.label}" would be refused by ${r.command.type}: ${e.issues.join('; ')}`);
        throw e;
      }
      const wrong = this.wrongRef(def.payload as Schema<unknown>, parsed);
      if (wrong) throw new Error(`${where}: remedy "${r.label}" names ${wrong.id} where ${r.command.type} takes a ${wrong.kind}${wrong.is}`);
    }
  }
  commandCatalogue(): { type: string; module: string; label?: string; description?: string; payload: Record<string, unknown> }[] {
    const out: { type: string; module: string; label?: string; description?: string; payload: Record<string, unknown> }[] = [];
    for (const [type, owner] of this.commandOwner) {
      const def = this.moduleDef(owner).commands![type]!;
      const docs = this.moduleDef(owner).commandDocs?.[type];
      if (def.internal || docs?.internal) continue;
      const row: (typeof out)[number] = { type, module: owner, payload: toJsonSchema(def.payload as Schema<unknown>) };
      if (def.label) row.label = def.label;
      const description = def.description ?? docs?.description;
      if (description) row.description = description;
      out.push(row);
    }
    return out;
  }

  projectionCatalogue(): { name: string; module: string; label?: string; description?: string }[] {
    return [...this.projectionOwner].map(([name, owner]) => {
      const def = this.moduleDef(owner).projections![name]!;
      return { name, module: owner, ...(def.label ? { label: def.label } : {}), ...(def.description ? { description: def.description } : {}) };
    });
  }

  onEvent(listener: (type: string, payload: unknown, t: SimTime) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  log(limit = 200): LogEntry[] {
    return this.logEntries.slice(-limit);
  }

  /**
   * Warnings said again and again over days: a loop with no exit (robustness plan step 0). A retry that never ends, a
   * person who "cannot get to work" every morning: each should end, or become a standing blocker with remedies.
   */
  repeating(minTimes = 10, minDays = 7): LogEntry[] {
    return this.logEntries.filter((e) => e.level === 'warn' && (e.times ?? 1) >= minTimes && e.t - (e.since ?? e.t) >= minDays * 86_400);
  }

  ledgerEntries(filter?: { since?: SimTime; account?: string }): LedgerEntry[] {
    return this.entries.filter(
      (e) => (filter?.since === undefined || e.t >= filter.since) && (!filter?.account || e.from === filter.account || e.to === filter.account),
    );
  }

  accountsList(): LedgerAccount[] {
    return [...this.accounts.values()].map((a) => ({ ...a }));
  }

  componentNames(): string[] {
    return [...this.componentOwner.keys()];
  }

  /** the first id in a payload that is not what its field asks for (a field `ref(kind)` whose kind is a component asks for an entity with it) */
  private wrongRef(schema: Schema<unknown>, value: unknown): { id: string; kind: string; is: string } | undefined {
    const sch = schema as Schema<unknown> & { kind?: string; inner?: Schema<unknown>; shape?: Record<string, Schema<unknown>>; item?: Schema<unknown> };
    if (value === undefined || value === null) return undefined;
    if (sch.kind === 'optional' || sch.kind === 'nullable') return sch.inner ? this.wrongRef(sch.inner, value) : undefined;
    if (sch.kind === 'object' && sch.shape && typeof value === 'object') {
      for (const [k, f] of Object.entries(sch.shape)) {
        const w = this.wrongRef(f, (value as Record<string, unknown>)[k]);
        if (w) return w;
      }
      return undefined;
    }
    if (sch.kind === 'array' && sch.item && Array.isArray(value)) {
      for (const v of value) {
        const w = this.wrongRef(sch.item, v);
        if (w) return w;
      }
      return undefined;
    }
    const ref = (sch.meta as { ref?: string } | undefined)?.ref;
    if (!ref || ref === '*' || typeof value !== 'string') return undefined;
    // (one of several kinds: any of them will do; a kind no module keeps a component for is not checked)
    const components = ref.split('|').map((k) => k[0]!.toUpperCase() + k.slice(1));
    if (components.some((c) => !this.componentSchema.has(c) || this.stores.get(c)?.has(value))) return undefined;
    const meta = this.entityMeta.get(value);
    return { id: value, kind: ref.split('|').join(' or '), is: meta ? ` (it is a ${meta.kind})` : ' (there is no such thing)' };
  }

  componentSchemaOf(name: string): Schema<unknown> | undefined {
    return this.componentSchema.get(name);
  }

  ownerOf(component: string): string | undefined {
    return this.componentOwner.get(component);
  }

  /** Every component attached to an entity (for generic inspectors). */
  componentsOf(id: EntityId): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, store] of this.stores) {
      if (store.has(id)) out[name] = store.get(id);
    }
    return out;
  }

  /** every module's physical invariants (its `audit`): a violation is a bug, thrown with what was found */
  /**
   * What was spawned for an entity that ends or goes (decision 0028): each by its module's `ended` handler, which ends it,
   * destroys it or adopts it to something else; one it leaves as it was is an orphan, a defect said at once
   */
  private linkDependent(owner: EntityId, id: EntityId): void {
    let set = this.dependents.get(owner);
    if (!set) this.dependents.set(owner, (set = new Set()));
    set.add(id);
  }

  private unlinkDependent(owner: EntityId, id: EntityId): void {
    const set = this.dependents.get(owner);
    if (!set) return;
    set.delete(id);
    if (!set.size) this.dependents.delete(owner);
  }

  private endDependents(owner: EntityId, why: string): void {
    const children = [...(this.dependents.get(owner) ?? [])].sort();
    for (const id of children) {
      const meta = this.entityMeta.get(id);
      if (!meta || meta.ended || !meta.for?.includes(owner)) continue;
      const handler = this.moduleDef(meta.createdBy).ended?.[meta.kind];
      if (!handler) throw new Error(`${meta.createdBy} declares no ended.${meta.kind} for ${id} (decision 0028)`);
      handler(this.ctx(meta.createdBy), id, { owner, why });
      const after = this.entityMeta.get(id);
      if (after && !after.ended && after.for?.includes(owner)) throw new Error(`${meta.createdBy}: ended.${meta.kind} left ${id} as it was although ${owner} ended (an orphan, decision 0028)`);
    }
  }

  audit(when: string): void {
    if (!this.auditing) return;
    const found: string[] = [];
    // (nothing lives on for an owner that ended or is gone: decision 0028)
    for (const e of this.entityMeta.values()) {
      if (e.ended) continue;
      for (const owner of e.for ?? []) {
        const o = this.entityMeta.get(owner);
        if (!o || o.ended) found.push(`kernel: ${e.id} (${e.kind}) lives on for ${owner}, which ${o ? 'ended' : 'is gone'} (an orphan, decision 0028)`);
      }
    }
    for (const m of this.modules) if (m.audit) for (const v of m.audit(this.read)) found.push(`${m.id}: ${v}`);
    if (found.length) throw new Error(`audit ${when} (${this.calendar.format(this.now)}): ${found.join('; ')}`);
  }

  /** the components of an entity as a party may observe them (each owner module's `observe` rules): what a client is served */
  observedComponents(id: EntityId, viewer: EntityId): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(this.componentsOf(id))) {
      const owner = this.componentOwner.get(name);
      const rule = owner ? this.moduleDef(owner).observe?.[name] : undefined;
      if (rule === 'hidden') continue;
      const seen = typeof rule === 'function' ? rule(value, viewer, this.read, id) : value;
      if (seen !== undefined) out[name] = seen;
    }
    return out;
  }

  /** a hash of the print of every module's component, state and data schemas */
  schemaHash(): string {
    if (this.schemaHashCache) return this.schemaHashCache;
    const print = this.modules.map((m) => `${m.id}:${schemaPrint({ components: m.components ?? {}, state: m.state?.schema ?? null, data: m.data ?? {} })}`).join('|');
    // FNV-1a, 32 bits, twice over (the print and its reverse) for 64 bits of it
    const fnv = (str: string) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i += 1) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
      return h.toString(16).padStart(8, '0');
    };
    this.schemaHashCache = fnv(print) + fnv([...print].reverse().join(''));
    return this.schemaHashCache;
  }
  private schemaHashCache: string | undefined;

  snapshot(): Snapshot {
    const components: Snapshot['components'] = {};
    for (const [name, store] of this.stores) components[name] = [...store.entries()].map(([id, v]) => [id, clone(v)]);
    const blockers: Snapshot['blockers'] = [];
    for (const [id, byMod] of this.blockerMap) for (const [mod, list] of byMod) blockers.push([id, mod, clone(list)]);
    const rng: Record<string, RngState> = {};
    for (const [k, r] of this.rngs) rng[k] = [...r.state] as RngState;
    return {
      format: 'cc-sim-snapshot',
      version: 2,
      modules: this.modules.map((m) => m.id),
      schemas: this.schemaHash(),
      seed: this.seed,
      epochDay: this.calendar.epochDay,
      now: this.now,
      processedUntil: this.processedUntil,
      seq: this.seq,
      timerCounter: this.timerCounter,
      procCounter: this.procCounter,
      idCounters: { ...this.idCounters },
      entities: [...this.entityMeta.values()].map((e) => ({ ...e })),
      components,
      states: Object.fromEntries([...this.states].map(([k, v]) => [k, clone(v)])),
      timers: this.heap.sorted().filter((t) => !t.dead).map(({ dead: _d, ...t }) => clone(t)),
      processes: [...this.procs.values()].map((p) => clone(p)),
      accounts: [...this.accounts.values()].map((a) => ({ ...a })),
      entries: this.entries.map((e) => clone(e)),
      blockers,
      rng,
      ...(this.branches.length ? { branches: [...this.branches] } : {}),
      ...(this.validityNotes.size ? { validity: [...this.validityNotes.values()].map((n) => ({ ...n })) } : {}),
      log: this.logEntries.map((l) => clone(l)),
      commandLog: this.commandLog.map((c) => clone(c)),
    };
  }

  /** Stable hash of authoritative state (excludes the human log and command log). */
  hash(): string {
    const { log: _l, commandLog: _c, ...rest } = this.snapshot();
    const text = JSON.stringify(rest);
    return `${hash32(text).toString(16).padStart(8, '0')}${hash32(`${text.length}:${text}`).toString(16).padStart(8, '0')}`;
  }

  formatBlocker(b: Blocker): string {
    const tpl = this.blockerTemplates.get(b.code) ?? b.code;
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = b.params?.[k];
      if (v === undefined) return `{${k}}`;
      return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 2 : 1)) : v;
    });
  }

  // ------------------------------------------------------------------ internals

  private moduleDef(id: string): ModuleDef {
    return this.modules[this.moduleIndex.get(id)!]!;
  }

  private store(name: string): Map<EntityId, unknown> {
    let s = this.stores.get(name);
    if (!s) {
      s = new Map();
      this.stores.set(name, s);
      if (this.undo) this.undo.push(() => this.stores.delete(name));
    }
    return s;
  }

  private freeze<T>(v: T): T {
    return this.strict ? deepFreeze(v) : v;
  }

  private bump(component?: string, members = false): void {
    this.globalRevision += 1;
    if (component) this.revisions.set(component, (this.revisions.get(component) ?? 0) + 1);
    if (component && members) this.memberRevisions.set(component, (this.memberRevisions.get(component) ?? 0) + 1);
  }

  private pushUndo(fn: () => void): void {
    if (!this.undo) throw new Error('state mutation outside of a transaction');
    this.undo.push(fn);
  }

  private runTx<T>(fn: () => T): T {
    const outer = this.undo === null;
    if (outer) this.undo = [];
    const savepoint = this.undo!.length;
    const counters = { seq: this.seq, timerCounter: this.timerCounter, procCounter: this.procCounter };
    try {
      const r = fn();
      if (outer) this.undo = null;
      return r;
    } catch (e) {
      this.rollback(savepoint);
      // sequence counters are part of the deterministic state: a rejected command leaves no trace
      this.seq = counters.seq;
      this.timerCounter = counters.timerCounter;
      this.procCounter = counters.procCounter;
      if (outer) this.undo = null;
      throw e;
    }
  }

  /** Re-insert `key` into `map` at the position it had before (`after` = its predecessor key, null = first). */
  private static reinsert<K, V>(map: Map<K, V>, key: K, value: V, after: K | null | undefined): void {
    if (after === undefined) {
      map.set(key, value);
      return;
    }
    const entries = [...map.entries()];
    map.clear();
    if (after === null) map.set(key, value);
    for (const [k, v] of entries) {
      map.set(k, v);
      if (k === after) map.set(key, value);
    }
    if (!map.has(key)) map.set(key, value);
  }

  /** key preceding `key` in insertion order (null if first) */
  private static predecessor<K, V>(map: Map<K, V>, key: K): K | null {
    let prev: K | null = null;
    for (const k of map.keys()) {
      if (k === key) return prev;
      prev = k;
    }
    return prev;
  }

  private rollback(savepoint: number): void {
    const u = this.undo!;
    if (u.length <= savepoint) return;
    while (u.length > savepoint) u.pop()!();
    // (what was undone is a change too: a memo keyed by the revision, filled inside the rejected command, is not served
    // after it; component writes and removals bump their own on undo, decision 0028 step 6)
    this.globalRevision += 1;
  }

  private runCommandTx<R>(owner: string, fn: () => R): CommandResult<R> {
    try {
      return { ok: true, value: this.runTx(fn) };
    } catch (e) {
      if (e instanceof CommandRejection) {
        return { ok: false, reasons: e.reasons.map((r) => ({ module: owner, ...r })) };
      }
      throw e;
    }
  }

  private fire(t: TimerRec): void {
    if (t.system) {
      const def = this.moduleDef(t.module).systems!.find((s) => s.id === t.system)!;
      def.run(this.ctx(t.module), def.every);
      this.scheduleSystem(t.module, def, t.time + def.every, false);
      return;
    }
    if (t.timer === '__proc') {
      this.completeProcess((t.payload as { id: string }).id, t.id);
      return;
    }
    const handler = this.moduleDef(t.module).timers?.[t.timer];
    if (!handler) throw new Error(`Module ${t.module} has no timer ${t.timer}`);
    handler(this.ctx(t.module), t.payload);
  }

  private rankFor(module: string, phase: keyof typeof PHASE_RANK = 'operations'): number {
    return PHASE_RANK[phase] * 1000 + (this.moduleIndex.get(module) ?? 0);
  }

  private scheduleSystem(module: string, sys: SystemDef, from: SimTime, align: boolean): void {
    const offset = sys.offset ?? 0;
    const time = align ? Math.ceil((from - offset) / sys.every) * sys.every + offset : from;
    const rec: TimerRec = {
      id: ++this.timerCounter,
      time: Math.max(time, from),
      rank: this.rankFor(module, sys.phase),
      seq: ++this.seq,
      module,
      timer: `__system:${sys.id}`,
      payload: null,
      system: sys.id,
    };
    this.heap.push(rec);
    this.timerIndex.set(rec.id, rec);
  }

  private addTimer(module: string, time: SimTime, timer: string, payload: unknown): number {
    if (!(time >= this.now)) throw new Error(`Cannot schedule ${module}/${timer} in the past (${time} < ${this.now})`);
    if (timer !== '__proc' && !this.moduleDef(module).timers?.[timer]) throw new Error(`Module ${module} has no timer "${timer}"`);
    const rec: TimerRec = { id: ++this.timerCounter, time, rank: this.rankFor(module), seq: ++this.seq, module, timer, payload: this.freeze(clone(payload)) };
    this.heap.push(rec);
    this.timerIndex.set(rec.id, rec);
    this.pushUndo(() => {
      rec.dead = true;
      this.timerIndex.delete(rec.id);
    });
    return rec.id;
  }

  private cancelTimer(id: number | undefined): void {
    if (id === undefined) return;
    const rec = this.timerIndex.get(id);
    if (!rec || rec.dead) return;
    rec.dead = true;
    this.timerIndex.delete(id);
    this.pushUndo(() => {
      rec.dead = false;
      this.timerIndex.set(id, rec);
    });
  }

  private drainEvents(): number {
    if (this.draining) return 0;
    this.draining = true;
    let delivered = 0;
    try {
      while (this.pendingEvents.length) {
        const ev = this.pendingEvents.shift()!;
        for (const mod of this.subscribers.get(ev.type) ?? []) {
          const handler = this.moduleDef(mod).on![ev.type as never] as unknown as (c: WriteCtx, p: unknown) => void;
          this.runTx(() => handler(this.ctx(mod), ev.payload));
        }
        for (const l of this.eventListeners) l(ev.type, ev.payload, this.now);
        delivered += 1;
        if (delivered > 1_000_000) throw new Error('Event storm: more than 1e6 events in one drain');
      }
    } finally {
      this.draining = false;
    }
    return delivered;
  }

  // ---------------------------------------------------------------- processes

  private integrate(p: ProcRec): void {
    if (p.status === 'active' && this.now > p.updatedAt) {
      p.done = Math.min(p.total, p.done + (p.rate * (this.now - p.updatedAt)) / 3600);
    }
    p.updatedAt = this.now;
  }

  private snapshotProc(p: ProcRec): void {
    const saved = { ...p };
    this.pushUndo(() => {
      Object.assign(p, saved);
      for (const k of Object.keys(p) as (keyof ProcRec)[]) if (!(k in saved)) delete p[k];
    });
  }

  private scheduleCompletion(p: ProcRec): void {
    this.cancelTimer(p.timerId);
    delete p.timerId;
    if (p.status !== 'active') return;
    const remaining = p.total - p.done;
    if (leftOf(p.total, p.done) === 0) {
      p.timerId = this.addTimer(p.module, this.now, '__proc', { id: p.id });
      return;
    }
    if (p.rate <= 0) return;
    // at least one second ahead: a timer at `now` that integrates nothing would loop forever
    const seconds = Math.max(1, Math.ceil((remaining / p.rate) * 3600 - 1e-6));
    p.timerId = this.addTimer(p.module, this.now + Math.max(0, seconds), '__proc', { id: p.id });
  }

  private completeProcess(id: string, timerId: number): void {
    const p = this.procs.get(id);
    if (!p || p.status !== 'active' || p.timerId !== timerId) return;
    this.snapshotProc(p);
    this.integrate(p);
    delete p.timerId;
    if (leftOf(p.total, p.done) > 0) {
      this.scheduleCompletion(p);
      return;
    }
    p.done = p.total;
    p.status = 'complete';
    p.completedAt = this.now;
    this.bump();
    if (p.onComplete) {
      const handler = this.moduleDef(p.module).timers?.[p.onComplete];
      if (!handler) throw new Error(`Process ${id}: module ${p.module} has no timer ${p.onComplete}`);
      handler(this.ctx(p.module), { ...(p.payload ?? {}), process: p.id });
    }
  }

  private procView(p: ProcRec): ProcessView {
    const done = p.status === 'active' ? Math.min(p.total, p.done + (p.rate * (this.now - p.updatedAt)) / 3600) : p.done;
    const eta = p.status === 'complete' ? (p.completedAt ?? this.now) : p.status === 'active' && p.rate > 0 ? this.now + ((p.total - done) / p.rate) * 3600 : Number.POSITIVE_INFINITY;
    const v: ProcessView = {
      id: p.id,
      module: p.module,
      kind: p.kind,
      unit: p.unit,
      total: p.total,
      done,
      rate: p.status === 'active' ? p.rate : 0,
      status: p.status,
      startedAt: p.startedAt,
      updatedAt: p.updatedAt,
      eta,
    };
    if (p.subject) v.subject = p.subject;
    if (p.label) v.label = p.label;
    if (p.completedAt !== undefined) v.completedAt = p.completedAt;
    if (p.rateExplain) v.rateExplain = p.rateExplain;
    if (p.data !== undefined) v.data = this.strict ? deepFreeze(clone(p.data)) : clone(p.data);
    return v;
  }

  private ownProc(module: string, id: string): ProcRec {
    const p = this.procs.get(id);
    if (!p) throw new Error(`Unknown process ${id}`);
    if (p.module !== module) throw new OwnershipError(`Module ${module} cannot modify process ${id} owned by ${p.module}`);
    return p;
  }

  // ---------------------------------------------------------------- contexts

  private makeReadCtx(): ReadCtx {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rt = this;
    const ctx: ReadCtx = {
      get now() {
        return rt.now;
      },
      calendar: rt.calendar,
      seed: rt.seed,
      get: (c, id) => rt.stores.get(c)?.get(id) as never,
      require: (c, id) => {
        const v = rt.stores.get(c)?.get(id);
        if (v === undefined) throw new Error(`Entity ${id} has no component ${c}`);
        return v as never;
      },
      has: (c, id) => rt.stores.get(c)?.has(id) ?? false,
      all: (c) => (rt.stores.get(c) ?? new Map()).entries() as never,
      count: (c) => rt.stores.get(c)?.size ?? 0,
      entity: (id) => rt.entityMeta.get(id),
      ended: (id) => rt.entityMeta.get(id)?.ended,
      entities: (kind) => [...rt.entityMeta.values()].filter((e) => !kind || e.kind === kind),
      state: (m) => {
        if (!rt.states.has(m)) throw new Error(`Module ${m} has no state`);
        return rt.states.get(m) as never;
      },
      port: (name) => {
        if (rt.portCache.has(name)) return rt.portCache.get(name) as never;
        const provider = rt.portProvider.get(name);
        if (!provider) throw new Error(`No module provides port ${name}`);
        const impl = rt.moduleDef(provider).ports![name as never] as unknown as (c: ReadCtx) => unknown;
        // (a port reads as its provider: what it reads of its own is no foreign read of its caller)
        const value = impl(rt.readFor(provider));
        rt.portCache.set(name, value);
        return value as never;
      },
      hasPort: (name) => rt.portProvider.has(name),
      contributions: (name) => {
        let list = rt.contributionCache.get(name);
        if (!list) {
          list = [];
          for (const m of rt.modules) {
            const f = m.contributes?.[name as never] as unknown as ((c: ReadCtx) => unknown) | undefined;
            if (f) list.push({ module: m.id, impl: f(rt.readFor(m.id)) });
          }
          rt.contributionCache.set(name, list);
        }
        return list as never;
      },
      data: (name) => {
        if (!rt.dataValues.has(name)) throw new Error(`No data catalog ${name}`);
        return rt.dataValues.get(name) as never;
      },
      hasData: (name) => rt.dataValues.has(name) && rt.dataValues.get(name) !== undefined,
      process: (id) => {
        const p = rt.procs.get(id);
        return p ? rt.procView(p) : undefined;
      },
      listProcesses: (f) =>
        [...rt.procs.values()]
          .filter((p) => (!f?.module || p.module === f.module) && (!f?.subject || p.subject === f.subject) && (!f?.kind || p.kind === f.kind) && (!f?.status || p.status === f.status))
          .map((p) => rt.procView(p)),
      balance: (a) => rt.accounts.get(a)?.balance ?? 0,
      account: (a) => {
        const acc = rt.accounts.get(a);
        return acc ? { ...acc } : undefined;
      },
      accounts: (holder?: EntityId) => [...rt.accounts.values()].filter((acc) => holder === undefined || acc.holder === holder).map((acc) => ({ ...acc })),
      blockersOf: (id) => {
        const byMod = rt.blockerMap.get(id);
        if (!byMod) return [];
        return clone([...byMod.values()].flat());
      },
      blocked: () => [...rt.blockerMap.entries()].filter(([, byMod]) => [...byMod.values()].some((l) => l.length > 0)).map(([id]) => id).sort(),
      revision: (c, of) => (c ? ((of === 'members' ? rt.memberRevisions : rt.revisions).get(c) ?? 0) : rt.globalRevision),
      formatBlocker: (b) => rt.formatBlocker(b),
      models: () => rt.modules.flatMap((m) => (typeof m.models === 'function' ? m.models(rt.read) : (m.models ?? [])).map((d) => clone(d))),
      validity: () => [...rt.validityNotes.values()].map((n) => ({ ...n })),
    };
    return ctx;
  }

  /**
   * What a module reads with: the world's read context, noting each read of another module's components
   * (design/modular-split.md P2). In audited runtimes a read the module does not declare in `reads` is refused.
   */
  private readFor(module: string): ReadCtx {
    const cached = this.readCache.get(module);
    if (cached) return cached;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rt = this;
    const base = this.read;
    const declared = new Set(this.moduleDef(module).reads ?? []);
    const note = (c: string) => {
      const owner = rt.componentOwner.get(c);
      if (owner === undefined || owner === module) return;
      const key = `${module}|${c}`;
      rt.foreign.set(key, (rt.foreign.get(key) ?? 0) + 1);
      if (rt.auditing && !declared.has(c)) throw new OwnershipError(`Module ${module} reads component ${c} (owned by ${owner}) without declaring it in reads: ask ${owner}'s port instead (design/modular-split.md P2)`);
    };
    const r = Object.create(base) as ReadCtx;
    Object.assign(r, {
      get: (c: string, id: EntityId) => (note(c), base.get(c as never, id)),
      require: (c: string, id: EntityId) => (note(c), base.require(c as never, id)),
      has: (c: string, id: EntityId) => (note(c), base.has(c as never, id)),
      all: (c: string) => (note(c), base.all(c as never)),
      count: (c: string) => (note(c), base.count(c as never)),
    });
    this.readCache.set(module, r);
    return r;
  }

  /** each module's reads of other modules' components so far, by component, with whether it declares them */
  foreignReads(): { module: string; component: string; owner: string; count: number; declared: boolean }[] {
    return [...this.foreign].map(([key, count]) => {
      const [module, component] = key.split('|') as [string, string];
      return { module, component, owner: this.componentOwner.get(component)!, count, declared: (this.moduleDef(module).reads ?? []).includes(component) };
    });
  }

  private ctx(module: string): WriteCtx {
    const cached = this.ctxCache.get(module);
    if (cached) return cached;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rt = this;
    const read = this.readFor(module);
    const assertOwner = (component: string) => {
      const owner = rt.componentOwner.get(component);
      if (!owner) throw new Error(`Unknown component ${component}`);
      if (owner !== module) throw new OwnershipError(`Module ${module} cannot write component ${component} (owned by ${owner})`);
    };
    const validate = (component: string, value: unknown) => {
      if (!rt.strict) return;
      const schema = rt.componentSchema.get(component)!;
      parseOrThrow(schema, value, `component ${component} written by ${module}`);
    };
    const writeComponent = (component: string, id: EntityId, value: unknown) => {
      if (!rt.entityMeta.has(id)) throw new Error(`Cannot attach ${component} to unknown entity ${id}`);
      validate(component, value);
      const store = rt.store(component);
      const had = store.has(id);
      const prev = store.get(id);
      store.set(id, rt.freeze(value));
      rt.bump(component, !had);
      rt.pushUndo(() => {
        if (had) store.set(id, prev);
        else store.delete(id);
        rt.bump(component, !had);
      });
    };
    const ctx: WriteCtx = Object.create(read) as WriteCtx;
    Object.defineProperty(ctx, 'outsideValidity', {
      value: (contract: string, reason: string) => {
        const key = `${contract}|${module}`;
        const prev = rt.validityNotes.get(key);
        const note: ValidityNote = prev && prev.reason === reason ? { ...prev, count: prev.count + 1 } : { contract, module, reason, since: rt.now, count: 1 };
        rt.validityNotes.set(key, rt.freeze(note));
        rt.pushUndo(() => {
          if (prev) rt.validityNotes.set(key, prev);
          else rt.validityNotes.delete(key);
        });
      },
    });
    Object.defineProperty(ctx, 'now', { get: () => rt.now });
    Object.defineProperty(ctx, 'caller', { get: () => rt.callers[rt.callers.length - 1] ?? module });
    Object.defineProperty(ctx, 'actor', { get: () => rt.actors[rt.actors.length - 1] ?? null });
    Object.defineProperty(ctx, 'trusted', { value: rt.trusted });
    Object.defineProperty(ctx, 'setup', { get: () => rt.inSetup });
    Object.assign(ctx, {
      module,
      spawn(kind: string, opts?: { name?: string; id?: string; for?: EntityId | readonly EntityId[] }) {
        // (one spawned for owners ends with any of them: its module says how; nothing is spawned for one that is gone or
        // has ended, decision 0028)
        const owners = opts?.for === undefined ? [] : [...new Set(typeof opts.for === 'string' ? [opts.for] : opts.for)];
        for (const o of owners) {
          const om = rt.entityMeta.get(o);
          if (!om) throw new Error(`Module ${module} spawns a ${kind} for ${o}, which does not exist`);
          if (om.ended) throw new Error(`Module ${module} spawns a ${kind} for ${o}, which ended (${om.ended.why}): it would be an orphan at once (decision 0028)`);
        }
        if (owners.length && !rt.moduleDef(module).ended?.[kind]) throw new Error(`Module ${module} spawns a ${kind} for ${owners.join(', ')} but declares no ended.${kind} (decision 0028: what depends on something ends with it)`);
        let id = opts?.id;
        const prevCounter = rt.idCounters[kind];
        if (!id) {
          const n = (rt.idCounters[kind] ?? 0) + 1;
          rt.idCounters[kind] = n;
          id = `${kind}-${n}`;
        }
        if (rt.entityMeta.has(id)) throw new Error(`Entity id ${id} already exists`);
        const meta: EntityMeta = { id, kind, createdBy: module, createdAt: rt.now };
        if (opts?.name) meta.name = opts.name;
        if (owners.length) meta.for = owners;
        rt.entityMeta.set(id, rt.freeze(meta));
        rt.bump();
        const finalId = id;
        for (const o of owners) rt.linkDependent(o, id);
        rt.pushUndo(() => {
          for (const o of owners) rt.unlinkDependent(o, finalId);
          rt.entityMeta.delete(finalId);
          if (prevCounter === undefined) delete rt.idCounters[kind];
          else rt.idCounters[kind] = prevCounter;
        });
        return id;
      },
      destroy(id: EntityId) {
        const meta = rt.entityMeta.get(id);
        if (!meta) return;
        if (meta.createdBy !== module) throw new OwnershipError(`Module ${module} cannot destroy ${id} (created by ${meta.createdBy})`);
        // (what was spawned for it ends with it first, decision 0028)
        rt.endDependents(id, 'it is gone');
        const removed: [string, unknown, EntityId | null][] = [];
        for (const [name, store] of rt.stores) {
          if (store.has(id)) {
            removed.push([name, store.get(id), Runtime.predecessor(store, id)]);
            store.delete(id);
            rt.bump(name, true);
          }
        }
        const blockers = rt.blockerMap.get(id);
        const blockersPrev = blockers ? Runtime.predecessor(rt.blockerMap, id) : undefined;
        rt.blockerMap.delete(id);
        const metaPrev = Runtime.predecessor(rt.entityMeta, id);
        rt.entityMeta.delete(id);
        for (const o of meta.for ?? []) rt.unlinkDependent(o, id);
        rt.pushUndo(() => {
          for (const o of meta.for ?? []) rt.linkDependent(o, id);
          Runtime.reinsert(rt.entityMeta, id, meta, metaPrev);
          // (put back, each component is a change again: a memo keyed by its revision is not served stale, decision 0028 step 6)
          for (const [name, v, prev] of removed) {
            Runtime.reinsert(rt.store(name), id, v, prev);
            rt.bump(name, true);
          }
          if (blockers) Runtime.reinsert(rt.blockerMap, id, blockers, blockersPrev);
        });
        rt.kernelEmit = true;
        try {
          ctx.emit('entity.destroyed' as never, { id, kind: meta.kind } as never);
        } finally {
          rt.kernelEmit = false;
        }
      },
      end(id: EntityId, why: string) {
        const meta = rt.entityMeta.get(id);
        if (!meta) throw new Error(`Unknown entity ${id}`);
        if (meta.createdBy !== module) throw new OwnershipError(`Module ${module} cannot end ${id} (created by ${meta.createdBy})`);
        if (meta.ended) return;
        rt.entityMeta.set(id, rt.freeze({ ...meta, ended: { at: rt.now, why } }));
        rt.bump();
        rt.pushUndo(() => rt.entityMeta.set(id, meta));
        rt.kernelEmit = true;
        try {
          ctx.emit('entity.ended' as never, { id, kind: meta.kind, why } as never);
        } finally {
          rt.kernelEmit = false;
        }
        rt.endDependents(id, why);
      },
      adopt(id: EntityId, owner: EntityId | null) {
        const meta = rt.entityMeta.get(id);
        if (!meta) throw new Error(`Unknown entity ${id}`);
        if (meta.createdBy !== module) throw new OwnershipError(`Module ${module} cannot adopt ${id} (created by ${meta.createdBy})`);
        if (owner !== null && !rt.entityMeta.has(owner)) throw new Error(`Cannot adopt ${id} to ${owner}, which does not exist`);
        if (owner !== null && rt.entityMeta.get(owner)!.ended) throw new Error(`Cannot adopt ${id} to ${owner}, which ended (an orphan at once, decision 0028)`);
        const { for: was, ...rest } = meta;
        rt.entityMeta.set(id, rt.freeze(owner === null ? rest : { ...rest, for: [owner] }));
        for (const o of was ?? []) rt.unlinkDependent(o, id);
        if (owner !== null) rt.linkDependent(owner, id);
        rt.bump();
        rt.pushUndo(() => {
          if (owner !== null) rt.unlinkDependent(owner, id);
          for (const o of was ?? []) rt.linkDependent(o, id);
          rt.entityMeta.set(id, meta);
        });
      },
      rename(id: EntityId, name: string) {
        const meta = rt.entityMeta.get(id);
        if (!meta) throw new Error(`Unknown entity ${id}`);
        if (meta.createdBy !== module) throw new OwnershipError(`Module ${module} cannot rename ${id}`);
        rt.entityMeta.set(id, rt.freeze({ ...meta, name }));
        rt.pushUndo(() => rt.entityMeta.set(id, meta));
      },
      set(component: string, id: EntityId, value: unknown) {
        assertOwner(component);
        writeComponent(component, id, value);
      },
      patch(component: string, id: EntityId, partial: Record<string, unknown>) {
        assertOwner(component);
        const prev = rt.stores.get(component)?.get(id);
        if (prev === undefined) throw new Error(`patch: entity ${id} has no ${component}`);
        writeComponent(component, id, { ...(prev as Record<string, unknown>), ...partial });
      },
      remove(component: string, id: EntityId) {
        assertOwner(component);
        const store = rt.stores.get(component);
        if (!store || !store.has(id)) return;
        const prev = store.get(id);
        const before = Runtime.predecessor(store, id);
        store.delete(id);
        rt.bump(component, true);
        rt.pushUndo(() => {
          Runtime.reinsert(store, id, prev, before);
          rt.bump(component, true);
        });
      },
      setState(m: string, value: unknown) {
        if (m !== module) throw new OwnershipError(`Module ${module} cannot write state of ${m}`);
        const prev = rt.states.get(m);
        rt.states.set(m, rt.freeze(value));
        rt.bump();
        rt.pushUndo(() => rt.states.set(m, prev));
      },
      patchState(m: string, partial: Record<string, unknown>) {
        if (m !== module) throw new OwnershipError(`Module ${module} cannot write state of ${m}`);
        const prev = rt.states.get(m) as Record<string, unknown>;
        rt.states.set(m, rt.freeze({ ...prev, ...partial }));
        rt.bump();
        rt.pushUndo(() => rt.states.set(m, prev));
      },
      emit(type: string, payload: unknown) {
        const owner = rt.eventOwner.get(type);
        if (!owner) throw new Error(`Undeclared event ${type}`);
        if (owner === KERNEL ? !rt.kernelEmit : owner !== module) throw new OwnershipError(`Module ${module} cannot emit ${type} (declared by ${owner})`);
        const ev = { type, payload: rt.freeze(payload) };
        rt.pendingEvents.push(ev);
        rt.pushUndo(() => {
          const i = rt.pendingEvents.lastIndexOf(ev);
          if (i >= 0) rt.pendingEvents.splice(i, 1);
        });
      },
      at(time: SimTime, timer: string, payload?: unknown) {
        return rt.addTimer(module, time, timer, payload ?? null);
      },
      after(delay: number, timer: string, payload?: unknown) {
        return rt.addTimer(module, rt.now + Math.max(0, delay), timer, payload ?? null);
      },
      cancel(id: number | undefined) {
        if (id === undefined) return;
        const rec = rt.timerIndex.get(id);
        if (rec && rec.module !== module) throw new OwnershipError(`Module ${module} cannot cancel timer of ${rec.module}`);
        rt.cancelTimer(id);
      },
      rng(stream: string) {
        const key = `${module}/${stream}`;
        let r = rt.rngs.get(key);
        if (!r) {
          r = new Rng(seedState(rt.branches.length ? rt.streamSeed() : rt.seed, key));
          rt.rngs.set(key, r);
          rt.pushUndo(() => rt.rngs.delete(key));
        } else {
          const saved = [...r.state] as RngState;
          const rr = r;
          rt.pushUndo(() => {
            rr.state = saved;
          });
        }
        return r;
      },
      command(type: string, payload: unknown) {
        const owner = rt.commandOwner.get(type);
        if (!owner) return { ok: false, reasons: [{ code: 'kernel.unknownCommand', severity: 'block', params: { type } }] };
        const def = rt.moduleDef(owner).commands![type]!;
        let parsed: unknown;
        try {
          parsed = parseOrThrow(def.payload, payload, `command ${type} (from ${module})`);
        } catch (e) {
          if (e instanceof ValidationError) return { ok: false, reasons: [{ code: 'kernel.invalidPayload', severity: 'block', params: { issues: e.issues.join('; ') } }] };
          throw e;
        }
        rt.callers.push(module);
        try {
          return rt.runCommandTx(owner, () => def.handle(rt.ctx(owner), parsed));
        } finally {
          rt.callers.pop();
        }
      },
      reject(code: string, params?: Record<string, string | number>, remedies?: Remedy[]): never {
        if (rt.checkingRemedies) rt.checkRemedies(remedies, `rejection ${code}`);
        const b: Blocker = { code, severity: 'block' };
        if (params) b.params = params;
        if (remedies) b.remedies = remedies;
        throw new CommandRejection([b]);
      },
      log(level: LogEntry['level'], message: string, refs?: EntityId[]) {
        // the same line said again within a day folds into the last one, counted (Qwen S178/S179: one line a lorry, one each morning)
        const sameRefs = (e: LogEntry) => (e.refs ?? []).length === (refs ?? []).length && (e.refs ?? []).every((r, i) => r === refs![i]);
        for (let i = rt.logEntries.length - 1; i >= Math.max(0, rt.logEntries.length - 50); i -= 1) {
          const e = rt.logEntries[i]!;
          if (rt.now - e.t > DAY) break;
          if (e.module !== module || e.level !== level || (e.said ?? e.message) !== message || !sameRefs(e)) continue;
          const times = (e.times ?? 1) + 1;
          const since = e.since ?? e.t;
          const folded: LogEntry = { ...e, seq: (rt.logEntries.at(-1)?.seq ?? 0) + 1, t: rt.now, message: `${message} (${times}× since ${rt.calendar.format(since)})`, said: message, times, since };
          rt.logEntries.splice(i, 1);
          rt.logEntries.push(folded);
          rt.pushUndo(() => {
            const j = rt.logEntries.lastIndexOf(folded);
            if (j >= 0) rt.logEntries.splice(j, 1);
            rt.logEntries.splice(i, 0, e);
          });
          return;
        }
        const entry: LogEntry = { seq: (rt.logEntries.at(-1)?.seq ?? 0) + 1, t: rt.now, level, module, message };
        if (refs?.length) entry.refs = [...refs];
        rt.logEntries.push(entry);
        let dropped: LogEntry | undefined;
        if (rt.logEntries.length > rt.logLimit) dropped = rt.logEntries.shift();
        rt.pushUndo(() => {
          const i = rt.logEntries.lastIndexOf(entry);
          if (i >= 0) rt.logEntries.splice(i, 1);
          if (dropped) rt.logEntries.unshift(dropped);
        });
      },
    });
    const proc = {
      start(spec: ProcessStart) {
        if (!(spec.total > 0) || !Number.isFinite(spec.total)) throw new Error(`Process ${spec.kind}: total must be a positive finite number, got ${spec.total}`);
        const id = `proc-${++rt.procCounter}`;
        const p: ProcRec = {
          id,
          module,
          kind: spec.kind,
          unit: spec.unit,
          total: spec.total,
          done: 0,
          rate: Math.max(0, spec.rate ?? 0),
          status: spec.paused ? 'paused' : 'active',
          startedAt: rt.now,
          updatedAt: rt.now,
        };
        if (spec.subject) p.subject = spec.subject;
        if (spec.label) p.label = spec.label;
        if (spec.onComplete) {
          if (!rt.moduleDef(module).timers?.[spec.onComplete]) throw new Error(`Module ${module} has no timer ${spec.onComplete}`);
          p.onComplete = spec.onComplete;
        }
        if (spec.payload) p.payload = clone(spec.payload);
        if (spec.rateExplain) p.rateExplain = spec.rateExplain;
        if (spec.data !== undefined) p.data = clone(spec.data);
        rt.procs.set(id, p);
        rt.bump();
        rt.pushUndo(() => {
          rt.procs.delete(id);
          rt.procCounter -= 1;
        });
        rt.scheduleCompletion(p);
        return id;
      },
      setRate(id: string, rate: number, rateExplain?: ProcessView['rateExplain']) {
        const p = rt.ownProc(module, id);
        if (p.status === 'complete' || p.status === 'cancelled') return;
        const r = Math.max(0, Number.isFinite(rate) ? rate : 0);
        if (p.rate === r && !rateExplain) return;
        rt.snapshotProc(p);
        rt.integrate(p);
        p.rate = r;
        if (rateExplain) p.rateExplain = rateExplain;
        else delete p.rateExplain;
        rt.bump();
        rt.scheduleCompletion(p);
      },
      advance(id: string, amount: number) {
        const p = rt.ownProc(module, id);
        if (p.status === 'complete' || p.status === 'cancelled') return;
        rt.snapshotProc(p);
        rt.integrate(p);
        p.done = Math.max(0, Math.min(p.total, p.done + amount));
        rt.bump();
        rt.scheduleCompletion(p);
      },
      setTotal(id: string, total: number) {
        const p = rt.ownProc(module, id);
        if (!(total > 0)) throw new Error('process total must be > 0');
        rt.snapshotProc(p);
        rt.integrate(p);
        p.total = total;
        p.done = Math.min(p.done, total);
        rt.bump();
        rt.scheduleCompletion(p);
      },
      pause(id: string) {
        const p = rt.ownProc(module, id);
        if (p.status !== 'active') return;
        rt.snapshotProc(p);
        rt.integrate(p);
        p.status = 'paused';
        rt.bump();
        rt.scheduleCompletion(p);
      },
      resume(id: string, rate?: number) {
        const p = rt.ownProc(module, id);
        if (p.status !== 'paused') return;
        rt.snapshotProc(p);
        p.updatedAt = rt.now;
        p.status = 'active';
        if (rate !== undefined) p.rate = Math.max(0, rate);
        rt.bump();
        rt.scheduleCompletion(p);
      },
      cancel(id: string) {
        const p = rt.ownProc(module, id);
        if (p.status === 'complete' || p.status === 'cancelled') return;
        rt.snapshotProc(p);
        rt.integrate(p);
        p.status = 'cancelled';
        rt.bump();
        rt.scheduleCompletion(p);
      },
      patchData(id: string, data: unknown) {
        const p = rt.ownProc(module, id);
        rt.snapshotProc(p);
        p.data = clone(data);
        rt.bump();
      },
    };
    const ledger = {
      open(id: string, opts: { label: string; kind: LedgerAccount['kind']; unit?: string; holder?: EntityId }) {
        if (rt.accounts.has(id)) return;
        rt.accounts.set(id, { id, label: opts.label, kind: opts.kind, unit: opts.unit ?? 'EUR', balance: 0, ...(opts.holder ? { holder: opts.holder } : {}) });
        rt.pushUndo(() => rt.accounts.delete(id));
      },
      post(e: { from: string; to: string; amount: number; memo: string; category?: string; refs?: EntityId[] }) {
        const from = rt.accounts.get(e.from);
        const to = rt.accounts.get(e.to);
        if (!from || !to) throw new Error(`Ledger post between unknown accounts ${e.from} → ${e.to}`);
        if (from.unit !== to.unit) throw new Error(`Ledger post across units ${from.unit} → ${to.unit}`);
        if (!Number.isFinite(e.amount)) throw new Error(`Ledger amount must be finite (${e.memo})`);
        const amount = Math.round(e.amount * 100) / 100;
        if (amount === 0) return;
        from.balance = Math.round((from.balance - amount) * 100) / 100;
        to.balance = Math.round((to.balance + amount) * 100) / 100;
        const entry: LedgerEntry = { t: rt.now, from: e.from, to: e.to, amount, unit: from.unit, memo: e.memo, module };
        if (e.category) entry.category = e.category;
        if (e.refs?.length) entry.refs = [...e.refs];
        rt.entries.push(entry);
        rt.bump();
        rt.pushUndo(() => {
          from.balance = Math.round((from.balance + amount) * 100) / 100;
          to.balance = Math.round((to.balance - amount) * 100) / 100;
          rt.entries.pop();
        });
      },
    };
    const blockers = {
      set(subject: EntityId, list: Omit<Blocker, 'subject' | 'module'>[]) {
        if (rt.checkingRemedies) for (const b of list) rt.checkRemedies(b.remedies, `blocker ${b.code}`);
        const prevMap = rt.blockerMap.get(subject);
        const prevCopy = prevMap ? new Map(prevMap) : undefined; // keeps module order
        const subjectPred = prevMap ? Runtime.predecessor(rt.blockerMap, subject) : undefined;
        const prev = prevMap?.get(module);
        const next = list.map((b) => {
          const old = prev?.find((x) => x.code === b.code);
          const nb: Blocker = { ...b, subject, module, since: b.since ?? old?.since ?? rt.now };
          return rt.freeze(nb);
        });
        if (!prevMap && next.length === 0) return;
        const byMod = prevMap ?? new Map<string, Blocker[]>();
        if (next.length === 0) byMod.delete(module);
        else byMod.set(module, next);
        if (byMod.size === 0) rt.blockerMap.delete(subject);
        else if (!prevMap) rt.blockerMap.set(subject, byMod);
        rt.bump();
        rt.pushUndo(() => {
          if (prevMap && prevCopy) {
            prevMap.clear();
            for (const [k, v] of prevCopy) prevMap.set(k, v);
            if (!rt.blockerMap.has(subject)) Runtime.reinsert(rt.blockerMap, subject, prevMap, subjectPred);
          } else rt.blockerMap.delete(subject);
        });
      },
      clear(subject: EntityId) {
        blockers.set(subject, []);
      },
    };
    Object.defineProperty(ctx, 'proc', { value: proc });
    Object.defineProperty(ctx, 'ledger', { value: ledger });
    Object.defineProperty(ctx, 'blockers', { value: blockers });
    this.ctxCache.set(module, ctx);
    return ctx;
  }
}

export { explainToText };
