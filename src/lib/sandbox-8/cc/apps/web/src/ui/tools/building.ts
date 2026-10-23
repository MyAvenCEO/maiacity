/**
 * Building placement tool.
 *
 *   move           footprint follows the cursor (until placed)
 *   click          place / re-place at the cursor
 *   Q / E          rotate −15° / +15° (Alt + wheel too)
 *   Shift          align parallel to the nearest road
 *   Enter          build (structures.build)
 *   Esc            cancel
 *
 * Live design preview through the worker (debounced, stale responses dropped).
 */
import { batch, computed, effect, signal } from '@preact/signals';
import type { Vec2 } from '../../../../../packages/geo/src/index.ts';
import type { BuildingDesign } from '../../../../../packages/buildings/src/index.ts';
import type { Plan, PlanSpec } from '../../../../../packages/structures/src/index.ts';
import type { ToolVisuals } from '../../render/api.ts';
import { app, load, save, select, toast, tool, world } from '../state.ts';
import { closestOnSegment } from './geometry.ts';

export const buildingTypeId = signal<string>(load('buildingType', ''));
export const bRotation = signal<number>(0);
/** placed centre (null = following the cursor) */
export const bPlaced = signal<Vec2 | null>(null);
export const bCursor = signal<Vec2 | null>(null);
export const bLength = signal<number | null>(null);
export const bWidth = signal<number | null>(null);
export const bFloors = signal<number | null>(null);
export const bLabel = signal('');
export const bPreview = signal<BuildingDesign | null>(null);
export const bBusy = signal(false);
export const bBuilding = signal(false);
export const bResult = signal<{ ok: boolean; messages: string[] } | null>(null);
/** last road alignment snap (for the hint) */
export const bAligned = signal<string | null>(null);

export const buildingType = computed(() => world.value?.buildingTypes?.find((t) => t.id === buildingTypeId.value) ?? world.value?.buildingTypes?.[0] ?? null);

export function setBuildingType(id: string): void {
  batch(() => {
    buildingTypeId.value = id;
    bLength.value = null;
    bWidth.value = null;
    bFloors.value = null;
  });
  save('buildingType', id);
}

const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

export function rotate(delta: number): void {
  bRotation.value = norm(bRotation.value + delta);
  bAligned.value = null;
}

export function center(): Vec2 | null {
  return bPlaced.value ?? bCursor.value;
}

/** Align the footprint's long side with the nearest road segment (network edges and planned roads). */
export function alignToRoad(): void {
  const c = center();
  const w = world.value;
  if (!c || !w) return;
  let best: { d: number; a: Vec2; b: Vec2; label: string } | null = null;
  const consider = (pts: Vec2[], label: string) => {
    for (let i = 1; i < pts.length; i += 1) {
      const r = closestOnSegment(c, pts[i - 1]!, pts[i]!);
      if (!best || r.distance < best.d) best = { d: r.distance, a: pts[i - 1]!, b: pts[i]!, label };
    }
  };
  for (const e of w.edges) consider(e.points, e.label ?? 'road');
  for (const r of w.roads) consider(r.design.alignment, r.label);
  if (!best) return;
  const b = best as { d: number; a: Vec2; b: Vec2; label: string };
  const deg = (Math.atan2(b.b[1] - b.a[1], b.b[0] - b.a[0]) * 180) / Math.PI;
  // keep the rotation closest to the current one (a footprint is symmetric under 180°)
  let r = norm(deg);
  if (Math.abs(((r - bRotation.value + 540) % 360) - 180) > 90) r = norm(r + 180);
  bRotation.value = r;
  bAligned.value = `${b.label} (${Math.round(b.d)} m away)`;
}

export function spec(): PlanSpec | null {
  const t = buildingType.value;
  const c = center();
  if (!t || !c) return null;
  const s: PlanSpec = { template: t.id, pos: [c[0], c[1]], rotation: bRotation.value };
  if (bLength.value) s.length = bLength.value;
  if (bWidth.value) s.width = bWidth.value;
  if (bFloors.value) s.floors = bFloors.value;
  return s;
}

export function place(ground: Vec2): void {
  bPlaced.value = [ground[0], ground[1]];
  bResult.value = null;
}

export function cancelBuilding(): void {
  batch(() => {
    bPlaced.value = null;
    bCursor.value = null;
    bPreview.value = null;
    bResult.value = null;
  });
}

export async function commitBuilding(): Promise<void> {
  const s = spec();
  if (!s) {
    toast('warn', 'Place the building first', 'Click on the terrain to place the footprint, then press Enter.');
    return;
  }
  if (bBuilding.value) return;
  bBuilding.value = true;
  const payload: PlanSpec = { ...s };
  if (bLabel.value.trim()) payload.label = bLabel.value.trim();
  try {
    const r = await app.client.dispatch<{ structure: string; project: string }>('structures.build', payload);
    if (r.ok) {
      toast('success', `${buildingType.value?.label ?? 'Building'} planned`, 'Construction project created.', [r.value.structure]);
      const id = r.value.structure;
      cancelBuilding();
      bLabel.value = '';
      tool.value = 'select';
      select(id, 'structure');
    } else {
      const messages = ((r.reasons ?? []) as unknown as { message: string }[]).map((x) => x.message);
      bResult.value = { ok: false, messages };
      toast('error', 'Building rejected', messages.join('\n'));
    }
  } catch (e) {
    bResult.value = { ok: false, messages: [(e as Error).message] };
  } finally {
    bBuilding.value = false;
  }
}

/** Footprint corners computed locally (instant ghost before the preview arrives). */
function localCorners(): Vec2[] | null {
  const t = buildingType.value;
  const c = center();
  if (!t || !c) return null;
  const L = bLength.value ?? t.length;
  const W = bWidth.value ?? t.width;
  const a = (bRotation.value * Math.PI) / 180;
  const corner = (u: number, v: number): Vec2 => [c[0] + u * Math.cos(a) - v * Math.sin(a), c[1] + u * Math.sin(a) + v * Math.cos(a)];
  return [corner(-L / 2, -W / 2), corner(L / 2, -W / 2), corner(L / 2, W / 2), corner(-L / 2, W / 2)];
}

export function buildingDraftVisuals(): ToolVisuals['buildingDraft'] {
  const p = bPreview.value;
  const c = center();
  if (!c) return undefined;
  // use the preview only when it matches the current placement/rotation
  if (p && Math.hypot(p.spec.center[0] - c[0], p.spec.center[1] - c[1]) < 0.5 && Math.abs(p.spec.rotation - bRotation.value) < 0.5) {
    return { corners: p.geometry.corners, height: p.geometry.height, valid: p.valid };
  }
  const corners = localCorners();
  if (!corners) return undefined;
  const t = buildingType.value;
  return { corners, height: (bFloors.value ?? t?.floors ?? 1) * 3 + 2, valid: p ? p.valid : true };
}

let seq = 0;
let timer = 0;
let installed = false;

export function installBuildingTool(): void {
  if (installed) return;
  installed = true;
  effect(() => {
    void buildingTypeId.value;
    void bRotation.value;
    void bPlaced.value;
    void bCursor.value;
    void bLength.value;
    void bWidth.value;
    void bFloors.value;
    if (tool.value !== 'building') return;
    const s = spec();
    clearTimeout(timer);
    if (!s) return;
    const my = ++seq;
    bBusy.value = true;
    timer = window.setTimeout(() => {
      app.client
        .query<Plan>({ kind: 'structurePreview', spec: s })
        .then((d) => {
          if (my !== seq) return;
          batch(() => {
            bPreview.value = d.detail as BuildingDesign;
            bBusy.value = false;
          });
        })
        .catch((e: Error) => {
          if (my !== seq) return;
          bBusy.value = false;
          bResult.value = { ok: false, messages: [e.message] };
        });
    }, 120);
  });
}
