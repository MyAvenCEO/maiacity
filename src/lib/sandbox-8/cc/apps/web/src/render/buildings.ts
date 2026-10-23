/**
 * Buildings by construction stage: site pad + fence → foundation slab → shell (masonry walls with
 * scaffolding / steel portal frames) → roof → envelope (rendered walls, windows) → finished
 * (scaffolding and fence gone, path and shrubs). A building is rebuilt only when its stage key
 * changes. Finished buildings get a warm window glow at night.
 */
import { type Object3D, type Texture, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, EdgesGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { Vec2 } from '../../../../packages/geo/src/index.ts';
import type { EntityPos } from './dynamic.ts';
import type { Heightfield } from './heightfield.ts';
import { F, Kit, type Paint } from './models.ts';
import { drawStructure, drawsStructure } from './structures.ts';
import { PATTERN, finishMaterial } from './finish.ts';
import { campAssets } from './item-assets.ts';

/** Static building data (mirrors protocol `BuildingStatic`) */
export interface BuildingStaticLike {
  id: string;
  label: string;
  type: string;
  status: string;
  corners: Vec2[];
  center: Vec2;
  rotation: number;
  length: number;
  width: number;
  floors: number;
  storeyHeight: number;
  height: number;
  roofStyle: 'gable' | 'flat' | 'shallow' | string;
  roofPitch: number;
  platform: number;
  wallColor: string;
  roofColor: string;
  form?: string;
  on?: string;
}

export type BuildingStagesLike = Record<string, { elements: string[]; stages: string[]; active?: { stage: string; progress: number } }>;

const MASONRY = '#a7593b';
const CONCRETE = '#b9b5ab';
const STEEL = '#5d6d7b';
const EARTH = '#8b7356';
const SCAFF = '#9aa3a8';
const PLANK = '#b38a52';
const GLASS = '#3a4d5c';
const FRAME = '#efefe8';
const FENCE = '#9ea5aa';

interface Entry {
  b: BuildingStaticLike;
  key: string;
  group: Group | null;
  ux: number;
  uz: number;
}

const ORDER = ['site', 'foundation', 'shell', 'roof', 'envelope', 'services', 'finishing', 'handover'];

export class BuildingLayer {
  readonly group = new Group();
  private mat = finishMaterial({ side: DoubleSide, envMapIntensity: 0.5 }, 'building');
  private glassMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.3 });
  private glowMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.3, emissive: new Color('#ffb15e'), emissiveIntensity: 0 });
  private entries = new Map<string, Entry>();
  private stages: BuildingStagesLike = {};
  private hf: Heightfield | null = null;
  private planMat = new LineBasicMaterial({ color: '#a9bcb1', transparent: true, opacity: .55 });
  private draft: Mesh;
  private draftEdges: LineSegments;
  private draftMat = new MeshStandardMaterial({ color: '#3ddc84', transparent: true, opacity: 0.38, depthWrite: false, roughness: 0.6 });
  private draftKey = '';

  constructor() {
    this.group.name = 'buildings';
    this.draft = new Mesh(new BoxGeometry(1, 1, 1), this.draftMat);
    this.draft.visible = false;
    this.draft.renderOrder = 6;
    this.draftEdges = new LineSegments(new EdgesGeometry(new BoxGeometry(1, 1, 1)), new LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }));
    this.draftEdges.visible = false;
    this.group.add(this.draft, this.draftEdges);
  }

  setEnvMap(tex: Texture | null): void {
    for (const m of [this.mat, this.glassMat, this.glowMat]) {
      m.envMap = tex;
      m.needsUpdate = true;
    }
  }

  setHeightfield(hf: Heightfield): void {
    this.hf = hf;
    for (const e of this.entries.values()) e.key = '';
    this.draftKey = '';
    this.refresh();
  }

  setBuildings(list: BuildingStaticLike[]): void {
    const seen = new Set<string>();
    for (const b of list) {
      if (b.status === 'cancelled' || b.status === 'struck' || b.status === 'demolished' || !b.corners || b.corners.length < 4) continue;
      seen.add(b.id);
      const c0 = b.corners[0]!;
      const c1 = b.corners[1]!;
      const l = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) || 1;
      const ex = this.entries.get(b.id);
      if (ex) {
        if (ex.b.platform !== b.platform || ex.b.length !== b.length || ex.b.width !== b.width || ex.b.height !== b.height || ex.b.rotation !== b.rotation || ex.b.type !== b.type || ex.b.status !== b.status || ex.b.center[0] !== b.center[0] || ex.b.center[1] !== b.center[1]) ex.key = '';
        ex.b = b;
        ex.ux = (c1[0] - c0[0]) / l;
        ex.uz = (c1[1] - c0[1]) / l;
      } else this.entries.set(b.id, { b, key: '', group: null, ux: (c1[0] - c0[0]) / l, uz: (c1[1] - c0[1]) / l });
    }
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) {
        this.drop(e);
        this.entries.delete(id);
      }
    }
    this.refresh();
  }

  setStages(stages: BuildingStagesLike | undefined): void {
    this.stages = stages ?? {};
    this.refresh();
  }

  /** a structure that is not a building (a tent, a hut, a wall, a caravan set up), `p` put up */
  private structure(e: Entry, p: number, hf: Heightfield): Group | null {
    const b = e.b;
    const k = new Kit(new Color(b.wallColor));
    const glass = new Kit(new Color(GLASS));
    // (the ground under it, from its local axes, against the level it stands on)
    const ground = (lx: number, lz: number) => hf.y(b.center[0] + e.ux * lx - e.uz * lz, b.center[1] + e.uz * lx + e.ux * lz) + hf.baseY - b.platform;
    drawStructure(b, p, k, glass, ground);
    if (k.empty && glass.empty) return null;
    const group = new Group();
    for (const [kit, mat] of [[k, this.mat], [glass, this.glassMat]] as const) {
      if (kit.empty) continue;
      const mesh = new Mesh(kit.build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    group.position.set(b.center[0], b.platform - hf.baseY, b.center[1]);
    group.rotation.y = Math.atan2(-e.uz, e.ux);
    group.name = `structure:${b.id}`;
    return group;
  }

  private drop(e: Entry): void {
    if (!e.group) return;
    this.group.remove(e.group);
    e.group.traverse((o) => (o as Mesh).geometry?.dispose());
    e.group = null;
  }

  private refresh(): void {
    const hf = this.hf;
    if (!hf) return;
    for (const [id, e] of this.entries) {
      const st = this.stages[id];
      const complete = e.b.status === 'standing';
      const done = new Set(complete ? ORDER : st?.stages ?? []);
      const a = !complete && st?.active && st.active.progress > 0 ? st.active : undefined;
      const key = `${st?.elements.join(',') ?? ''}|${[...done].sort().join(',')}|${a ? `${a.stage}:${Math.round(a.progress * 50)}` : ''}`;
      if (key === e.key) continue;
      e.key = key;
      this.drop(e);
      const g = this.build(e, done, a, hf);
      if (g) {
        g.userData.pick = { id, kind: 'structure' };
        this.group.add(g);
        e.group = g;
      }
    }
  }

  private build(e: Entry, done: Set<string>, active: { stage: string; progress: number } | undefined, hf: Heightfield): Group | null {
    const b = e.b;
    // A set-up vehicle keeps its body; its structure adds only physical setup parts.
    if (b.on) return this.structure(e, b.status === 'standing' ? 1 : (active?.progress ?? 0), hf);
    if (campAssets[b.type]) return this.buildCamp(e, hf);
    if (drawsStructure(b)) return this.structure(e, b.status === 'standing' ? 1 : (active?.progress ?? (done.size ? 1 : 0)), hf);
    const L = b.length;
    const W = b.width;
    const Hs = b.storeyHeight;
    const Fl = Math.max(1, b.floors);
    const Hw = Fl * Hs;
    const house = b.type !== 'hall';
    const prog = (s: string) => (done.has(s) ? 1 : active?.stage === s ? active.progress : 0);
    const has = (s: string) => done.has(s);
    const any = ORDER.some((s) => prog(s) > 0);
    const finished = has('finishing') || has('handover') || b.status === 'standing';
    const k = new Kit(new Color(b.wallColor));
    const glass = new Kit(new Color(GLASS));
    const glow = new Kit(new Color(GLASS));
    const cx = b.center[0];
    const cz = b.center[1];
    const ux = e.ux;
    const uz = e.uz;
    // local → world for terrain queries (local z axis = (−uz, ux))
    const wx = (lx: number, lz: number) => cx + ux * lx - uz * lz;
    const wz = (lx: number, lz: number) => cz + uz * lx + ux * lz;
    const ground = (lx: number, lz: number) => hf.y(wx(lx, lz), wz(lx, lz)) + hf.baseY - b.platform;
    const base = 0.3;
    if (!any) {
      // planned only: a faint footprint outline of stakes at the corners
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const)
        k.box(0.08, 1.2, 0.08, (sx * L) / 2, ground((sx * L) / 2, (sz * W) / 2) + 0.5, (sz * W) / 2, '#e0402c');
    }
    // ---- site: levelled pad + construction fence
    const ps = prog('site');
    const m = 3;
    if (ps > 0) {
      const PL = (L + 2 * m) * ps;
      let low = 0;
      for (const fx of [-0.5, 0, 0.5]) for (const fz of [-0.5, 0, 0.5]) low = Math.min(low, ground(fx * (L + 2 * m), fz * (W + 2 * m)));
      const depth = 0.05 - low + 0.3;
      k.box(PL, depth, W + 2 * m, -(L + 2 * m) / 2 + PL / 2, 0.05 - depth / 2, 0, finished ? F('#5f7340', 'rough') : F(EARTH, 'rough'));
      if (!finished) {
        const FL = L + 2 * m + 2;
        const FW = W + 2 * m + 2;
        // (while the fence goes up: its feet and posts, the panels hung once it is round)
        const post = (x: number, z: number) => {
          if (ps < 1) k.tube([x, Math.max(0, ground(x, z)), z], [x, Math.max(0, ground(x, z)) + 2, z], 0.02, F(FENCE, 'galv'), 5).box(0.62, 0.14, 0.18, x, Math.max(0, ground(x, z)) + 0.07, z, F('#8c8a86', 'concrete'));
        };
        const step = 2.5;
        const per = 2 * (FL + FW);
        for (let s = 0; s < per * ps; s += step) {
          let x: number;
          let z: number;
          if (s < FL) [x, z] = [-FL / 2 + s, -FW / 2];
          else if (s < FL + FW) [x, z] = [FL / 2, -FW / 2 + (s - FL)];
          else if (s < 2 * FL + FW) [x, z] = [FL / 2 - (s - FL - FW), FW / 2];
          else [x, z] = [-FL / 2, FW / 2 - (s - 2 * FL - FW)];
          post(x, z);
        }
        // mobile fence panels (Bauzaun): a tube frame with its mesh, standing in concrete feet
        const panel = (x0: number, z0: number, x1: number, z1: number) => {
          const len = Math.hypot(x1 - x0, z1 - z0);
          const ry = -Math.atan2(z1 - z0, x1 - x0);
          const ca = Math.cos(ry);
          const sa = -Math.sin(ry);
          const n = Math.max(1, Math.round(len / 3.5));
          for (let i = 0; i < n; i += 1) {
            const u0 = (i / n) * len;
            const u1 = ((i + 1) / n) * len;
            const at = (u: number): [number, number] => [x0 + ca * u, z0 + sa * u];
            const [ax, az] = at(u0 + 0.03);
            const [bx, bz] = at(u1 - 0.03);
            const ya = Math.max(0, ground(ax, az));
            const yb = Math.max(0, ground(bx, bz));
            for (const [x, z, y] of [[ax, az, ya], [bx, bz, yb]] as const) {
              k.tube([x, y + 0.08, z], [x, y + 2.0, z], 0.02, F(FENCE, 'galv'), 5);
              k.box(0.62, 0.14, 0.18, x, y + 0.07, z, F('#8c8a86', 'concrete'), 0, ry);
            }
            for (const yy of [0.1, 2.0]) k.tube([ax, ya + yy, az], [bx, yb + yy, bz], 0.018, F(FENCE, 'galv'), 5);
            const m = Math.round((u1 - u0) / 0.2);
            for (let j = 1; j < m; j += 1) {
              const [x, z] = at(u0 + ((u1 - u0) * j) / m);
              const y = ya + ((yb - ya) * j) / m;
              k.box(0.006, 1.88, 0.006, x, y + 1.05, z, F(FENCE, 'galv'));
            }
            for (let yy = 0.3; yy < 2.0; yy += 0.3) k.tube([ax, ya + yy, az], [bx, yb + yy, bz], 0.003, F(FENCE, 'galv'), 3);
          }
        };
        if (ps >= 1) {
          panel(-FL / 2, -FW / 2, FL / 2, -FW / 2);
          panel(FL / 2, -FW / 2, FL / 2, FW / 2);
          panel(-FL / 2, FW / 2, -FL / 2, -FW / 2);
          // gate gap on the +z side
          panel(FL / 2, FW / 2, 2.5, FW / 2);
          panel(-2.5, FW / 2, -FL / 2, FW / 2);
        }
      }
    }
    // ---- foundation slab
    const pf = prog('foundation');
    if (pf > 0) {
      const SL = (L + 0.3) * pf;
      k.box(SL, 0.45, W + 0.3, -(L + 0.3) / 2 + SL / 2, base - 0.225, 0, F(CONCRETE, 'concrete'));
    }
    // ---- shell
    const pSh = prog('shell');
    const envDone = has('envelope');
    const pEnv = prog('envelope');
    // the shell in clay blocks (Planziegel), rendered once the envelope is on; a hall's in profiled sheet
    const rendered = envDone || (pEnv > 0.5 && house);
    const wallCol: Paint = rendered ? F(b.wallColor, house ? 'render' : 'sheet') : F(MASONRY, [0.92, 0, PATTERN.blocks]);
    let wallH = 0;
    if (pSh > 0) {
      wallH = Hw * pSh;
      const t = 0.36;
      if (house || envDone || pEnv > 0) {
        const hc = house ? wallH : Hw * (envDone ? 1 : pEnv);
        if (hc > 0.05) {
          k.box(L, hc, t, 0, base + hc / 2, -W / 2 + t / 2, wallCol);
          k.box(L, hc, t, 0, base + hc / 2, W / 2 - t / 2, wallCol);
          k.box(t, hc, W - 2 * t, -L / 2 + t / 2, base + hc / 2, 0, wallCol);
          k.box(t, hc, W - 2 * t, L / 2 - t / 2, base + hc / 2, 0, wallCol);
          // storey slabs (visible from above before the roof)
          for (let f = 1; f < Fl; f += 1) if (f * Hs < hc) k.box(L - 2 * t, 0.22, W - 2 * t, 0, base + f * Hs, 0, F(CONCRETE, 'concrete'));
          // the plinth (Sockel): a darker, harder render where the rain splashes; a hall's concrete upstand
          k.box(L + 0.04, 0.45, W + 0.04, 0, base + 0.2, 0, house ? F('#8f8a80', 'render') : F('#8b8d8f', 'concrete'));
          if (!rendered && !house) for (const z of [-W / 2 + 0.2, W / 2 - 0.2]) void z;
        }
      }
      if (!house) {
        // steel portal frames: columns + rafters
        const n = Math.max(2, Math.round(L / 6) + 1);
        for (let i = 0; i < n; i += 1) {
          const x = -L / 2 + 0.2 + ((L - 0.4) * i) / (n - 1);
          for (const z of [-W / 2 + 0.2, W / 2 - 0.2]) k.box(0.3, wallH, 0.3, x, base + wallH / 2, z, F(STEEL, 'dull'));
          if (pSh >= 1) {
            const rise = (W / 2) * Math.tan((Math.max(3, b.roofPitch) * Math.PI) / 180);
            for (const sgn of [-1, 1]) {
              const len = Math.hypot(W / 2, rise);
              const g = new BoxGeometry(0.25, 0.5, len);
              g.rotateX(sgn * Math.atan2(rise, W / 2));
              g.translate(x, base + Hw + rise / 2, (sgn * W) / 4);
              k.add(g, F(STEEL, 'dull'));
            }
          }
        }
        if (pSh >= 1) for (const z of [-W / 2 + 0.2, W / 2 - 0.2]) k.box(L, 0.35, 0.25, 0, base + Hw, z, F(STEEL, 'dull'));
      }
      // window openings in raw masonry
      if (house && !envDone && pSh >= 1 && pEnv <= 0.5) this.windows(L, W, Fl, Hs, base, (x, y, z, w, h, ry) => k.box(w, h, 0.05, x, y, z, F('#2b2523', 'matte'), 0, ry));
    }
    // ---- roof
    const pR = prog('roof');
    const pitchDeg = b.roofStyle === 'flat' ? 0 : Math.max(b.roofStyle === 'shallow' ? 4 : 15, b.roofPitch);
    const pitch = (pitchDeg * Math.PI) / 180;
    const o = house ? 0.5 : 0.3;
    const top = base + Hw;
    const rise = (W / 2 + o) * Math.tan(pitch);
    const wallRise = (W / 2) * Math.tan(pitch);
    if (pSh >= 1 && house && b.roofStyle !== 'flat') {
      // gable triangles (part of the shell)
      for (const sx of [-1, 1]) {
        const x = (sx * (L - 0.36)) / 2;
        const g = triPrism(W, wallRise, 0.36);
        g.translate(x, top, 0);
        k.add(g, wallCol);
      }
    }
    if (pR > 0) {
      const RL = (L + 2 * o) * pR;
      const x0 = -(L + 2 * o) / 2 + RL / 2;
      if (b.roofStyle === 'flat') {
        k.box(RL, 0.35, W + 0.2, x0, top + 0.17, 0, F(b.roofColor, 'rough'));
      } else {
        const slope = (W / 2 + o) / Math.cos(pitch);
        // clay tiles on a house, profiled sheet on a hall; the battens and tiles going on from one end
        const cover: Paint = house ? F(b.roofColor, 'tile') : F(b.roofColor, 'sheet');
        for (const sgn of [-1, 1]) {
          const g = new BoxGeometry(RL, 0.22, slope);
          g.rotateX(sgn * pitch);
          g.translate(x0, top + wallRise - rise / 2 + 0.12, (sgn * (W / 2 + o)) / 2);
          k.add(g, cover);
        }
        if (pR >= 1) k.box(L + 2 * o, 0.18, 0.3, 0, top + wallRise + 0.2, 0, F(new Color(b.roofColor).multiplyScalar(0.72).getStyle(), [0.7, 0, 0]));
        if (house && pR >= 1) {
          // fascia and verge boards, the half-round gutters and their downpipes
          const ye = top + wallRise - rise + 0.12;
          const ZN = F('#9ba1a6', 'galv');
          for (const sz of [-1, 1]) {
            k.box(L + 2 * o, 0.2, 0.03, 0, ye - 0.08, sz * (W / 2 + o + 0.02), F('#e9e6df', 'paint'));
            k.add(new CylinderGeometry(0.07, 0.07, L + 2 * o, 10, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(sz > 0 ? 0 : Math.PI).translate(0, ye - 0.1, sz * (W / 2 + o + 0.1)), ZN);
            for (const sx of [-1, 1]) {
              const x = sx * (L / 2 - 0.25);
              k.bar([[x, ye - 0.15, sz * (W / 2 + o + 0.1)], [x, ye - 0.55, sz * (W / 2 + 0.09)], [x, base + 0.25, sz * (W / 2 + 0.09)], [x + sx * 0.12, base + 0.1, sz * (W / 2 + 0.12)]], 0.045, ZN, 8);
            }
            for (const sx of [-1, 1]) k.tube([sx * (L / 2 + o), ye - 0.02, sz * (W / 2 + o)], [sx * (L / 2 + o), top + wallRise + 0.18, 0], 0.07, F('#e9e6df', 'paint'), 4);
          }
        }
        if (!house && pR >= 1) {
          // hall: closed gable ends in cladding colour
          for (const sx of [-1, 1]) {
            const g = triPrism(W, wallRise, 0.15);
            g.translate((sx * (L - 0.15)) / 2, top, 0);
            k.add(g, envDone ? 'B' : STEEL);
          }
        }
      }
      if (house && pR >= 1 && has('roof')) {
        // the chimney of the heating, through the roof near the ridge: brick, with its cap
        const cy = top + wallRise * 0.62;
        k.box(0.52, 1.5, 0.52, L * 0.22, cy + 0.4, W * 0.16, F('#9a4a36', [0.92, 0, PATTERN.brick])).box(0.66, 0.08, 0.66, L * 0.22, cy + 1.19, W * 0.16, F('#9a9790', 'concrete'));
        k.tube([L * 0.22, cy + 1.2, W * 0.16], [L * 0.22, cy + 1.42, W * 0.16], 0.09, F('#5e6266', 'dull'), 8);
      }
    }
    // ---- envelope: windows / doors
    if (envDone || pEnv > 0.5) {
      const lit = finished;
      if (house) {
        this.windows(L, W, Fl, Hs, base, (x, y, z, w, h, ry, idx) => {
          const side = Math.round(Math.cos(ry)) === 0;
          const nx = side ? Math.sign(x) : 0;
          const nz = side ? 0 : Math.sign(z);
          const o2 = (d: number): [number, number] => [x + nx * d, z + nz * d];
          // the frame in its reveal, two casements with a mullion between them, the sill below
          const [fx, fz] = o2(0.01);
          k.box(w + 0.12, h + 0.12, 0.07, fx, y, fz, F(FRAME, 'plastic'), 0, ry);
          const target = lit && hash(idx + Math.round(cx)) > 0.35 ? glow : glass;
          const [gx, gz] = o2(0.05);
          target.box(w - 0.08, h - 0.08, 0.02, gx, y, gz, GLASS, 0, ry);
          const [mx, mz] = o2(0.06);
          k.box(0.07, h - 0.06, 0.03, mx, y, mz, F(FRAME, 'plastic'), 0, ry);
          const [sx2, sz2] = o2(0.07);
          k.box(w + 0.22, 0.04, 0.16, sx2, y - h / 2 - 0.08, sz2, F('#c9c6bd', 'concrete'), 0, ry);
          const [rx, rz] = o2(0.03);
          k.box(w + 0.12, 0.2, 0.08, rx, y + h / 2 + 0.16, rz, F('#dcd8cf', 'plastic'), 0, ry);
        });
        // the front door of boards with its glass strip, a canopy over it, a step before it
        k.box(1.1, 2.15, 0.08, 0, base + 1.08, W / 2 + 0.02, F('#5a3d2b', 'boards'));
        glass.box(0.16, 1.5, 0.02, 0.32, base + 1.15, W / 2 + 0.065, GLASS);
        k.box(0.04, 0.3, 0.05, -0.38, base + 1.05, W / 2 + 0.08, F('#b7bbbf', 'metal'));
        k.box(1.7, 0.08, 1.0, 0, base + 2.5, W / 2 + 0.5, F('#3b3e41', 'dull'));
        for (const sx of [-0.8, 0.8]) k.tube([sx, base + 2.48, W / 2 + 0.95], [sx, base + 2.48, W / 2 + 0.05], 0.025, F('#3b3e41', 'dull'), 6);
        k.box(1.5, 0.16, 0.6, 0, base - 0.1, W / 2 + 0.3, F('#a7a49c', 'concrete'));
      } else {
        // hall: window band on the long sides, sectional door on a gable end
        for (const sz of [-1, 1]) {
          const n = Math.max(1, Math.floor((L - 4) / 5));
          for (let i = 0; i < n; i += 1) {
            const x = -L / 2 + 2.5 + ((L - 5) * (i + 0.5)) / n;
            const target = lit && hash(i * 7 + sz) > 0.3 ? glow : glass;
            target.box(3.2, 0.9, 0.05, x, base + Math.min(Hw - 1, 3.4), sz * (W / 2 + 0.03), GLASS);
          }
        }
        const dh = Math.min(4.5, Hw - 0.6);
        k.box(0.08, dh, Math.min(5, W * 0.4), L / 2 + 0.03, base + dh / 2, 0, '#c9ccd0');
        k.box(0.06, 2.1, 1.0, L / 2 + 0.03, base + 1.05, W * 0.35, '#4a5560');
      }
    }
    // ---- scaffolding (houses) while shell / roof / envelope are under way
    if (house && pSh > 0 && !envDone) {
      const sh = Math.min(Hw + 1.2, wallH + 1.2);
      const off = 1.0;
      const SL = L + 2 * off;
      const SW = W + 2 * off;
      const per = 2 * (SL + SW);
      const pole = (x: number, z: number) => k.tube([x, base - 0.3, z], [x, base + sh - 0.3, z], 0.024, F(SCAFF, 'galv'), 6);
      for (let s = 0; s < per; s += 2.5) {
        let x: number;
        let z: number;
        if (s < SL) [x, z] = [-SL / 2 + s, -SW / 2];
        else if (s < SL + SW) [x, z] = [SL / 2, -SW / 2 + (s - SL)];
        else if (s < 2 * SL + SW) [x, z] = [SL / 2 - (s - SL - SW), SW / 2];
        else [x, z] = [-SL / 2, SW / 2 - (s - 2 * SL - SW)];
        pole(x, z);
      }
      for (let y = 2; y <= sh - 0.5; y += 2) {
        const PL = F(PLANK, 'wood');
        const SC = F(SCAFF, 'galv');
        k.box(SL, 0.05, 0.6, 0, base + y - 0.3, -SW / 2 + 0.3, PL);
        k.box(SL, 0.05, 0.6, 0, base + y - 0.3, SW / 2 - 0.3, PL);
        k.box(0.6, 0.05, SW - 1.2, -SL / 2 + 0.3, base + y - 0.3, 0, PL);
        k.box(0.6, 0.05, SW - 1.2, SL / 2 - 0.3, base + y - 0.3, 0, PL);
        for (const yy of [0.2, 0.7]) {
          k.box(SL, 0.04, 0.04, 0, base + y + yy, -SW / 2, SC);
          k.box(SL, 0.04, 0.04, 0, base + y + yy, SW / 2, SC);
          k.box(0.04, 0.04, SW, -SL / 2, base + y + yy, 0, SC);
          k.box(0.04, 0.04, SW, SL / 2, base + y + yy, 0, SC);
        }
        // toe boards, and a diagonal brace each bay along the long sides
        k.box(SL, 0.15, 0.03, 0, base + y - 0.2, -SW / 2 + 0.02, PL).box(SL, 0.15, 0.03, 0, base + y - 0.2, SW / 2 - 0.02, PL);
      }
    }
    // ---- finished: path and a few shrubs
    if (finished) {
      const pathLen = m + 1;
      k.box(1.3, 0.06, pathLen, 0, 0.05, W / 2 + pathLen / 2, F('#a8a397', [0.9, 0, PATTERN.concrete]));
      if (house) {
        for (let i = 0; i < 5; i += 1) {
          const sx = -L / 2 + 0.8 + i * ((L - 1.6) / 4);
          if (Math.abs(sx) < 1.3) continue;
          const g = new SphereGeometry(0.55 + 0.2 * hash(i + cx), 7, 5);
          g.scale(1, 0.8, 1);
          g.translate(sx, 0.45, W / 2 + 1.2);
          k.add(g, F(i % 2 ? '#3f6b35' : '#4c7a3c', 'bark'));
        }
      }
    }
    if (k.empty && glass.empty && glow.empty) return null;
    const group = new Group();
    const add = (kit: Kit, mat: MeshStandardMaterial) => {
      if (kit.empty) return;
      const mesh = new Mesh(kit.build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    add(k, this.mat);
    add(glass, this.glassMat);
    add(glow, this.glowMat);
    group.position.set(cx, b.platform - hf.baseY, cz);
    group.rotation.y = Math.atan2(-uz, ux);
    group.name = `building:${b.id}`;
    return group;
  }

  private buildCamp(e: Entry, hf: Heightfield): Group {
    const b = e.b;
    const group = new Group();
    const asset = campAssets[b.type];
    // The kit planner currently has one physical element, `build`. A pad or intent is not a tent.
    const built = this.stages[b.id]?.elements.includes('build') ?? false;
    if (asset && built) {
      // The upstream kit recipe has the better vestibule, guys, window sheets and materials.
      // It is still shown only after the kit's physical build element completes.
      const model = this.structure(e, 1, hf);
      if (model) { model.name = `camp:${b.id}`; return model; }
    } else {
      // A plan overlay, not physical stakes, foundations or a partially inflated finished asset.
      const g = new BufferGeometry();
      const x = b.length / 2;
      const z = b.width / 2;
      g.setAttribute('position', new Float32BufferAttribute([-x, .03, -z, x, .03, -z, x, .03, -z, x, .03, z, x, .03, z, -x, .03, z, -x, .03, z, -x, .03, -z], 3));
      group.add(new LineSegments(g, this.planMat));
    }
    group.position.set(b.center[0], b.platform - hf.baseY, b.center[1]);
    group.rotation.y = Math.atan2(-e.uz, e.ux);
    group.name = `camp:${b.id}`;
    return group;
  }

  /** regular windows per storey on all four walls (houses) */
  private windows(L: number, W: number, F: number, Hs: number, base: number, cb: (x: number, y: number, z: number, w: number, h: number, ry: number, idx: number) => void): void {
    let idx = 0;
    const ww = 1.2;
    const wh = 1.3;
    for (let f = 0; f < F; f += 1) {
      const y = base + f * Hs + 0.9 + wh / 2;
      for (const sz of [-1, 1]) {
        const n = Math.max(1, Math.floor((L - 1) / 3));
        for (let i = 0; i < n; i += 1) {
          const x = -L / 2 + (L * (i + 0.5)) / n;
          if (f === 0 && sz === 1 && Math.abs(x) < 1.0) continue; // door
          cb(x, y, sz * (W / 2 + 0.02), ww, wh, 0, idx++);
        }
      }
      for (const sx of [-1, 1]) {
        const n = Math.max(1, Math.floor((W - 1) / 3.5));
        for (let i = 0; i < n; i += 1) {
          const z = -W / 2 + (W * (i + 0.5)) / n;
          cb(sx * (L / 2 + 0.02), y, z, ww, wh, Math.PI / 2, idx++);
        }
      }
    }
  }

  /** placement ghost */
  setDraft(d: { corners: Vec2[]; height: number; valid: boolean } | undefined): void {
    const hf = this.hf;
    if (!d || !hf || d.corners.length < 4) {
      this.draft.visible = false;
      this.draftEdges.visible = false;
      this.draftKey = '';
      return;
    }
    const c = d.corners;
    const key = `${c.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(';')}|${d.height}|${d.valid}`;
    this.draftMat.color.set(d.valid ? '#3ddc84' : '#ff4d4d');
    this.draft.visible = true;
    this.draftEdges.visible = true;
    if (key === this.draftKey) return;
    this.draftKey = key;
    const c0 = c[0]!;
    const c1 = c[1]!;
    const c3 = c[3]!;
    const L = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    const W = Math.hypot(c3[0] - c0[0], c3[1] - c0[1]);
    const cx = (c[0]![0] + c[1]![0] + c[2]![0] + c[3]![0]) / 4;
    const cz = (c[0]![1] + c[1]![1] + c[2]![1] + c[3]![1]) / 4;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of [...c, [cx, cz] as Vec2]) {
      const y = hf.y(p[0], p[1]);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    const H = d.height + (hi - lo);
    const rot = Math.atan2(-(c1[1] - c0[1]), c1[0] - c0[0]);
    for (const o of [this.draft, this.draftEdges]) {
      o.position.set(cx, lo + H / 2, cz);
      o.rotation.set(0, rot, 0);
      o.scale.set(Math.max(0.1, L), Math.max(0.1, H), Math.max(0.1, W));
    }
  }

  /** per frame: window glow follows the daylight */
  update(daylight: number, realLighting: boolean): void {
    this.glowMat.emissiveIntensity = realLighting ? Math.max(0, 1 - daylight * 1.6) * 1.8 : 0;
  }

  pickables(out: Object3D[]): void {
    for (const e of this.entries.values()) if (e.group) out.push(e.group);
  }

  buildingAt(x: number, z: number, tol: number): string | null {
    for (const [id, e] of this.entries) {
      const dx = x - e.b.center[0];
      const dz = z - e.b.center[1];
      const lx = dx * e.ux + dz * e.uz;
      const lz = -dx * e.uz + dz * e.ux;
      if (Math.abs(lx) <= e.b.length / 2 + tol && Math.abs(lz) <= e.b.width / 2 + tol) return id;
    }
    return null;
  }

  entityPos(id: string, out: EntityPos): boolean {
    const e = this.entries.get(id);
    if (!e || !this.hf) return false;
    out.x = e.b.center[0];
    out.z = e.b.center[1];
    out.y = e.b.platform - this.hf.baseY;
    out.radius = Math.hypot(e.b.length, e.b.width) / 2 + 2;
    out.kind = 'structure';
    return true;
  }

  dispose(): void {
    for (const e of this.entries.values()) this.drop(e);
    this.planMat.dispose();
    this.entries.clear();
    this.draft.geometry.dispose();
    this.draftEdges.geometry.dispose();
    for (const m of [this.mat, this.glassMat, this.glowMat, this.draftMat]) m.dispose();
    (this.draftEdges.material as LineBasicMaterial).dispose();
  }
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** gable triangle prism: base width W on y = 0, apex at y = rise, thickness t along x */
function triPrism(W: number, rise: number, t: number): BufferGeometry {
  const h = t / 2;
  const P = [
    [-h, 0, -W / 2],
    [-h, 0, W / 2],
    [-h, rise, 0],
    [h, 0, -W / 2],
    [h, 0, W / 2],
    [h, rise, 0],
  ];
  const tris = [
    [0, 2, 1],
    [3, 4, 5],
    [0, 3, 5],
    [0, 5, 2],
    [1, 2, 5],
    [1, 5, 4],
    [0, 1, 4],
    [0, 4, 3],
  ];
  const pos: number[] = [];
  for (const t3 of tris) for (const i of t3) pos.push(...(P[i] as number[]));
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
