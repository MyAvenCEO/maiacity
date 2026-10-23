/**
 * Things that change every frame: machines, supplier trucks, people, stockpiles, the depot and
 * work-front markers. Positions/headings are interpolated between simulation frames.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  type Texture,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { Frame, MachineView, PersonView, StoreView, TripView, WorkfrontView } from '../protocol.ts';
import { carrierVisual } from './item-assets.ts';
import { hash2 } from './colors.ts';
import type { Heightfield } from './heightfield.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { animateRig, buildMachine, Kit, type MachineRig } from './models.ts';
import { DrapedRing } from './rings.ts';
import { addDetail } from './terrain.ts';
import { finishMaterial } from './finish.ts';
import { drawGoods } from './goods.ts';

const LERP_MS = 140;
const TAU = Math.PI * 2;

const strHash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};

interface Mover {
  fx: number;
  fz: number;
  fh: number;
  tx: number;
  tz: number;
  th: number;
  x: number;
  z: number;
  h: number;
  t0: number;
  moving: boolean;
}

function newMover(x: number, z: number, h: number, now: number): Mover {
  return { fx: x, fz: z, fh: h, tx: x, tz: z, th: h, x, z, h, t0: now, moving: false };
}

function retarget(m: Mover, x: number, z: number, h: number, now: number): void {
  const jump = Math.hypot(x - m.x, z - m.z);
  m.moving = jump > 0.05;
  if (jump > 250) {
    // teleport (fast-forward): no sliding across the map
    m.fx = m.tx = m.x = x;
    m.fz = m.tz = m.z = z;
    m.fh = m.th = m.h = h;
    m.t0 = now - LERP_MS;
    return;
  }
  m.fx = m.x;
  m.fz = m.z;
  m.fh = m.h;
  m.tx = x;
  m.tz = z;
  // unwrap the heading to the nearest equivalent angle
  let d = (h - m.h) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  m.th = m.h + d;
  m.t0 = now;
}

function step(m: Mover, now: number): void {
  const f = Math.min(1, (now - m.t0) / LERP_MS);
  const e = f * (2 - f);
  m.x = m.fx + (m.tx - m.fx) * e;
  m.z = m.fz + (m.tz - m.fz) * e;
  m.h = m.fh + (m.th - m.fh) * e;
}

interface MachineObj {
  rig: MachineRig;
  mover: Mover;
  view: MachineView | TripView;
  working: boolean;
  seed: number;
  key: string;
  kind: 'machine' | 'trip';
}

class Instanced {
  mesh: InstancedMesh;
  cap: number;
  constructor(
    private geo: BufferGeometry,
    private mat: MeshStandardMaterial,
    private parent: Group,
    private name: string,
    cap = 64,
    private shadow = true,
  ) {
    this.cap = cap;
    this.mesh = this.make(cap);
  }
  private make(cap: number): InstancedMesh {
    const m = new InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.castShadow = this.shadow;
    m.receiveShadow = true;
    m.name = this.name;
    m.frustumCulled = false;
    this.parent.add(m);
    return m;
  }
  ensure(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.ceil(n * 1.5);
    const old = this.mesh;
    this.mesh = this.make(cap);
    this.mesh.userData = old.userData;
    this.parent.remove(old);
    old.dispose();
    this.cap = cap;
  }
}

export interface EntityPos {
  x: number;
  z: number;
  y: number;
  radius: number;
  kind: string;
}

export class DynamicLayer {
  readonly group = new Group();
  private machineMat = finishMaterial({ envMapIntensity: 0.7, side: DoubleSide }, 'machine');
  private loadMat = new MeshStandardMaterial({ color: '#7a5d40', roughness: 1 });
  private figureMat = new MeshStandardMaterial({ roughness: 0.8 });
  private heapMat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  private heapDetail = addDetail(this.heapMat, 2.5, 0.9, 300);
  private flagMat = new MeshStandardMaterial({ roughness: 0.7, side: 2 });
  private plainMat = finishMaterial({ envMapIntensity: 0.6 }, 'plain');
  readonly highlightMat: MeshStandardMaterial;
  private machines = new Map<string, MachineObj>();
  private people = new Map<string, { mover: Mover; view: PersonView; seed: number }>();
  private legs: Instanced;
  private torso: Instanced;
  private heads: Instanced;
  private hats: Instanced;
  private hair: Instanced;
  private heaps: Instanced;
  private poles: Instanced;
  private flags: Instanced;
  private personIds: string[] = [];
  private heapIds: string[] = [];
  private flagIds: string[] = [];
  private stores: StoreView[] = [];
  private workfronts: WorkfrontView[] = [];
  private rings = new Map<string, DrapedRing>();
  private depots = new Map<string, { group: Group; key: string }>();
  /** a store's goods as piles (rebuilt when a pile's count changes), and the bulk left for its heap */
  private goods = new Map<string, { group: Group; key: string; bulk: number; radius: number }>();
  private heapUnitVolume = 1;
  private hf: Heightfield | null = null;
  private m4 = new Matrix4();
  /** what is not worn: scaled to nothing */
  private none = new Matrix4().makeScale(0, 0, 0);
  private q = new Quaternion();
  private q2 = new Quaternion();
  private v = new Vector3();
  private s = new Vector3();
  private up = new Vector3(0, 1, 0);
  private n = new Vector3();
  private grad = { x: 0, z: 0 };
  private col = new Color();
  private exaggeration = 1;
  private storesDirty = true;
  private highlighted: string | null = null;

  constructor() {
    this.group.name = 'dynamic';
    this.highlightMat = finishMaterial({ envMapIntensity: 0.7, emissive: new Color('#ffffff') }, 'highlight');
    this.highlightMat.emissiveIntensity = 0.25;
    // people at a person's proportions (1.75 m): legs in trousers and shoes; the upper body with its arms (the instance
    // colour: hi-vis at work for a firm, everyday clothes at home); head and hands; a hard hat or hair
    const limb = (r: number, a: [number, number, number], b: [number, number, number]) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const g = new CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 3, 8);
      const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d));
      return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    };
    const legs = mergeGeometries([limb(0.075, [0, 0.1, -0.1], [0, 0.92, -0.1]), limb(0.075, [0, 0.1, 0.1], [0, 0.92, 0.1]), new BoxGeometry(0.27, 0.09, 0.11).translate(0.05, 0.045, -0.1), new BoxGeometry(0.27, 0.09, 0.11).translate(0.05, 0.045, 0.1)])!;
    this.legs = new Instanced(legs, new MeshStandardMaterial({ color: '#2e3540', roughness: 0.92 }), this.group, 'people-legs');
    const trunk = new CapsuleGeometry(0.16, 0.42, 4, 10).scale(0.75, 1, 1.2).translate(0, 1.2, 0);
    const torso = mergeGeometries([trunk, limb(0.055, [0, 1.42, -0.22], [0.04, 0.95, -0.26]), limb(0.055, [0, 1.42, 0.22], [0.04, 0.95, 0.26])])!;
    this.torso = new Instanced(torso, this.figureMat, this.group, 'people');
    const head = mergeGeometries([new SphereGeometry(0.105, 12, 8).scale(1, 1.12, 0.92).translate(0, 1.64, 0), new CylinderGeometry(0.05, 0.055, 0.08, 8).translate(0, 1.52, 0), new SphereGeometry(0.045, 6, 4).translate(0.04, 0.9, -0.27), new SphereGeometry(0.045, 6, 4).translate(0.04, 0.9, 0.27)])!;
    this.heads = new Instanced(head, new MeshStandardMaterial({ color: '#d9a58a', roughness: 0.7 }), this.group, 'people-heads', 64, false);
    const hat = mergeGeometries([new SphereGeometry(0.13, 12, 5, 0, TAU, 0, Math.PI / 2).scale(1.08, 0.95, 1).translate(0, 1.68, 0), new CylinderGeometry(0.15, 0.15, 0.015, 14).translate(0.02, 1.68, 0)])!;
    this.hats = new Instanced(hat, new MeshStandardMaterial({ roughness: 0.4 }), this.group, 'people-hats', 64, false);
    const hair = new SphereGeometry(0.112, 12, 6, 0, TAU, 0, Math.PI * 0.55).scale(1.02, 1.05, 0.98).translate(-0.012, 1.655, 0);
    this.hair = new Instanced(hair, new MeshStandardMaterial({ roughness: 0.85 }), this.group, 'people-hair', 64, false);
    this.torso.mesh.userData.kind = 'person';

    // stockpile heap: rounded cone at ~35° angle of repose (radius 1)
    const prof = [
      [0, 0.68],
      [0.14, 0.665],
      [0.3, 0.6],
      [0.5, 0.45],
      [0.72, 0.27],
      [0.9, 0.1],
      [1.0, 0.02],
      [1.03, -0.15],
    ].map(([r, y]) => new Vector2(r!, y!));
    // lathe faces point outwards when the profile runs bottom → top
    const heap = new LatheGeometry([...prof].reverse(), 22);
    const hp = heap.getAttribute('position');
    for (let i = 0; i < hp.count; i += 1) {
      const x = hp.getX(i);
      const z = hp.getZ(i);
      const y = hp.getY(i);
      const r = Math.hypot(x, z);
      if (r < 1e-3 || y < 0) continue;
      const a = Math.atan2(z, x);
      const k = 1 + 0.06 * Math.sin(a * 3 + 1) + 0.04 * Math.sin(a * 5 + 2);
      hp.setXYZ(i, x * k, y * (0.97 + 0.06 * Math.sin(a * 2)), z * k);
    }
    heap.computeVertexNormals();
    // volume of the profile above y = 0
    let vol = 0;
    for (let i = 0; i < prof.length - 1; i += 1) {
      const a = prof[i]!;
      const b = prof[i + 1]!;
      if (a.y < 0 || b.y < 0) continue;
      const h = a.y - b.y;
      vol += (Math.PI * h * (a.x * a.x + a.x * b.x + b.x * b.x)) / 3;
    }
    this.heapUnitVolume = vol;
    this.heaps = new Instanced(heap, this.heapMat, this.group, 'heaps', 32);
    this.heaps.mesh.userData.kind = 'store';

    // work front flag
    const pole = new CylinderGeometry(0.05, 0.05, 3.2, 5).translate(0, 1.6, 0);
    this.poles = new Instanced(pole, new MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.6 }), this.group, 'wf-poles', 32);
    const flag = new BoxGeometry(1.1, 0.7, 0.03).translate(0.58, 2.75, 0);
    this.flags = new Instanced(flag, this.flagMat, this.group, 'wf-flags', 32);
    this.flags.mesh.userData.kind = 'workPackage';
  }

  /** the sky's reflection in metal, glass and paint */
  setEnvMap(tex: Texture | null): void {
    for (const m of [this.machineMat, this.highlightMat, this.plainMat]) {
      m.envMap = tex;
      m.needsUpdate = true;
    }
  }

  setHeightfield(hf: Heightfield): void {
    this.hf = hf;
    this.storesDirty = true;
    for (const r of this.rings.values()) r.invalidate();
    for (const d of this.depots.values()) d.key = '';
  }

  setFrame(frame: Frame, now: number): void {
    const seen = new Set<string>();
    for (const m of frame.machines) {
      seen.add(m.id);
      this.upsert(m.id, m.cls, m.color, m, m.working, 'machine', now, m.model);
    }
    for (const t of frame.trips) {
      seen.add(t.id);
      const visual = carrierVisual(t.profile);
      // a lorry broken down on the way stands in warning red until it goes on
      this.upsert(t.id, visual.cls, t.stopped ? '#c0392b' : '#3d5a80', t, false, 'trip', now, visual.model);
    }
    for (const [id, o] of this.machines) {
      if (!seen.has(id)) {
        this.group.remove(o.rig.root);
        this.machines.delete(id);
      }
    }
    // people
    const pseen = new Set<string>();
    for (const p of frame.people) {
      if (p.state === 'off' || p.state === 'absent') continue;
      pseen.add(p.id);
      const ex = this.people.get(p.id);
      const seed = ex?.seed ?? strHash(p.id);
      const h = seed * TAU;
      if (!ex) this.people.set(p.id, { mover: newMover(p.x, p.z, h, now), view: p, seed });
      else {
        ex.view = p;
        retarget(ex.mover, p.x, p.z, h, now);
      }
    }
    for (const id of [...this.people.keys()]) if (!pseen.has(id)) this.people.delete(id);
    // stores and work fronts are static between frames
    this.stores = frame.stores;
    this.workfronts = frame.workfronts;
    this.storesDirty = true;
  }

  private upsert(id: string, cls: string, color: string, v: MachineView | TripView, working: boolean, kind: 'machine' | 'trip', now: number, model: string): void {
    const key = `${cls}|${model}|${color}`;
    let o = this.machines.get(id);
    if (o && o.key !== key) {
      this.group.remove(o.rig.root);
      o = undefined;
    }
    if (!o) {
      const rig = buildMachine(cls, color, this.machineMat, this.loadMat, model);
      rig.root.userData.pick = { id, kind };
      this.group.add(rig.root);
      o = { rig, mover: newMover(v.x, v.z, v.heading, now), view: v, working, seed: strHash(id), key, kind };
      this.machines.set(id, o);
      if (this.highlighted === id) this.applyHighlight(id, true);
    } else retarget(o.mover, v.x, v.z, v.heading, now);
    o.view = v;
    o.working = working;
    if (o.rig.load) {
      const loaded = 'haul' in v && v.haul ? v.haul.loaded : 'loaded' in v ? v.loaded : false;
      o.rig.load.visible = loaded;
    }
  }

  /** per animation frame */
  update(now: number, t: number, camDistance: number): void {
    const hf = this.hf;
    if (!hf) return;
    // Metres stay metres at every camera distance; labels provide legibility.
    this.exaggeration = 1;
    const ex = this.exaggeration;
    for (const o of this.machines.values()) {
      const m = o.mover;
      step(m, now);
      const root = o.rig.root;
      const y = hf.y(m.x, m.z);
      root.position.set(m.x, y, m.z);
      // tilt to the terrain normal, then yaw to the heading
      hf.gradient(m.x, m.z, this.grad);
      this.n.set(-this.grad.x, 1, -this.grad.z).normalize();
      this.q.setFromUnitVectors(this.up, this.n);
      this.q2.setFromAxisAngle(this.up, m.h);
      root.quaternion.copy(this.q).multiply(this.q2);
      root.scale.setScalar(ex);
      const moving = now - m.t0 < LERP_MS && m.moving;
      animateRig(o.rig, t, o.working, moving, o.seed);
    }
    this.updatePeople(now, t, ex);
    if (this.storesDirty) this.updateStores();
    this.updateRings(t);
  }

  private updatePeople(now: number, t: number, ex: number): void {
    const hf = this.hf!;
    const n = this.people.size;
    for (const inst of [this.legs, this.torso, this.heads, this.hats, this.hair]) inst.ensure(n);
    this.torso.mesh.userData.kind = 'person';
    const pe = 1;
    let k = 0;
    this.personIds.length = 0;
    for (const [id, p] of this.people) {
      step(p.mover, now);
      const x = p.mover.x;
      const z = p.mover.z;
      const working = p.view.state === 'working';
      const bob = working ? Math.abs(Math.sin(t * 3 + p.seed * 10)) * 0.04 : 0;
      this.q.setFromAxisAngle(this.up, p.mover.h + (working ? Math.sin(t * 0.7 + p.seed * 9) * 0.6 : 0));
      this.m4.compose(this.v.set(x, hf.y(x, z) + bob, z), this.q, this.s.set(pe, pe, pe));
      this.legs.mesh.setMatrixAt(k, this.m4);
      this.torso.mesh.setMatrixAt(k, this.m4);
      this.heads.mesh.setMatrixAt(k, this.m4);
      const st = p.view.state;
      // a firm's people in hi-vis and hard hats (coloured by what they do); a household's in their own clothes and hair
      const home = /^(member|friend|family|helper|relative|neighbour)$/i.test(p.view.job);
      this.hats.mesh.setMatrixAt(k, home ? this.none : this.m4);
      this.hair.mesh.setMatrixAt(k, home ? this.m4 : this.none);
      const CLOTHES = ['#3d5a80', '#8c2f39', '#4f6d4a', '#6b6b6b', '#c47f2c', '#2f2f35'];
      const HAIR = ['#2b1d14', '#5a3b22', '#a77b48', '#1b1b1b', '#8a8a86'];
      this.torso.mesh.setColorAt(k, this.col.set(home ? CLOTHES[Math.floor(p.seed * 6)]! : st === 'working' ? '#ff6a13' : st === 'waiting' ? '#f5c518' : '#8d99a6'));
      this.hair.mesh.setColorAt(k, this.col.set(HAIR[Math.floor(p.seed * 37) % 5]!));
      const lead = /foreman|polier|lead|engineer|survey/i.test(p.view.job);
      this.hats.mesh.setColorAt(k, this.col.set(lead ? '#f7f7f2' : p.seed > 0.5 ? '#f5b70a' : '#ff7a1a'));
      this.personIds.push(id);
      k += 1;
    }
    for (const inst of [this.legs, this.torso, this.heads, this.hats, this.hair]) {
      inst.mesh.count = k;
      inst.mesh.instanceMatrix.needsUpdate = true;
      if (inst.mesh.instanceColor) inst.mesh.instanceColor.needsUpdate = true;
    }
    this.torso.mesh.userData.ids = this.personIds;
  }

  private updateStores(): void {
    this.storesDirty = false;
    const hf = this.hf!;
    // heaps
    let n = 0;
    for (const s of this.stores) if (s.kind !== 'depot' && s.volume > 0.05) n += 1;
    this.heaps.ensure(n + 4);
    this.heaps.mesh.userData.kind = 'store';
    let k = 0;
    this.heapIds.length = 0;
    const depotSeen = new Set<string>();
    const goodsSeen = new Set<string>();
    for (const s of this.stores) {
      if (s.kind === 'depot') {
        depotSeen.add(s.id);
        this.ensureDepot(s);
        if (s.volume > 0.05) this.placeHeap(k++, s, s.x - 10, s.z + 6, hf, s.volume);
        continue;
      }
      let vol = s.volume;
      let off = 0;
      if (s.contents.length) {
        const g = this.ensureGoods(s);
        goodsSeen.add(s.id);
        vol = g.bulk;
        off = g.radius;
      }
      if (vol <= 0.05) continue;
      // (beside the piles of goods, where there are any)
      const r = Math.cbrt(vol / this.heapUnitVolume);
      this.placeHeap(k++, s, s.x + (off ? off + r + 0.5 : 0), s.z, hf, vol);
    }
    for (const [id, g] of this.goods) {
      if (!goodsSeen.has(id)) {
        this.group.remove(g.group);
        g.group.traverse((o) => (o as Mesh).geometry?.dispose());
        this.goods.delete(id);
      }
    }
    this.heaps.mesh.count = k;
    this.heaps.mesh.instanceMatrix.needsUpdate = true;
    if (this.heaps.mesh.instanceColor) this.heaps.mesh.instanceColor.needsUpdate = true;
    this.heaps.mesh.userData.ids = this.heapIds;
    for (const [id, d] of this.depots) {
      if (!depotSeen.has(id)) {
        this.group.remove(d.group);
        d.group.traverse((o) => (o as Mesh).geometry?.dispose());
        this.depots.delete(id);
      }
    }
    // work-front flags
    this.poles.ensure(this.workfronts.length);
    this.flags.ensure(this.workfronts.length);
    this.flags.mesh.userData.kind = 'workPackage';
    this.flagIds.length = 0;
    let f = 0;
    for (const w of this.workfronts) {
      const sc = Math.min(2.2, this.exaggeration);
      this.q.setFromAxisAngle(this.up, strHash(w.id) * TAU);
      this.m4.compose(this.v.set(w.x, hf.y(w.x, w.z) - 0.1, w.z), this.q, this.s.set(sc, sc, sc));
      this.poles.mesh.setMatrixAt(f, this.m4);
      this.flags.mesh.setMatrixAt(f, this.m4);
      this.flags.mesh.setColorAt(f, this.col.set(w.blocked ? '#e0303a' : w.color));
      this.flagIds.push(w.id);
      f += 1;
    }
    for (const inst of [this.poles, this.flags]) {
      inst.mesh.count = f;
      inst.mesh.instanceMatrix.needsUpdate = true;
      if (inst.mesh.instanceColor) inst.mesh.instanceColor.needsUpdate = true;
    }
    this.flags.mesh.userData.ids = this.flagIds;
    // rings
    const wseen = new Set<string>();
    for (const w of this.workfronts) {
      wseen.add(w.id);
      let r = this.rings.get(w.id);
      if (!r) {
        r = new DrapedRing(w.color, 0.75, 0.2);
        this.rings.set(w.id, r);
        this.group.add(r.mesh);
      }
      r.mat.color.set(w.blocked ? '#e0303a' : w.color);
      r.mesh.userData.blocked = w.blocked;
      r.mesh.visible = true;
      r.set(hf, w.x, w.z, w.blocked ? 7 : 6, w.blocked ? 0.9 : 0.6);
    }
    for (const [id, r] of this.rings) {
      if (!wseen.has(id)) {
        this.group.remove(r.mesh);
        r.dispose();
        this.rings.delete(id);
      }
    }
  }

  private ensureGoods(s: StoreView): { bulk: number; radius: number } {
    const hf = this.hf!;
    // (a pile changes when its count of packs does, not with every litre drunk)
    const step: Record<string, number> = { l: 9, kg: 5, pcs: 1, t: 0.25, m3: 0.25 };
    const key = `${s.x.toFixed(1)},${s.z.toFixed(1)}|${s.contents.map((c) => `${c.material}:${Math.ceil(c.qty / (step[c.unit] ?? 1) - 1e-9)}`).join(';')}`;
    const ex = this.goods.get(s.id);
    if (ex && ex.key === key) return ex;
    if (ex) {
      this.group.remove(ex.group);
      ex.group.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    const y0 = hf.y(s.x, s.z);
    const k = new Kit(new Color('#ffffff'));
    const { bulk, radius } = drawGoods(s.contents, k, (dx, dz) => hf.y(s.x + dx, s.z + dz) - y0, Math.round(strHash(s.id) * 1000));
    const group = new Group();
    if (!k.empty) {
      const m = new Mesh(k.build(), this.plainMat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    group.position.set(s.x, y0, s.z);
    group.userData.pick = { id: s.id, kind: 'store' };
    group.name = `goods:${s.id}`;
    this.group.add(group);
    const out = { group, key, bulk, radius };
    this.goods.set(s.id, out);
    return out;
  }

  private placeHeap(k: number, s: StoreView, x: number, z: number, hf: Heightfield, volume: number): void {
    const r = Math.cbrt(volume / this.heapUnitVolume);
    let y = Infinity;
    for (let a = 0; a < 6; a += 1) y = Math.min(y, hf.y(x + Math.cos(a) * r * 0.8, z + Math.sin(a) * r * 0.8));
    y = Math.min(y, hf.y(x, z));
    this.q.setFromAxisAngle(this.up, strHash(s.id) * TAU);
    this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(r, r, r));
    this.heaps.mesh.setMatrixAt(k, this.m4);
    this.heaps.mesh.setColorAt(k, this.col.set(s.color));
    this.heapIds[k] = s.id;
  }

  private ensureDepot(s: StoreView): void {
    const hf = this.hf!;
    const key = `${s.x.toFixed(1)},${s.z.toFixed(1)}`;
    const ex = this.depots.get(s.id);
    if (ex && ex.key === key) return;
    if (ex) {
      this.group.remove(ex.group);
      ex.group.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    const g = new Group();
    g.userData.pick = { id: s.id, kind: 'store' };
    const W = 44;
    const D = 30;
    // gravel pad draped on the terrain
    const NX = 23;
    const NZ = 16;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new Color();
    for (let j = 0; j < NZ; j += 1) {
      for (let i = 0; i < NX; i += 1) {
        const x = s.x - W / 2 + (i / (NX - 1)) * W;
        const z = s.z - D / 2 + (j / (NZ - 1)) * D;
        pos.push(x, hf.y(x, z) + 0.08, z);
        c.set('#a39d90').multiplyScalar(0.9 + 0.15 * hash2(i * 3 + 1, j * 5 + 2));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < NZ - 1; j += 1) {
      for (let i = 0; i < NX - 1; i += 1) {
        const a = j * NX + i;
        idx.push(a, a + NX, a + 1, a + 1, a + NX, a + NX + 1);
      }
    }
    const pad = new BufferGeometry();
    pad.setAttribute('position', new Float32BufferAttribute(pos, 3));
    pad.setAttribute('color', new Float32BufferAttribute(col, 3));
    pad.setIndex(idx);
    pad.computeVertexNormals();
    const padMesh = new Mesh(pad, new MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    padMesh.receiveShadow = true;
    g.add(padMesh);
    // containers, office, fence
    const k = new Kit(new Color('#ffffff'));
    const base = (x: number, z: number) => hf.y(s.x + x, s.z + z);
    const minY = Math.min(base(-W / 2, -D / 2), base(W / 2, -D / 2), base(-W / 2, D / 2), base(W / 2, D / 2), base(0, 0));
    const cont = (x: number, z: number, color: string, rot = 0, h = 2.6) => k.box(6.06, h, 2.44, s.x + x, base(x, z) + h / 2 - 0.05, s.z + z, color, 0, rot);
    cont(-14, -10, '#3f6e8c');
    cont(-14, -7, '#3f6e8c');
    cont(-6, -10.5, '#7c8a3a');
    // office container (white with windows)
    cont(10, -10, '#e8e8e2');
    k.box(1.4, 0.8, 0.04, s.x + 9, base(10, -10) + 1.6, s.z - 8.76, '#26343f');
    k.box(1.4, 0.8, 0.04, s.x + 12, base(10, -10) + 1.6, s.z - 8.76, '#26343f');
    k.box(1.0, 2.0, 0.04, s.x + 6.8, base(10, -10) + 1.0, s.z - 8.76, '#5a6168');
    // pallets / material
    for (let i = 0; i < 4; i += 1) k.box(1.2, 0.5, 1.0, s.x + 2 + i * 1.6, base(2 + i * 1.6, 8) + 0.25, s.z + 8, i % 2 ? '#b08b5a' : '#9a9a96');
    // fence: posts + mesh panels around the perimeter with a gate on the west side
    const fence = '#9aa0a3';
    const post = (x: number, z: number) => k.box(0.08, 2.0, 0.08, s.x + x, base(x, z) + 1.0, s.z + z, fence);
    for (let x = -W / 2; x <= W / 2 + 0.01; x += 3.5) {
      post(x, -D / 2);
      post(x, D / 2);
    }
    for (let z = -D / 2 + 3.5; z < D / 2; z += 3.5) {
      post(W / 2, z);
      if (Math.abs(z) > 5) post(-W / 2, z);
    }
    const panel = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const rot = -Math.atan2(z1 - z0, x1 - x0);
      k.box(len, 1.8, 0.03, s.x + mx, base(mx, mz) + 1.0, s.z + mz, '#b4babd', 0, rot);
    };
    panel(-W / 2, -D / 2, W / 2, -D / 2);
    panel(-W / 2, D / 2, W / 2, D / 2);
    panel(W / 2, -D / 2, W / 2, D / 2);
    panel(-W / 2, -D / 2, -W / 2, -5);
    panel(-W / 2, 5, -W / 2, D / 2);
    void minY;
    const geo = k.build();
    const m = new Mesh(geo, this.plainMat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    g.name = `depot:${s.id}`;
    this.group.add(g);
    this.depots.set(s.id, { group: g, key });
  }

  private updateRings(t: number): void {
    for (const r of this.rings.values()) {
      if (r.mesh.userData.blocked) r.mat.opacity = 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(t * 5));
      else r.mat.opacity = 0.7;
    }
  }

  /** objects for raycast picking */
  pickables(out: Object3D[]): void {
    for (const o of this.machines.values()) out.push(o.rig.root);
    out.push(this.torso.mesh, this.heaps.mesh, this.flags.mesh);
    for (const d of this.depots.values()) out.push(d.group);
    for (const g of this.goods.values()) out.push(g.group);
  }

  entityAt(x: number, z: number, radius: number): { id: string; kind: string } | null {
    let best: { id: string; kind: string; d: number } | null = null;
    const consider = (id: string, kind: string, px: number, pz: number, r: number) => {
      const d = Math.hypot(px - x, pz - z);
      if (d <= r && (!best || d < best.d)) best = { id, kind, d };
    };
    for (const [id, o] of this.machines) consider(id, o.kind, o.mover.x, o.mover.z, radius + o.rig.size * 0.4 * this.exaggeration);
    for (const [id, p] of this.people) consider(id, 'person', p.mover.x, p.mover.z, radius * 0.6);
    for (const s of this.stores) consider(s.id, 'store', s.x, s.z, radius + (s.kind === 'depot' ? 18 : Math.cbrt(s.volume + 1)));
    for (const w of this.workfronts) consider(w.id, 'workPackage', w.x, w.z, radius);
    const b = best as { id: string; kind: string } | null;
    return b ? { id: b.id, kind: b.kind } : null;
  }

  /** world position + size of an entity (for selection rings / focus) */
  entityPos(id: string, out: EntityPos): boolean {
    const hf = this.hf;
    if (!hf) return false;
    const m = this.machines.get(id);
    if (m) {
      out.x = m.mover.x;
      out.z = m.mover.z;
      out.y = hf.y(out.x, out.z);
      out.radius = m.rig.size * 0.6 * this.exaggeration;
      out.kind = m.kind;
      return true;
    }
    const p = this.people.get(id);
    if (p) {
      out.x = p.mover.x;
      out.z = p.mover.z;
      out.y = hf.y(out.x, out.z);
      out.radius = 1.2 * Math.max(1, this.exaggeration);
      out.kind = 'person';
      return true;
    }
    for (const s of this.stores) {
      if (s.id === id) {
        out.x = s.x;
        out.z = s.z;
        out.y = hf.y(s.x, s.z);
        out.radius = s.kind === 'depot' ? 26 : Math.max(3, Math.cbrt(s.volume / this.heapUnitVolume) * 1.2);
        out.kind = 'store';
        return true;
      }
    }
    for (const w of this.workfronts) {
      if (w.id === id) {
        out.x = w.x;
        out.z = w.z;
        out.y = hf.y(w.x, w.z);
        out.radius = 8;
        out.kind = 'workPackage';
        return true;
      }
    }
    return false;
  }

  /** emissive highlight on a machine (selection) */
  highlight(id: string | null): void {
    if (this.highlighted === id) return;
    if (this.highlighted) this.applyHighlight(this.highlighted, false);
    this.highlighted = id;
    if (id) this.applyHighlight(id, true);
  }

  private applyHighlight(id: string, on: boolean): void {
    const o = this.machines.get(id);
    if (!o) return;
    for (const m of o.rig.meshes) if (m !== o.rig.load) m.material = on ? this.highlightMat : this.machineMat;
  }

  pulse(t: number): void {
    this.highlightMat.emissiveIntensity = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(t * 4));
  }

  dispose(): void {
    for (const o of this.machines.values()) this.group.remove(o.rig.root);
    this.machines.clear();
    for (const r of this.rings.values()) r.dispose();
    for (const d of this.depots.values()) d.group.traverse((o) => (o as Mesh).geometry?.dispose());
    for (const inst of [this.legs, this.torso, this.heads, this.hats, this.hair, this.heaps, this.poles, this.flags]) inst.mesh.dispose();
    for (const m of [this.machineMat, this.loadMat, this.figureMat, this.heapMat, this.flagMat, this.plainMat, this.highlightMat]) m.dispose();
  }
}

