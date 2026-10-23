/**
 * The three.js scene behind the SceneView contract (api.ts): renderer, camera, layers, picking
 * and pointer events. Static world data is (re)built only when its revision changes; frames
 * update dynamic objects and the environment.
 */
import {
  ACESFilmicToneMapping,
  Mesh,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
  InstancedMesh,
} from 'three';
import type { Frame, StaticWorld } from '../protocol.ts';
import type { CreateScene, OverlayData, PointerHit, SceneEvents, SceneOptions, SceneView, ToolVisuals } from './api.ts';
import { BuildingLayer } from './buildings.ts';
import { CameraRig } from './camera.ts';
import { DynamicLayer, type EntityPos } from './dynamic.ts';
import { Environment } from './env.ts';
import { Heightfield } from './heightfield.ts';
import { RoadLayer } from './roads.ts';
import { TerrainLayer } from './terrain.ts';
import { ToolLayer } from './tools.ts';
import { TreeLayer } from './trees.ts';
import { WaterLayer } from './water.ts';

type Listeners = { [K in keyof SceneEvents]: Set<(e: SceneEvents[K]) => void> };

/** debug/perf counters, readable via scene.stats() for scripts */
export interface SceneStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  trees: number;
  /** last setWorld / applyPatch / setFrame CPU cost (ms) */
  setWorldMs: number;
  patchMs: number;
  frameMs2: number;
}

class SceneImpl {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly rig: CameraRig;
  readonly env: Environment;
  readonly terrain: TerrainLayer;
  readonly water = new WaterLayer();
  readonly trees = new TreeLayer();
  readonly roads = new RoadLayer();
  readonly dyn = new DynamicLayer();
  readonly buildings = new BuildingLayer();
  readonly tools: ToolLayer;
  private hf: Heightfield | null = null;
  private world: StaticWorld | null = null;
  private listeners: Listeners = { click: new Set(), dblclick: new Set(), hover: new Set(), contextmenu: new Set() };
  private raf = 0;
  private lastT = performance.now();
  /** the entity the camera follows, if any */
  private followId: string | null = null;
  private followPos: EntityPos = { x: 0, y: 0, z: 0, radius: 0, kind: '' };
  private t0 = performance.now();
  private ro: ResizeObserver;
  private options: SceneOptions = { shadows: true, realLighting: true, showTrees: true, showLabels: true };
  private raycaster = new Raycaster();
  private ndc = new Vector2();
  private tmpV = new Vector3();
  private tmpO = new Vector3();
  private tmpD = new Vector3();
  private hitV = new Vector3();
  private pickList: Object3D[] = [];
  private pendingHover: PointerEvent | null = null;
  private down: { x: number; y: number; button: number; moved: boolean } | null = null;
  private pmrem: PMREMGenerator;
  private envTex: Texture | null = null;
  private envVersion = -1;
  private envAt = 0;
  private overlayLayer: string | null = null;
  private disposed = false;
  private statsAcc = { frames: 0, time: 0, work: 0 };
  readonly stats: SceneStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, trees: 0, setWorldMs: 0, patchMs: 0, frameMs2: 0 };
  private width = 1;
  private height = 1;
  private firstWorld = true;

  constructor(private container: HTMLElement) {
    const r = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    r.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.camera = new PerspectiveCamera(42, 1, 1, 9000);
    this.camera.position.set(-600, 900, 900);
    this.rig = new CameraRig(this.camera, r.domElement);
    this.env = new Environment(this.scene);
    this.terrain = new TerrainLayer(() => this.hf!);
    this.tools = new ToolLayer(this.dyn, this.roads);
    this.tools.roadClassWidth = (id) => {
      const c = this.world?.roadClasses.find((x) => x.id === id);
      return c ? c.carriageway + 2 * (c.surface === 'asphalt' ? 1.5 : 0.75) : 6;
    };
    this.scene.add(this.terrain.group, this.water.group, this.trees.group, this.roads.group, this.buildings.group, this.dyn.group, this.tools.group);
    this.tools.locate.push((id, out) => this.buildings.entityPos(id, out));
    this.pmrem = new PMREMGenerator(r);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.installPointer();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ world

  setWorld(world: StaticWorld): void {
    const t0 = performance.now();
    this.setWorldInner(world);
    this.stats.setWorldMs = performance.now() - t0;
  }

  private setWorldInner(world: StaticWorld): void {
    this.world = world;
    let mn = Infinity;
    for (let i = 0; i < world.heights.length; i += 1) if (world.heights[i]! < mn) mn = world.heights[i]!;
    const baseY = Math.floor(mn);
    this.hf = new Heightfield(world.grid, world.heights, baseY);
    this.terrain.setWorld(world.grid, world.heights, world.groundColors);
    this.water.set(world.water, this.hf);
    this.trees.set(world.trees, this.hf);
    this.roads.setHeightfield(this.hf);
    this.roads.setRoads(world.roads);
    this.roads.setEdges(world.edges);
    this.dyn.setHeightfield(this.hf);
    this.tools.setHeightfield(this.hf);
    this.buildings.setHeightfield(this.hf);
    this.buildings.setBuildings(world.buildings ?? []);
    this.rig.hf = this.hf;
    if (this.firstWorld) {
      this.firstWorld = false;
      const g = world.grid;
      const cx = g.x0 + ((g.nx - 1) * g.cell) / 2;
      const cz = g.z0 + ((g.nz - 1) * g.cell) / 2;
      this.rig.focus(cx, cz, 1500, true);
      this.rig.setView(30, 52);
    }
  }

  applyPatch(patch: Partial<StaticWorld>): void {
    const t0 = performance.now();
    this.applyPatchInner(patch);
    this.stats.patchMs = performance.now() - t0;
  }

  private applyPatchInner(patch: Partial<StaticWorld>): void {
    const w = this.world;
    const hf = this.hf;
    if (!w || !hf) return;
    Object.assign(w, patch);
    if (patch.heights) {
      hf.set(patch.heights);
      this.terrain.patch(patch.heights, patch.groundColors);
      this.roads.terrainChanged();
      this.dyn.setHeightfield(hf);
      this.tools.setHeightfield(hf);
      this.buildings.setHeightfield(hf);
    } else if (patch.groundColors) this.terrain.patch(w.heights, patch.groundColors);
    if (patch.water) this.water.set(patch.water, hf);
    if (patch.trees && patch.trees.revision !== this.trees.revision) this.trees.set(patch.trees, hf);
    if (patch.roads) this.roads.setRoads(patch.roads);
    if (patch.edges) this.roads.setEdges(patch.edges);
    if (patch.buildings) this.buildings.setBuildings(patch.buildings);
  }

  setFrame(frame: Frame): void {
    const t0 = performance.now();
    this.setFrameInner(frame);
    this.stats.frameMs2 = performance.now() - t0;
  }

  private setFrameInner(frame: Frame): void {
    this.env.setWeather(frame.hud?.weather);
    this.dyn.setFrame(frame, performance.now());
    this.roads.setProgress(frame.roadProgress ?? {}, frame.roadGrades ?? {});
    this.buildings.setStages(frame.buildingStages);
  }

  setTool(v: ToolVisuals): void {
    this.tools.setTool(v);
    this.buildings.setDraft(v.buildingDraft);
    this.rig.rotateKeys = !v.buildingDraft;
  }

  setOverlay(data: OverlayData | null): void {
    this.overlayLayer = data?.layer ?? null;
    this.roads.setConditionOverlay(data?.layer === 'condition');
    const hasGrid = !!data && data.nx > 0 && data.nz > 0 && data.values.length >= data.nx * data.nz && data.layer !== 'condition';
    this.terrain.setOverlay(hasGrid ? data : null);
  }

  setOptions(o: Partial<SceneOptions>): void {
    Object.assign(this.options, o);
    if (o.shadows !== undefined) {
      this.env.sun.castShadow = o.shadows;
      this.trees.setShadows(o.shadows);
    }
    if (o.realLighting !== undefined) {
      this.env.realLighting = o.realLighting;
      this.env.applyLighting();
    }
    if (o.showTrees !== undefined) this.trees.group.visible = o.showTrees;
  }

  // ------------------------------------------------------------------ projection & picking

  project(x: number, z: number, y?: number): { x: number; y: number } | null {
    const hf = this.hf;
    let sy: number;
    if (y === undefined) sy = hf ? hf.y(x, z) : 0;
    else if (hf && y < hf.baseY - 100) sy = hf.y(x, z) + y; // offset above ground
    else sy = y - (hf?.baseY ?? 0);
    const v = this.tmpV.set(x, sy, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
  }

  private hit(ev: { clientX: number; clientY: number; button: number; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey?: boolean }): PointerHit {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    this.ndc.set((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hf = this.hf;
    let ground: [number, number] | null = null;
    let height: number | null = null;
    let groundDist = Infinity;
    if (hf) {
      this.tmpO.copy(this.raycaster.ray.origin);
      this.tmpD.copy(this.raycaster.ray.direction);
      if (hf.raycast(this.tmpO, this.tmpD, this.hitV)) {
        ground = [this.hitV.x, this.hitV.z];
        height = this.hitV.y + hf.baseY;
        groundDist = this.hitV.distanceTo(this.tmpO);
      }
    }
    let entity: { id: string; kind: string } | null = null;
    // mesh hits (machines, people, heaps, flags, depot)
    this.pickList.length = 0;
    this.dyn.pickables(this.pickList);
    this.buildings.pickables(this.pickList);
    const hits = this.raycaster.intersectObjects(this.pickList, true);
    for (const h of hits) {
      if (h.distance > groundDist + 2) break;
      let o: Object3D | null = h.object;
      if (o instanceof InstancedMesh && h.instanceId !== undefined) {
        const ids = o.userData.ids as string[] | undefined;
        const id = ids?.[h.instanceId];
        if (id) {
          entity = { id, kind: o.userData.kind as string };
          break;
        }
        continue;
      }
      while (o && !o.userData.pick) o = o.parent;
      if (o) {
        entity = { ...(o.userData.pick as { id: string; kind: string }) };
        break;
      }
    }
    if (!entity && ground) {
      const tol = Math.max(.08, this.rig.distance * 0.012);
      entity = this.dyn.entityAt(ground[0], ground[1], tol);
      if (!entity) {
        const bid = this.buildings.buildingAt(ground[0], ground[1], 0.5);
        if (bid) entity = { id: bid, kind: 'structure' };
      }
      if (!entity) {
        const r = this.roads.nearestRoad(ground[0], ground[1], 1);
        if (r) entity = { id: r.id, kind: 'road' };
      }
    }
    return { ground, height, entity, screen: { x: sx, y: sy }, button: ev.button, shift: ev.shiftKey, ctrl: ev.ctrlKey || !!ev.metaKey, alt: ev.altKey };
  }

  private emit<K extends keyof SceneEvents>(k: K, e: SceneEvents[K]): void {
    for (const cb of this.listeners[k]) {
      try {
        cb(e);
      } catch (err) {
        console.error(err);
      }
    }
  }

  on<K extends keyof SceneEvents>(event: K, cb: (e: SceneEvents[K]) => void): () => void {
    const set = this.listeners[event] as Set<(e: SceneEvents[K]) => void>;
    set.add(cb);
    return () => set.delete(cb);
  }

  private installPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    });
    el.addEventListener('pointermove', (e) => {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4) this.down.moved = true;
      this.pendingHover = e;
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.moved || d.button !== e.button) return;
      if (e.button === 0) this.emit('click', this.hit(e));
      else if (e.button === 2) this.emit('contextmenu', this.hit(e));
    });
    el.addEventListener('dblclick', (e) => this.emit('dblclick', this.hit(e)));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------------ loop

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.renderFrame();
  };

  renderFrame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const t = (now - this.t0) / 1000;
    this.rig.update(dt, now);
    // following an entity: where the renderer draws it now (smoothly between frames)
    if (this.followId && (this.dyn.entityPos(this.followId, this.followPos) || this.tools.locate.some((f) => f(this.followId!, this.followPos)))) this.rig.follow(this.followPos.x, this.followPos.z, dt);
    const dist = this.rig.distance;
    const target = this.rig.controls.target;
    this.env.update(this.camera, target, dist, t);
    this.renderer.toneMappingExposure = this.env.exposure;
    this.dyn.update(now, t, dist);
    this.buildings.update(this.env.daylight, this.options.realLighting);
    this.tools.update(t, dist);
    this.trees.update(this.camera);
    this.updateEnvMap(now);
    if (this.pendingHover && this.listeners.hover.size) {
      const e = this.pendingHover;
      this.pendingHover = null;
      if (!this.down || !this.down.moved) this.emit('hover', this.hit(e));
    }
    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    const a = this.statsAcc;
    a.frames += 1;
    a.work += performance.now() - now;
    a.time += dt;
    if (a.time >= 1) {
      this.stats.fps = a.frames / a.time;
      this.stats.frameMs = a.work / a.frames;
      a.frames = 0;
      a.time = 0;
      a.work = 0;
    }
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
    this.stats.trees = this.trees.count;
  }

  private updateEnvMap(now: number): void {
    if (this.env.lightingVersion === this.envVersion || now - this.envAt < 3000) return;
    this.envVersion = this.env.lightingVersion;
    this.envAt = now;
    const s = new Scene();
    const sky = this.scene.getObjectByName('sky') as Mesh | undefined;
    if (!sky) return;
    const m = new Mesh(sky.geometry, sky.material);
    m.scale.setScalar(0.05);
    s.add(m);
    const rt = this.pmrem.fromScene(s, 0.02, 0.1, 100);
    this.envTex?.dispose();
    this.envTex = rt.texture;
    this.water.setEnvMap(this.envTex);
    this.buildings.setEnvMap(this.envTex);
    this.dyn.setEnvMap(this.envTex);
  }

  focus(x: number, z: number, opts?: { distance?: number; instant?: boolean }): void {
    this.rig.focus(x, z, opts?.distance, opts?.instant);
  }

  follow(id: string | null): void {
    this.followId = id;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.rig.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.trees.dispose();
    this.roads.dispose();
    this.dyn.dispose();
    this.buildings.dispose();
    this.tools.dispose();
    this.env.dispose();
    this.envTex?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export const createScene: CreateScene = (container) => {
  const s = new SceneImpl(container);
  const view: SceneView & { debug: SceneImpl } = {
    setWorld: (w) => s.setWorld(w),
    applyPatch: (p) => s.applyPatch(p),
    setFrame: (f) => s.setFrame(f),
    setTool: (v) => s.setTool(v),
    setSelection: (id) => s.tools.setSelection(id),
    setHover: (id) => s.tools.setHover(id),
    setOverlay: (d) => s.setOverlay(d),
    focus: (x, z, o) => s.focus(x, z, o),
    follow: (id) => s.follow(id),
    project: (x, z, y) => s.project(x, z, y),
    on: (e, cb) => s.on(e, cb),
    setOptions: (o) => s.setOptions(o),
    dispose: () => s.dispose(),
    debug: s,
  };
  return view;
};
