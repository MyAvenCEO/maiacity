/**
 * Tool visuals (road drafting, cursor ring, snaps) and selection / hover highlights.
 */
import { BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoadDesign } from '../../../../packages/roads/src/index.ts';
import type { ToolVisuals } from './api.ts';
import type { DynamicLayer, EntityPos } from './dynamic.ts';
import type { Heightfield } from './heightfield.ts';
import { GeoBuilder, Path } from './ribbon.ts';
import { DrapedRing } from './rings.ts';
import type { RoadLayer } from './roads.ts';

export class ToolLayer {
  readonly group = new Group();
  private visuals: ToolVisuals = {};
  private hf: Heightfield | null = null;
  private lineMesh: Mesh;
  private lineMat = new MeshBasicMaterial({ color: '#fff7d6', transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false });
  private previewMesh: Mesh;
  private previewMat = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.8, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  private curtainMesh: Mesh;
  private curtainMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide, fog: false });
  private pins: InstancedMesh;
  private snapRings: DrapedRing[] = [];
  private cursorRing = new DrapedRing('#ffffff', 0.85, 0.3);
  private selRing = new DrapedRing('#ffffff', 0.95, 0.018);
  private hoverRing = new DrapedRing('#ffffff', 0.5, 0.022);
  private roadHl: Mesh;
  private roadHlMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, fog: false, side: DoubleSide });
  private roadHoverHl: Mesh;
  private roadHoverMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, fog: false, side: DoubleSide });
  private selection: string | null = null;
  private hover: string | null = null;
  private selRoad = '';
  private hoverRoad = '';
  private lineWidth = 0;
  private tmpPos: EntityPos = { x: 0, z: 0, y: 0, radius: 0, kind: '' };
  private m4 = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private s = new Vector3();
  roadClassWidth: (classId: string) => number = () => 6;
  /** additional entity locators (buildings …) */
  locate: ((id: string, out: EntityPos) => boolean)[] = [];

  constructor(
    private dyn: DynamicLayer,
    private roads: RoadLayer,
  ) {
    this.group.name = 'tools';
    this.lineMesh = new Mesh(new BufferGeometry(), this.lineMat);
    this.lineMesh.renderOrder = 8;
    this.lineMesh.frustumCulled = false;
    this.previewMesh = new Mesh(new BufferGeometry(), this.previewMat);
    this.previewMesh.renderOrder = 6;
    this.previewMesh.frustumCulled = false;
    this.curtainMesh = new Mesh(new BufferGeometry(), this.curtainMat);
    this.curtainMesh.renderOrder = 7;
    this.curtainMesh.frustumCulled = false;
    this.roadHl = new Mesh(new BufferGeometry(), this.roadHlMat);
    this.roadHl.renderOrder = 9;
    this.roadHl.frustumCulled = false;
    this.roadHoverHl = new Mesh(new BufferGeometry(), this.roadHoverMat);
    this.roadHoverHl.renderOrder = 9;
    this.roadHoverHl.frustumCulled = false;
    const pin = mergeGeometries([new CylinderGeometry(0.12, 0.12, 5, 6).translate(0, 2.5, 0).deleteAttribute('uv'), new SphereGeometry(0.7, 12, 8).translate(0, 5.3, 0).deleteAttribute('uv')])!;
    this.pins = new InstancedMesh(pin, new MeshStandardMaterial({ color: '#2fc4d6', roughness: 0.4, emissive: '#0b4d57', emissiveIntensity: 0.6 }), 64);
    this.pins.count = 0;
    this.pins.castShadow = true;
    this.pins.frustumCulled = false;
    this.group.add(this.lineMesh, this.previewMesh, this.curtainMesh, this.pins, this.cursorRing.mesh, this.selRing.mesh, this.hoverRing.mesh, this.roadHl, this.roadHoverHl);
  }

  setHeightfield(hf: Heightfield): void {
    this.hf = hf;
    this.cursorRing.invalidate();
    this.selRoad = '';
    this.hoverRoad = '';
    this.lineWidth = 0;
    this.rebuild(1);
  }

  setTool(v: ToolVisuals): void {
    const prevPreview = this.visuals.roadDraft?.preview;
    const prevValid = this.visuals.roadDraft?.valid;
    this.visuals = v;
    const d = v.roadDraft;
    if (!d || d.preview !== prevPreview || d.valid !== prevValid) this.rebuildPreview();
    this.rebuildDraft();
  }

  setSelection(id: string | null): void {
    this.selection = id;
    this.dyn.highlight(id);
  }

  setHover(id: string | null): void {
    this.hover = id;
  }

  private rebuild(camDist: number): void {
    void camDist;
    this.rebuildDraft();
    this.rebuildPreview();
  }

  private rebuildDraft(): void {
    const hf = this.hf;
    const d = this.visuals.roadDraft;
    if (!hf || !d) {
      this.lineMesh.visible = false;
      this.pins.count = 0;
      for (const r of this.snapRings) r.mesh.visible = false;
      return;
    }
    const pts = d.cursor ? [...d.points, d.cursor] : d.points;
    const w = Math.max(0.35, this.lineWidth);
    if (pts.length >= 2) {
      const path = Path.from(pts, 2);
      const b = new GeoBuilder();
      b.strip(path, -w / 2, w / 2, (_i, _o, x, z) => hf.y(x, z) + 0.35, w);
      const g = b.build();
      this.lineMesh.geometry.dispose();
      this.lineMesh.geometry = g ?? new BufferGeometry();
      this.lineMesh.visible = !!g;
      this.lineMat.color.set(d.valid || !d.preview ? '#fff7d6' : '#ffb4a8');
    } else this.lineMesh.visible = false;
    // pins
    const n = d.points.length;
    if (n > this.pins.instanceMatrix.count) {
      // grow
      const old = this.pins;
      this.pins = new InstancedMesh(old.geometry, old.material, Math.ceil(n * 1.5));
      this.pins.castShadow = true;
      this.pins.frustumCulled = false;
      this.group.remove(old);
      old.dispose();
      this.group.add(this.pins);
    }
    const sc = Math.max(1, this.lineWidth / 0.8);
    for (let i = 0; i < n; i += 1) {
      const p = d.points[i]!;
      this.m4.compose(this.v.set(p[0], hf.y(p[0], p[1]), p[1]), this.q.identity(), this.s.set(sc, sc, sc));
      this.pins.setMatrixAt(i, this.m4);
    }
    this.pins.count = n;
    this.pins.instanceMatrix.needsUpdate = true;
    // snap rings
    const snaps = d.snaps ?? [];
    while (this.snapRings.length < snaps.length) {
      const r = new DrapedRing('#39d5ff', 0.85, 0.3);
      this.snapRings.push(r);
      this.group.add(r.mesh);
    }
    this.snapRings.forEach((r, i) => {
      const s = snaps[i];
      r.mesh.visible = !!s;
      if (s) r.set(hf, s[0], s[1], Math.max(4, this.lineWidth * 6), Math.max(0.5, this.lineWidth * 0.8));
    });
  }

  private rebuildPreview(): void {
    const hf = this.hf;
    const pv: RoadDesign | null | undefined = this.visuals.roadDraft?.preview;
    if (!hf || !pv || pv.stations.length < 2) {
      this.previewMesh.visible = false;
      this.curtainMesh.visible = false;
      return;
    }
    const st = pv.stations;
    const base = hf.baseY;
    const half = this.roadClassWidth(pv.classId) / 2;
    const path = Path.from(
      st.map((s) => [s.x, s.z] as [number, number]),
      3,
      [st.map((s) => s.surface), st.map((s) => s.ground)],
    );
    const S = path.extra[0]!;
    const G = path.extra[1]!;
    const b = new GeoBuilder();
    b.withColor = true;
    const ok = new Color(pv.valid ? '#3ddc84' : '#ff4d4d');
    const cutC = new Color('#ff8c1a');
    const fillC = new Color('#2f7fff');
    const tmp = new Color();
    const rgba: [number, number, number, number] = [1, 1, 1, 1];
    // centre: validity colour; outer bands: cut (orange) / fill (blue), stronger with depth
    b.strip(path, -half, half, (i, _o, x, z) => Math.max(S[i]! - base, hf.y(x, z)) + 0.15, half / 2, (i, f) => {
      const edge = f <= 0.25 || f >= 0.75;
      if (!edge) tmp.copy(ok);
      else {
        const d = G[i]! - S[i]!;
        tmp.copy(ok).lerp(d > 0 ? cutC : fillC, Math.min(1, Math.abs(d) / 1.5));
      }
      rgba[0] = tmp.r;
      rgba[1] = tmp.g;
      rgba[2] = tmp.b;
      return rgba;
    });
    const g = b.build();
    this.previewMesh.geometry.dispose();
    this.previewMesh.geometry = g ?? new BufferGeometry();
    this.previewMesh.visible = !!g;
    // cut (orange) / fill (blue) curtain between the ground and the design surface along the axis
    const cb = new GeoBuilder();
    cb.withColor = true;
    const cut = new Color('#ff8c1a');
    const fill = new Color('#2f7fff');
    const n = path.count;
    for (let i = 0; i < n; i += 1) {
      // a bar standing on the ground whose height is the cut depth / fill height
      const gy = hf.y(path.x[i]!, path.z[i]!);
      const bot = Math.max(gy, Math.min(S[i]!, G[i]!) - base);
      const top = bot + Math.abs(G[i]! - S[i]!);
      const c = G[i]! > S[i]! ? cut : fill;
      const a = Math.min(1, Math.abs(G[i]! - S[i]!) / 0.3);
      cb.vertex(path.x[i]!, top + 0.12, path.z[i]!, 0, 0, c.r, c.g, c.b, a);
      cb.vertex(path.x[i]!, bot + 0.12, path.z[i]!, 0, 1, c.r, c.g, c.b, a);
    }
    for (let i = 0; i < n - 1; i += 1) {
      const k = i * 2;
      cb.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const cg = cb.build();
    this.curtainMesh.geometry.dispose();
    this.curtainMesh.geometry = cg ?? new BufferGeometry();
    this.curtainMesh.visible = !!cg;
  }

  private roadStrip(id: string, mesh: Mesh): void {
    const hf = this.hf;
    const info = this.roads.roadInfo(id);
    mesh.geometry.dispose();
    mesh.geometry = new BufferGeometry();
    if (!hf || !info) return;
    const b = new GeoBuilder();
    const S = info.path.extra[0]!;
    b.strip(info.path, -info.half - 1, info.half + 1, (i, _o, x, z) => Math.max(S[i]! - hf.baseY + 0.25, hf.y(x, z) + 0.25), 3);
    mesh.geometry = b.build() ?? new BufferGeometry();
  }

  /** per frame */
  update(t: number, camDist: number): void {
    const hf = this.hf;
    if (!hf) return;
    const want = Math.min(6, Math.max(0.35, camDist * 0.0035));
    if (Math.abs(want - this.lineWidth) / Math.max(0.1, this.lineWidth) > 0.25) {
      this.lineWidth = want;
      this.rebuildDraft();
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    // cursor ring
    const cr = this.visuals.cursorRing;
    this.cursorRing.mesh.visible = !!cr;
    if (cr) {
      this.cursorRing.mat.color.set(cr.color);
      this.cursorRing.set(hf, cr.x, cr.z, cr.radius, Math.max(0.3, camDist * 0.002));
    }
    for (const r of this.snapRings) r.mat.opacity = 0.5 + 0.45 * pulse;
    // selection
    this.placeRing(this.selRing, this.selection, camDist, 0.6 + 0.35 * pulse, this.roadHl, 'sel');
    this.roadHlMat.opacity = 0.18 + 0.2 * pulse;
    this.placeRing(this.hoverRing, this.hover && this.hover !== this.selection ? this.hover : null, camDist, 0.45, this.roadHoverHl, 'hover');
    this.dyn.pulse(t);
  }

  private placeRing(ring: DrapedRing, id: string | null, camDist: number, opacity: number, roadMesh: Mesh, which: 'sel' | 'hover'): void {
    const hf = this.hf!;
    ring.mesh.visible = false;
    roadMesh.visible = false;
    if (!id) return;
    if (this.dyn.entityPos(id, this.tmpPos) || this.locate.some((f) => f(id, this.tmpPos))) {
      ring.mesh.visible = true;
      ring.mat.opacity = opacity;
      const radius = Math.max(this.tmpPos.radius, camDist * 0.012);
      ring.set(hf, this.tmpPos.x, this.tmpPos.z, radius, Math.min(radius * .15, Math.max(.015, camDist * .0022)));
      return;
    }
    if (this.roads.roadInfo(id)) {
      const key = which === 'sel' ? this.selRoad : this.hoverRoad;
      if (key !== id) {
        this.roadStrip(id, roadMesh);
        if (which === 'sel') this.selRoad = id;
        else this.hoverRoad = id;
      }
      roadMesh.visible = true;
    }
  }

  dispose(): void {
    for (const m of [this.lineMesh, this.previewMesh, this.curtainMesh, this.roadHl, this.roadHoverHl]) m.geometry.dispose();
    for (const m of [this.lineMat, this.previewMat, this.curtainMat, this.roadHlMat, this.roadHoverMat]) m.dispose();
    this.pins.geometry.dispose();
    this.pins.dispose();
    for (const r of [...this.snapRings, this.cursorRing, this.selRing, this.hoverRing]) r.dispose();
  }
}
