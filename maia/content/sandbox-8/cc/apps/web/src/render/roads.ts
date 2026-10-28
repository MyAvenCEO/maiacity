/**
 * Network edges (existing public roads) and designed roads with their construction state.
 *
 * A designed road is rebuilt per section, only when that section's state key changes. Each section
 * is one mesh with vertex colours: stripped topsoil (draped), work in progress, formation, the
 * pavement layers stacked on the design heights (with side faces), shoulders and markings.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  Float32BufferAttribute,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SectionProgress } from '../../../../packages/roads/src/index.ts';
import type { EdgeView, RoadStatic } from '../protocol.ts';
import { gradeColor, PALETTE } from './colors.ts';
import { addDetail } from './terrain.ts';
import type { Heightfield } from './heightfield.ts';
import { GeoBuilder, Path } from './ribbon.ts';

type RGBA = [number, number, number, number];
const rgba = (hex: string, a = 1): RGBA => {
  const c = new Color(hex);
  return [c.r, c.g, c.b, a];
};

const C = {
  asphalt: rgba(PALETTE.asphalt),
  asphaltBase: rgba(PALETTE.asphaltBase),
  gravel: rgba(PALETTE.gravelGrey),
  crushed: rgba(PALETTE.crushedStone),
  wearing: rgba(PALETTE.wearing),
  formation: rgba(PALETTE.formation),
  subgrade: rgba(PALETTE.subgrade),
  stripped: rgba(PALETTE.stripped),
  disturbed: rgba(PALETTE.disturbed),
  shoulder: rgba(PALETTE.shoulder),
  verge: rgba(PALETTE.verge),
  marking: rgba(PALETTE.marking),
  grassStrip: rgba('#6f7a45'),
};

/** bottom-up order of known pavement layer ids */
const LAYER_ORDER = ['fss', 'sts', 'base', 'binder', 'surface', 'wearing'];
const layerColor = (id: string): RGBA => (id === 'fss' ? C.gravel : id === 'sts' ? C.crushed : id === 'base' || id === 'binder' ? C.asphaltBase : id === 'surface' ? C.asphalt : id === 'wearing' ? C.wearing : C.gravel);

interface RoadEntry {
  road: RoadStatic;
  path: Path;
  s0: number;
  group: Group;
  sections: { key: string; mesh: Mesh | null }[];
  outline: Mesh | null;
  condition: Mesh | null;
  conditionMat: MeshStandardMaterial | null;
  stakes: [number, number, number, number][];
  stakeKey: string;
}

export class RoadLayer {
  readonly group = new Group();
  private edgeGroup = new Group();
  private roadGroup = new Group();
  private mat: MeshStandardMaterial;
  private ghostMat: MeshStandardMaterial;
  private roads = new Map<string, RoadEntry>();
  private edges: EdgeView[] = [];
  private stakes: InstancedMesh;
  private stakeCap = 0;
  private stakesDirty = false;
  private conditionOn = false;
  private progress: Record<string, SectionProgress[]> = {};
  private grades: Record<string, number> = {};
  private hf: Heightfield | null = null;

  constructor() {
    this.mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    addDetail(this.mat, 5, 1.0, 400);
    this.ghostMat = new MeshStandardMaterial({ color: '#efe9d6', transparent: true, opacity: 0.55, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3, side: DoubleSide });
    this.group.add(this.edgeGroup, this.roadGroup);
    this.group.name = 'roads';
    // survey stake: wooden lath with a red/white painted top
    const post = new BoxGeometry(0.06, 1.1, 0.06).translate(0, 0.55, 0);
    const cap = new BoxGeometry(0.075, 0.25, 0.075).translate(0, 1.0, 0);
    const colorize = (g: BufferGeometry, c: Color) => {
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new Float32BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      return g;
    };
    const stakeGeo = mergeGeometries([colorize(post, new Color(PALETTE.stakePost)), colorize(cap, new Color(PALETTE.stakeCap))])!;
    this.stakes = new InstancedMesh(stakeGeo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 1);
    this.stakes.count = 0;
    this.stakes.castShadow = true;
    this.stakes.name = 'stakes';
    this.group.add(this.stakes);
  }

  setHeightfield(hf: Heightfield): void {
    this.hf = hf;
  }

  // ------------------------------------------------------------------ public network edges

  setEdges(edges: EdgeView[]): void {
    this.edges = edges;
    this.rebuildEdges();
  }

  private rebuildEdges(): void {
    for (const c of [...this.edgeGroup.children]) {
      this.edgeGroup.remove(c);
      (c as Mesh).geometry.dispose();
    }
    const hf = this.hf;
    if (!hf) return;
    for (const e of this.edges) {
      if (e.asset && this.roads.has(e.asset)) continue;
      if (e.points.length < 2) continue;
      const path = Path.from(e.points, 2);
      const w = Math.max(2.5, e.width);
      const half = w / 2;
      const b = new GeoBuilder();
      b.withColor = true;
      // road bed height: flat across (max of the terrain across the width) + small lift
      const ys: number[] = [];
      for (let i = 0; i < path.count; i += 1) {
        let m = -Infinity;
        for (const o of [-half - 0.6, -half / 2, 0, half / 2, half + 0.6]) m = Math.max(m, hf.y(path.x[i]! + path.nx[i]! * o, path.z[i]! + path.nz[i]! * o));
        ys.push(m);
      }
      // smooth a little along the road
      const ysm = ys.map((_, i) => (ys[Math.max(0, i - 1)]! + 2 * ys[i]! + ys[Math.min(ys.length - 1, i + 1)]!) / 4);
      for (let i = 0; i < ysm.length; i += 1) ysm[i] = Math.max(ysm[i]!, ys[i]!);
      const lift = 0.12;
      const yRoad = (i: number, o: number) => ysm[i]! + lift - Math.abs(o) * 0.02;
      if (!e.open) {
        // planned / closed: translucent dashed outline
        const g2 = new GeoBuilder();
        const yd = (_i: number, _o: number, x: number, z: number) => hf.y(x, z) + 0.15;
        g2.dashes(path, half, 0.45, 4, 3, yd);
        g2.dashes(path, -half, 0.45, 4, 3, yd);
        const geo = g2.build();
        if (geo) {
          const m = new Mesh(geo, this.ghostMat);
          m.renderOrder = 3;
          this.edgeGroup.add(m);
        }
        continue;
      }
      const asphalt = e.surface === 'asphalt' || e.surface === 'paved';
      const top = asphalt ? C.asphalt : C.wearing;
      // verge (gravel shoulders)
      b.strip(path, -half - 0.7, -half, yRoad, 2, C.verge);
      b.strip(path, half, half + 0.7, yRoad, 2, C.verge);
      b.strip(path, -half, half, yRoad, 2, top);
      const ground = (_i: number, x: number, z: number) => hf.y(x, z) - 0.3;
      b.curtain(path, half + 0.7, (i) => yRoad(i, half + 0.7), ground, 1, C.verge);
      b.curtain(path, -half - 0.7, (i) => yRoad(i, half + 0.7), ground, -1, C.verge);
      if (asphalt) {
        const ym = (i: number, o: number) => yRoad(i, o) + 0.015;
        b.dashes(path, half - 0.3, 0.13, 1, 0, ym, C.marking);
        b.dashes(path, -half + 0.3, 0.13, 1, 0, ym, C.marking);
        if (w >= 5) b.dashes(path, 0, 0.12, 3, 6, ym, C.marking);
      }
      const geo = b.build();
      if (geo) {
        const m = new Mesh(geo, this.mat);
        m.receiveShadow = true;
        m.name = `edge:${e.id}`;
        this.edgeGroup.add(m);
      }
    }
  }

  // ------------------------------------------------------------------ designed roads

  setRoads(roads: RoadStatic[]): void {
    const seen = new Set<string>();
    for (const r of roads) {
      seen.add(r.id);
      const old = this.roads.get(r.id);
      if (old && old.road.design === r.design && old.road.status === r.status) {
        old.road = r;
        continue;
      }
      if (old) this.removeRoad(r.id);
      this.addRoad(r);
    }
    for (const id of [...this.roads.keys()]) if (!seen.has(id)) this.removeRoad(id);
    this.rebuildEdges();
    this.refresh();
  }

  /** heights changed: draped parts must follow */
  terrainChanged(): void {
    for (const e of this.roads.values()) {
      for (const s of e.sections) s.key = '';
      e.stakeKey = '';
      if (e.outline) {
        e.group.remove(e.outline);
        e.outline.geometry.dispose();
        e.outline = null;
      }
    }
    this.refresh();
  }

  private addRoad(r: RoadStatic): void {
    const st = r.design.stations;
    if (st.length < 2) return;
    const pts = st.map((s) => [s.x, s.z] as [number, number]);
    const path = Path.from(pts, 2.5, [st.map((s) => s.surface), st.map((s) => s.formation), st.map((s) => s.left), st.map((s) => s.right), st.map((s) => s.ground)]);
    const group = new Group();
    group.name = `road:${r.id}`;
    this.roadGroup.add(group);
    this.roads.set(r.id, {
      road: r,
      path,
      s0: st[0]!.s,
      group,
      sections: r.design.sections.map(() => ({ key: '', mesh: null })),
      outline: null,
      condition: null,
      conditionMat: null,
      stakes: [],
      stakeKey: '',
    });
  }

  private removeRoad(id: string): void {
    const e = this.roads.get(id);
    if (!e) return;
    for (const s of e.sections) s.mesh?.geometry.dispose();
    e.outline?.geometry.dispose();
    e.condition?.geometry.dispose();
    e.conditionMat?.dispose();
    this.roadGroup.remove(e.group);
    this.roads.delete(id);
    this.stakesDirty = true;
  }

  setProgress(progress: Record<string, SectionProgress[]>, grades: Record<string, number>): void {
    this.progress = progress;
    this.grades = grades;
    this.refresh();
  }

  setConditionOverlay(on: boolean): void {
    this.conditionOn = on;
    this.refresh();
  }

  private refresh(): void {
    const hf = this.hf;
    if (!hf) return;
    for (const [id, e] of this.roads) this.refreshRoad(id, e, hf);
    if (this.stakesDirty) this.rebuildStakes();
  }

  private refreshRoad(id: string, e: RoadEntry, hf: Heightfield): void {
    const r = e.road;
    const open = r.status === 'open' || r.status === 'closed';
    const prog = this.progress[id];
    const secs = r.design.sections;
    let anyProgress = open;
    const states = secs.map((sec, k) => {
      const p = prog?.find((x) => x.index === sec.index) ?? prog?.[k];
      const done = new Set(p?.done ?? []);
      if (open) done.add('open');
      if (done.size || p?.active) anyProgress = true;
      return { done, active: p?.active };
    });
    // outline for a planned road (nothing built yet)
    if (!anyProgress && !e.outline) {
      const hw = r.carriageway / 2 + r.shoulder;
      const b = new GeoBuilder();
      const yd = (_i: number, _o: number, x: number, z: number) => hf.y(x, z) + 0.15;
      b.dashes(e.path, hw, 0.5, 5, 3, yd);
      b.dashes(e.path, -hw, 0.5, 5, 3, yd);
      b.dashes(e.path, 0, 0.3, 2, 6, yd);
      const g = b.build();
      if (g) {
        e.outline = new Mesh(g, this.ghostMat);
        e.outline.renderOrder = 3;
        e.group.add(e.outline);
      }
    } else if (anyProgress && e.outline) {
      e.group.remove(e.outline);
      e.outline.geometry.dispose();
      e.outline = null;
    }
    const stakeParts: string[] = [];
    for (let k = 0; k < secs.length; k += 1) {
      const st = states[k]!;
      const sec = secs[k]!;
      const a = st.active ? `${st.active.stage}:${Math.round(st.active.progress * 200)}` : '';
      const key = `${[...st.done].sort().join(',')}|${a}`;
      const slot = e.sections[k]!;
      const paved = LAYER_ORDER.some((l) => st.done.has(l)) || st.done.has('open');
      if (anyProgress && !paved) stakeParts.push(String(k));
      if (slot.key === key) continue;
      slot.key = key;
      if (slot.mesh) {
        e.group.remove(slot.mesh);
        slot.mesh.geometry.dispose();
        slot.mesh = null;
      }
      const g = this.buildSection(e, sec.s0, sec.s1, sec.layerThickness, st.done, st.active, hf);
      if (g) {
        const m = new Mesh(g, this.mat);
        m.receiveShadow = true;
        m.castShadow = false;
        m.name = `road:${id}:${k}`;
        m.userData.pick = { id, kind: 'road' };
        e.group.add(m);
        slot.mesh = m;
      }
    }
    const stakeKey = stakeParts.join(',');
    if (stakeKey !== e.stakeKey) {
      e.stakeKey = stakeKey;
      e.stakes = [];
      const hw = r.carriageway / 2 + r.shoulder;
      for (const kStr of stakeParts) {
        const sec = secs[Number(kStr)]!;
        const sub = e.path.sub(sec.s0 - e.s0, sec.s1 - e.s0);
        for (let s = 0; s < sub.length; s += 20) {
          const sp = sub.sub(s, s + 0.5);
          if (sp.count < 1) continue;
          const x = sp.x[0]!;
          const z = sp.z[0]!;
          const nx = sp.nx[0]!;
          const nz = sp.nz[0]!;
          for (const o of [-(hw + 1.5), 0, hw + 1.5]) {
            const px = x + nx * o;
            const pz = z + nz * o;
            e.stakes.push([px, hf.y(px, pz), pz, (s * 7 + o) % 6.28]);
          }
        }
      }
      this.stakesDirty = true;
    }
    // condition tint
    const grade = this.grades[id];
    const showCond = this.conditionOn && grade !== undefined;
    if (showCond && !e.condition) {
      const hw = r.carriageway / 2;
      const b = new GeoBuilder();
      const S = e.path.extra[0]!;
      b.strip(e.path, -hw - 0.2, hw + 0.2, (i, o) => S[i]! - hf.baseY - Math.abs(o) * 0.025 + 0.08, 4);
      const g = b.build();
      if (g) {
        e.conditionMat = new MeshStandardMaterial({ transparent: true, opacity: 0.7, depthWrite: false, roughness: 1, emissive: '#000000', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4 });
        e.condition = new Mesh(g, e.conditionMat);
        e.condition.renderOrder = 4;
        e.group.add(e.condition);
      }
    }
    if (e.condition && e.conditionMat) {
      e.condition.visible = showCond;
      if (showCond) {
        gradeColor(grade!, e.conditionMat.color);
        e.conditionMat.emissive.copy(e.conditionMat.color).multiplyScalar(0.35);
      }
    }
  }

  private buildSection(e: RoadEntry, s0: number, s1: number, thick: Record<string, number>, done: Set<string>, active: { stage: string; progress: number } | undefined, hf: Heightfield): BufferGeometry | null {
    const r = e.road;
    const full = e.path.sub(s0 - e.s0, s1 - e.s0);
    if (full.count < 2) return null;
    const L = s1 - s0;
    const partial = (p: number) => e.path.sub(s0 - e.s0, s0 - e.s0 + L * Math.min(1, Math.max(0, p)));
    const base = hf.baseY;
    const cw = r.carriageway / 2;
    const hw = cw + r.shoulder;
    const b = new GeoBuilder();
    b.withColor = true;
    const open = done.has('open') || done.has('acceptance');
    const has = (k: string) => done.has(k) || open;
    const layerIds = Object.keys(thick)
      .filter((k) => thick[k]! > 0)
      .sort((a, z) => (LAYER_ORDER.indexOf(a) + 1 || 50) - (LAYER_ORDER.indexOf(z) + 1 || 50));
    const anyLayer = layerIds.some((l) => has(l));
    const earth = has('cut') || has('fill') || has('subgrade') || anyLayer || has('shoulder');
    const drape = (lift: number) => (_i: number, _o: number, x: number, z: number) => hf.y(x, z) + lift;
    const isActive = (k: string) => active && active.stage === k && active.progress > 0;

    // design heights along a (sub)path
    const yDesign = (p: Path, which: 0 | 1, add: number) => (i: number, o: number) => p.extra[which]![i]! - base + add - Math.abs(o) * 0.025;
    const footL = (p: Path) => (i: number) => Math.max(hw, p.extra[2]![i]!);
    const footR = (p: Path) => (i: number) => -Math.max(hw, p.extra[3]![i]!);

    // 1. stripped topsoil (before earthworks change the terrain)
    if (!earth && !open) {
      if (has('topsoil')) b.strip(full, footR(full), footL(full), drape(0.07), 2, C.stripped);
      else if (isActive('topsoil')) {
        const p = partial(active!.progress);
        b.strip(p, footR(p), footL(p), drape(0.07), 2, C.stripped);
      }
      if (has('clear') && !has('topsoil')) {
        // cleared corridor: slightly trampled ground tone, very subtle
        b.strip(full, footR(full), footL(full), drape(0.05), 3, [C.verge[0] * 1.05, C.verge[1] * 1.08, C.verge[2] * 0.9, 1]);
      }
    }
    // 2. earthworks in progress
    if (!earth && (isActive('cut') || isActive('fill'))) {
      const p = partial(active!.progress);
      b.strip(p, -hw - 0.5, hw + 0.5, drape(0.1), 2, C.disturbed);
    }
    // 3. formation
    // the earthworks bring the terrain to the formation, so the formation is draped on it
    // (a pending fill / cut never shows a floating or buried strip)
    if (earth && !anyLayer) {
      const colr = has('subgrade') ? C.subgrade : C.formation;
      b.strip(full, -hw, hw, drape(0.05), 1.5, colr);
    }
    if (earth && isActive('subgrade')) {
      const p = partial(active!.progress);
      b.strip(p, -hw, hw, drape(0.08), 1.5, C.subgrade);
    }
    // design height, but never below the terrain mesh (the 4 m grid cannot follow a 6 m formation exactly)
    const guard = (f: (i: number, o: number) => number, lift = 0.04) => (i: number, o: number, x: number, z: number) => Math.max(f(i, o), hf.y(x, z) + lift);
    // 4. pavement layers on the design heights
    const totalT = layerIds.reduce((a, l) => a + thick[l]!, 0);
    const layerTop = (p: Path, idx: number) => {
      let cum = 0;
      for (let k = 0; k <= idx; k += 1) cum += thick[layerIds[k]!]!;
      return (i: number, o: number) => {
        const f = p.extra[1]![i]!;
        const sTop = p.extra[0]![i]!;
        const scale = totalT > 0 ? (sTop - f) / totalT : 0;
        return f + cum * (scale > 0 ? scale : 1) - base + 0.02 - Math.abs(o) * 0.025;
      };
    };
    const layerHalf = (id: string) => (id === 'fss' || id === 'sts' ? hw - 0.25 : id === 'base' ? cw + 0.25 : cw);
    const addLayer = (p: Path, idx: number, id: string, withSides: boolean) => {
      const half = layerHalf(id);
      const y = layerTop(p, idx);
      const colr = layerColor(id);
      const yg = guard(y, 0.04 + idx * 0.02);
      b.strip(p, -half, half, yg, 1.5, colr);
      if (withSides) {
        const bottom = (i: number) => p.extra[1]![i]! - base - 0.05;
        const side: RGBA = [colr[0] * 0.85, colr[1] * 0.85, colr[2] * 0.85, 1];
        b.curtain(p, half, (i, x, z) => yg(i, half, x, z), (i, x, z) => Math.min(bottom(i), hf.y(x, z) - 0.1), 1, side);
        b.curtain(p, -half, (i, x, z) => yg(i, half, x, z), (i, x, z) => Math.min(bottom(i), hf.y(x, z) - 0.1), -1, side);
      }
    };
    let topIdx = -1;
    layerIds.forEach((id, k) => {
      if (has(id)) {
        addLayer(full, k, id, true);
        topIdx = k;
      }
    });
    // partially placed layer
    layerIds.forEach((id, k) => {
      if (!has(id) && isActive(id)) addLayer(partial(active!.progress), k, id, true);
    });
    // 5. shoulders
    const topY = (p: Path) => (topIdx >= 0 ? layerTop(p, topIdx) : yDesign(p, 0, 0.02));
    const addShoulders = (p: Path) => {
      const y0 = topY(p);
      const ys = guard((i: number, o: number) => y0(i, cw) - (Math.abs(o) - cw) * 0.06 - 0.01, 0.05);
      b.strip(p, cw, hw, ys, 1.5, C.shoulder);
      b.strip(p, -hw, -cw, ys, 1.5, C.shoulder);
      b.curtain(p, hw, (i, x, z) => ys(i, hw, x, z), (_i, x, z) => hf.y(x, z) - 0.2, 1, C.shoulder);
      b.curtain(p, -hw, (i, x, z) => ys(i, -hw, x, z), (_i, x, z) => hf.y(x, z) - 0.2, -1, C.shoulder);
    };
    if (has('shoulder')) addShoulders(full);
    else if (isActive('shoulder')) addShoulders(partial(active!.progress));
    // 6. markings / finish when open
    if (open && topIdx >= 0) {
      const top = guard(layerTop(full, topIdx), 0.04 + topIdx * 0.02);
      const ym = (i: number, o: number, x: number, z: number) => top(i, o, x, z) + 0.012;
      if (r.surface === 'asphalt') {
        b.dashes(full, cw - 0.3, 0.12, 1, 0, ym, C.marking);
        b.dashes(full, -cw + 0.3, 0.12, 1, 0, ym, C.marking);
        if (r.carriageway >= 5) b.dashes(full, 0, 0.12, 3, 6, ym, C.marking);
      }
    }
    // tint the grass strip of gravel tracks
    if (open && r.surface !== 'asphalt' && topIdx >= 0) {
      // recolour the last strip's vertices (the centre strip) — simpler: overlay a strip in grass colour
      const top = guard(layerTop(full, topIdx), 0.04 + topIdx * 0.02);
      b.strip(full, -0.22, 0.22, (i, o, x, z) => top(i, o, x, z) + 0.01, 1, C.grassStrip);
    }
    return b.build();
  }

  private rebuildStakes(): void {
    this.stakesDirty = false;
    let total = 0;
    for (const e of this.roads.values()) total += e.stakes.length;
    if (total > this.stakeCap) {
      const cap = Math.max(64, Math.ceil(total * 1.5));
      const old = this.stakes;
      this.stakes = new InstancedMesh(old.geometry, old.material, cap);
      this.stakes.castShadow = true;
      this.stakes.name = 'stakes';
      this.group.remove(old);
      old.dispose();
      this.group.add(this.stakes);
      this.stakeCap = cap;
    }
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3(1, 1, 1);
    const up = new Vector3(0, 1, 0);
    let k = 0;
    for (const e of this.roads.values()) {
      for (const [x, y, z, rot] of e.stakes) {
        q.setFromAxisAngle(up, rot);
        m.compose(p.set(x, y - 0.1, z), q, s);
        this.stakes.setMatrixAt(k, m);
        k += 1;
      }
    }
    this.stakes.count = k;
    this.stakes.instanceMatrix.needsUpdate = true;
    this.stakes.computeBoundingSphere();
  }

  /** nearest road (by centreline) within its footprint + tolerance */
  nearestRoad(x: number, z: number, tolerance: number): { id: string; distance: number } | null {
    let best: { id: string; distance: number } | null = null;
    for (const [id, e] of this.roads) {
      const hw = e.road.carriageway / 2 + e.road.shoulder;
      const p = e.path;
      for (let i = 0; i < p.count; i += 2) {
        const d = Math.hypot(p.x[i]! - x, p.z[i]! - z);
        if (d <= hw + tolerance && (!best || d < best.distance)) best = { id, distance: d };
      }
    }
    return best;
  }

  /** path + half width + design surface for highlights */
  roadInfo(id: string): { path: Path; half: number; built: boolean } | null {
    const e = this.roads.get(id);
    if (!e) return null;
    return { path: e.path, half: e.road.carriageway / 2 + e.road.shoulder, built: e.road.status === 'open' };
  }

  roadCentre(id: string): [number, number] | null {
    const e = this.roads.get(id);
    if (!e || e.path.count === 0) return null;
    const k = e.path.count >> 1;
    return [e.path.x[k]!, e.path.z[k]!];
  }

  dispose(): void {
    for (const id of [...this.roads.keys()]) this.removeRoad(id);
    this.edges = [];
    this.rebuildEdges();
    this.stakes.geometry.dispose();
    (this.stakes.material as MeshStandardMaterial).dispose();
    this.stakes.dispose();
    this.mat.dispose();
    this.ghostMat.dispose();
  }
}
