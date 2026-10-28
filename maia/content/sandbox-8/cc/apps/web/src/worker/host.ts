/**
 * SimHost — the transport-agnostic simulation host.
 *
 * Owns the Runtime, runs it in (scaled) real time, streams static patches and frames, answers
 * queries and dispatches commands. It does not know how messages travel: the browser wraps it
 * in a Web Worker (sim-worker.ts), the game server (apps/server) in WebSockets + MCP.
 *
 *   post(msg, transfer)  broadcast to every connected client (frames, static patches)
 *   reply(msg)           per-request answer (results, `ready` for a client that just joined)
 *
 * Every command is tagged with its actor ('human' | 'agent') and recorded in the action log
 * (last 200), which travels in frames so humans can watch what the agent does.
 */
import { DAY, Runtime, type Blocker, type Snapshot } from '../../../../packages/kernel/src/index.ts';
import { GOETTINGEN_CONTRACTOR, seatParty, settlementWorld, WORLDS } from '../../../../packages/settlement/src/index.ts';
import type { WorldDefinition } from '../../../../packages/world/src/index.ts';
import { PROPOSAL_VERDICTS, type ActionEntry, type Actor, type AgentNote, type AgentView, type Frame, type FromWorker, type ProposalSummary, type ProposalVerdict, type Query, type ToWorker, type WorldInfo } from '../protocol.ts';
import { buildFrame, buildStatic, inspect, ledger, overlay, pick, revisions, staticPatch, type Revisions } from './views.ts';

export type Post = (msg: FromWorker, transfer?: Transferable[]) => void;

export interface HostTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SimHostOptions {
  /** broadcast to all clients */
  post: Post;
  timers?: HostTimers;
  /**
   * 'local': one client (Web Worker); `init` (re)creates the world.
   * 'shared': the world outlives clients (server); `init` from a client only greets it with `ready`.
   */
  mode?: 'local' | 'shared';
  /** the agent may change the real-time speed */
  agentTime?: boolean;
  /** false while nobody listens — frames are then not built */
  active?: () => boolean;
  /** called whenever simulated time moved forward (autosave hook) */
  onTimeAdvanced?: (rt: Runtime) => void;
  /** creates a world (default: the settlement game) */
  create?: (seed: number, snapshot?: Snapshot, world?: WorldDefinition, inputs?: WorldInput[]) => Runtime;
  warn?: (msg: string) => void;
  /** every action of the agent or the human (with the command's full payload), for the session journal */
  onAction?: (entry: ActionEntry, payload?: unknown) => void;
  /** an internal error (a failing model, a failing request), for the session journal */
  /** something failed: inside the simulation or host (`internal`), or a client's request was refused (`request`) */
  onError?: (where: string, e: unknown, kind?: 'internal' | 'request') => void;
  /** a human judged an agent's remedy proposal (server mode; absent in the browser-only game) */
  onProposalVerdict?: (id: string, verdict: ProposalVerdict, comment: string | undefined, actor: Actor) => void;
}

export type FormattedBlocker = Blocker & { message: string };
export type DispatchOutcome = { ok: true; value: unknown } | { ok: false; reasons: FormattedBlocker[] };

export const ACTION_LOG_LIMIT = 200;
const NOTE_LIMIT = 50;

const defaultTimers: HostTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** New game: the settlement opens at the start of the first shift (Monday 07:00), not in the dark. */
export function createWorld(seed: number, snapshot?: Snapshot, world: WorldDefinition = GOETTINGEN_CONTRACTOR, inputs: WorldInput[] = []): Runtime {
  const { config } = settlementWorld({ world, seed });
  const rt = snapshot ? Runtime.restore(config, snapshot) : Runtime.create(config);
  // what the world definition's sources delivered before the world (re)started; days it has already
  // entered are refused by the modules themselves (the past is history)
  for (const i of inputs) {
    const r = rt.dispatchInput(i.type, i.payload);
    if (!r.ok) throw new Error(`world input ${i.type} refused: ${r.reasons.map((b) => rt.formatBlocker(b)).join('; ')}`);
  }
  if (!snapshot) rt.advance(rt.read.port('workforce').nextShiftStart(0));
  return rt;
}

/** a recorded input from the world definition's sources (decision 0016) */
export interface WorldInput {
  type: string;
  payload: unknown;
}

/** a world given by id (from the game's worlds) or as a definition; default: the contractor start */
export function worldOf(world: unknown): WorldDefinition {
  if (world === undefined || world === null) return GOETTINGEN_CONTRACTOR;
  if (typeof world === 'string') return WORLDS[world] ?? (() => { throw new Error(`unknown world '${world}'`); })();
  return world as WorldDefinition;
}

/** the worlds a new game can start in */
export const worldChoices = (): { id: string; label: string; description?: string }[] =>
  Object.values(WORLDS).map((w) => ({ id: w.id, label: w.label, ...(w.description ? { description: w.description } : {}) }));

/** what players are shown about the world they are in (decision 0021) */
export function worldInfo(world: WorldDefinition, seed: number): WorldInfo {
  const { definition, bound } = settlementWorld({ world, seed });
  return { id: definition.id, label: definition.label, ...(definition.description ? { description: definition.description } : {}), bound };
}

/** Short, human-readable summary of a command payload for the action log. */
export function summarizePayload(payload: unknown, max = 160): string {
  const fmt = (v: unknown, depth: number): string => {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 37)}…` : v;
    if (typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      if (v.length && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'))) return `${v.length} pts`;
      if (v.length === 2 && v.every((n) => typeof n === 'number')) return `[${fmt(v[0], depth)}, ${fmt(v[1], depth)}]`;
      if (depth > 1) return `[${v.length}]`;
      return `[${v.slice(0, 4).map((x) => fmt(x, depth + 1)).join(', ')}${v.length > 4 ? ', …' : ''}]`;
    }
    if (typeof v === 'object') {
      if (depth > 1) return '{…}';
      return Object.entries(v as Record<string, unknown>)
        .map(([k, x]) => `${k}: ${fmt(x, depth + 1)}`)
        .join(', ');
    }
    return String(v);
  };
  const s = fmt(payload, 0);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function transferablesOf(patch: Record<string, unknown>): Transferable[] {
  const out: Transferable[] = [];
  const walk = (v: unknown) => {
    if (ArrayBuffer.isView(v)) out.push((v as ArrayBufferView).buffer as ArrayBuffer);
    else if (v && typeof v === 'object' && !Array.isArray(v)) for (const x of Object.values(v)) if (ArrayBuffer.isView(x)) out.push((x as ArrayBufferView).buffer as ArrayBuffer);
  };
  for (const v of Object.values(patch)) walk(v);
  return out;
}

export class SimHost {
  private runtime: Runtime | null = null;
  private last: Revisions | null = null;
  private lastTick = 0;
  private lastFrame = -1e9;
  private dirty = true;
  private timer: unknown = null;
  private readonly timers: HostTimers;
  private readonly post: Post;
  readonly mode: 'local' | 'shared';
  seed = 1;
  speed = 0;
  /** the definition of the world being played (decision 0021): part of every save */
  world: WorldDefinition = GOETTINGEN_CONTRACTOR;
  /** the data source the world is waiting for, if any (decision 0022) */
  waiting: string | null = null;

  private actionSeq = 0;
  private actionsRev = 0;
  private sentActionsRev = -1;
  private agentRev = 0;
  private sentAgentRev = -1;
  readonly actions: ActionEntry[] = [];
  readonly notes: AgentNote[] = [];
  /** remedy proposals filed by the agent (server mode: kept by the server's proposal store) */
  proposals: ProposalSummary[] = [];
  agentPaused = false;
  agentConnected = false;
  agentBusy: string | undefined;
  agentTime: boolean;

  constructor(private readonly opts: SimHostOptions) {
    this.post = opts.post;
    this.timers = opts.timers ?? defaultTimers;
    this.mode = opts.mode ?? 'local';
    this.agentTime = Boolean(opts.agentTime);
  }

  // ------------------------------------------------------------------ lifecycle

  get ready(): boolean {
    return this.runtime !== null;
  }

  /** The live runtime (throws before init). Read freely; write only through dispatch(). */
  get rt(): Runtime {
    if (!this.runtime) throw new Error('not initialised');
    return this.runtime;
  }

  /** Create (or restore) the world and broadcast `ready`. */
  init(seed: number, snapshot?: Snapshot, world: WorldDefinition = GOETTINGEN_CONTRACTOR, inputs: WorldInput[] = []): void {
    this.seed = seed;
    this.world = world;
    this.runtime = (this.opts.create ?? createWorld)(seed, snapshot, world, inputs);
    this.waiting = this.runtime.dataWait()?.reason ?? null;
    this.last = revisions(this.runtime.read);
    this.lastTick = this.timers.now();
    this.dirty = true;
    // nobody listening yet (server start): clients get `ready` when they join
    if (!this.opts.active || this.opts.active()) this.post(...this.readyMessage());
  }

  /** `ready` for a client that (re)joins: the full static world plus a full frame. */
  readyMessage(): [FromWorker, Transferable[]] {
    const rt = this.rt;
    const world = buildStatic(rt, worldInfo(this.world, this.seed), worldChoices());
    const msg: FromWorker = { type: 'ready', world, frame: this.frame(true) };
    return [msg, [world.heights.buffer as ArrayBuffer, world.groundColors.buffer as ArrayBuffer, world.trees.data.buffer as ArrayBuffer]];
  }

  /** Start the real-time loop (50 ms ticks). */
  start(): void {
    if (this.timer !== null) return;
    this.lastTick = this.timers.now();
    const loop = () => {
      try {
        this.tick();
      } catch (e) {
        // a failing model is a bug: stop the clock (the world stays consistent) and tell the clients
        const err = e as Error;
        this.speed = 0;
        this.dirty = true;
        this.opts.warn?.(`[sim] ${err.stack ?? err.message}`);
        this.opts.onError?.('real-time tick', err);
        this.post({ type: 'error', message: `${err.message}\n${err.stack ?? ''}` });
      }
      this.timer = this.timers.setTimeout(loop, 50);
    };
    this.timer = this.timers.setTimeout(loop, 50);
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = this.timers.now();
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const rt = this.runtime;
    if (!rt) return;
    if (this.speed > 0) {
      const t0 = this.timers.now();
      const r = rt.advance(rt.now + this.speed * dt);
      this.noteWait(r.waiting);
      const cost = this.timers.now() - t0;
      // if the simulation cannot keep up, it simply runs slower than requested (never skips work)
      if (cost > 200) this.opts.warn?.(`[sim] advancing ${(this.speed * dt) / 60} sim-min took ${cost.toFixed(0)} ms`);
      this.dirty = true;
      this.opts.onTimeAdvanced?.(rt);
    }
    if ((this.dirty || now - this.lastFrame > 500) && now - this.lastFrame > 90) this.sendFrame();
  }

  // ------------------------------------------------------------------ frames

  /** A frame; `full` always carries the action log and agent view (for `ready`). */
  frame(full = false): Frame {
    const f = buildFrame(this.rt, this.speed);
    if (this.waiting) f.dataWait = this.waiting;
    const validity = this.rt.read.validity();
    if (validity.length) f.validity = validity.map((n) => n.reason);
    if (full || this.sentActionsRev !== this.actionsRev) {
      f.actions = this.actions.slice();
      if (!full) this.sentActionsRev = this.actionsRev;
    }
    if (full || this.sentAgentRev !== this.agentRev) {
      f.agent = this.agentView();
      if (!full) this.sentAgentRev = this.agentRev;
    }
    return f;
  }

  agentView(): AgentView {
    const v: AgentView = { remote: this.mode === 'shared', connected: this.agentConnected, paused: this.agentPaused, agentTime: this.agentTime, notes: this.notes.slice() };
    if (this.agentBusy) v.busy = this.agentBusy;
    if (this.proposals.length) v.proposals = this.proposals.slice();
    return v;
  }

  /** Broadcast pending static patches and a frame now. */
  sendFrame(): void {
    if (!this.runtime) return;
    if (this.opts.active && !this.opts.active()) {
      this.dirty = false;
      return;
    }
    const patch = staticPatch(this.runtime, this.last!);
    if (patch) this.post({ type: 'static', patch }, transferablesOf(patch as Record<string, unknown>));
    this.post({ type: 'frame', frame: this.frame() });
    this.lastFrame = this.timers.now();
    this.dirty = false;
  }

  /** Mark state changed; the next tick sends a frame. */
  touch(): void {
    this.dirty = true;
  }

  // ------------------------------------------------------------------ time

  setSpeed(speed: number): void {
    this.speed = Math.max(0, Number.isFinite(speed) ? speed : 0);
    this.dirty = true;
    this.agentRev += 1;
  }

  skip(to: 'shiftStart' | 'nextDay' | 'nextWeek'): void {
    const rt = this.rt;
    const wf = rt.read.port('workforce');
    const target = to === 'shiftStart' ? wf.nextShiftStart(rt.now + 1) : to === 'nextDay' ? (Math.floor(rt.now / DAY) + 1) * DAY : (Math.floor(rt.now / DAY) + 7) * DAY;
    this.advanceTo(target);
    this.sendFrame();
  }

  /** Advance simulated time (paused-mode stepping by tools and agents). */
  advanceTo(t: number): void {
    const rt = this.rt;
    if (t <= rt.now) return;
    this.noteWait(rt.advance(t).waiting);
    this.dirty = true;
    this.opts.onTimeAdvanced?.(rt);
  }

  /** a data horizon reached: time stalls there until data arrive, and every client sees why (decision 0022) */
  private noteWait(waiting: { reason: string } | undefined): void {
    const reason = waiting?.reason ?? null;
    if (reason && reason !== this.waiting) this.opts.warn?.(`[sim] ${reason}`);
    this.waiting = reason;
  }

  // ------------------------------------------------------------------ commands & queries

  /**
   * A recorded input from the world definition's sources (a feed, an external model) — the host's
   * path for what players cannot do (decisions 0016, 0021). Logged in the world's command log.
   */
  input(type: string, payload: unknown): ReturnType<Runtime['dispatchInput']> {
    const r = this.rt.dispatchInput(type, payload);
    this.waiting = this.rt.dataWait()?.reason ?? null;
    this.dirty = true;
    return r;
  }

  /** Dispatch a command for an actor; records it in the action log and broadcasts a frame. */
  dispatch(command: string, payload: unknown, actor: Actor, note?: string): DispatchOutcome {
    const rt = this.rt;
    const r = rt.dispatch(command, payload);
    const out: DispatchOutcome = r.ok ? { ok: true, value: r.value } : { ok: false, reasons: r.reasons.map((b) => ({ ...b, message: rt.formatBlocker(b) })) };
    const entry: Omit<ActionEntry, 'seq' | 't' | 'at'> = { actor, command, summary: summarizePayload(payload), ok: out.ok };
    if (!out.ok) entry.reasons = out.reasons.map((b) => b.message);
    if (note) entry.note = note;
    this.logAction(entry, payload);
    this.dirty = true;
    this.sendFrame();
    return out;
  }

  /** Record a non-command action (e.g. the agent advancing time, the human pausing the agent). */
  logAction(entry: Omit<ActionEntry, 'seq' | 't' | 'at'>, payload?: unknown): ActionEntry {
    const full: ActionEntry = { seq: ++this.actionSeq, t: this.runtime?.now ?? 0, at: Date.now(), ...entry };
    this.opts.onAction?.(full, payload);
    this.actions.push(full);
    if (this.actions.length > ACTION_LOG_LIMIT) this.actions.splice(0, this.actions.length - ACTION_LOG_LIMIT);
    this.actionsRev += 1;
    this.dirty = true;
    return full;
  }

  postNote(text: string): AgentNote {
    const n: AgentNote = { seq: this.notes.length ? this.notes[this.notes.length - 1]!.seq + 1 : 1, t: this.runtime?.now ?? 0, text, at: Date.now() };
    this.notes.push(n);
    if (this.notes.length > NOTE_LIMIT) this.notes.splice(0, this.notes.length - NOTE_LIMIT);
    this.agentRev += 1;
    this.dirty = true;
    return n;
  }

  setAgentPaused(paused: boolean, actor: Actor = 'human'): void {
    if (this.agentPaused === paused) return;
    this.agentPaused = paused;
    this.agentRev += 1;
    this.logAction({ actor, command: paused ? 'agent.pause' : 'agent.resume', summary: paused ? 'agent paused by the human' : 'agent may act again', ok: true });
    this.sendFrame();
  }

  setAgentConnected(connected: boolean): void {
    if (this.agentConnected === connected) return;
    this.agentConnected = connected;
    this.agentRev += 1;
    this.dirty = true;
  }

  /** Replace the proposal list shown in the Agent panel (the server's proposal store owns it). */
  setProposals(list: ProposalSummary[]): void {
    this.proposals = list;
    this.agentRev += 1;
    this.dirty = true;
  }

  setAgentBusy(text: string | undefined): void {
    if (this.agentBusy === text) return;
    this.agentBusy = text;
    this.agentRev += 1;
    this.dirty = true;
  }

  query(q: Query): unknown {
    const rt = this.rt;
    switch (q.kind) {
      case 'projection':
        // the seat's view: projections about one party's books are about the seat's party unless asked otherwise
        // the seat's view: what its party may know (design/physical-state.md I7)
        return rt.project(q.name, { ...(q.args ?? {}), party: seatParty(rt.read) });
      case 'roadPreview':
        return rt.read.port('roads').design(q.points, q.classId);
      case 'inspect':
        return inspect(rt, q.id);
      case 'schedule':
        return rt.read.port('production').schedule(q.project);
      case 'ledger':
        return ledger(rt, q.since);
      case 'pick':
        return pick(rt, q.x, q.z, q.radius);
      case 'heightAt':
        return q.points.map(([x, z]) => rt.read.port('terrain').heightAt(x, z));
      case 'overlay':
        return overlay(rt, q.layer, q.goal);
      case 'structurePreview':
        return rt.read.port('structures').plan(q.spec);
      case 'offers':
        return rt.read.port('trade').offers(q.material);
    }
  }

  snapshot(): Snapshot {
    return this.rt.snapshot();
  }

  // ------------------------------------------------------------------ protocol

  /**
   * Handle a protocol message from a client. `reply` answers that client only (defaults to the
   * broadcast). The transport decides the actor — a client cannot claim to be someone else.
   */
  handle(msg: ToWorker, actor: Actor, reply: Post = this.post): void {
    try {
      switch (msg.type) {
        case 'init':
          if (this.mode === 'shared' && this.runtime) reply(...this.readyMessage());
          else if (this.mode === 'shared') throw new Error('the server has no world yet');
          else this.init(msg.seed, msg.snapshot as Snapshot | undefined, worldOf(msg.world));
          break;
        case 'speed':
          this.setSpeed(msg.speed);
          break;
        case 'skip':
          if (this.runtime) this.skip(msg.to);
          break;
        case 'dispatch': {
          const r = this.dispatch(msg.command, msg.payload, actor);
          reply(r.ok ? { type: 'result', id: msg.id, ok: true, result: r.value, actor } : { type: 'result', id: msg.id, ok: false, result: r.reasons, actor });
          break;
        }
        case 'query':
          reply({ type: 'result', id: msg.id, ok: true, result: this.query(msg.query) });
          break;
        case 'snapshot':
          // a save needs the world definition too: a measured world cannot be restored as a generated one
          reply({ type: 'result', id: msg.id, ok: true, result: this.runtime ? { seed: this.seed, world: this.world, snapshot: this.runtime.snapshot() } : undefined });
          break;
        case 'agentPause':
          this.setAgentPaused(Boolean(msg.paused), actor);
          break;
        case 'proposalVerdict':
          if (!this.opts.onProposalVerdict) throw new Error('Remedy proposals are reviewed in the game server (npm run server), not in the browser-only game.');
          if (actor !== 'human') throw new Error('Only a human judges proposals.');
          if (!PROPOSAL_VERDICTS.includes(msg.verdict)) throw new Error(`verdict must be one of ${PROPOSAL_VERDICTS.join(', ')}`);
          this.opts.onProposalVerdict(String(msg.proposal), msg.verdict, typeof msg.comment === 'string' && msg.comment.trim() ? msg.comment.trim().slice(0, 2000) : undefined, actor);
          break;
      }
    } catch (e) {
      const err = e as Error;
      this.opts.onError?.(`client message ${msg.type}`, err, 'request');
      if ('id' in msg) reply({ type: 'result', id: (msg as { id: number }).id, ok: false, error: err.message });
      else reply({ type: 'error', message: `${err.message}\n${err.stack ?? ''}` });
    }
  }
}
