/**
 * Contract between the UI (src/ui, src/main.tsx) and the 3D scene (src/render).
 * The scene owns the canvas, camera and all three.js objects; the UI owns tools and panels
 * and talks to the scene only through this interface.
 */
import type { Vec2 } from '../../../../packages/geo/src/index.ts';
import type { RoadDesign } from '../../../../packages/roads/src/index.ts';
import type { Frame, OverlayLayer, StaticWorld } from '../protocol.ts';

export interface OverlayData {
  layer: OverlayLayer;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  cell: number;
  values: Float32Array;
  min: number;
  max: number;
  unit: string;
  label: string;
}

/** What the active tool wants drawn on top of the world. */
export interface ToolVisuals {
  /** road drafting: control points placed so far + cursor point */
  roadDraft?: {
    points: Vec2[];
    cursor?: Vec2;
    /** latest design preview (alignment, stations with cut/fill) — drawn as a ghost */
    preview?: RoadDesign | null;
    valid: boolean;
    /** snap targets (start/end connection points) */
    snaps?: Vec2[];
  };
  /** generic ring under the cursor (inspect tool, placement) */
  cursorRing?: { x: number; z: number; radius: number; color: string };
  /** building placement ghost: footprint corners, total height (m), validity (green / red) */
  buildingDraft?: { corners: Vec2[]; height: number; valid: boolean };
}

export interface PointerHit {
  /** ground point under the pointer (null when over the sky) */
  ground: Vec2 | null;
  height: number | null;
  /** entity under the pointer if a pickable mesh was hit (machines, people, stores, roads, work fronts) */
  entity: { id: string; kind: string } | null;
  screen: { x: number; y: number };
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface SceneEvents {
  /** primary click (not a drag) */
  click: PointerHit;
  /** double click */
  dblclick: PointerHit;
  /** pointer moved (throttled to animation frames) */
  hover: PointerHit;
  /** right click without drag */
  contextmenu: PointerHit;
}

export interface SceneView {
  setWorld(world: StaticWorld): void;
  applyPatch(patch: Partial<StaticWorld>): void;
  setFrame(frame: Frame): void;
  setTool(visuals: ToolVisuals): void;
  setSelection(id: string | null): void;
  setHover(id: string | null): void;
  setOverlay(data: OverlayData | null): void;
  /** fly the camera to a point (smooth) */
  focus(x: number, z: number, opts?: { distance?: number; instant?: boolean }): void;
  /** keep the camera on an entity as it moves (a person, a machine), orbit and zoom still free; null: stop */
  follow(id: string | null): void;
  /** world → screen (for HTML labels); null when behind the camera */
  project(x: number, z: number, y?: number): { x: number; y: number } | null;
  on<K extends keyof SceneEvents>(event: K, cb: (e: SceneEvents[K]) => void): () => void;
  /** visual quality toggles */
  setOptions(opts: Partial<SceneOptions>): void;
  dispose(): void;
}

export interface SceneOptions {
  shadows: boolean;
  /** follow the simulated sun / day–night; false = fixed pleasant noon light */
  realLighting: boolean;
  showTrees: boolean;
  showLabels: boolean;
}

export type CreateScene = (container: HTMLElement) => SceneView;
