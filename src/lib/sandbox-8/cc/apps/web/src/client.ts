/**
 * UI-side wrapper around the simulation: request/response with promises, plus reactive streams
 * of the static world and frames.
 *
 * One client, two transports speaking the same protocol (protocol.ts):
 *   - WorkerTransport: the simulation runs in a Web Worker in this tab (dist/index.html)
 *   - SocketTransport: the simulation runs in the game server (apps/server) shared with other
 *     browsers and AI agents; messages travel over a WebSocket (wire.ts)
 */
import type { CommandResult } from '../../../packages/kernel/src/index.ts';
import type { ActionEntry, AgentView, Frame, FromWorker, ProposalVerdict, Query, StaticWorld, ToWorker } from './protocol.ts';
import { decodeMessage } from './wire.ts';

declare const __WORKER_SOURCE__: string;
declare const __REMOTE__: boolean;

type Listener<T> = (v: T) => void;

export interface Transport {
  /** the simulation is hosted elsewhere (server mode) */
  readonly remote: boolean;
  send(msg: ToWorker): void;
  onMessage(l: (msg: FromWorker) => void): void;
  onError(l: (message: string) => void): void;
  /** connection lost / restored (remote only) */
  onStatus?(l: (connected: boolean) => void): void;
}

export class WorkerTransport implements Transport {
  readonly remote = false;
  private worker: Worker;
  constructor(source: string = __WORKER_SOURCE__) {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    this.worker = new Worker(url);
  }
  send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }
  onMessage(l: (msg: FromWorker) => void): void {
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => l(ev.data);
  }
  onError(l: (message: string) => void): void {
    this.worker.onerror = (ev) => l(ev.message);
  }
}

/** WebSocket to the game server; reconnects and re-sends the last `init` after a drop. */
export class SocketTransport implements Transport {
  readonly remote = true;
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private lastInit: ToWorker | null = null;
  private messageListener: (msg: FromWorker) => void = () => {};
  private errorListener: (message: string) => void = () => {};
  private statusListener: (connected: boolean) => void = () => {};
  private connected = false;
  private everConnected = false;

  constructor(private readonly url: string) {
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.everConnected = true;
      this.statusListener(true);
      if (this.lastInit && !this.queue.some((m) => m.includes('"type":"init"'))) ws.send(JSON.stringify(this.lastInit));
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
      try {
        const msg = typeof ev.data === 'string' ? (JSON.parse(ev.data) as FromWorker) : decodeMessage<FromWorker>(ev.data);
        this.messageListener(msg);
      } catch (e) {
        this.errorListener(`bad message from server: ${(e as Error).message}`);
      }
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      if (was) this.statusListener(false);
      if (!this.everConnected) this.errorListener(`Cannot reach the game server at ${this.url}`);
      setTimeout(() => this.connect(), 1000);
    };
  }

  send(msg: ToWorker): void {
    if (msg.type === 'init') this.lastInit = { type: 'init', seed: msg.seed };
    const text = JSON.stringify(msg);
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else this.queue.push(text);
  }
  onMessage(l: (msg: FromWorker) => void): void {
    this.messageListener = l;
  }
  onError(l: (message: string) => void): void {
    this.errorListener = l;
  }
  onStatus(l: (connected: boolean) => void): void {
    this.statusListener = l;
  }
}

/** The transport this build uses: the server build (`build.mjs --remote`) talks WebSocket. */
export function defaultTransport(): Transport {
  if (typeof __REMOTE__ !== 'undefined' && __REMOTE__) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new SocketTransport(`${proto}//${location.host}/ws`);
  }
  return new WorkerTransport();
}

export class SimClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; raw?: boolean }>();
  private worldListeners: Listener<StaticWorld>[] = [];
  private patchListeners: Listener<Partial<StaticWorld>>[] = [];
  private frameListeners: Listener<Frame>[] = [];
  private errorListeners: Listener<string>[] = [];
  private statusListeners: Listener<boolean>[] = [];
  world: StaticWorld | null = null;
  frame: Frame | null = null;
  /** latest action log / agent view (frames carry them only when they change) */
  actions: ActionEntry[] = [];
  agent: AgentView | null = null;
  /** connected to the transport (always true for the worker) */
  connected = true;
  readonly remote: boolean;
  private readonly transport: Transport;

  constructor(transport: Transport = defaultTransport()) {
    this.transport = transport;
    this.remote = transport.remote;
    transport.onMessage((msg) => this.receive(msg));
    transport.onError((m) => this.errorListeners.forEach((l) => l(m)));
    transport.onStatus?.((c) => {
      this.connected = c;
      if (!c) {
        for (const p of this.pending.values()) p.reject(new Error('connection to the game server lost'));
        this.pending.clear();
      }
      this.statusListeners.forEach((l) => l(c));
    });
  }

  private send(msg: ToWorker): void {
    this.transport.send(msg);
  }

  private completeFrame(f: Frame): Frame {
    if (f.actions) this.actions = f.actions;
    else f.actions = this.actions;
    if (f.agent) this.agent = f.agent;
    else if (this.agent) f.agent = this.agent;
    return f;
  }

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case 'ready':
        this.world = msg.world;
        this.frame = this.completeFrame(msg.frame);
        this.worldListeners.forEach((l) => l(msg.world));
        this.frameListeners.forEach((l) => l(msg.frame));
        break;
      case 'static':
        if (this.world) Object.assign(this.world, msg.patch);
        this.patchListeners.forEach((l) => l(msg.patch));
        break;
      case 'frame':
        this.frame = this.completeFrame(msg.frame);
        this.frameListeners.forEach((l) => l(msg.frame));
        break;
      case 'result': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(p.raw ? msg : msg.result);
        break;
      }
      case 'error':
        console.error('[sim]', msg.message);
        this.errorListeners.forEach((l) => l(msg.message));
        break;
    }
  }

  init(seed: number, snapshot?: unknown, world?: unknown): void {
    this.send({ type: 'init', seed, ...(snapshot ? { snapshot } : {}), ...(world ? { world } : {}) });
  }

  setSpeed(simSecondsPerSecond: number): void {
    this.send({ type: 'speed', speed: simSecondsPerSecond });
  }

  skip(to: 'shiftStart' | 'nextDay' | 'nextWeek'): void {
    this.send({ type: 'skip', to });
  }

  /** Server mode: pause / resume the AI agent (its world-changing tools are refused while paused). */
  setAgentPaused(paused: boolean): void {
    this.send({ type: 'agentPause', paused });
  }

  /** Server mode: the human's verdict on an agent's remedy proposal (stored in the proposal record). */
  setProposalVerdict(id: string, verdict: ProposalVerdict, comment?: string): void {
    this.send(comment ? { type: 'proposalVerdict', proposal: id, verdict, comment } : { type: 'proposalVerdict', proposal: id, verdict });
  }

  /** Dispatch a command; resolves to the kernel CommandResult (rejections carry formatted messages). */
  dispatch<R = unknown>(command: string, payload: unknown): Promise<CommandResult<R> & { reasons?: { message: string }[] }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (m) => {
          const msg = m as { ok: boolean; result: unknown };
          resolve((msg.ok ? { ok: true, value: msg.result } : { ok: false, reasons: msg.result }) as never);
        },
        reject,
        raw: true,
      });
      this.send({ type: 'dispatch', id, command, payload });
    });
  }

  query<T = unknown>(query: Query): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ type: 'query', id, query });
    });
  }

  /** the world as saved: seed, world definition and snapshot */
  snapshot(): Promise<{ seed: number; world: unknown; snapshot: unknown }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ type: 'snapshot', id });
    });
  }

  onWorld(l: Listener<StaticWorld>): () => void {
    this.worldListeners.push(l);
    if (this.world) l(this.world);
    return () => (this.worldListeners = this.worldListeners.filter((x) => x !== l));
  }
  onPatch(l: Listener<Partial<StaticWorld>>): () => void {
    this.patchListeners.push(l);
    return () => (this.patchListeners = this.patchListeners.filter((x) => x !== l));
  }
  onFrame(l: Listener<Frame>): () => void {
    this.frameListeners.push(l);
    if (this.frame) l(this.frame);
    return () => (this.frameListeners = this.frameListeners.filter((x) => x !== l));
  }
  onError(l: Listener<string>): () => void {
    this.errorListeners.push(l);
    return () => (this.errorListeners = this.errorListeners.filter((x) => x !== l));
  }
  /** connection status changes (server mode) */
  onStatus(l: Listener<boolean>): () => void {
    this.statusListeners.push(l);
    return () => (this.statusListeners = this.statusListeners.filter((x) => x !== l));
  }
}
