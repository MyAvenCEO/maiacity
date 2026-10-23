/**
 * Tool controller: routes scene pointer events and the keyboard to the active tool, composes
 * the tool visuals for the scene and keeps the overlay layer loaded.
 */
// @ts-ignore — a .tsx module (Preact JSX): Vite compiles it (src/lib/sandbox-8/tsconfig.json), the app's type check does not
import { toggleAgentPanel } from '../panels/AgentPanel.tsx';
import { effect, signal } from '@preact/signals';
import type { Vec2 } from '../../../../../packages/geo/src/index.ts';
import type { OverlayData, PointerHit, ToolVisuals } from '../../render/api.ts';
import { SPEEDS } from '../../protocol.ts';
import {
  app,
  command,
  DRAWER_TABS,
  drawerOpen,
  drawerTab,
  explainPopover,
  focusEntity,
  helpOpen,
  hoverId,
  inspectorFocus,
  menuOpen,
  moveTargetFor,
  overlay,
  OVERLAYS,
  save,
  scoutGoal,
  scoutOpen,
  select,
  selection,
  setSpeed,
  togglePause,
  tool,
  type ToolId,
} from '../state.ts';
// @ts-ignore — a .tsx module (Preact JSX): Vite compiles it (src/lib/sandbox-8/tsconfig.json), the app's type check does not
import { orderDialog } from '../panels/drawer/MaterialsTab.tsx';
import { alignToRoad, bCursor, bPlaced, buildingDraftVisuals, cancelBuilding, commitBuilding, installBuildingTool, place, rotate } from './building.ts';
import { addPoint, cancelDraft, commit, dragIndex, draftCursor, hoverStation, installRoadTool, movePoint, noSnap, onDoubleClick, removeLast, roadDraftVisuals } from './road.ts';

/** ground point under the pointer (null when the pointer is not over the 3D view) */
export const pointerGround = signal<Vec2 | null>(null);
let suppressClickUntil = 0;

export function setTool(t: ToolId): void {
  if (t !== 'moveTarget') moveTargetFor.value = null;
  tool.value = t;
}

export function escape(): void {
  if (explainPopover.value) {
    explainPopover.value = null;
    return;
  }
  if (helpOpen.value || menuOpen.value || orderDialog.value) {
    helpOpen.value = false;
    menuOpen.value = false;
    orderDialog.value = null;
    return;
  }
  if (tool.value === 'road') {
    cancelDraft();
    setTool('select');
    return;
  }
  if (tool.value === 'building') {
    cancelBuilding();
    setTool('select');
    return;
  }
  if (tool.value !== 'select') {
    setTool('select');
    return;
  }
  if (selection.value) select(null);
}

export function cycleOverlay(dir = 1): void {
  const i = OVERLAYS.findIndex((o) => o.id === overlay.value);
  overlay.value = OVERLAYS[(i + dir + OVERLAYS.length) % OVERLAYS.length]!.id;
}

export function endDrag(): void {
  if (dragIndex.value !== null) {
    dragIndex.value = null;
    suppressClickUntil = performance.now() + 300;
  }
}

async function pickAt(ground: Vec2, radius: number, kinds?: string[]): Promise<{ id: string; kind: string } | null> {
  const hits = await app.client.query<{ id: string; kind: string; label: string; distance: number }[]>({ kind: 'pick', x: ground[0], z: ground[1], radius });
  const h = kinds ? hits.find((x) => kinds.includes(x.kind)) : hits[0];
  return h ? { id: h.id, kind: h.kind } : null;
}

let overScene = false;

function onHover(e: PointerHit): void {
  // the scene emits hovers from its render loop; ignore stale ones after the pointer left the view
  if (!overScene && dragIndex.value === null) return;
  pointerGround.value = e.ground;
  if (dragIndex.value !== null) {
    if (e.ground) movePoint(dragIndex.value, e.ground);
    return;
  }
  if (tool.value === 'road') {
    draftCursor.value = e.ground;
    return;
  }
  if (tool.value === 'building') {
    bCursor.value = e.ground;
    if (e.shift && !bPlaced.value) alignToRoad();
    return;
  }
  const id = e.entity?.id ?? null;
  if (id !== hoverId.value) {
    hoverId.value = id;
    app.scene.setHover(id);
  }
}

async function onClick(e: PointerHit): Promise<void> {
  if (performance.now() < suppressClickUntil) return;
  switch (tool.value) {
    case 'road':
      if (e.ground) addPoint(e.ground);
      return;
    case 'building':
      if (e.ground) {
        place(e.ground);
        if (e.shift) alignToRoad();
      }
      return;
    case 'moveTarget': {
      const m = moveTargetFor.value;
      if (m && e.ground) await command('equipment.moveTo', { machine: m, to: e.ground }, 'Machine on its way');
      setTool('select');
      return;
    }
    case 'inspect': {
      const hit = e.entity?.kind === 'road' ? e.entity : e.ground ? await pickAt(e.ground, 15, ['road']) : null;
      if (hit) {
        inspectorFocus.value = 'condition';
        select(hit.id, 'road');
      }
      return;
    }
    case 'select': {
      if (e.entity) {
        select(e.entity.id, e.entity.kind);
        return;
      }
      if (!e.ground) return;
      const hit = await pickAt(e.ground, 8);
      select(hit?.id ?? null, hit?.kind);
    }
  }
}

function onDblClick(e: PointerHit): void {
  if (tool.value === 'road') {
    onDoubleClick(e.ground);
    return;
  }
  if (tool.value === 'select' && selection.value) focusEntity(selection.value.id);
}

function onContext(_e: PointerHit): void {
  if (tool.value === 'road') removeLast();
  else if (tool.value === 'building') bPlaced.value = null;
  else if (tool.value === 'moveTarget' || tool.value === 'inspect') setTool('select');
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Alt') {
    noSnap.value = true;
    ev.preventDefault();
  }
  if (isTyping(ev.target)) {
    if (ev.key === 'Escape') (ev.target as HTMLElement).blur();
    return;
  }
  if (ev.ctrlKey || ev.metaKey) return;
  const k = ev.key;
  // capture phase + stopPropagation: keys the UI consumes must not also drive the camera (R/F tilt)
  const handled = () => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  switch (k) {
    case ' ':
      togglePause();
      return handled();
    case 'Escape':
      escape();
      return handled();
    case 'Tab':
      drawerOpen.value = !drawerOpen.value;
      save('drawerOpen', drawerOpen.value);
      return handled();
    case 'Backspace':
      if (tool.value === 'road') {
        removeLast();
        return handled();
      }
      return;
    case 'Enter':
      if (tool.value === 'road') {
        void commit();
        return handled();
      }
      if (tool.value === 'building') {
        void commitBuilding();
        return handled();
      }
      return;
    case 'Shift':
      if (tool.value === 'building') alignToRoad();
      return;
    case '[':
    case ']': {
      const i = DRAWER_TABS.findIndex((t) => t.id === drawerTab.value);
      const n = DRAWER_TABS[(i + (k === ']' ? 1 : -1) + DRAWER_TABS.length) % DRAWER_TABS.length]!.id;
      drawerTab.value = n;
      drawerOpen.value = true;
      save('drawerTab', n);
      return handled();
    }
    case '?':
      helpOpen.value = !helpOpen.value;
      return handled();
  }
  if (/^[1-5]$/.test(k)) {
    setSpeed(SPEEDS[Number(k)]!);
    return handled();
  }
  switch (k.toLowerCase()) {
    case 'v':
      setTool('select');
      return handled();
    case 'r':
      setTool('road');
      return handled();
    case 'b':
      setTool('building');
      return handled();
    case 'q':
    case 'e':
      if (tool.value === 'building') {
        rotate(k.toLowerCase() === 'q' ? -15 : 15);
        return handled();
      }
      return;
    case 'i':
      setTool('inspect');
      return handled();
    case 'l':
      cycleOverlay(ev.shiftKey ? -1 : 1);
      return handled();
    case 'k':
      scoutOpen.value = !scoutOpen.value;
      return handled();
    case 'f':
      if (selection.value) focusEntity(selection.value.id);
      return handled();
    case 'n':
      app.client.skip(ev.shiftKey ? 'nextDay' : 'shiftStart');
      return handled();
    case 'h':
      helpOpen.value = !helpOpen.value;
      return handled();
    case 'g':
      toggleAgentPanel();
      return handled();
  }
}

function onKeyUp(ev: KeyboardEvent): void {
  if (ev.key === 'Alt') noSnap.value = false;
}

let overlayTimer = 0;
async function loadOverlay(layer: string): Promise<void> {
  clearTimeout(overlayTimer);
  if (layer === 'none') {
    app.scene.setOverlay(null);
    return;
  }
  try {
    const goal = layer === 'goal:custom' ? scoutGoal.value : null;
    if (layer === 'goal:custom' && !goal) return;
    const d = await app.client.query<Omit<OverlayData, 'layer'> | null>({ kind: 'overlay', layer: layer as OverlayData['layer'], ...(goal ? { goal } : {}) });
    if (overlay.value !== layer) return;
    app.scene.setOverlay(d ? { layer: layer as OverlayData['layer'], ...d } : null);
    overlayData.value = d ? { layer: layer as OverlayData['layer'], ...d } : null;
  } catch {
    overlayData.value = null;
  }
  // dynamic layers refresh
  if (layer !== 'slope' && layer !== 'soil' && !layer.startsWith('crit:') && !layer.startsWith('goal:')) overlayTimer = window.setTimeout(() => void loadOverlay(layer), 8000);
}
/** last loaded overlay (legend) */
export const overlayData = signal<OverlayData | null>(null);

/** Install event routing (once, after the scene exists); returns what takes it down again. */
export function installController(container: HTMLElement): () => void {
  installRoadTool();
  installBuildingTool();
  // Alt + wheel rotates the building footprint (capture: keep the camera from zooming)
  container.addEventListener(
    'wheel',
    (ev) => {
      if (tool.value !== 'building' || !ev.altKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      rotate(ev.deltaY > 0 ? 15 : -15);
    },
    { capture: true, passive: false },
  );
  const scene = app.scene;
  scene.on('hover', onHover);
  scene.on('click', (e) => void onClick(e));
  scene.on('dblclick', onDblClick);
  scene.on('contextmenu', onContext);
  container.addEventListener('pointerenter', () => (overScene = true));
  container.addEventListener('pointermove', () => (overScene = true));
  container.addEventListener('pointerleave', () => {
    overScene = false;
    if (dragIndex.value !== null) return;
    pointerGround.value = null;
    draftCursor.value = null;
    bCursor.value = null;
    if (hoverId.value) {
      hoverId.value = null;
      scene.setHover(null);
    }
  });
  const onBlur = () => (noSnap.value = false);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerup', endDrag);

  // compose tool visuals
  const stops = [effect(() => {
    const t = tool.value;
    const v: ToolVisuals = {};
    if (t === 'road') {
      const d = roadDraftVisuals();
      if (d) v.roadDraft = d;
    }
    if (t === 'building') {
      const d = buildingDraftVisuals();
      if (d) v.buildingDraft = d;
    }
    const st = hoverStation.value;
    const g = pointerGround.value;
    if (st) v.cursorRing = { x: st.x, z: st.z, radius: 4, color: '#ffffff' };
    else if (t === 'inspect' && g) v.cursorRing = { x: g[0], z: g[1], radius: 15, color: '#5aa9e6' };
    else if (t === 'moveTarget' && g) v.cursorRing = { x: g[0], z: g[1], radius: 6, color: '#fab219' };
    scene.setTool(v);
  }),
  // leaving the road tool drops the live cursor
  effect(() => {
    if (tool.value !== 'road') draftCursor.value = null;
    if (tool.value !== 'building') bCursor.value = null;
    document.body.dataset.tool = tool.value;
  }),
  effect(() => {
    // a custom goal's overlay follows the edits in the Scout panel
    void scoutGoal.value;
    void loadOverlay(overlay.value);
  })];
  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pointerup', endDrag);
    for (const stop of stops) stop();
    delete document.body.dataset.tool;
  };
}
