/**
 * Road drafting tool: control points, live design preview, snapping and commit.
 *
 *   click            add control point (snaps to existing roads within the connect distance; Alt = no snap)
 *   drag a point     move it (HTML handles, see RoadHandles)
 *   Backspace / RMB  remove last point
 *   Enter / dblclick build (roads.plan)
 *   Esc              cancel draft
 *
 * Every change re-queries the design (debounced 120 ms, stale responses dropped) and pushes
 * the draft to the scene.
 */
import { batch, computed, effect, signal } from '@preact/signals';
import type { Vec2 } from '../../../../../packages/geo/src/index.ts';
import type { RoadDesign, Station } from '../../../../../packages/roads/src/index.ts';
import { app, command, load, save, select, toast, tool, world } from '../state.ts';
import { dist, nearestRoad, type SnapHit } from './geometry.ts';
import type { ToolVisuals } from '../../render/api.ts';

export const roadClassId = signal<string>(load('roadClass', ''));
export const draftPoints = signal<Vec2[]>([]);
export const draftCursor = signal<Vec2 | null>(null);
/** cursor snap target (live) */
export const cursorSnap = signal<SnapHit | null>(null);
export const preview = signal<RoadDesign | null>(null);
/** preview was computed with the cursor as tentative last point */
export const previewWithCursor = signal(false);
export const previewBusy = signal(false);
export const previewError = signal<string | null>(null);
export const draftLabel = signal('');
export const buildResult = signal<{ ok: boolean; messages: string[] } | null>(null);
export const building = signal(false);
export const dragIndex = signal<number | null>(null);
/** station hovered in the long section → ring in the 3D view */
export const hoverStation = signal<Station | null>(null);
/** Alt held: no snapping */
export const noSnap = signal(false);

export const roadClass = computed(() => world.value?.roadClasses.find((c) => c.id === roadClassId.value) ?? world.value?.roadClasses[0] ?? null);

export function setRoadClass(id: string): void {
  roadClassId.value = id;
  save('roadClass', id);
}

function connectDistance(): number {
  return world.value?.roadSettings?.connectDistance ?? 25;
}

/** Apply snapping to a ground point (used for every placed/moved point). */
export function snapPoint(p: Vec2): { point: Vec2; snap: SnapHit | null } {
  if (noSnap.value) return { point: p, snap: null };
  const hit = nearestRoad(world.value, p, connectDistance());
  if (!hit) return { point: p, snap: null };
  // snap onto the road only when close; farther within the connect distance just indicates
  return hit.distance <= Math.min(12, connectDistance()) ? { point: hit.point, snap: hit } : { point: p, snap: hit };
}

let lastClickAt = 0;

export function addPoint(ground: Vec2): void {
  const { point } = snapPoint(ground);
  const pts = draftPoints.value;
  const last = pts[pts.length - 1];
  if (last && dist(last, point) < 2) return; // ignore double placement
  buildResult.value = null;
  draftPoints.value = [...pts, point];
  lastClickAt = performance.now();
}

export function removeLast(): void {
  const pts = draftPoints.value;
  if (!pts.length) return;
  buildResult.value = null;
  draftPoints.value = pts.slice(0, -1);
}

export function movePoint(i: number, ground: Vec2): void {
  const pts = [...draftPoints.value];
  if (i < 0 || i >= pts.length) return;
  const end = i === 0 || i === pts.length - 1;
  pts[i] = end ? snapPoint(ground).point : ground;
  draftPoints.value = pts;
}

export function cancelDraft(): void {
  batch(() => {
    draftPoints.value = [];
    draftCursor.value = null;
    preview.value = null;
    buildResult.value = null;
    previewError.value = null;
    dragIndex.value = null;
  });
}

/** Double click: the two clicks before it already added the point — just commit. */
export function onDoubleClick(ground: Vec2 | null): void {
  if (performance.now() - lastClickAt > 600 && ground) addPoint(ground);
  void commit();
}

export async function commit(): Promise<void> {
  const pts = draftPoints.value;
  const cls = roadClass.value;
  if (!cls) return;
  if (pts.length < 2) {
    toast('warn', 'Place at least two points', 'Click on the terrain to add control points, then press Enter.');
    return;
  }
  if (building.value) return;
  building.value = true;
  const payload: { points: Vec2[]; classId: string; label?: string } = { points: pts, classId: cls.id };
  if (draftLabel.value.trim()) payload.label = draftLabel.value.trim();
  try {
    const r = await app.client.dispatch<{ road: string; project: string }>('roads.plan', payload);
    if (r.ok) {
      toast('success', `${cls.label} planned`, 'Construction project created — crews start at the next shift.', [r.value.road]);
      buildResult.value = { ok: true, messages: [] };
      const id = r.value.road;
      cancelDraft();
      draftLabel.value = '';
      tool.value = 'select';
      select(id, 'road');
    } else {
      const messages = ((r.reasons ?? []) as unknown as { message: string }[]).map((x) => x.message);
      buildResult.value = { ok: false, messages };
      toast('error', 'Road rejected', messages.join('\n'));
    }
  } catch (e) {
    buildResult.value = { ok: false, messages: [(e as Error).message] };
  } finally {
    building.value = false;
  }
}

// ------------------------------------------------------------------ live preview

let seq = 0;
let timer = 0;

function previewPoints(): { pts: Vec2[]; withCursor: boolean } {
  const pts = draftPoints.value;
  const c = draftCursor.value;
  if (c && pts.length >= 1 && dragIndex.value === null) {
    const last = pts[pts.length - 1]!;
    if (dist(last, c) > 3) return { pts: [...pts, snapPoint(c).point], withCursor: true };
  }
  return { pts, withCursor: false };
}

function schedulePreview(): void {
  clearTimeout(timer);
  const { pts, withCursor } = previewPoints();
  const cls = roadClass.value;
  if (!cls || pts.length < 2) {
    seq += 1;
    preview.value = null;
    previewBusy.value = false;
    return;
  }
  const my = ++seq;
  previewBusy.value = true;
  timer = window.setTimeout(() => {
    app.client
      .query<RoadDesign>({ kind: 'roadPreview', points: pts, classId: cls.id })
      .then((d) => {
        if (my !== seq) return;
        batch(() => {
          preview.value = d;
          previewWithCursor.value = withCursor;
          previewBusy.value = false;
          previewError.value = null;
        });
      })
      .catch((e: Error) => {
        if (my !== seq) return;
        previewBusy.value = false;
        previewError.value = e.message;
      });
  }, 120);
}

let installed = false;
/** Wire the reactive preview + scene visuals (call once after boot). */
export function installRoadTool(): void {
  if (installed) return;
  installed = true;
  // re-query when points/cursor/class change (cursor only matters with ≥ 1 point)
  effect(() => {
    void draftPoints.value;
    void roadClassId.value;
    void dragIndex.value;
    const c = draftCursor.value;
    if (tool.value !== 'road') return;
    if (c && draftPoints.value.length === 0) return;
    schedulePreview();
  });
  // live cursor snap indicator
  effect(() => {
    const c = draftCursor.value;
    if (tool.value !== 'road' || !c) {
      cursorSnap.value = null;
      return;
    }
    cursorSnap.value = noSnap.value ? null : nearestRoad(world.value, c, connectDistance());
  });
}

/** Road draft visuals for the scene (composed by the tool controller). */
export function roadDraftVisuals(): ToolVisuals['roadDraft'] {
  const pts = draftPoints.value;
  const p = preview.value;
  const snaps: Vec2[] = [];
  if (p?.connections.start) snaps.push(p.connections.start.point);
  if (p?.connections.end) snaps.push(p.connections.end.point);
  const cs = cursorSnap.value;
  if (cs && !snaps.some((s) => dist(s, cs.point) < 1)) snaps.push(cs.point);
  const cursor = draftCursor.value;
  const draft: NonNullable<ToolVisuals['roadDraft']> = { points: pts, preview: p, valid: p ? p.valid : true, snaps };
  if (cursor && dragIndex.value === null) draft.cursor = snapPoint(cursor).point;
  return draft;
}
