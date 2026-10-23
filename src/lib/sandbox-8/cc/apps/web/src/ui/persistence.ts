/** Save / load / autosave / new game. */
import { HOUR } from '../../../../packages/kernel/src/index.ts';
import type { Frame } from '../protocol.ts';
import { app, booting, logHistory, options, save, select, toast } from './state.ts';
import { cancelDraft } from './tools/road.ts';
import { cal, dateTime } from './format.ts';

const AUTOSAVE_KEY = 'cc.autosave';
const AUTOSAVE_EVERY = 6 * HOUR;

/** a save: the world definition (decision 0021) and the world's state */
interface SaveFile {
  app: 'constructible-city';
  version: 2;
  seed: number;
  world: unknown;
  t: number;
  savedAt: string;
  snapshot: unknown;
}

/** saves without a world definition come from an earlier version: no migration before the first release (decision 0019) */
function checkSave(data: unknown): SaveFile {
  const f = data as Partial<SaveFile> | null;
  if (!f || typeof f !== 'object' || !f.snapshot) throw new Error('not a Constructible City save file');
  if (f.version !== 2 || !f.world) throw new Error('this save comes from an earlier version of the game and cannot be loaded — please start a new game');
  return f as SaveFile;
}

function reset(): void {
  booting.value = true;
  select(null);
  cancelDraft();
  logHistory.value = [];
  lastAutosaveT = null;
}

/** Server mode: the world is shared with other players and agents; the server owns new games and saves. */
function serverOwnsWorld(): boolean {
  if (!app.client.remote) return false;
  toast('warn', 'The game server owns this world', 'Restart the server with --seed N for a new game or --load FILE to load a save (saves: ~/.local/share/constructible-city/saves).');
  return true;
}

export function newGame(seed: number, world?: string): void {
  if (serverOwnsWorld()) return;
  reset();
  app.seed = seed;
  save('seed', seed);
  app.client.init(seed, undefined, world);
}

export function restore(file: SaveFile): void {
  if (serverOwnsWorld()) return;
  reset();
  app.seed = file.seed;
  save('seed', file.seed);
  app.client.init(file.seed, file.snapshot, file.world);
  toast('success', 'Game loaded', `${dateTime(file.t)} · seed ${file.seed}`);
}

export async function downloadSnapshot(): Promise<void> {
  try {
    const saved = await app.client.snapshot();
    const t = app.client.frame?.t ?? 0;
    const file: SaveFile = { app: 'constructible-city', version: 2, ...saved, t, savedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const c = cal()?.at(t);
    const name = c ? `constructible-city-${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}.json` : 'constructible-city.json';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('success', 'Game saved', `${name} · ${(blob.size / 1e6).toFixed(1)} MB`);
  } catch (e) {
    toast('error', 'Save failed', (e as Error).message);
  }
}

export async function restoreFromFile(f: File): Promise<void> {
  try {
    restore(checkSave(JSON.parse(await f.text())));
  } catch (e) {
    toast('error', 'Load failed', (e as Error).message);
  }
}

export function autosaveInfo(): { t: number; seed: number } | null {
  try {
    const raw = localStorage.getItem(`${AUTOSAVE_KEY}.meta`);
    return raw ? (JSON.parse(raw) as { t: number; seed: number }) : null;
  } catch {
    return null;
  }
}

/** The autosave (or null). */
export function readAutosave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as SaveFile) : null;
  } catch {
    return null;
  }
}

export function loadAutosave(): void {
  const f = readAutosave();
  if (!f) return void toast('warn', 'No autosave found');
  try {
    restore(checkSave(f));
  } catch (e) {
    toast('error', 'Load failed', (e as Error).message);
  }
}

let lastAutosaveT: number | null = null;
let saving = false;
let warned = false;

async function autosave(t: number): Promise<void> {
  saving = true;
  try {
    const saved = await app.client.snapshot();
    const file: SaveFile = { app: 'constructible-city', version: 2, ...saved, t, savedAt: new Date().toISOString() };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(file));
    localStorage.setItem(`${AUTOSAVE_KEY}.meta`, JSON.stringify({ t, seed: app.seed }));
  } catch (e) {
    if (!warned) {
      warned = true;
      toast('warn', 'Autosave unavailable', `Browser storage refused the save (${(e as Error).name}). Use Save to file in the menu.`);
    }
  } finally {
    saving = false;
  }
}

export function onFrameAutosave(f: Frame): void {
  if (!options.peek().autosave || saving || app.client.remote) return;
  if (lastAutosaveT === null) {
    lastAutosaveT = f.t;
    return;
  }
  if (f.t - lastAutosaveT >= AUTOSAVE_EVERY) {
    lastAutosaveT = f.t;
    void autosave(f.t);
  }
}
