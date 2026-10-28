import { equipmentFocusDistance } from '../render/item-assets.ts';
/**
 * UI state: signals shared by panels and tools. The simulation state itself lives in the
 * worker — here we only keep the latest frame/world we received plus purely UI state.
 */
import type { Candidate, Goal } from '../../../../packages/siting/src/index.ts';
import { batch, signal } from '@preact/signals';
import type { SimClient } from '../client.ts';
import type { SceneView, SceneOptions } from '../render/api.ts';
import type { Frame, OverlayLayer, StaticWorld } from '../protocol.ts';
import type { Explained } from '../../../../packages/kernel/src/index.ts';
import type { LogEntry } from '../../../../packages/kernel/src/index.ts';

// ------------------------------------------------------------------ services

export const app = {
  client: null as unknown as SimClient,
  scene: null as unknown as SceneView,
  seed: 2027,
};

// ------------------------------------------------------------------ persistence helpers

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`cc.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(`cc.${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ simulation mirrors

export const world = signal<StaticWorld | null>(null);
/** bumps whenever the static world is patched (world object is mutated in place by the client) */
export const worldRev = signal(0);
export const frame = signal<Frame | null>(null);
export const booting = signal(true);
export const fatal = signal<string | null>(null);
/** speed to restore when un-pausing */
export const lastSpeed = signal<number>(load('lastSpeed', 3600));
/** accumulated log (frame.log only carries the last 40 entries) */
export const logHistory = signal<LogEntry[]>([]);

// ------------------------------------------------------------------ tools & selection

export type ToolId = 'select' | 'road' | 'building' | 'inspect' | 'moveTarget';
export const tool = signal<ToolId>('select');
/** machine waiting for a move-to target click */
export const moveTargetFor = signal<string | null>(null);

export interface Selection {
  id: string;
  kind?: string;
}
export const selection = signal<Selection | null>(null);
/** the entity the camera follows (the inspector's Follow box), if any */
export const following = signal<string | null>(null);

/** follow an entity with the camera, or stop (null) */
export function follow(id: string | null): void {
  following.value = id;
  app.scene?.follow(id);
  if (id) focusEntity(id);
}
export const hoverId = signal<string | null>(null);
/** inspector section to reveal (e.g. 'condition' after using the inspect tool) */
export const inspectorFocus = signal<string | null>(null);

export const overlay = signal<OverlayLayer>('none');
/** the Scout panel: where is a good place, for what? */
export const scoutOpen = signal(false);
/** the goal being edited in the Scout panel (shown as the `goal:custom` overlay) */
export const scoutGoal = signal<Goal | null>(null);
/** the best places found for it (pinned on the map) */
export const scoutPlaces = signal<Candidate[]>([]);
export const OVERLAYS: { id: OverlayLayer; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'No overlay' },
  { id: 'slope', label: 'Slope', hint: 'Terrain slope in % (steep ground limits grades and raises earthworks)' },
  { id: 'soil', label: 'Soil', hint: 'Subsoil class at 0.8 m (frost susceptibility, excavation class)' },
  { id: 'moisture', label: 'Moisture', hint: 'Soil moisture relative to field capacity (trafficability)' },
  { id: 'frost', label: 'Frost', hint: 'Current frost penetration depth' },
  { id: 'condition', label: 'Condition', hint: 'Road condition grades (ZEB) from the last inspections' },
  { id: 'traffic', label: 'Traffic', hint: 'Traffic volume on roads' },
];

// ------------------------------------------------------------------ layout

export type DrawerTab = 'projects' | 'buildings' | 'workforce' | 'fleet' | 'materials' | 'finance' | 'log' | 'alerts';
export const DRAWER_TABS: { id: DrawerTab; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'workforce', label: 'Workforce' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'materials', label: 'Materials' },
  { id: 'finance', label: 'Finance' },
  { id: 'log', label: 'Log' },
  { id: 'alerts', label: 'Alerts' },
];
export const drawerOpen = signal<boolean>(load('drawerOpen', false));
export const drawerTab = signal<DrawerTab>(load('drawerTab', 'projects'));
export const drawerHeight = signal<number>(load('drawerHeight', 280));
export const helpOpen = signal(false);
export const menuOpen = signal(false);
export const onboardingDismissed = signal<boolean>(load('onboardingDismissed', false));

export function openDrawer(tab: DrawerTab): void {
  batch(() => {
    drawerTab.value = tab;
    drawerOpen.value = true;
  });
  save('drawerTab', tab);
  save('drawerOpen', true);
}

// ------------------------------------------------------------------ options

export interface UiOptions extends SceneOptions {
  /** HTML labels over the world (work fronts, blocked badges, machine names) */
  worldLabels: boolean;
  autosave: boolean;
}
export const options = signal<UiOptions>({
  shadows: true,
  realLighting: true,
  showTrees: true,
  showLabels: true,
  worldLabels: true,
  autosave: true,
  ...load<Partial<UiOptions>>('options', {}),
});
export function setOption<K extends keyof UiOptions>(k: K, v: UiOptions[K]): void {
  options.value = { ...options.value, [k]: v };
  save('options', options.value);
  const { worldLabels: _w, autosave: _a, ...scene } = options.value;
  app.scene?.setOptions(scene);
}

// ------------------------------------------------------------------ popovers & toasts

export interface ExplainPopover {
  tree: Explained;
  title?: string;
  x: number;
  y: number;
}
export const explainPopover = signal<ExplainPopover | null>(null);

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error' | 'success';
  title: string;
  body?: string;
  refs?: string[];
  at: number;
}
export const toasts = signal<Toast[]>([]);
let toastSeq = 1;
export function toast(level: Toast['level'], title: string, body?: string, refs?: string[]): void {
  const t: Toast = { id: toastSeq++, level, title, at: Date.now() };
  if (body) t.body = body;
  if (refs?.length) t.refs = refs;
  toasts.value = [...toasts.value.slice(-4), t];
  const ttl = level === 'error' ? 9000 : level === 'warn' ? 7000 : 4500;
  setTimeout(() => dismissToast(t.id), ttl);
}
export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((x) => x.id !== id);
}

// ------------------------------------------------------------------ actions

/** Select an entity (from scene or table) and optionally fly to it. */
export function select(id: string | null, kind?: string, opts: { focus?: boolean } = {}): void {
  selection.value = id ? (kind ? { id, kind } : { id }) : null;
  app.scene?.setSelection(id);
  // (the camera follows what is selected only: another selection, or none, ends it)
  if (following.value && following.value !== id) {
    following.value = null;
    app.scene?.follow(null);
  }
  if (id && opts.focus) focusEntity(id);
}

/** Best-known position of an entity from the latest frame / world. */
export function entityPos(id: string): [number, number] | null {
  const f = frame.value;
  const w = world.value;
  if (f) {
    for (const m of f.machines) if (m.id === id) return [m.x, m.z];
    for (const p of f.people) if (p.id === id) return [p.x, p.z];
    for (const s of f.stores) if (s.id === id) return [s.x, s.z];
    for (const wf of f.workfronts) if (wf.id === id) return [wf.x, wf.z];
  }
  if (w) {
    for (const b of w.buildings ?? []) if (b.id === id) return [b.center[0], b.center[1]];
    for (const r of w.roads) {
      if (r.id === id) {
        const a = r.design.alignment;
        const mid = a[Math.floor(a.length / 2)];
        return mid ? [mid[0], mid[1]] : null;
      }
    }
  }
  return null;
}

export function focusEntity(id: string, distance?: number): boolean {
  const p = entityPos(id);
  if (!p) return false;
  const machine = frame.peek()?.machines.find((m) => m.id === id);
  const d = distance ?? (machine ? equipmentFocusDistance(machine.model, machine.cls) : 70);
  app.scene?.focus(p[0], p[1], { distance: d });
  return true;
}

export function setSpeed(speed: number): void {
  if (speed > 0) {
    lastSpeed.value = speed;
    save('lastSpeed', speed);
  }
  app.client.setSpeed(speed);
}

export function togglePause(): void {
  const cur = frame.value?.speed ?? 0;
  setSpeed(cur > 0 ? 0 : lastSpeed.value || 3600);
}

/** Dispatch a command; toasts rejections; returns the result. */
export async function command<R = unknown>(type: string, payload: unknown, okMessage?: string): Promise<{ ok: boolean; value?: R; messages: string[] }> {
  try {
    const r = await app.client.dispatch<R>(type, payload);
    if (r.ok) {
      if (okMessage) toast('success', okMessage);
      return { ok: true, value: r.value, messages: [] };
    }
    const messages = ((r.reasons ?? []) as unknown as { message: string }[]).map((x) => x.message);
    toast('error', `Rejected: ${type}`, messages.join('\n'));
    return { ok: false, messages };
  } catch (e) {
    const msg = (e as Error).message;
    toast('error', `Failed: ${type}`, msg);
    return { ok: false, messages: [msg] };
  }
}
