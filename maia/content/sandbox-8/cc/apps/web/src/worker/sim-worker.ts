/// <reference lib="webworker" />
/**
 * Simulation worker: a thin Web Worker adapter around SimHost (host.ts). The host owns the
 * Runtime, advances it in (scaled) real time and streams read models to the UI. The UI thread
 * never blocks the simulation and cannot reach into it. In the browser the only actor is the
 * human.
 */
import type { ToWorker } from '../protocol.ts';
import { SimHost } from './host.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;

const host = new SimHost({
  mode: 'local',
  post: (msg, transfer = []) => scope.postMessage(msg, transfer),
  warn: (msg) => console.warn(msg),
});

scope.onmessage = (ev: MessageEvent<ToWorker>) => host.handle(ev.data, 'human');

host.start();
