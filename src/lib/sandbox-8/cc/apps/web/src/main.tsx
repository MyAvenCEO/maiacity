/**
 * Browser entry: boots the simulation worker, the 3D scene and the Preact UI, and wires the
 * worker streams (world / patches / frames) into both.
 */
import { render } from 'preact';
import type { LogEntry } from '../../../packages/kernel/src/index.ts';
import { SimClient } from './client.ts';
import { createScene } from './render/scene.ts';
import { App } from './ui/App.tsx';
import { setCalendar } from './ui/format.ts';
import { onFrameAutosave, readAutosave } from './ui/persistence.ts';
import { app, booting, fatal, frame, load, logHistory, options, save, toast, world, worldRev } from './ui/state.ts';
import { installController } from './ui/tools/controller.ts';

const root = document.getElementById('app')!;
root.innerHTML = '';
const sceneEl = document.createElement('div');
sceneEl.id = 'scene';
const uiEl = document.createElement('div');
uiEl.id = 'ui';
root.append(sceneEl, uiEl);

const params = new URLSearchParams(location.search);
const client = new SimClient();
const scene = createScene(sceneEl);
app.client = client;
app.scene = scene;
{
  const { worldLabels: _w, autosave: _a, ...sceneOpts } = options.peek();
  scene.setOptions(sceneOpts);
}

// ------------------------------------------------------------------ log → toasts
let seenLog = new Set<string>();
let logPrimed = false;
const logKey = (e: LogEntry) => `${e.t}|${e.module}|${e.message}`;
function onLog(entries: LogEntry[]): void {
  const fresh: LogEntry[] = [];
  for (const e of entries) {
    const k = logKey(e);
    if (seenLog.has(k)) continue;
    seenLog.add(k);
    fresh.push(e);
  }
  if (seenLog.size > 5000) seenLog = new Set([...seenLog].slice(-2000));
  if (!fresh.length) return;
  logHistory.value = [...logHistory.peek(), ...fresh].slice(-1000);
  if (!logPrimed) return;
  for (const e of fresh.slice(-4)) {
    if (e.level === 'warn' || e.level === 'success' || e.level === 'error') toast(e.level, e.message, undefined, e.refs);
  }
}

// ------------------------------------------------------------------ streams
let resumedFromAutosave = false;
client.onWorld((w) => {
  setCalendar(w.calendar.epochDay, w.calendar.locale);
  scene.setWorld(w);
  world.value = { ...w };
  worldRev.value += 1;
  booting.value = false;
  fatal.value = null;
  logPrimed = false;
  seenLog = new Set();
  resumedFromAutosave = false;
});
client.onPatch((p) => {
  scene.applyPatch(p);
  if (client.world) world.value = { ...client.world };
  worldRev.value += 1;
});
client.onFrame((f) => {
  scene.setFrame(f);
  frame.value = f;
  onLog(f.log);
  logPrimed = true;
  onFrameAutosave(f);
});
client.onError((msg) => {
  if (booting.peek() && resumedFromAutosave) {
    // an autosave from an incompatible build: start fresh instead
    resumedFromAutosave = false;
    toast('warn', 'Autosave could not be restored', 'Starting a new game instead.');
    client.init(app.seed);
    return;
  }
  if (booting.peek()) fatal.value = msg;
  else toast('error', 'Simulation error', msg.split('\n')[0]);
});

client.onStatus((connected) => {
  if (connected) toast('success', 'Reconnected to the game server');
  else toast('warn', 'Connection to the game server lost', 'Reconnecting…');
});

// ------------------------------------------------------------------ boot
const seedParam = Number(params.get('seed'));
app.seed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : load('seed', 2027);
save('seed', app.seed);
// server mode: the server owns the world (and its saves); the browser only joins it
const auto = client.remote || params.has('fresh') || params.has('seed') ? null : readAutosave();
if (auto && auto.snapshot) {
  resumedFromAutosave = true;
  app.seed = auto.seed;
  client.init(auto.seed, auto.snapshot);
} else {
  client.init(app.seed);
}

installController(sceneEl);
render(<App />, uiEl);

(window as unknown as { __cc: unknown }).__cc = { client, scene, app };
